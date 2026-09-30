// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DocumentIR } from '@parsers'
import { redactTextForCloud } from '@privacy'
import { extractCandidateDraft } from '@resume'
import type { ResumeAnalysisSummary } from '@shared'
import type { EncryptedApplicationRepository } from '../index'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'

const candidateName = '山田検証用'
const candidatePhone = '090-1234-5678'

function importCandidate(repository: EncryptedApplicationRepository, directory: string, sha: string) {
  const documentId = randomUUID()
  const now = new Date('2026-07-17T00:00:00.000Z')
  const redaction = redactTextForCloud(`${candidateName} / ${candidatePhone}`, {
    sourceVersion: `candidate-test:${documentId}`,
    knownPersonNames: [candidateName],
    personNameReviewCompleted: true,
    sessionId: randomUUID(),
    now
  })
  repository.saveRedactionSession(redaction.session, redaction.mappings)
  repository.saveStagedFile({
    token: documentId,
    name: 'resume.pdf',
    format: 'pdf',
    size: 2048,
    sha256: sha,
    encryptedPath: join(directory, `${documentId}.vault`),
    privacyStatus: 'awaiting-local-scan',
    createdAt: now.toISOString()
  })
  const document: DocumentIR = {
    version: 'document-ir-v1',
    documentId,
    source: { name: 'resume.pdf', format: 'pdf', sha256: sha, size: 2048 },
    blocks: [
      {
        id: 'page-1-block-1',
        kind: 'text',
        text: `案件名: 決済基盤刷新 ${sha.slice(0, 4)} / 2022年4月〜2024年3月 / Java / AWS / PL / クラウド移行の設計・構築を担当 / 経験 7年 / 希望単価 80〜90万円`,
        source: { page: 1, boundingBox: [10, 10, 400, 35] }
      }
    ],
    warnings: [],
    requiresLocalOcr: false,
    statistics: { pages: 1, sheets: 0, blocks: 1, characters: 96 },
    security: { externalContentLoaded: false, macrosExecuted: false, rawFileCloudEligible: false }
  }
  const extraction = extractCandidateDraft(document, now)
  const summary: ResumeAnalysisSummary = {
    analysisVersion: 'resume-analysis-v6',
    fileToken: documentId,
    fileName: 'resume.pdf',
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
  return { documentId, extraction }
}

function submission(repository: EncryptedApplicationRepository, documentId: string, extraction: ReturnType<typeof extractCandidateDraft>) {
  const review = repository.getCandidateReview(documentId)!
  return {
    documentId,
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
  }
}

describe.skipIf(!nativeSqliteAvailable)('CandidateStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  it('imports a parsed resume, keeps identity local-only, confirms it and survives reopen', () => {
    const { repository } = handle
    const { documentId, extraction } = importCandidate(repository, handle.path + '.files', 'a'.repeat(64))
    const pending = repository.getCandidateReview(documentId)
    expect(pending?.status).toBe('awaiting-review')
    expect(pending?.localIdentity).toMatchObject({ displayName: candidateName, storage: 'encrypted-local-only', cloudEligible: false })
    expect(repository.listCandidateReviews().map((review) => review.documentId)).toContain(documentId)

    const confirmed = repository.confirmCandidateReview(submission(repository, documentId, extraction), 'test-user', '検証担当者')
    expect(confirmed.status).toBe('completed')
    expect(confirmed.profile).toMatchObject({ status: 'current', containsDirectIdentifiers: false })
    expect(repository.listEligibleTalentProfiles()).toHaveLength(1)

    const reopened = handle.reopen()
    expect(reopened.getCandidateReview(documentId)?.status).toBe('completed')
    expect(reopened.getCandidateLocalIdentity(documentId).displayName).toBe(candidateName)
  })

  it('does not write the candidate name or phone to the database file in plaintext', () => {
    const { repository } = handle
    importCandidate(repository, handle.path + '.files', 'a'.repeat(64))
    repository.checkpoint()
    repository.close()
    const bytes = readFileSync(handle.path)
    expect(bytes.includes(Buffer.from(candidateName))).toBe(false)
    expect(bytes.includes(Buffer.from(candidatePhone))).toBe(false)
  })

  it('rejects nationality as work authorization, stale revisions and double confirmation', () => {
    const { repository } = handle
    const { documentId, extraction } = importCandidate(repository, handle.path + '.files', 'b'.repeat(64))
    const base = submission(repository, documentId, extraction)
    expect(() =>
      repository.confirmCandidateReview(
        {
          ...base,
          fields: base.fields.map((field) =>
            field.key === 'work_authorization' ? { ...field, value: '日本国籍', changeReason: '検証' } : field
          )
        },
        'u',
        '担当'
      )
    ).toThrow(/compliance category/)
    expect(() => repository.confirmCandidateReview({ ...base, reviewRevision: base.reviewRevision + 1 }, 'u', '担当')).toThrow(/changed/)
    repository.confirmCandidateReview(base, 'u', '担当')
    expect(() => repository.confirmCandidateReview(base, 'u', '担当')).toThrow(/already completed/)
  })

  it('updates the profile with a new version and refuses a stale expected version', () => {
    const { repository } = handle
    const { documentId, extraction } = importCandidate(repository, handle.path + '.files', 'c'.repeat(64))
    repository.confirmCandidateReview(submission(repository, documentId, extraction), 'u', '担当')
    const current = repository.getCandidateProfileHistory(documentId)[0]!
    const update = (expectedVersion: number) =>
      repository.updateCandidateProfile(
        {
          sourceDocumentId: documentId,
          expectedVersion,
          identity: {
            displayName: candidateName,
            gender: null,
            birthDate: null,
            nationality: null,
            phone: candidatePhone,
            email: 'candidate@example.jp',
            address: null,
            education: null,
            major: null,
            graduationDate: null,
            degree: null
          },
          fields: current.fields.map((field) => ({ key: field.key, value: field.key === 'skills' ? 'Java, AWS, Go' : field.value })),
          projectExperiences: current.projectExperiences.map((project) => ({
            id: project.id,
            title: project.title,
            period: project.period,
            role: project.role,
            technologies: project.technologies,
            summary: project.summary
          }))
        },
        'u',
        '担当'
      )
    const updated = update(current.version)
    expect(updated.profileVersion).toBe(current.version + 1)
    expect(repository.getCandidateLocalIdentity(documentId).email).toBe('candidate@example.jp')
    expect(repository.getCandidateReview(documentId)?.fields.find((field) => field.key === 'skills')?.value).toBe('Java, AWS, Go')
    expect(() => update(current.version)).toThrow(/更新されました/)
  })

  it('deletes all candidate data only with the current preview hash', () => {
    const { repository } = handle
    const { documentId } = importCandidate(repository, handle.path + '.files', 'd'.repeat(64))
    const preview = repository.previewCandidateDeletion(documentId)
    expect(() => repository.deleteCandidateDatabaseData(documentId, 'f'.repeat(64))).toThrow(/preview changed/)
    expect(repository.getCandidateReview(documentId)).not.toBeNull()
    repository.deleteCandidateDatabaseData(documentId, preview.confirmationHash)
    expect(repository.getCandidateReview(documentId)).toBeNull()
    expect(repository.listCandidateReviews()).toHaveLength(0)
  })
})
