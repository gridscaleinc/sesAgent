import { createHash } from 'node:crypto'
import { personnelMailConditionsSchema, resolvePersonnelMailUpdateSchema, type PersonnelMailUpdate, type ResolvePersonnelMailUpdateInput, type CandidateFieldKey } from '@shared'
import {
  googleWorkspaceAdminConfigurationSchema,
  googleWorkspaceOnlineAcceptanceReportSchema,
  saveGoogleWorkspaceAdminConfigurationInputSchema
} from '@shared'
import {
  type GoogleWorkspaceAdminConfiguration,
  type GoogleWorkspaceOnlineAcceptanceReport,
  type SaveGoogleWorkspaceAdminConfigurationInput
} from '@shared/contracts'
import { storedGmailMessageInputSchema } from '../mappers'
import {
  type GmailRedactionEvidenceSummary,
  type GmailSyncCheckpointRecord,
  type GmailSyncStateRow,
  type GoogleWorkspaceAcceptanceReportRow,
  type GoogleWorkspaceAdminConfigurationRow,
  type StoredGmailMessageInput
} from '../rows'
import { DomainStore } from './base'

export interface GmailBusinessIntake { accountEmail: string; messageId: string; replyTo: string | null; status: 'pending' | 'completed' | 'error'; parts: Record<string, string>; warnings: string[] }

export class GmailStore extends DomainStore {
  saveGmailIntakeResult(accountEmail: string, counts: Omit<import('@shared').GmailBusinessIntakeResult, 'pendingCases' | 'pendingPersonnel'>): void {
    const checkpoint = this.getGmailSyncCheckpoint(accountEmail)
    if (!checkpoint?.lastRun) return
    const pendingCases = this.database.prepare<[string], { count: number }>(`
      SELECT count(*) AS count FROM gmail_messages m
      LEFT JOIN job_case_sources s ON s.source_type='gmail' AND s.provider_account=m.account_email AND s.provider_message_id=m.gmail_message_id
      LEFT JOIN job_case_extractions e ON e.source_id=s.id
      WHERE m.account_email=? AND m.classification='job-case' AND e.review_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM json_each(COALESCE(s.warning_codes_json, '[]')) WHERE value='BUSINESS_DUPLICATE_SKIPPED')`).get(accountEmail)!.count
    const pendingPersonnel = this.database.prepare<[string], { count: number }>(`
      SELECT count(*) AS count FROM gmail_messages m
      LEFT JOIN gmail_business_intake i ON i.account_email=m.account_email AND i.gmail_message_id=m.gmail_message_id
      WHERE m.account_email=? AND m.classification='candidate-proposal' AND (i.status IS NULL OR i.status!='completed')`).get(accountEmail)!.count
    this.database.prepare('UPDATE gmail_sync_states SET last_run_json=?,updated_at=? WHERE account_email=?')
      .run(JSON.stringify({ ...checkpoint.lastRun, intake: { ...counts, pendingCases, pendingPersonnel } }), new Date().toISOString(), accountEmail)
  }

  getGmailPersonnelIntakeStatus(accountEmail: string): { failed: number; warnings: number } {
    const rows = this.database.prepare<[string], { status: string; warning_codes_json: string }>('SELECT status,warning_codes_json FROM gmail_business_intake WHERE account_email=?').all(accountEmail)
    return { failed: rows.filter((row) => row.status === 'error').length, warnings: rows.filter((row) => row.warning_codes_json !== '[]').length }
  }
  listPendingGmailBusinessIntake(accountEmail: string): Array<{ messageId: string; classification: string }> {
    return this.database.prepare<[string], { messageId: string; classification: string }>(`
      SELECT m.gmail_message_id AS messageId, m.classification FROM gmail_messages m
      LEFT JOIN gmail_business_intake i ON i.account_email=m.account_email AND i.gmail_message_id=m.gmail_message_id
      WHERE m.account_email=? AND (i.status IS NULL OR i.status!='completed')
      ORDER BY COALESCE(i.updated_at, '') ASC, m.internal_date DESC LIMIT 50`).all(accountEmail)
  }

  getGmailBusinessIntake(accountEmail: string, messageId: string): GmailBusinessIntake | null {
    const row = this.database.prepare<[string,string], { reply_to: string | null; status: GmailBusinessIntake['status']; parts_json: string; warning_codes_json: string }>(
      'SELECT * FROM gmail_business_intake WHERE account_email=? AND gmail_message_id=?').get(accountEmail,messageId)
    return row ? { accountEmail, messageId, replyTo: row.reply_to, status: row.status, parts: JSON.parse(row.parts_json), warnings: JSON.parse(row.warning_codes_json) } : null
  }

