import '@testing-library/jest-dom/vitest'
import type { DesktopApi } from '@shared'

const aiConversationTestApi = {
  listAiConversations: async () => [],
  saveAiConversation: async (input: Parameters<DesktopApi['saveAiConversation']>[0]) => {
    const timestamp = new Date().toISOString()
    return {
      id: input.conversationId,
      context: input.context,
      title: input.messages.find((message) => message.role === 'user')?.content.slice(0, 60) ?? 'New conversation',
      messages: input.messages,
      revision: (input.expectedRevision ?? 0) + 1,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  },
  deleteAiConversations: async (input: Parameters<DesktopApi['deleteAiConversations']>[0]) => ({
    deletedConversationIds: input.conversationIds
  })
} satisfies Pick<DesktopApi, 'listAiConversations' | 'saveAiConversation' | 'deleteAiConversations'>

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: aiConversationTestApi })
}
