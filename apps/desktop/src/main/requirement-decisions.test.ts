import { expect, it, vi } from 'vitest'
import type { CasePersonAssessment, PersonnelCaseMatch, RequirementConfirmation, StoredPersonnelCaseMatchRun } from '@shared'
import { createRequirementDecisions } from './requirement-decisions'

const documentId = '11111111-1111-4111-8111-111111111111'
const jobCaseId = '22222222-2222-4222-8222-222222222222'
const japanese = {
  id: 'R1',
  key: 'required_skills',
  label: '日本語流暢',
  category: 'condition' as const,
  alternatives: [],
  minimumYears: null,
  requiresPractice: false
}
const java = { ...japanese, id: 'R0', label: 'Java', category: 'core' as const, alternatives: [['Java']] }
const qualification = {
  policyVersion: 'technical-language-v5' as const,
  status: 'needs-confirmation' as const,
  requirements: [
    { requirement: java, outcome: 'met' as const, evidence: 'Java 8年', source: 'skills' },
    { requirement: japanese, outcome: 'unknown' as const, evidence: 'N2', source: null }
  ]
}
const job = { id: jobCaseId, version: 3, sourceReviewId: 'review-1', fields: [{ key: 'title', value: 'Java 案件' }] }
function repository() {
  let saved: RequirementConfirmation[] = []
  const assessment = {
    id: 'a1',
    documentId,
    jobCaseId,
    jobCaseVersion: 3,
    profileVersion: 5,
    assessedAt: '2026-09-30T01:00:00.000Z',
    origin: 'search',
    result: { documentId, profileVersion: 5, score: 80, matched: ['Java'], missing: ['日本語流暢'], hardFilters: [], qualification }
  } as unknown as CasePersonAssessment
  const run: StoredPersonnelCaseMatchRun = {
    result: {
      documentId,
      profileVersion: 5,
      items: [{ reviewId: 'review-1', jobCaseId, jobCaseVersion: 3, title: 'Java 案件', qualification } as unknown as PersonnelCaseMatch],
      cloud: { status: 'not-needed', reviewedCount: 0, modelName: null }
    } as StoredPersonnelCaseMatchRun['result'],
    searchedAt: '2026-09-30T02:00:00.000Z',
    caseSignature: `${jobCaseId}:3`,
    policyVersion: 'technical-language-v5'
  }
  return {
    listActiveJobCases: vi.fn(() => [job]),
    getCandidateProfileForAssessment: vi.fn(() => ({ profileVersion: 5 })),
    listCaseAssessments: vi.fn(() => [assessment]),
    saveCasePersonAssessment: vi.fn(),
    getPersonCaseMatchRun: vi.fn(() => run),
    savePersonCaseMatchRun: vi.fn(),
    listMatchingOpportunities: vi.fn(() => []),
    // No talent-library profile here: 新匹配机会 is not rebuilt in these tests.
    listEligibleTalentProfiles: vi.fn(() => []),
    saveRequirementConfirmation: vi.fn((record: RequirementConfirmation) => {
      saved = [record, ...saved.filter((item) => item.requirementKey !== record.requirementKey || item.scope !== record.scope)]
      return true
    }),
    listRequirementConfirmations: vi.fn(() => saved),
    deleteRequirementConfirmation: vi.fn((id: string) => {
      saved = saved.filter((item) => item.id !== id)
      return true
    })
  }
}
const input = (over: Record<string, unknown> = {}) => ({
  documentId,
  jobCaseId,
  requirement: { key: 'required_skills', label: '日本語流暢', category: 'condition' },
  outcome: 'met',
  scope: 'person',
  note: '面谈确认',
  question: null,
  ...over
})

it('records a decision as a fact about the person and updates the stored case result and 找案件 run in place', () => {
  const repo = repository()
  const decisions = createRequirementDecisions({ repository: repo as never })
  const result = decisions.decide(input(), 'Test HR')
  expect(result.confirmations).toEqual([
    expect.objectContaining({ scope: 'person', jobCaseId: null, outcome: 'met', decidedBy: 'Test HR', note: '面谈确认' })
  ])
  expect(result.assessments).toHaveLength(1)
  expect(result.assessments[0]!.result.qualification!.status).toBe('recommended')
  expect(result.assessments[0]!.result.missing).toEqual([])
  // The assessment time stays the original, so 「上次找人」 does not move.
  expect(result.assessments[0]!.assessedAt).toBe('2026-09-30T01:00:00.000Z')
  expect(repo.saveCasePersonAssessment).toHaveBeenCalledWith(result.assessments[0])
  expect(result.personRun!.result.items[0]!.qualification!.status).toBe('recommended')
  expect(repo.savePersonCaseMatchRun).toHaveBeenCalledWith(result.personRun)
})

it('keeps a pair decision to this case version, and a withdrawn decision reads as unclear again', () => {
  const repo = repository()
  const decisions = createRequirementDecisions({ repository: repo as never })
  const rejected = decisions.decide(input({ outcome: 'conflict', scope: 'pair' }), null)
  expect(rejected.confirmations[0]).toMatchObject({ scope: 'pair', jobCaseId, jobCaseVersion: 3 })
  expect(rejected.assessments[0]!.result.qualification!.status).toBe('excluded')
  vi.mocked(repo.listCaseAssessments).mockReturnValue(rejected.assessments)
  const withdrawn = decisions.withdraw({ id: rejected.confirmations[0]!.id, documentId })
  expect(withdrawn.confirmations).toEqual([])
  expect(withdrawn.assessments[0]!.result.qualification!.status).toBe('needs-confirmation')
})

it('refuses a decision for a case no longer active and needs a question when asking', () => {
  const repo = repository()
  const decisions = createRequirementDecisions({ repository: repo as never })
  expect(() => decisions.decide(input({ outcome: 'asking', question: null }), null)).toThrow()
  vi.mocked(repo.listActiveJobCases).mockReturnValue([])
  expect(() => decisions.decide(input(), null)).toThrow(/案件已结束/u)
  expect(repo.saveRequirementConfirmation).not.toHaveBeenCalled()
})
