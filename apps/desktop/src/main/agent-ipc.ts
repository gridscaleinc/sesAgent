import { createHash, randomUUID } from 'node:crypto'
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  AgentExecutionError,
  loadAgentChatModelCatalog,
  LocalAgentUseCase,
  resolveAgentChatModel,
  type AgentChatModelDefinition,
  type AgentCandidateMatchRecord,
  type AgentJobCaseRecord,
  type AgentResumeImportOutput,
  type AgentToolExecutionMetadata,
  type LocalAgentPort
} from '@agent'
import { hashActionInput, type ActionContext, type ActionOrchestrator } from '@action-runtime'
import type { MatchRuntimeIdentity } from '@matching'
import type { EncryptedApplicationRepository } from '@persistence'
import {
  agentTurnEventSchema,
  cancelAgentTurnInputSchema,
  executeAgentTurnInputSchema,
  ipcChannels,
  type ApplicationLocale,
  type AgentSystemAccessBlock,
  type AgentTurnEvent,
  type AiConversationMessage,
  type AiConversationSalesAgentState,
  type AiConversationSnapshot,
  type CancelAgentTurnResult,
  type CandidateMatchTaskExecutionResult,
  type ExecuteAgentTurnResult
} from '@shared'
import type { AgentCandidateDraftFacts } from '@shared'
import type { AgentActiveWorkspaceEvidence, AgentNarrativeStreamer } from './agent-cloud-narrative'

interface AgentMatchTaskResult extends CandidateMatchTaskExecutionResult {
  actionRunId?: string | null
}

export interface AgentIpcDependencies {
  repository: EncryptedApplicationRepository
  actionOrchestrator: ActionOrchestrator
  assertTrustedSender(event: IpcMainInvokeEvent): void
  conversationalMatchingEnabled(): boolean
  locale(): ApplicationLocale
  currentOperator(): { operatorId: string; displayName: string }
  currentMatchRuntimeIdentity: MatchRuntimeIdentity
  createMatchTask(jobCaseId: string, jobCaseVersion: number): { taskId: string }
  runCandidateMatchTask(taskId: string, metadata: AgentToolExecutionMetadata): Promise<AgentMatchTaskResult>
  cancelMatchTask(taskId: string): void
  /** Runs the existing local resume analysis for one staged file. */
  runResumeAnalysisTask(fileToken: string, metadata: AgentToolExecutionMetadata): Promise<{
    name: string
    format: string
    facts?: AgentCandidateDraftFacts
  }>
  /** Writes one interview through the same repository path the manual form uses. */
  /** How many candidates can hold an interview, so the planner knows one exists. */
  listSchedulableCandidates?(): Array<{ anonymousLabel: string; sourceDocumentId: string }>
  /** Records an import against the conversation it happened in. */
  registerConversationImport?(conversationId: string, sourceDocumentId: string): void
  /** Resumes imported during this conversation, by either route. */
  listConversationImports?(conversationId: string): Array<{ anonymousLabel: string; sourceDocumentId: string }>
  scheduleCandidateInterview(input: {
    sourceDocumentId: string
    scheduledAt: string
    durationMinutes: number
    meetingMethod: 'zoom' | 'google-meet' | 'phone' | 'onsite'
    meetingUrl?: string
    kind: 'recruiting' | 'client'
    contactNote?: string
  }): void
  modelCatalog?: readonly AgentChatModelDefinition[]
  narrativeStreamer?: AgentNarrativeStreamer | null
  /** Locally derived preview facts, keyed by staged file token. */
  previewedDrafts?: ReadonlyMap<string, AgentCandidateDraftFacts>
}

interface ActiveAgentTurn {
  requestId: string
  taskId: string | null
  cancelled: boolean
  abortController: AbortController
  clientRequestId: string | null
  remoteRequestInFlight: boolean
  remoteCancelStatus: 'cancel_requested' | 'canceled' | 'too_late' | null
  remoteCancelAttempted: boolean
  remoteCancelFailed: boolean
  cancelPromise: Promise<'cancel_requested' | 'canceled' | 'too_late' | null> | null
  sequence: number
  totalDeltaCharacters: number
  streamingStarted: boolean
  model: AgentChatModelDefinition
  sender: IpcMainInvokeEvent['sender']
  conversationId: string
  eventDeliveryStopped: boolean
  attachmentFileTokens: string[]
}

type AgentTurnEventPayload = AgentTurnEvent extends infer Event
  ? Event extends AgentTurnEvent
    ? Omit<Event, 'conversationId' | 'requestId' | 'sequence' | 'modelKey' | 'modelDisplayName'>
    : never
  : never

function safeJobCaseRecord(jobCase: ReturnType<EncryptedApplicationRepository['listActiveJobCases']>[number]): AgentJobCaseRecord {
  const field = (key: string): string | null => jobCase.fields.find((item) => item.key === key)?.value ?? null
  return {
    id: jobCase.id,
    version: jobCase.version,
    title: field('title') ?? `案件 ${jobCase.id.slice(0, 8)}`,
    updatedAt: jobCase.confirmedAt,
    requiredSkills: field('required_skills'),
    rate: field('rate'),
    workStyle: field('remote') ?? field('location'),
    startDate: field('start_date'),
    status: 'current'
  }
}

function boundedWorkspaceText(value: string | null | undefined, maximum = 600): string | null {
  if (!value) return null
  return value.length <= maximum ? value : `${value.slice(0, Math.max(1, maximum - 1))}…`
}

