import { useState } from 'react'
import type { WorkTask } from '@domain'
import { localeText, localizedTaskTitle, useUiLocale } from '../i18n'
import { Icon } from './Icon'

export function ResumeImportHistory({
  tasks,
  onSelect,
  onImport
}: {
  tasks: WorkTask[]
  onSelect(task: WorkTask): void
  onImport(): void
}) {
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const t = localeText(zh)
  const [requestedPage, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(tasks.length / 20))
  const page = Math.min(requestedPage, pages)
  const statusLabel = (status: WorkTask['status']) => {
    if (status === 'failed') return t('导入失败 · 查看原因', '取込失敗・理由を確認')
    if (status === 'completed' || status === 'awaiting_review') return t('已导入', '取込済み')
    if (status === 'cancelled') return t('已取消', 'キャンセル済み')
    if (status === 'running') return t('处理中', '処理中')
    if (status === 'awaiting_input') return t('需要补充信息', '追加情報が必要')
    return t('等待开始', '開始待ち')
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
          tasks.slice((page - 1) * 20, page * 20).map((task) => (
            <button className="task-row" type="button" key={task.id} onClick={() => onSelect(task)}>
              <span className="task-primary">
                <strong>{localizedTaskTitle(locale, task)}</strong>
                <small>{new Date(task.updatedAt).toLocaleString(locale)}</small>
              </span>
              <span>{statusLabel(task.status)}</span>
              <Icon name="chevron-right" size={18} />
            </button>
          ))
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
