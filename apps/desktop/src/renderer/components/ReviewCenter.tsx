import { useMemo, useState } from 'react'
import type { WorkTask } from '@domain'
import type { ActionApprovalSummary, CandidateReviewSnapshot, JobCaseReviewSnapshot } from '@shared'
import { Icon } from './Icon'
import { localizedTaskTitle, useRendererUiRefresh, useUiLocale, useUiText } from '../i18n'

export type ReviewQueueItem =
  | {
      id: string
      kind: 'task'
      taskId: string
      title: string
      summary: string
      updatedAt: string
      metadata: string
    }
  | {
      id: string
      kind: 'action-approval'
      approvalId: string
      title: string
      summary: string
      updatedAt: string
      metadata: string
    }
  | {
      id: string
      kind: 'candidate'
      documentId: string
      taskId: string | null
      title: string
      summary: string
      updatedAt: string
      metadata: string
    }
  | {
      id: string
      kind: 'case'
      reviewId: string
      title: string
      summary: string
      updatedAt: string
      metadata: string
    }

const kindOrder: Record<ReviewQueueItem['kind'], number> = {
  candidate: 0,
  case: 1,
  'action-approval': 2,
  task: 3
}

function taskForDocument(tasks: WorkTask[]): Map<string, WorkTask> {
  const result = new Map<string, WorkTask>()
  for (const task of tasks) {
    if (task.type !== 'IMPORT_RESUME') continue
    for (const binding of task.contextBindings) {
      if (binding.objectType !== 'staged-file') continue
      const current = result.get(binding.objectId)
      if (!current || current.updatedAt < task.updatedAt) result.set(binding.objectId, task)
    }
  }
  return result
}

export function buildReviewQueue(
  tasks: WorkTask[],
  candidateReviews: CandidateReviewSnapshot[],
  jobCaseReviews: JobCaseReviewSnapshot[],
  actionApprovals: ActionApprovalSummary[] = []
): ReviewQueueItem[] {
  const reviewsByDocument = new Map(candidateReviews.map((review) => [review.documentId, review]))
  const importTaskByDocument = taskForDocument(tasks)
  const pendingCandidateIds = new Set(
    candidateReviews.filter((review) => review.status === 'awaiting-review').map((review) => review.documentId)
  )
  const items: ReviewQueueItem[] = []

  for (const task of tasks) {
    if (task.status !== 'awaiting_review') continue
    if (task.type === 'IMPORT_RESUME') {
      const stagedDocumentIds = task.contextBindings
        .filter((binding) => binding.objectType === 'staged-file')
        .map((binding) => binding.objectId)
      const hasCandidateAction = stagedDocumentIds.some((documentId) => pendingCandidateIds.has(documentId))
      const allDocumentsRepresented = stagedDocumentIds.length > 0 && stagedDocumentIds.every((documentId) =>
        reviewsByDocument.has(documentId)
      )
      if (hasCandidateAction && allDocumentsRepresented) continue
    }
    items.push({
      id: `task:${task.id}`,
      kind: 'task',
      taskId: task.id,
      title: task.typeLabel,
      summary: task.scope.label,
      updatedAt: task.updatedAt,
      metadata: `進捗 ${task.progress}% · 証跡 ${task.evidenceCount}件`
    })
  }

  for (const review of candidateReviews) {
    if (review.status !== 'awaiting-review') continue
    const task = importTaskByDocument.get(review.documentId)
    const confirmedFields = review.fields.filter((field) => field.value).length
    items.push({
      id: `candidate:${review.documentId}`,
      kind: 'candidate',
      documentId: review.documentId,
      taskId: task?.id ?? null,
      title: '候補者プロフィールを確認',
      summary: `Document ${review.documentId.slice(0, 8).toLocaleUpperCase('en-US')}`,
      updatedAt: task?.updatedAt ?? '',
      metadata: `抽出項目 ${confirmedFields}件 · 案件経歴 ${review.projectExperiences.length}件`
    })
  }

  for (const review of jobCaseReviews) {
    if (review.lifecycle !== 'active' || review.status !== 'awaiting-review') continue
    const source = review.sourceType === 'gmail' ? 'Gmail' : review.sourceType === 'eml' ? 'EML' : '手動入力'
    items.push({
      id: `case:${review.reviewId}`,
      kind: 'case',
      reviewId: review.reviewId,
      title: review.redactedSubject || '案件候補を確認',
      summary: `${source} · Review ${review.reviewId.slice(0, 8).toLocaleUpperCase('en-US')}`,
      updatedAt: review.messageDate,
      metadata: `確認項目 ${review.fields.length}件 · 注意 ${review.warningCodes.length}件`
    })
  }

  for (const approval of actionApprovals) {
    if (approval.status !== 'pending') continue
    items.push({
      id: `action-approval:${approval.id}`,
      kind: 'action-approval',
      approvalId: approval.id,
      title: '実行の承認を確認',
      summary: approval.safeSummary,
      updatedAt: approval.createdAt,
      metadata: `${approval.toolName} · ${approval.reason}`
    })
  }

  return items.sort((left, right) => {
    const timeDifference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    if (Number.isFinite(timeDifference) && timeDifference !== 0) return timeDifference
    const kindDifference = kindOrder[left.kind] - kindOrder[right.kind]
    return kindDifference || left.id.localeCompare(right.id)
  })
}

