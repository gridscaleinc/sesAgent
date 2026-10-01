import { tokyoDateKey, dateFromKey, mondayFor, addDays, tokyoClockMinutes } from '../tokyo-calendar'
import { useEffect, useMemo, useState } from 'react'
import { businessProgressStep, followUpBlock, isInactiveProgressStage, scheduleClash } from '@shared'
import type { BusinessFollowUp, CandidateInterviewSnapshot, CandidateReviewSnapshot, JobCaseReviewSnapshot } from '@shared'
import { Icon } from './Icon'
import { localeText, useUiLocale } from '../i18n'
import type { PipelineView } from './CandidatePipeline'
import { needsRecruitingWork } from './CandidateWorkspaces'

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

function fieldValue(review: CandidateReviewSnapshot, key: string): string | null {
  return review.fields.find((field) => field.key === key)?.value ?? null
}

function candidateName(review: CandidateReviewSnapshot): string {
  return review.localIdentity?.displayName ?? review.fileName.replace(/\.(pdf|docx|xlsx|xls|xlsb)$/iu, '')
}

function formatTokyoDate(key: string, locale: 'ja-JP' | 'zh-CN', withWeekday = true): string {
  const date = dateFromKey(key)
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    month: 'numeric',
    day: 'numeric',
    ...(withWeekday ? { weekday: 'short' } : {})
  }).format(date)
}

function formatTokyoTime(value: string, locale: 'ja-JP' | 'zh-CN'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value))
}

function interviewLabel(interview: CandidateInterviewSnapshot, zh: boolean): string {
  const t = localeText(zh)

  if (interview.kind === 'client') return t(`客户面试 ${interview.roundNumber}`, `顧客面談 ${interview.roundNumber}`)
  if (interview.roundNumber === 1) return t('招聘初面', '採用一次面談')
  return t(`招聘复试 ${interview.roundNumber - 1}`, `採用再面談 ${interview.roundNumber - 1}`)
}

