import { useEffect, useRef, useState } from 'react'
import type { BusinessFollowUp, CandidateReviewSnapshot, JobCaseReviewSnapshot, SaveBusinessFollowUpInput } from '@shared'
import { useUiLocale } from '../i18n'
import { Icon } from './Icon'

export interface FollowUpTarget { documentId: string; reviewId: string; pendingConditions?: string[] }
type FollowUpStatus = BusinessFollowUp['status']
type FollowUpFilter = 'active' | 'all' | FollowUpStatus
const statuses = ['contacted', 'replied', 'interview', 'closed'] as const
const pageSize = 12
const keyOf = (target: FollowUpTarget) => `${target.documentId}:${target.reviewId}`

export function HrFollowUps({ target, active = true, reloadToken, people, cases, onView, onInterview, onBrowse, onSchedule, onBackToMatches }: {
  target: FollowUpTarget | null; active?: boolean; reloadToken: unknown
  people: CandidateReviewSnapshot[]; cases: JobCaseReviewSnapshot[]
  onInterview(documentId: string): void
  onView(kind: 'case' | 'person', id: string): void
  onBrowse?(kind: 'case' | 'person'): void
  onSchedule?(): void
  onBackToMatches?(): void
}) {
  const zh = useUiLocale() === 'zh-CN'
  const t = (cn: string, ja: string) => zh ? cn : ja
  const [items, setItems] = useState<BusinessFollowUp[]>([])
  const [editing, setEditing] = useState<SaveBusinessFollowUpInput | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [filter, setFilter] = useState<FollowUpFilter>('active')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const lock = useRef(false)
  const loadEpoch = useRef(0)
  const targetRef = useRef<FollowUpTarget | null>(null)
  const drafts = useRef(new Map<string, SaveBusinessFollowUpInput>())
  const noteInput = useRef<HTMLTextAreaElement>(null)
  const detailScroll = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let current = true
    const epoch = ++loadEpoch.current
    setLoading(true)
    void window.sesAgent.listBusinessFollowUps().then((value) => {
      if (current && epoch === loadEpoch.current) { setItems(value); setLoaded(true); setLoadError('') }
    }).catch((cause) => {
      if (current && epoch === loadEpoch.current) setLoadError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { if (current && epoch === loadEpoch.current) setLoading(false) })
    return () => { current = false }
  }, [reloadToken, reload])

  const startEditing = (value: FollowUpTarget, current?: BusinessFollowUp) => {
    const key = keyOf(value)
    const draft = drafts.current.get(key) ?? {
      documentId: value.documentId, reviewId: value.reviewId, expectedRevision: current?.revision ?? 0, status: current?.status ?? 'contacted',
      note: '', nextStep: current?.nextStep || (value.pendingConditions?.length ? `${t('待沟通', '相談事項')}：${value.pendingConditions.join('；')}`.slice(0, 500) : '')
    }
    drafts.current.set(key, draft)
    setSelectedKey(key); setEditing(draft); setDetailOpen(true); setNotice(''); setError('')
  }
  useEffect(() => {
    if (!active || busy || !target || !loaded || targetRef.current === target) return
    targetRef.current = target
    const current = items.find((item) => keyOf(item) === keyOf(target))
    const relevant = items.filter((item) => current?.status === 'closed' ? item.status === 'closed' : item.status !== 'closed')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    const index = relevant.findIndex((item) => keyOf(item) === keyOf(target))
    setFilter(current?.status === 'closed' ? 'closed' : 'active'); setQuery(''); setPage(Math.floor(Math.max(0, index) / pageSize) + 1)
    startEditing(target, current)
  }, [target, active, loaded, items, busy])

  const editingKey = editing ? keyOf(editing) : null
  useEffect(() => { if (active && editingKey) noteInput.current?.focus() }, [editingKey, active])

  const peopleById = new Map(people.map((person) => [person.documentId, person]))
  const casesById = new Map(cases.map((job) => [job.reviewId, job]))
  const name = (id: string) => {
    const person = peopleById.get(id)
    return person?.localIdentity?.displayName || person?.fileName || t('人员不可用', '要員情報なし')
  }
  const title = (id: string) => {
    const job = casesById.get(id)
    return job?.fields.find((field) => field.key === 'title')?.value || job?.redactedSubject || t('案件不可用', '案件情報なし')
  }
  const label = (status: FollowUpStatus) => ({
    contacted: t('已联系', '連絡済み'), replied: t('已回复', '返信あり'),
    interview: t('面试沟通中', '面談調整中'), closed: t('已结束', '対応終了')
  })[status]
  const stamp = (value: string) => new Date(value).toLocaleString(zh ? 'zh-CN' : 'ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    ...(new Date(value).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {})
  })
  const counts = items.reduce((value, item) => { value[item.status]++; return value }, { contacted: 0, replied: 0, interview: 0, closed: 0 })
  const tabs: Array<{ value: FollowUpFilter; text: string; count: number }> = [
    { value: 'active', text: t('进行中', '進行中'), count: items.length - counts.closed },
    ...statuses.map((value) => ({ value, text: label(value), count: counts[value] })),
    { value: 'all', text: t('全部', 'すべて'), count: items.length }
  ]
  const search = query.trim().toLocaleLowerCase()
  const filtered = items.filter((item) => (filter === 'all' || (filter === 'active' ? item.status !== 'closed' : item.status === filter))
    && (!search || [name(item.documentId), title(item.reviewId), item.note, item.nextStep].join('\n').toLocaleLowerCase().includes(search)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pages)
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const selected = visible.find((item) => keyOf(item) === selectedKey) ?? visible[0]
  const shownTarget = editing ?? selected
  const shownItem = editing ? items.find((item) => keyOf(item) === editingKey) : selected
  const events = [...(shownItem?.events ?? [])].reverse()
  useEffect(() => { detailScroll.current?.scrollTo?.({ top: 0 }) }, [shownTarget?.documentId, shownTarget?.reviewId, editingKey])

  const chooseFilter = (value: FollowUpFilter) => {
    setFilter(value); setPage(1); setEditing(null); setDetailOpen(false); setError(''); setNotice('')
  }
  const updateDraft = (update: Partial<SaveBusinessFollowUpInput>) => {
    if (!editing) return
    const next = { ...editing, ...update }
    drafts.current.set(keyOf(next), next); setEditing(next)
  }
  const save = async () => {
    if (!editing || lock.current) return
    lock.current = true; loadEpoch.current++; setBusy(true); setLoading(false); setError(''); setNotice('')
    try {
      const value = await window.sesAgent.saveBusinessFollowUp(editing)
      setItems((current) => [value, ...current.filter((item) => item.id !== value.id)])
      drafts.current.delete(keyOf(value)); setEditing(null); setSelectedKey(keyOf(value)); setPage(1); setQuery('')
      setFilter(value.status === 'closed' ? 'closed' : 'active')
      setNotice(t('跟进已保存', '対応記録を保存しました'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { lock.current = false; setBusy(false) }
  }
  const canSave = editing && (editing.note.trim() || editing.status !== shownItem?.status || editing.nextStep.trim() !== (shownItem?.nextStep ?? ''))

  return <section className="hr-followups" aria-label={t('业务跟进', '業務の対応記録')}>
    <header className="hr-followup-heading">
      <div><h2>{t('推进每一次联系', '次の対応につなげる')}</h2><p>{t('看进展、记沟通，让人员和案件持续向前。', '進捗とやり取りを確認し、要員と案件の次の対応へ。')}</p></div>
      <div className="hr-followup-heading-actions">{onBackToMatches ? <button type="button" disabled={busy} onClick={onBackToMatches}><Icon name="arrow-left" size={15} />{t('返回匹配结果', 'マッチング結果に戻る')}</button> : null}{onSchedule ? <button type="button" disabled={busy} onClick={onSchedule}><Icon name="clock" size={15} />{t('面试日程', '面談日程')}</button> : null}<button type="button" disabled={busy || loading} onClick={() => setReload((value) => value + 1)}>{t('刷新', '再読込')}</button></div>
    </header>
    <div className="hr-followup-filters" role="group" aria-label={t('跟进阶段', '対応段階')}>
      {tabs.map((tab) => <button type="button" key={tab.value} aria-pressed={filter === tab.value} disabled={busy} onClick={() => chooseFilter(tab.value)}>
        {tab.text}<span>{loaded ? tab.count : '—'}</span>
      </button>)}
    </div>
    {loadError ? <p className="hr-followup-message is-error" role="alert">{loadError}</p> : null}
    {notice ? <p className="hr-followup-message" role="status"><Icon name="check" size={15} />{notice}</p> : null}
    <div className={`hr-followup-layout${detailOpen && shownTarget ? ' has-selection' : ''}`}>
      <div className="hr-followup-list-pane">
        <label className="hr-followup-search"><Icon name="search" size={17} /><input type="search" aria-label={t('搜索跟进', '対応記録を検索')} placeholder={t('搜索人员、案件或沟通内容', '要員・案件・メモを検索')} value={query} disabled={busy} onChange={(event) => { setQuery(event.target.value); setPage(1); setEditing(null); setDetailOpen(false); setError('') }} /></label>
        <div className="hr-followup-list-meta"><span>{filtered.length} {t('条跟进', '件の対応記録')}</span><span>{t('最近更新在前', '更新が新しい順')}</span></div>
        <div className="hr-followup-list" aria-label={t('跟进列表', '対応記録一覧')}>
          {loading && !loaded ? <p className="hr-followup-empty">{t('正在读取跟进记录', '対応記録を読込中')}</p> : null}
          {loaded && !visible.length ? <div className="hr-followup-empty">
            <Icon name={items.length ? 'search' : 'phone'} size={28} />
            <h3>{items.length ? t('没有符合条件的跟进', '条件に合う対応記録はありません') : t('从一次联系开始', '最初の連絡から始めましょう')}</h3>
            <p>{items.length ? t('换个阶段或关键词，继续查找。', '段階やキーワードを変えて検索してください。') : t('找到合适的人选后，在匹配结果或介绍窗口记录联系，就能在这里继续推进。', 'マッチング結果や紹介画面で連絡を記録すると、ここで続きの対応ができます。')}</p>
            {items.length ? <button type="button" onClick={() => { chooseFilter('all'); setQuery('') }}>{t('查看全部跟进', 'すべての対応記録を見る')}</button> : onBrowse ? <div className="hr-followup-empty-actions"><button type="button" onClick={() => onBrowse('case')}>{t('去案件找人', '案件から要員を探す')}</button><button type="button" onClick={() => onBrowse('person')}>{t('去人员找案件', '要員から案件を探す')}</button></div> : null}
          </div> : null}
          {visible.map((item) => <button key={item.id} type="button" className="hr-followup-item" aria-pressed={shownTarget ? keyOf(shownTarget) === keyOf(item) : false} disabled={busy}
            onClick={() => { setSelectedKey(keyOf(item)); setEditing(null); setDetailOpen(true); setError(''); setNotice('') }}>
            <span className="hr-followup-item-top"><strong>{name(item.documentId)}</strong><span className={`hr-followup-badge is-${item.status}`}>{label(item.status)}</span></span>
            <span className="hr-followup-case"><Icon name="briefcase" size={14} /><span>{title(item.reviewId)}</span></span>
            {item.status !== 'closed' ? <span className="hr-followup-item-next"><span>{t('下一步', '次の対応')}</span><span>{item.nextStep || t('补记下一步安排', '次の対応を記録しましょう')}</span></span> : null}
            <span className="hr-followup-item-bottom"><time dateTime={item.updatedAt}>{stamp(item.updatedAt)}</time><span>{drafts.current.has(keyOf(item)) ? t('有未保存草稿', '未保存の下書きあり') : `${item.events.length} ${t('次记录', '件の履歴')}`}</span></span>
          </button>)}
        </div>
        {pages > 1 ? <nav className="hr-followup-pagination" aria-label={t('跟进分页', '対応記録のページ切替')}>
          <button type="button" disabled={busy || currentPage <= 1} onClick={() => { setPage(currentPage - 1); setEditing(null); setDetailOpen(false) }}>{t('上一页', '前のページ')}</button><span>{currentPage} / {pages}</span><button type="button" disabled={busy || currentPage >= pages} onClick={() => { setPage(currentPage + 1); setEditing(null); setDetailOpen(false) }}>{t('下一页', '次のページ')}</button>
        </nav> : null}
      </div>
      {shownTarget ? <article className="hr-followup-detail" aria-label={t('跟进详情', '対応記録の詳細')}>
        <header className="hr-followup-detail-header">
          <button type="button" className="hr-followup-return" disabled={busy} onClick={() => { setDetailOpen(false); setEditing(null); setError('') }}><Icon name="arrow-left" size={15} />{t('返回跟进列表', '対応記録一覧に戻る')}</button>
          <div className="hr-followup-person"><span className="hr-followup-person-icon"><Icon name="users" size={22} /></span><div><span className="hr-followup-eyebrow">{t('人员与案件', '要員と案件')}</span><h3>{name(shownTarget.documentId)}</h3></div><span className={`hr-followup-badge is-${shownItem?.status ?? 'contacted'}`}>{shownItem ? label(shownItem.status) : t('首次联系', '初回の連絡')}</span></div>
          <p className="hr-followup-case"><Icon name="briefcase" size={16} /><span>{title(shownTarget.reviewId)}</span></p>
          <div className="hr-followup-actions">
            <button type="button" disabled={busy} onClick={() => onView('case', shownTarget.reviewId)}><Icon name="briefcase" size={15} />{t('查看案件', '案件を見る')}</button>
            <button type="button" disabled={busy} onClick={() => onView('person', shownTarget.documentId)}><Icon name="users" size={15} />{t('查看人员', '要員を見る')}</button>
            {shownItem?.status === 'interview' ? <button type="button" disabled={busy} onClick={() => onInterview(shownTarget.documentId)}>{t('面试记录', '面談記録')}</button> : null}
            {!editing ? <button type="button" className="hr-primary" disabled={busy} onClick={() => startEditing(shownTarget, shownItem)}><Icon name="plus" size={15} />{drafts.current.has(keyOf(shownTarget)) ? t('继续填写', '下書きを続ける') : t('记录新进展', '進捗を記録')}</button> : null}
          </div>
        </header>
        <div className="hr-followup-detail-scroll" ref={detailScroll}>
          {editing ? <form className="hr-followup-editor" onSubmit={(event) => { event.preventDefault(); void save() }}>
            <h4>{shownItem ? t('记录新进展', '進捗を記録') : t('记录首次联系', '初回の連絡を記録')}</h4>
            <fieldset disabled={busy}><legend>{t('联系情况', '対応状況')}</legend><div className="hr-followup-status-options">{statuses.map((value) => <label key={value} className={editing.status === value ? 'is-selected' : ''}><input type="radio" name="followup-status" value={value} checked={editing.status === value} onChange={() => updateDraft({ status: value })} />{label(value)}</label>)}</div></fieldset>
            <label>{t('本次沟通', '今回のメモ')}<textarea ref={noteInput} disabled={busy} maxLength={2000} rows={4} placeholder={t('对方反馈了什么？这次确认了什么？', '相手の反応や、今回確認できたことを記録')} value={editing.note} onChange={(event) => updateDraft({ note: event.target.value })} /></label>
            <label>{t('下一步', '次の対応')}<textarea disabled={busy} maxLength={500} rows={2} placeholder={t('接下来找谁、确认什么', '次に誰へ、何を確認するか')} value={editing.nextStep} onChange={(event) => updateDraft({ nextStep: event.target.value })} /></label>
            {error ? <p className="hr-followup-message is-error" role="alert">{error}</p> : null}
            <footer><span>{t('保存后追加到沟通记录', '保存すると履歴に追加されます')}</span><button type="button" disabled={busy} onClick={() => { drafts.current.delete(keyOf(editing)); setEditing(null); setError('') }}>{t('取消', 'キャンセル')}</button><button className="hr-primary" type="submit" disabled={busy || !canSave}>{busy ? t('正在保存', '保存中') : t('保存跟进', '対応記録を保存')}</button></footer>
          </form> : shownItem ? <section className={`hr-followup-next${shownItem.status === 'closed' ? ' is-closed' : ''}`} aria-label={t('下一步安排', '次の対応予定')}>
            <span className="hr-followup-next-icon"><Icon name={shownItem.status === 'closed' ? 'check' : 'arrow-up'} size={18} /></span><div><h4>{shownItem.status === 'closed' ? t('本次跟进已结束', 'この対応は終了しました') : t('下一步', '次の対応')}</h4><p>{shownItem.nextStep || (shownItem.status === 'closed' ? t('沟通记录已保留，可随时查看。', 'これまでの履歴は引き続き確認できます。') : t('还没有下一步安排，记录新进展时可以补充。', '次の対応は未記入です。進捗の記録時に追加できます。'))}</p></div>
          </section> : null}
          <section className="hr-followup-history" aria-label={t('沟通记录', 'やり取りの履歴')}>
            <header><h4>{t('沟通记录', 'やり取りの履歴')}<span>{events.length}</span></h4><span>{t('最新在前', '新しい順')}</span></header>
            {events.length ? <ol className="hr-followup-timeline">{events.map((event, index) => <li key={`${event.recordedAt}:${index}`}>
              <span className={`hr-followup-timeline-marker is-${event.status}`}><Icon name={event.status === 'closed' ? 'check' : event.status === 'interview' ? 'users' : event.status === 'replied' ? 'mail' : 'phone'} size={14} /></span>
              <div className="hr-followup-event"><div className="hr-followup-event-meta"><strong>{label(event.status)}</strong>{index === 0 ? <span className="hr-followup-latest">{t('最新', '最新')}</span> : null}<time dateTime={event.recordedAt}>{stamp(event.recordedAt)}</time></div>
                <p className="hr-followup-note">{event.note || t('更新了联系情况或下一步安排。', '対応状況または次の対応を更新しました。')}</p>
                {event.nextStep ? <div className="hr-followup-event-next"><span>{t('当时的下一步', 'その時点の次の対応')}</span><p>{event.nextStep}</p></div> : null}
              </div>
            </li>)}</ol> : <p className="hr-followup-history-empty">{t('保存第一次联系后，沟通记录会显示在这里。', '初回の連絡を保存すると、ここに履歴が表示されます。')}</p>}
          </section>
        </div>
      </article> : <div className="hr-followup-detail-placeholder"><Icon name="tasks" size={30} /><h3>{t('接着上次沟通，继续推进', '前回のやり取りから次の対応へ')}</h3><p>{t('选择一条跟进，查看下一步和沟通记录。', '対応記録を選ぶと、次の対応と履歴を確認できます。')}</p></div>}
    </div>
  </section>
}
