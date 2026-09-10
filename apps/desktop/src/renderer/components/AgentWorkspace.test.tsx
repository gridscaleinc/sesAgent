import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiConversationSnapshot, DesktopApi, ExecuteAgentTurnInput, ExecuteAgentTurnResult, JobCaseReviewSnapshot } from '@shared'
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

  it('keeps the latest feed compact and restores a draft when the operator opens conversation', async () => {
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([]) } })
    const onOpenBatch = vi.fn()
    render(<AgentWorkspace latestContent={<div>Today feed</div>} onOpenBatch={onOpenBatch} onOpenMatching={vi.fn()} />)
    expect(screen.queryByRole('textbox', { name: 'SES Agent への指示' })).not.toBeInTheDocument()
    const bar = screen.getByRole('group', { name: '最新情報の操作' })
    fireEvent.click(within(bar).getByRole('button', { name: 'メッセージを貼り付け' }))
    expect(onOpenBatch).toHaveBeenCalledWith()
    fireEvent.click(within(bar).getByRole('button', { name: 'Agentに依頼したいことを入力…' }))
    const composer = screen.getByRole('textbox', { name: 'SES Agent への指示' })
    fireEvent.change(composer, { target: { value: 'Remote candidates only' } })
    fireEvent.click(screen.getByRole('button', { name: '最新情報' }))
    expect(screen.queryByRole('textbox', { name: 'SES Agent への指示' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '未送信の下書きを続ける' }))
    expect(screen.getByRole('textbox', { name: 'SES Agent への指示' })).toHaveValue('Remote candidates only')
  })

  it('keeps latest information compact even with a selected record and shows its composer only in conversation', async () => {
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([]) } })
    const onMatch = vi.fn(), onPromote = vi.fn()
    const base = { latestContent: <div>Today feed</div>, onOpenMatching: vi.fn() }
    const object = { kind: 'person' as const, label: 'TEST Java Engineer', onMatch, onPromote }
    const view = render(<AgentWorkspace {...base} contextPanelOpen composerObject={object} />)
    expect(screen.queryByRole('textbox', { name: 'SES Agent への指示' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: '最新情報の操作' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '現在の会話' }))
    const scope = screen.getByRole('group', { name: '現在の処理対象' })
    expect(within(scope).getByText('TEST Java Engineer')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'SES Agent への指示' })).toBeVisible()
    fireEvent.click(within(scope).getByRole('button', { name: '案件を探す' }))
    fireEvent.click(within(scope).getByRole('button', { name: '紹介文を作成' }))
    expect(onMatch).toHaveBeenCalledTimes(1); expect(onPromote).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '最新情報' }))
    view.rerender(<AgentWorkspace {...base} contextPanelOpen={false} composerObject={object} />)
    expect(screen.queryByRole('textbox', { name: 'SES Agent への指示' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: '最新情報の操作' })).toBeVisible()
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
      status={{ activeCaseCount: 2, eligibleCandidateCount: 3, runningJobCount: 1, backupReminder: 'due' }}
    />)

    expect(await screen.findByRole('heading', { name: 'SES Agent' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '会話' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '業務ステータス' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /履歴書を取り込む/u }))
    fireEvent.click(screen.getByRole('button', { name: /案件を取り込む/u }))
    expect(onImportResume).toHaveBeenCalledTimes(1)
    expect(onOpenCaseImport).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '履歴書を添付' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '面談を設定できる候補者は？' }))
    expect(screen.getByRole('textbox', { name: 'SES Agent への指示' })).toHaveValue('面談を設定できる候補者は？')
  })

  it('shares the right column between details and Agent and keeps history inside Agent', async () => {
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([snapshot([])]), executeAgentTurn: vi.fn() }
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    const onCloseContextPanel = vi.fn()
    const props = {
      businessTitle: '案件', latestContent: <div>Business list</div>, onOpenMatching: vi.fn(),
      contextPanel: <div>Selected case details</div>, contextPanelOpen: true, onCloseContextPanel
    }
    const view = render(<AgentWorkspace {...props} />)
    const workspace = screen.getByRole('main', { name: 'SES Agent' })
    expect(screen.getByText('Selected case details')).toBeVisible()
    expect(screen.queryByRole('region', { name: '会話' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'タスク一覧を開く' })).not.toBeInTheDocument()

    const trigger = screen.getByRole('button', { name: 'Agentに質問' })
    trigger.focus()
    fireEvent.click(trigger)
    const agent = screen.getByRole('complementary', { name: 'SES Agent' })
    const composer = within(agent).getByRole('textbox', { name: 'SES Agent への指示' })
    await waitFor(() => expect(composer).toHaveFocus())
    fireEvent.change(composer, { target: { value: 'Keep this draft' } })
    expect(agent.parentElement).toBe(workspace)
    expect(screen.getByText('Business list')).toBeVisible()
    expect(screen.getByText('Selected case details')).not.toBeVisible()

    fireEvent.click(within(agent).getByRole('button', { name: '会話管理' }))
    expect(within(agent).getByRole('region', { name: '会話' })).toBeVisible()
    expect(composer).not.toBeVisible()
    expect(workspace).not.toHaveClass('is-history-open')
    fireEvent.keyDown(within(agent).getByRole('button', { name: '会話に戻る' }), { key: 'Escape' })
    expect(composer).toBeVisible()
    expect(composer).toHaveValue('Keep this draft')
    expect(onCloseContextPanel).not.toHaveBeenCalled()
    fireEvent.keyDown(composer, { key: 'Escape' })
    expect(agent).not.toBeVisible()
    expect(screen.getByText('Selected case details')).toBeVisible()
    expect(trigger).toHaveFocus()
    expect(onCloseContextPanel).not.toHaveBeenCalled()

    fireEvent.click(trigger)
    expect(composer).toHaveValue('Keep this draft')
    view.rerender(<AgentWorkspace {...props} homeRequestToken={1} />)
    expect(agent).not.toBeVisible()
    expect(screen.getByText('Selected case details')).toBeVisible()
    expect(api.executeAgentTurn).not.toHaveBeenCalled()
  })

  it('does not let a previous home request override opening Agent on mount', async () => {
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([]) } })
    const props = { businessTitle: '案件', latestContent: <div>Business list</div>, onOpenMatching: vi.fn(), chatRequest: 1 }
    const view = render(<AgentWorkspace {...props} homeRequestToken={3} />)
    const composer = await screen.findByRole('textbox', { name: 'SES Agent への指示' })
    expect(composer).toBeVisible()
    view.rerender(<AgentWorkspace {...props} homeRequestToken={4} />)
    expect(composer).not.toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Agentに質問' }))
    view.rerender(<AgentWorkspace {...props} homeRequestToken={4} />)
    expect(composer).toBeVisible()
  })

  it('offers a way back to the 今日新着 board while the workspace panel is closed', async () => {
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([]) } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    const onOpenNewCaseBoard = vi.fn()
    render(<AgentWorkspace newCaseUnseenCount={2} onOpenMatching={vi.fn()} onOpenNewCaseBoard={onOpenNewCaseBoard} />)
    const pill = await screen.findByRole('button', { name: /本日の新規案件|今日の新着案件/u })
    expect(pill.textContent).toContain('2')
    fireEvent.click(pill)
    expect(onOpenNewCaseBoard).toHaveBeenCalledTimes(1)
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

  it('keeps a selected person while opening a case and sends both references', async () => {
    const executeAgentTurn = vi.fn().mockResolvedValue({ status: 'completed', toolName: null, conversation: snapshot([]) })
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([]), executeAgentTurn } })
    const documentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const { rerender } = render(<AgentWorkspace onOpenMatching={vi.fn()} focusRequest={{ id: 1, caseReference: null, candidateDocumentId: documentId }} />)
    const reference = { kind: 'job-case' as const, objectId: jobCaseId, objectVersion: 1, resultHash: null, ordinal: null, label: 'Java 案件', target: `job-case:${jobCaseId}` }
    rerender(<AgentWorkspace onOpenMatching={vi.fn()} focusRequest={{ id: 2, caseReference: reference }} />)
    expect(await screen.findByRole('button', { name: '現在の人材を解除' })).toBeInTheDocument()
    const field = screen.getByRole('textbox', { name: 'SES Agent への指示' })
    fireEvent.change(field, { target: { value: '这个案件适合他吗' } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    await waitFor(() => expect(executeAgentTurn).toHaveBeenCalledWith(expect.objectContaining({ selectedCandidateDocumentId: documentId, selectedJobCaseRef: reference })))
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

    expect(screen.queryByText('右ワークスペースを参照')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'SES Agent への指示' }), { target: { value: '总结右侧案件' } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))

    await waitFor(() => expect(executeAgentTurn).toHaveBeenCalledTimes(1))
    expect(executeAgentTurn.mock.calls[0]?.[0]).toMatchObject({ activeSystemAccess })
  })

  it('clears the previous case when a latest-person card supplies the next workspace context', async () => {
    const executeAgentTurn = vi.fn().mockResolvedValue({
      status: 'completed', toolName: null, actionRunId: null, assistantMessage: null,
      conversation: snapshot([])
    })
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: {
      ...originalApi, listAiConversations: vi.fn().mockResolvedValue([]), executeAgentTurn
    } as unknown as DesktopApi })
    const onOpenMatching = vi.fn()
    const caseReference = { kind: 'job-case' as const, objectId: 'case-before', objectVersion: 1, resultHash: null, ordinal: null, label: 'Prior Java case', target: 'job-case:case-before' }
    const view = render(<AgentWorkspace onOpenMatching={onOpenMatching} focusRequest={{ id: 1, caseReference }} />)
    await screen.findByRole('textbox', { name: 'SES Agent への指示' })
    const access = { type: 'system-access' as const, destination: 'candidate' as const, sourceDocumentId: '11111111-1111-4111-8111-111111111111', view: 'overview' as const }
    view.rerender(<AgentWorkspace onOpenMatching={onOpenMatching} focusRequest={{ id: 2, caseReference: null }} activeSystemAccess={access} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'SES Agent への指示' }), { target: { value: '总结这位人员' } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    await waitFor(() => expect(executeAgentTurn).toHaveBeenCalledTimes(1))
    expect(executeAgentTurn.mock.calls[0]?.[0]).toMatchObject({ selectedJobCaseRef: null, activeSystemAccess: access })
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
    render(<AgentWorkspace businessTitle="案件" latestContent={<div>Business list</div>} onOpenMatching={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Agentに質問' }))
    const composer = await screen.findByRole('textbox', { name: 'SES Agent への指示' })
    fireEvent.drop(composer, { dataTransfer: { files: [new File(['x'], 'candidate.pdf')] } })
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

  it('keeps timing and cloud call diagnostics collapsed after an answer', async () => {
    const conversation = snapshot([{ id: 'answer-timings', role: 'assistant', content: 'Java の案件を確認できます。', mode: 'cloud', createdAt: '2026-09-09T00:00:00Z' }])
    conversation.title = '案件の説明'
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: {
      ...originalApi, listAiConversations: vi.fn().mockResolvedValue([]), cancelAgentTurn: vi.fn(),
      executeAgentTurn: vi.fn().mockResolvedValue({ status: 'completed', toolName: null, actionRunId: null, assistantMessage: conversation.messages[0], conversation,
        timings: { totalMs: 9700, planningMs: 3600, localToolMs: null, cloudReviewMs: null, narrativeFirstTokenMs: 3900, narrativeMs: 6000, cloudCalls: 2 } })
    } })
    render(<AgentWorkspace onOpenMatching={vi.fn()} />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'SES Agent への指示' }), { target: { value: '案件を説明して' } })
    fireEvent.click(screen.getByRole('button', { name: '送信' }))
    expect(await screen.findByText('Java の案件を確認できます。')).toBeVisible()
    const details = await screen.findByTestId('agent-turn-timings')
    expect(details).not.toBeVisible()
    fireEvent.click(screen.getByText('実行の詳細'))
    expect(details).toBeVisible()
    expect(details).toHaveTextContent('9.7s')
    expect(details).toHaveTextContent('クラウド呼び出し 2 回')
    fireEvent.click(screen.getByText('実行の詳細'))
    expect(details).not.toBeVisible()
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

  it('opens imported resume facts directly without adding review warnings or review actions', async () => {
    const documentId = '77777777-7777-4777-8777-777777777777'
    const conversation = snapshot([{
      id: 'assistant-imported-facts', role: 'assistant', content: '履歴書を取り込みました。', mode: 'local',
      createdAt: '2026-08-18T00:00:00.000Z',
      blocks: [
        { type: 'system-access', destination: 'review-center' },
        { type: 'resume-import', imported: [{ documentId, label: 'RESUME_1', ordinal: 1 }], failedCount: 1 },
        { type: 'candidate-draft-facts', facts: {
          documentId, label: 'RESUME_1', confirmed: false, reviewStatus: 'awaiting-review',
          fields: [{ label: 'Skills', value: 'Java / SQL', confidence: 0.8, status: 'needs_review', sources: ['Sheet1'] }],
          projects: [{ title: 'Payment system', period: '2024–2026', role: 'SE', technologies: ['Java'], summary: 'Backend development', confidence: 0.8, sources: ['Sheet1'] }]
        } }
      ]
    }])
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: {
      ...originalApi, listAiConversations: vi.fn().mockResolvedValue([conversation])
    } })
    const onOpenCandidate = vi.fn()
    render(<AgentWorkspace onOpenMatching={vi.fn()} onOpenCandidate={onOpenCandidate} />)
    expect(await screen.findByText('Java / SQL')).toBeVisible()
    expect(screen.getByText('Payment system')).toBeVisible()
    expect(screen.getByText('1件の取込に失敗')).toBeVisible()
    expect(screen.queryByText(/機械抽出|未確認下書き|確認するまで候補者/u)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /レビューセンターへ|レビューする|レビューセンターを開く/u })).not.toBeInTheDocument()
    const openButtons = screen.getAllByRole('button', { name: '資料を見る' })
    expect(openButtons).toHaveLength(2)
    fireEvent.click(openButtons[1]!)
    expect(onOpenCandidate).toHaveBeenCalledWith(documentId, 'resume')
  })

  it('keeps intake draft cards live and runs matching for a draft confirmed after the paste', async () => {
    const reviewId = '55555555-5555-4555-8555-555555555555'
    const intakeBatchId = '66666666-6666-4666-8666-666666666666'
    const conversation = snapshot([
      { id: 'user-1', role: 'user', content: '【已提交案件文本】内容摘要 abcdef12，原文未写入会话。', mode: 'local', turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-18T00:00:00.000Z' },
      {
        id: 'assistant-1', role: 'assistant', content: '已导入 1 条案件草稿。', mode: 'local', turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-18T00:00:01.000Z',
        blocks: [{
          type: 'job-case-draft-cards', intakeBatchId,
          cards: [{
            reviewId, label: 'DRAFT_1', ordinal: 1, outcome: 'created', title: 'VC++ 開発', reviewStatus: 'awaiting-review', lifecycle: 'active',
            jobCase: null, status: 'current', warningCodes: [],
            fields: [
              { key: 'title', label: '案件名', value: 'VC++ 開発', status: 'needs_review' },
              { key: 'rate', label: '単価', value: null, status: 'missing' }
            ]
          }]
        }]
      }
    ])
    let finish!: (value: unknown) => void
    const executeAgentTurn = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([conversation]), executeAgentTurn, cancelAgentTurn: vi.fn() } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    const onOpenSystemAccess = vi.fn()
    // The review was confirmed in the Review Center after the paste: the live
    // snapshot, not the persisted card, decides what the card offers.
    const confirmedReview: JobCaseReviewSnapshot = {
      reviewId, sourceId: '77777777-7777-4777-8777-777777777777', sourceType: 'chat-paste', providerMessageId: null, threadId: 'thread-1',
      fromDomain: null, messageDate: '2026-08-18T00:00:00.000Z', redactedSubject: 'VC++', redactedPreview: 'VC++', reviewRevision: 2,
      status: 'completed', privacyReviewed: true,
      fields: [{ key: 'title', label: '案件名', originalValue: 'VC++ 開発', value: 'VC++ 開発', confidence: 1, status: 'confirmed', sourceLabels: [], changed: false, changeReason: null }],
      warningCodes: [], completedAt: '2026-08-18T01:00:00.000Z', reviewerDisplayName: 'SES',
      jobCase: { id: jobCaseId, sourceReviewId: reviewId, version: 3, status: 'active', confirmedAt: '2026-08-18T01:00:00.000Z', confirmedBy: 'SES', containsDirectIdentifiers: false },
      lifecycle: 'active', cloudEligible: false
    }
    render(<AgentWorkspace jobCaseReviews={[confirmedReview]} onOpenMatching={vi.fn()} onOpenSystemAccess={onOpenSystemAccess} />)

    expect(await screen.findByText('VC++ 開発')).toBeInTheDocument()
    expect(screen.getByText('有効')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'レビューセンターで一括処理' }))
    expect(onOpenSystemAccess).toHaveBeenCalledWith({ type: 'system-access', destination: 'review-center', intakeBatchId, reviewIds: [reviewId] })
    fireEvent.click(screen.getByRole('button', { name: '候補者を探す' }))
    const matchButton = screen.getByRole('button', { name: '候補者を探す' })
    expect(matchButton).toBeDisabled()
    fireEvent.click(matchButton)
    await waitFor(() => expect(executeAgentTurn).toHaveBeenCalledTimes(1))
    expect(executeAgentTurn.mock.calls[0]?.[0]).toMatchObject({
      message: '現在の案件に合う候補者を探して',
      selectedJobCaseRef: { kind: 'job-case', objectId: jobCaseId, objectVersion: 3, ordinal: 1 }
    })
    finish({ status: 'completed', toolName: 'candidate.match.local', actionRunId: null, assistantMessage: null, conversation })
    await waitFor(() => expect(matchButton).toBeEnabled())
  })

  it('shows an unexcluded-but-unmatched candidate as not assessable instead of ranked #1', async () => {
    const conversation = snapshot([
      { id: 'user-1', role: 'user', content: '给当前案件匹配候选人', mode: 'local', turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-26T00:00:00.000Z' },
      {
        id: 'assistant-1', role: 'assistant', content: '匹配结果。', mode: 'local', turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-26T00:00:01.000Z',
        blocks: [{
          type: 'candidate-match-cards', runId: '88888888-8888-4888-8888-888888888888', resultHash: 'a'.repeat(64),
          cards: [{
            reference: { kind: 'match-result', objectId: '99999999-9999-4999-8999-999999999999', objectVersion: null, resultHash: 'a'.repeat(64), ordinal: 1, label: 'CANDIDATE_1', target: 'match-result:99999999-9999-4999-8999-999999999999' },
            candidateProfileId: '77777777-7777-4777-8777-777777777777', runId: '88888888-8888-4888-8888-888888888888', rank: 1,
            anonymousLabel: '候補者 DA67E874', fitScore: 0, matched: [], missing: ['勤務地:常駐'], hardFilterStatus: 'unknown',
            projectEvidence: null, status: 'current'
          }]
        }]
      }
    ])
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([conversation]) } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    render(<AgentWorkspace onOpenMatching={vi.fn()} />)

    expect(await screen.findByText('現在の案件に確認できる候補者はいません。')).toBeInTheDocument()
    // The reasons wait behind a toggle; a non-candidate is not shown up front.
    expect(screen.queryByText('候補者 DA67E874')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'なぜ結果がないかを見る' }))
    expect(screen.getByText('候補者 DA67E874')).toBeInTheDocument()
    expect(screen.getByText('判定根拠なし・評価不能')).toBeInTheDocument()
    expect(screen.getByText('不明（候補者に未登録：勤務地:常駐）')).toBeInTheDocument()
    expect(screen.queryByText('#1')).not.toBeInTheDocument()
    expect(screen.queryByText('Fit 0')).not.toBeInTheDocument()
  })

  it('shows the cloud review next to the local fit without turning it into a score', async () => {
    const conversation = snapshot([
      { id: 'user-1', role: 'user', content: '给当前案件匹配候选人', mode: 'local', turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-26T00:00:00.000Z' },
      {
        id: 'assistant-1', role: 'assistant', content: '匹配结果。', mode: 'local', turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-26T00:00:01.000Z',
        blocks: [{
          type: 'candidate-match-cards', runId: '88888888-8888-4888-8888-888888888888', resultHash: 'a'.repeat(64),
          cards: [{
            reference: { kind: 'match-result', objectId: '99999999-9999-4999-8999-999999999999', objectVersion: null, resultHash: 'a'.repeat(64), ordinal: 1, label: 'CANDIDATE_1', target: 'match-result:99999999-9999-4999-8999-999999999999' },
            candidateProfileId: '77777777-7777-4777-8777-777777777777', runId: '88888888-8888-4888-8888-888888888888', rank: 1,
            anonymousLabel: '候補者 DA67E874', fitScore: 72, matched: ['Java'], missing: [], hardFilterStatus: 'passed',
            projectEvidence: null, status: 'current',
            assessment: {
              version: 'match-assessment-v1', fit: 'possible',
              met: [{ requirement: 'Java', evidence: 'Java 5年' }], gaps: ['AWS'], confirm: ['日本語レベル'],
              reason: '主要スキルは一致。', modelKey: 'gpt-5', assessedAt: '2026-08-26T00:00:02.000Z'
            }
          }]
        }]
      }
    ])
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([conversation]) } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    render(<AgentWorkspace onOpenMatching={vi.fn()} />)

    expect(await screen.findByText('候補者 DA67E874')).toBeInTheDocument()
    // The local fit and rank stay; the review is a labelled level, not a number.
    expect(screen.getByText('ローカル関連度 72')).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('補足評価')).toBeInTheDocument()
    expect(screen.getByText('適合度：情報不足')).toBeInTheDocument()
    expect(screen.getByText('Java ← Java 5年')).toBeInTheDocument()
    expect(screen.getByText(/日本語レベル · AWS/u)).toBeInTheDocument()
    expect(screen.queryByText('主要スキルは一致。')).not.toBeInTheDocument()
  })

  it('says why the cloud review did not run and that the case set no hard condition', async () => {
    const conversation = snapshot([
      { id: 'user-1', role: 'user', content: '给当前案件匹配候选人', mode: 'local', turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-26T00:00:00.000Z' },
      {
        id: 'assistant-1', role: 'assistant', content: '匹配结果。', mode: 'local', turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-26T00:00:01.000Z',
        blocks: [{
          type: 'candidate-match-cards', runId: '88888888-8888-4888-8888-888888888888', resultHash: 'a'.repeat(64),
          cloudReview: { status: 'skipped', code: 'cloud-error', reason: 'Error: マッチ評価の応答が有効な JSON ではありません。' },
          cards: [{
            reference: { kind: 'match-result', objectId: '99999999-9999-4999-8999-999999999999', objectVersion: null, resultHash: 'a'.repeat(64), ordinal: 1, label: 'CANDIDATE_1', target: 'match-result:99999999-9999-4999-8999-999999999999' },
            candidateProfileId: '77777777-7777-4777-8777-777777777777', runId: '88888888-8888-4888-8888-888888888888', rank: 1,
            anonymousLabel: '候補者 DA67E874', fitScore: 24, matched: ['Java'], missing: [], hardFilterStatus: 'none',
            projectEvidence: null, status: 'current'
          }]
        }]
      }
    ])
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([conversation]) } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    render(<AgentWorkspace onOpenMatching={vi.fn()} />)

    expect(await screen.findByText('候補者 DA67E874')).toBeInTheDocument()
    expect(screen.getByText('案件に必須条件なし')).toBeInTheDocument()
    expect(screen.getByText('クラウド評価は未実施：クラウド呼び出し失敗')).toBeInTheDocument()
    expect(screen.getByText('Error: マッチ評価の応答が有効な JSON ではありません。')).toBeInTheDocument()
    expect(screen.queryByText('通過')).not.toBeInTheDocument()
  })

  it('deletes an intake draft from its card only through the impact preview and typed confirmation', async () => {
    const reviewId = '55555555-5555-4555-8555-555555555555'
    const conversation = snapshot([
      { id: 'user-1', role: 'user', content: '【已提交案件文本】内容摘要 abcdef12，原文未写入会话。', mode: 'local', turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-26T00:00:00.000Z' },
      {
        id: 'assistant-1', role: 'assistant', content: '已导入 1 条案件草稿。', mode: 'local', turnId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-26T00:00:01.000Z',
        blocks: [{
          type: 'job-case-draft-cards', intakeBatchId: '66666666-6666-4666-8666-666666666666',
          cards: [{
            reviewId, label: 'DRAFT_1', ordinal: 1, outcome: 'created', title: 'Spark', reviewStatus: 'awaiting-review', lifecycle: 'active',
            jobCase: null, status: 'current', warningCodes: [],
            fields: [{ key: 'title', label: '案件名', value: 'Spark', status: 'needs_review' }]
          }]
        }]
      }
    ])
    const api = { ...originalApi, listAiConversations: vi.fn().mockResolvedValue([conversation]) } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    const onPreviewJobCaseDeletion = vi.fn().mockResolvedValue({
      reviewId, sourceId: 'source', title: 'Spark', sourceType: 'chat-paste', confirmationHash: 'c'.repeat(64),
      counts: { caseVersions: 0, reviewAudits: 0, taskRecords: 0, proposalDrafts: 0, evaluationDraftCases: 0, piiMappings: 2, sourceRecords: 1, gmailMessages: 0, agentReferences: { conversations: 1, messages: 1 } }
    })
    const onDeleteJobCase = vi.fn().mockResolvedValue({ report: {} })
    render(<AgentWorkspace onDeleteJobCase={onDeleteJobCase} onOpenMatching={vi.fn()} onPreviewJobCaseDeletion={onPreviewJobCaseDeletion} />)

    expect(await screen.findByText('Spark')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => expect(onPreviewJobCaseDeletion).toHaveBeenCalledWith(reviewId))
    const confirmButton = await screen.findByRole('button', { name: '完全に削除' })
    // The wrong word keeps the destructive step disabled.
    expect(confirmButton).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '案件削除確認入力' }), { target: { value: '削除' } })
    expect(confirmButton).toBeEnabled()
    fireEvent.click(confirmButton)
    await waitFor(() => expect(onDeleteJobCase).toHaveBeenCalledWith({ reviewId, confirmationHash: 'c'.repeat(64), confirmationText: '削除' }))
  })
  it('offers a drafted group message per language and records what the operator does with it', async () => {
    const reviewId = '55555555-5555-4555-8555-555555555555'
    const templateId = '88888888-8888-4888-8888-888888888888'
    const card = (ordinal: number, overrides: Record<string, unknown> = {}) => ({
      reviewId, jobCaseId, jobCaseVersion: 2, ordinal, title: `Java 案件 ${ordinal}`, status: 'new' as const,
      templateId, templateRevision: 1,
      textJa: '【案件】Java 案件\n必須：Java', textZh: '【案件】Java 案件\n必须：Java',
      forbiddenJa: [], forbiddenZh: [], ...overrides
    })
    const conversation = snapshot([
      { id: 'user-1', role: 'user', content: '把今天的新案件整理成群消息', mode: 'local', createdAt: '2026-08-25T00:00:00.000Z' },
      {
        id: 'assistant-1', role: 'assistant', content: '群メッセージを2件作成しました。', mode: 'local', createdAt: '2026-08-25T00:00:01.000Z',
        blocks: [{
          type: 'job-case-broadcast-cards',
          queue: { new: 2, copied: 4, attention: 0 },
          // The second card still carries an identifier, so it cannot be copied.
          cards: [card(1), card(2, { forbiddenZh: ['email'], forbiddenJa: ['email'] })]
        }]
      }
    ])
    const recordCaseBroadcastCopy = vi.fn().mockResolvedValue({ copy: { id: 'copy-1' } })
    const openCaseBroadcastEmail = vi.fn().mockResolvedValue({ opened: true })
    const api = {
      ...originalApi,
      listAiConversations: vi.fn().mockResolvedValue([conversation]),
      recordCaseBroadcastCopy,
      openCaseBroadcastEmail
    } as DesktopApi
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    const previousClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const onOpenSystemAccess = vi.fn()
    try {
      render(<AgentWorkspace onOpenMatching={vi.fn()} onOpenSystemAccess={onOpenSystemAccess} />)

      expect(await screen.findByText('Java 案件 1')).toBeInTheDocument()
      expect(screen.getByText(/キュー：新着 2/u)).toBeInTheDocument()
      const first = screen.getByText('Java 案件 1').closest('section')!
      // The card names no destination, so the Japanese original is what the
      // operator sees first until they choose otherwise.
      expect(within(first).getByRole('textbox', { name: '群メッセージ本文' })).toHaveValue('【案件】Java 案件\n必須：Java')
      fireEvent.click(within(first).getByRole('button', { name: 'コピーする' }))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('【案件】Java 案件\n必須：Java'))
      expect(recordCaseBroadcastCopy).toHaveBeenCalledWith({
        reviewId, lang: 'ja', kind: 'new', templateId, text: '【案件】Java 案件\n必須：Java'
      })
      expect(await within(first).findByRole('status')).toHaveTextContent('コピーしました。微信に貼り付けてください。')

      fireEvent.click(within(first).getByRole('button', { name: 'メールを開く' }))
      await waitFor(() => expect(openCaseBroadcastEmail).toHaveBeenCalledWith({
        reviewId, lang: 'ja', kind: 'new', templateId, text: '【案件】Java 案件\n必須：Java'
      }))
      expect(await within(first).findByRole('status')).toHaveTextContent('宛先と本文を確認して送信してください。')

      // Switching the tab switches which version is copied and recorded.
      recordCaseBroadcastCopy.mockClear()
      fireEvent.click(within(first).getByRole('button', { name: '中文' }))
      expect(within(first).getByRole('textbox', { name: '群メッセージ本文' })).toHaveValue('【案件】Java 案件\n必须：Java')
      fireEvent.click(within(first).getByRole('button', { name: 'コピーする' }))
      await waitFor(() => expect(recordCaseBroadcastCopy).toHaveBeenCalledWith(expect.objectContaining({ lang: 'zh', text: '【案件】Java 案件\n必须：Java' })))

      // Nothing on the card can claim a message reached anyone.
      expect(within(first).queryByRole('button', { name: '已発' })).toBeNull()
      expect(first.textContent).not.toContain('送信先グループ')

      fireEvent.click(within(first).getByRole('button', { name: '右側で開く' }))
      expect(onOpenSystemAccess).toHaveBeenCalledWith({ type: 'system-access', destination: 'broadcast', reviewId })

      // A message that still carries an identifier cannot be copied at all.
      const second = screen.getByText('Java 案件 2').closest('section')!
      expect(within(second).getByRole('alert')).toHaveTextContent('email')
      expect(within(second).getByRole('button', { name: 'コピーする' })).toBeDisabled()
    } finally {
      if (previousClipboard) Object.defineProperty(navigator, 'clipboard', previousClipboard)
      else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    }
  })
})
