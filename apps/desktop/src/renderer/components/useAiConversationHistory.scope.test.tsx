import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useAiConversationHistory } from './useAiConversationHistory'
import type { AiConversationContext, AiConversationSnapshot } from '@shared'
const base = { assistant: 'sales-agent' as const, candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null }
const context = (id: string): AiConversationContext => ({ ...base, businessObject: { kind: 'case', id } })
it('discards a late read for the previous case and accepts a saved snapshot regardless of JSON property order', async () => {
  let old: (items: AiConversationSnapshot[]) => void = () => {}
  const list = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { old = resolve })).mockResolvedValue([])
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: { listAiConversations: list } })
  const { result, rerender } = renderHook(({ id }) => useAiConversationHistory(context(id)), { initialProps: { id: 'one' } })
  rerender({ id: 'two' })
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => old([{ id: 'old', context: context('one'), messages: [], updatedAt: '2026-09-09' } as unknown as AiConversationSnapshot]))
  expect(result.current.conversations).toEqual([])
  act(() => result.current.acceptConversation({ id: 'new', context: { businessObject: { kind: 'case', id: 'two' }, ...base }, messages: [], updatedAt: '2026-09-09' } as unknown as AiConversationSnapshot))
  expect(result.current.activeConversationId).toBe('new')
})

it('does not replace the next object history when a deletion finishes after switching objects', async () => {
  let finish: (value: any) => void = () => {}
  const item = (id: string) => ({ id, context: context(id), messages: [], updatedAt: '2026-09-09' }) as unknown as AiConversationSnapshot
  const list = vi.fn(async (value: AiConversationContext) => [item(value.businessObject!.id)])
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: { listAiConversations: list, deleteAiConversations: () => new Promise((resolve) => { finish = resolve }) } })
  const { result, rerender } = renderHook(({ id }) => useAiConversationHistory(context(id)), { initialProps: { id: 'one' } })
  await waitFor(() => expect(result.current.activeConversationId).toBe('one'))
  let deletion: Promise<void>
  act(() => { deletion = result.current.deleteConversations(['one']) })
  rerender({ id: 'two' })
  await waitFor(() => expect(result.current.activeConversationId).toBe('two'))
  await act(async () => { finish({ deletedConversationIds: ['one'] }); await deletion })
  expect(result.current.conversations.map((item) => item.id)).toEqual(['two'])
  expect(result.current.activeConversationId).toBe('two')
})
