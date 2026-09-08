import { createHash, randomUUID } from 'node:crypto'
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  AgentExecutionError,
  isCandidateCaseRequest,
  isSpecificCandidateFitRequest,
  loadAgentChatModelCatalog,
  LocalAgentUseCase,
  resolveAgentChatModel,
  routeBusinessText,
  type AgentChatModelDefinition,
  type AgentCandidateMatchRecord,
  type AgentJobCaseRecord,
  type AgentResumeImportOutput,
  type AgentToolExecutionMetadata,
  type BusinessTextRouteDecision,
  type LocalAgentPort
} from '@agent'
import { candidateBenchmarkQueryFromJobCase } from '@job-cases'
import type { JobCaseFieldAliasMap } from '@shared/contracts'
import { candidateSearchTerms, scorableCandidateSearchTerms, searchConfirmedCandidateProfiles } from '@resume'
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
import { isUnassessableMatchCard } from '@shared'
import type { AgentCandidateDraftFacts, AgentCloudReviewOutcome, AgentCloudReviewSkipCode, AgentJobCaseBroadcastCard, AgentTurnTimings, CandidateMatchAssessment } from '@shared'
import { deriveNewCaseDigest } from './job-case-digest'
import { matchAssessmentShortlistSize, type AgentActiveWorkspaceEvidence, type AgentNarrativeStreamer } from './agent-cloud-narrative'
import { deriveBroadcastQueue } from './broadcast-workspace'
import {
  activeCaseTitle,
  draftCaseBroadcastForReview,
  requireSendableReview,
  resolveBroadcastTemplate
} from './broadcast-service'
import type { BusinessTextIntakeTurnHooks } from './business-text-intake'

interface AgentMatchTaskResult extends CandidateMatchTaskExecutionResult {
  actionRunId?: string | null
}

/** The job-case fields the cloud review judges against; commercial chain and payment terms say nothing about fit. */
const cloudMatchAssessmentRequirementKeys = new Set([
  'title', 'role', 'industry', 'required_skills', 'preferred_skills', 'rate', 'location', 'remote',
  'start_date', 'working_hours', 'japanese_level', 'headcount', 'work_authorization', 'notes'
])

export interface AgentIpcDependencies {
  repository: EncryptedApplicationRepository
  actionOrchestrator: ActionOrchestrator
  assertTrustedSender(event: IpcMainInvokeEvent): void
  conversationalMatchingEnabled(): boolean
  locale(): ApplicationLocale
  currentOperator(): { operatorId: string; displayName: string }
  currentMatchRuntimeIdentity: MatchRuntimeIdentity
  createMatchTask(jobCaseId: string, jobCaseVersion: number, candidateDocumentId?: string): { taskId: string }
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
  /** 今日新着案件 counts, from the same digest the home card and the rail badge read. */
  newCaseDigestCounts?(): { newCasesToday: number; unseenCaseCount: number }
  /** Records an import against the conversation it happened in. */
  registerConversationImport?(conversationId: string, sourceDocumentId: string): void
  /** Operator aliases for job-case field labels; the local router honours them. */
  jobCaseFieldAliases?(): JobCaseFieldAliasMap
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
  /**
   * The local business-text intake executor. When present, the gate classifies
   * every message BEFORE any cloud call and hands non-'not-intake' routes to
   * this executor, which owns its whole error path - nothing may fall through
   * to the planner flow, whose failure handlers persist the raw user message.
   * Absent = the intake feature is switched off and every turn behaves as
   * before the gate existed.
   */
  executeBusinessTextIntake?(
    useCase: LocalAgentUseCase,
    input: ReturnType<typeof executeAgentTurnInputSchema.parse>,
    decision: BusinessTextRouteDecision,
    turn: BusinessTextIntakeTurnHooks
  ): Promise<ExecuteAgentTurnResult>
}

/** Wall-clock marks of one turn; durations only, never content. */
interface ActiveTurnTimings {
  startedAt: number
  planningMs: number | null
  localToolMs: number | null
  cloudReviewMs: number | null
  narrativeStartedAt: number | null
  narrativeFirstTokenMs: number | null
  narrativeMs: number | null
  cloudCalls: number
}

