import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { createSampleTasks, createWorkTaskPreview, materializeWorkTask } from '@application'
import { createRedactedManualJobCaseSource, extractJobCaseDraft } from '@job-cases'
import { EncryptedApplicationRepository } from '@persistence'

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ses-agent-schema-v13-upgrade-'))
const databasePath = join(temporaryDirectory, 'upgrade.db')
const databaseKey = randomBytes(32)
const mappingKey = randomBytes(32)
const reviewId = '923320d0-23b1-43a1-815d-6764d7cd73c5'

try {
  const sampleOnlyRepository = new EncryptedApplicationRepository({
    path: join(temporaryDirectory, 'sample-only.db'), databaseKey, mappingKey
  })
  for (const sample of createSampleTasks('2026-07-19T00:00:00.000Z')) sampleOnlyRepository.saveWorkTask(sample)
  assert.equal(sampleOnlyRepository.getLocalDataRevision().revision, 0, 'built-in sample tasks caused a false backup reminder')
  assert.equal(sampleOnlyRepository.getRecoveryState().reminder.status, 'not-needed')
  sampleOnlyRepository.close()

  const policyUpgradePath = join(temporaryDirectory, 'policy-upgrade.db')
  const policyRepository = new EncryptedApplicationRepository({
    path: policyUpgradePath, databaseKey, mappingKey
  })
  const legacyMatchTask = createSampleTasks('2026-07-19T00:00:00.000Z')
    .find((task) => task.type === 'MATCH_CANDIDATES')
  assert.ok(legacyMatchTask, 'match-candidate sample task is unavailable')
  policyRepository.saveWorkTask(legacyMatchTask)
  const legacyMatchRunId = policyRepository.saveCandidateMatchRun(
    legacyMatchTask.id,
    'Java AWS',
    [],
    new Date('2026-07-19T00:00:30.000Z')
  ).run.id
  policyRepository.close()

  const policyLegacy = new Database(policyUpgradePath)
  policyLegacy.pragma("cipher='sqlcipher'")
  policyLegacy.pragma('legacy=4')
  policyLegacy.key(databaseKey)
  policyLegacy.prepare('SELECT count(*) FROM sqlite_master').get()
  policyLegacy.pragma('foreign_keys=OFF')
  policyLegacy.exec(`
    BEGIN IMMEDIATE;
    UPDATE candidate_match_runs
    SET hard_filter_policy_version = 'tri-state-v2'
    WHERE id = '${legacyMatchRunId}';
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
    DROP TABLE business_priority_projections;
    ALTER TABLE candidate_match_results DROP COLUMN result_snapshot_json;
    DELETE FROM schema_migrations WHERE version IN (25, 36, 37, 38);
    COMMIT;
  `)
  policyLegacy.pragma('foreign_keys=ON')
  policyLegacy.close()

  const policyUpgraded = new EncryptedApplicationRepository({
    path: policyUpgradePath, databaseKey, mappingKey
  })
  const preservedLegacyMatchRun = policyUpgraded.getCandidateMatchRunSummary(legacyMatchRunId)
  assert.equal(preservedLegacyMatchRun.hardFilterPolicyVersion, 'tri-state-v2')
  policyUpgraded.close()

  const repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  const processed = createRedactedManualJobCaseSource({
    subject: 'Java 案件',
    body: '必須スキル：Java / AWS\n単価：90万円/月'
  }, '3742dd12-101f-4fbb-85eb-cd5c7b169d3c', [], new Date('2026-07-19T00:00:00.000Z'))
  const draft = extractJobCaseDraft(processed.source, reviewId, new Date('2026-07-19T00:00:00.000Z'))
  repository.saveRedactedJobCaseSourceAndDraft(
    processed.redaction.session,
    processed.redaction.mappings,
    processed.source,
    draft
  )
  repository.recordRecoveryEvent('backup-created', {
    version: 'ses-recovery-v1',
    backupId: '44794ba1-67d8-44b6-8b1c-293ef4885125',
    createdAt: '2026-07-19T00:01:00.000Z',
    sourcePlatform: 'darwin',
    sourceArch: 'arm64',
    schemaVersion: 26,
    databaseBytes: 4096,
    vaultObjectCount: 0,
    vaultBytes: 0,
    totalBytes: 4096,
    googleWorkspaceCredentialIncluded: false,
    cloudDataIncluded: false
  }, '7'.repeat(64), new Date('2026-07-19T00:01:00.000Z'))
  repository.close()

  const legacy = new Database(databasePath)
  legacy.pragma("cipher='sqlcipher'")
  legacy.pragma('legacy=4')
  legacy.key(databaseKey)
  legacy.prepare('SELECT count(*) FROM sqlite_master').get()
  const triggerNames = legacy
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'backup_revision_%'")
    .all()
  for (const trigger of triggerNames) legacy.exec(`DROP TRIGGER "${trigger.name}"`)
  legacy.exec(`
    BEGIN IMMEDIATE;
    DROP TABLE ai_conversations;
    DROP TABLE local_application_preferences;
    DROP TABLE action_events;
    DROP TABLE approval_requests;
    DROP TABLE action_runs;
    DROP TABLE candidate_interview_sessions;
    DROP TABLE candidate_interviews;
    DROP TABLE talent_pool_memberships;
    DROP TABLE candidate_records;
    DROP TABLE proposal_follow_up_events;
    DROP TABLE local_operator_profile;
    DROP TABLE google_workspace_acceptance_reports;
    DROP TABLE processing_jobs;
    DROP TABLE google_workspace_admin_configuration;
    DROP TABLE candidate_evaluation_draft_labels;
    DROP TABLE candidate_evaluation_draft_cases;
    DROP TABLE candidate_evaluation_drafts;
    DROP TABLE candidate_evaluation_reports;
    DROP TABLE candidate_evaluation_datasets;
    DROP TABLE business_priority_projections;
    DROP TABLE candidate_match_results;
    DROP TABLE candidate_match_runs;
    DROP TABLE candidate_project_embeddings;
    DROP TABLE candidate_project_review_audits;
    DROP TABLE candidate_profile_embeddings;
    DROP TABLE recovery_reminder_preferences;
    DROP TABLE local_data_revision;
    ALTER TABLE recovery_events DROP COLUMN data_revision;
    ALTER TABLE cloud_call_audits DROP COLUMN quality_gate_report_hash;
    ALTER TABLE cloud_call_audits DROP COLUMN expert_attestation_hash;
    ALTER TABLE cloud_call_audits DROP COLUMN review_ticket_hash;
    ALTER TABLE cloud_call_audits DROP COLUMN review_ticket_status;
    ALTER TABLE cloud_call_audits DROP COLUMN gate_policy_version;
    DELETE FROM schema_migrations WHERE version IN (14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38);
    COMMIT;
  `)
  assert.equal(legacy.prepare<{ version: number }>('SELECT max(version) AS version FROM schema_migrations').get()?.version, 13)
  legacy.close()

  const upgraded = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  assert.equal(upgraded.getSchemaVersion(), 38)
  assert.equal(upgraded.getJobCaseReview(reviewId)?.redactedSubject, 'Java 案件')
  assert.equal(upgraded.getLocalDataRevision().revision, 1, 'existing managed data was not conservatively marked changed')
  assert.equal(upgraded.getRecoveryState().reminder.reason, 'data-changed', 'legacy backup was incorrectly treated as revision-aware')
  const revisionBeforeMutation = upgraded.getLocalDataRevision().revision
  const upgradeTask = materializeWorkTask(
    createWorkTaskPreview('Schema v38 trigger verification'),
    'schema-v35-trigger-verification',
    '2026-07-19T00:02:00.000Z'
  )
  upgraded.saveWorkTask(upgradeTask)
  assert.ok(upgraded.getLocalDataRevision().revision > revisionBeforeMutation, 'v14 data revision triggers did not fire')
  const googleWorkspaceConfiguration = upgraded.saveGoogleWorkspaceAdminConfiguration({
    clientId: '1234567890-abcdefghijklmnop.apps.googleusercontent.com',
    workspaceDomain: 'Company.CO.JP',
    labelIds: ['INBOX', 'Label_SES'],
    query: '案件 OR 要員',
    lookbackDays: 30,
    maxMessagesPerRun: 200,
    expectedRevision: null,
    readonlyAcknowledged: true
  }, 'schema-upgrade-verifier', new Date('2026-07-19T00:03:00.000Z'))
  assert.equal(googleWorkspaceConfiguration.workspaceDomain, 'company.co.jp')
  assert.equal(googleWorkspaceConfiguration.revision, 1)
  const operatorProfile = upgraded.saveLocalOperatorProfile({
    displayName: '移行検証担当',
    roleLabel: 'SES営業担当',
    expectedRevision: null
  }, new Date('2026-07-19T00:03:30.000Z'))
  assert.equal(operatorProfile.configured, true)
  assert.equal(operatorProfile.revision, 1)
  assert.equal(operatorProfile.cloudEligible, false)
  const applicationPreferences = upgraded.saveLocalApplicationPreferences({
    locale: 'zh-CN', expectedRevision: null
  }, new Date('2026-07-19T00:03:45.000Z'))
  assert.equal(applicationPreferences.locale, 'zh-CN')
  assert.equal(applicationPreferences.revision, 1)
  assert.equal(applicationPreferences.cloudEligible, false)
  const processingJob = upgraded.enqueueProcessingJob({
    type: 'candidate-match',
    workTaskId: upgradeTask.id,
    taskStepId: upgradeTask.steps[1]!.id,
    idempotencyKey: '8'.repeat(64),
    requestFingerprint: '9'.repeat(64),
    payloadRef: `work-task:${upgradeTask.id}:candidate-match`,
    replayPolicy: 'safe-local',
    maxAttempts: 3
  }, new Date('2026-07-19T00:04:00.000Z'))
  assert.equal(processingJob.status, 'queued')
  upgraded.close()

  const inspected = new Database(databasePath)
  inspected.pragma("cipher='sqlcipher'")
  inspected.pragma('legacy=4')
  inspected.key(databaseKey)
  const triggerCount = inspected
    .prepare<[], { count: number }>("SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'backup_revision_%'")
    .get()?.count ?? 0
  const recoveryColumns = inspected.pragma('table_info(recovery_events)') as Array<{ name: string }>
  const embeddingColumns = inspected.pragma('table_info(candidate_profile_embeddings)') as Array<{ name: string }>
  const projectEmbeddingColumns = inspected.pragma('table_info(candidate_project_embeddings)') as Array<{ name: string }>
  const projectAuditColumns = inspected.pragma('table_info(candidate_project_review_audits)') as Array<{ name: string }>
  const matchRunColumns = inspected.pragma('table_info(candidate_match_runs)') as Array<{ name: string }>
  const matchRunSql = inspected
    .prepare<[], { sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'candidate_match_runs'")
    .get()?.sql ?? ''
  const matchResultColumns = inspected.pragma('table_info(candidate_match_results)') as Array<{ name: string }>
  const jobCaseSourceColumns = inspected.pragma('table_info(job_case_sources)') as Array<{ name: string }>
  const jobCaseSourceSql = inspected
    .prepare<[], { sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'job_case_sources'")
    .get()?.sql ?? ''
  const businessPriorityTableCount = inspected
    .prepare<[], { count: number }>("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'business_priority_projections'")
    .get()?.count ?? 0
  const evaluationDatasetColumns = inspected.pragma('table_info(candidate_evaluation_datasets)') as Array<{ name: string }>
  const evaluationReportColumns = inspected.pragma('table_info(candidate_evaluation_reports)') as Array<{ name: string }>
  const evaluationDraftColumns = inspected.pragma('table_info(candidate_evaluation_drafts)') as Array<{ name: string }>
  const evaluationDraftCaseColumns = inspected.pragma('table_info(candidate_evaluation_draft_cases)') as Array<{ name: string }>
  const evaluationDraftLabelColumns = inspected.pragma('table_info(candidate_evaluation_draft_labels)') as Array<{ name: string }>
  const googleWorkspaceConfigurationColumns = inspected.pragma('table_info(google_workspace_admin_configuration)') as Array<{ name: string }>
  const processingJobColumns = inspected.pragma('table_info(processing_jobs)') as Array<{ name: string }>
  const googleWorkspaceAcceptanceColumns = inspected.pragma('table_info(google_workspace_acceptance_reports)') as Array<{ name: string }>
  const localOperatorProfileColumns = inspected.pragma('table_info(local_operator_profile)') as Array<{ name: string }>
  const localApplicationPreferencesColumns = inspected.pragma('table_info(local_application_preferences)') as Array<{ name: string }>
  const proposalFollowUpColumns = inspected.pragma('table_info(proposal_follow_up_events)') as Array<{ name: string }>
  const candidateRecordColumns = inspected.pragma('table_info(candidate_records)') as Array<{ name: string }>
  const talentPoolMembershipColumns = inspected.pragma('table_info(talent_pool_memberships)') as Array<{ name: string }>
  const aiConversationColumns = inspected.pragma('table_info(ai_conversations)') as Array<{ name: string }>
  const cloudCallAuditColumns = inspected.pragma('table_info(cloud_call_audits)') as Array<{ name: string }>
  const candidateProfileSql = inspected
    .prepare<[], { sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'candidate_profiles'")
    .get()?.sql ?? ''
  const retiredCandidateLifecycle = inspected
    .prepare<[], { count: number }>("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'candidate_lifecycle'")
    .get()?.count ?? 0
  const talentEligibilityTriggerCount = inspected
    .prepare<[], { count: number }>("SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'talent_pool_memberships_require_current_profile_%'")
    .get()?.count ?? 0
  const violations = inspected.pragma('foreign_key_check') as unknown[]
  inspected.close()
  assert.equal(triggerCount, 139)
  assert.equal(recoveryColumns.some((column) => column.name === 'data_revision'), true)
  assert.equal(embeddingColumns.some((column) => column.name === 'vector_blob'), true)
  assert.equal(projectEmbeddingColumns.some((column) => column.name === 'project_id'), true)
  assert.equal(projectAuditColumns.some((column) => column.name === 'confirmed_json'), true)
  assert.equal(matchRunColumns.some((column) => column.name === 'result_set_hash'), true)
  assert.equal(matchRunColumns.some((column) => column.name === 'hard_filter_policy_version'), true)
  assert.equal(matchRunColumns.some((column) => column.name === 'job_case_id'), true)
  assert.equal(matchRunColumns.some((column) => column.name === 'candidate_pool_fingerprint'), true)
  assert.equal(matchRunColumns.some((column) => column.name === 'validity_policy_version'), true)
  assert.match(matchRunSql, /hard-filter-hybrid-local-rerank-v1/u)
  assert.equal(matchResultColumns.some((column) => column.name === 'feedback_revision'), true)
  assert.equal(matchResultColumns.some((column) => column.name === 'result_snapshot_json'), true)
  assert.equal(jobCaseSourceColumns.some((column) => column.name === 'business_fingerprint'), true)
  assert.match(jobCaseSourceSql, /'chat-paste'/u)
  assert.match(jobCaseSourceSql, /'wechat-visible'/u)
  assert.equal(businessPriorityTableCount, 1)
  assert.equal(evaluationDatasetColumns.some((column) => column.name === 'dataset_hash'), true)
  assert.equal(evaluationReportColumns.some((column) => column.name === 'report_json'), true)
  assert.equal(evaluationDraftColumns.some((column) => column.name === 'revision'), true)
  assert.equal(evaluationDraftCaseColumns.some((column) => column.name === 'pool_reviewed'), true)
  assert.equal(evaluationDraftLabelColumns.some((column) => column.name === 'expected_project_evidence'), true)
  assert.equal(googleWorkspaceConfigurationColumns.some((column) => column.name === 'client_id'), true)
  assert.equal(googleWorkspaceConfigurationColumns.some((column) => column.name === 'revision'), true)
  assert.equal(processingJobColumns.some((column) => column.name === 'lease_token'), true)
  assert.equal(processingJobColumns.some((column) => column.name === 'replay_policy'), true)
  assert.equal(googleWorkspaceAcceptanceColumns.some((column) => column.name === 'configuration_fingerprint'), true)
  assert.equal(googleWorkspaceAcceptanceColumns.some((column) => column.name === 'report_json'), true)
  assert.equal(localOperatorProfileColumns.some((column) => column.name === 'operator_id'), true)
  assert.equal(localOperatorProfileColumns.some((column) => column.name === 'revision'), true)
  assert.equal(localApplicationPreferencesColumns.some((column) => column.name === 'locale'), true)
  assert.equal(localApplicationPreferencesColumns.some((column) => column.name === 'revision'), true)
  assert.equal(proposalFollowUpColumns.some((column) => column.name === 'occurred_on'), true)
  assert.equal(proposalFollowUpColumns.some((column) => column.name === 'cloud_eligible'), true)
  assert.equal(candidateRecordColumns.some((column) => column.name === 'recruiting_status'), true)
  assert.equal(talentPoolMembershipColumns.some((column) => column.name === 'admitted_interview_id'), true)
  assert.equal(aiConversationColumns.some((column) => column.name === 'payload_json'), true)
  for (const column of [
    'quality_gate_report_hash',
    'expert_attestation_hash',
    'review_ticket_hash',
    'review_ticket_status',
    'gate_policy_version'
  ]) {
    assert.equal(cloudCallAuditColumns.some((candidate) => candidate.name === column), true)
  }
  assert.match(candidateProfileSql, /'current', 'stale', 'superseded'/u)
  assert.doesNotMatch(candidateProfileSql, /'active'/u)
  assert.equal(retiredCandidateLifecycle, 0)
  assert.equal(talentEligibilityTriggerCount, 2)
  assert.equal(violations.length, 0)

  process.stdout.write(`${JSON.stringify({
    fromSchema: 13,
    toSchema: 38,
    existingReviewPreserved: true,
    sampleTasksIgnored: true,
    legacyBackupConservativelyStale: true,
    revisionTriggerCount: triggerCount,
    embeddingCacheCreated: true,
    projectExperienceSchemaCreated: true,
    candidateMatchFeedbackSchemaCreated: true,
    candidateEvaluationSchemaCreated: true,
    candidateEvaluationAuthoringSchemaCreated: true,
    googleWorkspaceAdminConfigurationSchemaCreated: true,
    processingJobQueueSchemaCreated: true,
    googleWorkspaceAcceptanceSchemaCreated: true,
    localOperatorProfileSchemaCreated: true,
    localApplicationPreferencesSchemaCreated: true,
    proposalFollowUpSchemaCreated: true,
    aiConversationSchemaCreated: true,
    candidateAdmissionSchemaCreated: true,
    retiredCandidateLifecycleRemoved: true,
    hardFilterPolicyVersioned: true,
    legacyTriStateV2RunPreserved: true,
    legacyRrfRunPreservedAcrossV25: true,
    matchingHomeValiditySchemaCreated: true,
    businessPriorityProjectionSchemaCreated: true,
    chatPasteSourceSchemaCreated: true,
    wechatVisibleSourceSchemaCreated: true,
    foreignKeyViolations: violations.length
  })}\n`)
} finally {
  databaseKey.fill(0)
  mappingKey.fill(0)
  await rm(temporaryDirectory, { recursive: true, force: true })
}
