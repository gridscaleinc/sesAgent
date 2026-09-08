import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { ipcChannels, personnelMessageInputSchema } from '@shared'
import { registerPersonnelHandlers } from './personnel'
import { assertTrustedSender, type MainIpcContext } from './context'
const mock = vi.hoisted(() => ({ handlers: new Map<string, (e: IpcMainInvokeEvent, raw?: unknown) => unknown>(), open: vi.fn(async (_url: string) => {}) }))
vi.mock('electron', () => ({ ipcMain: { handle: (key: string, handler: (e: IpcMainInvokeEvent, raw?: unknown) => unknown) => mock.handlers.set(key, handler) }, shell: { openExternal: mock.open } }))
vi.mock('./context', () => ({ assertTrustedSender: vi.fn() }))
const valid = { documentId: '11111111-1111-4111-8111-111111111111', profileVersion: 1, templateId: '22222222-2222-4222-8222-222222222222', templateRevision: 1, lang: 'ja', text: 'Java & AWS\n?cc=someone@example.test #紹介' }
const invoke = (channel: string, input?: unknown) => mock.handlers.get(channel)!({} as IpcMainInvokeEvent, input)
describe('personnel IPC', () => {
  beforeEach(() => { mock.handlers.clear(); mock.open.mockClear(); vi.mocked(assertTrustedSender).mockReset() })
  it('saves only affiliation with the current operator and rejects untrusted senders', () => {
    const input = { documentId: valid.documentId, expectedVersion: 1, isOwnCompany: true }
    const review = { documentId: valid.documentId, isOwnCompany: true }
    const save = vi.fn(() => ({ sourceDocumentId: valid.documentId }))
    registerPersonnelHandlers({ repository: { setCandidateOwnCompany: save, getCandidateReview: vi.fn(() => review) },
      currentOperator: () => ({ displayName: 'HR' }) } as unknown as MainIpcContext)
    expect(invoke(ipcChannels.setCandidateOwnCompany, input)).toEqual(review)
    expect(save).toHaveBeenCalledWith(input, 'HR')
    vi.mocked(assertTrustedSender).mockImplementation(() => { throw new Error('untrusted') })
    expect(() => invoke(ipcChannels.setCandidateOwnCompany, input)).toThrow('untrusted')
    expect(save).toHaveBeenCalledTimes(1)
  })
  it('opens an empty-recipient mail draft with the entire body encoded and no send record', async () => {
    const recordCopy = vi.fn()
    registerPersonnelHandlers({ repository: { validatePersonnelMessage: (input: unknown) => personnelMessageInputSchema.parse(input), recordPersonnelCopy: recordCopy } } as unknown as MainIpcContext)
    await invoke(ipcChannels.openPersonnelEmail, valid)
    const url = new URL(mock.open.mock.calls[0]![0] as unknown as string)
    expect(url.pathname).toBe('')
    expect([...url.searchParams.keys()]).toEqual(['subject', 'body'])
    expect(url.searchParams.get('body')).toBe(valid.text)
    expect(recordCopy).not.toHaveBeenCalled()
    expect(assertTrustedSender).toHaveBeenCalled()
  })
  it('does not open mail when validation or the sender check fails', async () => {
    registerPersonnelHandlers({ repository: { validatePersonnelMessage: () => { throw new Error('stale profile') } } } as unknown as MainIpcContext)
    await expect(invoke(ipcChannels.openPersonnelEmail, valid)).rejects.toThrow('stale profile')
    vi.mocked(assertTrustedSender).mockImplementation(() => { throw new Error('untrusted') })
    expect(() => invoke(ipcChannels.getPersonnelWorkspace)).toThrow('untrusted')
    expect(mock.open).not.toHaveBeenCalled()
  })
  it('rejects matching for personnel outside the currently eligible set', async () => {
    const listCases = vi.fn()
    registerPersonnelHandlers({ repository: { listEligibleTalentProfiles: () => [], listActiveJobCases: listCases } } as unknown as MainIpcContext)
    await expect(invoke(ipcChannels.findCasesForPersonnel, valid.documentId)).rejects.toThrow('已停用')
    expect(listCases).not.toHaveBeenCalled()
  })
})
