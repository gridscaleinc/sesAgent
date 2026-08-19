import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { dataDeletionReportSchema } from '@shared'
import { type DataDeletionReport, type RecoveryPackageSummary, type RecoveryState } from '@shared/contracts'
import { type DataDeletionReportRow } from '../rows'
import {
  createIndexInAttachedSchema,
  createTableInAttachedSchema,
  createTriggerInAttachedSchema,
  quoteSqlIdentifier
} from '../schema/sql'
import { DomainStore } from './base'

export class MaintenanceStore extends DomainStore {
  saveDataDeletionReport<T extends DataDeletionReport>(input: T): T {
    const report = dataDeletionReportSchema.parse(input)
    this.database
      .prepare(
        `INSERT INTO data_deletion_reports(
           id, entity_type, entity_id_hash, report_json, outcome, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           report_json = excluded.report_json,
           outcome = excluded.outcome,
           completed_at = excluded.completed_at`
      )
      .run(
        report.id,
        report.entityType,
        report.entityIdHash,
        JSON.stringify(report),
        report.outcome,
        report.completedAt
      )
    return report as T
  }

  listDataDeletionReports(): DataDeletionReport[] {
    return this.database
      .prepare<[], DataDeletionReportRow>(
        'SELECT report_json FROM data_deletion_reports ORDER BY completed_at DESC LIMIT 200'
      )
      .all()
      .map((row) => dataDeletionReportSchema.parse(JSON.parse(row.report_json)))
  }

  getSchemaVersion(): number {
    const row = this.database
      .prepare<[], { version: number }>('SELECT max(version) AS version FROM schema_migrations')
      .get()
    return row?.version ?? 0
  }

  async createConsistentSnapshot(destinationPath: string): Promise<{ dataRevision: number }> {
    mkdirSync(dirname(destinationPath), { recursive: true, mode: 0o700 })
    rmSync(destinationPath, { force: true })
    this.checkpoint()
    const snapshotSchema = 'recovery_snapshot'
    let attached = false
    let transactionOpen = false
    let snapshotDataRevision: number | null = null
    this.database.pragma('foreign_keys=OFF')
    try {
      this.database
        .prepare(`ATTACH DATABASE ? AS ${quoteSqlIdentifier(snapshotSchema)} KEY ?`)
        .run(destinationPath, this.databaseKey)
      attached = true
      this.database.exec('BEGIN IMMEDIATE')
      transactionOpen = true
      const unsupported = this.database
        .prepare<[], { type: string; name: string }>(
          "SELECT type, name FROM main.sqlite_master WHERE type = 'view' AND sql IS NOT NULL LIMIT 1"
        )
        .get()
      if (unsupported) throw new Error(`Consistent snapshot does not yet support ${unsupported.type}: ${unsupported.name}`)
      const tables = this.database
        .prepare<[], { name: string; sql: string }>(
          "SELECT name, sql FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name"
        )
        .all()
      for (const table of tables) {
        this.database.exec(createTableInAttachedSchema(snapshotSchema, table.name, table.sql))
      }
      for (const table of tables) {
        this.database.exec(
          `INSERT INTO ${quoteSqlIdentifier(snapshotSchema)}.${quoteSqlIdentifier(table.name)} ` +
          `SELECT * FROM main.${quoteSqlIdentifier(table.name)}`
        )
      }
      const indexes = this.database
        .prepare<[], { name: string; sql: string }>(
          "SELECT name, sql FROM main.sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name"
        )
        .all()
      for (const index of indexes) {
        this.database.exec(createIndexInAttachedSchema(snapshotSchema, index.name, index.sql))
      }
      const revisionRow = this.database
        .prepare<[], { revision: number }>(
          `SELECT revision FROM ${quoteSqlIdentifier(snapshotSchema)}.local_data_revision WHERE singleton = 1`
        )
        .get()
      if (!revisionRow) throw new Error('Consistent snapshot is missing the local data revision marker.')
      snapshotDataRevision = revisionRow.revision
      const triggers = this.database
        .prepare<[], { name: string; sql: string }>(
          "SELECT name, sql FROM main.sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL ORDER BY name"
        )
        .all()
      for (const trigger of triggers) {
        this.database.exec(createTriggerInAttachedSchema(snapshotSchema, trigger.name, trigger.sql))
      }
      const integrity = this.database.pragma(`${snapshotSchema}.integrity_check`, { simple: true })
      if (integrity !== 'ok') throw new Error('Encrypted consistent snapshot failed integrity verification.')
      this.database.exec('COMMIT')
      transactionOpen = false
      this.database.exec(`DETACH DATABASE ${quoteSqlIdentifier(snapshotSchema)}`)
      attached = false
      chmodSync(destinationPath, 0o600)
    } catch (error) {
      if (transactionOpen) {
        try { this.database.exec('ROLLBACK') } catch { /* The original error is more useful. */ }
      }
      if (attached) {
        try { this.database.exec(`DETACH DATABASE ${quoteSqlIdentifier(snapshotSchema)}`) } catch { /* Best-effort cleanup. */ }
      }
      rmSync(destinationPath, { force: true })
      throw error
    } finally {
      this.database.pragma('foreign_keys=ON')
    }
    if (snapshotDataRevision === null) throw new Error('Consistent snapshot did not capture the local data revision.')
    return { dataRevision: snapshotDataRevision }
  }

