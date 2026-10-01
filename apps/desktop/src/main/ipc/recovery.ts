import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { app, dialog, ipcMain } from 'electron'
import { EncryptedApplicationRepository } from '@persistence'
import { deriveApplicationKeys } from '@platform/keys'
import {
  type StagedRecoveryPackage,
  createRecoveryPackage,
  discardStagedRecovery,
  hasPendingRestore,
  schedulePendingRestore,
  stageRecoveryPackage
} from '@recovery'
import {
  type ConfirmRecoveryResult,
  type CreateRecoveryPackageResult,
  type HeldDeletion,
  type RecoveryPreviewResult,
  type RecoveryState,
  confirmRecoveryInputSchema,
  createRecoveryPackageInputSchema,
  ipcChannels,
  previewRecoveryPackageInputSchema,
  snoozeRecoveryReminderInputSchema
} from '@shared'
import { assertTrustedSender, type MainIpcContext } from './context'
import { countRestoredDeletions, verifyStagedRecovery } from '../recovery-verification'
import { deleteJournaledRecord, deviceDeletionJournal, journalRecordExists } from '../deletion-journal'

/** Encrypted recovery package creation, preview and restore confirmation. */
export function registerRecoveryHandlers(context: MainIpcContext) {
  const { repository, masterKey, masterKeyProvider, userDataPath, fileVault } = context
  const journal = () => deviceDeletionJournal(userDataPath)
  /** Held deletions still in the data; one deleted or gone meanwhile is settled (confirmed again for future restores). */
  const heldDeletions = async (): Promise<HeldDeletion[]> => {
    const exists = journalRecordExists(repository)
    const rows: HeldDeletion[] = []
    for (const entry of await journal().held()) {
      if (!exists(entry)) {
        await journal().confirm(entry.id)
        continue
      }
      const label =
        entry.entityType === 'candidate'
          ? (() => {
              const person = repository.getCandidateReview(entry.entityId)
              return person?.localIdentity?.displayName || person?.fileName || entry.entityId
            })()
          : (() => {
              const job = repository.getJobCaseReview(entry.entityId)
              return job?.fields.find((field) => field.key === 'title')?.value || job?.redactedSubject || entry.entityId
            })()
      rows.push({ id: entry.id, entityType: entry.entityType, label, reason: entry.heldReason ?? '', deletedAt: entry.deletedAt })
    }
    return rows
  }
  ipcMain.handle(ipcChannels.listHeldDeletions, async (event) => {
    assertTrustedSender(event)
    return heldDeletions()
  })
  ipcMain.handle(ipcChannels.resolveHeldDeletion, async (event, rawInput) => {
    assertTrustedSender(event)
    const input = z
      .object({ id: z.string().uuid(), action: z.enum(['delete', 'keep']) })
      .strict()
      .parse(rawInput)
    const entry = (await journal().held()).find((item) => item.id === input.id)
    if (!entry) throw new Error('这条删除已处理。 / この削除は処理済みです。')
    if (input.action === 'keep') {
      // HR keeps the record: it is no longer a deletion to redo after a future restore either.
      await journal().discard(entry.id)
    } else {
      await deleteJournaledRecord(entry, repository, fileVault)
      await journal().confirm(entry.id)
    }
    return heldDeletions()
  })
  let recoveryBusy = false
  let recoveryPreview: {
    token: string
    staged: StagedRecoveryPackage
    expiresAt: Date
  } | null = null

  const discardRecoveryPreview = async () => {
    if (!recoveryPreview) return
    const preview = recoveryPreview
    recoveryPreview = null
    await discardStagedRecovery(preview.staged)
  }

  const expireRecoveryPreview = async () => {
    if (recoveryPreview && recoveryPreview.expiresAt.getTime() <= Date.now()) await discardRecoveryPreview()
  }

  ipcMain.handle(ipcChannels.getRecoveryState, async (event): Promise<RecoveryState> => {
    assertTrustedSender(event)
    return repository.getRecoveryState(await hasPendingRestore(userDataPath))
  })

  ipcMain.handle(ipcChannels.createRecoveryPackage, async (event, rawInput): Promise<CreateRecoveryPackageResult> => {
    assertTrustedSender(event)
    const input = createRecoveryPackageInputSchema.parse(rawInput)
    if (recoveryBusy) throw new Error('別のバックアップまたは復元確認が進行中です。')
    recoveryBusy = true
    const temporaryDirectory = join(userDataPath, 'recovery', 'backup-work', randomUUID())
    let snapshotRepository: EncryptedApplicationRepository | null = null
    let snapshotKeys: ReturnType<typeof deriveApplicationKeys> | null = null
    try {
      const selection = await dialog.showSaveDialog({
        title: '暗号化復元パッケージを保存',
        defaultPath: `ses-agent-${new Date().toISOString().slice(0, 10)}.ses-recovery`,
        filters: [{ name: 'SES Agent Recovery', extensions: ['ses-recovery'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      })
      if (selection.canceled || !selection.filePath) {
        return { cancelled: true, fileName: null, packageHash: null, summary: null }
      }
      const outputPath = selection.filePath.endsWith('.ses-recovery') ? selection.filePath : `${selection.filePath}.ses-recovery`
      const snapshotPath = join(temporaryDirectory, 'ses-agent.db')
      const snapshot = await repository.createConsistentSnapshot(snapshotPath)
      snapshotKeys = deriveApplicationKeys(masterKey)
      snapshotRepository = new EncryptedApplicationRepository({
        path: snapshotPath,
        databaseKey: snapshotKeys.databaseKey,
        mappingKey: snapshotKeys.mappingKey
      })
      const vaultObjects = snapshotRepository.listStagedFileRecords().map((record) => {
        const expectedPath = join(userDataPath, 'vault', 'resume-files', `${record.token}.sesv`)
        if (record.encryptedPath !== expectedPath) {
          throw new Error('暗号化ファイルの保存場所が管理対象ディレクトリと一致しません。')
        }
        return { token: record.token, sourcePath: record.encryptedPath }
      })
      const platform = process.platform === 'darwin' || process.platform === 'win32' ? process.platform : null
      if (!platform) throw new Error('このプラットフォームでは復元パッケージを作成できません。')
      const created = await createRecoveryPackage({
        outputPath,
        databaseSnapshotPath: snapshotPath,
        vaultObjects,
        masterKey,
        password: input.password,
        source: {
          appVersion: app.getVersion(),
          platform,
          arch: process.arch,
          schemaVersion: snapshotRepository.getSchemaVersion()
        }
      })
      try {
        repository.recordRecoveryEvent('backup-created', created.summary, created.packageHash, new Date(), snapshot.dataRevision)
      } catch (error) {
        await rm(outputPath, { force: true })
        throw error
      }
      return {
        cancelled: false,
        fileName: basename(outputPath),
        packageHash: created.packageHash,
        summary: created.summary
      }
    } finally {
      snapshotRepository?.close()
      snapshotKeys?.databaseKey.fill(0)
      snapshotKeys?.mappingKey.fill(0)
      snapshotKeys?.fileVaultKey.fill(0)
      await rm(temporaryDirectory, { recursive: true, force: true })
      recoveryBusy = false
    }
  })

  ipcMain.handle(ipcChannels.snoozeRecoveryReminder, async (event, rawInput): Promise<RecoveryState> => {
    assertTrustedSender(event)
    const input = snoozeRecoveryReminderInputSchema.parse(rawInput)
    repository.snoozeRecoveryReminder(input.days)
    return repository.getRecoveryState(await hasPendingRestore(userDataPath))
  })

  ipcMain.handle(ipcChannels.previewRecoveryPackage, async (event, rawInput): Promise<RecoveryPreviewResult> => {
    assertTrustedSender(event)
    const input = previewRecoveryPackageInputSchema.parse(rawInput)
    if (recoveryBusy) throw new Error('別のバックアップまたは復元確認が進行中です。')
    recoveryBusy = true
    let staged: StagedRecoveryPackage | null = null
    try {
      await expireRecoveryPreview()
      const selection = await dialog.showOpenDialog({
        title: '暗号化復元パッケージを選択',
        filters: [{ name: 'SES Agent Recovery', extensions: ['ses-recovery'] }],
        properties: ['openFile']
      })
      const packagePath = selection.filePaths[0]
      if (selection.canceled || !packagePath) {
        return {
          cancelled: true,
          restoreToken: null,
          confirmationHash: null,
          expiresAt: null,
          summary: null,
          warnings: []
        }
      }
      await discardRecoveryPreview()
      const token = randomUUID()
      const stagingDirectory = join(userDataPath, 'recovery', 'previews', token)
      staged = await stageRecoveryPackage({ packagePath, password: input.password, stagingDirectory })
      await verifyStagedRecovery(staged, repository.getSchemaVersion())
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
      recoveryPreview = { token, staged, expiresAt }
      // People and cases deleted after this backup was made come back with it, and are deleted again right after the
      // restore; only those actually in the backup count, and those with someone in place there are left to HR.
      const deletedSince = await deviceDeletionJournal(userDataPath)
        .recordedAfter(staged.summary.createdAt)
        .then((entries) => countRestoredDeletions(staged!, entries))
        .catch(() => ({ total: 0, inPlace: 0 }))
      return {
        cancelled: false,
        restoreToken: token,
        confirmationHash: staged.confirmationHash,
        expiresAt: expiresAt.toISOString(),
        summary: staged.summary,
        warnings: [
          '現在のローカルデータは再起動時に置き換えられます。',
          'Google Workspace の認証情報は復元されず、再接続が必要です。',
          'アプリ外へ書き出したファイルは復元対象外です。',
          ...(deletedSince.total
            ? [
                `このバックアップの作成後に完全削除した ${deletedSince.total} 件（要員・案件）は、復元後の再起動時にもう一度削除されます。` +
                  (deletedSince.inPlace
                    ? `うち ${deletedSince.inPlace} 件はバックアップ時点で参画中のため自動では削除されず、復元後に削除するか残すかを確認します。`
                    : '')
              ]
            : [])
        ]
      }
    } catch (error) {
      if (staged && recoveryPreview?.staged !== staged) await discardStagedRecovery(staged)
      throw error
    } finally {
      recoveryBusy = false
    }
  })

  ipcMain.handle(ipcChannels.confirmRecovery, async (event, rawInput): Promise<ConfirmRecoveryResult> => {
    assertTrustedSender(event)
    const input = confirmRecoveryInputSchema.parse(rawInput)
    if (recoveryBusy) throw new Error('別のバックアップまたは復元確認が進行中です。')
    recoveryBusy = true
    try {
      await expireRecoveryPreview()
      const preview = recoveryPreview
      if (!preview || preview.token !== input.restoreToken) throw new Error('復元確認の有効期限が切れました。もう一度検証してください。')
      if (preview.staged.confirmationHash !== input.confirmationHash)
        throw new Error('復元対象が変更されました。もう一度検証してください。')
      const protectedMasterKeyPath = join(dirname(preview.staged.databasePath), '..', 'security', 'master-key.v1')
      await masterKeyProvider.writeProtectedMasterKey(protectedMasterKeyPath, preview.staged.masterKey)
      await schedulePendingRestore({
        userDataPath,
        restoreToken: preview.token,
        stagingDirectory: join(dirname(preview.staged.databasePath), '..'),
        packageHash: preview.staged.packageHash,
        confirmationHash: preview.staged.confirmationHash,
        summary: preview.staged.summary
      })
      preview.staged.masterKey.fill(0)
      recoveryPreview = null
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 250)
      return { scheduled: true, restartRequired: true }
    } finally {
      recoveryBusy = false
    }
  })
}
