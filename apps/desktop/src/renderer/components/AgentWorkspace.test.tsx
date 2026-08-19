import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiConversationSnapshot, DesktopApi, ExecuteAgentTurnInput, ExecuteAgentTurnResult } from '@shared'
import { AgentWorkspace } from './AgentWorkspace'

const conversationId = '11111111-1111-4111-8111-111111111111'
const jobCaseId = '22222222-2222-4222-8222-222222222222'

function snapshot(messages: AiConversationSnapshot['messages']): AiConversationSnapshot {
  return {
    id: conversationId,
    context: { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null },
    title: messages[0]?.content ?? '最近有什么案件？',
    messages,
    salesAgentState: { selectedJobCaseRef: null, lastMatchRunId: null, lastSearchMessageId: null },
    revision: 1,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z'
  }
}

describe('AgentWorkspace', () => {
  const originalApi = window.sesAgent
  const originalWidth = window.innerWidth

  afterEach(() => {
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: originalApi })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
    window.sessionStorage.clear()
  })

  it('refreshes the local snapshot after the agent imports a resume, so it appears in the candidate list', async () => {
    const executeAgentTurn = vi.fn().mockResolvedValue({
      status: 'completed', toolName: 'resume.analyze.local', actionRunId: null, assistantMessage: null,
      conversation: snapshot([
        { id: 'user-1', role: 'user', content: '导入这份简历', mode: 'local', turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-18T00:00:00.000Z' }
      ])
    })
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([]), executeAgentTurn, cancelAgentTurn: vi.fn() } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    const onLocalDataChanged = vi.fn()
    render(<AgentWorkspace onOpenMatching={vi.fn()} onLocalDataChanged={onLocalDataChanged} />)

    const input = await screen.findByRole('textbox', { name: '案件 Agent への質問' })
    fireEvent.change(input, { target: { value: '导入这份简历' } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))

    await waitFor(() => expect(onLocalDataChanged).toHaveBeenCalledTimes(1))
  })

  it('does not refresh the local snapshot for a read-only turn', async () => {
    const executeAgentTurn = vi.fn().mockResolvedValue({
      status: 'completed', toolName: 'match-run.read.local', actionRunId: null, assistantMessage: null,
      conversation: snapshot([
        { id: 'user-1', role: 'user', content: '为什么第一名排第一？', mode: 'local', turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-18T00:00:00.000Z' }
      ])
    })
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([]), executeAgentTurn, cancelAgentTurn: vi.fn() } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    const onLocalDataChanged = vi.fn()
    render(<AgentWorkspace onOpenMatching={vi.fn()} onLocalDataChanged={onLocalDataChanged} />)

    const input = await screen.findByRole('textbox', { name: '案件 Agent への質問' })
    fireEvent.change(input, { target: { value: '为什么第一名排第一？' } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))

    await waitFor(() => expect(executeAgentTurn).toHaveBeenCalledTimes(1))
    expect(onLocalDataChanged).not.toHaveBeenCalled()
  })

  it('sends a turn through the Main-owned API and renders typed case cards', async () => {
    const executeAgentTurn = vi.fn().mockResolvedValue({ status: 'completed', toolName: 'job-case.search.local', actionRunId: null, assistantMessage: null, conversation: snapshot([
      { id: 'user-1', role: 'user', content: '最近有什么案件？', mode: 'local', turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-18T00:00:00.000Z' },
      {
        id: 'assistant-1', role: 'assistant', content: '最近 30 天有 1 个 Active 案件。', mode: 'local', turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-18T00:00:01.000Z',
        blocks: [{
          type: 'job-case-cards', query: '', dataAsOf: '2026-08-18T00:00:01.000Z',
          normalizedFilters: { updatedAfter: '2026-07-19T15:00:00.000Z', updatedBefore: '2026-08-18T15:00:00.000Z', lifecycle: 'active', query: null, limit: 20 },
          totalMatched: 1,
          cards: [{
            reference: { kind: 'job-case', objectId: jobCaseId, objectVersion: 2, resultHash: null, ordinal: 1, label: 'Java 案件', target: `job-case:${jobCaseId}` },
            title: 'Java 案件', version: 2, updatedAt: '2026-08-18T00:00:00.000Z', requiredSkills: 'Java', rate: null, workStyle: 'remote', startDate: null, status: 'current'
          }]
        }]
      }
    ]) })
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([]), executeAgentTurn, cancelAgentTurn: vi.fn() } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    render(<AgentWorkspace onOpenMatching={vi.fn()} />)

    expect(await screen.findByRole('option', { name: 'DeepSeek V4 Flash' })).toBeInTheDocument()
    const input = await screen.findByRole('textbox', { name: '案件 Agent への質問' })
    fireEvent.change(input, { target: { value: '最近有什么案件？' } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))

    await waitFor(() => expect(executeAgentTurn).toHaveBeenCalledTimes(1))
    expect(executeAgentTurn.mock.calls[0]?.[0]).toMatchObject({ message: '最近有什么案件？', expectedConversationRevision: null })
    expect(await screen.findByText('Java 案件')).toBeInTheDocument()
    expect(screen.getByText('現在')).toBeInTheDocument()
  })

  it('renders a deleted-reference tombstone without restoring the old card', async () => {
    const deleted = snapshot([
      { id: 'assistant-1', role: 'assistant', content: '关联案件已删除，历史引用不再显示。', mode: 'local', createdAt: '2026-08-18T00:00:00.000Z', blocks: [{ type: 'error', code: 'ENTITY_DELETED', entityKind: 'job-case', message: '关联案件已删除，历史引用不再显示。' }] }
    ])
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([deleted]), executeAgentTurn: vi.fn(), cancelAgentTurn: vi.fn() } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    render(<AgentWorkspace onOpenMatching={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('关联案件已删除，历史引用不再显示。')
    expect(screen.queryByText('Java 案件')).not.toBeInTheDocument()
  })

  it('can cancel the first turn before the conversation has been persisted', async () => {
    const executeAgentTurn = vi.fn(() => new Promise<never>(() => undefined))
    const cancelAgentTurn = vi.fn().mockResolvedValue({ status: 'cancelled', conversationId, requestId: '33333333-3333-4333-8333-333333333333' })
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([]), executeAgentTurn, cancelAgentTurn } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    render(<AgentWorkspace onOpenMatching={vi.fn()} />)

    const input = await screen.findByRole('textbox', { name: '案件 Agent への質問' })
    fireEvent.change(input, { target: { value: '最近有什么案件？' } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    fireEvent.click(await screen.findByRole('button', { name: '停止' }))

    await waitFor(() => expect(cancelAgentTurn).toHaveBeenCalledTimes(1))
    expect(cancelAgentTurn.mock.calls[0]?.[0]).toMatchObject({
      conversationId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu),
      requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu)
    })
  })

  it('keeps the composer reachable at 1100px and distinguishes Enter from Shift+Enter', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1100 })
    const executeAgentTurn = vi.fn().mockResolvedValue({ status: 'clarifying', toolName: null, actionRunId: null, assistantMessage: null, conversation: snapshot([]) })
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([]), executeAgentTurn, cancelAgentTurn: vi.fn() } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    render(<AgentWorkspace onOpenMatching={vi.fn()} />)

    const workspace = await screen.findByRole('main', { name: '案件マッチング Agent' })
    expect(workspace).toHaveClass('agent-workspace')
    const input = screen.getByRole('textbox', { name: '案件 Agent への質問' })
    expect(input).toBeVisible()

    fireEvent.change(input, { target: { value: '最近の案件は？' } })
    const enter = createEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: false })
    fireEvent(input, enter)
    expect(enter.defaultPrevented).toBe(true)
    await waitFor(() => expect(executeAgentTurn).toHaveBeenCalledTimes(1))

    fireEvent.change(input, { target: { value: '複数行の質問' } })
    const shiftEnter = createEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: true })
    fireEvent(input, shiftEnter)
    expect(shiftEnter.defaultPrevented).toBe(false)
    expect(input).toHaveValue('複数行の質問')
  })

  it('locks the selected model, renders progressive deltas, and ignores foreign or out-of-order events', async () => {
    let eventListener: Parameters<DesktopApi['onAgentTurnEvent']>[0] | null = null
    let resolveTurn!: (value: ExecuteAgentTurnResult) => void
    const executeAgentTurn = vi.fn((_input: ExecuteAgentTurnInput) => new Promise<ExecuteAgentTurnResult>((resolve) => { resolveTurn = resolve }))
    const onAgentTurnEvent = vi.fn((listener: Parameters<DesktopApi['onAgentTurnEvent']>[0]) => {
      eventListener = listener
      return vi.fn()
    })
    const api = {
      ...originalApi,
      listAiConversations: vi.fn().mockResolvedValue([]),
      executeAgentTurn,
      cancelAgentTurn: vi.fn(),
      onAgentTurnEvent
    } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    render(<AgentWorkspace onOpenMatching={vi.fn()} />)

    const selector = await screen.findByRole('combobox', { name: '回答モデルを選択' })
    fireEvent.change(selector, { target: { value: 'gpt-5.6-terra' } })
    const composer = screen.getByRole('textbox', { name: '案件 Agent への質問' })
    fireEvent.change(composer, { target: { value: '最近の案件は？' } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    await waitFor(() => expect(executeAgentTurn).toHaveBeenCalledTimes(1))
    expect(executeAgentTurn.mock.calls[0]?.[0]).toMatchObject({ modelKey: 'gpt-5.6-terra' })
    expect(selector).toBeDisabled()

    const submitted = executeAgentTurn.mock.calls[0]![0]
    const common = {
      conversationId: submitted.conversationId,
      requestId: submitted.requestId,
      modelKey: 'gpt-5.6-terra',
      modelDisplayName: 'GPT-5.6 Terra'
    }
    await act(async () => {
      eventListener?.({ ...common, type: 'started', phase: 'streaming', sequence: 1 })
      eventListener?.({ ...common, type: 'delta', text: '第一', sequence: 2 })
      eventListener?.({ ...common, conversationId: '99999999-9999-4999-8999-999999999999', type: 'delta', text: '跨会话泄漏', sequence: 3 })
      eventListener?.({ ...common, requestId: '88888888-8888-4888-8888-888888888888', type: 'delta', text: '跨请求泄漏', sequence: 3 })
      eventListener?.({ ...common, type: 'delta', text: '乱序', sequence: 2 })
      eventListener?.({ ...common, type: 'delta', text: '段', sequence: 3 })
    })
    expect(screen.getByTestId('agent-streaming-message')).toHaveTextContent('第一段')
    expect(screen.queryByText(/泄漏|乱序/u)).not.toBeInTheDocument()

    const finalConversation = snapshot([
      { id: 'user-final', role: 'user', content: '最近の案件は？', mode: 'local', createdAt: '2026-08-18T00:00:00.000Z' },
      { id: 'assistant-final', role: 'assistant', content: '最终回答', mode: 'cloud', modelKey: 'gpt-5.6-terra', modelDisplayName: 'GPT-5.6 Terra', narrativeStatus: 'completed', createdAt: '2026-08-18T00:00:01.000Z' }
    ])
    await act(async () => {
      resolveTurn({ status: 'completed', toolName: 'job-case.search.local', actionRunId: null, requestId: submitted.requestId, assistantMessage: finalConversation.messages[1]!, conversation: finalConversation })
    })
    expect(await screen.findByText('最终回答')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-streaming-message')).not.toBeInTheDocument()
    expect(screen.getAllByText('最终回答')).toHaveLength(1)
  })

  it('stops displaying deltas immediately and explains that Stop is not a refund guarantee', async () => {
    let eventListener: Parameters<DesktopApi['onAgentTurnEvent']>[0] | null = null
    const executeAgentTurn = vi.fn((_input: ExecuteAgentTurnInput) => new Promise<ExecuteAgentTurnResult>(() => undefined))
    const cancelAgentTurn = vi.fn().mockResolvedValue({
      status: 'cancelled', conversationId, requestId: 'unused', remoteCancelStatus: 'cancel_requested',
      message: 'AICommerce 已受理取消请求，但不代表 Provider 已停止，也不保证免费或退款。'
    })
    const api = {
      ...originalApi,
      listAiConversations: vi.fn().mockResolvedValue([]), executeAgentTurn, cancelAgentTurn,
      onAgentTurnEvent: vi.fn((listener) => { eventListener = listener; return vi.fn() })
    } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    render(<AgentWorkspace onOpenMatching={vi.fn()} />)
    const composer = await screen.findByRole('textbox', { name: '案件 Agent への質問' })
    fireEvent.change(composer, { target: { value: '最近の案件は？' } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    await waitFor(() => expect(executeAgentTurn).toHaveBeenCalledTimes(1))
    const submitted = executeAgentTurn.mock.calls[0]![0]
    const common = {
      conversationId: submitted.conversationId, requestId: submitted.requestId,
      modelKey: 'gpt-5.6-luna', modelDisplayName: 'GPT-5.6 Luna'
    }
    await act(async () => {
      eventListener?.({ ...common, type: 'delta', text: '已显示', sequence: 1 })
    })
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(screen.getByText(/無料・返金を保証しません/u)).toBeInTheDocument()
    await act(async () => {
      eventListener?.({ ...common, type: 'delta', text: '不应显示', sequence: 2 })
    })
    expect(screen.getByTestId('agent-streaming-message')).toHaveTextContent('已显示')
    expect(screen.queryByText('不应显示')).not.toBeInTheDocument()
    await waitFor(() => expect(cancelAgentTurn).toHaveBeenCalledTimes(1))
  })

  it('does not expose the selected model name in transient planning status text', async () => {
    const executeAgentTurn = vi.fn(() => new Promise<never>(() => undefined))
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([]), executeAgentTurn, cancelAgentTurn: vi.fn() } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    render(<AgentWorkspace onOpenMatching={vi.fn()} />)

    const selector = await screen.findByRole('combobox', { name: '回答モデルを選択' })
    fireEvent.change(selector, { target: { value: 'deepseek-v4-flash' } })
    const composer = screen.getByRole('textbox', { name: '案件 Agent への質問' })
    fireEvent.change(composer, { target: { value: '日语呢' } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))

    const status = await screen.findByText('質問を理解して Tool を選択中…')
    expect(status).not.toHaveTextContent('DeepSeek V4 Flash')
  })

  it('preserves the specific planning failure instead of overwriting it with a generic stream error', async () => {
    let eventListener: Parameters<DesktopApi['onAgentTurnEvent']>[0] | null = null
    let resolveTurn!: (value: ExecuteAgentTurnResult) => void
    const executeAgentTurn = vi.fn((_input: ExecuteAgentTurnInput) => new Promise<ExecuteAgentTurnResult>((resolve) => { resolveTurn = resolve }))
    const api = {
      ...originalApi,
      listAiConversations: vi.fn().mockResolvedValue([]),
      executeAgentTurn,
      cancelAgentTurn: vi.fn(),
      onAgentTurnEvent: vi.fn((listener) => { eventListener = listener; return vi.fn() })
    } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    render(<AgentWorkspace onOpenMatching={vi.fn()} />)
    const composer = await screen.findByRole('textbox', { name: '案件 Agent への質問' })
    fireEvent.change(composer, { target: { value: '日语呢' } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    await waitFor(() => expect(executeAgentTurn).toHaveBeenCalledTimes(1))
    const submitted = executeAgentTurn.mock.calls[0]![0]
    const failedConversation = snapshot([
      { id: 'user-failed', role: 'user', content: '日语呢', mode: 'local', createdAt: '2026-08-18T00:00:00.000Z' },
      { id: 'assistant-failed', role: 'assistant', content: 'AI 无法形成有效的受控 Tool 计划，请重试。', mode: 'local-fallback', narrativeStatus: 'failed-local-fallback', createdAt: '2026-08-18T00:00:01.000Z' }
    ])
    await act(async () => {
      eventListener?.({
        type: 'failed', conversationId: submitted.conversationId, requestId: submitted.requestId, sequence: 1,
        modelKey: 'gpt-5.6-luna', modelDisplayName: 'GPT-5.6 Luna', code: 'AGENT_PLANNING_FAILED',
        message: 'AI 无法形成有效的受控 Tool 计划。', localFallbackPreserved: true
      })
      resolveTurn({
        status: 'failed', toolName: null, actionRunId: null, requestId: submitted.requestId,
        assistantMessage: failedConversation.messages[1]!, conversation: failedConversation
      })
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('AI 无法形成有效的受控 Tool 计划。')
    expect(screen.getByRole('alert')).not.toHaveTextContent('AI 処理に失敗しました')
  })
})
