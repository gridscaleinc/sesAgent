import { applyLearnedRanking, withRankingRefs } from './experience-ranking'
import { experienceBundle, experienceContext, matchingExperienceInput } from './experience-context'
import { withLearningForeground } from './learning-activity'
import { confirmationIndex, emptyWorkRules, evaluateWithWorkRules, workRuleContext } from './work-rule-matching'
import { randomUUID } from 'node:crypto'
import { businessModel } from './business-model'
import { candidateBenchmarkQueryFromJobCase } from '@job-cases'
import {
  proposalConclusion,
  candidateProfileSourceInputSchema,
  cloudFailureReason,
  excludedByHr,
  type CasePersonnelMatchResult
} from '@shared'
import { effectiveApplicationPreferences } from './app-defaults'
import { casePeopleShortlistSize } from './agent-cloud-narrative'
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

/** The case-to-person counterpart of personnel-case-matching: one bounded batch. */
export function createCasePersonnelMatcher(
  context: Pick<MainIpcContext, 'repository' | 'agentNarrativeStreamer' | 'agentChatModelCatalog'> &
    Partial<Pick<MainIpcContext, 'candidateRetrieval'>>,
  timeoutMs = 45_000
) {
  const { repository, agentNarrativeStreamer: cloud } = context
  const inFlight = new Map<string, Promise<CasePersonnelMatchResult>>()
  /** Local embedding + reranker recall; empty when the local models are unavailable, slow, or fail. */
  const semanticRecall = async (
    job: ReturnType<typeof repository.listActiveJobCases>[number],
    profiles: Parameters<NonNullable<typeof context.candidateRetrieval>['search']>[0],
    signal?: AbortSignal
  ): Promise<string[]> => {
    const retrieval = context.candidateRetrieval
    if (!retrieval || !profiles.length) return []
    const query = job.fields
      .filter((field) => field.value && ['title', 'role', 'required_skills', 'preferred_skills', 'industry'].includes(field.key))
      .map((field) => field.value!)
      .join('\n')
      .slice(0, 2_000)
    if (!query.trim()) return []
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const found = await Promise.race([
        retrieval.search(profiles, query, casePeopleShortlistSize * 2),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('semantic recall timed out')), 20_000)
        })
      ])
      signal?.throwIfAborted()
      return found.map((result) => result.sourceDocumentId)
    } catch (error) {
      if (signal?.aborted) throw error
      console.warn('[case-personnel-semantic-recall] fell back to keyword screening', {
        reason: error instanceof Error ? error.message.slice(0, 120) : 'unknown'
      })
      return []
    } finally {
      clearTimeout(timer)
    }
  }
  const run = async (
    jobCaseId: string,
    options?: {
      signal?: AbortSignal
      onLocal?(result: CasePersonnelMatchResult): void
      documentId?: string
      withoutRules?: boolean
      request?: string
    }
  ): Promise<CasePersonnelMatchResult> => {
    options?.signal?.throwIfAborted()
    const job = repository.listActiveJobCases().find((item) => item.id === jobCaseId)
    if (!job)
      throw new Error('案件不存在、已结束或还没确认，请刷新后重试。 / 案件が存在しないか、終了または未確認です。再読込してください。')
    const library = options?.withoutRules ? emptyWorkRules : (repository.listWorkRules?.() ?? emptyWorkRules)
    const ruleContext = workRuleContext(library, job)
    const locale = effectiveApplicationPreferences(repository).locale
    const target = options?.documentId ? repository.getCandidateProfileForAssessment(options.documentId) : null
    const profiles = options?.documentId ? (target ? [target] : []) : repository.listEligibleTalentProfiles()
    if (options?.documentId && !profiles.length) throw new Error('人员资料不可用。 / 要員情報が利用できません。')
    const decisions = confirmationIndex(repository)
    const evaluations = new Map(
      profiles.map((profile) => [
        profile.sourceDocumentId,
        evaluateWithWorkRules(profile, job, library, undefined, decisions(profile.sourceDocumentId))
      ])
    )
    const toItem = (profile: (typeof profiles)[number]) => {
      const evaluated = evaluations.get(profile.sourceDocumentId)!
      const { score, matched, missing, hardFilters, qualification } = evaluated
      return {
        documentId: profile.sourceDocumentId,
        profileVersion: profile.profileVersion,
        score,
        rulePreference: evaluated.rulePreference,
        matched,
        missing,
        hardFilters,
        qualification,
        appliedRules: evaluated.appliedRules
      }
    }
    // Local screening only recalls; the cloud judges. People with keyword evidence come first. A person is left out
    // locally only for an explicit conflict stated in the resume (language, rate, start date...), never merely because
    // a required skill is worded differently: local semantic recall brings those people to the cloud review.
    const hardConflict = (documentId: string) => evaluations.get(documentId)!.hardFilters.some((filter) => filter.outcome === 'failed')
    const keyword = profiles
      .filter((profile) => options?.documentId || evaluations.get(profile.sourceDocumentId)!.reviewable)
      .map(toItem)
      .toSorted((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId))
    // Without local models (or for a single named person) screening stays synchronous, so local results publish at once.
    const recalled = options?.documentId || !context.candidateRetrieval ? [] : await semanticRecall(job, profiles, options?.signal)
    const included = new Set(keyword.map((item) => item.documentId))
    const semantic = recalled
      .filter((documentId) => !included.has(documentId) && !hardConflict(documentId))
      .flatMap((documentId) => {
        const profile = profiles.find((item) => item.sourceDocumentId === documentId)
        return profile ? [toItem(profile)] : []
      })
    let local = [...keyword, ...semantic]
    const snapshots = new Map(
      profiles.map((profile) => {
        const input = matchingExperienceInput(profile, job, locale, library)
        input.context = experienceContext(repository, job.fields, locale)
        input.hardFilters = evaluations
          .get(profile.sourceDocumentId)!
          .hardFilters.map((filter) => ({ requirement: filter.requested, actual: filter.actual, outcome: filter.outcome }))
        return [profile.sourceDocumentId, input]
      })
    )
    local = applyLearnedRanking(repository, local, (item) => item.documentId, snapshots, !options?.withoutRules)
    const result: CasePersonnelMatchResult = {
      jobCaseId,
      jobCaseVersion: job.version,
      rulesRevision: library.revision,
      localMatchCount: local.length,
      ownCompanyExcludedCount: 0,
      searchedCount: profiles.length,
      ...exclusionSummary([...evaluations.values()]),
      items: local.slice(0, casePeopleShortlistSize),
      semanticRecallCount: semantic.length,
      cloud: { status: local.length ? 'unavailable' : 'not-needed', reviewedCount: 0, modelName: null }
    }
    const bundle = experienceBundle(
      repository,
      'matching',
      [...job.fields.flatMap((f) => (f.value ? [{ key: f.key, label: f.label, value: f.value }] : [])), ...ruleContext.extraFields],
      experienceContext(repository, job.fields, locale)
    )
    const finish = () => {
      result.items = applyLearnedRanking(repository, result.items, (item) => item.documentId, snapshots, !options?.withoutRules)
      if (!options?.withoutRules && repository.saveExperienceRun)
        result.items = result.items.map((item) => ({
          ...item,
          experienceRunId: repository.saveExperienceRun({
            documentId: item.documentId,
            reviewId: job.sourceReviewId,
            interviewId: null,
            profileVersion: item.profileVersion,
            jobCaseVersion: job.version,
            rulesRevision: library.revision,
            input: snapshots.get(item.documentId)!,
            output: item,
            bundle: withRankingRefs(item.assessment ? bundle : { ...bundle, refs: [] }, item.ranking),
            modelKey: item.assessment?.modelKey ?? null
          })
        }))
      return visible()
    }
    const visible = () => ({
      ...result,
      // HR's 不满足 keeps a person listed, marked and last; other exclusions are left out.
      items: result.items.filter(
        (item) => options?.documentId || item.qualification?.status !== 'excluded' || excludedByHr(item.qualification)
      )
    })
    options?.onLocal?.(structuredClone(visible()))
    if (!result.items.length || !cloud?.assessMatchCandidates) {
      if (result.items.length) result.cloud.reason = 'service-unavailable'
      return finish()
    }
    const model = businessModel(context, 'checking')
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
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const started = performance.now()
    try {
      const response = await Promise.race([
        cancelled,
        cloud.assessMatchCandidates({
          conversationId: randomUUID(),
          requestId: randomUUID(),
          locale: effectiveApplicationPreferences(repository).locale,
          model,
          signal: controller.signal,
          onClientRequestId: (id) => {
            remoteId = id
            if (controller.signal.aborted) void cloud.cancel(id).catch(() => undefined)
          },
          onRemoteSettled: () => {
            settled = true
          },
          ...(options?.documentId && options.request ? { operatorRequest: options.request } : {}),
          jobCase: {
            title: job.fields.find((field) => field.key === 'title')?.value ?? null,
            experienceSkills: bundle.instructions,
            workRules: ruleContext.applied,
            requirements: [
              ...job.fields.flatMap((field) =>
                field.value && requirementKeys.has(field.key) ? [{ key: field.key, label: field.label, value: field.value }] : []
              ),
              ...ruleContext.extraFields
            ]
          },
          candidates: result.items.map((item, index) => {
            const profile = profiles.find((profile) => profile.sourceDocumentId === item.documentId)!
            return {
              label: `CANDIDATE_${index + 1}`,
              hardFilters: item.hardFilters.map((filter) => ({
                requirement: filter.requested,
                actual: filter.actual,
                outcome: filter.outcome
              })),
              facts: profile.fields.flatMap((field) => (field.value ? [{ label: field.label, value: field.value }] : [])),
              projects: profile.projectExperiences.map(({ title, period, role, technologies, summary }) => ({
                title,
                period,
                role,
                technologies,
                summary
              }))
            }
          })
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort()
            reject(new Error('Case personnel assessment timed out.'))
          }, timeoutMs)
        })
      ])
      const assessedAt = new Date().toISOString()
      result.items = result.items.map((item, index) => {
        const verdict = response.assessments.find((entry) => entry.candidate === `CANDIDATE_${index + 1}`)
        if (!verdict) return item
        const evaluated = evaluateWithWorkRules(
          profiles.find((profile) => profile.sourceDocumentId === item.documentId)!,
          job,
          library,
          verdict,
          decisions(item.documentId)
        )
        evaluations.set(item.documentId, evaluated)
        if (process.env.SES_MATCH_DEBUG === '1')
          console.info(
            '[match-debug] verdict-applied',
            JSON.stringify({
              candidate: verdict.candidate,
              modelFit: verdict.fit,
              modelMet: verdict.met,
              modelRequirements: verdict.requirements ?? null,
              status: evaluated.qualification.status,
              requirements: evaluated.qualification.requirements.map((entry) => ({
                label: entry.requirement.label,
                semanticReview: entry.requirement.requiresSemanticReview ?? false,
                outcome: entry.outcome,
                aiVerified: entry.aiVerified ?? false,
                evidence: entry.evidence
              }))
            })
          )
        return {
          ...item,
          score: evaluated.score,
          rulePreference: evaluated.rulePreference,
          qualification: evaluated.qualification,
          matched: evaluated.matched,
          missing: evaluated.missing,
          assessment: {
            version: 'match-assessment-v1',
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
      const count = result.items.filter((item) => item.assessment).length
      result.cloud = {
        status: count === result.items.length ? 'reviewed' : count ? 'partial' : 'failed',
        reviewedCount: count,
        modelName: count ? model.displayName : null,
        ...(count !== result.items.length ? { reason: 'no-valid-result' as const } : {})
      }
    } catch (error) {
      // Local diagnostics only: the error name and a bounded message, never request content.
      console.warn('[cloud-assessment-failed]', {
        reason: (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 200)
      })
      result.cloud = { status: 'failed', reason: cloudFailureReason(error), reviewedCount: 0, modelName: null }
    } finally {
      clearTimeout(timeout)
      removeAbort()
      options?.signal?.removeEventListener('abort', abort)
      if (controller.signal.aborted && remoteId && !settled) void cloud.cancel(remoteId).catch(() => undefined)
      console.info('[case-personnel-assessment]', {
        status: result.cloud.status,
        reviewedCount: result.cloud.reviewedCount,
        localCount: local.length,
        durationMs: Math.round(performance.now() - started)
      })
    }
    if (options?.signal?.aborted) throw new Error('已停止匹配。 / マッチングを停止しました。')
    const currentJob = repository.listActiveJobCases().find((item) => item.id === jobCaseId)
    if (!currentJob || currentJob.version !== job.version)
      throw new Error('案件已更新，请重新找人。 / 案件が更新されました。再検索してください。')
    if (!options?.withoutRules && (repository.listWorkRules?.().revision ?? 0) !== library.revision)
      throw new Error('AI 规则已更新，请重新评估。 / AIルールが更新されました。再評価してください。')
    const currentProfiles = new Map(
      (options?.documentId
        ? [repository.getCandidateProfileForAssessment(options.documentId)].filter((p): p is NonNullable<typeof p> => p !== null)
        : repository.listEligibleTalentProfiles()
      ).map((profile) => [profile.sourceDocumentId, profile.profileVersion])
    )
    result.items = result.items
      .filter((item) => currentProfiles.get(item.documentId) === item.profileVersion)
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
    options?: {
      signal?: AbortSignal
      onLocal?(result: CasePersonnelMatchResult): void
      documentId?: string
      withoutRules?: boolean
      request?: string
    }
  ): Promise<CasePersonnelMatchResult> => {
    const id = candidateProfileSourceInputSchema.parse(raw)
    const key = `${id}:${options?.documentId ?? ''}:${options?.withoutRules ?? false}:${options?.request ?? ''}:${repository.listWorkRules?.().revision ?? 0}`
    const pending = inFlight.get(key)
    if (pending) return pending
    const promise = withLearningForeground(() => run(id, options)).finally(() => inFlight.delete(key))
    inFlight.set(key, promise)
    return promise
  }
}
