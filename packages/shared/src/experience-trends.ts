import {
  experienceScopeFor,
  type ExperienceEvent,
  type ExperienceRun,
  type ExperienceScope,
  type ExperienceTask,
  type ExperienceSample
} from './system-experience'
export interface ExperienceOutcome {
  eventId: string
  run: ExperienceRun
  at: string
  bad: boolean
}
export interface ExperienceTrendWindow {
  from: string
  to: string
  count: number
  baseline: number
  assisted: number
  badRate: number | null
}
export interface ExperienceTrend {
  task: ExperienceTask
  scope: ExperienceScope
  previous: ExperienceTrendWindow
  recent: ExperienceTrendWindow
  state: 'insufficient' | 'stable' | 'improving' | 'declining'
}
/** Corrections are operational signals, never inferred hiring success or technical failure. */
export function experienceOutcomes(
  events: ExperienceEvent[],
  runs: Map<string, ExperienceRun>,
  samples: ExperienceSample[] = []
): ExperienceOutcome[] {
  const byRun = new Map<string, ExperienceOutcome>()
  for (const event of [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (event.superseded) continue
    for (const id of event.runIds) {
      const run = runs.get(id)
      if (!run) continue
      let bad: boolean | undefined
      if (event.kind === 'edit' && event.data.adopted === true && ['introduction', 'interview'].includes(run.input.task))
        bad = event.data.semanticEdit === true
      if (
        event.kind === 'assessment-feedback' &&
        event.text.trim().length >= 10 &&
        ['skills', 'evidence'].includes(String(event.data.reason)) &&
        ['suitable', 'unsuitable'].includes(String(event.data.decision))
      )
        bad = event.data.decision === 'unsuitable'
      if (run.input.task === 'matching' && bad === undefined) {
        const professional = samples.filter((s) => s.eventId === event.id && s.runId === run.id && s.task === 'matching')
        if (professional.length) bad = professional.some((s) => s.polarity === 'counterexample')
      }
      if (bad !== undefined) byRun.set(id, { eventId: event.id, run, at: event.createdAt, bad })
    }
  }
  return [...byRun.values()]
}
export function independentOutcomes(values: ExperienceOutcome[]): ExperienceOutcome[] {
  const people = new Set<string>(),
    cases = new Set<string>()
  return values.filter((value) => {
    const p = value.run.documentId,
      c = value.run.reviewId
    if ((p && people.has(p)) || (c && cases.has(c))) return false
    if (p) people.add(p)
    if (c) cases.add(c)
    return true
  })
}
export function buildExperienceTrends(outcomes: ExperienceOutcome[], owner: string, now = new Date()): ExperienceTrend[] {
  const day = 86400000,
    recentStart = new Date(now.getTime() - 14 * day).toISOString(),
    previousStart = new Date(now.getTime() - 28 * day).toISOString(),
    end = now.toISOString()
  const groups = new Map<string, { task: ExperienceTask; scope: ExperienceScope; values: ExperienceOutcome[] }>()
  for (const value of outcomes) {
    const scope = experienceScopeFor(value.run.input)
    if (!scope || scope.owner !== owner || value.at < previousStart || value.at > end) continue
    const key = JSON.stringify([value.run.input.task, scope.kind, scope.owner, scope.key, scope.locale, scope.style ?? null])
    const group = groups.get(key) ?? { task: value.run.input.task, scope, values: [] }
    group.values.push(value)
    groups.set(key, group)
  }
  return [...groups.values()]
    .map((group) => {
      // Deduplicate across both windows, using the latest record for each person/case.
      const independent = independentOutcomes(group.values.sort((a, b) => b.at.localeCompare(a.at)))
      const window = (from: string, to: string, includeEnd = false): ExperienceTrendWindow => {
        const values = independent.filter((v) => v.at >= from && (includeEnd ? v.at <= to : v.at < to))
        return {
          from,
          to,
          count: values.length,
          baseline: values.filter((v) => !v.run.bundle.refs.length).length,
          assisted: values.filter((v) => v.run.bundle.refs.length).length,
          badRate: values.length ? values.filter((v) => v.bad).length / values.length : null
        }
      }
      const previous = window(previousStart, recentStart),
        recent = window(recentStart, end, true)
      const delta = (recent.badRate ?? 0) - (previous.badRate ?? 0)
      return {
        task: group.task,
        scope: group.scope,
        previous,
        recent,
        state: previous.count < 5 || recent.count < 5 ? 'insufficient' : delta >= 0.4 ? 'declining' : delta <= -0.4 ? 'improving' : 'stable'
      } as ExperienceTrend
    })
    .sort((a, b) => b.recent.count - a.recent.count)
}
