// @vitest-environment node
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { currentSchemaVersion } from '../index'
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

  it('stores the AI model choice, keeps it across a language-only save and survives reopen', () => {
    const { repository } = handle
    const first = repository.saveLocalApplicationPreferences({
      locale: 'zh-CN',
      expectedRevision: null,
      aiModels: { checking: 'gpt-6-luna', writing: 'gpt-6.1-sol-pro' }
    })
    expect(first.aiModels).toEqual({ checking: 'gpt-6-luna', writing: 'gpt-6.1-sol-pro' })
    const localeOnly = repository.saveLocalApplicationPreferences({ locale: 'ja-JP', expectedRevision: 1 })
    expect(localeOnly).toMatchObject({ locale: 'ja-JP', revision: 2, aiModels: { checking: 'gpt-6-luna', writing: 'gpt-6.1-sol-pro' } })
    expect(() =>
      repository.saveLocalApplicationPreferences({
        locale: 'ja-JP',
        expectedRevision: 2,
        aiModels: { checking: 'https://evil.invalid', writing: 'gpt-6-sol' }
      })
    ).toThrow()
    expect(handle.reopen().getLocalApplicationPreferences()?.aiModels).toEqual({ checking: 'gpt-6-luna', writing: 'gpt-6.1-sol-pro' })
  })

  it('reads preferences saved before the model choice existed, and an unreadable stored choice, as no choice', () => {
    handle.repository.saveLocalApplicationPreferences({ locale: 'zh-CN', expectedRevision: null })
    expect(handle.repository.getLocalApplicationPreferences()).not.toHaveProperty('aiModels')
    handle.repository.close()
    const raw = new Database(handle.path)
    try {
      raw.pragma("cipher='sqlcipher'")
      raw.pragma('legacy=4')
      raw.key(handle.databaseKey)
      raw.prepare('UPDATE local_application_preferences SET ai_models = \'{"checking":1}\' WHERE singleton = 1').run()
    } finally {
      raw.close()
    }
    expect(handle.reopen().getLocalApplicationPreferences()).toMatchObject({ locale: 'zh-CN', revision: 1 })
    expect(handle.repository.getLocalApplicationPreferences()).not.toHaveProperty('aiModels')
  })

  it('upgrades a v64 database by adding the model choice column and keeps the saved language (schema v65 migration)', () => {
    handle.repository.saveLocalApplicationPreferences({ locale: 'zh-CN', expectedRevision: null })
    handle.repository.close()
    const raw = new Database(handle.path)
    try {
      raw.pragma("cipher='sqlcipher'")
      raw.pragma('legacy=4')
      raw.key(handle.databaseKey)
      raw.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE local_application_preferences DROP COLUMN ai_models;
        DELETE FROM schema_migrations WHERE version = 65;
        COMMIT;
      `)
    } finally {
      raw.close()
    }
    const upgraded = handle.reopen()
    expect(currentSchemaVersion).toBe(68)
    expect(upgraded.getSchemaVersion()).toBe(68)
    expect(upgraded.getLocalApplicationPreferences()).toMatchObject({ locale: 'zh-CN', revision: 1 })
    expect(upgraded.getLocalApplicationPreferences()).not.toHaveProperty('aiModels')
    expect(
      upgraded.saveLocalApplicationPreferences({
        locale: 'zh-CN',
        expectedRevision: 1,
        aiModels: { checking: 'gpt-5.6-luna', writing: 'gpt-6-sol' }
      }).aiModels
    ).toEqual({ checking: 'gpt-5.6-luna', writing: 'gpt-6-sol' })
  })

  it('stores the menu-bar choice beside the model choice, keeps both across a language-only save and survives reopen', () => {
    const { repository } = handle
    expect(repository.saveLocalApplicationPreferences({ locale: 'zh-CN', expectedRevision: null })).not.toHaveProperty('menuBar')
    const models = { checking: 'gpt-6-luna', writing: 'gpt-6-sol' }
    repository.saveLocalApplicationPreferences({ locale: 'zh-CN', expectedRevision: 1, aiModels: models })
    const saved = repository.saveLocalApplicationPreferences({
      locale: 'zh-CN',
      expectedRevision: 2,
      menuBar: { visible: false, showPersonNames: true }
    })
    expect(saved).toMatchObject({ revision: 3, aiModels: models, menuBar: { visible: false, showPersonNames: true } })
    expect(repository.saveLocalApplicationPreferences({ locale: 'ja-JP', expectedRevision: 3 }).menuBar).toEqual({
      visible: false,
      showPersonNames: true
    })
    expect(() =>
      repository.saveLocalApplicationPreferences({
        locale: 'ja-JP',
        expectedRevision: 4,
        menuBar: { visible: 'yes', showPersonNames: true } as never
      })
    ).toThrow()
    expect(handle.reopen().getLocalApplicationPreferences()).toMatchObject({ aiModels: models, menuBar: { visible: false } })
  })

  it('upgrades a v65 database by adding the menu-bar column and reads an unreadable stored choice as the defaults (schema v66)', () => {
    handle.repository.saveLocalApplicationPreferences({ locale: 'zh-CN', expectedRevision: null })
    handle.repository.close()
    const raw = new Database(handle.path)
    try {
      raw.pragma("cipher='sqlcipher'")
      raw.pragma('legacy=4')
      raw.key(handle.databaseKey)
      raw.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE local_application_preferences DROP COLUMN menu_bar;
        DELETE FROM schema_migrations WHERE version = 66;
        COMMIT;
      `)
    } finally {
      raw.close()
    }
    const upgraded = handle.reopen()
    expect(upgraded.getSchemaVersion()).toBe(68)
    expect(upgraded.getLocalApplicationPreferences()).toMatchObject({ locale: 'zh-CN', revision: 1 })
    expect(upgraded.getLocalApplicationPreferences()).not.toHaveProperty('menuBar')
    upgraded.close()
    const corrupt = new Database(handle.path)
    try {
      corrupt.pragma("cipher='sqlcipher'")
      corrupt.pragma('legacy=4')
      corrupt.key(handle.databaseKey)
      corrupt.prepare('UPDATE local_application_preferences SET menu_bar = \'{"visible":1}\' WHERE singleton = 1').run()
    } finally {
      corrupt.close()
    }
    expect(handle.reopen().getLocalApplicationPreferences()).not.toHaveProperty('menuBar')
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
