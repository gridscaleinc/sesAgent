import { matchEvidenceSections, proposalConclusion, requirementDimension, requirementDisplayLabel, type BusinessMatchQualification, type MatchRequirementEvidence } from '@shared'
import './business-match-evidence.css'

/** One fact appears in one section. Only technical/language evidence decides
 * the proposal conclusion; commercial differences remain follow-up items. */
export function BusinessMatchEvidence({ qualification, questions = [], zh }: {
  qualification?: BusinessMatchQualification; questions?: string[]; zh: boolean
}) {
  const t = (cn: string, ja: string) => zh ? cn : ja
  const sections = matchEvidenceSections(qualification, questions)
  const requirements = qualification?.requirements ?? []
  const dimensionStatus = (dimension: 'technical' | 'language') => {
    const items = requirements.filter(item => requirementDimension(item.requirement) === dimension)
    if (!items.length) return dimension === 'language' ? t('案件未限定', '案件の指定なし') : t('案件要求待补充', '案件要件の補足が必要')
    return items.some(item => item.outcome === 'conflict') ? t('存在差距', '要件との差あり')
      : items.some(item => item.outcome === 'unknown') ? t('信息待补充', '情報の補足が必要') : t('符合要求', '要件を満たす')
  }
  const evidence = (items: MatchRequirementEvidence[], kind: 'met' | 'conflict' | 'pending') => <dl className={`case-assessment-evidence is-${kind}`}>{items.map(item => <div key={item.requirement.id}>
    <dt>{requirementDisplayLabel(item.requirement, zh)}{kind === 'pending' && item.outcome === 'conflict' ? ` · ${t('条件有差异，需协商', '条件に相違あり・要相談')}` : ''}</dt>
    <dd>{item.evidence ?? (kind === 'conflict' ? t('当前简历未体现此项必需技能或经验。', '現在の履歴書に必須のスキル・経験の記載がありません。')
      : kind === 'pending' ? t('人员资料尚未说明此项，请在沟通时补充。', '要員情報に記載がありません。連絡時に確認してください。') : '')}
      {item.source ? <small> · {item.source}</small> : null}
      {kind === 'pending' && item.evidence && item.outcome === 'unknown' ? <small> · {t('以上信息已有记录，需确认其是否满足本案要求。', '上記は記録済みです。案件要件への適合を確認してください。')}</small> : null}</dd>
  </div>)}</dl>
  return <section className="business-match-evidence">
    <strong className="case-assessment-conclusion">{proposalConclusion(qualification, zh)}</strong>
    <p className="case-assessment-dimensions">{t('技术', '技術')}：{dimensionStatus('technical')} · {t('语言', '言語')}：{dimensionStatus('language')}</p>
    {sections.conflicts.length ? <div className="case-assessment-decision"><strong>{t('本案要求的差距', '案件要件との差')}</strong>{evidence(sections.conflicts, 'conflict')}</div> : null}
    {sections.met.length ? <div><strong>{t('符合要求的依据', '要件を満たす根拠')}</strong>{evidence(sections.met, 'met')}</div> : null}
    {sections.corePending.length ? <div><strong>{t('需要补充的核心信息', '補足が必要なコア情報')}</strong>{evidence(sections.corePending, 'pending')}</div> : null}
    {qualification?.status === 'recommended' && (sections.businessPending.length || sections.questions.length) ? <div><strong>{t('提案时需沟通', '提案時に相談すること')}</strong>
      <p>{t('以下事项不降低技术和语言的匹配结论。', '以下の条件は、技術・言語の適合判定には影響しません。')}</p>
      {evidence(sections.businessPending, 'pending')}
      {sections.questions.length ? <ul>{sections.questions.map(question => <li key={question}>{question}</li>)}</ul> : null}
    </div> : null}
  </section>
}
