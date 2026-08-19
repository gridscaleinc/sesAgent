import { describe, expect, it } from 'vitest'
import {
  candidateSearchQueryFromInstruction,
  cancelWorkTask,
  classifyWorkTask,
  createWorkTaskPreview,
  materializeWorkTask,
  ProcessingResourceScheduler,
  SafeLocalProcessingDispatcher,
  reconcileWorkTaskPlan,
  recordCandidateMatchExecution,
  recordCandidateMatchFailure,
  recordCandidateMatchRetryScheduled,
  recordCandidateMatchStarted,
  recordProposalApproved,
  recordProposalDraftCreated,
  recordProposalExportFailure,
  recordProposalExportStarted,
  recordProposalFollowUp,
  recordResumeAnalysisFailure,
  recordResumeAnalysisPartialFailure,
  recordResumeAnalysisRetryScheduled,
  recordResumeAnalysisStarted,
  recoverInterruptedWorkTask,
  retryWorkTask
} from './index'

describe('restricted work task routing', () => {
  it('routes only to an allowed task type', () => {
    expect(classifyWorkTask('この案件に合う候補者を探したい')).toBe('MATCH_CANDIDATES')
    expect(classifyWorkTask('JavaとAWS経験がある人材を検索したい')).toBe('MATCH_CANDIDATES')
    expect(classifyWorkTask('提案メールの下書きを準備したい')).toBe('GENERATE_PROPOSAL')
    expect(classifyWorkTask('スキルシートを取り込みたい')).toBe('IMPORT_RESUME')
  })

  it('creates a preview with privacy and approval gates', () => {
    const preview = createWorkTaskPreview('JavaとAWS経験がある候補者を根拠付きで比較したい')
    expect(preview.privacy.cloudDirectIdentifiers).toBe('blocked')
    expect(preview.privacy.automaticSending).toBe(false)
    expect(preview.steps).toHaveLength(4)
    expect(preview.requiredApprovals).toContain('抽出結果')
  })

  it('materializes a planned task without mutating the preview', () => {
    const preview = createWorkTaskPreview('選択した候補者の提案下書きを作りたい')
    const task = materializeWorkTask(preview, 'task-1', '2026-07-17T00:00:00.000Z')
    expect(task.status).toBe('planned')
    expect(task.progress).toBe(0)
    expect(task.messages.map((message) => message.kind)).toEqual(['instruction', 'plan'])
    expect(task.approvalGates).toHaveLength(3)
    expect(task.toolAudits).toEqual([
      expect.objectContaining({ action: 'task.create', cloudPayload: 'none', externalSideEffect: 'local-write' })
    ])
    expect(preview).not.toHaveProperty('status')
  })

  it('recovers interrupted work without replaying external effects', () => {
    const task = materializeWorkTask(
      createWorkTaskPreview('JavaとAWS経験がある候補者を根拠付きで比較したい'),
      'task-interrupted',
      '2026-07-17T00:00:00.000Z'
    )
    task.status = 'running'
    task.steps[0] = { ...task.steps[0]!, status: 'running' }
    const recovered = recoverInterruptedWorkTask(task, new Date('2026-07-17T00:05:00.000Z'))
    expect(recovered).toMatchObject({ status: 'awaiting_input' })
    expect(recovered.steps[0]?.status).toBe('blocked')
    expect(recovered.messages.at(-1)).toMatchObject({ kind: 'error' })
    expect(recovered.toolAudits.at(-1)).toMatchObject({
      action: 'task.recover',
      externalSideEffect: 'local-write',
      cloudPayload: 'none'
    })
  })

  it('cancels and retries within the original data scope', () => {
    const task = materializeWorkTask(
      createWorkTaskPreview('JavaとAWS経験がある候補者を根拠付きで比較したい'),
      'task-lifecycle',
      '2026-07-17T00:00:00.000Z'
    )
    const cancelled = cancelWorkTask(task, new Date('2026-07-17T00:01:00.000Z'))
    const retried = retryWorkTask(cancelled, new Date('2026-07-17T00:02:00.000Z'))
    expect(cancelled.status).toBe('cancelled')
    expect(retried).toMatchObject({ status: 'planned', scope: task.scope, contextBindings: task.contextBindings })
    expect(retried.toolAudits.slice(-2).map((audit) => audit.action)).toEqual(['task.cancel', 'task.retry'])
    expect(retried.toolAudits.at(-1)?.cloudPayload).toBe('none')
  })
})

