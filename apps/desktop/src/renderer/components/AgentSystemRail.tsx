import { Icon } from './Icon'
import { localeText, useUiLocale } from '../i18n'

interface AgentSystemRailProps {
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

  return (
    <aside aria-label={t('系统导航', 'システムナビゲーション')} className="agent-system-rail">
      <strong aria-label="SES" className="agent-system-rail-brand">
        SES
      </strong>
      <nav className="hr-business-nav">
        <button
          type="button"
          aria-current={businessKind === 'case' && !followActive ? 'page' : undefined}
          className={businessKind === 'case' && !followActive ? 'is-active' : ''}
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
          aria-current={businessKind === 'person' && !followActive ? 'page' : undefined}
          className={businessKind === 'person' && !followActive ? 'is-active' : ''}
          onClick={onBusinessPeople}
        >
          <Icon name="users" size={21} />
          <span>{t('人员', '要員')}</span>
        </button>
        {onFollowUps ? (
          <button
            type="button"
            aria-current={followActive ? 'page' : undefined}
            className={followActive ? 'is-active' : ''}
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
          title={t(`命令（${commandKey}K；${commandKey}1–4 切换）`, `コマンド（${commandKey}K、${commandKey}1–4 で切替）`)}
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
