import { randomUUID } from 'node:crypto'
import { confirmedJobCaseSchema } from '@job-cases'
import {
  approveLocalProposalDraft,
  createLocalProposalDraft,
  markProposalExportUnknown,
  markProposalExported,
  recordLocalProposalFollowUp,
  updateLocalProposalDraft
} from '@proposals'
import { candidateProfileSchema } from '@resume'
import {
  approveProposalDraftInputSchema,
  createProposalDraftInputSchema,
  proposalDraftSnapshotSchema,
  proposalPreparationOptionsSchema,
  proposalTaskIdSchema,
  proposalWorkspaceSnapshotSchema,
  recordProposalFollowUpInputSchema,
  updateProposalDraftInputSchema
} from '@shared'
import {
  type ApproveProposalDraftInput,
  type CreateProposalDraftInput,
  type ProposalDraftSnapshot,
  type ProposalPreparationOptions,
  type ProposalWorkspaceSnapshot,
  type RecordProposalFollowUpInput,
  type UpdateProposalDraftInput
} from '@shared/contracts'
import { proposalDraftFromRow, proposalFollowUpEventFromRow } from '../mappers'
import {
  type CandidateProfileRow,
  type JobCaseRow,
  type ProposalDraftRow,
  type ProposalExportRow,
  type ProposalFollowUpEventRow
} from '../rows'
import { DomainStore } from './base'

export class ProposalStore extends DomainStore {
  getProposalPreparationOptions(): ProposalPreparationOptions {
    const jobCases = this.database
      .prepare<[], JobCaseRow>(
        `SELECT job.case_json, job.status FROM job_cases job
         LEFT JOIN job_case_lifecycle lifecycle ON lifecycle.source_review_id = job.source_review_id
         WHERE job.status = 'active' AND coalesce(lifecycle.state, 'active') = 'active'
         ORDER BY job.confirmed_at DESC`
      )
      .all()
      .map((row) => confirmedJobCaseSchema.parse(JSON.parse(row.case_json)))
      .map((jobCase) => ({
        id: jobCase.id,
        reviewId: jobCase.sourceReviewId,
        version: jobCase.version,
        title: jobCase.fields.find((field) => field.key === 'title')?.value ?? `案件 ${jobCase.id.slice(0, 8)}`,
        role: jobCase.fields.find((field) => field.key === 'role')?.value ?? null,
        requiredSkills: jobCase.fields.find((field) => field.key === 'required_skills')?.value ?? null,
        rate: jobCase.fields.find((field) => field.key === 'rate')?.value ?? null,
        fields: jobCase.fields
      }))
    const candidates = this.database
      .prepare<[], CandidateProfileRow>(
        `SELECT profile.profile_json, profile.status FROM candidate_profiles profile
         JOIN candidate_records record ON record.source_document_id = profile.source_document_id
         JOIN talent_pool_memberships membership ON membership.source_document_id = profile.source_document_id
         WHERE profile.status = 'current' AND record.record_status = 'active' AND membership.status = 'eligible'
         ORDER BY profile.confirmed_at DESC`
      )
      .all()
      .map((row) => candidateProfileSchema.parse(JSON.parse(row.profile_json)))
      .map((profile) => ({
        id: profile.id,
        version: profile.profileVersion,
        anonymousLabel: `候補者 ${profile.id.slice(0, 8).toLocaleUpperCase('en-US')}`,
        skills: profile.fields.find((field) => field.key === 'skills')?.value ?? null,
        experienceYears: profile.fields.find((field) => field.key === 'experience_years')?.value ?? null,
        availability: profile.fields.find((field) => field.key === 'availability')?.value ?? null,
        rate: profile.fields.find((field) => field.key === 'rate')?.value ?? null,
        japaneseLevel: profile.fields.find((field) => field.key === 'japanese_level')?.value ?? null,
        workStyle: profile.fields.find((field) => field.key === 'work_style')?.value ?? null,
        role: profile.fields.find((field) => field.key === 'role')?.value ?? null,
        fields: profile.fields,
        projectExperiences: profile.projectExperiences
      }))
    return proposalPreparationOptionsSchema.parse({ jobCases, candidates })
  }

