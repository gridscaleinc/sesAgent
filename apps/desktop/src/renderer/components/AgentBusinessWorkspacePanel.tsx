import { BusinessField } from './BusinessField'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { CandidateProfileSummary } from './CandidateProfileSummary'
import { SpreadsheetPreview } from './OriginalDocumentWorkspace'
import type { WorkTask } from '@domain'
import type {
  AgentSystemAccessBlock,
  CandidateInterviewSnapshot,
  CandidateReviewSnapshot,
  CreateManualJobCaseDraftResult,
  JobCaseReviewSnapshot,
  JobCaseSourceText,
  MatchingHomeProjection,
  OriginalDocumentPreview,
  NewJobCaseDigest,
  SubmitJobCaseReviewInput,
  SubmitJobCaseReviewResult
} from '@shared'
import { useUiLocale } from '../i18n'
import { BroadcastWorkspaceView, type BroadcastPanelActions } from './BroadcastWorkspaceView'
import { NewCaseDigestCard } from './NewCaseDigestCard'
import { Icon, type IconName } from './Icon'
import { JobCaseBody } from './JobCaseBody'
import { CaseMatchingWorkspace } from './CaseMatchingWorkspace'
import type { ReviewQueueItem } from './ReviewCenter'

type BusinessAccess = Exclude<AgentSystemAccessBlock, { destination: 'interview-schedule' }>

interface AgentBusinessWorkspacePanelProps {
  renderBusinessProgress?(kind: 'person' | 'case', id: string): ReactNode
  matchingBusy?: boolean
  access: BusinessAccess
  focusRequest?: number
  candidateReviews: CandidateReviewSnapshot[]
  newCaseDigest?: NewJobCaseDigest | null
  gmailLastSyncedAt?: string | null
  onMarkSeen?(reviewId: string): void
  interviews: CandidateInterviewSnapshot[]
  jobCaseReviews: JobCaseReviewSnapshot[]
  matchingHome: MatchingHomeProjection
  reviewQueue: ReviewQueueItem[]
  tasks: WorkTask[]
  /** Present when a previous screen exists to step back to. */
  onBack?(): void
  onClose(): void
  onOpenAccess(access: AgentSystemAccessBlock): void
  onCreateManualCase(input: { subject: string; body: string }): Promise<CreateManualJobCaseDraftResult>
  onLoadJobCaseSourceText?(reviewId: string): Promise<JobCaseSourceText>
  onLoadOriginalDocument(sourceDocumentId: string): Promise<OriginalDocumentPreview>
  onResolveActionApproval(approvalId: string, decision: 'approve' | 'deny'): Promise<void>
  onSubmitJobCaseReview?(input: SubmitJobCaseReviewInput): Promise<SubmitJobCaseReviewResult>
  onEditCase?(reviewId: string): void
  /** Present once 案件配信 is reachable; the broadcast screen is withheld without it. */
  broadcastActions?: BroadcastPanelActions
}

function fieldValue(review: CandidateReviewSnapshot, key: string): string | null {
  return review.fields.find((field) => field.key === key)?.value ?? null
}

function caseField(review: JobCaseReviewSnapshot, key: string): string | null {
  return review.fields.find((field) => field.key === key)?.value ?? null
}

function candidateName(review: CandidateReviewSnapshot): string {
  return review.localIdentity?.displayName
    ?? review.fileName.replace(/\.(pdf|docx|xlsx|xls|xlsb)$/iu, '')
}

function formatDateTime(value: string | null, locale: 'ja-JP' | 'zh-CN'): string {
  if (!value) return locale === 'zh-CN' ? '时间未确定' : '日時未定'
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(value))
}

function accessPresentation(access: BusinessAccess, zh: boolean): { icon: IconName; title: string } {
  if (access.destination === 'new-cases') return { icon: 'briefcase', title: zh ? '今日新案件' : '今日の新着案件' }
  if (access.destination === 'job-cases') return { icon: 'briefcase', title: zh ? '案件' : '案件' }
  if (access.destination === 'case-import') return { icon: 'upload', title: zh ? '导入案件' : '案件を取り込む' }
  if (access.destination === 'case-review') return { icon: 'briefcase', title: zh ? '案件详情' : '案件詳細' }
  if (access.destination === 'matching') return { icon: 'sparkles', title: zh ? '完整匹配' : '詳細マッチング' }
  if (access.destination === 'broadcast') return { icon: 'mail', title: zh ? '案件配信' : '案件配信' }
  if (access.destination === 'candidate-management') return { icon: 'users', title: zh ? '候选人' : '候補者' }
  if (access.destination === 'candidate') return { icon: 'users', title: zh ? '候选人档案' : '候補者プロフィール' }
  if (access.destination === 'original-document') return { icon: 'file', title: zh ? '原始简历' : '原始履歴書' }
  if (access.destination === 'review-center' && access.reviewIds && access.reviewIds.length > 0) {
    return { icon: 'shield', title: zh ? '审核中心 · 本次导入' : 'レビューセンター · 今回の取込' }
  }
  if (access.destination === 'review-center') return { icon: 'shield', title: zh ? '待处理事项' : '対応が必要な項目' }
  return { icon: 'tasks', title: zh ? '任务详情' : 'タスク詳細' }
}

