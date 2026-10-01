import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { ipcChannels } from '@shared'
import { registerInterviewHandlers } from './interviews'
import type { MainIpcContext } from './context'

const mock = vi.hoisted(() => ({ handlers: new Map<string, (e: IpcMainInvokeEvent, raw?: unknown) => unknown>() }))
vi.mock('electron', () => ({
  ipcMain: { handle: (key: string, handler: (e: IpcMainInvokeEvent, raw?: unknown) => unknown) => mock.handlers.set(key, handler) },
  shell: { openExternal: vi.fn() }
}))
vi.mock('./context', () => ({ assertTrustedSender: vi.fn() }))

const invoke = (channel: string, input?: unknown) =>
  mock.handlers.get(channel)!({ sender: { id: 1 } } as unknown as IpcMainInvokeEvent, input)
const sourceDocumentId = '11111111-1111-4111-8111-111111111111'
const legacyId = '22222222-2222-4222-8222-222222222222'
const schedule = {
  sourceDocumentId,
  scheduledAt: '2026-10-08T01:00:00.000Z',
  durationMinutes: 60,
  meetingMethod: 'phone' as const,
  interviewer: 'HR'
}

describe('interview IPC', () => {
  const save = vi.fn((input: unknown) => input)
  const createRound = vi.fn((input: unknown) => input)
  beforeEach(() => {
    mock.handlers.clear()
    save.mockClear()
    createRound.mockClear()
    registerInterviewHandlers({
      repository: {
        listCandidateInterviews: () => [{ id: legacyId, kind: 'client', sourceDocumentId }],
        saveCandidateInterviewSchedule: save,
        createCandidateInterviewRound: createRound
      },
      currentOperator: () => ({ displayName: 'HR' })
    } as unknown as MainIpcContext)
  })

  it('books a new client interview only on a case’s 跟进, while an older one can still be corrected', () => {
    expect(() => invoke(ipcChannels.saveCandidateInterviewSchedule, { ...schedule, kind: 'client' })).toThrow(/跟进/)
    expect(() => invoke(ipcChannels.createCandidateInterviewRound, { sourceDocumentId, parentInterviewId: legacyId })).toThrow(/跟进/)
    expect(save).not.toHaveBeenCalled()
    expect(createRound).not.toHaveBeenCalled()
    invoke(ipcChannels.saveCandidateInterviewSchedule, { ...schedule, kind: 'client', interviewId: legacyId })
    invoke(ipcChannels.saveCandidateInterviewSchedule, { ...schedule, kind: 'recruiting' })
    expect(save).toHaveBeenCalledTimes(2)
  })
})