  saveGmailBusinessIntake(input: GmailBusinessIntake): void {
    this.database.prepare(`INSERT INTO gmail_business_intake(account_email,gmail_message_id,reply_to,status,parts_json,warning_codes_json,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_email,gmail_message_id) DO UPDATE SET reply_to=excluded.reply_to,status=excluded.status,
      parts_json=excluded.parts_json,warning_codes_json=excluded.warning_codes_json,updated_at=excluded.updated_at`)
      .run(input.accountEmail,input.messageId,input.replyTo,input.status,JSON.stringify(input.parts),JSON.stringify(input.warnings),new Date().toISOString())
  }

  personnelMailUpdates(documentId:string): PersonnelMailUpdate[] {
    const profile=this.stores.candidates.getCurrentCandidateProfile(documentId)
    return this.database.prepare<[string],{payload:string}>('SELECT payload FROM personnel_mail_updates WHERE document_id=? ORDER BY received_at DESC,id').all(documentId).map(row=>{const value=JSON.parse(row.payload) as PersonnelMailUpdate; return {...value,currentValue:profile?.fields.find(field=>field.key===value.field)?.value??null}})
  }

  private writePersonnelMailUpdate(value:PersonnelMailUpdate) {
    this.database.prepare('INSERT INTO personnel_mail_updates(id,document_id,field,received_at,payload) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload')
      .run(value.id,value.documentId,value.field,value.receivedAt,JSON.stringify(value))
  }

  private applyPersonnelMailField(documentId:string, field:CandidateFieldKey,value:string,actor:string) {
    const profile=this.stores.candidates.getCurrentCandidateProfile(documentId)
    if (!profile || this.stores.candidates.getCandidateReview(documentId)?.recordStatus !== 'active') throw new Error('人员不存在或已归档。')
    return this.stores.candidates.updateCandidateProfile({sourceDocumentId:documentId,expectedVersion:profile.profileVersion,identity:profile.localPersonalDetails,
      fields:profile.fields.map(item=>({key:item.key,value:item.key===field?value:item.value})),projectExperiences:profile.projectExperiences},actor,actor)
  }

  mergePersonnelMailConditions(input:{accountEmail:string;messageId:string;documentIds:string[];receivedAt:string;subject:string;evidence:string;conditions:unknown;ambiguous:boolean}): number {
    const conditions=personnelMailConditionsSchema.parse(input.conditions)
    if(!Number.isFinite(Date.parse(input.receivedAt))) throw new Error('邮件日期无效。')
    return this.database.transaction(()=>{
      let changed=0
      for(const documentId of new Set(input.documentIds)) for(const condition of conditions) {
        const id=createHash('sha256').update(JSON.stringify([input.accountEmail,input.messageId,documentId,condition.field])).digest('hex')
        if(this.database.prepare('SELECT id FROM personnel_mail_updates WHERE id=?').get(id))continue
        const history=this.stores.candidates.getCandidateProfileHistory(documentId), profile=history[0]
        if(!profile || this.stores.candidates.getCandidateReview(documentId)?.recordStatus !== 'active')continue
        const previousValue=profile.fields.find(field=>field.key===condition.field)?.value??null
        const existing=this.personnelMailUpdates(documentId).filter(row=>row.field===condition.field)
        const newer=existing.some(row=>row.receivedAt>input.receivedAt)
        // Only the author of the most recent change to this field matters; editing another field is unrelated.
        const lastChange=history.find((version,index)=>version.fields.find(field=>field.key===condition.field)?.value!==history[index+1]?.fields.find(field=>field.key===condition.field)?.value)
        const manual=Boolean(previousValue&&lastChange&&!['本机导入','邮件条件同步'].includes(lastChange.confirmedBy))
        const row:PersonnelMailUpdate={id,documentId,field:condition.field,previousValue,value:condition.value,receivedAt:input.receivedAt,subject:input.subject.slice(0,1000),evidence:input.evidence.slice(0,6000),
          status:newer?'superseded':previousValue===condition.value?'applied':'pending',reason:input.ambiguous?'multiple-people':manual?'manual-conflict':null}
        if(!newer)for(const old of existing.filter(row=>row.status==='pending'&&row.receivedAt<input.receivedAt))this.writePersonnelMailUpdate({...old,status:'superseded'})
        if(row.status==='pending'&&!row.reason){this.applyPersonnelMailField(documentId,row.field,row.value,'邮件条件同步');row.status='applied';changed++}
        this.writePersonnelMailUpdate(row)
      }
      return changed
    })()
  }

