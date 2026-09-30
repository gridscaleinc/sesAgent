// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'

const salesContext = {
  assistant: 'sales-agent' as const,
  candidateDocumentId: null,
  interviewId: null,
  interviewKind: null,
  roundNumber: null
}
const conversationId = '11111111-1111-4111-8111-111111111111'
const turnId = '22222222-2222-4222-8222-222222222222'
const message = (id: string, content: string, role: 'user' | 'assistant' = 'user') => ({
  id,
  role,
  content,
  mode: 'local' as const,
  turnId,
  createdAt: '2026-09-01T00:00:00.000Z'
})

describe.skipIf(!nativeSqliteAvailable)('AgentConversationStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  beforeEach(() => {
    handle = openTestRepository()
  })
  afterEach(() => handle.dispose())

  it('creates, appends to, lists and deletes a Sales Agent conversation', () => {
    const { repository } = handle
    const created = repository.saveAiConversation(
      {
        conversationId,
        context: salesContext,
        messages: [message('m1', 'Java案件を探して')],
        expectedRevision: null
      },
      new Date('2026-09-01T00:00:00.000Z')
    )
    expect(created).toMatchObject({ id: conversationId, revision: 1, title: 'Java案件を探して' })
    const updated = repository.saveAiConversation(
      {
        conversationId,
        context: salesContext,
        messages: [message('m1', 'Java案件を探して'), message('m2', '3件見つかりました', 'assistant')],
        expectedRevision: 1
      },
      new Date('2026-09-01T00:01:00.000Z')
    )
    expect(updated.revision).toBe(2)
    expect(updated.createdAt).toBe(created.createdAt)

    const reopened = handle.reopen()
    expect(reopened.getAiConversation(conversationId)?.messages.map((item) => item.id)).toEqual(['m1', 'm2'])
    expect(reopened.listAiConversations(salesContext).map((item) => item.id)).toEqual([conversationId])
    expect(reopened.deleteAiConversations([conversationId, '33333333-3333-4333-8333-333333333333'])).toEqual([conversationId])
    expect(reopened.getAiConversation(conversationId)).toBeNull()
  })

  it('rejects stale revisions, phantom updates, and moving a conversation to another context', () => {
    const { repository } = handle
    expect(() =>
      repository.saveAiConversation({
        conversationId,
        context: salesContext,
        messages: [message('m1', 'x')],
        expectedRevision: 3
      })
    ).toThrow(/見つかりません/)
    repository.saveAiConversation({ conversationId, context: salesContext, messages: [message('m1', 'x')], expectedRevision: null })
    expect(() =>
      repository.saveAiConversation({
        conversationId,
        context: salesContext,
        messages: [message('m1', 'x')],
        expectedRevision: null
      })
    ).toThrow(/更新されました/)
    expect(() =>
      repository.saveAiConversation({
        conversationId,
        context: {
          assistant: 'candidate-profile',
          candidateDocumentId: '44444444-4444-4444-8444-444444444444',
          interviewId: null,
          interviewKind: null,
          roundNumber: null
        },
        messages: [message('m1', 'x')],
        expectedRevision: 1
      })
    ).toThrow(/別の候補者または面談/)
    // A Sales Agent conversation cannot carry a candidate context at all.
    expect(() =>
      repository.saveAiConversation({
        conversationId: '55555555-5555-4555-8555-555555555555',
        context: { ...salesContext, candidateDocumentId: '44444444-4444-4444-8444-444444444444' },
        messages: [message('m1', 'x')],
        expectedRevision: null
      })
    ).toThrow()
  })
})
