import { describe, expect, it, vi } from 'vitest'
import type { AgentChatModelDefinition } from '@agent'
import type { AiCommerceNativeClient } from '@aicommerce'
import type { CloudCallAuditRecord, LocalPiiMapping, RedactionSessionEvidence } from '@privacy'
import type { AiConversationMessage } from '@shared'
import {
  AgentCloudNarrativeService,
  buildAgentCloudProjection,
  buildAgentDirectAnswerProjection,
  buildAgentPlanningProjection,
  parseAgentPlanningResponse
} from './agent-cloud-narrative'

const conversationId = '11111111-1111-4111-8111-111111111111'
const requestId = '22222222-2222-4222-8222-222222222222'
const caseId = '33333333-3333-4333-8333-333333333333'
const hash = 'a'.repeat(64)

const assistantMessage: AiConversationMessage = {
  id: 'assistant-1',
  role: 'assistant',
  content: '机密客户 A 的 Java 案件，报价 90 万。',
  mode: 'local',
  createdAt: '2026-08-18T00:00:00.000Z',
  blocks: [{
    type: 'job-case-cards', query: '机密客户 A', dataAsOf: '2026-08-18T00:00:00.000Z',
    normalizedFilters: { updatedAfter: '2026-07-19T15:00:00.000Z', updatedBefore: '2026-08-18T15:00:00.000Z', lifecycle: 'active', query: null, limit: 20 },
    totalMatched: 1,
    cards: [{
      reference: { kind: 'job-case', objectId: caseId, objectVersion: 2, resultHash: null, ordinal: 1, label: '机密客户 A', target: `job-case:${caseId}` },
      title: '机密客户 A 的支付系统', version: 2, updatedAt: '2026-08-18T00:00:00.000Z',
      requiredSkills: 'Java / AWS', rate: '90 万', workStyle: 'remote', startDate: '2026-09-01', status: 'current'
    }]
  }]
}

const model: AgentChatModelDefinition = {
  key: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna', upstreamModel: 'gpt-5.6-luna', maxOutputTokens: 1_200,
  provider: 'openai', endpoint: 'responses'
}

function passedGates() {
  return {
    qualityGate: { status: 'passed' as const },
    expertGate: { status: 'not-verified' as const },
    binding: {
      qualityReportHash: hash,
      expertAttestationHash: null,
      privacyImplementationSha256: 'c'.repeat(64),
      cloudEnforcementSha256: 'd'.repeat(64)
    }
  }
}

