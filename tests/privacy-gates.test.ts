import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { loadCloudPrivacyGates } from '../apps/desktop/src/main/privacy-gates'

const temporaryDirectories: string[] = []
const now = new Date('2026-08-18T00:00:00.000Z')
const privacyImplementationSha256 = 'a'.repeat(64)
const cloudEnforcementSourceSha256 = 'b'.repeat(64)

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function qualityReport() {
  return {
    version: 'ses-privacy-quality-report-v1',
    datasetVersion: 'ses-privacy-regression-v1',
    datasetSha256: '83ce7ac64d07337b41bdd303450c97cc894e74fcf36730bcade60cbb2bf9cb4e',
    syntheticOnly: true,
    humanLabeledDataset: false,
    platform: 'darwin',
    arch: 'arm64',
    caseCount: 28,
    safeCaseCount: 6,
    blockedCaseCount: 4,
    expectedIdentifiers: 30,
    detectedIdentifiers: 30,
    failedClosedCases: 4,
    identifierRecall: 1,
    redactionPrecision: 1,
    residualLeakCount: 0,
    safeCaseFalsePositiveCount: 0,
    appleNer: { required: true, verified: true, engine: 'apple-natural-language', detectedNameCount: 2 },
    cloudDirectIdentifiers: 0,
    networkAccess: false,
    releaseEligible: true,
    failures: []
  }
}

function expertReport(overrides: Record<string, unknown> = {}) {
  return {
    version: 'ses-privacy-expert-quality-report-v2',
    datasetVersion: 'ses-privacy-expert-dataset-v1',
    datasetSha256: 'd'.repeat(64),
    privacyImplementationSha256,
    cloudEnforcementSha256: cloudEnforcementSourceSha256,
    humanLabeledDataset: true,
    syntheticOnly: false,
    locale: 'ja-JP',
    platform: 'darwin',
    arch: 'arm64',
    sourceDocumentCount: 50,
    caseCount: 50,
    safeCaseCount: 20,
    expectedPersonNames: 20,
    independentReviewerCount: 2,
    disagreementsResolved: true,
    approvedForLocalEvaluation: true,
    personalDataHandling: 'pseudonymized-local-only',
    reviewedAt: '2026-08-17T00:00:00.000Z',
    evaluatedAt: '2026-08-17T01:00:00.000Z',
    postReviewIdentifierRecall: 1,
    automaticNonNameIdentifierRecall: 1,
    redactionPrecision: 0.95,
    automaticPersonNameRecall: 0.9,
    residualLeakCount: 0,
    safeCaseFalsePositiveRate: 0.05,
    manualPersonNameReviewRequired: true,
    containsCaseContent: false,
    cloudDirectIdentifiers: 0,
    networkAccess: false,
    nodeNetworkDenyGuard: true,
    nameDetectionEngines: ['label-and-form-rules', 'apple-natural-language'],
    releaseEligible: true,
    failures: [],
    ...overrides
  }
}