function ContextSection({ children, title }: { children: ReactNode; title: string }) {
  return <section className="agent-business-section"><h3>{title}</h3>{children}</section>
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="agent-business-empty"><Icon name="search" size={20} /><span>{children}</span></div>
}

function JobCasesView({ reviews, onOpen, zh }: {
  reviews: JobCaseReviewSnapshot[]
  onOpen(access: AgentSystemAccessBlock): void
  zh: boolean
}) {
  const active = reviews.filter((review) => review.lifecycle === 'active')
  return <>
    <div className="agent-business-metrics">
      <span><strong>{active.filter((item) => item.status === 'completed').length}</strong>{zh ? '有效案件' : '有効案件'}</span>
      <span><strong>{active.filter((item) => item.status === 'awaiting-review').length}</strong>{zh ? '待审核' : '確認待ち'}</span>
      <span><strong>{reviews.filter((item) => item.lifecycle === 'archived').length}</strong>{zh ? '已归档' : 'アーカイブ'}</span>
    </div>
    <div className="agent-business-list">
      {active.map((review) => {
        const title = caseField(review, 'title') ?? review.redactedSubject
        return <article key={review.reviewId}>
          <header><div><small>{review.sourceType.toLocaleUpperCase('en-US')}</small><strong>{title || (zh ? '未命名案件' : '名称未設定案件')}</strong></div><span className={`is-${review.status}`}>{review.status === 'completed' ? (zh ? '已确认' : '確認済み') : (zh ? '待审核' : '確認待ち')}</span></header>
          <p>{[caseField(review, 'role'), caseField(review, 'required_skills'), caseField(review, 'rate')].filter(Boolean).join(' · ') || (zh ? '案件字段尚待确认' : '案件項目は未確認です')}</p>
          <footer><button onClick={() => onOpen({ type: 'system-access', destination: 'case-review', reviewId: review.reviewId })} type="button">{zh ? '查看案件' : '案件を見る'}</button>{review.jobCase ? <button onClick={() => onOpen({ type: 'system-access', destination: 'broadcast', reviewId: review.reviewId })} type="button">{zh ? '配信' : '配信'}</button> : null}{review.jobCase ? <button className="is-primary" onClick={() => onOpen({ type: 'system-access', destination: 'matching', jobCaseId: review.jobCase!.id })} type="button">{zh ? '打开匹配' : 'マッチングを開く'}</button> : null}</footer>
        </article>
      })}
      {active.length === 0 ? <Empty>{zh ? '还没有案件' : '案件はまだありません'}</Empty> : null}
    </div>
  </>
}

