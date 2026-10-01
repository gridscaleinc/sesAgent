import { createHash, randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { rejectedByHr } from '../work-rule-matching'
import { AgentExecutionError, resolveAgentChatModel, type AgentToolExecutionMetadata } from '@agent'
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
  type ResumeAnalysisTaskExecutionResult,
  executeCandidateMatchTaskInputSchema,
  ipcChannels
} from '@shared'
import { registerAgentIpcHandlers } from '../agent-ipc'
import { deriveNewCaseDigest } from '../job-case-digest'
import { executeBusinessTextIntakeTurn, importChatPastedJobCaseText, importPastedCandidateText } from '../business-text-intake'
import { effectiveApplicationPreferences, effectiveJobCaseFieldAliases } from '../app-defaults'
import { assertWorkTaskAllowsExecution, createVerifiedPreview } from '../work-task-helpers'
import { assertTrustedSender, type MainIpcContext } from './context'
import { agentDraftFactsFromResumeAnalysis } from './resume-import'

/** Candidate matching execution and the conversational matching agent IPC surface. */
export function registerCandidateMatchHandlers(
  context: MainIpcContext,
  runResumeAnalysisTask: (input: { fileToken: string; taskId: string }) => Promise<ResumeAnalysisTaskExecutionResult>
) {
  const {
    conversationImports,
    previewedDrafts,
    repository,
    agentChatModelCatalog,
    processingResources,
    currentOperator,
    currentMatchRuntimeIdentity,
    agentNarrativeStreamer,
    actionOrchestrator,
    preflightAction,
    withTaskOperation,
    failPendingProcessingJob,
    searchCandidates,
    localNer,
    fileVault
  } = context
  // Rollback switch for the intake gate: disabled means every message routes
  // through the planner exactly as before the gate existed.
  const businessTextIntakeEnabled = process.env.SES_BUSINESS_TEXT_INTAKE_ENABLED !== '0'
  const businessTextCloudAssistEnabled = process.env.SES_BUSINESS_TEXT_CLOUD_ASSIST_ENABLED !== '0'
  const registerConversationImport = (conversationId: string, sourceDocumentId: string) => {
    const existing = conversationImports.get(conversationId) ?? []
    if (existing.some((item) => item.sourceDocumentId === sourceDocumentId)) return
    conversationImports.set(conversationId, [...existing, { label: `RESUME_${existing.length + 1}`, sourceDocumentId }])
  }
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
      ? (repository
          .listActiveJobCases()
          .find((jobCase) => jobCase.id === jobCaseBinding.objectId && String(jobCase.version) === jobCaseBinding.version) ?? null)
      : null
    if (jobCaseBinding && !boundJobCase) {
      throw new Error('案件が更新またはアーカイブされました。現在の案件からマッチングを作り直してください。')
    }
    const query = boundJobCase ? candidateBenchmarkQueryFromJobCase(boundJobCase) : candidateSearchQueryFromInstruction(task.instruction)
    const candidateBinding = task.contextBindings.find((binding) => binding.objectType === 'candidate-profile')
    const profiles = repository
      .listEligibleTalentProfiles()
      .filter((profile) => !candidateBinding || profile.sourceDocumentId === candidateBinding.objectId)
    if (candidateBinding && (profiles.length !== 1 || String(profiles[0]!.profileVersion) !== candidateBinding.version)) {
      throw new Error('所选人员已更新或不在可匹配人才中，请核对资料后重新评估。')
    }
    const requestFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
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
        })
      )
      .digest('hex')
    const idempotencyKey = createHash('sha256').update(`candidate-match:${task.id}:${requestFingerprint}`).digest('hex')
    const existingAgentConversation = agentTurn ? repository.getAiConversation(agentTurn.conversationId) : null
    const persistedAgentConversationId =
      existingAgentConversation?.context.assistant === 'sales-agent' ? (agentTurn?.conversationId ?? null) : null
    const actionRunId = preflightAction(
      'candidate.match.local',
      {
        origin: 'work-task',
        workTaskId: task.id,
        scopeId: task.scope.id,
        scopeFingerprint: requestFingerprint,
        actorId: currentOperator().operatorId,
        contentRevision: task.updatedAt,
        conversationId: persistedAgentConversationId,
        turnId: persistedAgentConversationId ? (agentTurn?.turnId ?? null) : null
      },
      { taskId: task.id },
      '確認済み候補者プールを端末内で照合します。',
      idempotencyKey
    )
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
        const lease = processingJob.status === 'succeeded' ? null : repository.acquireProcessingJob(processingJob.id, 5 * 60_000)
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
            ? await searchCandidates(
                query,
                candidateBinding ? 1 : 20,
                candidateBinding?.objectId,
                candidateBinding ? Number(candidateBinding.version) : undefined
              )
            : []
          if (lease && repository.isProcessingJobCancellationRequested(processingJob.id, lease.leaseToken)) {
            repository.completeProcessingJob(processingJob.id, lease.leaseToken, { cancelled: true })
            throw new Error('候補者検索ジョブをキャンセルしました。')
          }
          if (lease) processingJob = repository.updateProcessingJobProgress(processingJob.id, lease.leaseToken, 85)
          const latestTask = repository.getWorkTask(taskId)
          if (!latestTask) throw new Error('候補者検索タスクが見つかりません。')
          assertWorkTaskAllowsExecution(latestTask)
          const persisted = repository.saveCandidateMatchRun(latestTask.id, query, matches, new Date(), currentMatchRuntimeIdentity)
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
          repository.updateActionRun(actionRunId, 'succeeded', {
            processingJobId: processingJob.id,
            resultHash: persisted.run.resultSetHash
          })
          return { task: updatedTask, query, run: persisted.run, matches: persisted.matches, processingJob, actionRunId }
        } catch (cause) {
          if (lease) {
            const activeJob = repository.getProcessingJob(processingJob.id)
            if (activeJob?.status === 'running') {
              processingJob = repository.failProcessingJob(processingJob.id, lease.leaseToken, 'CANDIDATE_MATCH_FAILED', true)
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
    locale: () => effectiveApplicationPreferences(repository).locale,
    currentOperator,
    currentMatchRuntimeIdentity,
    createMatchTask: (jobCaseId, jobCaseVersion, candidateDocumentId) => {
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
      if (candidateDocumentId) {
        const profile = repository.listEligibleTalentProfiles().find((item) => item.sourceDocumentId === candidateDocumentId)
        if (!profile) throw new Error('所选人员不存在或已停用，请重新选择人员。')
        task.contextBindings.push({
          objectType: 'candidate-profile',
          objectId: candidateDocumentId,
          version: String(profile.profileVersion)
        })
      }
      repository.saveWorkTask(task)
      return { taskId: task.id }
    },
    runCandidateMatchTask: (taskId, metadata) => withTaskOperation(taskId, () => runCandidateMatchTask(taskId, null, metadata)),
    runResumeAnalysisTask: async (fileToken) => {
      // The renderer never names a task; the import task is derived from the
      // staged file it is bound to.
      const record = repository.getStagedFileRecords([fileToken])[0]
      if (!record) throw new Error('添付ファイルが見つかりません。')
      const task = repository
        .listWorkTasks()
        .find(
          (candidate) =>
            candidate.type === 'IMPORT_RESUME' &&
            candidate.contextBindings.some((binding) => binding.objectType === 'staged-file' && binding.objectId === fileToken)
        )
      if (!task) throw new Error('スキルシート取込タスクが見つかりません。')
      const execution = await runResumeAnalysisTask({ fileToken, taskId: task.id })
      return {
        name: record.name,
        format: record.format,
        facts: agentDraftFactsFromResumeAnalysis(execution.analysis, 'RESUME')
      }
    },
    registerConversationImport,
    jobCaseFieldAliases: () => effectiveJobCaseFieldAliases(repository).aliases,
    listConversationImports: (conversationId) => {
      const persisted = (repository.getAiConversation(conversationId)?.messages ?? [])
        .flatMap((message) => message.blocks ?? [])
        .filter((block) => block.type === 'resume-import')
        .flatMap((block) => (block.type === 'resume-import' ? block.imported : []))
        .map((item) => ({ anonymousLabel: item.label, sourceDocumentId: item.documentId }))
      const runtime = (conversationImports.get(conversationId) ?? []).map((item) => ({
        anonymousLabel: item.label,
        sourceDocumentId: item.sourceDocumentId
      }))
      return [...persisted, ...runtime].filter(
        (item, index, all) => all.findIndex((other) => other.sourceDocumentId === item.sourceDocumentId) === index
      )
    },
    newCaseDigestCounts: () => {
      const digest = deriveNewCaseDigest({
        reviews: repository.listJobCaseReviews(),
        seenReviewIds: repository.listSeenJobCaseReviewIds(),
        now: new Date()
      })
      return { newCasesToday: digest.newCasesToday, unseenCaseCount: digest.unseenCount }
    },
    listSchedulableCandidates: () =>
      repository
        .listCandidateReviews()
        .filter((review) => review.recordStatus === 'active')
        .map((review, index) => ({
          anonymousLabel: review.profile?.id ? `CANDIDATE_${index + 1}` : `RESUME_${index + 1}`,
          sourceDocumentId: review.documentId
        })),
    scheduleCandidateInterview: (input) => {
      if (input.kind === 'client') {
        // A client interview is always for a case: it is booked on that case's 跟进, under the same rules
        // (ended case, 暂停营业, 已进场, time conflicts) and moves the follow-up to 已约面.
        if (!input.caseReviewId)
          throw new Error('客户面试需要指定案件，请在案件的跟进中安排。 / 顧客面談は案件を指定し、対応記録から設定してください。')
        // 已进场, 暂停营业, an ended case and time conflicts are refused by 跟进's own rules below.
        const actor = currentOperator().displayName
        const pair = { documentId: input.sourceDocumentId, reviewId: input.caseReviewId }
        if (rejectedByHr(repository, pair.documentId, pair.reviewId))
          throw new Error(
            '这个人员已被判定不满足该案件的要求，不能安排客户面试。 / この要員は案件の条件を満たさないと判断済みのため、顧客面談は設定できません。'
          )
        const current = repository
          .listBusinessFollowUps()
          .find((item) => item.documentId === pair.documentId && item.reviewId === pair.reviewId)
        // Booking from the conversation only adds a first or next interview; anything else is decided on 跟进.
        const latest = current?.progress?.rounds.at(-1)
        const pastStage = Boolean(current?.progress && ['entry', 'started', 'ended'].includes(current.progress.stage))
        // A booked round still ahead is changed on 跟进 (重新预约); one already held may be followed by the next round
        // before its result is written down, as 跟进 allows.
        const upcoming = Boolean(
          latest?.scheduledAt && !latest.decision && Date.parse(latest.scheduledAt) + latest.durationMinutes * 60000 > Date.now()
        )
        if (current?.progress && (pastStage || upcoming))
          throw new Error(
            pastStage
              ? '这个跟进已经过了面试阶段，请在跟进中处理。 / この対応は面談の段階を過ぎています。対応記録で操作してください。'
              : '这一轮客户面试已经约好；如需改时间，请在跟进中「重新预约」。 / この回の顧客面談は予約済みです。日時の変更は対応記録の「再予約」から行ってください。'
          )
        // Any row there already (even an older one without stages) is the HR's record and is never removed here.
        const existed = Boolean(current)
        const [row] = repository.beginBusinessProgress([pair], actor)
        const last = row!.progress?.rounds.at(-1)
        try {
          repository.advanceBusinessProgress(
            {
              ...pair,
              expectedRevision: row!.revision,
              mutationId: randomUUID(),
              action: 'schedule',
              schedule: {
                // The next round after one decided or already held; the same round when it was never booked.
                roundNumber: !last ? 1 : last.decision || last.scheduledAt ? last.roundNumber + 1 : last.roundNumber,
                scheduledAt: input.scheduledAt,
                durationMinutes: input.durationMinutes,
                meetingMethod: input.meetingMethod,
                meetingUrl: input.meetingUrl ?? '',
                location: '',
                interviewer: actor,
                note: input.contactNote ?? ''
              }
            },
            actor
          )
        } catch (cause) {
          // Not booked (a conflict, an ended case…): a follow-up created just for this booking goes away again.
          if (!existed) repository.deleteBusinessFollowUp({ followUpId: row!.id, expectedRevision: row!.revision })
          throw cause
        }
        return
      }
      // The latest recruiting round already booked and still ahead is changed in 面试日程 (改期), not silently moved
      // from the conversation; a held, cancelled or never-booked one takes the new time.
      const latestRecruiting = repository
        .listCandidateInterviews()
        .filter((item) => item.sourceDocumentId === input.sourceDocumentId && item.kind === 'recruiting' && !item.businessFollowUpId)
        .sort((a, b) => b.roundNumber - a.roundNumber)[0]
      if (
        latestRecruiting?.scheduledAt &&
        !latestRecruiting.decision &&
        Date.parse(latestRecruiting.scheduledAt) + latestRecruiting.durationMinutes * 60000 > Date.now()
      )
        throw new Error(
          '这个人员的招聘面试已经约好；如需改时间，请在面试日程中「改期」。 / この要員の採用面談は予約済みです。日時の変更は面談日程の「日程変更」から行ってください。'
        )
      repository.saveCandidateInterviewSchedule(
        {
          sourceDocumentId: input.sourceDocumentId,
          kind: input.kind,
          scheduledAt: input.scheduledAt,
          durationMinutes: input.durationMinutes,
          meetingMethod: input.meetingMethod,
          ...(input.meetingUrl ? { meetingUrl: input.meetingUrl } : {}),
          interviewer: currentOperator().displayName,
          ...(input.contactNote ? { contactNote: input.contactNote } : {})
        },
        currentOperator().displayName
      )
    },
    cancelMatchTask: (taskId) => {
      const task = repository.getWorkTask(taskId)
      if (!task) return
      repository.requestProcessingJobCancellationForTask(taskId)
      if (!['completed', 'cancelled', 'failed'].includes(task.status)) repository.saveWorkTask(cancelWorkTask(task))
    },
    modelCatalog: agentChatModelCatalog,
    previewedDrafts,
    narrativeStreamer: agentNarrativeStreamer,
    ...(businessTextIntakeEnabled
      ? {
          executeBusinessTextIntake: (useCase, input, decision, turn) =>
            executeBusinessTextIntakeTurn(
              {
                repository,
                actionOrchestrator,
                locale: () => effectiveApplicationPreferences(repository).locale,
                operatorId: () => currentOperator().operatorId,
                importJobCaseText: (text, fieldOverrides, intakeBatchId) =>
                  importChatPastedJobCaseText(
                    { repository, localNer, operator: currentOperator() },
                    text,
                    new Date(),
                    fieldOverrides,
                    intakeBatchId ?? null,
                    effectiveJobCaseFieldAliases(repository).aliases
                  ),
                importCandidateText: (text, fieldOverrides) =>
                  importPastedCandidateText({ repository, fileVault, localNer }, text, new Date(), fieldOverrides),
                registerConversationImport,
                // Redacted cloud segmentation and verbatim-verified field extraction
                // for every intake route. Its own switch, so the lane can be pulled
                // without touching the local gate.
                extractRecordsViaCloud:
                  businessTextCloudAssistEnabled && agentNarrativeStreamer
                    ? (text, hooks) =>
                        agentNarrativeStreamer.extractBusinessText({
                          conversationId: input.conversationId,
                          requestId: input.requestId,
                          text,
                          aliases: effectiveJobCaseFieldAliases(repository).aliases,
                          model: resolveAgentChatModel(agentChatModelCatalog, input.modelKey),
                          signal: hooks.signal,
                          onClientRequestId: hooks.onClientRequestId,
                          onRemoteSettled: hooks.onRemoteSettled
                        })
                    : null
              },
              useCase,
              input,
              decision,
              turn
            )
        }
      : {})
  })

  return { runCandidateMatchTask, stop: agentIpcStop }
}
