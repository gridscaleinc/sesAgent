import { useEffect, useId, useRef, useState } from 'react'
import type { AiCommerceMembershipState, LocalOperatorProfile, VendorSite } from '@shared'
import { localizedIpcError, localizedMainText, useLocaleText } from '../i18n'
import { walletNeedsRefresh } from './AiCommerceMemberDialog'
import { Icon } from './Icon'
import './account-menu.css'

interface AccountMenuProps {
  operator: LocalOperatorProfile
  aiMember: AiCommerceMembershipState
  onEditProfile(): void
  onOpenSettings(): void
  /** The AI member dialog: balance, billing and the Member Center sign-in. */
  onOpenAiMember(): void
  /** Fetches the current balance from the AI member service. */
  onRefreshAiMember?(): Promise<unknown>
  onAddCredits(): Promise<unknown>
  onSignIn(): Promise<unknown>
  onSignOut(): Promise<unknown>
  onOpenVendorSite(site: VendorSite): Promise<unknown>
}

export function availableAiCredits(state: AiCommerceMembershipState): number | null {
  return state.wallet ? Math.max(0, state.wallet.balanceCredits - state.wallet.reservedCredits) : null
}

/**
 * The account area at the top right: who is operating, the AI member sign-in state and credits, and the
 * account actions (profile, settings, sign-in / sign-out) in one place.
 */
