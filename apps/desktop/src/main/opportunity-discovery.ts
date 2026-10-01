import { createHash } from 'node:crypto'
import {
  businessMatchingPolicyVersion,
  excludedByHr,
  isProposalRequirement,
  requirementDisplayLabel,
  type MatchingOpportunity,
  type RankingAdjustment,
  tokyoDateKey
} from '@shared'
import type { MainIpcContext } from './ipc/context'
import { confirmationIndex, confirmationSignature, evaluateWithWorkRules } from './work-rule-matching'
import { experienceContext, matchingExperienceInput } from './experience-context'
import { applyLearnedRanking } from './experience-ranking'
import { isLearningForegroundBusy } from './learning-activity'
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
/** Part of every case checkpoint and item fingerprint: bumping it regenerates stored opportunities once. */
export const OPPORTUNITY_DISCOVERY_SCHEMA = 'opportunity-discovery-v2'
/** A full pass runs at most this often. */
export const OPPORTUNITY_DISCOVERY_INTERVAL_MS = 15 * 60_000
/** How often the scheduler asks whether a pass is due. */
export const OPPORTUNITY_DISCOVERY_CHECK_MS = 60_000
/** The first check after startup, so a fresh launch does not wait a full check period. */
export const OPPORTUNITY_DISCOVERY_FIRST_CHECK_MS = 10_000
/** While a pass runs, activity is checked this often so it yields to the operator quickly. */
export const OPPORTUNITY_DISCOVERY_ACTIVITY_MS = 2_000
export const OPPORTUNITY_DISCOVERY_IDLE_SECONDS = 5

export interface OpportunityScheduleInput {
  now: number
  /** When the last pass finished without being aborted; null before the first one. */
  lastCompletedAt: number | null
  idleSeconds: number
  /** Learning is working in the foreground. */
  busy: boolean
  running: boolean
}
/**
 * Whether a check should start a pass. An aborted pass never records a completion,
 * so it is retried at the next idle check instead of waiting another interval.
 */
