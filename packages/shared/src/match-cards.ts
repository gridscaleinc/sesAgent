import type { AgentCandidateMatchCard } from './contracts'

/**
 * A row that matched no requirement, scored nothing, and was not cleared by
 * the hard filters was merely not excluded. It is not a candidate to show
 * as a result; it only explains why there is none.
 */
export function isUnassessableMatchCard(card: Pick<AgentCandidateMatchCard, 'matched' | 'fitScore' | 'hardFilterStatus'>): boolean {
  return card.matched.length === 0 && (card.fitScore ?? 0) === 0 && card.hardFilterStatus !== 'passed'
}
