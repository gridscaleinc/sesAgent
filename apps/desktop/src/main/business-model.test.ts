import { describe, expect, it, vi } from 'vitest'
import { loadAgentChatModelCatalog } from '@agent'
import { businessModel, businessModelKey } from './business-model'

const catalog = loadAgentChatModelCatalog(undefined)
const contextWith = (aiModels?: { checking: string; writing: string }) => ({
  repository: { getLocalApplicationPreferences: vi.fn(() => (aiModels ? { aiModels } : null)) },
  agentChatModelCatalog: catalog
})

describe('businessModel', () => {
  it('uses the default model when nothing is chosen', () => {
    expect(businessModelKey(null, catalog, 'checking')).toBe('gpt-5.6-luna')
    expect(businessModelKey({}, catalog, 'writing')).toBe('gpt-5.6-luna')
  })

  it('resolves each slot to the chosen catalog model', () => {
    const context = contextWith({ checking: 'gpt-6-luna', writing: 'gpt-6-sol' })
    expect(businessModel(context as never, 'checking')).toMatchObject({ key: 'gpt-6-luna', provider: 'openai', endpoint: 'responses' })
    expect(businessModel(context as never, 'writing')).toMatchObject({ key: 'gpt-6-sol', displayName: 'GPT-6 Sol' })
  })

  it('falls back to the default for a model the gateway does not offer yet', () => {
    expect(businessModel(contextWith({ checking: 'gpt-6-luna', writing: 'gpt-6.1-sol-pro' }) as never, 'writing').key).toBe('gpt-5.6-luna')
  })

  it('falls back to the default for a key the catalog no longer lists', () => {
    expect(businessModel(contextWith({ checking: 'gpt-4-retired', writing: 'gpt-6-sol' }) as never, 'checking').key).toBe('gpt-5.6-luna')
  })

  it('reads the saved preferences on every call, so a changed setting applies at once', () => {
    const context = contextWith({ checking: 'gpt-6-luna', writing: 'gpt-6-sol' })
    expect(businessModel(context as never, 'writing').key).toBe('gpt-6-sol')
    context.repository.getLocalApplicationPreferences.mockReturnValue({ aiModels: { checking: 'gpt-6-luna', writing: 'gpt-6-astra' } })
    expect(businessModel(context as never, 'writing').key).toBe('gpt-6-astra')
  })
})
