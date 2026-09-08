import { type DirectIdentifier, type RedactionSessionEvidence } from '@privacy'
import {
  type ActionApprovalSummary,
  type AiConversationContext,
  type BusinessPriorityProjection,
  type CandidateInterviewSnapshot,
  type CandidateMatchFeedbackSnapshot,
  type CandidateMatchRunSummary,
  type DomainToolName,
  type JobCaseSourceType,
  type ProcessingJobSummary,
  type ProposalDraftSnapshot,
  type ProposalFollowUpEvent,
  type CandidateSourceFormat
} from '@shared/contracts'

export interface WorkTaskRow {
  payload_json: string
}

export interface AiConversationRow {
  id: string
  assistant_type: AiConversationContext['assistant']
  context_key: string
  candidate_document_id: string | null
  interview_id: string | null
  interview_kind: 'recruiting' | 'client' | null
  round_number: number | null
  title: string
  payload_json: string
  revision: number
  created_at: string
  updated_at: string
}

export interface ProcessingJobRow {
  id: string
  job_type: ProcessingJobSummary['type']
  work_task_id: string
  task_step_id: string
  idempotency_key: string
  request_fingerprint: string
  payload_ref: string
  status: ProcessingJobSummary['status']
  replay_policy: ProcessingJobSummary['replayPolicy']
  progress: number
  attempt_count: number
  max_attempts: number
  next_retry_at: string | null
  lease_token: string | null
  lease_expires_at: string | null
  cancel_requested_at: string | null
  error_code: string | null
  result_json: string | null
  result_hash: string | null
  created_at: string
  updated_at: string
}

export interface ActionApprovalRow {
  id: string
  action_run_id: string
  tool_name: DomainToolName
  work_task_id: string | null
  status: ActionApprovalSummary['status']
  reason: string
  safe_summary: string
  input_hash: string
  content_revision: string | null
  expires_at: string
  created_at: string
  resolved_at: string | null
}

export interface ProcessingJobLease {
  job: ProcessingJobSummary
  leaseToken: string
}

export interface ProcessingJobCompletion {
  job: ProcessingJobSummary
  accepted: boolean
}

export interface CandidateMatchRunRow {
  id: string
  task_id: string
  query_text: string
  algorithm_version: CandidateMatchRunSummary['algorithmVersion']
  hard_filter_policy_version: CandidateMatchRunSummary['hardFilterPolicyVersion']
  result_set_hash: string
  job_case_id: string | null
  job_case_version: number | null
  candidate_pool_fingerprint: string | null
  candidate_profile_versions_json: string | null
  embedding_model_id: string | null
  embedding_model_revision: string | null
  reranker_model_id: string | null
  reranker_model_revision: string | null
  validity_policy_version: string | null
  invalidated_at: string | null
  invalidated_reason: string | null
  created_at: string
}

export interface CandidateMatchResultRow {
  id: string
  run_id: string
  candidate_profile_id: string
  candidate_profile_version: number
  result_rank: number
  result_hash: string
  feedback_decision: CandidateMatchFeedbackSnapshot['decision'] | null
  feedback_reason: CandidateMatchFeedbackSnapshot['reasonCode'] | null
  feedback_note: string | null
  feedback_revision: number
  reviewed_by: string | null
  reviewed_at: string | null
  result_snapshot_json: string | null
}

export interface BusinessPriorityProjectionRow {
  id: string
  match_result_id: string
  run_id: string
  candidate_profile_id: string
  rule_version: 'business-priority-v1'
  level: BusinessPriorityProjection['level']
  reasons_json: string
  inputs_json: string
  input_snapshot_hash: string
  generated_at: string
  override_level: BusinessPriorityProjection['level'] | null
  override_reason: string | null
  override_actor: string | null
  override_expires_at: string | null
  override_revision: number
}

export interface CandidateEvaluationDatasetRow {
  id: string
  name: string
  dataset_hash: string
  payload_json: string
  case_count: number
  relevant_candidate_count: number
  reviewer_count: number
  imported_at: string
}

export interface CandidateEvaluationReportRow {
  report_json: string
}

export interface CandidateEvaluationDraftRow {
  id: string
  name: string
  revision: number
  created_at: string
  updated_at: string
}

export interface CandidateEvaluationDraftCaseRow {
  id: string
  draft_id: string
  job_case_id: string
  job_case_version: number
  job_case_title: string
  query_text: string
  pool_reviewed: 1
  reviewer_id: string
  reviewer_display_name: string
  reviewed_at: string
  job_case_status: 'active' | 'superseded' | null
  job_case_lifecycle: 'active' | 'archived' | null
}

