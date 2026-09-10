import { candidateHardFilterEvidence, type CandidateProfile } from '@resume'
import { candidateBenchmarkQueryFromJobCase, type ConfirmedJobCase } from '@job-cases'
import {
  businessMatchingPolicyVersion, groundedRequirementQuote, groundedProfessionalQuote, explicitSkillDenial, localCoreRequirementEvidence,
  mentionsRequiredTerm, parseMatchRequirements, qualificationStatus, requiresOwnCompany,
  type BusinessMatchQualification, type MatchRequirement, type MatchRequirementEvidence, type CandidateMatchAssessment
} from '@shared'

type Verdict = Pick<CandidateMatchAssessment, 'met' | 'gaps' | 'confirm' | 'fit'> & {
  requirements?: Array<{ requirement: string; outcome: 'met' | 'unknown' | 'conflict'; evidence: string | null }>
}
const normalized = (value: string) => value.normalize('NFKC').trim().toLowerCase()
const fieldValue = (profile: CandidateProfile, key: string) => profile.fields.find((field) => field.key === key)?.value ?? null
const conditionKey: Record<string, string> = { role: 'role', japanese_level: 'japanese_level', rate: 'rate', start_date: 'availability', remote: 'work_style', location: 'location', work_authorization: 'work_authorization' }
const conditionTypes: Record<string, string> = { japanese_level: 'japanese-level', rate: 'maximum-rate', start_date: 'availability-by', remote: 'remote-work', location: 'location', work_authorization: 'work-authorization', contract_chain: 'own-company' }
const requirementConditionKey = (requirement: MatchRequirement) => requirement.key === 'required_skills'
  ? /日本語|日语|Japanese|N[1-5]/iu.test(requirement.label) ? 'japanese_level' : /^(SE|PG|PM|PMO|PL|TL|SL)$/iu.test(requirement.label) ? 'role' : 'language'
  : requirement.key

/** Normalize business conditions before the existing tri-state hard filters.
 * These transformations are scoped to the relevant field, never resume dates. */
export function businessHardFilters(profile: CandidateProfile, job: ConfirmedJobCase) {
  const normalizedProfile = { ...profile, fields: profile.fields.map((field) => ({ ...field,
    value: field.key === 'availability' ? field.value?.replace(/(20\d{2})[-/](\d{1,2})(?:[-/]\d{1,2})?/u, '$1年$2月') ?? null
      : field.key === 'work_style' ? field.value?.replace(/^(?:フルリモート|完全在宅|全远程|完全远程)$/u, 'フルリモートのみ').replace(/^(?:常駐|現場常駐|现场常驻|オンサイト)$/u, '常駐可') ?? null : field.value
  })) }
  const normalizedJob = { ...job, fields: job.fields.map((field) => ({ ...field,
    value: field.key === 'remote' ? field.value?.replace(/現場常駐|现场常驻|オンサイト|常驻/gu, '常駐') ?? null
      : field.key === 'start_date' ? field.value?.replace(/(20\d{2})[-/](\d{1,2})(?:[-/]\d{1,2})?/u, '$1年$2月').replace(/((?:20\d{2}年)?\d{1,2}月).*/u, '$1') ?? null : field.value
  })) }
  // Skill-specific years are evaluated against that skill's project history,
  // not the person's total experience_years field.
  const conditionTerms = parseMatchRequirements(normalizedJob.fields).filter((item) => item.key === 'required_skills' && item.category === 'condition').map((item) => item.label)
  return candidateHardFilterEvidence(normalizedProfile, [candidateBenchmarkQueryFromJobCase({ ...normalizedJob,
    fields: normalizedJob.fields.filter((field) => field.key !== 'required_skills') }), ...conditionTerms].join(' '))
}

