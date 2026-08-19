import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  AgentCandidateDraftFacts,
  AgentCandidateMatchCard,
  AgentCandidateMatchCardsBlock,
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
  DomainToolName,
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
  runId: string
  resultId: string
  resultHash: string
  rank: number
  anonymousLabel: string
  fitScore: number | null
  matched: string[]
  missing: string[]
  hardFilterStatus: 'passed' | 'failed' | 'unknown'
  projectEvidence: string | null
  status: AgentEntityStatus
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
  imported: Array<{ documentId: string; name: string; format: string; reviewRequired: true }>
  failed: Array<{ name: string; code: string }>
}

export interface AgentCandidateDraftReadOutput {
  facts: AgentCandidateDraftFacts
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
  | { toolName: 'candidate.interview.schedule.local'; output: AgentInterviewScheduleOutput; actionRunId?: string | null }

export interface AgentToolExecutionMetadata {
  conversationId: string
  turnId: string
  requestId: string
}

export interface LocalAgentPort {
  listActiveJobCases?(): AgentJobCaseRecord[]
  /** Vault tokens attached to the turn being executed, in the order the operator added them. */
  listAttachmentFileTokens?(conversationId: string, requestId: string): string[]
  /** Local lookup, not a tool call: resolves a ranked candidate to the record an interview attaches to. */
  resolveInterviewCandidate?(runId: string, resultId: string | null, rank: number | null): { anonymousLabel: string; sourceDocumentId: string } | null
  /** Candidates that already have a review record and can therefore hold an interview. */
  listSchedulableCandidates?(): Array<{ anonymousLabel: string; sourceDocumentId: string }>
  isCancelled?(conversationId: string, requestId: string): boolean
  loadConversation(conversationId: string): AiConversationSnapshot | null
  saveConversation(input: SaveAiConversationInput): AiConversationSnapshot
  executeTool(
    toolName: Extract<DomainToolName, 'job-case.search.local' | 'candidate.match.local' | 'candidate.profile.read.local' | 'candidate.interview.read.local' | 'match-run.read.local' | 'resume.analyze.local' | 'candidate.draft.read.local' | 'candidate.interview.schedule.local'>,
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
const interviewDurationValues = [30, 45, 60, 90] as const

const planningInterviewArgumentsSchema = z.object({
  rank: z.coerce.number().int().min(1).max(20).nullable().catch(null).optional().default(null),
  date: z.string().trim().max(40).nullable().catch(null).optional().default(null),
  time: z.string().trim().max(40).nullable().catch(null).optional().default(null),
  method: z.enum(['zoom', 'google-meet', 'phone', 'onsite']).nullable().catch(null).optional().default(null),
  // Anything outside the supported set becomes "not stated" and is asked for,
  // rather than invalidating the whole plan.
  durationMinutes: z.coerce.number().int()
    .refine((value): value is 30 | 45 | 60 | 90 => (interviewDurationValues as readonly number[]).includes(value))
    .nullable().catch(null).optional().default(null),
  kind: z.enum(['recruiting', 'client']).nullable().catch(null).optional().default(null),
  note: z.string().trim().max(1_500).nullable().catch(null).optional().default(null)
})

const interviewDatePattern = /^\d{4}-\d{2}-\d{2}$/u
const interviewTimePattern = /^\d{2}:\d{2}$/u

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
    description: 'Import resume or skill-sheet files the operator attached to this turn. Only usable when the turn carries attachments. attachmentOrdinal may be null to import every attachment. The import produces drafts that still require the operator to confirm each field.',
    argumentsShape: '{"attachmentOrdinal":number|null}',
    effect: 'write', approval: 'none',
    parse: (value) => ({ toolName: 'resume.analyze.local', arguments: planningAttachmentArgumentsSchema.parse(value) })
  },
  {
    name: 'read_imported_draft',
    description: 'Read the machine-extracted draft of a resume imported earlier in this conversation, to summarise or answer questions about that person. Everything it returns is unconfirmed until the operator reviews each field. draftOrdinal may be null when exactly one resume was imported.',
    argumentsShape: '{"draftOrdinal":number|null}',
    effect: 'read', approval: 'none',
    parse: (value) => ({ toolName: 'candidate.draft.read.local', arguments: planningDraftArgumentsSchema.parse(value) })
  },
  {
    name: 'schedule_interview',
    description: 'Schedule an interview for a candidate. Fill only what the operator actually stated and leave everything else null - the app asks them for the missing details rather than choosing on their behalf. Set rank only when they named a position in a match result; for "this person" or a single imported resume leave it null, because the app resolves who is meant. date is YYYY-MM-DD and time is HH:mm in JST.',
    argumentsShape: '{"rank":number|null,"date":string|null,"time":string|null,"method":"zoom"|"google-meet"|"phone"|"onsite"|null,"durationMinutes":30|45|60|90|null,"kind":"recruiting"|"client"|null,"note":string|null}',
    effect: 'write', approval: 'none',
    parse: (value) => ({ toolName: 'candidate.interview.schedule.local', arguments: planningInterviewArgumentsSchema.parse(value) })
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

function salesAgentContext(): AiConversationContext {
  return {
    assistant: 'sales-agent',
    candidateDocumentId: null,
    interviewId: null,
    interviewKind: null,
    roundNumber: null
  }
}

function defaultState(): AiConversationSalesAgentState {
  return { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null }
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
    runId: record.runId,
    rank: record.rank,
    anonymousLabel: record.anonymousLabel,
    fitScore: record.fitScore,
    matched: record.matched,
    missing: record.missing,
    hardFilterStatus: record.hardFilterStatus,
    projectEvidence: record.projectEvidence,
    status: record.status
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
  locale: ApplicationLocale
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
    const requestedAction = parseAgentPlannedToolAction(rawPlannedAction)
    // The planner keeps choosing the read tool for a booking, and two rounds of
    // prompt wording did not settle it. A plan is a request; main redirects one
    // that cannot serve what was asked.
    const plannedAction: AgentPlannedToolAction =
      requestedAction.toolName === 'candidate.interview.read.local' && looksLikeInterviewBookingRequest(input.message)
        ? { toolName: 'candidate.interview.schedule.local', arguments: {
            rank: null, date: null, time: null, method: null, durationMinutes: null, kind: null, note: null
          } }
        : requestedAction
    const turnId = randomUUID()
    const previousMessages = current?.messages ?? []
    const previousState = current?.salesAgentState ?? defaultState()
    const inputMessage = userMessage(input, turnId)
    const messages = [...previousMessages, inputMessage].slice(-200)
    const locale = this.port.locale?.() ?? 'ja-JP'
    const now = this.port.now?.() ?? new Date()
    const save = (assistant: AiConversationMessage, state: AiConversationSalesAgentState, status: 'clarifying' | 'completed' | 'failed' | 'cancelled', toolName: DomainToolName | null, actionRunId: string | null) => {
      const saveInput: SaveAiConversationInput = {
        conversationId: input.conversationId,
        context: current?.context ?? salesAgentContext(),
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
          lifecycle: 'active', limit: 20
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
        const assistant = assistantMessage(content, [block], turnId)
        return save(assistant, { ...previousState, lastSearchMessageId: assistant.id }, 'completed', 'job-case.search.local', tool.actionRunId ?? null)
      }

      if (plannedAction.toolName === 'job-case.search.local' && plannedAction.arguments.operation === 'detail') {
        const resolved = resolveJobCaseReference(this.loadRecords(), previousState, previousMessages, input.selectedJobCaseRef, plannedAction.arguments.ordinal, locale)
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
        const assistant = assistantMessage(content, [block], turnId)
        return save(assistant, { ...previousState, selectedJobCaseRef: cards[0]?.reference ?? resolved.reference, lastSearchMessageId: assistant.id }, 'completed', 'job-case.search.local', tool.actionRunId ?? null)
      }

      if (plannedAction.toolName === 'candidate.match.local') {
        const resolved = resolveJobCaseReference(this.loadRecords(), previousState, previousMessages, input.selectedJobCaseRef, plannedAction.arguments.ordinal, locale)
        if ('clarification' in resolved) {
          const assistant = assistantMessage(resolved.clarification.prompt, [resolved.clarification], turnId)
          return save(assistant, previousState, 'clarifying', null, null)
        }
        const tool = await this.port.executeTool('candidate.match.local', {
          jobCaseId: resolved.reference.objectId, jobCaseVersion: resolved.reference.objectVersion
        }, { conversationId: input.conversationId, turnId, requestId: input.requestId })
        if (tool.toolName !== 'candidate.match.local') throw new AgentExecutionError('TOOL_RESULT_INVALID', '候选人匹配结果无效。')
        const cards = tool.output.cards.slice(0, 5).map((record, index) => candidateCard(record, index + 1))
        const block: AgentCandidateMatchCardsBlock = { type: 'candidate-match-cards', runId: tool.output.runId, resultHash: tool.output.resultHash, cards }
        const content = cards.length > 0
          ? textFor(locale, `現在の案件と確認済み人材プールでローカルマッチングを実行し、上位${cards.length}名を表示します。`, `已使用当前案件和确认人才池完成本地匹配，显示前 ${cards.length} 名。`)
          : textFor(locale, '現在の確認済み人材プールからマッチ結果が返りませんでした。', '当前确认人才池没有返回匹配结果。')
        const assistant = assistantMessage(content, [block], turnId)
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
        const assistant = assistantMessage(content, [block], turnId)
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
        const assistant = assistantMessage(content, [block], turnId)
        return save(assistant, { ...previousState, lastMatchRunId: tool.output.facts.runId }, 'completed', 'candidate.interview.read.local', tool.actionRunId ?? null)
      }

      if (plannedAction.toolName === 'candidate.interview.schedule.local') {
        const args = plannedAction.arguments
        // An interview attaches to a candidate review record, which exists as
        // soon as a resume is imported - a match run is one way to name that
        // person, not the only one.
        const importedInConversation = previousMessages
          .flatMap((message) => message.blocks ?? [])
          .filter((block): block is Extract<AiConversationBlock, { type: 'resume-import' }> => block.type === 'resume-import')
          .flatMap((block) => block.imported)
        let candidate: { anonymousLabel: string; sourceDocumentId: string } | null = null
        // A rank only means something when a match run exists. The model tends to
        // send rank 1 for "this person", which must not shadow the candidate the
        // operator actually imported.
        if (previousState.lastMatchRunId) {
          // A match run that cannot be resolved - stale, deleted, or an ordinal
          // that names nothing - just fails to produce a candidate. It must not
          // short-circuit the sources that can still answer unambiguously.
          const resolved = resolveMatchRunReference(previousState, previousMessages, args.rank, locale)
          if (!('clarification' in resolved)) {
            candidate = this.port.resolveInterviewCandidate?.(resolved.runId, resolved.resultId ?? null, resolved.rank) ?? null
          }
        }
        if (!candidate && importedInConversation.length === 1) {
          const only = importedInConversation[0]!
          candidate = { anonymousLabel: only.label, sourceDocumentId: only.documentId }
        }
        if (!candidate) {
          const schedulable = this.port.listSchedulableCandidates?.() ?? []
          if (schedulable.length === 1) candidate = schedulable[0]!
        }
        if (!candidate) {
          const resolved = resolveMatchRunReference(previousState, previousMessages, args.rank, locale)
          if ('clarification' in resolved) {
            const assistant = assistantMessage(resolved.clarification.prompt, [resolved.clarification], turnId)
            return save(assistant, previousState, 'clarifying', null, null)
          }
          candidate = this.port.resolveInterviewCandidate?.(resolved.runId, resolved.resultId ?? null, resolved.rank) ?? null
        }
        // Anything the operator did not actually say is asked for, never chosen
        // for them. A vague "book an interview" can therefore not create one.
        const missing: string[] = []
        const date = args.date && interviewDatePattern.test(args.date) ? args.date : null
        const time = args.time && interviewTimePattern.test(args.time) ? args.time : null
        if (!date) missing.push(textFor(locale, '日付', '日期'))
        if (!time) missing.push(textFor(locale, '開始時刻', '开始时间'))
        if (!args.method) missing.push(textFor(locale, '実施方法（Zoom / Google Meet / 電話 / 対面）', '会议方式（Zoom / Google Meet / 电话 / 现场）'))
        if (!args.durationMinutes) missing.push(textFor(locale, '所要時間（30 / 45 / 60 / 90 分）', '时长（30 / 45 / 60 / 90 分钟）'))
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
        if (!candidate) {
          const prompt = textFor(
            locale,
            '対象の候補者を特定できませんでした。どの候補者の面談かお知らせください。',
            '无法确定要给谁安排面试，请告诉我是哪一位候选人。'
          )
          return save(assistantMessage(prompt, [], turnId), previousState, 'clarifying', null, null)
        }
        const tool = await this.port.executeTool('candidate.interview.schedule.local', {
          sourceDocumentId: candidate.sourceDocumentId,
          candidateLabel: candidate.anonymousLabel,
          scheduledAt: `${date}T${time}:00+09:00`,
          durationMinutes: args.durationMinutes,
          meetingMethod: args.method,
          kind: args.kind ?? 'recruiting',
          ...(args.note ? { contactNote: args.note } : {})
        }, { conversationId: input.conversationId, turnId, requestId: input.requestId })
        if (tool.toolName !== 'candidate.interview.schedule.local') {
          throw new AgentExecutionError('TOOL_RESULT_INVALID', '面談登録结果无效。')
        }
        const methodLabels: Record<string, string> = {
          zoom: 'Zoom', 'google-meet': 'Google Meet',
          phone: textFor(locale, '電話', '电话'), onsite: textFor(locale, '対面', '现场')
        }
        const content = textFor(
          locale,
          `${tool.output.candidateLabel} の面談を ${date} ${time}（JST）に登録しました。実施方法は${methodLabels[tool.output.meetingMethod]}、所要 ${tool.output.durationMinutes} 分です。案内メールは送信していません。面談管理から内容を確認・変更できます。`,
          `已登记 ${tool.output.candidateLabel} 的面试：${date} ${time}（JST），方式${methodLabels[tool.output.meetingMethod]}，时长 ${tool.output.durationMinutes} 分钟。未发送任何通知邮件，可在面试管理里查看或修改。`
        )
        return save(assistantMessage(content, [], turnId), previousState, 'completed', 'candidate.interview.schedule.local', tool.actionRunId ?? null)
      }

      if (plannedAction.toolName === 'candidate.draft.read.local') {
        // Ordinals are resolved against the imports this conversation actually
        // made; the model never supplies a document id.
        const importedDrafts = previousMessages
          .flatMap((message) => message.blocks ?? [])
          .filter((block): block is Extract<AiConversationBlock, { type: 'resume-import' }> => block.type === 'resume-import')
          .flatMap((block) => block.imported)
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
          `${target.label} の未確認下書きを読み取りました（記入済み ${known} 項目、プロジェクト ${tool.output.facts.projects.length} 件）。以下は機械抽出であり、担当者が各項目を確認するまで候補者プロフィールにはなりません。`,
          `已读取 ${target.label} 的未确认草稿（已填写 ${known} 个字段，项目经历 ${tool.output.facts.projects.length} 段）。以下内容由机器抽取，需你逐项确认后才会成为候选人档案。`
        )
        return save(assistantMessage(content, [block], turnId), previousState, 'completed', 'candidate.draft.read.local', tool.actionRunId ?? null)
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
              `${imported.length}件の履歴書を端末内に取り込みました（${imported.map((file) => file.name).join('、')}）。抽出した項目は下書きです。候補者ライブラリに載せる前に、担当者が各項目を確認してください。${failed.length > 0 ? `${failed.length}件は取り込めませんでした。` : ''}`,
              `已在本机导入 ${imported.length} 份简历（${imported.map((file) => file.name).join('、')}）。抽取结果是草稿，进入候选人库前需要由你逐项确认。${failed.length > 0 ? `另有 ${failed.length} 份未能导入。` : ''}`
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
        const assistant = assistantMessage(content, imported.length > 0 ? [importBlock] : [], turnId)
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
      const assistant = assistantMessage(content, [block], turnId)
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
      context: current?.context ?? salesAgentContext(),
      messages: [...(current?.messages ?? []), inputMessage, assistant].slice(-200),
      salesAgentState: current?.salesAgentState ?? defaultState(),
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
    if (current && current.revision !== input.expectedConversationRevision) {
      throw new AgentExecutionError('CONVERSATION_REVISION_CONFLICT', '会话已在其他窗口更新，请重新加载历史后再发送。')
    }
    if (!current && input.expectedConversationRevision !== null) {
      throw new AgentExecutionError('CONVERSATION_NOT_FOUND', '会话不存在，请重新加载历史。')
    }
    return current
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