  resolvePersonnelMailUpdate(raw:ResolvePersonnelMailUpdateInput,actor:string):void {
    const input=resolvePersonnelMailUpdateSchema.parse(raw)
    this.database.transaction(()=>{
      const saved=this.database.prepare<[string],{payload:string}>('SELECT payload FROM personnel_mail_updates WHERE id=?').get(input.id)
      if(!saved)throw new Error('这条邮件更新已不存在。')
      const row=JSON.parse(saved.payload) as PersonnelMailUpdate
      if(row.status===(input.action==='apply'?'applied':'dismissed'))return
      if(row.status!=='pending')throw new Error('这条更新已处理，请刷新后查看。')
      const profile=this.stores.candidates.getCurrentCandidateProfile(row.documentId)
      if(!profile||profile.profileVersion!==input.expectedVersion)throw new Error('人员资料已更新，请核对最新内容后重试。')
      if(input.action==='apply') {
        if(row.reason==='multiple-people')throw new Error('邮件涉及多个人员，请按原文分别编辑资料。')
        this.applyPersonnelMailField(row.documentId,row.field,row.value,actor)
      }
      this.writePersonnelMailUpdate({...row,status:input.action==='apply'?'applied':'dismissed'})
    })()
  }

  getCaseMailSource(reviewId: string): { accountEmail: string; messageId: string } | null {
    return this.database.prepare<[string], { accountEmail: string; messageId: string }>(`SELECT s.provider_account AS accountEmail,s.provider_message_id AS messageId
      FROM job_case_extractions e JOIN job_case_sources s ON s.id=e.source_id WHERE e.review_id=? AND s.source_type='gmail'`).get(reviewId) ?? null
  }

  getCaseReplyRecipient(reviewId: string): string | null {
    return this.database.prepare<[string], { reply_to: string | null }>(`SELECT i.reply_to FROM job_case_extractions e
      JOIN job_case_sources s ON s.id=e.source_id JOIN gmail_business_intake i
      ON i.account_email=s.provider_account AND i.gmail_message_id=s.provider_message_id
      WHERE e.review_id=? AND s.source_type='gmail'`).get(reviewId)?.reply_to ?? null
  }

  findResumeDocumentByHash(sha256: string): string | null {
    return this.database.prepare<[string], { token: string }>('SELECT token FROM staged_files WHERE sha256=? ORDER BY created_at LIMIT 1').get(sha256)?.token ?? null
  }

  getGoogleWorkspaceAdminConfiguration(): GoogleWorkspaceAdminConfiguration | null {
    const row = this.database
      .prepare<[], GoogleWorkspaceAdminConfigurationRow>(
        `SELECT client_id, workspace_domain, label_ids_json, query_text, lookback_days,
                max_messages_per_run, revision, configured_by, updated_at
         FROM google_workspace_admin_configuration WHERE singleton = 1`
      )
      .get()
    if (!row) return null
    return googleWorkspaceAdminConfigurationSchema.parse({
      version: 'google-workspace-admin-config-v1',
      source: 'local-admin',
      editable: true,
      clientId: row.client_id,
      workspaceDomain: row.workspace_domain,
      labelIds: JSON.parse(row.label_ids_json) as unknown,
      query: row.query_text,
      lookbackDays: row.lookback_days,
      maxMessagesPerRun: row.max_messages_per_run,
      revision: row.revision,
      configuredBy: row.configured_by,
      updatedAt: row.updated_at
    })
  }

