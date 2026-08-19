import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import {
  ipcChannels,
  type AiConversationSnapshot,
  type CandidateMatchTaskExecutionResult,
  type ExecuteAgentTurnInput,
  type SaveAiConversationInput
} from '@shared'
import type { ActionOrchestrator } from '@action-runtime'
import type { EncryptedApplicationRepository } from '@persistence'
import type { MatchRuntimeIdentity } from '@matching'
import type { AiCommerceResponsesStreamResult } from '@aicommerce'
import type { AgentNarrativeStreamer } from './agent-cloud-narrative'
import { registerAgentIpcHandlers, type AgentIpcDependencies } from './agent-ipc'

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
  selectedJobCaseRef?: ExecuteAgentTurnInput['selectedJobCaseRef']
} = {}): ExecuteAgentTurnInput {
  return {
    conversationId: options.conversationId ?? conversationId,
    message,
    expectedConversationRevision: options.expectedConversationRevision ?? null,
    requestId: id,
    selectedJobCaseRef: options.selectedJobCaseRef ?? null
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
} = {}): AgentIpcDependencies {
  const conversations = new Map<string, AiConversationSnapshot>(options.initialConversation ? [[options.initialConversation.id, options.initialConversation]] : [])
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
    linkActionRunToConversation: vi.fn((_actionRunId: string, conversationId: string) => {
      if (!conversations.has(conversationId)) throw new Error('conversation must be saved before ActionRun linking')
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
    }))
  } as unknown as EncryptedApplicationRepository
  const actionOrchestrator = {
    preflight: vi.fn((_toolName, _context, rawInput) => ({
      actionRunId: 'action-1',
      input: rawInput,
      decision: { outcome: 'allow' as const }
    }))
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
    runResumeAnalysisTask: vi.fn().mockResolvedValue({ name: 'candidate.pdf', format: 'pdf' }),
    cancelMatchTask: options.cancelMatchTask ?? vi.fn(),
    narrativeStreamer: options.narrativeStreamer === undefined ? defaultNarrativeStreamer : options.narrativeStreamer
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
      assistantMessage: { content: 'AI 无法形成有效的受控 Tool 计划，请重试。' }
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
