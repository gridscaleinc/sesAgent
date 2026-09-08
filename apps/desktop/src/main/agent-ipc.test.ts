import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agentJobCaseDraftFacts } from '@job-cases'
import { jobCaseFieldKeys } from '@shared/contracts'
import type { IpcMainInvokeEvent } from 'electron'
import {
  builtInBroadcastTemplate,
  ipcChannels,
  type AiConversationSnapshot,
  type CandidateMatchTaskExecutionResult,
  type CaseBroadcastCopy,
  type CaseBroadcastRecord,
  type ExecuteAgentTurnInput,
  type JobCaseReviewSnapshot,
  type SaveAiConversationInput
} from '@shared'
import type { ActionContext, ActionOrchestrator } from '@action-runtime'
import type { EncryptedApplicationRepository } from '@persistence'
import type { MatchRuntimeIdentity } from '@matching'
import type { AiCommerceResponsesStreamResult } from '@aicommerce'
import type { CandidateReviewSnapshot } from '@shared'
import type { AgentMatchAssessmentInput, AgentNarrativeStreamer } from './agent-cloud-narrative'
import { registerAgentIpcHandlers, type AgentIpcDependencies } from './agent-ipc'
import { executeBusinessTextIntakeTurn, type BusinessTextIntakeTurnDependencies } from './business-text-intake'

const electronMock = vi.hoisted(() => {
  type Handler = (event: IpcMainInvokeEvent, rawInput: unknown) => unknown
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel)
      })
    }
  }
})

vi.mock('electron', () => ({ ipcMain: electronMock.ipcMain }))

const conversationId = '11111111-1111-4111-8111-111111111111'
const secondConversationId = '99999999-9999-4999-8999-999999999999'
const requestId = '22222222-2222-4222-8222-222222222222'
const secondRequestId = '33333333-3333-4333-8333-333333333333'
const jobCaseId = '44444444-4444-4444-8444-444444444444'
const matchRunId = '55555555-5555-4555-8555-555555555555'
const matchResultId = '66666666-6666-4666-8666-666666666666'
const candidateProfileId = '77777777-7777-4777-8777-777777777777'
function jobCaseReviewFixture(reviewId: string, overrides: Partial<JobCaseReviewSnapshot> = {}): JobCaseReviewSnapshot {
  return {
    reviewId,
    sourceId: '12121212-1212-4212-8212-121212121299',
    sourceType: 'chat-paste',
    providerMessageId: null,
    threadId: '12121212-1212-4212-8212-121212121299',
    fromDomain: null,
    messageDate: '2026-08-25T00:00:00.000Z',
    redactedSubject: 'Java 案件',
    redactedPreview: 'Java 案件',
    reviewRevision: 1,
    status: 'awaiting-review',
    privacyReviewed: false,
    fields: jobCaseFieldKeys.map((key) => {
      const value = key === 'title' ? 'Java 案件' : key === 'rate' ? '～65万円' : null
      return {
        key, label: key, originalValue: value, value, confidence: value ? 0.8 : 0,
        status: value ? 'needs_review' : 'missing', sourceLabels: [], changed: false, changeReason: null
      }
    }),
    warningCodes: ['DETERMINISTIC_EXTRACTION_REQUIRES_REVIEW'],
    completedAt: null,
    reviewerDisplayName: null,
    jobCase: null,
    lifecycle: 'active',
    intakeBatchId: null,
    cloudEligible: false,
    ...overrides
  }
}

/** A case a person confirmed, so 案件配信 may draft a message for it. */
function sendableReviewFixture(index: number): JobCaseReviewSnapshot {
  const reviewId = `12121212-1212-4212-8212-1212121213${String(index).padStart(2, '0')}`
  const caseId = `13131313-1313-4313-8313-1313131313${String(index).padStart(2, '0')}`
  return jobCaseReviewFixture(reviewId, {
    status: 'completed',
    fields: jobCaseFieldKeys.map((key) => {
      const value = key === 'title' ? `Java 案件 ${index}` : key === 'required_skills' ? 'Java' : key === 'rate' ? '～65万円' : null
      return {
        key, label: key, originalValue: value, value, confidence: value ? 1 : 0,
        status: value ? 'confirmed' as const : 'missing' as const, sourceLabels: [], changed: false, changeReason: null
      }
    }),
    jobCase: {
      id: caseId, sourceReviewId: reviewId, version: 1, status: 'active',
      confirmedAt: '2026-08-25T01:00:00.000Z', confirmedBy: 'HR', containsDirectIdentifiers: false
    }
  })
}

const searchPlanningResult = {
  kind: 'tool' as const,
  action: {
    toolName: 'job-case.search.local' as const,
    arguments: { operation: 'search' as const, query: null, recent: true }
  }
}

function input(message: string, id = requestId, options: {
  conversationId?: string
  expectedConversationRevision?: number | null
  selectedCandidateDocumentId?: string | null
  selectedJobCaseRef?: ExecuteAgentTurnInput['selectedJobCaseRef']
  activeSystemAccess?: ExecuteAgentTurnInput['activeSystemAccess']
  attachmentFileTokens?: string[]
} = {}): ExecuteAgentTurnInput {
  return {
    conversationId: options.conversationId ?? conversationId,
    message,
    expectedConversationRevision: options.expectedConversationRevision ?? null,
    requestId: id,
    selectedCandidateDocumentId: options.selectedCandidateDocumentId,
    selectedJobCaseRef: options.selectedJobCaseRef ?? null,
    ...(options.activeSystemAccess ? { activeSystemAccess: options.activeSystemAccess } : {}),
    ...(options.attachmentFileTokens ? { attachmentFileTokens: options.attachmentFileTokens } : {})
  }
}

const defaultSender = {
  send: vi.fn(),
  isDestroyed: vi.fn(() => false)
}

function invoke(channel: string, rawInput: unknown, sender = defaultSender): unknown {
  const handler = electronMock.handlers.get(channel)
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
  return handler({ sender } as unknown as IpcMainInvokeEvent, rawInput)
}

function createDependencies(options: {
  enabled?: boolean
  initialConversation?: AiConversationSnapshot
  runCandidateMatchTask?: AgentIpcDependencies['runCandidateMatchTask']
  cancelMatchTask?: AgentIpcDependencies['cancelMatchTask']
  narrativeStreamer?: AgentNarrativeStreamer | null
  executeBusinessTextIntake?: AgentIpcDependencies['executeBusinessTextIntake']
  jobCaseReviews?: JobCaseReviewSnapshot[]
  caseBroadcastCopies?: CaseBroadcastCopy[]
} = {}): AgentIpcDependencies {
  const conversations = new Map<string, AiConversationSnapshot>(options.initialConversation ? [[options.initialConversation.id, options.initialConversation]] : [])
  // Mirrors the store contract: a run binds to exactly one (conversation,
  // turn) pair, and a run created half-bound - conversation without turn - can
  // never be completed. That half-bound shape is what broke the intake.
  const actionRuns = new Map<string, { conversationId: string | null; turnId: string | null }>()
  const repository = {
    listActiveJobCases: vi.fn(() => [{
      id: jobCaseId,
      version: 2,
      confirmedAt: '2026-08-18T00:00:00.000Z',
      fields: [{ key: 'title', value: 'Java 案件' }, { key: 'required_skills', value: 'Java' }]
    }]),
    getAiConversation: vi.fn((id: string) => conversations.get(id) ?? null),
    saveAiConversation: vi.fn((saveInput: SaveAiConversationInput) => {
      const conversation: AiConversationSnapshot = {
        id: saveInput.conversationId,
        context: saveInput.context,
        title: saveInput.messages.find((message) => message.role === 'user')?.content ?? 'New conversation',
        messages: saveInput.messages,
        salesAgentState: saveInput.salesAgentState,
        revision: (saveInput.expectedRevision ?? 0) + 1,
        createdAt: '2026-08-18T00:00:00.000Z',
        updatedAt: '2026-08-18T00:00:01.000Z'
      }
      conversations.set(conversation.id, conversation)
      return conversation
    }),
    updateActionRun: vi.fn(),
    linkActionRunToConversation: vi.fn((actionRunId: string, conversationId: string, turnId: string) => {
      if (!conversations.has(conversationId)) throw new Error('conversation must be saved before ActionRun linking')
      const run = actionRuns.get(actionRunId)
      if (!run) return
      if (run.conversationId === conversationId && run.turnId === turnId) return
      if (run.conversationId !== null || run.turnId !== null) {
        throw new Error('ActionRun はすでに別の会話または turn に関連付けられています。')
      }
      actionRuns.set(actionRunId, { conversationId, turnId })
    }),
    getAgentMatchRunFacts: vi.fn(),
    getAgentCandidateProfileFacts: vi.fn(() => ({
      runId: matchRunId,
      validity: 'current' as const,
      candidate: { candidateProfileId, rank: 1, anonymousLabel: '候補者 AAAAAAAA' },
      profile: {
        profileVersion: 2,
        skills: 'Java', experienceYears: '8年', availability: '即日', rate: '90万円', japaneseLevel: 'N1',
        workStyle: 'リモート', role: 'バックエンド', location: '東京', workAuthorization: '就労制限なし',
        projectExperiences: []
      }
    })),
    getCandidateSourceDocumentId: vi.fn(() => '88888888-8888-4888-8888-888888888888'),
    listCandidateReviews: vi.fn(() => []),
    listCandidateInterviews: vi.fn(() => []),
    listJobCaseReviews: vi.fn(() => options.jobCaseReviews ?? []),
    listSeenJobCaseReviewIds: vi.fn((): string[] => []),
    getJobCaseReview: vi.fn((reviewId: string) =>
      (options.jobCaseReviews ?? []).find((review) => review.reviewId === reviewId) ?? jobCaseReviewFixture(reviewId)),
    listBroadcastTemplates: vi.fn(() => [builtInBroadcastTemplate()]),
    listAllCaseBroadcasts: vi.fn((): CaseBroadcastRecord[] => []),
    listCaseBroadcasts: vi.fn((): CaseBroadcastRecord[] => []),
    listAllCaseBroadcastCopies: vi.fn(() => options.caseBroadcastCopies ?? []),
    listCaseBroadcastCopies: vi.fn((reviewId: string) =>
      (options.caseBroadcastCopies ?? []).filter((copy) => copy.reviewId === reviewId)),
    getAgentJobCaseDraftFacts: vi.fn((reviewId: string, label: string) => agentJobCaseDraftFacts(jobCaseReviewFixture(reviewId), label)),
    listWorkTasks: vi.fn(() => []),
    getWorkTask: vi.fn(() => null),
    listActionApprovals: vi.fn(() => []),
    saveCandidateMatchAssessments: vi.fn(() => 1),
    getMatchingHomeProjection: vi.fn(() => ({
      state: 'onboarding', eligibleCandidateCount: 0, selectedJobCaseId: null, jobCases: [], currentRun: null
    }))
  } as unknown as EncryptedApplicationRepository
  const actionOrchestrator = {
    preflight: vi.fn((_toolName, context: ActionContext, rawInput) => {
      const actionRunId = `action-${actionRuns.size + 1}`
      actionRuns.set(actionRunId, { conversationId: context.conversationId ?? null, turnId: context.turnId ?? null })
      return { actionRunId, input: rawInput, decision: { outcome: 'allow' as const } }
    })
  } as unknown as ActionOrchestrator
  const currentMatchRuntimeIdentity: MatchRuntimeIdentity = {
    algorithmVersion: 'hard-filter-hybrid-rrf-v1',
    hardFilterPolicyVersion: 'tri-state-v3',
    embeddingModelId: 'embedding-test',
    embeddingModelRevision: 'revision-test',
    rerankerModelId: null,
    rerankerModelRevision: null
  }
  const defaultNarrativeStreamer: AgentNarrativeStreamer = {
    plan: vi.fn(async (planInput) => {
      if (/日语|日本語/u.test(planInput.userMessage)) {
        return { kind: 'tool' as const, action: { toolName: 'candidate.profile.read.local' as const, arguments: { rank: null } } }
      }
      if (/记录成案件|案件として登録/u.test(planInput.userMessage)) {
        return { kind: 'tool' as const, action: { toolName: 'job-case.conversation-import.local' as const, arguments: {} as Record<string, never> } }
      }
      if (/詳細|详情/u.test(planInput.userMessage)) {
        return { kind: 'tool' as const, action: { toolName: 'job-case.search.local' as const, arguments: { operation: 'detail' as const, ordinal: null } } }
      }
      if (/匹配|候補者/u.test(planInput.userMessage)) {
        return { kind: 'tool' as const, action: { toolName: 'candidate.match.local' as const, arguments: { ordinal: null } } }
      }
      if (/なぜ|为什么/u.test(planInput.userMessage)) {
        return { kind: 'tool' as const, action: { toolName: 'match-run.read.local' as const, arguments: { rank: 1 } } }
      }
      return { kind: 'tool' as const, action: { toolName: 'job-case.search.local' as const, arguments: { operation: 'search' as const, query: null, recent: true } } }
    }),
    streamAnswer: vi.fn(async (streamInput) => {
      streamInput.onClientRequestId('direct-answer-client-request')
      streamInput.onDelta('AI 直接回答。')
      streamInput.onRemoteSettled()
      return {
        clientRequestId: 'direct-answer-client-request', responseId: 'direct-answer-response',
        content: 'AI 直接回答。', billingModeUsed: 'subscription' as const
      }
    }),
    stream: vi.fn(async (streamInput) => {
      streamInput.onClientRequestId('client-request-123')
      streamInput.onDelta('AI 整理结果。')
      streamInput.onRemoteSettled()
      return {
        clientRequestId: 'client-request-123', responseId: 'response-123', content: 'AI 整理结果。', billingModeUsed: 'subscription' as const
      }
    }),
    assessMatchCandidates: vi.fn(async () => ({ assessments: [] })),
    cancel: vi.fn(async (clientRequestId) => ({ clientRequestId, status: 'cancel_requested' as const }))
  }
  return {
    repository,
    actionOrchestrator,
    assertTrustedSender: vi.fn(),
    conversationalMatchingEnabled: () => options.enabled ?? true,
    locale: () => 'ja-JP',
    currentOperator: () => ({ operatorId: 'operator-1', displayName: 'Test Operator' }),
    currentMatchRuntimeIdentity,
    createMatchTask: vi.fn(() => ({ taskId: 'task-1' })),
    runCandidateMatchTask: options.runCandidateMatchTask ?? vi.fn(),
    scheduleCandidateInterview: vi.fn(),
    runResumeAnalysisTask: vi.fn().mockResolvedValue({ name: 'candidate.pdf', format: 'pdf' }),
    cancelMatchTask: options.cancelMatchTask ?? vi.fn(),
    narrativeStreamer: options.narrativeStreamer === undefined ? defaultNarrativeStreamer : options.narrativeStreamer,
    ...(options.executeBusinessTextIntake ? { executeBusinessTextIntake: options.executeBusinessTextIntake } : {})
  }
}

