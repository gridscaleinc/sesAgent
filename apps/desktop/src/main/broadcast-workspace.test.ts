import { describe, expect, it } from 'vitest'
import {
  builtInBroadcastTemplate,
  jobCaseFieldKeys,
  type CaseBroadcastCopy,
  type CaseBroadcastRecord,
  type JobCaseReviewSnapshot,
  type JobCaseVersionDetail
} from '@shared'
import { deriveBroadcastQueue, diffBroadcastFields, lastCopiedJobCaseVersion } from './broadcast-workspace'

const reviewId = '11111111-1111-4111-8111-111111111111'
const jobCaseId = '22222222-2222-4222-8222-222222222222'

function review(overrides: Partial<JobCaseReviewSnapshot> = {}, values: Record<string, string> = {}): JobCaseReviewSnapshot {
  return {
    reviewId,
    sourceId: '33333333-3333-4333-8333-333333333333',
    sourceType: 'gmail',
    providerMessageId: null,
    threadId: 'thread-1',
    fromDomain: 'partner.example.jp',
    messageDate: '2026-08-25T00:00:00.000Z',
    redactedSubject: 'Java 案件',
    redactedPreview: 'Java',
    reviewRevision: 1,
    status: 'completed',
    privacyReviewed: true,
    fields: jobCaseFieldKeys.map((key) => ({
      key, label: key, originalValue: values[key] ?? null, value: values[key] ?? null,
      confidence: 1, status: values[key] ? 'confirmed' as const : 'missing' as const,
      sourceLabels: [], changed: false, changeReason: null
    })),
    warningCodes: [],
    completedAt: '2026-08-25T01:00:00.000Z',
    reviewerDisplayName: 'HR',
    jobCase: { id: jobCaseId, sourceReviewId: reviewId, version: 1, status: 'active', confirmedAt: '2026-08-25T01:00:00.000Z', confirmedBy: 'HR', containsDirectIdentifiers: false },
    lifecycle: 'active',
    cloudEligible: false,
    ...overrides
  }
}

function copyRow(overrides: Partial<CaseBroadcastCopy> = {}): CaseBroadcastCopy {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    reviewId,
    jobCaseId,
    jobCaseVersion: 1,
    templateId: builtInBroadcastTemplate().id,
    templateRevision: 1,
    lang: 'zh',
    kind: 'new',
    text: '【案件】Java 案件',
    textSha256: 'a'.repeat(64),
    actorId: 'operator-1',
    createdAt: '2026-08-25T02:00:00.000Z',
    ...overrides
  }
}

/** A row written before v43, when the app still claimed to know about sends. */
function legacyRow(overrides: Partial<CaseBroadcastRecord> = {}): CaseBroadcastRecord {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    reviewId,
    jobCaseId,
    jobCaseVersion: 1,
    groupId: '44444444-4444-4444-8444-444444444444',
    groupName: '関東Javaグループ',
    templateId: builtInBroadcastTemplate().id,
    templateRevision: 1,
    lang: 'ja',
    kind: 'new',
    action: 'marked_sent',
    text: '【案件】Java 案件',
    textSha256: 'b'.repeat(64),
    actorId: 'operator-1',
    createdAt: '2026-08-24T02:00:00.000Z',
    ...overrides
  }
}

