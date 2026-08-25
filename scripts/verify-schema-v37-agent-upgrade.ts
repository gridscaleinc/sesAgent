import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { EncryptedApplicationRepository } from '@persistence'

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ses-agent-schema-v37-upgrade-'))
const databasePath = join(temporaryDirectory, 'v37-fixture.db')
const databaseKey = randomBytes(32)
const mappingKey = randomBytes(32)
const documentId = '11111111-1111-4111-8111-111111111111'
const interviewId = '22222222-2222-4222-8222-222222222222'
const candidateConversationId = '33333333-3333-4333-8333-333333333333'
const interviewConversationId = '44444444-4444-4444-8444-444444444444'
const salesConversationId = '55555555-5555-4555-8555-555555555555'
let oldActionRunId = ''
let linkedActionRunId = ''
const turnId = '99999999-9999-4999-8999-999999999999'

function openRawDatabase(): Database.Database {
  const database = new Database(databasePath)
  database.pragma("cipher='sqlcipher'")
  database.pragma('legacy=4')
  database.key(databaseKey)
  database.prepare('SELECT count(*) FROM sqlite_master').get()
  return database
}

const candidateContext = {
  assistant: 'candidate-profile' as const,
  candidateDocumentId: documentId,
  interviewId: null,
  interviewKind: null,
  roundNumber: null
}
const interviewContext = {
  assistant: 'interview' as const,
  candidateDocumentId: documentId,
  interviewId,
  interviewKind: 'recruiting' as const,
  roundNumber: 1
}
const extractionDraftJson = JSON.stringify({
  version: 'candidate-extraction-v5',
  documentId,
  extractor: 'deterministic-local-v4',
  localPersonalDetails: {
    displayName: null, gender: null, birthDate: null, nationality: null, phone: null, email: null,
    address: null, education: null, major: null, graduationDate: null, degree: null
  },
  fields: ['skills', 'experience_years', 'availability', 'rate', 'japanese_level', 'work_style', 'role', 'location'].map((key) => ({
    key, label: key, value: null, confidence: 0, status: 'missing', sources: []
  })),
  projectExperiences: [],
  requiresReview: true,
  createdAt: '2026-08-18T00:00:00.000Z'
})