function conditionEvidence(profile: CandidateProfile, requirement: MatchRequirement, hardFilters: ReturnType<typeof businessHardFilters>): MatchRequirementEvidence {
  const unknown: MatchRequirementEvidence = { requirement, outcome: 'unknown', evidence: null, source: null }
  const key = requirementConditionKey(requirement)
  const source = profile.fields.find((field) => field.key === (conditionKey[key] ?? key))?.label ?? null
  const filter = hardFilters.find((filter) => filter.type === conditionTypes[key])
  if (filter) return { requirement, outcome: filter.outcome === 'passed' ? 'met' : filter.outcome === 'failed' ? 'conflict' : 'unknown', evidence: filter.actual, source }
  if (key === 'contract_chain') {
    if (!requiresOwnCompany(requirement.label)) return unknown
    return { requirement, outcome: profile.isOwnCompany === true ? 'met' : 'conflict', evidence: profile.isOwnCompany === true ? '自社' : profile.isOwnCompany === false ? '非自社' : null, source: 'isOwnCompany' }
  }
  const actual = fieldValue(profile, conditionKey[key] ?? key)
  if (!actual) return unknown
  const bareJapanese = /^(?:日本語|日语|Japanese)$/iu.test(requirement.label)
  if (normalized(actual) === normalized(requirement.label) || key === 'role' && mentionsRequiredTerm(actual, requirement.label) || bareJapanese && /N[1-5]|会話|ビジネス|流暢/iu.test(actual)) {
    return { requirement, outcome: 'met', evidence: actual, source }
  }
  return unknown
}

export function evaluateBusinessMatch(profile: CandidateProfile, job: ConfirmedJobCase, verdict?: Verdict) {
  const hardFilters = businessHardFilters(profile, job)
  const parsed = parseMatchRequirements(job.fields)
  let requirements = parsed.map((requirement) => requirement.category === 'core'
    ? localCoreRequirementEvidence(profile, requirement) : conditionEvidence(profile, requirement, hardFilters))
  // Unknown / failed filters must remain authoritative, including self-company
  // constraints stated in notes rather than in a structured contract field.
  for (const filter of hardFilters) {
    if (requirements.some((item) => item.requirement.category === 'condition' && conditionTypes[requirementConditionKey(item.requirement)] === filter.type)) continue
    if (filter.outcome === 'passed') continue
    const requirement: MatchRequirement = { id: `H${requirements.length + 1}`, key: filter.type, label: filter.requested, category: 'condition', alternatives: [], minimumYears: null, requiresPractice: false }
    requirements.push({ requirement, outcome: filter.outcome === 'failed' ? 'conflict' : 'unknown', evidence: filter.actual, source: filter.type })
  }
  if (verdict) requirements = requirements.map((item) => {
    const conflict = verdict.requirements?.find((entry) => entry.outcome === 'conflict' && entry.evidence && normalized(entry.requirement) === normalized(item.requirement.label) &&
      groundedProfessionalQuote(profile, entry.evidence) && item.requirement.alternatives.flat().some((term) => explicitSkillDenial(entry.evidence!, term)))
    if (conflict) return { ...item, outcome: 'conflict' as const, evidence: conflict.evidence, source: 'AI / 档案原文' }
    if (item.outcome !== 'unknown') return item
    // A model can resolve semantic evidence, but cannot overrule a local hard
    // constraint or create a technology absent from this person's own sources.
    if (hardFilters.some((filter) => filter.outcome !== 'passed' && (item.requirement.id.startsWith('H') || conditionTypes[requirementConditionKey(item.requirement)] === filter.type))) return item
    const claims = [
      ...verdict.met,
      ...(verdict.requirements ?? []).flatMap((entry) => entry.outcome === 'met' && entry.evidence ? [{ requirement: entry.requirement, evidence: entry.evidence }] : [])
    ]
    const claim = claims.find((claim) => normalized(claim.requirement) === normalized(item.requirement.label) && groundedRequirementQuote(profile, item.requirement, claim.evidence))
    const source = claim ? profile.projectExperiences.find((project) => normalized(project.summary).includes(normalized(claim.evidence)))?.title
      ?? profile.fields.find((field) => field.value && normalized(field.value).includes(normalized(claim.evidence)))?.label ?? null : null
    return claim ? { ...item, outcome: 'met' as const, evidence: claim.evidence, source } : item
  })
  let status = qualificationStatus(requirements)
  // The model's remaining concern is never silently converted into approval.
  // Uncited "gaps" are questions, not fabricated negative facts.
  if (status === 'recommended' && verdict && (verdict.fit === 'weak' || verdict.fit === 'insufficient-info' || verdict.confirm.length || verdict.gaps.length || verdict.requirements?.some((item) => item.outcome !== 'met') || !verdict.met.length && !verdict.requirements?.some((item) => item.outcome === 'met'))) status = 'needs-confirmation'
  const qualification: BusinessMatchQualification = { policyVersion: businessMatchingPolicyVersion, status, requirements }
  const core = requirements.filter((item) => item.requirement.category === 'core')
  const matched = core.filter((item) => item.outcome === 'met').map((item) => item.requirement.label)
  const missing = core.filter((item) => item.outcome !== 'met').map((item) => item.requirement.label)
  const terms = core.flatMap((item) => item.requirement.alternatives.flat())
  const relatedProjects = profile.projectExperiences.filter((project) => terms.some((term) => mentionsRequiredTerm([...project.technologies, project.summary].join(' '), term)))
  const preferred = parseMatchRequirements(job.fields.filter((field) => field.key === 'preferred_skills').map((field) => ({ ...field, key: 'required_skills' })))
  const preferredCoverage = preferred.length ? preferred.filter((requirement) => localCoreRequirementEvidence(profile, requirement).outcome === 'met').length / preferred.length : 0
  const newestYear = Math.max(0, ...relatedProjects.flatMap((project) => [...(project.period ?? '').matchAll(/\b(20\d{2})/gu)].map((match) => Number(match[1]))))
  // Bonuses rank already-covered core requirements; they never change status.
  const bonus = matched.length === core.length ? Math.min(10, relatedProjects.length * 2) + Math.max(0, 5 - (new Date().getFullYear() - newestYear)) + preferredCoverage * 5 : 0
  const score = core.length ? Math.min(100, Math.round(matched.length / core.length * 80 + bonus)) : 0
  // Complex prose may need semantic reading. A bare role or language never
  // counts as relevant core evidence and cannot create a shortlist row.
  const hasCoreEvidence = matched.length > 0 || core.some((item) => item.requirement.alternatives.some((terms) => terms.some((term) => localCoreRequirementEvidence(profile, { ...item.requirement, alternatives: [[term]], minimumYears: null, requiresPractice: false, requiresSemanticReview: false }).outcome === 'met')))
  const semanticOnly = core.some((item) => item.requirement.alternatives.every((terms) => !terms.length))
  return { qualification, hardFilters, matched, missing, score,
    reviewable: (hasCoreEvidence || semanticOnly) && !requirements.some((item) => item.outcome === 'conflict') }
}

