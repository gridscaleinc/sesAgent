import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { SafeStorageJsonCredentialVault } from '@platform'
import type { EncryptedApplicationRepository } from '@persistence'
import type { EncryptedFileVault } from '@files'

/**
 * Permanent deletions, kept outside the encrypted database. Restoring a backup replaces the whole database, so a
 * person or case deleted after that backup would come back with it; this journal survives the restore (it is
 * protected by the OS keychain, not by the restored keys) and the deletions in it are applied again — once, right
 * after the restore. Only ids are kept, plus the Gmail messages a case deletion tombstoned so they are not imported
 * again.
 *
 * An entry is written 'pending' before the database delete and confirmed after it, so a crash in between cannot
 * leave a deletion unrecorded. A deletion the restored data refuses (someone in place through the case) is 'held':
 * HR decides to delete it now or keep the record, and nothing is deleted behind their back later.
 */
const entrySchema = z
  .object({
    id: z.string().uuid(),
    entityType: z.enum(['candidate', 'job-case']),
    entityId: z.string().min(1).max(200),
    deletedAt: z.string().datetime(),
    gmailTombstones: z
      .array(z.object({ accountEmail: z.string().min(1).max(320), gmailMessageId: z.string().min(1).max(200) }).strict())
      .max(10)
      .optional(),
    /** Absent: confirmed. */
    state: z.enum(['pending', 'held']).optional(),
    /** For 'held': why the restored data refused it. */
    heldReason: z.string().max(500).optional()
  })
  .strict()
/** Kept within this many entries: the oldest confirmed ones go first (a backup older than that is unlikely). */
export const deletionJournalLimit = 20_000
const journalSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema).max(deletionJournalLimit * 2) }).strict()
export type DeletionJournalEntry = z.infer<typeof entrySchema>
export type DeletionJournalData = z.infer<typeof journalSchema>

export interface DeletionJournalStore {
  load(): Promise<DeletionJournalData | null>
  save(value: DeletionJournalData): Promise<void>
}

