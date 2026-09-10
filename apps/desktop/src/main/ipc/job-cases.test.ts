import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { jobCaseFieldKeys, ipcChannels, type JobCaseFieldKey, type JobCaseReviewSnapshot } from '@shared'
import { registerJobCaseHandlers } from './job-cases'
import { assertTrustedSender } from './context'

const electronMock = vi.hoisted(() => {
  type Handler = (event: IpcMainInvokeEvent, rawInput: unknown) => unknown
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    ipcMain: { handle: vi.fn((channel: string, handler: Handler) => { handlers.set(channel, handler) }) }
  }
})

vi.mock('electron', () => ({
  ipcMain: electronMock.ipcMain,
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showOpenDialog: vi.fn() }
}))
vi.mock('./context', () => ({ assertTrustedSender: vi.fn() }))

const event = {} as IpcMainInvokeEvent
const todayReviewId = 'a1111111-1111-4111-8111-111111111111'
const yesterdayReviewId = 'b1111111-1111-4111-8111-111111111111'

const values: Partial<Record<JobCaseFieldKey, string>> = {
  title: 'Java 決済基盤', required_skills: 'Java', rate: '65万円', location: '東京'
}

function review(reviewId: string, intakeAt: string): JobCaseReviewSnapshot {
  return {
    reviewId,
    sourceId: '33333333-3333-4333-8333-333333333333',
    sourceType: 'gmail', providerMessageId: null, threadId: 'thread-1', fromDomain: 'partner.example.jp',
    messageDate: intakeAt, intakeAt, redactedSubject: '件名', redactedPreview: '本文',
    reviewRevision: 1, status: 'completed', privacyReviewed: true,
    fields: jobCaseFieldKeys.map((key) => ({
      key, label: key, originalValue: values[key] ?? null, value: values[key] ?? null,
      confidence: 1, status: values[key] ? 'confirmed' as const : 'missing' as const,
      sourceLabels: [], changed: false, changeReason: null
    })),
    warningCodes: [], completedAt: intakeAt, reviewerDisplayName: 'HR',
    jobCase: {
      id: '22222222-2222-4222-8222-222222222222', sourceReviewId: reviewId, version: 1, status: 'active',
      confirmedAt: intakeAt, confirmedBy: 'HR', containsDirectIdentifiers: false
    },
    lifecycle: 'active', cloudEligible: false
  }
}

function context() {
  const seen = new Set<string>()
  const repository = {
    listJobCaseReviews: vi.fn(() => [
      review(todayReviewId, new Date().toISOString()),
      review(yesterdayReviewId, new Date(Date.now() - 86_400_000).toISOString())
    ]),
    listSeenJobCaseReviewIds: vi.fn(() => [...seen]),
    markJobCaseReviewSeen: vi.fn((reviewId: string) => { seen.add(reviewId) })
  }
  return {
    repository, parserWorker: null, localNer: null, wechatVisibleReader: null,
    wechatScopeTokens: null, currentOperator: () => ({ operatorId: 'operator-1', displayName: 'HR' }),
    preflightAction: vi.fn()
  }
}

function invoke(channel: string, input?: unknown) {
  const handler = electronMock.handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return handler(event, input)
}

describe('今日新着案件 IPC handlers', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
  })

  it('uses the display-only repository read behind the trusted local source IPC', () => {
    const source = { redactedSubject: 'SAP', redactedBody: 'BTP or <PERSON_NAME_001> or Cdsview',
      localDisplay: { subject: 'SAP', body: 'BTP or Fiori or Cdsview' } }
    const getJobCaseSourceTextForDisplay = vi.fn(() => source)
    const getJobCaseSourceText = vi.fn()
    const deps = context()
    registerJobCaseHandlers({ ...deps, repository: { ...deps.repository, getJobCaseSourceTextForDisplay, getJobCaseSourceText } } as never)
    expect(invoke(ipcChannels.getJobCaseSourceText, todayReviewId)).toEqual(source)
    expect(assertTrustedSender).toHaveBeenCalledWith(event)
    expect(getJobCaseSourceTextForDisplay).toHaveBeenCalledWith(todayReviewId)
    expect(getJobCaseSourceText).not.toHaveBeenCalled()
    expect(() => invoke(ipcChannels.getJobCaseSourceText, 'invalid-id')).toThrow()
    expect(getJobCaseSourceTextForDisplay).toHaveBeenCalledTimes(1)
  })

  it('groups the arrivals by Tokyo day and counts every one of them as unseen', () => {
    registerJobCaseHandlers(context() as never)
    const digest = invoke(ipcChannels.getJobCaseNewDigest) as {
      groups: Array<{ day: string; count: number; unseenCount: number }>
      newCasesToday: number
      unseenCount: number
    }
    expect(digest.groups.map((group) => group.day)).toEqual(['today', 'yesterday'])
    expect(digest.newCasesToday).toBe(1)
    expect(digest.unseenCount).toBe(2)
  })

  it('records one case as seen and returns the remaining unseen count', () => {
    const dependencies = context()
    registerJobCaseHandlers(dependencies as never)
    expect(invoke(ipcChannels.markJobCaseSeen, todayReviewId)).toEqual({ unseenCount: 1 })
    expect(dependencies.repository.markJobCaseReviewSeen).toHaveBeenCalledWith(todayReviewId, expect.any(String))
    // Idempotent: marking the same case again leaves the count where it was.
    expect(invoke(ipcChannels.markJobCaseSeen, todayReviewId)).toEqual({ unseenCount: 1 })
  })

  it('rejects a review id that is not a UUID before touching the store', () => {
    const dependencies = context()
    registerJobCaseHandlers(dependencies as never)
    expect(() => invoke(ipcChannels.markJobCaseSeen, 'not-a-uuid')).toThrow()
    expect(dependencies.repository.markJobCaseReviewSeen).not.toHaveBeenCalled()
  })
})
