// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadCloudPrivacyGates, type CloudPrivacyGateLoadOptions } from './privacy-gates'

const now = new Date('2026-09-01T00:00:00.000Z')
const datasetSha256 = '83ce7ac64d07337b41bdd303450c97cc894e74fcf36730bcade60cbb2bf9cb4e'
const privacyImplementationSha256 = 'a'.repeat(64)
const cloudEnforcementSha256 = 'b'.repeat(64)

type Json = Record<string, unknown>

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function qualityReport(platform: NodeJS.Platform, arch: string, overrides: Json = {}): Json {
  return {
    version: 'ses-privacy-quality-report-v1',
    releaseEligible: true,
    datasetVersion: 'ses-privacy-regression-v1',
    datasetSha256,
    syntheticOnly: true,
    humanLabeledDataset: false,
    platform,
    arch,
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
    cloudDirectIdentifiers: 0,
    networkAccess: false,
    failures: [],
    appleNer: platform === 'darwin' ? { verified: true } : { required: false },
    ...(platform === 'win32' ? { glinerNer: { required: true, verified: true, engine: 'gliner-x-small-onnx' } } : {}),
    ...overrides
  }
}

function expertReport(platform: NodeJS.Platform, arch: string, overrides: Json = {}): Json {
  return {
    version: 'ses-privacy-expert-quality-report-v2',
    datasetVersion: 'ses-privacy-expert-dataset-v1',
    humanLabeledDataset: true,
    syntheticOnly: false,
    locale: 'ja-JP',
    platform,
    arch,
    datasetSha256: 'c'.repeat(64),
    privacyImplementationSha256,
    cloudEnforcementSha256,
    sourceDocumentCount: 60,
    caseCount: 60,
    safeCaseCount: 25,
    expectedPersonNames: 30,
    independentReviewerCount: 2,
    disagreementsResolved: true,
    approvedForLocalEvaluation: true,
    personalDataHandling: 'pseudonymized-local-only',
    postReviewIdentifierRecall: 1,
    automaticNonNameIdentifierRecall: 1,
    redactionPrecision: 0.97,
    automaticPersonNameRecall: 0.93,
    residualLeakCount: 0,
    safeCaseFalsePositiveRate: 0.01,
    manualPersonNameReviewRequired: true,
    containsCaseContent: false,
    cloudDirectIdentifiers: 0,
    networkAccess: false,
    nodeNetworkDenyGuard: true,
    nameDetectionEngines: ['label-and-form-rules', 'apple-natural-language'],
    releaseEligible: true,
    failures: [],
    evaluatedAt: '2026-08-25T00:00:00.000Z',
    reviewedAt: '2026-08-20T00:00:00.000Z',
    ...overrides
  }
}