function meetingLabel(interview: CandidateInterviewSnapshot, zh: boolean): string {
  const t = localeText(zh)

  if (interview.meetingMethod === 'zoom') return 'Zoom'
  if (interview.meetingMethod === 'google-meet') return 'Google Meet'
  return interview.meetingMethod === 'phone' ? t('电话', '電話') : t('现场', '対面')
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

function latestInterview(
  interviews: CandidateInterviewSnapshot[],
  documentId: string,
  kind: CandidateInterviewSnapshot['kind']
): CandidateInterviewSnapshot | null {
  return (
    interviews
      .filter((interview) => interview.sourceDocumentId === documentId && interview.kind === kind)
      .toSorted((left, right) => right.roundNumber - left.roundNumber || right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  )
}

function statusLabel(status: ScheduleStatus, zh: boolean): string {
  const t = localeText(zh)

  return {
    unbooked: t('待预约', '予約待ち'),
    preparing: t('待准备', '準備待ち'),
    ready: t('可开始/进行中', '開始可能・面談中'),
    decision: t('待结论', '結論待ち'),
    finished: t('已结束', '完了')
  }[status]
}

function nextActionLabel(row: ScheduleRow, zh: boolean): string {
  const t = localeText(zh)

  if (row.interview?.businessFollowUpId) return t('打开案件跟进', '案件の対応を開く')
  if (row.status === 'unbooked')
    return row.interview?.roundNumber && row.interview.roundNumber > 1 ? t('预约复试', '再面談を予約') : t('预约面试', '面談を予約')
  if (row.status === 'preparing') return t('准备问题', '質問を準備')
  if (row.status === 'ready') return t('进入面试', '面談を開く')
  if (row.status === 'decision') return t('填写结论', '結論を入力')
  return t('查看记录', '記録を見る')
}

function routeFor(
  review: CandidateReviewSnapshot,
  interview: CandidateInterviewSnapshot | null,
  kind: CandidateInterviewSnapshot['kind']
): InterviewScheduleRoute {
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
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const t = localeText(zh)
  const [tab, setTab] = useState<ScheduleTab>('calendar')
  const [weekStart, setWeekStart] = useState(() => mondayFor(tokyoDateKey(new Date())))
  const [kindFilter, setKindFilter] = useState<ScheduleKindFilter>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | ScheduleStatus>('all')
  const [interviewerFilter, setInterviewerFilter] = useState('all')
  const [query, setQuery] = useState('')

  const [followUps, setFollowUps] = useState<BusinessFollowUp[]>([])
  useEffect(() => {
    let alive = true
    void window.sesAgent
      .listBusinessFollowUps()
      .then((rows) => {
        if (alive) setFollowUps(rows)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [interviews])
  // Who is not being offered (暂停营业) or in place (已进场): their follow-ups cannot be booked, as 今天 and the menu bar count.
  const [personStatuses, setPersonStatuses] = useState<ReadonlyMap<string, string>>(new Map())
  // Pairs HR judged 不满足: nothing to book for them either (as 跟进, 今天 and the menu bar).
  const [hrRejected, setHrRejected] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    let alive = true
    void Promise.resolve(window.sesAgent.listHrRejectedFollowUps?.())
      .then((keys) => {
        if (alive) setHrRejected(new Set(keys ?? []))
      })
      .catch(() => {})
    void window.sesAgent
      .getPersonnelWorkspace?.()
      .then((workspace) => {
        if (alive) setPersonStatuses(new Map(workspace.states.map((state) => [state.documentId, state.status])))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [interviews, reviews])
  const reviewByDocumentId = useMemo(() => new Map(reviews.map((review) => [review.documentId, review])), [reviews])
  const rows = useMemo(() => {
    const liveRows = interviews.flatMap((interview): ScheduleRow[] => {
      const review = reviewByDocumentId.get(interview.sourceDocumentId)
      if (!review) return []
      const follow = followUps.find((row) => row.id === interview.businessFollowUpId)
      const job = cases.find((row) => row.reviewId === follow?.reviewId)
      const caseTitle = job?.fields.find((field) => field.key === 'title')?.value ?? job?.redactedSubject
      const inactive = isInactiveProgressStage(follow?.progress?.stage ?? '')
      // Only a follow-up's latest round is the one waiting to be booked; earlier rounds are its history.
      const latest =
        !follow ||
        !interviews.some(
          (other) => other.businessFollowUpId === follow.id && other.roundNumber > interview.roundNumber && other.id !== interview.id
        )
      // A decided round is history even when the follow-up waits for its next booking (重新开始跟进).
      const unscheduled = follow?.progress?.stage === 'coordinating' && latest && !interview.decision
      const blocked = follow
        ? followUpBlock(follow, {
            personStatus: personStatuses.get(follow.documentId),
            caseLifecycle: cases.find((row) => row.reviewId === follow.reviewId)?.lifecycle,
            hrRejected: hrRejected.has(`${follow.documentId}:${follow.reviewId}`)
          })
        : null
      // Waiting to be booked but it cannot be (case ended, person paused or in place): not one to book.
      if (unscheduled && blocked) return []
      // Ended or paused before it took place: the time is released, so it is not drawn as booked.
      const released = inactive && !interview.decision
      // Held and waiting for the client's feedback, as 跟进 and 今天 read it from the time: a result is due, not a start.
      const awaitingFeedback = Boolean(follow && latest && !interview.decision && businessProgressStep(follow).stage === 'feedback')
      const status = inactive ? 'finished' : unscheduled ? 'unbooked' : awaitingFeedback ? 'decision' : statusFor(interview)
      return [
        {
          id: interview.id,
          interview,
          review,
          kind: interview.kind,
          status,
          scheduledAt: unscheduled || released ? null : interview.scheduledAt,
          interviewer: interview.interviewer,
          label: [caseTitle, interviewLabel(interview, zh)].filter(Boolean).join(' · '),
          route: routeFor(review, interview, interview.kind),
          // The same rule 跟进 and 招聘面试 refuse a time by: same person or same interviewer, booked times only.
          conflict:
            !inactive &&
            !unscheduled &&
            !interview.decision &&
            Boolean(interview.scheduledAt && scheduleClash({ ...interview, scheduledAt: interview.scheduledAt }, interviews, followUps))
        }
      ]
    })
    // A reviewed resume without a recruiting session is still actionable. It
    // is represented as a virtual row only; the interview record is created
    // by the existing schedule-save use case after HR chooses a time.
    const withoutRecruitingSession = reviews.flatMap((review): ScheduleRow[] => {
      // The same people the 招聘面试 queue lists: in the library, waiting for a recruiting interview, not already
      // followed on a case, in place or not being offered. A résumé kept only for a case assessment is not one.
      if (
        latestInterview(interviews, review.documentId, 'recruiting') ||
        !needsRecruitingWork(review, null) ||
        followUps.some((row) => row.documentId === review.documentId) ||
        ['assigned', 'paused'].includes(personStatuses.get(review.documentId) ?? '')
      )
        return []
      return [
        {
          id: `unbooked:${review.documentId}`,
          interview: null,
          review,
          kind: 'recruiting',
          status: 'unbooked',
          scheduledAt: null,
          interviewer: null,
          label: t('招聘初面', '採用一次面談'),
          route: routeFor(review, null, 'recruiting'),
          conflict: false
        }
      ]
    })
    // A follow-up waiting for its first or next interview has no round yet: it is still one to book.
    const awaitingRound = followUps.flatMap((follow): ScheduleRow[] => {
      const stage = follow.progress?.stage
      const review = reviewByDocumentId.get(follow.documentId)
      const rounds = interviews.filter((item) => item.businessFollowUpId === follow.id)
      // Waiting for its first round, or (after 重新开始跟进) for one after rounds that are all decided.
      const waiting = stage === 'next-round' || (stage === 'coordinating' && rounds.every((round) => round.decision))
      const job = cases.find((row) => row.reviewId === follow.reviewId)
      // A follow-up that cannot move now (ended case, 暂停营业, in place elsewhere) books nothing, as on 今天 and the menu bar.
      if (
        !review ||
        !waiting ||
        followUpBlock(follow, {
          personStatus: personStatuses.get(follow.documentId),
          caseLifecycle: job?.lifecycle,
          hrRejected: hrRejected.has(`${follow.documentId}:${follow.reviewId}`)
        })
      )
        return []
      const caseTitle = job?.fields.find((field) => field.key === 'title')?.value ?? job?.redactedSubject
      return [
        {
          id: `follow-up:${follow.id}`,
          interview: null,
          review,
          kind: 'client',
          status: 'unbooked',
          scheduledAt: null,
          interviewer: null,
          label: [caseTitle, t('待约客户面试', '顧客面談の調整待ち')].filter(Boolean).join(' · '),
          route: {
            businessFollowUpId: follow.id,
            sourceDocumentId: follow.documentId,
            interviewId: null,
            kind: 'client',
            view: 'schedule'
          },
          conflict: false
        }
      ]
    })
    const actionPriority: Record<ScheduleStatus, number> = { unbooked: 0, decision: 1, preparing: 2, ready: 3, finished: 4 }
    return [...liveRows, ...awaitingRound, ...withoutRecruitingSession].toSorted(
      (left, right) =>
        actionPriority[left.status] - actionPriority[right.status] ||
        (left.scheduledAt ?? '9999').localeCompare(right.scheduledAt ?? '9999') ||
        left.label.localeCompare(right.label, locale)
    )
  }, [interviews, locale, reviewByDocumentId, reviews, zh, cases, followUps, personStatuses, hrRejected])
  const interviewers = useMemo(
    () => [...new Set(rows.map((row) => row.interviewer).filter((value): value is string => Boolean(value)))].toSorted(),
    [rows]
  )
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
  const weekRows = useMemo(
    () => filteredRows.filter((row) => row.scheduledAt && weekDays.includes(tokyoDateKey(row.scheduledAt))),
    [filteredRows, weekDays]
  )
  const calendarHours = useMemo(() => {
    const scheduled = weekRows.filter((row): row is ScheduleRow & { scheduledAt: string; interview: CandidateInterviewSnapshot } =>
      Boolean(row.scheduledAt && row.interview)
    )
    const earliest = scheduled.length ? Math.min(...scheduled.map((row) => Math.floor(tokyoClockMinutes(row.scheduledAt) / 60))) : 8
    const latest = scheduled.length
      ? Math.max(...scheduled.map((row) => Math.ceil((tokyoClockMinutes(row.scheduledAt) + row.interview.durationMinutes) / 60)))
      : 20
    const start = Math.max(0, Math.min(8, earliest))
    const end = Math.min(24, Math.max(20, latest))
    return Array.from({ length: Math.max(1, end - start) }, (_, index) => start + index)
  }, [weekRows])
  const unbookedCount = rows.filter((row) => row.status === 'unbooked').length
  const conflictCount = rows.filter((row) => row.conflict).length
  const statusOptions: ScheduleStatus[] = ['unbooked', 'preparing', 'ready', 'decision', 'finished']

  return (
    <main className="interview-schedule-center" aria-label={t('面试日程中心', '面談日程センター')}>
      <header className="candidate-queue-header interview-schedule-header">
        <div>
          <h1>{t('面试日程', '面談日程')}</h1>
          <p>
            {t(
              '先按时间总览所有招聘与客户面试；点击任一日程后，再进入该人员的准确轮次处理。',
              '採用・顧客面談を時間軸で一覧し、日程を選んでから対象要員の該当回次を処理します。'
            )}
          </p>
        </div>
        <div className="interview-schedule-header-actions">
          <span>
            <strong>{unbookedCount}</strong>
            {t(' 待预约', ' 予約待ち')}
          </span>
          <span className={conflictCount ? 'has-alert' : ''}>
            <strong>{conflictCount}</strong>
            {t(' 时间冲突', ' 時間重複')}
          </span>
        </div>
      </header>

      <section className="interview-schedule-panel">
        <div className="interview-schedule-toolbar">
          <nav aria-label={t('日程视图', '日程表示')} className="interview-schedule-tabs">
            <button
              aria-selected={tab === 'calendar'}
              className={tab === 'calendar' ? 'is-active' : ''}
              onClick={() => setTab('calendar')}
              role="tab"
              type="button"
            >
              <Icon name="clock" size={15} />
              {t('日历', 'カレンダー')}
            </button>
            <button
              aria-selected={tab === 'list'}
              className={tab === 'list' ? 'is-active' : ''}
              onClick={() => setTab('list')}
              role="tab"
              type="button"
            >
              <Icon name="tasks" size={15} />
              {t('全部面试', 'すべての面談')}
            </button>
          </nav>
          <div className="interview-schedule-filters">
            <label>
              <span>{t('类型', '種別')}</span>
              <select
                aria-label={t('面试类型', '面談種別')}
                onChange={(event) => setKindFilter(event.target.value as ScheduleKindFilter)}
                value={kindFilter}
              >
                <option value="all">{t('全部', 'すべて')}</option>
                <option value="recruiting">{t('招聘面试', '採用面談')}</option>
                <option value="client">{t('客户面试', '顧客面談')}</option>
              </select>
            </label>
            <label>
              <span>{t('状态', '状態')}</span>
              <select
                aria-label={t('面试状态', '面談状態')}
                onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                value={statusFilter}
              >
                <option value="all">{t('全部状态', 'すべての状態')}</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status, zh)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('负责人', '担当者')}</span>
              <select
                aria-label={t('面试负责人', '面談担当者')}
                onChange={(event) => setInterviewerFilter(event.target.value)}
                value={interviewerFilter}
              >
                <option value="all">{t('全部负责人', 'すべての担当者')}</option>
                {interviewers.map((interviewer) => (
                  <option key={interviewer} value={interviewer}>
                    {interviewer}
                  </option>
                ))}
              </select>
            </label>
            <label className="candidate-queue-search">
              <Icon name="search" size={15} />
              <input
                aria-label={t('搜索面试', '面談を検索')}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('人员、职位、负责人', '要員・職種・担当者')}
                value={query}
              />
            </label>
          </div>
        </div>

        {tab === 'calendar' ? (
          <section aria-label={t('周日历', '週カレンダー')} className="interview-week-calendar">
            <header className="interview-week-controls">
              <div>
                <button aria-label={t('上一周', '前の週')} onClick={() => setWeekStart((current) => addDays(current, -7))} type="button">
                  ‹
                </button>
                <strong>
                  {formatTokyoDate(weekDays[0]!, locale, false)} – {formatTokyoDate(weekDays.at(-1)!, locale, false)}
                </strong>
                <button aria-label={t('下一周', '次の週')} onClick={() => setWeekStart((current) => addDays(current, 7))} type="button">
                  ›
                </button>
              </div>
              <button className="is-today" onClick={() => setWeekStart(mondayFor(tokyoDateKey(new Date())))} type="button">
                {t('今天', '今日')}
              </button>
            </header>
            <div className="interview-week-grid">
              <aside
                className="interview-week-time-axis"
                aria-hidden="true"
                style={{ gridTemplateRows: `50px repeat(${calendarHours.length}, 46px)` }}
              >
                <span />
                {calendarHours.map((hour) => (
                  <span key={hour}>{String(hour).padStart(2, '0')}:00</span>
                ))}
              </aside>
              {weekDays.map((dayKey) => {
                const dayRows = weekRows.filter((row) => row.scheduledAt && tokyoDateKey(row.scheduledAt) === dayKey)
                const laneEnds: number[] = []
                const positionedRows = dayRows
                  .toSorted((left, right) => left.scheduledAt!.localeCompare(right.scheduledAt!))
                  .map((row) => {
                    const start = new Date(row.scheduledAt!).getTime()
                    const lane = laneEnds.findIndex((end) => end <= start)
                    const resolvedLane = lane >= 0 ? lane : laneEnds.length
                    laneEnds[resolvedLane] = start + row.interview!.durationMinutes * 60_000
                    return { row, lane: resolvedLane }
                  })
                const laneCount = Math.max(1, laneEnds.length)
                const calendarStartMinutes = calendarHours[0]! * 60
                const calendarHeight = calendarHours.length * 46
                return (
                  <section className="interview-week-day" key={dayKey}>
                    <header className={dayKey === tokyoDateKey(new Date()) ? 'is-today' : ''}>
                      <strong>{formatTokyoDate(dayKey, locale)}</strong>
                      <small>{dayRows.length ? t(`${dayRows.length} 场`, `${dayRows.length}件`) : '—'}</small>
                    </header>
                    <div className="interview-week-day-slots" style={{ gridTemplateRows: `repeat(${calendarHours.length}, 46px)` }}>
                      {calendarHours.map((hour) => (
                        <span key={hour} />
                      ))}
                      {positionedRows.map(({ row, lane }) => {
                        const top = Math.max(0, ((tokyoClockMinutes(row.scheduledAt!) - calendarStartMinutes) / 60) * 46)
                        const availableHeight = Math.max(30, calendarHeight - top - 4)
                        const height = Math.min(availableHeight, Math.max(36, (row.interview!.durationMinutes / 60) * 46 - 4))
                        return (
                          <button
                            aria-label={`${candidateName(row.review)} ${row.label}`}
                            className={`interview-calendar-event is-${row.kind}${row.conflict ? ' has-conflict' : ''}`}
                            key={row.id}
                            onClick={() => onOpenInterview(row.route)}
                            style={{
                              top: `${top}px`,
                              height: `${height}px`,
                              left: `calc(${(lane / laneCount) * 100}% + 4px)`,
                              width: `calc(${100 / laneCount}% - 8px)`
                            }}
                            type="button"
                          >
                            <span>{formatTokyoTime(row.scheduledAt!, locale)}</span>
                            <strong>{candidateName(row.review)}</strong>
                            <small>
                              {row.label} · {meetingLabel(row.interview!, zh)}
                            </small>
                            {row.conflict ? <em>{t('时间冲突', '時間重複')}</em> : null}
                          </button>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
            {weekRows.length === 0 ? (
              <div className="interview-schedule-empty">
                <Icon name="clock" size={24} />
                <strong>{t('本周没有符合条件的已预约面试', 'この週に該当する予約済み面談はありません')}</strong>
                <span>
                  {unbookedCount
                    ? t(
                        `${unbookedCount} 位人员仍待预约，可切换到“全部面试”处理。`,
                        `${unbookedCount}名が予約待ちです。「すべての面談」で対応できます。`
                      )
                    : t('可以切换周次或调整筛选条件。', '週を切り替えるか、絞り込み条件を変更してください。')}
                </span>
              </div>
            ) : null}
          </section>
        ) : (
          <section aria-label={t('全部面试列表', 'すべての面談一覧')} className="interview-schedule-list">
            <header>
              <strong>{t(`全部面试（${filteredRows.length}）`, `すべての面談（${filteredRows.length}）`)}</strong>
              <span>
                {t('待预约优先显示，已结束默认保留为可查询记录。', '予約待ちを優先表示し、完了済みも検索できる記録として残します。')}
              </span>
            </header>
            <div className="candidate-queue-table-wrap">
              <table className="candidate-queue-table interview-schedule-table">
                <thead>
                  <tr>
                    <th>{t('时间/状态', '日時・状態')}</th>
                    <th>{t('人员', '要員')}</th>
                    <th>{t('面试', '面談')}</th>
                    <th>{t('方式', '方法')}</th>
                    <th>{t('负责人', '担当者')}</th>
                    <th>{t('下一步', '次の行動')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id} className={row.conflict ? 'has-conflict' : ''}>
                      <td>
                        <strong>
                          {row.scheduledAt
                            ? `${formatTokyoDate(tokyoDateKey(row.scheduledAt), locale, false)} ${formatTokyoTime(row.scheduledAt, locale)}`
                            : statusLabel(row.status, zh)}
                        </strong>
                        <small>{row.conflict ? t('同一负责人时间冲突', '同じ担当者の時間重複') : statusLabel(row.status, zh)}</small>
                      </td>
                      <td>
                        <button className="candidate-queue-person" onClick={() => onOpenInterview(row.route)} type="button">
                          <span>{candidateName(row.review).slice(-1)}</span>
                          <span>
                            <strong>{candidateName(row.review)}</strong>
                            <small>{fieldValue(row.review, 'role') ?? t('职位待确认', '職種未確認')}</small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <span className={`interview-schedule-kind is-${row.kind}`}>{row.label}</span>
                      </td>
                      <td>
                        <strong>{row.interview ? meetingLabel(row.interview, zh) : '—'}</strong>
                        <small>{row.interview?.contactNote ?? t('尚未填写安排说明', '調整メモ未入力')}</small>
                      </td>
                      <td>
                        <strong>{row.interviewer ?? t('待安排', '未設定')}</strong>
                        <small>
                          {row.interview?.roundNumber ? t(`第 ${row.interview.roundNumber} 轮`, `${row.interview.roundNumber}回目`) : '—'}
                        </small>
                      </td>
                      <td>
                        <button className="candidate-queue-action is-primary" onClick={() => onOpenInterview(row.route)} type="button">
                          {nextActionLabel(row, zh)}
                          <Icon name="chevron-right" size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredRows.length === 0 ? (
              <div className="interview-schedule-empty">
                <Icon name="search" size={24} />
                <strong>{t('没有符合条件的面试', '条件に合う面談はありません')}</strong>
                <span>{t('请调整筛选或搜索条件。', '絞り込みまたは検索条件を変更してください。')}</span>
              </div>
            ) : null}
          </section>
        )}
      </section>
    </main>
  )
}