function CaseReviewView({ businessProgress, matchingBusy, access, reviews, onOpen, onLoadSourceText, onEditCase, zh }: {
  businessProgress?: ReactNode
  matchingBusy?: boolean
  access: Extract<BusinessAccess, { destination: 'case-review' }>
  reviews: JobCaseReviewSnapshot[]
  onOpen(access: AgentSystemAccessBlock): void
  onLoadSourceText?(reviewId: string): Promise<JobCaseSourceText>
  onEditCase?(reviewId: string): void
  zh: boolean
}) {
  const review = reviews.find((item) => item.reviewId === access.reviewId)
  if (!review) return <Empty>{zh ? '案件记录不存在或已经删除' : '案件レコードが存在しないか削除されています'}</Empty>
  const edit = (key: string, value: string | null, label: string) => <BusinessField kind="case" id={review.reviewId} version={review.reviewRevision} field={key} value={value} label={label} disabled={review.lifecycle !== 'active'} />
  const archived = review.lifecycle === 'archived'
  const valid = review.status === 'completed' && !archived
  return <>
    <div className="agent-business-hero is-case-detail">
      <small>{review.sourceType.toLocaleUpperCase('en-US')} · <span className={`agent-case-validity is-${archived ? 'archived' : valid ? 'valid' : 'attention'}`}>{archived ? (zh ? '无效' : '無効') : valid ? (zh ? '有效' : '有効') : (zh ? '待补充' : '要補完')}</span></small>
      <h2>{edit('title', caseField(review, 'title'), zh ? '案件名称' : '案件名')}</h2>
      {onEditCase ? <button className="case-edit-link" onClick={() => onEditCase(review.reviewId)} type="button">{zh ? '在案件页面编辑' : '案件画面で編集'}<span aria-hidden="true">↗</span></button> : null}
    </div>
    {businessProgress}
    <dl className="agent-business-facts">{review.fields.filter((field) => ['required_skills', 'rate', 'location', 'remote', 'start_date'].includes(field.key)).map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{edit(field.key, field.value, field.label)}</dd></div>)}</dl>
    <JobCaseBody key={`body:${review.reviewId}`} review={review} onLoad={onLoadSourceText} zh={zh} />
    <details className="agent-case-edit-details"><summary>{zh ? '查看全部字段' : '全項目を表示'}</summary>
    <ContextSection title={zh ? '案件字段' : '案件項目'}>
      <dl className="agent-business-facts">{review.fields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{edit(field.key, field.value, field.label)}</dd></div>)}</dl>
    </ContextSection>
    </details>

    <div className="agent-case-actions">
      {review.jobCase && !archived ? <button className="agent-business-primary" disabled={matchingBusy} onClick={() => onOpen({ type: 'system-access', destination: 'matching', jobCaseId: review.jobCase!.id })} type="button"><Icon name="sparkles" size={14} />{zh ? '为此案件找人' : 'この案件の要員を探す'}</button> : null}
    </div>
  </>
}

function CandidateDirectoryView({ reviews, onOpen, zh }: {
  reviews: CandidateReviewSnapshot[]
  onOpen(access: AgentSystemAccessBlock): void
  zh: boolean
}) {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return reviews
    return reviews.filter((review) => [candidateName(review), fieldValue(review, 'role'), fieldValue(review, 'skills'), fieldValue(review, 'location')]
      .filter(Boolean).some((value) => value!.toLocaleLowerCase().includes(normalized)))
  }, [query, reviews])
  return <>
    <label className="agent-business-search"><Icon name="search" size={14} /><input aria-label={zh ? '搜索候选人' : '候補者を検索'} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '姓名、角色、技能、所在地' : '氏名・ロール・スキル・所在地'} value={query} /></label>
    <div className="agent-business-metrics"><span><strong>{reviews.length}</strong>{zh ? '候选人' : '候補者'}</span><span><strong>{reviews.filter((item) => item.status === 'awaiting-review').length}</strong>{zh ? '待审核' : '確認待ち'}</span><span><strong>{reviews.filter((item) => item.talentPoolStatus === 'eligible').length}</strong>{zh ? '人才池' : '人材プール'}</span></div>
    <div className="agent-business-list is-candidates">{visible.map((review) => <button key={review.documentId} onClick={() => onOpen({ type: 'system-access', destination: 'candidate', sourceDocumentId: review.documentId, view: 'overview' })} type="button"><span className="agent-business-avatar">{candidateName(review).slice(-1)}</span><span><strong>{candidateName(review)}</strong><small>{[fieldValue(review, 'role'), fieldValue(review, 'experience_years')].filter(Boolean).join(' · ') || (zh ? '档案待完善' : 'プロフィール未完成')}</small><em>{fieldValue(review, 'skills') || '—'}</em></span><Icon name="chevron-right" size={14} /></button>)}</div>
    {visible.length === 0 ? <Empty>{zh ? '没有符合条件的候选人' : '条件に合う候補者がいません'}</Empty> : null}
  </>
}

