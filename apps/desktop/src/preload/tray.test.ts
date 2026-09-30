import { contextBridge, ipcRenderer } from 'electron'
import { beforeAll, expect, it, vi } from 'vitest'
import { trayIpcChannels, type TrayDesktopApi } from '@shared'

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { on: vi.fn(), removeListener: vi.fn(), invoke: vi.fn(), send: vi.fn() }
}))

let name: string
let api: TrayDesktopApi
beforeAll(async () => {
  await import('./tray')
  ;[name, api] = vi.mocked(contextBridge.exposeInMainWorld).mock.calls[0]! as [string, TrayDesktopApi]
})

it('exposes only the panel bridge, under its own name', () => {
  expect(name).toBe('sesTray')
  expect(Object.keys(api).sort()).toEqual(['askAgent', 'getTraySummary', 'hide', 'onTraySummaryChanged', 'openMain', 'resize'])
  expect(vi.mocked(contextBridge.exposeInMainWorld)).toHaveBeenCalledTimes(1)
})

it('maps each call to its tray channel', () => {
  void api.getTraySummary()
  expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(trayIpcChannels.getTraySummary)
  void api.openMain('cases', { caseView: 'unseen' })
  expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(trayIpcChannels.openMain, { route: 'cases', payload: { caseView: 'unseen' } })
  void api.openMain('cases:new')
  expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(trayIpcChannels.openMain, { route: 'cases:new' })
  void api.askAgent('今天有哪些新案件？')
  expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(trayIpcChannels.askAgent, '今天有哪些新案件？')
  api.resize(412)
  expect(ipcRenderer.send).toHaveBeenLastCalledWith(trayIpcChannels.resize, 412)
  api.hide()
  expect(ipcRenderer.send).toHaveBeenLastCalledWith(trayIpcChannels.hide)
  // Nothing reaches a main-window channel.
  const channels = [...vi.mocked(ipcRenderer.invoke).mock.calls, ...vi.mocked(ipcRenderer.send).mock.calls].map(([channel]) => channel)
  expect(channels.every((channel) => Object.values(trayIpcChannels).includes(channel as never))).toBe(true)
})

it('delivers summary pushes that look like a summary and unsubscribes', () => {
  const listener = vi.fn()
  const stop = api.onTraySummaryChanged(listener)
  const [channel, handler] = vi.mocked(ipcRenderer.on).mock.calls.at(-1)!
  expect(channel).toBe(trayIpcChannels.traySummaryChanged)
  const summary = { status: 'not-ready', locale: 'zh-CN', generatedAt: '2026-10-01T00:00:00.000Z' }
  handler({} as never, summary)
  for (const invalid of [null, [], { ...summary, status: 'other' }, { ...summary, locale: 'fr-FR' }]) handler({} as never, invalid)
  expect(listener).toHaveBeenCalledTimes(1)
  expect(listener).toHaveBeenCalledWith(summary)
  stop()
  expect(ipcRenderer.removeListener).toHaveBeenCalledWith(channel, handler)
})