describe('agent IPC boundary', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    vi.clearAllMocks()
  })

  it('fails closed when the conversational matching feature flag is disabled', async () => {
    const stop = registerAgentIpcHandlers(createDependencies({ enabled: false }))

    await expect(invoke(ipcChannels.executeAgentTurn, input('最近有什么案件？'))).rejects.toThrow('FEATURE_DISABLED')

    stop()
  })

  it('performs a real search-to-case-detail turn with a valid by-id date range and canonical reference', async () => {
    const dependencies = createDependencies()
    const stop = registerAgentIpcHandlers(dependencies)

    const searched = await invoke(ipcChannels.executeAgentTurn, input('最近の案件は？')) as {
      status: string
      conversation: AiConversationSnapshot
    }
    expect(searched.status).toBe('completed')
    const searchReference = searched.conversation.messages.at(-1)?.blocks?.find((block) => block.type === 'job-case-cards')?.cards[0]?.reference
    expect(searchReference).toBeDefined()

    const detailed = await invoke(ipcChannels.executeAgentTurn, input('この案件の詳細', secondRequestId, {
      expectedConversationRevision: searched.conversation.revision,
      selectedJobCaseRef: {
        ...searchReference!, ordinal: 99, label: 'Renderer 偽造案件', target: 'job-case:renderer-forged'
      }
    })) as { status: string; conversation: AiConversationSnapshot }
    expect(detailed.status).toBe('completed')
    const detailBlock = detailed.conversation.messages.at(-1)?.blocks?.find((block) => block.type === 'job-case-cards')
    expect(detailBlock).toMatchObject({
      type: 'job-case-cards',
      normalizedFilters: { updatedBefore: '9999-12-31T23:59:59.999Z' },
      cards: [{ reference: { objectId: jobCaseId, label: 'Java 案件', target: `job-case:${jobCaseId}`, ordinal: 1 } }]
    })
    expect(detailed.conversation.salesAgentState?.selectedJobCaseRef).toMatchObject({
      objectId: jobCaseId, label: 'Java 案件', target: `job-case:${jobCaseId}`, ordinal: 1
    })
    expect(dependencies.repository.linkActionRunToConversation).toHaveBeenCalledTimes(2)

    stop()
  })

  it('binds 当前案件 to the case open in the side workspace, without overriding the conversation selection', async () => {
    const secondCaseId = '14141414-1414-4414-8414-141414141401'
    const workspaceReviewId = '12121212-1212-4212-8212-121212121377'
    const review = jobCaseReviewFixture(workspaceReviewId, {
      status: 'completed',
      jobCase: {
        id: secondCaseId, sourceReviewId: workspaceReviewId, version: 1, status: 'active',
        confirmedAt: '2026-08-25T01:00:00.000Z', confirmedBy: 'HR', containsDirectIdentifiers: false
      }
    })
    const dependencies = createDependencies({ jobCaseReviews: [review] })
    // Two active cases, so nothing resolves by being the only record.
    vi.mocked(dependencies.repository.listActiveJobCases).mockReturnValue([
      {
        id: jobCaseId, version: 2, confirmedAt: '2026-08-18T00:00:00.000Z',
        fields: [
          { key: 'title' as const, label: 'title', value: 'Java 案件', sourceLabels: [] },
          { key: 'required_skills' as const, label: 'required_skills', value: 'Java', sourceLabels: [] }
        ]
      },
      {
        id: secondCaseId, version: 1, confirmedAt: '2026-08-25T01:00:00.000Z',
        fields: [
          { key: 'title' as const, label: 'title', value: 'Python 案件', sourceLabels: [] },
          { key: 'required_skills' as const, label: 'required_skills', value: 'Python', sourceLabels: [] }
        ]
      }
      // The persistence type carries provenance this projection never reads.
    ] as never)
    const stop = registerAgentIpcHandlers(dependencies)

    // No conversation selection, case review open on the right: that case is 当前案件.
    const fromWorkspace = await invoke(ipcChannels.executeAgentTurn, input('当前案件の詳細', requestId, {
      activeSystemAccess: { type: 'system-access', destination: 'case-review', reviewId: workspaceReviewId }
    })) as { status: string; conversation: AiConversationSnapshot }
    expect(fromWorkspace.status).toBe('completed')
    const workspaceCard = fromWorkspace.conversation.messages.at(-1)?.blocks?.find((block) => block.type === 'job-case-cards')
    expect(workspaceCard).toMatchObject({ cards: [{ reference: { objectId: secondCaseId, label: 'Python 案件' } }] })
    // The resolution is written back, so later turns stay on this case.
    expect(fromWorkspace.conversation.salesAgentState?.selectedJobCaseRef).toMatchObject({ objectId: secondCaseId })

    // A conversation that already selected a case keeps it even when the side panel shows another.
    const keptSelection = await invoke(ipcChannels.executeAgentTurn, input('この案件の詳細', secondRequestId, {
      expectedConversationRevision: fromWorkspace.conversation.revision,
      activeSystemAccess: { type: 'system-access', destination: 'matching', jobCaseId }
    })) as { status: string; conversation: AiConversationSnapshot }
    expect(keptSelection.status).toBe('completed')
    const keptCard = keptSelection.conversation.messages.at(-1)?.blocks?.find((block) => block.type === 'job-case-cards')
    expect(keptCard).toMatchObject({ cards: [{ reference: { objectId: secondCaseId } }] })

    // A fresh conversation with the matching page open resolves through jobCaseId.
    const fromMatching = await invoke(ipcChannels.executeAgentTurn, input('当前案件の詳細', '99999999-9999-4999-8999-999999999901', {
      conversationId: '99999999-9999-4999-8999-999999999902',
      activeSystemAccess: { type: 'system-access', destination: 'matching', jobCaseId }
    })) as { status: string; conversation: AiConversationSnapshot }
    expect(fromMatching.status).toBe('completed')
    const matchingCard = fromMatching.conversation.messages.at(-1)?.blocks?.find((block) => block.type === 'job-case-cards')
    expect(matchingCard).toMatchObject({ cards: [{ reference: { objectId: jobCaseId, label: 'Java 案件' } }] })

    // The broadcast view focused on a case binds the same way, and the planner
    // projection carries that case instead of bare queue counts.
    const fromBroadcast = await invoke(ipcChannels.executeAgentTurn, input('当前案件の詳細', '99999999-9999-4999-8999-999999999903', {
      conversationId: '99999999-9999-4999-8999-999999999904',
      activeSystemAccess: { type: 'system-access', destination: 'broadcast', reviewId: workspaceReviewId }
    })) as { status: string; conversation: AiConversationSnapshot }
    expect(fromBroadcast.status).toBe('completed')
    const broadcastCard = fromBroadcast.conversation.messages.at(-1)?.blocks?.find((block) => block.type === 'job-case-cards')
    expect(broadcastCard).toMatchObject({ cards: [{ reference: { objectId: secondCaseId } }] })
    const planCalls = vi.mocked(dependencies.narrativeStreamer!.plan).mock.calls
    expect(planCalls.at(-1)?.[0]?.activeWorkspaceEvidence).toMatchObject({
      destination: 'broadcast',
      data: { focusedCase: { status: 'completed', title: 'Java 案件' } }
    })

    stop()
  })

  it('records earlier pasted text as a case through the intake pipeline, never through an answer', async () => {
    const pastedCase = '【案件】SAP FIコンサル募集。役割：SE、必須：SAP S/4 FI、日本語流暢、単価～70万円、東京、9月開始長期。'
    const initialConversation: AiConversationSnapshot = {
      id: conversationId,
      context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
      title: '案件贴文',
      messages: [
        { id: 'user-paste', role: 'user', content: pastedCase, mode: 'cloud', createdAt: '2026-09-02T00:00:00.000Z' },
        { id: 'assistant-summary', role: 'assistant', content: '这是一则 SAP FI 招聘需求，尚未作为案件记录确认。', mode: 'cloud', createdAt: '2026-09-02T00:00:01.000Z' }
      ],
      salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null },
      revision: 1,
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:01.000Z'
    }
    const executeBusinessTextIntake = vi.fn<NonNullable<AgentIpcDependencies['executeBusinessTextIntake']>>(async (useCase, turnInput) =>
      useCase.saveDirectAnswer(turnInput, '已导入 1 条案件草稿。', undefined, 'completed'))
    const dependencies = createDependencies({ initialConversation, executeBusinessTextIntake })
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input('记录成案件啊', requestId, {
      expectedConversationRevision: 1
    })) as { status: string; conversation: AiConversationSnapshot }
    expect(result.status).toBe('completed')
    expect(executeBusinessTextIntake).toHaveBeenCalledTimes(1)
    const decision = executeBusinessTextIntake.mock.calls[0]![2] as { route: string; businessText: string }
    // The operator's request is the declaration: the earlier paste imports as a
    // job case even where the router alone would have left it alone.
    expect(decision.route).toBe('job-case')
    expect(decision.businessText).toContain('SAP FIコンサル募集')
    stop()
  })

  it('says plainly that nothing is importable instead of inventing a recorded case', async () => {
    const initialConversation: AiConversationSnapshot = {
      id: conversationId,
      context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
      title: '空对话',
      messages: [
        { id: 'user-short', role: 'user', content: '你好', mode: 'cloud', createdAt: '2026-09-02T00:00:00.000Z' },
        { id: 'assistant-short', role: 'assistant', content: '您好。', mode: 'cloud', createdAt: '2026-09-02T00:00:01.000Z' }
      ],
      salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null },
      revision: 1,
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:01.000Z'
    }
    const executeBusinessTextIntake = vi.fn()
    const dependencies = createDependencies({ initialConversation, executeBusinessTextIntake })
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input('记录成案件啊', requestId, {
      expectedConversationRevision: 1
    })) as { status: string; conversation: AiConversationSnapshot }
    expect(result.status).toBe('completed')
    expect(executeBusinessTextIntake).not.toHaveBeenCalled()
    expect(result.conversation.messages.at(-1)?.content).toContain('登録できる業務テキストが見つかりませんでした')
    stop()
  })

  it('projects the 今日新着 board to the planner when it is the open workspace', async () => {
    const dependencies = createDependencies()
    const stop = registerAgentIpcHandlers(dependencies)
    const result = await invoke(ipcChannels.executeAgentTurn, input('最近の案件は？', requestId, {
      activeSystemAccess: { type: 'system-access', destination: 'new-cases' }
    })) as { status: string }
    expect(result.status).toBe('completed')
    const planCalls = vi.mocked(dependencies.narrativeStreamer!.plan).mock.calls
    expect(planCalls.at(-1)?.[0]?.activeWorkspaceEvidence).toMatchObject({
      destination: 'new-cases',
      data: { newCasesToday: 0, unseenCount: 0, cases: [] }
    })
    stop()
  })

  it('rejects a non-sales conversation and a cross-conversation requestId reuse', async () => {
    const nonSalesConversation: AiConversationSnapshot = {
      id: conversationId,
      context: { assistant: 'candidate-profile', candidateDocumentId: '77777777-7777-4777-8777-777777777777', interviewId: null, interviewKind: null, roundNumber: null },
      title: '候補者会話', messages: [], revision: 1,
      createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z'
    }
    const stop = registerAgentIpcHandlers(createDependencies({ initialConversation: nonSalesConversation }))
    await expect(invoke(ipcChannels.executeAgentTurn, input('最近有什么案件？', requestId, { expectedConversationRevision: 1 }))).rejects.toThrow('CONVERSATION_CONTEXT_MISMATCH')

    const first = await invoke(ipcChannels.executeAgentTurn, input('最近有什么案件？', secondRequestId, { conversationId: secondConversationId })) as { status: string }
    expect(first.status).toBe('completed')
    await expect(invoke(ipcChannels.executeAgentTurn, input('最近有什么案件？', secondRequestId, { conversationId: conversationId }))).rejects.toThrow('REQUEST_ID_CONVERSATION_MISMATCH')
    await expect(invoke(ipcChannels.cancelAgentTurn, { conversationId, requestId: secondRequestId })).resolves.toEqual({
      status: 'not-running', conversationId, requestId: secondRequestId
    })

    stop()
  })

  it('binds request idempotency to the complete turn input', async () => {
    const stop = registerAgentIpcHandlers(createDependencies())
    await expect(invoke(ipcChannels.executeAgentTurn, input('最近有什么案件？'))).resolves.toMatchObject({ status: 'completed' })
    await expect(invoke(ipcChannels.executeAgentTurn, input('换一个完全不同的问题'))).rejects.toThrow('REQUEST_ID_INPUT_MISMATCH')
    stop()
  })

  it('rejects an attachment token that Main did not stage', async () => {
    const dependencies = createDependencies()
    Object.assign(dependencies.repository, { getStagedFileRecords: vi.fn(() => []) })
    const stop = registerAgentIpcHandlers(dependencies)
    await expect(invoke(ipcChannels.executeAgentTurn, input('总结附件', requestId, {
      attachmentFileTokens: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']
    }))).rejects.toThrow('AGENT_ATTACHMENT_NOT_FOUND')
    expect(dependencies.narrativeStreamer?.plan).not.toHaveBeenCalled()
    stop()
  })

  it('links a first-turn candidate match ActionRun only after the new conversation is saved', async () => {
    const actionRunId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const runCandidateMatchTask = vi.fn(async () => ({
      task: {} as CandidateMatchTaskExecutionResult['task'],
      query: 'Java',
      run: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', resultSetHash: 'c'.repeat(64) } as CandidateMatchTaskExecutionResult['run'],
      matches: [],
      processingJob: {} as CandidateMatchTaskExecutionResult['processingJob'],
      actionRunId
    }))
    const dependencies = createDependencies({ runCandidateMatchTask })
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input('给当前案件匹配候选人', secondRequestId, {
      selectedJobCaseRef: {
        kind: 'job-case', objectId: jobCaseId, objectVersion: 2, resultHash: null,
        ordinal: 1, label: 'Java 案件', target: `job-case:${jobCaseId}`
      }
    })) as { status: string; assistantMessage: { turnId?: string | null } }

    expect(result.status).toBe('completed')
    expect(dependencies.repository.linkActionRunToConversation).toHaveBeenCalledWith(
      actionRunId,
      conversationId,
      result.assistantMessage.turnId
    )
    stop()
  })

  const reviewedShortlist = () => ({
    task: {} as CandidateMatchTaskExecutionResult['task'],
    query: 'Java',
    run: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', resultSetHash: 'c'.repeat(64) } as CandidateMatchTaskExecutionResult['run'],
    matches: [{
      id: '77777777-7777-4777-8777-777777777777', sourceDocumentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      matchResultId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', matchResultHash: 'e'.repeat(64),
      anonymousLabel: '候補者 AAAAAAAA', matchScore: 80, matchedTerms: ['Java'], projectEvidence: null,
      fields: [{ key: 'skills', label: 'スキル', value: 'Java 5年、Spring Boot', sourceLabels: [] }],
      projectExperiences: [{ id: 'p1', title: '決済基盤刷新', period: '2023/04-2024/03', role: 'バックエンド', technologies: ['Java'], summary: 'Spring Boot で決済 API を開発', sourceLabels: [] }],
      retrieval: { rank: 1, hardFilters: [{ type: 'japanese-level', requested: '日本語:N2', actual: null, outcome: 'unknown' }] }
    }] as unknown as CandidateMatchTaskExecutionResult['matches'],
    processingJob: {} as CandidateMatchTaskExecutionResult['processingJob'],
    actionRunId: null
  })
  const selectedJavaCase = {
    selectedJobCaseRef: {
      kind: 'job-case' as const, objectId: jobCaseId, objectVersion: 2, resultHash: null,
      ordinal: 1, label: 'Java 案件', target: `job-case:${jobCaseId}`
    }
  }
  type MatchCardsResult = { status: string; timings?: { cloudCalls: number; cloudReviewMs: number | null; planningMs: number | null; totalMs: number }; assistantMessage: { blocks?: Array<{ type: string; cards?: Array<{ assessment?: unknown }>; cloudReview?: unknown }> } }

  it('clarifies a pronoun without a selected person instead of searching the pool', async () => {
    const dependencies = createDependencies()
    const stop = registerAgentIpcHandlers(dependencies)
    const result = await invoke(ipcChannels.executeAgentTurn, input('这个案件适合他吗', requestId, selectedJavaCase)) as { toolName: string | null; assistantMessage: { content: string } }
    expect(result.toolName).toBeNull()
    expect(dependencies.createMatchTask).not.toHaveBeenCalled()
    expect(dependencies.narrativeStreamer!.plan).not.toHaveBeenCalled()
    expect(result.assistantMessage.content).toContain('人材が指定されていません')
    stop()
  })

  it('binds the selected person to a pair evaluation even when the planner chooses a generic case list', async () => {
    const runCandidateMatchTask = vi.fn(async () => reviewedShortlist())
    const dependencies = createDependencies({ runCandidateMatchTask })
    const stop = registerAgentIpcHandlers(dependencies)
    const documentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const result = await invoke(ipcChannels.executeAgentTurn, input('这个案件适合他吗', requestId, { ...selectedJavaCase, selectedCandidateDocumentId: documentId })) as { toolName: string; conversation: AiConversationSnapshot }
    expect(result.toolName).toBe('candidate.match.local')
    expect(dependencies.createMatchTask).toHaveBeenCalledWith(jobCaseId, 2, documentId)
    expect(result.conversation.salesAgentState?.selectedCandidateDocumentId).toBe(documentId)
    const next = await invoke(ipcChannels.executeAgentTurn, input('这个案件适合他吗', secondRequestId, { expectedConversationRevision: result.conversation.revision })) as { toolName: string }
    expect(next.toolName).toBe('candidate.match.local')
    expect(dependencies.createMatchTask).toHaveBeenLastCalledWith(jobCaseId, 2, documentId)
    stop()
  })

  it('returns only the active cases supported by the selected person skills', async () => {
    const dependencies = createDependencies()
    const documentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const javaCase = dependencies.repository.listActiveJobCases()[0]!
    Object.assign(dependencies.repository, {
      listEligibleTalentProfiles: vi.fn(() => [{ id: candidateProfileId, sourceDocumentId: documentId, profileVersion: 1,
        confirmedAt: '2026-08-18T00:00:00.000Z', fields: [{ key: 'skills', label: 'Skills', value: 'Java' }], projectExperiences: [] }]),
      listActiveJobCases: vi.fn(() => [javaCase, { ...javaCase, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', fields: [{ key: 'title', value: 'Rust project' }, { key: 'required_skills', value: 'Rust' }] }])
    })
    const stop = registerAgentIpcHandlers(dependencies)
    const result = await invoke(ipcChannels.executeAgentTurn, input('该名候选人适合哪些案件', requestId, { selectedCandidateDocumentId: documentId })) as { assistantMessage: { blocks?: Array<{ type: string; cards?: Array<{ title: string }> }> } }
    const cards = result.assistantMessage.blocks?.find((block) => block.type === 'job-case-cards')?.cards
    expect(cards?.map((card) => card.title)).toEqual(['Java 案件'])
    stop()
  })

  it('never changes a person-to-case request into an unfiltered search', async () => {
    const dependencies = createDependencies()
    const stop = registerAgentIpcHandlers(dependencies)
    const documentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    Object.assign(dependencies.repository, { listEligibleTalentProfiles: vi.fn(() => []) })
    const result = await invoke(ipcChannels.executeAgentTurn, input('该名候选人适合哪些案件', requestId, { selectedCandidateDocumentId: documentId })) as { assistantMessage: { blocks?: Array<{ type: string }> } }
    expect(result.assistantMessage.blocks?.some((block) => block.type === 'job-case-cards')).not.toBe(true)
    expect(dependencies.actionOrchestrator.preflight).toHaveBeenCalledWith('job-case.search.local', expect.anything(), expect.objectContaining({ candidateDocumentId: documentId }), expect.anything(), expect.anything())
    stop()
  })

  it('attaches the cloud review to the shortlist cards and stores it with the run', async () => {
    const runCandidateMatchTask = vi.fn(async () => reviewedShortlist())
    const dependencies = createDependencies({ runCandidateMatchTask })
    const assess = vi.fn(async (assessInput: AgentMatchAssessmentInput) => {
      expect(assessInput.jobCase.requirements).toMatchObject([{ key: 'title', value: 'Java 案件' }, { key: 'required_skills', value: 'Java' }])
      expect(assessInput.candidates).toEqual([{
        label: 'CANDIDATE_1',
        hardFilters: [{ requirement: '日本語:N2', actual: null, outcome: 'unknown' }],
        facts: [{ label: 'スキル', value: 'Java 5年、Spring Boot' }],
        projects: [{ title: '決済基盤刷新', period: '2023/04-2024/03', role: 'バックエンド', technologies: ['Java'], summary: 'Spring Boot で決済 API を開発' }]
      }])
      assessInput.onClientRequestId('match-assess-client-request')
      assessInput.onRemoteSettled()
      return {
        assessments: [{
          candidate: 'CANDIDATE_1', fit: 'possible' as const,
          met: [{ requirement: 'Java', evidence: 'Java 5年、Spring Boot' }], gaps: [], confirm: ['日本語レベル'], reason: '主要スキルは一致。'
        }]
      }
    })
    dependencies.narrativeStreamer!.assessMatchCandidates = assess
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input('给当前案件匹配候选人', secondRequestId, selectedJavaCase)) as MatchCardsResult

    expect(result.status).toBe('completed')
    expect(assess).toHaveBeenCalledTimes(1)
    const block = result.assistantMessage.blocks?.find((item) => item.type === 'candidate-match-cards')
    expect(block?.cards?.[0]?.assessment).toMatchObject({
      version: 'match-assessment-v1', fit: 'possible', confirm: ['日本語レベル'], reason: '主要スキルは一致。', modelKey: expect.any(String)
    })
    expect(dependencies.repository.saveCandidateMatchAssessments).toHaveBeenCalledWith(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      [expect.objectContaining({ matchResultId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })]
    )
    expect(block).toMatchObject({ cloudReview: { status: 'reviewed', reviewedCount: 1 } })
    // Plan, review, narrative: three cloud round trips, each timed.
    expect(result.timings).toMatchObject({ cloudCalls: 3 })
    expect(result.timings?.cloudReviewMs).not.toBeNull()
    expect(result.timings?.planningMs).not.toBeNull()
    stop()
  })

  it('does not send a row that matched nothing to the cloud reviewer', async () => {
    const shortlist = reviewedShortlist()
    const unmatched = { ...(shortlist.matches[0] as unknown as Record<string, unknown>), matchScore: 0, matchedTerms: [], retrieval: { rank: 1, hardFilters: [{ type: 'japanese-level', requested: '日本語流暢', actual: null, outcome: 'unknown' }] } }
    const runCandidateMatchTask = vi.fn(async () => ({ ...shortlist, matches: [unmatched] as unknown as CandidateMatchTaskExecutionResult['matches'] }))
    const dependencies = createDependencies({ runCandidateMatchTask })
    const assess = vi.fn()
    dependencies.narrativeStreamer!.assessMatchCandidates = assess
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input('给当前案件匹配候选人', secondRequestId, selectedJavaCase)) as MatchCardsResult

    expect(result.status).toBe('completed')
    expect(assess).not.toHaveBeenCalled()
    const block = result.assistantMessage.blocks?.find((item) => item.type === 'candidate-match-cards')
    expect(block).toMatchObject({ cloudReview: { status: 'skipped', code: 'nothing-matched' } })
    stop()
  })

  it('still completes the match turn with the local cards when the cloud review fails', async () => {
    const runCandidateMatchTask = vi.fn(async () => reviewedShortlist())
    const dependencies = createDependencies({ runCandidateMatchTask })
    dependencies.narrativeStreamer!.assessMatchCandidates = vi.fn(async () => {
      throw Object.assign(new Error('upstream unavailable'), { code: 'AI_UPSTREAM_ERROR' })
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input('给当前案件匹配候选人', secondRequestId, selectedJavaCase)) as MatchCardsResult

    expect(result.status).toBe('completed')
    const block = result.assistantMessage.blocks?.find((item) => item.type === 'candidate-match-cards')
    expect(block?.cards).toHaveLength(1)
    expect(block?.cards?.[0]).not.toHaveProperty('assessment')
    expect(dependencies.repository.saveCandidateMatchAssessments).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('[candidate-match-assessment-skipped]', expect.objectContaining({ runId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', code: 'cloud-error' }))
    // The reason travels with the cards so the operator sees why there is no review.
    expect(block).toMatchObject({ cloudReview: { status: 'skipped', code: 'cloud-error', reason: 'Error: upstream unavailable' } })
    warn.mockRestore()
    stop()
  })

  it('answers a natural-language summary from existing context without rerunning candidate matching', async () => {
    const initialConversation: AiConversationSnapshot = {
      id: conversationId,
      context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
      title: '候选人匹配',
      messages: [
        { id: 'user-previous', role: 'user', content: '给当前案件匹配候选人', mode: 'local', createdAt: '2026-08-18T00:00:00.000Z' },
        { id: 'assistant-previous', role: 'assistant', content: 'CANDIDATE_1 匹配度 95。', mode: 'cloud', createdAt: '2026-08-18T00:00:01.000Z' }
      ],
      salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', lastSearchMessageId: null },
      revision: 1,
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:01.000Z'
    }
    const runCandidateMatchTask = vi.fn()
    const stream = vi.fn()
    const streamAnswer = vi.fn(async (streamInput: Parameters<AgentNarrativeStreamer['streamAnswer']>[0]) => {
      streamInput.onClientRequestId('summary-answer-request')
      streamInput.onDelta('候选人的主要匹配点是 Java，当前证据未记录明显不足。')
      streamInput.onRemoteSettled()
      return {
        clientRequestId: 'summary-answer-request', responseId: 'summary-answer-response',
        content: '候选人的主要匹配点是 Java，当前证据未记录明显不足。', billingModeUsed: 'subscription' as const
      }
    })
    const plan = vi.fn(async (planInput: Parameters<AgentNarrativeStreamer['plan']>[0]) => {
      planInput.onClientRequestId('summary-planning-request')
      planInput.onRemoteSettled()
      return { kind: 'answer' as const }
    })
    const dependencies = createDependencies({
      initialConversation,
      runCandidateMatchTask,
      narrativeStreamer: {
        plan,
        streamAnswer,
        stream,
        cancel: vi.fn(async (clientRequestId) => ({ clientRequestId, status: 'cancel_requested' as const }))
      }
    })
    const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) }
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input(
      '总结一下候选人的整体情况', secondRequestId, { expectedConversationRevision: 1 }
    ), sender) as { status: string; toolName: string | null; assistantMessage: { content: string; blocks?: unknown[] } }

    expect(result).toMatchObject({
      status: 'completed', toolName: null,
      assistantMessage: { content: '候选人的主要匹配点是 Java，当前证据未记录明显不足。', blocks: [] }
    })
    expect(plan).toHaveBeenCalledTimes(1)
    expect(streamAnswer).toHaveBeenCalledTimes(1)
    expect(stream).not.toHaveBeenCalled()
    expect(runCandidateMatchTask).not.toHaveBeenCalled()
    expect(dependencies.actionOrchestrator.preflight).not.toHaveBeenCalled()
    expect(sender.send.mock.calls.map((call) => (call[1] as { type: string }).type)).toEqual([
      'started', 'started', 'started', 'delta', 'completed'
    ])
    stop()
  })

  it('re-resolves the active right workspace in Main and passes only its safe projection to planning and answer', async () => {
    const plan = vi.fn(async (_planInput: Parameters<AgentNarrativeStreamer['plan']>[0]) => ({ kind: 'answer' as const }))
    const streamAnswer = vi.fn(async (streamInput: Parameters<AgentNarrativeStreamer['streamAnswer']>[0]) => {
      streamInput.onClientRequestId('workspace-answer-request')
      streamInput.onDelta('右侧有一个待审核 Java 案件。')
      streamInput.onRemoteSettled()
      return {
        clientRequestId: 'workspace-answer-request', responseId: 'workspace-answer-response',
        content: '右侧有一个待审核 Java 案件。', billingModeUsed: 'subscription' as const
      }
    })
    const dependencies = createDependencies({
      narrativeStreamer: {
        plan,
        streamAnswer,
        stream: vi.fn(),
        cancel: vi.fn(async (clientRequestId) => ({ clientRequestId, status: 'cancel_requested' as const }))
      }
    })
    vi.mocked(dependencies.repository.listJobCaseReviews).mockReturnValue([{
      reviewId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sourceId: 'source-1', sourceType: 'manual', providerMessageId: null, threadId: 'thread-1', fromDomain: null,
      messageDate: '2026-08-24T00:00:00.000Z', redactedSubject: 'Java 案件', redactedPreview: 'Java、AWS',
      reviewRevision: 1, status: 'awaiting-review', privacyReviewed: false,
      fields: [{ key: 'required_skills', label: '必須スキル', originalValue: 'Java', value: 'Java', confidence: 1, status: 'needs_review', sourceLabels: [], changed: false, changeReason: null }],
      warningCodes: [], completedAt: null, reviewerDisplayName: null, jobCase: null, lifecycle: 'active', cloudEligible: false
    } as JobCaseReviewSnapshot])
    const stop = registerAgentIpcHandlers(dependencies)

    await invoke(ipcChannels.executeAgentTurn, input('总结右侧案件', secondRequestId, {
      activeSystemAccess: { type: 'system-access', destination: 'job-cases' }
    }))

    expect(plan).toHaveBeenCalledWith(expect.objectContaining({
      activeWorkspaceEvidence: expect.objectContaining({
        destination: 'job-cases',
        data: expect.objectContaining({ pendingReviewCount: 1 })
      })
    }))
    expect(streamAnswer).toHaveBeenCalledWith(expect.objectContaining({
      activeWorkspaceEvidence: expect.objectContaining({ destination: 'job-cases' })
    }))
    const serialized = JSON.stringify(vi.mocked(plan).mock.calls[0]?.[0]?.activeWorkspaceEvidence)
    expect(serialized).toContain('Java')
    expect(serialized).not.toContain('reviewId')
    expect(serialized).not.toContain('aaaaaaaa-aaaa')
    stop()
  })

  it('passes a validated meeting link only to local persistence and binds ActionRun with its hash', async () => {
    const meetingUrl = 'https://app.zoom.us/wc/12345678901/join?pwd=local-test-only'
    const initialConversation: AiConversationSnapshot = {
      id: conversationId,
      context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
      title: '面试安排',
      messages: [{ id: 'assistant-match', role: 'assistant', content: '候选人匹配结果', mode: 'local', createdAt: '2026-08-18T00:00:00.000Z' }],
      salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: matchRunId, lastSearchMessageId: null },
      revision: 1,
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z'
    }
    const plan = vi.fn(async (planInput: Parameters<AgentNarrativeStreamer['plan']>[0]) => {
      planInput.onClientRequestId('schedule-planning-request')
      planInput.onRemoteSettled()
      return {
        kind: 'tool' as const,
        action: {
          toolName: 'candidate.interview.schedule.local' as const,
          arguments: {
            rank: 1, date: '2026-08-20', time: '14:00', method: 'zoom' as const,
            durationMinutes: 30, kind: 'recruiting' as const, note: null
          }
        }
      }
    })
    const dependencies = createDependencies({
      initialConversation,
      narrativeStreamer: {
        plan,
        streamAnswer: vi.fn(),
        stream: vi.fn(async (streamInput) => {
          streamInput.onClientRequestId('schedule-narrative-request')
          streamInput.onDelta('面谈已登记。')
          streamInput.onRemoteSettled()
          return {
            clientRequestId: 'schedule-narrative-request', responseId: 'schedule-narrative-response',
            content: '面谈已登记。', billingModeUsed: 'subscription' as const
          }
        }),
        cancel: vi.fn(async (clientRequestId) => ({ clientRequestId, status: 'cancel_requested' as const }))
      }
    })
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input(
      `30分钟。Zoom 链接是 ${meetingUrl}`,
      secondRequestId,
      { expectedConversationRevision: 1 }
    )) as { status: string; toolName: string | null }

    expect(result).toMatchObject({ status: 'completed', toolName: 'candidate.interview.schedule.local' })
    expect(dependencies.scheduleCandidateInterview).toHaveBeenCalledWith(expect.objectContaining({
      meetingMethod: 'zoom', meetingUrl, durationMinutes: 30
    }))
    const preflightInput = vi.mocked(dependencies.actionOrchestrator.preflight).mock.calls[0]?.[2]
    expect(preflightInput).toMatchObject({ meetingUrlHash: expect.stringMatching(/^[a-f0-9]{64}$/u) })
    expect(JSON.stringify(preflightInput)).not.toContain(meetingUrl)
    stop()
  })

  it('does not expose planning deltas or cancel an already-settled remote request when final plan validation fails', async () => {
    const cancel = vi.fn(async (clientRequestId: string) => ({ clientRequestId, status: 'too_late' as const }))
    const narrativeStreamer: AgentNarrativeStreamer = {
      plan: vi.fn(async (planInput) => {
        planInput.onClientRequestId('invalid-settled-planning-request')
        planInput.onRemoteSettled()
        throw new Error('AI 同时返回 ANSWER 和 TOOL，已拒绝继续。')
      }),
      streamAnswer: vi.fn(),
      stream: vi.fn(),
      cancel
    }
    const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) }
    const stop = registerAgentIpcHandlers(createDependencies({ narrativeStreamer }))

    const result = await invoke(ipcChannels.executeAgentTurn, input('工作经历列出来参考一下'), sender) as {
      status: string
      assistantMessage: { content: string }
    }

    expect(result).toMatchObject({
      status: 'failed',
      assistantMessage: { content: expect.stringContaining('AI 无法形成有效的受控 Tool 计划') }
    })
    expect(cancel).not.toHaveBeenCalled()
    expect(narrativeStreamer.streamAnswer).not.toHaveBeenCalled()
    expect(narrativeStreamer.stream).not.toHaveBeenCalled()
    const events = sender.send.mock.calls.map((call) => call[1] as { type: string; message?: string })
    expect(events.some((event) => event.type === 'delta')).toBe(false)
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      message: expect.stringContaining('远端规划响应已经结束')
    })
    expect(events.at(-1)?.message).not.toContain('too_late')
    stop()
  })

  it('keeps a failed Tool ActionRun auditable and links it after the failure message is saved', async () => {
    const actionRunId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const initialConversation: AiConversationSnapshot = {
      id: conversationId,
      context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
      title: '已保存的案件匹配会话',
      messages: [{ id: 'previous-agent-message', role: 'assistant', content: '候选人结果', mode: 'local', createdAt: '2026-08-18T00:00:00.000Z' }],
      salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', lastSearchMessageId: null },
      revision: 1,
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z'
    }
    const dependencies = createDependencies({ initialConversation })
    const actionOrchestrator = dependencies.actionOrchestrator as unknown as { preflight: ReturnType<typeof vi.fn> }
    actionOrchestrator.preflight.mockReturnValue({
      actionRunId,
      input: { runId: initialConversation.salesAgentState?.lastMatchRunId, resultId: null, rank: 1 },
      decision: { outcome: 'allow' }
    })
    const repository = dependencies.repository as unknown as {
      getAgentMatchRunFacts: ReturnType<typeof vi.fn>
    }
    repository.getAgentMatchRunFacts.mockImplementation(() => undefined)
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input('なぜ1位になったの？', secondRequestId, { expectedConversationRevision: 1 })) as {
      status: string
      actionRunId: string | null
      assistantMessage: { turnId?: string | null }
    }

    expect(result.status).toBe('failed')
    expect(result.actionRunId).toBe(actionRunId)
    expect(dependencies.repository.linkActionRunToConversation).toHaveBeenCalledWith(
      actionRunId,
      conversationId,
      result.assistantMessage.turnId
    )
    stop()
  })

  it('uses AI planning to resolve 日语呢, reads the current candidate profile, and streams a Chinese answer', async () => {
    const resultHash = 'a'.repeat(64)
    const initialConversation: AiConversationSnapshot = {
      id: conversationId,
      context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
      title: '候选人匹配',
      messages: [{
        id: 'matched-candidates', role: 'assistant', content: '找到一位候选人。', mode: 'local',
        createdAt: '2026-08-18T00:00:00.000Z',
        blocks: [{
          type: 'candidate-match-cards', runId: matchRunId, resultHash,
          cards: [{
            reference: { kind: 'match-result', objectId: matchResultId, objectVersion: null, resultHash, ordinal: 1, label: '候補者 AAAAAAAA', target: `match-result:${matchResultId}` },
            candidateProfileId, runId: matchRunId, rank: 1, anonymousLabel: '候補者 AAAAAAAA', fitScore: 95,
            matched: ['Java'], missing: [], hardFilterStatus: 'passed', projectEvidence: '支付平台', status: 'current'
          }]
        }]
      }],
      salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: matchRunId, lastSearchMessageId: null },
      revision: 1,
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z'
    }
    const stream = vi.fn(async (streamInput: Parameters<AgentNarrativeStreamer['stream']>[0]) => {
      expect(streamInput.userMessage).toBe('日语呢')
      expect(streamInput.assistantMessage.blocks?.[0]).toMatchObject({
        type: 'candidate-profile-evidence', facts: { profile: { japaneseLevel: 'N1' } }
      })
      streamInput.onClientRequestId('candidate-profile-stream')
      streamInput.onDelta('该候选人的日语水平为 N1。')
      streamInput.onRemoteSettled()
      return {
        clientRequestId: 'candidate-profile-stream', responseId: 'candidate-profile-response',
        content: '该候选人的日语水平为 N1。', billingModeUsed: 'subscription' as const
      }
    })
    const dependencies = createDependencies({ initialConversation })
    if (dependencies.narrativeStreamer) dependencies.narrativeStreamer.stream = stream
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input('日语呢', secondRequestId, {
      expectedConversationRevision: initialConversation.revision
    })) as { status: string; toolName: string | null; assistantMessage: { content: string } }

    expect(result).toMatchObject({
      status: 'completed', toolName: 'candidate.profile.read.local',
      assistantMessage: { content: '该候选人的日语水平为 N1。' }
    })
    expect(dependencies.actionOrchestrator.preflight).toHaveBeenCalledWith(
      'candidate.profile.read.local',
      expect.objectContaining({ scopeId: 'selected-candidate-profile' }),
      expect.objectContaining({ runId: matchRunId, resultId: matchResultId, rank: 1 }),
      expect.any(String),
      expect.any(String)
    )
    expect(dependencies.repository.getAgentCandidateProfileFacts).toHaveBeenCalledWith(
      matchRunId, dependencies.currentMatchRuntimeIdentity, matchResultId, 1
    )
    expect(stream).toHaveBeenCalledTimes(1)
    stop()
  })

  it('deduplicates the same request and rejects a concurrent request for the conversation', async () => {
    let resolveMatch!: (result: CandidateMatchTaskExecutionResult) => void
    const runCandidateMatchTask = vi.fn(() => new Promise<CandidateMatchTaskExecutionResult>((resolve) => {
      resolveMatch = resolve
    }))
    const cancelMatchTask = vi.fn()
    const dependencies = createDependencies({ runCandidateMatchTask, cancelMatchTask })
    const stop = registerAgentIpcHandlers(dependencies)

    const pending = invoke(ipcChannels.executeAgentTurn, input('给当前案件匹配候选人')) as Promise<unknown>
    await vi.waitFor(() => expect(runCandidateMatchTask).toHaveBeenCalledTimes(1))
    await expect(invoke(ipcChannels.executeAgentTurn, input('给当前案件匹配候选人', secondRequestId))).rejects.toThrow('TURN_ALREADY_RUNNING')
    const duplicate = invoke(ipcChannels.executeAgentTurn, input('给当前案件匹配候选人'))
    expect(duplicate).toBeInstanceOf(Promise)
    expect(runCandidateMatchTask).toHaveBeenCalledTimes(1)

    await expect(invoke(ipcChannels.cancelAgentTurn, { conversationId, requestId })).resolves.toMatchObject({
      status: 'cancelled', conversationId, requestId,
      message: expect.stringContaining('尚未取得')
    })
    resolveMatch({} as CandidateMatchTaskExecutionResult)
    const [result, duplicateResult] = await Promise.all([pending, duplicate as Promise<unknown>])
    expect(result).toMatchObject({ status: 'cancelled', requestId })
    expect(duplicateResult).toEqual(result)
    expect(cancelMatchTask).toHaveBeenCalledWith('task-1')

    stop()
  })

  it('forwards cancellation to an active matching task and returns a cancelled turn', async () => {
    let resolveMatch!: (result: CandidateMatchTaskExecutionResult) => void
    const runCandidateMatchTask = vi.fn(() => new Promise<CandidateMatchTaskExecutionResult>((resolve) => {
      resolveMatch = resolve
    }))
    const cancelMatchTask = vi.fn()
    const stop = registerAgentIpcHandlers(createDependencies({ runCandidateMatchTask, cancelMatchTask }))

    const pending = invoke(ipcChannels.executeAgentTurn, input('给当前案件匹配候选人')) as Promise<{ status: string }>
    await vi.waitFor(() => expect(runCandidateMatchTask).toHaveBeenCalledTimes(1))
    await expect(invoke(ipcChannels.cancelAgentTurn, { conversationId, requestId })).resolves.toMatchObject({
      status: 'cancelled', conversationId, requestId
    })
    expect(cancelMatchTask).toHaveBeenCalledWith('task-1')

    resolveMatch({} as CandidateMatchTaskExecutionResult)
    await expect(pending).resolves.toMatchObject({ status: 'cancelled', requestId })

    stop()
  })

  it('aborts local SSE reading and independently records a too_late provider cancel result', async () => {
    const cancel = vi.fn(async (clientRequestId: string) => ({ clientRequestId, status: 'too_late' as const }))
    const narrativeStreamer: AgentNarrativeStreamer = {
      plan: vi.fn(async () => searchPlanningResult),
      streamAnswer: vi.fn(),
      stream: vi.fn((streamInput) => new Promise<AiCommerceResponsesStreamResult>((_resolve, reject) => {
        streamInput.onClientRequestId('client-request-too-late')
        streamInput.onDelta('partial')
        streamInput.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })),
      cancel
    }
    const dependencies = createDependencies({ narrativeStreamer })
    const stop = registerAgentIpcHandlers(dependencies)
    const pending = invoke(ipcChannels.executeAgentTurn, input('最近有什么案件？')) as Promise<{ status: string; assistantMessage: { narrativeStatus?: string } }>
    await vi.waitFor(() => expect(narrativeStreamer.stream).toHaveBeenCalledTimes(1))

    await expect(invoke(ipcChannels.cancelAgentTurn, { conversationId, requestId })).resolves.toMatchObject({
      status: 'cancelled', remoteCancelStatus: 'too_late', message: expect.stringContaining('AICommerce 返回 too_late')
    })
    await expect(pending).resolves.toMatchObject({
      status: 'cancelled', assistantMessage: { narrativeStatus: 'cancelled' }
    })
    expect(cancel).toHaveBeenCalledWith('client-request-too-late')
    stop()
  })

  it('aborts and remotely cancels a started stream after a non-user parser or consumer failure without marking the turn cancelled', async () => {
    const observedSignal: { value: AbortSignal | null } = { value: null }
    const cancel = vi.fn(async (clientRequestId: string) => ({ clientRequestId, status: 'cancel_requested' as const }))
    const narrativeStreamer: AgentNarrativeStreamer = {
      plan: vi.fn(async () => searchPlanningResult),
      streamAnswer: vi.fn(),
      stream: vi.fn(async (streamInput) => {
        observedSignal.value = streamInput.signal
        streamInput.onClientRequestId('client-request-consumer-failure')
        streamInput.onDelta('partial')
        throw new Error('consumer limit')
      }),
      cancel
    }
    const dependencies = createDependencies({ narrativeStreamer })
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input('最近有什么案件？')) as {
      status: string
      assistantMessage: { mode?: string; narrativeStatus?: string }
    }

    expect(observedSignal.value?.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledWith('client-request-consumer-failure')
    expect(result).toMatchObject({
      status: 'failed',
      assistantMessage: { mode: 'local-fallback', narrativeStatus: 'failed-local-fallback' }
    })
    expect(result.status).not.toBe('cancelled')
    stop()
  })

  it('distinguishes a failed remote cancel attempt from a missing client request id', async () => {
    const cancel = vi.fn(async () => { throw new Error('cancel network failed') })
    const narrativeStreamer: AgentNarrativeStreamer = {
      plan: vi.fn(async () => searchPlanningResult),
      streamAnswer: vi.fn(),
      stream: vi.fn((streamInput) => new Promise<AiCommerceResponsesStreamResult>((_resolve, reject) => {
        streamInput.onClientRequestId('client-request-cancel-failure')
        streamInput.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })),
      cancel
    }
    const stop = registerAgentIpcHandlers(createDependencies({ narrativeStreamer }))
    const pending = invoke(ipcChannels.executeAgentTurn, input('最近有什么案件？')) as Promise<{ status: string }>
    await vi.waitFor(() => expect(narrativeStreamer.stream).toHaveBeenCalledTimes(1))

    await expect(invoke(ipcChannels.cancelAgentTurn, { conversationId, requestId })).resolves.toMatchObject({
      status: 'cancelled', remoteCancelStatus: null,
      message: expect.stringContaining('独立取消请求失败')
    })
    await expect(pending).resolves.toMatchObject({ status: 'cancelled' })
    expect(cancel).toHaveBeenCalledWith('client-request-cancel-failure')
    stop()
  })

  it('does not turn a completed cloud save into local fallback when sender.send races with window destruction', async () => {
    const dependencies = createDependencies()
    const stop = registerAgentIpcHandlers(dependencies)
    const sender = {
      isDestroyed: vi.fn(() => false),
      send: vi.fn((_channel: string, event: { type: string }) => {
        if (event.type === 'completed') throw new Error('webContents destroyed during send')
      })
    }
    const result = await invoke(ipcChannels.executeAgentTurn, input('最近有什么案件？'), sender) as {
      status: string
      assistantMessage: { mode?: string; narrativeStatus?: string }
    }

    expect(sender.send).toHaveBeenCalledWith(ipcChannels.agentTurnEvent, expect.objectContaining({ type: 'completed' }))
    expect(result).toMatchObject({
      status: 'completed', assistantMessage: { mode: 'cloud', narrativeStatus: 'completed' }
    })
    expect(dependencies.repository.getAiConversation(conversationId)?.messages.at(-1)).toMatchObject({
      mode: 'cloud', narrativeStatus: 'completed'
    })
    stop()
  })

  it('aborts and best-effort cancels an upstream request when the IPC handlers are disposed', async () => {
    const observedSignal: { value: AbortSignal | null } = { value: null }
    const cancel = vi.fn(async (clientRequestId: string) => ({ clientRequestId, status: 'cancel_requested' as const }))
    const narrativeStreamer: AgentNarrativeStreamer = {
      plan: vi.fn(async () => searchPlanningResult),
      streamAnswer: vi.fn(),
      stream: vi.fn((streamInput) => new Promise<AiCommerceResponsesStreamResult>((_resolve, reject) => {
        observedSignal.value = streamInput.signal
        streamInput.onClientRequestId('client-request-dispose')
        streamInput.signal.addEventListener('abort', () => reject(new Error('disposed')), { once: true })
      })),
      cancel
    }
    const stop = registerAgentIpcHandlers(createDependencies({ narrativeStreamer }))
    const pending = invoke(ipcChannels.executeAgentTurn, input('最近有什么案件？')) as Promise<{ status: string }>
    await vi.waitFor(() => expect(narrativeStreamer.stream).toHaveBeenCalledTimes(1))

    stop()
    expect(observedSignal.value?.aborted).toBe(true)
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith('client-request-dispose'))
    await expect(pending).resolves.toMatchObject({ status: 'failed' })
  })

  it('sends strictly sequenced stream events only to the initiating sender and persists model metadata', async () => {
    const dependencies = createDependencies()
    const stop = registerAgentIpcHandlers(dependencies)
    const initiatingSender = { send: vi.fn(), isDestroyed: vi.fn(() => false) }
    const otherSender = { send: vi.fn(), isDestroyed: vi.fn(() => false) }

    const result = await invoke(ipcChannels.executeAgentTurn, {
      ...input('最近有什么案件？'), modelKey: 'deepseek-v4-flash'
    }, initiatingSender) as { status: string; assistantMessage: { modelKey?: string; modelDisplayName?: string } }

    expect(result).toMatchObject({
      status: 'completed', assistantMessage: { modelKey: 'deepseek-v4-flash', modelDisplayName: 'DeepSeek V4 Flash' }
    })
    expect(dependencies.narrativeStreamer?.stream).toHaveBeenCalledWith(expect.objectContaining({
      model: expect.objectContaining({
        key: 'deepseek-v4-flash', provider: 'deepseek', endpoint: 'chat-completions'
      })
    }))
    expect(dependencies.narrativeStreamer?.plan).toHaveBeenCalledTimes(1)
    expect(dependencies.narrativeStreamer?.stream).toHaveBeenCalledTimes(1)
    const events = initiatingSender.send.mock.calls.map((call) => call[1] as { type: string; sequence: number })
    expect(events.map((event) => event.sequence)).toEqual(events.map((_event, index) => index + 1))
    expect(events.map((event) => event.type)).toEqual(['started', 'started', 'started', 'started', 'delta', 'completed'])
    expect(otherSender.send).not.toHaveBeenCalled()
    stop()
  })

  it('rejects an unlisted model before Tool execution', async () => {
    const dependencies = createDependencies()
    const stop = registerAgentIpcHandlers(dependencies)
    await expect(invoke(ipcChannels.executeAgentTurn, {
      ...input('最近有什么案件？'), modelKey: 'gpt-5.6-attacker'
    })).rejects.toThrow(/允许列表/)
    expect(dependencies.actionOrchestrator.preflight).not.toHaveBeenCalled()
    stop()
  })

  it('fails without fake deltas or Tool execution when Cloud planning is unavailable', async () => {
    const dependencies = createDependencies({ narrativeStreamer: null })
    const stop = registerAgentIpcHandlers(dependencies)
    const sender = { send: vi.fn(), isDestroyed: vi.fn(() => false) }
    const result = await invoke(ipcChannels.executeAgentTurn, input('最近有什么案件？'), sender) as {
      status: string
      assistantMessage: { mode?: string; narrativeStatus?: string; blocks?: unknown[] }
    }
    expect(result).toMatchObject({
      status: 'failed',
      assistantMessage: { mode: 'local-fallback', narrativeStatus: 'failed-local-fallback' }
    })
    expect(result.assistantMessage.blocks).toEqual([])
    expect(dependencies.actionOrchestrator.preflight).not.toHaveBeenCalled()
    const events = sender.send.mock.calls.map((call) => call[1] as { type: string })
    expect(events.some((event) => event.type === 'delta')).toBe(false)
    expect(events.at(-1)?.type).toBe('failed')
    stop()
  })
})

