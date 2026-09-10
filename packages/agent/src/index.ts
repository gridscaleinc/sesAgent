import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { extractAllowedInterviewMeetingLinks, isUnassessableMatchCard, type AllowedInterviewMeetingLink } from '@shared'

import type { PersistedUserContent } from './business-text'

export {
  brandPersistedUserContent,
  routeBusinessText,
  type BusinessTextIntakeKind,
  type BusinessTextRouteDecision,
  type BusinessTextRouteReason,
  type LocalBusinessTextRoute,
  type PersistedUserContent
} from './business-text'
import type {
  AgentCandidateDraftFacts,
  AgentJobCaseBroadcastCard,
  AgentJobCaseBroadcastCardsBlock,
  AgentJobCaseDraftCard,
  AgentJobCaseDraftFacts,
  AgentCandidateMatchCard,
  AgentCandidateMatchCardsBlock,
  AgentCloudReviewOutcome,
  AgentCandidateInterviewFacts,
  AgentCandidateProfileFacts,
  AgentClarificationBlock,
  AgentEntityStatus,
  AgentErrorBlock,
  AgentJobCaseCardsBlock,
  AgentJobCaseCard,
  AgentMatchRunFacts,
  AiConversationBlock,
  AiConversationContext,
  AiConversationMessage,
  AiConversationReference,
  AiConversationSalesAgentState,
  AiConversationSnapshot,
  ApplicationLocale,
  CandidateMatchAssessment,
  DomainToolName,
  AgentSystemAccessBlock,
  ExecuteAgentTurnInput,
  SaveAiConversationInput,
  TypedAiConversationReference
} from '@shared'

export interface AgentChatModelDefinition {
  key: string
  displayName: string
  upstreamModel: string
  maxOutputTokens: number
  provider: 'openai' | 'deepseek'
  endpoint: 'responses' | 'chat-completions'
}

const agentChatModelExtensionSchema = z.array(z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,119}$/u),
  displayName: z.string().trim().min(1).max(120),
  model: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,119}$/u),
  maxOutputTokens: z.number().int().min(128).max(8_192).optional()
}).strict()).max(20)

export const defaultAgentChatModelKey = 'gpt-5.6-luna'

