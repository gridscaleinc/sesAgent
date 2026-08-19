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

export class GmailStore extends DomainStore {
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
