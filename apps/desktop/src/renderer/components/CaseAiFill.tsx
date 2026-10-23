import { useState } from 'react'
import type { JobCaseFieldKey, JobCaseReviewSnapshot } from '@shared'
import {
  aiServiceProblem,
  localizedCaseFieldLabel,
  localizedIpcError,
  localizedJobCaseFieldLabel,
  useLocaleText,
  type AiServiceProblem
} from '../i18n'
import { AiServiceProblemActions } from './AiServiceProblemActions'
import { Icon } from './Icon'
import './case-ai-fill.css'

/** The fields HR matches and introduces on; Main completes a newly imported case when one of them is empty. */
const keyFields: readonly string[] = ['start_date', 'location', 'rate', 'required_skills']

/**
 * Completes a case's empty fields with AI from its own source text; a field with a value is never touched.
 * `key` offers it when one of the key fields is empty, `all` whenever any field but the title is.
 */
export function CaseAiFill({ review, scope }: { review: JobCaseReviewSnapshot; scope: 'key' | 'all' }) {
  const { locale, t } = useLocaleText()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ kind: 'filled' | 'none' | 'error'; text: string; problem: AiServiceProblem | null } | null>(null)
  if (review.lifecycle !== 'active' || review.status !== 'completed' || !window.sesAgent.fillJobCaseFieldsWithAi) return null
  const empty = review.fields.filter(
    (field) => field.value === null && field.key !== 'title' && (scope === 'all' || keyFields.includes(field.key))
  )
  if (!empty.length && !result) return null
  // The labels the case's own field list shows.
  const label = (key: string) => {
    const field = review.fields.find((item) => item.key === key)
    return field ? localizedCaseFieldLabel(locale, field) : localizedJobCaseFieldLabel(locale, key as JobCaseFieldKey)
  }
  const labels = (keys: readonly string[]) => keys.map(label).join('・')
  const fill = async () => {
    setBusy(true)
    setResult(null)
    try {
      const { filled } = await window.sesAgent.fillJobCaseFieldsWithAi(review.reviewId)
      if (filled.length) window.dispatchEvent(new Event('ses-business-data-changed'))
      setResult(
        filled.length
          ? { kind: 'filled', text: t(`已用 AI 补全：${labels(filled)}`, `AIで補完しました：${labels(filled)}`), problem: null }
          : {
              kind: 'none',
              text: t('原文中没有找到可补全的内容。', '原文から補完できる項目は見つかりませんでした。'),
              problem: null
            }
      )
    } catch (cause) {
      const unavailable = String(cause).includes('CASE_AI_UNAVAILABLE')
      setResult({
        kind: 'error',
        text: unavailable
          ? t('AI 不可用，请先登录 AI 会员。', 'AIを利用できません。AI会員にログインしてください。')
          : localizedIpcError(
              locale,
              cause,
              t('AI 补全失败，请稍后重试。', 'AIで補完できませんでした。しばらくしてから再試行してください。')
            ),
        problem: unavailable ? 'sign-in' : aiServiceProblem(cause)
      })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={scope === 'key' ? 'case-ai-fill is-key' : 'case-ai-fill'}>
      {empty.length ? (
        <div className="case-ai-fill-row">
          <span>
            {scope === 'key'
              ? t(`未填写：${labels(empty.map((field) => field.key))}`, `未入力：${labels(empty.map((field) => field.key))}`)
              : t('可以用 AI 从原文补全空白项目。', '空欄の項目を原文からAIで補完できます。')}
          </span>
          <button disabled={busy} onClick={() => void fill()} type="button">
            <Icon name="sparkles" size={13} />
            {busy ? t('AI 正在读取原文…', 'AIが原文を確認中…') : t('用 AI 补全', 'AIで補完')}
          </button>
        </div>
      ) : null}
      {result ? (
        <p className={`case-ai-fill-result is-${result.kind}`} role={result.kind === 'error' ? 'alert' : 'status'}>
          {result.text}
          <AiServiceProblemActions problem={result.problem} />
        </p>
      ) : null}
    </div>
  )
}
