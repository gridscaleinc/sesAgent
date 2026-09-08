import { useEffect, useState } from 'react'
import { Icon, type IconName } from './Icon'
import type { LocalOperatorProfile } from '@shared'
import { useRendererUiRefresh, useUiLocale, useUiText } from '../i18n'

export type SidebarView =
  | 'business'
  | 'home'
  | 'candidate-management'
  | 'interview-schedule'
  | 'interview-workbench'
  | 'client-interviews'
  | 'entry-prep'
  | 'candidates'
  | 'case-import'
  | 'cases'
  | 'matching'
  | 'agent'
  | 'reviews'
  | 'tasks'
  | 'task'

interface SidebarProps {
  active: SidebarView
  agentEnabled: boolean
  taskCount: number
  caseCount: number
  candidateManagementCount: number
  candidateCount: number
  clientInterviewCount: number
  interviewScheduleCount: number
  interviewDecisionCount: number
  operatorProfile: LocalOperatorProfile
  reviewCount: number
  onBusiness?(): void
  onHome(): void
  onResumeImport(): void
  onCandidateManagement(): void
  onInterviewSchedule(): void
  onInterviewWorkbench(): void
  onClientInterviews(): void
  onEntryPrep(): void
  onCandidates(): void
  onCaseImport(): void
  onCases(): void
  onMatching(): void
  onReviews(): void
  onTasks(): void
  onGovernance(): void
  onSettings(): void
  onOperatorProfile(): void
}

type NavigationItem = {
  id: SidebarView
  label: string
  icon: IconName
  count?: number
  activeWhen?: SidebarView[]
  onClick(): void
}

type NavigationGroup = {
  id: 'talent' | 'interviews' | 'cases'
  label: string
  icon: IconName
  items: NavigationItem[]
}

