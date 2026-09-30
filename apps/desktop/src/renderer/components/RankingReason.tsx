import { rankingFeatureNames, type RankingAdjustment } from '@shared'
import { localeText } from '../i18n'

export function RankingReason({ ranking, zh }: { ranking?: RankingAdjustment; zh: boolean }) {
  const t = localeText(zh)

  if (!ranking?.reasons.length) return null
  return (
    <details className="work-rule-applied">
      <summary>{t('推荐顺序依据', '推薦順の根拠')}</summary>
      <p>{t('在相同匹配等级内，采用已验证的业务偏好。', '同じ適合段階の中で、検証済みの業務傾向を適用しています。')}</p>
      <ul>
        {ranking.reasons.map((r) => (
          <li key={r.experience.id}>
            {rankingFeatureNames[r.feature][zh ? 'zh' : 'ja']} · {r.keyword} · v{r.experience.version}
            <blockquote>{r.evidence}</blockquote>
          </li>
        ))}
      </ul>
    </details>
  )
}
