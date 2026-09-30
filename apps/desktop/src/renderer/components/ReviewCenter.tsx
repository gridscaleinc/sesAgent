import { useMemo, useState } from 'react'
import type { WorkTask } from '@domain'
import type { ActionApprovalSummary, CandidateReviewSnapshot, JobCaseReviewSnapshot } from '@shared'
import { Icon } from './Icon'
import { localeText, localizedIpcError, localizedMainText, localizedTaskTitle, useLocaleText } from '../i18n'
import { workTaskTypeLabel } from './TaskList'

type LocaleText = (zh: string, ja: string) => string

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
  actionApprovals: ActionApprovalSummary[] = [],
  t: LocaleText = localeText(false)
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
      const allDocumentsRepresented =
        stagedDocumentIds.length > 0 && stagedDocumentIds.every((documentId) => reviewsByDocument.has(documentId))
      if (hasCandidateAction && allDocumentsRepresented) continue
    }
    items.push({
      id: `task:${task.id}`,
      kind: 'task',
      taskId: task.id,
      title: workTaskTypeLabel(task, t),
      summary: task.scope.label,
      updatedAt: task.updatedAt,
      metadata: t(`进度 ${task.progress}% · 证据 ${task.evidenceCount} 项`, `進捗 ${task.progress}% · 証跡 ${task.evidenceCount}件`)
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
      title: t('审核人员档案', '候補者プロフィールを確認'),
      summary: `Document ${review.documentId.slice(0, 8).toLocaleUpperCase('en-US')}`,
      updatedAt: task?.updatedAt ?? '',
      metadata: t(
        `提取字段 ${confirmedFields} 项 · 项目经历 ${review.projectExperiences.length} 项`,
        `抽出項目 ${confirmedFields}件 · 案件経歴 ${review.projectExperiences.length}件`
      )
    })
  }

  for (const review of jobCaseReviews) {
    if (review.lifecycle !== 'active' || review.status !== 'awaiting-review') continue
    const source = review.sourceType === 'gmail' ? 'Gmail' : review.sourceType === 'eml' ? 'EML' : t('手工输入', '手動入力')
    items.push({
      id: `case:${review.reviewId}`,
      kind: 'case',
      reviewId: review.reviewId,
      title: review.redactedSubject || t('审核案件候选项', '案件候補を確認'),
      summary: `${source} · Review ${review.reviewId.slice(0, 8).toLocaleUpperCase('en-US')}`,
      updatedAt: review.messageDate,
      metadata: t(
        `确认字段 ${review.fields.length} 项 · 注意 ${review.warningCodes.length} 项`,
        `確認項目 ${review.fields.length}件 · 注意 ${review.warningCodes.length}件`
      )
    })
  }

  for (const approval of actionApprovals) {
    if (approval.status !== 'pending') continue
    items.push({
      id: `action-approval:${approval.id}`,
      kind: 'action-approval',
      approvalId: approval.id,
      title: t('确认执行审批', '実行の承認を確認'),
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

function reviewFilters(t: LocaleText): Array<{ id: ReviewFilter; label: string }> {
  return [
    { id: 'all', label: t('全部', 'すべて') },
    { id: 'task', label: t('任务', '作業') },
    { id: 'candidate', label: t('人员', '候補者') },
    { id: 'case', label: t('案件', '案件') },
    { id: 'action-approval', label: t('执行', '実行') }
  ]
}

function displayReviewDate(value: string, locale: 'ja-JP' | 'zh-CN', t: LocaleText): string {
  if (!value || !Number.isFinite(Date.parse(value))) return t('无更新时间', '更新日時なし')
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function kindLabel(kind: ReviewQueueItem['kind'], t: LocaleText): string {
  if (kind === 'candidate') return t('人员数据', '候補者データ')
  if (kind === 'case') return t('案件数据', '案件データ')
  if (kind === 'action-approval') return t('执行审批', '実行の承認')
  return t('任务结果', '作業結果')
}

export function ReviewCenter({ items, onOpenCandidate, onOpenCase, onOpenTask, onResolveActionApproval }: ReviewCenterProps) {
  const { locale, t } = useLocaleText()
  const filters = reviewFilters(t)
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null)
  const [approvalError, setApprovalError] = useState<{ approvalId: string; message: string } | null>(null)
  const counts = useMemo(
    () => ({
      all: items.length,
      task: items.filter((item) => item.kind === 'task').length,
      candidate: items.filter((item) => item.kind === 'candidate').length,
      case: items.filter((item) => item.kind === 'case').length,
      'action-approval': items.filter((item) => item.kind === 'action-approval').length
    }),
    [items]
  )
  const visibleItems = useMemo(() => (filter === 'all' ? items : items.filter((item) => item.kind === filter)), [filter, items])

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
        message: localizedIpcError(locale, cause, t('无法更新审批状态。', '承認状態を更新できませんでした。'))
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
          <h1>{t('审核中心', 'レビューセンター')}</h1>
          <p>
            {t(
              '在统一队列中查看 AI 或自动处理已暂停、正在等待人工判断的项目。',
              'AIや自動処理が止まり、人の判断を待っている項目だけを一つのキューで確認します。'
            )}
          </p>
        </div>
        <div className="review-center-total">
          <strong>{items.length}</strong>
          <span>{t('待确认', '確認待ち')}</span>
        </div>
      </header>

      <section aria-label={t('审核类型汇总', 'レビュー種別の集計')} className="review-center-stats">
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

      <aside className="review-center-privacy" aria-label={t('审核列表的隐私边界', 'レビュー一覧のプライバシー境界')}>
        <Icon name="shield" size={17} />
        <div>
          <strong>{t('列表中不会复制原文或直接标识符', '一覧には原文や直接識別子を複製しません')}</strong>
          <p>
            {t(
              '人员仅显示匿名文档 ID，案件仅显示在本机脱敏后的主题；打开详情也不会自动发送到云端。',
              '候補者は匿名Document ID、案件は端末内で脱敏した件名だけを表示。詳細を開いてもCloudへ自動送信しません。'
            )}
          </p>
        </div>
        <span>
          <Icon name="lock" size={12} />
          {t('仅本机', '端末内のみ')}
        </span>
      </aside>

      <section className="review-center-list" aria-label={t('待确认审核', '確認待ちのレビュー')}>
        <header>
          <strong>
            {t(
              `${filters.find((item) => item.id === filter)?.label ?? ''}待确认`,
              `${filters.find((item) => item.id === filter)?.label ?? ''}の確認待ち`
            )}
          </strong>
          <span>{t('按更新时间', '更新順')}</span>
        </header>
        {visibleItems.length > 0 ? (
          visibleItems.map((item) =>
            item.kind === 'action-approval' ? (
              <article className={`review-center-item is-${item.kind}`} key={item.id}>
                <span className="review-center-item-icon">
                  <Icon name="shield" size={19} />
                </span>
                <span className="review-center-item-copy">
                  <span className="review-center-item-kind">{kindLabel(item.kind, t)}</span>
                  <strong>{item.title}</strong>
                  <small>{localizedMainText(locale, item.summary)}</small>
                </span>
                <span className="review-center-item-meta">
                  <time dateTime={item.updatedAt}>{displayReviewDate(item.updatedAt, locale, t)}</time>
                  <small>{item.metadata}</small>
                  <span className="review-center-approval-actions">
                    <button
                      disabled={resolvingApprovalId !== null}
                      onClick={() => {
                        void resolveApproval(item.approvalId, 'approve')
                      }}
                      type="button"
                    >
                      {resolvingApprovalId === item.approvalId ? t('处理中…', '処理中…') : t('批准', '承認')}
                    </button>
                    <button
                      className="is-deny"
                      disabled={resolvingApprovalId !== null}
                      onClick={() => {
                        void resolveApproval(item.approvalId, 'deny')
                      }}
                      type="button"
                    >
                      {t('拒绝', '拒否')}
                    </button>
                  </span>
                  {approvalError?.approvalId === item.approvalId && resolvingApprovalId === null ? (
                    <small aria-live="polite" className="review-center-approval-error">
                      {approvalError.message}
                    </small>
                  ) : null}
                </span>
              </article>
            ) : (
              <button
                aria-label={t(
                  `打开${item.kind === 'task' ? localizedTaskTitle(locale, { id: item.taskId, title: item.title }) : item.title}的详情`,
                  `${item.title}の詳細を開く`
                )}
                className={`review-center-item is-${item.kind}`}
                key={item.id}
                onClick={() => open(item)}
                type="button"
              >
                <span className="review-center-item-icon">
                  <Icon name={item.kind === 'candidate' ? 'users' : item.kind === 'case' ? 'briefcase' : 'tasks'} size={19} />
                </span>
                <span className="review-center-item-copy">
                  <span className="review-center-item-kind">{kindLabel(item.kind, t)}</span>
                  <strong>{item.kind === 'task' ? localizedTaskTitle(locale, { id: item.taskId, title: item.title }) : item.title}</strong>
                  <small>{localizedMainText(locale, item.summary)}</small>
                </span>
                <span className="review-center-item-meta">
                  <time dateTime={item.updatedAt || undefined}>{displayReviewDate(item.updatedAt, locale, t)}</time>
                  <small>{item.metadata}</small>
                </span>
                <span className="review-center-item-action">
                  {t('确认', '確認する')}
                  <Icon name="chevron-right" size={15} />
                </span>
              </button>
            )
          )
        ) : (
          <div className="review-center-empty">
            <span>
              <Icon name="check" size={24} />
            </span>
            <strong>
              {filter === 'all' ? t('没有待确认项', '確認待ちはありません') : t('此类型没有待确认项', 'この種別の確認待ちはありません')}
            </strong>
            <p>{t('需要新审核时，会显示在本机队列中。', '新しいレビューが必要になると、この端末内のキューに表示されます。')}</p>
          </div>
        )}
      </section>

      <footer className="app-footer">
        {t('审核队列由加密本地数据库状态生成 · 不发送到外部', 'レビューキューは暗号化ローカルDBの状態から生成 · 外部送信なし')}
      </footer>
    </main>
  )
}
