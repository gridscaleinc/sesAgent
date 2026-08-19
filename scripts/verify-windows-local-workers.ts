import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import * as XLSX from 'xlsx'
import {
  LocalEmbeddingWorkerClient,
  LocalRerankerWorkerClient,
  localEmbeddingModel,
  localRerankerModel
} from '@local-ai'
import { ParserWorkerClient } from '@parsers/worker-client'
import type { StagedLocalFile } from '@shared/contracts'

const root = process.cwd()
const launcherPath = resolve(root, 'build/native/windows/ocr/ses-ocr-sandbox.exe')
const parserWorkerPath = resolve(root, 'out/main/parser-worker.js')
const embeddingWorkerPath = resolve(root, 'out/main/embedding-worker.js')
const rerankerWorkerPath = resolve(root, 'out/main/reranker-worker.js')
const networkProbePath = resolve(root, 'out/main/windows-network-probe.js')
const modelDirectory = resolve(root, 'models/Xenova/multilingual-e5-small')
const rerankerModelDirectory = resolve(root, 'models/hotchpotch/japanese-reranker-tiny-v2')

if (process.platform !== 'win32' || process.arch !== 'x64') {
  process.stdout.write(`${JSON.stringify({
    platform: process.platform,
    arch: process.arch,
    verified: false,
    skipped: true,
    reason: 'windows-x64-runtime-required'
  })}\n`)
  process.exit(0)
}

const server = createServer((socket) => socket.end('reachable'))
await new Promise<void>((resolvePromise, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolvePromise)
})

let unsandboxedLoopbackReachable = false
let sandboxedLoopbackDenied = false
try {
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const port = address.port
  await new Promise<void>((resolvePromise, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      unsandboxedLoopbackReachable = true
      socket.destroy()
      resolvePromise()
    })
    socket.once('error', reject)
  })
  const probe = await new Promise<{ loopbackDenied: boolean; errorCode: string | null }>((resolvePromise, reject) => {
    const child = spawn(launcherPath, [
      '--profile', 'jp.sesai.agentdesktop.localworkers',
      '--grant-read', root,
      '--grant-read', dirname(process.execPath),
      '--', process.execPath, networkProbePath
    ], {
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        ComSpec: process.env.ComSpec,
        PATHEXT: process.env.PATHEXT,
        PROCESSOR_ARCHITECTURE: process.env.PROCESSOR_ARCHITECTURE,
        SES_NETWORK_PROBE_PORT: String(port)
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const output: Buffer[] = []
    const errors: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
    child.once('error', reject)
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`AppContainer local-worker network probe failed (${code}): ${Buffer.concat(errors).toString('utf8')}`))
        return
      }
      try {
        resolvePromise(JSON.parse(Buffer.concat(output).toString('utf8')) as { loopbackDenied: boolean; errorCode: string | null })
      } catch (error) {
        reject(error)
      }
    })
  })
  sandboxedLoopbackDenied = probe.loopbackDenied
  assert.equal(sandboxedLoopbackDenied, true, 'AppContainer local worker reached loopback without a network capability')
} finally {
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
}

const windowsSandbox = {
  launcherPath,
  grantReadRoots: [root, dirname(process.execPath)]
}
const worksheet = XLSX.utils.aoa_to_sheet([
  ['Skill', 'Years'],
  ['APPCONTAINER_PARSER_SENTINEL', 7]
])
const workbook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(workbook, worksheet, 'Skills')
const parserBytes = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
const stagedFile: StagedLocalFile = {
  token: 'f99772c2-b608-453f-8a1b-a6192abbf003',
  name: 'appcontainer-parser-verification.xlsx',
  format: 'xlsx',
  size: parserBytes.length,
  sha256: createHash('sha256').update(parserBytes).digest('hex'),
  createdAt: '2026-07-20T00:00:00.000Z',
  privacyStatus: 'awaiting-local-scan'
}
const parser = new ParserWorkerClient({
  workerPath: parserWorkerPath,
  windowsSandbox,
  timeoutMs: 30_000
})
const parsedDocument = await parser.parse(stagedFile, parserBytes)
assert.equal(
  parsedDocument.blocks.some((block) => block.text === 'APPCONTAINER_PARSER_SENTINEL'),
  true,
  'AppContainer parser did not return the expected local document content'
)
assert.equal(parsedDocument.security.rawFileCloudEligible, false)

const embedding = new LocalEmbeddingWorkerClient({
  workerPath: embeddingWorkerPath,
  modelDirectory,
  windowsSandbox,
  timeoutMs: 120_000
})
let embeddingCompleted = false
try {
  const vectors = await embedding.embedQueries(['AppContainer 内でローカル候補者検索を実行する'])
  assert.equal(vectors.length, 1)
  assert.equal(vectors[0]?.length, localEmbeddingModel.dimension)
  embeddingCompleted = true
} finally {
  embedding.dispose()
}

const reranker = new LocalRerankerWorkerClient({
  workerPath: rerankerWorkerPath,
  modelDirectory: rerankerModelDirectory,
  windowsSandbox,
  timeoutMs: 120_000
})
let rerankerCompleted = false
try {
  const scores = await reranker.rerank('AWS と Terraform によるクラウド基盤設計', [
    { id: 'relevant', text: 'AWS Terraform を用いたクラウド基盤の設計と構築を担当' },
    { id: 'irrelevant', text: '飲食店での接客と店舗運営を担当' }
  ])
  assert.ok((scores.get('relevant') ?? Number.NEGATIVE_INFINITY) > (scores.get('irrelevant') ?? Number.POSITIVE_INFINITY))
  rerankerCompleted = true
} finally {
  reranker.dispose()
}

const launcherBytes = await readFile(launcherPath)
const evidence = {
  version: 'windows-release-evidence-v1',
  kind: 'local-worker-kernel-network-deny',
  verified: true,
  platform: process.platform,
  arch: process.arch,
  mechanism: 'appcontainer-no-network-capabilities',
  appContainerProfile: 'jp.sesai.agentdesktop.localworkers',
  appContainerCapabilities: [],
  unsandboxedLoopbackReachable,
  sandboxedLoopbackDenied,
  parserCompleted: true,
  embeddingCompleted,
  rerankerCompleted,
  launcherSha256: createHash('sha256').update(launcherBytes).digest('hex')
}
await mkdir(resolve(root, 'build/windows-verification'), { recursive: true })
await writeFile(
  resolve(root, 'build/windows-verification/local-worker-network-policy.json'),
  `${JSON.stringify(evidence, null, 2)}\n`,
  { encoding: 'utf8', mode: 0o600 }
)
process.stdout.write(`${JSON.stringify({
  parserCompleted: evidence.parserCompleted,
  embeddingCompleted: evidence.embeddingCompleted,
  embeddingDimension: localEmbeddingModel.dimension,
  rerankerCompleted: evidence.rerankerCompleted,
  rerankerModel: localRerankerModel.id,
  kernelNetworkIsolationVerified: true,
  mechanism: evidence.mechanism,
  releaseEligible: true
})}\n`)
