import { searchConfirmedCandidateProfiles } from '@resume'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { currentSchemaVersion, EncryptedApplicationRepository } from '@persistence'
import { redactTextForCloud } from '@privacy'
import { extractCandidateDraft } from '@resume'
import { createRedactedManualJobCaseSource, extractJobCaseDraft } from '@job-cases'
import {
  businessProgressStep,
  builtInPersonnelTemplates,
  generatePersonnelMessage,
  type ProgressCommand,
  type BusinessFollowUp,
  type ResumeAnalysisSummary
} from '@shared'
import type { DocumentIR } from '@parsers'

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ses-progress-verification-'))
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

  const legacy = repository.saveCandidateInterviewSchedule(
    {
      sourceDocumentId: documentId,
      kind: 'client',
      roundNumber: 1,
      scheduledAt: '2026-09-01T01:00:00.000Z',
      durationMinutes: 60,
      meetingMethod: 'onsite',
      interviewer: '旧记录',
      contactNote: '保留以前的客户面试'
    },
    'test-hr'
  )
  repository.close()
  const legacyDb = new Database(databasePath)
  legacyDb.pragma("cipher='sqlcipher'")
  legacyDb.pragma('legacy=4')
  legacyDb.key(databaseKey)
  legacyDb.pragma('foreign_keys=OFF')
  legacyDb.exec(
    'DROP INDEX candidate_interview_legacy_round_idx; DROP INDEX candidate_interview_business_round_idx; ALTER TABLE candidate_interview_sessions DROP COLUMN business_followup_id; CREATE UNIQUE INDEX legacy_round_idx ON candidate_interview_sessions(source_document_id,kind,round_number); DROP TABLE business_progress_mail; DROP TABLE personnel_mail_updates; DELETE FROM schema_migrations WHERE version IN (49,50);'
  )
  legacyDb.close()
  repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  assert.equal(repository.listCandidateInterviews()[0]!.id, legacy.id, 'v48 migration preserves the existing interview identity')
  assert.equal(repository.listCandidateInterviews()[0]!.contactNote, '保留以前的客户面试')
  assert.equal(repository.listCandidateInterviews()[0]!.businessFollowUpId, null, 'migration does not guess an old interview case')
  const jobs = ['Java 第一案件', 'Java 第二案件', 'Java 第三案件'].map((title) => {
    const source = createRedactedManualJobCaseSource({ subject: title, body: '必須スキル：Java / SQL\n勤務地：東京' }, randomUUID(), [])
    const draft = extractJobCaseDraft(source.source, randomUUID())
    repository.saveRedactedJobCaseSourceAndDraft(source.redaction.session, source.redaction.mappings, source.source, draft)
    return repository.getJobCaseReview(draft.reviewId)!
  })
  const pairs = jobs.map((job) => ({ documentId, reviewId: job.reviewId, pendingConditions: ['通勤条件を確認'] }))
  const revisionBefore = repository.getLocalDataRevision().revision
  let records = repository.beginBusinessProgress(pairs, 'test-hr')
  assert.equal(records.length, 3)
  assert.equal(repository.beginBusinessProgress(pairs, 'test-hr').length, 3)
  assert.equal(repository.listBusinessFollowUps().length, 3, 'one persistent relationship per person and case')
  assert.ok(repository.getLocalDataRevision().revision > revisionBefore)
  const change = (index: number, command: ProgressCommand) => {
    const item = repository.listBusinessFollowUps().find((row) => row.reviewId === pairs[index]!.reviewId)!
    const input = { documentId, reviewId: item.reviewId, expectedRevision: item.revision, mutationId: randomUUID(), ...command }
    const result = repository.advanceBusinessProgress(input, 'test-hr')
    assert.equal(repository.advanceBusinessProgress(input, 'test-hr').revision, result.revision, 'duplicate delivery is idempotent')
    return result
  }
  const schedule = (roundNumber: number, scheduledAt: string) => ({
    roundNumber,
    scheduledAt,
    durationMinutes: 60,
    meetingMethod: 'onsite' as const,
    meetingUrl: '',
    location: '東京',
    interviewer: '検証担当',
    note: '業務フロー検証'
  })
  for (const meetingUrl of [
    '',
    '会议号 123456，密码稍后告知',
    'http://example.com/meeting',
    'https://teams.microsoft.com/meeting',
    '说明'.repeat(1100)
  ]) {
    const saved = change(0, {
      action: 'schedule',
      schedule: { ...schedule(1, ''), meetingMethod: 'zoom', meetingUrl, interviewer: '', note: '备注'.repeat(1000) }
    })
    assert.equal(saved.progress!.stage, 'coordinating')
    assert.equal(saved.progress!.rounds[0]!.meetingUrl, meetingUrl || null)
    assert.equal(saved.progress!.rounds[0]!.scheduledAt, null)
    assert.equal(saved.progress!.rounds[0]!.contactNote, '备注'.repeat(1000))
    repository.close()
    repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
    assert.deepEqual(
      repository.listBusinessFollowUps().find((row) => row.id === saved.id),
      saved,
      'free-form arrangement survives restart'
    )
  }
  let a = change(0, { action: 'schedule', schedule: schedule(1, '2026-09-08T01:00:00.000Z') })
  assert.equal(
    change(1, { action: 'schedule', schedule: schedule(1, '2026-09-08T01:30:00.000Z') }).progress!.stage,
    'scheduled',
    'overlapping appointments can be saved by HR'
  )
  change(1, { action: 'schedule', schedule: schedule(1, '2026-09-08T02:00:00.000Z') })
  change(2, { action: 'schedule', schedule: schedule(1, '2026-09-08T03:00:00.000Z') })
  assert.equal(repository.listCandidateInterviews().filter((row) => row.businessFollowUpId).length, 3, 'three independent first rounds')
  const firstRound = structuredClone(
    repository.listBusinessFollowUps().find((row) => row.reviewId === pairs[1]!.reviewId)!.progress!.rounds[0]!
  )
  for (const roundNumber of [2, 3]) {
    const booked = change(1, { action: 'schedule', schedule: schedule(roundNumber, `2026-09-${14 + roundNumber}T01:00:00.000Z`) })
    assert.equal(booked.progress!.rounds.length, roundNumber, 'new appointment is a distinct round')
    assert.equal(businessProgressStep(booked, new Date('2026-09-10T00:00:00Z')).label, `${roundNumber} 面已预约`)
    assert.deepEqual(booked.progress!.rounds[0], firstRound, 'earlier appointment and unknown result remain untouched')
    assert.equal(booked.progress!.rounds.at(-1)!.parentInterviewId, booked.progress!.rounds.at(-2)!.id)
    repository.close()
    repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
    assert.deepEqual(
      repository.listBusinessFollowUps().find((row) => row.id === booked.id),
      booked,
      'round number survives restart'
    )
  }
  change(1, {
    action: 'feedback',
    roundNumber: 3,
    notes: '三面通过，客户后续安排待定',
    result: 'passed',
    next: 'unknown',
    unresolved: ['现场安排']
  })
  const fourth = change(1, { action: 'schedule', schedule: schedule(4, '2026-09-20T01:00:00.000Z') })
  assert.equal(fourth.progress!.rounds.at(-1)!.roundNumber, 4, 'HR can book next round without another next-step gate')
  assert.equal(fourth.progress!.rounds[2]!.decision, 'passed', 'existing explicit outcome is preserved')

  // Backfilled results affect only their actual round, never the current appointment.
  const fourthSnapshot = structuredClone(fourth.progress!)
  for (const result of ['pending', 'passed', 'failed', 'no-show', 'withdrawn'] as const) {
    const backfilled = change(1, {
      action: 'feedback',
      roundNumber: 1,
      notes: `补录一面 ${result}`,
      result,
      next: result === 'passed' ? 'entry' : 'unknown',
      unresolved: ['仅属于一面的事项']
    })
    assert.equal(backfilled.progress!.stage, 'scheduled')
    assert.deepEqual(backfilled.progress!.rounds.slice(1), fourthSnapshot.rounds.slice(1))
    assert.deepEqual(backfilled.progress!.entry, fourthSnapshot.entry)
    assert.equal(backfilled.progress!.candidateAvailability, fourthSnapshot.candidateAvailability)
    assert.equal(backfilled.events.at(-1)!.roundNumber, 1, 'timeline identifies the edited round instead of the latest round')
  }
  for (const result of ['failed', 'no-show', 'withdrawn'] as const) {
    const ended = change(1, { action: 'feedback', roundNumber: 4, notes: `四面 ${result}`, result, next: 'unknown', unresolved: [] })
    assert.equal(ended.progress!.stage, 'closed')
    const corrected = change(1, {
      action: 'feedback',
      roundNumber: 4,
      notes: `补充四面 ${result} 原因`,
      result,
      next: 'unknown',
      unresolved: []
    })
    assert.equal(corrected.progress!.stage, 'closed', 'editing an ended result does not reopen the business')
    const resumed = change(1, { action: 'resume' })
    assert.equal(resumed.progress!.stage, 'next-decision', 'resuming a negative outcome requires an explicit HR next step')
    assert.equal(businessProgressStep(resumed).label, '待确认后续安排')
    assert.equal(resumed.progress!.rounds.length, 4, 'resume does not create a fifth round')
    assert.equal(resumed.progress!.rounds.at(-1)!.decision, result)
  }
  const fifth = change(1, { action: 'schedule', schedule: schedule(5, '2026-09-21T01:00:00.000Z') })
  assert.equal(fifth.progress!.stage, 'scheduled', 'HR can explicitly book another interview after resuming')
  assert.equal(fifth.progress!.rounds.at(-1)!.roundNumber, 5)
  assert.equal(fifth.progress!.rounds[3]!.decision, 'withdrawn', 'previous result remains in history')

  assert.throws(() => change(0, { action: 'schedule', schedule: schedule(3, '2026-09-09T01:00:00.000Z') }), /当前轮次/)
  assert.throws(
    () =>
      repository.advanceBusinessProgress(
        { documentId, reviewId: a.reviewId, expectedRevision: 0, mutationId: randomUUID(), action: 'note', note: 'stale' },
        'test'
      ),
    /更新/
  )
  a = change(0, {
    action: 'schedule',
    schedule: { ...schedule(1, '2026-09-08T01:00:00.000Z'), meetingMethod: 'zoom', meetingUrl: '会议号 123456' }
  })
  a = change(0, {
    action: 'feedback',
    roundNumber: 1,
    notes: '一面通过，客户尚未确认是否需要二面',
    result: 'passed',
    next: 'unknown',
    unresolved: ['高负载设计经验']
  })
  assert.equal(a.progress!.stage, 'next-decision')
  assert.throws(() => change(0, { action: 'start', actualDate: '2026-09-10' }), /双方条件/)
  a = change(0, {
    action: 'feedback',
    roundNumber: 1,
    notes: '客户确认一面通过，需要二面',
    result: 'passed',
    next: 'next-round',
    unresolved: ['高负载设计经验']
  })
  a = change(0, { action: 'schedule', schedule: schedule(2, '2026-09-09T01:00:00.000Z') })
  assert.equal(a.progress!.rounds[1]!.parentInterviewId, a.progress!.rounds[0]!.id)
  assert.deepEqual(a.progress!.rounds[1]!.unresolvedItems, ['高负载设计经验'])
  a = change(0, {
    action: 'feedback',
    roundNumber: 2,
    notes: '二面通过，所有面试结束，客户希望安排进场',
    result: 'passed',
    next: 'entry',
    unresolved: []
  })
  assert.equal(a.progress!.stage, 'entry')
  assert.throws(() => change(0, { action: 'start', actualDate: '2026-09-10' }), /双方条件/)
  a = change(0, {
    action: 'entry',
    entry: {
      ...a.progress!.entry,
      plannedDate: '2026-09-10',
      candidateAccepted: true,
      termsAgreed: true,
      rate: '80万円',
      reportTime: '09:00',
      contact: 'テスト担当'
    }
  })
  const agreedEntry = structuredClone(a.progress!.entry)
  change(0, { action: 'pause', reason: '等待报到确认' })
  const pausedBackfill = change(0, {
    action: 'feedback',
    roundNumber: 1,
    notes: '补录一面评价',
    result: 'passed',
    next: 'unknown',
    unresolved: []
  })
  assert.equal(pausedBackfill.progress!.stage, 'paused')
  assert.equal(pausedBackfill.progress!.resumeStage, 'entry')
  a = change(0, { action: 'resume' })
  assert.equal(a.progress!.stage, 'entry', 'resume preserves an explicitly paused entry stage')
  assert.deepEqual(a.progress!.entry, agreedEntry)
  assert.throws(() => change(0, { action: 'start', actualDate: '2099-01-01' }), /日期/)
  assert.notEqual(repository.getPersonnelWorkspace().states.find((row) => row.documentId === documentId)?.status, 'assigned')
  assert.throws(() => change(0, { action: 'start', actualDate: '2026-09-08' }), /最后一轮/)
  a = change(0, { action: 'start', actualDate: '2026-09-10' })
  assert.equal(a.progress!.stage, 'started')
  assert.equal(repository.getPersonnelWorkspace().states.find((row) => row.documentId === documentId)?.status, 'assigned')
  const startedEntry = structuredClone(a.progress!.entry)
  for (const roundNumber of [1, 2]) {
    a = change(0, {
      action: 'feedback',
      roundNumber,
      notes: `进场后补录第 ${roundNumber} 轮的客户原始反馈`,
      result: 'passed',
      next: 'unknown',
      unresolved: []
    })
    assert.equal(a.progress!.stage, 'started')
    assert.equal(a.status, 'closed')
    assert.deepEqual(a.progress!.entry, startedEntry, 'arrival and all agreed terms survive historical feedback')
    assert.equal(repository.getPersonnelWorkspace().states.find((row) => row.documentId === documentId)?.status, 'assigned')
  }

  assert.equal(
    repository.listBusinessFollowUps().filter((row) => row.progress?.stage === 'scheduled').length,
    2,
    'other cases remain unchanged'
  )
  change(1, { action: 'pause', reason: '人员在第一案件进场，HR选择暂缓此案件' })
  change(2, { action: 'coordinate', candidateAvailability: '下周仍可面试', clientAvailability: '客户待回复', pendingConditions: [] })
  const beforeReopen = repository.listBusinessFollowUps()
  repository.close()
  repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  assert.deepEqual(repository.listBusinessFollowUps(), beforeReopen, 'all rounds and independent decisions survive restart')
  const job = jobs[2]!
  const mail = {
    accountEmail: 'hr@example.com',
    messageId: 'progress-test-1',
    threadId: 'progress-thread',
    subject: '面談日程確定',
    body: '第三案件面談の日時確定は9月15日14時です。',
    receivedAt: '2026-09-10T06:00:00.000Z'
  }
  assert.equal(repository.captureBusinessProgressMail(mail), true)
  assert.equal(repository.captureBusinessProgressMail(mail), true)
  assert.equal(repository.listBusinessProgressMail().length, 1, 'duplicates are handled without adding another message')
  assert.equal(
    repository.captureBusinessProgressMail({
      ...mail,
      messageId: 'normal-job',
      subject: 'Java案件募集',
      body: '面談1回、入場9月、Java経験3年'
    }),
    false,
    'case listing must not become a followup message'
  )
  assert.equal(
    repository.captureBusinessProgressMail({
      ...mail,
      messageId: 'normal-job-web',
      subject: 'Java 案件募集',
      body: '面談：1回 Web可能。入場：9月。単価80万円。'
    }),
    false,
    'normal Web-available interview requirement stays a case'
  )
  let inbox = repository.listBusinessProgressMail()[0]!
  assert.equal(inbox.followUpId, null, 'ambiguous messages do not attach automatically')
  const third = repository.listBusinessFollowUps().find((row) => row.reviewId === job.reviewId)!
  repository.updateBusinessProgressMail({ id: inbox.id, followUpId: third.id })
  const sourceInput = {
    documentId,
    reviewId: third.reviewId,
    expectedRevision: third.revision,
    mutationId: randomUUID(),
    sourceMessageId: inbox.id,
    action: 'schedule' as const,
    schedule: schedule(1, '2026-09-15T05:00:00.000Z')
  }
  repository.advanceBusinessProgress(sourceInput, 'test-hr')
  assert.equal(repository.listBusinessProgressMail()[0]!.state, 'applied', 'mail and schedule are applied atomically')
  assert.equal(repository.advanceBusinessProgress(sourceInput, 'test-hr').revision, third.revision + 1)
  // Same-round no-show recovery keeps the prior appointment and result in the event.
  change(1, { action: 'resume' })
  let retry = repository.listBusinessFollowUps().find((row) => row.reviewId === pairs[1]!.reviewId)!
  const retryRound = retry.progress!.rounds.at(-1)!.roundNumber
  retry = change(1, {
    action: 'feedback',
    roundNumber: retryRound,
    notes: '客户临时缺席',
    result: 'no-show',
    next: 'unknown',
    unresolved: []
  })
  const missed = structuredClone(retry.progress!.rounds.at(-1)!)
  retry = change(1, { action: 'rebook', schedule: schedule(retryRound, '2026-09-19T01:00:00.000Z'), reason: '客户请求同一轮改期' })
  assert.equal(retry.progress!.rounds.length, retryRound)
  assert.equal(retry.progress!.rounds.at(-1)!.decision, null)
  assert.deepEqual(retry.events.at(-1)!.previousInterview, missed)
  assert.equal(retry.progress!.stage, 'scheduled')
  retry = change(1, { action: 'cancel-schedule', reason: '双方时间需要再确认' })
  assert.equal(retry.progress!.stage, 'coordinating')
  assert.equal(retry.progress!.rounds.at(-1)!.scheduledAt, null)
  assert.equal(retry.events.at(-1)!.previousInterview!.scheduledAt, '2026-09-19T01:00:00.000Z')
  retry = change(1, { action: 'schedule', schedule: schedule(retryRound, '2026-09-09T01:00:00.000Z') })
  assert.equal(retry.progress!.rounds.length, retryRound)

  a = change(0, {
    action: 'correct-entry',
    entry: { ...startedEntry, rate: '85万円', contact: '订正后的联系人' },
    reason: '合同单价与联系人录入错误'
  })
  assert.equal(a.progress!.stage, 'started')
  assert.equal(a.progress!.entry.rate, '85万円')
  assert.deepEqual(a.events.at(-1)!.previousEntry, startedEntry)
  assert.equal(a.events.at(-1)!.entry!.rate, '85万円')
  assert.throws(
    () => change(0, { action: 'correct-entry', entry: { ...a.progress!.entry, actualDate: '2099-01-01' }, reason: '错误日期' }),
    /日期/
  )
  const baselineStatus = a.progress!.previousBusinessStatus ?? 'available'
  retry = change(1, {
    action: 'feedback',
    roundNumber: retryRound,
    notes: '复约通过且全部面试完成',
    result: 'passed',
    next: 'entry',
    unresolved: []
  })
  retry = change(1, { action: 'entry', entry: { ...retry.progress!.entry, candidateAccepted: true, termsAgreed: true } })
  retry = change(1, { action: 'start', actualDate: '2026-09-10' })
  assert.equal(retry.progress!.previousBusinessStatus, baselineStatus, 'second placement inherits original availability baseline')
  a = change(0, { action: 'undo-start', reason: '第一案件还没有实际报到' })
  assert.equal(a.progress!.stage, 'entry')
  assert.equal(a.progress!.entry.actualDate, null)
  assert.equal(
    repository.getPersonnelWorkspace().states.find((row) => row.documentId === documentId)?.status,
    'assigned',
    'another active placement retains assigned status'
  )
  change(1, { action: 'undo-start', reason: '第二案件也误记到岗' })
  assert.equal(
    repository.getPersonnelWorkspace().states.find((row) => row.documentId === documentId)?.status,
    baselineStatus,
    'last undo restores baseline even when undone out of order'
  )
  const setStatus = (status: 'available' | 'soon' | 'assigned' | 'paused') => {
    const person = repository.getCandidateReview(documentId)!
    repository.setCandidateBusinessState(
      { documentId, profileVersion: person.profile?.version ?? 0, reviewRevision: person.reviewRevision, status, confirmed: true },
      'test-hr'
    )
  }
  setStatus('soon')
  change(0, { action: 'start', actualDate: '2026-09-10' })
  change(0, { action: 'undo-start', reason: '测试即将可用状态恢复' })
  assert.equal(repository.getPersonnelWorkspace().states.find((row) => row.documentId === documentId)?.status, 'soon')
  setStatus('assigned')
  change(0, { action: 'start', actualDate: '2026-09-10' })
  change(0, { action: 'undo-start', reason: '原本已在其他系统营业中' })
  assert.equal(
    repository.getPersonnelWorkspace().states.find((row) => row.documentId === documentId)?.status,
    'assigned',
    'manually assigned baseline is preserved'
  )
  setStatus('available')
  change(0, { action: 'start', actualDate: '2026-09-10' })
  setStatus('paused')
  change(0, { action: 'undo-start', reason: 'HR已另行暂停推广' })
  assert.equal(
    repository.getPersonnelWorkspace().states.find((row) => row.documentId === documentId)?.status,
    'paused',
    'later HR state edit is not overwritten'
  )

  // Mail updates operate on the existing profile and survive retry/restart.
  const editRate = (rate: string, actor: string) => {
    const profile = repository.getCurrentCandidateProfile(documentId)!
    return repository.updateCandidateProfile(
      {
        sourceDocumentId: documentId,
        expectedVersion: profile.profileVersion,
        identity: profile.localPersonalDetails,
        fields: profile.fields.map((field) => ({ key: field.key, value: field.key === 'rate' ? rate : field.value })),
        projectExperiences: profile.projectExperiences
      },
      actor,
      actor
    )
  }
  editRate('90万円', '本机导入')
  const mailConditions = {
    accountEmail: 'hr@example.com',
    messageId: 'conditions-1',
    documentIds: [documentId],
    receivedAt: '2026-09-10T01:00:00.000Z',
    subject: '要員単価更新',
    evidence: '単価：75万円',
    conditions: [{ field: 'rate', value: '75万円' }],
    ambiguous: false
  }
  assert.equal(repository.mergePersonnelMailConditions(mailConditions), 1)
  assert.equal(repository.mergePersonnelMailConditions(mailConditions), 0, 'same mail never applies twice')
  assert.equal(repository.getCurrentCandidateProfile(documentId)!.fields.find((field) => field.key === 'rate')!.value, '75万円')
  editRate('88万円', 'test-hr')
  assert.equal(
    repository.mergePersonnelMailConditions({
      ...mailConditions,
      messageId: 'conditions-2',
      receivedAt: '2026-09-10T02:00:00.000Z',
      conditions: [{ field: 'rate', value: '80万円' }]
    }),
    0
  )
  let update = repository.listPersonnelMailUpdates(documentId).find((row) => row.status === 'pending')!
  assert.equal(update.reason, 'manual-conflict')
  assert.equal(update.previousValue, '88万円')
  assert.throws(
    () => repository.resolvePersonnelMailUpdate({ id: update.id, action: 'apply', expectedVersion: 1 }, 'test-hr'),
    /资料已更新/
  )
  const mailBeforeRestart = repository.listPersonnelMailUpdates(documentId)
  repository.close()
  repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  assert.deepEqual(repository.listPersonnelMailUpdates(documentId), mailBeforeRestart)
  repository.resolvePersonnelMailUpdate(
    { id: update.id, action: 'apply', expectedVersion: repository.getCurrentCandidateProfile(documentId)!.profileVersion },
    'test-hr'
  )
  assert.equal(repository.getCurrentCandidateProfile(documentId)!.fields.find((field) => field.key === 'rate')!.value, '80万円')
  assert.equal(
    repository.mergePersonnelMailConditions({ ...mailConditions, messageId: 'older-mail', receivedAt: '2026-09-09T01:00:00.000Z' }),
    0
  )
  assert.equal(repository.listPersonnelMailUpdates(documentId).find((row) => row.receivedAt.startsWith('2026-09-09'))!.status, 'superseded')
  repository.mergePersonnelMailConditions({
    ...mailConditions,
    messageId: 'ambiguous-mail',
    receivedAt: '2026-09-10T03:00:00.000Z',
    ambiguous: true
  })
  update = repository.listPersonnelMailUpdates(documentId).find((row) => row.status === 'pending')!
  assert.equal(update.reason, 'multiple-people')
  assert.throws(
    () =>
      repository.resolvePersonnelMailUpdate(
        { id: update.id, action: 'apply', expectedVersion: repository.getCurrentCandidateProfile(documentId)!.profileVersion },
        'test-hr'
      ),
    /多个人员/
  )
  repository.resolvePersonnelMailUpdate(
    { id: update.id, action: 'dismiss', expectedVersion: repository.getCurrentCandidateProfile(documentId)!.profileVersion },
    'test-hr'
  )
  assert.equal(repository.getCurrentCandidateProfile(documentId)!.fields.find((field) => field.key === 'rate')!.value, '80万円')
  const recovered = repository.listBusinessFollowUps().find((row) => row.reviewId === pairs[1]!.reviewId)!
  assert.ok(
    recovered.events.some((event) => event.previousInterview?.decision === 'no-show'),
    'rebooking audit survives restart'
  )
  // A single duplicate follow-up can be removed without touching the person, the case or the other follow-ups.
  const removable = repository.listBusinessFollowUps().find((row) => row.progress?.stage !== 'started' && row.progress?.rounds.length)!
  const followUpsBefore = repository.listBusinessFollowUps().length,
    roundIds = removable.progress!.rounds.map((round) => round.id)
  assert.throws(() => repository.deleteBusinessFollowUp({ followUpId: removable.id, expectedRevision: removable.revision + 1 }), /已更新/)
  const started = repository.listBusinessFollowUps().find((row) => row.progress?.stage === 'started')
  if (started)
    assert.throws(() => repository.deleteBusinessFollowUp({ followUpId: started.id, expectedRevision: started.revision }), /撤销进场/)
  const linkedMails = repository.listBusinessProgressMail().filter((mail) => mail.followUpId === removable.id).length
  assert.deepEqual(repository.deleteBusinessFollowUp({ followUpId: removable.id, expectedRevision: removable.revision }), {
    deletedId: removable.id,
    rounds: roundIds.length,
    mails: linkedMails
  })
  assert.equal(repository.listBusinessFollowUps().length, followUpsBefore - 1)
  assert.ok(!repository.listCandidateInterviews().some((round) => roundIds.includes(round.id)), 'rounds are removed with their follow-up')
  assert.ok(repository.getCandidateReview(documentId), 'the person stays')
  const deletion = repository.previewCandidateDeletion(documentId)
  repository.deleteCandidateDatabaseData(documentId, deletion.confirmationHash)
  assert.equal(repository.listPersonnelMailUpdates(documentId).length, 0, 'mail condition records are deleted with personnel')
  assert.equal(repository.listBusinessFollowUps().length, 0)
  assert.equal(repository.listCandidateInterviews().length, 0)
  assert.equal(repository.listBusinessProgressMail().length, 0, 'associated local mail is deleted with personnel')
  // Working set: explicit HR membership, survives restart, never marks a case unread, and an invalid case leaves it.
  const workingCase = pairs[0]!.reviewId,
    feedCase = () => repository.getBusinessFeed().find((entry) => entry.kind === 'case' && entry.objectId === workingCase)!
  assert.equal(feedCase().working, false, 'new cases are not added automatically')
  const beforeWorking = feedCase().revision
  assert.deepEqual(repository.setCaseWorking({ reviewId: workingCase, working: true }, 'HR'), { reviewId: workingCase, working: true })
  repository.setCaseWorking({ reviewId: workingCase, working: true }, 'HR')
  assert.equal(feedCase().working, true)
  assert.equal(feedCase().revision, beforeWorking, 'membership does not change the feed revision')
  repository.close()
  repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
  assert.equal(feedCase().working, true, 'working set survives restart')
  repository.setCaseWorking({ reviewId: workingCase, working: false }, 'HR')
  assert.equal(feedCase().working, false)
  repository.setCaseWorking({ reviewId: workingCase, working: true }, 'HR')
  repository.setJobCaseLifecycle({ reviewId: workingCase, state: 'archived', reason: '案件已结束' }, 'HR')
  assert.equal(feedCase().working, false, 'an invalid case leaves the working set')
  assert.throws(() => repository.setCaseWorking({ reviewId: workingCase, working: true }, 'HR'), /无效案件/)
  repository.setJobCaseLifecycle({ reviewId: workingCase, state: 'active', reason: '案件重新开始' }, 'HR')
  assert.equal(feedCase().working, false, 'restoring does not re-add the case')
  assert.equal(currentSchemaVersion, 66)
  console.log(
    JSON.stringify({
      status: 'passed',
      schema: currentSchemaVersion,
      verified: [
        'populated v48 migration',
        'one person in three cases',
        'independent first rounds',
        'overlap allowed',
        'free-form arrangement and restart',
        'direct second and third rounds without prior feedback',
        'next round after an undecided next step',
        'historical feedback preserves current stage and appointment',
        'resume negative results requires HR decision',
        'entry details survive pause, backfill and restart',
        'second-round inheritance',
        'unknown next step',
        'entry prerequisites',
        'explicit actual arrival',
        'other cases remain open',
        'revision and duplicate delivery',
        'encrypted restart',
        'mail ambiguity/dedup/atomic apply',
        'same-round rebooking and cancellation history',
        'entry correction with before and after',
        'undo arrival preserves other placements and HR status',
        'mail conditions merge and explicit HR conflicts',
        'mail chronology and attribution',
        'deletion cascade',
        'case working set'
      ]
    })
  )
} finally {
  repository.close()
  await rm(temporaryDirectory, { recursive: true, force: true })
}
