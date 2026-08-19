import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
// @ts-expect-error js-yaml is supplied by electron-builder and has no local declaration package.
import { load } from 'js-yaml'
import { describePlatformSecurity } from '../packages/platform/src/capabilities'

interface BuilderConfiguration {
  directories?: { output?: string }
  files?: string[]
  extraResources?: Array<{ from?: string; to?: string; filter?: string[] }>
  forceCodeSigning?: boolean
  win?: {
    target?: Array<{ target?: string; arch?: string[] } | string>
    signExecutable?: boolean
    verifyUpdateCodeSignature?: boolean
  }
  nsis?: {
    oneClick?: boolean
    perMachine?: boolean
    deleteAppDataOnUninstall?: boolean
  }
}

interface OcrManifest {
  version: string
  engine: string
  networkAccess: boolean
  languages: string[]
  sandboxLauncher: null | { path: string; bytes: number; sha256: string; appContainerCapabilities: string[] }
  files: Array<{ language: string; path: string; bytes: number; sha256: string }>
}

async function configuration(path: string): Promise<BuilderConfiguration> {
  return load(await readFile(path, 'utf8')) as BuilderConfiguration
}

const release = await configuration('electron-builder.win.yml')
const development = await configuration('electron-builder.win.dev.yml')
const windowsWorkflow = await readFile('.github/workflows/windows-development.yml', 'utf8')
const files = release.files ?? []
const resources = release.extraResources ?? []
const targets = release.win?.target ?? []
const target = targets.find((item) => typeof item !== 'string' && item.target === 'nsis')

assert.equal(release.forceCodeSigning, true, 'Windows release builds must fail closed without a signing identity.')
assert.equal(release.win?.signExecutable, true, 'Windows release executable signing must be enabled.')
assert.equal(release.win?.verifyUpdateCodeSignature, true, 'Windows update signature verification must be enabled.')
assert.deepEqual(typeof target === 'string' ? [] : target?.arch, ['x64'], 'The first Windows target must be an x64 NSIS installer.')
assert.equal(development.forceCodeSigning, false, 'The internal Windows development build should not require production credentials.')
assert.equal(development.win?.signExecutable, false, 'The internal Windows development build should remain visibly unsigned.')
assert.match(windowsWorkflow, /npm run test:installer:win -- --development/u)
assert.match(windowsWorkflow, /npm run test:privacy-quality-gate/u)
assert.match(windowsWorkflow, /npm run test:google-workspace-contract/u)
assert.equal(files.some((pattern) => pattern.includes('win32')), false, 'Windows ONNX Runtime is excluded from its own package.')
assert.equal(files.some((pattern) => pattern.includes('darwin/**/*')), true, 'Darwin ONNX Runtime exclusion is missing.')
assert.equal(resources.some((resource) => resource.from?.includes('native/macos')), false, 'The Windows package includes a macOS helper.')
assert.equal(resources.some((resource) => resource.from?.includes('multilingual-e5-small')), true, 'The Windows package is missing the fixed local embedding model.')
assert.equal(resources.some((resource) => resource.from?.includes('japanese-reranker-tiny-v2')), true, 'The Windows package is missing the fixed local reranker model.')
const privacyEvidenceResource = resources.find((resource) => resource.from?.includes('build/privacy-verification'))
assert.equal(privacyEvidenceResource?.filter?.includes('privacy-quality-report.json'), true, 'The Windows package is missing the fixed privacy quality evidence.')
assert.equal(privacyEvidenceResource?.filter?.includes('privacy-expert-report.json'), true, 'The Windows package is missing the human-labeled privacy evidence contract.')
assert.equal(privacyEvidenceResource?.filter?.includes('cloud-enforcement-manifest.json'), true, 'The Windows package is missing the bound Cloud enforcement manifest.')
assert.equal(resources.some((resource) => resource.from?.includes('build/native/windows/ocr')), true, 'The Windows package is missing the offline OCR resources.')
assert.equal(
  resources.some((resource) => resource.from?.includes('build/native/windows/ocr') && resource.to?.includes('native/windows/ocr')),
  true,
  'The Windows package is missing the shared AppContainer resources.'
)
assert.equal(release.nsis?.oneClick, false)
assert.equal(release.nsis?.perMachine, false)
assert.equal(release.nsis?.deleteAppDataOnUninstall, false, 'Uninstall must not silently delete encrypted business data.')

for (const worker of [
  'apps/desktop/src/workers/parser-worker.ts',
  'apps/desktop/src/workers/embedding-worker.ts',
  'apps/desktop/src/workers/reranker-worker.ts',
  'apps/desktop/src/workers/windows-ocr-worker.ts',
  'apps/desktop/src/workers/tesseract-worker.ts'
]) {
  assert.match(await readFile(worker, 'utf8'), /installParserNetworkDenyGuard\(\)/u, `${worker} does not install the shared network deny guard.`)
}

