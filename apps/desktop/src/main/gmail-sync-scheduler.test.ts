import { describe, expect, it, vi } from 'vitest'
import {
  createGmailSyncScheduler,
  resolveGmailSyncIntervalMinutes,
  type GmailSyncOutcome,
  type GmailSyncSchedulerDependencies
} from './gmail-sync-scheduler'

const minute = 60_000

function outcome(overrides: Partial<GmailSyncOutcome> = {}): GmailSyncOutcome {
  return { status: 'idle', lastRun: { imported: 0, duplicates: 0, filtered: 0, failed: 0 }, ...overrides }
}

function harness(overrides: Partial<GmailSyncSchedulerDependencies> = {}) {
  const timers: Array<{ callback: () => void; delayMs: number }> = []
  const deps: GmailSyncSchedulerDependencies = {
    intervalMinutes: 15,
    isSyncRunning: vi.fn(() => false),
    isReadonlyConnected: vi.fn(async () => true),
    runSync: vi.fn(async () => outcome()),
    onImported: vi.fn(),
    setTimer: vi.fn((callback: () => void, delayMs: number) => {
      timers.push({ callback, delayMs })
      return timers.length - 1
    }),
    clearTimer: vi.fn(),
    ...overrides
  }
  const scheduler = createGmailSyncScheduler(deps)
  const runNextTimer = async () => {
    timers[timers.length - 1]!.callback()
    // The tick is async; let its promise chain settle before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { deps, scheduler, timers, runNextTimer }
}

describe('resolveGmailSyncIntervalMinutes', () => {
  it('defaults to 1 and clamps to 1-60 minutes', () => {
    expect(resolveGmailSyncIntervalMinutes(undefined)).toBe(1)
    expect(resolveGmailSyncIntervalMinutes('')).toBe(1)
    expect(resolveGmailSyncIntervalMinutes('nonsense')).toBe(1)
    expect(resolveGmailSyncIntervalMinutes('30')).toBe(30)
    expect(resolveGmailSyncIntervalMinutes('4')).toBe(4)
    expect(resolveGmailSyncIntervalMinutes('0')).toBe(1)
    expect(resolveGmailSyncIntervalMinutes('120')).toBe(60)
  })
})

describe('createGmailSyncScheduler', () => {
  it('catches up soon after startup and keeps the configured cadence after success', async () => {
    const { deps, scheduler, timers, runNextTimer } = harness()
    scheduler.start()
    expect(deps.runSync).not.toHaveBeenCalled()
    expect(timers[0]!.delayMs).toBe(5_000)
    await runNextTimer()
    expect(deps.runSync).toHaveBeenCalledTimes(1)
    expect(timers[1]!.delayMs).toBe(15 * minute)
  })

  it('checks new mail every minute by default without manual intervention', async () => {
    vi.useFakeTimers()
    try {
      const { deps, scheduler } = harness({
        intervalMinutes: resolveGmailSyncIntervalMinutes(undefined),
        setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>)
      })
      scheduler.start()
      await vi.advanceTimersByTimeAsync(4_999)
      expect(deps.runSync).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(deps.runSync).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(minute - 1)
      expect(deps.runSync).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(deps.runSync).toHaveBeenCalledTimes(2)
      scheduler.stop()
      await vi.advanceTimersByTimeAsync(minute)
      expect(deps.runSync).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips the tick while another sync - manual or scheduled - is running', async () => {
    const { deps, scheduler, timers, runNextTimer } = harness({ isSyncRunning: vi.fn(() => true) })
    scheduler.start()
    await runNextTimer()
    expect(deps.runSync).not.toHaveBeenCalled()
    expect(timers).toHaveLength(2)
  })

  it('runs only while the connection is readonly-connected', async () => {
    const { deps, scheduler, timers, runNextTimer } = harness({ isReadonlyConnected: vi.fn(async () => false) })
    scheduler.start()
    await runNextTimer()
    expect(deps.runSync).not.toHaveBeenCalled()
    expect(timers).toHaveLength(2)
    expect(timers[1]!.delayMs).toBe(15 * minute)
  })

  it('does not start a sync if stopped while checking the connection', async () => {
    const { deps, scheduler, timers, runNextTimer } = harness({
      isReadonlyConnected: vi.fn(async () => {
        scheduler.stop()
        return true
      })
    })
    scheduler.start()
    await runNextTimer()
    expect(deps.runSync).not.toHaveBeenCalled()
    expect(timers).toHaveLength(1)
  })

  it('doubles the wait after a failure up to 60 minutes and resets after success', async () => {
    const runSync = vi
      .fn()
      .mockRejectedValueOnce(new Error('GMAIL_SYNC_FAILED'))
      .mockRejectedValueOnce(new Error('GMAIL_SYNC_FAILED'))
      .mockRejectedValueOnce(new Error('GMAIL_SYNC_FAILED'))
      .mockResolvedValue(outcome())
    const { scheduler, timers, runNextTimer } = harness({ runSync })
    scheduler.start()
    await runNextTimer()
    expect(timers[1]!.delayMs).toBe(30 * minute)
    await runNextTimer()
    expect(timers[2]!.delayMs).toBe(60 * minute)
    await runNextTimer()
    expect(timers[3]!.delayMs).toBe(60 * minute)
    await runNextTimer()
    expect(timers[4]!.delayMs).toBe(15 * minute)
  })

  it('treats a run that recorded an error checkpoint as a failure for the backoff', async () => {
    const runSync = vi.fn(async () => outcome({ status: 'error' }))
    const { scheduler, timers, runNextTimer } = harness({ runSync })
    scheduler.start()
    await runNextTimer()
    expect(timers[1]!.delayMs).toBe(30 * minute)
  })

  it('notifies counts only, and only when a run imported at least one message', async () => {
    const runSync = vi
      .fn()
      .mockResolvedValueOnce(outcome())
      .mockResolvedValueOnce(outcome({ lastRun: { imported: 3, duplicates: 1, filtered: 2, failed: 0 } }))
    const { deps, scheduler, runNextTimer } = harness({ runSync })
    scheduler.start()
    await runNextTimer()
    expect(deps.onImported).not.toHaveBeenCalled()
    await runNextTimer()
    expect(deps.onImported).toHaveBeenCalledTimes(1)
    expect(deps.onImported).toHaveBeenCalledWith({ imported: 3, duplicates: 1, filtered: 2, failed: 0 })
  })

  it('stop clears the pending timer and a late tick does nothing', async () => {
    const { deps, scheduler, timers, runNextTimer } = harness()
    scheduler.start()
    scheduler.stop()
    expect(deps.clearTimer).toHaveBeenCalledWith(0)
    await runNextTimer()
    expect(deps.runSync).not.toHaveBeenCalled()
    expect(timers).toHaveLength(1)
  })

  it('continues a backlog promptly, refreshes empty/error results, and backs off intake failures', async () => {
    const onCompleted = vi.fn()
    const runSync = vi
      .fn()
      .mockResolvedValueOnce(outcome({ lastRun: { imported: 0, duplicates: 2, filtered: 0, failed: 0, moreAvailable: true } }))
      .mockResolvedValueOnce(
        outcome({ lastRun: { imported: 0, duplicates: 0, filtered: 0, failed: 0, intake: { casesFailed: 1 } } as any })
      )
      .mockResolvedValueOnce(outcome({ status: 'error', lastRun: null }))
    const { scheduler, timers, runNextTimer } = harness({ runSync, onCompleted })
    scheduler.start()
    await runNextTimer()
    expect(timers[1]!.delayMs).toBe(5_000)
    await runNextTimer()
    expect(timers[2]!.delayMs).toBe(30 * minute)
    await runNextTimer()
    expect(onCompleted).toHaveBeenCalledTimes(3)
    expect(timers[3]!.delayMs).toBe(60 * minute)
  })

  it('replaces the waiting timer after a manual batch and ignores requests after stop', () => {
    const { scheduler, timers, deps } = harness()
    scheduler.start()
    scheduler.requestContinuation()
    expect(deps.clearTimer).toHaveBeenCalledWith(0)
    expect(timers[1]!.delayMs).toBe(5_000)
    scheduler.stop()
    scheduler.requestContinuation()
    expect(timers).toHaveLength(2)
  })
})
