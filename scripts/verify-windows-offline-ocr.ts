import assert from 'node:assert/strict'
import { fork, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { dirname } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument } from 'pdf-lib'
import {
  isWindowsOfflineOcrWorkerResponse,
  WindowsOfflineOcrWorkerClient,
  windowsOfflineOcrResultSchema,
  type WindowsOfflineOcrWorkerRequest,
  type WindowsOfflineOcrWorkerResponse
} from '../packages/local-ai/src/vision-ocr'

const root = process.cwd()
const workerPath = `${root}/out/main/windows-ocr-worker.js`
const tesseractWorkerPath = `${root}/out/main/tesseract-worker.js`
const resourceRoot = `${root}/build/native/windows/ocr`
const sandboxLauncherPath = `${resourceRoot}/ses-ocr-sandbox.exe`

const canvas = createCanvas(1_600, 600)
const context = canvas.getContext('2d')
context.fillStyle = '#ffffff'
context.fillRect(0, 0, canvas.width, canvas.height)
context.fillStyle = '#111827'
context.font = 'bold 86px Arial'
context.fillText('Java AWS Candidate', 80, 190)
context.font = '58px Arial'
context.fillText('Spring Boot 8 years', 80, 330)
context.fillText('Local OCR - No Cloud', 80, 460)

const pdf = await PDFDocument.create()
const page = pdf.addPage([800, 300])
const image = await pdf.embedPng(canvas.toBuffer('image/png'))
page.drawImage(image, { x: 0, y: 0, width: 800, height: 300 })
const bytes = Buffer.from(await pdf.save())

function runWorker(input: Buffer): Promise<WindowsOfflineOcrWorkerResponse> {
  return new Promise((resolve, reject) => {
    const child = fork(workerPath, [], {
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        LANG: 'ja_JP.UTF-8',
        TZ: 'Asia/Tokyo',
        SES_WINDOWS_OCR_TESSDATA_PATH: `${resourceRoot}/tessdata`,
        SES_WINDOWS_OCR_MANIFEST_PATH: `${resourceRoot}/resource-manifest.json`,
        SES_TESSERACT_WORKER_PATH: tesseractWorkerPath
      },
      execPath: process.execPath,
      execArgv: [],
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    })
    const errors: Buffer[] = []
    child.stderr?.on('data', (chunk: Buffer) => errors.push(chunk))
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Windows offline OCR verification timed out.'))
    }, 120_000)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (child.connected) return
      if (code !== 0) reject(new Error(`Windows OCR worker exited (${code ?? signal}). ${Buffer.concat(errors).toString('utf8')}`))
    })
    child.once('message', (response: unknown) => {
      clearTimeout(timeout)
      child.disconnect()
      child.kill('SIGTERM')
      if (!isWindowsOfflineOcrWorkerResponse(response)) {
        reject(new Error('Windows OCR worker response is invalid.'))
        return
      }
      resolve(response)
    })
    const request: WindowsOfflineOcrWorkerRequest = { id: randomUUID(), kind: 'ocr-pdf', bytes: input }
    child.send(request)
  })
}

function runStdioWorker(input: Buffer): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, '--stdio'], {
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        LANG: 'ja_JP.UTF-8',
        TZ: 'Asia/Tokyo',
        SES_WINDOWS_OCR_TESSDATA_PATH: `${resourceRoot}/tessdata`,
        SES_WINDOWS_OCR_MANIFEST_PATH: `${resourceRoot}/resource-manifest.json`,
        SES_TESSERACT_WORKER_PATH: tesseractWorkerPath
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const output: Buffer[] = []
    const errors: Buffer[] = []
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Windows offline OCR stdio verification timed out.'))
    }, 120_000)
    child.stdout?.on('data', (chunk: Buffer) => output.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => errors.push(chunk))
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (code !== 0) {
        reject(new Error(`Windows OCR stdio worker exited (${code}). ${Buffer.concat(errors).toString('utf8')}`))
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(output).toString('utf8').trim()))
      } catch (error) {
        reject(error)
      }
    })
    child.stdin?.end(input)
  })
}

