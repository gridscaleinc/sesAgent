import { useEffect, useRef, useState } from 'react'
import { personnelFieldLabels, type BusinessFeedEntry, type MarkBusinessFeedInput } from '@shared'
import { useUiLocale } from '../i18n'
import { Icon } from './Icon'
import './agent-latest-workspace.css'

interface Props {
  reloadToken: unknown
  selectedEntryKey?: string | null
  matchingPersonId?: string | null
  matchingCaseReviewId?: string | null
  onOpen(entry: BusinessFeedEntry, action: 'view' | 'match' | 'promote'): void
  onIntake(): void
  onRefresh(): Promise<void>
}
const entryKey = (entry: BusinessFeedEntry) => `${entry.kind}:${entry.objectId}`
const isCurrentBusinessEntry = (entry: BusinessFeedEntry) => !entry.archived && (entry.kind === 'case' ? entry.businessStatus === 'active' : entry.businessStatus === 'available' || entry.businessStatus === 'soon')
type FeedState = { entries: BusinessFeedEntry[]; incoming: BusinessFeedEntry[] | null }

// Acknowledgements may change badges, but never replace the reading snapshot
// with new records or newer revisions until the operator asks to update it.
function receiveFeed(current: FeedState | null, next: BusinessFeedEntry[], reveal: boolean): FeedState {
  if (!current || reveal) return { entries: next, incoming: null }
  const byKey = new Map(next.map((entry) => [entryKey(entry), entry]))
  const entries = current.entries.flatMap((entry) => {
    const fresh = byKey.get(entryKey(entry))
    if (!fresh) return []
    return [fresh.revision === entry.revision
      ? { ...entry, unseen: fresh.unseen, deferred: fresh.deferred, archived: fresh.archived }
      : { ...entry, archived: fresh.archived }]
  })
  const displayed = new Map(entries.map((entry) => [entryKey(entry), entry.revision]))
  const changed = next.some((entry) => displayed.get(entryKey(entry)) !== entry.revision)
  return { entries, incoming: changed ? next : null }
}

