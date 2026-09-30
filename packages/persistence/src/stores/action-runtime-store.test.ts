// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'

const conversationId = '11111111-1111-4111-8111-111111111111'
const turnId = '22222222-2222-4222-8222-222222222222'

function runInput(overrides: Record<string, unknown> = {}) {
  return {
    toolName: 'candidate.match.local' as const,
    workTaskId: null,
    origin: 'user-command' as const,
    scopeId: 'scope-1',
    scopeFingerprint: 'a'.repeat(64),
    inputHash: 'b'.repeat(64),
    contentRevision: null,
    status: 'proposed' as const,
    idempotencyKey: 'idem-1',
    ...overrides
  }
}

describe.skipIf(!nativeSqliteAvailable)('ActionRuntimeStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  it('creates idempotent action runs, tracks status, and rejects key collisions and bad hashes', () => {
    const { repository } = handle
    const run = repository.createActionRun(runInput())
    expect(repository.createActionRun(runInput())).toEqual(run)
    expect(() => repository.createActionRun(runInput({ inputHash: 'c'.repeat(64) }))).toThrow(/collides/)
    expect(() => repository.createActionRun(runInput({ idempotencyKey: 'idem-2', scopeFingerprint: 'nope' }))).toThrow(/SHA-256/)
    repository.updateActionRun(run.id, 'running')
    expect(handle.reopen().getActionRunStatus(run.id)).toBe('running')
    expect(() => handle.repository.updateActionRun('missing', 'failed')).toThrow(/not found/)
  })

  it('runs the approval flow once and refuses identifiers in the approval summary', () => {
    const { repository } = handle
    const run = repository.createActionRun(runInput())
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString()
    expect(() =>
      repository.requestActionApproval({
        actionRunId: run.id,
        reason: 'EXPORT',
        safeSummary: '連絡先 090-1234-5678 に送付',
        expiresAt
      })
    ).toThrow(/direct identifiers/)
    expect(() =>
      repository.requestActionApproval({
        actionRunId: run.id,
        reason: 'EXPORT',
        safeSummary: 'mail: someone@example.jp',
        expiresAt
      })
    ).toThrow(/direct identifiers/)
    expect(() =>
      repository.requestActionApproval({
        actionRunId: run.id,
        reason: '担当 someone@example.jp へ送付',
        safeSummary: '提案書を出力',
        expiresAt
      })
    ).toThrow(/direct identifiers/)

    const approval = repository.requestActionApproval({
      actionRunId: run.id,
      reason: 'EXPORT',
      safeSummary: '候補者1名の提案書を出力',
      expiresAt
    })
    expect(approval.status).toBe('pending')
    expect(repository.getActionRunStatus(run.id)).toBe('awaiting_approval')
    // A second request for the same run returns the existing one.
    expect(repository.requestActionApproval({ actionRunId: run.id, reason: 'OTHER', safeSummary: '別', expiresAt }).id).toBe(approval.id)
    expect(repository.listActionApprovals().map((item) => item.id)).toEqual([approval.id])

    expect(repository.resolveActionApproval({ approvalId: approval.id, decision: 'approve' }, 'operator').status).toBe('approved')
    expect(repository.getActionRunStatus(run.id)).toBe('awaiting_foreground_confirmation')
    expect(() => repository.resolveActionApproval({ approvalId: approval.id, decision: 'deny' }, 'operator')).toThrow(
      /no longer actionable/
    )
    expect(repository.listActionApprovals()).toEqual([])
  })

  it('expires an approval past its deadline so it can no longer be approved', () => {
    const { repository } = handle
    const run = repository.createActionRun(runInput())
    const approval = repository.requestActionApproval({
      actionRunId: run.id,
      reason: 'EXPORT',
      safeSummary: '提案書を出力',
      expiresAt: new Date(Date.now() - 1_000).toISOString()
    })
    expect(repository.listActionApprovals()).toEqual([])
    expect(() => repository.resolveActionApproval({ approvalId: approval.id, decision: 'approve' }, 'operator')).toThrow(
      /no longer actionable/
    )
    expect(repository.getActionRunStatus(run.id)).not.toBe('awaiting_foreground_confirmation')
  })

  it('links a run only to an existing Sales Agent turn, and only once', () => {
    const { repository } = handle
    const run = repository.createActionRun(runInput())
    expect(() => repository.linkActionRunToConversation(run.id, conversationId, turnId)).toThrow(/会話が見つかりません/)
    repository.saveAiConversation({
      conversationId,
      context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
      messages: [{ id: 'm1', role: 'user', content: '検索', turnId, createdAt: '2026-09-01T00:00:00.000Z' }],
      expectedRevision: null
    })
    expect(() => repository.linkActionRunToConversation(run.id, conversationId, '99999999-9999-4999-8999-999999999999')).toThrow(
      /turn_id が会話履歴に存在しません/
    )
    repository.linkActionRunToConversation(run.id, conversationId, turnId)
    repository.linkActionRunToConversation(run.id, conversationId, turnId)
    const other = '33333333-3333-4333-8333-333333333333'
    repository.saveAiConversation({
      conversationId: other,
      context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
      messages: [{ id: 'm1', role: 'user', content: '検索', turnId, createdAt: '2026-09-01T00:00:00.000Z' }],
      expectedRevision: null
    })
    expect(() => repository.linkActionRunToConversation(run.id, other, turnId)).toThrow(/すでに別の会話/)
  })
})
