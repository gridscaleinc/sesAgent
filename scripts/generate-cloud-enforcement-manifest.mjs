import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import {
  computeCloudEnforcementSha256,
  computePrivacyImplementationSha256,
  privacyExpertReportFailures
} from './privacy-expert-evidence.mjs'

const root = resolve(import.meta.dirname, '..')
const verificationDirectory = resolve(root, 'build/privacy-verification')
const outDirectory = resolve(root, 'out')
const qualityReportPath = resolve(verificationDirectory, 'privacy-quality-report.json')
const expertReportPath = resolve(verificationDirectory, 'privacy-expert-report.json')
const manifestPath = resolve(verificationDirectory, 'cloud-enforcement-manifest.json')

async function optionalBytes(path) {
  try {
    return await readFile(path)
  } catch {
    return null
  }
}

function sha256(bytes) {
  return bytes ? createHash('sha256').update(bytes).digest('hex') : null
}

async function javascriptFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await javascriptFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path)
  }
  return files
}

const runtimeBundleExclusions = new Set(process.platform === 'darwin'
  ? [
      'out/main/windows-ocr-worker.js',
      'out/main/tesseract-worker.js',
      'out/main/windows-network-probe.js'
    ]
  : process.platform === 'win32'
    ? ['out/main/windows-network-probe.js']
    : [])
const runtimeBundlePaths = [
  ...await javascriptFiles(resolve(outDirectory, 'main')),
  ...await javascriptFiles(resolve(outDirectory, 'preload'))
].filter((path) => !runtimeBundleExclusions.has(relative(root, path).replaceAll('\\', '/')))
  .sort((left, right) => left.localeCompare(right))
const runtimeBundleFiles = await Promise.all(runtimeBundlePaths.map(async (path) => {
  const bytes = await readFile(path)
  return { path: relative(root, path).replaceAll('\\', '/'), sha256: sha256(bytes), bytes }
}))
const runtimeBundleSetHash = createHash('sha256')
for (const file of runtimeBundleFiles) {
  runtimeBundleSetHash.update(file.path)
  runtimeBundleSetHash.update('\0')
  runtimeBundleSetHash.update(file.bytes)
  runtimeBundleSetHash.update('\0')
}
const runtimeBundleSetSha256 = runtimeBundleSetHash.digest('hex')
const qualityReportBytes = await optionalBytes(qualityReportPath)
const expertReportBytes = await optionalBytes(expertReportPath)
const privacyImplementationSha256 = await computePrivacyImplementationSha256(root)
const cloudEnforcementSourceSha256 = await computeCloudEnforcementSha256(root)

let qualityGateBound = false
if (qualityReportBytes) {
  try {
    const quality = JSON.parse(qualityReportBytes.toString('utf8'))
    qualityGateBound = quality.version === 'ses-privacy-quality-report-v1' &&
      quality.datasetVersion === 'ses-privacy-regression-v1' &&
      quality.datasetSha256 === '83ce7ac64d07337b41bdd303450c97cc894e74fcf36730bcade60cbb2bf9cb4e' &&
      quality.releaseEligible === true && quality.platform === process.platform && quality.arch === process.arch &&
      quality.syntheticOnly === true && quality.humanLabeledDataset === false &&
      quality.caseCount === 28 && quality.safeCaseCount === 6 && quality.blockedCaseCount === 4 &&
      quality.expectedIdentifiers === 30 && quality.detectedIdentifiers === 30 &&
      quality.identifierRecall === 1 && quality.redactionPrecision === 1 &&
      quality.residualLeakCount === 0 && quality.safeCaseFalsePositiveCount === 0 &&
      quality.failedClosedCases === 4 && quality.cloudDirectIdentifiers === 0 &&
      quality.networkAccess === false && Array.isArray(quality.failures) && quality.failures.length === 0 &&
      (process.platform !== 'darwin' || quality.appleNer?.verified === true) &&
      (process.platform !== 'win32' || quality.appleNer?.required === false)
  } catch {
    qualityGateBound = false
  }
}

let expertAttestationBound = false
if (expertReportBytes) {
  try {
    const expert = JSON.parse(expertReportBytes.toString('utf8'))
    expertAttestationBound = privacyExpertReportFailures(expert, {
      platform: process.platform,
      arch: process.arch,
      privacyImplementationSha256,
      cloudEnforcementSha256: cloudEnforcementSourceSha256
    }).length === 0
  } catch {
    expertAttestationBound = false
  }
}

const manifest = {
  version: 'ses-cloud-enforcement-manifest-v2',
  createdAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  runtimeBundleFiles: runtimeBundleFiles.map(({ path, sha256: fileSha256 }) => ({ path, sha256: fileSha256 })),
  runtimeBundleSetSha256,
  privacyImplementationSha256,
  cloudEnforcementSourceSha256,
  qualityReportSha256: sha256(qualityReportBytes),
  expertReportSha256: sha256(expertReportBytes),
  qualityGateBound,
  expertAttestationBound,
  releaseEligible: qualityGateBound
}

await mkdir(verificationDirectory, { recursive: true })
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
  encoding: 'utf8',
  mode: 0o600
})
await chmod(manifestPath, 0o600)
process.stdout.write(JSON.stringify({
  manifestPath,
  runtimeBundleFiles: manifest.runtimeBundleFiles.length,
  runtimeBundleSetSha256: manifest.runtimeBundleSetSha256,
  qualityGateBound,
  expertAttestationBound,
  releaseEligible: manifest.releaseEligible
}) + '\n')
