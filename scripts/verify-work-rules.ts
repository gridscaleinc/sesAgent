import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EncryptedApplicationRepository, currentSchemaVersion } from '@persistence'
import { EncryptedFileVault } from '@files'
import { importChatPastedJobCaseText, importPastedCandidateText } from '../apps/desktop/src/main/business-text-intake'
import { type CasePersonAssessment } from '@shared'
import Database from 'better-sqlite3-multiple-ciphers'

const directory = await mkdtemp(join(tmpdir(), 'ses-work-rules-'))
const options = { path: join(directory, 'test.db'), databaseKey: randomBytes(32), mappingKey: randomBytes(32) }
let repository = new EncryptedApplicationRepository(options)
const fileVault = new EncryptedFileVault({ directory: join(directory, 'vault'), key: randomBytes(32) })
try {
  assert.equal(currentSchemaVersion, 68)
  assert.deepEqual(repository.listWorkRules(), { revision: 0, rules: [] })
  const first = repository.saveWorkRule({
    expectedRevision: 0,
    enabled: true,
    text: 'Java案件はAWS経験を優先',
    scope: { kind: 'global' },
    clauses: [
      { kind: 'preferred', field: 'required_skills', text: 'AWS経験', sourceQuote: 'Java案件はAWS経験を優先', caseKeywords: ['Java'] }
    ],
    modelKey: 'test-model',
    updatedBy: 'HR test'
  })
  assert.equal(first.revision, 1)
  const stopped = repository.changeWorkRule({ id: first.id, expectedRevision: 1, enabled: false }, 'HR test')
  assert.equal(stopped.enabled, false)
  assert.throws(() => repository.changeWorkRule({ id: first.id, expectedRevision: 1, enabled: true }, 'HR test'), /更新/)
  const restored = repository.changeWorkRule({ id: first.id, expectedRevision: 2, restoreRevision: 1 }, 'HR test')
  assert.equal(restored.revision, 3)
  assert.equal(restored.enabled, true)
  assert.deepEqual(
    repository.getWorkRuleHistory(first.id).map((rule) => rule.revision),
    [3, 2, 1]
  )
  assert.equal(repository.listWorkRules().revision, 3)
  const deps = { repository, fileVault, localNer: null }
  const person = (await importPastedCandidateText(deps, '氏名：検証担当\nスキル：Java、AWS\n経験：8年')).review
  const jobDraft = (await importChatPastedJobCaseText(deps, '案件名：Javaテスト案件\n必須スキル：Java\n勤務地：東京')).review
  const job = repository.confirmJobCaseReview(
    {
      reviewId: jobDraft.reviewId,
      reviewRevision: jobDraft.reviewRevision,
      privacyReviewed: true,
      fields: jobDraft.fields.map((field) => ({
        key: field.key,
        value: field.key === 'title' ? 'Java API development' : field.value,
        confirmed: true,
        changeReason: 'Verification fixture'
      }))
    },
    'test-hr',
    'HR test'
  )
  assert.ok(person.profile)
  assert.ok(job.jobCase)
  const pair = { documentId: person.documentId, reviewId: job.reviewId }
  // Questions generated on the assessment card wait as a draft; the newest one is carried into round one when it is booked.
  const draftQuestion = {
    id: randomUUID(),
    text: '評価時に生成した質問：担当範囲を説明してください。',
    source: 'match' as const,
    sourceLabel: 'Java',
    selected: true,
    requirement: 'Java',
    evidence: 'Java',
    scoringGuide: '本人の担当範囲を確認する。',
    matchContext: {
      jobCaseId: job.jobCase.id,
      jobCaseVersion: job.jobCase.version,
      profileVersion: person.profile.version,
      rulesRevision: 3
    }
  }
  const draft = {
    id: randomUUID(),
    documentId: person.documentId,
    jobCaseId: job.jobCase.id,
    jobCaseVersion: job.jobCase.version,
    profileVersion: person.profile.version,
    rulesRevision: 3,
    experienceRunId: null,
    questions: [draftQuestion],
    createdAt: new Date().toISOString(),
    supersededAt: null
  }
  repository.saveCaseQuestionDraft({ ...draft, id: randomUUID(), createdAt: new Date(Date.now() - 1000).toISOString() })
  repository.saveCaseQuestionDraft(draft)
  const follow = repository.advanceBusinessProgress(
    {
      ...pair,
      expectedRevision: 0,
      mutationId: randomUUID(),
      action: 'schedule',
      schedule: {
        roundNumber: 1,
        scheduledAt: '',
        durationMinutes: 60,
        meetingMethod: 'onsite',
        meetingUrl: '',
        location: '',
        interviewer: '',
        note: ''
      }
    },
    'HR test'
  )
  assert.equal(follow.progress?.rounds[0]?.questionPlan[0]?.id, draftQuestion.id, 'round one starts from the fresh assessment-time draft')
  assert.match(follow.events.at(-1)?.note ?? '', /带入评估时生成的 1 道面试题/)
  const question = {
    id: randomUUID(),
    text: 'Java案件で担当した設計を説明してください。',
    source: 'match' as const,
    sourceLabel: 'Java',
    selected: true,
    requirement: 'Java',
    evidence: 'Java',
    scoringGuide: '本人の担当内容と成果物を確認する。',
    matchContext: {
      jobCaseId: job.jobCase.id,
      jobCaseVersion: job.jobCase.version,
      profileVersion: person.profile.version,
      rulesRevision: 3
    }
  }
  const prepared = repository.advanceBusinessProgress(
    { ...pair, expectedRevision: follow.revision, mutationId: randomUUID(), action: 'prepare', roundNumber: 1, questions: [question] },
    'HR test'
  )
  assert.equal(prepared.progress?.rounds[0]?.questionPlan[0]?.requirement, 'Java')
  assert.equal(prepared.progress?.stage, 'coordinating', 'preparation must not invent a booked date or change progress')
  assert.throws(
    () =>
      repository.advanceBusinessProgress(
        {
          ...pair,
          expectedRevision: prepared.revision,
          mutationId: randomUUID(),
          action: 'prepare',
          roundNumber: 1,
          questions: [{ ...question, matchContext: { ...question.matchContext, rulesRevision: 0 } }]
        },
        'HR test'
      ),
    /规则/
  )
  const assessment: CasePersonAssessment = {
    id: randomUUID(),
    documentId: person.documentId,
    jobCaseId: job.jobCase.id,
    jobCaseVersion: job.jobCase.version,
    profileVersion: person.profile.version,
    assessedAt: new Date().toISOString(),
    rulesRevision: 3,
    appliedRules: [{ id: first.id, revision: 3, kind: 'preferred', text: 'AWS経験' }],
    result: {
      documentId: person.documentId,
      profileVersion: person.profile.version,
      score: 80,
      matched: ['Java'],
      missing: [],
      hardFilters: []
    },
    cloud: { status: 'unavailable', reviewedCount: 0, modelName: null }
  }
  repository.saveCasePersonAssessment(assessment)
  repository.saveAssessmentFeedback(
    { assessmentId: assessment.id, decision: 'unsuitable', reason: 'availability', note: '今回は開始時期が合わない' },
    'HR test'
  )
  repository.close()
  repository = new EncryptedApplicationRepository(options)
  assert.equal(repository.listWorkRules().revision, 3)
  assert.equal(repository.getWorkRuleHistory(first.id).length, 3)
  assert.equal(repository.listCasePersonAssessments(person.documentId, job.jobCase.id)[0]?.id, assessment.id)
  assert.equal(
    repository.getCaseQuestionDraft(person.documentId, job.jobCase.id)?.id,
    draft.id,
    'the newest draft supersedes the earlier one and survives restart'
  )
  assert.equal(
    repository.listBusinessFollowUps().find((row) => row.id === follow.id)?.progress?.rounds[0]?.questionPlan[0]?.id,
    question.id
  )
  const raw = new Database(options.path)
  try {
    raw.pragma("cipher='sqlcipher'")
    raw.pragma('legacy=4')
    raw.key(options.databaseKey)
    const feedback = raw
      .prepare<[string], { payload: string }>('SELECT payload FROM case_person_feedback WHERE assessment_id = ?')
      .get(assessment.id)
    assert.equal(JSON.parse(feedback!.payload).reason, 'availability')
    assert.equal(JSON.parse(feedback!.payload).decision, 'unsuitable')
    assert.deepEqual(raw.pragma('foreign_key_check'), [])
  } finally {
    raw.close()
  }
  console.log(
    JSON.stringify({
      version: 'work-rules-verification-v1',
      schema: currentSchemaVersion,
      versions: 3,
      staleWritesRejected: true,
      roundQuestionsPersisted: true,
      assessmentAndFeedbackStored: true,
      reopened: true
    })
  )
} finally {
  repository.close()
  await rm(directory, { recursive: true, force: true })
}
