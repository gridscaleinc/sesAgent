const defaultIntervalMinutes = 15
const minimumIntervalMinutes = 5
const maximumIntervalMinutes = 60
const maximumBackoffMinutes = 60

/** Interval from SES_GMAIL_SYNC_INTERVAL_MINUTES: default 15, clamped to 5-60. */
export function resolveGmailSyncIntervalMinutes(raw: string | undefined): number {
  const parsed = Number.parseInt(raw?.trim() ?? '', 10)
  if (!Number.isFinite(parsed)) return defaultIntervalMinutes
  return Math.min(maximumIntervalMinutes, Math.max(minimumIntervalMinutes, parsed))
}

/** The slice of a finished sync the scheduler acts on - checkpoint status and counts only. */
export interface GmailSyncOutcome {
  status: 'never' | 'idle' | 'error'
  lastRun: { imported: number; duplicates: number; filtered: number; failed: number } | null
}

export interface GmailSyncSchedulerDependencies {
  intervalMinutes: number
  /** True while any sync is running - the manual button or an earlier scheduled run. */
  isSyncRunning(): boolean
  /** Managed configuration present and the Google connection readonly-connected. */
  isReadonlyConnected(): Promise<boolean>
  runSync(): Promise<GmailSyncOutcome>
  /** Fired after a run that imported at least one message. Counts only - never content. */
  onImported(counts: { imported: number; duplicates: number; filtered: number; failed: number }): void
  setTimer(callback: () => void, delayMs: number): unknown
  clearTimer(timer: unknown): void
  /** Diagnostics sink; details carry counts and fixed codes only. */
  log?(event: string, details: Record<string, number | string>): void
}

/**
 * Background cadence for the read-only Gmail sync. The first run waits one
 * full interval after start - launch stays quiet - and each tick skips
 * silently while another sync is running or the connection is not
 * readonly-connected. A failed run doubles the wait (capped at one hour);
 * a successful run resets it to the configured interval.
 */
export function createGmailSyncScheduler(deps: GmailSyncSchedulerDependencies) {
  const baseDelayMs = deps.intervalMinutes * 60_000
  const maximumDelayMs = maximumBackoffMinutes * 60_000
  let delayMs = baseDelayMs
  let timer: unknown = null
  let stopped = true

  const schedule = (): void => {
    if (stopped) return
    timer = deps.setTimer(() => {
      void tick()
    }, delayMs)
  }

  const tick = async (): Promise<void> => {
    if (stopped) return
    if (deps.isSyncRunning()) {
      // A manual or still-running scheduled sync owns this window; never stack a second one.
      schedule()
      return
    }
    let connected = false
    try {
      connected = await deps.isReadonlyConnected()
    } catch {
      connected = false
    }
    if (!connected) {
      schedule()
      return
    }
    try {
      const outcome = await deps.runSync()
      const run = outcome.lastRun
      if (run && run.imported > 0) {
        deps.onImported({ imported: run.imported, duplicates: run.duplicates, filtered: run.filtered, failed: run.failed })
      }
      if (outcome.status === 'error') {
        // The coordinator recorded a failed checkpoint without throwing; back off the same way.
        delayMs = Math.min(delayMs * 2, maximumDelayMs)
        deps.log?.('checkpoint-error', { nextDelayMs: delayMs })
      } else {
        delayMs = baseDelayMs
        deps.log?.('completed', run ? { ...run, nextDelayMs: delayMs } : { nextDelayMs: delayMs })
      }
    } catch (error) {
      delayMs = Math.min(delayMs * 2, maximumDelayMs)
      deps.log?.('failed', {
        // Sync failures raise fixed configuration/auth strings - no message content.
        reason: (error instanceof Error ? error.message : String(error)).slice(0, 200),
        nextDelayMs: delayMs
      })
    }
    schedule()
  }

  return {
    start(): void {
      if (!stopped) return
      stopped = false
      delayMs = baseDelayMs
      schedule()
    },
    stop(): void {
      stopped = true
      if (timer !== null) {
        deps.clearTimer(timer)
        timer = null
      }
    }
  }
}
