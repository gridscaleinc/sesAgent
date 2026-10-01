import { contextBridge, ipcRenderer } from 'electron'
import { beforeAll, expect, it, vi } from 'vitest'
import { ipcChannels, type DesktopApi } from '@shared/contracts'
import { trayRoutes } from '@shared'

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { on: vi.fn(), removeListener: vi.fn(), invoke: vi.fn() }
}))

let api: DesktopApi
let trayNavigationRoutes: string[]
beforeAll(async () => {
  ;({ trayNavigationRoutes } = await import('./index'))
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

it('hands the main window menu-bar requests, including one waiting in Main, and drops malformed ones', async () => {
  const waiting = { id: '44444444-4444-4444-8444-444444444444', route: 'followups', followUpFilter: 'today' }
  vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce(waiting)
  const listener = vi.fn()
  const unsubscribe = api.onTrayNavigate!(listener)
  expect(ipcRenderer.invoke).toHaveBeenCalledWith(ipcChannels.takeTrayNavigation)
  await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(waiting))
  const [channel, handler] = vi.mocked(ipcRenderer.on).mock.calls.at(-1)!
  expect(channel).toBe(ipcChannels.trayNavigate)
  const agent = { id: '55555555-5555-4555-8555-555555555555', route: 'agent', text: '今天要跟进什么？' }
  handler({} as any, agent)
  expect(listener).toHaveBeenLastCalledWith(agent)
  for (const invalid of [
    null,
    { ...agent, id: 'not-a-uuid' },
    { ...agent, route: 'settings:privacy' },
    { ...agent, text: 'x'.repeat(2001) },
    { ...agent, caseView: 'all' },
    { ...agent, url: 'https://example.invalid' }
  ])
    handler({} as any, invalid)
  expect(listener).toHaveBeenCalledTimes(2)
  unsubscribe()
  expect(ipcRenderer.removeListener).toHaveBeenCalledWith(channel, handler)
})

it('knows every menu-bar route Main can send', () => {
  expect(trayNavigationRoutes).toEqual([...trayRoutes])
})

it('reads the 今天 summary over the main-window channel and follows only well-formed pushes', () => {
  void api.getTodaySummary!()
  expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(ipcChannels.getTodaySummary)
  const listener = vi.fn()
  const unsubscribe = api.onTodaySummaryChanged!(listener)
  const [channel, handler] = vi.mocked(ipcRenderer.on).mock.calls.at(-1)!
  expect(channel).toBe(ipcChannels.todaySummaryChanged)
  const notReady = { status: 'not-ready', locale: 'zh-CN', generatedAt: '2026-10-01T01:00:00.000Z' }
  handler({} as any, notReady)
  handler({} as any, { ...notReady, status: 'ready', lists: { followUps: [] } })
  for (const invalid of [null, { ...notReady, locale: 'en' }, { ...notReady, status: 'ready' }, { ...notReady, generatedAt: 1 }])
    handler({} as any, invalid)
  expect(listener).toHaveBeenCalledTimes(2)
  unsubscribe()
  expect(ipcRenderer.removeListener).toHaveBeenCalledWith(channel, handler)
})