describe('business-text intake gate', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    vi.clearAllMocks()
  })

  const rawMarker = '極秘トークンXYZ123'
  const pastedCaseMessage = [
    `案件概要：金融系Webシステムの保守開発（${rawMarker}）`,
    '作業内容：詳細設計～結合テスト',
    '必須スキル：Java、Spring Boot',
    '単価：～65万円',
    '勤務地：東京'
  ].join('\n')
  const pastedCandidateMessage = [
    `氏名：A.B（${rawMarker}）`,
    '年齢：30代',
    '最寄駅：西船橋',
    '単金：60万',
    '日本語：N1'
  ].join('\n')

  const caseReview = { reviewId: '12121212-1212-4212-8212-121212121212' } as unknown as JobCaseReviewSnapshot
  const candidateReview = {
    documentId: '13131313-1313-4313-8313-131313131313'
  } as unknown as CandidateReviewSnapshot

  function intakeDependencies(dependencies: AgentIpcDependencies, overrides: Partial<BusinessTextIntakeTurnDependencies> = {}): BusinessTextIntakeTurnDependencies {
    return {
      repository: dependencies.repository,
      actionOrchestrator: dependencies.actionOrchestrator,
      locale: () => 'zh-CN',
      operatorId: () => 'operator-1',
      importJobCaseText: vi.fn(async () => ({ review: caseReview, outcome: 'created' as const, validity: 'unknown' as const, attentionReason: null })),
      importCandidateText: vi.fn(async () => ({ review: candidateReview, outcome: 'created' as const, facts: null })),
      ...overrides
    }
  }

  function withRealIntakeExecutor(overrides: Partial<BusinessTextIntakeTurnDependencies> = {}): {
    dependencies: AgentIpcDependencies
    intakeDeps: BusinessTextIntakeTurnDependencies
  } {
    const dependencies = createDependencies()
    const intakeDeps = intakeDependencies(dependencies, overrides)
    dependencies.executeBusinessTextIntake = (useCase, turnInput, decision, turn) =>
      executeBusinessTextIntakeTurn(intakeDeps, useCase, turnInput, decision, turn)
    return { dependencies, intakeDeps }
  }

  it('never sends an intake turn to cloud planning, narration, or direct answers', async () => {
    const { dependencies } = withRealIntakeExecutor()
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input(pastedCaseMessage)) as {
      status: string; toolName: string | null; intake?: { route: string }
    }
    expect(result.status).toBe('completed')
    expect(result.toolName).toBe('business-text.import.local')
    expect(result.intake?.route).toBe('job-case')
    expect(dependencies.narrativeStreamer?.plan).not.toHaveBeenCalled()
    expect(dependencies.narrativeStreamer?.stream).not.toHaveBeenCalled()
    expect(dependencies.narrativeStreamer?.streamAnswer).not.toHaveBeenCalled()

    stop()
  })

  it('keeps forced bulk intake out of planning even when text looks like a normal question', async () => {
    const { dependencies } = withRealIntakeExecutor()
    const stop = registerAgentIpcHandlers(dependencies)
    try {
      await invoke(ipcChannels.executeAgentTurn, { ...input('この情報を整理してください'), intakeOnly: true })
      expect(dependencies.narrativeStreamer?.plan).not.toHaveBeenCalled()
      expect(dependencies.narrativeStreamer?.streamAnswer).not.toHaveBeenCalled()
    } finally { stop() }
  })

  it('fails closed for bulk intake when its intake service is unavailable', async () => {
    const dependencies = createDependencies()
    const stop = registerAgentIpcHandlers(dependencies)
    try {
      await expect(invoke(ipcChannels.executeAgentTurn, { ...input('raw business message'), intakeOnly: true })).rejects.toThrow('业务信息整理服务')
      expect(dependencies.narrativeStreamer?.plan).not.toHaveBeenCalled()
    } finally { stop() }
  })

  it('imports a pasted case locally even when the cloud streamer is unavailable', async () => {
    const { dependencies } = withRealIntakeExecutor()
    dependencies.narrativeStreamer = null
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input(pastedCaseMessage)) as { status: string }
    expect(result.status).toBe('completed')

    stop()
  })

  it('keeps normal queries on the planner path and business text out of it', async () => {
    const executeBusinessTextIntake = vi.fn()
    const dependencies = createDependencies({ executeBusinessTextIntake })
    const stop = registerAgentIpcHandlers(dependencies)

    await invoke(ipcChannels.executeAgentTurn, input('最近有什么 Java 案件？'))
    expect(executeBusinessTextIntake).not.toHaveBeenCalled()
    expect(dependencies.narrativeStreamer?.plan).toHaveBeenCalledTimes(1)

    await invoke(ipcChannels.executeAgentTurn, input('明天10点约田中面试', secondRequestId, { conversationId: secondConversationId }))
    expect(executeBusinessTextIntake).not.toHaveBeenCalled()

    stop()
  })

  it('routes every message to the planner when the intake feature is switched off', async () => {
    const dependencies = createDependencies()
    const stop = registerAgentIpcHandlers(dependencies)

    await invoke(ipcChannels.executeAgentTurn, input(pastedCaseMessage))
    expect(dependencies.narrativeStreamer?.plan).toHaveBeenCalledTimes(1)

    stop()
  })

  it('persists only the safe summary for a successful case import and binds the ActionRun to a digest', async () => {
    const { dependencies, intakeDeps } = withRealIntakeExecutor()
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input(pastedCaseMessage)) as {
      status: string
      conversation: AiConversationSnapshot
    }
    expect(result.status).toBe('completed')
    expect(intakeDeps.importJobCaseText).toHaveBeenCalledWith(pastedCaseMessage, undefined, expect.any(String))

    const serializedConversation = JSON.stringify(result.conversation)
    expect(serializedConversation).not.toContain(rawMarker)
    expect(serializedConversation).not.toContain('金融系Webシステム')
    const userMessage = result.conversation.messages.find((message) => message.role === 'user')
    expect(userMessage?.content).toMatch(/内容摘要 [0-9a-f]{8}/u)
    const navigation = result.conversation.messages.at(-1)?.blocks?.find((block) => block.type === 'system-access')
    expect(navigation).toMatchObject({ destination: 'case-review', reviewId: caseReview.reviewId })

    const preflightCall = vi.mocked(dependencies.actionOrchestrator.preflight).mock.calls[0]
    expect(preflightCall?.[2]).toMatchObject({ kind: 'job-case', contentDigest: expect.stringMatching(/^[0-9a-f]{64}$/u) })
    expect(JSON.stringify(preflightCall)).not.toContain(rawMarker)
    // Created unbound, bound to the persisted turn afterwards.
    expect(preflightCall?.[1]).toMatchObject({ conversationId: null, turnId: null })
    expect(dependencies.repository.linkActionRunToConversation).toHaveBeenCalledTimes(1)
    expect(dependencies.repository.linkActionRunToConversation).toHaveBeenCalledWith(
      'action-1', conversationId, result.conversation.messages.at(-1)?.turnId
    )

    stop()
  })

  it('answers ambiguous text locally without a draft, an ActionRun, or the raw text anywhere', async () => {
    const { dependencies, intakeDeps } = withRealIntakeExecutor()
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input(`案件名：${rawMarker}`)) as {
      status: string
      conversation: AiConversationSnapshot
      intake?: { route: string; restoreComposerText: boolean }
    }
    expect(result.status).toBe('completed')
    expect(result.intake).toMatchObject({ route: 'ambiguous-sensitive', restoreComposerText: true })
    expect(intakeDeps.importJobCaseText).not.toHaveBeenCalled()
    expect(intakeDeps.importCandidateText).not.toHaveBeenCalled()
    expect(dependencies.actionOrchestrator.preflight).not.toHaveBeenCalled()
    expect(dependencies.narrativeStreamer?.plan).not.toHaveBeenCalled()
    expect(JSON.stringify(result.conversation)).not.toContain(rawMarker)

    stop()
  })

  it('persists a candidate import with draft facts and review navigation', async () => {
    const facts = {
      documentId: candidateReview.documentId,
      label: 'TEXT_1313',
      confirmed: false as const,
      reviewStatus: 'awaiting-review' as const,
      fields: [],
      projects: []
    }
    const registerConversationImport = vi.fn()
    const { dependencies } = withRealIntakeExecutor({
      importCandidateText: vi.fn(async () => ({ review: candidateReview, outcome: 'created' as const, facts })),
      registerConversationImport
    })
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input(pastedCandidateMessage)) as {
      status: string
      conversation: AiConversationSnapshot
      intake?: { route: string }
    }
    expect(result.status).toBe('completed')
    expect(result.intake?.route).toBe('candidate')
    const blocks = result.conversation.messages.at(-1)?.blocks ?? []
    expect(blocks.some((block) => block.type === 'candidate-draft-facts')).toBe(true)
    expect(blocks.some((block) => block.type === 'resume-import')).toBe(true)
    expect(blocks.some((block) => block.type === 'system-access' && block.destination === 'review-center')).toBe(true)
    expect(registerConversationImport).toHaveBeenCalledWith(conversationId, candidateReview.documentId)
    expect(JSON.stringify(result.conversation)).not.toContain(rawMarker)

    stop()
  })

  it('keeps the raw text out of the conversation when the local import fails', async () => {
    const { dependencies } = withRealIntakeExecutor({
      importJobCaseText: vi.fn(async () => {
        throw new Error(`parser blew up on ${rawMarker}`)
      })
    })
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input(pastedCaseMessage)) as {
      status: string
      conversation: AiConversationSnapshot
      intake?: { restoreComposerText: boolean }
    }
    expect(result.status).toBe('failed')
    expect(result.intake?.restoreComposerText).toBe(true)
    expect(JSON.stringify(result.conversation)).not.toContain(rawMarker)
    expect(dependencies.repository.updateActionRun).toHaveBeenCalledWith(
      'action-1', 'failed', { errorCode: 'BUSINESS_TEXT_JOB_CASE_IMPORT_FAILED' }
    )
    expect(dependencies.narrativeStreamer?.plan).not.toHaveBeenCalled()

    stop()
  })

  it('segments an unrecognized digest through the redacted cloud lane and imports each record locally', async () => {
    const digestMessage = [
      `📢 来月案件更新（${rawMarker}）`,
      '',
      '♥ 9月～',
      '案件1️⃣：Go｜基本設計～テスト',
      '案件2️⃣：COBOL｜JCL、要件定義～移行',
      '',
      '特記：良い人いれば連絡ください'
    ].join('\n')
    const extractRecordsViaCloud = vi.fn(async () => ({
      kind: 'records' as const,
      records: [
        { kind: 'job-case' as const, startLine: 4, endLine: 4, fields: {} },
        { kind: 'job-case' as const, startLine: 5, endLine: 5, fields: {} }
      ]
    }))
    const { dependencies, intakeDeps } = withRealIntakeExecutor({ extractRecordsViaCloud })
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input(digestMessage)) as {
      status: string
      conversation: AiConversationSnapshot
      intake?: { route: string; reason: string; restoreComposerText: boolean }
    }
    expect(result.status).toBe('completed')
    expect(result.intake).toMatchObject({ route: 'multiple', reason: 'cloud-assisted-extraction', restoreComposerText: false })
    expect(extractRecordsViaCloud).toHaveBeenCalledTimes(1)
    expect(vi.mocked(intakeDeps.importJobCaseText).mock.calls.map((call) => call[0])).toEqual([
      '案件1️⃣：Go｜基本設計～テスト',
      '案件2️⃣：COBOL｜JCL、要件定義～移行'
    ])
    expect(dependencies.actionOrchestrator.preflight).toHaveBeenCalledTimes(2)
    const assistant = result.conversation.messages.at(-1)
    // Every segment run belongs to this one turn, not only the first.
    expect(dependencies.repository.linkActionRunToConversation).toHaveBeenCalledTimes(2)
    expect(dependencies.repository.linkActionRunToConversation).toHaveBeenCalledWith('action-1', conversationId, assistant?.turnId)
    expect(dependencies.repository.linkActionRunToConversation).toHaveBeenCalledWith('action-2', conversationId, assistant?.turnId)
    expect(assistant?.content).toContain('2 条业务记录')
    // The paste becomes cards the operator can continue from, plus a batch
    // deep-link and a state pointer so "第2条" resolves on later turns.
    const cardsBlock = assistant?.blocks?.find((block) => block.type === 'job-case-draft-cards')
    expect(cardsBlock).toMatchObject({
      type: 'job-case-draft-cards',
      cards: [
        { label: 'DRAFT_1', ordinal: 1, outcome: 'created', reviewId: caseReview.reviewId, title: 'Java 案件', reviewStatus: 'awaiting-review', jobCase: null, status: 'current' },
        { label: 'DRAFT_2', ordinal: 2, outcome: 'created' }
      ]
    })
    const intakeBatchId = (cardsBlock as { intakeBatchId: string }).intakeBatchId
    expect(assistant?.blocks?.find((block) => block.type === 'system-access')).toMatchObject({
      destination: 'review-center', intakeBatchId, reviewIds: [caseReview.reviewId, caseReview.reviewId]
    })
    expect(result.conversation.salesAgentState?.lastIntakeBatch).toEqual({
      intakeBatchId, messageId: assistant?.id, reviewIds: [caseReview.reviewId, caseReview.reviewId]
    })
    expect(JSON.stringify(cardsBlock)).not.toContain('redactedSubject')
    expect(intakeDeps.importJobCaseText).toHaveBeenLastCalledWith(expect.any(String), expect.any(Object), intakeBatchId)
    expect(assistant?.blocks?.some((block) => block.type === 'system-access' && block.destination === 'review-center')).toBe(true)
    expect(JSON.stringify(result.conversation)).not.toContain(rawMarker)
    expect(dependencies.narrativeStreamer?.plan).not.toHaveBeenCalled()
    expect(dependencies.narrativeStreamer?.stream).not.toHaveBeenCalled()
    expect(dependencies.narrativeStreamer?.streamAnswer).not.toHaveBeenCalled()

    stop()
  })

  it('imports a single cloud-classified record with the same navigation as the local path', async () => {
    const shorthand = '案件1️⃣：Java｜基本設計～テスト、日本語流暢'
    const extractRecordsViaCloud = vi.fn(async () => ({
      kind: 'records' as const,
      records: [{ kind: 'job-case' as const, startLine: 1, endLine: 1, fields: {} }]
    }))
    const { dependencies, intakeDeps } = withRealIntakeExecutor({ extractRecordsViaCloud })
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input(shorthand)) as {
      status: string
      conversation: AiConversationSnapshot
    }
    expect(result.status).toBe('completed')
    expect(intakeDeps.importJobCaseText).toHaveBeenCalledWith(shorthand, {}, expect.any(String))
    const assistant = result.conversation.messages.at(-1)
    expect(assistant?.content).toContain('已通过脱敏云端判定为案件')
    expect(assistant?.blocks?.find((block) => block.type === 'system-access')).toMatchObject({
      destination: 'case-review', reviewId: caseReview.reviewId
    })

    stop()
  })

  it('falls back to the local guidance when the redacted lane is blocked or unusable', async () => {
    const blocked = vi.fn(async () => {
      throw new Error('Agent Cloud 证据未通过本地 DLP，已阻止发送。')
    })
    const first = withRealIntakeExecutor({ extractRecordsViaCloud: blocked })
    let stop = registerAgentIpcHandlers(first.dependencies)
    const digestMessage = ['案件1️⃣：Go｜設計', '案件2️⃣：PHP｜開発'].join('\n')

    const fallback = await invoke(ipcChannels.executeAgentTurn, input(digestMessage)) as {
      status: string
      conversation: AiConversationSnapshot
      intake?: { restoreComposerText: boolean }
    }
    expect(fallback.status).toBe('completed')
    expect(fallback.intake?.restoreComposerText).toBe(true)
    expect(first.intakeDeps.importJobCaseText).not.toHaveBeenCalled()
    expect(fallback.conversation.messages.at(-1)?.content).toContain('拆分')
    stop()

    const unusable = vi.fn(async () => ({ kind: 'unusable' as const }))
    const second = withRealIntakeExecutor({ extractRecordsViaCloud: unusable })
    stop = registerAgentIpcHandlers(second.dependencies)
    const ambiguousMessage = ['項目A：値1', '項目B：値2', '項目C：値3'].join('\n')
    const guidance = await invoke(ipcChannels.executeAgentTurn, input(ambiguousMessage, secondRequestId, { conversationId: secondConversationId })) as {
      status: string
      conversation: AiConversationSnapshot
      intake?: { restoreComposerText: boolean }
    }
    expect(guidance.intake?.restoreComposerText).toBe(true)
    expect(guidance.conversation.messages.at(-1)?.content).toContain('【案件】')
    stop()
  })

  it('fails the cloud-lane turn without raw text when every segment import fails', async () => {
    const digestMessage = [`案件1️⃣：Go｜設計（${rawMarker}）`, '案件2️⃣：PHP｜開発'].join('\n')
    const { dependencies } = withRealIntakeExecutor({
      extractRecordsViaCloud: vi.fn(async () => ({
        kind: 'records' as const,
        records: [
          { kind: 'job-case' as const, startLine: 1, endLine: 1, fields: {} },
          { kind: 'job-case' as const, startLine: 2, endLine: 2, fields: {} }
        ]
      })),
      importJobCaseText: vi.fn(async () => {
        throw new Error(`segment import blew up on ${rawMarker}`)
      })
    })
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input(digestMessage)) as {
      status: string
      conversation: AiConversationSnapshot
      intake?: { restoreComposerText: boolean }
    }
    expect(result.status).toBe('failed')
    expect(result.intake?.restoreComposerText).toBe(true)
    expect(JSON.stringify(result.conversation)).not.toContain(rawMarker)
    expect(dependencies.repository.updateActionRun).toHaveBeenCalledWith(
      'action-1', 'failed', { errorCode: 'BUSINESS_TEXT_JOB_CASE_IMPORT_FAILED' }
    )

    stop()
  })

  it('returns duplicate submissions to the existing review without a second draft', async () => {
    const { dependencies, intakeDeps } = withRealIntakeExecutor({
      importJobCaseText: vi.fn(async () => ({ review: caseReview, outcome: 'existing-review' as const, validity: 'unknown' as const, attentionReason: null }))
    })
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input(pastedCaseMessage)) as {
      status: string
      conversation: AiConversationSnapshot
    }
    expect(result.status).toBe('completed')
    expect(intakeDeps.importJobCaseText).toHaveBeenCalledTimes(1)
    expect(result.conversation.messages.at(-1)?.content).toContain('未重复创建')

    stop()
  })

  it('binds a paste into an existing conversation to its own turn', async () => {
    const { dependencies } = withRealIntakeExecutor()
    const stop = registerAgentIpcHandlers(dependencies)

    const first = await invoke(ipcChannels.executeAgentTurn, input(pastedCaseMessage)) as {
      status: string
      conversation: AiConversationSnapshot
    }
    expect(first.status).toBe('completed')

    // The conversation exists now. The run must still start unbound and end
    // bound to the second turn - a run created with the conversation but no
    // turn can never be completed by the store.
    const second = await invoke(ipcChannels.executeAgentTurn, input(
      pastedCandidateMessage, secondRequestId, { expectedConversationRevision: first.conversation.revision }
    )) as { status: string; actionRunId: string | null; conversation: AiConversationSnapshot }
    expect(second.status).toBe('completed')
    expect(second.actionRunId).toBe('action-2')
    const secondTurnId = second.conversation.messages.at(-1)?.turnId
    expect(secondTurnId).toBeTruthy()
    expect(secondTurnId).not.toBe(first.conversation.messages.at(-1)?.turnId)
    expect(dependencies.repository.linkActionRunToConversation).toHaveBeenCalledWith('action-2', conversationId, secondTurnId)
    const contexts = vi.mocked(dependencies.actionOrchestrator.preflight).mock.calls.map((call) => call[1])
    expect(contexts).toEqual([
      expect.objectContaining({ conversationId: null, turnId: null }),
      expect.objectContaining({ conversationId: null, turnId: null })
    ])

    stop()
  })

  it('gives a re-pasted text in the same conversation its own ActionRun', async () => {
    const { dependencies, intakeDeps } = withRealIntakeExecutor()
    const stop = registerAgentIpcHandlers(dependencies)

    const first = await invoke(ipcChannels.executeAgentTurn, input(pastedCaseMessage)) as {
      status: string
      conversation: AiConversationSnapshot
    }
    const second = await invoke(ipcChannels.executeAgentTurn, input(
      pastedCaseMessage, secondRequestId, { expectedConversationRevision: first.conversation.revision }
    )) as { status: string; actionRunId: string | null }
    expect(first.status).toBe('completed')
    expect(second.status).toBe('completed')
    expect(second.actionRunId).toBe('action-2')
    expect(intakeDeps.importJobCaseText).toHaveBeenCalledTimes(2)
    // Per-turn keys: the retry the failure message asks for must not collide
    // with the run already bound to the earlier turn.
    const keys = vi.mocked(dependencies.actionOrchestrator.preflight).mock.calls.map((call) => call[4])
    expect(keys[0]).toMatch(/^[0-9a-f]{64}$/u)
    expect(keys[1]).not.toBe(keys[0])
    expect(dependencies.repository.linkActionRunToConversation).toHaveBeenCalledTimes(2)

    stop()
  })

  it('extracts fields through the redacted cloud lane for a decisive case paste and hands them to the local importer', async () => {
    const extractRecordsViaCloud = vi.fn(async () => ({
      kind: 'records' as const,
      records: [{ kind: 'job-case' as const, startLine: 1, endLine: 5, fields: { rate: '～65万円', location: '東京' } }]
    }))
    const { dependencies, intakeDeps } = withRealIntakeExecutor({ extractRecordsViaCloud })
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input(pastedCaseMessage)) as {
      status: string
      conversation: AiConversationSnapshot
      intake?: { route: string; reason: string; restoreComposerText: boolean }
    }
    expect(result.status).toBe('completed')
    expect(extractRecordsViaCloud).toHaveBeenCalledTimes(1)
    expect(intakeDeps.importJobCaseText).toHaveBeenCalledWith(pastedCaseMessage, { rate: '～65万円', location: '東京' }, expect.any(String))
    expect(result.intake).toMatchObject({ route: 'job-case', reason: 'cloud-assisted-extraction', restoreComposerText: false })
    const assistant = result.conversation.messages.at(-1)
    expect(assistant?.content).toContain('逐项核验')
    // The type came from the local rules, not from the lane.
    expect(assistant?.content).not.toContain('已通过脱敏云端判定')
    expect(assistant?.blocks?.find((block) => block.type === 'system-access')).toMatchObject({
      destination: 'case-review', reviewId: caseReview.reviewId
    })
    expect(JSON.stringify(result.conversation)).not.toContain(rawMarker)

    stop()
  })

  it('keeps the local classifier as the final judge: a cloud type disagreement or a lane failure falls back to the local importer', async () => {
    const disagreeing = withRealIntakeExecutor({
      extractRecordsViaCloud: vi.fn(async () => ({
        kind: 'records' as const,
        records: [{ kind: 'candidate' as const, startLine: 1, endLine: 5, fields: { skills: 'Java' } }]
      }))
    })
    let stop = registerAgentIpcHandlers(disagreeing.dependencies)
    const first = await invoke(ipcChannels.executeAgentTurn, input(pastedCaseMessage)) as {
      status: string
      conversation: AiConversationSnapshot
    }
    expect(first.status).toBe('completed')
    expect(disagreeing.intakeDeps.importJobCaseText).toHaveBeenCalledWith(pastedCaseMessage, undefined, expect.any(String))
    expect(disagreeing.intakeDeps.importCandidateText).not.toHaveBeenCalled()
    expect(first.conversation.messages.at(-1)?.content).toContain('未调用云端')
    stop()

    const failing = withRealIntakeExecutor({
      extractRecordsViaCloud: vi.fn(async () => {
        throw new Error('Agent Cloud 证据未通过本地 DLP，已阻止发送。')
      })
    })
    stop = registerAgentIpcHandlers(failing.dependencies)
    const second = await invoke(ipcChannels.executeAgentTurn, input(pastedCaseMessage)) as { status: string }
    expect(second.status).toBe('completed')
    expect(failing.intakeDeps.importJobCaseText).toHaveBeenCalledTimes(1)
    stop()
  })

  it('reads the drafts of the latest paste through job-case.draft.read.local with their live review state', async () => {
    const firstReviewId = '12121212-1212-4212-8212-121212121201'
    const secondReviewId = '12121212-1212-4212-8212-121212121202'
    const intakeBatchId = '12121212-1212-4212-8212-121212121203'
    const initialConversation: AiConversationSnapshot = {
      id: conversationId,
      context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
      title: '案件取込',
      messages: [{
        id: 'intake-cards', role: 'assistant', content: '已导入 2 条案件草稿。', mode: 'local', createdAt: '2026-08-25T00:00:00.000Z',
        blocks: [{
          type: 'job-case-draft-cards', intakeBatchId,
          cards: [firstReviewId, secondReviewId].map((reviewId, index) => ({
            ...agentJobCaseDraftFacts(jobCaseReviewFixture(reviewId), `DRAFT_${index + 1}`), ordinal: index + 1, outcome: 'created' as const
          }))
        }]
      }],
      salesAgentState: {
        selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null,
        lastIntakeBatch: { intakeBatchId, messageId: 'intake-cards', reviewIds: [firstReviewId, secondReviewId] }
      },
      revision: 1,
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z'
    }
    const dependencies = createDependencies({ initialConversation })
    vi.mocked(dependencies.narrativeStreamer!.plan).mockResolvedValue({
      kind: 'tool', action: { toolName: 'job-case.draft.read.local', arguments: { draftOrdinal: null } }
    })
    // The second draft was confirmed in the Review Center after the paste.
    vi.mocked(dependencies.repository.getAgentJobCaseDraftFacts).mockImplementation((reviewId: string, label: string) =>
      agentJobCaseDraftFacts(jobCaseReviewFixture(reviewId, reviewId === secondReviewId
        ? {
            status: 'completed',
            jobCase: { id: jobCaseId, sourceReviewId: secondReviewId, version: 1, status: 'active', confirmedAt: '2026-08-25T01:00:00.000Z', confirmedBy: 'SES', containsDirectIdentifiers: false }
          }
        : {}), label))
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input('这几条里哪些缺单价？', secondRequestId, { expectedConversationRevision: 1 })) as {
      status: string
      toolName: string | null
      conversation: AiConversationSnapshot
    }
    expect(result.status).toBe('completed')
    expect(result.toolName).toBe('job-case.draft.read.local')
    expect(dependencies.actionOrchestrator.preflight).toHaveBeenCalledWith(
      'job-case.draft.read.local',
      expect.objectContaining({ scopeId: 'conversation-intake-drafts' }),
      { reviewIds: [firstReviewId, secondReviewId] },
      expect.any(String),
      expect.any(String)
    )
    const block = result.conversation.messages.at(-1)?.blocks?.find((item) => item.type === 'job-case-draft-cards')
    expect(block).toMatchObject({
      intakeBatchId,
      cards: [
        { label: 'DRAFT_1', ordinal: 1, reviewStatus: 'awaiting-review', jobCase: null },
        { label: 'DRAFT_2', ordinal: 2, reviewStatus: 'completed', jobCase: { id: jobCaseId, version: 1 } }
      ]
    })
    expect(dependencies.narrativeStreamer?.stream).toHaveBeenCalledTimes(1)
    stop()
  })
})