export function shouldStartOpportunityPass(input: OpportunityScheduleInput): boolean {
  if (input.running || input.busy || input.idleSeconds < OPPORTUNITY_DISCOVERY_IDLE_SECONDS) return false
  return input.lastCompletedAt === null || input.now - input.lastCompletedAt >= OPPORTUNITY_DISCOVERY_INTERVAL_MS
}
type DiscoveredPair = Pick<ReturnType<typeof evaluateWithWorkRules>, 'qualification' | 'matched' | 'missing' | 'score'> & {
  person: { sourceDocumentId: string; profileVersion: number; localPersonalDetails: { displayName?: string | null } }
  ranking?: RankingAdjustment
}
/** One stored opportunity row for a person and case; HR decisions show through the qualification. */
export function opportunityItem(
  job: { id: string; version: number; sourceReviewId: string; fields: ReadonlyArray<{ key: string; value: string | null }> },
  item: DiscoveredPair,
  rulesRevision: number,
  zh: boolean
): Omit<MatchingOpportunity, 'id' | 'state' | 'updatedAt'> {
  const status =
    item.qualification.status === 'recommended'
      ? ('recommended' as const)
      : item.qualification.status === 'excluded'
        ? ('not-suitable' as const)
        : ('needs-confirmation' as const)
  // Only unmet core requirements; rate, location, remote, start and contract terms wait for the full assessment.
  const confirm = [
    ...new Set(
      item.qualification.requirements
        .filter((entry) => isProposalRequirement(entry.requirement) && entry.outcome !== 'met')
        .map((entry) => requirementDisplayLabel(entry.requirement, zh))
    )
  ].slice(0, 8)
  return {
    documentId: item.person.sourceDocumentId,
    reviewId: job.sourceReviewId,
    jobCaseId: job.id,
    profileVersion: item.person.profileVersion,
    jobCaseVersion: job.version,
    rulesRevision,
    personName: item.person.localPersonalDetails.displayName ?? '人员 / 要員',
    caseTitle: job.fields.find((f) => f.key === 'title')?.value ?? '案件',
    score: item.score ?? 0,
    status,
    reasons: item.matched,
    confirm,
    fingerprint: hash([
      OPPORTUNITY_DISCOVERY_SCHEMA,
      businessMatchingPolicyVersion,
      item.person.sourceDocumentId,
      item.person.profileVersion,
      job.id,
      job.version,
      rulesRevision,
      item.matched,
      item.missing,
      status,
      confirm,
      item.ranking?.reasons.map((r) => r.experience)
    ])
  }
}
/** Local, incremental discovery; detailed cloud assessment remains attached to opening a match. */
export function createOpportunityDiscovery({ repository }: Pick<MainIpcContext, 'repository'>) {
  let running = false
  // Cases already ranked today in this process. The day forces one fresh ranking per day (start dates and the like
  // read against today), but it is not stored: a pass that changes nothing writes nothing, so the backup reminder
  // does not see a daily change and 「稍后提醒」 holds.
  const rankedOn = new Map<string, string>()
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
      const decisions = confirmationIndex(repository)
      const follow = repository.listBusinessFollowUps(),
        // A pair with any follow-up, ended ones included, is known work, not a new opportunity.
        busy = new Set(follow.map((f) => `${f.documentId}:${f.reviewId}`))
      const common = hash([
        OPPORTUNITY_DISCOVERY_SCHEMA,
        businessMatchingPolicyVersion,
        locale,
        people.map((p) => [p.sourceDocumentId, p.profileVersion, confirmationSignature(decisions(p.sourceDocumentId))]),
        rules.revision,
        states,
        repository.listCustomerIdentities(),
        repository.getActiveSystemExperiences().map((s) => [s.id, s.version])
      ])
      // Tokyo business days, as everywhere else the app counts days.
      const day = tokyoDateKey(new Date())
      const zh = locale === 'zh-CN'
      for (const job of cases) {
        signal?.throwIfAborted()
        const signature = hash([common, job.version, job.id, follow.map((f) => [f.documentId, f.reviewId, f.status])]),
          key = `opportunities:${job.sourceReviewId}`
        const checkpoint = repository.getGrowthCheckpoint(key)
        if (checkpoint === signature && rankedOn.get(key) === day) continue
        const snapshots = new Map(
          people.map((p) => [
            p.sourceDocumentId,
            { ...matchingExperienceInput(p, job, locale, rules), context: experienceContext(repository, job.fields, locale) }
          ])
        )
        const matched = []
        for (let index = 0; index < people.length; index++) {
          const person = people[index]!,
            evaluation = evaluateWithWorkRules(person, job, rules, undefined, decisions(person.sourceDocumentId))
          if (
            evaluation.reviewable &&
            // HR's 不满足 keeps the pair, marked and last; any other exclusion is not an opportunity.
            (evaluation.qualification.status !== 'excluded' || excludedByHr(evaluation.qualification)) &&
            evaluation.matched.length &&
            !busy.has(`${person.sourceDocumentId}:${job.sourceReviewId}`)
          )
            matched.push({ person, ...evaluation, ranking: undefined as import('@shared').RankingAdjustment | undefined })
          if (index % 50 === 0) {
            await new Promise<void>((resolve) => setImmediate(resolve))
            signal?.throwIfAborted()
          }
        }
        // A pair HR removed keeps its place out of the five while its conclusion is the same.
        const removed = new Map(
          (repository.listMatchingOpportunityRows?.(job.sourceReviewId) ?? [])
            .filter((row) => row.state === 'dismissed' && row.jobCaseVersion === job.version)
            .map((row) => [row.documentId, row] as const)
        )
        const statusOf = (item: { qualification: { status: string } }) =>
          item.qualification.status === 'recommended'
            ? 'recommended'
            : item.qualification.status === 'excluded'
              ? 'not-suitable'
              : 'needs-confirmation'
        const order = applyLearnedRanking(
          repository,
          matched.filter((item) => {
            const row = removed.get(item.person.sourceDocumentId)
            return !row || row.status !== statusOf(item) || row.profileVersion !== item.person.profileVersion
          }),
          (p) => p.person.sourceDocumentId,
          snapshots
        )
        // The five best, plus every pair HR judged 不满足 so it stays visible (they rank last).
        const ranked = [...order.slice(0, 5), ...order.slice(5).filter((item) => excludedByHr(item.qualification))]
        const items = ranked.map((item) => opportunityItem(job, item, rules.revision, zh))
        signal?.throwIfAborted()
        // Written only when the case's opportunities actually changed (see rankedOn).
        const stored = repository.listMatchingOpportunityRows?.(job.sourceReviewId) ?? null
        const current = new Map(items.map((item) => [item.documentId, item.fingerprint]))
        const unchanged =
          stored !== null &&
          items.every((item) => stored.some((row) => row.documentId === item.documentId && row.fingerprint === item.fingerprint)) &&
          stored.every((row) => row.state === 'dismissed' || current.has(row.documentId))
        if (!unchanged) repository.saveMatchingOpportunities(job.sourceReviewId, items)
        if (checkpoint !== signature) repository.saveGrowthCheckpoint(key, signature)
        rankedOn.set(key, day)
      }
    } finally {
      running = false
    }
  }
}
/**
 * A full pass at most every 15 minutes, started only while the operator is idle and learning is not busy.
 * Activity aborts a running pass; finished cases keep their checkpoints, so the retry resumes where it stopped.
 */
export function startOpportunityDiscovery(context: Pick<MainIpcContext, 'repository'>, idleSeconds: () => number) {
  const pass = createOpportunityDiscovery(context)
  let active: AbortController | null = null,
    running = false,
    lastCompletedAt: number | null = null,
    watcher: ReturnType<typeof setInterval> | null = null
  const stopWatching = () => {
    if (watcher) clearInterval(watcher)
    watcher = null
  }
  const check = () => {
    if (
      !shouldStartOpportunityPass({
        now: Date.now(),
        lastCompletedAt,
        idleSeconds: idleSeconds(),
        busy: isLearningForegroundBusy(),
        running
      })
    )
      return
    const controller = new AbortController()
    active = controller
    running = true
    watcher = setInterval(() => {
      if (idleSeconds() < OPPORTUNITY_DISCOVERY_IDLE_SECONDS || isLearningForegroundBusy()) controller.abort()
    }, OPPORTUNITY_DISCOVERY_ACTIVITY_MS)
    watcher.unref()
    void pass(controller.signal)
      .then(() => {
        if (!controller.signal.aborted) lastCompletedAt = Date.now()
      })
      .catch(() => undefined)
      .finally(() => {
        stopWatching()
        running = false
        if (active === controller) active = null
      })
  }
  const first = setTimeout(check, OPPORTUNITY_DISCOVERY_FIRST_CHECK_MS)
  first.unref()
  const timer = setInterval(check, OPPORTUNITY_DISCOVERY_CHECK_MS)
  timer.unref()
  return () => {
    clearTimeout(first)
    clearInterval(timer)
    stopWatching()
    active?.abort()
  }
}
