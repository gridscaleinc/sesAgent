import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { createWorkTaskPreview, getDataScope, materializeWorkTask } from '@application'
import { EncryptedFileVault } from '@files'
import { createRedactedManualJobCaseSource, createGmailJobCaseSource, extractJobCaseDraft } from '@job-cases'
import { EncryptedApplicationRepository, DuplicateCandidateError } from '@persistence'
import { redactTextForCloud } from '@privacy'
import { extractCandidateDraft } from '@resume'
import { importChatPastedJobCaseText, importPastedCandidateText } from '../apps/desktop/src/main/business-text-intake'

const directory = await mkdtemp(join(tmpdir(), 'ses-intake-dedup-'))
const path = join(directory, 'test.db'),
  databaseKey = randomBytes(32),
  mappingKey = randomBytes(32)
const vault = new EncryptedFileVault({ directory: join(directory, 'vault'), key: randomBytes(32) })
let repository = new EncryptedApplicationRepository({ path, databaseKey, mappingKey })
const deps = () => ({ repository, fileVault: vault, localNer: null })
const person = '氏名：山田太郎\nスキル：Java、Spring Boot\n経験：8年\n連絡先：080-1234-5678'
const body = '案件名：決済システム開発\n必須スキル：Java、Spring Boot\n勤務地：東京\n担当者：山田太郎'
try {
  const first = await importPastedCandidateText(deps(), person)
  const repeated = await importPastedCandidateText(deps(), person.replaceAll('：', ':  ').replaceAll('\n', '\r\n\r\n'))
  assert.equal(repeated.review.documentId, first.review.documentId, 'formatting-only paste must reuse the person')
  assert.notEqual(repeated.outcome, 'created')
  assert.equal(repository.listResumeAnalyses().length, 1)
  assert.equal((await readdir(join(directory, 'vault'))).length, 1, 'duplicate encrypted staging must be discarded')
  const [parallelA, parallelB] = await Promise.all([
    importPastedCandidateText(deps(), person.replace('山田太郎', '鈴木花子')),
    importPastedCandidateText(deps(), person.replace('山田太郎', '鈴木花子'))
  ])
  assert.equal(parallelA.review.documentId, parallelB.review.documentId, 'concurrent imports must converge')
  assert.equal([parallelA, parallelB].filter((result) => result.outcome === 'created').length, 1)
  const changed = await importPastedCandidateText(deps(), person.replace('080-1234-5678', '080-1234-5679'))
  assert.notEqual(changed.review.documentId, first.review.documentId, 'different contact details must not be merged')
  assert.equal(repository.listResumeAnalyses().length, 3)

  const staged = repository.getStagedFileRecords([first.review.documentId])[0]!
  const document = { ...repository.getParsedDocument(staged.token)!, documentId: randomUUID() }
  const summary = repository.getResumeAnalysis(staged.token)!
  const copy = {
    ...staged,
    token: document.documentId,
    name: 'renamed.pdf',
    encryptedPath: join(directory, 'copy.sesv'),
    sha256: 'a'.repeat(64)
  }
  repository.saveStagedFiles([copy])
  const redaction = redactTextForCloud(person, { sourceVersion: copy.sha256 })
  repository.saveRedactionSession(redaction.session, redaction.mappings)
  assert.throws(
    () =>
      repository.saveParsedDocument(document, { ...summary, fileToken: copy.token }, redaction.session.id, extractCandidateDraft(document)),
    DuplicateCandidateError,
    'save layer must reject same parsed content even with different file bytes'
  )
  assert.equal(repository.getCandidateReview(copy.token), null)
  repository.removeStagedFiles([copy.token])
  const task = materializeWorkTask(
    createWorkTaskPreview('履歴書を取り込む', getDataScope('selected-files'), [
      { objectType: 'staged-file', objectId: copy.token, version: staged.sha256, contentHash: staged.sha256 }
    ]),
    randomUUID(),
    new Date().toISOString()
  )
  assert.throws(
    () => repository.saveResumeImportTask(task, [{ ...copy, sha256: staged.sha256 }]),
    DuplicateCandidateError,
    'renaming the same resume cannot bypass the staging guard'
  )
  assert.equal(repository.getWorkTask(task.id), null, 'duplicate staging must roll back its task')

  const caseOne = await importChatPastedJobCaseText(deps(), body)
  const manual = createRedactedManualJobCaseSource({ subject: '転送：案件のご案内', body }, randomUUID(), ['山田太郎'])
  assert.equal(
    repository.findJobCaseReviewByBusinessFingerprint(manual.source.redactedSubject, manual.source.redactedBody, manual.redaction.mappings)
      ?.reviewId,
    caseOne.review.reviewId,
    'manual and paste wrappers must share the same case'
  )
  assert.throws(
    () =>
      repository.saveRedactedJobCaseSourceAndDraft(
        manual.redaction.session,
        manual.redaction.mappings,
        manual.source,
        extractJobCaseDraft(manual.source, randomUUID())
      ),
    /登録済み/u
  )
  assert.equal(repository.getRedactionSession(manual.redaction.session.id), null, 'duplicate case must roll back new privacy evidence')
  const otherContact = await importChatPastedJobCaseText(deps(), body.replace('山田太郎', '鈴木花子'))
  assert.notEqual(otherContact.review.reviewId, caseOne.review.reviewId, 'different names must not collide after redaction')
  const gmailRedaction = redactTextForCloud(body, { sourceVersion: 'gmail-case', knownPersonNames: ['山田太郎'] })
  repository.saveRedactionSession(gmailRedaction.session, gmailRedaction.mappings)
  repository.saveGmailMessage({
    accountEmail: 'test@example.com',
    gmailMessageId: 'duplicate-mail',
    threadId: 'thread',
    historyId: '1',
    internalDate: new Date().toISOString(),
    labelIds: [],
    rfcMessageId: null,
    fromDomain: 'example.com',
    redactedSubject: '新案件',
    redactedBody: gmailRedaction.redactedContent,
    redactionSessionId: gmailRedaction.session.id,
    classification: 'job-case',
    businessFingerprint: 'b'.repeat(64),
    duplicateOfMessageId: null,
    warningCodes: [],
    attachmentCount: 0,
    importedAt: new Date().toISOString()
  })
  const gmailSource = repository.ensureGmailJobCaseSource(
    createGmailJobCaseSource(
      {
        accountEmail: 'test@example.com',
        gmailMessageId: 'duplicate-mail',
        threadId: 'thread',
        fromDomain: 'example.com',
        messageDate: new Date().toISOString(),
        redactedSubject: '新案件',
        redactedBody: gmailRedaction.redactedContent,
        redactionSessionId: gmailRedaction.session.id,
        warningCodes: [],
        createdAt: new Date().toISOString()
      },
      randomUUID()
    )
  )
  assert.equal(
    repository.saveJobCaseDraft(extractJobCaseDraft(gmailSource, randomUUID())),
    false,
    'Gmail draft save must reject a case already added elsewhere'
  )
  assert.equal(repository.listJobCaseReviews().length, 2)

  // Simulate a v50 installation: remove only the new derived indexes/columns.
  repository.close()
  const old = new Database(path)
  old.pragma("cipher='sqlcipher'")
  old.pragma('legacy=4')
  old.key(databaseKey)
  old.exec(
    'DROP INDEX parsed_documents_intake_fingerprint; DROP INDEX job_case_sources_intake_fingerprint; ALTER TABLE parsed_documents DROP COLUMN intake_fingerprint; ALTER TABLE job_case_sources DROP COLUMN intake_fingerprint; DELETE FROM schema_migrations WHERE version=51;'
  )
  old.close()
  repository = new EncryptedApplicationRepository({ path, databaseKey, mappingKey })
  assert.equal(
    (await importPastedCandidateText(deps(), person.replaceAll('：', ': '))).review.documentId,
    first.review.documentId,
    'upgrade must backfill existing people'
  )
  assert.equal(
    (await importChatPastedJobCaseText(deps(), body)).review.reviewId,
    caseOne.review.reviewId,
    'upgrade must backfill case fingerprints using local originals'
  )
  const candidatePreview = repository.previewCandidateDeletion(first.review.documentId)
  repository.deleteCandidateDatabaseData(first.review.documentId, candidatePreview.confirmationHash)
  await vault.discardStagedFile(staged)
  assert.equal((await importPastedCandidateText(deps(), person)).outcome, 'created', 'deleted personnel can be explicitly added again')
  const casePreview = repository.previewJobCaseDeletion(caseOne.review.reviewId)
  repository.deleteJobCaseDatabaseData({
    reviewId: casePreview.reviewId,
    confirmationHash: casePreview.confirmationHash,
    confirmationText: '削除'
  })
  assert.equal(
    repository.listGmailMessagesPendingJobCaseDrafts('test@example.com').length,
    0,
    'skipped duplicate mail must not resurrect a deleted case'
  )
  assert.equal((await importChatPastedJobCaseText(deps(), body)).outcome, 'created', 'deleted case can be explicitly added again')
  console.log(
    'PASS: formatting, concurrent intake, distinct identity, cross-source cases/resumes, atomic rollback, v50 upgrade, deletion and re-add'
  )
} finally {
  repository.close()
  await rm(directory, { recursive: true, force: true })
}
