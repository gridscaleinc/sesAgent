import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative, resolve } from 'node:path'
import type { BootstrapPayload } from '@shared/contracts'
import {
  computeCloudEnforcementSha256,
  computePrivacyImplementationSha256,
  privacyExpertReportFailures
} from '../../../../scripts/privacy-expert-evidence.mjs'

const sha256Pattern = /^[a-f0-9]{64}$/u
const privacyRegressionDatasetSha256 = '83ce7ac64d07337b41bdd303450c97cc894e74fcf36730bcade60cbb2bf9cb4e'

export interface CloudPrivacyGateBinding {
  qualityReportHash: string
  expertAttestationHash: string | null
  privacyImplementationSha256: string
  cloudEnforcementSha256: string
}

export interface CloudPrivacyGateSnapshot {
  qualityGate: BootstrapPayload['privacy']['qualityGate']
  expertGate: BootstrapPayload['privacy']['expertGate']
  binding: CloudPrivacyGateBinding | null
}

export interface CloudPrivacyGateLoadOptions {
  packaged: boolean
  resourcesPath: string
  appPath: string
  sourceRoot?: string
  platform?: NodeJS.Platform
  arch?: string
  now?: Date
}

interface EvidenceFile {
  bytes: Buffer | null
  hash: string | null
  value: Record<string, unknown> | null
  failureCode: string | null
}

interface CloudEnforcementManifest {
  version: 'ses-cloud-enforcement-manifest-v2'
  platform: string
  arch: string
  runtimeBundleFiles: Array<{ path: string; sha256: string }>
  runtimeBundleSetSha256: string
  privacyImplementationSha256: string
  cloudEnforcementSourceSha256: string
  qualityReportSha256: string | null
  expertReportSha256: string | null
  qualityGateBound: boolean
  expertAttestationBound: boolean
  releaseEligible: boolean
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function safeReportTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null
  const timestamp = new Date(value)
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null
}