function CandidateView({ access, reviews, interviews, onOpen, zh, locale }: {
  access: Extract<BusinessAccess, { destination: 'candidate' }>
  reviews: CandidateReviewSnapshot[]
  interviews: CandidateInterviewSnapshot[]
  onOpen(access: AgentSystemAccessBlock): void
  zh: boolean
  locale: 'ja-JP' | 'zh-CN'
}) {
  const review = reviews.find((item) => item.documentId === access.sourceDocumentId)
  if (!review) return <Empty>{zh ? '候选人档案不存在或已经删除' : '候補者プロフィールが存在しないか削除されています'}</Empty>
  const sessions = interviews.filter((item) => item.sourceDocumentId === review.documentId)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  return <>
    <div className="agent-business-hero is-candidate"><span className="agent-business-avatar">{candidateName(review).slice(-1)}</span><div><small>{review.status === 'completed' ? (zh ? '档案已确认' : 'プロフィール確認済み') : (zh ? '待人工审核' : '人の確認待ち')}</small><h2>{candidateName(review)}</h2><p>{[fieldValue(review, 'role'), fieldValue(review, 'experience_years'), fieldValue(review, 'location')].filter(Boolean).join(' · ')}</p></div></div>
    <div className="agent-business-tabs" role="group"><button className={access.view === 'overview' ? 'is-active' : ''} onClick={() => onOpen({ type: 'system-access', destination: 'candidate', sourceDocumentId: review.documentId, view: 'overview' })} type="button">{zh ? '档案' : 'プロフィール'}</button><button className={access.view === 'resume' ? 'is-active' : ''} onClick={() => onOpen({ type: 'system-access', destination: 'candidate', sourceDocumentId: review.documentId, view: 'resume' })} type="button">{zh ? '简历' : '履歴書'}</button><button className={access.view !== 'overview' && access.view !== 'resume' ? 'is-active' : ''} onClick={() => onOpen({ type: 'system-access', destination: 'candidate', sourceDocumentId: review.documentId, view: 'records' })} type="button">{zh ? '面试记录' : '面談記録'}</button></div>
    {access.view === 'resume' ? <>
      <CandidateProfileSummary key={review.documentId} review={review} />
      <details className="candidate-review-disclosure"><summary>{zh ? '查看字段来源' : '項目の出所を表示'}</summary><dl className="agent-business-facts">{review.fields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{field.sourceLabels.join(' · ') || '—'}</dd></div>)}</dl></details>
      <button className="agent-business-primary" onClick={() => onOpen({ type: 'system-access', destination: 'original-document', sourceDocumentId: review.documentId })} type="button"><Icon name="file" size={14} />{zh ? '在右侧查看原始简历' : '右側で原始履歴書を見る'}</button>
    </> : access.view === 'overview' ? <>
      <div className="agent-business-status-grid"><span><small>{zh ? '招聘状态' : '採用状態'}</small><strong>{review.recruitingStatus}</strong></span><span><small>{zh ? '人才池' : '人材プール'}</small><strong>{review.talentPoolStatus}</strong></span><span><small>{zh ? '记录状态' : '記録状態'}</small><strong>{review.recordStatus}</strong></span></div>
      <CandidateProfileSummary key={review.documentId} review={review} />
    </> : <ContextSection title={zh ? '面试轮次' : '面談ラウンド'}><div className="agent-business-list">{sessions.map((interview) => <article className={access.interviewId === interview.id ? 'is-selected' : ''} key={interview.id}><header><div><small>{interview.kind === 'client' ? (zh ? '客户面试' : '顧客面談') : (zh ? '招聘面试' : '採用面談')}</small><strong>{zh ? `第 ${interview.roundNumber} 轮` : `${interview.roundNumber}回目`} · {interview.stage}</strong></div><span>{formatDateTime(interview.scheduledAt, locale)}</span></header><p>{interview.interviewNotes || interview.interviewGoal || (zh ? '暂无面试记录内容' : '面談記録はまだありません')}</p>{interview.scheduledAt ? <footer><button className="is-primary" onClick={() => onOpen({ type: 'system-access', destination: 'interview-schedule', receipt: { sourceDocumentId: review.documentId, candidateLabel: candidateName(review), scheduledAt: interview.scheduledAt!, durationMinutes: interview.durationMinutes, meetingMethod: interview.meetingMethod, kind: interview.kind, meetingLinkStoredLocally: Boolean(interview.meetingUrl) } })} type="button">{zh ? '打开面试日程' : '面談日程を開く'}</button></footer> : null}</article>)}</div>{sessions.length === 0 ? <Empty>{zh ? '还没有面试记录' : '面談記録はまだありません'}</Empty> : null}</ContextSection>}
  </>
}


/**
 * Quick confirm submits the draft exactly as it stands: every field with its
 * current value, no change reasons (nothing changed), privacy reviewed. The
 * main process still applies its own rules - a non-empty title, no direct
 * identifiers, the current revision - so this is a shortcut, not a bypass.
 */
