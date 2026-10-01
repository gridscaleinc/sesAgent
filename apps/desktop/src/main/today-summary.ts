import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { ipcChannels, type ApplicationLocale, type TodaySummary } from '@shared'

/** Local data is re-read at least this often while the main window is open; a data change is picked up per poll. */
export const todayRefreshIntervalMs = 60_000
export const todayPollIntervalMs = 10_000

export interface TodaySummaryServiceOptions {
  /** Throws, or reports not-ready, when local data cannot be read. */
  load(options: { refreshWallet: boolean }): Promise<TodaySummary>
  /** Local data revision; a change triggers a recompute before the next full interval. */
  dataRevision(): number | null
  locale(): ApplicationLocale
  /** The main window's contents while it is open; updates are pushed only there. */
  target(): WebContents | null
  /** The main-window trust boundary (assertTrustedSender): the menu-bar panel never reaches this channel. */
  assertSender(event: IpcMainInvokeEvent): void
}

/**
 * The main window's 「今天」 summary: the menu-bar panel's local-only numbers with their lists and person names.
 * The page reads it once and then follows the pushes sent whenever the local data (or the AI state) changes.
 */
export function registerTodaySummary(options: TodaySummaryServiceOptions) {
  let pushed = ''
  let refreshedAt = 0
  let revision: number | null = null
  let inflight: Promise<TodaySummary> | null = null

  /** A reply to the page's own request is its answer; only changes found otherwise are pushed. */
  const refresh = (refreshWallet = false, push = true): Promise<TodaySummary> => {
    if (inflight) return inflight
    inflight = (async () => {
      let next: TodaySummary
      try {
        next = await options.load({ refreshWallet })
      } catch {
        next = { status: 'not-ready', locale: options.locale(), generatedAt: new Date().toISOString() }
      }
      refreshedAt = Date.now()
      const comparable = JSON.stringify({ ...next, generatedAt: null })
      if (push && comparable !== pushed) {
        const target = options.target()
        if (target && !target.isDestroyed()) target.send(ipcChannels.todaySummaryChanged, next)
      }
      pushed = comparable
      return next
    })().finally(() => {
      inflight = null
    })
    return inflight
  }

  ipcMain.removeHandler(ipcChannels.getTodaySummary)
  ipcMain.handle(ipcChannels.getTodaySummary, async (event) => {
    options.assertSender(event)
    return refresh(true, false)
  })

  const timer = setInterval(() => {
    if (!options.target()) return
    let current: number | null = null
    try {
      current = options.dataRevision()
    } catch {
      current = null
    }
    const changed = current !== revision
    revision = current
    if (changed || Date.now() - refreshedAt >= todayRefreshIntervalMs) void refresh()
  }, todayPollIntervalMs)
  timer.unref?.()

  return {
    refresh: () => void refresh(),
    dispose() {
      clearInterval(timer)
      ipcMain.removeHandler(ipcChannels.getTodaySummary)
    }
  }
}

export type TodaySummaryService = ReturnType<typeof registerTodaySummary>
