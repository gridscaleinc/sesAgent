import { createHash, randomUUID } from 'node:crypto'
import { rename, unlink, writeFile } from 'node:fs/promises'
import { basename, normalize } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import {
  recordProposalApproved,
  recordProposalDraftCreated,
  recordProposalExportFailure,
  recordProposalExportStarted,
  recordProposalExported,
  recordProposalFollowUp
} from '@application'
import { buildProposalPackageZip, proposalAttachmentHtml } from '@proposals'
import {
  type ExportProposalPackageResult,
  type ProposalDraftSnapshot,
  type ProposalMutationResult,
  type ProposalWorkspaceSnapshot,
  approveProposalDraftInputSchema,
  createProposalDraftInputSchema,
  exportProposalPackageInputSchema,
  exportSkillSheetInputSchema,
  isInactiveProgressStage,
  ipcChannels,
  proposalTaskIdSchema,
  recordProposalFollowUpInputSchema,
  updateProposalDraftInputSchema
} from '@shared'
import { exportSkillSheet } from '../skill-sheet-export'
import { assertWorkTaskAllowsExecution } from '../work-task-helpers'
import { rejectedByHr } from '../work-rule-matching'
import { assertTrustedSender, type MainIpcContext } from './context'

async function renderProposalAttachmentPdf(draft: ProposalDraftSnapshot): Promise<Buffer> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    const html = proposalAttachmentHtml(draft)
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await window.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
  } finally {
    window.destroy()
  }
}

async function buildProposalPackage(
  draft: ProposalDraftSnapshot,
  now = new Date()
): Promise<{
  bytes: Buffer
  packageHash: string
}> {
  const attachmentPdf = await renderProposalAttachmentPdf(draft)
  return buildProposalPackageZip(draft, attachmentPdf, now)
}

