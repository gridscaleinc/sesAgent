import { detectDirectIdentifiers } from '@privacy'
import {
  generateBroadcastText,
  generateUpdateNoticeText,
  type BroadcastTemplate,
  type BroadcastWorkspace,
  type CaseBroadcastCopy,
  type CaseBroadcastHistoryEntry,
  type CaseBroadcastRecord,
  type DraftCaseBroadcastInput,
  type DraftCaseBroadcastResult,
  type DraftCaseUpdateNoticeInput,
  type DraftCaseUpdateNoticeResult,
  type JobCaseReviewSnapshot,
  type JobCaseVersionDetail,
  type OpenCaseBroadcastEmailInput,
  type RecordCaseBroadcastCopyInput,
  type RecordCaseBroadcastCopyResult
} from '@shared'
import type { CaseBroadcastCopyAppend } from '@persistence'
import { deriveBroadcastQueue, diffBroadcastFields, lastCopiedJobCaseVersion } from './broadcast-workspace'

/**
 * Everything 案件配信 reads and writes, as a structural type rather than the
 * whole repository. The IPC handlers and the Agent tool branches both call
 * this module, so the DLP and lifecycle rules below exist exactly once.
 */
export interface BroadcastServiceRepository {
  listBroadcastTemplates(): BroadcastTemplate[]
  listJobCaseReviews(): JobCaseReviewSnapshot[]
  getJobCaseReview(reviewId: string): JobCaseReviewSnapshot | null
  listCaseBroadcastCopies(reviewId: string): CaseBroadcastCopy[]
  listAllCaseBroadcastCopies(): CaseBroadcastCopy[]
  /** Pre-v43 send ledger. Read for history and for the queue; never written. */
  listCaseBroadcasts(reviewId: string): CaseBroadcastRecord[]
  listAllCaseBroadcasts(): CaseBroadcastRecord[]
  getJobCaseHistory(reviewId: string): JobCaseVersionDetail[]
  appendCaseBroadcastCopy(entry: CaseBroadcastCopyAppend): CaseBroadcastCopy
}

/** A review that a person confirmed and that is still valid, so it may be broadcast. */
export type SendableJobCaseReview = JobCaseReviewSnapshot & {
  jobCase: NonNullable<JobCaseReviewSnapshot['jobCase']>
}

export function activeCaseTitle(review: JobCaseReviewSnapshot): string {
  return review.fields.find((field) => field.key === 'title')?.value ?? review.redactedSubject
}

export function resolveBroadcastTemplate(
  repository: BroadcastServiceRepository,
  templateId?: string
): BroadcastTemplate {
  const templates = repository.listBroadcastTemplates()
  const template = templateId ? templates.find((item) => item.id === templateId) : templates[0]
  if (!template) throw new Error('紹介文テンプレートが見つかりません。')
  return template
}

/** A case is broadcastable only once a person confirmed it and it is still valid. */
export function requireSendableReview(
  repository: BroadcastServiceRepository,
  reviewId: string
): SendableJobCaseReview {
  const review = repository.getJobCaseReview(reviewId)
  if (!review) throw new Error('案件レコードが見つかりません。')
  if (review.lifecycle !== 'active') throw new Error('無効になった案件は配信できません。')
  if (review.status !== 'completed' || !review.jobCase) throw new Error('確認待ちの案件は配信できません。先に案件を確定してください。')
  return review as SendableJobCaseReview
}

export function loadBroadcastWorkspace(repository: BroadcastServiceRepository): BroadcastWorkspace {
  return {
    queue: deriveBroadcastQueue({
      reviews: repository.listJobCaseReviews(),
      ledger: repository.listAllCaseBroadcasts(),
      copies: repository.listAllCaseBroadcastCopies()
    }),
    templates: repository.listBroadcastTemplates()
  }
}

/**
 * The copy history of one case, newest first: the copies this device recorded
 * plus the pre-v43 ledger rows, which claimed more than the app could know but
 * still mark a moment the case was worked on. No entry carries message text.
 */
export function loadCaseBroadcastHistory(
  repository: BroadcastServiceRepository,
  reviewId: string
): CaseBroadcastHistoryEntry[] {
  const entries: CaseBroadcastHistoryEntry[] = [
    ...repository.listCaseBroadcastCopies(reviewId).map((copy): CaseBroadcastHistoryEntry => ({
      id: copy.id,
      source: 'copy',
      jobCaseVersion: copy.jobCaseVersion,
      templateId: copy.templateId,
      templateRevision: copy.templateRevision,
      lang: copy.lang,
      kind: copy.kind,
      createdAt: copy.createdAt
    })),
    ...repository.listCaseBroadcasts(reviewId).map((record): CaseBroadcastHistoryEntry => ({
      id: record.id,
      source: 'legacy',
      jobCaseVersion: record.jobCaseVersion,
      templateId: record.templateId,
      templateRevision: record.templateRevision,
      lang: record.lang,
      kind: record.kind,
      createdAt: record.createdAt
    }))
  ]
  return entries.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id))
}

export function draftCaseBroadcast(
  repository: BroadcastServiceRepository,
  input: DraftCaseBroadcastInput
): DraftCaseBroadcastResult {
  const review = requireSendableReview(repository, input.reviewId)
  const template = resolveBroadcastTemplate(repository, input.templateId)
  return draftCaseBroadcastForReview(review, template)
}