  saveGoogleWorkspaceAdminConfiguration(
    rawInput: SaveGoogleWorkspaceAdminConfigurationInput,
    configuredBy: string,
    now = new Date()
  ): GoogleWorkspaceAdminConfiguration {
    const input = saveGoogleWorkspaceAdminConfigurationInputSchema.parse(rawInput)
    const current = this.getGoogleWorkspaceAdminConfiguration()
    if ((current && current.revision !== input.expectedRevision) || (!current && input.expectedRevision !== null)) {
      throw new Error('Google Workspace 管理者設定が更新されました。再読み込みしてください。')
    }
    const timestamp = now.toISOString()
    const nextRevision = (current?.revision ?? 0) + 1
    this.database
      .prepare(
        `INSERT INTO google_workspace_admin_configuration(
           singleton, client_id, workspace_domain, label_ids_json, query_text, lookback_days,
           max_messages_per_run, revision, configured_by, created_at, updated_at
         ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           client_id = excluded.client_id,
           workspace_domain = excluded.workspace_domain,
           label_ids_json = excluded.label_ids_json,
           query_text = excluded.query_text,
           lookback_days = excluded.lookback_days,
           max_messages_per_run = excluded.max_messages_per_run,
           revision = excluded.revision,
           configured_by = excluded.configured_by,
           updated_at = excluded.updated_at`
      )
      .run(
        input.clientId,
        input.workspaceDomain,
        JSON.stringify(input.labelIds),
        input.query,
        input.lookbackDays,
        input.maxMessagesPerRun,
        nextRevision,
        configuredBy,
        timestamp,
        timestamp
      )
    const saved = this.getGoogleWorkspaceAdminConfiguration()
    if (!saved) throw new Error('Google Workspace 管理者設定を再読み込みできませんでした。')
    return saved
  }

  getLatestGoogleWorkspaceAcceptanceReport(configurationFingerprint?: string): GoogleWorkspaceOnlineAcceptanceReport | null {
    const row = configurationFingerprint
      ? this.database
          .prepare<[string], GoogleWorkspaceAcceptanceReportRow>(
            `SELECT report_json FROM google_workspace_acceptance_reports
             WHERE configuration_fingerprint = ? ORDER BY checked_at DESC, id DESC LIMIT 1`
          )
          .get(configurationFingerprint)
      : this.database
          .prepare<[], GoogleWorkspaceAcceptanceReportRow>(
            'SELECT report_json FROM google_workspace_acceptance_reports ORDER BY checked_at DESC, id DESC LIMIT 1'
          )
          .get()
    return row ? googleWorkspaceOnlineAcceptanceReportSchema.parse(JSON.parse(row.report_json)) : null
  }

