// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DuplicateCandidateError } from '../intake-deduplication'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { seedImportedPerson } from './store-test-fixtures-business'

describe.skipIf(!nativeSqliteAvailable)('该人员已入库 via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  const otherResume = '案件名: 物流システム刷新 / 2024年4月〜2026年3月 / Go / GCP / PM / 経験 9年 / 希望単価 95万円'

  const withDetails = (details: string, resume = otherResume) => `${details} | ${resume}`

  it('gives up importing the same person (same name and mobile number), keeping nothing of it', () => {
    const { repository } = handle
    const existing = seedImportedPerson(repository, {
      privateName: '山田太郎',
      text: withDetails('電話番号: 090-1234-5678', '経験 7年 / Java')
    })
    expect(repository.getCandidateReview(existing.documentId)?.localIdentity?.phone).toMatch(/1234/u)
    let refused: unknown
    try {
      seedImportedPerson(repository, { privateName: '山田太郎', text: withDetails('電話番号: 09012345678') })
    } catch (error) {
      refused = error
    }
    expect(refused).toBeInstanceOf(DuplicateCandidateError)
    expect((refused as DuplicateCandidateError).documentId).toBe(existing.documentId)
    expect((refused as Error).message).toMatch(/该人员已入库（山田太郎）/u)
    expect(repository.listCandidateReviews().map((review) => review.documentId)).toEqual([existing.documentId])
  })

  it('treats the same name plus the same address or age as the same person, and the same name alone as someone new', () => {
    const { repository } = handle
    seedImportedPerson(repository, {
      privateName: '山田太郎',
      text: withDetails('住所: 東京都港区芝1-2-3 | 生年月日: 1990年4月1日', '経験 7年 / Java')
    })
    expect(() => seedImportedPerson(repository, { privateName: '山田太郎', text: withDetails('住所: 東京都港区 芝1-2-3') })).toThrow(
      DuplicateCandidateError
    )
    expect(() =>
      seedImportedPerson(repository, { privateName: '山田太郎', text: withDetails('生年月日: 1990/04/01', 'Python / AWS / 経験 5年') })
    ).toThrow(DuplicateCandidateError)
    // Same name, nothing else in common: a different person who happens to share it.
    const namesake = seedImportedPerson(repository, {
      privateName: '山田太郎',
      text: withDetails('住所: 大阪府大阪市北区 | 生年月日: 1975年1月1日 | 電話番号: 080-0000-1111', 'COBOL / 経験 20年')
    })
    expect(repository.getCandidateReview(namesake.documentId)).not.toBeNull()
    expect(repository.listCandidateReviews()).toHaveLength(2)
  })

  it('brings a person saved only for a case assessment into the library when imported for real', () => {
    const { repository } = handle
    const existing = seedImportedPerson(repository, {
      privateName: '山田太郎',
      inTalentLibrary: false,
      text: withDetails('電話番号: 090-1234-5678', '経験 7年 / Java')
    })
    expect(repository.getCandidateReview(existing.documentId)?.inTalentLibrary).toBe(false)
    expect(() => seedImportedPerson(repository, { privateName: '山田太郎', text: withDetails('電話番号: 090-1234-5678') })).toThrow(
      DuplicateCandidateError
    )
    expect(repository.getCandidateReview(existing.documentId)?.inTalentLibrary).toBe(true)
  })

  it('finds a person by the bytes they were imported from, never by a file left staged', () => {
    const { repository } = handle
    const existing = seedImportedPerson(repository, { privateName: '山田太郎' })
    const sha256 = repository.getStagedFileRecords([existing.documentId])[0]!.sha256
    expect(repository.findCandidateByStagedSha256(sha256)?.documentId).toBe(existing.documentId)
    expect(repository.findCandidateByStagedSha256('0'.repeat(64))).toBeNull()
  })
})
