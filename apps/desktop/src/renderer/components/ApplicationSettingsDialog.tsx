import { SystemExperiencePanel } from './SystemExperiencePanel'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type {
  SaveJobCaseFieldAliasesInput,
  JobCaseFieldKey,
  JobCaseFieldAliases,
  JobCaseFieldAliasMap,
  ApplicationLocale,
  BootstrapPayload,
  LocalApplicationPreferences,
  MenuBarPreferences,
  SaveLocalApplicationPreferencesInput,
  TestAiModelResult
} from '@shared'
import { jobCaseFieldCanonicalLabels, jobCaseFieldKeys } from '@shared'
import { BroadcastSettingsSection, type BroadcastSettingsActions } from './BroadcastSettingsSection'
import { AiModelSettingsSection } from './AiModelSettingsSection'
import { Icon, type IconName } from './Icon'
import { GmailSyncFeedback } from './GmailSyncFeedback'
import { localizedIpcError, useLocaleText, localizedJobCaseFieldLabel } from '../i18n'

export type ApplicationSettingsSection = 'experience' | 'general' | 'models' | 'fields' | 'broadcast' | 'integrations' | 'privacy'

interface ApplicationSettingsDialogProps {
  bootstrap: BootstrapPayload
  initialSection?: ApplicationSettingsSection
  /** Changes on each request to show initialSection, so asking again for the same section while open still goes there. */
  sectionRequest?: number
  preferences: LocalApplicationPreferences
  onClose(): void
  onConnectGoogleWorkspace(): Promise<void>
  onDisconnectGoogleWorkspace(): Promise<void>
  onOpenAiCommerce(): void
  onOpenDataSecurity(): void
  onOpenOperatorProfile(): void
  onOpenZoomTestMeeting?(): Promise<unknown>
  onSave(input: SaveLocalApplicationPreferencesInput): Promise<LocalApplicationPreferences>
  /** Sends a tiny fixed prompt to one catalog model; absent, the 测试模型 buttons are disabled. */
  onTestAiModel?(modelKey: string): Promise<TestAiModelResult>
  onSyncGoogleWorkspace(): Promise<void>
  fieldAliases?: JobCaseFieldAliases
  onSaveFieldAliases?(input: SaveJobCaseFieldAliasesInput): Promise<JobCaseFieldAliases>
  /** Present once 案件配信 is reachable; the 配信 area is hidden without it. */
  broadcastActions?: BroadcastSettingsActions
}

const aliasSeparatorPattern = /[、,，;；\r\n]+/u

function aliasDraftsFrom(aliases: JobCaseFieldAliases | undefined): Record<JobCaseFieldKey, string> {
  return Object.fromEntries(jobCaseFieldKeys.map((key) => [key, (aliases?.aliases[key] ?? []).join('、')])) as Record<
    JobCaseFieldKey,
    string
  >
}

function aliasMapFrom(drafts: Record<JobCaseFieldKey, string>): JobCaseFieldAliasMap {
  const map: JobCaseFieldAliasMap = {}
  for (const key of jobCaseFieldKeys) {
    const values = [
      ...new Set(
        drafts[key]
          .split(aliasSeparatorPattern)
          .map((value) => value.trim())
          .filter(Boolean)
      )
    ]
    if (values.length > 0) map[key] = values
  }
  return map
}

type LocaleText = (cn: string, ja: string) => string

function languageOptions(t: LocaleText): Array<{ locale: ApplicationLocale; name: string; nativeName: string; detail: string }> {
  return [
    {
      locale: 'ja-JP',
      name: t('日文', '日本語'),
      nativeName: t('日文（日本）', '日本語（日本）'),
      detail: t('使用日文显示界面。', '日本語で画面を表示します。')
    },
    // i18n-ignore: each language option names and describes itself in its own language
    { locale: 'zh-CN', name: '中文（简体）', nativeName: '中文（简体，中国）', detail: '界面会立即切换为简体中文。' }
  ]
}

