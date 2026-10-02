import './case-resume-panel.css'
import { BusinessObjectDeleteButton } from './BusinessObjectDeleteButton'
import {
  isActiveProgress,
  nextProgressAppointment,
  progressPresentation,
  progressSummary,
  useBusinessProgress
} from '../business-progress-data'
import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  jobCaseSourceTypes,
  isInactiveProgressStage,
  type BusinessFeedEntry,
  type BusinessFollowUp,
  type CandidateBusinessStatus,
  type CandidateReviewSnapshot,
  type JobCaseReviewSnapshot,
  type JobCaseSourceType
} from '@shared'
import { jobCaseSourceTypeLabel } from './JobCaseInbox'
import { localizedIpcError, useLocaleText } from '../i18n'
import { Icon } from './Icon'
import {
  businessObjectKey,
  currentBusinessObjects,
  hrListFilters,
  readHrPosition,
  saveHrPosition,
  type HrBusinessKind,
  type HrListFilter,
  type HrTimeRange
} from '../hr-business-navigation'
import { cardChangeLabels, cardSkillItems } from '../hr-card-presentation'
import { displayFieldValue } from '../field-display'
import { BusinessHeaderActionsContext } from './business-header-actions'

const usable = (entry: BusinessFeedEntry) =>
  entry.kind === 'case' ? entry.businessStatus === 'active' : ['available', 'soon'].includes(entry.businessStatus)
// One page of cards fits about one screen; HR can show more per page and the choice is remembered.
export const hrListPageSizes = [10, 20, 50] as const
export const hrListPageSize = 10
export const hrListPageSizeKey = 'ses-hr-page-size-v1'
const readPageSize = () => {
  try {
    const saved = Number(localStorage.getItem(hrListPageSizeKey))
    return (hrListPageSizes as readonly number[]).includes(saved) ? saved : hrListPageSize
  } catch {
    return hrListPageSize
  }
}
/** Page numbers to show: the first, the last and the ones around the current page, with gaps as null. */
export const pageNumbers = (page: number, total: number): Array<number | null> => {
  const shown = [...new Set([1, page - 1, page, page + 1, total])].filter((item) => item >= 1 && item <= total).sort((a, b) => a - b)
  return shown.flatMap((item, index) => (index && item - shown[index - 1]! > 1 ? [null, item] : [item]))
}
/** How long the undo toast for 接手 / 结束 stays before it fades. */
const undoNoticeMs = 5000
/** Below this surface width the list and the open detail take turns instead of sitting side by side. */
export const hrListNarrowWidth = 900
/** Skill chips per card; the rest is counted in a 「+N」 chip whose tooltip lists them. */
const cardSkillLimit = 5
/** Width- and case-insensitive text for comparing a skill with the title. */
const foldText = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, '')

/**
 * A "…" style menu button: arrow keys move between items, Esc and a click outside close it.
 * Items stay mounted while closed so a confirmation opened from an item (e.g. delete) survives the menu closing.
 */
export function ActionMenu({
  label,
  trigger,
  triggerClassName,
  children
}: {
  label: string
  trigger: ReactNode
  triggerClassName?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])]
  useEffect(() => {
    // Reused controls (the delete button) render a plain button; give them menu item semantics.
    menu.current?.querySelectorAll('button:not([role])').forEach((item) => item.setAttribute('role', 'menuitem'))
  })
  useEffect(() => {
    if (!open) return
    items()[0]?.focus()
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])
  const close = () => {
    setOpen(false)
    button.current?.focus()
  }
  return (
    <div className="hr-menu" ref={root}>
      <button
        ref={button}
        className={triggerClassName}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={typeof trigger === 'string' ? undefined : label}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            setOpen(true)
          }
        }}
      >
        {trigger}
      </button>
      <div
        id={menuId}
        ref={menu}
        className="hr-menu-list"
        role="menu"
        aria-label={label}
        hidden={!open}
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('[role="menuitem"]')) setOpen(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            close()
            return
          }
          if (event.key === 'Tab') {
            setOpen(false)
            return
          }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          event.stopPropagation()
          const list = items()
          const index = list.indexOf(document.activeElement as HTMLElement)
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? list.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
          list[next]?.focus()
        }}
      >
        {children}
      </div>
    </div>
  )
}

