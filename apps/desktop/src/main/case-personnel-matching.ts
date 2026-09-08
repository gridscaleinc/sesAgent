import { randomUUID } from 'node:crypto'
import { defaultAgentChatModelKey, resolveAgentChatModel } from '@agent'
import { candidateBenchmarkQueryFromJobCase } from '@job-cases'
import { scorableCandidateSearchTerms, searchConfirmedCandidateProfiles } from '@resume'
import { candidateProfileSourceInputSchema, type CasePersonnelMatchResult } from '@shared'
import { effectiveApplicationPreferences } from './app-defaults'
import { matchAssessmentShortlistSize } from './agent-cloud-narrative'
import type { MainIpcContext } from './ipc/context'

const requirementKeys = new Set(['required_skills', 'preferred_skills', 'role', 'japanese_level', 'rate', 'start_date', 'remote', 'location', 'work_authorization', 'industry', 'notes'])
const fitRank = { strong: 0, possible: 1, 'insufficient-info': 3, weak: 4 }

/** The case-to-person counterpart of personnel-case-matching: one bounded batch. */
export function createCasePersonnelMatcher(context: Pick<MainIpcContext, 'repository' | 'agentNarrativeStreamer' | 'agentChatModelCatalog'>, timeoutMs = 45_000) {
  const { repository, agentNarrativeStreamer: cloud } = context
  const inFlight = new Map<string, Promise<CasePersonnelMatchResult>>()
  const run = async (jobCaseId: string): Promise<CasePersonnelMatchResult> => {
    const job = repository.listActiveJobCases().find((item) => item.id === jobCaseId)
    if (!job) throw new Error('案件不存在或已停用，请刷新后重试。 / 案件が存在しないか停止されています。再読込してください。')
    const profiles = repository.listEligibleTalentProfiles()
    const coreTerms = scorableCandidateSearchTerms(job.fields.filter((field) => ['required_skills', 'role'].includes(field.key)).map((field) => field.value ?? '').join(' '))
    const core = coreTerms.length ? profiles.flatMap((profile) => searchConfirmedCandidateProfiles([profile], coreTerms.join(' '), 1)).filter((item) => item.matchedTerms.length) : []
    const allowed = new Map(profiles.flatMap((profile) => searchConfirmedCandidateProfiles([profile], candidateBenchmarkQueryFromJobCase(job), 1)).map((item) => [item.sourceDocumentId, item]))
    const local = core.flatMap((item) => {
      const conditions = allowed.get(item.sourceDocumentId)
      const profile = profiles.find((profile) => profile.sourceDocumentId === item.sourceDocumentId)
      if (!conditions || !profile) return []
      return [{ documentId: profile.sourceDocumentId, profileVersion: profile.profileVersion, score: item.matchScore,
        matched: item.matchedTerms, missing: coreTerms.filter((term) => !item.matchedTerms.includes(term)), hardFilters: conditions.retrieval.hardFilters }]
    }).toSorted((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.documentId.localeCompare(b.documentId))
    const result: CasePersonnelMatchResult = { jobCaseId, jobCaseVersion: job.version, localMatchCount: local.length,
      items: local.slice(0, matchAssessmentShortlistSize), cloud: { status: local.length ? 'unavailable' : 'not-needed', reviewedCount: 0, modelName: null } }
    if (!result.items.length || !cloud?.assessMatchCandidates) return result
    const model = resolveAgentChatModel(context.agentChatModelCatalog, defaultAgentChatModelKey)
    const controller = new AbortController()
    let remoteId: string | null = null
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const started = performance.now()
    try {
      const response = await Promise.race([
        cloud.assessMatchCandidates({ conversationId: randomUUID(), requestId: randomUUID(), locale: effectiveApplicationPreferences(repository).locale,
          model, signal: controller.signal,
          onClientRequestId: (id) => { remoteId = id; if (controller.signal.aborted) void cloud.cancel(id).catch(() => undefined) },
          onRemoteSettled: () => { settled = true },
          jobCase: { title: job.fields.find((field) => field.key === 'title')?.value ?? null,
            requirements: job.fields.flatMap((field) => field.value && requirementKeys.has(field.key) ? [{ key: field.key, label: field.label, value: field.value }] : []) },
          candidates: result.items.map((item, index) => {
            const profile = profiles.find((profile) => profile.sourceDocumentId === item.documentId)!
            return { label: `CANDIDATE_${index + 1}`,
              hardFilters: item.hardFilters.map((filter) => ({ requirement: filter.requested, actual: filter.actual, outcome: filter.outcome })),
              facts: profile.fields.flatMap((field) => field.value ? [{ label: field.label, value: field.value }] : []),
              projects: profile.projectExperiences.map(({ title, period, role, technologies, summary }) => ({ title, period, role, technologies, summary })) }
          }) }),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('Case personnel assessment timed out.')) }, timeoutMs) })
      ])
      const assessedAt = new Date().toISOString()
      result.items = result.items.map((item, index) => {
        const verdict = response.assessments.find((entry) => entry.candidate === `CANDIDATE_${index + 1}`)
        if (!verdict) return item
        const unknown = item.hardFilters.filter((filter) => filter.outcome === 'unknown').map((filter) => filter.requested)
        const unsupported = !verdict.met.length && ['strong', 'possible'].includes(verdict.fit)
        return { ...item, assessment: { version: 'match-assessment-v1',
          fit: unsupported ? 'insufficient-info' : unknown.length && verdict.fit === 'strong' ? 'possible' : verdict.fit,
          met: verdict.met, gaps: verdict.gaps, confirm: [...new Set([...unknown, ...verdict.confirm])].slice(0, 8), reason: unsupported ? '' : verdict.reason,
          modelKey: model.key, assessedAt } }
      })
      const count = result.items.filter((item) => item.assessment).length
      result.cloud = { status: count === result.items.length ? 'reviewed' : count ? 'partial' : 'failed', reviewedCount: count, modelName: count ? model.displayName : null }
    } catch { result.cloud = { status: 'failed', reviewedCount: 0, modelName: null } }
    finally {
      clearTimeout(timeout)
      if (controller.signal.aborted && remoteId && !settled) void cloud.cancel(remoteId).catch(() => undefined)
      console.info('[case-personnel-assessment]', { status: result.cloud.status, reviewedCount: result.cloud.reviewedCount, localCount: local.length, durationMs: Math.round(performance.now() - started) })
    }
    const currentJob = repository.listActiveJobCases().find((item) => item.id === jobCaseId)
    if (!currentJob || currentJob.version !== job.version) throw new Error('案件已更新，请重新找人。 / 案件が更新されました。再検索してください。')
    const currentProfiles = new Map(repository.listEligibleTalentProfiles().map((profile) => [profile.sourceDocumentId, profile.profileVersion]))
    result.items = result.items.filter((item) => currentProfiles.get(item.documentId) === item.profileVersion)
      .toSorted((a, b) => (a.assessment ? fitRank[a.assessment.fit] : 2) - (b.assessment ? fitRank[b.assessment.fit] : 2) || (b.score ?? 0) - (a.score ?? 0))
    result.cloud.reviewedCount = result.items.filter((item) => item.assessment).length
    return result
  }
  return (raw: unknown): Promise<CasePersonnelMatchResult> => {
    const id = candidateProfileSourceInputSchema.parse(raw)
    const pending = inFlight.get(id)
    if (pending) return pending
    const promise = run(id).finally(() => inFlight.delete(id))
    inFlight.set(id, promise)
    return promise
  }
}