function quickConfirmInput(review: JobCaseReviewSnapshot): SubmitJobCaseReviewInput {
  return {
    reviewId: review.reviewId,
    reviewRevision: review.reviewRevision,
    privacyReviewed: true,
    fields: review.fields.map((field) => ({ key: field.key, value: field.value, confirmed: true }))
  }
}

function IntakeBatchReviewView({ access, reviews, onOpen, onSubmitCase, zh }: {
  access: Extract<BusinessAccess, { destination: 'review-center' }>
  reviews: JobCaseReviewSnapshot[]
  onOpen(access: AgentSystemAccessBlock): void
  onSubmitCase?(input: SubmitJobCaseReviewInput): Promise<SubmitJobCaseReviewResult>
  zh: boolean
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<{ reviewId: string; message: string } | null>(null)
  const drafts = (access.reviewIds ?? [])
    .map((reviewId) => reviews.find((review) => review.reviewId === reviewId))
    .filter((review): review is JobCaseReviewSnapshot => Boolean(review))
  const awaiting = drafts.filter((review) => review.status === 'awaiting-review' && review.lifecycle === 'active')
  const confirm = async (review: JobCaseReviewSnapshot) => {
    if (busyId || !onSubmitCase) return
    setBusyId(review.reviewId)
    setError(null)
    try {
      await onSubmitCase(quickConfirmInput(review))
    } catch (cause) {
      setError({ reviewId: review.reviewId, message: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      setBusyId(null)
    }
  }
  return <>
    <div className="agent-business-metrics"><span><strong>{drafts.length}</strong>{zh ? '本次导入' : '今回の取込'}</span><span><strong>{awaiting.length}</strong>{zh ? '待审核' : '確認待ち'}</span><span><strong>{drafts.filter((review) => review.status === 'completed').length}</strong>{zh ? '已确认' : '確認済み'}</span></div>
    <div className="agent-business-context-note"><Icon name="shield" size={13} /><span>{zh ? '快速确认会以草稿当前的字段值原样确认；需要修改字段请先打开该案件。案件名为空的草稿必须先补充案件名。' : 'クイック確認は下書きの現在の項目値をそのまま確定します。項目を直す場合は先に案件を開いてください。案件名が空の下書きは先に案件名を補ってください。'}</span></div>
    <div className="agent-business-list">{drafts.map((review, index) => {
      const title = caseField(review, 'title')
      const pending = review.status === 'awaiting-review' && review.lifecycle === 'active'
      const missing = review.fields.filter((field) => !field.value).length
      return <article key={review.reviewId}>
        <header><div><small>DRAFT_{index + 1}</small><strong>{title || (zh ? '未命名案件' : '名称未設定案件')}</strong></div><span className={`is-${review.status}`}>{review.status === 'completed' ? (zh ? '已确认' : '確認済み') : (zh ? '待审核' : '確認待ち')}</span></header>
        <p>{[caseField(review, 'required_skills'), caseField(review, 'rate'), caseField(review, 'location'), caseField(review, 'start_date')].filter(Boolean).join(' · ') || (zh ? '案件字段尚待确认' : '案件項目は未確認です')}</p>
        <div className="agent-business-tags"><span>{zh ? `缺 ${missing} 项` : `未記入 ${missing}項目`}</span>{review.warningCodes.length > 0 ? <span>{zh ? `注意 ${review.warningCodes.length} 项` : `注意 ${review.warningCodes.length}件`}</span> : null}</div>
        {error?.reviewId === review.reviewId ? <p className="agent-business-error" role="alert">{error.message}</p> : null}
        <footer>
          <button onClick={() => onOpen({ type: 'system-access', destination: 'case-review', reviewId: review.reviewId })} type="button">{zh ? '打开案件' : '案件を開く'}</button>
          {pending && onSubmitCase ? <button className="is-primary" disabled={!title || busyId !== null} onClick={() => void confirm(review)} type="button">{busyId === review.reviewId ? (zh ? '确认中…' : '確認中…') : (zh ? '快速确认' : 'クイック確認')}</button> : null}
          {review.jobCase && review.status === 'completed' ? <button className="is-primary" onClick={() => onOpen({ type: 'system-access', destination: 'matching', jobCaseId: review.jobCase!.id })} type="button">{zh ? '打开匹配' : 'マッチングを開く'}</button> : null}
        </footer>
      </article>
    })}</div>
    {drafts.length === 0 ? <Empty>{zh ? '本次导入的草稿不存在或已删除' : '今回取り込んだ下書きは存在しないか削除されています'}</Empty> : null}
    <div className="agent-business-list-footer"><button onClick={() => onOpen({ type: 'system-access', destination: 'review-center' })} type="button">{zh ? '显示全部待审核' : 'すべての確認待ちを表示'}</button></div>
  </>
}

function ReviewCenterView({ items, onOpen, onResolve, zh }: {
  items: ReviewQueueItem[]
  onOpen(access: AgentSystemAccessBlock): void
  onResolve(approvalId: string, decision: 'approve' | 'deny'): Promise<void>
  zh: boolean
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const resolve = async (approvalId: string, decision: 'approve' | 'deny') => {
    if (busyId) return
    setBusyId(approvalId)
    try { await onResolve(approvalId, decision) } finally { setBusyId(null) }
  }
  const open = (item: ReviewQueueItem) => {
    if (item.kind === 'candidate') onOpen({ type: 'system-access', destination: 'candidate', sourceDocumentId: item.documentId, view: 'resume' })
    if (item.kind === 'case') onOpen({ type: 'system-access', destination: 'case-review', reviewId: item.reviewId })
    if (item.kind === 'task') onOpen({ type: 'system-access', destination: 'task', taskId: item.taskId })
  }
  return <><div className="agent-business-metrics"><span><strong>{items.length}</strong>{zh ? '全部待处理' : '確認待ち'}</span>{items.some((item) => item.kind === 'candidate') ? <span><strong>{items.filter((item) => item.kind === 'candidate').length}</strong>{zh ? '候选人' : '候補者'}</span> : null}{items.some((item) => item.kind === 'case') ? <span><strong>{items.filter((item) => item.kind === 'case').length}</strong>{zh ? '案件' : '案件'}</span> : null}</div><div className="agent-business-list">{items.map((item) => <article key={item.id}><header><div><strong>{item.title}</strong></div><span>{item.metadata}</span></header><p>{item.summary}</p>{item.kind === 'action-approval' ? <footer><button disabled={Boolean(busyId)} onClick={() => void resolve(item.approvalId, 'deny')} type="button">{zh ? '拒绝' : '拒否'}</button><button className="is-primary" disabled={Boolean(busyId)} onClick={() => void resolve(item.approvalId, 'approve')} type="button">{zh ? '批准' : '承認'}</button></footer> : <footer><button className="is-primary" onClick={() => open(item)} type="button">{zh ? '在右侧处理' : '右側で処理'}</button></footer>}</article>)}</div>{items.length === 0 ? <Empty>{zh ? '目前没有需要确认的操作' : '現在、確認が必要な操作はありません'}</Empty> : null}</>
}

function TaskView({ access, tasks, zh }: { access: Extract<BusinessAccess, { destination: 'task' }>; tasks: WorkTask[]; zh: boolean }) {
  const task = tasks.find((item) => item.id === access.taskId)
  if (!task) return <Empty>{zh ? '任务不存在或已经删除' : 'タスクが存在しないか削除されています'}</Empty>
  return <><div className="agent-business-hero"><small>{task.typeLabel}</small><h2>{task.title}</h2><p>{task.instruction}</p></div><div className="agent-business-status-grid"><span><small>{zh ? '状态' : '状態'}</small><strong>{task.status}</strong></span><span><small>{zh ? '进度' : '進捗'}</small><strong>{task.progress}%</strong></span><span><small>{zh ? '证据' : '証跡'}</small><strong>{task.evidenceCount}</strong></span></div><ContextSection title={zh ? '业务范围' : '業務範囲'}><p>{task.scope.label}</p></ContextSection></>
}

function CaseImportView({ onCreate, onOpen, zh }: {
  onCreate(input: { subject: string; body: string }): Promise<CreateManualJobCaseDraftResult>
  onOpen(access: AgentSystemAccessBlock): void
  zh: boolean
}) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!subject.trim() || !body.trim() || busy) return
    setBusy(true); setError(null)
    try {
      const result = await onCreate({ subject: subject.trim(), body: body.trim() })
      onOpen({ type: 'system-access', destination: 'case-review', reviewId: result.review.reviewId })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (zh ? '案件导入失败。' : '案件を取り込めませんでした。'))
    } finally { setBusy(false) }
  }
  return <form className="agent-business-import" onSubmit={submit}><div className="agent-business-hero"><small>LOCAL CASE IMPORT</small><h2>{zh ? '在右侧创建案件' : '右側で案件を作成'}</h2><p>{zh ? '内容先在本机脱敏并抽取字段，保存后即为有效案件，之后可随时在这里修改。' : '内容は端末内で脱敏して項目を抽出し、保存すると有効な案件になります。あとからここで編集できます。'}</p></div><label><span>{zh ? '案件标题' : '案件タイトル'}</span><input maxLength={300} onChange={(event) => setSubject(event.target.value)} value={subject} /></label><label><span>{zh ? '案件内容' : '案件内容'}</span><textarea maxLength={20_000} onChange={(event) => setBody(event.target.value)} rows={10} value={body} /></label>{error ? <p role="alert">{error}</p> : null}<button className="agent-business-primary" disabled={busy || !subject.trim() || !body.trim()} type="submit">{busy ? (zh ? '正在导入…' : '取込中…') : (zh ? '创建案件' : '案件を作成')}</button></form>
}

