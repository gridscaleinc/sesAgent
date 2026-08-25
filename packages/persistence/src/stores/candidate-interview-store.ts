import { randomUUID } from 'node:crypto'
import {
  candidateInterviewSnapshotSchema,
  createCandidateInterviewRoundInputSchema,
  recordCandidateInterviewDecisionInputSchema,
  saveCandidateInterviewNotesInputSchema,
  saveCandidateInterviewPreparationInputSchema,
  saveCandidateInterviewScheduleInputSchema
} from '@shared'
import {
  type CandidateInterviewSnapshot,
  type CreateCandidateInterviewRoundInput,
  type RecordCandidateInterviewDecisionInput,
  type SaveCandidateInterviewNotesInput,
  type SaveCandidateInterviewPreparationInput,
  type SaveCandidateInterviewScheduleInput
} from '@shared/contracts'
import { type CandidateInterviewRow } from '../rows'
import { DomainStore } from './base'

export class CandidateInterviewStore extends DomainStore {
  private candidateInterviewFromRow(row: CandidateInterviewRow): CandidateInterviewSnapshot {
    if (row.cloud_eligible !== 0) throw new Error('Candidate interview cloud boundary is invalid.')
    return candidateInterviewSnapshotSchema.parse({
      id: row.id,
      sourceDocumentId: row.source_document_id,
      kind: row.kind,
      roundNumber: row.round_number,
      parentInterviewId: row.parent_interview_id,
      stage: row.stage,
      scheduledAt: row.scheduled_at,
      durationMinutes: row.duration_minutes,
      meetingMethod: row.meeting_method,
      meetingUrl: row.meeting_url,
      meetingDetails: JSON.parse(row.meeting_details_json || '{}'),
      interviewer: row.interviewer,
      contactNote: row.contact_note,
      interviewGoal: row.interview_goal,
      questionPlan: JSON.parse(row.question_plan_json),
      interviewNotes: row.interview_notes,
      unresolvedItems: JSON.parse(row.unresolved_items_json),
      decision: row.decision,
      decisionReason: row.decision_reason,
      decidedAt: row.decided_at,
      decidedBy: row.decided_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
      cloudEligible: false
    })
  }

  private getCandidateInterviewRow(
    sourceDocumentId: string,
    interviewId?: string,
    kind: CandidateInterviewSnapshot['kind'] = 'recruiting'
  ): CandidateInterviewRow | null {
    if (interviewId) {
      return this.database
        .prepare<[string, string], CandidateInterviewRow>(
          'SELECT * FROM candidate_interview_sessions WHERE id = ? AND source_document_id = ?'
        )
        .get(interviewId, sourceDocumentId) ?? null
    }
    return this.database
      .prepare<[string, string], CandidateInterviewRow>(
        `SELECT * FROM candidate_interview_sessions
         WHERE source_document_id = ? AND kind = ?
         ORDER BY round_number DESC, updated_at DESC
         LIMIT 1`
      )
      .get(sourceDocumentId, kind) ?? null
  }

  private assertCandidateInterviewSubject(sourceDocumentId: string): void {
    const exists = this.database
      .prepare<[string], { document_id: string }>('SELECT document_id FROM candidate_review_states WHERE document_id = ?')
      .get(sourceDocumentId)
    if (!exists) throw new Error('Candidate resume was not found.')
  }

  listCandidateInterviews(): CandidateInterviewSnapshot[] {
    return this.database
      .prepare<[], CandidateInterviewRow>(
        `SELECT * FROM candidate_interview_sessions
         ORDER BY coalesce(scheduled_at, updated_at) ASC, source_document_id, round_number`
      )
      .all()
      .map((row) => this.candidateInterviewFromRow(row))
  }

