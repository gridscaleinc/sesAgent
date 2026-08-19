import type { SignedWorkTaskPreview, WorkTask } from '@domain'

export type WorkTaskScopeId =
  | 'confirmed-candidate-pool'
  | 'selected-files'
  | 'selected-gmail-message'
  | 'selected-case'

export interface WorkTaskInput {
  instruction: string
  scopeId?: WorkTaskScopeId
  fileTokens?: string[]
  jobCaseId?: string
}

export interface CreateWorkTaskInput extends WorkTaskInput {
  previewHash: string
}

export interface SetWorkTaskLifecycleInput {
  taskId: string
  action: 'cancel' | 'retry'
  expectedUpdatedAt: string
}

export type ProcessingJobStatus = 'queued' | 'running' | 'succeeded' | 'retry_wait' | 'failed' | 'cancelled'

export type DomainToolName =
  | 'resume.analyze.local'
  | 'candidate.draft.read.local'
  | 'candidate.interview.schedule.local'
  | 'job-case.search.local'
  | 'candidate.match.local'
  | 'candidate.profile.read.local'
  | 'candidate.interview.read.local'
  | 'match-run.read.local'
  | 'gmail.sync.read'
  | 'wechat.visible.read'
  | 'proposal.export'

export type ActionRunStatus = 'proposed' | 'awaiting_approval' | 'awaiting_foreground_confirmation' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'blocked'

/** A deliberately redacted projection. Never put request bodies, names, email, or paths here. */
export interface ActionApprovalSummary {
  id: string
  actionRunId: string
  toolName: DomainToolName
  workTaskId: string | null
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled'
  reason: string
  safeSummary: string
  inputHash: string
  contentRevision: string | null
  expiresAt: string
  createdAt: string
  resolvedAt: string | null
}

export interface ResolveActionApprovalInput {
  approvalId: string
  decision: 'approve' | 'deny'
}

export interface ProcessingJobSummary {
  id: string
  type: 'candidate-match' | 'resume-analysis' | 'proposal-export'
  workTaskId: string
  taskStepId: string
  status: ProcessingJobStatus
  replayPolicy: 'safe-local' | 'manual-review'
  progress: number
  attemptCount: number
  maxAttempts: number
  nextRetryAt: string | null
  leaseExpiresAt: string | null
  cancelRequestedAt: string | null
  errorCode: string | null
  createdAt: string
  updatedAt: string
}

export type SupportedResumeFormat = 'pdf' | 'docx' | 'xlsx' | 'xls' | 'xlsb'

export const candidateFieldKeys = [
  'skills',
  'experience_years',
  'availability',
  'rate',
  'japanese_level',
  'work_style',
  'role',
  'location',
  'work_authorization'
] as const

export type CandidateFieldKey = (typeof candidateFieldKeys)[number]

export const candidateMatchSuitableReasonCodes = [
  'overall_fit',
  'strong_skill_fit',
  'strong_project_fit',
  'commercial_fit',
  'availability_fit',
  'location_fit',
  'work_authorization_fit',
  'other'
] as const

export const candidateMatchUnsuitableReasonCodes = [
  'skill_mismatch',
  'insufficient_project_evidence',
  'rate_mismatch',
  'availability_mismatch',
  'work_style_mismatch',
  'japanese_mismatch',
  'location_mismatch',
  'work_authorization_mismatch',
  'client_preference',
  'stale_profile',
  'other'
] as const

export const candidateMatchFeedbackReasonCodes = [
  ...candidateMatchSuitableReasonCodes,
  ...candidateMatchUnsuitableReasonCodes.filter((reason) => reason !== 'other')
] as const

export type CandidateMatchFeedbackDecision = 'suitable' | 'unsuitable'
export type CandidateMatchFeedbackReasonCode = (typeof candidateMatchFeedbackReasonCodes)[number]
export type CandidateHardFilterPolicyVersion = 'fail-closed-v1' | 'tri-state-v2' | 'tri-state-v3'

export const candidateWorkAuthorizationValues = [
  '就労制限なし',
  '就労資格あり（職種・期限要確認）',
  '資格外活動のみ（制限あり）',
  '就労不可'
] as const

export type CandidateWorkAuthorization = (typeof candidateWorkAuthorizationValues)[number]

export interface CandidateProjectExperience {
  id: string
  title: string
  period: string | null
  role: string | null
  technologies: string[]
  summary: string
  sourceLabels: string[]
}

export interface CandidateProjectReviewSnapshot {
  draftId: string
  title: string
  period: string | null
  role: string | null
  technologies: string[]
  summary: string
  confidence: number
  sourceLabels: string[]
  changed: boolean
  changeReason: string | null
}

export interface CandidateProjectMatchEvidence extends CandidateProjectExperience {
  matchType: 'lexical' | 'semantic' | 'hybrid'
  matchedTerms: string[]
  vectorScore: number | null
}

export const jobCaseFieldKeys = [
  'title',
  'role',
  'required_skills',
  'rate',
  'settlement',
  'location',
  'remote',
  'start_date',
  'working_hours',
  'japanese_level',
  'interview',
  'contract_chain',
  'payment_terms',
  'work_authorization'
] as const

export type JobCaseFieldKey = (typeof jobCaseFieldKeys)[number]
export type JobCaseSourceType = 'gmail' | 'manual' | 'eml' | 'chat-paste' | 'wechat-visible'

export interface StagedLocalFile {
  token: string
  name: string
  format: SupportedResumeFormat
  size: number
  sha256: string
  createdAt: string
  privacyStatus: 'awaiting-local-scan'
}

export interface ResumeAnalysisSummary {
  analysisVersion: 'resume-analysis-v1' | 'resume-analysis-v2' | 'resume-analysis-v3' | 'resume-analysis-v4' | 'resume-analysis-v5' | 'resume-analysis-v6'
  fileToken: string
  fileName: string
  status: 'requires-pii-review' | 'requires-local-ocr' | 'ready-for-field-review'
  cloudEligible: false
  statistics: {
    pages: number
    sheets: number
    blocks: number
    characters: number
  }
  detectedIdentifiers: Array<{ type: string; count: number }>
  localProcessing: {
    ocr: 'not-required' | 'apple-vision-completed' | 'windows-media-ocr-completed' | 'windows-tesseract-wasm-completed' | 'requires-local-ocr'
    ocrPages: number
    personNameCandidates: number
    networkAccess: false
  }
  extractedFields: Array<{
    key: string
    label: string
    value: string | null
    confidence: number
    status: 'needs_review' | 'missing'
    sourceLabels: string[]
  }>
  extractedProjectExperiences?: Array<{
    draftId: string
    title: string
    period: string | null
    role: string | null
    technologies: string[]
    summary: string
    confidence: number
    sourceLabels: string[]
  }>
  warningCodes: string[]
  redactedPreview: string
  analyzedAt: string
}

export interface ResumeAnalysisTaskExecutionResult {
  analysis: ResumeAnalysisSummary
  task: WorkTask
  processingJob: ProcessingJobSummary
}

export interface CandidateReviewFieldSnapshot {
  key: CandidateFieldKey
  label: string
  originalValue: string | null
  value: string | null
  confidence: number
  status: 'needs_review' | 'missing' | 'confirmed'
  sourceLabels: string[]
  changed: boolean
  changeReason: string | null
}

export interface CandidateProfileSummary {
  id: string
  sourceDocumentId: string
  version: number
  /** State of this immutable profile version, not recruiting eligibility. */
  status: 'current' | 'stale' | 'superseded'
  confirmedAt: string
  confirmedBy: string
  containsDirectIdentifiers: boolean
}

export type CandidateRecruitingStatus = 'pending-review' | 'ready-for-recruiting' | 'recruiting' | 'passed' | 'rejected' | 'withdrawn' | 'no-show' | 'on-hold'
export type TalentPoolMembershipStatus = 'none' | 'eligible' | 'suspended' | 'removed'
export type CandidateRecordStatus = 'active' | 'archived' | 'deleted'

export interface LocalCandidatePersonalDetails {
  displayName: string | null
  gender: string | null
  birthDate: string | null
  nationality: string | null
  phone: string | null
  email: string | null
  address: string | null
  education: string | null
  major: string | null
  graduationDate: string | null
  degree: string | null
}

export interface LocalCandidateIdentitySummary extends LocalCandidatePersonalDetails {
  storage: 'encrypted-local-only'
  cloudEligible: false
}

export const localCandidatePersonalFieldKeys = [
  'displayName',
  'gender',
  'birthDate',
  'nationality',
  'phone',
  'email',
  'address',
  'education',
  'major',
  'graduationDate',
  'degree'
] as const

export type LocalCandidatePersonalFieldKey = (typeof localCandidatePersonalFieldKeys)[number]

export interface OriginalDocumentPreviewCell {
  address: string
  text: string
  mergedRange: string | null
  inPrintArea: boolean | null
}

export interface OriginalDocumentPreviewSheet {
  name: string
  printArea: string | null
  cells: OriginalDocumentPreviewCell[]
}

export interface OriginalDocumentPreviewPage {
  pageNumber: number
  blocks: Array<{
    text: string
    boundingBox: [number, number, number, number] | null
  }>
}