function buildActiveWorkspaceEvidence(
  access: AgentSystemAccessBlock | null | undefined,
  deps: Pick<AgentIpcDependencies, 'repository' | 'currentMatchRuntimeIdentity'>
): AgentActiveWorkspaceEvidence | null {
  if (!access) return null
  const candidateReviews = () => deps.repository.listCandidateReviews()
  const interviews = () => deps.repository.listCandidateInterviews()
  const candidateProjection = (sourceDocumentId: string) => {
    const reviews = candidateReviews()
    const review = reviews.find((item) => item.documentId === sourceDocumentId)
    if (!review) return null
    const ordinal = Math.max(1, reviews.findIndex((item) => item.documentId === sourceDocumentId) + 1)
    return {
      candidate: `WORKSPACE_CANDIDATE_${ordinal}`,
      reviewStatus: review.status,
      recruitingStatus: review.recruitingStatus,
      talentPoolStatus: review.talentPoolStatus,
      recordStatus: review.recordStatus,
      profileVersion: review.profile?.version ?? null,
      fields: review.fields.filter((field) => field.value).slice(0, 12).map((field) => ({
        key: field.key,
        label: boundedWorkspaceText(field.label, 80),
        value: boundedWorkspaceText(field.value, 400),
        status: field.status
      })),
      projects: review.projectExperiences.slice(0, 6).map((project) => ({
        title: boundedWorkspaceText(project.title, 180),
        period: boundedWorkspaceText(project.period, 100),
        role: boundedWorkspaceText(project.role, 120),
        technologies: project.technologies.slice(0, 12).map((item) => boundedWorkspaceText(item, 80)),
        summary: boundedWorkspaceText(project.summary, 600)
      }))
    }
  }
  const interviewProjection = (interview: ReturnType<typeof interviews>[number]) => ({
    kind: interview.kind,
    roundNumber: interview.roundNumber,
    stage: interview.stage,
    scheduledAt: interview.scheduledAt,
    durationMinutes: interview.durationMinutes,
    meetingMethod: interview.meetingMethod,
    interviewer: boundedWorkspaceText(interview.interviewer, 120),
    contactNote: boundedWorkspaceText(interview.contactNote, 500),
    interviewGoal: boundedWorkspaceText(interview.interviewGoal, 500),
    interviewNotes: boundedWorkspaceText(interview.interviewNotes, 900),
    unresolvedItems: interview.unresolvedItems.slice(0, 8).map((item) => boundedWorkspaceText(item, 240)),
    decision: interview.decision,
    decisionReason: boundedWorkspaceText(interview.decisionReason, 600),
    updatedAt: interview.updatedAt,
    meetingLinkStoredLocally: Boolean(interview.meetingUrl)
  })

  if (access.destination === 'job-cases' || access.destination === 'case-import') {
    const reviews = deps.repository.listJobCaseReviews()
    const active = reviews.filter((review) => review.lifecycle === 'active')
    return {
      destination: access.destination,
      data: {
        activeCount: active.filter((review) => review.status === 'completed').length,
        pendingReviewCount: active.filter((review) => review.status === 'awaiting-review').length,
        archivedCount: reviews.filter((review) => review.lifecycle === 'archived').length,
        cases: active.slice(0, 8).map((review, index) => ({
          case: `WORKSPACE_CASE_${index + 1}`,
          status: review.status,
          sourceType: review.sourceType,
          title: boundedWorkspaceText(review.fields.find((field) => field.key === 'title')?.value ?? review.redactedSubject, 240),
          fields: review.fields.filter((field) => field.value).slice(0, 10).map((field) => ({
            key: field.key,
            label: boundedWorkspaceText(field.label, 80),
            value: boundedWorkspaceText(field.value, 400),
            status: field.status
          })),
          warningCount: review.warningCodes.length
        }))
      }
    }
  }

  if (access.destination === 'case-review') {
    const review = deps.repository.listJobCaseReviews().find((item) => item.reviewId === access.reviewId)
    return {
      destination: access.destination,
      data: review ? {
        status: review.status,
        lifecycle: review.lifecycle,
        sourceType: review.sourceType,
        title: boundedWorkspaceText(review.fields.find((field) => field.key === 'title')?.value ?? review.redactedSubject, 240),
        preview: boundedWorkspaceText(review.redactedPreview, 800),
        fields: review.fields.slice(0, 14).map((field) => ({
          key: field.key,
          label: boundedWorkspaceText(field.label, 80),
          value: boundedWorkspaceText(field.value, 500),
          status: field.status
        })),
        warnings: review.warningCodes.slice(0, 12)
      } : { unavailable: true }
    }
  }

  if (access.destination === 'matching') {
    const projection = deps.repository.getMatchingHomeProjection(deps.currentMatchRuntimeIdentity)
    const selectedCase = projection.jobCases.find((item) => item.id === access.jobCaseId)
      ?? projection.jobCases.find((item) => item.id === projection.selectedJobCaseId)
      ?? projection.jobCases[0]
    const runMatchesCase = Boolean(selectedCase && projection.currentRun?.run.binding?.jobCaseId === selectedCase.id)
    return {
      destination: access.destination,
      data: {
        state: projection.state,
        eligibleCandidateCount: projection.eligibleCandidateCount,
        selectedCase: selectedCase ? {
          title: boundedWorkspaceText(selectedCase.title, 240),
          version: selectedCase.version,
          validity: selectedCase.validity,
          lastRunCreatedAt: selectedCase.lastRunCreatedAt
        } : null,
        results: runMatchesCase ? projection.currentRun!.results.slice(0, 8).map((result) => ({
          candidate: `WORKSPACE_CANDIDATE_${result.fit.rank}`,
          rank: result.fit.rank,
          matchScore: result.fit.matchScore,
          termCoverage: result.fit.termCoverage,
          hardFilterUnknownCount: result.fit.hardFilterUnknownCount,
          matchedTerms: result.fit.matchedTerms.slice(0, 12).map((item) => boundedWorkspaceText(item, 180)),
          evidence: result.fit.evidence.slice(0, 8).map((item) => ({
            key: item.key,
            label: boundedWorkspaceText(item.label, 80),
            value: boundedWorkspaceText(item.value, 300)
          })),
          projectEvidence: result.fit.projectEvidence ? {
            title: boundedWorkspaceText(result.fit.projectEvidence.title, 180),
            role: boundedWorkspaceText(result.fit.projectEvidence.role, 120),
            technologies: result.fit.projectEvidence.technologies.slice(0, 10).map((item) => boundedWorkspaceText(item, 80)),
            summary: boundedWorkspaceText(result.fit.projectEvidence.summary, 500)
          } : null,
          businessPriority: result.businessPriority.effectiveLevel
        })) : []
      }
    }
  }

  if (access.destination === 'candidate-management') {
    const reviews = candidateReviews()
    return {
      destination: access.destination,
      data: {
        totalCount: reviews.length,
        pendingReviewCount: reviews.filter((review) => review.status === 'awaiting-review').length,
        eligibleCount: reviews.filter((review) => review.talentPoolStatus === 'eligible').length,
        candidates: reviews.slice(0, 10).map((review, index) => ({
          candidate: `WORKSPACE_CANDIDATE_${index + 1}`,
          reviewStatus: review.status,
          recruitingStatus: review.recruitingStatus,
          talentPoolStatus: review.talentPoolStatus,
          role: boundedWorkspaceText(review.fields.find((field) => field.key === 'role')?.value, 160),
          skills: boundedWorkspaceText(review.fields.find((field) => field.key === 'skills')?.value, 400),
          availability: boundedWorkspaceText(review.fields.find((field) => field.key === 'availability')?.value, 160)
        }))
      }
    }
  }

  if (access.destination === 'candidate' || access.destination === 'original-document') {
    const candidate = candidateProjection(access.sourceDocumentId)
    const candidateInterviews = interviews().filter((item) => item.sourceDocumentId === access.sourceDocumentId)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    const focused = access.destination === 'candidate' && access.interviewId
      ? candidateInterviews.find((item) => item.id === access.interviewId) ?? null
      : null
    return {
      destination: access.destination,
      data: {
        source: access.destination === 'original-document' ? 'structured-extraction-only' : 'candidate-profile',
        candidate,
        focusedInterview: focused ? interviewProjection(focused) : null,
        interviews: candidateInterviews.slice(0, 8).map(interviewProjection)
      }
    }
  }

  if (access.destination === 'interview-schedule') {
    const allInterviews = interviews()
    const receipt = access.receipt
    const focused = receipt
      ? allInterviews.find((item) => item.sourceDocumentId === receipt.sourceDocumentId && item.kind === receipt.kind && item.scheduledAt === receipt.scheduledAt)
        ?? allInterviews.filter((item) => item.sourceDocumentId === receipt.sourceDocumentId && item.kind === receipt.kind).toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
      : allInterviews.filter((item) => item.scheduledAt).toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
    return {
      destination: access.destination,
      data: {
        scheduledCount: allInterviews.filter((item) => item.scheduledAt).length,
        focusedCandidate: focused ? candidateProjection(focused.sourceDocumentId) : null,
        focusedInterview: focused ? interviewProjection(focused) : null,
        visibleInterviews: allInterviews.filter((item) => item.scheduledAt).slice(0, 12).map(interviewProjection)
      }
    }
  }

  if (access.destination === 'review-center') {
    const candidates = candidateReviews()
    const cases = deps.repository.listJobCaseReviews()
    const tasks = deps.repository.listWorkTasks()
    const approvals = deps.repository.listActionApprovals()
    return {
      destination: access.destination,
      data: {
        pendingCandidateCount: candidates.filter((item) => item.status === 'awaiting-review').length,
        pendingCaseCount: cases.filter((item) => item.lifecycle === 'active' && item.status === 'awaiting-review').length,
        pendingTaskCount: tasks.filter((item) => item.status === 'awaiting_review').length,
        pendingApprovalCount: approvals.filter((item) => item.status === 'pending').length,
        candidates: candidates.filter((item) => item.status === 'awaiting-review').slice(0, 8).map((item, index) => ({
          candidate: `WORKSPACE_CANDIDATE_${index + 1}`,
          confirmedFieldCount: item.fields.filter((field) => field.value).length,
          projectCount: item.projectExperiences.length
        })),
        cases: cases.filter((item) => item.lifecycle === 'active' && item.status === 'awaiting-review').slice(0, 8).map((item, index) => ({
          case: `WORKSPACE_CASE_${index + 1}`,
          title: boundedWorkspaceText(item.redactedSubject, 240),
          warningCount: item.warningCodes.length
        })),
        approvals: approvals.filter((item) => item.status === 'pending').slice(0, 8).map((item) => ({
          toolName: item.toolName,
          safeSummary: boundedWorkspaceText(item.safeSummary, 500),
          reason: boundedWorkspaceText(item.reason, 300)
        }))
      }
    }
  }

  const task = deps.repository.getWorkTask(access.taskId)
  return {
    destination: access.destination,
    data: task ? {
      type: task.type,
      typeLabel: boundedWorkspaceText(task.typeLabel, 120),
      status: task.status,
      progress: task.progress,
      evidenceCount: task.evidenceCount,
      scope: boundedWorkspaceText(task.scope.label, 300),
      updatedAt: task.updatedAt
    } : { unavailable: true }
  }
}

