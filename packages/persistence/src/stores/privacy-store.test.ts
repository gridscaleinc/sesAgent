// @vitest-environment node
import { randomBytes } from 'node:crypto'
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { redactTextForCloud } from '@privacy'
import { EncryptedApplicationRepository } from '../index'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'

const nameSentinel = '山田秘密太郎'
const phoneSentinel = '090-1234-5678'
const emailSentinel = 'secret.person@example.jp'

function redact(sessionId?: string) {
  return redactTextForCloud(`氏名：${nameSentinel}\n電話 ${phoneSentinel}\nメール ${emailSentinel}\nJava 5年`, {
    sourceVersion: 'store-test-v1',
    knownPersonNames: [nameSentinel],
    personNameReviewCompleted: true,
    sessionId,
    now: new Date('2026-09-01T00:00:00.000Z')
  })
}

describe.skipIf(!nativeSqliteAvailable)('PrivacyStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  it('round-trips a redaction session and its PII mappings across a reopen', () => {
    const redaction = redact()
    expect(redaction.session.status).toBe('passed')
    handle.repository.saveRedactionSession(redaction.session, redaction.mappings)

    const reopened = handle.reopen()
    expect(reopened.getRedactionSession(redaction.session.id)).toEqual(redaction.session)
    const mappings = reopened.getLocalPiiMappings(redaction.session.id)
    expect(mappings.map((mapping) => mapping.originalValue).toSorted()).toEqual([nameSentinel, phoneSentinel, emailSentinel].toSorted())
    expect(mappings.toSorted((a, b) => a.placeholder.localeCompare(b.placeholder))).toEqual(
      redaction.mappings.toSorted((a, b) => a.placeholder.localeCompare(b.placeholder))
    )
    expect(reopened.getRedactionSession('00000000-0000-4000-8000-000000000000')).toBeNull()
    expect(reopened.getLocalPiiMappings('00000000-0000-4000-8000-000000000000')).toEqual([])
  })

  it('re-saving a session replaces its mappings instead of accumulating stale originals', () => {
    const first = redact()
    handle.repository.saveRedactionSession(first.session, first.mappings)
    const onlyName = first.mappings.filter((mapping) => mapping.identifierType === 'person_name')
    handle.repository.saveRedactionSession({ ...first.session, status: 'invalidated' }, onlyName)
    expect(handle.repository.getRedactionSession(first.session.id)?.status).toBe('invalidated')
    expect(handle.repository.getLocalPiiMappings(first.session.id).map((mapping) => mapping.originalValue)).toEqual([nameSentinel])
  })

  it('keeps PII originals sealed with the mapping key, not just behind the database cipher', () => {
    const redaction = redact()
    handle.repository.saveRedactionSession(redaction.session, redaction.mappings)
    handle.repository.checkpoint()
    handle.repository.close()

    const raw = new Database(handle.path)
    try {
      raw.pragma("cipher='sqlcipher'")
      raw.pragma('legacy=4')
      raw.key(handle.databaseKey)
      const rows = raw
        .prepare<[string], { encrypted_original: Buffer }>(
          'SELECT encrypted_original FROM local_pii_mappings WHERE redaction_session_id = ?'
        )
        .all(redaction.session.id)
      expect(rows).toHaveLength(3)
      for (const row of rows) {
        const bytes = Buffer.from(row.encrypted_original)
        for (const sentinel of [nameSentinel, phoneSentinel, emailSentinel]) {
          expect(bytes.includes(Buffer.from(sentinel, 'utf8'))).toBe(false)
        }
      }
    } finally {
      raw.close()
    }
    handle.repository = new EncryptedApplicationRepository({
      path: handle.path,
      databaseKey: handle.databaseKey,
      mappingKey: handle.mappingKey
    })
  })

  it('refuses to open the database with the wrong database key', () => {
    handle.repository.close()
    expect(
      () =>
        new EncryptedApplicationRepository({
          path: handle.path,
          databaseKey: randomBytes(32),
          mappingKey: handle.mappingKey
        })
    ).toThrow(/Unable to open the encrypted local database/)
    expect(
      () =>
        new EncryptedApplicationRepository({
          path: handle.path,
          databaseKey: randomBytes(16),
          mappingKey: handle.mappingKey
        })
    ).toThrow(/32 bytes/)
    handle.repository = new EncryptedApplicationRepository({
      path: handle.path,
      databaseKey: handle.databaseKey,
      mappingKey: handle.mappingKey
    })
  })

  it('appends cloud call audits and rejects a duplicate audit id or a non-passed DLP status', () => {
    const redaction = redact()
    handle.repository.saveRedactionSession(redaction.session, redaction.mappings)
    const record = {
      id: 'audit-1',
      redactionSessionId: redaction.session.id,
      provider: 'aicommerce',
      taskType: 'cloud-assist' as const,
      endpoint: 'https://example.invalid/v1',
      inputHash: 'a'.repeat(64),
      dlpStatus: 'passed' as const,
      outcome: 'succeeded' as const,
      reasonCode: null,
      qualityGateReportHash: 'b'.repeat(64),
      expertAttestationHash: null,
      reviewTicketHash: 'c'.repeat(64),
      reviewTicketStatus: 'confirmed' as const,
      gatePolicyVersion: 'policy-v1',
      createdAt: '2026-09-01T00:00:00.000Z'
    }
    const before = handle.repository.getLocalDataRevision().revision
    handle.repository.appendCloudCallAudit(record)
    expect(handle.repository.getLocalDataRevision().revision).toBeGreaterThan(before)
    expect(() => handle.repository.appendCloudCallAudit(record)).toThrow()
    expect(() => handle.repository.appendCloudCallAudit({ ...record, id: 'audit-2', dlpStatus: 'failed' as never })).toThrow()
  })
})