async function readEvidenceFile(path: string, label: string): Promise<EvidenceFile> {
  try {
    const bytes = await readFile(path)
    try {
      const parsed = JSON.parse(bytes.toString('utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
      return { bytes, hash: sha256(bytes), value: parsed as Record<string, unknown>, failureCode: null }
    } catch {
      return { bytes, hash: sha256(bytes), value: null, failureCode: label + ':invalid-json' }
    }
  } catch {
    return { bytes: null, hash: null, value: null, failureCode: label + ':missing' }
  }
}

function qualityGateFailures(
  report: Record<string, unknown> | null,
  platform: NodeJS.Platform,
  arch: string
): string[] {
  if (!report) return ['quality:not-an-object']
  const failures: string[] = []
  if (report.version !== 'ses-privacy-quality-report-v1') failures.push('quality:version')
  if (report.releaseEligible !== true) failures.push('quality:not-release-eligible')
  if (report.datasetVersion !== 'ses-privacy-regression-v1') failures.push('quality:dataset-version')
  if (report.datasetSha256 !== privacyRegressionDatasetSha256) failures.push('quality:dataset-hash')
  if (report.syntheticOnly !== true || report.humanLabeledDataset !== false) failures.push('quality:dataset-mode')
  if (report.platform !== platform || report.arch !== arch) failures.push('quality:platform-arch')
  if (
    report.caseCount !== 28 || report.safeCaseCount !== 6 || report.blockedCaseCount !== 4 ||
    report.expectedIdentifiers !== 30 || report.detectedIdentifiers !== 30 || report.failedClosedCases !== 4
  ) failures.push('quality:coverage')
  if (report.identifierRecall !== 1) failures.push('quality:identifier-recall')
  if (report.redactionPrecision !== 1) failures.push('quality:redaction-precision')
  if (report.residualLeakCount !== 0) failures.push('quality:residual-leaks')
  if (report.safeCaseFalsePositiveCount !== 0) failures.push('quality:false-positives')
  if (report.cloudDirectIdentifiers !== 0 || report.networkAccess !== false) failures.push('quality:data-boundary')
  if (!Array.isArray(report.failures) || report.failures.length > 0) failures.push('quality:failures')
  const appleNer = report.appleNer as Record<string, unknown> | undefined
  if (platform === 'darwin' && appleNer?.verified !== true) failures.push('quality:apple-ner')
  if (platform === 'win32' && appleNer?.required !== false) failures.push('quality:windows-ner-contract')
  return failures
}

function qualityGateResult(
  evidence: EvidenceFile,
  failures: string[]
): BootstrapPayload['privacy']['qualityGate'] {
  const report = evidence.value
  const passed = failures.length === 0 && report !== null
  const appleNer = report?.appleNer as Record<string, unknown> | undefined
  return {
    status: passed ? 'passed' : 'not-verified',
    datasetVersion: passed ? 'ses-privacy-regression-v1' : null,
    syntheticOnly: true,
    caseCount: passed && typeof report?.caseCount === 'number' ? report.caseCount : 0,
    identifierRecall: passed ? 1 : null,
    redactionPrecision: passed ? 1 : null,
    residualLeakCount: passed ? 0 : null,
    safeCaseFalsePositiveCount: passed ? 0 : null,
    appleNerVerified: passed && report?.platform === 'darwin' ? appleNer?.verified === true : null,
    reportHash: evidence.hash,
    failureCodes: [...new Set(failures)]
  }
}

function expertGateResult(
  evidence: EvidenceFile,
  failures: string[],
  attestationHash: string | null
): BootstrapPayload['privacy']['expertGate'] {
  const report = evidence.value
  const passed = failures.length === 0 && report !== null && attestationHash !== null
  return {
    status: passed ? 'passed' : 'not-verified',
    datasetVersion: passed ? 'ses-privacy-expert-dataset-v1' : null,
    humanLabeledDataset: true,
    sourceDocumentCount: passed && typeof report?.sourceDocumentCount === 'number' ? report.sourceDocumentCount : 0,
    caseCount: passed && typeof report?.caseCount === 'number' ? report.caseCount : 0,
    automaticPersonNameRecall: passed && typeof report?.automaticPersonNameRecall === 'number'
      ? report.automaticPersonNameRecall
      : null,
    postReviewIdentifierRecall: passed && typeof report?.postReviewIdentifierRecall === 'number'
      ? report.postReviewIdentifierRecall
      : null,
    redactionPrecision: passed && typeof report?.redactionPrecision === 'number' ? report.redactionPrecision : null,
    reviewedAt: safeReportTimestamp(report?.reviewedAt),
    evaluatedAt: safeReportTimestamp(report?.evaluatedAt),
    reportHash: evidence.hash,
    attestationHash: passed ? attestationHash : null,
    privacyImplementationSha256: passed && typeof report?.privacyImplementationSha256 === 'string'
      ? report.privacyImplementationSha256
      : null,
    cloudEnforcementSha256: passed && typeof report?.cloudEnforcementSha256 === 'string'
      ? report.cloudEnforcementSha256
      : null,
    failureCodes: [...new Set(failures)]
  }
}

function parseCloudEnforcementManifest(
  evidence: EvidenceFile,
  platform: NodeJS.Platform,
  arch: string
): { manifest: CloudEnforcementManifest | null; failures: string[] } {
  const value = evidence.value
  const failures: string[] = []
  if (!value) return { manifest: null, failures: [evidence.failureCode ?? 'package-manifest:not-an-object'] }
  if (value.version !== 'ses-cloud-enforcement-manifest-v2') failures.push('package-manifest:version')
  if (value.platform !== platform || value.arch !== arch) failures.push('package-manifest:platform-arch')
  for (const field of [
    'runtimeBundleSetSha256',
    'privacyImplementationSha256',
    'cloudEnforcementSourceSha256'
  ] as const) {
    if (!sha256Pattern.test(typeof value[field] === 'string' ? value[field] : '')) {
      failures.push('package-manifest:' + field)
    }
  }
  for (const field of ['qualityReportSha256', 'expertReportSha256'] as const) {
    if (value[field] !== null && !sha256Pattern.test(typeof value[field] === 'string' ? value[field] : '')) {
      failures.push('package-manifest:' + field)
    }
  }
  const runtimeBundleFiles = Array.isArray(value.runtimeBundleFiles) ? value.runtimeBundleFiles : []
  const runtimeBundlePaths = new Set<string>()
  if (runtimeBundleFiles.length === 0 || runtimeBundleFiles.length > 100) failures.push('package-manifest:runtime-bundle-files')
  for (const candidate of runtimeBundleFiles) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      failures.push('package-manifest:runtime-bundle-entry')
      continue
    }
    const file = candidate as Record<string, unknown>
    const path = typeof file.path === 'string' ? file.path : ''
    if (
      (!path.startsWith('out/main/') && !path.startsWith('out/preload/')) ||
      !path.endsWith('.js') || isAbsolute(path) || path.includes('\\') || path.includes('//') ||
      path.split('/').includes('..') || path.split('/').includes('.') || runtimeBundlePaths.has(path)
    ) failures.push('package-manifest:runtime-bundle-path')
    if (!sha256Pattern.test(typeof file.sha256 === 'string' ? file.sha256 : '')) {
      failures.push('package-manifest:runtime-bundle-hash')
    }
    runtimeBundlePaths.add(path)
  }
  if (!runtimeBundlePaths.has('out/main/index.js') || !runtimeBundlePaths.has('out/preload/index.js')) {
    failures.push('package-manifest:runtime-entrypoints')
  }
  return {
    manifest: failures.length === 0 ? value as unknown as CloudEnforcementManifest : null,
    failures
  }
}

