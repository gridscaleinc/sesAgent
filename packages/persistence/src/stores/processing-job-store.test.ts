// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkTaskPreview, materializeWorkTask } from '@application'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'

const t0 = new Date('2026-09-01T00:00:00.000Z')
const at = (ms: number) => new Date(t0.getTime() + ms)

describe.skipIf(!nativeSqliteAvailable)('ProcessingJobStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
    handle.repository.saveWorkTask(
      materializeWorkTask(createWorkTaskPreview('JavaとAWSの候補者を検索したい'), 'task-jobs', t0.toISOString())
    )
  })
  afterEach(() => handle.dispose())

  const input = (overrides: Record<string, unknown> = {}) => ({
    type: 'candidate-match' as const,
    workTaskId: 'task-jobs',
    taskStepId: 'step-1',
    idempotencyKey: '1'.repeat(64),
    requestFingerprint: '2'.repeat(64),
    payloadRef: 'match-run:abc',
    replayPolicy: 'safe-local' as const,
    ...overrides
  })

  it('runs enqueue -> lease -> progress -> complete and verifies the stored result', () => {
    const { repository } = handle
    const job = repository.enqueueProcessingJob(input(), t0)
    expect(job).toMatchObject({ status: 'queued', progress: 0 })
    // Same key + same fingerprint is idempotent.
    expect(repository.enqueueProcessingJob(input(), t0).id).toBe(job.id)
    expect(repository.listProcessingJobs('task-jobs')).toHaveLength(1)

    const lease = repository.acquireProcessingJob(job.id, 60_000, at(1_000))
    expect(lease?.job.status).toBe('running')
    expect(repository.acquireProcessingJob(job.id, 60_000, at(2_000))).toBeNull()
    expect(() => repository.updateProcessingJobProgress(job.id, 'wrong-token', 50)).toThrow(/no longer active/)
    expect(repository.updateProcessingJobProgress(job.id, lease!.leaseToken, 250, at(3_000)).progress).toBe(99)
    expect(repository.getProcessingJobResult(job.id)).toBeNull()
    const completion = repository.completeProcessingJob(job.id, lease!.leaseToken, { ranked: ['a', 'b'] }, at(4_000))
    expect(completion).toMatchObject({ accepted: true, job: { status: 'succeeded', progress: 100 } })
    expect(handle.reopen().getProcessingJobResult(job.id)).toEqual({ ranked: ['a', 'b'] })
    expect(() => handle.repository.completeProcessingJob(job.id, lease!.leaseToken, {}, at(5_000))).toThrow(/no longer active/)
  })

  it('rejects idempotency key collisions, unknown tasks and invalid inputs', () => {
    const { repository } = handle
    repository.enqueueProcessingJob(input(), t0)
    expect(() => repository.enqueueProcessingJob(input({ requestFingerprint: '3'.repeat(64) }), t0)).toThrow(/collision/)
    expect(() => repository.enqueueProcessingJob(input({ idempotencyKey: '4'.repeat(64), workTaskId: 'missing' }), t0)).toThrow(
      /work task was not found/
    )
    expect(() => repository.enqueueProcessingJob(input({ idempotencyKey: 'not-hex' }), t0)).toThrow()
    expect(() => repository.acquireProcessingJob(repository.listProcessingJobs()[0]!.id, 10)).toThrow(/lease duration/)
  })

  it('retries retryable failures with backoff, then fails once attempts are exhausted', () => {
    const { repository } = handle
    const job = repository.enqueueProcessingJob(input({ maxAttempts: 2 }), t0)
    const first = repository.acquireProcessingJob(job.id, 60_000, at(0))!
    expect(() => repository.failProcessingJob(job.id, first.leaseToken, 'lowercase', true)).toThrow(/error code/)
    const waiting = repository.failProcessingJob(job.id, first.leaseToken, 'WORKER_CRASHED', true, null, at(1_000))
    expect(waiting.status).toBe('retry_wait')
    // Not yet due.
    expect(repository.acquireProcessingJob(job.id, 60_000, at(2_000))).toBeNull()
    const second = repository.acquireProcessingJob(job.id, 60_000, at(10_000))!
    expect(second).not.toBeNull()
    expect(repository.failProcessingJob(job.id, second.leaseToken, 'WORKER_CRASHED', true, null, at(11_000)).status).toBe('failed')
    // Manual retry of a safe-local job requeues it.
    expect(repository.retryProcessingJobsForTask('task-jobs', at(12_000))[0]).toMatchObject({ status: 'queued' })
  })

  it('cancels queued jobs, refuses results after cancellation, and recovers expired leases by replay policy', () => {
    const { repository } = handle
    const queued = repository.enqueueProcessingJob(input(), t0)
    const running = repository.enqueueProcessingJob(input({ idempotencyKey: '5'.repeat(64), requestFingerprint: '6'.repeat(64) }), t0)
    const lease = repository.acquireProcessingJob(running.id, 60_000, at(0))!
    const afterCancel = repository.requestProcessingJobCancellationForTask('task-jobs', at(1_000))
    expect(afterCancel.find((job) => job.id === queued.id)?.status).toBe('cancelled')
    expect(repository.isProcessingJobCancellationRequested(running.id, lease.leaseToken)).toBe(true)
    expect(repository.completeProcessingJob(running.id, lease.leaseToken, { late: true }, at(2_000))).toMatchObject({
      accepted: false,
      job: { status: 'cancelled' }
    })
    expect(repository.getProcessingJobResult(running.id)).toBeNull()

    const safe = repository.enqueueProcessingJob(input({ idempotencyKey: '7'.repeat(64), requestFingerprint: '8'.repeat(64) }), t0)
    const manual = repository.enqueueProcessingJob(
      input({
        idempotencyKey: '9'.repeat(64),
        requestFingerprint: 'a'.repeat(64),
        replayPolicy: 'manual-review'
      }),
      t0
    )
    repository.acquireProcessingJob(safe.id, 1_000, at(0))
    repository.acquireProcessingJob(manual.id, 1_000, at(0))
    expect(repository.recoverExpiredProcessingJobs(at(500))).toEqual({ requeued: 0, reviewRequired: 0, cancelled: 0 })
    expect(repository.recoverExpiredProcessingJobs(at(5_000))).toEqual({ requeued: 1, reviewRequired: 1, cancelled: 0 })
    expect(repository.getProcessingJob(safe.id)?.status).toBe('queued')
    expect(repository.getProcessingJob(manual.id)?.status).toBe('failed')
  })
})