export interface OriginalDocumentPreview {
  version: 'original-document-preview-v1'
  documentId: string
  fileName: string
  format: SupportedResumeFormat
  size: number
  sha256: string
  viewMode: 'pdf' | 'spreadsheet' | 'document'
  previewUrl: string | null
  sheets: OriginalDocumentPreviewSheet[]
  pages: OriginalDocumentPreviewPage[]
  paragraphs: Array<{ paragraphNumber: number; text: string }>
  personalFieldSources: Partial<Record<LocalCandidatePersonalFieldKey, string[]>>
  storage: 'encrypted-local-vault'
  cloudEligible: false
  originalFileAvailable: true
}

export interface OpenOriginalDocumentResult {
  opened: true
  fileName: string
  cleanup: 'scheduled'
}

export interface CandidateProfileLibraryField {
  key: CandidateFieldKey
  label: string
  value: string | null
  sourceLabels: string[]
}

export interface CandidateProfileSearchResult extends CandidateProfileSummary {
  anonymousLabel: string
  localIdentity?: LocalCandidateIdentitySummary
  fields: CandidateProfileLibraryField[]
  matchScore: number | null
  matchedTerms: string[]
  evidence: CandidateProfileLibraryField[]
  projectExperiences: CandidateProjectExperience[]
  projectEvidence: CandidateProjectMatchEvidence | null
  retrieval: {
    strategy: 'hard-filter-bm25-v1' | 'hard-filter-hybrid-rrf-v1' | 'hard-filter-hybrid-local-rerank-v1'
    hardFilterPolicyVersion: CandidateHardFilterPolicyVersion
    bm25Score: number | null
    vectorScore: number | null
    fusionScore: number | null
    rerankerScore: number | null
    bm25Rank: number | null
    vectorRank: number | null
    preRerankRank: number | null
    rerankerRank: number | null
    rank: number | null
    termCoverage: number | null
    indexedFieldCount: number
    hardFilters: Array<{
      type:
        | 'minimum-experience-years'
        | 'maximum-rate'
        | 'availability-by'
        | 'remote-work'
        | 'japanese-level'
        | 'location'
        | 'work-authorization'
      requested: string
      actual: string | null
      outcome: 'passed' | 'failed' | 'unknown'
    }>
  }
}

export interface CandidateProfileVersionDetail extends CandidateProfileSummary {
  reviewRevision: number
  fields: CandidateProfileLibraryField[]
  projectExperiences: CandidateProjectExperience[]
}

export interface CandidateMatchFeedbackSnapshot {
  decision: CandidateMatchFeedbackDecision
  reasonCode: CandidateMatchFeedbackReasonCode
  note: string | null
  reviewerDisplayName: string
  revision: number
  reviewedAt: string
}

export interface CandidateMatchEvaluationSummary {
  resultCount: number
  feedbackCount: number
  suitableCount: number
  unsuitableCount: number
  coveragePercent: number
  judgedNdcgAt20: number | null
  recallAt20: null
  recallStatus: 'requires-known-relevant-total'
}

export interface CandidateMatchRunSummary {
  id: string
  taskId: string
  query: string
  algorithmVersion: 'hard-filter-bm25-v1' | 'hard-filter-hybrid-rrf-v1' | 'hard-filter-hybrid-local-rerank-v1'
  hardFilterPolicyVersion: CandidateHardFilterPolicyVersion
  resultSetHash: string
  binding: {
    jobCaseId: string
    jobCaseVersion: number
    candidatePoolFingerprint: string
    candidateProfileVersions: Array<{ id: string; version: number }>
    embeddingModelId: string
    embeddingModelRevision: string
    rerankerModelId: string | null
    rerankerModelRevision: string | null
    policyVersion: 'match-run-validity-v1'
  } | null
  createdAt: string
  evaluation: CandidateMatchEvaluationSummary
}

export type MatchRunValidity =
  | 'current'
  | 'stale_job_case'
  | 'stale_candidate_pool'
  | 'stale_model'
  | 'stale_policy'
  | 'invalidated'

export type BusinessPriorityLevel = 'high' | 'normal' | 'follow_up' | 'paused'

export interface BusinessPriorityProjection {
  id: string
  matchResultId: string
  runId: string
  candidateProfileId: string
  ruleVersion: 'business-priority-v1'
  level: BusinessPriorityLevel
  effectiveLevel: BusinessPriorityLevel
  reasons: string[]
  inputs: {
    caseTiming: string | null
    candidateAvailability: string | null
    proposalStatus: ProposalDraftStatus | null
    followUpStage: ProposalFollowUpStage | null
  }
  inputSnapshotHash: string
  generatedAt: string
  manualOverride: {
    level: BusinessPriorityLevel
    actor: string
    reason: string
    expiresAt: string
    revision: number
  } | null
}

export interface MatchingHomeResult {
  matchResultId: string
  matchResultHash: string
  candidateProfileId: string
  candidateProfileVersion: number
  anonymousLabel: string
  fit: {
    rank: number
    matchScore: number | null
    matchedTerms: string[]
    termCoverage: number | null
    hardFilterUnknownCount: number
    missing?: string[]
    hardFilterStatus?: 'passed' | 'failed' | 'unknown'
    evidence: Array<{
      key: CandidateFieldKey
      label: string
      value: string | null
      sourceLabels: string[]
    }>
    projectEvidence: {
      title: string
      period: string | null
      role: string | null
      technologies: string[]
      summary: string
      sourceLabels: string[]
    } | null
  }
  feedback: CandidateMatchFeedbackSnapshot | null
  businessPriority: BusinessPriorityProjection
}

export interface MatchingHomeProjection {
  state: 'onboarding' | 'ready-to-run' | 'current-results'
  eligibleCandidateCount: number
  selectedJobCaseId: string | null
  jobCases: Array<{
    id: string
    version: number
    title: string
    validity: MatchRunValidity | 'not_run'
    lastRunCreatedAt: string | null
  }>
  currentRun: {
    run: CandidateMatchRunSummary
    validity: 'current'
    results: MatchingHomeResult[]
  } | null
}

export interface SetBusinessPriorityOverrideInput {
  matchResultId: string
  level: BusinessPriorityLevel
  reason: string
  expiresAt: string
}

export interface WechatVisibleMessageFeasibility {
  phase: 'B-03-1'
  gateStatus: 'not-run' | 'no-go' | 'go'
  platform: NodeJS.Platform
  featureFlagEnabled: boolean
  userFeatureAvailable: boolean
  accessibilityTrusted: boolean
  screenCaptureTrusted: boolean
  rawTextNetworkIsolationVerified: boolean
  evidenceVerified: boolean
  targetVersion: string | null
  failureCodes: string[]
}

export interface CandidateMatchResult extends CandidateProfileSearchResult {
  matchResultId: string
  matchResultHash: string
  feedback: CandidateMatchFeedbackSnapshot | null
}

export interface SearchCandidateProfilesInput {
  query: string
  maxResults?: number
}

export interface UpdateCandidateProfileInput {
  sourceDocumentId: string
  expectedVersion: number
  identity: {
    displayName: string | null
    gender: string | null
    birthDate: string | null
    nationality: string | null
    phone: string | null
    email: string | null
    address: string | null
    education: string | null
    major: string | null
    graduationDate: string | null
    degree: string | null
  }
  fields: Array<{
    key: CandidateFieldKey
    value: string | null
  }>
  projectExperiences: Array<{
    id: string
    title: string
    period: string | null
    role: string | null
    technologies: string[]
    summary: string
  }>
}

export interface UpdateCandidateProfileResult {
  candidate: CandidateProfileSearchResult
  history: CandidateProfileVersionDetail[]
}

export interface CandidateDeletionPreview {
  sourceDocumentId: string
  anonymousLabel: string
  localFileName: string
  counts: {
    profileVersions: number
    reviewAudits: number
    taskRecords: number
    matchRecords: number
    evaluationRecords: number
    proposalDrafts: number
    piiMappings: number
    searchIndexEntries: number
    encryptedFiles: number
    agentReferences: {
      conversations: number
      messages: number
    }
  }
  confirmationHash: string
  warningCodes: string[]
}

export type DeletionComponentStatus =
  | 'deleted'
  | 'not_present'
  | 'expired_pending'
  | 'crypto_erased'
  | 'failed'

export interface DeletionReportComponents {
  database: DeletionComponentStatus
  fileVault: DeletionComponentStatus
  searchIndex: DeletionComponentStatus
  cache: DeletionComponentStatus
  temporaryFiles: DeletionComponentStatus
  backups: DeletionComponentStatus
}

export interface CandidateDataDeletionReport {
  id: string
  entityType: 'candidate'
  entityIdHash: string
  requestedBy: string
  startedAt: string
  completedAt: string
  outcome: 'completed' | 'partial-failure'
  components: DeletionReportComponents
  deletedCounts: CandidateDeletionPreview['counts']
  warningCodes: string[]
}

export interface DeleteCandidateDataInput {
  sourceDocumentId: string
  confirmationHash: string
  confirmationText: '削除'
}

export interface DeleteCandidateDataResult {
  report: CandidateDataDeletionReport
  activeCandidateCount: number
}

