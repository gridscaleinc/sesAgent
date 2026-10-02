import { searchConfirmedCandidateProfiles } from '@resume'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { currentSchemaVersion, EncryptedApplicationRepository } from '@persistence'
import { migrationV39 } from '../packages/persistence/src/schema/migrations'
import { redactTextForCloud } from '@privacy'
import { extractCandidateDraft } from '@resume'
import { createRedactedManualJobCaseSource, extractJobCaseDraft } from '@job-cases'
import { builtInPersonnelTemplates, generatePersonnelMessage, type ResumeAnalysisSummary } from '@shared'
import type { DocumentIR } from '@parsers'

function describeSchemaShape(database: Database.Database): string[] {
  const objects = database
    .prepare<[], { type: string; name: string }>("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all()
  const shape = objects.map((object) => `${object.type}:${object.name}`)
  for (const object of objects.filter((candidate) => candidate.type === 'table')) {
    for (const column of database.pragma(`table_info("${object.name}")`) as Array<{ name: string }>)
      shape.push(`column:${object.name}.${column.name}`)
  }
  return shape.sort()
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ses-business-verification-'))
const databasePath = join(temporaryDirectory, 'verification.db')
const databaseKey = randomBytes(32)
const mappingKey = randomBytes(32)
const documentId = '559dcb5d-dcf0-4c11-a12d-698cfef220e6'
const mappingSentinel = 'TEST_PRIVATE_NAME'
let repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
try {
  const redaction = redactTextForCloud(mappingSentinel, {
    sourceVersion: 'business-test:v1',
    knownPersonNames: [mappingSentinel],
    personNameReviewCompleted: true,
    sessionId: 'b0d9223d-fcab-49d6-bc1c-4d0c7dcd1318'
  })
  repository.saveRedactionSession(redaction.session, redaction.mappings)
  repository.saveStagedFile({
    token: documentId,
    name: 'verification-resume.pdf',
    format: 'pdf',
    size: 2048,
    sha256: 'a'.repeat(64),
    encryptedPath: join(temporaryDirectory, 'verification-resume.vault'),
    privacyStatus: 'awaiting-local-scan',
    createdAt: '2026-07-17T00:00:00.000Z'
  })
  const document: DocumentIR = {
    version: 'document-ir-v1',
    documentId,
    source: {
      name: 'verification-resume.pdf',
      format: 'pdf',
      sha256: 'a'.repeat(64),
      size: 2048
    },
    blocks: [
      {
        id: 'page-1-block-1',
        kind: 'text',
        text: '案件名: 決済基盤刷新 / 2022年4月〜2024年3月 / Java / AWS / PL / クラウド移行の設計・構築を担当 / 経験 7年 / 希望単価 80〜90万円',
        source: { page: 1, boundingBox: [10, 10, 400, 35] }
      }
    ],
    warnings: [],
    requiresLocalOcr: false,
    statistics: { pages: 1, sheets: 0, blocks: 1, characters: 92 },
    security: {
      externalContentLoaded: false,
      macrosExecuted: false,
      rawFileCloudEligible: false
    }
  }
  const extraction = extractCandidateDraft(document, new Date('2026-07-17T00:01:00.000Z'))
  const summary: ResumeAnalysisSummary = {
    analysisVersion: 'resume-analysis-v6',
    fileToken: documentId,
    fileName: 'verification-resume.pdf',
    status: 'requires-pii-review',
    cloudEligible: false,
    statistics: document.statistics,
    detectedIdentifiers: [{ type: 'person_name', count: 1 }],
    localProcessing: {
      ocr: 'not-required',
      ocrPages: 0,
      personNameCandidates: 1,
      networkAccess: false
    },
    extractedFields: extraction.fields.map((field) => ({
      key: field.key,
      label: field.label,
      value: field.value,
      confidence: field.confidence,
      status: field.status,
      sourceLabels: field.sources.map((source) => source.sourceLabel)
    })),
    extractedProjectExperiences: extraction.projectExperiences.map((project) => ({
      draftId: project.draftId,
      title: project.title,
      period: project.period,
      role: project.role,
      technologies: project.technologies,
      summary: project.summary,
      confidence: project.confidence,
      sourceLabels: project.sources.map((source) => source.sourceLabel)
    })),
    warningCodes: ['PERSON_NAME_REVIEW_REQUIRED'],
    redactedPreview: '<PERSON_NAME_001> / Java / AWS',
    analyzedAt: '2026-07-17T00:01:00.000Z'
  }
  repository.saveParsedDocument(document, summary, redaction.session.id, extraction)
  // An older install may contain only an extraction. Opening it prepares the
  // same usable personnel profile, while keeping its review history untouched.
  repository.close()
  const legacyPersonnel = new Database(databasePath)
  legacyPersonnel.pragma("cipher='sqlcipher'")
  legacyPersonnel.pragma('legacy=4')
  legacyPersonnel.key(databaseKey)
  legacyPersonnel.prepare('DELETE FROM candidate_profiles WHERE source_document_id = ?').run(documentId)
  legacyPersonnel.close()
  repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })

  const confirm = () => {
    const review = repository.getCandidateReview(documentId)!
    return repository.confirmCandidateReview(
      {
        documentId,
        reviewRevision: review.reviewRevision,
        piiReviewed: true,
        fields: review.fields.map((field) => ({ key: field.key, value: field.value, confirmed: true })),
        projectExperiences: review.projectExperiences.map((p) => ({
          draftId: p.draftId,
          title: p.title,
          period: p.period,
          role: p.role,
          technologies: p.technologies,
          summary: p.summary,
          confirmed: true
        }))
      },
      'test-hr',
      'Test HR'
    )
  }
  const pendingReview = repository.getCandidateReview(documentId)!
  assert.equal(repository.getBusinessFeed()[0]!.businessStatus, 'available', 'new personnel enters the prospecting queue')
  assert.equal(repository.getBusinessFeed()[0]!.needsReview, false, 'business feed must not insert a review step')
  assert.equal(pendingReview.status, 'awaiting-review', 'import must not fabricate an HR review')
  assert.equal(pendingReview.piiReviewed, false)
  assert.equal(pendingReview.profile?.confirmedBy, '本机导入')
  assert.equal(repository.listEligibleTalentProfiles().length, 1, 'imported personnel can immediately match cases')
  assert.equal(repository.countEligibleTalentProfiles(), 1, 'personnel counts include imported records without review')
  assert.ok(
    searchConfirmedCandidateProfiles(repository.listEligibleTalentProfiles(), 'Java').length > 0,
    'a case can find newly imported personnel'
  )
  let importedVersion = pendingReview.profile!.version
  const initialTemplate = builtInPersonnelTemplates()[0]!
  const importedMessage = {
    documentId,
    profileVersion: importedVersion,
    reviewRevision: pendingReview.reviewRevision,
    templateId: initialTemplate.id,
    templateRevision: initialTemplate.revision,
    lang: 'ja' as const,
    text: generatePersonnelMessage(pendingReview, initialTemplate, 'ja')
  }
  assert.equal(
    repository.validatePersonnelMessage(importedMessage).text,
    importedMessage.text,
    'imported personnel can immediately promote without admission'
  )
  repository.recordPersonnelCopy(importedMessage, 'test-hr')
  assert.throws(() => repository.validatePersonnelMessage({ ...importedMessage, reviewRevision: pendingReview.reviewRevision + 1 }), /更新/)
  const importedProfile = repository.listEligibleTalentProfiles()[0]!
  assert.ok(
    repository.getProposalPreparationOptions().candidates.some((candidate) => candidate.id === importedProfile.id),
    'matched imported personnel are available for introductions'
  )
  const editedProfile = repository.updateCandidateProfile(
    {
      sourceDocumentId: documentId,
      expectedVersion: importedVersion,
      identity: importedProfile.localPersonalDetails,
      fields: importedProfile.fields.map((field) => ({ key: field.key, value: field.key === 'rate' ? null : field.value })),
      projectExperiences: importedProfile.projectExperiences.map((project) => ({ ...project, title: 'HR updated Java project' }))
    },
    'test-hr',
    'Test HR'
  )
  importedVersion = editedProfile.profileVersion
  const editedReview = repository.getCandidateReview(documentId)!
  assert.equal(editedReview.status, 'awaiting-review', 'editing must not fabricate a separate review')
  assert.equal(editedReview.projectExperiences[0]!.title, 'HR updated Java project', 'sidebar uses the current personnel-management edits')
  assert.equal(editedReview.fields.find((field) => field.key === 'rate')!.value, null, 'cleared values must not revive extracted values')
  assert.throws(() => repository.validatePersonnelMessage(importedMessage), /更新/)
  assert.equal(
    repository.validatePersonnelMessage({
      ...importedMessage,
      profileVersion: importedVersion,
      text: generatePersonnelMessage(editedReview, initialTemplate, 'ja')
    }).profileVersion,
    importedVersion
  )
  assert.throws(() =>
    repository.setCandidateBusinessState(
      { documentId, profileVersion: importedVersion + 1, status: 'available', confirmed: true },
      'test-hr'
    )
  )
  repository.setCandidateBusinessState(
    { documentId, profileVersion: importedVersion, reviewRevision: pendingReview.reviewRevision, status: 'assigned', confirmed: true },
    'test-hr'
  )
  repository.close()
  repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  assert.equal(repository.getBusinessFeed()[0]!.businessStatus, 'assigned')
  assert.equal(repository.listEligibleTalentProfiles().length, 0, 'business state must not confirm draft fields')
  assert.equal(
    repository.getCurrentCandidateProfile(documentId)?.profileVersion,
    importedVersion,
    'assigned personnel remain accessible for management edits'
  )
  assert.throws(() =>
    repository.setCandidateBusinessState(
      {
        documentId,
        profileVersion: importedVersion,
        reviewRevision: pendingReview.reviewRevision + 1,
        status: 'available',
        confirmed: true
      },
      'test-hr'
    )
  )
  repository.setCandidateBusinessState(
    { documentId, profileVersion: importedVersion, reviewRevision: pendingReview.reviewRevision, status: 'available', confirmed: true },
    'test-hr'
  )
  let review = confirm()
  const version = review.profile!.version
  assert.equal(repository.listEligibleTalentProfiles().length, 1, 'editing personnel must not require promotion reconfirmation')
  const state = { documentId, profileVersion: version, status: 'available' as const, confirmed: true as const }
  repository.setCandidateBusinessState(state, 'test-hr')
  assert.equal(repository.listEligibleTalentProfiles().length, 1, 'HR admission must not require a recruiting interview')
  assert.equal(repository.getCandidateReview(documentId)!.talentPoolStatus, 'eligible')
  const template = builtInPersonnelTemplates()[0]!
  const message = {
    documentId,
    profileVersion: version,
    templateId: template.id,
    templateRevision: template.revision,
    lang: 'ja' as const,
    text: generatePersonnelMessage(review, template, 'ja')
  }
  assert.equal(repository.validatePersonnelMessage(message).text, message.text)
  assert.throws(() => repository.validatePersonnelMessage({ ...message, text: '連絡先 test@example.com' }))
  assert.throws(() => repository.validatePersonnelMessage({ ...message, text: mappingSentinel }))
  assert.throws(() => repository.validatePersonnelMessage({ ...message, to: 'test@example.com' }))
  repository.recordPersonnelCopy(message, 'test-hr')
  assert.equal(repository.getPersonnelWorkspace().copies.length, 2)
  assert.equal('text' in repository.getPersonnelWorkspace().copies[0]!, false)
  repository.savePersonnelTemplate({ ...template, name: 'HR custom' })
  assert.throws(() => repository.savePersonnelTemplate(template), /更新|再読込/)
  assert.throws(() => repository.validatePersonnelMessage(message), /模板|テンプレート/)
  const updatedMessage = { ...message, templateRevision: 2 }
  repository.setCandidateBusinessState({ ...state, status: 'paused' }, 'test-hr')
  assert.equal(repository.listEligibleTalentProfiles().length, 0)
  assert.throws(() => repository.validatePersonnelMessage(updatedMessage))
  repository.setCandidateBusinessState({ ...state, status: 'soon' }, 'test-hr')
  repository.saveParsedDocument(document, summary, redaction.session.id, { ...extraction, createdAt: new Date().toISOString() })
  assert.equal(repository.listEligibleTalentProfiles().length, 1, 'reimported personnel remain usable without another approval')
  assert.throws(() => repository.validatePersonnelMessage(updatedMessage), /更新/, 'old copy versions must still be rejected')
  review = confirm()
  assert.ok(review.profile!.version > version)
  assert.equal(repository.listEligibleTalentProfiles().length, 1, 'updated personnel remain available automatically')
  assert.throws(() => repository.setCandidateBusinessState(state, 'test-hr'))
  repository.setCandidateBusinessState({ ...state, profileVersion: review.profile!.version }, 'test-hr')
  assert.equal(repository.listEligibleTalentProfiles().length, 1)
  repository.close()
  repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  assert.equal(repository.listEligibleTalentProfiles().length, 1)
  assert.equal(repository.getPersonnelWorkspace().templates[0]!.revision, 2)
  assert.equal(repository.getPersonnelWorkspace().copies.length, 2)
  const feed = repository.getBusinessFeed()
  const entry = feed.find((item) => item.kind === 'person' && item.objectId === documentId)!
  assert.ok(entry.unseen)
  repository.markBusinessFeed({ kind: entry.kind, objectId: entry.objectId, revision: entry.revision, action: 'defer' })
  assert.equal(repository.getBusinessFeed()[0]!.unseen, false)
  assert.equal(repository.getBusinessFeed()[0]!.deferred, true)
  repository.close()
  repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  assert.equal(repository.getBusinessFeed()[0]!.deferred, true, 'deferred work survives restart')
  assert.equal(repository.getBusinessFeed()[0]!.unseen, false)
  repository.setCandidateBusinessState({ ...state, profileVersion: review.profile!.version, status: 'paused' }, 'test-hr')
  assert.equal(repository.getBusinessFeed()[0]!.unseen, true, 'status updates become unread again')
  assert.equal(repository.getBusinessFeed()[0]!.event, 'status-changed')
  assert.equal(repository.getBusinessFeed()[0]!.changes[0]!.after, 'paused')
  assert.equal(repository.getBusinessFeed()[0]!.businessStatus, 'paused')
  assert.throws(() => repository.markBusinessFeed({ kind: entry.kind, objectId: entry.objectId, revision: entry.revision, action: 'seen' }))
  const freshEntry = repository.getBusinessFeed()[0]!
  assert.throws(() => repository.markBusinessFeed({ ...freshEntry, action: 'seen' } as never))
  repository.markBusinessFeed({ kind: freshEntry.kind, objectId: freshEntry.objectId, revision: freshEntry.revision, action: 'seen' })
  assert.equal(repository.getBusinessFeed()[0]!.deferred, true, 'viewing does not complete deferred work')
  const followSource = createRedactedManualJobCaseSource(
    { subject: 'Followup Java project', body: '必須スキル：Java / SQL' },
    'fa892f81-f9d4-42cf-8050-e68ad880ccad',
    []
  )
  const followDraft = extractJobCaseDraft(followSource.source, 'fb892f81-f9d4-42cf-8050-e68ad880ccad')
  repository.saveRedactedJobCaseSourceAndDraft(
    followSource.redaction.session,
    followSource.redaction.mappings,
    followSource.source,
    followDraft
  )
  const followReview = repository.getJobCaseReview(followDraft.reviewId)!
  const confirmedCase = repository.confirmJobCaseReview(
    {
      reviewId: followDraft.reviewId,
      reviewRevision: followReview.reviewRevision,
      privacyReviewed: true,
      fields: followReview.fields.map((field) => ({ key: field.key, value: field.value, confirmed: true }))
    },
    'test-hr',
    'Test HR'
  )
  repository.setCandidateBusinessState({ ...state, profileVersion: review.profile!.version, status: 'available' }, 'test-hr')
  const currentMessage = {
    ...updatedMessage,
    profileVersion: review.profile!.version,
    caseContext: { reviewId: followDraft.reviewId, version: confirmedCase.jobCase!.version }
  }
  assert.equal(repository.validatePersonnelMessage(currentMessage).caseContext?.reviewId, followDraft.reviewId)
  assert.throws(
    () => repository.validatePersonnelMessage({ ...currentMessage, caseContext: { ...currentMessage.caseContext, version: 99 } }),
    /更新/
  )
  assert.equal(repository.listBusinessFollowUps().length, 0, 'copying or matching never fabricates contact')
  const beforeFollowRevision = repository.getLocalDataRevision().revision
  const follow = repository.saveBusinessFollowUp(
    {
      documentId,
      reviewId: followDraft.reviewId,
      expectedRevision: 0,
      status: 'contacted',
      note: 'Synthetic contact note',
      nextStep: 'Await reply'
    },
    'test-hr'
  )
  assert.equal(follow.revision, 1)
  assert.ok(repository.getLocalDataRevision().revision > beforeFollowRevision, 'followup participates in encrypted backup revision')
  assert.throws(
    () =>
      repository.saveBusinessFollowUp(
        { documentId, reviewId: followDraft.reviewId, expectedRevision: 0, status: 'replied', note: 'stale', nextStep: '' },
        'test-hr'
      ),
    /更新/
  )
  const beforeFollowEditDeletion = repository.previewCandidateDeletion(documentId)
  assert.equal(beforeFollowEditDeletion.counts.businessFollowUps, 1)
  const reply = repository.saveBusinessFollowUp(
    {
      documentId,
      reviewId: followDraft.reviewId,
      expectedRevision: 1,
      status: 'replied',
      note: 'Synthetic reply',
      nextStep: 'Schedule interview'
    },
    'test-hr'
  )
  assert.equal(reply.events.length, 2)
  assert.notEqual(
    repository.previewCandidateDeletion(documentId).confirmationHash,
    beforeFollowEditDeletion.confirmationHash,
    'editing followups invalidates an old deletion preview'
  )
  repository.close()
  repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  assert.equal(repository.listBusinessFollowUps()[0]!.note, 'Synthetic reply', 'followups survive restart')
  const deletion = repository.previewCandidateDeletion(documentId)
  repository.deleteCandidateDatabaseData(documentId, deletion.confirmationHash)
  assert.equal(repository.getPersonnelWorkspace().states.length, 0)
  assert.equal(repository.getPersonnelWorkspace().copies.length, 0)
  assert.equal(repository.getBusinessFeed().filter((item) => item.kind === 'person').length, 0)
  assert.equal(repository.listBusinessFollowUps().length, 0, 'personnel deletion cascades followups')
  repository.setJobCaseLifecycle({ reviewId: followDraft.reviewId, state: 'archived', reason: 'End synthetic fixture' }, 'test-hr')
  const source = createRedactedManualJobCaseSource(
    { subject: 'TEST Java project', body: '必須スキル：Java / SQL' },
    'aa892f81-f9d4-42cf-8050-e68ad880ccad',
    []
  )
  const draft = extractJobCaseDraft(source.source, 'bb892f81-f9d4-42cf-8050-e68ad880ccad')
  repository.saveRedactedJobCaseSourceAndDraft(source.redaction.session, source.redaction.mappings, source.source, draft)
  repository.setJobCaseLifecycle({ reviewId: draft.reviewId, state: 'archived', reason: 'HR marks draft unavailable' }, 'test-hr')
  repository.close()
  repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  assert.equal(repository.getBusinessFeed().find((item) => item.objectId === draft.reviewId)!.businessStatus, 'archived')
  const draftReview = repository.getJobCaseReview(draft.reviewId)!
  repository.confirmJobCaseReview(
    {
      reviewId: draft.reviewId,
      reviewRevision: draftReview.reviewRevision,
      privacyReviewed: true,
      fields: draftReview.fields.map((field) => ({ key: field.key, value: field.value, confirmed: true }))
    },
    'test-hr',
    'Test HR'
  )
  assert.equal(repository.getJobCaseReview(draft.reviewId)!.lifecycle, 'archived', 'field confirmation must not restore an invalid case')
  assert.equal(repository.listActiveJobCases().length, 0)
  repository.setJobCaseLifecycle({ reviewId: draft.reviewId, state: 'active', reason: 'HR restores current case' }, 'test-hr')
  assert.equal(repository.listActiveJobCases().length, 1)
  repository.close()
  // Exercise an actual v44-shaped encrypted database upgrade. Every table, column, index and
  // rebuild introduced by v45-v60 is reverted so the upgrade replays the real migration path.
  const openRaw = (path: string) => {
    const raw = new Database(path)
    raw.pragma("cipher='sqlcipher'")
    raw.pragma('legacy=4')
    raw.key(databaseKey)
    return raw
  }
  const db = openRaw(databasePath)
  db.pragma('foreign_keys=OFF')
  db.exec('BEGIN IMMEDIATE')
  for (const table of [
    'communication_points',
    'requirement_confirmations',
    'recommendation_points',
    'person_case_match_run_items',
    'person_case_match_runs',
    'personnel_introduction_drafts',
    'case_introduction_drafts',
    'job_case_working_set',
    'case_person_question_drafts',
    'growth_checkpoints',
    'question_bank_revisions',
    'matching_opportunities',
    'interview_answers',
    'customer_identities',
    'question_bank_uses',
    'question_bank_sources',
    'question_bank',
    'experience_settings',
    'experience_versions',
    'experience_observations',
    'experience_events',
    'experience_runs',
    'case_person_feedback',
    'case_person_assessments',
    'ai_work_rule_versions',
    'personnel_mail_updates',
    'business_progress_mail',
    'gmail_business_intake',
    'business_followups',
    'business_feed_marks',
    'personnel_copies',
    'personnel_templates',
    'candidate_business_states'
  ])
    db.exec(`DROP TABLE ${table}`)
  db.exec(`
    ALTER TABLE candidate_records DROP COLUMN in_talent_library;
    DROP INDEX parsed_documents_intake_fingerprint;
    DROP INDEX job_case_sources_intake_fingerprint;
    ALTER TABLE parsed_documents DROP COLUMN intake_fingerprint;
    ALTER TABLE job_case_sources DROP COLUMN intake_fingerprint;
    ALTER TABLE local_application_preferences DROP COLUMN ai_models;
    ALTER TABLE local_application_preferences DROP COLUMN menu_bar;
  `)
  // v60 added backup-revision triggers to tables that already existed at v44.
  for (const { name } of db
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'backup_revision_%_v60_%'")
    .all())
    db.exec(`DROP TRIGGER "${name}"`)
  db.exec('COMMIT')
  // v49 rebuilt candidate_interview_sessions with business_followup_id; restore the v39-v48 shape.
  db.exec(migrationV39.replace(/INSERT INTO schema_migrations\(version, applied_at\)\s*VALUES \(39,[^;]*;/u, ''))
  db.prepare('DELETE FROM schema_migrations WHERE version >= 45').run()
  db.pragma('foreign_keys=ON')
  assert.equal(db.prepare<[], { version: number }>('SELECT max(version) AS version FROM schema_migrations').get()?.version, 44)
  assert.equal(
    (db.pragma('table_info(job_case_sources)') as Array<{ name: string }>).some((column) => column.name === 'intake_fingerprint'),
    false
  )
  assert.equal(
    (db.pragma('table_info(candidate_interview_sessions)') as Array<{ name: string }>).some(
      (column) => column.name === 'business_followup_id'
    ),
    false
  )
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0)
  db.close()
  repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  assert.equal(currentSchemaVersion, 68)
  assert.equal(repository.getSchemaVersion(), currentSchemaVersion)
  assert.equal(repository.getPersonnelWorkspace().states.length, 0)
  assert.equal(repository.getPersonnelWorkspace().templates.length, 2)
  assert.equal(repository.listActiveJobCases().length, 1, 'v44 job cases survive the upgrade')
  assert.equal(repository.getJobCaseReview(draft.reviewId)!.lifecycle, 'active')
  assert.equal(repository.getJobCaseReview(followDraft.reviewId)!.lifecycle, 'archived')
  repository.close()
  const upgraded = openRaw(databasePath)
  const upgradedShape = describeSchemaShape(upgraded)
  const missingFingerprints = upgraded
    .prepare<[], { count: number }>('SELECT count(*) AS count FROM job_case_sources WHERE intake_fingerprint IS NULL')
    .get()!.count
  const upgradeViolations = (upgraded.pragma('foreign_key_check') as unknown[]).length
  upgraded.close()
  assert.equal(missingFingerprints, 0, 'v51 backfills intake fingerprints for existing case sources')
  assert.equal(upgradeViolations, 0)
  const freshPath = join(temporaryDirectory, 'fresh.db')
  new EncryptedApplicationRepository({ path: freshPath, databaseKey, mappingKey }).close()
  const fresh = openRaw(freshPath)
  const freshShape = describeSchemaShape(fresh)
  fresh.close()
  // Reopening must not change the schema: v1-v8 run once, so the table v33 retired stays retired.
  new EncryptedApplicationRepository({ path: freshPath, databaseKey, mappingKey }).close()
  const reopened = openRaw(freshPath)
  assert.deepEqual(describeSchemaShape(reopened), freshShape, 'reopening a current install leaves its schema unchanged')
  assert.equal(
    (reopened.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'candidate_lifecycle'").get() as { count: number }).count,
    0,
    'the retired candidate_lifecycle table is not re-created'
  )
  reopened.close()
  assert.deepEqual(
    {
      onlyUpgraded: upgradedShape.filter((item) => !freshShape.includes(item)),
      onlyFresh: freshShape.filter((item) => !upgradedShape.includes(item))
    },
    { onlyUpgraded: [], onlyFresh: [] },
    'an upgraded v44 database must match a fresh install'
  )
  repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  console.log(
    JSON.stringify({
      status: 'passed',
      schema: currentSchemaVersion,
      verified: [
        'manual followup concurrency, restart, backup revision and deletion',
        'targeted introduction case version guard',
        'promotion immediately after import',
        'cases find imported personnel',
        'no fabricated HR review',
        'existing imported personnel backfill',
        'draft personnel status with revision guard',
        'assigned state survives restart',
        'draft case invalidation survives restart and confirmation',
        'case restoration',
        'stale payload rejection without reapproval',
        'pause exclusion',
        'PII and recipient rejection',
        'template concurrency',
        'copy metadata',
        'reopen',
        'deletion cascade',
        'v44 upgrade replays v45-v60 and matches a fresh install',
        'feed unread revisions',
        'deferred work persistence',
        'stale acknowledgements rejected'
      ]
    })
  )
} finally {
  repository.close()
  await rm(temporaryDirectory, { recursive: true, force: true })
}
