import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { type WorkTask } from '@domain'
import { type StagedFileRecord } from '@files'
import { type DocumentIR, documentIrSchema } from '@parsers'
import { type LocalPiiMapping, detectDirectIdentifiers } from '@privacy'
import type { AgentCandidateDraftFacts } from '@shared'
import {
  type CandidateExtractionDraft,
  type CandidateProfile,
  candidateExtractionDraftSchema,
  candidateProfileSchema,
  extractLocalCandidatePersonalDetails
} from '@resume'
import {
  candidateDeletionPreviewSchema,
  candidateReviewSnapshotSchema,
  candidateWorkAuthorizationValues,
  resumeAnalysisSummarySchema,
  submitCandidateReviewInputSchema,
  updateCandidateProfileInputSchema,
  setCandidateOwnCompanyInputSchema,
  workTaskSchema
} from '@shared'
import {
  type CandidateDeletionPreview,
  type CandidateProfileVersionDetail,
  type CandidateProjectExperience,
  type CandidateReviewSnapshot,
  type LocalCandidateIdentitySummary,
  type LocalCandidatePersonalDetails,
  type ResumeAnalysisSummary,
  type StagedLocalFile,
  type SubmitCandidateReviewInput,
  type UpdateCandidateProfileInput
} from '@shared/contracts'
import { type AgentReferenceTargets } from '../agent-conversations'
import { assertEmbeddingIdentity, embeddingVectorFromRow, embeddingVectorToBlob } from '../mappers'
import {
  type CandidateExtractionRow,
  type CandidateFieldAuditRow,
  type CandidateProfileEmbeddingInput,
  type CandidateProfileEmbeddingRecord,
  type CandidateProfileEmbeddingRow,
  type CandidateProfileRow,
  type CandidateProjectAuditRow,
  type CandidateProjectEmbeddingInput,
  type CandidateProjectEmbeddingRecord,
  type CandidateProjectEmbeddingRow,
  type CandidateRecordRow,
  type CandidateReviewJoinRow,
  type CandidateReviewStateRow,
  type ParsedDocumentRow,
  type StagedFileRow,
  type TalentPoolMembershipRow
} from '../rows'
import { DomainStore } from './base'

export class CandidateStore extends DomainStore {
  saveStagedFile(file: StagedFileRecord): void {
    this.saveStagedFiles([file])
  }

