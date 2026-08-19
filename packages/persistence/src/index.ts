import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { z } from 'zod'
import { enqueueProcessingJobInputSchema } from '@shared'
import { type MatchRuntimeIdentity } from '@matching'
import type { WorkTask } from '@domain'
import type { StagedFileRecord } from '@files'
import {
  type ConfirmedJobCase,
  type JobCaseExtractionDraft,
  type JobCaseExtractionDraftV2,
  type JobCaseSource
} from '@job-cases'
import { type DocumentIR } from '@parsers'
import { type CandidateExtractionDraft, type CandidateProfile } from '@resume'
import type {
  AgentCandidateDraftFacts,
  CandidateEvaluationReport,
  CandidateEvaluationState,
  CandidateEvaluationDraft,
  CreateCandidateEvaluationDraftInput,
  SaveCandidateEvaluationDraftCaseInput,
  DeleteCandidateEvaluationDraftCaseInput,
  CandidateMatchResult,
  CandidateMatchRunSummary,
  BusinessPriorityProjection,
  MatchingHomeProjection,
  SetBusinessPriorityOverrideInput,
  CandidateProfileSearchResult,
  SesCandidateBenchmark,
  CandidateReviewSnapshot,
  CandidateInterviewSnapshot,
  CreateCandidateInterviewRoundInput,
  SaveCandidateInterviewScheduleInput,
  SaveCandidateInterviewPreparationInput,
  SaveCandidateInterviewNotesInput,
  RecordCandidateInterviewDecisionInput,
  LocalCandidateIdentitySummary,
  CandidateProfileVersionDetail,
  CandidateDeletionPreview,
  DataDeletionReport,
  DeleteJobCaseDataInput,
  JobCaseDeletionPreview,
  JobCaseVersionDetail,
  JobCaseReviewSnapshot,
  ApproveProposalDraftInput,
  CreateProposalDraftInput,
  ProposalDraftSnapshot,
  ProposalPreparationOptions,
  ProposalWorkspaceSnapshot,
  ReopenJobCaseReviewInput,
  SetJobCaseLifecycleInput,
  ResumeAnalysisSummary,
  RecoveryPackageSummary,
  RecoveryState,
  StagedLocalFile,
  SubmitCandidateReviewInput,
  UpdateCandidateProfileInput,
  SubmitCandidateMatchFeedbackInput,
  SubmitCandidateMatchFeedbackResult,
  SubmitJobCaseReviewInput,
  UpdateProposalDraftInput,
  GoogleWorkspaceAdminConfiguration,
  GoogleWorkspaceOnlineAcceptanceReport,
  LocalApplicationPreferences,
  LocalOperatorProfile,
  SaveGoogleWorkspaceAdminConfigurationInput,
  SaveLocalApplicationPreferencesInput,
  SaveLocalOperatorProfileInput,
  ProcessingJobSummary,
  RecordProposalFollowUpInput,
  ActionApprovalSummary,
  ActionRunStatus,
  AgentCandidateInterviewFacts,
  AgentCandidateProfileFacts,
  AgentMatchRunFacts,
  AiConversationContext,
  AiConversationSnapshot,
  SaveAiConversationInput,
  DomainToolName,
  ResolveActionApprovalInput
} from '@shared/contracts'
import {
  type CloudCallAuditRecord,
  type LocalPiiMapping,
  type RedactionEvidenceStore,
  type RedactionSessionEvidence
} from '@privacy'

import type {
  CandidateProfileEmbeddingInput,
  CandidateProfileEmbeddingRecord,
  CandidateProjectEmbeddingInput,
  CandidateProjectEmbeddingRecord,
  GmailRedactionEvidenceSummary,
  GmailSyncCheckpointRecord,
  ProcessingJobCompletion,
  ProcessingJobLease,
  StoredGmailMessageInput
} from './rows'
import { applyMigrations } from './schema/apply'
import { createStoreRegistry } from './stores'
import type { StoreRegistry } from './stores/registry'

export { currentSchemaVersion } from './schema/migrations'
export type {
  CandidateProfileEmbeddingInput,
  CandidateProfileEmbeddingRecord,
  CandidateProjectEmbeddingInput,
  CandidateProjectEmbeddingRecord,
  GmailRedactionEvidenceSummary,
  GmailSyncCheckpointRecord,
  ProcessingJobCompletion,
  ProcessingJobLease,
  StoredGmailMessageInput
} from './rows'


