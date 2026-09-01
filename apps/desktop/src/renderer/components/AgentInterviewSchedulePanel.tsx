import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type {
  AgentSystemAccessBlock,
  CandidateInterviewSnapshot,
  CandidateReviewSnapshot,
  SaveCandidateInterviewScheduleInput
} from '@shared'
import { useUiLocale } from '../i18n'
import { Icon } from './Icon'

type InterviewScheduleAccess = Extract<AgentSystemAccessBlock, { destination: 'interview-schedule' }>

interface AgentInterviewSchedulePanelProps {
  access: InterviewScheduleAccess
  interviews: CandidateInterviewSnapshot[]
  reviews: CandidateReviewSnapshot[]
  /** Present when a previous screen exists to step back to. */
  onBack?(): void
  onClose(): void
  onSave(input: SaveCandidateInterviewScheduleInput): Promise<CandidateInterviewSnapshot>
}

type DateParts = { year: number; month: number; day: number }

const tokyoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
})

function dateParts(value: Date): DateParts {
  const values = Object.fromEntries(tokyoDateFormatter.formatToParts(value)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value])) as Record<string, string>
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) }
}

function dateKey(parts: DateParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function dateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!))
}

function keyFromUtcDate(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
}

function tokyoDateKey(value: string): string {
  return dateKey(dateParts(new Date(value)))
}

function mondayFor(key: string): string {
  const date = dateFromKey(key)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return keyFromUtcDate(date)
}

function addDays(key: string, offset: number): string {
  const date = dateFromKey(key)
  date.setUTCDate(date.getUTCDate() + offset)
  return keyFromUtcDate(date)
}

function tokyoClockMinutes(value: string): number {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date(value)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])) as Record<string, string>
  return (Number(values.hour) % 24) * 60 + Number(values.minute)
}

function formatTokyoDateTime(value: string, locale: 'ja-JP' | 'zh-CN'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(value))
}

function localDateTimeInput(value: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date(value)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])) as Record<string, string>
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

function candidateName(review: CandidateReviewSnapshot | undefined, fallback: string): string {
  return review?.localIdentity?.displayName
    ?? review?.fileName.replace(/\.(pdf|docx|xlsx|xls|xlsb)$/iu, '')
    ?? fallback
}

function methodLabel(method: CandidateInterviewSnapshot['meetingMethod'], zh: boolean): string {
  if (method === 'zoom') return 'Zoom'
  if (method === 'google-meet') return 'Google Meet'
  return method === 'phone' ? (zh ? '电话' : '電話') : (zh ? '现场' : '対面')
}

function findFocusedInterview(access: InterviewScheduleAccess, interviews: CandidateInterviewSnapshot[]): CandidateInterviewSnapshot | null {
  const receipt = access.receipt
  if (!receipt) {
    return interviews.filter((item) => item.scheduledAt).toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  }
  return interviews.find((item) =>
    item.sourceDocumentId === receipt.sourceDocumentId &&
    item.kind === receipt.kind &&
    item.scheduledAt === receipt.scheduledAt &&
    item.durationMinutes === receipt.durationMinutes &&
    item.meetingMethod === receipt.meetingMethod
  ) ?? interviews.filter((item) =>
    item.sourceDocumentId === receipt.sourceDocumentId && item.kind === receipt.kind && item.scheduledAt
  ).toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
}