/** Proposal drafting, approval, package export and post-export follow-up. */
export function registerProposalHandlers(context: MainIpcContext) {
  const { repository, processingResources, currentOperator, preflightAction, withTaskOperation } = context
  const proposalMutations = new Set<string>()
  const withProposalMutation = async <T>(key: string, operation: () => Promise<T> | T): Promise<T> => {
    if (proposalMutations.has(key)) throw new Error('同じ提案に対する別の処理が進行中です。')
    proposalMutations.add(key)
    try {
      return await operation()
    } finally {
      proposalMutations.delete(key)
    }
  }

  // The introduction composer's redacted skill sheet; one export at a time per person.
  ipcMain.handle(ipcChannels.exportSkillSheet, async (event, rawInput) => {
    assertTrustedSender(event)
    const input = exportSkillSheetInputSchema.parse(rawInput)
    return withProposalMutation(`skill-sheet:${input.documentId}`, () =>
      exportSkillSheet(context, BrowserWindow.fromWebContents(event.sender), input)
    )
  })

  ipcMain.handle(ipcChannels.getProposalWorkspace, (event, rawTaskId): ProposalWorkspaceSnapshot => {
    assertTrustedSender(event)
    return repository.getProposalWorkspace(proposalTaskIdSchema.parse(rawTaskId))
  })

  /** A pair HR judged 不满足 gets no proposal either, as no introduction or recommendation from any entry. */
  const assertNotRejectedByHr = (draft: { candidateProfileId: string; jobCaseId: string }) => {
    const documentId = repository.getCandidateSourceDocumentId(draft.candidateProfileId)
    const reviewId =
      repository.listActiveJobCases().find((job) => job.id === draft.jobCaseId)?.sourceReviewId ??
      repository.listJobCaseReviews().find((review) => review.jobCase?.id === draft.jobCaseId)?.reviewId
    if (documentId && reviewId && rejectedByHr(repository, documentId, reviewId))
      throw new Error(
        '这个人员已被判定不满足该案件的要求，不能提案；如判断有变，请先在匹配中撤回「不满足」。 / この要員は案件の条件を満たさないと判断済みのため提案できません。判断が変わった場合は「満たさない」を取り消してください。'
      )
  }

  ipcMain.handle(ipcChannels.createProposalDraft, async (event, rawInput): Promise<ProposalMutationResult> => {
    assertTrustedSender(event)
    const input = createProposalDraftInputSchema.parse(rawInput)
    return withTaskOperation(input.taskId, () =>
      withProposalMutation(`task:${input.taskId}`, () => {
        const task = repository.getWorkTask(input.taskId)
        if (!task) throw new Error('提案タスクが見つかりません。')
        assertWorkTaskAllowsExecution(task)
        assertNotRejectedByHr({ candidateProfileId: input.candidateProfileId, jobCaseId: input.jobCaseId })
        const draft = repository.createProposalDraft(input, randomUUID(), currentOperator().displayName)
        const updatedTask = recordProposalDraftCreated(task, draft.attachment.fields.length + 2, new Date(), {
          objectId: draft.id,
          contentHash: draft.contentHash
        })
        repository.saveWorkTask(updatedTask)
        return { draft, task: updatedTask }
      })
    )
  })

  ipcMain.handle(ipcChannels.updateProposalDraft, async (event, rawInput): Promise<ProposalMutationResult> => {
    assertTrustedSender(event)
    const input = updateProposalDraftInputSchema.parse(rawInput)
    const currentDraft = repository.getProposalDraft(input.draftId)
    if (!currentDraft) throw new Error('提案草稿が見つかりません。')
    return withTaskOperation(currentDraft.taskId, () =>
      withProposalMutation(input.draftId, () => {
        const task = repository.getWorkTask(currentDraft.taskId)
        if (!task) throw new Error('提案タスクが見つかりません。')
        assertWorkTaskAllowsExecution(task)
        const draft = repository.updateProposalDraft(input, currentOperator().displayName)
        const updatedTask = recordProposalDraftCreated(task, draft.attachment.fields.length + 2, new Date(), {
          objectId: draft.id,
          contentHash: draft.contentHash
        })
        repository.saveWorkTask(updatedTask)
        return { draft, task: updatedTask }
      })
    )
  })

  ipcMain.handle(ipcChannels.approveProposalDraft, async (event, rawInput): Promise<ProposalMutationResult> => {
    assertTrustedSender(event)
    const input = approveProposalDraftInputSchema.parse(rawInput)
    const currentDraft = repository.getProposalDraft(input.draftId)
    if (!currentDraft) throw new Error('提案草稿が見つかりません。')
    return withTaskOperation(currentDraft.taskId, () =>
      withProposalMutation(input.draftId, () => {
        const task = repository.getWorkTask(currentDraft.taskId)
        if (!task) throw new Error('提案タスクが見つかりません。')
        assertWorkTaskAllowsExecution(task)
        const operator = currentOperator()
        assertNotRejectedByHr(currentDraft)
        const draft = repository.approveProposalDraft(input, operator.displayName)
        const updatedTask = recordProposalApproved(task, new Date(), operator.displayName)
        repository.saveWorkTask(updatedTask)
        return { draft, task: updatedTask }
      })
    )
  })

  ipcMain.handle(ipcChannels.exportProposalPackage, async (event, rawInput): Promise<ExportProposalPackageResult> => {
    assertTrustedSender(event)
    const input = exportProposalPackageInputSchema.parse(rawInput)
    const currentDraft = repository.getProposalDraft(input.draftId)
    if (!currentDraft) throw new Error('提案草稿が見つかりません。')
    return withTaskOperation(currentDraft.taskId, () =>
      withProposalMutation(input.draftId, async () => {
        const draft = repository.getProposalDraft(input.draftId)
        if (!draft) throw new Error('提案草稿が見つかりません。')
        if (
          draft.revision !== input.revision ||
          draft.contentHash !== input.contentHash ||
          draft.approvedContentHash !== draft.contentHash ||
          !['approved', 'exported'].includes(draft.status)
        ) {
          throw new Error('現在の提案内容を承認してからエクスポートしてください。')
        }
        const task = repository.getWorkTask(draft.taskId)
        if (!task) throw new Error('提案タスクが見つかりません。')
        assertWorkTaskAllowsExecution(task)
        const actionRunId = preflightAction(
          'proposal.export',
          {
            origin: 'work-task',
            workTaskId: task.id,
            scopeId: task.scope.id,
            scopeFingerprint: draft.contentHash,
            actorId: currentOperator().operatorId,
            contentRevision: `${draft.revision}:${draft.contentHash}`
          },
          { taskId: task.id, draftId: draft.id, revision: draft.revision, contentHash: draft.contentHash },
          '承認済み提案パッケージを、保存先の選択後に端末へ書き出します。',
          `proposal-export:${randomUUID()}`
        )
        const owner = BrowserWindow.fromWebContents(event.sender)
        const defaultName = `proposal-${draft.id.slice(0, 8)}.zip`
        const saveOptions = {
          title: '承認済み提案パッケージを保存',
          defaultPath: defaultName,
          buttonLabel: '提案パッケージを書き出す',
          filters: [{ name: '提案パッケージ', extensions: ['zip'] }]
        }
        const selection = owner ? await dialog.showSaveDialog(owner, saveOptions) : await dialog.showSaveDialog(saveOptions)
        if (selection.canceled || !selection.filePath) {
          repository.updateActionRun(actionRunId, 'cancelled', { errorCode: 'NATIVE_SAVE_CANCELLED' })
          return { draft, task, cancelled: true, processingJob: null, export: null }
        }

        const exportId = randomUUID()
        const targetPathHash = createHash('sha256').update(normalize(selection.filePath)).digest('hex')
        const requestFingerprint = createHash('sha256')
          .update(
            JSON.stringify({
              version: 'proposal-export-job-v1',
              taskId: task.id,
              draftId: draft.id,
              revision: draft.revision,
              contentHash: draft.contentHash,
              targetPathHash
            })
          )
          .digest('hex')
        const idempotencyKey = createHash('sha256').update(`proposal-export:${exportId}:${requestFingerprint}`).digest('hex')
        let processingJob = repository.enqueueProcessingJob({
          type: 'proposal-export',
          workTaskId: task.id,
          taskStepId: task.steps[3]?.id ?? 'step-4',
          idempotencyKey,
          requestFingerprint,
          payloadRef: `proposal-draft:${draft.id}:export:${exportId}`,
          replayPolicy: 'manual-review',
          maxAttempts: 1
        })
        repository.updateActionRun(actionRunId, 'running', { processingJobId: processingJob.id })
        return processingResources.run('file-export', async () => {
          processingJob = repository.getProcessingJob(processingJob.id) ?? processingJob
          const lease = repository.acquireProcessingJob(processingJob.id, 10 * 60_000)
          if (!lease) throw new Error('提案書き出しジョブを開始できませんでした。内容を再確認してください。')
          const latestTaskBeforeStart = repository.getWorkTask(task.id)
          if (!latestTaskBeforeStart) throw new Error('提案タスクが見つかりません。')
          assertWorkTaskAllowsExecution(latestTaskBeforeStart)
          const startedTask = recordProposalExportStarted(latestTaskBeforeStart, lease.job.attemptCount)
          repository.saveWorkTask(startedTask)
          processingJob = repository.updateProcessingJobProgress(processingJob.id, lease.leaseToken, 15)
          const temporaryPath = `${selection.filePath}.${randomUUID()}.tmp`
          let exportPrepared = false
          let filesystemCommitted = false
          let domainCommitted = false
          try {
            const packageData = await buildProposalPackage(draft)
            processingJob = repository.updateProcessingJobProgress(processingJob.id, lease.leaseToken, 55)
            if (repository.isProcessingJobCancellationRequested(processingJob.id, lease.leaseToken)) {
              repository.completeProcessingJob(processingJob.id, lease.leaseToken, { cancelled: true })
              throw new Error('提案書き出しジョブをキャンセルしました。')
            }
            repository.beginProposalExport(
              draft.id,
              draft.revision,
              draft.contentHash,
              exportId,
              targetPathHash,
              currentOperator().displayName
            )
            exportPrepared = true
            await writeFile(temporaryPath, packageData.bytes, { mode: 0o600 })
            await rename(temporaryPath, selection.filePath)
            filesystemCommitted = true
            const exported = repository.completeProposalExport(
              exportId,
              draft.id,
              draft.contentHash,
              packageData.packageHash,
              currentOperator().displayName
            )
            domainCommitted = true
            const completion = repository.completeProcessingJob(processingJob.id, lease.leaseToken, {
              version: 'proposal-export-job-result-v1',
              exportId,
              packageHash: packageData.packageHash,
              deliveryState: 'exported-not-sent'
            })
            if (!completion.accepted) {
              throw new Error('提案書き出しの完了前にキャンセル要求を検出しました。保存先を確認してください。')
            }
            processingJob = completion.job
            const updatedTask = recordProposalExported(startedTask, new Date(), {
              objectId: exportId,
              contentHash: packageData.packageHash
            })
            repository.saveWorkTask(updatedTask)
            repository.updateActionRun(actionRunId, 'succeeded', { processingJobId: processingJob.id, resultHash: packageData.packageHash })
            return {
              draft: exported,
              task: updatedTask,
              cancelled: false,
              processingJob,
              export: {
                fileName: basename(selection.filePath),
                packageHash: packageData.packageHash,
                exportedAt: exported.exportedAt ?? exported.updatedAt,
                deliveryState: 'exported-not-sent'
              }
            }
          } catch (cause) {
            await unlink(temporaryPath).catch(() => undefined)
            const errorCode = filesystemCommitted ? 'PROPOSAL_EXPORT_OUTCOME_UNKNOWN' : 'LOCAL_EXPORT_FAILED'
            const activeJob = repository.getProcessingJob(processingJob.id)
            if (activeJob?.status === 'running') {
              processingJob = repository.failProcessingJob(processingJob.id, lease.leaseToken, errorCode, false)
            }
            const latestTask = repository.getWorkTask(task.id)
            if (latestTask && latestTask.status !== 'completed' && latestTask.status !== 'cancelled') {
              repository.saveWorkTask(recordProposalExportFailure(latestTask, errorCode))
            }
            if (filesystemCommitted && !domainCommitted) {
              repository.markProposalExportOutcomeUnknown(exportId, draft.id, currentOperator().displayName)
              throw new Error('ファイルは書き出された可能性がありますが、記録を確定できませんでした。内容を再確認してください。', { cause })
            }
            if (filesystemCommitted) {
              throw new Error(
                'ファイルは書き出され、記録も保存されましたが、作業ジョブを確定できませんでした。保存先を確認してください。',
                { cause }
              )
            }
            if (exportPrepared) repository.failProposalExport(exportId, draft.id, 'LOCAL_EXPORT_FAILED', currentOperator().displayName)
            repository.updateActionRun(actionRunId, processingJob.status === 'cancelled' ? 'cancelled' : 'failed', {
              processingJobId: processingJob.id,
              errorCode
            })
            throw new Error('提案パッケージを書き出せませんでした。', { cause })
          }
        })
      })
    )
  })

  /**
   * A proposal sent from here is the same 推荐 as one sent from 找人: it opens (or keeps) the pair's 跟进 at 已推荐,
   * so it counts in this week's numbers and HR continues interviews and the start there. Best effort: an ended case,
   * a person judged 不满足 or one not being offered simply keeps the proposal record only.
   */
  /**
   * A proposal result recorded here is the pair's 跟进 too: sent and later stages record 已推荐 (opening the follow-up
   * if needed, counted in this week's numbers); declined or withdrawn ends a follow-up still under way. Returns why it
   * could not be carried over, so HR is told instead of the two drifting apart silently.
   */
  const syncFollowUp = (draft: { candidateProfileId: string; jobCaseId: string }, stage: string, actor: string): string | undefined => {
    try {
      const documentId = repository.getCandidateSourceDocumentId(draft.candidateProfileId)
      const reviewId =
        repository.listActiveJobCases().find((job) => job.id === draft.jobCaseId)?.sourceReviewId ??
        repository.listJobCaseReviews().find((review) => review.jobCase?.id === draft.jobCaseId)?.reviewId
      if (!documentId || !reviewId)
        return '人员或案件已不存在，跟进未更新。 / 要員または案件が見つからないため、対応記録は更新していません。'
      const existing = repository.listBusinessFollowUps().find((row) => row.documentId === documentId && row.reviewId === reviewId)
      if (stage === 'declined' || stage === 'withdrawn') {
        // A paused one ends too: the client said no, so it is not resumed for this proposal.
        if (!existing?.progress || (isInactiveProgressStage(existing.progress.stage) && existing.progress.stage !== 'paused'))
          return undefined
        repository.advanceBusinessProgress(
          {
            documentId,
            reviewId,
            expectedRevision: existing.revision,
            mutationId: randomUUID(),
            action: 'close',
            reason: stage === 'declined' ? '客户拒绝（提案记录） / 顧客見送り（提案記録）' : '撤回提案 / 提案取り下げ'
          },
          actor
        )
        return undefined
      }
      if (rejectedByHr(repository, documentId, reviewId))
        return '此人员已被判定不满足该案件，跟进未记为已推荐。 / 案件の条件を満たさないと判断済みのため、推薦済みにしていません。'
      repository.advanceBusinessProgress(
        { documentId, reviewId, expectedRevision: existing?.revision ?? 0, mutationId: randomUUID(), action: 'recommend' },
        actor
      )
      return undefined
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ''
      return `跟进未更新：${message.split(' / ')[0] || '请在跟进中手动记录。'} / 対応記録は更新されていません。`
    }
  }

  ipcMain.handle(ipcChannels.recordProposalFollowUp, async (event, rawInput): Promise<ProposalMutationResult> => {
    assertTrustedSender(event)
    const input = recordProposalFollowUpInputSchema.parse(rawInput)
    const currentDraft = repository.getProposalDraft(input.draftId)
    if (!currentDraft) throw new Error('提案草稿が見つかりません。')
    return withTaskOperation(currentDraft.taskId, () =>
      withProposalMutation(input.draftId, () => {
        const draftBeforeMutation = repository.getProposalDraft(input.draftId)
        if (!draftBeforeMutation) throw new Error('提案草稿が見つかりません。')
        const task = repository.getWorkTask(draftBeforeMutation.taskId)
        if (!task) throw new Error('提案タスクが見つかりません。')
        assertWorkTaskAllowsExecution(task)
        const operator = currentOperator()
        const now = new Date()
        const draft = repository.recordProposalFollowUp(input, randomUUID(), operator.displayName, now)
        const updatedTask = recordProposalFollowUp(task, input.stage, now, operator.displayName)
        repository.saveWorkTask(updatedTask)
        const followUpNote = syncFollowUp(draft, input.stage, operator.displayName)
        return { draft, task: updatedTask, ...(followUpNote ? { followUpNote } : {}) }
      })
    )
  })
}
