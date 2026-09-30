import { randomUUID } from 'node:crypto'
import { createRedactedManualJobCaseSource, extractJobCaseDraft } from '@job-cases'
import type { EncryptedApplicationRepository } from '../index'

/** Test-only: stores one redacted manual job case draft and returns its ids. */
export function saveManualJobCaseDraft(
  repository: EncryptedApplicationRepository,
  input: { subject: string; body: string; knownPersonNames?: string[]; now?: Date }
) {
  const now = input.now ?? new Date('2026-07-17T00:00:00.000Z')
  const manual = createRedactedManualJobCaseSource(
    { subject: input.subject, body: input.body },
    randomUUID(),
    input.knownPersonNames ?? [],
    now
  )
  const draft = extractJobCaseDraft(manual.source, randomUUID(), now)
  const saved = repository.saveRedactedJobCaseSourceAndDraft(manual.redaction.session, manual.redaction.mappings, manual.source, draft)
  return { saved, manual, draft, reviewId: draft.reviewId }
}

/** Confirms every extracted field as-is, optionally overriding values. */
export function confirmAllJobCaseFields(
  repository: EncryptedApplicationRepository,
  reviewId: string,
  overrides: Record<string, { value: string; changeReason?: string }> = {},
  now = new Date('2026-07-17T00:01:00.000Z')
) {
  const review = repository.getJobCaseReview(reviewId)
  if (!review) throw new Error('review missing in fixture')
  return repository.confirmJobCaseReview(
    {
      reviewId,
      reviewRevision: review.reviewRevision,
      privacyReviewed: true,
      fields: review.fields.map((field) => {
        const override = overrides[field.key]
        return override
          ? { key: field.key, value: override.value, confirmed: true as const, changeReason: override.changeReason ?? '検証用変更' }
          : { key: field.key, value: field.value, confirmed: true as const }
      })
    },
    'test-user',
    '検証担当者',
    now
  )
}
