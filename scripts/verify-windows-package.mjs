import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { extractFile, listPackage } from '@electron/asar'
import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument } from 'pdf-lib'
import { privacyExpertReportFailures } from './privacy-expert-evidence.mjs'

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('The Windows package verifier must run on a Windows x64 host.')
}

const args = process.argv.slice(2)
const requireExpertReport = args.includes('--require-expert-report')
const positional = args.filter((value) => value !== '--require-expert-report')
const appPath = resolve(positional[0] ?? 'release/windows-dev/win-unpacked')
const executablePath = join(appPath, 'SES Agent Desktop.exe')
const resourcesPath = join(appPath, 'resources')
const asarPath = join(resourcesPath, 'app.asar')
const unpackedPath = join(resourcesPath, 'app.asar.unpacked')
const embeddingModelPath = join(resourcesPath, 'models', 'Xenova', 'multilingual-e5-small')
const rerankerModelPath = join(resourcesPath, 'models', 'hotchpotch', 'japanese-reranker-tiny-v2')
const privacyQualityReportPath = join(resourcesPath, 'verification', 'privacy-quality-report.json')
const privacyExpertReportPath = join(resourcesPath, 'verification', 'privacy-expert-report.json')
const cloudEnforcementManifestPath = join(resourcesPath, 'verification', 'cloud-enforcement-manifest.json')
const offlineOcrPath = join(resourcesPath, 'native', 'windows', 'ocr')
const userDataPath = await mkdtemp(join(tmpdir(), 'ses-agent-windows-package-smoke-'))

async function createOcrFixture() {
  const canvas = createCanvas(1_600, 600)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#111827'
  context.font = 'bold 86px Arial'
  context.fillText('Java AWS Candidate', 80, 190)
  context.font = '58px Arial'
  context.fillText('Packaged Local OCR', 80, 340)
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([800, 300])
  const image = await pdf.embedPng(canvas.toBuffer('image/png'))
  page.drawImage(image, { x: 0, y: 0, width: 800, height: 300 })
  const path = join(userDataPath, 'packaged-ocr-fixture.pdf')
  await writeFile(path, Buffer.from(await pdf.save()), { mode: 0o600 })
  return path
}

async function walk(directory) {
  const paths = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) paths.push(...await walk(path))
    else if (entry.isFile()) paths.push(path)
  }
  return paths
}

async function assertPeX64(path, label) {
  const bytes = await readFile(path)
  if (bytes.length < 0x40 || bytes.readUInt16LE(0) !== 0x5a4d) throw new Error(`${label} is not a PE executable.`)
  const peOffset = bytes.readUInt32LE(0x3c)
  if (peOffset + 6 > bytes.length || bytes.readUInt32LE(peOffset) !== 0x00004550) throw new Error(`${label} has an invalid PE header.`)
  if (bytes.readUInt16LE(peOffset + 4) !== 0x8664) throw new Error(`${label} is not x64.`)
}

async function verifyEmbeddingModel() {
  const manifest = JSON.parse(await readFile(join(embeddingModelPath, 'model-manifest.json'), 'utf8'))
  if (
    manifest.modelId !== 'Xenova/multilingual-e5-small' ||
    manifest.revision !== '761b726dd34fb83930e26aab4e9ac3899aa1fa78' ||
    manifest.embeddingDimension !== 384
  ) throw new Error('Packaged embedding model manifest is invalid.')
  for (const file of manifest.files) {
    const path = join(embeddingModelPath, file.path)
    const metadata = await stat(path)
    const hash = createHash('sha256')
    await pipeline(createReadStream(path), hash)
    if (!metadata.isFile() || metadata.size !== file.bytes || hash.digest('hex') !== file.sha256) {
      throw new Error(`Packaged embedding model failed integrity verification: ${file.path}`)
    }
  }
  return manifest
}

