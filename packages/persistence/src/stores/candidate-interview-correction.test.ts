// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { seedImportedPerson } from './store-test-fixtures-business'

describe.skipIf(!nativeSqliteAvailable)('recruiting interview decisions via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  let documentId: string
  beforeEach(() => {
    handle = openTestRepository()
    documentId = seedImportedPerson(handle.repository).documentId
  })
  afterEach(() => handle.dispose())

  const book = (interviewId?: string) =>
    handle.repository.saveCandidateInterviewSchedule(
      {
        ...(interviewId ? { interviewId } : {}),
        sourceDocumentId: documentId,
        kind: 'recruiting',
        scheduledAt: '2026-10-08T01:00:00.000Z',
        durationMinutes: 60,
        meetingMethod: 'phone',
        interviewer: 'HR'
      },
      'HR'
    )
  const prepare = (interviewId: string) =>
    handle.repository.saveCandidateInterviewPreparation(
      {
        interviewId,
        questions: [{ id: 'q1', text: '请介绍最近的项目。', source: 'standard', sourceLabel: null, selected: true }]
      },
      'HR'
    )
  const decide = (interviewId: string) => {
    handle.repository.saveCandidateInterviewNotes(
      { interviewId, sourceDocumentId: documentId, interviewNotes: '技术基础扎实。', stage: 'awaiting-decision' },
      'HR'
    )
    return handle.repository.recordCandidateInterviewDecision(
      { interviewId, sourceDocumentId: documentId, decision: 'passed', decisionReason: '基础扎实' },
      'HR'
    )
  }

  it('corrects a decision recorded by mistake, keeping the earlier one in the reason', () => {
    const interview = book()
    prepare(interview.id)
    handle.repository.saveCandidateInterviewNotes(
      { interviewId: interview.id, sourceDocumentId: documentId, interviewNotes: '', stage: 'interviewing' },
      'HR'
    )
    // Opened but nothing recorded (the candidate did not join): the time can still move.
    expect(book(interview.id).stage).toBe('scheduled')
    prepare(interview.id)
    decide(interview.id)
    expect(() =>
      handle.repository.correctCandidateInterviewDecision(
        { interviewId: interview.id, sourceDocumentId: documentId, decision: 'passed', decisionReason: '同上', correctionReason: '误操作' },
        'HR'
      )
    ).toThrow(/相同/)
    const corrected = handle.repository.correctCandidateInterviewDecision(
      {
        interviewId: interview.id,
        sourceDocumentId: documentId,
        decision: 'no-show',
        decisionReason: '候选人未出席',
        correctionReason: '点错了结论'
      },
      'HR'
    )
    expect(corrected.decision).toBe('no-show')
    expect(corrected.decisionReason).toContain('原结论')
    expect(corrected.decisionReason).toContain('点错了结论')
    expect(handle.repository.getCandidateReview(documentId)?.recruitingStatus).toBe('no-show')
    // 未到场 is the one result that can be booked again for the same round.
    expect(book(interview.id)).toMatchObject({ roundNumber: 1, decision: null, stage: 'scheduled' })
    expect(handle.repository.getCandidateReview(documentId)?.recruitingStatus).toBe('recruiting')
  })

  it('refuses to correct a round a later round already follows from', () => {
    const interview = book()
    prepare(interview.id)
    handle.repository.saveCandidateInterviewNotes(
      { interviewId: interview.id, sourceDocumentId: documentId, interviewNotes: '需要复试。', stage: 'awaiting-decision' },
      'HR'
    )
    handle.repository.recordCandidateInterviewDecision(
      { interviewId: interview.id, sourceDocumentId: documentId, decision: 'next-round', decisionReason: '需要复试' },
      'HR'
    )
    handle.repository.createCandidateInterviewRound({ sourceDocumentId: documentId, parentInterviewId: interview.id }, 'HR')
    expect(() =>
      handle.repository.correctCandidateInterviewDecision(
        { interviewId: interview.id, sourceDocumentId: documentId, decision: 'failed', decisionReason: '不合适', correctionReason: '改判' },
        'HR'
      )
    ).toThrow(/下一轮/)
  })

  it('closes a round that never took place with 撤回 or 未到场, and books a 未到场 again for the same round', () => {
    const interview = book()
    // 通过 still needs the interview record.
    expect(() =>
      handle.repository.recordCandidateInterviewDecision(
        { interviewId: interview.id, sourceDocumentId: documentId, decision: 'passed', decisionReason: '直接通过' },
        'HR'
      )
    ).toThrow(/面试记录/)
    const noShow = handle.repository.recordCandidateInterviewDecision(
      { interviewId: interview.id, sourceDocumentId: documentId, decision: 'no-show', decisionReason: '当天未出现' },
      'HR'
    )
    expect(noShow.decision).toBe('no-show')
    const again = handle.repository.saveCandidateInterviewSchedule(
      {
        interviewId: interview.id,
        sourceDocumentId: documentId,
        kind: 'recruiting',
        scheduledAt: '2026-10-10T01:00:00.000Z',
        durationMinutes: 60,
        meetingMethod: 'phone',
        interviewer: 'HR'
      },
      'HR'
    )
    expect(again).toMatchObject({ id: interview.id, roundNumber: 1, stage: 'scheduled', decision: null })
    const withdrawn = handle.repository.recordCandidateInterviewDecision(
      { interviewId: interview.id, sourceDocumentId: documentId, decision: 'withdrawn', decisionReason: '本人辞退' },
      'HR'
    )
    expect(withdrawn.decision).toBe('withdrawn')
    // A decided round other than 未到场 is not rebooked; that is said before any time conflict.
    expect(() => book(interview.id)).toThrow(/已经记录结论/)
  })

  it('removes a next round created by mistake so the round before can be corrected', () => {
    const first = book()
    prepare(first.id)
    handle.repository.saveCandidateInterviewNotes(
      { interviewId: first.id, sourceDocumentId: documentId, interviewNotes: '需要再确认。', stage: 'awaiting-decision' },
      'HR'
    )
    handle.repository.recordCandidateInterviewDecision(
      { interviewId: first.id, sourceDocumentId: documentId, decision: 'next-round', decisionReason: '误选复试' },
      'HR'
    )
    const next = handle.repository.createCandidateInterviewRound({ sourceDocumentId: documentId, parentInterviewId: first.id }, 'HR')
    handle.repository.deleteUnbookedCandidateInterviewRound({ interviewId: next.id, sourceDocumentId: documentId })
    expect(handle.repository.listCandidateInterviews().some((item) => item.id === next.id)).toBe(false)
    expect(
      handle.repository.correctCandidateInterviewDecision(
        { interviewId: first.id, sourceDocumentId: documentId, decision: 'failed', decisionReason: '不符合', correctionReason: '误选复试' },
        'HR'
      ).decision
    ).toBe('failed')
    // A booked round is not removed this way.
    expect(() => handle.repository.deleteUnbookedCandidateInterviewRound({ interviewId: first.id, sourceDocumentId: documentId })).toThrow(
      /尚未预约/
    )
  })
})