async function packagedFixture(options: {
  includeExpert?: boolean
  expertOverrides?: Record<string, unknown>
  expertManifestHash?: string
  mainBundleAfterManifest?: string
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ses-privacy-gates-'))
  temporaryDirectories.push(root)
  const resourcesPath = join(root, 'resources')
  const verificationPath = join(resourcesPath, 'verification')
  const appPath = join(root, 'app.asar')
  const mainBundlePath = join(appPath, 'out/main/index.js')
  const preloadBundlePath = join(appPath, 'out/preload/index.js')
  await mkdir(verificationPath, { recursive: true })
  await mkdir(join(appPath, 'out/main'), { recursive: true })
  await mkdir(join(appPath, 'out/preload'), { recursive: true })

  const mainBundleBytes = Buffer.from('trusted-main-bundle')
  const preloadBundleBytes = Buffer.from('trusted-preload-bundle')
  const qualityBytes = Buffer.from(JSON.stringify(qualityReport()) + '\n')
  const includeExpert = options.includeExpert ?? true
  const expertBytes = includeExpert
    ? Buffer.from(JSON.stringify(expertReport(options.expertOverrides)) + '\n')
    : null
  await writeFile(mainBundlePath, mainBundleBytes)
  await writeFile(preloadBundlePath, preloadBundleBytes)
  await writeFile(join(verificationPath, 'privacy-quality-report.json'), qualityBytes)
  if (expertBytes) await writeFile(join(verificationPath, 'privacy-expert-report.json'), expertBytes)

  const runtimeBundleFiles = [
    { path: 'out/main/index.js', sha256: sha256(mainBundleBytes), bytes: mainBundleBytes },
    { path: 'out/preload/index.js', sha256: sha256(preloadBundleBytes), bytes: preloadBundleBytes }
  ]
  const runtimeBundleSetHash = createHash('sha256')
  for (const file of runtimeBundleFiles) {
    runtimeBundleSetHash.update(file.path).update('\0').update(file.bytes).update('\0')
  }
  const manifest = {
    version: 'ses-cloud-enforcement-manifest-v2',
    createdAt: '2026-08-17T02:00:00.000Z',
    platform: 'darwin',
    arch: 'arm64',
    runtimeBundleFiles: runtimeBundleFiles.map(({ path, sha256: fileSha256 }) => ({ path, sha256: fileSha256 })),
    runtimeBundleSetSha256: runtimeBundleSetHash.digest('hex'),
    privacyImplementationSha256,
    cloudEnforcementSourceSha256,
    qualityReportSha256: sha256(qualityBytes),
    expertReportSha256: options.expertManifestHash ?? (expertBytes ? sha256(expertBytes) : null),
    qualityGateBound: true,
    expertAttestationBound: includeExpert,
    releaseEligible: true
  }
  await writeFile(join(verificationPath, 'cloud-enforcement-manifest.json'), JSON.stringify(manifest) + '\n')
  if (options.mainBundleAfterManifest) await writeFile(mainBundlePath, options.mainBundleAfterManifest)
  return { resourcesPath, appPath }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('packaged Cloud privacy gate binding', () => {
  it('accepts a current expert attestation bound to the reports, source manifests and runtime bundles', async () => {
    const fixture = await packagedFixture()
    const result = await loadCloudPrivacyGates({
      ...fixture, packaged: true, platform: 'darwin', arch: 'arm64', now
    })

    expect(result.qualityGate.status).toBe('passed')
    expect(result.expertGate.status).toBe('passed')
    expect(result.binding).toMatchObject({
      qualityReportHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      expertAttestationHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      privacyImplementationSha256,
      cloudEnforcementSha256: cloudEnforcementSourceSha256
    })
  })

  it('keeps Cloud quality binding available when optional expert evidence is missing', async () => {
    const fixture = await packagedFixture({ includeExpert: false })
    const result = await loadCloudPrivacyGates({
      ...fixture, packaged: true, platform: 'darwin', arch: 'arm64', now
    })

    expect(result.qualityGate.status).toBe('passed')
    expect(result.expertGate.status).toBe('not-verified')
    expect(result.expertGate.failureCodes).toEqual(expect.arrayContaining(['expert:missing', 'package-manifest:expert-unbound']))
    expect(result.binding).toMatchObject({
      qualityReportHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      expertAttestationHash: null,
      privacyImplementationSha256,
      cloudEnforcementSha256: cloudEnforcementSourceSha256
    })
  })

  it('rejects an expert report whose enforcement hash is stale', async () => {
    const fixture = await packagedFixture({
      expertOverrides: { cloudEnforcementSha256: 'f'.repeat(64) }
    })
    const result = await loadCloudPrivacyGates({
      ...fixture, packaged: true, platform: 'darwin', arch: 'arm64', now
    })

    expect(result.qualityGate.status).toBe('passed')
    expect(result.expertGate.failureCodes).toContain('report:cloud-enforcement-hash-stale')
    expect(result.binding?.expertAttestationHash).toBeNull()
  })

  it('rejects an expert report whose packaged report hash differs from the manifest', async () => {
    const fixture = await packagedFixture({ expertManifestHash: 'f'.repeat(64) })
    const result = await loadCloudPrivacyGates({
      ...fixture, packaged: true, platform: 'darwin', arch: 'arm64', now
    })

    expect(result.qualityGate.status).toBe('passed')
    expect(result.expertGate.failureCodes).toContain('package-manifest:expert-report-stale')
    expect(result.binding?.expertAttestationHash).toBeNull()
  })

  it('invalidates both gates when a packaged runtime bundle changes after the manifest is created', async () => {
    const fixture = await packagedFixture({ mainBundleAfterManifest: 'modified-main-bundle' })
    const result = await loadCloudPrivacyGates({
      ...fixture, packaged: true, platform: 'darwin', arch: 'arm64', now
    })

    expect(result.qualityGate.status).toBe('not-verified')
    expect(result.expertGate.status).toBe('not-verified')
    expect(result.qualityGate.failureCodes).toContain('package-manifest:runtime-bundle-stale')
    expect(result.binding).toBeNull()
  })

  it('rejects expired expert evidence even when all hashes still match', async () => {
    const fixture = await packagedFixture({
      expertOverrides: { evaluatedAt: '2026-06-01T00:00:00.000Z' }
    })
    const result = await loadCloudPrivacyGates({
      ...fixture, packaged: true, platform: 'darwin', arch: 'arm64', now
    })

    expect(result.expertGate.failureCodes).toContain('report:stale')
    expect(result.binding?.expertAttestationHash).toBeNull()
  })

  it('rejects expert evidence issued for another platform', async () => {
    const fixture = await packagedFixture({
      expertOverrides: { platform: 'win32', arch: 'x64' }
    })
    const result = await loadCloudPrivacyGates({
      ...fixture, packaged: true, platform: 'darwin', arch: 'arm64', now
    })

    expect(result.expertGate.failureCodes).toContain('report:platform-arch')
    expect(result.binding?.expertAttestationHash).toBeNull()
  })
})
