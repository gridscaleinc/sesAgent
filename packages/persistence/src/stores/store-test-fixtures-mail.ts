import { createHash } from 'node:crypto'
import { createRedactedManualJobCaseSource, extractJobCaseDraft } from '@job-cases'
import { redactTextForCloud } from '@privacy'
import type { EncryptedApplicationRepository, StoredGmailMessageInput } from '../index'

/** Test-only fixtures shared by the gmail / broadcast / proposal store tests. */
export const testAccount = 'hr@example.co.jp'

export function fingerprint(seed: string): string {
  return createHash('sha256').update(seed).digest('hex')
}

/**
 * Redacts `raw` locally, saves the redaction session + encrypted mappings and
 * returns a valid Gmail message input that references that session.
 */
export function saveRedactedGmailMessage(
  repository: EncryptedApplicationRepository,
  raw: { subject: string; body: string; personNames: string[] },
  overrides: Partial<StoredGmailMessageInput> = {}
): { message: StoredGmailMessageInput; saved: boolean; sessionId: string } {
  const redaction = redactTextForCloud(`${raw.subject}\n${raw.body}`, {
    sourceVersion: 'store-test-gmail:v1',
    knownPersonNames: raw.personNames,
    personNameReviewCompleted: true,
    now: new Date('2026-07-17T00:02:00.000Z')
  })
  repository.saveRedactionSession(redaction.session, redaction.mappings)
  const [redactedSubject, ...bodyLines] = redaction.redactedContent.split('\n')
  const message: StoredGmailMessageInput = {
    accountEmail: testAccount,
    gmailMessageId: 'gmail_msg_001',
    threadId: 'gmail_thread_001',
    historyId: '120',
    internalDate: '2026-07-17T00:02:00.000Z',
    labelIds: ['INBOX', 'Label_SES'],
    rfcMessageId: 'f'.repeat(64),
    fromDomain: 'partner.example.jp',
    redactedSubject: redactedSubject ?? '',
    redactedBody: bodyLines.join('\n'),
    redactionSessionId: redaction.session.id,
    classification: 'job-case',
    businessFingerprint: fingerprint(redaction.redactedContent),
    duplicateOfMessageId: null,
    warningCodes: [],
    attachmentCount: 0,
    importedAt: '2026-07-17T00:02:00.000Z',
    ...overrides
  }
  return { message, saved: repository.saveGmailMessage(message), sessionId: redaction.session.id }
}

/**
 * Creates a manual (pasted) job case, saves its redaction + draft and confirms
 * it, the way the HR workbench does. Returns the review id and the confirmed case.
 */
export function createConfirmedManualJobCase(
  repository: EncryptedApplicationRepository,
  options: { reviewId?: string; sourceId?: string; title?: string; now?: Date } = {}
) {
  const now = options.now ?? new Date('2026-07-17T00:02:50.000Z')
  const reviewId = options.reviewId ?? 'c13f1590-5723-4248-a8c7-1f8669a78b19'
  const manualSource = createRedactedManualJobCaseSource(
    {
      subject: `${options.title ?? 'Python案件'} 佐藤秘密担当様`,
      body: '担当：佐藤秘密担当\n電話：080-8765-4321\n必須スキル：Python / AWS\n単価：90万円/月\n勤務地：東京都港区'
    },
    options.sourceId ?? '21053d42-f2de-4e20-a479-a95d7c70ec4b',
    ['佐藤秘密担当'],
    now
  )
  const draft = extractJobCaseDraft(manualSource.source, reviewId, now)
  if (
    !repository.saveRedactedJobCaseSourceAndDraft(
      manualSource.redaction.session,
      manualSource.redaction.mappings,
      manualSource.source,
      draft
    )
  )
    throw new Error('fixture job case draft was not saved')
  const review = repository.getJobCaseReview(reviewId)
  if (!review) throw new Error('fixture job case review missing')
  const confirmed = repository.confirmJobCaseReview(
    {
      reviewId,
      reviewRevision: review.reviewRevision,
      privacyReviewed: true,
      fields: draft.fields.map((field) => ({ key: field.key, value: field.value, confirmed: true as const }))
    },
    'store-test-user',
    '検証担当者',
    new Date(now.getTime() + 1_000)
  )
  if (!confirmed.jobCase) throw new Error('fixture job case was not confirmed')
  return { reviewId, review: confirmed, jobCase: confirmed.jobCase }
}