async function verifyRerankerModel() {
  const manifest = JSON.parse(await readFile(join(rerankerModelPath, 'model-manifest.json'), 'utf8'))
  if (
    manifest.schemaVersion !== 'local-reranker-model-v1' ||
    manifest.modelId !== 'hotchpotch/japanese-reranker-tiny-v2' ||
    manifest.revision !== 'ba95175a4d53058816b971f31929f10c5cad8560' ||
    manifest.license !== 'MIT' || manifest.maximumSequenceLength !== 512 || manifest.maximumCandidates !== 20
  ) throw new Error('Packaged reranker model manifest is invalid.')
  const expectedFiles = manifest.files.filter((file) => file.platform === 'all' || file.platform === 'win32-x64')
  for (const file of expectedFiles) {
    const path = join(rerankerModelPath, file.path)
    const metadata = await stat(path)
    const hash = createHash('sha256')
    await pipeline(createReadStream(path), hash)
    if (!metadata.isFile() || metadata.size !== file.bytes || hash.digest('hex') !== file.sha256) {
      throw new Error(`Packaged reranker model failed integrity verification: ${file.path}`)
    }
  }
  try {
    await stat(join(rerankerModelPath, 'onnx', 'model_qint8_arm64.onnx'))
    throw new Error('Windows package contains the macOS reranker model.')
  } catch (error) {
    if (error instanceof Error && error.message === 'Windows package contains the macOS reranker model.') throw error
    if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error
  }
  return manifest
}

async function verifyOfflineOcrResources() {
  const manifest = JSON.parse(await readFile(join(offlineOcrPath, 'resource-manifest.json'), 'utf8'))
  if (
    manifest.version !== 'windows-offline-ocr-resources-v1' ||
    manifest.engine !== 'windows-tesseract-wasm' ||
    manifest.networkAccess !== false ||
    JSON.stringify(manifest.languages) !== JSON.stringify(['jpn', 'eng'])
  ) throw new Error('Packaged Windows offline OCR manifest is invalid.')
  for (const file of manifest.files) {
    const path = join(offlineOcrPath, 'tessdata', `${file.language}.traineddata.gz`)
    const bytes = await readFile(path)
    if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      throw new Error(`Packaged Windows OCR resource failed integrity verification: ${file.language}`)
    }
  }
  if (!manifest.sandboxLauncher || manifest.sandboxLauncher.path !== 'ses-ocr-sandbox.exe') {
    throw new Error('Packaged Windows OCR sandbox launcher manifest is missing.')
  }
  const launcherPath = join(offlineOcrPath, manifest.sandboxLauncher.path)
  const launcherBytes = await readFile(launcherPath)
  if (
    launcherBytes.length !== manifest.sandboxLauncher.bytes ||
    createHash('sha256').update(launcherBytes).digest('hex') !== manifest.sandboxLauncher.sha256
  ) throw new Error('Packaged Windows OCR sandbox launcher failed integrity verification.')
  await assertPeX64(launcherPath, 'Windows AppContainer sandbox launcher')
  const evidence = JSON.parse(await readFile(join(offlineOcrPath, 'network-isolation-evidence.json'), 'utf8'))
  if (
    evidence.version !== 'windows-release-evidence-v1' ||
    evidence.kind !== 'ocr-worker-kernel-network-deny' ||
    typeof evidence.verified !== 'boolean'
  ) throw new Error('Packaged Windows OCR network-isolation evidence is invalid.')
  if (evidence.verified && (
    evidence.platform !== 'win32' || evidence.arch !== 'x64' ||
    evidence.mechanism !== 'appcontainer-no-network-capabilities' ||
    !Array.isArray(evidence.appContainerCapabilities) || evidence.appContainerCapabilities.length !== 0 ||
    evidence.unsandboxedLoopbackReachable !== true || evidence.sandboxedLoopbackDenied !== true ||
    evidence.sandboxedOcrCompleted !== true ||
    evidence.launcherSha256 !== manifest.sandboxLauncher.sha256
  )) throw new Error('Packaged Windows OCR network-isolation evidence is incomplete or stale.')
  const localWorkerEvidence = JSON.parse(await readFile(join(offlineOcrPath, 'local-worker-network-evidence.json'), 'utf8'))
  if (
    localWorkerEvidence.version !== 'windows-release-evidence-v1' ||
    localWorkerEvidence.kind !== 'local-worker-kernel-network-deny' ||
    typeof localWorkerEvidence.verified !== 'boolean'
  ) throw new Error('Packaged Windows local-worker network-isolation evidence is invalid.')
  if (localWorkerEvidence.verified && (
    localWorkerEvidence.platform !== 'win32' || localWorkerEvidence.arch !== 'x64' ||
    localWorkerEvidence.mechanism !== 'appcontainer-no-network-capabilities' ||
    !Array.isArray(localWorkerEvidence.appContainerCapabilities) || localWorkerEvidence.appContainerCapabilities.length !== 0 ||
    localWorkerEvidence.unsandboxedLoopbackReachable !== true || localWorkerEvidence.sandboxedLoopbackDenied !== true ||
    localWorkerEvidence.parserCompleted !== true || localWorkerEvidence.embeddingCompleted !== true ||
    localWorkerEvidence.rerankerCompleted !== true ||
    localWorkerEvidence.launcherSha256 !== manifest.sandboxLauncher.sha256
  )) throw new Error('Packaged Windows local-worker network-isolation evidence is incomplete or stale.')
  return { manifest, evidence, localWorkerEvidence }
}

