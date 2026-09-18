import { candidateHardFilterEvidence, type CandidateProfile } from '@resume'
import { candidateBenchmarkQueryFromJobCase, type ConfirmedJobCase } from '@job-cases'
import {
  businessMatchingPolicyVersion, groundedRequirementQuote, groundedProfessionalQuote, explicitSkillDenial, localCoreRequirementEvidence,
  mentionsRequiredTerm, parseMatchRequirements, qualificationStatus, requiresOwnCompany,
  isProposalRequirement, requirementDimension, uniqueRequirementEvidence, matchFollowUpLabels,
  type BusinessMatchQualification, type MatchRequirement, type MatchRequirementEvidence, type CandidateMatchAssessment
} from '@shared'
import { languageRequirementEvidence } from './business-language-evidence'

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

/** Exclude scheduling from retrieval hard filters; retain it as a follow-up. */
export const resumeAssessmentFields = <T extends {key:string}>(fields: readonly T[]): T[] => fields.filter(field => field.key !== 'start_date')

function workStyleFilter(profile: CandidateProfile, job: ConfirmedJobCase) {
  const requested = job.fields.find(f => f.key === 'remote')?.value
  const actual = fieldValue(profile, 'work_style')
  if (!requested || !actual) return null
  const wanted = requested.normalize('NFKC'), preference = actual.normalize('NFKC')
  const onsite = /常駐|出社|出勤|オンサイト|到岗|到場|现场|常驻/u.test(wanted) && !/出社不要|出勤不要|常駐不要/u.test(wanted)
  const remoteOnly = /^(?:フルリモート|完全在宅|完全远程|全远程)$/u.test(preference.trim()) || /(?:フルリモート|完全在宅|在宅|リモート)(?:のみ|限定)|只(?:接受|能|要).*(?:在宅|远程)|(?:出社|出勤|常駐)(?:不可|NG)/u.test(preference)
  const weekly = wanted.match(/週\s*([1-5])\s*日?\s*(?:出社|出勤|常駐)|(?:出社|出勤)(?:は)?\s*週\s*([1-5])\s*日?/u)
  const requestedDays = weekly ? Number(weekly[1] ?? weekly[2]) : /常駐|常驻/u.test(wanted) ? 5 : null
  const maximumDays = preference.match(/(?:週\s*([0-5])\s*日?\s*(?:まで|以内)\s*(?:出社|出勤)|(?:出社|出勤)\s*(?:は)?週\s*([0-5])\s*日?\s*(?:まで|以内))/u)
  const conflict = onsite && (remoteOnly || Boolean(maximumDays && requestedDays !== null && requestedDays > Number(maximumDays[1] ?? maximumDays[2])))
    || /^(?:フルリモート|完全在宅)$/u.test(wanted.trim()) && /(?:常駐|出社)(?:のみ|限定)/u.test(preference)
  const explicitCompatible = onsite && /(?:出社|出勤|常駐|オンサイト)(?:可|可能)|制限なし|不問/u.test(preference)
    || /^(?:フルリモート|完全在宅)$/u.test(wanted.trim()) && /リモート|在宅/u.test(preference)
  return conflict || explicitCompatible ? {type:'remote-work' as const,requested,actual,outcome:conflict?'failed' as const:'passed' as const} : null
}

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
    fields: resumeAssessmentFields(normalizedJob.fields).filter((field) => !['required_skills','remote'].includes(field.key)) }), ...conditionTerms].join(' ')).filter(filter => !['availability-by','remote-work'].includes(filter.type)).concat(workStyleFilter(profile,job) ?? [])
}

