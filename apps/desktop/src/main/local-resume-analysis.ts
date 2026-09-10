import { collectLocalPersonNameCandidates, mergeLocalOcr } from '@local-ai'
import { documentIrSchema } from '@parsers'
import type { ParserWorkerClient } from '@parsers/worker-client'
import type { EncryptedApplicationRepository } from '@persistence'
import { redactTextForCloud } from '@privacy'
import { extractCandidateDraft } from '@resume'
import type { ResumeAnalysisSummary, StagedLocalFile } from '@shared'
import type { MainIpcContext } from './ipc/context'

function rendererSafeFile(record: ReturnType<EncryptedApplicationRepository['getStagedFileRecords']>[number]): StagedLocalFile {
  const { encryptedPath: _encryptedPath, ...metadata } = record
  return metadata
}

function documentTextForLocalPrivacy(document: Awaited<ReturnType<ParserWorkerClient['parse']>>): string {
  return document.blocks
    .map((block) => {
      const location = block.source.page
        ? `PAGE:${block.source.page}`
        : block.source.sheet && block.source.cell
          ? `SHEET:${block.source.sheet}!${block.source.cell}`
          : block.source.paragraph
            ? `PARAGRAPH:${block.source.paragraph}`
            : 'SOURCE:UNKNOWN'
      return `[${location}] ${block.text}`
    })
    .join('\n')
}

export async function analyzeStagedResumeLocally(
  { repository, fileVault, parserWorker, localOcr, localNer }: Pick<MainIpcContext, 'repository' | 'fileVault' | 'parserWorker' | 'localOcr' | 'localNer'>,
  record: ReturnType<EncryptedApplicationRepository['getStagedFileRecords']>[number],
  onParsed: () => void = () => undefined
) {
  const bytes = await fileVault.decryptForLocalProcessing(record)
  let document
  try {
    document = await parserWorker.parse(rendererSafeFile(record), bytes)
    if (document.requiresLocalOcr && record.format === 'pdf' && localOcr) {
      try {
        document = mergeLocalOcr(document, await localOcr.ocrPdf(bytes))
      } catch {
        document = documentIrSchema.parse({
          ...document,
          warnings: [
            ...document.warnings,
            {
              code: 'LOCAL_OCR_FAILED',
              message: 'Apple Vision OCR was unavailable or could not reliably process the scanned page.'
            }
          ]
        })
      }
    }
  } finally {
    bytes.fill(0)
  }
  onParsed()
  const localText = documentTextForLocalPrivacy(document)
  let localNameDetection
  try {
    localNameDetection = await localNer?.detectNames(localText)
  } catch {
    localNameDetection = undefined
  }
  const knownPersonNames = collectLocalPersonNameCandidates(localText, localNameDetection)
  const mediaRisks: Array<'face_or_photo' | 'signature' | 'identifying_qr_code'> = []
  if (document.requiresLocalOcr || (document.ocr?.faceRegions ?? 0) > 0) mediaRisks.push('face_or_photo')
  if (document.requiresLocalOcr || document.ocr?.signatureReviewRequired) mediaRisks.push('signature')
  if (document.requiresLocalOcr || (document.ocr?.barcodeRegions ?? 0) > 0) mediaRisks.push('identifying_qr_code')
  const redaction = redactTextForCloud(localText, {
    sourceVersion: record.sha256,
    policyVersion: 'cloud-redaction-v2',
    knownPersonNames,
    mediaRisks
  })
  const identifierCounts = new Map<string, number>()
  for (const mapping of redaction.mappings) {
    identifierCounts.set(mapping.identifierType, (identifierCounts.get(mapping.identifierType) ?? 0) + 1)
  }
  const analyzedAt = new Date().toISOString()
  const extraction = extractCandidateDraft(document, new Date(analyzedAt))
  return { document, extraction, redaction, identifierCounts, knownPersonNames, analyzedAt }
}

export async function importStagedResumeLocally(context: Parameters<typeof analyzeStagedResumeLocally>[0], record: Parameters<typeof analyzeStagedResumeLocally>[1]) {
  const { repository } = context
  const { document, extraction, redaction, identifierCounts, knownPersonNames, analyzedAt } = await analyzeStagedResumeLocally(context, record)
  const preview = redaction.redactedContent.length > 4000
    ? `${redaction.redactedContent.slice(0, 3999)}…`
    : redaction.redactedContent
  const summary: ResumeAnalysisSummary = {
    analysisVersion: 'resume-analysis-v6',
    fileToken: record.token,
    fileName: record.name,
    status: document.requiresLocalOcr ? 'requires-local-ocr' : 'requires-pii-review',
    cloudEligible: false,
    statistics: document.statistics,
    detectedIdentifiers: [...identifierCounts.entries()]
      .map(([type, count]) => ({ type, count }))
      .toSorted((a, b) => a.type.localeCompare(b.type)),
    localProcessing: {
      ocr: document.ocr?.engine === 'apple-vision'
        ? 'apple-vision-completed'
        : document.ocr?.engine === 'windows-tesseract-wasm'
          ? 'windows-tesseract-wasm-completed'
          : document.ocr?.engine === 'windows-media-ocr'
            ? 'windows-media-ocr-completed'
        : document.requiresLocalOcr
          ? 'requires-local-ocr'
          : 'not-required',
      ocrPages: document.ocr?.processedPages ?? 0,
      personNameCandidates: knownPersonNames.length,
      networkAccess: false
    },
    extractedFields: extraction.fields.map((field) => ({
      key: field.key,
      label: field.label,
      value: field.value,
      confidence: field.confidence,
      status: field.status,
      sourceLabels: [...new Set(field.sources.map((source) => source.sourceLabel))]
    })),
    extractedProjectExperiences: extraction.projectExperiences.map((project) => ({
      draftId: project.draftId,
      title: project.title,
      period: project.period,
      role: project.role,
      technologies: project.technologies,
      summary: project.summary,
      confidence: project.confidence,
      sourceLabels: [...new Set(project.sources.map((source) => source.sourceLabel))]
    })),
    warningCodes: [
      ...new Set([
        ...document.warnings.map((warning) => warning.code),
        ...(knownPersonNames.length > 0 ? ['PERSON_NAME_REVIEW_REQUIRED'] : [])
      ])
    ],
    redactedPreview: preview,
    analyzedAt
  }
  repository.saveRedactionSession(redaction.session, redaction.mappings)
  repository.saveParsedDocument(document, summary, redaction.session.id, extraction)
  return record.token
}
