import { defaultAgentChatModelKey, resolveAgentChatModel, type AgentChatModelDefinition } from '@agent'
import type { ApplicationAiModelSlot, LocalApplicationPreferences } from '@shared'
import type { MainIpcContext } from './ipc/context'

/**
 * Which model slot each kind of business AI work uses:
 * - checking (批量核对): case/person match assessments in both directions, case text intake, mail progress, experience learning
 * - writing (文案与分析): recommendation points, introductions, interview questions, work-rule analysis
 * A translation pass runs on the model of the call it belongs to.
 */
export type BusinessModelSlot = ApplicationAiModelSlot

type ModelContext = Pick<MainIpcContext, 'repository' | 'agentChatModelCatalog'>

/** The catalog key for a slot; a missing choice, or a key the catalog no longer lists, falls back to the default model. */
export function businessModelKey(
  preferences: Pick<LocalApplicationPreferences, 'aiModels'> | null,
  catalog: readonly AgentChatModelDefinition[],
  slot: BusinessModelSlot
): string {
  const chosen = preferences?.aiModels?.[slot]
  return chosen && catalog.some((model) => model.key === chosen) ? chosen : defaultAgentChatModelKey
}

/** The model for one business AI call. Reads the saved preferences on every call, so a changed setting applies at once. */
export function businessModel(context: ModelContext, slot: BusinessModelSlot): AgentChatModelDefinition {
  return resolveAgentChatModel(
    context.agentChatModelCatalog,
    // Optional call: narrow test and verification repositories may not carry settings; they get the default model.
    businessModelKey(context.repository.getLocalApplicationPreferences?.() ?? null, context.agentChatModelCatalog, slot)
  )
}