  saveStagedFiles(files: StagedFileRecord[]): void {
    const insert = this.database.prepare(
        `INSERT INTO staged_files(
           token, name, format, size, sha256, encrypted_path, privacy_status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
    const save = this.database.transaction(() => {
      for (const file of files) {
        insert.run(
          file.token,
          file.name,
          file.format,
          file.size,
          file.sha256,
          file.encryptedPath,
          file.privacyStatus,
          file.createdAt
        )
      }
    })
    save()
  }

  /** Persist the staged originals and their audit task as one DB transaction. */
  saveResumeImportTask(task: WorkTask, files: StagedFileRecord[]): void {
    const validatedTask = workTaskSchema.parse(task)
    const insertFile = this.database.prepare(
      `INSERT INTO staged_files(
         token, name, format, size, sha256, encrypted_path, privacy_status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const save = this.database.transaction(() => {
      for (const file of files) {
        insertFile.run(file.token, file.name, file.format, file.size, file.sha256, file.encryptedPath, file.privacyStatus, file.createdAt)
      }
      this.database.prepare(
        `INSERT INTO work_tasks(id, type, status, title, payload_json, revision, tombstone, created_at, updated_at)
         VALUES (@id, @type, @status, @title, @payload, 1, 0, @createdAt, @updatedAt)`
      ).run({
        id: validatedTask.id, type: validatedTask.type, status: validatedTask.status, title: validatedTask.title,
        payload: JSON.stringify(validatedTask), createdAt: validatedTask.createdAt, updatedAt: validatedTask.updatedAt
      })
      this.database.prepare(
        'INSERT INTO change_outbox(id, entity_type, entity_id, revision, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(randomUUID(), 'work_task', validatedTask.id, 1, 'upsert', new Date().toISOString())
    })
    save()
  }

  removeStagedFiles(tokens: string[]): void {
    if (tokens.length === 0) return
    const remove = this.database.prepare(`DELETE FROM staged_files WHERE token IN (${tokens.map(() => '?').join(', ')})`)
    remove.run(...tokens)
  }

  getStagedFiles(tokens: string[]): StagedLocalFile[] {
    return this.getStagedFileRecords(tokens).map(({ encryptedPath: _encryptedPath, ...file }) => file)
  }

  getStagedFileRecords(tokens: string[]): StagedFileRecord[] {
    if (tokens.length === 0) return []
    const placeholders = tokens.map(() => '?').join(', ')
    const rows = this.database
      .prepare<string[], StagedFileRow>(`SELECT * FROM staged_files WHERE token IN (${placeholders})`)
      .all(...tokens)
    const byToken = new Map(rows.map((row) => [row.token, row]))
    return tokens.flatMap((token) => {
      const row = byToken.get(token)
      return row
        ? [
            {
              token: row.token,
              name: row.name,
              format: row.format,
              size: row.size,
              sha256: row.sha256,
              encryptedPath: row.encrypted_path,
              privacyStatus: row.privacy_status,
              createdAt: row.created_at
            }
          ]
        : []
    })
  }

  /**
   * Exact-duplicate lookup for business-text intake: the same normalized text
   * always stages the same bytes. Only Main-created 'txt' sources participate;
   * uploaded files never collide with pasted text.
   */
  findStagedTextSourceBySha256(sha256: string): StagedFileRecord | null {
    const row = this.database
      .prepare<[string], StagedFileRow>("SELECT * FROM staged_files WHERE sha256 = ? AND format = 'txt' ORDER BY created_at LIMIT 1")
      .get(sha256)
    return row
      ? {
          token: row.token,
          name: row.name,
          format: row.format,
          size: row.size,
          sha256: row.sha256,
          encryptedPath: row.encrypted_path,
          privacyStatus: row.privacy_status,
          createdAt: row.created_at
        }
      : null
  }

  listStagedFileRecords(): StagedFileRecord[] {
    const rows = this.database
      .prepare<[], StagedFileRow>('SELECT * FROM staged_files ORDER BY token')
      .all()
    return rows.map((row) => ({
      token: row.token,
      name: row.name,
      format: row.format,
      size: row.size,
      sha256: row.sha256,
      encryptedPath: row.encrypted_path,
      privacyStatus: row.privacy_status,
      createdAt: row.created_at
    }))
  }

  rebindStagedFilePaths(vaultDirectory: string): number {
    const rows = this.database.prepare<[], { token: string }>('SELECT token FROM staged_files ORDER BY token').all()
    const update = this.database.prepare('UPDATE staged_files SET encrypted_path = ? WHERE token = ?')
    const rebind = this.database.transaction(() => {
      for (const row of rows) update.run(join(vaultDirectory, `${row.token}.sesv`), row.token)
    })
    rebind()
    return rows.length
  }

  saveParsedDocument(
    document: DocumentIR,
    summary: ResumeAnalysisSummary,
    redactionSessionId: string,
    extraction?: CandidateExtractionDraft
  ): void {
    const validatedDocument = documentIrSchema.parse(document)
    const validatedSummary = resumeAnalysisSummarySchema.parse(summary)
    const validatedExtraction = extraction ? candidateExtractionDraftSchema.parse(extraction) : null
    if (validatedDocument.documentId !== validatedSummary.fileToken) {
      throw new Error('Parsed document and analysis summary refer to different staged files.')
    }
    if (validatedExtraction && validatedExtraction.documentId !== validatedDocument.documentId) {
      throw new Error('Candidate extraction and parsed document refer to different staged files.')
    }
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO parsed_documents(
             document_id, document_ir_json, analysis_summary_json, redaction_session_id, parser_version, analyzed_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(document_id) DO UPDATE SET
             document_ir_json = excluded.document_ir_json,
             analysis_summary_json = excluded.analysis_summary_json,
             redaction_session_id = excluded.redaction_session_id,
             parser_version = excluded.parser_version,
             analyzed_at = excluded.analyzed_at`
        )
        .run(
          validatedDocument.documentId,
          JSON.stringify(validatedDocument),
          JSON.stringify(validatedSummary),
          redactionSessionId,
          validatedDocument.version,
          validatedSummary.analyzedAt
        )
      if (validatedExtraction) {
        const recordTimestamp = validatedExtraction.createdAt
        this.database
          .prepare(
            `INSERT INTO candidate_records(source_document_id, record_status, recruiting_status, created_at, updated_at)
             VALUES (?, 'active', 'pending-review', ?, ?)
             ON CONFLICT(source_document_id) DO NOTHING`
          )
          .run(validatedExtraction.documentId, recordTimestamp, recordTimestamp)
        this.database
          .prepare(
            `INSERT INTO candidate_extractions(document_id, draft_json, review_status, updated_at)
             VALUES (?, ?, 'awaiting-review', ?)
             ON CONFLICT(document_id) DO UPDATE SET
               draft_json = excluded.draft_json,
               review_status = excluded.review_status,
               updated_at = excluded.updated_at`
          )
          .run(
            validatedExtraction.documentId,
            JSON.stringify(validatedExtraction),
            validatedExtraction.createdAt
          )
        const reviewState = this.database
          .prepare<[string], CandidateReviewStateRow>('SELECT * FROM candidate_review_states WHERE document_id = ?')
          .get(validatedExtraction.documentId)
        if (!reviewState) {
          this.database
            .prepare(
              `INSERT INTO candidate_review_states(
                 document_id, extraction_version, extraction_created_at, status, pii_reviewed, revision, updated_at
               ) VALUES (?, ?, ?, 'awaiting-review', 0, 1, ?)`
            )
            .run(
              validatedExtraction.documentId,
              validatedExtraction.version,
              validatedExtraction.createdAt,
              validatedExtraction.createdAt
            )
        } else if (reviewState.extraction_created_at !== validatedExtraction.createdAt) {
          // A new resume starts another profile review, but candidate identity,
          // recruiting history, and earned talent-pool membership are durable.
          this.database
            .prepare(
              `UPDATE candidate_review_states SET
                 extraction_version = ?, extraction_created_at = ?, status = 'awaiting-review',
                 pii_reviewed = 0, revision = revision + 1, reviewer_id = NULL,
                 reviewer_display_name = NULL, completed_at = NULL, updated_at = ?
               WHERE document_id = ?`
            )
            .run(
              validatedExtraction.version,
              validatedExtraction.createdAt,
              validatedExtraction.createdAt,
              validatedExtraction.documentId
            )
          this.database
            .prepare("UPDATE candidate_profiles SET status = 'stale' WHERE source_document_id = ? AND status = 'current'")
            .run(validatedExtraction.documentId)
        }
        this.materializeImportedProfile(validatedExtraction.documentId)
      }
    })
    save()
  }

  /** Make extracted personnel usable immediately without claiming an HR review. */
  private materializeImportedProfile(documentId: string): void {
    if (this.database.prepare<[string], { id: string }>("SELECT id FROM candidate_profiles WHERE source_document_id = ? AND status = 'current'").get(documentId)) return
    const draft = this.getCandidateExtraction(documentId)
    const review = this.database.prepare<[string], CandidateReviewStateRow>('SELECT * FROM candidate_review_states WHERE document_id = ?').get(documentId)
    if (!draft || !review || review.status === 'completed') return
    const fields = draft.fields.map((field) => ({ key: field.key, label: field.label, value: field.value, sourceLabels: [...new Set(field.sources.map((source) => source.sourceLabel))] }))
    const projectExperiences = draft.projectExperiences.map((project) => ({ id: randomUUID(), title: project.title, period: project.period, role: project.role,
      technologies: project.technologies, summary: project.summary, sourceLabels: [...new Set(project.sources.map((source) => source.sourceLabel))] }))
    const version = (this.database.prepare<[string], { version: number | null }>('SELECT MAX(version) AS version FROM candidate_profiles WHERE source_document_id = ?').get(documentId)?.version ?? 0) + 1
    const { storage: _storage, cloudEligible: _cloudEligible, ...localPersonalDetails } = this.getCandidateLocalIdentity(documentId)
    const profile = candidateProfileSchema.parse({ schemaVersion: 'candidate-profile-v1', id: randomUUID(), sourceDocumentId: documentId,
      profileVersion: version, reviewRevision: review.revision, localPersonalDetails, fields, projectExperiences,
      confirmedAt: draft.createdAt, confirmedBy: '本机导入',
      containsDirectIdentifiers: detectDirectIdentifiers([...fields.map((field) => field.value ?? ''), ...projectExperiences.flatMap((project) => [project.title, project.period ?? '', project.role ?? '', ...project.technologies, project.summary])].join('\n')).length > 0 })
    this.database.prepare("INSERT INTO candidate_profiles(id,source_document_id,version,profile_json,status,confirmed_at,confirmed_by) VALUES (?,?,?,?,'current',?,?)")
      .run(profile.id, documentId, version, JSON.stringify(profile), profile.confirmedAt, profile.confirmedBy)
  }

  /** Upgrade existing imported personnel as well as newly imported records. */
  prepareImportedPersonnel(): void {
    const pending = this.database.prepare<[], { document_id: string }>(`SELECT review.document_id FROM candidate_review_states review
      JOIN candidate_records record ON record.source_document_id = review.document_id
      WHERE review.status = 'awaiting-review' AND record.record_status = 'active'
      AND NOT EXISTS (SELECT 1 FROM candidate_profiles profile WHERE profile.source_document_id = review.document_id AND profile.status = 'current')`).all()
    this.database.transaction(() => { for (const row of pending) this.materializeImportedProfile(row.document_id) })()
  }

  getCandidateExtraction(documentId: string): CandidateExtractionDraft | null {
    const row = this.database
      .prepare<[string], CandidateExtractionRow>('SELECT draft_json FROM candidate_extractions WHERE document_id = ?')
      .get(documentId)
    return row ? candidateExtractionDraftSchema.parse(JSON.parse(row.draft_json)) : null
  }

  getCandidateLocalIdentity(documentId: string): LocalCandidateIdentitySummary {
    const sessionId = this.stores.privacy.getRedactionSessionIdForDocument(documentId)
    const mappings = sessionId ? this.stores.privacy.getLocalPiiMappings(sessionId) : []
    const originalValue = (identifierType: LocalPiiMapping['identifierType']) =>
      mappings.find((mapping) => mapping.identifierType === identifierType)?.originalValue ?? null
    const profileRow = this.database
      .prepare<[string], CandidateProfileRow>(
        'SELECT profile_json, status FROM candidate_profiles WHERE source_document_id = ? ORDER BY version DESC LIMIT 1'
      )
      .get(documentId)
    const rawProfile = profileRow ? JSON.parse(profileRow.profile_json) as Record<string, unknown> : null
    const profile = rawProfile ? candidateProfileSchema.parse(rawProfile) : null
    const hasManuallySavedDetails = Boolean(rawProfile && Object.prototype.hasOwnProperty.call(rawProfile, 'localPersonalDetails'))
    const draft = this.getCandidateExtraction(documentId)
    const document = this.getParsedDocument(documentId)
    const live = document ? extractLocalCandidatePersonalDetails(document) : null
    const resolved = (key: keyof LocalCandidatePersonalDetails, mappingType?: LocalPiiMapping['identifierType']) => {
      if (hasManuallySavedDetails) return profile?.localPersonalDetails[key] ?? null
      return draft?.localPersonalDetails[key] ?? live?.[key] ?? (mappingType ? originalValue(mappingType) : null)
    }
    return {
      displayName: resolved('displayName', 'person_name'),
      gender: resolved('gender'),
      birthDate: resolved('birthDate', 'birth_date'),
      nationality: resolved('nationality', 'nationality'),
      phone: resolved('phone', 'phone'),
      email: resolved('email', 'private_email'),
      address: resolved('address', 'postal_address'),
      education: resolved('education'),
      major: resolved('major'),
      graduationDate: resolved('graduationDate'),
      degree: resolved('degree'),
      storage: 'encrypted-local-only',
      cloudEligible: false
    }
  }

  /**
   * Projects one extraction draft for the agent. Deliberately narrow: the file
   * name and the local identity block (name, phone, address, birth date) never
   * leave this method, because the draft has not been through the operator's
   * field review yet and the file name usually carries the candidate's name.
   */
  getCandidateSourceDocumentId(candidateProfileId: string): string | null {
    const row = this.database
      .prepare<[string], { source_document_id: string }>(
        'SELECT source_document_id FROM candidate_profiles WHERE id = ?'
      )
      .get(candidateProfileId)
    return row?.source_document_id ?? null
  }

  getAgentCandidateDraftFacts(sourceDocumentId: string, label: string): AgentCandidateDraftFacts | null {
    const review = this.getCandidateReview(sourceDocumentId)
    if (!review) return null
    return {
      documentId: sourceDocumentId,
      label,
      confirmed: false,
      reviewStatus: review.status,
      fields: review.fields.map((field) => ({
        label: field.label,
        value: field.value,
        confidence: field.confidence,
        status: field.status,
        sources: field.sourceLabels
      })),
      projects: review.projectExperiences.map((project) => ({
        title: project.title,
        period: project.period,
        role: project.role,
        technologies: project.technologies,
        summary: project.summary,
        confidence: project.confidence,
        sources: project.sourceLabels
      }))
    }
  }

  getCandidateReview(documentId: string): CandidateReviewSnapshot | null {
    const row = this.database
      .prepare<[string], CandidateReviewJoinRow>(
        `SELECT state.*, extraction.draft_json, staged.name AS file_name
         FROM candidate_review_states state
         JOIN candidate_extractions extraction ON extraction.document_id = state.document_id
         JOIN staged_files staged ON staged.token = state.document_id
         WHERE state.document_id = ?`
      )
      .get(documentId)
    if (!row) return null
    const draft = candidateExtractionDraftSchema.parse(JSON.parse(row.draft_json))
    const auditRows = row.status === 'completed'
      ? this.database
          .prepare<[string, number], CandidateFieldAuditRow>(
            `SELECT field_key, original_value, confirmed_value, change_reason, source_labels_json
             FROM candidate_field_review_audits
             WHERE document_id = ? AND review_revision = ?`
          )
          .all(documentId, row.revision)
      : []
    const auditByKey = new Map(auditRows.map((audit) => [audit.field_key, audit]))
    const projectAuditRows = row.status === 'completed'
      ? this.database
          .prepare<[string, number], CandidateProjectAuditRow>(
            `SELECT draft_id, project_id, original_json, confirmed_json, change_reason, source_labels_json
             FROM candidate_project_review_audits
             WHERE document_id = ? AND review_revision = ?`
          )
          .all(documentId, row.revision)
      : []
    const profileRow = this.database
      .prepare<[string], CandidateProfileRow>(
        'SELECT profile_json, status FROM candidate_profiles WHERE source_document_id = ? ORDER BY version DESC LIMIT 1'
      )
      .get(documentId)
    const profile = profileRow ? candidateProfileSchema.parse(JSON.parse(profileRow.profile_json)) : null
    const profileFieldByKey = new Map(profile?.fields.map((field) => [field.key, field]) ?? [])
    const record = this.database
      .prepare<[string], CandidateRecordRow>('SELECT record_status, recruiting_status FROM candidate_records WHERE source_document_id = ?')
      .get(documentId)
    const membership = this.database
      .prepare<[string], TalentPoolMembershipRow>('SELECT status FROM talent_pool_memberships WHERE source_document_id = ?')
      .get(documentId)
    const business = this.database.prepare<[string], { status: string; profile_version: number }>('SELECT status, profile_version FROM candidate_business_states WHERE document_id = ?').get(documentId)
    return candidateReviewSnapshotSchema.parse({
      documentId,
      fileName: row.file_name,
      reviewRevision: row.revision,
      status: row.status,
      piiReviewed: row.pii_reviewed === 1,
      localIdentity: this.getCandidateLocalIdentity(documentId),
      isOwnCompany: profile?.isOwnCompany ?? null,
      fields: draft.fields.map((field) => {
        const audit = auditByKey.get(field.key)
        const profileField = profileFieldByKey.get(field.key)
        const value = profileField ? profileField.value : (audit ? audit.confirmed_value : field.value)
        return {
          key: field.key,
          label: field.label,
          originalValue: field.value,
          value,
          confidence: field.confidence,
          status: audit ? 'confirmed' : field.status,
          sourceLabels: profileField?.sourceLabels ?? (audit ? JSON.parse(audit.source_labels_json) as string[] : field.sources.map((source) => source.sourceLabel)),
          changed: profileField ? field.value !== profileField.value : audit ? audit.original_value !== audit.confirmed_value : false,
          changeReason: audit?.change_reason ?? null
        }
      }),
      projectExperiences: profileRow?.status === 'current' && profile
        ? profile.projectExperiences.map((project) => {
            const audit = projectAuditRows.find((entry) => entry.project_id === project.id)
            const original = audit?.original_json ? JSON.parse(audit.original_json) as { confidence?: number } : null
            const extracted = draft.projectExperiences.find((entry) => entry.title === project.title &&
              entry.period === project.period && entry.role === project.role && entry.summary === project.summary &&
              JSON.stringify(entry.technologies) === JSON.stringify(project.technologies))
            return {
              draftId: audit?.draft_id ?? extracted?.draftId ?? `profile-${project.id}`,
              title: project.title,
              period: project.period,
              role: project.role,
              technologies: project.technologies,
              summary: project.summary,
              confidence: original?.confidence ?? extracted?.confidence ?? 1,
              sourceLabels: project.sourceLabels,
              changed: Boolean(audit?.change_reason),
              changeReason: audit?.change_reason ?? null
            }
          })
        : draft.projectExperiences.map((project) => ({
            draftId: project.draftId,
            title: project.title,
            period: project.period,
            role: project.role,
            technologies: project.technologies,
            summary: project.summary,
            confidence: project.confidence,
            sourceLabels: project.sources.map((source) => source.sourceLabel),
            changed: false,
            changeReason: null
          })),
      completedAt: row.completed_at,
      reviewerDisplayName: row.reviewer_display_name,
      profile: profile
        ? {
            id: profile.id,
            sourceDocumentId: profile.sourceDocumentId,
            version: profile.profileVersion,
            isOwnCompany: profile.isOwnCompany ?? null,
            status: profileRow?.status,
            confirmedAt: profile.confirmedAt,
            confirmedBy: profile.confirmedBy,
            containsDirectIdentifiers: profile.containsDirectIdentifiers
          }
        : null,
      recruitingStatus: record?.recruiting_status ?? 'pending-review',
      talentPoolStatus: (record?.record_status ?? 'active') === 'active' && profileRow?.status === 'current' && (!business || ['available', 'soon'].includes(business.status)) ? 'eligible' : business ? 'none' : membership?.status ?? 'none',
      recordStatus: record?.record_status ?? 'active'
    })
  }

  listCandidateReviews(): CandidateReviewSnapshot[] {
    const rows = this.database
      .prepare<[], { document_id: string }>('SELECT document_id FROM candidate_review_states ORDER BY updated_at DESC')
      .all()
    return rows.flatMap((row) => {
      const review = this.getCandidateReview(row.document_id)
      return review ? [review] : []
    })
  }

  getCurrentCandidateProfile(documentId: string): CandidateProfile | null {
    const row = this.database.prepare<[string], CandidateProfileRow>(`SELECT profile.profile_json, profile.status
      FROM candidate_profiles profile JOIN candidate_records record ON record.source_document_id = profile.source_document_id
      WHERE profile.source_document_id = ? AND profile.status = 'current' AND record.record_status = 'active'`).get(documentId)
    return row ? candidateProfileSchema.parse(JSON.parse(row.profile_json)) : null
  }

  /** Active, available personnel participate in business matching immediately after import. */
  listEligibleTalentProfiles(): CandidateProfile[] {
    return this.database
      .prepare<[], CandidateProfileRow>(
        `SELECT profile.profile_json, profile.status
         FROM candidate_profiles profile
         JOIN candidate_records record ON record.source_document_id = profile.source_document_id
         LEFT JOIN candidate_business_states business ON business.document_id = profile.source_document_id
         WHERE profile.status = 'current'
           AND record.record_status = 'active'
           AND (business.document_id IS NULL OR business.status IN ('available','soon'))
         ORDER BY profile.confirmed_at DESC`
      )
      .all()
      .map((row) => candidateProfileSchema.parse(JSON.parse(row.profile_json)))
  }

  listCandidateProfileEmbeddings(modelId: string, modelRevision: string): CandidateProfileEmbeddingRecord[] {
    assertEmbeddingIdentity(modelId, modelRevision)
    return this.database
      .prepare<[string, string], CandidateProfileEmbeddingRow>(
        `SELECT profile_id, content_hash, vector_dimension, vector_blob, updated_at
         FROM candidate_profile_embeddings
         WHERE model_id = ? AND model_revision = ?`
      )
      .all(modelId, modelRevision)
      .map((row) => ({
        profileId: row.profile_id,
        modelId,
        modelRevision,
        contentHash: row.content_hash,
        vector: embeddingVectorFromRow(row),
        updatedAt: row.updated_at
      }))
  }

  saveCandidateProfileEmbeddings(records: CandidateProfileEmbeddingInput[], now = new Date()): void {
    if (records.length === 0) return
    const upsert = this.database.prepare(
      `INSERT INTO candidate_profile_embeddings(
         profile_id, model_id, model_revision, content_hash, vector_dimension, vector_blob, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, model_id, model_revision) DO UPDATE SET
         content_hash = excluded.content_hash,
         vector_dimension = excluded.vector_dimension,
         vector_blob = excluded.vector_blob,
         updated_at = excluded.updated_at`
    )
    const updatedAt = now.toISOString()
    this.database.transaction(() => {
      for (const record of records) {
        assertEmbeddingIdentity(record.modelId, record.modelRevision)
        if (!/^[a-f0-9]{64}$/u.test(record.contentHash)) throw new Error('Embedding content hash is invalid.')
        const vectorBlob = embeddingVectorToBlob(record.vector)
        upsert.run(
          record.profileId,
          record.modelId,
          record.modelRevision,
          record.contentHash,
          record.vector.length,
          vectorBlob,
          updatedAt,
          updatedAt
        )
      }
    })()
  }

  listCandidateProjectEmbeddings(modelId: string, modelRevision: string): CandidateProjectEmbeddingRecord[] {
    assertEmbeddingIdentity(modelId, modelRevision)
    return this.database
      .prepare<[string, string], CandidateProjectEmbeddingRow>(
        `SELECT profile_id, project_id, content_hash, vector_dimension, vector_blob, updated_at
         FROM candidate_project_embeddings
         WHERE model_id = ? AND model_revision = ?`
      )
      .all(modelId, modelRevision)
      .map((row) => ({
        profileId: row.profile_id,
        projectId: row.project_id,
        modelId,
        modelRevision,
        contentHash: row.content_hash,
        vector: embeddingVectorFromRow(row),
        updatedAt: row.updated_at
      }))
  }

  saveCandidateProjectEmbeddings(records: CandidateProjectEmbeddingInput[], now = new Date()): void {
    if (records.length === 0) return
    const upsert = this.database.prepare(
      `INSERT INTO candidate_project_embeddings(
         profile_id, project_id, model_id, model_revision, content_hash,
         vector_dimension, vector_blob, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, project_id, model_id, model_revision) DO UPDATE SET
         content_hash = excluded.content_hash,
         vector_dimension = excluded.vector_dimension,
         vector_blob = excluded.vector_blob,
         updated_at = excluded.updated_at`
    )
    const profileLookup = this.database.prepare<[string], { profile_json: string }>(
      'SELECT profile_json FROM candidate_profiles WHERE id = ?'
    )
    const updatedAt = now.toISOString()
    this.database.transaction(() => {
      for (const record of records) {
        assertEmbeddingIdentity(record.modelId, record.modelRevision)
        if (!/^[a-f0-9]{64}$/u.test(record.contentHash)) throw new Error('Project embedding content hash is invalid.')
        if (!/^[0-9a-f-]{36}$/iu.test(record.profileId) || !/^[0-9a-f-]{36}$/iu.test(record.projectId)) {
          throw new Error('Project embedding identity is invalid.')
        }
        const profileRow = profileLookup.get(record.profileId)
        const profile = profileRow ? candidateProfileSchema.parse(JSON.parse(profileRow.profile_json)) : null
        if (!profile?.projectExperiences.some((project) => project.id === record.projectId)) {
          throw new Error('Project embedding does not belong to the candidate profile.')
        }
        const vectorBlob = embeddingVectorToBlob(record.vector)
        upsert.run(
          record.profileId,
          record.projectId,
          record.modelId,
          record.modelRevision,
          record.contentHash,
          record.vector.length,
          vectorBlob,
          updatedAt,
          updatedAt
        )
      }
    })()
  }

  countEligibleTalentProfiles(): number {
    return this.database
      .prepare<[], { count: number }>(
        `SELECT count(*) AS count
         FROM candidate_profiles profile
         JOIN candidate_records record ON record.source_document_id = profile.source_document_id
         LEFT JOIN candidate_business_states business ON business.document_id = profile.source_document_id
         WHERE profile.status = 'current'
           AND record.record_status = 'active'
           AND (business.document_id IS NULL OR business.status IN ('available','soon'))`
      )
      .get()?.count ?? 0
  }

  getCandidateProfileHistory(sourceDocumentId: string): CandidateProfileVersionDetail[] {
    return this.database
      .prepare<[string], CandidateProfileRow>(
        'SELECT profile_json, status FROM candidate_profiles WHERE source_document_id = ? ORDER BY version DESC'
      )
      .all(sourceDocumentId)
      .map((row) => {
        const profile = candidateProfileSchema.parse(JSON.parse(row.profile_json))
        return {
          id: profile.id,
          sourceDocumentId: profile.sourceDocumentId,
          version: profile.profileVersion,
          isOwnCompany: profile.isOwnCompany ?? null,
          status: row.status,
          confirmedAt: profile.confirmedAt,
          confirmedBy: profile.confirmedBy,
          containsDirectIdentifiers: profile.containsDirectIdentifiers,
          reviewRevision: profile.reviewRevision,
          fields: profile.fields,
          projectExperiences: profile.projectExperiences
        }
      })
  }

  previewCandidateDeletion(sourceDocumentId: string): CandidateDeletionPreview {
    const file = this.getStagedFileRecords([sourceDocumentId])[0]
    if (!file) throw new Error('Candidate source file was not found.')
    const history = this.getCandidateProfileHistory(sourceDocumentId)
    if (history.length === 0) throw new Error('Candidate profile was not found.')
    const taskRecords = this.stores.workTasks.listWorkTasks().filter((task) =>
      task.contextBindings.some((binding) => binding.objectType === 'staged-file' && binding.objectId === sourceDocumentId)
    ).length
    const reviewAudits = this.database
      .prepare<[string, string], { count: number }>(
        `SELECT
           (SELECT count(*) FROM candidate_field_review_audits WHERE document_id = ?) +
           (SELECT count(*) FROM candidate_project_review_audits WHERE document_id = ?) AS count`
      )
      .get(sourceDocumentId, sourceDocumentId)?.count ?? 0
    const matchRecords = this.database
      .prepare<[string], { count: number }>(
        `SELECT count(*) AS count FROM candidate_match_results result
         JOIN candidate_profiles profile ON profile.id = result.candidate_profile_id
         WHERE profile.source_document_id = ?`
      )
      .get(sourceDocumentId)?.count ?? 0
    const evaluationDatasetIds = this.stores.candidateEvaluation.candidateEvaluationDatasetIdsForLabels(new Set(
      history.map((profile) => `候補者 ${profile.id.slice(0, 8).toLocaleUpperCase('en-US')}`)
    ))
    const persistedEvaluationRecords = evaluationDatasetIds.reduce((total, datasetId) =>
      total + 1 + (this.database
        .prepare<[string], { count: number }>('SELECT count(*) AS count FROM candidate_evaluation_reports WHERE dataset_id = ?')
        .get(datasetId)?.count ?? 0), 0)
    const draftEvaluationLabels = this.database
      .prepare<[string], { count: number }>(
        `SELECT count(*) AS count FROM candidate_evaluation_draft_labels label
         JOIN candidate_profiles profile ON profile.id = label.candidate_profile_id
         WHERE profile.source_document_id = ?`
      )
      .get(sourceDocumentId)?.count ?? 0
    const evaluationRecords = persistedEvaluationRecords + draftEvaluationLabels
    const proposalDrafts = this.database
      .prepare<[string], { count: number }>(
        `SELECT count(*) AS count FROM proposal_drafts proposal
         JOIN candidate_profiles profile ON profile.id = proposal.candidate_profile_id
         WHERE profile.source_document_id = ?`
      )
      .get(sourceDocumentId)?.count ?? 0
    const redactionSessionId = this.stores.privacy.getRedactionSessionIdForDocument(sourceDocumentId)
    const piiMappings = redactionSessionId
      ? this.database
          .prepare<[string], { count: number }>(
            'SELECT count(*) AS count FROM local_pii_mappings WHERE redaction_session_id = ?'
          )
          .get(redactionSessionId)?.count ?? 0
      : 0
    const searchIndexEntries = this.database
      .prepare<[string, string], { count: number }>(
        `SELECT
           (SELECT count(*) FROM candidate_profile_embeddings embedding
            JOIN candidate_profiles profile ON profile.id = embedding.profile_id
            WHERE profile.source_document_id = ?) +
           (SELECT count(*) FROM candidate_project_embeddings embedding
            JOIN candidate_profiles profile ON profile.id = embedding.profile_id
            WHERE profile.source_document_id = ?) AS count`
      )
      .get(sourceDocumentId, sourceDocumentId)?.count ?? 0
    const agentMatchRows = this.database
      .prepare<[string], { run_id: string; result_id: string }>(
        `SELECT result.run_id, result.id AS result_id
         FROM candidate_match_results result
         JOIN candidate_profiles profile ON profile.id = result.candidate_profile_id
         WHERE profile.source_document_id = ?`
      )
      .all(sourceDocumentId)
    const agentReferences = this.stores.agentConversations.countSalesAgentReferences({
      candidateDocumentIds: new Set([sourceDocumentId]),
      jobCaseIds: new Set(),
      matchRunIds: new Set(agentMatchRows.map((row) => row.run_id)),
      matchResultIds: new Set(agentMatchRows.map((row) => row.result_id))
    })
    const counts = {
      profileVersions: history.length,
      reviewAudits,
      taskRecords,
      matchRecords,
      evaluationRecords,
      proposalDrafts,
      piiMappings,
      searchIndexEntries,
      encryptedFiles: 1,
      agentReferences
    }
    const confirmationHash = createHash('sha256').update(JSON.stringify({
      sourceDocumentId,
      fileSha256: file.sha256,
      latestProfileId: history[0]?.id,
      latestVersion: history[0]?.version,
      counts
    })).digest('hex')
    return candidateDeletionPreviewSchema.parse({
      sourceDocumentId,
      anonymousLabel: `候補者 ${history[0]?.id.slice(0, 8).toLocaleUpperCase('en-US')}`,
      localFileName: file.name,
      counts,
      confirmationHash,
      warningCodes: ['EXTERNAL_EXPORTS_OUTSIDE_SCOPE', 'BACKUP_SYSTEM_NOT_CONFIGURED']
    })
  }

  deleteCandidateDatabaseData(sourceDocumentId: string, expectedConfirmationHash: string, now = new Date()): CandidateDeletionPreview {
    const preview = this.previewCandidateDeletion(sourceDocumentId)
    if (preview.confirmationHash !== expectedConfirmationHash) {
      throw new Error('Candidate deletion preview changed. Review the impact again before deleting.')
    }
    const taskIds = this.stores.workTasks.listWorkTasks()
      .filter((task) => task.contextBindings.some((binding) =>
        binding.objectType === 'staged-file' && binding.objectId === sourceDocumentId
      ))
      .map((task) => task.id)
    const profileIds = this.database
      .prepare<[string], { id: string }>('SELECT id FROM candidate_profiles WHERE source_document_id = ?')
      .all(sourceDocumentId)
      .map((row) => row.id)
    const agentMatchRows = this.database
      .prepare<[string], { run_id: string; result_id: string }>(
        `SELECT result.run_id, result.id AS result_id
         FROM candidate_match_results result
         JOIN candidate_profiles profile ON profile.id = result.candidate_profile_id
         WHERE profile.source_document_id = ?`
      )
      .all(sourceDocumentId)
    const agentTargets: AgentReferenceTargets = {
      candidateDocumentIds: new Set([sourceDocumentId]),
      jobCaseIds: new Set(),
      matchRunIds: new Set(agentMatchRows.map((row) => row.run_id)),
      matchResultIds: new Set(agentMatchRows.map((row) => row.result_id))
    }
    const evaluationDatasetIds = this.stores.candidateEvaluation.candidateEvaluationDatasetIdsForLabels(new Set(
      profileIds.map((profileId) => `候補者 ${profileId.slice(0, 8).toLocaleUpperCase('en-US')}`)
    ))
    const redactionSessionId = this.stores.privacy.getRedactionSessionIdForDocument(sourceDocumentId)
    const remove = this.database.transaction(() => {
      this.stores.agentConversations.sanitizeSalesAgentConversations(agentTargets, now)
      if (redactionSessionId) {
        this.database.prepare('DELETE FROM local_pii_mappings WHERE redaction_session_id = ?').run(redactionSessionId)
      }
      for (const taskId of taskIds) {
        this.database.prepare('DELETE FROM work_tasks WHERE id = ?').run(taskId)
        this.database.prepare("DELETE FROM change_outbox WHERE entity_type = 'work_task' AND entity_id = ?").run(taskId)
      }
      for (const profileId of profileIds) {
        this.database.prepare("DELETE FROM change_outbox WHERE entity_type = 'candidate_profile' AND entity_id = ?").run(profileId)
      }
      for (const datasetId of evaluationDatasetIds) {
        this.database.prepare('DELETE FROM candidate_evaluation_datasets WHERE id = ?').run(datasetId)
      }
      this.database.prepare('DELETE FROM candidate_profiles WHERE source_document_id = ?').run(sourceDocumentId)
      const deleted = this.database.prepare('DELETE FROM staged_files WHERE token = ?').run(sourceDocumentId)
      if (deleted.changes !== 1) throw new Error('Candidate source record could not be deleted.')
      this.database
        .prepare(
          'INSERT INTO change_outbox(id, entity_type, entity_id, revision, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), 'candidate', sourceDocumentId, 1, 'delete', now.toISOString())
    })
    remove()
    return preview
  }

  confirmCandidateReview(
    input: SubmitCandidateReviewInput,
    reviewerId: string,
    reviewerDisplayName: string,
    now = new Date()
  ): CandidateReviewSnapshot {
    const validated = submitCandidateReviewInputSchema.parse(input)
    const draft = this.getCandidateExtraction(validated.documentId)
    if (!draft) throw new Error('Candidate extraction draft was not found.')
    const state = this.database
      .prepare<[string], CandidateReviewStateRow>('SELECT * FROM candidate_review_states WHERE document_id = ?')
      .get(validated.documentId)
    if (!state) throw new Error('Candidate review state was not found.')
    if (state.status !== 'awaiting-review') throw new Error('Candidate review is already completed.')
    if (state.revision !== validated.reviewRevision) throw new Error('Candidate review changed. Reload before confirming.')

    const submissionByKey = new Map(validated.fields.map((field) => [field.key, field]))
    if (submissionByKey.size !== draft.fields.length || draft.fields.some((field) => !submissionByKey.has(field.key))) {
      throw new Error('Every candidate field must be explicitly confirmed exactly once.')
    }
    for (const field of draft.fields) {
      const submitted = submissionByKey.get(field.key)
      if (!submitted) throw new Error(`Candidate field ${field.key} was not confirmed.`)
    }
    const workAuthorization = submissionByKey.get('work_authorization')?.value
    if (workAuthorization && !(candidateWorkAuthorizationValues as readonly string[]).includes(workAuthorization)) {
      throw new Error('Work authorization must use a compliance category; nationality or raw residence-status text cannot be stored.')
    }
    const submittedProjects = validated.projectExperiences
    const submittedProjectIds = new Set(submittedProjects.map((project) => project.draftId))
    if (submittedProjectIds.size !== submittedProjects.length) throw new Error('Project experience IDs must be unique.')
    const draftProjectsById = new Map(draft.projectExperiences.map((project) => [project.draftId, project]))
    const projectPayload = (project: {
      title: string
      period: string | null
      role: string | null
      technologies: string[]
      summary: string
    }) => ({
      title: project.title,
      period: project.period,
      role: project.role,
      technologies: [...new Set(project.technologies)],
      summary: project.summary
    })
    const candidateContent = [
      ...validated.fields.map((field) => field.value ?? ''),
      ...submittedProjects.flatMap((project) => [
        project.title,
        project.period ?? '',
        project.role ?? '',
        ...project.technologies,
        project.summary
      ])
    ].join('\n')
    const containsDirectIdentifiers = detectDirectIdentifiers(candidateContent).length > 0
    const localIdentity = this.getCandidateLocalIdentity(validated.documentId)
    const { storage: _storage, cloudEligible: _cloudEligible, ...localPersonalDetails } = localIdentity

    const reviewedAt = now.toISOString()
    const save = this.database.transaction(() => {
      const current = this.database
        .prepare<[string], CandidateReviewStateRow>('SELECT * FROM candidate_review_states WHERE document_id = ?')
        .get(validated.documentId)
      if (!current || current.status !== 'awaiting-review' || current.revision !== validated.reviewRevision) {
        throw new Error('Candidate review changed while it was being confirmed.')
      }
      const latestVersion = this.database
        .prepare<[string], { version: number | null }>(
          'SELECT max(version) AS version FROM candidate_profiles WHERE source_document_id = ?'
        )
        .get(validated.documentId)?.version ?? 0
      const profileVersion = latestVersion + 1
      const profileId = randomUUID()
      const projectRecords: Array<{ draftId: string; project: CandidateProjectExperience; changed: boolean }> =
        submittedProjects.map((submitted) => {
          const original = draftProjectsById.get(submitted.draftId)
          const changed = !original || JSON.stringify(projectPayload(original)) !== JSON.stringify(projectPayload(submitted))
          return {
            draftId: submitted.draftId,
            changed,
            project: {
              id: randomUUID(),
              ...projectPayload(submitted),
              sourceLabels: original
                ? [...new Set(original.sources.map((source) => source.sourceLabel))]
                : []
            }
          }
        })
      const profile: CandidateProfile = candidateProfileSchema.parse({
        schemaVersion: 'candidate-profile-v1',
        id: profileId,
        sourceDocumentId: validated.documentId,
        profileVersion,
        isOwnCompany: this.getCurrentCandidateProfile(validated.documentId)?.isOwnCompany ?? null,
        reviewRevision: validated.reviewRevision,
        localPersonalDetails,
        fields: draft.fields.map((field) => ({
          key: field.key,
          label: field.label,
          value: submissionByKey.get(field.key)?.value ?? null,
          sourceLabels: [...new Set(field.sources.map((source) => source.sourceLabel))]
        })),
        projectExperiences: projectRecords.map((record) => record.project),
        confirmedAt: reviewedAt,
        confirmedBy: reviewerDisplayName,
        // This flag covers the anonymous matching payload (fields/projects).
        // Local-only personal details are excluded from retrieval and cloud prompts.
        containsDirectIdentifiers
      })
      this.database
        .prepare("UPDATE candidate_profiles SET status = 'superseded' WHERE source_document_id = ? AND status = 'current'")
        .run(validated.documentId)
      this.database
        .prepare(
          `INSERT INTO candidate_profiles(
             id, source_document_id, version, profile_json, status, confirmed_at, confirmed_by
           ) VALUES (?, ?, ?, ?, 'current', ?, ?)`
        )
        .run(profileId, validated.documentId, profileVersion, JSON.stringify(profile), reviewedAt, reviewerDisplayName)

      const insertAudit = this.database.prepare(
        `INSERT INTO candidate_field_review_audits(
           id, document_id, review_revision, field_key, original_value, confirmed_value,
           change_reason, source_labels_json, reviewer_id, reviewed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const field of draft.fields) {
        const submitted = submissionByKey.get(field.key)
        if (!submitted) continue
        insertAudit.run(
          randomUUID(),
          validated.documentId,
          validated.reviewRevision,
          field.key,
          field.value,
          submitted.value,
          submitted.changeReason ?? null,
          JSON.stringify([...new Set(field.sources.map((source) => source.sourceLabel))]),
          reviewerId,
          reviewedAt
        )
      }
      const insertProjectAudit = this.database.prepare(
        `INSERT INTO candidate_project_review_audits(
           id, document_id, review_revision, draft_id, project_id, original_json,
           confirmed_json, change_reason, source_labels_json, reviewer_id, reviewed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const record of projectRecords) {
        const original = draftProjectsById.get(record.draftId)
        insertProjectAudit.run(
          randomUUID(),
          validated.documentId,
          validated.reviewRevision,
          record.draftId,
          record.project.id,
          original ? JSON.stringify(original) : null,
          JSON.stringify(record.project),
          record.changed ? validated.projectChangeReason ?? null : null,
          JSON.stringify(record.project.sourceLabels),
          reviewerId,
          reviewedAt
        )
      }
      for (const removed of draft.projectExperiences.filter((project) => !submittedProjectIds.has(project.draftId))) {
        insertProjectAudit.run(
          randomUUID(),
          validated.documentId,
          validated.reviewRevision,
          removed.draftId,
          null,
          JSON.stringify(removed),
          null,
          validated.projectChangeReason ?? null,
          JSON.stringify([...new Set(removed.sources.map((source) => source.sourceLabel))]),
          reviewerId,
          reviewedAt
        )
      }
      const update = this.database
        .prepare(
          `UPDATE candidate_review_states SET
             status = 'completed', pii_reviewed = ?, reviewer_id = ?, reviewer_display_name = ?,
             completed_at = ?, updated_at = ?
           WHERE document_id = ? AND revision = ? AND status = 'awaiting-review'`
        )
        .run(
          validated.piiReviewed ? 1 : 0,
          reviewerId,
          reviewerDisplayName,
          reviewedAt,
          reviewedAt,
          validated.documentId,
          validated.reviewRevision
        )
      if (update.changes !== 1) throw new Error('Candidate review could not be committed.')
      this.database
        .prepare(`UPDATE candidate_records
                  SET recruiting_status = 'ready-for-recruiting', updated_at = ?
                  WHERE source_document_id = ? AND recruiting_status = 'pending-review'`)
        .run(reviewedAt, validated.documentId)
      this.database
        .prepare(
          'INSERT INTO change_outbox(id, entity_type, entity_id, revision, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), 'candidate_profile', profileId, profileVersion, 'upsert', reviewedAt)
    })
    save()
    const result = this.getCandidateReview(validated.documentId)
    if (!result) throw new Error('Confirmed candidate review could not be reloaded.')
    return result
  }

  setCandidateOwnCompany(input: import('@shared').SetCandidateOwnCompanyInput, reviewerDisplayName: string, now = new Date()): CandidateProfile {
    const validated = setCandidateOwnCompanyInputSchema.parse(input)
    return this.database.transaction(() => {
      const current = this.getCurrentCandidateProfile(validated.documentId)
      if (!current) throw new Error('人员资料不存在或已归档。 / 要員情報が存在しないか、アーカイブされています。')
      if (current.profileVersion !== validated.expectedVersion) {
        throw new Error('人员资料已更新，请刷新后重试。 / 要員情報が更新されました。再読み込みしてください。')
      }
      if ((current.isOwnCompany ?? null) === validated.isOwnCompany) return current
      const timestamp = now.toISOString()
      // Preserve all profile content and local identity mappings; only affiliation changes.
      const profile = candidateProfileSchema.parse({ ...current, id: randomUUID(),
        profileVersion: current.profileVersion + 1, isOwnCompany: validated.isOwnCompany,
        confirmedAt: timestamp, confirmedBy: reviewerDisplayName })
      this.database.prepare("UPDATE candidate_profiles SET status = 'superseded' WHERE source_document_id = ? AND status = 'current'")
        .run(validated.documentId)
      this.database.prepare(`INSERT INTO candidate_profiles(
        id, source_document_id, version, profile_json, status, confirmed_at, confirmed_by
      ) VALUES (?, ?, ?, ?, 'current', ?, ?)`)
        .run(profile.id, profile.sourceDocumentId, profile.profileVersion, JSON.stringify(profile), timestamp, reviewerDisplayName)
      this.database.prepare('INSERT INTO change_outbox(id, entity_type, entity_id, revision, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), 'candidate_profile', profile.id, profile.profileVersion, 'upsert', timestamp)
      return profile
    })()
  }

  updateCandidateProfile(
    input: UpdateCandidateProfileInput,
    reviewerId: string,
    reviewerDisplayName: string,
    now = new Date()
  ): CandidateProfile {
    const validated = updateCandidateProfileInputSchema.parse(input)
    const currentRow = this.database
      .prepare<[string], CandidateProfileRow>(
        "SELECT profile_json, status FROM candidate_profiles WHERE source_document_id = ? AND status = 'current'"
      )
      .get(validated.sourceDocumentId)
      if (!currentRow) throw new Error('Current candidate profile was not found.')
    const current = candidateProfileSchema.parse(JSON.parse(currentRow.profile_json))
    if (current.profileVersion !== validated.expectedVersion) {
      throw new Error('人材プロフィールが更新されました。再読み込みしてから編集してください。')
    }

    const fieldsByKey = new Map(validated.fields.map((field) => [field.key, field]))
    if (fieldsByKey.size !== current.fields.length || current.fields.some((field) => !fieldsByKey.has(field.key))) {
      throw new Error('Every candidate field must be supplied exactly once.')
    }
    const workAuthorization = fieldsByKey.get('work_authorization')?.value
    if (workAuthorization && !(candidateWorkAuthorizationValues as readonly string[]).includes(workAuthorization)) {
      throw new Error('Work authorization must use a compliance category; nationality or raw residence-status text cannot be stored.')
    }
    const projectIds = new Set(validated.projectExperiences.map((project) => project.id))
    if (projectIds.size !== validated.projectExperiences.length) throw new Error('Project experience IDs must be unique.')

    const timestamp = now.toISOString()
    const currentProjects = new Map(current.projectExperiences.map((project) => [project.id, project]))
    const candidateContent = [
      ...validated.fields.map((field) => field.value ?? ''),
      ...validated.projectExperiences.flatMap((project) => [
        project.title,
        project.period ?? '',
        project.role ?? '',
        ...project.technologies,
        project.summary
      ])
    ].join('\n')
    const profile = candidateProfileSchema.parse({
      schemaVersion: 'candidate-profile-v1',
      id: randomUUID(),
      sourceDocumentId: current.sourceDocumentId,
      profileVersion: current.profileVersion + 1,
      isOwnCompany: validated.isOwnCompany === undefined ? current.isOwnCompany ?? null : validated.isOwnCompany,
      reviewRevision: current.reviewRevision,
      localPersonalDetails: validated.identity,
      fields: current.fields.map((field) => ({
        ...field,
        value: fieldsByKey.get(field.key)?.value ?? null
      })),
      projectExperiences: validated.projectExperiences.map((project) => ({
        id: currentProjects.get(project.id)?.id ?? randomUUID(),
        title: project.title,
        period: project.period,
        role: project.role,
        technologies: [...new Set(project.technologies)],
        summary: project.summary,
        sourceLabels: currentProjects.get(project.id)?.sourceLabels ?? []
      })),
      confirmedAt: timestamp,
      confirmedBy: reviewerDisplayName,
      containsDirectIdentifiers: detectDirectIdentifiers(candidateContent).length > 0
    })

    const save = this.database.transaction(() => {
      const latestRow = this.database
        .prepare<[string], CandidateProfileRow>(
          "SELECT profile_json, status FROM candidate_profiles WHERE source_document_id = ? AND status = 'current'"
        )
        .get(validated.sourceDocumentId)
      const latest = latestRow ? candidateProfileSchema.parse(JSON.parse(latestRow.profile_json)) : null
      if (!latest || latest.profileVersion !== validated.expectedVersion) {
        throw new Error('人材プロフィールが編集中に更新されました。再読み込みしてください。')
      }

      this.database
        .prepare("UPDATE candidate_profiles SET status = 'superseded' WHERE source_document_id = ? AND status = 'current'")
        .run(validated.sourceDocumentId)
      this.database
        .prepare(
          `INSERT INTO candidate_profiles(
             id, source_document_id, version, profile_json, status, confirmed_at, confirmed_by
           ) VALUES (?, ?, ?, ?, 'current', ?, ?)`
        )
        .run(profile.id, profile.sourceDocumentId, profile.profileVersion, JSON.stringify(profile), timestamp, reviewerDisplayName)

      const sessionId = this.stores.privacy.getRedactionSessionIdForDocument(validated.sourceDocumentId)
      const session = sessionId ? this.stores.privacy.getRedactionSession(sessionId) : null
      if (!sessionId || !session) throw new Error('Local identity encryption session was not found.')
      const currentMappings = this.stores.privacy.getLocalPiiMappings(sessionId)
      const identityValues: Array<{
        identifierType: LocalPiiMapping['identifierType']
        placeholderPrefix: string
        value: string | null
      }> = [
        { identifierType: 'person_name', placeholderPrefix: 'PERSON_NAME', value: validated.identity.displayName },
        { identifierType: 'phone', placeholderPrefix: 'PHONE', value: validated.identity.phone },
        { identifierType: 'private_email', placeholderPrefix: 'PRIVATE_EMAIL', value: validated.identity.email },
        { identifierType: 'postal_address', placeholderPrefix: 'ADDRESS', value: validated.identity.address },
        { identifierType: 'birth_date', placeholderPrefix: 'BIRTH_DATE', value: validated.identity.birthDate },
        { identifierType: 'nationality', placeholderPrefix: 'NATIONALITY', value: validated.identity.nationality }
      ]
      const identityTypes = new Set(identityValues.map((entry) => entry.identifierType))
      const nextMappings = currentMappings.filter((mapping) => !identityTypes.has(mapping.identifierType))
      const usedPlaceholders = new Set(nextMappings.map((mapping) => mapping.placeholder))
      for (const entry of identityValues) {
        if (!entry.value) continue
        const existing = currentMappings.find((mapping) => mapping.identifierType === entry.identifierType)
        let placeholder = existing?.placeholder ?? `<LOCAL_${entry.placeholderPrefix}_001>`
        let suffix = 1
        while (usedPlaceholders.has(placeholder)) {
          suffix += 1
          placeholder = `<LOCAL_${entry.placeholderPrefix}_${String(suffix).padStart(3, '0')}>`
        }
        usedPlaceholders.add(placeholder)
        nextMappings.push({ placeholder, identifierType: entry.identifierType, originalValue: entry.value })
      }
      this.stores.privacy.persistRedactionSession(session, nextMappings)
      this.database
        .prepare(
          'INSERT INTO change_outbox(id, entity_type, entity_id, revision, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), 'candidate_profile', profile.id, profile.profileVersion, 'upsert', timestamp)
    })
    save()
    return profile
  }

  getParsedDocument(fileToken: string): DocumentIR | null {
    const row = this.database
      .prepare<[string], ParsedDocumentRow>('SELECT document_ir_json, analysis_summary_json FROM parsed_documents WHERE document_id = ?')
      .get(fileToken)
    return row ? documentIrSchema.parse(JSON.parse(row.document_ir_json)) : null
  }

  getResumeAnalysis(fileToken: string): ResumeAnalysisSummary | null {
    const row = this.database
      .prepare<[string], ParsedDocumentRow>('SELECT document_ir_json, analysis_summary_json FROM parsed_documents WHERE document_id = ?')
      .get(fileToken)
    return row ? resumeAnalysisSummarySchema.parse(JSON.parse(row.analysis_summary_json)) : null
  }

  listResumeAnalyses(): ResumeAnalysisSummary[] {
    const rows = this.database
      .prepare<[], ParsedDocumentRow>(
        'SELECT document_ir_json, analysis_summary_json FROM parsed_documents ORDER BY analyzed_at DESC'
      )
      .all()
    return rows.map((row) => resumeAnalysisSummarySchema.parse(JSON.parse(row.analysis_summary_json)))
  }
}
