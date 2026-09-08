import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { DomainToolName } from '@shared/contracts'

export type ActionOrigin = 'work-task' | 'user-command' | 'managed-connector' | 'system'
export type IdempotencyMode = 'content-idempotent' | 'single-flight' | 'user-repeatable'

export interface ToolEffects {
  localRead: boolean
  localWrite: boolean
  externalRead: boolean
  externalWrite: boolean
  fileWrite: boolean
  cloudInvocation: boolean
  cloudPayload: 'none' | 'redacted-only'
}

export interface ActionContext {
  origin: ActionOrigin
  workTaskId: string | null
  scopeId: string
  scopeFingerprint: string
  actorId: string
  /** The content version approved by a domain workflow, when applicable. */
  contentRevision?: string | null
  conversationId?: string | null
  turnId?: string | null
}

export interface DomainToolSpec<TInput extends z.ZodType = z.ZodType> {
  name: DomainToolName
  version: 1
  inputSchema: TInput
  allowedOrigins: readonly ActionOrigin[]
  allowedScopeIds: readonly ActionContext['scopeId'][]
  effects: ToolEffects
  idempotencyMode: IdempotencyMode
  replayPolicy: 'safe-local' | 'manual-review' | 'never'
  approval: 'none' | 'native-confirmation' | 'inbox'
}

export type PolicyDecision =
  | { outcome: 'allow' }
  | { outcome: 'native-confirmation'; reason: string }
  | { outcome: 'require-approval'; reason: string; expiresAt: string }
  | { outcome: 'deny'; code: string; reason: string }

export class DomainToolRegistry {
  private readonly tools = new Map<DomainToolName, DomainToolSpec>()

  register(spec: DomainToolSpec): this {
    if (this.tools.has(spec.name)) throw new Error(`Duplicate domain tool registration: ${spec.name}`)
    this.tools.set(spec.name, spec)
    return this
  }

  get(name: DomainToolName): DomainToolSpec {
    const spec = this.tools.get(name)
    if (!spec) throw new Error(`Unregistered domain tool: ${name}`)
    return spec
  }

  list(): readonly DomainToolSpec[] {
    return [...this.tools.values()]
  }
}

export interface ActionAuditStore {
  createActionRun(input: {
    toolName: DomainToolName
    workTaskId: string | null
    origin: ActionOrigin
    scopeId: string
    scopeFingerprint: string
    inputHash: string
    contentRevision: string | null
    status: 'queued' | 'awaiting_approval' | 'blocked'
    idempotencyKey: string
    conversationId?: string | null
    turnId?: string | null
  }): { id: string; status: string }
  requestActionApproval(input: { actionRunId: string; reason: string; safeSummary: string; expiresAt: string }): unknown
}

/** Main-process-only orchestration: policy first, persistence second, executor last. */
export class ActionOrchestrator {
  constructor(private readonly registry: DomainToolRegistry, private readonly audit: ActionAuditStore) {}

  preflight(toolName: DomainToolName, context: ActionContext, rawInput: unknown, safeSummary: string, idempotencyKey: string) {
    const evaluated = evaluateActionPolicy(this.registry, toolName, context, rawInput)
    const status = evaluated.decision.outcome === 'deny'
      ? 'blocked'
      : evaluated.decision.outcome === 'require-approval' ? 'awaiting_approval' : 'queued'
    const run = this.audit.createActionRun({
      toolName,
      workTaskId: context.workTaskId,
      origin: context.origin,
      scopeId: context.scopeId,
      scopeFingerprint: context.scopeFingerprint,
      inputHash: evaluated.inputHash,
      contentRevision: context.contentRevision ?? null,
      conversationId: context.conversationId ?? null,
      turnId: context.turnId ?? null,
      status,
      idempotencyKey
    })
    if (evaluated.decision.outcome === 'require-approval') {
      this.audit.requestActionApproval({
        actionRunId: run.id,
        reason: evaluated.decision.reason,
        safeSummary,
        expiresAt: evaluated.decision.expiresAt
      })
    }
    return { ...evaluated, actionRunId: run.id }
  }
}

