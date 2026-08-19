import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { enqueueProcessingJobInputSchema, processingJobSummarySchema } from '@shared'
import { type ProcessingJobSummary } from '@shared/contracts'
import { type ProcessingJobCompletion, type ProcessingJobLease, type ProcessingJobRow } from '../rows'
import { DomainStore } from './base'

export class ProcessingJobStore extends DomainStore {
  private processingJobFromRow(row: ProcessingJobRow): ProcessingJobSummary {
    return processingJobSummarySchema.parse({
      id: row.id,
      type: row.job_type,
      workTaskId: row.work_task_id,
      taskStepId: row.task_step_id,
      status: row.status,
      replayPolicy: row.replay_policy,
      progress: row.progress,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      nextRetryAt: row.next_retry_at,
      leaseExpiresAt: row.lease_expires_at,
      cancelRequestedAt: row.cancel_requested_at,
      errorCode: row.error_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })
  }

  private getProcessingJobRow(jobId: string): ProcessingJobRow | null {
    return this.database
      .prepare<[string], ProcessingJobRow>('SELECT * FROM processing_jobs WHERE id = ?')
      .get(jobId) ?? null
  }

  getProcessingJob(jobId: string): ProcessingJobSummary | null {
    const row = this.getProcessingJobRow(jobId)
    return row ? this.processingJobFromRow(row) : null
  }

  getProcessingJobDispatchReference(jobId: string): { requestFingerprint: string; payloadRef: string } | null {
    const row = this.getProcessingJobRow(jobId)
    return row ? { requestFingerprint: row.request_fingerprint, payloadRef: row.payload_ref } : null
  }

  listProcessingJobs(workTaskId?: string): ProcessingJobSummary[] {
    const rows = workTaskId
      ? this.database.prepare<[string], ProcessingJobRow>(
          'SELECT * FROM processing_jobs WHERE work_task_id = ? ORDER BY created_at DESC, id DESC'
        ).all(workTaskId)
      : this.database.prepare<[], ProcessingJobRow>(
          'SELECT * FROM processing_jobs ORDER BY created_at DESC, id DESC'
        ).all()
    return rows.map((row) => this.processingJobFromRow(row))
  }

  enqueueProcessingJob(
    rawInput: z.input<typeof enqueueProcessingJobInputSchema>,
    now = new Date()
  ): ProcessingJobSummary {
    const input = enqueueProcessingJobInputSchema.parse(rawInput)
    const task = this.stores.workTasks.getWorkTask(input.workTaskId)
    if (!task) throw new Error('Processing job work task was not found.')
    const existing = this.database
      .prepare<[string], ProcessingJobRow>('SELECT * FROM processing_jobs WHERE idempotency_key = ?')
      .get(input.idempotencyKey)
    if (existing) {
      if (existing.request_fingerprint !== input.requestFingerprint || existing.work_task_id !== input.workTaskId) {
        throw new Error('Processing job idempotency key collision.')
      }
      return this.processingJobFromRow(existing)
    }
    const id = randomUUID()
    const timestamp = now.toISOString()
    this.database.prepare(
      `INSERT INTO processing_jobs(
         id, job_type, work_task_id, task_step_id, idempotency_key, request_fingerprint,
         payload_ref, status, replay_policy, progress, attempt_count, max_attempts,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, 0, ?, ?, ?)`
    ).run(
      id,
      input.type,
      input.workTaskId,
      input.taskStepId,
      input.idempotencyKey,
      input.requestFingerprint,
      input.payloadRef,
      input.replayPolicy,
      input.maxAttempts,
      timestamp,
      timestamp
    )
    const created = this.getProcessingJob(id)
    if (!created) throw new Error('Processing job could not be reloaded.')
    return created
  }

