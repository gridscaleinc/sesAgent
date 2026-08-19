import { useState } from 'react'
import type {
  ConfirmRecoveryInput,
  ConfirmRecoveryResult,
  PreviewRecoveryPackageInput,
  RecoveryPreviewResult,
  StartupStatus
} from '@shared'
import { Icon } from './Icon'
import { useRendererUiRefresh, useUiLocale } from '../i18n'

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

export function StartupRecoveryScreen({
  status,
  onPreviewRecovery,
  onConfirmRecovery,
  onRestart
}: StartupRecoveryScreenProps) {
  useRendererUiRefresh()
  const locale = useUiLocale()
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
      setError(cause instanceof Error ? cause.message : '復元パッケージを検証できませんでした。')
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
        confirmationText: '復元'
      })
      setRestarting(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '復元を予約できませんでした。')
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
      setError(cause instanceof Error ? cause.message : 'アプリを再起動できませんでした。')
      setBusy(false)
    }
  }

  return (
    <main className="startup-recovery-shell">
      <section className="startup-recovery-panel">
        <header className="startup-recovery-brand">
          <span className="startup-recovery-mark">S</span>
          <div><strong>SESAI</strong><span>Agent Desktop</span></div>
        </header>

        <div className="startup-recovery-status">
          <span className="eyebrow">OFFLINE RECOVERY</span>
          <div className="startup-recovery-title-row">
            <span className="startup-recovery-alert"><Icon name="lock" size={24} /></span>
            <div>
              <h1>ローカルデータを開けません</h1>
              <p>{status.message}</p>
            </div>
          </div>
          <div className="startup-recovery-safety">
            <span><Icon name="shield" size={15} /> 元データは未変更</span>
            <span><Icon name="check" size={15} /> ネットワーク送信なし</span>
            <span><Icon name="lock" size={15} /> 鍵の回避なし</span>
          </div>
        </div>

        <div className="startup-recovery-grid">
          <section className="startup-recovery-action-card">
            <div className="startup-recovery-section-heading">
              <span>1</span>
              <div><h2>暗号化バックアップから復元</h2><p>`.ses-recovery` と作成時の独立パスワードが必要です。</p></div>
            </div>

            {!preview?.summary ? (
              <div className="startup-recovery-form">
                <label>
                  復元パスワード
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
                  {busy ? 'ローカルで検証中…' : 'パッケージを選択して検証'}
                </button>
                <p className="startup-recovery-memory-note"><Icon name="shield" size={15} /> パスワードは検証中のメモリだけで使用し、保存しません。</p>
              </div>
            ) : (
              <div className="startup-recovery-preview">
                <div className="startup-recovery-verified"><Icon name="check" size={17} /><strong>パッケージの認証と内容検証が完了しました</strong></div>
                <dl>
                  <div><dt>作成日時</dt><dd>{new Date(preview.summary.createdAt).toLocaleString(locale)}</dd></div>
                  <div><dt>Schema</dt><dd>v{preview.summary.schemaVersion}</dd></div>
                  <div><dt>保護データ</dt><dd>{formatBytes(preview.summary.totalBytes)}</dd></div>
                  <div><dt>暗号化ファイル</dt><dd>{preview.summary.vaultObjectCount}件</dd></div>
                </dl>
                <ul>{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                <label>
                  確認のため「復元」と入力
                  <input
                    autoComplete="off"
                    disabled={busy || restarting}
                    onChange={(event) => setConfirmationText(event.target.value)}
                    value={confirmationText}
                  />
                </label>
                <div className="startup-recovery-preview-actions">
                  <button disabled={busy || restarting} onClick={() => { setPreview(null); setConfirmationText('') }} type="button">別のパッケージ</button>
                  <button disabled={busy || restarting || confirmationText !== (locale === 'zh-CN' ? '恢复' : '復元')} onClick={() => void confirmRestore()} type="button">
                    {restarting ? '安全に再起動しています…' : busy ? '復元を準備中…' : '確認して復元'}
                  </button>
                </div>
              </div>
            )}
            {error ? <p className="startup-recovery-error" role="alert"><Icon name="alert" size={15} />{error}</p> : null}
          </section>

          <aside className="startup-recovery-guidance">
            <div className="startup-recovery-section-heading compact">
              <span>2</span>
              <div><h2>バックアップがない場合</h2><p>暗号鍵を推測・再発行して既存データを開くことはできません。</p></div>
            </div>
            <ol>
              <li>アプリのデータフォルダや Keychain 項目を削除しない</li>
              <li>Mac のバックアップや管理者保管の復元パッケージを確認する</li>
              <li>復元パスワードをチャットやメールへ貼り付けない</li>
            </ol>
            <div className="startup-recovery-exclusions">
              <strong>復元後に必要なこと</strong>
              <span>Google Workspace は再接続</span>
              <span>Cloud API Key は再設定</span>
              <span>アプリ外の書き出しは対象外</span>
            </div>
            <button className="startup-recovery-retry" disabled={busy || restarting} onClick={() => void retryStartup()} type="button">
              <Icon name="clock" size={15} /> Keychain を修復した後に再試行
            </button>
          </aside>
        </div>

        <footer>
          <Icon name="shield" size={14} /> この画面では業務データ、Gmail、クラウド AI にアクセスしません。
        </footer>
      </section>
    </main>
  )
}