const manifest = JSON.parse(await readFile('build/native/windows/ocr/resource-manifest.json', 'utf8')) as OcrManifest
assert.equal(manifest.version, 'windows-offline-ocr-resources-v1')
assert.equal(manifest.engine, 'windows-tesseract-wasm')
assert.equal(manifest.networkAccess, false)
assert.deepEqual(manifest.languages, ['jpn', 'eng'])
const sandboxSource = await readFile('native/windows/ocr-sandbox-launcher/main.cpp', 'utf8')
assert.match(sandboxSource, /PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES/u)
assert.match(sandboxSource, /CapabilityCount\s*=\s*0/u)
assert.match(sandboxSource, /CreateProcessW/u)
for (const source of [
  'packages/parsers/src/worker-client.ts',
  'packages/local-ai/src/embeddings.ts',
  'packages/local-ai/src/reranker.ts'
]) {
  const clientSource = await readFile(source, 'utf8')
  assert.match(clientSource, /jp\.sesai\.agentdesktop\.localworkers/u, `${source} is not wired to the local-worker AppContainer profile.`)
  assert.match(clientSource, /--stdio/u, `${source} is missing its AppContainer stdio protocol.`)
}
const localWorkerEvidence = JSON.parse(await readFile('build/native/windows/ocr/local-worker-network-evidence.json', 'utf8')) as Record<string, unknown>
assert.equal(localWorkerEvidence.version, 'windows-release-evidence-v1')
assert.equal(localWorkerEvidence.kind, 'local-worker-kernel-network-deny')
assert.equal(typeof localWorkerEvidence.verified, 'boolean')
const sandboxLauncherBuilt = manifest.sandboxLauncher !== null
if (sandboxLauncherBuilt) {
  assert.deepEqual(manifest.sandboxLauncher?.appContainerCapabilities, [])
  const bytes = await readFile(`build/native/windows/ocr/${manifest.sandboxLauncher!.path}`)
  assert.equal(bytes.length, manifest.sandboxLauncher?.bytes)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sandboxLauncher?.sha256)
}
for (const file of manifest.files) {
  const bytes = await readFile(`build/native/windows/ocr/tessdata/${file.language}.traineddata.gz`)
  assert.equal(bytes.length, file.bytes)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256)
}

const packageMetadata = JSON.parse(await readFile('package.json', 'utf8')) as {
  dependencies?: Record<string, string>
  scripts?: Record<string, string>
}
for (const [name, command] of Object.entries(packageMetadata.scripts ?? {})) {
  assert.doesNotMatch(command, /(?:^|&&\s*)ELECTRON_RUN_AS_NODE=/u, `${name} uses POSIX-only environment syntax.`)
}
const electronTsxRunner = await readFile('scripts/run-electron-tsx.mjs', 'utf8')
assert.match(electronTsxRunner, /ELECTRON_RUN_AS_NODE:\s*'1'/u)
assert.equal(packageMetadata.dependencies?.['tesseract.js'], '7.0.0')
assert.equal(packageMetadata.dependencies?.['@tesseract.js-data/jpn'], '1.0.0')
assert.equal(packageMetadata.dependencies?.['@tesseract.js-data/eng'], '1.0.0')
assert.equal(packageMetadata.dependencies?.['@napi-rs/canvas'], '1.0.2')
assert.equal(packageMetadata.dependencies?.['onnxruntime-node'], '1.21.0')
assert.match(
  packageMetadata.scripts?.['release:win'] ?? '',
  /test:package:win/u,
  'The Windows release flow must execute the packaged AppContainer worker smoke before producing the installer.'
)
assert.match(packageMetadata.scripts?.['release:win'] ?? '', /test:privacy-expert/u)
assert.match(packageMetadata.scripts?.['release:win'] ?? '', /test:google-workspace-contract/u)
assert.match(packageMetadata.scripts?.['release:win'] ?? '', /--require-expert-report/u)
assert.match(
  packageMetadata.scripts?.['release:win'] ?? '',
  /test:installer:win/u,
  'The Windows release flow must verify signed NSIS install and uninstall behavior.'
)
const mainSource = await readFile('apps/desktop/src/main/index.ts', 'utf8')
assert.match(mainSource, /\[windows-package-workers-ready\]/u)
assert.match(mainSource, /SES_WINDOWS_PACKAGE_WORKER_SMOKE/u)

const security = describePlatformSecurity({ platform: 'win32', windowsOcrRuntimeBundled: sandboxLauncherBuilt })
assert.equal(security.keyProtection, 'windows-dpapi')
assert.equal(security.rawPersonalDataCloudEligible, false)
assert.equal(security.localOcr.enabled, false)
assert.deepEqual(security.releaseBlockers, [
  ...(!sandboxLauncherBuilt ? ['WINDOWS_OFFLINE_OCR_RUNTIME_NOT_BUNDLED'] : []),
  'WINDOWS_OCR_KERNEL_NETWORK_POLICY_NOT_VERIFIED',
  'WINDOWS_LOCAL_WORKER_KERNEL_NETWORK_POLICY_NOT_VERIFIED'
])

process.stdout.write(`${JSON.stringify({
  platform: 'win32',
  packageTarget: 'nsis-x64',
  developmentPackageConfigReady: true,
  releaseSigningRequired: true,
  updateSignatureVerification: true,
  onnxWin32Included: true,
  offlineOcrRuntimeBundled: sandboxLauncherBuilt,
  offlineOcrSandboxLauncherSourceReady: true,
  offlineOcrSandboxLauncherBuilt: sandboxLauncherBuilt,
  offlineOcrRuntimeIntegrity: true,
  offlineOcrEngine: manifest.engine,
  offlineOcrLanguages: manifest.languages,
  macHelperExcluded: true,
  safeStorageProvider: 'windows-dpapi',
  sharedNodeNetworkDenyGuard: true,
  parserEmbeddingAppContainerSourceReady: true,
  rerankerAppContainerSourceReady: true,
  privacyQualityEvidenceBundled: true,
  privacyExpertEvidenceRequiredByRelease: true,
  crossPlatformElectronTsxRunner: true,
  packagedWorkerSmokeRequiredByRelease: true,
  localWorkerKernelNetworkIsolationVerified: localWorkerEvidence.verified,
  rawPersonalDataCloudEligible: false,
  releaseReady: false,
  releaseBlockers: security.releaseBlockers
})}\n`)