export function evaluateActionPolicy(
  registry: DomainToolRegistry,
  toolName: DomainToolName,
  context: ActionContext,
  rawInput: unknown,
  now = new Date()
): { spec: DomainToolSpec | null; input: unknown; decision: PolicyDecision; inputHash: string } {
  let spec: DomainToolSpec
  try {
    spec = registry.get(toolName)
  } catch {
    return {
      spec: null,
      input: undefined,
      inputHash: hashActionInput(rawInput),
      decision: { outcome: 'deny', code: 'UNREGISTERED_TOOL', reason: '登録されていない操作は実行できません。' }
    }
  }
  const input = spec.inputSchema.safeParse(rawInput)
  const inputHash = hashActionInput(rawInput)
  if (!input.success) return { spec, input: rawInput, inputHash, decision: { outcome: 'deny', code: 'INVALID_INPUT', reason: '操作入力が無効です。' } }
  if (!spec.allowedOrigins.includes(context.origin)) {
    return { spec, input: input.data, inputHash, decision: { outcome: 'deny', code: 'ORIGIN_DENIED', reason: 'この起点からの操作は許可されていません。' } }
  }
  if (!spec.allowedScopeIds.includes(context.scopeId)) {
    return { spec, input: input.data, inputHash, decision: { outcome: 'deny', code: 'SCOPE_DENIED', reason: 'このデータ範囲には操作権限がありません。' } }
  }
  if (!context.scopeId || !context.scopeFingerprint || !context.actorId) {
    return { spec, input: input.data, inputHash, decision: { outcome: 'deny', code: 'SCOPE_UNVERIFIED', reason: 'データ範囲を確認できません。' } }
  }
  if (spec.effects.cloudInvocation && spec.effects.cloudPayload !== 'redacted-only') {
    return { spec, input: input.data, inputHash, decision: { outcome: 'deny', code: 'CLOUD_PII_DENIED', reason: '未脱敏のデータをCloudへ送信できません。' } }
  }
  if (spec.approval === 'inbox' || (spec.name === 'proposal.export' && context.origin === 'system')) {
    return { spec, input: input.data, inputHash, decision: { outcome: 'require-approval', reason: '外部副作用を伴うため確認が必要です。', expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString() } }
  }
  if (spec.approval === 'native-confirmation') {
    return { spec, input: input.data, inputHash, decision: { outcome: 'native-confirmation', reason: '保存先はネイティブ確認で選択します。' } }
  }
  return { spec, input: input.data, inputHash, decision: { outcome: 'allow' } }
}

export function hashActionInput(input: unknown): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const taskIdSchema = z.string().min(1).max(128)
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const idSchema = z.object({ taskId: taskIdSchema }).strict()
const agentCaseSearchSchema = z.object({
  candidateDocumentId: z.string().uuid().optional(),
  mode: z.enum(['recent', 'by-id']),
  caseId: z.string().uuid().nullable().optional(),
  query: z.string().max(200).nullable().optional(),
  updatedAfter: z.string().datetime().nullable().optional(),
  updatedBefore: z.string().datetime().nullable().optional(),
  lifecycle: z.literal('active'),
  limit: z.number().int().positive().max(20)
}).strict()
const agentMatchRunReadSchema = z.object({
  runId: z.string().uuid(),
  resultId: z.string().uuid().nullable().optional(),
  rank: z.number().int().positive().max(20).nullable().optional()
}).strict()
const agentCandidateProfileReadSchema = z.object({
  runId: z.string().uuid(),
  resultId: z.string().uuid().nullable().optional(),
  rank: z.number().int().positive().max(20).nullable().optional()
}).strict()