describe('agent case broadcast tools', () => {
  beforeEach(() => {
    electronMock.handlers.clear()
    vi.clearAllMocks()
  })

  const broadcastCardsOf = (result: { conversation: AiConversationSnapshot }) => {
    const block = result.conversation.messages.at(-1)?.blocks?.find((item) => item.type === 'job-case-broadcast-cards')
    if (block?.type !== 'job-case-broadcast-cards') throw new Error('broadcast block missing')
    return block
  }

  const copyFixture = (review: JobCaseReviewSnapshot, jobCaseVersion: number): CaseBroadcastCopy => ({
    id: '15151515-1515-4515-8515-151515151501',
    reviewId: review.reviewId,
    jobCaseId: review.jobCase!.id,
    jobCaseVersion,
    templateId: builtInBroadcastTemplate().id,
    templateRevision: 1,
    lang: 'zh',
    kind: 'new',
    text: '【案件】Java 案件 1',
    textSha256: 'a'.repeat(64),
    actorId: 'operator-1',
    createdAt: '2026-08-25T02:00:00.000Z'
  })

  it('drafts at most eight messages, names no destination, and reports the queue beside them', async () => {
    const reviews = Array.from({ length: 10 }, (_unused, index) => sendableReviewFixture(index + 1))
    const dependencies = createDependencies({ jobCaseReviews: reviews })
    vi.mocked(dependencies.narrativeStreamer!.plan).mockResolvedValue({
      kind: 'tool', action: { toolName: 'job-case.broadcast.draft.local', arguments: { target: 'new-cases', ordinal: null } }
    })
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input('把今天的新案件整理成群消息')) as {
      status: string
      toolName: string | null
      assistantMessage: { turnId?: string | null }
      conversation: AiConversationSnapshot
    }

    expect(result.status).toBe('completed')
    expect(result.toolName).toBe('job-case.broadcast.draft.local')
    const block = broadcastCardsOf(result)
    expect(block.cards).toHaveLength(8)
    expect(block.queue).toEqual({ new: 10, copied: 0, attention: 0 })
    expect(block.cards.map((card) => card.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(block.cards[0]).toMatchObject({ status: 'new', templateRevision: 1, forbiddenJa: [], forbiddenZh: [] })
    // A card cannot name a destination, because this device has none to name.
    expect(block.cards[0]).not.toHaveProperty('recommendedGroups')
    // Both language versions are generated locally from the confirmed case.
    expect(block.cards[0]!.textJa).toContain('【案件】')
    expect(block.cards[0]!.textZh).toContain('必须：Java')
    // The chain and the payment terms never reach a group message.
    expect(block.cards[0]!.textJa).not.toContain('弊社→元請')
    expect(dependencies.actionOrchestrator.preflight).toHaveBeenCalledWith(
      'job-case.broadcast.draft.local',
      expect.objectContaining({ scopeId: 'broadcast-queue' }),
      { reviewIds: block.cards.map((card) => card.reviewId) },
      expect.any(String),
      expect.any(String)
    )
    expect(dependencies.repository.linkActionRunToConversation).toHaveBeenCalledWith(
      expect.any(String), conversationId, result.assistantMessage.turnId
    )
    // The local text is authoritative; the cloud only retells the counts.
    const streamed = vi.mocked(dependencies.narrativeStreamer!.stream).mock.calls[0]![0]
    expect(streamed.assistantMessage.content).toContain('群メッセージを8件作成しました')
    expect(streamed.assistantMessage.content).toContain('対象10件のうち先頭8件です。')
    // Nothing in the receipt may suggest the app knows a message was sent.
    expect(streamed.assistantMessage.content).not.toContain('已発')
    expect(streamed.assistantMessage.content).not.toContain('送信済み')
    stop()
  })

  it('says there is nothing to copy and still reports the queue when the queue is clear', async () => {
    const dependencies = createDependencies({ jobCaseReviews: [] })
    vi.mocked(dependencies.narrativeStreamer!.plan).mockResolvedValue({
      kind: 'tool', action: { toolName: 'job-case.broadcast.draft.local', arguments: { target: 'uncopied-cases', ordinal: null } }
    })
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input('今天还有哪些没发')) as {
      status: string
      toolName: string | null
      conversation: AiConversationSnapshot
    }

    expect(result.status).toBe('completed')
    expect(result.toolName).toBeNull()
    expect(result.conversation.messages.at(-1)?.content).toContain('いまコピーする案件はありません（新着0件')
    expect(dependencies.actionOrchestrator.preflight).not.toHaveBeenCalled()
    stop()
  })

  it('reads 未コピー as new plus what changed since its last copy, and leaves the rest alone', async () => {
    const [fresh, copied, revised] = [1, 2, 3].map((index) => sendableReviewFixture(index))
    const revisedNow: JobCaseReviewSnapshot = {
      ...revised,
      jobCase: { ...revised.jobCase!, version: 2 }
    }
    const dependencies = createDependencies({
      jobCaseReviews: [fresh, copied, revisedNow],
      caseBroadcastCopies: [copyFixture(copied, 1), { ...copyFixture(revisedNow, 1), id: '15151515-1515-4515-8515-151515151502' }]
    })
    vi.mocked(dependencies.narrativeStreamer!.plan).mockResolvedValue({
      kind: 'tool', action: { toolName: 'job-case.broadcast.draft.local', arguments: { target: 'uncopied-cases', ordinal: null } }
    })
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input('今天还有哪些没发')) as {
      conversation: AiConversationSnapshot
    }

    const block = broadcastCardsOf(result)
    expect(block.queue).toEqual({ new: 1, copied: 2, attention: 0 })
    // The already-copied, unchanged case is finished and is not drafted again.
    expect(block.cards.map((card) => card.reviewId).toSorted())
      .toEqual([fresh.reviewId, revisedNow.reviewId].toSorted())
    stop()
  })

  it('refuses a case nobody confirmed rather than drafting from an unreviewed draft', async () => {
    const pending = jobCaseReviewFixture('12121212-1212-4212-8212-121212121399')
    const dependencies = createDependencies({ jobCaseReviews: [pending] })
    vi.mocked(dependencies.narrativeStreamer!.plan).mockResolvedValue({
      kind: 'tool', action: { toolName: 'job-case.broadcast.draft.local', arguments: { target: 'case', ordinal: null } }
    })
    const stop = registerAgentIpcHandlers(dependencies)

    const result = await invoke(ipcChannels.executeAgentTurn, input('把这个案件整理成群消息')) as {
      status: string
      conversation: AiConversationSnapshot
    }

    expect(result.status).toBe('clarifying')
    expect(dependencies.actionOrchestrator.preflight).not.toHaveBeenCalled()
    stop()
  })
})