async function verifyPrivacyQualityReport() {
  const report = JSON.parse(await readFile(privacyQualityReportPath, 'utf8'))
  if (
    report.version !== 'ses-privacy-quality-report-v1' || report.datasetVersion !== 'ses-privacy-regression-v1' ||
    report.datasetSha256 !== '83ce7ac64d07337b41bdd303450c97cc894e74fcf36730bcade60cbb2bf9cb4e' ||
    report.syntheticOnly !== true || report.humanLabeledDataset !== false ||
    report.platform !== 'win32' || report.arch !== 'x64' || report.caseCount !== 28 ||
    report.expectedIdentifiers !== 30 || report.detectedIdentifiers !== 30 ||
    report.identifierRecall !== 1 || report.redactionPrecision !== 1 ||
    report.residualLeakCount !== 0 || report.safeCaseFalsePositiveCount !== 0 ||
    report.failedClosedCases !== 4 || report.cloudDirectIdentifiers !== 0 ||
    report.networkAccess !== false || report.appleNer?.required !== false || report.releaseEligible !== true
  ) throw new Error('Packaged Windows privacy quality report is missing, stale, or incomplete.')
  return report
}

async function verifyPrivacyExpertReport() {
  let report
  try {
    report = JSON.parse(await readFile(privacyExpertReportPath, 'utf8'))
  } catch (error) {
    if (!requireExpertReport && error && typeof error === 'object' && error.code === 'ENOENT') return null
    throw new Error('Packaged Windows human-labeled privacy report is missing or unreadable.')
  }
  if (
    report.version !== 'ses-privacy-expert-quality-report-v2' ||
    report.datasetVersion !== 'ses-privacy-expert-dataset-v1' ||
    report.humanLabeledDataset !== true || report.syntheticOnly !== false ||
    report.locale !== 'ja-JP' || report.platform !== 'win32' || report.arch !== 'x64' ||
    report.containsCaseContent !== false || report.cloudDirectIdentifiers !== 0 || report.networkAccess !== false ||
    !/^[a-f0-9]{64}$/u.test(report.datasetSha256 ?? '') ||
    !/^[a-f0-9]{64}$/u.test(report.privacyImplementationSha256 ?? '') ||
    !/^[a-f0-9]{64}$/u.test(report.cloudEnforcementSha256 ?? '')
  ) throw new Error('Packaged Windows human-labeled privacy report violates its aggregate-only contract.')
  if (requireExpertReport && privacyExpertReportFailures(report, { platform: 'win32', arch: 'x64' }).length > 0) {
    throw new Error('Packaged Windows human-labeled privacy report did not pass the formal release threshold.')
  }
  return report
}