function OriginalDocumentView({ access, onLoad, zh }: {
  access: Extract<BusinessAccess, { destination: 'original-document' }>
  onLoad(sourceDocumentId: string): Promise<OriginalDocumentPreview>
  zh: boolean
}) {
  const [preview, setPreview] = useState<OriginalDocumentPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sheetName, setSheetName] = useState('')
  const [zoom, setZoom] = useState(75)
  useEffect(() => {
    let active = true
    setPreview(null); setError(null)
    void onLoad(access.sourceDocumentId).then((value) => { if (active) setPreview(value) }, (cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [access.sourceDocumentId, onLoad])
  if (error) return <div className="agent-business-error" role="alert">{error}</div>
  if (!preview) return <div className="agent-business-loading"><span className="matching-spinner" />{zh ? '正在读取本机加密文件…' : '暗号化ローカルファイルを読込中…'}</div>
  const activeSheet = preview.sheets.find((sheet) => sheet.name === sheetName) ?? preview.sheets[0]
  return <><div className="agent-business-hero"><small>{preview.format.toLocaleUpperCase('en-US')} · {Math.max(1, Math.round(preview.size / 1024))} KB</small><h2>{preview.fileName}</h2><p>{zh ? '原始文件只在本机解密显示；对话只读取对应的脱敏结构化字段。' : '原始ファイルは端末内だけで復号表示し、会話には対応する脱敏済み構造化項目だけを渡します。'}</p></div>
    {preview.viewMode === 'spreadsheet' ? <div className="agent-original-controls"><label>{zh ? '工作表' : 'シート'}<select value={activeSheet?.name ?? ''} onChange={(event) => setSheetName(event.target.value)}>{preview.sheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name}</option>)}</select></label><label>{zh ? '缩放' : 'ズーム'}<select value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>{[50, 75, 100, 125].map((value) => <option key={value} value={value}>{value}%</option>)}</select></label></div> : null}
    <div className="agent-original-preview">{preview.viewMode === 'pdf' && preview.previewUrl ? <iframe src={preview.previewUrl} title={preview.fileName} /> : preview.viewMode === 'spreadsheet' && activeSheet ? <SpreadsheetPreview sheet={activeSheet} zoom={zoom} search="" selectedSources={[]} /> : preview.viewMode === 'pdf' ? <div className="original-pdf-fallback">{preview.pages.map((page) => <article key={page.pageNumber}><span>Page {page.pageNumber}</span>{page.blocks.map((block, index) => <p key={index}>{block.text}</p>)}</article>)}</div> : <div className="original-word-pages">{preview.paragraphs.map((paragraph) => <p key={paragraph.paragraphNumber}>{paragraph.text}</p>)}</div>}</div></>
}