describe('processing resource scheduler', () => {
  it('keeps FIFO order inside a lane while allowing an independent lane to progress', async () => {
    const scheduler = new ProcessingResourceScheduler({ 'local-ai': 1, 'file-export': 1 })
    const events: string[] = []
    let releaseFirst!: () => void
    const first = scheduler.run('local-ai', async () => {
      events.push('local-1-start')
      await new Promise<void>((resolve) => { releaseFirst = resolve })
      events.push('local-1-end')
    })
    const second = scheduler.run('local-ai', () => { events.push('local-2') })
    const fileExport = scheduler.run('file-export', () => { events.push('file-export') })
    await fileExport
    expect(scheduler.snapshot()).toEqual({
      'local-ai': { active: 1, queued: 1, limit: 1 },
      'file-export': { active: 0, queued: 0, limit: 1 }
    })
    expect(events).toEqual(['local-1-start', 'file-export'])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['local-1-start', 'file-export', 'local-1-end', 'local-2'])
  })

  it('releases a lane after an operation fails', async () => {
    const scheduler = new ProcessingResourceScheduler()
    await expect(scheduler.run('local-ai', () => { throw new Error('local failure') })).rejects.toThrow('local failure')
    await expect(scheduler.run('local-ai', () => 'recovered')).resolves.toBe('recovered')
    expect(scheduler.snapshot()['local-ai']).toEqual({ active: 0, queued: 0, limit: 1 })
  })
})

describe('safe-local processing dispatcher', () => {
  it('dispatches only queued or due safe-local jobs', async () => {
    const executed: string[] = []
    const errors: Array<{ jobId: string | null }> = []
    const dispatcher = new SafeLocalProcessingDispatcher({
      intervalMs: 1_000,
      now: () => new Date('2026-07-20T00:00:10.000Z'),
      listJobs: () => [
        { id: 'queued', type: 'candidate-match', status: 'queued' as const, replayPolicy: 'safe-local' as const, nextRetryAt: null },
        { id: 'due', type: 'resume-analysis', status: 'retry_wait' as const, replayPolicy: 'safe-local' as const, nextRetryAt: '2026-07-20T00:00:09.000Z' },
        { id: 'future', type: 'resume-analysis', status: 'retry_wait' as const, replayPolicy: 'safe-local' as const, nextRetryAt: '2026-07-20T00:00:11.000Z' },
        { id: 'manual', type: 'proposal-export', status: 'queued' as const, replayPolicy: 'manual-review' as const, nextRetryAt: null },
        { id: 'done', type: 'candidate-match', status: 'succeeded' as const, replayPolicy: 'safe-local' as const, nextRetryAt: null }
      ],
      execute: async (job) => {
        executed.push(job.id)
        if (job.id === 'due') throw new Error('transient')
      },
      onError: (_error, job) => errors.push({ jobId: job?.id ?? null })
    })
    await dispatcher.dispatchNow()
    expect(executed).toEqual(['queued', 'due'])
    expect(errors).toEqual([{ jobId: 'due' }])
  })

  it('coalesces overlapping dispatch cycles', async () => {
    let executions = 0
    let release!: () => void
    const dispatcher = new SafeLocalProcessingDispatcher({
      listJobs: () => [{
        id: 'job-1', type: 'candidate-match', status: 'queued' as const,
        replayPolicy: 'safe-local' as const, nextRetryAt: null
      }],
      execute: async () => {
        executions += 1
        await new Promise<void>((resolve) => { release = resolve })
      }
    })
    const first = dispatcher.dispatchNow()
    const overlapping = dispatcher.dispatchNow()
    expect(overlapping).toBe(first)
    release()
    await first
    expect(executions).toBe(1)
  })
})

