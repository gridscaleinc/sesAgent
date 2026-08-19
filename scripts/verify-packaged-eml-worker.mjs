import { fork } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'

const asarPath = resolve(process.argv[2] ?? '')
if (!asarPath.endsWith('.asar')) throw new Error('Packaged application ASAR path is required.')
const attachmentSentinel = 'PACKAGED_EML_ATTACHMENT_MUST_NOT_ESCAPE'
const bytes = Buffer.from([
  'From: Test User <test.user@partner.example.jp>',
  'Subject: Java / AWS 案件',
  'Message-ID: <packaged-parser@partner.example.jp>',
  'Content-Type: multipart/mixed; boundary="package-boundary"',
  '',
  '--package-boundary',
  'Content-Type: text/plain; charset=utf-8',
  '',
  '必須スキル：Java / AWS',
  '--package-boundary',
  'Content-Type: text/plain; name="private.txt"',
  'Content-Disposition: attachment; filename="private.txt"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from(attachmentSentinel).toString('base64'),
  '--package-boundary--'
].join('\r\n'), 'utf8')
const request = {
  id: randomUUID(),
  kind: 'parse-eml',
  file: {
    name: 'package-verification.eml',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  },
  bytes
}

try {
  const message = await new Promise((resolveMessage, reject) => {
    const child = fork(join(asarPath, 'out', 'main', 'parser-worker.js'), [], {
      execPath: process.execPath,
      execArgv: [],
      env: { ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', LANG: 'ja_JP.UTF-8', TZ: 'Asia/Tokyo' },
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    })
    let settled = false
    const finish = (operation) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (child.connected) child.disconnect()
      if (child.exitCode === null && !child.killed) child.kill('SIGTERM')
      operation()
    }
    const timeout = setTimeout(() => finish(() => reject(new Error('Packaged EML parser worker timed out.'))), 15_000)
    child.once('error', (error) => finish(() => reject(error)))
    child.once('exit', (code, signal) => {
      if (!settled) finish(() => reject(new Error(`Packaged EML worker exited early (${code ?? signal ?? 'unknown'}).`)))
    })
    child.once('message', (response) => {
      if (!response || typeof response !== 'object' || response.id !== request.id || response.kind !== 'parse-eml' || response.ok !== true) {
        finish(() => reject(new Error('Packaged EML worker returned an invalid response.')))
        return
      }
      finish(() => resolveMessage(response.message))
    })
    child.send(request, (error) => {
      if (error) finish(() => reject(error))
    })
  })
  if (!message || JSON.stringify(message).includes(attachmentSentinel)) {
    throw new Error('Packaged EML worker exposed attachment content.')
  }
  process.stdout.write(`${JSON.stringify({
    version: message.version,
    classification: message.classification,
    attachmentCount: message.attachmentCount,
    externalContentLoaded: message.security?.externalContentLoaded,
    attachmentPersisted: message.security?.attachmentsPersisted,
    rawFileCloudEligible: message.security?.rawFileCloudEligible
  })}\n`)
} finally {
  bytes.fill(0)
}
