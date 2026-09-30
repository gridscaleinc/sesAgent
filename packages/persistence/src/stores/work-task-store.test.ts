// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkTaskPreview, materializeWorkTask } from '@application'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'

function task(id: string, text = 'JavaとAWSの候補者を検索したい', createdAt = '2026-09-01T00:00:00.000Z') {
  return materializeWorkTask(createWorkTaskPreview(text), id, createdAt)
}

describe.skipIf(!nativeSqliteAvailable)('WorkTaskStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  it('saves, lists newest first, upserts in place, and survives reopen', () => {
    const { repository } = handle
    const older = task('task-a', 'JavaとAWSの候補者を検索したい', '2026-09-01T00:00:00.000Z')
    const newer = task('task-b', '確認済み案件と候補者から提案メール下書きを準備したい', '2026-09-02T00:00:00.000Z')
    repository.saveWorkTask(older)
    repository.saveWorkTask(newer)
    expect(repository.countWorkTasks()).toBe(2)
    expect(repository.listWorkTasks().map((item) => item.id)).toEqual(['task-b', 'task-a'])

    const revisionBefore = repository.getLocalDataRevision().revision
    repository.saveWorkTask({ ...older, title: '更新後のタスク', updatedAt: '2026-09-03T00:00:00.000Z' })
    expect(repository.countWorkTasks()).toBe(2)
    expect(repository.getLocalDataRevision().revision).toBeGreaterThan(revisionBefore)
    const reopened = handle.reopen()
    expect(reopened.getWorkTask('task-a')).toMatchObject({ id: 'task-a', title: '更新後のタスク' })
    expect(reopened.listWorkTasks()[0]?.id).toBe('task-a')
    expect(reopened.getWorkTask('missing')).toBeNull()
  })

  it('rejects a task that fails the shared schema and leaves nothing behind', () => {
    const { repository } = handle
    const valid = task('task-invalid')
    expect(() => repository.saveWorkTask({ ...valid, status: 'not-a-status' } as never)).toThrow()
    expect(repository.getWorkTask('task-invalid')).toBeNull()
    expect(repository.countWorkTasks()).toBe(0)
  })
})