function conditionEvidence(profile: CandidateProfile, requirement: MatchRequirement, hardFilters: ReturnType<typeof businessHardFilters>): MatchRequirementEvidence {
  if (requirementDimension(requirement) === 'language') return languageRequirementEvidence(profile, requirement)
  const unknown: MatchRequirementEvidence = { requirement, outcome: 'unknown', evidence: null, source: null }
  const key = requirementConditionKey(requirement)
  const source = profile.fields.find((field) => field.key === (conditionKey[key] ?? key))?.label ?? null
  if (key === 'contract_chain') {
    if (!requiresOwnCompany(requirement.label)) return unknown
    return { requirement, outcome: profile.isOwnCompany === true ? 'met' : profile.isOwnCompany === false ? 'conflict' : 'unknown', evidence: profile.isOwnCompany === true ? '自社' : profile.isOwnCompany === false ? '非自社' : null, source: 'isOwnCompany' }
  }
  const filter = hardFilters.find((filter) => filter.type === conditionTypes[key])
  if (filter) return { requirement, outcome: filter.outcome === 'passed' ? 'met' : filter.outcome === 'failed' ? 'conflict' : 'unknown', evidence: filter.actual, source }
  const actual = fieldValue(profile, conditionKey[key] ?? key)
  if (!actual) return unknown
  const bareJapanese = /^(?:日本語|日语|Japanese)$/iu.test(requirement.label)
  if (normalized(actual) === normalized(requirement.label) || key === 'role' && mentionsRequiredTerm(actual, requirement.label) || bareJapanese && /N[1-5]|会話|ビジネス|流暢/iu.test(actual)) {
    return { requirement, outcome: 'met', evidence: actual, source }
  }
  return { ...unknown, evidence: actual, source }
}

export function evaluateBusinessMatch(profile: CandidateProfile, job: ConfirmedJobCase, verdict?: Verdict) {
  const parsed = parseMatchRequirements(job.fields)
  // The same language evidence drives both the displayed conclusion and the
  // machine context; a sparse extracted field must not contradict project facts.
  const hardFilters = businessHardFilters(profile, job).filter(filter => filter.type !== 'japanese-level')
  for (const requirement of parsed.filter(item => requirementDimension(item) === 'language' && /日本語|日语|Japanese|N[1-5]/iu.test(item.label))) {
    const language = languageRequirementEvidence(profile, requirement)
    hardFilters.push({ type: 'japanese-level', requested: requirement.label, actual: language.evidence,
      outcome: language.outcome === 'met' ? 'passed' : language.outcome === 'conflict' ? 'failed' : 'unknown' })
  }
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
    // Language levels and grade definitions are read from the person's facts.
    // A free model assertion cannot turn an unexplained grade into fluency.
    if (requirementDimension(item.requirement) === 'language') return item
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
  const unresolvedCore = new Set(requirements.filter(item => item.requirement.category === 'core' && item.outcome === 'unknown').map(item => item.requirement.id))
  // Missing mandatory evidence means unsuitable for this case, not a permanent
  // assertion about the person's ability. Preserve null evidence rather than inventing a quote.
  const hasProfessionalMaterial = profile.projectExperiences.length > 0 || profile.fields.some(field => ['skills', 'summary', 'experience'].includes(field.key) && field.value?.trim())
  requirements = uniqueRequirementEvidence(requirements.map(item => hasProfessionalMaterial && unresolvedCore.has(item.requirement.id) ? {...item,outcome:'conflict' as const} : item))
  const status = qualificationStatus(requirements)
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
    reviewable: (hasCoreEvidence || semanticOnly) && !requirements.some((item) => isProposalRequirement(item.requirement) && item.outcome === 'conflict' && !unresolvedCore.has(item.requirement.id)) }
}

export function applyBusinessVerdict(profile: CandidateProfile, job: ConfirmedJobCase, verdict: Verdict) {
  const evaluated = evaluateBusinessMatch(profile, job, verdict)
  const fit: CandidateMatchAssessment['fit'] = evaluated.qualification.status === 'excluded' ? 'weak' : evaluated.qualification.status === 'needs-confirmation' ? 'possible' : 'strong'
  return { ...evaluated, fit: fit as CandidateMatchAssessment['fit'],
    met: evaluated.qualification.requirements.flatMap((item) => item.outcome === 'met' && item.evidence ? [{ requirement: item.requirement.label, evidence: item.evidence }] : []).slice(0, 8),
    confirm: matchFollowUpLabels(evaluated.qualification) }
}

export function exclusionSummary(evaluations: Array<ReturnType<typeof evaluateBusinessMatch>>) {
  const excluded = evaluations.filter((item) => item.qualification.status === 'excluded')
  const missing = excluded.flatMap((item) => item.qualification.requirements.filter((entry) => isProposalRequirement(entry.requirement) && entry.outcome !== 'met'))
  const core = missing.filter((entry) => entry.requirement.category === 'core')
  return { excludedCount: excluded.length, excludedRequirements: [...new Set((core.length ? core : missing).map((entry) => entry.requirement.label))].slice(0, 12) }
}
