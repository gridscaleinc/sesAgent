import { randomUUID } from 'node:crypto'
import { defaultAgentChatModelKey, resolveAgentChatModel } from '@agent'
import { candidateBenchmarkQueryFromJobCase } from '@job-cases'
import { candidateSearchTerms, scorableCandidateSearchTerms, searchConfirmedCandidateProfiles } from '@resume'
import { candidateProfileSourceInputSchema, type PersonnelCaseMatch, type PersonnelCaseMatchResult } from '@shared'
import { effectiveApplicationPreferences } from './app-defaults'
import { matchAssessmentShortlistSize } from './agent-cloud-narrative'
import type { MainIpcContext } from './ipc/context'

const requirementKeys = new Set(['required_skills', 'preferred_skills', 'role', 'japanese_level', 'rate', 'start_date', 'remote', 'location', 'work_authorization', 'industry', 'notes'])
const fitRank = { strong: 0, possible: 1, 'insufficient-info': 3, weak: 4 }

/** One bounded cloud batch per click, with an honest local fallback. */
export function createPersonnelCaseMatcher(context: Pick<MainIpcContext, 'repository' | 'agentNarrativeStreamer' | 'agentChatModelCatalog'>, timeoutMs = 45_000) {
  const inFlight = new Map<string, Promise<PersonnelCaseMatchResult>>()
  const { repository, agentNarrativeStreamer: cloud } = context
  const run = async (documentId: string): Promise<PersonnelCaseMatchResult> => {
    const profile = repository.listEligibleTalentProfiles().find((item) => item.sourceDocumentId === documentId)
    if (!profile) throw new Error('人员资料不存在或已停用，请刷新后重试。 / 要員情報が存在しないか停止されています。再読込してください。')
    const activeCases = repository.listActiveJobCases()
    const local = activeCases.flatMap((jobCase): PersonnelCaseMatch[] => {
      const coreQuery = jobCase.fields.filter((field) => ['required_skills', 'role'].includes(field.key)).map((field) => field.value ?? '').join(' ')
      const coreTerms = scorableCandidateSearchTerms(coreQuery)
      if (!coreTerms.length) return []
      const core = searchConfirmedCandidateProfiles([profile], coreTerms.join(' '), 1)[0]
      // A matching start date or location alone cannot put a case on the shortlist.
      if (!core?.matchedTerms.length) return []
      const result = searchConfirmedCandidateProfiles([profile], candidateBenchmarkQueryFromJobCase(jobCase), 1)[0]
      if (!result) return []
      return [{ reviewId: jobCase.sourceReviewId, jobCaseId: jobCase.id, jobCaseVersion: jobCase.version,
        title: jobCase.fields.find((field) => field.key === 'title')?.value ?? '案件', score: core.matchScore,
        matched: core.matchedTerms, missing: candidateSearchTerms(coreQuery).filter((term) => !core.matchedTerms.includes(term)),
        hardFilters: result.retrieval.hardFilters }]
    }).toSorted((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.jobCaseId.localeCompare(b.jobCaseId))
    let items = local.slice(0, matchAssessmentShortlistSize)
    const result: PersonnelCaseMatchResult = { documentId, profileVersion: profile.profileVersion, items,
      localMatchCount: local.length, cloud: { status: items.length ? 'unavailable' : 'not-needed', reviewedCount: 0, modelName: null } }
    if (!items.length || !cloud?.assessPersonnelCases) return result
    const model = resolveAgentChatModel(context.agentChatModelCatalog, defaultAgentChatModelKey)
    const controller = new AbortController()
    let remoteId: string | null = null
    let remoteSettled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const started = performance.now()
    const locale = effectiveApplicationPreferences(repository).locale
    try {
      const assessment = await Promise.race([
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
        const unknown = item.hardFilters.filter((filter) => filter.outcome === 'unknown').map((filter) => filter.requested)
        return { ...item, assessment: { version: 'match-assessment-v1' as const,
          fit: unknown.length && verdict.fit === 'strong' ? 'possible' as const : verdict.fit,
          met: verdict.met, gaps: verdict.gaps, confirm: [...new Set([...unknown, ...verdict.confirm])].slice(0, 8), reason: verdict.reason,
          modelKey: model.key, assessedAt } }
      })
      const reviewedCount = items.filter((item) => item.assessment).length
      result.cloud = { status: reviewedCount === items.length ? 'reviewed' : reviewedCount ? 'partial' : 'failed', reviewedCount, modelName: reviewedCount ? model.displayName : null }
    } catch {
      result.cloud = { status: 'failed', reviewedCount: 0, modelName: null }
    } finally {
      clearTimeout(timeout)
      if (controller.signal.aborted && remoteId && !remoteSettled) void cloud.cancel(remoteId).catch(() => undefined)
      console.info('[personnel-case-assessment]', { status: result.cloud.status, locale, reviewedCount: result.cloud.reviewedCount, localCount: local.length, durationMs: Math.round(performance.now() - started) })
    }
    // Never attach an old assessment to a profile or case edited during the request.
    const current = repository.listEligibleTalentProfiles().find((item) => item.sourceDocumentId === documentId)
    if (!current || current.profileVersion !== profile.profileVersion) throw new Error('人员资料已更新，请重新找案件。 / 要員情報が更新されました。再検索してください。')
    const currentCases = new Map(repository.listActiveJobCases().map((item) => [item.id, item.version]))
    result.items = items.filter((item) => currentCases.get(item.jobCaseId) === item.jobCaseVersion)
      .toSorted((a, b) => (a.assessment ? fitRank[a.assessment.fit] : 2) - (b.assessment ? fitRank[b.assessment.fit] : 2) || (b.score ?? 0) - (a.score ?? 0))
    result.cloud.reviewedCount = result.items.filter((item) => item.assessment).length
    return result
  }
  return (raw: unknown): Promise<PersonnelCaseMatchResult> => {
    const documentId = candidateProfileSourceInputSchema.parse(raw)
    const pending = inFlight.get(documentId)
    if (pending) return pending
    const promise = run(documentId).finally(() => inFlight.delete(documentId))
    inFlight.set(documentId, promise)
    return promise
  }
}
