// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'

describe.skipIf(!nativeSqliteAvailable)('LocalSettingsStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  it('saves the operator profile with optimistic revisions and survives reopen', () => {
    const { repository } = handle
    expect(repository.getLocalOperatorProfile()).toBeNull()
    const first = repository.saveLocalOperatorProfile({ displayName: '検証担当', roleLabel: 'SES営業', expectedRevision: null })
    expect(first).toMatchObject({ displayName: '検証担当', revision: 1, cloudEligible: false })
    expect(() => repository.saveLocalOperatorProfile({ displayName: '古い更新', roleLabel: '営業担当', expectedRevision: null })).toThrow(
      /更新されました/
    )
    const second = repository.saveLocalOperatorProfile({ displayName: '検証担当2', roleLabel: 'SES営業', expectedRevision: 1 })
    expect(second).toMatchObject({ operatorId: first.operatorId, revision: 2 })
    expect(handle.reopen().getLocalOperatorProfile()).toMatchObject({ displayName: '検証担当2', revision: 2 })
  })

  it('saves application preferences and rejects an unsupported locale or stale revision', () => {
    const { repository } = handle
    expect(repository.getLocalApplicationPreferences()).toBeNull()
    expect(() => repository.saveLocalApplicationPreferences({ locale: 'fr-FR' as never, expectedRevision: null })).toThrow()
    expect(repository.getLocalApplicationPreferences()).toBeNull()
    const saved = repository.saveLocalApplicationPreferences({ locale: 'zh-CN', expectedRevision: null })
    expect(saved).toMatchObject({ locale: 'zh-CN', revision: 1, configured: true, cloudEligible: false })
    expect(() => repository.saveLocalApplicationPreferences({ locale: 'ja-JP', expectedRevision: 5 })).toThrow(/更新されました/)
    expect(repository.saveLocalApplicationPreferences({ locale: 'ja-JP', expectedRevision: 1 })).toMatchObject({
      locale: 'ja-JP',
      revision: 2
    })
  })

  it('stores job case field aliases without empty lists and rejects an alias claimed by two fields', () => {
    const { repository } = handle
    expect(repository.getJobCaseFieldAliases()).toBeNull()
    const saved = repository.saveJobCaseFieldAliases({ aliases: { rate: ['単金', '金額'], start_date: [] }, expectedRevision: null })
    expect(saved.aliases).toEqual({ rate: ['単金', '金額'] })
    expect(saved.revision).toBe(1)
    expect(() => repository.saveJobCaseFieldAliases({ aliases: { rate: ['単金'], settlement: ['単 金'] }, expectedRevision: 1 })).toThrow()
    expect(() => repository.saveJobCaseFieldAliases({ aliases: { rate: ['単価'] }, expectedRevision: null })).toThrow(/更新されました/)
    expect(handle.reopen().getJobCaseFieldAliases()).toMatchObject({ aliases: { rate: ['単金', '金額'] }, revision: 1 })
  })
})
