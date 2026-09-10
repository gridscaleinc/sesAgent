import { isActiveProgress, nextProgressAppointment, progressPresentation, progressSummary, useBusinessProgress } from '../business-progress-data'
import { useEffect, useRef, useState } from 'react'
import type { BusinessFeedEntry, CandidateReviewSnapshot, JobCaseReviewSnapshot } from '@shared'
import { useUiLocale } from '../i18n'
import { Icon } from './Icon'
import { businessObjectKey, currentBusinessObjects, readHrPosition, saveHrPosition, type HrBusinessKind, type HrTimeRange } from '../hr-business-navigation'
import { cardChangeLabels, cardSkillItems } from '../hr-card-presentation'

const usable = (entry: BusinessFeedEntry) => entry.kind === 'case' ? entry.businessStatus === 'active' : ['available', 'soon'].includes(entry.businessStatus)
const pageSize = 20

export function HrObjectList({ onOpenProgress, cases = [], kind, reloadToken, candidates, selectedKey, busy, onOpen, onIntake, onImportResume, onRefresh, onOpenLibrary, onImportHistory }: {
  onOpenProgress?(entry: BusinessFeedEntry): void
  cases?: JobCaseReviewSnapshot[]
  kind: HrBusinessKind; reloadToken: unknown; candidates: CandidateReviewSnapshot[]; selectedKey?: string | null; busy: boolean
  onOpen(entry: BusinessFeedEntry, action: 'view' | 'match' | 'promote'): void
  onIntake(): void; onImportResume(): void; onRefresh(): Promise<void>
  onOpenLibrary?(): void; onImportHistory?(): void
}) {
  const zh = useUiLocale() === 'zh-CN'; const t = (cn: string, ja: string) => zh ? cn : ja
  const progress = useBusinessProgress()
  const [activeFilters, setActiveFilters] = useState({ person: false, case: false })
  const activeOnly = activeFilters[kind]
  const setActiveOnly = (value: boolean) => setActiveFilters((current) => ({ ...current, [kind]: value }))
  const [entries, setEntries] = useState<BusinessFeedEntry[]>([])
  const [incoming, setIncoming] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [queries, setQueries] = useState({ case: '', person: '' })
  const [filters, setFilters] = useState<Record<HrBusinessKind, 'all' | 'unseen' | 'later'>>(() => ({ case: readHrPosition('case').filter, person: readHrPosition('person').filter }))
  const [timeRanges, setTimeRanges] = useState<Record<HrBusinessKind, HrTimeRange>>(() => ({ case: readHrPosition('case').timeRange, person: readHrPosition('person').timeRange }))
  const [pages, setPages] = useState(() => ({ case: readHrPosition('case').page, person: readHrPosition('person').page }))
  const [own, setOwn] = useState('all')
  const [pendingMarks, setPendingMarks] = useState<Set<string>>(new Set())
  const marks = useRef(new Set<string>())
  const sequence = useRef(0)
  const scroller = useRef<HTMLDivElement>(null)
  const scrolls = useRef<Record<HrBusinessKind, number>>({ case: readHrPosition('case').scroll, person: readHrPosition('person').scroll })
  const initialized = useRef(false)
  const displayed = useRef<BusinessFeedEntry[]>([])
  const accept = (rows: BusinessFeedEntry[], reveal: boolean) => {
    const next = currentBusinessObjects(rows)
    const old = new Map(displayed.current.map((entry) => [businessObjectKey(entry), entry.revision]))
    const changed = next.some((entry) => old.get(businessObjectKey(entry)) !== entry.revision)
    if (reveal || !initialized.current) {
      initialized.current = true; displayed.current = next; setEntries(next)
    } else {
      const fresh = new Map(next.map((entry) => [businessObjectKey(entry), entry]))
      setEntries((current) => current.flatMap((entry) => {
        const update = fresh.get(businessObjectKey(entry))
        return update ? [{ ...entry, businessStatus: update.businessStatus, deferred: update.deferred,
          unseen: entry.revision === update.revision ? update.unseen : true }] : []
      }))
    }
    if (reveal) setIncoming(false)
    else setIncoming(changed)
  }
  const load = async (reveal = false) => {
    const id = ++sequence.current
    try {
      const rows = await window.sesAgent.getBusinessFeed()
      if (id !== sequence.current) return
      accept(rows, reveal || !initialized.current); setError('')
    } catch (cause) { if (id === sequence.current) setError(String(cause)) }
    finally { if (id === sequence.current) setLoading(false) }
  }
  useEffect(() => { void load(); return () => { sequence.current++ } }, [reloadToken])
  useEffect(() => {
    const refreshEdit = (event: Event) => {
      const target = (event as CustomEvent<{ kind: string; id: string }>).detail
      void window.sesAgent.getBusinessFeed().then((rows) => {
        const update = currentBusinessObjects(rows).find((item) => item.kind === target.kind && item.objectId === target.id)
        if (!update) return
        setEntries((current) => { const next = current.map((item) => item.kind === update.kind && item.objectId === update.objectId ? { ...update, occurredAt: item.occurredAt } : item); displayed.current = next; return next })
      }).catch((cause) => setError(String(cause)))
    }
    window.addEventListener('ses-business-data-changed', refreshEdit)
    return () => window.removeEventListener('ses-business-data-changed', refreshEdit)
  }, [])
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = scrolls.current[kind] }, [kind])
  useEffect(() => { if (!loading && scroller.current) scroller.current.scrollTop = scrolls.current[kind] }, [loading])
  const mark = async (entry: BusinessFeedEntry, action: 'seen' | 'defer' | 'done') => {
    const key = businessObjectKey(entry)
    if (marks.current.has(key)) return
    marks.current.add(key); setPendingMarks(new Set(marks.current))
    try {
      const rows = await window.sesAgent.markBusinessFeed({ kind: entry.kind, objectId: entry.objectId, revision: entry.revision, action })
      const saved = rows.find((item) => businessObjectKey(item) === key)
      if (saved) setEntries((current) => current.map((item) => businessObjectKey(item) === key ? { ...item, unseen: saved.unseen, deferred: saved.deferred } : item))
    } catch (cause) { setError(String(cause)) }
    finally { marks.current.delete(key); setPendingMarks(new Set(marks.current)) }
  }
  const open = (entry: BusinessFeedEntry, action: 'view' | 'match' | 'promote') => {
    if (action === 'match' && busy) return
    onOpen(entry, action)
    if (entry.unseen) void mark(entry, 'seen')
  }
  const query = queries[kind].trim().toLocaleLowerCase()
  const people = new Map(candidates.map((person) => [person.documentId, person]))
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const end = new Date(today); end.setDate(end.getDate() + 1)
  const start = new Date(today)
  if (timeRanges[kind] === '7d') start.setDate(start.getDate() - 6)
  if (timeRanges[kind] === '30d') start.setDate(start.getDate() - 29)
  const visible = entries.filter((entry) => entry.kind === kind
    && (timeRanges[kind] === 'all' || (Date.parse(entry.occurredAt) >= start.getTime() && Date.parse(entry.occurredAt) < end.getTime()))
    && (!activeOnly || (progress?.indexes[kind].get(entry.objectId) ?? []).some(isActiveProgress))
    && (filters[kind] === 'later' ? entry.deferred : filters[kind] === 'unseen' ? entry.unseen || selectedKey === businessObjectKey(entry) : true)
    && (!query || [entry.title, ...entry.fields.map((field) => field.value)].join(' ').toLocaleLowerCase().includes(query))
    && (kind !== 'person' || own === 'all' || (own === 'unset' ? people.get(entry.objectId)?.isOwnCompany == null : String(people.get(entry.objectId)?.isOwnCompany) === own)))
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
  return <section className="hr-object-list" aria-label={kind === 'case' ? t('案件业务列表', '案件一覧') : t('人员业务列表', '要員一覧')}>
    <div className="hr-list-toolbar">
      <label className="hr-search"><Icon name="search" size={16} /><input aria-label={t('搜索案件或人员', '案件・要員を検索')} placeholder={kind === 'case' ? t('搜索案件、技能、地点', '案件名・スキル・勤務地') : t('搜索姓名、技能、角色', '氏名・スキル・役割')} value={queries[kind]} onChange={(event) => { setQueries((current) => ({ ...current, [kind]: event.target.value })); changePage(1) }} /></label>
      <button className="hr-primary" onClick={onIntake} type="button"><Icon name="upload" size={14} />{t('导入 / 粘贴', '取込・貼り付け')}</button>
      {kind === 'person' ? <button onClick={onImportResume} type="button">{t('导入简历', '履歴書を取り込む')}</button> : null}
      {onOpenLibrary ? <button onClick={onOpenLibrary} type="button"><Icon name="file" size={14} />{kind === 'person' ? t('完整人员资料', '要員の全資料') : t('完整案件资料', '案件の全資料')}</button> : null}
      {onImportHistory ? <button onClick={onImportHistory} type="button">{t('导入记录', '取込履歴')}</button> : null}
    </div>
    <div className="hr-list-filters">
      {(['all', 'unseen', 'later'] as const).map((value) => <button type="button" key={value} aria-pressed={filters[kind] === value} onClick={() => { setFilters((current) => ({ ...current, [kind]: value })); saveHrPosition(kind, { filter: value }); changePage(1) }}>{({ all: t('全部', 'すべて'), unseen: t('未读', '未読'), later: t('稍后处理', 'あとで対応') })[value]}</button>)}
      <select aria-label={t('列表时间范围', '一覧の期間')} value={timeRanges[kind]} onChange={(event) => { const timeRange = event.target.value as HrTimeRange; setTimeRanges((current) => ({ ...current, [kind]: timeRange })); saveHrPosition(kind, { timeRange }); changePage(1) }}>
        <option value="today">{t('今天', '今日')}</option><option value="7d">{t('最近 7 天', '直近7日')}</option><option value="30d">{t('最近 30 天', '直近30日')}</option><option value="all">{t('全部时间', '全期間')}</option>
      </select>
      {kind === 'person' ? <select aria-label={t('自社筛选', '自社所属で絞り込み')} value={own} onChange={(event) => { setOwn(event.target.value); changePage(1) }}><option value="all">{t('全部所属', '所属すべて')}</option><option value="true">自社</option><option value="false">非自社</option><option value="unset">{t('未设置', '未設定')}</option></select> : null}
      {progress ? <button className="hr-list-progress-filter" type="button" disabled={progress.loading || progress.failed} aria-pressed={activeOnly} onClick={() => { const next = !activeOnly; setActiveOnly(next); if (next) { setTimeRanges((current) => ({...current, [kind]: 'all'})); setFilters((current) => ({...current, [kind]: 'all'})); saveHrPosition(kind, {timeRange: 'all', filter: 'all'}) }; changePage(1) }}>{activeOnly ? t('只看推进中', '進行中のみ') : t('查看全部推进中', '全期間の進行中を表示')}</button> : null}
      <span>{visible.length} {t('条', '件')}</span>
      <button disabled={loading} onClick={() => { setLoading(true); void onRefresh().then(() => load(true)).catch((cause) => { setError(String(cause)); setLoading(false) }) }} type="button">{t('刷新', '再読込')}</button>
    </div>
    {incoming ? <div className="hr-list-update"><span>{t('有更新可查看', '更新情報があります')}</span><button onClick={() => void load(true)} type="button">{t('更新列表', '一覧を更新')}</button></div> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className="hr-object-scroll" ref={scroller} onScroll={(event) => { scrolls.current[kind] = event.currentTarget.scrollTop; saveHrPosition(kind, { scroll: event.currentTarget.scrollTop }) }}>
      {loading && !entries.length ? <p role="status">{t('正在读取…', '読込中…')}</p> : null}
      {!loading && !visible.length ? <p className="hr-empty">{kind === 'case' && timeRanges[kind] === 'today' && !query && filters[kind] === 'all'
        ? t('今天暂无案件。可切换时间范围查看历史案件。', '今日の案件はありません。期間を変更すると過去の案件を確認できます。')
        : t('没有符合条件的记录。可以调整筛选，或导入新的资料。', '条件に一致する情報がありません。絞り込みを変更するか、新しい情報を取り込んでください。')}</p> : null}
      {visible.slice(firstIndex, firstIndex + pageSize).map((entry) => {
        const key = businessObjectKey(entry); const selected = key === selectedKey; const person = people.get(entry.objectId)
        const skills = cardSkillItems(entry.fields.find((field) => ['skills', 'required_skills'].includes(field.key))?.value ?? '')
        const skillLimit = kind === 'case' ? 3 : 8
        const facts = entry.fields.filter((field) => !['skills', 'required_skills'].includes(field.key) && field.value.trim())
        const changes = cardChangeLabels(entry, zh)
        const relations = progress?.indexes[kind].get(entry.objectId) ?? []
        const next = progress ? nextProgressAppointment(relations, progress.now) : undefined
        const nextState = next && progress ? progressPresentation(next, progress.now, zh) : undefined
        const nextName = next ? kind === 'person'
          ? cases.find((item) => item.reviewId === next.reviewId)?.fields.find((field) => field.key === 'title')?.value || cases.find((item) => item.reviewId === next.reviewId)?.redactedSubject
          : people.get(next.documentId)?.localIdentity?.displayName || people.get(next.documentId)?.fileName : undefined
        const factName = (fieldKey: string) => ({ rate: t('单价', '単価'), availability: t('入场', '稼働'), start_date: t('开始', '開始'),
          experience_years: t('经验', '経験'), work_style: t('工作方式', '勤務形態'), remote: t('工作方式', '勤務形態'), location: t('地点', '勤務地') })[fieldKey]
        return <article key={key} className={`hr-object-card${selected ? ' is-selected' : ''}`} tabIndex={0} aria-label={entry.title} aria-current={selected ? 'true' : undefined}
          onClick={(event) => { if (!(event.target as HTMLElement).closest('button,summary,details') && !window.getSelection()?.toString()) open(entry, 'view') }}
          onKeyDown={(event) => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); open(entry, 'view') } }}>
          <div className="hr-card-meta">{entry.source === 'gmail' ? <span>Gmail</span> : null}<time dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString(zh ? 'zh-CN' : 'ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</time>{entry.unseen ? <b>{t('未读', '未読')}</b> : null}{selected ? <b>{t('当前查看', '表示中')}</b> : null}</div>
          <h2>{entry.title}</h2>{entry.kind === 'person' && entries.some((other) => other.kind === 'person' && other.objectId !== entry.objectId && other.title === entry.title) ? <small className="hr-affiliation">{t('资料编号', '資料番号')} · {entry.objectId.slice(0, 8).toUpperCase()}</small> : null}
          {skills.length ? <div className="hr-card-requirements">
            <ul className="hr-skill-items" aria-label={kind === 'case' ? t('必需技能', '必須スキル') : t('技能', 'スキル')}>{skills.slice(0, skillLimit).map((skill, index) => <li key={index}>{skill}</li>)}</ul>
            {skills.length > skillLimit ? <details className="hr-more-skills"><summary>{t('其余', '残り')} {skills.length - skillLimit} {t('项要求', '項目')}</summary><ul className="hr-skill-items">{skills.slice(skillLimit).map((skill, index) => <li key={index}>{skill}</li>)}</ul></details> : null}
          </div> : null}
          <dl className="hr-card-facts">{facts.map((field) => <div key={field.key}><dt>{factName(field.key)}</dt><dd>{field.value}</dd></div>)}
            {kind === 'person' ? <div><dt>{t('是否自社', '自社所属')}</dt><dd>{person?.isOwnCompany === true ? '自社' : person?.isOwnCompany === false ? '非自社' : t('未设置', '未設定')}</dd></div> : null}
          </dl>
          {changes.length ? <div className="hr-card-changes" aria-label={t('本次变更', '今回の変更')}>{changes.map((change) => <span key={change}>{change}</span>)}</div> : null}
          {progress ? <button className="hr-card-business" type="button" disabled={progress.loading} onClick={() => { if (progress.failed) void progress.refresh(); else if (onOpenProgress) onOpenProgress(entry); else open(entry, 'view') }}><span>{progress.loading ? t('正在读取营业情况', '営業状況を読込中') : progress.failed ? t('营业情况读取失败，点击重试', '営業状況を読み込めませんでした。再試行') : progressSummary(relations, kind, progress.now, zh)}</span>{!progress.failed && nextState?.when ? <span className="hr-card-business-next">{new Date(nextState.when.length === 10 ? `${nextState.when}T00:00:00+09:00` : nextState.when).toLocaleString(zh ? 'zh-CN' : 'ja-JP', {timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', ...(nextState.when.length > 10 ? {hour: '2-digit', minute: '2-digit', hour12: false} : {})})} · {nextState.label}{nextName ? ` · ${nextName}` : ''}</span> : null}</button> : null}
          <footer>
            <div className="hr-card-actions">
              <button onClick={() => open(entry, 'view')} type="button">{t('查看详情', '詳細を見る')}</button>
              <button className="hr-primary" disabled={busy || !usable(entry)} onClick={() => open(entry, 'match')} type="button">{kind === 'case' ? t('找人', '要員を探す') : t('找案件', '案件を探す')}</button>
              <button disabled={!usable(entry)} onClick={() => open(entry, 'promote')} type="button">{t('准备介绍', '紹介を準備')}</button>
              <button disabled={pendingMarks.has(key)} onClick={() => void mark(entry, entry.deferred ? 'done' : 'defer')} type="button">{entry.deferred ? t('移出稍后处理', 'あとで対応から外す') : t('稍后处理', 'あとで対応')}</button>
            </div>
          </footer>
        </article>
      })}
    </div>
    {visible.length > pageSize ? <nav className="hr-list-pagination" aria-label={t('列表分页', '一覧のページ切替')}>
      <span>{firstIndex + 1}–{Math.min(firstIndex + pageSize, visible.length)} / {visible.length} {t('条', '件')}</span>
      <button type="button" disabled={page === 1} onClick={() => changePage(page - 1)}>{t('上一页', '前のページ')}</button>
      <span aria-live="polite">{page} / {totalPages}</span>
      <button type="button" disabled={page === totalPages} onClick={() => changePage(page + 1)}>{t('下一页', '次のページ')}</button>
    </nav> : null}
  </section>
}
