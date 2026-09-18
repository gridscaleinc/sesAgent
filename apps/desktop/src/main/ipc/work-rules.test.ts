import { beforeEach, expect, it, vi } from 'vitest'
import { ipcChannels } from '@shared'
import { loadAgentChatModelCatalog } from '@agent'
import { registerWorkRuleHandlers } from './work-rules'
const mock = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, input?: unknown) => any>() }))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: any) => mock.handlers.set(name, handler) } }))
vi.mock('./context', () => ({ assertTrustedSender: vi.fn() }))
vi.mock('../app-defaults', () => ({ effectiveApplicationPreferences: () => ({ locale: 'zh-CN' }) }))
const clause = { kind: 'preferred', field: 'required_skills', text: 'AWS', sourceQuote: '优先 AWS', caseKeywords: [] }
beforeEach(() => mock.handlers.clear())
function setup() {
  const repository = { saveWorkRule: vi.fn((v) => v), listActiveJobCases: () => [], listWorkRules: () => ({ revision: 0, rules: [] }) }
  registerWorkRuleHandlers({ repository, agentNarrativeStreamer: { analyzeWorkRule: vi.fn(async () => ({ clauses: [clause], issues: [] })) }, currentOperator: () => ({ displayName: 'HR' }), agentChatModelCatalog: loadAgentChatModelCatalog() } as any)
  return repository
}
const event = { sender: { id: 1 } }
it('saves only the Main-owned analyzed preview and rejects renderer supplied clauses', async () => {
  const repository = setup()
  const preview = await mock.handlers.get(ipcChannels.analyzeWorkRule)!(event, { text: '优先 AWS', scope: { kind: 'global' } })
  expect(() => mock.handlers.get(ipcChannels.saveWorkRule)!(event, { token: preview.token, expectedRevision: 0, clauses: [] })).toThrow()
  const saved = mock.handlers.get(ipcChannels.saveWorkRule)!(event, { token: preview.token, expectedRevision: 0 })
  expect(saved.clauses).toEqual([clause])
  expect(repository.saveWorkRule).toHaveBeenCalledOnce()
  expect(() => mock.handlers.get(ipcChannels.saveWorkRule)!(event, { token: preview.token, expectedRevision: 0 })).toThrow(/过期/)
})
it('prevents another renderer from consuming the preview', async () => {
  const repository = setup()
  const preview = await mock.handlers.get(ipcChannels.analyzeWorkRule)!(event, { text: '优先 AWS', scope: { kind: 'global' } })
  expect(() => mock.handlers.get(ipcChannels.saveWorkRule)!({ sender: { id: 2 } }, { token: preview.token, expectedRevision: 0 })).toThrow(/过期/)
  expect(repository.saveWorkRule).not.toHaveBeenCalled()
})
it('rejects inactive or missing case scopes before any analysis', async () => {
  setup()
  await expect(mock.handlers.get(ipcChannels.analyzeWorkRule)!(event, { text: '优先 AWS', scope: { kind: 'case', value: '10000000-0000-4000-8000-000000000001' } })).rejects.toThrow(/案件/)
})

