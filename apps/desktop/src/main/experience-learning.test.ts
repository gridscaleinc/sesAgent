import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  baseExperienceSkills,
  experienceMatches,
  experienceControlSchema,
  type ExperienceEvent,
  type ExperienceRun,
  type ExperienceSample
} from '@shared'
import { experienceEvaluationPasses, independentExperienceSamples, validExperienceObservation } from './experience-learning'

const quote = '核实本人独立负责 Java 设计的职责范围。'
function fixture() {
  const run: ExperienceRun = {
    id: randomUUID(),
    documentId: randomUUID(),
    reviewId: randomUUID(),
    interviewId: null,
    profileVersion: 1,
    jobCaseVersion: 1,
    rulesRevision: 0,
    input: {
      task: 'matching',
      requirements: [{ key: 'required_skills', label: 'required', value: 'Java' }],
      facts: [],
      projects: [],
      hardFilters: [],
      hrRules: [],
      previousQuestions: [],
      notes: '',
      locale: 'zh-CN'
    },
    bundle: { task: 'matching', instructions: [baseExperienceSkills.matching], refs: [] },
    output: {},
    modelKey: 'test',
    createdAt: new Date().toISOString(),
    exposure: false,
    opened: false,
    rank: null
  }
  const event: ExperienceEvent = {
    id: randomUUID(),
    sourceKey: randomUUID(),
    documentId: run.documentId,
    reviewId: run.reviewId,
    interviewId: null,
    kind: 'feedback',
    text: quote,
    actor: 'HR',
    createdAt: run.createdAt,
    runIds: [run.id],
    data: { result: 'passed' },
    superseded: false
  }
  const sample: ExperienceSample = {
    eventId: event.id,
    runId: run.id,
    task: 'matching',
    method: 'ownership',
    keyword: 'Java',
    quote,
    polarity: 'support'
  }
  return { run, event, sample }
}
describe('experience evidence boundary', () => {
  it('requires a real quote, existing requirement and exact source run', () => {
    const { run, event, sample } = fixture()
    expect(validExperienceObservation(sample, event, run)).toBe(true)
    expect(validExperienceObservation({ ...sample, quote: '客户没有说过这句话' }, event, run)).toBe(false)
    expect(validExperienceObservation({ ...sample, keyword: 'Python' }, event, run)).toBe(false)
    expect(validExperienceObservation(sample, { ...event, runIds: [] }, run)).toBe(false)
    expect(validExperienceObservation(sample, { ...event, superseded: true }, run)).toBe(false)
  })
  it('does not turn checkbox selection, withdrawal or commercial reasons into competence feedback', () => {
    const { run, event, sample } = fixture()
    for (const reason of ['availability', 'rate', 'interest', 'case-closed', 'work-style'])
      expect(validExperienceObservation(sample, { ...event, data: { reason } }, run)).toBe(false)
    for (const result of ['no-show', 'withdrawn'])
      expect(validExperienceObservation(sample, { ...event, data: { result } }, run)).toBe(false)
    expect(validExperienceObservation(sample, { ...event, kind: 'questions' }, run)).toBe(false)
    expect(validExperienceObservation({ ...sample, method: 'followup' }, event, run)).toBe(false)
  })
  it('rejects identity-based keywords even when the original requirement includes them', () => {
    const { run, event, sample } = fixture()
    for (const keyword of ['国籍', '性别', '年龄'])
      expect(
        validExperienceObservation({ ...sample, keyword }, event, {
          ...run,
          input: { ...run.input, requirements: [{ key: 'notes', label: 'notes', value: keyword }] }
        })
      ).toBe(false)
  })
  it('requires independent people and cases, and excludes corrected sources', () => {
    const a = fixture(),
      b = fixture(),
      c = fixture(),
      d = fixture()
    b.event.documentId = a.event.documentId
    c.event.reviewId = a.event.reviewId
    d.event.superseded = true
    expect(independentExperienceSamples([a.sample, b.sample, c.sample, d.sample], [a.event, b.event, c.event, d.event])).toEqual([a.sample])
  })
  it('does not activate on ties, self-claimed improvement, regressions or only one heldout case', () => {
    const row = { eventId: randomUUID(), runId: randomUUID(), baseline: 0, candidate: 2, grounded: true, regression: false }
    expect(experienceEvaluationPasses([row, { ...row, eventId: randomUUID() }])).toBe(true)
    expect(experienceEvaluationPasses([row])).toBe(false)
    expect(experienceEvaluationPasses([row, { ...row, grounded: false }])).toBe(false)
    expect(experienceEvaluationPasses([row, { ...row, regression: true }])).toBe(false)
    expect(experienceEvaluationPasses([row, { ...row, baseline: 2 }])).toBe(false)
  })
  it('scopes keywords without matching JavaScript or interpreting regex metacharacters', () => {
    const requirements = (value: string) => [{ key: 'skills', label: 'skills', value }]
    expect(experienceMatches('Java', requirements('JavaScript'))).toBe(false)
    expect(experienceMatches('JAVA', requirements('必須：Java と SQL'))).toBe(true)
    expect(experienceMatches('C++', requirements('C++ と Java'))).toBe(true)
    expect(experienceMatches('.*', requirements('Java'))).toBe(false)
    expect(experienceControlSchema.safeParse({ action: 'budget', dailyCallLimit: 1, expectedRevision: 0 }).success).toBe(false)
  })
})
