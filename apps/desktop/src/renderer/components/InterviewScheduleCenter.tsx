import { useEffect, useMemo, useState } from 'react'
import type { BusinessFollowUp, CandidateInterviewSnapshot, CandidateReviewSnapshot, JobCaseReviewSnapshot } from '@shared'
import { Icon } from './Icon'
import { useRendererUiRefresh, useUiLocale } from '../i18n'
import type { PipelineView } from './CandidatePipeline'

type ScheduleTab = 'calendar' | 'list'
type ScheduleKindFilter = 'all' | CandidateInterviewSnapshot['kind']
type ScheduleStatus = 'unbooked' | 'preparing' | 'ready' | 'decision' | 'finished'

export type InterviewScheduleRoute = {
  businessFollowUpId?: string | null
  sourceDocumentId: string
  interviewId: string | null
  kind: CandidateInterviewSnapshot['kind']
  view: PipelineView
}

type ScheduleRow = {
  id: string
  interview: CandidateInterviewSnapshot | null
  review: CandidateReviewSnapshot
  kind: CandidateInterviewSnapshot['kind']
  status: ScheduleStatus
  scheduledAt: string | null
  interviewer: string | null
  label: string
  route: InterviewScheduleRoute
  conflict: boolean
}

type DateParts = { year: number; month: number; day: number }

const tokyoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
})

function fieldValue(review: CandidateReviewSnapshot, key: string): string | null {
  return review.fields.find((field) => field.key === key)?.value ?? null
}

function candidateName(review: CandidateReviewSnapshot): string {
  return review.localIdentity?.displayName ?? review.fileName.replace(/\.(pdf|docx|xlsx|xls|xlsb)$/iu, '')
}

function dateParts(value: Date): DateParts {
  const values = Object.fromEntries(tokyoDateFormatter.formatToParts(value)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value])) as Record<string, string>
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) }
}

function dateKey(parts: DateParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function tokyoDateKey(value: string): string {
  return dateKey(dateParts(new Date(value)))
}

function dateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!))
}

function keyFromUtcDate(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
}

function mondayFor(key: string): string {
  const date = dateFromKey(key)
  const shift = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - shift)
  return keyFromUtcDate(date)
}

function addDays(key: string, offset: number): string {
  const date = dateFromKey(key)
  date.setUTCDate(date.getUTCDate() + offset)
  return keyFromUtcDate(date)
}

function formatTokyoDate(key: string, locale: 'ja-JP' | 'zh-CN', withWeekday = true): string {
  const date = dateFromKey(key)
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC', month: 'numeric', day: 'numeric', ...(withWeekday ? { weekday: 'short' } : {})
  }).format(date)
}

function formatTokyoTime(value: string, locale: 'ja-JP' | 'zh-CN'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(value))
}

function tokyoClockMinutes(value: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date(value)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])) as Record<string, string>
  return (Number(parts.hour) % 24) * 60 + Number(parts.minute)
}

function interviewLabel(interview: CandidateInterviewSnapshot, zh: boolean): string {
  if (interview.kind === 'client') return zh ? `客户面试 ${interview.roundNumber}` : `顧客面談 ${interview.roundNumber}`
  if (interview.roundNumber === 1) return zh ? '招聘初面' : '採用一次面談'
  return zh ? `招聘复试 ${interview.roundNumber - 1}` : `採用再面談 ${interview.roundNumber - 1}`
}

function meetingLabel(interview: CandidateInterviewSnapshot, zh: boolean): string {
  if (interview.meetingMethod === 'zoom') return 'Zoom'
  if (interview.meetingMethod === 'google-meet') return 'Google Meet'
  return interview.meetingMethod === 'phone' ? (zh ? '电话' : '電話') : (zh ? '现场' : '対面')
}

