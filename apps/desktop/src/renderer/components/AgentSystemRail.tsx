import { Icon, type IconName } from './Icon'
import { useUiLocale } from '../i18n'

interface AgentSystemRailProps {
  onAgent(): void
  onCandidates(): void
  onInterviews(): void
  onCases(): void
  onReviews(): void
  onSettings(): void
}

interface RailItem {
  id: 'agent' | 'candidates' | 'interviews' | 'cases' | 'reviews'
  icon: IconName
  label: string
  onClick(): void
}

export function AgentSystemRail({
  onAgent,
  onCandidates,
  onInterviews,
  onCases,
  onReviews,
  onSettings
}: AgentSystemRailProps) {
  const zh = useUiLocale() === 'zh-CN'
  const items: RailItem[] = [
    { id: 'agent', icon: 'sparkles', label: 'Agent', onClick: onAgent },
    { id: 'candidates', icon: 'users', label: zh ? '候选人' : '候補者', onClick: onCandidates },
    { id: 'interviews', icon: 'clock', label: zh ? '面试' : '面談', onClick: onInterviews },
    { id: 'cases', icon: 'briefcase', label: zh ? '案件' : '案件', onClick: onCases },
    { id: 'reviews', icon: 'shield', label: zh ? '审核' : '確認', onClick: onReviews }
  ]

  return <aside aria-label={zh ? '系统导航' : 'システムナビゲーション'} className="agent-system-rail">
    <strong aria-label="SES" className="agent-system-rail-brand">SES</strong>
    <nav>
      {items.map((item) => <button
        aria-current={item.id === 'agent' ? 'page' : undefined}
        aria-label={item.label}
        className={item.id === 'agent' ? 'is-active' : ''}
        key={item.id}
        onClick={item.onClick}
        title={item.label}
        type="button"
      ><Icon name={item.icon} size={21} /><span>{item.label}</span></button>)}
    </nav>
    <button aria-label={zh ? '设置' : '設定'} className="agent-system-rail-settings" onClick={onSettings} title={zh ? '设置' : '設定'} type="button"><Icon name="settings" size={21} /><span>{zh ? '设置' : '設定'}</span></button>
  </aside>
}
