import { randomUUID } from 'node:crypto'
import { defaultAgentChatModelKey, resolveAgentChatModel } from '@agent'
import { candidateBenchmarkQueryFromJobCase } from '@job-cases'
import { requiresOwnCompany, candidateProfileSourceInputSchema, type PersonnelCaseMatch, type PersonnelCaseMatchResult } from '@shared'
import { effectiveApplicationPreferences } from './app-defaults'
import { matchAssessmentShortlistSize } from './agent-cloud-narrative'
import type { MainIpcContext } from './ipc/context'
import { applyBusinessVerdict, evaluateBusinessMatch, exclusionSummary } from './business-matching-policy'

const requirementKeys = new Set(['required_skills', 'preferred_skills', 'role', 'japanese_level', 'rate', 'start_date', 'remote', 'location', 'work_authorization', 'industry', 'notes'])
const fitRank = { strong: 0, possible: 1, 'insufficient-info': 3, weak: 4 }

/** One bounded cloud batch per click, with an honest local fallback. */
export function createPersonnelCaseMatcher(context: Pick<MainIpcContext, 'repository' | 'agentNarrativeStreamer' | 'agentChatModelCatalog'>, timeoutMs = 45_000) {
  const inFlight = new Map<string, Promise<PersonnelCaseMatchResult>>()
  const { repository, agentNarrativeStreamer: cloud } = context
  const run = async (documentId: string, options?: { signal?: AbortSignal; onLocal?(result: PersonnelCaseMatchResult): void }): Promise<PersonnelCaseMatchResult> => {
    options?.signal?.throwIfAborted()
    const profile = repository.listEligibleTalentProfiles().find((item) => item.sourceDocumentId === documentId)
    if (!profile) throw new Error('人员资料不存在或已停用，请刷新后重试。 / 要員情報が存在しないか停止されています。再読込してください。')
    const activeCases = repository.listActiveJobCases()
    const evaluations = new Map(activeCases.map((job) => [job.id, evaluateBusinessMatch(profile, job)]))
    const local = activeCases.flatMap((jobCase): PersonnelCaseMatch[] => {
      const evaluated = evaluations.get(jobCase.id)!
      if (!evaluated.reviewable) return []
      return [{ reviewId: jobCase.sourceReviewId, jobCaseId: jobCase.id, jobCaseVersion: jobCase.version,
        title: jobCase.fields.find((field) => field.key === 'title')?.value ?? '案件', score: evaluated.score,
        matched: evaluated.matched, missing: evaluated.missing, hardFilters: evaluated.hardFilters, qualification: evaluated.qualification }]
    }).toSorted((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.jobCaseId.localeCompare(b.jobCaseId))
    let items = local.slice(0, matchAssessmentShortlistSize)
    const result: PersonnelCaseMatchResult = { documentId, profileVersion: profile.profileVersion, items,
      searchedCount: activeCases.length, ...exclusionSummary([...evaluations.values()]),
      localMatchCount: local.length, ownCompanyExcludedCount: profile.isOwnCompany === true ? 0 : activeCases.filter((job) => requiresOwnCompany(candidateBenchmarkQueryFromJobCase(job))).length, cloud: { status: items.length ? 'unavailable' : 'not-needed', reviewedCount: 0, modelName: null } }
    const visible = () => ({ ...result, items: result.items.filter((item) => item.qualification?.status !== 'excluded') })
    options?.onLocal?.(structuredClone(visible()))
    if (!items.length || !cloud?.assessPersonnelCases) return visible()
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
    const locale = effectiveApplicationPreferences(repository).locale
    try {
      const assessment = await Promise.race([
        cancelled,
        cloud.assessPersonnelCases({
          conversationId: randomUUID(), requestId: randomUUID(), locale,
          model, signal: controller.signal,
          onClientRequestId: (id) => { remoteId = id; if (controller.signal.aborted) void cloud.cancel(id).catch(() => undefined) },
          onRemoteSettled: () => { remoteSettled = true },
          person: { facts: profile.fields.flatMap((field) => field.value ? [{ label: field.label, value: field.value }] : []),
            projects: profile.projectExperiences.map(({ title, period, role, technologies, summary }) => ({ title, period, role, technologies, summary })) },
          cases: items.map((item, index) => {
            const job = activeCases.find((candidate) => candidate.id === item.jobCaseId)!
            return { label: `CASE_${index + 1}`, title: item.title,
              requirements: job.fields.flatMap((field) => field.value && requirementKeys.has(field.key) ? [{ key: field.key, label: field.label, value: field.value }] : []),
              hardFilters: item.hardFilters.map((filter) => ({ requirement: filter.requested, actual: filter.actual, outcome: filter.outcome })) }
          })
        }),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('Personnel case assessment timed out.')) }, timeoutMs) })
      ])
      const assessedAt = new Date().toISOString()
      items = items.map((item, index) => {
        const verdict = assessment.assessments.find((entry) => entry.candidate === `CASE_${index + 1}`)
        if (!verdict) return item
        const evaluated = applyBusinessVerdict(profile, activeCases.find((job) => job.id === item.jobCaseId)!, verdict)
        evaluations.set(item.jobCaseId, evaluated)
        return { ...item, qualification: evaluated.qualification, matched: evaluated.matched, missing: evaluated.missing, assessment: { version: 'match-assessment-v1' as const,
          fit: evaluated.fit, met: evaluated.met, gaps: [], confirm: evaluated.confirm, reason: evaluated.qualification.status === 'excluded' ? '' : verdict.reason,
          modelKey: model.key, assessedAt } }
      })
      const reviewedCount = items.filter((item) => item.assessment).length
      result.cloud = { status: reviewedCount === items.length ? 'reviewed' : reviewedCount ? 'partial' : 'failed', reviewedCount, modelName: reviewedCount ? model.displayName : null }
    } catch {
      result.cloud = { status: 'failed', reviewedCount: 0, modelName: null }
    } finally {
      clearTimeout(timeout)
      removeAbort(); options?.signal?.removeEventListener('abort', abort)
      if (controller.signal.aborted && remoteId && !remoteSettled) void cloud.cancel(remoteId).catch(() => undefined)
      console.info('[personnel-case-assessment]', { status: result.cloud.status, locale, reviewedCount: result.cloud.reviewedCount, localCount: local.length, durationMs: Math.round(performance.now() - started) })
    }
    if (options?.signal?.aborted) throw new Error('已停止匹配。 / マッチングを停止しました。')
    // Never attach an old assessment to a profile or case edited during the request.
    const current = repository.listEligibleTalentProfiles().find((item) => item.sourceDocumentId === documentId)
    if (!current || current.profileVersion !== profile.profileVersion) throw new Error('人员资料已更新，请重新找案件。 / 要員情報が更新されました。再検索してください。')
    const currentCases = new Map(repository.listActiveJobCases().map((item) => [item.id, item.version]))
    result.items = items.filter((item) => currentCases.get(item.jobCaseId) === item.jobCaseVersion)
      .toSorted((a, b) => Number(b.qualification?.status === 'recommended') - Number(a.qualification?.status === 'recommended') || (a.assessment ? fitRank[a.assessment.fit] : 2) - (b.assessment ? fitRank[b.assessment.fit] : 2) || (b.score ?? 0) - (a.score ?? 0))
    result.cloud.reviewedCount = result.items.filter((item) => item.assessment).length
    Object.assign(result, exclusionSummary([...evaluations.values()]))
    return visible()
  }
  return (raw: unknown, options?: { signal?: AbortSignal; onLocal?(result: PersonnelCaseMatchResult): void }): Promise<PersonnelCaseMatchResult> => {
    const documentId = candidateProfileSourceInputSchema.parse(raw)
    const pending = inFlight.get(documentId)
    if (pending) return pending
    const promise = run(documentId, options).finally(() => inFlight.delete(documentId))
    inFlight.set(documentId, promise)
    return promise
  }
}