function statusFor(interview: CandidateInterviewSnapshot | null): ScheduleStatus {
  if (!interview || interview.stage === 'new' || interview.stage === 'contacting') return 'unbooked'
  if (interview.stage === 'scheduled') return interview.questionPlan.some((question) => question.selected) ? 'ready' : 'preparing'
  if (interview.stage === 'prepared' || interview.stage === 'interviewing') return 'ready'
  if (interview.stage === 'awaiting-decision') return 'decision'
  return 'finished'
}

function viewFor(interview: CandidateInterviewSnapshot | null): PipelineView {
  if (!interview || interview.stage === 'new' || interview.stage === 'contacting') return 'schedule'
  if (interview.stage === 'scheduled') return interview.questionPlan.some((question) => question.selected) ? 'workbench' : 'prepare'
  if (interview.stage === 'awaiting-decision') return 'decision'
  if (interview.stage === 'prepared' || interview.stage === 'interviewing') return 'workbench'
  return interview.kind === 'client' ? 'client' : 'workbench'
}

function overlaps(left: CandidateInterviewSnapshot, right: CandidateInterviewSnapshot): boolean {
  if (!left.scheduledAt || !right.scheduledAt || !left.interviewer || left.id === right.id) return false
  const rightInterviewer = right.interviewer
  if (!rightInterviewer || left.interviewer.trim().toLocaleLowerCase('ja-JP') !== rightInterviewer.trim().toLocaleLowerCase('ja-JP')) return false
  const leftStart = new Date(left.scheduledAt).getTime()
  const rightStart = new Date(right.scheduledAt).getTime()
  const leftEnd = leftStart + left.durationMinutes * 60_000
  const rightEnd = rightStart + right.durationMinutes * 60_000
  return leftStart < rightEnd && rightStart < leftEnd
}