export interface CandidateEvaluationDraftLabelRow {
  case_id: string
  candidate_profile_id: string
  candidate_profile_version: number
  expected_project_evidence: 0 | 1
  profile_json: string
  profile_status: 'current' | 'stale' | 'superseded'
  talent_pool_status: 'eligible' | 'suspended' | 'removed' | null
}

export interface GoogleWorkspaceAdminConfigurationRow {
  client_id: string
  workspace_domain: string
  label_ids_json: string
  query_text: string
  lookback_days: number
  max_messages_per_run: number
  revision: number
  configured_by: string
  updated_at: string
}

export interface LocalOperatorProfileRow {
  operator_id: string
  display_name: string
  role_label: string
  revision: number
  updated_at: string
}

export interface LocalApplicationPreferencesRow {
  locale: string
  revision: number
  updated_at: string
}

export interface JobCaseFieldAliasesRow {
  aliases_json: string
  revision: number
  updated_at: string
}

export interface RedactionSessionRow {
  id: string
  source_version: string
  policy_version: string
  status: RedactionSessionEvidence['status']
  content_hash: string | null
  removed_types_json: string
  created_at: string
  expires_at: string
}

export interface MappingRow {
  placeholder: string
  identifier_type: DirectIdentifier
  encrypted_original: Buffer
}

export interface StagedFileRow {
  token: string
  name: string
  format: CandidateSourceFormat
  size: number
  sha256: string
  encrypted_path: string
  privacy_status: 'awaiting-local-scan'
  created_at: string
}

export interface ParsedDocumentRow {
  document_ir_json: string
  analysis_summary_json: string
}

export interface CandidateExtractionRow {
  draft_json: string
}

export interface CandidateReviewStateRow {
  document_id: string
  extraction_version: string
  extraction_created_at: string
  status: 'awaiting-review' | 'completed'
  pii_reviewed: 0 | 1
  revision: number
  reviewer_id: string | null
  reviewer_display_name: string | null
  completed_at: string | null
  updated_at: string
}

export interface CandidateReviewJoinRow extends CandidateReviewStateRow {
  draft_json: string
  file_name: string
}

export interface CandidateInterviewRow {
  id: string
  source_document_id: string
  kind: CandidateInterviewSnapshot['kind']
  round_number: number
  parent_interview_id: string | null
  stage: CandidateInterviewSnapshot['stage']
  scheduled_at: string | null
  duration_minutes: CandidateInterviewSnapshot['durationMinutes']
  meeting_method: CandidateInterviewSnapshot['meetingMethod']
  meeting_url: string | null
  meeting_details_json: string
  interviewer: string | null
  contact_note: string | null
  interview_goal: string | null
  question_plan_json: string
  interview_notes: string | null
  unresolved_items_json: string
  decision: CandidateInterviewSnapshot['decision']
  decision_reason: string | null
  decided_at: string | null
  decided_by: string | null
  created_at: string
  updated_at: string
  updated_by: string
  cloud_eligible: 0
}

export interface CandidateFieldAuditRow {
  field_key: string
  original_value: string | null
  confirmed_value: string | null
  change_reason: string | null
  source_labels_json: string
}

export interface CandidateProjectAuditRow {
  draft_id: string
  project_id: string | null
  original_json: string | null
  confirmed_json: string | null
  change_reason: string | null
  source_labels_json: string
}

export interface CandidateProfileRow {
  profile_json: string
  status: 'current' | 'stale' | 'superseded'
}

export interface CandidateRecordRow {
  record_status: 'active' | 'archived' | 'deleted'
  recruiting_status: 'pending-review' | 'ready-for-recruiting' | 'recruiting' | 'passed' | 'rejected' | 'withdrawn' | 'no-show' | 'on-hold'
}

export interface TalentPoolMembershipRow {
  status: 'eligible' | 'suspended' | 'removed'
}

export interface CandidateProfileEmbeddingRow {
  profile_id: string
  content_hash: string
  vector_dimension: number
  vector_blob: Buffer
  updated_at: string
}

export interface CandidateProjectEmbeddingRow extends CandidateProfileEmbeddingRow {
  project_id: string
}

export interface CandidateProfileEmbeddingRecord {
  profileId: string
  modelId: string
  modelRevision: string
  contentHash: string
  vector: number[]
  updatedAt: string
}

export type CandidateProfileEmbeddingInput = Omit<CandidateProfileEmbeddingRecord, 'updatedAt'>

export interface CandidateProjectEmbeddingRecord extends CandidateProfileEmbeddingRecord {
  projectId: string
}

export type CandidateProjectEmbeddingInput = Omit<CandidateProjectEmbeddingRecord, 'updatedAt'>

export interface CandidateLifecycleRow {
  state: 'active' | 'archived'
  reason: string
  changed_by: string
  changed_at: string
}

