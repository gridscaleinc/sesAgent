vi.mock('./app-defaults', () => ({ effectiveApplicationPreferences: () => ({ locale: 'zh-CN' }) }))
import { describe, expect, it, vi } from 'vitest'
import type { CandidateProfile } from '@resume'
import type { ConfirmedJobCase } from '@job-cases'
import { loadAgentChatModelCatalog } from '@agent'
import type { WorkRuleClause, WorkRuleLibrary } from '@shared'
import { evaluateWithWorkRules, workRuleContext } from './work-rule-matching'
import { createCasePersonnelMatcher } from './case-personnel-matching'
import type { MainIpcContext } from './ipc/context'

const id = '10000000-0000-4000-8000-000000000001'
const job = { id, version: 1, fields: [{ key: 'required_skills', label: '必須', value: 'Java', sourceLabels: [] }] } as unknown as ConfirmedJobCase
const profile = (skills = 'Java') => ({ sourceDocumentId: 'p', profileVersion: 1, fields: [{ key: 'skills', label: 'スキル', value: skills }, { key: 'rate', label: '単価', value: '90万円' }], projectExperiences: [] }) as unknown as CandidateProfile
const library = (kind: WorkRuleClause['kind'], text: string, field: WorkRuleClause['field'] = 'required_skills'): WorkRuleLibrary => ({ revision: 1, rules: [{ id, revision: 1, enabled: true, scope: { kind: 'global' }, text, modelKey: 'test', updatedAt: new Date().toISOString(), updatedBy: 'HR', clauses: [{ kind, text, field, sourceQuote: text, caseKeywords: [] }] }] })

describe('shared HR rule matching', () => {
  it('keeps unknown new requirements reviewable for cloud evaluation and never fabricates evidence', () => {
    const result = evaluateWithWorkRules(profile(), job, library('required', 'Scala'))
    expect(result.reviewable).toBe(true)
    expect(result.missing).toContain('Scala')
    expect(result.qualification.status).toBe('excluded')
    expect(result.met.some((entry) => entry.requirement === 'Scala')).toBe(false)
  })
  it('checks added numerical conditions locally before cloud', () => {
    const result = evaluateWithWorkRules(profile(), job, library('required', '70万円以下', 'rate'))
    expect(result.reviewable).toBe(true)
    expect(result.qualification.status).toBe('recommended')
    expect(result.confirm.join(' ')).toContain('需协商')
    expect(result.qualification.requirements.some((entry) => entry.outcome === 'conflict')).toBe(true)
  })
  it('preference evidence improves ordering without excluding others', () => {
    const rules = library('preferred', 'Scala')
    const ordinary = evaluateWithWorkRules(profile(), job, rules)
    const preferred = evaluateWithWorkRules(profile('Java、Scala'), job, rules)
    expect(preferred.score).toBeGreaterThan(ordinary.score)
    expect(ordinary.qualification.status).toBe('recommended')
  })
  it('new rules cannot relax original mandatory conditions', () => {
    const result = evaluateWithWorkRules(profile('Scala'), job, library('preferred', 'Scala'))
    expect(result.qualification.status).toBe('excluded')
    expect(result.missing).toContain('Java')
  })
  it('carries confirmation instructions without asserting they are facts', () => {
    const result = evaluateWithWorkRules(profile(), job, library('confirm', '確認：設計書を本人が作成したか', null))
    expect(result.confirm).toContain('確認：設計書を本人が作成したか')
    expect(result.qualification.status).toBe('recommended')
    expect(workRuleContext(library('interview', '設計書を確認する', null), job).extraFields).toEqual([])
  })
  it('evaluates a deliberately supplied nonmatching person and keeps their result', async () => {
    const person = profile('Python')
    const assessMatchCandidates = vi.fn(async () => ({ assessments: [{ candidate: 'CANDIDATE_1', fit: 'insufficient-info', met: [], gaps: [], confirm: ['Java'], reason: '' }] }))
    const context = { repository: { listActiveJobCases: () => [job], getCandidateProfileForAssessment: () => person, listEligibleTalentProfiles: () => [person], listWorkRules: () => ({ revision: 0, rules: [] }) }, agentNarrativeStreamer: { assessMatchCandidates, cancel: vi.fn() }, agentChatModelCatalog: loadAgentChatModelCatalog() } as unknown as MainIpcContext
    const result = await createCasePersonnelMatcher(context)(id, { documentId: 'p' })
    expect(assessMatchCandidates).toHaveBeenCalledOnce()
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.assessment?.fit).toBe('weak')
  })
})