function actionIdempotencyKey(toolName: string, conversationId: string, requestId: string): string {
  return createHash('sha256').update(`${toolName}:${conversationId}:${requestId}`).digest('hex')
}

function agentRequestFingerprint(input: ReturnType<typeof executeAgentTurnInputSchema.parse>): string {
  return createHash('sha256').update(JSON.stringify({
    conversationId: input.conversationId,
    message: input.message,
    expectedConversationRevision: input.expectedConversationRevision,
    modelKey: input.modelKey,
    selectedJobCaseRef: input.selectedJobCaseRef,
    activeSystemAccess: input.activeSystemAccess ?? null,
    attachmentFileTokens: input.attachmentFileTokens ?? [],
    branchFrom: input.branchFrom ?? null
  })).digest('hex')
}

function branchedSalesAgentState(messages: readonly AiConversationMessage[]): AiConversationSalesAgentState {
  let selectedJobCaseRef: AiConversationSalesAgentState['selectedJobCaseRef'] = null
  let lastMatchRunId: string | null = null
  let lastSearchMessageId: string | null = null
  for (const message of messages) for (const block of message.blocks ?? []) {
    if (block.type === 'job-case-cards') {
      lastSearchMessageId = message.id
      // A one-card detail answer carries an unambiguous case selection. Search
      // result lists do not reveal which card the operator selected afterwards.
      selectedJobCaseRef = block.cards.length === 1 ? block.cards[0]!.reference : null
    }
    if (block.type === 'candidate-match-cards') lastMatchRunId = block.runId
    if (block.type === 'match-run-explanation') lastMatchRunId = block.facts.runId
  }
  return { selectedJobCaseRef, lastMatchRunId, lastSearchMessageId }
}

function actionContext(
  metadata: AgentToolExecutionMetadata,
  scopeId: string,
  scopeFingerprint: string,
  actorId: string,
  persistedConversationId: string | null
): ActionContext {
  return {
    origin: 'user-command',
    workTaskId: null,
    scopeId,
    scopeFingerprint,
    actorId,
    conversationId: persistedConversationId,
    turnId: persistedConversationId ? metadata.turnId : null
  }
}

const agentSearchEarliestDate = '1970-01-01T00:00:00.000Z'
const agentSearchLatestDate = '9999-12-31T23:59:59.999Z'

function caseMatchesQuery(record: AgentJobCaseRecord, query: string | null): boolean {
  if (!query) return true
  const haystack = [record.title, record.requiredSkills, record.rate, record.workStyle, record.startDate]
    .filter(Boolean).join('\n').normalize('NFKC').toLocaleLowerCase('ja-JP')
  return haystack.includes(query.normalize('NFKC').toLocaleLowerCase('ja-JP'))
}