  acquireProcessingJob(jobId: string, leaseDurationMs = 60_000, now = new Date()): ProcessingJobLease | null {
    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1_000 || leaseDurationMs > 15 * 60_000) {
      throw new Error('Processing job lease duration is invalid.')
    }
    const acquire = this.database.transaction((): ProcessingJobLease | null => {
      const row = this.getProcessingJobRow(jobId)
      if (!row) throw new Error('Processing job was not found.')
      if (row.cancel_requested_at) {
        if (row.status === 'queued' || row.status === 'retry_wait') {
          this.database.prepare(
            `UPDATE processing_jobs SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL,
               next_retry_at = NULL, updated_at = ? WHERE id = ?`
          ).run(now.toISOString(), jobId)
        }
        return null
      }
      if (row.status !== 'queued' && row.status !== 'retry_wait') return null
      if (row.status === 'retry_wait' && row.next_retry_at && row.next_retry_at > now.toISOString()) return null
      const leaseToken = randomUUID()
      const timestamp = now.toISOString()
      const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString()
      const updated = this.database.prepare(
        `UPDATE processing_jobs
         SET status = 'running', progress = MAX(progress, 1), attempt_count = attempt_count + 1,
             next_retry_at = NULL, lease_token = ?, lease_expires_at = ?, error_code = NULL, updated_at = ?
         WHERE id = ? AND status IN ('queued', 'retry_wait') AND cancel_requested_at IS NULL`
      ).run(leaseToken, leaseExpiresAt, timestamp, jobId)
      if (updated.changes !== 1) return null
      const job = this.getProcessingJob(jobId)
      if (!job) throw new Error('Acquired processing job could not be reloaded.')
      return { job, leaseToken }
    })
    return acquire()
  }

  updateProcessingJobProgress(jobId: string, leaseToken: string, progress: number, now = new Date()): ProcessingJobSummary {
    const bounded = Math.max(1, Math.min(99, Math.trunc(progress)))
    const updated = this.database.prepare(
      `UPDATE processing_jobs SET progress = MAX(progress, ?), updated_at = ?
       WHERE id = ? AND status = 'running' AND lease_token = ?`
    ).run(bounded, now.toISOString(), jobId, leaseToken)
    if (updated.changes !== 1) throw new Error('Processing job lease is no longer active.')
    const job = this.getProcessingJob(jobId)
    if (!job) throw new Error('Processing job could not be reloaded.')
    return job
  }

  isProcessingJobCancellationRequested(jobId: string, leaseToken: string): boolean {
    const row = this.database
      .prepare<[string, string], { cancel_requested_at: string | null }>(
        `SELECT cancel_requested_at FROM processing_jobs
         WHERE id = ? AND status = 'running' AND lease_token = ?`
      )
      .get(jobId, leaseToken)
    if (!row) throw new Error('Processing job lease is no longer active.')
    return row.cancel_requested_at !== null
  }

  completeProcessingJob(
    jobId: string,
    leaseToken: string,
    result: unknown,
    now = new Date()
  ): ProcessingJobCompletion {
    const resultJson = JSON.stringify(result)
    if (Buffer.byteLength(resultJson, 'utf8') > 1_000_000) throw new Error('Processing job result is too large.')
    const resultHash = createHash('sha256').update(resultJson).digest('hex')
    const complete = this.database.transaction((): ProcessingJobCompletion => {
      const row = this.getProcessingJobRow(jobId)
      if (!row || row.status !== 'running' || row.lease_token !== leaseToken) {
        throw new Error('Processing job lease is no longer active.')
      }
      const timestamp = now.toISOString()
      if (row.cancel_requested_at) {
        this.database.prepare(
          `UPDATE processing_jobs SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL,
             next_retry_at = NULL, updated_at = ? WHERE id = ?`
        ).run(timestamp, jobId)
        const job = this.getProcessingJob(jobId)
        if (!job) throw new Error('Cancelled processing job could not be reloaded.')
        return { job, accepted: false }
      }
      this.database.prepare(
        `UPDATE processing_jobs SET status = 'succeeded', progress = 100, lease_token = NULL,
           lease_expires_at = NULL, next_retry_at = NULL, result_json = ?, result_hash = ?, updated_at = ?
         WHERE id = ?`
      ).run(resultJson, resultHash, timestamp, jobId)
      const job = this.getProcessingJob(jobId)
      if (!job) throw new Error('Completed processing job could not be reloaded.')
      return { job, accepted: true }
    })
    return complete()
  }

  failProcessingJob(
    jobId: string,
    leaseToken: string,
    errorCode: string,
    retryable: boolean,
    retryDelayMs: number | null = null,
    now = new Date()
  ): ProcessingJobSummary {
    if (!/^[A-Z][A-Z0-9_]{1,79}$/u.test(errorCode)) throw new Error('Processing job error code is invalid.')
    const fail = this.database.transaction((): ProcessingJobSummary => {
      const row = this.getProcessingJobRow(jobId)
      if (!row || row.status !== 'running' || row.lease_token !== leaseToken) {
        throw new Error('Processing job lease is no longer active.')
      }
      const timestamp = now.toISOString()
      const cancelled = row.cancel_requested_at !== null
      const shouldRetry = !cancelled && retryable && row.attempt_count < row.max_attempts
      const status = cancelled ? 'cancelled' : shouldRetry ? 'retry_wait' : 'failed'
      const exponentialDelay = Math.min(5 * 60_000, 5_000 * (2 ** Math.max(0, row.attempt_count - 1)))
      const boundedRetryDelay = retryDelayMs === null
        ? exponentialDelay
        : Math.max(1_000, Math.min(5 * 60_000, retryDelayMs))
      const nextRetryAt = shouldRetry ? new Date(now.getTime() + boundedRetryDelay).toISOString() : null
      this.database.prepare(
        `UPDATE processing_jobs SET status = ?, next_retry_at = ?, lease_token = NULL,
           lease_expires_at = NULL, error_code = ?, updated_at = ? WHERE id = ?`
      ).run(status, nextRetryAt, cancelled ? null : errorCode, timestamp, jobId)
      const job = this.getProcessingJob(jobId)
      if (!job) throw new Error('Failed processing job could not be reloaded.')
      return job
    })
    return fail()
  }

  requestProcessingJobCancellationForTask(workTaskId: string, now = new Date()): ProcessingJobSummary[] {
    const timestamp = now.toISOString()
    this.database.prepare(
      `UPDATE processing_jobs
       SET cancel_requested_at = COALESCE(cancel_requested_at, ?),
           status = CASE WHEN status IN ('queued', 'retry_wait') THEN 'cancelled' ELSE status END,
           next_retry_at = CASE WHEN status IN ('queued', 'retry_wait') THEN NULL ELSE next_retry_at END,
           updated_at = ?
       WHERE work_task_id = ? AND status IN ('queued', 'running', 'retry_wait')`
    ).run(timestamp, timestamp, workTaskId)
    return this.listProcessingJobs(workTaskId)
  }

  retryProcessingJobsForTask(workTaskId: string, now = new Date()): ProcessingJobSummary[] {
    const timestamp = now.toISOString()
    this.database.prepare(
      `UPDATE processing_jobs SET status = 'queued', progress = 0, attempt_count = 0, next_retry_at = NULL,
         lease_token = NULL, lease_expires_at = NULL, cancel_requested_at = NULL,
         error_code = NULL, result_json = NULL, result_hash = NULL, updated_at = ?
       WHERE work_task_id = ? AND replay_policy = 'safe-local' AND status IN ('failed', 'cancelled', 'retry_wait')`
    ).run(timestamp, workTaskId)
    return this.listProcessingJobs(workTaskId)
  }

  recoverExpiredProcessingJobs(
    now = new Date(),
    includeUnexpired = false
  ): { requeued: number; reviewRequired: number; cancelled: number } {
    const expired = includeUnexpired
      ? this.database.prepare<[], ProcessingJobRow>(
          `SELECT * FROM processing_jobs WHERE status = 'running' AND lease_expires_at IS NOT NULL`
        ).all()
      : this.database.prepare<[string], ProcessingJobRow>(
          `SELECT * FROM processing_jobs
           WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`
        ).all(now.toISOString())
    let requeued = 0
    let reviewRequired = 0
    let cancelled = 0
    const recover = this.database.transaction(() => {
      for (const row of expired) {
        const timestamp = now.toISOString()
        if (row.cancel_requested_at) {
          this.database.prepare(
            `UPDATE processing_jobs SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL,
               next_retry_at = NULL, updated_at = ? WHERE id = ?`
          ).run(timestamp, row.id)
          cancelled += 1
        } else if (row.replay_policy === 'safe-local') {
          this.database.prepare(
            `UPDATE processing_jobs SET status = 'queued', progress = 0, lease_token = NULL,
               lease_expires_at = NULL, next_retry_at = NULL, error_code = 'LEASE_EXPIRED', updated_at = ? WHERE id = ?`
          ).run(timestamp, row.id)
          requeued += 1
        } else {
          this.database.prepare(
            `UPDATE processing_jobs SET status = 'failed', lease_token = NULL, lease_expires_at = NULL,
               next_retry_at = NULL, error_code = 'INTERRUPTED_REVIEW_REQUIRED', updated_at = ? WHERE id = ?`
          ).run(timestamp, row.id)
          reviewRequired += 1
        }
      }
    })
    recover()
    return { requeued, reviewRequired, cancelled }
  }

  getProcessingJobResult(jobId: string): unknown | null {
    const row = this.getProcessingJobRow(jobId)
    if (!row || row.status !== 'succeeded' || !row.result_json || !row.result_hash) return null
    const actualHash = createHash('sha256').update(row.result_json).digest('hex')
    if (actualHash !== row.result_hash) throw new Error('Processing job result integrity check failed.')
    return JSON.parse(row.result_json) as unknown
  }
}
