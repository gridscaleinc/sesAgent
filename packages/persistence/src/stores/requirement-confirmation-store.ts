import type { RequirementConfirmation } from '@shared'
import { DomainStore } from './base'

interface RequirementConfirmationRow {
  id: string
  document_id: string
  scope: RequirementConfirmation['scope']
  job_case_id: string | null
  job_case_version: number | null
  requirement_key: string
  requirement_label: string
  outcome: RequirementConfirmation['outcome']
  note: string | null
  question: string | null
  decided_at: string
  decided_by: string | null
}
const fromRow = (row: RequirementConfirmationRow): RequirementConfirmation => ({
  id: row.id,
  documentId: row.document_id,
  scope: row.scope,
  jobCaseId: row.job_case_id,
  jobCaseVersion: row.job_case_version,
  requirementKey: row.requirement_key,
  requirementLabel: row.requirement_label,
  outcome: row.outcome,
  note: row.note,
  question: row.question,
  decidedAt: row.decided_at,
  decidedBy: row.decided_by
})

/**
 * HR decisions on requirements the material left unclear. Holds only the requirement wording, HR's short note and
 * question, never resume or mail text. One current decision per person, scope, case and requirement: a new decision
 * on the same target replaces the earlier one.
 */
export class RequirementConfirmationStore extends DomainStore {
  /** Saves the decision, replacing one on the same target; false when the person or case is gone. */
  save(record: RequirementConfirmation): boolean {
    const replace = this.database.transaction(() => {
      if (!this.database.prepare('SELECT 1 FROM candidate_review_states WHERE document_id = ?').get(record.documentId)) return false
      if (record.jobCaseId && !this.database.prepare('SELECT 1 FROM job_cases WHERE id = ?').get(record.jobCaseId)) return false
      this.database
        .prepare(
          `DELETE FROM requirement_confirmations
           WHERE document_id = ? AND scope = ? AND COALESCE(job_case_id, '') = ? AND requirement_key = ?`
        )
        .run(record.documentId, record.scope, record.jobCaseId ?? '', record.requirementKey)
      // Written into the person's record: the same requirement's 「仅本案件」 decisions would hide it, so they go.
      if (record.scope === 'person')
        this.database
          .prepare(`DELETE FROM requirement_confirmations WHERE document_id = ? AND scope = 'pair' AND requirement_key = ?`)
          .run(record.documentId, record.requirementKey)
      this.database
        .prepare(
          `INSERT INTO requirement_confirmations(id, document_id, scope, job_case_id, job_case_version, requirement_key,
             requirement_label, outcome, note, question, decided_at, decided_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          record.id,
          record.documentId,
          record.scope,
          record.jobCaseId,
          record.jobCaseVersion,
          record.requirementKey,
          record.requirementLabel,
          record.outcome,
          record.note,
          record.question,
          record.decidedAt,
          record.decidedBy
        )
      return true
    })
    return replace()
  }

  list(documentId: string): RequirementConfirmation[] {
    return this.database
      .prepare<[string], RequirementConfirmationRow>(
        'SELECT * FROM requirement_confirmations WHERE document_id = ? ORDER BY decided_at DESC, id'
      )
      .all(documentId)
      .map(fromRow)
  }

  /** Every decision, for passes over many people (matching opportunities). */
  listAll(): RequirementConfirmation[] {
    return this.database
      .prepare<[], RequirementConfirmationRow>('SELECT * FROM requirement_confirmations ORDER BY document_id, decided_at DESC, id')
      .all()
      .map(fromRow)
  }

  /** Removes one decision of this person; false when there was none. */
  delete(id: string, documentId: string): boolean {
    return this.database.prepare('DELETE FROM requirement_confirmations WHERE id = ? AND document_id = ?').run(id, documentId).changes > 0
  }
}
