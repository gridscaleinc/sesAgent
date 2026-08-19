import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  computeCloudEnforcementSha256,
  computePrivacyImplementationSha256,
  privacyExpertReportFailures
} from './privacy-expert-evidence.mjs'

const failures = []
let launcherSha256 = null
const evidence = {
  platform: process.platform,
  arch: process.arch,
  signedBuildHost: process.platform === 'win32',
  signingCredential: null,
  ocrRuntime: false,
  rerankerRuntime: false,
  privacyQualityGate: false,
  privacyExpertGate: false,
  ocrRuntimeFunctionalEvidence: false,
  ocrKernelNetworkEvidence: false,
  workerNetworkPolicyEvidence: false
}

if (process.platform !== 'win32') failures.push('A signed Windows release must be built and tested on Windows.')
if (process.arch !== 'x64') failures.push('The first Windows release must be built on x64.')

const classicSigning = Boolean(process.env.WIN_CSC_LINK && process.env.WIN_CSC_KEY_PASSWORD)
const azureSigning = Boolean(
  process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET &&
  process.env.SES_WINDOWS_AZURE_SIGNING_CONFIGURED === '1'
)
evidence.signingCredential = classicSigning ? 'win-csc' : azureSigning ? 'azure-trusted-signing' : null
if (!evidence.signingCredential) failures.push('Windows code-signing credentials are missing.')