export interface CandidateMatchTaskExecutionResult {
  task: WorkTask
  query: string
  run: CandidateMatchRunSummary
  matches: CandidateMatchResult[]
  processingJob: ProcessingJobSummary
  actionRunId?: string | null
}

export interface SubmitCandidateMatchFeedbackInput {
  matchResultId: string
  matchResultHash: string
  expectedRevision: number
  decision: CandidateMatchFeedbackDecision
  reasonCode: CandidateMatchFeedbackReasonCode
  note?: string
}

export interface SubmitCandidateMatchFeedbackResult {
  run: CandidateMatchRunSummary
  matchResultId: string
  feedback: CandidateMatchFeedbackSnapshot
}

export interface SesCandidateBenchmarkCase {
  id: string
  query: string
  relevantCandidateLabels: string[]
  expectedProjectEvidenceLabels: string[]
}

export interface SesCandidateBenchmark {
  version: 'ses-candidate-benchmark-v1'
  id: string
  name: string
  createdAt: string
  privacy: {
    directIdentifiersRemoved: true
    rawResumeIncluded: false
    rawMailIncluded: false
  }
  labeling: {
    method: 'ses-expert'
    reviewerCount: number
  }
  thresholds: {
    minimumCases: number
    recallAt20: number
    ndcgAt20: number
    projectEvidenceCoverageAt20: number
  }
  cases: SesCandidateBenchmarkCase[]
}

export type CandidateEvaluationQualityStatus =
  | 'passed'
  | 'failed'
  | 'insufficient-cases'
  | 'invalid-references'

export interface CandidateEvaluationCaseResult {
  caseId: string
  queryHash: string
  relevantCandidates: number
  retrievedRelevantCandidates: number
  recallAt20: number
  ndcgAt20: number
  expectedProjectEvidence: number
  matchedProjectEvidence: number
  missingCandidateLabels: string[]
}

export interface CandidateEvaluationReport {
  version: 'candidate-evaluation-report-v1'
  id: string
  datasetId: string
  datasetHash: string
  status: CandidateEvaluationQualityStatus
  algorithmVersion: 'hard-filter-hybrid-rrf-v1' | 'hard-filter-hybrid-local-rerank-v1'
  hardFilterPolicyVersion: CandidateHardFilterPolicyVersion
  modelId: string
  modelRevision: string
  evaluatedAt: string
  networkAccess: false
  cloudUsed: false
  metrics: {
    caseCount: number
    relevantCandidates: number
    retrievedRelevantCandidates: number
    recallAt20: number
    ndcgAt20: number
    expectedProjectEvidence: number
    matchedProjectEvidence: number
    projectEvidenceCoverageAt20: number | null
    missingCandidateReferences: number
  }
  thresholds: SesCandidateBenchmark['thresholds']
  cases: CandidateEvaluationCaseResult[]
}

export interface CandidateEvaluationDatasetSummary {
  id: string
  name: string
  datasetHash: string
  caseCount: number
  relevantCandidates: number
  reviewerCount: number
  importedAt: string
}

export interface CandidateEvaluationState {
  dataset: CandidateEvaluationDatasetSummary | null
  latestReport: CandidateEvaluationReport | null
}

export interface ImportCandidateEvaluationBenchmarkResult {
  cancelled: boolean
  state: CandidateEvaluationState
}

export interface CandidateEvaluationDraftRelevantCandidate {
  profileId: string
  profileVersion: number
  anonymousLabel: string
  expectedProjectEvidence: boolean
  status: 'active' | 'stale'
}

export interface CandidateEvaluationDraftCase {
  id: string
  jobCaseId: string
  jobCaseVersion: number
  jobCaseTitle: string
  query: string
  poolReviewed: true
  reviewerDisplayName: string
  reviewedAt: string
  status: 'ready' | 'job-case-stale' | 'candidate-stale' | 'no-relevant-candidates'
  relevantCandidates: CandidateEvaluationDraftRelevantCandidate[]
}

export interface CandidateEvaluationDraft {
  id: string
  name: string
  revision: number
  caseCount: number
  readyCaseCount: number
  reviewerCount: number
  createdAt: string
  updatedAt: string
  cases: CandidateEvaluationDraftCase[]
}

export interface CandidateEvaluationAuthoringJobCaseOption {
  id: string
  version: number
  title: string
  query: string
}

export interface CandidateEvaluationAuthoringCandidateOption extends Omit<ProposalCandidateOption, 'fields' | 'projectExperiences'> {
  projectExperienceCount: number
}

export interface CandidateEvaluationAuthoringWorkspace {
  draft: CandidateEvaluationDraft | null
  jobCases: CandidateEvaluationAuthoringJobCaseOption[]
  candidates: CandidateEvaluationAuthoringCandidateOption[]
}

export interface CreateCandidateEvaluationDraftInput {
  name: string
}

export interface SaveCandidateEvaluationDraftCaseInput {
  draftId: string
  expectedRevision: number
  jobCaseId: string
  relevantCandidateProfileIds: string[]
  expectedProjectEvidenceProfileIds: string[]
  poolReviewed: true
}

export interface DeleteCandidateEvaluationDraftCaseInput {
  draftId: string
  caseId: string
  expectedRevision: number
}

export interface EvaluateCandidateEvaluationDraftInput {
  draftId: string
  expectedRevision: number
}

export interface EvaluateCandidateEvaluationDraftResult {
  workspace: CandidateEvaluationAuthoringWorkspace
  state: CandidateEvaluationState
}

export interface CandidateReviewSnapshot {
  documentId: string
  fileName: string
  reviewRevision: number
  status: 'awaiting-review' | 'completed'
  piiReviewed: boolean
  localIdentity?: LocalCandidateIdentitySummary
  fields: CandidateReviewFieldSnapshot[]
  projectExperiences: CandidateProjectReviewSnapshot[]
  completedAt: string | null
  reviewerDisplayName: string | null
  profile: CandidateProfileSummary | null
  recruitingStatus: CandidateRecruitingStatus
  talentPoolStatus: TalentPoolMembershipStatus
  recordStatus: CandidateRecordStatus
}

/**
 * Import creates a candidate record and review confirmation creates a profile
 * version. Recruiting remains a separate workflow; only an explicit passed
 * recruiting decision grants an eligible talent-pool membership.
 */
export const candidateInterviewStages = [
  'new',
  'contacting',
  'scheduled',
  'prepared',
  'interviewing',
  'awaiting-decision',
  'on-hold',
  'passed',
  'closed'
] as const

export type CandidateInterviewStage = (typeof candidateInterviewStages)[number]

export const candidateInterviewDecisions = [
  'passed',
  'next-round',
  'on-hold',
  'failed',
  'no-show',
  'withdrawn'
] as const

export type CandidateInterviewDecision = (typeof candidateInterviewDecisions)[number]

export const candidateInterviewKinds = ['recruiting', 'client'] as const
export type CandidateInterviewKind = (typeof candidateInterviewKinds)[number]

export const candidateInterviewQuestionSources = ['standard', 'resume', 'inherited', 'custom'] as const
export type CandidateInterviewQuestionSource = (typeof candidateInterviewQuestionSources)[number]

export interface CandidateInterviewQuestion {
  id: string
  text: string
  source: CandidateInterviewQuestionSource
  sourceLabel: string | null
  selected: boolean
}

/**
 * Channel-specific scheduling details. These details never cross the Cloud AI
 * boundary; they are stored with the local interview session only.
 */
export interface CandidateInterviewMeetingDetails {
  phoneNumber?: string
  phoneNote?: string
  onsiteAddress?: string
  onsiteMeetingPoint?: string
  onsiteReceptionContact?: string
}

export interface CandidateInterviewSnapshot {
  id: string
  sourceDocumentId: string
  kind: CandidateInterviewKind
  roundNumber: number
  parentInterviewId: string | null
  stage: CandidateInterviewStage
  scheduledAt: string | null
  durationMinutes: 30 | 45 | 60 | 90
  meetingMethod: 'zoom' | 'google-meet' | 'phone' | 'onsite'
  meetingUrl: string | null
  meetingDetails?: CandidateInterviewMeetingDetails
  interviewer: string | null
  contactNote: string | null
  interviewGoal: string | null
  questionPlan: CandidateInterviewQuestion[]
  interviewNotes: string | null
  unresolvedItems: string[]
  decision: CandidateInterviewDecision | null
  decisionReason: string | null
  decidedAt: string | null
  decidedBy: string | null
  createdAt: string
  updatedAt: string
  updatedBy: string
  cloudEligible: false
}

export interface SaveCandidateInterviewScheduleInput {
  interviewId?: string
  sourceDocumentId: string
  kind?: CandidateInterviewKind
  roundNumber?: number
  parentInterviewId?: string
  scheduledAt: string
  durationMinutes: 30 | 45 | 60 | 90
  meetingMethod: 'zoom' | 'google-meet' | 'phone' | 'onsite'
  meetingUrl?: string
  meetingDetails?: CandidateInterviewMeetingDetails
  interviewer: string
  contactNote?: string
}

export interface OpenInterviewMeetingInput {
  method: Extract<CandidateInterviewSnapshot['meetingMethod'], 'zoom' | 'google-meet'>
  url: string
}

export interface CreateCandidateInterviewRoundInput {
  sourceDocumentId: string
  parentInterviewId: string
  kind?: CandidateInterviewKind
}

