import { createHash } from 'node:crypto'
import { businessMatchingPolicyVersion } from '@shared'
import type { MainIpcContext } from './ipc/context'
import { evaluateWithWorkRules } from './work-rule-matching'
import { experienceContext, matchingExperienceInput } from './experience-context'
import { applyLearnedRanking } from './experience-ranking'
import { isLearningForegroundBusy } from './learning-activity'
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
/** Local, incremental discovery; detailed cloud assessment remains attached to opening a match. */
export function createOpportunityDiscovery({ repository }: Pick<MainIpcContext, 'repository'>) {
  let running = false
  return async (signal?: AbortSignal) => {
    if (running) return
    running = true
    try {
      const states = repository.getPersonnelWorkspace().states,
        unavailable = new Set(states.filter((s) => !['available', 'soon'].includes(s.status)).map((s) => s.documentId))
      const people = repository.listEligibleTalentProfiles().filter((p) => !unavailable.has(p.sourceDocumentId)),
        cases = repository.listActiveJobCases(),
        rules = repository.listWorkRules(),
        locale = repository.getLocalApplicationPreferences()?.locale ?? 'ja-JP'
      const follow = repository.listBusinessFollowUps(),
        busy = new Set(follow.filter((f) => f.status !== 'closed').map((f) => `${f.documentId}:${f.reviewId}`))
      const common = hash([
        businessMatchingPolicyVersion,
        locale,
        people.map((p) => [p.sourceDocumentId, p.profileVersion]),
        rules.revision,
        states,
        repository.listCustomerIdentities(),
        repository.getActiveSystemExperiences().map((s) => [s.id, s.version]),
        new Date().toISOString().slice(0, 10)
      ])
      let completed = 0
      for (const job of cases) {
        signal?.throwIfAborted()
        const signature = hash([common, job.version, job.id, follow.map((f) => [f.documentId, f.reviewId, f.status])]),
          key = `opportunities:${job.sourceReviewId}`
        if (repository.getGrowthCheckpoint(key) === signature) continue
        const snapshots = new Map(
          people.map((p) => [
            p.sourceDocumentId,
            { ...matchingExperienceInput(p, job, locale, rules), context: experienceContext(repository, job.fields, locale) }
          ])
        )
        const matched = []
        for (let index = 0; index < people.length; index++) {
          const person = people[index]!,
            evaluation = evaluateWithWorkRules(person, job, rules)
          if (
            evaluation.reviewable &&
            evaluation.qualification.status !== 'excluded' &&
            evaluation.matched.length &&
            !busy.has(`${person.sourceDocumentId}:${job.sourceReviewId}`)
          )
            matched.push({ person, ...evaluation, ranking: undefined as import('@shared').RankingAdjustment | undefined })
          if (index % 50 === 0) {
            await new Promise<void>((resolve) => setImmediate(resolve))
            signal?.throwIfAborted()
          }
        }
        const ranked = applyLearnedRanking(repository, matched, (p) => p.person.sourceDocumentId, snapshots).slice(0, 5)
        const items = ranked.map((item) => ({
          documentId: item.person.sourceDocumentId,
          reviewId: job.sourceReviewId,
          jobCaseId: job.id,
          profileVersion: item.person.profileVersion,
          jobCaseVersion: job.version,
          rulesRevision: rules.revision,
          personName: item.person.localPersonalDetails.displayName ?? '人员 / 要員',
          caseTitle: job.fields.find((f) => f.key === 'title')?.value ?? '案件',
          score: item.score ?? 0,
          reasons: item.matched,
          confirm: [...new Set([...item.missing, ...item.confirm])].slice(0, 8),
          fingerprint: hash([
            businessMatchingPolicyVersion,
            item.person.sourceDocumentId,
            item.person.profileVersion,
            job.id,
            job.version,
            rules.revision,
            item.matched,
            item.missing,
            item.ranking?.reasons.map((r) => r.experience)
          ])
        }))
        signal?.throwIfAborted()
        repository.saveMatchingOpportunities(job.sourceReviewId, items)
        repository.saveGrowthCheckpoint(key, signature)
        if (++completed >= 5) break
      }
    } finally {
      running = false
    }
  }
}
export function startOpportunityDiscovery(context: Pick<MainIpcContext, 'repository'>, idleSeconds: () => number) {
  const tick = createOpportunityDiscovery(context)
  let active: AbortController | null = null,
    running = false
  const timer = setInterval(() => {
    if (idleSeconds() < 5 || isLearningForegroundBusy()) {
      active?.abort()
      return
    }
    if (running) return
    active = new AbortController()
    running = true
    void tick(active.signal)
      .catch(() => undefined)
      .finally(() => {
        running = false
      })
  }, 15000)
  timer.unref()
  return () => {
    clearInterval(timer)
    active?.abort()
  }
}
