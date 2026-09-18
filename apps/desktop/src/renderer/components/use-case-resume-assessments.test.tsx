import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { CandidateReviewSnapshot, CasePersonAssessment, CasePersonnelMatchResult, CaseResumeImportProgress, JobCaseReviewSnapshot } from '@shared'
import { useCaseResumeAssessments } from './use-case-resume-assessments'

const job = { reviewId: 'review-a', reviewRevision: 1, lifecycle: 'active', jobCase: { id: 'case-a', version: 1 } } as JobCaseReviewSnapshot
const other = { ...job, reviewId: 'review-b', jobCase: { ...job.jobCase!, id: 'case-b' } }
const person = { documentId: 'person', fileName: 'resume.xlsx', localIdentity: { displayName: 'Engineer' }, recordStatus: 'active' } as CandidateReviewSnapshot
const assessment = (jobCaseId: string) => ({ id: crypto.randomUUID(), documentId: person.documentId, jobCaseId, assessedAt: new Date().toISOString() }) as CasePersonAssessment
function file(name = 'resume.xlsx') { const file = new File(['resume'], name); Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(6) }); return file }
let progress: (event: CaseResumeImportProgress) => void
beforeEach(() => {
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: {
    onCaseResumeImportProgress: vi.fn(listener => { progress = listener; return () => {} }),
    importResumeForCase: vi.fn(async ({ jobCaseId }) => ({ person, assessment: assessment(jobCaseId), error: null })),
    assessCasePerson: vi.fn(async ({ jobCaseId }) => assessment(jobCaseId)),
    listCaseAssessments: vi.fn(async () => []), prepareCaseAssessment: vi.fn(async () => job)
  } })
})

it('binds queued files to their original case and accepts progress only for that request', async () => {
  let finish!: (value: any) => void
  vi.mocked(window.sesAgent.importResumeForCase).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { result } = renderHook(useCaseResumeAssessments)
  let first = ''
  act(() => { first = result.current.enqueue(job, [file()]); result.current.enqueue(other, [file('other.xlsx')]) })
  await waitFor(() => expect(window.sesAgent.importResumeForCase).toHaveBeenCalledTimes(1))
  act(() => progress({ requestId: first, jobCaseId: 'case-b', stage: 'assessing', documentId: 'wrong' }))
  expect(result.current.tasks.find(t => t.id === first)?.status).toBe('parsing')
  act(() => progress({ requestId: first, jobCaseId: 'case-a', stage: 'assessing', documentId: person.documentId }))
  expect(result.current.tasks.find(t => t.id === first)?.status).toBe('assessing')
  await act(async () => finish({ person, assessment: assessment('case-a'), error: null }))
  await waitFor(() => expect(result.current.tasks.every(t => t.status === 'completed')).toBe(true))
  expect(result.current.tasks.map(t => [t.reviewId, t.assessment?.jobCaseId])).toEqual([['review-b', 'case-b'], ['review-a', 'case-a']])
  expect(result.current.tasks.every(t => t.file === undefined)).toBe(true)
})

it('retries assessment without reimporting an already parsed resume', async () => {
  vi.mocked(window.sesAgent.importResumeForCase).mockResolvedValueOnce({ person, assessment: null, error: 'offline' })
  const { result } = renderHook(useCaseResumeAssessments)
  let id = ''
  act(() => { id = result.current.enqueue(job, [file()]) })
  await waitFor(() => expect(result.current.tasks[0]?.status).toBe('failed'))
  act(() => { result.current.retry(id); result.current.retry(id) })
  await waitFor(() => expect(result.current.tasks[0]?.status).toBe('completed'))
  expect(window.sesAgent.importResumeForCase).toHaveBeenCalledTimes(1)
  expect(window.sesAgent.assessCasePerson).toHaveBeenCalledTimes(1)
})

it('continues after a failed file and deduplicates successful personnel within each case', async () => {
  const { result } = renderHook(useCaseResumeAssessments)
  act(() => { result.current.enqueue(job, [file('invalid.exe'), file(), file('duplicate.xlsx')]) })
  await waitFor(() => expect(result.current.tasks.filter(t => t.status === 'completed')).toHaveLength(1))
  await waitFor(() => expect(result.current.tasks).toHaveLength(2))
  expect(result.current.tasks.find(t => t.status === 'failed')?.name).toBe('invalid.exe')
  expect(window.sesAgent.importResumeForCase).toHaveBeenCalledTimes(2)
})

it('loads saved case history without replacing an assessment that just completed', async () => {
  let finish!: (value: CasePersonAssessment[]) => void
  vi.mocked(window.sesAgent.listCaseAssessments).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { result } = renderHook(useCaseResumeAssessments)
  act(() => { void result.current.loadHistory(job); result.current.enqueue(job, [file()]) })
  await waitFor(() => expect(result.current.tasks[0]?.status).toBe('completed'))
  const freshId = result.current.tasks[0]?.assessment?.id
  await act(async () => finish([assessment('case-a')]))
  expect(result.current.tasks).toHaveLength(1)
  expect(result.current.tasks[0]?.assessment?.id).toBe(freshId)
})