export interface SaveCandidateInterviewPreparationInput {
  interviewId: string
  interviewGoal?: string
  questions: CandidateInterviewQuestion[]
  unresolvedItems?: string[]
}

export interface SaveCandidateInterviewNotesInput {
  interviewId?: string
  sourceDocumentId: string
  interviewNotes: string
  unresolvedItems?: string[]
  stage?: Extract<CandidateInterviewStage, 'interviewing' | 'awaiting-decision'>
}

export interface RecordCandidateInterviewDecisionInput {
  interviewId?: string
  sourceDocumentId: string
  decision: CandidateInterviewDecision
  decisionReason: string
}

export interface SubmitCandidateReviewInput {
  documentId: string
  reviewRevision: number
  piiReviewed: boolean
  fields: Array<{
    key: CandidateFieldKey
    value: string | null
    confirmed: true
    changeReason?: string
  }>
  projectExperiences?: Array<{
    draftId: string
    title: string
    period: string | null
    role: string | null
    technologies: string[]
    summary: string
    confirmed: true
  }>
  projectChangeReason?: string
}

export interface SubmitCandidateReviewResult {
  review: CandidateReviewSnapshot
  updatedTasks: WorkTask[]
}

export interface JobCaseReviewFieldSnapshot {
  key: JobCaseFieldKey
  label: string
  originalValue: string | null
  value: string | null
  confidence: number
  status: 'needs_review' | 'missing' | 'confirmed'
  sourceLabels: string[]
  changed: boolean
  changeReason: string | null
}

export interface JobCaseSummary {
  id: string
  sourceReviewId: string
  version: number
  status: 'active' | 'superseded'
  confirmedAt: string
  confirmedBy: string
  containsDirectIdentifiers: false
}

export interface JobCaseReviewSnapshot {
  reviewId: string
  sourceId: string
  sourceType: JobCaseSourceType
  providerMessageId: string | null
  threadId: string
  fromDomain: string | null
  messageDate: string
  redactedSubject: string
  redactedPreview: string
  reviewRevision: number
  status: 'awaiting-review' | 'completed'
  privacyReviewed: boolean
  fields: JobCaseReviewFieldSnapshot[]
  warningCodes: string[]
  completedAt: string | null
  reviewerDisplayName: string | null
  jobCase: JobCaseSummary | null
  lifecycle: 'active' | 'archived'
  cloudEligible: false
}

export interface JobCaseVersionDetail {
  id: string
  sourceReviewId: string
  sourceId: string
  sourceType: JobCaseSourceType
  version: number
  reviewRevision: number
  status: 'active' | 'superseded' | 'archived'
  fields: Array<{
    key: JobCaseFieldKey
    label: string
    value: string | null
    sourceLabels: string[]
  }>
  confirmedAt: string
  confirmedBy: string
  containsDirectIdentifiers: false
}

export interface SetJobCaseLifecycleInput {
  reviewId: string
  state: 'active' | 'archived'
  reason: string
}

export interface SetJobCaseLifecycleResult {
  review: JobCaseReviewSnapshot
  history: JobCaseVersionDetail[]
}

export interface ReopenJobCaseReviewInput {
  reviewId: string
  reason: string
}

export interface ReopenJobCaseReviewResult {
  review: JobCaseReviewSnapshot
}

export interface JobCaseDeletionPreview {
  reviewId: string
  sourceId: string
  title: string
  sourceType: JobCaseSourceType
  counts: {
    caseVersions: number
    reviewAudits: number
    taskRecords: number
    proposalDrafts: number
    evaluationDraftCases: number
    piiMappings: number
    sourceRecords: number
    gmailMessages: number
    agentReferences: {
      conversations: number
      messages: number
    }
  }
  confirmationHash: string
  warningCodes: string[]
}

export interface JobCaseDataDeletionReport {
  id: string
  entityType: 'job_case'
  entityIdHash: string
  requestedBy: string
  startedAt: string
  completedAt: string
  outcome: 'completed' | 'partial-failure'
  components: DeletionReportComponents
  deletedCounts: JobCaseDeletionPreview['counts']
  warningCodes: string[]
}

export type DataDeletionReport = CandidateDataDeletionReport | JobCaseDataDeletionReport

export interface DeleteJobCaseDataInput {
  reviewId: string
  confirmationHash: string
  confirmationText: '削除'
}

export interface DeleteJobCaseDataResult {
  report: JobCaseDataDeletionReport
}

export interface SubmitJobCaseReviewInput {
  reviewId: string
  reviewRevision: number
  privacyReviewed: true
  fields: Array<{
    key: JobCaseFieldKey
    value: string | null
    confirmed: true
    changeReason?: string
  }>
}

export interface SubmitJobCaseReviewResult {
  review: JobCaseReviewSnapshot
}

export interface CreateManualJobCaseDraftInput {
  subject: string
  body: string
}

export interface CreateManualJobCaseDraftResult {
  review: JobCaseReviewSnapshot
}

export interface CreateChatPasteJobCaseDraftInput {
  text: string
}

export interface CreateChatPasteJobCaseDraftResult {
  review: JobCaseReviewSnapshot
}

export interface PrepareWechatVisibleReadResult {
  status: 'ready' | 'blocked' | 'cancelled'
  scopeToken: string | null
  expiresAt: string | null
  countdownSeconds: 5
  targetVersion: string | null
  failureCodes: string[]
}

export interface ExecuteWechatVisibleReadInput {
  scopeToken: string
}

export interface ExecuteWechatVisibleReadResult {
  review: JobCaseReviewSnapshot
  evidence: {
    captureMethod: 'accessibility-tree' | 'screen-capture-kit-vision-ocr'
    visibleTextNodeCount: number
    rawUtf8Bytes: number
    truncated: boolean
    rawTextPersisted: false
    rawImagePersisted: false
    networkAccess: false
  }
}

export type EmlImportErrorCode =
  | 'FILE_NOT_REGULAR'
  | 'FILE_TOO_LARGE'
  | 'INVALID_EXTENSION'
  | 'FILE_CHANGED'
  | 'PARSE_FAILED'
  | 'BODY_EMPTY'
  | 'LIMIT_EXCEEDED'
  | 'PERSISTENCE_FAILED'

export interface EmlImportItemResult {
  fileName: string
  status: 'imported' | 'duplicate' | 'skipped' | 'failed'
  classification: 'job-case' | 'candidate-proposal' | 'unclassified' | null
  errorCode: EmlImportErrorCode | null
  review: JobCaseReviewSnapshot | null
}

export interface ImportEmlJobCaseDraftsResult {
  cancelled: boolean
  importedCount: number
  duplicateCount: number
  skippedCount: number
  failedCount: number
  items: EmlImportItemResult[]
}

export type ProposalDraftStatus =
  | 'awaiting_review'
  | 'approved'
  | 'exported'
  | 'export_unknown'

export const proposalFollowUpStages = [
  'sent',
  'replied',
  'interview',
  'accepted',
  'declined',
  'withdrawn'
] as const

export type ProposalFollowUpStage = (typeof proposalFollowUpStages)[number]

export interface ProposalFollowUpEvent {
  id: string
  draftId: string
  revision: number
  stage: ProposalFollowUpStage
  occurredOn: string
  note: string | null
  recordedBy: string
  recordedAt: string
  cloudEligible: false
}

export interface ProposalFollowUpState {
  revision: number
  stage: ProposalFollowUpStage | null
  events: ProposalFollowUpEvent[]
  cloudEligible: false
}

export interface ProposalJobCaseOption {
  id: string
  reviewId: string
  version: number
  title: string
  role: string | null
  requiredSkills: string | null
  rate: string | null
  fields: Array<{
    key: JobCaseFieldKey
    label: string
    value: string | null
    sourceLabels: string[]
  }>
}

export interface ProposalCandidateOption {
  id: string
  version: number
  anonymousLabel: string
  skills: string | null
  experienceYears: string | null
  availability: string | null
  rate: string | null
  japaneseLevel: string | null
  workStyle: string | null
  role: string | null
  fields: CandidateProfileLibraryField[]
  projectExperiences: CandidateProjectExperience[]
}

export interface ProposalPreparationOptions {
  jobCases: ProposalJobCaseOption[]
  candidates: ProposalCandidateOption[]
}

export interface ProposalAttachmentPreview {
  fileName: string
  mimeType: 'application/pdf'
  redacted: true
  sourceDocumentIncluded: false
  anonymousCandidateLabel: string
  fields: Array<{
    key: CandidateFieldKey
    label: string
    value: string
    sourceLabels: string[]
  }>
  projectExperiences: Array<{
    title: string
    period: string | null
    role: string | null
    technologies: string[]
    summary: string
  }>
  contentHash: string
}

export interface ProposalDraftSnapshot {
  schemaVersion: 'proposal-draft-v1'
  id: string
  taskId: string
  jobCaseId: string
  jobCaseVersion: number
  candidateProfileId: string
  candidateProfileVersion: number
  recipientTo: string
  recipientCc: string[]
  candidateDisplayName: string
  subject: string
  body: string
  attachment: ProposalAttachmentPreview
  tone: 'standard' | 'concise' | 'formal'
  status: ProposalDraftStatus
  revision: number
  contentHash: string
  approvedContentHash: string | null
  approvedAt: string | null
  approvedBy: string | null
  exportedAt: string | null
  exportPackageHash: string | null
  followUp: ProposalFollowUpState
  generation: {
    mode: 'deterministic-local-v1'
    cloudUsed: false
    rawResumeUsed: false
    rawMailUsed: false
    recipientAndDisplayNameCloudEligible: false
  }
  createdAt: string
  updatedAt: string
}