try {
  await Promise.all([
    access(resolve('out/main/windows-ocr-worker.js')),
    access(resolve('out/main/tesseract-worker.js')),
    access(resolve('out/main/reranker-worker.js')),
    access(resolve('models/hotchpotch/japanese-reranker-tiny-v2/model-manifest.json')),
    access(resolve('models/hotchpotch/japanese-reranker-tiny-v2/onnx/model_qint8_avx2.onnx')),
    access(resolve('build/native/windows/ocr/resource-manifest.json')),
    access(resolve('build/native/windows/ocr/ses-ocr-sandbox.exe')),
    access(resolve('build/native/windows/ocr/tessdata/jpn.traineddata.gz')),
    access(resolve('build/native/windows/ocr/tessdata/eng.traineddata.gz'))
  ])
  const manifest = JSON.parse(await readFile(resolve('build/native/windows/ocr/resource-manifest.json'), 'utf8'))
  if (
    manifest?.version !== 'windows-offline-ocr-resources-v1' ||
    manifest?.engine !== 'windows-tesseract-wasm' || manifest?.networkAccess !== false ||
    JSON.stringify(manifest?.languages) !== JSON.stringify(['jpn', 'eng'])
  ) throw new Error('invalid manifest')
  for (const file of manifest.files ?? []) {
    const bytes = await readFile(resolve(`build/native/windows/ocr/tessdata/${file.language}.traineddata.gz`))
    if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      throw new Error(`invalid OCR resource: ${file.language}`)
    }
  }
  if (!manifest.sandboxLauncher || manifest.sandboxLauncher.path !== 'ses-ocr-sandbox.exe') {
    throw new Error('missing sandbox launcher manifest')
  }
  const launcher = await readFile(resolve('build/native/windows/ocr/ses-ocr-sandbox.exe'))
  launcherSha256 = createHash('sha256').update(launcher).digest('hex')
  if (
    launcher.length !== manifest.sandboxLauncher.bytes ||
    launcherSha256 !== manifest.sandboxLauncher.sha256 ||
    launcher.readUInt16LE(0) !== 0x5a4d
  ) throw new Error('invalid sandbox launcher')
  const peOffset = launcher.readUInt32LE(0x3c)
  if (launcher.readUInt32LE(peOffset) !== 0x00004550 || launcher.readUInt16LE(peOffset + 4) !== 0x8664) {
    throw new Error('sandbox launcher is not PE x64')
  }
  evidence.ocrRuntime = true
} catch {
  failures.push('The fixed offline Windows OCR worker or its local resources are missing.')
}
try {
  const directory = resolve('models/hotchpotch/japanese-reranker-tiny-v2')
  const manifest = JSON.parse(await readFile(resolve(directory, 'model-manifest.json'), 'utf8'))
  if (
    manifest?.schemaVersion !== 'local-reranker-model-v1' ||
    manifest?.modelId !== 'hotchpotch/japanese-reranker-tiny-v2' ||
    manifest?.revision !== 'ba95175a4d53058816b971f31929f10c5cad8560' ||
    manifest?.license !== 'MIT'
  ) throw new Error('invalid reranker manifest')
  for (const file of (manifest.files ?? []).filter((item) => item.platform === 'all' || item.platform === 'win32-x64')) {
    const bytes = await readFile(resolve(directory, file.path))
    if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      throw new Error(`invalid reranker resource: ${file.path}`)
    }
  }
  evidence.rerankerRuntime = true
} catch {
  failures.push('The fixed Japanese local reranker worker or its Windows x64 model is missing or invalid.')
}
try {
  const functional = JSON.parse(await readFile(resolve('build/windows-verification/offline-ocr-runtime.json'), 'utf8'))
  evidence.ocrRuntimeFunctionalEvidence = functional?.version === 'windows-release-evidence-v1' &&
    functional?.kind === 'offline-ocr-runtime-functional' && functional?.verified === true &&
    functional?.platform === 'win32' && functional?.arch === 'x64' &&
    functional?.engine === 'windows-tesseract-wasm' && functional?.networkAccess === false &&
    functional?.appContainerVerified === true
} catch {
  evidence.ocrRuntimeFunctionalEvidence = false
}
if (!evidence.ocrRuntimeFunctionalEvidence) failures.push('Windows x64 offline OCR functional evidence is missing.')
try {
  const network = JSON.parse(await readFile(resolve('build/windows-verification/ocr-worker-network-policy.json'), 'utf8'))
  evidence.ocrKernelNetworkEvidence = network?.version === 'windows-release-evidence-v1' &&
    network?.kind === 'ocr-worker-kernel-network-deny' && network?.verified === true &&
    network?.platform === 'win32' && network?.arch === 'x64' &&
    network?.mechanism === 'appcontainer-no-network-capabilities' &&
    Array.isArray(network?.appContainerCapabilities) && network.appContainerCapabilities.length === 0 &&
    network?.unsandboxedLoopbackReachable === true && network?.sandboxedLoopbackDenied === true &&
    network?.sandboxedOcrCompleted === true && network?.launcherSha256 === launcherSha256
} catch {
  evidence.ocrKernelNetworkEvidence = false
}
if (!evidence.ocrKernelNetworkEvidence) failures.push('Windows OCR worker kernel network-isolation evidence is missing.')
try {
  const workers = JSON.parse(await readFile(resolve('build/windows-verification/local-worker-network-policy.json'), 'utf8'))
  evidence.workerNetworkPolicyEvidence = workers?.version === 'windows-release-evidence-v1' &&
    workers?.kind === 'local-worker-kernel-network-deny' && workers?.verified === true &&
    workers?.platform === 'win32' && workers?.arch === 'x64' &&
    workers?.mechanism === 'appcontainer-no-network-capabilities' &&
    Array.isArray(workers?.appContainerCapabilities) && workers.appContainerCapabilities.length === 0 &&
    workers?.unsandboxedLoopbackReachable === true && workers?.sandboxedLoopbackDenied === true &&
    workers?.parserCompleted === true && workers?.embeddingCompleted === true && workers?.rerankerCompleted === true &&
    workers?.launcherSha256 === launcherSha256
} catch {
  evidence.workerNetworkPolicyEvidence = false
}
if (!evidence.workerNetworkPolicyEvidence) failures.push('Windows parser/embedding/reranker kernel network-isolation evidence is missing.')
try {
  const privacy = JSON.parse(await readFile(resolve('build/privacy-verification/privacy-quality-report.json'), 'utf8'))
  evidence.privacyQualityGate = privacy?.version === 'ses-privacy-quality-report-v1' &&
    privacy?.releaseEligible === true && privacy?.syntheticOnly === true && privacy?.humanLabeledDataset === false &&
    privacy?.platform === 'win32' && privacy?.arch === 'x64' &&
    privacy?.identifierRecall === 1 && privacy?.redactionPrecision === 1 &&
    privacy?.residualLeakCount === 0 && privacy?.safeCaseFalsePositiveCount === 0 &&
    privacy?.cloudDirectIdentifiers === 0 && privacy?.networkAccess === false &&
    privacy?.appleNer?.required === false
} catch {
  evidence.privacyQualityGate = false
}
if (!evidence.privacyQualityGate) failures.push('The Windows x64 privacy quality gate is missing or failed.')
try {
  const [privacyImplementationSha256, cloudEnforcementSha256] = await Promise.all([
    computePrivacyImplementationSha256(),
    computeCloudEnforcementSha256()
  ])
  const privacyExpert = JSON.parse(await readFile(resolve('build/privacy-verification/privacy-expert-report.json'), 'utf8'))
  evidence.privacyExpertGate = privacyExpertReportFailures(privacyExpert, {
    platform: 'win32',
    arch: 'x64',
    privacyImplementationSha256,
    cloudEnforcementSha256
  }).length === 0
} catch {
  evidence.privacyExpertGate = false
}
if (!evidence.privacyExpertGate) failures.push('The Windows x64 human-labeled Japanese privacy report is missing, failed, or stale.')

process.stdout.write(`${JSON.stringify({ ...evidence, failures }, null, 2)}\n`)
if (failures.length > 0) process.exit(1)
