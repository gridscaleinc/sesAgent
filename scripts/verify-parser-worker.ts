import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { ParserWorkerClient, parserWorkerEnvironmentKeys } from '@parsers/worker-client'
import type { StagedLocalFile } from '@shared/contracts'

const worksheet = XLSX.utils.aoa_to_sheet([
  ['Skill', 'Years'],
  ['WORKER_SENTINEL_JAVA', 7]
])
const workbook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(workbook, worksheet, 'Skills')
const bytes = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
const file: StagedLocalFile = {
  token: '3157b84b-865b-48d7-8070-5ace776237cb',
  name: 'worker-verification.xlsx',
  format: 'xlsx',
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  createdAt: '2026-07-17T00:00:00.000Z',
  privacyStatus: 'awaiting-local-scan'
}

const client = new ParserWorkerClient({
  workerPath: resolve('out/main/parser-worker.js'),
  timeoutMs: 10_000
})
const result = await client.parse(file, bytes)
assert.equal(result.blocks.some((block) => block.text === 'WORKER_SENTINEL_JAVA'), true)
assert.deepEqual(parserWorkerEnvironmentKeys, ['ELECTRON_RUN_AS_NODE', 'NODE_ENV', 'LANG', 'TZ'])
assert.equal(result.security.externalContentLoaded, false)
assert.equal(result.security.macrosExecuted, false)
assert.equal(result.security.rawFileCloudEligible, false)

const stdioResult = await new Promise<Record<string, unknown>>((resolvePromise, reject) => {
  const child = spawn(process.execPath, [resolve('out/main/parser-worker.js'), '--stdio'], {
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      LANG: 'ja_JP.UTF-8',
      TZ: 'Asia/Tokyo'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const output: Buffer[] = []
  const errors: Buffer[] = []
  const timeout = setTimeout(() => {
    child.kill('SIGKILL')
    reject(new Error('Parser stdio verification timed out.'))
  }, 15_000)
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
  child.once('error', reject)
  child.once('close', (code) => {
    clearTimeout(timeout)
    if (code !== 0) {
      reject(new Error(`Parser stdio worker failed (${code}): ${Buffer.concat(errors).toString('utf8')}`))
      return
    }
    try {
      resolvePromise(JSON.parse(Buffer.concat(output).toString('utf8').trim()) as Record<string, unknown>)
    } catch (error) {
      reject(error)
    }
  })
  const metadata = Buffer.from(JSON.stringify({ id: randomUUID(), kind: 'parse-document', file }), 'utf8')
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32LE(metadata.length, 0)
  child.stdin.write(length)
  child.stdin.write(metadata)
  child.stdin.end(bytes)
})
assert.equal(stdioResult.ok, true)
assert.equal(JSON.stringify(stdioResult).includes('WORKER_SENTINEL_JAVA'), true)

process.stdout.write(
  `${JSON.stringify({
    isolatedProcess: true,
    sourceReference: result.blocks.find((block) => block.text === 'WORKER_SENTINEL_JAVA')?.source,
    forwardedEnvironmentKeys: parserWorkerEnvironmentKeys,
    stdioProtocolVerified: true,
    rawFileCloudEligible: result.security.rawFileCloudEligible
  })}\n`
)
