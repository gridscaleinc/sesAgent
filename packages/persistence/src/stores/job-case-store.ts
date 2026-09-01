import { createHash, randomUUID } from 'node:crypto'
import {
  agentJobCaseDraftFacts,
  statesNationalityRestriction,
  type ConfirmedJobCase,
  type JobCaseExtractionDraft,
  type JobCaseExtractionDraftV2,
  type JobCaseSource,
  confirmedJobCaseSchema,
  jobCaseExtractionDraftSchema,
  jobCaseSourceSchema
} from '@job-cases'
import { type LocalPiiMapping, type RedactionSessionEvidence, detectDirectIdentifiers } from '@privacy'
import {
  type AgentJobCaseDraftFacts,
  deleteJobCaseDataInputSchema,
  jobCaseDeletionPreviewSchema,
  jobCaseReviewSnapshotSchema,
  reopenJobCaseReviewInputSchema,
  setJobCaseLifecycleInputSchema,
  submitJobCaseReviewInputSchema
} from '@shared'
import {
  type DeleteJobCaseDataInput,
  type JobCaseDeletionPreview,
  type JobCaseReviewSnapshot,
  type JobCaseSourceText,
  type JobCaseVersionDetail,
  type ReopenJobCaseReviewInput,
  type SetJobCaseLifecycleInput,
  type SubmitJobCaseReviewInput
} from '@shared/contracts'
import { type AgentReferenceTargets } from '../agent-conversations'
import { jobCaseBusinessFingerprint, jobCaseSourceFromRow, storedGmailMessageFromRow } from '../mappers'
import {
  type GmailMessageRow,
  type JobCaseFieldAuditRow,
  type JobCaseLifecycleRow,
  type JobCaseReviewJoinRow,
  type JobCaseReviewStateRow,
  type JobCaseRow,
  type JobCaseSourceRow,
  type StoredGmailMessageInput
} from '../rows'
import { DomainStore } from './base'

