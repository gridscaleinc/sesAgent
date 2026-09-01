import { randomUUID } from 'node:crypto'
import { createGmailJobCaseSource, extractJobCaseDraft } from '@job-cases'
import type { EncryptedApplicationRepository } from '@persistence'
import type { JobCaseFieldAliasMap } from '@shared/contracts'
import { autoConfirmJobCaseDraft } from './business-text-intake'

/** Counts only - safe for logs and for the scheduler notification. */
export interface GmailJobCaseIntakeCounts {
  created: number
  confirmed: number
  needsAttention: number
  failed: number
}

export type GmailJobCaseIntakeRepository = Pick<
  EncryptedApplicationRepository,
  | 'listGmailMessagesPendingJobCaseDrafts'
  | 'ensureGmailJobCaseSource'
  | 'saveJobCaseDraft'
  | 'getJobCaseReview'
  | 'confirmJobCaseReview'
>

/**
 * Turns redacted Gmail messages that still have no job-case draft into drafts
 * and - like every other intake route - makes each fresh draft a valid case on
 * the spot under the operator's identity, with the operator's field aliases
 * steering extraction. What the store refuses (no title, a direct identifier,
 * a nationality condition) stays awaiting review in the workspace, and a
 * message whose draft could not be created at all stays pending so the next
 * synchronization retries it.
 */
export function createJobCaseDraftsForPendingGmailMessages(
  repository: GmailJobCaseIntakeRepository,
  accountEmail: string,
  operator: { operatorId: string; displayName: string } | null,
  aliases: JobCaseFieldAliasMap = {},
  now: () => Date = () => new Date()
): GmailJobCaseIntakeCounts {
  const counts: GmailJobCaseIntakeCounts = { created: 0, confirmed: 0, needsAttention: 0, failed: 0 }
  for (const message of repository.listGmailMessagesPendingJobCaseDrafts(accountEmail)) {
    try {
      const source = repository.ensureGmailJobCaseSource(createGmailJobCaseSource({
        accountEmail: message.accountEmail,
        gmailMessageId: message.gmailMessageId,
        threadId: message.threadId,
        fromDomain: message.fromDomain,
        messageDate: message.internalDate,
        redactedSubject: message.redactedSubject,
        redactedBody: message.redactedBody,
        redactionSessionId: message.redactionSessionId,
        warningCodes: message.warningCodes,
        createdAt: message.importedAt
      }, randomUUID()))
      const draft = extractJobCaseDraft(source, randomUUID(), now(), {}, null, aliases)
      if (!repository.saveJobCaseDraft(draft)) continue
      counts.created += 1
      if (!operator) continue
      const review = repository.getJobCaseReview(draft.reviewId)
      if (!review || review.status !== 'awaiting-review') continue
      // Refusals stay drafts; the reason lives in the review the operator opens.
      if (autoConfirmJobCaseDraft(repository, review, operator, now()).review) counts.confirmed += 1
      else counts.needsAttention += 1
    } catch {
      // The redacted Gmail record remains pending and will be retried on the next local synchronization.
      counts.failed += 1
    }
  }
  return counts
}
