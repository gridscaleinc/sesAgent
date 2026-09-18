import { randomUUID } from 'node:crypto'
import type { CasePersonnelMatchResult } from '@shared'
import type { EncryptedApplicationRepository } from '@persistence'

/** Save search and explicit assessments in the same history, without rerunning the model. */
export function saveCaseSearchAssessments(
  repository: Pick<EncryptedApplicationRepository, 'listCasePersonAssessments' | 'saveCasePersonAssessment'>,
  result: CasePersonnelMatchResult,
  startedAt: number
): CasePersonnelMatchResult {
  const assessedAt = new Date().toISOString()
  return { ...result, assessedAt, items: result.items.map(item => {
    const previous = repository.listCasePersonAssessments(item.documentId, result.jobCaseId)[0]
    // A more recent explicit assessment owns this pair, including after an app restart.
    if (previous && Date.parse(previous.assessedAt) > startedAt && previous.origin !== 'search' &&
      previous.jobCaseId === result.jobCaseId && previous.jobCaseVersion === result.jobCaseVersion &&
      previous.profileVersion === item.profileVersion && previous.rulesRevision === (result.rulesRevision ?? 0)) {
      return { ...previous.result, assessmentId: previous.id }
    }
    const assessmentId = randomUUID()
    const saved = { ...item, assessmentId }
    repository.saveCasePersonAssessment({ id: assessmentId, jobCaseId: result.jobCaseId, documentId: item.documentId,
      jobCaseVersion: result.jobCaseVersion, profileVersion: item.profileVersion, assessedAt,
      rulesRevision: result.rulesRevision ?? 0, appliedRules: item.appliedRules ?? [], result: saved, cloud: result.cloud,
      origin: previous && previous.origin !== 'search' ? 'specified' : 'search' })
    return saved
  }) }
}