function settingsSections(t: LocaleText): Array<{ id: ApplicationSettingsSection; label: string; detail: string; icon: IconName }> {
  return [
    { id: 'general', label: t('常规设置', '一般設定'), detail: t('语言与本机用户', '言語と本機ユーザー'), icon: 'settings' },
    {
      id: 'models',
      label: t('AI 模型', 'AIモデル'),
      detail: t('批量核对与文案分析', '一括確認と文章・分析'),
      icon: 'sparkles'
    },
    { id: 'experience', label: t('系统经验', 'システムの経験'), detail: t('自动学习与核实方法', '自動学習と確認方法'), icon: 'sparkles' },
    { id: 'fields', label: t('案件字段', '案件項目'), detail: t('字段别名', '項目の別名'), icon: 'briefcase' },
    { id: 'broadcast', label: t('群发', '配信'), detail: t('文案模板', '紹介文テンプレート'), icon: 'mail' },
    { id: 'integrations', label: t('外部系统', '外部システム'), detail: t('连接、权限与同步', '接続・権限・同期'), icon: 'mail' },
    {
      id: 'privacy',
      label: t('数据与隐私', 'データとプライバシー'),
      detail: t('脱敏、本地 AI 与加密', '脱敏・Local AI・暗号化'),
      icon: 'shield'
    }
  ]
}

