import { tokyoDateKey, dateFromKey, mondayFor, addDays, tokyoClockMinutes } from '../tokyo-calendar'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type {
  AgentSystemAccessBlock,
  CandidateInterviewSnapshot,
  CandidateReviewSnapshot,
  SaveCandidateInterviewScheduleInput
} from '@shared'
import { scheduleConflictMessage } from '@shared'
import { localeText, localizedIpcError, useUiLocale } from '../i18n'
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
  /** A client interview booked on a case's 跟进 is changed there (rebooking keeps its history and conflict checks). */
  onOpenFollowUp?(followUpId: string): void
  /** Calls off a booked recruiting interview (back to being arranged, no time held). */
  onCancel?(input: { interviewId: string; sourceDocumentId: string }): Promise<CandidateInterviewSnapshot>
}

function formatTokyoDateTime(value: string, locale: 'ja-JP' | 'zh-CN'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value))
}

function localDateTimeInput(value: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
      .formatToParts(new Date(value))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  ) as Record<string, string>
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

function candidateName(review: CandidateReviewSnapshot | undefined, fallback: string): string {
  return review?.localIdentity?.displayName ?? review?.fileName.replace(/\.(pdf|docx|xlsx|xls|xlsb)$/iu, '') ?? fallback
}

function methodLabel(method: CandidateInterviewSnapshot['meetingMethod'], zh: boolean): string {
  const t = localeText(zh)

  if (method === 'zoom') return 'Zoom'
  if (method === 'google-meet') return 'Google Meet'
  return method === 'phone' ? t('电话', '電話') : t('现场', '対面')
}

function findFocusedInterview(
  access: InterviewScheduleAccess,
  interviews: CandidateInterviewSnapshot[]
): CandidateInterviewSnapshot | null {
  const receipt = access.receipt
  if (!receipt) {
    return interviews.filter((item) => item.scheduledAt).toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  }
  return (
    interviews.find(
      (item) =>
        item.sourceDocumentId === receipt.sourceDocumentId &&
        item.kind === receipt.kind &&
        item.scheduledAt === receipt.scheduledAt &&
        item.durationMinutes === receipt.durationMinutes &&
        item.meetingMethod === receipt.meetingMethod
    ) ??
    interviews
      .filter((item) => item.sourceDocumentId === receipt.sourceDocumentId && item.kind === receipt.kind && item.scheduledAt)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ??
    null
  )
}