export interface ProposalWorkspaceSnapshot {
  options: ProposalPreparationOptions
  drafts: ProposalDraftSnapshot[]
  evidence: Array<{
    draftId: string
    jobCase: ProposalJobCaseOption
    candidate: ProposalCandidateOption
  }>
}

export interface CreateProposalDraftInput {
  taskId: string
  jobCaseId: string
  candidateProfileId: string
  recipientTo: string
  recipientCc: string[]
  candidateDisplayName: string
  tone: 'standard' | 'concise' | 'formal'
}

export interface UpdateProposalDraftInput {
  draftId: string
  revision: number
  recipientTo: string
  recipientCc: string[]
  candidateDisplayName: string
  subject: string
  body: string
}

export interface ApproveProposalDraftInput {
  draftId: string
  revision: number
  contentHash: string
  approvals: {
    recipient: true
    body: true
    attachment: true
    privacy: true
  }
}

export interface ExportProposalPackageInput {
  draftId: string
  revision: number
  contentHash: string
}

export interface RecordProposalFollowUpInput {
  draftId: string
  expectedRevision: number
  stage: ProposalFollowUpStage
  occurredOn: string
  note?: string
  manuallyConfirmed: true
}

export interface ProposalMutationResult {
  draft: ProposalDraftSnapshot
  task: WorkTask
}

export interface ExportProposalPackageResult extends ProposalMutationResult {
  cancelled: boolean
  processingJob: ProcessingJobSummary | null
  export: {
    fileName: string
    packageHash: string
    exportedAt: string
    deliveryState: 'exported-not-sent'
  } | null
}

export interface GoogleWorkspaceState {
  provider: 'google-workspace'
  status: 'not-connected' | 'readonly' | 'readonly-and-compose'
  configuration: 'required' | 'ready' | 'connected'
  workspaceDomain: string | null
  accountEmail: string | null
  grantedScopes: string[]
  readAccess: boolean
  draftAccess: 'not-requested' | 'granted'
  sendMethod: 'not-implemented'
}

export type GoogleWorkspaceReadinessCheckId =
  | 'configuration'
  | 'desktop-client-format'
  | 'bounded-sync-scope'
  | 'loopback-callback'
  | 'google-oauth-reachability'
  | 'gmail-api-reachability'
  | 'credential-protection'
  | 'admin-console-confirmation'

export interface GoogleWorkspaceReadinessReport {
  version: 'google-workspace-readiness-v1'
  checkedAt: string
  overall: 'ready' | 'action-required'
  networkAccess: boolean
  mailboxAccessed: false
  credentialCreated: false
  checks: Array<{
    id: GoogleWorkspaceReadinessCheckId
    status: 'passed' | 'warning' | 'failed'
    label: string
    detail: string
  }>
}

export type GoogleWorkspaceOnlineAcceptanceCheckId =
  | 'live-profile'
  | 'readonly-scope'
  | 'company-domain'
  | 'credential-protection'
  | 'bounded-sync'
  | 'successful-sync'
  | 'local-redaction'
  | 'no-cloud-model'
  | 'no-send-path'

export interface GoogleWorkspaceOnlineAcceptanceReport {
  version: 'google-workspace-online-acceptance-v1'
  id: string
  checkedAt: string
  overall: 'passed' | 'action-required'
  configurationFingerprint: string
  credentialProtection: 'macos-keychain' | 'windows-dpapi'
  mailboxMetadataAccessed: true
  messageContentAccessedDuringCheck: false
  cloudModelUsed: false
  directIdentifierCloudSent: false
  checks: Array<{
    id: GoogleWorkspaceOnlineAcceptanceCheckId
    status: 'passed' | 'warning' | 'failed'
    label: string
    detail: string
  }>
  evidence: {
    grantedScopeCount: number
    sync: {
      status: 'never' | 'idle' | 'error'
      lastSyncedAt: string | null
      mode: 'baseline' | 'incremental' | 'bounded-rescan' | null
      discovered: number
      imported: number
      duplicates: number
      filtered: number
      failed: number
    }
    redaction: {
      storedMessages: number
      passed: number
      uncertain: number
      blocked: number
    }
  }
}

export interface GoogleWorkspaceAdminConfiguration {
  version: 'google-workspace-admin-config-v1'
  source: 'local-admin' | 'managed-environment'
  editable: boolean
  clientId: string
  workspaceDomain: string
  labelIds: string[]
  query: string
  lookbackDays: number
  maxMessagesPerRun: number
  revision: number | null
  configuredBy: string
  updatedAt: string
}

export interface LocalOperatorProfile {
  version: 'local-operator-profile-v1'
  operatorId: string
  displayName: string
  roleLabel: string
  configured: boolean
  revision: number | null
  updatedAt: string | null
  cloudEligible: false
}

export interface SaveLocalOperatorProfileInput {
  displayName: string
  roleLabel: string
  expectedRevision: number | null
}

export const applicationLocales = ['ja-JP', 'zh-CN'] as const

export type ApplicationLocale = (typeof applicationLocales)[number]

export interface LocalApplicationPreferences {
  version: 'local-application-preferences-v1'
  locale: ApplicationLocale
  configured: boolean
  revision: number | null
  updatedAt: string | null
  cloudEligible: false
}

export interface AiCommerceWalletSnapshot {
  balanceCredits: number
  reservedCredits: number
}

export interface AiCommerceCapabilitySnapshot {
  alias: string
  displayName: string
  modality: string | null
}

export interface AiCommerceMembershipState {
  configuration: 'required' | 'ready'
  connection: 'not-connected' | 'authorizing' | 'connected' | 'reauthentication-required'
  productCode: string | null
  billingMode: 'automatic' | 'standard' | 'subscription' | null
  memberDisplayName: string | null
  accountId: string | null
  accountAiTokenExpiresAt: string | null
  wallet: AiCommerceWalletSnapshot | null
  capabilities: AiCommerceCapabilitySnapshot[]
  refreshedAt: string | null
}

export interface PrepareAiCommerceCloudPromptInput {
  content: string
}

export interface PrepareAiCommerceCloudPromptResult {
  reviewTicket: string
  redactedPreview: string
  previewHash: string
  removedIdentifierTypes: string[]
  expiresAt: string
}

export interface ExecuteAiCommerceCloudPromptInput {
  reviewTicket: string
}

export interface AiCommerceCloudPromptResult {
  requestId: string
  aiRequestId: string
  content: string
  usageCredits: number | null
  wallet: AiCommerceWalletSnapshot | null
  removedIdentifierTypes: string[]
  billingModeUsed: 'standard' | 'subscription'
}

export type AiConversationAssistant = 'candidate-profile' | 'interview' | 'sales-agent'

export interface AiConversationContext {
  assistant: AiConversationAssistant
  candidateDocumentId: string | null
  interviewId: string | null
  interviewKind: 'recruiting' | 'client' | null
  roundNumber: number | null
}

export type AiConversationReferenceKind = 'job-case' | 'match-run' | 'match-result'

/**
 * References are intentionally small. Legacy profile/interview messages only
 * have label/target; sales-agent messages always populate the typed fields.
 */
export interface AiConversationReference {
  label: string
  target: string
  kind?: AiConversationReferenceKind
  objectId?: string
  objectVersion?: number | null
  resultHash?: string | null
  ordinal?: number | null
}

export interface TypedAiConversationReference extends AiConversationReference {
  kind: AiConversationReferenceKind
  objectId: string
  objectVersion: number | null
  resultHash: string | null
  ordinal: number | null
}

export type AgentEntityStatus = 'current' | 'stale' | 'deleted'

export interface AgentJobCaseCard {
  reference: TypedAiConversationReference
  title: string
  version: number
  updatedAt: string
  requiredSkills: string | null
  rate: string | null
  workStyle: string | null
  startDate: string | null
  status: AgentEntityStatus
}

export interface AgentCandidateMatchCard {
  reference: TypedAiConversationReference
  candidateProfileId: string
  runId: string
  rank: number
  anonymousLabel: string
  fitScore: number | null
  matched: string[]
  missing: string[]
  hardFilterStatus: 'passed' | 'failed' | 'unknown'
  projectEvidence: string | null
  status: AgentEntityStatus
}

export interface AgentMatchRunFacts {
  runId: string
  resultHash: string
  validity: AgentEntityStatus
  jobCaseVersion: number | null
  candidatePoolFingerprint: string | null
  algorithmVersion: string
  hardFilterPolicyVersion: string
  candidate: AgentCandidateMatchCard | null
  matched: string[]
  missing: string[]
  hardFilterStatus: 'passed' | 'failed' | 'unknown'
  projectEvidence: string | null
}