export class DeletionJournal {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly store: DeletionJournalStore) {}

  async entries(): Promise<DeletionJournalEntry[]> {
    return (await this.store.load())?.entries ?? []
  }

  /** Changes the entries; writes are serialized so two deletions in a row both land. */
  private update<T>(change: (entries: DeletionJournalEntry[]) => { entries: DeletionJournalEntry[]; value: T }): Promise<T> {
    const next = this.queue.then(async () => {
      const current = (await this.store.load()) ?? { version: 1 as const, entries: [] }
      const { entries, value } = change(current.entries)
      await this.store.save({ version: 1, entries: pruned(entries) })
      return value
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  /** Records a deletion about to happen; confirm it once the database delete succeeded, discard it if not. */
  begin(entry: Omit<DeletionJournalEntry, 'id' | 'state' | 'heldReason'>): Promise<string> {
    const id = randomUUID()
    return this.update((entries) => ({ entries: [...entries, entrySchema.parse({ ...entry, id, state: 'pending' })], value: id }))
  }

  confirm(id: string, patch: Pick<DeletionJournalEntry, 'gmailTombstones'> = {}): Promise<void> {
    return this.update((entries) => ({
      entries: entries.map((entry) => {
        if (entry.id !== id) return entry
        const { state: _, heldReason: __, ...rest } = { ...entry, ...patch }
        return rest
      }),
      value: undefined
    }))
  }

  discard(id: string): Promise<void> {
    return this.update((entries) => ({ entries: entries.filter((entry) => entry.id !== id), value: undefined }))
  }

  /** Appends one completed deletion. */
  async record(entry: Omit<DeletionJournalEntry, 'id' | 'state' | 'heldReason'>): Promise<void> {
    await this.confirm(await this.begin(entry))
  }

  hold(id: string, reason: string): Promise<void> {
    return this.update((entries) => ({
      entries: entries.map((entry) => (entry.id === id ? { ...entry, state: 'held' as const, heldReason: reason.slice(0, 500) } : entry)),
      value: undefined
    }))
  }

  /** Confirmed deletions recorded after a backup was made: what restoring that backup would bring back. */
  async recordedAfter(createdAt: string): Promise<DeletionJournalEntry[]> {
    return (await this.entries()).filter((entry) => entry.state !== 'pending' && entry.deletedAt > createdAt)
  }

  async held(): Promise<DeletionJournalEntry[]> {
    return (await this.entries()).filter((entry) => entry.state === 'held')
  }

  /**
   * Pending entries a crash left behind: a record that is gone was deleted (confirmed), one still there was not
   * (discarded).
   */
  settlePending(exists: (entry: DeletionJournalEntry) => boolean): Promise<void> {
    return this.update((entries) => ({
      entries: entries.flatMap((entry) => {
        if (entry.state !== 'pending') return [entry]
        if (exists(entry)) return []
        const { state: _, ...rest } = entry
        return [rest]
      }),
      value: undefined
    }))
  }
}

/** Pending and held entries are always kept; beyond the limit the oldest confirmed deletions are dropped. */
function pruned(entries: DeletionJournalEntry[]): DeletionJournalEntry[] {
  const confirmed = entries.filter((entry) => !entry.state)
  if (confirmed.length <= deletionJournalLimit) return entries
  const drop = new Set(
    confirmed
      .toSorted((a, b) => a.deletedAt.localeCompare(b.deletedAt))
      .slice(0, confirmed.length - deletionJournalLimit)
      .map((entry) => entry.id)
  )
  return entries.filter((entry) => !drop.has(entry.id))
}

let shared: DeletionJournal | null = null
/** The device's journal, under userData/security next to the other OS-protected files. */
export function deviceDeletionJournal(userDataPath: string): DeletionJournal {
  shared ??= new DeletionJournal(
    new SafeStorageJsonCredentialVault(join(userDataPath, 'security', 'deletion-journal.v1'), (input) => journalSchema.parse(input))
  )
  return shared
}

type JournalRepository = Pick<
  EncryptedApplicationRepository,
  | 'getCandidateReview'
  | 'previewCandidateDeletion'
  | 'deleteCandidateDatabaseData'
  | 'getStagedFileRecords'
  | 'getJobCaseReview'
  | 'previewJobCaseDeletion'
  | 'deleteJobCaseDatabaseData'
  | 'restoreGmailMessageTombstones'
>
type JournalVault = Pick<EncryptedFileVault, 'quarantineStagedFile' | 'restoreQuarantinedFile' | 'purgeQuarantinedFile'>

export const journalRecordExists =
  (repository: Pick<JournalRepository, 'getCandidateReview' | 'getJobCaseReview'>) =>
  (entry: Pick<DeletionJournalEntry, 'entityType' | 'entityId'>) =>
    entry.entityType === 'candidate'
      ? Boolean(repository.getCandidateReview(entry.entityId))
      : Boolean(repository.getJobCaseReview(entry.entityId))

/** Deletes one journaled record again from the current database, with its encrypted résumé file. */
export async function deleteJournaledRecord(
  entry: Pick<DeletionJournalEntry, 'entityType' | 'entityId'>,
  repository: JournalRepository,
  fileVault: JournalVault
): Promise<void> {
  if (entry.entityType === 'candidate') {
    const preview = repository.previewCandidateDeletion(entry.entityId)
    const file = repository.getStagedFileRecords([entry.entityId])[0]
    const quarantined = file ? await fileVault.quarantineStagedFile(file, randomUUID()) : null
    try {
      repository.deleteCandidateDatabaseData(entry.entityId, preview.confirmationHash)
    } catch (error) {
      if (quarantined) await fileVault.restoreQuarantinedFile(quarantined)
      throw error
    }
    if (quarantined) await fileVault.purgeQuarantinedFile(quarantined).catch(() => undefined)
  } else {
    const preview = repository.previewJobCaseDeletion(entry.entityId)
    repository.deleteJobCaseDatabaseData({ reviewId: entry.entityId, confirmationHash: preview.confirmationHash, confirmationText: '削除' })
  }
}

export interface ReapplyResult {
  reapplied: number
  held: number
}

/**
 * Run right after a restore is verified: every person or case the journal names that exists again (the restored
 * backup is from before the deletion) is deleted again, and every tombstoned Gmail message is tombstoned again. Ids
 * are random UUIDs, so a record that exists again can only be the deleted one restored. A deletion the restored data
 * refuses (someone in place) is held for HR to decide, never retried silently at a later start.
 */
export async function reapplyDeletions(
  journal: DeletionJournal,
  repository: JournalRepository,
  fileVault: JournalVault
): Promise<ReapplyResult> {
  const entries = (await journal.entries()).filter((entry) => entry.state !== 'pending')
  let reapplied = 0,
    held = 0
  repository.restoreGmailMessageTombstones(entries.flatMap((entry) => entry.gmailTombstones ?? []))
  const exists = journalRecordExists(repository)
  for (const entry of entries) {
    if (!exists(entry)) continue
    try {
      await deleteJournaledRecord(entry, repository, fileVault)
      if (entry.state === 'held') await journal.confirm(entry.id)
      reapplied += 1
    } catch (error) {
      await journal.hold(entry.id, error instanceof Error ? error.message : '')
      held += 1
    }
  }
  return { reapplied, held }
}
