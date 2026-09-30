import { beforeEach, expect, it, vi } from 'vitest'
import { loadAgentChatModelCatalog } from '@agent'
import { ipcChannels } from '@shared'
import { registerSettingsHandlers } from './settings'
import { assertTrustedSender } from './context'
import { onApplicationPreferencesSaved } from '../preference-events'
const mock = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, raw: unknown) => unknown>() }))
vi.mock('electron', () => ({ clipboard: {}, ipcMain: { handle: (key: string, handler: any) => mock.handlers.set(key, handler) } }))
vi.mock('./context', () => ({ assertTrustedSender: vi.fn() }))
vi.mock('./resume-import', () => ({ hydrateConversationResumeFacts: vi.fn() }))
const id = '11111111-1111-4111-8111-111111111111'
const caseId = '22222222-2222-4222-8222-222222222222'
const personId = '33333333-3333-4333-8333-333333333333'
const context = { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null }
const input = {
  conversationId: id,
  context: { ...context, businessObject: { kind: 'case', id: caseId } },
  messages: [],
  expectedRevision: null
}
const invoke = (value: unknown) => mock.handlers.get(ipcChannels.saveAiConversation)!({}, value)
beforeEach(() => {
  mock.handlers.clear()
  vi.mocked(assertTrustedSender).mockReset()
})
function setup() {
  const repository = {
    getAiConversation: vi.fn(() => null as any),
    getJobCaseReview: vi.fn(() => ({
      lifecycle: 'active',
      jobCase: { id: caseId, version: 3 },
      fields: [{ key: 'title', value: 'Java case' }]
    })),
    getCandidateReview: vi.fn(() => ({ documentId: personId, recordStatus: 'active' })),
    saveAiConversation: vi.fn((value) => value)
  }
  registerSettingsHandlers({ repository } as any)
  return repository
}
it('creates an empty case conversation with authoritative case context', () => {
  const repository = setup()
  expect(invoke(input)).toMatchObject({
    messages: [],
    salesAgentState: { selectedJobCaseRef: { objectId: caseId, objectVersion: 3 }, selectedCandidateDocumentId: null }
  })
  expect(repository.saveAiConversation).toHaveBeenCalledTimes(1)
  expect(assertTrustedSender).toHaveBeenCalled()
})
it('creates an empty person conversation and discards renderer-supplied cross-object state', () => {
  setup()
  expect(
    invoke({
      ...input,
      context: { ...context, businessObject: { kind: 'person', id: personId } },
      salesAgentState: { selectedJobCaseRef: null, selectedCandidateDocumentId: caseId, lastMatchRunId: null, lastSearchMessageId: null }
    })
  ).toMatchObject({ salesAgentState: { selectedCandidateDocumentId: personId, selectedJobCaseRef: null } })
})
it('still rejects transcript writes, overwriting existing conversations and untrusted senders', () => {
  const repository = setup()
  expect(() =>
    invoke({ ...input, messages: [{ id: 'msg', role: 'user', content: 'raw imported text', createdAt: new Date().toISOString() }] })
  ).toThrow('executeAgentTurn')
  repository.getAiConversation.mockReturnValue({ id })
  expect(() => invoke(input)).toThrow('executeAgentTurn')
  repository.getAiConversation.mockReturnValue(null)
  vi.mocked(assertTrustedSender).mockImplementation(() => {
    throw new Error('untrusted')
  })
  expect(() => invoke(input)).toThrow('untrusted')
  expect(repository.saveAiConversation).not.toHaveBeenCalled()
})

function setupModels(cloud: { probeModel: ReturnType<typeof vi.fn> } | null) {
  const repository = { saveLocalApplicationPreferences: vi.fn((value) => value) }
  registerSettingsHandlers({
    repository,
    agentChatModelCatalog: loadAgentChatModelCatalog(undefined),
    agentNarrativeStreamer: cloud
  } as any)
  return repository
}
it('saves an AI model choice only when both keys are catalog models', () => {
  const repository = setupModels(null)
  const save = (aiModels: unknown) =>
    mock.handlers.get(ipcChannels.saveLocalApplicationPreferences)!({}, { locale: 'ja-JP', expectedRevision: null, aiModels })
  expect(save({ checking: 'gpt-6-luna', writing: 'gpt-6.1-sol-pro' })).toMatchObject({ aiModels: { writing: 'gpt-6.1-sol-pro' } })
  expect(() => save({ checking: 'gpt-6-luna', writing: 'gpt-9-unknown' })).toThrow(/可用列表/)
  expect(repository.saveLocalApplicationPreferences).toHaveBeenCalledTimes(1)
})
it('tests one catalog model through the cloud service and reports the round trip', async () => {
  const probeModel = vi.fn().mockResolvedValue({ latencyMs: 812 })
  setupModels({ probeModel })
  const test = (modelKey: string) => mock.handlers.get(ipcChannels.testAiModel)!({}, { modelKey })
  await expect(test('gpt-6.1-sol')).resolves.toEqual({ modelKey: 'gpt-6.1-sol', latencyMs: 812 })
  expect(probeModel.mock.calls[0]![0].model).toMatchObject({ key: 'gpt-6.1-sol', upstreamModel: 'gpt-6.1-sol', endpoint: 'responses' })
  await expect(test('gpt-9-unknown')).rejects.toThrow(/可用列表/)
  expect(probeModel).toHaveBeenCalledTimes(1)
})
it('asks to connect the AI service before testing a model', async () => {
  setupModels(null)
  await expect(mock.handlers.get(ipcChannels.testAiModel)!({}, { modelKey: 'gpt-5.6-luna' })).rejects.toThrow(/连接 AI 服务/)
})
it('saves the menu-bar choice and tells the menu-bar icon to follow it; an invalid choice is rejected unsaved', () => {
  const repository = setupModels(null)
  const listener = vi.fn()
  const stop = onApplicationPreferencesSaved(listener)
  const save = (menuBar: unknown) =>
    mock.handlers.get(ipcChannels.saveLocalApplicationPreferences)!({}, { locale: 'zh-CN', expectedRevision: 2, menuBar })
  try {
    expect(save({ visible: false, showPersonNames: true })).toMatchObject({ menuBar: { visible: false, showPersonNames: true } })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(() => save({ visible: false })).toThrow()
    expect(repository.saveLocalApplicationPreferences).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)
  } finally {
    stop()
  }
})