export function applyBusinessVerdict(profile: CandidateProfile, job: ConfirmedJobCase, verdict: Verdict) {
  const evaluated = evaluateBusinessMatch(profile, job, verdict)
  const fit = !verdict.met.length && !verdict.requirements?.some((item) => item.outcome === 'met') ? 'insufficient-info' : evaluated.qualification.status === 'excluded' ? evaluated.qualification.requirements.some((item) => item.outcome === 'conflict') ? 'weak' : 'insufficient-info'
    : evaluated.qualification.status === 'needs-confirmation' ? 'possible' : verdict.fit
  return { ...evaluated, fit: fit as CandidateMatchAssessment['fit'],
    met: evaluated.qualification.requirements.flatMap((item) => item.outcome === 'met' && item.evidence ? [{ requirement: item.requirement.label, evidence: item.evidence }] : []).slice(0, 8),
    confirm: [...new Set([...evaluated.qualification.requirements.filter((item) => item.outcome !== 'met').map((item) => item.requirement.label), ...verdict.confirm])].slice(0, 8) }
}

export function exclusionSummary(evaluations: Array<ReturnType<typeof evaluateBusinessMatch>>) {
  const excluded = evaluations.filter((item) => item.qualification.status === 'excluded')
  const missing = excluded.flatMap((item) => item.qualification.requirements.filter((entry) => entry.outcome !== 'met'))
  const core = missing.filter((entry) => entry.requirement.category === 'core')
  return { excludedCount: excluded.length, excludedRequirements: [...new Set((core.length ? core : missing).map((entry) => entry.requirement.label))].slice(0, 12) }
}
