import { describe, expect, it, vi } from 'vitest'

vi.mock('@platform', () => ({ SafeStorageJsonCredentialVault: class {} }))

import { randomUUID } from 'node:crypto'
import {
  DeletionJournal,
  deletionJournalLimit,
  reapplyDeletions,
  type DeletionJournalData,
  type DeletionJournalStore
} from './deletion-journal'

const memoryStore = (): DeletionJournalStore & { data: DeletionJournalData | null } => {
  const store = {
    data: null as DeletionJournalData | null,
    load: async () => store.data,
    save: async (value: DeletionJournalData) => {
      store.data = value
    }
  }
  return store
}
const personId = '11111111-1111-4111-8111-111111111111'
const caseId = '22222222-2222-4222-8222-222222222222'
const goneId = '33333333-3333-4333-8333-333333333333'

describe('deletion journal', () => {
  it('keeps every deletion, also two recorded at once, and tells which came after a backup', async () => {
    const journal = new DeletionJournal(memoryStore())
    await Promise.all([
      journal.record({ entityType: 'candidate', entityId: personId, deletedAt: '2026-09-01T00:00:00.000Z' }),
      journal.record({ entityType: 'job-case', entityId: caseId, deletedAt: '2026-09-20T00:00:00.000Z' })
    ])
    expect((await journal.entries()).map((entry) => entry.entityId)).toEqual([personId, caseId])
    expect((await journal.recordedAfter('2026-09-10T00:00:00.000Z')).map((entry) => entry.entityId)).toEqual([caseId])
  })

  it('deletes again what a restored backup brought back, with its file, and tombstones the mail again', async () => {
    const journal = new DeletionJournal(memoryStore())
    await journal.record({ entityType: 'candidate', entityId: personId, deletedAt: '2026-09-01T00:00:00.000Z' })
    await journal.record({ entityType: 'candidate', entityId: goneId, deletedAt: '2026-09-02T00:00:00.000Z' })
    await journal.record({
      entityType: 'job-case',
      entityId: caseId,
      deletedAt: '2026-09-03T00:00:00.000Z',
      gmailTombstones: [{ accountEmail: 'sales@example.test', gmailMessageId: 'm1' }]
    })
    const file = { token: personId, encryptedPath: '/vault/x.sesv' }
    const quarantined = { token: personId, originalPath: '/vault/x.sesv', quarantinePath: '/vault/x.sesv.deleting-1' }
    const repository = {
      // The restored database has the person and the case again, but not the other person.
      getCandidateReview: vi.fn((id: string) => (id === personId ? { documentId: id } : null)),
      previewCandidateDeletion: vi.fn(() => ({ confirmationHash: 'a'.repeat(64) })),
      deleteCandidateDatabaseData: vi.fn(),
      getStagedFileRecords: vi.fn(() => [file]),
      getJobCaseReview: vi.fn(() => ({ reviewId: caseId })),
      previewJobCaseDeletion: vi.fn(() => ({ confirmationHash: 'b'.repeat(64) })),
      deleteJobCaseDatabaseData: vi.fn(),
      restoreGmailMessageTombstones: vi.fn(() => 1)
    }
    const fileVault = {
      quarantineStagedFile: vi.fn(async () => quarantined),
      restoreQuarantinedFile: vi.fn(),
      purgeQuarantinedFile: vi.fn(async () => undefined)
    }
    const result = await reapplyDeletions(journal, repository as never, fileVault as never)
    expect(result).toEqual({ reapplied: 2, held: 0 })
    expect(repository.deleteCandidateDatabaseData).toHaveBeenCalledWith(personId, 'a'.repeat(64))
    expect(fileVault.purgeQuarantinedFile).toHaveBeenCalledWith(quarantined)
    expect(repository.deleteJobCaseDatabaseData).toHaveBeenCalledWith({
      reviewId: caseId,
      confirmationHash: 'b'.repeat(64),
      confirmationText: '削除'
    })
    expect(repository.restoreGmailMessageTombstones).toHaveBeenCalledWith([{ accountEmail: 'sales@example.test', gmailMessageId: 'm1' }])
  })

  it('skips a deletion the current data refuses and puts the file back', async () => {
    const journal = new DeletionJournal(memoryStore())
    await journal.record({ entityType: 'candidate', entityId: personId, deletedAt: '2026-09-01T00:00:00.000Z' })
    const quarantined = { token: personId, originalPath: '/v/x.sesv', quarantinePath: '/v/x.sesv.deleting-1' }
    const repository = {
      getCandidateReview: vi.fn(() => ({ documentId: personId })),
      previewCandidateDeletion: vi.fn(() => ({ confirmationHash: 'a'.repeat(64) })),
      deleteCandidateDatabaseData: vi.fn(() => {
        throw new Error('已进场')
      }),
      getStagedFileRecords: vi.fn(() => [{ token: personId }]),
      getJobCaseReview: vi.fn(),
      previewJobCaseDeletion: vi.fn(),
      deleteJobCaseDatabaseData: vi.fn(),
      restoreGmailMessageTombstones: vi.fn(() => 0)
    }
    const fileVault = {
      quarantineStagedFile: vi.fn(async () => quarantined),
      restoreQuarantinedFile: vi.fn(async () => undefined),
      purgeQuarantinedFile: vi.fn()
    }
    expect(await reapplyDeletions(journal, repository as never, fileVault as never)).toEqual({ reapplied: 0, held: 1 })
    expect(fileVault.restoreQuarantinedFile).toHaveBeenCalledWith(quarantined)
    expect(fileVault.purgeQuarantinedFile).not.toHaveBeenCalled()
    // Held for HR with the reason, not retried silently later.
    expect(await journal.held()).toMatchObject([{ entityId: personId, state: 'held', heldReason: '已进场' }])
  })

  it('journals a deletion before it happens, and settles what a crash left pending', async () => {
    const journal = new DeletionJournal(memoryStore())
    const done = await journal.begin({ entityType: 'candidate', entityId: personId, deletedAt: '2026-09-01T00:00:00.000Z' })
    const failed = await journal.begin({ entityType: 'candidate', entityId: goneId, deletedAt: '2026-09-01T00:00:00.000Z' })
    const crashed = await journal.begin({ entityType: 'job-case', entityId: caseId, deletedAt: '2026-09-02T00:00:00.000Z' })
    await journal.confirm(done)
    await journal.discard(failed)
    // Pending deletions do not count as done for a restore.
    expect((await journal.recordedAfter('2026-08-01T00:00:00.000Z')).map((entry) => entry.entityId)).toEqual([personId])
    // After a crash: the case is gone (the delete went through), so its entry is confirmed.
    await journal.settlePending(() => false)
    expect((await journal.entries()).map((entry) => [entry.entityId, entry.state])).toEqual([
      [personId, undefined],
      [caseId, undefined]
    ])
    expect(crashed).toBeTruthy()
    // Still there after a crash: the delete never happened, the entry goes.
    await journal.begin({ entityType: 'candidate', entityId: goneId, deletedAt: '2026-09-03T00:00:00.000Z' })
    await journal.settlePending(() => true)
    expect((await journal.entries()).map((entry) => entry.entityId)).toEqual([personId, caseId])
  })

  it('keeps the journal within its limit, dropping the oldest confirmed deletions but never held ones', async () => {
    const store = memoryStore()
    const journal = new DeletionJournal(store)
    store.data = {
      version: 1,
      entries: Array.from({ length: deletionJournalLimit + 1 }, (_, index) => ({
        id: randomUUID(),
        entityType: 'candidate' as const,
        entityId: `p-${index}`,
        deletedAt: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString()
      }))
    }
    store.data.entries[0] = { ...store.data.entries[0]!, state: 'held', heldReason: '已进场' }
    await journal.record({ entityType: 'candidate', entityId: personId, deletedAt: '2026-10-01T00:00:00.000Z' })
    const entries = await journal.entries()
    expect(entries.filter((entry) => !entry.state)).toHaveLength(deletionJournalLimit)
    expect(entries.some((entry) => entry.entityId === 'p-0')).toBe(true)
    expect(entries.some((entry) => entry.entityId === 'p-1')).toBe(false)
    expect(entries.at(-1)?.entityId).toBe(personId)
  })
})
