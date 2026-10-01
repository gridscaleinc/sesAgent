import { randomUUID } from 'node:crypto'
import { businessMatchingPolicyVersion, type CasePersonAssessment } from '@shared'
import type { MainIpcContext } from './ipc/context'
import { confirmationsOf, evaluateWithWorkRules } from './work-rule-matching'

/** Upgrade the latest pair result locally when the policy changes. Preserve the
 * historical row and its feedback; never report a new cloud call as completed. */
export function refreshCaseAssessmentPolicy(
  repository: MainIpcContext['repository'],
  previous: CasePersonAssessment,
  jobCaseId: string
): CasePersonAssessment {
  if (previous.result.qualification?.policyVersion === businessMatchingPolicyVersion) return previous
  const job = repository.listActiveJobCases().find((job) => job.id === jobCaseId)
  const profile = repository.getCandidateProfileForAssessment(previous.documentId)
  if (!job || !profile) return previous
  const library = repository.listWorkRules()
  const reusable =
    previous.profileVersion === profile.profileVersion && previous.jobCaseVersion === job.version && previous.jobCaseId === job.id
  const evaluated = evaluateWithWorkRules(
    profile,
    job,
    library,
    reusable ? previous.result.assessment : undefined,
    confirmationsOf(repository, previous.documentId)
  )
  const updated: CasePersonAssessment = {
    id: randomUUID(),
    origin: previous.origin,
    documentId: previous.documentId,
    jobCaseId: job.id,
    profileVersion: profile.profileVersion,
    jobCaseVersion: job.version,
    rulesRevision: library.revision,
    assessedAt: new Date().toISOString(),
    appliedRules: evaluated.appliedRules,
    result: {
      documentId: previous.documentId,
      profileVersion: profile.profileVersion,
      score: evaluated.score,
      matched: evaluated.matched,
      missing: evaluated.missing,
      hardFilters: evaluated.hardFilters,
      qualification: evaluated.qualification,
      appliedRules: evaluated.appliedRules
    },
    cloud: { status: 'unavailable', reason: 'policy-refresh', reviewedCount: 0, modelName: null }
  }
  repository.saveCasePersonAssessment(updated)
  return updated
}
