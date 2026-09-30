import { businessObjectKey, currentBusinessObjects } from '@shared'
export type HrBusinessKind = 'case' | 'person'
// The newest entry per object is shared with Main (the menu-bar summary counts the same 未读 as this list).
export { businessObjectKey, currentBusinessObjects }

export type HrTimeRange = 'today' | '7d' | '30d' | 'all'
export type HrListFilter = 'working' | 'all' | 'unseen' | 'later'
/** The filters each list offers, in display order; the first is the list's default. */
export const hrListFilters: Record<HrBusinessKind, readonly HrListFilter[]> = {
  case: ['working', 'all', 'unseen'],
  person: ['all', 'unseen', 'later']
}
export interface HrListPosition {
  filter: HrListFilter
  timeRange: HrTimeRange
  page: number
  scroll: number
  selected: string | null
}
const timeRanges: readonly HrTimeRange[] = ['today', '7d', '30d', 'all']
const empty = (kind: HrBusinessKind): HrListPosition => ({
  filter: hrListFilters[kind][0]!,
  timeRange: 'all',
  page: 1,
  scroll: 0,
  selected: null
})
const positionKey = (kind: HrBusinessKind) => `ses-hr-position-v5:${kind}`
const legacyPositionKeys = (kind: HrBusinessKind) => ['v4', 'v3', 'v2'].map((version) => `ses-hr-position-${version}:${kind}`)
/**
 * Only non-content navigation metadata is stored in ordinary UI preferences.
 * Cases open on my cases every time, so their filter is never restored; people keep their saved filter.
 */
export function readHrPosition(kind: HrBusinessKind): HrListPosition {
  try {
    const saved = localStorage.getItem(positionKey(kind))
    const legacy = saved
      ? null
      : legacyPositionKeys(kind)
          .map((key) => localStorage.getItem(key))
          .find((value) => value != null)
    const value = JSON.parse(saved ?? legacy ?? 'null')
    if (!value) return empty(kind)
    const selected =
      typeof value.selected === 'string' && new RegExp(`^${kind}:[0-9a-f-]{36}$`, 'i').test(value.selected) ? value.selected : null
    // Older versions defaulted to today: start them once on the current defaults, retaining only the selected object.
    if (!saved) return { ...empty(kind), selected }
    return {
      filter: kind === 'person' && hrListFilters.person.includes(value.filter) ? value.filter : empty(kind).filter,
      timeRange: timeRanges.includes(value.timeRange) ? value.timeRange : empty(kind).timeRange,
      page: Number.isSafeInteger(value.page) && value.page > 0 ? value.page : 1,
      scroll: Number.isFinite(value.scroll) && value.scroll >= 0 ? value.scroll : 0,
      selected
    }
  } catch {
    return empty(kind)
  }
}
export function saveHrPosition(kind: HrBusinessKind, patch: Partial<HrListPosition>) {
  try {
    const { filter, ...rest } = { ...readHrPosition(kind), ...patch }
    localStorage.setItem(positionKey(kind), JSON.stringify(kind === 'person' ? { filter, ...rest } : rest))
  } catch {
    /* UI position is best effort. */
  }
}
