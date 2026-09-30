import { applyLearnedRanking, withRankingRefs } from './experience-ranking'
import { experienceBundle, experienceContext, matchingExperienceInput } from './experience-context'
import { withLearningForeground } from './learning-activity'
import { emptyWorkRules, evaluateWithWorkRules, workRuleContext } from './work-rule-matching'
import { randomUUID } from 'node:crypto'
import { defaultAgentChatModelKey, resolveAgentChatModel } from '@agent'
import { candidateBenchmarkQueryFromJobCase } from '@job-cases'
import {
  businessMatchingPolicyVersion,
  proposalConclusion,
  candidateProfileSourceInputSchema,
  type PersonnelCaseMatch,
  type PersonnelCaseMatchResult
} from '@shared'
import { effectiveApplicationPreferences } from './app-defaults'
import { matchAssessmentShortlistSize } from './agent-cloud-narrative'
import type { MainIpcContext } from './ipc/context'
import { applyBusinessVerdict, evaluateBusinessMatch, exclusionSummary } from './business-matching-policy'

const requirementKeys = new Set([
  'required_skills',
  'preferred_skills',
  'role',
  'japanese_level',
  'rate',
  'remote',
  'location',
  'work_authorization',
  'industry',
  'notes'
])
const fitRank = { strong: 0, possible: 1, 'insufficient-info': 3, weak: 4 }