export class JobCaseStore extends DomainStore {
  listGmailMessagesPendingJobCaseDrafts(accountEmail: string, limit = 100): StoredGmailMessageInput[] {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)))
    return this.database
      .prepare<[string, number], GmailMessageRow>(
        `SELECT message.* FROM gmail_messages message
         LEFT JOIN job_case_sources source
           ON source.source_type = 'gmail'
          AND source.provider_account = message.account_email
          AND source.provider_message_id = message.gmail_message_id
         LEFT JOIN job_case_extractions extraction
           ON extraction.source_id = source.id
         WHERE message.account_email = ?
           AND message.classification = 'job-case'
           AND extraction.review_id IS NULL
         ORDER BY message.internal_date ASC
         LIMIT ?`
      )
      .all(accountEmail, boundedLimit)
      .map(storedGmailMessageFromRow)
  }

  ensureGmailJobCaseSource(input: JobCaseSource): JobCaseSource {
    const source = jobCaseSourceSchema.parse(input)
    if (source.sourceType !== 'gmail' || !source.providerAccount || !source.providerMessageId) {
      throw new Error('Only a complete Gmail job-case source can be ensured by this operation.')
    }
    this.database
      .prepare(
        `INSERT OR IGNORE INTO job_case_sources(
           id, source_type, provider_account, provider_message_id, thread_id, from_domain,
           message_date, redacted_subject, redacted_body, redaction_session_id,
           warning_codes_json, business_fingerprint, created_at
         ) VALUES (?, 'gmail', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        source.id,
        source.providerAccount,
        source.providerMessageId,
        source.threadId,
        source.fromDomain,
        source.messageDate,
        source.redactedSubject,
        source.redactedBody,
        source.redactionSessionId,
        JSON.stringify(source.warningCodes),
        jobCaseBusinessFingerprint(source.redactedSubject, source.redactedBody),
        source.createdAt
      )
    const row = this.database
      .prepare<[string, string], JobCaseSourceRow>(
        `SELECT * FROM job_case_sources
         WHERE source_type = 'gmail' AND provider_account = ? AND provider_message_id = ?`
      )
      .get(source.providerAccount, source.providerMessageId)
    if (!row) throw new Error('Gmail job-case source could not be reloaded.')
    return jobCaseSourceFromRow(row)
  }

  saveJobCaseDraft(input: JobCaseExtractionDraft): boolean {
    const draft = jobCaseExtractionDraftSchema.parse(input)
    if (draft.version !== 'job-case-extraction-v2') {
      throw new Error('Only v2 job-case drafts can be newly persisted.')
    }
    const save = this.database.transaction(() => {
      return this.insertJobCaseDraft(draft)
    })
    return save()
  }

  saveJobCaseSourceAndDraft(rawSource: JobCaseSource, rawDraft: JobCaseExtractionDraftV2): boolean {
    const source = jobCaseSourceSchema.parse(rawSource)
    const draft = jobCaseExtractionDraftSchema.parse(rawDraft)
    if (draft.version !== 'job-case-extraction-v2' || draft.sourceId !== source.id || draft.sourceType !== source.sourceType) {
      throw new Error('Job-case source and extraction draft do not have the same identity.')
    }
    const save = this.database.transaction(() => {
      this.insertJobCaseSource(source)
      if (!this.insertJobCaseDraft(draft)) throw new Error('Job-case extraction draft identity already exists.')
      return true
    })
    return save()
  }

  saveRedactedJobCaseSourceAndDraft(
    session: RedactionSessionEvidence,
    mappings: LocalPiiMapping[],
    rawSource: JobCaseSource,
    rawDraft: JobCaseExtractionDraftV2
  ): boolean {
    const source = jobCaseSourceSchema.parse(rawSource)
    const draft = jobCaseExtractionDraftSchema.parse(rawDraft)
    if (
      session.id !== source.redactionSessionId ||
      draft.version !== 'job-case-extraction-v2' ||
      draft.sourceId !== source.id ||
      draft.sourceType !== source.sourceType
    ) {
      throw new Error('Redaction evidence, source, and extraction draft do not have the same identity.')
    }
    const save = this.database.transaction(() => {
      this.stores.privacy.persistRedactionSession(session, mappings)
      this.insertJobCaseSource(source)
      if (!this.insertJobCaseDraft(draft)) throw new Error('Job-case extraction draft identity already exists.')
      return true
    })
    return save()
  }

  private insertJobCaseSource(source: JobCaseSource): void {
    this.database
      .prepare(
        `INSERT INTO job_case_sources(
           id, source_type, provider_account, provider_message_id, thread_id, from_domain,
           message_date, redacted_subject, redacted_body, redaction_session_id,
           warning_codes_json, business_fingerprint, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        source.id,
        source.sourceType,
        source.providerAccount,
        source.providerMessageId,
        source.threadId,
        source.fromDomain,
        source.messageDate,
        source.redactedSubject,
        source.redactedBody,
        source.redactionSessionId,
        JSON.stringify(source.warningCodes),
        jobCaseBusinessFingerprint(source.redactedSubject, source.redactedBody),
        source.createdAt
      )
  }

  findJobCaseReviewByBusinessFingerprint(subject: string, body: string): JobCaseReviewSnapshot | null {
    const row = this.database
      .prepare<[string], { review_id: string }>(
        `SELECT extraction.review_id FROM job_case_sources source
         JOIN job_case_extractions extraction ON extraction.source_id = source.id
         WHERE source.business_fingerprint = ?
         ORDER BY source.created_at ASC LIMIT 1`
      )
      .get(jobCaseBusinessFingerprint(subject, body))
    return row ? this.getJobCaseReview(row.review_id) : null
  }

  getEmlJobCaseReview(sourceMessageKey: string): JobCaseReviewSnapshot | null {
    if (!/^eml_[a-f0-9]{64}$/u.test(sourceMessageKey)) throw new Error('EML source message key is invalid.')
    const row = this.database
      .prepare<[string], { review_id: string }>(
        `SELECT extraction.review_id FROM job_case_sources source
         JOIN job_case_extractions extraction ON extraction.source_id = source.id
         WHERE source.source_type = 'eml' AND source.provider_message_id = ?`
      )
      .get(sourceMessageKey)
    return row ? this.getJobCaseReview(row.review_id) : null
  }

  private insertJobCaseDraft(draft: JobCaseExtractionDraftV2): boolean {
    const inserted = this.database
      .prepare(
        `INSERT OR IGNORE INTO job_case_extractions(
           review_id, source_id, draft_json, extraction_version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        draft.reviewId,
        draft.sourceId,
        JSON.stringify(draft),
        draft.version,
        draft.createdAt,
        draft.createdAt
      )
    if (inserted.changes !== 1) return false
    this.database
      .prepare(
        `INSERT INTO job_case_review_states(
           review_id, status, privacy_reviewed, revision, updated_at
         ) VALUES (?, 'awaiting-review', 0, 1, ?)`
      )
      .run(draft.reviewId, draft.createdAt)
    return true
  }

  getJobCaseReview(reviewId: string): JobCaseReviewSnapshot | null {
    const row = this.database
      .prepare<[string], JobCaseReviewJoinRow>(
        `SELECT state.*, extraction.draft_json, source.id AS source_id, source.source_type,
                source.provider_message_id, source.thread_id, source.message_date,
                source.from_domain, source.redacted_subject, source.redacted_body
         FROM job_case_review_states state
         JOIN job_case_extractions extraction ON extraction.review_id = state.review_id
         JOIN job_case_sources source ON source.id = extraction.source_id
         WHERE state.review_id = ?`
      )
      .get(reviewId)
    if (!row) return null
    const draft = jobCaseExtractionDraftSchema.parse(JSON.parse(row.draft_json))
    const auditRows = row.status === 'completed'
      ? this.database
          .prepare<[string, number], JobCaseFieldAuditRow>(
            `SELECT field_key, original_value, confirmed_value, change_reason, source_labels_json
             FROM job_case_field_review_audits
             WHERE review_id = ? AND review_revision = ?`
          )
          .all(reviewId, row.revision)
      : []
    const auditsByKey = new Map(auditRows.map((audit) => [audit.field_key, audit]))
    const caseRow = this.database
      .prepare<[string], JobCaseRow>(
        'SELECT case_json, status FROM job_cases WHERE source_review_id = ? ORDER BY version DESC LIMIT 1'
      )
      .get(reviewId)
    const jobCase = caseRow ? confirmedJobCaseSchema.parse(JSON.parse(caseRow.case_json)) : null
    const latestFields = new Map(jobCase?.fields.map((field) => [field.key, field]) ?? [])
    const lifecycle = this.database
      .prepare<[string], JobCaseLifecycleRow>('SELECT * FROM job_case_lifecycle WHERE source_review_id = ?')
      .get(reviewId)
    return jobCaseReviewSnapshotSchema.parse({
      reviewId,
      sourceId: row.source_id,
      sourceType: row.source_type,
      providerMessageId: row.provider_message_id,
      threadId: row.thread_id,
      fromDomain: row.from_domain,
      messageDate: row.message_date,
      redactedSubject: row.redacted_subject,
      redactedPreview: `${row.redacted_subject}\n\n${row.redacted_body}`.slice(0, 4_000),
      reviewRevision: row.revision,
      status: row.status,
      privacyReviewed: row.privacy_reviewed === 1,
      fields: draft.fields.map((field) => {
        const audit = auditsByKey.get(field.key)
        const latest = latestFields.get(field.key)
        const baselineValue = row.status === 'awaiting-review' && latest ? latest.value : field.value
        return {
          key: field.key,
          label: field.label,
          originalValue: baselineValue,
          value: audit ? audit.confirmed_value : baselineValue,
          confidence: field.confidence,
          status: audit ? 'confirmed' : latest ? 'needs_review' : field.status,
          sourceLabels: audit
            ? JSON.parse(audit.source_labels_json) as string[]
            : latest?.sourceLabels ?? field.sources.map((source) => source.sourceLabel),
          changed: audit ? audit.original_value !== audit.confirmed_value : false,
          changeReason: audit?.change_reason ?? null
        }
      }),
      warningCodes: draft.warningCodes,
      completedAt: row.completed_at,
      reviewerDisplayName: row.reviewer_display_name,
      jobCase: jobCase
        ? {
            id: jobCase.id,
            sourceReviewId: jobCase.sourceReviewId,
            version: jobCase.version,
            status: caseRow?.status,
            confirmedAt: jobCase.confirmedAt,
            confirmedBy: jobCase.confirmedBy,
            containsDirectIdentifiers: jobCase.containsDirectIdentifiers
          }
        : null,
      lifecycle: lifecycle?.state ?? 'active',
      intakeBatchId: draft.version === 'job-case-extraction-v2' ? draft.intakeBatchId ?? null : null,
      cloudEligible: false
    })
  }

  /** De-identified draft facts for the agent; null when the review is gone. */
  getAgentJobCaseDraftFacts(reviewId: string, label: string): AgentJobCaseDraftFacts | null {
    const review = this.getJobCaseReview(reviewId)
    return review ? agentJobCaseDraftFacts(review, label) : null
  }

  listJobCaseReviews(): JobCaseReviewSnapshot[] {
    const rows = this.database
      .prepare<[], { review_id: string }>('SELECT review_id FROM job_case_review_states ORDER BY updated_at DESC')
      .all()
    return rows.flatMap((row) => {
      const review = this.getJobCaseReview(row.review_id)
      return review ? [review] : []
    })
  }

  listActiveJobCases(): ConfirmedJobCase[] {
    return this.database
      .prepare<[], JobCaseRow>(
        `SELECT job.case_json, job.status FROM job_cases job
         LEFT JOIN job_case_lifecycle lifecycle ON lifecycle.source_review_id = job.source_review_id
         WHERE job.status = 'active' AND coalesce(lifecycle.state, 'active') = 'active'
         ORDER BY job.confirmed_at DESC`
      )
      .all()
      .map((row) => confirmedJobCaseSchema.parse(JSON.parse(row.case_json)))
  }

  getJobCaseHistory(reviewId: string): JobCaseVersionDetail[] {
    const sourceRow = this.database
      .prepare<[string], JobCaseSourceRow>(
        `SELECT source.* FROM job_case_sources source
         JOIN job_case_extractions extraction ON extraction.source_id = source.id
         WHERE extraction.review_id = ?`
      )
      .get(reviewId)
    if (!sourceRow) return []
    const source = jobCaseSourceFromRow(sourceRow)
    const lifecycle = this.database
      .prepare<[string], JobCaseLifecycleRow>('SELECT * FROM job_case_lifecycle WHERE source_review_id = ?')
      .get(reviewId)
    return this.database
      .prepare<[string], JobCaseRow>(
        'SELECT case_json, status FROM job_cases WHERE source_review_id = ? ORDER BY version DESC'
      )
      .all(reviewId)
      .map((row) => {
        const jobCase = confirmedJobCaseSchema.parse(JSON.parse(row.case_json))
        return {
          id: jobCase.id,
          sourceReviewId: jobCase.sourceReviewId,
          sourceId: source.id,
          sourceType: source.sourceType,
          version: jobCase.version,
          reviewRevision: jobCase.reviewRevision,
          status: row.status === 'active' && lifecycle?.state === 'archived' ? 'archived' as const : row.status,
          fields: jobCase.fields,
          confirmedAt: jobCase.confirmedAt,
          confirmedBy: jobCase.confirmedBy,
          containsDirectIdentifiers: jobCase.containsDirectIdentifiers
        }
      })
  }

  /** The stored redacted original behind a review; null when the review is gone. */
  getJobCaseSourceText(reviewId: string): JobCaseSourceText | null {
    const row = this.database
      .prepare<[string], JobCaseSourceRow>(
        `SELECT source.* FROM job_case_sources source
         JOIN job_case_extractions extraction ON extraction.source_id = source.id
         WHERE extraction.review_id = ?`
      )
      .get(reviewId)
    if (!row) return null
    const source = jobCaseSourceFromRow(row)
    return {
      sourceType: source.sourceType,
      redactedSubject: source.redactedSubject,
      redactedBody: source.redactedBody,
      messageDate: source.messageDate,
      fromDomain: source.fromDomain
    }
  }

  setJobCaseLifecycle(
    input: SetJobCaseLifecycleInput,
    changedBy: string,
    now = new Date()
  ): JobCaseReviewSnapshot {
    const validated = setJobCaseLifecycleInputSchema.parse(input)
    const state = this.database
      .prepare<[string], JobCaseReviewStateRow>('SELECT * FROM job_case_review_states WHERE review_id = ?')
      .get(validated.reviewId)
    if (!state || state.status !== 'completed') throw new Error('Confirmed job case was not found.')
    const activeCase = this.database
      .prepare<[string], { id: string }>(
        "SELECT id FROM job_cases WHERE source_review_id = ? AND status = 'active'"
      )
      .get(validated.reviewId)
    if (!activeCase) throw new Error('Active job case was not found.')
    const changedAt = now.toISOString()
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO job_case_lifecycle(source_review_id, state, reason, changed_by, changed_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(source_review_id) DO UPDATE SET
             state = excluded.state,
             reason = excluded.reason,
             changed_by = excluded.changed_by,
             changed_at = excluded.changed_at`
        )
        .run(validated.reviewId, validated.state, validated.reason, changedBy, changedAt)
      this.database
        .prepare(
          `INSERT INTO job_case_events(
             id, source_review_id, event_type, reason, actor, review_revision, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          randomUUID(),
          validated.reviewId,
          validated.state === 'archived' ? 'archived' : 'restored',
          validated.reason,
          changedBy,
          state.revision,
          changedAt
        )
      this.database
        .prepare(
          'INSERT INTO change_outbox(id, entity_type, entity_id, revision, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), 'job_case_lifecycle', validated.reviewId, state.revision, 'upsert', changedAt)
    })
    save()
    const review = this.getJobCaseReview(validated.reviewId)
    if (!review) throw new Error('Updated job case could not be reloaded.')
    return review
  }

  reopenJobCaseReview(
    input: ReopenJobCaseReviewInput,
    changedBy: string,
    now = new Date()
  ): JobCaseReviewSnapshot {
    const validated = reopenJobCaseReviewInputSchema.parse(input)
    const state = this.database
      .prepare<[string], JobCaseReviewStateRow>('SELECT * FROM job_case_review_states WHERE review_id = ?')
      .get(validated.reviewId)
    if (!state) throw new Error('Job case review was not found.')
    if (state.status !== 'completed') throw new Error('Job case review is already open.')
    const lifecycle = this.database
      .prepare<[string], JobCaseLifecycleRow>('SELECT * FROM job_case_lifecycle WHERE source_review_id = ?')
      .get(validated.reviewId)
    if (lifecycle?.state === 'archived') throw new Error('Restore the archived job case before revising it.')
    const nextRevision = state.revision + 1
    const changedAt = now.toISOString()
    const save = this.database.transaction(() => {
      const updated = this.database
        .prepare(
          `UPDATE job_case_review_states SET
             status = 'awaiting-review', privacy_reviewed = 0, revision = ?, reviewer_id = NULL,
             reviewer_display_name = NULL, completed_at = NULL, updated_at = ?
           WHERE review_id = ? AND status = 'completed' AND revision = ?`
        )
        .run(nextRevision, changedAt, validated.reviewId, state.revision)
      if (updated.changes !== 1) throw new Error('Job case changed while its revision was being opened.')
      this.database
        .prepare(
          `INSERT INTO job_case_events(
             id, source_review_id, event_type, reason, actor, review_revision, created_at
           ) VALUES (?, ?, 'revision-opened', ?, ?, ?, ?)`
        )
        .run(randomUUID(), validated.reviewId, validated.reason, changedBy, nextRevision, changedAt)
    })
    save()
    const review = this.getJobCaseReview(validated.reviewId)
    if (!review) throw new Error('Reopened job case review could not be reloaded.')
    return review
  }

  previewJobCaseDeletion(reviewId: string): JobCaseDeletionPreview {
    const sourceRow = this.database
      .prepare<[string], JobCaseSourceRow>(
        `SELECT source.* FROM job_case_sources source
         JOIN job_case_extractions extraction ON extraction.source_id = source.id
         WHERE extraction.review_id = ?`
      )
      .get(reviewId)
    if (!sourceRow) throw new Error('Job case source was not found.')
    const source = jobCaseSourceFromRow(sourceRow)
    const history = this.getJobCaseHistory(reviewId)
    const relatedIds = new Set([reviewId, source.id, ...history.map((version) => version.id)])
    const taskRecords = this.stores.workTasks.listWorkTasks().filter((task) =>
      task.contextBindings.some((binding) => binding.objectType === 'job-case' && relatedIds.has(binding.objectId))
    ).length
    const reviewAudits = this.database
      .prepare<[string], { count: number }>(
        'SELECT count(*) AS count FROM job_case_field_review_audits WHERE review_id = ?'
      )
      .get(reviewId)?.count ?? 0
    const evaluationDraftCases = this.database
      .prepare<[string], { count: number }>(
        `SELECT count(*) AS count FROM candidate_evaluation_draft_cases draft_case
         JOIN job_cases job ON job.id = draft_case.job_case_id
         WHERE job.source_review_id = ?`
      )
      .get(reviewId)?.count ?? 0
    const proposalDrafts = this.database
      .prepare<[string], { count: number }>(
        `SELECT count(*) AS count FROM proposal_drafts proposal
         JOIN job_cases job ON job.id = proposal.job_case_id
         WHERE job.source_review_id = ?`
      )
      .get(reviewId)?.count ?? 0
    const piiMappings = this.database
      .prepare<[string], { count: number }>(
        'SELECT count(*) AS count FROM local_pii_mappings WHERE redaction_session_id = ?'
      )
      .get(source.redactionSessionId)?.count ?? 0
    const caseIds = history.map((version) => version.id)
    const caseIdSet = new Set(caseIds)
    const agentMatchRuns = this.database
      .prepare<[], { id: string; job_case_id: string | null }>('SELECT id, job_case_id FROM candidate_match_runs')
      .all()
      .filter((row) => row.job_case_id !== null && caseIdSet.has(row.job_case_id))
    const agentRunIds = new Set(agentMatchRuns.map((row) => row.id))
    const agentResultRows = this.database
      .prepare<[], { id: string; run_id: string }>('SELECT id, run_id FROM candidate_match_results')
      .all()
      .filter((row) => agentRunIds.has(row.run_id))
    const agentReferences = this.stores.agentConversations.countSalesAgentReferences({
      candidateDocumentIds: new Set(),
      jobCaseIds: caseIdSet,
      jobCaseReviewIds: new Set([reviewId]),
      matchRunIds: agentRunIds,
      matchResultIds: new Set(agentResultRows.map((row) => row.id))
    })
    const counts = {
      caseVersions: history.length,
      reviewAudits,
      taskRecords,
      proposalDrafts,
      evaluationDraftCases,
      piiMappings,
      sourceRecords: 1,
      gmailMessages: source.sourceType === 'gmail' ? 1 : 0,
      agentReferences
    }
    const confirmationHash = createHash('sha256').update(JSON.stringify({
      reviewId,
      sourceId: source.id,
      providerMessageId: source.providerMessageId,
      latestCaseId: history[0]?.id,
      latestVersion: history[0]?.version,
      counts
    })).digest('hex')
    const title = history[0]?.fields.find((field) => field.key === 'title')?.value ?? source.redactedSubject
    return jobCaseDeletionPreviewSchema.parse({
      reviewId,
      sourceId: source.id,
      title,
      sourceType: source.sourceType,
      counts,
      confirmationHash,
      warningCodes: [
        'EXTERNAL_EXPORTS_OUTSIDE_SCOPE',
        'BACKUP_SYSTEM_NOT_CONFIGURED',
        ...(source.sourceType === 'gmail' ? ['GMAIL_SOURCE_TOMBSTONED_TO_PREVENT_REIMPORT'] : [])
      ]
    })
  }

  deleteJobCaseDatabaseData(rawInput: DeleteJobCaseDataInput, now = new Date()): JobCaseDeletionPreview {
    const input = deleteJobCaseDataInputSchema.parse(rawInput)
    const preview = this.previewJobCaseDeletion(input.reviewId)
    if (preview.confirmationHash !== input.confirmationHash) {
      throw new Error('Job case deletion preview changed. Review the impact again before deleting.')
    }
    const sourceRow = this.database
      .prepare<[string], JobCaseSourceRow>(
        `SELECT source.* FROM job_case_sources source
         JOIN job_case_extractions extraction ON extraction.source_id = source.id
         WHERE extraction.review_id = ?`
      )
      .get(input.reviewId)
    if (!sourceRow) throw new Error('Job case source was not found.')
    const source = jobCaseSourceFromRow(sourceRow)
    const caseIds = this.getJobCaseHistory(input.reviewId).map((version) => version.id)
    const relatedIds = new Set([input.reviewId, source.id, ...caseIds])
    const agentMatchRuns = this.database
      .prepare<[], { id: string; job_case_id: string | null }>('SELECT id, job_case_id FROM candidate_match_runs')
      .all()
      .filter((row) => row.job_case_id !== null && relatedIds.has(row.job_case_id))
    const agentRunIds = new Set(agentMatchRuns.map((row) => row.id))
    const agentResultRows = this.database
      .prepare<[], { id: string; run_id: string }>('SELECT id, run_id FROM candidate_match_results')
      .all()
      .filter((row) => agentRunIds.has(row.run_id))
    const agentTargets: AgentReferenceTargets = {
      candidateDocumentIds: new Set(),
      jobCaseIds: new Set(caseIds),
      jobCaseReviewIds: new Set([input.reviewId]),
      matchRunIds: agentRunIds,
      matchResultIds: new Set(agentResultRows.map((row) => row.id))
    }
    const taskIds = this.stores.workTasks.listWorkTasks()
      .filter((task) => task.contextBindings.some((binding) =>
        binding.objectType === 'job-case' && relatedIds.has(binding.objectId)
      ))
      .map((task) => task.id)
    const deletedAt = now.toISOString()
    const remove = this.database.transaction(() => {
      this.stores.agentConversations.sanitizeSalesAgentConversations(agentTargets, now)
      for (const taskId of taskIds) {
        this.database.prepare('DELETE FROM work_tasks WHERE id = ?').run(taskId)
        this.database.prepare("DELETE FROM change_outbox WHERE entity_type = 'work_task' AND entity_id = ?").run(taskId)
      }
      for (const caseId of caseIds) {
        this.database.prepare("DELETE FROM change_outbox WHERE entity_type = 'job_case' AND entity_id = ?").run(caseId)
      }
      this.database
        .prepare("DELETE FROM change_outbox WHERE entity_type = 'job_case_lifecycle' AND entity_id = ?")
        .run(input.reviewId)
      this.database.prepare('DELETE FROM job_cases WHERE source_review_id = ?').run(input.reviewId)
      if (source.sourceType === 'gmail' && source.providerAccount && source.providerMessageId) {
        this.database
          .prepare(
            `INSERT INTO gmail_message_tombstones(account_email, gmail_message_id, deleted_at, reason)
             VALUES (?, ?, ?, 'job-case-permanent-deletion')
             ON CONFLICT(account_email, gmail_message_id) DO UPDATE SET deleted_at = excluded.deleted_at`
          )
          .run(source.providerAccount, source.providerMessageId, deletedAt)
        const deletedMessage = this.database
          .prepare('DELETE FROM gmail_messages WHERE account_email = ? AND gmail_message_id = ?')
          .run(source.providerAccount, source.providerMessageId)
        if (deletedMessage.changes === 0) {
          this.database.prepare('DELETE FROM job_case_sources WHERE id = ?').run(source.id)
        }
      } else {
        const deletedSource = this.database.prepare('DELETE FROM job_case_sources WHERE id = ?').run(source.id)
        if (deletedSource.changes !== 1) throw new Error('Local job case source could not be deleted.')
      }
      const remaining = this.database
        .prepare<[string], { present: number }>('SELECT 1 AS present FROM job_case_extractions WHERE review_id = ?')
        .get(input.reviewId)
      if (remaining) throw new Error('Job case review records could not be deleted.')
      this.database.prepare('DELETE FROM local_pii_mappings WHERE redaction_session_id = ?').run(source.redactionSessionId)
      this.database.prepare('DELETE FROM redaction_sessions WHERE id = ?').run(source.redactionSessionId)
      this.database
        .prepare(
          'INSERT INTO change_outbox(id, entity_type, entity_id, revision, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), 'job_case', input.reviewId, 1, 'delete', deletedAt)
    })
    remove()
    return preview
  }

  confirmJobCaseReview(
    input: SubmitJobCaseReviewInput,
    reviewerId: string,
    reviewerDisplayName: string,
    now = new Date()
  ): JobCaseReviewSnapshot {
    const validated = submitJobCaseReviewInputSchema.parse(input)
    const state = this.database
      .prepare<[string], JobCaseReviewStateRow>('SELECT * FROM job_case_review_states WHERE review_id = ?')
      .get(validated.reviewId)
    if (!state) throw new Error('Job case review state was not found.')
    if (state.status !== 'awaiting-review') throw new Error('Job case review is already completed.')
    if (state.revision !== validated.reviewRevision) throw new Error('Job case review changed. Reload before confirming.')
    const extractionRow = this.database
      .prepare<[string], { draft_json: string; source_id: string }>(
        'SELECT draft_json, source_id FROM job_case_extractions WHERE review_id = ?'
      )
      .get(validated.reviewId)
    if (!extractionRow) throw new Error('Job case extraction draft was not found.')
    const draft = jobCaseExtractionDraftSchema.parse(JSON.parse(extractionRow.draft_json))
    const sourceRow = this.database
      .prepare<[string], JobCaseSourceRow>('SELECT * FROM job_case_sources WHERE id = ?')
      .get(extractionRow.source_id)
    if (!sourceRow) throw new Error('Job case source was not found.')
    const source = jobCaseSourceFromRow(sourceRow)
    const previousCaseRow = this.database
      .prepare<[string], JobCaseRow>(
        "SELECT case_json, status FROM job_cases WHERE source_review_id = ? AND status = 'active' LIMIT 1"
      )
      .get(validated.reviewId)
    const previousCase = previousCaseRow
      ? confirmedJobCaseSchema.parse(JSON.parse(previousCaseRow.case_json))
      : null
    const previousFields = new Map(previousCase?.fields.map((field) => [field.key, field]) ?? [])
    const submissionByKey = new Map(validated.fields.map((field) => [field.key, field]))
    if (submissionByKey.size !== draft.fields.length || draft.fields.some((field) => !submissionByKey.has(field.key))) {
      throw new Error('Every job case field must be explicitly confirmed exactly once.')
    }
    for (const field of draft.fields) {
      const submitted = submissionByKey.get(field.key)
      if (!submitted) throw new Error(`Job case field ${field.key} was not confirmed.`)
      const baselineValue = previousFields.get(field.key)?.value ?? field.value
      if (baselineValue !== submitted.value && !submitted.changeReason) {
        throw new Error(`A change reason is required for ${field.label}.`)
      }
    }
    if (!submissionByKey.get('title')?.value) throw new Error('案件名は必須です。')
    const confirmedBusinessFields = validated.fields.map((field) => field.value ?? '').join('\n')
    if (statesNationalityRestriction(confirmedBusinessFields)) {
      throw new Error('国籍条件は保存できません。合法的な就労資格要件だけを使用してください。')
    }
    const residualIdentifiers = validated.fields.flatMap((field) => {
      const found = detectDirectIdentifiers(field.value ?? '')
      if (found.length === 0) return []
      const label = draft.fields.find((item) => item.key === field.key)?.label ?? field.key
      return [`${label}（${found.join(', ')}）`]
    })
    if (residualIdentifiers.length > 0) {
      throw new Error(`案件フィールドに直接識別子を保存できません: ${residualIdentifiers.join('、')}`)
    }

    const reviewedAt = now.toISOString()
    const save = this.database.transaction(() => {
      const current = this.database
        .prepare<[string], JobCaseReviewStateRow>('SELECT * FROM job_case_review_states WHERE review_id = ?')
        .get(validated.reviewId)
      if (!current || current.status !== 'awaiting-review' || current.revision !== validated.reviewRevision) {
        throw new Error('Job case review changed while it was being confirmed.')
      }
      const latestVersion = this.database
        .prepare<[string], { version: number | null }>(
          'SELECT max(version) AS version FROM job_cases WHERE source_review_id = ?'
        )
        .get(validated.reviewId)?.version ?? 0
      const version = latestVersion + 1
      const caseId = randomUUID()
      const jobCase = confirmedJobCaseSchema.parse({
        schemaVersion: 'job-case-v2',
        id: caseId,
        sourceReviewId: validated.reviewId,
        sourceId: source.id,
        sourceType: source.sourceType,
        sourceProviderMessageId: source.providerMessageId,
        sourceThreadId: source.threadId,
        version,
        reviewRevision: validated.reviewRevision,
        fields: draft.fields.map((field) => ({
          key: field.key,
          label: field.label,
          value: submissionByKey.get(field.key)?.value ?? null,
          sourceLabels: [...new Set(field.sources.map((source) => source.sourceLabel))]
        })),
        confirmedAt: reviewedAt,
        confirmedBy: reviewerDisplayName,
        containsDirectIdentifiers: false
      })
      this.database
        .prepare("UPDATE job_cases SET status = 'superseded' WHERE source_review_id = ? AND status = 'active'")
        .run(validated.reviewId)
      this.database
        .prepare(
          `INSERT INTO job_cases(
             id, source_review_id, version, case_json, status, confirmed_at, confirmed_by
           ) VALUES (?, ?, ?, ?, 'active', ?, ?)`
        )
        .run(caseId, validated.reviewId, version, JSON.stringify(jobCase), reviewedAt, reviewerDisplayName)
      this.database
        .prepare(
          `INSERT INTO job_case_lifecycle(source_review_id, state, reason, changed_by, changed_at)
           VALUES (?, 'active', 'Initial confirmation', ?, ?)
           ON CONFLICT(source_review_id) DO NOTHING`
        )
        .run(validated.reviewId, reviewerDisplayName, reviewedAt)

      const insertAudit = this.database.prepare(
        `INSERT INTO job_case_field_review_audits(
           id, review_id, review_revision, field_key, original_value, confirmed_value,
           change_reason, source_labels_json, reviewer_id, reviewed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const field of draft.fields) {
        const submitted = submissionByKey.get(field.key)
        if (!submitted) continue
        insertAudit.run(
          randomUUID(),
          validated.reviewId,
          validated.reviewRevision,
          field.key,
          previousFields.get(field.key)?.value ?? field.value,
          submitted.value,
          submitted.changeReason ?? null,
          JSON.stringify([...new Set(field.sources.map((source) => source.sourceLabel))]),
          reviewerId,
          reviewedAt
        )
      }
      const updated = this.database
        .prepare(
          `UPDATE job_case_review_states SET
             status = 'completed', privacy_reviewed = 1, reviewer_id = ?, reviewer_display_name = ?,
             completed_at = ?, updated_at = ?
           WHERE review_id = ? AND revision = ? AND status = 'awaiting-review'`
        )
        .run(
          reviewerId,
          reviewerDisplayName,
          reviewedAt,
          reviewedAt,
          validated.reviewId,
          validated.reviewRevision
        )
      if (updated.changes !== 1) throw new Error('Job case review could not be committed.')
      this.database
        .prepare(
          'INSERT INTO change_outbox(id, entity_type, entity_id, revision, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), 'job_case', caseId, version, 'upsert', reviewedAt)
    })
    save()
    const result = this.getJobCaseReview(validated.reviewId)
    if (!result) throw new Error('Confirmed job case review could not be reloaded.')
    return result
  }
}
