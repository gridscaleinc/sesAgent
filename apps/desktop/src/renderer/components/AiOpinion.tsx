import type { MatchAiOpinion } from '@shared'
import { localeText } from '../i18n'
import { matchAssessmentFitLabel } from './MatchAssessmentView'
import './ai-opinion.css'

/**
 * What the cloud model itself wrote about one match. It is never checked against the resume and never decides the
 * conclusion above it, so it is set apart and labelled as unverified opinion.
 */
export function AiOpinion({ opinion, zh }: { opinion?: MatchAiOpinion; zh: boolean }) {
  const t = localeText(zh)
  if (!opinion || (!opinion.reason && !opinion.gaps.length && !opinion.confirm.length)) return null
  return (
    <aside className="ai-opinion" aria-label={t('AI 意见', 'AIの意見')}>
      <header>
        <strong>{t('AI 意见，仅供参考，未核实', 'AIの意見・参考情報（未確認）')}</strong>
        <em>
          {t('AI 判断的适合度：', 'AIの判断した適合度：')}
          {matchAssessmentFitLabel(opinion.fit, zh)}
        </em>
      </header>
      {opinion.reason ? <p>{opinion.reason}</p> : null}
      {opinion.gaps.length ? (
        <p>
          <span>{t('AI 认为不足', 'AIが挙げた不足')}</span>
          {opinion.gaps.join(' · ')}
        </p>
      ) : null}
      {opinion.confirm.length ? (
        <p>
          <span>{t('AI 建议确认', 'AIが挙げた確認事項')}</span>
          {opinion.confirm.join(' · ')}
        </p>
      ) : null}
      <small>
        {t(
          '以上是 AI 自己写的内容，没有和简历原文核对，不影响上面的匹配结论。',
          '上記はAIが書いた内容で、履歴書の原文とは照合していません。上の判定には影響しません。'
        )}
      </small>
    </aside>
  )
}
