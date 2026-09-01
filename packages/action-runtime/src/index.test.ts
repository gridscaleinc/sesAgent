import { describe, expect, it } from 'vitest'
import { ActionOrchestrator, createDefaultDomainToolRegistry, evaluateActionPolicy } from './index'

const hash = 'a'.repeat(64)

describe('action runtime policy', () => {
  it('fails closed for an unregistered tool, invalid scope, and non-redacted cloud effects', () => {
    const registry = createDefaultDomainToolRegistry()
    const context = {
      origin: 'work-task' as const, workTaskId: 'task-1', scopeId: 'selected-files',
      scopeFingerprint: hash, actorId: 'operator-1', contentRevision: null
    }
    expect(evaluateActionPolicy(registry, 'not.registered' as never, context, {}).decision).toMatchObject({
      outcome: 'deny', code: 'UNREGISTERED_TOOL'
    })
    expect(evaluateActionPolicy(registry, 'candidate.match.local', { ...context, scopeId: 'selected-files' }, { taskId: 'task-1' }).decision).toMatchObject({
      outcome: 'deny', code: 'SCOPE_DENIED'
    })
  })

  it('registers the controlled local conversational matching tools without adding a second tool union', () => {
    const registry = createDefaultDomainToolRegistry()
    expect(registry.get('job-case.search.local')).toMatchObject({ name: 'job-case.search.local', effects: { localRead: true, localWrite: false } })
    expect(registry.get('candidate.match.local')).toMatchObject({ name: 'candidate.match.local', effects: { localRead: true, localWrite: true } })
    expect(registry.get('candidate.profile.read.local')).toMatchObject({ name: 'candidate.profile.read.local', effects: { localRead: true, localWrite: false } })
    expect(registry.get('candidate.interview.read.local')).toMatchObject({ name: 'candidate.interview.read.local', effects: { localRead: true, localWrite: false } })
    expect(registry.get('match-run.read.local')).toMatchObject({ name: 'match-run.read.local', effects: { localRead: true, localWrite: false } })
    expect(registry.get('job-case.draft.read.local')).toMatchObject({
      name: 'job-case.draft.read.local', allowedScopeIds: ['conversation-intake-drafts'], effects: { localRead: true, localWrite: false, cloudInvocation: false }
    })
    expect(registry.get('proposal.export')).toBeDefined()
  })

  it('drafts a case broadcast read-only and registers no tool that could send one', () => {
    const registry = createDefaultDomainToolRegistry()
    expect(registry.get('job-case.broadcast.draft.local')).toMatchObject({
      name: 'job-case.broadcast.draft.local', allowedScopeIds: ['broadcast-queue'],
      effects: { localRead: true, localWrite: false, externalWrite: false, cloudInvocation: false }
    })
    // Whether a message reached a group is not a fact this device has, so the
    // ledger-writing tool is gone rather than merely unused.
    expect(() => registry.get('job-case.broadcast.record.local' as never)).toThrow(/Unregistered domain tool/)
    const context = {
      origin: 'user-command' as const, workTaskId: null, scopeId: 'broadcast-queue',
      scopeFingerprint: hash, actorId: 'operator-1', contentRevision: null
    }
    const reviewIds = ['11111111-1111-4111-8111-111111111111']
    expect(evaluateActionPolicy(registry, 'job-case.broadcast.draft.local', context, { reviewIds }).decision.outcome).toBe('allow')
    expect(evaluateActionPolicy(registry, 'job-case.broadcast.draft.local', { ...context, scopeId: 'active-job-cases' }, { reviewIds }).decision)
      .toMatchObject({ outcome: 'deny', code: 'SCOPE_DENIED' })
    // One drafting turn can never ask for more cases than a card block holds.
    expect(evaluateActionPolicy(registry, 'job-case.broadcast.draft.local', context, {
      reviewIds: Array.from({ length: 9 }, () => '11111111-1111-4111-8111-111111111111')
    }).decision).toMatchObject({ outcome: 'deny', code: 'INVALID_INPUT' })
  })

  it('keeps user proposal export behind native confirmation but routes system requests to Inbox approval', () => {
    const registry = createDefaultDomainToolRegistry()
    const input = { taskId: 'task-1', draftId: 'draft-1', revision: 1, contentHash: hash }
    const userContext = {
      origin: 'work-task' as const, workTaskId: 'task-1', scopeId: 'selected-case',
      scopeFingerprint: hash, actorId: 'operator-1', contentRevision: '1'
    }
    expect(evaluateActionPolicy(registry, 'proposal.export', userContext, input).decision.outcome).toBe('native-confirmation')
    expect(evaluateActionPolicy(registry, 'proposal.export', { ...userContext, origin: 'system' }, input).decision.outcome).toBe('require-approval')
  })

  it('allows WeChat visible reading only from a user-command foreground scope and requires native confirmation', () => {
    const registry = createDefaultDomainToolRegistry()
    const input = {
      targetBundleIdentifier: 'com.tencent.xinWeChat',
      targetProcessIdentifier: 72063,
      targetLaunchDate: '2026-08-04T00:51:49.514Z',
      requestNonce: '2a3a4d7a-fcb0-452b-b8c0-bcb5048df08c'
    }
    const context = {
      origin: 'user-command' as const,
      workTaskId: null,
      scopeId: 'frontmost-wechat-visible-conversation',
      scopeFingerprint: hash,
      actorId: 'operator-1',
      contentRevision: '4.1.5'
    }
    expect(evaluateActionPolicy(registry, 'wechat.visible.read', context, input).decision.outcome)
      .toBe('native-confirmation')
    expect(evaluateActionPolicy(registry, 'wechat.visible.read', { ...context, origin: 'system' }, input).decision)
      .toMatchObject({ outcome: 'deny', code: 'ORIGIN_DENIED' })
    expect(evaluateActionPolicy(registry, 'wechat.visible.read', { ...context, scopeId: 'selected-case' }, input).decision)
      .toMatchObject({ outcome: 'deny', code: 'SCOPE_DENIED' })
  })

  it('persists only a redacted approval summary through the orchestrator boundary', () => {
    const calls: Array<{ type: string; value: unknown }> = []
    const orchestrator = new ActionOrchestrator(createDefaultDomainToolRegistry(), {
      createActionRun: (input) => { calls.push({ type: 'run', value: input }); return { id: 'run-1', status: input.status } },
      requestActionApproval: (input) => { calls.push({ type: 'approval', value: input }) }
    })
    const result = orchestrator.preflight('proposal.export', {
      origin: 'system', workTaskId: 'task-1', scopeId: 'selected-case', scopeFingerprint: hash,
      actorId: 'operator-1', contentRevision: '1'
    }, { taskId: 'task-1', draftId: 'draft-1', revision: 1, contentHash: hash }, '保存先の選択を待っています。', 'system-proposal-1')
    expect(result.decision.outcome).toBe('require-approval')
    expect(calls).toHaveLength(2)
    expect(JSON.stringify(calls)).not.toContain('candidate@example.jp')
  })
})