it('sends only capability requirements and relevant rules for case interview generation', async () => {
  const documentId = '10000000-0000-4000-8000-000000000001'
  const jobCaseId = '20000000-0000-4000-8000-000000000001'
  const job = { id: jobCaseId, version: 1, sourceReviewId: jobCaseId, fields: [
    { key: 'required_skills', value: 'PMO・課題管理・顧客調整' },
    { key: 'rate', value: '80万円' }, { key: 'remote', value: '週3日出社' },
    { key: 'start_date', value: '即日' }, { key: 'location', value: '東京' }
  ] }
  const profile = { profileVersion: 1, fields: [{ key: 'role', label: '役割', value: 'PMO' }], projectExperiences: [] }
  const cloud = vi.fn(async () => [])
  const repository = { getCandidateProfileForAssessment: () => profile, listCandidateInterviews: () => [], listActiveJobCases: () => [job],
    listWorkRules: () => ({ revision: 1, rules: [{ id: documentId, revision: 1, enabled: true, scope: { kind: 'global' }, clauses: [
      { ...clause, kind: 'interview', text: '顧客との課題整理の実例を確認する' },
      { ...clause, kind: 'confirm', text: '週3日出社を確認する' },
      { ...clause, kind: 'presentation', text: '提案は短く書く' }
    ] }] }), saveExperienceRun: vi.fn()
  }
  registerWorkRuleHandlers({ repository, agentNarrativeStreamer: { generateRuleQuestions: cloud }, agentChatModelCatalog: loadAgentChatModelCatalog() } as any)
  await mock.handlers.get(ipcChannels.generateRuleQuestions)!(event, { documentId, jobCaseId })
  expect(cloud).toHaveBeenCalledOnce()
  const request = (cloud.mock.calls as unknown as Array<[any]>)[0]![0]
  expect(request.caseSupplied).toBe(true)
  expect(request.requirements).toEqual(['PMO・課題管理・顧客調整', '顧客との課題整理の実例を確認する'])
  expect(request.rules).toHaveLength(1)
})

it('keeps case questions as a draft bound to the person, the case and the rules, and reports staleness on read', async () => {
  const documentId = '10000000-0000-4000-8000-000000000001'
  const jobCaseId = '20000000-0000-4000-8000-000000000001'
  const reviewId = '30000000-0000-4000-8000-000000000001'
  const job = { id: jobCaseId, version: 2, sourceReviewId: reviewId, fields: [{ key: 'required_skills', value: 'Java' }] }
  let profile = { profileVersion: 1, fields: [{ key: 'skills', label: '技能', value: 'Java' }], projectExperiences: [] }
  const generated = [{ id: 'q1', text: '请说明 Java 项目中本人负责的范围。', source: 'match', selected: true, sourceLabel: null }]
  const drafts: any[] = []
  const repository = { getCandidateProfileForAssessment: () => profile, listCandidateInterviews: () => [], listActiveJobCases: () => [job],
    listWorkRules: () => ({ revision: 4, rules: [] }), saveExperienceRun: vi.fn(() => 'run-1'),
    saveCaseQuestionDraft: vi.fn((draft) => { drafts.push(draft) }), getCaseQuestionDraft: vi.fn(() => drafts.at(-1) ?? null) }
  registerWorkRuleHandlers({ repository, agentNarrativeStreamer: { generateRuleQuestions: vi.fn(async () => generated) }, agentChatModelCatalog: loadAgentChatModelCatalog() } as any)
  const result = await mock.handlers.get(ipcChannels.generateRuleQuestions)!(event, { documentId, jobCaseId })
  expect(repository.saveCaseQuestionDraft).toHaveBeenCalledOnce()
  expect(drafts[0]).toMatchObject({ id: result.draftId, documentId, jobCaseId, jobCaseVersion: 2, profileVersion: 1, rulesRevision: 4, experienceRunId: 'run-1', supersededAt: null })
  expect(drafts[0].questions[0]).toMatchObject({ text: generated[0]!.text, experienceRunId: 'run-1', matchContext: { jobCaseId, jobCaseVersion: 2, profileVersion: 1, rulesRevision: 4 } })
  const read = mock.handlers.get(ipcChannels.getCaseQuestionDraft)!
  // The follow-up only knows the review id; it resolves to the same case.
  expect(read(event, { documentId, reviewId })).toEqual({ draft: drafts[0], stale: false })
  expect(read(event, { documentId, jobCaseId })).toEqual({ draft: drafts[0], stale: false })
  profile = { ...profile, profileVersion: 2 }
  expect(read(event, { documentId, jobCaseId })).toMatchObject({ stale: true })
  expect(read(event, { documentId, reviewId: '30000000-0000-4000-8000-000000000009' })).toEqual({ draft: null, stale: false })
  expect(() => read(event, { documentId })).toThrow()
})
