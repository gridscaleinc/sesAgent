import { describe, expect, it, vi } from 'vitest'
import type { AgentChatModelDefinition } from '@agent'
import type { AiCommerceNativeClient } from '@aicommerce'
import type { CloudCallAuditRecord, LocalPiiMapping, RedactionSessionEvidence } from '@privacy'
import type { AiConversationMessage } from '@shared'
import {
  AgentCloudNarrativeService,
  buildAgentBusinessTextExtractionProjection,
  buildAgentCloudProjection,
  buildAgentDirectAnswerProjection,
  businessTextExtractionInstructions,
  businessTextSegmentationInstructions,
  directAnswerInstructions,
  planningInstructions,
  buildAgentPlanningProjection,
  parseAgentBusinessTextExtractionResponse,
  parseAgentPlanningResponse,
  fixedInstructions,
  businessTextExtractionInstructionsFor,
  buildAgentMatchAssessmentProjection,
  matchAssessmentInstructions,
  parseAgentMatchAssessmentResponse
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
    expect(parseAgentPlanningResponse('TOOL\n{"name":"draft_case_broadcasts","arguments":{"target":"uncopied-cases"}}')).toEqual({
      kind: 'tool', action: { toolName: 'job-case.broadcast.draft.local', arguments: { target: 'uncopied-cases', ordinal: null } }
    })
    // Sending is not a fact this device has, so there is no tool to plan it.
    expect(() => parseAgentPlanningResponse('TOOL\n{"name":"record_case_broadcast","arguments":{"ordinal":2}}')).toThrow(/未知 Tool/)
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
      attachmentCount: 0, attachmentDrafts: [], schedulableCandidateCount: 0,
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

  it('projects drafted group messages as counts and titles, never as the message itself', () => {
    const reviewId = '77777777-7777-4777-8777-777777777777'
    const messageText = '【案件】Java 業務システム改修\n必須：Java、Spring Boot\n単価：～65万円'
    const projection = buildAgentPlanningProjection({
      locale: 'zh-CN',
      userMessage: '今天还有哪些没发',
      selectedJobCaseRef: null,
      attachmentCount: 0, attachmentDrafts: [], schedulableCandidateCount: 0,
      conversation: {
        id: conversationId,
        context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
        title: '案件配信',
        messages: [{
          id: 'assistant-broadcast', role: 'assistant', content: '群メッセージを1件作成しました。', mode: 'local',
          turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-25T00:00:01.000Z',
          blocks: [{
            type: 'job-case-broadcast-cards',
            queue: { new: 1, copied: 2, attention: 0 },
            cards: [{
              reviewId,
              jobCaseId: caseId,
              jobCaseVersion: 2,
              ordinal: 1,
              title: 'Java 業務システム改修',
              status: 'new',
              templateId: '88888888-8888-4888-8888-888888888888',
              templateRevision: 1,
              textJa: messageText,
              textZh: messageText,
              forbiddenJa: ['email'],
              forbiddenZh: []
            }]
          }]
        }],
        salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null },
        revision: 1,
        createdAt: '2026-08-25T00:00:00.000Z',
        updatedAt: '2026-08-25T00:00:00.000Z'
      }
    })
    const evidence = JSON.parse(projection).evidence.find((item: { type: string }) => item.type === 'job-case-broadcast-cards')
    expect(evidence).toEqual({
      type: 'job-case-broadcast-cards',
      queue: { new: 1, copied: 2, attention: 0 },
      messages: [{ case: 'CASE_1', ordinal: 1, title: 'Java 業務システム改修', status: 'new', hasForbidden: true }]
    })
    // The message the operator is about to paste never leaves the device, so
    // the model cannot restate, translate or rewrite it.
    expect(projection).not.toContain('必須：Java')
    expect(projection).not.toContain('～65万円')
    expect(projection).not.toContain(reviewId)
    expect(fixedInstructions).toContain('never restate, translate, rewrite, or invent the message itself')
    // Sending is untracked by decision, so no instruction may let the model
    // claim a message reached anyone.
    expect(fixedInstructions).toMatch(/never say a case was sent, posted, or delivered to any group/iu)
    expect(directAnswerInstructions).toMatch(/never about it having been sent or reaching any group/iu)
    expect(planningInstructions).toContain('uses draft_case_broadcasts')
    expect(planningInstructions).toMatch(/never offer to send, post, or mark a case as sent/iu)
    expect(planningInstructions).not.toContain('record_case_broadcast')
  })

  it('sends the planner a scheduling rule and the fact that a candidate exists', () => {
    // Without these the planner answered "I cannot schedule, no candidate was
    // supplied" instead of calling the tool that would have asked for the
    // missing details.
    expect(planningInstructions).toContain('must use schedule_interview')
    expect(planningInstructions).toMatch(/never answer that you cannot schedule/iu)
    expect(planningInstructions).toMatch(/never ask for the details yourself/iu)
    expect(planningInstructions).toContain('schedulableCandidateCount')

    const projection = JSON.parse(buildAgentPlanningProjection({
      locale: 'zh-CN',
      userMessage: '安排一个20号的面试',
      selectedJobCaseRef: null,
      attachmentCount: 0,
      attachmentDrafts: [],
      schedulableCandidateCount: 1,
      conversation: null
    }))
    expect(projection.state.schedulableCandidateCount).toBe(1)
  })

  it('keeps a supplied meeting link local while preserving its scheduling meaning', () => {
    const meetingUrl = 'https://app.zoom.us/wc/12345678901/join?pwd=local-secret-test&_x_zm_rtaid=opaque'
    const planning = JSON.parse(buildAgentPlanningProjection({
      locale: 'zh-CN',
      userMessage: `30分钟。Zoom 链接是 ${meetingUrl}`,
      selectedJobCaseRef: null,
      attachmentCount: 0,
      attachmentDrafts: [],
      schedulableCandidateCount: 1,
      conversation: null
    }))
    expect(planning.state).toMatchObject({ currentMeetingLinkMethod: 'zoom', currentMeetingLinkCount: 1 })
    expect(planning.userRequest).toContain('[ZOOM_MEETING_LINK_PROVIDED_LOCALLY]')

    const direct = buildAgentDirectAnswerProjection({
      locale: 'zh-CN', userMessage: `链接 ${meetingUrl}`,
      conversation: null, selectedJobCaseRef: null
    })
    const narrative = buildAgentCloudProjection('zh-CN', 'job-case.search.local', assistantMessage, `链接 ${meetingUrl}`)
    for (const projection of [JSON.stringify(planning), direct, narrative]) {
      expect(projection).not.toContain(meetingUrl)
      expect(projection).not.toContain('local-secret-test')
      expect(projection).not.toContain('_x_zm_rtaid')
    }
  })

  it('does not let the interview read rule claim scheduling as well', () => {
    // read_candidate_interviews used to be introduced with "status, schedules,
    // notes", so a booking request matched it and the turn ended in "specify the
    // candidate rank to query" - a read tool's clarification, not the scheduler's.
    const readRule = planningInstructions.slice(planningInstructions.indexOf('read_candidate_interviews') - 200)
      .split('.')[0]!
    expect(readRule).not.toMatch(/\bschedules\b/u)
    expect(planningInstructions).toContain('It only reads and can never create or change a booking')
    expect(planningInstructions).toContain('you must use schedule_interview, never read_candidate_interviews')
  })

  it('marks an unexcluded-but-unmatched candidate as insufficient evidence in the cloud projection', () => {
    const message: AiConversationMessage = {
      id: 'assistant-match', role: 'assistant', content: '匹配结果。', mode: 'local', createdAt: '2026-08-26T00:00:00.000Z',
      blocks: [{
        type: 'candidate-match-cards', runId: '88888888-8888-4888-8888-888888888888', resultHash: 'a'.repeat(64),
        cards: [{
          reference: { kind: 'match-result', objectId: '99999999-9999-4999-8999-999999999999', objectVersion: null, resultHash: 'a'.repeat(64), ordinal: 1, label: 'CANDIDATE_1', target: 'match-result:99999999-9999-4999-8999-999999999999' },
          candidateProfileId: '77777777-7777-4777-8777-777777777777', runId: '88888888-8888-4888-8888-888888888888', rank: 1,
          anonymousLabel: '候補者 DA67E874', fitScore: 0, matched: [], missing: ['勤務地:常駐'], hardFilterStatus: 'unknown',
          projectEvidence: null, status: 'current'
        }]
      }]
    }
    const projection = buildAgentCloudProjection('zh-CN', 'candidate.match.local', message, '给当前案件匹配候选人')
    expect(projection).toContain('"assessment":"insufficient-evidence"')
    expect(fixedInstructions).toContain('insufficient-evidence')
  })

  it('projects intake draft cards as labelled business fields, without review, case, or batch ids', () => {
    const reviewId = '77777777-7777-4777-8777-777777777777'
    const caseId = '88888888-8888-4888-8888-888888888888'
    const intakeBatchId = '99999999-9999-4999-8999-999999999999'
    const projection = buildAgentPlanningProjection({
      locale: 'zh-CN',
      userMessage: '这几条里哪些缺单价？',
      selectedJobCaseRef: null,
      attachmentCount: 0, attachmentDrafts: [], schedulableCandidateCount: 0,
      conversation: {
        id: conversationId,
        context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
        title: '案件取込',
        messages: [{
          id: 'intake-cards', role: 'assistant', content: '已导入 1 条案件草稿。', mode: 'local',
          turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-25T00:00:01.000Z',
          blocks: [{
            type: 'job-case-draft-cards', intakeBatchId,
            cards: [{
              reviewId, label: 'DRAFT_1', ordinal: 1, outcome: 'created', title: 'VC++ 開発',
              reviewStatus: 'completed', lifecycle: 'active', jobCase: { id: caseId, version: 1 }, status: 'current',
              warningCodes: ['DETERMINISTIC_EXTRACTION_REQUIRES_REVIEW'],
              fields: [
                { key: 'title', label: '案件名', value: 'VC++ 開発', status: 'confirmed' },
                { key: 'rate', label: '単価', value: null, status: 'missing' },
                { key: 'location', label: '勤務地', value: '都内出勤', status: 'confirmed' }
              ]
            }]
          }]
        }],
        salesAgentState: {
          selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null,
          lastIntakeBatch: { intakeBatchId, messageId: 'intake-cards', reviewIds: [reviewId] }
        },
        revision: 1, createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:01.000Z'
      }
    })
    const decoded = JSON.parse(projection) as { state: { intakeDraftCount: number }; evidence: Array<Record<string, unknown>> }
    expect(decoded.state.intakeDraftCount).toBe(1)
    expect(decoded.evidence[0]).toMatchObject({
      type: 'job-case-draft-cards',
      drafts: [{
        draft: 'DRAFT_1', ordinal: 1, confirmed: true, title: 'VC++ 開発',
        fields: [{ label: '案件名', value: 'VC++ 開発' }, { label: '勤務地', value: '都内出勤' }],
        missing: ['単価']
      }]
    })
    expect(projection).not.toContain(reviewId)
    expect(projection).not.toContain(caseId)
    expect(projection).not.toContain(intakeBatchId)
  })

  it('permits answering from an attachment draft while keeping the unconfirmed caveat', () => {
    // Putting the drafts in the context is not enough: the answer step used to be
    // told to treat only the evidence array as fact and to use "verified" data,
    // so it refused to summarise a parsed file that was sitting right there.
    expect(directAnswerInstructions).toContain('attachmentDrafts')
    expect(directAnswerInstructions).toContain('do not claim you lack information while it is present')
    expect(directAnswerInstructions).toContain('still need the operator to confirm each field')
    // The narrower guarantee has to survive: conversation text is still not fact.
    expect(directAnswerInstructions).toContain('verified facts only when present in the evidence array')
    expect(directAnswerInstructions).toContain('answer about that one case only')
  })

  it('carries the parsed attachment into the answer context, not only the planning one', () => {
    // The planner decides answer-vs-tool from one projection and the answer is
    // written from another. Drafts have to reach both or the model replies that
    // it has nothing to summarise.
    const draft = {
      documentId: '66666666-6666-4666-8666-666666666666',
      label: '技術者履歴書_楊凱',
      confirmed: false as const,
      reviewStatus: 'awaiting-review' as const,
      fields: [{ label: 'スキル', value: 'Java', confidence: 0.9, status: 'needs_review' as const, sources: ['技術者履歴書_楊凱.xlsx!B4'] }],
      projects: []
    }
    const answer = JSON.parse(buildAgentDirectAnswerProjection({
      locale: 'zh-CN',
      userMessage: '总结一下这个人的整体情况',
      selectedJobCaseRef: null,
      attachmentDrafts: [draft],
      conversation: null
    }))
    expect(answer.attachmentDrafts).toEqual([{
      resume: 'RESUME_1',
      confirmed: false,
      fields: [{ label: 'スキル', value: 'Java', confidence: 0.9 }],
      projects: []
    }])
    expect(JSON.stringify(answer)).not.toContain('楊凱')
  })

  it('gives the planner the parsed attachment so a summary needs no tool, still without the file name', () => {
    const projection = buildAgentPlanningProjection({
      locale: 'zh-CN',
      userMessage: '总结一下这个人的整体情况',
      selectedJobCaseRef: null,
      attachmentCount: 1,
      schedulableCandidateCount: 0,
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
      attachmentCount: 2, attachmentDrafts: [], schedulableCandidateCount: 0,
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
      attachmentCount: 0, attachmentDrafts: [], schedulableCandidateCount: 0,
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

  it('adds the current right workspace as a separate de-identified authoritative projection', () => {
    const projection = JSON.parse(buildAgentDirectAnswerProjection({
      locale: 'zh-CN',
      userMessage: '总结一下右侧页面',
      selectedJobCaseRef: null,
      attachmentDrafts: [],
      conversation: null,
      activeWorkspaceEvidence: {
        destination: 'candidate',
        data: {
          candidate: 'WORKSPACE_CANDIDATE_1',
          fields: [{ key: 'skills', value: 'Java / AWS' }],
          interviews: [{ stage: 'scheduled', meetingMethod: 'zoom', meetingLinkStoredLocally: true }]
        }
      }
    }))

    expect(projection.activeWorkspace).toMatchObject({
      destination: 'candidate',
      data: { candidate: 'WORKSPACE_CANDIDATE_1' }
    })
    expect(JSON.stringify(projection.activeWorkspace)).toContain('Java / AWS')
    expect(JSON.stringify(projection.activeWorkspace)).not.toContain('sourceDocumentId')
    expect(JSON.stringify(projection.activeWorkspace)).not.toContain('meetingUrl')
  })

  it('compacts history by complete turns and keeps the newest dialogue pair together', () => {
    const messages: AiConversationMessage[] = Array.from({ length: 8 }, (_, index) => {
      const turnId = `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`
      return [
        { id: `user-${index}`, role: 'user' as const, content: `问题 ${index + 1}`, turnId, createdAt: `2026-08-18T00:00:${String(index * 2).padStart(2, '0')}.000Z` },
        { id: `assistant-${index}`, role: 'assistant' as const, content: `回答 ${index + 1}`, turnId, createdAt: `2026-08-18T00:00:${String(index * 2 + 1).padStart(2, '0')}.000Z` }
      ]
    }).flat()
    const projection = JSON.parse(buildAgentPlanningProjection({
      locale: 'zh-CN', userMessage: '继续', selectedJobCaseRef: null,
      attachmentCount: 0, attachmentDrafts: [], schedulableCandidateCount: 0,
      conversation: {
        id: conversationId,
        context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
        title: '长会话', messages,
        salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null },
        revision: 1, createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:01:00.000Z'
      }
    }))

    expect(projection.recentConversation).toHaveLength(12)
    expect(projection.recentConversation.map((message: { role: string }) => message.role))
      .toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant'])
    expect(projection.recentConversation.at(-2)?.content).toBe('问题 8')
    expect(projection.recentConversation.at(-1)?.content).toBe('回答 8')
    expect(projection.contextWindow).toMatchObject({ includedMessageCount: 12, omittedMessageCount: 4 })
  })

  it('keeps a many-attachment planning projection under the enforced local limit', () => {
    const attachmentDrafts = Array.from({ length: 10 }, (_, draftIndex) => ({
      documentId: `${String(draftIndex + 1).padStart(8, '0')}-2222-4222-8222-222222222222`,
      label: `private-file-${draftIndex}.pdf`, confirmed: false as const, reviewStatus: 'awaiting-review' as const,
      fields: Array.from({ length: 20 }, (_, fieldIndex) => ({
        label: `字段 ${fieldIndex}`, value: 'x'.repeat(600), confidence: 0.8,
        status: 'needs_review' as const, sources: ['private.xlsx!A1']
      })),
      projects: Array.from({ length: 8 }, (_, projectIndex) => ({
        title: `项目 ${projectIndex}`, period: null, role: 'SE', technologies: Array(20).fill('TypeScript'),
        summary: 'y'.repeat(2_000), confidence: 0.8, sources: ['private.xlsx!B2']
      }))
    }))
    const projection = buildAgentPlanningProjection({
      locale: 'zh-CN', userMessage: '请比较这些附件', selectedJobCaseRef: null,
      attachmentCount: 10, attachmentDrafts, schedulableCandidateCount: 0, conversation: null
    })
    const parsed = JSON.parse(projection)
    expect(projection.length).toBeLessThanOrEqual(20_000)
    expect(parsed.attachmentDrafts.length).toBeGreaterThan(0)
    expect(parsed.state.attachmentCount).toBe(10)
    expect(projection).not.toContain('private-file')
    expect(projection).not.toContain('private.xlsx')
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
      conversation: null, selectedJobCaseRef: null, attachmentCount: 0, attachmentDrafts: [], schedulableCandidateCount: 0, model,
      signal: new AbortController().signal,
      onClientRequestId: vi.fn(), onRemoteSettled
    })).resolves.toEqual({ kind: 'answer' })
    expect(onRemoteSettled).toHaveBeenCalledTimes(1)
    // Planning uses the protocol maximum because reasoning tokens share the
    // output budget; 2,048 truncated a real scheduling follow-up.
    expect(streamResponses).toHaveBeenCalledWith(expect.objectContaining({
      operationId: `${requestId}-plan`, maxOutputTokens: 8_192
    }))
    const planningInput = streamResponses.mock.calls[0]![0]
    expect(planningInput.instructions).toContain('machine-only planning step')
    expect(planningInput.instructions).toContain('must not rerun matching')
    expect(planningInput.instructions).toContain('read_candidate_profile')
    expect(planningInput.instructions).toContain('the case activeWorkspace is showing')
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
      conversation: null, selectedJobCaseRef: null, attachmentCount: 0, attachmentDrafts: [], schedulableCandidateCount: 0, model,
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
    const sourceDocumentId = '77777777-7777-4777-8777-777777777777'
    const message: AiConversationMessage = {
      id: 'assistant-profile', role: 'assistant', content: '已读取候选人档案。', mode: 'local',
      createdAt: '2026-08-18T00:00:00.000Z',
      blocks: [{
        type: 'candidate-profile-evidence',
        facts: {
          runId: '88888888-8888-4888-8888-888888888888', validity: 'current',
          candidate: { candidateProfileId, sourceDocumentId, rank: 1, anonymousLabel: '候補者 AAAAAAAA' },
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
    expect(projection).not.toContain(sourceDocumentId)
  })

  it('falls back to segmentation-only extraction when the field-rich response is incomplete or malformed', async () => {
    const sessions = new Map<string, RedactionSessionEvidence>()
    const repository = {
      saveRedactionSession: vi.fn((session: RedactionSessionEvidence, _mappings: LocalPiiMapping[]) => sessions.set(session.id, session)),
      getRedactionSession: vi.fn((id: string) => sessions.get(id) ?? null),
      appendCloudCallAudit: vi.fn()
    }
    const streamResponses = vi.fn(async (input: Parameters<AiCommerceNativeClient['streamResponses']>[0]) => {
      input.onClientRequestId?.(`client-${streamResponses.mock.calls.length}`)
      const segmentationOnly = input.instructions.includes('machine-only segmentation step')
      return {
        clientRequestId: `client-${streamResponses.mock.calls.length}`, responseId: 'response', billingModeUsed: 'subscription' as const,
        // The first, field-rich answer is cut off mid-JSON; the segmentation retry is complete.
        content: segmentationOnly
          ? '{"decision":"records","records":[{"kind":"job-case","startLine":1,"endLine":1},{"kind":"job-case","startLine":2,"endLine":2}]}'
          : '{"decision":"records","records":[{"kind":"job-case","startLine":1,"endLine":1,"fields":{"title":"Ja'
      }
    })
    const service = new AgentCloudNarrativeService({
      repository,
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

    const result = await service.extractBusinessText({
      conversationId, requestId, text: '案件1️⃣：Java｜基本設計\n案件2️⃣：PHP｜開発', model,
      signal: new AbortController().signal, onClientRequestId: vi.fn(), onRemoteSettled
    })

    expect(result).toEqual({
      kind: 'records',
      records: [
        { kind: 'job-case', startLine: 1, endLine: 1, fields: {} },
        { kind: 'job-case', startLine: 2, endLine: 2, fields: {} }
      ]
    })
    expect(streamResponses).toHaveBeenCalledTimes(2)
    expect(streamResponses.mock.calls[0]![0].operationId).toBe(`${requestId}-intake-extract`)
    expect(streamResponses.mock.calls[1]![0].operationId).toBe(`${requestId}-intake-segment`)
    // Each remote attempt settles exactly once.
    expect(onRemoteSettled).toHaveBeenCalledTimes(2)
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

describe('business-text extraction protocol', () => {
  const tenLines = Array.from({ length: 10 }, (_, index) => `L${index + 1} text`)

  it('numbers every line of the pasted text into a bounded projection', () => {
    const { projection, lineCount } = buildAgentBusinessTextExtractionProjection('案件1：Java\n案件2：PHP')
    expect(lineCount).toBe(2)
    const decoded = JSON.parse(projection) as { version: string; lineCount: number; lines: string[] }
    expect(decoded.version).toBe('ses-business-text-extraction-v1')
    expect(decoded.lines).toEqual(['L1: 案件1：Java', 'L2: 案件2：PHP'])
  })

  it('tells the model the operator alias labels only when some exist', () => {
    expect(businessTextExtractionInstructionsFor({})).toBe(businessTextExtractionInstructions)
    const withAliases = businessTextExtractionInstructionsFor({ rate: ['単金', '金額'], start_date: ['稼働'] })
    expect(withAliases).toContain('rate: 単金, 金額; start_date: 稼働')
    expect(withAliases.startsWith(businessTextExtractionInstructions)).toBe(true)
  })

  it('tells the model to return segmentation plus verbatim field values, nothing else', () => {
    expect(businessTextExtractionInstructions).toContain('"decision":"records"')
    expect(businessTextExtractionInstructions).toContain('"fields":{"key":"value"}')
    expect(businessTextExtractionInstructions).toContain('copied verbatim')
    // The ｜-shorthand: every technology is a requirement and the name is the technical description.
    expect(businessTextExtractionInstructions).toContain('required_skills is "COBOL／Java、AWS（Aurora）、Shell、JCL"')
    expect(businessTextExtractionInstructions).toContain('never a single technology cut out of the list')
    expect(businessTextExtractionInstructions).toContain('Allowed keys for a job-case: title, role, industry, required_skills')
    // Shorthand rules: a "経験者" phrase is the skill requirement; work style is not a location.
    expect(businessTextExtractionInstructions).toContain('required_skills is "デジタルカメラ测试经验者", remote is "常駐"')
    expect(businessTextExtractionInstructions).toContain('Never put a work style into location.')
    expect(businessTextExtractionInstructions).toContain('Never output prose, markdown, or anything beyond the single JSON object')
  })

  it('tells the model which lines open a record and which belong to none', () => {
    for (const instructions of [businessTextSegmentationInstructions, businessTextExtractionInstructions]) {
      // Bare 案件N and bare circled-number roots, with the body below them.
      expect(instructions).toContain('a line that is only its number - 案件1, 案件②。, ⑥')
      expect(instructions).toContain('until the next such root')
      expect(instructions).toContain('Dotted or dashed rules')
      expect(instructions).toContain('belong to none')
      // An anonymous 【スキル】【単金】 profile is a candidate record.
      expect(instructions).toContain('A profile with no name is still one candidate record')
      expect(instructions).toContain('【スキル】【単金】【日本語】【対応工程】-style labels')
    }
    // Status tails and bracketed work styles, for the field-rich protocol only.
    expect(businessTextExtractionInstructions).toContain('What follows ⇒ or → is status commentary')
    expect(businessTextExtractionInstructions).toContain('a month there is the start_date (10月～), anything else')
    expect(businessTextExtractionInstructions).toContain('required_skills is "Experience clould経験", remote is "常驻"')
    // The verbatim-copy rules are untouched.
    expect(businessTextExtractionInstructions).toContain('copied verbatim from that record\'s own lines')
    expect(businessTextSegmentationInstructions).toContain('Never output prose, markdown, field values, or anything beyond the single JSON object')
  })

  it('keeps only field values copied verbatim from the record\'s own redacted lines and restores placeholders', () => {
    const lines = [
      '📢 9月案件',
      '案件1️⃣：Java｜基本設計～テスト、単価60万円、担当 <PERSON_NAME_001>',
      '② 8月～長期、5名，VC++3年以上，日本語N3可，都内出勤，面談1回。'
    ]
    const mappings = [{ placeholder: '<PERSON_NAME_001>', originalValue: '山田太郎', identifierType: 'person_name' }] as never
    const payload = JSON.stringify({
      decision: 'records',
      records: [
        {
          kind: 'job-case', startLine: 2, endLine: 2,
          fields: { title: 'Java｜基本設計～テスト', rate: '単価60万円', contract_chain: '担当 <PERSON_NAME_001>', location: '都内出勤' }
        },
        {
          kind: 'job-case', startLine: 3, endLine: 3,
          fields: { required_skills: 'VC++3年以上', japanese_level: 'N3', interview: '面談1回、5名', start_date: '8月～長期', remote: 'フルリモート' }
        }
      ]
    })
    expect(parseAgentBusinessTextExtractionResponse(payload, lines, mappings)).toEqual({
      kind: 'records',
      records: [
        // location was copied from the other record's line: dropped. The
        // placeholder is restored locally, never by the model.
        { kind: 'job-case', startLine: 2, endLine: 2, fields: { title: 'Java｜基本設計～テスト', rate: '単価60万円', contract_chain: '担当 山田太郎' } },
        // 'N3' is a substring; '面談1回、5名' joins two verbatim fragments;
        // 'フルリモート' appears nowhere in the record and is dropped.
        { kind: 'job-case', startLine: 3, endLine: 3, fields: { required_skills: 'VC++3年以上', japanese_level: 'N3', interview: '面談1回、5名', start_date: '8月～長期' } }
      ]
    })
  })

  it('ignores extra record-level keys the model adds instead of rejecting the segmentation', () => {
    const lines = ['案件1️⃣：Java｜基本設計', '案件2️⃣：PHP｜開発']
    expect(parseAgentBusinessTextExtractionResponse(
      '{"decision":"records","lineCount":2,"records":[{"kind":"job-case","startLine":1,"endLine":1,"label":"DRAFT_1","confidence":0.9,"fields":{"title":"Java｜基本設計"}},{"kind":"job-case","startLine":2,"endLine":2}]}',
      lines
    )).toEqual({
      kind: 'records',
      records: [
        { kind: 'job-case', startLine: 1, endLine: 1, fields: { title: 'Java｜基本設計' } },
        { kind: 'job-case', startLine: 2, endLine: 2, fields: {} }
      ]
    })
  })

  it('drops unknown keys, null values and partial placeholders without rejecting the segmentation', () => {
    const lines = ['氏名：<PERSON_NAME_001>', '希望：フルリモート']
    // A job case has no "skills" key and "rate" is null: both are dropped, the record stays.
    expect(parseAgentBusinessTextExtractionResponse(
      '{"decision":"records","records":[{"kind":"job-case","startLine":1,"endLine":2,"fields":{"skills":"x","rate":null,"remote":"フルリモート"}}]}',
      lines
    )).toEqual({ kind: 'records', records: [{ kind: 'job-case', startLine: 1, endLine: 2, fields: { remote: 'フルリモート' } }] })
    expect(parseAgentBusinessTextExtractionResponse(
      '{"decision":"records","records":[{"kind":"candidate","startLine":1,"endLine":2,"fields":{"role":"<PERSON_NAME_0","work_style":"フルリモート"}}]}',
      lines,
      [{ placeholder: '<PERSON_NAME_001>', originalValue: '山田太郎', identifierType: 'person_name' }] as never
    )).toEqual({ kind: 'records', records: [{ kind: 'candidate', startLine: 1, endLine: 2, fields: { work_style: 'フルリモート' } }] })
  })

  it('accepts a valid records response, plain or fenced', () => {
    const payload = '{"decision":"records","records":[{"kind":"job-case","startLine":2,"endLine":4},{"kind":"candidate","startLine":6,"endLine":9}]}'
    const expected = {
      kind: 'records',
      records: [
        { kind: 'job-case', startLine: 2, endLine: 4, fields: {} },
        { kind: 'candidate', startLine: 6, endLine: 9, fields: {} }
      ]
    }
    expect(parseAgentBusinessTextExtractionResponse(payload, tenLines)).toEqual(expected)
    expect(parseAgentBusinessTextExtractionResponse(`\`\`\`json\n${payload}\n\`\`\``, tenLines)).toEqual(expected)
    expect(parseAgentBusinessTextExtractionResponse('{"decision":"unusable"}', tenLines)).toEqual({ kind: 'unusable' })
  })

  it('rejects every protocol violation instead of repairing it', () => {
    const range = (startLine: number, endLine: number, kind = 'job-case') =>
      `{"decision":"records","records":[{"kind":"${kind}","startLine":${startLine},"endLine":${endLine}}]}`
    expect(() => parseAgentBusinessTextExtractionResponse('以下の案件が含まれます', tenLines)).toThrow(/JSON/u)
    expect(() => parseAgentBusinessTextExtractionResponse(range(5, 3), tenLines)).toThrow(/行範囲/u)
    expect(() => parseAgentBusinessTextExtractionResponse(range(1, 11), tenLines)).toThrow(/行範囲/u)
    expect(() => parseAgentBusinessTextExtractionResponse(
      '{"decision":"records","records":[{"kind":"job-case","startLine":1,"endLine":5},{"kind":"candidate","startLine":4,"endLine":6}]}', tenLines)).toThrow(/重複または逆順/u)
    expect(() => parseAgentBusinessTextExtractionResponse(range(1, 2, 'note'), tenLines)).toThrow(/プロトコル/u)
    expect(() => parseAgentBusinessTextExtractionResponse('{"decision":"records","records":[]}', tenLines)).toThrow(/プロトコル/u)
    const eleven = JSON.stringify({
      decision: 'records',
      records: Array.from({ length: 11 }, (_item, index) => ({ kind: 'job-case', startLine: index + 1, endLine: index + 1 }))
    })
    expect(() => parseAgentBusinessTextExtractionResponse(eleven, [...tenLines, ...tenLines])).toThrow(/プロトコル/u)
  })
})

describe('match assessment protocol', () => {
  const candidates = [
    {
      label: 'CANDIDATE_1',
      hardFilters: [{ requirement: '日本語:N2', actual: null, outcome: 'unknown' as const }],
      facts: [{ label: 'スキル', value: 'Java 5年、Spring Boot' }],
      projects: [{ title: '決済基盤刷新', period: '2023/04-2024/03', role: 'バックエンド', technologies: ['Java'], summary: 'Spring Boot で決済 API を開発' }]
    },
    { label: 'CANDIDATE_2', hardFilters: [], facts: [{ label: 'スキル', value: 'PHP 3年' }], projects: [] }
  ]
  const jobCase = {
    title: 'Java 案件',
    requirements: [
      { key: 'required_skills', label: '必須スキル', value: 'Java 3年以上、Spring Boot' },
      { key: 'japanese_level', label: '日本語レベル', value: 'N2以上' }
    ]
  }
  const texts = () => {
    const built = buildAgentMatchAssessmentProjection({ locale: 'zh-CN', jobCase, candidates })
    return {
      candidates: built.candidateTexts.map((candidate) => ({ label: candidate.label, redactedText: candidate.text })),
      requirements: built.requirementsText
    }
  }

  it('projects bounded de-identified facts and keeps the texts verbatim claims are checked against', () => {
    const built = buildAgentMatchAssessmentProjection({ locale: 'zh-CN', jobCase, candidates })
    const projection = JSON.parse(built.projection) as { version: string; locale: string; candidates: Array<{ candidate: string }> }
    expect(projection.version).toBe('ses-match-assessment-v1')
    expect(projection.locale).toBe('zh-CN')
    expect(projection.candidates.map((candidate) => candidate.candidate)).toEqual(['CANDIDATE_1', 'CANDIDATE_2'])
    expect(built.requirementsText).toBe('Java 3年以上、Spring Boot\nN2以上')
    expect(built.candidateTexts[0]).toEqual({ label: 'CANDIDATE_1', text: expect.stringContaining('Spring Boot で決済 API を開発') })
    expect(built.projection).not.toContain('sourceDocumentId')
  })

  it('keeps only verbatim evidence, known labels, and protocol fits from the review', () => {
    const shown = texts()
    const payload = JSON.stringify({
      assessments: [
        {
          candidate: 'CANDIDATE_1', fit: 'possible',
          met: [
            { requirement: 'Spring Boot', evidence: 'Spring Boot で決済 API を開発' },
            // Evidence the model invented: not in the candidate's facts.
            { requirement: 'Java 3年以上', evidence: 'Java 10年' },
            // A requirement the job case never stated.
            { requirement: 'Kubernetes', evidence: 'Java 5年' }
          ],
          gaps: ['AWS 経験なし', 'AWS 経験なし'], confirm: ['日本語レベル'], reason: '主要スキルは一致。'
        },
        { candidate: 'CANDIDATE_2', fit: 'excellent', met: [], gaps: [], confirm: [], reason: 'x' },
        { candidate: 'CANDIDATE_9', fit: 'strong', met: [], gaps: [], confirm: [], reason: 'x' }
      ]
    })
    expect(parseAgentMatchAssessmentResponse(payload, shown.candidates, shown.requirements)).toEqual({
      assessments: [{
        candidate: 'CANDIDATE_1', fit: 'possible',
        met: [{ requirement: 'Spring Boot', evidence: 'Spring Boot で決済 API を開発' }],
        gaps: ['AWS 経験なし'], confirm: ['日本語レベル'], reason: '主要スキルは一致。'
      }]
    })
  })

  it('reads a review the model shaped loosely - bare array, other key, casual labels - and drops what it cannot place', () => {
    const shown = texts()
    const loose = [
      { candidate: 'candidate 1', fit: 'Possible', met: [], gaps: ['AWS'], confirm: [], reason: 'ok' },
      { candidate: 'CANDIDATE_2', fit: { level: 'weak' }, met: [], gaps: [], confirm: [], reason: 'x' },
      { candidate: 42, fit: 'weak' }
    ]
    const expected = { assessments: [{ candidate: 'CANDIDATE_1', fit: 'possible', met: [], gaps: ['AWS'], confirm: [], reason: 'ok' }] }
    expect(parseAgentMatchAssessmentResponse(JSON.stringify(loose), shown.candidates, shown.requirements)).toEqual(expected)
    expect(parseAgentMatchAssessmentResponse(JSON.stringify({ results: loose }), shown.candidates, shown.requirements)).toEqual(expected)
    expect(parseAgentMatchAssessmentResponse('```json\n' + JSON.stringify({ review: loose }) + '\n```', shown.candidates, shown.requirements)).toEqual(expected)
  })

  it('turns a "confirm" item about a required technology the candidate never mentions into a gap', () => {
    const shown = texts()
    const payload = JSON.stringify({
      assessments: [{
        candidate: 'CANDIDATE_2', fit: 'weak', met: [],
        gaps: [],
        // PHP 3年 is all CANDIDATE_2 has: Java and Spring Boot are required and absent, the level question is open.
        confirm: ['Java と Spring Boot の実務経験の有無', '日本語レベル（N2以上か）'],
        reason: '主要スキル未確認。'
      }]
    })
    expect(parseAgentMatchAssessmentResponse(payload, shown.candidates, shown.requirements)).toEqual({
      assessments: [{
        candidate: 'CANDIDATE_2', fit: 'weak', met: [],
        gaps: ['Java と Spring Boot の実務経験の有無'],
        confirm: ['日本語レベル（N2以上か）'],
        reason: '主要スキル未確認。'
      }]
    })
    expect(matchAssessmentInstructions).toContain('never a confirm item')
    expect(fixedInstructions).toContain('lacks COBOL')
    expect(fixedInstructions).toContain('no suitable candidate was found')
  })

  it('rejects a review that is not the single JSON object of the protocol', () => {
    expect(() => parseAgentMatchAssessmentResponse('候補者1は適合です。', [], '')).toThrow('マッチ評価の応答が有効な JSON ではありません。')
    expect(() => parseAgentMatchAssessmentResponse('{"note":"no review"}', [], '')).toThrow('マッチ評価の応答が受控プロトコルに従っていません。')
  })

  it('restores placeholders locally and never lets a partial one through', () => {
    const mappings = [{ placeholder: '<PERSON_NAME_001>', originalValue: '山田太郎', identifierType: 'person_name' }] as never
    const shown = [{ label: 'CANDIDATE_1', redactedText: '<PERSON_NAME_001> と決済 API を開発' }]
    const payload = JSON.stringify({
      assessments: [{
        candidate: 'CANDIDATE_1', fit: 'strong',
        met: [{ requirement: 'Java', evidence: '<PERSON_NAME_001> と決済 API を開発' }],
        gaps: ['<PERSON_NAME_0'], confirm: [], reason: '<PERSON_NAME_001> の経験'
      }]
    })
    expect(parseAgentMatchAssessmentResponse(payload, shown, 'Java', mappings)).toEqual({
      assessments: [{
        candidate: 'CANDIDATE_1', fit: 'strong',
        met: [{ requirement: 'Java', evidence: '山田太郎 と決済 API を開発' }],
        gaps: [], confirm: [], reason: '山田太郎 の経験'
      }]
    })
  })

  it('tells the model the local hard filters are authoritative and evidence must be verbatim', () => {
    expect(matchAssessmentInstructions).toContain('outcome "failed" is authoritative')
    expect(matchAssessmentInstructions).toContain('copied verbatim')
    expect(matchAssessmentInstructions).toContain('Never identify')
    expect(matchAssessmentInstructions).toContain('single JSON object')
  })
})
