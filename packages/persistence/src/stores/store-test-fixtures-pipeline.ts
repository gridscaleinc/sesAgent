import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { DocumentIR } from '@parsers'
import { redactTextForCloud } from '@privacy'
import { extractCandidateDraft } from '@resume'
import type { ResumeAnalysisSummary } from '@shared'
import type { EncryptedApplicationRepository } from '../index'

/**
 * Test-only fixture for the interview / match / evaluation / proposal store
 * tests: imports one local resume the way the resume pipeline does (staged file,
 * redaction session, parsed document + draft extraction) and optionally
 * confirms the candidate review.
 */
export function importTestCandidate(
  repository: EncryptedApplicationRepository,
  options: {
    documentId: string
    vaultDirectory: string
    personName?: string
    resumeText?: string
    confirm?: boolean
    now?: Date
  }
) {
  const now = options.now ?? new Date('2026-07-17T00:01:00.000Z')
  const personName = options.personName ?? '山田検証用'
  const text =
    options.resumeText ??
    '案件名: 決済基盤刷新 / 2022年4月〜2024年3月 / Java / AWS / PL / クラウド移行の設計・構築を担当 / 経験 7年 / 希望単価 80〜90万円'
  const sha256 = createHash('sha256')
    .update(options.documentId + text)
    .digest('hex')
  const redaction = redactTextForCloud(`${personName} / 090-1234-5678`, {
    sourceVersion: `store-test-resume:${options.documentId}`,
    knownPersonNames: [personName],
    personNameReviewCompleted: true,
    now
  })
  repository.saveRedactionSession(redaction.session, redaction.mappings)
  repository.saveStagedFile({
    token: options.documentId,
    name: `${options.documentId}.pdf`,
    format: 'pdf',
    size: 2048,
    sha256,
    encryptedPath: join(options.vaultDirectory, `${options.documentId}.vault`),
    privacyStatus: 'awaiting-local-scan',
    createdAt: now.toISOString()
  })
  const document: DocumentIR = {
    version: 'document-ir-v1',
    documentId: options.documentId,
    source: { name: `${options.documentId}.pdf`, format: 'pdf', sha256, size: 2048 },
    blocks: [{ id: 'page-1-block-1', kind: 'text', text, source: { page: 1, boundingBox: [10, 10, 400, 35] } }],
    warnings: [],
    requiresLocalOcr: false,
    statistics: { pages: 1, sheets: 0, blocks: 1, characters: text.length },
    security: { externalContentLoaded: false, macrosExecuted: false, rawFileCloudEligible: false }
  }
  const extraction = extractCandidateDraft(document, now)
  const summary: ResumeAnalysisSummary = {
    analysisVersion: 'resume-analysis-v6',
    fileToken: options.documentId,
    fileName: `${options.documentId}.pdf`,
    status: 'requires-pii-review',
    cloudEligible: false,
    statistics: document.statistics,
    detectedIdentifiers: [{ type: 'person_name', count: 1 }],
    localProcessing: { ocr: 'not-required', ocrPages: 0, personNameCandidates: 1, networkAccess: false },
    extractedFields: extraction.fields.map((field) => ({
      key: field.key,
      label: field.label,
      value: field.value,
      confidence: field.confidence,
      status: field.status,
      sourceLabels: field.sources.map((source) => source.sourceLabel)
    })),
    extractedProjectExperiences: extraction.projectExperiences.map((project) => ({
      draftId: project.draftId,
      title: project.title,
      period: project.period,
      role: project.role,
      technologies: project.technologies,
      summary: project.summary,
      confidence: project.confidence,
      sourceLabels: project.sources.map((source) => source.sourceLabel)
    })),
    warningCodes: ['PERSON_NAME_REVIEW_REQUIRED'],
    redactedPreview: '<PERSON_NAME_001> / Java / AWS',
    analyzedAt: now.toISOString()
  }
  repository.saveParsedDocument(document, summary, redaction.session.id, extraction)
  let review = repository.getCandidateReview(options.documentId)
  if (!review) throw new Error('fixture candidate review missing')
  if (options.confirm !== false) {
    review = repository.confirmCandidateReview(
      {
        documentId: options.documentId,
        reviewRevision: review.reviewRevision,
        piiReviewed: false,
        fields: extraction.fields.map((field) => ({ key: field.key, value: field.value, confirmed: true as const })),
        projectExperiences: extraction.projectExperiences.map((project) => ({
          draftId: project.draftId,
          title: project.title,
          period: project.period,
          role: project.role,
          technologies: project.technologies,
          summary: project.summary,
          confirmed: true as const
        }))
      },
      'store-test-user',
      '検証担当者',
      new Date(now.getTime() + 60_000)
    )
  }
  return { documentId: options.documentId, extraction, review, redactionSessionId: redaction.session.id }
}
