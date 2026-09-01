import {
  broadcastForbiddenFieldKeys,
  publishedBroadcastFieldValue,
  type BroadcastFieldChange,
  type BroadcastLanguage,
  type BroadcastQueueItem,
  type BroadcastQueueStatus,
  type BroadcastTemplate,
  type CaseBroadcastCopy,
  type CaseBroadcastRecord,
  type JobCaseFieldKey,
  type JobCaseReviewSnapshot,
  type JobCaseVersionDetail
} from '@shared'

function fieldValue(review: JobCaseReviewSnapshot, key: JobCaseFieldKey): string | null {
  return review.fields.find((field) => field.key === key)?.value ?? null
}

/** Queue order: what still needs doing first, what is finished last. */
const statusRank: Record<BroadcastQueueStatus, number> = { new: 0, attention: 1, copied: 2 }

/**
 * One past copy, whatever wrote it down. A pre-v43 ledger row said what left
 * for a group; the app only ever knew that a copy happened, so both shapes
 * reduce to the same three facts and both count as a copy here.
 */
interface CopyEvent {
  at: string
  lang: BroadcastLanguage
  jobCaseVersion: number
}

function copyEvents(
  ledger: ReadonlyArray<CaseBroadcastRecord>,
  copies: ReadonlyArray<CaseBroadcastCopy>
): CopyEvent[] {
  return [...ledger, ...copies]
    .map((entry) => ({ at: entry.createdAt, lang: entry.lang, jobCaseVersion: entry.jobCaseVersion }))
    .toSorted((left, right) => left.at.localeCompare(right.at))
}

/** The highest case version this device ever put on the clipboard. */
export function lastCopiedJobCaseVersion(
  ledger: ReadonlyArray<CaseBroadcastRecord>,
  copies: ReadonlyArray<CaseBroadcastCopy>
): number | null {
  const events = copyEvents(ledger, copies)
  return events.length > 0 ? Math.max(...events.map((event) => event.jobCaseVersion)) : null
}

/**
 * The queue is not a table: it is every active case read against the copies.
 * A case nobody copied yet is new; one that was copied is done until the case
 * is revised again. Whether a copied message was then posted to a group is not
 * a fact this device has, so no status claims it.
 */
export function deriveBroadcastQueue(input: {
  reviews: ReadonlyArray<JobCaseReviewSnapshot>
  ledger: ReadonlyArray<CaseBroadcastRecord>
  copies: ReadonlyArray<CaseBroadcastCopy>
}): BroadcastQueueItem[] {
  const byReview = new Map<string, CopyEvent[]>()
  for (const row of [...input.ledger, ...input.copies]) {
    byReview.set(row.reviewId, [
      ...(byReview.get(row.reviewId) ?? []),
      { at: row.createdAt, lang: row.lang, jobCaseVersion: row.jobCaseVersion }
    ])
  }
  return input.reviews
    .filter((review) => review.lifecycle === 'active')
    .map((review): BroadcastQueueItem => {
      const title = fieldValue(review, 'title') ?? review.redactedSubject
      const confirmed = review.status === 'completed' && review.jobCase !== null
      if (!confirmed) {
        return {
          reviewId: review.reviewId,
          jobCaseId: review.jobCase?.id ?? null,
          jobCaseVersion: review.jobCase?.version ?? null,
          title,
          sourceType: review.sourceType,
          status: 'attention',
          lastCopy: null,
          hasUpdateSinceLastCopy: false
        }
      }
      const events = (byReview.get(review.reviewId) ?? [])
        .toSorted((left, right) => left.at.localeCompare(right.at))
      const latest = events.at(-1) ?? null
      const copiedCeiling = events.reduce((highest, event) => Math.max(highest, event.jobCaseVersion), 0)
      return {
        reviewId: review.reviewId,
        jobCaseId: review.jobCase!.id,
        jobCaseVersion: review.jobCase!.version,
        title,
        sourceType: review.sourceType,
        status: latest === null ? 'new' : 'copied',
        lastCopy: latest,
        hasUpdateSinceLastCopy: latest !== null && review.jobCase!.version > copiedCeiling
      }
    })
    .toSorted((left, right) =>
      statusRank[left.status] - statusRank[right.status] || right.reviewId.localeCompare(left.reviewId))
}

const forbiddenKeys: ReadonlySet<string> = new Set<string>(broadcastForbiddenFieldKeys)

function versionValue(version: JobCaseVersionDetail, key: JobCaseFieldKey): string | null {
  return version.fields.find((field) => field.key === key)?.value ?? null
}

/**
 * What changed between the version that was last copied and the version that
 * is live now, expressed the way a broadcast would have expressed it. Only the
 * template's switched-on field lines take part, so the notice can never reveal
 * a value the message itself withholds - a capped 単価 that moved inside its
 * cap simply produces no change at all.
 */
export function diffBroadcastFields(
  baseline: JobCaseVersionDetail,
  current: JobCaseVersionDetail,
  template: BroadcastTemplate
): { ja: BroadcastFieldChange[]; zh: BroadcastFieldChange[] } {
  const empty = '—'
  const ja: BroadcastFieldChange[] = []
  const zh: BroadcastFieldChange[] = []
  for (const line of template.lines) {
    if (line.kind !== 'field' || !line.on || forbiddenKeys.has(line.field)) continue
    const key = line.field as JobCaseFieldKey
    const before = publishedBroadcastFieldValue(key, versionValue(baseline, key), template, 'ja')
    const after = publishedBroadcastFieldValue(key, versionValue(current, key), template, 'ja')
    if ((before ?? '') === (after ?? '')) continue
    ja.push({ label: line.labelJa, before: before ?? empty, after: after ?? empty })
    zh.push({ label: line.labelZh, before: before ?? empty, after: after ?? empty })
  }
  return { ja, zh }
}