export interface DataDeletionReportRow {
  report_json: string
}

export interface RedactionSessionIdRow {
  redaction_session_id: string
}

export interface GmailSyncCheckpointRecord {
  accountEmail: string
  configHash: string
  historyId: string | null
  status: 'idle' | 'error'
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

export interface GmailSyncStateRow {
  account_email: string
  config_hash: string
  history_id: string | null
  status: 'idle' | 'error'
  last_synced_at: string | null
  last_run_json: string | null
  last_error: string | null
}

export interface GmailMessageRow {
  account_email: string
  gmail_message_id: string
  thread_id: string
  history_id: string
  internal_date: string
  label_ids_json: string
  rfc_message_id: string | null
  from_domain: string | null
  redacted_subject: string
  redacted_body: string
  redaction_session_id: string
  classification: StoredGmailMessageInput['classification']
  business_fingerprint: string
  duplicate_of_message_id: string | null
  warning_codes_json: string
  attachment_count: number
  imported_at: string
}

export interface GoogleWorkspaceAcceptanceReportRow {
  report_json: string
}

export interface GmailRedactionEvidenceSummary {
  storedMessages: number
  passed: number
  uncertain: number
  blocked: number
}

export interface JobCaseReviewStateRow {
  review_id: string
  status: 'awaiting-review' | 'completed'
  privacy_reviewed: 0 | 1
  revision: number
  reviewer_id: string | null
  reviewer_display_name: string | null
  completed_at: string | null
  updated_at: string
}

export interface JobCaseReviewJoinRow extends JobCaseReviewStateRow {
  draft_json: string
  intake_at: string
  source_id: string
  source_type: JobCaseSourceType
  provider_message_id: string | null
  thread_id: string
  message_date: string
  from_domain: string | null
  redacted_subject: string
  redacted_body: string
}

export interface JobCaseSourceRow {
  id: string
  source_type: JobCaseSourceType
  provider_account: string | null
  provider_message_id: string | null
  thread_id: string
  from_domain: string | null
  message_date: string
  redacted_subject: string
  redacted_body: string
  redaction_session_id: string
  warning_codes_json: string
  created_at: string
}

export interface JobCaseFieldAuditRow {
  field_key: string
  original_value: string | null
  confirmed_value: string | null
  change_reason: string | null
  source_labels_json: string
}

export interface JobCaseRow {
  case_json: string
  status: 'active' | 'superseded'
}

export interface JobCaseLifecycleRow {
  source_review_id: string
  state: 'active' | 'archived'
  reason: string
  changed_by: string
  changed_at: string
}

export interface ProposalDraftRow {
  payload_json: string
  status: ProposalDraftSnapshot['status']
  revision: number
  content_hash: string
  approved_content_hash: string | null
}

export interface ProposalExportRow {
  id: string
  draft_id: string
  status: 'preparing' | 'completed' | 'failed' | 'unknown'
}

export interface ProposalFollowUpEventRow {
  id: string
  draft_id: string
  revision: number
  stage: ProposalFollowUpEvent['stage']
  occurred_on: string
  note: string | null
  actor: string
  recorded_at: string
  cloud_eligible: 0
}

export interface StoredGmailMessageInput {
  accountEmail: string
  gmailMessageId: string
  threadId: string
  historyId: string
  internalDate: string
  labelIds: string[]
  rfcMessageId: string | null
  fromDomain: string | null
  redactedSubject: string
  redactedBody: string
  redactionSessionId: string
  classification: 'job-case' | 'candidate-proposal' | 'unclassified'
  businessFingerprint: string
  duplicateOfMessageId: string | null
  warningCodes: string[]
  attachmentCount: number
  importedAt: string
}

export interface BroadcastTemplateRow {
  id: string
  name: string
  rate_public: string
  header_ja: string
  header_zh: string
  footer_ja: string
  footer_zh: string
  lines_json: string
  revision: number
  created_at: string
  updated_at: string
}

/** Pre-v43 send ledger: still read, never written. */
export interface CaseBroadcastRow {
  id: string
  review_id: string
  job_case_id: string
  job_case_version: number
  group_id: string
  group_name: string
  template_id: string
  template_revision: number
  lang: string
  kind: string
  action: string
  text: string
  text_sha256: string
  actor_id: string
  created_at: string
}

export interface JobCaseSeenRow {
  review_id: string
  seen_at: string
}

export interface CaseBroadcastCopyRow {
  id: string
  review_id: string
  job_case_id: string
  job_case_version: number
  template_id: string
  template_revision: number
  lang: string
  kind: string
  text: string
  text_sha256: string
  actor_id: string
  created_at: string
}
