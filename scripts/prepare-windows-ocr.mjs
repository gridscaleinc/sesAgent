import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = join(root, 'build', 'native', 'windows', 'ocr')
const tessdataDirectory = join(outputDirectory, 'tessdata')
const verificationSource = join(root, 'build', 'windows-verification', 'ocr-worker-network-policy.json')
const localWorkerVerificationSource = join(root, 'build', 'windows-verification', 'local-worker-network-policy.json')

const resources = [
  {
    language: 'jpn',
    source: join(root, 'node_modules', '@tesseract.js-data', 'jpn', '4.0.0', 'jpn.traineddata.gz'),
    target: join(tessdataDirectory, 'jpn.traineddata.gz')
  },
  {
    language: 'eng',
    source: join(root, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0', 'eng.traineddata.gz'),
    target: join(tessdataDirectory, 'eng.traineddata.gz')
  }
]

await mkdir(tessdataDirectory, { recursive: true })
const files = []
for (const resource of resources) {
  await copyFile(resource.source, resource.target)
  const bytes = await readFile(resource.target)
  files.push({
    language: resource.language,
    path: `tessdata/${resource.language}.traineddata.gz`,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  })
}

let networkIsolationEvidence = {
  version: 'windows-release-evidence-v1',
  kind: 'ocr-worker-kernel-network-deny',
  verified: false,
  reason: 'Target-machine kernel network isolation has not been verified.'
}

let sandboxLauncher = null
try {
  const launcherPath = join(outputDirectory, 'ses-ocr-sandbox.exe')
  const launcherBytes = await readFile(launcherPath)
  sandboxLauncher = {
    path: 'ses-ocr-sandbox.exe',
    bytes: launcherBytes.length,
    sha256: createHash('sha256').update(launcherBytes).digest('hex'),
    appContainerCapabilities: []
  }
} catch {
  // The native launcher is intentionally built and verified only on Windows x64.
}
try {
  const candidate = JSON.parse(await readFile(verificationSource, 'utf8'))
  if (
    candidate?.version === 'windows-release-evidence-v1' &&
    candidate?.kind === 'ocr-worker-kernel-network-deny' &&
    candidate?.verified === true &&
    candidate?.platform === 'win32' && candidate?.arch === 'x64' &&
    candidate?.mechanism === 'appcontainer-no-network-capabilities' &&
    Array.isArray(candidate?.appContainerCapabilities) && candidate.appContainerCapabilities.length === 0 &&
    candidate?.unsandboxedLoopbackReachable === true &&
    candidate?.sandboxedLoopbackDenied === true && candidate?.sandboxedOcrCompleted === true &&
    sandboxLauncher !== null && candidate?.launcherSha256 === sandboxLauncher.sha256
  ) networkIsolationEvidence = candidate
} catch {
  // Development builds intentionally carry explicit unverified evidence and keep OCR disabled.
}

await writeFile(join(outputDirectory, 'network-isolation-evidence.json'), `${JSON.stringify(networkIsolationEvidence, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600
})

let localWorkerNetworkIsolationEvidence = {
  version: 'windows-release-evidence-v1',
  kind: 'local-worker-kernel-network-deny',
  verified: false,
  reason: 'Target-machine parser, embedding, and reranker isolation has not been verified.'
}
try {
  const candidate = JSON.parse(await readFile(localWorkerVerificationSource, 'utf8'))
  if (
    candidate?.version === 'windows-release-evidence-v1' &&
    candidate?.kind === 'local-worker-kernel-network-deny' &&
    candidate?.verified === true &&
    candidate?.platform === 'win32' && candidate?.arch === 'x64' &&
    candidate?.mechanism === 'appcontainer-no-network-capabilities' &&
    Array.isArray(candidate?.appContainerCapabilities) && candidate.appContainerCapabilities.length === 0 &&
    candidate?.unsandboxedLoopbackReachable === true && candidate?.sandboxedLoopbackDenied === true &&
    candidate?.parserCompleted === true && candidate?.embeddingCompleted === true && candidate?.rerankerCompleted === true &&
    sandboxLauncher !== null && candidate?.launcherSha256 === sandboxLauncher.sha256
  ) localWorkerNetworkIsolationEvidence = candidate
} catch {
  // Development builds carry an explicit unverified record until Windows x64 proves the policy.
}
await writeFile(
  join(outputDirectory, 'local-worker-network-evidence.json'),
  `${JSON.stringify(localWorkerNetworkIsolationEvidence, null, 2)}\n`,
  { encoding: 'utf8', mode: 0o600 }
)

const manifest = {
  version: 'windows-offline-ocr-resources-v1',
  engine: 'windows-tesseract-wasm',
  runtime: {
    tesseractJs: '7.0.0',
    tesseractJsCore: '7.0.0',
    pdfJs: '6.1.200',
    canvas: '1.0.2'
  },
  languages: ['jpn', 'eng'],
  networkAccess: false,
  sandboxLauncher,
  files
}
await writeFile(join(outputDirectory, 'resource-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600
})

const totalBytes = (await Promise.all(resources.map((resource) => stat(resource.target))))
  .reduce((total, item) => total + item.size, 0)
process.stdout.write(`${JSON.stringify({
  outputDirectory,
  engine: manifest.engine,
  languages: manifest.languages,
  totalBytes,
  sandboxLauncherBuilt: sandboxLauncher !== null,
  networkIsolationVerified: networkIsolationEvidence.verified,
  localWorkerNetworkIsolationVerified: localWorkerNetworkIsolationEvidence.verified
})}\n`)
