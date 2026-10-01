import {
  isListedPersonnelCaseMatch,
  type PersonnelCaseMatch,
  type PersonnelCaseMatchResult,
  type PersonnelCaseMatchRunSummary,
  type StoredPersonnelCaseMatchRun
} from '@shared'
import { DomainStore } from './base'

interface RunRow {
  document_id: string
  profile_version: number
  rules_revision: number
  policy_version: string
  case_signature: string
  summary: string
  searched_at: string
}

/**
 * The latest completed 找案件 run per person. The case side keeps its results in case_person_assessments;
 * this mirrors it for person → case so the result and list badge survive a restart. Rows hold only the
 * matching output (per-case evidence and exclusion reasons), never resume or mail text. Deleting the
 * person removes the run; deleting a case version removes its row from every run (foreign keys).
 */
export class PersonCaseMatchStore extends DomainStore {
  /** Replaces the person's previous run. A person or case deleted meanwhile is skipped, not re-created. */
  saveRun(run: StoredPersonnelCaseMatchRun): void {
    const { items, ...summary } = run.result
    const insertItem = this.database.prepare(
      `INSERT INTO person_case_match_run_items(document_id, job_case_id, position, payload)
       SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM job_cases WHERE id = ?)`
    )
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM person_case_match_runs WHERE document_id = ?').run(summary.documentId)
      const saved = this.database
        .prepare(
          `INSERT INTO person_case_match_runs(document_id, profile_version, rules_revision, policy_version, case_signature, summary, searched_at)
           SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM candidate_review_states WHERE document_id = ?)`
        )
        .run(
          summary.documentId,
          summary.profileVersion,
          summary.rulesRevision ?? 0,
          run.policyVersion,
          run.caseSignature,
          JSON.stringify(summary),
          run.searchedAt,
          summary.documentId
        )
      if (!saved.changes) return
      items.forEach((item, position) => insertItem.run(summary.documentId, item.jobCaseId, position, JSON.stringify(item), item.jobCaseId))
    })()
  }

  getRun(documentId: string): StoredPersonnelCaseMatchRun | null {
    const row = this.database.prepare<[string], RunRow>('SELECT * FROM person_case_match_runs WHERE document_id = ?').get(documentId)
    if (!row) return null
    const items = this.database
      .prepare<[string], { payload: string }>('SELECT payload FROM person_case_match_run_items WHERE document_id = ? ORDER BY position')
      .all(documentId)
      .map((item) => JSON.parse(item.payload) as PersonnelCaseMatch)
    return {
      result: { ...(JSON.parse(row.summary) as Omit<PersonnelCaseMatchResult, 'items'>), items },
      searchedAt: row.searched_at,
      caseSignature: row.case_signature,
      policyVersion: row.policy_version
    }
  }

  listRunSummaries(): PersonnelCaseMatchRunSummary[] {
    const counts = new Map<string, number>()
    // Only cases still active at the version the run saw count, as the result page shows them.
    const active = new Map(this.stores.jobCases.listActiveJobCases().map((job) => [job.id, job.version]))
    for (const item of this.database
      .prepare<[], { document_id: string; payload: string }>('SELECT document_id, payload FROM person_case_match_run_items')
      .all()) {
      const match = JSON.parse(item.payload) as PersonnelCaseMatch
      if (isListedPersonnelCaseMatch(match) && active.get(match.jobCaseId) === match.jobCaseVersion)
        counts.set(item.document_id, (counts.get(item.document_id) ?? 0) + 1)
    }
    return this.database
      .prepare<[], Omit<RunRow, 'summary'>>(
        'SELECT document_id, profile_version, rules_revision, policy_version, case_signature, searched_at FROM person_case_match_runs ORDER BY document_id'
      )
      .all()
      .map((row) => ({
        documentId: row.document_id,
        profileVersion: row.profile_version,
        rulesRevision: row.rules_revision,
        policyVersion: row.policy_version,
        caseSignature: row.case_signature,
        searchedAt: row.searched_at,
        listedCount: counts.get(row.document_id) ?? 0
      }))
  }
}
