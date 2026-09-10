import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAgentChatModelCatalog } from '@agent'
import type { CandidateProfile } from '@resume'
import type { ConfirmedJobCase } from '@job-cases'
import type { MainIpcContext } from './ipc/context'
import type { AgentMatchAssessmentInput, AgentMatchAssessmentResult } from './agent-cloud-narrative'
import { createCasePersonnelMatcher } from './case-personnel-matching'
vi.mock('./app-defaults', () => ({ effectiveApplicationPreferences: () => ({ locale: 'zh-CN' }) }))
const jobId = '11111111-1111-4111-8111-111111111111'
const job = { id: jobId, sourceReviewId: 'case-review', version: 1,
  fields: [{ key: 'required_skills', label: '必須', value: 'Java', sourceLabels: [] }] } as unknown as ConfirmedJobCase
const makePerson = (id: string, skill = 'Java') => ({ id, sourceDocumentId: id, profileVersion: 1,
  fields: [{ key: 'skills', label: '技能', value: skill, sourceLabels: [] }], projectExperiences: [],
  localPersonalDetails: { displayName: 'PRIVATE NAME', email: 'private@example.com' } }) as unknown as CandidateProfile
const verdict = (candidate: string, fit: 'strong' | 'possible' = 'possible') => ({ candidate, fit, met: [{ requirement: 'Java', evidence: 'Java' }], gaps: [], confirm: [], reason: 'Java projects' })
function setup(assess?: (input: AgentMatchAssessmentInput) => Promise<AgentMatchAssessmentResult>) {
  let profiles = [makePerson('a'), makePerson('b')]
  let cases = [job]
  const cloud = assess ? { assessMatchCandidates: vi.fn(assess), cancel: vi.fn(async () => ({})) } : null
  const context = { repository: { listEligibleTalentProfiles: () => profiles, listActiveJobCases: () => cases }, agentNarrativeStreamer: cloud,
    agentChatModelCatalog: loadAgentChatModelCatalog() } as unknown as MainIpcContext
  return { context, cloud, setProfiles: (value: CandidateProfile[]) => { profiles = value }, setCases: (value: ConfirmedJobCase[]) => { cases = value } }
}
afterEach(() => vi.useRealTimers())
describe('case personnel matching', () => {
  it('returns no recommendations for the Scala/Spark case when only generic roles and languages overlap', async () => {
    const f = setup(async () => ({ assessments: [{ ...verdict('CANDIDATE_1', 'strong'), met: [{ requirement: 'SE', evidence: 'SE' }] }] }))
    f.setCases([{ ...job, fields: [{ key: 'required_skills', label: '必須', value: '英語、Scala、Spark', sourceLabels: [] }, { key: 'role', label: '役割', value: 'SE', sourceLabels: [] }] }])
    f.setProfiles([{ ...makePerson('a', 'Java'), fields: [...makePerson('a', 'Java').fields, { key: 'role', label: '角色', value: 'SE', sourceLabels: [] }, { key: 'japanese_level', label: '日本語', value: 'N1', sourceLabels: [] }] }])
    const onLocal = vi.fn()
    const result = await createCasePersonnelMatcher(f.context)(jobId, { onLocal })
    expect(result.items).toEqual([])
    expect(result.excludedRequirements).toEqual(expect.arrayContaining(['Scala', 'Spark']))
    expect(onLocal.mock.calls[0]![0].items).toEqual([])
    expect(f.cloud!.assessMatchCandidates).not.toHaveBeenCalled()
  })
  it('does not publish incomplete core coverage, even when cloud calls it strong', async () => {
    const f = setup(async () => ({ assessments: [{ ...verdict('CANDIDATE_1', 'strong'), met: [{ requirement: 'Scala', evidence: 'Scala' }] }] }))
    f.setCases([{ ...job, fields: [{ key: 'required_skills', label: '必須', value: 'Scala、Spark', sourceLabels: [] }] }])
    f.setProfiles([makePerson('a', 'Scala')])
    const result = await createCasePersonnelMatcher(f.context)(jobId)
    expect(f.cloud!.assessMatchCandidates).toHaveBeenCalledOnce()
    expect(result.items).toEqual([])
    expect(result.cloud.reviewedCount).toBe(1)
  })
  it('publishes real local results before cloud and cancels without consuming a late reply', async () => {
    let finish!: (value: AgentMatchAssessmentResult) => void
    const fixture = setup((input) => { input.onClientRequestId('cancel-test'); return new Promise((resolve) => { finish = resolve }) })
    const controller = new AbortController()
    const onLocal = vi.fn()
    const match = createCasePersonnelMatcher(fixture.context)
    const pending = match(jobId, { signal: controller.signal, onLocal })
    const cancelled = expect(pending).rejects.toThrow('已停止匹配')
    expect(onLocal).toHaveBeenCalledTimes(1)
    expect(onLocal.mock.calls[0]![0].items).toHaveLength(2)
    expect(onLocal.mock.calls[0]![0].cloud.reviewedCount).toBe(0)
    controller.abort()
    await cancelled
    expect(fixture.cloud!.assessMatchCandidates.mock.calls[0]![0].signal.aborted).toBe(true)
    expect(fixture.cloud!.cancel).toHaveBeenCalledWith('cancel-test')
    finish({ assessments: [] })
    expect(onLocal).toHaveBeenCalledTimes(1)
  })
  it('filters non-own and unset staff before sending a self-company-only case to the cloud', async () => {
    const f = setup(async () => ({ assessments: [verdict('CANDIDATE_1')] }))
    f.setProfiles([{ ...makePerson('own'), isOwnCompany: true }, { ...makePerson('partner'), isOwnCompany: false }, makePerson('unset')])
    f.setCases([{ ...job, fields: [...job.fields, { key: 'contract_chain', label: '商流', value: '貴社社員のみ', sourceLabels: [] }] }])
    const result = await createCasePersonnelMatcher(f.context)(jobId)
    expect(result.items.map((item) => item.documentId)).toEqual(['own'])
    expect(result.ownCompanyExcludedCount).toBe(2)
    expect(f.cloud!.assessMatchCandidates.mock.calls[0]![0].candidates).toHaveLength(1)
    expect(result.items[0]?.hardFilters).toContainEqual({ type: 'own-company', requested: '自社限定', actual: '自社', outcome: 'passed' })
  })
  it('requires professional evidence and assesses only five people in one private batch', async () => {
    const f = setup(async () => ({ assessments: [verdict('CANDIDATE_1'), verdict('CANDIDATE_2', 'strong')] }))
    f.setProfiles([...Array.from({ length: 7 }, (_, i) => makePerson(String(i))), makePerson('irrelevant', 'Salesforce')])
    const result = await createCasePersonnelMatcher(f.context)(jobId)
    expect(result.localMatchCount).toBe(7)
    expect(result.items).toHaveLength(5)
    expect(result.items[0]?.documentId).toBe('1')
    expect(result.cloud).toMatchObject({ status: 'partial', reviewedCount: 2 })
    expect(f.cloud!.assessMatchCandidates).toHaveBeenCalledTimes(1)
    const input = f.cloud!.assessMatchCandidates.mock.calls[0]![0]
    expect(input.candidates).toHaveLength(5)
    expect(JSON.stringify(input)).not.toMatch(/PRIVATE NAME|private@example.com|sourceDocumentId/)
    expect(input.jobCase.requirements).toEqual([{ key: 'required_skills', label: '必須', value: 'Java' }])
  })
  it('does not promote evidence-free confidence or unknown hard conditions to strong', async () => {
    const f = setup(async () => ({ assessments: [verdict('CANDIDATE_1', 'strong'), { ...verdict('CANDIDATE_2', 'strong'), met: [] }] }))
    f.setCases([{ ...job, fields: [...job.fields, { key: 'location', label: '勤務地', value: '東京', sourceLabels: [] }] }])
    const result = await createCasePersonnelMatcher(f.context)(jobId)
    expect(result.items.map((item) => item.assessment?.fit)).toEqual(['possible', 'insufficient-info'])
    expect(result.items[0]?.assessment?.confirm.length).toBeGreaterThan(0)
  })
  it('honestly returns local results on failure or unavailable cloud, and skips empty shortlists', async () => {
    const absent = setup()
    expect((await createCasePersonnelMatcher(absent.context)(jobId)).cloud.status).toBe('unavailable')
    const fail = setup(async () => { throw new Error('offline') })
    expect((await createCasePersonnelMatcher(fail.context)(jobId)).cloud.status).toBe('failed')
    const empty = setup(async () => ({ assessments: [] }))
    empty.setProfiles([makePerson('irrelevant', 'Salesforce')])
    expect((await createCasePersonnelMatcher(empty.context)(jobId)).cloud.status).toBe('not-needed')
    expect(empty.cloud!.assessMatchCandidates).not.toHaveBeenCalled()
  })
  it('deduplicates pending calls and rejects a case changed during assessment', async () => {
    let finish!: (value: AgentMatchAssessmentResult) => void
    const f = setup(() => new Promise((resolve) => { finish = resolve }))
    const match = createCasePersonnelMatcher(f.context)
    const first = match(jobId)
    expect(match(jobId)).toBe(first)
    f.setCases([{ ...job, version: 2 }])
    finish({ assessments: [verdict('CANDIDATE_1')] })
    await expect(first).rejects.toThrow('案件已更新')
    expect(f.cloud!.assessMatchCandidates).toHaveBeenCalledTimes(1)
  })
  it('removes people edited or paused before the response returns', async () => {
    const f = setup(async () => {
      f.setProfiles([{ ...makePerson('a'), profileVersion: 2 }])
      return { assessments: [verdict('CANDIDATE_1'), verdict('CANDIDATE_2')] }
    })
    expect((await createCasePersonnelMatcher(f.context)(jobId)).items).toEqual([])
  })
  it('aborts and cancels timed-out remote work, then permits retry', async () => {
    vi.useFakeTimers()
    const f = setup(async (input) => { input.onClientRequestId('remote-1'); return new Promise(() => {}) })
    const match = createCasePersonnelMatcher(f.context, 20)
    const first = match(jobId)
    await vi.advanceTimersByTimeAsync(21)
    expect((await first).cloud.status).toBe('failed')
    expect(f.cloud!.assessMatchCandidates.mock.calls[0]![0].signal.aborted).toBe(true)
    expect(f.cloud!.cancel).toHaveBeenCalledWith('remote-1')
    const second = match(jobId)
    await vi.advanceTimersByTimeAsync(21)
    await second
    expect(f.cloud!.assessMatchCandidates).toHaveBeenCalledTimes(2)
  })
})
