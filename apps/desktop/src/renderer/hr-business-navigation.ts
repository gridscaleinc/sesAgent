import type { BusinessFeedEntry } from '@shared'
export type HrBusinessKind = 'case' | 'person'
export const businessObjectKey = (entry: Pick<BusinessFeedEntry, 'kind' | 'objectId'>) => `${entry.kind}:${entry.objectId}`
export function currentBusinessObjects(entries: BusinessFeedEntry[]) {
  const current = new Map<string, BusinessFeedEntry>()
  for (const entry of entries) {
    const key = businessObjectKey(entry)
    if (!current.has(key) || Date.parse(current.get(key)!.occurredAt) < Date.parse(entry.occurredAt)) current.set(key, entry)
  }
  return [...current.values()].filter((entry) => !entry.archived)
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || businessObjectKey(a).localeCompare(businessObjectKey(b)))
}

export type HrTimeRange = 'today' | '7d' | '30d' | 'all'
export interface HrListPosition { filter: 'all' | 'unseen' | 'later'; timeRange: HrTimeRange; page: number; scroll: number; selected: string | null }
const empty = (): HrListPosition => ({ filter: 'all', timeRange: 'today', page: 1, scroll: 0, selected: null })
const positionKey = (kind: HrBusinessKind) => `ses-hr-position-${kind === 'person' ? 'v4' : 'v3'}:${kind}`
// Only non-content navigation metadata is stored in ordinary UI preferences.
export function readHrPosition(kind: HrBusinessKind): HrListPosition {
  try {
    const saved = localStorage.getItem(positionKey(kind))
    const value = JSON.parse(saved ?? localStorage.getItem(`ses-hr-position-v3:${kind}`) ?? localStorage.getItem(`ses-hr-position-v2:${kind}`) ?? 'null')
    if (!value) return empty()
    const selected = typeof value.selected === 'string' && new RegExp(`^${kind}:[0-9a-f-]{36}$`, 'i').test(value.selected) ? value.selected : null
    // Start existing installations with the new list defaults, retaining only the selected object.
    if (!saved) return { ...empty(), selected }
    return { filter: ['all', 'unseen', 'later'].includes(value.filter) ? value.filter : 'all',
      timeRange: ['today', '7d', '30d', 'all'].includes(value.timeRange) ? value.timeRange : empty().timeRange,
      page: Number.isSafeInteger(value.page) && value.page > 0 ? value.page : 1,
      scroll: Number.isFinite(value.scroll) && value.scroll >= 0 ? value.scroll : 0,
      selected }
  } catch { return empty() }
}
export function saveHrPosition(kind: HrBusinessKind, patch: Partial<HrListPosition>) {
  try { localStorage.setItem(positionKey(kind), JSON.stringify({ ...readHrPosition(kind), ...patch })) } catch { /* UI position is best effort. */ }
}
