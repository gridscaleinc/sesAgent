import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { LocalOperatorProfile, SaveLocalOperatorProfileInput } from '@shared'
import { Icon } from './Icon'
import { useRendererUiRefresh } from '../i18n'

interface LocalOperatorProfileDialogProps {
  profile: LocalOperatorProfile
  onClose(): void
  onSave(input: SaveLocalOperatorProfileInput): Promise<LocalOperatorProfile>
}

export function LocalOperatorProfileDialog({ profile, onClose, onSave }: LocalOperatorProfileDialogProps) {
  useRendererUiRefresh()
  const dialogRef = useRef<HTMLElement | null>(null)
  const openerRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const [displayName, setDisplayName] = useState(profile.configured ? profile.displayName : '')
  const [roleLabel, setRoleLabel] = useState(profile.configured ? profile.roleLabel : '営業担当')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    if (event.key === 'Escape' && !busy) {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
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

  const save = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onSave({
        displayName: displayName.trim(),
        roleLabel: roleLabel.trim(),
        expectedRevision: profile.revision
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作員プロフィールを保存できませんでした。')
      setBusy(false)
    }
  }

  const canSave = !busy && displayName.trim().length >= 2 && displayName.trim().length <= 80 &&
    roleLabel.trim().length >= 2 && roleLabel.trim().length <= 40

  return (
    <div className="operator-profile-backdrop" role="presentation">
      <section
        aria-labelledby="operator-profile-title"
        aria-modal="true"
        className="operator-profile-dialog"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <div>
            <span>LOCAL OPERATOR IDENTITY</span>
            <h2 id="operator-profile-title">操作員プロフィール</h2>
            <p>レビュー・承認・削除・提案の監査記録に使う本機内の表示情報です。</p>
          </div>
          <button aria-label="操作員プロフィールを閉じる" disabled={busy} onClick={onClose} type="button">×</button>
        </header>

        <div className="operator-profile-body">
          {!profile.configured ? (
            <div className="operator-profile-callout"><Icon name="alert" size={17} /><span><strong>プロフィール未設定</strong>現在の新規操作は中立名「本機ユーザー」で記録されます。</span></div>
          ) : null}
          <div className="operator-profile-fields">
            <label>表示名<input autoComplete="name" data-initial-focus="true" maxLength={80} onChange={(event) => setDisplayName(event.target.value)} placeholder="例：佐藤 美咲" value={displayName} /></label>
            <label>役割<input autoComplete="organization-title" maxLength={40} onChange={(event) => setRoleLabel(event.target.value)} placeholder="例：SES営業担当" value={roleLabel} /></label>
          </div>
          <div className="operator-profile-policy">
            <div><Icon name="lock" size={15} /><span><strong>保存先</strong> SQLCipher 暗号化ローカルDB</span></div>
            <div><Icon name="shield" size={15} /><span><strong>Cloud</strong> プロフィールは送信対象外</span></div>
            <div><Icon name="check" size={15} /><span><strong>用途</strong> 新しく作成する監査記録の操作員表示</span></div>
          </div>
          <p className="operator-profile-history-note">既存の監査記録は改変しません。表示名を変更しても、過去の承認者名は当時の記録として保持されます。</p>
          {profile.configured ? <p className="operator-profile-id">Operator ID <code>{profile.operatorId}</code> · Revision {profile.revision}</p> : null}
          {error ? <p className="operator-profile-error" role="alert"><Icon name="alert" size={15} />{error}</p> : null}
        </div>

        <footer>
          <button disabled={busy} onClick={onClose} type="button">キャンセル</button>
          <button disabled={!canSave} onClick={() => void save()} type="button">{busy ? '保存中…' : '暗号化して保存'}</button>
        </footer>
      </section>
    </div>
  )
}
