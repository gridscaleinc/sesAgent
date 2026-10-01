import type { WorkTask, WorkTaskStatus, WorkTaskType } from '@domain'
import { Icon } from './Icon'
import { localizedTaskTitle, useLocaleText } from '../i18n'

type LocaleText = (zh: string, ja: string) => string

export function workTaskStatusLabel(status: WorkTaskStatus, t: LocaleText): string {
  const labels: Record<WorkTaskStatus, string> = {
    awaiting_input: t('等待输入', '入力待ち'),
    planned: t('待开始', '開始待ち'),
    running: t('进行中', '進行中'),
    awaiting_review: t('待确认', '確認待ち'),
    completed: t('已完成', '完了'),
    cancelled: t('已取消', 'キャンセル'),
    failed: t('需处理', '要対応')
  }
  return labels[status]
}

/** Localizes the built-in task type; the persisted `typeLabel` stays the fallback for unknown types. */
export function workTaskTypeLabel(task: Pick<WorkTask, 'type' | 'typeLabel'>, t: LocaleText): string {
  const labels: Record<WorkTaskType, string> = {
    IMPORT_RESUME: t('导入技能表', 'スキルシート取込'),
    CREATE_CASE: t('案件登记', '案件登録'),
    MATCH_CANDIDATES: t('人员搜索', '候補者検索'),
    GENERATE_PROPOSAL: t('准备提案草稿', '提案下書き')
  }
  return labels[task.type] ?? task.typeLabel
}

interface TaskListProps {
  tasks: WorkTask[]
  onSelect(task: WorkTask): void
  onViewAll?(): void
  title?: string
  /** An optional small label above the title; none by default, like the app's other section headings. */
  eyebrow?: string
}

export function TaskList({ tasks, onSelect, onViewAll, title, eyebrow }: TaskListProps) {
  const { locale, t } = useLocaleText()
  return (
    <section className="task-section">
      <div className="section-heading-row">
        <div>
          {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
          <h2>{title ?? t('进行中的任务', '進行中の作業')}</h2>
        </div>
        {onViewAll ? (
          <button className="text-action" onClick={onViewAll} type="button">
            {t('查看全部', 'すべて見る')}
          </button>
        ) : null}
      </div>
      <div className="task-list">
        {tasks.length === 0 ? (
          <div className="task-list-empty">
            <Icon name="tasks" size={20} />
            <strong>{t('暂无任务', '作業はまだありません')}</strong>
            <span>{t('可从新建任务开始，先预览对象与确认步骤。', '新しい作業から、対象と確認手順を先にプレビューできます。')}</span>
          </div>
        ) : null}
        {tasks.map((task) => (
          <button className="task-row" key={task.id} onClick={() => onSelect(task)} type="button">
            <span className={`task-state-dot state-${task.status}`} />
            <span className="task-primary">
              <strong>{localizedTaskTitle(locale, task)}</strong>
              <small>
                {t(
                  `${workTaskTypeLabel(task, t)} · 证据 ${task.evidenceCount} 项`,
                  `${workTaskTypeLabel(task, t)} · 証跡 ${task.evidenceCount}件`
                )}
              </small>
            </span>
            <span className={`task-status status-${task.status}`}>{workTaskStatusLabel(task.status, t)}</span>
            <span className="task-progress">
              <span className="progress-track">
                <span style={{ width: `${task.progress}%` }} />
              </span>
              <small>{task.progress}%</small>
            </span>
            <span className="task-updated">
              {t('更新', '更新')} {new Date(task.updatedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
            </span>
            <Icon name="chevron-right" size={18} />
          </button>
        ))}
      </div>
    </section>
  )
}