  private hydrateProposalFollowUp(draft: ProposalDraftSnapshot): ProposalDraftSnapshot {
    const events = this.database
      .prepare<[string], ProposalFollowUpEventRow>(
        `SELECT id, draft_id, revision, stage, occurred_on, note, actor, recorded_at, cloud_eligible
         FROM proposal_follow_up_events WHERE draft_id = ? ORDER BY revision ASC`
      )
      .all(draft.id)
      .map(proposalFollowUpEventFromRow)
    return proposalDraftSnapshotSchema.parse({
      ...draft,
      followUp: {
        revision: events.length,
        stage: events.at(-1)?.stage ?? null,
        events,
        cloudEligible: false
      }
    })
  }

  getProposalWorkspace(taskId: string): ProposalWorkspaceSnapshot {
    const validatedTaskId = proposalTaskIdSchema.parse(taskId)
    const task = this.stores.workTasks.getWorkTask(validatedTaskId)
    if (!task || task.type !== 'GENERATE_PROPOSAL') throw new Error('Proposal task was not found.')
    const drafts = this.listProposalDrafts(validatedTaskId)
    const evidence = drafts.flatMap((draft) => {
      const jobCaseRow = this.database
        .prepare<[string], JobCaseRow>('SELECT case_json, status FROM job_cases WHERE id = ?')
        .get(draft.jobCaseId)
      const candidateRow = this.database
        .prepare<[string], CandidateProfileRow>('SELECT profile_json, status FROM candidate_profiles WHERE id = ?')
        .get(draft.candidateProfileId)
      if (!jobCaseRow || !candidateRow) return []
      const jobCase = confirmedJobCaseSchema.parse(JSON.parse(jobCaseRow.case_json))
      const candidate = candidateProfileSchema.parse(JSON.parse(candidateRow.profile_json))
      return [{
        draftId: draft.id,
        jobCase: {
          id: jobCase.id,
          reviewId: jobCase.sourceReviewId,
          version: jobCase.version,
          title: jobCase.fields.find((field) => field.key === 'title')?.value ?? `案件 ${jobCase.id.slice(0, 8)}`,
          role: jobCase.fields.find((field) => field.key === 'role')?.value ?? null,
          requiredSkills: jobCase.fields.find((field) => field.key === 'required_skills')?.value ?? null,
          rate: jobCase.fields.find((field) => field.key === 'rate')?.value ?? null,
          fields: jobCase.fields
        },
        candidate: {
          id: candidate.id,
          version: candidate.profileVersion,
          anonymousLabel: `候補者 ${candidate.id.slice(0, 8).toLocaleUpperCase('en-US')}`,
          skills: candidate.fields.find((field) => field.key === 'skills')?.value ?? null,
          experienceYears: candidate.fields.find((field) => field.key === 'experience_years')?.value ?? null,
          availability: candidate.fields.find((field) => field.key === 'availability')?.value ?? null,
          rate: candidate.fields.find((field) => field.key === 'rate')?.value ?? null,
          japaneseLevel: candidate.fields.find((field) => field.key === 'japanese_level')?.value ?? null,
          workStyle: candidate.fields.find((field) => field.key === 'work_style')?.value ?? null,
          role: candidate.fields.find((field) => field.key === 'role')?.value ?? null,
          fields: candidate.fields,
          projectExperiences: candidate.projectExperiences
        }
      }]
    })
    return proposalWorkspaceSnapshotSchema.parse({
      options: this.getProposalPreparationOptions(),
      drafts,
      evidence
    })
  }

  listProposalDrafts(taskId?: string): ProposalDraftSnapshot[] {
    const rows = taskId
      ? this.database
          .prepare<[string], ProposalDraftRow>(
            'SELECT payload_json, status, revision, content_hash, approved_content_hash FROM proposal_drafts WHERE task_id = ? ORDER BY updated_at DESC'
          )
          .all(taskId)
      : this.database
          .prepare<[], ProposalDraftRow>(
            'SELECT payload_json, status, revision, content_hash, approved_content_hash FROM proposal_drafts ORDER BY updated_at DESC'
          )
          .all()
    return rows.map((row) => this.hydrateProposalFollowUp(proposalDraftFromRow(row)))
  }

  getProposalDraft(draftId: string): ProposalDraftSnapshot | null {
    const row = this.database
      .prepare<[string], ProposalDraftRow>(
        'SELECT payload_json, status, revision, content_hash, approved_content_hash FROM proposal_drafts WHERE id = ?'
      )
      .get(draftId)
    return row ? this.hydrateProposalFollowUp(proposalDraftFromRow(row)) : null
  }

