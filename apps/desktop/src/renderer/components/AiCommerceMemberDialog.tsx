import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { PrepareAiCommerceCloudPromptInput, AiCommerceCloudPromptResult, AiCommerceMembershipState, BootstrapPayload } from '@shared'
import { localizedIpcError, useLocaleText } from '../i18n'
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
  const { locale, t } = useLocaleText()
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
      setError(
        localizedIpcError(
          locale,
          cause,
          t('会员中心或 AICommerce 操作失败，请稍后重试。', 'Member Center または AICommerce の操作に失敗しました。')
        )
      )
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
  const billingLabel =
    state.billingMode === 'automatic'
      ? t('包月优先', '定額プラン優先')
      : state.billingMode === 'subscription'
        ? t('仅包月', '定額プランのみ')
        : t('普通钱包', '通常ウォレット')
  const billingDetail =
    state.billingMode === 'automatic'
      ? t(
          '包月策略未配置或额度耗尽时，只对明确的额度错误切换充值余额。',
          '定額プランが未設定または枠を使い切った場合、明確な枠不足エラーのときだけチャージ残高に切り替えます。'
        )
      : state.billingMode === 'subscription'
        ? t('只使用包月额度，不切换充值余额。', '定額プランの枠だけを使い、チャージ残高には切り替えません。')
        : t('只使用普通钱包与充值余额。', '通常ウォレットとチャージ残高だけを使います。')

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
            <h2 id="aicommerce-member-title">{t('会员与 Cloud AI', '会員と Cloud AI')}</h2>
            <p>
              {t(
                '通过 Member Center 验证会员，仅使用 AICommerce 用户令牌访问云端 AI。',
                'Member Center で会員を認証し、AICommerce のユーザー用トークンだけで Cloud AI を利用します。'
              )}
            </p>
          </div>
          <button
            aria-label={t('关闭会员与云端 AI', '会員と Cloud AI を閉じる')}
            data-initial-focus="true"
            disabled={busy !== null}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="aicommerce-member-body">
          {!configured ? (
            <section className="aicommerce-member-required">
              <Icon name="lock" size={19} />
              <div>
                <strong>{t('需要受管连接设置', '受管接続設定が必要です')}</strong>
                <span>
                  {t(
                    '请在应用分发设置中登记 Native Client ID、业务代码、已注册的回调 URI 和计费模式。用户无需输入 API Key 或服务间密钥。',
                    'Native Client ID、業務コード、登録済み callback URI と課金モードをアプリ配布設定に登録してください。利用者が API key やサービス間キーを入力することはありません。'
                  )}
                </span>
              </div>
            </section>
          ) : (
            <>
              <section className="aicommerce-member-status" aria-label={t('会员连接状态', '会員接続状態')}>
                <div>
                  <span>{t('会员', 'メンバーシップ')}</span>
                  <strong>
                    {connected
                      ? (state.memberDisplayName ?? t('已连接会员', '接続済みメンバー'))
                      : authorizing
                        ? t('正在浏览器中登录', 'ブラウザでログイン中')
                        : state.connection === 'reauthentication-required'
                          ? t('需要重新登录', '再ログインが必要')
                          : t('未连接', '未接続')}
                  </strong>
                  <small>
                    {connected
                      ? t(
                          '正在使用 Native PKCE 及保存在操作系统受保护区域中的用户状态连接。',
                          'Native PKCE と OS 保護領域に保存したユーザー状態で接続中です。'
                        )
                      : authorizing
                        ? t(
                            '在 Member Center 完成登录后，此页面会自动更新。',
                            'Member Center でログインを完了すると、この画面へ自動反映します。'
                          )
                        : t('将在系统浏览器中登录 Member Center。', 'システムブラウザで Member Center にサインインします。')}
                  </small>
                </div>
                <div>
                  <span>{t('计费方式', '課金方式')}</span>
                  <strong>{billingLabel}</strong>
                  <small>{billingDetail}</small>
                </div>
                <div>
                  <span>{t('AI 余额', 'AI 残高')}</span>
                  <strong>
                    {state.wallet
                      ? t(`${formatCredits(Math.max(0, state.wallet.balanceCredits - state.wallet.reservedCredits))} 点`, `${formatCredits(Math.max(0, state.wallet.balanceCredits - state.wallet.reservedCredits))} クレジット`)
                      : t('未查询', '未照会')}
                  </strong>
                  <small>
                    {state.wallet
                      ? t(
                          `已预留 ${formatCredits(state.wallet.reservedCredits)} 点`,
                          `予約済み ${formatCredits(state.wallet.reservedCredits)} クレジット`
                        )
                      : t('连接后读取余额和可用能力。', '接続後に残高と利用可能な能力を読み込みます。')}
                  </small>
                </div>
              </section>

              <div className="aicommerce-member-actions">
                {!connected ? (
                  <button disabled={busy !== null || authorizing} onClick={() => void run('connect', onConnect)} type="button">
                    <Icon name="lock" size={16} />
                    {authorizing || busy === 'connect'
                      ? t('正在浏览器中登录…', 'ブラウザでログイン中…')
                      : t('登录 Member Center', 'Member Center にサインイン')}
                  </button>
                ) : (
                  <>
                    <button disabled={busy !== null} onClick={() => void run('refresh', onRefresh)} type="button">
                      <Icon name="database" size={16} />
                      {busy === 'refresh' ? t('正在更新…', '更新中…') : t('刷新余额与能力', '残高と能力を更新')}
                    </button>
                    <button disabled={busy !== null} onClick={() => void run('member-center', onOpenMemberCenter)} type="button">
                      <Icon name="settings" size={16} />
                      {t('在浏览器中管理会员与账单', '会員・請求をブラウザで管理')}
                    </button>
                    <button disabled={busy !== null} onClick={() => void run('reset', onResetToken)} type="button">
                      {busy === 'reset' ? t('正在更新…', '更新中…') : t('重新签发 AI 令牌', 'AI Token を再発行')}
                    </button>
                    <button
                      className="aicommerce-member-disconnect"
                      disabled={busy !== null}
                      onClick={() => void run('disconnect', onDisconnect)}
                      type="button"
                    >
                      {t('退出登录', 'サインアウト')}
                    </button>
                  </>
                )}
              </div>

              {connected ? (
                <section className="aicommerce-prompt" aria-label="Cloud AI">
                  <div className="aicommerce-prompt-heading">
                    <Icon name="sparkles" size={17} />
                    <div>
                      <strong>{t('使用已脱敏文本运行云端 AI', '脱敏済みテキストで Cloud AI を実行')}</strong>
                      <span>
                        {t(
                          '自动选择 AICommerce 返回的可用 chat/text 能力；重试同一操作时保持相同 request_id。遇到 401 时安全刷新令牌，遇到 202 时最多轮询 60 秒。',
                          'AICommerce が返す active な chat/text 能力を自動選択し、同一操作の再送では同じ request_id を保持します。401 は安全に token を更新、202 は最大 60 秒ポーリングします。'
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="aicommerce-capability-summary">
                    <strong>{t(`${state.capabilities.length} 个可用能力`, `利用可能な能力 ${state.capabilities.length} 件`)}</strong>
                    <span>
                      {state.capabilities.map((capability) => capability.displayName).join('、') ||
                        t('请先读取可用能力', '能力を読み込んでください')}
                    </span>
                  </div>
                  <label>
                    {t('请求内容', '依頼内容')}
                    <textarea
                      disabled={busy !== null}
                      maxLength={12000}
                      onChange={(event) => setContent(event.target.value)}
                      placeholder={t('请仅输入无法识别个人身份的业务文本。', '個人を特定できない業務テキストだけを入力してください。')}
                      value={content}
                    />
                  </label>
                  <div className="aicommerce-prompt-confirmation">
                    <Icon name={cloudPrivacyReady ? 'shield' : 'alert'} size={16} />
                    <span>
                      <strong>
                        {cloudPrivacyReady
                          ? t('云端 AI 隐私门已生效', 'Cloud AI プライバシー門は有効です')
                          : t('云端 AI 已被隐私门阻止', 'Cloud AI はプライバシー門で停止中です')}
                      </strong>
                      <small>
                        {cloudPrivacyReady
                          ? expertEvaluationReady
                            ? t(
                                `固定合成质量门已验证，日文专家评估也已验证${privacy.expertGate.evaluatedAt ? ` · 专家报告 ${privacy.expertGate.evaluatedAt}` : ''}`,
                                `固定合成品質門を確認済み · 日本語専門家評価も確認済み${privacy.expertGate.evaluatedAt ? ` · 専門家報告 ${privacy.expertGate.evaluatedAt}` : ''}`
                              )
                            : t(
                                '固定合成质量门已验证。日文专家评估尚未完成，但它只是可选的质量与审计证据，不会阻止云端 AI 运行。',
                                '固定合成品質門を確認済み。日本語専門家評価は未完了ですが、任意の品質・監査証跡であり Cloud AI の実行は妨げません。'
                              )
                          : t(
                              '无法在当前安装包中验证固定合成隐私质量报告。',
                              '固定合成プライバシー品質報告を現在のパッケージで確認できません。'
                            )}
                      </small>
                      {expertEvaluationReady && privacy.expertGate.evaluatedAt ? (
                        <small>
                          {t('专家报告时间：', '専門家報告日時: ')}
                          {privacy.expertGate.evaluatedAt}
                        </small>
                      ) : null}
                    </span>
                  </div>
                  <div className="aicommerce-prompt-confirmation">
                    <Icon name="shield" size={16} />
                    <span>
                      <strong>{t('发送前会显示由 Main 进程控制的确认窗口', '送信前に Main の確認画面を表示します')}</strong>
                      <small>
                        {t(
                          '执行本地 NER、规则脱敏和独立 DLP；仅当用户在系统原生确认窗口批准脱敏预览后才会发送。',
                          'ローカル NER・規則脱敏・独立 DLP を実行し、脱敏済みプレビューを原生確認画面で承認した場合だけ送信します。'
                        )}
                      </small>
                    </span>
                  </div>
                  <div className="aicommerce-prompt-footer">
                    <span>
                      {t(
                        '云端 AI 输出仅在当前页面会话中显示；原始输入和令牌不会写入日志。',
                        'Cloud AI の出力はこの画面のセッション中だけ表示し、元の入力や token をログに記録しません。'
                      )}
                    </span>
                    <button
                      disabled={!sendEnabled}
                      onClick={() => void run('prompt', () => onSendPrompt({ content: content.trim() }))}
                      type="button"
                    >
                      {busy === 'prompt' ? t('正在准备确认…', '確認を準備中…') : t('确认脱敏预览', '脱敏プレビューを確認')}
                    </button>
                  </div>
                  {result ? (
                    <article className="aicommerce-prompt-result">
                      <header>
                        <strong>
                          {t('AI 响应', 'AI 応答')} ·{' '}
                          {result.billingModeUsed === 'subscription' ? t('包月', '定額プラン') : t('钱包', 'ウォレット')}
                        </strong>
                        <span>
                          {result.usageCredits === null
                            ? t('未提供使用量', '利用量は未提供')
                            : t(`${formatCredits(result.usageCredits)} 点`, `${formatCredits(result.usageCredits)} クレジット`)}
                        </span>
                      </header>
                      <p>{result.content}</p>
                      {result.removedIdentifierTypes.length > 0 ? (
                        <small>
                          {t('发送前替换：', '送信前に置換: ')}
                          {result.removedIdentifierTypes.join(', ')}
                        </small>
                      ) : null}
                    </article>
                  ) : null}
                </section>
              ) : null}
            </>
          )}
          {error ? (
            <p className="aicommerce-member-error" role="alert">
              <Icon name="alert" size={15} />
              {error}
            </p>
          ) : null}
        </div>

        <footer>
          <button disabled={busy !== null} onClick={onClose} type="button">
            {t('关闭', '閉じる')}
          </button>
        </footer>
      </section>
    </div>
  )
}
