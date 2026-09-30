import './case-resume-panel.css'
import { BusinessObjectDeleteButton } from './BusinessObjectDeleteButton'
import {
  isActiveProgress,
  nextProgressAppointment,
  progressPresentation,
  progressSummary,
  useBusinessProgress
} from '../business-progress-data'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { BusinessFeedEntry, CandidateReviewSnapshot, JobCaseReviewSnapshot } from '@shared'
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

const usable = (entry: BusinessFeedEntry) =>
  entry.kind === 'case' ? entry.businessStatus === 'active' : ['available', 'soon'].includes(entry.businessStatus)
const pageSize = 20

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
  filterRequest
}: {
  onAssessResumes?(entry: BusinessFeedEntry, files?: File[]): void
  resumeStates?: Record<string, { pending: number; count: number }>
  onDeleted?(entry: BusinessFeedEntry): Promise<void>
  onOpenProgress?(entry: BusinessFeedEntry): void
  cases?: JobCaseReviewSnapshot[]
  kind: HrBusinessKind
  reloadToken: unknown
  candidates: CandidateReviewSnapshot[]
  selectedKey?: string | null
  /** Legacy global lock: disables matching on every card. Superseded by busyObjectIds when that is passed. */
  busy?: boolean
  /** Objects whose matching is running; only their cards are locked. Empty means none is running. */
  busyObjectIds?: string[]
  /** Number of found cases per person (by objectId), shown as 「查看案件 (n)」. */
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
}) {
  const { locale, zh, t } = useLocaleText()
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
  const [lifecycleNotice, setLifecycleNotice] = useState<{ entry: BusinessFeedEntry; ended: boolean } | null>(null)
  // A card read while "unread" is showing stays until HR leaves that view, so it does not vanish under the cursor.
  const [keptInUnread, setKeptInUnread] = useState<Set<string>>(new Set())
  const [timeRanges, setTimeRanges] = useState<Record<HrBusinessKind, HrTimeRange>>(() => ({
    case: readHrPosition('case').timeRange,
    person: readHrPosition('person').timeRange
  }))
  const [pages, setPages] = useState(() => ({ case: readHrPosition('case').page, person: readHrPosition('person').page }))
  const [own, setOwn] = useState('all')
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
      const target = (event as CustomEvent<{ kind: string; id: string }>).detail
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
      setError('')
    } catch (cause) {
      setError(
        localizedIpcError(locale, cause, t('我的案件更新失败，请重试。', '担当案件を更新できませんでした。もう一度お試しください。'))
      )
    } finally {
      marks.current.delete(key)
      setPendingMarks(new Set(marks.current))
    }
  }
  /** Ends a case (it stops being offered for matching and introductions) or makes it active again. */
  const setCaseEnded = async (entry: BusinessFeedEntry, ended: boolean, undo = false) => {
    const key = businessObjectKey(entry)
    if (marks.current.has(key)) return
    marks.current.add(key)
    setPendingMarks(new Set(marks.current))
    try {
      await window.sesAgent.setJobCaseLifecycle({
        reviewId: entry.objectId,
        state: ended ? 'archived' : 'active',
        // i18n-ignore: audit reason stored by Main
        reason: ended ? '案件一覧で終了 / 在案件列表中结束' : '案件一覧で再開 / 在案件列表中激活'
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
      setLifecycleNotice(undo ? null : { entry, ended })
      setError('')
      const fresh = await freshEntry(entry).catch(() => undefined)
      if (fresh) replaceEntry(key, { revision: fresh.revision, unseen: fresh.unseen, occurredAt: fresh.occurredAt })
      await onRefresh()
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
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = new Date(today)
  end.setDate(end.getDate() + 1)
  const start = new Date(today)
  if (timeRanges[kind] === '7d') start.setDate(start.getDate() - 6)
  if (timeRanges[kind] === '30d') start.setDate(start.getDate() - 29)
  const workingView = kind === 'case' && filters.case === 'working'
  const inTimeRange = (entry: BusinessFeedEntry) =>
    timeRanges[kind] === 'all' || (Date.parse(entry.occurredAt) >= start.getTime() && Date.parse(entry.occurredAt) < end.getTime())
  /** One predicate for the list and its chip counts, so a chip counts exactly what it shows. */
  const matches = (entry: BusinessFeedEntry, filter: HrListFilter, keepRead = true) =>
    entry.kind === kind &&
    (kind !== 'case' || (filter === 'all' && caseStatus === 'ended' ? entry.archived : !entry.archived)) &&
    // "All" is every case; my cases are marked on their card. My cases show regardless of the time range.
    (filter === 'working' ? Boolean(entry.working) : inTimeRange(entry)) &&
    (filter === 'later'
      ? entry.deferred
      : filter === 'unseen'
        ? entry.unseen || (keepRead && keptInUnread.has(businessObjectKey(entry)))
        : true) &&
    (!query || [entry.title, ...entry.fields.map((field) => field.value)].join(' ').toLocaleLowerCase().includes(query)) &&
    (kind !== 'person' ||
      own === 'all' ||
      (own === 'unset' ? people.get(entry.objectId)?.isOwnCompany == null : String(people.get(entry.objectId)?.isOwnCompany) === own))
  const visible = entries.filter((entry) => matches(entry, filters[kind]))
  // Counts leave out cards kept on screen after being read, so "unread" counts what is still unread.
  const chipCount = (filter: HrListFilter) => entries.filter((entry) => matches(entry, filter, false)).length
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
  // Nothing on screen to keep steady: apply waiting updates at once instead of asking HR to refresh an empty list.
  useEffect(() => {
    if (incoming && !loading && !visible.length) void load(true)
  }, [incoming, loading, visible.length])
  const noPeople = kind === 'person' && !entries.some((entry) => entry.kind === 'person')
  return (
    <section
      className="hr-object-list"
      onDragOver={(event) => {
        if (kind === 'case' && onAssessResumes && event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'none'
          setDropHint(true)
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropHint(false)
          setDragTarget(null)
        }
      }}
      onDrop={(event) => {
        if (kind === 'case' && onAssessResumes && event.dataTransfer.files.length) {
          event.preventDefault()
          event.stopPropagation()
          setDropHint(true)
          setDragTarget(null)
        }
      }}
      aria-label={kind === 'case' ? t('案件业务列表', '案件一覧') : t('人员业务列表', '要員一覧')}
    >
      <div className="hr-list-toolbar">
        <label className="hr-search">
          <Icon name="search" size={16} />
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
      </div>
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
                working: t('我的案件', '担当案件'),
                all: t('全部', 'すべて'),
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
      {kind === 'case' && onAssessResumes && visible.length ? (
        <p className={`case-list-drop-help${dropHint ? ' is-active' : ''}`} role={dropHint ? 'status' : undefined}>
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
      {deletionNotice ? <p role="status">{deletionNotice}</p> : null}
      {lifecycleNotice && kind === 'case' ? (
        <p className="hr-working-notice" role="status">
          {lifecycleNotice.ended
            ? t(`已结束案件：${lifecycleNotice.entry.title}`, `案件を終了しました：${lifecycleNotice.entry.title}`)
            : t(`已激活案件：${lifecycleNotice.entry.title}`, `案件を再開しました：${lifecycleNotice.entry.title}`)}
          <button
            type="button"
            disabled={pendingMarks.has(businessObjectKey(lifecycleNotice.entry))}
            onClick={() => void setCaseEnded(lifecycleNotice.entry, !lifecycleNotice.ended, true)}
          >
            {t('撤销', '元に戻す')}
          </button>
        </p>
      ) : null}
      {workingNotice && kind === 'case' ? (
        <p className="hr-working-notice" role="status">
          {workingNotice.working
            ? t(`已加入我的案件：${workingNotice.entry.title}`, `担当案件に追加しました：${workingNotice.entry.title}`)
            : t(`已移出我的案件：${workingNotice.entry.title}`, `担当案件から外しました：${workingNotice.entry.title}`)}
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
          // ↑/↓ move between cards while a card itself has focus; Enter on a card opens it.
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
        ) : !loading && !visible.length && workingView && !query ? (
          <div className="hr-empty">
            <p>
              {t(
                '还没有我的案件。在「全部」里把正在跟的案件加入我的案件，下次打开列表就先看到它们。',
                '担当案件はまだありません。「すべて」から今担当している案件を追加すると、次回から最初に表示されます。'
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
              {t('查看全部案件', 'すべての案件を見る')}
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
        {visible.slice(firstIndex, firstIndex + pageSize).map((entry) => {
          const dropAvailable =
            kind === 'case' && usable(entry) && cases.some((job) => job.reviewId === entry.objectId && job.lifecycle === 'active')
          const resumeState = resumeStates[entry.objectId]
          const key = businessObjectKey(entry)
          const selected = key === selectedKey
          const person = people.get(entry.objectId)
          const skills = cardSkillItems(entry.fields.find((field) => ['skills', 'required_skills'].includes(field.key))?.value ?? '')
          const skillLimit = kind === 'case' ? 3 : 8
          const facts = entry.fields.filter((field) => !['skills', 'required_skills'].includes(field.key) && field.value.trim())
          const changes = cardChangeLabels(entry, zh)
          const relations = progress?.indexes[kind].get(entry.objectId) ?? []
          const next = progress ? nextProgressAppointment(relations, progress.now) : undefined
          const nextState = next && progress ? progressPresentation(next, progress.now, zh) : undefined
          // Suggest, never perform, removal once every follow-up of a working case has ended or started work.
          const removable =
            kind === 'case' && entry.working && progress && !progress.loading && relations.length > 0 && !relations.some(isActiveProgress)
          const nextName = next
            ? kind === 'person'
              ? cases.find((item) => item.reviewId === next.reviewId)?.fields.find((field) => field.key === 'title')?.value ||
                cases.find((item) => item.reviewId === next.reviewId)?.redactedSubject
              : people.get(next.documentId)?.localIdentity?.displayName || people.get(next.documentId)?.fileName
            : undefined
          const cardLocked = locked(entry)
          const assessing = kind === 'case' && Boolean(onAssessResumes)
          // Why the primary 「找人」/「找案件」 is unavailable, shown as its tooltip and accessible description.
          const matchReason =
            !assessing && cardLocked
              ? t('正在评估中，请稍候', '評価中です。しばらくお待ちください')
              : kind === 'case' && entry.archived
                ? t('案件已结束', '案件は終了しています')
                : !usable(entry)
                  ? kind === 'case'
                    ? t('案件未激活', '案件が有効ではありません')
                    : t('人员当前不可安排', '要員は現在稼働できません')
                  : assessing && !dropAvailable
                    ? t('资料不完整', '資料が不完全です')
                    : undefined
          const promoteReason = usable(entry)
            ? undefined
            : kind === 'case' && entry.archived
              ? t('案件已结束', '案件は終了しています')
              : kind === 'case'
                ? t('案件未激活', '案件が有効ではありません')
                : t('人员当前不可安排', '要員は現在稼働できません')
          const matchCount = kind === 'person' ? (personMatchCounts[entry.objectId] ?? 0) : 0
          const factName = (fieldKey: string) =>
            ({
              rate: t('单价', '単価'),
              availability: t('入场', '稼働'),
              start_date: t('开始', '開始'),
              experience_years: t('经验', '経験'),
              work_style: t('工作方式', '勤務形態'),
              remote: t('工作方式', '勤務形態'),
              location: t('地点', '勤務地')
            })[fieldKey]
          return (
            <article
              key={key}
              className={`hr-object-card${selected ? ' is-selected' : ''}${dragTarget === key ? ' is-resume-drag-target' : ''}`}
              onDragOver={(event) => {
                if (kind === 'case' && onAssessResumes && event.dataTransfer.types.includes('Files')) {
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
                if (kind === 'case' && onAssessResumes && event.dataTransfer.files.length) {
                  event.preventDefault()
                  event.stopPropagation()
                  setDragTarget(null)
                  setDropHint(false)
                  if (dropAvailable) {
                    onAssessResumes(entry, Array.from(event.dataTransfer.files))
                    if (entry.unseen) void mark(entry, 'seen')
                  }
                }
              }}
              tabIndex={0}
              aria-label={entry.title}
              aria-current={selected ? 'true' : undefined}
              onClick={(event) => {
                if (!(event.target as HTMLElement).closest('button,summary,details,[role="menu"]') && !window.getSelection()?.toString())
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
              <div className="hr-card-meta">
                {kind === 'case' && entry.working ? <b className="hr-working-badge">{t('我的', '担当')}</b> : null}
                {kind === 'case' && entry.archived ? <b className="hr-ended-badge">{t('已结束', '終了')}</b> : null}
                {entry.source === 'gmail' ? <span>Gmail</span> : null}
                <time dateTime={entry.occurredAt}>
                  {new Date(entry.occurredAt).toLocaleString(t('zh-CN', 'ja-JP'), {
                    year: 'numeric',
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                  })}
                </time>
                {entry.unseen ? <b>{t('未读', '未読')}</b> : null}
                {selected ? <b>{t('当前查看', '表示中')}</b> : null}
              </div>
              <h2
                // Same-name people stay distinguishable on hover without showing an internal number on the card.
                title={
                  entry.kind === 'person' &&
                  entries.some((other) => other.kind === 'person' && other.objectId !== entry.objectId && other.title === entry.title)
                    ? `${entry.title} · ${t('资料编号', '資料番号')} ${entry.objectId.slice(0, 8).toUpperCase()}`
                    : undefined
                }
              >
                {entry.title}
              </h2>
              {skills.length ? (
                <div className="hr-card-requirements">
                  <ul className="hr-skill-items" aria-label={kind === 'case' ? t('必需技能', '必須スキル') : t('技能', 'スキル')}>
                    {skills.slice(0, skillLimit).map((skill, index) => (
                      <li key={index}>{skill}</li>
                    ))}
                  </ul>
                  {skills.length > skillLimit ? (
                    <details className="hr-more-skills">
                      <summary>
                        {t('其余', '残り')} {skills.length - skillLimit} {t('项要求', '項目')}
                      </summary>
                      <ul className="hr-skill-items">
                        {skills.slice(skillLimit).map((skill, index) => (
                          <li key={index}>{skill}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              ) : null}
              <dl className="hr-card-facts">
                {facts.map((field) => (
                  <div key={field.key}>
                    <dt>{factName(field.key)}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
                {kind === 'person' ? (
                  <div>
                    <dt>{t('是否自社', '自社所属')}</dt>
                    <dd>{person?.isOwnCompany === true ? '自社' : person?.isOwnCompany === false ? '非自社' : t('未设置', '未設定')}</dd>
                  </div>
                ) : null}
              </dl>
              {changes.length ? (
                <div className="hr-card-changes" aria-label={t('本次变更', '今回の変更')}>
                  {changes.map((change) => (
                    <span key={change}>{change}</span>
                  ))}
                </div>
              ) : null}
              {progress ? (
                <button
                  className="hr-card-business"
                  type="button"
                  disabled={progress.loading}
                  onClick={() => {
                    if (progress.failed) void progress.refresh()
                    else if (onOpenProgress) onOpenProgress(entry)
                    else open(entry, 'view')
                  }}
                >
                  <span>
                    {progress.loading
                      ? t('正在读取营业情况', '営業状況を読込中')
                      : progress.failed
                        ? t('营业情况读取失败，点击重试', '営業状況を読み込めませんでした。再試行')
                        : progressSummary(relations, kind, progress.now, zh)}
                  </span>
                  {!progress.failed && nextState?.when ? (
                    <span className="hr-card-business-next">
                      {new Date(nextState.when.length === 10 ? `${nextState.when}T00:00:00+09:00` : nextState.when).toLocaleString(
                        t('zh-CN', 'ja-JP'),
                        {
                          timeZone: 'Asia/Tokyo',
                          month: 'numeric',
                          day: 'numeric',
                          ...(nextState.when.length > 10 ? { hour: '2-digit', minute: '2-digit', hour12: false } : {})
                        }
                      )}{' '}
                      · {nextState.label}
                      {nextName ? ` · ${nextName}` : ''}
                    </span>
                  ) : null}
                </button>
              ) : null}
              {removable ? (
                <p className="hr-working-hint">
                  {relations.some((row) => row.progress?.stage === 'started')
                    ? t(
                        '已有人员进场，其余跟进也已结束。可以移出我的案件。',
                        '参画が決まり、他の対応も終了しています。担当案件から外せます。'
                      )
                    : t('这个案件的跟进都已结束。可以移出我的案件。', 'この案件の対応はすべて終了しています。担当案件から外せます。')}
                </p>
              ) : null}
              <footer>
                <div className="hr-card-actions">
                  {assessing ? (
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
                          ? `${t('查看案件', '案件を見る')} (${matchCount})`
                          : t('找案件', '案件を探す')}
                    </button>
                  )}
                  {matchReason ? (
                    <span className="hr-visually-hidden" id={`${reasonId}-${key}-match`}>
                      {matchReason}
                    </span>
                  ) : null}
                  {kind === 'case' && entry.archived ? (
                    <button
                      className="hr-working-add"
                      disabled={pendingMarks.has(key)}
                      onClick={() => void setCaseEnded(entry, false)}
                      type="button"
                    >
                      {t('激活案件', '案件を再開')}
                    </button>
                  ) : (
                    <>
                      <button
                        disabled={Boolean(promoteReason)}
                        title={promoteReason}
                        aria-describedby={promoteReason ? `${reasonId}-${key}-promote` : undefined}
                        onClick={() => open(entry, 'promote')}
                        type="button"
                      >
                        {kind === 'case' ? t('群发案件', '案件を配信') : t('准备介绍', '紹介を準備')}
                      </button>
                      {promoteReason ? (
                        <span className="hr-visually-hidden" id={`${reasonId}-${key}-promote`}>
                          {promoteReason}
                        </span>
                      ) : null}
                    </>
                  )}
                  <ActionMenu
                    label={t(`更多操作：${entry.title}`, `その他の操作：${entry.title}`)}
                    triggerClassName="hr-menu-trigger"
                    trigger={<span aria-hidden="true">…</span>}
                  >
                    <button role="menuitem" onClick={() => open(entry, 'view')} type="button">
                      {t('查看详情', '詳細を見る')}
                    </button>
                    {kind === 'case' && !entry.archived ? (
                      <>
                        <button
                          role="menuitem"
                          className={entry.working ? undefined : 'hr-working-add'}
                          disabled={pendingMarks.has(key) || (!entry.working && !usable(entry))}
                          onClick={() => void setWorking(entry, !entry.working)}
                          type="button"
                        >
                          {entry.working ? t('移出我的案件', '担当から外す') : t('加入我的案件', '担当に追加')}
                        </button>
                        <button
                          role="menuitem"
                          disabled={pendingMarks.has(key)}
                          onClick={() => void setCaseEnded(entry, true)}
                          type="button"
                        >
                          {t('结束案件', '案件を終了')}
                        </button>
                      </>
                    ) : kind === 'person' ? (
                      <button
                        role="menuitem"
                        disabled={pendingMarks.has(key)}
                        onClick={() => void mark(entry, entry.deferred ? 'done' : 'defer')}
                        type="button"
                      >
                        {entry.deferred ? t('移出稍后处理', 'あとで対応から外す') : t('稍后处理', 'あとで対応')}
                      </button>
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
                            : t('已删除所选资料。', '選択した資料を削除しました。')
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
              </footer>
            </article>
          )
        })}
      </div>
      {visible.length > pageSize ? (
        <nav className="hr-list-pagination" aria-label={t('列表分页', '一覧のページ切替')}>
          <span>
            {firstIndex + 1}–{Math.min(firstIndex + pageSize, visible.length)} / {visible.length} {t('条', '件')}
          </span>
          <button type="button" disabled={page === 1} onClick={() => changePage(page - 1)}>
            {t('上一页', '前のページ')}
          </button>
          <span aria-live="polite">
            {page} / {totalPages}
          </span>
          <button type="button" disabled={page === totalPages} onClick={() => changePage(page + 1)}>
            {t('下一页', '次のページ')}
          </button>
        </nav>
      ) : null}
    </section>
  )
}
