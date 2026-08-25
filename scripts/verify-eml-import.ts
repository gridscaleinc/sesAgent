import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRedactedEmlJobCaseSource, extractJobCaseDraft } from '@job-cases'
import { ParserWorkerClient } from '@parsers/worker-client'
import { EncryptedApplicationRepository } from '@persistence'

const personSentinel = '山田取込検証'
const phoneSentinel = '090-8642-1357'
const emailSentinel = 'yamada.import@example.jp'
const attachmentSentinel = 'RAW_EML_ATTACHMENT_MUST_NOT_PERSIST'
const bytes = Buffer.from([
  `From: ${personSentinel} <${emailSentinel}>`,
  'To: sales@example.co.jp',
  'Subject: Java / AWS 決済基盤案件',
  'Message-ID: <eml-import-verification@partner.example.jp>',
  'Date: Fri, 17 Jul 2026 09:30:00 +0900',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="import-boundary"',
  '',
  '--import-boundary',
  'Content-Type: text/plain; charset=utf-8',
  '',
  `担当：${personSentinel}`,
  `電話：${phoneSentinel}`,
  `メール：${emailSentinel}`,
  '募集ロール：バックエンドエンジニア',
  '必須スキル：Java / Spring Boot / AWS',
  '単価：90万円/月',
  '--import-boundary',
  'Content-Type: text/plain; name="private.txt"',
  'Content-Disposition: attachment; filename="private.txt"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from(attachmentSentinel).toString('base64'),
  '--import-boundary--'
].join('\r\n'), 'utf8')
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ses-agent-eml-import-'))
const databasePath = join(temporaryDirectory, 'eml-import.db')
const databaseKey = randomBytes(32)
const mappingKey = randomBytes(32)

try {
  const parser = new ParserWorkerClient({ workerPath: resolve('out/main/parser-worker.js'), timeoutMs: 10_000 })
  const manifest = {
    name: 'case.eml',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
  const parsed = await parser.parseEml(manifest, bytes)
  assert.equal(parsed.classification, 'job-case')
  assert.equal(parsed.security.attachmentsPersisted, false)
  assert.equal(JSON.stringify(parsed).includes(attachmentSentinel), false)

  const repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  const sourceId = randomUUID()
  const processed = createRedactedEmlJobCaseSource(parsed, sourceId, [personSentinel], new Date('2026-07-19T00:00:00.000Z'))
  const draft = extractJobCaseDraft(processed.source, randomUUID(), new Date('2026-07-19T00:00:00.000Z'))
  assert.equal(repository.saveRedactedJobCaseSourceAndDraft(
    processed.redaction.session,
    processed.redaction.mappings,
    processed.source,
    draft
  ), true)
  const review = repository.getJobCaseReview(draft.reviewId)
  assert.ok(review)
  assert.equal(review.sourceType, 'eml')
  assert.equal(review.cloudEligible, false)
  assert.equal(review.redactedPreview.includes(personSentinel), false)
  assert.equal(review.redactedPreview.includes(phoneSentinel), false)
  assert.equal(review.redactedPreview.includes(emailSentinel), false)
  assert.equal(review.redactedPreview.includes('<PERSON_NAME_001>'), true)
  assert.equal(review.redactedPreview.includes('<PHONE_001>'), true)
  assert.equal(review.redactedPreview.includes('<PRIVATE_EMAIL_001>'), true)
  assert.equal(repository.getEmlJobCaseReview(parsed.sourceMessageKey)?.reviewId, review.reviewId)
  assert.equal(repository.getLocalPiiMappings(processed.redaction.session.id).some((mapping) => mapping.originalValue === phoneSentinel), true)
  repository.close()

  const databaseBytes = await readFile(databasePath)
  for (const forbidden of [personSentinel, phoneSentinel, emailSentinel, attachmentSentinel, 'SQLite format 3']) {
    assert.equal(databaseBytes.includes(Buffer.from(forbidden)), false, `EML import leaked ${forbidden}`)
  }

  const reopened = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  assert.equal(reopened.getSchemaVersion(), 39)
  assert.equal(reopened.getEmlJobCaseReview(parsed.sourceMessageKey)?.reviewId, review.reviewId)
  reopened.close()
  bytes.fill(0)

  process.stdout.write(`${JSON.stringify({
    isolatedParser: true,
    sourceType: review.sourceType,
    duplicateKeyRecovered: true,
    directIdentifiersRedacted: true,
    attachmentPersisted: parsed.security.attachmentsPersisted,
    rawFileCloudEligible: parsed.security.rawFileCloudEligible,
    encryptedDatabase: true,
    schemaVersion: 39
  })}\n`)
} finally {
  bytes.fill(0)
  databaseKey.fill(0)
  mappingKey.fill(0)
  await rm(temporaryDirectory, { recursive: true, force: true })
}
