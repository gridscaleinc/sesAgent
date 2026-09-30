// @vitest-environment node
import { dirname } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EncryptedApplicationRepository } from '../index'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { createConfirmedManualJobCase } from './store-test-fixtures-mail'
import { importTestCandidate } from './store-test-fixtures-pipeline'

const documentId = '559dcb5d-dcf0-4c11-a12d-698cfef220e6'

/** Passing a recruiting interview is what writes the legacy talent_pool_memberships row. */
function passRecruitingInterview(repository: EncryptedApplicationRepository): void {
  const interview = repository.saveCandidateInterviewSchedule(
    {
      sourceDocumentId: documentId,
      scheduledAt: '2026-07-18T02:00:00.000Z',
      durationMinutes: 30,
      meetingMethod: 'phone',
      interviewer: '検証担当者'
    },
    '検証担当者',
    new Date('2026-07-17T00:04:00.000Z')
  )
  repository.saveCandidateInterviewPreparation(
    {
      interviewId: interview.id,
      questions: [{ id: 'q1', text: '確認事項', source: 'standard', sourceLabel: '標準', selected: true }]
    },
    '検証担当者',
    new Date('2026-07-17T00:04:01.000Z')
  )
  repository.saveCandidateInterviewNotes(
    {
      interviewId: interview.id,
      sourceDocumentId: documentId,
      interviewNotes: '問題なし',
      stage: 'awaiting-decision'
    },
    '検証担当者',
    new Date('2026-07-17T00:04:02.000Z')
  )
  repository.recordCandidateInterviewDecision(
    {
      interviewId: interview.id,
      sourceDocumentId: documentId,
      decision: 'passed',
      decisionReason: '基準を満たす'
    },
    '検証担当者',
    new Date('2026-07-17T00:04:03.000Z')
  )
}

describe.skipIf(!nativeSqliteAvailable)('CandidateEvaluationStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  let jobCaseId: string
  let profileId: string
  beforeEach(() => {
    handle = openTestRepository()
    const candidate = importTestCandidate(handle.repository, { documentId, vaultDirectory: dirname(handle.path) })
    profileId = candidate.review.profile!.id
    jobCaseId = createConfirmedManualJobCase(handle.repository).jobCase.id
  })
  afterEach(() => handle.dispose())

  it('authors an evaluation draft case and builds a privacy-clean benchmark from it', () => {
    const { repository } = handle
    passRecruitingInterview(repository)
    expect(repository.getCandidateEvaluationDraft()).toBeNull()
    let draft = repository.createCandidateEvaluationDraft({ name: 'Store Test Pilot' }, new Date('2026-07-17T00:05:00.000Z'))
    expect(draft).toMatchObject({ name: 'Store Test Pilot', caseCount: 0 })
    draft = repository.saveCandidateEvaluationDraftCase(
      {
        draftId: draft.id,
        expectedRevision: draft.revision,
        jobCaseId,
        relevantCandidateProfileIds: [profileId],
        expectedProjectEvidenceProfileIds: [profileId],
        poolReviewed: true
      },
      'store-test-user',
      '検証担当者',
      new Date('2026-07-17T00:05:01.000Z')
    )
    expect(draft).toMatchObject({ caseCount: 1, readyCaseCount: 1 })
    expect(draft.cases[0]?.relevantCandidates[0]?.expectedProjectEvidence).toBe(true)
    // The query derived from the case never carries the redacted contact or its placeholder.
    expect(draft.cases[0]?.query).not.toMatch(/<PERSON_NAME|<PHONE|佐藤秘密担当|080-8765-4321/)

    expect(handle.reopen().getCandidateEvaluationDraft()?.id).toBe(draft.id)
    const benchmark = handle.repository.buildCandidateEvaluationBenchmark(draft.id, draft.revision, new Date('2026-07-17T00:05:02.000Z'))
    expect(benchmark.cases).toHaveLength(1)
    expect(benchmark.privacy).toMatchObject({ directIdentifiersRemoved: true, rawResumeIncluded: false, rawMailIncluded: false })
    expect(JSON.stringify(benchmark)).not.toMatch(/佐藤秘密担当|山田検証用|080-8765-4321|090-1234-5678/)
  })

  // Evaluation drafts use the same talent-pool eligibility as matching.
  it('treats an eligible imported candidate as ready without a recruiting interview', () => {
    const { repository } = handle
    expect(repository.getCandidateReview(documentId)?.talentPoolStatus).toBe('eligible')
    const draft = repository.createCandidateEvaluationDraft({ name: 'Store Test Pilot' })
    const saved = repository.saveCandidateEvaluationDraftCase(
      {
        draftId: draft.id,
        expectedRevision: draft.revision,
        jobCaseId,
        relevantCandidateProfileIds: [profileId],
        expectedProjectEvidenceProfileIds: [],
        poolReviewed: true
      },
      'store-test-user',
      '検証担当者'
    )
    expect(saved.cases[0]?.status).toBe('ready')
  })

  it('rejects stale draft revisions, unready drafts and unknown candidates', () => {
    const { repository } = handle
    passRecruitingInterview(repository)
    const draft = repository.createCandidateEvaluationDraft({ name: 'Store Test Pilot' })
    const input = {
      draftId: draft.id,
      expectedRevision: draft.revision,
      jobCaseId,
      relevantCandidateProfileIds: [profileId],
      expectedProjectEvidenceProfileIds: [],
      poolReviewed: true as const
    }
    const saved = repository.saveCandidateEvaluationDraftCase(input, 'store-test-user', '検証担当者')
    expect(saved.revision).toBeGreaterThan(draft.revision)
    expect(() => repository.saveCandidateEvaluationDraftCase(input, 'store-test-user', '検証担当者')).toThrow(/更新されました/)
    expect(() => repository.buildCandidateEvaluationBenchmark(draft.id, draft.revision)).toThrow()
    expect(() =>
      repository.saveCandidateEvaluationDraftCase(
        {
          ...input,
          expectedRevision: saved.revision,
          relevantCandidateProfileIds: ['ffffffff-ffff-4fff-8fff-ffffffffffff']
        },
        'store-test-user',
        '検証担当者'
      )
    ).toThrow()
  })
})
