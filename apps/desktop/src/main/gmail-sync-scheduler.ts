const defaultIntervalMinutes = 1
const minimumIntervalMinutes = 1
const maximumIntervalMinutes = 60
const maximumBackoffMinutes = 60

/** Interval from SES_GMAIL_SYNC_INTERVAL_MINUTES: default 1, clamped to 1-60. */
export function resolveGmailSyncIntervalMinutes(raw: string | undefined): number {
  const parsed = Number.parseInt(raw?.trim() ?? '', 10)
  if (!Number.isFinite(parsed)) return defaultIntervalMinutes
  return Math.min(maximumIntervalMinutes, Math.max(minimumIntervalMinutes, parsed))
}

/** The slice of a finished sync the scheduler acts on - checkpoint status and counts only. */
export interface GmailSyncOutcome {
  personnelImported?: number
  status: 'never' | 'idle' | 'error'
  lastRun: { imported: number; duplicates: number; filtered: number; failed: number; moreAvailable?: boolean; intake?: import('@shared').GmailBusinessIntakeResult } | null
}

export interface GmailSyncSchedulerDependencies {
  intervalMinutes: number
  /** True while any sync is running - the manual button or an earlier scheduled run. */
  isSyncRunning(): boolean
  /** Managed configuration present and the Google connection readonly-connected. */
  isReadonlyConnected(): Promise<boolean>
  runSync(): Promise<GmailSyncOutcome>
  /** Fired after a run that imported at least one message. Counts only - never content. */
  onImported(counts: { personnelImported?: number; imported: number; duplicates: number; filtered: number; failed: number }): void
  /** Refresh the UI after empty, failed, and resumed runs as well. */
  onCompleted?(counts: { personnelImported?: number; imported: number; duplicates: number; filtered: number; failed: number }): void
  setTimer(callback: () => void, delayMs: number): unknown
  clearTimer(timer: unknown): void
  /** Diagnostics sink; details carry counts and fixed codes only. */
  log?(event: string, details: Record<string, number | string>): void
}

/**
 * Background cadence for the read-only Gmail sync. The first run starts five
 * seconds after launch to catch mail received while closed. Each tick skips
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

  const schedule = (waitMs = delayMs): void => {
    if (stopped) return
    if (timer !== null) deps.clearTimer(timer)
    timer = deps.setTimer(() => {
      timer = null
      void tick()
    }, waitMs)
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
    if (stopped) return
    if (!connected) {
      schedule()
      return
    }
    try {
      const outcome = await deps.runSync()
      const run = outcome.lastRun
      deps.onCompleted?.({ personnelImported: outcome.personnelImported ?? 0, imported: run?.imported ?? 0,
        duplicates: run?.duplicates ?? 0, filtered: run?.filtered ?? 0, failed: run?.failed ?? 0 })
      if (run && (run.imported > 0 || (outcome.personnelImported ?? 0) > 0)) {
        deps.onImported({ ...(outcome.personnelImported ? { personnelImported: outcome.personnelImported } : {}), imported: run.imported, duplicates: run.duplicates, filtered: run.filtered, failed: run.failed })
      }
      if (outcome.status === 'error' || (run?.intake?.casesFailed ?? 0) > 0 || (run?.intake?.personnelFailed ?? 0) > 0) {
        // The coordinator recorded a failed checkpoint without throwing; back off the same way.
        delayMs = Math.min(Math.max(delayMs, baseDelayMs) * 2, maximumDelayMs)
        deps.log?.('checkpoint-error', { nextDelayMs: delayMs })
      } else {
        delayMs = run?.moreAvailable || run?.intake?.pendingCases || run?.intake?.pendingPersonnel ? 5_000 : baseDelayMs
        deps.log?.('completed', { imported: run?.imported ?? 0, failed: run?.failed ?? 0, nextDelayMs: delayMs })
      }
    } catch (error) {
      delayMs = Math.min(Math.max(delayMs, baseDelayMs) * 2, maximumDelayMs)
      deps.log?.('failed', {
        // Sync failures raise fixed configuration/auth strings - no message content.
        reason: (error instanceof Error ? error.message : String(error)).slice(0, 200),
        nextDelayMs: delayMs
      })
    }
    schedule()
  }

  return {
    /** Continue a successful manual/connection batch without waiting a full interval. */
    requestContinuation(): void {
      if (stopped) return
      delayMs = 5_000
      schedule()
    },
    start(): void {
      if (!stopped) return
      stopped = false
      delayMs = baseDelayMs
      schedule(5_000)
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
