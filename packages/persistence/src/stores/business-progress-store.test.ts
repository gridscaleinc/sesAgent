// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextBusinessRound, type ProgressCommand } from '@shared'
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

  it('records 退场 with its date, makes the person available again and lets a mistaken 退场 be undone', () => {
    handle.repository.beginBusinessProgress([{ documentId, reviewId, pendingConditions: [] }], 'test-hr')
    advance({ action: 'schedule', schedule: emptySchedule(1, '2026-09-08T01:00:00.000Z') })
    advance({ action: 'feedback', roundNumber: 1, notes: '一面通过', result: 'passed', next: 'entry', unresolved: [] })
    advance({ action: 'entry', entry: { ...current().progress!.entry, candidateAccepted: true, termsAgreed: true } })
    advance({ action: 'start', actualDate: '2026-09-10' })
    const status = () => handle.repository.getPersonnelWorkspace().states.find((row) => row.documentId === documentId)?.status
    expect(status()).toBe('assigned')
    // The case cannot be deleted while someone is in place through it.
    const preview = handle.repository.previewJobCaseDeletion(reviewId)
    expect(preview.counts.activePlacements).toBe(1)
    expect(() =>
      handle.repository.deleteJobCaseDatabaseData({ reviewId, confirmationHash: preview.confirmationHash, confirmationText: '削除' })
    ).toThrow(/已进场/)
    expect(() => advance({ action: 'close', reason: '项目结束' })).toThrow(/记录退场/)
    expect(() => advance({ action: 'leave', leftDate: '2026-09-09', reason: '' })).toThrow(/早于实际到岗/)
    expect(() => advance({ action: 'leave', leftDate: '2999-01-01', reason: '' })).toThrow(/今天或过去/)
    const left = advance({ action: 'leave', leftDate: '2026-09-30', reason: '契约期满' })
    expect(left.progress).toMatchObject({ stage: 'ended', entry: { actualDate: '2026-09-10', leftDate: '2026-09-30' } })
    expect(left.events.at(-1)?.note).toContain('2026-09-30')
    expect(status()).toBe('available')
    // A left placement is history: it cannot be deleted, paused or arranged again.
    expect(() => handle.repository.deleteBusinessFollowUp({ followUpId: left.id, expectedRevision: left.revision })).toThrow(/历史/)
    expect(() => advance({ action: 'pause', reason: 'x' })).toThrow()
    const undone = advance({ action: 'undo-leave', reason: '误操作' })
    expect(undone.progress).toMatchObject({ stage: 'started', entry: { leftDate: null } })
    expect(status()).toBe('assigned')
    advance({ action: 'leave', leftDate: '2026-09-30', reason: '' })
    expect(handle.repository.previewJobCaseDeletion(reviewId).counts.activePlacements).toBeUndefined()
  })

  it('pauses the person’s other follow-ups when HR chooses so at the start, and blocks interviews for 暂停营业', () => {
    const other = seedDraftCase(handle.repository, 'Go 案件', '必須スキル：Go').reviewId
    handle.repository.beginBusinessProgress(
      [
        { documentId, reviewId, pendingConditions: [] },
        { documentId, reviewId: other, pendingConditions: [] }
      ],
      'test-hr'
    )
    advance({ action: 'schedule', schedule: emptySchedule(1, '2026-09-08T01:00:00.000Z') })
    advance({ action: 'feedback', roundNumber: 1, notes: '一面通过', result: 'passed', next: 'entry', unresolved: [] })
    advance({ action: 'entry', entry: { ...current().progress!.entry, candidateAccepted: true, termsAgreed: true } })
    advance({ action: 'start', actualDate: '2026-09-10', pauseOthers: true })
    const elsewhere = () => handle.repository.listBusinessFollowUps().find((row) => row.reviewId === other)!
    expect(elsewhere().progress?.stage).toBe('paused')
    expect(elsewhere().events.at(-1)?.note).toContain('进场')
    const resume = () =>
      handle.repository.advanceBusinessProgress(
        { documentId, reviewId: other, expectedRevision: elsewhere().revision, mutationId: randomUUID(), action: 'resume' },
        'test-hr'
      )
    // HR may still decide to continue another case while the person is in place.
    expect(resume().progress?.stage).toBe('coordinating')
    const person = handle.repository.getCandidateReview(documentId)!
    handle.repository.setCandidateBusinessState(
      {
        documentId,
        profileVersion: person.profile?.version ?? 0,
        reviewRevision: person.reviewRevision,
        status: 'paused',
        confirmed: true
      },
      'test-hr'
    )
    expect(() =>
      handle.repository.advanceBusinessProgress(
        {
          documentId,
          reviewId: other,
          expectedRevision: elsewhere().revision,
          mutationId: randomUUID(),
          action: 'schedule',
          schedule: emptySchedule(1, '2026-10-08T01:00:00.000Z')
        },
        'test-hr'
      )
    ).toThrow(/暂停营业/)
  })

  it('keeps a left placement as history, resumes what a start paused when it is undone, and keeps a manual 暂停营业', () => {
    const other = seedDraftCase(handle.repository, 'Go 案件', '必須スキル：Go').reviewId
    handle.repository.beginBusinessProgress(
      [
        { documentId, reviewId, pendingConditions: [] },
        { documentId, reviewId: other, pendingConditions: [] }
      ],
      'test-hr'
    )
    advance({ action: 'schedule', schedule: emptySchedule(1, '2026-09-08T01:00:00.000Z') })
    advance({ action: 'feedback', roundNumber: 1, notes: '一面通过', result: 'passed', next: 'entry', unresolved: [] })
    advance({ action: 'entry', entry: { ...current().progress!.entry, candidateAccepted: true, termsAgreed: true } })
    const elsewhere = () => handle.repository.listBusinessFollowUps().find((row) => row.reviewId === other)!
    advance({ action: 'start', actualDate: '2026-09-10', pauseOthers: true })
    expect(elsewhere().progress).toMatchObject({ stage: 'paused', pausedByPlacement: current().id })
    // Undoing the start resumes what it paused.
    advance({ action: 'undo-start', reason: '误确认' })
    expect(elsewhere().progress?.stage).toBe('coordinating')
    expect(elsewhere().progress?.pausedByPlacement).toBeUndefined()
    advance({ action: 'start', actualDate: '2026-09-10' })
    const left = advance({ action: 'leave', leftDate: '2026-09-30', reason: '' })
    expect(left.status).toBe('closed')
    // A left placement cannot be rebooked back into interviews.
    expect(() => advance({ action: 'rebook', schedule: emptySchedule(1, '2026-10-08T01:00:00.000Z'), reason: '误操作' })).toThrow()
    expect(current().progress?.stage).toBe('ended')
    // Undo 退场 while HR had set 暂停营业: the manual status stays.
    const person = handle.repository.getCandidateReview(documentId)!
    handle.repository.setCandidateBusinessState(
      {
        documentId,
        profileVersion: person.profile?.version ?? 0,
        reviewRevision: person.reviewRevision,
        status: 'paused',
        confirmed: true
      },
      'test-hr'
    )
    advance({ action: 'undo-leave', reason: '误操作' })
    advance({ action: 'leave', leftDate: '2026-09-30', reason: '' })
    expect(handle.repository.getPersonnelWorkspace().states.find((row) => row.documentId === documentId)?.status).toBe('paused')
  })

  it('warns about an interview overlapping another for the same person unless HR saves anyway', () => {
    const other = seedDraftCase(handle.repository, 'Go 案件', '必須スキル：Go').reviewId
    handle.repository.beginBusinessProgress(
      [
        { documentId, reviewId, pendingConditions: [] },
        { documentId, reviewId: other, pendingConditions: [] }
      ],
      'test-hr'
    )
    advance({ action: 'schedule', schedule: emptySchedule(1, '2026-10-08T01:00:00.000Z') })
    const elsewhere = () => handle.repository.listBusinessFollowUps().find((row) => row.reviewId === other)!
    const book = (allowConflict?: boolean) =>
      handle.repository.advanceBusinessProgress(
        {
          documentId,
          reviewId: other,
          expectedRevision: elsewhere().revision,
          mutationId: randomUUID(),
          action: 'schedule',
          schedule: emptySchedule(1, '2026-10-08T01:30:00.000Z'),
          ...(allowConflict ? { allowConflict } : {})
        },
        'test-hr'
      )
    expect(() => book()).toThrow(/时间冲突/)
    expect(book(true).progress?.stage).toBe('scheduled')
  })

  it('names who cannot start in a batch, and keeps a 暂停营业 from undo-leave for the next 退场', () => {
    const person = handle.repository.getCandidateReview(documentId)!
    const setStatus = (status: 'available' | 'paused') =>
      handle.repository.setCandidateBusinessState(
        { documentId, profileVersion: person.profile?.version ?? 0, reviewRevision: person.reviewRevision, status, confirmed: true },
        'test-hr'
      )
    setStatus('paused')
    expect(() => handle.repository.beginBusinessProgress([{ documentId, reviewId, pendingConditions: [] }], 'test-hr')).toThrow(/暂停营业/)
    setStatus('available')
    handle.repository.beginBusinessProgress([{ documentId, reviewId, pendingConditions: [] }], 'test-hr')
    advance({ action: 'schedule', schedule: emptySchedule(1, '2026-09-08T01:00:00.000Z') })
    advance({ action: 'feedback', roundNumber: 1, notes: '一面通过', result: 'passed', next: 'entry', unresolved: [] })
    advance({ action: 'entry', entry: { ...current().progress!.entry, candidateAccepted: true, termsAgreed: true } })
    advance({ action: 'start', actualDate: '2026-09-10' })
    advance({ action: 'leave', leftDate: '2026-09-30', reason: '' })
    setStatus('paused')
    advance({ action: 'undo-leave', reason: '误操作' })
    const status = () => handle.repository.getPersonnelWorkspace().states.find((row) => row.documentId === documentId)?.status
    // Back in place means 已进场 — never 暂停营业 while placed — and the pause returns at the next 退场.
    expect(status()).toBe('assigned')
    advance({ action: 'leave', leftDate: '2026-09-30', reason: '' })
    expect(status()).toBe('paused')
  })

  it('forgets an old 暂停营业 once HR made the person available again, and keeps a 近期可入场 set while placed', () => {
    const person = handle.repository.getCandidateReview(documentId)!
    const setStatus = (status: 'available' | 'paused' | 'soon') =>
      handle.repository.setCandidateBusinessState(
        { documentId, profileVersion: person.profile?.version ?? 0, reviewRevision: person.reviewRevision, status, confirmed: true },
        'test-hr'
      )
    const status = () => handle.repository.getPersonnelWorkspace().states.find((row) => row.documentId === documentId)?.status
    handle.repository.beginBusinessProgress([{ documentId, reviewId, pendingConditions: [] }], 'test-hr')
    advance({ action: 'schedule', schedule: emptySchedule(1, '2026-09-08T01:00:00.000Z') })
    advance({ action: 'feedback', roundNumber: 1, notes: '一面通过', result: 'passed', next: 'entry', unresolved: [] })
    advance({ action: 'entry', entry: { ...current().progress!.entry, candidateAccepted: true, termsAgreed: true } })
    advance({ action: 'start', actualDate: '2026-09-10' })
    advance({ action: 'leave', leftDate: '2026-09-30', reason: '' })
    setStatus('paused')
    advance({ action: 'undo-leave', reason: '误操作' })
    advance({ action: 'leave', leftDate: '2026-09-30', reason: '' })
    expect(status()).toBe('paused')
    setStatus('available')
    advance({ action: 'undo-leave', reason: '误操作' })
    advance({ action: 'leave', leftDate: '2026-09-30', reason: '' })
    expect(status()).toBe('available')
    // In place again, HR marks 近期可入场 ahead of the end: undoing 退场 and 退场 itself keep it.
    advance({ action: 'undo-leave', reason: '误操作' })
    setStatus('soon')
    advance({ action: 'leave', leftDate: '2026-09-30', reason: '' })
    expect(status()).toBe('soon')
    advance({ action: 'undo-leave', reason: '误操作' })
    expect(status()).toBe('soon')
  })

  it('does not count the old time of a follow-up back at 待约面 as taken', () => {
    const other = seedDraftCase(handle.repository, 'Go 案件', '必須スキル：Go').reviewId
    handle.repository.beginBusinessProgress(
      [
        { documentId, reviewId, pendingConditions: [] },
        { documentId, reviewId: other, pendingConditions: [] }
      ],
      'test-hr'
    )
    advance({ action: 'schedule', schedule: emptySchedule(1, '2026-10-08T01:00:00.000Z') })
    advance({ action: 'pause', reason: '客户内部调整' })
    const elsewhere = () => handle.repository.listBusinessFollowUps().find((row) => row.reviewId === other)!
    const book = (at: string) =>
      handle.repository.advanceBusinessProgress(
        {
          documentId,
          reviewId: other,
          expectedRevision: elsewhere().revision,
          mutationId: randomUUID(),
          action: 'schedule',
          schedule: emptySchedule(1, at)
        },
        'test-hr'
      )
    book('2026-10-09T01:00:00.000Z')
    // Resuming finds that day taken now, so the first follow-up goes back to 待约面 with its old time unshown…
    handle.repository.advanceBusinessProgress(
      {
        documentId,
        reviewId: other,
        expectedRevision: elsewhere().revision,
        mutationId: randomUUID(),
        action: 'rebook',
        schedule: emptySchedule(1, '2026-10-08T01:30:00.000Z'),
        reason: '改期',
        allowConflict: true
      },
      'test-hr'
    )
    expect(advance({ action: 'resume' }).progress?.stage).toBe('coordinating')
    // …and that old time no longer blocks another booking at the same hour.
    handle.repository.advanceBusinessProgress(
      {
        documentId,
        reviewId: other,
        expectedRevision: elsewhere().revision,
        mutationId: randomUUID(),
        action: 'rebook',
        schedule: emptySchedule(1, '2026-10-08T01:00:00.000Z'),
        reason: '改回原时间'
      },
      'test-hr'
    )
    expect(elsewhere().progress?.rounds.at(-1)?.scheduledAt).toBe('2026-10-08T01:00:00.000Z')
  })

  it('from mail sync, takes only mail tied to a follow-up, so a case listing mentioning 面談 still becomes a case', () => {
    const listing = {
      accountEmail: 'hr@example.com',
      messageId: 'listing-with-interview',
      threadId: 't-9',
      subject: '面談日程調整のご案内',
      body: '【案件】Java開発 面談1回 日程調整可',
      receivedAt: '2026-09-10T06:00:00.000Z'
    }
    expect(handle.repository.captureBusinessProgressMail(listing, { onlyIfMatched: true })).toBe(false)
    expect(handle.repository.listBusinessProgressMail()).toHaveLength(0)
  })

  it('keeps clear follow-up correspondence nobody matched as a message to assign, and matches a placed person’s 入場 mail', () => {
    const unmatched = {
      accountEmail: 'hr@example.com',
      messageId: 'unmatched-progress',
      threadId: 't-10',
      subject: '面談日程のご相談',
      body: '先日の件、面談の日程調整をお願いできますでしょうか。',
      receivedAt: '2026-09-10T06:00:00.000Z'
    }
    expect(handle.repository.captureBusinessProgressMail(unmatched, { onlyIfMatched: true })).toBe(true)
    expect(handle.repository.listBusinessProgressMail()[0]).toMatchObject({ followUpId: null, state: 'pending' })
    // A placed person's start-date mail still finds the placement.
    handle.repository.beginBusinessProgress([{ documentId, reviewId, pendingConditions: [] }], 'test-hr')
    advance({ action: 'schedule', schedule: emptySchedule(1, '2026-09-08T01:00:00.000Z') })
    advance({ action: 'feedback', roundNumber: 1, notes: '一面通过', result: 'passed', next: 'entry', unresolved: [] })
    advance({ action: 'entry', entry: { ...current().progress!.entry, candidateAccepted: true, termsAgreed: true } })
    advance({ action: 'start', actualDate: '2026-09-10' })
    const name = handle.repository.getCandidateReview(documentId)!.localIdentity!.displayName!
    const title = handle.repository.getJobCaseReview(reviewId)!.redactedSubject
    expect(
      handle.repository.captureBusinessProgressMail(
        {
          ...unmatched,
          messageId: 'placed-entry',
          subject: '入場手続きのご案内',
          body: `${name}様の${title}への入場手続きのご案内です。`
        },
        { onlyIfMatched: true }
      )
    ).toBe(true)
    expect(handle.repository.listBusinessProgressMail().find((mail) => mail.kind === 'entry')?.suggestedFollowUpIds).toEqual([current().id])
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
  it('ends a case with its open follow-ups in one step and brings them back when the case is active again', () => {
    handle.repository.beginBusinessProgress([{ documentId, reviewId, pendingConditions: [] }], 'test-hr')
    advance({ action: 'schedule', schedule: emptySchedule(1, '2026-10-08T01:00:00.000Z') })
    handle.repository.setJobCaseLifecycle({ reviewId, state: 'archived', reason: '募集終了のため', closeOpenFollowUps: true }, 'test-hr')
    expect(current().progress).toMatchObject({ stage: 'closed', closedWithCase: true })
    handle.repository.setJobCaseLifecycle({ reviewId, state: 'active', reason: '募集再開のため' }, 'test-hr')
    expect(current().progress?.stage).toBe('scheduled')
    expect(current().progress?.closedWithCase).toBeUndefined()
    // A follow-up HR ended on its own stays ended when the case comes back.
    advance({ action: 'close', reason: '本人辞退' })
    handle.repository.setJobCaseLifecycle({ reviewId, state: 'archived', reason: '募集終了のため', closeOpenFollowUps: true }, 'test-hr')
    handle.repository.setJobCaseLifecycle({ reviewId, state: 'active', reason: '募集再開のため' }, 'test-hr')
    expect(current().progress?.stage).toBe('closed')
  })

  it('refuses to propose or book a pair HR judged 不满足 on every path, resume included', () => {
    handle.repository.beginBusinessProgress([{ documentId, reviewId, pendingConditions: [] }], 'test-hr')
    advance({ action: 'pause', reason: '客户内部调整' })
    handle.repository.setPairRejectionCheck(() => true)
    try {
      expect(() => advance({ action: 'resume' })).toThrow(/不满足/)
      expect(() => advance({ action: 'recommend' })).toThrow(/不满足/)
      // Named when a batch is started.
      const other = seedDraftCase(handle.repository, 'Go 案件', '必須スキル：Go').reviewId
      expect(() => handle.repository.beginBusinessProgress([{ documentId, reviewId: other, pendingConditions: [] }], 'test-hr')).toThrow(
        /已判定不满足/
      )
    } finally {
      handle.repository.setPairRejectionCheck(null)
    }
  })

  it('starts the same pair again after 退场, keeping the earlier placement as history', () => {
    handle.repository.beginBusinessProgress([{ documentId, reviewId, pendingConditions: [] }], 'test-hr')
    advance({ action: 'schedule', schedule: emptySchedule(1, '2026-09-08T01:00:00.000Z') })
    advance({ action: 'feedback', roundNumber: 1, notes: '一面通过', result: 'passed', next: 'entry', unresolved: [] })
    advance({ action: 'entry', entry: { ...current().progress!.entry, candidateAccepted: true, termsAgreed: true } })
    advance({ action: 'start', actualDate: '2026-09-10' })
    expect(() => advance({ action: 'restart', reason: '再参画' })).toThrow(/已退场/)
    advance({ action: 'leave', leftDate: '2026-09-30', reason: '' })
    const again = advance({ action: 'restart', reason: '客户希望再次进场' })
    expect(again.progress).toMatchObject({ stage: 'coordinating', entry: { actualDate: null } })
    expect(again.progress?.entry.leftDate ?? null).toBeNull()
    expect(again.progress?.rounds).toHaveLength(1)
    expect(again.events.at(-1)?.previousEntry).toMatchObject({ actualDate: '2026-09-10', leftDate: '2026-09-30' })
    // The next booking is a new round, not the decided one.
    expect(nextBusinessRound(again.progress)).toBe(2)
    expect(advance({ action: 'schedule', schedule: emptySchedule(2, '2026-11-08T01:00:00.000Z') }).progress?.stage).toBe('scheduled')
  })

  it('cancels a booked recruiting interview, freeing its time without inventing a result', () => {
    const booked = handle.repository.saveCandidateInterviewSchedule(
      {
        sourceDocumentId: documentId,
        kind: 'recruiting',
        scheduledAt: '2026-10-08T01:00:00.000Z',
        durationMinutes: 60,
        meetingMethod: 'phone',
        interviewer: 'HR'
      },
      'HR'
    )
    const cancelled = handle.repository.cancelCandidateInterviewSchedule({ interviewId: booked.id, sourceDocumentId: documentId }, 'HR')
    expect(cancelled).toMatchObject({ id: booked.id, stage: 'contacting', scheduledAt: null, decision: null })
    expect(() =>
      handle.repository.cancelCandidateInterviewSchedule({ interviewId: booked.id, sourceDocumentId: documentId }, 'HR')
    ).toThrow(/已预约/)
    // The time is free again for another booking at the same hour.
    expect(
      handle.repository.saveCandidateInterviewSchedule(
        {
          interviewId: booked.id,
          sourceDocumentId: documentId,
          kind: 'recruiting',
          scheduledAt: '2026-10-08T01:00:00.000Z',
          durationMinutes: 60,
          meetingMethod: 'phone',
          interviewer: 'HR'
        },
        'HR'
      ).stage
    ).toBe('scheduled')
  })

  it('records a recommendation made after the follow-up started, without moving its stage', () => {
    handle.repository.beginBusinessProgress([{ documentId, reviewId, pendingConditions: [] }], 'test-hr')
    advance({ action: 'schedule', schedule: emptySchedule(1, '2026-10-08T01:00:00.000Z') })
    expect(current().progress?.recommendedAt).toBeFalsy()
    const recommended = advance({ action: 'recommend' })
    expect(recommended.progress?.stage).toBe('scheduled')
    expect(recommended.progress?.recommendedAt).toBeTruthy()
    // Once recorded it is not recorded again.
    expect(advance({ action: 'recommend' }).revision).toBe(recommended.revision)
  })

  it('resumes the follow-ups a placement paused when HR records 退场 and asks for it', () => {
    const other = seedDraftCase(handle.repository, 'Go 案件', '必須スキル：Go').reviewId
    handle.repository.beginBusinessProgress(
      [
        { documentId, reviewId, pendingConditions: [] },
        { documentId, reviewId: other, pendingConditions: [] }
      ],
      'test-hr'
    )
    advance({ action: 'schedule', schedule: emptySchedule(1, '2026-09-08T01:00:00.000Z') })
    advance({ action: 'feedback', roundNumber: 1, notes: '一面通过', result: 'passed', next: 'entry', unresolved: [] })
    advance({ action: 'entry', entry: { ...current().progress!.entry, candidateAccepted: true, termsAgreed: true } })
    advance({ action: 'start', actualDate: '2026-09-10', pauseOthers: true })
    const elsewhere = () => handle.repository.listBusinessFollowUps().find((row) => row.reviewId === other)!
    expect(elsewhere().progress?.stage).toBe('paused')
    advance({ action: 'leave', leftDate: '2026-09-30', reason: '', resumePaused: true })
    expect(elsewhere().progress?.stage).toBe('coordinating')
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
