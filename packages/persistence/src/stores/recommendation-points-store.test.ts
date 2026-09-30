// @vitest-environment node
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RecommendationPointsRecord } from '@shared'
import { currentSchemaVersion } from '../index'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { seedConfirmedCase, seedImportedPerson } from './store-test-fixtures-business'

describe.skipIf(!nativeSqliteAvailable)('RecommendationPointsStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  const recordFor = (documentId: string, reviewId: string, over: Partial<RecommendationPointsRecord> = {}): RecommendationPointsRecord => ({
    documentId,
    reviewId,
    profileVersion: 1,
    jobCaseVersion: 1,
    locale: 'zh-CN',
    points: [
      {
        headline: '主导过决済系统的基本设计',
        detail: '在决済基盤刷新项目中负责基本设计，与本案件的设计阶段一致。',
        project: '決済基盤刷新',
        quote: 'Spring Boot で決済 API を設計'
      }
    ],
    emptyReason: null,
    generatedAt: '2026-09-30T01:00:00.000Z',
    modelName: 'test-model',
    ...over
  })

  it('keeps the latest points per person and case across reopen', () => {
    const person = seedImportedPerson(handle.repository)
    const job = seedConfirmedCase(handle.repository)
    expect(handle.repository.saveRecommendationPoints(recordFor(person.documentId, job.reviewId))).toBe(true)
    const latest = recordFor(person.documentId, job.reviewId, {
      points: [],
      emptyReason: 'no-grounded-points',
      locale: 'ja-JP',
      generatedAt: '2026-09-30T02:00:00.000Z'
    })
    expect(handle.repository.saveRecommendationPoints(latest)).toBe(true)
    expect(handle.reopen().getRecommendationPoints(person.documentId, job.reviewId)).toEqual(latest)
  })

  it('removes the points with the case and with the person (deletion cascade)', () => {
    const person = seedImportedPerson(handle.repository)
    const kept = seedConfirmedCase(handle.repository, 'Java 案件A')
    const removed = seedConfirmedCase(handle.repository, 'Java 案件B')
    handle.repository.saveRecommendationPoints(recordFor(person.documentId, kept.reviewId))
    handle.repository.saveRecommendationPoints(recordFor(person.documentId, removed.reviewId))
    const casePreview = handle.repository.previewJobCaseDeletion(removed.reviewId)
    handle.repository.deleteJobCaseDatabaseData({
      reviewId: removed.reviewId,
      confirmationHash: casePreview.confirmationHash,
      confirmationText: '削除'
    })
    expect(handle.repository.getRecommendationPoints(person.documentId, removed.reviewId)).toBeNull()
    expect(handle.repository.getRecommendationPoints(person.documentId, kept.reviewId)).not.toBeNull()

    const preview = handle.repository.previewCandidateDeletion(person.documentId)
    handle.repository.deleteCandidateDatabaseData(person.documentId, preview.confirmationHash)
    expect(handle.repository.getRecommendationPoints(person.documentId, kept.reviewId)).toBeNull()
  })

  it('does not store points for a person or case deleted while they were generated', () => {
    const person = seedImportedPerson(handle.repository)
    const job = seedConfirmedCase(handle.repository)
    const missing = '00000000-0000-4000-8000-000000000000'
    expect(handle.repository.saveRecommendationPoints(recordFor(missing, job.reviewId))).toBe(false)
    expect(handle.repository.saveRecommendationPoints(recordFor(person.documentId, missing))).toBe(false)
    expect(handle.repository.getRecommendationPoints(person.documentId, missing)).toBeNull()
  })

  it('advances the backup revision when points change', () => {
    const person = seedImportedPerson(handle.repository)
    const job = seedConfirmedCase(handle.repository)
    const revision = () => handle.repository.getLocalDataRevision().revision
    const before = revision()
    handle.repository.saveRecommendationPoints(recordFor(person.documentId, job.reviewId))
    expect(revision()).toBeGreaterThan(before)
  })

  it('upgrades a v63 database by creating the recommendation points table (schema v64 migration)', () => {
    handle.repository.close()
    const raw = new Database(handle.path)
    try {
      raw.pragma("cipher='sqlcipher'")
      raw.pragma('legacy=4')
      raw.key(handle.databaseKey)
      raw.exec(`
        BEGIN IMMEDIATE;
        DROP TABLE recommendation_points;
        DELETE FROM schema_migrations WHERE version = 64;
        COMMIT;
      `)
      expect(raw.prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 64').get()).toBeUndefined()
    } finally {
      raw.close()
    }
    const upgraded = handle.reopen()
    expect(currentSchemaVersion).toBe(66)
    expect(upgraded.getSchemaVersion()).toBe(currentSchemaVersion)
    const person = seedImportedPerson(upgraded)
    const job = seedConfirmedCase(upgraded)
    upgraded.saveRecommendationPoints(recordFor(person.documentId, job.reviewId))
    expect(upgraded.getRecommendationPoints(person.documentId, job.reviewId)?.points).toHaveLength(1)
  })
})