export function LatestBusinessFeed({ reloadToken, selectedEntryKey, matchingPersonId, matchingCaseReviewId, onOpen, onIntake, onRefresh }: Props) {
  const zh = useUiLocale() === 'zh-CN'; const t = (cn: string, ja: string) => zh ? cn : ja
  const [feed, setFeed] = useState<FeedState | null>(null)
  const entries = feed?.entries ?? []
  const [localSelection, setLocalSelection] = useState<string | null>(null)
  const activeKey = selectedEntryKey === undefined ? localSelection : selectedEntryKey
  const [filter, setFilter] = useState<'all' | 'case' | 'person' | 'later'>('all')
  const [days, setDays] = useState(0)
  const [readFilter, setReadFilter] = useState<'all' | 'seen' | 'unseen'>('unseen')
  const [retainedReads, setRetainedReads] = useState<Map<string, string>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [marking, setMarking] = useState<Set<string>>(new Set())
  const request = useRef(0)
  const pendingMarks = useRef(new Set<string>())
  const revealRequested = useRef(false)
  const load = async () => {
    const seq = ++request.current
    try {
      // Business validity takes effect immediately, including for retained read
      // cards. Buffer only new usable records, never newly unavailable ones.
      const value = (await window.sesAgent.getBusinessFeed()).filter(isCurrentBusinessEntry)
      if (seq === request.current) {
        const reveal = revealRequested.current
        revealRequested.current = false
        setFeed((current) => receiveFeed(current, value, reveal))
        setError(null)
      }
    }
    catch (cause) { if (seq === request.current) { revealRequested.current = false; setError(String(cause)) } }
    finally { if (seq === request.current) setLoading(false) }
  }
  useEffect(() => { void load(); return () => { request.current++ } }, [reloadToken])
  const mark = async (entry: BusinessFeedEntry, action: MarkBusinessFeedInput['action']) => {
    const key = entryKey(entry)
    if (pendingMarks.current.has(key)) return
    if (entry.unseen) setRetainedReads((current) => new Map(current).set(key, entry.revision))
    pendingMarks.current.add(key)
    setMarking((current) => new Set(current).add(key))
    // Patch only this record: another acknowledgement may finish out of order.
    // A follow-up read reconciles all completed writes and buffers new arrivals.
    try {
      const next = await window.sesAgent.markBusinessFeed({ kind: entry.kind, objectId: entry.objectId, revision: entry.revision, action })
      const acknowledged = next.find((item) => entryKey(item) === key && item.revision === entry.revision)
      if (acknowledged) setFeed((current) => current ? {
        ...current,
        entries: current.entries.map((item) => entryKey(item) === key && item.revision === entry.revision
          ? { ...item, unseen: acknowledged.unseen, deferred: acknowledged.deferred } : item)
      } : current)
      await load()
    }
    catch (cause) { await load(); setError(String(cause)) }
    finally { pendingMarks.current.delete(key); setMarking((current) => { const next = new Set(current); next.delete(key); return next }) }
  }
  const open = (entry: BusinessFeedEntry, action: 'view' | 'match' | 'promote') => {
    if (action === 'match' && (entry.kind === 'person' ? matchingPersonId : matchingCaseReviewId)) return
    onOpen(entry, action)
    setLocalSelection(entryKey(entry))
    if (entry.unseen) void mark(entry, 'seen')
  }
  const refresh = async () => {
    setRetainedReads(new Map())
    setLoading(true)
    revealRequested.current = true
    try { await onRefresh(); await load() }
    catch (cause) { revealRequested.current = false; setLoading(false); setError(String(cause)) }
  }
  // Today follows the HR operator's local calendar, rather than a rolling 24-hour window.
  const today = new Date(Date.now())
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const cutoff = days === 0 ? today.getTime() : Date.now() - days * 86_400_000
  const inRange = (entry: BusinessFeedEntry) => {
    const time = Date.parse(entry.occurredAt)
    return time >= cutoff && (days !== 0 || time < tomorrow.getTime())
  }
  const recent = entries.filter(inRange)
  const matchesReadFilter = (entry: BusinessFeedEntry) => readFilter === 'all' || (readFilter === 'unseen' ? entry.unseen : !entry.unseen)
  const visible = (filter === 'later' ? entries.filter((entry) => entry.deferred) : recent.filter((entry) => filter === 'all' || entry.kind === filter))
    .filter((entry) => matchesReadFilter(entry) || (readFilter === 'unseen' && retainedReads.get(entryKey(entry)) === entry.revision))
    .toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt) || entryKey(a).localeCompare(entryKey(b)))
  const displayedRevisions = new Map(entries.map((entry) => [entryKey(entry), entry.revision]))
  const pendingCount = (feed?.incoming ?? []).filter((entry) => displayedRevisions.get(entryKey(entry)) !== entry.revision
    && matchesReadFilter(entry) && (filter === 'later' ? entry.deferred : inRange(entry) && (filter === 'all' || entry.kind === filter))).length
  const eventLabel = (entry: BusinessFeedEntry) => entry.event === 'archived' ? t('已归档', '保管済み') : entry.event === 'status-changed' ? t('状态更新', '状態更新') : entry.event === 'updated' ? t('资料更新', '情報更新') : entry.kind === 'case' ? t('新案件', '新規案件') : t('新人员', '新規要員')
  const fieldLabel = (key: string) => {
    if (key in personnelFieldLabels) return personnelFieldLabels[key as keyof typeof personnelFieldLabels][zh ? 0 : 1]
    const labels: Record<string, [string, string]> = { required_skills: ['技能', 'スキル'], start_date: ['入场时间', '開始時期'], remote: ['工作方式', '勤務形態'], business_status: ['业务状态', '営業状態'], title: ['案件名称', '案件名'] }
    return labels[key]?.[zh ? 0 : 1] ?? key
  }
  const statusValue = (value: string | null) => ({ available: t('可推广', '紹介可能'), soon: t('即将可上岗', '近日稼働可能'), paused: t('暂停推广', '紹介停止'), assigned: t('已在场', '参画中') })[value ?? ''] ?? value ?? t('未提供', '未記載')
  return <section className="latest-business-feed" aria-label={t('最新业务动态', '最新の業務情報')}>
    <header><span className="latest-eyebrow">SES AGENT</span><h2>{t('先看看，有哪些新机会和变化', '新しい案件・要員と更新情報を確認')}</h2>
      <p>{t('案件和人员的最新信息在这里。选中一条即可继续处理，也可以直接告诉 Agent 想做什么。', '最新情報を選択して作業を続けるか、Agentに依頼してください。')}</p></header>
    <div className="latest-feed-actions"><button className="latest-intake" onClick={onIntake} type="button"><Icon name="upload" size={15} />{t('粘贴消息 / 批量整理', '貼り付け・一括整理')}</button>
      <button disabled={loading} onClick={() => void refresh()} type="button"><Icon name="clock" size={14} />{t('刷新动态', '最新情報を再読込')}</button>
      <span>{recent.filter((entry) => entry.unseen).length} {t('条新动态未读', '件が未読')}</span></div>
    <nav aria-label={t('动态筛选', '更新情報の絞り込み')}>
      {(['all','case','person','later'] as const).map((value) => <button key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setRetainedReads(new Map()) }} type="button">{({ all: t('全部', 'すべて'), case: t('案件', '案件'), person: t('人员', '要員'), later: t('稍后处理', 'あとで対応') })[value]}{value === 'later' ? ` (${entries.filter((entry) => entry.deferred).length})` : ''}</button>)}
      <select aria-label={t('阅读状态', '閲覧状態')} value={readFilter} onChange={(event) => { setReadFilter(event.target.value as typeof readFilter); setRetainedReads(new Map()) }}><option value="all">{t('全部状态', 'すべての閲覧状態')}</option><option value="seen">{t('已查看', '確認済み')}</option><option value="unseen">{t('未读', '未読')}</option></select>
      <select aria-label={t('动态时间范围', '更新情報の期間')} disabled={filter === 'later'} value={days} onChange={(event) => { setDays(Number(event.target.value)); setRetainedReads(new Map()) }}><option value={0}>{t('今天', '今日')}</option><option value={7}>{t('最近 7 天', '直近7日')}</option><option value={30}>{t('最近 30 天', '直近30日')}</option><option value={36500}>{t('全部时间', '全期間')}</option></select>
    </nav>
    {readFilter === 'unseen' && visible.some((entry) => !entry.unseen) ? <p className="latest-selection-note">{t('本轮已查看的记录暂留原位，刷新或切换筛选后收起。', '今回確認した情報はその場に残ります。再読込または絞り込み変更で非表示になります。')}</p> : null}
    {pendingCount > 0 ? <div className="latest-feed-update" role="status"><span>{t('有', '更新')} {pendingCount} {t('条新动态，更新后查看', '件があります')}</span><button disabled={loading} onClick={() => void refresh()} type="button">{t('更新列表', '一覧を更新')}</button></div> : null}
    {activeKey && !visible.slice(0, 80).some((entry) => entryKey(entry) === activeKey) ? <p className="latest-selection-note">{t('当前查看的记录不在此列表范围内，右侧仍保留其详情。', '表示中の情報はこの一覧の範囲外です。詳細は右側に表示しています。')}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {loading ? <p className="latest-feed-empty" role="status">{t('正在读取最新信息…', '最新情報を読み込み中…')}</p> : !visible.length ? <p className="latest-feed-empty">{t('当前筛选下没有动态。可以切换阅读状态、扩大时间范围，或粘贴新的消息。', '現在の条件に一致する情報はありません。閲覧状態や期間を変更するか、新しいメッセージを取り込んでください。')}</p> : null}
    <div className="latest-feed-list">{visible.slice(0, 80).map((entry) => {
      const key = entryKey(entry); const busy = marking.has(key); const selected = activeKey === key
      return <article tabIndex={0} onClick={(event) => { if (!(event.target as HTMLElement).closest('button') && !window.getSelection()?.toString()) open(entry, 'view') }} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(entry, 'view') } }} aria-current={selected ? 'true' : undefined} aria-label={entry.title} data-entry-key={key} className={[entry.unseen ? 'is-unseen' : '', selected ? 'is-selected' : ''].filter(Boolean).join(' ')} key={key}>
        <div className="latest-entry-meta"><span className={`latest-entry-kind is-${entry.kind}`}><Icon name={entry.kind === 'case' ? 'briefcase' : 'users'} size={13} />{eventLabel(entry)}</span>
          <time dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString(zh ? 'zh-CN' : 'ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
          <small>{entry.source === 'gmail' ? 'Gmail' : entry.source === 'chat-paste' ? t('粘贴消息', '貼り付け') : entry.source === 'local-personnel' ? t('人员资料', '要員情報') : entry.source}</small><span className="latest-current" aria-hidden={!selected}>{t('当前查看', '表示中')}</span><span className="latest-seen">{entry.unseen ? t('未读', '未読') : t('已查看', '確認済み')}</span></div>
        <button className="latest-entry-title" onClick={() => open(entry, 'view')} type="button">{entry.title}</button>
        <div className="latest-entry-facts">{entry.fields.map((field) => <span className={entry.kind === 'person' && field.key === 'skills' ? 'latest-person-skills' : undefined} key={field.key}><small>{fieldLabel(field.key)}</small><span className="latest-fact-value">{field.value}</span></span>)}</div>
        {entry.changes.length ? <div className="latest-entry-changes">{entry.changes.slice(0, 4).map((change) => <p key={change.key}><strong>{fieldLabel(change.key)}</strong>{change.before ? <><del>{statusValue(change.before)}</del><span>→</span></> : null}<span>{statusValue(change.after)}</span></p>)}</div> : null}
        {Math.abs(Date.parse(entry.sourceAt) - Date.parse(entry.occurredAt)) > 86_400_000 ? <small className="latest-source-date">{t('原始信息日期', '元情報の日付')}：{new Date(entry.sourceAt).toLocaleDateString(zh ? 'zh-CN' : 'ja-JP')}</small> : null}
        <footer><button onClick={() => open(entry, 'view')} type="button">{entry.needsReview ? t('查看 / 补充资料', '情報を確認・補足') : t('查看详情', '詳細を見る')}</button>
          {!entry.archived ? <><button disabled={Boolean(entry.kind === 'person' ? matchingPersonId : matchingCaseReviewId)} aria-busy={(entry.kind === 'person' ? matchingPersonId : matchingCaseReviewId) === entry.objectId} onClick={() => open(entry, 'match')} type="button">{(entry.kind === 'person' ? matchingPersonId : matchingCaseReviewId) === entry.objectId ? t('正在匹配…', 'マッチング中…') : entry.kind === 'case' ? t('找人', '要員を探す') : t('找案件', '案件を探す')}</button><button onClick={() => open(entry, 'promote')} type="button">{t('生成介绍', '紹介文を作成')}</button></> : null}
          <button disabled={busy} onClick={() => { onOpen(entry, 'view'); setLocalSelection(entryKey(entry)); void mark(entry, entry.deferred ? 'done' : 'defer') }} type="button">{entry.deferred ? t('移出稍后处理', 'あとで対応から外す') : t('稍后处理', 'あとで対応')}</button>
          {entry.unseen ? <button disabled={busy} onClick={() => void mark(entry, 'seen')} type="button">{t('标为已读', '既読にする')}</button> : null}</footer>
      </article>
    })}</div>
    {visible.length > 80 ? <p>{t('当前展示最新 80 条，请按类型或时间筛选。', '最新80件を表示しています。種類または期間で絞り込んでください。')}</p> : null}
  </section>
}
