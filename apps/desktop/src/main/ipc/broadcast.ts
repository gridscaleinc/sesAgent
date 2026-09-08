import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { EncryptedApplicationRepository } from '@persistence'
import {
  createBroadcastTemplateInputSchema,
  deleteBroadcastTemplateInputSchema,
  draftCaseBroadcastInputSchema,
  draftCaseUpdateNoticeInputSchema,
  ipcChannels,
  jobCaseReviewIdSchema,
  openCaseBroadcastEmailInputSchema,
  recordCaseBroadcastCopyInputSchema,
  updateBroadcastTemplateInputSchema,
  type BroadcastWorkspace,
  type CaseBroadcastHistoryEntry,
  type DraftCaseBroadcastResult,
  type DraftCaseUpdateNoticeResult,
  type OpenCaseBroadcastEmailResult,
  type RecordCaseBroadcastCopyResult
} from '@shared'
import {
  draftCaseBroadcast,
  draftCaseUpdateNotice,
  loadBroadcastWorkspace,
  loadCaseBroadcastHistory,
  prepareCaseBroadcastEmail,
  recordCaseBroadcastCopy
} from '../broadcast-service'

/**
 * Only what 案件配信 needs. The trust check arrives as a dependency rather than
 * an import so these handlers can be exercised without constructing the whole
 * Electron main context.
 */
export interface BroadcastIpcDependencies {
  repository: EncryptedApplicationRepository
  currentOperator(): { operatorId: string; displayName: string }
  assertTrustedSender(event: IpcMainInvokeEvent): void
  openExternal(url: string): Promise<void>
}

/**
 * 案件配信: queue, message drafting, the append-only copy log and templates.
 * Every rule these handlers enforce lives in broadcast-service, which the
 * conversational tools call too, so the two surfaces cannot drift.
 */
export function registerBroadcastHandlers(dependencies: BroadcastIpcDependencies) {
  const { repository, currentOperator, assertTrustedSender } = dependencies

  ipcMain.handle(ipcChannels.listBroadcastWorkspace, (event): BroadcastWorkspace => {
    assertTrustedSender(event)
    return loadBroadcastWorkspace(repository)
  })

  ipcMain.handle(ipcChannels.draftCaseBroadcast, (event, rawInput): DraftCaseBroadcastResult => {
    assertTrustedSender(event)
    return draftCaseBroadcast(repository, draftCaseBroadcastInputSchema.parse(rawInput))
  })

  ipcMain.handle(ipcChannels.draftCaseUpdateNotice, (event, rawInput): DraftCaseUpdateNoticeResult => {
    assertTrustedSender(event)
    return draftCaseUpdateNotice(repository, draftCaseUpdateNoticeInputSchema.parse(rawInput))
  })

  ipcMain.handle(ipcChannels.recordCaseBroadcastCopy, (event, rawInput): RecordCaseBroadcastCopyResult => {
    assertTrustedSender(event)
    return recordCaseBroadcastCopy(repository, currentOperator(), recordCaseBroadcastCopyInputSchema.parse(rawInput))
  })

  ipcMain.handle(ipcChannels.openCaseBroadcastEmail, async (event, rawInput): Promise<OpenCaseBroadcastEmailResult> => {
    assertTrustedSender(event)
    const prepared = prepareCaseBroadcastEmail(repository, openCaseBroadcastEmailInputSchema.parse(rawInput))
    await dependencies.openExternal(prepared.mailtoUrl)
    return { opened: true }
  })

  ipcMain.handle(ipcChannels.listCaseBroadcasts, (event, rawReviewId): CaseBroadcastHistoryEntry[] => {
    assertTrustedSender(event)
    return loadCaseBroadcastHistory(repository, jobCaseReviewIdSchema.parse(rawReviewId))
  })

  ipcMain.handle(ipcChannels.createBroadcastTemplate, (event, rawInput) => {
    assertTrustedSender(event)
    return repository.createBroadcastTemplate(createBroadcastTemplateInputSchema.parse(rawInput))
  })

  ipcMain.handle(ipcChannels.updateBroadcastTemplate, (event, rawInput) => {
    assertTrustedSender(event)
    return repository.updateBroadcastTemplate(updateBroadcastTemplateInputSchema.parse(rawInput))
  })

  ipcMain.handle(ipcChannels.deleteBroadcastTemplate, (event, rawInput) => {
    assertTrustedSender(event)
    return repository.deleteBroadcastTemplate(deleteBroadcastTemplateInputSchema.parse(rawInput))
  })
}
