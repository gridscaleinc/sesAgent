import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { ParserWorkerClient, parserWorkerEnvironmentKeys } from '@parsers/worker-client'

const bytes = Buffer.from([
  'From: Test User <test.user@partner.example.jp>',
  'To: sales@example.co.jp',
  'Subject: Java / AWS 案件',
  'Message-ID: <worker-verification@partner.example.jp>',
  'Date: Fri, 17 Jul 2026 09:30:00 +0900',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="worker-boundary"',
  '',
  '--worker-boundary',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>必須スキル：Java / AWS</p><img src="https://network-must-not-load.invalid/pixel">',
  '--worker-boundary',
  'Content-Type: text/plain; name="secret.txt"',
  'Content-Disposition: attachment; filename="secret.txt"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('EML_WORKER_PRIVATE_ATTACHMENT').toString('base64'),
  '--worker-boundary--'
].join('\r\n'), 'utf8')

const client = new ParserWorkerClient({ workerPath: resolve('out/main/parser-worker.js'), timeoutMs: 10_000 })
const parsed = await client.parseEml({
  name: 'worker-verification.eml',
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex')
}, bytes)

assert.equal(parsed.classification, 'job-case')
assert.equal(parsed.attachmentCount, 1)
assert.equal(parsed.security.externalContentLoaded, false)
assert.equal(parsed.security.attachmentsPersisted, false)
assert.equal(parsed.security.rawFileCloudEligible, false)
assert.equal(JSON.stringify(parsed).includes('EML_WORKER_PRIVATE_ATTACHMENT'), false)
assert.deepEqual(parserWorkerEnvironmentKeys, ['ELECTRON_RUN_AS_NODE', 'NODE_ENV', 'LANG', 'TZ'])
bytes.fill(0)

process.stdout.write(`${JSON.stringify({
  isolatedProcess: true,
  classification: parsed.classification,
  attachmentCount: parsed.attachmentCount,
  attachmentPersisted: parsed.security.attachmentsPersisted,
  externalContentLoaded: parsed.security.externalContentLoaded,
  rawFileCloudEligible: parsed.security.rawFileCloudEligible,
  forwardedEnvironmentKeys: parserWorkerEnvironmentKeys
})}\n`)
