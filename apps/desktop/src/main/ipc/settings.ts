import { clipboard, ipcMain } from 'electron'
import { z } from 'zod'
import {
  type AiConversationContext,
  type AiConversationSnapshot,
  type DeleteAiConversationsResult,
  type JobCaseFieldAliases,
  type LocalApplicationPreferences,
  type LocalOperatorProfile,
  type SaveJobCaseFieldAliasesInput,
  type SaveLocalApplicationPreferencesInput,
  type SaveLocalOperatorProfileInput,
  aiConversationContextSchema,
  deleteAiConversationsInputSchema,
  ipcChannels,
  saveAiConversationInputSchema,
  saveJobCaseFieldAliasesInputSchema,
  saveLocalApplicationPreferencesInputSchema,
  saveLocalOperatorProfileInputSchema
} from '@shared'
import { effectiveApplicationPreferences } from '../app-defaults'
import { assertTrustedSender, type MainIpcContext } from './context'
import { hydrateConversationResumeFacts } from './resume-import'

/** Local operator profile, application preferences and AI conversation history. */
export function registerSettingsHandlers(context: MainIpcContext) {
  ipcMain.handle(ipcChannels.copyTextToClipboard, (event, rawText): void => {
    assertTrustedSender(event)
    // Main-side clipboard: the renderer runs sandboxed behind a deny-all
    // permission handler, so navigator.clipboard is not available there.
    clipboard.writeText(z.string().min(1).max(20_000).parse(rawText))
  })

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
    ipcChannels.saveJobCaseFieldAliases,
    (event, rawInput): JobCaseFieldAliases => {
      assertTrustedSender(event)
      const input: SaveJobCaseFieldAliasesInput = saveJobCaseFieldAliasesInputSchema.parse(rawInput)
      return repository.saveJobCaseFieldAliases(input)
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
        // This endpoint only creates an empty conversation. Transcript writes remain Main-owned.
        if (input.messages.length || input.expectedRevision !== null || repository.getAiConversation(input.conversationId)) {
          throw new Error('Sales Agent 会话消息只能通过 executeAgentTurn 保存。')
        }
        const scope = input.context.businessObject
        const job = scope?.kind === 'case' ? repository.getJobCaseReview(scope.id) : null
        const person = scope?.kind === 'person' ? repository.getCandidateReview(scope.id) : null
        if (scope?.kind === 'case' && (!job || job.lifecycle !== 'active')) throw new Error('案件不存在或已归档。')
        if (scope?.kind === 'person' && (!person || person.recordStatus !== 'active')) throw new Error('人员不存在或已归档。')
        input.salesAgentState = {
          selectedJobCaseRef: job?.jobCase ? {
            kind: 'job-case', objectId: job.jobCase.id, objectVersion: job.jobCase.version,
            resultHash: null, ordinal: null, target: `job-case:${job.jobCase.id}`,
            label: (job.fields.find((field) => field.key === 'title')?.value ?? job.redactedSubject).slice(0, 120)
          } : null,
          selectedCandidateDocumentId: person?.documentId ?? null,
          lastMatchRunId: null, lastSearchMessageId: null
        }
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
