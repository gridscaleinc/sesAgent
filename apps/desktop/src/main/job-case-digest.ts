import type {
  JobCaseFieldKey,
  JobCaseReviewSnapshot,
  NewJobCaseDigest,
  NewJobCaseDigestDay,
  NewJobCaseDigestEntry
} from '@shared'

/** Every date in the workbench is read in the operator's business day. */
const businessTimeZone = 'Asia/Tokyo'
const digestLookbackDays = 7

/** Shown on every row, in this order; a field without a value is skipped. */
export const digestHighlightFieldKeys = [
  'required_skills', 'rate', 'location', 'remote', 'japanese_level'
] as const satisfies readonly JobCaseFieldKey[]

/** Without these a case cannot be broadcast or matched, so it is 要補完. */
export const digestRequiredFieldKeys = [
  'title', 'required_skills', 'rate', 'location'
] as const satisfies readonly JobCaseFieldKey[]

/**
 * Warnings that mean business content is still missing or unsafe to trust.
 * The remaining codes record provenance (local redaction, EML parsing, WeChat
 * capture) and are attached to every case of that source, so treating them as
 * 要補完 would mark the whole inbox incomplete.
 */
const digestCompletionWarningCodes = new Set([
  'REQUIRED_SKILLS_MISSING',
  'AGE_LIMIT_REQUIRES_REVIEW',
  'NATIONALITY_REQUIREMENT_BLOCKED_USE_WORK_AUTHORIZATION'
])

const tokyoDayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: businessTimeZone, year: 'numeric', month: '2-digit', day: '2-digit'
})

/** The Asia/Tokyo calendar day of an instant, as YYYY-MM-DD. */
export function tokyoDayKey(value: Date | string): string {
  return tokyoDayFormat.format(typeof value === 'string' ? new Date(value) : value)
}

function daysBetweenTokyoDays(day: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000)
}

/**
 * When the review reached this device. messageDate is the source message's own
 * time: a Gmail sync routinely imports mail that is days old, and a pasted
 * chat message carries whatever date the sender wrote. Only intakeAt answers
 * "what arrived today", so messageDate is the fallback for rows a caller built
 * without it, never the primary.
 */
function arrivalOf(review: JobCaseReviewSnapshot): string {
  return review.intakeAt ?? review.messageDate
}

function fieldValue(review: JobCaseReviewSnapshot, key: JobCaseFieldKey): string | null {
  const value = review.fields.find((field) => field.key === key)?.value?.trim()
  return value ? value : null
}

function entryFrom(review: JobCaseReviewSnapshot, seen: ReadonlySet<string>): NewJobCaseDigestEntry {
  const missingFieldKeys = digestRequiredFieldKeys.filter((key) => !fieldValue(review, key))
  const blockingWarning = review.warningCodes.some((code) => digestCompletionWarningCodes.has(code))
  const confirmed = review.status === 'completed' && review.jobCase?.status === 'active'
  return {
    reviewId: review.reviewId,
    jobCaseId: confirmed ? review.jobCase!.id : null,
    title: fieldValue(review, 'title') ?? review.redactedSubject,
    sourceType: review.sourceType,
    arrivedAt: arrivalOf(review),
    unseen: !seen.has(review.reviewId),
    status: confirmed && !blockingWarning && missingFieldKeys.length === 0 ? 'ready' : 'needs-completion',
    missingFieldKeys,
    highlights: digestHighlightFieldKeys.flatMap((key) => {
      const value = fieldValue(review, key)
      return value ? [{ key: key as JobCaseFieldKey, value }] : []
    })
  }
}

/**
 * 今日新着案件 from one source of truth: the live reviews plus the seen flags.
 * Archived cases are not arrivals, and anything older than the lookback window
 * is not news, so both are dropped before grouping.
 */
export function deriveNewCaseDigest(input: {
  reviews: ReadonlyArray<JobCaseReviewSnapshot>
  seenReviewIds: ReadonlyArray<string>
  now: Date
}): NewJobCaseDigest {
  const seen = new Set(input.seenReviewIds)
  const today = tokyoDayKey(input.now)
  const buckets = new Map<NewJobCaseDigestDay, NewJobCaseDigestEntry[]>([
    ['today', []], ['yesterday', []], ['earlier', []]
  ])
  for (const review of input.reviews) {
    if (review.lifecycle !== 'active') continue
    const age = daysBetweenTokyoDays(tokyoDayKey(arrivalOf(review)), today)
    if (age < 0 || age >= digestLookbackDays) continue
    buckets.get(age === 0 ? 'today' : age === 1 ? 'yesterday' : 'earlier')!.push(entryFrom(review, seen))
  }
  const groups = [...buckets].flatMap(([day, entries]) => entries.length === 0 ? [] : [{
    day,
    count: entries.length,
    unseenCount: entries.filter((entry) => entry.unseen).length,
    entries: entries.sort((left, right) => right.arrivedAt.localeCompare(left.arrivedAt))
  }])
  return {
    groups,
    newCasesToday: buckets.get('today')!.length,
    unseenCount: groups.reduce((total, group) => total + group.unseenCount, 0)
  }
}
