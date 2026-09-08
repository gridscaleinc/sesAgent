import { reviewMatchAssessmentEvidence, type CandidateMatchAssessment } from '@shared'

export function matchAssessmentFitLabel(fit: CandidateMatchAssessment['fit'], zh: boolean): string {
  if (fit === 'strong') return zh ? '较强' : '高い'
  if (fit === 'possible') return zh ? '可能' : '可能性あり'
  if (fit === 'weak') return zh ? '较弱' : '低い'
  return zh ? '信息不足' : '情報不足'
}

/**
 * Source-backed cloud advice on one shortlisted match. The same component
 * serves both matching directions and displays a fit category, never a score.
 */
export function MatchAssessmentView({ assessment: original, zh, compact = false, title }: {
  assessment: CandidateMatchAssessment
  zh: boolean
  compact?: boolean
  title?: string
}) {
  const { assessment, corrected } = reviewMatchAssessmentEvidence(original)
  return (
    <section className={`agent-match-assessment${compact ? ' is-compact' : ''}`}>
      <header>
        <strong>{title ?? (zh ? '补充评估' : '補足評価')}</strong>
        <em className={`agent-match-assessment-fit is-${assessment.fit}`}>{`${zh ? '适合度：' : '適合度：'}${matchAssessmentFitLabel(assessment.fit, zh)}`}</em>
      </header>
      {corrected ? <p role="status">{zh ? '原评估含缺少依据或相互矛盾的结论，已撤下确定结论。请核对相关技能。' : '元の評価に矛盾があるため、断定を取り下げました。人材のスキルを確認してください。'}</p> : null}
      {assessment.met.length > 0 ? <span><strong>{zh ? '已满足' : '充足'}</strong>{assessment.met.map((item) => `${item.requirement} ← ${item.evidence}`).join(' · ')}</span> : null}
      {assessment.gaps.length > 0 ? <span><strong>{zh ? '缺口' : '不足'}</strong>{assessment.gaps.join(' · ')}</span> : null}
      {assessment.confirm.length > 0 ? <span><strong>{zh ? '待确认' : '要確認'}</strong>{assessment.confirm.join(' · ')}</span> : null}
      {assessment.reason && !compact ? <p>{assessment.reason}</p> : null}
    </section>
  )
}