it('prepares an imported draft once and evaluates all dropped resumes without a review step', async () => {
  const { result } = renderHook(useCaseResumeAssessments)
  act(() => { result.current.enqueue({ ...job, jobCase: null, status: 'awaiting-review' }, [file(), file('second.xlsx')]) })
  await waitFor(() => expect(window.sesAgent.importResumeForCase).toHaveBeenCalledTimes(2))
  expect(window.sesAgent.prepareCaseAssessment).toHaveBeenCalledTimes(1)
  expect(window.sesAgent.prepareCaseAssessment).toHaveBeenCalledWith({ reviewId: job.reviewId, expectedReviewRevision: 1 })
  expect(vi.mocked(window.sesAgent.importResumeForCase).mock.calls.every(([input]) => input.jobCaseId === 'case-a')).toBe(true)
})

it('keeps searches scoped to each case, streams local results and reopens without rerunning', async () => {
  let notify!: (event: any) => void
  let finishA!: (value: any) => void, finishB!: (value: any) => void
  window.sesAgent.onBusinessMatchingProgress = vi.fn(listener => { notify = listener; return () => {} })
  window.sesAgent.findPersonnelForCase = vi.fn(id => new Promise<CasePersonnelMatchResult>(resolve => { if (id === 'case-a') finishA = resolve; else finishB = resolve }))
  const make = (id: string, doc: string) => ({ jobCaseId: id, jobCaseVersion: 1, rulesRevision: 0, localMatchCount: 1,
    items: [{ documentId: doc, profileVersion: 1, assessmentId: `saved-${doc}`, score: 1, matched: [], missing: [], hardFilters: [], qualification: { status: 'recommended', requirements: [] } }],
    cloud: { status: 'reviewed', reviewedCount: 1, modelName: 'test' } })
  const { result } = renderHook(useCaseResumeAssessments)
  act(() => { void result.current.search(job); void result.current.search(job); void result.current.search(other) })
  await waitFor(() => expect(window.sesAgent.findPersonnelForCase).toHaveBeenCalledTimes(2))
  act(() => notify({ kind: 'case', id: 'wrong', result: make('wrong', 'wrong') }))
  expect(result.current.tasks).toHaveLength(0)
  act(() => notify({ kind: 'case', id: 'case-a', result: make('case-a', 'a') }))
  expect(result.current.searches['review-a']?.localReady).toBe(true)
  expect(result.current.tasks[0]?.reviewId).toBe('review-a')
  await act(async () => { finishB(make('case-b', 'b')); finishA(make('case-a', 'a')) })
  expect(result.current.tasks.map(item => item.documentId).sort()).toEqual(['a', 'b'])
  await act(async () => { await result.current.search(job); await result.current.search(other) })
  expect(window.sesAgent.findPersonnelForCase).toHaveBeenCalledTimes(2)
})

it('merges a searched person with specified assessment and preserves a newer explicit result', async () => {
  let finish!: (value: any) => void
  window.sesAgent.findPersonnelForCase = vi.fn(() => new Promise<CasePersonnelMatchResult>(resolve => { finish = resolve }))
  const { result } = renderHook(useCaseResumeAssessments)
  act(() => { void result.current.search(job) })
  await waitFor(() => expect(window.sesAgent.findPersonnelForCase).toHaveBeenCalledTimes(1))
  act(() => { result.current.addPerson(job, person) })
  await waitFor(() => expect(result.current.tasks[0]?.status).toBe('completed'))
  const explicitId = result.current.tasks[0]!.assessment!.id
  await act(async () => finish({ jobCaseId: 'case-a', jobCaseVersion: 1, localMatchCount: 1, cloud: { status: 'reviewed', reviewedCount: 1, modelName: 'test' },
    items: [{ documentId: person.documentId, profileVersion: 1, assessmentId: 'older-batch', qualification: { status: 'excluded', requirements: [] } }] }))
  expect(result.current.tasks).toHaveLength(1)
  expect(result.current.tasks[0]?.assessment?.id).toBe(explicitId)
  expect(result.current.tasks[0]?.origin).toBe('specified')
  window.sesAgent.findPersonnelForCase = vi.fn(async () => ({ jobCaseId: 'case-a', jobCaseVersion: 1, localMatchCount: 0, items: [], cloud: { status: 'not-needed' as const, reviewedCount: 0, modelName: null } }))
  await act(async () => { await result.current.search(job, true) })
  expect(result.current.tasks[0]?.assessment?.id).toBe(explicitId)
})

it('restores saved searches without another model call and does not restart an empty search on reopen', async () => {
  const saved: CasePersonAssessment = { ...assessment('case-a'), origin: 'search', result: { documentId: person.documentId, profileVersion: 1, score: 1, matched: [], missing: [], hardFilters: [], qualification: { policyVersion: 'technical-language-v3', status: 'recommended', requirements: [] } } }
  vi.mocked(window.sesAgent.listCaseAssessments).mockResolvedValueOnce([saved])
  window.sesAgent.findPersonnelForCase = vi.fn(async id => ({ jobCaseId: id, jobCaseVersion: 1, localMatchCount: 0, items: [], cloud: { status: 'not-needed' as const, reviewedCount: 0, modelName: null } }))
  const { result } = renderHook(useCaseResumeAssessments)
  await act(async () => { await result.current.search(job) })
  expect(window.sesAgent.findPersonnelForCase).not.toHaveBeenCalled()
  expect(result.current.tasks[0]?.origin).toBe('search')
  await act(async () => { await result.current.search(job, true) })
  expect(result.current.tasks).toHaveLength(0)
  await act(async () => { await result.current.search(job) })
  expect(window.sesAgent.findPersonnelForCase).toHaveBeenCalledTimes(1)
})
