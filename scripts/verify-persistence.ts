import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { createWorkTaskPreview, materializeWorkTask, recordCandidateMatchExecution } from '@application'
import { EncryptedApplicationRepository } from '@persistence'
import { createGmailJobCaseSource, createRedactedEmlJobCaseSource, createRedactedManualJobCaseSource, extractJobCaseDraft } from '@job-cases'
import { redactTextForCloud } from '@privacy'
import { evaluateSesCandidateBenchmark, extractCandidateDraft, searchConfirmedCandidateProfiles } from '@resume'
import type { DocumentIR } from '@parsers'
import type { ResumeAnalysisSummary, SesCandidateBenchmark } from '@shared'

const taskSentinel = 'PERSISTENCE_SENTINEL_20260717 JavaとAWS候補者を検索したい'
const mappingSentinel = '山田検証用'
const manualCaseNameSentinel = '佐藤秘密担当'
const manualCasePhoneSentinel = '080-8765-4321'
const emlCaseNameSentinel = '鈴木機密担当'
const emlCasePhoneSentinel = '070-2468-1357'
const operatorNameSentinel = '佐藤監査担当'
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ses-agent-persistence-'))
const databasePath = join(temporaryDirectory, 'verification.db')
const databaseKey = randomBytes(32)
const mappingKey = randomBytes(32)
const documentId = '559dcb5d-dcf0-4c11-a12d-698cfef220e6'