export interface AgentCandidateProfileFacts {
  runId: string
  validity: AgentEntityStatus
  candidate: {
    candidateProfileId: string
    rank: number
    anonymousLabel: string
  } | null
  profile: {
    profileVersion: number
    skills: string | null
    experienceYears: string | null
    availability: string | null
    rate: string | null
    japaneseLevel: string | null
    workStyle: string | null
    role: string | null
    location: string | null
    workAuthorization: string | null
    projectExperiences: Array<{
      title: string
      period: string | null
      role: string | null
      technologies: string[]
      summary: string
    }>
  } | null
}

export interface AgentCandidateInterviewFacts {
  runId: string
  validity: AgentEntityStatus
  candidate: {
    candidateProfileId: string
    rank: number
    anonymousLabel: string
  } | null
  interviews: Array<{
    kind: 'recruiting' | 'client'
    roundNumber: number
    stage: string
    scheduledAt: string | null
    durationMinutes: number
    meetingMethod: string
    interviewer: string | null
    interviewGoal: string | null
    interviewNotes: string | null
    unresolvedItems: string[]
    decision: string | null
    decisionReason: string | null
    updatedAt: string
  }>
}

export interface AgentTextBlock {
  type: 'text'
  text: string
}

export interface AgentJobCaseCardsBlock {
  type: 'job-case-cards'
  query: string
  dataAsOf: string
  normalizedFilters: {
    updatedAfter: string
    updatedBefore: string
    lifecycle: 'active'
    query: string | null
    limit: number
  }
  totalMatched: number
  cards: AgentJobCaseCard[]
}

export interface AgentCandidateMatchCardsBlock {
  type: 'candidate-match-cards'
  runId: string
  resultHash: string
  cards: AgentCandidateMatchCard[]
}

export interface AgentClarificationBlock {
  type: 'clarification'
  code: 'SELECT_JOB_CASE' | 'SELECT_RESULT' | 'STALE_REFERENCE' | 'NO_ACTIVE_JOB_CASE' | 'INTERVIEW_DETAILS_REQUIRED'
  prompt: string
  options: TypedAiConversationReference[]
}

export interface AgentMatchRunExplanationBlock {
  type: 'match-run-explanation'
  facts: AgentMatchRunFacts
}

export interface AgentCandidateProfileEvidenceBlock {
  type: 'candidate-profile-evidence'
  facts: AgentCandidateProfileFacts
}

export interface AgentCandidateInterviewEvidenceBlock {
  type: 'candidate-interview-evidence'
  facts: AgentCandidateInterviewFacts
}

export interface AgentErrorBlock {
  type: 'error'
  code: string
  message: string
  entityKind?: AiConversationReferenceKind
}

/**
 * A resume extraction draft, as the agent is allowed to see it. Everything here
 * is machine-extracted and unconfirmed: no value becomes a candidate profile
 * until the operator confirms each field, so `confirmed` is always false and
 * every field keeps the page/sheet/cell it came from.
 *
 * Direct identifiers and the original file name are deliberately absent - the
 * file name routinely contains the candidate's own name.
 */
export interface AgentCandidateDraftFacts {
  documentId: string
  label: string
  confirmed: false
  reviewStatus: 'awaiting-review' | 'completed'
  fields: Array<{
    label: string
    value: string | null
    confidence: number
    status: 'needs_review' | 'missing' | 'confirmed'
    sources: string[]
  }>
  projects: Array<{
    title: string
    period: string | null
    role: string | null
    technologies: string[]
    summary: string
    confidence: number
    sources: string[]
  }>
}

export interface AgentCandidateDraftBlock {
  type: 'candidate-draft-facts'
  facts: AgentCandidateDraftFacts
}

export interface AgentResumeImportBlock {
  type: 'resume-import'
  imported: Array<{ documentId: string; label: string; ordinal: number }>
  failedCount: number
}

export type AiConversationBlock =
  | AgentTextBlock
  | AgentJobCaseCardsBlock
  | AgentCandidateMatchCardsBlock
  | AgentCandidateProfileEvidenceBlock
  | AgentCandidateInterviewEvidenceBlock
  | AgentClarificationBlock
  | AgentMatchRunExplanationBlock
  | AgentCandidateDraftBlock
  | AgentResumeImportBlock
  | AgentErrorBlock

export interface AiConversationSalesAgentState {
  selectedJobCaseRef: TypedAiConversationReference | null
  lastMatchRunId: string | null
  lastSearchMessageId: string | null
}

export interface AiConversationMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  mode?: 'local' | 'cloud' | 'local-fallback'
  modelKey?: string
  modelDisplayName?: string
  narrativeStatus?: 'local' | 'streaming' | 'completed' | 'failed-local-fallback' | 'cancelled'
  turnId?: string | null
  blocks?: AiConversationBlock[]
  references?: AiConversationReference[]
  action?: 'questions' | 'notes' | 'decision'
  removedIdentifierCount?: number
  usageCredits?: number | null
  suggestCloudQuestion?: string
  createdAt: string
}

export interface AiConversationSnapshot {
  id: string
  context: AiConversationContext
  title: string
  messages: AiConversationMessage[]
  salesAgentState?: AiConversationSalesAgentState
  revision: number
  createdAt: string
  updatedAt: string
}

export interface ExecuteAgentTurnInput {
  conversationId: string
  message: string
  expectedConversationRevision: number | null
  requestId: string
  modelKey?: string
  selectedJobCaseRef?: TypedAiConversationReference | null
  /** Vault tokens for files attached to this turn, in the order they were added. */
  attachmentFileTokens?: string[]
}

export interface AgentChatModelOption {
  key: string
  displayName: string
}

export type AgentTurnEvent =
  | {
      type: 'started'
      conversationId: string
      requestId: string
      sequence: number
      modelKey: string
      modelDisplayName: string
      phase: 'planning' | 'local-tool' | 'connecting-model' | 'streaming' | 'stopping'
    }
  | {
      type: 'delta'
      conversationId: string
      requestId: string
      sequence: number
      modelKey: string
      modelDisplayName: string
      text: string
    }
  | {
      type: 'completed'
      conversationId: string
      requestId: string
      sequence: number
      modelKey: string
      modelDisplayName: string
    }
  | {
      type: 'failed'
      conversationId: string
      requestId: string
      sequence: number
      modelKey: string
      modelDisplayName: string
      code: string
      message: string
      localFallbackPreserved: true
    }
  | {
      type: 'cancelled'
      conversationId: string
      requestId: string
      sequence: number
      modelKey: string
      modelDisplayName: string
      cancelStatus: 'cancel_requested' | 'canceled' | 'too_late' | null
      message: string
    }

export type AgentTurnStatus = 'clarifying' | 'completed' | 'failed' | 'cancelled'

export interface ExecuteAgentTurnResult {
  status: AgentTurnStatus
  conversation: AiConversationSnapshot
  assistantMessage: AiConversationMessage
  toolName: DomainToolName | null
  actionRunId: string | null
  requestId: string
}

export interface CancelAgentTurnInput {
  conversationId: string
  requestId: string
}

export interface CancelAgentTurnResult {
  status: 'cancelled' | 'not-running' | 'already-completed'
  conversationId: string
  requestId: string
  remoteCancelStatus?: 'cancel_requested' | 'canceled' | 'too_late' | null
  message?: string
}

export interface SaveAiConversationInput {
  conversationId: string
  context: AiConversationContext
  messages: AiConversationMessage[]
  salesAgentState?: AiConversationSalesAgentState
  expectedRevision: number | null
}

export interface DeleteAiConversationsInput {
  conversationIds: string[]
}

export interface DeleteAiConversationsResult {
  deletedConversationIds: string[]
}

export interface AiCommerceStateUpdate {
  state: AiCommerceMembershipState
  error: string | null
}

export interface SaveLocalApplicationPreferencesInput {
  locale: ApplicationLocale
  expectedRevision: number | null
}

export interface SaveGoogleWorkspaceAdminConfigurationInput {
  clientId: string
  workspaceDomain: string
  labelIds: string[]
  query: string
  lookbackDays: number
  maxMessagesPerRun: number
  expectedRevision: number | null
  readonlyAcknowledged: true
}

export interface SaveGoogleWorkspaceAdminConfigurationResult {
  configuration: GoogleWorkspaceAdminConfiguration
  restarting: true
}

export interface GmailSyncState {
  configuration: 'required' | 'ready'
  status: 'never' | 'idle' | 'error'
  labelIds: string[]
  query: string | null
  lookbackDays: number
  checkpointHistoryId: string | null
  storedMessages: number
  lastSyncedAt: string | null
  lastRun: {
    mode: 'baseline' | 'incremental' | 'bounded-rescan'
    discovered: number
    imported: number
    duplicates: number
    filtered: number
    failed: number
  } | null
  lastError: string | null
}

export interface RecoveryPackageSummary {
  version: 'ses-recovery-v1'
  backupId: string
  createdAt: string
  sourcePlatform: 'darwin' | 'win32'
  sourceArch: string
  schemaVersion: number
  databaseBytes: number
  vaultObjectCount: number
  vaultBytes: number
  totalBytes: number
  googleWorkspaceCredentialIncluded: false
  cloudDataIncluded: false
}

