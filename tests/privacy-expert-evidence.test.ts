import { describe, expect, it } from 'vitest'
import { privacyExpertReportFailures, privacyExpertReportVersion } from '../scripts/privacy-expert-evidence.mjs'

function passingReport() {
  return {
    version: privacyExpertReportVersion,
    datasetVersion: 'ses-privacy-expert-dataset-v1',
    datasetSha256: 'a'.repeat(64),
    privacyImplementationSha256: 'b'.repeat(64),
    cloudEnforcementSha256: 'c'.repeat(64),
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
    reviewedAt: '2026-07-20T00:00:00.000Z',
    evaluatedAt: '2026-07-20T00:00:00.000Z',
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
    failures: []
  }
}

describe('privacy expert release evidence', () => {
  it('accepts only current aggregate human-labeled evidence at the minimum thresholds', () => {
    expect(privacyExpertReportFailures(passingReport(), {
      platform: 'darwin',
      arch: 'arm64',
      privacyImplementationSha256: 'b'.repeat(64),
      cloudEnforcementSha256: 'c'.repeat(64),
      now: new Date('2026-07-20T01:00:00.000Z')
    })).toEqual([])
  })

  it('rejects stale implementation, leaked case content and weak name recall', () => {
    const report = {
      ...passingReport(),
      privacyImplementationSha256: 'd'.repeat(64),
      cloudEnforcementSha256: 'e'.repeat(64),
      containsCaseContent: true,
      automaticPersonNameRecall: 0.89
    }
    expect(privacyExpertReportFailures(report, {
      platform: 'darwin',
      arch: 'arm64',
      privacyImplementationSha256: 'b'.repeat(64),
      cloudEnforcementSha256: 'c'.repeat(64),
      now: new Date('2026-07-20T01:00:00.000Z')
    })).toEqual(expect.arrayContaining([
      'report:privacy-implementation-hash-stale',
      'report:cloud-enforcement-hash-stale',
      'report:name-recall',
      'report:data-boundary'
    ]))
  })

  it('rejects reports older than 30 days or reviews older than one year', () => {
    const report = {
      ...passingReport(),
      reviewedAt: '2024-01-01T00:00:00.000Z',
      evaluatedAt: '2026-06-01T00:00:00.000Z'
    }
    expect(privacyExpertReportFailures(report, {
      platform: 'darwin',
      arch: 'arm64',
      privacyImplementationSha256: 'b'.repeat(64),
      cloudEnforcementSha256: 'c'.repeat(64),
      now: new Date('2026-07-20T01:00:00.000Z')
    })).toEqual(expect.arrayContaining(['report:stale', 'report:review-stale']))
  })

  it('does not coerce string metrics or accept a missing failure list', () => {
    const report = {
      ...passingReport(),
      caseCount: '50',
      automaticPersonNameRecall: '0.99',
      failures: undefined
    }
    expect(privacyExpertReportFailures(report, {
      platform: 'darwin',
      arch: 'arm64',
      privacyImplementationSha256: 'b'.repeat(64),
      cloudEnforcementSha256: 'c'.repeat(64),
      now: new Date('2026-07-20T01:00:00.000Z')
    })).toEqual(expect.arrayContaining(['report:cases', 'report:name-recall', 'report:not-release-eligible']))
  })
})
