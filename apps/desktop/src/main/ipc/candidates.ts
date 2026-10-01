import { createHash, randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { ipcMain, shell } from 'electron'
import { buildOriginalDocumentPreview } from '@files'
import { searchConfirmedCandidateProfiles } from '@resume'
import {
  type DataDeletionReport,
  type DeleteCandidateDataResult,
  type OpenOriginalDocumentResult,
  type OriginalDocumentPreview,
  type SubmitCandidateMatchFeedbackResult,
  type UpdateCandidateProfileResult,
  candidateProfileSourceInputSchema,
  deleteCandidateDataInputSchema,
  ipcChannels,
  searchCandidateProfilesInputSchema,
  setBusinessPriorityOverrideInputSchema,
  submitCandidateMatchFeedbackInputSchema,
  updateCandidateProfileInputSchema
} from '@shared'
import { assertTrustedSender, type MainIpcContext } from './context'
import { deviceDeletionJournal } from '../deletion-journal'
import { currentOriginalOpenRoot, prepareOriginalOpenRoot } from '../original-open-root'

/** Candidate profile search, history, source documents, edits and permanent deletion. */
/** Decrypted originals opened for viewing, per person, until their timed cleanup or the person's deletion. */
const openedOriginals = new Map<string, string[]>()

export function registerCandidateHandlers(context: MainIpcContext) {
  const { repository, fileVault, userDataPath, currentOperator, currentMatchRuntimeIdentity, searchCandidates } = context
  ipcMain.handle(ipcChannels.searchCandidateProfiles, async (event, rawInput) => {
    assertTrustedSender(event)
    const input = searchCandidateProfilesInputSchema.parse(rawInput)
    if (input.sourceDocumentId) {
      const profile = repository.getCurrentCandidateProfile(input.sourceDocumentId)
      return searchConfirmedCandidateProfiles(profile ? [profile] : [], '', 1).map((candidate) => ({
        ...candidate,
        localIdentity: repository.getCandidateLocalIdentity(input.sourceDocumentId!)
      }))
    }
    return searchCandidates(input.query, input.maxResults)
  })

  ipcMain.handle(ipcChannels.submitCandidateMatchFeedback, (event, rawInput): SubmitCandidateMatchFeedbackResult => {
    assertTrustedSender(event)
    const input = submitCandidateMatchFeedbackInputSchema.parse(rawInput)
    return repository.submitCandidateMatchFeedback(input, currentOperator().displayName)
  })

  ipcMain.handle(ipcChannels.setBusinessPriorityOverride, (event, rawInput) => {
    assertTrustedSender(event)
    const input = setBusinessPriorityOverrideInputSchema.parse(rawInput)
    repository.setBusinessPriorityOverride(input, currentOperator().displayName)
    return repository.getMatchingHomeProjection(currentMatchRuntimeIdentity)
  })

  ipcMain.handle(ipcChannels.getCandidateProfileHistory, (event, rawSourceDocumentId) => {
    assertTrustedSender(event)
    const sourceDocumentId = candidateProfileSourceInputSchema.parse(rawSourceDocumentId)
    return repository.getCandidateProfileHistory(sourceDocumentId)
  })

  ipcMain.handle(ipcChannels.getOriginalDocumentPreview, (event, rawSourceDocumentId): OriginalDocumentPreview => {
    assertTrustedSender(event)
    const sourceDocumentId = candidateProfileSourceInputSchema.parse(rawSourceDocumentId)
    const document = repository.getParsedDocument(sourceDocumentId)
    const record = repository.getStagedFileRecords([sourceDocumentId])[0]
    if (!document || !record) throw new Error('原始ファイルを読み込めませんでした。')
    return buildOriginalDocumentPreview(
      document,
      repository.getCandidateLocalIdentity(sourceDocumentId),
      record.format === 'pdf' ? `ses-agent-original://document/${sourceDocumentId}` : null
    )
  })

  ipcMain.handle(ipcChannels.openOriginalDocument, async (event, rawSourceDocumentId): Promise<OpenOriginalDocumentResult> => {
    assertTrustedSender(event)
    const sourceDocumentId = candidateProfileSourceInputSchema.parse(rawSourceDocumentId)
    const record = repository.getStagedFileRecords([sourceDocumentId])[0]
    if (!record) throw new Error('原始ファイルが見つかりません。')
    const root = currentOriginalOpenRoot() ?? (await prepareOriginalOpenRoot(userDataPath))
    const temporaryDirectory = join(root, randomUUID())
    const temporaryPath = await fileVault.materializeTemporaryCopy(record, temporaryDirectory)
    // Remembered so deleting this person also removes the decrypted copy still waiting for its 30-minute cleanup.
    openedOriginals.set(sourceDocumentId, [...(openedOriginals.get(sourceDocumentId) ?? []), temporaryDirectory])
    // Gone from disk (opening failed, or the 30-minute cleanup ran): no longer reported as a copy to delete.
    const forget = () => {
      const left = (openedOriginals.get(sourceDocumentId) ?? []).filter((directory) => directory !== temporaryDirectory)
      if (left.length) openedOriginals.set(sourceDocumentId, left)
      else openedOriginals.delete(sourceDocumentId)
    }
    const error = await shell.openPath(temporaryPath)
    if (error) {
      await rm(temporaryDirectory, { recursive: true, force: true })
      forget()
      throw new Error(`原始ファイルをシステムアプリで開けませんでした: ${error}`)
    }
    const cleanup = setTimeout(() => {
      void rm(temporaryDirectory, { recursive: true, force: true }).then(forget, () => undefined)
    }, 30 * 60_000)
    cleanup.unref()
    return { opened: true, fileName: record.name, cleanup: 'scheduled' }
  })

  ipcMain.handle(ipcChannels.updateCandidateProfile, (event, rawInput): UpdateCandidateProfileResult => {
    assertTrustedSender(event)
    const input = updateCandidateProfileInputSchema.parse(rawInput)
    const operator = currentOperator()
    const profile = repository.updateCandidateProfile(input, operator.operatorId, operator.displayName)
    const history = repository.getCandidateProfileHistory(input.sourceDocumentId)
    const candidate = searchConfirmedCandidateProfiles([profile], '', 1)[0]
    if (!candidate) throw new Error('更新した人材プロフィールを再読み込みできませんでした。')
    return {
      candidate: {
        ...candidate,
        localIdentity: repository.getCandidateLocalIdentity(input.sourceDocumentId)
      },
      history
    }
  })

  ipcMain.handle(ipcChannels.previewCandidateDeletion, (event, rawSourceDocumentId) => {
    assertTrustedSender(event)
    const sourceDocumentId = candidateProfileSourceInputSchema.parse(rawSourceDocumentId)
    return repository.previewCandidateDeletion(sourceDocumentId)
  })

  ipcMain.handle(ipcChannels.deleteCandidateData, async (event, rawInput): Promise<DeleteCandidateDataResult> => {
    assertTrustedSender(event)
    const input = deleteCandidateDataInputSchema.parse(rawInput)
    const preview = repository.previewCandidateDeletion(input.sourceDocumentId)
    if (preview.confirmationHash !== input.confirmationHash) {
      throw new Error('削除対象が変更されました。影響を再確認してください。')
    }
    const stagedFile = repository.getStagedFileRecords([input.sourceDocumentId])[0]
    if (!stagedFile) throw new Error('削除対象の暗号化ファイルが見つかりません。')
    const deletionId = randomUUID()
    const startedAt = new Date()
    // Journaled before the delete (kept outside the database, so restoring an older backup deletes this person
    // again); confirmed once the delete succeeded, dropped if it did not.
    const journal = deviceDeletionJournal(userDataPath)
    const journalId = await journal
      .begin({ entityType: 'candidate', entityId: input.sourceDocumentId, deletedAt: startedAt.toISOString() })
      .catch(() => null)
    const quarantined = await fileVault.quarantineStagedFile(stagedFile, deletionId)
    try {
      repository.deleteCandidateDatabaseData(input.sourceDocumentId, input.confirmationHash, startedAt)
    } catch (error) {
      if (quarantined) await fileVault.restoreQuarantinedFile(quarantined)
      if (journalId) await journal.discard(journalId).catch(() => undefined)
      throw error
    }
    let fileVaultStatus: DataDeletionReport['components']['fileVault'] = quarantined ? 'deleted' : 'not_present'
    const recoveryPackageExists = Boolean(repository.getRecoveryState().lastBackupAt)
    // One or the other: no backup to rotate, or a backup that still holds this person.
    const warningCodes = [
      ...preview.warningCodes.filter((code) => !(recoveryPackageExists && code === 'BACKUP_SYSTEM_NOT_CONFIGURED')),
      ...(recoveryPackageExists ? ['RECOVERY_PACKAGE_ROTATION_REQUIRED'] : [])
    ]
    // Decrypted copies opened from the app (kept 30 minutes for the system viewer) go now.
    const openedCopies = openedOriginals.get(input.sourceDocumentId) ?? []
    openedOriginals.delete(input.sourceDocumentId)
    let temporaryFiles: DataDeletionReport['components']['temporaryFiles'] = 'not_present'
    for (const directory of openedCopies)
      await rm(directory, { recursive: true, force: true }).then(
        () => {
          if (temporaryFiles !== 'failed') temporaryFiles = 'deleted'
        },
        () => {
          temporaryFiles = 'failed'
          warningCodes.push('TEMPORARY_FILE_PURGE_FAILED')
        }
      )
    if (
      !journalId ||
      !(await journal.confirm(journalId).then(
        () => true,
        () => false
      ))
    )
      warningCodes.push('DELETION_JOURNAL_WRITE_FAILED')
    if (quarantined) {
      try {
        await fileVault.purgeQuarantinedFile(quarantined)
      } catch {
        fileVaultStatus = 'failed'
        warningCodes.push('FILE_VAULT_PURGE_FAILED')
      }
    }
    const completedAt = new Date()
    const report = repository.saveDataDeletionReport({
      id: deletionId,
      entityType: 'candidate',
      entityIdHash: createHash('sha256').update(input.sourceDocumentId).digest('hex'),
      requestedBy: currentOperator().displayName,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      outcome: fileVaultStatus === 'failed' ? 'partial-failure' : 'completed',
      components: {
        database: 'deleted',
        fileVault: fileVaultStatus,
        searchIndex: preview.counts.searchIndexEntries > 0 ? 'deleted' : 'not_present',
        cache: 'not_present',
        temporaryFiles,
        backups: recoveryPackageExists ? 'expired_pending' : 'not_present'
      },
      deletedCounts: preview.counts,
      warningCodes: [...new Set(warningCodes)]
    })
    return {
      report,
      activeCandidateCount: repository.countEligibleTalentProfiles()
    }
  })

  ipcMain.handle(ipcChannels.listDataDeletionReports, (event) => {
    assertTrustedSender(event)
    return repository.listDataDeletionReports()
  })
}