export function AccountMenu({
  operator,
  aiMember,
  onEditProfile,
  onOpenSettings,
  onOpenAiMember,
  onRefreshAiMember,
  onAddCredits,
  onSignIn,
  onSignOut,
  onOpenVendorSite
}: AccountMenuProps) {
  const { locale, t } = useLocaleText()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const name = localizedMainText(locale, operator.displayName).trim() || operator.operatorId
  const initial = name.slice(0, 1).toLocaleUpperCase(locale) || 'S'
  const configured = aiMember.configuration === 'ready'
  const signedIn = aiMember.connection === 'connected'
  const authorizing = aiMember.connection === 'authorizing'
  const credits = availableAiCredits(aiMember)
  const memberStatus = signedIn
    ? t('已登录', 'ログイン中')
    : authorizing
      ? t('正在浏览器中登录', 'ブラウザでログイン中')
      : aiMember.connection === 'reauthentication-required'
        ? t('需要重新登录', '再ログインが必要')
        : t('未登录', '未ログイン')

  // Opened while signed in: refresh a balance that is unknown or older than a minute, without blocking the menu.
  const [walletRefreshing, setWalletRefreshing] = useState(false)
  useEffect(() => {
    if (!open || !onRefreshAiMember || !walletNeedsRefresh(aiMember)) return
    let active = true
    setWalletRefreshing(true)
    onRefreshAiMember()
      .catch(() => undefined)
      .finally(() => {
        if (active) setWalletRefreshing(false)
      })
    return () => {
      active = false
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    // Esc closes the menu wherever focus is, back to the trigger.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const choose = (action: () => void) => {
    setOpen(false)
    action()
  }
  const run = async (action: () => Promise<unknown>, keepOpen = false) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
      if (!keepOpen) setOpen(false)
    } catch (cause) {
      setError(
        localizedIpcError(locale, cause, t('操作未完成，请稍后重试。', '操作を完了できませんでした。しばらくしてから再試行してください。'))
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="account-menu" ref={root}>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t(`账户：${name}（AI 会员${memberStatus}）`, `アカウント：${name}（AI会員 ${memberStatus}）`)}
        className="account-menu-trigger"
        onClick={() => setOpen((current) => !current)}
        ref={trigger}
        title={name}
        type="button"
      >
        <span className={signedIn ? 'account-avatar is-signed-in' : 'account-avatar'} aria-hidden="true">
          {initial}
        </span>
        <span className="account-menu-name">{name}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      {open ? (
        <div
          aria-label={t('账户', 'アカウント')}
          className="account-menu-panel"
          id={panelId}
          role="dialog"
        >
          <header className="account-menu-identity">
            <span className={signedIn ? 'account-avatar is-large is-signed-in' : 'account-avatar is-large'} aria-hidden="true">
              {initial}
            </span>
            <div>
              <strong>{name}</strong>
              <small>{localizedMainText(locale, operator.roleLabel).trim() || t('负责人', '担当者')}</small>
            </div>
          </header>

          <section className="account-menu-member" aria-label={t('AI 会员', 'AI会員')}>
            <div className="account-menu-row">
              <span>{t('AI 会员', 'AI会員')}</span>
              <strong className={signedIn ? 'account-member-state is-signed-in' : 'account-member-state'}>
                <i aria-hidden="true" />
                {memberStatus}
                {signedIn && aiMember.memberDisplayName ? ` · ${aiMember.memberDisplayName}` : ''}
              </strong>
            </div>
            {signedIn ? (
              <div className="account-menu-row">
                <span>{t('AI 可用额度', 'AIクレジット残高')}</span>
                <strong>
                  {credits === null
                    ? walletRefreshing
                      ? t('正在读取…', '読み込み中…')
                      : t('未查询', '未照会')
                    : t(`${credits.toLocaleString('ja-JP')} 点`, `${credits.toLocaleString('ja-JP')} クレジット`)}
                </strong>
              </div>
            ) : null}
            {signedIn ? (
              <div className="account-menu-member-actions">
                <button onClick={() => choose(onOpenAiMember)} type="button">
                  <Icon name="wallet" size={14} />
                  {t('查看余额', '残高を確認')}
                </button>
                <button disabled={busy} onClick={() => void run(onAddCredits)} type="button">
                  <Icon name="plus" size={14} />
                  {t('充值额度', 'クレジットを追加')}
                </button>
              </div>
            ) : null}
          </section>

          <nav className="account-menu-actions" aria-label={t('账户操作', 'アカウント操作')}>
            <button onClick={() => choose(onEditProfile)} type="button">
              <Icon name="user" size={15} />
              {t('编辑个人资料', 'プロフィールを編集')}
            </button>
            <button onClick={() => choose(onOpenSettings)} type="button">
              <Icon name="settings" size={15} />
              {t('设置', '設定')}
            </button>
            {!configured ? (
              // Without the managed member settings the AI member dialog explains what is missing.
              <button className="account-menu-sign-in" onClick={() => choose(onOpenAiMember)} type="button">
                <Icon name="log-in" size={15} />
                {t('登录（AI 会员）', 'ログイン（AI会員）')}
              </button>
            ) : signedIn ? (
              <button className="account-menu-sign-out" disabled={busy} onClick={() => void run(onSignOut)} type="button">
                <Icon name="log-out" size={15} />
                {t('退出登录（AI 会员）', 'ログアウト（AI会員）')}
              </button>
            ) : authorizing ? (
              <button disabled={busy} onClick={() => void run(onSignOut, true)} type="button">
                <Icon name="log-out" size={15} />
                {t('取消登录', 'ログインをキャンセル')}
              </button>
            ) : (
              <button className="account-menu-sign-in" disabled={busy} onClick={() => void run(onSignIn, true)} type="button">
                <Icon name="log-in" size={15} />
                {t('登录（AI 会员）', 'ログイン（AI会員）')}
              </button>
            )}
          </nav>
          {authorizing ? (
            <p className="account-menu-note" role="status">
              {t('请在浏览器中完成登录，完成后这里会自动更新。', 'ブラウザでログインを完了すると、ここに自動で反映されます。')}
            </p>
          ) : null}
          {error ? (
            <p className="account-menu-note is-error" role="alert">
              {error}
            </p>
          ) : null}

          <footer className="account-menu-vendor">
            <span>{t('由 Gridscale 提供', '提供：グリッドスケール株式会社')}</span>
            <div>
              <button onClick={() => void run(() => onOpenVendorSite('gridscale'))} type="button">
                www.gridscale.com
                <Icon name="external-link" size={12} />
              </button>
              <button onClick={() => void run(() => onOpenVendorSite('appshelf'))} type="button">
                AppShelf
                <Icon name="external-link" size={12} />
              </button>
            </div>
          </footer>
        </div>
      ) : null}
    </div>
  )
}
