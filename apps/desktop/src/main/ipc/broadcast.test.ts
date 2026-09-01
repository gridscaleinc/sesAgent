import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { EncryptedApplicationRepository } from '@persistence'
import {
  builtInBroadcastTemplate,
  ipcChannels,
  jobCaseFieldKeys,
  type CaseBroadcastCopy,
  type CaseBroadcastRecord,
  type JobCaseReviewSnapshot
} from '@shared'
import { registerBroadcastHandlers, type BroadcastIpcDependencies } from './broadcast'

const electronMock = vi.hoisted(() => {
  type Handler = (event: IpcMainInvokeEvent, rawInput: unknown) => unknown
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    ipcMain: { handle: vi.fn((channel: string, handler: Handler) => { handlers.set(channel, handler) }) }
  }
})

vi.mock('electron', () => ({ ipcMain: electronMock.ipcMain }))

const reviewId = '11111111-1111-4111-8111-111111111111'
const jobCaseId = '22222222-2222-4222-8222-222222222222'
const event = {} as IpcMainInvokeEvent

const caseValues: Record<string, string> = {
  title: 'Java 案件',
  required_skills: 'Java、Spring Boot',
  rate: '60万〜65万円',
  location: '都内',
  contract_chain: '弊社→元請→エンド',
  payment_terms: '月末締め翌月末払い'
}

function review(overrides: Partial<JobCaseReviewSnapshot> = {}): JobCaseReviewSnapshot {
  return {
    reviewId,
    sourceId: '33333333-3333-4333-8333-333333333333',
    sourceType: 'gmail',
    providerMessageId: null,
    threadId: 'thread-1',
    fromDomain: 'partner.example.jp',
    messageDate: '2026-08-25T00:00:00.000Z',
    redactedSubject: 'Java 案件',
    redactedPreview: 'Java',
    reviewRevision: 1,
    status: 'completed',
    privacyReviewed: true,
    fields: jobCaseFieldKeys.map((key) => ({
      key, label: key, originalValue: caseValues[key] ?? null, value: caseValues[key] ?? null,
      confidence: 1, status: caseValues[key] ? 'confirmed' as const : 'missing' as const,
      sourceLabels: [], changed: false, changeReason: null
    })),
    warningCodes: [],
    completedAt: '2026-08-25T01:00:00.000Z',
    reviewerDisplayName: 'HR',
    jobCase: { id: jobCaseId, sourceReviewId: reviewId, version: 1, status: 'active', confirmedAt: '2026-08-25T01:00:00.000Z', confirmedBy: 'HR', containsDirectIdentifiers: false },
    lifecycle: 'active',
    cloudEligible: false,
    ...overrides
  }
}

function dependencies(overrides: Partial<Record<string, unknown>> = {}): BroadcastIpcDependencies & {
  repository: Record<string, ReturnType<typeof vi.fn>>
} {
  const repository = {
    getJobCaseReview: vi.fn(() => review()),
    listJobCaseReviews: vi.fn(() => [review()]),
    listAllCaseBroadcasts: vi.fn((): CaseBroadcastRecord[] => []),
    listCaseBroadcasts: vi.fn((): CaseBroadcastRecord[] => []),
    listAllCaseBroadcastCopies: vi.fn((): CaseBroadcastCopy[] => []),
    listCaseBroadcastCopies: vi.fn((): CaseBroadcastCopy[] => []),
    getJobCaseHistory: vi.fn(() => []),
    listBroadcastTemplates: vi.fn(() => [builtInBroadcastTemplate()]),
    appendCaseBroadcastCopy: vi.fn((entry: object) => ({
      ...entry, id: 'copy-1', textSha256: 'a'.repeat(64), createdAt: '2026-08-25T04:00:00.000Z'
    })),
    ...overrides
  }
  return {
    repository: repository as unknown as EncryptedApplicationRepository & Record<string, ReturnType<typeof vi.fn>>,
    currentOperator: () => ({ operatorId: 'operator-1', displayName: 'HR' }),
    assertTrustedSender: vi.fn()
  } as never
}

function invoke(channel: string, input?: unknown) {
  const handler = electronMock.handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return handler(event, input)
}