/** One bounded cloud batch per click, with an honest local fallback. */
export function createPersonnelCaseMatcher(
  context: Pick<MainIpcContext, 'repository' | 'agentNarrativeStreamer' | 'agentChatModelCatalog'>,
  timeoutMs = 45_000
) {
  const inFlight = new Map<string, Promise<PersonnelCaseMatchResult>>()
  const { repository, agentNarrativeStreamer: cloud } = context
  const run = async (
    documentId: string,
    options?: { signal?: AbortSignal; onLocal?(result: PersonnelCaseMatchResult): void }
  ): Promise<PersonnelCaseMatchResult> => {
    options?.signal?.throwIfAborted()
    const profile = repository.listEligibleTalentProfiles().find((item) => item.sourceDocumentId === documentId)
    if (!profile) throw new Error('人员资料不存在或已停用，请刷新后重试。 / 要員情報が存在しないか停止されています。再読込してください。')
    const library = repository.listWorkRules?.() ?? emptyWorkRules
    const activeCases = repository.listActiveJobCases()
    // Same form as the renderer's signature: a new, closed or edited case makes a stored run stale.
    const caseSignature = activeCases
      .map((job) => `${job.id}:${job.version}`)
      .sort()
      .join(',')
    const locale = effectiveApplicationPreferences(repository).locale
    const snapshots = new Map(
      activeCases.map((job) => [
        job.id,
        { ...matchingExperienceInput(profile, job, locale, library), context: experienceContext(repository, job.fields, locale) }
      ])
    )
    const bundles = new Map(
      activeCases.map((job) => [
        job.id,
        experienceBundle(repository, 'matching', snapshots.get(job.id)!.requirements, snapshots.get(job.id)!.context)
      ])
    )
    const evaluations = new Map(activeCases.map((job) => [job.id, evaluateWithWorkRules(profile, job, library)]))
    let local = activeCases
      .flatMap((jobCase): PersonnelCaseMatch[] => {
        const evaluated = evaluations.get(jobCase.id)!
        if (!evaluated.reviewable) return []
        return [
          {
            reviewId: jobCase.sourceReviewId,
            jobCaseId: jobCase.id,
            jobCaseVersion: jobCase.version,
            title: jobCase.fields.find((field) => field.key === 'title')?.value ?? '案件',
            score: evaluated.score,
            rulePreference: evaluated.rulePreference,
            matched: evaluated.matched,
            missing: evaluated.missing,
            hardFilters: evaluated.hardFilters,
            qualification: evaluated.qualification,
            appliedRules: evaluated.appliedRules
          }
        ]
      })
      .toSorted((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.jobCaseId.localeCompare(b.jobCaseId))
    local = applyLearnedRanking(repository, local, (item) => item.jobCaseId, snapshots)
    let items = local.slice(0, matchAssessmentShortlistSize)
    const result: PersonnelCaseMatchResult = {
      documentId,
      profileVersion: profile.profileVersion,
      rulesRevision: library.revision,
      items,
      searchedCount: activeCases.length,
      ...exclusionSummary([...evaluations.values()]),
      localMatchCount: local.length,
      ownCompanyExcludedCount: 0,
      cloud: { status: items.length ? 'unavailable' : 'not-needed', reviewedCount: 0, modelName: null }
    }
    const finish = () => {
      result.items = applyLearnedRanking(repository, result.items, (item) => item.jobCaseId, snapshots)
      if (repository.saveExperienceRun)
        result.items = result.items.map((item) => {
          const input = snapshots.get(item.jobCaseId)!
          input.hardFilters = item.hardFilters.map((filter) => ({
            requirement: filter.requested,
            actual: filter.actual,
            outcome: filter.outcome
          }))
          return {
            ...item,
            experienceRunId: repository.saveExperienceRun({
              documentId,
              reviewId: item.reviewId,
              interviewId: null,
              profileVersion: profile.profileVersion,
              jobCaseVersion: item.jobCaseVersion,
              rulesRevision: library.revision,
              input,
              output: item,
              bundle: withRankingRefs(
                item.assessment ? bundles.get(item.jobCaseId)! : { ...bundles.get(item.jobCaseId)!, refs: [] },
                item.ranking
              ),
              modelKey: item.assessment?.modelKey ?? null
            })
          }
        })
      const shown = visible()
      // The latest completed run survives a restart; the renderer re-checks every version before reusing it.
      repository.savePersonCaseMatchRun?.({
        result: structuredClone(shown),
        searchedAt: new Date().toISOString(),
        caseSignature,
        policyVersion: businessMatchingPolicyVersion
      })
      return shown
    }
    const visible = () => ({ ...result, items: result.items.filter((item) => item.qualification?.status !== 'excluded') })
    options?.onLocal?.(structuredClone(visible()))
    if (!items.length || !cloud?.assessPersonnelCases) {
      if (items.length) result.cloud.reason = 'service-unavailable'
      return finish()
    }
    const model = resolveAgentChatModel(context.agentChatModelCatalog, defaultAgentChatModelKey)
    const controller = new AbortController()
    const abort = () => controller.abort()
    options?.signal?.addEventListener('abort', abort, { once: true })
    if (options?.signal?.aborted) controller.abort()
    let removeAbort = () => {}
    const cancelled = new Promise<never>((_, reject) => {
      const stop = () => reject(new Error('Matching cancelled'))
      controller.signal.addEventListener('abort', stop, { once: true })
      removeAbort = () => controller.signal.removeEventListener('abort', stop)
      if (controller.signal.aborted) stop()
    })
    let remoteId: string | null = null
    let remoteSettled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const started = performance.now()
    try {
      const assessment = await Promise.race([
        cancelled,
        cloud.assessPersonnelCases({
          conversationId: randomUUID(),
          requestId: randomUUID(),
          locale,
          model,
          signal: controller.signal,
          onClientRequestId: (id) => {
            remoteId = id
            if (controller.signal.aborted) void cloud.cancel(id).catch(() => undefined)
          },
          onRemoteSettled: () => {
            remoteSettled = true
          },
          person: {
            facts: profile.fields.flatMap((field) => (field.value ? [{ label: field.label, value: field.value }] : [])),
            projects: profile.projectExperiences.map(({ title, period, role, technologies, summary }) => ({
              title,
              period,
              role,
              technologies,
              summary
            }))
          },
          cases: items.map((item, index) => {
            const job = activeCases.find((candidate) => candidate.id === item.jobCaseId)!
            return {
              label: `CASE_${index + 1}`,
              title: item.title,
              experienceSkills: bundles.get(job.id)!.instructions,
              workRules: workRuleContext(library, job).applied,
              requirements: [
                ...job.fields.flatMap((field) =>
                  field.value && requirementKeys.has(field.key) ? [{ key: field.key, label: field.label, value: field.value }] : []
                ),
                ...workRuleContext(library, job).extraFields
              ],
              hardFilters: item.hardFilters.map((filter) => ({
                requirement: filter.requested,
                actual: filter.actual,
                outcome: filter.outcome
              }))
            }
          })
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort()
            reject(new Error('Personnel case assessment timed out.'))
          }, timeoutMs)
        })
      ])
      const assessedAt = new Date().toISOString()
      items = items.map((item, index) => {
        const verdict = assessment.assessments.find((entry) => entry.candidate === `CASE_${index + 1}`)
        if (!verdict) return item
        const evaluated = evaluateWithWorkRules(
          profile,
          activeCases.find((job) => job.id === item.jobCaseId)!,
          library,
          verdict
        )
        evaluations.set(item.jobCaseId, evaluated)
        return {
          ...item,
          score: evaluated.score,
          rulePreference: evaluated.rulePreference,
          qualification: evaluated.qualification,
          matched: evaluated.matched,
          missing: evaluated.missing,
          assessment: {
            version: 'match-assessment-v1' as const,
            fit: evaluated.fit,
            met: evaluated.met,
            gaps: [],
            confirm: evaluated.confirm,
            reason: proposalConclusion(evaluated.qualification, locale === 'zh-CN'),
            modelKey: model.key,
            assessedAt,
            ...(verdict.opinion ? { opinion: verdict.opinion } : {})
          }
        }
      })
      const reviewedCount = items.filter((item) => item.assessment).length
      result.cloud = {
        status: reviewedCount === items.length ? 'reviewed' : reviewedCount ? 'partial' : 'failed',
        reviewedCount,
        modelName: reviewedCount ? model.displayName : null,
        ...(reviewedCount !== items.length ? { reason: 'no-valid-result' as const } : {})
      }
    } catch {
      result.cloud = { status: 'failed', reason: 'request-failed', reviewedCount: 0, modelName: null }
    } finally {
      clearTimeout(timeout)
      removeAbort()
      options?.signal?.removeEventListener('abort', abort)
      if (controller.signal.aborted && remoteId && !remoteSettled) void cloud.cancel(remoteId).catch(() => undefined)
      console.info('[personnel-case-assessment]', {
        status: result.cloud.status,
        locale,
        reviewedCount: result.cloud.reviewedCount,
        localCount: local.length,
        durationMs: Math.round(performance.now() - started)
      })
    }
    if (options?.signal?.aborted) throw new Error('已停止匹配。 / マッチングを停止しました。')
    // Never attach an old assessment to a profile or case edited during the request.
    const current = repository.listEligibleTalentProfiles().find((item) => item.sourceDocumentId === documentId)
    if (!current || current.profileVersion !== profile.profileVersion)
      throw new Error('人员资料已更新，请重新找案件。 / 要員情報が更新されました。再検索してください。')
    if ((repository.listWorkRules?.().revision ?? 0) !== library.revision)
      throw new Error('AI 规则已更新，请重新评估。 / AIルールが更新されました。再評価してください。')
    const currentCases = new Map(repository.listActiveJobCases().map((item) => [item.id, item.version]))
    result.items = items
      .filter((item) => currentCases.get(item.jobCaseId) === item.jobCaseVersion)
      .toSorted(
        (a, b) =>
          Number(b.qualification?.status === 'recommended') - Number(a.qualification?.status === 'recommended') ||
          (a.assessment ? fitRank[a.assessment.fit] : 2) - (b.assessment ? fitRank[b.assessment.fit] : 2) ||
          (b.score ?? 0) - (a.score ?? 0)
      )
    result.cloud.reviewedCount = result.items.filter((item) => item.assessment).length
    Object.assign(result, exclusionSummary([...evaluations.values()]))
    return finish()
  }
  return (
    raw: unknown,
    options?: { signal?: AbortSignal; onLocal?(result: PersonnelCaseMatchResult): void }
  ): Promise<PersonnelCaseMatchResult> => {
    const documentId = candidateProfileSourceInputSchema.parse(raw)
    const key = `${documentId}:${repository.listWorkRules?.().revision ?? 0}`
    const pending = inFlight.get(key)
    if (pending) return pending
    const promise = run(documentId, options).finally(() => inFlight.delete(key))
    inFlight.set(key, promise)
    return promise
  }
}
