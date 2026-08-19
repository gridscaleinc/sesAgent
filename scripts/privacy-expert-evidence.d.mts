export const privacyExpertReportVersion: 'ses-privacy-expert-quality-report-v2'
export const privacyImplementationPaths: readonly string[]
export const cloudEnforcementPaths: readonly string[]
export const privacyExpertMinimums: Readonly<{
  sourceDocumentCount: number
  caseCount: number
  safeCaseCount: number
  expectedPersonNames: number
  postReviewIdentifierRecall: number
  automaticNonNameIdentifierRecall: number
  redactionPrecision: number
  automaticPersonNameRecall: number
  residualLeakCount: number
  safeCaseFalsePositiveRate: number
  independentReviewerCount: number
  maximumReportAgeDays: number
  maximumReviewAgeDays: number
}>
export function computePrivacyImplementationSha256(root?: string): Promise<string>
export function computeCloudEnforcementSha256(root?: string): Promise<string>
export function privacyExpertReportFailures(
  report: Record<string, unknown>,
  options?: {
    platform?: NodeJS.Platform
    arch?: string
    privacyImplementationSha256?: string
    cloudEnforcementSha256?: string
    now?: Date
  }
): string[]