function latestInterview(
  interviews: CandidateInterviewSnapshot[],
  documentId: string,
  kind: CandidateInterviewSnapshot['kind']
): CandidateInterviewSnapshot | null {
  return interviews
    .filter((interview) => interview.sourceDocumentId === documentId && interview.kind === kind)
    .toSorted((left, right) => right.roundNumber - left.roundNumber || right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
}

function statusLabel(status: ScheduleStatus, zh: boolean): string {
  return ({
    unbooked: zh ? '待预约' : '予約待ち',
    preparing: zh ? '待准备' : '準備待ち',
    ready: zh ? '可开始/进行中' : '開始可能・面談中',
    decision: zh ? '待结论' : '結論待ち',
    finished: zh ? '已结束' : '完了'
  })[status]
}

function nextActionLabel(row: ScheduleRow, zh: boolean): string {
  if (row.interview?.businessFollowUpId) return zh ? '打开案件推进' : '案件の進行を開く'
  if (row.status === 'unbooked') return row.interview?.roundNumber && row.interview.roundNumber > 1
    ? (zh ? '预约复试' : '再面談を予約')
    : (zh ? '预约面试' : '面談を予約')
  if (row.status === 'preparing') return zh ? '准备问题' : '質問を準備'
  if (row.status === 'ready') return zh ? '进入面试' : '面談を開く'
  if (row.status === 'decision') return zh ? '填写结论' : '結論を入力'
  return zh ? '查看记录' : '記録を見る'
}

function routeFor(review: CandidateReviewSnapshot, interview: CandidateInterviewSnapshot | null, kind: CandidateInterviewSnapshot['kind']): InterviewScheduleRoute {
  return {
    businessFollowUpId: interview?.businessFollowUpId,
    sourceDocumentId: review.documentId,
    interviewId: interview?.id ?? null,
    kind,
    view: viewFor(interview)
  }
}

export function InterviewScheduleCenter({
  interviews,
  reviews,
  cases = [],
  onOpenInterview
}: {
  interviews: CandidateInterviewSnapshot[]
  reviews: CandidateReviewSnapshot[]
  cases?: JobCaseReviewSnapshot[]
  onOpenInterview(route: InterviewScheduleRoute): void
}) {
  useRendererUiRefresh()
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const [tab, setTab] = useState<ScheduleTab>('calendar')
  const [weekStart, setWeekStart] = useState(() => mondayFor(dateKey(dateParts(new Date()))))
  const [kindFilter, setKindFilter] = useState<ScheduleKindFilter>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | ScheduleStatus>('all')
  const [interviewerFilter, setInterviewerFilter] = useState('all')
  const [query, setQuery] = useState('')

  const [followUps,setFollowUps] = useState<BusinessFollowUp[]>([])
  useEffect(() => { let alive=true; void window.sesAgent.listBusinessFollowUps().then((rows) => { if(alive)setFollowUps(rows) }).catch(() => {}); return () => {alive=false} }, [interviews])
  const reviewByDocumentId = useMemo(() => new Map(reviews.map((review) => [review.documentId, review])), [reviews])
  const rows = useMemo(() => {
    const liveRows = interviews.flatMap((interview): ScheduleRow[] => {
      const review = reviewByDocumentId.get(interview.sourceDocumentId)
      if (!review) return []
      const follow = followUps.find((row) => row.id === interview.businessFollowUpId)
      const job = cases.find((row) => row.reviewId === follow?.reviewId)
      const caseTitle = job?.fields.find((field) => field.key === 'title')?.value ?? job?.redactedSubject
      const inactive = ['closed','paused','started'].includes(follow?.progress?.stage ?? '')
      const unscheduled = follow?.progress?.stage === 'coordinating'
      const status = inactive ? 'finished' : unscheduled ? 'unbooked' : statusFor(interview)
      return [{
        id: interview.id,
        interview,
        review,
        kind: interview.kind,
        status,
        scheduledAt: unscheduled ? null : interview.scheduledAt,
        interviewer: interview.interviewer,
        label: [caseTitle,interviewLabel(interview, zh)].filter(Boolean).join(' · '),
        route: routeFor(review, interview, interview.kind),
        conflict: !inactive && !interview.decision && interviews.some((other) => !other.decision && !followUps.some((row) => row.id === other.businessFollowUpId && ['closed','paused','started'].includes(row.progress?.stage ?? '')) && overlaps(interview, other))
      }]
    })
    // A reviewed resume without a recruiting session is still actionable. It
    // is represented as a virtual row only; the interview record is created
    // by the existing schedule-save use case after HR chooses a time.
    const withoutRecruitingSession = reviews.flatMap((review): ScheduleRow[] => {
      // Once a recruiting decision has produced a local profile (active or
      // archived), it is no longer an unbooked recruiting candidate.
      if (review.profile || latestInterview(interviews, review.documentId, 'recruiting')) return []
      return [{
        id: `unbooked:${review.documentId}`,
        interview: null,
        review,
        kind: 'recruiting',
        status: 'unbooked',
        scheduledAt: null,
        interviewer: null,
        label: zh ? '招聘初面' : '採用一次面談',
        route: routeFor(review, null, 'recruiting'),
        conflict: false
      }]
    })
    const actionPriority: Record<ScheduleStatus, number> = { unbooked: 0, decision: 1, preparing: 2, ready: 3, finished: 4 }
    return [...liveRows, ...withoutRecruitingSession]
      .toSorted((left, right) => actionPriority[left.status] - actionPriority[right.status] || (left.scheduledAt ?? '9999').localeCompare(right.scheduledAt ?? '9999') || left.label.localeCompare(right.label, locale))
  }, [interviews, locale, reviewByDocumentId, reviews, zh, cases, followUps])
  const interviewers = useMemo(() => [...new Set(rows.map((row) => row.interviewer).filter((value): value is string => Boolean(value)))].toSorted(), [rows])
  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale)
    return rows.filter((row) => {
      if (kindFilter !== 'all' && row.kind !== kindFilter) return false
      if (statusFilter !== 'all' && row.status !== statusFilter) return false
      if (interviewerFilter !== 'all' && row.interviewer !== interviewerFilter) return false
      if (!normalized) return true
      return [candidateName(row.review), row.review.fileName, fieldValue(row.review, 'role'), row.interviewer, row.label]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase(locale).includes(normalized))
    })
  }, [interviewerFilter, kindFilter, locale, query, rows, statusFilter])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])
  const weekRows = useMemo(() => filteredRows.filter((row) => row.scheduledAt && weekDays.includes(tokyoDateKey(row.scheduledAt))), [filteredRows, weekDays])
  const calendarHours = useMemo(() => {
    const scheduled = weekRows.filter((row): row is ScheduleRow & { scheduledAt: string; interview: CandidateInterviewSnapshot } => Boolean(row.scheduledAt && row.interview))
    const earliest = scheduled.length ? Math.min(...scheduled.map((row) => Math.floor(tokyoClockMinutes(row.scheduledAt) / 60))) : 8
    const latest = scheduled.length ? Math.max(...scheduled.map((row) => Math.ceil((tokyoClockMinutes(row.scheduledAt) + row.interview.durationMinutes) / 60))) : 20
    const start = Math.max(0, Math.min(8, earliest))
    const end = Math.min(24, Math.max(20, latest))
    return Array.from({ length: Math.max(1, end - start) }, (_, index) => start + index)
  }, [weekRows])
  const unbookedCount = rows.filter((row) => row.status === 'unbooked').length
  const conflictCount = rows.filter((row) => row.conflict).length
  const statusOptions: ScheduleStatus[] = ['unbooked', 'preparing', 'ready', 'decision', 'finished']

  return <main className="interview-schedule-center" aria-label={zh ? '面试日程中心' : '面談日程センター'}>
    <header className="candidate-queue-header interview-schedule-header">
      <div><span>INTERVIEW SCHEDULE</span><h1>{zh ? '面试日程' : '面談日程'}</h1><p>{zh ? '先按时间总览所有招聘与客户面试；点击任一日程后，再进入该候选人的准确轮次处理。' : '採用・顧客面談を時間軸で一覧し、日程を選んでから対象候補者の該当回次を処理します。'}</p></div>
      <div className="interview-schedule-header-actions"><span><strong>{unbookedCount}</strong>{zh ? ' 待预约' : ' 予約待ち'}</span><span className={conflictCount ? 'has-alert' : ''}><strong>{conflictCount}</strong>{zh ? ' 时间冲突' : ' 時間重複'}</span></div>
    </header>

    <section className="interview-schedule-panel">
      <div className="interview-schedule-toolbar">
        <nav aria-label={zh ? '日程视图' : '日程表示'} className="interview-schedule-tabs">
          <button aria-selected={tab === 'calendar'} className={tab === 'calendar' ? 'is-active' : ''} onClick={() => setTab('calendar')} role="tab" type="button"><Icon name="clock" size={15} />{zh ? '日历' : 'カレンダー'}</button>
          <button aria-selected={tab === 'list'} className={tab === 'list' ? 'is-active' : ''} onClick={() => setTab('list')} role="tab" type="button"><Icon name="tasks" size={15} />{zh ? '全部面试' : 'すべての面談'}</button>
        </nav>
        <div className="interview-schedule-filters">
          <label><span>{zh ? '类型' : '種別'}</span><select aria-label={zh ? '面试类型' : '面談種別'} onChange={(event) => setKindFilter(event.target.value as ScheduleKindFilter)} value={kindFilter}><option value="all">{zh ? '全部' : 'すべて'}</option><option value="recruiting">{zh ? '招聘面试' : '採用面談'}</option><option value="client">{zh ? '客户面试' : '顧客面談'}</option></select></label>
          <label><span>{zh ? '状态' : '状態'}</span><select aria-label={zh ? '面试状态' : '面談状態'} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} value={statusFilter}><option value="all">{zh ? '全部状态' : 'すべての状態'}</option>{statusOptions.map((status) => <option key={status} value={status}>{statusLabel(status, zh)}</option>)}</select></label>
          <label><span>{zh ? '负责人' : '担当者'}</span><select aria-label={zh ? '面试负责人' : '面談担当者'} onChange={(event) => setInterviewerFilter(event.target.value)} value={interviewerFilter}><option value="all">{zh ? '全部负责人' : 'すべての担当者'}</option>{interviewers.map((interviewer) => <option key={interviewer} value={interviewer}>{interviewer}</option>)}</select></label>
          <label className="candidate-queue-search"><Icon name="search" size={15} /><input aria-label={zh ? '搜索面试' : '面談を検索'} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '候选人、职位、负责人' : '候補者・職種・担当者'} value={query} /></label>
        </div>
      </div>

      {tab === 'calendar' ? <section aria-label={zh ? '周日历' : '週カレンダー'} className="interview-week-calendar">
        <header className="interview-week-controls"><div><button aria-label={zh ? '上一周' : '前の週'} onClick={() => setWeekStart((current) => addDays(current, -7))} type="button">‹</button><strong>{formatTokyoDate(weekDays[0]!, locale, false)} – {formatTokyoDate(weekDays.at(-1)!, locale, false)}</strong><button aria-label={zh ? '下一周' : '次の週'} onClick={() => setWeekStart((current) => addDays(current, 7))} type="button">›</button></div><button className="is-today" onClick={() => setWeekStart(mondayFor(dateKey(dateParts(new Date()))))} type="button">{zh ? '今天' : '今日'}</button></header>
        <div className="interview-week-grid">
          <aside className="interview-week-time-axis" aria-hidden="true" style={{ gridTemplateRows: `50px repeat(${calendarHours.length}, 46px)` }}><span />{calendarHours.map((hour) => <span key={hour}>{String(hour).padStart(2, '0')}:00</span>)}</aside>
          {weekDays.map((dayKey) => {
            const dayRows = weekRows.filter((row) => row.scheduledAt && tokyoDateKey(row.scheduledAt) === dayKey)
            const laneEnds: number[] = []
            const positionedRows = dayRows.toSorted((left, right) => left.scheduledAt!.localeCompare(right.scheduledAt!)).map((row) => {
              const start = new Date(row.scheduledAt!).getTime()
              const lane = laneEnds.findIndex((end) => end <= start)
              const resolvedLane = lane >= 0 ? lane : laneEnds.length
              laneEnds[resolvedLane] = start + row.interview!.durationMinutes * 60_000
              return { row, lane: resolvedLane }
            })
            const laneCount = Math.max(1, laneEnds.length)
            const calendarStartMinutes = calendarHours[0]! * 60
            const calendarHeight = calendarHours.length * 46
            return <section className="interview-week-day" key={dayKey}><header className={dayKey === dateKey(dateParts(new Date())) ? 'is-today' : ''}><strong>{formatTokyoDate(dayKey, locale)}</strong><small>{dayRows.length ? (zh ? `${dayRows.length} 场` : `${dayRows.length}件`) : '—'}</small></header><div className="interview-week-day-slots" style={{ gridTemplateRows: `repeat(${calendarHours.length}, 46px)` }}>{calendarHours.map((hour) => <span key={hour} />)}{positionedRows.map(({ row, lane }) => {
              const top = Math.max(0, (tokyoClockMinutes(row.scheduledAt!) - calendarStartMinutes) / 60 * 46)
              const availableHeight = Math.max(30, calendarHeight - top - 4)
              const height = Math.min(availableHeight, Math.max(36, row.interview!.durationMinutes / 60 * 46 - 4))
              return <button aria-label={`${candidateName(row.review)} ${row.label}`} className={`interview-calendar-event is-${row.kind}${row.conflict ? ' has-conflict' : ''}`} key={row.id} onClick={() => onOpenInterview(row.route)} style={{ top: `${top}px`, height: `${height}px`, left: `calc(${lane / laneCount * 100}% + 4px)`, width: `calc(${100 / laneCount}% - 8px)` }} type="button"><span>{formatTokyoTime(row.scheduledAt!, locale)}</span><strong>{candidateName(row.review)}</strong><small>{row.label} · {meetingLabel(row.interview!, zh)}</small>{row.conflict ? <em>{zh ? '时间冲突' : '時間重複'}</em> : null}</button>
            })}</div></section>
          })}
        </div>
        {weekRows.length === 0 ? <div className="interview-schedule-empty"><Icon name="clock" size={24} /><strong>{zh ? '本周没有符合条件的已预约面试' : 'この週に該当する予約済み面談はありません'}</strong><span>{unbookedCount ? (zh ? `${unbookedCount} 位候选人仍待预约，可切换到“全部面试”处理。` : `${unbookedCount}名が予約待ちです。「すべての面談」で対応できます。`) : (zh ? '可以切换周次或调整筛选条件。' : '週を切り替えるか、絞り込み条件を変更してください。')}</span></div> : null}
      </section> : <section aria-label={zh ? '全部面试列表' : 'すべての面談一覧'} className="interview-schedule-list">
        <header><strong>{zh ? `全部面试（${filteredRows.length}）` : `すべての面談（${filteredRows.length}）`}</strong><span>{zh ? '待预约优先显示，已结束默认保留为可查询记录。' : '予約待ちを優先表示し、完了済みも検索できる記録として残します。'}</span></header>
        <div className="candidate-queue-table-wrap"><table className="candidate-queue-table interview-schedule-table"><thead><tr><th>{zh ? '时间/状态' : '日時・状態'}</th><th>{zh ? '候选人' : '候補者'}</th><th>{zh ? '面试' : '面談'}</th><th>{zh ? '方式' : '方法'}</th><th>{zh ? '负责人' : '担当者'}</th><th>{zh ? '下一步' : '次の行動'}</th></tr></thead><tbody>{filteredRows.map((row) => <tr key={row.id} className={row.conflict ? 'has-conflict' : ''}><td><strong>{row.scheduledAt ? `${formatTokyoDate(tokyoDateKey(row.scheduledAt), locale, false)} ${formatTokyoTime(row.scheduledAt, locale)}` : statusLabel(row.status, zh)}</strong><small>{row.conflict ? (zh ? '同一负责人时间冲突' : '同じ担当者の時間重複') : statusLabel(row.status, zh)}</small></td><td><button className="candidate-queue-person" onClick={() => onOpenInterview(row.route)} type="button"><span>{candidateName(row.review).slice(-1)}</span><span><strong>{candidateName(row.review)}</strong><small>{fieldValue(row.review, 'role') ?? (zh ? '职位待确认' : '職種未確認')}</small></span></button></td><td><span className={`interview-schedule-kind is-${row.kind}`}>{row.label}</span></td><td><strong>{row.interview ? meetingLabel(row.interview, zh) : '—'}</strong><small>{row.interview?.contactNote ?? (zh ? '尚未填写安排说明' : '調整メモ未入力')}</small></td><td><strong>{row.interviewer ?? (zh ? '待安排' : '未設定')}</strong><small>{row.interview?.roundNumber ? (zh ? `第 ${row.interview.roundNumber} 轮` : `${row.interview.roundNumber}回目`) : '—'}</small></td><td><button className="candidate-queue-action is-primary" onClick={() => onOpenInterview(row.route)} type="button">{nextActionLabel(row, zh)}<Icon name="chevron-right" size={14} /></button></td></tr>)}</tbody></table></div>
        {filteredRows.length === 0 ? <div className="interview-schedule-empty"><Icon name="search" size={24} /><strong>{zh ? '没有符合条件的面试' : '条件に合う面談はありません'}</strong><span>{zh ? '请调整筛选或搜索条件。' : '絞り込みまたは検索条件を変更してください。'}</span></div> : null}
      </section>}
    </section>
  </main>
}
