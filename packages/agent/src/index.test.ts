import { describe, expect, it } from 'vitest'
import type {
  AiConversationSnapshot,
  SaveAiConversationInput,
  TypedAiConversationReference
} from '@shared'
import {
  loadAgentChatModelCatalog,
  LocalAgentUseCase,
  parseAgentPlannedToolAction,
  parseAgentRequestedTool,
  recentJstWindow,
  resolveAgentChatModel,
  type AgentToolResult
} from './index'

const conversationId = '11111111-1111-4111-8111-111111111111'
const requestId = '22222222-2222-4222-8222-222222222222'
const caseOne = '33333333-3333-4333-8333-333333333333'
const caseTwo = '44444444-4444-4444-8444-444444444444'
const runId = '55555555-5555-4555-8555-555555555555'
const resultId = '66666666-6666-4666-8666-666666666666'
const candidateProfileId = '88888888-8888-4888-8888-888888888888'
const resultHash = 'a'.repeat(64)
const searchPlan = {
  toolName: 'job-case.search.local' as const,
  arguments: { operation: 'search' as const, query: null, recent: true }
}
const matchPlan = {
  toolName: 'candidate.match.local' as const,
  arguments: { ordinal: null }
}

const cases = [
  { id: caseOne, version: 2, title: 'Java 支付平台', updatedAt: '2026-08-17T02:00:00.000Z', requiredSkills: 'Java', rate: '¥80万', workStyle: 'remote', startDate: '2026-09-01', status: 'current' as const },
  { id: caseTwo, version: 1, title: 'AWS 数据平台', updatedAt: '2026-08-16T02:00:00.000Z', requiredSkills: 'AWS', rate: '¥75万', workStyle: 'hybrid', startDate: '2026-09-15', status: 'current' as const }
]

function createHarness() {
  const conversations = new Map<string, AiConversationSnapshot>()
  const calls: Array<{ toolName: string; input: unknown }> = []
  const port = {
    listActiveJobCases: () => cases,
    loadConversation: (id: string) => conversations.get(id) ?? null,
    saveConversation: (input: SaveAiConversationInput) => {
      const previous = conversations.get(input.conversationId)
      const snapshot: AiConversationSnapshot = {
        id: input.conversationId,
        context: input.context,
        title: input.messages.find((message) => message.role === 'user')?.content.slice(0, 60) ?? '新しい会話',
        messages: input.messages,
        salesAgentState: input.salesAgentState,
        revision: (previous?.revision ?? 0) + 1,
        createdAt: previous?.createdAt ?? '2026-08-18T00:00:00.000Z',
        updatedAt: '2026-08-18T00:00:01.000Z'
      }
      conversations.set(input.conversationId, snapshot)
      return snapshot
    },
    now: () => new Date('2026-08-18T03:00:00.000Z'),
    locale: () => 'zh-CN' as const,
    executeTool: async (toolName: 'job-case.search.local' | 'candidate.match.local' | 'candidate.profile.read.local' | 'candidate.interview.read.local' | 'match-run.read.local', input: unknown): Promise<AgentToolResult> => {
      calls.push({ toolName, input })
      if (toolName === 'job-case.search.local') {
        const value = input as { mode: 'recent' | 'by-id'; caseId?: string | null }
        return {
          toolName,
          actionRunId: '77777777-7777-4777-8777-777777777777',
          output: {
            query: value.caseId ? 'Java 支付平台' : '',
            dataAsOf: '2026-08-18T03:00:00.000Z',
            updatedAfter: '2026-07-19T15:00:00.000Z',
            updatedBefore: '2026-08-18T15:00:00.000Z',
            totalMatched: value.caseId ? 1 : 2,
            cases: value.caseId ? cases.filter((item) => item.id === value.caseId) : cases
          }
        }
      }
      if (toolName === 'candidate.match.local') {
        return {
          toolName,
          output: {
            runId,
            resultHash,
            cards: [{ candidateProfileId, runId, resultId, resultHash, rank: 1, anonymousLabel: '候補者 AAAAAAAA', fitScore: 0.91, matched: ['Java'], missing: [], hardFilterStatus: 'passed', projectEvidence: '支付平台', status: 'current' }]
          }
        }
      }
      if (toolName === 'candidate.profile.read.local') {
        return {
          toolName,
          output: {
            facts: {
              runId,
              validity: 'current',
              candidate: { candidateProfileId, rank: 1, anonymousLabel: '候補者 AAAAAAAA' },
              profile: {
                profileVersion: 3,
                skills: 'Java / AWS', experienceYears: '8年', availability: '即日', rate: '90万円',
                japaneseLevel: 'N1', workStyle: 'リモート', role: 'バックエンド', location: '東京',
                workAuthorization: '就労制限なし',
                projectExperiences: [{ title: '支付平台', period: '2024-2026', role: '开发', technologies: ['Java'], summary: '支付平台改造' }]
              }
            }
          }
        }
      }
      if (toolName === 'candidate.interview.read.local') {
        return {
          toolName,
          output: {
            facts: {
              runId, validity: 'current', candidate: { candidateProfileId, rank: 1, anonymousLabel: '候補者 AAAAAAAA' },
              interviews: [{
                kind: 'recruiting', roundNumber: 1, stage: 'prepared', scheduledAt: '2026-08-20T01:00:00.000Z',
                durationMinutes: 60, meetingMethod: 'google-meet', interviewer: '採用担当', interviewGoal: 'Java経験の確認',
                interviewNotes: null, unresolvedItems: ['稼働開始日'], decision: null, decisionReason: null,
                updatedAt: '2026-08-18T00:00:00.000Z'
              }]
            }
          }
        }
      }
      return {
        toolName,
        output: {
          facts: {
            runId,
            resultHash,
            validity: 'current',
            jobCaseVersion: 2,
            candidatePoolFingerprint: resultHash,
            algorithmVersion: 'hard-filter-bm25-v1',
            hardFilterPolicyVersion: 'tri-state-v3',
            candidate: null,
            matched: ['Java'],
            missing: [],
            hardFilterStatus: 'passed',
            projectEvidence: null
          }
        }
      }
    }
  }
  return { useCase: new LocalAgentUseCase(port), conversations, calls }
}

