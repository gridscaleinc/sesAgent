import type { CandidateProfile } from '@resume'
import type { ConfirmedJobCase } from '@job-cases'
import {
  applicableWorkRules,
  qualificationStatus,
  isProposalRequirement,
  requirementDimension,
  uniqueRequirementEvidence,
  matchFollowUpLabels,
  type AppliedWorkRule,
  type WorkRuleLibrary
} from '@shared'
import { evaluateBusinessMatch, applyBusinessVerdict } from './business-matching-policy'

export const emptyWorkRules: WorkRuleLibrary = { revision: 0, rules: [] }
type Verdict = Parameters<typeof applyBusinessVerdict>[2]
export function workRuleContext(library: WorkRuleLibrary, job: ConfirmedJobCase) {
  const rules = applicableWorkRules(library, job)
  const applied: AppliedWorkRule[] = rules.map(({ clause: _, ...rule }) => rule)
  const extraFields = rules
    .filter((rule) => rule.kind === 'required' || rule.kind === 'preferred')
    .map((rule) => ({
      key: rule.kind === 'preferred' ? 'preferred_skills' : (rule.clause.field ?? 'required_skills'),
      label: `HR: ${rule.kind}`,
      value: rule.text
    }))
  return { rules, applied, extraFields }
}

/** Rules augment the original case; they cannot erase its mandatory conditions. */
export function evaluateWithWorkRules(profile: CandidateProfile, job: ConfirmedJobCase, library: WorkRuleLibrary, verdict?: Verdict) {
  const base = verdict ? applyBusinessVerdict(profile, job, verdict) : evaluateBusinessMatch(profile, job)
  const context = workRuleContext(library, job)
  let requirements = [...base.qualification.requirements]
  let preferenceBonus = 0
  for (const [index, rule] of context.rules.entries()) {
    if (!['required', 'preferred'].includes(rule.kind)) continue
    // Each added condition is evaluated independently, preserving both the case's
    // original limit and any additional HR limit on the same business field.
    const field = { ...job.fields[0]!, key: rule.clause.field ?? 'required_skills', value: rule.text, label: 'HR' }
    const synthetic = { ...job, fields: [field] } as ConfirmedJobCase
    const evaluated = verdict ? applyBusinessVerdict(profile, synthetic, verdict) : evaluateBusinessMatch(profile, synthetic)
    if (rule.kind === 'required') {
      requirements.push(
        ...evaluated.qualification.requirements.map((item) => ({
          ...item,
          requirement: { ...item.requirement, id: `WR:${rule.id}:${index}:${item.requirement.id}` },
          source: item.evidence ? `HR v${rule.revision} / ${item.source ?? '档案'}` : `HR v${rule.revision}`
        }))
      )
    } else if (evaluated.qualification.requirements.length && evaluated.qualification.requirements.every((item) => item.outcome === 'met'))
      preferenceBonus += 10
  }
  requirements = uniqueRequirementEvidence(requirements)
  const qualification = { ...base.qualification, requirements, status: qualificationStatus(requirements) }
  const pending = context.rules.filter((rule) => rule.kind === 'confirm').map((rule) => rule.text)
  const met = requirements
    .filter((item) => item.outcome === 'met')
    .map((item) => ({ requirement: item.requirement.label, evidence: item.evidence! }))
  const confirm = matchFollowUpLabels(qualification, pending)
  return {
    ...base,
    qualification,
    met,
    confirm,
    appliedRules: context.applied,
    fit: (qualification.status === 'excluded'
      ? 'weak'
      : qualification.status === 'needs-confirmation'
        ? 'possible'
        : 'strong') as import('@shared').CandidateMatchAssessmentFit,
    matched: requirements.filter((item) => item.outcome === 'met').map((item) => item.requirement.label),
    missing: requirements
      .filter((item) => isProposalRequirement(item.requirement) && item.outcome !== 'met')
      .map((item) => item.requirement.label),
    rulePreference: Math.min(30, preferenceBonus),
    score: base.score + Math.min(30, preferenceBonus),
    // Unconfirmed additional rules go to the model instead of silently pruning a person.
    reviewable:
      base.reviewable && !requirements.some((item) => item.outcome === 'conflict' && requirementDimension(item.requirement) === 'language')
  }
}
