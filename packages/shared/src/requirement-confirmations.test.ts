import { expect, it } from 'vitest'
import {
  applyRequirementConfirmations,
  excludedByHr,
  requirementIdentity,
  requirementQuestion,
  type BusinessMatchQualification,
  type MatchRequirement,
  type RequirementConfirmation
} from './matching-requirements'
import { decideRequirementInputSchema } from './requirement-confirmations'
import { matchFollowUpLabels } from './matching-requirements'

const requirement = (label: string, over: Partial<MatchRequirement> = {}): MatchRequirement => ({
  id: label,
  key: 'required_skills',
  label,
  category: 'condition',
  alternatives: [],
  minimumYears: null,
  requiresPractice: false,
  ...over
})
const japanese = requirement('日本語流暢')
const java = requirement('Java', { category: 'core', alternatives: [['Java']] })
const rate = requirement('70万以下', { key: 'rate' })
const qualification: BusinessMatchQualification = {
  policyVersion: 'technical-language-v5',
  status: 'needs-confirmation',
  requirements: [
    { requirement: java, outcome: 'met', evidence: 'Java 8年', source: 'skills' },
    { requirement: japanese, outcome: 'unknown', evidence: 'N2', source: '日本語レベル' },
    { requirement: rate, outcome: 'unknown', evidence: null, source: null }
  ]
}
const job = { id: 'case-1', version: 2 }
const decision = (over: Partial<RequirementConfirmation> = {}): RequirementConfirmation => ({
  id: 'd1',
  documentId: 'p1',
  scope: 'person',
  jobCaseId: null,
  jobCaseVersion: null,
  requirementKey: requirementIdentity(japanese),
  requirementLabel: japanese.label,
  outcome: 'met',
  note: '面谈确认',
  question: null,
  decidedAt: '2026-10-01T01:00:00.000Z',
  decidedBy: 'HR',
  ...over
})

it('turns an unclear language item met for every case asking the same, and makes the pair proposable', () => {
  const next = applyRequirementConfirmations(qualification, [decision()], job)
  expect(next.status).toBe('recommended')
  const item = next.requirements.find((entry) => entry.requirement.label === '日本語流暢')!
  expect(item.outcome).toBe('met')
  expect(item.hrDecision).toMatchObject({ outcome: 'met', scope: 'person', note: '面谈确认', decidedBy: 'HR' })
  // Business terms never take a decision: they do not decide the conclusion.
  expect(next.requirements.find((entry) => entry.requirement.key === 'rate')!.outcome).toBe('unknown')
})

it('keeps 不满足 reversible: withdrawing it returns the item to unclear', () => {
  const rejected = applyRequirementConfirmations(qualification, [decision({ outcome: 'conflict' })], job)
  expect(rejected.status).toBe('excluded')
  expect(excludedByHr(rejected)).toBe(true)
  const withdrawn = applyRequirementConfirmations(rejected, [], job)
  expect(withdrawn.status).toBe('needs-confirmation')
  expect(withdrawn.requirements.find((entry) => entry.requirement.label === '日本語流暢')).toEqual(qualification.requirements[1])
})

it('prefers a decision for this case version, and ignores one made for another version', () => {
  const pair = decision({ id: 'd2', scope: 'pair', jobCaseId: 'case-1', jobCaseVersion: 2, outcome: 'conflict' })
  expect(applyRequirementConfirmations(qualification, [decision(), pair], job).status).toBe('excluded')
  const older = { ...pair, jobCaseVersion: 1 }
  expect(applyRequirementConfirmations(qualification, [older], job).status).toBe('needs-confirmation')
})

it('keeps an item being asked unclear, with the question attached', () => {
  const asked = applyRequirementConfirmations(
    qualification,
    [decision({ outcome: 'asking', question: '会議で日本語を使えますか', note: null })],
    job
  )
  expect(asked.status).toBe('needs-confirmation')
  expect(asked.requirements[1]).toMatchObject({
    outcome: 'unknown',
    hrDecision: { outcome: 'asking', question: '会議で日本語を使えますか' }
  })
})

it('lets HR overrule a conflict of the material, restores it when withdrawn, and leaves an untouched qualification alone', () => {
  const conflict: BusinessMatchQualification = {
    ...qualification,
    requirements: [{ ...qualification.requirements[1]!, outcome: 'conflict' }]
  }
  // 「J2EE」 read as no Java: HR knows the person and settles it as met.
  const overruled = applyRequirementConfirmations(conflict, [decision()], job)
  expect(overruled.requirements[0]).toMatchObject({ outcome: 'met', hrDecision: { outcome: 'met', materialOutcome: 'conflict' } })
  // Withdrawn, the material's own conclusion comes back.
  expect(applyRequirementConfirmations(overruled, [], job).requirements[0]!.outcome).toBe('conflict')
  expect(applyRequirementConfirmations(qualification, [], job)).toBe(qualification)
  // A conflict of the material alone is not HR's: the pair is not kept as 不满足.
  expect(excludedByHr({ ...conflict, status: 'excluded' })).toBe(false)
})

it('words a question for the person and requires one when asking', () => {
  expect(requirementQuestion(japanese, true)).toContain('日本語流暢')
  expect(requirementQuestion(java, false)).toContain('実務経験')
  const base = {
    documentId: '11111111-1111-4111-8111-111111111111',
    jobCaseId: '22222222-2222-4222-8222-222222222222',
    requirement: { key: 'required_skills', label: '日本語流暢', category: 'condition' as const },
    scope: 'person' as const,
    note: null
  }
  expect(decideRequirementInputSchema.safeParse({ ...base, outcome: 'asking', question: null }).success).toBe(false)
  expect(decideRequirementInputSchema.safeParse({ ...base, outcome: 'met', question: null }).success).toBe(true)
})
