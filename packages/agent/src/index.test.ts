import { describe, expect, it } from 'vitest'
import { brandPersistedUserContent } from './business-text'
import type {
  AiConversationSnapshot,
  SaveAiConversationInput,
  TypedAiConversationReference
} from '@shared'
import {
  agentPlanningToolCatalog,
  isCandidateCaseRequest,
  isSpecificCandidateFitRequest,
  looksLikeInterviewBookingRequest,
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

function createHarness(
  attachmentTokens: string[] = [],
  schedulable: Array<{ anonymousLabel: string; sourceDocumentId: string }> = [],
  matchCandidate: { anonymousLabel: string; sourceDocumentId: string } | null =
    { anonymousLabel: 'CANDIDATE_1', sourceDocumentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  conversationImports: Array<{ anonymousLabel: string; sourceDocumentId: string }> = [],
  matchability: { scorableTermCount: number; hardFilterTermCount: number; reviewId: string | null } | null = null
) {
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
    listAttachmentFileTokens: () => attachmentTokens,
    resolveInterviewCandidate: () => matchCandidate,
    listSchedulableCandidates: () => schedulable,
    listConversationImports: () => conversationImports,
    describeJobCaseMatchability: () => matchability,
    executeTool: async (toolName: 'job-case.search.local' | 'candidate.match.local' | 'candidate.profile.read.local' | 'candidate.interview.read.local' | 'match-run.read.local' | 'resume.analyze.local' | 'candidate.draft.read.local' | 'job-case.draft.read.local' | 'candidate.interview.schedule.local', input: unknown): Promise<AgentToolResult> => {
      calls.push({ toolName, input })
      if (toolName === 'job-case.draft.read.local') {
        const value = input as { reviewIds: string[]; labels: string[] }
        return {
          toolName,
          actionRunId: '66666666-6666-4666-8666-666666666666',
          output: {
            facts: value.reviewIds.map((reviewId, index) => ({
              reviewId, label: value.labels[index]!, title: `案件 ${index + 1}`,
              reviewStatus: 'awaiting-review' as const, lifecycle: 'active' as const, jobCase: null,
              fields: [{ key: 'rate' as const, label: '単価', value: index === 0 ? '60万円' : null, status: index === 0 ? 'needs_review' as const : 'missing' as const }],
              warningCodes: [], status: 'current' as const
            }))
          }
        }
      }
      if (toolName === 'candidate.interview.schedule.local') {
        const value = input as { candidateLabel: string; scheduledAt: string; durationMinutes: number; meetingMethod: 'zoom'; kind: 'recruiting' }
        return { toolName, actionRunId: 'aaaaaaaa-1111-4111-8111-111111111111', output: value }
      }
      if (toolName === 'candidate.draft.read.local') {
        const value = input as { sourceDocumentId: string; label: string }
        return {
          toolName,
          actionRunId: '99999999-9999-4999-8999-999999999999',
          output: {
            facts: {
              documentId: value.sourceDocumentId,
              label: value.label,
              confirmed: false as const,
              reviewStatus: 'awaiting-review' as const,
              fields: [
                { label: 'スキル', value: 'Java, Spring Boot', confidence: 0.92, status: 'needs_review' as const, sources: ['Sheet1!B4'] },
                { label: '日本語', value: 'N1', confidence: 0.88, status: 'needs_review' as const, sources: ['Sheet1!B7'] },
                { label: '単価', value: null, confidence: 0, status: 'missing' as const, sources: [] }
              ],
              projects: [
                { title: '決済基盤刷新', period: '2024/01〜2025/03', role: 'SE', technologies: ['Java'], summary: '設計と実装', confidence: 0.8, sources: ['Sheet1!A12'] }
              ]
            }
          }
        }
      }
      if (toolName === 'resume.analyze.local') {
        const value = input as { fileTokens: string[] }
        return {
          toolName,
          actionRunId: '88888888-8888-4888-8888-888888888888',
          output: {
            imported: value.fileTokens.map((token) => ({ documentId: token, name: `${token.slice(0, 4)}.pdf`, format: 'pdf', reviewRequired: true as const })),
            failed: []
          }
        }
      }
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
  const withMatchInContext = async (harness: ReturnType<typeof createHarness>, conversationId: string) => {
    const seeded = await harness.useCase.execute(
      {
        conversationId, message: '给当前案件匹配候选人', expectedConversationRevision: null,
        requestId: '99999999-9999-4999-8999-999999999999',
        selectedJobCaseRef: { kind: 'job-case', objectId: caseOne, objectVersion: 2, resultHash: null, ordinal: 1, label: cases[0]!.title, target: `job-case:${caseOne}` }
      },
      matchPlan
    )
    harness.calls.length = 0
    return seeded.conversation.revision
  }

  const scheduleInput = (overrides: Record<string, unknown> = {}) => ({
    toolName: 'candidate.interview.schedule.local' as const,
    arguments: {
      rank: 1, date: null, time: null, method: null,
      durationMinutes: null, kind: null, note: null, ...overrides
    }
  })
  const zoomMeetingUrl = 'https://company.zoom.us/wc/12345678901/join?pwd=local-test-only'

  it('names what the plan got wrong instead of only saying it was invalid', () => {
    // "Could not form a plan" hid an unknown tool name, a strict-schema
    // rejection and a bad enum behind one string. Each has a different fix.
    expect(() => parseAgentRequestedTool({ name: 'schedule-interview', arguments: {} }))
      .toThrow(/未知 Tool：schedule-interview/u)
    expect(() => parseAgentRequestedTool({ name: 'read_match_result', arguments: { rank: 'first' } }))
      .toThrow(/rank/u)
  })

  it('survives the shapes a model actually emits for an interview request', () => {
    // Each of these failed the plan outright before, so the operator saw
    // AGENT_PLAN_INVALID instead of being asked for the missing details.
    const parse = (args: unknown) => {
      const action = parseAgentRequestedTool({ name: 'schedule_interview', arguments: args })
      if (action.toolName !== 'candidate.interview.schedule.local') throw new Error('unexpected tool')
      return action.arguments
    }
    expect(parse({ date: '2026-08-20' }).date).toBe('2026-08-20')
    expect(parse({}).date).toBeNull()
    // Unknown keys are dropped, not fatal - zod strips them, so nothing is smuggled through.
    expect(parse({ date: '2026-08-20', candidate: 'CANDIDATE_1' })).not.toHaveProperty('candidate')
    expect(parse({ datetime: '2026-08-20 14:00' }).date).toBeNull()
    // Numeric strings and arbitrary valid business durations are understood.
    expect(parse({ durationMinutes: '60' }).durationMinutes).toBe(60)
    expect(parse({ durationMinutes: 120 }).durationMinutes).toBe(120)
  })

  it('reads a broadcast plan the way a model actually writes one', () => {
    const draft = (args: unknown) => {
      const action = parseAgentRequestedTool({ name: 'draft_case_broadcasts', arguments: args })
      if (action.toolName !== 'job-case.broadcast.draft.local') throw new Error('unexpected tool')
      return action.arguments
    }
    // The whole new-case queue is the safe reading of an omitted or unusable
    // target: it drafts, it never sends.
    expect(draft({})).toEqual({ target: 'new-cases', ordinal: null })
    expect(draft({ target: 'uncopied-cases' })).toEqual({ target: 'uncopied-cases', ordinal: null })
    expect(draft({ target: 'today' })).toEqual({ target: 'new-cases', ordinal: null })
    // The pre-copy vocabulary is gone: a plan still asking for it falls back
    // to the safe target rather than silently meaning something else.
    expect(draft({ target: 'unsent-cases' })).toEqual({ target: 'new-cases', ordinal: null })
    expect(draft({ target: 'case', ordinal: '2' })).toEqual({ target: 'case', ordinal: 2 })
    expect(draft({ target: 'case', ordinal: 0 }).ordinal).toBeNull()
    expect(draft({ target: 'case', ordinal: 'second' }).ordinal).toBeNull()
    // Nothing else can be smuggled in through the arguments object.
    expect(draft({ target: 'case', reviewId: 'aaaa' })).not.toHaveProperty('reviewId')

    // Sending is not something this device can witness, so no tool claims it.
    expect(() => parseAgentRequestedTool({ name: 'record_case_broadcast', arguments: {} }))
      .toThrow(/未知 Tool/)
    // A target nobody can act on is normalized to the safe one rather than
    // failing the turn, but a plan that is not an argument object at all is
    // still refused.
    expect(parseAgentPlannedToolAction({
      toolName: 'job-case.broadcast.draft.local', arguments: { target: 'everything', ordinal: null }
    })).toEqual({ toolName: 'job-case.broadcast.draft.local', arguments: { target: 'new-cases', ordinal: null } })
    expect(() => parseAgentPlannedToolAction({
      toolName: 'job-case.broadcast.draft.local', arguments: 'send it'
    })).toThrow(/受控 schema/)
  })

  it('accepts a plan that only states the date, which is what the model actually emits', () => {
    // The model writes {"date":"2026-08-20"} and omits the rest rather than
    // spelling out six nulls. Requiring every key turned that into
    // AGENT_PLAN_INVALID and no interview could ever be scheduled.
    const entry = agentPlanningToolCatalog.find((tool) => tool.name === 'schedule_interview')
    expect(entry).toBeDefined()
    expect(entry!.parse({ date: '2026-08-20' })).toEqual({
      toolName: 'candidate.interview.schedule.local',
      arguments: { rank: null, date: '2026-08-20', time: null, method: null, durationMinutes: null, kind: null, note: null }
    })
  })

  it('treats an unusable date or time as missing rather than failing the plan', async () => {
    const harness = createHarness()
    const conversationId = '33333333-3333-4333-8333-333333333333'
    const revision = await withMatchInContext(harness, conversationId)
    const result = await harness.useCase.execute(
      {
        conversationId, message: '安排20号的面试', expectedConversationRevision: revision,
        requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null
      },
      scheduleInput({ date: '20号', time: '下午', method: 'zoom', durationMinutes: 60 })
    )
    expect(harness.calls).toEqual([])
    expect(result.status).toBe('clarifying')
    expect(result.assistantMessage.content).toContain('日期')
    expect(result.assistantMessage.content).toContain('开始时间')
  })

  it('tells a booking request apart from a request to read the existing schedule', () => {
    // The verb must precede the noun: 安排面试 books one, 面试安排 is the
    // existing schedule and must stay with the read tool.
    for (const booking of [
      '安排一个20号的面试', '帮我约一下面试', '预约面试', '给他定个面接',
      '面談を設定してください', '面接を予約したい',
      'schedule an interview for the 20th', 'book an interview', 'set up an interview'
    ]) expect(looksLikeInterviewBookingRequest(booking)).toBe(true)

    for (const reading of [
      '看一下面试安排', '面试状态怎么样', '他的面接はどうなっている', 'what is the interview status',
      '面談の予定を教えて', '总结一下这个人', '最近有什么案件？'
    ]) expect(looksLikeInterviewBookingRequest(reading)).toBe(false)
  })

  it('redirects every read plan to the scheduler when the operator asked to book', async () => {
    // All three read tools resolve through the match run and answer a booking
    // with "specify the candidate rank to query". Covering only one of them just
    // moved the planner onto another.
    const plans = [
      { toolName: 'candidate.interview.read.local' as const, arguments: { rank: null } },
      { toolName: 'candidate.profile.read.local' as const, arguments: { rank: null } },
      { toolName: 'match-run.read.local' as const, arguments: { rank: 1 } }
    ]
    for (const plan of plans) {
      const only = { anonymousLabel: 'RESUME_1', sourceDocumentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
      const harness = createHarness([], [only], null)
      const result = await harness.useCase.execute(
        {
          conversationId: '33333333-3333-4333-8333-333333333333',
          message: '安排一个20号的面试', expectedConversationRevision: null,
          requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null
        },
        plan
      )
      expect(result.status, plan.toolName).toBe('clarifying')
      expect(result.assistantMessage.content, plan.toolName).toContain('登记面试还需要')
      expect(harness.calls, plan.toolName).toEqual([])
    }
  })

  it('asks which candidate, never for a query rank, when nothing resolves', async () => {
    // The scheduling branch kept a leftover call that answered with the read
    // tool's "specify the candidate rank to query" once every fallback missed.
    // Every test so far had at least one candidate, so none of them reached it.
    const harness = createHarness([], [], null)
    const conversationId = '33333333-3333-4333-8333-333333333333'
    const revision = await withMatchInContext(harness, conversationId)
    const result = await harness.useCase.execute(
      {
        conversationId, message: '安排一个20号的面试', expectedConversationRevision: revision,
        requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null
      },
      scheduleInput({ rank: 1, date: '2026-08-20' })
    )
    expect(result.status).toBe('clarifying')
    expect(result.assistantMessage.content).not.toContain('查询')
    expect(result.assistantMessage.content).toContain('请先导入简历')
    expect(harness.calls).toEqual([])
  })

  it('prefers what this conversation imported over everything already on the device', async () => {
    // One resume was imported here while four candidates existed on the device,
    // and the device list answered - so the operator was offered four strangers
    // for the person they had just added.
    const mine = { anonymousLabel: 'RESUME_1', sourceDocumentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }
    const deviceWide = ['1', '2', '3', '4'].map((n) => ({
      anonymousLabel: `CANDIDATE_${n}`, sourceDocumentId: `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111`
    }))
    const book = async (imports: typeof deviceWide, device: typeof deviceWide, rank: number | null = null) => {
      const harness = createHarness([], device, null, imports)
      const result = await harness.useCase.execute(
        {
          conversationId: '33333333-3333-4333-8333-333333333333',
          message: `安排一个20号14点的Zoom面试 ${zoomMeetingUrl}`, expectedConversationRevision: null,
          requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null
        },
        scheduleInput({ rank, date: '2026-08-20', time: '14:00', method: 'zoom', durationMinutes: 60 })
      )
      return {
        status: result.status,
        content: result.assistantMessage.content,
        target: (harness.calls[0]?.input as { sourceDocumentId?: string })?.sourceDocumentId ?? null
      }
    }

    // One import here, four on the device: the import wins.
    expect(await book([mine], deviceWide)).toMatchObject({ status: 'completed', target: mine.sourceDocumentId })

    // Two imports here: list those two, never the device's four.
    const second = { anonymousLabel: 'RESUME_2', sourceDocumentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }
    const ambiguous = await book([mine, second], deviceWide)
    expect(ambiguous.status).toBe('clarifying')
    expect(ambiguous.content).toContain('1. RESUME_1')
    expect(ambiguous.content).toContain('2. RESUME_2')
    expect(ambiguous.content).not.toContain('CANDIDATE_')

    // Picking by number selects from the conversation's own list.
    expect(await book([mine, second], deviceWide, 2)).toMatchObject({ status: 'completed', target: second.sourceDocumentId })

    // Nothing imported here: only then does the device list apply.
    const deviceAsked = await book([], deviceWide)
    expect(deviceAsked.status).toBe('clarifying')
    expect(deviceAsked.content).toContain('4. CANDIDATE_4')
  })

  it('lists the candidates it can book and accepts the number back', async () => {
    // "I could not determine who" with no list left the operator with nothing to
    // answer, which is where this got stuck once several resumes had been imported.
    const many = [
      { anonymousLabel: 'RESUME_1', sourceDocumentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      { anonymousLabel: 'RESUME_2', sourceDocumentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }
    ]
    const asked = await createHarness([], many, null).useCase.execute(
      {
        conversationId: '33333333-3333-4333-8333-333333333333',
        message: '安排一个20号的面试', expectedConversationRevision: null,
        requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null
      },
      scheduleInput({ rank: null, date: '2026-08-20' })
    )
    expect(asked.status).toBe('clarifying')
    expect(asked.assistantMessage.content).toContain('1. RESUME_1')
    expect(asked.assistantMessage.content).toContain('2. RESUME_2')

    const picked = await createHarness([], many, null).useCase.execute(
      {
        conversationId: '33333333-3333-4333-8333-333333333333',
        message: '第2位', expectedConversationRevision: null,
        requestId: '55555555-5555-4555-8555-555555555555', selectedJobCaseRef: null
      },
      scheduleInput({ rank: 2, date: '2026-08-20', time: '14:00', method: 'phone', durationMinutes: 60 })
    )
    expect(picked.status).toBe('completed')
    expect((picked as { toolName: string | null }).toolName).toBe('candidate.interview.schedule.local')
  })

  it('leaves a genuine read plan alone', async () => {
    const harness = createHarness()
    const conversationId = '33333333-3333-4333-8333-333333333333'
    const revision = await withMatchInContext(harness, conversationId)
    const result = await harness.useCase.execute(
      {
        conversationId, message: '看一下面试安排', expectedConversationRevision: revision,
        requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null
      },
      { toolName: 'candidate.interview.read.local', arguments: { rank: 1 } }
    )
    expect(harness.calls.at(-1)?.toolName).toBe('candidate.interview.read.local')
    expect(result.assistantMessage.content).not.toContain('登记面试还需要')
  })

  it('resolves the interview candidate the same way from every entry point', async () => {
    const only = { anonymousLabel: 'RESUME_1', sourceDocumentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
    const matched = { anonymousLabel: 'CANDIDATE_1', sourceDocumentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
    const full = { date: '2026-08-20', time: '14:00', method: 'phone' as const, durationMinutes: 60 as const }
    const run = async (
      label: string,
      opts: { schedulable?: typeof only[]; matchCandidate?: typeof matched | null; seedMatch?: boolean; rank?: number | null }
    ) => {
      const harness = createHarness([], opts.schedulable ?? [], opts.matchCandidate ?? null)
      const conversationId = '33333333-3333-4333-8333-333333333333'
      const revision = opts.seedMatch ? await withMatchInContext(harness, conversationId) : null
      const result = await harness.useCase.execute(
        {
          conversationId, message: label, expectedConversationRevision: revision,
          requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null
        },
        scheduleInput({ rank: opts.rank ?? null, ...full })
      )
      return { status: result.status, target: (harness.calls[0]?.input as { sourceDocumentId?: string })?.sourceDocumentId ?? null }
    }

    // A resolvable match run wins when a rank was actually named.
    expect(await run('第1名安排面试', { seedMatch: true, matchCandidate: matched, rank: 1, schedulable: [only] }))
      .toEqual({ status: 'completed', target: matched.sourceDocumentId })
    // No match run: the invented rank is ignored and the single candidate is used.
    expect(await run('安排这个人的面试', { rank: 1, schedulable: [only] }))
      .toEqual({ status: 'completed', target: only.sourceDocumentId })
    // Match run present but unresolvable: fall through rather than clarify.
    expect(await run('安排这个人的面试', { seedMatch: true, matchCandidate: null, rank: 1, schedulable: [only] }))
      .toEqual({ status: 'completed', target: only.sourceDocumentId })
    // Genuinely ambiguous: ask, and write nothing.
    expect(await run('安排面试', { schedulable: [only, { anonymousLabel: 'RESUME_2', sourceDocumentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }] }))
      .toEqual({ status: 'clarifying', target: null })
    // Nothing to schedule at all.
    expect(await run('安排面试', {})).toEqual({ status: 'clarifying', target: null })
  })

  it('falls back to the imported candidate when a saved match run no longer resolves', async () => {
    // A stale match run left in the conversation used to short-circuit into
    // "specify the candidate rank" before the fallbacks ever ran.
    const only = { anonymousLabel: 'RESUME_1', sourceDocumentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
    const harness = createHarness([], [only], null)
    const conversationId = '33333333-3333-4333-8333-333333333333'
    const revision = await withMatchInContext(harness, conversationId)
    const result = await harness.useCase.execute(
      {
        conversationId, message: '安排这个人20号14点的电话面试', expectedConversationRevision: revision,
        requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null
      },
      scheduleInput({ rank: 1, date: '2026-08-20', time: '14:00', method: 'phone', durationMinutes: 60 })
    )
    expect(result.status).toBe('completed')
    expect(harness.calls[0]).toMatchObject({
      toolName: 'candidate.interview.schedule.local',
      input: { sourceDocumentId: only.sourceDocumentId }
    })
  })

  it('ignores a rank the model invented when no match run exists', async () => {
    // The model sends rank 1 for "this person". With no match run that rank
    // means nothing, and letting it win produced "specify the candidate rank"
    // for an operator who had imported exactly one resume.
    const only = { anonymousLabel: 'RESUME_1', sourceDocumentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
    const harness = createHarness([], [only])
    const result = await harness.useCase.execute(
      {
        conversationId: '33333333-3333-4333-8333-333333333333',
        message: '安排这个人20号14点的电话面试', expectedConversationRevision: null,
        requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null
      },
      scheduleInput({ rank: 1, date: '2026-08-20', time: '14:00', method: 'phone', durationMinutes: 60 })
    )
    expect(result.status).toBe('completed')
    expect(harness.calls[0]).toMatchObject({
      toolName: 'candidate.interview.schedule.local',
      input: { sourceDocumentId: only.sourceDocumentId }
    })
  })

  it('schedules for the one imported candidate without asking for a match rank', async () => {
    // The operator imported a resume and said "book an interview". Requiring a
    // match-run rank here made the obvious case impossible.
    const only = { anonymousLabel: 'RESUME_1', sourceDocumentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
    const harness = createHarness([], [only])
    const result = await harness.useCase.execute(
      {
        conversationId: '33333333-3333-4333-8333-333333333333',
        message: '安排一个20号14点的电话面试', expectedConversationRevision: null,
        requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null
      },
      scheduleInput({ rank: null, date: '2026-08-20', time: '14:00', method: 'phone', durationMinutes: 60 })
    )
    expect(result.status).toBe('completed')
    expect(harness.calls[0]).toMatchObject({
      toolName: 'candidate.interview.schedule.local',
      input: { sourceDocumentId: only.sourceDocumentId, candidateLabel: 'RESUME_1' }
    })
  })

  it('asks which candidate when more than one could be meant', async () => {
    const harness = createHarness([], [
      { anonymousLabel: 'RESUME_1', sourceDocumentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      { anonymousLabel: 'RESUME_2', sourceDocumentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }
    ])
    const result = await harness.useCase.execute(
      {
        conversationId: '33333333-3333-4333-8333-333333333333',
        message: '安排一个20号14点的Zoom面试', expectedConversationRevision: null,
        requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null
      },
      scheduleInput({ rank: null, date: '2026-08-20', time: '14:00', method: 'zoom', durationMinutes: 60 })
    )
    expect(harness.calls).toEqual([])
    expect(result.status).toBe('clarifying')
  })

  it('asks for the missing interview details instead of choosing them', async () => {
    const harness = createHarness()
    const conversationId = '33333333-3333-4333-8333-333333333333'
    const revision = await withMatchInContext(harness, conversationId)
    const result = await harness.useCase.execute(
      {
        conversationId,
        message: '帮我安排一个20号的面试', expectedConversationRevision: revision,
        requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null
      },
      scheduleInput({ date: '2026-08-20' })
    )
    // Nothing is written from a half-specified instruction.
    expect(harness.calls).toEqual([])
    expect(result.status).toBe('clarifying')
    expect(result.assistantMessage.content).toContain('开始时间')
    expect(result.assistantMessage.content).toContain('会议方式')
    expect(result.assistantMessage.content).toContain('时长')
    expect(result.assistantMessage.blocks?.[0]).toMatchObject({ code: 'INTERVIEW_DETAILS_REQUIRED' })
  })

  it('completes a pending Zoom booking from a duration-and-link follow-up without exposing the link', async () => {
    const harness = createHarness()
    const conversationId = '33333333-3333-4333-8333-333333333333'
    const revision = await withMatchInContext(harness, conversationId)
    const pending = await harness.useCase.execute(
      {
        conversationId,
        message: '20号 14:00 的 Zoom 面试', expectedConversationRevision: revision,
        requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null
      },
      scheduleInput({ date: '2026-08-20', time: '14:00', method: 'zoom' })
    )
    expect(pending.status).toBe('clarifying')
    expect(pending.assistantMessage.content).toContain('Zoom 会议链接')

    harness.calls.length = 0
    const completed = await harness.useCase.execute(
      {
        conversationId,
        message: `30分钟。Zoom 链接是 ${zoomMeetingUrl}`,
        expectedConversationRevision: pending.conversation.revision,
        requestId: '55555555-5555-4555-8555-555555555555', selectedJobCaseRef: null
      },
      scheduleInput({ date: '2026-08-20', time: '14:00', method: 'zoom', durationMinutes: 30 })
    )

    expect(completed.status).toBe('completed')
    expect(harness.calls).toEqual([{
      toolName: 'candidate.interview.schedule.local',
      input: expect.objectContaining({
        scheduledAt: '2026-08-20T05:00:00.000Z',
        durationMinutes: 30,
        meetingMethod: 'zoom',
        meetingUrl: zoomMeetingUrl
      })
    }])
    expect(completed.assistantMessage.content).not.toContain(zoomMeetingUrl)
    expect(completed.assistantMessage.blocks?.[0]).toMatchObject({
      type: 'system-access',
      destination: 'interview-schedule',
      receipt: {
        sourceDocumentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        scheduledAt: '2026-08-20T05:00:00.000Z',
        durationMinutes: 30,
        meetingMethod: 'zoom',
        meetingLinkStoredLocally: true
      }
    })
  })

  it('schedules in JST once every detail is supplied and says no invitation was sent', async () => {
    const harness = createHarness()
    const conversationId = '33333333-3333-4333-8333-333333333333'
    const revision = await withMatchInContext(harness, conversationId)
    const result = await harness.useCase.execute(
      {
        conversationId,
        message: `20号 14:00，Zoom，60分钟，链接 ${zoomMeetingUrl}`, expectedConversationRevision: revision,
        requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null
      },
      scheduleInput({ date: '2026-08-20', time: '14:00', method: 'zoom', durationMinutes: 60, note: '事前に職務経歴を共有' })
    )
    expect(harness.calls).toEqual([{
      toolName: 'candidate.interview.schedule.local',
      input: {
        sourceDocumentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        candidateLabel: 'CANDIDATE_1',
        scheduledAt: '2026-08-20T05:00:00.000Z',
        durationMinutes: 60,
        meetingMethod: 'zoom',
        meetingUrl: zoomMeetingUrl,
        kind: 'recruiting',
        contactNote: '事前に職務経歴を共有'
      }
    }])
    expect(result.status).toBe('completed')
    expect(result.assistantMessage.blocks?.[0]).toMatchObject({
      destination: 'interview-schedule',
      receipt: { durationMinutes: 60, meetingLinkStoredLocally: true }
    })
  })


  it('summarises imported resume facts without turning extraction provenance into a review gate', async () => {
    const token = '11111111-1111-4111-8111-111111111111'
    const harness = createHarness([token])
    const conversationId = '33333333-3333-4333-8333-333333333333'
    const imported = await harness.useCase.execute(
      { conversationId, message: '导入这份简历', expectedConversationRevision: null, requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null },
      { toolName: 'resume.analyze.local', arguments: { attachmentOrdinal: null } }
    )
    const summary = await harness.useCase.execute(
      { conversationId, message: '总结一下这个人的整体情况', expectedConversationRevision: imported.conversation.revision, requestId: '55555555-5555-4555-8555-555555555555', selectedJobCaseRef: null },
      { toolName: 'candidate.draft.read.local', arguments: { draftOrdinal: null } }
    )
    // The ordinal resolved to the document the import turn actually produced.
    expect(harness.calls.at(-1)).toEqual({
      toolName: 'candidate.draft.read.local',
      input: { sourceDocumentId: token, label: 'RESUME_1' }
    })
    expect(summary.status).toBe('completed')
    expect(summary.assistantMessage.content).toContain('简历资料')
    expect(summary.assistantMessage.content).not.toMatch(/逐项确认|待审核|未确认草稿/u)
    const block = summary.assistantMessage.blocks?.[0]
    expect(block).toMatchObject({ type: 'candidate-draft-facts', facts: { confirmed: false, reviewStatus: 'awaiting-review' } })
  })

  it('reads one or every draft of the latest paste by ordinal and asks when nothing was pasted', async () => {
    const harness = createHarness()
    const conversationId = '33333333-3333-4333-8333-333333333333'
    const intakeBatchId = '12121212-1212-4212-8212-121212121203'
    const reviewIds = ['12121212-1212-4212-8212-121212121201', '12121212-1212-4212-8212-121212121202']
    const baseInput = { conversationId, expectedConversationRevision: null as number | null, requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null }

    const nothing = await harness.useCase.execute(
      { ...baseInput, message: '第2条的单价是多少' },
      { toolName: 'job-case.draft.read.local', arguments: { draftOrdinal: 2 } }
    )
    expect(nothing.status).toBe('clarifying')
    expect(nothing.assistantMessage.content).toContain('还没有导入过案件文本')

    const intake = harness.useCase.saveIntakeTurn(
      { ...baseInput, message: '案件テキスト', expectedConversationRevision: nothing.conversation.revision },
      brandPersistedUserContent('【已提交业务文本（多条记录）】内容摘要 abcdef12，原文未写入会话。'),
      {
        content: '已导入 2 条案件草稿。',
        blocks: [{
          type: 'job-case-draft-cards', intakeBatchId,
          cards: reviewIds.map((reviewId, index) => ({
            reviewId, label: `DRAFT_${index + 1}`, ordinal: index + 1, outcome: 'created' as const, title: `案件 ${index + 1}`,
            reviewStatus: 'awaiting-review' as const, lifecycle: 'active' as const, jobCase: null, fields: [], warningCodes: [], status: 'current' as const
          }))
        }]
      },
      'completed',
      { intakeBatchId, reviewIds }
    )
    expect(intake.conversation.salesAgentState?.lastIntakeBatch).toEqual({ intakeBatchId, messageId: intake.assistantMessage.id, reviewIds })

    const second = await harness.useCase.execute(
      { ...baseInput, message: '第2条的单价是多少', expectedConversationRevision: intake.conversation.revision, requestId: '55555555-5555-4555-8555-555555555555' },
      { toolName: 'job-case.draft.read.local', arguments: { draftOrdinal: 2 } }
    )
    expect(harness.calls.at(-1)).toEqual({ toolName: 'job-case.draft.read.local', input: { reviewIds: [reviewIds[1]], labels: ['DRAFT_2'] } })
    expect(second.assistantMessage.blocks?.[0]).toMatchObject({ type: 'job-case-draft-cards', intakeBatchId, cards: [{ ordinal: 2, label: 'DRAFT_2', outcome: 'created' }] })
    expect(second.assistantMessage.blocks?.[1]).toMatchObject({ type: 'system-access', destination: 'review-center', intakeBatchId, reviewIds: [reviewIds[1]] })

    // A partial read must not narrow the batch: every draft is still reachable.
    const all = await harness.useCase.execute(
      { ...baseInput, message: '这几条哪些缺单价', expectedConversationRevision: second.conversation.revision, requestId: '66666666-6666-4666-8666-666666666666' },
      { toolName: 'job-case.draft.read.local', arguments: { draftOrdinal: null } }
    )
    expect(harness.calls.at(-1)).toEqual({ toolName: 'job-case.draft.read.local', input: { reviewIds, labels: ['DRAFT_1', 'DRAFT_2'] } })
    expect(all.assistantMessage.content).toContain('2 条案件资料')
    expect(all.assistantMessage.content).not.toMatch(/待审核|不是正式案件|审核中心确认/u)

    const missing = await harness.useCase.execute(
      { ...baseInput, message: '第9条', expectedConversationRevision: all.conversation.revision, requestId: '77777777-7777-4777-8777-777777777777' },
      { toolName: 'job-case.draft.read.local', arguments: { draftOrdinal: 9 } }
    )
    expect(missing.status).toBe('clarifying')
    expect(missing.assistantMessage.content).toContain('请指明是第几条')
  })

  it('resolves a draft imported by the composer even before an Agent import block exists', async () => {
    const importedByComposer = {
      anonymousLabel: 'RESUME_1', sourceDocumentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    }
    const harness = createHarness([], [], null, [importedByComposer])
    const result = await harness.useCase.execute(
      {
        conversationId: '33333333-3333-4333-8333-333333333333',
        message: '总结一下刚导入的简历', expectedConversationRevision: null,
        requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null
      },
      { toolName: 'candidate.draft.read.local', arguments: { draftOrdinal: null } }
    )

    expect(harness.calls).toContainEqual({
      toolName: 'candidate.draft.read.local',
      input: { sourceDocumentId: importedByComposer.sourceDocumentId, label: 'RESUME_1' }
    })
    expect(result.status).toBe('completed')
  })

  it('asks which resume instead of guessing when nothing has been imported', async () => {
    const harness = createHarness([])
    const result = await harness.useCase.execute(
      {
        conversationId: '33333333-3333-4333-8333-333333333333',
        message: '总结一下这个人', expectedConversationRevision: null,
        requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null
      },
      { toolName: 'candidate.draft.read.local', arguments: { draftOrdinal: null } }
    )
    expect(harness.calls).toEqual([])
    expect(result.status).toBe('clarifying')
    expect(result.assistantMessage.content).toContain('还没有导入过简历')
  })


  it('imports only attached files and makes their content available without routing to a field review', async () => {
    const tokens = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
    const harness = createHarness(tokens)
    const conversationId = '33333333-3333-4333-8333-333333333333'
    const requestId = '44444444-4444-4444-8444-444444444444'
    const result = await harness.useCase.execute(
      { conversationId, message: '导入这两份简历', expectedConversationRevision: null, requestId, selectedJobCaseRef: null },
      { toolName: 'resume.analyze.local', arguments: { attachmentOrdinal: null } }
    )
    expect(harness.calls).toEqual([{ toolName: 'resume.analyze.local', input: { fileTokens: tokens } }])
    expect(result.status).toBe('completed')
    expect(result.assistantMessage.content).toContain('直接针对这些简历继续提问')
    expect(result.assistantMessage.content).not.toContain('逐项确认')
    expect(result.assistantMessage.blocks).not.toContainEqual({ type: 'system-access', destination: 'review-center' })
  })

  it('selects a single attachment by ordinal rather than importing everything', async () => {
    const tokens = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
    const harness = createHarness(tokens)
    await harness.useCase.execute(
      {
        conversationId: '33333333-3333-4333-8333-333333333333',
        message: '只导入第二份', expectedConversationRevision: null,
        requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null
      },
      { toolName: 'resume.analyze.local', arguments: { attachmentOrdinal: 2 } }
    )
    expect(harness.calls).toEqual([{ toolName: 'resume.analyze.local', input: { fileTokens: [tokens[1]] } }])
  })

  it('refuses to fabricate an import when the turn carries no attachment', async () => {
    const harness = createHarness([])
    const result = await harness.useCase.execute(
      {
        conversationId: '33333333-3333-4333-8333-333333333333',
        message: '导入简历', expectedConversationRevision: null,
        requestId: '44444444-4444-4444-8444-444444444444', selectedJobCaseRef: null
      },
      { toolName: 'resume.analyze.local', arguments: { attachmentOrdinal: null } }
    )
    expect(harness.calls).toEqual([])
    expect(result.assistantMessage.content).toContain('没有可导入的附件')
  })


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

  it('asks for requirements instead of ranking when the case has nothing to score', async () => {
    const reviewId = '12121212-1212-4212-8212-121212121212'
    const harness = createHarness([], [], null, [], { scorableTermCount: 0, hardFilterTermCount: 1, reviewId })
    const result = await harness.useCase.execute(
      {
        conversationId: '33333333-3333-4333-8333-333333333333', message: '给当前案件匹配候选人',
        expectedConversationRevision: null, requestId: '44444444-4444-4444-8444-444444444444',
        // The case is already selected, as after "跑匹配" on an intake card.
        selectedJobCaseRef: {
          kind: 'job-case', objectId: cases[0]!.id, objectVersion: cases[0]!.version, resultHash: null, ordinal: 1,
          label: cases[0]!.title, target: `job-case:${cases[0]!.id}`
        }
      },
      { toolName: 'candidate.match.local', arguments: { ordinal: null } }
    )
    expect(harness.calls).toEqual([])
    expect(result.status).toBe('clarifying')
    expect(result.assistantMessage.content).toContain('没有可评估的条件')
    expect(result.assistantMessage.content).toContain('只能按硬条件筛选')
    expect(result.assistantMessage.blocks?.[0]).toEqual({ type: 'system-access', destination: 'case-review', reviewId })
    expect(result.conversation.salesAgentState?.selectedJobCaseRef?.objectId).toBe(cases[0]!.id)
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


describe('person and case intent boundaries', () => {
  it('distinguishes a specific pair, reverse search, and an ordinary context question', () => {
    expect(isSpecificCandidateFitRequest('这个案件适合他吗')).toBe(true)
    expect(isSpecificCandidateFitRequest('这个候选人适合这个案件吗')).toBe(true)
    expect(isSpecificCandidateFitRequest('他适合当前案件吗')).toBe(true)
    expect(isCandidateCaseRequest('该名候选人适合哪些案件')).toBe(true)
    expect(isCandidateCaseRequest('改名候选人适合哪些案件')).toBe(true)
    expect(isSpecificCandidateFitRequest('该名候选人适合哪些案件')).toBe(false)
    expect(isCandidateCaseRequest('候选人的资料在案件右边吗')).toBe(false)
    expect(isCandidateCaseRequest('最近有哪些案件')).toBe(false)
    expect(isSpecificCandidateFitRequest('给当前案件匹配候选人')).toBe(false)
  })
})