export function registerAgentIpcHandlers(deps: AgentIpcDependencies): () => void {
  const modelCatalog = deps.modelCatalog ?? loadAgentChatModelCatalog()
  const activeTurns = new Map<string, ActiveAgentTurn>()
  type AgentRequestRecord = { conversationId: string; fingerprint: string; promise: Promise<ExecuteAgentTurnResult> }
  const inFlightRequests = new Map<string, AgentRequestRecord>()
  const requestResults = new Map<string, AgentRequestRecord>()
  const maximumCompletedRequestResults = 100
  let disposed = false

  const emit = (
    state: ActiveAgentTurn,
    event: AgentTurnEventPayload
  ): void => {
    if (disposed || state.eventDeliveryStopped) return
    try {
      if (state.sender.isDestroyed()) {
        state.eventDeliveryStopped = true
        return
      }
      const sequence = state.sequence + 1
      const parsed = agentTurnEventSchema.parse({
        ...event,
        conversationId: state.conversationId,
        requestId: state.requestId,
        sequence,
        modelKey: state.model.key,
        modelDisplayName: state.model.displayName
      })
      state.sender.send(ipcChannels.agentTurnEvent, parsed)
      state.sequence = sequence
    } catch {
      state.eventDeliveryStopped = true
    }
  }

  const remoteCancelMessage = (state: ActiveAgentTurn, status: ActiveAgentTurn['remoteCancelStatus']): string => {
    if (status === 'canceled') return 'AICommerce 返回 canceled，已确认取消；但不代表自动退款，费用仍以 AICommerce 最终结算为准。'
    if (status === 'too_late') return 'AICommerce 返回 too_late；本地已停止显示，但远端请求可能已经完成并产生费用，最终费用仍以 AICommerce 结算为准。'
    if (status === 'cancel_requested') return 'AICommerce 已受理取消请求，但不代表 Provider 已停止，也不保证免费或退款。'
    if (!state.clientRequestId) return '已停止本地读取和显示；本次尚未取得可独立取消的远端请求标识。'
    if (!state.remoteRequestInFlight) return '远端 AI 请求已经结束；已停止本地后续处理，最终费用仍以 AICommerce 结算为准。'
    if (state.remoteCancelFailed) return '已取得远端请求标识，但独立取消请求失败；本地已停止，最终费用仍由 AICommerce 结算。'
    if (!state.remoteCancelAttempted) return '已取得远端请求标识，但未能发起独立取消请求；本地已停止，最终费用仍由 AICommerce 结算。'
    return '已停止本地读取和显示；远端取消请求未返回可确认状态，最终费用仍由 AICommerce 结算。'
  }

  const requestRemoteCancel = (state: ActiveAgentTurn): Promise<ActiveAgentTurn['remoteCancelStatus']> => {
    if (state.cancelPromise) return state.cancelPromise
    if (!state.remoteRequestInFlight || !state.clientRequestId || !deps.narrativeStreamer) return Promise.resolve(null)
    state.remoteCancelAttempted = true
    state.cancelPromise = deps.narrativeStreamer.cancel(state.clientRequestId).then((result) => {
      state.remoteCancelStatus = result.status
      state.remoteCancelFailed = false
      return result.status
    }, () => {
      state.remoteCancelFailed = true
      return null
    })
    return state.cancelPromise
  }

  const markRemoteRequestStarted = (state: ActiveAgentTurn, clientRequestId: string): void => {
    state.clientRequestId = clientRequestId
    state.remoteRequestInFlight = true
    state.remoteCancelStatus = null
    state.remoteCancelAttempted = false
    state.remoteCancelFailed = false
    state.cancelPromise = null
    if (state.cancelled) void requestRemoteCancel(state)
  }

  const markRemoteRequestSettled = (state: ActiveAgentTurn): void => {
    state.remoteRequestInFlight = false
  }

  const saveNarrativeState = (
    result: ExecuteAgentTurnResult,
    patch: Pick<AiConversationMessage, 'content' | 'mode' | 'modelKey' | 'modelDisplayName' | 'narrativeStatus'>
  ): { conversation: AiConversationSnapshot; assistantMessage: AiConversationMessage } => {
    const messages = result.conversation.messages.map((message) => message.id === result.assistantMessage.id
      ? { ...message, ...patch }
      : message)
    const conversation = deps.repository.saveAiConversation({
      conversationId: result.conversation.id,
      context: result.conversation.context,
      messages,
      salesAgentState: result.conversation.salesAgentState,
      expectedRevision: result.conversation.revision
    })
    const assistantMessage = conversation.messages.find((message) => message.id === result.assistantMessage.id)
    if (!assistantMessage) throw new Error('Agent assistant message was not preserved.')
    return { conversation, assistantMessage }
  }

  const localFallbackResult = (
    result: ExecuteAgentTurnResult,
    model: AgentChatModelDefinition,
    narrativeStatus: 'failed-local-fallback' | 'cancelled',
    status: 'failed' | 'cancelled'
  ): ExecuteAgentTurnResult => {
    try {
      const saved = saveNarrativeState(result, {
        content: result.assistantMessage.content,
        mode: 'local-fallback',
        modelKey: model.key,
        modelDisplayName: model.displayName,
        narrativeStatus
      })
      return { ...result, status, ...saved }
    } catch {
      return { ...result, status }
    }
  }

  const rememberCompletedRequest = (requestId: string, record: AgentRequestRecord) => {
    inFlightRequests.delete(requestId)
    requestResults.set(requestId, record)
    while (requestResults.size > maximumCompletedRequestResults) {
      const oldest = requestResults.keys().next().value as string | undefined
      if (!oldest) break
      requestResults.delete(oldest)
    }
  }

  const port: LocalAgentPort = {
    listActiveJobCases: () => deps.repository.listActiveJobCases().map(safeJobCaseRecord),
    loadConversation: (conversationId) => deps.repository.getAiConversation(conversationId),
    saveConversation: (input) => deps.repository.saveAiConversation(input),
    locale: () => deps.locale(),
    listSchedulableCandidates: () => deps.repository.listCandidateReviews()
      .filter((review) => review.recordStatus === 'active')
      .map((review, index) => ({
        // Anonymous label only: the agent never receives the candidate's name or file name.
        anonymousLabel: review.profile?.id ? `CANDIDATE_${index + 1}` : `RESUME_${index + 1}`,
        sourceDocumentId: review.documentId
      })),
    resolveInterviewCandidate: (runId, resultId, rank) => {
      const facts = deps.repository.getAgentCandidateProfileFacts(runId, deps.currentMatchRuntimeIdentity, resultId, rank)
      if (!facts.candidate) return null
      const sourceDocumentId = deps.repository.getCandidateSourceDocumentId(facts.candidate.candidateProfileId)
      return sourceDocumentId ? { anonymousLabel: facts.candidate.anonymousLabel, sourceDocumentId } : null
    },
    listConversationImports: (conversationId) => deps.listConversationImports?.(conversationId) ?? [],
    listAttachmentFileTokens: (conversationId, requestId) => {
      const turn = activeTurns.get(conversationId)
      return turn?.requestId === requestId ? turn.attachmentFileTokens : []
    },
    isCancelled: (conversationId, requestId) => activeTurns.get(conversationId)?.requestId === requestId && activeTurns.get(conversationId)?.cancelled === true,
    executeTool: async (toolName, rawInput, metadata) => {
      if (activeTurns.get(metadata.conversationId)?.requestId === metadata.requestId && activeTurns.get(metadata.conversationId)?.cancelled) {
        throw new AgentExecutionError('TURN_CANCELLED', '当前案件匹配操作已取消。')
      }
      const scopeId = toolName === 'job-case.search.local' ? 'active-job-cases'
        : toolName === 'candidate.profile.read.local' ? 'selected-candidate-profile'
        : toolName === 'candidate.interview.read.local' ? 'selected-candidate-interviews'
        : toolName === 'match-run.read.local' ? 'selected-match-run'
        : toolName === 'candidate.interview.schedule.local' ? 'selected-candidate-profile'
        : toolName === 'resume.analyze.local' || toolName === 'candidate.draft.read.local' ? 'selected-files'
          : 'confirmed-candidate-pool'
      const scopeFingerprint = hashActionInput(rawInput)
      const actorId = deps.currentOperator().operatorId
      const existingConversation = deps.repository.getAiConversation(metadata.conversationId)
      const persistedConversationId = existingConversation?.context.assistant === 'sales-agent'
        ? metadata.conversationId
        : null
      const context = actionContext(metadata, scopeId, scopeFingerprint, actorId, persistedConversationId)
      if (toolName === 'candidate.match.local') {
        const input = rawInput as { jobCaseId: string; jobCaseVersion: number }
        const task = deps.createMatchTask(input.jobCaseId, input.jobCaseVersion)
        const active = activeTurns.get(metadata.conversationId)
        if (active?.requestId === metadata.requestId) active.taskId = task.taskId
        let execution: AgentMatchTaskResult
        try {
          execution = await deps.runCandidateMatchTask(task.taskId, metadata)
        } catch (error) {
          if (active?.cancelled) {
            throw new AgentExecutionError(
              'TURN_CANCELLED',
              '当前案件匹配操作已取消。',
              error instanceof AgentExecutionError ? error.actionRunId : null
            )
          }
          if (error instanceof AgentExecutionError) throw error
          throw new AgentExecutionError('AGENT_TOOL_FAILED', '候选人匹配工具执行失败。', null)
        }
        if (active?.cancelled) throw new AgentExecutionError('TURN_CANCELLED', '当前案件匹配操作已取消。')
        const cards: AgentCandidateMatchRecord[] = execution.matches.map((match, index) => ({
          candidateProfileId: match.id,
          sourceDocumentId: match.sourceDocumentId,
          runId: execution.run.id,
          resultId: match.matchResultId,
          resultHash: match.matchResultHash,
          rank: match.retrieval.rank ?? index + 1,
          anonymousLabel: match.anonymousLabel,
          fitScore: match.matchScore,
          matched: match.matchedTerms,
          missing: match.retrieval.hardFilters.filter((filter) => filter.outcome !== 'passed').map((filter) => filter.requested),
          hardFilterStatus: match.retrieval.hardFilters.some((filter) => filter.outcome === 'failed')
            ? 'failed'
            : match.retrieval.hardFilters.some((filter) => filter.outcome === 'unknown') ? 'unknown' : 'passed',
          projectEvidence: match.projectEvidence?.summary ?? null,
          status: 'current'
        }))
        return {
          toolName,
          output: { runId: execution.run.id, resultHash: execution.run.resultSetHash, cards },
          actionRunId: execution.actionRunId ?? null
        }
      }
      if (toolName === 'candidate.interview.schedule.local') {
        const input = rawInput as {
          sourceDocumentId: string; candidateLabel: string; scheduledAt: string
          durationMinutes: number; meetingMethod: 'zoom' | 'google-meet' | 'phone' | 'onsite'
          meetingUrl?: string; kind: 'recruiting' | 'client'; contactNote?: string
        }
        const preflight = deps.actionOrchestrator.preflight(
          toolName, context,
          {
            sourceDocumentId: input.sourceDocumentId, scheduledAt: input.scheduledAt,
            durationMinutes: input.durationMinutes, meetingMethod: input.meetingMethod,
            kind: input.kind,
            ...(input.meetingUrl ? { meetingUrlHash: createHash('sha256').update(input.meetingUrl).digest('hex') } : {}),
            ...(input.contactNote ? { contactNote: input.contactNote } : {})
          },
          '担当者が指定した日時・方法で面談を端末内に登録します。',
          actionIdempotencyKey(toolName, metadata.conversationId, metadata.requestId)
        )
        if (preflight.decision.outcome === 'deny') throw new Error(preflight.decision.reason)
        if (preflight.decision.outcome === 'require-approval') {
          throw new Error('この操作はレビューセンターでの承認待ちです。')
        }
        deps.repository.updateActionRun(preflight.actionRunId, 'running')
        try {
          deps.scheduleCandidateInterview({
            sourceDocumentId: input.sourceDocumentId,
            scheduledAt: input.scheduledAt,
            durationMinutes: input.durationMinutes,
            meetingMethod: input.meetingMethod,
            ...(input.meetingUrl ? { meetingUrl: input.meetingUrl } : {}),
            kind: input.kind,
            contactNote: input.contactNote
          })
        } catch {
          deps.repository.updateActionRun(preflight.actionRunId, 'failed', { errorCode: 'INTERVIEW_SCHEDULE_FAILED' })
          throw new AgentExecutionError(
            'AGENT_INTERVIEW_SCHEDULE_FAILED',
            deps.locale() === 'zh-CN'
              ? '面试登记失败，未保存任何记录。请确认日期、时间、时长和会议链接后重试。'
              : '面談の登録に失敗し、レコードは保存されませんでした。日付、時刻、所要時間、会議リンクを確認して再試行してください。'
          )
        }
        const output = {
          candidateLabel: input.candidateLabel,
          scheduledAt: input.scheduledAt,
          durationMinutes: input.durationMinutes,
          meetingMethod: input.meetingMethod,
          kind: input.kind
        }
        deps.repository.updateActionRun(preflight.actionRunId, 'succeeded', { resultHash: hashActionInput(output) })
        return { toolName, output, actionRunId: preflight.actionRunId }
      }

      if (toolName === 'candidate.draft.read.local') {
        const input = rawInput as { sourceDocumentId: string; label: string }
        const preflight = deps.actionOrchestrator.preflight(
          toolName, context, { sourceDocumentId: input.sourceDocumentId },
          '取込済み履歴書の未確認下書きを端末内で読み取ります。',
          actionIdempotencyKey(toolName, metadata.conversationId, metadata.requestId)
        )
        if (preflight.decision.outcome === 'deny') throw new Error(preflight.decision.reason)
        if (preflight.decision.outcome === 'require-approval') {
          throw new Error('この操作はレビューセンターでの承認待ちです。')
        }
        deps.repository.updateActionRun(preflight.actionRunId, 'running')
        const facts = deps.repository.getAgentCandidateDraftFacts(input.sourceDocumentId, input.label)
        if (!facts) {
          deps.repository.updateActionRun(preflight.actionRunId, 'failed', { errorCode: 'DRAFT_NOT_FOUND' })
          throw new AgentExecutionError('AGENT_DRAFT_NOT_FOUND', '取込済みの下書きが見つかりません。')
        }
        const output = { facts }
        deps.repository.updateActionRun(preflight.actionRunId, 'succeeded', { resultHash: hashActionInput(output) })
        return { toolName, output, actionRunId: preflight.actionRunId }
      }

      if (toolName === 'resume.analyze.local') {
        const input = rawInput as { fileTokens: string[] }
        if (input.fileTokens.length === 0) {
          throw new AgentExecutionError('AGENT_NO_ATTACHMENT', 'このターンには取り込めるファイルが添付されていません。')
        }
        const preflight = deps.actionOrchestrator.preflight(
          toolName, context, input,
          '会話に添付された履歴書を端末内で解析します。',
          actionIdempotencyKey(toolName, metadata.conversationId, metadata.requestId)
        )
        if (preflight.decision.outcome === 'deny') throw new Error(preflight.decision.reason)
        if (preflight.decision.outcome === 'require-approval') {
          throw new Error('この操作はレビューセンターでの承認待ちです。')
        }
        deps.repository.updateActionRun(preflight.actionRunId, 'running')
        const imported: AgentResumeImportOutput['imported'] = []
        const failed: AgentResumeImportOutput['failed'] = []
        for (const fileToken of input.fileTokens) {
          try {
            const analysed = await deps.runResumeAnalysisTask(fileToken, metadata)
            imported.push({
              documentId: fileToken,
              name: analysed.name,
              format: analysed.format,
              reviewRequired: true,
              ...(analysed.facts ? { facts: analysed.facts } : {})
            })
            deps.registerConversationImport?.(metadata.conversationId, fileToken)
          } catch (error) {
            failed.push({
              name: deps.repository.getStagedFileRecords([fileToken])[0]?.name ?? 'unknown',
              code: error instanceof AgentExecutionError ? error.code : 'AGENT_TOOL_FAILED'
            })
          }
        }
        const output: AgentResumeImportOutput = { imported, failed }
        deps.repository.updateActionRun(
          preflight.actionRunId,
          imported.length > 0 ? 'succeeded' : 'failed',
          imported.length > 0 ? { resultHash: hashActionInput(output) } : { errorCode: 'RESUME_IMPORT_FAILED' }
        )
        return { toolName, output, actionRunId: preflight.actionRunId }
      }

      const action = deps.actionOrchestrator.preflight(
        toolName,
        context,
        rawInput,
        '案件匹配事实を端末内で读取します。',
        actionIdempotencyKey(toolName, metadata.conversationId, metadata.requestId)
      )
      if (action.decision.outcome === 'deny') throw new Error(action.decision.reason)
      if (action.decision.outcome === 'require-approval') throw new Error('この操作はレビューセンターでの承認待ちです。')
      const actionRunId = action.actionRunId
      deps.repository.updateActionRun(actionRunId, 'running')
      try {
        if (toolName === 'job-case.search.local') {
          const input = action.input as {
            mode: 'recent' | 'by-id'
            caseId?: string | null
            query?: string | null
            updatedAfter?: string | null
            updatedBefore?: string | null
            limit: number
          }
          const source = deps.repository.listActiveJobCases().map(safeJobCaseRecord)
          const filtered = source.filter((record) => {
            if (input.mode === 'by-id') return record.id === input.caseId
            const after = input.updatedAfter ? new Date(input.updatedAfter).getTime() : Number.NEGATIVE_INFINITY
            const before = input.updatedBefore ? new Date(input.updatedBefore).getTime() : Number.POSITIVE_INFINITY
            return new Date(record.updatedAt).getTime() >= after && new Date(record.updatedAt).getTime() < before && caseMatchesQuery(record, input.query ?? null)
          })
          const cases = filtered.slice(0, Math.min(20, input.limit))
          const output = {
            query: input.query ?? '',
            dataAsOf: new Date().toISOString(),
            updatedAfter: input.updatedAfter ?? agentSearchEarliestDate,
            updatedBefore: input.updatedBefore ?? agentSearchLatestDate,
            totalMatched: filtered.length,
            cases
          }
          const resultHash = hashActionInput(output)
          deps.repository.updateActionRun(actionRunId, 'succeeded', { resultHash })
          return { toolName, output, actionRunId }
        }

        if (toolName === 'candidate.profile.read.local') {
          const input = action.input as { runId: string; resultId?: string | null; rank?: number | null }
          const facts = deps.repository.getAgentCandidateProfileFacts(
            input.runId,
            deps.currentMatchRuntimeIdentity,
            input.resultId ?? null,
            input.rank ?? null
          )
          const output = { facts }
          deps.repository.updateActionRun(actionRunId, 'succeeded', { resultHash: hashActionInput(output) })
          return { toolName, output, actionRunId }
        }

        if (toolName === 'candidate.interview.read.local') {
          const input = action.input as { runId: string; resultId?: string | null; rank?: number | null }
          const facts = deps.repository.getAgentCandidateInterviewFacts(
            input.runId,
            deps.currentMatchRuntimeIdentity,
            input.resultId ?? null,
            input.rank ?? null
          )
          const output = { facts }
          deps.repository.updateActionRun(actionRunId, 'succeeded', { resultHash: hashActionInput(output) })
          return { toolName, output, actionRunId }
        }

        const input = action.input as { runId: string; resultId?: string | null; rank?: number | null }
        const facts = deps.repository.getAgentMatchRunFacts(input.runId, deps.currentMatchRuntimeIdentity, input.resultId ?? null, input.rank ?? null)
        const output = { facts }
        deps.repository.updateActionRun(actionRunId, 'succeeded', { resultHash: facts.resultHash })
        return { toolName, output, actionRunId }
      } catch (error) {
        deps.repository.updateActionRun(actionRunId, 'failed', { errorCode: 'AGENT_TOOL_FAILED' })
        if (error instanceof AgentExecutionError) {
          throw new AgentExecutionError(error.code, error.message, actionRunId)
        }
        throw new AgentExecutionError('AGENT_TOOL_FAILED', '案件匹配工具执行失败。', actionRunId)
      }
    }
  }
  const useCase = new LocalAgentUseCase(port)

  const handleExecute = async (event: IpcMainInvokeEvent, rawInput: unknown): Promise<ExecuteAgentTurnResult> => {
    deps.assertTrustedSender(event)
    if (!deps.conversationalMatchingEnabled()) throw new Error('FEATURE_DISABLED')
    let input = executeAgentTurnInputSchema.parse(rawInput)
    const model = resolveAgentChatModel(modelCatalog, input.modelKey)
    const fingerprint = agentRequestFingerprint(input)
    const previous = requestResults.get(input.requestId)
    if (previous) {
      if (previous.conversationId !== input.conversationId) throw new Error('REQUEST_ID_CONVERSATION_MISMATCH')
      if (previous.fingerprint !== fingerprint) throw new Error('REQUEST_ID_INPUT_MISMATCH')
      return previous.promise
    }
    const inFlight = inFlightRequests.get(input.requestId)
    if (inFlight) {
      if (inFlight.conversationId !== input.conversationId) throw new Error('REQUEST_ID_CONVERSATION_MISMATCH')
      if (inFlight.fingerprint !== fingerprint) throw new Error('REQUEST_ID_INPUT_MISMATCH')
      return inFlight.promise
    }
    const active = activeTurns.get(input.conversationId)
    if (active && active.requestId !== input.requestId) throw new Error('TURN_ALREADY_RUNNING')
    const requestedAttachmentTokens = input.attachmentFileTokens ?? []
    const stagedAttachmentRecords = requestedAttachmentTokens.length === 0
      ? []
      : deps.repository.getStagedFileRecords(requestedAttachmentTokens)
    const stagedAttachmentByToken = new Map(stagedAttachmentRecords.map((record) => [record.token, record]))
    if (requestedAttachmentTokens.some((token) => !stagedAttachmentByToken.has(token))) {
      throw new Error('AGENT_ATTACHMENT_NOT_FOUND')
    }
    const state: ActiveAgentTurn = active ?? {
      requestId: input.requestId,
      taskId: null,
      cancelled: false,
      abortController: new AbortController(),
      clientRequestId: null,
      remoteRequestInFlight: false,
      remoteCancelStatus: null,
      remoteCancelAttempted: false,
      remoteCancelFailed: false,
      cancelPromise: null,
      sequence: 0,
      totalDeltaCharacters: 0,
      streamingStarted: false,
      model,
      sender: event.sender,
      conversationId: input.conversationId,
      eventDeliveryStopped: false,
      // Only tokens this process staged itself are accepted; a renderer cannot
      // name a file the vault never validated.
      attachmentFileTokens: requestedAttachmentTokens.map((token) => stagedAttachmentByToken.get(token)!.token)
    }
    activeTurns.set(input.conversationId, state)
    const promise = (async () => {
      if (input.branchFrom) {
        const target = deps.repository.getAiConversation(input.conversationId)
        if (target) {
          throw new AgentExecutionError('AGENT_BRANCH_TARGET_EXISTS', '编辑分支的目标会话已存在，请重试。')
        }
        const source = deps.repository.getAiConversation(input.branchFrom.conversationId)
        if (!source || source.context.assistant !== 'sales-agent') {
          throw new AgentExecutionError('AGENT_BRANCH_SOURCE_NOT_FOUND', '原会话已不存在，无法创建编辑分支。')
        }
        if (source.revision !== input.branchFrom.expectedRevision) {
          throw new AgentExecutionError('CONVERSATION_REVISION_CONFLICT', '原会话已更新，请重新打开后再编辑。')
        }
        const branchIndex = source.messages.findIndex((message) =>
          message.id === input.branchFrom!.messageId && message.role === 'user'
        )
        if (branchIndex < 0) {
          throw new AgentExecutionError('AGENT_BRANCH_MESSAGE_NOT_FOUND', '要编辑的原始输入已不存在，请重新打开会话。')
        }
        const prefixMessages = source.messages.slice(0, branchIndex)
        const sourceImports = deps.listConversationImports?.(source.id) ?? []
        const prefixImports = prefixMessages
          .flatMap((message) => message.blocks ?? [])
          .filter((block) => block.type === 'resume-import')
          .flatMap((block) => block.type === 'resume-import' ? block.imported : [])
        const prefixImportIds = new Set(prefixImports.map((item) => item.documentId))
        const inheritedFirstOrdinal = prefixImports.reduce((maximum, item) => Math.max(maximum, item.ordinal), 0) + 1
        const inheritedImports = sourceImports.filter((item) => !prefixImportIds.has(item.sourceDocumentId))
        const prefixDraftIds = new Set(prefixMessages
          .flatMap((message) => message.blocks ?? [])
          .filter((block) => block.type === 'candidate-draft-facts')
          .map((block) => block.type === 'candidate-draft-facts' ? block.facts.documentId : ''))
        const sourceDraftFacts = source.messages
          .flatMap((message) => message.blocks ?? [])
          .filter((block) => block.type === 'candidate-draft-facts')
          .map((block) => block.type === 'candidate-draft-facts' ? block.facts : null)
          .filter((facts): facts is AgentCandidateDraftFacts => Boolean(facts))
        const inheritedDraftFacts = sourceDraftFacts.filter((facts) =>
          sourceImports.some((item) => item.sourceDocumentId === facts.documentId) &&
          !prefixDraftIds.has(facts.documentId)
        )
        const inheritedImportMessage: AiConversationMessage | null = inheritedImports.length > 0 || inheritedDraftFacts.length > 0
          ? {
              id: randomUUID(),
              role: 'assistant',
              content: deps.locale() === 'zh-CN'
                ? `已继承原会话中导入的 ${sourceImports.length} 份简历及其本地抽取内容。`
                : `元の会話で取り込んだ${sourceImports.length}件の履歴書とローカル抽出内容を引き継ぎました。`,
              mode: 'local',
              narrativeStatus: 'local',
              turnId: null,
              blocks: [
                ...(inheritedImports.length > 0 ? [{
                  type: 'resume-import' as const,
                  imported: inheritedImports.map((item, index) => ({
                    documentId: item.sourceDocumentId,
                    label: item.anonymousLabel,
                    ordinal: inheritedFirstOrdinal + index
                  })),
                  failedCount: 0
                }] : []),
                ...inheritedDraftFacts.map((facts) => ({ type: 'candidate-draft-facts' as const, facts })),
                { type: 'system-access' as const, destination: 'review-center' as const }
              ],
              createdAt: new Date().toISOString()
            }
          : null
        const branchMessages = inheritedImportMessage
          ? [...prefixMessages, inheritedImportMessage]
          : prefixMessages
        const salesAgentState = branchedSalesAgentState(prefixMessages)
        const seeded = branchMessages.length > 0
          ? deps.repository.saveAiConversation({
              conversationId: input.conversationId,
              branchRootConversationId: source.branchRootConversationId ?? source.id,
              context: source.context,
              messages: branchMessages,
              salesAgentState,
              expectedRevision: null
            })
          : null
        for (const imported of sourceImports) {
          deps.registerConversationImport?.(input.conversationId, imported.sourceDocumentId)
        }
        input = {
          ...input,
          expectedConversationRevision: seeded?.revision ?? null,
          selectedJobCaseRef: salesAgentState.selectedJobCaseRef,
          attachmentFileTokens: []
        }
      }
      if (!deps.narrativeStreamer) {
        const message = 'Cloud AI 当前不可用，无法理解自然语言或选择 Tool。'
        emit(state, {
          type: 'failed', code: 'AGENT_CLOUD_UNAVAILABLE',
          message, localFallbackPreserved: true
        })
        return useCase.saveDirectAnswer(input, message, undefined, 'failed')
      }
      const turnAttachmentDrafts = () => state.attachmentFileTokens
        .map((token) => deps.previewedDrafts?.get(token))
        .filter((draft): draft is AgentCandidateDraftFacts => Boolean(draft))
      const planningConversation = useCase.loadPlanningConversation(input)
      const activeWorkspaceEvidence = buildActiveWorkspaceEvidence(input.activeSystemAccess, deps)
      const emitDelta = (delta: string) => {
        if (state.cancelled) return
        if (!state.streamingStarted) {
          state.streamingStarted = true
          emit(state, { type: 'started', phase: 'streaming' })
        }
        for (let offset = 0; offset < delta.length; offset += 2_000) {
          const text = delta.slice(offset, offset + 2_000)
          if (state.totalDeltaCharacters + text.length > 20_000) {
            throw new AgentExecutionError('AGENT_STREAM_LIMIT_EXCEEDED', '流式回答超过本地显示上限。')
          }
          state.totalDeltaCharacters += text.length
          emit(state, { type: 'delta', text })
        }
      }

      emit(state, { type: 'started', phase: 'planning' })
      let plan: Awaited<ReturnType<AgentNarrativeStreamer['plan']>>
      try {
        plan = await deps.narrativeStreamer.plan({
          conversationId: input.conversationId,
          requestId: input.requestId,
          locale: deps.locale(),
          userMessage: input.message,
          conversation: planningConversation,
          selectedJobCaseRef: input.selectedJobCaseRef ?? null,
          activeWorkspaceEvidence,
          attachmentCount: state.attachmentFileTokens.length,
          conversationImportCount: (deps.listConversationImports?.(input.conversationId) ?? []).length,
          schedulableCandidateCount: (deps.listSchedulableCandidates?.() ?? []).length,
          attachmentDrafts: turnAttachmentDrafts(),
          model,
          signal: state.abortController.signal,
          onClientRequestId: (clientRequestId) => markRemoteRequestStarted(state, clientRequestId),
          onRemoteSettled: () => markRemoteRequestSettled(state)
        })
      } catch (error) {
        if (state.cancelled || (error instanceof AgentExecutionError && error.code === 'TURN_CANCELLED')) {
          const cancelStatus = await requestRemoteCancel(state)
          const message = remoteCancelMessage(state, cancelStatus)
          emit(state, { type: 'cancelled', cancelStatus, message })
          return useCase.saveDirectAnswer(input, '当前案件 Agent 操作已取消。', undefined, 'cancelled')
        }
        state.abortController.abort()
        const cleanupCancelStatus = state.remoteRequestInFlight ? await requestRemoteCancel(state) : null
        const failureLifecycleMessage = state.clientRequestId && !state.remoteRequestInFlight
          ? '远端规划响应已经结束，但最终内容不符合受控规划协议；未发送多余取消请求。'
          : state.clientRequestId
            ? remoteCancelMessage(state, cleanupCancelStatus)
            : '失败发生在取得远端请求标识之前。'
        // Say which part of the protocol the plan broke. "Could not form a plan"
        // is unactionable for the operator and hid four different causes during
        // development.
        const planningReason = error instanceof Error && error.message ? error.message : null
        emit(state, {
          type: 'failed', code: 'AGENT_PLANNING_FAILED',
          message: `AI 无法形成有效的受控 Tool 计划。${planningReason ? `${planningReason} ` : ''}${failureLifecycleMessage}`,
          localFallbackPreserved: true
        })
        return useCase.saveDirectAnswer(
          input,
          planningReason
            ? `AI 无法形成有效的受控 Tool 计划：${planningReason}`
            : 'AI 无法形成有效的受控 Tool 计划，请重试。',
          undefined,
          'failed'
        )
      }

      if (state.cancelled) {
        const cancelStatus = await requestRemoteCancel(state)
        const message = remoteCancelMessage(state, cancelStatus)
        emit(state, { type: 'cancelled', cancelStatus, message })
        return useCase.saveDirectAnswer(input, '当前案件 Agent 操作已取消。', undefined, 'cancelled')
      }
      if (plan.kind === 'answer') {
        state.streamingStarted = false
        state.totalDeltaCharacters = 0
        emit(state, { type: 'started', phase: 'connecting-model' })
        try {
          const streamed = await deps.narrativeStreamer.streamAnswer({
            conversationId: input.conversationId,
            requestId: input.requestId,
            locale: deps.locale(),
            userMessage: input.message,
            conversation: planningConversation,
            selectedJobCaseRef: input.selectedJobCaseRef ?? null,
            activeWorkspaceEvidence,
            attachmentDrafts: turnAttachmentDrafts(),
            model,
            signal: state.abortController.signal,
            onClientRequestId: (clientRequestId) => markRemoteRequestStarted(state, clientRequestId),
            onRemoteSettled: () => markRemoteRequestSettled(state),
            onDelta: emitDelta
          })
          if (state.cancelled) {
            const cancelStatus = await requestRemoteCancel(state)
            emit(state, { type: 'cancelled', cancelStatus, message: remoteCancelMessage(state, cancelStatus) })
            return useCase.saveDirectAnswer(input, '当前案件 Agent 操作已取消。', undefined, 'cancelled')
          }
          const direct = useCase.saveDirectAnswer(
            input,
            streamed.content,
            { key: model.key, displayName: model.displayName }
          )
          emit(state, { type: 'completed' })
          return direct
        } catch (error) {
          if (state.cancelled || (error instanceof AgentExecutionError && error.code === 'TURN_CANCELLED')) {
            const cancelStatus = await requestRemoteCancel(state)
            emit(state, { type: 'cancelled', cancelStatus, message: remoteCancelMessage(state, cancelStatus) })
            return useCase.saveDirectAnswer(input, '当前案件 Agent 操作已取消。', undefined, 'cancelled')
          }
          state.abortController.abort()
          const cleanupCancelStatus = state.remoteRequestInFlight ? await requestRemoteCancel(state) : null
          emit(state, {
            type: 'failed', code: 'AGENT_CLOUD_NARRATIVE_FAILED',
            message: `AI 流式回答失败。${state.clientRequestId
              ? remoteCancelMessage(state, cleanupCancelStatus)
              : '失败发生在取得远端请求标识之前。'}`,
            localFallbackPreserved: true
          })
          return useCase.saveDirectAnswer(input, 'AI 回答生成失败，请重试。', undefined, 'failed')
        }
      }

      state.streamingStarted = false
      state.totalDeltaCharacters = 0
      emit(state, { type: 'started', phase: 'local-tool' })
      const result = await useCase.execute(input, plan.action)
      if (result.actionRunId) {
        const turnId = result.assistantMessage.turnId
        if (!turnId) throw new Error('Agent ActionRun の turn_id を会話履歴から確認できません。')
        deps.repository.linkActionRunToConversation(result.actionRunId, input.conversationId, turnId)
      }
      if (result.status !== 'completed' || result.toolName === null) {
        if (result.status === 'cancelled') {
          emit(state, { type: 'cancelled', cancelStatus: state.remoteCancelStatus, message: remoteCancelMessage(state, state.remoteCancelStatus) })
        } else if (result.status === 'failed') {
          emit(state, { type: 'failed', code: 'AGENT_LOCAL_TOOL_FAILED', message: '本地 Tool 执行失败。', localFallbackPreserved: true })
        } else {
          emit(state, { type: 'completed' })
        }
        return result
      }

      // These write Tools already persist a complete, localized, authoritative
      // result with structured system-access cards. A second Cloud narrative
      // request cannot improve the business outcome, but can incorrectly turn a
      // successful local mutation into a failed-looking conversation and add an
      // avoidable billed request. Read and matching Tools may still use Cloud
      // narrative because summarization is part of their value.
      if (
        result.toolName === 'candidate.interview.schedule.local' ||
        result.toolName === 'resume.analyze.local'
      ) {
        emit(state, { type: 'completed' })
        return result
      }

      emit(state, { type: 'started', phase: 'connecting-model' })
      try {
        const streamed = await deps.narrativeStreamer.stream({
          conversationId: input.conversationId,
          requestId: input.requestId,
          locale: deps.locale(),
          toolName: result.toolName,
          userMessage: input.message,
          assistantMessage: result.assistantMessage,
          model,
          signal: state.abortController.signal,
          onClientRequestId: (clientRequestId) => markRemoteRequestStarted(state, clientRequestId),
          onRemoteSettled: () => markRemoteRequestSettled(state),
          onDelta: emitDelta
        })
        if (state.cancelled) {
          const cancelStatus = await requestRemoteCancel(state)
          const cancelled = localFallbackResult(result, model, 'cancelled', 'cancelled')
          emit(state, { type: 'cancelled', cancelStatus, message: remoteCancelMessage(state, cancelStatus) })
          return cancelled
        }
        const saved = saveNarrativeState(result, {
          content: streamed.content,
          mode: 'cloud',
          modelKey: model.key,
          modelDisplayName: model.displayName,
          narrativeStatus: 'completed'
        })
        emit(state, { type: 'completed' })
        return { ...result, status: 'completed' as const, ...saved }
      } catch (error) {
        if (state.cancelled || (error instanceof AgentExecutionError && error.code === 'TURN_CANCELLED')) {
          const cancelStatus = await requestRemoteCancel(state)
          const cancelled = localFallbackResult(result, model, 'cancelled', 'cancelled')
          emit(state, { type: 'cancelled', cancelStatus, message: remoteCancelMessage(state, cancelStatus) })
          return cancelled
        }
        const privacyBlocked = error instanceof Error && /privacy|プライバシー|DLP|脱敏/u.test(error.message)
        state.abortController.abort()
        const cleanupCancelStatus = state.remoteRequestInFlight ? await requestRemoteCancel(state) : null
        const fallback = localFallbackResult(result, model, 'failed-local-fallback', 'failed')
        emit(state, {
          type: 'failed',
          code: privacyBlocked ? 'AGENT_CLOUD_PRIVACY_BLOCKED' : 'AGENT_CLOUD_NARRATIVE_FAILED',
          message: `${privacyBlocked
            ? 'Cloud 隐私门未通过；已阻止发送并保留本地 Tool 的权威结果。'
            : 'AI 流式整理失败；已保留本地 Tool 的权威结果。'}${state.clientRequestId
            ? remoteCancelMessage(state, cleanupCancelStatus)
            : privacyBlocked ? '' : '失败发生在取得远端请求标识之前。'}`,
          localFallbackPreserved: true
        })
        return fallback
      }
    })()
    const record = { conversationId: input.conversationId, fingerprint, promise }
    inFlightRequests.set(input.requestId, record)
    void promise.then(() => {
      if (activeTurns.get(input.conversationId) === state) activeTurns.delete(input.conversationId)
      rememberCompletedRequest(input.requestId, record)
    }, () => {
      if (activeTurns.get(input.conversationId) === state) activeTurns.delete(input.conversationId)
      rememberCompletedRequest(input.requestId, record)
    })
    return promise
  }

  const handleCancel = async (event: IpcMainInvokeEvent, rawInput: unknown): Promise<CancelAgentTurnResult> => {
    deps.assertTrustedSender(event)
    const input = cancelAgentTurnInputSchema.parse(rawInput)
    const active = activeTurns.get(input.conversationId)
    if (!active || active.requestId !== input.requestId) {
      const completed = requestResults.get(input.requestId)
      return {
        status: completed?.conversationId === input.conversationId ? 'already-completed' : 'not-running',
        conversationId: input.conversationId,
        requestId: input.requestId
      }
    }
    active.cancelled = true
    active.abortController.abort()
    if (active.taskId) deps.cancelMatchTask(active.taskId)
    emit(active, { type: 'started', phase: 'stopping' })
    const remoteCancelStatus = await requestRemoteCancel(active)
    return {
      status: 'cancelled', conversationId: input.conversationId, requestId: input.requestId,
      remoteCancelStatus,
      message: remoteCancelMessage(active, remoteCancelStatus)
    }
  }

  ipcMain.handle(ipcChannels.executeAgentTurn, handleExecute)
  ipcMain.handle(ipcChannels.cancelAgentTurn, handleCancel)
  return () => {
    if (disposed) return
    disposed = true
    for (const active of activeTurns.values()) {
      active.abortController.abort()
      if (active.remoteRequestInFlight) void requestRemoteCancel(active)
    }
    ipcMain.removeHandler(ipcChannels.executeAgentTurn)
    ipcMain.removeHandler(ipcChannels.cancelAgentTurn)
    activeTurns.clear()
    inFlightRequests.clear()
    requestResults.clear()
  }
}
