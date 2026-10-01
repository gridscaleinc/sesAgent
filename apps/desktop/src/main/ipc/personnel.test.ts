import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { ipcChannels, personnelMessageInputSchema } from '@shared'
import { registerPersonnelHandlers } from './personnel'
import { assertTrustedSender, type MainIpcContext } from './context'
import { rejectedByHr } from '../work-rule-matching'
const mock = vi.hoisted(() => ({
  handlers: new Map<string, (e: IpcMainInvokeEvent, raw?: unknown) => unknown>(),
  open: vi.fn(async (_url: string) => {})
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (key: string, handler: (e: IpcMainInvokeEvent, raw?: unknown) => unknown) => mock.handlers.set(key, handler) },
  shell: { openExternal: mock.open }
}))
vi.mock('./context', () => ({ assertTrustedSender: vi.fn() }))
// HR's 不满足 is computed from rules and profiles; here only whether the IPC consults it matters.
vi.mock('../work-rule-matching', async (original) => ({
  ...(await original<typeof import('../work-rule-matching')>()),
  rejectedByHr: vi.fn(() => false)
}))
const valid = {
  documentId: '11111111-1111-4111-8111-111111111111',
  profileVersion: 1,
  templateId: '22222222-2222-4222-8222-222222222222',
  templateRevision: 1,
  lang: 'ja',
  text: 'Java & AWS\n?cc=someone@example.test #紹介'
}
const invoke = (channel: string, input?: unknown) =>
  mock.handlers.get(channel)!({ sender: { id: 1, isDestroyed: () => false, send: vi.fn() } } as unknown as IpcMainInvokeEvent, input)
describe('personnel IPC', () => {
  beforeEach(() => {
    mock.handlers.clear()
    mock.open.mockClear()
    vi.mocked(assertTrustedSender).mockReset()
  })
  it('saves only affiliation with the current operator and rejects untrusted senders', () => {
    const input = { documentId: valid.documentId, expectedVersion: 1, isOwnCompany: true }
    const review = { documentId: valid.documentId, isOwnCompany: true }
    const save = vi.fn(() => ({ sourceDocumentId: valid.documentId }))
    registerPersonnelHandlers({
      repository: { setCandidateOwnCompany: save, getCandidateReview: vi.fn(() => review) },
      currentOperator: () => ({ displayName: 'HR' })
    } as unknown as MainIpcContext)
    expect(invoke(ipcChannels.setCandidateOwnCompany, input)).toEqual(review)
    expect(save).toHaveBeenCalledWith(input, 'HR')
    vi.mocked(assertTrustedSender).mockImplementation(() => {
      throw new Error('untrusted')
    })
    expect(() => invoke(ipcChannels.setCandidateOwnCompany, input)).toThrow('untrusted')
    expect(save).toHaveBeenCalledTimes(1)
  })
  it('opens an empty-recipient mail draft with the entire body encoded and no send record', async () => {
    const recordCopy = vi.fn()
    registerPersonnelHandlers({
      repository: {
        validatePersonnelMessage: (input: unknown) => personnelMessageInputSchema.parse(input),
        recordPersonnelCopy: recordCopy
      }
    } as unknown as MainIpcContext)
    await invoke(ipcChannels.openPersonnelEmail, valid)
    const url = new URL(mock.open.mock.calls[0]![0] as unknown as string)
    expect(url.pathname).toBe('')
    expect([...url.searchParams.keys()]).toEqual(['subject', 'body'])
    expect(url.searchParams.get('body')).toBe(valid.text)
    expect(recordCopy).not.toHaveBeenCalled()
    expect(assertTrustedSender).toHaveBeenCalled()
  })
  it('does not open mail when validation or the sender check fails', async () => {
    registerPersonnelHandlers({
      repository: {
        validatePersonnelMessage: () => {
          throw new Error('stale profile')
        }
      }
    } as unknown as MainIpcContext)
    await expect(invoke(ipcChannels.openPersonnelEmail, valid)).rejects.toThrow('stale profile')
    vi.mocked(assertTrustedSender).mockImplementation(() => {
      throw new Error('untrusted')
    })
    expect(() => invoke(ipcChannels.getPersonnelWorkspace)).toThrow('untrusted')
    expect(mock.open).not.toHaveBeenCalled()
  })
  it('carries the editable proposal subject into the mail client and rejects header injection', async () => {
    registerPersonnelHandlers({
      repository: { validatePersonnelMessage: (input: unknown) => personnelMessageInputSchema.parse(input) }
    } as unknown as MainIpcContext)
    const subject = '【要員提案／Java・Spring Boot】SE／経験19年／要員ID：E9AEF099'
    await invoke(ipcChannels.openPersonnelEmail, { ...valid, subject })
    expect(new URL(mock.open.mock.calls[0]![0]).searchParams.get('subject')).toBe(subject)
    expect(personnelMessageInputSchema.safeParse({ ...valid, subject: 'subject\r\nBcc: hidden@example.com' }).success).toBe(false)
  })
  it('rejects matching for personnel outside the currently eligible set', async () => {
    const listCases = vi.fn()
    registerPersonnelHandlers({
      repository: { listEligibleTalentProfiles: () => [], listActiveJobCases: listCases }
    } as unknown as MainIpcContext)
    await expect(invoke(ipcChannels.findCasesForPersonnel, valid.documentId)).rejects.toThrow('已停用')
    expect(listCases).not.toHaveBeenCalled()
  })
})

