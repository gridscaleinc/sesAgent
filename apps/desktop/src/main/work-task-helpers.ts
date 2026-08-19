import { createHash } from 'node:crypto'

import { createWorkTaskPreview, getDataScope, recordResumeImportReviewState } from '@application'
import type { WorkTask, WorkTaskPreview } from '@domain'
import { EncryptedApplicationRepository } from '@persistence'
import type { workTaskInputSchema } from '@shared'

export function previewHash(preview: WorkTaskPreview): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        instruction: preview.instruction,
        scopeId: preview.scope.id,
        type: preview.type,
        policyVersion: preview.privacy.policyVersion,
        contextBindings: preview.contextBindings
      })
    )
    .digest('hex')
}

export function assertWorkTaskAllowsExecution(task: WorkTask): void {
  if (task.status === 'cancelled' || task.status === 'failed') {
    throw new Error('この作業は停止しています。再実行してから操作してください。')
  }
}

export function synchronizeImportTask(
  repository: EncryptedApplicationRepository,
  task: WorkTask,
  now = new Date(),
  approvedBy = '本機ユーザー'
): WorkTask {
  if (task.type !== 'IMPORT_RESUME' || task.status === 'cancelled' || task.status === 'failed') return task
  const fileBindings = task.contextBindings.filter((binding) => binding.objectType === 'staged-file')
  if (fileBindings.length === 0 || fileBindings.some((binding) => !repository.getResumeAnalysis(binding.objectId))) return task
  const reviews = fileBindings.map((binding) => repository.getCandidateReview(binding.objectId))
  const completed = reviews.every((review) => review?.status === 'completed')
  const evidenceCount = completed ? fileBindings.length * 11 : Math.max(1, fileBindings.length * 3)
  const unchanged =
    task.status === (completed ? 'completed' : 'awaiting_review') &&
    task.progress === (completed ? 100 : 75) &&
    task.evidenceCount === evidenceCount &&
    task.steps.every((step, index) => step.status === (completed ? 'completed' : index < 3 ? 'completed' : 'blocked'))
  return unchanged ? task : recordResumeImportReviewState(
    task,
    completed,
    evidenceCount,
    completed ? reviews.flatMap((review) => review?.profile?.id ? [review.profile.id] : []) : [],
    now,
    approvedBy
  )
}

export function createVerifiedPreview(
  repository: EncryptedApplicationRepository,
  input: ReturnType<typeof workTaskInputSchema.parse>
): WorkTaskPreview {
  const files = repository.getStagedFiles(input.fileTokens)
  if (files.length !== input.fileTokens.length) throw new Error('選択したファイルが見つからないか、期限切れです。')
  if (input.scopeId === 'selected-files' && files.length === 0) {
    throw new Error('ローカルファイルを1件以上選択してください。')
  }
  if (input.scopeId !== 'selected-files' && files.length > 0) {
    throw new Error('ファイルトークンとデータ範囲が一致しません。')
  }
  if ((input.scopeId === 'selected-case') !== Boolean(input.jobCaseId)) {
    throw new Error('選択案件の範囲と案件IDが一致しません。')
  }
  const fileBindings = files.map((file) => ({
    objectType: 'staged-file' as const,
    objectId: file.token,
    version: file.sha256
  }))
  const selectedJobCase = input.jobCaseId
    ? repository.listActiveJobCases().find((jobCase) => jobCase.id === input.jobCaseId) ?? null
    : null
  if (input.jobCaseId && !selectedJobCase) throw new Error('選択した確認済み案件は利用できません。')
  const contextBindings = selectedJobCase
    ? [{ objectType: 'job-case' as const, objectId: selectedJobCase.id, version: String(selectedJobCase.version) }]
    : fileBindings
  const preview = createWorkTaskPreview(input.instruction, getDataScope(input.scopeId), contextBindings)
  if (files.length > 0 && preview.type !== 'IMPORT_RESUME') {
    throw new Error('添付ファイルは現在スキルシート取込タスクだけで使用できます。作業内容を確認してください。')
  }
  if (selectedJobCase && preview.type !== 'MATCH_CANDIDATES') {
    throw new Error('選択案件は候補者マッチング作業だけに使用できます。')
  }
  return preview
}
