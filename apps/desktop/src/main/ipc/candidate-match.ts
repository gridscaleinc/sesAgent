import { createHash, randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { AgentExecutionError, type AgentToolExecutionMetadata } from '@agent'
import {
  cancelWorkTask,
  candidateSearchQueryFromInstruction,
  materializeWorkTask,
  recordCandidateMatchExecution,
  recordCandidateMatchFailure,
  recordCandidateMatchRetryScheduled,
  recordCandidateMatchStarted
} from '@application'
import { candidateBenchmarkQueryFromJobCase } from '@job-cases'
import {
  type CandidateMatchTaskExecutionResult,
  type ProcessingJobSummary,
  executeCandidateMatchTaskInputSchema,
  ipcChannels
} from '@shared'
import { registerAgentIpcHandlers } from '../agent-ipc'
import { effectiveApplicationPreferences } from '../app-defaults'
import { assertWorkTaskAllowsExecution, createVerifiedPreview } from '../work-task-helpers'
import { assertTrustedSender, type MainIpcContext } from './context'

/** Candidate matching execution and the conversational matching agent IPC surface. */
export function registerCandidateMatchHandlers(context: MainIpcContext) {
  const { repository, conversationalMatchingEnabled, agentChatModelCatalog, processingResources, currentOperator, currentMatchRuntimeIdentity, agentNarrativeStreamer, actionOrchestrator, preflightAction, withTaskOperation, failPendingProcessingJob, searchCandidates } = context
  const runCandidateMatchTask = async (
    taskId: string,
    existingJobId: string | null = null,
    agentTurn?: Pick<AgentToolExecutionMetadata, 'conversationId' | 'turnId' | 'requestId'>
  ): Promise<CandidateMatchTaskExecutionResult> => {
      const task = repository.getWorkTask(taskId)
      if (!task) throw new Error('候補者検索タスクが見つかりません。')
      if (task.type !== 'MATCH_CANDIDATES') throw new Error('このタスクは候補者検索ではありません。')
      assertWorkTaskAllowsExecution(task)
      const jobCaseBinding = task.contextBindings.find((binding) => binding.objectType === 'job-case') ?? null
      const boundJobCase = jobCaseBinding
        ? repository.listActiveJobCases().find((jobCase) =>
            jobCase.id === jobCaseBinding.objectId && String(jobCase.version) === jobCaseBinding.version
          ) ?? null
        : null
      if (jobCaseBinding && !boundJobCase) {
        throw new Error('案件が更新またはアーカイブされました。現在の案件からマッチングを作り直してください。')
      }
      const query = boundJobCase
        ? candidateBenchmarkQueryFromJobCase(boundJobCase)
        : candidateSearchQueryFromInstruction(task.instruction)
      const profiles = repository.listEligibleTalentProfiles()
      const requestFingerprint = createHash('sha256').update(JSON.stringify({
        version: 'candidate-match-job-v1',
        query,
        contextBindings: task.contextBindings,
        model: currentMatchRuntimeIdentity,
        profiles: profiles.map((profile) => ({
          id: profile.id,
          version: profile.profileVersion,
          fields: profile.fields,
          projectExperiences: profile.projectExperiences
        }))
      })).digest('hex')
      const idempotencyKey = createHash('sha256')
        .update(`candidate-match:${task.id}:${requestFingerprint}`)
        .digest('hex')
      const existingAgentConversation = agentTurn
        ? repository.getAiConversation(agentTurn.conversationId)
        : null
      const persistedAgentConversationId = existingAgentConversation?.context.assistant === 'sales-agent'
        ? agentTurn?.conversationId ?? null
        : null
      const actionRunId = preflightAction('candidate.match.local', {
        origin: 'work-task', workTaskId: task.id, scopeId: task.scope.id,
        scopeFingerprint: requestFingerprint, actorId: currentOperator().operatorId,
        contentRevision: task.updatedAt,
        conversationId: persistedAgentConversationId,
        turnId: persistedAgentConversationId ? agentTurn?.turnId ?? null : null
      }, { taskId: task.id }, '確認済み候補者プールを端末内で照合します。', idempotencyKey)
      const toAgentToolError = (cause: unknown): unknown => {
        if (!agentTurn) return cause
        if (cause instanceof AgentExecutionError) {
          return new AgentExecutionError(cause.code, cause.message, actionRunId)
        }
        return new AgentExecutionError('AGENT_TOOL_FAILED', '候補者マッチングツールの実行に失敗しました。', actionRunId)
      }
      try {
        const initialProcessingJob = existingJobId
          ? repository.getProcessingJob(existingJobId)
          : repository.enqueueProcessingJob({
              type: 'candidate-match',
              workTaskId: task.id,
              taskStepId: task.steps[1]?.id ?? 'step-2',
              idempotencyKey,
              requestFingerprint,
              payloadRef: `work-task:${task.id}:candidate-match`,
              replayPolicy: 'safe-local',
              maxAttempts: 3
            })
        if (!initialProcessingJob || initialProcessingJob.type !== 'candidate-match' || initialProcessingJob.workTaskId !== task.id) {
          throw new Error('候補者検索ジョブと作業の関連が一致しません。')
        }
        let processingJob: ProcessingJobSummary = initialProcessingJob
        if (processingJob.status !== 'succeeded') repository.updateActionRun(actionRunId, 'running', { processingJobId: processingJob.id })
        const dispatchReference = repository.getProcessingJobDispatchReference(processingJob.id)
        if (dispatchReference?.payloadRef !== `work-task:${task.id}:candidate-match`) {
          processingJob = failPendingProcessingJob(processingJob.id, 'PAYLOAD_REFERENCE_INVALID') ?? processingJob
          repository.saveWorkTask(recordCandidateMatchFailure(task, 'PAYLOAD_REFERENCE_INVALID'))
          throw new Error('候補者検索ジョブのローカル参照が無効です。作業を再実行してください。')
        }
        if (dispatchReference.requestFingerprint !== requestFingerprint) {
          processingJob = failPendingProcessingJob(processingJob.id, 'REQUEST_FINGERPRINT_STALE') ?? processingJob
          repository.saveWorkTask(recordCandidateMatchFailure(task, 'REQUEST_FINGERPRINT_STALE'))
          throw new Error('候補者プールまたは検索条件が変わりました。作業を再実行してください。')
        }
        if (processingJob.status === 'failed' || processingJob.status === 'cancelled') {
          throw new Error('候補者検索ジョブは停止しています。作業を再実行してください。')
        }
        return await processingResources.run('local-ai', async () => {
        processingJob = repository.getProcessingJob(processingJob.id) ?? processingJob
        if (processingJob.status === 'failed' || processingJob.status === 'cancelled') {
          throw new Error('候補者検索ジョブは停止しています。作業を再実行してください。')
        }
        const lease = processingJob.status === 'succeeded'
          ? null
          : repository.acquireProcessingJob(processingJob.id, 5 * 60_000)
        if (processingJob.status !== 'succeeded' && !lease) {
          throw new Error('候補者検索ジョブは別の処理で実行中か、再試行待ちです。')
        }
        if (lease) {
          const latestTask = repository.getWorkTask(task.id)
          if (!latestTask) throw new Error('候補者検索タスクが見つかりません。')
          assertWorkTaskAllowsExecution(latestTask)
          const startedTask = recordCandidateMatchStarted(latestTask, lease.job.attemptCount)
          repository.saveWorkTask(startedTask)
          processingJob = repository.updateProcessingJobProgress(processingJob.id, lease.leaseToken, 20)
        }
        try {
          if (lease && repository.isProcessingJobCancellationRequested(processingJob.id, lease.leaseToken)) {
            repository.completeProcessingJob(processingJob.id, lease.leaseToken, { cancelled: true })
            throw new Error('候補者検索ジョブをキャンセルしました。')
          }
          const matches = query
            ? await searchCandidates(query, 20)
            : []
          if (lease && repository.isProcessingJobCancellationRequested(processingJob.id, lease.leaseToken)) {
            repository.completeProcessingJob(processingJob.id, lease.leaseToken, { cancelled: true })
            throw new Error('候補者検索ジョブをキャンセルしました。')
          }
          if (lease) processingJob = repository.updateProcessingJobProgress(processingJob.id, lease.leaseToken, 85)
          const latestTask = repository.getWorkTask(taskId)
          if (!latestTask) throw new Error('候補者検索タスクが見つかりません。')
          assertWorkTaskAllowsExecution(latestTask)
          const persisted = repository.saveCandidateMatchRun(
            latestTask.id,
            query,
            matches,
            new Date(),
            currentMatchRuntimeIdentity
          )
          const evidenceCount = matches.reduce((total, match) => total + Math.max(1, match.evidence.length), 0)
          const updatedTask = recordCandidateMatchExecution(latestTask, Boolean(query), evidenceCount, new Date(), {
            objectId: persisted.run.id,
            contentHash: persisted.run.resultSetHash
          })
          if (updatedTask !== latestTask) repository.saveWorkTask(updatedTask)
          if (lease) {
            const completion = repository.completeProcessingJob(processingJob.id, lease.leaseToken, {
              version: 'candidate-match-job-result-v1',
              runId: persisted.run.id,
              resultSetHash: persisted.run.resultSetHash,
              resultCount: persisted.matches.length
            })
            if (!completion.accepted) throw new Error('候補者検索ジョブをキャンセルしました。')
            processingJob = completion.job
          }
          repository.updateActionRun(actionRunId, 'succeeded', { processingJobId: processingJob.id, resultHash: persisted.run.resultSetHash })
          return { task: updatedTask, query, run: persisted.run, matches: persisted.matches, processingJob, actionRunId }
        } catch (cause) {
          if (lease) {
            const activeJob = repository.getProcessingJob(processingJob.id)
            if (activeJob?.status === 'running') {
              processingJob = repository.failProcessingJob(
                processingJob.id,
                lease.leaseToken,
                'CANDIDATE_MATCH_FAILED',
                true
              )
            }
            const latestTask = repository.getWorkTask(taskId)
            if (latestTask && latestTask.status !== 'cancelled' && processingJob.status !== 'cancelled') {
              const errorCode = processingJob.errorCode ?? 'CANDIDATE_MATCH_FAILED'
              repository.saveWorkTask(
                processingJob.status === 'retry_wait' && processingJob.nextRetryAt
                  ? recordCandidateMatchRetryScheduled(latestTask, errorCode, processingJob.nextRetryAt)
                  : recordCandidateMatchFailure(latestTask, errorCode)
              )
            }
          }
          repository.updateActionRun(actionRunId, processingJob.status === 'cancelled' ? 'cancelled' : 'failed', {
            processingJobId: processingJob.id,
            errorCode: processingJob.errorCode ?? 'CANDIDATE_MATCH_FAILED'
          })
          throw cause
        }
        })
      } catch (cause) {
        const actionStatus = repository.getActionRunStatus(actionRunId)
        if (actionStatus && !['failed', 'cancelled', 'succeeded'].includes(actionStatus)) {
          repository.updateActionRun(actionRunId, 'failed', { errorCode: 'CANDIDATE_MATCH_FAILED' })
        }
        throw toAgentToolError(cause)
      }
  }

  ipcMain.handle(ipcChannels.executeCandidateMatchTask, async (event, rawTaskId): Promise<CandidateMatchTaskExecutionResult> => {
    assertTrustedSender(event)
    const taskId = executeCandidateMatchTaskInputSchema.parse(rawTaskId)
    return withTaskOperation(taskId, () => runCandidateMatchTask(taskId))
  })

  const agentIpcStop = registerAgentIpcHandlers({
    repository,
    actionOrchestrator,
    assertTrustedSender,
    conversationalMatchingEnabled: () => conversationalMatchingEnabled,
    locale: () => effectiveApplicationPreferences(repository).locale,
    currentOperator,
    currentMatchRuntimeIdentity,
    createMatchTask: (jobCaseId, jobCaseVersion) => {
      const preview = createVerifiedPreview(repository, {
        instruction: '为所选案件匹配确认人才',
        scopeId: 'selected-case',
        fileTokens: [],
        jobCaseId
      })
      if (preview.type !== 'MATCH_CANDIDATES') throw new Error('案件匹配任务无法创建。')
      const task = materializeWorkTask(preview, randomUUID(), new Date().toISOString())
      const binding = task.contextBindings.find((item) => item.objectType === 'job-case')
      if (!binding || binding.version !== String(jobCaseVersion)) throw new Error('案件版本已变化，请重新选择案件。')
      repository.saveWorkTask(task)
      return { taskId: task.id }
    },
    runCandidateMatchTask: (taskId, metadata) => withTaskOperation(
      taskId,
      () => runCandidateMatchTask(taskId, null, metadata)
    ),
    cancelMatchTask: (taskId) => {
      const task = repository.getWorkTask(taskId)
      if (!task) return
      repository.requestProcessingJobCancellationForTask(taskId)
      if (!['completed', 'cancelled', 'failed'].includes(task.status)) repository.saveWorkTask(cancelWorkTask(task))
    },
    modelCatalog: agentChatModelCatalog,
    narrativeStreamer: agentNarrativeStreamer
  })

  return { runCandidateMatchTask, stop: agentIpcStop }
}
