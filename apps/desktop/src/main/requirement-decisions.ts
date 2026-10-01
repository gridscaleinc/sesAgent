import { randomUUID } from 'node:crypto'
import {
  applyRequirementConfirmations,
  decideRequirementInputSchema,
  excludedByHr,
  isProposalRequirement,
  requirementIdentity,
  withdrawRequirementDecisionInputSchema,
  type BusinessMatchQualification,
  type CasePersonAssessment,
  type MatchingOpportunity,
  type PersonnelCaseMatch,
  type RequirementConfirmation,
  type RequirementDecisionResult
} from '@shared'
import type { MainIpcContext } from './ipc/context'
import { opportunityItem } from './opportunity-discovery'
import { evaluateWithWorkRules } from './work-rule-matching'

type Repository = MainIpcContext['repository']
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
/** The labels a result lists as met and as still open, recomputed after decisions changed some outcomes. */
const labels = (qualification: BusinessMatchQualification) => ({
  matched: qualification.requirements.filter((item) => item.outcome === 'met').map((item) => item.requirement.label),
  missing: qualification.requirements
    .filter((item) => isProposalRequirement(item.requirement) && item.outcome !== 'met')
    .map((item) => item.requirement.label)
})

/**
 * Applies the person's current decisions to every stored result of theirs, without a model call: the latest case-side
 * assessment per case, the stored 找案件 run, and their matching opportunities. Results for an older profile or case
 * version are left alone; they are stale and are assessed again when opened.
 */
export function applyPersonDecisions(repository: Repository, documentId: string): RequirementDecisionResult {
  const confirmations = repository.listRequirementConfirmations(documentId)
  const jobs = repository.listActiveJobCases()
  const profile = repository.getCandidateProfileForAssessment(documentId)
  const assessments: CasePersonAssessment[] = []
  for (const job of jobs) {
    const latest = repository.listCaseAssessments(job.id).find((item) => item.documentId === documentId)
    const qualification = latest?.result.qualification
    if (!latest || !qualification || latest.jobCaseId !== job.id || latest.jobCaseVersion !== job.version) continue
    if (profile && latest.profileVersion !== profile.profileVersion) continue
    const next = applyRequirementConfirmations(qualification, confirmations, job)
    if (same(next, qualification)) continue
    // A new row keeps the history; the time stays the assessment's own, so 「上次找人」 does not move.
    const updated: CasePersonAssessment = {
      ...latest,
      id: randomUUID(),
      result: { ...latest.result, qualification: next, ...labels(next) }
    }
    repository.saveCasePersonAssessment(updated)
    assessments.push(updated)
  }
  let personRun = repository.getPersonCaseMatchRun(documentId)
  if (personRun) {
    const versions = new Map(jobs.map((job) => [job.id, job]))
    const items = personRun.result.items.map((item): PersonnelCaseMatch => {
      const job = versions.get(item.jobCaseId)
      if (!job || job.version !== item.jobCaseVersion || !item.qualification) return item
      const next = applyRequirementConfirmations(item.qualification, confirmations, job)
      return same(next, item.qualification) ? item : { ...item, qualification: next, ...labels(next) }
    })
    if (!same(items, personRun.result.items)) {
      // HR's 不满足 sorts last; the rest keep their order.
      const ordered = [
        ...items.filter((item) => item.qualification?.status !== 'excluded'),
        ...items.filter((item) => item.qualification?.status === 'excluded')
      ]
      personRun = { ...personRun, result: { ...personRun.result, items: ordered } }
      repository.savePersonCaseMatchRun(personRun)
    }
  }
  refreshOpportunities(repository, documentId, confirmations)
  return { confirmations, assessments, personRun }
}