  saveGoogleWorkspaceAcceptanceReport(rawReport: GoogleWorkspaceOnlineAcceptanceReport): GoogleWorkspaceOnlineAcceptanceReport {
    const report = googleWorkspaceOnlineAcceptanceReportSchema.parse(rawReport)
    this.database
      .prepare(
        `INSERT INTO google_workspace_acceptance_reports(
           id, configuration_fingerprint, report_json, outcome, checked_at
         ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(report.id, report.configurationFingerprint, JSON.stringify(report), report.overall, report.checkedAt)
    return this.getLatestGoogleWorkspaceAcceptanceReport(report.configurationFingerprint) ?? report
  }

  getGmailSyncCheckpoint(accountEmail: string): GmailSyncCheckpointRecord | null {
    const row = this.database
      .prepare<[string], GmailSyncStateRow>('SELECT * FROM gmail_sync_states WHERE account_email = ?')
      .get(accountEmail)
    if (!row) return null
    return {
      accountEmail: row.account_email,
      configHash: row.config_hash,
      historyId: row.history_id,
      status: row.status,
      lastSyncedAt: row.last_synced_at,
      lastRun: row.last_run_json ? JSON.parse(row.last_run_json) as GmailSyncCheckpointRecord['lastRun'] : null,
      lastError: row.last_error
    }
  }

  saveGmailSyncSuccess(
    accountEmail: string,
    configHash: string,
    historyId: string,
    lastRun: NonNullable<GmailSyncCheckpointRecord['lastRun']>,
    syncedAt: string
  ): void {
    this.database
      .prepare(
        `INSERT INTO gmail_sync_states(
           account_email, config_hash, history_id, status, last_synced_at, last_run_json, last_error, updated_at
         ) VALUES (?, ?, ?, 'idle', ?, ?, NULL, ?)
         ON CONFLICT(account_email) DO UPDATE SET
           config_hash = excluded.config_hash,
           history_id = excluded.history_id,
           status = 'idle',
           last_synced_at = excluded.last_synced_at,
           last_run_json = excluded.last_run_json,
           last_error = NULL,
           updated_at = excluded.updated_at`
      )
      .run(accountEmail, configHash, historyId, syncedAt, JSON.stringify(lastRun), syncedAt)
  }

  saveGmailSyncFailure(
    accountEmail: string,
    configHash: string,
    errorCode: string,
    failedAt: string,
    lastRun: GmailSyncCheckpointRecord['lastRun'] = null
  ): void {
    this.database
      .prepare(
        `INSERT INTO gmail_sync_states(
           account_email, config_hash, history_id, status, last_synced_at, last_run_json, last_error, updated_at
         ) VALUES (?, ?, NULL, 'error', NULL, ?, ?, ?)
         ON CONFLICT(account_email) DO UPDATE SET
           history_id = CASE
             WHEN gmail_sync_states.config_hash = excluded.config_hash THEN gmail_sync_states.history_id
             ELSE NULL
           END,
           config_hash = excluded.config_hash,
           status = 'error',
           last_run_json = excluded.last_run_json,
           last_error = excluded.last_error,
           updated_at = excluded.updated_at`
      )
      .run(accountEmail, configHash, lastRun ? JSON.stringify(lastRun) : null, errorCode.slice(0, 240), failedAt)
  }

  hasGmailMessage(accountEmail: string, gmailMessageId: string): boolean {
    return Boolean(
      this.database
        .prepare<[string, string, string, string], { present: number }>(
          `SELECT 1 AS present FROM gmail_messages WHERE account_email = ? AND gmail_message_id = ?
           UNION ALL
           SELECT 1 AS present FROM gmail_message_tombstones WHERE account_email = ? AND gmail_message_id = ?
           LIMIT 1`
        )
        .get(accountEmail, gmailMessageId, accountEmail, gmailMessageId)
    )
  }

  findGmailMessageByFingerprint(accountEmail: string, fingerprint: string): string | null {
    return this.database
      .prepare<[string, string], { gmail_message_id: string }>(
        `SELECT gmail_message_id FROM gmail_messages
         WHERE account_email = ? AND business_fingerprint = ?
         ORDER BY imported_at ASC LIMIT 1`
      )
      .get(accountEmail, fingerprint)?.gmail_message_id ?? null
  }

  saveGmailMessage(input: StoredGmailMessageInput): boolean {
    const message = storedGmailMessageInputSchema.parse(input)
    const deleted = this.database
      .prepare<[string, string], { present: number }>(
        'SELECT 1 AS present FROM gmail_message_tombstones WHERE account_email = ? AND gmail_message_id = ?'
      )
      .get(message.accountEmail, message.gmailMessageId)
    if (deleted) return false
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO gmail_messages(
           account_email, gmail_message_id, thread_id, history_id, internal_date, label_ids_json,
           rfc_message_id, from_domain, redacted_subject, redacted_body, redaction_session_id,
           classification, business_fingerprint, duplicate_of_message_id, warning_codes_json,
           attachment_count, cloud_eligible, imported_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        message.accountEmail,
        message.gmailMessageId,
        message.threadId,
        message.historyId,
        message.internalDate,
        JSON.stringify(message.labelIds),
        message.rfcMessageId,
        message.fromDomain,
        message.redactedSubject,
        message.redactedBody,
        message.redactionSessionId,
        message.classification,
        message.businessFingerprint,
        message.duplicateOfMessageId,
        JSON.stringify(message.warningCodes),
        message.attachmentCount,
        message.importedAt
      )
    return result.changes === 1
  }

  countGmailMessages(accountEmail: string): number {
    return this.database
      .prepare<[string], { count: number }>('SELECT count(*) AS count FROM gmail_messages WHERE account_email = ?')
      .get(accountEmail)?.count ?? 0
  }

  summarizeGmailRedactionEvidence(accountEmail: string): GmailRedactionEvidenceSummary {
    return this.database
      .prepare<[string], GmailRedactionEvidenceSummary>(
        `SELECT
           count(*) AS storedMessages,
           coalesce(sum(CASE WHEN session.status = 'passed' THEN 1 ELSE 0 END), 0) AS passed,
           coalesce(sum(CASE WHEN session.status = 'uncertain' THEN 1 ELSE 0 END), 0) AS uncertain,
           coalesce(sum(CASE WHEN session.id IS NULL OR session.status IN ('failed', 'invalidated') THEN 1 ELSE 0 END), 0) AS blocked
         FROM gmail_messages message
         LEFT JOIN redaction_sessions session ON session.id = message.redaction_session_id
         WHERE message.account_email = ?`
      )
      .get(accountEmail) ?? { storedMessages: 0, passed: 0, uncertain: 0, blocked: 0 }
  }
}
