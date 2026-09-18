import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { EncryptedFileVault } from '@files'
import { GmailReadClient, GmailSyncCoordinator, gmailSyncConfigurationSchema, redactGmailMessageForLocalStorage } from '@mail'
import { EncryptedApplicationRepository } from '@persistence'
import { ParserWorkerClient } from '@parsers/worker-client'
import { createJobCaseDraftsForPendingGmailMessages } from '../apps/desktop/src/main/gmail-job-case-intake'
import { importPendingGmailPersonnel } from '../apps/desktop/src/main/gmail-personnel-intake'
import type { MainIpcContext } from '../apps/desktop/src/main/ipc/context'

// Synthetic transport, actual MIME decoding, parser worker, encrypted vault,
// source extraction and repository. No user mailbox or credentials are read.
const directory = await mkdtemp(join(tmpdir(), 'ses-gmail-intake-'))
const databaseKey = randomBytes(32), mappingKey = randomBytes(32), fileKey = randomBytes(32)
const databasePath = join(directory, 'intake.db')
const account = 'synthetic-hr@example.com'
const now = new Date()
const workbook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ['氏名', '添付検証太郎'], ['スキル', 'Java、Spring Boot、AWS'], ['経験年数', '8年'], ['希望単価', '80万円'], ['稼働開始', '2026年10月']
]), 'スキルシート')
const attachment = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
const fixtures = [
  { id: 'case1', subject: 'Java決済基盤開発案件', body: '案件名：Java決済基盤開発\n必須スキル：Java、Spring Boot\n単価：90万円\n勤務地：東京\n開始時期：2026年10月' },
  { id: 'person1', subject: '要員紹介', body: '氏名：本文検証花子\nスキル：Python、Django\n経験年数：6年\n希望単価：70万円' },
  { id: 'attachment1', subject: '資料送付', body: '単価：80万円\n稼働：2026年10月', attachment: true },
  { id: 'attachment2', subject: '資料再送', body: '単価：85万円\n稼働：2026年11月', attachment: true },
  { id: 'irrelevant', subject: 'お知らせ', body: '週末のイベントのお知らせです。' }
]
fixtures.push({ ...fixtures[0]!, id: 'case2' })
let profileHistoryId = '100'
const requests: string[] = []
const fetcher = (async (input, init) => {
  assert.equal(init?.method, 'GET')
  const url = new URL(String(input)); requests.push(url.pathname)
  if (url.pathname.endsWith('/profile')) return Response.json({ emailAddress: account, historyId: profileHistoryId })
  if (url.pathname.endsWith('/history')) return Response.json({ historyId: profileHistoryId })
  if (url.pathname.endsWith('/messages')) {
    const offset = Number(url.searchParams.get('pageToken') ?? 0), limit = Number(url.searchParams.get('maxResults'))
    assert.ok(limit <= 2)
    return Response.json({ messages: fixtures.slice(offset, offset + limit).map(item => ({ id: item.id, threadId: item.id })),
      ...(offset + limit < fixtures.length ? { nextPageToken: String(offset + limit) } : {}) })
  }
  if (url.pathname.includes('/attachments/')) return Response.json({ size: attachment.length, data: attachment.toString('base64url') })
  const fixture = fixtures.find(item => url.pathname.endsWith(`/messages/${item.id}`))!
  assert.ok(fixture)
  return Response.json({ id: fixture.id, threadId: fixture.id, historyId: '99', labelIds: ['INBOX'], internalDate: String(now.getTime() - 60_000),
    payload: { mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: fixture.subject }, { name: 'From', value: 'partner@example.com' }],
      parts: [{ mimeType: 'text/plain', body: { data: Buffer.from(fixture.body).toString('base64url') } },
        ...(fixture.attachment ? [{ filename: 'スキルシート.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: { attachmentId: 'resume1', size: attachment.length } }] : [])] } })
}) as typeof fetch
const gmail = new GmailReadClient(async () => 'synthetic-token', fetcher)
const config = gmailSyncConfigurationSchema.parse({ version: 'gmail-sync-config-v1', labelIds: ['INBOX'], query: '案件 OR 要員 OR 単価', lookbackDays: 30, maxMessagesPerRun: 2 })
let repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
const runs = []
try {
  for (let batch = 0; batch < 3; batch++) {
    const coordinator = new GmailSyncCoordinator(gmail, repository, async message => {
      const processed = redactGmailMessageForLocalStorage(message, account, [], now)
      repository.saveRedactionSession(processed.redaction.session, processed.redaction.mappings)
      return processed.message
    }, () => now)
    assert.equal((await coordinator.synchronize(account, config)).errorCode, null)
    const cases = createJobCaseDraftsForPendingGmailMessages(repository, account, { operatorId: 'verification', displayName: 'Verification HR' })
    const context = { repository, fileVault: new EncryptedFileVault({ directory: join(directory, 'vault'), key: fileKey }),
      parserWorker: new ParserWorkerClient({ workerPath: resolve('out/main/parser-worker.js') }), localNer: null, localOcr: null,
      processingResources: { run: async (_kind: string, operation: () => Promise<unknown>) => operation() } } as unknown as MainIpcContext
    const personnel = await importPendingGmailPersonnel(context, gmail, account)
    assert.equal(personnel.failed, 0)
    repository.saveGmailIntakeResult(account, { casesCreated: cases.created, casesConfirmed: cases.confirmed,
      casesNeedAttention: cases.needsAttention, casesFailed: cases.failed, personnelCreated: personnel.personnel, personnelFailed: personnel.failed })
    const checkpoint = repository.getGmailSyncCheckpoint(account)!
    runs.push(checkpoint.lastRun)
    assert.equal(checkpoint.historyId, '100')
    repository.close()
    repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
    assert.deepEqual(repository.getGmailSyncCheckpoint(account), checkpoint)
    profileHistoryId = '200'
  }
  assert.equal(repository.countGmailMessages(account), 5)
  assert.equal(repository.listJobCaseReviews().length, 1)
  assert.equal(repository.listJobCaseReviews()[0]!.status, 'completed')
  assert.equal(repository.listCandidateReviews().length, 2)
  assert.ok(repository.listCandidateReviews().every(item => repository.getCurrentCandidateProfile(item.documentId)))
  assert.equal(repository.getGmailSyncCheckpoint(account)?.lastRun?.continuation, undefined)
  assert.equal(repository.getGmailSyncCheckpoint(account)?.lastRun?.intake?.pendingPersonnel, 0)
  assert.equal(repository.getGmailSyncCheckpoint(account)?.lastRun?.intake?.pendingCases, 0)
  assert.equal(runs.reduce((sum, run) => sum + (run?.intake?.personnelCreated ?? 0), 0), 2)
  assert.equal(requests.filter(path => path.includes('/attachments/')).length, 2)
  repository.close()
  const databaseBytes = await readFile(databasePath)
  for (const text of [account, '本文検証花子', '添付検証太郎', 'SQLite format 3']) assert.equal(databaseBytes.includes(Buffer.from(text)), false)
  console.log(JSON.stringify({ transport: 'synthetic-get-only', realParserWorker: true, realEncryptedDatabase: true,
    restartAfterEveryBatch: true, batches: runs.length, mails: 5, cases: 1, personnel: 2, duplicateAttachmentReused: true, duplicateCaseSkipped: true,
    checkpointAndIntakePersisted: true, plaintextAbsent: true }))
} finally {
  try { repository.close() } catch { /* May already be closed. */ }
  attachment.fill(0); databaseKey.fill(0); mappingKey.fill(0); fileKey.fill(0)
  await rm(directory, { recursive: true, force: true })
}
