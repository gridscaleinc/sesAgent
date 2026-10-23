import { randomUUID } from 'node:crypto'
import {
  jobCaseFieldKeys,
  type ApplyJobCaseFieldCorrectionsInput,
  type JobCaseFieldCorrection,
  type JobCaseFieldCorrectionSuggestions,
  type JobCaseFieldKey,
  type JobCaseReviewSnapshot
} from '@shared/contracts'
import { effectiveJobCaseFieldAliases } from './app-defaults'
import { businessModel } from './business-model'
import type { MainIpcContext } from './ipc/context'

/**
 * AI completion of imported cases. Rules read the labels first; when they leave one of the fields HR matches and
 * introduces on empty, the AI reads the case's stored redacted source once and fills the empty fields - never one
 * that has a value. Every value must be copied verbatim from that text (the paste intake's own check), so nothing
 * beyond what local redaction kept can reach the case.
 */

/** Empty, these make an imported case worth one AI read. */
export const jobCaseAiFillTriggerKeys = ['start_date', 'location', 'rate', 'required_skills'] as const satisfies readonly JobCaseFieldKey[]
/** The title stays what the subject names; every other field may be filled. */
const fillableKeys = jobCaseFieldKeys.filter((key) => key !== 'title')
/** The source the model reads: subject and body, bounded well under the projection limit. */
const sourceCharacterLimit = 12_000
const changeReason = 'AIで未入力項目を補完'

export type JobCaseAiFillContext = Pick<
  MainIpcContext,
  'repository' | 'agentNarrativeStreamer' | 'agentChatModelCatalog' | 'currentOperator'
>

export function emptyAiFillableKeys(review: Pick<JobCaseReviewSnapshot, 'fields'>): JobCaseFieldKey[] {
  const empty = new Set(review.fields.filter((field) => field.value === null).map((field) => field.key))
  return fillableKeys.filter((key) => empty.has(key))
}

/** A valid case that is missing one of the trigger fields. */
export function needsAiFill(review: JobCaseReviewSnapshot): boolean {
  if (review.lifecycle !== 'active' || review.status !== 'completed') return false
  const empty = new Set(emptyAiFillableKeys(review))
  return jobCaseAiFillTriggerKeys.some((key) => empty.has(key))
}

/** Fills one case's empty fields from its stored redacted source; returns the keys it filled. */
export async function fillJobCaseFieldsWithAi(
  context: JobCaseAiFillContext,
  reviewId: string,
  signal?: AbortSignal
): Promise<{ review: JobCaseReviewSnapshot; filled: JobCaseFieldKey[] }> {
  const review = validJobCaseReview(context, reviewId)
  const keys = emptyAiFillableKeys(review)
  if (!keys.length) return { review, filled: [] }
  const values = await readJobCaseFieldsWithAi(context, review, keys, signal)
  if (!Object.keys(values).length) return { review, filled: [] }
  const operator = context.currentOperator()
  const saved = context.repository.fillEmptyJobCaseFields(reviewId, values, changeReason, operator.operatorId, operator.displayName)
  return { review: saved.review, filled: saved.filled as JobCaseFieldKey[] }
}

const correctionReason = 'AIの再確認で修正'
/** How long the suggestions of a re-check can still be applied. */
const correctionLifetimeMs = 30 * 60_000
/**
 * The last re-check per case. Applying takes values from here only, so what lands in the case is exactly what
 * the AI read from the source and the operator accepted - never a value the renderer sends.
 */
const pendingCorrections = new Map<string, { revision: number; values: Map<JobCaseFieldKey, string>; at: number }>()

/** The same text written another way (full-width digits, 〜 for ～, spacing) is not a correction. */
function comparable(value: string): string {
  return value.normalize('NFKC').replace(/[~〜]/gu, '〜').replace(/\s+/gu, ' ').trim()
}

/**
 * Has the AI re-read a valid case's source and lists every field whose stated value differs from the case, or
 * that the case is missing. A field the source does not state is never suggested for removal. Changes nothing.
 */
export async function suggestJobCaseFieldCorrections(
  context: JobCaseAiFillContext,
  reviewId: string,
  signal?: AbortSignal
): Promise<JobCaseFieldCorrectionSuggestions> {
  const review = validJobCaseReview(context, reviewId)
  const values = await readJobCaseFieldsWithAi(context, review, fillableKeys, signal)
  const corrections: JobCaseFieldCorrection[] = review.fields.flatMap((field) => {
    const suggested = values[field.key]
    if (!suggested || (field.value !== null && comparable(field.value) === comparable(suggested))) return []
    return [{ key: field.key, current: field.value, suggested }]
  })
  pendingCorrections.set(reviewId, {
    revision: review.reviewRevision,
    values: new Map(corrections.map((item) => [item.key, item.suggested])),
    at: Date.now()
  })
  return { reviewId, reviewRevision: review.reviewRevision, corrections }
}

