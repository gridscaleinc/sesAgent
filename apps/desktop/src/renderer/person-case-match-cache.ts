import { useSyncExternalStore } from 'react'
import {
  businessMatchingPolicyVersion,
  isListedPersonnelCaseMatch,
  type PersonnelCaseMatch,
  type PersonnelCaseMatchResult,
  type PersonnelCaseMatchRunSummary,
  type StoredPersonnelCaseMatchRun
} from '@shared'
import { onRequirementDecision } from './requirement-decision-events'

/**
 * The last 找案件 result per person. Main stores each completed run in the encrypted database; this
 * cache holds what the renderer has loaded so reopening a person shows it instantly instead of re-running
 * the cloud evaluation. List badges come from lightweight summaries fetched once on first use, and a full
 * result is loaded when its person is opened. Freshness (profile, case versions, rules and policy) is
 * still checked by the matching workspace before any result is reused or acted on.
 */
export interface PersonCaseMatchEntry {
  result: PersonnelCaseMatchResult
  /** ISO time the run finished, shown as 「上次找案件」 in Tokyo time. */
  ranAt: string
  /** `${jobCaseId}:${version}` of the active cases at run time; a new or changed case makes the result stale. */
  caseSignature: string
  /** Matching policy of a stored run; a run under an older policy is stale. */
  policyVersion?: string
}

const entries = new Map<string, PersonCaseMatchEntry>()
const summaries = new Map<string, PersonnelCaseMatchRunSummary>()
const loading = new Map<string, Promise<PersonCaseMatchEntry | null>>()
let hydration: Promise<void> | null = null
const running = new Set<string>()
// A 找案件 request accepted but still reading the stored run: the person counts as busy so it cannot start twice.
const preparing = new Set<string>()
const listeners = new Set<() => void>()
let snapshot = 0
const emit = () => {
  snapshot++
  for (const listener of listeners) listener()
}

/** Cases the workspace lists for this result: recommended plus those needing confirmation. */
export const listedPersonCaseMatch = (item: PersonnelCaseMatch) => isListedPersonnelCaseMatch(item)
const fromStored = (run: StoredPersonnelCaseMatchRun): PersonCaseMatchEntry => ({
  result: run.result,
  ranAt: run.searchedAt,
  caseSignature: run.caseSignature,
  policyVersion: run.policyVersion
})

// Badge counts are re-read after business data changes (a case ended, a status changed), not only once per session.
let rehydrate: ReturnType<typeof setTimeout> | null = null
if (typeof window !== 'undefined')
  window.addEventListener('ses-business-data-changed', () => {
    if (!hydration) return
    if (rehydrate) clearTimeout(rehydrate)
    rehydrate = setTimeout(() => {
      rehydrate = null
      hydration = null
      void hydratePersonCaseMatches()
      void refreshLoadedPersonCaseMatches()
    }, 500)
  })
// An HR decision on an unclear requirement updates the person's stored 找案件 run in place.
if (typeof window !== 'undefined')
  onRequirementDecision(({ documentId, personRun }) => {
    if (!personRun || personRun.result.documentId !== documentId) return
    entries.set(documentId, fromStored(personRun))
    emit()
  })

export function savePersonCaseMatch(entry: PersonCaseMatchEntry) {
  entries.set(entry.result.documentId, entry)
  emit()
}
export function personCaseMatch(documentId: string): PersonCaseMatchEntry | null {
  return entries.get(documentId) ?? null
}
/**
 * Loads the person's stored run from Main unless this session already has one. Resolves null when there is
 * none or it cannot be read (the workspace then runs 找案件 as usual); a run finished meanwhile wins.
 */
export function loadPersonCaseMatch(documentId: string): Promise<PersonCaseMatchEntry | null> {
  const existing = entries.get(documentId)
  if (existing) return Promise.resolve(existing)
  if (typeof window === 'undefined' || typeof window.sesAgent?.getPersonnelCaseMatchRun !== 'function') return Promise.resolve(null)
  const pending = loading.get(documentId)
  if (pending) return pending
  const promise = window.sesAgent
    .getPersonnelCaseMatchRun(documentId)
    .then((run) => {
      const current = entries.get(documentId)
      if (current) return current
      if (!run || run.result.documentId !== documentId) return null
      const entry = fromStored(run)
      entries.set(documentId, entry)
      emit()
      return entry
    })
    .catch(() => entries.get(documentId) ?? null)
    .finally(() => loading.delete(documentId))
  loading.set(documentId, promise)
  return promise
}
/**
 * Re-reads the results already loaded this session, so an assessment made from a case page shows in the person's
 * view without reopening the app. A person whose 找案件 is running keeps what the run will deliver.
 */