interface PackageFixture {
  platform?: NodeJS.Platform
  arch?: string
  quality?: Json | string | null
  expert?: Json | string | null
  /** Mutate the manifest after it was computed from the real files. */
  manifest?: (manifest: Json) => Json
  /** Extra runtime bundle files to list in the manifest (path relative to appPath). */
  extraBundleFiles?: Array<{ path: string; sha256?: string }>
  /** Hook to tamper with files after the manifest was written. */
  afterWrite?: (paths: { appPath: string; verification: string }) => Promise<void>
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function packagedFixture(fixture: PackageFixture = {}): Promise<CloudPrivacyGateLoadOptions> {
  const platform = fixture.platform ?? 'darwin'
  const arch = fixture.arch ?? 'arm64'
  const root = await mkdtemp(join(tmpdir(), 'ses-privacy-gates-'))
  temporaryDirectories.push(root)
  const appPath = join(root, 'app')
  const resourcesPath = join(root, 'resources')
  const verification = join(resourcesPath, 'verification')
  await mkdir(join(appPath, 'out', 'main'), { recursive: true })
  await mkdir(join(appPath, 'out', 'preload'), { recursive: true })
  await mkdir(verification, { recursive: true })

  const bundle = [
    { path: 'out/main/index.js', bytes: Buffer.from('console.log("main")\n') },
    { path: 'out/preload/index.js', bytes: Buffer.from('console.log("preload")\n') }
  ]
  for (const file of bundle) await writeFile(join(appPath, file.path), file.bytes)
  const setHash = createHash('sha256')
  for (const file of bundle) {
    setHash.update(file.path).update('\0').update(file.bytes).update('\0')
  }

  const serialize = (value: Json | string | null | undefined, fallback: Json): Buffer | null => {
    if (value === null) return null
    if (typeof value === 'string') return Buffer.from(value)
    return Buffer.from(JSON.stringify(value ?? fallback))
  }
  const qualityBytes = serialize(fixture.quality, qualityReport(platform, arch))
  const expertBytes = serialize(fixture.expert, expertReport(platform, arch))
  if (qualityBytes) await writeFile(join(verification, 'privacy-quality-report.json'), qualityBytes)
  if (expertBytes) await writeFile(join(verification, 'privacy-expert-report.json'), expertBytes)

  let manifest: Json = {
    version: 'ses-cloud-enforcement-manifest-v2',
    platform,
    arch,
    runtimeBundleFiles: [
      ...bundle.map((file) => ({ path: file.path, sha256: sha256(file.bytes) })),
      ...(fixture.extraBundleFiles ?? []).map((file) => ({ path: file.path, sha256: file.sha256 ?? 'd'.repeat(64) }))
    ],
    runtimeBundleSetSha256: setHash.digest('hex'),
    privacyImplementationSha256,
    cloudEnforcementSourceSha256: cloudEnforcementSha256,
    qualityReportSha256: qualityBytes ? sha256(qualityBytes) : null,
    expertReportSha256: expertBytes ? sha256(expertBytes) : null,
    qualityGateBound: true,
    expertAttestationBound: true,
    releaseEligible: true
  }
  if (fixture.manifest) manifest = fixture.manifest(manifest)
  await writeFile(join(verification, 'cloud-enforcement-manifest.json'), JSON.stringify(manifest))
  await fixture.afterWrite?.({ appPath, verification })
  return { packaged: true, resourcesPath, appPath, platform, arch, now }
}

describe('loadCloudPrivacyGates (packaged)', () => {
  it('passes both gates and binds the evidence when every artifact is consistent', async () => {
    const snapshot = await loadCloudPrivacyGates(await packagedFixture())
    expect(snapshot.qualityGate).toMatchObject({
      status: 'passed',
      datasetVersion: 'ses-privacy-regression-v1',
      caseCount: 28,
      identifierRecall: 1,
      residualLeakCount: 0,
      appleNerVerified: true,
      failureCodes: []
    })
    expect(snapshot.qualityGate.reportHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(snapshot.expertGate).toMatchObject({
      status: 'passed',
      datasetVersion: 'ses-privacy-expert-dataset-v1',
      automaticPersonNameRecall: 0.93,
      privacyImplementationSha256,
      cloudEnforcementSha256,
      evaluatedAt: '2026-08-25T00:00:00.000Z',
      failureCodes: []
    })
    expect(snapshot.expertGate.attestationHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(snapshot.binding).toEqual({
      qualityReportHash: snapshot.qualityGate.reportHash,
      expertAttestationHash: snapshot.expertGate.attestationHash,
      privacyImplementationSha256,
      cloudEnforcementSha256
    })
  })

  it('fails closed with no binding when the quality report is missing', async () => {
    const snapshot = await loadCloudPrivacyGates(await packagedFixture({ quality: null }))
    expect(snapshot.qualityGate.status).toBe('not-verified')
    expect(snapshot.qualityGate.failureCodes).toContain('quality:missing')
    expect(snapshot.qualityGate.identifierRecall).toBeNull()
    expect(snapshot.qualityGate.reportHash).toBeNull()
    expect(snapshot.binding).toBeNull()
  })

  it.each([
    ['not json', 'quality:invalid-json'],
    ['[1,2,3]', 'quality:invalid-json'],
    ['null', 'quality:invalid-json']
  ])('rejects a quality report that is not a JSON object (%s)', async (content, code) => {
    const snapshot = await loadCloudPrivacyGates(await packagedFixture({ quality: content }))
    expect(snapshot.qualityGate.status).toBe('not-verified')
    expect(snapshot.qualityGate.failureCodes).toEqual(expect.arrayContaining([code, 'quality:not-an-object']))
    expect(snapshot.binding).toBeNull()
  })

  it.each<[string, Json, string]>([
    ['version', { version: 'ses-privacy-quality-report-v0' }, 'quality:version'],
    ['release eligibility', { releaseEligible: false }, 'quality:not-release-eligible'],
    ['dataset hash', { datasetSha256: 'e'.repeat(64) }, 'quality:dataset-hash'],
    ['dataset mode', { humanLabeledDataset: true }, 'quality:dataset-mode'],
    ['platform', { platform: 'win32' }, 'quality:platform-arch'],
    ['arch', { arch: 'x64' }, 'quality:platform-arch'],
    ['coverage', { detectedIdentifiers: 29 }, 'quality:coverage'],
    ['identifier recall', { identifierRecall: 0.99 }, 'quality:identifier-recall'],
    ['redaction precision', { redactionPrecision: 0.9 }, 'quality:redaction-precision'],
    ['residual leaks', { residualLeakCount: 1 }, 'quality:residual-leaks'],
    ['false positives', { safeCaseFalsePositiveCount: 2 }, 'quality:false-positives'],
    ['cloud identifiers', { cloudDirectIdentifiers: 1 }, 'quality:data-boundary'],
    ['network access', { networkAccess: true }, 'quality:data-boundary'],
    ['recorded failures', { failures: ['case-7'] }, 'quality:failures'],
    ['apple NER on macOS', { appleNer: { verified: false } }, 'quality:apple-ner'],
    ['a GLiNER run that did not verify on macOS', { glinerNer: { required: true, verified: false } }, 'quality:gliner-ner']
  ])('blocks cloud use when the quality report fails on %s', async (_label, override, code) => {
    const snapshot = await loadCloudPrivacyGates(
      await packagedFixture({
        quality: qualityReport('darwin', 'arm64', override)
      })
    )
    expect(snapshot.qualityGate.status).toBe('not-verified')
    expect(snapshot.qualityGate.failureCodes).toContain(code)
    expect(snapshot.qualityGate.caseCount).toBe(0)
    expect(snapshot.binding).toBeNull()
  })

  it('requires the Windows NER contract to be explicitly not-required on win32', async () => {
    const passing = await loadCloudPrivacyGates(
      await packagedFixture({
        platform: 'win32',
        arch: 'x64',
        expert: expertReport('win32', 'x64', { nameDetectionEngines: ['label-and-form-rules', 'gliner-x-small-onnx'] })
      })
    )
    expect(passing.qualityGate.status).toBe('passed')
    expect(passing.qualityGate.appleNerVerified).toBeNull()
    expect(passing.expertGate.status).toBe('passed')

    const failing = await loadCloudPrivacyGates(
      await packagedFixture({
        platform: 'win32',
        arch: 'x64',
        quality: qualityReport('win32', 'x64', { appleNer: { required: true } })
      })
    )
    expect(failing.qualityGate.failureCodes).toContain('quality:windows-ner-contract')
    expect(failing.binding).toBeNull()
  })

  it('passes a macOS report that ran Apple NL alone, when the GLiNER model was not bundled', async () => {
    const snapshot = await loadCloudPrivacyGates(
      await packagedFixture({ quality: qualityReport('darwin', 'arm64', { glinerNer: { required: false, verified: false } }) })
    )
    expect(snapshot.qualityGate.status).toBe('passed')
  })

  it.each<[string, Json]>([
    ['no GLiNER result', { glinerNer: undefined }],
    ['an unverified GLiNER smoke', { glinerNer: { required: true, verified: false, engine: 'gliner-x-small-onnx' } }],
    ['GLiNER marked optional', { glinerNer: { required: false, verified: true, engine: 'gliner-x-small-onnx' } }],
    ['a different engine', { glinerNer: { required: true, verified: true, engine: 'windows-local-ner' } }]
  ])('blocks Windows cloud use with %s', async (_label, override) => {
    const snapshot = await loadCloudPrivacyGates(
      await packagedFixture({
        platform: 'win32',
        arch: 'x64',
        quality: qualityReport('win32', 'x64', override),
        expert: expertReport('win32', 'x64', { nameDetectionEngines: ['label-and-form-rules', 'gliner-x-small-onnx'] })
      })
    )
    expect(snapshot.qualityGate.status).toBe('not-verified')
    expect(snapshot.qualityGate.failureCodes).toContain('quality:gliner-ner')
    expect(snapshot.binding).toBeNull()
  })

  it('rejects a quality report that differs from the one hashed into the manifest', async () => {
    const snapshot = await loadCloudPrivacyGates(
      await packagedFixture({
        afterWrite: async ({ verification }) => {
          // Still a fully valid report, just not the bytes the package was built with.
          await writeFile(join(verification, 'privacy-quality-report.json'), JSON.stringify(qualityReport('darwin', 'arm64'), null, 2))
        }
      })
    )
    expect(snapshot.qualityGate.status).toBe('not-verified')
    expect(snapshot.qualityGate.failureCodes).toContain('package-manifest:quality-report-stale')
    expect(snapshot.binding).toBeNull()
  })

  it('rejects a quality gate the manifest marks as unbound', async () => {
    const snapshot = await loadCloudPrivacyGates(
      await packagedFixture({
        manifest: (manifest) => ({ ...manifest, qualityGateBound: false })
      })
    )
    expect(snapshot.qualityGate.failureCodes).toContain('package-manifest:quality-unbound')
    expect(snapshot.binding).toBeNull()
  })

  it('fails both gates when the manifest is missing', async () => {
    const options = await packagedFixture()
    await rm(join(options.resourcesPath, 'verification', 'cloud-enforcement-manifest.json'))
    const snapshot = await loadCloudPrivacyGates(options)
    expect(snapshot.qualityGate.failureCodes).toContain('package-manifest:missing')
    expect(snapshot.expertGate.failureCodes).toContain('package-manifest:missing')
    expect(snapshot.binding).toBeNull()
  })

  it('fails both gates when a runtime bundle file was modified after packaging', async () => {
    const snapshot = await loadCloudPrivacyGates(
      await packagedFixture({
        afterWrite: async ({ appPath }) => {
          await writeFile(join(appPath, 'out/main/index.js'), 'sendEverythingToTheCloud()\n')
        }
      })
    )
    expect(snapshot.qualityGate.failureCodes).toEqual(
      expect.arrayContaining(['package-manifest:runtime-bundle-stale', 'package-manifest:runtime-bundle-set-stale'])
    )
    expect(snapshot.qualityGate.status).toBe('not-verified')
    expect(snapshot.expertGate.status).toBe('not-verified')
    expect(snapshot.expertGate.attestationHash).toBeNull()
    expect(snapshot.binding).toBeNull()
  })

  it('fails when a runtime bundle file is missing', async () => {
    const snapshot = await loadCloudPrivacyGates(
      await packagedFixture({
        afterWrite: async ({ appPath }) => rm(join(appPath, 'out/preload/index.js'))
      })
    )
    expect(snapshot.qualityGate.failureCodes).toContain('package-manifest:runtime-bundle-missing')
    expect(snapshot.binding).toBeNull()
  })

  it.each([
    'out/main/../../../etc/passwd.js',
    '/etc/out/main/index2.js',
    'out\\main\\evil.js',
    'out/main//double.js',
    'out/main/./dot.js',
    'out/renderer/index.js',
    'out/main/not-js.txt'
  ])('rejects the manifest when a runtime bundle path escapes the allowed scope (%s)', async (path) => {
    const snapshot = await loadCloudPrivacyGates(await packagedFixture({ extraBundleFiles: [{ path }] }))
    expect(snapshot.qualityGate.failureCodes).toContain('package-manifest:runtime-bundle-path')
    expect(snapshot.qualityGate.status).toBe('not-verified')
    expect(snapshot.binding).toBeNull()
  })

  it('rejects duplicate runtime bundle paths and malformed hashes', async () => {
    const snapshot = await loadCloudPrivacyGates(
      await packagedFixture({
        extraBundleFiles: [{ path: 'out/main/index.js' }, { path: 'out/main/other.js', sha256: 'not-a-hash' }]
      })
    )
    expect(snapshot.qualityGate.failureCodes).toEqual(
      expect.arrayContaining(['package-manifest:runtime-bundle-path', 'package-manifest:runtime-bundle-hash'])
    )
  })

  it('requires both runtime entrypoints to be listed', async () => {
    const snapshot = await loadCloudPrivacyGates(
      await packagedFixture({
        manifest: (manifest) => ({
          ...manifest,
          runtimeBundleFiles: (manifest.runtimeBundleFiles as Json[]).filter((file) => file.path !== 'out/preload/index.js')
        })
      })
    )
    expect(snapshot.qualityGate.failureCodes).toContain('package-manifest:runtime-entrypoints')
    expect(snapshot.binding).toBeNull()
  })

  it('rejects a manifest built for another platform or with a malformed implementation hash', async () => {
    const snapshot = await loadCloudPrivacyGates(
      await packagedFixture({
        manifest: (manifest) => ({ ...manifest, platform: 'linux', privacyImplementationSha256: 'short' })
      })
    )
    expect(snapshot.qualityGate.failureCodes).toEqual(
      expect.arrayContaining(['package-manifest:platform-arch', 'package-manifest:privacyImplementationSha256'])
    )
    expect(snapshot.binding).toBeNull()
  })

  describe('expert gate', () => {
    it('keeps the quality binding but drops the attestation when the expert report is stale', async () => {
      const snapshot = await loadCloudPrivacyGates(
        await packagedFixture({
          expert: expertReport('darwin', 'arm64', { evaluatedAt: '2026-06-01T00:00:00.000Z' })
        })
      )
      expect(snapshot.expertGate.status).toBe('not-verified')
      expect(snapshot.expertGate.failureCodes).toContain('report:stale')
      expect(snapshot.expertGate.attestationHash).toBeNull()
      expect(snapshot.expertGate.automaticPersonNameRecall).toBeNull()
      expect(snapshot.qualityGate.status).toBe('passed')
      expect(snapshot.binding).not.toBeNull()
      expect(snapshot.binding?.expertAttestationHash).toBeNull()
    })

    it('rejects an expert report evaluated in the future', async () => {
      const snapshot = await loadCloudPrivacyGates(
        await packagedFixture({
          expert: expertReport('darwin', 'arm64', { evaluatedAt: '2026-10-01T00:00:00.000Z' })
        })
      )
      expect(snapshot.expertGate.failureCodes).toContain('report:stale')
      expect(snapshot.expertGate.attestationHash).toBeNull()
    })

    it('rejects an expert report bound to a different implementation hash', async () => {
      const snapshot = await loadCloudPrivacyGates(
        await packagedFixture({
          expert: expertReport('darwin', 'arm64', { privacyImplementationSha256: 'f'.repeat(64) })
        })
      )
      expect(snapshot.expertGate.failureCodes).toContain('report:privacy-implementation-hash-stale')
      expect(snapshot.expertGate.status).toBe('not-verified')
    })

    it('rejects an expert report with residual leaks or insufficient name recall', async () => {
      const snapshot = await loadCloudPrivacyGates(
        await packagedFixture({
          expert: expertReport('darwin', 'arm64', { residualLeakCount: 1, automaticPersonNameRecall: 0.5 })
        })
      )
      expect(snapshot.expertGate.failureCodes).toEqual(expect.arrayContaining(['report:residual-leaks', 'report:name-recall']))
      expect(snapshot.expertGate.attestationHash).toBeNull()
    })

    it('requires the Apple name engine on macOS', async () => {
      const snapshot = await loadCloudPrivacyGates(
        await packagedFixture({
          expert: expertReport('darwin', 'arm64', { nameDetectionEngines: ['label-and-form-rules'] })
        })
      )
      expect(snapshot.expertGate.failureCodes).toContain('report:apple-name-engine')
    })

    it('reports a missing expert report without breaking the quality gate', async () => {
      const snapshot = await loadCloudPrivacyGates(await packagedFixture({ expert: null }))
      expect(snapshot.expertGate.failureCodes).toEqual(expect.arrayContaining(['expert:missing', 'expert:not-an-object']))
      expect(snapshot.qualityGate.status).toBe('passed')
      expect(snapshot.binding?.expertAttestationHash).toBeNull()
    })

    it('rejects the expert gate when the manifest is not release eligible', async () => {
      const snapshot = await loadCloudPrivacyGates(
        await packagedFixture({
          manifest: (manifest) => ({ ...manifest, releaseEligible: false })
        })
      )
      expect(snapshot.expertGate.failureCodes).toContain('package-manifest:not-release-eligible')
      expect(snapshot.expertGate.attestationHash).toBeNull()
    })

    it('drops an unsafe review timestamp from the snapshot', async () => {
      const snapshot = await loadCloudPrivacyGates(
        await packagedFixture({
          expert: expertReport('darwin', 'arm64', { reviewedAt: 'x'.repeat(60) })
        })
      )
      expect(snapshot.expertGate.reviewedAt).toBeNull()
      expect(snapshot.expertGate.failureCodes).toContain('report:review-stale')
    })

    it('ties the attestation hash to the exact expert report bytes', async () => {
      const first = await loadCloudPrivacyGates(await packagedFixture())
      const second = await loadCloudPrivacyGates(
        await packagedFixture({
          expert: expertReport('darwin', 'arm64', { caseCount: 61 })
        })
      )
      expect(first.expertGate.attestationHash).not.toBeNull()
      expect(second.expertGate.attestationHash).not.toBeNull()
      expect(second.expertGate.attestationHash).not.toBe(first.expertGate.attestationHash)
    })
  })
})

describe('loadCloudPrivacyGates (development source)', () => {
  it('fails closed when the source tree cannot be hashed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ses-privacy-gates-dev-'))
    temporaryDirectories.push(root)
    const verification = join(root, 'build', 'privacy-verification')
    await mkdir(verification, { recursive: true })
    await writeFile(join(verification, 'privacy-quality-report.json'), JSON.stringify(qualityReport('linux', 'x64')))
    const snapshot = await loadCloudPrivacyGates({
      packaged: false,
      resourcesPath: '/nonexistent',
      appPath: '/nonexistent',
      sourceRoot: root,
      platform: 'linux',
      arch: 'x64',
      now
    })
    expect(snapshot.qualityGate.failureCodes).toContain('source-attestation:hash-failed')
    expect(snapshot.qualityGate.status).toBe('not-verified')
    expect(snapshot.binding).toBeNull()
  })

  it('does not require a package manifest in development mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ses-privacy-gates-dev-'))
    temporaryDirectories.push(root)
    const snapshot = await loadCloudPrivacyGates({
      packaged: false,
      resourcesPath: '/nonexistent',
      appPath: '/nonexistent',
      sourceRoot: root,
      platform: 'linux',
      arch: 'x64',
      now
    })
    expect(snapshot.qualityGate.failureCodes).toContain('quality:missing')
    expect(snapshot.qualityGate.failureCodes.some((code) => code.startsWith('package-manifest:'))).toBe(false)
  })
})
