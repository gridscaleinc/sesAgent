// @vitest-environment node
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CommunicationPointsRecord } from '@shared'
import { currentSchemaVersion } from '../index'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { seedConfirmedCase, seedImportedPerson } from './store-test-fixtures-business'

describe.skipIf(!nativeSqliteAvailable)('CommunicationPointsStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  const recordFor = (documentId: string, reviewId: string, over: Partial<CommunicationPointsRecord> = {}): CommunicationPointsRecord => ({
    documentId,
    reviewId,
    profileVersion: 1,
    jobCaseVersion: 1,
    locale: 'zh-CN',
    points: [{ question: '最早什么时候可以入场？', audience: 'person', reason: '案件要求下月开始。', source: '11月〜' }],
    request: '重点看入场时间',
    generatedAt: '2026-10-02T01:00:00.000Z',
    modelName: 'test-model',
    ...over
  })

  it('keeps the latest points per person and case across reopen', () => {
    const person = seedImportedPerson(handle.repository)
    const job = seedConfirmedCase(handle.repository)
    expect(handle.repository.saveCommunicationPoints(recordFor(person.documentId, job.reviewId))).toBe(true)
    const latest = recordFor(person.documentId, job.reviewId, { points: [], request: null, locale: 'ja-JP' })
    expect(handle.repository.saveCommunicationPoints(latest)).toBe(true)
    expect(handle.reopen().getCommunicationPoints(person.documentId, job.reviewId)).toEqual(latest)
  })

  it('goes with the case and with the person, and is not stored for either deleted meanwhile', () => {
    const person = seedImportedPerson(handle.repository)
    const kept = seedConfirmedCase(handle.repository, 'Java 案件A')
    const removed = seedConfirmedCase(handle.repository, 'Java 案件B')
    handle.repository.saveCommunicationPoints(recordFor(person.documentId, kept.reviewId))
    handle.repository.saveCommunicationPoints(recordFor(person.documentId, removed.reviewId))
    const casePreview = handle.repository.previewJobCaseDeletion(removed.reviewId)
    handle.repository.deleteJobCaseDatabaseData({
      reviewId: removed.reviewId,
      confirmationHash: casePreview.confirmationHash,
      confirmationText: '削除'
    })
    expect(handle.repository.getCommunicationPoints(person.documentId, removed.reviewId)).toBeNull()
    expect(handle.repository.saveCommunicationPoints(recordFor(person.documentId, removed.reviewId))).toBe(false)
    const preview = handle.repository.previewCandidateDeletion(person.documentId)
    handle.repository.deleteCandidateDatabaseData(person.documentId, preview.confirmationHash)
    expect(handle.repository.getCommunicationPoints(person.documentId, kept.reviewId)).toBeNull()
  })

  it('upgrades a v67 database by creating the table (schema v68 migration)', () => {
    handle.repository.close()
    const raw = new Database(handle.path)
    try {
      raw.pragma("cipher='sqlcipher'")
      raw.pragma('legacy=4')
      raw.key(handle.databaseKey)
      raw.exec(`
        BEGIN IMMEDIATE;
        DROP TABLE communication_points;
        DELETE FROM schema_migrations WHERE version = 68;
        COMMIT;
      `)
    } finally {
      raw.close()
    }
    const upgraded = handle.reopen()
    expect(currentSchemaVersion).toBe(68)
    expect(upgraded.getSchemaVersion()).toBe(68)
    const person = seedImportedPerson(upgraded)
    const job = seedConfirmedCase(upgraded)
    const revision = upgraded.getLocalDataRevision().revision
    expect(upgraded.saveCommunicationPoints(recordFor(person.documentId, job.reviewId))).toBe(true)
    expect(upgraded.getLocalDataRevision().revision).toBeGreaterThan(revision)
  })
})
