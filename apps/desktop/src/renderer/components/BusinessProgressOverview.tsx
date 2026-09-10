import { useEffect, useRef, useState } from 'react'
import type { BusinessFollowUp, CandidateReviewSnapshot, JobCaseReviewSnapshot } from '@shared'
import { isActiveProgress, progressPresentation, progressSummary, useBusinessProgress } from '../business-progress-data'
import { useUiLocale } from '../i18n'
import type { FollowUpTarget } from './HrFollowUps'
import './business-progress-overview.css'

export function BusinessProgressOverview({ kind, objectId, people, cases, onAdvance, focusRequest }: {
  kind: 'person' | 'case'; objectId: string; people: CandidateReviewSnapshot[]; cases: JobCaseReviewSnapshot[]
  onAdvance(target: FollowUpTarget): void; focusRequest?: number
}) {
  const data = useBusinessProgress(), zh = useUiLocale() === 'zh-CN'
  const [page, setPage] = useState(1), [historyPage, setHistoryPage] = useState(1), [startedPage, setStartedPage] = useState(1)
  const section = useRef<HTMLElement>(null)
  useEffect(() => { setPage(1); setHistoryPage(1); setStartedPage(1) }, [kind, objectId])
  useEffect(() => { if (focusRequest) section.current?.scrollIntoView({ block: 'start' }) }, [focusRequest])
  if (!data) return null
  const rows = data.indexes[kind].get(objectId) ?? []
  const active = rows.filter(isActiveProgress).sort((a, b) => {
    const left = progressPresentation(a, data.now, zh), right = progressPresentation(b, data.now, zh)
    return Number(right.due) - Number(left.due) || (left.when && right.when ? left.when.localeCompare(right.when) : Number(Boolean(right.when)) - Number(Boolean(left.when))) || b.updatedAt.localeCompare(a.updatedAt)
  })
  const started = rows.filter((row) => row.progress?.stage === 'started')
  const history = rows.filter((row) => !isActiveProgress(row) && row.progress?.stage !== 'started').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const title = (row: BusinessFollowUp) => kind === 'person'
    ? cases.find((item) => item.reviewId === row.reviewId)?.fields.find((field) => field.key === 'title')?.value || cases.find((item) => item.reviewId === row.reviewId)?.redactedSubject || (zh ? '案件已删除' : '案件情報なし')
    : people.find((item) => item.documentId === row.documentId)?.localIdentity?.displayName || people.find((item) => item.documentId === row.documentId)?.fileName || (zh ? '人员已删除' : '要員情報なし')
  const time = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00+09:00` : value).toLocaleString(zh ? 'zh-CN' : 'ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', ...(value.length > 10 ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) })
  const renderRows = (group: BusinessFollowUp[]) => group.map((row) => {
    const state = progressPresentation(row, data.now, zh), round = row.progress?.rounds.at(-1)
    const next = state.stage === 'started' ? (row.progress?.entry.actualDate ? time(row.progress.entry.actualDate) : '') : state.when ? time(state.when) : row.nextStep
    const fact = ['closed', 'paused'].includes(state.stage) ? row.note : round?.interviewNotes || round?.contactNote || row.note
    return <article className={`business-progress-relation is-${state.stage}`} key={row.id}>
      <div className="business-progress-relation-heading"><strong>{title(row)}</strong><span>{state.label}</span></div>
      {next ? <p className="business-progress-next">{next}</p> : null}
      {fact ? <p className="business-progress-fact">{fact}</p> : null}
      <footer><small>{zh ? '更新于' : '更新'} {time(row.updatedAt)}</small><button type="button" onClick={() => onAdvance({ documentId: row.documentId, reviewId: row.reviewId })}>{state.action}</button></footer>
    </article>
  })
  const paginate = (group: BusinessFollowUp[], current: number, change: (page: number) => void) => {
    const pages = Math.max(1, Math.ceil(group.length / 3)), safePage = Math.min(current, pages)
    return <>{renderRows(group.slice((safePage - 1) * 3, safePage * 3))}{pages > 1 ? <nav className="business-progress-pagination" aria-label={zh ? '营业情况分页' : '営業状況のページ切替'}><button disabled={safePage === 1} onClick={() => change(safePage - 1)}>{zh ? '上一页' : '前のページ'}</button><span>{safePage} / {pages} · {group.length}</span><button disabled={safePage === pages} onClick={() => change(safePage + 1)}>{zh ? '下一页' : '次のページ'}</button></nav> : null}</>
  }
  return <section ref={section} className="business-progress-overview" aria-label={zh ? '营业情况' : '営業状況'}>
    <header><h3>{zh ? '营业情况' : '営業状況'}</h3><span>{kind === 'person' ? (zh ? '关联案件' : '関連案件') : (zh ? '关联人员' : '関連要員')}</span></header>
    {data.loading ? <p role="status">{zh ? '正在读取营业情况' : '営業状況を読込中'}</p> : data.failed ? <p role="alert">{zh ? '营业情况读取失败' : '営業状況を読み込めませんでした'} <button onClick={() => void data.refresh()}>{zh ? '重试' : '再試行'}</button></p> : <>
      <p className="business-progress-totals">{progressSummary(rows, kind, data.now, zh)}</p>
      {paginate(active, page, setPage)}
      {started.length ? <div className="business-progress-started"><h4>{zh ? '已进场' : '参画済み'}</h4>{paginate(started, startedPage, setStartedPage)}</div> : null}
      {history.length ? <details className="business-progress-history"><summary>{zh ? '历史跟进' : '過去の対応'} ({history.length})</summary>{paginate(history, historyPage, setHistoryPage)}</details> : null}
    </>}
  </section>
}
