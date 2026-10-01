// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { confirmAllJobCaseFields, saveManualJobCaseDraft } from './store-test-fixtures-jobcases'

describe.skipIf(!nativeSqliteAvailable)('JobCaseSeenStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  it('records a seen review once (upsert) and keeps it across reopen', () => {
    const { repository } = handle
    const { reviewId } = saveManualJobCaseDraft(repository, { subject: 'Java案件', body: '必須スキル：Java\n単価：70万円/月' })
    expect(repository.listSeenJobCaseReviewIds()).toEqual([])
    repository.markJobCaseReviewSeen(reviewId, '2026-07-17T01:00:00.000Z')
    repository.markJobCaseReviewSeen(reviewId, '2026-07-17T02:00:00.000Z')
    expect(repository.listSeenJobCaseReviewIds()).toEqual([reviewId])
    expect(handle.reopen().listSeenJobCaseReviewIds()).toEqual([reviewId])
  })

  it('rejects an unknown review id through the foreign key', () => {
    expect(() => handle.repository.markJobCaseReviewSeen('00000000-0000-4000-8000-000000000000', '2026-07-17T01:00:00.000Z')).toThrow(
      /FOREIGN KEY/
    )
    expect(handle.repository.listSeenJobCaseReviewIds()).toEqual([])
  })

  it('drops the seen marker when the case is deleted', () => {
    const { repository } = handle
    const { reviewId } = saveManualJobCaseDraft(repository, { subject: 'Go案件', body: '必須スキル：Go\n単価：75万円/月' })
    repository.markJobCaseReviewSeen(reviewId, '2026-07-17T01:00:00.000Z')
    const preview = repository.previewJobCaseDeletion(reviewId)
    repository.deleteJobCaseDatabaseData({ reviewId, confirmationHash: preview.confirmationHash, confirmationText: '削除' })
    expect(repository.listSeenJobCaseReviewIds()).toEqual([])
  })

  it('reads a case once for every screen: the sidebar count and the HR list agree whichever marks it', () => {
    const { repository } = handle
    const first = saveManualJobCaseDraft(repository, { subject: 'Rust案件', body: '必須スキル：Rust\n単価：80万円/月' }).reviewId
    const second = saveManualJobCaseDraft(repository, { subject: 'PHP案件', body: '必須スキル：PHP\n単価：60万円/月' }).reviewId
    confirmAllJobCaseFields(repository, first)
    confirmAllJobCaseFields(repository, second)
    const entry = (reviewId: string) => repository.getBusinessFeed().find((item) => item.kind === 'case' && item.objectId === reviewId)!
    expect(entry(first).unseen).toBe(true)
    // Opened from the sidebar's new cases: the HR list no longer shows it unread.
    repository.markJobCaseReviewSeen(first, '2026-07-17T01:00:00.000Z')
    expect(entry(first).unseen).toBe(false)
    // Read in the HR list: the sidebar count no longer counts it.
    repository.markBusinessFeed({ kind: 'case', objectId: second, revision: entry(second).revision, action: 'seen' })
    expect(repository.listSeenJobCaseReviewIds().sort()).toEqual([first, second].sort())
  })
})
