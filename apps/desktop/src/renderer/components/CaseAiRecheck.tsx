import { useState } from 'react'
import type { JobCaseFieldCorrectionSuggestions, JobCaseFieldKey, JobCaseReviewSnapshot } from '@shared'
import { aiServiceProblem, localizedCaseFieldLabel, localizedIpcError, useLocaleText, type AiServiceProblem } from '../i18n'
import { AiServiceProblemActions } from './AiServiceProblemActions'
import { Icon } from './Icon'
import './case-ai-fill.css'

/**
 * 「AIで再確認」: when HR thinks a case's fields do not match its mail, the AI re-reads the source and lists each
 * field whose stated value differs (the case's value → the source's). Nothing changes until HR applies the ones
 * it ticks; a field the source does not state is never suggested for removal.
 */
export function CaseAiRecheck({ review }: { review: JobCaseReviewSnapshot }) {
  const { locale, t } = useLocaleText()
  const [busy, setBusy] = useState<'check' | 'apply' | null>(null)
  const [suggestions, setSuggestions] = useState<JobCaseFieldCorrectionSuggestions | null>(null)
  const [accepted, setAccepted] = useState<Set<JobCaseFieldKey>>(new Set())
  const [message, setMessage] = useState<{ kind: 'done' | 'none' | 'error'; text: string; problem: AiServiceProblem | null } | null>(null)
  if (review.lifecycle !== 'active' || review.status !== 'completed' || !window.sesAgent.suggestJobCaseFieldCorrections) return null
  const label = (key: string) => {
    const field = review.fields.find((item) => item.key === key)
    return field ? localizedCaseFieldLabel(locale, field) : key
  }
  const failed = (cause: unknown, fallback: string) => {
    const unavailable = String(cause).includes('CASE_AI_UNAVAILABLE')
    setMessage({
      kind: 'error',
      text: unavailable
        ? t('AI 不可用，请先登录 AI 会员。', 'AIを利用できません。AI会員にログインしてください。')
        : localizedIpcError(locale, cause, fallback),
      problem: unavailable ? 'sign-in' : aiServiceProblem(cause)
    })
  }
  const check = async () => {
    setBusy('check')
    setMessage(null)
    setSuggestions(null)
    try {
      const result = await window.sesAgent.suggestJobCaseFieldCorrections(review.reviewId)
      if (!result.corrections.length) {
        setMessage({ kind: 'none', text: t('与原文一致，没有修改建议。', '原文と一致しています。修正の提案はありません。'), problem: null })
        return
      }
      setSuggestions(result)
      setAccepted(new Set(result.corrections.map((item) => item.key)))
    } catch (cause) {
      failed(cause, t('AI 确认失败，请稍后重试。', 'AIで確認できませんでした。しばらくしてから再試行してください。'))
    } finally {
      setBusy(null)
    }
  }
  const apply = async () => {
    if (!suggestions) return
    setBusy('apply')
    setMessage(null)
    try {
      const { filled } = await window.sesAgent.applyJobCaseFieldCorrections({
        reviewId: suggestions.reviewId,
        reviewRevision: suggestions.reviewRevision,
        keys: suggestions.corrections.map((item) => item.key).filter((key) => accepted.has(key))
      })
      setSuggestions(null)
      if (filled.length) window.dispatchEvent(new Event('ses-business-data-changed'))
      setMessage({
        kind: 'done',
        text: filled.length
          ? t(`已修改：${filled.map(label).join('・')}`, `修正しました：${filled.map(label).join('・')}`)
          : t('没有需要修改的项目。', '修正する項目はありませんでした。'),
        problem: null
      })
    } catch (cause) {
      failed(cause, t('修改失败，请重新确认。', '修正できませんでした。もう一度確認してください。'))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="case-ai-recheck">
      {suggestions ? (
        <section aria-label={t('AI 修改建议', 'AIの修正提案')} className="case-ai-recheck-panel">
          <header>
            <strong>
              {t(`AI 的修改建议（${suggestions.corrections.length} 项）`, `AIの修正提案（${suggestions.corrections.length}件）`)}
            </strong>
            <span>{t('勾选要采用的项目。', '反映する項目を選んでください。')}</span>
          </header>
          <ul>
            {suggestions.corrections.map((item) => (
              <li key={item.key}>
                <label>
                  <input
                    checked={accepted.has(item.key)}
                    disabled={busy !== null}
                    onChange={(event) =>
                      setAccepted((current) => {
                        const next = new Set(current)
                        if (event.target.checked) next.add(item.key)
                        else next.delete(item.key)
                        return next
                      })
                    }
                    type="checkbox"
                  />
                  <span className="case-ai-recheck-label">{label(item.key)}</span>
                </label>
                <span className="case-ai-recheck-change">
                  <span className={item.current === null ? 'case-ai-recheck-current is-empty' : 'case-ai-recheck-current'}>
                    {item.current ?? t('未填写', '未入力')}
                  </span>
                  <span aria-hidden="true">→</span>
                  <strong>{item.suggested}</strong>
                </span>
              </li>
            ))}
          </ul>
          <footer>
            <button disabled={busy !== null} onClick={() => setSuggestions(null)} type="button">
              {t('取消', 'キャンセル')}
            </button>
            <button className="is-primary" disabled={busy !== null || accepted.size === 0} onClick={() => void apply()} type="button">
              {busy === 'apply' ? t('正在修改…', '修正中…') : t(`采用选中的 ${accepted.size} 项`, `選んだ ${accepted.size} 件を反映`)}
            </button>
          </footer>
        </section>
      ) : (
        <div className="case-ai-recheck-row">
          <span>{t('觉得项目和原文对不上？', '項目が原文と合っていないと感じたら')}</span>
          <button disabled={busy !== null} onClick={() => void check()} type="button">
            <Icon name="sparkles" size={13} />
            {busy === 'check' ? t('AI 正在对照原文…', 'AIが原文と照合中…') : t('用 AI 重新确认', 'AIで再確認')}
          </button>
        </div>
      )}
      {message ? (
        <p
          className={`case-ai-fill-result is-${message.kind === 'done' ? 'filled' : message.kind}`}
          role={message.kind === 'error' ? 'alert' : 'status'}
        >
          {message.text}
          <AiServiceProblemActions problem={message.problem} />
        </p>
      ) : null}
    </div>
  )
}