async function verifyCloudEnforcementManifest(privacyExpert) {
  const manifest = JSON.parse(await readFile(cloudEnforcementManifestPath, 'utf8'))
  const [qualityReportBytes, expertReportBytes] = await Promise.all([
    readFile(privacyQualityReportPath),
    privacyExpert ? readFile(privacyExpertReportPath) : Promise.resolve(null)
  ])
  const hash = (bytes) => bytes ? createHash('sha256').update(bytes).digest('hex') : null
  const runtimeBundleFiles = Array.isArray(manifest.runtimeBundleFiles) ? manifest.runtimeBundleFiles : []
  const runtimeBundleSetHash = createHash('sha256')
  const runtimeBundlePaths = new Set()
  for (const file of runtimeBundleFiles) {
    if (
      typeof file.path !== 'string' || typeof file.sha256 !== 'string' ||
      (!file.path.startsWith('out/main/') && !file.path.startsWith('out/preload/')) ||
      file.path.includes('..') || file.path.includes('\\') || runtimeBundlePaths.has(file.path)
    ) throw new Error('Packaged Windows Cloud enforcement manifest contains an unsafe runtime bundle path.')
    const bytes = extractFile(asarPath, file.path)
    if (hash(bytes) !== file.sha256) throw new Error(`Packaged Windows runtime bundle is stale: ${file.path}`)
    runtimeBundleSetHash.update(file.path).update('\0').update(bytes).update('\0')
    runtimeBundlePaths.add(file.path)
  }
  if (
    manifest.version !== 'ses-cloud-enforcement-manifest-v2' ||
    manifest.platform !== 'win32' || manifest.arch !== 'x64' ||
    !runtimeBundlePaths.has('out/main/index.js') || !runtimeBundlePaths.has('out/preload/index.js') ||
    manifest.runtimeBundleSetSha256 !== runtimeBundleSetHash.digest('hex') ||
    manifest.qualityReportSha256 !== hash(qualityReportBytes) ||
    manifest.expertReportSha256 !== hash(expertReportBytes) ||
    !/^[a-f0-9]{64}$/u.test(manifest.privacyImplementationSha256 ?? '') ||
    !/^[a-f0-9]{64}$/u.test(manifest.cloudEnforcementSourceSha256 ?? '') ||
    manifest.qualityGateBound !== true
  ) throw new Error('Packaged Windows Cloud enforcement manifest is missing, stale, or incomplete.')
  const expertFailures = privacyExpert
    ? privacyExpertReportFailures(privacyExpert, {
        platform: 'win32',
        arch: 'x64',
        privacyImplementationSha256: manifest.privacyImplementationSha256,
        cloudEnforcementSha256: manifest.cloudEnforcementSourceSha256
      })
    : ['report:missing']
  const expertBound = expertFailures.length === 0
  if (
    manifest.expertAttestationBound !== expertBound ||
    manifest.releaseEligible !== expertBound ||
    (privacyExpert && (
      privacyExpert.privacyImplementationSha256 !== manifest.privacyImplementationSha256 ||
      privacyExpert.cloudEnforcementSha256 !== manifest.cloudEnforcementSourceSha256
    ))
  ) throw new Error('Packaged Windows expert evidence is not bound to the Cloud enforcement manifest.')
  if (requireExpertReport && !manifest.releaseEligible) {
    throw new Error(`Packaged Windows Cloud enforcement manifest is not release eligible: ${expertFailures.join(',')}`)
  }
  return manifest
}

function launchSmoke(expectRecovery, expectOcrEnabled = false) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executablePath, [`--user-data-dir=${userDataPath}`], {
      env: { ...process.env, SES_RELEASE_SMOKE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const stdout = []
    const stderr = []
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Packaged Windows application smoke launch timed out.'))
    }, 30_000)
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      const output = Buffer.concat(stdout).toString('utf8')
      const errors = Buffer.concat(stderr).toString('utf8')
      if (code !== 0) return reject(new Error(`Packaged Windows application exited with ${code}.\n${output}\n${errors}`))
      const markers = expectRecovery
        ? ['[startup-recovery-ready]', '[renderer-ready]']
        : ['[storage-ready]', '[local-ai-ready]', '[renderer-ready]']
      if (markers.some((marker) => !output.includes(marker))) {
        return reject(new Error(`Packaged Windows application missed readiness markers.\n${output}\n${errors}`))
      }
      if (!expectRecovery && (
        !/schemaVersion:\s*36\b/u.test(output) ||
        !output.includes("keyProtection: 'windows-dpapi'") ||
        !output.includes(expectOcrEnabled
          ? "status: 'windows-ocr-and-pii-rules-active'"
          : "status: 'windows-ocr-bundled-isolation-pending'") ||
        (expectOcrEnabled && !output.includes("ocrEngine: 'windows-tesseract-wasm'")) ||
        !output.includes('rawPersonalDataCloudEligible: false')
      )) return reject(new Error(`Packaged Windows security posture is incorrect.\n${output}`))
      resolveResult({ output, errors })
    })
  })
}

