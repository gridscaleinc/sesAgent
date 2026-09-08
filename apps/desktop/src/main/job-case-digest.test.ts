import { describe, expect, it } from 'vitest'
import { jobCaseFieldKeys, type JobCaseFieldKey, type JobCaseReviewSnapshot } from '@shared'
import { deriveNewCaseDigest } from './job-case-digest'

const completeValues: Partial<Record<JobCaseFieldKey, string>> = {
  title: 'Java 決済基盤',
  required_skills: 'Java、Spring Boot',
  rate: '65万円',
  location: '東京都港区',
  remote: '週3リモート',
  japanese_level: 'N2以上'
}

function review(
  overrides: Partial<JobCaseReviewSnapshot> & { reviewId: string },
  values: Partial<Record<JobCaseFieldKey, string>> = completeValues
): JobCaseReviewSnapshot {
  return {
    sourceId: '33333333-3333-4333-8333-333333333333',
    sourceType: 'gmail',
    providerMessageId: null,
    threadId: 'thread-1',
    fromDomain: 'partner.example.jp',
    messageDate: '2026-08-20T00:00:00.000Z',
    intakeAt: '2026-08-26T02:00:00.000Z',
    redactedSubject: '件名',
    redactedPreview: '本文',
    reviewRevision: 1,
    status: 'completed',
    privacyReviewed: true,
    fields: jobCaseFieldKeys.map((key) => ({
      key, label: key, originalValue: values[key] ?? null, value: values[key] ?? null,
      confidence: 1, status: values[key] ? 'confirmed' as const : 'missing' as const,
      sourceLabels: [], changed: false, changeReason: null
    })),
    warningCodes: [],
    completedAt: '2026-08-26T02:30:00.000Z',
    reviewerDisplayName: 'HR',
    jobCase: {
      id: '22222222-2222-4222-8222-222222222222', sourceReviewId: overrides.reviewId, version: 1,
      status: 'active', confirmedAt: '2026-08-26T02:30:00.000Z', confirmedBy: 'HR', containsDirectIdentifiers: false
    },
    lifecycle: 'active',
    cloudEligible: false,
    ...overrides
  }
}

/** 2026-08-26 11:00 JST. */
const now = new Date('2026-08-26T02:00:00.000Z')

