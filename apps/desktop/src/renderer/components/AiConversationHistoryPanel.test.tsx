import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AiConversationSnapshot } from '@shared'
import { UiLocaleProvider } from '../i18n'
import { AiConversationHistoryPanel } from './AiConversationHistoryPanel'

const context = {
  assistant: 'candidate-profile' as const,
  candidateDocumentId: 'ddbb8e9e-75f4-44a4-aa65-3111550fccf2',
  interviewId: null,
  interviewKind: null,
  roundNumber: null
}

const conversations: AiConversationSnapshot[] = [
  {
    id: '66dca934-8724-448d-9096-ed29b15ec2f5',
    context,
    title: '主要能力是什么？',
    messages: [
      { id: 'user-1', role: 'user', content: '主要能力是什么？', mode: 'local', createdAt: '2026-07-29T10:00:00.000Z' },
      { id: 'assistant-1', role: 'assistant', content: 'Java 和 AWS。', mode: 'local', createdAt: '2026-07-29T10:00:01.000Z' }
    ],
    revision: 1,
    createdAt: '2026-07-29T10:00:00.000Z',
    updatedAt: '2026-07-29T10:00:01.000Z'
  },
  {
    id: 'b3e3d4b8-103f-4d11-888f-094fd4ade8f4',
    context,
    title: '适合什么项目？',
    messages: [
      { id: 'user-2', role: 'user', content: '适合什么项目？', mode: 'cloud', createdAt: '2026-07-29T11:00:00.000Z' },
      { id: 'assistant-2', role: 'assistant', content: '适合金融后台项目。', mode: 'cloud', createdAt: '2026-07-29T11:00:01.000Z' }
    ],
    revision: 2,
    createdAt: '2026-07-29T11:00:00.000Z',
    updatedAt: '2026-07-29T11:00:01.000Z'
  }
]

describe('AiConversationHistoryPanel', () => {
  it('selects, creates and explicitly confirms deletion of saved conversations', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const onNew = vi.fn()
    const onSelect = vi.fn()
    render(
      <UiLocaleProvider locale="zh-CN">
        <AiConversationHistoryPanel
          activeConversationId={conversations[0]!.id}
          busy={false}
          conversations={conversations}
          error={null}
          loading={false}
          onDelete={onDelete}
          onNew={onNew}
          onSelect={onSelect}
        />
      </UiLocaleProvider>
    )

    expect(screen.getByText('对话与业务上下文一起保存在本机')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^适合什么项目？/u }))
    expect(onSelect).toHaveBeenCalledWith(conversations[1]!.id)
    fireEvent.click(screen.getByRole('button', { name: '新建任务' }))
    expect(onNew).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('checkbox', { name: '选择 主要能力是什么？' }))
    fireEvent.click(screen.getByRole('button', { name: '删除所选' }))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith([conversations[0]!.id]))
  })
})