export function ApplicationSettingsDialog({
  bootstrap,
  initialSection = 'general',
  sectionRequest,
  preferences,
  onClose,
  onConnectGoogleWorkspace,
  onDisconnectGoogleWorkspace,
  onOpenAiCommerce,
  onOpenDataSecurity,
  onOpenOperatorProfile,
  onOpenZoomTestMeeting,
  onSave,
  onTestAiModel,
  onSyncGoogleWorkspace,
  fieldAliases,
  onSaveFieldAliases,
  broadcastActions
}: ApplicationSettingsDialogProps) {
  const { locale, zh, t } = useLocaleText()
  const dialogRef = useRef<HTMLElement | null>(null)
  const openerRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const [activeSection, setActiveSection] = useState<ApplicationSettingsSection>(initialSection)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aliasDrafts, setAliasDrafts] = useState<Record<JobCaseFieldKey, string>>(() => aliasDraftsFrom(fieldAliases))
  const [aliasError, setAliasError] = useState<string | null>(null)
  const [aliasSaved, setAliasSaved] = useState(false)
  const aliasDirty = JSON.stringify(aliasMapFrom(aliasDrafts)) !== JSON.stringify(fieldAliases?.aliases ?? {})
  const saveAliases = async () => {
    if (!onSaveFieldAliases || busy !== null) return
    setBusy('aliases')
    setAliasError(null)
    setAliasSaved(false)
    try {
      const saved = await onSaveFieldAliases({ aliases: aliasMapFrom(aliasDrafts), expectedRevision: fieldAliases?.revision ?? null })
      setAliasDrafts(aliasDraftsFrom(saved))
      setAliasSaved(true)
    } catch (cause) {
      setAliasError(localizedIpcError(locale, cause, t('案件字段别名保存失败。', '案件項目の別名を保存できませんでした。')))
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => setActiveSection(initialSection), [initialSection, sectionRequest])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('[data-initial-focus="true"]')?.focus()
    })
    return () => {
      cancelAnimationFrame(frame)
      const opener = openerRef.current
      requestAnimationFrame(() => opener?.isConnected && opener.focus())
    }
  }, [])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && busy === null) {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      ) ?? [])
    ].filter((element) => element.offsetParent !== null)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const menuBar = preferences.menuBar ?? { visible: true, showPersonNames: false }
  const saveMenuBar = async (next: MenuBarPreferences) => {
    if (busy) return
    setBusy('menu-bar')
    setError(null)
    try {
      await onSave({ locale: preferences.locale, expectedRevision: preferences.revision, menuBar: next })
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法保存菜单栏设置。', 'メニューバーの設定を保存できませんでした。')))
    } finally {
      setBusy(null)
    }
  }

  const saveLocale = async (locale: ApplicationLocale) => {
    if (busy || locale === preferences.locale) return
    setBusy('locale')
    setError(null)
    try {
      await onSave({ locale, expectedRevision: preferences.revision })
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法保存显示设置。', '表示設定を保存できませんでした。')))
    } finally {
      setBusy(null)
    }
  }

  const runIntegrationAction = async (id: string, action: () => Promise<void>) => {
    if (busy) return
    setBusy(id)
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法更新外部系统连接。', '外部システムの接続を更新できませんでした。')))
    } finally {
      setBusy(null)
    }
  }

  const googleConnected = bootstrap.gmail.status === 'readonly'
  const googleConfigured = bootstrap.gmail.configuration === 'ready' && bootstrap.gmailSync.configuration === 'ready'
  const googleStatus = googleConnected
    ? t('已只读连接', '読取専用で接続済み')
    : googleConfigured
      ? t('等待连接', '接続待ち')
      : t('此版本尚未配置', 'このビルドでは未設定')
  const aiCommerceConnected = bootstrap.aiCommerce.connection === 'connected'

  return (
    <div className="application-settings-backdrop" role="presentation">
      <section
        aria-labelledby="application-settings-title"
        aria-modal="true"
        className="application-settings-dialog"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <div>
            <span>APPLICATION SETTINGS</span>
            <h2 id="application-settings-title">{t('设置', '設定')}</h2>
            <p>{t('在一个位置管理显示、外部系统和数据保护。', '表示、外部システム、データ保護を一つの場所で管理します。')}</p>
          </div>
          <button aria-label={t('关闭设置', '設定を閉じる')} disabled={busy !== null} onClick={onClose} type="button">
            ×
          </button>
        </header>

        <div className="application-settings-layout">
          <nav aria-label={t('设置类别', '設定カテゴリ')} className="application-settings-nav">
            {settingsSections(t)
              .filter((section) => section.id !== 'broadcast' || broadcastActions)
              .map((section, index) => (
                <button
                  aria-current={activeSection === section.id ? 'page' : undefined}
                  className={activeSection === section.id ? 'is-active' : ''}
                  data-initial-focus={index === 0 ? 'true' : undefined}
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  type="button"
                >
                  <Icon name={section.icon} size={17} />
                  <span>
                    <strong>{section.label}</strong>
                    <small>{section.detail}</small>
                  </span>
                  <Icon name="chevron-right" size={14} />
                </button>
              ))}
          </nav>

          <div className="application-settings-content" tabIndex={-1}>
            <div hidden={activeSection !== 'experience'}>
              <SystemExperiencePanel active={activeSection === 'experience'} />
            </div>
            {activeSection === 'general' ? (
              <section aria-labelledby="general-settings-title" className="settings-section">
                <div className="settings-section-heading">
                  <span>GENERAL</span>
                  <h3 id="general-settings-title">{t('常规设置', '一般設定')}</h3>
                  <p>{t('设置本机使用的显示语言和用户信息。', 'この端末で使用する表示言語とユーザー情報を設定します。')}</p>
                </div>
                <section aria-label={t('显示语言', '表示言語')} className="language-choice-group" role="radiogroup">
                  <div className="language-choice-heading">
                    <Icon name="settings" size={16} />
                    <span>{t('显示语言', '表示言語')}</span>
                  </div>
                  {languageOptions(t).map((option) => {
                    const selected = preferences.locale === option.locale
                    return (
                      <button
                        aria-checked={selected}
                        className={selected ? 'language-choice is-selected' : 'language-choice'}
                        disabled={busy !== null}
                        key={option.locale}
                        onClick={() => void saveLocale(option.locale)}
                        role="radio"
                        type="button"
                      >
                        <span className="language-choice-radio" aria-hidden="true" />
                        <span>
                          <strong>{option.name}</strong>
                          <small>{option.nativeName}</small>
                          <em>{option.detail}</em>
                        </span>
                        {selected ? <Icon name="check" size={17} /> : null}
                      </button>
                    )
                  })}
                </section>
                <section aria-labelledby="menu-bar-settings-title" className="settings-toggle-group">
                  <div className="language-choice-heading">
                    <Icon name="clock" size={16} />
                    <span id="menu-bar-settings-title">{t('菜单栏', 'メニューバー')}</span>
                  </div>
                  {[
                    {
                      key: 'visible' as const,
                      label: t('在菜单栏显示 SES Agent', 'メニューバーに SES Agent を表示'),
                      detail: t(
                        '点击图标查看今天要跟进的事项；Windows 上显示在任务栏通知区域。',
                        'アイコンから今日の対応を確認できます。Windows ではタスクバーの通知領域に表示します。'
                      )
                    },
                    {
                      key: 'showPersonNames' as const,
                      label: t('菜单栏面板显示人员姓名', 'メニューバーのパネルに要員の氏名を表示'),
                      detail: t(
                        '关闭时只显示案件名和「1 名人员」，避免他人看到屏幕时泄露姓名。',
                        'オフの間は案件名と「要員 1 名」だけを表示し、画面をのぞかれても氏名は出ません。'
                      )
                    }
                  ].map((option) => (
                    <label className="settings-toggle" key={option.key}>
                      <input
                        checked={menuBar[option.key]}
                        disabled={busy !== null}
                        onChange={(event) => void saveMenuBar({ ...menuBar, [option.key]: event.target.checked })}
                        type="checkbox"
                      />
                      <span>
                        <strong>{option.label}</strong>
                        <small>{option.detail}</small>
                      </span>
                    </label>
                  ))}
                </section>
                <button className="settings-link-card" onClick={onOpenOperatorProfile} type="button">
                  <span className="settings-link-icon">
                    <Icon name="users" size={18} />
                  </span>
                  <span>
                    <strong>{t('本机用户档案', '本機ユーザープロフィール')}</strong>
                    <small>
                      {bootstrap.operatorProfile.configured
                        ? `${bootstrap.operatorProfile.displayName} · ${bootstrap.operatorProfile.roleLabel}`
                        : t('设置显示名称和负责角色。', '表示名と担当ロールを設定します。')}
                    </small>
                  </span>
                  <Icon name="chevron-right" size={16} />
                </button>
                <div className="application-settings-policy">
                  <Icon name="lock" size={16} />
                  <span>
                    <strong>{t('仅保存在此设备', 'この端末だけに保存')}</strong>
                    {t(
                      '语言和用户设置保存在加密本地数据库中，不会发送至外部系统。',
                      '言語とユーザー設定は暗号化ローカルDBに保存され、外部システムへ送信されません。'
                    )}
                  </span>
                </div>
              </section>
            ) : null}

            {activeSection === 'models' ? (
              <AiModelSettingsSection
                disabled={busy !== null}
                models={
                  bootstrap.agentChatModels?.length ? bootstrap.agentChatModels : [{ key: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna' }]
                }
                onOpenAiCommerce={onOpenAiCommerce}
                onSave={onSave}
                onTestAiModel={onTestAiModel}
                preferences={preferences}
              />
            ) : null}

            {activeSection === 'fields' ? (
              <section aria-labelledby="field-settings-title" className="settings-section">
                <div className="settings-section-heading">
                  <span>CASE FIELDS</span>
                  <h3 id="field-settings-title">{t('案件字段别名', '案件項目の別名')}</h3>
                  <p>
                    {t(
                      '把合作方各自的写法（单金、稼働开始等）对应到既定案件字段。粘贴时的分类、本机字段抽取、云端抽取指令使用同一套别名。',
                      '取引先ごとに異なるラベル（単金、稼働開始など）を既定の案件項目に対応付けます。貼り付け時の分類、端末内の項目抽出、クラウド抽出への指示が同じ別名を使います。'
                    )}
                  </p>
                </div>
                <div className="settings-alias-grid">
                  {jobCaseFieldKeys.map((key) => (
                    <label className="settings-alias-row" key={key}>
                      <span>
                        <strong>{localizedJobCaseFieldLabel(locale, key)}</strong>
                        <small>{key}</small>
                      </span>
                      <input
                        aria-label={t(`${localizedJobCaseFieldLabel(locale, key)}的别名`, `${jobCaseFieldCanonicalLabels[key]}の別名`)}
                        disabled={busy !== null || !onSaveFieldAliases}
                        onChange={(event) => {
                          setAliasSaved(false)
                          setAliasDrafts({ ...aliasDrafts, [key]: event.target.value })
                        }}
                        placeholder={t('多个别名用「、」分隔', '別名を「、」で区切って入力')}
                        value={aliasDrafts[key]}
                      />
                    </label>
                  ))}
                </div>
                {aliasError ? (
                  <p className="settings-inline-error" role="alert">
                    {aliasError}
                  </p>
                ) : null}
                <div className="settings-alias-actions">
                  <button
                    className="is-primary"
                    disabled={busy !== null || !aliasDirty || !onSaveFieldAliases}
                    onClick={() => void saveAliases()}
                    type="button"
                  >
                    {busy === 'aliases' ? t('保存中…', '保存中…') : t('保存别名', '別名を保存')}
                  </button>
                  {aliasSaved ? <small>{t('已保存', '保存しました')}</small> : null}
                </div>
                <div className="application-settings-policy">
                  <Icon name="lock" size={16} />
                  <span>
                    <strong>{t('仅保存在此设备', 'この端末だけに保存')}</strong>
                    {t(
                      '别名保存在加密的本机数据库。云端只收到字段名的对应关系作为指令，不会收到案件正文。',
                      '別名は暗号化ローカルDBに保存されます。クラウドへは項目名の対応関係だけが指示として送られ、案件本文は送られません。'
                    )}
                  </span>
                </div>
              </section>
            ) : null}

            {activeSection === 'broadcast' && broadcastActions ? (
              <section aria-labelledby="broadcast-settings-title" className="settings-section">
                <div className="settings-section-heading">
                  <span>CASE BROADCAST</span>
                  <h3 id="broadcast-settings-title">{t('群发', '配信')}</h3>
                  <p>
                    {t(
                      '在这里整理文案的行模板。模板只排列案件字段值，商流与支付条件无法作为行选择。',
                      '紹介文の行テンプレートをここで整えます。テンプレートは案件の項目値だけを並べ、商流と支払条件は行に選べません。'
                    )}
                  </p>
                </div>
                <BroadcastSettingsSection actions={broadcastActions} />
                <div className="application-settings-policy">
                  <Icon name="lock" size={16} />
                  <span>
                    <strong>{t('仅保存在此设备', 'この端末だけに保存')}</strong>
                    {t(
                      '模板保存在加密本地数据库，不会发送到外部系统。',
                      'テンプレートは暗号化ローカルDBに保存され、外部システムへ送信されません。'
                    )}
                  </span>
                </div>
              </section>
            ) : null}

            {activeSection === 'integrations' ? (
              <section aria-labelledby="integration-settings-title" className="settings-section">
                <div className="settings-section-heading">
                  <span>EXTERNAL SYSTEMS</span>
                  <h3 id="integration-settings-title">{t('外部系统', '外部システム')}</h3>
                  <p>{t('在此统一管理外部服务的连接、权限和同步范围。', '外部サービスの接続、権限、同期範囲をここで一元管理します。')}</p>
                </div>

                <article className="integration-settings-card">
                  <div className="integration-settings-logo google">
                    <Icon name="mail" size={21} />
                  </div>
                  <div className="integration-settings-main">
                    <div className="integration-settings-title">
                      <div>
                        <h4>{t('Google 邮箱', 'Google メール')}</h4>
                        <p>
                          {t(
                            '登录 Google 账号后，自动接收并整理案件和人员邮件。支持个人 Gmail 和 Google Workspace 公司邮箱。',
                            'Googleアカウントでログインすると、案件・要員メールを自動で取り込みます。個人GmailとGoogle Workspaceの会社メールに対応しています。'
                          )}
                        </p>
                      </div>
                      <span className={googleConnected ? 'integration-status is-connected' : 'integration-status'}>{googleStatus}</span>
                    </div>
                    {!googleConnected && googleConfigured ? (
                      <div className="integration-settings-note google-data-disclosure" role="note">
                        <Icon name="lock" size={16} />
                        <span>
                          <strong>{t('Google 邮箱数据的使用方式', 'Google メールデータの利用')}</strong>
                          <span>
                            {t(
                              '读取案件和人员邮件的主题、发件人、正文、时间、标签及支持的简历附件，整理为本机的案件和人员资料。收信过程不会将原文或登录凭据发送到我们的服务器或云端 AI。',
                              '案件・要員メールの件名・送信者・本文・日時・Labelと対応する履歴書添付を読み取り、この端末の案件・要員資料に整理します。Gmailの読取処理では原文とTokenを当社サーバーやCloud AIへ送信しません。'
                            )}
                          </span>
                          <span>
                            {t(
                              '使用 Google 登录并允许读取邮件。应用不会发送或删除邮件。',
                              'Googleでログインし、メールの読取を許可してください。アプリからメールを送信・削除することはありません。'
                            )}
                          </span>
                        </span>
                      </div>
                    ) : null}
                    <dl className="integration-settings-facts">
                      <div>
                        <dt>{t('账号', 'アカウント')}</dt>
                        <dd>{bootstrap.gmail.accountEmail ?? t('未连接', '未接続')}</dd>
                      </div>
                      <div>
                        <dt>{t('接收内容', '取込対象')}</dt>
                        <dd>{t('案件邮件、人员邮件及简历附件', '案件メール・要員メール・履歴書添付')}</dd>
                      </div>
                      <div>
                        <dt>{t('同步', '同期')}</dt>
                        <dd>
                          {bootstrap.gmailSync.lastSyncedAt
                            ? new Date(bootstrap.gmailSync.lastSyncedAt).toLocaleString(preferences.locale)
                            : t('未同步', '未同期')}
                        </dd>
                      </div>
                    </dl>
                    {googleConnected ? <GmailSyncFeedback state={bootstrap.gmailSync} zh={zh} /> : null}
                    <div className="integration-settings-actions">
                      {googleConnected ? (
                        <>
                          <button
                            disabled={busy !== null}
                            onClick={() => void runIntegrationAction('google-sync', onSyncGoogleWorkspace)}
                            type="button"
                          >
                            {busy === 'google-sync' ? t('正在同步…', '同期中…') : t('立即同步', '今すぐ同期')}
                          </button>
                          <button
                            className="is-danger"
                            disabled={busy !== null}
                            onClick={() => void runIntegrationAction('google-disconnect', onDisconnectGoogleWorkspace)}
                            type="button"
                          >
                            {t('断开连接', '接続を解除')}
                          </button>
                        </>
                      ) : googleConfigured ? (
                        <button
                          disabled={busy !== null}
                          onClick={() => void runIntegrationAction('google-connect', onConnectGoogleWorkspace)}
                          type="button"
                        >
                          {busy === 'google-connect' ? t('正在连接并同步…', '接続・同期中…') : t('连接 Google 邮箱', 'Google メールを接続')}
                        </button>
                      ) : (
                        <div className="integration-settings-note" role="status">
                          <span>
                            {t(
                              '此版本尚未内置 Google 邮箱连接，请联系软件提供方。',
                              'このビルドには Google メール接続が組み込まれていません。ソフトウェア提供元に連絡してください。'
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </article>

                <article className="integration-settings-card">
                  <div className="integration-settings-logo zoom">
                    <Icon name="users" size={21} />
                  </div>
                  <div className="integration-settings-main">
                    <div className="integration-settings-title">
                      <div>
                        <h4>Zoom Meetings</h4>
                        <p>
                          {t(
                            '招聘面试默认使用 Zoom，保存会议链接后可从面试页面一键跳转。',
                            '採用面談の既定をZoomにし、保存した会議リンクを面談画面から開きます。'
                          )}
                        </p>
                      </div>
                      <span className="integration-status is-connected">{t('会议链接模式已启用', '会議リンク連携済み')}</span>
                    </div>
                    <dl className="integration-settings-facts">
                      <div>
                        <dt>{t('跳转方式', '起動方法')}</dt>
                        <dd>Zoom Workplace / Browser</dd>
                      </div>
                      <div>
                        <dt>{t('账号授权', 'アカウント権限')}</dt>
                        <dd>{t('当前不需要', '現在不要')}</dd>
                      </div>
                      <div>
                        <dt>{t('本地保存', '端末内保存')}</dt>
                        <dd>{t('会议链接与面试日程', '会議リンクと面談日程')}</dd>
                      </div>
                    </dl>
                    <div className="integration-settings-actions">
                      <button
                        disabled={busy !== null}
                        onClick={() =>
                          void runIntegrationAction('zoom-test', async () => {
                            await onOpenZoomTestMeeting?.()
                          })
                        }
                        type="button"
                      >
                        {busy === 'zoom-test' ? t('正在打开…', '起動中…') : t('测试 Zoom 跳转', 'Zoom起動をテスト')}
                      </button>
                    </div>
                  </div>
                </article>

                <article className="integration-settings-card">
                  <div className="integration-settings-logo ai">
                    <Icon name="sparkles" size={21} />
                  </div>
                  <div className="integration-settings-main">
                    <div className="integration-settings-title">
                      <div>
                        <h4>AICommerce Cloud AI</h4>
                        <p>{t('仅将已脱敏数据发送至获准的云端功能。', '脱敏済みデータだけを、許可されたクラウド機能へ送信します。')}</p>
                      </div>
                      <span className={aiCommerceConnected ? 'integration-status is-connected' : 'integration-status'}>
                        {aiCommerceConnected ? t('已连接', '接続済み') : t('未连接', '未接続')}
                      </span>
                    </div>
                    <dl className="integration-settings-facts">
                      <div>
                        <dt>{t('会员', '会員')}</dt>
                        <dd>{bootstrap.aiCommerce.memberDisplayName ?? t('未连接', '未接続')}</dd>
                      </div>
                      <div>
                        <dt>{t('发送前处理', '送信前処理')}</dt>
                        <dd>cloud-redaction-v2</dd>
                      </div>
                      <div>
                        <dt>{t('已授权功能', '許可機能')}</dt>
                        <dd>
                          {bootstrap.aiCommerce.capabilities.length > 0
                            ? t(`${bootstrap.aiCommerce.capabilities.length} 项`, `${bootstrap.aiCommerce.capabilities.length} 件`)
                            : t('无', 'なし')}
                        </dd>
                      </div>
                    </dl>
                    <div className="integration-settings-actions">
                      <button onClick={onOpenAiCommerce} type="button">
                        {t('管理连接与使用情况', '接続と利用状況を管理')}
                      </button>
                    </div>
                  </div>
                </article>

                <div className="integration-settings-note">
                  <Icon name="shield" size={17} />
                  <span>
                    <strong>{t('外部连接统一在此管理', '外部接続はこの画面に集約')}</strong>
                    {t(
                      '业务页面仅使用已配置连接；账号、权限和同步范围均在此修改。',
                      '業務ページでは設定済みの接続を選択して使用し、アカウント・権限・同期範囲の変更はここで行います。'
                    )}
                  </span>
                </div>
              </section>
            ) : null}

            {activeSection === 'privacy' ? (
              <section aria-labelledby="privacy-settings-title" className="settings-section">
                <div className="settings-section-heading">
                  <span>DATA & PRIVACY</span>
                  <h3 id="privacy-settings-title">{t('数据与隐私', 'データとプライバシー')}</h3>
                  <p>
                    {t('查看个人信息脱敏、本地 AI 和加密存储的当前状态。', '個人情報の脱敏、Local AI、暗号化保存の現在状態を確認します。')}
                  </p>
                </div>
                <div className="privacy-settings-grid">
                  <div>
                    <span>
                      <Icon name="shield" size={18} />
                    </span>
                    <strong>{t('云端发送前脱敏', 'クラウド送信前脱敏')}</strong>
                    <small>
                      {bootstrap.privacy.cloudGateway === 'enforced' ? t('强制且不可绕过', '強制・バイパス不可') : t('需要确认', '要確認')}
                    </small>
                  </div>
                  <div>
                    <span>
                      <Icon name="sparkles" size={18} />
                    </span>
                    <strong>Local AI</strong>
                    <small>{t('OCR、PII 和检索均在本机执行', 'OCR・PII・検索を端末内で実行')}</small>
                  </div>
                  <div>
                    <span>
                      <Icon name="database" size={18} />
                    </span>
                    <strong>{t('加密保存', '暗号化保存')}</strong>
                    <small>
                      {bootstrap.storage.engine} · {bootstrap.storage.keyProtection}
                    </small>
                  </div>
                </div>
                <button className="settings-primary-link" onClick={onOpenDataSecurity} type="button">
                  <Icon name="lock" size={17} />
                  {t('打开数据安全详情', 'データセキュリティの詳細を開く')}
                  <Icon name="chevron-right" size={16} />
                </button>
                <div className="application-settings-policy">
                  <Icon name="shield" size={16} />
                  <span>
                    <strong>{t('保留人工确认', '人の確認を維持')}</strong>
                    {t(
                      '未知信息不会被当作不符合；人员、案件确认和对外提供均需负责人确认。',
                      '不明な情報を不適合として扱わず、候補者や案件の確定、外部提供は担当者の確認後に行います。'
                    )}
                  </span>
                </div>
              </section>
            ) : null}

            {error ? (
              <p className="application-settings-error" role="alert">
                <Icon name="alert" size={15} />
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <footer>
          <span>SES Agent Desktop v{bootstrap.appVersion}</span>
          <button disabled={busy !== null} onClick={onClose} type="button">
            {t('关闭', '閉じる')}
          </button>
        </footer>
      </section>
    </div>
  )
}