/** Rebuilds this person's opportunity rows with the decisions applied, keeping every other row of those cases as stored. */
function refreshOpportunities(repository: Repository, documentId: string, confirmations: RequirementConfirmation[]) {
  const person = repository.listEligibleTalentProfiles().find((item) => item.sourceDocumentId === documentId)
  if (!person) return
  const status = repository.getPersonnelWorkspace().states.find((state) => state.documentId === documentId)?.status
  if (status === 'assigned' || status === 'paused') return
  const followed = new Set(
    repository
      .listBusinessFollowUps()
      .filter((row) => row.documentId === documentId)
      .map((row) => row.reviewId)
  )
  const rules = repository.listWorkRules()
  const zh = (repository.getLocalApplicationPreferences()?.locale ?? 'ja-JP') === 'zh-CN'
  // Who background discovery would leave out of a case's five: anyone followed on it, paused or in place.
  const states = new Map(repository.getPersonnelWorkspace().states.map((state) => [state.documentId, state.status]))
  const busy = new Set(repository.listBusinessFollowUps().map((row) => `${row.documentId}:${row.reviewId}`))
  const versions = new Map(repository.listEligibleTalentProfiles().map((item) => [item.sourceDocumentId, item.profileVersion]))
  const competing = (item: MatchingOpportunity, job: { version: number; sourceReviewId: string }) =>
    item.state !== 'dismissed' &&
    item.status !== 'not-suitable' &&
    item.jobCaseVersion === job.version &&
    versions.get(item.documentId) === item.profileVersion &&
    !['assigned', 'paused'].includes(states.get(item.documentId) ?? '') &&
    !busy.has(`${item.documentId}:${job.sourceReviewId}`)
  for (const job of repository.listActiveJobCases()) {
    if (followed.has(job.sourceReviewId)) continue
    // Every stored row of the case, unfiltered and untruncated.
    const stored = repository.listMatchingOpportunityRows(job.sourceReviewId)
    const row = stored.find((item) => item.documentId === documentId)
    const evaluation = evaluateWithWorkRules(person, job, rules, undefined, confirmations)
    const rebuilt = opportunityItem(job, { ...evaluation, person }, rules.revision, zh)
    if (row && rebuilt.fingerprint === row.fingerprint) continue
    if (!row) {
      // A pair HR's decision made proposable is added now, where background discovery would list it too: among the
      // case's five best, so it does not appear only to vanish at the next pass.
      if (!(evaluation.reviewable && evaluation.matched.length && evaluation.qualification.status === 'recommended')) continue
      const listed = stored.filter((item) => competing(item, job))
      if (listed.length >= 5 && listed.every((item) => item.score >= rebuilt.score)) continue
    }
    // Saving replaces the case's rows, so every other stored row of it goes back exactly as stored.
    const others = stored.filter((other) => other.documentId !== documentId).map(({ id: _, state: __, updatedAt: ___, ...item }) => item)
    // Excluded for a reason other than HR's 不满足 (one withdrawn while the material still conflicts): not an
    // opportunity at all, as background discovery would also leave it out.
    const dropped = evaluation.qualification.status === 'excluded' && !excludedByHr(evaluation.qualification)
    repository.saveMatchingOpportunities(job.sourceReviewId, dropped ? others : [...others, rebuilt])
  }
}

export function createRequirementDecisions({ repository }: Pick<MainIpcContext, 'repository'>) {
  return {
    list(documentId: string) {
      return repository.listRequirementConfirmations(documentId)
    },
    decide(raw: unknown, decidedBy: string | null): RequirementDecisionResult {
      const input = decideRequirementInputSchema.parse(raw)
      const job = repository.listActiveJobCases().find((item) => item.id === input.jobCaseId)
      if (!job) throw new Error('案件已结束或已更新，请刷新后再确认。 / 案件が終了または更新されました。再読込してから確認してください。')
      const saved = repository.saveRequirementConfirmation({
        id: randomUUID(),
        documentId: input.documentId,
        scope: input.scope,
        jobCaseId: input.scope === 'pair' ? job.id : null,
        jobCaseVersion: input.scope === 'pair' ? job.version : null,
        requirementKey: requirementIdentity(input.requirement),
        requirementLabel: input.requirement.label,
        outcome: input.outcome,
        note: input.note || null,
        question: input.outcome === 'asking' ? input.question || null : null,
        decidedAt: new Date().toISOString(),
        decidedBy
      })
      if (!saved) throw new Error('人员或案件已删除。 / 要員または案件は削除されています。')
      return applyPersonDecisions(repository, input.documentId)
    },
    withdraw(raw: unknown): RequirementDecisionResult {
      const input = withdrawRequirementDecisionInputSchema.parse(raw)
      repository.deleteRequirementConfirmation(input.id, input.documentId)
      return applyPersonDecisions(repository, input.documentId)
    }
  }
}