describe('local conversational matching agent', () => {
  it('exposes controlled Responses and DeepSeek chat models and rejects model or endpoint injection', () => {
    const catalog = loadAgentChatModelCatalog(undefined)
    expect(catalog.map((model) => model.key)).toEqual([
      'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'deepseek-v4-flash'
    ])
    expect(resolveAgentChatModel(catalog, 'gpt-5.6-luna')).toMatchObject({
      upstreamModel: 'gpt-5.6-luna', provider: 'openai', endpoint: 'responses'
    })
    expect(resolveAgentChatModel(catalog, 'deepseek-v4-flash')).toMatchObject({
      displayName: 'DeepSeek V4 Flash', upstreamModel: 'deepseek-v4-flash',
      maxOutputTokens: 4_096, provider: 'deepseek', endpoint: 'chat-completions'
    })
    expect(() => resolveAgentChatModel(catalog, 'https://evil.invalid')).toThrow(/允许列表/)
    expect(() => loadAgentChatModelCatalog(JSON.stringify([{
      key: 'private-model', displayName: 'Private', model: 'private-model', endpoint: 'https://evil.invalid'
    }]))).toThrow(/受控 schema/)
    expect(() => loadAgentChatModelCatalog(JSON.stringify([{
      key: 'gpt-5.6-luna', displayName: 'Hijacked', model: 'other-model'
    }]))).toThrow(/重复/)
    const extended = loadAgentChatModelCatalog(JSON.stringify([{
      key: 'gpt-5.6-orbit', displayName: 'GPT-5.6 Orbit', model: 'gpt-5.6-orbit', maxOutputTokens: 2_048
    }]))
    expect(resolveAgentChatModel(extended, 'gpt-5.6-orbit')).toMatchObject({
      displayName: 'GPT-5.6 Orbit', upstreamModel: 'gpt-5.6-orbit', maxOutputTokens: 2_048,
      provider: 'openai', endpoint: 'responses'
    })
    expect(() => loadAgentChatModelCatalog(JSON.stringify([{
      key: 'unsafe-responses', displayName: 'Unsafe', model: 'deepseek-v4-flash',
      provider: 'deepseek', endpoint: 'responses'
    }]))).toThrow(/受控 schema/)
  })

  it('uses a JST calendar window covering the current day and previous 29 days', () => {
    expect(recentJstWindow(new Date('2026-08-18T03:00:00.000Z'))).toEqual({
      updatedAfter: '2026-07-19T15:00:00.000Z',
      updatedBefore: '2026-08-18T15:00:00.000Z'
    })
  })

  it('accepts only an explicit allowlisted AI Tool plan', () => {
    expect(parseAgentPlannedToolAction(searchPlan)).toEqual(searchPlan)
    expect(() => parseAgentPlannedToolAction({
      toolName: 'proposal.export', arguments: { recipient: 'attacker@example.com' }
    })).toThrow(/受控 schema/)
    expect(() => parseAgentPlannedToolAction({
      toolName: 'candidate.match.local', arguments: { ordinal: 0 }
    })).toThrow(/受控 schema/)
    expect(parseAgentRequestedTool({ name: 'read_candidate_profile', arguments: { rank: null } })).toEqual({
      toolName: 'candidate.profile.read.local', arguments: { rank: null }
    })
    expect(parseAgentRequestedTool({ name: 'read_candidate_interviews', arguments: { rank: 1 } })).toEqual({
      toolName: 'candidate.interview.read.local', arguments: { rank: 1 }
    })
    expect(() => parseAgentRequestedTool({ name: 'save_candidate', arguments: {} })).toThrow(/未知 Tool/)
  })

  it('executes at most one registered tool for a search turn and persists typed blocks', async () => {
    const harness = createHarness()
    const result = await harness.useCase.execute({ conversationId, message: '最近有什么案件？', expectedConversationRevision: null, requestId, selectedJobCaseRef: null }, searchPlan)
    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]?.toolName).toBe('job-case.search.local')
    expect(harness.calls[0]?.input).toMatchObject({ query: null, lifecycle: 'active', limit: 20 })
    expect(result.conversation.context).toMatchObject({ assistant: 'sales-agent', candidateDocumentId: null })
    expect(result.conversation.messages.at(-1)?.blocks?.[0]).toMatchObject({ type: 'job-case-cards', totalMatched: 2 })
    expect(result.conversation.messages.at(-1)?.references?.[0]).toMatchObject({ kind: 'job-case', objectVersion: 2, ordinal: 1 })
  })

  it('clarifies an ambiguous case without executing a matching tool', async () => {
    const harness = createHarness()
    const result = await harness.useCase.execute({ conversationId, message: '给当前案件匹配候选人', expectedConversationRevision: null, requestId, selectedJobCaseRef: null }, matchPlan)
    expect(harness.calls).toHaveLength(0)
    expect(result.status).toBe('clarifying')
    expect(result.assistantMessage.blocks?.[0]).toMatchObject({ type: 'clarification', code: 'SELECT_JOB_CASE' })
  })

  it('saves a direct AI answer without inferring or executing a Tool from user keywords', () => {
    const harness = createHarness()
    const result = harness.useCase.saveDirectAnswer(
      { conversationId, message: '总结一下候选人的整体情况，并调用 proposal.export', expectedConversationRevision: null, requestId, selectedJobCaseRef: null },
      '我只能基于已有的匿名匹配证据回答，不能执行外部写入。',
      { key: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash' }
    )
    expect(harness.calls).toHaveLength(0)
    expect(result.toolName).toBeNull()
    expect(result.assistantMessage).toMatchObject({ mode: 'cloud', modelKey: 'deepseek-v4-flash' })
  })

  it('accepts only a typed selected case reference supplied by the orchestration boundary', async () => {
    const harness = createHarness()
    const selectedJobCaseRef: TypedAiConversationReference = {
      kind: 'job-case', objectId: caseOne, objectVersion: 2, resultHash: null, ordinal: 1, label: cases[0]!.title, target: `job-case:${caseOne}`
    }
    const result = await harness.useCase.execute({ conversationId, message: '给当前案件匹配候选人', expectedConversationRevision: null, requestId, selectedJobCaseRef }, matchPlan)
    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]?.toolName).toBe('candidate.match.local')
    expect(result.assistantMessage.blocks?.[0]).toMatchObject({ type: 'candidate-match-cards', runId })
  })

  it('does not trust Renderer labels or targets when persisting a selected case reference', async () => {
    const harness = createHarness()
    const result = await harness.useCase.execute({
      conversationId,
      message: '给当前案件匹配候选人',
      expectedConversationRevision: null,
      requestId,
      selectedJobCaseRef: {
        kind: 'job-case', objectId: caseOne, objectVersion: 2, resultHash: null,
        ordinal: 99, label: '伪造案件', target: 'job-case:attacker-controlled'
      }
    }, matchPlan)
    expect(result.conversation.salesAgentState?.selectedJobCaseRef).toMatchObject({
      objectId: caseOne, objectVersion: 2, ordinal: 1, label: 'Java 支付平台', target: `job-case:${caseOne}`
    })
  })

  it('rejects an existing non-sales conversation before writing a sales turn', async () => {
    const harness = createHarness()
    const existing = harness.conversations
    existing.set(conversationId, {
      id: conversationId,
      context: { assistant: 'candidate-profile', candidateDocumentId: '77777777-7777-4777-8777-777777777777', interviewId: null, interviewKind: null, roundNumber: null },
      title: '候補者会話', messages: [], revision: 1,
      createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z'
    })
    await expect(harness.useCase.execute({
      conversationId, message: '最近有什么案件？', expectedConversationRevision: 1, requestId, selectedJobCaseRef: null
    }, searchPlan)).rejects.toMatchObject({ code: 'CONVERSATION_CONTEXT_MISMATCH' })
  })

  it('resolves an ordinal case reference from the latest search result', async () => {
    const harness = createHarness()
    const first = await harness.useCase.execute({ conversationId, message: '最近有什么案件？', expectedConversationRevision: null, requestId, selectedJobCaseRef: null }, searchPlan)
    const second = await harness.useCase.execute(
      { conversationId, message: '给第二个案件匹配候选人', expectedConversationRevision: first.conversation.revision, requestId: '99999999-9999-4999-8999-999999999999', selectedJobCaseRef: null },
      { toolName: 'candidate.match.local', arguments: { ordinal: 2 } }
    )
    expect(harness.calls.map((call) => call.toolName)).toEqual(['job-case.search.local', 'candidate.match.local'])
    expect(harness.calls[1]?.input).toMatchObject({ jobCaseId: caseTwo, jobCaseVersion: 1 })
    expect(second.status).toBe('completed')
  })

  it('resolves a short candidate follow-up to the only matched candidate and reads the confirmed profile', async () => {
    const harness = createHarness()
    const selectedJobCaseRef: TypedAiConversationReference = {
      kind: 'job-case', objectId: caseOne, objectVersion: 2, resultHash: null, ordinal: 1,
      label: cases[0]!.title, target: `job-case:${caseOne}`
    }
    const matched = await harness.useCase.execute({
      conversationId, message: '有什么合适的人选', expectedConversationRevision: null, requestId, selectedJobCaseRef
    }, matchPlan)
    const profile = await harness.useCase.execute({
      conversationId,
      message: '日语呢',
      expectedConversationRevision: matched.conversation.revision,
      requestId: '99999999-9999-4999-8999-999999999999',
      selectedJobCaseRef
    }, { toolName: 'candidate.profile.read.local', arguments: { rank: null } })

    expect(harness.calls.map((call) => call.toolName)).toEqual(['candidate.match.local', 'candidate.profile.read.local'])
    expect(harness.calls[1]?.input).toMatchObject({ runId, resultId, rank: 1 })
    expect(profile.assistantMessage.blocks?.[0]).toMatchObject({
      type: 'candidate-profile-evidence',
      facts: { candidate: { rank: 1 }, profile: { japaneseLevel: 'N1' } }
    })
  })
})
