import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { z } from 'zod'
import {
  candidateReviewSnapshotSchema,
  aiConversationContextSchema,
  aiConversationSnapshotSchema,
  saveAiConversationInputSchema,
  candidateInterviewSnapshotSchema,
  createCandidateInterviewRoundInputSchema,
  candidateWorkAuthorizationValues,
  candidateMatchRunSummarySchema,
  setBusinessPriorityOverrideInputSchema,
  candidateEvaluationReportSchema,
  candidateEvaluationStateSchema,
  candidateEvaluationDraftSchema,
  createCandidateEvaluationDraftInputSchema,
  saveCandidateEvaluationDraftCaseInputSchema,
  deleteCandidateEvaluationDraftCaseInputSchema,
  candidateDeletionPreviewSchema,
  dataDeletionReportSchema,
  deleteJobCaseDataInputSchema,
  jobCaseDeletionPreviewSchema,
  jobCaseReviewSnapshotSchema,
  approveProposalDraftInputSchema,
  proposalDraftSnapshotSchema,
  proposalFollowUpEventSchema,
  proposalPreparationOptionsSchema,
  proposalTaskIdSchema,
  proposalWorkspaceSnapshotSchema,
  reopenJobCaseReviewInputSchema,
  resumeAnalysisSummarySchema,
  submitCandidateReviewInputSchema,
  saveCandidateInterviewScheduleInputSchema,
  saveCandidateInterviewPreparationInputSchema,
  saveCandidateInterviewNotesInputSchema,
  recordCandidateInterviewDecisionInputSchema,
  updateCandidateProfileInputSchema,
  submitCandidateMatchFeedbackInputSchema,
  sesCandidateBenchmarkSchema,
  submitJobCaseReviewInputSchema,
  updateProposalDraftInputSchema,
  createProposalDraftInputSchema,
  setJobCaseLifecycleInputSchema,
  googleWorkspaceAdminConfigurationSchema,
  googleWorkspaceOnlineAcceptanceReportSchema,
  enqueueProcessingJobInputSchema,
  processingJobSummarySchema,
  recordProposalFollowUpInputSchema,
  localApplicationPreferencesSchema,
  localOperatorProfileSchema,
  saveGoogleWorkspaceAdminConfigurationInputSchema,
  saveLocalApplicationPreferencesInputSchema,
  saveLocalOperatorProfileInputSchema,
  workTaskSchema
} from '@shared'
import {
  candidatePoolFingerprint,
  evaluateMatchRunValidity,
  projectBusinessPriority,
  type MatchRuntimeIdentity
} from '@matching'
import type { WorkTask } from '@domain'
import type { StagedFileRecord } from '@files'
import {
  confirmedJobCaseSchema,
  candidateBenchmarkQueryFromJobCase,
  jobCaseExtractionDraftSchema,
  jobCaseSourceSchema,
  type ConfirmedJobCase,
  type JobCaseExtractionDraft,
  type JobCaseExtractionDraftV2,
  type JobCaseSource
} from '@job-cases'
import { documentIrSchema, type DocumentIR } from '@parsers'
import {
  approveLocalProposalDraft,
  createLocalProposalDraft,
  markProposalExported,
  markProposalExportUnknown,
  recordLocalProposalFollowUp,
  updateLocalProposalDraft
} from '@proposals'
import {
  candidateExtractionDraftSchema,
  candidateProfileSchema,
  extractLocalCandidatePersonalDetails,
  type CandidateExtractionDraft,
  type CandidateProfile
} from '@resume'
import type {
  CandidateMatchFeedbackSnapshot,
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
  MatchingHomeResult,
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
  LocalCandidatePersonalDetails,
  LocalCandidateIdentitySummary,
  CandidateProjectExperience,
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
  ProposalFollowUpEvent,
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
  SupportedResumeFormat,
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
  AgentEntityStatus,
  AgentMatchRunFacts,
  AiConversationBlock,
  AiConversationContext,
  AiConversationMessage,
  AiConversationReference,
  AiConversationSnapshot,
  TypedAiConversationReference,
  SaveAiConversationInput,
  DomainToolName,
  ResolveActionApprovalInput
} from '@shared/contracts'
import {
  detectDirectIdentifiers,
  type CloudCallAuditRecord,
  type DirectIdentifier,
  type LocalPiiMapping,
  type RedactionEvidenceStore,
  type RedactionSessionEvidence
} from '@privacy'

export const currentSchemaVersion = 38

const migrationV1 = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  tombstone INTEGER NOT NULL DEFAULT 0 CHECK (tombstone IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS work_tasks_status_updated_idx ON work_tasks(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS redaction_sessions (
  id TEXT PRIMARY KEY,
  source_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'uncertain', 'invalidated')),
  content_hash TEXT,
  removed_types_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_pii_mappings (
  redaction_session_id TEXT NOT NULL REFERENCES redaction_sessions(id) ON DELETE CASCADE,
  placeholder TEXT NOT NULL,
  identifier_type TEXT NOT NULL,
  encrypted_original BLOB NOT NULL,
  PRIMARY KEY (redaction_session_id, placeholder)
);

CREATE TABLE IF NOT EXISTS cloud_call_audits (
  id TEXT PRIMARY KEY,
  redaction_session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  task_type TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  dlp_status TEXT NOT NULL CHECK (dlp_status = 'passed'),
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'blocked', 'failed')),
  reason_code TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cloud_call_audits_session_idx ON cloud_call_audits(redaction_session_id, created_at);

CREATE TABLE IF NOT EXISTS change_outbox (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  created_at TEXT NOT NULL
);
`

const migrationV2 = `
CREATE TABLE IF NOT EXISTS staged_files (
  token TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  format TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  sha256 TEXT NOT NULL,
  encrypted_path TEXT NOT NULL UNIQUE,
  privacy_status TEXT NOT NULL CHECK (privacy_status = 'awaiting-local-scan'),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS staged_files_sha256_idx ON staged_files(sha256);
`

const migrationV3 = `
CREATE TABLE IF NOT EXISTS parsed_documents (
  document_id TEXT PRIMARY KEY REFERENCES staged_files(token) ON DELETE CASCADE,
  document_ir_json TEXT NOT NULL,
  analysis_summary_json TEXT NOT NULL,
  redaction_session_id TEXT NOT NULL REFERENCES redaction_sessions(id),
  parser_version TEXT NOT NULL,
  analyzed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS parsed_documents_session_idx ON parsed_documents(redaction_session_id);
`

const migrationV4 = `
CREATE TABLE IF NOT EXISTS candidate_extractions (
  document_id TEXT PRIMARY KEY REFERENCES parsed_documents(document_id) ON DELETE CASCADE,
  draft_json TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK (review_status = 'awaiting-review'),
  updated_at TEXT NOT NULL
);
`

const migrationV5 = `
CREATE TABLE IF NOT EXISTS candidate_review_states (
  document_id TEXT PRIMARY KEY REFERENCES candidate_extractions(document_id) ON DELETE CASCADE,
  extraction_version TEXT NOT NULL,
  extraction_created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('awaiting-review', 'completed')),
  pii_reviewed INTEGER NOT NULL DEFAULT 0 CHECK (pii_reviewed IN (0, 1)),
  revision INTEGER NOT NULL CHECK (revision > 0),
  reviewer_id TEXT,
  reviewer_display_name TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidate_field_review_audits (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES candidate_extractions(document_id) ON DELETE CASCADE,
  review_revision INTEGER NOT NULL,
  field_key TEXT NOT NULL,
  original_value TEXT,
  confirmed_value TEXT,
  change_reason TEXT,
  source_labels_json TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  UNIQUE(document_id, review_revision, field_key)
);
CREATE INDEX IF NOT EXISTS candidate_field_reviews_document_idx
  ON candidate_field_review_audits(document_id, review_revision);

CREATE TABLE IF NOT EXISTS candidate_profiles (
  id TEXT PRIMARY KEY,
  source_document_id TEXT NOT NULL REFERENCES parsed_documents(document_id),
  version INTEGER NOT NULL CHECK (version > 0),
  profile_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('current', 'stale', 'superseded')),
  confirmed_at TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  UNIQUE(source_document_id, version)
);
CREATE INDEX IF NOT EXISTS candidate_profiles_source_idx
  ON candidate_profiles(source_document_id, version DESC);
CREATE UNIQUE INDEX IF NOT EXISTS candidate_profiles_current_idx
  ON candidate_profiles(source_document_id) WHERE status = 'current';
`

const migrationV6 = `
CREATE TABLE IF NOT EXISTS gmail_sync_states (
  account_email TEXT PRIMARY KEY,
  config_hash TEXT NOT NULL,
  history_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('idle', 'error')),
  last_synced_at TEXT,
  last_run_json TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gmail_messages (
  account_email TEXT NOT NULL,
  gmail_message_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  history_id TEXT NOT NULL,
  internal_date TEXT NOT NULL,
  label_ids_json TEXT NOT NULL,
  rfc_message_id TEXT,
  from_domain TEXT,
  redacted_subject TEXT NOT NULL,
  redacted_body TEXT NOT NULL,
  redaction_session_id TEXT NOT NULL REFERENCES redaction_sessions(id),
  classification TEXT NOT NULL CHECK (classification IN ('job-case', 'candidate-proposal', 'unclassified')),
  business_fingerprint TEXT NOT NULL,
  duplicate_of_message_id TEXT,
  warning_codes_json TEXT NOT NULL,
  attachment_count INTEGER NOT NULL CHECK (attachment_count >= 0),
  cloud_eligible INTEGER NOT NULL DEFAULT 0 CHECK (cloud_eligible = 0),
  imported_at TEXT NOT NULL,
  PRIMARY KEY (account_email, gmail_message_id)
);
CREATE INDEX IF NOT EXISTS gmail_messages_fingerprint_idx
  ON gmail_messages(account_email, business_fingerprint, imported_at);
CREATE INDEX IF NOT EXISTS gmail_messages_thread_idx
  ON gmail_messages(account_email, thread_id, internal_date);
CREATE INDEX IF NOT EXISTS gmail_messages_rfc_id_idx
  ON gmail_messages(account_email, rfc_message_id);
`

const migrationV7 = `
CREATE TABLE IF NOT EXISTS job_case_extractions (
  review_id TEXT PRIMARY KEY,
  account_email TEXT NOT NULL,
  gmail_message_id TEXT NOT NULL,
  draft_json TEXT NOT NULL,
  extraction_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(account_email, gmail_message_id),
  FOREIGN KEY(account_email, gmail_message_id)
    REFERENCES gmail_messages(account_email, gmail_message_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS job_case_review_states (
  review_id TEXT PRIMARY KEY REFERENCES job_case_extractions(review_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('awaiting-review', 'completed')),
  privacy_reviewed INTEGER NOT NULL DEFAULT 0 CHECK (privacy_reviewed IN (0, 1)),
  revision INTEGER NOT NULL CHECK (revision > 0),
  reviewer_id TEXT,
  reviewer_display_name TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_case_field_review_audits (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES job_case_extractions(review_id) ON DELETE CASCADE,
  review_revision INTEGER NOT NULL,
  field_key TEXT NOT NULL,
  original_value TEXT,
  confirmed_value TEXT,
  change_reason TEXT,
  source_labels_json TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  UNIQUE(review_id, review_revision, field_key)
);
CREATE INDEX IF NOT EXISTS job_case_field_audits_review_idx
  ON job_case_field_review_audits(review_id, review_revision);

CREATE TABLE IF NOT EXISTS job_cases (
  id TEXT PRIMARY KEY,
  source_review_id TEXT NOT NULL REFERENCES job_case_extractions(review_id),
  version INTEGER NOT NULL CHECK (version > 0),
  case_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded')),
  confirmed_at TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  UNIQUE(source_review_id, version)
);
CREATE INDEX IF NOT EXISTS job_cases_source_idx
  ON job_cases(source_review_id, version DESC);
CREATE INDEX IF NOT EXISTS job_cases_status_idx
  ON job_cases(status, confirmed_at DESC);
`

const migrationV8 = `
CREATE TABLE IF NOT EXISTS candidate_lifecycle (
  source_document_id TEXT PRIMARY KEY REFERENCES staged_files(token) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
  reason TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS candidate_lifecycle_state_idx
  ON candidate_lifecycle(state, changed_at DESC);

CREATE TABLE IF NOT EXISTS data_deletion_reports (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type = 'candidate'),
  entity_id_hash TEXT NOT NULL,
  report_json TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'partial-failure')),
  completed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS data_deletion_reports_completed_idx
  ON data_deletion_reports(completed_at DESC);
`

const migrationV9 = `
BEGIN IMMEDIATE;

CREATE TABLE job_case_sources (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('gmail', 'manual')),
  provider_account TEXT,
  provider_message_id TEXT,
  thread_id TEXT NOT NULL,
  from_domain TEXT,
  message_date TEXT NOT NULL,
  redacted_subject TEXT NOT NULL,
  redacted_body TEXT NOT NULL,
  redaction_session_id TEXT NOT NULL REFERENCES redaction_sessions(id),
  warning_codes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(provider_account, provider_message_id),
  CHECK (
    (source_type = 'gmail' AND provider_account IS NOT NULL AND provider_message_id IS NOT NULL) OR
    (source_type = 'manual' AND provider_account IS NULL AND provider_message_id IS NULL)
  ),
  FOREIGN KEY(provider_account, provider_message_id)
    REFERENCES gmail_messages(account_email, gmail_message_id) ON DELETE CASCADE
);

INSERT INTO job_case_sources(
  id, source_type, provider_account, provider_message_id, thread_id, from_domain,
  message_date, redacted_subject, redacted_body, redaction_session_id,
  warning_codes_json, created_at
)
SELECT extraction.review_id, 'gmail', extraction.account_email, extraction.gmail_message_id,
       message.thread_id, message.from_domain, message.internal_date, message.redacted_subject,
       message.redacted_body, message.redaction_session_id, message.warning_codes_json,
       extraction.created_at
FROM job_case_extractions extraction
JOIN gmail_messages message
  ON message.account_email = extraction.account_email
 AND message.gmail_message_id = extraction.gmail_message_id;

CREATE TABLE job_case_extractions_v9 (
  review_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL UNIQUE REFERENCES job_case_sources(id) ON DELETE CASCADE,
  draft_json TEXT NOT NULL,
  extraction_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO job_case_extractions_v9(
  review_id, source_id, draft_json, extraction_version, created_at, updated_at
)
SELECT review_id, review_id, draft_json, extraction_version, created_at, updated_at
FROM job_case_extractions;

DROP TABLE job_case_extractions;
ALTER TABLE job_case_extractions_v9 RENAME TO job_case_extractions;

CREATE INDEX job_case_sources_type_date_idx
  ON job_case_sources(source_type, message_date DESC);

INSERT INTO schema_migrations(version, applied_at)
VALUES (9, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV10 = `
BEGIN IMMEDIATE;

CREATE TABLE job_case_lifecycle (
  source_review_id TEXT PRIMARY KEY REFERENCES job_case_extractions(review_id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
  reason TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE INDEX job_case_lifecycle_state_idx
  ON job_case_lifecycle(state, changed_at DESC);

INSERT INTO job_case_lifecycle(source_review_id, state, reason, changed_by, changed_at)
SELECT source_review_id, 'active', 'Schema v10 lifecycle backfill', 'system', max(confirmed_at)
FROM job_cases
GROUP BY source_review_id;

CREATE TABLE job_case_events (
  id TEXT PRIMARY KEY,
  source_review_id TEXT NOT NULL REFERENCES job_case_extractions(review_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('archived', 'restored', 'revision-opened')),
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  review_revision INTEGER NOT NULL CHECK (review_revision > 0),
  created_at TEXT NOT NULL
);
CREATE INDEX job_case_events_review_idx
  ON job_case_events(source_review_id, created_at DESC);

CREATE TABLE gmail_message_tombstones (
  account_email TEXT NOT NULL,
  gmail_message_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY(account_email, gmail_message_id)
);

CREATE TABLE data_deletion_reports_v10 (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('candidate', 'job_case')),
  entity_id_hash TEXT NOT NULL,
  report_json TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'partial-failure')),
  completed_at TEXT NOT NULL
);
INSERT INTO data_deletion_reports_v10(
  id, entity_type, entity_id_hash, report_json, outcome, completed_at
)
SELECT id, entity_type, entity_id_hash, report_json, outcome, completed_at
FROM data_deletion_reports;
DROP TABLE data_deletion_reports;
ALTER TABLE data_deletion_reports_v10 RENAME TO data_deletion_reports;
CREATE INDEX data_deletion_reports_completed_idx
  ON data_deletion_reports(completed_at DESC);

INSERT INTO schema_migrations(version, applied_at)
VALUES (10, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV11 = `
BEGIN IMMEDIATE;

CREATE TABLE proposal_drafts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  job_case_id TEXT NOT NULL REFERENCES job_cases(id) ON DELETE CASCADE,
  candidate_profile_id TEXT NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('awaiting_review', 'approved', 'exported', 'export_unknown')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  content_hash TEXT NOT NULL,
  approved_content_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(task_id, job_case_id, candidate_profile_id)
);
CREATE INDEX proposal_drafts_task_idx ON proposal_drafts(task_id, updated_at DESC);
CREATE INDEX proposal_drafts_case_idx ON proposal_drafts(job_case_id);
CREATE INDEX proposal_drafts_candidate_idx ON proposal_drafts(candidate_profile_id);

CREATE TABLE proposal_events (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES proposal_drafts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created', 'updated', 'approved', 'export-started', 'exported', 'export-failed', 'export-unknown'
  )),
  content_hash TEXT NOT NULL,
  actor TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX proposal_events_draft_idx ON proposal_events(draft_id, created_at DESC);

CREATE TABLE proposal_exports (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES proposal_drafts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('preparing', 'completed', 'failed', 'unknown')),
  target_path_hash TEXT NOT NULL,
  package_hash TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX proposal_exports_draft_idx ON proposal_exports(draft_id, created_at DESC);

INSERT INTO schema_migrations(version, applied_at)
VALUES (11, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV12 = `
BEGIN IMMEDIATE;

CREATE TABLE recovery_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('backup-created', 'restore-completed', 'restore-failed')),
  backup_id TEXT NOT NULL,
  package_hash TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX recovery_events_type_created_idx
  ON recovery_events(event_type, created_at DESC);

INSERT INTO schema_migrations(version, applied_at)
VALUES (12, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV13 = `
BEGIN IMMEDIATE;

CREATE TABLE job_case_sources_v13 (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('gmail', 'manual', 'eml')),
  provider_account TEXT,
  provider_message_id TEXT,
  thread_id TEXT NOT NULL,
  from_domain TEXT,
  message_date TEXT NOT NULL,
  redacted_subject TEXT NOT NULL,
  redacted_body TEXT NOT NULL,
  redaction_session_id TEXT NOT NULL REFERENCES redaction_sessions(id),
  warning_codes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(provider_account, provider_message_id),
  CHECK (
    (source_type = 'gmail' AND provider_account IS NOT NULL AND provider_message_id IS NOT NULL) OR
    (source_type = 'manual' AND provider_account IS NULL AND provider_message_id IS NULL) OR
    (source_type = 'eml' AND provider_account IS NULL AND provider_message_id IS NOT NULL)
  ),
  FOREIGN KEY(provider_account, provider_message_id)
    REFERENCES gmail_messages(account_email, gmail_message_id) ON DELETE CASCADE
);

INSERT INTO job_case_sources_v13(
  id, source_type, provider_account, provider_message_id, thread_id, from_domain,
  message_date, redacted_subject, redacted_body, redaction_session_id,
  warning_codes_json, created_at
)
SELECT id, source_type, provider_account, provider_message_id, thread_id, from_domain,
       message_date, redacted_subject, redacted_body, redaction_session_id,
       warning_codes_json, created_at
FROM job_case_sources;

DROP TABLE job_case_sources;
ALTER TABLE job_case_sources_v13 RENAME TO job_case_sources;

CREATE INDEX job_case_sources_type_date_idx
  ON job_case_sources(source_type, message_date DESC);
CREATE UNIQUE INDEX job_case_sources_eml_message_idx
  ON job_case_sources(provider_message_id)
  WHERE source_type = 'eml';

INSERT INTO schema_migrations(version, applied_at)
VALUES (13, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const backupTrackedTables = [
  'work_tasks',
  'redaction_sessions',
  'local_pii_mappings',
  'cloud_call_audits',
  'change_outbox',
  'staged_files',
  'parsed_documents',
  'candidate_extractions',
  'candidate_review_states',
  'candidate_field_review_audits',
  'candidate_profiles',
  'gmail_sync_states',
  'gmail_messages',
  'gmail_message_tombstones',
  'job_case_sources',
  'job_case_extractions',
  'job_case_review_states',
  'job_case_field_review_audits',
  'job_cases',
  'job_case_lifecycle',
  'job_case_events',
  'proposal_drafts',
  'proposal_events',
  'proposal_exports',
  'data_deletion_reports'
] as const

const backupRevisionTriggers = backupTrackedTables.flatMap((table) =>
  (['INSERT', 'UPDATE', 'DELETE'] as const).map((operation) => {
    const rowReference = operation === 'DELETE' ? 'OLD' : 'NEW'
    const condition = table === 'work_tasks'
      ? `\nWHEN ${rowReference}.id NOT LIKE 'task-sample-%'`
      : table === 'change_outbox'
        ? `\nWHEN NOT (${rowReference}.entity_type = 'work_task' AND ${rowReference}.entity_id LIKE 'task-sample-%')`
        : ''
    return `
CREATE TRIGGER backup_revision_${table}_${operation.toLowerCase()}
AFTER ${operation} ON ${table}
${condition}
BEGIN
  UPDATE local_data_revision
  SET revision = revision + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE singleton = 1;
END;`
  })
).join('\n')

const migrationV14 = `
BEGIN IMMEDIATE;

ALTER TABLE recovery_events
  ADD COLUMN data_revision INTEGER NOT NULL DEFAULT 0 CHECK (data_revision >= 0);

CREATE TABLE local_data_revision (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  updated_at TEXT
);

INSERT INTO local_data_revision(singleton, revision, updated_at)
SELECT 1,
       CASE WHEN
         EXISTS(SELECT 1 FROM work_tasks WHERE id NOT LIKE 'task-sample-%' LIMIT 1) OR
         EXISTS(SELECT 1 FROM staged_files LIMIT 1) OR
         EXISTS(SELECT 1 FROM gmail_messages LIMIT 1) OR
         EXISTS(SELECT 1 FROM job_case_sources LIMIT 1) OR
         EXISTS(SELECT 1 FROM candidate_profiles LIMIT 1) OR
         EXISTS(SELECT 1 FROM proposal_drafts LIMIT 1) OR
         EXISTS(SELECT 1 FROM data_deletion_reports LIMIT 1)
       THEN 1 ELSE 0 END,
       CASE WHEN
         EXISTS(SELECT 1 FROM work_tasks WHERE id NOT LIKE 'task-sample-%' LIMIT 1) OR
         EXISTS(SELECT 1 FROM staged_files LIMIT 1) OR
         EXISTS(SELECT 1 FROM gmail_messages LIMIT 1) OR
         EXISTS(SELECT 1 FROM job_case_sources LIMIT 1) OR
         EXISTS(SELECT 1 FROM candidate_profiles LIMIT 1) OR
         EXISTS(SELECT 1 FROM proposal_drafts LIMIT 1) OR
         EXISTS(SELECT 1 FROM data_deletion_reports LIMIT 1)
       THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END;

CREATE TABLE recovery_reminder_preferences (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  snoozed_until TEXT,
  snoozed_revision INTEGER CHECK (snoozed_revision IS NULL OR snoozed_revision >= 0),
  updated_at TEXT NOT NULL,
  CHECK (
    (snoozed_until IS NULL AND snoozed_revision IS NULL) OR
    (snoozed_until IS NOT NULL AND snoozed_revision IS NOT NULL)
  )
);

INSERT INTO recovery_reminder_preferences(singleton, snoozed_until, snoozed_revision, updated_at)
VALUES (1, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

${backupRevisionTriggers}

INSERT INTO schema_migrations(version, applied_at)
VALUES (14, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV15 = `
BEGIN IMMEDIATE;

CREATE TABLE candidate_profile_embeddings (
  profile_id TEXT NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  model_revision TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  vector_dimension INTEGER NOT NULL CHECK (vector_dimension > 0),
  vector_blob BLOB NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(profile_id, model_id, model_revision),
  CHECK (length(vector_blob) = vector_dimension * 4)
);
CREATE INDEX candidate_profile_embeddings_model_idx
  ON candidate_profile_embeddings(model_id, model_revision, updated_at);

INSERT INTO schema_migrations(version, applied_at)
VALUES (15, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV16 = `
BEGIN IMMEDIATE;

CREATE TABLE candidate_project_review_audits (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES candidate_extractions(document_id) ON DELETE CASCADE,
  review_revision INTEGER NOT NULL CHECK (review_revision > 0),
  draft_id TEXT NOT NULL,
  project_id TEXT,
  original_json TEXT,
  confirmed_json TEXT,
  change_reason TEXT,
  source_labels_json TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  CHECK (original_json IS NOT NULL OR confirmed_json IS NOT NULL)
);
CREATE INDEX candidate_project_review_audits_document_idx
  ON candidate_project_review_audits(document_id, review_revision);

CREATE TABLE candidate_project_embeddings (
  profile_id TEXT NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_revision TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  vector_dimension INTEGER NOT NULL CHECK (vector_dimension > 0),
  vector_blob BLOB NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(profile_id, project_id, model_id, model_revision),
  CHECK (length(vector_blob) = vector_dimension * 4)
);
CREATE INDEX candidate_project_embeddings_model_idx
  ON candidate_project_embeddings(model_id, model_revision, updated_at);

INSERT INTO schema_migrations(version, applied_at)
VALUES (16, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV17 = `
BEGIN IMMEDIATE;

CREATE TABLE candidate_match_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  query_text TEXT NOT NULL,
  algorithm_version TEXT NOT NULL CHECK (algorithm_version IN (
    'hard-filter-bm25-v1', 'hard-filter-hybrid-rrf-v1'
  )),
  result_set_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(task_id, result_set_hash)
);
CREATE INDEX candidate_match_runs_task_idx
  ON candidate_match_runs(task_id, created_at DESC);

CREATE TABLE candidate_match_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES candidate_match_runs(id) ON DELETE CASCADE,
  candidate_profile_id TEXT NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  candidate_profile_version INTEGER NOT NULL CHECK (candidate_profile_version > 0),
  result_rank INTEGER NOT NULL CHECK (result_rank > 0),
  result_hash TEXT NOT NULL,
  feedback_decision TEXT CHECK (feedback_decision IS NULL OR feedback_decision IN ('suitable', 'unsuitable')),
  feedback_reason TEXT,
  feedback_note TEXT,
  feedback_revision INTEGER NOT NULL DEFAULT 0 CHECK (feedback_revision >= 0),
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, candidate_profile_id),
  CHECK (
    (feedback_decision IS NULL AND feedback_reason IS NULL AND feedback_note IS NULL AND feedback_revision = 0 AND reviewed_by IS NULL AND reviewed_at IS NULL) OR
    (feedback_decision IS NOT NULL AND feedback_reason IS NOT NULL AND feedback_revision > 0 AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);
CREATE INDEX candidate_match_results_run_rank_idx
  ON candidate_match_results(run_id, result_rank);
CREATE INDEX candidate_match_results_profile_idx
  ON candidate_match_results(candidate_profile_id, updated_at DESC);

CREATE TRIGGER backup_revision_candidate_match_runs_insert AFTER INSERT ON candidate_match_runs
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_match_runs_update AFTER UPDATE ON candidate_match_runs
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_match_runs_delete AFTER DELETE ON candidate_match_runs
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_match_results_insert AFTER INSERT ON candidate_match_results
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_match_results_update AFTER UPDATE ON candidate_match_results
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_match_results_delete AFTER DELETE ON candidate_match_results
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (17, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV18 = `
BEGIN IMMEDIATE;

CREATE TABLE candidate_evaluation_datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dataset_hash TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK (case_count > 0),
  relevant_candidate_count INTEGER NOT NULL CHECK (relevant_candidate_count > 0),
  reviewer_count INTEGER NOT NULL CHECK (reviewer_count > 0),
  imported_at TEXT NOT NULL
);

CREATE TABLE candidate_evaluation_reports (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES candidate_evaluation_datasets(id) ON DELETE CASCADE,
  dataset_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'insufficient-cases', 'invalid-references')),
  report_json TEXT NOT NULL,
  evaluated_at TEXT NOT NULL
);
CREATE INDEX candidate_evaluation_reports_dataset_idx
  ON candidate_evaluation_reports(dataset_id, evaluated_at DESC);

CREATE TRIGGER backup_revision_candidate_evaluation_datasets_insert AFTER INSERT ON candidate_evaluation_datasets
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_evaluation_datasets_update AFTER UPDATE ON candidate_evaluation_datasets
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_evaluation_datasets_delete AFTER DELETE ON candidate_evaluation_datasets
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_evaluation_reports_insert AFTER INSERT ON candidate_evaluation_reports
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_evaluation_reports_update AFTER UPDATE ON candidate_evaluation_reports
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_evaluation_reports_delete AFTER DELETE ON candidate_evaluation_reports
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (18, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV19 = `
BEGIN IMMEDIATE;

ALTER TABLE candidate_match_runs
  ADD COLUMN hard_filter_policy_version TEXT NOT NULL DEFAULT 'fail-closed-v1'
  CHECK (hard_filter_policy_version IN ('fail-closed-v1', 'tri-state-v2'));

INSERT INTO schema_migrations(version, applied_at)
VALUES (19, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV20 = `
BEGIN IMMEDIATE;

CREATE TABLE candidate_evaluation_drafts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE candidate_evaluation_draft_cases (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES candidate_evaluation_drafts(id) ON DELETE CASCADE,
  job_case_id TEXT NOT NULL REFERENCES job_cases(id) ON DELETE CASCADE,
  job_case_version INTEGER NOT NULL CHECK (job_case_version > 0),
  job_case_title TEXT NOT NULL,
  query_text TEXT NOT NULL,
  pool_reviewed INTEGER NOT NULL CHECK (pool_reviewed = 1),
  reviewer_id TEXT NOT NULL,
  reviewer_display_name TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(draft_id, job_case_id)
);
CREATE INDEX candidate_evaluation_draft_cases_draft_idx
  ON candidate_evaluation_draft_cases(draft_id, reviewed_at DESC);

CREATE TABLE candidate_evaluation_draft_labels (
  case_id TEXT NOT NULL REFERENCES candidate_evaluation_draft_cases(id) ON DELETE CASCADE,
  candidate_profile_id TEXT NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  candidate_profile_version INTEGER NOT NULL CHECK (candidate_profile_version > 0),
  expected_project_evidence INTEGER NOT NULL CHECK (expected_project_evidence IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(case_id, candidate_profile_id)
);
CREATE INDEX candidate_evaluation_draft_labels_profile_idx
  ON candidate_evaluation_draft_labels(candidate_profile_id, case_id);

CREATE TRIGGER backup_revision_candidate_evaluation_drafts_insert AFTER INSERT ON candidate_evaluation_drafts
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_evaluation_drafts_update AFTER UPDATE ON candidate_evaluation_drafts
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_evaluation_drafts_delete AFTER DELETE ON candidate_evaluation_drafts
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_evaluation_draft_cases_insert AFTER INSERT ON candidate_evaluation_draft_cases
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_evaluation_draft_cases_update AFTER UPDATE ON candidate_evaluation_draft_cases
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_evaluation_draft_cases_delete AFTER DELETE ON candidate_evaluation_draft_cases
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_evaluation_draft_labels_insert AFTER INSERT ON candidate_evaluation_draft_labels
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_evaluation_draft_labels_update AFTER UPDATE ON candidate_evaluation_draft_labels
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_evaluation_draft_labels_delete AFTER DELETE ON candidate_evaluation_draft_labels
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (20, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV21 = `
BEGIN IMMEDIATE;

CREATE TABLE google_workspace_admin_configuration (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  client_id TEXT NOT NULL,
  workspace_domain TEXT NOT NULL,
  label_ids_json TEXT NOT NULL,
  query_text TEXT NOT NULL,
  lookback_days INTEGER NOT NULL CHECK (lookback_days BETWEEN 1 AND 365),
  max_messages_per_run INTEGER NOT NULL CHECK (max_messages_per_run BETWEEN 1 AND 500),
  revision INTEGER NOT NULL CHECK (revision > 0),
  configured_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER backup_revision_google_workspace_admin_configuration_insert AFTER INSERT ON google_workspace_admin_configuration
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_google_workspace_admin_configuration_update AFTER UPDATE ON google_workspace_admin_configuration
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_google_workspace_admin_configuration_delete AFTER DELETE ON google_workspace_admin_configuration
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (21, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV22 = `
BEGIN IMMEDIATE;

CREATE TABLE processing_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL CHECK (job_type IN ('candidate-match', 'resume-analysis', 'proposal-export')),
  work_task_id TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  task_step_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  payload_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'retry_wait', 'failed', 'cancelled')),
  replay_policy TEXT NOT NULL CHECK (replay_policy IN ('safe-local', 'manual-review')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
  next_retry_at TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  cancel_requested_at TEXT,
  error_code TEXT,
  result_json TEXT,
  result_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK (status = 'running' OR (lease_token IS NULL AND lease_expires_at IS NULL)),
  CHECK ((result_json IS NULL) = (result_hash IS NULL)),
  CHECK (status != 'succeeded' OR (progress = 100 AND result_json IS NOT NULL AND result_hash IS NOT NULL)),
  CHECK (status != 'cancelled' OR cancel_requested_at IS NOT NULL)
);
CREATE INDEX processing_jobs_task_idx ON processing_jobs(work_task_id, created_at DESC);
CREATE INDEX processing_jobs_dispatch_idx ON processing_jobs(status, next_retry_at, created_at);

CREATE TRIGGER backup_revision_processing_jobs_insert AFTER INSERT ON processing_jobs
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_processing_jobs_update AFTER UPDATE ON processing_jobs
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_processing_jobs_delete AFTER DELETE ON processing_jobs
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (22, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV23 = `
BEGIN IMMEDIATE;

CREATE TABLE google_workspace_acceptance_reports (
  id TEXT PRIMARY KEY,
  configuration_fingerprint TEXT NOT NULL CHECK (length(configuration_fingerprint) = 64),
  report_json TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('passed', 'action-required')),
  checked_at TEXT NOT NULL
);
CREATE INDEX google_workspace_acceptance_reports_checked_idx
  ON google_workspace_acceptance_reports(checked_at DESC, id DESC);

CREATE TRIGGER backup_revision_google_workspace_acceptance_reports_insert AFTER INSERT ON google_workspace_acceptance_reports
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_google_workspace_acceptance_reports_update AFTER UPDATE ON google_workspace_acceptance_reports
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_google_workspace_acceptance_reports_delete AFTER DELETE ON google_workspace_acceptance_reports
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (23, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV24 = `
BEGIN IMMEDIATE;

CREATE TABLE candidate_match_runs_v24 (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  query_text TEXT NOT NULL,
  algorithm_version TEXT NOT NULL CHECK (algorithm_version IN (
    'hard-filter-bm25-v1', 'hard-filter-hybrid-rrf-v1'
  )),
  result_set_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  hard_filter_policy_version TEXT NOT NULL DEFAULT 'fail-closed-v1'
    CHECK (hard_filter_policy_version IN ('fail-closed-v1', 'tri-state-v2', 'tri-state-v3')),
  UNIQUE(task_id, result_set_hash)
);

INSERT INTO candidate_match_runs_v24(
  id, task_id, query_text, algorithm_version, result_set_hash,
  created_at, updated_at, hard_filter_policy_version
)
SELECT id, task_id, query_text, algorithm_version, result_set_hash,
       created_at, updated_at, hard_filter_policy_version
FROM candidate_match_runs;

DROP TABLE candidate_match_runs;
ALTER TABLE candidate_match_runs_v24 RENAME TO candidate_match_runs;
CREATE INDEX candidate_match_runs_task_idx
  ON candidate_match_runs(task_id, created_at DESC);

CREATE TRIGGER backup_revision_candidate_match_runs_insert AFTER INSERT ON candidate_match_runs
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_match_runs_update AFTER UPDATE ON candidate_match_runs
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_match_runs_delete AFTER DELETE ON candidate_match_runs
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (24, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV25 = `
BEGIN IMMEDIATE;

CREATE TABLE candidate_match_runs_v25 (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  query_text TEXT NOT NULL,
  algorithm_version TEXT NOT NULL CHECK (algorithm_version IN (
    'hard-filter-bm25-v1', 'hard-filter-hybrid-rrf-v1', 'hard-filter-hybrid-local-rerank-v1'
  )),
  result_set_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  hard_filter_policy_version TEXT NOT NULL DEFAULT 'fail-closed-v1'
    CHECK (hard_filter_policy_version IN ('fail-closed-v1', 'tri-state-v2', 'tri-state-v3')),
  UNIQUE(task_id, result_set_hash)
);

INSERT INTO candidate_match_runs_v25(
  id, task_id, query_text, algorithm_version, result_set_hash,
  created_at, updated_at, hard_filter_policy_version
)
SELECT id, task_id, query_text, algorithm_version, result_set_hash,
       created_at, updated_at, hard_filter_policy_version
FROM candidate_match_runs;

DROP TABLE candidate_match_runs;
ALTER TABLE candidate_match_runs_v25 RENAME TO candidate_match_runs;
CREATE INDEX candidate_match_runs_task_idx
  ON candidate_match_runs(task_id, created_at DESC);

CREATE TRIGGER backup_revision_candidate_match_runs_insert AFTER INSERT ON candidate_match_runs
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_match_runs_update AFTER UPDATE ON candidate_match_runs
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_match_runs_delete AFTER DELETE ON candidate_match_runs
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (25, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV26 = `
BEGIN IMMEDIATE;

CREATE TABLE local_operator_profile (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  operator_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role_label TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER backup_revision_local_operator_profile_insert AFTER INSERT ON local_operator_profile
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_local_operator_profile_update AFTER UPDATE ON local_operator_profile
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_local_operator_profile_delete AFTER DELETE ON local_operator_profile
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (26, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV27 = `
BEGIN IMMEDIATE;

CREATE TABLE proposal_follow_up_events (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES proposal_drafts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  stage TEXT NOT NULL CHECK (stage IN (
    'sent', 'replied', 'interview', 'accepted', 'declined', 'withdrawn'
  )),
  occurred_on TEXT NOT NULL,
  note TEXT,
  actor TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  cloud_eligible INTEGER NOT NULL DEFAULT 0 CHECK (cloud_eligible = 0),
  UNIQUE(draft_id, revision)
);
CREATE INDEX proposal_follow_up_events_draft_idx
  ON proposal_follow_up_events(draft_id, revision ASC);

CREATE TRIGGER backup_revision_proposal_follow_up_events_insert AFTER INSERT ON proposal_follow_up_events
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_proposal_follow_up_events_update AFTER UPDATE ON proposal_follow_up_events
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_proposal_follow_up_events_delete AFTER DELETE ON proposal_follow_up_events
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (27, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV28 = `
BEGIN IMMEDIATE;

CREATE TABLE local_application_preferences (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  locale TEXT NOT NULL CHECK (locale IN ('ja-JP', 'zh-CN')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER backup_revision_local_application_preferences_insert AFTER INSERT ON local_application_preferences
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_local_application_preferences_update AFTER UPDATE ON local_application_preferences
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_local_application_preferences_delete AFTER DELETE ON local_application_preferences
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (28, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV29 = `
BEGIN IMMEDIATE;

CREATE TABLE candidate_interviews (
  source_document_id TEXT PRIMARY KEY REFERENCES candidate_review_states(document_id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN (
    'new', 'contacting', 'scheduled', 'interviewing', 'awaiting-decision', 'on-hold', 'passed', 'closed'
  )),
  scheduled_at TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes IN (30, 45, 60, 90)),
  meeting_method TEXT NOT NULL DEFAULT 'google-meet' CHECK (meeting_method IN ('google-meet', 'phone', 'onsite')),
  interviewer TEXT,
  contact_note TEXT,
  interview_notes TEXT,
  decision TEXT CHECK (decision IN ('passed', 'on-hold', 'failed', 'no-show', 'withdrawn')),
  decision_reason TEXT,
  decided_at TEXT,
  decided_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  cloud_eligible INTEGER NOT NULL DEFAULT 0 CHECK (cloud_eligible = 0),
  CHECK ((decision IS NULL AND decision_reason IS NULL AND decided_at IS NULL AND decided_by IS NULL) OR
         (decision IS NOT NULL AND decision_reason IS NOT NULL AND decided_at IS NOT NULL AND decided_by IS NOT NULL))
);
CREATE INDEX candidate_interviews_stage_schedule_idx
  ON candidate_interviews(stage, scheduled_at ASC, updated_at DESC);

CREATE TRIGGER backup_revision_candidate_interviews_insert AFTER INSERT ON candidate_interviews
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_interviews_update AFTER UPDATE ON candidate_interviews
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_interviews_delete AFTER DELETE ON candidate_interviews
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (29, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV30 = `
BEGIN IMMEDIATE;

CREATE TABLE candidate_interview_sessions (
  id TEXT PRIMARY KEY,
  source_document_id TEXT NOT NULL REFERENCES candidate_review_states(document_id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'recruiting' CHECK (kind IN ('recruiting', 'client')),
  round_number INTEGER NOT NULL DEFAULT 1 CHECK (round_number > 0 AND round_number <= 20),
  parent_interview_id TEXT REFERENCES candidate_interview_sessions(id) ON DELETE SET NULL,
  stage TEXT NOT NULL CHECK (stage IN (
    'new', 'contacting', 'scheduled', 'interviewing', 'awaiting-decision', 'on-hold', 'passed', 'closed'
  )),
  scheduled_at TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes IN (30, 45, 60, 90)),
  meeting_method TEXT NOT NULL DEFAULT 'zoom' CHECK (meeting_method IN ('zoom', 'google-meet', 'phone', 'onsite')),
  meeting_url TEXT,
  interviewer TEXT,
  contact_note TEXT,
  interview_goal TEXT,
  question_plan_json TEXT NOT NULL DEFAULT '[]',
  interview_notes TEXT,
  unresolved_items_json TEXT NOT NULL DEFAULT '[]',
  decision TEXT CHECK (decision IN ('passed', 'next-round', 'on-hold', 'failed', 'no-show', 'withdrawn')),
  decision_reason TEXT,
  decided_at TEXT,
  decided_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  cloud_eligible INTEGER NOT NULL DEFAULT 0 CHECK (cloud_eligible = 0),
  UNIQUE(source_document_id, kind, round_number),
  CHECK ((decision IS NULL AND decision_reason IS NULL AND decided_at IS NULL AND decided_by IS NULL) OR
         (decision IS NOT NULL AND decision_reason IS NOT NULL AND decided_at IS NOT NULL AND decided_by IS NOT NULL))
);

INSERT OR IGNORE INTO candidate_interview_sessions(
  id, source_document_id, kind, round_number, parent_interview_id, stage,
  scheduled_at, duration_minutes, meeting_method, meeting_url, interviewer,
  contact_note, interview_goal, question_plan_json, interview_notes, unresolved_items_json,
  decision, decision_reason, decided_at, decided_by, created_at, updated_at, updated_by, cloud_eligible
)
SELECT source_document_id, source_document_id, 'recruiting', 1, NULL, stage,
       scheduled_at, duration_minutes,
       CASE WHEN meeting_method = 'google-meet' THEN 'google-meet' ELSE meeting_method END,
       NULL, interviewer, contact_note, NULL, '[]', interview_notes, '[]',
       decision, decision_reason, decided_at, decided_by, created_at, updated_at, updated_by, 0
FROM candidate_interviews;

CREATE INDEX candidate_interview_sessions_candidate_idx
  ON candidate_interview_sessions(source_document_id, kind, round_number DESC);
CREATE INDEX candidate_interview_sessions_stage_schedule_idx
  ON candidate_interview_sessions(stage, scheduled_at ASC, updated_at DESC);

CREATE TRIGGER backup_revision_candidate_interview_sessions_insert AFTER INSERT ON candidate_interview_sessions
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_interview_sessions_update AFTER UPDATE ON candidate_interview_sessions
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_interview_sessions_delete AFTER DELETE ON candidate_interview_sessions
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (30, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

// v31 makes preparation an explicit workflow state and retains the local-only
// details required by telephone / onsite scheduling. SQLite cannot alter a
// CHECK constraint in place, so the session table is rebuilt atomically.
const migrationV31 = `
BEGIN IMMEDIATE;

DROP TRIGGER IF EXISTS backup_revision_candidate_interview_sessions_insert;
DROP TRIGGER IF EXISTS backup_revision_candidate_interview_sessions_update;
DROP TRIGGER IF EXISTS backup_revision_candidate_interview_sessions_delete;

CREATE TABLE candidate_interview_sessions_v31 (
  id TEXT PRIMARY KEY,
  source_document_id TEXT NOT NULL REFERENCES candidate_review_states(document_id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'recruiting' CHECK (kind IN ('recruiting', 'client')),
  round_number INTEGER NOT NULL DEFAULT 1 CHECK (round_number > 0 AND round_number <= 20),
  parent_interview_id TEXT REFERENCES candidate_interview_sessions_v31(id) ON DELETE SET NULL,
  stage TEXT NOT NULL CHECK (stage IN (
    'new', 'contacting', 'scheduled', 'prepared', 'interviewing', 'awaiting-decision', 'on-hold', 'passed', 'closed'
  )),
  scheduled_at TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes IN (30, 45, 60, 90)),
  meeting_method TEXT NOT NULL DEFAULT 'zoom' CHECK (meeting_method IN ('zoom', 'google-meet', 'phone', 'onsite')),
  meeting_url TEXT,
  meeting_details_json TEXT NOT NULL DEFAULT '{}',
  interviewer TEXT,
  contact_note TEXT,
  interview_goal TEXT,
  question_plan_json TEXT NOT NULL DEFAULT '[]',
  interview_notes TEXT,
  unresolved_items_json TEXT NOT NULL DEFAULT '[]',
  decision TEXT CHECK (decision IN ('passed', 'next-round', 'on-hold', 'failed', 'no-show', 'withdrawn')),
  decision_reason TEXT,
  decided_at TEXT,
  decided_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  cloud_eligible INTEGER NOT NULL DEFAULT 0 CHECK (cloud_eligible = 0),
  UNIQUE(source_document_id, kind, round_number),
  CHECK ((decision IS NULL AND decision_reason IS NULL AND decided_at IS NULL AND decided_by IS NULL) OR
         (decision IS NOT NULL AND decision_reason IS NOT NULL AND decided_at IS NOT NULL AND decided_by IS NOT NULL))
);

INSERT INTO candidate_interview_sessions_v31(
  id, source_document_id, kind, round_number, parent_interview_id, stage,
  scheduled_at, duration_minutes, meeting_method, meeting_url, meeting_details_json, interviewer,
  contact_note, interview_goal, question_plan_json, interview_notes, unresolved_items_json,
  decision, decision_reason, decided_at, decided_by, created_at, updated_at, updated_by, cloud_eligible
)
SELECT id, source_document_id, kind, round_number, parent_interview_id,
       CASE WHEN stage = 'scheduled' AND question_plan_json != '[]' THEN 'prepared' ELSE stage END,
       scheduled_at, duration_minutes, meeting_method, meeting_url, '{}', interviewer,
       contact_note, interview_goal, question_plan_json, interview_notes, unresolved_items_json,
       decision, decision_reason, decided_at, decided_by, created_at, updated_at, updated_by, cloud_eligible
FROM candidate_interview_sessions
ORDER BY source_document_id, kind, round_number;

DROP TABLE candidate_interview_sessions;
ALTER TABLE candidate_interview_sessions_v31 RENAME TO candidate_interview_sessions;

CREATE INDEX candidate_interview_sessions_candidate_idx
  ON candidate_interview_sessions(source_document_id, kind, round_number DESC);
CREATE INDEX candidate_interview_sessions_stage_schedule_idx
  ON candidate_interview_sessions(stage, scheduled_at ASC, updated_at DESC);

CREATE TRIGGER backup_revision_candidate_interview_sessions_insert AFTER INSERT ON candidate_interview_sessions
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_interview_sessions_update AFTER UPDATE ON candidate_interview_sessions
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_interview_sessions_delete AFTER DELETE ON candidate_interview_sessions
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (31, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

// V32 is the complete action-runtime schema. During pre-release development we
// reset local data instead of carrying transitional action-runtime migrations.
const migrationV32 = `
BEGIN IMMEDIATE;

CREATE TABLE action_runs (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL CHECK (tool_name IN ('resume.analyze.local', 'candidate.match.local', 'gmail.sync.read', 'proposal.export')),
  tool_version INTEGER NOT NULL CHECK (tool_version = 1),
  work_task_id TEXT REFERENCES work_tasks(id) ON DELETE SET NULL,
  origin TEXT NOT NULL CHECK (origin IN ('work-task', 'user-command', 'managed-connector', 'system')),
  scope_id TEXT NOT NULL,
  scope_fingerprint TEXT NOT NULL CHECK (length(scope_fingerprint) = 64),
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
  content_revision TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'awaiting_approval', 'awaiting_foreground_confirmation', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'blocked')),
  idempotency_key TEXT NOT NULL,
  processing_job_id TEXT REFERENCES processing_jobs(id) ON DELETE SET NULL,
  result_hash TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tool_name, idempotency_key)
);
CREATE INDEX action_runs_task_idx ON action_runs(work_task_id, created_at DESC);
CREATE INDEX action_runs_status_idx ON action_runs(status, created_at DESC);

CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  action_run_id TEXT NOT NULL UNIQUE REFERENCES action_runs(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'cancelled')),
  reason TEXT NOT NULL,
  safe_summary TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  CHECK ((status IN ('approved', 'denied')) = (resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
);
CREATE INDEX approval_requests_inbox_idx ON approval_requests(status, expires_at, created_at DESC);

CREATE TABLE action_events (
  id TEXT PRIMARY KEY,
  action_run_id TEXT NOT NULL REFERENCES action_runs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('proposed', 'policy_evaluated', 'approval_requested', 'approval_resolved', 'approval_expired', 'execution_started', 'execution_finished', 'execution_failed', 'cancelled', 'blocked')),
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX action_events_run_idx ON action_events(action_run_id, created_at ASC);

CREATE TRIGGER backup_revision_action_runs_insert AFTER INSERT ON action_runs
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_action_runs_update AFTER UPDATE ON action_runs
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_action_runs_delete AFTER DELETE ON action_runs
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_approval_requests_insert AFTER INSERT ON approval_requests
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_approval_requests_update AFTER UPDATE ON approval_requests
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_approval_requests_delete AFTER DELETE ON approval_requests
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_action_events_insert AFTER INSERT ON action_events
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (32, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
COMMIT;
`

// Candidate records and talent-pool eligibility are intentionally separate.
// This development-only reset discards the former lifecycle model instead of
// attempting to reinterpret old active/archived values.
const migrationV33 = `
BEGIN IMMEDIATE;

DELETE FROM candidate_match_results;
DELETE FROM candidate_match_runs;
DELETE FROM candidate_profile_embeddings;
DELETE FROM candidate_project_embeddings;
DELETE FROM candidate_profiles;
DELETE FROM candidate_interviews;
DELETE FROM candidate_interview_sessions;
DELETE FROM candidate_field_review_audits;
DELETE FROM candidate_project_review_audits;
DELETE FROM candidate_review_states;
DELETE FROM candidate_extractions;
DROP TABLE IF EXISTS candidate_lifecycle;
DROP TABLE candidate_profiles;

CREATE TABLE candidate_profiles (
  id TEXT PRIMARY KEY,
  source_document_id TEXT NOT NULL REFERENCES parsed_documents(document_id),
  version INTEGER NOT NULL CHECK (version > 0),
  profile_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('current', 'stale', 'superseded')),
  confirmed_at TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  UNIQUE(source_document_id, version)
);
CREATE INDEX candidate_profiles_source_idx ON candidate_profiles(source_document_id, version DESC);
CREATE UNIQUE INDEX candidate_profiles_current_idx ON candidate_profiles(source_document_id) WHERE status = 'current';
CREATE TRIGGER backup_revision_candidate_profiles_insert AFTER INSERT ON candidate_profiles
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_profiles_update AFTER UPDATE ON candidate_profiles
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_profiles_delete AFTER DELETE ON candidate_profiles
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

CREATE TABLE candidate_records (
  source_document_id TEXT PRIMARY KEY REFERENCES staged_files(token) ON DELETE CASCADE,
  record_status TEXT NOT NULL CHECK (record_status IN ('active', 'archived', 'deleted')),
  recruiting_status TEXT NOT NULL CHECK (recruiting_status IN ('pending-review', 'ready-for-recruiting', 'recruiting', 'passed', 'rejected', 'withdrawn', 'no-show', 'on-hold')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX candidate_records_recruiting_idx ON candidate_records(recruiting_status, updated_at DESC);

CREATE TABLE talent_pool_memberships (
  source_document_id TEXT PRIMARY KEY REFERENCES candidate_records(source_document_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('eligible', 'suspended', 'removed')),
  admitted_interview_id TEXT REFERENCES candidate_interview_sessions(id) ON DELETE SET NULL,
  admitted_at TEXT NOT NULL,
  admitted_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX talent_pool_memberships_status_idx ON talent_pool_memberships(status, admitted_at DESC);
CREATE TRIGGER talent_pool_memberships_require_current_profile_insert
BEFORE INSERT ON talent_pool_memberships
WHEN NEW.status = 'eligible' AND NOT EXISTS (
  SELECT 1 FROM candidate_profiles
  WHERE source_document_id = NEW.source_document_id AND status = 'current'
)
BEGIN SELECT RAISE(ABORT, 'Eligible talent-pool membership requires a current candidate profile.'); END;
CREATE TRIGGER talent_pool_memberships_require_current_profile_update
BEFORE UPDATE OF status ON talent_pool_memberships
WHEN NEW.status = 'eligible' AND NOT EXISTS (
  SELECT 1 FROM candidate_profiles
  WHERE source_document_id = NEW.source_document_id AND status = 'current'
)
BEGIN SELECT RAISE(ABORT, 'Eligible talent-pool membership requires a current candidate profile.'); END;
CREATE TRIGGER backup_revision_candidate_records_insert AFTER INSERT ON candidate_records
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_records_update AFTER UPDATE ON candidate_records
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_candidate_records_delete AFTER DELETE ON candidate_records
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_talent_pool_memberships_insert AFTER INSERT ON talent_pool_memberships
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_talent_pool_memberships_update AFTER UPDATE ON talent_pool_memberships
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_talent_pool_memberships_delete AFTER DELETE ON talent_pool_memberships
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (33, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV34 = `
BEGIN IMMEDIATE;

CREATE TABLE ai_conversations (
  id TEXT PRIMARY KEY,
  assistant_type TEXT NOT NULL CHECK (assistant_type IN ('candidate-profile', 'interview')),
  context_key TEXT NOT NULL,
  candidate_document_id TEXT NOT NULL REFERENCES staged_files(token) ON DELETE CASCADE,
  interview_id TEXT REFERENCES candidate_interview_sessions(id) ON DELETE CASCADE,
  interview_kind TEXT CHECK (interview_kind IN ('recruiting', 'client')),
  round_number INTEGER CHECK (round_number BETWEEN 1 AND 20),
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ai_conversations_context_idx ON ai_conversations(context_key, updated_at DESC);
CREATE TRIGGER backup_revision_ai_conversations_insert AFTER INSERT ON ai_conversations
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_ai_conversations_update AFTER UPDATE ON ai_conversations
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_ai_conversations_delete AFTER DELETE ON ai_conversations
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (34, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV35 = `
BEGIN IMMEDIATE;

ALTER TABLE cloud_call_audits ADD COLUMN quality_gate_report_hash TEXT;
ALTER TABLE cloud_call_audits ADD COLUMN expert_attestation_hash TEXT;
ALTER TABLE cloud_call_audits ADD COLUMN review_ticket_hash TEXT;
ALTER TABLE cloud_call_audits ADD COLUMN review_ticket_status TEXT;
ALTER TABLE cloud_call_audits ADD COLUMN gate_policy_version TEXT;

INSERT INTO schema_migrations(version, applied_at)
VALUES (35, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV36 = `
BEGIN IMMEDIATE;

CREATE TABLE job_case_sources_v36 (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('gmail', 'manual', 'eml', 'chat-paste')),
  provider_account TEXT,
  provider_message_id TEXT,
  thread_id TEXT NOT NULL,
  from_domain TEXT,
  message_date TEXT NOT NULL,
  redacted_subject TEXT NOT NULL,
  redacted_body TEXT NOT NULL,
  redaction_session_id TEXT NOT NULL REFERENCES redaction_sessions(id),
  warning_codes_json TEXT NOT NULL,
  business_fingerprint TEXT CHECK (business_fingerprint IS NULL OR length(business_fingerprint) = 64),
  created_at TEXT NOT NULL,
  UNIQUE(provider_account, provider_message_id),
  CHECK (
    (source_type = 'gmail' AND provider_account IS NOT NULL AND provider_message_id IS NOT NULL) OR
    (source_type IN ('manual', 'chat-paste') AND provider_account IS NULL AND provider_message_id IS NULL) OR
    (source_type = 'eml' AND provider_account IS NULL AND provider_message_id IS NOT NULL)
  ),
  FOREIGN KEY(provider_account, provider_message_id)
    REFERENCES gmail_messages(account_email, gmail_message_id) ON DELETE CASCADE
);

INSERT INTO job_case_sources_v36(
  id, source_type, provider_account, provider_message_id, thread_id, from_domain,
  message_date, redacted_subject, redacted_body, redaction_session_id,
  warning_codes_json, business_fingerprint, created_at
)
SELECT id, source_type, provider_account, provider_message_id, thread_id, from_domain,
       message_date, redacted_subject, redacted_body, redaction_session_id,
       warning_codes_json, NULL, created_at
FROM job_case_sources;

DROP TABLE job_case_sources;
ALTER TABLE job_case_sources_v36 RENAME TO job_case_sources;
CREATE INDEX job_case_sources_type_date_idx ON job_case_sources(source_type, message_date DESC);
CREATE UNIQUE INDEX job_case_sources_eml_message_idx ON job_case_sources(provider_message_id)
  WHERE source_type = 'eml';
CREATE TRIGGER backup_revision_job_case_sources_insert AFTER INSERT ON job_case_sources
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_job_case_sources_update AFTER UPDATE ON job_case_sources
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_job_case_sources_delete AFTER DELETE ON job_case_sources
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

ALTER TABLE candidate_match_runs ADD COLUMN job_case_id TEXT REFERENCES job_cases(id) ON DELETE SET NULL;
ALTER TABLE candidate_match_runs ADD COLUMN job_case_version INTEGER;
ALTER TABLE candidate_match_runs ADD COLUMN candidate_pool_fingerprint TEXT;
ALTER TABLE candidate_match_runs ADD COLUMN candidate_profile_versions_json TEXT;
ALTER TABLE candidate_match_runs ADD COLUMN embedding_model_id TEXT;
ALTER TABLE candidate_match_runs ADD COLUMN embedding_model_revision TEXT;
ALTER TABLE candidate_match_runs ADD COLUMN reranker_model_id TEXT;
ALTER TABLE candidate_match_runs ADD COLUMN reranker_model_revision TEXT;
ALTER TABLE candidate_match_runs ADD COLUMN validity_policy_version TEXT;
ALTER TABLE candidate_match_runs ADD COLUMN invalidated_at TEXT;
ALTER TABLE candidate_match_runs ADD COLUMN invalidated_reason TEXT;
ALTER TABLE candidate_match_results ADD COLUMN result_snapshot_json TEXT;
CREATE INDEX candidate_match_runs_job_case_idx ON candidate_match_runs(job_case_id, created_at DESC);

CREATE TABLE business_priority_projections (
  id TEXT PRIMARY KEY,
  match_result_id TEXT NOT NULL REFERENCES candidate_match_results(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES candidate_match_runs(id) ON DELETE CASCADE,
  candidate_profile_id TEXT NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  rule_version TEXT NOT NULL CHECK (rule_version = 'business-priority-v1'),
  level TEXT NOT NULL CHECK (level IN ('high', 'normal', 'follow_up', 'paused')),
  reasons_json TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  input_snapshot_hash TEXT NOT NULL CHECK (length(input_snapshot_hash) = 64),
  generated_at TEXT NOT NULL,
  override_level TEXT CHECK (override_level IS NULL OR override_level IN ('high', 'normal', 'follow_up', 'paused')),
  override_reason TEXT,
  override_actor TEXT,
  override_expires_at TEXT,
  override_revision INTEGER NOT NULL DEFAULT 0 CHECK (override_revision >= 0),
  UNIQUE(match_result_id, rule_version, input_snapshot_hash),
  CHECK (
    (override_level IS NULL AND override_reason IS NULL AND override_actor IS NULL AND override_expires_at IS NULL AND override_revision = 0) OR
    (override_level IS NOT NULL AND override_reason IS NOT NULL AND override_actor IS NOT NULL AND override_expires_at IS NOT NULL AND override_revision > 0)
  )
);
CREATE INDEX business_priority_current_idx
  ON business_priority_projections(match_result_id, generated_at DESC);
CREATE TRIGGER backup_revision_business_priority_projections_insert AFTER INSERT ON business_priority_projections
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_business_priority_projections_update AFTER UPDATE ON business_priority_projections
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_business_priority_projections_delete AFTER DELETE ON business_priority_projections
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (36, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV37 = `
BEGIN IMMEDIATE;

CREATE TABLE job_case_sources_v37 (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('gmail', 'manual', 'eml', 'chat-paste', 'wechat-visible')),
  provider_account TEXT,
  provider_message_id TEXT,
  thread_id TEXT NOT NULL,
  from_domain TEXT,
  message_date TEXT NOT NULL,
  redacted_subject TEXT NOT NULL,
  redacted_body TEXT NOT NULL,
  redaction_session_id TEXT NOT NULL REFERENCES redaction_sessions(id),
  warning_codes_json TEXT NOT NULL,
  business_fingerprint TEXT CHECK (business_fingerprint IS NULL OR length(business_fingerprint) = 64),
  created_at TEXT NOT NULL,
  UNIQUE(provider_account, provider_message_id),
  CHECK (
    (source_type = 'gmail' AND provider_account IS NOT NULL AND provider_message_id IS NOT NULL) OR
    (source_type IN ('manual', 'chat-paste', 'wechat-visible') AND provider_account IS NULL AND provider_message_id IS NULL) OR
    (source_type = 'eml' AND provider_account IS NULL AND provider_message_id IS NOT NULL)
  ),
  FOREIGN KEY(provider_account, provider_message_id)
    REFERENCES gmail_messages(account_email, gmail_message_id) ON DELETE CASCADE
);

INSERT INTO job_case_sources_v37(
  id, source_type, provider_account, provider_message_id, thread_id, from_domain,
  message_date, redacted_subject, redacted_body, redaction_session_id,
  warning_codes_json, business_fingerprint, created_at
)
SELECT id, source_type, provider_account, provider_message_id, thread_id, from_domain,
       message_date, redacted_subject, redacted_body, redaction_session_id,
       warning_codes_json, business_fingerprint, created_at
FROM job_case_sources;

DROP TABLE job_case_sources;
ALTER TABLE job_case_sources_v37 RENAME TO job_case_sources;
CREATE INDEX job_case_sources_type_date_idx ON job_case_sources(source_type, message_date DESC);
CREATE UNIQUE INDEX job_case_sources_eml_message_idx ON job_case_sources(provider_message_id)
  WHERE source_type = 'eml';
CREATE TRIGGER backup_revision_job_case_sources_insert AFTER INSERT ON job_case_sources
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_job_case_sources_update AFTER UPDATE ON job_case_sources
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_job_case_sources_delete AFTER DELETE ON job_case_sources
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (37, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

const migrationV38 = `
BEGIN IMMEDIATE;

CREATE TABLE ai_conversations_v38 (
  id TEXT PRIMARY KEY,
  assistant_type TEXT NOT NULL CHECK (assistant_type IN ('candidate-profile', 'interview', 'sales-agent')),
  context_key TEXT NOT NULL,
  candidate_document_id TEXT REFERENCES staged_files(token) ON DELETE CASCADE,
  interview_id TEXT REFERENCES candidate_interview_sessions(id) ON DELETE CASCADE,
  interview_kind TEXT CHECK (interview_kind IN ('recruiting', 'client')),
  round_number INTEGER CHECK (round_number BETWEEN 1 AND 20),
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (assistant_type = 'sales-agent' AND candidate_document_id IS NULL AND interview_id IS NULL AND interview_kind IS NULL AND round_number IS NULL) OR
    (assistant_type = 'candidate-profile' AND candidate_document_id IS NOT NULL AND interview_id IS NULL AND interview_kind IS NULL AND round_number IS NULL) OR
    (assistant_type = 'interview' AND candidate_document_id IS NOT NULL AND interview_id IS NOT NULL AND interview_kind IS NOT NULL AND round_number IS NOT NULL)
  )
);

INSERT INTO ai_conversations_v38(
  id, assistant_type, context_key, candidate_document_id, interview_id, interview_kind,
  round_number, title, payload_json, revision, created_at, updated_at
)
SELECT id, assistant_type, context_key, candidate_document_id, interview_id, interview_kind,
       round_number, title, payload_json, revision, created_at, updated_at
FROM ai_conversations;

DROP TABLE ai_conversations;
ALTER TABLE ai_conversations_v38 RENAME TO ai_conversations;
CREATE INDEX ai_conversations_context_idx ON ai_conversations(context_key, updated_at DESC);
CREATE TRIGGER backup_revision_ai_conversations_insert AFTER INSERT ON ai_conversations
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_ai_conversations_update AFTER UPDATE ON ai_conversations
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_ai_conversations_delete AFTER DELETE ON ai_conversations
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

CREATE TABLE action_runs_v38 (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL CHECK (length(tool_name) BETWEEN 1 AND 160),
  tool_version INTEGER NOT NULL CHECK (tool_version > 0),
  work_task_id TEXT REFERENCES work_tasks(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES ai_conversations(id) ON DELETE SET NULL,
  turn_id TEXT CHECK (turn_id IS NULL OR length(turn_id) BETWEEN 1 AND 128),
  origin TEXT NOT NULL CHECK (origin IN ('work-task', 'user-command', 'managed-connector', 'system')),
  scope_id TEXT NOT NULL CHECK (length(scope_id) BETWEEN 1 AND 160),
  scope_fingerprint TEXT NOT NULL CHECK (length(scope_fingerprint) = 64),
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
  content_revision TEXT,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'awaiting_approval', 'awaiting_foreground_confirmation', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'blocked')),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 240),
  processing_job_id TEXT REFERENCES processing_jobs(id) ON DELETE SET NULL,
  result_hash TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tool_name, idempotency_key)
);

INSERT INTO action_runs_v38(
  id, tool_name, tool_version, work_task_id, conversation_id, turn_id, origin, scope_id,
  scope_fingerprint, input_hash, content_revision, status, idempotency_key,
  processing_job_id, result_hash, error_code, created_at, updated_at
)
SELECT id, tool_name, tool_version, work_task_id, NULL, NULL, origin, scope_id,
       scope_fingerprint, input_hash, content_revision, status, idempotency_key,
       processing_job_id, result_hash, error_code, created_at, updated_at
FROM action_runs;

DROP TABLE action_runs;
ALTER TABLE action_runs_v38 RENAME TO action_runs;
CREATE INDEX action_runs_task_idx ON action_runs(work_task_id, created_at DESC);
CREATE INDEX action_runs_conversation_idx ON action_runs(conversation_id, created_at DESC);
CREATE INDEX action_runs_status_idx ON action_runs(status, created_at DESC);
CREATE TRIGGER backup_revision_action_runs_insert AFTER INSERT ON action_runs
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_action_runs_update AFTER UPDATE ON action_runs
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
CREATE TRIGGER backup_revision_action_runs_delete AFTER DELETE ON action_runs
BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;

INSERT INTO schema_migrations(version, applied_at)
VALUES (38, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

interface WorkTaskRow {
  payload_json: string
}

interface AiConversationRow {
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

interface ProcessingJobRow {
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

interface ActionApprovalRow {
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

interface CandidateMatchRunRow {
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

interface CandidateMatchResultRow {
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

interface BusinessPriorityProjectionRow {
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

interface CandidateEvaluationDatasetRow {
  id: string
  name: string
  dataset_hash: string
  payload_json: string
  case_count: number
  relevant_candidate_count: number
  reviewer_count: number
  imported_at: string
}

interface CandidateEvaluationReportRow {
  report_json: string
}

interface CandidateEvaluationDraftRow {
  id: string
  name: string
  revision: number
  created_at: string
  updated_at: string
}

interface CandidateEvaluationDraftCaseRow {
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

interface CandidateEvaluationDraftLabelRow {
  case_id: string
  candidate_profile_id: string
  candidate_profile_version: number
  expected_project_evidence: 0 | 1
  profile_json: string
  profile_status: 'current' | 'stale' | 'superseded'
  talent_pool_status: 'eligible' | 'suspended' | 'removed' | null
}

interface GoogleWorkspaceAdminConfigurationRow {
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

interface LocalOperatorProfileRow {
  operator_id: string
  display_name: string
  role_label: string
  revision: number
  updated_at: string
}

interface LocalApplicationPreferencesRow {
  locale: string
  revision: number
  updated_at: string
}

interface RedactionSessionRow {
  id: string
  source_version: string
  policy_version: string
  status: RedactionSessionEvidence['status']
  content_hash: string | null
  removed_types_json: string
  created_at: string
  expires_at: string
}

interface MappingRow {
  placeholder: string
  identifier_type: DirectIdentifier
  encrypted_original: Buffer
}

interface StagedFileRow {
  token: string
  name: string
  format: SupportedResumeFormat
  size: number
  sha256: string
  encrypted_path: string
  privacy_status: 'awaiting-local-scan'
  created_at: string
}

interface ParsedDocumentRow {
  document_ir_json: string
  analysis_summary_json: string
}

interface CandidateExtractionRow {
  draft_json: string
}

interface CandidateReviewStateRow {
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

interface CandidateReviewJoinRow extends CandidateReviewStateRow {
  draft_json: string
  file_name: string
}

interface CandidateInterviewRow {
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

interface CandidateFieldAuditRow {
  field_key: string
  original_value: string | null
  confirmed_value: string | null
  change_reason: string | null
  source_labels_json: string
}

interface CandidateProjectAuditRow {
  draft_id: string
  project_id: string | null
  original_json: string | null
  confirmed_json: string | null
  change_reason: string | null
  source_labels_json: string
}

interface CandidateProfileRow {
  profile_json: string
  status: 'current' | 'stale' | 'superseded'
}

interface CandidateRecordRow {
  record_status: 'active' | 'archived' | 'deleted'
  recruiting_status: 'pending-review' | 'ready-for-recruiting' | 'recruiting' | 'passed' | 'rejected' | 'withdrawn' | 'no-show' | 'on-hold'
}

interface TalentPoolMembershipRow {
  status: 'eligible' | 'suspended' | 'removed'
}

interface CandidateProfileEmbeddingRow {
  profile_id: string
  content_hash: string
  vector_dimension: number
  vector_blob: Buffer
  updated_at: string
}

interface CandidateProjectEmbeddingRow extends CandidateProfileEmbeddingRow {
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

interface CandidateLifecycleRow {
  state: 'active' | 'archived'
  reason: string
  changed_by: string
  changed_at: string
}

interface DataDeletionReportRow {
  report_json: string
}

interface RedactionSessionIdRow {
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

interface GmailSyncStateRow {
  account_email: string
  config_hash: string
  history_id: string | null
  status: 'idle' | 'error'
  last_synced_at: string | null
  last_run_json: string | null
  last_error: string | null
}

interface GmailMessageRow {
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

interface GoogleWorkspaceAcceptanceReportRow {
  report_json: string
}

export interface GmailRedactionEvidenceSummary {
  storedMessages: number
  passed: number
  uncertain: number
  blocked: number
}

interface JobCaseReviewStateRow {
  review_id: string
  status: 'awaiting-review' | 'completed'
  privacy_reviewed: 0 | 1
  revision: number
  reviewer_id: string | null
  reviewer_display_name: string | null
  completed_at: string | null
  updated_at: string
}

interface JobCaseReviewJoinRow extends JobCaseReviewStateRow {
  draft_json: string
  source_id: string
  source_type: 'gmail' | 'manual' | 'eml'
  provider_message_id: string | null
  thread_id: string
  message_date: string
  from_domain: string | null
  redacted_subject: string
  redacted_body: string
}

interface JobCaseSourceRow {
  id: string
  source_type: 'gmail' | 'manual' | 'eml'
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

interface JobCaseFieldAuditRow {
  field_key: string
  original_value: string | null
  confirmed_value: string | null
  change_reason: string | null
  source_labels_json: string
}

interface JobCaseRow {
  case_json: string
  status: 'active' | 'superseded'
}

interface JobCaseLifecycleRow {
  source_review_id: string
  state: 'active' | 'archived'
  reason: string
  changed_by: string
  changed_at: string
}

interface ProposalDraftRow {
  payload_json: string
  status: ProposalDraftSnapshot['status']
  revision: number
  content_hash: string
  approved_content_hash: string | null
}

interface ProposalExportRow {
  id: string
  draft_id: string
  status: 'preparing' | 'completed' | 'failed' | 'unknown'
}

interface ProposalFollowUpEventRow {
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

const storedGmailMessageInputSchema: z.ZodType<StoredGmailMessageInput> = z.object({
  accountEmail: z.string().email().max(320),
  gmailMessageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  threadId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  historyId: z.string().min(1).max(128),
  internalDate: z.string().datetime(),
  labelIds: z.array(z.string().min(1).max(128)).max(100),
  rfcMessageId: z.string().max(1_000).nullable(),
  fromDomain: z.string().max(253).nullable(),
  redactedSubject: z.string().max(2_000),
  redactedBody: z.string().max(500_000),
  redactionSessionId: z.string().uuid(),
  classification: z.enum(['job-case', 'candidate-proposal', 'unclassified']),
  businessFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  duplicateOfMessageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).nullable(),
  warningCodes: z.array(z.string().min(1).max(120)).max(50),
  attachmentCount: z.number().int().nonnegative().max(1_000),
  importedAt: z.string().datetime()
})

function storedGmailMessageFromRow(row: GmailMessageRow): StoredGmailMessageInput {
  return storedGmailMessageInputSchema.parse({
    accountEmail: row.account_email,
    gmailMessageId: row.gmail_message_id,
    threadId: row.thread_id,
    historyId: row.history_id,
    internalDate: row.internal_date,
    labelIds: JSON.parse(row.label_ids_json),
    rfcMessageId: row.rfc_message_id,
    fromDomain: row.from_domain,
    redactedSubject: row.redacted_subject,
    redactedBody: row.redacted_body,
    redactionSessionId: row.redaction_session_id,
    classification: row.classification,
    businessFingerprint: row.business_fingerprint,
    duplicateOfMessageId: row.duplicate_of_message_id,
    warningCodes: JSON.parse(row.warning_codes_json),
    attachmentCount: row.attachment_count,
    importedAt: row.imported_at
  })
}

function jobCaseSourceFromRow(row: JobCaseSourceRow): JobCaseSource {
  return jobCaseSourceSchema.parse({
    version: 'job-case-source-v1',
    id: row.id,
    sourceType: row.source_type,
    providerAccount: row.provider_account,
    providerMessageId: row.provider_message_id,
    threadId: row.thread_id,
    fromDomain: row.from_domain,
    messageDate: row.message_date,
    redactedSubject: row.redacted_subject,
    redactedBody: row.redacted_body,
    redactionSessionId: row.redaction_session_id,
    warningCodes: JSON.parse(row.warning_codes_json),
    createdAt: row.created_at
  })
}

function proposalDraftFromRow(row: ProposalDraftRow): ProposalDraftSnapshot {
  const draft = proposalDraftSnapshotSchema.parse(JSON.parse(row.payload_json))
  if (
    draft.status !== row.status ||
    draft.revision !== row.revision ||
    draft.contentHash !== row.content_hash ||
    draft.approvedContentHash !== row.approved_content_hash
  ) {
    throw new Error('Proposal draft columns do not match the encrypted payload.')
  }
  return draft
}

function proposalFollowUpEventFromRow(row: ProposalFollowUpEventRow): ProposalFollowUpEvent {
  return proposalFollowUpEventSchema.parse({
    id: row.id,
    draftId: row.draft_id,
    revision: row.revision,
    stage: row.stage,
    occurredOn: row.occurred_on,
    note: row.note,
    recordedBy: row.actor,
    recordedAt: row.recorded_at,
    cloudEligible: false
  })
}

function candidateMatchFeedbackFromRow(row: CandidateMatchResultRow): CandidateMatchFeedbackSnapshot | null {
  if (!row.feedback_decision) return null
  return {
    decision: row.feedback_decision,
    reasonCode: row.feedback_reason!,
    note: row.feedback_note,
    reviewerDisplayName: row.reviewed_by!,
    revision: row.feedback_revision,
    reviewedAt: row.reviewed_at!
  }
}

function candidateMatchEvaluation(rows: CandidateMatchResultRow[]): CandidateMatchRunSummary['evaluation'] {
  const reviewed = rows.filter((row) => row.feedback_decision !== null)
  const suitable = reviewed.filter((row) => row.feedback_decision === 'suitable')
  let judgedNdcgAt20: number | null = null
  if (rows.length > 0 && reviewed.length === rows.length && suitable.length > 0) {
    const dcg = rows
      .filter((row) => row.result_rank <= 20 && row.feedback_decision === 'suitable')
      .reduce((score, row) => score + 1 / Math.log2(row.result_rank + 1), 0)
    const idealCount = Math.min(20, suitable.length)
    const idcg = Array.from({ length: idealCount }, (_, index) => 1 / Math.log2(index + 2))
      .reduce((score, gain) => score + gain, 0)
    judgedNdcgAt20 = Math.round(dcg / idcg * 10_000) / 10_000
  }
  return {
    resultCount: rows.length,
    feedbackCount: reviewed.length,
    suitableCount: suitable.length,
    unsuitableCount: reviewed.length - suitable.length,
    coveragePercent: rows.length === 0 ? 0 : Math.round(reviewed.length / rows.length * 100),
    judgedNdcgAt20,
    recallAt20: null,
    recallStatus: 'requires-known-relevant-total'
  }
}

function matchingHomeFitSnapshot(
  match: CandidateProfileSearchResult,
  rank: number
): MatchingHomeResult['fit'] & { anonymousLabel: string } {
  return {
    anonymousLabel: match.anonymousLabel,
    rank,
    matchScore: match.matchScore,
    matchedTerms: match.matchedTerms,
    termCoverage: match.retrieval.termCoverage,
    hardFilterUnknownCount: match.retrieval.hardFilters.filter((filter) => filter.outcome === 'unknown').length,
    missing: match.retrieval.hardFilters.filter((filter) => filter.outcome !== 'passed').map((filter) => filter.requested),
    hardFilterStatus: match.retrieval.hardFilters.some((filter) => filter.outcome === 'failed')
      ? 'failed'
      : match.retrieval.hardFilters.some((filter) => filter.outcome === 'unknown') ? 'unknown' : 'passed',
    evidence: match.evidence.map((field) => ({
      key: field.key,
      label: field.label,
      value: field.value,
      sourceLabels: field.sourceLabels
    })),
    projectEvidence: match.projectEvidence ? {
      title: match.projectEvidence.title,
      period: match.projectEvidence.period,
      role: match.projectEvidence.role,
      technologies: match.projectEvidence.technologies,
      summary: match.projectEvidence.summary,
      sourceLabels: match.projectEvidence.sourceLabels
    } : null
  }
}

function businessPriorityProjectionFromRow(
  row: BusinessPriorityProjectionRow,
  now = new Date()
): BusinessPriorityProjection {
  const overrideActive = row.override_level !== null && row.override_expires_at !== null &&
    new Date(row.override_expires_at).getTime() > now.getTime()
  const manualOverride = overrideActive ? {
    level: row.override_level!,
    actor: row.override_actor!,
    reason: row.override_reason!,
    expiresAt: row.override_expires_at!,
    revision: row.override_revision
  } : null
  return {
    id: row.id,
    matchResultId: row.match_result_id,
    runId: row.run_id,
    candidateProfileId: row.candidate_profile_id,
    ruleVersion: row.rule_version,
    level: row.level,
    effectiveLevel: manualOverride?.level ?? row.level,
    reasons: JSON.parse(row.reasons_json) as string[],
    inputs: JSON.parse(row.inputs_json) as BusinessPriorityProjection['inputs'],
    inputSnapshotHash: row.input_snapshot_hash,
    generatedAt: row.generated_at,
    manualOverride
  }
}

function jobCaseBusinessFingerprint(subject: string, body: string): string {
  const normalized = `${subject}\n${body}`
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/<[^>]+_\d{3}>/gu, '<PII>')
    .replace(/\s+/gu, ' ')
    .trim()
  return createHash('sha256').update(normalized).digest('hex')
}

function sealMapping(mappingKey: Buffer, mapping: LocalPiiMapping, sessionId: string): Buffer {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', mappingKey, nonce)
  cipher.setAAD(Buffer.from(`${sessionId}\u0000${mapping.placeholder}\u0000${mapping.identifierType}`))
  const ciphertext = Buffer.concat([cipher.update(mapping.originalValue, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([1]), nonce, tag, ciphertext])
}

function openMapping(mappingKey: Buffer, row: MappingRow, sessionId: string): string {
  const version = row.encrypted_original[0]
  if (version !== 1 || row.encrypted_original.length < 30) throw new Error('Unsupported encrypted PII mapping.')
  const nonce = row.encrypted_original.subarray(1, 13)
  const tag = row.encrypted_original.subarray(13, 29)
  const ciphertext = row.encrypted_original.subarray(29)
  const decipher = createDecipheriv('aes-256-gcm', mappingKey, nonce)
  decipher.setAAD(Buffer.from(`${sessionId}\u0000${row.placeholder}\u0000${row.identifier_type}`))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

function assertEmbeddingIdentity(modelId: string, modelRevision: string): void {
  if (modelId.length < 1 || modelId.length > 200 || modelRevision.length < 1 || modelRevision.length > 200) {
    throw new Error('Embedding model identity is invalid.')
  }
}

function embeddingVectorToBlob(vector: number[]): Buffer {
  if (vector.length < 1 || vector.length > 4_096 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error('Embedding vector is invalid.')
  }
  const blob = Buffer.allocUnsafe(vector.length * 4)
  vector.forEach((value, index) => blob.writeFloatLE(value, index * 4))
  return blob
}

function embeddingVectorFromRow(row: CandidateProfileEmbeddingRow): number[] {
  if (row.vector_dimension < 1 || row.vector_dimension > 4_096 || row.vector_blob.length !== row.vector_dimension * 4) {
    throw new Error('Stored embedding vector is invalid.')
  }
  return Array.from({ length: row.vector_dimension }, (_, index) => row.vector_blob.readFloatLE(index * 4))
}

function applyMigrations(database: Database.Database): void {
  database.exec(migrationV1)
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(1, new Date().toISOString())
  database.exec(migrationV2)
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(2, new Date().toISOString())
  database.exec(migrationV3)
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(3, new Date().toISOString())
  database.exec(migrationV4)
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(4, new Date().toISOString())
  database.exec(migrationV5)
  const existingExtractions = database
    .prepare<[], { document_id: string; draft_json: string; updated_at: string }>(
      'SELECT document_id, draft_json, updated_at FROM candidate_extractions'
    )
    .all()
  const backfillReview = database.prepare(
    `INSERT OR IGNORE INTO candidate_review_states(
       document_id, extraction_version, extraction_created_at, status, pii_reviewed, revision, updated_at
     ) VALUES (?, ?, ?, 'awaiting-review', 0, 1, ?)`
  )
  for (const row of existingExtractions) {
    const draft = candidateExtractionDraftSchema.parse(JSON.parse(row.draft_json))
    backfillReview.run(row.document_id, draft.version, draft.createdAt, row.updated_at)
  }
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(5, new Date().toISOString())
  database.exec(migrationV6)
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(6, new Date().toISOString())
  database.exec(migrationV7)
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(7, new Date().toISOString())
  database.exec(migrationV8)
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(8, new Date().toISOString())
  const hasV9 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 9')
    .get()
  if (!hasV9) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV9)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v9 foreign key verification failed.')
  }
  const hasV10 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 10')
    .get()
  if (!hasV10) {
    database.exec(migrationV10)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v10 foreign key verification failed.')
  }
  const hasV11 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 11')
    .get()
  if (!hasV11) {
    database.exec(migrationV11)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v11 foreign key verification failed.')
  }
  const hasV12 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 12')
    .get()
  if (!hasV12) {
    database.exec(migrationV12)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v12 foreign key verification failed.')
  }
  const hasV13 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 13')
    .get()
  if (!hasV13) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV13)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v13 foreign key verification failed.')
  }
  const hasV14 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 14')
    .get()
  if (!hasV14) {
    database.exec(migrationV14)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v14 foreign key verification failed.')
  }
  const hasV15 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 15')
    .get()
  if (!hasV15) {
    database.exec(migrationV15)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v15 foreign key verification failed.')
  }
  const hasV16 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 16')
    .get()
  if (!hasV16) {
    database.exec(migrationV16)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v16 foreign key verification failed.')
  }
  const hasV17 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 17')
    .get()
  if (!hasV17) {
    database.exec(migrationV17)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v17 foreign key verification failed.')
  }
  const hasV18 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 18')
    .get()
  if (!hasV18) {
    database.exec(migrationV18)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v18 foreign key verification failed.')
  }
  const hasV19 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 19')
    .get()
  if (!hasV19) {
    database.exec(migrationV19)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v19 foreign key verification failed.')
  }
  const hasV20 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 20')
    .get()
  if (!hasV20) {
    database.exec(migrationV20)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v20 foreign key verification failed.')
  }
  const hasV21 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 21')
    .get()
  if (!hasV21) {
    database.exec(migrationV21)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v21 foreign key verification failed.')
  }
  const hasV22 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 22')
    .get()
  if (!hasV22) {
    database.exec(migrationV22)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v22 foreign key verification failed.')
  }
  const hasV23 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 23')
    .get()
  if (!hasV23) {
    database.exec(migrationV23)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v23 foreign key verification failed.')
  }
  const hasV24 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 24')
    .get()
  if (!hasV24) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV24)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v24 foreign key verification failed.')
  }
  const hasV25 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 25')
    .get()
  if (!hasV25) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV25)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v25 foreign key verification failed.')
  }
  const hasV26 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 26')
    .get()
  if (!hasV26) {
    database.exec(migrationV26)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v26 foreign key verification failed.')
  }
  const hasV27 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 27')
    .get()
  if (!hasV27) {
    database.exec(migrationV27)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v27 foreign key verification failed.')
  }
  const hasV28 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 28')
    .get()
  if (!hasV28) {
    database.exec(migrationV28)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v28 foreign key verification failed.')
  }
  const hasV29 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 29')
    .get()
  if (!hasV29) {
    database.exec(migrationV29)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v29 foreign key verification failed.')
  }
  const hasV30 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 30')
    .get()
  if (!hasV30) {
    database.exec(migrationV30)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v30 foreign key verification failed.')
  }
  const hasV31 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 31')
    .get()
  if (!hasV31) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV31)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v31 foreign key verification failed.')
  }
  const hasV32 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 32')
    .get()
  if (!hasV32) {
    database.exec(migrationV32)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v32 foreign key verification failed.')
  }
  const hasV33 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 33')
    .get()
  if (!hasV33) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV33)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v33 foreign key verification failed.')
  }
  const hasV34 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 34')
    .get()
  if (!hasV34) {
    database.exec(migrationV34)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v34 foreign key verification failed.')
  }
  const hasV35 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 35')
    .get()
  if (!hasV35) {
    database.exec(migrationV35)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v35 foreign key verification failed.')
  }
  const hasV36 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 36')
    .get()
  if (!hasV36) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV36)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v36 foreign key verification failed.')
  }
  const hasV37 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 37')
    .get()
  if (!hasV37) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV37)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v37 foreign key verification failed.')
  }
  const hasV38 = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations WHERE version = 38')
    .get()
  if (!hasV38) {
    database.pragma('foreign_keys=OFF')
    try {
      database.exec(migrationV38)
    } finally {
      database.pragma('foreign_keys=ON')
    }
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) throw new Error('Schema v38 foreign key verification failed.')
  }
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function createTableInAttachedSchema(schema: string, name: string, sql: string): string {
  const definitionStart = sql.indexOf('(')
  if (definitionStart < 0 || !/^CREATE\s+TABLE\b/iu.test(sql)) {
    throw new Error(`Unsupported table definition in consistent snapshot: ${name}`)
  }
  return `CREATE TABLE ${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(name)} ${sql.slice(definitionStart)}`
}

function createIndexInAttachedSchema(schema: string, name: string, sql: string): string {
  const onPosition = sql.search(/\sON\s/iu)
  if (onPosition < 0 || !/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/iu.test(sql)) {
    throw new Error(`Unsupported index definition in consistent snapshot: ${name}`)
  }
  const prefix = /^CREATE\s+UNIQUE\s+INDEX\b/iu.test(sql) ? 'CREATE UNIQUE INDEX' : 'CREATE INDEX'
  return `${prefix} ${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(name)}${sql.slice(onPosition)}`
}

function createTriggerInAttachedSchema(schema: string, name: string, sql: string): string {
  const timingPosition = sql.search(/\s(?:BEFORE|AFTER|INSTEAD\s+OF)\s/iu)
  if (timingPosition < 0 || !/^CREATE\s+TRIGGER\b/iu.test(sql)) {
    throw new Error(`Unsupported trigger definition in consistent snapshot: ${name}`)
  }
  return `CREATE TRIGGER ${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(name)}${sql.slice(timingPosition)}`
}

function aiConversationContextKey(context: AiConversationContext): string {
  const immutableContext = context.assistant === 'sales-agent'
    ? { assistant: 'sales-agent' as const }
    : {
        assistant: context.assistant,
        candidateDocumentId: context.candidateDocumentId,
        interviewId: context.interviewId,
        interviewKind: context.interviewKind,
        roundNumber: context.roundNumber
      }
  return createHash('sha256').update(JSON.stringify(immutableContext)).digest('hex')
}

function aiConversationTitle(messages: SaveAiConversationInput['messages']): string {
  const source = messages.find((message) => message.role === 'user')?.content ?? '新しい会話'
  const normalized = source.replace(/\s+/gu, ' ').trim()
  return normalized.length > 60 ? `${normalized.slice(0, 59)}…` : normalized
}

function aiConversationFromRow(row: AiConversationRow): AiConversationSnapshot {
  const snapshot = aiConversationSnapshotSchema.parse(JSON.parse(row.payload_json))
  if (
    snapshot.id !== row.id || snapshot.revision !== row.revision || snapshot.title !== row.title ||
    aiConversationContextKey(snapshot.context) !== row.context_key ||
    snapshot.context.assistant !== row.assistant_type ||
    snapshot.context.candidateDocumentId !== row.candidate_document_id ||
    snapshot.context.interviewId !== row.interview_id ||
    snapshot.context.interviewKind !== row.interview_kind ||
    snapshot.context.roundNumber !== row.round_number
  ) throw new Error('保存済みAI会話の整合性を確認できませんでした。')
  return snapshot
}

interface AgentReferenceTargets {
  jobCaseIds: ReadonlySet<string>
  matchRunIds: ReadonlySet<string>
  matchResultIds: ReadonlySet<string>
}

interface AgentReferenceImpact {
  conversations: number
  messages: number
}

function agentReferenceIsTargeted(reference: AiConversationReference, targets: AgentReferenceTargets): boolean {
  if (!reference.kind || !reference.objectId) return false
  if (reference.kind === 'job-case') return targets.jobCaseIds.has(reference.objectId)
  if (reference.kind === 'match-run') return targets.matchRunIds.has(reference.objectId)
  return targets.matchResultIds.has(reference.objectId)
}

function agentErrorBlock(entityKind: 'job-case' | 'match-run' | 'match-result'): AiConversationBlock {
  const label = entityKind === 'job-case' ? '案件' : entityKind === 'match-run' ? '匹配运行' : '匹配结果'
  return {
    type: 'error',
    code: 'ENTITY_DELETED',
    entityKind,
    message: `关联${label}已删除，历史引用不再显示。`
  }
}

function sanitizeAgentBlock(block: AiConversationBlock, targets: AgentReferenceTargets): { blocks: AiConversationBlock[]; affected: boolean } {
  if (block.type === 'job-case-cards') {
    const cards = block.cards.filter((card) => !agentReferenceIsTargeted(card.reference, targets))
    if (cards.length === block.cards.length) return { blocks: [block], affected: false }
    return cards.length > 0
      ? { blocks: [{ ...block, cards }], affected: true }
      : { blocks: [agentErrorBlock('job-case')], affected: true }
  }
  if (block.type === 'candidate-match-cards') {
    const runDeleted = targets.matchRunIds.has(block.runId)
    const cards = runDeleted
      ? []
      : block.cards.filter((card) => !agentReferenceIsTargeted(card.reference, targets))
    if (!runDeleted && cards.length === block.cards.length) return { blocks: [block], affected: false }
    return cards.length > 0
      ? { blocks: [{ ...block, cards }], affected: true }
      : { blocks: [agentErrorBlock('match-result')], affected: true }
  }
  if (block.type === 'clarification') {
    const options = block.options.filter((option) => !agentReferenceIsTargeted(option, targets))
    if (options.length === block.options.length) return { blocks: [block], affected: false }
    return options.length > 0
      ? { blocks: [{ ...block, options }], affected: true }
      : { blocks: [agentErrorBlock('job-case')], affected: true }
  }
  if (block.type === 'match-run-explanation') {
    const runAffected = targets.matchRunIds.has(block.facts.runId)
    const resultAffected = block.facts.candidate
      ? agentReferenceIsTargeted(block.facts.candidate.reference, targets)
      : false
    return runAffected || resultAffected
      ? { blocks: [agentErrorBlock(runAffected ? 'match-run' : 'match-result')], affected: true }
      : { blocks: [block], affected: false }
  }
  return { blocks: [block], affected: false }
}

function agentMessageHasTarget(message: AiConversationMessage, targets: AgentReferenceTargets): boolean {
  return (message.references ?? []).some((reference) => agentReferenceIsTargeted(reference, targets)) ||
    (message.blocks ?? []).some((block) => sanitizeAgentBlock(block, targets).affected)
}

function agentMessageHasDirectIdentifier(message: AiConversationMessage, knownPersonNames: string[]): boolean {
  return message.role === 'user' && detectDirectIdentifiers(message.content, knownPersonNames).length > 0
}

export interface EncryptedDatabaseOptions {
  path: string
  databaseKey: Buffer
  mappingKey: Buffer
}

export class EncryptedApplicationRepository implements RedactionEvidenceStore {
  private readonly database: Database.Database

  constructor(private readonly options: EncryptedDatabaseOptions) {
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
      this.recoverInterruptedProposalExports()
    } catch (error) {
      this.database.close()
      throw new Error('Unable to open the encrypted local database.', { cause: error })
    }
  }

  listWorkTasks(): WorkTask[] {
    const rows = this.database
      .prepare<[], WorkTaskRow>('SELECT payload_json FROM work_tasks WHERE tombstone = 0 ORDER BY updated_at DESC')
      .all()
    return rows.map((row) => workTaskSchema.parse(JSON.parse(row.payload_json)))
  }

  getWorkTask(taskId: string): WorkTask | null {
    const row = this.database
      .prepare<[string], WorkTaskRow>('SELECT payload_json FROM work_tasks WHERE id = ? AND tombstone = 0')
      .get(taskId)
    return row ? workTaskSchema.parse(JSON.parse(row.payload_json)) : null
  }

  countWorkTasks(): number {
    const row = this.database
      .prepare<[], { count: number }>('SELECT count(*) AS count FROM work_tasks WHERE tombstone = 0')
      .get()
    return row?.count ?? 0
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
    if (!/^[a-f0-9]{64}$/u.test(input.scopeFingerprint) || !/^[a-f0-9]{64}$/u.test(input.inputHash)) {
      throw new Error('Action runtime hashes must be SHA-256 values.')
    }
    const now = new Date().toISOString()
    const existing = this.database.prepare<[
      DomainToolName, string
    ], {
      id: string
      status: ActionRunStatus
      work_task_id: string | null
      origin: string
      scope_id: string
      scope_fingerprint: string
      input_hash: string
      content_revision: string | null
      conversation_id: string | null
      turn_id: string | null
    }>(
      `SELECT id, status, work_task_id, conversation_id, turn_id, origin, scope_id, scope_fingerprint, input_hash, content_revision
       FROM action_runs WHERE tool_name = ? AND idempotency_key = ?`
    ).get(input.toolName, input.idempotencyKey)
    if (existing) {
      const sameInvocation = existing.work_task_id === input.workTaskId &&
        existing.conversation_id === (input.conversationId ?? null) &&
        existing.turn_id === (input.turnId ?? null) &&
        existing.origin === input.origin && existing.scope_id === input.scopeId &&
        existing.scope_fingerprint === input.scopeFingerprint && existing.input_hash === input.inputHash &&
        existing.content_revision === input.contentRevision
      if (!sameInvocation) throw new Error('Action idempotency key collides with a different invocation.')
      return { id: existing.id, status: existing.status }
    }
    const id = randomUUID()
    this.database.transaction(() => {
      this.database.prepare(
        `INSERT INTO action_runs(
          id, tool_name, tool_version, work_task_id, conversation_id, turn_id, origin, scope_id, scope_fingerprint, input_hash,
          content_revision, status, idempotency_key, processing_job_id, result_hash, error_code, created_at, updated_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`
      ).run(id, input.toolName, input.workTaskId, input.conversationId ?? null, input.turnId ?? null,
        input.origin, input.scopeId, input.scopeFingerprint, input.inputHash,
        input.contentRevision, input.status, input.idempotencyKey, now, now)
      this.appendActionEvent(id, 'proposed', { toolName: input.toolName, scopeId: input.scopeId }, now)
    })()
    return { id, status: input.status }
  }

  linkActionRunToConversation(actionRunId: string, conversationId: string, turnId: string): void {
    if (!conversationId || !turnId || turnId.length > 128) {
      throw new Error('ActionRun の会話関連付けには会話IDと有効な turn_id が必要です。')
    }
    const conversation = this.database
      .prepare<[string], { assistant_type: string; payload_json: string }>(
        'SELECT assistant_type, payload_json FROM ai_conversations WHERE id = ?'
      )
      .get(conversationId)
    if (!conversation) throw new Error('関連付け先の会話が見つかりません。')
    if (conversation.assistant_type !== 'sales-agent') {
      throw new Error('ActionRun は Sales Agent 会話にのみ関連付けられます。')
    }
    const snapshot = aiConversationSnapshotSchema.parse(JSON.parse(conversation.payload_json))
    if (!snapshot.messages.some((message) => message.turnId === turnId)) {
      throw new Error('ActionRun の turn_id が会話履歴に存在しません。')
    }

    const actionRun = this.database
      .prepare<[string], { conversation_id: string | null; turn_id: string | null }>(
        'SELECT conversation_id, turn_id FROM action_runs WHERE id = ?'
      )
      .get(actionRunId)
    if (!actionRun) throw new Error('ActionRun が見つかりません。')
    if (actionRun.conversation_id === conversationId && actionRun.turn_id === turnId) return
    if (actionRun.conversation_id !== null || actionRun.turn_id !== null) {
      throw new Error('ActionRun はすでに別の会話または turn に関連付けられています。')
    }

    const updated = this.database.transaction(() => this.database
      .prepare(
        `UPDATE action_runs
         SET conversation_id = ?, turn_id = ?, updated_at = ?
         WHERE id = ? AND conversation_id IS NULL AND turn_id IS NULL`
      )
      .run(conversationId, turnId, new Date().toISOString(), actionRunId))()
    if (updated.changes !== 1) {
      const current = this.database
        .prepare<[string], { conversation_id: string | null; turn_id: string | null }>(
          'SELECT conversation_id, turn_id FROM action_runs WHERE id = ?'
        )
        .get(actionRunId)
      if (current?.conversation_id === conversationId && current.turn_id === turnId) return
      throw new Error('ActionRun は別の会話または turn と同時に関連付けられました。')
    }
    const linked = this.database
      .prepare<[string], { conversation_id: string | null; turn_id: string | null }>(
        'SELECT conversation_id, turn_id FROM action_runs WHERE id = ?'
      )
      .get(actionRunId)
    if (linked?.conversation_id !== conversationId || linked.turn_id !== turnId) {
      throw new Error('ActionRun の会話関連付けを検証できませんでした。')
    }
  }

  updateActionRun(id: string, status: ActionRunStatus, options: { processingJobId?: string | null; resultHash?: string | null; errorCode?: string | null } = {}): void {
    const updated = this.database.prepare(
      `UPDATE action_runs SET status = ?, processing_job_id = COALESCE(?, processing_job_id),
       result_hash = ?, error_code = ?, updated_at = ? WHERE id = ?`
    ).run(status, options.processingJobId ?? null, options.resultHash ?? null, options.errorCode ?? null, new Date().toISOString(), id)
    if (updated.changes !== 1) throw new Error('Action run not found.')
    const eventType = status === 'running' ? 'execution_started'
      : status === 'succeeded' ? 'execution_finished'
        : status === 'failed' ? 'execution_failed'
          : status === 'cancelled' ? 'cancelled'
            : status === 'blocked' ? 'blocked' : 'policy_evaluated'
    this.appendActionEvent(id, eventType, { status, errorCode: options.errorCode ?? null })
  }

  getActionRunStatus(id: string): ActionRunStatus | null {
    return this.database.prepare<[string], { status: ActionRunStatus }>('SELECT status FROM action_runs WHERE id = ?').get(id)?.status ?? null
  }

  requestActionApproval(input: { actionRunId: string; reason: string; safeSummary: string; expiresAt: string }): ActionApprovalSummary {
    if (detectDirectIdentifiers(input.safeSummary).length > 0) {
      throw new Error('Action approval summary must not contain direct identifiers.')
    }
    const existing = this.database.prepare<[string], { id: string }>(
      'SELECT id FROM approval_requests WHERE action_run_id = ?'
    ).get(input.actionRunId)
    if (existing) {
      const approval = this.getActionApproval(existing.id)
      if (!approval) throw new Error('Existing approval request could not be read.')
      return approval
    }
    const now = new Date().toISOString()
    const id = randomUUID()
    this.database.transaction(() => {
      this.database.prepare(
        `INSERT INTO approval_requests(id, action_run_id, status, reason, safe_summary, expires_at, resolved_by, resolved_at, created_at)
         VALUES (?, ?, 'pending', ?, ?, ?, NULL, NULL, ?)`
      ).run(id, input.actionRunId, input.reason, input.safeSummary, input.expiresAt, now)
      this.database.prepare("UPDATE action_runs SET status = 'awaiting_approval', updated_at = ? WHERE id = ?").run(now, input.actionRunId)
      this.appendActionEvent(input.actionRunId, 'approval_requested', { reason: input.reason }, now)
    })()
    const approval = this.getActionApproval(id)
    if (!approval) throw new Error('Approval request could not be created.')
    return approval
  }

  private actionApprovalFromRow(row: ActionApprovalRow): ActionApprovalSummary {
    return {
      id: row.id, actionRunId: row.action_run_id, toolName: row.tool_name, workTaskId: row.work_task_id,
      status: row.status, reason: row.reason, safeSummary: row.safe_summary, inputHash: row.input_hash,
      contentRevision: row.content_revision, expiresAt: row.expires_at, createdAt: row.created_at, resolvedAt: row.resolved_at
    }
  }

  getActionApproval(id: string): ActionApprovalSummary | null {
    const row = this.database.prepare<[string], ActionApprovalRow>(
      `SELECT a.id, a.action_run_id, r.tool_name, r.work_task_id, a.status, a.reason, a.safe_summary,
       r.input_hash, r.content_revision, a.expires_at, a.created_at, a.resolved_at
       FROM approval_requests a JOIN action_runs r ON r.id = a.action_run_id WHERE a.id = ?`
    ).get(id)
    return row ? this.actionApprovalFromRow(row) : null
  }

  listActionApprovals(now = new Date()): ActionApprovalSummary[] {
    this.expirePendingActionApprovals(now)
    const rows = this.database.prepare<[], ActionApprovalRow>(
      `SELECT a.id, a.action_run_id, r.tool_name, r.work_task_id, a.status, a.reason, a.safe_summary,
       r.input_hash, r.content_revision, a.expires_at, a.created_at, a.resolved_at
       FROM approval_requests a JOIN action_runs r ON r.id = a.action_run_id
       WHERE a.status = 'pending' ORDER BY a.created_at DESC`
    ).all()
    return rows.map((row) => this.actionApprovalFromRow(row))
  }

  resolveActionApproval(input: ResolveActionApprovalInput, actor: string): ActionApprovalSummary {
    this.expirePendingActionApprovals(new Date())
    const current = this.getActionApproval(input.approvalId)
    if (!current) throw new Error('Approval request not found.')
    if (current.status !== 'pending' || new Date(current.expiresAt).getTime() <= Date.now()) {
      throw new Error('Approval request is no longer actionable.')
    }
    const now = new Date().toISOString()
    const status = input.decision === 'approve' ? 'approved' : 'denied'
    this.database.transaction(() => {
      const update = this.database.prepare(
        "UPDATE approval_requests SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'pending'"
      ).run(status, actor, now, input.approvalId)
      if (update.changes !== 1) throw new Error('Approval request was already resolved.')
      this.database.prepare('UPDATE action_runs SET status = ?, updated_at = ? WHERE id = ?')
        .run(input.decision === 'approve' ? 'awaiting_foreground_confirmation' : 'cancelled', now, current.actionRunId)
      this.appendActionEvent(current.actionRunId, 'approval_resolved', { decision: input.decision }, now)
    })()
    const resolved = this.getActionApproval(input.approvalId)
    if (!resolved) throw new Error('Approval request could not be resolved.')
    return resolved
  }

  cancelPendingActionApprovalsForTask(workTaskId: string): void {
    const now = new Date().toISOString()
    const actionRunIds = this.database.prepare<[string], { id: string }>(
      "SELECT id FROM action_runs WHERE work_task_id = ? AND status = 'awaiting_approval'"
    ).all(workTaskId)
    this.database.transaction(() => {
      for (const row of actionRunIds) {
        this.database.prepare("UPDATE approval_requests SET status = 'cancelled' WHERE action_run_id = ? AND status = 'pending'").run(row.id)
        this.database.prepare("UPDATE action_runs SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, row.id)
        this.appendActionEvent(row.id, 'cancelled', { reason: 'WORK_TASK_CANCELLED' }, now)
      }
    })()
  }

  private expirePendingActionApprovals(now: Date): void {
    const nowIso = now.toISOString()
    const expired = this.database.prepare<[string], { approval_id: string; action_run_id: string }>(
      `SELECT id AS approval_id, action_run_id FROM approval_requests
       WHERE status = 'pending' AND expires_at <= ?`
    ).all(nowIso)
    if (expired.length === 0) return
    this.database.transaction(() => {
      for (const item of expired) {
        const updated = this.database.prepare(
          "UPDATE approval_requests SET status = 'expired' WHERE id = ? AND status = 'pending'"
        ).run(item.approval_id)
        if (updated.changes !== 1) continue
        this.database.prepare(
          "UPDATE action_runs SET status = 'blocked', error_code = 'APPROVAL_EXPIRED', updated_at = ? WHERE id = ? AND status = 'awaiting_approval'"
        ).run(nowIso, item.action_run_id)
        this.appendActionEvent(item.action_run_id, 'approval_expired', { reason: 'APPROVAL_EXPIRED' }, nowIso)
      }
    })()
  }

  private appendActionEvent(actionRunId: string, eventType: string, detail: Record<string, unknown>, createdAt = new Date().toISOString()): void {
    this.database.prepare(
      'INSERT INTO action_events(id, action_run_id, event_type, detail_json, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(randomUUID(), actionRunId, eventType, JSON.stringify(detail), createdAt)
  }

  saveWorkTask(task: WorkTask): void {
    const validated = workTaskSchema.parse(task)
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO work_tasks(id, type, status, title, payload_json, revision, tombstone, created_at, updated_at)
           VALUES (@id, @type, @status, @title, @payload, 1, 0, @createdAt, @updatedAt)
           ON CONFLICT(id) DO UPDATE SET
             type = excluded.type,
             status = excluded.status,
             title = excluded.title,
             payload_json = excluded.payload_json,
             revision = work_tasks.revision + 1,
             tombstone = 0,
             updated_at = excluded.updated_at`
        )
        .run({
          id: validated.id,
          type: validated.type,
          status: validated.status,
          title: validated.title,
          payload: JSON.stringify(validated),
          createdAt: validated.createdAt,
          updatedAt: validated.updatedAt
        })
      const revision = this.database
        .prepare<[string], { revision: number }>('SELECT revision FROM work_tasks WHERE id = ?')
        .get(validated.id)?.revision
      this.database
        .prepare(
          'INSERT INTO change_outbox(id, entity_type, entity_id, revision, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), 'work_task', validated.id, revision ?? 1, 'upsert', new Date().toISOString())
    })
    save()
  }

  private processingJobFromRow(row: ProcessingJobRow): ProcessingJobSummary {
    return processingJobSummarySchema.parse({
      id: row.id,
      type: row.job_type,
      workTaskId: row.work_task_id,
      taskStepId: row.task_step_id,
      status: row.status,
      replayPolicy: row.replay_policy,
      progress: row.progress,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      nextRetryAt: row.next_retry_at,
      leaseExpiresAt: row.lease_expires_at,
      cancelRequestedAt: row.cancel_requested_at,
      errorCode: row.error_code,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })
  }

  private getProcessingJobRow(jobId: string): ProcessingJobRow | null {
    return this.database
      .prepare<[string], ProcessingJobRow>('SELECT * FROM processing_jobs WHERE id = ?')
      .get(jobId) ?? null
  }

  getProcessingJob(jobId: string): ProcessingJobSummary | null {
    const row = this.getProcessingJobRow(jobId)
    return row ? this.processingJobFromRow(row) : null
  }

  getProcessingJobDispatchReference(jobId: string): { requestFingerprint: string; payloadRef: string } | null {
    const row = this.getProcessingJobRow(jobId)
    return row ? { requestFingerprint: row.request_fingerprint, payloadRef: row.payload_ref } : null
  }

  listProcessingJobs(workTaskId?: string): ProcessingJobSummary[] {
    const rows = workTaskId
      ? this.database.prepare<[string], ProcessingJobRow>(
          'SELECT * FROM processing_jobs WHERE work_task_id = ? ORDER BY created_at DESC, id DESC'
        ).all(workTaskId)
      : this.database.prepare<[], ProcessingJobRow>(
          'SELECT * FROM processing_jobs ORDER BY created_at DESC, id DESC'
        ).all()
    return rows.map((row) => this.processingJobFromRow(row))
  }

  enqueueProcessingJob(
    rawInput: z.input<typeof enqueueProcessingJobInputSchema>,
    now = new Date()
  ): ProcessingJobSummary {
    const input = enqueueProcessingJobInputSchema.parse(rawInput)
    const task = this.getWorkTask(input.workTaskId)
    if (!task) throw new Error('Processing job work task was not found.')
    const existing = this.database
      .prepare<[string], ProcessingJobRow>('SELECT * FROM processing_jobs WHERE idempotency_key = ?')
      .get(input.idempotencyKey)
    if (existing) {
      if (existing.request_fingerprint !== input.requestFingerprint || existing.work_task_id !== input.workTaskId) {
        throw new Error('Processing job idempotency key collision.')
      }
      return this.processingJobFromRow(existing)
    }
    const id = randomUUID()
    const timestamp = now.toISOString()
    this.database.prepare(
      `INSERT INTO processing_jobs(
         id, job_type, work_task_id, task_step_id, idempotency_key, request_fingerprint,
         payload_ref, status, replay_policy, progress, attempt_count, max_attempts,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, 0, 0, ?, ?, ?)`
    ).run(
      id,
      input.type,
      input.workTaskId,
      input.taskStepId,
      input.idempotencyKey,
      input.requestFingerprint,
      input.payloadRef,
      input.replayPolicy,
      input.maxAttempts,
      timestamp,
      timestamp
    )
    const created = this.getProcessingJob(id)
    if (!created) throw new Error('Processing job could not be reloaded.')
    return created
  }

  acquireProcessingJob(jobId: string, leaseDurationMs = 60_000, now = new Date()): ProcessingJobLease | null {
    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1_000 || leaseDurationMs > 15 * 60_000) {
      throw new Error('Processing job lease duration is invalid.')
    }
    const acquire = this.database.transaction((): ProcessingJobLease | null => {
      const row = this.getProcessingJobRow(jobId)
      if (!row) throw new Error('Processing job was not found.')
      if (row.cancel_requested_at) {
        if (row.status === 'queued' || row.status === 'retry_wait') {
          this.database.prepare(
            `UPDATE processing_jobs SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL,
               next_retry_at = NULL, updated_at = ? WHERE id = ?`
          ).run(now.toISOString(), jobId)
        }
        return null
      }
      if (row.status !== 'queued' && row.status !== 'retry_wait') return null
      if (row.status === 'retry_wait' && row.next_retry_at && row.next_retry_at > now.toISOString()) return null
      const leaseToken = randomUUID()
      const timestamp = now.toISOString()
      const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString()
      const updated = this.database.prepare(
        `UPDATE processing_jobs
         SET status = 'running', progress = MAX(progress, 1), attempt_count = attempt_count + 1,
             next_retry_at = NULL, lease_token = ?, lease_expires_at = ?, error_code = NULL, updated_at = ?
         WHERE id = ? AND status IN ('queued', 'retry_wait') AND cancel_requested_at IS NULL`
      ).run(leaseToken, leaseExpiresAt, timestamp, jobId)
      if (updated.changes !== 1) return null
      const job = this.getProcessingJob(jobId)
      if (!job) throw new Error('Acquired processing job could not be reloaded.')
      return { job, leaseToken }
    })
    return acquire()
  }

  updateProcessingJobProgress(jobId: string, leaseToken: string, progress: number, now = new Date()): ProcessingJobSummary {
    const bounded = Math.max(1, Math.min(99, Math.trunc(progress)))
    const updated = this.database.prepare(
      `UPDATE processing_jobs SET progress = MAX(progress, ?), updated_at = ?
       WHERE id = ? AND status = 'running' AND lease_token = ?`
    ).run(bounded, now.toISOString(), jobId, leaseToken)
    if (updated.changes !== 1) throw new Error('Processing job lease is no longer active.')
    const job = this.getProcessingJob(jobId)
    if (!job) throw new Error('Processing job could not be reloaded.')
    return job
  }

  isProcessingJobCancellationRequested(jobId: string, leaseToken: string): boolean {
    const row = this.database
      .prepare<[string, string], { cancel_requested_at: string | null }>(
        `SELECT cancel_requested_at FROM processing_jobs
         WHERE id = ? AND status = 'running' AND lease_token = ?`
      )
      .get(jobId, leaseToken)
    if (!row) throw new Error('Processing job lease is no longer active.')
    return row.cancel_requested_at !== null
  }

  completeProcessingJob(
    jobId: string,
    leaseToken: string,
    result: unknown,
    now = new Date()
  ): ProcessingJobCompletion {
    const resultJson = JSON.stringify(result)
    if (Buffer.byteLength(resultJson, 'utf8') > 1_000_000) throw new Error('Processing job result is too large.')
    const resultHash = createHash('sha256').update(resultJson).digest('hex')
    const complete = this.database.transaction((): ProcessingJobCompletion => {
      const row = this.getProcessingJobRow(jobId)
      if (!row || row.status !== 'running' || row.lease_token !== leaseToken) {
        throw new Error('Processing job lease is no longer active.')
      }
      const timestamp = now.toISOString()
      if (row.cancel_requested_at) {
        this.database.prepare(
          `UPDATE processing_jobs SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL,
             next_retry_at = NULL, updated_at = ? WHERE id = ?`
        ).run(timestamp, jobId)
        const job = this.getProcessingJob(jobId)
        if (!job) throw new Error('Cancelled processing job could not be reloaded.')
        return { job, accepted: false }
      }
      this.database.prepare(
        `UPDATE processing_jobs SET status = 'succeeded', progress = 100, lease_token = NULL,
           lease_expires_at = NULL, next_retry_at = NULL, result_json = ?, result_hash = ?, updated_at = ?
         WHERE id = ?`
      ).run(resultJson, resultHash, timestamp, jobId)
      const job = this.getProcessingJob(jobId)
      if (!job) throw new Error('Completed processing job could not be reloaded.')
      return { job, accepted: true }
    })
    return complete()
  }

  failProcessingJob(
    jobId: string,
    leaseToken: string,
    errorCode: string,
    retryable: boolean,
    retryDelayMs: number | null = null,
    now = new Date()
  ): ProcessingJobSummary {
    if (!/^[A-Z][A-Z0-9_]{1,79}$/u.test(errorCode)) throw new Error('Processing job error code is invalid.')
    const fail = this.database.transaction((): ProcessingJobSummary => {
      const row = this.getProcessingJobRow(jobId)
      if (!row || row.status !== 'running' || row.lease_token !== leaseToken) {
        throw new Error('Processing job lease is no longer active.')
      }
      const timestamp = now.toISOString()
      const cancelled = row.cancel_requested_at !== null
      const shouldRetry = !cancelled && retryable && row.attempt_count < row.max_attempts
      const status = cancelled ? 'cancelled' : shouldRetry ? 'retry_wait' : 'failed'
      const exponentialDelay = Math.min(5 * 60_000, 5_000 * (2 ** Math.max(0, row.attempt_count - 1)))
      const boundedRetryDelay = retryDelayMs === null
        ? exponentialDelay
        : Math.max(1_000, Math.min(5 * 60_000, retryDelayMs))
      const nextRetryAt = shouldRetry ? new Date(now.getTime() + boundedRetryDelay).toISOString() : null
      this.database.prepare(
        `UPDATE processing_jobs SET status = ?, next_retry_at = ?, lease_token = NULL,
           lease_expires_at = NULL, error_code = ?, updated_at = ? WHERE id = ?`
      ).run(status, nextRetryAt, cancelled ? null : errorCode, timestamp, jobId)
      const job = this.getProcessingJob(jobId)
      if (!job) throw new Error('Failed processing job could not be reloaded.')
      return job
    })
    return fail()
  }

  requestProcessingJobCancellationForTask(workTaskId: string, now = new Date()): ProcessingJobSummary[] {
    const timestamp = now.toISOString()
    this.database.prepare(
      `UPDATE processing_jobs
       SET cancel_requested_at = COALESCE(cancel_requested_at, ?),
           status = CASE WHEN status IN ('queued', 'retry_wait') THEN 'cancelled' ELSE status END,
           next_retry_at = CASE WHEN status IN ('queued', 'retry_wait') THEN NULL ELSE next_retry_at END,
           updated_at = ?
       WHERE work_task_id = ? AND status IN ('queued', 'running', 'retry_wait')`
    ).run(timestamp, timestamp, workTaskId)
    return this.listProcessingJobs(workTaskId)
  }

  retryProcessingJobsForTask(workTaskId: string, now = new Date()): ProcessingJobSummary[] {
    const timestamp = now.toISOString()
    this.database.prepare(
      `UPDATE processing_jobs SET status = 'queued', progress = 0, attempt_count = 0, next_retry_at = NULL,
         lease_token = NULL, lease_expires_at = NULL, cancel_requested_at = NULL,
         error_code = NULL, result_json = NULL, result_hash = NULL, updated_at = ?
       WHERE work_task_id = ? AND replay_policy = 'safe-local' AND status IN ('failed', 'cancelled', 'retry_wait')`
    ).run(timestamp, workTaskId)
    return this.listProcessingJobs(workTaskId)
  }

  recoverExpiredProcessingJobs(
    now = new Date(),
    includeUnexpired = false
  ): { requeued: number; reviewRequired: number; cancelled: number } {
    const expired = includeUnexpired
      ? this.database.prepare<[], ProcessingJobRow>(
          `SELECT * FROM processing_jobs WHERE status = 'running' AND lease_expires_at IS NOT NULL`
        ).all()
      : this.database.prepare<[string], ProcessingJobRow>(
          `SELECT * FROM processing_jobs
           WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`
        ).all(now.toISOString())
    let requeued = 0
    let reviewRequired = 0
    let cancelled = 0
    const recover = this.database.transaction(() => {
      for (const row of expired) {
        const timestamp = now.toISOString()
        if (row.cancel_requested_at) {
          this.database.prepare(
            `UPDATE processing_jobs SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL,
               next_retry_at = NULL, updated_at = ? WHERE id = ?`
          ).run(timestamp, row.id)
          cancelled += 1
        } else if (row.replay_policy === 'safe-local') {
          this.database.prepare(
            `UPDATE processing_jobs SET status = 'queued', progress = 0, lease_token = NULL,
               lease_expires_at = NULL, next_retry_at = NULL, error_code = 'LEASE_EXPIRED', updated_at = ? WHERE id = ?`
          ).run(timestamp, row.id)
          requeued += 1
        } else {
          this.database.prepare(
            `UPDATE processing_jobs SET status = 'failed', lease_token = NULL, lease_expires_at = NULL,
               next_retry_at = NULL, error_code = 'INTERRUPTED_REVIEW_REQUIRED', updated_at = ? WHERE id = ?`
          ).run(timestamp, row.id)
          reviewRequired += 1
        }
      }
    })
    recover()
    return { requeued, reviewRequired, cancelled }
  }

  getProcessingJobResult(jobId: string): unknown | null {
    const row = this.getProcessingJobRow(jobId)
    if (!row || row.status !== 'succeeded' || !row.result_json || !row.result_hash) return null
    const actualHash = createHash('sha256').update(row.result_json).digest('hex')
    if (actualHash !== row.result_hash) throw new Error('Processing job result integrity check failed.')
    return JSON.parse(row.result_json) as unknown
  }

  private listCandidateMatchResultRows(runId: string): CandidateMatchResultRow[] {
    return this.database
      .prepare<[string], CandidateMatchResultRow>(
        `SELECT id, run_id, candidate_profile_id, candidate_profile_version, result_rank, result_hash,
                feedback_decision, feedback_reason, feedback_note, feedback_revision, reviewed_by, reviewed_at,
                result_snapshot_json
         FROM candidate_match_results
         WHERE run_id = ?
         ORDER BY result_rank ASC`
      )
      .all(runId)
  }

  getCandidateMatchRunSummary(runId: string): CandidateMatchRunSummary {
    const row = this.database
      .prepare<[string], CandidateMatchRunRow>(
        `SELECT id, task_id, query_text, algorithm_version, hard_filter_policy_version, result_set_hash,
                job_case_id, job_case_version, candidate_pool_fingerprint, candidate_profile_versions_json,
                embedding_model_id, embedding_model_revision, reranker_model_id, reranker_model_revision,
                validity_policy_version, invalidated_at, invalidated_reason, created_at
         FROM candidate_match_runs WHERE id = ?`
      )
      .get(runId)
    if (!row) throw new Error('Candidate match run was not found.')
    return candidateMatchRunSummarySchema.parse({
      id: row.id,
      taskId: row.task_id,
      query: row.query_text,
      algorithmVersion: row.algorithm_version,
      hardFilterPolicyVersion: row.hard_filter_policy_version,
      resultSetHash: row.result_set_hash,
      binding: row.job_case_id && row.job_case_version && row.candidate_pool_fingerprint &&
        row.candidate_profile_versions_json && row.embedding_model_id && row.embedding_model_revision &&
        row.validity_policy_version === 'match-run-validity-v1'
        ? {
            jobCaseId: row.job_case_id,
            jobCaseVersion: row.job_case_version,
            candidatePoolFingerprint: row.candidate_pool_fingerprint,
            candidateProfileVersions: JSON.parse(row.candidate_profile_versions_json) as Array<{ id: string; version: number }>,
            embeddingModelId: row.embedding_model_id,
            embeddingModelRevision: row.embedding_model_revision,
            rerankerModelId: row.reranker_model_id,
            rerankerModelRevision: row.reranker_model_revision,
            policyVersion: 'match-run-validity-v1'
          }
        : null,
      createdAt: row.created_at,
      evaluation: candidateMatchEvaluation(this.listCandidateMatchResultRows(row.id))
    })
  }

  getAgentMatchRunFacts(
    runId: string,
    runtimeIdentity: MatchRuntimeIdentity,
    resultId: string | null = null,
    rank: number | null = null
  ): AgentMatchRunFacts {
    const run = this.getCandidateMatchRunSummary(runId)
    const rows = this.listCandidateMatchResultRows(runId)
    const row = resultId
      ? rows.find((item) => item.id === resultId) ?? null
      : rows.find((item) => item.result_rank === (rank ?? 1)) ?? rows[0] ?? null
    const activeJobCase = run.binding
      ? this.listActiveJobCases().find((item) => item.id === run.binding?.jobCaseId && item.version === run.binding?.jobCaseVersion) ?? null
      : null
    const jobCaseExists = run.binding
      ? Boolean(this.database.prepare<[string], { id: string }>('SELECT id FROM job_cases WHERE id = ?').get(run.binding.jobCaseId))
      : false
    const poolFingerprint = candidatePoolFingerprint(this.listEligibleTalentProfiles())
    const validity: AgentEntityStatus = !run.binding || !jobCaseExists || !row
      ? 'deleted'
      : !activeJobCase
        ? 'stale'
      : evaluateMatchRunValidity(run, {
          ...runtimeIdentity,
          jobCaseId: activeJobCase.id,
          jobCaseVersion: activeJobCase.version,
          candidatePoolFingerprint: poolFingerprint,
          explicitlyInvalidated: false
        }) === 'current' ? 'current' : 'stale'
    const snapshot = row?.result_snapshot_json
      ? JSON.parse(row.result_snapshot_json) as (MatchingHomeResult['fit'] & { anonymousLabel: string })
      : null
    const matched = snapshot?.matchedTerms ?? []
    const missing = snapshot?.missing ?? (snapshot?.hardFilterUnknownCount ? ['硬条件仍有未知项'] : [])
    const hardFilterStatus = snapshot?.hardFilterStatus
      ?? (snapshot?.hardFilterUnknownCount ? 'unknown' : 'passed')
    const candidate = row && snapshot
      ? {
          reference: {
            kind: 'match-result' as const,
            objectId: row.id,
            objectVersion: null,
            resultHash: row.result_hash,
            ordinal: row.result_rank,
            label: snapshot.anonymousLabel,
            target: `match-result:${row.id}`
          },
          candidateProfileId: row.candidate_profile_id,
          runId,
          rank: row.result_rank,
          anonymousLabel: snapshot.anonymousLabel,
          fitScore: snapshot.matchScore,
          matched,
          missing,
          hardFilterStatus,
          projectEvidence: snapshot.projectEvidence?.summary ?? null,
          status: validity
        }
      : null
    return {
      runId,
      resultHash: run.resultSetHash,
      validity,
      jobCaseVersion: run.binding?.jobCaseVersion ?? null,
      candidatePoolFingerprint: run.binding?.candidatePoolFingerprint ?? null,
      algorithmVersion: run.algorithmVersion,
      hardFilterPolicyVersion: run.hardFilterPolicyVersion,
      candidate,
      matched,
      missing,
      hardFilterStatus,
      projectEvidence: snapshot?.projectEvidence?.summary ?? null
    }
  }

  getAgentCandidateProfileFacts(
    runId: string,
    runtimeIdentity: MatchRuntimeIdentity,
    resultId: string | null = null,
    rank: number | null = null
  ): AgentCandidateProfileFacts {
    const matchFacts = this.getAgentMatchRunFacts(runId, runtimeIdentity, resultId, rank)
    const candidate = matchFacts.candidate
    if (!candidate) {
      return { runId, validity: matchFacts.validity, candidate: null, profile: null }
    }
    const profileRow = this.database
      .prepare<[string], CandidateProfileRow>('SELECT profile_json, status FROM candidate_profiles WHERE id = ?')
      .get(candidate.candidateProfileId)
    if (!profileRow) {
      return {
        runId,
        validity: 'deleted',
        candidate: {
          candidateProfileId: candidate.candidateProfileId,
          rank: candidate.rank,
          anonymousLabel: candidate.anonymousLabel
        },
        profile: null
      }
    }
    const profile = candidateProfileSchema.parse(JSON.parse(profileRow.profile_json))
    const field = (key: string): string | null => profile.fields.find((item) => item.key === key)?.value ?? null
    const validity: AgentEntityStatus = matchFacts.validity === 'deleted'
      ? 'deleted'
      : matchFacts.validity === 'stale' || profileRow.status !== 'current' ? 'stale' : 'current'
    return {
      runId,
      validity,
      candidate: {
        candidateProfileId: candidate.candidateProfileId,
        rank: candidate.rank,
        anonymousLabel: candidate.anonymousLabel
      },
      profile: {
        profileVersion: profile.profileVersion,
        skills: field('skills'),
        experienceYears: field('experience_years'),
        availability: field('availability'),
        rate: field('rate'),
        japaneseLevel: field('japanese_level'),
        workStyle: field('work_style'),
        role: field('role'),
        location: field('location'),
        workAuthorization: field('work_authorization'),
        projectExperiences: profile.projectExperiences.slice(0, 20).map((project) => ({
          title: project.title,
          period: project.period,
          role: project.role,
          technologies: project.technologies,
          summary: project.summary
        }))
      }
    }
  }

  getAgentCandidateInterviewFacts(
    runId: string,
    runtimeIdentity: MatchRuntimeIdentity,
    resultId: string | null = null,
    rank: number | null = null
  ): AgentCandidateInterviewFacts {
    const matchFacts = this.getAgentMatchRunFacts(runId, runtimeIdentity, resultId, rank)
    const candidate = matchFacts.candidate
    if (!candidate) return { runId, validity: matchFacts.validity, candidate: null, interviews: [] }
    const profileRow = this.database
      .prepare<[string], CandidateProfileRow>('SELECT profile_json, status FROM candidate_profiles WHERE id = ?')
      .get(candidate.candidateProfileId)
    if (!profileRow) {
      return {
        runId,
        validity: 'deleted',
        candidate: { candidateProfileId: candidate.candidateProfileId, rank: candidate.rank, anonymousLabel: candidate.anonymousLabel },
        interviews: []
      }
    }
    const profile = candidateProfileSchema.parse(JSON.parse(profileRow.profile_json))
    const validity: AgentEntityStatus = matchFacts.validity === 'deleted'
      ? 'deleted'
      : matchFacts.validity === 'stale' || profileRow.status !== 'current' ? 'stale' : 'current'
    const interviews = this.listCandidateInterviews()
      .filter((interview) => interview.sourceDocumentId === profile.sourceDocumentId)
      .slice(0, 40)
      .map((interview) => ({
        kind: interview.kind,
        roundNumber: interview.roundNumber,
        stage: interview.stage,
        scheduledAt: interview.scheduledAt,
        durationMinutes: interview.durationMinutes,
        meetingMethod: interview.meetingMethod,
        interviewer: interview.interviewer,
        interviewGoal: interview.interviewGoal,
        interviewNotes: interview.interviewNotes,
        unresolvedItems: interview.unresolvedItems,
        decision: interview.decision,
        decisionReason: interview.decisionReason,
        updatedAt: interview.updatedAt
      }))
    return {
      runId,
      validity,
      candidate: { candidateProfileId: candidate.candidateProfileId, rank: candidate.rank, anonymousLabel: candidate.anonymousLabel },
      interviews
    }
  }

  saveCandidateMatchRun(
    taskId: string,
    query: string,
    matches: CandidateProfileSearchResult[],
    now = new Date(),
    runtimeIdentity: MatchRuntimeIdentity | null = null
  ): { run: CandidateMatchRunSummary; matches: CandidateMatchResult[] } {
    const task = this.getWorkTask(taskId)
    if (!task || task.type !== 'MATCH_CANDIDATES') throw new Error('Candidate match task was not found.')
    const algorithmVersion = matches[0]?.retrieval.strategy ?? runtimeIdentity?.algorithmVersion ?? 'hard-filter-hybrid-rrf-v1'
    const hardFilterPolicyVersion = matches[0]?.retrieval.hardFilterPolicyVersion ?? runtimeIdentity?.hardFilterPolicyVersion ?? 'tri-state-v3'
    const jobCaseBinding = task.contextBindings.find((binding) => binding.objectType === 'job-case') ?? null
    const jobCase = jobCaseBinding
      ? this.listActiveJobCases().find((item) => item.id === jobCaseBinding.objectId) ?? null
      : null
    const pool = this.listEligibleTalentProfiles()
    const profileVersions = pool
      .map((profile) => ({ id: profile.id, version: profile.profileVersion }))
      .toSorted((left, right) => left.id.localeCompare(right.id) || left.version - right.version)
    const binding = runtimeIdentity && jobCase && jobCaseBinding?.version === String(jobCase.version)
      ? {
          jobCaseId: jobCase.id,
          jobCaseVersion: jobCase.version,
          candidatePoolFingerprint: candidatePoolFingerprint(pool),
          candidateProfileVersions: profileVersions,
          embeddingModelId: runtimeIdentity.embeddingModelId,
          embeddingModelRevision: runtimeIdentity.embeddingModelRevision,
          rerankerModelId: runtimeIdentity.rerankerModelId,
          rerankerModelRevision: runtimeIdentity.rerankerModelRevision,
          policyVersion: 'match-run-validity-v1' as const
        }
      : null
    const prepared = matches.map((match, index) => ({
      match,
      rank: match.retrieval.rank ?? index + 1,
      resultHash: createHash('sha256').update(JSON.stringify({
        candidateProfileId: match.id,
        candidateProfileVersion: match.version,
        matchedTerms: match.matchedTerms,
        evidence: match.evidence,
        projectEvidence: match.projectEvidence,
        retrieval: match.retrieval
      })).digest('hex')
    }))
    const resultSetHash = createHash('sha256').update(JSON.stringify({
      query: query.normalize('NFKC').trim(),
      algorithmVersion,
      hardFilterPolicyVersion,
      binding,
      results: prepared.map((result) => ({
        candidateProfileId: result.match.id,
        candidateProfileVersion: result.match.version,
        resultHash: result.resultHash,
        rank: result.rank
      }))
    })).digest('hex')
    const timestamp = now.toISOString()
    const existing = this.database
      .prepare<[string, string], CandidateMatchRunRow>(
        `SELECT id, task_id, query_text, algorithm_version, hard_filter_policy_version, result_set_hash,
                job_case_id, job_case_version, candidate_pool_fingerprint, candidate_profile_versions_json,
                embedding_model_id, embedding_model_revision, reranker_model_id, reranker_model_revision,
                validity_policy_version, invalidated_at, invalidated_reason, created_at
         FROM candidate_match_runs WHERE task_id = ? AND result_set_hash = ?`
      )
      .get(taskId, resultSetHash)
    const runId = existing?.id ?? randomUUID()
    if (!existing) {
      const insert = this.database.transaction(() => {
        this.database
          .prepare(
            `INSERT INTO candidate_match_runs(
               id, task_id, query_text, algorithm_version, hard_filter_policy_version,
               result_set_hash, job_case_id, job_case_version, candidate_pool_fingerprint,
               candidate_profile_versions_json, embedding_model_id, embedding_model_revision,
               reranker_model_id, reranker_model_revision, validity_policy_version,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            runId, taskId, query, algorithmVersion, hardFilterPolicyVersion, resultSetHash,
            binding?.jobCaseId ?? null, binding?.jobCaseVersion ?? null,
            binding?.candidatePoolFingerprint ?? null,
            binding ? JSON.stringify(binding.candidateProfileVersions) : null,
            binding?.embeddingModelId ?? null, binding?.embeddingModelRevision ?? null,
            binding?.rerankerModelId ?? null, binding?.rerankerModelRevision ?? null,
            binding?.policyVersion ?? null, timestamp, timestamp
          )
        for (const result of prepared) {
          this.database
            .prepare(
              `INSERT INTO candidate_match_results(
                 id, run_id, candidate_profile_id, candidate_profile_version, result_rank,
                 result_hash, feedback_revision, result_snapshot_json, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
            )
            .run(
              randomUUID(),
              runId,
              result.match.id,
              result.match.version,
              result.rank,
              result.resultHash,
              JSON.stringify(matchingHomeFitSnapshot(result.match, result.rank)),
              timestamp,
              timestamp
            )
        }
      })
      insert()
    }
    const resultRows = this.listCandidateMatchResultRows(runId)
    const persistedRun = this.getCandidateMatchRunSummary(runId)
    if (binding && jobCase) {
      for (const result of resultRows) this.ensureBusinessPriorityProjection(persistedRun, result, jobCase, now)
    }
    const rowByCandidate = new Map(resultRows.map((row) => [row.candidate_profile_id, row]))
    return {
      run: persistedRun,
      matches: matches.map((match) => {
        const row = rowByCandidate.get(match.id)
        if (!row) throw new Error('Persisted candidate match result is incomplete.')
        return {
          ...match,
          matchResultId: row.id,
          matchResultHash: row.result_hash,
          feedback: candidateMatchFeedbackFromRow(row)
        }
      })
    }
  }

  private ensureBusinessPriorityProjection(
    run: CandidateMatchRunSummary,
    result: CandidateMatchResultRow,
    jobCase: ConfirmedJobCase,
    now = new Date()
  ): BusinessPriorityProjection {
    const projected = this.projectBusinessPriorityForResult(result, jobCase)
    const generatedAt = now.toISOString()
    this.database
      .prepare(
        `INSERT OR IGNORE INTO business_priority_projections(
           id, match_result_id, run_id, candidate_profile_id, rule_version, level,
           reasons_json, inputs_json, input_snapshot_hash, generated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(), result.id, run.id, result.candidate_profile_id, projected.ruleVersion,
        projected.level, JSON.stringify(projected.reasons), JSON.stringify(projected.inputs),
        projected.inputSnapshotHash, generatedAt
      )
    const row = this.database
      .prepare<[string, string, string], BusinessPriorityProjectionRow>(
        `SELECT * FROM business_priority_projections
         WHERE match_result_id = ? AND rule_version = ? AND input_snapshot_hash = ?`
      )
      .get(result.id, projected.ruleVersion, projected.inputSnapshotHash)
    if (!row) throw new Error('Business priority projection could not be loaded.')
    return businessPriorityProjectionFromRow(row, now)
  }

  private projectBusinessPriorityForResult(
    result: CandidateMatchResultRow,
    jobCase: ConfirmedJobCase
  ): ReturnType<typeof projectBusinessPriority> {
    const profileRow = this.database
      .prepare<[string], CandidateProfileRow>(
        "SELECT profile_json, status FROM candidate_profiles WHERE id = ? AND status = 'current'"
      )
      .get(result.candidate_profile_id)
    if (!profileRow) throw new Error('Current candidate profile was not found for business priority.')
    const profile = candidateProfileSchema.parse(JSON.parse(profileRow.profile_json))
    const proposalRow = this.database
      .prepare<[string, string], { id: string }>(
        `SELECT id FROM proposal_drafts
         WHERE job_case_id = ? AND candidate_profile_id = ?
         ORDER BY updated_at DESC, id DESC LIMIT 1`
      )
      .get(jobCase.id, result.candidate_profile_id)
    const proposal = proposalRow ? this.getProposalDraft(proposalRow.id) : null
    return projectBusinessPriority({
      caseTiming: jobCase.fields.find((field) => field.key === 'start_date')?.value ?? null,
      candidateAvailability: profile.fields.find((field) => field.key === 'availability')?.value ?? null,
      proposalStatus: proposal?.status ?? null,
      followUpStage: proposal?.followUp.stage ?? null
    })
  }

  private getPersistedBusinessPriorityProjection(
    result: CandidateMatchResultRow,
    jobCase: ConfirmedJobCase,
    now = new Date()
  ): BusinessPriorityProjection {
    const projected = this.projectBusinessPriorityForResult(result, jobCase)
    const row = this.database
      .prepare<[string, string, string], BusinessPriorityProjectionRow>(
        `SELECT * FROM business_priority_projections
         WHERE match_result_id = ? AND rule_version = ? AND input_snapshot_hash = ?`
      )
      .get(result.id, projected.ruleVersion, projected.inputSnapshotHash)
    if (!row) throw new Error('Business priority projection could not be loaded.')
    return businessPriorityProjectionFromRow(row, now)
  }

  private refreshBusinessPriorityProjectionsForPair(
    jobCaseId: string,
    candidateProfileId: string,
    now = new Date()
  ): void {
    const jobCaseRow = this.database
      .prepare<[string], JobCaseRow>('SELECT case_json, status FROM job_cases WHERE id = ?')
      .get(jobCaseId)
    if (!jobCaseRow) return
    const jobCase = confirmedJobCaseSchema.parse(JSON.parse(jobCaseRow.case_json))
    const rows = this.database
      .prepare<[string, string], CandidateMatchResultRow>(
        `SELECT result.id, result.run_id, result.candidate_profile_id, result.candidate_profile_version,
                result.result_rank, result.result_hash, result.feedback_decision, result.feedback_reason,
                result.feedback_note, result.feedback_revision, result.reviewed_by, result.reviewed_at,
                result.result_snapshot_json
         FROM candidate_match_results result
         JOIN candidate_match_runs run ON run.id = result.run_id
         WHERE run.job_case_id = ? AND result.candidate_profile_id = ?`
      )
      .all(jobCaseId, candidateProfileId)
    for (const result of rows) {
      this.ensureBusinessPriorityProjection(this.getCandidateMatchRunSummary(result.run_id), result, jobCase, now)
    }
  }

  getMatchingHomeProjection(
    runtimeIdentity: MatchRuntimeIdentity,
    now = new Date()
  ): MatchingHomeProjection {
    const jobCases = this.listActiveJobCases()
    const pool = this.listEligibleTalentProfiles()
    if (jobCases.length === 0 || pool.length === 0) {
      return {
        state: 'onboarding',
        eligibleCandidateCount: pool.length,
        selectedJobCaseId: jobCases[0]?.id ?? null,
        jobCases: jobCases.map((jobCase) => ({
          id: jobCase.id,
          version: jobCase.version,
          title: jobCase.fields.find((field) => field.key === 'title')?.value ?? `案件 ${jobCase.id.slice(0, 8)}`,
          validity: 'not_run',
          lastRunCreatedAt: null
        })),
        currentRun: null
      }
    }

    const poolFingerprint = candidatePoolFingerprint(pool)
    const projectedCases = jobCases.map((jobCase) => {
      const row = this.database
        .prepare<[string], CandidateMatchRunRow>(
          `SELECT id, task_id, query_text, algorithm_version, hard_filter_policy_version, result_set_hash,
                  job_case_id, job_case_version, candidate_pool_fingerprint, candidate_profile_versions_json,
                  embedding_model_id, embedding_model_revision, reranker_model_id, reranker_model_revision,
                  validity_policy_version, invalidated_at, invalidated_reason, created_at
           FROM candidate_match_runs WHERE job_case_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`
        )
        .get(jobCase.id)
      const run = row ? this.getCandidateMatchRunSummary(row.id) : null
      const validity: MatchingHomeProjection['jobCases'][number]['validity'] = run ? evaluateMatchRunValidity(run, {
        ...runtimeIdentity,
        jobCaseId: jobCase.id,
        jobCaseVersion: jobCase.version,
        candidatePoolFingerprint: poolFingerprint,
        explicitlyInvalidated: Boolean(row?.invalidated_at)
      }) : 'not_run'
      return {
        jobCase,
        run,
        validity,
        createdAt: run?.createdAt ?? null
      }
    })
    const current = projectedCases
      .filter((item) => item.run !== null && item.validity === 'current')
      .toSorted((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''))[0] ?? null
    const selected = current ?? projectedCases[0]!
    let currentRun: MatchingHomeProjection['currentRun'] = null
    if (current?.run) {
      const activeRun = current.run
      const rows = this.listCandidateMatchResultRows(activeRun.id)
      const results = rows.flatMap((row): MatchingHomeResult[] => {
        if (!row.result_snapshot_json) return []
        const snapshot = JSON.parse(row.result_snapshot_json) as MatchingHomeResult['fit'] & { anonymousLabel: string }
        return [{
          matchResultId: row.id,
          matchResultHash: row.result_hash,
          candidateProfileId: row.candidate_profile_id,
          candidateProfileVersion: row.candidate_profile_version,
          anonymousLabel: snapshot.anonymousLabel,
          fit: {
            rank: snapshot.rank,
            matchScore: snapshot.matchScore,
            matchedTerms: snapshot.matchedTerms,
            termCoverage: snapshot.termCoverage,
            hardFilterUnknownCount: snapshot.hardFilterUnknownCount,
            evidence: snapshot.evidence,
            projectEvidence: snapshot.projectEvidence
          },
          feedback: candidateMatchFeedbackFromRow(row),
          businessPriority: this.getPersistedBusinessPriorityProjection(row, current.jobCase, now)
        }]
      })
      currentRun = { run: activeRun, validity: 'current', results }
    }
    return {
      state: currentRun ? 'current-results' : 'ready-to-run',
      eligibleCandidateCount: pool.length,
      selectedJobCaseId: selected.jobCase.id,
      jobCases: projectedCases.map((item) => ({
        id: item.jobCase.id,
        version: item.jobCase.version,
        title: item.jobCase.fields.find((field) => field.key === 'title')?.value ?? `案件 ${item.jobCase.id.slice(0, 8)}`,
        validity: item.validity,
        lastRunCreatedAt: item.createdAt
      })),
      currentRun
    }
  }

  setBusinessPriorityOverride(
    rawInput: SetBusinessPriorityOverrideInput,
    actor: string,
    now = new Date()
  ): BusinessPriorityProjection {
    const input = setBusinessPriorityOverrideInputSchema.parse(rawInput)
    if (new Date(input.expiresAt).getTime() <= now.getTime()) {
      throw new Error('Business priority override expiry must be in the future.')
    }
    const current = this.database
      .prepare<[string], BusinessPriorityProjectionRow>(
        `SELECT * FROM business_priority_projections
         WHERE match_result_id = ? ORDER BY generated_at DESC, id DESC LIMIT 1`
      )
      .get(input.matchResultId)
    if (!current) throw new Error('Business priority projection was not found.')
    const revision = current.override_revision + 1
    const updated = this.database
      .prepare(
        `UPDATE business_priority_projections SET
           override_level = ?, override_reason = ?, override_actor = ?,
           override_expires_at = ?, override_revision = ?
         WHERE id = ? AND override_revision = ?`
      )
      .run(input.level, input.reason, actor, input.expiresAt, revision, current.id, current.override_revision)
    if (updated.changes !== 1) throw new Error('Business priority projection changed. Reload and try again.')
    const row = this.database
      .prepare<[string], BusinessPriorityProjectionRow>('SELECT * FROM business_priority_projections WHERE id = ?')
      .get(current.id)
    if (!row) throw new Error('Business priority override could not be reloaded.')
    return businessPriorityProjectionFromRow(row, now)
  }

  submitCandidateMatchFeedback(
    rawInput: SubmitCandidateMatchFeedbackInput,
    reviewerDisplayName: string,
    now = new Date()
  ): SubmitCandidateMatchFeedbackResult {
    const input = submitCandidateMatchFeedbackInputSchema.parse(rawInput)
    const row = this.database
      .prepare<[string], CandidateMatchResultRow>(
        `SELECT id, run_id, candidate_profile_id, candidate_profile_version, result_rank, result_hash,
                feedback_decision, feedback_reason, feedback_note, feedback_revision, reviewed_by, reviewed_at,
                result_snapshot_json
         FROM candidate_match_results WHERE id = ?`
      )
      .get(input.matchResultId)
    if (!row) throw new Error('Candidate match result was not found.')
    if (row.result_hash !== input.matchResultHash) {
      throw new Error('Candidate match result changed. Review the evidence again before saving feedback.')
    }
    if (row.feedback_revision !== input.expectedRevision) {
      throw new Error('Candidate match feedback changed. Reload before editing.')
    }
    const reviewedAt = now.toISOString()
    const nextRevision = row.feedback_revision + 1
    const updated = this.database
      .prepare(
        `UPDATE candidate_match_results
         SET feedback_decision = ?, feedback_reason = ?, feedback_note = ?, feedback_revision = ?,
             reviewed_by = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ? AND result_hash = ? AND feedback_revision = ?`
      )
      .run(
        input.decision,
        input.reasonCode,
        input.note?.trim() || null,
        nextRevision,
        reviewerDisplayName,
        reviewedAt,
        reviewedAt,
        input.matchResultId,
        input.matchResultHash,
        input.expectedRevision
      )
    if (updated.changes !== 1) throw new Error('Candidate match feedback changed. Reload before editing.')
    const feedback: CandidateMatchFeedbackSnapshot = {
      decision: input.decision,
      reasonCode: input.reasonCode,
      note: input.note?.trim() || null,
      reviewerDisplayName,
      revision: nextRevision,
      reviewedAt
    }
    return {
      run: this.getCandidateMatchRunSummary(row.run_id),
      matchResultId: row.id,
      feedback
    }
  }

  private candidateEvaluationDraftFromRow(row: CandidateEvaluationDraftRow): CandidateEvaluationDraft {
    const caseRows = this.database
      .prepare<[string], CandidateEvaluationDraftCaseRow>(
        `SELECT draft_case.id, draft_case.draft_id, draft_case.job_case_id,
                draft_case.job_case_version, draft_case.job_case_title, draft_case.query_text,
                draft_case.pool_reviewed, draft_case.reviewer_id,
                draft_case.reviewer_display_name, draft_case.reviewed_at,
                job.status AS job_case_status, lifecycle.state AS job_case_lifecycle
         FROM candidate_evaluation_draft_cases draft_case
         JOIN job_cases job ON job.id = draft_case.job_case_id
         LEFT JOIN job_case_lifecycle lifecycle ON lifecycle.source_review_id = job.source_review_id
         WHERE draft_case.draft_id = ?
         ORDER BY draft_case.reviewed_at DESC, draft_case.id`
      )
      .all(row.id)
    const labelRows = this.database
      .prepare<[string], CandidateEvaluationDraftLabelRow>(
        `SELECT label.case_id, label.candidate_profile_id, label.candidate_profile_version,
                label.expected_project_evidence, profile.profile_json,
                profile.status AS profile_status, membership.status AS talent_pool_status
         FROM candidate_evaluation_draft_labels label
         JOIN candidate_evaluation_draft_cases draft_case ON draft_case.id = label.case_id
         JOIN candidate_profiles profile ON profile.id = label.candidate_profile_id
         LEFT JOIN talent_pool_memberships membership ON membership.source_document_id = profile.source_document_id
         WHERE draft_case.draft_id = ?
         ORDER BY label.case_id, label.candidate_profile_id`
      )
      .all(row.id)
    const labelsByCase = new Map<string, CandidateEvaluationDraftLabelRow[]>()
    for (const label of labelRows) {
      const labels = labelsByCase.get(label.case_id) ?? []
      labels.push(label)
      labelsByCase.set(label.case_id, labels)
    }
    const cases = caseRows.map((draftCase) => {
      const relevantCandidates = (labelsByCase.get(draftCase.id) ?? []).map((label) => {
        const profile = candidateProfileSchema.parse(JSON.parse(label.profile_json))
        const active = label.profile_status === 'current' &&
          label.talent_pool_status === 'eligible' &&
          profile.profileVersion === label.candidate_profile_version
        return {
          profileId: label.candidate_profile_id,
          profileVersion: label.candidate_profile_version,
          anonymousLabel: `候補者 ${label.candidate_profile_id.slice(0, 8).toLocaleUpperCase('en-US')}`,
          expectedProjectEvidence: label.expected_project_evidence === 1,
          status: active ? 'active' as const : 'stale' as const
        }
      })
      const jobCaseActive = draftCase.job_case_status === 'active' &&
        (draftCase.job_case_lifecycle ?? 'active') === 'active'
      const status = !jobCaseActive
        ? 'job-case-stale' as const
        : relevantCandidates.length === 0
          ? 'no-relevant-candidates' as const
          : relevantCandidates.some((candidate) => candidate.status === 'stale')
            ? 'candidate-stale' as const
            : 'ready' as const
      return {
        id: draftCase.id,
        jobCaseId: draftCase.job_case_id,
        jobCaseVersion: draftCase.job_case_version,
        jobCaseTitle: draftCase.job_case_title,
        query: draftCase.query_text,
        poolReviewed: true as const,
        reviewerDisplayName: draftCase.reviewer_display_name,
        reviewedAt: draftCase.reviewed_at,
        status,
        relevantCandidates
      }
    })
    const reviewers = new Set(cases.map((draftCase) => draftCase.reviewerDisplayName))
    return candidateEvaluationDraftSchema.parse({
      id: row.id,
      name: row.name,
      revision: row.revision,
      caseCount: cases.length,
      readyCaseCount: cases.filter((draftCase) => draftCase.status === 'ready').length,
      reviewerCount: reviewers.size,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      cases
    })
  }

  private getCandidateEvaluationDraftById(draftId: string): CandidateEvaluationDraft | null {
    const row = this.database
      .prepare<[string], CandidateEvaluationDraftRow>(
        'SELECT id, name, revision, created_at, updated_at FROM candidate_evaluation_drafts WHERE id = ?'
      )
      .get(draftId)
    return row ? this.candidateEvaluationDraftFromRow(row) : null
  }

  getCandidateEvaluationDraft(): CandidateEvaluationDraft | null {
    const row = this.database
      .prepare<[], CandidateEvaluationDraftRow>(
        'SELECT id, name, revision, created_at, updated_at FROM candidate_evaluation_drafts ORDER BY updated_at DESC LIMIT 1'
      )
      .get()
    return row ? this.candidateEvaluationDraftFromRow(row) : null
  }

  createCandidateEvaluationDraft(
    rawInput: CreateCandidateEvaluationDraftInput,
    now = new Date()
  ): CandidateEvaluationDraft {
    const input = createCandidateEvaluationDraftInputSchema.parse(rawInput)
    if (detectDirectIdentifiers(input.name).length > 0) {
      throw new Error('評価セット名に個人識別情報を含めることはできません。')
    }
    const timestamp = now.toISOString()
    const draftId = randomUUID()
    this.database
      .prepare(
        `INSERT INTO candidate_evaluation_drafts(id, name, revision, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?)`
      )
      .run(draftId, input.name, timestamp, timestamp)
    const draft = this.getCandidateEvaluationDraftById(draftId)
    if (!draft) throw new Error('Candidate evaluation draft could not be reloaded.')
    return draft
  }

  saveCandidateEvaluationDraftCase(
    rawInput: SaveCandidateEvaluationDraftCaseInput,
    reviewerId: string,
    reviewerDisplayName: string,
    now = new Date()
  ): CandidateEvaluationDraft {
    const input = saveCandidateEvaluationDraftCaseInputSchema.parse(rawInput)
    const draft = this.getCandidateEvaluationDraftById(input.draftId)
    if (!draft) throw new Error('Candidate evaluation draft was not found.')
    if (draft.revision !== input.expectedRevision) throw new Error('評価セット草稿が更新されました。再読み込みしてください。')
    const jobCaseRow = this.database
      .prepare<[string], JobCaseRow & { lifecycle_state: 'active' | 'archived' | null }>(
        `SELECT job.case_json, job.status, lifecycle.state AS lifecycle_state
         FROM job_cases job
         LEFT JOIN job_case_lifecycle lifecycle ON lifecycle.source_review_id = job.source_review_id
         WHERE job.id = ?`
      )
      .get(input.jobCaseId)
    if (!jobCaseRow || jobCaseRow.status !== 'active' || (jobCaseRow.lifecycle_state ?? 'active') !== 'active') {
      throw new Error('選択した案件は現在の確認済み案件ではありません。')
    }
    const jobCase = confirmedJobCaseSchema.parse(JSON.parse(jobCaseRow.case_json))
    const query = candidateBenchmarkQueryFromJobCase(jobCase)
    const title = jobCase.fields.find((field) => field.key === 'title')?.value ?? `案件 ${jobCase.id.slice(0, 8)}`
    if (query.length < 2) throw new Error('案件に評価用の確認済み検索条件がありません。')
    if (detectDirectIdentifiers(`${title}\n${query}`).length > 0) {
      throw new Error('案件の評価条件に個人識別情報が残っています。案件レビューを修正してください。')
    }
    const activeProfiles = new Map(this.listEligibleTalentProfiles().map((profile) => [profile.id, profile]))
    const selectedProfiles = input.relevantCandidateProfileIds.map((profileId) => {
      const profile = activeProfiles.get(profileId)
      if (!profile) throw new Error('選択した候補者は現在の確認済み候補者プールに存在しません。')
      return profile
    })
    const expectedProjectEvidence = new Set(input.expectedProjectEvidenceProfileIds)
    for (const profile of selectedProfiles) {
      if (expectedProjectEvidence.has(profile.id) && profile.projectExperiences.length === 0) {
        throw new Error('プロジェクト証拠対象には確認済みプロジェクト経験が必要です。')
      }
    }
    const existing = this.database
      .prepare<[string, string], { id: string; created_at: string }>(
        'SELECT id, created_at FROM candidate_evaluation_draft_cases WHERE draft_id = ? AND job_case_id = ?'
      )
      .get(input.draftId, input.jobCaseId)
    if (!existing && draft.caseCount >= 100) throw new Error('評価セット草稿は最大 100 ケースです。')
    const caseId = existing?.id ?? randomUUID()
    const timestamp = now.toISOString()
    const save = this.database.transaction(() => {
      const updated = this.database
        .prepare(
          `UPDATE candidate_evaluation_drafts
           SET revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`
        )
        .run(timestamp, input.draftId, input.expectedRevision)
      if (updated.changes !== 1) throw new Error('評価セット草稿が更新されました。再読み込みしてください。')
      this.database
        .prepare(
          `INSERT INTO candidate_evaluation_draft_cases(
             id, draft_id, job_case_id, job_case_version, job_case_title, query_text,
             pool_reviewed, reviewer_id, reviewer_display_name, reviewed_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
           ON CONFLICT(draft_id, job_case_id) DO UPDATE SET
             job_case_version = excluded.job_case_version,
             job_case_title = excluded.job_case_title,
             query_text = excluded.query_text,
             pool_reviewed = 1,
             reviewer_id = excluded.reviewer_id,
             reviewer_display_name = excluded.reviewer_display_name,
             reviewed_at = excluded.reviewed_at,
             updated_at = excluded.updated_at`
        )
        .run(
          caseId,
          input.draftId,
          jobCase.id,
          jobCase.version,
          title,
          query,
          reviewerId,
          reviewerDisplayName,
          timestamp,
          existing?.created_at ?? timestamp,
          timestamp
        )
      this.database.prepare('DELETE FROM candidate_evaluation_draft_labels WHERE case_id = ?').run(caseId)
      const insertLabel = this.database.prepare(
        `INSERT INTO candidate_evaluation_draft_labels(
           case_id, candidate_profile_id, candidate_profile_version, expected_project_evidence, created_at
         ) VALUES (?, ?, ?, ?, ?)`
      )
      for (const profile of selectedProfiles) {
        insertLabel.run(
          caseId,
          profile.id,
          profile.profileVersion,
          expectedProjectEvidence.has(profile.id) ? 1 : 0,
          timestamp
        )
      }
    })
    save()
    const result = this.getCandidateEvaluationDraftById(input.draftId)
    if (!result) throw new Error('Candidate evaluation draft could not be reloaded.')
    return result
  }

  deleteCandidateEvaluationDraftCase(rawInput: DeleteCandidateEvaluationDraftCaseInput, now = new Date()): CandidateEvaluationDraft {
    const input = deleteCandidateEvaluationDraftCaseInputSchema.parse(rawInput)
    const timestamp = now.toISOString()
    const remove = this.database.transaction(() => {
      const updated = this.database
        .prepare(
          `UPDATE candidate_evaluation_drafts
           SET revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`
        )
        .run(timestamp, input.draftId, input.expectedRevision)
      if (updated.changes !== 1) throw new Error('評価セット草稿が更新されました。再読み込みしてください。')
      const deleted = this.database
        .prepare('DELETE FROM candidate_evaluation_draft_cases WHERE id = ? AND draft_id = ?')
        .run(input.caseId, input.draftId)
      if (deleted.changes !== 1) throw new Error('評価ケースが見つかりません。')
    })
    remove()
    const result = this.getCandidateEvaluationDraftById(input.draftId)
    if (!result) throw new Error('Candidate evaluation draft could not be reloaded.')
    return result
  }

  buildCandidateEvaluationBenchmark(draftId: string, expectedRevision: number, now = new Date()): SesCandidateBenchmark {
    const draft = this.getCandidateEvaluationDraftById(draftId)
    if (!draft) throw new Error('Candidate evaluation draft was not found.')
    if (draft.revision !== expectedRevision) throw new Error('評価セット草稿が更新されました。再読み込みしてください。')
    if (draft.caseCount === 0) throw new Error('評価ケースを 1 件以上追加してください。')
    if (draft.readyCaseCount !== draft.caseCount) throw new Error('無効または再確認が必要な評価ケースがあります。')
    if (draft.reviewerCount < 1) throw new Error('評価担当者の確認がありません。')
    const privacyText = [draft.name, ...draft.cases.map((draftCase) => draftCase.query)].join('\n')
    if (detectDirectIdentifiers(privacyText).length > 0) {
      throw new Error('評価セット草稿に個人識別情報が含まれています。')
    }
    return sesCandidateBenchmarkSchema.parse({
      version: 'ses-candidate-benchmark-v1',
      id: randomUUID(),
      name: draft.name,
      createdAt: now.toISOString(),
      privacy: { directIdentifiersRemoved: true, rawResumeIncluded: false, rawMailIncluded: false },
      labeling: { method: 'ses-expert', reviewerCount: draft.reviewerCount },
      thresholds: { minimumCases: 30, recallAt20: 0.9, ndcgAt20: 0.75, projectEvidenceCoverageAt20: 0.8 },
      cases: draft.cases.map((draftCase) => ({
        id: draftCase.id,
        query: draftCase.query,
        relevantCandidateLabels: draftCase.relevantCandidates.map((candidate) => candidate.anonymousLabel),
        expectedProjectEvidenceLabels: draftCase.relevantCandidates
          .filter((candidate) => candidate.expectedProjectEvidence)
          .map((candidate) => candidate.anonymousLabel)
      }))
    })
  }

  getCandidateEvaluationState(): CandidateEvaluationState {
    const datasetRow = this.database
      .prepare<[], CandidateEvaluationDatasetRow>(
        `SELECT dataset.id, dataset.name, dataset.dataset_hash, dataset.payload_json,
                dataset.case_count, dataset.relevant_candidate_count, dataset.reviewer_count,
                dataset.imported_at
         FROM candidate_evaluation_datasets dataset
         LEFT JOIN candidate_evaluation_reports report ON report.dataset_id = dataset.id
         ORDER BY coalesce(report.evaluated_at, dataset.imported_at) DESC LIMIT 1`
      )
      .get()
    const reportRow = this.database
      .prepare<[], CandidateEvaluationReportRow>(
        `SELECT report_json FROM candidate_evaluation_reports
         ORDER BY evaluated_at DESC LIMIT 1`
      )
      .get()
    return candidateEvaluationStateSchema.parse({
      dataset: datasetRow ? {
        id: datasetRow.id,
        name: datasetRow.name,
        datasetHash: datasetRow.dataset_hash,
        caseCount: datasetRow.case_count,
        relevantCandidates: datasetRow.relevant_candidate_count,
        reviewerCount: datasetRow.reviewer_count,
        importedAt: datasetRow.imported_at
      } : null,
      latestReport: reportRow
        ? candidateEvaluationReportSchema.parse(JSON.parse(reportRow.report_json))
        : null
    })
  }

  saveCandidateEvaluation(
    rawBenchmark: SesCandidateBenchmark,
    rawReport: CandidateEvaluationReport,
    now = new Date()
  ): CandidateEvaluationState {
    const benchmark = sesCandidateBenchmarkSchema.parse(rawBenchmark)
    const report = candidateEvaluationReportSchema.parse(rawReport)
    const datasetHash = createHash('sha256').update(JSON.stringify(benchmark), 'utf8').digest('hex')
    if (report.datasetId !== benchmark.id || report.datasetHash !== datasetHash) {
      throw new Error('Candidate evaluation report does not match the imported benchmark.')
    }
    const existing = this.database
      .prepare<[string], { dataset_hash: string }>('SELECT dataset_hash FROM candidate_evaluation_datasets WHERE id = ?')
      .get(benchmark.id)
    if (existing && existing.dataset_hash !== datasetHash) {
      throw new Error('Benchmark ID already exists with different content. Use a new benchmark ID.')
    }
    const importedAt = now.toISOString()
    const relevantCandidateCount = benchmark.cases.reduce(
      (total, testCase) => total + testCase.relevantCandidateLabels.length,
      0
    )
    const save = this.database.transaction(() => {
      if (!existing) {
        this.database
          .prepare(
            `INSERT INTO candidate_evaluation_datasets(
               id, name, dataset_hash, payload_json, case_count, relevant_candidate_count,
               reviewer_count, imported_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            benchmark.id,
            benchmark.name,
            datasetHash,
            JSON.stringify(benchmark),
            benchmark.cases.length,
            relevantCandidateCount,
            benchmark.labeling.reviewerCount,
            importedAt
          )
      }
      this.database
        .prepare(
          `INSERT INTO candidate_evaluation_reports(
             id, dataset_id, dataset_hash, status, report_json, evaluated_at
           ) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(report.id, benchmark.id, datasetHash, report.status, JSON.stringify(report), report.evaluatedAt)
    })
    save()
    return this.getCandidateEvaluationState()
  }

  private candidateEvaluationDatasetIdsForLabels(labels: ReadonlySet<string>): string[] {
    const rows = this.database
      .prepare<[], { id: string; payload_json: string }>(
        'SELECT id, payload_json FROM candidate_evaluation_datasets'
      )
      .all()
    return rows.flatMap((row) => {
      const benchmark = sesCandidateBenchmarkSchema.parse(JSON.parse(row.payload_json))
      return benchmark.cases.some((testCase) =>
        testCase.relevantCandidateLabels.some((label) => labels.has(label)) ||
        testCase.expectedProjectEvidenceLabels.some((label) => labels.has(label))
      ) ? [row.id] : []
    })
  }

  saveRedactionSession(session: RedactionSessionEvidence, mappings: LocalPiiMapping[]): void {
    const save = this.database.transaction(() => {
      this.persistRedactionSession(session, mappings)
    })
    save()
  }

  private persistRedactionSession(session: RedactionSessionEvidence, mappings: LocalPiiMapping[]): void {
    this.database
      .prepare(
        `INSERT INTO redaction_sessions(
           id, source_version, policy_version, status, content_hash, removed_types_json, created_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           content_hash = excluded.content_hash,
           removed_types_json = excluded.removed_types_json,
           expires_at = excluded.expires_at`
      )
      .run(
        session.id,
        session.sourceVersion,
        session.policyVersion,
        session.status,
        session.contentHash,
        JSON.stringify(session.removedTypes),
        session.createdAt,
        session.expiresAt
      )
    this.database.prepare('DELETE FROM local_pii_mappings WHERE redaction_session_id = ?').run(session.id)
    const insertMapping = this.database.prepare(
      `INSERT INTO local_pii_mappings(
         redaction_session_id, placeholder, identifier_type, encrypted_original
       ) VALUES (?, ?, ?, ?)`
    )
    for (const mapping of mappings) {
      insertMapping.run(
        session.id,
        mapping.placeholder,
        mapping.identifierType,
        sealMapping(this.options.mappingKey, mapping, session.id)
      )
    }
  }

  saveStagedFile(file: StagedFileRecord): void {
    this.saveStagedFiles([file])
  }

  saveStagedFiles(files: StagedFileRecord[]): void {
    const insert = this.database.prepare(
        `INSERT INTO staged_files(
           token, name, format, size, sha256, encrypted_path, privacy_status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
    const save = this.database.transaction(() => {
      for (const file of files) {
        insert.run(
          file.token,
          file.name,
          file.format,
          file.size,
          file.sha256,
          file.encryptedPath,
          file.privacyStatus,
          file.createdAt
        )
      }
    })
    save()
  }

  /** Persist the staged originals and their audit task as one DB transaction. */
  saveResumeImportTask(task: WorkTask, files: StagedFileRecord[]): void {
    const validatedTask = workTaskSchema.parse(task)
    const insertFile = this.database.prepare(
      `INSERT INTO staged_files(
         token, name, format, size, sha256, encrypted_path, privacy_status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const save = this.database.transaction(() => {
      for (const file of files) {
        insertFile.run(file.token, file.name, file.format, file.size, file.sha256, file.encryptedPath, file.privacyStatus, file.createdAt)
      }
      this.database.prepare(
        `INSERT INTO work_tasks(id, type, status, title, payload_json, revision, tombstone, created_at, updated_at)
         VALUES (@id, @type, @status, @title, @payload, 1, 0, @createdAt, @updatedAt)`
      ).run({
        id: validatedTask.id, type: validatedTask.type, status: validatedTask.status, title: validatedTask.title,
        payload: JSON.stringify(validatedTask), createdAt: validatedTask.createdAt, updatedAt: validatedTask.updatedAt
      })
      this.database.prepare(
        'INSERT INTO change_outbox(id, entity_type, entity_id, revision, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(randomUUID(), 'work_task', validatedTask.id, 1, 'upsert', new Date().toISOString())
    })
    save()
  }

  removeStagedFiles(tokens: string[]): void {
    if (tokens.length === 0) return
    const remove = this.database.prepare(`DELETE FROM staged_files WHERE token IN (${tokens.map(() => '?').join(', ')})`)
    remove.run(...tokens)
  }

  getStagedFiles(tokens: string[]): StagedLocalFile[] {
    return this.getStagedFileRecords(tokens).map(({ encryptedPath: _encryptedPath, ...file }) => file)
  }

  getStagedFileRecords(tokens: string[]): StagedFileRecord[] {
    if (tokens.length === 0) return []
    const placeholders = tokens.map(() => '?').join(', ')
    const rows = this.database
      .prepare<string[], StagedFileRow>(`SELECT * FROM staged_files WHERE token IN (${placeholders})`)
      .all(...tokens)
    const byToken = new Map(rows.map((row) => [row.token, row]))
    return tokens.flatMap((token) => {
      const row = byToken.get(token)
      return row
        ? [
            {
              token: row.token,
              name: row.name,
              format: row.format,
              size: row.size,
              sha256: row.sha256,
              encryptedPath: row.encrypted_path,
              privacyStatus: row.privacy_status,
              createdAt: row.created_at
            }
          ]
        : []
    })
  }

  listStagedFileRecords(): StagedFileRecord[] {
    const rows = this.database
      .prepare<[], StagedFileRow>('SELECT * FROM staged_files ORDER BY token')
      .all()
    return rows.map((row) => ({
      token: row.token,
      name: row.name,
      format: row.format,
      size: row.size,
      sha256: row.sha256,
      encryptedPath: row.encrypted_path,
      privacyStatus: row.privacy_status,
      createdAt: row.created_at
    }))
  }

  rebindStagedFilePaths(vaultDirectory: string): number {
    const rows = this.database.prepare<[], { token: string }>('SELECT token FROM staged_files ORDER BY token').all()
    const update = this.database.prepare('UPDATE staged_files SET encrypted_path = ? WHERE token = ?')
    const rebind = this.database.transaction(() => {
      for (const row of rows) update.run(join(vaultDirectory, `${row.token}.sesv`), row.token)
    })
    rebind()
    return rows.length
  }

  saveParsedDocument(
    document: DocumentIR,
    summary: ResumeAnalysisSummary,
    redactionSessionId: string,
    extraction?: CandidateExtractionDraft
  ): void {
    const validatedDocument = documentIrSchema.parse(document)
    const validatedSummary = resumeAnalysisSummarySchema.parse(summary)
    const validatedExtraction = extraction ? candidateExtractionDraftSchema.parse(extraction) : null
    if (validatedDocument.documentId !== validatedSummary.fileToken) {
      throw new Error('Parsed document and analysis summary refer to different staged files.')
    }
    if (validatedExtraction && validatedExtraction.documentId !== validatedDocument.documentId) {
      throw new Error('Candidate extraction and parsed document refer to different staged files.')
    }
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO parsed_documents(
             document_id, document_ir_json, analysis_summary_json, redaction_session_id, parser_version, analyzed_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(document_id) DO UPDATE SET
             document_ir_json = excluded.document_ir_json,
             analysis_summary_json = excluded.analysis_summary_json,
             redaction_session_id = excluded.redaction_session_id,
             parser_version = excluded.parser_version,
             analyzed_at = excluded.analyzed_at`
        )
        .run(
          validatedDocument.documentId,
          JSON.stringify(validatedDocument),
          JSON.stringify(validatedSummary),
          redactionSessionId,
          validatedDocument.version,
          validatedSummary.analyzedAt
        )
      if (validatedExtraction) {
        const recordTimestamp = validatedExtraction.createdAt
        this.database
          .prepare(
            `INSERT INTO candidate_records(source_document_id, record_status, recruiting_status, created_at, updated_at)
             VALUES (?, 'active', 'pending-review', ?, ?)
             ON CONFLICT(source_document_id) DO NOTHING`
          )
          .run(validatedExtraction.documentId, recordTimestamp, recordTimestamp)
        this.database
          .prepare(
            `INSERT INTO candidate_extractions(document_id, draft_json, review_status, updated_at)
             VALUES (?, ?, 'awaiting-review', ?)
             ON CONFLICT(document_id) DO UPDATE SET
               draft_json = excluded.draft_json,
               review_status = excluded.review_status,
               updated_at = excluded.updated_at`
          )
          .run(
            validatedExtraction.documentId,
            JSON.stringify(validatedExtraction),
            validatedExtraction.createdAt
          )
        const reviewState = this.database
          .prepare<[string], CandidateReviewStateRow>('SELECT * FROM candidate_review_states WHERE document_id = ?')
          .get(validatedExtraction.documentId)
        if (!reviewState) {
          this.database
            .prepare(
              `INSERT INTO candidate_review_states(
                 document_id, extraction_version, extraction_created_at, status, pii_reviewed, revision, updated_at
               ) VALUES (?, ?, ?, 'awaiting-review', 0, 1, ?)`
            )
            .run(
              validatedExtraction.documentId,
              validatedExtraction.version,
              validatedExtraction.createdAt,
              validatedExtraction.createdAt
            )
        } else if (reviewState.extraction_created_at !== validatedExtraction.createdAt) {
          // A new resume starts another profile review, but candidate identity,
          // recruiting history, and earned talent-pool membership are durable.
          this.database
            .prepare(
              `UPDATE candidate_review_states SET
                 extraction_version = ?, extraction_created_at = ?, status = 'awaiting-review',
                 pii_reviewed = 0, revision = revision + 1, reviewer_id = NULL,
                 reviewer_display_name = NULL, completed_at = NULL, updated_at = ?
               WHERE document_id = ?`
            )
            .run(
              validatedExtraction.version,
              validatedExtraction.createdAt,
              validatedExtraction.createdAt,
              validatedExtraction.documentId
            )
          this.database
            .prepare("UPDATE candidate_profiles SET status = 'stale' WHERE source_document_id = ? AND status = 'current'")
            .run(validatedExtraction.documentId)
        }
      }
    })
    save()
  }

  getCandidateExtraction(documentId: string): CandidateExtractionDraft | null {
    const row = this.database
      .prepare<[string], CandidateExtractionRow>('SELECT draft_json FROM candidate_extractions WHERE document_id = ?')
      .get(documentId)
    return row ? candidateExtractionDraftSchema.parse(JSON.parse(row.draft_json)) : null
  }

  getCandidateLocalIdentity(documentId: string): LocalCandidateIdentitySummary {
    const sessionId = this.getRedactionSessionIdForDocument(documentId)
    const mappings = sessionId ? this.getLocalPiiMappings(sessionId) : []
    const originalValue = (identifierType: LocalPiiMapping['identifierType']) =>
      mappings.find((mapping) => mapping.identifierType === identifierType)?.originalValue ?? null
    const profileRow = this.database
      .prepare<[string], CandidateProfileRow>(
        'SELECT profile_json, status FROM candidate_profiles WHERE source_document_id = ? ORDER BY version DESC LIMIT 1'
      )
      .get(documentId)
    const rawProfile = profileRow ? JSON.parse(profileRow.profile_json) as Record<string, unknown> : null
    const profile = rawProfile ? candidateProfileSchema.parse(rawProfile) : null
    const hasManuallySavedDetails = Boolean(rawProfile && Object.prototype.hasOwnProperty.call(rawProfile, 'localPersonalDetails'))
    const draft = this.getCandidateExtraction(documentId)
    const document = this.getParsedDocument(documentId)
    const live = document ? extractLocalCandidatePersonalDetails(document) : null
    const resolved = (key: keyof LocalCandidatePersonalDetails, mappingType?: LocalPiiMapping['identifierType']) => {
      if (hasManuallySavedDetails) return profile?.localPersonalDetails[key] ?? null
      return draft?.localPersonalDetails[key] ?? live?.[key] ?? (mappingType ? originalValue(mappingType) : null)
    }
    return {
      displayName: resolved('displayName', 'person_name'),
      gender: resolved('gender'),
      birthDate: resolved('birthDate', 'birth_date'),
      nationality: resolved('nationality', 'nationality'),
      phone: resolved('phone', 'phone'),
      email: resolved('email', 'private_email'),
      address: resolved('address', 'postal_address'),
      education: resolved('education'),
      major: resolved('major'),
      graduationDate: resolved('graduationDate'),
      degree: resolved('degree'),
      storage: 'encrypted-local-only',
      cloudEligible: false
    }
  }

  getCandidateReview(documentId: string): CandidateReviewSnapshot | null {
    const row = this.database
      .prepare<[string], CandidateReviewJoinRow>(
        `SELECT state.*, extraction.draft_json, staged.name AS file_name
         FROM candidate_review_states state
         JOIN candidate_extractions extraction ON extraction.document_id = state.document_id
         JOIN staged_files staged ON staged.token = state.document_id
         WHERE state.document_id = ?`
      )
      .get(documentId)
    if (!row) return null
    const draft = candidateExtractionDraftSchema.parse(JSON.parse(row.draft_json))
    const auditRows = row.status === 'completed'
      ? this.database
          .prepare<[string, number], CandidateFieldAuditRow>(
            `SELECT field_key, original_value, confirmed_value, change_reason, source_labels_json
             FROM candidate_field_review_audits
             WHERE document_id = ? AND review_revision = ?`
          )
          .all(documentId, row.revision)
      : []
    const auditByKey = new Map(auditRows.map((audit) => [audit.field_key, audit]))
    const projectAuditRows = row.status === 'completed'
      ? this.database
          .prepare<[string, number], CandidateProjectAuditRow>(
            `SELECT draft_id, project_id, original_json, confirmed_json, change_reason, source_labels_json
             FROM candidate_project_review_audits
             WHERE document_id = ? AND review_revision = ?`
          )
          .all(documentId, row.revision)
      : []
    const profileRow = this.database
      .prepare<[string], CandidateProfileRow>(
        'SELECT profile_json, status FROM candidate_profiles WHERE source_document_id = ? ORDER BY version DESC LIMIT 1'
      )
      .get(documentId)
    const profile = profileRow ? candidateProfileSchema.parse(JSON.parse(profileRow.profile_json)) : null
    const profileFieldByKey = new Map(profile?.fields.map((field) => [field.key, field]) ?? [])
    const record = this.database
      .prepare<[string], CandidateRecordRow>('SELECT record_status, recruiting_status FROM candidate_records WHERE source_document_id = ?')
      .get(documentId)
    const membership = this.database
      .prepare<[string], TalentPoolMembershipRow>('SELECT status FROM talent_pool_memberships WHERE source_document_id = ?')
      .get(documentId)
    return candidateReviewSnapshotSchema.parse({
      documentId,
      fileName: row.file_name,
      reviewRevision: row.revision,
      status: row.status,
      piiReviewed: row.pii_reviewed === 1,
      localIdentity: this.getCandidateLocalIdentity(documentId),
      fields: draft.fields.map((field) => {
        const audit = auditByKey.get(field.key)
        const profileField = profileFieldByKey.get(field.key)
        const value = profileField?.value ?? (audit ? audit.confirmed_value : field.value)
        return {
          key: field.key,
          label: field.label,
          originalValue: field.value,
          value,
          confidence: field.confidence,
          status: audit ? 'confirmed' : field.status,
          sourceLabels: profileField?.sourceLabels ?? (audit ? JSON.parse(audit.source_labels_json) as string[] : field.sources.map((source) => source.sourceLabel)),
          changed: profileField ? field.value !== profileField.value : audit ? audit.original_value !== audit.confirmed_value : false,
          changeReason: audit?.change_reason ?? null
        }
      }),
      projectExperiences: row.status === 'completed' && profile
        ? profile.projectExperiences.map((project) => {
            const audit = projectAuditRows.find((entry) => entry.project_id === project.id)
            const original = audit?.original_json ? JSON.parse(audit.original_json) as { confidence?: number } : null
            return {
              draftId: audit?.draft_id ?? `profile-${project.id}`,
              title: project.title,
              period: project.period,
              role: project.role,
              technologies: project.technologies,
              summary: project.summary,
              confidence: original?.confidence ?? 1,
              sourceLabels: project.sourceLabels,
              changed: Boolean(audit?.change_reason),
              changeReason: audit?.change_reason ?? null
            }
          })
        : draft.projectExperiences.map((project) => ({
            draftId: project.draftId,
            title: project.title,
            period: project.period,
            role: project.role,
            technologies: project.technologies,
            summary: project.summary,
            confidence: project.confidence,
            sourceLabels: project.sources.map((source) => source.sourceLabel),
            changed: false,
            changeReason: null
          })),
      completedAt: row.completed_at,
      reviewerDisplayName: row.reviewer_display_name,
      profile: profile
        ? {
            id: profile.id,
            sourceDocumentId: profile.sourceDocumentId,
            version: profile.profileVersion,
            status: profileRow?.status,
            confirmedAt: profile.confirmedAt,
            confirmedBy: profile.confirmedBy,
            containsDirectIdentifiers: profile.containsDirectIdentifiers
          }
        : null,
      recruitingStatus: record?.recruiting_status ?? 'pending-review',
      talentPoolStatus: membership?.status ?? 'none',
      recordStatus: record?.record_status ?? 'active'
    })
  }

  listCandidateReviews(): CandidateReviewSnapshot[] {
    const rows = this.database
      .prepare<[], { document_id: string }>('SELECT document_id FROM candidate_review_states ORDER BY updated_at DESC')
      .all()
    return rows.flatMap((row) => {
      const review = this.getCandidateReview(row.document_id)
      return review ? [review] : []
    })
  }

  private candidateInterviewFromRow(row: CandidateInterviewRow): CandidateInterviewSnapshot {
    if (row.cloud_eligible !== 0) throw new Error('Candidate interview cloud boundary is invalid.')
    return candidateInterviewSnapshotSchema.parse({
      id: row.id,
      sourceDocumentId: row.source_document_id,
      kind: row.kind,
      roundNumber: row.round_number,
      parentInterviewId: row.parent_interview_id,
      stage: row.stage,
      scheduledAt: row.scheduled_at,
      durationMinutes: row.duration_minutes,
      meetingMethod: row.meeting_method,
      meetingUrl: row.meeting_url,
      meetingDetails: JSON.parse(row.meeting_details_json || '{}'),
      interviewer: row.interviewer,
      contactNote: row.contact_note,
      interviewGoal: row.interview_goal,
      questionPlan: JSON.parse(row.question_plan_json),
      interviewNotes: row.interview_notes,
      unresolvedItems: JSON.parse(row.unresolved_items_json),
      decision: row.decision,
      decisionReason: row.decision_reason,
      decidedAt: row.decided_at,
      decidedBy: row.decided_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
      cloudEligible: false
    })
  }

  private getCandidateInterviewRow(
    sourceDocumentId: string,
    interviewId?: string,
    kind: CandidateInterviewSnapshot['kind'] = 'recruiting'
  ): CandidateInterviewRow | null {
    if (interviewId) {
      return this.database
        .prepare<[string, string], CandidateInterviewRow>(
          'SELECT * FROM candidate_interview_sessions WHERE id = ? AND source_document_id = ?'
        )
        .get(interviewId, sourceDocumentId) ?? null
    }
    return this.database
      .prepare<[string, string], CandidateInterviewRow>(
        `SELECT * FROM candidate_interview_sessions
         WHERE source_document_id = ? AND kind = ?
         ORDER BY round_number DESC, updated_at DESC
         LIMIT 1`
      )
      .get(sourceDocumentId, kind) ?? null
  }

  private assertCandidateInterviewSubject(sourceDocumentId: string): void {
    const exists = this.database
      .prepare<[string], { document_id: string }>('SELECT document_id FROM candidate_review_states WHERE document_id = ?')
      .get(sourceDocumentId)
    if (!exists) throw new Error('Candidate resume was not found.')
  }

  listCandidateInterviews(): CandidateInterviewSnapshot[] {
    return this.database
      .prepare<[], CandidateInterviewRow>(
        `SELECT * FROM candidate_interview_sessions
         ORDER BY coalesce(scheduled_at, updated_at) ASC, source_document_id, round_number`
      )
      .all()
      .map((row) => this.candidateInterviewFromRow(row))
  }

  createCandidateInterviewRound(
    input: CreateCandidateInterviewRoundInput,
    updatedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    const validated = createCandidateInterviewRoundInputSchema.parse(input)
    this.assertCandidateInterviewSubject(validated.sourceDocumentId)
    const parent = this.getCandidateInterviewRow(validated.sourceDocumentId, validated.parentInterviewId)
    if (!parent) throw new Error('The prior interview round was not found.')
    if (parent.decision !== 'next-round') throw new Error('Record a next-round decision before creating a follow-up interview.')
    const kind = validated.kind ?? parent.kind
    const round = this.database
      .prepare<[string, string], { next_round: number }>(
        `SELECT coalesce(max(round_number), 0) + 1 AS next_round
         FROM candidate_interview_sessions WHERE source_document_id = ? AND kind = ?`
      )
      .get(validated.sourceDocumentId, kind)?.next_round ?? parent.round_number + 1
    const existing = this.database
      .prepare<[string, string, number], CandidateInterviewRow>(
        `SELECT * FROM candidate_interview_sessions
         WHERE source_document_id = ? AND kind = ? AND round_number = ?`
      )
      .get(validated.sourceDocumentId, kind, round)
    if (existing) return this.candidateInterviewFromRow(existing)
    const timestamp = now.toISOString()
    const id = randomUUID()
    const inheritedItems = candidateInterviewSnapshotSchema.parse({
      ...this.candidateInterviewFromRow(parent),
      id: parent.id
    }).unresolvedItems
    // A follow-up must not quietly repeat every first-round question. Only
    // unresolved items become candidates for the next round; the renderer can
    // use the parent plan as an exclusion set when generating new AI prompts.
    const questionPlan = inheritedItems
      .slice(0, 12)
      .map((text, index) => ({
        id: `inherited-${round}-${index + 1}`,
        text,
        source: 'inherited' as const,
        sourceLabel: null,
        selected: false
      }))
    this.database.prepare(
      `INSERT INTO candidate_interview_sessions(
         id, source_document_id, kind, round_number, parent_interview_id, stage,
         scheduled_at, duration_minutes, meeting_method, meeting_url, meeting_details_json, interviewer,
         contact_note, interview_goal, question_plan_json, interview_notes, unresolved_items_json,
         decision, decision_reason, decided_at, decided_by, created_at, updated_at, updated_by, cloud_eligible
       ) VALUES (?, ?, ?, ?, ?, 'new', NULL, 60, 'zoom', NULL, '{}', ?, NULL, NULL, ?, NULL, ?,
                 NULL, NULL, NULL, NULL, ?, ?, ?, 0)`
    ).run(
      id,
      validated.sourceDocumentId,
      kind,
      round,
      parent.id,
      parent.interviewer,
      JSON.stringify(questionPlan),
      JSON.stringify(inheritedItems),
      timestamp,
      timestamp,
      updatedBy
    )
    const saved = this.getCandidateInterviewRow(validated.sourceDocumentId, id, kind)
    if (!saved) throw new Error('Follow-up interview could not be created.')
    return this.candidateInterviewFromRow(saved)
  }

  saveCandidateInterviewSchedule(
    input: SaveCandidateInterviewScheduleInput,
    updatedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    const validated = saveCandidateInterviewScheduleInputSchema.parse(input)
    this.assertCandidateInterviewSubject(validated.sourceDocumentId)
    const kind = validated.kind ?? 'recruiting'
    if (kind === 'recruiting') {
      const currentProfile = this.database
        .prepare<[string], { id: string }>(
          "SELECT id FROM candidate_profiles WHERE source_document_id = ? AND status = 'current'"
        )
        .get(validated.sourceDocumentId)
      if (!currentProfile) throw new Error('Confirm the candidate profile before scheduling a recruiting interview.')
    } else {
      const eligibleMembership = this.database
        .prepare<[string], { source_document_id: string }>(
          `SELECT membership.source_document_id
           FROM talent_pool_memberships membership
           JOIN candidate_records record ON record.source_document_id = membership.source_document_id
           JOIN candidate_profiles profile ON profile.source_document_id = membership.source_document_id
           WHERE membership.source_document_id = ? AND membership.status = 'eligible'
             AND record.record_status = 'active' AND profile.status = 'current'`
        )
        .get(validated.sourceDocumentId)
      if (!eligibleMembership) throw new Error('Only eligible talent-pool members can enter a client interview.')
    }
    let current = this.getCandidateInterviewRow(validated.sourceDocumentId, validated.interviewId, kind)
    if (!current && validated.roundNumber) {
      current = this.database
        .prepare<[string, string, number], CandidateInterviewRow>(
          `SELECT * FROM candidate_interview_sessions
           WHERE source_document_id = ? AND kind = ? AND round_number = ?`
        )
        .get(validated.sourceDocumentId, kind, validated.roundNumber) ?? null
    }
    if (current?.decision) throw new Error('A final interview decision is already recorded. Create a follow-up round instead.')
    if (current && !['new', 'contacting', 'scheduled', 'prepared'].includes(current.stage)) {
      throw new Error('An interview already started or is awaiting a decision, so its schedule is locked.')
    }
    const timestamp = now.toISOString()
    const id = current?.id ?? randomUUID()
    const roundNumber = current?.round_number ?? validated.roundNumber ?? 1
    this.database
      .prepare(
        `INSERT INTO candidate_interview_sessions(
           id, source_document_id, kind, round_number, parent_interview_id, stage,
           scheduled_at, duration_minutes, meeting_method, meeting_url, meeting_details_json, interviewer,
           contact_note, interview_goal, question_plan_json, interview_notes, unresolved_items_json,
           decision, decision_reason, decided_at, decided_by, created_at, updated_at, updated_by, cloud_eligible
         ) VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, NULL, '[]', NULL, '[]',
                   NULL, NULL, NULL, NULL, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           stage = 'scheduled', scheduled_at = excluded.scheduled_at,
           duration_minutes = excluded.duration_minutes, meeting_method = excluded.meeting_method,
           meeting_url = excluded.meeting_url, meeting_details_json = excluded.meeting_details_json, interviewer = excluded.interviewer,
           contact_note = excluded.contact_note,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      )
      .run(
        id,
        validated.sourceDocumentId,
        kind,
        roundNumber,
        current?.parent_interview_id ?? validated.parentInterviewId ?? null,
        validated.scheduledAt,
        validated.durationMinutes,
        validated.meetingMethod,
        validated.meetingMethod === 'zoom' || validated.meetingMethod === 'google-meet' ? validated.meetingUrl ?? null : null,
        JSON.stringify(validated.meetingDetails ?? {}),
        validated.interviewer,
        validated.contactNote?.trim() || null,
        timestamp,
        timestamp,
        updatedBy
      )
    if (kind === 'recruiting') {
      this.database.prepare(
        `UPDATE candidate_records SET recruiting_status = 'recruiting', updated_at = ?
         WHERE source_document_id = ? AND recruiting_status IN ('ready-for-recruiting', 'on-hold')`
      ).run(timestamp, validated.sourceDocumentId)
    }
    const saved = this.getCandidateInterviewRow(validated.sourceDocumentId, id, kind)
    if (!saved) throw new Error('Interview schedule could not be saved.')
    return this.candidateInterviewFromRow(saved)
  }

  saveCandidateInterviewPreparation(
    input: SaveCandidateInterviewPreparationInput,
    updatedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    const validated = saveCandidateInterviewPreparationInputSchema.parse(input)
    const row = this.database
      .prepare<[string], CandidateInterviewRow>('SELECT * FROM candidate_interview_sessions WHERE id = ?')
      .get(validated.interviewId)
    if (!row) throw new Error('Interview session was not found.')
    if (row.decision) throw new Error('A completed interview cannot be edited.')
    if (!['scheduled', 'prepared'].includes(row.stage)) {
      throw new Error('Interview questions can only be edited before the interview starts.')
    }
    this.database.prepare(
      `UPDATE candidate_interview_sessions
       SET stage = 'prepared', interview_goal = ?, question_plan_json = ?, unresolved_items_json = ?,
           updated_at = ?, updated_by = ?
       WHERE id = ?`
    ).run(
      validated.interviewGoal?.trim() || null,
      JSON.stringify(validated.questions),
      JSON.stringify(validated.unresolvedItems ?? []),
      now.toISOString(),
      updatedBy,
      validated.interviewId
    )
    const saved = this.database
      .prepare<[string], CandidateInterviewRow>('SELECT * FROM candidate_interview_sessions WHERE id = ?')
      .get(validated.interviewId)
    if (!saved) throw new Error('Interview preparation could not be saved.')
    return this.candidateInterviewFromRow(saved)
  }

  saveCandidateInterviewNotes(
    input: SaveCandidateInterviewNotesInput,
    updatedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    const validated = saveCandidateInterviewNotesInputSchema.parse(input)
    this.assertCandidateInterviewSubject(validated.sourceDocumentId)
    const current = this.getCandidateInterviewRow(validated.sourceDocumentId, validated.interviewId)
    if (!current) throw new Error('Interview session was not found.')
    if (current.decision) throw new Error('A final interview decision is already recorded. Reopen the candidate before editing interview notes.')
    if (!['prepared', 'interviewing'].includes(current.stage)) {
      throw new Error('Interview notes can only be edited while the interview is in progress.')
    }
    const timestamp = now.toISOString()
    const stage = validated.stage ?? 'interviewing'
    const id = current.id
    const unresolvedItems = validated.unresolvedItems ?? (current
      ? JSON.parse(current.unresolved_items_json) as string[]
      : [])
    this.database
      .prepare(
        `INSERT INTO candidate_interview_sessions(
           id, source_document_id, kind, round_number, parent_interview_id, stage,
           scheduled_at, duration_minutes, meeting_method, meeting_url, meeting_details_json, interviewer,
           contact_note, interview_goal, question_plan_json, interview_notes, unresolved_items_json,
           decision, decision_reason, decided_at, decided_by, created_at, updated_at, updated_by, cloud_eligible
         ) VALUES (?, ?, 'recruiting', 1, NULL, ?, NULL, 60, 'zoom', NULL, '{}', NULL,
                   NULL, NULL, '[]', ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           stage = excluded.stage, interview_notes = excluded.interview_notes,
           unresolved_items_json = excluded.unresolved_items_json,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      )
      .run(
        id,
        validated.sourceDocumentId,
        stage,
        validated.interviewNotes || null,
        JSON.stringify(unresolvedItems),
        timestamp,
        timestamp,
        updatedBy
      )
    const saved = this.getCandidateInterviewRow(validated.sourceDocumentId, id)
    if (!saved) throw new Error('Interview notes could not be saved.')
    return this.candidateInterviewFromRow(saved)
  }

  recordCandidateInterviewDecision(
    input: RecordCandidateInterviewDecisionInput,
    decidedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    const validated = recordCandidateInterviewDecisionInputSchema.parse(input)
    this.assertCandidateInterviewSubject(validated.sourceDocumentId)
    const current = this.getCandidateInterviewRow(validated.sourceDocumentId, validated.interviewId)
    if (!current) throw new Error('Interview session was not found.')
    if (current.stage !== 'awaiting-decision') {
      throw new Error('Complete the interview record before recording a decision.')
    }
    const timestamp = now.toISOString()
    const stage = validated.decision === 'passed'
      ? 'passed'
      : validated.decision === 'on-hold' || validated.decision === 'next-round'
        ? 'on-hold'
        : 'closed'
    const id = current.id
    return this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO candidate_interview_sessions(
             id, source_document_id, kind, round_number, parent_interview_id, stage,
             scheduled_at, duration_minutes, meeting_method, meeting_url, meeting_details_json, interviewer,
             contact_note, interview_goal, question_plan_json, interview_notes, unresolved_items_json,
             decision, decision_reason, decided_at, decided_by, created_at, updated_at, updated_by, cloud_eligible
           ) VALUES (?, ?, 'recruiting', 1, NULL, ?, NULL, 60, 'zoom', NULL, '{}', NULL,
                     NULL, NULL, '[]', NULL, '[]', ?, ?, ?, ?, ?, ?, ?, 0)
           ON CONFLICT(id) DO UPDATE SET
             stage = excluded.stage, decision = excluded.decision, decision_reason = excluded.decision_reason,
             decided_at = excluded.decided_at, decided_by = excluded.decided_by,
             updated_at = excluded.updated_at, updated_by = excluded.updated_by`
        )
        .run(
          id,
          validated.sourceDocumentId,
          stage,
          validated.decision,
          validated.decisionReason,
          timestamp,
          decidedBy,
          timestamp,
          timestamp,
          decidedBy
        )
      if (current.kind === 'recruiting') {
        const recruitingStatus = validated.decision === 'passed'
          ? 'passed'
          : validated.decision === 'failed'
            ? 'rejected'
            : validated.decision === 'withdrawn'
              ? 'withdrawn'
              : validated.decision === 'no-show'
                ? 'no-show'
                : validated.decision === 'on-hold' || validated.decision === 'next-round'
                  ? 'on-hold'
                  : 'recruiting'
        const updated = this.database.prepare(
          'UPDATE candidate_records SET recruiting_status = ?, updated_at = ? WHERE source_document_id = ?'
        ).run(recruitingStatus, timestamp, validated.sourceDocumentId)
        if (updated.changes !== 1) throw new Error('Candidate recruiting state could not be updated.')
        if (validated.decision === 'passed') {
          this.database.prepare(
            `INSERT INTO talent_pool_memberships(source_document_id, status, admitted_interview_id, admitted_at, admitted_by, reason, updated_at)
             VALUES (?, 'eligible', ?, ?, ?, ?, ?)
             ON CONFLICT(source_document_id) DO UPDATE SET
               status = 'eligible', admitted_interview_id = excluded.admitted_interview_id,
               admitted_at = excluded.admitted_at, admitted_by = excluded.admitted_by,
               reason = excluded.reason, updated_at = excluded.updated_at`
          ).run(validated.sourceDocumentId, current.id, timestamp, decidedBy, validated.decisionReason, timestamp)
        }
      }
      const saved = this.getCandidateInterviewRow(validated.sourceDocumentId, id)
      if (!saved) throw new Error('Interview decision could not be saved.')
      return this.candidateInterviewFromRow(saved)
    })()
  }

  /** Only explicitly admitted, current profiles may reach matching or proposals. */
  listEligibleTalentProfiles(): CandidateProfile[] {
    return this.database
      .prepare<[], CandidateProfileRow>(
        `SELECT profile.profile_json, profile.status
         FROM candidate_profiles profile
         JOIN candidate_records record ON record.source_document_id = profile.source_document_id
         JOIN talent_pool_memberships membership ON membership.source_document_id = profile.source_document_id
         WHERE profile.status = 'current'
           AND record.record_status = 'active'
           AND membership.status = 'eligible'
         ORDER BY profile.confirmed_at DESC`
      )
      .all()
      .map((row) => candidateProfileSchema.parse(JSON.parse(row.profile_json)))
  }

  listCandidateProfileEmbeddings(modelId: string, modelRevision: string): CandidateProfileEmbeddingRecord[] {
    assertEmbeddingIdentity(modelId, modelRevision)
    return this.database
      .prepare<[string, string], CandidateProfileEmbeddingRow>(
        `SELECT profile_id, content_hash, vector_dimension, vector_blob, updated_at
         FROM candidate_profile_embeddings
         WHERE model_id = ? AND model_revision = ?`
      )
      .all(modelId, modelRevision)
      .map((row) => ({
        profileId: row.profile_id,
        modelId,
        modelRevision,
        contentHash: row.content_hash,
        vector: embeddingVectorFromRow(row),
        updatedAt: row.updated_at
      }))
  }

  saveCandidateProfileEmbeddings(records: CandidateProfileEmbeddingInput[], now = new Date()): void {
    if (records.length === 0) return
    const upsert = this.database.prepare(
      `INSERT INTO candidate_profile_embeddings(
         profile_id, model_id, model_revision, content_hash, vector_dimension, vector_blob, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, model_id, model_revision) DO UPDATE SET
         content_hash = excluded.content_hash,
         vector_dimension = excluded.vector_dimension,
         vector_blob = excluded.vector_blob,
         updated_at = excluded.updated_at`
    )
    const updatedAt = now.toISOString()
    this.database.transaction(() => {
      for (const record of records) {
        assertEmbeddingIdentity(record.modelId, record.modelRevision)
        if (!/^[a-f0-9]{64}$/u.test(record.contentHash)) throw new Error('Embedding content hash is invalid.')
        const vectorBlob = embeddingVectorToBlob(record.vector)
        upsert.run(
          record.profileId,
          record.modelId,
          record.modelRevision,
          record.contentHash,
          record.vector.length,
          vectorBlob,
          updatedAt,
          updatedAt
        )
      }
    })()
  }

  listCandidateProjectEmbeddings(modelId: string, modelRevision: string): CandidateProjectEmbeddingRecord[] {
    assertEmbeddingIdentity(modelId, modelRevision)
    return this.database
      .prepare<[string, string], CandidateProjectEmbeddingRow>(
        `SELECT profile_id, project_id, content_hash, vector_dimension, vector_blob, updated_at
         FROM candidate_project_embeddings
         WHERE model_id = ? AND model_revision = ?`
      )
      .all(modelId, modelRevision)
      .map((row) => ({
        profileId: row.profile_id,
        projectId: row.project_id,
        modelId,
        modelRevision,
        contentHash: row.content_hash,
        vector: embeddingVectorFromRow(row),
        updatedAt: row.updated_at
      }))
  }

  saveCandidateProjectEmbeddings(records: CandidateProjectEmbeddingInput[], now = new Date()): void {
    if (records.length === 0) return
    const upsert = this.database.prepare(
      `INSERT INTO candidate_project_embeddings(
         profile_id, project_id, model_id, model_revision, content_hash,
         vector_dimension, vector_blob, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, project_id, model_id, model_revision) DO UPDATE SET
         content_hash = excluded.content_hash,
         vector_dimension = excluded.vector_dimension,
         vector_blob = excluded.vector_blob,
         updated_at = excluded.updated_at`
    )
    const profileLookup = this.database.prepare<[string], { profile_json: string }>(
      'SELECT profile_json FROM candidate_profiles WHERE id = ?'
    )
    const updatedAt = now.toISOString()
    this.database.transaction(() => {
      for (const record of records) {
        assertEmbeddingIdentity(record.modelId, record.modelRevision)
        if (!/^[a-f0-9]{64}$/u.test(record.contentHash)) throw new Error('Project embedding content hash is invalid.')
        if (!/^[0-9a-f-]{36}$/iu.test(record.profileId) || !/^[0-9a-f-]{36}$/iu.test(record.projectId)) {
          throw new Error('Project embedding identity is invalid.')
        }
        const profileRow = profileLookup.get(record.profileId)
        const profile = profileRow ? candidateProfileSchema.parse(JSON.parse(profileRow.profile_json)) : null
        if (!profile?.projectExperiences.some((project) => project.id === record.projectId)) {
          throw new Error('Project embedding does not belong to the candidate profile.')
        }
        const vectorBlob = embeddingVectorToBlob(record.vector)
        upsert.run(
          record.profileId,
          record.projectId,
          record.modelId,
          record.modelRevision,
          record.contentHash,
          record.vector.length,
          vectorBlob,
          updatedAt,
          updatedAt
        )
      }
    })()
  }

  countEligibleTalentProfiles(): number {
    return this.database
      .prepare<[], { count: number }>(
        `SELECT count(*) AS count
         FROM candidate_profiles profile
         JOIN candidate_records record ON record.source_document_id = profile.source_document_id
         JOIN talent_pool_memberships membership ON membership.source_document_id = profile.source_document_id
         WHERE profile.status = 'current'
           AND record.record_status = 'active'
           AND membership.status = 'eligible'`
      )
      .get()?.count ?? 0
  }

  getCandidateProfileHistory(sourceDocumentId: string): CandidateProfileVersionDetail[] {
    return this.database
      .prepare<[string], CandidateProfileRow>(
        'SELECT profile_json, status FROM candidate_profiles WHERE source_document_id = ? ORDER BY version DESC'
      )
      .all(sourceDocumentId)
      .map((row) => {
        const profile = candidateProfileSchema.parse(JSON.parse(row.profile_json))
        return {
          id: profile.id,
          sourceDocumentId: profile.sourceDocumentId,
          version: profile.profileVersion,
          status: row.status,
          confirmedAt: profile.confirmedAt,
          confirmedBy: profile.confirmedBy,
          containsDirectIdentifiers: profile.containsDirectIdentifiers,
          reviewRevision: profile.reviewRevision,
          fields: profile.fields,
          projectExperiences: profile.projectExperiences
        }
      })
  }


  previewCandidateDeletion(sourceDocumentId: string): CandidateDeletionPreview {
    const file = this.getStagedFileRecords([sourceDocumentId])[0]
    if (!file) throw new Error('Candidate source file was not found.')
    const history = this.getCandidateProfileHistory(sourceDocumentId)
    if (history.length === 0) throw new Error('Candidate profile was not found.')
    const taskRecords = this.listWorkTasks().filter((task) =>
      task.contextBindings.some((binding) => binding.objectType === 'staged-file' && binding.objectId === sourceDocumentId)
    ).length
    const reviewAudits = this.database
      .prepare<[string, string], { count: number }>(
        `SELECT
           (SELECT count(*) FROM candidate_field_review_audits WHERE document_id = ?) +
           (SELECT count(*) FROM candidate_project_review_audits WHERE document_id = ?) AS count`
      )
      .get(sourceDocumentId, sourceDocumentId)?.count ?? 0
    const matchRecords = this.database
      .prepare<[string], { count: number }>(
        `SELECT count(*) AS count FROM candidate_match_results result
         JOIN candidate_profiles profile ON profile.id = result.candidate_profile_id
         WHERE profile.source_document_id = ?`
      )
      .get(sourceDocumentId)?.count ?? 0
    const evaluationDatasetIds = this.candidateEvaluationDatasetIdsForLabels(new Set(
      history.map((profile) => `候補者 ${profile.id.slice(0, 8).toLocaleUpperCase('en-US')}`)
    ))
    const persistedEvaluationRecords = evaluationDatasetIds.reduce((total, datasetId) =>
      total + 1 + (this.database
        .prepare<[string], { count: number }>('SELECT count(*) AS count FROM candidate_evaluation_reports WHERE dataset_id = ?')
        .get(datasetId)?.count ?? 0), 0)
    const draftEvaluationLabels = this.database
      .prepare<[string], { count: number }>(
        `SELECT count(*) AS count FROM candidate_evaluation_draft_labels label
         JOIN candidate_profiles profile ON profile.id = label.candidate_profile_id
         WHERE profile.source_document_id = ?`
      )
      .get(sourceDocumentId)?.count ?? 0
    const evaluationRecords = persistedEvaluationRecords + draftEvaluationLabels
    const proposalDrafts = this.database
      .prepare<[string], { count: number }>(
        `SELECT count(*) AS count FROM proposal_drafts proposal
         JOIN candidate_profiles profile ON profile.id = proposal.candidate_profile_id
         WHERE profile.source_document_id = ?`
      )
      .get(sourceDocumentId)?.count ?? 0
    const redactionSessionId = this.getRedactionSessionIdForDocument(sourceDocumentId)
    const piiMappings = redactionSessionId
      ? this.database
          .prepare<[string], { count: number }>(
            'SELECT count(*) AS count FROM local_pii_mappings WHERE redaction_session_id = ?'
          )
          .get(redactionSessionId)?.count ?? 0
      : 0
    const searchIndexEntries = this.database
      .prepare<[string, string], { count: number }>(
        `SELECT
           (SELECT count(*) FROM candidate_profile_embeddings embedding
            JOIN candidate_profiles profile ON profile.id = embedding.profile_id
            WHERE profile.source_document_id = ?) +
           (SELECT count(*) FROM candidate_project_embeddings embedding
            JOIN candidate_profiles profile ON profile.id = embedding.profile_id
            WHERE profile.source_document_id = ?) AS count`
      )
      .get(sourceDocumentId, sourceDocumentId)?.count ?? 0
    const agentMatchRows = this.database
      .prepare<[string], { run_id: string; result_id: string }>(
        `SELECT result.run_id, result.id AS result_id
         FROM candidate_match_results result
         JOIN candidate_profiles profile ON profile.id = result.candidate_profile_id
         WHERE profile.source_document_id = ?`
      )
      .all(sourceDocumentId)
    const agentReferences = this.countSalesAgentReferences({
      jobCaseIds: new Set(),
      matchRunIds: new Set(agentMatchRows.map((row) => row.run_id)),
      matchResultIds: new Set(agentMatchRows.map((row) => row.result_id))
    })
    const counts = {
      profileVersions: history.length,
      reviewAudits,
      taskRecords,
      matchRecords,
      evaluationRecords,
      proposalDrafts,
      piiMappings,
      searchIndexEntries,
      encryptedFiles: 1,
      agentReferences
    }
    const confirmationHash = createHash('sha256').update(JSON.stringify({
      sourceDocumentId,
      fileSha256: file.sha256,
      latestProfileId: history[0]?.id,
      latestVersion: history[0]?.version,
      counts
    })).digest('hex')
    return candidateDeletionPreviewSchema.parse({
      sourceDocumentId,
      anonymousLabel: `候補者 ${history[0]?.id.slice(0, 8).toLocaleUpperCase('en-US')}`,
      localFileName: file.name,
      counts,
      confirmationHash,
      warningCodes: ['EXTERNAL_EXPORTS_OUTSIDE_SCOPE', 'BACKUP_SYSTEM_NOT_CONFIGURED']
    })
  }

  deleteCandidateDatabaseData(sourceDocumentId: string, expectedConfirmationHash: string, now = new Date()): CandidateDeletionPreview {
    const preview = this.previewCandidateDeletion(sourceDocumentId)
    if (preview.confirmationHash !== expectedConfirmationHash) {
      throw new Error('Candidate deletion preview changed. Review the impact again before deleting.')
    }
    const taskIds = this.listWorkTasks()
      .filter((task) => task.contextBindings.some((binding) =>
        binding.objectType === 'staged-file' && binding.objectId === sourceDocumentId
      ))
      .map((task) => task.id)
    const profileIds = this.database
      .prepare<[string], { id: string }>('SELECT id FROM candidate_profiles WHERE source_document_id = ?')
      .all(sourceDocumentId)
      .map((row) => row.id)
    const agentMatchRows = this.database
      .prepare<[string], { run_id: string; result_id: string }>(
        `SELECT result.run_id, result.id AS result_id
         FROM candidate_match_results result
         JOIN candidate_profiles profile ON profile.id = result.candidate_profile_id
         WHERE profile.source_document_id = ?`
      )
      .all(sourceDocumentId)
    const agentTargets: AgentReferenceTargets = {
      jobCaseIds: new Set(),
      matchRunIds: new Set(agentMatchRows.map((row) => row.run_id)),
      matchResultIds: new Set(agentMatchRows.map((row) => row.result_id))
    }
    const evaluationDatasetIds = this.candidateEvaluationDatasetIdsForLabels(new Set(
      profileIds.map((profileId) => `候補者 ${profileId.slice(0, 8).toLocaleUpperCase('en-US')}`)
    ))
    const redactionSessionId = this.getRedactionSessionIdForDocument(sourceDocumentId)
    const remove = this.database.transaction(() => {
      this.sanitizeSalesAgentConversations(agentTargets, now)
      if (redactionSessionId) {
        this.database.prepare('DELETE FROM local_pii_mappings WHERE redaction_session_id = ?').run(redactionSessionId)
      }
      for (const taskId of taskIds) {
        this.database.prepare('DELETE FROM work_tasks WHERE id = ?').run(taskId)
        this.database.prepare("DELETE FROM change_outbox WHERE entity_type = 'work_task' AND entity_id = ?").run(taskId)
      }
      for (const profileId of profileIds) {
        this.database.prepare("DELETE FROM change_outbox WHERE entity_type = 'candidate_profile' AND entity_id = ?").run(profileId)
      }
      for (const datasetId of evaluationDatasetIds) {
        this.database.prepare('DELETE FROM candidate_evaluation_datasets WHERE id = ?').run(datasetId)
      }
      this.database.prepare('DELETE FROM candidate_profiles WHERE source_document_id = ?').run(sourceDocumentId)
      const deleted = this.database.prepare('DELETE FROM staged_files WHERE token = ?').run(sourceDocumentId)
      if (deleted.changes !== 1) throw new Error('Candidate source record could not be deleted.')
      this.database
        .prepare(
          'INSERT INTO change_outbox(id, entity_type, entity_id, revision, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), 'candidate', sourceDocumentId, 1, 'delete', now.toISOString())
    })
    remove()
    return preview
  }

  saveDataDeletionReport<T extends DataDeletionReport>(input: T): T {
    const report = dataDeletionReportSchema.parse(input)
    this.database
      .prepare(
        `INSERT INTO data_deletion_reports(
           id, entity_type, entity_id_hash, report_json, outcome, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           report_json = excluded.report_json,
           outcome = excluded.outcome,
           completed_at = excluded.completed_at`
      )
      .run(
        report.id,
        report.entityType,
        report.entityIdHash,
        JSON.stringify(report),
        report.outcome,
        report.completedAt
      )
    return report as T
  }

  listDataDeletionReports(): DataDeletionReport[] {
    return this.database
      .prepare<[], DataDeletionReportRow>(
        'SELECT report_json FROM data_deletion_reports ORDER BY completed_at DESC LIMIT 200'
      )
      .all()
      .map((row) => dataDeletionReportSchema.parse(JSON.parse(row.report_json)))
  }

  confirmCandidateReview(
    input: SubmitCandidateReviewInput,
    reviewerId: string,
    reviewerDisplayName: string,
    now = new Date()
  ): CandidateReviewSnapshot {
    const validated = submitCandidateReviewInputSchema.parse(input)
    const draft = this.getCandidateExtraction(validated.documentId)
    if (!draft) throw new Error('Candidate extraction draft was not found.')
    const state = this.database
      .prepare<[string], CandidateReviewStateRow>('SELECT * FROM candidate_review_states WHERE document_id = ?')
      .get(validated.documentId)
    if (!state) throw new Error('Candidate review state was not found.')
    if (state.status !== 'awaiting-review') throw new Error('Candidate review is already completed.')
    if (state.revision !== validated.reviewRevision) throw new Error('Candidate review changed. Reload before confirming.')

    const submissionByKey = new Map(validated.fields.map((field) => [field.key, field]))
    if (submissionByKey.size !== draft.fields.length || draft.fields.some((field) => !submissionByKey.has(field.key))) {
      throw new Error('Every candidate field must be explicitly confirmed exactly once.')
    }
    for (const field of draft.fields) {
      const submitted = submissionByKey.get(field.key)
      if (!submitted) throw new Error(`Candidate field ${field.key} was not confirmed.`)
    }
    const workAuthorization = submissionByKey.get('work_authorization')?.value
    if (workAuthorization && !(candidateWorkAuthorizationValues as readonly string[]).includes(workAuthorization)) {
      throw new Error('Work authorization must use a compliance category; nationality or raw residence-status text cannot be stored.')
    }
    const submittedProjects = validated.projectExperiences
    const submittedProjectIds = new Set(submittedProjects.map((project) => project.draftId))
    if (submittedProjectIds.size !== submittedProjects.length) throw new Error('Project experience IDs must be unique.')
    const draftProjectsById = new Map(draft.projectExperiences.map((project) => [project.draftId, project]))
    const projectPayload = (project: {
      title: string
      period: string | null
      role: string | null
      technologies: string[]
      summary: string
    }) => ({
      title: project.title,
      period: project.period,
      role: project.role,
      technologies: [...new Set(project.technologies)],
      summary: project.summary
    })
    const candidateContent = [
      ...validated.fields.map((field) => field.value ?? ''),
      ...submittedProjects.flatMap((project) => [
        project.title,
        project.period ?? '',
        project.role ?? '',
        ...project.technologies,
        project.summary
      ])
    ].join('\n')
    const containsDirectIdentifiers = detectDirectIdentifiers(candidateContent).length > 0
    const localIdentity = this.getCandidateLocalIdentity(validated.documentId)
    const { storage: _storage, cloudEligible: _cloudEligible, ...localPersonalDetails } = localIdentity

    const reviewedAt = now.toISOString()
    const save = this.database.transaction(() => {
      const current = this.database
        .prepare<[string], CandidateReviewStateRow>('SELECT * FROM candidate_review_states WHERE document_id = ?')
        .get(validated.documentId)
      if (!current || current.status !== 'awaiting-review' || current.revision !== validated.reviewRevision) {
        throw new Error('Candidate review changed while it was being confirmed.')
      }
      const latestVersion = this.database
        .prepare<[string], { version: number | null }>(
          'SELECT max(version) AS version FROM candidate_profiles WHERE source_document_id = ?'
        )
        .get(validated.documentId)?.version ?? 0
      const profileVersion = latestVersion + 1
      const profileId = randomUUID()
      const projectRecords: Array<{ draftId: string; project: CandidateProjectExperience; changed: boolean }> =
        submittedProjects.map((submitted) => {
          const original = draftProjectsById.get(submitted.draftId)
          const changed = !original || JSON.stringify(projectPayload(original)) !== JSON.stringify(projectPayload(submitted))
          return {
            draftId: submitted.draftId,
            changed,
            project: {
              id: randomUUID(),
              ...projectPayload(submitted),
              sourceLabels: original
                ? [...new Set(original.sources.map((source) => source.sourceLabel))]
                : []
            }
          }
        })
      const profile: CandidateProfile = candidateProfileSchema.parse({
        schemaVersion: 'candidate-profile-v1',
        id: profileId,
        sourceDocumentId: validated.documentId,
        profileVersion,
        reviewRevision: validated.reviewRevision,
        localPersonalDetails,
        fields: draft.fields.map((field) => ({
          key: field.key,
          label: field.label,
          value: submissionByKey.get(field.key)?.value ?? null,
          sourceLabels: [...new Set(field.sources.map((source) => source.sourceLabel))]
        })),
        projectExperiences: projectRecords.map((record) => record.project),
        confirmedAt: reviewedAt,
        confirmedBy: reviewerDisplayName,
        // This flag covers the anonymous matching payload (fields/projects).
        // Local-only personal details are excluded from retrieval and cloud prompts.
        containsDirectIdentifiers
      })
      this.database
        .prepare("UPDATE candidate_profiles SET status = 'superseded' WHERE source_document_id = ? AND status = 'current'")
        .run(validated.documentId)
      this.database
        .prepare(
          `INSERT INTO candidate_profiles(
             id, source_document_id, version, profile_json, status, confirmed_at, confirmed_by
           ) VALUES (?, ?, ?, ?, 'current', ?, ?)`
        )
        .run(profileId, validated.documentId, profileVersion, JSON.stringify(profile), reviewedAt, reviewerDisplayName)

      const insertAudit = this.database.prepare(
        `INSERT INTO candidate_field_review_audits(
           id, document_id, review_revision, field_key, original_value, confirmed_value,
           change_reason, source_labels_json, reviewer_id, reviewed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const field of draft.fields) {
        const submitted = submissionByKey.get(field.key)
        if (!submitted) continue
        insertAudit.run(
          randomUUID(),
          validated.documentId,
          validated.reviewRevision,
          field.key,
          field.value,
          submitted.value,
          submitted.changeReason ?? null,
          JSON.stringify([...new Set(field.sources.map((source) => source.sourceLabel))]),
          reviewerId,
          reviewedAt
        )
      }
      const insertProjectAudit = this.database.prepare(
        `INSERT INTO candidate_project_review_audits(
           id, document_id, review_revision, draft_id, project_id, original_json,
           confirmed_json, change_reason, source_labels_json, reviewer_id, reviewed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const record of projectRecords) {
        const original = draftProjectsById.get(record.draftId)
        insertProjectAudit.run(
          randomUUID(),
          validated.documentId,
          validated.reviewRevision,
          record.draftId,
          record.project.id,
          original ? JSON.stringify(original) : null,
          JSON.stringify(record.project),
          record.changed ? validated.projectChangeReason ?? null : null,
          JSON.stringify(record.project.sourceLabels),
          reviewerId,
          reviewedAt
        )
      }
      for (const removed of draft.projectExperiences.filter((project) => !submittedProjectIds.has(project.draftId))) {
        insertProjectAudit.run(
          randomUUID(),
          validated.documentId,
          validated.reviewRevision,
          removed.draftId,
          null,
          JSON.stringify(removed),
          null,
          validated.projectChangeReason ?? null,
          JSON.stringify([...new Set(removed.sources.map((source) => source.sourceLabel))]),
          reviewerId,
          reviewedAt
        )
      }
      const update = this.database
        .prepare(
          `UPDATE candidate_review_states SET
             status = 'completed', pii_reviewed = ?, reviewer_id = ?, reviewer_display_name = ?,
             completed_at = ?, updated_at = ?
           WHERE document_id = ? AND revision = ? AND status = 'awaiting-review'`
        )
        .run(
          validated.piiReviewed ? 1 : 0,
          reviewerId,
          reviewerDisplayName,
          reviewedAt,
          reviewedAt,
          validated.documentId,
          validated.reviewRevision
        )
      if (update.changes !== 1) throw new Error('Candidate review could not be committed.')
      this.database
        .prepare(`UPDATE candidate_records
                  SET recruiting_status = 'ready-for-recruiting', updated_at = ?
                  WHERE source_document_id = ? AND recruiting_status = 'pending-review'`)
        .run(reviewedAt, validated.documentId)
      this.database
        .prepare(
          'INSERT INTO change_outbox(id, entity_type, entity_id, revision, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), 'candidate_profile', profileId, profileVersion, 'upsert', reviewedAt)
    })
    save()
    const result = this.getCandidateReview(validated.documentId)
    if (!result) throw new Error('Confirmed candidate review could not be reloaded.')
    return result
  }

  updateCandidateProfile(
    input: UpdateCandidateProfileInput,
    reviewerId: string,
    reviewerDisplayName: string,
    now = new Date()
  ): CandidateProfile {
    const validated = updateCandidateProfileInputSchema.parse(input)
    const currentRow = this.database
      .prepare<[string], CandidateProfileRow>(
        "SELECT profile_json, status FROM candidate_profiles WHERE source_document_id = ? AND status = 'current'"
      )
      .get(validated.sourceDocumentId)
      if (!currentRow) throw new Error('Current candidate profile was not found.')
    const current = candidateProfileSchema.parse(JSON.parse(currentRow.profile_json))
    if (current.profileVersion !== validated.expectedVersion) {
      throw new Error('人材プロフィールが更新されました。再読み込みしてから編集してください。')
    }

    const fieldsByKey = new Map(validated.fields.map((field) => [field.key, field]))
    if (fieldsByKey.size !== current.fields.length || current.fields.some((field) => !fieldsByKey.has(field.key))) {
      throw new Error('Every candidate field must be supplied exactly once.')
    }
    const workAuthorization = fieldsByKey.get('work_authorization')?.value
    if (workAuthorization && !(candidateWorkAuthorizationValues as readonly string[]).includes(workAuthorization)) {
      throw new Error('Work authorization must use a compliance category; nationality or raw residence-status text cannot be stored.')
    }
    const projectIds = new Set(validated.projectExperiences.map((project) => project.id))
    if (projectIds.size !== validated.projectExperiences.length) throw new Error('Project experience IDs must be unique.')

    const timestamp = now.toISOString()
    const currentProjects = new Map(current.projectExperiences.map((project) => [project.id, project]))
    const candidateContent = [
      ...validated.fields.map((field) => field.value ?? ''),
      ...validated.projectExperiences.flatMap((project) => [
        project.title,
        project.period ?? '',
        project.role ?? '',
        ...project.technologies,
        project.summary
      ])
    ].join('\n')
    const profile = candidateProfileSchema.parse({
      schemaVersion: 'candidate-profile-v1',
      id: randomUUID(),
      sourceDocumentId: current.sourceDocumentId,
      profileVersion: current.profileVersion + 1,
      reviewRevision: current.reviewRevision,
      localPersonalDetails: validated.identity,
      fields: current.fields.map((field) => ({
        ...field,
        value: fieldsByKey.get(field.key)?.value ?? null
      })),
      projectExperiences: validated.projectExperiences.map((project) => ({
        id: currentProjects.get(project.id)?.id ?? randomUUID(),
        title: project.title,
        period: project.period,
        role: project.role,
        technologies: [...new Set(project.technologies)],
        summary: project.summary,
        sourceLabels: currentProjects.get(project.id)?.sourceLabels ?? []
      })),
      confirmedAt: timestamp,
      confirmedBy: reviewerDisplayName,
      containsDirectIdentifiers: detectDirectIdentifiers(candidateContent).length > 0
    })

    const save = this.database.transaction(() => {
      const latestRow = this.database
        .prepare<[string], CandidateProfileRow>(
          "SELECT profile_json, status FROM candidate_profiles WHERE source_document_id = ? AND status = 'current'"
        )
        .get(validated.sourceDocumentId)
      const latest = latestRow ? candidateProfileSchema.parse(JSON.parse(latestRow.profile_json)) : null
      if (!latest || latest.profileVersion !== validated.expectedVersion) {
        throw new Error('人材プロフィールが編集中に更新されました。再読み込みしてください。')
      }

      this.database
        .prepare("UPDATE candidate_profiles SET status = 'superseded' WHERE source_document_id = ? AND status = 'current'")
        .run(validated.sourceDocumentId)
      this.database
        .prepare(
          `INSERT INTO candidate_profiles(
             id, source_document_id, version, profile_json, status, confirmed_at, confirmed_by
           ) VALUES (?, ?, ?, ?, 'current', ?, ?)`
        )
        .run(profile.id, profile.sourceDocumentId, profile.profileVersion, JSON.stringify(profile), timestamp, reviewerDisplayName)

      const sessionId = this.getRedactionSessionIdForDocument(validated.sourceDocumentId)
      const session = sessionId ? this.getRedactionSession(sessionId) : null
      if (!sessionId || !session) throw new Error('Local identity encryption session was not found.')
      const currentMappings = this.getLocalPiiMappings(sessionId)
      const identityValues: Array<{
        identifierType: LocalPiiMapping['identifierType']
        placeholderPrefix: string
        value: string | null
      }> = [
        { identifierType: 'person_name', placeholderPrefix: 'PERSON_NAME', value: validated.identity.displayName },
        { identifierType: 'phone', placeholderPrefix: 'PHONE', value: validated.identity.phone },
        { identifierType: 'private_email', placeholderPrefix: 'PRIVATE_EMAIL', value: validated.identity.email },
        { identifierType: 'postal_address', placeholderPrefix: 'ADDRESS', value: validated.identity.address },
        { identifierType: 'birth_date', placeholderPrefix: 'BIRTH_DATE', value: validated.identity.birthDate },
        { identifierType: 'nationality', placeholderPrefix: 'NATIONALITY', value: validated.identity.nationality }
      ]
      const identityTypes = new Set(identityValues.map((entry) => entry.identifierType))
      const nextMappings = currentMappings.filter((mapping) => !identityTypes.has(mapping.identifierType))
      const usedPlaceholders = new Set(nextMappings.map((mapping) => mapping.placeholder))
      for (const entry of identityValues) {
        if (!entry.value) continue
        const existing = currentMappings.find((mapping) => mapping.identifierType === entry.identifierType)
        let placeholder = existing?.placeholder ?? `<LOCAL_${entry.placeholderPrefix}_001>`
        let suffix = 1
        while (usedPlaceholders.has(placeholder)) {
          suffix += 1
          placeholder = `<LOCAL_${entry.placeholderPrefix}_${String(suffix).padStart(3, '0')}>`
        }
        usedPlaceholders.add(placeholder)
        nextMappings.push({ placeholder, identifierType: entry.identifierType, originalValue: entry.value })
      }
      this.persistRedactionSession(session, nextMappings)
      this.database
        .prepare(
          'INSERT INTO change_outbox(id, entity_type, entity_id, revision, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), 'candidate_profile', profile.id, profile.profileVersion, 'upsert', timestamp)
    })
    save()
    return profile
  }

  getRedactionSessionIdForDocument(documentId: string): string | null {
    return this.database
      .prepare<[string], RedactionSessionIdRow>('SELECT redaction_session_id FROM parsed_documents WHERE document_id = ?')
      .get(documentId)?.redaction_session_id ?? null
  }

  getParsedDocument(fileToken: string): DocumentIR | null {
    const row = this.database
      .prepare<[string], ParsedDocumentRow>('SELECT document_ir_json, analysis_summary_json FROM parsed_documents WHERE document_id = ?')
      .get(fileToken)
    return row ? documentIrSchema.parse(JSON.parse(row.document_ir_json)) : null
  }

  getResumeAnalysis(fileToken: string): ResumeAnalysisSummary | null {
    const row = this.database
      .prepare<[string], ParsedDocumentRow>('SELECT document_ir_json, analysis_summary_json FROM parsed_documents WHERE document_id = ?')
      .get(fileToken)
    return row ? resumeAnalysisSummarySchema.parse(JSON.parse(row.analysis_summary_json)) : null
  }

  listResumeAnalyses(): ResumeAnalysisSummary[] {
    const rows = this.database
      .prepare<[], ParsedDocumentRow>(
        'SELECT document_ir_json, analysis_summary_json FROM parsed_documents ORDER BY analyzed_at DESC'
      )
      .all()
    return rows.map((row) => resumeAnalysisSummarySchema.parse(JSON.parse(row.analysis_summary_json)))
  }

  private salesAgentKnownPersonNames(targets: AgentReferenceTargets): string[] {
    if (targets.matchRunIds.size === 0 && targets.matchResultIds.size === 0) return []
    const targetRows = this.database
      .prepare<[], { id: string; run_id: string; candidate_profile_id: string }>(
        'SELECT id, run_id, candidate_profile_id FROM candidate_match_results'
      )
      .all()
      .filter((row) => targets.matchRunIds.has(row.run_id) || targets.matchResultIds.has(row.id))
    const profileIds = [...new Set(targetRows.map((row) => row.candidate_profile_id))]
    if (profileIds.length === 0) return []
    const placeholders = profileIds.map(() => '?').join(', ')
    const sourceDocumentIds = this.database
      .prepare<string[], { source_document_id: string }>(
        `SELECT DISTINCT source_document_id FROM candidate_profiles WHERE id IN (${placeholders})`
      )
      .all(...profileIds)
      .map((row) => row.source_document_id)
    return [...new Set(sourceDocumentIds.flatMap((sourceDocumentId) => {
      const displayName = this.getCandidateLocalIdentity(sourceDocumentId).displayName
      return displayName ? [displayName] : []
    }))]
  }

  private countSalesAgentReferences(targets: AgentReferenceTargets): AgentReferenceImpact {
    const rows = this.database
      .prepare<[], AiConversationRow>(
        `SELECT id, assistant_type, context_key, candidate_document_id, interview_id, interview_kind,
                round_number, title, payload_json, revision, created_at, updated_at
         FROM ai_conversations
         WHERE assistant_type = 'sales-agent'
         ORDER BY updated_at DESC
         LIMIT 50`
      )
      .all()
    const knownPersonNames = this.salesAgentKnownPersonNames(targets)
    let conversations = 0
    let messages = 0
    for (const row of rows) {
      const snapshot = aiConversationFromRow(row)
      const affectedMessages = snapshot.messages.filter((message) => agentMessageHasTarget(message, targets)).length
      const state = snapshot.salesAgentState
      const affectedState = Boolean(
        state && (
          (state.selectedJobCaseRef && agentReferenceIsTargeted(state.selectedJobCaseRef, targets)) ||
          (state.lastMatchRunId && targets.matchRunIds.has(state.lastMatchRunId))
        )
      )
      if (affectedMessages > 0 || affectedState) {
        conversations += 1
        messages += snapshot.messages.filter((message) =>
          agentMessageHasTarget(message, targets) || agentMessageHasDirectIdentifier(message, knownPersonNames)
        ).length
      }
    }
    return { conversations, messages }
  }

  private sanitizeSalesAgentConversations(targets: AgentReferenceTargets, now: Date): AgentReferenceImpact {
    const rows = this.database
      .prepare<[], AiConversationRow>(
        `SELECT id, assistant_type, context_key, candidate_document_id, interview_id, interview_kind,
                round_number, title, payload_json, revision, created_at, updated_at
         FROM ai_conversations
         WHERE assistant_type = 'sales-agent'
         ORDER BY updated_at DESC
         LIMIT 50`
      )
      .all()
    const knownPersonNames = this.salesAgentKnownPersonNames(targets)
    let conversations = 0
    let messages = 0
    for (const row of rows) {
      const snapshot = aiConversationFromRow(row)
      const state = snapshot.salesAgentState
      const stateAffected = Boolean(
        state && (
          (state.selectedJobCaseRef && agentReferenceIsTargeted(state.selectedJobCaseRef, targets)) ||
          (state.lastMatchRunId && targets.matchRunIds.has(state.lastMatchRunId))
        )
      )
      const conversationHasTarget = snapshot.messages.some((message) => agentMessageHasTarget(message, targets))
      if (!conversationHasTarget && !stateAffected) continue

      let conversationAffected = false
      let messageAffected = 0
      const nextMessages = snapshot.messages.flatMap((message) => {
        const referenceAffected = (message.references ?? []).some((reference) => agentReferenceIsTargeted(reference, targets))
        let blockAffected = false
        const blocks = (message.blocks ?? []).flatMap((block) => {
          const sanitized = sanitizeAgentBlock(block, targets)
          blockAffected ||= sanitized.affected
          return sanitized.blocks
        })
        const directIdentifierAffected = agentMessageHasDirectIdentifier(message, knownPersonNames)
        if (!referenceAffected && !blockAffected && !directIdentifierAffected) return message
        conversationAffected = true
        messageAffected += 1
        if (message.role === 'user' && (referenceAffected || directIdentifierAffected)) return []
        const references = message.references?.filter((reference) => !agentReferenceIsTargeted(reference, targets))
        return {
          ...message,
          content: message.role === 'assistant' ? '关联对象已删除，历史内容已降级为删除提示。' : message.content,
          blocks,
          ...(references ? { references } : {})
        }
      })
      if (!conversationAffected && !stateAffected) continue
      const nextState = stateAffected && state
        ? {
            ...state,
            selectedJobCaseRef: state.selectedJobCaseRef && agentReferenceIsTargeted(state.selectedJobCaseRef, targets)
              ? null
              : state.selectedJobCaseRef,
            lastMatchRunId: state.lastMatchRunId && targets.matchRunIds.has(state.lastMatchRunId)
              ? null
              : state.lastMatchRunId
          }
        : state
      const nextSnapshot = aiConversationSnapshotSchema.parse({
        ...snapshot,
        title: detectDirectIdentifiers(snapshot.title, knownPersonNames).length > 0 ? '已删除的案件匹配会话' : snapshot.title,
        messages: nextMessages,
        salesAgentState: nextState,
        revision: row.revision + 1,
        updatedAt: now.toISOString()
      })
      const updated = this.database
        .prepare(
          `UPDATE ai_conversations
           SET title = ?, payload_json = ?, revision = ?, updated_at = ?
           WHERE id = ? AND revision = ?`
        )
        .run(nextSnapshot.title, JSON.stringify(nextSnapshot), nextSnapshot.revision, nextSnapshot.updatedAt, row.id, row.revision)
      if (updated.changes !== 1) throw new Error('AI会话在删除引用时发生并发更新。')
      conversations += 1
      messages += messageAffected
    }
    return { conversations, messages }
  }

  private agentMatchReferenceStatus(runId: string, resultId: string | null): AgentEntityStatus {
    const run = this.database
      .prepare<[string], {
        id: string
        job_case_id: string | null
        job_case_version: number | null
        candidate_pool_fingerprint: string | null
        candidate_profile_versions_json: string | null
      }>(
        `SELECT id, job_case_id, job_case_version, candidate_pool_fingerprint, candidate_profile_versions_json
         FROM candidate_match_runs WHERE id = ?`
      )
      .get(runId)
    if (!run || !run.job_case_id || !run.job_case_version || !run.candidate_pool_fingerprint || !run.candidate_profile_versions_json) return 'deleted'
    const jobCaseExists = this.database
      .prepare<[string], { present: number }>('SELECT 1 AS present FROM job_cases WHERE id = ?')
      .get(run.job_case_id)
    if (!jobCaseExists) return 'deleted'
    const activeCase = this.listActiveJobCases().find((item) => item.id === run.job_case_id)
    if (!activeCase) return 'stale'
    const result = resultId
      ? this.database
          .prepare<[string, string], { candidate_profile_id: string; candidate_profile_version: number }>(
            'SELECT candidate_profile_id, candidate_profile_version FROM candidate_match_results WHERE id = ? AND run_id = ?'
          )
          .get(resultId, runId)
      : this.database
          .prepare<[string], { candidate_profile_id: string; candidate_profile_version: number }>(
            'SELECT candidate_profile_id, candidate_profile_version FROM candidate_match_results WHERE run_id = ? ORDER BY result_rank ASC LIMIT 1'
          )
          .get(runId)
    if (!result) return 'deleted'
    const profile = this.database
      .prepare<[string], { version: number; status: 'current' | 'stale' | 'superseded' }>(
        'SELECT version, status FROM candidate_profiles WHERE id = ?'
      )
      .get(result.candidate_profile_id)
    if (!profile) return 'deleted'
    const currentPool = this.listEligibleTalentProfiles()
    const currentVersions = currentPool
      .map((item) => ({ id: item.id, version: item.profileVersion }))
      .toSorted((left, right) => left.id.localeCompare(right.id) || left.version - right.version)
    const savedVersions = JSON.parse(run.candidate_profile_versions_json) as Array<{ id: string; version: number }>
    const samePool = JSON.stringify(currentVersions) === JSON.stringify(savedVersions)
    return activeCase.version === run.job_case_version && profile.status === 'current' && profile.version === result.candidate_profile_version &&
      samePool && candidatePoolFingerprint(currentPool) === run.candidate_pool_fingerprint
      ? 'current'
      : 'stale'
  }

  private hydrateSalesAgentSnapshot(snapshot: AiConversationSnapshot): AiConversationSnapshot {
    if (snapshot.context.assistant !== 'sales-agent') return snapshot
    const activeCases = new Map(this.listActiveJobCases().map((item) => [item.id, item]))
    const existingCaseIds = new Set(this.database.prepare<[], { id: string }>('SELECT id FROM job_cases').all().map((row) => row.id))
    const currentProfiles = new Map(this.database
      .prepare<[], { id: string; version: number; status: 'current' | 'stale' | 'superseded' }>('SELECT id, version, status FROM candidate_profiles')
      .all()
      .map((row) => [row.id, row] as const))
    let changed = false
    const messages = snapshot.messages.map((message) => {
      if (!message.blocks || message.blocks.length === 0) return message
      let messageChanged = false
      const blocks = message.blocks.map((block) => {
        if (block.type === 'job-case-cards') {
          const cards = block.cards.map((card) => {
            const active = activeCases.get(card.reference.objectId)
            const status: AgentEntityStatus = !existingCaseIds.has(card.reference.objectId)
              ? 'deleted'
              : active?.version === card.reference.objectVersion ? 'current' : 'stale'
            if (card.status !== status) messageChanged = true
            return status === card.status ? card : { ...card, status }
          })
          return cards === block.cards ? block : { ...block, cards }
        }
        if (block.type === 'candidate-match-cards') {
          const cards = block.cards.map((card) => {
            const status = this.agentMatchReferenceStatus(block.runId, card.reference.objectId)
            if (card.status !== status) messageChanged = true
            const profile = currentProfiles.get(card.candidateProfileId)
            const profileStatus = !profile ? 'deleted' : profile.status === 'current' ? status : 'stale'
            const nextStatus: AgentEntityStatus = profileStatus === 'deleted' ? 'deleted' : status
            if (nextStatus !== card.status) messageChanged = true
            return nextStatus === card.status ? card : { ...card, status: nextStatus }
          })
          return cards === block.cards ? block : { ...block, cards }
        }
        if (block.type === 'match-run-explanation') {
          const validity = this.agentMatchReferenceStatus(block.facts.runId, block.facts.candidate?.reference.objectId ?? null)
          const candidate = block.facts.candidate
            ? { ...block.facts.candidate, status: validity }
            : null
          if (validity !== block.facts.validity || candidate?.status !== block.facts.candidate?.status) messageChanged = true
          return messageChanged
            ? { ...block, facts: { ...block.facts, validity, candidate } }
            : block
        }
        return block
      })
      if (!messageChanged) return message
      changed = true
      return { ...message, blocks }
    })
    if (!changed) return snapshot
    return aiConversationSnapshotSchema.parse({ ...snapshot, messages })
  }

  listAiConversations(rawContext: AiConversationContext): AiConversationSnapshot[] {
    const context = aiConversationContextSchema.parse(rawContext)
    const key = aiConversationContextKey(context)
    return this.database
      .prepare<[string], AiConversationRow>(
        `SELECT id, assistant_type, context_key, candidate_document_id, interview_id, interview_kind,
                round_number, title, payload_json, revision, created_at, updated_at
         FROM ai_conversations
         WHERE context_key = ?
         ORDER BY updated_at DESC
         LIMIT 50`
      )
      .all(key)
      .map(aiConversationFromRow)
      .map((snapshot) => this.hydrateSalesAgentSnapshot(snapshot))
  }

  getAiConversation(conversationId: string): AiConversationSnapshot | null {
    const row = this.database
      .prepare<[string], AiConversationRow>(
        `SELECT id, assistant_type, context_key, candidate_document_id, interview_id, interview_kind,
                round_number, title, payload_json, revision, created_at, updated_at
         FROM ai_conversations WHERE id = ?`
      )
      .get(conversationId)
    return row ? this.hydrateSalesAgentSnapshot(aiConversationFromRow(row)) : null
  }

  saveAiConversation(rawInput: SaveAiConversationInput, now = new Date()): AiConversationSnapshot {
    const input = saveAiConversationInputSchema.parse(rawInput)
    const contextKey = aiConversationContextKey(input.context)
    const existing = this.database
      .prepare<[string], AiConversationRow>(
        `SELECT id, assistant_type, context_key, candidate_document_id, interview_id, interview_kind,
                round_number, title, payload_json, revision, created_at, updated_at
         FROM ai_conversations WHERE id = ?`
      )
      .get(input.conversationId)
    if (existing) {
      if (existing.revision !== input.expectedRevision) throw new Error('AI会話が更新されました。履歴を再読み込みしてください。')
      if (existing.context_key !== contextKey) throw new Error('AI会話を別の候補者または面談へ移動できません。')
      if (
        existing.assistant_type !== input.context.assistant ||
        existing.candidate_document_id !== input.context.candidateDocumentId ||
        existing.interview_id !== input.context.interviewId ||
        existing.interview_kind !== input.context.interviewKind ||
        existing.round_number !== input.context.roundNumber
      ) throw new Error('AI会話の不可変コンテキストを変更できません。')
    } else if (input.expectedRevision !== null) {
      throw new Error('AI会話が見つかりません。履歴を再読み込みしてください。')
    }

    if (input.context.interviewId) {
      const interview = this.database
        .prepare<[string], { source_document_id: string; kind: 'recruiting' | 'client'; round_number: number }>(
          'SELECT source_document_id, kind, round_number FROM candidate_interview_sessions WHERE id = ?'
        )
        .get(input.context.interviewId)
      if (
        !interview || interview.source_document_id !== input.context.candidateDocumentId ||
        interview.kind !== input.context.interviewKind || interview.round_number !== input.context.roundNumber
      ) throw new Error('AI会話の面談コンテキストが現在の候補者記録と一致しません。')
    }

    const timestamp = now.toISOString()
    const snapshot = aiConversationSnapshotSchema.parse({
      id: input.conversationId,
      context: input.context,
      title: aiConversationTitle(input.messages),
      messages: input.messages,
      salesAgentState: input.salesAgentState,
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.created_at ?? timestamp,
      updatedAt: timestamp
    })
    if (existing) {
      const updated = this.database.prepare(
        `UPDATE ai_conversations
         SET title = ?, payload_json = ?, revision = ?, updated_at = ?
         WHERE id = ? AND revision = ?`
      ).run(snapshot.title, JSON.stringify(snapshot), snapshot.revision, timestamp, snapshot.id, existing.revision)
      if (updated.changes !== 1) throw new Error('AI会話が更新されました。履歴を再読み込みしてください。')
    } else {
      this.database.prepare(
        `INSERT INTO ai_conversations(
           id, assistant_type, context_key, candidate_document_id, interview_id, interview_kind,
           round_number, title, payload_json, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(
        snapshot.id,
        snapshot.context.assistant,
        contextKey,
        snapshot.context.candidateDocumentId,
        snapshot.context.interviewId,
        snapshot.context.interviewKind,
        snapshot.context.roundNumber,
        snapshot.title,
        JSON.stringify(snapshot),
        timestamp,
        timestamp
      )
    }
    return snapshot
  }

  deleteAiConversations(conversationIds: string[]): string[] {
    if (conversationIds.length === 0) return []
    const remove = this.database.prepare('DELETE FROM ai_conversations WHERE id = ?')
    const deleted: string[] = []
    this.database.transaction(() => {
      for (const id of conversationIds) {
        if (remove.run(id).changes === 1) deleted.push(id)
      }
    })()
    return deleted
  }

  getLocalOperatorProfile(): LocalOperatorProfile | null {
    const row = this.database
      .prepare<[], LocalOperatorProfileRow>(
        `SELECT operator_id, display_name, role_label, revision, updated_at
         FROM local_operator_profile WHERE singleton = 1`
      )
      .get()
    if (!row) return null
    return localOperatorProfileSchema.parse({
      version: 'local-operator-profile-v1',
      operatorId: row.operator_id,
      displayName: row.display_name,
      roleLabel: row.role_label,
      configured: true,
      revision: row.revision,
      updatedAt: row.updated_at,
      cloudEligible: false
    })
  }

  saveLocalOperatorProfile(
    rawInput: SaveLocalOperatorProfileInput,
    now = new Date()
  ): LocalOperatorProfile {
    const input = saveLocalOperatorProfileInputSchema.parse(rawInput)
    const current = this.getLocalOperatorProfile()
    if ((current && current.revision !== input.expectedRevision) || (!current && input.expectedRevision !== null)) {
      throw new Error('操作員プロフィールが更新されました。再読み込みしてください。')
    }
    const timestamp = now.toISOString()
    const nextRevision = (current?.revision ?? 0) + 1
    const operatorId = current?.operatorId ?? randomUUID()
    this.database
      .prepare(
        `INSERT INTO local_operator_profile(
           singleton, operator_id, display_name, role_label, revision, created_at, updated_at
         ) VALUES (1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           display_name = excluded.display_name,
           role_label = excluded.role_label,
           revision = excluded.revision,
           updated_at = excluded.updated_at`
      )
      .run(operatorId, input.displayName, input.roleLabel, nextRevision, timestamp, timestamp)
    const saved = this.getLocalOperatorProfile()
    if (!saved) throw new Error('操作員プロフィールを再読み込みできませんでした。')
    return saved
  }

  getLocalApplicationPreferences(): LocalApplicationPreferences | null {
    const row = this.database
      .prepare<[], LocalApplicationPreferencesRow>(
        `SELECT locale, revision, updated_at
         FROM local_application_preferences WHERE singleton = 1`
      )
      .get()
    if (!row) return null
    return localApplicationPreferencesSchema.parse({
      version: 'local-application-preferences-v1',
      locale: row.locale,
      configured: true,
      revision: row.revision,
      updatedAt: row.updated_at,
      cloudEligible: false
    })
  }

  saveLocalApplicationPreferences(
    rawInput: SaveLocalApplicationPreferencesInput,
    now = new Date()
  ): LocalApplicationPreferences {
    const input = saveLocalApplicationPreferencesInputSchema.parse(rawInput)
    const current = this.getLocalApplicationPreferences()
    if ((current && current.revision !== input.expectedRevision) || (!current && input.expectedRevision !== null)) {
      throw new Error('表示設定が更新されました。再読み込みしてください。')
    }
    const timestamp = now.toISOString()
    const nextRevision = (current?.revision ?? 0) + 1
    this.database
      .prepare(
        `INSERT INTO local_application_preferences(
           singleton, locale, revision, created_at, updated_at
         ) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           locale = excluded.locale,
           revision = excluded.revision,
           updated_at = excluded.updated_at`
      )
      .run(input.locale, nextRevision, timestamp, timestamp)
    const saved = this.getLocalApplicationPreferences()
    if (!saved) throw new Error('表示設定を再読み込みできませんでした。')
    return saved
  }

  getGoogleWorkspaceAdminConfiguration(): GoogleWorkspaceAdminConfiguration | null {
    const row = this.database
      .prepare<[], GoogleWorkspaceAdminConfigurationRow>(
        `SELECT client_id, workspace_domain, label_ids_json, query_text, lookback_days,
                max_messages_per_run, revision, configured_by, updated_at
         FROM google_workspace_admin_configuration WHERE singleton = 1`
      )
      .get()
    if (!row) return null
    return googleWorkspaceAdminConfigurationSchema.parse({
      version: 'google-workspace-admin-config-v1',
      source: 'local-admin',
      editable: true,
      clientId: row.client_id,
      workspaceDomain: row.workspace_domain,
      labelIds: JSON.parse(row.label_ids_json) as unknown,
      query: row.query_text,
      lookbackDays: row.lookback_days,
      maxMessagesPerRun: row.max_messages_per_run,
      revision: row.revision,
      configuredBy: row.configured_by,
      updatedAt: row.updated_at
    })
  }

  saveGoogleWorkspaceAdminConfiguration(
    rawInput: SaveGoogleWorkspaceAdminConfigurationInput,
    configuredBy: string,
    now = new Date()
  ): GoogleWorkspaceAdminConfiguration {
    const input = saveGoogleWorkspaceAdminConfigurationInputSchema.parse(rawInput)
    const current = this.getGoogleWorkspaceAdminConfiguration()
    if ((current && current.revision !== input.expectedRevision) || (!current && input.expectedRevision !== null)) {
      throw new Error('Google Workspace 管理者設定が更新されました。再読み込みしてください。')
    }
    const timestamp = now.toISOString()
    const nextRevision = (current?.revision ?? 0) + 1
    this.database
      .prepare(
        `INSERT INTO google_workspace_admin_configuration(
           singleton, client_id, workspace_domain, label_ids_json, query_text, lookback_days,
           max_messages_per_run, revision, configured_by, created_at, updated_at
         ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           client_id = excluded.client_id,
           workspace_domain = excluded.workspace_domain,
           label_ids_json = excluded.label_ids_json,
           query_text = excluded.query_text,
           lookback_days = excluded.lookback_days,
           max_messages_per_run = excluded.max_messages_per_run,
           revision = excluded.revision,
           configured_by = excluded.configured_by,
           updated_at = excluded.updated_at`
      )
      .run(
        input.clientId,
        input.workspaceDomain,
        JSON.stringify(input.labelIds),
        input.query,
        input.lookbackDays,
        input.maxMessagesPerRun,
        nextRevision,
        configuredBy,
        timestamp,
        timestamp
      )
    const saved = this.getGoogleWorkspaceAdminConfiguration()
    if (!saved) throw new Error('Google Workspace 管理者設定を再読み込みできませんでした。')
    return saved
  }

  getLatestGoogleWorkspaceAcceptanceReport(configurationFingerprint?: string): GoogleWorkspaceOnlineAcceptanceReport | null {
    const row = configurationFingerprint
      ? this.database
          .prepare<[string], GoogleWorkspaceAcceptanceReportRow>(
            `SELECT report_json FROM google_workspace_acceptance_reports
             WHERE configuration_fingerprint = ? ORDER BY checked_at DESC, id DESC LIMIT 1`
          )
          .get(configurationFingerprint)
      : this.database
          .prepare<[], GoogleWorkspaceAcceptanceReportRow>(
            'SELECT report_json FROM google_workspace_acceptance_reports ORDER BY checked_at DESC, id DESC LIMIT 1'
          )
          .get()
    return row ? googleWorkspaceOnlineAcceptanceReportSchema.parse(JSON.parse(row.report_json)) : null
  }

  saveGoogleWorkspaceAcceptanceReport(rawReport: GoogleWorkspaceOnlineAcceptanceReport): GoogleWorkspaceOnlineAcceptanceReport {
    const report = googleWorkspaceOnlineAcceptanceReportSchema.parse(rawReport)
    this.database
      .prepare(
        `INSERT INTO google_workspace_acceptance_reports(
           id, configuration_fingerprint, report_json, outcome, checked_at
         ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(report.id, report.configurationFingerprint, JSON.stringify(report), report.overall, report.checkedAt)
    return this.getLatestGoogleWorkspaceAcceptanceReport(report.configurationFingerprint) ?? report
  }

  getGmailSyncCheckpoint(accountEmail: string): GmailSyncCheckpointRecord | null {
    const row = this.database
      .prepare<[string], GmailSyncStateRow>('SELECT * FROM gmail_sync_states WHERE account_email = ?')
      .get(accountEmail)
    if (!row) return null
    return {
      accountEmail: row.account_email,
      configHash: row.config_hash,
      historyId: row.history_id,
      status: row.status,
      lastSyncedAt: row.last_synced_at,
      lastRun: row.last_run_json ? JSON.parse(row.last_run_json) as GmailSyncCheckpointRecord['lastRun'] : null,
      lastError: row.last_error
    }
  }

  saveGmailSyncSuccess(
    accountEmail: string,
    configHash: string,
    historyId: string,
    lastRun: NonNullable<GmailSyncCheckpointRecord['lastRun']>,
    syncedAt: string
  ): void {
    this.database
      .prepare(
        `INSERT INTO gmail_sync_states(
           account_email, config_hash, history_id, status, last_synced_at, last_run_json, last_error, updated_at
         ) VALUES (?, ?, ?, 'idle', ?, ?, NULL, ?)
         ON CONFLICT(account_email) DO UPDATE SET
           config_hash = excluded.config_hash,
           history_id = excluded.history_id,
           status = 'idle',
           last_synced_at = excluded.last_synced_at,
           last_run_json = excluded.last_run_json,
           last_error = NULL,
           updated_at = excluded.updated_at`
      )
      .run(accountEmail, configHash, historyId, syncedAt, JSON.stringify(lastRun), syncedAt)
  }

  saveGmailSyncFailure(
    accountEmail: string,
    configHash: string,
    errorCode: string,
    failedAt: string,
    lastRun: GmailSyncCheckpointRecord['lastRun'] = null
  ): void {
    this.database
      .prepare(
        `INSERT INTO gmail_sync_states(
           account_email, config_hash, history_id, status, last_synced_at, last_run_json, last_error, updated_at
         ) VALUES (?, ?, NULL, 'error', NULL, ?, ?, ?)
         ON CONFLICT(account_email) DO UPDATE SET
           history_id = CASE
             WHEN gmail_sync_states.config_hash = excluded.config_hash THEN gmail_sync_states.history_id
             ELSE NULL
           END,
           config_hash = excluded.config_hash,
           status = 'error',
           last_run_json = excluded.last_run_json,
           last_error = excluded.last_error,
           updated_at = excluded.updated_at`
      )
      .run(accountEmail, configHash, lastRun ? JSON.stringify(lastRun) : null, errorCode.slice(0, 240), failedAt)
  }

  hasGmailMessage(accountEmail: string, gmailMessageId: string): boolean {
    return Boolean(
      this.database
        .prepare<[string, string, string, string], { present: number }>(
          `SELECT 1 AS present FROM gmail_messages WHERE account_email = ? AND gmail_message_id = ?
           UNION ALL
           SELECT 1 AS present FROM gmail_message_tombstones WHERE account_email = ? AND gmail_message_id = ?
           LIMIT 1`
        )
        .get(accountEmail, gmailMessageId, accountEmail, gmailMessageId)
    )
  }

  findGmailMessageByFingerprint(accountEmail: string, fingerprint: string): string | null {
    return this.database
      .prepare<[string, string], { gmail_message_id: string }>(
        `SELECT gmail_message_id FROM gmail_messages
         WHERE account_email = ? AND business_fingerprint = ?
         ORDER BY imported_at ASC LIMIT 1`
      )
      .get(accountEmail, fingerprint)?.gmail_message_id ?? null
  }

  saveGmailMessage(input: StoredGmailMessageInput): boolean {
    const message = storedGmailMessageInputSchema.parse(input)
    const deleted = this.database
      .prepare<[string, string], { present: number }>(
        'SELECT 1 AS present FROM gmail_message_tombstones WHERE account_email = ? AND gmail_message_id = ?'
      )
      .get(message.accountEmail, message.gmailMessageId)
    if (deleted) return false
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO gmail_messages(
           account_email, gmail_message_id, thread_id, history_id, internal_date, label_ids_json,
           rfc_message_id, from_domain, redacted_subject, redacted_body, redaction_session_id,
           classification, business_fingerprint, duplicate_of_message_id, warning_codes_json,
           attachment_count, cloud_eligible, imported_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        message.accountEmail,
        message.gmailMessageId,
        message.threadId,
        message.historyId,
        message.internalDate,
        JSON.stringify(message.labelIds),
        message.rfcMessageId,
        message.fromDomain,
        message.redactedSubject,
        message.redactedBody,
        message.redactionSessionId,
        message.classification,
        message.businessFingerprint,
        message.duplicateOfMessageId,
        JSON.stringify(message.warningCodes),
        message.attachmentCount,
        message.importedAt
      )
    return result.changes === 1
  }

  countGmailMessages(accountEmail: string): number {
    return this.database
      .prepare<[string], { count: number }>('SELECT count(*) AS count FROM gmail_messages WHERE account_email = ?')
      .get(accountEmail)?.count ?? 0
  }

  summarizeGmailRedactionEvidence(accountEmail: string): GmailRedactionEvidenceSummary {
    return this.database
      .prepare<[string], GmailRedactionEvidenceSummary>(
        `SELECT
           count(*) AS storedMessages,
           coalesce(sum(CASE WHEN session.status = 'passed' THEN 1 ELSE 0 END), 0) AS passed,
           coalesce(sum(CASE WHEN session.status = 'uncertain' THEN 1 ELSE 0 END), 0) AS uncertain,
           coalesce(sum(CASE WHEN session.id IS NULL OR session.status IN ('failed', 'invalidated') THEN 1 ELSE 0 END), 0) AS blocked
         FROM gmail_messages message
         LEFT JOIN redaction_sessions session ON session.id = message.redaction_session_id
         WHERE message.account_email = ?`
      )
      .get(accountEmail) ?? { storedMessages: 0, passed: 0, uncertain: 0, blocked: 0 }
  }

  listGmailMessagesPendingJobCaseDrafts(accountEmail: string, limit = 100): StoredGmailMessageInput[] {
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)))
    return this.database
      .prepare<[string, number], GmailMessageRow>(
        `SELECT message.* FROM gmail_messages message
         LEFT JOIN job_case_sources source
           ON source.source_type = 'gmail'
          AND source.provider_account = message.account_email
          AND source.provider_message_id = message.gmail_message_id
         LEFT JOIN job_case_extractions extraction
           ON extraction.source_id = source.id
         WHERE message.account_email = ?
           AND message.classification = 'job-case'
           AND extraction.review_id IS NULL
         ORDER BY message.internal_date ASC
         LIMIT ?`
      )
      .all(accountEmail, boundedLimit)
      .map(storedGmailMessageFromRow)
  }

  ensureGmailJobCaseSource(input: JobCaseSource): JobCaseSource {
    const source = jobCaseSourceSchema.parse(input)
    if (source.sourceType !== 'gmail' || !source.providerAccount || !source.providerMessageId) {
      throw new Error('Only a complete Gmail job-case source can be ensured by this operation.')
    }
    this.database
      .prepare(
        `INSERT OR IGNORE INTO job_case_sources(
           id, source_type, provider_account, provider_message_id, thread_id, from_domain,
           message_date, redacted_subject, redacted_body, redaction_session_id,
           warning_codes_json, business_fingerprint, created_at
         ) VALUES (?, 'gmail', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        source.id,
        source.providerAccount,
        source.providerMessageId,
        source.threadId,
        source.fromDomain,
        source.messageDate,
        source.redactedSubject,
        source.redactedBody,
        source.redactionSessionId,
        JSON.stringify(source.warningCodes),
        jobCaseBusinessFingerprint(source.redactedSubject, source.redactedBody),
        source.createdAt
      )
    const row = this.database
      .prepare<[string, string], JobCaseSourceRow>(
        `SELECT * FROM job_case_sources
         WHERE source_type = 'gmail' AND provider_account = ? AND provider_message_id = ?`
      )
      .get(source.providerAccount, source.providerMessageId)
    if (!row) throw new Error('Gmail job-case source could not be reloaded.')
    return jobCaseSourceFromRow(row)
  }

  saveJobCaseDraft(input: JobCaseExtractionDraft): boolean {
    const draft = jobCaseExtractionDraftSchema.parse(input)
    if (draft.version !== 'job-case-extraction-v2') {
      throw new Error('Only v2 job-case drafts can be newly persisted.')
    }
    const save = this.database.transaction(() => {
      return this.insertJobCaseDraft(draft)
    })
    return save()
  }

  saveJobCaseSourceAndDraft(rawSource: JobCaseSource, rawDraft: JobCaseExtractionDraftV2): boolean {
    const source = jobCaseSourceSchema.parse(rawSource)
    const draft = jobCaseExtractionDraftSchema.parse(rawDraft)
    if (draft.version !== 'job-case-extraction-v2' || draft.sourceId !== source.id || draft.sourceType !== source.sourceType) {
      throw new Error('Job-case source and extraction draft do not have the same identity.')
    }
    const save = this.database.transaction(() => {
      this.insertJobCaseSource(source)
      if (!this.insertJobCaseDraft(draft)) throw new Error('Job-case extraction draft identity already exists.')
      return true
    })
    return save()
  }

  saveRedactedJobCaseSourceAndDraft(
    session: RedactionSessionEvidence,
    mappings: LocalPiiMapping[],
    rawSource: JobCaseSource,
    rawDraft: JobCaseExtractionDraftV2
  ): boolean {
    const source = jobCaseSourceSchema.parse(rawSource)
    const draft = jobCaseExtractionDraftSchema.parse(rawDraft)
    if (
      session.id !== source.redactionSessionId ||
      draft.version !== 'job-case-extraction-v2' ||
      draft.sourceId !== source.id ||
      draft.sourceType !== source.sourceType
    ) {
      throw new Error('Redaction evidence, source, and extraction draft do not have the same identity.')
    }
    const save = this.database.transaction(() => {
      this.persistRedactionSession(session, mappings)
      this.insertJobCaseSource(source)
      if (!this.insertJobCaseDraft(draft)) throw new Error('Job-case extraction draft identity already exists.')
      return true
    })
    return save()
  }

  private insertJobCaseSource(source: JobCaseSource): void {
    this.database
      .prepare(
        `INSERT INTO job_case_sources(
           id, source_type, provider_account, provider_message_id, thread_id, from_domain,
           message_date, redacted_subject, redacted_body, redaction_session_id,
           warning_codes_json, business_fingerprint, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        source.id,
        source.sourceType,
        source.providerAccount,
        source.providerMessageId,
        source.threadId,
        source.fromDomain,
        source.messageDate,
        source.redactedSubject,
        source.redactedBody,
        source.redactionSessionId,
        JSON.stringify(source.warningCodes),
        jobCaseBusinessFingerprint(source.redactedSubject, source.redactedBody),
        source.createdAt
      )
  }

  findJobCaseReviewByBusinessFingerprint(subject: string, body: string): JobCaseReviewSnapshot | null {
    const row = this.database
      .prepare<[string], { review_id: string }>(
        `SELECT extraction.review_id FROM job_case_sources source
         JOIN job_case_extractions extraction ON extraction.source_id = source.id
         WHERE source.business_fingerprint = ?
         ORDER BY source.created_at ASC LIMIT 1`
      )
      .get(jobCaseBusinessFingerprint(subject, body))
    return row ? this.getJobCaseReview(row.review_id) : null
  }

  getEmlJobCaseReview(sourceMessageKey: string): JobCaseReviewSnapshot | null {
    if (!/^eml_[a-f0-9]{64}$/u.test(sourceMessageKey)) throw new Error('EML source message key is invalid.')
    const row = this.database
      .prepare<[string], { review_id: string }>(
        `SELECT extraction.review_id FROM job_case_sources source
         JOIN job_case_extractions extraction ON extraction.source_id = source.id
         WHERE source.source_type = 'eml' AND source.provider_message_id = ?`
      )
      .get(sourceMessageKey)
    return row ? this.getJobCaseReview(row.review_id) : null
  }

  private insertJobCaseDraft(draft: JobCaseExtractionDraftV2): boolean {
    const inserted = this.database
      .prepare(
        `INSERT OR IGNORE INTO job_case_extractions(
           review_id, source_id, draft_json, extraction_version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        draft.reviewId,
        draft.sourceId,
        JSON.stringify(draft),
        draft.version,
        draft.createdAt,
        draft.createdAt
      )
    if (inserted.changes !== 1) return false
    this.database
      .prepare(
        `INSERT INTO job_case_review_states(
           review_id, status, privacy_reviewed, revision, updated_at
         ) VALUES (?, 'awaiting-review', 0, 1, ?)`
      )
      .run(draft.reviewId, draft.createdAt)
    return true
  }

  getJobCaseReview(reviewId: string): JobCaseReviewSnapshot | null {
    const row = this.database
      .prepare<[string], JobCaseReviewJoinRow>(
        `SELECT state.*, extraction.draft_json, source.id AS source_id, source.source_type,
                source.provider_message_id, source.thread_id, source.message_date,
                source.from_domain, source.redacted_subject, source.redacted_body
         FROM job_case_review_states state
         JOIN job_case_extractions extraction ON extraction.review_id = state.review_id
         JOIN job_case_sources source ON source.id = extraction.source_id
         WHERE state.review_id = ?`
      )
      .get(reviewId)
    if (!row) return null
    const draft = jobCaseExtractionDraftSchema.parse(JSON.parse(row.draft_json))
    const auditRows = row.status === 'completed'
      ? this.database
          .prepare<[string, number], JobCaseFieldAuditRow>(
            `SELECT field_key, original_value, confirmed_value, change_reason, source_labels_json
             FROM job_case_field_review_audits
             WHERE review_id = ? AND review_revision = ?`
          )
          .all(reviewId, row.revision)
      : []
    const auditsByKey = new Map(auditRows.map((audit) => [audit.field_key, audit]))
    const caseRow = this.database
      .prepare<[string], JobCaseRow>(
        'SELECT case_json, status FROM job_cases WHERE source_review_id = ? ORDER BY version DESC LIMIT 1'
      )
      .get(reviewId)
    const jobCase = caseRow ? confirmedJobCaseSchema.parse(JSON.parse(caseRow.case_json)) : null
    const latestFields = new Map(jobCase?.fields.map((field) => [field.key, field]) ?? [])
    const lifecycle = this.database
      .prepare<[string], JobCaseLifecycleRow>('SELECT * FROM job_case_lifecycle WHERE source_review_id = ?')
      .get(reviewId)
    return jobCaseReviewSnapshotSchema.parse({
      reviewId,
      sourceId: row.source_id,
      sourceType: row.source_type,
      providerMessageId: row.provider_message_id,
      threadId: row.thread_id,
      fromDomain: row.from_domain,
      messageDate: row.message_date,
      redactedSubject: row.redacted_subject,
      redactedPreview: `${row.redacted_subject}\n\n${row.redacted_body}`.slice(0, 4_000),
      reviewRevision: row.revision,
      status: row.status,
      privacyReviewed: row.privacy_reviewed === 1,
      fields: draft.fields.map((field) => {
        const audit = auditsByKey.get(field.key)
        const latest = latestFields.get(field.key)
        const baselineValue = row.status === 'awaiting-review' && latest ? latest.value : field.value
        return {
          key: field.key,
          label: field.label,
          originalValue: baselineValue,
          value: audit ? audit.confirmed_value : baselineValue,
          confidence: field.confidence,
          status: audit ? 'confirmed' : latest ? 'needs_review' : field.status,
          sourceLabels: audit
            ? JSON.parse(audit.source_labels_json) as string[]
            : latest?.sourceLabels ?? field.sources.map((source) => source.sourceLabel),
          changed: audit ? audit.original_value !== audit.confirmed_value : false,
          changeReason: audit?.change_reason ?? null
        }
      }),
      warningCodes: draft.warningCodes,
      completedAt: row.completed_at,
      reviewerDisplayName: row.reviewer_display_name,
      jobCase: jobCase
        ? {
            id: jobCase.id,
            sourceReviewId: jobCase.sourceReviewId,
            version: jobCase.version,
            status: caseRow?.status,
            confirmedAt: jobCase.confirmedAt,
            confirmedBy: jobCase.confirmedBy,
            containsDirectIdentifiers: jobCase.containsDirectIdentifiers
          }
        : null,
      lifecycle: lifecycle?.state ?? 'active',
      cloudEligible: false
    })
  }

  listJobCaseReviews(): JobCaseReviewSnapshot[] {
    const rows = this.database
      .prepare<[], { review_id: string }>('SELECT review_id FROM job_case_review_states ORDER BY updated_at DESC')
      .all()
    return rows.flatMap((row) => {
      const review = this.getJobCaseReview(row.review_id)
      return review ? [review] : []
    })
  }

  listActiveJobCases(): ConfirmedJobCase[] {
    return this.database
      .prepare<[], JobCaseRow>(
        `SELECT job.case_json, job.status FROM job_cases job
         LEFT JOIN job_case_lifecycle lifecycle ON lifecycle.source_review_id = job.source_review_id
         WHERE job.status = 'active' AND coalesce(lifecycle.state, 'active') = 'active'
         ORDER BY job.confirmed_at DESC`
      )
      .all()
      .map((row) => confirmedJobCaseSchema.parse(JSON.parse(row.case_json)))
  }

  getJobCaseHistory(reviewId: string): JobCaseVersionDetail[] {
    const sourceRow = this.database
      .prepare<[string], JobCaseSourceRow>(
        `SELECT source.* FROM job_case_sources source
         JOIN job_case_extractions extraction ON extraction.source_id = source.id
         WHERE extraction.review_id = ?`
      )
      .get(reviewId)
    if (!sourceRow) return []
    const source = jobCaseSourceFromRow(sourceRow)
    const lifecycle = this.database
      .prepare<[string], JobCaseLifecycleRow>('SELECT * FROM job_case_lifecycle WHERE source_review_id = ?')
      .get(reviewId)
    return this.database
      .prepare<[string], JobCaseRow>(
        'SELECT case_json, status FROM job_cases WHERE source_review_id = ? ORDER BY version DESC'
      )
      .all(reviewId)
      .map((row) => {
        const jobCase = confirmedJobCaseSchema.parse(JSON.parse(row.case_json))
        return {
          id: jobCase.id,
          sourceReviewId: jobCase.sourceReviewId,
          sourceId: source.id,
          sourceType: source.sourceType,
          version: jobCase.version,
          reviewRevision: jobCase.reviewRevision,
          status: row.status === 'active' && lifecycle?.state === 'archived' ? 'archived' as const : row.status,
          fields: jobCase.fields,
          confirmedAt: jobCase.confirmedAt,
          confirmedBy: jobCase.confirmedBy,
          containsDirectIdentifiers: jobCase.containsDirectIdentifiers
        }
      })
  }

  setJobCaseLifecycle(
    input: SetJobCaseLifecycleInput,
    changedBy: string,
    now = new Date()
  ): JobCaseReviewSnapshot {
    const validated = setJobCaseLifecycleInputSchema.parse(input)
    const state = this.database
      .prepare<[string], JobCaseReviewStateRow>('SELECT * FROM job_case_review_states WHERE review_id = ?')
      .get(validated.reviewId)
    if (!state || state.status !== 'completed') throw new Error('Confirmed job case was not found.')
    const activeCase = this.database
      .prepare<[string], { id: string }>(
        "SELECT id FROM job_cases WHERE source_review_id = ? AND status = 'active'"
      )
      .get(validated.reviewId)
    if (!activeCase) throw new Error('Active job case was not found.')
    const changedAt = now.toISOString()
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO job_case_lifecycle(source_review_id, state, reason, changed_by, changed_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(source_review_id) DO UPDATE SET
             state = excluded.state,
             reason = excluded.reason,
             changed_by = excluded.changed_by,
             changed_at = excluded.changed_at`
        )
        .run(validated.reviewId, validated.state, validated.reason, changedBy, changedAt)
      this.database
        .prepare(
          `INSERT INTO job_case_events(
             id, source_review_id, event_type, reason, actor, review_revision, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          randomUUID(),
          validated.reviewId,
          validated.state === 'archived' ? 'archived' : 'restored',
          validated.reason,
          changedBy,
          state.revision,
          changedAt
        )
      this.database
        .prepare(
          'INSERT INTO change_outbox(id, entity_type, entity_id, revision, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), 'job_case_lifecycle', validated.reviewId, state.revision, 'upsert', changedAt)
    })
    save()
    const review = this.getJobCaseReview(validated.reviewId)
    if (!review) throw new Error('Updated job case could not be reloaded.')
    return review
  }

  reopenJobCaseReview(
    input: ReopenJobCaseReviewInput,
    changedBy: string,
    now = new Date()
  ): JobCaseReviewSnapshot {
    const validated = reopenJobCaseReviewInputSchema.parse(input)
    const state = this.database
      .prepare<[string], JobCaseReviewStateRow>('SELECT * FROM job_case_review_states WHERE review_id = ?')
      .get(validated.reviewId)
    if (!state) throw new Error('Job case review was not found.')
    if (state.status !== 'completed') throw new Error('Job case review is already open.')
    const lifecycle = this.database
      .prepare<[string], JobCaseLifecycleRow>('SELECT * FROM job_case_lifecycle WHERE source_review_id = ?')
      .get(validated.reviewId)
    if (lifecycle?.state === 'archived') throw new Error('Restore the archived job case before revising it.')
    const nextRevision = state.revision + 1
    const changedAt = now.toISOString()
    const save = this.database.transaction(() => {
      const updated = this.database
        .prepare(
          `UPDATE job_case_review_states SET
             status = 'awaiting-review', privacy_reviewed = 0, revision = ?, reviewer_id = NULL,
             reviewer_display_name = NULL, completed_at = NULL, updated_at = ?
           WHERE review_id = ? AND status = 'completed' AND revision = ?`
        )
        .run(nextRevision, changedAt, validated.reviewId, state.revision)
      if (updated.changes !== 1) throw new Error('Job case changed while its revision was being opened.')
      this.database
        .prepare(
          `INSERT INTO job_case_events(
             id, source_review_id, event_type, reason, actor, review_revision, created_at
           ) VALUES (?, ?, 'revision-opened', ?, ?, ?, ?)`
        )
        .run(randomUUID(), validated.reviewId, validated.reason, changedBy, nextRevision, changedAt)
    })
    save()
    const review = this.getJobCaseReview(validated.reviewId)
    if (!review) throw new Error('Reopened job case review could not be reloaded.')
    return review
  }

  previewJobCaseDeletion(reviewId: string): JobCaseDeletionPreview {
    const sourceRow = this.database
      .prepare<[string], JobCaseSourceRow>(
        `SELECT source.* FROM job_case_sources source
         JOIN job_case_extractions extraction ON extraction.source_id = source.id
         WHERE extraction.review_id = ?`
      )
      .get(reviewId)
    if (!sourceRow) throw new Error('Job case source was not found.')
    const source = jobCaseSourceFromRow(sourceRow)
    const history = this.getJobCaseHistory(reviewId)
    if (history.length === 0) throw new Error('Confirmed job case was not found.')
    const relatedIds = new Set([reviewId, source.id, ...history.map((version) => version.id)])
    const taskRecords = this.listWorkTasks().filter((task) =>
      task.contextBindings.some((binding) => binding.objectType === 'job-case' && relatedIds.has(binding.objectId))
    ).length
    const reviewAudits = this.database
      .prepare<[string], { count: number }>(
        'SELECT count(*) AS count FROM job_case_field_review_audits WHERE review_id = ?'
      )
      .get(reviewId)?.count ?? 0
    const evaluationDraftCases = this.database
      .prepare<[string], { count: number }>(
        `SELECT count(*) AS count FROM candidate_evaluation_draft_cases draft_case
         JOIN job_cases job ON job.id = draft_case.job_case_id
         WHERE job.source_review_id = ?`
      )
      .get(reviewId)?.count ?? 0
    const proposalDrafts = this.database
      .prepare<[string], { count: number }>(
        `SELECT count(*) AS count FROM proposal_drafts proposal
         JOIN job_cases job ON job.id = proposal.job_case_id
         WHERE job.source_review_id = ?`
      )
      .get(reviewId)?.count ?? 0
    const piiMappings = this.database
      .prepare<[string], { count: number }>(
        'SELECT count(*) AS count FROM local_pii_mappings WHERE redaction_session_id = ?'
      )
      .get(source.redactionSessionId)?.count ?? 0
    const caseIds = history.map((version) => version.id)
    const caseIdSet = new Set(caseIds)
    const agentMatchRuns = this.database
      .prepare<[], { id: string; job_case_id: string | null }>('SELECT id, job_case_id FROM candidate_match_runs')
      .all()
      .filter((row) => row.job_case_id !== null && caseIdSet.has(row.job_case_id))
    const agentRunIds = new Set(agentMatchRuns.map((row) => row.id))
    const agentResultRows = this.database
      .prepare<[], { id: string; run_id: string }>('SELECT id, run_id FROM candidate_match_results')
      .all()
      .filter((row) => agentRunIds.has(row.run_id))
    const agentReferences = this.countSalesAgentReferences({
      jobCaseIds: caseIdSet,
      matchRunIds: agentRunIds,
      matchResultIds: new Set(agentResultRows.map((row) => row.id))
    })
    const counts = {
      caseVersions: history.length,
      reviewAudits,
      taskRecords,
      proposalDrafts,
      evaluationDraftCases,
      piiMappings,
      sourceRecords: 1,
      gmailMessages: source.sourceType === 'gmail' ? 1 : 0,
      agentReferences
    }
    const confirmationHash = createHash('sha256').update(JSON.stringify({
      reviewId,
      sourceId: source.id,
      providerMessageId: source.providerMessageId,
      latestCaseId: history[0]?.id,
      latestVersion: history[0]?.version,
      counts
    })).digest('hex')
    const title = history[0]?.fields.find((field) => field.key === 'title')?.value ?? source.redactedSubject
    return jobCaseDeletionPreviewSchema.parse({
      reviewId,
      sourceId: source.id,
      title,
      sourceType: source.sourceType,
      counts,
      confirmationHash,
      warningCodes: [
        'EXTERNAL_EXPORTS_OUTSIDE_SCOPE',
        'BACKUP_SYSTEM_NOT_CONFIGURED',
        ...(source.sourceType === 'gmail' ? ['GMAIL_SOURCE_TOMBSTONED_TO_PREVENT_REIMPORT'] : [])
      ]
    })
  }

  deleteJobCaseDatabaseData(rawInput: DeleteJobCaseDataInput, now = new Date()): JobCaseDeletionPreview {
    const input = deleteJobCaseDataInputSchema.parse(rawInput)
    const preview = this.previewJobCaseDeletion(input.reviewId)
    if (preview.confirmationHash !== input.confirmationHash) {
      throw new Error('Job case deletion preview changed. Review the impact again before deleting.')
    }
    const sourceRow = this.database
      .prepare<[string], JobCaseSourceRow>(
        `SELECT source.* FROM job_case_sources source
         JOIN job_case_extractions extraction ON extraction.source_id = source.id
         WHERE extraction.review_id = ?`
      )
      .get(input.reviewId)
    if (!sourceRow) throw new Error('Job case source was not found.')
    const source = jobCaseSourceFromRow(sourceRow)
    const caseIds = this.getJobCaseHistory(input.reviewId).map((version) => version.id)
    const relatedIds = new Set([input.reviewId, source.id, ...caseIds])
    const agentMatchRuns = this.database
      .prepare<[], { id: string; job_case_id: string | null }>('SELECT id, job_case_id FROM candidate_match_runs')
      .all()
      .filter((row) => row.job_case_id !== null && relatedIds.has(row.job_case_id))
    const agentRunIds = new Set(agentMatchRuns.map((row) => row.id))
    const agentResultRows = this.database
      .prepare<[], { id: string; run_id: string }>('SELECT id, run_id FROM candidate_match_results')
      .all()
      .filter((row) => agentRunIds.has(row.run_id))
    const agentTargets: AgentReferenceTargets = {
      jobCaseIds: new Set(caseIds),
      matchRunIds: agentRunIds,
      matchResultIds: new Set(agentResultRows.map((row) => row.id))
    }
    const taskIds = this.listWorkTasks()
      .filter((task) => task.contextBindings.some((binding) =>
        binding.objectType === 'job-case' && relatedIds.has(binding.objectId)
      ))
      .map((task) => task.id)
    const deletedAt = now.toISOString()
    const remove = this.database.transaction(() => {
      this.sanitizeSalesAgentConversations(agentTargets, now)
      for (const taskId of taskIds) {
        this.database.prepare('DELETE FROM work_tasks WHERE id = ?').run(taskId)
        this.database.prepare("DELETE FROM change_outbox WHERE entity_type = 'work_task' AND entity_id = ?").run(taskId)
      }
      for (const caseId of caseIds) {
        this.database.prepare("DELETE FROM change_outbox WHERE entity_type = 'job_case' AND entity_id = ?").run(caseId)
      }
      this.database
        .prepare("DELETE FROM change_outbox WHERE entity_type = 'job_case_lifecycle' AND entity_id = ?")
        .run(input.reviewId)
      this.database.prepare('DELETE FROM job_cases WHERE source_review_id = ?').run(input.reviewId)
      if (source.sourceType === 'gmail' && source.providerAccount && source.providerMessageId) {
        this.database
          .prepare(
            `INSERT INTO gmail_message_tombstones(account_email, gmail_message_id, deleted_at, reason)
             VALUES (?, ?, ?, 'job-case-permanent-deletion')
             ON CONFLICT(account_email, gmail_message_id) DO UPDATE SET deleted_at = excluded.deleted_at`
          )
          .run(source.providerAccount, source.providerMessageId, deletedAt)
        const deletedMessage = this.database
          .prepare('DELETE FROM gmail_messages WHERE account_email = ? AND gmail_message_id = ?')
          .run(source.providerAccount, source.providerMessageId)
        if (deletedMessage.changes === 0) {
          this.database.prepare('DELETE FROM job_case_sources WHERE id = ?').run(source.id)
        }
      } else {
        const deletedSource = this.database.prepare('DELETE FROM job_case_sources WHERE id = ?').run(source.id)
        if (deletedSource.changes !== 1) throw new Error('Local job case source could not be deleted.')
      }
      const remaining = this.database
        .prepare<[string], { present: number }>('SELECT 1 AS present FROM job_case_extractions WHERE review_id = ?')
        .get(input.reviewId)
      if (remaining) throw new Error('Job case review records could not be deleted.')
      this.database.prepare('DELETE FROM local_pii_mappings WHERE redaction_session_id = ?').run(source.redactionSessionId)
      this.database.prepare('DELETE FROM redaction_sessions WHERE id = ?').run(source.redactionSessionId)
      this.database
        .prepare(
          'INSERT INTO change_outbox(id, entity_type, entity_id, revision, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), 'job_case', input.reviewId, 1, 'delete', deletedAt)
    })
    remove()
    return preview
  }

  confirmJobCaseReview(
    input: SubmitJobCaseReviewInput,
    reviewerId: string,
    reviewerDisplayName: string,
    now = new Date()
  ): JobCaseReviewSnapshot {
    const validated = submitJobCaseReviewInputSchema.parse(input)
    const state = this.database
      .prepare<[string], JobCaseReviewStateRow>('SELECT * FROM job_case_review_states WHERE review_id = ?')
      .get(validated.reviewId)
    if (!state) throw new Error('Job case review state was not found.')
    if (state.status !== 'awaiting-review') throw new Error('Job case review is already completed.')
    if (state.revision !== validated.reviewRevision) throw new Error('Job case review changed. Reload before confirming.')
    const extractionRow = this.database
      .prepare<[string], { draft_json: string; source_id: string }>(
        'SELECT draft_json, source_id FROM job_case_extractions WHERE review_id = ?'
      )
      .get(validated.reviewId)
    if (!extractionRow) throw new Error('Job case extraction draft was not found.')
    const draft = jobCaseExtractionDraftSchema.parse(JSON.parse(extractionRow.draft_json))
    const sourceRow = this.database
      .prepare<[string], JobCaseSourceRow>('SELECT * FROM job_case_sources WHERE id = ?')
      .get(extractionRow.source_id)
    if (!sourceRow) throw new Error('Job case source was not found.')
    const source = jobCaseSourceFromRow(sourceRow)
    const previousCaseRow = this.database
      .prepare<[string], JobCaseRow>(
        "SELECT case_json, status FROM job_cases WHERE source_review_id = ? AND status = 'active' LIMIT 1"
      )
      .get(validated.reviewId)
    const previousCase = previousCaseRow
      ? confirmedJobCaseSchema.parse(JSON.parse(previousCaseRow.case_json))
      : null
    const previousFields = new Map(previousCase?.fields.map((field) => [field.key, field]) ?? [])
    const submissionByKey = new Map(validated.fields.map((field) => [field.key, field]))
    if (submissionByKey.size !== draft.fields.length || draft.fields.some((field) => !submissionByKey.has(field.key))) {
      throw new Error('Every job case field must be explicitly confirmed exactly once.')
    }
    for (const field of draft.fields) {
      const submitted = submissionByKey.get(field.key)
      if (!submitted) throw new Error(`Job case field ${field.key} was not confirmed.`)
      const baselineValue = previousFields.get(field.key)?.value ?? field.value
      if (baselineValue !== submitted.value && !submitted.changeReason) {
        throw new Error(`A change reason is required for ${field.label}.`)
      }
    }
    if (!submissionByKey.get('title')?.value) throw new Error('案件名は必須です。')
    const confirmedBusinessFields = validated.fields.map((field) => field.value ?? '').join('\n')
    if (/(?:外国籍不可|日本国籍(?:のみ|限定)|日本人(?:のみ|限定))/u.test(confirmedBusinessFields)) {
      throw new Error('国籍条件は保存できません。合法的な就労資格要件だけを使用してください。')
    }
    const residualIdentifiers = detectDirectIdentifiers(
      confirmedBusinessFields
    )
    if (residualIdentifiers.length > 0) {
      throw new Error(`案件フィールドに直接識別子を保存できません: ${residualIdentifiers.join(', ')}`)
    }

    const reviewedAt = now.toISOString()
    const save = this.database.transaction(() => {
      const current = this.database
        .prepare<[string], JobCaseReviewStateRow>('SELECT * FROM job_case_review_states WHERE review_id = ?')
        .get(validated.reviewId)
      if (!current || current.status !== 'awaiting-review' || current.revision !== validated.reviewRevision) {
        throw new Error('Job case review changed while it was being confirmed.')
      }
      const latestVersion = this.database
        .prepare<[string], { version: number | null }>(
          'SELECT max(version) AS version FROM job_cases WHERE source_review_id = ?'
        )
        .get(validated.reviewId)?.version ?? 0
      const version = latestVersion + 1
      const caseId = randomUUID()
      const jobCase = confirmedJobCaseSchema.parse({
        schemaVersion: 'job-case-v2',
        id: caseId,
        sourceReviewId: validated.reviewId,
        sourceId: source.id,
        sourceType: source.sourceType,
        sourceProviderMessageId: source.providerMessageId,
        sourceThreadId: source.threadId,
        version,
        reviewRevision: validated.reviewRevision,
        fields: draft.fields.map((field) => ({
          key: field.key,
          label: field.label,
          value: submissionByKey.get(field.key)?.value ?? null,
          sourceLabels: [...new Set(field.sources.map((source) => source.sourceLabel))]
        })),
        confirmedAt: reviewedAt,
        confirmedBy: reviewerDisplayName,
        containsDirectIdentifiers: false
      })
      this.database
        .prepare("UPDATE job_cases SET status = 'superseded' WHERE source_review_id = ? AND status = 'active'")
        .run(validated.reviewId)
      this.database
        .prepare(
          `INSERT INTO job_cases(
             id, source_review_id, version, case_json, status, confirmed_at, confirmed_by
           ) VALUES (?, ?, ?, ?, 'active', ?, ?)`
        )
        .run(caseId, validated.reviewId, version, JSON.stringify(jobCase), reviewedAt, reviewerDisplayName)
      this.database
        .prepare(
          `INSERT INTO job_case_lifecycle(source_review_id, state, reason, changed_by, changed_at)
           VALUES (?, 'active', 'Initial confirmation', ?, ?)
           ON CONFLICT(source_review_id) DO NOTHING`
        )
        .run(validated.reviewId, reviewerDisplayName, reviewedAt)

      const insertAudit = this.database.prepare(
        `INSERT INTO job_case_field_review_audits(
           id, review_id, review_revision, field_key, original_value, confirmed_value,
           change_reason, source_labels_json, reviewer_id, reviewed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const field of draft.fields) {
        const submitted = submissionByKey.get(field.key)
        if (!submitted) continue
        insertAudit.run(
          randomUUID(),
          validated.reviewId,
          validated.reviewRevision,
          field.key,
          previousFields.get(field.key)?.value ?? field.value,
          submitted.value,
          submitted.changeReason ?? null,
          JSON.stringify([...new Set(field.sources.map((source) => source.sourceLabel))]),
          reviewerId,
          reviewedAt
        )
      }
      const updated = this.database
        .prepare(
          `UPDATE job_case_review_states SET
             status = 'completed', privacy_reviewed = 1, reviewer_id = ?, reviewer_display_name = ?,
             completed_at = ?, updated_at = ?
           WHERE review_id = ? AND revision = ? AND status = 'awaiting-review'`
        )
        .run(
          reviewerId,
          reviewerDisplayName,
          reviewedAt,
          reviewedAt,
          validated.reviewId,
          validated.reviewRevision
        )
      if (updated.changes !== 1) throw new Error('Job case review could not be committed.')
      this.database
        .prepare(
          'INSERT INTO change_outbox(id, entity_type, entity_id, revision, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), 'job_case', caseId, version, 'upsert', reviewedAt)
    })
    save()
    const result = this.getJobCaseReview(validated.reviewId)
    if (!result) throw new Error('Confirmed job case review could not be reloaded.')
    return result
  }

  getProposalPreparationOptions(): ProposalPreparationOptions {
    const jobCases = this.database
      .prepare<[], JobCaseRow>(
        `SELECT job.case_json, job.status FROM job_cases job
         LEFT JOIN job_case_lifecycle lifecycle ON lifecycle.source_review_id = job.source_review_id
         WHERE job.status = 'active' AND coalesce(lifecycle.state, 'active') = 'active'
         ORDER BY job.confirmed_at DESC`
      )
      .all()
      .map((row) => confirmedJobCaseSchema.parse(JSON.parse(row.case_json)))
      .map((jobCase) => ({
        id: jobCase.id,
        reviewId: jobCase.sourceReviewId,
        version: jobCase.version,
        title: jobCase.fields.find((field) => field.key === 'title')?.value ?? `案件 ${jobCase.id.slice(0, 8)}`,
        role: jobCase.fields.find((field) => field.key === 'role')?.value ?? null,
        requiredSkills: jobCase.fields.find((field) => field.key === 'required_skills')?.value ?? null,
        rate: jobCase.fields.find((field) => field.key === 'rate')?.value ?? null,
        fields: jobCase.fields
      }))
    const candidates = this.database
      .prepare<[], CandidateProfileRow>(
        `SELECT profile.profile_json, profile.status FROM candidate_profiles profile
         JOIN candidate_records record ON record.source_document_id = profile.source_document_id
         JOIN talent_pool_memberships membership ON membership.source_document_id = profile.source_document_id
         WHERE profile.status = 'current' AND record.record_status = 'active' AND membership.status = 'eligible'
         ORDER BY profile.confirmed_at DESC`
      )
      .all()
      .map((row) => candidateProfileSchema.parse(JSON.parse(row.profile_json)))
      .map((profile) => ({
        id: profile.id,
        version: profile.profileVersion,
        anonymousLabel: `候補者 ${profile.id.slice(0, 8).toLocaleUpperCase('en-US')}`,
        skills: profile.fields.find((field) => field.key === 'skills')?.value ?? null,
        experienceYears: profile.fields.find((field) => field.key === 'experience_years')?.value ?? null,
        availability: profile.fields.find((field) => field.key === 'availability')?.value ?? null,
        rate: profile.fields.find((field) => field.key === 'rate')?.value ?? null,
        japaneseLevel: profile.fields.find((field) => field.key === 'japanese_level')?.value ?? null,
        workStyle: profile.fields.find((field) => field.key === 'work_style')?.value ?? null,
        role: profile.fields.find((field) => field.key === 'role')?.value ?? null,
        fields: profile.fields,
        projectExperiences: profile.projectExperiences
      }))
    return proposalPreparationOptionsSchema.parse({ jobCases, candidates })
  }

  private hydrateProposalFollowUp(draft: ProposalDraftSnapshot): ProposalDraftSnapshot {
    const events = this.database
      .prepare<[string], ProposalFollowUpEventRow>(
        `SELECT id, draft_id, revision, stage, occurred_on, note, actor, recorded_at, cloud_eligible
         FROM proposal_follow_up_events WHERE draft_id = ? ORDER BY revision ASC`
      )
      .all(draft.id)
      .map(proposalFollowUpEventFromRow)
    return proposalDraftSnapshotSchema.parse({
      ...draft,
      followUp: {
        revision: events.length,
        stage: events.at(-1)?.stage ?? null,
        events,
        cloudEligible: false
      }
    })
  }

  getProposalWorkspace(taskId: string): ProposalWorkspaceSnapshot {
    const validatedTaskId = proposalTaskIdSchema.parse(taskId)
    const task = this.getWorkTask(validatedTaskId)
    if (!task || task.type !== 'GENERATE_PROPOSAL') throw new Error('Proposal task was not found.')
    const drafts = this.listProposalDrafts(validatedTaskId)
    const evidence = drafts.flatMap((draft) => {
      const jobCaseRow = this.database
        .prepare<[string], JobCaseRow>('SELECT case_json, status FROM job_cases WHERE id = ?')
        .get(draft.jobCaseId)
      const candidateRow = this.database
        .prepare<[string], CandidateProfileRow>('SELECT profile_json, status FROM candidate_profiles WHERE id = ?')
        .get(draft.candidateProfileId)
      if (!jobCaseRow || !candidateRow) return []
      const jobCase = confirmedJobCaseSchema.parse(JSON.parse(jobCaseRow.case_json))
      const candidate = candidateProfileSchema.parse(JSON.parse(candidateRow.profile_json))
      return [{
        draftId: draft.id,
        jobCase: {
          id: jobCase.id,
          reviewId: jobCase.sourceReviewId,
          version: jobCase.version,
          title: jobCase.fields.find((field) => field.key === 'title')?.value ?? `案件 ${jobCase.id.slice(0, 8)}`,
          role: jobCase.fields.find((field) => field.key === 'role')?.value ?? null,
          requiredSkills: jobCase.fields.find((field) => field.key === 'required_skills')?.value ?? null,
          rate: jobCase.fields.find((field) => field.key === 'rate')?.value ?? null,
          fields: jobCase.fields
        },
        candidate: {
          id: candidate.id,
          version: candidate.profileVersion,
          anonymousLabel: `候補者 ${candidate.id.slice(0, 8).toLocaleUpperCase('en-US')}`,
          skills: candidate.fields.find((field) => field.key === 'skills')?.value ?? null,
          experienceYears: candidate.fields.find((field) => field.key === 'experience_years')?.value ?? null,
          availability: candidate.fields.find((field) => field.key === 'availability')?.value ?? null,
          rate: candidate.fields.find((field) => field.key === 'rate')?.value ?? null,
          japaneseLevel: candidate.fields.find((field) => field.key === 'japanese_level')?.value ?? null,
          workStyle: candidate.fields.find((field) => field.key === 'work_style')?.value ?? null,
          role: candidate.fields.find((field) => field.key === 'role')?.value ?? null,
          fields: candidate.fields,
          projectExperiences: candidate.projectExperiences
        }
      }]
    })
    return proposalWorkspaceSnapshotSchema.parse({
      options: this.getProposalPreparationOptions(),
      drafts,
      evidence
    })
  }

  listProposalDrafts(taskId?: string): ProposalDraftSnapshot[] {
    const rows = taskId
      ? this.database
          .prepare<[string], ProposalDraftRow>(
            'SELECT payload_json, status, revision, content_hash, approved_content_hash FROM proposal_drafts WHERE task_id = ? ORDER BY updated_at DESC'
          )
          .all(taskId)
      : this.database
          .prepare<[], ProposalDraftRow>(
            'SELECT payload_json, status, revision, content_hash, approved_content_hash FROM proposal_drafts ORDER BY updated_at DESC'
          )
          .all()
    return rows.map((row) => this.hydrateProposalFollowUp(proposalDraftFromRow(row)))
  }

  getProposalDraft(draftId: string): ProposalDraftSnapshot | null {
    const row = this.database
      .prepare<[string], ProposalDraftRow>(
        'SELECT payload_json, status, revision, content_hash, approved_content_hash FROM proposal_drafts WHERE id = ?'
      )
      .get(draftId)
    return row ? this.hydrateProposalFollowUp(proposalDraftFromRow(row)) : null
  }

  createProposalDraft(
    rawInput: CreateProposalDraftInput,
    draftId: string,
    actor: string,
    now = new Date()
  ): ProposalDraftSnapshot {
    const input = createProposalDraftInputSchema.parse(rawInput)
    const task = this.getWorkTask(input.taskId)
    if (!task || task.type !== 'GENERATE_PROPOSAL') throw new Error('Proposal task was not found.')
    const caseRow = this.database
      .prepare<[string], JobCaseRow>(
        `SELECT job.case_json, job.status FROM job_cases job
         LEFT JOIN job_case_lifecycle lifecycle ON lifecycle.source_review_id = job.source_review_id
         WHERE job.id = ? AND job.status = 'active' AND coalesce(lifecycle.state, 'active') = 'active'`
      )
      .get(input.jobCaseId)
    if (!caseRow) throw new Error('Active confirmed job case was not found.')
    const profileRow = this.database
      .prepare<[string], CandidateProfileRow>(
        `SELECT profile.profile_json, profile.status FROM candidate_profiles profile
         JOIN candidate_records record ON record.source_document_id = profile.source_document_id
         JOIN talent_pool_memberships membership ON membership.source_document_id = profile.source_document_id
         WHERE profile.id = ? AND profile.status = 'current' AND record.record_status = 'active' AND membership.status = 'eligible'`
      )
      .get(input.candidateProfileId)
    if (!profileRow) throw new Error('Eligible current candidate profile was not found.')
    const draft = createLocalProposalDraft(
      input,
      confirmedJobCaseSchema.parse(JSON.parse(caseRow.case_json)),
      candidateProfileSchema.parse(JSON.parse(profileRow.profile_json)),
      draftId,
      now
    )
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO proposal_drafts(
             id, task_id, job_case_id, candidate_profile_id, payload_json, status,
             revision, content_hash, approved_content_hash, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
        )
        .run(
          draft.id,
          draft.taskId,
          draft.jobCaseId,
          draft.candidateProfileId,
          JSON.stringify(draft),
          draft.status,
          draft.revision,
          draft.contentHash,
          draft.createdAt,
          draft.updatedAt
        )
      this.insertProposalEvent(draft, 'created', actor, { generationMode: draft.generation.mode }, draft.createdAt)
    })
    save()
    this.refreshBusinessPriorityProjectionsForPair(draft.jobCaseId, draft.candidateProfileId, now)
    return draft
  }

  updateProposalDraft(rawInput: UpdateProposalDraftInput, actor: string, now = new Date()): ProposalDraftSnapshot {
    const input = updateProposalDraftInputSchema.parse(rawInput)
    const current = this.getProposalDraft(input.draftId)
    if (!current) throw new Error('Proposal draft was not found.')
    const updated = updateLocalProposalDraft(current, input, now)
    const save = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE proposal_drafts SET
             payload_json = ?, status = ?, revision = ?, content_hash = ?,
             approved_content_hash = NULL, updated_at = ?
           WHERE id = ? AND revision = ? AND content_hash = ?`
        )
        .run(
          JSON.stringify(updated),
          updated.status,
          updated.revision,
          updated.contentHash,
          updated.updatedAt,
          current.id,
          current.revision,
          current.contentHash
        )
      if (result.changes !== 1) throw new Error('Proposal draft changed while it was being updated.')
      this.insertProposalEvent(updated, 'updated', actor, { previousRevision: current.revision }, updated.updatedAt)
    })
    save()
    this.refreshBusinessPriorityProjectionsForPair(updated.jobCaseId, updated.candidateProfileId, now)
    return updated
  }

  approveProposalDraft(rawInput: ApproveProposalDraftInput, actor: string, now = new Date()): ProposalDraftSnapshot {
    const input = approveProposalDraftInputSchema.parse(rawInput)
    const current = this.getProposalDraft(input.draftId)
    if (!current) throw new Error('Proposal draft was not found.')
    if (current.revision !== input.revision) throw new Error('Proposal draft changed. Reload before approval.')
    const approved = approveLocalProposalDraft(current, input.contentHash, actor, now)
    const save = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE proposal_drafts SET
             payload_json = ?, status = ?, approved_content_hash = ?, updated_at = ?
           WHERE id = ? AND revision = ? AND content_hash = ?`
        )
        .run(
          JSON.stringify(approved),
          approved.status,
          approved.approvedContentHash,
          approved.updatedAt,
          current.id,
          current.revision,
          current.contentHash
        )
      if (result.changes !== 1) throw new Error('Proposal draft changed while it was being approved.')
      this.insertProposalEvent(approved, 'approved', actor, { approvals: Object.keys(input.approvals) }, approved.updatedAt)
    })
    save()
    this.refreshBusinessPriorityProjectionsForPair(approved.jobCaseId, approved.candidateProfileId, now)
    return approved
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
    const current = this.getProposalDraft(draftId)
    if (!current) throw new Error('Proposal draft was not found.')
    if (current.revision !== revision || current.contentHash !== expectedContentHash) {
      throw new Error('Proposal content changed. Review it again before export.')
    }
    if (current.approvedContentHash !== current.contentHash || !['approved', 'exported'].includes(current.status)) {
      throw new Error('Proposal content must be approved before export.')
    }
    if (current.followUp.stage !== null) throw new Error('A proposal with recorded delivery or sales results cannot be exported again.')
    const createdAt = now.toISOString()
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO proposal_exports(
             id, draft_id, status, target_path_hash, package_hash, error_code, created_at, completed_at
           ) VALUES (?, ?, 'preparing', ?, NULL, NULL, ?, NULL)`
        )
        .run(exportId, draftId, targetPathHash, createdAt)
      this.insertProposalEvent(current, 'export-started', actor, { exportId }, createdAt)
    })
    save()
    return current
  }

  completeProposalExport(
    exportId: string,
    draftId: string,
    expectedContentHash: string,
    packageHash: string,
    actor: string,
    now = new Date()
  ): ProposalDraftSnapshot {
    const current = this.getProposalDraft(draftId)
    if (!current || current.contentHash !== expectedContentHash) {
      throw new Error('Proposal changed before export completion could be recorded.')
    }
    const exported = markProposalExported(current, packageHash, now)
    const save = this.database.transaction(() => {
      const exportRow = this.database
        .prepare<[string, string], ProposalExportRow>(
          "SELECT id, draft_id, status FROM proposal_exports WHERE id = ? AND draft_id = ? AND status = 'preparing'"
        )
        .get(exportId, draftId)
      if (!exportRow) throw new Error('Prepared proposal export was not found.')
      const updated = this.database
        .prepare(
          `UPDATE proposal_drafts SET payload_json = ?, status = ?, approved_content_hash = ?, updated_at = ?
           WHERE id = ? AND revision = ? AND content_hash = ?`
        )
        .run(
          JSON.stringify(exported),
          exported.status,
          exported.approvedContentHash,
          exported.updatedAt,
          draftId,
          current.revision,
          expectedContentHash
        )
      if (updated.changes !== 1) throw new Error('Proposal draft changed while export was completing.')
      this.database
        .prepare(
          `UPDATE proposal_exports SET status = 'completed', package_hash = ?, completed_at = ?
           WHERE id = ? AND status = 'preparing'`
        )
        .run(packageHash, exported.exportedAt, exportId)
      this.insertProposalEvent(exported, 'exported', actor, { exportId, deliveryState: 'exported-not-sent' }, exported.updatedAt)
    })
    save()
    this.refreshBusinessPriorityProjectionsForPair(exported.jobCaseId, exported.candidateProfileId, now)
    return exported
  }

  recordProposalFollowUp(
    rawInput: RecordProposalFollowUpInput,
    eventId: string,
    actor: string,
    now = new Date()
  ): ProposalDraftSnapshot {
    const input = recordProposalFollowUpInputSchema.parse(rawInput)
    const current = this.getProposalDraft(input.draftId)
    if (!current) throw new Error('Proposal draft was not found.')
    const { draft, event } = recordLocalProposalFollowUp(current, input, eventId, actor, now)
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO proposal_follow_up_events(
             id, draft_id, revision, stage, occurred_on, note, actor, recorded_at, cloud_eligible
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
        )
        .run(
          event.id,
          event.draftId,
          event.revision,
          event.stage,
          event.occurredOn,
          event.note,
          event.recordedBy,
          event.recordedAt
        )
      const updated = this.database
        .prepare(
          `UPDATE proposal_drafts SET payload_json = ?, updated_at = ?
           WHERE id = ? AND revision = ? AND content_hash = ?`
        )
        .run(JSON.stringify(draft), draft.updatedAt, draft.id, draft.revision, draft.contentHash)
      if (updated.changes !== 1) throw new Error('Proposal draft changed while the sales result was being recorded.')
    })
    save()
    this.refreshBusinessPriorityProjectionsForPair(draft.jobCaseId, draft.candidateProfileId, now)
    return draft
  }

  failProposalExport(exportId: string, draftId: string, errorCode: string, actor: string, now = new Date()): void {
    const current = this.getProposalDraft(draftId)
    const failedAt = now.toISOString()
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE proposal_exports SET status = 'failed', error_code = ?, completed_at = ?
           WHERE id = ? AND draft_id = ? AND status = 'preparing'`
        )
        .run(errorCode.slice(0, 120), failedAt, exportId, draftId)
      if (current) this.insertProposalEvent(current, 'export-failed', actor, { exportId, errorCode: errorCode.slice(0, 120) }, failedAt)
    })
    save()
  }

  markProposalExportOutcomeUnknown(exportId: string, draftId: string, actor: string, now = new Date()): ProposalDraftSnapshot {
    const current = this.getProposalDraft(draftId)
    if (!current) throw new Error('Proposal draft was not found while recording an unknown export outcome.')
    const unknown = markProposalExportUnknown(current, now)
    const recordedAt = now.toISOString()
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE proposal_exports SET status = 'unknown', error_code = 'OUTCOME_UNKNOWN', completed_at = ?
           WHERE id = ? AND draft_id = ? AND status = 'preparing'`
        )
        .run(recordedAt, exportId, draftId)
      this.database
        .prepare('UPDATE proposal_drafts SET payload_json = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(unknown), unknown.status, unknown.updatedAt, unknown.id)
      this.insertProposalEvent(unknown, 'export-unknown', actor, { exportId }, recordedAt)
    })
    save()
    this.refreshBusinessPriorityProjectionsForPair(unknown.jobCaseId, unknown.candidateProfileId, now)
    return unknown
  }

  private recoverInterruptedProposalExports(now = new Date()): void {
    const rows = this.database
      .prepare<[], ProposalExportRow>(
        "SELECT id, draft_id, status FROM proposal_exports WHERE status = 'preparing'"
      )
      .all()
    if (rows.length === 0) return
    const recoveredAt = now.toISOString()
    const recover = this.database.transaction(() => {
      for (const row of rows) {
        const current = this.getProposalDraft(row.draft_id)
        this.database
          .prepare(
            "UPDATE proposal_exports SET status = 'unknown', error_code = 'INTERRUPTED', completed_at = ? WHERE id = ? AND status = 'preparing'"
          )
          .run(recoveredAt, row.id)
        if (!current) continue
        const unknown = markProposalExportUnknown(current, now)
        this.database
          .prepare('UPDATE proposal_drafts SET payload_json = ?, status = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(unknown), unknown.status, unknown.updatedAt, unknown.id)
        this.insertProposalEvent(unknown, 'export-unknown', 'system', { exportId: row.id }, recoveredAt)
      }
    })
    recover()
  }

  private insertProposalEvent(
    draft: ProposalDraftSnapshot,
    eventType: 'created' | 'updated' | 'approved' | 'export-started' | 'exported' | 'export-failed' | 'export-unknown',
    actor: string,
    details: Record<string, unknown>,
    createdAt: string
  ): void {
    this.database
      .prepare(
        `INSERT INTO proposal_events(
           id, draft_id, event_type, content_hash, actor, details_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), draft.id, eventType, draft.contentHash, actor, JSON.stringify(details), createdAt)
  }

  getRedactionSession(id: string): RedactionSessionEvidence | null {
    const row = this.database
      .prepare<[string], RedactionSessionRow>('SELECT * FROM redaction_sessions WHERE id = ?')
      .get(id)
    if (!row) return null
    return {
      id: row.id,
      sourceVersion: row.source_version,
      policyVersion: row.policy_version,
      status: row.status,
      contentHash: row.content_hash,
      removedTypes: JSON.parse(row.removed_types_json) as DirectIdentifier[],
      createdAt: row.created_at,
      expiresAt: row.expires_at
    }
  }

  getLocalPiiMappings(sessionId: string): LocalPiiMapping[] {
    const rows = this.database
      .prepare<[string], MappingRow>(
        'SELECT placeholder, identifier_type, encrypted_original FROM local_pii_mappings WHERE redaction_session_id = ? ORDER BY placeholder'
      )
      .all(sessionId)
    return rows.map((row) => ({
      placeholder: row.placeholder,
      identifierType: row.identifier_type,
      originalValue: openMapping(this.options.mappingKey, row, sessionId)
    }))
  }

  appendCloudCallAudit(record: CloudCallAuditRecord): void {
    this.database
      .prepare(
        `INSERT INTO cloud_call_audits(
           id, redaction_session_id, provider, task_type, endpoint, input_hash, dlp_status, outcome, reason_code,
           quality_gate_report_hash, expert_attestation_hash, review_ticket_hash, review_ticket_status,
           gate_policy_version, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.redactionSessionId,
        record.provider,
        record.taskType,
        record.endpoint,
        record.inputHash,
        record.dlpStatus,
        record.outcome,
        record.reasonCode,
        record.qualityGateReportHash,
        record.expertAttestationHash,
        record.reviewTicketHash,
        record.reviewTicketStatus,
        record.gatePolicyVersion,
        record.createdAt
      )
  }

  getSchemaVersion(): number {
    const row = this.database
      .prepare<[], { version: number }>('SELECT max(version) AS version FROM schema_migrations')
      .get()
    return row?.version ?? 0
  }

  async createConsistentSnapshot(destinationPath: string): Promise<{ dataRevision: number }> {
    mkdirSync(dirname(destinationPath), { recursive: true, mode: 0o700 })
    rmSync(destinationPath, { force: true })
    this.checkpoint()
    const snapshotSchema = 'recovery_snapshot'
    let attached = false
    let transactionOpen = false
    let snapshotDataRevision: number | null = null
    this.database.pragma('foreign_keys=OFF')
    try {
      this.database
        .prepare(`ATTACH DATABASE ? AS ${quoteSqlIdentifier(snapshotSchema)} KEY ?`)
        .run(destinationPath, this.options.databaseKey)
      attached = true
      this.database.exec('BEGIN IMMEDIATE')
      transactionOpen = true
      const unsupported = this.database
        .prepare<[], { type: string; name: string }>(
          "SELECT type, name FROM main.sqlite_master WHERE type = 'view' AND sql IS NOT NULL LIMIT 1"
        )
        .get()
      if (unsupported) throw new Error(`Consistent snapshot does not yet support ${unsupported.type}: ${unsupported.name}`)
      const tables = this.database
        .prepare<[], { name: string; sql: string }>(
          "SELECT name, sql FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name"
        )
        .all()
      for (const table of tables) {
        this.database.exec(createTableInAttachedSchema(snapshotSchema, table.name, table.sql))
      }
      for (const table of tables) {
        this.database.exec(
          `INSERT INTO ${quoteSqlIdentifier(snapshotSchema)}.${quoteSqlIdentifier(table.name)} ` +
          `SELECT * FROM main.${quoteSqlIdentifier(table.name)}`
        )
      }
      const indexes = this.database
        .prepare<[], { name: string; sql: string }>(
          "SELECT name, sql FROM main.sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name"
        )
        .all()
      for (const index of indexes) {
        this.database.exec(createIndexInAttachedSchema(snapshotSchema, index.name, index.sql))
      }
      const revisionRow = this.database
        .prepare<[], { revision: number }>(
          `SELECT revision FROM ${quoteSqlIdentifier(snapshotSchema)}.local_data_revision WHERE singleton = 1`
        )
        .get()
      if (!revisionRow) throw new Error('Consistent snapshot is missing the local data revision marker.')
      snapshotDataRevision = revisionRow.revision
      const triggers = this.database
        .prepare<[], { name: string; sql: string }>(
          "SELECT name, sql FROM main.sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL ORDER BY name"
        )
        .all()
      for (const trigger of triggers) {
        this.database.exec(createTriggerInAttachedSchema(snapshotSchema, trigger.name, trigger.sql))
      }
      const integrity = this.database.pragma(`${snapshotSchema}.integrity_check`, { simple: true })
      if (integrity !== 'ok') throw new Error('Encrypted consistent snapshot failed integrity verification.')
      this.database.exec('COMMIT')
      transactionOpen = false
      this.database.exec(`DETACH DATABASE ${quoteSqlIdentifier(snapshotSchema)}`)
      attached = false
      chmodSync(destinationPath, 0o600)
    } catch (error) {
      if (transactionOpen) {
        try { this.database.exec('ROLLBACK') } catch { /* The original error is more useful. */ }
      }
      if (attached) {
        try { this.database.exec(`DETACH DATABASE ${quoteSqlIdentifier(snapshotSchema)}`) } catch { /* Best-effort cleanup. */ }
      }
      rmSync(destinationPath, { force: true })
      throw error
    } finally {
      this.database.pragma('foreign_keys=ON')
    }
    if (snapshotDataRevision === null) throw new Error('Consistent snapshot did not capture the local data revision.')
    return { dataRevision: snapshotDataRevision }
  }

  getLocalDataRevision(): { revision: number; updatedAt: string | null } {
    const row = this.database
      .prepare<[], { revision: number; updated_at: string | null }>(
        'SELECT revision, updated_at FROM local_data_revision WHERE singleton = 1'
      )
      .get()
    if (!row) throw new Error('Local data revision marker is missing.')
    return { revision: row.revision, updatedAt: row.updated_at }
  }

  recordRecoveryEvent(
    eventType: 'backup-created' | 'restore-completed' | 'restore-failed',
    summary: RecoveryPackageSummary,
    packageHash: string,
    now = new Date(),
    dataRevision = this.getLocalDataRevision().revision
  ): void {
    if (!/^[a-f0-9]{64}$/u.test(packageHash)) throw new Error('Recovery package hash is invalid.')
    if (!Number.isSafeInteger(dataRevision) || dataRevision < 0) throw new Error('Recovery data revision is invalid.')
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO recovery_events(
             id, event_type, backup_id, package_hash, summary_json, created_at, data_revision
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          randomUUID(), eventType, summary.backupId, packageHash,
          JSON.stringify(summary), now.toISOString(), dataRevision
        )
      if (eventType === 'backup-created') {
        this.database
          .prepare(
            `UPDATE recovery_reminder_preferences
             SET snoozed_until = NULL, snoozed_revision = NULL, updated_at = ?
             WHERE singleton = 1
               AND ? >= (SELECT revision FROM local_data_revision WHERE singleton = 1)`
          )
          .run(now.toISOString(), dataRevision)
      }
    })()
  }

  snoozeRecoveryReminder(days: 1 | 7, now = new Date()): void {
    const state = this.getRecoveryState(false, now)
    if (state.reminder.status !== 'due') return
    const snoozedUntil = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
    this.database
      .prepare(
        `UPDATE recovery_reminder_preferences
         SET snoozed_until = ?, snoozed_revision = ?, updated_at = ?
         WHERE singleton = 1`
      )
      .run(snoozedUntil, state.reminder.currentDataRevision, now.toISOString())
  }

  getRecoveryState(pendingRestore = false, now = new Date()): RecoveryState {
    const lastBackup = this.database
      .prepare<[], { created_at: string; data_revision: number }>(
        `SELECT created_at, data_revision
         FROM recovery_events
         WHERE event_type = 'backup-created'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get()
    const lastRestoreAt = this.database
      .prepare<[], { created_at: string }>(
        "SELECT created_at FROM recovery_events WHERE event_type = 'restore-completed' ORDER BY created_at DESC LIMIT 1"
      )
      .get()?.created_at ?? null
    const current = this.getLocalDataRevision()
    const preference = this.database
      .prepare<[], { snoozed_until: string | null; snoozed_revision: number | null }>(
        `SELECT snoozed_until, snoozed_revision
         FROM recovery_reminder_preferences WHERE singleton = 1`
      )
      .get()
    if (!preference) throw new Error('Recovery reminder preference is missing.')
    let reason: RecoveryState['reminder']['reason'] = null
    if (current.revision > 0) {
      if (!lastBackup) reason = 'no-backup'
      else if (current.revision > lastBackup.data_revision) reason = 'data-changed'
    }
    const isSnoozed = Boolean(
      reason &&
      preference.snoozed_until &&
      preference.snoozed_revision !== null &&
      preference.snoozed_revision >= current.revision &&
      new Date(preference.snoozed_until).getTime() > now.getTime()
    )
    return {
      format: 'ses-recovery-v1',
      encryption: 'scrypt-aes-256-gcm',
      lastBackupAt: lastBackup?.created_at ?? null,
      lastRestoreAt,
      pendingRestore,
      reminder: {
        status: reason ? (isSnoozed ? 'snoozed' : 'due') : 'not-needed',
        reason,
        currentDataRevision: current.revision,
        lastBackupDataRevision: lastBackup?.data_revision ?? null,
        latestDataChangedAt: current.updatedAt,
        snoozedUntil: isSnoozed ? preference.snoozed_until : null
      }
    }
  }

  checkpoint(): void {
    this.database.pragma('wal_checkpoint(TRUNCATE)')
  }

  close(): void {
    if (this.database.open) this.database.close()
  }
}