try {
  const seeded = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  seeded.close()

  const parents = openRawDatabase()
  parents.pragma('foreign_keys=OFF')
  parents.exec(`
    BEGIN IMMEDIATE;
    INSERT INTO redaction_sessions(id, source_version, policy_version, status, content_hash, removed_types_json, created_at, expires_at)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'fixture:v37', 'cloud-redaction-v2', 'passed', NULL, '[]', '2026-08-18T00:00:00.000Z', '2026-08-19T00:00:00.000Z');
    INSERT INTO staged_files(token, name, format, size, sha256, encrypted_path, privacy_status, created_at)
      VALUES ('${documentId}', 'fixture.pdf', 'pdf', 1, '${'a'.repeat(64)}', '/tmp/fixture.sesv', 'awaiting-local-scan', '2026-08-18T00:00:00.000Z');
    INSERT INTO parsed_documents(document_id, document_ir_json, analysis_summary_json, redaction_session_id, parser_version, analyzed_at)
      VALUES ('${documentId}', '{}', '{}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'fixture', '2026-08-18T00:00:00.000Z');
    INSERT INTO candidate_extractions(document_id, draft_json, review_status, updated_at)
      VALUES ('${documentId}', '${extractionDraftJson}', 'awaiting-review', '2026-08-18T00:00:00.000Z');
    INSERT INTO candidate_review_states(document_id, extraction_version, extraction_created_at, status, pii_reviewed, revision, updated_at)
      VALUES ('${documentId}', 'fixture', '2026-08-18T00:00:00.000Z', 'completed', 1, 1, '2026-08-18T00:00:00.000Z');
    INSERT INTO candidate_interview_sessions(
      id, source_document_id, kind, round_number, parent_interview_id, stage, scheduled_at, duration_minutes,
      meeting_method, meeting_url, meeting_details_json, interviewer, contact_note, interview_goal,
      question_plan_json, interview_notes, unresolved_items_json, decision, decision_reason, decided_at,
      decided_by, created_at, updated_at, updated_by, cloud_eligible
    ) VALUES (
      '${interviewId}', '${documentId}', 'recruiting', 1, NULL, 'scheduled', '2026-08-18T01:00:00.000Z', 60,
      'zoom', NULL, '{}', 'fixture reviewer', NULL, NULL, '[]', NULL, '[]', NULL, NULL, NULL, NULL,
      '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z', 'fixture reviewer', 0
    );
    COMMIT;
  `)
  parents.pragma('foreign_keys=ON')
  parents.close()

  const legacySource = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  legacySource.saveAiConversation({
    conversationId: candidateConversationId,
    context: candidateContext,
    messages: [{ id: 'legacy-candidate-message', role: 'user', content: '旧候选人会话', mode: 'local', createdAt: '2026-08-18T00:01:00.000Z' }],
    expectedRevision: null
  }, new Date('2026-08-18T00:01:00.000Z'))
  legacySource.saveAiConversation({
    conversationId: interviewConversationId,
    context: interviewContext,
    messages: [{ id: 'legacy-interview-message', role: 'assistant', content: '旧面谈会话', mode: 'local', createdAt: '2026-08-18T00:01:01.000Z' }],
    expectedRevision: null
  }, new Date('2026-08-18T00:01:01.000Z'))
  const oldAction = legacySource.createActionRun({
    toolName: 'resume.analyze.local', workTaskId: null, origin: 'user-command', scopeId: 'selected-files',
    scopeFingerprint: '1'.repeat(64), inputHash: '2'.repeat(64), contentRevision: null,
    status: 'queued', idempotencyKey: 'legacy-v37-action'
  })
  oldActionRunId = oldAction.id
  legacySource.close()

  const downgrade = openRawDatabase()
  downgrade.pragma('foreign_keys=OFF')
  downgrade.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE ai_conversations_backup AS SELECT id, assistant_type, context_key, candidate_document_id, interview_id, interview_kind, round_number, title, payload_json, revision, created_at, updated_at FROM ai_conversations;
    CREATE TABLE action_runs_backup AS SELECT id, tool_name, tool_version, work_task_id, origin, scope_id, scope_fingerprint, input_hash, content_revision, status, idempotency_key, processing_job_id, result_hash, error_code, created_at, updated_at FROM action_runs;
    CREATE TABLE action_events_backup AS SELECT id, action_run_id, event_type, detail_json, created_at FROM action_events;
    DROP TABLE action_events;
    DROP TABLE approval_requests;
    DROP TABLE action_runs;
    DROP TABLE ai_conversations;

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
    INSERT INTO ai_conversations SELECT * FROM ai_conversations_backup;
    CREATE INDEX ai_conversations_context_idx ON ai_conversations(context_key, updated_at DESC);

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
    INSERT INTO action_runs SELECT * FROM action_runs_backup;
    CREATE INDEX action_runs_task_idx ON action_runs(work_task_id, created_at DESC);
    CREATE INDEX action_runs_status_idx ON action_runs(status, created_at DESC);

    CREATE TABLE approval_requests (
      id TEXT PRIMARY KEY,
      action_run_id TEXT NOT NULL UNIQUE REFERENCES action_runs(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'cancelled')),
      reason TEXT NOT NULL, safe_summary TEXT NOT NULL, expires_at TEXT NOT NULL,
      resolved_by TEXT, resolved_at TEXT, created_at TEXT NOT NULL,
      CHECK ((status IN ('approved', 'denied')) = (resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
    );

    CREATE TABLE action_events (
      id TEXT PRIMARY KEY,
      action_run_id TEXT NOT NULL REFERENCES action_runs(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK (event_type IN ('proposed', 'policy_evaluated', 'approval_requested', 'approval_resolved', 'approval_expired', 'execution_started', 'execution_finished', 'execution_failed', 'cancelled', 'blocked')),
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO action_events SELECT * FROM action_events_backup;
    CREATE INDEX action_events_run_idx ON action_events(action_run_id, created_at ASC);
    CREATE TRIGGER backup_revision_action_events_insert AFTER INSERT ON action_events BEGIN UPDATE local_data_revision SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE singleton = 1; END;
    DROP TABLE action_events_backup;
    DROP TABLE action_runs_backup;
    DROP TABLE ai_conversations_backup;
    DELETE FROM schema_migrations WHERE version IN (38, 39);
    COMMIT;
  `)
  downgrade.pragma('foreign_keys=ON')
  downgrade.close()

  const upgraded = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  assert.equal(upgraded.getSchemaVersion(), 39)
  assert.equal(upgraded.getAiConversation(candidateConversationId)?.context.assistant, 'candidate-profile')
  assert.equal(upgraded.getAiConversation(interviewConversationId)?.context.assistant, 'interview')
  assert.equal(upgraded.getActionRunStatus(oldActionRunId), 'queued')
  const newTool = upgraded.createActionRun({
    toolName: 'job-case.search.local', workTaskId: null, origin: 'user-command', scopeId: 'active-job-cases',
    scopeFingerprint: '3'.repeat(64), inputHash: '4'.repeat(64), contentRevision: null,
    status: 'queued', idempotencyKey: 'v38-new-tool'
  })
  assert.match(newTool.id, /^[0-9a-f-]{36}$/u)
  const salesConversation = upgraded.saveAiConversation({
    conversationId: salesConversationId,
    context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
    messages: [{ id: 'sales-message', role: 'assistant', content: 'Sales Agent 会話', mode: 'local', createdAt: '2026-08-18T00:02:00.000Z' }],
    expectedRevision: null
  })
  const linked = upgraded.createActionRun({
    toolName: 'job-case.search.local', workTaskId: null, origin: 'user-command', scopeId: 'active-job-cases',
    scopeFingerprint: '5'.repeat(64), inputHash: '6'.repeat(64), contentRevision: null,
    conversationId: salesConversation.id, turnId, status: 'queued', idempotencyKey: 'v38-linked-action'
  })
  linkedActionRunId = linked.id
  assert.deepEqual(upgraded.deleteAiConversations([salesConversationId]), [salesConversationId])
  assert.equal(upgraded.getActionRunStatus(linkedActionRunId), 'queued')
  upgraded.close()

  const inspected = openRawDatabase()
  const actionEventCount = inspected.prepare<[string], { count: number }>('SELECT count(*) AS count FROM action_events WHERE action_run_id = ?').get(oldActionRunId)?.count ?? 0
  const linkedConversation = inspected.prepare<[string], { conversation_id: string | null }>('SELECT conversation_id FROM action_runs WHERE id = ?').get(linkedActionRunId)
  const violations = inspected.pragma('foreign_key_check') as unknown[]
  inspected.close()
  assert.ok(actionEventCount >= 1, 'legacy ActionEvent was not preserved')
  assert.equal(linkedConversation?.conversation_id, null, 'conversation deletion did not SET NULL on ActionRun')
  assert.equal(violations.length, 0)

  process.stdout.write(JSON.stringify({
    fromSchema: 37,
    toSchema: 39,
    legacyCandidateConversationPreserved: true,
    legacyInterviewConversationPreserved: true,
    legacyActionRunPreserved: true,
    legacyActionEventPreserved: true,
    newToolActionRunAccepted: true,
    salesConversationActionRunSetNull: true,
    foreignKeyViolations: violations.length
  }) + '\n')
} finally {
  databaseKey.fill(0)
  mappingKey.fill(0)
  await rm(temporaryDirectory, { recursive: true, force: true })
}
