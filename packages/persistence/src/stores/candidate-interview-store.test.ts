// @vitest-environment node
import { dirname } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { importTestCandidate } from './store-test-fixtures-pipeline'

const documentId = '559dcb5d-dcf0-4c11-a12d-698cfef220e6'
const t = (seconds: number) => new Date(Date.UTC(2026, 6, 17, 1, 0, seconds))

describe.skipIf(!nativeSqliteAvailable)('CandidateInterviewStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
    importTestCandidate(handle.repository, { documentId, vaultDirectory: dirname(handle.path) })
  })
  afterEach(() => handle.dispose())

  const schedule = {
    sourceDocumentId: documentId,
    scheduledAt: '2026-07-18T02:00:00.000Z',
    durationMinutes: 30,
    meetingMethod: 'phone' as const,
    interviewer: '検証担当者'
  }

  it('walks a recruiting interview from schedule to a next-round decision and opens round 2', () => {
    const { repository } = handle
    const scheduled = repository.saveCandidateInterviewSchedule(schedule, '検証担当者', t(1))
    expect(scheduled).toMatchObject({ stage: 'scheduled', roundNumber: 1, kind: 'recruiting', cloudEligible: false })
    // Rescheduling before it starts updates the same session.
    const rescheduled = repository.saveCandidateInterviewSchedule(
      { ...schedule, scheduledAt: '2026-07-19T02:00:00.000Z' },
      '検証担当者',
      t(2)
    )
    expect(rescheduled.id).toBe(scheduled.id)
    expect(rescheduled.scheduledAt).toBe('2026-07-19T02:00:00.000Z')

    const prepared = repository.saveCandidateInterviewPreparation(
      {
        interviewId: scheduled.id,
        questions: [{ id: 'q1', text: 'AWS 移行の役割を確認します。', source: 'standard', sourceLabel: '標準', selected: true }]
      },
      '検証担当者',
      t(3)
    )
    expect(prepared.stage).toBe('prepared')
    expect(prepared.questionPlan.map((question) => question.text)).toEqual(['AWS 移行の役割を確認します。'])

    const noted = repository.saveCandidateInterviewNotes(
      {
        interviewId: scheduled.id,
        sourceDocumentId: documentId,
        interviewNotes: '設計経験は十分。',
        stage: 'awaiting-decision'
      },
      '検証担当者',
      t(4)
    )
    expect(noted).toMatchObject({ stage: 'awaiting-decision', interviewNotes: '設計経験は十分。' })

    const decided = repository.recordCandidateInterviewDecision(
      {
        interviewId: scheduled.id,
        sourceDocumentId: documentId,
        decision: 'next-round',
        decisionReason: '技術面接を追加する。'
      },
      '検証担当者',
      t(5)
    )
    expect(decided).toMatchObject({ decision: 'next-round', stage: 'on-hold', decidedBy: '検証担当者' })

    const round2 = repository.createCandidateInterviewRound(
      { sourceDocumentId: documentId, parentInterviewId: scheduled.id },
      '検証担当者',
      t(6)
    )
    expect(round2).toMatchObject({ roundNumber: 2, parentInterviewId: scheduled.id, decision: null })

    expect(
      handle
        .reopen()
        .listCandidateInterviews()
        .map((interview) => interview.roundNumber)
        .sort()
    ).toEqual([1, 2])
  })

  const question = { id: 'q1', text: '確認事項', source: 'standard' as const, sourceLabel: '標準', selected: true }

  // A repeated request for the same parent (double click / IPC retry) must not create round 3, 4, ...
  it('returns the existing follow-up round when the same parent is asked twice', () => {
    const { repository } = handle
    const scheduled = repository.saveCandidateInterviewSchedule(schedule, '検証担当者', t(1))
    repository.saveCandidateInterviewPreparation({ interviewId: scheduled.id, questions: [question] }, '検証担当者', t(2))
    repository.saveCandidateInterviewNotes(
      {
        interviewId: scheduled.id,
        sourceDocumentId: documentId,
        interviewNotes: 'x',
        stage: 'awaiting-decision'
      },
      '検証担当者',
      t(3)
    )
    repository.recordCandidateInterviewDecision(
      {
        interviewId: scheduled.id,
        sourceDocumentId: documentId,
        decision: 'next-round',
        decisionReason: '追加面接'
      },
      '検証担当者',
      t(4)
    )
    const input = { sourceDocumentId: documentId, parentInterviewId: scheduled.id }
    const first = repository.createCandidateInterviewRound(input, '検証担当者', t(5))
    const second = repository.createCandidateInterviewRound(input, '検証担当者', t(6))
    expect(second.id).toBe(first.id)
    expect(repository.listCandidateInterviews()).toHaveLength(2)
  })

  it('enforces the interview state machine', () => {
    const { repository } = handle
    expect(() =>
      repository.saveCandidateInterviewSchedule({ ...schedule, sourceDocumentId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }, '検証担当者')
    ).toThrow(/not found/)
    const scheduled = repository.saveCandidateInterviewSchedule(schedule, '検証担当者', t(1))
    // A decision needs a completed record first.
    expect(() =>
      repository.recordCandidateInterviewDecision(
        {
          interviewId: scheduled.id,
          sourceDocumentId: documentId,
          decision: 'passed',
          decisionReason: 'ok'
        },
        '検証担当者'
      )
    ).toThrow(/Complete the interview record/)
    // Notes only once prepared / in progress.
    expect(() =>
      repository.saveCandidateInterviewNotes(
        {
          interviewId: scheduled.id,
          sourceDocumentId: documentId,
          interviewNotes: 'x',
          stage: 'awaiting-decision'
        },
        '検証担当者'
      )
    ).toThrow(/in progress/)
    // A next round needs a next-round decision on the parent.
    expect(() =>
      repository.createCandidateInterviewRound({ sourceDocumentId: documentId, parentInterviewId: scheduled.id }, '検証担当者')
    ).toThrow(/next-round decision/)

    repository.saveCandidateInterviewPreparation({ interviewId: scheduled.id, questions: [question] }, '検証担当者', t(2))
    repository.saveCandidateInterviewNotes(
      {
        interviewId: scheduled.id,
        sourceDocumentId: documentId,
        interviewNotes: 'x',
        stage: 'awaiting-decision'
      },
      '検証担当者',
      t(3)
    )
    // Schedule is locked once the interview is awaiting a decision.
    expect(() => repository.saveCandidateInterviewSchedule(schedule, '検証担当者')).toThrow(/locked/)
    repository.recordCandidateInterviewDecision(
      {
        interviewId: scheduled.id,
        sourceDocumentId: documentId,
        decision: 'failed',
        decisionReason: '基準未達'
      },
      '検証担当者',
      t(4)
    )
    expect(() => repository.saveCandidateInterviewPreparation({ interviewId: scheduled.id, questions: [question] }, '検証担当者')).toThrow(
      /completed interview/
    )
    expect(() => repository.saveCandidateInterviewSchedule(schedule, '検証担当者')).toThrow(/decision is already recorded/)
    expect(repository.getCandidateReview(documentId)?.recruitingStatus).toBe('rejected')
  })
})
