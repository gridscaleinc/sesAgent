// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { emptySchedule, seedConfirmedCase, seedImportedPerson } from './store-test-fixtures-business'

describe.skipIf(!nativeSqliteAvailable)('BusinessGrowthStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  describe('customer identities', () => {
    it('resolves aliases to one customer, keeps renamed names as aliases and survives reopen', () => {
      const { repository } = handle
      const [customer] = repository.saveCustomerIdentity({ name: 'ABC株式会社', aliases: ['ABC', '客户甲'], expectedVersion: 0 })
      expect(customer).toMatchObject({ version: 1, name: 'ABC株式会社', aliases: ['ABC', '客户甲'] })
      expect(repository.resolveCustomerIdentity(' abc ').key).toBe(repository.resolveCustomerIdentity('ABC株式会社').key)
      expect(repository.resolveCustomerIdentity(' abc ').label).toBe('ABC株式会社')

      const [renamed] = repository.saveCustomerIdentity({
        id: customer!.id,
        name: 'ABCホールディングス',
        aliases: ['ABC'],
        expectedVersion: 1
      })
      expect(renamed!.aliases).toEqual(expect.arrayContaining(['ABC', 'ABC株式会社']))
      expect(handle.reopen().listCustomerIdentities()).toEqual([expect.objectContaining({ id: customer!.id, version: 2 })])
    })

    it('rejects a name owned by another customer and a stale version', () => {
      const { repository } = handle
      const [customer] = repository.saveCustomerIdentity({ name: 'ABC株式会社', aliases: ['ABC'], expectedVersion: 0 })
      expect(() => repository.saveCustomerIdentity({ name: '别家', aliases: ['abc'], expectedVersion: 0 })).toThrow(/另一客户|別の顧客/)
      expect(() => repository.saveCustomerIdentity({ id: customer!.id, name: 'ABC株式会社', aliases: [], expectedVersion: 0 })).toThrow(
        /更新/
      )
      expect(() => repository.saveCustomerIdentity({ id: randomUUID(), name: 'New', aliases: [], expectedVersion: 0 })).toThrow(/更新/)
      expect(repository.listCustomerIdentities()).toHaveLength(1)
    })
  })

  it('stores growth checkpoints by key', () => {
    expect(handle.repository.getGrowthCheckpoint('k')).toBeUndefined()
    handle.repository.saveGrowthCheckpoint('k', 'v1')
    handle.repository.saveGrowthCheckpoint('k', 'v2')
    expect(handle.reopen().getGrowthCheckpoint('k')).toBe('v2')
  })

  describe('matching opportunities', () => {
    it('keeps a dismissal until the evidence changes and rejects actions on a stale fingerprint', () => {
      const { repository } = handle
      const person = seedImportedPerson(repository)
      const job = seedConfirmedCase(repository)
      const opportunity = {
        documentId: person.documentId,
        reviewId: job.reviewId,
        profileVersion: person.profile!.version,
        jobCaseVersion: job.jobCase!.version,
        jobCaseId: job.jobCase!.id,
        personName: '测试人员',
        caseTitle: 'Java API',
        rulesRevision: 0,
        fingerprint: 'a'.repeat(64),
        score: 70,
        reasons: ['Java 项目依据'],
        confirm: ['开始时间']
      }
      repository.saveMatchingOpportunities(job.reviewId, [opportunity])
      let item = repository.listMatchingOpportunities().find((row) => row.documentId === person.documentId)!
      expect(item).toMatchObject({ state: 'new', score: 70 })

      repository.controlMatchingOpportunity({ id: item.id, fingerprint: item.fingerprint, action: 'dismissed' })
      repository.saveMatchingOpportunities(job.reviewId, [opportunity])
      expect(repository.listMatchingOpportunities()).toHaveLength(0)

      repository.saveMatchingOpportunities(job.reviewId, [{ ...opportunity, fingerprint: 'b'.repeat(64) }])
      item = repository.listMatchingOpportunities().find((row) => row.documentId === person.documentId)!
      expect(item.state).toBe('new')
      expect(() => repository.controlMatchingOpportunity({ id: item.id, fingerprint: 'a'.repeat(64), action: 'seen' })).toThrow(/更新/)
    })

    it('hides opportunities whose person is no longer available or already followed up', () => {
      const { repository } = handle
      const person = seedImportedPerson(repository)
      const job = seedConfirmedCase(repository)
      repository.saveMatchingOpportunities(job.reviewId, [
        {
          documentId: person.documentId,
          reviewId: job.reviewId,
          profileVersion: person.profile!.version,
          jobCaseVersion: job.jobCase!.version,
          jobCaseId: job.jobCase!.id,
          personName: 'p',
          caseTitle: 'c',
          rulesRevision: 0,
          fingerprint: 'c'.repeat(64),
          score: 50,
          reasons: [],
          confirm: []
        }
      ])
      expect(repository.listMatchingOpportunities()).toHaveLength(1)
      repository.beginBusinessProgress([{ documentId: person.documentId, reviewId: job.reviewId, pendingConditions: [] }], 'HR')
      expect(repository.listMatchingOpportunities()).toHaveLength(0)
    })
  })

  describe('interview answers', () => {
    it('accepts only answers grounded in the interview notes and invalidates them when the notes change', () => {
      const { repository } = handle
      const person = seedImportedPerson(repository)
      const job = seedConfirmedCase(repository)
      const pair = { documentId: person.documentId, reviewId: job.reviewId }
      const scheduled = repository.advanceBusinessProgress(
        { ...pair, expectedRevision: 0, mutationId: randomUUID(), action: 'schedule', schedule: emptySchedule() },
        'HR'
      )
      const questionId = randomUUID()
      const prepared = repository.advanceBusinessProgress(
        {
          ...pair,
          expectedRevision: scheduled.revision,
          mutationId: randomUUID(),
          action: 'prepare',
          roundNumber: 1,
          questions: [
            {
              id: questionId,
              text: '请说明 Java 项目中本人负责的设计。',
              source: 'match',
              sourceLabel: 'Java',
              requirement: 'Java',
              selected: true
            }
          ]
        },
        'HR'
      )
      const notes = '本人说明负责 Java API 实现和单元测试，基本设计由组长负责。'
      const feedback = repository.advanceBusinessProgress(
        {
          ...pair,
          expectedRevision: prepared.revision,
          mutationId: randomUUID(),
          action: 'feedback',
          roundNumber: 1,
          notes,
          result: 'pending',
          next: 'unknown',
          unresolved: []
        },
        'HR'
      )
      const interviewId = feedback.progress!.rounds[0]!.id

      const [source] = repository.getPendingInterviewAnswers()
      expect(source).toMatchObject({ interviewId, notes })
      const answer = { questionId, status: 'partial' as const, quote: '基本设计由组长负责', summary: '实现为主', remaining: '设计职责' }
      expect(() => repository.saveInterviewAnswers(source!, [{ ...answer, quote: '本人独立完成全部设计' }])).toThrow(/原始依据|根拠/)
      expect(() => repository.saveInterviewAnswers(source!, [{ ...answer, questionId: randomUUID() }])).toThrow(/原始依据|根拠/)
      expect(repository.saveInterviewAnswers(source!, [answer])).toBe(true)
      expect(repository.getInterviewAnswers(interviewId)?.answers).toEqual([answer])
      expect(repository.getPendingInterviewAnswers()).toHaveLength(0)
      expect(repository.getPairInterviewEvidence(person.documentId, job.reviewId)).toEqual([
        expect.objectContaining({ questionId, roundNumber: 1 })
      ])

      repository.advanceBusinessProgress(
        {
          ...pair,
          expectedRevision: feedback.revision,
          mutationId: randomUUID(),
          action: 'feedback',
          roundNumber: 1,
          notes: '更正记录：本人负责 Java 接口的详细设计。',
          result: 'pending',
          next: 'unknown',
          unresolved: []
        },
        'HR'
      )
      expect(repository.getInterviewAnswers(interviewId)).toBeNull()
      // An answer built from the superseded notes is refused rather than stored.
      expect(repository.saveInterviewAnswers(source!, [answer])).toBe(false)
    })
  })
})
