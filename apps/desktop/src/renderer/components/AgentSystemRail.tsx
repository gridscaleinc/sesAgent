import { Icon, type IconName } from './Icon'
import { useUiLocale } from '../i18n'

interface AgentSystemRailProps {
  /** Unread 新着案件; the badge is withheld at zero rather than showing "0". */
  caseUnseenCount?: number
  onBusiness?(): void
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
  badge?: number
  onClick(): void
}

export function AgentSystemRail({
  caseUnseenCount = 0,
  onBusiness,
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
    { id: 'cases', icon: 'briefcase', label: zh ? '案件' : '案件', badge: caseUnseenCount, onClick: onCases },
    { id: 'reviews', icon: 'shield', label: zh ? '审核' : '確認', onClick: onReviews }
  ]

  return <aside aria-label={zh ? '系统导航' : 'システムナビゲーション'} className="agent-system-rail">
    <strong aria-label="SES" className="agent-system-rail-brand">SES</strong>
    <nav>
      {onBusiness ? <button aria-label={zh ? '信息整理与推广' : '情報整理・紹介'} onClick={onBusiness} type="button"><Icon name="upload" size={21} /><span>{zh ? '整理' : '整理'}</span></button> : null}
      {items.map((item) => <button
        aria-current={item.id === 'agent' ? 'page' : undefined}
        aria-label={item.label}
        className={item.id === 'agent' ? 'is-active' : ''}
        key={item.id}
        onClick={item.onClick}
        title={item.label}
        type="button"
      ><Icon name={item.icon} size={21} /><span>{item.label}</span>{item.badge && item.badge > 0 ? <span aria-label={zh ? `${item.badge} 件未读` : `未読 ${item.badge} 件`} className="agent-system-rail-badge">{item.badge}</span> : null}</button>)}
    </nav>
    <button aria-label={zh ? '设置' : '設定'} className="agent-system-rail-settings" onClick={onSettings} title={zh ? '设置' : '設定'} type="button"><Icon name="settings" size={21} /><span>{zh ? '设置' : '設定'}</span></button>
  </aside>
}
