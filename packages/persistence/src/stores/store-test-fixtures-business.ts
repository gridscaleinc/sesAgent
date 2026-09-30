import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRedactedManualJobCaseSource, extractJobCaseDraft } from '@job-cases'
import type { DocumentIR } from '@parsers'
import { redactTextForCloud } from '@privacy'
import { extractCandidateDraft } from '@resume'
import type { CandidateReviewSnapshot, JobCaseReviewSnapshot, ResumeAnalysisSummary } from '@shared'
import type { EncryptedApplicationRepository } from '../index'

/**
 * Test-only fixtures for business stores. They follow the setup used by
 * scripts/verify-business-progress.ts and scripts/verify-business-workbench.ts:
 * an imported (not yet HR-reviewed) person and a manually pasted job case.
 */
export const defaultOperatorId = '00000000-0000-4000-8000-000000000001'

export function seedImportedPerson(
  repository: EncryptedApplicationRepository,
  options: { privateName?: string; text?: string } = {}
): CandidateReviewSnapshot {
  const documentId = randomUUID()
  const privateName = options.privateName ?? 'TEST_PRIVATE_NAME'
  const text =
    options.text ??
    '案件名: 決済基盤刷新 / 2022年4月〜2024年3月 / Java / AWS / PL / クラウド移行の設計・構築を担当 / 経験 7年 / 希望単価 80〜90万円'
  const sha256 = createHash('sha256')
    .update(documentId + text)
    .digest('hex')
  const redaction = redactTextForCloud(privateName, {
    sourceVersion: 'store-test:v1',
    knownPersonNames: [privateName],
    personNameReviewCompleted: true,
    sessionId: randomUUID()
  })
  repository.saveRedactionSession(redaction.session, redaction.mappings)
  repository.saveStagedFile({
    token: documentId,
    name: 'store-test-resume.pdf',
    format: 'pdf',
    size: 2048,
    sha256,
    encryptedPath: join(tmpdir(), `store-test-${documentId}.vault`),
    privacyStatus: 'awaiting-local-scan',
    createdAt: '2026-07-17T00:00:00.000Z'
  })
  const document: DocumentIR = {
    version: 'document-ir-v1',
    documentId,
    source: { name: 'store-test-resume.pdf', format: 'pdf', sha256, size: 2048 },
    blocks: [{ id: 'page-1-block-1', kind: 'text', text, source: { page: 1, boundingBox: [10, 10, 400, 35] } }],
    warnings: [],
    requiresLocalOcr: false,
    statistics: { pages: 1, sheets: 0, blocks: 1, characters: text.length },
    security: { externalContentLoaded: false, macrosExecuted: false, rawFileCloudEligible: false }
  }
  const extraction = extractCandidateDraft(document, new Date('2026-07-17T00:01:00.000Z'))
  const summary: ResumeAnalysisSummary = {
    analysisVersion: 'resume-analysis-v6',
    fileToken: documentId,
    fileName: 'store-test-resume.pdf',
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
    analyzedAt: '2026-07-17T00:01:00.000Z'
  }
  repository.saveParsedDocument(document, summary, redaction.session.id, extraction)
  const review = repository.getCandidateReview(documentId)
  if (!review) throw new Error('fixture person was not stored')
  return review
}

export function seedDraftCase(
  repository: EncryptedApplicationRepository,
  subject = 'Java 検証案件',
  body = '必須スキル：Java / SQL\n勤務地：東京'
): JobCaseReviewSnapshot {
  const source = createRedactedManualJobCaseSource({ subject, body }, randomUUID(), [])
  const draft = extractJobCaseDraft(source.source, randomUUID())
  repository.saveRedactedJobCaseSourceAndDraft(source.redaction.session, source.redaction.mappings, source.source, draft)
  const review = repository.getJobCaseReview(draft.reviewId)
  if (!review) throw new Error('fixture case was not stored')
  return review
}

export function seedConfirmedCase(
  repository: EncryptedApplicationRepository,
  subject = 'Java 検証案件',
  body = '必須スキル：Java / SQL\n勤務地：東京'
): JobCaseReviewSnapshot {
  const draft = seedDraftCase(repository, subject, body)
  return repository.confirmJobCaseReview(
    {
      reviewId: draft.reviewId,
      reviewRevision: draft.reviewRevision,
      privacyReviewed: true,
      fields: draft.fields.map((field) => ({ key: field.key, value: field.value, confirmed: true, changeReason: 'store test fixture' }))
    },
    'test-hr',
    'Test HR'
  )
}

export const emptySchedule = (roundNumber = 1, scheduledAt = '') => ({
  roundNumber,
  scheduledAt,
  durationMinutes: 60,
  meetingMethod: 'onsite' as const,
  meetingUrl: '',
  location: '',
  interviewer: '',
  note: ''
})