  createCandidateInterviewRound(
    input: CreateCandidateInterviewRoundInput,
    updatedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    const validated = createCandidateInterviewRoundInputSchema.parse(input)
    this.assertCandidateInterviewSubject(validated.sourceDocumentId)
    const parent = this.getCandidateInterviewRow(validated.sourceDocumentId, validated.parentInterviewId)
    if (!parent) throw new Error('The prior interview round was not found.')
    if (parent.decision !== 'next-round') throw new Error('Record a next-round decision before creating a follow-up interview.')
    const kind = validated.kind ?? parent.kind
    const round = this.database
      .prepare<[string, string], { next_round: number }>(
        `SELECT coalesce(max(round_number), 0) + 1 AS next_round
         FROM candidate_interview_sessions WHERE source_document_id = ? AND kind = ?`
      )
      .get(validated.sourceDocumentId, kind)?.next_round ?? parent.round_number + 1
    const existing = this.database
      .prepare<[string, string, number], CandidateInterviewRow>(
        `SELECT * FROM candidate_interview_sessions
         WHERE source_document_id = ? AND kind = ? AND round_number = ?`
      )
      .get(validated.sourceDocumentId, kind, round)
    if (existing) return this.candidateInterviewFromRow(existing)
    const timestamp = now.toISOString()
    const id = randomUUID()
    const inheritedItems = candidateInterviewSnapshotSchema.parse({
      ...this.candidateInterviewFromRow(parent),
      id: parent.id
    }).unresolvedItems
    // A follow-up must not quietly repeat every first-round question. Only
    // unresolved items become candidates for the next round; the renderer can
    // use the parent plan as an exclusion set when generating new AI prompts.
    const questionPlan = inheritedItems
      .slice(0, 12)
      .map((text, index) => ({
        id: `inherited-${round}-${index + 1}`,
        text,
        source: 'inherited' as const,
        sourceLabel: null,
        selected: false
      }))
    this.database.prepare(
      `INSERT INTO candidate_interview_sessions(
         id, source_document_id, kind, round_number, parent_interview_id, stage,
         scheduled_at, duration_minutes, meeting_method, meeting_url, meeting_details_json, interviewer,
         contact_note, interview_goal, question_plan_json, interview_notes, unresolved_items_json,
         decision, decision_reason, decided_at, decided_by, created_at, updated_at, updated_by, cloud_eligible
       ) VALUES (?, ?, ?, ?, ?, 'new', NULL, 60, 'zoom', NULL, '{}', ?, NULL, NULL, ?, NULL, ?,
                 NULL, NULL, NULL, NULL, ?, ?, ?, 0)`
    ).run(
      id,
      validated.sourceDocumentId,
      kind,
      round,
      parent.id,
      parent.interviewer,
      JSON.stringify(questionPlan),
      JSON.stringify(inheritedItems),
      timestamp,
      timestamp,
      updatedBy
    )
    const saved = this.getCandidateInterviewRow(validated.sourceDocumentId, id, kind)
    if (!saved) throw new Error('Follow-up interview could not be created.')
    return this.candidateInterviewFromRow(saved)
  }