/**
 * Both language versions of one confirmed case plus what the local identifier
 * detector found in each. Detection results travel back rather than blocking
 * here: the operator has to see which identifier types are still in the text
 * before it can go out.
 */
export function draftCaseBroadcastForReview(
  review: SendableJobCaseReview,
  template: BroadcastTemplate
): DraftCaseBroadcastResult {
  const fields = review.fields.map((field) => ({ key: field.key, value: field.value }))
  const title = activeCaseTitle(review)
  const textJa = generateBroadcastText(fields, title, template, 'ja')
  const textZh = generateBroadcastText(fields, title, template, 'zh')
  return {
    textJa,
    textZh,
    forbiddenJa: detectDirectIdentifiers(textJa),
    forbiddenZh: detectDirectIdentifiers(textZh)
  }
}

export function draftCaseUpdateNotice(
  repository: BroadcastServiceRepository,
  input: DraftCaseUpdateNoticeInput
): DraftCaseUpdateNoticeResult {
  const review = requireSendableReview(repository, input.reviewId)
  const baselineVersion = lastCopiedJobCaseVersion(
    repository.listCaseBroadcasts(review.reviewId),
    repository.listCaseBroadcastCopies(review.reviewId)
  )
  if (baselineVersion === null) return { status: 'no-copy-baseline' }
  const history = repository.getJobCaseHistory(review.reviewId)
  const baseline = history.find((version) => version.version === baselineVersion)
  const current = history.find((version) => version.version === review.jobCase.version)
  if (!baseline || !current) return { status: 'no-copy-baseline' }
  const template = resolveBroadcastTemplate(repository)
  const changes = diffBroadcastFields(baseline, current, template)
  if (changes.ja.length === 0) return { status: 'no-changes' }
  const title = activeCaseTitle(review)
  return {
    status: 'ready',
    textJa: generateUpdateNoticeText(title, changes.ja, 'ja'),
    textZh: generateUpdateNoticeText(title, changes.zh, 'zh'),
    changes: changes.ja
  }
}

/**
 * Writes down the one thing this device actually witnessed: the operator put
 * this text on the clipboard. Where it goes afterwards is theirs to manage.
 * A text still carrying an identifier records nothing at all.
 */
export function recordCaseBroadcastCopy(
  repository: BroadcastServiceRepository,
  operator: { operatorId: string },
  input: RecordCaseBroadcastCopyInput
): RecordCaseBroadcastCopyResult {
  const review = requireSendableReview(repository, input.reviewId)
  const template = resolveBroadcastTemplate(repository, input.templateId)
  const identifiers = detectDirectIdentifiers(input.text)
  if (identifiers.length > 0) {
    throw new Error(`本文に識別子が残っています（${identifiers.join('、')}）。削除してからもう一度操作してください。`)
  }
  const copy = repository.appendCaseBroadcastCopy({
    reviewId: review.reviewId,
    jobCaseId: review.jobCase.id,
    jobCaseVersion: review.jobCase.version,
    templateId: template.id,
    templateRevision: template.revision,
    lang: input.lang,
    kind: input.kind,
    text: input.text,
    actorId: operator.operatorId
  })
  // Ids, counts and fixed codes only - never the case text.
  console.info('[case-broadcast-copied]', { copyId: copy.id, kind: copy.kind, lang: copy.lang })
  return { copy }
}

export interface PreparedCaseBroadcastEmail {
  mailtoUrl: string
  subject: string
  body: string
}

function encodeMailtoQueryValue(value: string): string {
  // Some native mail clients display URLSearchParams' `+` literally instead
  // of treating it as a space in mailto fields. RFC 3986 percent encoding is
  // accepted consistently and also prevents query-parameter injection.
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

/**
 * Builds a mailto hand-off from the same confirmed, locally checked message
 * the operator can copy. The recipient deliberately stays empty: choosing and
 * verifying it, then pressing Send, belongs to the default mail client.
 */
export function prepareCaseBroadcastEmail(
  repository: BroadcastServiceRepository,
  input: OpenCaseBroadcastEmailInput
): PreparedCaseBroadcastEmail {
  const review = requireSendableReview(repository, input.reviewId)
  resolveBroadcastTemplate(repository, input.templateId)
  const title = activeCaseTitle(review).replace(/[\r\n]+/gu, ' ').replace(/\s+/gu, ' ').trim()
  const subject = `${input.kind === 'update' ? '【案件更新】' : '【案件】'}${title}`
  const identifiers = detectDirectIdentifiers(`${subject}\n${input.text}`)
  if (identifiers.length > 0) {
    throw new Error(`本文に識別子が残っています（${identifiers.join('、')}）。削除してからもう一度操作してください。`)
  }
  const mailtoUrl = `mailto:?subject=${encodeMailtoQueryValue(subject)}&body=${encodeMailtoQueryValue(input.text)}`
  // Avoid handing an unreasonably large command URL to an operating-system
  // protocol handler. Normal generated case messages are far below this cap.
  if (mailtoUrl.length > 16_000) {
    throw new Error('メール本文が長すぎます。本文を短くしてからもう一度操作してください。')
  }
  return { mailtoUrl, subject, body: input.text }
}