describe('candidateSearchQueryFromInstruction', () => {
  it('reduces a natural-language task to locally searchable confirmed fields', () => {
    expect(candidateSearchQueryFromInstruction('Java経験5年以上、Spring Boot、AWS、8月稼働、週3日リモート可の候補者を探したい')).toBe(
      '"Spring Boot" Java AWS 5年以上 8月 週3日リモート'
    )
  })

  it('preserves explicit date and maximum-rate constraints for local hard filters', () => {
    expect(candidateSearchQueryFromInstruction('Java、2026年9月開始、上限85万円、N2相当、常駐可能')).toBe(
      'Java 2026年9月 常駐 N2相当 上限85万円'
    )
  })

  it('structures only explicit coarse work-location and legal work-authorization requirements', () => {
    expect(candidateSearchQueryFromInstruction(
      'Java案件。勤務地は品川、就労制限なし、週3日リモートの候補者を探したい'
    )).toBe('Java 週3日リモート 勤務地:品川 就労資格:就労制限なし')
    expect(candidateSearchQueryFromInstruction('日本国籍のみの候補者')).toBe('')
  })

  it('reconciles persisted step copy without changing execution status', () => {
    const task = materializeWorkTask(
      createWorkTaskPreview('JavaとAWS経験がある候補者を根拠付きで比較したい'),
      'task-1',
      '2026-07-17T00:00:00.000Z'
    )
    task.steps[1] = { ...task.steps[1]!, description: '確認済みデータをBM25・ベクトルで検索します', status: 'completed' }
    expect(reconcileWorkTaskPlan(task).steps[1]).toMatchObject({
      description: '硬条件・BM25・ベクトル・端末内AI精査で確認済みローカル人材プロフィールを検索します',
      status: 'completed'
    })
  })

  it('persists a real candidate-match execution at the human review gate', () => {
    const task = materializeWorkTask(
      createWorkTaskPreview('JavaとAWS経験がある候補者を根拠付きで比較したい'),
      'task-1',
      '2026-07-17T00:00:00.000Z'
    )
    const completed = recordCandidateMatchExecution(
      task,
      true,
      4,
      new Date('2026-07-17T01:00:00.000Z'),
      { objectId: 'match-run-1', contentHash: 'a'.repeat(64) }
    )
    expect(completed).toMatchObject({
      status: 'awaiting_review',
      progress: 85,
      evidenceCount: 4,
      steps: [
        expect.objectContaining({ status: 'completed' }),
        expect.objectContaining({ status: 'completed' }),
        expect.objectContaining({ status: 'completed' }),
        expect.objectContaining({ status: 'blocked' })
      ]
    })
    expect(completed.messages.at(-1)).toMatchObject({ role: 'system', kind: 'review' })
    expect(completed.artifacts).toEqual([
      expect.objectContaining({ kind: 'candidate-match-results', objectId: 'match-run-1', containsDirectIdentifiers: false })
    ])
    expect(completed.toolAudits.at(-1)).toMatchObject({ action: 'candidate.search', cloudPayload: 'none' })
    const retried = retryWorkTask(cancelWorkTask(completed))
    const reused = recordCandidateMatchExecution(
      retried,
      true,
      4,
      new Date('2026-07-17T02:00:00.000Z'),
      { objectId: 'match-run-1', contentHash: 'a'.repeat(64) }
    )
    expect(reused.status).toBe('awaiting_review')
    expect(reused.artifacts).toHaveLength(1)
    expect(recordCandidateMatchExecution(task, false, 4)).toMatchObject({
      status: 'awaiting_input',
      progress: 25,
      evidenceCount: 0
    })
  })

  it('records processing-job start and failure without a cloud payload', () => {
    const task = materializeWorkTask(
      createWorkTaskPreview('JavaとAWS経験がある候補者を根拠付きで比較したい'),
      'task-job-state',
      '2026-07-17T00:00:00.000Z'
    )
    const started = recordCandidateMatchStarted(task, 1, new Date('2026-07-17T00:01:00.000Z'))
    expect(started).toMatchObject({ status: 'running', progress: 15 })
    expect(started.messages.at(-1)?.content).toContain('試行 1')
    const failed = recordCandidateMatchFailure(started, 'LOCAL_MODEL_UNAVAILABLE', new Date('2026-07-17T00:02:00.000Z'))
    expect(failed.status).toBe('failed')
    expect(failed.toolAudits.at(-1)).toMatchObject({
      action: 'candidate.search',
      decision: 'blocked',
      cloudPayload: 'none'
    })
    const retryScheduled = recordCandidateMatchRetryScheduled(
      started,
      'LOCAL_MODEL_UNAVAILABLE',
      '2026-07-17T00:02:05.000Z',
      new Date('2026-07-17T00:02:00.000Z')
    )
    expect(retryScheduled.status).toBe('planned')
    expect(retryScheduled.messages.at(-1)?.content).toContain('再試行します')
  })

  it('returns a proposal export job to human review after a non-replayable failure', () => {
    const planned = materializeWorkTask(
      createWorkTaskPreview('選択した候補者の提案下書きを準備したい'),
      'task-proposal-export-job',
      '2026-07-17T00:00:00.000Z'
    )
    const drafted = recordProposalDraftCreated(planned, 4, new Date('2026-07-17T00:01:00.000Z'))
    const approved = recordProposalApproved(drafted, new Date('2026-07-17T00:02:00.000Z'))
    const started = recordProposalExportStarted(approved, 1, new Date('2026-07-17T00:03:00.000Z'))
    expect(started).toMatchObject({ status: 'running', progress: 96 })
    expect(started.messages.at(-1)?.content).toContain('試行 1')
    const failed = recordProposalExportFailure(
      started,
      'PROPOSAL_EXPORT_OUTCOME_UNKNOWN',
      new Date('2026-07-17T00:04:00.000Z')
    )
    expect(failed).toMatchObject({ status: 'awaiting_review', progress: 96 })
    expect(failed.messages.at(-1)?.content).toContain('自動再実行せず')
    expect(failed.toolAudits.at(-1)).toMatchObject({
      action: 'proposal.export',
      decision: 'blocked',
      externalSideEffect: 'file-export',
      cloudPayload: 'none'
    })
  })

  it('adds a local-only audited proposal follow-up without claiming the app sent email', () => {
    const task = materializeWorkTask(
      createWorkTaskPreview('選択した候補者の提案下書きを準備したい'),
      'task-proposal-follow-up',
      '2026-07-17T00:00:00.000Z'
    )
    const recorded = recordProposalFollowUp(task, 'replied', new Date('2026-07-20T00:00:00.000Z'), '営業担当')
    expect(recorded).toMatchObject({ status: 'completed', progress: 100 })
    expect(recorded.messages.at(-1)?.content).toContain('メール送信や外部更新は実行していません')
    expect(recorded.toolAudits.at(-1)).toMatchObject({
      action: 'proposal.follow-up',
      externalSideEffect: 'local-write',
      cloudPayload: 'none'
    })
  })

  it('records a resume analysis job without allowing a cloud fallback', () => {
    const task = materializeWorkTask(
      createWorkTaskPreview('スキルシートを安全に取り込みたい'),
      'task-resume-analysis-job',
      '2026-07-17T00:00:00.000Z'
    )
    const started = recordResumeAnalysisStarted(task, 2, new Date('2026-07-17T00:01:00.000Z'))
    expect(started).toMatchObject({ status: 'running', progress: 15 })
    expect(started.steps[0]?.status).toBe('running')
    const failed = recordResumeAnalysisFailure(started, 'LOCAL_OCR_FAILED', new Date('2026-07-17T00:02:00.000Z'))
    expect(failed.status).toBe('failed')
    expect(failed.messages.at(-1)?.content).toContain('原文をクラウドへ送らず')
    expect(failed.toolAudits.at(-1)).toMatchObject({
      action: 'resume.local-parse',
      decision: 'blocked',
      cloudPayload: 'none'
    })
    const partial = recordResumeAnalysisPartialFailure(started, 'LOCAL_OCR_FAILED', new Date('2026-07-17T00:02:00.000Z'))
    expect(partial.status).toBe('awaiting_review')
    expect(partial.messages.at(-1)?.content).toContain('残りの選択ファイルを続行')
    expect(recordResumeAnalysisStarted(partial, 1).status).toBe('running')
    const retryScheduled = recordResumeAnalysisRetryScheduled(
      started,
      'LOCAL_OCR_FAILED',
      '2026-07-17T00:02:05.000Z',
      new Date('2026-07-17T00:02:00.000Z')
    )
    expect(retryScheduled.status).toBe('planned')
    expect(retryScheduled.messages.at(-1)?.content).toContain('同じファイル')
  })
})
