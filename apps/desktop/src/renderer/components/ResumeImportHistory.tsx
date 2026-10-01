import { useMemo, useState } from 'react'
import type { WorkTask } from '@domain'
import type { CandidateReviewSnapshot } from '@shared'
import { localeText, useUiLocale } from '../i18n'
import { Icon } from './Icon'
import { formatTokyoDateTime } from '../format-time'

/** A planned import untouched this long was left before analysis started; opening it resumes the import. */
const stalledAfterMs = 30 * 60_000

/** Staged-file tokens double as the imported person's document id. */
function stagedFileIds(task: WorkTask): string[] {
  return task.contextBindings.filter((binding) => binding.objectType === 'staged-file').map((binding) => binding.objectId)
}

export function ResumeImportHistory({
  tasks,
  reviews = [],
  onSelect,
  onImport
}: {
  tasks: WorkTask[]
  reviews?: CandidateReviewSnapshot[]
  onSelect(task: WorkTask): void
  onImport(): void
}) {
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const t = localeText(zh)
  const [requestedPage, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(tasks.length / 20))
  const page = Math.min(requestedPage, pages)
  const reviewById = useMemo(() => new Map(reviews.map((review) => [review.documentId, review])), [reviews])
  const now = Date.now()
  // The task title is a fixed system sentence; name the imported people or files instead.
  const title = (task: WorkTask) => {
    const ids = stagedFileIds(task)
    const names = ids
      .map((id) => reviewById.get(id))
      .filter((review): review is CandidateReviewSnapshot => Boolean(review))
      .map((review) => review.localIdentity?.displayName ?? review.fileName)
    if (names.length === 0) return t(`简历导入 · ${ids.length} 份`, `履歴書の取込・${ids.length}件`)
    const shown = names.slice(0, 3).join('、')
    return ids.length > 3 ? t(`${shown} 等 ${ids.length} 份`, `${shown} ほか${ids.length}件`) : shown
  }
  const status = (task: WorkTask): { label: string; tone: string } => {
    if (task.status === 'failed') return { label: t('导入失败 · 查看原因', '取込失敗・理由を確認'), tone: 'is-failed' }
    if (task.status === 'completed' || task.status === 'awaiting_review') return { label: t('已导入', '取込済み'), tone: '' }
    if (task.status === 'cancelled') return { label: t('已取消', 'キャンセル済み'), tone: 'is-waiting' }
    if (task.status === 'running') return { label: t('处理中', '処理中'), tone: '' }
    if (task.status === 'awaiting_input') return { label: t('需要补充信息', '追加情報が必要'), tone: '' }
    if (now - Date.parse(task.updatedAt) > stalledAfterMs)
      return { label: t('未完成 · 打开继续导入', '未完了・開くと取込を再開'), tone: 'is-stalled' }
    return { label: t('等待开始', '開始待ち'), tone: 'is-waiting' }
  }

  return (
    <main className="task-center-page hr-import-history">
      <header className="task-center-header">
        <div>
          <h1>{t('人员导入记录', '要員の取込履歴')}</h1>
          <p>
            {t('查看简历导入结果；失败的记录可打开查看原因。', '履歴書の取込結果を確認できます。失敗した記録を開くと理由を確認できます。')}
          </p>
        </div>
        <button type="button" onClick={onImport}>
          {t('导入简历', '履歴書を取り込む')}
        </button>
      </header>
      <section className="task-list" aria-label={t('人员导入记录', '要員の取込履歴')}>
        {tasks.length === 0 ? (
          <p>{t('暂无简历导入记录', '履歴書の取込記録はありません')}</p>
        ) : (
          tasks.slice((page - 1) * 20, page * 20).map((task) => {
            const current = status(task)
            return (
              <button className="task-row" type="button" key={task.id} onClick={() => onSelect(task)}>
                <span className="task-primary">
                  <strong>{title(task)}</strong>
                  <small>{formatTokyoDateTime(locale, task.updatedAt)}</small>
                </span>
                <span className={current.tone || undefined}>{current.label}</span>
                <Icon name="chevron-right" size={18} />
              </button>
            )
          })
        )}
      </section>
      {pages > 1 ? (
        <nav className="hr-pagination" aria-label={t('导入记录分页', '取込履歴のページ切替')}>
          <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>
            {t('上一页', '前へ')}
          </button>
          <span>
            {page} / {pages}
          </span>
          <button type="button" disabled={page === pages} onClick={() => setPage(page + 1)}>
            {t('下一页', '次へ')}
          </button>
        </nav>
      ) : null}
    </main>
  )
}