export function Sidebar({
  active,
  agentEnabled,
  taskCount,
  caseCount,
  candidateManagementCount,
  candidateCount,
  clientInterviewCount,
  interviewScheduleCount,
  interviewDecisionCount,
  operatorProfile,
  reviewCount,
  onBusiness,
  onHome,
  onResumeImport,
  onCandidateManagement,
  onInterviewSchedule,
  onInterviewWorkbench,
  onClientInterviews,
  onEntryPrep,
  onCandidates,
  onCaseImport,
  onCases,
  onMatching,
  onReviews,
  onTasks,
  onGovernance,
  onSettings,
  onOperatorProfile
}: SidebarProps) {
  useRendererUiRefresh()
  const t = useUiText()
  const zh = useUiLocale() === 'zh-CN'
  const operatorDisplayName = operatorProfile.configured ? operatorProfile.displayName : t('本機ユーザー')
  const operatorRoleLabel = operatorProfile.configured ? operatorProfile.roleLabel : t('プロフィール未設定')
  const operatorInitial = [...operatorDisplayName.trim()][0] ?? '本'
  const groupForActive = active === 'candidate-management' || active === 'candidates'
    ? 'talent'
    : ['interview-schedule', 'interview-workbench', 'client-interviews', 'entry-prep'].includes(active)
      ? 'interviews'
      : active === 'case-import' || active === 'cases' ? 'cases' : null
  const [expanded, setExpanded] = useState<Set<NavigationGroup['id']>>(() => new Set(groupForActive ? [groupForActive as NavigationGroup['id']] : ['talent']))
  const agentActive = active === 'matching' || active === 'agent'

  useEffect(() => {
    if (!groupForActive) return
    setExpanded((current) => {
      if (current.has(groupForActive as NavigationGroup['id'])) return current
      return new Set([...current, groupForActive as NavigationGroup['id']])
    })
  }, [groupForActive])

  const groups: NavigationGroup[] = [
    {
      id: 'talent', label: zh ? '人才管理' : '人材管理', icon: 'users', items: [
        { id: 'candidate-management', label: zh ? '候选人' : '候補者', icon: 'users', count: candidateManagementCount, onClick: onCandidateManagement },
        { id: 'candidates', label: zh ? '人才池' : '人材プール', icon: 'database', count: candidateCount, onClick: onCandidates }
      ]
    },
    {
      id: 'interviews', label: zh ? '面试管理' : '面談管理', icon: 'clock', items: [
        { id: 'interview-workbench', label: zh ? '招聘面试' : '採用面談', icon: 'users', count: interviewDecisionCount, onClick: onInterviewWorkbench },
        { id: 'client-interviews', label: zh ? '客户面试' : '顧客面談', icon: 'briefcase', count: clientInterviewCount, onClick: onClientInterviews },
        { id: 'interview-schedule', label: zh ? '面试日程' : '面談日程', icon: 'clock', count: interviewScheduleCount, onClick: onInterviewSchedule },
        { id: 'entry-prep', label: zh ? '入场准备' : '参画準備', icon: 'check', onClick: onEntryPrep }
      ]
    },
    {
      id: 'cases', label: zh ? '案件管理' : '案件管理', icon: 'briefcase', items: [
        { id: 'case-import', label: zh ? '案件导入' : '案件取込', icon: 'mail', onClick: onCaseImport },
        { id: 'cases', label: zh ? '案件库' : '案件DB', icon: 'briefcase', count: caseCount, onClick: onCases }
      ]
    }
  ]

  const toggleGroup = (id: NavigationGroup['id']) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return <aside className="sidebar">
    <div className="brand-row"><span className="brand-mark">S</span><div><strong>SESAI</strong><span>Agent Desktop</span></div></div>
    <button
      aria-current={agentEnabled && agentActive ? 'page' : undefined}
      className={`primary-new-task${agentEnabled ? ' is-agent-workspace' : ''}${agentEnabled && agentActive ? ' is-active' : ''}`}
      onClick={agentEnabled ? onMatching : onResumeImport}
      type="button"
    >
      <Icon name={agentEnabled ? 'sparkles' : 'upload'} size={18} />
      {agentEnabled ? 'SES Agent' : (zh ? '快速导入简历' : '履歴書をすぐ取込')}
    </button>

    <nav aria-label={t('メインナビゲーション')} className="sidebar-nav sidebar-tree-nav">
      {onBusiness ? <button aria-current={active === 'business' ? 'page' : undefined} className={active === 'business' ? 'nav-item is-active' : 'nav-item'} onClick={onBusiness} type="button"><Icon name="upload" size={18} /><span>{zh ? '信息整理与推广' : '情報整理・紹介'}</span></button> : null}
      <button aria-current={active === 'home' ? 'page' : undefined} className={active === 'home' ? 'nav-item is-active' : 'nav-item'} onClick={onHome} type="button"><Icon name="home" size={18} /><span>{agentEnabled ? (zh ? '业务概览' : '業務概要') : (zh ? '工作台' : 'ワークベンチ')}</span></button>
      {groups.map((group) => {
        const open = expanded.has(group.id)
        const containsActive = group.items.some((item) => (item.activeWhen ?? [item.id]).includes(active))
        return <section className={open ? 'sidebar-tree-group is-open' : 'sidebar-tree-group'} key={group.id}>
          <button aria-expanded={open} className={containsActive ? 'sidebar-tree-trigger contains-active' : 'sidebar-tree-trigger'} onClick={() => toggleGroup(group.id)} type="button"><Icon name={group.icon} size={18} /><span>{group.label}</span><Icon className="sidebar-tree-chevron" name="chevron-right" size={15} /></button>
          {open ? <div className="sidebar-tree-children">{group.items.map((item) => {
            const selected = (item.activeWhen ?? [item.id]).includes(active)
            return <button aria-current={selected ? 'page' : undefined} className={selected ? 'nav-item is-active' : 'nav-item'} key={item.id} onClick={item.onClick} type="button"><Icon name={item.icon} size={16} /><span>{item.label}</span>{typeof item.count === 'number' && item.count > 0 ? <span className="nav-count">{item.count}</span> : null}</button>
          })}</div> : null}
        </section>
      })}
      <p className="nav-label nav-label-spaced">{zh ? 'AI 与审核' : 'AI と確認'}</p>
      {!agentEnabled ? <button aria-current={agentActive ? 'page' : undefined} className={agentActive ? 'nav-item is-active' : 'nav-item'} onClick={onMatching} type="button"><Icon name="sparkles" size={18} /><span>{zh ? 'AI 匹配' : 'AI マッチング'}</span></button> : null}
      <button aria-current={active === 'reviews' ? 'page' : undefined} className={active === 'reviews' ? 'nav-item is-active' : 'nav-item'} onClick={onReviews} type="button"><Icon name="shield" size={18} /><span>{zh ? '审核中心' : 'レビューセンター'}</span>{reviewCount > 0 ? <span className="nav-count">{reviewCount}</span> : null}</button>
    </nav>

    <div className="sidebar-footer">
      <div className="environment-pill"><span className="environment-pulse" />{t('開発ビルド')}</div>
      <button aria-current={active === 'tasks' || active === 'task' ? 'page' : undefined} className={active === 'tasks' || active === 'task' ? 'application-settings-trigger is-active' : 'application-settings-trigger'} onClick={onTasks} type="button"><Icon name="tasks" size={16} /><span>{zh ? '活动记录' : 'アクティビティ'}</span>{taskCount > 0 ? <span className="footer-count">{taskCount}</span> : null}</button>
      <button className="application-settings-trigger" onClick={onGovernance} type="button"><Icon name="lock" size={16} /><span>{zh ? '数据安全' : 'データセキュリティ'}</span></button>
      <button className="application-settings-trigger" onClick={onSettings} title={t('システム設定を開く')} type="button"><Icon name="settings" size={16} /><span>{zh ? '设置' : '設定'}</span></button>
      <button className={operatorProfile.configured ? 'profile-button' : 'profile-button needs-setup'} onClick={onOperatorProfile} title={t('本機内の操作員プロフィールを設定')} type="button"><span className="avatar">{operatorInitial}</span><span><strong>{operatorDisplayName}</strong><small>{operatorRoleLabel}</small></span><Icon name="settings" size={17} /></button>
    </div>
  </aside>
}
