import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { TrayDesktopApi, TraySummary } from '@shared'
// Imported by path, not through @shared: this sandboxed preload must build to one file of its own.
import { trayIpcChannels } from '../../../../packages/shared/src/tray-channels'

function isTraySummary(value: unknown): value is TraySummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    (record.status === 'ready' || record.status === 'not-ready') &&
    (record.locale === 'zh-CN' || record.locale === 'ja-JP') &&
    typeof record.generatedAt === 'string'
  )
}

/**
 * The menu-bar panel's whole bridge: read the summary, follow its updates, open the main window somewhere,
 * prefill 问 Agent, and size or hide the panel. No other desktop API is reachable from this page.
 */
const api: TrayDesktopApi = {
  getTraySummary: () => ipcRenderer.invoke(trayIpcChannels.getTraySummary),
  onTraySummaryChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => {
      if (isTraySummary(payload)) listener(payload)
    }
    ipcRenderer.on(trayIpcChannels.traySummaryChanged, handler)
    return () => ipcRenderer.removeListener(trayIpcChannels.traySummaryChanged, handler)
  },
  openMain: (route, payload) => ipcRenderer.invoke(trayIpcChannels.openMain, payload ? { route, payload } : { route }),
  askAgent: (text) => ipcRenderer.invoke(trayIpcChannels.askAgent, text),
  resize: (height) => ipcRenderer.send(trayIpcChannels.resize, height),
  hide: () => ipcRenderer.send(trayIpcChannels.hide)
}

contextBridge.exposeInMainWorld('sesTray', api)