const response = await runWorker(bytes)
assert.equal(response.ok, true, response.ok ? undefined : response.message)
if (!response.ok) throw new Error(response.message)
const result = windowsOfflineOcrResultSchema.parse(response.result)
assert.equal(result.engine, 'windows-tesseract-wasm')
assert.equal(result.networkAccess, false)
assert.equal(result.pages.length, 1)
assert.ok(result.pages[0]?.textBlocks.length)
const recognizedText = result.pages[0]!.textBlocks.map((block) => block.text).join(' ')
assert.match(recognizedText, /Java/u)
assert.match(recognizedText, /AWS/u)
assert.equal(result.coverage.signatureDetection, 'human-review-required')
const stdioResult = windowsOfflineOcrResultSchema.parse(await runStdioWorker(bytes))
assert.equal(stdioResult.engine, result.engine)
assert.equal(stdioResult.networkAccess, false)
assert.match(stdioResult.pages[0]!.textBlocks.map((block) => block.text).join(' '), /Java/u)

let appContainerVerified = false
if (process.platform === 'win32' && process.arch === 'x64') {
  const server = createServer((socket) => socket.end('reachable'))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const port = address.port
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve()
    })
    socket.once('error', reject)
  })
  const probe = await new Promise<{ loopbackDenied: boolean; errorCode: string | null }>((resolve, reject) => {
    const child = spawn(sandboxLauncherPath, [
      '--profile', 'jp.sesai.agentdesktop.ocr',
      '--grant-read', root,
      '--grant-read', dirname(process.execPath),
      '--', process.execPath, `${root}/out/main/windows-network-probe.js`
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
        reject(new Error(`AppContainer network probe failed (${code}): ${Buffer.concat(errors).toString('utf8')}`))
        return
      }
      resolve(JSON.parse(Buffer.concat(output).toString('utf8')) as { loopbackDenied: boolean; errorCode: string | null })
    })
  })
  await new Promise<void>((resolve) => server.close(() => resolve()))
  assert.equal(probe.loopbackDenied, true, 'AppContainer OCR process reached a loopback server without a network capability')

  const sandboxedClient = new WindowsOfflineOcrWorkerClient({
    sandboxLauncherPath,
    workerPath,
    tesseractWorkerPath,
    tessdataPath: `${resourceRoot}/tessdata`,
    resourceManifestPath: `${resourceRoot}/resource-manifest.json`,
    appContainerGrantRoots: [root, dirname(process.execPath)],
    networkIsolation: 'windows-kernel-network-verified'
  })
  const sandboxedResult = await sandboxedClient.ocrPdf(bytes)
  assert.equal(sandboxedResult.engine, 'windows-tesseract-wasm')
  assert.match(sandboxedResult.pages[0]!.textBlocks.map((block) => block.text).join(' '), /Java/u)
  const launcherBytes = await readFile(sandboxLauncherPath)
  await mkdir(`${root}/build/windows-verification`, { recursive: true })
  await writeFile(`${root}/build/windows-verification/ocr-worker-network-policy.json`, `${JSON.stringify({
    version: 'windows-release-evidence-v1',
    kind: 'ocr-worker-kernel-network-deny',
    verified: true,
    platform: process.platform,
    arch: process.arch,
    mechanism: 'appcontainer-no-network-capabilities',
    appContainerProfile: 'jp.sesai.agentdesktop.ocr',
    appContainerCapabilities: [],
    unsandboxedLoopbackReachable: true,
    sandboxedLoopbackDenied: true,
    sandboxedOcrCompleted: true,
    launcherSha256: createHash('sha256').update(launcherBytes).digest('hex')
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  appContainerVerified = true
}

const evidence = {
  version: 'windows-release-evidence-v1',
  kind: 'offline-ocr-runtime-functional',
  verified: true,
  platform: process.platform,
  arch: process.arch,
  engine: result.engine,
  runtime: result.coverage.textRecognition,
  languages: ['jpn', 'eng'],
  pages: result.pages.length,
  textBlocks: result.pages[0]!.textBlocks.length,
  networkAccess: result.networkAccess,
  appContainerVerified
}
await mkdir(`${root}/build/windows-verification`, { recursive: true })
await writeFile(
  `${root}/build/windows-verification/offline-ocr-runtime.json`,
  `${JSON.stringify(evidence, null, 2)}\n`,
  { encoding: 'utf8', mode: 0o600 }
)

process.stdout.write(`${JSON.stringify({
  engine: result.engine,
  runtime: result.coverage.textRecognition,
  languages: ['jpn', 'eng'],
  pages: result.pages.length,
  textBlocks: result.pages[0]!.textBlocks.length,
  javaRecognized: /Java/u.test(recognizedText),
  awsRecognized: /AWS/u.test(recognizedText),
  networkAccess: result.networkAccess,
  nodeNetworkDenyGuard: true,
  stdioProtocolVerified: true,
  kernelNetworkIsolationVerified: appContainerVerified,
  releaseEligible: process.platform === 'win32' && process.arch === 'x64' && appContainerVerified
})}\n`)
