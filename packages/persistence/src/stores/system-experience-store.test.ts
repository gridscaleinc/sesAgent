// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ExperienceInput } from '@shared'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { seedConfirmedCase, seedImportedPerson } from './store-test-fixtures-business'

const requirements = [{ key: 'skills', label: '技术', value: 'Java' }]
const matchingInput: ExperienceInput = {
  task: 'matching',
  requirements,
  facts: [],
  projects: [],
  hardFilters: [],
  hrRules: [],
  previousQuestions: [],
  notes: '',
  locale: 'zh-CN'
}

describe.skipIf(!nativeSqliteAvailable)('SystemExperienceStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  describe('settings and model-call budget', () => {
    it('changes settings only at the current revision and persists them', () => {
      const { repository } = handle
      expect(repository.getExperienceSettings()).toMatchObject({ enabled: true, dailyCallLimit: 16, callsToday: 0, revision: 0 })
      repository.controlSystemExperience({ action: 'budget', dailyCallLimit: 3, expectedRevision: 0 })
      expect(() => repository.controlSystemExperience({ action: 'learning', enabled: false, expectedRevision: 0 })).toThrow(
        /设置已更新|設定が更新/
      )
      expect(() => repository.controlSystemExperience({ action: 'budget', dailyCallLimit: 2, expectedRevision: 1 })).toThrow()
      expect(handle.reopen().getExperienceSettings()).toMatchObject({ dailyCallLimit: 3, revision: 1 })
    })

    it('reserves model calls up to the daily limit and none while learning is paused', () => {
      const { repository } = handle
      repository.controlSystemExperience({ action: 'budget', dailyCallLimit: 3, expectedRevision: 0 })
      expect([1, 2, 3, 4].map(() => repository.reserveExperienceCall())).toEqual([true, true, true, false])
      expect(repository.getExperienceSettings().callsToday).toBe(3)
      repository.controlSystemExperience({ action: 'budget', dailyCallLimit: 10, expectedRevision: 1 })
      repository.controlSystemExperience({ action: 'learning', enabled: false, expectedRevision: 2 })
      expect(repository.reserveExperienceCall()).toBe(false)
      repository.completeExperienceLearning('network')
      expect(repository.getExperienceSettings().lastError).toBe('network')
    })
  })

  describe('runs and events', () => {
    it('stores runs, keeps the first exposure rank and deduplicates or supersedes events by source key', () => {
      const { repository } = handle
      const person = seedImportedPerson(repository)
      const job = seedConfirmedCase(repository)
      const pair = { documentId: person.documentId, reviewId: job.reviewId }
      const runId = repository.saveExperienceRun({
        ...pair,
        interviewId: null,
        profileVersion: 1,
        jobCaseVersion: 1,
        rulesRevision: 0,
        input: matchingInput,
        output: { reason: 'r' },
        bundle: repository.getExperienceBundle('matching', requirements),
        modelKey: 'test'
      })
      repository.recordExperienceExposure({ runId, action: 'shown', rank: 2 })
      repository.recordExperienceExposure({ runId, action: 'shown', rank: 8 })
      expect(repository.getExperienceRun(runId)).toMatchObject({ id: runId, rank: 2, exposure: true, opened: false })
      expect(repository.getExperienceRun(randomUUID())).toBeNull()

      const event = {
        sourceKey: 'feedback:1',
        ...pair,
        interviewId: null,
        kind: 'feedback' as const,
        text: '客户反馈：需要确认设计职责。',
        actor: 'HR',
        data: {}
      }
      const first = repository.recordExperienceEvent(event)
      expect(repository.recordExperienceEvent(event)).toBe(first)
      expect(repository.getExperienceEvents([first])[0]).toMatchObject({ superseded: false, runIds: [runId] })
      const corrected = repository.recordExperienceEvent({ ...event, text: '更正：客户反馈无需再确认。' })
      expect(corrected).not.toBe(first)
      expect(repository.getExperienceEvents([first])[0]!.superseded).toBe(true)
      expect(repository.getPendingExperienceEvents().map((row) => row.id)).toEqual([corrected])
    })
  })

  describe('learned experiences', () => {
    it('serves a skill while its source evidence is current, withdraws it on correction and rejects stale or unvalidated control', () => {
      const { repository } = handle
      const person = seedImportedPerson(repository)
      const job = seedConfirmedCase(repository)
      const event = {
        sourceKey: 'feedback:skill',
        documentId: person.documentId,
        reviewId: job.reviewId,
        interviewId: null,
        kind: 'feedback' as const,
        text: '需要核实本人独立负责 Java 设计的范围。',
        actor: 'HR',
        data: {}
      }
      const eventId = repository.recordExperienceEvent(event)
      const skill = repository.saveSystemExperience(
        {
          task: 'matching',
          method: 'ownership',
          keyword: 'Java',
          enabled: true,
          locked: false,
          state: 'trial',
          support: [eventId],
          evaluations: [],
          previousVersion: null,
          reason: 'fixture'
        },
        0
      )
      expect(skill.version).toBe(1)
      expect(() => repository.saveSystemExperience({ ...skill, reason: 'stale' }, 0)).toThrow(/系统经验已更新|経験が更新/)
      expect(repository.getExperienceBundle('matching', requirements).refs).toEqual([{ id: skill.id, version: 1 }])
      expect(repository.getExperienceBundle('matching', [{ key: 'skills', label: '技术', value: 'Python' }]).refs).toEqual([])

      // Enabling needs two grounded, non-regressing evaluations; this skill has none.
      repository.controlSystemExperience({ action: 'enable', id: skill.id, expectedVersion: 1, enabled: false })
      expect(repository.getExperienceBundle('matching', requirements).refs).toEqual([])
      expect(() => repository.controlSystemExperience({ action: 'enable', id: skill.id, expectedVersion: 1, enabled: true })).toThrow(
        /系统经验已更新|経験が更新/
      )
      expect(() => repository.controlSystemExperience({ action: 'enable', id: skill.id, expectedVersion: 2, enabled: true })).toThrow(
        /依据不可用|根拠を利用できません/
      )

      const reenabled = repository.saveSystemExperience({ ...skill, enabled: true, locked: false, state: 'trial' }, 2)
      expect(handle.reopen().getExperienceBundle('matching', requirements).refs).toEqual([{ id: skill.id, version: reenabled.version }])
      handle.repository.recordExperienceEvent({ ...event, text: '原反馈已更正。' })
      expect(handle.repository.getExperienceBundle('matching', requirements).refs).toEqual([])
      expect(handle.repository.getSystemExperience().experiences[0]).toMatchObject({ state: 'withdrawn', enabled: false })
    })

    it('refuses adoption of a run for another object or a non-adoptable task', () => {
      const { repository } = handle
      const person = seedImportedPerson(repository)
      const job = seedConfirmedCase(repository)
      const other = seedConfirmedCase(repository, 'Java 別案件')
      const runId = repository.saveExperienceRun({
        documentId: null,
        reviewId: job.reviewId,
        interviewId: null,
        profileVersion: 0,
        jobCaseVersion: job.jobCase!.version,
        rulesRevision: 0,
        modelKey: 'test',
        output: '介绍文',
        bundle: { task: 'introduction', instructions: [], refs: [] },
        input: { ...matchingInput, task: 'introduction' }
      })
      expect(repository.validateExperienceAdoption(runId, { documentId: null, reviewId: job.reviewId })).toBeUndefined()
      expect(() => repository.validateExperienceAdoption(runId, { documentId: null, reviewId: other.reviewId })).toThrow(
        /对象不符|対象が一致しません/
      )
      const stale = repository.saveExperienceRun({
        documentId: null,
        reviewId: job.reviewId,
        interviewId: null,
        profileVersion: 0,
        jobCaseVersion: 999,
        rulesRevision: 0,
        modelKey: 'test',
        output: '介绍文',
        bundle: { task: 'introduction', instructions: [], refs: [] },
        input: { ...matchingInput, task: 'introduction' }
      })
      expect(() => repository.validateExperienceAdoption(stale, { documentId: null, reviewId: job.reviewId })).toThrow(
        /资料已更新|情報が更新/
      )
      const matchingRun = repository.saveExperienceRun({
        documentId: person.documentId,
        reviewId: job.reviewId,
        interviewId: null,
        profileVersion: 1,
        jobCaseVersion: 1,
        rulesRevision: 0,
        modelKey: 'test',
        output: {},
        bundle: { task: 'matching', instructions: [], refs: [] },
        input: matchingInput
      })
      expect(() => repository.validateExperienceAdoption(matchingRun, { documentId: person.documentId, reviewId: job.reviewId })).toThrow(
        /生成记录已失效|生成記録が無効/
      )
    })
  })
})
