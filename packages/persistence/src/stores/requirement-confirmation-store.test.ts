// @vitest-environment node
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RequirementConfirmation } from '@shared'
import { currentSchemaVersion } from '../index'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { seedConfirmedCase, seedImportedPerson } from './store-test-fixtures-business'
import { confirmAllJobCaseFields } from './store-test-fixtures-jobcases'

describe.skipIf(!nativeSqliteAvailable)('RequirementConfirmationStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  const decision = (documentId: string, over: Partial<RequirementConfirmation> = {}): RequirementConfirmation => ({
    id: crypto.randomUUID(),
    documentId,
    scope: 'person',
    jobCaseId: null,
    jobCaseVersion: null,
    requirementKey: 'language:日本語流暢',
    requirementLabel: '日本語流暢',
    outcome: 'met',
    note: '面谈确认业务会话没问题',
    question: null,
    decidedAt: '2026-10-01T01:00:00.000Z',
    decidedBy: 'Test HR',
    ...over
  })

  it('keeps one current decision per target across reopen, the newest first', () => {
    const person = seedImportedPerson(handle.repository)
    const job = seedConfirmedCase(handle.repository)
    const first = decision(person.documentId, { outcome: 'asking', question: '日本語での会議は可能ですか', note: null })
    expect(handle.repository.saveRequirementConfirmation(first)).toBe(true)
    const replaced = decision(person.documentId, { decidedAt: '2026-10-01T02:00:00.000Z' })
    expect(handle.repository.saveRequirementConfirmation(replaced)).toBe(true)
    const pair = decision(person.documentId, {
      scope: 'pair',
      jobCaseId: job.jobCase!.id,
      jobCaseVersion: job.jobCase!.version,
      outcome: 'conflict',
      decidedAt: '2026-10-01T03:00:00.000Z'
    })
    expect(handle.repository.saveRequirementConfirmation(pair)).toBe(true)
    expect(handle.reopen().listRequirementConfirmations(person.documentId)).toEqual([pair, replaced])
  })

  it('keeps a 「仅本案件」 decision through a case revision and lets a person-wide decision replace it', () => {
    const person = seedImportedPerson(handle.repository)
    const job = seedConfirmedCase(handle.repository)
    const pair = decision(person.documentId, {
      scope: 'pair',
      jobCaseId: job.jobCase!.id,
      jobCaseVersion: job.jobCase!.version,
      outcome: 'conflict'
    })
    handle.repository.saveRequirementConfirmation(pair)
    handle.repository.reopenJobCaseReview({ reviewId: job.reviewId, reason: '条件を更新するため' }, 'u')
    const revised = confirmAllJobCaseFields(handle.repository, job.reviewId, {}, new Date('2026-10-02T00:00:00.000Z'))
    expect(revised.jobCase!.version).toBe(job.jobCase!.version + 1)
    // Still this case's decision, now on its new version.
    expect(handle.repository.listRequirementConfirmations(person.documentId)).toEqual([
      expect.objectContaining({ id: pair.id, jobCaseId: revised.jobCase!.id, jobCaseVersion: revised.jobCase!.version })
    ])
    // Written into the person's record: the case-only decision on the same requirement gives way.
    const own = decision(person.documentId, { decidedAt: '2026-10-03T00:00:00.000Z' })
    handle.repository.saveRequirementConfirmation(own)
    expect(handle.repository.listRequirementConfirmations(person.documentId).map((row) => row.id)).toEqual([own.id])
  })

  it('rejects a decision for a missing person or case and withdraws only the person’s own decision', () => {
    const person = seedImportedPerson(handle.repository)
    const missing = '00000000-0000-4000-8000-000000000000'
    expect(handle.repository.saveRequirementConfirmation(decision(missing))).toBe(false)
    expect(
      handle.repository.saveRequirementConfirmation(decision(person.documentId, { scope: 'pair', jobCaseId: missing, jobCaseVersion: 1 }))
    ).toBe(false)
    const saved = decision(person.documentId)
    handle.repository.saveRequirementConfirmation(saved)
    expect(handle.repository.deleteRequirementConfirmation(saved.id, missing)).toBe(false)
    expect(handle.repository.deleteRequirementConfirmation(saved.id, person.documentId)).toBe(true)
    expect(handle.repository.listRequirementConfirmations(person.documentId)).toEqual([])
  })

  it('removes pair decisions with the case and every decision with the person, and advances the backup revision', () => {
    const person = seedImportedPerson(handle.repository)
    const job = seedConfirmedCase(handle.repository)
    const revision = () => handle.repository.getLocalDataRevision().revision
    const before = revision()
    const own = decision(person.documentId)
    handle.repository.saveRequirementConfirmation(own)
    handle.repository.saveRequirementConfirmation(
      decision(person.documentId, { scope: 'pair', jobCaseId: job.jobCase!.id, jobCaseVersion: job.jobCase!.version })
    )
    expect(revision()).toBeGreaterThan(before)
    const casePreview = handle.repository.previewJobCaseDeletion(job.reviewId)
    handle.repository.deleteJobCaseDatabaseData({
      reviewId: job.reviewId,
      confirmationHash: casePreview.confirmationHash,
      confirmationText: '削除'
    })
    expect(handle.repository.listRequirementConfirmations(person.documentId)).toEqual([own])
    const preview = handle.repository.previewCandidateDeletion(person.documentId)
    handle.repository.deleteCandidateDatabaseData(person.documentId, preview.confirmationHash)
    expect(handle.repository.listAllRequirementConfirmations()).toEqual([])
  })

  it('upgrades a v66 database by creating the decisions table (schema v67 migration)', () => {
    handle.repository.close()
    const raw = new Database(handle.path)
    try {
      raw.pragma("cipher='sqlcipher'")
      raw.pragma('legacy=4')
      raw.key(handle.databaseKey)
      raw.exec(`
        BEGIN IMMEDIATE;
        DROP TABLE requirement_confirmations;
        DELETE FROM schema_migrations WHERE version = 67;
        COMMIT;
      `)
    } finally {
      raw.close()
    }
    const upgraded = handle.reopen()
    expect(currentSchemaVersion).toBe(67)
    expect(upgraded.getSchemaVersion()).toBe(currentSchemaVersion)
    const person = seedImportedPerson(upgraded)
    expect(upgraded.saveRequirementConfirmation(decision(person.documentId))).toBe(true)
  })
})
