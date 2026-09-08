import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAgentChatModelCatalog } from '@agent'
import type { CandidateProfile } from '@resume'
import type { ConfirmedJobCase } from '@job-cases'
import type { MainIpcContext } from './ipc/context'
import type { PersonnelCasesAssessmentInput, AgentMatchAssessmentResult } from './agent-cloud-narrative'
import { createPersonnelCaseMatcher } from './personnel-case-matching'

vi.mock('./app-defaults', () => ({ effectiveApplicationPreferences: () => ({ locale: 'zh-CN' }) }))
const documentId = '11111111-1111-4111-8111-111111111111'
const profile = { id: '22222222-2222-4222-8222-222222222222', sourceDocumentId: documentId, profileVersion: 1,
  confirmedAt: '2026-09-08T00:00:00.000Z', confirmedBy: '本机导入', containsDirectIdentifiers: false,
  fields: [{ key: 'skills', label: '技能', value: 'Java SQL', sourceLabels: [] }, { key: 'availability', label: '入场', value: '10月', sourceLabels: [] }],
  projectExperiences: [], localPersonalDetails: { displayName: 'PRIVATE NAME', email: 'private@example.com' }
} as unknown as CandidateProfile
const makeCase = (id: string, skill: string, extra: ConfirmedJobCase['fields'] = []) => ({ id, sourceReviewId: `review-${id}`, version: 1,
  fields: [{ key: 'title', label: '案件名', value: `${skill} project`, sourceLabels: [] }, { key: 'required_skills', label: '必須', value: skill, sourceLabels: [] }, ...extra]
}) as ConfirmedJobCase
const verdict = (candidate: string, fit: 'strong' | 'possible' = 'possible') => ({ candidate, fit, met: [{ requirement: 'Java', evidence: 'Java' }], gaps: [], confirm: [], reason: 'Project evidence matches.' })
function setup(assess?: (input: PersonnelCasesAssessmentInput) => Promise<AgentMatchAssessmentResult>) {
  let profiles = [profile]
  let cases = [makeCase('a', 'Java'), makeCase('b', 'SQL')]
  const cloud = assess ? { assessPersonnelCases: vi.fn(assess), cancel: vi.fn(async () => ({})) } : null
  const context = { repository: { listEligibleTalentProfiles: () => profiles, listActiveJobCases: () => cases },
    agentNarrativeStreamer: cloud, agentChatModelCatalog: loadAgentChatModelCatalog() } as unknown as MainIpcContext
  return { cloud, context, setProfiles: (value: CandidateProfile[]) => { profiles = value }, setCases: (value: ConfirmedJobCase[]) => { cases = value } }
}
afterEach(() => vi.useRealTimers())
describe('personnel case matching', () => {
  it.each([true, false, null])('applies case affiliation requirements when the selected personnel isOwnCompany is %s', async (isOwnCompany) => {
    const fixture = setup()
    fixture.setProfiles([{ ...profile, isOwnCompany }])
    fixture.setCases([makeCase('restricted', 'Java', [{ key: 'contract_chain', label: '商流', value: '自社限定', sourceLabels: [] }]), makeCase('open', 'Java')])
    const result = await createPersonnelCaseMatcher(fixture.context)(documentId)
    expect(result.items.map((item) => item.jobCaseId).sort()).toEqual(isOwnCompany ? ['open', 'restricted'] : ['open'])
  })
  it('excludes date-only matches and labels cloud-unavailable output as local', async () => {
    const fixture = setup()
    fixture.setCases([makeCase('java', 'Java'), makeCase('salesforce', 'Salesforce', [{ key: 'start_date', label: '開始', value: '10月', sourceLabels: [] }])])
    const result = await createPersonnelCaseMatcher(fixture.context)(documentId)
    expect(result.items.map((item) => item.jobCaseId)).toEqual(['java'])
    expect(result.cloud).toMatchObject({ status: 'unavailable', reviewedCount: 0 })
  })
  it('assesses the shortlist in one call, omits local identity, and sorts by cloud fit', async () => {
    const fixture = setup(async () => ({ assessments: [verdict('CASE_1'), verdict('CASE_2', 'strong')] }))
    const result = await createPersonnelCaseMatcher(fixture.context)(documentId)
    expect(fixture.cloud!.assessPersonnelCases).toHaveBeenCalledTimes(1)
    const input = fixture.cloud!.assessPersonnelCases.mock.calls[0]![0]
    expect(input.cases).toHaveLength(2)
    expect(JSON.stringify(input)).not.toContain('PRIVATE NAME')
    expect(JSON.stringify(input)).not.toContain('private@example.com')
    expect(JSON.stringify(input.person)).not.toContain(documentId)
    expect(result.items[0]!.jobCaseId).toBe('b')
    expect(result.cloud).toMatchObject({ status: 'reviewed', reviewedCount: 2 })
  })
  it('does not promote unknown hard conditions to a strong fit', async () => {
    const fixture = setup(async () => ({ assessments: [verdict('CASE_1', 'strong')] }))
    fixture.setCases([makeCase('java', 'Java', [{ key: 'japanese_level', label: '日本語', value: 'N2以上', sourceLabels: [] }])])
    const result = await createPersonnelCaseMatcher(fixture.context)(documentId)
    expect(result.items[0]!.assessment).toMatchObject({ fit: 'possible', confirm: ['N2以上'] })
  })
  it('keeps partially assessed rows honest and leaves failed requests usable locally', async () => {
    const partial = setup(async () => ({ assessments: [verdict('CASE_1')] }))
    const result = await createPersonnelCaseMatcher(partial.context)(documentId)
    expect(result.cloud.status).toBe('partial')
    expect(result.items[1]!.assessment).toBeUndefined()
    const failed = setup(async () => { throw new Error('offline') })
    expect((await createPersonnelCaseMatcher(failed.context)(documentId)).cloud.status).toBe('failed')
  })
  it('deduplicates clicks and rejects stale personnel after the cloud reply', async () => {
    let finish!: (result: AgentMatchAssessmentResult) => void
    const fixture = setup(() => new Promise((resolve) => { finish = resolve }))
    const find = createPersonnelCaseMatcher(fixture.context)
    const first = find(documentId)
    expect(find(documentId)).toBe(first)
    fixture.setProfiles([{ ...profile, profileVersion: 2 }])
    finish({ assessments: [verdict('CASE_1')] })
    await expect(first).rejects.toThrow('人员资料已更新')
    expect(fixture.cloud!.assessPersonnelCases).toHaveBeenCalledTimes(1)
  })
  it('drops cases changed or archived during evaluation', async () => {
    const fixture = setup(async () => { fixture.setCases([makeCase('b', 'SQL')]); return { assessments: [verdict('CASE_1'), verdict('CASE_2')] } })
    const result = await createPersonnelCaseMatcher(fixture.context)(documentId)
    expect(result.items.map((item) => item.jobCaseId)).toEqual(['b'])
    expect(result.cloud.reviewedCount).toBe(1)
  })
  it('bounds cloud latency, aborts the request and cancels the remote operation', async () => {
    vi.useFakeTimers()
    const fixture = setup((input) => { input.onClientRequestId('remote-test'); return new Promise(() => {}) })
    const pending = createPersonnelCaseMatcher(fixture.context, 100)(documentId)
    await vi.advanceTimersByTimeAsync(101)
    expect((await pending).cloud.status).toBe('failed')
    expect(fixture.cloud!.assessPersonnelCases.mock.calls[0]![0].signal.aborted).toBe(true)
    expect(fixture.cloud!.cancel).toHaveBeenCalledWith('remote-test')
  })
})