const defaultAgentChatModels: AgentChatModelDefinition[] = [
  { key: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna', upstreamModel: 'gpt-5.6-luna', maxOutputTokens: 1_200, provider: 'openai', endpoint: 'responses' },
  { key: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra', upstreamModel: 'gpt-5.6-terra', maxOutputTokens: 1_200, provider: 'openai', endpoint: 'responses' },
  { key: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', upstreamModel: 'gpt-5.6-sol', maxOutputTokens: 1_200, provider: 'openai', endpoint: 'responses' },
  { key: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', upstreamModel: 'deepseek-v4-flash', maxOutputTokens: 4_096, provider: 'deepseek', endpoint: 'chat-completions' }
]

export function loadAgentChatModelCatalog(rawExtension: string | undefined = process.env.SES_AGENT_CHAT_MODELS_JSON): AgentChatModelDefinition[] {
  if (rawExtension === undefined || rawExtension.trim() === '') {
    return defaultAgentChatModels.map((model) => ({ ...model }))
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(rawExtension)
  } catch {
    throw new AgentExecutionError('AGENT_MODEL_CONFIGURATION_INVALID', 'Agent 模型配置不是有效的 JSON。')
  }
  const parsed = agentChatModelExtensionSchema.safeParse(decoded)
  if (!parsed.success) {
    throw new AgentExecutionError('AGENT_MODEL_CONFIGURATION_INVALID', 'Agent 模型配置不符合受控 schema。')
  }
  const catalog = defaultAgentChatModels.map((model) => ({ ...model }))
  const knownKeys = new Set(catalog.map((model) => model.key))
  for (const extension of parsed.data) {
    if (knownKeys.has(extension.key)) {
      throw new AgentExecutionError('AGENT_MODEL_CONFIGURATION_INVALID', `Agent 模型 key 重复：${extension.key}`)
    }
    knownKeys.add(extension.key)
    catalog.push({
      key: extension.key,
      displayName: extension.displayName,
      upstreamModel: extension.model,
      maxOutputTokens: extension.maxOutputTokens ?? 1_200,
      provider: 'openai',
      endpoint: 'responses'
    })
  }
  return catalog
}

export function resolveAgentChatModel(catalog: readonly AgentChatModelDefinition[], key: string): AgentChatModelDefinition {
  const model = catalog.find((candidate) => candidate.key === key)
  if (model === undefined) {
    throw new AgentExecutionError('AGENT_MODEL_NOT_ALLOWED', '选择的 Agent 模型不在 Main 允许列表中。')
  }
  return model
}

export interface AgentJobCaseRecord {
  id: string
  version: number
  title: string
  updatedAt: string
  requiredSkills: string | null
  rate: string | null
  workStyle: string | null
  startDate: string | null
  status: AgentEntityStatus
}

export interface AgentCandidateMatchRecord {
  candidateProfileId: string
  sourceDocumentId?: string
  runId: string
  resultId: string
  resultHash: string
  rank: number
  anonymousLabel: string
  fitScore: number | null
  matched: string[]
  missing: string[]
  hardFilterStatus: 'passed' | 'failed' | 'unknown' | 'none'
  projectEvidence: string | null
  status: AgentEntityStatus
  assessment?: CandidateMatchAssessment | null
}

export interface AgentJobCaseSearchOutput {
  query: string
  dataAsOf: string
  updatedAfter: string
  updatedBefore: string
  totalMatched: number
  cases: AgentJobCaseRecord[]
}

export interface AgentCandidateMatchOutput {
  runId: string
  resultHash: string
  cards: AgentCandidateMatchRecord[]
  cloudReview?: AgentCloudReviewOutcome | null
}

export interface AgentMatchRunReadOutput {
  facts: AgentMatchRunFacts
}

export interface AgentCandidateProfileReadOutput {
  facts: AgentCandidateProfileFacts
}

export interface AgentCandidateInterviewReadOutput {
  facts: AgentCandidateInterviewFacts
}

export interface AgentResumeImportOutput {
  imported: Array<{
    documentId: string
    name: string
    format: string
    reviewRequired: true
    /** Locally extracted, identity-free draft shown in the importing turn. */
    facts?: AgentCandidateDraftFacts
  }>
  failed: Array<{ name: string; code: string }>
}

export interface AgentCandidateDraftReadOutput {
  facts: AgentCandidateDraftFacts
}

export interface AgentJobCaseDraftReadOutput {
  facts: AgentJobCaseDraftFacts[]
}

/** One queue row as the agent may see it: no source text, no copy detail. */
export interface AgentBroadcastQueueEntry {
  reviewId: string
  jobCaseId: string | null
  title: string
  status: 'new' | 'copied' | 'attention'
  /** The case moved on since the last copy, so the copied text is out of date. */
  hasUpdateSinceLastCopy: boolean
}

export interface AgentJobCaseBroadcastDraftOutput {
  cards: AgentJobCaseBroadcastCard[]
}

export interface AgentInterviewScheduleOutput {
  candidateLabel: string
  scheduledAt: string
  durationMinutes: number
  meetingMethod: 'zoom' | 'google-meet' | 'phone' | 'onsite'
  kind: 'recruiting' | 'client'
}

export type AgentToolResult =
  | { toolName: 'job-case.search.local'; output: AgentJobCaseSearchOutput; actionRunId?: string | null }
  | { toolName: 'candidate.match.local'; output: AgentCandidateMatchOutput; actionRunId?: string | null }
  | { toolName: 'candidate.profile.read.local'; output: AgentCandidateProfileReadOutput; actionRunId?: string | null }
  | { toolName: 'candidate.interview.read.local'; output: AgentCandidateInterviewReadOutput; actionRunId?: string | null }
  | { toolName: 'match-run.read.local'; output: AgentMatchRunReadOutput; actionRunId?: string | null }
  | { toolName: 'resume.analyze.local'; output: AgentResumeImportOutput; actionRunId?: string | null }
  | { toolName: 'candidate.draft.read.local'; output: AgentCandidateDraftReadOutput; actionRunId?: string | null }
  | { toolName: 'job-case.draft.read.local'; output: AgentJobCaseDraftReadOutput; actionRunId?: string | null }
  | { toolName: 'job-case.broadcast.draft.local'; output: AgentJobCaseBroadcastDraftOutput; actionRunId?: string | null }
  | { toolName: 'candidate.interview.schedule.local'; output: AgentInterviewScheduleOutput; actionRunId?: string | null }

export interface AgentToolExecutionMetadata {
  conversationId: string
  turnId: string
  requestId: string
}

/** Whether a confirmed case carries anything a fit score can be built from. */
export interface AgentJobCaseMatchability {
  scorableTermCount: number
  hardFilterTermCount: number
  reviewId: string | null
}

export interface LocalAgentPort {
  listActiveJobCases?(): AgentJobCaseRecord[]
  /** Local lookup, not a tool call: what the matcher would have to work with for this case. */
  describeJobCaseMatchability?(jobCaseId: string, jobCaseVersion: number | null): AgentJobCaseMatchability | null
  /** Local lookup, not a tool call: the confirmed case the side workspace is showing right now, if any. */
  workspaceJobCase?(access: AgentSystemAccessBlock | null): AgentJobCaseRecord | null
  /** Vault tokens attached to the turn being executed, in the order the operator added them. */
  listAttachmentFileTokens?(conversationId: string, requestId: string): string[]
  /** Local lookup, not a tool call: resolves a ranked candidate to the record an interview attaches to. */
  resolveInterviewCandidate?(runId: string, resultId: string | null, rank: number | null): { anonymousLabel: string; sourceDocumentId: string } | null
  /** Local lookup, not a tool call: what 案件配信 currently has to send. */
  listBroadcastQueue?(): AgentBroadcastQueueEntry[]
  /** Candidates that already have a review record and can therefore hold an interview. */
  listSchedulableCandidates?(): Array<{ anonymousLabel: string; sourceDocumentId: string }>
  /** Resumes imported during this conversation, by either the tool or the composer button. */
  listConversationImports?(conversationId: string): Array<{ anonymousLabel: string; sourceDocumentId: string }>
  isCancelled?(conversationId: string, requestId: string): boolean
  loadConversation(conversationId: string): AiConversationSnapshot | null
  saveConversation(input: SaveAiConversationInput): AiConversationSnapshot
  executeTool(
    toolName: Extract<DomainToolName, 'job-case.search.local' | 'candidate.match.local' | 'candidate.profile.read.local' | 'candidate.interview.read.local' | 'match-run.read.local' | 'resume.analyze.local' | 'candidate.draft.read.local' | 'job-case.draft.read.local' | 'job-case.broadcast.draft.local' | 'candidate.interview.schedule.local'>,
    input: unknown,
    metadata: AgentToolExecutionMetadata
  ): Promise<AgentToolResult>
  now?(): Date
  locale?(): ApplicationLocale
}

export type AgentPlannedToolAction =
  | {
      toolName: 'job-case.search.local'
      arguments:
        | { operation: 'search'; query: string | null; recent: boolean }
        | { operation: 'detail'; ordinal: number | null }
    }
  | { toolName: 'candidate.match.local'; arguments: { ordinal: number | null } }
  | { toolName: 'candidate.profile.read.local'; arguments: { rank: number | null } }
  | { toolName: 'candidate.interview.read.local'; arguments: { rank: number | null } }
  | { toolName: 'match-run.read.local'; arguments: { rank: number } }
  | { toolName: 'resume.analyze.local'; arguments: { attachmentOrdinal: number | null } }
  | { toolName: 'candidate.draft.read.local'; arguments: { draftOrdinal: number | null } }
  | { toolName: 'job-case.draft.read.local'; arguments: { draftOrdinal: number | null } }
  | { toolName: 'job-case.conversation-import.local'; arguments: Record<string, never> }
  | {
      toolName: 'job-case.broadcast.draft.local'
      arguments: { target: 'new-cases' | 'uncopied-cases' | 'case'; ordinal: number | null }
    }
  | {
      toolName: 'candidate.interview.schedule.local'
      arguments: {
        rank: number | null
        date: string | null
        time: string | null
        method: 'zoom' | 'google-meet' | 'phone' | 'onsite' | null
        durationMinutes: number | null
        kind: 'recruiting' | 'client' | null
        note: string | null
      }
    }

const nullableOrdinalSchema = z.number().int().min(1).max(20).nullable()
/**
 * Every field is optional because omission is the normal case: the operator
 * states a date and nothing else. A plan that leaves the rest out is a valid
 * plan for this tool - the app asks for what is missing. Formats are checked
 * for shape only; anything unusable is treated as missing and asked for rather
 * than failing the whole plan.
 */
const planningInterviewArgumentsSchema = z.object({
  rank: z.coerce.number().int().min(1).max(20).nullable().catch(null).optional().default(null),
  date: z.string().trim().max(40).nullable().catch(null).optional().default(null),
  time: z.string().trim().max(40).nullable().catch(null).optional().default(null),
  method: z.enum(['zoom', 'google-meet', 'phone', 'onsite']).nullable().catch(null).optional().default(null),
  // Preserve the operator's exact integer duration instead of snapping to a
  // preset. Values outside the local business bound become "not stated" and
  // are clarified rather than invalidating the entire plan.
  durationMinutes: z.coerce.number().int().min(5).max(480)
    .nullable().catch(null).optional().default(null),
  kind: z.enum(['recruiting', 'client']).nullable().catch(null).optional().default(null),
  note: z.string().trim().max(1_500).nullable().catch(null).optional().default(null)
})

/**
 * Tolerant for the same reason the interview schema is: a model writes
 * {"target":"new-cases"} and omits the rest. An unusable value becomes the
 * safe default - the whole new-case queue - instead of failing the plan.
 */
const planningBroadcastDraftArgumentsSchema = z.object({
  target: z.enum(['new-cases', 'uncopied-cases', 'case']).catch('new-cases').optional().default('new-cases'),
  ordinal: z.coerce.number().int().min(1).max(20).nullable().catch(null).optional().default(null)
})

const interviewDatePattern = /^\d{4}-\d{2}-\d{2}$/u
const interviewTimePattern = /^\d{2}:\d{2}$/u
const jstOffsetMilliseconds = 9 * 60 * 60 * 1_000

/** Converts an explicitly supplied JST wall-clock value to canonical UTC ISO. */
export function jstInterviewDateTimeToIso(date: string, time: string): string | null {
  if (!interviewDatePattern.test(date) || !interviewTimePattern.test(time)) return null
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  if (
    year === undefined || month === undefined || day === undefined ||
    hour === undefined || minute === undefined ||
    hour < 0 || hour > 23 || minute < 0 || minute > 59
  ) return null
  const utcMilliseconds = Date.UTC(year, month - 1, day, hour, minute) - jstOffsetMilliseconds
  const normalizedJst = new Date(utcMilliseconds + jstOffsetMilliseconds)
  if (
    normalizedJst.getUTCFullYear() !== year ||
    normalizedJst.getUTCMonth() !== month - 1 ||
    normalizedJst.getUTCDate() !== day ||
    normalizedJst.getUTCHours() !== hour ||
    normalizedJst.getUTCMinutes() !== minute
  ) return null
  return new Date(utcMilliseconds).toISOString()
}

const agentPlannedToolActionSchema = z.discriminatedUnion('toolName', [
  z.object({
    toolName: z.literal('job-case.search.local'),
    arguments: z.discriminatedUnion('operation', [
      z.object({
        operation: z.literal('search'),
        query: z.string().trim().min(1).max(200).nullable(),
        recent: z.boolean()
      }).strict(),
      z.object({ operation: z.literal('detail'), ordinal: nullableOrdinalSchema }).strict()
    ])
  }).strict(),
  z.object({
    toolName: z.literal('candidate.match.local'),
    arguments: z.object({ ordinal: nullableOrdinalSchema }).strict()
  }).strict(),
  z.object({
    toolName: z.literal('candidate.profile.read.local'),
    arguments: z.object({ rank: nullableOrdinalSchema }).strict()
  }).strict(),
  z.object({
    toolName: z.literal('candidate.interview.read.local'),
    arguments: z.object({ rank: nullableOrdinalSchema }).strict()
  }).strict(),
  z.object({
    toolName: z.literal('match-run.read.local'),
    arguments: z.object({ rank: z.number().int().min(1).max(20) }).strict()
  }).strict(),
  z.object({
    toolName: z.literal('resume.analyze.local'),
    arguments: z.object({ attachmentOrdinal: nullableOrdinalSchema }).strict()
  }).strict(),
  z.object({
    toolName: z.literal('candidate.draft.read.local'),
    arguments: z.object({ draftOrdinal: nullableOrdinalSchema }).strict()
  }).strict(),
  z.object({
    toolName: z.literal('job-case.draft.read.local'),
    arguments: z.object({ draftOrdinal: nullableOrdinalSchema }).strict()
  }).strict(),
  z.object({
    toolName: z.literal('job-case.broadcast.draft.local'),
    arguments: planningBroadcastDraftArgumentsSchema
  }).strict(),
  z.object({
    toolName: z.literal('job-case.conversation-import.local'),
    arguments: z.object({}).strict()
  }).strict(),
  z.object({
    toolName: z.literal('candidate.interview.schedule.local'),
    arguments: planningInterviewArgumentsSchema
  }).strict()
])

export function parseAgentPlannedToolAction(value: unknown): AgentPlannedToolAction {
  const parsed = agentPlannedToolActionSchema.safeParse(value)
  if (!parsed.success) {
    throw new AgentExecutionError('AGENT_PLAN_INVALID', 'AI 返回的 Tool 计划不符合受控 schema。')
  }
  return parsed.data
}

interface AgentPlanningToolCatalogEntry {
  name: string
  description: string
  argumentsShape: string
  effect: 'read' | 'compute' | 'write'
  approval: 'none' | 'required'
  parse(argumentsValue: unknown): AgentPlannedToolAction
}

const planningDraftArgumentsSchema = z.object({
  draftOrdinal: z.number().int().min(1).max(10).nullable()
}).strict()

const planningAttachmentArgumentsSchema = z.object({
  attachmentOrdinal: z.number().int().min(1).max(10).nullable()
}).strict()

const planningSearchArgumentsSchema = z.object({
  query: z.string().trim().min(1).max(200).nullable(),
  recent: z.boolean()
}).strict()
const planningNullableOrdinalArgumentsSchema = z.object({ ordinal: nullableOrdinalSchema }).strict()
const planningNullableRankArgumentsSchema = z.object({ rank: nullableOrdinalSchema }).strict()
const planningRankArgumentsSchema = z.object({ rank: z.number().int().min(1).max(20) }).strict()

export const agentPlanningToolCatalog: readonly AgentPlanningToolCatalogEntry[] = [
  {
    name: 'search_job_cases',
    description: 'List, filter, or search active job cases. Use recent=true for recent-case requests.',
    argumentsShape: '{"query":string|null,"recent":boolean}',
    effect: 'read', approval: 'none',
    parse: (value) => ({ toolName: 'job-case.search.local', arguments: { operation: 'search', ...planningSearchArgumentsSchema.parse(value) } })
  },
  {
    name: 'show_job_case_detail',
    description: 'Read one job case selected from prior case results. ordinal may be null only when the current case is already selected.',
    argumentsShape: '{"ordinal":number|null}',
    effect: 'read', approval: 'none',
    parse: (value) => ({ toolName: 'job-case.search.local', arguments: { operation: 'detail', ...planningNullableOrdinalArgumentsSchema.parse(value) } })
  },
  {
    name: 'match_candidates',
    description: 'Run or rerun local candidate matching for a selected case. Do not use it just to answer a follow-up about an existing candidate.',
    argumentsShape: '{"ordinal":number|null}',
    effect: 'compute', approval: 'none',
    parse: (value) => ({ toolName: 'candidate.match.local', arguments: planningNullableOrdinalArgumentsSchema.parse(value) })
  },
  {
    name: 'read_candidate_profile',
    description: 'Read the confirmed structured resume/profile of a candidate from the latest saved match, including Japanese level, skills, role, availability, rate, work style, location, work authorization, and project experience. Use for short follow-ups such as 日语呢. rank may be null only when exactly one candidate is in context.',
    argumentsShape: '{"rank":number|null}',
    effect: 'read', approval: 'none',
    parse: (value) => ({ toolName: 'candidate.profile.read.local', arguments: planningNullableRankArgumentsSchema.parse(value) })
  },
  {
    name: 'read_candidate_interviews',
    description: 'Read recruiting and client interview status, schedule metadata, goals, notes, unresolved items, and decisions for a candidate from the latest saved match. rank may be null only when exactly one candidate is in context.',
    argumentsShape: '{"rank":number|null}',
    effect: 'read', approval: 'none',
    parse: (value) => ({ toolName: 'candidate.interview.read.local', arguments: planningNullableRankArgumentsSchema.parse(value) })
  },
  {
    name: 'import_resume',
    description: 'Import resume or skill-sheet files the operator attached to this turn. Only usable when the turn carries attachments. attachmentOrdinal may be null to import every attachment. Imported information is available for business use; the operator can correct fields in personnel details when needed.',
    argumentsShape: '{"attachmentOrdinal":number|null}',
    effect: 'write', approval: 'none',
    parse: (value) => ({ toolName: 'resume.analyze.local', arguments: planningAttachmentArgumentsSchema.parse(value) })
  },
  {
    name: 'read_imported_draft',
    description: 'Read the extracted content of a resume imported earlier in this conversation, to summarise or answer questions about that person using its recorded values and project evidence. Mention specific missing information when relevant; do not require a blanket field review. draftOrdinal may be null when exactly one resume was imported.',
    argumentsShape: '{"draftOrdinal":number|null}',
    effect: 'read', approval: 'none',
    parse: (value) => ({ toolName: 'candidate.draft.read.local', arguments: planningDraftArgumentsSchema.parse(value) })
  },
  {
    name: 'read_imported_case_drafts',
    description: 'Read job cases imported from business text pasted earlier in this conversation: title, skills, rate, location, start date, Japanese level, interview and the other case fields, including specific missing values. Use it for "these cases", "第N条", which cases lack a field, or comparisons between cases. draftOrdinal null reads every case of the latest paste. Only usable when state.intakeDraftCount is above zero.',
    argumentsShape: '{"draftOrdinal":number|null}',
    effect: 'read', approval: 'none',
    parse: (value) => ({ toolName: 'job-case.draft.read.local', arguments: planningDraftArgumentsSchema.parse(value) })
  },
  {
    name: 'import_case_from_conversation',
    description: 'Record as job cases the business text the operator pasted in an earlier message of this conversation - 记录成案件, 案件として登録して, 把刚才的案件录入. Use it whenever the operator asks to record, register, or import text pasted before, even when an earlier turn only summarized that text. Main re-reads the earlier message locally, so nothing needs to be pasted again. Such a request must never become a direct answer, and nothing may ever be described as recorded unless this tool ran.',
    argumentsShape: '{}',
    effect: 'write', approval: 'none',
    parse: () => ({ toolName: 'job-case.conversation-import.local', arguments: {} })
  },
  {
    name: 'schedule_interview',
    description: 'Schedule an interview for a candidate. Fill only what the operator actually stated and leave everything else null - the app asks them for the missing details rather than choosing on their behalf. Set rank only when they named a position in a match result; for "this person" or a single imported resume leave it null, because the app resolves who is meant. date is YYYY-MM-DD and time is HH:mm in JST.',
    argumentsShape: '{"rank":number|null,"date":string|null,"time":string|null,"method":"zoom"|"google-meet"|"phone"|"onsite"|null,"durationMinutes":integer(5..480)|null,"kind":"recruiting"|"client"|null,"note":string|null}',
    effect: 'write', approval: 'none',
    parse: (value) => ({ toolName: 'candidate.interview.schedule.local', arguments: planningInterviewArgumentsSchema.parse(value) })
  },
  {
    name: 'draft_case_broadcasts',
    description: 'Write the ready-to-paste message (紹介文) for confirmed job cases, in Japanese and Chinese, so the operator can copy it into WeChat themselves. target "new-cases" takes every case never copied yet - use it for 把今天的新案件整理成群消息 / 今日の新規案件を群メッセージにして; "uncopied-cases" adds the ones revised since they were last copied - use it for 今天还有哪些没发 / まだ出していない案件は; "case" is one case, with ordinal naming it among the drafted or listed cases, or null when a case is already selected. It only writes the text: this app never sends anything and never knows where a message went.',
    argumentsShape: '{"target":"new-cases"|"uncopied-cases"|"case","ordinal":number|null}',
    effect: 'read', approval: 'none',
    parse: (value) => ({ toolName: 'job-case.broadcast.draft.local', arguments: planningBroadcastDraftArgumentsSchema.parse(value) })
  },
  {
    name: 'read_match_result',
    description: 'Read saved ranking evidence and explain why a candidate ranked at a position without rerunning matching.',
    argumentsShape: '{"rank":number}',
    effect: 'read', approval: 'none',
    parse: (value) => ({ toolName: 'match-run.read.local', arguments: planningRankArgumentsSchema.parse(value) })
  }
]

export function describeAgentPlanningTools(): string {
  return agentPlanningToolCatalog
    .map((tool) => `${tool.name} ${tool.argumentsShape} [effect=${tool.effect}, approval=${tool.approval}]: ${tool.description}`)
    .join('\n')
}

export function parseAgentRequestedTool(value: unknown): AgentPlannedToolAction {
  const envelope = z.object({ name: z.string().min(1).max(120), arguments: z.unknown() }).strict().safeParse(value)
  if (!envelope.success) throw new AgentExecutionError('AGENT_PLAN_INVALID', 'AI 返回的 Tool 请求不符合目录协议。')
  const tool = agentPlanningToolCatalog.find((entry) => entry.name === envelope.data.name)
  if (!tool) throw new AgentExecutionError('AGENT_PLAN_INVALID', `AI 请求了未知 Tool：${envelope.data.name}`)
  try {
    return parseAgentPlannedToolAction(tool.parse(envelope.data.arguments))
  } catch (error) {
    if (error instanceof AgentExecutionError) throw error
    const detail = error instanceof z.ZodError
      ? error.issues.slice(0, 3).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
      : null
    throw new AgentExecutionError(
      'AGENT_PLAN_INVALID',
      `AI 为 Tool ${envelope.data.name} 返回了无效参数${detail ? `（${detail}）` : ''}。`
    )
  }
}

export class AgentExecutionError extends Error {
  constructor(readonly code: string, message: string, readonly actionRunId: string | null = null) {
    super(message)
    this.name = 'AgentExecutionError'
  }
}

export function recentJstWindow(now = new Date()): { updatedAfter: string; updatedBefore: string } {
  const day = 24 * 60 * 60 * 1_000
  const jstOffset = 9 * 60 * 60 * 1_000
  const jstMidnight = Math.floor((now.getTime() + jstOffset) / day) * day - jstOffset
  return {
    updatedAfter: new Date(jstMidnight - 29 * day).toISOString(),
    updatedBefore: new Date(jstMidnight + day).toISOString()
  }
}

function salesAgentContext(input: ExecuteAgentTurnInput): AiConversationContext {
  return {
    assistant: 'sales-agent',
    ...(input.businessObject ? { businessObject: input.businessObject } : {}),
    candidateDocumentId: null,
    interviewId: null,
    interviewKind: null,
    roundNumber: null
  }
}

function defaultState(): AiConversationSalesAgentState {
  return { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null, lastIntakeBatch: null }
}

interface IntakeBatchEntry {
  reviewId: string
  ordinal: number
  label: string
  outcome: AgentJobCaseDraftCard['outcome']
}

/**
 * The drafts the latest business-text paste produced, resolved from the
 * conversation state first and from the newest intake card block otherwise.
 * Ordinals are paste order; a deleted draft keeps its slot so "第3条" still
 * means the third pasted record.
 */
function latestIntakeBatch(
  state: AiConversationSalesAgentState,
  messages: AiConversationMessage[]
): { intakeBatchId: string; entries: IntakeBatchEntry[] } | null {
  const blocks = messages
    .flatMap((message) => (message.blocks ?? []).map((block) => ({ messageId: message.id, block })))
    .filter((item): item is { messageId: string; block: Extract<AiConversationBlock, { type: 'job-case-draft-cards' }> } =>
      item.block.type === 'job-case-draft-cards')
  const pointer = state.lastIntakeBatch
  if (pointer) {
    const source = blocks.find((item) => item.messageId === pointer.messageId)?.block
    return {
      intakeBatchId: pointer.intakeBatchId,
      entries: pointer.reviewIds.map((reviewId, index) => {
        const card = source?.cards.find((item) => item.reviewId === reviewId)
        return { reviewId, ordinal: card?.ordinal ?? index + 1, label: card?.label ?? `DRAFT_${index + 1}`, outcome: card?.outcome ?? 'existing-review' }
      })
    }
  }
  const latest = blocks.at(-1)?.block
  if (!latest) return null
  return {
    intakeBatchId: latest.intakeBatchId,
    entries: latest.cards.map((card) => ({ reviewId: card.reviewId, ordinal: card.ordinal, label: card.label, outcome: card.outcome }))
  }
}

function textFor(locale: ApplicationLocale, ja: string, zh: string): string {
  return locale === 'zh-CN' ? zh : ja
}

function typedReference(
  kind: TypedAiConversationReference['kind'],
  objectId: string,
  label: string,
  objectVersion: number | null,
  resultHash: string | null,
  ordinal: number | null
): TypedAiConversationReference {
  return {
    kind,
    objectId,
    objectVersion,
    resultHash,
    ordinal,
    label,
    target: `${kind}:${objectId}`
  }
}

function jobCaseCard(record: AgentJobCaseRecord, ordinal: number): AgentJobCaseCard {
  return {
    reference: typedReference('job-case', record.id, record.title, record.version, null, ordinal),
    title: record.title,
    version: record.version,
    updatedAt: record.updatedAt,
    requiredSkills: record.requiredSkills,
    rate: record.rate,
    workStyle: record.workStyle,
    startDate: record.startDate,
    status: record.status
  }
}

function candidateCard(record: AgentCandidateMatchRecord, ordinal: number): AgentCandidateMatchCard {
  return {
    reference: typedReference('match-result', record.resultId, record.anonymousLabel, null, record.resultHash, ordinal),
    candidateProfileId: record.candidateProfileId,
    ...(record.sourceDocumentId ? { sourceDocumentId: record.sourceDocumentId } : {}),
    runId: record.runId,
    rank: record.rank,
    anonymousLabel: record.anonymousLabel,
    fitScore: record.fitScore,
    matched: record.matched,
    missing: record.missing,
    hardFilterStatus: record.hardFilterStatus,
    projectEvidence: record.projectEvidence,
    status: record.status,
    ...(record.assessment ? { assessment: record.assessment } : {})
  }
}

function flattenReferences(blocks: AiConversationBlock[]): AiConversationReference[] {
  return blocks.flatMap((block) => {
    if (block.type === 'job-case-cards') return block.cards.map((card) => card.reference)
    if (block.type === 'candidate-match-cards') return block.cards.map((card) => card.reference)
    if (block.type === 'clarification') return block.options
    if (block.type === 'match-run-explanation') {
      const candidate = block.facts.candidate?.reference
      return candidate ? [candidate, typedReference('match-run', block.facts.runId, `Match Run ${block.facts.runId.slice(0, 8)}`, block.facts.jobCaseVersion, block.facts.resultHash, null)] : []
    }
    return []
  })
}

function latestSearchReferences(messages: AiConversationMessage[]): TypedAiConversationReference[] {
  const message = [...messages].reverse().find((item) => item.role === 'assistant' && item.blocks?.some((block) => block.type === 'job-case-cards'))
  const block = message?.blocks?.find((item) => item.type === 'job-case-cards')
  return block?.type === 'job-case-cards' ? block.cards.map((card) => card.reference) : []
}

function latestMatchReferences(messages: AiConversationMessage[]): TypedAiConversationReference[] {
  const message = [...messages].reverse().find((item) => item.role === 'assistant' && item.blocks?.some((block) => block.type === 'candidate-match-cards'))
  const block = message?.blocks?.find((item) => item.type === 'candidate-match-cards')
  return block?.type === 'candidate-match-cards' ? block.cards.map((card) => card.reference) : []
}

/** How many cases one drafting turn may write messages for. */
export const agentBroadcastDraftLimit = 8

/** The group messages the latest drafting turn produced; the newest block wins. */
function latestBroadcastCards(messages: AiConversationMessage[]): AgentJobCaseBroadcastCard[] {
  const block = [...messages].reverse()
    .flatMap((message) => message.blocks ?? [])
    .find((item) => item.type === 'job-case-broadcast-cards')
  return block?.type === 'job-case-broadcast-cards' ? block.cards : []
}

function canonicalJobCaseReference(reference: TypedAiConversationReference, records: AgentJobCaseRecord[]): TypedAiConversationReference | null {
  const record = records.find((item) => item.id === reference.objectId && item.version === reference.objectVersion && item.status === 'current')
  if (!record) return null
  const ordinal = Math.max(1, records.findIndex((item) => item.id === record.id && item.version === record.version) + 1)
  return jobCaseCard(record, ordinal).reference
}

function resolveJobCaseReference(
  records: AgentJobCaseRecord[],
  state: AiConversationSalesAgentState,
  messages: AiConversationMessage[],
  selectedJobCaseRef: TypedAiConversationReference | null | undefined,
  ordinal: number | null,
  locale: ApplicationLocale,
  workspaceRecord: AgentJobCaseRecord | null = null
): { reference: TypedAiConversationReference } | { clarification: AgentClarificationBlock } {
  const explicit = selectedJobCaseRef ?? state.selectedJobCaseRef
  if (explicit) {
    const canonical = canonicalJobCaseReference(explicit, records)
    if (canonical) return { reference: canonical }
    return {
      clarification: {
        type: 'clarification',
        code: 'STALE_REFERENCE',
        prompt: textFor(locale, '現在の案件バージョンが変わったか、アーカイブされています。案件を選び直してください。', '当前案件版本已变化或已归档，请重新选择案件后再继续。'),
        options: records.slice(0, 20).map((record, index) => jobCaseCard(record, index + 1).reference)
      }
    }
  }
  const candidates = latestSearchReferences(messages)
  if (ordinal !== null) {
    const selected = candidates[ordinal - 1]
    if (selected) {
      const canonical = canonicalJobCaseReference(selected, records)
      if (canonical) return { reference: canonical }
    }
    if (selected) {
      return {
        clarification: {
          type: 'clarification', code: 'STALE_REFERENCE',
          prompt: textFor(locale, 'この案件のバージョンが変わったか、アーカイブされています。案件一覧から選び直してください。', '这个案件的版本已变化或已归档，请重新从案件列表选择。'), options: candidates
        }
      }
    }
  }
  // Nothing selected in this conversation and no ordinal: 「当前案件」 is the case
  // the operator has open in the side workspace, when one is showing.
  if (workspaceRecord) {
    const canonical = canonicalJobCaseReference(jobCaseCard(workspaceRecord, 1).reference, records)
    if (canonical) return { reference: canonical }
  }
  if (candidates.length === 1) {
    const canonical = canonicalJobCaseReference(candidates[0]!, records)
    if (canonical) return { reference: canonical }
  }
  if (records.length === 1) return { reference: jobCaseCard(records[0]!, 1).reference }
  if (records.length === 0) {
    return { clarification: { type: 'clarification', code: 'NO_ACTIVE_JOB_CASE', prompt: textFor(locale, '現在利用できる Active 案件がありません。案件を取り込み、確認してください。', '当前没有可用的 Active 案件，请先导入并确认案件。'), options: [] } }
  }
  return {
    clarification: {
      type: 'clarification', code: 'SELECT_JOB_CASE', prompt: textFor(locale, '操作する案件を先に選択してください。', '请先选择要操作的案件。'),
      options: records.slice(0, 20).map((record, index) => jobCaseCard(record, index + 1).reference)
    }
  }
}

/**
 * Which case a broadcast request means. Ordinals name the messages this
 * conversation just drafted first, then the drafts a paste produced, and only
 * then the case list a search produced - each is a stronger claim about "第2条"
 * than the one below it. Whatever resolves must still be in the 配信 queue.
 */
function resolveBroadcastCase(
  queue: AgentBroadcastQueueEntry[],
  records: AgentJobCaseRecord[],
  state: AiConversationSalesAgentState,
  messages: AiConversationMessage[],
  selectedJobCaseRef: TypedAiConversationReference | null | undefined,
  ordinal: number | null,
  locale: ApplicationLocale,
  workspaceRecord: AgentJobCaseRecord | null = null
): { entry: AgentBroadcastQueueEntry } | { clarification: AgentClarificationBlock } {
  const byReviewId = (reviewId: string) => queue.find((item) => item.reviewId === reviewId) ?? null
  if (ordinal !== null) {
    const drafted = latestBroadcastCards(messages).find((card) => card.ordinal === ordinal)
    const draftedEntry = drafted ? byReviewId(drafted.reviewId) : null
    if (draftedEntry) return { entry: draftedEntry }
    const intake = latestIntakeBatch(state, messages)?.entries.find((entry) => entry.ordinal === ordinal)
    const intakeEntry = intake ? byReviewId(intake.reviewId) : null
    if (intakeEntry) return { entry: intakeEntry }
  }
  const resolved = resolveJobCaseReference(records, state, messages, selectedJobCaseRef, ordinal, locale, workspaceRecord)
  if ('clarification' in resolved) return resolved
  const entry = queue.find((item) => item.jobCaseId === resolved.reference.objectId)
  if (entry) return { entry }
  return {
    clarification: {
      type: 'clarification',
      code: 'SELECT_JOB_CASE',
      prompt: textFor(
        locale,
        'この案件は配信キューにありません。配信する案件を選んでください。',
        '这个案件不在配信队列里，请选择要配信的案件。'
      ),
      options: records.slice(0, 20).map((record, index) => jobCaseCard(record, index + 1).reference)
    }
  }
}

function resolveMatchRunReference(
  state: AiConversationSalesAgentState,
  messages: AiConversationMessage[],
  rank: number | null,
  locale: ApplicationLocale
): { runId: string; resultId?: string; rank: number } | { clarification: AgentClarificationBlock } {
  const matchReferences = latestMatchReferences(messages)
  const effectiveRank = rank ?? (matchReferences.length === 1 ? (matchReferences[0]?.ordinal ?? 1) : null)
  if (effectiveRank === null) {
    return {
      clarification: {
        type: 'clarification', code: 'SELECT_RESULT',
        prompt: textFor(locale, '確認する候補者を順位で指定してください。', '请指定要查询的候选人排名。'),
        options: matchReferences
      }
    }
  }
  const selected = matchReferences.find((reference) => reference.ordinal === effectiveRank) ?? matchReferences[effectiveRank - 1]
  const latestMatchBlock = [...messages].reverse()
    .flatMap((message) => message.blocks ?? [])
    .find((block) => block.type === 'candidate-match-cards')
  if (selected?.kind === 'match-result' && latestMatchBlock?.type === 'candidate-match-cards') {
    return { runId: latestMatchBlock.runId, resultId: selected.objectId, rank: effectiveRank }
  }
  if (state.lastMatchRunId) return { runId: state.lastMatchRunId, resultId: selected?.kind === 'match-result' ? selected.objectId : undefined, rank: effectiveRank }
  const runReference = messages.flatMap((message) => message.references ?? []).find((reference) => reference.kind === 'match-run')
  if (runReference?.objectId) return { runId: runReference.objectId, rank: effectiveRank }
  return {
    clarification: {
      type: 'clarification', code: 'SELECT_RESULT', prompt: textFor(locale, '先に案件マッチングを実行して、説明する候補者の結果を選択してください。', '请先运行案件匹配并选择要解释的候选人结果。'), options: matchReferences
    }
  }
}

function userMessage(input: ExecuteAgentTurnInput, turnId: string): AiConversationMessage {
  return { id: randomUUID(), role: 'user', content: input.message.trim(), mode: 'local', turnId, createdAt: new Date().toISOString() }
}

function assistantMessage(content: string, blocks: AiConversationBlock[], turnId: string): AiConversationMessage {
  return {
    id: randomUUID(), role: 'assistant', content, mode: 'local', narrativeStatus: 'local', turnId,
    blocks, references: flattenReferences(blocks), createdAt: new Date().toISOString()
  }
}

function errorBlock(error: unknown, locale: ApplicationLocale): AgentErrorBlock {
  if (error instanceof AgentExecutionError) {
    const message = error.code === 'TURN_CANCELLED'
      ? textFor(locale, '現在の案件マッチングをキャンセルしました。', '当前案件匹配操作已取消。')
      : error.code === 'CONVERSATION_REVISION_CONFLICT'
        ? textFor(locale, '会話が別の窗口で更新されました。履歴を再読み込みしてから送信してください。', '会话已在其他窗口更新，请重新加载历史后再发送。')
        : error.message
    return { type: 'error', code: error.code, message }
  }
  return { type: 'error', code: 'AGENT_TURN_FAILED', message: textFor(locale, 'ローカル案件 Agent の実行に失敗しました。再試行するか、詳細マッチングを開いてください。', '本地案件 Agent 执行失败，请重试或打开经典匹配页。') }
}

/**
 * Booking intent, detected deterministically rather than trusted to the planner.
 *
 * read_candidate_interviews and schedule_interview kept being confused, and two
 * rounds of prompt wording did not settle it. The plan is a request, not a
 * command, so main redirects one that cannot serve what was asked.
 *
 * The verb has to precede the noun, which is what separates "安排面试" (book one)
 * from "面试安排" (the existing schedule) - the read tool keeps the latter.
 */
export function looksLikeInterviewBookingRequest(message: string): boolean {
  const text = message.normalize('NFKC').toLocaleLowerCase('en-US')
  const noun = '(?:面试|面談|面接|interview)'
  const verb = '(?:安排|预约|約|约|予約|設定|设定|定)'
  return (
    // Verb before noun: 安排面试 books one, 面试安排 is the existing schedule.
    new RegExp(`${verb}[^。.!?]{0,12}${noun}`, 'u').test(text) ||
    // Japanese puts the verb last: 面談を設定する.
    new RegExp(`${noun}\\s*[をのは]?\\s*(?:を)?[^。.!?]{0,6}(?:設定|予約|セット|組ん?で|入れて)`, 'u').test(text) ||
    /(?:schedule|book|arrange|set\s*up|rebook|reschedule)[^.!?]{0,20}interview/u.test(text)
  )
}

function latestInterviewDetailsClarificationIndex(messages: readonly AiConversationMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const hasClarification = (messages[index]?.blocks ?? []).some((block) =>
      block.type === 'clarification' && block.code === 'INTERVIEW_DETAILS_REQUIRED'
    )
    if (hasClarification) return index
  }
  return -1
}

export function hasPendingInterviewDetailsClarification(messages: readonly AiConversationMessage[]): boolean {
  return latestInterviewDetailsClarificationIndex(messages) >= 0
}

type LocalMeetingLinkResolution =
  | { status: 'none'; link: null }
  | { status: 'resolved'; link: AllowedInterviewMeetingLink }
  | { status: 'conflict'; link: null }

/**
 * Meeting URLs are resolved from local conversation text only. They never
 * become planner arguments and therefore never have to leave the device.
 */
function resolveLocalMeetingLink(
  currentMessage: string,
  previousMessages: readonly AiConversationMessage[]
): LocalMeetingLinkResolution {
  const current = extractAllowedInterviewMeetingLinks(currentMessage)
  if (current.length > 1) return { status: 'conflict', link: null }
  if (current.length === 1) return { status: 'resolved', link: current[0]! }

  const clarificationIndex = latestInterviewDetailsClarificationIndex(previousMessages)
  if (clarificationIndex < 0) return { status: 'none', link: null }
  // Include the user request immediately before the clarification: it may have
  // supplied the link while the app asked only for date, time, or duration.
  for (let index = previousMessages.length - 1; index >= Math.max(0, clarificationIndex - 1); index -= 1) {
    const message = previousMessages[index]
    if (message?.role !== 'user') continue
    const links = extractAllowedInterviewMeetingLinks(message.content)
    if (links.length > 1) return { status: 'conflict', link: null }
    if (links.length === 1) return { status: 'resolved', link: links[0]! }
  }
  return { status: 'none', link: null }
}

export class LocalAgentUseCase {
  constructor(private readonly port: LocalAgentPort) {}

  loadPlanningConversation(input: ExecuteAgentTurnInput): AiConversationSnapshot | null {
    return this.loadCurrentConversation(input)
  }

  async execute(input: ExecuteAgentTurnInput, rawPlannedAction: AgentPlannedToolAction): Promise<{
    status: 'clarifying' | 'completed' | 'failed' | 'cancelled'
    requestId: string
    conversation: AiConversationSnapshot
    assistantMessage: AiConversationMessage
    toolName: DomainToolName | null
    actionRunId: string | null
  }> {
    const current = this.loadCurrentConversation(input)
    const branchRootConversationId = this.resolveBranchRootConversationId(input, current)
    const requestedAction = parseAgentPlannedToolAction(rawPlannedAction)
    // The planner keeps choosing the read tool for a booking, and two rounds of
    // prompt wording did not settle it. A plan is a request; main redirects one
    // that cannot serve what was asked.
    // Every read tool resolves through the match run and answers a booking with
    // "specify the candidate rank to query". None of them can create a booking,
    // so redirecting any of them is safe; only the interview read tool was
    // covered before and the planner simply picked a different one.
    const readToolsThatCannotBook: ReadonlySet<AgentPlannedToolAction['toolName']> = new Set([
      'candidate.interview.read.local',
      'candidate.profile.read.local',
      'match-run.read.local'
    ])
    const plannedAction: AgentPlannedToolAction =
      readToolsThatCannotBook.has(requestedAction.toolName) && looksLikeInterviewBookingRequest(input.message)
        ? { toolName: 'candidate.interview.schedule.local', arguments: {
            rank: null, date: null, time: null, method: null, durationMinutes: null, kind: null, note: null
          } }
        : requestedAction
    if (plannedAction.toolName === 'job-case.conversation-import.local') {
      // Main intercepts this plan before execute: the intake pipeline owns the
      // write and stamps business-text.import.local on its ActionRuns.
      throw new AgentExecutionError('AGENT_PLAN_INVALID', '会话导入必须由 Main 预处理执行。')
    }
    const turnId = randomUUID()
    const previousMessages = current?.messages ?? []
    const previousState = { ...(current?.salesAgentState ?? defaultState()),
      ...(input.selectedCandidateDocumentId !== undefined ? { selectedCandidateDocumentId: input.selectedCandidateDocumentId } : {})
    }
    const inputMessage = userMessage(input, turnId)
    const messages = [...previousMessages, inputMessage].slice(-200)
    const locale = this.port.locale?.() ?? 'ja-JP'
    const now = this.port.now?.() ?? new Date()
    const save = (assistant: AiConversationMessage, state: AiConversationSalesAgentState, status: 'clarifying' | 'completed' | 'failed' | 'cancelled', toolName: DomainToolName | null, actionRunId: string | null) => {
      const saveInput: SaveAiConversationInput = {
        conversationId: input.conversationId,
        ...(branchRootConversationId ? { branchRootConversationId } : {}),
        context: current?.context ?? salesAgentContext(input),
        messages: [...messages, assistant].slice(-200),
        salesAgentState: state,
        expectedRevision: input.expectedConversationRevision
      }
      const conversation = this.port.saveConversation(saveInput)
      return { status, requestId: input.requestId, conversation, assistantMessage: assistant, toolName, actionRunId }
    }

    try {
      if (this.port.isCancelled?.(input.conversationId, input.requestId)) {
        throw new AgentExecutionError('TURN_CANCELLED', '当前案件匹配操作已取消。')
      }
      if (plannedAction.toolName === 'job-case.search.local' && plannedAction.arguments.operation === 'search') {
        const range = plannedAction.arguments.recent
          ? recentJstWindow(now)
          : { updatedAfter: '1970-01-01T00:00:00.000Z', updatedBefore: '9999-12-31T23:59:59.999Z' }
        const tool = await this.port.executeTool('job-case.search.local', {
          mode: 'recent', query: plannedAction.arguments.query, updatedAfter: range.updatedAfter, updatedBefore: range.updatedBefore,
          lifecycle: 'active', limit: 20,
          ...(previousState.selectedCandidateDocumentId && isCandidateCaseRequest(input.message) ? { candidateDocumentId: previousState.selectedCandidateDocumentId } : {})
        }, { conversationId: input.conversationId, turnId, requestId: input.requestId })
        if (tool.toolName !== 'job-case.search.local') throw new AgentExecutionError('TOOL_RESULT_INVALID', '案件查询结果无效。')
        const cards = tool.output.cases.map((record, index) => jobCaseCard(record, index + 1))
        const block: AgentJobCaseCardsBlock = {
          type: 'job-case-cards', query: tool.output.query, dataAsOf: tool.output.dataAsOf,
          normalizedFilters: { updatedAfter: tool.output.updatedAfter, updatedBefore: tool.output.updatedBefore, lifecycle: 'active', query: plannedAction.arguments.query, limit: 20 },
          totalMatched: tool.output.totalMatched, cards
        }
        const content = plannedAction.arguments.recent
          ? cards.length > 0
            ? textFor(locale, `直近30日以内の Active 案件は${tool.output.totalMatched}件です。更新日時の新しい順に表示します。`, `最近 30 天有 ${tool.output.totalMatched} 个 Active 案件，按更新时间倒序显示。`)
            : textFor(locale, '直近30日以内に Active 案件はありません。', '最近 30 天没有找到 Active 案件。')
          : cards.length > 0
            ? textFor(locale, `現在の Active 案件は${tool.output.totalMatched}件です。更新日時の新しい順に表示します。`, `当前有 ${tool.output.totalMatched} 个 Active 案件，按更新时间倒序显示。`)
            : textFor(locale, '現在利用できる Active 案件はありません。', '当前没有可用的 Active 案件。')
        const assistant = assistantMessage(content, [
          block,
          { type: 'system-access', destination: 'job-cases' }
        ], turnId)
        return save(assistant, { ...previousState, lastSearchMessageId: assistant.id }, 'completed', 'job-case.search.local', tool.actionRunId ?? null)
      }

      if (plannedAction.toolName === 'job-case.search.local' && plannedAction.arguments.operation === 'detail') {
        const resolved = resolveJobCaseReference(this.loadRecords(), previousState, previousMessages, input.selectedJobCaseRef, plannedAction.arguments.ordinal, locale, this.workspaceJobCase(input))
        if ('clarification' in resolved) {
          const assistant = assistantMessage(resolved.clarification.prompt, [resolved.clarification], turnId)
          return save(assistant, previousState, 'clarifying', null, null)
        }
        const tool = await this.port.executeTool('job-case.search.local', {
          mode: 'by-id', caseId: resolved.reference.objectId, query: null, updatedAfter: null, updatedBefore: null, lifecycle: 'active', limit: 1
        }, { conversationId: input.conversationId, turnId, requestId: input.requestId })
        if (tool.toolName !== 'job-case.search.local') throw new AgentExecutionError('TOOL_RESULT_INVALID', '案件详情结果无效。')
        const cards = tool.output.cases.map((record) => jobCaseCard(record, 1))
        const block: AgentJobCaseCardsBlock = {
          type: 'job-case-cards', query: cards[0]?.title ?? '', dataAsOf: tool.output.dataAsOf,
          normalizedFilters: { updatedAfter: tool.output.updatedAfter, updatedBefore: tool.output.updatedBefore, lifecycle: 'active', query: null, limit: 1 },
          totalMatched: tool.output.totalMatched, cards
        }
        const content = cards[0]
          ? textFor(locale, `案件「${cards[0].title}」の現在のバージョンは v${cards[0].version} です。`, `这是案件「${cards[0].title}」的当前版本 v${cards[0].version}。`)
          : textFor(locale, 'この案件は存在しないか、現在利用できません。', '这个案件已不存在或不可用。')
        const accessBlock: AiConversationBlock = cards[0]
          ? { type: 'system-access', destination: 'matching', jobCaseId: resolved.reference.objectId }
          : { type: 'system-access', destination: 'job-cases' }
        const assistant = assistantMessage(content, [block, accessBlock], turnId)
        return save(assistant, { ...previousState, selectedJobCaseRef: cards[0]?.reference ?? resolved.reference, lastSearchMessageId: assistant.id }, 'completed', 'job-case.search.local', tool.actionRunId ?? null)
      }

      if (plannedAction.toolName === 'candidate.match.local') {
        const resolved = resolveJobCaseReference(this.loadRecords(), previousState, previousMessages, input.selectedJobCaseRef, plannedAction.arguments.ordinal, locale, this.workspaceJobCase(input))
        if ('clarification' in resolved) {
          const assistant = assistantMessage(resolved.clarification.prompt, [resolved.clarification], turnId)
          return save(assistant, previousState, 'clarifying', null, null)
        }
        // A case with nothing to score - no skills, only hard-filter terms or
        // none at all - would still "rank" whoever the hard filters cannot
        // exclude. That is not a match result; ask for the missing
        // requirements instead of producing a #1 with no evidence.
        const matchability = this.port.describeJobCaseMatchability?.(resolved.reference.objectId, resolved.reference.objectVersion) ?? null
        if (matchability && matchability.scorableTermCount === 0) {
          const gateOnly = matchability.hardFilterTermCount > 0
          const content = textFor(
            locale,
            `案件「${resolved.reference.label}」には評価できる条件がありません（必須スキルなどが未記入${gateOnly ? 'で、必須条件による絞り込みしかできず' : ''}、意味のある順位を出せません）。案件に必須スキルを補ってから再度マッチングしてください。`,
            `案件「${resolved.reference.label}」目前没有可评估的条件（必須スキル等为空${gateOnly ? '，只能按硬条件筛选' : ''}），无法产生有意义的排序。请先在案件中补充必須スキル，再重新匹配。`
          )
          const access: AiConversationBlock = matchability.reviewId
            ? { type: 'system-access', destination: 'case-review', reviewId: matchability.reviewId }
            : { type: 'system-access', destination: 'matching', jobCaseId: resolved.reference.objectId }
          return save(assistantMessage(content, [access], turnId), { ...previousState, selectedJobCaseRef: resolved.reference }, 'clarifying', null, null)
        }
        const tool = await this.port.executeTool('candidate.match.local', {
          jobCaseId: resolved.reference.objectId, jobCaseVersion: resolved.reference.objectVersion,
          ...(previousState.selectedCandidateDocumentId ? { candidateDocumentId: previousState.selectedCandidateDocumentId } : {})
        }, { conversationId: input.conversationId, turnId, requestId: input.requestId })
        if (tool.toolName !== 'candidate.match.local') throw new AgentExecutionError('TOOL_RESULT_INVALID', '候选人匹配结果无效。')
        const cards = tool.output.cards.slice(0, 5).map((record, index) => candidateCard(record, index + 1))
        const block: AgentCandidateMatchCardsBlock = {
          type: 'candidate-match-cards', runId: tool.output.runId, resultHash: tool.output.resultHash, cards,
          ...(previousState.selectedCandidateDocumentId ? { scope: 'selected-person' as const } : {}),
          ...(tool.output.cloudReview ? { cloudReview: tool.output.cloudReview } : {})
        }
        // Rows that matched nothing are not results; say there is no candidate
        // and let the cards explain why on request.
        const noneAssessable = cards.length > 0 && cards.every(isUnassessableMatchCard)
        const content = previousState.selectedCandidateDocumentId
          ? textFor(locale, '選択中の人材と案件だけを照合しました。未記載の条件は確認が必要です。', '已仅评估所选人员与当前案件。资料未记载的条件需要核对。')
          : noneAssessable
          ? textFor(locale, '現在の案件に確認できる候補者はいません。検索された人材はいずれも要件に一致しませんでした。', '当前案件暂无可确认的匹配候选人；检索到的人选均不满足案件要求。')
          : cards.length > 0
            ? textFor(locale, `現在の案件と確認済み人材プールでローカルマッチングを実行し、上位${cards.length}名を表示します。`, `已使用当前案件和确认人才池完成本地匹配，显示前 ${cards.length} 名。`)
            : textFor(locale, '現在の確認済み人材プールからマッチ結果が返りませんでした。', '当前确认人才池没有返回匹配结果。')
        const assistant = assistantMessage(content, [
          block,
          { type: 'system-access', destination: 'matching', jobCaseId: resolved.reference.objectId }
        ], turnId)
        return save(assistant, { ...previousState, selectedJobCaseRef: resolved.reference, lastMatchRunId: tool.output.runId }, 'completed', 'candidate.match.local', tool.actionRunId ?? null)
      }

      if (plannedAction.toolName === 'candidate.profile.read.local') {
        const resolvedRun = resolveMatchRunReference(previousState, previousMessages, plannedAction.arguments.rank, locale)
        if ('clarification' in resolvedRun) {
          const assistant = assistantMessage(resolvedRun.clarification.prompt, [resolvedRun.clarification], turnId)
          return save(assistant, previousState, 'clarifying', null, null)
        }
        const tool = await this.port.executeTool('candidate.profile.read.local', {
          runId: resolvedRun.runId,
          resultId: resolvedRun.resultId ?? null,
          rank: resolvedRun.rank
        }, { conversationId: input.conversationId, turnId, requestId: input.requestId })
        if (tool.toolName !== 'candidate.profile.read.local') throw new AgentExecutionError('TOOL_RESULT_INVALID', '候选人档案查询结果无效。')
        const block: AiConversationBlock = { type: 'candidate-profile-evidence', facts: tool.output.facts }
        const content = tool.output.facts.profile && tool.output.facts.candidate
          ? textFor(locale, `${tool.output.facts.candidate.anonymousLabel} の確認済みプロフィールを読み取りました。`, `已读取 ${tool.output.facts.candidate.anonymousLabel} 的已确认档案。`)
          : textFor(locale, '候補者プロフィールが存在しないか、現在参照できません。', '候选人档案不存在或当前不可读取。')
        const candidate = tool.output.facts.candidate
        const accessBlock: AiConversationBlock = candidate?.sourceDocumentId
          ? { type: 'system-access', destination: 'candidate', sourceDocumentId: candidate.sourceDocumentId, view: 'overview' }
          : { type: 'system-access', destination: 'candidate-management' }
        const assistant = assistantMessage(content, [block, accessBlock], turnId)
        return save(assistant, { ...previousState, lastMatchRunId: tool.output.facts.runId }, 'completed', 'candidate.profile.read.local', tool.actionRunId ?? null)
      }

      if (plannedAction.toolName === 'candidate.interview.read.local') {
        const resolvedRun = resolveMatchRunReference(previousState, previousMessages, plannedAction.arguments.rank, locale)
        if ('clarification' in resolvedRun) {
          const assistant = assistantMessage(resolvedRun.clarification.prompt, [resolvedRun.clarification], turnId)
          return save(assistant, previousState, 'clarifying', null, null)
        }
        const tool = await this.port.executeTool('candidate.interview.read.local', {
          runId: resolvedRun.runId,
          resultId: resolvedRun.resultId ?? null,
          rank: resolvedRun.rank
        }, { conversationId: input.conversationId, turnId, requestId: input.requestId })
        if (tool.toolName !== 'candidate.interview.read.local') throw new AgentExecutionError('TOOL_RESULT_INVALID', '候选人面试查询结果无效。')
        const block: AiConversationBlock = { type: 'candidate-interview-evidence', facts: tool.output.facts }
        const content = tool.output.facts.candidate
          ? textFor(locale, `${tool.output.facts.candidate.anonymousLabel} の面談情報を${tool.output.facts.interviews.length}件読み取りました。`, `已读取 ${tool.output.facts.candidate.anonymousLabel} 的 ${tool.output.facts.interviews.length} 条面试信息。`)
          : textFor(locale, '候補者を特定できないため、面談情報を読み取れませんでした。', '无法确定候选人，未能读取面试信息。')
        const candidate = tool.output.facts.candidate
        const accessBlock: AiConversationBlock = candidate?.sourceDocumentId
          ? { type: 'system-access', destination: 'candidate', sourceDocumentId: candidate.sourceDocumentId, view: 'records' }
          : { type: 'system-access', destination: 'interview-schedule' }
        const assistant = assistantMessage(content, [block, accessBlock], turnId)
        return save(assistant, { ...previousState, lastMatchRunId: tool.output.facts.runId }, 'completed', 'candidate.interview.read.local', tool.actionRunId ?? null)
      }

      if (plannedAction.toolName === 'candidate.interview.schedule.local') {
        const args = plannedAction.arguments
        const localMeetingLink = resolveLocalMeetingLink(input.message, previousMessages)
        // An interview attaches to a candidate review record, which exists as
        // soon as a resume is imported - a match run is one way to name that
        // person, not the only one.
        // Precedence is what the operator means by "this person": whatever was
        // imported in this conversation comes first, whichever route imported it.
        // Only when this conversation imported nothing does the device-wide list
        // apply - otherwise four unrelated candidates answer for the one resume
        // that was just added.
        const blockImports = previousMessages
          .flatMap((message) => message.blocks ?? [])
          .filter((block): block is Extract<AiConversationBlock, { type: 'resume-import' }> => block.type === 'resume-import')
          .flatMap((block) => block.imported)
          .map((item) => ({ anonymousLabel: item.label, sourceDocumentId: item.documentId }))
        const registered = this.port.listConversationImports?.(input.conversationId) ?? []
        const conversationImports = [...blockImports, ...registered]
          .filter((item, index, all) => all.findIndex((other) => other.sourceDocumentId === item.sourceDocumentId) === index)
        const scope = conversationImports.length > 0
          ? conversationImports
          : this.port.listSchedulableCandidates?.() ?? []

        let candidate: { anonymousLabel: string; sourceDocumentId: string } | null = null
        if (conversationImports.length === 0 && previousState.lastMatchRunId) {
          // A rank only means a match position when a match run exists and this
          // conversation did not just import someone.
          const resolved = resolveMatchRunReference(previousState, previousMessages, args.rank, locale)
          if (!('clarification' in resolved)) {
            candidate = this.port.resolveInterviewCandidate?.(resolved.runId, resolved.resultId ?? null, resolved.rank) ?? null
          }
        }
        if (!candidate && scope.length === 1) candidate = scope[0]!
        if (!candidate && args.rank !== null && scope[args.rank - 1]) candidate = scope[args.rank - 1]!
        if (!candidate) {
          const prompt = scope.length === 0
            ? textFor(
                locale,
                'この端末には面談を設定できる候補者がまだありません。先に履歴書を取り込んでください。',
                '本机还没有可安排面试的候选人，请先导入简历。'
              )
            : textFor(
                locale,
                `どの候補者の面談か番号でお知らせください：${scope.map((item, index) => `${index + 1}. ${item.anonymousLabel}`).join('、')}`,
                `请用序号告诉我是哪一位候选人：${scope.map((item, index) => `${index + 1}. ${item.anonymousLabel}`).join('、')}`
              )
          return save(assistantMessage(prompt, [], turnId), previousState, 'clarifying', null, null)
        }
        // Anything the operator did not actually say is asked for, never chosen
        // for them. A vague "book an interview" can therefore not create one.
        const missing: string[] = []
        const date = args.date && interviewDatePattern.test(args.date) ? args.date : null
        const time = args.time && interviewTimePattern.test(args.time) ? args.time : null
        const scheduledAt = date && time ? jstInterviewDateTimeToIso(date, time) : null
        const method = args.method ?? (localMeetingLink.status === 'resolved' ? localMeetingLink.link.method : null)
        if (localMeetingLink.status === 'conflict' ||
          (localMeetingLink.status === 'resolved' && method !== localMeetingLink.link.method)) {
          const prompt = textFor(
            locale,
            '会議方法とリンクを一意に確認できません。Zoom または Google Meet のリンクを1件だけ指定してください。',
            '无法唯一确认会议方式和链接，请只提供一个 Zoom 或 Google Meet 链接。'
          )
          const clarification: AiConversationBlock = {
            type: 'clarification', code: 'INTERVIEW_DETAILS_REQUIRED', prompt, options: []
          }
          return save(assistantMessage(prompt, [clarification], turnId), previousState, 'clarifying', null, null)
        }
        if (!date) missing.push(textFor(locale, '日付', '日期'))
        if (!time) missing.push(textFor(locale, '開始時刻', '开始时间'))
        if (date && time && !scheduledAt) {
          missing.push(textFor(locale, '実在する日付と有効な開始時刻', '有效的日期和开始时间'))
        }
        if (!method) missing.push(textFor(locale, '実施方法（Zoom / Google Meet / 電話 / 対面）', '会议方式（Zoom / Google Meet / 电话 / 现场）'))
        if (!args.durationMinutes) missing.push(textFor(locale, '所要時間（5〜480分の整数。例：50分）', '时长（5–480 分钟的整数，例如 50 分钟）'))
        if ((method === 'zoom' || method === 'google-meet') && localMeetingLink.status !== 'resolved') {
          missing.push(method === 'zoom'
            ? textFor(locale, 'Zoom会議リンク', 'Zoom 会议链接')
            : textFor(locale, 'Google Meetリンク', 'Google Meet 会议链接'))
        }
        if (missing.length > 0) {
          const prompt = textFor(
            locale,
            `面談の登録に次が必要です：${missing.join('、')}。備考があれば併せてお知らせください。`,
            `登记面试还需要：${missing.join('、')}。如果有备注也请一并说明。`
          )
          const clarification: AiConversationBlock = {
            type: 'clarification', code: 'INTERVIEW_DETAILS_REQUIRED', prompt, options: []
          }
          return save(assistantMessage(prompt, [clarification], turnId), previousState, 'clarifying', null, null)
        }
        const tool = await this.port.executeTool('candidate.interview.schedule.local', {
          sourceDocumentId: candidate.sourceDocumentId,
          candidateLabel: candidate.anonymousLabel,
          scheduledAt: scheduledAt!,
          durationMinutes: args.durationMinutes,
          meetingMethod: method,
          ...(localMeetingLink.status === 'resolved' ? { meetingUrl: localMeetingLink.link.url } : {}),
          kind: args.kind ?? 'recruiting',
          ...(args.note ? { contactNote: args.note
            .replaceAll('[ZOOM_MEETING_LINK_PROVIDED_LOCALLY]', '')
            .replaceAll('[GOOGLE_MEET_LINK_PROVIDED_LOCALLY]', '')
            .trim() } : {})
        }, { conversationId: input.conversationId, turnId, requestId: input.requestId })
        if (tool.toolName !== 'candidate.interview.schedule.local') {
          throw new AgentExecutionError('TOOL_RESULT_INVALID', '面談登録结果无效。')
        }
        const content = textFor(
          locale,
          `${tool.output.candidateLabel} の面談を登録しました。面談日程から確認・変更できます。`,
          `${tool.output.candidateLabel} 的面试已经登记，可以在面试日程中查看或修改。`
        )
        return save(assistantMessage(content, [
          {
            type: 'system-access',
            destination: 'interview-schedule',
            receipt: {
              sourceDocumentId: candidate.sourceDocumentId,
              candidateLabel: tool.output.candidateLabel,
              scheduledAt: tool.output.scheduledAt,
              durationMinutes: tool.output.durationMinutes,
              meetingMethod: tool.output.meetingMethod,
              kind: tool.output.kind,
              meetingLinkStoredLocally: localMeetingLink.status === 'resolved'
            }
          }
        ], turnId), previousState, 'completed', 'candidate.interview.schedule.local', tool.actionRunId ?? null)
      }

      if (plannedAction.toolName === 'candidate.draft.read.local') {
        // Ordinals are resolved against the imports this conversation actually
        // made; the model never supplies a document id.
        const importedBlocks = previousMessages
          .flatMap((message) => message.blocks ?? [])
          .filter((block): block is Extract<AiConversationBlock, { type: 'resume-import' }> => block.type === 'resume-import')
          .flatMap((block) => block.imported)
        const registeredImports = (this.port.listConversationImports?.(input.conversationId) ?? []).map((item, index) => ({
          documentId: item.sourceDocumentId,
          label: item.anonymousLabel,
          ordinal: index + 1
        }))
        const importedDrafts = [...importedBlocks, ...registeredImports]
          .filter((item, index, all) => all.findIndex((other) => other.documentId === item.documentId) === index)
        const ordinal = plannedAction.arguments.draftOrdinal
        const target = ordinal === null
          ? (importedDrafts.length === 1 ? importedDrafts[0] : null)
          : importedDrafts[ordinal - 1] ?? null
        if (!target) {
          const prompt = importedDrafts.length === 0
            ? textFor(locale, 'この会話ではまだ履歴書を取り込んでいません。まず取り込んでください。', '这个会话还没有导入过简历。请先导入。')
            : textFor(locale, 'どの取込済み履歴書か指定してください。', '请指明是哪一份已导入的简历。')
          return save(assistantMessage(prompt, [], turnId), previousState, 'clarifying', null, null)
        }
        const tool = await this.port.executeTool('candidate.draft.read.local', {
          sourceDocumentId: target.documentId, label: target.label
        }, { conversationId: input.conversationId, turnId, requestId: input.requestId })
        if (tool.toolName !== 'candidate.draft.read.local') throw new AgentExecutionError('TOOL_RESULT_INVALID', '下书き読取结果无效。')
        const block: AiConversationBlock = { type: 'candidate-draft-facts', facts: tool.output.facts }
        const known = tool.output.facts.fields.filter((field) => field.status !== 'missing').length
        const content = textFor(
          locale,
          `${target.label} の履歴書を読み取りました（記入済み ${known} 項目、プロジェクト ${tool.output.facts.projects.length} 件）。`,
          `已读取 ${target.label} 的简历资料（已填写 ${known} 个字段，项目经历 ${tool.output.facts.projects.length} 段）。`
        )
        return save(assistantMessage(content, [
          block,
          { type: 'system-access', destination: 'candidate', sourceDocumentId: target.documentId, view: 'resume' }
        ], turnId), previousState, 'completed', 'candidate.draft.read.local', tool.actionRunId ?? null)
      }

      if (plannedAction.toolName === 'job-case.draft.read.local') {
        // Ordinals are paste order within the latest intake batch; the model
        // never supplies a review id.
        const batch = latestIntakeBatch(previousState, previousMessages)
        if (!batch || batch.entries.length === 0) {
          return save(assistantMessage(textFor(
            locale,
            'この会話ではまだ案件テキストを取り込んでいません。案件テキストを貼り付けてください。',
            '这个会话还没有导入过案件文本。请先粘贴案件文本。'
          ), [], turnId), previousState, 'clarifying', null, null)
        }
        const ordinal = plannedAction.arguments.draftOrdinal
        const targets = ordinal === null ? batch.entries : batch.entries.filter((entry) => entry.ordinal === ordinal)
        if (targets.length === 0) {
          return save(assistantMessage(textFor(
            locale,
            `今回取り込んだ案件下書きは${batch.entries.length}件です。何件目か指定してください。`,
            `本次导入的案件草稿共 ${batch.entries.length} 条，请指明是第几条。`
          ), [], turnId), previousState, 'clarifying', null, null)
        }
        const tool = await this.port.executeTool('job-case.draft.read.local', {
          reviewIds: targets.map((entry) => entry.reviewId),
          labels: targets.map((entry) => entry.label)
        }, { conversationId: input.conversationId, turnId, requestId: input.requestId })
        if (tool.toolName !== 'job-case.draft.read.local') throw new AgentExecutionError('TOOL_RESULT_INVALID', '案件下書き読取結果が無効です。')
        const cards: AgentJobCaseDraftCard[] = tool.output.facts.map((facts, index) => {
          const entry = targets.find((item) => item.reviewId === facts.reviewId) ?? targets[index]!
          return { ...facts, ordinal: entry.ordinal, outcome: entry.outcome }
        })
        const missingByDraft = cards.map((card) => card.fields.filter((field) => !field.value).length)
        const content = textFor(
          locale,
          `今回取り込んだ案件${cards.length}件を読み取りました（未記入項目 合計${missingByDraft.reduce((sum, count) => sum + count, 0)}）。`,
          `已读取本次导入的 ${cards.length} 条案件资料（未填写字段共 ${missingByDraft.reduce((sum, count) => sum + count, 0)} 项）。`
        )
        const reviewIds = cards.filter((card) => card.status !== 'deleted').map((card) => card.reviewId)
        return save(assistantMessage(content, [
          { type: 'job-case-draft-cards', intakeBatchId: batch.intakeBatchId, cards },
          { type: 'system-access', destination: 'review-center', intakeBatchId: batch.intakeBatchId, reviewIds }
        ], turnId), previousState, 'completed', 'job-case.draft.read.local', tool.actionRunId ?? null)
      }

      if (plannedAction.toolName === 'job-case.broadcast.draft.local') {
        const queue = this.port.listBroadcastQueue?.() ?? []
        const counts = {
          new: queue.filter((item) => item.status === 'new').length,
          copied: queue.filter((item) => item.status === 'copied').length,
          attention: queue.filter((item) => item.status === 'attention').length
        }
        const args = plannedAction.arguments
        let selected: AgentBroadcastQueueEntry[]
        if (args.target === 'case') {
          const resolved = resolveBroadcastCase(queue, this.loadRecords(), previousState, previousMessages, input.selectedJobCaseRef, args.ordinal, locale, this.workspaceJobCase(input))
          if ('clarification' in resolved) {
            const assistant = assistantMessage(resolved.clarification.prompt, [resolved.clarification], turnId)
            return save(assistant, previousState, 'clarifying', null, null)
          }
          // A case nobody confirmed yet has no publishable field values; ask
          // for the confirmation instead of drafting from an unreviewed draft.
          if (resolved.entry.status === 'attention') {
            const content = textFor(
              locale,
              `案件「${resolved.entry.title}」は確認待ちのため配信できません。先に案件を確定してください。`,
              `案件「${resolved.entry.title}」还在待补充状态，确认后才能配信。`
            )
            return save(assistantMessage(content, [
              { type: 'system-access', destination: 'case-review', reviewId: resolved.entry.reviewId }
            ], turnId), previousState, 'clarifying', null, null)
          }
          selected = [resolved.entry]
        } else {
          // 新規 is what was never copied; 未コピー adds the cases whose text
          // went stale because the case itself was revised after the copy.
          selected = queue.filter((item) => item.status === 'new' ||
            (args.target === 'uncopied-cases' && item.hasUpdateSinceLastCopy))
        }
        if (selected.length === 0) {
          const content = textFor(
            locale,
            `いまコピーする案件はありません（新着${counts.new}件・コピー済み${counts.copied}件・要補完${counts.attention}件）。`,
            `当前没有需要整理的案件（新增 ${counts.new} 条、已复制 ${counts.copied} 条、待补充 ${counts.attention} 条）。`
          )
          return save(assistantMessage(content, [
            { type: 'system-access', destination: 'broadcast' }
          ], turnId), previousState, 'completed', null, null)
        }
        const capped = selected.slice(0, agentBroadcastDraftLimit)
        const tool = await this.port.executeTool('job-case.broadcast.draft.local', {
          reviewIds: capped.map((entry) => entry.reviewId)
        }, { conversationId: input.conversationId, turnId, requestId: input.requestId })
        if (tool.toolName !== 'job-case.broadcast.draft.local') throw new AgentExecutionError('TOOL_RESULT_INVALID', '群メッセージ生成結果が無効です。')
        const cards = tool.output.cards
        const block: AgentJobCaseBroadcastCardsBlock = { type: 'job-case-broadcast-cards', cards, queue: counts }
        const truncated = selected.length > cards.length
        const content = cards.length > 0
          ? textFor(
              locale,
              `群メッセージを${cards.length}件作成しました。コピーして微信に貼り付けてください。${truncated ? `対象${selected.length}件のうち先頭${cards.length}件です。` : ''}`,
              `已生成 ${cards.length} 条群消息，复制后粘贴到微信即可。${truncated ? `本次共 ${selected.length} 条待整理案件，先给出前 ${cards.length} 条。` : ''}`
            )
          : textFor(locale, '群メッセージを作成できる案件がありませんでした。', '没有可以生成群消息的案件。')
        return save(assistantMessage(content, [
          block,
          { type: 'system-access', destination: 'broadcast', ...(cards.length === 1 ? { reviewId: cards[0]!.reviewId } : {}) }
        ], turnId), previousState, 'completed', 'job-case.broadcast.draft.local', tool.actionRunId ?? null)
      }

      if (plannedAction.toolName === 'resume.analyze.local') {
        const attachments = this.port.listAttachmentFileTokens?.(input.conversationId, input.requestId) ?? []
        const ordinal = plannedAction.arguments.attachmentOrdinal
        const selected = ordinal === null ? attachments : attachments.slice(ordinal - 1, ordinal)
        if (selected.length === 0) {
          const prompt = textFor(
            locale,
            'このターンには取り込めるファイルが添付されていません。履歴書・スキルシートを会話に添付してください。',
            '这一轮没有可导入的附件。请把简历或技能表拖入对话。'
          )
          return save(assistantMessage(prompt, [], turnId), previousState, 'completed', null, null)
        }
        const tool = await this.port.executeTool('resume.analyze.local', { fileTokens: selected }, {
          conversationId: input.conversationId, turnId, requestId: input.requestId
        })
        if (tool.toolName !== 'resume.analyze.local') throw new AgentExecutionError('TOOL_RESULT_INVALID', '履歴書取込结果无效。')
        const { imported, failed } = tool.output
        const content = imported.length > 0
          ? textFor(
              locale,
              `${imported.length}件の履歴書（${imported.map((_file, index) => `RESUME_${index + 1}`).join('、')}）を端末内に取り込み、内容をこの会話に追加しました。このまま履歴書について質問できます。${failed.length > 0 ? `${failed.length}件は取り込めませんでした。` : ''}`,
              `已在本机导入 ${imported.length} 份简历（${imported.map((_file, index) => `RESUME_${index + 1}`).join('、')}），并将资料加入当前会话。现在可以直接针对这些简历继续提问。${failed.length > 0 ? `另有 ${failed.length} 份未能导入。` : ''}`
            )
          : textFor(locale, '添付された履歴書を取り込めませんでした。', '附件中的简历未能导入。')
        const importBlock: AiConversationBlock = {
          type: 'resume-import',
          imported: imported.map((file, index) => ({
            documentId: file.documentId,
            label: `RESUME_${index + 1}`,
            ordinal: index + 1
          })),
          failedCount: failed.length
        }
        const draftBlocks: AiConversationBlock[] = imported.flatMap((file, index) => file.facts
          ? [{
              type: 'candidate-draft-facts' as const,
              facts: { ...file.facts, label: `RESUME_${index + 1}` }
            }]
          : [])
        const assistant = assistantMessage(content, imported.length > 0
          ? [importBlock, ...draftBlocks]
          : [], turnId)
        return save(assistant, previousState, imported.length > 0 ? 'completed' : 'failed', 'resume.analyze.local', tool.actionRunId ?? null)
      }

      if (plannedAction.toolName !== 'match-run.read.local') {
        throw new AgentExecutionError('AGENT_PLAN_INVALID', 'AI Tool 计划无法映射到受控执行分支。')
      }
      const rank = plannedAction.arguments.rank
      const resolvedRun = resolveMatchRunReference(previousState, previousMessages, rank, locale)
      if ('clarification' in resolvedRun) {
        const assistant = assistantMessage(resolvedRun.clarification.prompt, [resolvedRun.clarification], turnId)
        return save(assistant, previousState, 'clarifying', null, null)
      }
      const tool = await this.port.executeTool('match-run.read.local', { runId: resolvedRun.runId, resultId: resolvedRun.resultId ?? null, rank: resolvedRun.rank }, {
        conversationId: input.conversationId, turnId, requestId: input.requestId
      })
      if (tool.toolName !== 'match-run.read.local') throw new AgentExecutionError('TOOL_RESULT_INVALID', 'Match Run 读取结果无效。')
      const block: AiConversationBlock = { type: 'match-run-explanation', facts: tool.output.facts }
      const facts = tool.output.facts
      const content = facts.candidate
        ? textFor(locale, `第${rank}位是${facts.candidate.anonymousLabel}。順位の根拠：${facts.matched.length > 0 ? `一致：${facts.matched.join('、')}` : '構造化条件'}；${facts.missing.length > 0 ? `不足：${facts.missing.join('、')}` : '記録された不足項目はありません'}。保存済み Match Run ${facts.runId.slice(0, 8)} を読み取り、マッチングは再実行していません。`, `第 ${rank} 名是 ${facts.candidate.anonymousLabel}。排名依据：${facts.matched.length > 0 ? `匹配 ${facts.matched.join('、')}` : '结构化条件'}；${facts.missing.length > 0 ? `不足 ${facts.missing.join('、')}` : '没有记录到不足项'}。这是已保存的 Match Run ${facts.runId.slice(0, 8)}，未重新运行匹配。`)
        : textFor(locale, `找不到第${rank}位的保存结果；该 Match Run 可能已删除或已过期。`, `找不到第 ${rank} 名的已保存结果；该 Match Run 可能已删除或过期。`)
      const selectedJobCaseId = previousState.selectedJobCaseRef?.kind === 'job-case'
        ? previousState.selectedJobCaseRef.objectId
        : undefined
      const assistant = assistantMessage(content, [
        block,
        {
          type: 'system-access',
          destination: 'matching',
          ...(selectedJobCaseId ? { jobCaseId: selectedJobCaseId } : {})
        }
      ], turnId)
      return save(assistant, { ...previousState, lastMatchRunId: facts.runId }, 'completed', 'match-run.read.local', tool.actionRunId ?? null)
    } catch (error) {
      const block = errorBlock(error, locale)
      const assistant = assistantMessage(block.message, [block], turnId)
      const status = error instanceof AgentExecutionError && error.code === 'TURN_CANCELLED' ? 'cancelled' : 'failed'
      return save(
        assistant,
        previousState,
        status,
        plannedAction.toolName,
        error instanceof AgentExecutionError ? error.actionRunId : null
      )
    }
  }

  /**
   * Persists one locally-handled business-text intake turn. The user message is
   * the caller's safe summary - the branded parameter is the only accepted
   * content, so the raw pasted text is not expressible on this path. No model
   * fields are set: an intake turn never touches the cloud.
   */
  saveIntakeTurn(
    input: ExecuteAgentTurnInput,
    persistedUserContent: PersistedUserContent,
    assistant: { content: string; blocks: AiConversationBlock[] },
    outcome: 'completed' | 'failed' = 'completed',
    intakeBatch: { intakeBatchId: string; reviewIds: string[] } | null = null
  ): {
    status: 'completed' | 'failed'
    requestId: string
    conversation: AiConversationSnapshot
    assistantMessage: AiConversationMessage
    toolName: null
    actionRunId: null
  } {
    const current = this.loadCurrentConversation(input)
    const branchRootConversationId = this.resolveBranchRootConversationId(input, current)
    const summary = persistedUserContent.trim()
    if (!summary || summary.length > 2_000) {
      throw new AgentExecutionError('AGENT_INTAKE_SUMMARY_INVALID', '業務テキスト取込ターンの安全な要約が不正です。')
    }
    const turnId = randomUUID()
    const user: AiConversationMessage = {
      id: randomUUID(), role: 'user', content: summary, mode: 'local', turnId, createdAt: new Date().toISOString()
    }
    const reply = assistantMessage(assistant.content, assistant.blocks, turnId)
    const conversation = this.port.saveConversation({
      conversationId: input.conversationId,
      ...(branchRootConversationId ? { branchRootConversationId } : {}),
      context: current?.context ?? salesAgentContext(input),
      messages: [...(current?.messages ?? []), user, reply].slice(-200),
      salesAgentState: {
        ...(current?.salesAgentState ?? defaultState()),
        // The batch pointer lets "第2条" resolve on later turns; it names the
        // assistant message that carries the cards.
        ...(intakeBatch && intakeBatch.reviewIds.length > 0
          ? { lastIntakeBatch: { ...intakeBatch, messageId: reply.id } }
          : {})
      },
      expectedRevision: input.expectedConversationRevision
    })
    const persisted = conversation.messages.find((message) => message.id === reply.id)
    if (!persisted) throw new AgentExecutionError('AGENT_INTAKE_PERSISTENCE_FAILED', '業務テキスト取込ターンを保存できませんでした。')
    return {
      status: outcome, requestId: input.requestId, conversation,
      assistantMessage: persisted, toolName: null, actionRunId: null
    }
  }

  saveDirectAnswer(
    input: ExecuteAgentTurnInput,
    content: string,
    model?: { key: string; displayName: string },
    outcome: 'completed' | 'failed' | 'cancelled' = 'completed'
  ): {
    status: 'completed' | 'failed' | 'cancelled'
    requestId: string
    conversation: AiConversationSnapshot
    assistantMessage: AiConversationMessage
    toolName: null
    actionRunId: null
  } {
    const current = this.loadCurrentConversation(input)
    const branchRootConversationId = this.resolveBranchRootConversationId(input, current)
    const normalizedContent = content.trim()
    if (!normalizedContent || normalizedContent.length > 20_000) {
      throw new AgentExecutionError('AGENT_ANSWER_INVALID', 'AI 返回的直接回答为空或超过本地上限。')
    }
    const turnId = randomUUID()
    const inputMessage = userMessage(input, turnId)
    const assistant: AiConversationMessage = {
      ...assistantMessage(normalizedContent, [], turnId),
      mode: outcome === 'completed' ? 'cloud' : 'local-fallback',
      modelKey: model?.key,
      modelDisplayName: model?.displayName,
      narrativeStatus: outcome === 'completed'
        ? 'completed'
        : outcome === 'cancelled' ? 'cancelled' : 'failed-local-fallback'
    }
    const conversation = this.port.saveConversation({
      conversationId: input.conversationId,
      ...(branchRootConversationId ? { branchRootConversationId } : {}),
      context: current?.context ?? salesAgentContext(input),
      messages: [...(current?.messages ?? []), inputMessage, assistant].slice(-200),
      salesAgentState: { ...(current?.salesAgentState ?? defaultState()),
        ...(input.selectedCandidateDocumentId !== undefined ? { selectedCandidateDocumentId: input.selectedCandidateDocumentId } : {})
      },
      expectedRevision: input.expectedConversationRevision
    })
    const persisted = conversation.messages.find((message) => message.id === assistant.id)
    if (!persisted) throw new AgentExecutionError('AGENT_ANSWER_PERSISTENCE_FAILED', 'AI 直接回答未能保存。')
    return {
      status: outcome, requestId: input.requestId, conversation,
      assistantMessage: persisted, toolName: null, actionRunId: null
    }
  }

  private loadCurrentConversation(input: ExecuteAgentTurnInput): AiConversationSnapshot | null {
    const current = this.port.loadConversation(input.conversationId)
    if (current && current.context.assistant !== 'sales-agent') {
      throw new AgentExecutionError('CONVERSATION_CONTEXT_MISMATCH', 'CONVERSATION_CONTEXT_MISMATCH: この会話は Sales Agent 会話ではありません。新しい案件マッチング会話を開始してください。')
    }
    if (current && JSON.stringify(current.context.businessObject ?? null) !== JSON.stringify(input.businessObject ?? null)) {
      throw new AgentExecutionError('CONVERSATION_CONTEXT_MISMATCH', '当前会话属于其他业务对象，请重新打开会话。')
    }
    if (current && current.revision !== input.expectedConversationRevision) {
      throw new AgentExecutionError('CONVERSATION_REVISION_CONFLICT', '会话已在其他窗口更新，请重新加载历史后再发送。')
    }
    if (!current && input.expectedConversationRevision !== null) {
      throw new AgentExecutionError('CONVERSATION_NOT_FOUND', '会话不存在，请重新加载历史。')
    }
    return current
  }

  private resolveBranchRootConversationId(
    input: ExecuteAgentTurnInput,
    current: AiConversationSnapshot | null
  ): string | undefined {
    if (current?.branchRootConversationId) return current.branchRootConversationId
    if (!input.branchFrom) return undefined
    const source = this.port.loadConversation(input.branchFrom.conversationId)
    return source?.branchRootConversationId ?? source?.id ?? input.branchFrom.conversationId
  }

  /** The confirmed case the side workspace is showing - the fallback referent for 「当前案件」. */
  private workspaceJobCase(input: ExecuteAgentTurnInput): AgentJobCaseRecord | null {
    return this.port.workspaceJobCase?.(input.activeSystemAccess ?? null) ?? null
  }

  private loadRecords(): AgentJobCaseRecord[] {
    return this.port.listActiveJobCases?.() ?? []
  }
}

export function createAgentReference(
  kind: TypedAiConversationReference['kind'], objectId: string, label: string,
  objectVersion: number | null = null, resultHash: string | null = null, ordinal: number | null = null
): TypedAiConversationReference {
  return typedReference(kind, objectId, label, objectVersion, resultHash, ordinal)
}

/** A person-to-case request must never degrade into an unfiltered case listing. */
export function isCandidateCaseRequest(message: string): boolean {
  return /他|她|该名|改名|这个人|人员|候选人|人材|候補者/u.test(message)
    && /(?:适合|匹配|找|推荐).{0,20}(?:案件|项目)|(?:合う|適した).{0,8}案件|案件.{0,8}(?:探|紹介)/u.test(message)
}
export function isSpecificCandidateFitRequest(message: string): boolean {
  return /(?:案件|项目).{0,20}(?:适合|匹配).{0,8}(?:他|她|这个人|该人|(?:这个|这名|这位|该名|当前)(?:候选人|人员))|(?:他|她|这个人|该人|候选人|人员).{0,15}(?:适合|匹配).{0,8}(?:这个|该|当前).{0,5}(?:案件|项目)|この案件.{0,12}(?:彼|彼女|候補者|人材).{0,8}(?:合う|適合)/u.test(message)
}