function launchPackagedWorkerSmoke(expectOcrEnabled, ocrFixturePath) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executablePath, [`--user-data-dir=${userDataPath}`], {
      env: {
        ...process.env,
        SES_WINDOWS_PACKAGE_WORKER_SMOKE: '1',
        ...(expectOcrEnabled ? { SES_WINDOWS_PACKAGE_OCR_FIXTURE_PATH: ocrFixturePath } : {})
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const stdout = []
    const stderr = []
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Packaged Windows AppContainer worker smoke timed out.'))
    }, 180_000)
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      const output = Buffer.concat(stdout).toString('utf8')
      const errors = Buffer.concat(stderr).toString('utf8')
      if (code !== 0) {
        reject(new Error(`Packaged Windows AppContainer worker smoke exited with ${code}.\n${output}\n${errors}`))
        return
      }
      const match = output.match(/\[windows-package-workers-ready\]\s+(\{[^\r\n]+\})/u)
      if (!match?.[1]) {
        reject(new Error(`Packaged Windows AppContainer worker smoke missed its result marker.\n${output}\n${errors}`))
        return
      }
      try {
        const result = JSON.parse(match[1])
        if (
          result.parserCompleted !== true || result.embeddingCompleted !== true || result.rerankerCompleted !== true ||
          result.rerankerModel !== 'hotchpotch/japanese-reranker-tiny-v2' ||
          result.embeddingDimension !== 384 || result.rawPersonalDataCloudEligible !== false ||
          result.ocrCompleted !== expectOcrEnabled ||
          result.ocrEngine !== (expectOcrEnabled ? 'windows-tesseract-wasm' : null) ||
          result.ocrStatus !== (expectOcrEnabled
            ? 'windows-ocr-and-pii-rules-active'
            : 'windows-ocr-bundled-isolation-pending')
        ) throw new Error(`Unexpected packaged worker result: ${JSON.stringify(result)}`)
        resolveResult({ result, output, errors })
      } catch (error) {
        reject(error)
      }
    })
  })
}