  getLocalDataRevision(): { revision: number; updatedAt: string | null } {
    const row = this.database
      .prepare<[], { revision: number; updated_at: string | null }>(
        'SELECT revision, updated_at FROM local_data_revision WHERE singleton = 1'
      )
      .get()
    if (!row) throw new Error('Local data revision marker is missing.')
    return { revision: row.revision, updatedAt: row.updated_at }
  }

  recordRecoveryEvent(
    eventType: 'backup-created' | 'restore-completed' | 'restore-failed',
    summary: RecoveryPackageSummary,
    packageHash: string,
    now = new Date(),
    dataRevision = this.getLocalDataRevision().revision
  ): void {
    if (!/^[a-f0-9]{64}$/u.test(packageHash)) throw new Error('Recovery package hash is invalid.')
    if (!Number.isSafeInteger(dataRevision) || dataRevision < 0) throw new Error('Recovery data revision is invalid.')
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO recovery_events(
             id, event_type, backup_id, package_hash, summary_json, created_at, data_revision
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          randomUUID(), eventType, summary.backupId, packageHash,
          JSON.stringify(summary), now.toISOString(), dataRevision
        )
      if (eventType === 'backup-created') {
        this.database
          .prepare(
            `UPDATE recovery_reminder_preferences
             SET snoozed_until = NULL, snoozed_revision = NULL, updated_at = ?
             WHERE singleton = 1
               AND ? >= (SELECT revision FROM local_data_revision WHERE singleton = 1)`
          )
          .run(now.toISOString(), dataRevision)
      }
    })()
  }

  snoozeRecoveryReminder(days: 1 | 7, now = new Date()): void {
    const state = this.getRecoveryState(false, now)
    if (state.reminder.status !== 'due') return
    const snoozedUntil = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
    this.database
      .prepare(
        `UPDATE recovery_reminder_preferences
         SET snoozed_until = ?, snoozed_revision = ?, updated_at = ?
         WHERE singleton = 1`
      )
      .run(snoozedUntil, state.reminder.currentDataRevision, now.toISOString())
  }

  getRecoveryState(pendingRestore = false, now = new Date()): RecoveryState {
    const lastBackup = this.database
      .prepare<[], { created_at: string; data_revision: number }>(
        `SELECT created_at, data_revision
         FROM recovery_events
         WHERE event_type = 'backup-created'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get()
    const lastRestoreAt = this.database
      .prepare<[], { created_at: string }>(
        "SELECT created_at FROM recovery_events WHERE event_type = 'restore-completed' ORDER BY created_at DESC LIMIT 1"
      )
      .get()?.created_at ?? null
    const current = this.getLocalDataRevision()
    const preference = this.database
      .prepare<[], { snoozed_until: string | null; snoozed_revision: number | null }>(
        `SELECT snoozed_until, snoozed_revision
         FROM recovery_reminder_preferences WHERE singleton = 1`
      )
      .get()
    if (!preference) throw new Error('Recovery reminder preference is missing.')
    let reason: RecoveryState['reminder']['reason'] = null
    if (current.revision > 0) {
      if (!lastBackup) reason = 'no-backup'
      else if (current.revision > lastBackup.data_revision) reason = 'data-changed'
    }
    const isSnoozed = Boolean(
      reason &&
      preference.snoozed_until &&
      preference.snoozed_revision !== null &&
      preference.snoozed_revision >= current.revision &&
      new Date(preference.snoozed_until).getTime() > now.getTime()
    )
    return {
      format: 'ses-recovery-v1',
      encryption: 'scrypt-aes-256-gcm',
      lastBackupAt: lastBackup?.created_at ?? null,
      lastRestoreAt,
      pendingRestore,
      reminder: {
        status: reason ? (isSnoozed ? 'snoozed' : 'due') : 'not-needed',
        reason,
        currentDataRevision: current.revision,
        lastBackupDataRevision: lastBackup?.data_revision ?? null,
        latestDataChangedAt: current.updatedAt,
        snoozedUntil: isSnoozed ? preference.snoozed_until : null
      }
    }
  }

  checkpoint(): void {
    this.database.pragma('wal_checkpoint(TRUNCATE)')
  }
}