try {
  const repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  assert.equal(repository.getLocalOperatorProfile(), null)
  assert.equal(repository.getLocalApplicationPreferences(), null)
  let operatorProfile = repository.saveLocalOperatorProfile({
    displayName: operatorNameSentinel,
    roleLabel: 'SES営業担当',
    expectedRevision: null
  }, new Date('2026-07-17T00:00:00.000Z'))
  const stableOperatorId = operatorProfile.operatorId
  assert.equal(operatorProfile.revision, 1)
  assert.equal(operatorProfile.cloudEligible, false)
  assert.throws(() => repository.saveLocalOperatorProfile({
    displayName: '古い更新', roleLabel: '営業担当', expectedRevision: null
  }), /更新されました/, 'stale operator profile revision was accepted')
  operatorProfile = repository.saveLocalOperatorProfile({
    displayName: operatorNameSentinel,
    roleLabel: '採用・SES営業',
    expectedRevision: operatorProfile.revision
  }, new Date('2026-07-17T00:00:00.500Z'))
  assert.equal(operatorProfile.operatorId, stableOperatorId)
  assert.equal(operatorProfile.revision, 2)
  let applicationPreferences = repository.saveLocalApplicationPreferences({
    locale: 'zh-CN', expectedRevision: null
  }, new Date('2026-07-17T00:00:00.750Z'))
  assert.equal(applicationPreferences.locale, 'zh-CN')
  assert.equal(applicationPreferences.revision, 1)
  assert.equal(applicationPreferences.cloudEligible, false)
  assert.throws(() => repository.saveLocalApplicationPreferences({
    locale: 'ja-JP', expectedRevision: null
  }), /更新されました/, 'stale application preferences revision was accepted')
  applicationPreferences = repository.saveLocalApplicationPreferences({
    locale: 'ja-JP', expectedRevision: applicationPreferences.revision
  }, new Date('2026-07-17T00:00:00.900Z'))
  assert.equal(applicationPreferences.revision, 2)
  const task = recordCandidateMatchExecution(
    materializeWorkTask(
      createWorkTaskPreview(taskSentinel),
      'verification-task-001',
      '2026-07-17T00:00:00.000Z'
    ),
    true,
    4,
    new Date('2026-07-17T00:00:01.000Z'),
    { objectId: 'match-run-verification', contentHash: 'f'.repeat(64) }
  )
  repository.saveWorkTask(task)
  const proposalTask = materializeWorkTask(
    createWorkTaskPreview('確認済み案件と候補者から提案メール下書きを準備したい'),
    'proposal-verification-task',
    '2026-07-17T00:00:00.000Z'
  )
  repository.saveWorkTask(proposalTask)

  const candidateJobInput = {
    type: 'candidate-match' as const,
    workTaskId: task.id,
    taskStepId: task.steps[1]!.id,
    idempotencyKey: '1'.repeat(64),
    requestFingerprint: '2'.repeat(64),
    payloadRef: `work-task:${task.id}:candidate-match`,
    replayPolicy: 'safe-local' as const,
    maxAttempts: 3
  }
  const queuedCandidateJob = repository.enqueueProcessingJob(candidateJobInput, new Date('2026-07-17T00:00:02.000Z'))
  assert.deepEqual(repository.getProcessingJobDispatchReference(queuedCandidateJob.id), {
    requestFingerprint: candidateJobInput.requestFingerprint,
    payloadRef: candidateJobInput.payloadRef
  }, 'processing job dispatch reference was not recovered')
  assert.equal(repository.enqueueProcessingJob(candidateJobInput).id, queuedCandidateJob.id, 'processing job idempotency did not reuse the existing job')
  const candidateLease = repository.acquireProcessingJob(queuedCandidateJob.id, 60_000, new Date('2026-07-17T00:00:03.000Z'))
  assert.ok(candidateLease, 'queued processing job could not be leased')
  assert.equal(candidateLease.job.attemptCount, 1)
  assert.equal(repository.updateProcessingJobProgress(candidateLease.job.id, candidateLease.leaseToken, 70).progress, 70)
  const candidateCompletion = repository.completeProcessingJob(
    candidateLease.job.id,
    candidateLease.leaseToken,
    { version: 'candidate-match-job-result-v1', runId: 'verification-run' },
    new Date('2026-07-17T00:00:04.000Z')
  )
  assert.equal(candidateCompletion.accepted, true)
  assert.equal(candidateCompletion.job.status, 'succeeded')
  assert.deepEqual(repository.getProcessingJobResult(candidateCompletion.job.id), {
    version: 'candidate-match-job-result-v1', runId: 'verification-run'
  })

  const retryJob = repository.enqueueProcessingJob({
    ...candidateJobInput,
    idempotencyKey: '3'.repeat(64),
    requestFingerprint: '4'.repeat(64)
  }, new Date('2026-07-17T00:00:05.000Z'))
  const retryLease = repository.acquireProcessingJob(retryJob.id, 60_000, new Date('2026-07-17T00:00:06.000Z'))
  assert.ok(retryLease)
  const retryWait = repository.failProcessingJob(
    retryJob.id,
    retryLease.leaseToken,
    'TRANSIENT_LOCAL_FAILURE',
    true,
    5_000,
    new Date('2026-07-17T00:00:07.000Z')
  )
  assert.equal(retryWait.status, 'retry_wait')
  assert.equal(repository.acquireProcessingJob(retryJob.id, 60_000, new Date('2026-07-17T00:00:08.000Z')), null)
  const secondLease = repository.acquireProcessingJob(retryJob.id, 60_000, new Date('2026-07-17T00:00:12.000Z'))
  assert.ok(secondLease)
  repository.requestProcessingJobCancellationForTask(task.id, new Date('2026-07-17T00:00:13.000Z'))
  const cancelledCompletion = repository.completeProcessingJob(
    retryJob.id,
    secondLease.leaseToken,
    { shouldNotPersist: true },
    new Date('2026-07-17T00:00:14.000Z')
  )
  assert.equal(cancelledCompletion.accepted, false)
  assert.equal(cancelledCompletion.job.status, 'cancelled')
  assert.equal(repository.getProcessingJobResult(retryJob.id), null)
  repository.retryProcessingJobsForTask(task.id, new Date('2026-07-17T00:00:15.000Z'))
  const abandonedLease = repository.acquireProcessingJob(retryJob.id, 1_000, new Date('2026-07-17T00:00:16.000Z'))
  assert.ok(abandonedLease)
  assert.deepEqual(repository.recoverExpiredProcessingJobs(new Date('2026-07-17T00:00:18.000Z')), {
    requeued: 1, reviewRequired: 0, cancelled: 0
  })

  const manualReviewJob = repository.enqueueProcessingJob({
    type: 'proposal-export',
    workTaskId: proposalTask.id,
    taskStepId: proposalTask.steps[3]!.id,
    idempotencyKey: '5'.repeat(64),
    requestFingerprint: '6'.repeat(64),
    payloadRef: `work-task:${proposalTask.id}:proposal-export`,
    replayPolicy: 'manual-review',
    maxAttempts: 1
  }, new Date('2026-07-17T00:00:19.000Z'))
  assert.ok(repository.acquireProcessingJob(manualReviewJob.id, 1_000, new Date('2026-07-17T00:00:20.000Z')))
  assert.deepEqual(repository.recoverExpiredProcessingJobs(new Date('2026-07-17T00:00:22.000Z')), {
    requeued: 0, reviewRequired: 1, cancelled: 0
  })

  const backoffJob = repository.enqueueProcessingJob({
    ...candidateJobInput,
    idempotencyKey: 'a'.repeat(64),
    requestFingerprint: 'b'.repeat(64)
  }, new Date('2026-07-17T00:00:23.000Z'))
  const firstBackoffLease = repository.acquireProcessingJob(backoffJob.id, 60_000, new Date('2026-07-17T00:00:24.000Z'))
  assert.ok(firstBackoffLease)
  const firstBackoff = repository.failProcessingJob(
    backoffJob.id,
    firstBackoffLease.leaseToken,
    'TRANSIENT_LOCAL_FAILURE',
    true,
    null,
    new Date('2026-07-17T00:00:25.000Z')
  )
  assert.equal(firstBackoff.nextRetryAt, '2026-07-17T00:00:30.000Z')
  const secondBackoffLease = repository.acquireProcessingJob(backoffJob.id, 60_000, new Date('2026-07-17T00:00:30.000Z'))
  assert.ok(secondBackoffLease)
  const secondBackoff = repository.failProcessingJob(
    backoffJob.id,
    secondBackoffLease.leaseToken,
    'TRANSIENT_LOCAL_FAILURE',
    true,
    null,
    new Date('2026-07-17T00:00:31.000Z')
  )
  assert.equal(secondBackoff.nextRetryAt, '2026-07-17T00:00:41.000Z')

  const redaction = redactTextForCloud(`${mappingSentinel} / 090-1234-5678`, {
    sourceVersion: 'verification-source:v1',
    knownPersonNames: [mappingSentinel],
    personNameReviewCompleted: true,
    sessionId: 'b0d9223d-fcab-49d6-bc1c-4d0c7dcd1318',
    now: new Date('2026-07-17T00:00:00.000Z')
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
  const reviewBeforeConfirmation = repository.getCandidateReview(documentId)
  assert.equal(reviewBeforeConfirmation?.status, 'awaiting-review')
  assert.equal(reviewBeforeConfirmation?.localIdentity?.displayName, mappingSentinel)
  assert.equal(reviewBeforeConfirmation?.localIdentity?.storage, 'encrypted-local-only')
  assert.equal(reviewBeforeConfirmation?.localIdentity?.cloudEligible, false)
  const reviewSubmission = {
    documentId,
    reviewRevision: reviewBeforeConfirmation?.reviewRevision ?? 0,
    piiReviewed: false,
    fields: extraction.fields.map((field) => ({
      key: field.key,
      value: field.key === 'skills' ? 'Java, AWS, Spring Boot' : field.value,
      confirmed: true as const,
      ...(field.key === 'skills' ? { changeReason: '原文を再確認' } : {})
    })),
    projectExperiences: extraction.projectExperiences.map((project) => ({
      draftId: project.draftId,
      title: project.title,
      period: project.period,
      role: project.role,
      technologies: project.technologies,
      summary: project.summary,
      confirmed: true as const
    }))
  }
  assert.throws(
    () => repository.confirmCandidateReview({
      ...reviewSubmission,
      fields: reviewSubmission.fields.map((field) => field.key === 'work_authorization'
        ? { ...field, value: '日本国籍', changeReason: '検証用変更' }
        : field)
    }, 'verification-user', '検証担当者'),
    /compliance category/,
    'nationality was accepted as a candidate work-authorization value'
  )
  const confirmedReview = repository.confirmCandidateReview(
    {
      ...reviewSubmission,
      projectExperiences: reviewSubmission.projectExperiences.map((project) => ({ ...project, title: '決済基盤クラウド刷新' }))
    },
    'verification-user',
    '検証担当者',
    new Date('2026-07-17T00:02:00.000Z')
  )
  assert.equal(confirmedReview.status, 'completed')
  assert.equal(confirmedReview.profile?.status, 'current')
  assert.equal(repository.listEligibleTalentProfiles().length, 0, 'confirmed profile entered matching before recruiting approval')
  assert.equal(confirmedReview.profile?.containsDirectIdentifiers, false)
  assert.equal(confirmedReview.piiReviewed, false, 'local candidate admission unexpectedly required a cloud privacy review')
  assert.equal(confirmedReview.localIdentity?.displayName, mappingSentinel)
  assert.equal(confirmedReview.projectExperiences.length, 1)
  assert.equal(confirmedReview.projectExperiences[0]?.title, '決済基盤クラウド刷新')
  assert.equal(confirmedReview.fields.find((field) => field.key === 'skills')?.changeReason, '原文を再確認')

  const rejectedDocumentId = '7a62ee36-25e5-4d44-8b57-d19c33c57d5b'
  repository.saveStagedFile({
    token: rejectedDocumentId,
    name: 'rejected-candidate.pdf',
    format: 'pdf',
    size: 2048,
    sha256: 'b'.repeat(64),
    encryptedPath: join(temporaryDirectory, 'rejected-candidate.vault'),
    privacyStatus: 'awaiting-local-scan',
    createdAt: '2026-07-17T00:01:10.000Z'
  })
  const rejectedDocument: DocumentIR = {
    ...document,
    documentId: rejectedDocumentId,
    source: { ...document.source, name: 'rejected-candidate.pdf', sha256: 'b'.repeat(64) }
  }
  const rejectedExtraction = extractCandidateDraft(rejectedDocument, new Date('2026-07-17T00:01:11.000Z'))
  const rejectedRedaction = redactTextForCloud('採用見送り候補者', {
    sourceVersion: 'rejected-verification-source:v1',
    knownPersonNames: ['採用見送り候補者'],
    personNameReviewCompleted: true,
    sessionId: '8da20bf6-8b1b-4bc7-9e5f-7090d62d0ff7',
    now: new Date('2026-07-17T00:01:10.500Z')
  })
  repository.saveRedactionSession(rejectedRedaction.session, rejectedRedaction.mappings)
  repository.saveParsedDocument(rejectedDocument, {
    ...summary,
    fileToken: rejectedDocumentId,
    fileName: 'rejected-candidate.pdf',
    analyzedAt: '2026-07-17T00:01:11.000Z'
  }, rejectedRedaction.session.id, rejectedExtraction)
  const rejectedReview = repository.getCandidateReview(rejectedDocumentId)
  assert.ok(rejectedReview)
  assert.throws(() => repository.saveCandidateInterviewSchedule({
    sourceDocumentId: rejectedDocumentId,
    scheduledAt: '2026-07-18T02:00:00.000Z',
    durationMinutes: 30,
    meetingMethod: 'phone',
    interviewer: '検証担当者'
  }, '検証担当者', new Date('2026-07-17T00:02:00.050Z')), /confirm the candidate profile/iu,
  'recruiting interview was scheduled before candidate profile confirmation')
  repository.confirmCandidateReview({
    documentId: rejectedDocumentId,
    reviewRevision: rejectedReview.reviewRevision,
    piiReviewed: false,
    fields: rejectedExtraction.fields.map((field) => ({ key: field.key, value: field.value, confirmed: true as const })),
    projectExperiences: rejectedExtraction.projectExperiences.map((project) => ({
      draftId: project.draftId,
      title: project.title,
      period: project.period,
      role: project.role,
      technologies: project.technologies,
      summary: project.summary,
      confirmed: true as const
    }))
  }, 'verification-user', '検証担当者', new Date('2026-07-17T00:02:00.100Z'))
  const rejectedInterview = repository.saveCandidateInterviewSchedule({
    sourceDocumentId: rejectedDocumentId,
    scheduledAt: '2026-07-18T02:00:00.000Z',
    durationMinutes: 30,
    meetingMethod: 'phone',
    interviewer: '検証担当者'
  }, '検証担当者', new Date('2026-07-17T00:02:00.200Z'))
  repository.saveCandidateInterviewPreparation({
    interviewId: rejectedInterview.id,
    questions: [{ id: 'rejection-check', text: '採用基準を確認します。', source: 'standard', sourceLabel: '採用基準', selected: true }]
  }, '検証担当者', new Date('2026-07-17T00:02:00.300Z'))
  repository.saveCandidateInterviewNotes({
    interviewId: rejectedInterview.id,
    sourceDocumentId: rejectedDocumentId,
    interviewNotes: '採用基準との不一致を確認。',
    stage: 'awaiting-decision'
  }, '検証担当者', new Date('2026-07-17T00:02:00.400Z'))
  repository.recordCandidateInterviewDecision({
    interviewId: rejectedInterview.id,
    sourceDocumentId: rejectedDocumentId,
    decision: 'failed',
    decisionReason: '今回の採用基準を満たさない。'
  }, '検証担当者', new Date('2026-07-17T00:02:00.500Z'))
  const retainedRejectedCandidate = repository.getCandidateReview(rejectedDocumentId)
  assert.equal(retainedRejectedCandidate?.recruitingStatus, 'rejected', 'failed recruiting decision did not enter candidate history')
  assert.equal(retainedRejectedCandidate?.talentPoolStatus, 'none', 'failed recruiting decision granted talent-pool eligibility')
  assert.equal(retainedRejectedCandidate?.profile?.status, 'current', 'failed recruiting decision discarded the candidate profile')
  assert.equal(repository.listEligibleTalentProfiles().length, 0, 'rejected candidate entered matching')

  assert.throws(
    () => repository.confirmCandidateReview(reviewSubmission, 'verification-user', '検証担当者'),
    /already completed/,
    'the same review revision was confirmed twice'
  )
  const initialCandidateVersion = repository.getCandidateProfileHistory(documentId)[0]
  assert.ok(initialCandidateVersion)
  const updatedCandidateProfile = repository.updateCandidateProfile({
    sourceDocumentId: documentId,
    expectedVersion: initialCandidateVersion.version,
    identity: {
      displayName: '山田 更新後',
      gender: '女性',
      birthDate: '1990年4月',
      nationality: '日本',
      phone: '080-2222-3333',
      email: 'candidate@example.jp',
      address: '東京都新宿区1-2-3',
      education: '東京工科大学',
      major: '情報工学',
      graduationDate: '2013年3月',
      degree: '学士'
    },
    fields: initialCandidateVersion.fields.map((field) => ({
      key: field.key,
      value: field.key === 'skills' ? 'Java, AWS, Spring Boot, PostgreSQL' : field.value
    })),
    projectExperiences: initialCandidateVersion.projectExperiences.map((project) => ({
      id: project.id,
      title: project.title,
      period: project.period,
      role: project.role,
      technologies: project.technologies,
      summary: `${project.summary}。性能改善も担当`
    }))
  }, 'verification-user', '検証担当者', new Date('2026-07-17T00:02:10.000Z'))
  assert.equal(updatedCandidateProfile.profileVersion, 2)
  assert.equal(repository.getCandidateLocalIdentity(documentId).displayName, '山田 更新後')
  assert.equal(repository.getCandidateLocalIdentity(documentId).phone, '080-2222-3333')
  assert.equal(repository.getCandidateLocalIdentity(documentId).email, 'candidate@example.jp')
  assert.equal(repository.getCandidateLocalIdentity(documentId).address, '東京都新宿区1-2-3')
  assert.equal(repository.getCandidateLocalIdentity(documentId).gender, '女性')
  assert.equal(repository.getCandidateLocalIdentity(documentId).birthDate, '1990年4月')
  assert.equal(repository.getCandidateLocalIdentity(documentId).nationality, '日本')
  assert.equal(repository.getCandidateLocalIdentity(documentId).education, '東京工科大学')
  assert.equal(repository.getCandidateLocalIdentity(documentId).major, '情報工学')
  assert.equal(repository.getCandidateLocalIdentity(documentId).graduationDate, '2013年3月')
  assert.equal(repository.getCandidateLocalIdentity(documentId).degree, '学士')
  assert.equal(repository.getCandidateProfileHistory(documentId).length, 2)
  assert.equal(repository.getCandidateReview(documentId)?.fields.find((field) => field.key === 'skills')?.value, 'Java, AWS, Spring Boot, PostgreSQL')
  assert.throws(
    () => repository.updateCandidateProfile({
      sourceDocumentId: documentId,
      expectedVersion: 1,
      identity: {
        displayName: null,
        gender: null,
        birthDate: null,
        nationality: null,
        phone: null,
        email: null,
        address: null,
        education: null,
        major: null,
        graduationDate: null,
        degree: null
      },
      fields: initialCandidateVersion.fields.map((field) => ({ key: field.key, value: field.value })),
      projectExperiences: initialCandidateVersion.projectExperiences
    }, 'verification-user', '検証担当者'),
    /更新されました/,
    'stale candidate profile edits were accepted'
  )
  const gmailFingerprint = 'e'.repeat(64)
  const gmailRedaction = redactTextForCloud('鈴木担当 / 070-1111-2222', {
    sourceVersion: 'verification-gmail:v1',
    knownPersonNames: ['鈴木担当'],
    personNameReviewCompleted: true,
    sessionId: 'f1d93612-1783-4202-a756-d50683fb46bb',
    now: new Date('2026-07-17T00:02:00.000Z')
  })
  repository.saveRedactionSession(gmailRedaction.session, gmailRedaction.mappings)
  assert.equal(repository.saveGmailMessage({
    accountEmail: 'hr@example.co.jp',
    gmailMessageId: 'gmail_msg_001',
    threadId: 'gmail_thread_001',
    historyId: '120',
    internalDate: '2026-07-17T00:02:00.000Z',
    labelIds: ['INBOX', 'Label_SES'],
    rfcMessageId: 'f'.repeat(64),
    fromDomain: 'partner.example.jp',
    redactedSubject: 'Java案件 <PERSON_NAME_001>',
    redactedBody: '必須スキル：Java / AWS\n単価：80万円/月\n連絡先 <PHONE_001>',
    redactionSessionId: gmailRedaction.session.id,
    classification: 'job-case',
    businessFingerprint: gmailFingerprint,
    duplicateOfMessageId: null,
    warningCodes: ['coverage:person_name_review_required'],
    attachmentCount: 0,
    importedAt: '2026-07-17T00:02:00.000Z'
  }), true)
  assert.equal(repository.saveGmailMessage({
    accountEmail: 'hr@example.co.jp',
    gmailMessageId: 'gmail_msg_001',
    threadId: 'gmail_thread_001',
    historyId: '120',
    internalDate: '2026-07-17T00:02:00.000Z',
    labelIds: ['INBOX', 'Label_SES'],
    rfcMessageId: 'f'.repeat(64),
    fromDomain: 'partner.example.jp',
    redactedSubject: 'Java案件 <PERSON_NAME_001>',
    redactedBody: '必須スキル：Java / AWS\n単価：80万円/月\n連絡先 <PHONE_001>',
    redactionSessionId: gmailRedaction.session.id,
    classification: 'job-case',
    businessFingerprint: gmailFingerprint,
    duplicateOfMessageId: null,
    warningCodes: [],
    attachmentCount: 0,
    importedAt: '2026-07-17T00:02:00.000Z'
  }), false)
  const pendingCaseMessages = repository.listGmailMessagesPendingJobCaseDrafts('hr@example.co.jp')
  assert.equal(pendingCaseMessages.length, 1)
  const pendingCaseMessage = pendingCaseMessages[0]
  assert.ok(pendingCaseMessage)
  const jobCaseReviewId = 'ee6b5a0f-ecc2-4f6c-8f71-5f6e89f0fd09'
  const gmailJobCaseSource = repository.ensureGmailJobCaseSource(createGmailJobCaseSource({
    accountEmail: pendingCaseMessage.accountEmail,
    gmailMessageId: pendingCaseMessage.gmailMessageId,
    threadId: pendingCaseMessage.threadId,
    fromDomain: pendingCaseMessage.fromDomain,
    messageDate: pendingCaseMessage.internalDate,
    redactedSubject: pendingCaseMessage.redactedSubject,
    redactedBody: pendingCaseMessage.redactedBody,
    redactionSessionId: pendingCaseMessage.redactionSessionId,
    warningCodes: pendingCaseMessage.warningCodes,
    createdAt: pendingCaseMessage.importedAt
  }, '3cfbcd8b-d812-4d5a-92be-6250fc81f99e'))
  const jobCaseDraft = extractJobCaseDraft(gmailJobCaseSource, jobCaseReviewId, new Date('2026-07-17T00:02:30.000Z'))
  assert.equal(repository.saveJobCaseDraft(jobCaseDraft), true)
  assert.equal(repository.saveJobCaseDraft(jobCaseDraft), false)
  const jobCaseReview = repository.getJobCaseReview(jobCaseReviewId)
  assert.equal(jobCaseReview?.status, 'awaiting-review')
  const jobCaseSubmission = {
    reviewId: jobCaseReviewId,
    reviewRevision: jobCaseReview?.reviewRevision ?? 0,
    privacyReviewed: true as const,
    fields: jobCaseDraft.fields.map((field) => ({
      key: field.key,
      value: field.value,
      confirmed: true as const
    }))
  }
  assert.throws(
    () => repository.confirmJobCaseReview({
      ...jobCaseSubmission,
      fields: jobCaseSubmission.fields.map((field) => field.key === 'title'
        ? { ...field, value: 'Java案件 090-1234-5678', changeReason: '検証用変更' }
        : field)
    }, 'verification-user', '検証担当者'),
    /直接識別子/,
    'a direct identifier was accepted into a job case field'
  )
  assert.throws(
    () => repository.confirmJobCaseReview({
      ...jobCaseSubmission,
      fields: jobCaseSubmission.fields.map((field) => field.key === 'work_authorization'
        ? { ...field, value: '外国籍不可', changeReason: '検証用変更' }
        : field)
    }, 'verification-user', '検証担当者'),
    /国籍条件/,
    'a nationality restriction was accepted into a job case'
  )
  const confirmedJobCase = repository.confirmJobCaseReview(
    jobCaseSubmission,
    'verification-user',
    '検証担当者',
    new Date('2026-07-17T00:02:45.000Z')
  )
  assert.equal(confirmedJobCase.status, 'completed')
  assert.equal(confirmedJobCase.jobCase?.containsDirectIdentifiers, false)
  const manualSource = createRedactedManualJobCaseSource({
    subject: `${manualCaseNameSentinel}様 Python案件`,
    body: `担当：${manualCaseNameSentinel}\n電話：${manualCasePhoneSentinel}\n必須スキル：Python / AWS\n単価：90万円/月`
  }, '21053d42-f2de-4e20-a479-a95d7c70ec4b', [manualCaseNameSentinel], new Date('2026-07-17T00:02:50.000Z'))
  const manualDraft = extractJobCaseDraft(
    manualSource.source,
    'c13f1590-5723-4248-a8c7-1f8669a78b19',
    new Date('2026-07-17T00:02:50.000Z')
  )
  assert.equal(repository.saveRedactedJobCaseSourceAndDraft(
    manualSource.redaction.session,
    manualSource.redaction.mappings,
    manualSource.source,
    manualDraft
  ), true)
  const manualReview = repository.getJobCaseReview(manualDraft.reviewId)
  assert.equal(manualReview?.sourceType, 'manual')
  assert.equal(manualReview?.providerMessageId, null)
  assert.equal(manualReview?.redactedPreview.includes(manualCaseNameSentinel), false)
  assert.equal(manualReview?.redactedPreview.includes(manualCasePhoneSentinel), false)
  assert.equal(manualReview?.redactedPreview.includes('<PERSON_NAME_001>'), true)
  assert.equal(manualReview?.redactedPreview.includes('<PHONE_001>'), true)
  repository.confirmJobCaseReview({
    reviewId: manualDraft.reviewId,
    reviewRevision: manualReview?.reviewRevision ?? 0,
    privacyReviewed: true,
    fields: manualDraft.fields.map((field) => ({ key: field.key, value: field.value, confirmed: true as const }))
  }, 'verification-user', '検証担当者', new Date('2026-07-17T00:02:55.000Z'))
  const emlSource = createRedactedEmlJobCaseSource({
    version: 'parsed-eml-v1',
    file: { name: 'verification-case.eml', size: 2048, sha256: 'd'.repeat(64) },
    sourceMessageKey: `eml_${'e'.repeat(64)}`,
    threadKey: `emlt_${'f'.repeat(64)}`,
    subject: `${emlCaseNameSentinel}様 Go案件`,
    body: `担当：${emlCaseNameSentinel}\n電話：${emlCasePhoneSentinel}\n必須スキル：Go / AWS\n単価：95万円/月`,
    senderDisplayName: emlCaseNameSentinel,
    fromDomain: 'partner.example.jp',
    messageDate: '2026-07-17T00:02:56.000Z',
    attachmentCount: 1,
    classification: 'job-case',
    warningCodes: ['EML_SOURCE_LOCAL_PARSE', 'EML_ATTACHMENTS_IGNORED'],
    security: { externalContentLoaded: false, attachmentsPersisted: false, rawFileCloudEligible: false }
  }, 'db3ea2b5-675c-4423-8a56-2da2f56ff92f', [emlCaseNameSentinel], new Date('2026-07-17T00:02:56.000Z'))
  const emlDraft = extractJobCaseDraft(
    emlSource.source,
    'b7e31154-8d84-4d2a-a2cf-51370fc13d12',
    new Date('2026-07-17T00:02:56.000Z')
  )
  assert.equal(repository.saveRedactedJobCaseSourceAndDraft(
    emlSource.redaction.session,
    emlSource.redaction.mappings,
    emlSource.source,
    emlDraft
  ), true)
  assert.equal(repository.getEmlJobCaseReview(emlSource.source.providerMessageId ?? '')?.reviewId, emlDraft.reviewId)
  repository.saveGmailSyncSuccess('hr@example.co.jp', '1'.repeat(64), '120', {
    mode: 'baseline',
    discovered: 1,
    imported: 1,
    duplicates: 0,
    filtered: 0,
    failed: 0
  }, '2026-07-17T00:02:00.000Z')
  repository.checkpoint()
  repository.close()

  const rawDatabase = await readFile(databasePath)
  assert.equal(rawDatabase.includes(Buffer.from('SQLite format 3')), false, 'database retained a plaintext SQLite header')
  assert.equal(rawDatabase.includes(Buffer.from(taskSentinel)), false, 'task instruction leaked into the database file')
  assert.equal(rawDatabase.includes(Buffer.from(mappingSentinel)), false, 'PII mapping leaked into the database file')
  assert.equal(rawDatabase.includes(Buffer.from('candidate@example.jp')), false, 'edited candidate email leaked into the database file')
  assert.equal(rawDatabase.includes(Buffer.from('東京都新宿区1-2-3')), false, 'edited candidate address leaked into the database file')
  assert.equal(rawDatabase.includes(Buffer.from(manualCaseNameSentinel)), false, 'manual name leaked into the database file')
  assert.equal(rawDatabase.includes(Buffer.from(manualCasePhoneSentinel)), false, 'manual phone leaked into the database file')
  assert.equal(rawDatabase.includes(Buffer.from(emlCaseNameSentinel)), false, 'EML sender name leaked into the database file')
  assert.equal(rawDatabase.includes(Buffer.from(emlCasePhoneSentinel)), false, 'EML phone leaked into the database file')
  assert.equal(rawDatabase.includes(Buffer.from(operatorNameSentinel)), false, 'operator display name leaked into the database file')
  assert.equal((await stat(databasePath)).mode & 0o777, 0o600, 'database permissions are not owner-only')

  let reopened = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  assert.equal(reopened.listWorkTasks().some((item) => item.instruction === taskSentinel), true, 'task did not recover after reopening')
  const recoveredWorkTask = reopened.getWorkTask(task.id)
  assert.equal(recoveredWorkTask?.messages.length, 3, 'work task messages did not recover after reopening')
  assert.equal(recoveredWorkTask?.approvalGates[0]?.status, 'required', 'work task approval gate did not recover')
  assert.equal(recoveredWorkTask?.artifacts[0]?.contentHash, 'f'.repeat(64), 'work task artifact did not recover')
  assert.equal(recoveredWorkTask?.toolAudits.at(-1)?.cloudPayload, 'none', 'work task tool audit lost its cloud boundary')
  assert.equal(
    reopened.getLocalPiiMappings(redaction.session.id).find((mapping) => mapping.identifierType === 'person_name')?.originalValue,
    '山田 更新後',
    'PII mapping did not decrypt with the derived mapping key'
  )
  assert.equal(reopened.getSchemaVersion(), 38, 'schema v38 migration did not apply')
  const actionRun = reopened.createActionRun({
    toolName: 'proposal.export', workTaskId: task.id, origin: 'system', scopeId: 'selected-case',
    scopeFingerprint: 'a'.repeat(64), inputHash: 'b'.repeat(64), contentRevision: '1:b'.repeat(1),
    status: 'queued', idempotencyKey: 'action-runtime-persistence-verification'
  })
  assert.equal(reopened.createActionRun({
    toolName: 'proposal.export', workTaskId: task.id, origin: 'system', scopeId: 'selected-case',
    scopeFingerprint: 'a'.repeat(64), inputHash: 'b'.repeat(64), contentRevision: '1:b',
    status: 'queued', idempotencyKey: 'action-runtime-persistence-verification'
  }).id, actionRun.id, 'same action invocation did not reuse its idempotency key')
  assert.throws(() => reopened.createActionRun({
    toolName: 'proposal.export', workTaskId: task.id, origin: 'system', scopeId: 'selected-case',
    scopeFingerprint: 'a'.repeat(64), inputHash: 'c'.repeat(64), contentRevision: '1:b',
    status: 'queued', idempotencyKey: 'action-runtime-persistence-verification'
  }), /collides/u, 'different action invocation aliased an idempotency key')
  const approval = reopened.requestActionApproval({
    actionRunId: actionRun.id,
    reason: '外部副作用を伴うため確認が必要です。',
    safeSummary: '承認済み提案をネイティブ保存確認へ進めます。',
    expiresAt: '2099-01-01T00:00:00.000Z'
  })
  assert.equal(reopened.requestActionApproval({
    actionRunId: actionRun.id,
    reason: '外部副作用を伴うため確認が必要です。',
    safeSummary: '承認済み提案をネイティブ保存確認へ進めます。',
    expiresAt: '2099-01-01T00:00:00.000Z'
  }).id, approval.id, 'reused action run created a duplicate approval')
  assert.equal(reopened.listActionApprovals().some((item) => item.id === approval.id), true, 'pending action approval was not listed')
  const resolvedApproval = reopened.resolveActionApproval({ approvalId: approval.id, decision: 'deny' }, '検証担当者')
  assert.equal(resolvedApproval.status, 'denied', 'action approval did not resolve atomically')
  assert.equal(reopened.listActionApprovals().some((item) => item.id === approval.id), false, 'resolved action approval remained in inbox')
  const foregroundRun = reopened.createActionRun({
    toolName: 'proposal.export', workTaskId: task.id, origin: 'system', scopeId: 'selected-case',
    scopeFingerprint: 'd'.repeat(64), inputHash: 'e'.repeat(64), contentRevision: '2',
    status: 'queued', idempotencyKey: 'action-runtime-foreground-confirmation'
  })
  const foregroundApproval = reopened.requestActionApproval({
    actionRunId: foregroundRun.id, reason: '外部副作用を伴うため確認が必要です。',
    safeSummary: '保存先の選択を待っています。', expiresAt: '2099-01-01T00:00:00.000Z'
  })
  reopened.resolveActionApproval({ approvalId: foregroundApproval.id, decision: 'approve' }, '検証担当者')
  assert.equal(reopened.getActionRunStatus(foregroundRun.id), 'awaiting_foreground_confirmation', 'approval implied a silent export')
  const expiredRun = reopened.createActionRun({
    toolName: 'proposal.export', workTaskId: task.id, origin: 'system', scopeId: 'selected-case',
    scopeFingerprint: 'f'.repeat(64), inputHash: '0'.repeat(64), contentRevision: '3',
    status: 'queued', idempotencyKey: 'action-runtime-expiry'
  })
  reopened.requestActionApproval({
    actionRunId: expiredRun.id, reason: '外部副作用を伴うため確認が必要です。',
    safeSummary: '期限切れを検証します。', expiresAt: '2020-01-01T00:00:00.000Z'
  })
  reopened.listActionApprovals(new Date('2021-01-01T00:00:00.000Z'))
  assert.equal(reopened.getActionRunStatus(expiredRun.id), 'blocked', 'expired approval left an executable action run')
  assert.throws(() => reopened.saveCandidateInterviewNotes({
    interviewId: '99999999-9999-4999-8999-999999999999',
    sourceDocumentId: documentId,
    interviewNotes: '予約なしで面談記録を作成してはならない。'
  }, '検証担当者'), /not found/iu, 'interview notes bypassed scheduling and preparation')
  assert.throws(() => reopened.recordCandidateInterviewDecision({
    interviewId: '99999999-9999-4999-8999-999999999999',
    sourceDocumentId: documentId,
    decision: 'passed',
    decisionReason: '予約なしの結論'
  }, '検証担当者'), /not found/iu, 'interview decision bypassed the interview record')
  const scheduledInterview = reopened.saveCandidateInterviewSchedule({
    sourceDocumentId: documentId,
    scheduledAt: '2026-07-18T01:00:00.000Z',
    durationMinutes: 60,
    meetingMethod: 'zoom',
    meetingUrl: 'https://company.zoom.us/j/1234567890?pwd=example',
    interviewer: '検証担当者',
    contactNote: '端末内で候補者へ確認済み'
  }, '検証担当者', new Date('2026-07-17T00:02:20.000Z'))
  assert.equal(scheduledInterview.stage, 'scheduled')
  assert.equal(scheduledInterview.meetingUrl, 'https://company.zoom.us/j/1234567890?pwd=example')
  assert.equal(scheduledInterview.cloudEligible, false, 'interview schedule became cloud eligible')
  const candidateConversationContext = {
    assistant: 'candidate-profile' as const,
    candidateDocumentId: documentId,
    interviewId: null,
    interviewKind: null,
    roundNumber: null
  }
  const interviewConversationContext = {
    assistant: 'interview' as const,
    candidateDocumentId: documentId,
    interviewId: scheduledInterview.id,
    interviewKind: 'recruiting' as const,
    roundNumber: scheduledInterview.roundNumber
  }
  const candidateConversationId = '1f22cbd7-87e1-4f40-a947-1a73ba0f5931'
  const interviewConversationId = '38087bdc-a8c2-4918-8d1b-5636920bcf7b'
  const candidateConversation = reopened.saveAiConversation({
    conversationId: candidateConversationId,
    context: candidateConversationContext,
    messages: [
      { id: 'candidate-user-1', role: 'user', content: '主要能力は？', mode: 'local', createdAt: '2026-07-17T00:02:20.100Z' },
      { id: 'candidate-assistant-1', role: 'assistant', content: 'JavaとAWSです。', mode: 'local', references: [{ label: 'スキル', target: 'skills' }], createdAt: '2026-07-17T00:02:20.200Z' }
    ],
    expectedRevision: null
  }, new Date('2026-07-17T00:02:20.200Z'))
  const updatedCandidateConversation = reopened.saveAiConversation({
    conversationId: candidateConversation.id,
    context: candidateConversationContext,
    messages: [...candidateConversation.messages,
      { id: 'candidate-user-2', role: 'user', content: '案件適性は？', mode: 'local', createdAt: '2026-07-17T00:02:20.300Z' },
      { id: 'candidate-assistant-2', role: 'assistant', content: '金融案件との適性があります。', mode: 'local', createdAt: '2026-07-17T00:02:20.400Z' }
    ],
    expectedRevision: candidateConversation.revision
  }, new Date('2026-07-17T00:02:20.400Z'))
  assert.equal(updatedCandidateConversation.revision, 2)
  assert.throws(() => reopened.saveAiConversation({
    conversationId: candidateConversation.id,
    context: candidateConversationContext,
    messages: candidateConversation.messages,
    expectedRevision: candidateConversation.revision
  }), /更新されました/u, 'stale AI conversation revision was accepted')
  reopened.saveAiConversation({
    conversationId: interviewConversationId,
    context: interviewConversationContext,
    messages: [
      { id: 'interview-user-1', role: 'user', content: '次の質問は？', mode: 'local', createdAt: '2026-07-17T00:02:20.500Z' },
      { id: 'interview-assistant-1', role: 'assistant', content: '担当範囲を確認してください。', mode: 'local', action: 'questions', createdAt: '2026-07-17T00:02:20.600Z' }
    ],
    expectedRevision: null
  }, new Date('2026-07-17T00:02:20.600Z'))
  assert.equal(reopened.listAiConversations(candidateConversationContext).length, 1)
  assert.equal(reopened.listAiConversations(interviewConversationContext).length, 1)
  assert.deepEqual(reopened.deleteAiConversations([candidateConversationId]), [candidateConversationId])
  assert.equal(reopened.listAiConversations(candidateConversationContext).length, 0)
  assert.equal(reopened.listAiConversations(interviewConversationContext).length, 1, 'deleting profile conversation removed interview history')
  const preparedInterview = reopened.saveCandidateInterviewPreparation({
    interviewId: scheduledInterview.id,
    interviewGoal: '技術基礎と案件での役割を確認する。',
    questions: [{ id: 'standard-1', text: '担当案件と役割を教えてください。', source: 'standard', sourceLabel: '会社固定質問', selected: true }],
    unresolvedItems: ['顧客説明経験']
  }, '検証担当者', new Date('2026-07-17T00:02:20.500Z'))
  assert.equal(preparedInterview.stage, 'prepared', 'preparation did not advance the explicit prepared stage')
  assert.equal(preparedInterview.questionPlan.length, 1)
  const interviewNotes = reopened.saveCandidateInterviewNotes({
    interviewId: scheduledInterview.id,
    sourceDocumentId: documentId,
    interviewNotes: 'Java と AWS の設計経験を具体例で確認。',
    stage: 'awaiting-decision'
  }, '検証担当者', new Date('2026-07-17T00:02:21.000Z'))
  assert.equal(interviewNotes.stage, 'awaiting-decision')
  assert.throws(() => reopened.saveCandidateInterviewSchedule({
    interviewId: scheduledInterview.id,
    sourceDocumentId: documentId,
    scheduledAt: '2026-07-18T02:00:00.000Z',
    durationMinutes: 60,
    meetingMethod: 'zoom',
    meetingUrl: 'https://company.zoom.us/j/1234567890?pwd=changed',
    interviewer: '検証担当者'
  }, '検証担当者'), /schedule is locked/iu, 'IPC could change a schedule after the interview reached a decision state')
  assert.throws(() => reopened.saveCandidateInterviewPreparation({
    interviewId: scheduledInterview.id,
    questions: [{ id: 'late-edit', text: '結論待ちの質問変更', source: 'custom', sourceLabel: null, selected: true }]
  }, '検証担当者'), /only be edited before the interview starts/iu, 'IPC could edit questions after the interview started')
  assert.throws(() => reopened.saveCandidateInterviewNotes({
    interviewId: scheduledInterview.id,
    sourceDocumentId: documentId,
    interviewNotes: '結論待ちの追記',
    stage: 'awaiting-decision'
  }, '検証担当者'), /only be edited while the interview is in progress/iu, 'IPC could edit notes while a decision was pending')
  const interviewDecision = reopened.recordCandidateInterviewDecision({
    interviewId: scheduledInterview.id,
    sourceDocumentId: documentId,
    decision: 'next-round',
    decisionReason: '次回は日本語での顧客説明経験を確認する。'
  }, '検証担当者', new Date('2026-07-17T00:02:22.000Z'))
  assert.equal(interviewDecision.stage, 'on-hold')
  assert.equal(interviewDecision.decision, 'next-round')
  const followUpInterview = reopened.createCandidateInterviewRound({
    sourceDocumentId: documentId,
    parentInterviewId: interviewDecision.id
  }, '検証担当者', new Date('2026-07-17T00:02:23.000Z'))
  assert.equal(followUpInterview.roundNumber, 2)
  assert.equal(followUpInterview.parentInterviewId, interviewDecision.id)
  assert.deepEqual(followUpInterview.questionPlan.map((question) => ({ text: question.text, source: question.source, selected: question.selected })), [
    { text: '顧客説明経験', source: 'inherited', selected: false }
  ], 'follow-up copied already asked questions instead of only inheriting unresolved items')
  const googleMeetFollowUp = reopened.saveCandidateInterviewSchedule({
    interviewId: followUpInterview.id,
    sourceDocumentId: documentId,
    scheduledAt: '2026-07-19T01:00:00.000Z',
    durationMinutes: 45,
    meetingMethod: 'google-meet',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    interviewer: '検証担当者'
  }, '検証担当者', new Date('2026-07-17T00:02:23.500Z'))
  assert.equal(googleMeetFollowUp.meetingUrl, 'https://meet.google.com/abc-defg-hij', 'Google Meet URL was not retained')
  const phoneFollowUp = reopened.saveCandidateInterviewSchedule({
    interviewId: followUpInterview.id,
    sourceDocumentId: documentId,
    scheduledAt: '2026-07-19T02:00:00.000Z',
    durationMinutes: 30,
    meetingMethod: 'phone',
    interviewer: '検証担当者',
    meetingDetails: { phoneNumber: '090-0000-0000', phoneNote: '午後に発信' }
  }, '検証担当者', new Date('2026-07-17T00:02:23.800Z'))
  assert.equal(phoneFollowUp.meetingUrl, null, 'switching to telephone retained an unrelated meeting URL')
  assert.equal(phoneFollowUp.meetingDetails?.phoneNumber, '090-0000-0000')
  const preparedFollowUp = reopened.saveCandidateInterviewPreparation({
    interviewId: followUpInterview.id,
    questions: [{ id: 'standard-2', text: '顧客説明経験を教えてください。', source: 'standard', sourceLabel: '会社固定質問', selected: true }]
  }, '検証担当者')
  const followUpNotes = reopened.saveCandidateInterviewNotes({
    interviewId: preparedFollowUp.id,
    sourceDocumentId: documentId,
    interviewNotes: '採用面談を完了。',
    stage: 'awaiting-decision'
  }, '検証担当者')
  reopened.recordCandidateInterviewDecision({
    interviewId: followUpNotes.id,
    sourceDocumentId: documentId,
    decision: 'passed',
    decisionReason: '技術・顧客説明ともに採用基準を満たす。'
  }, '検証担当者')
  assert.equal(reopened.getCandidateReview(documentId)?.talentPoolStatus, 'eligible', 'recruiting pass did not admit candidate to talent pool')
  const clientInterview = reopened.saveCandidateInterviewSchedule({
    sourceDocumentId: documentId,
    kind: 'client',
    scheduledAt: '2026-07-20T01:00:00.000Z',
    durationMinutes: 30,
    meetingMethod: 'phone',
    interviewer: '営業担当者'
  }, '検証担当者')
  reopened.saveCandidateInterviewPreparation({
    interviewId: clientInterview.id,
    questions: [{ id: 'client-1', text: '案件経験を説明してください。', source: 'standard', sourceLabel: '顧客面談', selected: true }]
  }, '検証担当者')
  reopened.saveCandidateInterviewNotes({
    interviewId: clientInterview.id,
    sourceDocumentId: documentId,
    interviewNotes: '顧客面談記録。',
    stage: 'awaiting-decision'
  }, '検証担当者')
  reopened.recordCandidateInterviewDecision({
    interviewId: clientInterview.id,
    sourceDocumentId: documentId,
    decision: 'failed',
    decisionReason: '今回の案件条件とは合わない。'
  }, '検証担当者')
  assert.equal(reopened.listEligibleTalentProfiles().length, 1, 'client interview rejection removed talent-pool eligibility')
  assert.equal(reopened.listCandidateInterviews().filter((item) => item.sourceDocumentId === documentId).length, 3)
  assert.equal(reopened.listCandidateInterviews().find((item) => item.id === scheduledInterview.id)?.interviewNotes, 'Java と AWS の設計経験を具体例で確認。')
  assert.equal(reopened.getLocalOperatorProfile()?.displayName, operatorNameSentinel, 'local operator profile did not recover')
  assert.equal(reopened.getLocalOperatorProfile()?.operatorId, stableOperatorId, 'local operator ID changed after restart')
  assert.equal(reopened.getLocalOperatorProfile()?.revision, 2, 'local operator revision did not recover')
  assert.equal(reopened.getLocalApplicationPreferences()?.locale, 'ja-JP', 'application locale did not recover')
  assert.equal(reopened.getLocalApplicationPreferences()?.revision, 2, 'application locale revision did not recover')
  assert.equal(reopened.listProcessingJobs(task.id).length, 3, 'processing jobs did not recover after reopening')
  assert.equal(reopened.getProcessingJob(backoffJob.id)?.nextRetryAt, '2026-07-17T00:00:41.000Z')
  assert.equal(reopened.getProcessingJob(manualReviewJob.id)?.errorCode, 'INTERRUPTED_REVIEW_REQUIRED')
  assert.equal(reopened.getGoogleWorkspaceAdminConfiguration(), null)
  let googleConfiguration = reopened.saveGoogleWorkspaceAdminConfiguration({
    clientId: '1234567890-abcdefghijklmnop.apps.googleusercontent.com',
    workspaceDomain: 'Company.CO.JP',
    labelIds: ['INBOX', 'Label_SES'],
    query: '案件 OR 要員',
    lookbackDays: 30,
    maxMessagesPerRun: 200,
    expectedRevision: null,
    readonlyAcknowledged: true
  }, 'ローカル管理者', new Date('2026-07-17T00:02:44.000Z'))
  assert.equal(googleConfiguration.workspaceDomain, 'company.co.jp')
  assert.equal(googleConfiguration.revision, 1)
  assert.equal(googleConfiguration.source, 'local-admin')
  assert.throws(() => reopened.saveGoogleWorkspaceAdminConfiguration({
    clientId: googleConfiguration.clientId,
    workspaceDomain: googleConfiguration.workspaceDomain,
    labelIds: googleConfiguration.labelIds,
    query: googleConfiguration.query,
    lookbackDays: 60,
    maxMessagesPerRun: 200,
    expectedRevision: null,
    readonlyAcknowledged: true
  }, 'ローカル管理者'), /更新されました/, 'stale Google Workspace configuration revision was accepted')
  googleConfiguration = reopened.saveGoogleWorkspaceAdminConfiguration({
    clientId: googleConfiguration.clientId,
    workspaceDomain: googleConfiguration.workspaceDomain,
    labelIds: googleConfiguration.labelIds,
    query: googleConfiguration.query,
    lookbackDays: 60,
    maxMessagesPerRun: 200,
    expectedRevision: googleConfiguration.revision,
    readonlyAcknowledged: true
  }, 'ローカル管理者', new Date('2026-07-17T00:02:44.500Z'))
  assert.equal(googleConfiguration.revision, 2)
  assert.equal(googleConfiguration.lookbackDays, 60)
  const gmailRedactionEvidence = reopened.summarizeGmailRedactionEvidence('hr@example.co.jp')
  assert.equal(gmailRedactionEvidence.storedMessages, 1)
  assert.equal(
    gmailRedactionEvidence.passed + gmailRedactionEvidence.uncertain + gmailRedactionEvidence.blocked,
    gmailRedactionEvidence.storedMessages,
    'Gmail redaction evidence counts did not reconcile'
  )
  const googleAcceptanceReport = reopened.saveGoogleWorkspaceAcceptanceReport({
    version: 'google-workspace-online-acceptance-v1',
    id: '59d99a84-c5ea-4474-b08a-ddfd8f5eca73',
    checkedAt: '2026-07-17T00:02:44.750Z',
    overall: 'passed',
    configurationFingerprint: 'c'.repeat(64),
    credentialProtection: 'macos-keychain',
    mailboxMetadataAccessed: true,
    messageContentAccessedDuringCheck: false,
    cloudModelUsed: false,
    directIdentifierCloudSent: false,
    checks: [
      { id: 'live-profile', status: 'passed', label: 'Live profile', detail: 'Profile metadata only.' },
      { id: 'readonly-scope', status: 'passed', label: 'Readonly scope', detail: 'gmail.readonly only.' },
      { id: 'company-domain', status: 'passed', label: 'Company domain', detail: 'Domain verified without storing the address.' },
      { id: 'credential-protection', status: 'passed', label: 'Credential protection', detail: 'Protected by Keychain.' },
      { id: 'bounded-sync', status: 'passed', label: 'Bounded sync', detail: 'Configuration fingerprint matched.' },
      { id: 'successful-sync', status: 'passed', label: 'Successful sync', detail: 'One bounded record.' },
      { id: 'local-redaction', status: 'passed', label: 'Local redaction', detail: 'Evidence reconciled.' },
      { id: 'no-cloud-model', status: 'passed', label: 'No cloud model', detail: 'Cloud model unused.' },
      { id: 'no-send-path', status: 'passed', label: 'No send path', detail: 'No send API.' }
    ],
    evidence: {
      grantedScopeCount: 1,
      sync: { status: 'idle', lastSyncedAt: '2026-07-17T00:02:44.700Z', mode: 'baseline', discovered: 1, imported: 1, duplicates: 0, filtered: 0, failed: 0 },
      redaction: gmailRedactionEvidence
    }
  })
  assert.equal(reopened.getLatestGoogleWorkspaceAcceptanceReport()?.id, googleAcceptanceReport.id)
  assert.equal(reopened.getLatestGoogleWorkspaceAcceptanceReport('d'.repeat(64)), null)
  assert.equal(JSON.stringify(googleAcceptanceReport).includes('hr@example.co.jp'), false, 'acceptance report persisted an account address')
  assert.equal(reopened.getRecoveryState().reminder.reason, 'no-backup', 'managed data did not require its first backup')
  const cachedProfileId = reopened.getCandidateReview(documentId)?.profile?.id
  assert.ok(cachedProfileId, 'confirmed candidate profile was unavailable for embedding cache verification')
  const cachedProjectId = reopened.getCandidateProfileHistory(documentId)[0]?.projectExperiences[0]?.id
  assert.ok(cachedProjectId, 'confirmed project experience was unavailable for embedding cache verification')
  const originalEvaluationJobCaseId = confirmedJobCase.jobCase?.id
  assert.ok(originalEvaluationJobCaseId, 'confirmed job case was unavailable for evaluation authoring verification')
  let authoringDraft = reopened.createCandidateEvaluationDraft(
    { name: 'Tokyo SES Expert Pilot' },
    new Date('2026-07-17T00:02:45.100Z')
  )
  authoringDraft = reopened.saveCandidateEvaluationDraftCase({
    draftId: authoringDraft.id,
    expectedRevision: authoringDraft.revision,
    jobCaseId: originalEvaluationJobCaseId,
    relevantCandidateProfileIds: [cachedProfileId],
    expectedProjectEvidenceProfileIds: [cachedProfileId],
    poolReviewed: true
  }, 'verification-user', '検証担当者', new Date('2026-07-17T00:02:45.200Z'))
  assert.equal(authoringDraft.caseCount, 1)
  assert.equal(authoringDraft.readyCaseCount, 1)
  assert.equal(authoringDraft.cases[0]?.relevantCandidates[0]?.expectedProjectEvidence, true)
  assert.equal(authoringDraft.cases[0]?.query.includes('40日'), false, 'payment terms entered the evaluation query')
  assert.equal(authoringDraft.cases[0]?.query.includes('<PERSON_NAME'), false, 'redacted contact placeholder entered the evaluation query')
  assert.throws(() => reopened.saveCandidateEvaluationDraftCase({
    draftId: authoringDraft.id,
    expectedRevision: 1,
    jobCaseId: originalEvaluationJobCaseId,
    relevantCandidateProfileIds: [cachedProfileId],
    expectedProjectEvidenceProfileIds: [],
    poolReviewed: true
  }, 'verification-user', '検証担当者'), /更新されました/, 'stale evaluation draft revision was accepted')
  const authoredBenchmark = reopened.buildCandidateEvaluationBenchmark(
    authoringDraft.id,
    authoringDraft.revision,
    new Date('2026-07-17T00:02:45.300Z')
  )
  assert.equal(authoredBenchmark.cases.length, 1)
  assert.equal(authoredBenchmark.labeling.reviewerCount, 1)
  assert.equal(authoredBenchmark.privacy.directIdentifiersRemoved, true)
  assert.equal(authoredBenchmark.thresholds.minimumCases, 30)
  const persistedMatches = searchConfirmedCandidateProfiles(reopened.listEligibleTalentProfiles(), 'Java AWS', 20)
  const persistedMatchRun = reopened.saveCandidateMatchRun(
    task.id,
    'Java AWS',
    persistedMatches,
    new Date('2026-07-17T00:02:46.000Z')
  )
  assert.equal(persistedMatchRun.matches.length, 1, 'candidate match result was not persisted')
  assert.equal(persistedMatchRun.run.hardFilterPolicyVersion, 'tri-state-v3', 'hard-filter policy was not versioned on the match run')
  assert.equal(persistedMatchRun.run.evaluation.recallAt20, null, 'Recall@20 was claimed without a known relevant total')
  const repeatedMatchRun = reopened.saveCandidateMatchRun(
    task.id,
    'Java AWS',
    persistedMatches,
    new Date('2026-07-17T00:02:46.500Z')
  )
  assert.equal(repeatedMatchRun.run.id, persistedMatchRun.run.id, 'identical candidate match execution created a duplicate run')
  assert.ok(originalEvaluationJobCaseId)
  const boundMatchTask = materializeWorkTask(
    createWorkTaskPreview(
      '確認済み案件に合う候補者を根拠付きで比較したい',
      { id: 'selected-case', label: '選択した案件', detail: '現在の作業に明示的に紐づけた案件のみ' },
      [{ objectType: 'job-case', objectId: originalEvaluationJobCaseId, version: '1' }]
    ),
    'task-bound-match-verification',
    '2026-07-17T00:02:46.600Z'
  )
  reopened.saveWorkTask(boundMatchTask)
  const runtimeIdentity = {
    algorithmVersion: 'hard-filter-bm25-v1' as const,
    hardFilterPolicyVersion: 'tri-state-v3' as const,
    embeddingModelId: 'Xenova/multilingual-e5-small',
    embeddingModelRevision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    rerankerModelId: null,
    rerankerModelRevision: null
  }
  const boundRun = reopened.saveCandidateMatchRun(
    boundMatchTask.id,
    'Java AWS',
    persistedMatches,
    new Date('2026-07-17T00:02:46.650Z'),
    runtimeIdentity
  )
  assert.equal(boundRun.run.binding?.jobCaseId, originalEvaluationJobCaseId, 'match run did not bind the confirmed job case')
  assert.equal(boundRun.run.binding?.candidateProfileVersions.length, 1, 'match run did not bind candidate profile versions')
  const matchingHome = reopened.getMatchingHomeProjection(runtimeIdentity, new Date('2026-07-17T00:02:46.700Z'))
  assert.equal(matchingHome.state, 'current-results', 'current Match Run did not reach the Matching-first home')
  assert.equal(matchingHome.currentRun?.results.length, 1, 'Matching-first home did not load persisted evidence')
  const homeResult = matchingHome.currentRun?.results[0]
  assert.ok(homeResult)
  assert.equal(homeResult.businessPriority.ruleVersion, 'business-priority-v1')
  reopened.setBusinessPriorityOverride({
    matchResultId: homeResult.matchResultId,
    level: 'high',
    reason: '本日中の営業確認',
    expiresAt: '2026-07-18T00:00:00.000Z'
  }, '検証担当者', new Date('2026-07-17T00:02:46.710Z'))
  assert.equal(
    reopened.getMatchingHomeProjection(runtimeIdentity, new Date('2026-07-17T00:02:46.720Z')).currentRun?.results[0]?.businessPriority.effectiveLevel,
    'high',
    'reason-bound business-priority override was not applied'
  )
  const staleModelHome = reopened.getMatchingHomeProjection(
    { ...runtimeIdentity, embeddingModelRevision: 'changed-model-revision' },
    new Date('2026-07-17T00:02:46.730Z')
  )
  assert.equal(staleModelHome.state, 'ready-to-run', 'stale model continued to expose a current ranking')
  assert.equal(staleModelHome.currentRun, null, 'stale Match Run results were exposed on the home projection')
  const matchResult = persistedMatchRun.matches[0]
  assert.ok(matchResult)
  assert.throws(() => reopened.submitCandidateMatchFeedback({
    matchResultId: matchResult.matchResultId,
    matchResultHash: matchResult.matchResultHash,
    expectedRevision: 0,
    decision: 'suitable',
    reasonCode: 'rate_mismatch'
  }, '検証担当者'), /組み合わせ/, 'an unsuitable reason was accepted for a suitable decision')
  const savedFeedback = reopened.submitCandidateMatchFeedback({
    matchResultId: matchResult.matchResultId,
    matchResultHash: matchResult.matchResultHash,
    expectedRevision: 0,
    decision: 'suitable',
    reasonCode: 'strong_project_fit',
    note: '案件要件と確認済みプロジェクトが一致'
  }, '検証担当者', new Date('2026-07-17T00:02:46.750Z'))
  assert.equal(savedFeedback.feedback.revision, 1)
  assert.equal(savedFeedback.run.evaluation.coveragePercent, 100)
  assert.equal(savedFeedback.run.evaluation.judgedNdcgAt20, 1)
  assert.equal(savedFeedback.run.evaluation.recallAt20, null)
  assert.throws(() => reopened.submitCandidateMatchFeedback({
    matchResultId: matchResult.matchResultId,
    matchResultHash: matchResult.matchResultHash,
    expectedRevision: 0,
    decision: 'unsuitable',
    reasonCode: 'rate_mismatch'
  }, '検証担当者'), /changed/, 'stale match feedback revision was accepted')
  const benchmark: SesCandidateBenchmark = {
    version: 'ses-candidate-benchmark-v1',
    id: 'd5a8372a-f701-4862-8f5d-4278c116fe3c',
    name: 'Persistence SES Benchmark',
    createdAt: '2026-07-17T00:02:46.800Z',
    privacy: { directIdentifiersRemoved: true, rawResumeIncluded: false, rawMailIncluded: false },
    labeling: { method: 'ses-expert', reviewerCount: 2 },
    thresholds: { minimumCases: 30, recallAt20: 0.9, ndcgAt20: 0.75, projectEvidenceCoverageAt20: 0.8 },
    cases: Array.from({ length: 30 }, (_, index) => ({
      id: `persistence-case-${index + 1}`,
      query: 'Java AWS',
      relevantCandidateLabels: [`候補者 ${cachedProfileId.slice(0, 8).toLocaleUpperCase('en-US')}`],
      expectedProjectEvidenceLabels: []
    }))
  }
  const benchmarkReport = await evaluateSesCandidateBenchmark(
    benchmark,
    new Set([`候補者 ${cachedProfileId.slice(0, 8).toLocaleUpperCase('en-US')}`]),
    async (query, maxResults) => searchConfirmedCandidateProfiles(reopened.listEligibleTalentProfiles(), query, maxResults),
    { id: 'test/local-model', revision: 'v1' },
    new Date('2026-07-17T00:02:46.900Z')
  )
  assert.equal(benchmarkReport.status, 'passed')
  assert.equal(benchmarkReport.hardFilterPolicyVersion, 'tri-state-v3')
  const evaluationState = reopened.saveCandidateEvaluation(benchmark, benchmarkReport, new Date('2026-07-17T00:02:47.000Z'))
  assert.equal(evaluationState.dataset?.caseCount, 30)
  assert.equal(evaluationState.latestReport?.metrics.recallAt20, 1)
  assert.equal(JSON.stringify(evaluationState.latestReport).includes('Java AWS'), false, 'evaluation report persisted raw query text')
  const revisionBeforeDerivedCache = reopened.getLocalDataRevision().revision
  reopened.saveCandidateProfileEmbeddings([{
    profileId: cachedProfileId,
    modelId: 'Xenova/multilingual-e5-small',
    modelRevision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    contentHash: 'e'.repeat(64),
    vector: Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0)
  }], new Date('2026-07-17T00:02:47.000Z'))
  reopened.saveCandidateProjectEmbeddings([{
    profileId: cachedProfileId,
    projectId: cachedProjectId,
    modelId: 'Xenova/multilingual-e5-small',
    modelRevision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    contentHash: 'f'.repeat(64),
    vector: Array.from({ length: 384 }, (_, index) => index === 1 ? 1 : 0)
  }], new Date('2026-07-17T00:02:47.000Z'))
  assert.equal(reopened.listCandidateProfileEmbeddings(
    'Xenova/multilingual-e5-small',
    '761b726dd34fb83930e26aab4e9ac3899aa1fa78'
  )[0]?.vector.length, 384, 'candidate embedding cache did not round-trip')
  assert.equal(reopened.listCandidateProjectEmbeddings(
    'Xenova/multilingual-e5-small',
    '761b726dd34fb83930e26aab4e9ac3899aa1fa78'
  )[0]?.projectId, cachedProjectId, 'project embedding cache did not round-trip')
  assert.equal(
    reopened.getLocalDataRevision().revision,
    revisionBeforeDerivedCache,
    'derived embedding cache incorrectly triggered a business-data backup reminder'
  )
  const consistentSnapshotPath = join(temporaryDirectory, 'consistent-snapshot.db')
  const capturedSnapshot = await reopened.createConsistentSnapshot(consistentSnapshotPath)
  const snapshotBytes = await readFile(consistentSnapshotPath)
  assert.equal(snapshotBytes.includes(Buffer.from('SQLite format 3')), false, 'consistent snapshot was not encrypted')
  assert.equal((await stat(consistentSnapshotPath)).mode & 0o777, 0o600, 'snapshot permissions are not owner-only')
  const snapshotRepository = new EncryptedApplicationRepository({
    path: consistentSnapshotPath,
    databaseKey,
    mappingKey
  })
  assert.equal(snapshotRepository.listWorkTasks().some((item) => item.instruction === taskSentinel), true, 'consistent snapshot missed committed work')
  assert.equal(snapshotRepository.getWorkTask(task.id)?.messages.length, 3, 'consistent snapshot missed work task messages')
  assert.equal(snapshotRepository.getWorkTask(task.id)?.artifacts.length, 1, 'consistent snapshot missed work task artifacts')
  assert.equal(snapshotRepository.listProcessingJobs().length, 4, 'consistent snapshot missed processing jobs')
  assert.equal(snapshotRepository.getLocalDataRevision().revision, capturedSnapshot.dataRevision, 'snapshot revision marker drifted')
  assert.equal(snapshotRepository.listCandidateProfileEmbeddings(
    'Xenova/multilingual-e5-small',
    '761b726dd34fb83930e26aab4e9ac3899aa1fa78'
  ).length, 1, 'consistent snapshot missed the encrypted embedding cache')
  assert.equal(snapshotRepository.listCandidateProjectEmbeddings(
    'Xenova/multilingual-e5-small',
    '761b726dd34fb83930e26aab4e9ac3899aa1fa78'
  ).length, 1, 'consistent snapshot missed the encrypted project embedding cache')
  assert.equal(snapshotRepository.getCandidateMatchRunSummary(persistedMatchRun.run.id).evaluation.feedbackCount, 1, 'consistent snapshot missed candidate match feedback')
  assert.equal(snapshotRepository.getCandidateMatchRunSummary(persistedMatchRun.run.id).hardFilterPolicyVersion, 'tri-state-v3', 'snapshot lost hard-filter policy version')
  assert.equal(snapshotRepository.getCandidateEvaluationState().latestReport?.status, 'passed', 'consistent snapshot missed candidate evaluation report')
  assert.equal(snapshotRepository.getCandidateEvaluationDraft()?.caseCount, 1, 'consistent snapshot missed the encrypted evaluation authoring draft')
  assert.equal(snapshotRepository.getGoogleWorkspaceAdminConfiguration()?.revision, 2, 'consistent snapshot missed Google Workspace admin configuration')
  assert.equal(snapshotRepository.getLocalOperatorProfile()?.operatorId, stableOperatorId, 'consistent snapshot missed the local operator profile')
  assert.equal(snapshotRepository.getLocalOperatorProfile()?.displayName, operatorNameSentinel, 'snapshot changed the local operator display name')
  assert.equal(snapshotRepository.getLocalApplicationPreferences()?.locale, 'ja-JP', 'consistent snapshot missed application preferences')
  assert.equal(snapshotRepository.getLatestGoogleWorkspaceAcceptanceReport()?.id, googleAcceptanceReport.id, 'consistent snapshot missed Google Workspace acceptance evidence')
  const snapshotRevisionBeforeMutation = snapshotRepository.getLocalDataRevision().revision
  snapshotRepository.saveWorkTask(materializeWorkTask(
    createWorkTaskPreview('スナップショットのトリガーを検証する'),
    'snapshot-trigger-verification',
    '2026-07-17T00:02:48.000Z'
  ))
  assert.ok(
    snapshotRepository.getLocalDataRevision().revision > snapshotRevisionBeforeMutation,
    'consistent snapshot did not preserve data revision triggers'
  )
  snapshotRepository.close()
  const recoverySummary = {
    version: 'ses-recovery-v1' as const,
    backupId: '44794ba1-67d8-44b6-8b1c-293ef4885125',
    createdAt: '2026-07-17T00:02:49.000Z',
    sourcePlatform: 'darwin' as const,
    sourceArch: 'arm64',
    schemaVersion: 24,
    databaseBytes: snapshotBytes.length,
    vaultObjectCount: 1,
    vaultBytes: 1024,
    totalBytes: snapshotBytes.length + 1024,
    googleWorkspaceCredentialIncluded: false as const,
    cloudDataIncluded: false as const
  }
  reopened.recordRecoveryEvent('backup-created', recoverySummary, '7'.repeat(64), new Date('2026-07-17T00:02:49.000Z'))
  assert.equal(reopened.getRecoveryState().lastBackupAt, '2026-07-17T00:02:49.000Z')
  assert.equal(reopened.getRecoveryState().reminder.status, 'not-needed', 'fresh backup did not clear the reminder')
  assert.equal(reopened.getResumeAnalysis(documentId)?.analysisVersion, 'resume-analysis-v6')
  assert.equal(
    reopened.getCandidateExtraction(documentId)?.fields.find((field) => field.key === 'skills')?.value,
    'Java, AWS',
    'candidate extraction draft did not recover after reopening'
  )
  assert.equal(reopened.getCandidateReview(documentId)?.status, 'completed', 'completed review did not recover')
  assert.equal(reopened.getCandidateReview(documentId)?.profile?.status, 'current', 'candidate profile did not recover')
  assert.equal(reopened.getCandidateProfileHistory(documentId).length, 2, 'candidate profile edit history did not recover')
  assert.equal(reopened.getCandidateLocalIdentity(documentId).email, 'candidate@example.jp', 'edited candidate contact did not recover')
  assert.equal(reopened.getCandidateLocalIdentity(documentId).birthDate, '1990年4月', 'edited candidate birth date did not recover')
  assert.equal(reopened.getCandidateLocalIdentity(documentId).education, '東京工科大学', 'edited candidate education did not recover')
  assert.equal(
    searchConfirmedCandidateProfiles(reopened.listEligibleTalentProfiles(), 'Java AWS').length,
    1,
    'confirmed active profile did not enter local BM25 retrieval'
  )
  reopened.saveWorkTask(materializeWorkTask(
    createWorkTaskPreview('バックアップ後の変更を検証する'),
    'post-backup-change-verification',
    '2026-07-17T00:02:50.500Z'
  ))
  reopened.snoozeRecoveryReminder(1, new Date('2026-07-17T00:02:51.000Z'))
  assert.equal(
    reopened.getRecoveryState(false, new Date('2026-07-17T00:02:52.000Z')).reminder.status,
    'snoozed',
    'explicit one-day reminder deferral was not stored'
  )
  reopened.saveWorkTask(materializeWorkTask(
    createWorkTaskPreview('延期後の新しい変更を検証する'),
    'post-snooze-change-verification',
    '2026-07-17T00:02:53.000Z'
  ))
  assert.equal(
    reopened.getRecoveryState(false, new Date('2026-07-17T00:02:54.000Z')).reminder.status,
    'due',
    'a newer local change did not override the stale reminder deferral'
  )
  assert.equal(reopened.listEligibleTalentProfiles().length, 1, 'passed candidate did not remain in the eligible talent pool')
  assert.equal(searchConfirmedCandidateProfiles(reopened.listEligibleTalentProfiles(), 'Java AWS').length, 1, 'eligible candidate did not remain in BM25 retrieval')
  assert.equal(reopened.countGmailMessages('hr@example.co.jp'), 1, 'Gmail message deduplication did not persist')
  assert.equal(reopened.findGmailMessageByFingerprint('hr@example.co.jp', gmailFingerprint), 'gmail_msg_001')
  assert.equal(reopened.getGmailSyncCheckpoint('hr@example.co.jp')?.historyId, '120')
  assert.equal(reopened.getJobCaseReview(jobCaseReviewId)?.status, 'completed', 'job case review did not recover')
  assert.equal(reopened.getJobCaseReview(manualDraft.reviewId)?.sourceType, 'manual', 'manual job case did not recover')
  assert.equal(reopened.getJobCaseReview(emlDraft.reviewId)?.sourceType, 'eml', 'EML job case did not recover')
  assert.equal(reopened.getEmlJobCaseReview(emlSource.source.providerMessageId ?? '')?.reviewId, emlDraft.reviewId, 'EML deduplication key did not recover')
  assert.equal(reopened.getJobCaseReview(emlDraft.reviewId)?.redactedPreview.includes(emlCaseNameSentinel), false)
  assert.equal(reopened.getJobCaseReview(emlDraft.reviewId)?.redactedPreview.includes(emlCasePhoneSentinel), false)
  assert.equal(reopened.listActiveJobCases().length, 2, 'confirmed job cases did not recover')
  assert.equal(reopened.listGmailMessagesPendingJobCaseDrafts('hr@example.co.jp').length, 0)
  const archivedCase = reopened.setJobCaseLifecycle({
    reviewId: jobCaseReviewId,
    state: 'archived',
    reason: '検証用案件アーカイブ'
  }, 'verification-user', new Date('2026-07-17T00:02:56.000Z'))
  assert.equal(archivedCase.lifecycle, 'archived')
  assert.equal(reopened.listActiveJobCases().length, 1, 'archived job case remained active')
  assert.equal(reopened.getJobCaseHistory(jobCaseReviewId)[0]?.status, 'archived')
  const restoredCase = reopened.setJobCaseLifecycle({
    reviewId: jobCaseReviewId,
    state: 'active',
    reason: '検証後に案件を復元'
  }, 'verification-user', new Date('2026-07-17T00:02:57.000Z'))
  assert.equal(restoredCase.lifecycle, 'active')
  assert.equal(reopened.listActiveJobCases().length, 2, 'restored job case did not become active')
  const reopenedCaseReview = reopened.reopenJobCaseReview({
    reviewId: jobCaseReviewId,
    reason: '単価条件を更新するため'
  }, 'verification-user', new Date('2026-07-17T00:02:58.000Z'))
  assert.equal(reopenedCaseReview.status, 'awaiting-review')
  assert.equal(reopenedCaseReview.reviewRevision, 2)
  assert.equal(reopenedCaseReview.fields.find((field) => field.key === 'rate')?.value, '80万円/月')
  const revisedCase = reopened.confirmJobCaseReview({
    reviewId: jobCaseReviewId,
    reviewRevision: reopenedCaseReview.reviewRevision,
    privacyReviewed: true,
    fields: reopenedCaseReview.fields.map((field) => ({
      key: field.key,
      value: field.key === 'rate' ? '85万円/月' : field.value,
      confirmed: true as const,
      ...(field.key === 'rate' ? { changeReason: '顧客から更新連絡' } : {})
    }))
  }, 'verification-user', '検証担当者', new Date('2026-07-17T00:02:59.000Z'))
  assert.equal(revisedCase.jobCase?.version, 2)
  assert.equal(reopened.getJobCaseHistory(jobCaseReviewId).length, 2)
  assert.equal(reopened.getJobCaseHistory(jobCaseReviewId)[1]?.status, 'superseded')
  authoringDraft = reopened.getCandidateEvaluationDraft() ?? authoringDraft
  assert.equal(authoringDraft.cases[0]?.status, 'job-case-stale', 'a superseded job case did not invalidate its expert label')
  const staleEvaluationCaseId = authoringDraft.cases[0]?.id
  assert.ok(staleEvaluationCaseId)
  authoringDraft = reopened.deleteCandidateEvaluationDraftCase({
    draftId: authoringDraft.id,
    caseId: staleEvaluationCaseId,
    expectedRevision: authoringDraft.revision
  }, new Date('2026-07-17T00:02:59.010Z'))
  assert.equal(authoringDraft.caseCount, 0)
  const proposalOptions = reopened.getProposalPreparationOptions()
  assert.equal(proposalOptions.jobCases.length, 2)
  assert.equal(proposalOptions.candidates.length, 1)
  const candidateProfileId = updatedCandidateProfile.id
  const revisedJobCaseId = revisedCase.jobCase?.id
  assert.ok(candidateProfileId)
  assert.ok(revisedJobCaseId)
  authoringDraft = reopened.saveCandidateEvaluationDraftCase({
    draftId: authoringDraft.id,
    expectedRevision: authoringDraft.revision,
    jobCaseId: revisedJobCaseId,
    relevantCandidateProfileIds: [candidateProfileId],
    expectedProjectEvidenceProfileIds: [candidateProfileId],
    poolReviewed: true
  }, 'verification-user', '検証担当者', new Date('2026-07-17T00:02:59.050Z'))
  assert.equal(authoringDraft.cases[0]?.status, 'ready')
  const proposalDraft = reopened.createProposalDraft({
    taskId: proposalTask.id,
    jobCaseId: revisedJobCaseId,
    candidateProfileId,
    recipientTo: 'bp@example.co.jp',
    recipientCc: ['sales@example.co.jp'],
    candidateDisplayName: '候補者A',
    tone: 'standard'
  }, 'f3973f54-35a5-48fb-a2f7-1507b85dac80', '検証担当者', new Date('2026-07-17T00:02:59.100Z'))
  assert.equal(proposalDraft.generation.cloudUsed, false)
  assert.equal(proposalDraft.attachment.sourceDocumentIncluded, false)
  const salesAgentConversationId = '8cf7a1ad-89ec-4f96-9b4f-6f2be6a3c8da'
  const salesAgentTurnId = '9df8b2be-90fd-4a07-8c50-7f3cf7b4d9eb'
  const salesAgentJobCaseReference = {
    kind: 'job-case' as const,
    objectId: revisedJobCaseId,
    objectVersion: 2,
    resultHash: null,
    ordinal: 1,
    label: 'Java 案件',
    target: `job-case:${revisedJobCaseId}`
  }
  const persistedAgentResult = persistedMatchRun.matches[0]
  assert.ok(persistedAgentResult)
  const salesAgentResultReference = {
    kind: 'match-result' as const,
    objectId: persistedAgentResult.matchResultId,
    objectVersion: null,
    resultHash: persistedAgentResult.matchResultHash,
    ordinal: 1,
    label: persistedAgentResult.anonymousLabel,
    target: `match-result:${persistedAgentResult.matchResultId}`
  }
  const savedSalesAgentConversation = reopened.saveAiConversation({
    conversationId: salesAgentConversationId,
    context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
    messages: [
      { id: 'sales-agent-user-1', role: 'user', content: '最近有什么案件？', mode: 'local', turnId: salesAgentTurnId, createdAt: '2026-07-17T00:02:59.700Z' },
      {
        id: 'sales-agent-assistant-1', role: 'assistant', content: '已找到案件。', mode: 'cloud',
        modelKey: 'gpt-5.6-luna', modelDisplayName: 'GPT-5.6 Luna', narrativeStatus: 'completed',
        turnId: salesAgentTurnId, createdAt: '2026-07-17T00:02:59.800Z',
        references: [salesAgentJobCaseReference, salesAgentResultReference],
        blocks: [{
          type: 'job-case-cards', query: '', dataAsOf: '2026-07-17T00:02:59.700Z',
          normalizedFilters: { updatedAfter: '2026-06-18T15:00:00.000Z', updatedBefore: '2026-07-17T15:00:00.000Z', lifecycle: 'active', query: null, limit: 20 },
          totalMatched: 1,
          cards: [{ reference: salesAgentJobCaseReference, title: 'Java 案件', version: 2, updatedAt: '2026-07-17T00:02:59.000Z', requiredSkills: 'Java', rate: '85万円/月', workStyle: null, startDate: null, status: 'current' }]
        }, {
          type: 'candidate-match-cards', runId: persistedMatchRun.run.id, resultHash: persistedMatchRun.run.resultSetHash,
          cards: [{
            reference: salesAgentResultReference,
            candidateProfileId,
            runId: persistedMatchRun.run.id,
            rank: 1,
            anonymousLabel: persistedAgentResult.anonymousLabel,
            fitScore: persistedAgentResult.matchScore,
            matched: persistedAgentResult.matchedTerms,
            missing: [],
            hardFilterStatus: 'passed',
            projectEvidence: persistedAgentResult.projectEvidence?.summary ?? null,
            status: 'current'
          }]
        }]
      }
    ],
    salesAgentState: { selectedJobCaseRef: salesAgentJobCaseReference, lastMatchRunId: persistedMatchRun.run.id, lastSearchMessageId: 'sales-agent-assistant-1' },
    expectedRevision: null
  }, new Date('2026-07-17T00:02:59.700Z'))
  assert.equal(savedSalesAgentConversation.context.candidateDocumentId, null)
  const persistedModelMessage = reopened.getAiConversation(salesAgentConversationId)?.messages.find((message) => message.id === 'sales-agent-assistant-1')
  assert.deepEqual({
    mode: persistedModelMessage?.mode,
    modelKey: persistedModelMessage?.modelKey,
    modelDisplayName: persistedModelMessage?.modelDisplayName,
    narrativeStatus: persistedModelMessage?.narrativeStatus
  }, {
    mode: 'cloud', modelKey: 'gpt-5.6-luna', modelDisplayName: 'GPT-5.6 Luna', narrativeStatus: 'completed'
  }, 'Agent model metadata did not survive encrypted conversation persistence')
  const actionRunConversationLink = reopened.createActionRun({
    toolName: 'job-case.search.local', workTaskId: null, origin: 'user-command', scopeId: 'active-job-cases',
    scopeFingerprint: '8'.repeat(64), inputHash: '9'.repeat(64), contentRevision: null,
    conversationId: salesAgentConversationId, turnId: salesAgentTurnId,
    status: 'queued', idempotencyKey: 'agent-action-run-conversation-link'
  })
  assert.equal(reopened.getActionRunStatus(actionRunConversationLink.id), 'queued')
  assert.equal(reopened.listAiConversations({ assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null }).length, 1)

  const firstTurnSearchConversationId = '7af9c7d1-3ad1-4c4f-9c42-0a5ce5f7b201'
  const firstTurnSearchTurnId = '6e7c8d9f-2a31-4b45-8c69-0d1e2f3a4b51'
  const firstTurnSearchAction = reopened.createActionRun({
    toolName: 'job-case.search.local', workTaskId: null, origin: 'user-command', scopeId: 'active-job-cases',
    scopeFingerprint: 'a'.repeat(64), inputHash: 'b'.repeat(64), contentRevision: null,
    conversationId: null, turnId: null, status: 'queued', idempotencyKey: 'agent-first-turn-search-null-link'
  })
  const firstTurnSearchConversation = reopened.saveAiConversation({
    conversationId: firstTurnSearchConversationId,
    context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
    messages: [
      { id: 'agent-first-turn-search-user', role: 'user', content: '最近の案件は？', mode: 'local', turnId: firstTurnSearchTurnId, createdAt: '2026-07-17T00:02:59.900Z' },
      { id: 'agent-first-turn-search-assistant', role: 'assistant', content: '案件を確認しました。', mode: 'local', turnId: firstTurnSearchTurnId, createdAt: '2026-07-17T00:02:59.910Z' }
    ],
    salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: 'agent-first-turn-search-assistant' },
    expectedRevision: null
  })
  reopened.linkActionRunToConversation(firstTurnSearchAction.id, firstTurnSearchConversation.id, firstTurnSearchTurnId)
  reopened.linkActionRunToConversation(firstTurnSearchAction.id, firstTurnSearchConversation.id, firstTurnSearchTurnId)

  const firstTurnCandidateConversationId = '8bf9c7d1-3ad1-4c4f-9c42-0a5ce5f7b202'
  const firstTurnCandidateTurnId = '7e7c8d9f-2a31-4b45-8c69-0d1e2f3a4b52'
  const firstTurnCandidateAction = reopened.createActionRun({
    toolName: 'candidate.match.local', workTaskId: null, origin: 'user-command', scopeId: 'confirmed-candidate-pool',
    scopeFingerprint: 'c'.repeat(64), inputHash: 'd'.repeat(64), contentRevision: null,
    conversationId: null, turnId: null, status: 'queued', idempotencyKey: 'agent-first-turn-candidate-null-link'
  })
  const firstTurnCandidateConversation = reopened.saveAiConversation({
    conversationId: firstTurnCandidateConversationId,
    context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
    messages: [
      { id: 'agent-first-turn-candidate-user', role: 'user', content: '给当前案件匹配候选人', mode: 'local', turnId: firstTurnCandidateTurnId, createdAt: '2026-07-17T00:02:59.920Z' },
      { id: 'agent-first-turn-candidate-assistant', role: 'assistant', content: '已完成候选人匹配。', mode: 'local', turnId: firstTurnCandidateTurnId, createdAt: '2026-07-17T00:02:59.930Z' }
    ],
    salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null },
    expectedRevision: null
  })
  reopened.linkActionRunToConversation(firstTurnCandidateAction.id, firstTurnCandidateConversation.id, firstTurnCandidateTurnId)

  const firstTurnReadConversationId = '9bf9c7d1-3ad1-4c4f-9c42-0a5ce5f7b203'
  const firstTurnReadTurnId = '8e7c8d9f-2a31-4b45-8c69-0d1e2f3a4b53'
  const firstTurnReadAction = reopened.createActionRun({
    toolName: 'match-run.read.local', workTaskId: null, origin: 'user-command', scopeId: 'selected-match-run',
    scopeFingerprint: 'e'.repeat(64), inputHash: 'f'.repeat(64), contentRevision: null,
    conversationId: null, turnId: null, status: 'queued', idempotencyKey: 'agent-first-turn-read-null-link'
  })
  const firstTurnReadConversation = reopened.saveAiConversation({
    conversationId: firstTurnReadConversationId,
    context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
    messages: [
      { id: 'agent-first-turn-read-user', role: 'user', content: 'なぜ1位になったの？', mode: 'local', turnId: firstTurnReadTurnId, createdAt: '2026-07-17T00:02:59.940Z' },
      { id: 'agent-first-turn-read-assistant', role: 'assistant', content: '保存済みの根拠を確認しました。', mode: 'local', turnId: firstTurnReadTurnId, createdAt: '2026-07-17T00:02:59.950Z' }
    ],
    salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null },
    expectedRevision: null
  })
  reopened.linkActionRunToConversation(firstTurnReadAction.id, firstTurnReadConversation.id, firstTurnReadTurnId)
  assert.throws(
    () => reopened.linkActionRunToConversation(firstTurnReadAction.id, firstTurnSearchConversation.id, firstTurnSearchTurnId),
    /already linked|別の会話|別の会話へ/
  )
  assert.throws(
    () => reopened.linkActionRunToConversation(firstTurnSearchAction.id, interviewConversationId, firstTurnSearchTurnId),
    /Sales Agent/
  )
  assert.throws(
    () => reopened.linkActionRunToConversation(firstTurnSearchAction.id, firstTurnSearchConversation.id, 'ffffffff-ffff-4fff-8fff-ffffffffffff'),
    /turn_id/
  )
  const updatedProposal = reopened.updateProposalDraft({
    draftId: proposalDraft.id,
    revision: proposalDraft.revision,
    recipientTo: 'bp-updated@example.co.jp',
    recipientCc: proposalDraft.recipientCc,
    candidateDisplayName: proposalDraft.candidateDisplayName,
    subject: proposalDraft.subject,
    body: proposalDraft.body
  }, '検証担当者', new Date('2026-07-17T00:02:59.200Z'))
  assert.equal(updatedProposal.revision, 2)
  assert.notEqual(updatedProposal.contentHash, proposalDraft.contentHash)
  const approvedProposal = reopened.approveProposalDraft({
    draftId: updatedProposal.id,
    revision: updatedProposal.revision,
    contentHash: updatedProposal.contentHash,
    approvals: { recipient: true, body: true, attachment: true, privacy: true }
  }, '検証担当者', new Date('2026-07-17T00:02:59.300Z'))
  reopened.beginProposalExport(
    approvedProposal.id,
    approvedProposal.revision,
    approvedProposal.contentHash,
    'a3196b88-fb9a-4d52-ae7d-07f2bd2fd123',
    '4'.repeat(64),
    '検証担当者',
    new Date('2026-07-17T00:02:59.400Z')
  )
  const exportedProposal = reopened.completeProposalExport(
    'a3196b88-fb9a-4d52-ae7d-07f2bd2fd123',
    approvedProposal.id,
    approvedProposal.contentHash,
    '5'.repeat(64),
    '検証担当者',
    new Date('2026-07-17T00:02:59.500Z')
  )
  assert.equal(exportedProposal.status, 'exported')
  assert.equal(exportedProposal.exportPackageHash, '5'.repeat(64))
  const sentProposal = reopened.recordProposalFollowUp({
    draftId: exportedProposal.id,
    expectedRevision: 0,
    stage: 'sent',
    occurredOn: '2026-07-17',
    note: '翌営業日に状況確認',
    manuallyConfirmed: true
  }, 'bb6b957e-caf1-4c5c-b9f7-4c0cd358af33', '検証担当者', new Date('2026-07-17T00:02:59.600Z'))
  assert.equal(sentProposal.followUp.stage, 'sent')
  assert.equal(sentProposal.followUp.events[0]?.cloudEligible, false)
  assert.throws(() => reopened.recordProposalFollowUp({
    draftId: exportedProposal.id,
    expectedRevision: 0,
    stage: 'replied',
    occurredOn: '2026-07-18',
    manuallyConfirmed: true
  }, 'ab0392b1-c608-44ea-a29d-23d3cded7396', '検証担当者'), /changed/, 'stale proposal follow-up revision was accepted')
  assert.throws(() => reopened.recordProposalFollowUp({
    draftId: exportedProposal.id,
    expectedRevision: 1,
    stage: 'replied',
    occurredOn: '2026-07-18',
    note: '連絡先 090-1234-5678',
    manuallyConfirmed: true
  }, 'bf4ba6c0-1d51-4ec6-8801-e9f25517804c', '検証担当者'), /direct identifiers/, 'direct identifier was accepted in proposal follow-up note')
  reopened.close()
  reopened = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  assert.equal(reopened.getProposalDraft(exportedProposal.id)?.followUp.events[0]?.note, '翌営業日に状況確認')
  const repliedProposal = reopened.recordProposalFollowUp({
    draftId: exportedProposal.id,
    expectedRevision: 1,
    stage: 'replied',
    occurredOn: '2026-07-18',
    manuallyConfirmed: true
  }, 'e31285fe-2f0d-47c7-a53f-1d792daf72f0', '検証担当者', new Date('2026-07-18T00:00:00.000Z'))
  assert.deepEqual(repliedProposal.followUp.events.map((event) => event.stage), ['sent', 'replied'])
  const jobCaseDeletionPreview = reopened.previewJobCaseDeletion(jobCaseReviewId)
  assert.equal(jobCaseDeletionPreview.counts.caseVersions, 2)
  assert.equal(jobCaseDeletionPreview.counts.gmailMessages, 1)
  assert.equal(jobCaseDeletionPreview.counts.piiMappings, 2)
  assert.equal(jobCaseDeletionPreview.counts.proposalDrafts, 1)
  assert.equal(jobCaseDeletionPreview.counts.evaluationDraftCases, 1)
  assert.equal(jobCaseDeletionPreview.counts.agentReferences?.conversations, 1)
  assert.equal(jobCaseDeletionPreview.counts.agentReferences?.messages, 1)
  reopened.deleteJobCaseDatabaseData({
    reviewId: jobCaseReviewId,
    confirmationHash: jobCaseDeletionPreview.confirmationHash,
    confirmationText: '削除'
  }, new Date('2026-07-17T00:03:00.000Z'))
  const jobCaseDeletionReportId = '3f15a899-b863-48ec-acb6-e033b3c04658'
  reopened.saveDataDeletionReport({
    id: jobCaseDeletionReportId,
    entityType: 'job_case',
    entityIdHash: '3'.repeat(64),
    requestedBy: '検証担当者',
    startedAt: '2026-07-17T00:03:00.000Z',
    completedAt: '2026-07-17T00:03:01.000Z',
    outcome: 'completed',
    components: {
      database: 'deleted',
      fileVault: 'not_present',
      searchIndex: 'not_present',
      cache: 'not_present',
      temporaryFiles: 'not_present',
      backups: 'not_present'
    },
    deletedCounts: jobCaseDeletionPreview.counts,
    warningCodes: jobCaseDeletionPreview.warningCodes
  })
  assert.equal(reopened.getJobCaseReview(jobCaseReviewId), null, 'deleted job case review remained')
  assert.equal(reopened.countGmailMessages('hr@example.co.jp'), 0, 'deleted Gmail source remained locally')
  assert.equal(reopened.hasGmailMessage('hr@example.co.jp', 'gmail_msg_001'), true, 'Gmail deletion tombstone was not honored')
  assert.equal(reopened.listActiveJobCases().length, 1, 'unrelated manual job case was deleted')
  assert.equal(reopened.getProposalDraft(proposalDraft.id), null, 'job-case-linked proposal survived case deletion')
  const afterJobCaseDeletionConversation = reopened.getAiConversation(salesAgentConversationId)
  assert.ok(afterJobCaseDeletionConversation)
  assert.equal(afterJobCaseDeletionConversation.messages.some((message) => message.blocks?.some((block) => block.type === 'error' && block.code === 'ENTITY_DELETED')), true, 'deleted job-case reference was not downgraded')
  const directIdentifierConversationId = '9ef7c8d9-0a1b-4c2d-8e3f-4a5b6c7d8e9f'
  const directIdentifierText = '请联系山田 更新後，电话 080-2222-3333，邮箱 candidate@example.jp。'
  reopened.saveAiConversation({
    conversationId: directIdentifierConversationId,
    context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
    messages: [
      { id: 'sales-agent-direct-user-1', role: 'user', content: directIdentifierText, mode: 'local', createdAt: '2026-07-17T00:03:00.050Z' },
      {
        id: 'sales-agent-direct-assistant-1', role: 'assistant', content: '已保存候选人匹配结果。', mode: 'local', createdAt: '2026-07-17T00:03:00.060Z',
        references: [salesAgentResultReference],
        blocks: [{
          type: 'candidate-match-cards', runId: persistedMatchRun.run.id, resultHash: persistedMatchRun.run.resultSetHash,
          cards: [{
            reference: salesAgentResultReference,
            candidateProfileId,
            runId: persistedMatchRun.run.id,
            rank: 1,
            anonymousLabel: persistedAgentResult.anonymousLabel,
            fitScore: persistedAgentResult.matchScore,
            matched: persistedAgentResult.matchedTerms,
            missing: [],
            hardFilterStatus: 'passed',
            projectEvidence: persistedAgentResult.projectEvidence?.summary ?? null,
            status: 'current'
          }]
        }]
      }
    ],
    salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: persistedMatchRun.run.id, lastSearchMessageId: null },
    expectedRevision: null
  }, new Date('2026-07-17T00:03:00.060Z'))
  authoringDraft = reopened.getCandidateEvaluationDraft() ?? authoringDraft
  assert.equal(authoringDraft.caseCount, 0, 'job-case-linked evaluation draft case survived case deletion')
  const manualCaseId = reopened.getJobCaseReview(manualDraft.reviewId)?.jobCase?.id
  assert.ok(manualCaseId)
  authoringDraft = reopened.saveCandidateEvaluationDraftCase({
    draftId: authoringDraft.id,
    expectedRevision: authoringDraft.revision,
    jobCaseId: manualCaseId,
    relevantCandidateProfileIds: [candidateProfileId],
    expectedProjectEvidenceProfileIds: [candidateProfileId],
    poolReviewed: true
  }, 'verification-user', '検証担当者', new Date('2026-07-17T00:03:00.100Z'))
  assert.equal(authoringDraft.cases[0]?.status, 'ready')
  const interruptedProposal = reopened.createProposalDraft({
    taskId: proposalTask.id,
    jobCaseId: manualCaseId,
    candidateProfileId,
    recipientTo: 'manual@example.co.jp',
    recipientCc: [],
    candidateDisplayName: '候補者A',
    tone: 'formal'
  }, '28ab0e26-2389-48cb-ac53-e5334ce02bfd', '検証担当者', new Date('2026-07-17T00:03:01.000Z'))
  const approvedInterruptedProposal = reopened.approveProposalDraft({
    draftId: interruptedProposal.id,
    revision: interruptedProposal.revision,
    contentHash: interruptedProposal.contentHash,
    approvals: { recipient: true, body: true, attachment: true, privacy: true }
  }, '検証担当者', new Date('2026-07-17T00:03:01.100Z'))
  reopened.beginProposalExport(
    approvedInterruptedProposal.id,
    approvedInterruptedProposal.revision,
    approvedInterruptedProposal.contentHash,
    '38a3ed67-f326-4b2b-b7d5-d413660b5381',
    '6'.repeat(64),
    '検証担当者',
    new Date('2026-07-17T00:03:01.200Z')
  )
  reopened.close()
  reopened = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  assert.equal(reopened.getProposalDraft(interruptedProposal.id)?.status, 'export_unknown', 'interrupted export was not recovered conservatively')
  const refreshedExtraction = extractCandidateDraft(document, new Date('2026-07-17T00:03:00.000Z'))
  reopened.saveParsedDocument(document, { ...summary, analyzedAt: '2026-07-17T00:03:00.000Z' }, redaction.session.id, refreshedExtraction)
  const staleReview = reopened.getCandidateReview(documentId)
  assert.equal(staleReview?.status, 'awaiting-review', 'new extraction did not reopen review')
  assert.equal(staleReview?.reviewRevision, 2, 'review revision did not advance')
  assert.equal(staleReview?.profile?.status, 'stale', 'previous profile was not marked stale')
  assert.equal(reopened.listCandidateInterviews().some((item) => item.sourceDocumentId === documentId), true, 'resume refresh discarded recruiting history')
  assert.equal(reopened.getCandidateProfileHistory(documentId)[0]?.status, 'stale', 'profile history did not expose stale status')
  assert.equal(reopened.getCandidateEvaluationDraft()?.cases[0]?.status, 'candidate-stale', 'a stale candidate profile did not invalidate its expert label')
  assert.throws(
    () => reopened.confirmCandidateReview(reviewSubmission, 'verification-user', '検証担当者'),
    /changed/,
    'an outdated review revision was unexpectedly accepted'
  )
  const deletionPreview = reopened.previewCandidateDeletion(documentId)
  assert.equal(deletionPreview.counts.profileVersions, 2)
  assert.equal(deletionPreview.counts.matchRecords, 1)
  assert.equal(deletionPreview.counts.evaluationRecords, 3)
  assert.equal(deletionPreview.counts.piiMappings, 6)
  assert.equal(deletionPreview.counts.proposalDrafts, 1)
  assert.equal(deletionPreview.counts.searchIndexEntries, 2)
  assert.equal(deletionPreview.counts.agentReferences?.conversations, 2)
  assert.equal(deletionPreview.counts.agentReferences?.messages, 3)
  reopened.deleteCandidateDatabaseData(documentId, deletionPreview.confirmationHash, new Date('2026-07-17T00:04:00.000Z'))
  const afterCandidateDeletionConversation = reopened.getAiConversation(salesAgentConversationId)
  assert.ok(afterCandidateDeletionConversation)
  assert.equal(afterCandidateDeletionConversation.messages.some((message) => message.blocks?.some((block) => block.type === 'error' && block.code === 'ENTITY_DELETED')), true, 'deleted candidate reference was not downgraded')
  const afterDirectIdentifierDeletionConversation = reopened.getAiConversation(directIdentifierConversationId)
  assert.ok(afterDirectIdentifierDeletionConversation)
  assert.equal(afterDirectIdentifierDeletionConversation.messages.some((message) => message.role === 'user'), false, 'direct-identifier user message was not removed')
  assert.equal(JSON.stringify(afterDirectIdentifierDeletionConversation).includes('山田 更新後'), false, 'deleted candidate name remained in a user message')
  assert.equal(JSON.stringify(afterDirectIdentifierDeletionConversation).includes('080-2222-3333'), false, 'deleted candidate phone remained in a user message')
  assert.equal(JSON.stringify(afterDirectIdentifierDeletionConversation).includes('candidate@example.jp'), false, 'deleted candidate email remained in a user message')
  assert.deepEqual(reopened.deleteAiConversations([directIdentifierConversationId]), [directIdentifierConversationId])
  assert.deepEqual(reopened.deleteAiConversations([salesAgentConversationId]), [salesAgentConversationId])
  assert.equal(reopened.getActionRunStatus(actionRunConversationLink.id), 'queued', 'deleting an Agent conversation removed its Action Audit')
  assert.equal(reopened.listAiConversations(interviewConversationContext).length, 0, 'candidate deletion retained AI conversation history')
  const deletionReportId = '4ae4efb5-700d-47f7-837f-5bc150016116'
  reopened.saveDataDeletionReport({
    id: deletionReportId,
    entityType: 'candidate',
    entityIdHash: '2'.repeat(64),
    requestedBy: '検証担当者',
    startedAt: '2026-07-17T00:04:00.000Z',
    completedAt: '2026-07-17T00:04:01.000Z',
    outcome: 'completed',
    components: {
      database: 'deleted',
      fileVault: 'not_present',
      searchIndex: 'deleted',
      cache: 'not_present',
      temporaryFiles: 'not_present',
      backups: 'not_present'
    },
    deletedCounts: deletionPreview.counts,
    warningCodes: deletionPreview.warningCodes
  })
  assert.equal(reopened.getCandidateReview(documentId), null, 'candidate review remained after deletion')
  assert.equal(searchConfirmedCandidateProfiles(reopened.listEligibleTalentProfiles(), 'Java AWS').length, 0, 'deleted profile remained in BM25 retrieval')
  assert.equal(reopened.getCandidateProfileHistory(documentId).length, 0, 'profile versions remained after deletion')
  assert.equal(reopened.listCandidateProfileEmbeddings(
    'Xenova/multilingual-e5-small',
    '761b726dd34fb83930e26aab4e9ac3899aa1fa78'
  ).length, 0, 'candidate embedding cache survived profile deletion')
  assert.equal(reopened.listCandidateProjectEmbeddings(
    'Xenova/multilingual-e5-small',
    '761b726dd34fb83930e26aab4e9ac3899aa1fa78'
  ).length, 0, 'project embedding cache survived profile deletion')
  assert.equal(reopened.getCandidateMatchRunSummary(persistedMatchRun.run.id).evaluation.resultCount, 0, 'candidate match feedback survived profile deletion')
  assert.equal(reopened.getCandidateEvaluationState().latestReport, null, 'candidate evaluation data survived candidate deletion')
  assert.equal(reopened.getCandidateEvaluationDraft()?.cases[0]?.status, 'no-relevant-candidates', 'candidate deletion left an expert label or removed the unrelated case')
  assert.equal(reopened.getLocalPiiMappings(redaction.session.id).length, 0, 'PII mappings remained after deletion')
  assert.equal(reopened.getProposalDraft(interruptedProposal.id), null, 'candidate-linked proposal survived candidate deletion')
  assert.equal(reopened.listDataDeletionReports().some((report) => report.id === deletionReportId), true, 'candidate deletion report was not persisted')
  assert.equal(reopened.listDataDeletionReports().some((report) => report.id === jobCaseDeletionReportId), true, 'job case deletion report was not persisted')
  reopened.close()

  const afterDeletion = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  assert.equal(afterDeletion.getCandidateProfileHistory(documentId).length, 0, 'deleted candidate recovered after restart')
  assert.equal(afterDeletion.listDataDeletionReports().some((report) => report.id === deletionReportId), true, 'deletion report did not recover')
  assert.equal(afterDeletion.listDataDeletionReports().some((report) => report.id === jobCaseDeletionReportId), true, 'job case deletion report did not recover')
  assert.equal(afterDeletion.countGmailMessages('hr@example.co.jp'), 0, 'deleted Gmail data recovered')
  assert.equal(afterDeletion.hasGmailMessage('hr@example.co.jp', 'gmail_msg_001'), true, 'Gmail tombstone did not recover')
  assert.equal(afterDeletion.getJobCaseReview(manualDraft.reviewId)?.status, 'completed', 'unrelated manual job case was deleted')
  assert.equal(afterDeletion.getRecoveryState().lastBackupAt, '2026-07-17T00:02:49.000Z', 'backup audit event did not recover')
  afterDeletion.close()

  const actionAssociationInspection = new Database(databasePath)
  actionAssociationInspection.pragma("cipher='sqlcipher'")
  actionAssociationInspection.pragma('legacy=4')
  actionAssociationInspection.key(databaseKey)
  actionAssociationInspection.prepare('SELECT count(*) FROM sqlite_master').get()
  const firstTurnAssociations = actionAssociationInspection.prepare<
    [string, string, string, string, string, string],
    { id: string; tool_name: string; conversation_id: string | null; turn_id: string | null }[]
  >(
    `SELECT id, tool_name, conversation_id, turn_id FROM action_runs
     WHERE id IN (?, ?, ?)
     ORDER BY id`
  ).all(firstTurnSearchAction.id, firstTurnCandidateAction.id, firstTurnReadAction.id)
  const firstTurnAssociationById = new Map(firstTurnAssociations.map((row) => [row.id, row]))
  assert.deepEqual(
    firstTurnAssociationById.get(firstTurnSearchAction.id),
    { id: firstTurnSearchAction.id, tool_name: 'job-case.search.local', conversation_id: firstTurnSearchConversationId, turn_id: firstTurnSearchTurnId },
    'first-turn job-case search ActionRun was not linked after conversation save'
  )
  assert.deepEqual(
    firstTurnAssociationById.get(firstTurnCandidateAction.id),
    { id: firstTurnCandidateAction.id, tool_name: 'candidate.match.local', conversation_id: firstTurnCandidateConversationId, turn_id: firstTurnCandidateTurnId },
    'first-turn candidate match ActionRun was not linked after conversation save'
  )
  assert.deepEqual(
    firstTurnAssociationById.get(firstTurnReadAction.id),
    { id: firstTurnReadAction.id, tool_name: 'match-run.read.local', conversation_id: firstTurnReadConversationId, turn_id: firstTurnReadTurnId },
    'first-turn match-run read ActionRun was not linked after conversation save'
  )
  assert.equal((actionAssociationInspection.pragma('foreign_key_check') as unknown[]).length, 0, 'first-turn ActionRun association introduced an FK violation')
  actionAssociationInspection.close()

  assert.throws(
    () => new EncryptedApplicationRepository({ path: databasePath, databaseKey: randomBytes(32), mappingKey }),
    /Unable to open the encrypted local database/,
    'an incorrect database key unexpectedly opened the database'
  )

  process.stdout.write(
    `${JSON.stringify({
      encryptedHeader: true,
      plaintextLeak: false,
      wrongKeyBlocked: true,
      recoveredTasks: 2,
      workTaskRecordRecoveryVerified: true,
      processingJobLeaseRecoveryVerified: true,
      processingJobExponentialBackoffVerified: true,
      recoveredMappings: 2,
      recoveredCandidateDraft: true,
      recoveredCandidateReview: true,
      recoveredCandidateProfileHistory: true,
      candidateAdmissionSeparationVerified: true,
      eligibleOnlyRetrievalVerified: true,
      rejectedCandidateRetentionVerified: true,
      clientDecisionPreservesEligibilityVerified: true,
      encryptedEmbeddingCacheVerified: true,
      projectExperienceReviewVerified: true,
      candidateLocalPersonalDataAllowed: true,
      candidateLocalIdentityEditingVerified: true,
      candidateWorkAuthorizationComplianceVerified: true,
      projectEmbeddingCacheVerified: true,
      candidateMatchFeedbackVerified: true,
      matchingHomeValidityVerified: true,
      businessPriorityProjectionVerified: true,
      hardFilterTriStatePolicyVerified: true,
      candidateMatchRecallNotOverclaimed: true,
      candidateEvaluationQualityGateVerified: true,
      candidateEvaluationAuthoringDraftVerified: true,
      candidateEvaluationAuthoringInvalidationVerified: true,
      candidateEvaluationDeletionCascadeVerified: true,
      candidateEvaluationDraftDeletionCascadeVerified: true,
      googleWorkspaceAdminConfigurationVerified: true,
      localOperatorProfileVerified: true,
      localApplicationPreferencesVerified: true,
      googleWorkspaceAcceptanceEvidenceVerified: true,
      embeddingDeletionCascadeVerified: true,
      staleProfileOnReanalysis: true,
      optimisticRevisionBlocked: true,
      gmailMessageDeduplicated: true,
      gmailHistoryCheckpointRecovered: true,
      jobCaseDraftRecovered: true,
      jobCaseDirectIdentifierBlocked: true,
      jobCaseNationalityRestrictionBlocked: true,
      jobCaseRevisionHistoryVerified: true,
      jobCaseArchiveRestoreVerified: true,
      jobCaseDeletionTombstoneVerified: true,
      proposalApprovalHashVerified: true,
      proposalExportStateVerified: true,
      proposalFollowUpLifecycleVerified: true,
      interruptedProposalExportRecovered: true,
      consistentEncryptedSnapshotVerified: true,
      snapshotRevisionTriggersVerified: true,
      recoveryAuditRecovered: true,
      recoveryReminderAndDeferralVerified: true,
      candidateDeletionVerified: true,
      deletionReportRecovered: true,
      candidateInterviewWorkflowVerified: true,
      aiConversationHistoryVerified: true,
      agentFirstTurnActionRunAssociationVerified: true,
      agentCandidateMatchFirstTurnAssociationVerified: true,
      agentMatchRunReadFirstTurnAssociationVerified: true,
      schemaVersion: 38,
      fileMode: '0600'
    })}\n`
  )
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