it('fills the case partner reply address from Main and still opens a manual-send draft', async () => {
  mock.handlers.clear()
  mock.open.mockClear()
  vi.mocked(assertTrustedSender).mockReset()
  const context = {
    repository: {
      validatePersonnelMessage: (input: unknown) => personnelMessageInputSchema.parse(input),
      getCaseReplyRecipient: vi.fn(() => 'partner@example.co.jp')
    }
  } as unknown as MainIpcContext
  registerPersonnelHandlers(context)
  const result = await invoke(ipcChannels.openPersonnelEmail, {
    ...valid,
    caseContext: { reviewId: '33333333-3333-4333-8333-333333333333', version: 2 }
  })
  expect(result).toEqual({ opened: true, recipientPrefilled: true })
  const url = new URL(mock.open.mock.calls[0]![0])
  expect(decodeURIComponent(url.pathname)).toBe('partner@example.co.jp')
  expect([...url.searchParams.keys()]).toEqual(['subject', 'body'])
  expect(url.searchParams.get('body')).toBe(valid.text)
})

describe('personnel introduction drafts IPC', () => {
  beforeEach(() => {
    mock.handlers.clear()
    vi.mocked(assertTrustedSender).mockReset()
  })
  it('stores an AI personnel introduction only for the current profile and case version, without contact details', () => {
    const caseId = '33333333-3333-4333-8333-333333333333'
    const save = vi.fn(() => [])
    registerPersonnelHandlers({
      repository: {
        savePersonnelIntroductionDrafts: save,
        getCandidateReview: vi.fn(() => ({ documentId: valid.documentId, recordStatus: 'active', profile: { version: 1 } })),
        getJobCaseReview: vi.fn(() => ({ reviewId: caseId, lifecycle: 'active', jobCase: { version: 2 } }))
      },
      currentOperator: () => ({ displayName: 'HR' })
    } as unknown as MainIpcContext)
    const input = {
      documentId: valid.documentId,
      profileVersion: 1,
      caseContext: { reviewId: caseId, version: 2 },
      style: 'standard',
      request: null,
      drafts: [{ lang: 'ja', text: 'Java経験5年の要員です。', experienceRunId: null }]
    }
    invoke(ipcChannels.savePersonnelIntroductionDrafts, input)
    expect(save).toHaveBeenCalledWith(input)
    expect(() => invoke(ipcChannels.savePersonnelIntroductionDrafts, { ...input, profileVersion: 2 })).toThrow(/资料已更新/)
    expect(() => invoke(ipcChannels.savePersonnelIntroductionDrafts, { ...input, caseContext: { reviewId: caseId, version: 1 } })).toThrow(
      /资料已更新/
    )
    expect(() =>
      invoke(ipcChannels.savePersonnelIntroductionDrafts, {
        ...input,
        drafts: [{ lang: 'ja', text: '連絡先 090-1234-5678', experienceRunId: null }]
      })
    ).toThrow(/个人信息/)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('offers stored personnel introductions only for the current profile and current case versions', () => {
    const caseId = '33333333-3333-4333-8333-333333333333'
    const draft = (over: object) => ({
      documentId: valid.documentId,
      profileVersion: 1,
      caseReviewId: null,
      jobCaseVersion: null,
      lang: 'ja',
      style: 'standard',
      text: 't',
      request: null,
      experienceRunId: null,
      generatedAt: 'now',
      ...over
    })
    const stored = [
      draft({}),
      draft({ profileVersion: 0, text: 'old profile' }),
      draft({ caseReviewId: caseId, jobCaseVersion: 2 }),
      draft({ caseReviewId: caseId, jobCaseVersion: 1, lang: 'zh' })
    ]
    registerPersonnelHandlers({
      repository: {
        listPersonnelIntroductionDrafts: vi.fn(() => stored),
        getCandidateReview: vi.fn(() => ({ profile: { version: 1 } })),
        getJobCaseReview: vi.fn(() => ({ lifecycle: 'active', jobCase: { version: 2 } }))
      },
      currentOperator: () => ({ displayName: 'HR' })
    } as unknown as MainIpcContext)
    expect(invoke(ipcChannels.listPersonnelIntroductionDrafts, valid.documentId)).toEqual([stored[0], stored[2]])
  })

  it('lets HR mark a placed person 近期可入场 (and back), but nothing else until 退场', () => {
    const save = vi.fn((input: unknown) => input)
    const placed = [{ documentId: valid.documentId, reviewId: 'r', progress: { stage: 'started' } }]
    const register = (followUps: unknown[]) =>
      registerPersonnelHandlers({
        repository: { setCandidateBusinessState: save, listBusinessFollowUps: () => followUps },
        currentOperator: () => ({ displayName: 'HR', operatorId: 'hr' })
      } as unknown as MainIpcContext)
    const input = (status: string) => ({ documentId: valid.documentId, profileVersion: 1, reviewRevision: 1, status, confirmed: true })
    register(placed)
    invoke(ipcChannels.setCandidateBusinessState, input('soon'))
    invoke(ipcChannels.setCandidateBusinessState, input('assigned'))
    expect(() => invoke(ipcChannels.setCandidateBusinessState, input('available'))).toThrow(/记录退场/)
    expect(() => invoke(ipcChannels.setCandidateBusinessState, input('paused'))).toThrow(/记录退场/)
    expect(save).toHaveBeenCalledTimes(2)
    mock.handlers.clear()
    register([])
    expect(() => invoke(ipcChannels.setCandidateBusinessState, input('assigned'))).toThrow(/确认已到岗/)
  })
  it('refuses to introduce or record as recommended a pair HR judged 不满足', async () => {
    mock.open.mockClear()
    const recommend = vi.fn()
    registerPersonnelHandlers({
      repository: {
        validatePersonnelMessage: (input: unknown) => personnelMessageInputSchema.parse(input),
        recordPersonnelCopy: vi.fn(),
        advanceBusinessProgress: recommend
      },
      currentOperator: () => ({ displayName: 'HR', operatorId: 'hr' })
    } as unknown as MainIpcContext)
    vi.mocked(rejectedByHr).mockReturnValue(true)
    const reviewId = '33333333-3333-4333-8333-333333333333'
    const message = { ...valid, caseContext: { reviewId, version: 1 } }
    expect(() => invoke(ipcChannels.validatePersonnelMessage, message)).toThrow(/不满足/)
    expect(() => invoke(ipcChannels.recordPersonnelCopy, message)).toThrow(/不满足/)
    await expect(invoke(ipcChannels.openPersonnelEmail, message)).rejects.toThrow(/不满足/)
    const pair = { documentId: valid.documentId, reviewId, expectedRevision: 0, mutationId: '44444444-4444-4444-8444-444444444444' }
    expect(() => invoke(ipcChannels.advanceBusinessProgress, { ...pair, action: 'recommend' })).toThrow(/不满足/)
    expect(recommend).not.toHaveBeenCalled()
    expect(mock.open).not.toHaveBeenCalled()
    // A general introduction (no case) is not affected.
    expect(() => invoke(ipcChannels.validatePersonnelMessage, valid)).not.toThrow()
    vi.mocked(rejectedByHr).mockReturnValue(false)
  })
})
