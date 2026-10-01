import { useState } from 'react'
import type {
  ConfirmRecoveryInput,
  ConfirmRecoveryResult,
  PreviewRecoveryPackageInput,
  RecoveryPreviewResult,
  StartupStatus
} from '@shared'
import { Icon } from './Icon'
import { localizedIpcError, localizedMainText, useLocaleText } from '../i18n'

interface StartupRecoveryScreenProps {
  status: Extract<StartupStatus, { mode: 'recovery-required' }>
  onPreviewRecovery(input: PreviewRecoveryPackageInput): Promise<RecoveryPreviewResult>
  onConfirmRecovery(input: ConfirmRecoveryInput): Promise<ConfirmRecoveryResult>
  onRestart(): Promise<{ restarting: true }>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function StartupRecoveryScreen({ status, onPreviewRecovery, onConfirmRecovery, onRestart }: StartupRecoveryScreenProps) {
  const { locale, zh, t } = useLocaleText()
  const [password, setPassword] = useState('')
  const [preview, setPreview] = useState<RecoveryPreviewResult | null>(null)
  const [confirmationText, setConfirmationText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)

  const verifyPackage = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await onPreviewRecovery({ password })
      setPassword('')
      if (!result.cancelled && result.summary) setPreview(result)
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法验证恢复包。', '復元パッケージを検証できませんでした。')))
    } finally {
      setBusy(false)
    }
  }

  const confirmRestore = async () => {
    if (!preview?.restoreToken || !preview.confirmationHash) return
    setBusy(true)
    setError(null)
    try {
      await onConfirmRecovery({
        restoreToken: preview.restoreToken,
        confirmationHash: preview.confirmationHash,
        // i18n-ignore: confirmation token sent to Main
        confirmationText: '復元'
      })
      setRestarting(true)
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法安排恢复。', '復元を予約できませんでした。')))
      setBusy(false)
    }
  }

  const retryStartup = async () => {
    setBusy(true)
    setError(null)
    try {
      await onRestart()
      setRestarting(true)
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法重新启动应用。', 'アプリを再起動できませんでした。')))
      setBusy(false)
    }
  }

  return (
    <main className="startup-recovery-shell">
      <section className="startup-recovery-panel">
        <header className="startup-recovery-brand">
          <span className="startup-recovery-mark">S</span>
          <div>
            <strong>SESAI</strong>
            <span>Agent Desktop</span>
          </div>
        </header>

        <div className="startup-recovery-status">
          <div className="startup-recovery-title-row">
            <span className="startup-recovery-alert">
              <Icon name="lock" size={24} />
            </span>
            <div>
              <h1>{t('无法打开本地数据', 'ローカルデータを開けません')}</h1>
              <p>{localizedMainText(locale, status.message)}</p>
            </div>
          </div>
          <div className="startup-recovery-safety">
            <span>
              <Icon name="shield" size={15} /> {t('原数据未修改', '元データは未変更')}
            </span>
            <span>
              <Icon name="check" size={15} /> {t('未进行网络发送', 'ネットワーク送信なし')}
            </span>
            <span>
              <Icon name="lock" size={15} /> {t('不会绕过密钥', '鍵の回避なし')}
            </span>
          </div>
        </div>

        <div className="startup-recovery-grid">
          <section className="startup-recovery-action-card">
            <div className="startup-recovery-section-heading">
              <span>1</span>
              <div>
                <h2>{t('从加密备份恢复', '暗号化バックアップから復元')}</h2>
                <p>{t('需要 `.ses-recovery` 文件及创建时设置的独立密码。', '`.ses-recovery` と作成時の独立パスワードが必要です。')}</p>
              </div>
            </div>

            {!preview?.summary ? (
              <div className="startup-recovery-form">
                <label>
                  {t('恢复密码', '復元パスワード')}
                  <input
                    autoFocus
                    autoComplete="current-password"
                    disabled={busy || restarting}
                    minLength={12}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    value={password}
                  />
                </label>
                <button disabled={busy || restarting || password.length < 12} onClick={() => void verifyPackage()} type="button">
                  {busy ? t('正在本机验证…', 'ローカルで検証中…') : t('选择恢复包并验证', 'パッケージを選択して検証')}
                </button>
                <p className="startup-recovery-memory-note">
                  <Icon name="shield" size={15} />{' '}
                  {t('密码仅在验证期间于内存中使用，不会保存。', 'パスワードは検証中のメモリだけで使用し、保存しません。')}
                </p>
              </div>
            ) : (
              <div className="startup-recovery-preview">
                <div className="startup-recovery-verified">
                  <Icon name="check" size={17} />
                  <strong>{t('恢复包认证与内容验证已完成', 'パッケージの認証と内容検証が完了しました')}</strong>
                </div>
                <dl>
                  <div>
                    <dt>{t('创建时间', '作成日時')}</dt>
                    <dd>{new Date(preview.summary.createdAt).toLocaleString(locale)}</dd>
                  </div>
                  <div>
                    <dt>{t('数据版本', 'データ版')}</dt>
                    <dd>v{preview.summary.schemaVersion}</dd>
                  </div>
                  <div>
                    <dt>{t('受保护数据', '保護データ')}</dt>
                    <dd>{formatBytes(preview.summary.totalBytes)}</dd>
                  </div>
                  <div>
                    <dt>{t('加密文件', '暗号化ファイル')}</dt>
                    <dd>{t(`${preview.summary.vaultObjectCount} 项`, `${preview.summary.vaultObjectCount}件`)}</dd>
                  </div>
                </dl>
                <ul>
                  {preview.warnings.map((warning) => (
                    <li key={warning}>{localizedMainText(locale, warning)}</li>
                  ))}
                </ul>
                <label>
                  {t('请输入“恢复”以确认', '確認のため「復元」と入力')}
                  <input
                    autoComplete="off"
                    disabled={busy || restarting}
                    onChange={(event) => setConfirmationText(event.target.value)}
                    value={confirmationText}
                  />
                </label>
                <div className="startup-recovery-preview-actions">
                  <button
                    disabled={busy || restarting}
                    onClick={() => {
                      setPreview(null)
                      setConfirmationText('')
                    }}
                    type="button"
                  >
                    {t('选择其他恢复包', '別のパッケージ')}
                  </button>
                  <button
                    disabled={busy || restarting || confirmationText !== t('恢复', '復元')}
                    onClick={() => void confirmRestore()}
                    type="button"
                  >
                    {restarting
                      ? t('正在安全重启…', '安全に再起動しています…')
                      : busy
                        ? t('正在准备恢复…', '復元を準備中…')
                        : t('确认并恢复', '確認して復元')}
                  </button>
                </div>
              </div>
            )}
            {error ? (
              <p className="startup-recovery-error" role="alert">
                <Icon name="alert" size={15} />
                {error}
              </p>
            ) : null}
          </section>

          <aside className="startup-recovery-guidance">
            <div className="startup-recovery-section-heading compact">
              <span>2</span>
              <div>
                <h2>{t('没有备份时', 'バックアップがない場合')}</h2>
                <p>{t('无法通过猜测或重新签发加密密钥来打开现有数据。', '暗号鍵を推測・再発行して既存データを開くことはできません。')}</p>
              </div>
            </div>
            <ol>
              <li>{t('请勿删除应用数据文件夹或 Keychain 项目', 'アプリのデータフォルダや Keychain 項目を削除しない')}</li>
              <li>{t('检查 Mac 备份或管理员保管的恢复包', 'Mac のバックアップや管理者保管の復元パッケージを確認する')}</li>
              <li>{t('请勿将恢复密码粘贴到聊天或邮件中', '復元パスワードをチャットやメールへ貼り付けない')}</li>
            </ol>
            <div className="startup-recovery-exclusions">
              <strong>{t('恢复后需要完成的操作', '復元後に必要なこと')}</strong>
              <span>{t('重新连接 Google Workspace', 'Google Workspace は再接続')}</span>
              <span>{t('重新设置云端 API Key', 'Cloud API Key は再設定')}</span>
              <span>{t('应用外导出的文件不在恢复范围内', 'アプリ外の書き出しは対象外')}</span>
            </div>
            <button className="startup-recovery-retry" disabled={busy || restarting} onClick={() => void retryStartup()} type="button">
              <Icon name="clock" size={15} /> {t('修复 Keychain 后重试', 'Keychain を修復した後に再試行')}
            </button>
          </aside>
        </div>

        <footer>
          <Icon name="shield" size={14} />{' '}
          {t('此页面不会访问业务数据、Gmail 或云端 AI。', 'この画面では業務データ、Gmail、クラウド AI にアクセスしません。')}
        </footer>
      </section>
    </main>
  )
}
