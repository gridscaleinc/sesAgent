import { Icon } from './Icon'
import { localeText, useUiLocale } from '../i18n'

interface AgentSystemRailProps {
  /** 今天, the first item: the day's overview. */
  todayActive?: boolean
  onToday?(): void
  /** 今天要跟进; the badge is withheld at zero. */
  todayCount?: number
  followActive?: boolean
  onFollowUps?(): void
  businessKind: 'case' | 'person'
  onBusinessCases(): void
  onBusinessPeople(): void
  /** Unread 新着案件; the badge is withheld at zero rather than showing "0". */
  caseUnseenCount?: number
  onAgent(): void
  onSettings(): void
  /** Opens the business command palette; shown as the 「⌘K 命令」 hint above settings. */
  onCommandPalette?(): void
}

const commandKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl '

export function AgentSystemRail({
  todayActive = false,
  onToday,
  todayCount = 0,
  businessKind,
  onBusinessCases,
  onBusinessPeople,
  followActive,
  onFollowUps,
  caseUnseenCount = 0,
  onAgent,
  onSettings,
  onCommandPalette
}: AgentSystemRailProps) {
  const zh = useUiLocale() === 'zh-CN'
  const t = localeText(zh)
  // While 今天 is the page, no business section is current.
  const caseActive = businessKind === 'case' && !followActive && !todayActive
  const personActive = businessKind === 'person' && !followActive && !todayActive
  const followCurrent = Boolean(followActive) && !todayActive
  // ⌘1… follow the rail order: 今天, 案件, 人员, 跟进, Agent.
  const railCount = 2 + (onToday ? 1 : 0) + (onFollowUps ? 1 : 0) + 1

  return (
    <aside aria-label={t('系统导航', 'システムナビゲーション')} className="agent-system-rail">
      <strong aria-label="SES" className="agent-system-rail-brand">
        SES
      </strong>
      <nav className="hr-business-nav">
        {onToday ? (
          <button
            type="button"
            aria-current={todayActive ? 'page' : undefined}
            className={todayActive ? 'is-active' : ''}
            onClick={onToday}
          >
            <Icon name="home" size={21} />
            <span>{t('今天', '今日')}</span>
            {todayCount > 0 ? (
              <span aria-label={t(`${todayCount} 件今天要跟进`, `今日の対応 ${todayCount} 件`)} className="agent-system-rail-badge">
                {todayCount}
              </span>
            ) : null}
          </button>
        ) : null}
        <button
          type="button"
          aria-current={caseActive ? 'page' : undefined}
          className={caseActive ? 'is-active' : ''}
          onClick={onBusinessCases}
        >
          <Icon name="briefcase" size={21} />
          <span>{t('案件', '案件')}</span>
          {caseUnseenCount > 0 ? (
            <span aria-label={t(`${caseUnseenCount} 件未读`, `未読 ${caseUnseenCount} 件`)} className="agent-system-rail-badge">
              {caseUnseenCount}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          aria-current={personActive ? 'page' : undefined}
          className={personActive ? 'is-active' : ''}
          onClick={onBusinessPeople}
        >
          <Icon name="users" size={21} />
          <span>{t('人员', '要員')}</span>
        </button>
        {onFollowUps ? (
          <button
            type="button"
            aria-current={followCurrent ? 'page' : undefined}
            className={followCurrent ? 'is-active' : ''}
            onClick={onFollowUps}
          >
            <Icon name="clock" size={21} />
            <span>{t('跟进', '対応記録')}</span>
          </button>
        ) : null}
        <button type="button" onClick={onAgent}>
          <Icon name="sparkles" size={21} />
          <span>Agent</span>
        </button>
      </nav>
      {onCommandPalette ? (
        <button
          aria-keyshortcuts="Meta+K Control+K"
          aria-label={t('命令', 'コマンド')}
          className="agent-system-rail-command"
          onClick={onCommandPalette}
          title={t(
            `命令（${commandKey}K；${commandKey}1–${railCount} 切换）`,
            `コマンド（${commandKey}K、${commandKey}1–${railCount} で切替）`
          )}
          type="button"
        >
          <kbd>{commandKey}K</kbd>
          <span>{t('命令', 'コマンド')}</span>
        </button>
      ) : null}
      <button
        aria-label={t('设置', '設定')}
        className="agent-system-rail-settings"
        onClick={onSettings}
        title={t('设置', '設定')}
        type="button"
      >
        <Icon name="settings" size={21} />
        <span>{t('设置', '設定')}</span>
      </button>
    </aside>
  )
}
