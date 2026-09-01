import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type {
  SaveJobCaseFieldAliasesInput,
  JobCaseFieldKey,
  JobCaseFieldAliases,
  JobCaseFieldAliasMap,
  ApplicationLocale,
  BootstrapPayload,
  LocalApplicationPreferences,
  SaveLocalApplicationPreferencesInput
} from '@shared'
import { jobCaseFieldCanonicalLabels, jobCaseFieldKeys } from '@shared'
import { BroadcastSettingsSection, type BroadcastSettingsActions } from './BroadcastSettingsSection'
import { Icon, type IconName } from './Icon'
import { useRendererUiRefresh, useUiLocale, useUiText } from '../i18n'

export type ApplicationSettingsSection = 'general' | 'fields' | 'broadcast' | 'integrations' | 'privacy'

interface ApplicationSettingsDialogProps {
  bootstrap: BootstrapPayload
  initialSection?: ApplicationSettingsSection
  preferences: LocalApplicationPreferences
  onClose(): void
  onConnectGoogleWorkspace(): Promise<void>
  onDisconnectGoogleWorkspace(): Promise<void>
  onOpenAiCommerce(): void
  onOpenDataSecurity(): void
  onOpenGoogleWorkspace(): void
  onOpenOperatorProfile(): void
  onOpenZoomTestMeeting?(): Promise<unknown>
  onSave(input: SaveLocalApplicationPreferencesInput): Promise<LocalApplicationPreferences>
  onSyncGoogleWorkspace(): Promise<void>
  fieldAliases?: JobCaseFieldAliases
  onSaveFieldAliases?(input: SaveJobCaseFieldAliasesInput): Promise<JobCaseFieldAliases>
  /** Present once 案件配信 is reachable; the 配信 area is hidden without it. */
  broadcastActions?: BroadcastSettingsActions
}

const aliasSeparatorPattern = /[、,，;；\r\n]+/u

function aliasDraftsFrom(aliases: JobCaseFieldAliases | undefined): Record<JobCaseFieldKey, string> {
  return Object.fromEntries(jobCaseFieldKeys.map((key) => [key, (aliases?.aliases[key] ?? []).join('、')])) as Record<JobCaseFieldKey, string>
}

function aliasMapFrom(drafts: Record<JobCaseFieldKey, string>): JobCaseFieldAliasMap {
  const map: JobCaseFieldAliasMap = {}
  for (const key of jobCaseFieldKeys) {
    const values = [...new Set(drafts[key].split(aliasSeparatorPattern).map((value) => value.trim()).filter(Boolean))]
    if (values.length > 0) map[key] = values
  }
  return map
}

const languageOptions: Array<{ locale: ApplicationLocale; name: string; nativeName: string; detail: string }> = [
  { locale: 'ja-JP', name: '日本語', nativeName: '日本語（日本）', detail: '日本語で画面を表示します。' },
  { locale: 'zh-CN', name: '中文（简体）', nativeName: '中文（简体，中国）', detail: '界面会立即切换为简体中文。' }
]

const sections: Array<{ id: ApplicationSettingsSection; label: string; detail: string; icon: IconName }> = [
  { id: 'general', label: '一般設定', detail: '言語と本機ユーザー', icon: 'settings' },
  { id: 'fields', label: '案件項目', detail: '項目の別名', icon: 'briefcase' },
  { id: 'broadcast', label: '配信', detail: '紹介文テンプレート', icon: 'mail' },
  { id: 'integrations', label: '外部システム', detail: '接続・権限・同期', icon: 'mail' },
  { id: 'privacy', label: 'データとプライバシー', detail: '脱敏・Local AI・暗号化', icon: 'shield' }
]

