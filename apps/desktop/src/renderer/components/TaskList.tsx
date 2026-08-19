import { workTaskStatusLabels, type WorkTask } from '@domain'
import { Icon } from './Icon'
import { localizedTaskTitle, useRendererUiRefresh, useUiLocale, useUiText } from '../i18n'

interface TaskListProps {
  tasks: WorkTask[]
  onSelect(task: WorkTask): void
  onViewAll?(): void
  title?: string
  eyebrow?: string
}

export function TaskList({ tasks, onSelect, onViewAll, title = '進行中の作業', eyebrow = 'ACTIVE WORK' }: TaskListProps) {
  useRendererUiRefresh()
  const locale = useUiLocale()
  const t = useUiText()
  return (
    <section className="task-section">
      <div className="section-heading-row">
        <div>
          <span className="eyebrow">{t(eyebrow)}</span>
          <h2>{t(title)}</h2>
        </div>
        {onViewAll ? <button className="text-action" onClick={onViewAll} type="button">{t('すべて見る')}</button> : null}
      </div>
      <div className="task-list">
        {tasks.length === 0 ? <div className="task-list-empty"><Icon name="tasks" size={20} /><strong>{t('作業はまだありません')}</strong><span>{t('新しい作業から、対象と確認手順を先にプレビューできます。')}</span></div> : null}
        {tasks.map((task) => (
          <button className="task-row" key={task.id} onClick={() => onSelect(task)} type="button">
            <span className={`task-state-dot state-${task.status}`} />
            <span className="task-primary">
              <strong>{localizedTaskTitle(locale, task)}</strong>
              <small>{locale === 'zh-CN' ? `${t(task.typeLabel)} · 证据 ${task.evidenceCount} 项` : `${task.typeLabel} · 証跡 ${task.evidenceCount}件`}</small>
            </span>
            <span className={`task-status status-${task.status}`}>{t(workTaskStatusLabels[task.status])}</span>
            <span className="task-progress">
              <span className="progress-track"><span style={{ width: `${task.progress}%` }} /></span>
              <small>{task.progress}%</small>
            </span>
            <span className="task-updated">{locale === 'zh-CN' ? '更新' : '更新'} {new Date(task.updatedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
            <Icon name="chevron-right" size={18} />
          </button>
        ))}
      </div>
    </section>
  )
}
