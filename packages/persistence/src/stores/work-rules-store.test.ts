// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CasePersonAssessment } from '@shared'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { seedConfirmedCase, seedImportedPerson } from './store-test-fixtures-business'

const ruleInput = {
  expectedRevision: 0,
  enabled: true,
  text: 'Java案件はAWS経験を優先',
  scope: { kind: 'global' as const },
  clauses: [
    {
      kind: 'preferred' as const,
      field: 'required_skills' as const,
      text: 'AWS経験',
      sourceQuote: 'Java案件はAWS経験を優先',
      caseKeywords: ['Java']
    }
  ],
  modelKey: 'test-model',
  updatedBy: 'HR test'
}

describe.skipIf(!nativeSqliteAvailable)('WorkRulesStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  it('versions rules, rejects stale revisions and restores an earlier revision as a new one', () => {
    const { repository } = handle
    expect(repository.listWorkRules()).toEqual({ revision: 0, rules: [] })
    const first = repository.saveWorkRule(ruleInput)
    expect(first).toMatchObject({ revision: 1, enabled: true, text: ruleInput.text })
    expect(() => repository.saveWorkRule({ ...ruleInput, id: first.id, expectedRevision: 0 })).toThrow(/规则已更新|ルールが更新/)
    expect(() => repository.saveWorkRule({ ...ruleInput, id: randomUUID(), expectedRevision: 0 })).toThrow(/规则已更新|ルールが更新/)

    const stopped = repository.changeWorkRule({ id: first.id, expectedRevision: 1, enabled: false }, 'HR test')
    expect(stopped).toMatchObject({ revision: 2, enabled: false, updatedBy: 'HR test' })
    expect(() => repository.changeWorkRule({ id: first.id, expectedRevision: 1, enabled: true }, 'HR test')).toThrow(/更新/)
    const restored = repository.changeWorkRule({ id: first.id, expectedRevision: 2, restoreRevision: 1 }, 'HR test')
    expect(restored).toMatchObject({ revision: 3, enabled: true })
    expect(() => repository.changeWorkRule({ id: first.id, expectedRevision: 3, restoreRevision: 9 }, 'HR test')).toThrow(
      /版本不存在|見つかりません/
    )

    const reopened = handle.reopen()
    expect(reopened.getWorkRuleHistory(first.id).map((rule) => rule.revision)).toEqual([3, 2, 1])
    expect(reopened.listWorkRules()).toMatchObject({ revision: 3, rules: [expect.objectContaining({ id: first.id, revision: 3 })] })
  })

  it('stores assessments and feedback, and keeps only the newest question draft active per person and case', () => {
    const { repository } = handle
    const person = seedImportedPerson(repository)
    const job = seedConfirmedCase(repository)
    const jobCaseId = job.jobCase!.id
    const assessment: CasePersonAssessment = {
      id: randomUUID(),
      documentId: person.documentId,
      jobCaseId,
      jobCaseVersion: job.jobCase!.version,
      profileVersion: person.profile!.version,
      assessedAt: new Date().toISOString(),
      rulesRevision: 0,
      appliedRules: [],
      result: {
        documentId: person.documentId,
        profileVersion: person.profile!.version,
        score: 80,
        matched: ['Java'],
        missing: [],
        hardFilters: []
      },
      cloud: { status: 'unavailable', reviewedCount: 0, modelName: null }
    }
    repository.saveCasePersonAssessment(assessment)
    expect(repository.listCasePersonAssessments(person.documentId, jobCaseId).map((row) => row.id)).toEqual([assessment.id])
    expect(repository.listCaseAssessments(jobCaseId).map((row) => row.id)).toEqual([assessment.id])

    repository.saveAssessmentFeedback(
      { assessmentId: assessment.id, decision: 'unsuitable', reason: 'availability', note: '今回は開始時期が合わない' },
      'HR test'
    )
    expect(() =>
      repository.saveAssessmentFeedback(
        { assessmentId: randomUUID(), decision: 'unsuitable', reason: 'availability', note: 'x' },
        'HR test'
      )
    ).toThrow(/评估记录不存在|評価が見つかりません/)

    const draft = (createdAt: string) => ({
      id: randomUUID(),
      documentId: person.documentId,
      jobCaseId,
      jobCaseVersion: job.jobCase!.version,
      profileVersion: person.profile!.version,
      rulesRevision: 0,
      experienceRunId: null,
      createdAt,
      supersededAt: null,
      questions: [{ id: randomUUID(), text: '担当範囲を説明してください。', source: 'match' as const, sourceLabel: 'Java', selected: true }]
    })
    const older = draft(new Date(Date.now() - 1000).toISOString())
    const newer = draft(new Date().toISOString())
    repository.saveCaseQuestionDraft(older)
    repository.saveCaseQuestionDraft(newer)
    expect(handle.reopen().getCaseQuestionDraft(person.documentId, jobCaseId)?.id).toBe(newer.id)
    expect(handle.repository.getCaseQuestionDraft(randomUUID(), jobCaseId)).toBeNull()
  })
})
