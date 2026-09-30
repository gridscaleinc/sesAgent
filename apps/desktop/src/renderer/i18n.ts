import { createContext, createElement, useContext, type ReactNode } from 'react'
import type { ApplicationLocale } from '@shared'
import { hasLocalizedMainText, localizedMainText } from './main-message-catalog'

export {
  localizedCandidateFieldLabel,
  localizedCaseFieldLabel,
  localizedJobCaseFieldLabel,
  localizedMainText,
  localizedTaskTitle
} from './main-message-catalog'

const UiLocaleContext = createContext<ApplicationLocale>('ja-JP')

export function UiLocaleProvider({ children, locale }: { children: ReactNode; locale: ApplicationLocale }) {
  return createElement(UiLocaleContext.Provider, { value: locale }, children)
}

export function useUiLocale(): ApplicationLocale {
  return useContext(UiLocaleContext)
}

/** Picks the Chinese or Japanese wording written side by side at the call site: t('中文', '日本語'). */
export function localeText(zh: boolean): (cn: string, ja: string) => string {
  return (cn, ja) => (zh ? cn : ja)
}

export function useLocaleText(): { locale: ApplicationLocale; zh: boolean; t: (cn: string, ja: string) => string } {
  const locale = useUiLocale(),
    zh = locale === 'zh-CN'
  return { locale, zh, t: localeText(zh) }
}

const ipcInvokeErrorPrefix = /^(?:Error: )?Error invoking remote method '[^']+':\s*(?:Error:\s*)?/u

export type AiServiceProblem = 'sign-in' | 'network' | 'quota' | 'timeout'

/**
 * Recognizes the AI member service's known failures (raw "AiCommerceRequestError: Please sign in…" and the like),
 * so every AI surface can say what happened and what to do instead of showing the English diagnostic.
 */
export function aiServiceProblem(cause: unknown): AiServiceProblem | null {
  const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''
  if (!message) return null
  if (
    /MEMBER_SIGN_IN_REQUIRED|MEMBER_SESSION_EXPIRED|TOKEN_INVALID|TOKEN_REVOKED|token_expired|Please sign in to Member Center|AI sign-in has (?:expired|been revoked)|Member Center session expired/iu.test(
      message
    )
  )
    return 'sign-in'
  if (/INSUFFICIENT_CREDITS|not enough available AI credits/iu.test(message)) return 'quota'
  if (/AI_GATEWAY_TIMEOUT|AI request timed out/iu.test(message)) return 'timeout'
  if (/AiCommerceRequestError.*NETWORK_ERROR|(?:membership or AI|The AI) service could not be reached/iu.test(message)) return 'network'
  return null
}

export function localizedAiServiceProblem(locale: ApplicationLocale, problem: AiServiceProblem): string {
  const t = localeText(locale === 'zh-CN')
  if (problem === 'sign-in')
    return t('AI 未登录，请先登录 AI 会员后重试。', 'AIにログインしていません。AI会員にログインしてから再試行してください。')
  if (problem === 'quota')
    return t(
      'AI 可用额度不足，请在 AI 会员中确认额度后重试。',
      'AIの利用可能クレジットが不足しています。AI会員で残高を確認してから再試行してください。'
    )
  if (problem === 'timeout') return t('AI 响应超时，请稍后重试。', 'AIの応答がタイムアウトしました。しばらくしてから再試行してください。')
  return t('无法连接 AI 服务，请检查网络后重试。', 'AIサービスに接続できません。ネットワークを確認してから再試行してください。')
}

/** Asks the app shell to open the AI member sign-in (the AI member dialog). */
export const aiSignInRequestEvent = 'ses-open-ai-sign-in'
export function requestAiSignIn() {
  window.dispatchEvent(new Event(aiSignInRequestEvent))
}

export function localizedIpcError(locale: ApplicationLocale, cause: unknown, fallback: string): string {
  const fallbackText = localizedMainText(locale, fallback)
  if (!(cause instanceof Error)) return fallbackText
  const normalized = cause.message.replace(ipcInvokeErrorPrefix, '').trim()
  if (!normalized) return fallbackText
  const aiProblem = aiServiceProblem(cause)
  if (aiProblem) return localizedAiServiceProblem(locale, aiProblem)
  // Schema/transport diagnostics are not useful instructions for the operator.
  if (/^[\[{]/u.test(normalized) || /^(?:ZodError|TypeError|SqliteError|SQLITE_\w*|Error)[:\s]/u.test(normalized)) return fallbackText
  if (locale === 'zh-CN' && hasLocalizedMainText(normalized)) return localizedMainText(locale, normalized)
  // Main-process messages are often written "中文 / 日本語": show the half for this locale, not a generic fallback.
  const bilingual = localizedHalf(locale, normalized)
  if (bilingual) return bilingual
  if (locale === 'zh-CN' && /[\u3040-\u30ff]/u.test(normalized)) return fallbackText
  return normalized
}

function localizedHalf(locale: ApplicationLocale, message: string): string | null {
  const kana = /[\u3040-\u30ff]/u
  for (let index = message.indexOf(' / '); index >= 0; index = message.indexOf(' / ', index + 1)) {
    const chinese = message.slice(0, index).trim(),
      japanese = message.slice(index + 3).trim()
    // The Chinese half is a sentence (Han characters, closing punctuation; it may quote a Japanese field label),
    // so "Java / Spring Bootの案件" is not split.
    const sentence = /\p{Script=Han}/u.test(chinese) && /[。！？）]$/u.test(chinese)
    if (sentence && japanese && kana.test(japanese)) return locale === 'zh-CN' ? chinese : japanese
  }
  return null
}

export function localizedWorkDate(locale: ApplicationLocale, now = new Date()): string {
  const parts = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' }).formatToParts(now)
  const values = new Map(parts.map((part) => [part.type, part.value]))
  if (locale === 'zh-CN') return `${values.get('year')}.${values.get('month')}.${values.get('day')} · ${values.get('weekday')}`
  return `${(values.get('weekday') ?? '').toLocaleUpperCase('en-US')} · ${values.get('year')}.${values.get('month')}.${values.get('day')}`
}
