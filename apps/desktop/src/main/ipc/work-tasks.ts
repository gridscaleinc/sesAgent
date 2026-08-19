import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { cancelWorkTask, materializeWorkTask, retryWorkTask } from '@application'
import { type SignedWorkTaskPreview, type WorkTask } from '@domain'
import {
  createWorkTaskInputSchema,
  ipcChannels,
  setWorkTaskLifecycleInputSchema,
  workTaskInputSchema
} from '@shared'
import { createVerifiedPreview, previewHash, synchronizeImportTask } from '../work-task-helpers'
import { assertTrustedSender, type MainIpcContext } from './context'

/** Work task preview, creation and lifecycle transitions. */
export function registerWorkTaskHandlers(context: MainIpcContext) {
  const { repository, currentOperator, withTaskOperation, hasActiveTaskOperation, wakeDispatcher } = context
  ipcMain.handle(ipcChannels.previewWorkTask, (event, rawInput): SignedWorkTaskPreview => {
    assertTrustedSender(event)
    const input = workTaskInputSchema.parse(rawInput)
    const preview = createVerifiedPreview(repository, input)
    return { ...preview, previewHash: previewHash(preview) }
  })

  ipcMain.handle(ipcChannels.createWorkTask, (event, rawInput): WorkTask => {
    assertTrustedSender(event)
    const input = createWorkTaskInputSchema.parse(rawInput)
    const preview = createVerifiedPreview(repository, input)
    if (previewHash(preview) !== input.previewHash) {
      throw new Error('作業プレビューが変更されています。もう一度確認してください。')
    }

    const now = new Date().toISOString()
    const plannedTask = materializeWorkTask(preview, randomUUID(), now)
    const task = plannedTask
    repository.saveWorkTask(task)
    return task
  })

  ipcMain.handle(ipcChannels.setWorkTaskLifecycle, async (event, rawInput): Promise<WorkTask> => {
    assertTrustedSender(event)
    const input = setWorkTaskLifecycleInputSchema.parse(rawInput)
    if (input.action === 'cancel') {
      const current = repository.getWorkTask(input.taskId)
      if (!current) throw new Error('作業が見つかりません。')
      if (current.updatedAt !== input.expectedUpdatedAt && current.status !== 'running') {
        throw new Error('作業が更新されました。再読み込みしてから操作してください。')
      }
      const task = cancelWorkTask(current)
      const jobs = repository.listProcessingJobs(input.taskId)
      const cancellableSafeLocalOperation = jobs.some((job) =>
        job.replayPolicy === 'safe-local' && ['queued', 'running', 'retry_wait'].includes(job.status)
      )
      if (hasActiveTaskOperation(input.taskId) && !cancellableSafeLocalOperation) {
        throw new Error('ファイル書き出し等の処理中はキャンセルできません。完了後にもう一度操作してください。')
      }
      repository.requestProcessingJobCancellationForTask(input.taskId)
      repository.cancelPendingActionApprovalsForTask(input.taskId)
      repository.saveWorkTask(task)
      return task
    }
    return withTaskOperation(input.taskId, () => {
      const current = repository.getWorkTask(input.taskId)
      if (!current) throw new Error('作業が見つかりません。')
      if (current.updatedAt !== input.expectedUpdatedAt) {
        throw new Error('作業が更新されました。再読み込みしてから操作してください。')
      }
      const transitioned = retryWorkTask(current)
      repository.retryProcessingJobsForTask(input.taskId)
      const task = synchronizeImportTask(repository, transitioned, new Date(), currentOperator().displayName)
      repository.saveWorkTask(task)
      wakeDispatcher()
      return task
    })
  })
}