export function createDefaultDomainToolRegistry(): DomainToolRegistry {
  return new DomainToolRegistry()
    .register({
      name: 'resume.analyze.local', version: 1,
      inputSchema: idSchema.extend({ fileToken: z.string().min(1).max(128) }).strict(),
      allowedOrigins: ['work-task', 'user-command'],
      allowedScopeIds: ['selected-files'],
      effects: { localRead: true, localWrite: true, externalRead: false, externalWrite: false, fileWrite: false, cloudInvocation: false, cloudPayload: 'none' },
      idempotencyMode: 'content-idempotent', replayPolicy: 'safe-local', approval: 'none'
    })
    .register({
      name: 'job-case.search.local', version: 1,
      inputSchema: agentCaseSearchSchema,
      allowedOrigins: ['user-command'],
      allowedScopeIds: ['active-job-cases'],
      effects: { localRead: true, localWrite: false, externalRead: false, externalWrite: false, fileWrite: false, cloudInvocation: false, cloudPayload: 'none' },
      idempotencyMode: 'content-idempotent', replayPolicy: 'safe-local', approval: 'none'
    })
    .register({
      name: 'candidate.match.local', version: 1, inputSchema: idSchema,
      allowedOrigins: ['work-task', 'user-command'],
      allowedScopeIds: ['confirmed-candidate-pool', 'selected-case'],
      effects: { localRead: true, localWrite: true, externalRead: false, externalWrite: false, fileWrite: false, cloudInvocation: false, cloudPayload: 'none' },
      idempotencyMode: 'content-idempotent', replayPolicy: 'safe-local', approval: 'none'
    })
    .register({
      name: 'candidate.interview.schedule.local', version: 1,
      inputSchema: z.object({
        sourceDocumentId: z.string().uuid(),
        scheduledAt: z.string().min(1).max(40),
        durationMinutes: z.number().int().positive().max(480),
        meetingMethod: z.enum(['zoom', 'google-meet', 'phone', 'onsite']),
        // The link itself is encrypted only in the interview record. ActionRun
        // receives a binding hash so audits cannot reveal meeting passwords.
        meetingUrlHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
        kind: z.enum(['recruiting', 'client']),
        contactNote: z.string().max(1_500).optional()
      }).strict(),
      allowedOrigins: ['user-command'],
      allowedScopeIds: ['selected-candidate-profile'],
      effects: { localRead: true, localWrite: true, externalRead: false, externalWrite: false, fileWrite: false, cloudInvocation: false, cloudPayload: 'none' },
      idempotencyMode: 'content-idempotent', replayPolicy: 'manual-review', approval: 'none'
    })
    .register({
      name: 'candidate.draft.read.local', version: 1,
      inputSchema: z.object({ sourceDocumentId: z.string().uuid() }).strict(),
      allowedOrigins: ['user-command'],
      allowedScopeIds: ['selected-files'],
      effects: { localRead: true, localWrite: false, externalRead: false, externalWrite: false, fileWrite: false, cloudInvocation: false, cloudPayload: 'none' },
      idempotencyMode: 'content-idempotent', replayPolicy: 'safe-local', approval: 'none'
    })
    .register({
      name: 'job-case.draft.read.local', version: 1,
      inputSchema: z.object({ reviewIds: z.array(z.string().uuid()).min(1).max(10) }).strict(),
      allowedOrigins: ['user-command'],
      allowedScopeIds: ['conversation-intake-drafts'],
      effects: { localRead: true, localWrite: false, externalRead: false, externalWrite: false, fileWrite: false, cloudInvocation: false, cloudPayload: 'none' },
      idempotencyMode: 'content-idempotent', replayPolicy: 'safe-local', approval: 'none'
    })
    .register({
      // Drafts the message for confirmed cases. Local read only: the text is
      // generated from stored case fields and never leaves the device. There
      // is no companion write tool - a copy is recorded by the screen that
      // performed it, and nothing here can claim a message was sent.
      name: 'job-case.broadcast.draft.local', version: 1,
      inputSchema: z.object({ reviewIds: z.array(z.string().uuid()).min(1).max(8) }).strict(),
      allowedOrigins: ['user-command'],
      allowedScopeIds: ['broadcast-queue'],
      effects: { localRead: true, localWrite: false, externalRead: false, externalWrite: false, fileWrite: false, cloudInvocation: false, cloudPayload: 'none' },
      idempotencyMode: 'content-idempotent', replayPolicy: 'safe-local', approval: 'none'
    })
    .register({
      name: 'candidate.profile.read.local', version: 1,
      inputSchema: agentCandidateProfileReadSchema,
      allowedOrigins: ['user-command'],
      allowedScopeIds: ['selected-candidate-profile'],
      effects: { localRead: true, localWrite: false, externalRead: false, externalWrite: false, fileWrite: false, cloudInvocation: false, cloudPayload: 'none' },
      idempotencyMode: 'content-idempotent', replayPolicy: 'safe-local', approval: 'none'
    })
    .register({
      name: 'candidate.interview.read.local', version: 1,
      inputSchema: agentCandidateProfileReadSchema,
      allowedOrigins: ['user-command'],
      allowedScopeIds: ['selected-candidate-interviews'],
      effects: { localRead: true, localWrite: false, externalRead: false, externalWrite: false, fileWrite: false, cloudInvocation: false, cloudPayload: 'none' },
      idempotencyMode: 'content-idempotent', replayPolicy: 'safe-local', approval: 'none'
    })
    .register({
      name: 'match-run.read.local', version: 1,
      inputSchema: agentMatchRunReadSchema,
      allowedOrigins: ['user-command'],
      allowedScopeIds: ['selected-match-run'],
      effects: { localRead: true, localWrite: false, externalRead: false, externalWrite: false, fileWrite: false, cloudInvocation: false, cloudPayload: 'none' },
      idempotencyMode: 'content-idempotent', replayPolicy: 'safe-local', approval: 'none'
    })
    .register({
      // The planner never sees this tool: the Main intake gate dispatches it
      // deterministically from the current user message, before any cloud call.
      // Input carries a digest only - never the pasted text itself.
      name: 'business-text.import.local', version: 1,
      inputSchema: z.object({
        contentDigest: hashSchema,
        kind: z.enum(['job-case', 'candidate'])
      }).strict(),
      allowedOrigins: ['user-command'],
      allowedScopeIds: ['current-agent-message'],
      effects: { localRead: true, localWrite: true, externalRead: false, externalWrite: false, fileWrite: true, cloudInvocation: false, cloudPayload: 'none' },
      idempotencyMode: 'content-idempotent', replayPolicy: 'safe-local', approval: 'none'
    })
    .register({
      name: 'gmail.sync.read', version: 1, inputSchema: z.object({ configurationFingerprint: hashSchema }).strict(),
      allowedOrigins: ['managed-connector', 'user-command'],
      allowedScopeIds: ['selected-gmail-message'],
      effects: { localRead: true, localWrite: true, externalRead: true, externalWrite: false, fileWrite: false, cloudInvocation: false, cloudPayload: 'none' },
      idempotencyMode: 'single-flight', replayPolicy: 'safe-local', approval: 'none'
    })
    .register({
      name: 'wechat.visible.read', version: 1,
      inputSchema: z.object({
        targetBundleIdentifier: z.literal('com.tencent.xinWeChat'),
        targetProcessIdentifier: z.number().int().positive(),
        targetLaunchDate: z.string().min(1).max(80),
        requestNonce: z.string().uuid()
      }).strict(),
      allowedOrigins: ['user-command'],
      allowedScopeIds: ['frontmost-wechat-visible-conversation'],
      effects: { localRead: true, localWrite: true, externalRead: true, externalWrite: false, fileWrite: false, cloudInvocation: false, cloudPayload: 'none' },
      idempotencyMode: 'user-repeatable', replayPolicy: 'never', approval: 'native-confirmation'
    })
    .register({
      name: 'proposal.export', version: 1,
      inputSchema: z.object({ taskId: taskIdSchema, draftId: z.string().min(1).max(128), revision: z.number().int().positive(), contentHash: hashSchema }).strict(),
      allowedOrigins: ['work-task', 'user-command', 'system'],
      // Proposal creation currently uses the confirmed candidate pool as its
      // default WorkTask scope; a selected case is accepted when explicitly set.
      allowedScopeIds: ['confirmed-candidate-pool', 'selected-case'],
      effects: { localRead: true, localWrite: true, externalRead: false, externalWrite: false, fileWrite: true, cloudInvocation: false, cloudPayload: 'none' },
      idempotencyMode: 'user-repeatable', replayPolicy: 'manual-review', approval: 'native-confirmation'
    })
}
