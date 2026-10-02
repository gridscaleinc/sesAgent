import { randomUUID } from 'node:crypto'
import { candidateIdentityKey, excludedByHr, sameCandidateRecord, type CasePersonnelMatchResult, type CaseSearchSummary } from '@shared'
import type { EncryptedApplicationRepository } from '@persistence'

/** Save search and explicit assessments in the same history, without rerunning the model. */
export function saveCaseSearchAssessments(
  repository: Pick<EncryptedApplicationRepository, 'listCasePersonAssessments' | 'saveCasePersonAssessment'>,
  result: CasePersonnelMatchResult,
  startedAt: number
): CasePersonnelMatchResult {
  const assessedAt = new Date().toISOString()
  return {
    ...result,
    assessedAt,
    items: result.items.map((item) => {
      const previous = repository.listCasePersonAssessments(item.documentId, result.jobCaseId)[0]
      // A more recent explicit assessment owns this pair, including after an app restart.
      if (
        previous &&
        Date.parse(previous.assessedAt) > startedAt &&
        previous.origin !== 'search' &&
        previous.jobCaseId === result.jobCaseId &&
        previous.jobCaseVersion === result.jobCaseVersion &&
        previous.profileVersion === item.profileVersion &&
        previous.rulesRevision === (result.rulesRevision ?? 0)
      ) {
        return { ...previous.result, assessmentId: previous.id }
      }
      const assessmentId = randomUUID()
      const saved = { ...item, assessmentId }
      repository.saveCasePersonAssessment({
        id: assessmentId,
        jobCaseId: result.jobCaseId,
        documentId: item.documentId,
        jobCaseVersion: result.jobCaseVersion,
        profileVersion: item.profileVersion,
        assessedAt,
        rulesRevision: result.rulesRevision ?? 0,
        appliedRules: item.appliedRules ?? [],
        result: saved,
        cloud: result.cloud,
        origin: previous && previous.origin !== 'search' ? 'specified' : 'search'
      })
      return saved
    })
  }
}

/**
 * 「查看人员 (n)」 counts for the case list at startup, from the same saved history the people panel loads.
 * It applies the panel's rules (visibleCaseTasks) to each person's latest assessment: searched people are
 * left out when their record is not active, the requirements exclude them or they are placed or paused, and
 * duplicate records of one person count once. Approximation: the count uses the stored qualification, while
 * opening the panel first re-evaluates results saved under an older matching policy; availability is read
 * once here. The renderer's in-session count replaces this one as soon as the panel has data for the case.
 */
export function summarizeCaseSearches(
  repository: Pick<
    EncryptedApplicationRepository,
    'listActiveJobCases' | 'listCaseAssessments' | 'listCandidateReviews' | 'getPersonnelWorkspace' | 'listBusinessFollowUps'
  >
): CaseSearchSummary[] {
  const jobs = [...new Map(repository.listActiveJobCases().map((job) => [job.sourceReviewId, job])).values()]
  if (!jobs.length) return []
  const people = new Map(repository.listCandidateReviews().map((person) => [person.documentId, person]))
  const unavailable = new Set(
    repository
      .getPersonnelWorkspace()
      .states.filter((item) => !['available', 'soon'].includes(item.status))
      .map((item) => item.documentId)
  )
  const followed = new Set((repository.listBusinessFollowUps?.() ?? []).map((row) => `${row.documentId}:${row.reviewId}`))
  return jobs.flatMap((job) => {
    const history = repository.listCaseAssessments(job.id)
    if (!history.length) return []
    const listed = history.filter(
      (row) =>
        // A deleted person is never listed or counted, however they came into the case.
        (people.get(row.documentId)?.recordStatus ?? 'deleted') !== 'deleted' &&
        (row.origin !== 'search' ||
          // As in the people panel: someone in a follow-up for this case is always listed.
          followed.has(`${row.documentId}:${job.sourceReviewId}`) ||
          (people.get(row.documentId)?.recordStatus === 'active' &&
            (row.result.qualification?.status !== 'excluded' || excludedByHr(row.result.qualification)) &&
            !unavailable.has(row.documentId)))
    )
    const kept: string[] = []
    for (const row of listed) {
      const person = people.get(row.documentId),
        key = candidateIdentityKey(person)
      const twin = kept.some(
        (documentId) =>
          documentId === row.documentId ||
          (key !== '' && candidateIdentityKey(people.get(documentId)) === key && sameCandidateRecord(person, people.get(documentId)))
      )
      if (!twin) kept.push(row.documentId)
    }
    const searchedAt = history
      .filter((row) => row.origin === 'search')
      .map((row) => row.assessedAt)
      .sort()
      .at(-1)
    return [{ reviewId: job.sourceReviewId, listedCount: kept.length, lastSearchedAt: searchedAt ?? null }]
  })
}
