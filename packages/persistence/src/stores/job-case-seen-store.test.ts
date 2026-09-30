// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { saveManualJobCaseDraft } from './store-test-fixtures-jobcases'

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
})