describe('Agent Cloud narrative boundary', () => {
  it('maps only the controlled ANSWER/TOOL planning protocol', () => {
    expect(parseAgentPlanningResponse('ANSWER\n基于现有结果，候选人的 Java 匹配较强。')).toEqual({
      kind: 'answer'
    })
    expect(parseAgentPlanningResponse('{"decision":"answer"}')).toEqual({ kind: 'answer' })
    expect(parseAgentPlanningResponse('{"decision":"tool","call":{"name":"read_candidate_profile","arguments":{"rank":1}}}')).toEqual({
      kind: 'tool', action: { toolName: 'candidate.profile.read.local', arguments: { rank: 1 } }
    })
    expect(parseAgentPlanningResponse('TOOL\n{"name":"match_candidates","arguments":{"ordinal":2}}')).toEqual({
      kind: 'tool', action: { toolName: 'candidate.match.local', arguments: { ordinal: 2 } }
    })
    expect(parseAgentPlanningResponse('TOOL\n{"name":"read_candidate_profile","arguments":{"rank":null}}')).toEqual({
      kind: 'tool', action: { toolName: 'candidate.profile.read.local', arguments: { rank: null } }
    })
    expect(parseAgentPlanningResponse('```text\nTOOL\n```json\n{"name":"read_candidate_profile","arguments":{"rank":1}}\n```\n```')).toEqual({
      kind: 'tool', action: { toolName: 'candidate.profile.read.local', arguments: { rank: 1 } }
    })
    expect(parseAgentPlanningResponse('{"name":"read_candidate_interviews","arguments":{"rank":1}}')).toEqual({
      kind: 'tool', action: { toolName: 'candidate.interview.read.local', arguments: { rank: 1 } }
    })
    expect(() => parseAgentPlanningResponse('TOOL\n{"name":"proposal_export","arguments":{}}')).toThrow(/未知 Tool/)
    expect(() => parseAgentPlanningResponse('调用 candidate.match.local')).toThrow(/规划 JSON 协议/)
    expect(() => parseAgentPlanningResponse('ANSWER\n先回答\nTOOL\n{"name":"match_candidates","arguments":{"ordinal":1}}')).toThrow(/同时返回/)
  })

  it('projects an unconfirmed draft as business fields only, without its document id or file name', () => {
    const documentId = '66666666-6666-4666-8666-666666666666'
    const projection = buildAgentPlanningProjection({
      locale: 'zh-CN',
      userMessage: '总结一下这个人的整体情况',
      selectedJobCaseRef: null,
      attachmentCount: 0, attachmentDrafts: [],
      conversation: {
        id: conversationId,
        context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
        title: '匹配会话',
        messages: [{
          id: 'assistant-draft', role: 'assistant', content: '已读取未确认草稿。', mode: 'cloud',
          turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-18T00:00:01.000Z',
          blocks: [{
            type: 'candidate-draft-facts',
            facts: {
              documentId,
              label: 'RESUME_1',
              confirmed: false,
              reviewStatus: 'awaiting-review',
              fields: [
                { label: 'スキル', value: 'Java', confidence: 0.9, status: 'needs_review', sources: ['技術者履歴書_楊凱.xlsx!B4'] },
                { label: '単価', value: null, confidence: 0, status: 'missing', sources: [] }
              ],
              projects: []
            }
          }]
        }],
        salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null },
        revision: 1,
        createdAt: '2026-08-18T00:00:00.000Z',
        updatedAt: '2026-08-18T00:00:00.000Z'
      }
    })
    const evidence = JSON.parse(projection).evidence.find((item: { type: string }) => item.type === 'candidate-draft-facts')
    expect(evidence).toMatchObject({ resume: 'RESUME_1', confirmed: false })
    expect(evidence.fields).toEqual([{ label: 'スキル', value: 'Java', confidence: 0.9 }])
    // Internal id, source cell labels and the file name they embed stay local.
    expect(projection).not.toContain(documentId)
    expect(projection).not.toContain('楊凱')
    expect(projection).not.toContain('.xlsx')
  })

  it('gives the planner the parsed attachment so a summary needs no tool, still without the file name', () => {
    const projection = buildAgentPlanningProjection({
      locale: 'zh-CN',
      userMessage: '总结一下这个人的整体情况',
      selectedJobCaseRef: null,
      attachmentCount: 1,
      attachmentDrafts: [{
        documentId: '66666666-6666-4666-8666-666666666666',
        label: '技術者履歴書_楊凱',
        confirmed: false,
        reviewStatus: 'awaiting-review',
        fields: [
          { label: 'スキル', value: 'Java', confidence: 0.9, status: 'needs_review', sources: ['技術者履歴書_楊凱.xlsx!B4'] },
          { label: '単価', value: null, confidence: 0, status: 'missing', sources: [] }
        ],
        projects: [{ title: '決済基盤', period: null, role: 'SE', technologies: ['Java'], summary: '設計', confidence: 0.8, sources: ['Sheet1!A12'] }]
      }],
      conversation: null
    })
    const parsed = JSON.parse(projection)
    expect(parsed.attachmentDrafts).toEqual([{
      resume: 'RESUME_1',
      confirmed: false,
      fields: [{ label: 'スキル', value: 'Java', confidence: 0.9 }],
      projects: [{ title: '決済基盤', period: null, role: 'SE', technologies: ['Java'], summary: '設計' }]
    }])
    expect(projection).not.toContain('楊凱')
    expect(projection).not.toContain('66666666-6666-4666-8666-666666666666')
  })

  it('tells the planner how many files are attached without sending their names', () => {
    const projection = buildAgentPlanningProjection({
      locale: 'zh-CN',
      userMessage: '导入这份简历',
      selectedJobCaseRef: null,
      attachmentCount: 2, attachmentDrafts: [],
      conversation: null
    })
    expect(JSON.parse(projection).state.attachmentCount).toBe(2)
    // File names routinely carry the candidate's own name; only the count may leave the device.
    expect(projection).not.toContain('.pdf')
    expect(projection).not.toContain('履歴書_')
  })

  it('puts the natural-language request, recent dialogue, and anonymous evidence into the AI planning context', () => {
    const projection = buildAgentPlanningProjection({
      locale: 'zh-CN',
      userMessage: '总结一下候选人的整体情况',
      selectedJobCaseRef: null,
      attachmentCount: 0, attachmentDrafts: [],
      conversation: {
        id: conversationId,
        context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
        title: '匹配会话',
        messages: [assistantMessage],
        salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null },
        revision: 1,
        createdAt: '2026-08-18T00:00:00.000Z',
        updatedAt: '2026-08-18T00:00:00.000Z'
      }
    })
    expect(projection).toContain('总结一下候选人的整体情况')
    expect(projection).toContain('Java / AWS')
    expect(projection).not.toContain(caseId)
  })

  it('projects only anonymous structured evidence and omits local identifiers and commercial-only fields', () => {
    const projection = buildAgentCloudProjection('zh-CN', 'job-case.search.local', assistantMessage)
    expect(projection).toContain('CASE_1')
    expect(projection).toContain('Java / AWS')
    expect(projection).not.toContain(caseId)
    expect(projection).not.toContain('机密客户 A')
    expect(projection).not.toContain('90 万')
    expect(projection).not.toContain(assistantMessage.content)
  })

  it('keeps planning tokens invisible and marks the remote request settled before validating the complete decision', async () => {
    const sessions = new Map<string, RedactionSessionEvidence>()
    const audits: CloudCallAuditRecord[] = []
    const streamResponses = vi.fn(async (input: Parameters<AiCommerceNativeClient['streamResponses']>[0]) => {
      input.onClientRequestId?.('planning-client-request')
      input.onDelta('{"decision":')
      input.onDelta('"answer"}')
      return {
        clientRequestId: 'planning-client-request', responseId: 'planning-response',
        content: '{"decision":"answer"}', billingModeUsed: 'subscription' as const
      }
    })
    const service = new AgentCloudNarrativeService({
      repository: {
        saveRedactionSession: vi.fn((session: RedactionSessionEvidence) => sessions.set(session.id, session)),
        getRedactionSession: vi.fn((id: string) => sessions.get(id) ?? null),
        appendCloudCallAudit: vi.fn((record: CloudCallAuditRecord) => audits.push(record))
      },
      localNer: {
        engine: 'apple-natural-language',
        detectNames: vi.fn().mockResolvedValue({ engine: 'apple-natural-language', networkAccess: false, entities: [] })
      },
      aiCommerce: {
        responsesEndpoint: 'https://aicommerce.gridscale.com/v1/ai/native/openai/v1/responses',
        streamResponses,
        cancelClientRequest: vi.fn()
      } as unknown as AiCommerceNativeClient,
      policyVersion: 'cloud-redaction-v2',
      loadGates: vi.fn().mockResolvedValue(passedGates()),
      allowLoopbackHttp: false
    })
    const onRemoteSettled = vi.fn()
    await expect(service.plan({
      conversationId, requestId, locale: 'zh-CN', userMessage: '总结一下候选人的整体情况',
      conversation: null, selectedJobCaseRef: null, attachmentCount: 0, attachmentDrafts: [], model,
      signal: new AbortController().signal,
      onClientRequestId: vi.fn(), onRemoteSettled
    })).resolves.toEqual({ kind: 'answer' })
    expect(onRemoteSettled).toHaveBeenCalledTimes(1)
    expect(streamResponses).toHaveBeenCalledWith(expect.objectContaining({
      operationId: `${requestId}-plan`, maxOutputTokens: 768
    }))
    const planningInput = streamResponses.mock.calls[0]![0]
    expect(planningInput.instructions).toContain('machine-only planning step')
    expect(planningInput.instructions).toContain('must not rerun matching')
    expect(planningInput.instructions).toContain('read_candidate_profile')
    expect(planningInput.instructions).toContain('Japanese level')
    expect(planningInput.input).toContain('总结一下候选人的整体情况')
    expect(audits).toMatchObject([{
      outcome: 'succeeded', provider: 'aicommerce-agent-planning-responses', taskType: 'cloud-assist'
    }])
  })

  it('rejects a mixed legacy ANSWER and TOOL only after the remote planning stream has settled', async () => {
    const sessions = new Map<string, RedactionSessionEvidence>()
    const streamResponses = vi.fn(async (input: Parameters<AiCommerceNativeClient['streamResponses']>[0]) => {
      input.onClientRequestId?.('mixed-planning-request')
      input.onDelta('ANSWER\n候选人的工作经历包括')
      input.onDelta('支付系统。\nTOOL\n{"name":"read_candidate_profile","arguments":{"rank":1}}')
      return {
        clientRequestId: 'mixed-planning-request', responseId: 'mixed-planning-response',
        content: 'ANSWER\n候选人的工作经历包括支付系统。\nTOOL\n{"name":"read_candidate_profile","arguments":{"rank":1}}',
        billingModeUsed: 'subscription' as const
      }
    })
    const service = new AgentCloudNarrativeService({
      repository: {
        saveRedactionSession: vi.fn((session: RedactionSessionEvidence) => sessions.set(session.id, session)),
        getRedactionSession: vi.fn((id: string) => sessions.get(id) ?? null),
        appendCloudCallAudit: vi.fn()
      },
      localNer: {
        engine: 'apple-natural-language',
        detectNames: vi.fn().mockResolvedValue({ engine: 'apple-natural-language', networkAccess: false, entities: [] })
      },
      aiCommerce: {
        responsesEndpoint: 'https://aicommerce.gridscale.com/v1/ai/native/openai/v1/responses',
        streamResponses,
        cancelClientRequest: vi.fn()
      } as unknown as AiCommerceNativeClient,
      policyVersion: 'cloud-redaction-v2',
      loadGates: vi.fn().mockResolvedValue(passedGates()),
      allowLoopbackHttp: false
    })
    const onRemoteSettled = vi.fn()

    await expect(service.plan({
      conversationId, requestId, locale: 'zh-CN', userMessage: '工作经历列出来参考一下',
      conversation: null, selectedJobCaseRef: null, attachmentCount: 0, attachmentDrafts: [], model,
      signal: new AbortController().signal,
      onClientRequestId: vi.fn(), onRemoteSettled
    })).rejects.toThrow(/同时返回 ANSWER 和 TOOL/)
    expect(onRemoteSettled).toHaveBeenCalledTimes(1)
  })

  it('streams a direct answer in a separate request after planning and projects existing evidence', async () => {
    const sessions = new Map<string, RedactionSessionEvidence>()
    const streamResponses = vi.fn(async (input: Parameters<AiCommerceNativeClient['streamResponses']>[0]) => {
      input.onClientRequestId?.('direct-answer-request')
      input.onDelta('候选人的 Java 匹配较强。')
      return {
        clientRequestId: 'direct-answer-request', responseId: 'direct-answer-response',
        content: '候选人的 Java 匹配较强。', billingModeUsed: 'subscription' as const
      }
    })
    const service = new AgentCloudNarrativeService({
      repository: {
        saveRedactionSession: vi.fn((session: RedactionSessionEvidence) => sessions.set(session.id, session)),
        getRedactionSession: vi.fn((id: string) => sessions.get(id) ?? null),
        appendCloudCallAudit: vi.fn()
      },
      localNer: {
        engine: 'apple-natural-language',
        detectNames: vi.fn().mockResolvedValue({ engine: 'apple-natural-language', networkAccess: false, entities: [] })
      },
      aiCommerce: {
        responsesEndpoint: 'https://aicommerce.gridscale.com/v1/ai/native/openai/v1/responses',
        streamResponses,
        cancelClientRequest: vi.fn()
      } as unknown as AiCommerceNativeClient,
      policyVersion: 'cloud-redaction-v2',
      loadGates: vi.fn().mockResolvedValue(passedGates()),
      allowLoopbackHttp: false
    })
    const conversation = {
      id: conversationId,
      context: { assistant: 'sales-agent' as const, candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
      title: '匹配会话', messages: [assistantMessage],
      salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null },
      revision: 1, createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z'
    }
    const deltas: string[] = []
    const onRemoteSettled = vi.fn()

    await expect(service.streamAnswer({
      conversationId, requestId, locale: 'zh-CN', userMessage: '总结一下', conversation,
      selectedJobCaseRef: null, model, signal: new AbortController().signal,
      onClientRequestId: vi.fn(), onRemoteSettled, onDelta: (delta) => deltas.push(delta)
    })).resolves.toMatchObject({ content: '候选人的 Java 匹配较强。' })
    expect(deltas).toEqual(['候选人的 Java 匹配较强。'])
    expect(onRemoteSettled).toHaveBeenCalledTimes(1)
    expect(streamResponses).toHaveBeenCalledWith(expect.objectContaining({
      operationId: `${requestId}-answer`,
      input: expect.stringContaining('CASE_1')
    }))
    expect(buildAgentDirectAnswerProjection({ locale: 'zh-CN', userMessage: '总结一下', conversation, selectedJobCaseRef: null }))
      .not.toContain(caseId)
  })

  it('projects confirmed candidate profile fields for a short follow-up without exposing the local profile id', () => {
    const candidateProfileId = '99999999-9999-4999-8999-999999999999'
    const message: AiConversationMessage = {
      id: 'assistant-profile', role: 'assistant', content: '已读取候选人档案。', mode: 'local',
      createdAt: '2026-08-18T00:00:00.000Z',
      blocks: [{
        type: 'candidate-profile-evidence',
        facts: {
          runId: '88888888-8888-4888-8888-888888888888', validity: 'current',
          candidate: { candidateProfileId, rank: 1, anonymousLabel: '候補者 AAAAAAAA' },
          profile: {
            profileVersion: 3, skills: 'Java', experienceYears: '8年', availability: '即日', rate: '90万円',
            japaneseLevel: 'N1', workStyle: 'リモート', role: 'バックエンド', location: '東京',
            workAuthorization: '就労制限なし', projectExperiences: []
          }
        }
      }]
    }

    const projection = buildAgentCloudProjection('zh-CN', 'candidate.profile.read.local', message, '日语呢')
    expect(projection).toContain('"japaneseLevel":"N1"')
    expect(projection).toContain('"candidate":"CANDIDATE_1"')
    expect(projection).not.toContain(candidateProfileId)
  })

  it('passes the projection through local NER, DLP, the synthetic quality gate, and CloudRedactionGateway before streaming', async () => {
    const sessions = new Map<string, RedactionSessionEvidence>()
    const audits: CloudCallAuditRecord[] = []
    const repository = {
      saveRedactionSession: vi.fn((session: RedactionSessionEvidence, _mappings: LocalPiiMapping[]) => sessions.set(session.id, session)),
      getRedactionSession: vi.fn((id: string) => sessions.get(id) ?? null),
      appendCloudCallAudit: vi.fn((record: CloudCallAuditRecord) => audits.push(record))
    }
    const streamResponses = vi.fn(async (input: Parameters<AiCommerceNativeClient['streamResponses']>[0]) => {
      input.onClientRequestId?.('client-request-123')
      input.onDelta('整理结果')
      return { clientRequestId: 'client-request-123', responseId: 'response-123', content: '整理结果', billingModeUsed: 'subscription' as const }
    })
    const aiCommerce = {
      responsesEndpoint: 'https://aicommerce.gridscale.com/v1/ai/native/openai/v1/responses',
      streamResponses,
      cancelClientRequest: vi.fn()
    } as unknown as AiCommerceNativeClient
    const loadGates = vi.fn().mockResolvedValue(passedGates())
    const service = new AgentCloudNarrativeService({
      repository,
      localNer: {
        engine: 'apple-natural-language',
        detectNames: vi.fn().mockResolvedValue({ engine: 'apple-natural-language', networkAccess: false, entities: [] })
      },
      aiCommerce,
      policyVersion: 'cloud-redaction-v2',
      loadGates,
      allowLoopbackHttp: false
    })
    const deltas: string[] = []
    const clientRequestIds: string[] = []
    const result = await service.stream({
      conversationId, requestId, locale: 'zh-CN', toolName: 'job-case.search.local', userMessage: '最近有什么案件？', assistantMessage, model,
      signal: new AbortController().signal,
      onClientRequestId: (id) => clientRequestIds.push(id),
      onRemoteSettled: vi.fn(),
      onDelta: (delta) => deltas.push(delta)
    })

    expect(result.content).toBe('整理结果')
    expect(clientRequestIds).toEqual(['client-request-123'])
    expect(deltas).toEqual(['整理结果'])
    expect(streamResponses).toHaveBeenCalledTimes(1)
    expect(loadGates).toHaveBeenCalledTimes(2)
    const cloudInput = streamResponses.mock.calls[0]![0]
    expect(cloudInput.model).toBe('gpt-5.6-luna')
    expect(cloudInput.input).toContain('CASE_1')
    expect(cloudInput.input).not.toContain(caseId)
    expect(cloudInput.input).not.toContain('机密客户 A')
    expect(repository.saveRedactionSession).toHaveBeenCalledTimes(1)
    expect(audits).toMatchObject([{
      outcome: 'succeeded', provider: 'aicommerce-agent-narrative-responses', taskType: 'cloud-assist',
      expertAttestationHash: null
    }])
  })

  it('routes DeepSeek through the AICommerce account-token native chat SSE path', async () => {
    const sessions = new Map<string, RedactionSessionEvidence>()
    const audits: CloudCallAuditRecord[] = []
    const streamResponses = vi.fn()
    const streamChatCompletions = vi.fn(async (input: Parameters<AiCommerceNativeClient['streamChatCompletions']>[0]) => {
      input.onClientRequestId?.('deepseek-client-request')
      input.onDelta('DeepSeek 整理结果')
      return {
        clientRequestId: 'deepseek-client-request', responseId: 'deepseek-response',
        content: 'DeepSeek 整理结果', billingModeUsed: 'subscription' as const
      }
    })
    const chatCompletionsEndpoint = vi.fn(() =>
      'https://aicommerce.gridscale.com/v1/ai/native/deepseek/v1/chat/completions'
    )
    const aiCommerce = {
      responsesEndpoint: 'https://aicommerce.gridscale.com/v1/ai/native/openai/v1/responses',
      chatCompletionsEndpoint,
      streamResponses,
      streamChatCompletions,
      cancelClientRequest: vi.fn()
    } as unknown as AiCommerceNativeClient
    const service = new AgentCloudNarrativeService({
      repository: {
        saveRedactionSession: vi.fn((session: RedactionSessionEvidence) => sessions.set(session.id, session)),
        getRedactionSession: vi.fn((id: string) => sessions.get(id) ?? null),
        appendCloudCallAudit: vi.fn((record: CloudCallAuditRecord) => audits.push(record))
      },
      localNer: {
        engine: 'apple-natural-language',
        detectNames: vi.fn().mockResolvedValue({ engine: 'apple-natural-language', networkAccess: false, entities: [] })
      },
      aiCommerce,
      policyVersion: 'cloud-redaction-v2',
      loadGates: vi.fn().mockResolvedValue(passedGates()),
      allowLoopbackHttp: false
    })
    const deepSeekModel: AgentChatModelDefinition = {
      key: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', upstreamModel: 'deepseek-v4-flash',
      maxOutputTokens: 4_096, provider: 'deepseek', endpoint: 'chat-completions'
    }

    await expect(service.stream({
      conversationId, requestId, locale: 'zh-CN', toolName: 'job-case.search.local', userMessage: '最近有什么案件？', assistantMessage,
      model: deepSeekModel, signal: new AbortController().signal,
      onClientRequestId: vi.fn(), onRemoteSettled: vi.fn(), onDelta: vi.fn()
    })).resolves.toMatchObject({ content: 'DeepSeek 整理结果' })

    expect(chatCompletionsEndpoint).toHaveBeenCalledWith('deepseek')
    expect(streamResponses).not.toHaveBeenCalled()
    expect(streamChatCompletions).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'deepseek', model: 'deepseek-v4-flash', maxOutputTokens: 4_096
    }))
    expect(audits).toMatchObject([{
      outcome: 'succeeded', provider: 'aicommerce-agent-narrative-deepseek-chat-completions', taskType: 'cloud-assist'
    }])
  })

  it('fails closed before egress when a privacy gate is not verified', async () => {
    const streamResponses = vi.fn()
    const aiCommerce = {
      responsesEndpoint: 'https://aicommerce.gridscale.com/v1/ai/native/openai/v1/responses',
      streamResponses,
      cancelClientRequest: vi.fn()
    } as unknown as AiCommerceNativeClient
    const service = new AgentCloudNarrativeService({
      repository: {
        saveRedactionSession: vi.fn(), getRedactionSession: vi.fn(), appendCloudCallAudit: vi.fn()
      },
      localNer: {
        engine: 'apple-natural-language',
        detectNames: vi.fn().mockResolvedValue({ engine: 'apple-natural-language', networkAccess: false, entities: [] })
      },
      aiCommerce,
      policyVersion: 'cloud-redaction-v2',
      loadGates: vi.fn().mockResolvedValue({
        qualityGate: { status: 'not-verified' }, expertGate: { status: 'passed' }, binding: null
      }),
      allowLoopbackHttp: false
    })
    await expect(service.stream({
      conversationId, requestId, locale: 'zh-CN', toolName: 'job-case.search.local', userMessage: '最近有什么案件？', assistantMessage, model,
      signal: new AbortController().signal, onClientRequestId: vi.fn(), onRemoteSettled: vi.fn(), onDelta: vi.fn()
    })).rejects.toThrow(/プライバシー品質ゲート/)
    expect(streamResponses).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'quality gate becomes not verified',
      second: { ...passedGates(), qualityGate: { status: 'not-verified' as const } },
      expected: /プライバシー品質ゲート/u
    },
    {
      name: 'binding becomes null',
      second: { ...passedGates(), binding: null },
      expected: /プライバシー品質証跡/u
    },
    {
      name: 'binding hash changes',
      second: {
        ...passedGates(),
        binding: { ...passedGates().binding, cloudEnforcementSha256: 'e'.repeat(64) }
      },
      expected: /binding changed/u
    }
  ])('revalidates gates immediately before egress and blocks when $name', async ({ second, expected }) => {
    const sessions = new Map<string, RedactionSessionEvidence>()
    const streamResponses = vi.fn()
    const aiCommerce = {
      responsesEndpoint: 'https://aicommerce.gridscale.com/v1/ai/native/openai/v1/responses',
      streamResponses,
      cancelClientRequest: vi.fn()
    } as unknown as AiCommerceNativeClient
    const loadGates = vi.fn()
      .mockResolvedValueOnce(passedGates())
      .mockResolvedValueOnce(second)
    const service = new AgentCloudNarrativeService({
      repository: {
        saveRedactionSession: vi.fn((session: RedactionSessionEvidence) => sessions.set(session.id, session)),
        getRedactionSession: vi.fn((id: string) => sessions.get(id) ?? null),
        appendCloudCallAudit: vi.fn()
      },
      localNer: {
        engine: 'apple-natural-language',
        detectNames: vi.fn().mockResolvedValue({ engine: 'apple-natural-language', networkAccess: false, entities: [] })
      },
      aiCommerce,
      policyVersion: 'cloud-redaction-v2',
      loadGates,
      allowLoopbackHttp: false
    })

    await expect(service.stream({
      conversationId, requestId, locale: 'zh-CN', toolName: 'job-case.search.local', userMessage: '最近有什么案件？', assistantMessage, model,
      signal: new AbortController().signal, onClientRequestId: vi.fn(), onRemoteSettled: vi.fn(), onDelta: vi.fn()
    })).rejects.toThrow(expected)
    expect(loadGates).toHaveBeenCalledTimes(2)
    expect(streamResponses).not.toHaveBeenCalled()
  })
})
