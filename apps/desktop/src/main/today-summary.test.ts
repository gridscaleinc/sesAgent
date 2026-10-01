// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ipcChannels, type TodaySummary } from '@shared'

const handlers = vi.hoisted(() => new Map<string, (event: unknown, ...args: unknown[]) => unknown>())
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel)
  }
}))

const { registerTodaySummary, todayPollIntervalMs } = await import('./today-summary')

const ready = (count: number) =>
  ({ status: 'ready', locale: 'zh-CN', generatedAt: new Date().toISOString(), followUpsDueToday: count }) as unknown as TodaySummary
const mainWindow = { url: 'ses-agent://app/' }
const trayPanel = { url: 'ses-agent://app/tray.html' }

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  handlers.clear()
})

function setup(load: (options: { refreshWallet: boolean }) => Promise<TodaySummary>) {
  let revision = 1
  const send = vi.fn()
  const service = registerTodaySummary({
    load: vi.fn(load),
    dataRevision: () => revision,
    locale: () => 'ja-JP',
    target: () => ({ send, isDestroyed: () => false }) as never,
    assertSender: (event) => {
      if ((event as unknown as typeof mainWindow).url !== mainWindow.url) throw new Error('Blocked IPC request from an untrusted renderer.')
    }
  })
  return { service, send, bump: () => (revision += 1) }
}

it('answers the main window with the summary and refreshes the wallet, never the menu-bar panel', async () => {
  const load = vi.fn(async () => ready(2))
  const { service } = setup(load)
  const handler = handlers.get(ipcChannels.getTodaySummary)!
  await expect(handler(mainWindow)).resolves.toMatchObject({ status: 'ready', followUpsDueToday: 2 })
  expect(load).toHaveBeenCalledWith({ refreshWallet: true })
  await expect(Promise.resolve().then(() => handler(trayPanel))).rejects.toThrow(/untrusted/u)
  service.dispose()
  expect(handlers.has(ipcChannels.getTodaySummary)).toBe(false)
})

it('pushes a changed summary after local data changes, and nothing when it is the same', async () => {
  let count = 1
  const { service, send, bump } = setup(async () => ready(count))
  await handlers.get(ipcChannels.getTodaySummary)!(mainWindow)
  await vi.advanceTimersByTimeAsync(todayPollIntervalMs)
  expect(send).not.toHaveBeenCalled()
  count = 3
  bump()
  await vi.advanceTimersByTimeAsync(todayPollIntervalMs)
  expect(send).toHaveBeenCalledWith(ipcChannels.todaySummaryChanged, expect.objectContaining({ followUpsDueToday: 3 }))
  service.dispose()
})

it('reports not-ready when local data cannot be read', async () => {
  const { service } = setup(async () => {
    throw new Error('locked')
  })
  await expect(handlers.get(ipcChannels.getTodaySummary)!(mainWindow)).resolves.toMatchObject({ status: 'not-ready', locale: 'ja-JP' })
  service.dispose()
})
