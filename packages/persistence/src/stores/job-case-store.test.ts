// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { confirmAllJobCaseFields, saveManualJobCaseDraft } from './store-test-fixtures-jobcases'

const contactName = '佐藤秘密担当'
const contactPhone = '080-8765-4321'
const body = `担当：${contactName}\n電話：${contactPhone}\n必須スキル：Python / AWS\n単価：90万円/月`

describe.skipIf(!nativeSqliteAvailable)('JobCaseStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  it('stores a redacted manual draft, confirms it and keeps it active across reopen', () => {
    const { repository } = handle
    const { saved, reviewId } = saveManualJobCaseDraft(repository, {
      subject: `${contactName}様 Python案件`,
      body,
      knownPersonNames: [contactName]
    })
    expect(saved).toBe(true)
    const review = repository.getJobCaseReview(reviewId)
    expect(review).toMatchObject({ status: 'awaiting-review', sourceType: 'manual' })
    expect(review?.redactedPreview).toContain('<PERSON_NAME_001>')
    expect(review?.redactedPreview).toContain('<PHONE_001>')
    expect(review?.redactedPreview).not.toContain(contactName)
    expect(review?.redactedPreview).not.toContain(contactPhone)
    expect(repository.listJobCaseReviews().map((item) => item.reviewId)).toContain(reviewId)
    expect(repository.listActiveJobCases()).toHaveLength(0)

    const confirmed = confirmAllJobCaseFields(repository, reviewId)
    expect(confirmed.status).toBe('completed')
    expect(confirmed.jobCase).toMatchObject({ version: 1, containsDirectIdentifiers: false })

    const reopened = handle.reopen()
    expect(reopened.listActiveJobCases()).toHaveLength(1)
    expect(reopened.getJobCaseReview(reviewId)?.status).toBe('completed')
    expect(reopened.getJobCaseHistory(reviewId)).toHaveLength(1)
  })

  it('does not keep the raw contact name or phone in the encrypted database file', () => {
    const { repository } = handle
    saveManualJobCaseDraft(repository, { subject: `${contactName}様 Python案件`, body, knownPersonNames: [contactName] })
    repository.checkpoint()
    repository.close()
    const bytes = readFileSync(handle.path)
    expect(bytes.includes(Buffer.from('SQLite format 3'))).toBe(false)
    expect(bytes.includes(Buffer.from(contactName))).toBe(false)
    expect(bytes.includes(Buffer.from(contactPhone))).toBe(false)
  })

  it('rejects the same business content a second time as a duplicate', () => {
    const { repository } = handle
    const first = saveManualJobCaseDraft(repository, { subject: 'Go案件', body: '必須スキル：Go / AWS\n単価：95万円/月' })
    expect(first.saved).toBe(true)
    expect(() => saveManualJobCaseDraft(repository, { subject: 'Go案件', body: '必須スキル：Go / AWS\n単価：95万円/月' })).toThrow(
      /同じ案件は登録済み/
    )
    expect(repository.listJobCaseReviews()).toHaveLength(1)
  })

  it('refuses a stale review revision, a nationality condition and a direct identifier in a field', () => {
    const { repository } = handle
    const { reviewId } = saveManualJobCaseDraft(repository, { subject: 'Java案件', body: '必須スキル：Java / SQL\n単価：80万円/月' })
    const review = repository.getJobCaseReview(reviewId)!
    const fields = review.fields.map((field) => ({ key: field.key, value: field.value, confirmed: true as const }))
    expect(() =>
      repository.confirmJobCaseReview({ reviewId, reviewRevision: review.reviewRevision + 1, privacyReviewed: true, fields }, 'u', '担当')
    ).toThrow(/changed/)
    expect(() => confirmAllJobCaseFields(repository, reviewId, { work_authorization: { value: '日本国籍のみ' } })).toThrow(/国籍/)
    expect(() => confirmAllJobCaseFields(repository, reviewId, { notes: { value: '連絡先 090-1111-2222' } })).toThrow(/直接識別子/)
    expect(repository.getJobCaseReview(reviewId)?.status).toBe('awaiting-review')
  })

  it('archives, restores and reopens a confirmed case with a new version', () => {
    const { repository } = handle
    const { reviewId } = saveManualJobCaseDraft(repository, { subject: 'AWS案件', body: '必須スキル：AWS / Terraform\n単価：85万円/月' })
    confirmAllJobCaseFields(repository, reviewId)
    expect(repository.setJobCaseLifecycle({ reviewId, state: 'archived', reason: '検証用アーカイブ' }, 'u').lifecycle).toBe('archived')
    expect(repository.listActiveJobCases()).toHaveLength(0)
    expect(() => repository.reopenJobCaseReview({ reviewId, reason: '条件を更新するため' }, 'u')).toThrow(/archived/)
    repository.setJobCaseLifecycle({ reviewId, state: 'active', reason: '検証後に復元' }, 'u')
    const reopened = repository.reopenJobCaseReview({ reviewId, reason: '条件を更新するため' }, 'u')
    expect(reopened.status).toBe('awaiting-review')
    expect(() => repository.reopenJobCaseReview({ reviewId, reason: '二重に開く' }, 'u')).toThrow(/already open/)
    const revised = confirmAllJobCaseFields(repository, reviewId, {}, new Date('2026-07-17T00:05:00.000Z'))
    expect(revised.jobCase?.version).toBe(2)
    expect(repository.getJobCaseHistory(reviewId).map((version) => version.status)).toContain('superseded')
  })

  it('deletes a case only with the current preview hash', () => {
    const { repository } = handle
    const { reviewId } = saveManualJobCaseDraft(repository, { subject: '削除案件', body: '必須スキル：PHP\n単価：60万円/月' })
    const preview = repository.previewJobCaseDeletion(reviewId)
    expect(preview.counts.sourceRecords).toBe(1)
    expect(() => repository.deleteJobCaseDatabaseData({ reviewId, confirmationHash: 'a'.repeat(64), confirmationText: '削除' })).toThrow(
      /preview changed/
    )
    expect(repository.getJobCaseReview(reviewId)).not.toBeNull()
    repository.deleteJobCaseDatabaseData({ reviewId, confirmationHash: preview.confirmationHash, confirmationText: '削除' })
    expect(repository.getJobCaseReview(reviewId)).toBeNull()
    expect(repository.listJobCaseReviews()).toHaveLength(0)
  })
})
