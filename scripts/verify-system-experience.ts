import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EncryptedApplicationRepository, currentSchemaVersion } from '@persistence'
import { EncryptedFileVault } from '@files'
import { loadAgentChatModelCatalog } from '@agent'
import { baseExperienceSkills, type ExperienceInput } from '@shared'
import { importChatPastedJobCaseText, importPastedCandidateText } from '../apps/desktop/src/main/business-text-intake'
import { createExperienceLearner } from '../apps/desktop/src/main/experience-learning'
import Database from 'better-sqlite3-multiple-ciphers'
import { migrationV53 } from '../packages/persistence/src/schema/migrations'

const directory = await mkdtemp(join(tmpdir(), 'ses-experience-'))
const options = { path: join(directory, 'test.db'), databaseKey: randomBytes(32), mappingKey: randomBytes(32) }
let repository = new EncryptedApplicationRepository(options)
const fileVault = new EncryptedFileVault({ directory: join(directory, 'vault'), key: randomBytes(32) })
const quote = '需要核实本人独立负责 Java 设计的范围，不能把参与项目当成独立负责。'
let polarity: 'support' | 'counterexample' = 'support'
let calls = 0
const replays: Array<{ input: unknown; enhanced: boolean }> = []
const output = (enhanced: boolean) => (enhanced ? '请确认本人负责的设计范围和具体决策。' : '请介绍技术经验。')
const cloud = {
  async extractExperience({ events }: any) {
    calls++
    return {
      observations: events.flatMap((event: any) =>
        event.runs.map((run: any) => ({
          eventId: event.id,
          task: run.input.task,
          method: 'ownership',
          keyword: 'Java',
          quote: event.text,
          polarity
        }))
      )
    }
  },
  async assessMatchCandidates(input: any) {
    calls++
    const enhanced = input.jobCase.experienceSkills.length > 1
    replays.push({ input, enhanced })
    assert.equal(JSON.stringify(input).includes(quote), false, 'held-out outcome must not leak into replay')
    return {
      assessments: [{ candidate: 'CANDIDATE_1', fit: 'possible', reason: output(enhanced), met: [], gaps: [], confirm: [output(enhanced)] }]
    }
  },
  async generateRuleQuestions(input: any) {
    calls++
    const enhanced = input.experienceSkills.length > 1
    replays.push({ input, enhanced })
    assert.equal(input.notes.includes(quote), false)
    return [
      {
        id: randomUUID(),
        text: output(enhanced),
        source: 'match',
        selected: true,
        requirement: 'Java',
        evidence: 'Java API',
        scoringGuide: '本人职责'
      }
    ]
  },
  async judgeExperience(input: any) {
    calls++
    const a = JSON.stringify(input.a).includes(output(true)),
      b = JSON.stringify(input.b).includes(output(true))
    return { a: a ? 2 : 0, b: b ? 2 : 0, sourceQuote: input.correction, outputQuote: output(true), regression: false }
  }
}
function learner() {
  return createExperienceLearner({ repository, agentNarrativeStreamer: cloud as never, agentChatModelCatalog: loadAgentChatModelCatalog() })
}
const events: string[] = []
async function seed(index: number, text = quote) {
  const deps = { repository, fileVault, localNer: null }
  const person = (
    await importPastedCandidateText(deps, `氏名：検証担当${index}\nスキル：Java、AWS\n経験：${index + 3}年\nプロジェクト：API構築${index}`)
  ).review
  const draft = (
    await importChatPastedJobCaseText(deps, `案件名：Java検証案件${index}\n必須スキル：Java\n勤務地：東京\n備考：識別番号${index}`)
  ).review
  const job = repository.confirmJobCaseReview(
    {
      reviewId: draft.reviewId,
      reviewRevision: draft.reviewRevision,
      privacyReviewed: true,
      fields: draft.fields.map((field) => ({
        key: field.key,
        value: field.key === 'title' ? `Java API ${index}` : field.value,
        confirmed: true,
        changeReason: 'Verification fixture'
      }))
    },
    'test',
    'HR'
  )
  const pair = { documentId: person.documentId, reviewId: job.reviewId }
  const input: ExperienceInput = {
    task: 'matching',
    requirements: [{ key: 'required_skills', label: '必須', value: 'Java' }],
    facts: [{ key: 'skills', label: '技術', value: 'Java API' }],
    projects: [],
    hardFilters: [],
    hrRules: [],
    previousQuestions: [],
    notes: '',
    locale: 'zh-CN'
  }
  const run = repository.saveExperienceRun({
    ...pair,
    interviewId: null,
    profileVersion: 1,
    jobCaseVersion: 1,
    rulesRevision: 0,
    input,
    output: { reason: '原始结果' },
    bundle: repository.getExperienceBundle('matching', input.requirements),
    modelKey: 'test'
  })
  repository.recordExperienceExposure({ runId: run, action: 'shown', rank: 2 })
  repository.recordExperienceExposure({ runId: run, action: 'shown', rank: 8 })
  assert.equal(repository.getExperienceRun(run)?.rank, 2)
  const scheduled = repository.advanceBusinessProgress(
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
    'HR'
  )
  const interviewId = scheduled.progress!.rounds[0]!.id
  const interviewRun = repository.saveExperienceRun({
    ...pair,
    interviewId,
    profileVersion: 1,
    jobCaseVersion: 1,
    rulesRevision: 0,
    input: { ...input, task: 'interview' },
    output: [{ text: '旧问题' }],
    bundle: repository.getExperienceBundle('interview', input.requirements),
    modelKey: 'test'
  })
  const prepared = repository.advanceBusinessProgress(
    {
      ...pair,
      expectedRevision: scheduled.revision,
      mutationId: randomUUID(),
      action: 'prepare',
      roundNumber: 1,
      questions: [
        {
          id: randomUUID(),
          text: 'Java 担当経験を説明してください。',
          source: 'match',
          sourceLabel: 'Java',
          selected: true,
          experienceRunId: interviewRun
        }
      ]
    },
    'HR'
  )
  // A later generated but unselected question set must not receive outcome attribution.
  repository.saveExperienceRun({
    ...pair,
    interviewId,
    profileVersion: 1,
    jobCaseVersion: 1,
    rulesRevision: 0,
    input: { ...input, task: 'interview' },
    output: [{ text: 'unused' }],
    bundle: { task: 'interview', instructions: [baseExperienceSkills.interview], refs: [] },
    modelKey: 'test'
  })
  repository.advanceBusinessProgress(
    {
      ...pair,
      expectedRevision: prepared.revision,
      mutationId: randomUUID(),
      action: 'feedback',
      roundNumber: 1,
      result: 'passed',
      next: 'unknown',
      notes: text,
      unresolved: []
    },
    'HR'
  )
  const event = repository.getPendingExperienceEvents().find((e) => e.documentId === pair.documentId && e.kind === 'feedback')!
  assert.ok(event.runIds.includes(run))
  assert.ok(event.runIds.includes(interviewRun))
  events.push(event.id)
  return { pair, run, interviewRun, event }
}
try {
  assert.equal(currentSchemaVersion, 66)
  const empty = learner()
  await empty.tick()
  empty.stop()
  assert.equal(calls, 0)
  for (let index = 1; index <= 5; index++) await seed(index)
  repository.controlSystemExperience({
    action: 'budget',
    dailyCallLimit: 4,
    expectedRevision: repository.getSystemExperience().settings.revision
  })
  let worker = learner()
  await worker.tick()
  assert.equal(repository.getSystemExperience().settings.callsToday, 4)
  assert.equal(repository.getSystemExperience().experiences[0]?.state, 'validating')
  assert.equal(repository.getSystemExperience().experiences[0]?.evaluations.length, 1)
  const limitedCalls = calls
  await worker.tick()
  assert.equal(calls, limitedCalls)
  repository.controlSystemExperience({
    action: 'budget',
    dailyCallLimit: 16,
    expectedRevision: repository.getSystemExperience().settings.revision
  })
  await worker.tick()
  await worker.tick()
  let skills = repository.getSystemExperience().experiences
  assert.equal(skills.length, 2)
  assert.ok(skills.every((s) => s.state === 'trial' && s.enabled && s.evaluations.length === 2))
  assert.equal(repository.getExperienceBundle('matching', [{ key: 'skills', label: 'skills', value: 'Java' }]).refs.length, 1)
  assert.equal(repository.getExperienceBundle('matching', [{ key: 'skills', label: 'skills', value: 'JavaScript' }]).refs.length, 0)
  assert.ok(replays.some((r) => r.enhanced) && replays.some((r) => !r.enhanced))
  assert.equal(repository.getSystemExperience().settings.callsToday, calls)
  // Pause is durable; disabled experience remains disabled across new worker instances.
  const skill = skills.find((s) => s.task === 'matching')!
  repository.controlSystemExperience({ action: 'enable', id: skill.id, expectedVersion: skill.version, enabled: false })
  assert.throws(
    () => repository.controlSystemExperience({ action: 'enable', id: skill.id, expectedVersion: skill.version, enabled: true }),
    /更新/
  )
  worker.stop()
  repository.close()
  repository = new EncryptedApplicationRepository(options)
  worker = learner()
  await worker.tick()
  assert.equal(repository.getExperienceBundle('matching', [{ key: 'skills', label: 'skills', value: 'Java' }]).refs.length, 0)
  const paused = repository.getSystemExperience().experiences.find((s) => s.id === skill.id)!
  assert.equal(paused.locked, true)
  repository.controlSystemExperience({ action: 'restore', id: skill.id, expectedVersion: paused.version, version: skill.version })
  const settings = repository.getSystemExperience().settings
  repository.controlSystemExperience({ action: 'budget', dailyCallLimit: 60, expectedRevision: settings.revision })
  for (let index = 6; index <= 8; index++) await seed(index)
  await worker.tick()
  assert.ok(repository.getSystemExperience().experiences.every((s) => s.state === 'active' && s.enabled))
  // Three subsequent explicit independent counterexamples withdraw applied skills.
  polarity = 'counterexample'
  for (let index = 9; index <= 11; index++) await seed(index, '反复追问本人独立负责 Java 设计没有必要，原记录已经明确写出了负责范围。')
  await worker.tick()
  assert.ok(repository.getSystemExperience().experiences.every((s) => s.state === 'withdrawn' && !s.enabled && s.locked))
  await worker.tick()
  assert.equal(
    repository.getSystemExperience().experiences.some((s) => s.enabled),
    false
  )
  // Corrected/deleted source evidence invalidates restored old methods immediately.
  const withdrawn = repository.getSystemExperience().experiences.find((s) => s.id === skill.id)!
  repository.controlSystemExperience({ action: 'restore', id: skill.id, expectedVersion: withdrawn.version, version: skill.version })
  const source = repository.getExperienceEvents([events[0]!])[0]!
  repository.recordExperienceEvent({ ...source, text: '原反馈已更正，之前记录不准确。', data: { ...source.data, corrected: true } })
  assert.equal(repository.getExperienceBundle('matching', [{ key: 'skills', label: 'skills', value: 'Java' }]).refs.length, 0)
  const raw = new Database(options.path)
  try {
    raw.pragma("cipher='sqlcipher'")
    raw.pragma('legacy=4')
    raw.key(options.databaseKey)
    raw.pragma('foreign_keys=ON')
    assert.deepEqual(raw.pragma('foreign_key_check'), [])
    raw.prepare('DELETE FROM experience_events WHERE id=?').run(events[1]!)
    assert.equal(
      raw.prepare('SELECT count(*) n FROM experience_observations WHERE event_id=?').get(events[1]!) &&
        (raw.prepare('SELECT count(*) n FROM experience_observations WHERE event_id=?').get(events[1]!) as { n: number }).n,
      0
    )
  } finally {
    raw.close()
  }
  const before = calls,
    s = repository.getSystemExperience().settings
  repository.controlSystemExperience({ action: 'learning', enabled: false, expectedRevision: s.revision })
  await worker.tick()
  assert.equal(calls, before)
  // A pause arriving during an outstanding model call must not commit its observations.
  repository.controlSystemExperience({
    action: 'learning',
    enabled: true,
    expectedRevision: repository.getSystemExperience().settings.revision
  })
  const pendingBefore = repository.getSystemExperience().pendingCount
  const extract = cloud.extractExperience
  cloud.extractExperience = async (input) => {
    const result = await extract(input)
    repository.controlSystemExperience({
      action: 'learning',
      enabled: false,
      expectedRevision: repository.getSystemExperience().settings.revision
    })
    return result
  }
  await worker.tick()
  assert.equal(repository.getSystemExperience().pendingCount, pendingBefore)
  assert.equal(repository.getSystemExperience().settings.enabled, false)
  worker.stop()
  repository.close()
  // Reconstruct the actual v53 table definitions with populated runs/events/observations.
  const legacy = new Database(options.path)
  legacy.pragma("cipher='sqlcipher'")
  legacy.pragma('legacy=4')
  legacy.key(options.databaseKey)
  const tables = ['experience_runs', 'experience_events', 'experience_observations', 'experience_versions', 'experience_settings']
  const beforeUpgrade = tables.map((table) => legacy.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
  legacy.pragma('foreign_keys=OFF')
  legacy.transaction(() => {
    for (const table of ['experience_runs', 'experience_events']) {
      const start = migrationV53.indexOf(`CREATE TABLE ${table} (`)
      const definition = migrationV53
        .slice(start, migrationV53.indexOf(');', start) + 2)
        .replace(`CREATE TABLE ${table} (`, `CREATE TABLE ${table}_old (`)
      legacy.exec(definition)
      legacy.exec(`INSERT INTO ${table}_old SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_old RENAME TO ${table};`)
    }
    legacy.prepare('DELETE FROM schema_migrations WHERE version=54').run()
  })()
  legacy.close()
  repository = new EncryptedApplicationRepository(options)
  const upgraded = new Database(options.path)
  try {
    upgraded.pragma("cipher='sqlcipher'")
    upgraded.pragma('legacy=4')
    upgraded.key(options.databaseKey)
    assert.deepEqual(
      tables.map((table) => upgraded.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),
      beforeUpgrade
    )
    assert.deepEqual(upgraded.pragma('foreign_key_check'), [])
    assert.equal(upgraded.prepare('SELECT max(version) version FROM schema_migrations').get().version, currentSchemaVersion)
  } finally {
    upgraded.close()
  }
  console.log(
    JSON.stringify({
      schema: currentSchemaVersion,
      tasks: 2,
      independentValidation: true,
      noOutcomeLeak: true,
      selectedQuestionAttribution: true,
      sourceInvalidation: true,
      automaticRollback: true,
      durablePause: true,
      populatedV53Upgrade: true,
      budgetResume: true,
      pauseDuringCall: true,
      activePromotion: true,
      modelCalls: calls,
      realModelQuality: 'not-measured'
    })
  )
} finally {
  repository.close()
  await rm(directory, { recursive: true, force: true })
}
