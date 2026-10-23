import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { LocalOperatorProfile, SaveLocalOperatorProfileInput } from '@shared'
import { Icon } from './Icon'
import { localizedIpcError, useLocaleText } from '../i18n'

interface LocalOperatorProfileDialogProps {
  profile: LocalOperatorProfile
  onClose(): void
  onSave(input: SaveLocalOperatorProfileInput): Promise<LocalOperatorProfile>
}

export function LocalOperatorProfileDialog({ profile, onClose, onSave }: LocalOperatorProfileDialogProps) {
  const { locale, t } = useLocaleText()
  const dialogRef = useRef<HTMLElement | null>(null)
  const openerRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const [displayName, setDisplayName] = useState(profile.configured ? profile.displayName : '')
  // i18n-ignore: default role value saved to the operator profile
  const [roleLabel, setRoleLabel] = useState(profile.configured ? profile.roleLabel : t('营业负责人', '営業担当'))
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
      setError(localizedIpcError(locale, cause, t('无法保存个人资料。', 'プロフィールを保存できませんでした。')))
      setBusy(false)
    }
  }

  const canSave =
    !busy &&
    displayName.trim().length >= 2 &&
    displayName.trim().length <= 80 &&
    roleLabel.trim().length >= 2 &&
    roleLabel.trim().length <= 40

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
            <span>{t('账户', 'アカウント')}</span>
            <h2 id="operator-profile-title">{t('个人资料', 'プロフィール')}</h2>
            <p>{t('你的名字会显示在跟进、提案等操作记录中。', '名前は対応記録や提案などの操作履歴に表示されます。')}</p>
          </div>
          <button
            className="close-button"
            aria-label={t('关闭个人资料', 'プロフィールを閉じる')}
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="operator-profile-body">
          {!profile.configured ? (
            <div className="operator-profile-callout">
              <Icon name="alert" size={17} />
              <span>
                <strong>{t('还没有设置名字', '名前が未設定です')}</strong>
                {t('设置之前，操作记录中会显示为“本机用户”。', '設定するまで、操作履歴には「本機ユーザー」と表示されます。')}
              </span>
            </div>
          ) : null}
          <div className="operator-profile-fields">
            <label>
              {t('显示名称', '表示名')}
              <input
                autoComplete="name"
                data-initial-focus="true"
                maxLength={80}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={t('例如：张晓琳', '例：佐藤 美咲')}
                value={displayName}
              />
            </label>
            <label>
              {t('角色', '役割')}
              <input
                autoComplete="organization-title"
                maxLength={40}
                onChange={(event) => setRoleLabel(event.target.value)}
                placeholder={t('例如：SES 销售负责人', '例：SES営業担当')}
                value={roleLabel}
              />
            </label>
          </div>
          <div className="operator-profile-policy">
            <div>
              <Icon name="lock" size={15} />
              <span>{t('只加密保存在这台电脑里。', 'この端末の中だけに暗号化して保存します。')}</span>
            </div>
            <div>
              <Icon name="shield" size={15} />
              <span>{t('不会发送给云端 AI。', 'クラウドのAIには送信しません。')}</span>
            </div>
          </div>
          <p className="operator-profile-history-note">
            {t('修改名字后，之前的记录仍显示当时的名字。', '名前を変えても、これまでの記録は当時の名前のまま残ります。')}
          </p>
          {error ? (
            <p className="operator-profile-error" role="alert">
              <Icon name="alert" size={15} />
              {error}
            </p>
          ) : null}
        </div>

        <footer>
          <button disabled={busy} onClick={onClose} type="button">
            {t('取消', 'キャンセル')}
          </button>
          <button disabled={!canSave} onClick={() => void save()} type="button">
            {busy ? t('正在保存…', '保存中…') : t('保存', '保存')}
          </button>
        </footer>
      </section>
    </div>
  )
}
