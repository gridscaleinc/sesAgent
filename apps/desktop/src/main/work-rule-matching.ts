import type { CandidateProfile } from '@resume'
import type { ConfirmedJobCase } from '@job-cases'
import {
  applicableWorkRules,
  applyRequirementConfirmations,
  type RequirementConfirmation,
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
type ConfirmationSource = {
  listRequirementConfirmations?(documentId: string): RequirementConfirmation[]
  listAllRequirementConfirmations?(): RequirementConfirmation[]
}
/** HR decisions for one person; none when the repository (or a test double) keeps none. */
export const confirmationsOf = (repository: ConfirmationSource, documentId: string): RequirementConfirmation[] =>
  repository.listRequirementConfirmations?.(documentId) ?? []
/** Every person's decisions, read once for a pass over many people. */
export function confirmationIndex(repository: ConfirmationSource): (documentId: string) => RequirementConfirmation[] {
  const byPerson = new Map<string, RequirementConfirmation[]>()
  for (const item of repository.listAllRequirementConfirmations?.() ?? [])
    byPerson.set(item.documentId, [...(byPerson.get(item.documentId) ?? []), item])
  return (documentId) => byPerson.get(documentId) ?? []
}
/** Changes whenever a decision is made or withdrawn; part of cache keys and checkpoints. */
export function confirmationSignature(confirmations: readonly RequirementConfirmation[]): string {
  return confirmations
    .map((item) => `${item.id}:${item.outcome}:${item.decidedAt}`)
    .sort()
    .join(',')
}
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
export function evaluateWithWorkRules(
  profile: CandidateProfile,
  job: ConfirmedJobCase,
  library: WorkRuleLibrary,
  verdict?: Verdict,
  /** HR decisions for this person; they settle items the material left unclear, after rules and the model. */
  confirmations: readonly RequirementConfirmation[] = []
) {
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
  const qualification = applyRequirementConfirmations(
    { ...base.qualification, requirements, status: qualificationStatus(requirements) },
    confirmations,
    job
  )
  requirements = qualification.requirements
  // Worth listing: no language conflict of the material left unsettled. HR's word counts both ways — a 不满足 keeps
  // the pair listed (marked, last), and a conflict HR overruled as met (「J2EE」 for Java) no longer hides it.
  const listed = !requirements.some(
    (item) => item.outcome === 'conflict' && !item.hrDecision && requirementDimension(item.requirement) === 'language'
  )
  const overruled =
    requirements.some((item) => item.hrDecision?.outcome === 'met' && item.hrDecision.materialOutcome === 'conflict') &&
    !requirements.some((item) => isProposalRequirement(item.requirement) && item.outcome === 'conflict' && !item.hrDecision)
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
    reviewable: (base.reviewable || overruled) && listed
  }
}

type PairSource = ConfirmationSource & {
  listActiveJobCases(): ConfirmedJobCase[]
  listWorkRules(): WorkRuleLibrary
  getCandidateProfileForAssessment(documentId: string): CandidateProfile | null
}
/**
 * Whether HR judged this person 不满足 for this case (by its review), the same reading 找人 and 新匹配机会 use.
 * Such a pair is not introduced or recorded as recommended anywhere.
 */
export function rejectedByHr(repository: PairSource, documentId: string, reviewId: string): boolean {
  const decisions = confirmationsOf(repository, documentId)
  if (!decisions.some((item) => item.outcome === 'conflict')) return false
  const job = repository.listActiveJobCases().find((item) => item.sourceReviewId === reviewId)
  const profile = job ? repository.getCandidateProfileForAssessment(documentId) : null
  if (!job || !profile) return false
  // Any requirement HR judged 不满足 for this case is enough, whatever else the material left in conflict.
  return evaluateWithWorkRules(profile, job, repository.listWorkRules(), undefined, decisions).qualification.requirements.some(
    (item) => isProposalRequirement(item.requirement) && item.hrDecision?.outcome === 'conflict'
  )
}
