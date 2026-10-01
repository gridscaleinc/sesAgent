// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { builtInPersonnelTemplates, generatePersonnelMessage } from '@shared'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { seedConfirmedCase, seedDraftCase, seedImportedPerson } from './store-test-fixtures-business'

const privateName = 'TEST_PRIVATE_NAME'

describe.skipIf(!nativeSqliteAvailable)('PersonnelStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  const messageFor = (documentId: string) => {
    const review = handle.repository.getCandidateReview(documentId)!
    const template = builtInPersonnelTemplates()[0]!
    return {
      documentId,
      profileVersion: review.profile!.version,
      reviewRevision: review.reviewRevision,
      templateId: template.id,
      templateRevision: template.revision,
      lang: 'ja' as const,
      text: generatePersonnelMessage(review, template, 'ja')
    }
  }

  describe('business feed and marks', () => {
    it('lists a new person as unseen, persists defer across reopen and rejects stale acknowledgements', () => {
      const person = seedImportedPerson(handle.repository, { privateName })
      const entry = handle.repository.getBusinessFeed().find((item) => item.kind === 'person' && item.objectId === person.documentId)!
      expect(entry).toMatchObject({ unseen: true, deferred: false, businessStatus: 'available', needsReview: false })

      handle.repository.markBusinessFeed({ kind: entry.kind, objectId: entry.objectId, revision: entry.revision, action: 'defer' })
      const reopened = handle
        .reopen()
        .getBusinessFeed()
        .find((item) => item.objectId === person.documentId)!
      expect(reopened).toMatchObject({ unseen: false, deferred: true })

      expect(() =>
        handle.repository.markBusinessFeed({ kind: entry.kind, objectId: entry.objectId, revision: 'f'.repeat(64), action: 'seen' })
      ).toThrow(/更新/)
    })

    it('marks a person unread again when its business state changes', () => {
      const person = seedImportedPerson(handle.repository, { privateName })
      const entry = handle.repository.getBusinessFeed().find((item) => item.objectId === person.documentId)!
      handle.repository.markBusinessFeed({ kind: entry.kind, objectId: entry.objectId, revision: entry.revision, action: 'seen' })
      handle.repository.setCandidateBusinessState(
        {
          documentId: person.documentId,
          profileVersion: person.profile!.version,
          reviewRevision: person.reviewRevision,
          status: 'paused',
          confirmed: true
        },
        'test-hr'
      )
      const after = handle.repository.getBusinessFeed().find((item) => item.objectId === person.documentId)!
      expect(after).toMatchObject({ unseen: true, event: 'status-changed', businessStatus: 'paused' })
      // The old revision can no longer acknowledge the new state.
      expect(() =>
        handle.repository.markBusinessFeed({ kind: entry.kind, objectId: entry.objectId, revision: entry.revision, action: 'seen' })
      ).toThrow()
    })
  })

  describe('case working set', () => {
    it('adds only on explicit request, never changes the feed revision, survives reopen, and drops invalid cases', () => {
      const reviewId = seedDraftCase(handle.repository).reviewId
      const feedCase = () => handle.repository.getBusinessFeed().find((item) => item.kind === 'case' && item.objectId === reviewId)!
      expect(feedCase().working).toBe(false)
      const revisionBefore = feedCase().revision
      expect(handle.repository.setCaseWorking({ reviewId, working: true }, 'HR')).toEqual({ reviewId, working: true })
      handle.repository.setCaseWorking({ reviewId, working: true }, 'HR')
      expect(feedCase()).toMatchObject({ working: true, revision: revisionBefore })
      handle.reopen()
      expect(feedCase().working).toBe(true)

      handle.repository.setJobCaseLifecycle({ reviewId, state: 'archived', reason: '案件已结束' }, 'HR')
      expect(feedCase().working).toBe(false)
      expect(() => handle.repository.setCaseWorking({ reviewId, working: true }, 'HR')).toThrow(/无效案件/)
    })
  })

  describe('business state', () => {
    it('stores the state and rejects a stale profile version or review revision', () => {
      const person = seedImportedPerson(handle.repository, { privateName })
      const base = {
        documentId: person.documentId,
        profileVersion: person.profile!.version,
        reviewRevision: person.reviewRevision,
        confirmed: true as const
      }
      expect(() =>
        handle.repository.setCandidateBusinessState({ ...base, profileVersion: base.profileVersion + 1, status: 'available' }, 'test-hr')
      ).toThrow(/更新|再確認/)
      expect(() =>
        handle.repository.setCandidateBusinessState({ ...base, reviewRevision: base.reviewRevision + 1, status: 'available' }, 'test-hr')
      ).toThrow(/更新|再確認/)
      // Unreviewed personnel must carry the review revision they were shown.
      const { reviewRevision: _, ...withoutRevision } = base
      expect(() => handle.repository.setCandidateBusinessState({ ...withoutRevision, status: 'available' }, 'test-hr')).toThrow(
        /更新|再確認/
      )

      const state = handle.repository.setCandidateBusinessState({ ...base, status: 'assigned' }, 'test-hr')
      expect(state).toMatchObject({ documentId: person.documentId, status: 'assigned', actorId: 'test-hr' })
      expect(handle.reopen().getPersonnelWorkspace().states).toEqual([
        expect.objectContaining({ documentId: person.documentId, status: 'assigned' })
      ])
    })
  })

  describe('personnel messages and copies', () => {
    it('records a copy of a valid anonymous introduction without keeping the text', () => {
      const person = seedImportedPerson(handle.repository, { privateName })
      const message = messageFor(person.documentId)
      expect(handle.repository.validatePersonnelMessage(message).text).toBe(message.text)
      handle.repository.recordPersonnelCopy(message, 'test-hr')
      const copies = handle.reopen().getPersonnelWorkspace().copies
      expect(copies).toHaveLength(1)
      expect(copies[0]).toMatchObject({ documentId: person.documentId, templateId: message.templateId })
      expect('text' in copies[0]!).toBe(false)
    })

    it('blocks direct identifiers, local names, recipients, stale revisions and unavailable personnel', () => {
      const person = seedImportedPerson(handle.repository, { privateName })
      const message = messageFor(person.documentId)
      expect(() => handle.repository.validatePersonnelMessage({ ...message, text: '連絡先 test@example.com' })).toThrow(
        /联系方式|直接識別子/
      )
      expect(() => handle.repository.validatePersonnelMessage({ ...message, text: '電話 090-1234-5678 まで' })).toThrow(
        /联系方式|直接識別子/
      )
      expect(() => handle.repository.validatePersonnelMessage({ ...message, text: privateName })).toThrow(/个人身份|匿名/)
      expect(() => handle.repository.validatePersonnelMessage({ ...message, to: 'test@example.com' } as never)).toThrow()
      expect(() => handle.repository.validatePersonnelMessage({ ...message, reviewRevision: message.reviewRevision + 1 })).toThrow(/更新/)
      expect(() => handle.repository.recordPersonnelCopy({ ...message, text: '連絡先 test@example.com' }, 'test-hr')).toThrow()
      expect(handle.repository.getPersonnelWorkspace().copies).toHaveLength(0)

      handle.repository.setCandidateBusinessState(
        {
          documentId: person.documentId,
          profileVersion: message.profileVersion,
          reviewRevision: message.reviewRevision,
          status: 'paused',
          confirmed: true
        },
        'test-hr'
      )
      expect(() => handle.repository.validatePersonnelMessage(message)).toThrow(/暂停|停止/)
    })

    it('rejects a case context whose confirmed version changed', () => {
      const person = seedImportedPerson(handle.repository, { privateName })
      const job = seedConfirmedCase(handle.repository)
      const message = { ...messageFor(person.documentId), caseContext: { reviewId: job.reviewId, version: job.jobCase!.version } }
      expect(handle.repository.validatePersonnelMessage(message).caseContext?.reviewId).toBe(job.reviewId)
      expect(() =>
        handle.repository.validatePersonnelMessage({ ...message, caseContext: { ...message.caseContext, version: 99 } })
      ).toThrow(/更新/)
    })
  })

  describe('templates', () => {
    it('saves a template revision, invalidates old messages and rejects stale or identifying templates', () => {
      const person = seedImportedPerson(handle.repository, { privateName })
      const message = messageFor(person.documentId)
      const template = builtInPersonnelTemplates()[0]!
      handle.repository.savePersonnelTemplate({ ...template, name: 'HR custom' })
      expect(handle.repository.getPersonnelWorkspace().templates.find((item) => item.id === template.id)).toMatchObject({
        name: 'HR custom',
        revision: template.revision + 1
      })
      expect(() => handle.repository.savePersonnelTemplate(template)).toThrow(/更新|再読込/)
      expect(() => handle.repository.validatePersonnelMessage(message)).toThrow(/模板|テンプレート/)
      expect(() =>
        handle.repository.savePersonnelTemplate({
          ...template,
          revision: template.revision + 1,
          bodyJa: `${template.bodyJa}\n連絡先 test@example.com`
        })
      ).toThrow(/联系方式|連絡先/)
      expect(
        handle
          .reopen()
          .getPersonnelWorkspace()
          .templates.find((item) => item.id === template.id)?.revision
      ).toBe(template.revision + 1)
    })
  })

  describe('manual follow-ups', () => {
    it('saves follow-ups with optimistic revisions and cascades them with personnel deletion', () => {
      const person = seedImportedPerson(handle.repository, { privateName })
      const job = seedConfirmedCase(handle.repository)
      const base = { documentId: person.documentId, reviewId: job.reviewId }
      const follow = handle.repository.saveBusinessFollowUp(
        { ...base, expectedRevision: 0, status: 'contacted', note: 'Synthetic contact', nextStep: 'Await reply' },
        'test-hr'
      )
      expect(follow.revision).toBe(1)
      expect(() =>
        handle.repository.saveBusinessFollowUp({ ...base, expectedRevision: 0, status: 'replied', note: 'stale', nextStep: '' }, 'test-hr')
      ).toThrow(/更新/)
      const reply = handle.repository.saveBusinessFollowUp(
        { ...base, expectedRevision: 1, status: 'replied', note: 'Synthetic reply', nextStep: 'Interview' },
        'test-hr'
      )
      expect(reply.events).toHaveLength(2)
      expect(handle.reopen().listBusinessFollowUps()[0]!.note).toBe('Synthetic reply')

      const preview = handle.repository.previewCandidateDeletion(person.documentId)
      handle.repository.deleteCandidateDatabaseData(person.documentId, preview.confirmationHash)
      expect(handle.repository.listBusinessFollowUps()).toHaveLength(0)
      expect(handle.repository.getBusinessFeed().filter((item) => item.kind === 'person')).toHaveLength(0)
      expect(() =>
        handle.repository.saveBusinessFollowUp({ ...base, expectedRevision: 0, status: 'contacted', note: 'x', nextStep: '' }, 'test-hr')
      ).toThrow(/删除|削除/)
    })
  })

  it('keeps only the latest AI personnel introduction per case, language and style, and deletes them with the person', () => {
    const { repository } = handle
    const person = seedImportedPerson(repository)
    const caseReviewId = '44444444-4444-4444-8444-444444444444'
    const base = { documentId: person.documentId, profileVersion: 1, style: 'standard' as const, request: null }
    repository.savePersonnelIntroductionDrafts({
      ...base,
      caseContext: null,
      drafts: [{ lang: 'ja', text: '一般紹介', experienceRunId: null }]
    })
    repository.savePersonnelIntroductionDrafts({
      ...base,
      caseContext: { reviewId: caseReviewId, version: 3 },
      drafts: [{ lang: 'ja', text: '案件向け1', experienceRunId: null }]
    })
    repository.savePersonnelIntroductionDrafts({
      ...base,
      caseContext: { reviewId: caseReviewId, version: 3 },
      request: '管理経験',
      drafts: [{ lang: 'ja', text: '案件向け2', experienceRunId: 'run' }]
    })
    const stored = repository.listPersonnelIntroductionDrafts(person.documentId)
    expect(stored.map((draft) => [draft.caseReviewId, draft.jobCaseVersion, draft.text, draft.request])).toEqual([
      [null, null, '一般紹介', null],
      [caseReviewId, 3, '案件向け2', '管理経験']
    ])
    // That case does not exist (deleted before deletion took its introductions along): reopening drops its text.
    expect(
      handle
        .reopen()
        .listPersonnelIntroductionDrafts(person.documentId)
        .map((draft) => draft.text)
    ).toEqual(['一般紹介'])
    const repository2 = handle.repository
    const preview = repository2.previewCandidateDeletion(person.documentId)
    repository2.deleteCandidateDatabaseData(person.documentId, preview.confirmationHash)
    expect(repository2.listPersonnelIntroductionDrafts(person.documentId)).toEqual([])
  })
})
