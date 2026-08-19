import {
  type CloudCallAuditRecord,
  type DirectIdentifier,
  type LocalPiiMapping,
  type RedactionSessionEvidence
} from '@privacy'
import { openMapping, sealMapping } from '../mappers'
import { type MappingRow, type RedactionSessionIdRow, type RedactionSessionRow } from '../rows'
import { DomainStore } from './base'

export class PrivacyStore extends DomainStore {
  saveRedactionSession(session: RedactionSessionEvidence, mappings: LocalPiiMapping[]): void {
    const save = this.database.transaction(() => {
      this.persistRedactionSession(session, mappings)
    })
    save()
  }

  persistRedactionSession(session: RedactionSessionEvidence, mappings: LocalPiiMapping[]): void {
    this.database
      .prepare(
        `INSERT INTO redaction_sessions(
           id, source_version, policy_version, status, content_hash, removed_types_json, created_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           content_hash = excluded.content_hash,
           removed_types_json = excluded.removed_types_json,
           expires_at = excluded.expires_at`
      )
      .run(
        session.id,
        session.sourceVersion,
        session.policyVersion,
        session.status,
        session.contentHash,
        JSON.stringify(session.removedTypes),
        session.createdAt,
        session.expiresAt
      )
    this.database.prepare('DELETE FROM local_pii_mappings WHERE redaction_session_id = ?').run(session.id)
    const insertMapping = this.database.prepare(
      `INSERT INTO local_pii_mappings(
         redaction_session_id, placeholder, identifier_type, encrypted_original
       ) VALUES (?, ?, ?, ?)`
    )
    for (const mapping of mappings) {
      insertMapping.run(
        session.id,
        mapping.placeholder,
        mapping.identifierType,
        sealMapping(this.mappingKey, mapping, session.id)
      )
    }
  }

  getRedactionSessionIdForDocument(documentId: string): string | null {
    return this.database
      .prepare<[string], RedactionSessionIdRow>('SELECT redaction_session_id FROM parsed_documents WHERE document_id = ?')
      .get(documentId)?.redaction_session_id ?? null
  }

  getRedactionSession(id: string): RedactionSessionEvidence | null {
    const row = this.database
      .prepare<[string], RedactionSessionRow>('SELECT * FROM redaction_sessions WHERE id = ?')
      .get(id)
    if (!row) return null
    return {
      id: row.id,
      sourceVersion: row.source_version,
      policyVersion: row.policy_version,
      status: row.status,
      contentHash: row.content_hash,
      removedTypes: JSON.parse(row.removed_types_json) as DirectIdentifier[],
      createdAt: row.created_at,
      expiresAt: row.expires_at
    }
  }

  getLocalPiiMappings(sessionId: string): LocalPiiMapping[] {
    const rows = this.database
      .prepare<[string], MappingRow>(
        'SELECT placeholder, identifier_type, encrypted_original FROM local_pii_mappings WHERE redaction_session_id = ? ORDER BY placeholder'
      )
      .all(sessionId)
    return rows.map((row) => ({
      placeholder: row.placeholder,
      identifierType: row.identifier_type,
      originalValue: openMapping(this.mappingKey, row, sessionId)
    }))
  }

  appendCloudCallAudit(record: CloudCallAuditRecord): void {
    this.database
      .prepare(
        `INSERT INTO cloud_call_audits(
           id, redaction_session_id, provider, task_type, endpoint, input_hash, dlp_status, outcome, reason_code,
           quality_gate_report_hash, expert_attestation_hash, review_ticket_hash, review_ticket_status,
           gate_policy_version, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.redactionSessionId,
        record.provider,
        record.taskType,
        record.endpoint,
        record.inputHash,
        record.dlpStatus,
        record.outcome,
        record.reasonCode,
        record.qualityGateReportHash,
        record.expertAttestationHash,
        record.reviewTicketHash,
        record.reviewTicketStatus,
        record.gatePolicyVersion,
        record.createdAt
      )
  }
}
