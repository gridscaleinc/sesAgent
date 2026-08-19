import { ipcMain, shell } from 'electron'
import {
  type AiCommerceCloudPromptResult,
  type AiCommerceMembershipState,
  type PrepareAiCommerceCloudPromptResult,
  executeAiCommerceCloudPromptInputSchema,
  ipcChannels,
  prepareAiCommerceCloudPromptInputSchema
} from '@shared'
import { unconfiguredAiCommerceState } from '../app-defaults'
import { validateCloudAiResponseForDisplay } from '../cloud-ai-privacy'
import { assertTrustedSender, type MainIpcContext } from './context'

/** Managed AICommerce membership plus the two-phase cloud prompt review flow. */
export function registerAiCommerceHandlers(context: MainIpcContext) {
  const { aiCommerce, currentOperator, cloudAiReview } = context
  let aiCommercePromptBusy = false

  ipcMain.handle(ipcChannels.connectAiCommerce, async (event): Promise<AiCommerceMembershipState> => {
    assertTrustedSender(event)
    if (!aiCommerce) throw new Error('AICommerce の受管接続設定がありません。')
    return aiCommerce.beginConnect()
  })

  ipcMain.handle(ipcChannels.getAiCommerceDashboard, async (event): Promise<AiCommerceMembershipState> => {
    assertTrustedSender(event)
    if (!aiCommerce) return unconfiguredAiCommerceState()
    return aiCommerce.getDashboard()
  })

  ipcMain.handle(ipcChannels.disconnectAiCommerce, async (event): Promise<AiCommerceMembershipState> => {
    assertTrustedSender(event)
    return aiCommerce ? aiCommerce.disconnect() : unconfiguredAiCommerceState()
  })

  ipcMain.handle(ipcChannels.resetAiCommerceToken, async (event): Promise<AiCommerceMembershipState> => {
    assertTrustedSender(event)
    if (!aiCommerce) throw new Error('AICommerce の受管接続設定がありません。')
    return aiCommerce.resetAccountAiToken()
  })

  ipcMain.handle(ipcChannels.openAiCommerceMemberCenter, async (event): Promise<{ opened: true }> => {
    assertTrustedSender(event)
    if (!aiCommerce) throw new Error('AICommerce の受管接続設定がありません。')
    const memberCenter = new URL('/account', aiCommerce.configuration.membersBaseUrl).toString()
    await shell.openExternal(memberCenter)
    return { opened: true }
  })

  ipcMain.handle(
    ipcChannels.prepareAiCommerceCloudPrompt,
    async (event, rawInput): Promise<PrepareAiCommerceCloudPromptResult> => {
      assertTrustedSender(event)
      if (!cloudAiReview) throw new Error('AICommerce の受管接続設定がありません。')
      if (aiCommercePromptBusy) throw new Error('別の Cloud AI 要求が進行中です。完了後にもう一度実行してください。')
      const input = prepareAiCommerceCloudPromptInputSchema.parse(rawInput)
      aiCommercePromptBusy = true
      try {
        return await cloudAiReview.prepare(input.content, currentOperator().operatorId)
      } finally {
        aiCommercePromptBusy = false
      }
    }
  )

  ipcMain.handle(
    ipcChannels.executeAiCommerceCloudPrompt,
    async (event, rawInput): Promise<AiCommerceCloudPromptResult> => {
      assertTrustedSender(event)
      if (!cloudAiReview) throw new Error('AICommerce の受管接続設定がありません。')
      if (aiCommercePromptBusy) throw new Error('別の Cloud AI 要求が進行中です。完了後にもう一度実行してください。')
      const input = executeAiCommerceCloudPromptInputSchema.parse(rawInput)
      aiCommercePromptBusy = true
      try {
        const execution = await cloudAiReview.execute(input.reviewTicket, currentOperator().operatorId)
        const response = validateCloudAiResponseForDisplay(execution.response)
        return {
          ...response,
          removedIdentifierTypes: execution.removedIdentifierTypes
        }
      } finally {
        aiCommercePromptBusy = false
      }
    }
  )
}