describe('deriveNewCaseDigest', () => {
  it('cuts the day on the Asia/Tokyo boundary, not on UTC', () => {
    const digest = deriveNewCaseDigest({
      reviews: [
        // 2026-08-26 00:30 JST: still 8/25 in UTC, but today for the operator.
        review({ reviewId: 'a1111111-1111-4111-8111-111111111111', intakeAt: '2026-08-25T15:30:00.000Z' }),
        // 2026-08-25 23:30 JST: yesterday, although the UTC date is the same.
        review({ reviewId: 'b1111111-1111-4111-8111-111111111111', intakeAt: '2026-08-25T14:30:00.000Z' })
      ],
      seenReviewIds: [],
      now
    })
    expect(digest.groups.map((group) => [group.day, group.count])).toEqual([['today', 1], ['yesterday', 1]])
    expect(digest.newCasesToday).toBe(1)
  })

  it('prefers the local intake time over the source message date', () => {
    // A sync imports a mail written a week ago: it arrived today.
    const digest = deriveNewCaseDigest({
      reviews: [review({
        reviewId: 'c1111111-1111-4111-8111-111111111111',
        messageDate: '2026-08-19T01:00:00.000Z',
        intakeAt: '2026-08-26T01:00:00.000Z'
      })],
      seenReviewIds: [],
      now
    })
    expect(digest.groups[0]!.day).toBe('today')
    expect(digest.groups[0]!.entries[0]!.arrivedAt).toBe('2026-08-26T01:00:00.000Z')
  })

  it('counts unseen per group and in total, and drops the flag once marked', () => {
    const reviews = [
      review({ reviewId: 'd1111111-1111-4111-8111-111111111111', intakeAt: '2026-08-26T01:00:00.000Z' }),
      review({ reviewId: 'e1111111-1111-4111-8111-111111111111', intakeAt: '2026-08-26T00:30:00.000Z' }),
      review({ reviewId: 'f1111111-1111-4111-8111-111111111111', intakeAt: '2026-08-25T01:00:00.000Z' })
    ]
    const all = deriveNewCaseDigest({ reviews, seenReviewIds: [], now })
    expect(all.unseenCount).toBe(3)
    const partial = deriveNewCaseDigest({
      reviews, seenReviewIds: ['d1111111-1111-4111-8111-111111111111'], now
    })
    expect(partial.unseenCount).toBe(2)
    expect(partial.groups.find((group) => group.day === 'today')!.unseenCount).toBe(1)
    expect(partial.groups.find((group) => group.day === 'today')!.entries
      .find((entry) => entry.reviewId === 'd1111111-1111-4111-8111-111111111111')!.unseen).toBe(false)
  })

  it('marks a case 要補完 when a required field is empty and names the missing keys', () => {
    const digest = deriveNewCaseDigest({
      reviews: [review(
        { reviewId: 'a2222222-2222-4222-8222-222222222222' },
        { ...completeValues, rate: undefined, location: undefined }
      )],
      seenReviewIds: [],
      now
    })
    const entry = digest.groups[0]!.entries[0]!
    expect(entry.status).toBe('needs-completion')
    expect(entry.missingFieldKeys).toEqual(['rate', 'location'])
    expect(entry.highlights.map((highlight) => highlight.key)).toEqual(['required_skills', 'remote', 'japanese_level'])
  })

  it('treats an unconfirmed draft and a content warning as 要補完, but not a provenance warning', () => {
    const digest = deriveNewCaseDigest({
      reviews: [
        review({ reviewId: 'b2222222-2222-4222-8222-222222222222', status: 'awaiting-review', jobCase: null }),
        review({ reviewId: 'c2222222-2222-4222-8222-222222222222', warningCodes: ['AGE_LIMIT_REQUIRES_REVIEW'] }),
        review({ reviewId: 'd2222222-2222-4222-8222-222222222222', warningCodes: ['CHAT_PASTE_ONE_TIME_LOCAL_REDACTION'] })
      ],
      seenReviewIds: [],
      now
    })
    const byId = new Map(digest.groups[0]!.entries.map((entry) => [entry.reviewId, entry]))
    expect(byId.get('b2222222-2222-4222-8222-222222222222')!.status).toBe('needs-completion')
    expect(byId.get('b2222222-2222-4222-8222-222222222222')!.jobCaseId).toBeNull()
    expect(byId.get('c2222222-2222-4222-8222-222222222222')!.status).toBe('needs-completion')
    expect(byId.get('d2222222-2222-4222-8222-222222222222')!.status).toBe('ready')
  })

  it('looks back seven Tokyo days and ignores archived cases', () => {
    const digest = deriveNewCaseDigest({
      reviews: [
        review({ reviewId: 'e2222222-2222-4222-8222-222222222222', intakeAt: '2026-08-20T01:00:00.000Z' }),
        review({ reviewId: 'f2222222-2222-4222-8222-222222222222', intakeAt: '2026-08-19T01:00:00.000Z' }),
        review({ reviewId: 'a3333333-3333-4333-8333-333333333333', intakeAt: '2026-08-26T01:00:00.000Z', lifecycle: 'archived' })
      ],
      seenReviewIds: [],
      now
    })
    expect(digest.groups.map((group) => group.day)).toEqual(['earlier'])
    expect(digest.groups[0]!.entries.map((entry) => entry.reviewId)).toEqual(['e2222222-2222-4222-8222-222222222222'])
    expect(digest.newCasesToday).toBe(0)
  })
})
