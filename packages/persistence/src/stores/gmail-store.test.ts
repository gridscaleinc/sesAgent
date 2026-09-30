// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { fingerprint, saveRedactedGmailMessage, testAccount } from './store-test-fixtures-mail'

const rawName = '鈴木機密担当'
const rawPhone = '070-2468-1357'
const rawEmail = 'suzuki.secret@partner.example.jp'

describe.skipIf(!nativeSqliteAvailable)('GmailStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  it('stores a redacted message once, dedupes by id and finds it by business fingerprint', () => {
    const { repository } = handle
    const { message, saved, sessionId } = saveRedactedGmailMessage(repository, {
      subject: `Java案件 ${rawName}`,
      body: `必須スキル：Java / AWS\n単価：80万円/月\n連絡先 ${rawPhone} ${rawEmail}`,
      personNames: [rawName]
    })
    expect(saved).toBe(true)
    // The stored text is the redacted text, not the raw identifiers.
    expect(message.redactedSubject).toContain('<PERSON_NAME_001>')
    expect(message.redactedBody).not.toContain(rawPhone)
    expect(message.redactedBody).not.toContain(rawEmail)

    expect(repository.hasGmailMessage(testAccount, 'gmail_msg_001')).toBe(true)
    expect(repository.hasGmailMessage(testAccount, 'gmail_msg_999')).toBe(false)
    expect(repository.countGmailMessages(testAccount)).toBe(1)
    expect(repository.countGmailMessages('other@example.co.jp')).toBe(0)
    expect(repository.findGmailMessageByFingerprint(testAccount, message.businessFingerprint)).toBe('gmail_msg_001')
    expect(repository.findGmailMessageByFingerprint(testAccount, fingerprint('unknown'))).toBeNull()

    // Same id again is ignored rather than overwriting the first import.
    expect(repository.saveGmailMessage({ ...message, redactedSubject: 'changed' })).toBe(false)
    expect(repository.countGmailMessages(testAccount)).toBe(1)

    const pending = repository.listGmailMessagesPendingJobCaseDrafts(testAccount)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ gmailMessageId: 'gmail_msg_001', redactedSubject: message.redactedSubject })

    expect(repository.summarizeGmailRedactionEvidence(testAccount)).toEqual({
      storedMessages: 1,
      passed: 1,
      uncertain: 0,
      blocked: 0
    })
    // Mappings round-trip locally (decrypted with the mapping key).
    expect(repository.getLocalPiiMappings(sessionId).map((mapping) => mapping.originalValue)).toEqual(
      expect.arrayContaining([rawName, rawPhone, rawEmail])
    )
  })

  it('rejects malformed message input before touching the database', () => {
    const { repository } = handle
    const { message } = saveRedactedGmailMessage(
      repository,
      {
        subject: 'Java案件',
        body: '必須スキル：Java',
        personNames: []
      },
      { gmailMessageId: 'gmail_ok' }
    )
    expect(() => repository.saveGmailMessage({ ...message, gmailMessageId: 'bad id/with slash' })).toThrow()
    expect(() => repository.saveGmailMessage({ ...message, gmailMessageId: 'x2', accountEmail: 'not-an-email' })).toThrow()
    expect(() => repository.saveGmailMessage({ ...message, gmailMessageId: 'x3', businessFingerprint: 'short' })).toThrow()
    expect(() => repository.saveGmailMessage({ ...message, gmailMessageId: 'x4', redactionSessionId: 'not-a-uuid' })).toThrow()
    expect(repository.countGmailMessages(testAccount)).toBe(1)
  })

  it('refuses a message whose redaction session was never recorded', () => {
    const { repository } = handle
    const { message } = saveRedactedGmailMessage(repository, {
      subject: 'Java案件',
      body: '必須スキル：Java',
      personNames: []
    })
    expect(() =>
      repository.saveGmailMessage({
        ...message,
        gmailMessageId: 'gmail_orphan',
        redactionSessionId: '00000000-0000-4000-8000-000000000000'
      })
    ).toThrow(/FOREIGN KEY/)
  })

  it('keeps the history cursor on failure only while the configuration hash is unchanged', () => {
    const { repository } = handle
    const configHash = '1'.repeat(64)
    const lastRun = { mode: 'baseline' as const, discovered: 1, imported: 1, duplicates: 0, filtered: 0, failed: 0 }
    expect(repository.getGmailSyncCheckpoint(testAccount)).toBeNull()
    repository.saveGmailSyncSuccess(testAccount, configHash, '120', lastRun, '2026-07-17T00:02:00.000Z')
    expect(repository.getGmailSyncCheckpoint(testAccount)).toMatchObject({
      configHash,
      historyId: '120',
      status: 'idle',
      lastSyncedAt: '2026-07-17T00:02:00.000Z',
      lastError: null,
      lastRun
    })

    repository.saveGmailSyncFailure(testAccount, configHash, 'NETWORK_TIMEOUT', '2026-07-17T00:03:00.000Z')
    expect(repository.getGmailSyncCheckpoint(testAccount)).toMatchObject({
      historyId: '120',
      status: 'error',
      lastError: 'NETWORK_TIMEOUT',
      lastSyncedAt: '2026-07-17T00:02:00.000Z'
    })

    // A new configuration must not resume from the old configuration's cursor.
    repository.saveGmailSyncFailure(testAccount, '2'.repeat(64), 'x'.repeat(500), '2026-07-17T00:04:00.000Z')
    const afterConfigChange = repository.getGmailSyncCheckpoint(testAccount)
    expect(afterConfigChange).toMatchObject({ configHash: '2'.repeat(64), historyId: null, status: 'error' })
    expect(afterConfigChange?.lastError).toHaveLength(240)
  })

  it('upserts business intake rows and reports failures and warnings', () => {
    const { repository } = handle
    saveRedactedGmailMessage(
      repository,
      { subject: '要員提案', body: 'Java 5年', personNames: [] },
      {
        gmailMessageId: 'gmail_person_001',
        classification: 'candidate-proposal'
      }
    )
    expect(repository.listPendingGmailBusinessIntake(testAccount)).toEqual([
      { messageId: 'gmail_person_001', classification: 'candidate-proposal' }
    ])
    repository.saveGmailBusinessIntake({
      accountEmail: testAccount,
      messageId: 'gmail_person_001',
      replyTo: null,
      status: 'error',
      parts: {},
      warnings: ['ATTACHMENT_UNREADABLE']
    })
    expect(repository.getGmailPersonnelIntakeStatus(testAccount)).toEqual({ failed: 1, warnings: 1 })
    repository.saveGmailBusinessIntake({
      accountEmail: testAccount,
      messageId: 'gmail_person_001',
      replyTo: 'sales@partner.example.jp',
      status: 'completed',
      parts: { resume: 'token-1' },
      warnings: []
    })
    expect(repository.getGmailBusinessIntake(testAccount, 'gmail_person_001')).toEqual({
      accountEmail: testAccount,
      messageId: 'gmail_person_001',
      replyTo: 'sales@partner.example.jp',
      status: 'completed',
      parts: { resume: 'token-1' },
      warnings: []
    })
    expect(repository.getGmailPersonnelIntakeStatus(testAccount)).toEqual({ failed: 0, warnings: 0 })
    expect(repository.listPendingGmailBusinessIntake(testAccount)).toEqual([])
    expect(repository.getGmailBusinessIntake(testAccount, 'missing')).toBeNull()
  })

  it('saves the Google Workspace admin configuration with revision checks', () => {
    const { repository } = handle
    const input = {
      clientId: '1234567890-abcdefghijklmnop.apps.googleusercontent.com',
      workspaceDomain: 'Company.CO.JP',
      labelIds: ['INBOX', 'Label_SES'],
      query: '案件 OR 要員',
      lookbackDays: 30,
      maxMessagesPerRun: 200,
      expectedRevision: null,
      readonlyAcknowledged: true as const
    }
    const first = repository.saveGoogleWorkspaceAdminConfiguration(input, 'ローカル管理者')
    expect(first).toMatchObject({ workspaceDomain: 'company.co.jp', revision: 1, source: 'local-admin' })
    expect(() => repository.saveGoogleWorkspaceAdminConfiguration(input, 'ローカル管理者')).toThrow(/更新されました/)
    expect(() =>
      repository.saveGoogleWorkspaceAdminConfiguration({ ...input, expectedRevision: 1, query: 'from:(x)' }, 'ローカル管理者')
    ).toThrow()
    const second = repository.saveGoogleWorkspaceAdminConfiguration({ ...input, expectedRevision: 1, lookbackDays: 60 }, 'ローカル管理者')
    expect(second).toMatchObject({ revision: 2, lookbackDays: 60 })
  })

  it('never leaves raw identifiers or a plaintext SQLite header in the database file', () => {
    const { repository } = handle
    saveRedactedGmailMessage(repository, {
      subject: `Java案件 ${rawName}`,
      body: `連絡先 ${rawPhone} ${rawEmail}`,
      personNames: [rawName]
    })
    repository.checkpoint()
    repository.close()
    const bytes = readFileSync(handle.path)
    expect(bytes.includes(Buffer.from('SQLite format 3'))).toBe(false)
    for (const secret of [rawName, rawPhone, rawEmail, 'Java案件']) {
      expect(bytes.includes(Buffer.from(secret))).toBe(false)
    }
    // Reopening with the same keys still reads the message.
    expect(handle.reopen().countGmailMessages(testAccount)).toBe(1)
  })
})