export function AgentInterviewSchedulePanel({
  access,
  interviews,
  reviews,
  onBack,
  onClose,
  onSave,
  onOpenFollowUp,
  onCancel
}: AgentInterviewSchedulePanelProps) {
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const t = localeText(zh)
  const focusedInterview = useMemo(() => findFocusedInterview(access, interviews), [access, interviews])
  const initialDateKey = focusedInterview?.scheduledAt
    ? tokyoDateKey(focusedInterview.scheduledAt)
    : access.receipt?.scheduledAt
      ? tokyoDateKey(access.receipt.scheduledAt)
      : tokyoDateKey(new Date())
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
  const weekInterviews = useMemo(
    () => interviews.filter((item) => item.scheduledAt && weekDays.includes(tokyoDateKey(item.scheduledAt))),
    [interviews, weekDays]
  )
  const hours = useMemo(() => {
    const scheduled = weekInterviews.filter((item): item is CandidateInterviewSnapshot & { scheduledAt: string } =>
      Boolean(item.scheduledAt)
    )
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

  // The edit refused for overlapping another interview; 「仍然保存」 shows only while the form still holds it.
  const editKey = JSON.stringify([selectedInterview?.id, dateTime, duration, interviewer.trim()])
  const [conflictedEdit, setConflictedEdit] = useState<string | null>(null)
  const submit = async (event: FormEvent | null, allowConflict = false) => {
    event?.preventDefault()
    if (!selectedInterview || !dateTime || !interviewer.trim()) return
    setSaving(true)
    setError(null)
    setSaved(false)
    setConflictedEdit(null)
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
        ...(note.trim() ? { contactNote: note.trim() } : {}),
        ...(allowConflict ? { allowConflict: true } : {})
      })
      setSelectedInterviewId(next.id)
      setEditing(false)
      setSaved(true)
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes(scheduleConflictMessage)) setConflictedEdit(editKey)
      setError(localizedIpcError(locale, cause, t('无法保存面试日程。', '面談日程を保存できませんでした。')))
    } finally {
      setSaving(false)
    }
  }

  // Booked and not started, or opened with nothing recorded yet (the candidate did not join): Main allows both.
  const changeable = Boolean(
    selectedInterview &&
    !selectedInterview.decision &&
    (['scheduled', 'prepared'].includes(selectedInterview.stage) ||
      (selectedInterview.stage === 'interviewing' && !selectedInterview.interviewNotes?.trim()))
  )
  const [cancelled, setCancelled] = useState<CandidateInterviewSnapshot | null>(null)
  const cancel = async () => {
    if (!selectedInterview || !onCancel) return
    if (
      !window.confirm(
        t('取消这次面试预约？时间会被释放，之后可以重新预约。', 'この面談の予約を取り消しますか？時間は解放され、後で予約し直せます。')
      )
    )
      return
    setSaving(true)
    setError(null)
    try {
      setCancelled(await onCancel({ interviewId: selectedInterview.id, sourceDocumentId: selectedInterview.sourceDocumentId }))
      setEditing(false)
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法取消预约。', '予約を取り消せませんでした。')))
    } finally {
      setSaving(false)
    }
  }
  const selectedReview = selectedInterview ? reviewByDocumentId.get(selectedInterview.sourceDocumentId) : undefined
  const fallbackLabel = access.receipt?.candidateLabel ?? t('人员', '要員')
  const selectedName = candidateName(selectedReview, fallbackLabel)

  return (
    <section aria-label={t('面试日程工作区', '面談日程ワークスペース')} className="agent-interview-panel">
      <header className="agent-context-panel-header">
        <div>
          {onBack ? (
            <button aria-label={t('返回上一级', '前の画面に戻る')} className="agent-context-panel-back" onClick={onBack} type="button">
              ←<span>{t('返回', '戻る')}</span>
            </button>
          ) : null}
          <Icon name="clock" size={19} />
          <strong>{t('面试日程', '面談日程')}</strong>
          <span className="agent-context-connected">
            <Icon name="sparkles" size={11} />
            {t('已接入对话上下文', '会話コンテキストに接続')}
          </span>
        </div>
        <button
          aria-label={t('关闭右侧工作区', '右ワークスペースを閉じる')}
          className="agent-context-panel-close"
          onClick={onClose}
          type="button"
        >
          ×
        </button>
      </header>
      <div className="agent-business-context-note">
        <Icon name="shield" size={13} />
        <span>
          {t(
            '下一条消息会读取此日程的最新本机记录；会议链接和本机标识符不会发送给 AI。',
            '次のメッセージではこの日程の最新ローカル記録を読み取ります。会議リンクと端末内IDはAIへ送信しません。'
          )}
        </span>
      </div>

      <div className="agent-panel-week-controls">
        <button aria-label={t('上一周', '前の週')} onClick={() => setWeekStart((current) => addDays(current, -7))} type="button">
          ‹
        </button>
        <strong>
          {dateFromKey(weekStart).getUTCFullYear()} {t('年', '年')} {dateFromKey(weekStart).getUTCMonth() + 1} {t('月', '月')}
        </strong>
        <button aria-label={t('下一周', '次の週')} onClick={() => setWeekStart((current) => addDays(current, 7))} type="button">
          ›
        </button>
      </div>
      <div className="agent-panel-weekdays" aria-hidden="true">
        <span />
        {weekDays.map((key) => (
          <span className={key === initialDateKey ? 'is-selected' : ''} key={key}>
            <strong>{dateFromKey(key).getUTCDate()}</strong>
            <small>{new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'narrow' }).format(dateFromKey(key))}</small>
          </span>
        ))}
      </div>
      <div aria-label={t('周日历', '週カレンダー')} className="agent-panel-calendar">
        <aside aria-hidden="true" style={{ gridTemplateRows: `repeat(${hours.length}, 38px)` }}>
          {hours.map((hour) => (
            <span key={hour}>{String(hour).padStart(2, '0')}:00</span>
          ))}
        </aside>
        {weekDays.map((key) => (
          <div className="agent-panel-calendar-day" key={key}>
            {hours.map((hour) => (
              <span aria-hidden="true" key={hour} />
            ))}
            {weekInterviews
              .filter((item) => item.scheduledAt && tokyoDateKey(item.scheduledAt) === key)
              .map((item) => {
                const minutes = tokyoClockMinutes(item.scheduledAt!)
                const top = Math.max(0, ((minutes - hours[0]! * 60) / 60) * 38)
                const height = Math.max(28, Math.min((item.durationMinutes / 60) * 38, hours.length * 38 - top))
                const review = reviewByDocumentId.get(item.sourceDocumentId)
                return (
                  <button
                    aria-label={`${candidateName(review, fallbackLabel)} ${formatTokyoDateTime(item.scheduledAt!, locale)}`}
                    className={item.id === selectedInterview?.id ? 'agent-panel-calendar-event is-selected' : 'agent-panel-calendar-event'}
                    key={item.id}
                    onClick={() => setSelectedInterviewId(item.id)}
                    style={{ height: `${height}px`, top: `${top}px` }}
                    type="button"
                  >
                    <strong>{candidateName(review, fallbackLabel)}</strong>
                    <small>{methodLabel(item.meetingMethod, zh)}</small>
                  </button>
                )
              })}
          </div>
        ))}
      </div>

      <div className="agent-panel-detail-scroll">
        {selectedInterview?.scheduledAt ? (
          <article className="agent-panel-interview-detail">
            <header>
              <div>
                <strong>
                  {selectedName} {t('面试', '面談')}
                </strong>
                <small>{selectedInterview.kind === 'client' ? t('客户面试', '顧客面談') : t('招聘面试', '採用面談')}</small>
              </div>
              <span>{t('已登记', '登録済み')}</span>
            </header>
            {editing ? (
              <form className="agent-panel-interview-form" onSubmit={(event) => void submit(event)}>
                <label>
                  <span>{t('面试时间', '面談日時')}</span>
                  <input onChange={(event) => setDateTime(event.target.value)} required type="datetime-local" value={dateTime} />
                </label>
                <label>
                  <span>{t('时长（分钟）', '時間（分）')}</span>
                  <input
                    max={480}
                    min={5}
                    onChange={(event) => setDuration(Number(event.target.value))}
                    required
                    type="number"
                    value={duration}
                  />
                </label>
                <label className="is-wide">
                  <span>{t('负责人', '担当者')}</span>
                  <input onChange={(event) => setInterviewer(event.target.value)} required value={interviewer} />
                </label>
                <label className="is-wide">
                  <span>{t('备注', 'メモ')}</span>
                  <textarea onChange={(event) => setNote(event.target.value)} rows={2} value={note} />
                </label>
                <small className="agent-panel-local-note">
                  <Icon name="lock" size={12} />
                  {t(
                    `${methodLabel(selectedInterview.meetingMethod, zh)} 链接继续保存在本机，不发送给 AI。`,
                    `${methodLabel(selectedInterview.meetingMethod, zh)}リンクは端末内に保持され、AIには送信されません。`
                  )}
                </small>
                {error ? (
                  <p role="alert">
                    <Icon name="alert" size={13} />
                    {error}
                  </p>
                ) : null}
                {conflictedEdit && conflictedEdit === editKey ? (
                  <button disabled={saving} onClick={() => void submit(null, true)} type="button">
                    {t('仍然保存', 'このまま保存')}
                  </button>
                ) : null}
                <footer>
                  <button disabled={saving} onClick={() => setEditing(false)} type="button">
                    {t('取消', '取消')}
                  </button>
                  <button className="is-primary" disabled={saving || !dateTime || !interviewer.trim()} type="submit">
                    {saving ? t('正在保存…', '保存中…') : t('保存修改', '変更を保存')}
                  </button>
                </footer>
              </form>
            ) : (
              <>
                <dl>
                  <div>
                    <dt>
                      <Icon name="clock" size={14} />
                      {t('时间', '日時')}
                    </dt>
                    <dd>{formatTokyoDateTime(selectedInterview.scheduledAt, locale)} JST</dd>
                  </div>
                  <div>
                    <dt>
                      <Icon name="clock" size={14} />
                      {t('时长', '時間')}
                    </dt>
                    <dd>
                      {selectedInterview.durationMinutes} {t('分钟', '分')} · {methodLabel(selectedInterview.meetingMethod, zh)}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <Icon name="users" size={14} />
                      {t('负责人', '担当者')}
                    </dt>
                    <dd>{selectedInterview.interviewer ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>
                      <Icon name="lock" size={14} />
                      {t('会议链接', '会議リンク')}
                    </dt>
                    <dd>{selectedInterview.meetingUrl ? t('已在本机保存', '端末内に保存済み') : '—'}</dd>
                  </div>
                </dl>
                {selectedInterview.contactNote ? <p className="agent-panel-interview-note">{selectedInterview.contactNote}</p> : null}
                {cancelled?.id === selectedInterview.id ? (
                  <p className="agent-panel-save-success">
                    <Icon name="check" size={13} />
                    {t('已取消预约，可在面试日程中重新预约', '予約を取り消しました。面談日程から再予約できます')}
                  </p>
                ) : null}
                {saved ? (
                  <p className="agent-panel-save-success">
                    <Icon name="check" size={13} />
                    {t('面试日程已更新', '面談日程を更新しました')}
                  </p>
                ) : null}
                {selectedInterview.businessFollowUpId ? (
                  <button
                    className="agent-panel-edit-button"
                    disabled={!onOpenFollowUp}
                    onClick={() => onOpenFollowUp?.(selectedInterview.businessFollowUpId!)}
                    type="button"
                  >
                    {t('在跟进中修改', '対応記録で変更')}
                  </button>
                ) : (
                  <>
                    <button className="agent-panel-edit-button" disabled={!changeable} onClick={() => setEditing(true)} type="button">
                      {t('修改面试', '面談を変更')}
                    </button>
                    {onCancel ? (
                      <button
                        className="agent-panel-edit-button"
                        disabled={!changeable || saving}
                        onClick={() => void cancel()}
                        type="button"
                      >
                        {t('取消预约', '予約を取り消す')}
                      </button>
                    ) : null}
                  </>
                )}
              </>
            )}
          </article>
        ) : (
          <div className="agent-panel-empty">
            <Icon name="clock" size={24} />
            <strong>{t('没有找到对应的面试记录', '対象の面談記録が見つかりません')}</strong>
            <p>{t('当前右侧工作区中没有可显示的本机面试记录。', '現在の右ワークスペースに表示できるローカル面談記録がありません。')}</p>
          </div>
        )}
      </div>
    </section>
  )
}
