import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('acts as the primary SES task surface without duplicating dashboard metrics', async () => {
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([]) } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    const onImportResume = vi.fn()
    const onOpenCaseImport = vi.fn()
    render(<AgentWorkspace
      onImportResume={onImportResume}
      onOpenCaseImport={onOpenCaseImport}
      onOpenMatching={vi.fn()}
      status={{ activeCaseCount: 2, eligibleCandidateCount: 3, pendingReviewCount: 1, runningJobCount: 1, backupReminder: 'due' }}
    />)

    expect(await screen.findByRole('heading', { name: 'SES Agent' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'タスク' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '業務ステータス' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /履歴書を取り込む/u }))
    fireEvent.click(screen.getByRole('button', { name: /案件を取り込む/u }))
    expect(onImportResume).toHaveBeenCalledTimes(1)
    expect(onOpenCaseImport).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '履歴書を添付' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '面談を設定できる候補者は？' }))
    expect(screen.getByRole('textbox', { name: 'SES Agent への指示' })).toHaveValue('面談を設定できる候補者は？')
  })

  it('copies a sent user message without invoking Main or the model', async () => {
    const conversation = snapshot([
      { id: 'user-copy', role: 'user', content: '复制这条输入', mode: 'local', createdAt: '2026-08-18T00:00:00.000Z' },
      { id: 'assistant-copy', role: 'assistant', content: '回答', mode: 'local', createdAt: '2026-08-18T00:00:01.000Z' }
    ])
    const executeAgentTurn = vi.fn()
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([conversation]), executeAgentTurn } as DesktopApi
    const previousClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    try {
      render(<AgentWorkspace onOpenMatching={vi.fn()} />)
      fireEvent.click(await screen.findByRole('button', { name: 'コピー' }))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('复制这条输入'))
      expect(screen.getByRole('button', { name: 'コピー済み' })).toBeInTheDocument()
      expect(executeAgentTurn).not.toHaveBeenCalled()
    } finally {
      if (previousClipboard) Object.defineProperty(navigator, 'clipboard', previousClipboard)
      else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    }
  })

  it('edits an earlier input by creating a new conversation branch and resending from its prefix', async () => {
    const originalConversation = snapshot([
      { id: 'user-first', role: 'user', content: '第一个问题', mode: 'local', turnId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', createdAt: '2026-08-18T00:00:00.000Z' },
      { id: 'assistant-first', role: 'assistant', content: '第一个回答', mode: 'local', turnId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', createdAt: '2026-08-18T00:00:01.000Z' },
      { id: 'user-second', role: 'user', content: '第二个问题', mode: 'local', turnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', createdAt: '2026-08-18T00:00:02.000Z' },
      { id: 'assistant-second', role: 'assistant', content: '第二个回答', mode: 'local', turnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', createdAt: '2026-08-18T00:00:03.000Z' }
    ])
    const saveAiConversation = vi.fn()
    const executeAgentTurn = vi.fn(async (input: ExecuteAgentTurnInput): Promise<ExecuteAgentTurnResult> => {
      const user: AiConversationSnapshot['messages'][number] = {
        id: 'user-edited', role: 'user', content: input.message, mode: 'local',
        turnId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', createdAt: '2026-08-18T00:01:01.000Z'
      }
      const assistant: AiConversationSnapshot['messages'][number] = {
        id: 'assistant-edited', role: 'assistant', content: '编辑后的回答', mode: 'local',
        turnId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', createdAt: '2026-08-18T00:01:02.000Z'
      }
      const conversation: AiConversationSnapshot = {
        ...originalConversation,
        id: input.conversationId,
        branchRootConversationId: originalConversation.id,
        messages: [originalConversation.messages[0]!, originalConversation.messages[1]!, user, assistant],
        revision: 1,
        createdAt: '2026-08-18T00:01:00.000Z',
        updatedAt: '2026-08-18T00:01:02.000Z'
      }
      return { status: 'completed', requestId: input.requestId, toolName: null, actionRunId: null, assistantMessage: assistant, conversation }
    })
    const deleteAiConversations = vi.fn()
    const api = {
      ...originalApi,
      listAiConversations: vi.fn().mockResolvedValue([originalConversation]),
      saveAiConversation,
      executeAgentTurn,
      deleteAiConversations
    } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    render(<AgentWorkspace onOpenMatching={vi.fn()} />)

    const originalMessage = await screen.findByText('第二个问题')
    fireEvent.click(within(originalMessage.closest('article')!).getByRole('button', { name: '編集して再送信' }))
    const editor = screen.getByRole('textbox', { name: '送信済み入力を編集' })
    expect(editor).toHaveValue('第二个问题')
    fireEvent.change(editor, { target: { value: '编辑后的第二个问题' } })
    fireEvent.click(screen.getByRole('button', { name: '再送信' }))

    await waitFor(() => expect(executeAgentTurn).toHaveBeenCalledTimes(1))
    expect(saveAiConversation).not.toHaveBeenCalled()
    expect(executeAgentTurn.mock.calls[0]![0]).toMatchObject({
      conversationId: expect.not.stringMatching(conversationId),
      expectedConversationRevision: null,
      message: '编辑后的第二个问题',
      attachmentFileTokens: [],
      branchFrom: {
        conversationId,
        messageId: 'user-second',
        expectedRevision: 1
      }
    })
    expect(deleteAiConversations).not.toHaveBeenCalled()
    expect(await screen.findByText('编辑后的回答')).toBeInTheDocument()
    expect(document.querySelectorAll('.ai-conversation-history-list article')).toHaveLength(1)
  })

  it('renders an authoritative interview receipt with controlled business actions', async () => {
    const sourceDocumentId = '77777777-7777-4777-8777-777777777777'
    const access = {
      type: 'system-access' as const,
      destination: 'interview-schedule' as const,
      receipt: {
        sourceDocumentId,
        candidateLabel: 'RESUME_1',
        scheduledAt: '2026-08-26T05:00:00.000Z',
        durationMinutes: 50,
        meetingMethod: 'zoom' as const,
        kind: 'recruiting' as const,
        meetingLinkStoredLocally: true
      }
    }
    const conversation = snapshot([{
      id: 'assistant-receipt', role: 'assistant', content: '面談を登録しました。', mode: 'local',
      createdAt: '2026-08-24T05:00:00.000Z', blocks: [access]
    }])
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([conversation]) } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    const onOpenCandidate = vi.fn()
    const onOpenSystemAccess = vi.fn()
    render(<AgentWorkspace onOpenCandidate={onOpenCandidate} onOpenMatching={vi.fn()} onOpenSystemAccess={onOpenSystemAccess} />)

    expect(await screen.findByText('2026-08-26 14:00 JST · 50 分 · Zoom')).toBeInTheDocument()
    expect(screen.getByText('Zoom リンクは端末内に保存済み')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '面談日程を開く' }))
    expect(onOpenSystemAccess).toHaveBeenCalledWith(access)
    fireEvent.click(screen.getByRole('button', { name: '履歴書を見る' }))
    expect(onOpenCandidate).toHaveBeenCalledWith(sourceDocumentId, 'resume')
    fireEvent.click(screen.getByRole('button', { name: '質問を準備' }))
    expect(onOpenCandidate).toHaveBeenCalledWith(sourceDocumentId, 'prepare')
  })

  it('keeps a contextual business workspace beside the conversation and closes it with Escape', async () => {
    const onCloseContextPanel = vi.fn()
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([]) } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    render(<AgentWorkspace
      contextPanel={<div>面试日程内容</div>}
      contextPanelLabel="面试日程工作区"
      onCloseContextPanel={onCloseContextPanel}
      onOpenMatching={vi.fn()}
    />)

    const workspace = await screen.findByRole('main', { name: 'SES Agent' })
    expect(workspace).toHaveClass('has-context-panel')
    expect(screen.getByRole('complementary', { name: '面试日程工作区' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: '右ワークスペースの幅を調整' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCloseContextPanel).toHaveBeenCalledTimes(1)
  })

  it('sends the active right workspace reference with the next normal turn', async () => {
    const executeAgentTurn = vi.fn().mockResolvedValue({
      status: 'completed', toolName: null, actionRunId: null, assistantMessage: null,
      conversation: snapshot([{ id: 'user-1', role: 'user', content: '总结右侧案件', mode: 'cloud', createdAt: '2026-08-18T00:00:00.000Z' }])
    })
    Object.defineProperty(window, 'sesAgent', {
      configurable: true,
      value: {
        ...originalApi,
        listAiConversations: vi.fn().mockResolvedValue([]),
        executeAgentTurn,
        cancelAgentTurn: vi.fn()
      } as unknown as DesktopApi
    })
    const activeSystemAccess = { type: 'system-access' as const, destination: 'job-cases' as const }
    render(<AgentWorkspace
      activeSystemAccess={activeSystemAccess}
      contextPanel={<div>案件列表</div>}
      contextPanelLabel="業務ワークスペース"
      onCloseContextPanel={vi.fn()}
      onOpenMatching={vi.fn()}
    />)

    expect(await screen.findByText('右ワークスペースを参照')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'SES Agent への指示' }), { target: { value: '总结右侧案件' } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))

    await waitFor(() => expect(executeAgentTurn).toHaveBeenCalledTimes(1))
    expect(executeAgentTurn.mock.calls[0]?.[0]).toMatchObject({ activeSystemAccess })
  })

  it('ties an import made before the first message to the conversation it will become', async () => {
    // A new conversation has no id until its first turn is saved, so an import
    // done beforehand registered against nothing and the turn that followed did
    // not know the operator had just added that person.
    const token = '88888888-8888-4888-8888-888888888888'
    let importedConversation: AiConversationSnapshot | null = null
    const analyzeResumeFile = vi.fn(async (input: { conversationId: string }) => {
      importedConversation = {
        ...snapshot([{
          id: 'assistant-import', role: 'assistant', content: '履歴書を取り込みました。', mode: 'local',
          createdAt: '2026-08-18T00:00:00.000Z',
          blocks: [{ type: 'resume-import', imported: [{ documentId: token, label: 'RESUME_1', ordinal: 1 }], failedCount: 0 }]
        }]),
        id: input.conversationId
      }
      return { conversation: importedConversation }
    })
    const saveAiConversation = vi.fn(async (input: Parameters<DesktopApi['saveAiConversation']>[0]) => ({
      id: input.conversationId,
      context: input.context,
      title: input.messages.find((message) => message.role === 'user')?.content ?? '新しい会話',
      messages: input.messages,
      salesAgentState: input.salesAgentState,
      revision: 1,
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:01.000Z'
    }))
    const executeAgentTurn = vi.fn().mockResolvedValue({
      status: 'completed', toolName: null, actionRunId: null, assistantMessage: null,
      conversation: snapshot([
        { id: 'user-1', role: 'user', content: '安排面试', mode: 'cloud', turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-18T00:00:00.000Z' }
      ])
    })
    const api = {
      ...originalApi,
      listAiConversations: vi.fn().mockResolvedValue([]),
      executeAgentTurn,
      cancelAgentTurn: vi.fn(),
      analyzeResumeFile,
      saveAiConversation,
      stageDroppedResumeFiles: vi.fn().mockResolvedValue({
        cancelled: false,
        task: { id: 'task-1' },
        files: [{ token, name: 'candidate.pdf', format: 'pdf', size: 10, sha256: 'a'.repeat(64), createdAt: '2026-08-18T00:00:00.000Z', privacyStatus: 'awaiting-local-scan' }]
      }),
      previewStagedResumeFile: vi.fn().mockResolvedValue({
        documentId: token, label: 'candidate', confirmed: false, reviewStatus: 'awaiting-review', fields: [], projects: []
      })
    } as unknown as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    render(<AgentWorkspace onOpenMatching={vi.fn()} />)

    const composer = await screen.findByRole('textbox', { name: 'SES Agent への指示' })
    fireEvent.drop(composer.closest('section')!, { dataTransfer: { files: [new File(['x'], 'candidate.pdf')] } })
    await screen.findByText('candidate.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'そのまま取込' }))
    await waitFor(() => expect(analyzeResumeFile).toHaveBeenCalled())

    const importedInto = analyzeResumeFile.mock.calls[0]?.[0]?.conversationId
    expect(importedInto).toEqual(expect.any(String))
    expect(saveAiConversation).not.toHaveBeenCalled()
    expect(importedConversation).toMatchObject({ id: importedInto })

    // The first turn must land in that same conversation, not a freshly minted one.
    fireEvent.change(composer, { target: { value: '安排面试' } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    await waitFor(() => expect(executeAgentTurn).toHaveBeenCalled())
    expect(executeAgentTurn.mock.calls[0]?.[0]?.conversationId).toBe(importedInto)
  })

  it('keeps an attachment across a read-only turn so it can still be imported afterwards', async () => {
    const token = '77777777-7777-4777-8777-777777777777'
    const executeAgentTurn = vi.fn().mockResolvedValue({
      status: 'completed', toolName: null, actionRunId: null, assistantMessage: null,
      conversation: snapshot([
        { id: 'user-1', role: 'user', content: '总结一下这个人', mode: 'cloud', turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-18T00:00:00.000Z' }
      ])
    })
    const api = {
      ...originalApi,
      listAiConversations: vi.fn().mockResolvedValue([]),
      executeAgentTurn,
      cancelAgentTurn: vi.fn(),
      stageDroppedResumeFiles: vi.fn().mockResolvedValue({
        cancelled: false,
        task: { id: 'task-1' },
        files: [{ token, name: 'candidate.pdf', format: 'pdf', size: 10, sha256: 'a'.repeat(64), createdAt: '2026-08-18T00:00:00.000Z', privacyStatus: 'awaiting-local-scan' }]
      }),
      previewStagedResumeFile: vi.fn().mockResolvedValue({
        documentId: token, label: 'candidate', confirmed: false, reviewStatus: 'awaiting-review',
        fields: [{ label: 'スキル', value: 'Java', confidence: 0.9, status: 'needs_review', sources: [] }],
        projects: []
      })
    } as unknown as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    render(<AgentWorkspace onOpenMatching={vi.fn()} />)

    const composer = await screen.findByRole('textbox', { name: 'SES Agent への指示' })
    fireEvent.drop(composer.closest('section')!, { dataTransfer: { files: [new File(['x'], 'candidate.pdf')] } })
    await waitFor(() => expect(api.stageDroppedResumeFiles).toHaveBeenCalled())
    await screen.findByText('candidate.pdf')

    fireEvent.change(composer, { target: { value: '总结一下这个人' } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    await waitFor(() => expect(executeAgentTurn).toHaveBeenCalledTimes(1))

    // The summary turn must not consume the attachment - the import decision comes after it.
    expect(await screen.findByText('candidate.pdf')).toBeInTheDocument()
    expect(executeAgentTurn.mock.calls[0]?.[0]?.attachmentFileTokens).toEqual([token])
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

    const input = await screen.findByRole('textbox', { name: 'SES Agent への指示' })
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

    const input = await screen.findByRole('textbox', { name: 'SES Agent への指示' })
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
    const input = await screen.findByRole('textbox', { name: 'SES Agent への指示' })
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

    const input = await screen.findByRole('textbox', { name: 'SES Agent への指示' })
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

    const workspace = await screen.findByRole('main', { name: 'SES Agent' })
    expect(workspace).toHaveClass('agent-workspace')
    const input = screen.getByRole('textbox', { name: 'SES Agent への指示' })
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
    const composer = screen.getByRole('textbox', { name: 'SES Agent への指示' })
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
    const composer = await screen.findByRole('textbox', { name: 'SES Agent への指示' })
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
    const composer = screen.getByRole('textbox', { name: 'SES Agent への指示' })
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
    const composer = await screen.findByRole('textbox', { name: 'SES Agent への指示' })
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

  it('renders local evidence as interactive cards and routes only through controlled callbacks', async () => {
    const sourceDocumentId = '77777777-7777-4777-8777-777777777777'
    const candidateProfileId = '88888888-8888-4888-8888-888888888888'
    const matchRunId = '99999999-9999-4999-8999-999999999999'
    const interviewId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const conversation = snapshot([{
      id: 'assistant-evidence', role: 'assistant', content: '已读取本地证据。', mode: 'local',
      createdAt: '2026-08-18T00:00:00.000Z',
      blocks: [
        {
          type: 'candidate-profile-evidence',
          facts: {
            runId: matchRunId, validity: 'current',
            candidate: { candidateProfileId, sourceDocumentId, rank: 1, anonymousLabel: 'CANDIDATE_1' },
            profile: {
              profileVersion: 2, skills: 'Java / AWS', experienceYears: '8年', availability: '即日', rate: '90万円',
              japaneseLevel: 'N1', workStyle: 'リモート', role: 'バックエンド', location: '東京',
              workAuthorization: '就労制限なし',
              projectExperiences: [{ title: '決済基盤', period: '2024-2026', role: 'Tech Lead', technologies: ['Java'], summary: '決済基盤を設計。' }]
            }
          }
        },
        {
          type: 'candidate-interview-evidence',
          facts: {
            runId: matchRunId, validity: 'current',
            candidate: { candidateProfileId, sourceDocumentId, rank: 1, anonymousLabel: 'CANDIDATE_1' },
            interviews: [{
              interviewId, kind: 'recruiting', roundNumber: 1, stage: 'scheduled',
              scheduledAt: '2026-08-21T10:00:00.000Z', durationMinutes: 60, meetingMethod: 'zoom',
              interviewer: '採用担当', interviewGoal: '技術確認', interviewNotes: null, unresolvedItems: [],
              decision: null, decisionReason: null, updatedAt: '2026-08-18T00:00:00.000Z'
            }]
          }
        },
        { type: 'resume-import', imported: [{ documentId: sourceDocumentId, label: 'RESUME_1', ordinal: 1 }], failedCount: 0 }
      ]
    }])
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([conversation]) } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    const onOpenCandidate = vi.fn()
    const onOpenOriginalDocument = vi.fn().mockResolvedValue({ opened: true })
    render(<AgentWorkspace onOpenCandidate={onOpenCandidate} onOpenMatching={vi.fn()} onOpenOriginalDocument={onOpenOriginalDocument} />)

    expect(await screen.findByText('Java / AWS')).toBeInTheDocument()
    expect(screen.getByText('決済基盤')).toBeInTheDocument()
    expect(screen.getByText(/採用面談/u)).toBeInTheDocument()
    expect(screen.getAllByText('RESUME_1').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '候補者プロフィールを開く' }))
    expect(onOpenCandidate).toHaveBeenCalledWith(sourceDocumentId, 'overview')
    fireEvent.click(screen.getByRole('button', { name: 'この面談を開く' }))
    expect(onOpenCandidate).toHaveBeenCalledWith(sourceDocumentId, 'prepare', interviewId, 'recruiting')
    fireEvent.click(screen.getAllByRole('button', { name: /元ファイルを開く|ファイルを開く/u })[0]!)
    await waitFor(() => expect(onOpenOriginalDocument).toHaveBeenCalledWith(sourceDocumentId))
  })
})
