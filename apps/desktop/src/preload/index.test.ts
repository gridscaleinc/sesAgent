import { contextBridge, ipcRenderer } from 'electron'
import { beforeAll, expect, it, vi } from 'vitest'
import { ipcChannels, type DesktopApi } from '@shared/contracts'

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { on: vi.fn(), removeListener: vi.fn(), invoke: vi.fn() }
}))

let api: DesktopApi
beforeAll(async () => {
  await import('./index')
  api = vi.mocked(contextBridge.exposeInMainWorld).mock.calls[0]![1] as DesktopApi
})

it('delivers actual scheduler payloads, including zero personnel imports, and unsubscribes', () => {
  const listener = vi.fn()
  const unsubscribe = api.onGmailSyncCompleted(listener)
  const [channel, handler] = vi.mocked(ipcRenderer.on).mock.calls.at(-1)!
  expect(channel).toBe(ipcChannels.gmailSyncCompleted)
  for (const personnelImported of [0, 2]) {
    const payload = { personnelImported, imported: 1, duplicates: 0, filtered: 0, failed: 0 }
    handler({} as any, payload)
    expect(listener).toHaveBeenLastCalledWith(payload)
  }
  expect(listener).toHaveBeenCalledTimes(2)
  unsubscribe()
  expect(ipcRenderer.removeListener).toHaveBeenCalledWith(channel, handler)
})

it('keeps legacy counts valid and drops invalid counts or content-bearing payloads', () => {
  const listener = vi.fn()
  api.onGmailSyncCompleted(listener)
  const handler = vi.mocked(ipcRenderer.on).mock.calls.at(-1)![1]
  const counts = { imported: 0, duplicates: 0, filtered: 0, failed: 0 }
  handler({} as any, counts)
  expect(listener).toHaveBeenCalledTimes(1)
  for (const payload of [
    { ...counts, personnelImported: -1 },
    { ...counts, personnelImported: 1.5 },
    { ...counts, personnelImported: '1' },
    { ...counts, imported: NaN },
    { ...counts, personnelImported: 0, subject: 'private content' },
    { imported: 0 },
    null
  ])
    handler({} as any, payload)
  expect(listener).toHaveBeenCalledTimes(1)
})

it('validates case import progress and removes its scoped listener', () => {
  const listener = vi.fn()
  const unsubscribe = api.onCaseResumeImportProgress(listener)
  const [channel, handler] = vi.mocked(ipcRenderer.on).mock.calls.at(-1)!
  expect(channel).toBe(ipcChannels.caseResumeImportProgress)
  const payload = {
    requestId: '11111111-1111-4111-8111-111111111111',
    jobCaseId: '22222222-2222-4222-8222-222222222222',
    stage: 'parsing',
    documentId: null
  }
  handler({} as any, payload)
  expect(listener).toHaveBeenCalledWith(payload)
  for (const invalid of [null, { ...payload, stage: 'done' }, { ...payload, requestId: 'wrong' }, { ...payload, text: 'unexpected' }])
    handler({} as any, invalid)
  expect(listener).toHaveBeenCalledTimes(1)
  unsubscribe()
  expect(ipcRenderer.removeListener).toHaveBeenCalledWith(channel, handler)
})
