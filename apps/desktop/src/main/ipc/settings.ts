import { ipcMain } from 'electron'
import {
  type AiConversationContext,
  type AiConversationSnapshot,
  type DeleteAiConversationsResult,
  type LocalApplicationPreferences,
  type LocalOperatorProfile,
  type SaveLocalApplicationPreferencesInput,
  type SaveLocalOperatorProfileInput,
  aiConversationContextSchema,
  deleteAiConversationsInputSchema,
  ipcChannels,
  saveAiConversationInputSchema,
  saveLocalApplicationPreferencesInputSchema,
  saveLocalOperatorProfileInputSchema
} from '@shared'
import { effectiveApplicationPreferences } from '../app-defaults'
import { assertTrustedSender, type MainIpcContext } from './context'
import { hydrateConversationResumeFacts } from './resume-import'

/** Local operator profile, application preferences and AI conversation history. */
export function registerSettingsHandlers(context: MainIpcContext) {
  const { repository } = context
  ipcMain.handle(
    ipcChannels.saveLocalOperatorProfile,
    (event, rawInput): LocalOperatorProfile => {
      assertTrustedSender(event)
      const input: SaveLocalOperatorProfileInput = saveLocalOperatorProfileInputSchema.parse(rawInput)
      return repository.saveLocalOperatorProfile(input)
    }
  )

  ipcMain.handle(
    ipcChannels.saveLocalApplicationPreferences,
    (event, rawInput): LocalApplicationPreferences => {
      assertTrustedSender(event)
      const input: SaveLocalApplicationPreferencesInput = saveLocalApplicationPreferencesInputSchema.parse(rawInput)
      return repository.saveLocalApplicationPreferences(input)
    }
  )

  ipcMain.handle(
    ipcChannels.listAiConversations,
    (event, rawContext): AiConversationSnapshot[] => {
      assertTrustedSender(event)
      const context: AiConversationContext = aiConversationContextSchema.parse(rawContext)
      const zh = effectiveApplicationPreferences(repository).locale === 'zh-CN'
      return repository.listAiConversations(context).map((conversation) => {
        try {
          return hydrateConversationResumeFacts(repository, conversation, zh)
        } catch {
          // History loading remains available if a concurrent turn updated the
          // same revision. The next read can retry this deterministic backfill.
          return repository.getAiConversation(conversation.id) ?? conversation
        }
      })
    }
  )

  ipcMain.handle(
    ipcChannels.saveAiConversation,
    (event, rawInput): AiConversationSnapshot => {
      assertTrustedSender(event)
      const input = saveAiConversationInputSchema.parse(rawInput)
      if (input.context.assistant === 'sales-agent') {
        throw new Error('Sales Agent 会话只能通过 executeAgentTurn 保存。')
      }
      return repository.saveAiConversation(input)
    }
  )

  ipcMain.handle(
    ipcChannels.deleteAiConversations,
    (event, rawInput): DeleteAiConversationsResult => {
      assertTrustedSender(event)
      const input = deleteAiConversationsInputSchema.parse(rawInput)
      return { deletedConversationIds: repository.deleteAiConversations(input.conversationIds) }
    }
  )
}
