// @vitest-environment node
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkTaskPreview, materializeWorkTask } from '@application'
import { currentSchemaVersion, EncryptedApplicationRepository } from '../index'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'

const summary = {
  version: 'ses-recovery-v1' as const,
  backupId: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-09-01T00:00:00.000Z',
  sourcePlatform: 'darwin' as const,
  sourceArch: 'arm64',
  schemaVersion: 1,
  databaseBytes: 1,
  vaultObjectCount: 0,
  vaultBytes: 0,
  totalBytes: 1,
  googleWorkspaceCredentialIncluded: false as const,
  cloudDataIncluded: false as const
}

describe.skipIf(!nativeSqliteAvailable)('MaintenanceStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  it('migrates a fresh database to the current schema version', () => {
    expect(handle.repository.getSchemaVersion()).toBe(currentSchemaVersion)
    expect(handle.reopen().getSchemaVersion()).toBe(currentSchemaVersion)
  })

  it('drives the backup reminder from data revisions: due, snoozed, cleared by a backup, due again on change', () => {
    const { repository } = handle
    const now = new Date('2026-09-01T00:00:00.000Z')
    repository.saveWorkTask(materializeWorkTask(createWorkTaskPreview('JavaとAWSの候補者を検索したい'), 'task-r1', now.toISOString()))
    expect(repository.getRecoveryState(false, now).reminder).toMatchObject({ status: 'due', reason: 'no-backup' })

    repository.snoozeRecoveryReminder(1, now)
    expect(repository.getRecoveryState(false, now).reminder.status).toBe('snoozed')
    // Snooze ends after its window.
    expect(repository.getRecoveryState(false, new Date(now.getTime() + 2 * 86_400_000)).reminder.status).toBe('due')

    expect(() => repository.recordRecoveryEvent('backup-created', summary, 'not-a-hash', now)).toThrow(/hash is invalid/)
    repository.recordRecoveryEvent('backup-created', summary, 'f'.repeat(64), now)
    const afterBackup = repository.getRecoveryState(false, now)
    expect(afterBackup.reminder).toMatchObject({ status: 'not-needed', reason: null })
    expect(afterBackup.lastBackupAt).toBe(now.toISOString())

    repository.saveWorkTask(materializeWorkTask(createWorkTaskPreview('JavaとAWSの候補者を検索したい'), 'task-r2', now.toISOString()))
    expect(repository.getRecoveryState(false, now).reminder).toMatchObject({ status: 'due', reason: 'data-changed' })
  })

  it('writes a consistent encrypted snapshot that opens with the same keys', async () => {
    const { repository } = handle
    repository.saveWorkTask(
      materializeWorkTask(createWorkTaskPreview('JavaとAWSの候補者を検索したい'), 'task-snap', '2026-09-01T00:00:00.000Z')
    )
    const destination = join(handle.path, '..', 'snapshot', 'snapshot.db')
    const { dataRevision } = await repository.createConsistentSnapshot(destination)
    expect(dataRevision).toBe(repository.getLocalDataRevision().revision)
    const snapshot = new EncryptedApplicationRepository({
      path: destination,
      databaseKey: handle.databaseKey,
      mappingKey: handle.mappingKey
    })
    try {
      expect(snapshot.getWorkTask('task-snap')?.id).toBe('task-snap')
    } finally {
      snapshot.close()
    }
  })
})