function refreshLoadedPersonCaseMatches(): Promise<void> {
  if (typeof window === 'undefined' || typeof window.sesAgent?.getPersonnelCaseMatchRun !== 'function') return Promise.resolve()
  return Promise.all(
    [...entries.keys()].map((documentId) =>
      window.sesAgent
        .getPersonnelCaseMatchRun(documentId)
        .then((run) => {
          if (!run || run.result.documentId !== documentId || running.has(documentId) || preparing.has(documentId)) return
          entries.set(documentId, fromStored(run))
        })
        .catch(() => undefined)
    )
  ).then(() => emit())
}
/** Fetches badge counts for every person once per session, so 「查看案件 (n)」 survives a restart. */
export function hydratePersonCaseMatches(): Promise<void> {
  if (hydration) return hydration
  if (typeof window === 'undefined' || typeof window.sesAgent?.listPersonnelCaseMatchRunSummaries !== 'function') return Promise.resolve()
  hydration = window.sesAgent
    .listPersonnelCaseMatchRunSummaries()
    .then((values) => {
      for (const value of values) summaries.set(value.documentId, value)
      if (values.length) emit()
    })
    .catch(() => {
      // Badges then appear only after a run in this session; opening a person still loads its stored run.
    })
  return hydration
}
/** jobCaseId → version of the active cases, kept by the app shell so every badge counts the same cases. */
let knownActiveCases: ReadonlyMap<string, number> | null = null
export function setActiveCaseVersions(value: ReadonlyMap<string, number>) {
  knownActiveCases = value
  emit()
}
/**
 * 可提案案件: cases recommended for this person, from 找案件 and the case pages alike, or null when this person has
 * no result (or it is for an older profile version). A result loaded or run this session is used unless the stored
 * summary is newer.
 */
export function personCaseMatchCount(
  documentId: string,
  profileVersion?: number,
  /** jobCaseId → version of the active cases; with it, cases ended or edited since the run are not counted. */
  activeCases: ReadonlyMap<string, number> | null = knownActiveCases
): number | null {
  const entry = entries.get(documentId)
  const summary = summaries.get(documentId)
  if (entry && (!summary || !entry.ranAt || entry.ranAt >= summary.searchedAt)) {
    if (profileVersion !== undefined && entry.result.profileVersion !== profileVersion) return null
    return entry.result.items.filter(
      (item) =>
        listedPersonCaseMatch(item) &&
        item.qualification?.status === 'recommended' &&
        (!activeCases || activeCases.get(item.jobCaseId) === item.jobCaseVersion)
    ).length
  }
  if (!summary || (profileVersion !== undefined && summary.profileVersion !== profileVersion)) return null
  return summary.policyVersion === businessMatchingPolicyVersion ? (summary.proposableCount ?? 0) : 0
}
export function setPersonCaseMatchRunning(documentId: string, value: boolean) {
  if (running.has(documentId) === value) return
  if (value) running.add(documentId)
  else running.delete(documentId)
  emit()
}
export function setPersonCaseMatchPreparing(documentId: string, value: boolean) {
  if (preparing.has(documentId) === value) return
  if (value) preparing.add(documentId)
  else preparing.delete(documentId)
  emit()
}
export function isPersonCaseMatchRunning(documentId: string) {
  return running.has(documentId)
}
/** Running, or accepted and still deciding whether to run: its 找案件 buttons stay disabled. */
export function isPersonCaseMatchBusy(documentId: string) {
  return running.has(documentId) || preparing.has(documentId)
}
export function busyPersonCaseMatches(): string[] {
  return [...new Set([...running, ...preparing])]
}
export function subscribePersonCaseMatches(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
/** Re-renders on any stored result or running change; use `personCaseMatchCount`/`isPersonCaseMatchBusy` inside. */
/** `hydrate` false leaves the badge fetch to the caller, e.g. until the app is past startup recovery. */
export function usePersonCaseMatchCounts(hydrate = true) {
  if (hydrate) void hydratePersonCaseMatches()
  useSyncExternalStore(subscribePersonCaseMatches, () => snapshot)
  return { count: personCaseMatchCount, running: isPersonCaseMatchBusy }
}
/** Tests only: forget every stored result. */
export function clearPersonCaseMatchCache() {
  entries.clear()
  summaries.clear()
  loading.clear()
  hydration = null
  running.clear()
  preparing.clear()
  emit()
}
