import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiConversationContext, AiConversationSnapshot, DesktopApi } from '@shared'
import { useAiConversationHistory } from './useAiConversationHistory'

const context: AiConversationContext = {
  assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null
}

function conversation(id: string, content: string, revision = 1): AiConversationSnapshot {
  return {
    id,
    context,
    title: content,
    messages: [{ id: `${id}-message`, role: 'assistant', content, createdAt: '2026-08-18T00:00:00.000Z' }],
    salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null },
    revision,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: `2026-08-18T00:00:0${revision}.000Z`
  }
}

describe('useAiConversationHistory', () => {
  const originalApi = window.sesAgent

  afterEach(() => {
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: originalApi })
  })

  it('does not let a late history read replace a conversation just accepted from Main', async () => {
    let resolveHistory!: (value: AiConversationSnapshot[]) => void
    const listAiConversations = vi.fn(() => new Promise<AiConversationSnapshot[]>((resolve) => { resolveHistory = resolve }))
    Object.defineProperty(window, 'sesAgent', {
      configurable: true,
      value: { ...originalApi, listAiConversations } as DesktopApi
    })
    const oldConversation = conversation('11111111-1111-4111-8111-111111111111', '旧会话')
    const completedConversation = conversation('22222222-2222-4222-8222-222222222222', '刚完成的会话', 2)
    const { result } = renderHook(() => useAiConversationHistory(context))

    act(() => result.current.acceptConversation(completedConversation))
    await act(async () => resolveHistory([oldConversation]))

    expect(result.current.activeConversationId).toBe(completedConversation.id)
    expect(result.current.messages.at(-1)?.content).toBe('刚完成的会话')
    expect(result.current.conversations.map((item) => item.id)).toContain(oldConversation.id)
  })

  it('persists selected Agent context with the latest conversation revision', async () => {
    const existing = conversation('33333333-3333-4333-8333-333333333333', '案件一覧')
    const saveAiConversation = vi.fn(async (input: Parameters<DesktopApi['saveAiConversation']>[0]) => ({
      ...existing,
      messages: input.messages,
      salesAgentState: input.salesAgentState,
      revision: 2,
      updatedAt: '2026-08-18T00:00:02.000Z'
    }))
    Object.defineProperty(window, 'sesAgent', {
      configurable: true,
      value: {
        ...originalApi,
        listAiConversations: vi.fn().mockResolvedValue([existing]),
        saveAiConversation
      } as DesktopApi
    })
    const { result } = renderHook(() => useAiConversationHistory(context))
    await waitFor(() => expect(result.current.loading).toBe(false))
    const selectedJobCaseRef = {
      kind: 'job-case' as const,
      objectId: '44444444-4444-4444-8444-444444444444', objectVersion: 2, resultHash: null, ordinal: 1,
      label: 'Java 案件', target: 'job-case:44444444-4444-4444-8444-444444444444'
    }

    await act(async () => {
      await result.current.persistSalesAgentState({
        selectedJobCaseRef, lastMatchRunId: null, lastSearchMessageId: existing.messages[0]!.id
      })
    })

    expect(saveAiConversation).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: existing.id,
      expectedRevision: 1,
      salesAgentState: expect.objectContaining({ selectedJobCaseRef })
    }))
    expect(result.current.conversations[0]?.revision).toBe(2)
  })
})
