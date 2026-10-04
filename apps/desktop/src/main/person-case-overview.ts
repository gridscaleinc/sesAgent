import {
  businessMatchingPolicyVersion,
  excludedByHr,
  type CasePersonAssessment,
  type PersonnelCaseMatch,
  type PersonnelCaseMatchRunSummary,
  type StoredPersonnelCaseMatchRun
} from '@shared'
import type { MainIpcContext } from './ipc/context'

type Repository = Pick<
  MainIpcContext['repository'],
  | 'listActiveJobCases'
  | 'listCaseAssessments'
  | 'getCandidateProfileForAssessment'
  | 'getPersonCaseMatchRun'
  | 'listPersonCaseMatchRunSummaries'
  | 'listEligibleTalentProfiles'
  | 'listWorkRules'
>

/**
 * One pair has one answer, whichever side asked. A person's 找案件 result and the case pages' 找人 / 添加简历
 * assessments of the same person are kept apart in storage; the person's view merges them: per active case the
 * newer current result wins. "Current" means the case version, profile version, rules and matching policy it was
 * made under are still the current ones, so nothing outdated is shown as a fresh result.
 */
/** Each active case with its latest assessment per person, read once and shared by every person of one request. */
function caseSideIndex(repository: Repository) {
  return repository.listActiveJobCases().map((job) => {
    const latest = new Map<string, CasePersonAssessment>()
    for (const item of repository.listCaseAssessments(job.id)) if (!latest.has(item.documentId)) latest.set(item.documentId, item)
    return { job, latest }
  })
}
type CaseSideIndex = ReturnType<typeof caseSideIndex>

function caseSideMatches(index: CaseSideIndex, documentId: string, profileVersion: number, rulesRevision: number) {
  const matches = new Map<string, { item: PersonnelCaseMatch; at: string }>()
  for (const { job, latest: byPerson } of index) {
    const latest = byPerson.get(documentId)
    if (
      !latest ||
      latest.jobCaseVersion !== job.version ||
      latest.profileVersion !== profileVersion ||
      latest.rulesRevision !== rulesRevision ||
      latest.result.qualification?.policyVersion !== businessMatchingPolicyVersion
    )
      continue
    // As the 找案件 list: an exclusion only stays listed when HR decided it.
    if (latest.result.qualification.status === 'excluded' && !excludedByHr(latest.result.qualification)) continue
    const { documentId: _, profileVersion: __, assessmentId: ___, ...match } = latest.result
    matches.set(job.id, {
      at: latest.assessedAt,
      item: {
        ...match,
        appliedRules: latest.appliedRules,
        reviewId: job.sourceReviewId,
        jobCaseId: job.id,
        jobCaseVersion: job.version,
        title: job.fields.find((field) => field.key === 'title')?.value ?? '案件'
      }
    })
  }
  return matches
}

/** The person's stored 找案件 run with the newer case-side results merged in; one made of case-side results alone when there is no run. */
export function personCaseMatchView(
  repository: Repository,
  documentId: string,
  shared?: { index: CaseSideIndex; rulesRevision: number }
): StoredPersonnelCaseMatchRun | null {
  const stored = repository.getPersonCaseMatchRun(documentId)
  const profileVersion = repository.getCandidateProfileForAssessment(documentId)?.profileVersion
  if (profileVersion === undefined) return stored
  const rulesRevision = shared?.rulesRevision ?? repository.listWorkRules().revision
  const caseSide = caseSideMatches(shared?.index ?? caseSideIndex(repository), documentId, profileVersion, rulesRevision)
  if (!caseSide.size) return stored
  if (!stored) {
    const items = [...caseSide.values()].map((entry) => entry.item)
    const searchedAt = [...caseSide.values()]
      .map((entry) => entry.at)
      .sort()
      .at(-1)!
    return {
      result: {
        documentId,
        profileVersion,
        rulesRevision,
        items,
        localMatchCount: items.length,
        cloud: { status: 'reviewed', reviewedCount: items.filter((item) => item.assessment).length, modelName: null }
      },
      searchedAt,
      // Only the cases already assessed count as searched: any other active case is offered as a new search.
      caseSignature: items
        .map((item) => `${item.jobCaseId}:${item.jobCaseVersion}`)
        .sort()
        .join(','),
      policyVersion: businessMatchingPolicyVersion
    }
  }
  const items = stored.result.items.map((item) => {
    const newer = caseSide.get(item.jobCaseId)
    return newer && newer.at > stored.searchedAt ? newer.item : item
  })
  for (const [jobCaseId, entry] of caseSide)
    if (!items.some((item) => item.jobCaseId === jobCaseId) && entry.at > stored.searchedAt) items.push(entry.item)
  return { ...stored, result: { ...stored.result, items } }
}

/** Badge counts for the person list: 可提案案件 is the recommended cases of the merged view, per person. */
export function personCaseMatchSummaries(repository: Repository): PersonnelCaseMatchRunSummary[] {
  const stored = new Map(repository.listPersonCaseMatchRunSummaries().map((summary) => [summary.documentId, summary]))
  const people = new Set([...stored.keys(), ...repository.listEligibleTalentProfiles().map((profile) => profile.sourceDocumentId)])
  const shared = { index: caseSideIndex(repository), rulesRevision: repository.listWorkRules().revision }
  return [...people].flatMap((documentId): PersonnelCaseMatchRunSummary[] => {
    const view = personCaseMatchView(repository, documentId, shared)
    if (!view) return []
    return [
      {
        documentId,
        profileVersion: view.result.profileVersion,
        rulesRevision: view.result.rulesRevision ?? 0,
        policyVersion: view.policyVersion,
        caseSignature: view.caseSignature,
        searchedAt: view.searchedAt,
        listedCount: stored.get(documentId)?.listedCount ?? view.result.items.length,
        proposableCount: view.result.items.filter((item) => item.qualification?.status === 'recommended').length
      }
    ]
  })
}
