import { randomUUID } from 'node:crypto'
import { assessmentFeedbackInputSchema, changeWorkRuleInputSchema, workRuleRecordSchema, type AssessmentFeedbackInput, type CasePersonAssessment, type CasePersonQuestionDraft, type ChangeWorkRuleInput, type WorkRuleLibrary, type WorkRuleRecord } from '@shared'
import { DomainStore } from './base'

export class WorkRulesStore extends DomainStore {
  list(): WorkRuleLibrary {
    const rows = this.database.prepare<[], { payload: string }>(`SELECT r.payload FROM ai_work_rule_versions r
      WHERE r.revision = (SELECT MAX(v.revision) FROM ai_work_rule_versions v WHERE v.rule_id = r.rule_id)
      ORDER BY r.created_at DESC, r.rule_id`).all()
    const revision = this.database.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM ai_work_rule_versions').get()!.n
    return { revision, rules: rows.map((row) => workRuleRecordSchema.parse(JSON.parse(row.payload))) }
  }

  history(id: string): WorkRuleRecord[] {
    return this.database.prepare<[string], { payload: string }>('SELECT payload FROM ai_work_rule_versions WHERE rule_id = ? ORDER BY revision DESC').all(id)
      .map((row) => workRuleRecordSchema.parse(JSON.parse(row.payload)))
  }

  save(input: Omit<WorkRuleRecord, 'id' | 'revision' | 'updatedAt'> & { id?: string; expectedRevision: number }, now = new Date()): WorkRuleRecord {
    return this.database.transaction(() => {
      const current = input.id ? this.history(input.id)[0] : undefined
      if ((current?.revision ?? 0) !== input.expectedRevision || input.id && !current) throw new Error('规则已更新，请重新加载。 / ルールが更新されました。再読み込みしてください。')
      if (!input.id && this.list().rules.length >= 100) throw new Error('最多保存 100 组规则。 / ルールは100件までです。')
      const { expectedRevision: _, ...values } = input
      const saved = workRuleRecordSchema.parse({ ...values, id: current?.id ?? randomUUID(), revision: (current?.revision ?? 0) + 1, updatedAt: now.toISOString() })
      this.database.prepare('INSERT INTO ai_work_rule_versions(rule_id, revision, payload, created_at) VALUES (?, ?, ?, ?)')
        .run(saved.id, saved.revision, JSON.stringify(saved), saved.updatedAt)
      return saved
    })()
  }

  change(raw: ChangeWorkRuleInput, actor: string): WorkRuleRecord {
    const input = changeWorkRuleInputSchema.parse(raw)
    const history = this.history(input.id)
    const current = history[0]
    const selected = input.restoreRevision ? history.find((row) => row.revision === input.restoreRevision) : current
    if (!current || !selected) throw new Error('规则版本不存在。 / ルールの版が見つかりません。')
    return this.save({ ...selected, enabled: input.enabled ?? selected.enabled, expectedRevision: input.expectedRevision, updatedBy: actor })
  }

  saveAssessment(assessment: CasePersonAssessment): void {
    this.database.prepare('INSERT INTO case_person_assessments(id, document_id, job_case_id, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(assessment.id, assessment.documentId, assessment.jobCaseId, JSON.stringify(assessment), assessment.assessedAt)
  }

  listAssessments(documentId: string, jobCaseId: string): CasePersonAssessment[] {
    return this.database.prepare<[string, string], { payload: string }>('SELECT payload FROM case_person_assessments WHERE document_id = ? AND job_case_id IN (SELECT id FROM job_cases WHERE source_review_id = (SELECT source_review_id FROM job_cases WHERE id = ?)) ORDER BY created_at DESC LIMIT 20')
      .all(documentId, jobCaseId).map((row) => JSON.parse(row.payload) as CasePersonAssessment)
  }

  listCaseAssessments(jobCaseId: string): CasePersonAssessment[] {
    return this.database.prepare<[string], { payload: string }>(`SELECT payload FROM (
      SELECT payload, created_at, ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY created_at DESC, rowid DESC) AS position
      FROM case_person_assessments WHERE job_case_id IN (
        SELECT id FROM job_cases WHERE source_review_id = (SELECT source_review_id FROM job_cases WHERE id = ?)
      )
    ) WHERE position = 1 ORDER BY created_at DESC LIMIT 100`).all(jobCaseId)
      .map(row => JSON.parse(row.payload) as CasePersonAssessment)
  }

  /** One active draft per person and case; earlier drafts stay as history for experience learning. */
  saveQuestionDraft(draft: CasePersonQuestionDraft): void {
    this.database.transaction(() => {
      this.database.prepare(`UPDATE case_person_question_drafts SET superseded_at = ? WHERE document_id = ? AND superseded_at IS NULL AND job_case_id IN (
        SELECT id FROM job_cases WHERE source_review_id = (SELECT source_review_id FROM job_cases WHERE id = ?))`).run(draft.createdAt, draft.documentId, draft.jobCaseId)
      this.database.prepare('INSERT INTO case_person_question_drafts(id, document_id, job_case_id, payload, created_at, superseded_at) VALUES (?, ?, ?, ?, ?, NULL)')
        .run(draft.id, draft.documentId, draft.jobCaseId, JSON.stringify({ ...draft, supersededAt: null }), draft.createdAt)
    })()
  }

  getQuestionDraft(documentId: string, jobCaseId: string): CasePersonQuestionDraft | null {
    // Case versions share a source review, so the draft follows the case like assessments do.
    const row = this.database.prepare<[string, string], { payload: string }>(`SELECT payload FROM case_person_question_drafts
      WHERE document_id = ? AND superseded_at IS NULL AND job_case_id IN (
        SELECT id FROM job_cases WHERE source_review_id = (SELECT source_review_id FROM job_cases WHERE id = ?))
      ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(documentId, jobCaseId)
    return row ? JSON.parse(row.payload) as CasePersonQuestionDraft : null
  }

  feedback(raw: AssessmentFeedbackInput, actor: string): void {
    const input = assessmentFeedbackInputSchema.parse(raw)
    this.database.transaction(() => {
    const exists = this.database.prepare<[string],{payload:string}>('SELECT payload FROM case_person_assessments WHERE id = ?').get(input.assessmentId)
    if (!exists) throw new Error('评估记录不存在。 / 評価が見つかりません。')
    this.database.prepare('INSERT INTO case_person_feedback(id, assessment_id, payload, created_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), input.assessmentId, JSON.stringify({ ...input, actor }), new Date().toISOString())
    const assessment=JSON.parse(exists.payload) as CasePersonAssessment
    const job=this.database.prepare<[string],{source_review_id:string}>('SELECT source_review_id FROM job_cases WHERE id=?').get(assessment.jobCaseId)
    this.stores.experience.record({sourceKey:`assessment:${input.assessmentId}`,documentId:assessment.documentId,reviewId:job?.source_review_id??null,interviewId:null,kind:'assessment-feedback',text:input.note,actor,data:{decision:input.decision,reason:input.reason,assessmentId:input.assessmentId,runId:assessment.result.experienceRunId??null}})
    })()
  }
}
