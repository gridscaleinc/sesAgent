import { readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const privacyExpertReportVersion = 'ses-privacy-expert-quality-report-v2'
export const privacyExpertMinimums = Object.freeze({
  sourceDocumentCount: 50,
  caseCount: 50,
  safeCaseCount: 20,
  expectedPersonNames: 20,
  postReviewIdentifierRecall: 1,
  automaticNonNameIdentifierRecall: 1,
  redactionPrecision: 0.95,
  automaticPersonNameRecall: 0.9,
  residualLeakCount: 0,
  safeCaseFalsePositiveRate: 0.05,
  independentReviewerCount: 2,
  maximumReportAgeDays: 30,
  maximumReviewAgeDays: 365
})

export const privacyImplementationPaths = Object.freeze([
  'packages/privacy/src/index.ts',
  'packages/local-ai/src/vision-ocr.ts',
  'apps/desktop/src/workers/network-deny.ts',
  'scripts/verify-privacy-expert-dataset.ts',
  'scripts/privacy-expert-evidence.mjs'
])

export const cloudEnforcementPaths = Object.freeze([
  'apps/desktop/src/main/cloud-ai-privacy.ts',
  'apps/desktop/src/main/cloud-ai-review.ts',
  'apps/desktop/src/main/privacy-gates.ts',
  'apps/desktop/src/main/index.ts',
  'apps/desktop/src/main/app-defaults.ts',
  'apps/desktop/src/main/business-text-intake.ts',
  'apps/desktop/src/main/business-field-editing.ts',
  'apps/desktop/src/main/business-matching-policy.ts',
  'apps/desktop/src/main/gmail-personnel-intake.ts',
  'apps/desktop/src/main/introduction-generation.ts',
  'apps/desktop/src/main/business-progress.ts',
  'apps/desktop/src/main/local-resume-analysis.ts',
  'apps/desktop/src/main/resume-agent-facts.ts',
  'apps/desktop/src/main/original-open-root.ts',
  'apps/desktop/src/main/recovery-verification.ts',
  'apps/desktop/src/main/work-task-helpers.ts',
  'apps/desktop/src/main/ipc/aicommerce.ts',
  'apps/desktop/src/main/ipc/ats-import.ts',
  'apps/desktop/src/main/ipc/bootstrap.ts',
  'apps/desktop/src/main/ipc/candidate-evaluation.ts',
  'apps/desktop/src/main/ipc/candidate-match.ts',
  'apps/desktop/src/main/ipc/candidates.ts',
  'apps/desktop/src/main/ipc/context.ts',
  'apps/desktop/src/main/ipc/google-workspace.ts',
  'apps/desktop/src/main/ipc/interviews.ts',
  'apps/desktop/src/main/ipc/job-cases.ts',
  'apps/desktop/src/main/ipc/proposals.ts',
  'apps/desktop/src/main/ipc/personnel.ts',
  'apps/desktop/src/main/case-personnel-matching.ts',
  'apps/desktop/src/main/personnel-case-matching.ts',
  'packages/persistence/src/stores/personnel-store.ts',
  'packages/persistence/src/index.ts',
  'packages/persistence/src/stores/job-case-store.ts',
  'packages/shared/src/business-workbench.ts',
  'packages/shared/src/business-feed.ts',
  'apps/desktop/src/main/ipc/recovery.ts',
  'apps/desktop/src/main/ipc/resume-import.ts',
  'apps/desktop/src/main/ipc/settings.ts',
  'apps/desktop/src/main/ipc/work-tasks.ts',
  'apps/desktop/src/preload/index.ts',
  'packages/shared/src/contracts.ts',
  'packages/shared/src/schemas.ts',
  'packages/shared/src/match-assessment-evidence.ts',
  'packages/shared/src/matching-requirements.ts',
  'packages/privacy/src/index.ts',
  'packages/aicommerce/src/index.ts',
  'scripts/generate-cloud-enforcement-manifest.mjs',
  'scripts/privacy-expert-evidence.mjs',
  'scripts/check-macos-release.mjs',
  'scripts/check-windows-release.mjs',
  'scripts/verify-macos-package.mjs',
  'scripts/verify-windows-package.mjs',
  'electron-builder.yml',
  'electron-builder.win.yml',
  'package.json'
])

async function computeSourceSetSha256(paths, root) {
  const hash = createHash('sha256')
  for (const relativePath of paths) {
    hash.update(relativePath)
    hash.update('\0')
    hash.update(await readFile(resolve(root, relativePath)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/**
 * Main-process sources deliberately left outside the cloud enforcement source
 * binding. Listing them keeps the gap explicit and auditable instead of it
 * being an accident of which files happen to appear in the list above.
 */
export const unboundMainProcessSources = Object.freeze([
  'apps/desktop/src/main/agent-cloud-narrative.ts',
  'apps/desktop/src/main/agent-ipc.ts',
  'apps/desktop/src/main/ats-csv.ts',
  'apps/desktop/src/main/broadcast-service.ts',
  'apps/desktop/src/main/broadcast-workspace.ts',
  'apps/desktop/src/main/gmail-job-case-intake.ts',
  'apps/desktop/src/main/gmail-sync-scheduler.ts',
  'apps/desktop/src/main/job-case-digest.ts',
  'apps/desktop/src/main/ipc/broadcast.ts',
  'apps/desktop/src/main/startup-smoke.ts',
  'apps/desktop/src/main/wechat-visible-reader.ts'
])

/**
 * Fails when a main-process source is neither bound nor explicitly unbound, so
 * moving code out of a bound file cannot silently shrink what the Cloud
 * Enforcement Source SHA covers.
 */
export function mainProcessCoverageFailures(root = process.cwd()) {
  const directory = 'apps/desktop/src/main'
  const walk = (relativeDirectory) => readdirSync(resolve(root, relativeDirectory), { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${relativeDirectory}/${entry.name}`
      if (entry.isDirectory()) return walk(path)
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
    })
  const known = new Set([...cloudEnforcementPaths, ...unboundMainProcessSources])
  return walk(directory).filter((path) => !known.has(path)).sort()
}

export function computePrivacyImplementationSha256(root = process.cwd()) {
  return computeSourceSetSha256(privacyImplementationPaths, root)
}

export function computeCloudEnforcementSha256(root = process.cwd()) {
  return computeSourceSetSha256(cloudEnforcementPaths, root)
}

export function privacyExpertReportFailures(report, options = {}) {
  const expectedPlatform = options.platform ?? process.platform
  const expectedArch = options.arch ?? process.arch
  const expectedPrivacyImplementationSha256 = options.privacyImplementationSha256
  const expectedCloudEnforcementSha256 = options.cloudEnforcementSha256
  const now = options.now ?? new Date()
  const failures = []
  const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value)
  if (!report || typeof report !== 'object') return ['report:not-an-object']
  if (report.version !== privacyExpertReportVersion) failures.push('report:version')
  if (report.datasetVersion !== 'ses-privacy-expert-dataset-v1') failures.push('report:dataset-version')
  if (report.humanLabeledDataset !== true || report.syntheticOnly !== false) failures.push('report:not-human-labeled')
  if (report.locale !== 'ja-JP') failures.push('report:locale')
  if (report.platform !== expectedPlatform || report.arch !== expectedArch) failures.push('report:platform-arch')
  if (!/^[a-f0-9]{64}$/u.test(report.datasetSha256 ?? '')) failures.push('report:dataset-hash')
  if (!/^[a-f0-9]{64}$/u.test(report.privacyImplementationSha256 ?? '')) {
    failures.push('report:privacy-implementation-hash-format')
  }
  if (!/^[a-f0-9]{64}$/u.test(report.cloudEnforcementSha256 ?? '')) {
    failures.push('report:cloud-enforcement-hash-format')
  }
  if (
    expectedPrivacyImplementationSha256 &&
    report.privacyImplementationSha256 !== expectedPrivacyImplementationSha256
  ) {
    failures.push('report:privacy-implementation-hash-stale')
  }
  if (expectedCloudEnforcementSha256 && report.cloudEnforcementSha256 !== expectedCloudEnforcementSha256) {
    failures.push('report:cloud-enforcement-hash-stale')
  }
  if (!finiteNumber(report.sourceDocumentCount) || report.sourceDocumentCount < privacyExpertMinimums.sourceDocumentCount) failures.push('report:source-documents')
  if (!finiteNumber(report.caseCount) || report.caseCount < privacyExpertMinimums.caseCount) failures.push('report:cases')
  if (!finiteNumber(report.safeCaseCount) || report.safeCaseCount < privacyExpertMinimums.safeCaseCount) failures.push('report:safe-cases')
  if (!finiteNumber(report.expectedPersonNames) || report.expectedPersonNames < privacyExpertMinimums.expectedPersonNames) failures.push('report:person-name-coverage')
  if (!finiteNumber(report.independentReviewerCount) || report.independentReviewerCount < privacyExpertMinimums.independentReviewerCount) failures.push('report:reviewers')
  if (report.disagreementsResolved !== true || report.approvedForLocalEvaluation !== true) failures.push('report:review-protocol')
  if (!['pseudonymized-local-only', 'consented-local-only'].includes(report.personalDataHandling)) {
    failures.push('report:personal-data-handling')
  }
  if (!finiteNumber(report.postReviewIdentifierRecall) || report.postReviewIdentifierRecall !== privacyExpertMinimums.postReviewIdentifierRecall) failures.push('report:identifier-recall')
  if (!finiteNumber(report.automaticNonNameIdentifierRecall) || report.automaticNonNameIdentifierRecall !== privacyExpertMinimums.automaticNonNameIdentifierRecall) {
    failures.push('report:non-name-recall')
  }
  if (!finiteNumber(report.redactionPrecision) || report.redactionPrecision < privacyExpertMinimums.redactionPrecision) failures.push('report:redaction-precision')
  if (!finiteNumber(report.automaticPersonNameRecall) || report.automaticPersonNameRecall < privacyExpertMinimums.automaticPersonNameRecall) failures.push('report:name-recall')
  if (!finiteNumber(report.residualLeakCount) || report.residualLeakCount !== privacyExpertMinimums.residualLeakCount) failures.push('report:residual-leaks')
  if (!finiteNumber(report.safeCaseFalsePositiveRate) || report.safeCaseFalsePositiveRate > privacyExpertMinimums.safeCaseFalsePositiveRate) failures.push('report:false-positive-rate')
  if (report.manualPersonNameReviewRequired !== true) failures.push('report:manual-name-review')
  if (report.containsCaseContent !== false || report.cloudDirectIdentifiers !== 0 || report.networkAccess !== false) {
    failures.push('report:data-boundary')
  }
  if (report.nodeNetworkDenyGuard !== true) failures.push('report:network-guard')
  const nameDetectionEngines = Array.isArray(report.nameDetectionEngines) ? report.nameDetectionEngines : []
  if (!nameDetectionEngines.includes('label-and-form-rules')) {
    failures.push('report:name-engine')
  }
  if (expectedPlatform === 'darwin' && !nameDetectionEngines.includes('apple-natural-language')) {
    failures.push('report:apple-name-engine')
  }
  if (report.releaseEligible !== true || !Array.isArray(report.failures) || report.failures.length > 0) {
    failures.push('report:not-release-eligible')
  }
  const evaluatedAt = typeof report.evaluatedAt === 'string' ? new Date(report.evaluatedAt) : new Date(Number.NaN)
  const maximumAgeMs = privacyExpertMinimums.maximumReportAgeDays * 24 * 60 * 60 * 1000
  if (!Number.isFinite(evaluatedAt.getTime()) || evaluatedAt > now || now.getTime() - evaluatedAt.getTime() > maximumAgeMs) {
    failures.push('report:stale')
  }
  const reviewedAt = typeof report.reviewedAt === 'string' ? new Date(report.reviewedAt) : new Date(Number.NaN)
  const maximumReviewAgeMs = privacyExpertMinimums.maximumReviewAgeDays * 24 * 60 * 60 * 1000
  if (!Number.isFinite(reviewedAt.getTime()) || reviewedAt > now || now.getTime() - reviewedAt.getTime() > maximumReviewAgeMs) {
    failures.push('report:review-stale')
  }
  return [...new Set(failures)]
}