describe('deriveBroadcastQueue', () => {
  const cases = { title: 'Java 案件', required_skills: 'Java', location: '都内', rate: '～65万円' }
  const queueOf = (input: Partial<Parameters<typeof deriveBroadcastQueue>[0]>) =>
    deriveBroadcastQueue({ reviews: [review({}, cases)], ledger: [], copies: [], ...input })

  it('reads a never-copied confirmed case as new', () => {
    const [item] = queueOf({})
    expect(item).toMatchObject({ status: 'new', lastCopy: null, hasUpdateSinceLastCopy: false, jobCaseVersion: 1 })
  })

  it('reads a copied case as copied and remembers when and in which language', () => {
    const [item] = queueOf({ copies: [copyRow()] })
    expect(item).toMatchObject({
      status: 'copied',
      lastCopy: { at: '2026-08-25T02:00:00.000Z', lang: 'zh', jobCaseVersion: 1 },
      hasUpdateSinceLastCopy: false
    })
  })

  it('counts a pre-v43 ledger row as a copy, whichever action it claimed', () => {
    expect(queueOf({ ledger: [legacyRow()] })[0]).toMatchObject({
      status: 'copied', lastCopy: { at: '2026-08-24T02:00:00.000Z', lang: 'ja', jobCaseVersion: 1 }
    })
    expect(queueOf({ ledger: [legacyRow({ action: 'copied' })] })[0]).toMatchObject({ status: 'copied' })
  })

  it('takes the newest event whether it came from the ledger or from a copy', () => {
    const [item] = queueOf({
      ledger: [legacyRow()],
      copies: [copyRow({ createdAt: '2026-08-26T02:00:00.000Z' })]
    })
    expect(item.lastCopy).toEqual({ at: '2026-08-26T02:00:00.000Z', lang: 'zh', jobCaseVersion: 1 })
  })

  it('flags a case revised after it was copied', () => {
    const revised = review({
      jobCase: { id: jobCaseId, sourceReviewId: reviewId, version: 2, status: 'active', confirmedAt: '2026-08-26T00:00:00.000Z', confirmedBy: 'HR', containsDirectIdentifiers: false }
    }, cases)
    expect(queueOf({ reviews: [revised], copies: [copyRow({ jobCaseVersion: 1 })] })[0])
      .toMatchObject({ status: 'copied', hasUpdateSinceLastCopy: true, jobCaseVersion: 2 })
    // A legacy row is a baseline too, so an old device does not lose the badge.
    expect(queueOf({ reviews: [revised], ledger: [legacyRow({ jobCaseVersion: 1 })] })[0])
      .toMatchObject({ hasUpdateSinceLastCopy: true })
  })

  it('lists an unconfirmed case as needing attention', () => {
    const [item] = queueOf({ reviews: [review({ status: 'awaiting-review', jobCase: null }, cases)] })
    expect(item).toMatchObject({ status: 'attention', jobCaseId: null, lastCopy: null })
  })

  it('leaves an archived case out of the queue entirely', () => {
    expect(queueOf({ reviews: [review({ lifecycle: 'archived' }, cases)] })).toEqual([])
  })

  it('puts what still needs doing before what is finished', () => {
    const other = '77777777-7777-4777-8777-777777777777'
    const queue = queueOf({
      reviews: [review({}, cases), review({ reviewId: other }, cases)],
      copies: [copyRow()]
    })
    expect(queue.map((item) => item.status)).toEqual(['new', 'copied'])
    expect(queue[0].reviewId).toBe(other)
  })
})

describe('update notice diff', () => {
  const template = builtInBroadcastTemplate()
  function version(versionNumber: number, values: Record<string, string>): JobCaseVersionDetail {
    return {
      id: jobCaseId,
      sourceReviewId: reviewId,
      sourceId: 'source-1',
      sourceType: 'gmail',
      version: versionNumber,
      reviewRevision: versionNumber,
      status: 'active',
      fields: jobCaseFieldKeys.map((key) => ({ key, label: key, value: values[key] ?? null, sourceLabels: [] })),
      confirmedAt: '2026-08-25T00:00:00.000Z',
      confirmedBy: 'HR',
      containsDirectIdentifiers: false
    }
  }

  it('reads the newest version ever copied, from either source', () => {
    expect(lastCopiedJobCaseVersion([], [])).toBeNull()
    expect(lastCopiedJobCaseVersion([], [copyRow({ jobCaseVersion: 2 })])).toBe(2)
    expect(lastCopiedJobCaseVersion(
      [legacyRow({ jobCaseVersion: 3 })],
      [copyRow({ jobCaseVersion: 1 })]
    )).toBe(3)
  })

  it('lists only changed lines, in both label languages', () => {
    const changes = diffBroadcastFields(
      version(1, { rate: '60万円', start_date: '9月' }),
      version(2, { rate: '65万円', start_date: '9月', headcount: '2名' }),
      template
    )
    expect(changes.ja).toEqual([
      { label: '単価', before: '～60万円', after: '～65万円' },
      { label: '人数', before: '—', after: '2名' }
    ])
    expect(changes.zh.map((change) => change.label)).toEqual(['单价', '人数'])
  })

  it('never leaks a value the message itself withholds', () => {
    const negotiable = { ...template, ratePublic: 'negotiable' as const }
    // Under 応相談 the published rate never moves, so a rate rise is not a change.
    expect(diffBroadcastFields(version(1, { rate: '60万円' }), version(2, { rate: '80万円' }), negotiable).ja).toEqual([])
    // The chain is not a template line, so it can never appear in a notice.
    const changes = diffBroadcastFields(
      version(1, { contract_chain: '弊社→元請' }),
      version(2, { contract_chain: '弊社→元請→エンド' }),
      template
    )
    expect(changes.ja).toEqual([])
  })
})
