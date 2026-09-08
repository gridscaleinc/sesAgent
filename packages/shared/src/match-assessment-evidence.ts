import type { CandidateMatchAssessment } from './contracts'

type AssessmentEvidence = Pick<CandidateMatchAssessment, 'fit' | 'met' | 'gaps' | 'confirm' | 'reason'>
const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase('en-US').trim()
const atoms = (text: string) => text.split(/[,，、;；\n]+/u).map((part) => part.trim()).filter(Boolean)
function mentions(text: string, term: string): boolean {
  const escaped = normalize(term).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'u').test(normalize(text))
}

/** Model gaps have no source citation. Keep them as questions, never verified failures.
 * Also applied when reading historical cards, so old contradictory verdicts cannot
 * silently become authoritative evidence for the next model turn.
 */
export function reviewMatchAssessmentEvidence<T extends AssessmentEvidence>(assessment: T): { assessment: T; corrected: boolean } {
  const met: T['met'] = []
  const confirm = [...assessment.confirm]
  let corrected = assessment.gaps.length > 0
  for (const item of assessment.met) {
    for (const requirement of atoms(item.requirement)) {
      const technical = /^[a-z][a-z0-9+#. -]*$/iu.test(requirement)
      if (technical && !mentions(item.evidence, requirement)) {
        confirm.push(requirement)
        corrected = true
        continue
      }
      if (!met.some((existing) => normalize(existing.requirement) === normalize(requirement))) met.push({ requirement, evidence: item.evidence })
    }
  }
  for (const gap of assessment.gaps) {
    for (const requirement of atoms(gap)) {
      if (met.some((item) => mentions(requirement, item.requirement))) corrected = true
      if (met.some((item) => normalize(requirement) === normalize(item.requirement))) continue
      // An unsupported negative is a review question, not evidence of absence.
      confirm.push(requirement)
    }
  }
  return { corrected, assessment: { ...assessment,
    met: met.slice(0, 8), gaps: [], confirm: [...new Set(confirm)].slice(0, 8),
    fit: corrected || (assessment.fit === 'weak' && confirm.length > 0 && met.length === 0) ? 'insufficient-info' : assessment.fit === 'strong' && confirm.length ? 'possible' : assessment.fit,
    reason: corrected ? '' : assessment.reason
  } }
}
