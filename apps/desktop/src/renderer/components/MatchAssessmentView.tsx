import type { CandidateMatchAssessment } from '@shared'

export function matchAssessmentFitLabel(fit: CandidateMatchAssessment['fit'], zh: boolean): string {
  if (fit === 'strong') return zh ? '较强' : '高い'
  if (fit === 'possible') return zh ? '可能' : '可能性あり'
  if (fit === 'weak') return zh ? '较弱' : '低い'
  return zh ? '信息不足' : '情報不足'
}

/**
 * The cloud second opinion on one shortlisted match, shown next to the local
 * fit. It is advice on the same de-identified evidence: the local rank and
 * hard filters stay the authority, so it never renders as a score.
 */
export function MatchAssessmentView({ assessment, zh, compact = false }: {
  assessment: CandidateMatchAssessment
  zh: boolean
  compact?: boolean
}) {
  return (
    <section className={`agent-match-assessment${compact ? ' is-compact' : ''}`}>
      <header>
        <strong>{zh ? '云端评审' : 'クラウド評価'}</strong>
        <em className={`agent-match-assessment-fit is-${assessment.fit}`}>{`${zh ? '适合度：' : '適合度：'}${matchAssessmentFitLabel(assessment.fit, zh)}`}</em>
      </header>
      {assessment.met.length > 0 ? <span><strong>{zh ? '已满足' : '充足'}</strong>{assessment.met.map((item) => `${item.requirement} ← ${item.evidence}`).join(' · ')}</span> : null}
      {assessment.gaps.length > 0 ? <span><strong>{zh ? '缺口' : '不足'}</strong>{assessment.gaps.join(' · ')}</span> : null}
      {assessment.confirm.length > 0 ? <span><strong>{zh ? '待确认' : '要確認'}</strong>{assessment.confirm.join(' · ')}</span> : null}
      {assessment.reason && !compact ? <p>{assessment.reason}</p> : null}
    </section>
  )
}
