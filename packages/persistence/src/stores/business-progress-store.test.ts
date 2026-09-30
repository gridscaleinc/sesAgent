// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProgressCommand } from '@shared'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { emptySchedule, seedDraftCase, seedImportedPerson } from './store-test-fixtures-business'

describe.skipIf(!nativeSqliteAvailable)('BusinessProgressStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  let documentId: string
  let reviewId: string
  beforeEach(() => {
    handle = openTestRepository()
    documentId = seedImportedPerson(handle.repository).documentId
    reviewId = seedDraftCase(handle.repository).reviewId
  })
  afterEach(() => handle.dispose())

  const current = () => handle.repository.listBusinessFollowUps().find((row) => row.reviewId === reviewId)!
  const advance = (command: ProgressCommand, mutationId = randomUUID()) =>
    handle.repository.advanceBusinessProgress(
      { documentId, reviewId, expectedRevision: current().revision, mutationId, ...command },
      'test-hr'
    )

  it('begins one follow-up per person and case, idempotently, and it survives reopen', () => {
    const pair = { documentId, reviewId, pendingConditions: ['通勤条件を確認'] }
    const revisionBefore = handle.repository.getLocalDataRevision().revision
    expect(handle.repository.beginBusinessProgress([pair], 'test-hr')).toHaveLength(1)
    expect(handle.repository.beginBusinessProgress([pair], 'test-hr')).toHaveLength(1)
    expect(handle.repository.listBusinessFollowUps()).toHaveLength(1)
    expect(handle.repository.getLocalDataRevision().revision).toBeGreaterThan(revisionBefore)

    const scheduled = advance({ action: 'schedule', schedule: emptySchedule(1, '2026-09-08T01:00:00.000Z') })
    expect(scheduled.progress?.stage).toBe('scheduled')
    expect(scheduled.progress?.rounds).toHaveLength(1)
    const snapshot = handle.repository.listBusinessFollowUps()
    expect(handle.reopen().listBusinessFollowUps()).toEqual(snapshot)
  })

  it('treats a redelivered mutation as idempotent and rejects stale revisions and skipped rounds', () => {
    handle.repository.beginBusinessProgress([{ documentId, reviewId, pendingConditions: [] }], 'test-hr')
    const input = {
      documentId,
      reviewId,
      expectedRevision: current().revision,
      mutationId: randomUUID(),
      action: 'schedule' as const,
      schedule: emptySchedule(1, '2026-09-08T01:00:00.000Z')
    }
    const first = handle.repository.advanceBusinessProgress(input, 'test-hr')
    expect(handle.repository.advanceBusinessProgress(input, 'test-hr').revision).toBe(first.revision)
    expect(current().revision).toBe(first.revision)

    expect(() =>
      handle.repository.advanceBusinessProgress(
        {
          documentId,
          reviewId,
          expectedRevision: 0,
          mutationId: randomUUID(),
          action: 'note',
          note: 'stale'
        },
        'test-hr'
      )
    ).toThrow(/更新/)
    expect(() => advance({ action: 'schedule', schedule: emptySchedule(3, '2026-09-09T01:00:00.000Z') })).toThrow(/当前轮次/)
  })

  it('refuses to start work before both sides agreed to the entry terms', () => {
    handle.repository.beginBusinessProgress([{ documentId, reviewId, pendingConditions: [] }], 'test-hr')
    advance({ action: 'schedule', schedule: emptySchedule(1, '2026-09-08T01:00:00.000Z') })
    const entry = advance({
      action: 'feedback',
      roundNumber: 1,
      notes: '一面通过，客户希望安排进场',
      result: 'passed',
      next: 'entry',
      unresolved: []
    })
    expect(entry.progress?.stage).toBe('entry')
    expect(() => advance({ action: 'start', actualDate: '2026-09-10' })).toThrow(/双方条件/)
  })

  it('captures progress mail once, ignores ordinary case listings and attaches only on explicit selection', () => {
    const mail = {
      accountEmail: 'hr@example.com',
      messageId: 'progress-1',
      threadId: 't-1',
      subject: '面談日程確定',
      body: '第三案件面談の日時確定は9月15日14時です。',
      receivedAt: '2026-09-10T06:00:00.000Z'
    }
    expect(handle.repository.captureBusinessProgressMail(mail)).toBe(true)
    expect(handle.repository.captureBusinessProgressMail(mail)).toBe(true)
    expect(handle.repository.listBusinessProgressMail()).toHaveLength(1)
    expect(
      handle.repository.captureBusinessProgressMail({
        ...mail,
        messageId: 'listing',
        subject: 'Java案件募集',
        body: '面談1回、入場9月、Java経験3年'
      })
    ).toBe(false)
    const inbox = handle.repository.listBusinessProgressMail()[0]!
    expect(inbox.followUpId).toBeNull()

    handle.repository.beginBusinessProgress([{ documentId, reviewId, pendingConditions: [] }], 'test-hr')
    handle.repository.updateBusinessProgressMail({ id: inbox.id, followUpId: current().id })
    handle.repository.advanceBusinessProgress(
      {
        documentId,
        reviewId,
        expectedRevision: current().revision,
        mutationId: randomUUID(),
        sourceMessageId: inbox.id,
        action: 'schedule',
        schedule: emptySchedule(1, '2026-09-15T05:00:00.000Z')
      },
      'test-hr'
    )
    expect(handle.repository.listBusinessProgressMail()[0]!.state).toBe('applied')
  })

  it('deletes a follow-up only at its current revision and removes its rounds', () => {
    handle.repository.beginBusinessProgress([{ documentId, reviewId, pendingConditions: [] }], 'test-hr')
    const scheduled = advance({ action: 'schedule', schedule: emptySchedule(1, '2026-09-08T01:00:00.000Z') })
    const roundIds = scheduled.progress!.rounds.map((round) => round.id)
    expect(() => handle.repository.deleteBusinessFollowUp({ followUpId: scheduled.id, expectedRevision: scheduled.revision + 1 })).toThrow(
      /已更新/
    )
    expect(handle.repository.deleteBusinessFollowUp({ followUpId: scheduled.id, expectedRevision: scheduled.revision })).toEqual({
      deletedId: scheduled.id,
      rounds: roundIds.length,
      mails: 0
    })
    expect(handle.repository.listBusinessFollowUps()).toHaveLength(0)
    expect(handle.repository.listCandidateInterviews().some((round) => roundIds.includes(round.id))).toBe(false)
    expect(handle.repository.getCandidateReview(documentId)).not.toBeNull()
  })
  it('records a recommendation as the first stage and never moves a started follow-up backwards', () => {
    const recommend = () =>
      handle.repository.advanceBusinessProgress(
        {
          documentId,
          reviewId,
          expectedRevision: handle.repository.listBusinessFollowUps().find((row) => row.reviewId === reviewId)?.revision ?? 0,
          mutationId: randomUUID(),
          action: 'recommend'
        },
        'test-hr'
      )
    const recommended = recommend()
    expect(recommended.progress?.stage).toBe('recommended')
    expect(recommended.progress?.recommendedAt).toBeTruthy()
    expect(recommended.events.at(-1)).toMatchObject({ action: 'recommend', stage: 'recommended' })
    // Starting the follow-up afterwards keeps the recommendation; coordinating moves it forward.
    expect(handle.repository.beginBusinessProgress([{ documentId, reviewId }], 'test-hr')[0]!.progress?.stage).toBe('recommended')
    const coordinating = advance({ action: 'coordinate', candidateAvailability: '平日夜', clientAvailability: '', pendingConditions: [] })
    expect(coordinating.progress?.stage).toBe('coordinating')
    expect(coordinating.progress?.recommendedAt).toBe(recommended.progress?.recommendedAt)
    const again = recommend()
    expect(again.revision).toBe(coordinating.revision)
    expect(again.progress?.stage).toBe('coordinating')
    expect(handle.reopen().listBusinessFollowUps()[0]!.progress?.stage).toBe('coordinating')
  })

  it('upgrades a legacy follow-up without progress to recommended, keeping its history', () => {
    const legacy = handle.repository.saveBusinessFollowUp(
      { documentId, reviewId, expectedRevision: 0, status: 'contacted', note: '电话联系过', nextStep: '' },
      'test-hr'
    )
    const recommended = handle.repository.advanceBusinessProgress(
      { documentId, reviewId, expectedRevision: legacy.revision, mutationId: randomUUID(), action: 'recommend' },
      'test-hr'
    )
    expect(recommended.id).toBe(legacy.id)
    expect(recommended.progress?.stage).toBe('recommended')
    expect(recommended.events.map((event) => event.note)).toContain('电话联系过')
  })
})
