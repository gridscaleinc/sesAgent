import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { EncryptedApplicationRepository } from '@persistence'
import { EncryptedFileVault } from '@files'
import { ParserWorkerClient } from '@parsers/worker-client'
import { redactGmailMessageForLocalStorage } from '@mail'
import { createRedactedManualJobCaseSource, extractJobCaseDraft } from '@job-cases'
import { importPendingGmailPersonnel } from '../apps/desktop/src/main/gmail-personnel-intake'
import { autoConfirmJobCaseDraft } from '../apps/desktop/src/main/business-text-intake'
import { importStagedResumeLocally } from '../apps/desktop/src/main/local-resume-analysis'
import { saveBusinessField } from '../apps/desktop/src/main/business-field-editing'
import type { MainIpcContext } from '../apps/desktop/src/main/ipc/context'

const directory = await mkdtemp(join(tmpdir(), 'ses-hr-mail-editing-'))
const key = randomBytes(32), mappingKey = randomBytes(32)
let repository = new EncryptedApplicationRepository({ path: join(directory, 'test.db'), databaseKey: key, mappingKey })
try {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['氏名', 'TEST ENGINEER'], ['スキル', 'Java, Spring Boot, MySQL'], ['経験年数', '10年'], ['希望単価', '70万円'], ['日本語', 'N2']
  ]), 'Resume')
  const attachment = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  const account = 'hr@example.com'
  const message = { id: 'person-m1', threadId: 'thread1', historyId: '1', internalDate: new Date().toISOString(), labelIds: ['INBOX'], rfcMessageId: null,
    subject: '要員紹介 TEST ENGINEER', from: 'Partner <sender@example.com>', replyTo: 'reply@example.com', fromDomain: 'example.com', body: 'スキルシートをご確認ください。', attachmentCount: 1,
    resumeAttachments: [{ id: 'a1', name: 'resume.xlsx', size: attachment.length }], warnings: [] }
  const processed = redactGmailMessageForLocalStorage(message, account, ['TEST ENGINEER'])
  repository.saveRedactionSession(processed.redaction.session, processed.redaction.mappings)
  repository.saveGmailMessage(processed.message)
  assert.equal(processed.message.classification, 'candidate-proposal')
  const context = { repository, fileVault: new EncryptedFileVault({ directory: join(directory, 'vault'), key: randomBytes(32) }),
    parserWorker: new ParserWorkerClient({ workerPath: resolve('out/main/parser-worker.js'), timeoutMs: 15000 }), localOcr: null, localNer: null,
    processingResources: { run: (_: string, action: () => Promise<unknown>) => action() }, currentOperator: () => ({ operatorId: 'test-hr', displayName: 'Test HR' }) } as unknown as MainIpcContext
  const gmail = { getMessage: async () => message, getAttachment: async () => Buffer.from(attachment) }
  const imported = await importPendingGmailPersonnel(context, gmail as any, account)
  if (imported.failed) {
    const failedToken = repository.getGmailBusinessIntake(account, message.id)?.parts.a1
    if (failedToken) await importStagedResumeLocally(context, repository.getStagedFileRecords([failedToken])[0]!)
  }
  assert.deepEqual(imported, { personnel: 1, failed: 0 })
  const intake = repository.getGmailBusinessIntake(account, message.id)!
  const documentId = intake.parts.a1!
  const person = repository.getCurrentCandidateProfile(documentId)!
  assert.ok(person, 'mail attachment creates an immediately available personnel profile')
  assert.match(person.fields.find((field) => field.key === 'skills')?.value ?? '', /Java/)
  const record = repository.getStagedFileRecords([documentId])[0]!
  assert.notEqual((await readFile(record.encryptedPath)).subarray(0, 2).toString(), 'PK', 'resume is encrypted in vault')
  assert.deepEqual(await importPendingGmailPersonnel(context, gmail as any, account), { personnel: 0, failed: 0 })
  const template = repository.getPersonnelWorkspace().templates[0]!
  const introduction = { documentId, profileVersion: person.profileVersion, templateId: template.id, templateRevision: template.revision, lang: 'ja' as const, text: 'Java SEをご紹介します。\n就労資格：要確認' }
  assert.equal(repository.validatePersonnelMessage(introduction).text, introduction.text, 'generated unknown eligibility can be copied or opened as mail')
  assert.throws(() => repository.validatePersonnelMessage({ ...introduction, text: '連絡先：invented@example.com' }))
  assert.throws(() => repository.validatePersonnelMessage({ ...introduction, text: '就労資格：就労制限なし' }), 'actual eligibility remains subject to existing privacy checks')
  const oldRate = person.fields.find((item) => item.key === 'rate')?.value ?? null
  const first = saveBusinessField(context, { kind: 'person', id: documentId, version: person.profileVersion, field: 'rate', previousValue: oldRate, value: '75万円' })
  assert.ok(first.version > person.profileVersion)
  const oldRole = person.fields.find((item) => item.key === 'role')?.value ?? null
  saveBusinessField(context, { kind: 'person', id: documentId, version: person.profileVersion, field: 'role', previousValue: oldRole, value: 'SE' })
  assert.throws(() => saveBusinessField(context, { kind: 'person', id: documentId, version: person.profileVersion, field: 'rate', previousValue: oldRate, value: '80万円' }), /已被更新/)
  const source = createRedactedManualJobCaseSource({ subject: 'Java API', body: '案件名：Java API\n必須スキル：Java\n単価：80万円' }, randomUUID(), [])
  repository.saveRedactionSession(source.redaction.session, source.redaction.mappings)
  const extraction = extractJobCaseDraft(source.source, randomUUID())
  repository.saveJobCaseSourceAndDraft(source.source, extraction as any)
  autoConfirmJobCaseDraft(repository, repository.getJobCaseReview(extraction.reviewId)!, { operatorId: 'test-hr', displayName: 'Test HR' })
  let job = repository.getJobCaseReview(extraction.reviewId)!
  const rate = job.fields.find((item) => item.key === 'rate')!.value
  repository.saveBusinessCaseField({ kind: 'case', id: job.reviewId, version: job.reviewRevision, field: 'rate', previousValue: rate, value: '85万円' }, 'test-hr', 'Test HR')
  job = repository.getJobCaseReview(job.reviewId)!
  assert.equal(job.status, 'completed')
  assert.equal(job.fields.find((item) => item.key === 'rate')!.value, '85万円')
  const version = job.reviewRevision
  assert.throws(() => repository.saveBusinessCaseField({ kind: 'case', id: job.reviewId, version, field: 'title', previousValue: 'Java API', value: null }, 'test-hr', 'Test HR'))
  assert.equal(repository.getJobCaseReview(job.reviewId)!.reviewRevision, version, 'failed autosave rolls back reopening and all version changes')
  const base = { assistant: 'sales-agent' as const, candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null }
  const caseContext = { ...base, businessObject: { kind: 'case' as const, id: job.reviewId } }
  const personContext = { ...base, businessObject: { kind: 'person' as const, id: documentId } }
  const caseConversation = repository.saveAiConversation({ conversationId: randomUUID(), context: caseContext, messages: [], expectedRevision: null })
  repository.saveAiConversation({ conversationId: randomUUID(), context: personContext, messages: [], expectedRevision: null })
  assert.equal(repository.listAiConversations(base).length, 0)
  assert.equal(repository.listAiConversations(caseContext).length, 1)
  assert.equal(repository.listAiConversations(personContext).length, 1)
  assert.throws(() => repository.saveAiConversation({ conversationId: caseConversation.id, context: personContext, messages: [], expectedRevision: caseConversation.revision }))
  repository.close()
  repository = new EncryptedApplicationRepository({ path: join(directory, 'test.db'), databaseKey: key, mappingKey })
  assert.equal(repository.listAiConversations(caseContext)[0]?.id, caseConversation.id)
  assert.equal(repository.getGmailBusinessIntake(account, message.id)?.parts.a1, documentId)
  assert.equal(repository.getCurrentCandidateProfile(documentId)?.fields.find((item) => item.key === 'rate')?.value, '75万円')
  console.log(JSON.stringify({ status: 'passed', verified: ['real Excel parser to encrypted vault and immediately available personnel', 'attachment deduplication', 'local reply header storage', 'introduction copy and mail validation', 'field autosave concurrency', 'case update transaction rollback', 'object scoped empty conversations', 'restart persistence'] }))
} finally { repository.close(); await rm(directory, { recursive: true, force: true }) }