function resolvePackagedRuntimeBundle(appPath: string, relativePath: string): string | null {
  if (isAbsolute(relativePath)) return null
  const normalizedRoot = normalize(appPath)
  const candidate = normalize(join(normalizedRoot, relativePath))
  const relativePathFromRoot = relative(normalizedRoot, candidate)
  if (!relativePathFromRoot || relativePathFromRoot.startsWith('..') || isAbsolute(relativePathFromRoot)) return null
  return candidate
}

export async function loadCloudPrivacyGates(
  options: CloudPrivacyGateLoadOptions
): Promise<CloudPrivacyGateSnapshot> {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const now = options.now ?? new Date()
  const sourceRoot = resolve(options.sourceRoot ?? process.cwd())
  const verificationRoot = options.packaged
    ? join(options.resourcesPath, 'verification')
    : join(sourceRoot, 'build', 'privacy-verification')
  const [qualityEvidence, expertEvidence, manifestEvidence] = await Promise.all([
    readEvidenceFile(join(verificationRoot, 'privacy-quality-report.json'), 'quality'),
    readEvidenceFile(join(verificationRoot, 'privacy-expert-report.json'), 'expert'),
    options.packaged
      ? readEvidenceFile(join(verificationRoot, 'cloud-enforcement-manifest.json'), 'package-manifest')
      : Promise.resolve<EvidenceFile>({ bytes: null, hash: null, value: null, failureCode: null })
  ])

  const qualityFailures = [
    ...(qualityEvidence.failureCode ? [qualityEvidence.failureCode] : []),
    ...qualityGateFailures(qualityEvidence.value, platform, arch)
  ]
  const commonPackageFailures: string[] = []
  const qualityPackageFailures: string[] = []
  const expertPackageFailures: string[] = []
  let privacyImplementationSha256: string | null = null
  let cloudEnforcementSha256: string | null = null
  let runtimeBundleSetSha256: string | null = null

  if (options.packaged) {
    const parsedManifest = parseCloudEnforcementManifest(manifestEvidence, platform, arch)
    commonPackageFailures.push(...parsedManifest.failures)
    const manifest = parsedManifest.manifest
    if (manifest) {
      privacyImplementationSha256 = manifest.privacyImplementationSha256
      cloudEnforcementSha256 = manifest.cloudEnforcementSourceSha256
      if (!manifest.qualityGateBound) qualityPackageFailures.push('package-manifest:quality-unbound')
      if (!manifest.expertAttestationBound) expertPackageFailures.push('package-manifest:expert-unbound')
      if (!manifest.releaseEligible) expertPackageFailures.push('package-manifest:not-release-eligible')
      if (qualityEvidence.hash !== manifest.qualityReportSha256) {
        qualityPackageFailures.push('package-manifest:quality-report-stale')
      }
      if (expertEvidence.hash !== manifest.expertReportSha256) {
        expertPackageFailures.push('package-manifest:expert-report-stale')
      }
      const runtimeBundleSetHash = createHash('sha256')
      for (const file of manifest.runtimeBundleFiles) {
        const runtimeBundlePath = resolvePackagedRuntimeBundle(options.appPath, file.path)
        if (!runtimeBundlePath) {
          commonPackageFailures.push('package-manifest:runtime-bundle-scope')
          continue
        }
        try {
          const bytes = await readFile(runtimeBundlePath)
          runtimeBundleSetHash.update(file.path)
          runtimeBundleSetHash.update('\0')
          runtimeBundleSetHash.update(bytes)
          runtimeBundleSetHash.update('\0')
          if (sha256(bytes) !== file.sha256) {
            commonPackageFailures.push('package-manifest:runtime-bundle-stale')
          }
        } catch {
          commonPackageFailures.push('package-manifest:runtime-bundle-missing')
        }
      }
      runtimeBundleSetSha256 = runtimeBundleSetHash.digest('hex')
      if (runtimeBundleSetSha256 !== manifest.runtimeBundleSetSha256) {
        commonPackageFailures.push('package-manifest:runtime-bundle-set-stale')
      }
    }
  } else {
    try {
      ;[privacyImplementationSha256, cloudEnforcementSha256] = await Promise.all([
        computePrivacyImplementationSha256(sourceRoot),
        computeCloudEnforcementSha256(sourceRoot)
      ])
    } catch {
      commonPackageFailures.push('source-attestation:hash-failed')
    }
  }

  qualityFailures.push(...commonPackageFailures, ...qualityPackageFailures)
  const expertFailures = [
    ...(expertEvidence.failureCode ? [expertEvidence.failureCode] : []),
    ...commonPackageFailures,
    ...expertPackageFailures
  ]
  if (expertEvidence.value) {
    expertFailures.push(...privacyExpertReportFailures(expertEvidence.value, {
      platform,
      arch,
      privacyImplementationSha256: privacyImplementationSha256 ?? undefined,
      cloudEnforcementSha256: cloudEnforcementSha256 ?? undefined,
      now
    }))
  } else {
    expertFailures.push('expert:not-an-object')
  }

  const attestationHash = expertFailures.length === 0 && expertEvidence.bytes &&
    privacyImplementationSha256 && cloudEnforcementSha256
    ? createHash('sha256')
        .update(expertEvidence.bytes)
        .update('\0')
        .update(privacyImplementationSha256)
        .update('\0')
        .update(cloudEnforcementSha256)
        .update('\0')
        .update(runtimeBundleSetSha256 ?? 'development-source')
        .digest('hex')
    : null
  const qualityGate = qualityGateResult(qualityEvidence, qualityFailures)
  const expertGate = expertGateResult(expertEvidence, expertFailures, attestationHash)
  const binding = qualityGate.status === 'passed' && qualityGate.reportHash &&
    privacyImplementationSha256 && cloudEnforcementSha256
    ? {
        qualityReportHash: qualityGate.reportHash,
        expertAttestationHash: expertGate.attestationHash,
        privacyImplementationSha256,
        cloudEnforcementSha256
      }
    : null

  return { qualityGate, expertGate, binding }
}
