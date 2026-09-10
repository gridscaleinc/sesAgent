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
import { businessProgressStep, builtInPersonnelTemplates, generatePersonnelMessage, type ProgressCommand, type BusinessFollowUp, type ResumeAnalysisSummary } from '@shared'
import type { DocumentIR } from '@parsers'

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ses-progress-verification-'))
const databasePath = join(temporaryDirectory, 'verification.db')
const databaseKey = randomBytes(32)
const mappingKey = randomBytes(32)
const documentId = '559dcb5d-dcf0-4c11-a12d-698cfef220e6'
const mappingSentinel = 'TEST_PRIVATE_NAME'
let repository = new EncryptedApplicationRepository({ path: databasePath, databaseKey, mappingKey })
try {
  const redaction = redactTextForCloud(mappingSentinel, { sourceVersion: 'business-test:v1', knownPersonNames: [mappingSentinel], personNameReviewCompleted: true, sessionId: 'b0d9223d-fcab-49d6-bc1c-4d0c7dcd1318' })
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

  const legacy = repository.saveCandidateInterviewSchedule({sourceDocumentId:documentId,kind:'client',roundNumber:1,scheduledAt:'2026-09-01T01:00:00.000Z',durationMinutes:60,meetingMethod:'onsite',interviewer:'旧记录',contactNote:'保留以前的客户面试'},'test-hr')
  repository.close()
  const legacyDb = new Database(databasePath)
  legacyDb.pragma("cipher='sqlcipher'"); legacyDb.pragma('legacy=4'); legacyDb.key(databaseKey)
  legacyDb.pragma('foreign_keys=OFF')
  legacyDb.exec('DROP INDEX candidate_interview_legacy_round_idx; DROP INDEX candidate_interview_business_round_idx; ALTER TABLE candidate_interview_sessions DROP COLUMN business_followup_id; CREATE UNIQUE INDEX legacy_round_idx ON candidate_interview_sessions(source_document_id,kind,round_number); DROP TABLE business_progress_mail; DELETE FROM schema_migrations WHERE version=49;')
  legacyDb.close()
  repository = new EncryptedApplicationRepository({path:databasePath,databaseKey,mappingKey})
  assert.equal(repository.listCandidateInterviews()[0]!.id,legacy.id,'v48 migration preserves the existing interview identity')
  assert.equal(repository.listCandidateInterviews()[0]!.contactNote,'保留以前的客户面试')
  assert.equal(repository.listCandidateInterviews()[0]!.businessFollowUpId,null,'migration does not guess an old interview case')
  const jobs = ['Java 第一案件','Java 第二案件','Java 第三案件'].map((title) => {
    const source = createRedactedManualJobCaseSource({ subject:title,body:'必須スキル：Java / SQL\n勤務地：東京' },randomUUID(),[])
    const draft = extractJobCaseDraft(source.source,randomUUID())
    repository.saveRedactedJobCaseSourceAndDraft(source.redaction.session,source.redaction.mappings,source.source,draft)
    return repository.getJobCaseReview(draft.reviewId)!
  })
  const pairs = jobs.map((job) => ({documentId,reviewId:job.reviewId,pendingConditions:['通勤条件を確認']}))
  const revisionBefore = repository.getLocalDataRevision().revision
  let records = repository.beginBusinessProgress(pairs,'test-hr')
  assert.equal(records.length,3)
  assert.equal(repository.beginBusinessProgress(pairs,'test-hr').length,3)
  assert.equal(repository.listBusinessFollowUps().length,3,'one persistent relationship per person and case')
  assert.ok(repository.getLocalDataRevision().revision > revisionBefore)
  const change = (index:number, command:ProgressCommand) => {
    const item=repository.listBusinessFollowUps().find((row)=>row.reviewId===pairs[index]!.reviewId)!
    const input={documentId,reviewId:item.reviewId,expectedRevision:item.revision,mutationId:randomUUID(),...command}
    const result=repository.advanceBusinessProgress(input,'test-hr')
    assert.equal(repository.advanceBusinessProgress(input,'test-hr').revision,result.revision,'duplicate delivery is idempotent')
    return result
  }
  const schedule = (roundNumber:number, scheduledAt:string) => ({roundNumber,scheduledAt,durationMinutes:60,meetingMethod:'onsite' as const,meetingUrl:'',location:'東京',interviewer:'検証担当',note:'業務フロー検証'})
  for (const meetingUrl of ['', '会议号 123456，密码稍后告知', 'http://example.com/meeting', 'https://teams.microsoft.com/meeting', '说明'.repeat(1100)]) {
    const saved=change(0,{action:'schedule',schedule:{...schedule(1,''),meetingMethod:'zoom',meetingUrl,interviewer:'',note:'备注'.repeat(1000)}})
    assert.equal(saved.progress!.stage,'coordinating')
    assert.equal(saved.progress!.rounds[0]!.meetingUrl,meetingUrl||null)
    assert.equal(saved.progress!.rounds[0]!.scheduledAt,null)
    assert.equal(saved.progress!.rounds[0]!.contactNote,'备注'.repeat(1000))
    repository.close();repository=new EncryptedApplicationRepository({path:databasePath,databaseKey,mappingKey})
    assert.deepEqual(repository.listBusinessFollowUps().find(row=>row.id===saved.id),saved,'free-form arrangement survives restart')
  }
  let a=change(0,{action:'schedule',schedule:schedule(1,'2026-09-08T01:00:00.000Z')})
  assert.equal(change(1,{action:'schedule',schedule:schedule(1,'2026-09-08T01:30:00.000Z')}).progress!.stage,'scheduled','overlapping appointments can be saved by HR')
  change(1,{action:'schedule',schedule:schedule(1,'2026-09-08T02:00:00.000Z')})
  change(2,{action:'schedule',schedule:schedule(1,'2026-09-08T03:00:00.000Z')})
  assert.equal(repository.listCandidateInterviews().filter((row)=>row.businessFollowUpId).length,3,'three independent first rounds')
  const firstRound=structuredClone(repository.listBusinessFollowUps().find(row=>row.reviewId===pairs[1]!.reviewId)!.progress!.rounds[0]!)
  for (const roundNumber of [2,3]) {
    const booked=change(1,{action:'schedule',schedule:schedule(roundNumber,`2026-09-${14+roundNumber}T01:00:00.000Z`)})
    assert.equal(booked.progress!.rounds.length,roundNumber,'new appointment is a distinct round')
    assert.equal(businessProgressStep(booked,new Date('2026-09-10T00:00:00Z')).label,`${roundNumber} 面已预约`)
    assert.deepEqual(booked.progress!.rounds[0],firstRound,'earlier appointment and unknown result remain untouched')
    assert.equal(booked.progress!.rounds.at(-1)!.parentInterviewId,booked.progress!.rounds.at(-2)!.id)
    repository.close();repository=new EncryptedApplicationRepository({path:databasePath,databaseKey,mappingKey})
    assert.deepEqual(repository.listBusinessFollowUps().find(row=>row.id===booked.id),booked,'round number survives restart')
  }
  change(1,{action:'feedback',roundNumber:3,notes:'三面通过，客户后续安排待定',result:'passed',next:'unknown',unresolved:['现场安排']})
  const fourth=change(1,{action:'schedule',schedule:schedule(4,'2026-09-20T01:00:00.000Z')})
  assert.equal(fourth.progress!.rounds.at(-1)!.roundNumber,4,'HR can book next round without another next-step gate')
  assert.equal(fourth.progress!.rounds[2]!.decision,'passed','existing explicit outcome is preserved')

  assert.throws(()=>change(0,{action:'schedule',schedule:schedule(3,'2026-09-09T01:00:00.000Z')}),/当前轮次/)
  assert.throws(()=>repository.advanceBusinessProgress({documentId,reviewId:a.reviewId,expectedRevision:0,mutationId:randomUUID(),action:'note',note:'stale'},'test'),/更新/)
  a=change(0,{action:'schedule',schedule:{...schedule(1,'2026-09-08T01:00:00.000Z'),meetingMethod:'zoom',meetingUrl:'会议号 123456'}})
  a=change(0,{action:'feedback',roundNumber:1,notes:'一面通过，客户尚未确认是否需要二面',result:'passed',next:'unknown',unresolved:['高负载设计经验']})
  assert.equal(a.progress!.stage,'next-decision')
  assert.throws(()=>change(0,{action:'start',actualDate:'2026-09-10'}),/双方条件/)
  a=change(0,{action:'feedback',roundNumber:1,notes:'客户确认一面通过，需要二面',result:'passed',next:'next-round',unresolved:['高负载设计经验']})
  a=change(0,{action:'schedule',schedule:schedule(2,'2026-09-09T01:00:00.000Z')})
  assert.equal(a.progress!.rounds[1]!.parentInterviewId,a.progress!.rounds[0]!.id)
  assert.deepEqual(a.progress!.rounds[1]!.unresolvedItems,['高负载设计经验'])
  a=change(0,{action:'feedback',roundNumber:2,notes:'二面通过，所有面试结束，客户希望安排进场',result:'passed',next:'entry',unresolved:[]})
  assert.equal(a.progress!.stage,'entry')
  assert.throws(()=>change(0,{action:'start',actualDate:'2026-09-10'}),/双方条件/)
  a=change(0,{action:'entry',entry:{...a.progress!.entry,plannedDate:'2026-09-10',candidateAccepted:true,termsAgreed:true,rate:'80万円',reportTime:'09:00',contact:'テスト担当'}})
  assert.throws(()=>change(0,{action:'start',actualDate:'2099-01-01'}),/日期/)
  assert.notEqual(repository.getPersonnelWorkspace().states.find((row)=>row.documentId===documentId)?.status,'assigned')
  assert.throws(()=>change(0,{action:'start',actualDate:'2026-09-08'}),/最后一轮/)
  a=change(0,{action:'start',actualDate:'2026-09-10'})
  assert.equal(a.progress!.stage,'started')
  assert.equal(repository.getPersonnelWorkspace().states.find((row)=>row.documentId===documentId)?.status,'assigned')
  assert.equal(repository.listBusinessFollowUps().filter((row)=>row.progress?.stage==='scheduled').length,2,'other cases remain unchanged')
  change(1,{action:'pause',reason:'人员在第一案件进场，HR选择暂缓此案件'})
  change(2,{action:'coordinate',candidateAvailability:'下周仍可面试',clientAvailability:'客户待回复',pendingConditions:[]})
  const beforeReopen=repository.listBusinessFollowUps()
  repository.close();repository=new EncryptedApplicationRepository({path:databasePath,databaseKey,mappingKey})
  assert.deepEqual(repository.listBusinessFollowUps(),beforeReopen,'all rounds and independent decisions survive restart')
  const job = jobs[2]!
  const mail={accountEmail:'hr@example.com',messageId:'progress-test-1',threadId:'progress-thread',subject:'面談日程確定',body:'第三案件面談の日時確定は9月15日14時です。',receivedAt:'2026-09-10T06:00:00.000Z'}
  assert.equal(repository.captureBusinessProgressMail(mail),true)
  assert.equal(repository.captureBusinessProgressMail(mail),true)
  assert.equal(repository.listBusinessProgressMail().length,1,'duplicates are handled without adding another message')
  assert.equal(repository.captureBusinessProgressMail({...mail,messageId:'normal-job',subject:'Java案件募集',body:'面談1回、入場9月、Java経験3年'}),false,'case listing must not become a followup message')
  assert.equal(repository.captureBusinessProgressMail({...mail,messageId:'normal-job-web',subject:'Java 案件募集',body:'面談：1回 Web可能。入場：9月。単価80万円。'}),false,'normal Web-available interview requirement stays a case')
  let inbox=repository.listBusinessProgressMail()[0]!
  assert.equal(inbox.followUpId,null,'ambiguous messages do not attach automatically')
  const third=repository.listBusinessFollowUps().find((row)=>row.reviewId===job.reviewId)!
  repository.updateBusinessProgressMail({id:inbox.id,followUpId:third.id})
  const sourceInput={documentId,reviewId:third.reviewId,expectedRevision:third.revision,mutationId:randomUUID(),sourceMessageId:inbox.id,action:'schedule' as const,schedule:schedule(1,'2026-09-15T05:00:00.000Z')}
  repository.advanceBusinessProgress(sourceInput,'test-hr')
  assert.equal(repository.listBusinessProgressMail()[0]!.state,'applied','mail and schedule are applied atomically')
  assert.equal(repository.advanceBusinessProgress(sourceInput,'test-hr').revision,third.revision+1)
  const deletion=repository.previewCandidateDeletion(documentId)
  repository.deleteCandidateDatabaseData(documentId,deletion.confirmationHash)
  assert.equal(repository.listBusinessFollowUps().length,0)
  assert.equal(repository.listCandidateInterviews().length,0)
  assert.equal(repository.listBusinessProgressMail().length,0,'associated local mail is deleted with personnel')
  assert.equal(currentSchemaVersion,49)
  console.log(JSON.stringify({status:'passed',schema:currentSchemaVersion,verified:['populated v48 migration','one person in three cases','independent first rounds','overlap allowed', 'free-form arrangement and restart','direct second and third rounds without prior feedback', 'next round after an undecided next step', 'second-round inheritance','unknown next step','entry prerequisites','explicit actual arrival','other cases remain open','revision and duplicate delivery','encrypted restart','mail ambiguity/dedup/atomic apply','deletion cascade']}))
} finally {
  repository.close()
  await rm(temporaryDirectory,{recursive:true,force:true})
}
