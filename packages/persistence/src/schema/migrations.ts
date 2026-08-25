export const currentSchemaVersion = 39

export const migrationV1 = `
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

export const migrationV2 = `
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

export const migrationV3 = `
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

export const migrationV4 = `
CREATE TABLE IF NOT EXISTS candidate_extractions (
  document_id TEXT PRIMARY KEY REFERENCES parsed_documents(document_id) ON DELETE CASCADE,
  draft_json TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK (review_status = 'awaiting-review'),
  updated_at TEXT NOT NULL
);
`

export const migrationV5 = `
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

export const migrationV6 = `
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

export const migrationV7 = `
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

export const migrationV8 = `
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

export const migrationV9 = `
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

export const migrationV10 = `
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

export const migrationV11 = `
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

export const migrationV12 = `
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

export const migrationV13 = `
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

export const backupTrackedTables = [
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

export const backupRevisionTriggers = backupTrackedTables.flatMap((table) =>
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

export const migrationV14 = `
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

export const migrationV15 = `
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

export const migrationV16 = `
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

export const migrationV17 = `
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

export const migrationV18 = `
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

export const migrationV19 = `
BEGIN IMMEDIATE;

ALTER TABLE candidate_match_runs
  ADD COLUMN hard_filter_policy_version TEXT NOT NULL DEFAULT 'fail-closed-v1'
  CHECK (hard_filter_policy_version IN ('fail-closed-v1', 'tri-state-v2'));

INSERT INTO schema_migrations(version, applied_at)
VALUES (19, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`

export const migrationV20 = `
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

export const migrationV21 = `
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

export const migrationV22 = `
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

export const migrationV23 = `
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

export const migrationV24 = `
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

export const migrationV25 = `
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

export const migrationV26 = `
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

export const migrationV27 = `
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

export const migrationV28 = `
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

export const migrationV29 = `
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

export const migrationV30 = `
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
export const migrationV31 = `
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
export const migrationV32 = `
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
export const migrationV33 = `
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

export const migrationV34 = `
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

export const migrationV35 = `
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

export const migrationV36 = `
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

export const migrationV37 = `
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

export const migrationV38 = `
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

// v39 preserves the exact interview duration supplied by the operator. The
// previous fixed preset CHECK rejected legitimate values such as 50 minutes,
// so SQLite requires an atomic table rebuild to widen the constraint.
export const migrationV39 = `
BEGIN IMMEDIATE;

DROP TRIGGER IF EXISTS backup_revision_candidate_interview_sessions_insert;
DROP TRIGGER IF EXISTS backup_revision_candidate_interview_sessions_update;
DROP TRIGGER IF EXISTS backup_revision_candidate_interview_sessions_delete;

CREATE TABLE candidate_interview_sessions_v39 (
  id TEXT PRIMARY KEY,
  source_document_id TEXT NOT NULL REFERENCES candidate_review_states(document_id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'recruiting' CHECK (kind IN ('recruiting', 'client')),
  round_number INTEGER NOT NULL DEFAULT 1 CHECK (round_number > 0 AND round_number <= 20),
  parent_interview_id TEXT REFERENCES candidate_interview_sessions_v39(id) ON DELETE SET NULL,
  stage TEXT NOT NULL CHECK (stage IN (
    'new', 'contacting', 'scheduled', 'prepared', 'interviewing', 'awaiting-decision', 'on-hold', 'passed', 'closed'
  )),
  scheduled_at TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (
    typeof(duration_minutes) = 'integer' AND duration_minutes BETWEEN 5 AND 480
  ),
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

INSERT INTO candidate_interview_sessions_v39(
  id, source_document_id, kind, round_number, parent_interview_id, stage,
  scheduled_at, duration_minutes, meeting_method, meeting_url, meeting_details_json, interviewer,
  contact_note, interview_goal, question_plan_json, interview_notes, unresolved_items_json,
  decision, decision_reason, decided_at, decided_by, created_at, updated_at, updated_by, cloud_eligible
)
SELECT id, source_document_id, kind, round_number, parent_interview_id, stage,
       scheduled_at, duration_minutes, meeting_method, meeting_url, meeting_details_json, interviewer,
       contact_note, interview_goal, question_plan_json, interview_notes, unresolved_items_json,
       decision, decision_reason, decided_at, decided_by, created_at, updated_at, updated_by, cloud_eligible
FROM candidate_interview_sessions
ORDER BY source_document_id, kind, round_number;

DROP TABLE candidate_interview_sessions;
ALTER TABLE candidate_interview_sessions_v39 RENAME TO candidate_interview_sessions;

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
VALUES (39, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
`