  saveCandidateInterviewSchedule(
    input: SaveCandidateInterviewScheduleInput,
    updatedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    const validated = saveCandidateInterviewScheduleInputSchema.parse(input)
    this.assertCandidateInterviewSubject(validated.sourceDocumentId)
    const kind = validated.kind ?? 'recruiting'
    if (kind === 'recruiting') {
      // Recruiting interviews may be arranged as soon as a resume has been
      // imported. Human profile confirmation is still required before matching
      // or talent-pool admission, but it must not block the earlier scheduling
      // workflow exposed by the Agent conversation.
      const activeCandidate = this.database
        .prepare<[string], { source_document_id: string }>(
          "SELECT source_document_id FROM candidate_records WHERE source_document_id = ? AND record_status = 'active'"
        )
        .get(validated.sourceDocumentId)
      if (!activeCandidate) throw new Error('Only an active imported candidate can enter a recruiting interview.')
    } else {
      const eligibleMembership = this.database
        .prepare<[string], { source_document_id: string }>(
          `SELECT membership.source_document_id
           FROM talent_pool_memberships membership
           JOIN candidate_records record ON record.source_document_id = membership.source_document_id
           JOIN candidate_profiles profile ON profile.source_document_id = membership.source_document_id
           WHERE membership.source_document_id = ? AND membership.status = 'eligible'
             AND record.record_status = 'active' AND profile.status = 'current'`
        )
        .get(validated.sourceDocumentId)
      if (!eligibleMembership) throw new Error('Only eligible talent-pool members can enter a client interview.')
    }
    let current = this.getCandidateInterviewRow(validated.sourceDocumentId, validated.interviewId, kind)
    if (!current && validated.roundNumber) {
      current = this.database
        .prepare<[string, string, number], CandidateInterviewRow>(
          `SELECT * FROM candidate_interview_sessions
           WHERE source_document_id = ? AND kind = ? AND round_number = ?`
        )
        .get(validated.sourceDocumentId, kind, validated.roundNumber) ?? null
    }
    if (current?.decision) throw new Error('A final interview decision is already recorded. Create a follow-up round instead.')
    if (current && !['new', 'contacting', 'scheduled', 'prepared'].includes(current.stage)) {
      throw new Error('An interview already started or is awaiting a decision, so its schedule is locked.')
    }
    const timestamp = now.toISOString()
    const id = current?.id ?? randomUUID()
    const roundNumber = current?.round_number ?? validated.roundNumber ?? 1
    this.database
      .prepare(
        `INSERT INTO candidate_interview_sessions(
           id, source_document_id, kind, round_number, parent_interview_id, stage,
           scheduled_at, duration_minutes, meeting_method, meeting_url, meeting_details_json, interviewer,
           contact_note, interview_goal, question_plan_json, interview_notes, unresolved_items_json,
           decision, decision_reason, decided_at, decided_by, created_at, updated_at, updated_by, cloud_eligible
         ) VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, NULL, '[]', NULL, '[]',
                   NULL, NULL, NULL, NULL, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           stage = 'scheduled', scheduled_at = excluded.scheduled_at,
           duration_minutes = excluded.duration_minutes, meeting_method = excluded.meeting_method,
           meeting_url = excluded.meeting_url, meeting_details_json = excluded.meeting_details_json, interviewer = excluded.interviewer,
           contact_note = excluded.contact_note,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      )
      .run(
        id,
        validated.sourceDocumentId,
        kind,
        roundNumber,
        current?.parent_interview_id ?? validated.parentInterviewId ?? null,
        validated.scheduledAt,
        validated.durationMinutes,
        validated.meetingMethod,
        validated.meetingMethod === 'zoom' || validated.meetingMethod === 'google-meet' ? validated.meetingUrl ?? null : null,
        JSON.stringify(validated.meetingDetails ?? {}),
        validated.interviewer,
        validated.contactNote?.trim() || null,
        timestamp,
        timestamp,
        updatedBy
      )
    if (kind === 'recruiting') {
      this.database.prepare(
        `UPDATE candidate_records SET recruiting_status = 'recruiting', updated_at = ?
         WHERE source_document_id = ? AND recruiting_status IN ('ready-for-recruiting', 'on-hold')`
      ).run(timestamp, validated.sourceDocumentId)
    }
    const saved = this.getCandidateInterviewRow(validated.sourceDocumentId, id, kind)
    if (!saved) throw new Error('Interview schedule could not be saved.')
    return this.candidateInterviewFromRow(saved)
  }

  saveCandidateInterviewPreparation(
    input: SaveCandidateInterviewPreparationInput,
    updatedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    const validated = saveCandidateInterviewPreparationInputSchema.parse(input)
    const row = this.database
      .prepare<[string], CandidateInterviewRow>('SELECT * FROM candidate_interview_sessions WHERE id = ?')
      .get(validated.interviewId)
    if (!row) throw new Error('Interview session was not found.')
    if (row.decision) throw new Error('A completed interview cannot be edited.')
    if (!['scheduled', 'prepared'].includes(row.stage)) {
      throw new Error('Interview questions can only be edited before the interview starts.')
    }
    this.database.prepare(
      `UPDATE candidate_interview_sessions
       SET stage = 'prepared', interview_goal = ?, question_plan_json = ?, unresolved_items_json = ?,
           updated_at = ?, updated_by = ?
       WHERE id = ?`
    ).run(
      validated.interviewGoal?.trim() || null,
      JSON.stringify(validated.questions),
      JSON.stringify(validated.unresolvedItems ?? []),
      now.toISOString(),
      updatedBy,
      validated.interviewId
    )
    const saved = this.database
      .prepare<[string], CandidateInterviewRow>('SELECT * FROM candidate_interview_sessions WHERE id = ?')
      .get(validated.interviewId)
    if (!saved) throw new Error('Interview preparation could not be saved.')
    return this.candidateInterviewFromRow(saved)
  }

  saveCandidateInterviewNotes(
    input: SaveCandidateInterviewNotesInput,
    updatedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    const validated = saveCandidateInterviewNotesInputSchema.parse(input)
    this.assertCandidateInterviewSubject(validated.sourceDocumentId)
    const current = this.getCandidateInterviewRow(validated.sourceDocumentId, validated.interviewId)
    if (!current) throw new Error('Interview session was not found.')
    if (current.decision) throw new Error('A final interview decision is already recorded. Reopen the candidate before editing interview notes.')
    if (!['prepared', 'interviewing'].includes(current.stage)) {
      throw new Error('Interview notes can only be edited while the interview is in progress.')
    }
    const timestamp = now.toISOString()
    const stage = validated.stage ?? 'interviewing'
    const id = current.id
    const unresolvedItems = validated.unresolvedItems ?? (current
      ? JSON.parse(current.unresolved_items_json) as string[]
      : [])
    this.database
      .prepare(
        `INSERT INTO candidate_interview_sessions(
           id, source_document_id, kind, round_number, parent_interview_id, stage,
           scheduled_at, duration_minutes, meeting_method, meeting_url, meeting_details_json, interviewer,
           contact_note, interview_goal, question_plan_json, interview_notes, unresolved_items_json,
           decision, decision_reason, decided_at, decided_by, created_at, updated_at, updated_by, cloud_eligible
         ) VALUES (?, ?, 'recruiting', 1, NULL, ?, NULL, 60, 'zoom', NULL, '{}', NULL,
                   NULL, NULL, '[]', ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           stage = excluded.stage, interview_notes = excluded.interview_notes,
           unresolved_items_json = excluded.unresolved_items_json,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      )
      .run(
        id,
        validated.sourceDocumentId,
        stage,
        validated.interviewNotes || null,
        JSON.stringify(unresolvedItems),
        timestamp,
        timestamp,
        updatedBy
      )
    const saved = this.getCandidateInterviewRow(validated.sourceDocumentId, id)
    if (!saved) throw new Error('Interview notes could not be saved.')
    return this.candidateInterviewFromRow(saved)
  }

  recordCandidateInterviewDecision(
    input: RecordCandidateInterviewDecisionInput,
    decidedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    const validated = recordCandidateInterviewDecisionInputSchema.parse(input)
    this.assertCandidateInterviewSubject(validated.sourceDocumentId)
    const current = this.getCandidateInterviewRow(validated.sourceDocumentId, validated.interviewId)
    if (!current) throw new Error('Interview session was not found.')
    if (current.stage !== 'awaiting-decision') {
      throw new Error('Complete the interview record before recording a decision.')
    }
    const timestamp = now.toISOString()
    const stage = validated.decision === 'passed'
      ? 'passed'
      : validated.decision === 'on-hold' || validated.decision === 'next-round'
        ? 'on-hold'
        : 'closed'
    const id = current.id
    return this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO candidate_interview_sessions(
             id, source_document_id, kind, round_number, parent_interview_id, stage,
             scheduled_at, duration_minutes, meeting_method, meeting_url, meeting_details_json, interviewer,
             contact_note, interview_goal, question_plan_json, interview_notes, unresolved_items_json,
             decision, decision_reason, decided_at, decided_by, created_at, updated_at, updated_by, cloud_eligible
           ) VALUES (?, ?, 'recruiting', 1, NULL, ?, NULL, 60, 'zoom', NULL, '{}', NULL,
                     NULL, NULL, '[]', NULL, '[]', ?, ?, ?, ?, ?, ?, ?, 0)
           ON CONFLICT(id) DO UPDATE SET
             stage = excluded.stage, decision = excluded.decision, decision_reason = excluded.decision_reason,
             decided_at = excluded.decided_at, decided_by = excluded.decided_by,
             updated_at = excluded.updated_at, updated_by = excluded.updated_by`
        )
        .run(
          id,
          validated.sourceDocumentId,
          stage,
          validated.decision,
          validated.decisionReason,
          timestamp,
          decidedBy,
          timestamp,
          timestamp,
          decidedBy
        )
      if (current.kind === 'recruiting') {
        const recruitingStatus = validated.decision === 'passed'
          ? 'passed'
          : validated.decision === 'failed'
            ? 'rejected'
            : validated.decision === 'withdrawn'
              ? 'withdrawn'
              : validated.decision === 'no-show'
                ? 'no-show'
                : validated.decision === 'on-hold' || validated.decision === 'next-round'
                  ? 'on-hold'
                  : 'recruiting'
        const updated = this.database.prepare(
          'UPDATE candidate_records SET recruiting_status = ?, updated_at = ? WHERE source_document_id = ?'
        ).run(recruitingStatus, timestamp, validated.sourceDocumentId)
        if (updated.changes !== 1) throw new Error('Candidate recruiting state could not be updated.')
        if (validated.decision === 'passed') {
          this.database.prepare(
            `INSERT INTO talent_pool_memberships(source_document_id, status, admitted_interview_id, admitted_at, admitted_by, reason, updated_at)
             VALUES (?, 'eligible', ?, ?, ?, ?, ?)
             ON CONFLICT(source_document_id) DO UPDATE SET
               status = 'eligible', admitted_interview_id = excluded.admitted_interview_id,
               admitted_at = excluded.admitted_at, admitted_by = excluded.admitted_by,
               reason = excluded.reason, updated_at = excluded.updated_at`
          ).run(validated.sourceDocumentId, current.id, timestamp, decidedBy, validated.decisionReason, timestamp)
        }
      }
      const saved = this.getCandidateInterviewRow(validated.sourceDocumentId, id)
      if (!saved) throw new Error('Interview decision could not be saved.')
      return this.candidateInterviewFromRow(saved)
    })()
  }
}