export interface RecoveryState {
  format: 'ses-recovery-v1'
  encryption: 'scrypt-aes-256-gcm'
  lastBackupAt: string | null
  lastRestoreAt: string | null
  pendingRestore: boolean
  reminder: {
    status: 'not-needed' | 'due' | 'snoozed'
    reason: 'no-backup' | 'data-changed' | null
    currentDataRevision: number
    lastBackupDataRevision: number | null
    latestDataChangedAt: string | null
    snoozedUntil: string | null
  }
}

export type StartupStatus =
  | { mode: 'normal' }
  | {
      mode: 'recovery-required'
      reason: 'local-storage-unavailable'
      activeDataPreserved: true
      networkAccess: false
      message: string
    }

export interface CreateRecoveryPackageInput {
  password: string
  passwordConfirmation: string
}

export interface CreateRecoveryPackageResult {
  cancelled: boolean
  fileName: string | null
  packageHash: string | null
  summary: RecoveryPackageSummary | null
}

export interface SnoozeRecoveryReminderInput {
  days: 1 | 7
}

export interface PreviewRecoveryPackageInput {
  password: string
}

export interface RecoveryPreviewResult {
  cancelled: boolean
  restoreToken: string | null
  confirmationHash: string | null
  expiresAt: string | null
  summary: RecoveryPackageSummary | null
  warnings: string[]
}

export interface ConfirmRecoveryInput {
  restoreToken: string
  confirmationHash: string
  confirmationText: '復元'
}

export interface ConfirmRecoveryResult {
  scheduled: true
  restartRequired: true
}

export interface BootstrapPayload {
  appVersion: string
  environmentLabel: string
  operatorProfile: LocalOperatorProfile
  preferences: LocalApplicationPreferences
  featureFlags?: {
    conversationalMatchingEnabled: boolean
  }
  agentChatModels?: AgentChatModelOption[]
  defaultAgentChatModelKey?: string
  tasks: WorkTask[]
  processingJobs: ProcessingJobSummary[]
  actionApprovals: ActionApprovalSummary[]
  resumeAnalyses: ResumeAnalysisSummary[]
  candidateReviews: CandidateReviewSnapshot[]
  candidateInterviews: CandidateInterviewSnapshot[]
  jobCaseReviews: JobCaseReviewSnapshot[]
  matchingHome: MatchingHomeProjection
  wechatVisibleMessage: WechatVisibleMessageFeasibility
  privacy: {
    policyVersion: string
    cloudGateway: 'enforced'
    localAi: 'vision-ocr-and-pii-active' | 'windows-ocr-and-pii-rules-active' | 'windows-ocr-bundled-isolation-pending' | 'pii-rules-active-ocr-unavailable'
    qualityGate: {
      status: 'passed' | 'not-verified'
      datasetVersion: 'ses-privacy-regression-v1' | null
      syntheticOnly: true
      caseCount: number
      identifierRecall: number | null
      redactionPrecision: number | null
      residualLeakCount: number | null
      safeCaseFalsePositiveCount: number | null
      appleNerVerified: boolean | null
      reportHash: string | null
      failureCodes: string[]
    }
    expertGate: {
      status: 'passed' | 'not-verified'
      datasetVersion: 'ses-privacy-expert-dataset-v1' | null
      humanLabeledDataset: true
      sourceDocumentCount: number
      caseCount: number
      automaticPersonNameRecall: number | null
      postReviewIdentifierRecall: number | null
      redactionPrecision: number | null
      reviewedAt: string | null
      evaluatedAt: string | null
      reportHash: string | null
      attestationHash: string | null
      privacyImplementationSha256: string | null
      cloudEnforcementSha256: string | null
      failureCodes: string[]
    }
  }
  storage: {
    status: 'encrypted'
    engine: 'sqlcipher-compatible'
    keyProtection: 'macos-keychain' | 'windows-dpapi'
    schemaVersion: number
  }
  gmail: GoogleWorkspaceState
  googleWorkspaceConfiguration: GoogleWorkspaceAdminConfiguration | null
  googleWorkspaceAcceptance: GoogleWorkspaceOnlineAcceptanceReport | null
  gmailSync: GmailSyncState
  aiCommerce: AiCommerceMembershipState
  recovery: RecoveryState
  candidateEvaluation: CandidateEvaluationState
}

/** Result of the one-step resume import entry point. */
export type BeginResumeImportResult =
  | { cancelled: true; task: null; files: [] }
  | { cancelled: false; task: WorkTask; files: StagedLocalFile[] }

export interface DesktopApi {
  getStartupStatus(): Promise<StartupStatus>
  getBootstrap(): Promise<BootstrapPayload>
  resolveActionApproval(input: ResolveActionApprovalInput): Promise<ActionApprovalSummary>
  saveLocalOperatorProfile(input: SaveLocalOperatorProfileInput): Promise<LocalOperatorProfile>
  saveLocalApplicationPreferences(input: SaveLocalApplicationPreferencesInput): Promise<LocalApplicationPreferences>
  connectAiCommerce(): Promise<AiCommerceMembershipState>
  getAiCommerceDashboard(): Promise<AiCommerceMembershipState>
  disconnectAiCommerce(): Promise<AiCommerceMembershipState>
  resetAiCommerceToken(): Promise<AiCommerceMembershipState>
  openAiCommerceMemberCenter(): Promise<{ opened: true }>
  prepareAiCommerceCloudPrompt(input: PrepareAiCommerceCloudPromptInput): Promise<PrepareAiCommerceCloudPromptResult>
  executeAiCommerceCloudPrompt(input: ExecuteAiCommerceCloudPromptInput): Promise<AiCommerceCloudPromptResult>
  listAiConversations(context: AiConversationContext): Promise<AiConversationSnapshot[]>
  saveAiConversation(input: SaveAiConversationInput): Promise<AiConversationSnapshot>
  deleteAiConversations(input: DeleteAiConversationsInput): Promise<DeleteAiConversationsResult>
  executeAgentTurn(input: ExecuteAgentTurnInput): Promise<ExecuteAgentTurnResult>
  cancelAgentTurn(input: CancelAgentTurnInput): Promise<CancelAgentTurnResult>
  onAgentTurnEvent(listener: (event: AgentTurnEvent) => void): () => void
  onAiCommerceStateChanged(listener: (update: AiCommerceStateUpdate) => void): () => void
  beginResumeImport(): Promise<BeginResumeImportResult>
  stageDroppedResumeFiles(input: { files: Array<{ name: string; bytes: Uint8Array }> }): Promise<BeginResumeImportResult>
  previewStagedResumeFile(input: { fileToken: string }): Promise<AgentCandidateDraftFacts>
  analyzeResumeFile(input: { fileToken: string; taskId: string }): Promise<ResumeAnalysisTaskExecutionResult>
  getCandidateReview(documentId: string): Promise<CandidateReviewSnapshot | null>
  submitCandidateReview(input: SubmitCandidateReviewInput): Promise<SubmitCandidateReviewResult>
  createCandidateInterviewRound(input: CreateCandidateInterviewRoundInput): Promise<CandidateInterviewSnapshot>
  saveCandidateInterviewSchedule(input: SaveCandidateInterviewScheduleInput): Promise<CandidateInterviewSnapshot>
  saveCandidateInterviewPreparation(input: SaveCandidateInterviewPreparationInput): Promise<CandidateInterviewSnapshot>
  saveCandidateInterviewNotes(input: SaveCandidateInterviewNotesInput): Promise<CandidateInterviewSnapshot>
  recordCandidateInterviewDecision(input: RecordCandidateInterviewDecisionInput): Promise<CandidateInterviewSnapshot>
  openZoomMeeting(input: { url: string }): Promise<{ opened: true }>
  openInterviewMeeting(input: OpenInterviewMeetingInput): Promise<{ opened: true }>
  openZoomTestMeeting(): Promise<{ opened: true }>
  createManualJobCaseDraft(input: CreateManualJobCaseDraftInput): Promise<CreateManualJobCaseDraftResult>
  createChatPasteJobCaseDraft(input: CreateChatPasteJobCaseDraftInput): Promise<CreateChatPasteJobCaseDraftResult>
  prepareWechatVisibleRead(): Promise<PrepareWechatVisibleReadResult>
  executeWechatVisibleRead(input: ExecuteWechatVisibleReadInput): Promise<ExecuteWechatVisibleReadResult>
  importEmlJobCaseDrafts(): Promise<ImportEmlJobCaseDraftsResult>
  submitJobCaseReview(input: SubmitJobCaseReviewInput): Promise<SubmitJobCaseReviewResult>
  getJobCaseHistory(reviewId: string): Promise<JobCaseVersionDetail[]>
  setJobCaseLifecycle(input: SetJobCaseLifecycleInput): Promise<SetJobCaseLifecycleResult>
  reopenJobCaseReview(input: ReopenJobCaseReviewInput): Promise<ReopenJobCaseReviewResult>
  previewJobCaseDeletion(reviewId: string): Promise<JobCaseDeletionPreview>
  deleteJobCaseData(input: DeleteJobCaseDataInput): Promise<DeleteJobCaseDataResult>
  getProposalWorkspace(taskId: string): Promise<ProposalWorkspaceSnapshot>
  createProposalDraft(input: CreateProposalDraftInput): Promise<ProposalMutationResult>
  updateProposalDraft(input: UpdateProposalDraftInput): Promise<ProposalMutationResult>
  approveProposalDraft(input: ApproveProposalDraftInput): Promise<ProposalMutationResult>
  exportProposalPackage(input: ExportProposalPackageInput): Promise<ExportProposalPackageResult>
  recordProposalFollowUp(input: RecordProposalFollowUpInput): Promise<ProposalMutationResult>
  searchCandidateProfiles(input: SearchCandidateProfilesInput): Promise<CandidateProfileSearchResult[]>
  executeCandidateMatchTask(taskId: string): Promise<CandidateMatchTaskExecutionResult>
  submitCandidateMatchFeedback(input: SubmitCandidateMatchFeedbackInput): Promise<SubmitCandidateMatchFeedbackResult>
  setBusinessPriorityOverride(input: SetBusinessPriorityOverrideInput): Promise<MatchingHomeProjection>
  importCandidateEvaluationBenchmark(): Promise<ImportCandidateEvaluationBenchmarkResult>
  getCandidateEvaluationAuthoringWorkspace(): Promise<CandidateEvaluationAuthoringWorkspace>
  createCandidateEvaluationDraft(input: CreateCandidateEvaluationDraftInput): Promise<CandidateEvaluationAuthoringWorkspace>
  saveCandidateEvaluationDraftCase(input: SaveCandidateEvaluationDraftCaseInput): Promise<CandidateEvaluationAuthoringWorkspace>
  deleteCandidateEvaluationDraftCase(input: DeleteCandidateEvaluationDraftCaseInput): Promise<CandidateEvaluationAuthoringWorkspace>
  evaluateCandidateEvaluationDraft(input: EvaluateCandidateEvaluationDraftInput): Promise<EvaluateCandidateEvaluationDraftResult>
  getCandidateProfileHistory(sourceDocumentId: string): Promise<CandidateProfileVersionDetail[]>
  getOriginalDocumentPreview(sourceDocumentId: string): Promise<OriginalDocumentPreview>
  openOriginalDocument(sourceDocumentId: string): Promise<OpenOriginalDocumentResult>
  updateCandidateProfile(input: UpdateCandidateProfileInput): Promise<UpdateCandidateProfileResult>
  previewCandidateDeletion(sourceDocumentId: string): Promise<CandidateDeletionPreview>
  deleteCandidateData(input: DeleteCandidateDataInput): Promise<DeleteCandidateDataResult>
  listDataDeletionReports(): Promise<DataDeletionReport[]>
  connectGoogleWorkspace(): Promise<GoogleWorkspaceState>
  diagnoseGoogleWorkspace(): Promise<GoogleWorkspaceReadinessReport>
  runGoogleWorkspaceOnlineAcceptance(): Promise<GoogleWorkspaceOnlineAcceptanceReport>
  saveGoogleWorkspaceAdminConfiguration(input: SaveGoogleWorkspaceAdminConfigurationInput): Promise<SaveGoogleWorkspaceAdminConfigurationResult>
  disconnectGoogleWorkspace(): Promise<GoogleWorkspaceState>
  syncGoogleWorkspace(): Promise<GmailSyncState>
  getRecoveryState(): Promise<RecoveryState>
  createRecoveryPackage(input: CreateRecoveryPackageInput): Promise<CreateRecoveryPackageResult>
  snoozeRecoveryReminder(input: SnoozeRecoveryReminderInput): Promise<RecoveryState>
  previewRecoveryPackage(input: PreviewRecoveryPackageInput): Promise<RecoveryPreviewResult>
  confirmRecovery(input: ConfirmRecoveryInput): Promise<ConfirmRecoveryResult>
  restartApplication(): Promise<{ restarting: true }>
  previewWorkTask(input: WorkTaskInput): Promise<SignedWorkTaskPreview>
  createWorkTask(input: CreateWorkTaskInput): Promise<WorkTask>
  setWorkTaskLifecycle(input: SetWorkTaskLifecycleInput): Promise<WorkTask>
}