describe('broadcast IPC handlers', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
  })

  it('returns the queue and the templates, and names no destination at all', () => {
    registerBroadcastHandlers(dependencies())
    const workspace = invoke(ipcChannels.listBroadcastWorkspace) as { queue: unknown[]; templates: unknown[] }
    expect(workspace).toEqual({
      queue: [{
        reviewId, jobCaseId, jobCaseVersion: 1, title: 'Java 案件', sourceType: 'gmail',
        status: 'new', lastCopy: null, hasUpdateSinceLastCopy: false
      }],
      templates: [expect.objectContaining({ name: '標準' })]
    })
    expect(JSON.stringify(workspace)).not.toContain('group')
  })

  it('drafts both languages and never puts the chain or the payment terms in either', () => {
    registerBroadcastHandlers(dependencies())
    const draft = invoke(ipcChannels.draftCaseBroadcast, { reviewId }) as {
      textJa: string; textZh: string; forbiddenJa: string[]; forbiddenZh: string[]
    }
    expect(draft.textJa).toContain('【案件】Java 案件')
    expect(draft.textJa).toContain('単価：～65万円')
    expect(draft.textZh).toContain('单价：～65万日元')
    for (const text of [draft.textJa, draft.textZh]) {
      expect(text).not.toContain('元請')
      expect(text).not.toContain('月末締め')
    }
    expect(draft.forbiddenJa).toEqual([])
    expect(draft.forbiddenZh).toEqual([])
  })

  it('reports the identifier types it found rather than blocking silently', () => {
    const withPlaceholder: Record<string, string> = { ...caseValues, title: '<PERSON_NAME_001> 案件' }
    const deps = dependencies({
      getJobCaseReview: vi.fn(() => review({
        fields: jobCaseFieldKeys.map((key) => ({
          key, label: key, originalValue: withPlaceholder[key] ?? null, value: withPlaceholder[key] ?? null,
          confidence: 1, status: 'confirmed' as const, sourceLabels: [], changed: false, changeReason: null
        }))
      }))
    })
    registerBroadcastHandlers(deps)
    const draft = invoke(ipcChannels.draftCaseBroadcast, { reviewId }) as { forbiddenJa: string[] }
    expect(draft.forbiddenJa).toContain('person_name')
  })

  it('refuses to draft or record an unconfirmed or archived case', () => {
    registerBroadcastHandlers(dependencies({ getJobCaseReview: vi.fn(() => review({ status: 'awaiting-review', jobCase: null })) }))
    expect(() => invoke(ipcChannels.draftCaseBroadcast, { reviewId })).toThrow(/確認待ち/u)

    electronMock.handlers.clear()
    registerBroadcastHandlers(dependencies({ getJobCaseReview: vi.fn(() => review({ lifecycle: 'archived' })) }))
    expect(() => invoke(ipcChannels.draftCaseBroadcast, { reviewId })).toThrow(/無効/u)
  })

  it('records one copy against the case version the operator is looking at', () => {
    const deps = dependencies()
    registerBroadcastHandlers(deps)
    const result = invoke(ipcChannels.recordCaseBroadcastCopy, {
      reviewId, lang: 'zh', kind: 'new',
      templateId: builtInBroadcastTemplate().id, text: '【案件】Java 案件'
    }) as { copy: { id: string } }
    expect(result.copy.id).toBe('copy-1')
    expect(deps.repository.appendCaseBroadcastCopy).toHaveBeenCalledWith({
      reviewId, jobCaseId, jobCaseVersion: 1,
      templateId: builtInBroadcastTemplate().id, templateRevision: 1,
      lang: 'zh', kind: 'new', text: '【案件】Java 案件', actorId: 'operator-1'
    })
  })

  it('rejects text that still carries an identifier placeholder, naming the types', () => {
    const deps = dependencies()
    registerBroadcastHandlers(deps)
    expect(() => invoke(ipcChannels.recordCaseBroadcastCopy, {
      reviewId, lang: 'ja', kind: 'new',
      templateId: builtInBroadcastTemplate().id, text: '【案件】<PERSON_NAME_001> 様の案件'
    })).toThrow(/person_name/u)
    expect(deps.repository.appendCaseBroadcastCopy).not.toHaveBeenCalled()
  })

  it('refuses to record a copy of an unconfirmed case', () => {
    const deps = dependencies({ getJobCaseReview: vi.fn(() => review({ status: 'awaiting-review', jobCase: null })) })
    registerBroadcastHandlers(deps)
    expect(() => invoke(ipcChannels.recordCaseBroadcastCopy, {
      reviewId, lang: 'ja', kind: 'new', templateId: builtInBroadcastTemplate().id, text: '案件'
    })).toThrow(/確認待ち/u)
    expect(deps.repository.appendCaseBroadcastCopy).not.toHaveBeenCalled()
  })

  it('offers no channel that could claim a message was sent, and none that edits the log', () => {
    registerBroadcastHandlers(dependencies())
    const channels = [...electronMock.handlers.keys()]
    expect(channels.filter((channel) => /broadcast:(record-copy|list-records)/u.test(channel))).toHaveLength(2)
    expect(channels.some((channel) => /group|sent|update-record|delete-record/u.test(channel))).toBe(false)
  })

  it('merges the copies and the pre-v43 ledger into one history that carries no text', () => {
    registerBroadcastHandlers(dependencies({
      listCaseBroadcastCopies: vi.fn(() => [{
        id: 'copy-1', reviewId, jobCaseId, jobCaseVersion: 2,
        templateId: builtInBroadcastTemplate().id, templateRevision: 1, lang: 'zh', kind: 'update' as const,
        text: '【更新】Java 案件', textSha256: 'a'.repeat(64), actorId: 'operator-1',
        createdAt: '2026-08-26T02:00:00.000Z'
      }]),
      listCaseBroadcasts: vi.fn(() => [{
        id: 'legacy-1', reviewId, jobCaseId, jobCaseVersion: 1, groupId: 'group-1', groupName: '関東Javaグループ',
        templateId: builtInBroadcastTemplate().id, templateRevision: 1, lang: 'ja', kind: 'new' as const,
        action: 'marked_sent' as const, text: '【案件】Java 案件', textSha256: 'b'.repeat(64),
        actorId: 'operator-1', createdAt: '2026-08-25T02:00:00.000Z'
      }])
    }))
    const history = invoke(ipcChannels.listCaseBroadcasts, reviewId) as Array<Record<string, unknown>>
    expect(history.map((entry) => [entry.id, entry.source, entry.jobCaseVersion])).toEqual([
      ['copy-1', 'copy', 2],
      ['legacy-1', 'legacy', 1]
    ])
    expect(JSON.stringify(history)).not.toContain('【案件】')
    expect(JSON.stringify(history)).not.toContain('関東Javaグループ')
  })

  it('says so when a case was never copied, and when nothing the message shows has changed', () => {
    registerBroadcastHandlers(dependencies())
    expect(invoke(ipcChannels.draftCaseUpdateNotice, { reviewId })).toEqual({ status: 'no-copy-baseline' })
  })

  it('writes the update notice from the newest version ever copied', () => {
    const historyVersion = (version: number, values: Record<string, string>) => ({
      id: jobCaseId, sourceReviewId: reviewId, sourceId: 'source-1', sourceType: 'gmail' as const,
      version, reviewRevision: version, status: 'active' as const,
      fields: jobCaseFieldKeys.map((key) => ({ key, label: key, value: values[key] ?? null, sourceLabels: [] })),
      confirmedAt: '2026-08-25T00:00:00.000Z', confirmedBy: 'HR', containsDirectIdentifiers: false as const
    })
    registerBroadcastHandlers(dependencies({
      getJobCaseReview: vi.fn(() => review({
        jobCase: { id: jobCaseId, sourceReviewId: reviewId, version: 2, status: 'active', confirmedAt: '2026-08-26T00:00:00.000Z', confirmedBy: 'HR', containsDirectIdentifiers: false }
      })),
      listCaseBroadcastCopies: vi.fn(() => [{
        id: 'copy-1', reviewId, jobCaseId, jobCaseVersion: 1,
        templateId: builtInBroadcastTemplate().id, templateRevision: 1, lang: 'zh', kind: 'new',
        text: '', textSha256: 'a'.repeat(64), actorId: 'operator-1',
        createdAt: '2026-08-25T02:00:00.000Z'
      }]),
      getJobCaseHistory: vi.fn(() => [
        historyVersion(2, { rate: '65万円' }),
        historyVersion(1, { rate: '60万円' })
      ])
    }))
    expect(invoke(ipcChannels.draftCaseUpdateNotice, { reviewId })).toMatchObject({
      status: 'ready',
      textJa: '【更新】Java 案件\n・単価：～60万円 → ～65万円',
      textZh: '【更新】Java 案件\n・单价：～60万日元 → ～65万日元'
    })
  })

  it('checks the sender before doing anything', () => {
    const deps = dependencies()
    const blocked = { ...deps, assertTrustedSender: vi.fn(() => { throw new Error('Blocked IPC request from an untrusted renderer.') }) }
    registerBroadcastHandlers(blocked)
    expect(() => invoke(ipcChannels.listBroadcastWorkspace)).toThrow(/untrusted renderer/u)
    expect(() => invoke(ipcChannels.recordCaseBroadcastCopy, {})).toThrow(/untrusted renderer/u)
  })
})