  createProposalDraft(
    rawInput: CreateProposalDraftInput,
    draftId: string,
    actor: string,
    now = new Date()
  ): ProposalDraftSnapshot {
    const input = createProposalDraftInputSchema.parse(rawInput)
    const task = this.stores.workTasks.getWorkTask(input.taskId)
    if (!task || task.type !== 'GENERATE_PROPOSAL') throw new Error('Proposal task was not found.')
    const caseRow = this.database
      .prepare<[string], JobCaseRow>(
        `SELECT job.case_json, job.status FROM job_cases job
         LEFT JOIN job_case_lifecycle lifecycle ON lifecycle.source_review_id = job.source_review_id
         WHERE job.id = ? AND job.status = 'active' AND coalesce(lifecycle.state, 'active') = 'active'`
      )
      .get(input.jobCaseId)
    if (!caseRow) throw new Error('Active confirmed job case was not found.')
    const profileRow = this.database
      .prepare<[string], CandidateProfileRow>(
        `SELECT profile.profile_json, profile.status FROM candidate_profiles profile
         JOIN candidate_records record ON record.source_document_id = profile.source_document_id
         JOIN talent_pool_memberships membership ON membership.source_document_id = profile.source_document_id
         WHERE profile.id = ? AND profile.status = 'current' AND record.record_status = 'active' AND membership.status = 'eligible'`
      )
      .get(input.candidateProfileId)
    if (!profileRow) throw new Error('Eligible current candidate profile was not found.')
    const draft = createLocalProposalDraft(
      input,
      confirmedJobCaseSchema.parse(JSON.parse(caseRow.case_json)),
      candidateProfileSchema.parse(JSON.parse(profileRow.profile_json)),
      draftId,
      now
    )
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO proposal_drafts(
             id, task_id, job_case_id, candidate_profile_id, payload_json, status,
             revision, content_hash, approved_content_hash, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
        )
        .run(
          draft.id,
          draft.taskId,
          draft.jobCaseId,
          draft.candidateProfileId,
          JSON.stringify(draft),
          draft.status,
          draft.revision,
          draft.contentHash,
          draft.createdAt,
          draft.updatedAt
        )
      this.insertProposalEvent(draft, 'created', actor, { generationMode: draft.generation.mode }, draft.createdAt)
    })
    save()
    this.stores.candidateMatch.refreshBusinessPriorityProjectionsForPair(draft.jobCaseId, draft.candidateProfileId, now)
    return draft
  }

  updateProposalDraft(rawInput: UpdateProposalDraftInput, actor: string, now = new Date()): ProposalDraftSnapshot {
    const input = updateProposalDraftInputSchema.parse(rawInput)
    const current = this.getProposalDraft(input.draftId)
    if (!current) throw new Error('Proposal draft was not found.')
    const updated = updateLocalProposalDraft(current, input, now)
    const save = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE proposal_drafts SET
             payload_json = ?, status = ?, revision = ?, content_hash = ?,
             approved_content_hash = NULL, updated_at = ?
           WHERE id = ? AND revision = ? AND content_hash = ?`
        )
        .run(
          JSON.stringify(updated),
          updated.status,
          updated.revision,
          updated.contentHash,
          updated.updatedAt,
          current.id,
          current.revision,
          current.contentHash
        )
      if (result.changes !== 1) throw new Error('Proposal draft changed while it was being updated.')
      this.insertProposalEvent(updated, 'updated', actor, { previousRevision: current.revision }, updated.updatedAt)
    })
    save()
    this.stores.candidateMatch.refreshBusinessPriorityProjectionsForPair(updated.jobCaseId, updated.candidateProfileId, now)
    return updated
  }

  approveProposalDraft(rawInput: ApproveProposalDraftInput, actor: string, now = new Date()): ProposalDraftSnapshot {
    const input = approveProposalDraftInputSchema.parse(rawInput)
    const current = this.getProposalDraft(input.draftId)
    if (!current) throw new Error('Proposal draft was not found.')
    if (current.revision !== input.revision) throw new Error('Proposal draft changed. Reload before approval.')
    const approved = approveLocalProposalDraft(current, input.contentHash, actor, now)
    const save = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE proposal_drafts SET
             payload_json = ?, status = ?, approved_content_hash = ?, updated_at = ?
           WHERE id = ? AND revision = ? AND content_hash = ?`
        )
        .run(
          JSON.stringify(approved),
          approved.status,
          approved.approvedContentHash,
          approved.updatedAt,
          current.id,
          current.revision,
          current.contentHash
        )
      if (result.changes !== 1) throw new Error('Proposal draft changed while it was being approved.')
      this.insertProposalEvent(approved, 'approved', actor, { approvals: Object.keys(input.approvals) }, approved.updatedAt)
    })
    save()
    this.stores.candidateMatch.refreshBusinessPriorityProjectionsForPair(approved.jobCaseId, approved.candidateProfileId, now)
    return approved
  }

  beginProposalExport(
    draftId: string,
    revision: number,
    expectedContentHash: string,
    exportId: string,
    targetPathHash: string,
    actor: string,
    now = new Date()
  ): ProposalDraftSnapshot {
    const current = this.getProposalDraft(draftId)
    if (!current) throw new Error('Proposal draft was not found.')
    if (current.revision !== revision || current.contentHash !== expectedContentHash) {
      throw new Error('Proposal content changed. Review it again before export.')
    }
    if (current.approvedContentHash !== current.contentHash || !['approved', 'exported'].includes(current.status)) {
      throw new Error('Proposal content must be approved before export.')
    }
    if (current.followUp.stage !== null) throw new Error('A proposal with recorded delivery or sales results cannot be exported again.')
    const createdAt = now.toISOString()
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO proposal_exports(
             id, draft_id, status, target_path_hash, package_hash, error_code, created_at, completed_at
           ) VALUES (?, ?, 'preparing', ?, NULL, NULL, ?, NULL)`
        )
        .run(exportId, draftId, targetPathHash, createdAt)
      this.insertProposalEvent(current, 'export-started', actor, { exportId }, createdAt)
    })
    save()
    return current
  }

  completeProposalExport(
    exportId: string,
    draftId: string,
    expectedContentHash: string,
    packageHash: string,
    actor: string,
    now = new Date()
  ): ProposalDraftSnapshot {
    const current = this.getProposalDraft(draftId)
    if (!current || current.contentHash !== expectedContentHash) {
      throw new Error('Proposal changed before export completion could be recorded.')
    }
    const exported = markProposalExported(current, packageHash, now)
    const save = this.database.transaction(() => {
      const exportRow = this.database
        .prepare<[string, string], ProposalExportRow>(
          "SELECT id, draft_id, status FROM proposal_exports WHERE id = ? AND draft_id = ? AND status = 'preparing'"
        )
        .get(exportId, draftId)
      if (!exportRow) throw new Error('Prepared proposal export was not found.')
      const updated = this.database
        .prepare(
          `UPDATE proposal_drafts SET payload_json = ?, status = ?, approved_content_hash = ?, updated_at = ?
           WHERE id = ? AND revision = ? AND content_hash = ?`
        )
        .run(
          JSON.stringify(exported),
          exported.status,
          exported.approvedContentHash,
          exported.updatedAt,
          draftId,
          current.revision,
          expectedContentHash
        )
      if (updated.changes !== 1) throw new Error('Proposal draft changed while export was completing.')
      this.database
        .prepare(
          `UPDATE proposal_exports SET status = 'completed', package_hash = ?, completed_at = ?
           WHERE id = ? AND status = 'preparing'`
        )
        .run(packageHash, exported.exportedAt, exportId)
      this.insertProposalEvent(exported, 'exported', actor, { exportId, deliveryState: 'exported-not-sent' }, exported.updatedAt)
    })
    save()
    this.stores.candidateMatch.refreshBusinessPriorityProjectionsForPair(exported.jobCaseId, exported.candidateProfileId, now)
    return exported
  }

  recordProposalFollowUp(
    rawInput: RecordProposalFollowUpInput,
    eventId: string,
    actor: string,
    now = new Date()
  ): ProposalDraftSnapshot {
    const input = recordProposalFollowUpInputSchema.parse(rawInput)
    const current = this.getProposalDraft(input.draftId)
    if (!current) throw new Error('Proposal draft was not found.')
    const { draft, event } = recordLocalProposalFollowUp(current, input, eventId, actor, now)
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO proposal_follow_up_events(
             id, draft_id, revision, stage, occurred_on, note, actor, recorded_at, cloud_eligible
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
        )
        .run(
          event.id,
          event.draftId,
          event.revision,
          event.stage,
          event.occurredOn,
          event.note,
          event.recordedBy,
          event.recordedAt
        )
      const updated = this.database
        .prepare(
          `UPDATE proposal_drafts SET payload_json = ?, updated_at = ?
           WHERE id = ? AND revision = ? AND content_hash = ?`
        )
        .run(JSON.stringify(draft), draft.updatedAt, draft.id, draft.revision, draft.contentHash)
      if (updated.changes !== 1) throw new Error('Proposal draft changed while the sales result was being recorded.')
    })
    save()
    this.stores.candidateMatch.refreshBusinessPriorityProjectionsForPair(draft.jobCaseId, draft.candidateProfileId, now)
    return draft
  }

  failProposalExport(exportId: string, draftId: string, errorCode: string, actor: string, now = new Date()): void {
    const current = this.getProposalDraft(draftId)
    const failedAt = now.toISOString()
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE proposal_exports SET status = 'failed', error_code = ?, completed_at = ?
           WHERE id = ? AND draft_id = ? AND status = 'preparing'`
        )
        .run(errorCode.slice(0, 120), failedAt, exportId, draftId)
      if (current) this.insertProposalEvent(current, 'export-failed', actor, { exportId, errorCode: errorCode.slice(0, 120) }, failedAt)
    })
    save()
  }

  markProposalExportOutcomeUnknown(exportId: string, draftId: string, actor: string, now = new Date()): ProposalDraftSnapshot {
    const current = this.getProposalDraft(draftId)
    if (!current) throw new Error('Proposal draft was not found while recording an unknown export outcome.')
    const unknown = markProposalExportUnknown(current, now)
    const recordedAt = now.toISOString()
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE proposal_exports SET status = 'unknown', error_code = 'OUTCOME_UNKNOWN', completed_at = ?
           WHERE id = ? AND draft_id = ? AND status = 'preparing'`
        )
        .run(recordedAt, exportId, draftId)
      this.database
        .prepare('UPDATE proposal_drafts SET payload_json = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(unknown), unknown.status, unknown.updatedAt, unknown.id)
      this.insertProposalEvent(unknown, 'export-unknown', actor, { exportId }, recordedAt)
    })
    save()
    this.stores.candidateMatch.refreshBusinessPriorityProjectionsForPair(unknown.jobCaseId, unknown.candidateProfileId, now)
    return unknown
  }

  recoverInterruptedProposalExports(now = new Date()): void {
    const rows = this.database
      .prepare<[], ProposalExportRow>(
        "SELECT id, draft_id, status FROM proposal_exports WHERE status = 'preparing'"
      )
      .all()
    if (rows.length === 0) return
    const recoveredAt = now.toISOString()
    const recover = this.database.transaction(() => {
      for (const row of rows) {
        const current = this.getProposalDraft(row.draft_id)
        this.database
          .prepare(
            "UPDATE proposal_exports SET status = 'unknown', error_code = 'INTERRUPTED', completed_at = ? WHERE id = ? AND status = 'preparing'"
          )
          .run(recoveredAt, row.id)
        if (!current) continue
        const unknown = markProposalExportUnknown(current, now)
        this.database
          .prepare('UPDATE proposal_drafts SET payload_json = ?, status = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(unknown), unknown.status, unknown.updatedAt, unknown.id)
        this.insertProposalEvent(unknown, 'export-unknown', 'system', { exportId: row.id }, recoveredAt)
      }
    })
    recover()
  }

  private insertProposalEvent(
    draft: ProposalDraftSnapshot,
    eventType: 'created' | 'updated' | 'approved' | 'export-started' | 'exported' | 'export-failed' | 'export-unknown',
    actor: string,
    details: Record<string, unknown>,
    createdAt: string
  ): void {
    this.database
      .prepare(
        `INSERT INTO proposal_events(
           id, draft_id, event_type, content_hash, actor, details_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), draft.id, eventType, draft.contentHash, actor, JSON.stringify(details), createdAt)
  }
}
