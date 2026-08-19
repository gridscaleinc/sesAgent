import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type {
  PrepareAiCommerceCloudPromptInput,
  AiCommerceCloudPromptResult,
  AiCommerceMembershipState,
  BootstrapPayload
} from '@shared'
import { localizedIpcError, useUiLocale } from '../i18n'
import { Icon } from './Icon'

interface AiCommerceMemberDialogProps {
  state: AiCommerceMembershipState
  privacy: BootstrapPayload['privacy']
  callbackError: string | null
  onClose(): void
  onConnect(): Promise<AiCommerceMembershipState>
  onRefresh(): Promise<AiCommerceMembershipState>
  onDisconnect(): Promise<AiCommerceMembershipState>
  onResetToken(): Promise<AiCommerceMembershipState>
  onOpenMemberCenter(): Promise<{ opened: true }>
  onSendPrompt(input: PrepareAiCommerceCloudPromptInput): Promise<AiCommerceCloudPromptResult>
}

function formatCredits(credits: number): string {
  return new Intl.NumberFormat('ja-JP').format(credits)
}

export function AiCommerceMemberDialog({
  state: initialState,
  privacy,
  callbackError,
  onClose,
  onConnect,
  onRefresh,
  onDisconnect,
  onResetToken,
  onOpenMemberCenter,
  onSendPrompt
}: AiCommerceMemberDialogProps) {
  const locale = useUiLocale()
  const dialogRef = useRef<HTMLElement | null>(null)
  const openerRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const [state, setState] = useState(initialState)
  const [busy, setBusy] = useState<'connect' | 'refresh' | 'disconnect' | 'reset' | 'member-center' | 'prompt' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [result, setResult] = useState<AiCommerceCloudPromptResult | null>(null)

  useEffect(() => setState(initialState), [initialState])

  useEffect(() => {
    if (callbackError) setError(callbackError)
  }, [callbackError])

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
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
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

  const run = async (
    activity: NonNullable<typeof busy>,
    operation: () => Promise<AiCommerceMembershipState | { opened: true } | AiCommerceCloudPromptResult>
  ) => {
    if (busy) return
    setBusy(activity)
    setError(null)
    try {
      const response = await operation()
      if ('configuration' in response) setState(response)
      if ('requestId' in response) setResult(response)
    } catch (cause) {
      setError(localizedIpcError(locale, cause, 'Member Center または AICommerce の操作に失敗しました。'))
    } finally {
      setBusy(null)
    }
  }

  const configured = state.configuration === 'ready'
  const connected = state.connection === 'connected'
  const authorizing = state.connection === 'authorizing'
  const cloudPrivacyReady = privacy.qualityGate.status === 'passed'
  const expertEvaluationReady = privacy.expertGate.status === 'passed'
  const sendEnabled = cloudPrivacyReady && connected && busy === null && content.trim().length > 0 && state.capabilities.length > 0
  const billingLabel = state.billingMode === 'automatic'
    ? '包月优先'
    : state.billingMode === 'subscription' ? '仅包月' : '普通钱包'
  const billingDetail = state.billingMode === 'automatic'
    ? '包月策略未配置或额度耗尽时，只对明确的额度错误切换充值余额。'
    : state.billingMode === 'subscription'
      ? '只使用包月额度，不切换充值余额。'
      : '只使用普通钱包与充值余额。'

  return (
    <div className="aicommerce-member-backdrop" role="presentation">
      <section
        aria-labelledby="aicommerce-member-title"
        aria-modal="true"
        className="aicommerce-member-dialog"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <div>
            <span>MEMBER CENTER · AICOMMERCE</span>
            <h2 id="aicommerce-member-title">会員と Cloud AI</h2>
            <p>Member Center で会員を認証し、AICommerce のユーザー用トークンだけで Cloud AI を利用します。</p>
          </div>
          <button aria-label="会員と Cloud AI を閉じる" data-initial-focus="true" disabled={busy !== null} onClick={onClose} type="button">×</button>
        </header>

        <div className="aicommerce-member-body">
          {!configured ? <section className="aicommerce-member-required">
            <Icon name="lock" size={19} />
            <div><strong>受管接続設定が必要です</strong><span>Native Client ID、業務コード、登録済み callback URI と課金モードをアプリ配布設定に登録してください。利用者が API key やサービス間キーを入力することはありません。</span></div>
          </section> : <>
            <section className="aicommerce-member-status" aria-label="会員接続状態">
              <div><span>MEMBERSHIP</span><strong>{connected ? (state.memberDisplayName ?? '接続済みメンバー') : authorizing ? 'ブラウザでログイン中' : state.connection === 'reauthentication-required' ? '再ログインが必要' : '未接続'}</strong><small>{connected ? 'Native PKCE と OS 保護領域に保存したユーザー状態で接続中です。' : authorizing ? 'Member Center でログインを完了すると、この画面へ自動反映します。' : 'システムブラウザで Member Center にサインインします。'}</small></div>
              <div><span>BILLING MODE</span><strong>{billingLabel}</strong><small>{billingDetail}</small></div>
              <div><span>AI WALLET</span><strong>{state.wallet ? `${formatCredits(Math.max(0, state.wallet.balanceCredits - state.wallet.reservedCredits))} credits` : '未照会'}</strong><small>{state.wallet ? `予約済み ${formatCredits(state.wallet.reservedCredits)} credits` : '接続後に残高と利用可能な能力を読み込みます。'}</small></div>
            </section>

            <div className="aicommerce-member-actions">
              {!connected ? <button disabled={busy !== null || authorizing} onClick={() => void run('connect', onConnect)} type="button"><Icon name="lock" size={16} />{authorizing || busy === 'connect' ? 'ブラウザでログイン中…' : 'Member Center にサインイン'}</button> : <>
                <button disabled={busy !== null} onClick={() => void run('refresh', onRefresh)} type="button"><Icon name="database" size={16} />{busy === 'refresh' ? '更新中…' : '残高と能力を更新'}</button>
                <button disabled={busy !== null} onClick={() => void run('member-center', onOpenMemberCenter)} type="button"><Icon name="settings" size={16} />会員・請求をブラウザで管理</button>
                <button disabled={busy !== null} onClick={() => void run('reset', onResetToken)} type="button">{busy === 'reset' ? '更新中…' : 'AI Token を再発行'}</button>
                <button className="aicommerce-member-disconnect" disabled={busy !== null} onClick={() => void run('disconnect', onDisconnect)} type="button">サインアウト</button>
              </>}
            </div>

            {connected ? <section className="aicommerce-prompt" aria-label="Cloud AI">
              <div className="aicommerce-prompt-heading"><Icon name="sparkles" size={17} /><div><strong>脱敏済みテキストで Cloud AI を実行</strong><span>AICommerce が返す active な chat/text 能力を自動選択し、同一操作の再送では同じ request_id を保持します。401 は安全に token を更新、202 は最大 60 秒ポーリングします。</span></div></div>
              <div className="aicommerce-capability-summary"><strong>{state.capabilities.length} 个可用能力</strong><span>{state.capabilities.map((capability) => capability.displayName).join('、') || '能力を読み込んでください'}</span></div>
              <label>依頼内容<textarea disabled={busy !== null} maxLength={12000} onChange={(event) => setContent(event.target.value)} placeholder="個人を特定できない業務テキストだけを入力してください。" value={content} /></label>
              <div className="aicommerce-prompt-confirmation"><Icon name={cloudPrivacyReady ? 'shield' : 'alert'} size={16} /><span><strong>{cloudPrivacyReady ? 'Cloud AI プライバシー門は有効です' : 'Cloud AI はプライバシー門で停止中です'}</strong><small>{cloudPrivacyReady
                ? expertEvaluationReady
                  ? `固定合成品質門を確認済み · 日本語専門家評価も確認済み${privacy.expertGate.evaluatedAt ? ` · 専門家報告 ${privacy.expertGate.evaluatedAt}` : ''}`
                  : '固定合成品質門を確認済み。日本語専門家評価は未完了ですが、任意の品質・監査証跡であり Cloud AI の実行は妨げません。'
                : '固定合成プライバシー品質報告を現在のパッケージで確認できません。'}</small>{expertEvaluationReady && privacy.expertGate.evaluatedAt
                ? <small>{locale === 'zh-CN' ? '专家报告时间：' : '専門家報告日時: '}{privacy.expertGate.evaluatedAt}</small>
                : null}</span></div>
              <div className="aicommerce-prompt-confirmation"><Icon name="shield" size={16} /><span><strong>送信前に Main の確認画面を表示します</strong><small>ローカル NER・規則脱敏・独立 DLP を実行し、脱敏済みプレビューを原生確認画面で承認した場合だけ送信します。</small></span></div>
              <div className="aicommerce-prompt-footer"><span>Cloud AI の出力はこの画面のセッション中だけ表示し、元の入力や token をログに記録しません。</span><button disabled={!sendEnabled} onClick={() => void run('prompt', () => onSendPrompt({ content: content.trim() }))} type="button">{busy === 'prompt' ? '確認を準備中…' : '脱敏プレビューを確認'}</button></div>
              {result ? <article className="aicommerce-prompt-result"><header><strong>AI 応答 · {result.billingModeUsed === 'subscription' ? '包月' : '钱包'}</strong><span>{result.usageCredits === null ? '利用量は未提供' : `${formatCredits(result.usageCredits)} credits`}</span></header><p>{result.content}</p>{result.removedIdentifierTypes.length > 0 ? <small>送信前に置換: {result.removedIdentifierTypes.join(', ')}</small> : null}</article> : null}
            </section> : null}
          </>}
          {error ? <p className="aicommerce-member-error" role="alert"><Icon name="alert" size={15} />{error}</p> : null}
        </div>

        <footer><button disabled={busy !== null} onClick={onClose} type="button">閉じる</button></footer>
      </section>
    </div>
  )
}