export interface EncryptedDatabaseOptions {
  path: string
  databaseKey: Buffer
  mappingKey: Buffer
}

export class EncryptedApplicationRepository implements RedactionEvidenceStore {
  private readonly database: Database.Database
  private readonly stores: StoreRegistry

  constructor(options: EncryptedDatabaseOptions) {
    if (options.databaseKey.length !== 32 || options.mappingKey.length !== 32) {
      throw new Error('Database and mapping keys must contain exactly 32 bytes.')
    }
    mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 })
    this.database = new Database(options.path)
    try {
      chmodSync(options.path, 0o600)
      this.database.pragma("cipher='sqlcipher'")
      this.database.pragma('legacy=4')
      this.database.key(options.databaseKey)
      this.database.prepare('SELECT count(*) AS count FROM sqlite_master').get()
      this.database.pragma('foreign_keys=ON')
      this.database.pragma('secure_delete=ON')
      this.database.pragma('busy_timeout=5000')
      this.database.pragma('journal_mode=WAL')
      applyMigrations(this.database)
      this.stores = createStoreRegistry({
        database: this.database,
        databaseKey: options.databaseKey,
        mappingKey: options.mappingKey
      })
      this.stores.proposals.recoverInterruptedProposalExports()
    } catch (error) {
      this.database.close()
      throw new Error('Unable to open the encrypted local database.', { cause: error })
    }
  }

  listWorkTasks(): WorkTask[] {
    return this.stores.workTasks.listWorkTasks()
  }

  getWorkTask(taskId: string): WorkTask | null {
    return this.stores.workTasks.getWorkTask(taskId)
  }

  countWorkTasks(): number {
    return this.stores.workTasks.countWorkTasks()
  }

  createActionRun(input: {
    toolName: DomainToolName
    workTaskId: string | null
    origin: 'work-task' | 'user-command' | 'managed-connector' | 'system'
    scopeId: string
    scopeFingerprint: string
    inputHash: string
    contentRevision: string | null
    status: ActionRunStatus
    idempotencyKey: string
    conversationId?: string | null
    turnId?: string | null
  }): { id: string; status: ActionRunStatus } {
    return this.stores.actionRuntime.createActionRun(input)
  }

  linkActionRunToConversation(actionRunId: string, conversationId: string, turnId: string): void {
    return this.stores.actionRuntime.linkActionRunToConversation(actionRunId, conversationId, turnId)
  }

  updateActionRun(id: string, status: ActionRunStatus, options: { processingJobId?: string | null; resultHash?: string | null; errorCode?: string | null } = {}): void {
    return this.stores.actionRuntime.updateActionRun(id, status, options)
  }

  getActionRunStatus(id: string): ActionRunStatus | null {
    return this.stores.actionRuntime.getActionRunStatus(id)
  }

  requestActionApproval(input: { actionRunId: string; reason: string; safeSummary: string; expiresAt: string }): ActionApprovalSummary {
    return this.stores.actionRuntime.requestActionApproval(input)
  }

  getActionApproval(id: string): ActionApprovalSummary | null {
    return this.stores.actionRuntime.getActionApproval(id)
  }

  listActionApprovals(now = new Date()): ActionApprovalSummary[] {
    return this.stores.actionRuntime.listActionApprovals(now)
  }

  resolveActionApproval(input: ResolveActionApprovalInput, actor: string): ActionApprovalSummary {
    return this.stores.actionRuntime.resolveActionApproval(input, actor)
  }

  cancelPendingActionApprovalsForTask(workTaskId: string): void {
    return this.stores.actionRuntime.cancelPendingActionApprovalsForTask(workTaskId)
  }

  saveWorkTask(task: WorkTask): void {
    return this.stores.workTasks.saveWorkTask(task)
  }

  getProcessingJob(jobId: string): ProcessingJobSummary | null {
    return this.stores.processingJobs.getProcessingJob(jobId)
  }

  getProcessingJobDispatchReference(jobId: string): { requestFingerprint: string; payloadRef: string } | null {
    return this.stores.processingJobs.getProcessingJobDispatchReference(jobId)
  }

  listProcessingJobs(workTaskId?: string): ProcessingJobSummary[] {
    return this.stores.processingJobs.listProcessingJobs(workTaskId)
  }

  enqueueProcessingJob(
    rawInput: z.input<typeof enqueueProcessingJobInputSchema>,
    now = new Date()
  ): ProcessingJobSummary {
    return this.stores.processingJobs.enqueueProcessingJob(rawInput, now)
  }

  acquireProcessingJob(jobId: string, leaseDurationMs = 60_000, now = new Date()): ProcessingJobLease | null {
    return this.stores.processingJobs.acquireProcessingJob(jobId, leaseDurationMs, now)
  }

  updateProcessingJobProgress(jobId: string, leaseToken: string, progress: number, now = new Date()): ProcessingJobSummary {
    return this.stores.processingJobs.updateProcessingJobProgress(jobId, leaseToken, progress, now)
  }

  isProcessingJobCancellationRequested(jobId: string, leaseToken: string): boolean {
    return this.stores.processingJobs.isProcessingJobCancellationRequested(jobId, leaseToken)
  }

  completeProcessingJob(
    jobId: string,
    leaseToken: string,
    result: unknown,
    now = new Date()
  ): ProcessingJobCompletion {
    return this.stores.processingJobs.completeProcessingJob(jobId, leaseToken, result, now)
  }

  failProcessingJob(
    jobId: string,
    leaseToken: string,
    errorCode: string,
    retryable: boolean,
    retryDelayMs: number | null = null,
    now = new Date()
  ): ProcessingJobSummary {
    return this.stores.processingJobs.failProcessingJob(jobId, leaseToken, errorCode, retryable, retryDelayMs, now)
  }

  requestProcessingJobCancellationForTask(workTaskId: string, now = new Date()): ProcessingJobSummary[] {
    return this.stores.processingJobs.requestProcessingJobCancellationForTask(workTaskId, now)
  }

  retryProcessingJobsForTask(workTaskId: string, now = new Date()): ProcessingJobSummary[] {
    return this.stores.processingJobs.retryProcessingJobsForTask(workTaskId, now)
  }

  recoverExpiredProcessingJobs(
    now = new Date(),
    includeUnexpired = false
  ): { requeued: number; reviewRequired: number; cancelled: number } {
    return this.stores.processingJobs.recoverExpiredProcessingJobs(now, includeUnexpired)
  }

  getProcessingJobResult(jobId: string): unknown | null {
    return this.stores.processingJobs.getProcessingJobResult(jobId)
  }

  getCandidateMatchRunSummary(runId: string): CandidateMatchRunSummary {
    return this.stores.candidateMatch.getCandidateMatchRunSummary(runId)
  }

  getAgentMatchRunFacts(
    runId: string,
    runtimeIdentity: MatchRuntimeIdentity,
    resultId: string | null = null,
    rank: number | null = null
  ): AgentMatchRunFacts {
    return this.stores.candidateMatch.getAgentMatchRunFacts(runId, runtimeIdentity, resultId, rank)
  }

  getAgentCandidateProfileFacts(
    runId: string,
    runtimeIdentity: MatchRuntimeIdentity,
    resultId: string | null = null,
    rank: number | null = null
  ): AgentCandidateProfileFacts {
    return this.stores.candidateMatch.getAgentCandidateProfileFacts(runId, runtimeIdentity, resultId, rank)
  }

  getAgentCandidateInterviewFacts(
    runId: string,
    runtimeIdentity: MatchRuntimeIdentity,
    resultId: string | null = null,
    rank: number | null = null
  ): AgentCandidateInterviewFacts {
    return this.stores.candidateMatch.getAgentCandidateInterviewFacts(runId, runtimeIdentity, resultId, rank)
  }

  saveCandidateMatchRun(
    taskId: string,
    query: string,
    matches: CandidateProfileSearchResult[],
    now = new Date(),
    runtimeIdentity: MatchRuntimeIdentity | null = null
  ): { run: CandidateMatchRunSummary; matches: CandidateMatchResult[] } {
    return this.stores.candidateMatch.saveCandidateMatchRun(taskId, query, matches, now, runtimeIdentity)
  }

  getMatchingHomeProjection(
    runtimeIdentity: MatchRuntimeIdentity,
    now = new Date()
  ): MatchingHomeProjection {
    return this.stores.candidateMatch.getMatchingHomeProjection(runtimeIdentity, now)
  }

  setBusinessPriorityOverride(
    rawInput: SetBusinessPriorityOverrideInput,
    actor: string,
    now = new Date()
  ): BusinessPriorityProjection {
    return this.stores.candidateMatch.setBusinessPriorityOverride(rawInput, actor, now)
  }

  submitCandidateMatchFeedback(
    rawInput: SubmitCandidateMatchFeedbackInput,
    reviewerDisplayName: string,
    now = new Date()
  ): SubmitCandidateMatchFeedbackResult {
    return this.stores.candidateMatch.submitCandidateMatchFeedback(rawInput, reviewerDisplayName, now)
  }

  getCandidateEvaluationDraft(): CandidateEvaluationDraft | null {
    return this.stores.candidateEvaluation.getCandidateEvaluationDraft()
  }

  createCandidateEvaluationDraft(
    rawInput: CreateCandidateEvaluationDraftInput,
    now = new Date()
  ): CandidateEvaluationDraft {
    return this.stores.candidateEvaluation.createCandidateEvaluationDraft(rawInput, now)
  }

  saveCandidateEvaluationDraftCase(
    rawInput: SaveCandidateEvaluationDraftCaseInput,
    reviewerId: string,
    reviewerDisplayName: string,
    now = new Date()
  ): CandidateEvaluationDraft {
    return this.stores.candidateEvaluation.saveCandidateEvaluationDraftCase(rawInput, reviewerId, reviewerDisplayName, now)
  }

  deleteCandidateEvaluationDraftCase(rawInput: DeleteCandidateEvaluationDraftCaseInput, now = new Date()): CandidateEvaluationDraft {
    return this.stores.candidateEvaluation.deleteCandidateEvaluationDraftCase(rawInput, now)
  }

  buildCandidateEvaluationBenchmark(draftId: string, expectedRevision: number, now = new Date()): SesCandidateBenchmark {
    return this.stores.candidateEvaluation.buildCandidateEvaluationBenchmark(draftId, expectedRevision, now)
  }

  getCandidateEvaluationState(): CandidateEvaluationState {
    return this.stores.candidateEvaluation.getCandidateEvaluationState()
  }

  saveCandidateEvaluation(
    rawBenchmark: SesCandidateBenchmark,
    rawReport: CandidateEvaluationReport,
    now = new Date()
  ): CandidateEvaluationState {
    return this.stores.candidateEvaluation.saveCandidateEvaluation(rawBenchmark, rawReport, now)
  }

  saveRedactionSession(session: RedactionSessionEvidence, mappings: LocalPiiMapping[]): void {
    return this.stores.privacy.saveRedactionSession(session, mappings)
  }

  saveStagedFile(file: StagedFileRecord): void {
    return this.stores.candidates.saveStagedFile(file)
  }

  saveStagedFiles(files: StagedFileRecord[]): void {
    return this.stores.candidates.saveStagedFiles(files)
  }

  saveResumeImportTask(task: WorkTask, files: StagedFileRecord[]): void {
    return this.stores.candidates.saveResumeImportTask(task, files)
  }

  removeStagedFiles(tokens: string[]): void {
    return this.stores.candidates.removeStagedFiles(tokens)
  }

  getStagedFiles(tokens: string[]): StagedLocalFile[] {
    return this.stores.candidates.getStagedFiles(tokens)
  }

  getStagedFileRecords(tokens: string[]): StagedFileRecord[] {
    return this.stores.candidates.getStagedFileRecords(tokens)
  }

  listStagedFileRecords(): StagedFileRecord[] {
    return this.stores.candidates.listStagedFileRecords()
  }

  rebindStagedFilePaths(vaultDirectory: string): number {
    return this.stores.candidates.rebindStagedFilePaths(vaultDirectory)
  }

  saveParsedDocument(
    document: DocumentIR,
    summary: ResumeAnalysisSummary,
    redactionSessionId: string,
    extraction?: CandidateExtractionDraft
  ): void {
    return this.stores.candidates.saveParsedDocument(document, summary, redactionSessionId, extraction)
  }

  getCandidateExtraction(documentId: string): CandidateExtractionDraft | null {
    return this.stores.candidates.getCandidateExtraction(documentId)
  }

  getCandidateLocalIdentity(documentId: string): LocalCandidateIdentitySummary {
    return this.stores.candidates.getCandidateLocalIdentity(documentId)
  }

  getCandidateSourceDocumentId(candidateProfileId: string): string | null {
    return this.stores.candidates.getCandidateSourceDocumentId(candidateProfileId)
  }

  getAgentCandidateDraftFacts(sourceDocumentId: string, label: string): AgentCandidateDraftFacts | null {
    return this.stores.candidates.getAgentCandidateDraftFacts(sourceDocumentId, label)
  }

  getCandidateReview(documentId: string): CandidateReviewSnapshot | null {
    return this.stores.candidates.getCandidateReview(documentId)
  }

  listCandidateReviews(): CandidateReviewSnapshot[] {
    return this.stores.candidates.listCandidateReviews()
  }

  listCandidateInterviews(): CandidateInterviewSnapshot[] {
    return this.stores.candidateInterviews.listCandidateInterviews()
  }

  createCandidateInterviewRound(
    input: CreateCandidateInterviewRoundInput,
    updatedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    return this.stores.candidateInterviews.createCandidateInterviewRound(input, updatedBy, now)
  }

  saveCandidateInterviewSchedule(
    input: SaveCandidateInterviewScheduleInput,
    updatedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    return this.stores.candidateInterviews.saveCandidateInterviewSchedule(input, updatedBy, now)
  }

  saveCandidateInterviewPreparation(
    input: SaveCandidateInterviewPreparationInput,
    updatedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    return this.stores.candidateInterviews.saveCandidateInterviewPreparation(input, updatedBy, now)
  }

  saveCandidateInterviewNotes(
    input: SaveCandidateInterviewNotesInput,
    updatedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    return this.stores.candidateInterviews.saveCandidateInterviewNotes(input, updatedBy, now)
  }

  recordCandidateInterviewDecision(
    input: RecordCandidateInterviewDecisionInput,
    decidedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    return this.stores.candidateInterviews.recordCandidateInterviewDecision(input, decidedBy, now)
  }

  listEligibleTalentProfiles(): CandidateProfile[] {
    return this.stores.candidates.listEligibleTalentProfiles()
  }

  listCandidateProfileEmbeddings(modelId: string, modelRevision: string): CandidateProfileEmbeddingRecord[] {
    return this.stores.candidates.listCandidateProfileEmbeddings(modelId, modelRevision)
  }

  saveCandidateProfileEmbeddings(records: CandidateProfileEmbeddingInput[], now = new Date()): void {
    return this.stores.candidates.saveCandidateProfileEmbeddings(records, now)
  }

  listCandidateProjectEmbeddings(modelId: string, modelRevision: string): CandidateProjectEmbeddingRecord[] {
    return this.stores.candidates.listCandidateProjectEmbeddings(modelId, modelRevision)
  }

  saveCandidateProjectEmbeddings(records: CandidateProjectEmbeddingInput[], now = new Date()): void {
    return this.stores.candidates.saveCandidateProjectEmbeddings(records, now)
  }

  countEligibleTalentProfiles(): number {
    return this.stores.candidates.countEligibleTalentProfiles()
  }

  getCandidateProfileHistory(sourceDocumentId: string): CandidateProfileVersionDetail[] {
    return this.stores.candidates.getCandidateProfileHistory(sourceDocumentId)
  }

  previewCandidateDeletion(sourceDocumentId: string): CandidateDeletionPreview {
    return this.stores.candidates.previewCandidateDeletion(sourceDocumentId)
  }

  deleteCandidateDatabaseData(sourceDocumentId: string, expectedConfirmationHash: string, now = new Date()): CandidateDeletionPreview {
    return this.stores.candidates.deleteCandidateDatabaseData(sourceDocumentId, expectedConfirmationHash, now)
  }

  saveDataDeletionReport<T extends DataDeletionReport>(input: T): T {
    return this.stores.maintenance.saveDataDeletionReport(input)
  }

  listDataDeletionReports(): DataDeletionReport[] {
    return this.stores.maintenance.listDataDeletionReports()
  }

  confirmCandidateReview(
    input: SubmitCandidateReviewInput,
    reviewerId: string,
    reviewerDisplayName: string,
    now = new Date()
  ): CandidateReviewSnapshot {
    return this.stores.candidates.confirmCandidateReview(input, reviewerId, reviewerDisplayName, now)
  }

  updateCandidateProfile(
    input: UpdateCandidateProfileInput,
    reviewerId: string,
    reviewerDisplayName: string,
    now = new Date()
  ): CandidateProfile {
    return this.stores.candidates.updateCandidateProfile(input, reviewerId, reviewerDisplayName, now)
  }

  getRedactionSessionIdForDocument(documentId: string): string | null {
    return this.stores.privacy.getRedactionSessionIdForDocument(documentId)
  }

  getParsedDocument(fileToken: string): DocumentIR | null {
    return this.stores.candidates.getParsedDocument(fileToken)
  }

  getResumeAnalysis(fileToken: string): ResumeAnalysisSummary | null {
    return this.stores.candidates.getResumeAnalysis(fileToken)
  }

  listResumeAnalyses(): ResumeAnalysisSummary[] {
    return this.stores.candidates.listResumeAnalyses()
  }

  listAiConversations(rawContext: AiConversationContext): AiConversationSnapshot[] {
    return this.stores.agentConversations.listAiConversations(rawContext)
  }

  getAiConversation(conversationId: string): AiConversationSnapshot | null {
    return this.stores.agentConversations.getAiConversation(conversationId)
  }

  saveAiConversation(rawInput: SaveAiConversationInput, now = new Date()): AiConversationSnapshot {
    return this.stores.agentConversations.saveAiConversation(rawInput, now)
  }

  deleteAiConversations(conversationIds: string[]): string[] {
    return this.stores.agentConversations.deleteAiConversations(conversationIds)
  }

  getLocalOperatorProfile(): LocalOperatorProfile | null {
    return this.stores.localSettings.getLocalOperatorProfile()
  }

  saveLocalOperatorProfile(
    rawInput: SaveLocalOperatorProfileInput,
    now = new Date()
  ): LocalOperatorProfile {
    return this.stores.localSettings.saveLocalOperatorProfile(rawInput, now)
  }

  getLocalApplicationPreferences(): LocalApplicationPreferences | null {
    return this.stores.localSettings.getLocalApplicationPreferences()
  }

  saveLocalApplicationPreferences(
    rawInput: SaveLocalApplicationPreferencesInput,
    now = new Date()
  ): LocalApplicationPreferences {
    return this.stores.localSettings.saveLocalApplicationPreferences(rawInput, now)
  }

  getGoogleWorkspaceAdminConfiguration(): GoogleWorkspaceAdminConfiguration | null {
    return this.stores.gmail.getGoogleWorkspaceAdminConfiguration()
  }

  saveGoogleWorkspaceAdminConfiguration(
    rawInput: SaveGoogleWorkspaceAdminConfigurationInput,
    configuredBy: string,
    now = new Date()
  ): GoogleWorkspaceAdminConfiguration {
    return this.stores.gmail.saveGoogleWorkspaceAdminConfiguration(rawInput, configuredBy, now)
  }

  getLatestGoogleWorkspaceAcceptanceReport(configurationFingerprint?: string): GoogleWorkspaceOnlineAcceptanceReport | null {
    return this.stores.gmail.getLatestGoogleWorkspaceAcceptanceReport(configurationFingerprint)
  }

  saveGoogleWorkspaceAcceptanceReport(rawReport: GoogleWorkspaceOnlineAcceptanceReport): GoogleWorkspaceOnlineAcceptanceReport {
    return this.stores.gmail.saveGoogleWorkspaceAcceptanceReport(rawReport)
  }

  getGmailSyncCheckpoint(accountEmail: string): GmailSyncCheckpointRecord | null {
    return this.stores.gmail.getGmailSyncCheckpoint(accountEmail)
  }

  saveGmailSyncSuccess(
    accountEmail: string,
    configHash: string,
    historyId: string,
    lastRun: NonNullable<GmailSyncCheckpointRecord['lastRun']>,
    syncedAt: string
  ): void {
    return this.stores.gmail.saveGmailSyncSuccess(accountEmail, configHash, historyId, lastRun, syncedAt)
  }

  saveGmailSyncFailure(
    accountEmail: string,
    configHash: string,
    errorCode: string,
    failedAt: string,
    lastRun: GmailSyncCheckpointRecord['lastRun'] = null
  ): void {
    return this.stores.gmail.saveGmailSyncFailure(accountEmail, configHash, errorCode, failedAt, lastRun)
  }

  hasGmailMessage(accountEmail: string, gmailMessageId: string): boolean {
    return this.stores.gmail.hasGmailMessage(accountEmail, gmailMessageId)
  }

  findGmailMessageByFingerprint(accountEmail: string, fingerprint: string): string | null {
    return this.stores.gmail.findGmailMessageByFingerprint(accountEmail, fingerprint)
  }

  saveGmailMessage(input: StoredGmailMessageInput): boolean {
    return this.stores.gmail.saveGmailMessage(input)
  }

  countGmailMessages(accountEmail: string): number {
    return this.stores.gmail.countGmailMessages(accountEmail)
  }

  summarizeGmailRedactionEvidence(accountEmail: string): GmailRedactionEvidenceSummary {
    return this.stores.gmail.summarizeGmailRedactionEvidence(accountEmail)
  }

  listGmailMessagesPendingJobCaseDrafts(accountEmail: string, limit = 100): StoredGmailMessageInput[] {
    return this.stores.jobCases.listGmailMessagesPendingJobCaseDrafts(accountEmail, limit)
  }

  ensureGmailJobCaseSource(input: JobCaseSource): JobCaseSource {
    return this.stores.jobCases.ensureGmailJobCaseSource(input)
  }

  saveJobCaseDraft(input: JobCaseExtractionDraft): boolean {
    return this.stores.jobCases.saveJobCaseDraft(input)
  }

  saveJobCaseSourceAndDraft(rawSource: JobCaseSource, rawDraft: JobCaseExtractionDraftV2): boolean {
    return this.stores.jobCases.saveJobCaseSourceAndDraft(rawSource, rawDraft)
  }

  saveRedactedJobCaseSourceAndDraft(
    session: RedactionSessionEvidence,
    mappings: LocalPiiMapping[],
    rawSource: JobCaseSource,
    rawDraft: JobCaseExtractionDraftV2
  ): boolean {
    return this.stores.jobCases.saveRedactedJobCaseSourceAndDraft(session, mappings, rawSource, rawDraft)
  }

  findJobCaseReviewByBusinessFingerprint(subject: string, body: string): JobCaseReviewSnapshot | null {
    return this.stores.jobCases.findJobCaseReviewByBusinessFingerprint(subject, body)
  }

  getEmlJobCaseReview(sourceMessageKey: string): JobCaseReviewSnapshot | null {
    return this.stores.jobCases.getEmlJobCaseReview(sourceMessageKey)
  }

  getJobCaseReview(reviewId: string): JobCaseReviewSnapshot | null {
    return this.stores.jobCases.getJobCaseReview(reviewId)
  }

  listJobCaseReviews(): JobCaseReviewSnapshot[] {
    return this.stores.jobCases.listJobCaseReviews()
  }

  listActiveJobCases(): ConfirmedJobCase[] {
    return this.stores.jobCases.listActiveJobCases()
  }

  getJobCaseHistory(reviewId: string): JobCaseVersionDetail[] {
    return this.stores.jobCases.getJobCaseHistory(reviewId)
  }

  setJobCaseLifecycle(
    input: SetJobCaseLifecycleInput,
    changedBy: string,
    now = new Date()
  ): JobCaseReviewSnapshot {
    return this.stores.jobCases.setJobCaseLifecycle(input, changedBy, now)
  }

  reopenJobCaseReview(
    input: ReopenJobCaseReviewInput,
    changedBy: string,
    now = new Date()
  ): JobCaseReviewSnapshot {
    return this.stores.jobCases.reopenJobCaseReview(input, changedBy, now)
  }

  previewJobCaseDeletion(reviewId: string): JobCaseDeletionPreview {
    return this.stores.jobCases.previewJobCaseDeletion(reviewId)
  }

  deleteJobCaseDatabaseData(rawInput: DeleteJobCaseDataInput, now = new Date()): JobCaseDeletionPreview {
    return this.stores.jobCases.deleteJobCaseDatabaseData(rawInput, now)
  }

  confirmJobCaseReview(
    input: SubmitJobCaseReviewInput,
    reviewerId: string,
    reviewerDisplayName: string,
    now = new Date()
  ): JobCaseReviewSnapshot {
    return this.stores.jobCases.confirmJobCaseReview(input, reviewerId, reviewerDisplayName, now)
  }

  getProposalPreparationOptions(): ProposalPreparationOptions {
    return this.stores.proposals.getProposalPreparationOptions()
  }

  getProposalWorkspace(taskId: string): ProposalWorkspaceSnapshot {
    return this.stores.proposals.getProposalWorkspace(taskId)
  }

  listProposalDrafts(taskId?: string): ProposalDraftSnapshot[] {
    return this.stores.proposals.listProposalDrafts(taskId)
  }

  getProposalDraft(draftId: string): ProposalDraftSnapshot | null {
    return this.stores.proposals.getProposalDraft(draftId)
  }

  createProposalDraft(
    rawInput: CreateProposalDraftInput,
    draftId: string,
    actor: string,
    now = new Date()
  ): ProposalDraftSnapshot {
    return this.stores.proposals.createProposalDraft(rawInput, draftId, actor, now)
  }

  updateProposalDraft(rawInput: UpdateProposalDraftInput, actor: string, now = new Date()): ProposalDraftSnapshot {
    return this.stores.proposals.updateProposalDraft(rawInput, actor, now)
  }

  approveProposalDraft(rawInput: ApproveProposalDraftInput, actor: string, now = new Date()): ProposalDraftSnapshot {
    return this.stores.proposals.approveProposalDraft(rawInput, actor, now)
  }

  beginProposalExport(
    draftId: string,
    revision: number,
    expectedContentHash: string,
    exportId: string,
    targetPathHash: string,
    actor: string,
    now = new Date()
  ): ProposalDraftSnapshot {
    return this.stores.proposals.beginProposalExport(draftId, revision, expectedContentHash, exportId, targetPathHash, actor, now)
  }

  completeProposalExport(
    exportId: string,
    draftId: string,
    expectedContentHash: string,
    packageHash: string,
    actor: string,
    now = new Date()
  ): ProposalDraftSnapshot {
    return this.stores.proposals.completeProposalExport(exportId, draftId, expectedContentHash, packageHash, actor, now)
  }

  recordProposalFollowUp(
    rawInput: RecordProposalFollowUpInput,
    eventId: string,
    actor: string,
    now = new Date()
  ): ProposalDraftSnapshot {
    return this.stores.proposals.recordProposalFollowUp(rawInput, eventId, actor, now)
  }

  failProposalExport(exportId: string, draftId: string, errorCode: string, actor: string, now = new Date()): void {
    return this.stores.proposals.failProposalExport(exportId, draftId, errorCode, actor, now)
  }

  markProposalExportOutcomeUnknown(exportId: string, draftId: string, actor: string, now = new Date()): ProposalDraftSnapshot {
    return this.stores.proposals.markProposalExportOutcomeUnknown(exportId, draftId, actor, now)
  }

  getRedactionSession(id: string): RedactionSessionEvidence | null {
    return this.stores.privacy.getRedactionSession(id)
  }

  getLocalPiiMappings(sessionId: string): LocalPiiMapping[] {
    return this.stores.privacy.getLocalPiiMappings(sessionId)
  }

  appendCloudCallAudit(record: CloudCallAuditRecord): void {
    return this.stores.privacy.appendCloudCallAudit(record)
  }

  getSchemaVersion(): number {
    return this.stores.maintenance.getSchemaVersion()
  }

  async createConsistentSnapshot(destinationPath: string): Promise<{ dataRevision: number }> {
    return this.stores.maintenance.createConsistentSnapshot(destinationPath)
  }

  getLocalDataRevision(): { revision: number; updatedAt: string | null } {
    return this.stores.maintenance.getLocalDataRevision()
  }

  recordRecoveryEvent(
    eventType: 'backup-created' | 'restore-completed' | 'restore-failed',
    summary: RecoveryPackageSummary,
    packageHash: string,
    now = new Date(),
    dataRevision = this.getLocalDataRevision().revision
  ): void {
    return this.stores.maintenance.recordRecoveryEvent(eventType, summary, packageHash, now, dataRevision)
  }

  snoozeRecoveryReminder(days: 1 | 7, now = new Date()): void {
    return this.stores.maintenance.snoozeRecoveryReminder(days, now)
  }

  getRecoveryState(pendingRestore = false, now = new Date()): RecoveryState {
    return this.stores.maintenance.getRecoveryState(pendingRestore, now)
  }

  checkpoint(): void {
    return this.stores.maintenance.checkpoint()
  }

  close(): void {
    if (this.database.open) this.database.close()
  }
}