/** Writes the accepted suggestions of the last re-check as one new version; a case changed since is refused. */
export function applyJobCaseFieldCorrections(
  context: Pick<JobCaseAiFillContext, 'repository' | 'currentOperator'>,
  input: ApplyJobCaseFieldCorrectionsInput
): { review: JobCaseReviewSnapshot; filled: JobCaseFieldKey[] } {
  const pending = pendingCorrections.get(input.reviewId)
  if (!pending || pending.revision !== input.reviewRevision || Date.now() - pending.at > correctionLifetimeMs)
    throw new Error('AI 的建议已过期，请重新确认。 / AIの提案が古くなりました。もう一度「AIで再確認」してください。')
  const values = Object.fromEntries(input.keys.flatMap((key) => (pending.values.has(key) ? [[key, pending.values.get(key)!]] : [])))
  if (!Object.keys(values).length) return { review: validJobCaseReview(context, input.reviewId), filled: [] }
  const operator = context.currentOperator()
  const saved = context.repository.reviseJobCaseFields(
    input.reviewId,
    input.reviewRevision,
    values,
    correctionReason,
    operator.operatorId,
    operator.displayName
  )
  pendingCorrections.delete(input.reviewId)
  return { review: saved.review, filled: saved.changed as JobCaseFieldKey[] }
}

function validJobCaseReview(context: Pick<JobCaseAiFillContext, 'repository'>, reviewId: string): JobCaseReviewSnapshot {
  const review = context.repository.getJobCaseReview(reviewId)
  if (!review || review.lifecycle !== 'active' || review.status !== 'completed')
    throw new Error('案件不存在、已结束或尚未生效，无法补全。 / 案件が存在しないか、終了済みまたは未確定のため補完できません。')
  return review
}

/** The values of `keys` the AI read from the case's stored redacted source, each copied verbatim from it. */
async function readJobCaseFieldsWithAi(
  context: JobCaseAiFillContext,
  review: JobCaseReviewSnapshot,
  keys: readonly JobCaseFieldKey[],
  signal?: AbortSignal
): Promise<Partial<Record<JobCaseFieldKey, string>>> {
  const cloud = context.agentNarrativeStreamer
  if (!cloud) throw new Error('CASE_AI_UNAVAILABLE')
  // The redacted read is the one cloud callers use; the restored display text never leaves the device.
  const source = context.repository.getJobCaseSourceText(review.reviewId)
  if (!source) throw new Error('案件来源原文不存在。 / 案件の取込元本文が見つかりませんでした。')
  const text = `${source.redactedSubject.replace(/\s+/gu, ' ').trim()}\n${source.redactedBody}`.slice(0, sourceCharacterLimit)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90_000)
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  let remoteId: string | null = null
  const cancel = () => {
    if (remoteId) void cloud.cancel(remoteId).catch(() => undefined)
  }
  controller.signal.addEventListener('abort', cancel, { once: true })
  try {
    const values = await cloud.completeJobCaseFields({
      conversationId: randomUUID(),
      requestId: randomUUID(),
      text,
      keys,
      aliases: effectiveJobCaseFieldAliases(context.repository).aliases,
      model: businessModel(context, 'checking'),
      signal: controller.signal,
      onClientRequestId: (id) => {
        remoteId = id
        if (controller.signal.aborted) cancel()
      },
      onRemoteSettled: () => {
        remoteId = null
      }
    })
    controller.signal.throwIfAborted()
    return values
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

/** The AI member problems that fail every following case the same way: the queue stops instead of retrying them. */
function stopsQueue(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /INSUFFICIENT_CREDITS|not enough available AI credits|MEMBER_SIGN_IN_REQUIRED|MEMBER_SESSION_EXPIRED|TOKEN_INVALID|TOKEN_REVOKED|Please sign in|CASE_AI_UNAVAILABLE/iu.test(
    message
  )
}

/**
 * Background completion after Gmail sync and EML import. Imports stay fast and rule-based; cases that came in
 * missing a trigger field are completed one at a time while the AI member is signed in. Nothing is retried
 * after a credit or sign-in failure; HR can still complete a case from its detail.
 */
export function createJobCaseAiFiller(context: JobCaseAiFillContext & { isAiSignedIn(): Promise<boolean> }) {
  const queue: string[] = []
  let running = false
  let listener: ((reviewIds: string[]) => void) | null = null
  const drain = async () => {
    if (running) return
    running = true
    const filledIds: string[] = []
    try {
      while (queue.length) {
        if (!context.agentNarrativeStreamer || !(await context.isAiSignedIn().catch(() => false))) {
          queue.length = 0
          break
        }
        const reviewId = queue.shift()!
        const review = context.repository.getJobCaseReview(reviewId)
        if (!review || !needsAiFill(review)) continue
        try {
          const { filled } = await fillJobCaseFieldsWithAi(context, reviewId)
          if (filled.length) filledIds.push(reviewId)
        } catch (error) {
          console.warn('[job-case-ai-fill-failed]', { reason: (error instanceof Error ? error.name : 'unknown').slice(0, 80) })
          if (stopsQueue(error)) queue.length = 0
        }
      }
    } finally {
      running = false
      if (filledIds.length) listener?.(filledIds)
    }
  }
  return {
    /** Queues the cases that need it; already queued ones are not added twice. */
    enqueue(reviewIds: readonly string[]) {
      for (const reviewId of reviewIds) {
        const review = context.repository.getJobCaseReview(reviewId)
        if (review && needsAiFill(review) && !queue.includes(reviewId)) queue.push(reviewId)
      }
      if (queue.length) void drain()
    },
    onFilled(next: (reviewIds: string[]) => void) {
      listener = next
    },
    /** Resolves once the queue is empty (tests and shutdown). */
    async idle() {
      while (running || queue.length) await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}

export type JobCaseAiFiller = ReturnType<typeof createJobCaseAiFiller>
