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
  prepareCaseIntroductionInputSchema,
  recordCaseBroadcastCopyInputSchema,
  updateBroadcastTemplateInputSchema,
  type BroadcastWorkspace,
  type CaseBroadcastHistoryEntry,
  type DraftCaseBroadcastResult,
  type DraftCaseUpdateNoticeResult,
  type JobCaseReviewSnapshot,
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
import { autoConfirmJobCaseDraft } from '../business-text-intake'

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

  ipcMain.handle(ipcChannels.prepareCaseIntroduction, (event, rawInput): JobCaseReviewSnapshot => {
    assertTrustedSender(event)
    const input = prepareCaseIntroductionInputSchema.parse(rawInput)
    const review = repository.getJobCaseReview(input.reviewId)
    if (!review) throw new Error('案件レコードが見つかりません。')
    if (review.lifecycle !== 'active') throw new Error('無効になった案件は紹介できません。')
    if (review.reviewRevision !== input.expectedReviewRevision) throw new Error('案件資料が更新されました。紹介画面を開き直してください。')
    if (review.status === 'completed' && review.jobCase) return review
    // Old Gmail drafts follow the same local preparation as newly imported cases.
    const prepared = autoConfirmJobCaseDraft(repository, review, currentOperator())
    if (!prepared.review?.jobCase) throw new Error(prepared.reason ?? '案件情報を準備できませんでした。')
    return prepared.review
  })

  ipcMain.handle(ipcChannels.draftCaseUpdateNotice, (event, rawInput): DraftCaseUpdateNoticeResult => {
    assertTrustedSender(event)
    return draftCaseUpdateNotice(repository, draftCaseUpdateNoticeInputSchema.parse(rawInput))
  })

  ipcMain.handle(ipcChannels.validateCaseBroadcastMessage, (event, rawInput) => {
    assertTrustedSender(event)
    const input = recordCaseBroadcastCopyInputSchema.parse(rawInput)
    prepareCaseBroadcastEmail(repository, input)
    return input
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