export const ipcChannels = {
  getStartupStatus: 'startup:get-status',
  getBootstrap: 'bootstrap:get',
  resolveActionApproval: 'action-approval:resolve',
  saveLocalOperatorProfile: 'operator-profile:save',
  saveLocalApplicationPreferences: 'application-preferences:save',
  connectAiCommerce: 'aicommerce:connect',
  getAiCommerceDashboard: 'aicommerce:get-dashboard',
  disconnectAiCommerce: 'aicommerce:disconnect',
  resetAiCommerceToken: 'aicommerce:reset-token',
  openAiCommerceMemberCenter: 'aicommerce:open-member-center',
  prepareAiCommerceCloudPrompt: 'aicommerce:prepare-cloud-prompt',
  executeAiCommerceCloudPrompt: 'aicommerce:execute-cloud-prompt',
  listAiConversations: 'ai-conversations:list',
  saveAiConversation: 'ai-conversations:save',
  deleteAiConversations: 'ai-conversations:delete',
  executeAgentTurn: 'agent:execute-turn',
  cancelAgentTurn: 'agent:cancel-turn',
  agentTurnEvent: 'agent:turn-event',
  aiCommerceStateChanged: 'aicommerce:state-changed',
  beginResumeImport: 'resume-import:begin',
  stageDroppedResumeFiles: 'resume-import:stage-dropped',
  previewStagedResumeFile: 'resume-import:preview',
  analyzeResumeFile: 'resume-files:analyze',
  getCandidateReview: 'candidate-review:get',
  submitCandidateReview: 'candidate-review:submit',
  createCandidateInterviewRound: 'candidate-interview:create-round',
  saveCandidateInterviewSchedule: 'candidate-interview:save-schedule',
  saveCandidateInterviewPreparation: 'candidate-interview:save-preparation',
  saveCandidateInterviewNotes: 'candidate-interview:save-notes',
  recordCandidateInterviewDecision: 'candidate-interview:record-decision',
  openZoomMeeting: 'zoom:open-meeting',
  openInterviewMeeting: 'candidate-interview:open-meeting',
  openZoomTestMeeting: 'zoom:open-test-meeting',
  createManualJobCaseDraft: 'job-case-draft:create-manual',
  createChatPasteJobCaseDraft: 'job-case-draft:create-chat-paste',
  prepareWechatVisibleRead: 'wechat-visible-read:prepare',
  executeWechatVisibleRead: 'wechat-visible-read:execute',
  importEmlJobCaseDrafts: 'job-case-draft:import-eml',
  submitJobCaseReview: 'job-case-review:submit',
  getJobCaseHistory: 'job-case:history',
  setJobCaseLifecycle: 'job-case:lifecycle',
  reopenJobCaseReview: 'job-case:reopen-review',
  previewJobCaseDeletion: 'job-case:delete-preview',
  deleteJobCaseData: 'job-case:delete',
  getProposalWorkspace: 'proposal:workspace',
  createProposalDraft: 'proposal:create',
  updateProposalDraft: 'proposal:update',
  approveProposalDraft: 'proposal:approve',
  exportProposalPackage: 'proposal:export-package',
  recordProposalFollowUp: 'proposal:record-follow-up',
  searchCandidateProfiles: 'candidate-profile:search',
  executeCandidateMatchTask: 'candidate-match:execute',
  submitCandidateMatchFeedback: 'candidate-match:feedback',
  setBusinessPriorityOverride: 'candidate-match:set-business-priority-override',
  importCandidateEvaluationBenchmark: 'candidate-evaluation:import-benchmark',
  getCandidateEvaluationAuthoringWorkspace: 'candidate-evaluation:authoring-workspace',
  createCandidateEvaluationDraft: 'candidate-evaluation:create-draft',
  saveCandidateEvaluationDraftCase: 'candidate-evaluation:save-draft-case',
  deleteCandidateEvaluationDraftCase: 'candidate-evaluation:delete-draft-case',
  evaluateCandidateEvaluationDraft: 'candidate-evaluation:evaluate-draft',
  getCandidateProfileHistory: 'candidate-profile:history',
  getOriginalDocumentPreview: 'candidate-profile:original-preview',
  openOriginalDocument: 'candidate-profile:open-original',
  updateCandidateProfile: 'candidate-profile:update',
  previewCandidateDeletion: 'candidate-profile:delete-preview',
  deleteCandidateData: 'candidate-profile:delete',
  listDataDeletionReports: 'data-deletion-report:list',
  connectGoogleWorkspace: 'google-workspace:connect',
  diagnoseGoogleWorkspace: 'google-workspace:diagnose',
  runGoogleWorkspaceOnlineAcceptance: 'google-workspace:online-acceptance',
  saveGoogleWorkspaceAdminConfiguration: 'google-workspace:save-admin-configuration',
  disconnectGoogleWorkspace: 'google-workspace:disconnect',
  syncGoogleWorkspace: 'google-workspace:sync',
  getRecoveryState: 'recovery:get-state',
  createRecoveryPackage: 'recovery:create-package',
  snoozeRecoveryReminder: 'recovery:snooze-reminder',
  previewRecoveryPackage: 'recovery:preview-package',
  confirmRecovery: 'recovery:confirm',
  restartApplication: 'startup:restart',
  previewWorkTask: 'work-task:preview',
  createWorkTask: 'work-task:create',
  setWorkTaskLifecycle: 'work-task:lifecycle'
} as const