function newTurnTimings(): ActiveTurnTimings {
  return {
    startedAt: performance.now(), planningMs: null, localToolMs: null, cloudReviewMs: null,
    narrativeStartedAt: null, narrativeFirstTokenMs: null, narrativeMs: null, cloudCalls: 0
  }
}

function turnTimings(state: ActiveAgentTurn): AgentTurnTimings {
  const timings: AgentTurnTimings = {
    totalMs: Math.round(performance.now() - state.timings.startedAt),
    planningMs: state.timings.planningMs,
    localToolMs: state.timings.localToolMs,
    cloudReviewMs: state.timings.cloudReviewMs,
    narrativeFirstTokenMs: state.timings.narrativeFirstTokenMs,
    narrativeMs: state.timings.narrativeMs,
    cloudCalls: state.timings.cloudCalls
  }
  console.info('[agent-turn-timing]', { requestId: state.requestId, model: state.model.key, ...timings })
  return timings
}

interface ActiveAgentTurn {
  requestId: string
  taskId: string | null
  timings: ActiveTurnTimings
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

/** Keeps a drafted message inside what the conversation block schema accepts. */
function boundedBroadcastText(value: string, maximum: number): string {
  const trimmed = value.trim()
  return trimmed.length <= maximum ? trimmed : `${trimmed.slice(0, Math.max(1, maximum - 1))}…`
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

  const jobCaseReviewProjection = (reviewId: string): Record<string, unknown> => {
    const review = deps.repository.listJobCaseReviews().find((item) => item.reviewId === reviewId)
    return review ? {
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

  if (access.destination === 'case-review') {
    return { destination: access.destination, data: jobCaseReviewProjection(access.reviewId) }
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

  if (access.destination === 'new-cases') {
    // The morning board: today's arrivals, the same derivation the card uses.
    const digest = deriveNewCaseDigest({
      reviews: deps.repository.listJobCaseReviews(),
      seenReviewIds: deps.repository.listSeenJobCaseReviewIds(),
      now: new Date()
    })
    return {
      destination: access.destination,
      data: {
        newCasesToday: digest.newCasesToday,
        unseenCount: digest.unseenCount,
        cases: digest.groups.flatMap((group) => group.entries.map((entry) => ({
          day: group.day,
          title: boundedWorkspaceText(entry.title, 240),
          status: entry.status,
          unseen: entry.unseen,
          highlights: entry.highlights.map((highlight) => ({
            key: highlight.key,
            value: boundedWorkspaceText(highlight.value, 200)
          }))
        }))).slice(0, 12)
      }
    }
  }

  if (access.destination === 'broadcast') {
    // Counts only. What a broadcast says is written on this device and never
    // becomes part of a cloud narrative projection. Where a copied message was
    // pasted is not recorded at all, so no count can imply it.
    const queue = deriveBroadcastQueue({
      reviews: deps.repository.listJobCaseReviews(),
      ledger: deps.repository.listAllCaseBroadcasts(),
      copies: deps.repository.listAllCaseBroadcastCopies()
    })
    return {
      destination: access.destination,
      data: {
        newCount: queue.filter((item) => item.status === 'new').length,
        copiedCount: queue.filter((item) => item.status === 'copied').length,
        attentionCount: queue.filter((item) => item.status === 'attention').length,
        updatableCount: queue.filter((item) => item.hasUpdateSinceLastCopy).length,
        // The queue opened focused on one case: that case is 「当前案件」 for the
        // conversation beside it - the same redacted fields case-review projects.
        ...(access.reviewId ? { focusedCase: jobCaseReviewProjection(access.reviewId) } : {})
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
    intakeOnly: input.intakeOnly ?? false,
    expectedConversationRevision: input.expectedConversationRevision,
    modelKey: input.modelKey,
    selectedCandidateDocumentId: input.selectedCandidateDocumentId,
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
  let lastIntakeBatch = null as AiConversationSalesAgentState['lastIntakeBatch']
  for (const message of messages) for (const block of message.blocks ?? []) {
    if (block.type === 'job-case-cards') {
      lastSearchMessageId = message.id
      // A one-card detail answer carries an unambiguous case selection. Search
      // result lists do not reveal which card the operator selected afterwards.
      selectedJobCaseRef = block.cards.length === 1 ? block.cards[0]!.reference : null
    }
    if (block.type === 'candidate-match-cards') lastMatchRunId = block.runId
    if (block.type === 'match-run-explanation') lastMatchRunId = block.facts.runId
    // The first card block of a batch is the paste itself; later blocks of the
    // same batch are partial reads and must not narrow the pointer.
    if (block.type === 'job-case-draft-cards' && lastIntakeBatch?.intakeBatchId !== block.intakeBatchId) {
      lastIntakeBatch = {
        intakeBatchId: block.intakeBatchId,
        messageId: message.id,
        reviewIds: block.cards.filter((card) => card.status !== 'deleted').map((card) => card.reviewId)
      }
    }
  }
  return { selectedJobCaseRef, lastMatchRunId, lastSearchMessageId, lastIntakeBatch }
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

  /**
   * The cloud second opinion on the shortlist. The local run has already
   * decided who is shortlisted and how they rank; this reading is attached
   * next to the local fit and never changes either. Without cloud access, or
   * when the model fails, the cards go out without it.
   */
  const attachCloudMatchAssessments = async (
    input: { jobCaseId: string; jobCaseVersion: number },
    execution: AgentMatchTaskResult,
    cards: AgentCandidateMatchRecord[],
    active: ActiveAgentTurn | undefined,
    metadata: AgentToolExecutionMetadata
  ): Promise<AgentCloudReviewOutcome> => {
    const skipped = (code: AgentCloudReviewSkipCode, reason: string | null = null): AgentCloudReviewOutcome => {
      // Ids and codes only, never the projected text.
      console.warn('[candidate-match-assessment-skipped]', { runId: execution.run.id, code, reason })
      return { status: 'skipped', code, reason }
    }
    const assess = deps.narrativeStreamer?.assessMatchCandidates?.bind(deps.narrativeStreamer)
    if (!assess || !active || active.requestId !== metadata.requestId) return skipped('cloud-unavailable')
    if (cards.length === 0) return skipped('no-candidates')
    const turn = active
    const jobCase = deps.repository.listActiveJobCases()
      .find((item) => item.id === input.jobCaseId && item.version === input.jobCaseVersion)
    if (!jobCase) return skipped('no-job-case')
    // A row that matched nothing locally has nothing for a reviewer to weigh;
    // reviewing it would only produce the list of everything it lacks.
    const shortlist = cards.filter((card) => !isUnassessableMatchCard(card))
      .toSorted((left, right) => left.rank - right.rank)
      .slice(0, matchAssessmentShortlistSize)
    if (shortlist.length === 0) return skipped('nothing-matched')
    const candidates = shortlist.flatMap((card) => {
      const match = execution.matches.find((item) => item.matchResultId === card.resultId)
      if (!match) return []
      return [{
        label: `CANDIDATE_${card.rank}`,
        hardFilters: match.retrieval.hardFilters.map((filter) => ({
          requirement: filter.requested, actual: filter.actual, outcome: filter.outcome
        })),
        facts: match.fields.flatMap((field) => field.value ? [{ label: field.label, value: field.value }] : []),
        projects: match.projectExperiences.map((project) => ({
          title: project.title, period: project.period, role: project.role, technologies: project.technologies, summary: project.summary
        }))
      }]
    })
    if (candidates.length === 0) return skipped('no-candidates')
    const reviewStartedAt = performance.now()
    turn.timings.cloudCalls += 1
    try {
      const assessed = await assess({
        conversationId: metadata.conversationId,
        requestId: metadata.requestId,
        locale: deps.locale(),
        jobCase: {
          title: jobCase.fields.find((field) => field.key === 'title')?.value ?? null,
          requirements: jobCase.fields.flatMap((field) =>
            field.value && cloudMatchAssessmentRequirementKeys.has(field.key)
              ? [{ key: field.key, label: field.label, value: field.value }]
              : [])
        },
        candidates,
        model: turn.model,
        signal: turn.abortController.signal,
        onClientRequestId: (clientRequestId) => markRemoteRequestStarted(turn, clientRequestId),
        onRemoteSettled: () => markRemoteRequestSettled(turn)
      })
      const assessedAt = new Date().toISOString()
      const entries: Array<{ matchResultId: string; assessment: CandidateMatchAssessment }> = []
      for (const verdict of assessed.assessments) {
        const card = shortlist.find((item) => `CANDIDATE_${item.rank}` === verdict.candidate)
        if (!card) continue
        const assessment: CandidateMatchAssessment = {
          version: 'match-assessment-v1',
          fit: card.hardFilterStatus === 'failed' ? 'weak' : verdict.fit,
          met: verdict.met,
          gaps: verdict.gaps,
          confirm: verdict.confirm,
          reason: verdict.reason,
          modelKey: turn.model.key,
          assessedAt
        }
        card.assessment = assessment
        entries.push({ matchResultId: card.resultId, assessment })
      }
      if (entries.length === 0) return skipped('no-verdict')
      deps.repository.saveCandidateMatchAssessments(execution.run.id, entries)
      return { status: 'reviewed', reviewedCount: entries.length }
    } catch (error) {
      if (turn.cancelled) throw new AgentExecutionError('TURN_CANCELLED', '当前案件匹配操作已取消。')
      // Advice on top of a finished local run: losing it must not lose the run.
      return skipped('cloud-error', (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 300))
    } finally {
      turn.timings.cloudReviewMs = Math.round(performance.now() - reviewStartedAt)
    }
  }

  /** The 配信 queue, derived the same way the 案件配信 screen derives it. */
  const broadcastQueue = () => deriveBroadcastQueue({
    reviews: deps.repository.listJobCaseReviews(),
    ledger: deps.repository.listAllCaseBroadcasts(),
    copies: deps.repository.listAllCaseBroadcastCopies()
  })

  const port: LocalAgentPort = {
    listActiveJobCases: () => deps.repository.listActiveJobCases().map(safeJobCaseRecord),
    workspaceJobCase: (access) => {
      if (!access) return null
      const activeById = (jobCaseId: string) =>
        deps.repository.listActiveJobCases().find((record) => record.id === jobCaseId) ?? null
      if (access.destination === 'case-review' || access.destination === 'broadcast') {
        if (!access.reviewId) return null
        const linkedCaseId = deps.repository.getJobCaseReview(access.reviewId)?.jobCase?.id
        const record = linkedCaseId ? activeById(linkedCaseId) : null
        return record ? safeJobCaseRecord(record) : null
      }
      if (access.destination === 'matching' && access.jobCaseId) {
        const record = activeById(access.jobCaseId)
        return record ? safeJobCaseRecord(record) : null
      }
      return null
    },
    listBroadcastQueue: () => broadcastQueue().map((item) => ({
      reviewId: item.reviewId,
      jobCaseId: item.jobCaseId,
      title: item.title,
      status: item.status,
      hasUpdateSinceLastCopy: item.hasUpdateSinceLastCopy
    })),
    describeJobCaseMatchability: (jobCaseId, jobCaseVersion) => {
      const jobCase = deps.repository.listActiveJobCases()
        .find((item) => item.id === jobCaseId && (jobCaseVersion === null || item.version === jobCaseVersion))
      if (!jobCase) return null
      // The same query the match task builds, so the check and the run agree.
      const query = candidateBenchmarkQueryFromJobCase(jobCase)
      const scorable = scorableCandidateSearchTerms(query)
      return {
        scorableTermCount: scorable.length,
        hardFilterTermCount: candidateSearchTerms(query).length - scorable.length,
        reviewId: jobCase.sourceReviewId ?? null
      }
    },
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
        : toolName === 'job-case.draft.read.local' ? 'conversation-intake-drafts'
        : toolName === 'job-case.broadcast.draft.local' ? 'broadcast-queue'
          : 'confirmed-candidate-pool'
      const scopeFingerprint = hashActionInput(rawInput)
      const actorId = deps.currentOperator().operatorId
      const existingConversation = deps.repository.getAiConversation(metadata.conversationId)
      const persistedConversationId = existingConversation?.context.assistant === 'sales-agent'
        ? metadata.conversationId
        : null
      const context = actionContext(metadata, scopeId, scopeFingerprint, actorId, persistedConversationId)
      if (toolName === 'candidate.match.local') {
        const input = rawInput as { jobCaseId: string; jobCaseVersion: number; candidateDocumentId?: string }
        const task = deps.createMatchTask(input.jobCaseId, input.jobCaseVersion, input.candidateDocumentId)
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
        if (input.candidateDocumentId && execution.matches.some((match) => match.sourceDocumentId !== input.candidateDocumentId)) {
          throw new AgentExecutionError('AGENT_TOOL_FAILED', '匹配结果超出所选人员范围，请重新评估。')
        }
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
          hardFilterStatus: match.retrieval.hardFilters.length === 0
            ? 'none'
            : match.retrieval.hardFilters.some((filter) => filter.outcome === 'failed')
              ? 'failed'
              : match.retrieval.hardFilters.some((filter) => filter.outcome === 'unknown') ? 'unknown' : 'passed',
          projectEvidence: match.projectEvidence?.summary ?? null,
          status: 'current'
        }))
        const cloudReview = await attachCloudMatchAssessments(input, execution, cards, active, metadata)
        return {
          toolName,
          output: { runId: execution.run.id, resultHash: execution.run.resultSetHash, cards, cloudReview },
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

      if (toolName === 'job-case.draft.read.local') {
        const input = rawInput as { reviewIds: string[]; labels: string[] }
        const preflight = deps.actionOrchestrator.preflight(
          toolName, context, { reviewIds: input.reviewIds },
          '取込済み案件の未確認下書きを端末内で読み取ります。',
          actionIdempotencyKey(toolName, metadata.conversationId, metadata.requestId)
        )
        if (preflight.decision.outcome === 'deny') throw new Error(preflight.decision.reason)
        if (preflight.decision.outcome === 'require-approval') {
          throw new Error('この操作はレビューセンターでの承認待ちです。')
        }
        deps.repository.updateActionRun(preflight.actionRunId, 'running')
        const facts = input.reviewIds.map((reviewId, index) => {
          const label = input.labels[index] ?? `DRAFT_${index + 1}`
          // A deleted draft keeps its slot as a tombstone so the other
          // ordinals still mean what they meant in the paste.
          return deps.repository.getAgentJobCaseDraftFacts(reviewId, label) ?? {
            reviewId, label, title: null, reviewStatus: 'awaiting-review' as const, lifecycle: 'active' as const,
            jobCase: null, fields: [], warningCodes: [], status: 'deleted' as const
          }
        })
        if (facts.every((item) => item.status === 'deleted')) {
          deps.repository.updateActionRun(preflight.actionRunId, 'failed', { errorCode: 'DRAFT_NOT_FOUND' })
          throw new AgentExecutionError('AGENT_DRAFT_NOT_FOUND', '取込済みの案件下書きが見つかりません。')
        }
        const output = { facts }
        deps.repository.updateActionRun(preflight.actionRunId, 'succeeded', { resultHash: hashActionInput(output) })
        return { toolName, output, actionRunId: preflight.actionRunId }
      }

      if (toolName === 'job-case.broadcast.draft.local') {
        const input = rawInput as { reviewIds: string[] }
        const preflight = deps.actionOrchestrator.preflight(
          toolName, context, { reviewIds: input.reviewIds },
          '確定済み案件の紹介文を端末内で作成します。',
          actionIdempotencyKey(toolName, metadata.conversationId, metadata.requestId)
        )
        if (preflight.decision.outcome === 'deny') throw new Error(preflight.decision.reason)
        if (preflight.decision.outcome === 'require-approval') {
          throw new Error('この操作はレビューセンターでの承認待ちです。')
        }
        deps.repository.updateActionRun(preflight.actionRunId, 'running')
        const queue = broadcastQueue()
        const template = resolveBroadcastTemplate(deps.repository)
        const cards: AgentJobCaseBroadcastCard[] = []
        for (const reviewId of input.reviewIds) {
          const item = queue.find((entry) => entry.reviewId === reviewId)
          // A case that stopped being sendable between the queue read and here
          // is skipped rather than failing the whole turn.
          let review: ReturnType<typeof requireSendableReview>
          try {
            review = requireSendableReview(deps.repository, reviewId)
          } catch {
            continue
          }
          const drafted = draftCaseBroadcastForReview(review, template)
          cards.push({
            reviewId,
            jobCaseId: review.jobCase.id,
            jobCaseVersion: review.jobCase.version,
            ordinal: cards.length + 1,
            title: boundedBroadcastText(activeCaseTitle(review), 200) || `案件 ${review.jobCase.id.slice(0, 8)}`,
            status: item?.status ?? 'new',
            templateId: template.id,
            templateRevision: template.revision,
            textJa: boundedBroadcastText(drafted.textJa, 2_000),
            textZh: boundedBroadcastText(drafted.textZh, 2_000),
            forbiddenJa: drafted.forbiddenJa.slice(0, 20),
            forbiddenZh: drafted.forbiddenZh.slice(0, 20)
          })
        }
        if (cards.length === 0) {
          deps.repository.updateActionRun(preflight.actionRunId, 'failed', { errorCode: 'BROADCAST_CASE_NOT_SENDABLE' })
          throw new AgentExecutionError('AGENT_BROADCAST_CASE_NOT_SENDABLE', '配信できる確定済み案件が見つかりません。')
        }
        const output = { cards }
        // Counts and ids only - the message text never reaches a log line.
        console.info('[agent-case-broadcast-drafted]', { requestId: metadata.requestId, cardCount: cards.length })
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
            candidateDocumentId?: string
            mode: 'recent' | 'by-id'
            caseId?: string | null
            query?: string | null
            updatedAfter?: string | null
            updatedBefore?: string | null
            limit: number
          }
          const profile = input.candidateDocumentId ? deps.repository.listEligibleTalentProfiles().find((item) => item.sourceDocumentId === input.candidateDocumentId) : null
          if (input.candidateDocumentId && !profile) throw new Error('所选人员尚未确认或已停用，请先核对人员资料。')
          const source = deps.repository.listActiveJobCases().map((jobCase) => ({ jobCase,
            match: profile ? searchConfirmedCandidateProfiles([profile], candidateBenchmarkQueryFromJobCase(jobCase), 1)[0] : null
          })).filter((item) => !profile || (item.match && item.match.matchedTerms.length > 0))
            .sort((a, b) => profile ? (b.match?.matchScore ?? 0) - (a.match?.matchScore ?? 0) : 0)
            .map((item) => safeJobCaseRecord(item.jobCase))
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
      timings: newTurnTimings(),
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
      // The local intake gate runs BEFORE any cloud dependency: pasted business
      // text must never enter the planning projection or its DLP gate, and a
      // local import must keep working when the cloud is unavailable.
      if (input.intakeOnly && !deps.executeBusinessTextIntake) {
        throw new Error('业务信息整理服务当前不可用，请稍后重试。')
      }
      if (deps.executeBusinessTextIntake) {
        const intakeDecision = routeBusinessText(input.message, { aliases: deps.jobCaseFieldAliases?.() ?? {} })
        if (input.intakeOnly && intakeDecision.route === 'not-intake') {
          intakeDecision.route = 'ambiguous-sensitive'
          intakeDecision.reason = 'structure-without-type'
        }
        if (intakeDecision.route !== 'not-intake') {
          emit(state, { type: 'started', phase: 'local-tool' })
          const result = await deps.executeBusinessTextIntake(useCase, input, intakeDecision, {
            signal: state.abortController.signal,
            onCloudLaneStarted: () => emit(state, { type: 'started', phase: 'connecting-model' }),
            onClientRequestId: (clientRequestId) => markRemoteRequestStarted(state, clientRequestId),
            onRemoteSettled: () => markRemoteRequestSettled(state)
          })
          // The intake binds its own ActionRuns to the saved turn: a cloud-
          // segmented paste owns one run per record, more than the single
          // actionRunId this result can carry.
          if (result.status === 'failed') {
            emit(state, {
              type: 'failed', code: 'AGENT_INTAKE_FAILED',
              message: '本地业务文本导入失败，原文未写入会话。', localFallbackPreserved: true
            })
          } else {
            emit(state, { type: 'completed' })
          }
          return result
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
      const selectedCandidateDocumentId = input.selectedCandidateDocumentId !== undefined ? input.selectedCandidateDocumentId
        : planningConversation?.salesAgentState?.selectedCandidateDocumentId ?? null
      const pairRequest = isSpecificCandidateFitRequest(input.message)
      const reverseRequest = isCandidateCaseRequest(input.message) && !pairRequest
      if ((pairRequest || reverseRequest) && !selectedCandidateDocumentId) {
        emit(state, { type: 'completed' })
        return useCase.saveDirectAnswer(input, deps.locale() === 'zh-CN'
          ? '请先打开要评估的人员资料，明确当前人员后再匹配案件。当前没有指定人员，无法确定“他”是谁。'
          : '評価対象の人材を先に開いてください。現在、人材が指定されていません。')
      }
      const activeWorkspaceEvidence = buildActiveWorkspaceEvidence(selectedCandidateDocumentId
        ? { type: 'system-access', destination: 'candidate', sourceDocumentId: selectedCandidateDocumentId, view: 'overview' }
        : input.activeSystemAccess, deps)
      const emitDelta = (delta: string) => {
        if (state.cancelled) return
        if (!state.streamingStarted) {
          state.streamingStarted = true
          if (state.timings.narrativeStartedAt !== null) {
            state.timings.narrativeFirstTokenMs = Math.round(performance.now() - state.timings.narrativeStartedAt)
          }
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

      const newCaseCounts = deps.newCaseDigestCounts?.() ?? { newCasesToday: 0, unseenCaseCount: 0 }
      emit(state, { type: 'started', phase: 'planning' })
      const planningStartedAt = performance.now()
      state.timings.cloudCalls += 1
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
          newCasesToday: newCaseCounts.newCasesToday,
          unseenCaseCount: newCaseCounts.unseenCaseCount,
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

      if (selectedCandidateDocumentId && (pairRequest || reverseRequest)) {
        plan = { kind: 'tool', action: pairRequest
          ? { toolName: 'candidate.match.local', arguments: { ordinal: null } }
          : { toolName: 'job-case.search.local', arguments: { operation: 'search', query: null, recent: false } } }
      }
      state.timings.planningMs = Math.round(performance.now() - planningStartedAt)
      // PII-free plan visibility: which workspace was open and what the cloud chose.
      console.info('[agent-plan-debug]', {
        requestId: input.requestId,
        accessDestination: input.activeSystemAccess?.destination ?? null,
        workspaceEvidenceBuilt: Boolean(activeWorkspaceEvidence),
        selectedJobCase: Boolean(input.selectedJobCaseRef ?? planningConversation?.salesAgentState?.selectedJobCaseRef),
        branched: Boolean(input.branchFrom),
        planned: plan.kind === 'answer' ? 'answer' : plan.action.toolName,
        operation: plan.kind === 'tool' && 'operation' in plan.action.arguments ? plan.action.arguments.operation : null,
        ordinal: plan.kind === 'tool' && 'ordinal' in plan.action.arguments ? plan.action.arguments.ordinal : null
      })
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
        state.timings.narrativeStartedAt = performance.now()
        state.timings.cloudCalls += 1
        try {
          const streamed = await deps.narrativeStreamer.streamAnswer({
            conversationId: input.conversationId,
            requestId: input.requestId,
            locale: deps.locale(),
            userMessage: input.message,
            conversation: planningConversation,
            selectedJobCaseRef: input.selectedJobCaseRef ?? null,
            activeWorkspaceEvidence,
            newCasesToday: newCaseCounts.newCasesToday,
            unseenCaseCount: newCaseCounts.unseenCaseCount,
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
          state.timings.narrativeMs = Math.round(performance.now() - state.timings.narrativeStartedAt)
          const direct = useCase.saveDirectAnswer(
            input,
            streamed.content,
            { key: model.key, displayName: model.displayName }
          )
          emit(state, { type: 'completed' })
          return { ...direct, timings: turnTimings(state) }
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

      if (plan.action.toolName === 'job-case.conversation-import.local') {
        // The operator asked to record text they pasted earlier. Main re-reads
        // it from the conversation locally; the answer lane can never write.
        const zh = deps.locale() === 'zh-CN'
        const priorText = [...(planningConversation?.messages ?? [])]
          .reverse()
          .find((message) => message.role === 'user' && message.content.trim().length >= 40
            && !message.content.startsWith('【已提交') && !message.content.includes('を送信】'))
          ?.content ?? null
        if (!priorText || !deps.executeBusinessTextIntake) {
          emit(state, { type: 'completed' })
          return useCase.saveDirectAnswer(input, zh
            ? '在这个对话里没有找到可登记的业务文本。请把案件原文直接粘贴进来，我会立即导入。'
            : 'この会話には登録できる業務テキストが見つかりませんでした。案件の原文をそのまま貼り付けてください。すぐに取り込みます。', undefined, 'completed')
        }
        emit(state, { type: 'started', phase: 'local-tool' })
        const routed = routeBusinessText(priorText, { aliases: deps.jobCaseFieldAliases?.() ?? {} })
        // The operator's request IS the declaration: a prose paste the router
        // left alone still imports as a job case.
        const decision = routed.route === 'not-intake' || routed.route === 'ambiguous-sensitive'
          ? { ...routed, route: 'job-case' as const, reason: 'declared-job-case' as const }
          : routed
        const result = await deps.executeBusinessTextIntake(useCase, input, decision, {
          signal: state.abortController.signal,
          onCloudLaneStarted: () => emit(state, { type: 'started', phase: 'connecting-model' }),
          onClientRequestId: (clientRequestId) => markRemoteRequestStarted(state, clientRequestId),
          onRemoteSettled: () => markRemoteRequestSettled(state)
        })
        if (result.status === 'failed') {
          emit(state, {
            type: 'failed', code: 'AGENT_INTAKE_FAILED',
            message: '本地业务文本导入失败，原文未写入会话。', localFallbackPreserved: true
          })
        } else {
          emit(state, { type: 'completed' })
        }
        return result
      }

      state.streamingStarted = false
      state.totalDeltaCharacters = 0
      emit(state, { type: 'started', phase: 'local-tool' })
      const toolStartedAt = performance.now()
      const result = await useCase.execute(input, plan.action)
      state.timings.localToolMs = Math.round(performance.now() - toolStartedAt) - (state.timings.cloudReviewMs ?? 0)
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
        return result.status === 'completed' ? { ...result, timings: turnTimings(state) } : result
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
        return { ...result, timings: turnTimings(state) }
      }

      emit(state, { type: 'started', phase: 'connecting-model' })
      state.timings.narrativeStartedAt = performance.now()
      state.timings.cloudCalls += 1
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
        state.timings.narrativeMs = Math.round(performance.now() - state.timings.narrativeStartedAt)
        const saved = saveNarrativeState(result, {
          content: streamed.content,
          mode: 'cloud',
          modelKey: model.key,
          modelDisplayName: model.displayName,
          narrativeStatus: 'completed'
        })
        emit(state, { type: 'completed' })
        return { ...result, status: 'completed' as const, ...saved, timings: turnTimings(state) }
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