try {
  await assertPeX64(executablePath, 'Electron application executable')
  const packagedPaths = await walk(appPath)
  const asarEntries = await listPackage(asarPath)
  const packagedMainSource = asarEntries
    .filter((entry) => entry.startsWith('/out/main/') && entry.endsWith('.js'))
    .map((entry) => extractFile(asarPath, entry.slice(1)).toString('utf8'))
    .join('\n')
  for (const forbiddenGmailCapability of [
    '/gmail/v1/users/me/drafts', '/gmail/v1/users/me/messages/send', '/gmail/v1/users/me/drafts/send',
    'client_secret'
  ]) {
    if (packagedMainSource.includes(forbiddenGmailCapability)) {
      throw new Error(`Packaged Windows application contains forbidden Gmail capability ${forbiddenGmailCapability}.`)
    }
  }
  if (!packagedMainSource.includes('historyTypes", "messageAdded') || !packagedMainSource.includes('historyTypes", "labelAdded')) {
    throw new Error('Packaged Windows Gmail synchronization is missing messageAdded or labelAdded coverage.')
  }
  for (const worker of [
    '/out/main/parser-worker.js',
    '/out/main/embedding-worker.js',
    '/out/main/reranker-worker.js',
    '/out/main/windows-ocr-worker.js',
    '/out/main/tesseract-worker.js'
  ]) {
    if (!asarEntries.includes(worker)) throw new Error(`Windows package is missing ${worker}.`)
  }
  for (const dependency of ['/node_modules/tesseract.js/package.json', '/node_modules/tesseract.js-core/package.json']) {
    if (!asarEntries.includes(dependency)) throw new Error(`Windows package is missing ${dependency}.`)
  }
  if (asarEntries.some((entry) => entry === '/node_modules/@tesseract.js-data' || entry.startsWith('/node_modules/@tesseract.js-data/'))) {
    throw new Error('Windows package duplicates OCR traineddata inside ASAR.')
  }
  if (packagedPaths.some((path) => path.includes(`${join('native', 'macos')}`))) {
    throw new Error('Windows package contains the macOS OCR helper.')
  }
  const nativeModules = packagedPaths.filter((path) => path.startsWith(unpackedPath) && path.endsWith('.node'))
  if (!nativeModules.some((path) => path.endsWith('better_sqlite3.node'))) throw new Error('Windows SQLCipher native module is missing.')
  if (!nativeModules.some((path) => path.endsWith('onnxruntime_binding.node'))) throw new Error('Windows ONNX native module is missing.')
  for (const path of nativeModules) await assertPeX64(path, 'Native Node module')
  for (const required of [
    join(unpackedPath, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3', 'win32', 'x64', 'onnxruntime.dll'),
    join(unpackedPath, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3', 'win32', 'x64', 'DirectML.dll')
  ]) await assertPeX64(required, 'Windows ONNX runtime library')
  if (packagedPaths.some((path) => path.includes(`${join('napi-v3', 'darwin')}`))) throw new Error('Windows package contains Darwin ONNX Runtime files.')

  const embeddingModel = await verifyEmbeddingModel()
  const rerankerModel = await verifyRerankerModel()
  const privacyQuality = await verifyPrivacyQualityReport()
  const privacyExpert = await verifyPrivacyExpertReport()
  const cloudEnforcement = await verifyCloudEnforcementManifest(privacyExpert)
  const offlineOcr = await verifyOfflineOcrResources()
  await stat(join(resourcesPath, 'THIRD_PARTY_NOTICES.md'))
  const launch = await launchSmoke(false, offlineOcr.evidence.verified)
  const ocrFixturePath = await createOcrFixture()
  const workerSmoke = await launchPackagedWorkerSmoke(offlineOcr.evidence.verified, ocrFixturePath)
  const database = await readFile(join(userDataPath, 'data', 'ses-agent.db'))
  if (database.subarray(0, 16).toString('utf8') === 'SQLite format 3\u0000') throw new Error('Packaged Windows database is not encrypted.')
  await rm(join(userDataPath, 'security', 'master-key.v1'), { force: true })
  const recoveryLaunch = await launchSmoke(true)

  process.stdout.write(`${JSON.stringify({
    appPath,
    platform: 'win32',
    arch: 'x64',
    packageTarget: 'nsis-development-layout',
    nativeModules: nativeModules.length,
    localEmbeddingModel: embeddingModel.modelId,
    localEmbeddingDimension: embeddingModel.embeddingDimension,
    localEmbeddingIntegrity: true,
    localRerankerModel: rerankerModel.modelId,
    localRerankerIntegrity: true,
    privacyQualityDataset: privacyQuality.datasetVersion,
    privacyQualitySyntheticOnly: privacyQuality.syntheticOnly,
    privacyIdentifierRecall: privacyQuality.identifierRecall,
    privacyRedactionPrecision: privacyQuality.redactionPrecision,
    privacyResidualLeaks: privacyQuality.residualLeakCount,
    privacyExpertRequired: requireExpertReport,
    privacyExpertStatus: privacyExpert?.releaseEligible === true ? 'passed' : 'not-verified',
    privacyExpertCases: privacyExpert?.caseCount ?? 0,
    cloudEnforcementRuntimeBundleSetSha256: cloudEnforcement.runtimeBundleSetSha256,
    cloudEnforcementReleaseEligible: cloudEnforcement.releaseEligible,
    gmailApiContract: 'get-only',
    gmailIncrementalEvents: ['messageAdded', 'labelAdded'],
    gmailClientSecretPath: false,
    offlineOcrEngine: offlineOcr.manifest.engine,
    offlineOcrLanguages: offlineOcr.manifest.languages,
    offlineOcrResourceIntegrity: true,
    offlineOcrKernelNetworkIsolationVerified: offlineOcr.evidence.verified,
    localWorkerKernelNetworkIsolationVerified: offlineOcr.localWorkerEvidence.verified,
    macHelperExcluded: true,
    localOcrStatus: offlineOcr.evidence.verified ? 'available-after-kernel-verification' : 'bundled-disabled-fail-closed',
    keyProtection: 'windows-dpapi',
    schemaVersion: 37,
    encryptedDatabase: true,
    rendererReady: launch.output.includes('[renderer-ready]'),
    packagedParserCompleted: workerSmoke.result.parserCompleted,
    packagedEmbeddingCompleted: workerSmoke.result.embeddingCompleted,
    packagedRerankerCompleted: workerSmoke.result.rerankerCompleted,
    packagedOcrCompleted: workerSmoke.result.ocrCompleted,
    keyLossRecoveryModeReady: recoveryLaunch.output.includes('[startup-recovery-ready]'),
    rawPersonalDataCloudEligible: false,
    stderr: [launch.errors.trim(), recoveryLaunch.errors.trim()].filter(Boolean).join('\n') || null
  }, null, 2)}\n`)
} finally {
  await rm(userDataPath, { recursive: true, force: true })
}
