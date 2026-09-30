import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type {
  GoogleWorkspaceAdminConfiguration,
  SaveGoogleWorkspaceAdminConfigurationInput,
  SaveGoogleWorkspaceAdminConfigurationResult
} from '@shared'
import { Icon } from './Icon'
import { localizedIpcError, useLocaleText } from '../i18n'

interface GoogleWorkspaceSettingsDialogProps {
  configuration: GoogleWorkspaceAdminConfiguration | null
  connected: boolean
  onClose(): void
  onSave(input: SaveGoogleWorkspaceAdminConfigurationInput): Promise<SaveGoogleWorkspaceAdminConfigurationResult>
}

export function GoogleWorkspaceSettingsDialog({ configuration, connected, onClose, onSave }: GoogleWorkspaceSettingsDialogProps) {
  const { locale, zh, t } = useLocaleText()
  const dialogRef = useRef<HTMLElement | null>(null)
  const [clientId, setClientId] = useState(configuration?.clientId ?? '')
  const [workspaceDomain, setWorkspaceDomain] = useState(configuration?.workspaceDomain ?? '')
  const [labelIds, setLabelIds] = useState(configuration?.labelIds.join(',') ?? '')
  const [query, setQuery] = useState(configuration?.query ?? t('案件 OR 人员', '案件 OR 要員'))
  const [lookbackDays, setLookbackDays] = useState(configuration?.lookbackDays ?? 30)
  const [maxMessagesPerRun, setMaxMessagesPerRun] = useState(configuration?.maxMessagesPerRun ?? 200)
  const [readonlyAcknowledged, setReadonlyAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const managed = configuration?.source === 'managed-environment'
  const inputsDisabled = managed || connected || busy || restarting

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('[data-initial-focus="true"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !busy && !restarting) {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
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

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await onSave({
        clientId: clientId.trim(),
        workspaceDomain: workspaceDomain.trim().toLocaleLowerCase('en-US'),
        labelIds: labelIds
          .split(',')
          .map((label) => label.trim())
          .filter(Boolean),
        query: query.trim(),
        lookbackDays,
        maxMessagesPerRun,
        expectedRevision: configuration?.revision ?? null,
        readonlyAcknowledged: true
      })
      if (result.restarting) setRestarting(true)
    } catch (cause) {
      setError(
        localizedIpcError(locale, cause, t('无法保存 Google Workspace 管理员设置。', 'Google Workspace 管理者設定を保存できませんでした。'))
      )
      setBusy(false)
    }
  }

  const canSave =
    !inputsDisabled &&
    readonlyAcknowledged &&
    clientId.trim().length >= 20 &&
    workspaceDomain.trim().length >= 3 &&
    labelIds.trim().length > 0 &&
    query.trim().length >= 2 &&
    Number.isInteger(lookbackDays) &&
    lookbackDays >= 1 &&
    lookbackDays <= 365 &&
    Number.isInteger(maxMessagesPerRun) &&
    maxMessagesPerRun >= 1 &&
    maxMessagesPerRun <= 500

  return (
    <div className="google-settings-backdrop" role="presentation">
      <section
        aria-labelledby="google-settings-title"
        aria-modal="true"
        className="google-settings-dialog"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <div>
            <span>GOOGLE WORKSPACE · READ ONLY</span>
            <h2 id="google-settings-title">{t('公司 Gmail 管理员设置', '会社 Gmail の管理者設定')}</h2>
            <p>
              {t(
                '仅登记 Desktop OAuth Client 与同步范围；无需输入客户端密钥、密码或令牌。',
                'Desktop OAuth Client と同期対象だけを登録します。Client Secret、パスワード、Token は入力しません。'
              )}
            </p>
          </div>
          <button
            aria-label={t('关闭 Google Workspace 管理员设置', 'Google Workspace 管理者設定を閉じる')}
            data-initial-focus={managed ? 'true' : undefined}
            disabled={busy || restarting}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="google-settings-body">
          <ol className="google-settings-setup-guide">
            <li>
              <strong>1</strong>
              <span>{t('在 Google Cloud 中启用 Gmail API', 'Google Cloud で Gmail API を有効化')}</span>
            </li>
            <li>
              <strong>2</strong>
              <span>{t('设置公司内部 OAuth 同意画面', '社内向け OAuth 同意画面を設定')}</span>
            </li>
            <li>
              <strong>3</strong>
              <span>{t('创建桌面应用 Client ID', 'Desktop App Client ID を作成')}</span>
            </li>
          </ol>

          {managed ? (
            <div className="google-settings-managed">
              <Icon name="lock" size={17} />
              <div>
                <strong>{t('公司受管环境设置', '会社の受管環境設定')}</strong>
                <span>
                  {t(
                    '此设备上可查看设置，但修改必须通过管理员分发设置完成。',
                    'この端末では内容を確認できますが、変更は管理者の配布設定で行います。'
                  )}
                </span>
              </div>
            </div>
          ) : null}
          {connected ? (
            <div className="google-settings-warning">
              <Icon name="alert" size={17} />
              <span>
                {t(
                  '修改设置前，请先断开当前 Google Workspace 连接。',
                  '設定を変更する前に、現在の Google Workspace 接続を解除してください。'
                )}
              </span>
            </div>
          ) : null}

          <div className="google-settings-grid">
            <label className="google-settings-wide">
              Desktop OAuth Client ID
              <input
                autoComplete="off"
                data-initial-focus={!managed ? 'true' : undefined}
                disabled={inputsDisabled}
                onChange={(event) => setClientId(event.target.value)}
                placeholder="1234567890-abc.apps.googleusercontent.com"
                spellCheck={false}
                value={clientId}
              />
            </label>
            <label>
              {t('公司 Workspace 域名', '会社 Workspace ドメイン')}
              <input
                autoComplete="off"
                disabled={inputsDisabled}
                onChange={(event) => setWorkspaceDomain(event.target.value)}
                placeholder="company.co.jp"
                spellCheck={false}
                value={workspaceDomain}
              />
            </label>
            <label>
              Gmail Label ID
              <input
                autoComplete="off"
                disabled={inputsDisabled}
                onChange={(event) => setLabelIds(event.target.value)}
                placeholder="INBOX,Label_SES"
                spellCheck={false}
                value={labelIds}
              />
            </label>
            <label className="google-settings-wide">
              {t('业务关键词', '業務キーワード')}
              <input
                autoComplete="off"
                disabled={inputsDisabled}
                maxLength={200}
                onChange={(event) => setQuery(event.target.value)}
                // i18n-ignore: sample Gmail search query for Japanese mail
                placeholder="案件 OR 要員"
                value={query}
              />
            </label>
            <label>
              {t('首次获取范围（天）', '初回取得期間（日）')}
              <input
                disabled={inputsDisabled}
                max={365}
                min={1}
                onChange={(event) => setLookbackDays(Number(event.target.value))}
                type="number"
                value={lookbackDays}
              />
            </label>
            <label>
              {t('单次最大邮件数', '1回の最大メール数')}
              <input
                disabled={inputsDisabled}
                max={500}
                min={1}
                onChange={(event) => setMaxMessagesPerRun(Number(event.target.value))}
                type="number"
                value={maxMessagesPerRun}
              />
            </label>
          </div>

          <div className="google-settings-scope">
            <div>
              <Icon name="check" size={15} />
              <span>
                <strong>{t('申请的权限', '取得する権限')}</strong> {t('仅 gmail.readonly', 'gmail.readonly のみ')}
              </span>
            </div>
            <div>
              <Icon name="lock" size={15} />
              <span>
                <strong>{t('不申请的权限', '取得しない権限')}</strong> compose / send / modify
              </span>
            </div>
            <div>
              <Icon name="shield" size={15} />
              <span>
                <strong>{t('保存', '保存')}</strong>{' '}
                {t('设置保存在 SQLCipher，令牌保存在操作系统受保护区域', '設定は SQLCipher、Token は OS 保護領域')}
              </span>
            </div>
          </div>

          {!managed ? (
            <label className="google-settings-confirmation">
              <input
                checked={readonlyAcknowledged}
                disabled={busy || restarting || connected}
                onChange={(event) => setReadonlyAcknowledged(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>{t('已确认这是只读连接', '読取専用接続であることを確認した')}</strong>
                <small>
                  {t(
                    '不会启用发送、自动发送或自动下载附件功能。',
                    '送信機能・自動送信・添付ファイルの自動ダウンロードは有効になりません。'
                  )}
                </small>
              </span>
            </label>
          ) : null}

          {error ? (
            <p className="google-settings-error" role="alert">
              <Icon name="alert" size={15} />
              {error}
            </p>
          ) : null}
          {restarting ? (
            <div className="google-settings-restarting" role="status">
              <span className="matching-spinner" />
              <div>
                <strong>{t('设置已加密保存', '設定を暗号化保存しました')}</strong>
                <span>
                  {t(
                    '正在安全重启；重启后请选择“以只读方式连接”。',
                    '安全に再起動しています。再起動後に「読取専用で接続」を選択してください。'
                  )}
                </span>
              </div>
            </div>
          ) : null}
        </div>

        <footer>
          <button disabled={busy || restarting} onClick={onClose} type="button">
            {t('关闭', '閉じる')}
          </button>
          {!managed ? (
            <button disabled={!canSave} onClick={() => void save()} type="button">
              {busy
                ? t('保存中…', '保存中…')
                : configuration
                  ? t('更新设置并重启', '設定を更新して再起動')
                  : t('保存设置并重启', '設定を保存して再起動')}
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  )
}
