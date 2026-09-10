import { beforeEach, expect, it, vi } from 'vitest'
import { ipcChannels } from '@shared'
import { registerSettingsHandlers } from './settings'
import { assertTrustedSender } from './context'
const mock = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, raw: unknown) => unknown>() }))
vi.mock('electron', () => ({ clipboard: {}, ipcMain: { handle: (key: string, handler: any) => mock.handlers.set(key, handler) } }))
vi.mock('./context', () => ({ assertTrustedSender: vi.fn() }))
vi.mock('./resume-import', () => ({ hydrateConversationResumeFacts: vi.fn() }))
const id = '11111111-1111-4111-8111-111111111111'
const caseId = '22222222-2222-4222-8222-222222222222'
const personId = '33333333-3333-4333-8333-333333333333'
const context = { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null }
const input = { conversationId: id, context: { ...context, businessObject: { kind: 'case', id: caseId } }, messages: [], expectedRevision: null }
const invoke = (value: unknown) => mock.handlers.get(ipcChannels.saveAiConversation)!({}, value)
beforeEach(() => { mock.handlers.clear(); vi.mocked(assertTrustedSender).mockReset() })
function setup() {
  const repository = {
    getAiConversation: vi.fn(() => null as any),
    getJobCaseReview: vi.fn(() => ({ lifecycle: 'active', jobCase: { id: caseId, version: 3 }, fields: [{ key: 'title', value: 'Java case' }] })),
    getCandidateReview: vi.fn(() => ({ documentId: personId, recordStatus: 'active' })),
    saveAiConversation: vi.fn((value) => value)
  }
  registerSettingsHandlers({ repository } as any)
  return repository
}
it('creates an empty case conversation with authoritative case context', () => {
  const repository = setup()
  expect(invoke(input)).toMatchObject({ messages: [], salesAgentState: { selectedJobCaseRef: { objectId: caseId, objectVersion: 3 }, selectedCandidateDocumentId: null } })
  expect(repository.saveAiConversation).toHaveBeenCalledTimes(1)
  expect(assertTrustedSender).toHaveBeenCalled()
})
it('creates an empty person conversation and discards renderer-supplied cross-object state', () => {
  setup()
  expect(invoke({ ...input, context: { ...context, businessObject: { kind: 'person', id: personId } }, salesAgentState: { selectedJobCaseRef: null, selectedCandidateDocumentId: caseId, lastMatchRunId: null, lastSearchMessageId: null } })).toMatchObject({ salesAgentState: { selectedCandidateDocumentId: personId, selectedJobCaseRef: null } })
})
it('still rejects transcript writes, overwriting existing conversations and untrusted senders', () => {
  const repository = setup()
  expect(() => invoke({ ...input, messages: [{ id: 'msg', role: 'user', content: 'raw imported text', createdAt: new Date().toISOString() }] })).toThrow('executeAgentTurn')
  repository.getAiConversation.mockReturnValue({ id })
  expect(() => invoke(input)).toThrow('executeAgentTurn')
  repository.getAiConversation.mockReturnValue(null)
  vi.mocked(assertTrustedSender).mockImplementation(() => { throw new Error('untrusted') })
  expect(() => invoke(input)).toThrow('untrusted')
  expect(repository.saveAiConversation).not.toHaveBeenCalled()
})
