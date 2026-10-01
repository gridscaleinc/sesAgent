// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { createConfirmedManualJobCase } from './store-test-fixtures-mail'

const shortTemplate = {
  name: '短文',
  ratePublic: 'negotiable' as const,
  headerJa: '【案件】{{title}}',
  headerZh: '【案件】{{title}}',
  footerJa: '',
  footerZh: '',
  lines: [{ kind: 'field' as const, field: 'required_skills' as const, labelJa: '必須', labelZh: '必须', on: true }]
}

describe.skipIf(!nativeSqliteAvailable)('BroadcastStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  it('returns the built-in template until one is saved, and keeps it when the first template is added', () => {
    const { repository } = handle
    const defaults = repository.listBroadcastTemplates()
    expect(defaults).toHaveLength(1)
    expect(defaults[0]?.name).toBe('標準')
    const builtInId = defaults[0]!.id

    const saved = repository.createBroadcastTemplate(shortTemplate)
    expect(saved.map((template) => template.name).sort()).toEqual(['標準', '短文'].sort())
    // Written at the same moment as the copy, the built-in stays first: it remains the default.
    expect(saved[0]?.id).toBe(builtInId)
    expect(repository.createBroadcastTemplate({ ...shortTemplate, name: '短文2' })[0]?.id).toBe(builtInId)
    const created = saved.find((template) => template.name === '短文')!
    expect(created.revision).toBe(1)
    expect(repository.getBroadcastTemplate(builtInId)?.name).toBe('標準')

    const updated = repository
      .updateBroadcastTemplate({ ...shortTemplate, id: created.id, name: '短文v2' })
      .find((template) => template.id === created.id)
    expect(updated).toMatchObject({ name: '短文v2', revision: 2, createdAt: created.createdAt })
    expect(handle.reopen().getBroadcastTemplate(created.id)).toMatchObject({ name: '短文v2', revision: 2 })
  })

  it('rejects templates that expose forbidden commercial fields and never deletes the last template', () => {
    const { repository } = handle
    for (const field of ['contract_chain', 'payment_terms']) {
      expect(() =>
        repository.createBroadcastTemplate({
          ...shortTemplate,
          lines: [{ kind: 'field', field: field as never, labelJa: 'x', labelZh: 'x', on: true }]
        })
      ).toThrow()
    }
    expect(() => repository.createBroadcastTemplate({ ...shortTemplate, name: '   ' })).toThrow()
    // Built-in only: nothing stored, so the delete is refused.
    const builtInId = repository.listBroadcastTemplates()[0]!.id
    expect(() => repository.deleteBroadcastTemplate({ id: builtInId })).toThrow(/最低1件/)

    const created = repository.createBroadcastTemplate(shortTemplate).find((template) => template.name === '短文')!
    expect(repository.deleteBroadcastTemplate({ id: created.id }).map((template) => template.id)).toEqual([builtInId])
    expect(() => repository.deleteBroadcastTemplate({ id: builtInId })).toThrow(/最低1件/)
    expect(() => repository.deleteBroadcastTemplate({ id: 'not-a-uuid' })).toThrow()
  })

  it('appends copies of a confirmed case to an append-only log that survives reopen and is newest first', () => {
    const { repository } = handle
    const { reviewId, jobCase } = createConfirmedManualJobCase(repository)
    const template = repository.listBroadcastTemplates()[0]!
    const base = {
      reviewId,
      jobCaseId: jobCase.id,
      jobCaseVersion: jobCase.version,
      templateId: template.id,
      templateRevision: template.revision,
      actorId: 'operator-1'
    }
    const first = repository.appendCaseBroadcastCopy(
      { ...base, lang: 'ja', kind: 'new', text: '【案件】Python案件' },
      new Date('2026-07-17T01:00:00.000Z')
    )
    const second = repository.appendCaseBroadcastCopy(
      { ...base, lang: 'zh', kind: 'update', text: '【案件】Python案件 更新' },
      new Date('2026-07-17T02:00:00.000Z')
    )
    expect(first.textSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(first.id).not.toBe(second.id)

    const reopened = handle.reopen()
    expect(reopened.listCaseBroadcastCopies(reviewId).map((copy) => [copy.lang, copy.kind, copy.text])).toEqual([
      ['zh', 'update', '【案件】Python案件 更新'],
      ['ja', 'new', '【案件】Python案件']
    ])
    expect(reopened.listAllCaseBroadcastCopies()).toHaveLength(2)
    expect(reopened.listCaseBroadcastCopies('ffffffff-ffff-4fff-8fff-ffffffffffff')).toEqual([])
    // Legacy ledger is read-only and nothing writes to it.
    expect(reopened.listCaseBroadcasts(reviewId)).toEqual([])
    for (const method of ['updateCaseBroadcastCopy', 'deleteCaseBroadcastCopy', 'removeCaseBroadcastCopy']) {
      expect(method in reopened).toBe(false)
    }
  })

  it('refuses a copy for a case review that does not exist, and rejects invalid language', () => {
    const { repository } = handle
    const { reviewId, jobCase } = createConfirmedManualJobCase(repository)
    const template = repository.listBroadcastTemplates()[0]!
    const entry = {
      reviewId,
      jobCaseId: jobCase.id,
      jobCaseVersion: jobCase.version,
      templateId: template.id,
      templateRevision: template.revision,
      lang: 'ja' as const,
      kind: 'new' as const,
      text: 'x',
      actorId: 'a'
    }
    expect(() => repository.appendCaseBroadcastCopy({ ...entry, reviewId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })).toThrow(/FOREIGN KEY/)
    expect(() => repository.appendCaseBroadcastCopy({ ...entry, lang: 'en' as never })).toThrow(/CHECK/)
    expect(() => repository.appendCaseBroadcastCopy({ ...entry, jobCaseVersion: 0 })).toThrow(/CHECK/)
    expect(repository.listAllCaseBroadcastCopies()).toEqual([])
  })

  it('keeps only the latest AI case introduction per language and style, and deletes it with the case', () => {
    const { repository } = handle
    const { reviewId, jobCase } = createConfirmedManualJobCase(repository)
    const base = { reviewId, jobCaseVersion: jobCase!.version, style: 'standard' as const }
    repository.saveCaseIntroductionDrafts({
      ...base,
      request: '長期',
      drafts: [
        { lang: 'ja', text: '一回目', experienceRunId: null },
        { lang: 'zh', text: '第一次', experienceRunId: null }
      ]
    })
    repository.saveCaseIntroductionDrafts({ ...base, request: null, drafts: [{ lang: 'ja', text: '二回目', experienceRunId: 'run-2' }] })
    const stored = handle.reopen().listCaseIntroductionDrafts(reviewId)
    expect(stored.map((draft) => [draft.lang, draft.style, draft.text, draft.request])).toEqual([
      ['ja', 'standard', '二回目', null],
      ['zh', 'standard', '第一次', '長期']
    ])
    const reopened = handle.repository
    const preview = reopened.previewJobCaseDeletion(reviewId)
    reopened.deleteJobCaseDatabaseData({ reviewId, confirmationHash: preview.confirmationHash, confirmationText: '削除' })
    expect(reopened.listCaseIntroductionDrafts(reviewId)).toEqual([])
  })
})