export function AgentBusinessWorkspacePanel({
  renderBusinessProgress,
  matchingBusy,
  access,
  focusRequest,
  candidateReviews,
  interviews,
  jobCaseReviews,
  matchingHome,
  reviewQueue,
  tasks,
  onBack,
  onClose,
  onOpenAccess,
  onCreateManualCase,
  onLoadJobCaseSourceText,
  onLoadOriginalDocument,
  onResolveActionApproval,
  onSubmitJobCaseReview,
  onEditCase,
  broadcastActions,
  newCaseDigest = null,
  gmailLastSyncedAt = null,
  onMarkSeen
}: AgentBusinessWorkspacePanelProps) {
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusRequest || !bodyRef.current || bodyRef.current.closest('[hidden]')) return
    bodyRef.current.scrollTop = 0
    bodyRef.current.focus({ preventScroll: true })
  }, [focusRequest])
  const presentation = accessPresentation(access, zh)
  let content: ReactNode
  if (access.destination === 'new-cases') content = <NewCaseDigestCard
    digest={newCaseDigest ?? { groups: [], newCasesToday: 0, unseenCount: 0 }}
    gmailLastSyncedAt={gmailLastSyncedAt ?? null}
    onMarkSeen={(reviewId) => onMarkSeen?.(reviewId)}
    onOpenAccess={onOpenAccess}
  />
  else   if (access.destination === 'job-cases') content = <JobCasesView onOpen={onOpenAccess} reviews={jobCaseReviews} zh={zh} />
  else if (access.destination === 'case-import') content = <CaseImportView onCreate={onCreateManualCase} onOpen={onOpenAccess} zh={zh} />
  else if (access.destination === 'case-review') content = <CaseReviewView businessProgress={renderBusinessProgress?.('case', access.reviewId)} matchingBusy={matchingBusy} key={access.reviewId} access={access} onLoadSourceText={onLoadJobCaseSourceText} onOpen={onOpenAccess} onEditCase={onEditCase} reviews={jobCaseReviews} zh={zh} />
  else if (access.destination === 'matching') content = <CaseMatchingWorkspace jobCaseId={access.jobCaseId ?? matchingHome.selectedJobCaseId ?? undefined} request={access.jobCaseId ? { id: focusRequest ?? 1, jobCaseId: access.jobCaseId } : undefined} reviews={jobCaseReviews} candidates={candidateReviews} onOpenPerson={(documentId) => onOpenAccess({ type: 'system-access', destination: 'candidate', sourceDocumentId: documentId, view: 'overview' })} />
  else if (access.destination === 'broadcast') {
    content = broadcastActions
      ? <BroadcastWorkspaceView actions={broadcastActions} initialReviewId={access.reviewId} onSelectedReviewChange={(reviewId) => onOpenAccess({ type: 'system-access', destination: 'broadcast', reviewId })} />
      : <Empty>{zh ? '案件配信在此环境中不可用' : '案件配信はこの環境では利用できません'}</Empty>
  }
  else if (access.destination === 'candidate-management') content = <CandidateDirectoryView onOpen={onOpenAccess} reviews={candidateReviews} zh={zh} />
  else if (access.destination === 'candidate') content = <CandidateView access={access} interviews={interviews} locale={locale} onOpen={onOpenAccess} reviews={candidateReviews} zh={zh} />
  else if (access.destination === 'original-document') content = <OriginalDocumentView key={access.sourceDocumentId} access={access} onLoad={onLoadOriginalDocument} zh={zh} />
  else if (access.destination === 'review-center' && access.reviewIds && access.reviewIds.length > 0) {
    content = <IntakeBatchReviewView access={access} onOpen={onOpenAccess} onSubmitCase={onSubmitJobCaseReview} reviews={jobCaseReviews} zh={zh} />
  }
  else if (access.destination === 'review-center') content = <ReviewCenterView items={reviewQueue} onOpen={onOpenAccess} onResolve={onResolveActionApproval} zh={zh} />
  else content = <TaskView access={access} tasks={tasks} zh={zh} />

  return <div className="agent-business-context-panel">
    <header className="agent-context-panel-header"><div>{onBack ? <button aria-label={zh ? '返回上一级' : '前の画面に戻る'} className="agent-context-panel-back" onClick={onBack} type="button">←<span>{zh ? '返回' : '戻る'}</span></button> : null}<Icon name={presentation.icon} size={17} /><strong>{presentation.title}</strong><span className="agent-context-connected"><Icon name="sparkles" size={11} />{zh ? '已接入对话上下文' : '会話コンテキストに接続'}</span></div>{access.destination !== 'new-cases' ? <button aria-label={zh ? '显示今日新案件' : '今日の新着案件を表示'} className="agent-context-panel-board" onClick={() => onOpenAccess({ type: 'system-access', destination: 'new-cases' })} type="button"><Icon name="briefcase" size={13} /><span>{zh ? '新案件' : '新着案件'}</span></button> : null}<button aria-label={zh ? '关闭右侧工作区' : '右ワークスペースを閉じる'} className="agent-context-panel-close" onClick={onClose} type="button">×</button></header>
    <div className="agent-business-context-note"><Icon name="shield" size={13} /><span>{zh ? '这里的资料可用于后续提问；姓名和联系方式保留在本机。' : 'この資料を次の質問に利用できます。氏名と連絡先は端末内に保管します。'}</span></div>
    <div ref={bodyRef} tabIndex={-1} className="agent-business-context-body">{content}</div>
  </div>
}