export function AgentInterviewSchedulePanel({
  access,
  interviews,
  reviews,
  onBack,
  onClose,
  onSave
}: AgentInterviewSchedulePanelProps) {
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const focusedInterview = useMemo(() => findFocusedInterview(access, interviews), [access, interviews])
  const initialDateKey = focusedInterview?.scheduledAt
    ? tokyoDateKey(focusedInterview.scheduledAt)
    : access.receipt?.scheduledAt ? tokyoDateKey(access.receipt.scheduledAt) : dateKey(dateParts(new Date()))
  const [weekStart, setWeekStart] = useState(() => mondayFor(initialDateKey))
  const [selectedInterviewId, setSelectedInterviewId] = useState<string | null>(focusedInterview?.id ?? null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [dateTime, setDateTime] = useState(focusedInterview?.scheduledAt ? localDateTimeInput(focusedInterview.scheduledAt) : '')
  const [duration, setDuration] = useState(focusedInterview?.durationMinutes ?? access.receipt?.durationMinutes ?? 60)
  const [interviewer, setInterviewer] = useState(focusedInterview?.interviewer ?? '')
  const [note, setNote] = useState(focusedInterview?.contactNote ?? '')

  const selectedInterview = interviews.find((item) => item.id === selectedInterviewId) ?? focusedInterview
  const reviewByDocumentId = useMemo(() => new Map(reviews.map((review) => [review.documentId, review])), [reviews])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])
  const weekInterviews = useMemo(() => interviews.filter((item) => item.scheduledAt && weekDays.includes(tokyoDateKey(item.scheduledAt))), [interviews, weekDays])
  const hours = useMemo(() => {
    const scheduled = weekInterviews.filter((item): item is CandidateInterviewSnapshot & { scheduledAt: string } => Boolean(item.scheduledAt))
    if (scheduled.length === 0) return Array.from({ length: 7 }, (_, index) => index + 9)
    const earliest = Math.min(...scheduled.map((item) => Math.floor(tokyoClockMinutes(item.scheduledAt) / 60)))
    const latest = Math.max(...scheduled.map((item) => Math.ceil((tokyoClockMinutes(item.scheduledAt) + item.durationMinutes) / 60)))
    const start = Math.max(0, earliest - 2)
    const end = Math.min(24, Math.max(start + 6, latest + 2))
    return Array.from({ length: end - start }, (_, index) => start + index)
  }, [weekInterviews])

  useEffect(() => {
    if (!focusedInterview) return
    setSelectedInterviewId(focusedInterview.id)
    setWeekStart(mondayFor(tokyoDateKey(focusedInterview.scheduledAt ?? focusedInterview.updatedAt)))
  }, [focusedInterview?.id])

  useEffect(() => {
    if (!selectedInterview?.scheduledAt) return
    setDateTime(localDateTimeInput(selectedInterview.scheduledAt))
    setDuration(selectedInterview.durationMinutes)
    setInterviewer(selectedInterview.interviewer ?? '')
    setNote(selectedInterview.contactNote ?? '')
    setEditing(false)
    setError(null)
    setSaved(false)
  }, [selectedInterview?.id, selectedInterview?.updatedAt])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedInterview || !dateTime || !interviewer.trim()) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const next = await onSave({
        interviewId: selectedInterview.id,
        sourceDocumentId: selectedInterview.sourceDocumentId,
        kind: selectedInterview.kind,
        roundNumber: selectedInterview.roundNumber,
        ...(selectedInterview.parentInterviewId ? { parentInterviewId: selectedInterview.parentInterviewId } : {}),
        scheduledAt: new Date(`${dateTime}:00+09:00`).toISOString(),
        durationMinutes: Number(duration),
        meetingMethod: selectedInterview.meetingMethod,
        ...(selectedInterview.meetingUrl ? { meetingUrl: selectedInterview.meetingUrl } : {}),
        ...(selectedInterview.meetingDetails ? { meetingDetails: selectedInterview.meetingDetails } : {}),
        interviewer: interviewer.trim(),
        ...(note.trim() ? { contactNote: note.trim() } : {})
      })
      setSelectedInterviewId(next.id)
      setEditing(false)
      setSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (zh ? '无法保存面试日程。' : '面談日程を保存できませんでした。'))
    } finally {
      setSaving(false)
    }
  }

  const selectedReview = selectedInterview ? reviewByDocumentId.get(selectedInterview.sourceDocumentId) : undefined
  const fallbackLabel = access.receipt?.candidateLabel ?? (zh ? '候选人' : '候補者')
  const selectedName = candidateName(selectedReview, fallbackLabel)

  return <section aria-label={zh ? '面试日程工作区' : '面談日程ワークスペース'} className="agent-interview-panel">
    <header className="agent-context-panel-header">
      <div>{onBack ? <button aria-label={zh ? '返回上一级' : '前の画面に戻る'} className="agent-context-panel-back" onClick={onBack} type="button">←<span>{zh ? '返回' : '戻る'}</span></button> : null}<Icon name="clock" size={19} /><strong>{zh ? '面试日程' : '面談日程'}</strong><span className="agent-context-connected"><Icon name="sparkles" size={11} />{zh ? '已接入对话上下文' : '会話コンテキストに接続'}</span></div>
      <button aria-label={zh ? '关闭右侧工作区' : '右ワークスペースを閉じる'} className="agent-context-panel-close" onClick={onClose} type="button">×</button>
    </header>
    <div className="agent-business-context-note"><Icon name="shield" size={13} /><span>{zh ? '下一条消息会读取此日程的最新本机记录；会议链接和本机标识符不会发送给 AI。' : '次のメッセージではこの日程の最新ローカル記録を読み取ります。会議リンクと端末内IDはAIへ送信しません。'}</span></div>

    <div className="agent-panel-week-controls">
      <button aria-label={zh ? '上一周' : '前の週'} onClick={() => setWeekStart((current) => addDays(current, -7))} type="button">‹</button>
      <strong>{dateFromKey(weekStart).getUTCFullYear()} {zh ? '年' : '年'} {dateFromKey(weekStart).getUTCMonth() + 1} {zh ? '月' : '月'}</strong>
      <button aria-label={zh ? '下一周' : '次の週'} onClick={() => setWeekStart((current) => addDays(current, 7))} type="button">›</button>
    </div>
    <div className="agent-panel-weekdays" aria-hidden="true"><span />{weekDays.map((key) => <span className={key === initialDateKey ? 'is-selected' : ''} key={key}><strong>{dateFromKey(key).getUTCDate()}</strong><small>{new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'narrow' }).format(dateFromKey(key))}</small></span>)}</div>
    <div aria-label={zh ? '周日历' : '週カレンダー'} className="agent-panel-calendar">
      <aside aria-hidden="true" style={{ gridTemplateRows: `repeat(${hours.length}, 38px)` }}>{hours.map((hour) => <span key={hour}>{String(hour).padStart(2, '0')}:00</span>)}</aside>
      {weekDays.map((key) => <div className="agent-panel-calendar-day" key={key}>
        {hours.map((hour) => <span aria-hidden="true" key={hour} />)}
        {weekInterviews.filter((item) => item.scheduledAt && tokyoDateKey(item.scheduledAt) === key).map((item) => {
          const minutes = tokyoClockMinutes(item.scheduledAt!)
          const top = Math.max(0, (minutes - hours[0]! * 60) / 60 * 38)
          const height = Math.max(28, Math.min(item.durationMinutes / 60 * 38, hours.length * 38 - top))
          const review = reviewByDocumentId.get(item.sourceDocumentId)
          return <button
            aria-label={`${candidateName(review, fallbackLabel)} ${formatTokyoDateTime(item.scheduledAt!, locale)}`}
            className={item.id === selectedInterview?.id ? 'agent-panel-calendar-event is-selected' : 'agent-panel-calendar-event'}
            key={item.id}
            onClick={() => setSelectedInterviewId(item.id)}
            style={{ height: `${height}px`, top: `${top}px` }}
            type="button"
          ><strong>{candidateName(review, fallbackLabel)}</strong><small>{methodLabel(item.meetingMethod, zh)}</small></button>
        })}
      </div>)}
    </div>

    <div className="agent-panel-detail-scroll">
      {selectedInterview?.scheduledAt ? <article className="agent-panel-interview-detail">
        <header><div><strong>{selectedName} {zh ? '面试' : '面談'}</strong><small>{selectedInterview.kind === 'client' ? (zh ? '客户面试' : '顧客面談') : (zh ? '招聘面试' : '採用面談')}</small></div><span>{zh ? '已登记' : '登録済み'}</span></header>
        {editing ? <form className="agent-panel-interview-form" onSubmit={submit}>
          <label><span>{zh ? '面试时间' : '面談日時'}</span><input onChange={(event) => setDateTime(event.target.value)} required type="datetime-local" value={dateTime} /></label>
          <label><span>{zh ? '时长（分钟）' : '時間（分）'}</span><input max={480} min={5} onChange={(event) => setDuration(Number(event.target.value))} required type="number" value={duration} /></label>
          <label className="is-wide"><span>{zh ? '负责人' : '担当者'}</span><input onChange={(event) => setInterviewer(event.target.value)} required value={interviewer} /></label>
          <label className="is-wide"><span>{zh ? '备注' : 'メモ'}</span><textarea onChange={(event) => setNote(event.target.value)} rows={2} value={note} /></label>
          <small className="agent-panel-local-note"><Icon name="lock" size={12} />{zh ? `${methodLabel(selectedInterview.meetingMethod, zh)} 链接继续保存在本机，不发送给 AI。` : `${methodLabel(selectedInterview.meetingMethod, zh)}リンクは端末内に保持され、AIには送信されません。`}</small>
          {error ? <p role="alert"><Icon name="alert" size={13} />{error}</p> : null}
          <footer><button disabled={saving} onClick={() => setEditing(false)} type="button">{zh ? '取消' : '取消'}</button><button className="is-primary" disabled={saving || !dateTime || !interviewer.trim()} type="submit">{saving ? (zh ? '正在保存…' : '保存中…') : (zh ? '保存修改' : '変更を保存')}</button></footer>
        </form> : <>
          <dl>
            <div><dt><Icon name="clock" size={14} />{zh ? '时间' : '日時'}</dt><dd>{formatTokyoDateTime(selectedInterview.scheduledAt, locale)} JST</dd></div>
            <div><dt><Icon name="clock" size={14} />{zh ? '时长' : '時間'}</dt><dd>{selectedInterview.durationMinutes} {zh ? '分钟' : '分'} · {methodLabel(selectedInterview.meetingMethod, zh)}</dd></div>
            <div><dt><Icon name="users" size={14} />{zh ? '负责人' : '担当者'}</dt><dd>{selectedInterview.interviewer ?? '—'}</dd></div>
            <div><dt><Icon name="lock" size={14} />{zh ? '会议链接' : '会議リンク'}</dt><dd>{selectedInterview.meetingUrl ? (zh ? '已在本机保存' : '端末内に保存済み') : '—'}</dd></div>
          </dl>
          {selectedInterview.contactNote ? <p className="agent-panel-interview-note">{selectedInterview.contactNote}</p> : null}
          {saved ? <p className="agent-panel-save-success"><Icon name="check" size={13} />{zh ? '面试日程已更新' : '面談日程を更新しました'}</p> : null}
          <button className="agent-panel-edit-button" disabled={!['scheduled', 'prepared'].includes(selectedInterview.stage)} onClick={() => setEditing(true)} type="button">{zh ? '修改面试' : '面談を変更'}</button>
        </>}
      </article> : <div className="agent-panel-empty"><Icon name="clock" size={24} /><strong>{zh ? '没有找到对应的面试记录' : '対象の面談記録が見つかりません'}</strong><p>{zh ? '当前右侧工作区中没有可显示的本机面试记录。' : '現在の右ワークスペースに表示できるローカル面談記録がありません。'}</p></div>}
    </div>
  </section>
}