interface ReviewCenterProps {
  items: ReviewQueueItem[]
  onOpenTask(taskId: string): void
  onOpenCandidate(documentId: string, taskId: string | null): void
  onOpenCase(reviewId: string): void
  onResolveActionApproval?(approvalId: string, decision: 'approve' | 'deny'): Promise<void> | void
}

type ReviewFilter = 'all' | ReviewQueueItem['kind']

const filters: Array<{ id: ReviewFilter; label: string }> = [
  { id: 'all', label: 'すべて' },
  { id: 'task', label: '作業' },
  { id: 'candidate', label: '候補者' },
  { id: 'case', label: '案件' },
  { id: 'action-approval', label: '実行' }
]

function displayReviewDate(value: string, locale: 'ja-JP' | 'zh-CN'): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '更新日時なし'
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function kindLabel(kind: ReviewQueueItem['kind']): string {
  if (kind === 'candidate') return '候補者データ'
  if (kind === 'case') return '案件データ'
  if (kind === 'action-approval') return '実行の承認'
  return '作業結果'
}

export function ReviewCenter({ items, onOpenCandidate, onOpenCase, onOpenTask, onResolveActionApproval }: ReviewCenterProps) {
  useRendererUiRefresh()
  const locale = useUiLocale()
  const t = useUiText()
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null)
  const [approvalError, setApprovalError] = useState<{ approvalId: string; message: string } | null>(null)
  const counts = useMemo(() => ({
    all: items.length,
    task: items.filter((item) => item.kind === 'task').length,
    candidate: items.filter((item) => item.kind === 'candidate').length,
    case: items.filter((item) => item.kind === 'case').length,
    'action-approval': items.filter((item) => item.kind === 'action-approval').length
  }), [items])
  const visibleItems = useMemo(
    () => filter === 'all' ? items : items.filter((item) => item.kind === filter),
    [filter, items]
  )

  const open = (item: ReviewQueueItem) => {
    if (item.kind === 'task') onOpenTask(item.taskId)
    if (item.kind === 'candidate') onOpenCandidate(item.documentId, item.taskId)
    if (item.kind === 'case') onOpenCase(item.reviewId)
  }

  const resolveApproval = async (approvalId: string, decision: 'approve' | 'deny') => {
    if (!onResolveActionApproval || resolvingApprovalId) return
    setApprovalError(null)
    setResolvingApprovalId(approvalId)
    try {
      await onResolveActionApproval(approvalId, decision)
    } catch (cause) {
      setApprovalError({
        approvalId,
        message: cause instanceof Error ? cause.message : '承認状態を更新できませんでした。'
      })
    } finally {
      setResolvingApprovalId(null)
    }
  }

  return (
    <main className="review-center-page">
      <header className="review-center-header">
        <div>
          <span className="eyebrow">HUMAN REVIEW</span>
          <h1>レビューセンター</h1>
          <p>AIや自動処理が止まり、人の判断を待っている項目だけを一つのキューで確認します。</p>
        </div>
        <div className="review-center-total"><strong>{items.length}</strong><span>確認待ち</span></div>
      </header>

      <section aria-label="レビュー種別の集計" className="review-center-stats">
        {filters.map((item) => (
          <button
            aria-pressed={filter === item.id}
            className={filter === item.id ? 'is-active' : ''}
            key={item.id}
            onClick={() => setFilter(item.id)}
            type="button"
          >
            <strong>{counts[item.id]}</strong>
            <span>{item.label}</span>
          </button>
        ))}
      </section>

      <aside className="review-center-privacy" aria-label="レビュー一覧のプライバシー境界">
        <Icon name="shield" size={17} />
        <div>
          <strong>一覧には原文や直接識別子を複製しません</strong>
          <p>候補者は匿名Document ID、案件は端末内で脱敏した件名だけを表示。詳細を開いてもCloudへ自動送信しません。</p>
        </div>
        <span><Icon name="lock" size={12} />端末内のみ</span>
      </aside>

      <section className="review-center-list" aria-label="確認待ちのレビュー">
        <header><strong>{filters.find((item) => item.id === filter)?.label}の確認待ち</strong><span>更新順</span></header>
        {visibleItems.length > 0 ? visibleItems.map((item) => item.kind === 'action-approval' ? (
          <article className={`review-center-item is-${item.kind}`} key={item.id}>
            <span className="review-center-item-icon"><Icon name="shield" size={19} /></span>
            <span className="review-center-item-copy">
              <span className="review-center-item-kind">{kindLabel(item.kind)}</span>
              <strong>{item.title}</strong>
              <small>{item.summary}</small>
            </span>
            <span className="review-center-item-meta">
              <time dateTime={item.updatedAt}>{displayReviewDate(item.updatedAt, locale)}</time>
              <small>{t(item.metadata)}</small>
              <span className="review-center-approval-actions">
                <button
                  disabled={resolvingApprovalId !== null}
                  onClick={() => { void resolveApproval(item.approvalId, 'approve') }}
                  type="button"
                >{resolvingApprovalId === item.approvalId ? '処理中…' : '承認'}</button>
                <button
                  className="is-deny"
                  disabled={resolvingApprovalId !== null}
                  onClick={() => { void resolveApproval(item.approvalId, 'deny') }}
                  type="button"
                >拒否</button>
              </span>
              {approvalError?.approvalId === item.approvalId && resolvingApprovalId === null
                ? <small aria-live="polite" className="review-center-approval-error">{approvalError.message}</small>
                : null}
            </span>
          </article>
        ) : (
          <button
            aria-label={locale === 'zh-CN'
              ? `打开${item.kind === 'task' ? localizedTaskTitle(locale, { id: item.taskId, title: item.title }) : item.title}的详情`
              : `${item.title}の詳細を開く`}
            className={`review-center-item is-${item.kind}`}
            key={item.id}
            onClick={() => open(item)}
            type="button"
          >
            <span className="review-center-item-icon">
              <Icon name={item.kind === 'candidate' ? 'users' : item.kind === 'case' ? 'briefcase' : 'tasks'} size={19} />
            </span>
            <span className="review-center-item-copy">
              <span className="review-center-item-kind">{kindLabel(item.kind)}</span>
              <strong>{item.kind === 'task' ? localizedTaskTitle(locale, { id: item.taskId, title: item.title }) : item.title}</strong>
              <small>{item.summary}</small>
            </span>
            <span className="review-center-item-meta">
              <time dateTime={item.updatedAt || undefined}>{displayReviewDate(item.updatedAt, locale)}</time>
              <small>{t(item.metadata)}</small>
            </span>
            <span className="review-center-item-action">確認する<Icon name="chevron-right" size={15} /></span>
          </button>
        )) : (
          <div className="review-center-empty">
            <span><Icon name="check" size={24} /></span>
            <strong>{filter === 'all' ? '確認待ちはありません' : 'この種別の確認待ちはありません'}</strong>
            <p>新しいレビューが必要になると、この端末内のキューに表示されます。</p>
          </div>
        )}
      </section>

      <footer className="app-footer">レビューキューは暗号化ローカルDBの状態から生成 · 外部送信なし</footer>
    </main>
  )
}
