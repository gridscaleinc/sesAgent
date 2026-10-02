// @vitest-environment node
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { businessMatchingPolicyVersion, type PersonnelCaseMatch, type StoredPersonnelCaseMatchRun } from '@shared'
import { currentSchemaVersion } from '../index'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { seedConfirmedCase, seedImportedPerson } from './store-test-fixtures-business'

const item = (jobCaseId: string, reviewId: string, status: 'recommended' | 'excluded'): PersonnelCaseMatch =>
  ({
    reviewId,
    jobCaseId,
    jobCaseVersion: 1,
    title: 'Java 検証案件',
    score: 0.8,
    matched: ['Java'],
    missing: [],
    hardFilters: [],
    qualification: { policyVersion: businessMatchingPolicyVersion, status, requirements: [] }
  }) as unknown as PersonnelCaseMatch

describe.skipIf(!nativeSqliteAvailable)('PersonCaseMatchStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  const runFor = (
    documentId: string,
    items: PersonnelCaseMatch[],
    searchedAt = '2026-09-30T01:00:00.000Z'
  ): StoredPersonnelCaseMatchRun => ({
    result: {
      documentId,
      profileVersion: 1,
      rulesRevision: 2,
      items,
      localMatchCount: items.length,
      searchedCount: 3,
      excludedCount: 1,
      excludedRequirements: ['AWS'],
      cloud: { status: 'reviewed', reviewedCount: items.length, modelName: 'test-model' }
    },
    searchedAt,
    caseSignature: items.map((entry) => `${entry.jobCaseId}:1`).join(','),
    policyVersion: businessMatchingPolicyVersion
  })

  it('keeps the latest run per person across reopen and counts only listed cases', () => {
    const person = seedImportedPerson(handle.repository)
    const first = seedConfirmedCase(handle.repository, 'Java 案件A')
    const second = seedConfirmedCase(handle.repository, 'Java 案件B')
    handle.repository.savePersonCaseMatchRun(runFor(person.documentId, [item(first.jobCase!.id, first.reviewId, 'recommended')]))
    const latest = runFor(
      person.documentId,
      [item(second.jobCase!.id, second.reviewId, 'recommended'), item(first.jobCase!.id, first.reviewId, 'excluded')],
      '2026-09-30T02:00:00.000Z'
    )
    handle.repository.savePersonCaseMatchRun(latest)

    const reopened = handle.reopen()
    expect(reopened.getPersonCaseMatchRun(person.documentId)).toEqual(latest)
    expect(reopened.listPersonCaseMatchRunSummaries()).toEqual([
      {
        documentId: person.documentId,
        profileVersion: 1,
        rulesRevision: 2,
        policyVersion: businessMatchingPolicyVersion,
        caseSignature: latest.caseSignature,
        searchedAt: '2026-09-30T02:00:00.000Z',
        listedCount: 1
      }
    ])
  })

  it('removes a deleted case from stored runs and the whole run with the person (deletion cascade)', () => {
    const person = seedImportedPerson(handle.repository)
    const kept = seedConfirmedCase(handle.repository, 'Java 案件A')
    const removed = seedConfirmedCase(handle.repository, 'Java 案件B')
    handle.repository.savePersonCaseMatchRun(
      runFor(person.documentId, [
        item(kept.jobCase!.id, kept.reviewId, 'recommended'),
        item(removed.jobCase!.id, removed.reviewId, 'recommended')
      ])
    )
    const casePreview = handle.repository.previewJobCaseDeletion(removed.reviewId)
    handle.repository.deleteJobCaseDatabaseData({
      reviewId: removed.reviewId,
      confirmationHash: casePreview.confirmationHash,
      confirmationText: '削除'
    })
    expect(handle.repository.getPersonCaseMatchRun(person.documentId)?.result.items.map((entry) => entry.jobCaseId)).toEqual([
      kept.jobCase!.id
    ])
    expect(handle.repository.listPersonCaseMatchRunSummaries()[0]?.listedCount).toBe(1)

    const preview = handle.repository.previewCandidateDeletion(person.documentId)
    handle.repository.deleteCandidateDatabaseData(person.documentId, preview.confirmationHash)
    expect(handle.repository.getPersonCaseMatchRun(person.documentId)).toBeNull()
    expect(handle.repository.listPersonCaseMatchRunSummaries()).toEqual([])
  })

  it('does not store a run for a person or case deleted while it was running', () => {
    const job = seedConfirmedCase(handle.repository)
    handle.repository.savePersonCaseMatchRun(
      runFor('00000000-0000-4000-8000-000000000000', [item(job.jobCase!.id, job.reviewId, 'recommended')])
    )
    expect(handle.repository.listPersonCaseMatchRunSummaries()).toEqual([])
    const person = seedImportedPerson(handle.repository)
    handle.repository.savePersonCaseMatchRun(runFor(person.documentId, [item('missing-case', job.reviewId, 'recommended')]))
    expect(handle.repository.getPersonCaseMatchRun(person.documentId)?.result.items).toEqual([])
  })

  it('upgrades a v62 database by creating the person to case run tables (schema v63 migration)', () => {
    handle.repository.close()
    const raw = new Database(handle.path)
    try {
      raw.pragma("cipher='sqlcipher'")
      raw.pragma('legacy=4')
      raw.key(handle.databaseKey)
      raw.exec(`
        BEGIN IMMEDIATE;
        DROP TABLE person_case_match_run_items;
        DROP TABLE person_case_match_runs;
        DELETE FROM schema_migrations WHERE version = 63;
        COMMIT;
      `)
    } finally {
      raw.close()
    }
    const upgraded = handle.reopen()
    expect(currentSchemaVersion).toBe(68)
    expect(upgraded.getSchemaVersion()).toBe(currentSchemaVersion)
    const person = seedImportedPerson(upgraded)
    const job = seedConfirmedCase(upgraded)
    upgraded.savePersonCaseMatchRun(runFor(person.documentId, [item(job.jobCase!.id, job.reviewId, 'recommended')]))
    expect(upgraded.listPersonCaseMatchRunSummaries()).toHaveLength(1)
  })
})