export function HrObjectList({
  active = true,
  onAssessResumes,
  resumeStates = {},
  onDeleted,
  onOpenProgress,
  onOpenFollowUp,
  cases = [],
  kind,
  reloadToken,
  candidates,
  selectedKey,
  busy = false,
  busyObjectIds,
  personMatchCounts = {},
  onOpen,
  onIntake,
  onImportResume,
  onRefresh,
  onOpenLibrary,
  onImportHistory,
  extraActions = [],
  filterRequest,
  detail,
  detailOpen = false,
  detailLabel,
  onCloseDetail,
  layoutWidth
}: {
  onAssessResumes?(entry: BusinessFeedEntry, files?: File[]): void
  resumeStates?: Record<string, { pending: number; count: number }>
  onDeleted?(entry: BusinessFeedEntry): Promise<void>
  onOpenProgress?(entry: BusinessFeedEntry): void
  /** Opens one follow-up on the 跟进 page (a placed person's placement record, with 记录退场). */
  onOpenFollowUp?(target: { documentId: string; reviewId: string }): void
  cases?: JobCaseReviewSnapshot[]
  kind: HrBusinessKind
  reloadToken: unknown
  candidates: CandidateReviewSnapshot[]
  selectedKey?: string | null
  /** Legacy global lock: disables matching on every card. Superseded by busyObjectIds when that is passed. */
  busy?: boolean
  /** Objects whose matching is running; only their cards are locked. Empty means none is running. */
  busyObjectIds?: string[]
  /** Cases currently recommended per person (by objectId), from 找案件 and the case pages, shown as 「可提案案件 (n)」. */
  personMatchCounts?: Record<string, number>
  onOpen(entry: BusinessFeedEntry, action: 'view' | 'match' | 'promote'): void
  onIntake(): void
  onImportResume(): void
  onRefresh(): Promise<void>
  onOpenLibrary?(): void
  onImportHistory?(): void
  /** Sub-pages of this section (e.g. 招聘面试); `overflow` ones sit in the 「更多」 menu instead of the toolbar. */
  extraActions?: Array<{ id: string; label: string; onSelect(): void; overflow?: boolean }>
  /** False while another page covers the list; each return to the list opens cases on the working set again. */
  active?: boolean
  /** Opens the list on one filter (the menu-bar panel's 未读); a new id applies it again. */
  filterRequest?: { kind: HrBusinessKind; filter: HrListFilter; id: number }
  /**
   * The open object's detail (case detail, person profile, intake…), shown as the right pane beside the list.
   * Stays mounted while closed so drafts and scroll inside it survive; undefined means this list has no pane.
   */
  detail?: ReactNode
  detailOpen?: boolean
  detailLabel?: string
  /** × / Esc / 「← 返回列表」: closes the pane and gives the list its full width back. */
  onCloseDetail?(): void
  /** Overrides the measured surface width (tests; jsdom has no layout). */
  layoutWidth?: number
}) {
  const { locale, zh, t } = useLocaleText()
  // The person's 营业状态, in the order HR works through them.
  const personStatuses: Array<{ value: CandidateBusinessStatus; label: string }> = [
    { value: 'available', label: t('待机中', '待機中') },
    { value: 'soon', label: t('近期可入场', '近日稼働可能') },
    { value: 'assigned', label: t('已进场', '参画中') },
    { value: 'paused', label: t('暂停营业', '営業停止中') }
  ]
  const progress = useBusinessProgress()
  const [entries, setEntries] = useState<BusinessFeedEntry[]>([])
  const [incoming, setIncoming] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dragTarget, setDragTarget] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState(false)
  const [deletionNotice, setDeletionNotice] = useState('')
  const [queries, setQueries] = useState({ case: '', person: '' })
  // readHrPosition owns the defaults: cases always open on my cases, the person list keeps its saved filter.
  const [filters, setFilters] = useState<Record<HrBusinessKind, HrListFilter>>(() => ({
    case: readHrPosition('case').filter,
    person: readHrPosition('person').filter
  }))
  const [workingNotice, setWorkingNotice] = useState<{ entry: BusinessFeedEntry; working: boolean } | null>(null)
  // Cases in "all" show active ones unless HR asks for ended ones; every return to the list starts on active.
  const [caseStatus, setCaseStatus] = useState<'active' | 'ended'>('active')
  /** The last 结束/激活 with its undo; closed lists the follow-ups ended with the case, resumed again on undo. */
  const [lifecycleNotice, setLifecycleNotice] = useState<{ entry: BusinessFeedEntry; ended: boolean; closed?: number } | null>(null)
  // A card read while "unread" is showing stays until HR leaves that view, so it does not vanish under the cursor.
  const [keptInUnread, setKeptInUnread] = useState<Set<string>>(new Set())
  const [timeRanges, setTimeRanges] = useState<Record<HrBusinessKind, HrTimeRange>>(() => ({
    case: readHrPosition('case').timeRange,
    person: readHrPosition('person').timeRange
  }))
  const [pages, setPages] = useState(() => ({ case: readHrPosition('case').page, person: readHrPosition('person').page }))
  const [pageSize, setPageSize] = useState(readPageSize)
  const [own, setOwn] = useState('all')
  // 营业状态 filter of the person list; 'all' shows every status.
  const [personStatus, setPersonStatus] = useState<'all' | CandidateBusinessStatus>('all')
  const [pendingMarks, setPendingMarks] = useState<Set<string>>(new Set())
  const marks = useRef(new Set<string>())
  const sequence = useRef(0)
  const revealImportedCases = useRef(false)
  const scroller = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const reasonId = useId()
  const scrolls = useRef<Record<HrBusinessKind, number>>({ case: readHrPosition('case').scroll, person: readHrPosition('person').scroll })
  const initialized = useRef(false)
  const displayed = useRef<BusinessFeedEntry[]>([])
  const accept = (rows: BusinessFeedEntry[], reveal: boolean) => {
    const next = currentBusinessObjects(rows)
    const old = new Map(displayed.current.map((entry) => [businessObjectKey(entry), entry.revision]))
    const changed = next.some((entry) => old.get(businessObjectKey(entry)) !== entry.revision)
    if (reveal || !initialized.current) {
      initialized.current = true
      displayed.current = next
      setEntries(next)
    } else {
      const fresh = new Map(next.map((entry) => [businessObjectKey(entry), entry]))
      setEntries((current) =>
        current.flatMap((entry) => {
          const update = fresh.get(businessObjectKey(entry))
          return update
            ? [
                {
                  ...entry,
                  businessStatus: update.businessStatus,
                  deferred: update.deferred,
                  working: update.working,
                  unseen: entry.revision === update.revision ? update.unseen : true
                }
              ]
            : []
        })
      )
    }
    if (reveal) setIncoming(false)
    else setIncoming(changed)
  }
  const load = async (reveal = false) => {
    const id = ++sequence.current
    try {
      const rows = await window.sesAgent.getBusinessFeed()
      if (id !== sequence.current) return
      accept(rows, reveal || revealImportedCases.current || !initialized.current)
      revealImportedCases.current = false
      setError('')
    } catch (cause) {
      if (id === sequence.current) setError(localizedIpcError(locale, cause, t('无法读取业务列表。', '業務一覧を読み込めませんでした。')))
    } finally {
      if (id === sequence.current) setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    return () => {
      sequence.current++
    }
  }, [reloadToken])
  useEffect(() => {
    const refreshEdit = (event: Event) => {
      const target = (event as CustomEvent<{ kind?: string; id?: string; origin?: string } | undefined>).detail
      // This list already shows what it changed; the notice is for the other pages.
      if (target?.origin === 'hr-list') return
      // A change without a named object (a decision, an import) refreshes the whole list instead.
      if (!target?.kind || !target.id) {
        void load()
        return
      }
      void window.sesAgent
        .getBusinessFeed()
        .then((rows) => {
          const update = currentBusinessObjects(rows).find((item) => item.kind === target.kind && item.objectId === target.id)
          if (!update) return
          setEntries((current) => {
            const next = current.map((item) =>
              item.kind === update.kind && item.objectId === update.objectId ? { ...update, occurredAt: item.occurredAt } : item
            )
            displayed.current = next
            return next
          })
        })
        .catch((cause) => setError(localizedIpcError(locale, cause, t('无法读取业务列表。', '業務一覧を読み込めませんでした。'))))
    }
    window.addEventListener('ses-business-data-changed', refreshEdit)
    return () => window.removeEventListener('ses-business-data-changed', refreshEdit)
  }, [])
  useEffect(() => {
    // New cases are shown where they landed: my cases when the import added them there, otherwise every case.
    const imported = (event: Event) => {
      const working = Boolean((event as CustomEvent<{ working?: boolean } | null>).detail?.working)
      revealImportedCases.current = true
      // Imported from another page: the next return to the list opens where the new cases landed.
      importedView.current = activeNow.current ? null : working ? 'working' : 'all'
      setQueries((current) => ({ ...current, case: '' }))
      setFilters((current) => ({ ...current, case: working ? 'working' : 'all' }))
      setCaseStatus('active')
      if (!working) setTimeRanges((current) => ({ ...current, case: 'all' }))
      setPages((current) => ({ ...current, case: 1 }))
      void load(true)
    }
    window.addEventListener('ses-cases-imported', imported)
    return () => window.removeEventListener('ses-cases-imported', imported)
  }, [])
  const wasActive = useRef(active)
  const activeNow = useRef(active)
  activeNow.current = active
  const importedView = useRef<HrListFilter | null>(null)
  useEffect(() => {
    if (active && !wasActive.current) {
      const landed = importedView.current
      importedView.current = null
      setFilters((current) => ({ ...current, case: landed ?? readHrPosition('case').filter }))
      if (landed === 'all') setTimeRanges((current) => ({ ...current, case: 'all' }))
      setPages((current) => ({ ...current, case: 1 }))
      setWorkingNotice(null)
      setCaseStatus('active')
      setLifecycleNotice(null)
      setKeptInUnread(new Set())
    }
    wasActive.current = active
  }, [active])
  // Declared after the return-to-list reset so a requested filter wins when both happen in one commit.
  useEffect(() => {
    if (!filterRequest) return
    const { kind: target, filter } = filterRequest
    setFilters((current) => ({ ...current, [target]: filter }))
    setTimeRanges((current) => ({ ...current, [target]: 'all' }))
    setQueries((current) => ({ ...current, [target]: '' }))
    setPages((current) => ({ ...current, [target]: 1 }))
    if (target === 'case') setCaseStatus('active')
  }, [filterRequest?.id])
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scrolls.current[kind]
  }, [kind])
  // 「/」 jumps to the list search unless HR is already typing somewhere.
  useEffect(() => {
    if (!active) return
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      const input = search.current
      if (!input || input.closest('[hidden]') || document.querySelector('[aria-modal="true"]')) return
      event.preventDefault()
      input.focus()
    }
    document.addEventListener('keydown', focusSearch)
    return () => document.removeEventListener('keydown', focusSearch)
  }, [active])
  useEffect(() => {
    if (!loading && scroller.current) scroller.current.scrollTop = scrolls.current[kind]
  }, [loading])
  /** The object's current feed state; the list may hold an older revision after the object changed. */
  const freshEntry = async (entry: BusinessFeedEntry) =>
    currentBusinessObjects(await window.sesAgent.getBusinessFeed()).find((item) => businessObjectKey(item) === businessObjectKey(entry))
  const replaceEntry = (key: string, change: Partial<BusinessFeedEntry>) =>
    setEntries((current) => {
      const next = current.map((item) => (businessObjectKey(item) === key ? { ...item, ...change } : item))
      displayed.current = next
      return next
    })
  const mark = async (entry: BusinessFeedEntry, action: 'seen' | 'defer' | 'done') => {
    const key = businessObjectKey(entry)
    if (marks.current.has(key)) return
    marks.current.add(key)
    setPendingMarks(new Set(marks.current))
    try {
      const send = (revision: string) => window.sesAgent.markBusinessFeed({ kind: entry.kind, objectId: entry.objectId, revision, action })
      let rows: BusinessFeedEntry[]
      try {
        rows = await send(entry.revision)
      } catch (cause) {
        // The object changed since the list loaded it (e.g. it was ended or re-activated): retry once on its current revision.
        const fresh = await freshEntry(entry)
        if (!fresh || fresh.revision === entry.revision) throw cause
        rows = await send(fresh.revision)
      }
      const saved = rows.find((item) => businessObjectKey(item) === key)
      if (saved) replaceEntry(key, { revision: saved.revision, unseen: saved.unseen, deferred: saved.deferred })
      if (action === 'seen' && filters[entry.kind] === 'unseen') setKeptInUnread((current) => new Set(current).add(key))
      // The sidebar badge, 今天 and the menu bar count the same unread: they re-read (this list ignores its own event).
      window.dispatchEvent(new CustomEvent('ses-business-data-changed', { detail: { origin: 'hr-list' } }))
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('状态更新失败，请重试。', '状態を更新できませんでした。もう一度お試しください。')))
    } finally {
      marks.current.delete(key)
      setPendingMarks(new Set(marks.current))
    }
  }
  const setWorking = async (entry: BusinessFeedEntry, working: boolean, undo = false) => {
    const key = businessObjectKey(entry)
    if (marks.current.has(key)) return
    marks.current.add(key)
    setPendingMarks(new Set(marks.current))
    try {
      await window.sesAgent.setCaseWorking({ reviewId: entry.objectId, working })
      setEntries((current) => {
        const next = current.map((item) => (businessObjectKey(item) === key ? { ...item, working } : item))
        displayed.current = next
        return next
      })
      setWorkingNotice(undo ? null : { entry, working })
      setLifecycleNotice(null)
      setError('')
      // 今天, 新匹配机会 and the menu bar re-read what changed.
      window.dispatchEvent(new CustomEvent('ses-business-data-changed', { detail: { origin: 'hr-list' } }))
    } catch (cause) {
      setError(
        localizedIpcError(locale, cause, t('更新负责状态失败，请重试。', '担当状態を更新できませんでした。もう一度お試しください。'))
      )
    } finally {
      marks.current.delete(key)
      setPendingMarks(new Set(marks.current))
    }
  }
  /** Ends a case (it stops being offered for matching and introductions) or makes it active again. */
  /** 恢复营业: a person HR had stopped offering is 待机中 again. */
  const resumeOffering = async (entry: BusinessFeedEntry) => {
    const key = businessObjectKey(entry)
    const person = people.get(entry.objectId)
    if (!person || marks.current.has(key)) return
    marks.current.add(key)
    setPendingMarks(new Set(marks.current))
    try {
      await window.sesAgent.setCandidateBusinessState({
        documentId: person.documentId,
        profileVersion: person.profile?.version ?? 0,
        reviewRevision: person.reviewRevision,
        status: 'available',
        confirmed: true
      })
      replaceEntry(key, { businessStatus: 'available' })
      // The app re-reads its data on this event; no separate onRefresh, so one change is one reload.
      window.dispatchEvent(new CustomEvent('ses-business-data-changed', { detail: { origin: 'hr-list' } }))
    } catch (cause) {
      setError(
        localizedIpcError(locale, cause, t('营业状态更新失败，请重试。', '営業状態を更新できませんでした。もう一度お試しください。'))
      )
    } finally {
      marks.current.delete(key)
      setPendingMarks(new Set(marks.current))
    }
  }
  // 结束案件 with follow-ups still open asks whether to end them too, instead of leaving them to fail later.
  const [ending, setEnding] = useState<{ entry: BusinessFeedEntry; open: BusinessFollowUp[] } | null>(null)
  const [endingBusy, setEndingBusy] = useState(false)
  const requestEnd = async (entry: BusinessFeedEntry) => {
    // Only follow-ups still moving are ended with the case; a paused one stays paused, and an undo leaves it so.
    // While the shared follow-ups are still loading, they are read here, so the question is never skipped.
    let rows: BusinessFollowUp[]
    try {
      rows =
        !progress || progress.loading || progress.failed
          ? (await window.sesAgent.listBusinessFollowUps()).filter((row) => row.reviewId === entry.objectId)
          : (progress.indexes.case.get(entry.objectId) ?? [])
    } catch (cause) {
      // Not known whether follow-ups are open: ask again rather than end the case without asking.
      setError(localizedIpcError(locale, cause, t('读取跟进失败，请重试。', '対応記録を読み込めませんでした。もう一度お試しください。')))
      return
    }
    // 待进场 is not ended with the case (the start still happens), so it is not among those asked about.
    const open = rows.filter((row) => row.progress && !isInactiveProgressStage(row.progress.stage) && row.progress.stage !== 'entry')
    if (!open.length) void setCaseEnded(entry, true)
    else setEnding({ entry, open })
  }
  const confirmEnd = async (closeFollowUps: boolean) => {
    if (!ending || endingBusy) return
    setEndingBusy(true)
    const entry = ending.entry
    setEnding(null)
    try {
      // Main ends the case and its open follow-ups in one transaction: both change, or neither.
      await setCaseEnded(entry, true, false, closeFollowUps ? ending.open.length : 0)
    } finally {
      setEndingBusy(false)
    }
  }
  /** `closed`: how many open follow-ups end with the case (Main ends them in the same transaction). */
  const setCaseEnded = async (entry: BusinessFeedEntry, ended: boolean, undo = false, closed = 0) => {
    const key = businessObjectKey(entry)
    if (marks.current.has(key)) return
    marks.current.add(key)
    setPendingMarks(new Set(marks.current))
    try {
      await window.sesAgent.setJobCaseLifecycle({
        reviewId: entry.objectId,
        state: ended ? 'archived' : 'active',
        // i18n-ignore: audit reason stored by Main
        reason: ended ? '案件一覧で終了 / 在案件列表中结束' : '案件一覧で再開 / 在案件列表中激活',
        ...(ended && closed ? { closeOpenFollowUps: true } : {})
      })
      setEntries((current) => {
        const next = current.map((item) =>
          businessObjectKey(item) === key
            ? {
                ...item,
                archived: ended,
                businessStatus: ended ? ('archived' as const) : ('active' as const),
                working: ended ? false : item.working
              }
            : item
        )
        displayed.current = next
        return next
      })
      // Undoing 结束案件 puts a case HR was handling back into 负责中.
      if (!ended && undo && entry.working) {
        await window.sesAgent.setCaseWorking({ reviewId: entry.objectId, working: true })
        setEntries((current) => {
          const next = current.map((item) => (businessObjectKey(item) === key ? { ...item, working: true } : item))
          displayed.current = next
          return next
        })
      }
      // Active again, Main brought back what had ended with the case; any that could not come back are reported.
      let unresumed = 0
      if (!ended || closed) await progress?.refresh()
      if (!ended)
        unresumed = await window.sesAgent
          .listBusinessFollowUps()
          .then(
            (rows) =>
              rows.filter((row) => row.reviewId === entry.objectId && row.progress?.stage === 'closed' && row.progress.closedWithCase)
                .length
          )
          .catch(() => 0)
      setLifecycleNotice(undo ? null : { entry, ended, closed })
      setWorkingNotice(null)
      setError(
        unresumed
          ? t(
              `案件已恢复，但有 ${unresumed} 条跟进没能恢复（人员暂停营业或记录已有变化），请在跟进中查看。`,
              `案件は再開しましたが、${unresumed} 件の対応を再開できませんでした（営業停止中か記録が変更されています）。対応記録で確認してください。`
            )
          : ''
      )
      const fresh = await freshEntry(entry).catch(() => undefined)
      if (fresh) {
        // HR's own change is not news: a case that was read stays read.
        if (fresh.unseen && !entry.unseen)
          await window.sesAgent
            .markBusinessFeed({ kind: entry.kind, objectId: entry.objectId, revision: fresh.revision, action: 'seen' })
            .catch(() => undefined)
        replaceEntry(key, { revision: fresh.revision, unseen: entry.unseen, occurredAt: fresh.occurredAt })
      }
      // The app re-reads its data on this event; no separate onRefresh, so one change is one reload.
      window.dispatchEvent(new CustomEvent('ses-business-data-changed', { detail: { origin: 'hr-list' } }))
    } catch (cause) {
      setError(
        localizedIpcError(locale, cause, t('案件状态更新失败，请重试。', '案件の状態を更新できませんでした。もう一度お試しください。'))
      )
    } finally {
      marks.current.delete(key)
      setPendingMarks(new Set(marks.current))
    }
  }
  /** Matching locks only the cards it runs for once App passes busyObjectIds; the boolean locks every card. */
  const locked = (entry: BusinessFeedEntry) => (busyObjectIds ? busyObjectIds.includes(entry.objectId) : busy)
  const open = (entry: BusinessFeedEntry, action: 'view' | 'match' | 'promote') => {
    if (action === 'match' && locked(entry)) return
    onOpen(entry, action)
    if (entry.unseen) void mark(entry, 'seen')
  }
  const query = queries[kind].trim().toLocaleLowerCase()
  const people = new Map(candidates.map((person) => [person.documentId, person]))
  // Days are Tokyo days, as on 今天 and in the menu bar (Japan has no daylight saving, so a day is 24 hours).
  const tokyoToday = Date.parse(
    `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}T00:00:00+09:00`
  )
  const end = new Date(tokyoToday + 86_400_000)
  const start = new Date(tokyoToday - (timeRanges[kind] === '7d' ? 6 : timeRanges[kind] === '30d' ? 29 : 0) * 86_400_000)
  const workingView = kind === 'case' && filters.case === 'working'
  const inTimeRange = (entry: BusinessFeedEntry) =>
    timeRanges[kind] === 'all' || (Date.parse(entry.occurredAt) >= start.getTime() && Date.parse(entry.occurredAt) < end.getTime())
  /** One predicate for the list and its chip counts, so a chip counts exactly what it shows. */
  // In place through a recorded start, also when HR already marked 近期可入场 ahead of the project's end.
  const placedNow = (entry: BusinessFeedEntry) =>
    entry.kind === 'person' && (progress?.indexes.person.get(entry.objectId) ?? []).some((row) => row.progress?.stage === 'started')
  const matches = (
    entry: BusinessFeedEntry,
    filter: HrListFilter,
    keepRead = true,
    status: 'all' | CandidateBusinessStatus = personStatus
  ) =>
    entry.kind === kind &&
    (kind !== 'case' || (filter === 'all' && caseStatus === 'ended' ? entry.archived : !entry.archived)) &&
    // Cases I handle live in 负责中 only: 案件池 lists the active cases not yet taken, and a case put back
    // to the pool returns there. 负责中 shows regardless of the time range.
    (filter === 'working' ? Boolean(entry.working) : inTimeRange(entry)) &&
    !(kind === 'case' && filter === 'all' && caseStatus !== 'ended' && entry.working) &&
    (filter === 'later'
      ? entry.deferred
      : filter === 'unseen'
        ? entry.unseen || (keepRead && keptInUnread.has(businessObjectKey(entry)))
        : true) &&
    (!query || [entry.title, ...entry.fields.map((field) => field.value)].join(' ').toLocaleLowerCase().includes(query)) &&
    (kind !== 'person' ||
      status === 'all' ||
      entry.businessStatus === status ||
      // 已进场 lists everyone in place, those already marked 近期可入场 included.
      (status === 'assigned' && placedNow(entry))) &&
    (kind !== 'person' ||
      own === 'all' ||
      (own === 'unset' ? people.get(entry.objectId)?.isOwnCompany == null : String(people.get(entry.objectId)?.isOwnCompany) === own))
  // In 全部, people HR can arrange now come first; those in place or not being offered follow, each group newest first.
  const offDuty = (entry: BusinessFeedEntry) =>
    entry.kind === 'person' && (entry.businessStatus === 'assigned' || entry.businessStatus === 'paused')
  const matched = entries.filter((entry) => matches(entry, filters[kind]))
  const visible =
    kind === 'person' && filters.person === 'all' ? [...matched.filter((entry) => !offDuty(entry)), ...matched.filter(offDuty)] : matched
  // Counts leave out cards kept on screen after being read, so "unread" counts what is still unread.
  const chipCount = (filter: HrListFilter) => entries.filter((entry) => matches(entry, filter, false)).length
  // How many people each status option would show with the other filters as they are.
  const statusCount = (status: CandidateBusinessStatus) => entries.filter((entry) => matches(entry, filters[kind], true, status)).length
  const rangeNames: Record<Exclude<HrTimeRange, 'all'>, { zh: string; ja: string }> = {
    today: { zh: '今天', ja: '今日' },
    '7d': { zh: '最近 7 天', ja: '直近7日' },
    '30d': { zh: '最近 30 天', ja: '直近30日' }
  }
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize))
  const page = Math.min(pages[kind], totalPages)
  const firstIndex = (page - 1) * pageSize
  const changePage = (next: number) => {
    setPages((current) => ({ ...current, [kind]: next }))
    scrolls.current[kind] = 0
    if (scroller.current) scroller.current.scrollTop = 0
    saveHrPosition(kind, { page: next, scroll: 0 })
  }
  useEffect(() => {
    if (!loading && pages[kind] !== page) changePage(page)
  }, [kind, loading, page, pages[kind]])
  const changePageSize = (next: number) => {
    setPageSize(next)
    try {
      localStorage.setItem(hrListPageSizeKey, String(next))
    } catch {
      // Storage can be unavailable; the size still applies for this session.
    }
    // Keep the first card on screen within the new page.
    changePage(Math.floor(firstIndex / next) + 1)
  }
  // ←/→ turn pages unless HR is typing, a dialog is open or focus sits in a menu.
  const pageKeys = useRef({ page, totalPages, changePage })
  pageKeys.current = { page, totalPages, changePage }
  useEffect(() => {
    if (!active) return
    const turnPage = (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (
        target?.isContentEditable ||
        target?.closest?.('input, textarea, select, [contenteditable="true"], [role="menu"], .hr-detail-pane')
      )
        return
      if (!root.current || root.current.closest('[hidden]') || document.querySelector('[aria-modal="true"]')) return
      const { page: current, totalPages: total, changePage: go } = pageKeys.current
      const next = current + (event.key === 'ArrowRight' ? 1 : -1)
      if (next < 1 || next > total) return
      event.preventDefault()
      go(next)
    }
    document.addEventListener('keydown', turnPage)
    return () => document.removeEventListener('keydown', turnPage)
  }, [active])
  useEffect(() => {
    if (!deletionNotice) return
    const timer = window.setTimeout(() => setDeletionNotice(''), undoNoticeMs)
    return () => window.clearTimeout(timer)
  }, [deletionNotice])
  // The undo toast for 接手 / 结束 fades on its own; the card has already moved, so it only offers the undo.
  useEffect(() => {
    if (!workingNotice && !lifecycleNotice) return
    const timer = window.setTimeout(() => {
      setWorkingNotice(null)
      setLifecycleNotice(null)
    }, undoNoticeMs)
    return () => window.clearTimeout(timer)
  }, [workingNotice, lifecycleNotice])
  // Nothing on screen to keep steady: apply waiting updates at once instead of asking HR to refresh an empty list.
  useEffect(() => {
    if (incoming && !loading && !visible.length) void load(true)
  }, [incoming, loading, visible.length])
  const noPeople = kind === 'person' && !entries.some((entry) => entry.kind === 'person')
  // No case at all yet (first use): 案件池 is empty too, so the next step is adding one.
  const noCases = kind === 'case' && !entries.some((entry) => entry.kind === 'case')
  const shellHeader = useContext(BusinessHeaderActionsContext)
  const headerActions = shellHeader?.actions ?? null
  const root = useRef<HTMLElement>(null)
  const detailPane = useRef<HTMLElement>(null)
  const hintTimer = useRef<number | null>(null)
  const focusRowOnClose = useRef(false)
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null)
  useEffect(() => {
    const node = root.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([item]) => {
      // A hidden surface measures 0; keep the last real width so returning to it does not flash a layout.
      const width = item?.contentRect.width ?? 0
      if (width > 0) setMeasuredWidth(width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(
    () => () => {
      if (hintTimer.current !== null) window.clearTimeout(hintTimer.current)
    },
    []
  )
  const surfaceWidth = layoutWidth ?? measuredWidth
  const narrow = surfaceWidth !== null && surfaceWidth > 0 && surfaceWidth < hrListNarrowWidth
  // The 问 Agent drawer takes the side; the detail comes back when it closes.
  const showDetail = detail !== undefined && detailOpen && !shellHeader?.chatOpen
  // Narrow surfaces show one side at a time: the open detail covers the list until HR goes back.
  const listHidden = narrow && showDetail
  const closeDetail = () => {
    if (!onCloseDetail) return
    focusRowOnClose.current = true
    onCloseDetail()
  }
  // Esc closes the detail pane like the × in its header, unless a dialog or a menu takes the key first.
  useEffect(() => {
    if (!active || !showDetail || !onCloseDetail) return
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return
      event.preventDefault()
      closeDetail()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [active, showDetail, onCloseDetail])
  // Back on the full list: the row that was open keeps the keyboard position.
  useEffect(() => {
    if (showDetail || !focusRowOnClose.current) return
    focusRowOnClose.current = false
    scroller.current?.querySelector<HTMLElement>('article.hr-object-card[aria-current="true"]')?.focus()
  }, [showDetail])
  // The list column comes back after a narrow detail: put it where HR left it.
  useEffect(() => {
    if (!listHidden && scroller.current) scroller.current.scrollTop = scrolls.current[kind]
  }, [listHidden])
  const resumeDrops = kind === 'case' && Boolean(onAssessResumes)
  const inDetail = (target: EventTarget | null) => Boolean(detailPane.current?.contains(target as Node | null))
  const showDropHint = () => {
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current)
    hintTimer.current = null
    setDropHint(true)
  }
  const dateLabel = (iso: string) => {
    const date = new Date(iso)
    const sameYear = date.getFullYear() === new Date().getFullYear()
    return date.toLocaleString(t('zh-CN', 'ja-JP'), {
      ...(sameYear ? {} : { year: 'numeric' as const }),
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  }
  const shortDate = (iso: string) => {
    const date = new Date(iso)
    const sameYear = date.getFullYear() === new Date().getFullYear()
    return date.toLocaleDateString(t('zh-CN', 'ja-JP'), {
      ...(sameYear ? {} : { year: 'numeric' as const }),
      month: 'numeric',
      day: 'numeric'
    })
  }
  /** Where the object came from, in HR's words; a person read from a local resume says nothing extra. */
  const sourceName = (entry: BusinessFeedEntry) =>
    entry.kind === 'case'
      ? (jobCaseSourceTypes as readonly string[]).includes(entry.source)
        ? jobCaseSourceTypeLabel(entry.source as JobCaseSourceType, t)
        : ''
      : entry.source === 'gmail'
        ? 'Gmail'
        : ''
  const businessStatusName = (status: BusinessFeedEntry['businessStatus']) =>
    personStatuses.find((item) => item.value === status)?.label ?? ''
  /**
   * The fixed four facts of a card, labelled and always in the same place so values line up across cards.
   * Display only: common Japanese phrasings read in the UI language; the stored wording stays in the tooltip.
   */
  const cardFacts = (entry: BusinessFeedEntry): Array<{ label: string; text: string; title?: string }> => {
    const fact = (label: string, keys: string[]) => {
      const shown = keys.flatMap((fieldKey) => {
        const value = entry.fields.find((item) => item.key === fieldKey && item.value.trim())?.value
        return value ? [displayFieldValue(fieldKey, value, zh)] : []
      })
      const text = shown.map((item) => item.text).join(' · ')
      const originals = shown.flatMap((item) => (item.original === null ? [] : [item.original]))
      return { label, text, title: text ? [text, ...originals].join('\n') : undefined }
    }
    if (entry.kind === 'case')
      return [
        fact(t('单价', '単価'), ['rate']),
        fact(t('地点', '勤務地'), ['location']),
        fact(t('工作方式', '勤務形態'), ['work_style', 'remote']),
        fact(t('开始', '開始'), ['start_date'])
      ]
    const status = businessStatusName(entry.businessStatus)
    // In place: where and since when, instead of repeating the status the badge already shows.
    const placement = (progress?.indexes.person.get(entry.objectId) ?? []).find((row) => row.progress?.stage === 'started')
    const placedCase = placement ? cases.find((item) => item.reviewId === placement.reviewId) : undefined
    const placedTitle = placedCase?.fields.find((field) => field.key === 'title')?.value || placedCase?.redactedSubject || ''
    const since = placement?.progress?.entry.actualDate
    const placedText = placement
      ? // The date first, so a long case title cannot cut it off.
        [
          since
            ? t(
                `${Number(since.slice(5, 7))}/${Number(since.slice(8, 10))} 起`,
                `${Number(since.slice(5, 7))}/${Number(since.slice(8, 10))}〜`
              )
            : '',
          placedTitle
        ]
          .filter(Boolean)
          .join(' · ')
      : ''
    return [
      fact(t('经验', '経験'), ['experience_years']),
      fact(t('可入场', '稼働開始'), ['availability']),
      fact(t('工作方式', '勤務形態'), ['work_style', 'remote']),
      placedText
        ? { label: t('进场案件', '参画案件'), text: placedText, title: placedText }
        : { label: t('营业状态', '営業状況'), text: status, title: status || undefined }
    ]
  }
  return (
    <section
      ref={root}
      className={['hr-object-list', showDetail ? 'has-detail' : '', narrow ? 'is-narrow' : '', listHidden ? 'is-detail-focused' : '']
        .filter(Boolean)
        .join(' ')}
      onDragEnter={(event) => {
        if (resumeDrops && !inDetail(event.target) && event.dataTransfer.types.includes('Files')) showDropHint()
      }}
      onDragOver={(event) => {
        if (resumeDrops && !inDetail(event.target) && event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'none'
          showDropHint()
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropHint(false)
          setDragTarget(null)
        }
      }}
      onDrop={(event) => {
        if (resumeDrops && !inDetail(event.target) && event.dataTransfer.files.length) {
          event.preventDefault()
          event.stopPropagation()
          setDragTarget(null)
          // Dropped beside the cases: say where resumes go, then step aside.
          showDropHint()
          hintTimer.current = window.setTimeout(() => {
            hintTimer.current = null
            setDropHint(false)
          }, 4000)
        }
      }}
      aria-label={kind === 'case' ? t('案件业务列表', '案件一覧') : t('人员业务列表', '要員一覧')}
    >
      <div className="hr-list-toolbar">
        <label className="hr-search">
          <Icon name="search" size={15} />
          <input
            ref={search}
            aria-label={t('搜索案件或人员', '案件・要員を検索')}
            aria-keyshortcuts="/"
            placeholder={
              kind === 'case'
                ? t('搜索案件、技能、地点（/）', '案件名・スキル・勤務地（/）')
                : t('搜索姓名、技能、角色（/）', '氏名・スキル・役割（/）')
            }
            value={queries[kind]}
            onChange={(event) => {
              setQueries((current) => ({ ...current, [kind]: event.target.value }))
              changePage(1)
            }}
          />
        </label>
        {kind === 'case' ? (
          <button className="hr-primary" onClick={onIntake} type="button">
            <Icon name="upload" size={14} />
            {t('新增案件', '案件を追加')}
          </button>
        ) : (
          <ActionMenu
            label={t('导入人员', '要員を取り込む')}
            triggerClassName="hr-primary"
            trigger={
              <>
                <Icon name="upload" size={14} />
                {t('导入人员', '要員を取り込む')}
              </>
            }
          >
            <button role="menuitem" onClick={onIntake} type="button">
              {t('粘贴人员介绍', '要員紹介を貼り付け')}
            </button>
            <button role="menuitem" onClick={onImportResume} type="button">
              {t('导入简历文件', '履歴書ファイルを取り込む')}
            </button>
          </ActionMenu>
        )}
        {onImportHistory ? (
          <button onClick={onImportHistory} type="button">
            {kind === 'case' ? t('批量导入', '一括取込') : t('导入记录', '取込履歴')}
          </button>
        ) : null}
        {extraActions
          .filter((action) => !action.overflow)
          .map((action) => (
            <button key={action.id} onClick={action.onSelect} type="button">
              {action.label}
            </button>
          ))}
        {onOpenLibrary ? (
          <button className="hr-quiet" onClick={onOpenLibrary} type="button">
            <Icon name="file" size={14} />
            {kind === 'person' ? t('完整人员资料', '要員の全資料') : t('完整案件资料', '案件の全資料')}
          </button>
        ) : null}
        {extraActions.some((action) => action.overflow) ? (
          <ActionMenu label={t('更多', 'その他')} trigger={t('更多', 'その他')} triggerClassName="hr-quiet">
            {extraActions
              .filter((action) => action.overflow)
              .map((action) => (
                <button key={action.id} role="menuitem" onClick={action.onSelect} type="button">
                  {action.label}
                </button>
              ))}
          </ActionMenu>
        ) : null}
        {headerActions ? <div className="hr-list-toolbar-end">{headerActions}</div> : null}
      </div>
      <div className="hr-list-column" hidden={listHidden}>
        <div className="hr-list-filters">
          {hrListFilters[kind].map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={filters[kind] === value}
              onClick={() => {
                setFilters((current) => ({ ...current, [kind]: value }))
                setKeptInUnread(new Set())
                if (kind === 'person') saveHrPosition(kind, { filter: value })
                changePage(1)
              }}
            >
              {
                {
                  working: t('负责中', '担当中'),
                  all: kind === 'case' ? t('案件池', '案件プール') : t('全部', 'すべて'),
                  unseen: t('未读', '未読'),
                  later: t('稍后处理', 'あとで対応')
                }[value]
              }
              {kind === 'case' && value !== 'all' ? ` ${chipCount(value)}` : ''}
            </button>
          ))}
          {kind === 'case' && filters.case === 'all' ? (
            <select
              aria-label={t('案件状态', '案件の状態')}
              value={caseStatus}
              onChange={(event) => {
                setCaseStatus(event.target.value as 'active' | 'ended')
                changePage(1)
              }}
            >
              <option value="active">{t('进行中', '進行中')}</option>
              <option value="ended">{t('已结束', '終了')}</option>
            </select>
          ) : null}
          <select
            hidden={workingView}
            aria-label={t('列表时间范围', '一覧の期間')}
            value={timeRanges[kind]}
            onChange={(event) => {
              const timeRange = event.target.value as HrTimeRange
              setTimeRanges((current) => ({ ...current, [kind]: timeRange }))
              saveHrPosition(kind, { timeRange })
              changePage(1)
            }}
          >
            <option value="today">{t('今天', '今日')}</option>
            <option value="7d">{t('最近 7 天', '直近7日')}</option>
            <option value="30d">{t('最近 30 天', '直近30日')}</option>
            <option value="all">{t('全部时间', '全期間')}</option>
          </select>
          {kind === 'person' ? (
            <select
              aria-label={t('营业状态筛选', '営業状態で絞り込み')}
              value={personStatus}
              onChange={(event) => {
                setPersonStatus(event.target.value as typeof personStatus)
                changePage(1)
              }}
            >
              <option value="all">{t('全部状态', '状態すべて')}</option>
              {personStatuses.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label} ({statusCount(item.value)})
                </option>
              ))}
            </select>
          ) : null}
          {kind === 'person' ? (
            <select
              aria-label={t('自社筛选', '自社所属で絞り込み')}
              value={own}
              onChange={(event) => {
                setOwn(event.target.value)
                changePage(1)
              }}
            >
              <option value="all">{t('全部所属', '所属すべて')}</option>
              <option value="true">自社</option>
              <option value="false">非自社</option>
              <option value="unset">{t('未设置', '未設定')}</option>
            </select>
          ) : null}
          <span>
            {visible.length} {t('条', '件')}
          </span>
          <button
            className="hr-list-refresh"
            disabled={loading}
            onClick={() => {
              setLoading(true)
              void onRefresh()
                .then(() => load(true))
                .catch((cause) => {
                  setError(localizedIpcError(locale, cause, t('无法读取业务列表。', '業務一覧を読み込めませんでした。')))
                  setLoading(false)
                })
            }}
            type="button"
          >
            {t('刷新', '再読込')}
          </button>
        </div>
        {resumeDrops && visible.length && dropHint ? (
          <p className="case-list-drop-help" role="status">
            {t('把简历拖到具体案件上，右侧直接查看人员匹配评估。', '履歴書を案件カードにドロップすると、右側で要員の適合性を評価します。')}
          </p>
        ) : null}
        {incoming && visible.length ? (
          <div className="hr-list-update">
            <span>{t('有更新可查看', '更新情報があります')}</span>
            <button onClick={() => void load(true)} type="button">
              {t('更新列表', '一覧を更新')}
            </button>
          </div>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        {ending ? (
          <div className="business-delete-backdrop" onClick={(event) => event.stopPropagation()}>
            <section
              className="business-delete-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={t('结束案件', '案件を終了')}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !endingBusy) setEnding(null)
              }}
            >
              <h3>{t('结束案件', '案件を終了')}</h3>
              <p className="business-delete-target">{ending.entry.title}</p>
              <p>
                {t(
                  `这个案件还有 ${ending.open.length} 条跟进没有结束。案件结束期间不能再约面试；重新激活案件后，一并结束的跟进会自动恢复。待进场的跟进不受影响，照常确认到岗。`,
                  `この案件には終了していない対応が ${ending.open.length} 件あります。終了中は面談を予約できません。案件を再開すると、まとめて終了した対応は自動で再開します。参画準備中の対応はそのまま進められます。`
                )}
              </p>
              <div className="business-delete-actions">
                <button className="business-delete-cancel" type="button" disabled={endingBusy} onClick={() => setEnding(null)}>
                  {t('取消', 'キャンセル')}
                </button>
                <button type="button" disabled={endingBusy} onClick={() => void confirmEnd(false)}>
                  {t('只结束案件', '案件のみ終了')}
                </button>
                <button className="business-delete-confirm" type="button" disabled={endingBusy} onClick={() => void confirmEnd(true)}>
                  {endingBusy ? t('处理中…', '処理中…') : t('一并结束跟进', '対応もまとめて終了')}
                </button>
              </div>
            </section>
          </div>
        ) : null}
        {deletionNotice ? (
          <p className="hr-working-notice" role="status">
            <span>{deletionNotice}</span>
          </p>
        ) : null}
        {lifecycleNotice && kind === 'case' ? (
          <p className="hr-working-notice" role="status" title={lifecycleNotice.entry.title}>
            {lifecycleNotice.ended ? (
              <span>{t(`已结束：${lifecycleNotice.entry.title}`, `終了しました：${lifecycleNotice.entry.title}`)}</span>
            ) : (
              <span>{t(`已激活：${lifecycleNotice.entry.title}`, `再開しました：${lifecycleNotice.entry.title}`)}</span>
            )}
            <button
              type="button"
              disabled={pendingMarks.has(businessObjectKey(lifecycleNotice.entry))}
              onClick={() => void setCaseEnded(lifecycleNotice.entry, !lifecycleNotice.ended, true, lifecycleNotice.closed)}
            >
              {t('撤销', '元に戻す')}
            </button>
          </p>
        ) : null}
        {workingNotice && kind === 'case' ? (
          <p className="hr-working-notice" role="status" title={workingNotice.entry.title}>
            {workingNotice.working ? (
              <span>{t(`已接手：${workingNotice.entry.title}`, `担当しました：${workingNotice.entry.title}`)}</span>
            ) : (
              <span>{t(`已放回案件池：${workingNotice.entry.title}`, `案件プールに戻しました：${workingNotice.entry.title}`)}</span>
            )}
            <button
              type="button"
              disabled={pendingMarks.has(businessObjectKey(workingNotice.entry))}
              onClick={() => void setWorking(workingNotice.entry, !workingNotice.working, true)}
            >
              {t('撤销', '元に戻す')}
            </button>
          </p>
        ) : null}
        <div
          className="hr-object-scroll"
          ref={scroller}
          onScroll={(event) => {
            scrolls.current[kind] = event.currentTarget.scrollTop
            saveHrPosition(kind, { scroll: event.currentTarget.scrollTop })
          }}
          onKeyDown={(event) => {
            // ↑/↓ move between rows while a row itself has focus; Enter on a row opens it.
            if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !(event.target as HTMLElement).matches('article.hr-object-card')) return
            const cards = [...event.currentTarget.querySelectorAll<HTMLElement>('article.hr-object-card')]
            const next = cards[cards.indexOf(event.target as HTMLElement) + (event.key === 'ArrowDown' ? 1 : -1)]
            if (!next) return
            event.preventDefault()
            next.focus()
            next.scrollIntoView?.({ block: 'nearest' })
          }}
        >
          {loading && !entries.length ? <p role="status">{t('正在读取…', '読込中…')}</p> : null}
          {!loading && !visible.length && noPeople && !incoming ? (
            <div className="hr-empty">
              <p>
                {t(
                  '还没有人员。导入简历，或把案件里评估过的人员加入人员库。',
                  '要員はまだいません。履歴書を取り込むか、案件で評価した要員を要員リストに追加してください。'
                )}
              </p>
              <button className="hr-primary" onClick={onImportResume} type="button">
                <Icon name="upload" size={14} />
                {t('导入人员', '要員を取り込む')}
              </button>
            </div>
          ) : !loading && !visible.length && noCases && !incoming && !query ? (
            <div className="hr-empty">
              <p>
                {t(
                  '还没有案件。粘贴案件信息，或从邮件、EML 导入。',
                  '案件はまだありません。案件情報を貼り付けるか、メールや EML から取り込んでください。'
                )}
              </p>
              <button className="hr-primary" onClick={onIntake} type="button">
                <Icon name="plus" size={14} />
                {t('粘贴或导入案件', '案件を貼り付け・取り込む')}
              </button>
            </div>
          ) : !loading && !visible.length && workingView && !query ? (
            <div className="hr-empty">
              <p>
                {t(
                  '还没有负责中的案件。在「案件池」里接手正在跟的案件，下次打开列表就先看到它们。',
                  '担当中の案件はまだありません。「案件プール」から担当する案件を選ぶと、次回から最初に表示されます。'
                )}
              </p>
              <button
                type="button"
                onClick={() => {
                  setFilters((current) => ({ ...current, case: 'all' }))
                  setTimeRanges((current) => ({ ...current, case: 'all' }))
                  changePage(1)
                }}
              >
                {t('去案件池', '案件プールを見る')}
              </button>
            </div>
          ) : !loading && !visible.length && !query && timeRanges[kind] !== 'all' && !workingView ? (
            <div className="hr-empty">
              <p>
                {(() => {
                  const { zh: zhRange, ja: jaRange } = rangeNames[timeRanges[kind] as Exclude<HrTimeRange, 'all'>]
                  return kind === 'case'
                    ? t(`${zhRange}没有符合条件的案件。`, `${jaRange}の条件に一致する案件はありません。`)
                    : t(`${zhRange}没有符合条件的人员。`, `${jaRange}の条件に一致する要員はいません。`)
                })()}
              </p>
              <button
                type="button"
                onClick={() => {
                  setTimeRanges((current) => ({ ...current, [kind]: 'all' }))
                  saveHrPosition(kind, { timeRange: 'all' })
                  changePage(1)
                }}
              >
                {t('查看全部时间', '全期間を見る')}
              </button>
            </div>
          ) : !loading && !visible.length ? (
            <p className="hr-empty">
              {kind === 'case' && filters.case === 'all' && caseStatus === 'ended' && !query
                ? t('没有已结束的案件。', '終了した案件はありません。')
                : t(
                    '没有符合条件的记录。可以调整筛选，或导入新的资料。',
                    '条件に一致する情報がありません。絞り込みを変更するか、新しい情報を取り込んでください。'
                  )}
            </p>
          ) : null}
          {visible.length ? (
            <div className="hr-card-grid">
              {visible.slice(firstIndex, firstIndex + pageSize).map((entry) => {
                const dropAvailable =
                  kind === 'case' && usable(entry) && cases.some((job) => job.reviewId === entry.objectId && job.lifecycle === 'active')
                const resumeState = resumeStates[entry.objectId]
                const key = businessObjectKey(entry)
                const selected = key === selectedKey
                const person = people.get(entry.objectId)
                const skills = cardSkillItems(entry.fields.find((field) => ['skills', 'required_skills'].includes(field.key))?.value ?? '')
                // Titles are often the skill list itself: a chip that only repeats the title says nothing new.
                const titleText = foldText(entry.title)
                const chips = skills.filter((skill) => !titleText.includes(foldText(skill)))
                const facts = cardFacts(entry)
                const changes = cardChangeLabels(entry, zh)
                const relations = progress?.indexes[kind].get(entry.objectId) ?? []
                const next = progress ? nextProgressAppointment(relations, progress.now) : undefined
                const nextState = next && progress ? progressPresentation(next, progress.now, zh) : undefined
                // Suggest, never perform, removal once every follow-up of a working case has ended or started work.
                // A paused follow-up is not over; once someone is in place, the case is filled rather than free again.
                const removable =
                  kind === 'case' &&
                  entry.working &&
                  progress &&
                  !progress.loading &&
                  relations.length > 0 &&
                  !relations.some((row) => isActiveProgress(row) || row.progress?.stage === 'paused')
                const nextName = next
                  ? kind === 'person'
                    ? cases.find((item) => item.reviewId === next.reviewId)?.fields.find((field) => field.key === 'title')?.value ||
                      cases.find((item) => item.reviewId === next.reviewId)?.redactedSubject
                    : people.get(next.documentId)?.localIdentity?.displayName || people.get(next.documentId)?.fileName
                  : undefined
                const nextLabel =
                  !progress?.failed && nextState?.when
                    ? `${new Date(nextState.when.length === 10 ? `${nextState.when}T00:00:00+09:00` : nextState.when).toLocaleString(
                        t('zh-CN', 'ja-JP'),
                        {
                          timeZone: 'Asia/Tokyo',
                          month: 'numeric',
                          day: 'numeric',
                          ...(nextState.when.length > 10 ? { hour: '2-digit', minute: '2-digit', hour12: false } : {})
                        }
                      )} · ${nextState.label}${nextName ? ` · ${nextName}` : ''}`
                    : ''
                const progressText = progress
                  ? progress.failed
                    ? t('营业情况读取失败，点击重试', '営業状況を読み込めませんでした。再試行')
                    : progressSummary(relations, kind, progress.now, zh)
                  : ''
                // The follow-up line shows only when there are follow-ups (or reading them failed).
                const placementRow = relations.find((row) => row.progress?.stage === 'started')
                const hasPlacement = Boolean(placementRow)
                // Straight to the placement record on 跟进, where 记录退场 is.
                const openPlacement = () =>
                  placementRow && onOpenFollowUp
                    ? onOpenFollowUp({ documentId: placementRow.documentId, reviewId: placementRow.reviewId })
                    : onOpenProgress
                      ? onOpenProgress(entry)
                      : open(entry, 'view')
                // A placed person whose only follow-up is that placement: the 进场案件 field already says it.
                const onlyPlacement =
                  kind === 'person' &&
                  entry.businessStatus === 'assigned' &&
                  relations.length > 0 &&
                  relations.every((row) => row.progress?.stage === 'started')
                const showProgress = Boolean(progress && !progress.loading && (progress.failed || (relations.length && !onlyPlacement)))
                const progressTone = progress?.failed ? 'is-danger' : relations.some(isActiveProgress) ? 'is-active' : 'is-muted'
                const cardLocked = locked(entry)
                const assessing = kind === 'case' && Boolean(onAssessResumes)
                const ended = kind === 'case' && entry.archived
                // Why the primary 「找人」/「找案件」 is unavailable, shown as its tooltip and accessible description.
                const matchReason =
                  !assessing && cardLocked
                    ? t('正在评估中，请稍候', '評価中です。しばらくお待ちください')
                    : !usable(entry)
                      ? kind === 'case'
                        ? t('案件已结束', '案件は終了しています')
                        : t('人员当前不可安排', '要員は現在稼働できません')
                      : assessing && !dropAvailable
                        ? t('资料不完整', '資料が不完全です')
                        : undefined
                const promoteReason = usable(entry)
                  ? undefined
                  : kind === 'case'
                    ? t('案件已结束', '案件は終了しています')
                    : t('人员当前不可安排', '要員は現在稼働できません')
                const matchCount = kind === 'person' ? (personMatchCounts[entry.objectId] ?? 0) : 0
                const sameName =
                  entry.kind === 'person' &&
                  entries.some((other) => other.kind === 'person' && other.objectId !== entry.objectId && other.title === entry.title)
                const source = sourceName(entry)
                return (
                  <article
                    key={key}
                    className={[
                      'hr-object-card',
                      selected ? 'is-selected' : '',
                      entry.unseen ? 'is-unseen' : '',
                      kind === 'person' && (entry.businessStatus === 'assigned' || hasPlacement) ? 'is-placed' : '',
                      kind === 'person' && entry.businessStatus === 'paused' ? 'is-paused' : '',
                      dragTarget === key ? 'is-resume-drag-target' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onDragOver={(event) => {
                      if (resumeDrops && event.dataTransfer.types.includes('Files')) {
                        event.preventDefault()
                        event.stopPropagation()
                        event.dataTransfer.dropEffect = dropAvailable ? 'copy' : 'none'
                        setDragTarget(key)
                        setDropHint(false)
                      }
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                        setDragTarget((current) => (current === key ? null : current))
                    }}
                    onDrop={(event) => {
                      if (resumeDrops && event.dataTransfer.files.length) {
                        event.preventDefault()
                        event.stopPropagation()
                        setDragTarget(null)
                        setDropHint(false)
                        if (dropAvailable) {
                          onAssessResumes!(entry, Array.from(event.dataTransfer.files))
                          if (entry.unseen) void mark(entry, 'seen')
                        }
                      }
                    }}
                    tabIndex={0}
                    aria-label={entry.title}
                    aria-current={selected ? 'true' : undefined}
                    onClick={(event) => {
                      if (
                        !(event.target as HTMLElement).closest('button,summary,details,[role="menu"]') &&
                        !window.getSelection()?.toString()
                      )
                        open(entry, 'view')
                    }}
                    onKeyDown={(event) => {
                      if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) {
                        event.preventDefault()
                        open(entry, 'view')
                      }
                    }}
                  >
                    {dragTarget === key ? (
                      <p className="case-card-drop-caption" role="status">
                        {dropAvailable
                          ? t('松开后，评估与此案件的匹配程度', 'ドロップして、この案件との適合性を評価')
                          : t('案件暂不可评估', 'この案件は評価できません')}
                      </p>
                    ) : null}
                    <div className="hr-card-head">
                      <h2
                        className="hr-row-title"
                        // Same-name people stay distinguishable on hover without showing an internal number on the card.
                        title={
                          sameName
                            ? `${entry.title} · ${t('资料编号', '資料番号')} ${entry.objectId.slice(0, 8).toUpperCase()}`
                            : entry.title
                        }
                      >
                        {entry.title}
                      </h2>
                      <div className="hr-card-meta">
                        {/* 负责中 lists only my cases and 案件池 none of them; the badge tells them apart where both appear. */}
                        {kind === 'case' && entry.working && !['working', 'all'].includes(filters.case) ? (
                          <b className="hr-working-badge">{t('负责中', '担当中')}</b>
                        ) : null}
                        {ended ? <b className="hr-ended-badge">{t('已结束', '終了')}</b> : null}
                        {/* 待机中 is the usual state and carries no badge; the others stand out at a glance. */}
                        {kind === 'person' && ['soon', 'assigned', 'paused'].includes(entry.businessStatus) ? (
                          <b className={`hr-status-badge is-${entry.businessStatus}`}>{businessStatusName(entry.businessStatus)}</b>
                        ) : null}
                        {kind === 'person' && person?.inTalentLibrary === false ? (
                          <span className="hr-row-tag is-outside">{t('未入库', '未登録')}</span>
                        ) : null}
                        {kind === 'person' ? (
                          person?.isOwnCompany == null ? (
                            <span className="hr-visually-hidden">{t('是否自社：未设置', '自社所属：未設定')}</span>
                          ) : (
                            <span className="hr-row-tag is-quiet">{person.isOwnCompany ? '自社' : '非自社'}</span>
                          )
                        ) : null}
                        <span className="hr-card-meta-text">
                          <time className="hr-row-date" dateTime={entry.occurredAt} title={dateLabel(entry.occurredAt)}>
                            {shortDate(entry.occurredAt)}
                          </time>
                          {source ? <span className="hr-card-source"> · {source}</span> : null}
                        </span>
                        {entry.unseen ? (
                          <span className="hr-unread-dot" title={t('未读', '未読')}>
                            <span className="hr-visually-hidden">{t('未读', '未読')}</span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {changes.length ? (
                      <div className="hr-row-changes" aria-label={t('本次变更', '今回の変更')}>
                        {changes.map((change) => (
                          <span key={change}>{change}</span>
                        ))}
                      </div>
                    ) : null}
                    {chips.length ? (
                      <ul className="hr-row-chips" aria-label={kind === 'case' ? t('必需技能', '必須スキル') : t('技能', 'スキル')}>
                        {chips.slice(0, cardSkillLimit).map((skill, index) => (
                          <li key={index} title={skill}>
                            {skill}
                          </li>
                        ))}
                        {chips.length > cardSkillLimit ? (
                          // The rest of the requirements stay whole in the tooltip and in the detail.
                          <li className="hr-row-more" title={chips.slice(cardSkillLimit).join('\n')}>
                            +{chips.length - cardSkillLimit}
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                    {facts.every((fact) => !fact.text) ? (
                      // Four dashes in a row say less than one line naming what is missing.
                      <p className="hr-card-facts-empty">
                        {t(
                          `${facts.map((fact) => fact.label).join('、')}均未填写`,
                          `${facts.map((fact) => fact.label).join('・')}は未入力`
                        )}
                      </p>
                    ) : (
                      <dl className="hr-card-facts">
                        {facts.map((fact) => (
                          <div className="hr-card-fact" key={fact.label}>
                            <dt>{fact.label}</dt>
                            {fact.text ? (
                              <dd title={fact.title}>{fact.text}</dd>
                            ) : (
                              <dd className="is-empty" title={t(`${fact.label}未填写`, `${fact.label}未入力`)}>
                                —
                              </dd>
                            )}
                          </div>
                        ))}
                      </dl>
                    )}
                    {showProgress ? (
                      <div className="hr-card-progress">
                        <button
                          className={`hr-row-progress ${progressTone}`}
                          type="button"
                          title={nextLabel ? `${progressText} · ${nextLabel}` : progressText}
                          onClick={() => {
                            if (progress!.failed) void progress!.refresh()
                            else if (onOpenProgress) onOpenProgress(entry)
                            else open(entry, 'view')
                          }}
                        >
                          {progressText}
                          {nextLabel ? <span className="hr-row-progress-next"> · {nextLabel}</span> : null}
                        </button>
                      </div>
                    ) : null}
                    {removable ? (
                      <p className="hr-working-hint">
                        {relations.some((row) => row.progress?.stage === 'started')
                          ? t(
                              '已有人员进场，其余跟进也已结束。招满后可以结束案件。',
                              '参画が決まり、他の対応も終了しています。充足したら案件を終了できます。'
                            )
                          : t('这个案件的跟进都已结束。可以放回案件池。', 'この案件の対応はすべて終了しています。案件プールに戻せます。')}
                      </p>
                    ) : null}
                    <div className="hr-row-actions">
                      {kind === 'person' &&
                      entry.businessStatus === 'assigned' &&
                      !hasPlacement &&
                      // While follow-ups are still loading the placement is not known yet: not the legacy case.
                      !progress?.loading ? (
                        // Marked 已进场 by hand before it followed placements: nothing to leave, the status is set in the profile.
                        <button className="hr-primary" type="button" onClick={() => open(entry, 'view')}>
                          {t('调整营业状态', '営業状態を変更')}
                        </button>
                      ) : kind === 'person' && entry.businessStatus === 'assigned' ? (
                        // In place: the placement record (with 记录退场) is what HR needs, not matching.
                        <>
                          <button className="hr-primary" type="button" onClick={openPlacement}>
                            {t('查看进场记录', '参画記録を見る')}
                          </button>
                          <button className="hr-secondary" type="button" onClick={openPlacement}>
                            {t('记录退场', '退場を記録')}
                          </button>
                        </>
                      ) : kind === 'person' && hasPlacement && entry.businessStatus === 'soon' ? (
                        // In place but ending soon: HR looks for the next case and still records 退场 when it ends.
                        <>
                          <button className="hr-primary" disabled={locked(entry)} onClick={() => open(entry, 'match')} type="button">
                            {matchCount ? `${t('可提案案件', '提案可能な案件')} (${matchCount})` : t('找案件', '案件を探す')}
                          </button>
                          <button className="hr-secondary" type="button" onClick={openPlacement}>
                            {t('记录退场', '退場を記録')}
                          </button>
                        </>
                      ) : kind === 'person' && entry.businessStatus === 'paused' ? (
                        <button
                          className="hr-primary"
                          type="button"
                          disabled={pendingMarks.has(key)}
                          onClick={() => void resumeOffering(entry)}
                        >
                          {t('恢复营业', '営業を再開')}
                        </button>
                      ) : (
                        <>
                          {ended ? (
                            // An ended case offers re-activation instead of looking for people or broadcasting.
                            <button
                              className="hr-primary"
                              disabled={pendingMarks.has(key)}
                              onClick={() => void setCaseEnded(entry, false)}
                              type="button"
                            >
                              {t('激活案件', '案件を再開')}
                            </button>
                          ) : assessing ? (
                            <button
                              className="hr-primary"
                              disabled={Boolean(matchReason)}
                              title={matchReason}
                              aria-describedby={matchReason ? `${reasonId}-${key}-match` : undefined}
                              onClick={() => onAssessResumes!(entry)}
                              type="button"
                            >
                              {resumeState?.pending
                                ? `${t('查看人员', '要員を見る')} · ${t('评估中', '評価中')}`
                                : resumeState?.count
                                  ? `${t('查看人员', '要員を見る')} (${resumeState.count})`
                                  : t('找人', '要員を探す')}
                            </button>
                          ) : (
                            <button
                              className="hr-primary"
                              disabled={Boolean(matchReason)}
                              title={matchReason}
                              aria-describedby={matchReason ? `${reasonId}-${key}-match` : undefined}
                              onClick={() => open(entry, 'match')}
                              type="button"
                            >
                              {kind === 'case'
                                ? t('找人', '要員を探す')
                                : matchCount
                                  ? `${t('可提案案件', '提案可能な案件')} (${matchCount})`
                                  : t('找案件', '案件を探す')}
                            </button>
                          )}
                          {matchReason && !ended ? (
                            <span className="hr-visually-hidden" id={`${reasonId}-${key}-match`}>
                              {matchReason}
                            </span>
                          ) : null}
                          {kind === 'case' && !entry.archived && !entry.working ? (
                            // In 案件池 taking a case over is the next step, so it comes right after 找人.
                            <button
                              className="hr-secondary"
                              disabled={pendingMarks.has(key) || !usable(entry)}
                              onClick={() => void setWorking(entry, true)}
                              type="button"
                            >
                              {t('接手', '担当する')}
                            </button>
                          ) : null}
                          {ended ? null : (
                            <button
                              className="hr-secondary"
                              disabled={Boolean(promoteReason)}
                              title={promoteReason}
                              aria-describedby={promoteReason ? `${reasonId}-${key}-promote` : undefined}
                              onClick={() => open(entry, 'promote')}
                              type="button"
                            >
                              {kind === 'case' ? t('群发案件', '案件を配信') : t('准备介绍', '紹介を準備')}
                            </button>
                          )}
                          {promoteReason && !ended ? (
                            <span className="hr-visually-hidden" id={`${reasonId}-${key}-promote`}>
                              {promoteReason}
                            </span>
                          ) : null}
                        </>
                      )}
                      {kind === 'case' && !entry.archived && entry.working ? (
                        <button
                          className="hr-secondary"
                          disabled={pendingMarks.has(key)}
                          onClick={() => void requestEnd(entry)}
                          type="button"
                        >
                          {t('结束案件', '案件を終了')}
                        </button>
                      ) : kind === 'person' ? (
                        <button
                          className="hr-secondary"
                          disabled={pendingMarks.has(key)}
                          onClick={() => void mark(entry, entry.deferred ? 'done' : 'defer')}
                          type="button"
                        >
                          {entry.deferred ? t('移出稍后处理', 'あとで対応から外す') : t('稍后处理', 'あとで対応')}
                        </button>
                      ) : null}
                      <ActionMenu
                        label={t(`更多操作：${entry.title}`, `その他の操作：${entry.title}`)}
                        triggerClassName="hr-menu-trigger"
                        trigger={<span aria-hidden="true">…</span>}
                      >
                        {kind === 'case' && !entry.archived ? (
                          entry.working ? (
                            <button
                              role="menuitem"
                              disabled={pendingMarks.has(key)}
                              onClick={() => void setWorking(entry, false)}
                              type="button"
                            >
                              {t('放回案件池', '案件プールに戻す')}
                            </button>
                          ) : (
                            <button role="menuitem" disabled={pendingMarks.has(key)} onClick={() => void requestEnd(entry)} type="button">
                              {t('结束案件', '案件を終了')}
                            </button>
                          )
                        ) : null}
                        <BusinessObjectDeleteButton
                          kind={entry.kind}
                          id={entry.objectId}
                          title={entry.title}
                          disabled={cardLocked || pendingMarks.has(key)}
                          onDeleted={async (report) => {
                            setDeletionNotice(
                              report.outcome === 'partial-failure'
                                ? t('资料已删除，部分关联数据清理失败。', '資料は削除済みですが、一部の関連データを消去できませんでした。')
                                : t('删除成功', '削除しました')
                            )
                            sequence.current++
                            const next = displayed.current.filter((item) => businessObjectKey(item) !== key)
                            displayed.current = next
                            setEntries((current) => current.filter((item) => businessObjectKey(item) !== key))
                            if (onDeleted) await onDeleted(entry)
                            else await onRefresh()
                            await progress?.refresh()
                          }}
                        />
                      </ActionMenu>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : null}
        </div>
        {visible.length > hrListPageSizes[0] ? (
          <nav className="hr-list-pagination" aria-label={t('列表分页', '一覧のページ切替')}>
            <span>{t(`共 ${visible.length} 条`, `全 ${visible.length} 件`)}</span>
            {totalPages > 1 ? (
              <>
                <button type="button" aria-label={t('上一页', '前のページ')} disabled={page === 1} onClick={() => changePage(page - 1)}>
                  ‹
                </button>
                {pageNumbers(page, totalPages).map((item, index) =>
                  item === null ? (
                    <span key={`gap-${index}`} className="hr-page-gap" aria-hidden="true">
                      …
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      className="hr-page-number"
                      aria-current={item === page ? 'page' : undefined}
                      aria-label={t(`第 ${item} 页`, `${item} ページ目`)}
                      onClick={() => changePage(item)}
                    >
                      {item}
                    </button>
                  )
                )}
                <button
                  type="button"
                  aria-label={t('下一页', '次のページ')}
                  disabled={page === totalPages}
                  onClick={() => changePage(page + 1)}
                >
                  ›
                </button>
                <span className="sr-only" aria-live="polite">
                  {page} / {totalPages}
                </span>
              </>
            ) : null}
            <span className="hr-page-size" role="group" aria-label={t('每页条数', '1ページの件数')}>
              <span aria-hidden="true">{t('每页', '表示')}</span>
              {hrListPageSizes.map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={size === pageSize}
                  aria-label={t(`每页 ${size} 条`, `${size} 件ずつ表示`)}
                  onClick={() => changePageSize(size)}
                >
                  {size}
                </button>
              ))}
            </span>
          </nav>
        ) : null}
      </div>
      {detail !== undefined ? (
        <aside ref={detailPane} className="hr-detail-pane" aria-label={detailLabel} hidden={!showDetail}>
          {narrow ? (
            <button className="hr-detail-back" onClick={closeDetail} type="button">
              <Icon name="arrow-left" size={14} />
              {t('返回列表', '一覧に戻る')}
            </button>
          ) : null}
          <div className="hr-detail-body">{detail}</div>
        </aside>
      ) : null}
    </section>
  )
}