export function ApplicationSettingsDialog({
  bootstrap,
  initialSection = 'general',
  preferences,
  onClose,
  onConnectGoogleWorkspace,
  onDisconnectGoogleWorkspace,
  onOpenAiCommerce,
  onOpenDataSecurity,
  onOpenGoogleWorkspace,
  onOpenOperatorProfile,
  onOpenZoomTestMeeting,
  onSave,
  onSyncGoogleWorkspace,
  fieldAliases,
  onSaveFieldAliases,
  broadcastActions
}: ApplicationSettingsDialogProps) {
  useRendererUiRefresh()
  const t = useUiText()
  const zh = useUiLocale() === 'zh-CN'
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
      setAliasError(cause instanceof Error ? cause.message : '案件項目の別名を保存できませんでした。')
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => setActiveSection(initialSection), [initialSection])

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
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [tabindex]:not([tabindex="-1"])'
    ) ?? [])].filter((element) => element.offsetParent !== null)
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

  const saveLocale = async (locale: ApplicationLocale) => {
    if (busy || locale === preferences.locale) return
    setBusy('locale')
    setError(null)
    try {
      await onSave({ locale, expectedRevision: preferences.revision })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '表示設定を保存できませんでした。')
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
      setError(cause instanceof Error ? cause.message : '外部システムの接続を更新できませんでした。')
    } finally {
      setBusy(null)
    }
  }

  const googleConnected = bootstrap.gmail.status === 'readonly'
  const googleConfigured = bootstrap.gmail.configuration === 'ready' && bootstrap.gmailSync.configuration === 'ready'
  const googleStatus = googleConnected ? '読取専用で接続済み' : googleConfigured ? '接続待ち' : '管理者設定が必要'
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
            <h2 id="application-settings-title">設定</h2>
            <p>表示、外部システム、データ保護を一つの場所で管理します。</p>
          </div>
          <button aria-label="設定を閉じる" disabled={busy !== null} onClick={onClose} type="button">×</button>
        </header>

        <div className="application-settings-layout">
          <nav aria-label="設定カテゴリ" className="application-settings-nav">
            {sections.filter((section) => section.id !== 'broadcast' || broadcastActions).map((section, index) => (
              <button
                aria-current={activeSection === section.id ? 'page' : undefined}
                className={activeSection === section.id ? 'is-active' : ''}
                data-initial-focus={index === 0 ? 'true' : undefined}
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                type="button"
              >
                <Icon name={section.icon} size={17} />
                <span><strong>{t(section.label)}</strong><small>{t(section.detail)}</small></span>
                <Icon name="chevron-right" size={14} />
              </button>
            ))}
          </nav>

          <div className="application-settings-content" tabIndex={-1}>
            {activeSection === 'general' ? (
              <section aria-labelledby="general-settings-title" className="settings-section">
                <div className="settings-section-heading">
                  <span>GENERAL</span>
                  <h3 id="general-settings-title">一般設定</h3>
                  <p>この端末で使用する表示言語とユーザー情報を設定します。</p>
                </div>
                <section aria-label="表示言語" className="language-choice-group" role="radiogroup">
                  <div className="language-choice-heading"><Icon name="settings" size={16} /><span>表示言語</span></div>
                  {languageOptions.map((option) => {
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
                        <span><strong>{option.name}</strong><small>{option.nativeName}</small><em>{option.detail}</em></span>
                        {selected ? <Icon name="check" size={17} /> : null}
                      </button>
                    )
                  })}
                </section>
                <button className="settings-link-card" onClick={onOpenOperatorProfile} type="button">
                  <span className="settings-link-icon"><Icon name="users" size={18} /></span>
                  <span><strong>本機ユーザープロフィール</strong><small>{bootstrap.operatorProfile.configured ? `${bootstrap.operatorProfile.displayName} · ${bootstrap.operatorProfile.roleLabel}` : '表示名と担当ロールを設定します。'}</small></span>
                  <Icon name="chevron-right" size={16} />
                </button>
                <div className="application-settings-policy">
                  <Icon name="lock" size={16} />
                  <span><strong>この端末だけに保存</strong>言語とユーザー設定は暗号化ローカルDBに保存され、外部システムへ送信されません。</span>
                </div>
              </section>
            ) : null}

            {activeSection === 'fields' ? (
              <section aria-labelledby="field-settings-title" className="settings-section">
                <div className="settings-section-heading">
                  <span>CASE FIELDS</span>
                  <h3 id="field-settings-title">案件項目の別名</h3>
                  <p>取引先ごとに異なるラベル（単金、稼働開始など）を既定の案件項目に対応付けます。貼り付け時の分類、端末内の項目抽出、クラウド抽出への指示が同じ別名を使います。</p>
                </div>
                <div className="settings-alias-grid">
                  {jobCaseFieldKeys.map((key) => (
                    <label className="settings-alias-row" key={key}>
                      <span><strong>{jobCaseFieldCanonicalLabels[key]}</strong><small>{key}</small></span>
                      <input
                        aria-label={`${jobCaseFieldCanonicalLabels[key]}の別名`}
                        disabled={busy !== null || !onSaveFieldAliases}
                        onChange={(event) => { setAliasSaved(false); setAliasDrafts({ ...aliasDrafts, [key]: event.target.value }) }}
                        placeholder="別名を「、」で区切って入力"
                        value={aliasDrafts[key]}
                      />
                    </label>
                  ))}
                </div>
                {aliasError ? <p className="settings-inline-error" role="alert">{aliasError}</p> : null}
                <div className="settings-alias-actions">
                  <button className="is-primary" disabled={busy !== null || !aliasDirty || !onSaveFieldAliases} onClick={() => void saveAliases()} type="button">{busy === 'aliases' ? '保存中…' : '別名を保存'}</button>
                  {aliasSaved ? <small>保存しました</small> : null}
                </div>
                <div className="application-settings-policy">
                  <Icon name="lock" size={16} />
                  <span><strong>この端末だけに保存</strong>別名は暗号化ローカルDBに保存されます。クラウドへは項目名の対応関係だけが指示として送られ、案件本文は送られません。</span>
                </div>
              </section>
            ) : null}

            {activeSection === 'broadcast' && broadcastActions ? (
              <section aria-labelledby="broadcast-settings-title" className="settings-section">
                <div className="settings-section-heading">
                  <span>CASE BROADCAST</span>
                  <h3 id="broadcast-settings-title">配信</h3>
                  <p>紹介文の行テンプレートをここで整えます。テンプレートは案件の項目値だけを並べ、商流と支払条件は行に選べません。</p>
                </div>
                <BroadcastSettingsSection actions={broadcastActions} />
                <div className="application-settings-policy">
                  <Icon name="lock" size={16} />
                  <span><strong>この端末だけに保存</strong>テンプレートは暗号化ローカルDBに保存され、外部システムへ送信されません。</span>
                </div>
              </section>
            ) : null}

            {activeSection === 'integrations' ? (
              <section aria-labelledby="integration-settings-title" className="settings-section">
                <div className="settings-section-heading">
                  <span>EXTERNAL SYSTEMS</span>
                  <h3 id="integration-settings-title">外部システム</h3>
                  <p>外部サービスの接続、権限、同期範囲をここで一元管理します。</p>
                </div>

                <article className="integration-settings-card">
                  <div className="integration-settings-logo google"><Icon name="mail" size={21} /></div>
                  <div className="integration-settings-main">
                    <div className="integration-settings-title">
                      <div><h4>Google Workspace</h4><p>会社 Gmail から案件情報を読取専用で取り込みます。</p></div>
                      <span className={googleConnected ? 'integration-status is-connected' : 'integration-status'}>{t(googleStatus)}</span>
                    </div>
                    <dl className="integration-settings-facts">
                      <div><dt>アカウント</dt><dd>{bootstrap.gmail.accountEmail ?? '未接続'}</dd></div>
                      <div><dt>権限</dt><dd>gmail.readonly</dd></div>
                      <div><dt>同期</dt><dd>{bootstrap.gmailSync.lastSyncedAt ? new Date(bootstrap.gmailSync.lastSyncedAt).toLocaleString(preferences.locale) : '未同期'}</dd></div>
                    </dl>
                    <div className="integration-settings-actions">
                      <button onClick={onOpenGoogleWorkspace} type="button">接続設定</button>
                      {googleConnected ? <>
                        <button disabled={busy !== null} onClick={() => void runIntegrationAction('google-sync', onSyncGoogleWorkspace)} type="button">{busy === 'google-sync' ? '同期中…' : '今すぐ同期'}</button>
                        <button className="is-danger" disabled={busy !== null} onClick={() => void runIntegrationAction('google-disconnect', onDisconnectGoogleWorkspace)} type="button">接続を解除</button>
                      </> : googleConfigured ? (
                        <button disabled={busy !== null} onClick={() => void runIntegrationAction('google-connect', onConnectGoogleWorkspace)} type="button">{busy === 'google-connect' ? 'ブラウザを起動中…' : '読取専用で接続'}</button>
                      ) : null}
                    </div>
                  </div>
                </article>

                <article className="integration-settings-card">
                  <div className="integration-settings-logo zoom"><Icon name="users" size={21} /></div>
                  <div className="integration-settings-main">
                    <div className="integration-settings-title">
                      <div><h4>Zoom Meetings</h4><p>{zh ? '招聘面试默认使用 Zoom，保存会议链接后可从面试页面一键跳转。' : '採用面談の既定をZoomにし、保存した会議リンクを面談画面から開きます。'}</p></div>
                      <span className="integration-status is-connected">{zh ? '会议链接模式已启用' : '会議リンク連携済み'}</span>
                    </div>
                    <dl className="integration-settings-facts">
                      <div><dt>{zh ? '跳转方式' : '起動方法'}</dt><dd>Zoom Workplace / Browser</dd></div>
                      <div><dt>{zh ? '账号授权' : 'アカウント権限'}</dt><dd>{zh ? '当前不需要' : '現在不要'}</dd></div>
                      <div><dt>{zh ? '本地保存' : '端末内保存'}</dt><dd>{zh ? '会议链接与面试日程' : '会議リンクと面談日程'}</dd></div>
                    </dl>
                    <div className="integration-settings-actions">
                      <button disabled={busy !== null} onClick={() => void runIntegrationAction('zoom-test', async () => { await onOpenZoomTestMeeting?.() })} type="button">{busy === 'zoom-test' ? (zh ? '正在打开…' : '起動中…') : (zh ? '测试 Zoom 跳转' : 'Zoom起動をテスト')}</button>
                    </div>
                  </div>
                </article>

                <article className="integration-settings-card">
                  <div className="integration-settings-logo ai"><Icon name="sparkles" size={21} /></div>
                  <div className="integration-settings-main">
                    <div className="integration-settings-title">
                      <div><h4>AICommerce Cloud AI</h4><p>脱敏済みデータだけを、許可されたクラウド機能へ送信します。</p></div>
                      <span className={aiCommerceConnected ? 'integration-status is-connected' : 'integration-status'}>{aiCommerceConnected ? '接続済み' : '未接続'}</span>
                    </div>
                    <dl className="integration-settings-facts">
                      <div><dt>会員</dt><dd>{bootstrap.aiCommerce.memberDisplayName ?? '未接続'}</dd></div>
                      <div><dt>送信前処理</dt><dd>cloud-redaction-v2</dd></div>
                      <div><dt>許可機能</dt><dd>{bootstrap.aiCommerce.capabilities.length > 0 ? `${bootstrap.aiCommerce.capabilities.length} 件` : 'なし'}</dd></div>
                    </dl>
                    <div className="integration-settings-actions">
                      <button onClick={onOpenAiCommerce} type="button">接続と利用状況を管理</button>
                    </div>
                  </div>
                </article>

                <div className="integration-settings-note"><Icon name="shield" size={17} /><span><strong>外部接続はこの画面に集約</strong>業務ページでは設定済みの接続を選択して使用し、アカウント・権限・同期範囲の変更はここで行います。</span></div>
              </section>
            ) : null}

            {activeSection === 'privacy' ? (
              <section aria-labelledby="privacy-settings-title" className="settings-section">
                <div className="settings-section-heading">
                  <span>DATA & PRIVACY</span>
                  <h3 id="privacy-settings-title">データとプライバシー</h3>
                  <p>個人情報の脱敏、Local AI、暗号化保存の現在状態を確認します。</p>
                </div>
                <div className="privacy-settings-grid">
                  <div><span><Icon name="shield" size={18} /></span><strong>クラウド送信前脱敏</strong><small>{bootstrap.privacy.cloudGateway === 'enforced' ? '強制・バイパス不可' : '要確認'}</small></div>
                  <div><span><Icon name="sparkles" size={18} /></span><strong>Local AI</strong><small>OCR・PII・検索を端末内で実行</small></div>
                  <div><span><Icon name="database" size={18} /></span><strong>暗号化保存</strong><small>{bootstrap.storage.engine} · {bootstrap.storage.keyProtection}</small></div>
                </div>
                <button className="settings-primary-link" onClick={onOpenDataSecurity} type="button"><Icon name="lock" size={17} />データセキュリティの詳細を開く<Icon name="chevron-right" size={16} /></button>
                <div className="application-settings-policy">
                  <Icon name="shield" size={16} />
                  <span><strong>人の確認を維持</strong>不明な情報を不適合として扱わず、候補者や案件の確定、外部提供は担当者の確認後に行います。</span>
                </div>
              </section>
            ) : null}

            {error ? <p className="application-settings-error" role="alert"><Icon name="alert" size={15} />{error}</p> : null}
          </div>
        </div>

        <footer>
          <span>SES Agent Desktop v{bootstrap.appVersion}</span>
          <button disabled={busy !== null} onClick={onClose} type="button">閉じる</button>
        </footer>
      </section>
    </div>
  )
}
