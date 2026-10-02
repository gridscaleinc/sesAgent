import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type {
  CandidateReviewSnapshot,
  CasePersonAssessment,
  CasePersonnelMatchResult,
  CaseResumeImportProgress,
  JobCaseReviewSnapshot
} from '@shared'
import { useCaseResumeAssessments } from './use-case-resume-assessments'

const job = { reviewId: 'review-a', reviewRevision: 1, lifecycle: 'active', jobCase: { id: 'case-a', version: 1 } } as JobCaseReviewSnapshot
const other = { ...job, reviewId: 'review-b', jobCase: { ...job.jobCase!, id: 'case-b' } }
const person = {
  documentId: 'person',
  fileName: 'resume.xlsx',
  localIdentity: { displayName: 'Engineer' },
  recordStatus: 'active'
} as CandidateReviewSnapshot
const assessment = (jobCaseId: string) =>
  ({ id: crypto.randomUUID(), documentId: person.documentId, jobCaseId, assessedAt: new Date().toISOString() }) as CasePersonAssessment
function file(name = 'resume.xlsx') {
  const file = new File(['resume'], name)
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(6) })
  return file
}
let progress: (event: CaseResumeImportProgress) => void
beforeEach(() => {
  Object.defineProperty(window, 'sesAgent', {
    configurable: true,
    value: {
      onCaseResumeImportProgress: vi.fn((listener) => {
        progress = listener
        return () => {}
      }),
      importResumeForCase: vi.fn(async ({ jobCaseId }) => ({ person, assessment: assessment(jobCaseId), error: null })),
      assessCasePerson: vi.fn(async ({ jobCaseId }) => assessment(jobCaseId)),
      listCaseAssessments: vi.fn(async () => []),
      prepareCaseAssessment: vi.fn(async () => job)
    }
  })
})

it('binds queued files to their original case and accepts progress only for that request', async () => {
  let finish!: (value: any) => void
  vi.mocked(window.sesAgent.importResumeForCase).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const { result } = renderHook(useCaseResumeAssessments)
  let first = ''
  act(() => {
    first = result.current.enqueue(job, [file()])
    result.current.enqueue(other, [file('other.xlsx')])
  })
  await waitFor(() => expect(window.sesAgent.importResumeForCase).toHaveBeenCalledTimes(1))
  act(() => progress({ requestId: first, jobCaseId: 'case-b', stage: 'assessing', documentId: 'wrong' }))
  expect(result.current.tasks.find((t) => t.id === first)?.status).toBe('parsing')
  act(() => progress({ requestId: first, jobCaseId: 'case-a', stage: 'assessing', documentId: person.documentId }))
  expect(result.current.tasks.find((t) => t.id === first)?.status).toBe('assessing')
  await act(async () => finish({ person, assessment: assessment('case-a'), error: null }))
  await waitFor(() => expect(result.current.tasks.every((t) => t.status === 'completed')).toBe(true))
  expect(result.current.tasks.map((t) => [t.reviewId, t.assessment?.jobCaseId])).toEqual([
    ['review-b', 'case-b'],
    ['review-a', 'case-a']
  ])
  expect(result.current.tasks.every((t) => t.file === undefined)).toBe(true)
})

it('retries assessment without reimporting an already parsed resume', async () => {
  vi.mocked(window.sesAgent.importResumeForCase).mockResolvedValueOnce({ person, assessment: null, error: 'offline' })
  const { result } = renderHook(useCaseResumeAssessments)
  let id = ''
  act(() => {
    id = result.current.enqueue(job, [file()])
  })
  await waitFor(() => expect(result.current.tasks[0]?.status).toBe('failed'))
  act(() => {
    result.current.retry(id)
    result.current.retry(id)
  })
  await waitFor(() => expect(result.current.tasks[0]?.status).toBe('completed'))
  expect(window.sesAgent.importResumeForCase).toHaveBeenCalledTimes(1)
  expect(window.sesAgent.assessCasePerson).toHaveBeenCalledTimes(1)
})

it('continues after a failed file and deduplicates successful personnel within each case', async () => {
  const { result } = renderHook(useCaseResumeAssessments)
  act(() => {
    result.current.enqueue(job, [file('invalid.exe'), file(), file('duplicate.xlsx')])
  })
  await waitFor(() => expect(result.current.tasks.filter((t) => t.status === 'completed')).toHaveLength(1))
  await waitFor(() => expect(result.current.tasks).toHaveLength(2))
  expect(result.current.tasks.find((t) => t.status === 'failed')?.name).toBe('invalid.exe')
  expect(window.sesAgent.importResumeForCase).toHaveBeenCalledTimes(2)
})

it('loads saved case history without replacing an assessment that just completed', async () => {
  let finish!: (value: CasePersonAssessment[]) => void
  vi.mocked(window.sesAgent.listCaseAssessments).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const { result } = renderHook(useCaseResumeAssessments)
  act(() => {
    void result.current.loadHistory(job)
    result.current.enqueue(job, [file()])
  })
  await waitFor(() => expect(result.current.tasks[0]?.status).toBe('completed'))
  const freshId = result.current.tasks[0]?.assessment?.id
  await act(async () => finish([assessment('case-a')]))
  expect(result.current.tasks).toHaveLength(1)
  expect(result.current.tasks[0]?.assessment?.id).toBe(freshId)
})

it('prepares an imported draft once and evaluates all dropped resumes without a review step', async () => {
  const { result } = renderHook(useCaseResumeAssessments)
  act(() => {
    result.current.enqueue({ ...job, jobCase: null, status: 'awaiting-review' }, [file(), file('second.xlsx')])
  })
  await waitFor(() => expect(window.sesAgent.importResumeForCase).toHaveBeenCalledTimes(2))
  expect(window.sesAgent.prepareCaseAssessment).toHaveBeenCalledTimes(1)
  expect(window.sesAgent.prepareCaseAssessment).toHaveBeenCalledWith({ reviewId: job.reviewId, expectedReviewRevision: 1 })
  expect(vi.mocked(window.sesAgent.importResumeForCase).mock.calls.every(([input]) => input.jobCaseId === 'case-a')).toBe(true)
})

it('keeps searches scoped to each case, streams local results and reopens without rerunning', async () => {
  let notify!: (event: any) => void
  let finishA!: (value: any) => void, finishB!: (value: any) => void
  window.sesAgent.onBusinessMatchingProgress = vi.fn((listener) => {
    notify = listener
    return () => {}
  })
  window.sesAgent.findPersonnelForCase = vi.fn(
    (id) =>
      new Promise<CasePersonnelMatchResult>((resolve) => {
        if (id === 'case-a') finishA = resolve
        else finishB = resolve
      })
  )
  const make = (id: string, doc: string) => ({
    jobCaseId: id,
    jobCaseVersion: 1,
    rulesRevision: 0,
    localMatchCount: 1,
    items: [
      {
        documentId: doc,
        profileVersion: 1,
        assessmentId: `saved-${doc}`,
        score: 1,
        matched: [],
        missing: [],
        hardFilters: [],
        qualification: { status: 'recommended', requirements: [] }
      }
    ],
    cloud: { status: 'reviewed', reviewedCount: 1, modelName: 'test' }
  })
  const { result } = renderHook(useCaseResumeAssessments)
  act(() => {
    void result.current.search(job)
    void result.current.search(job)
    void result.current.search(other)
  })
  await waitFor(() => expect(window.sesAgent.findPersonnelForCase).toHaveBeenCalledTimes(2))
  act(() => notify({ kind: 'case', id: 'wrong', result: make('wrong', 'wrong') }))
  expect(result.current.tasks).toHaveLength(0)
  act(() => notify({ kind: 'case', id: 'case-a', result: make('case-a', 'a') }))
  expect(result.current.searches['review-a']?.localReady).toBe(true)
  expect(result.current.tasks[0]?.reviewId).toBe('review-a')
  await act(async () => {
    finishB(make('case-b', 'b'))
    finishA(make('case-a', 'a'))
  })
  expect(result.current.tasks.map((item) => item.documentId).sort()).toEqual(['a', 'b'])
  await act(async () => {
    await result.current.search(job)
    await result.current.search(other)
  })
  expect(window.sesAgent.findPersonnelForCase).toHaveBeenCalledTimes(2)
})

it('merges a searched person with specified assessment and preserves a newer explicit result', async () => {
  let finish!: (value: any) => void
  window.sesAgent.findPersonnelForCase = vi.fn(
    () =>
      new Promise<CasePersonnelMatchResult>((resolve) => {
        finish = resolve
      })
  )
  const { result } = renderHook(useCaseResumeAssessments)
  act(() => {
    void result.current.search(job)
  })
  await waitFor(() => expect(window.sesAgent.findPersonnelForCase).toHaveBeenCalledTimes(1))
  act(() => {
    result.current.addPerson(job, person)
  })
  await waitFor(() => expect(result.current.tasks[0]?.status).toBe('completed'))
  const explicitId = result.current.tasks[0]!.assessment!.id
  await act(async () =>
    finish({
      jobCaseId: 'case-a',
      jobCaseVersion: 1,
      localMatchCount: 1,
      cloud: { status: 'reviewed', reviewedCount: 1, modelName: 'test' },
      items: [
        {
          documentId: person.documentId,
          profileVersion: 1,
          assessmentId: 'older-batch',
          qualification: { status: 'excluded', requirements: [] }
        }
      ]
    })
  )
  expect(result.current.tasks).toHaveLength(1)
  expect(result.current.tasks[0]?.assessment?.id).toBe(explicitId)
  expect(result.current.tasks[0]?.origin).toBe('specified')
  window.sesAgent.findPersonnelForCase = vi.fn(async () => ({
    jobCaseId: 'case-a',
    jobCaseVersion: 1,
    localMatchCount: 0,
    items: [],
    cloud: { status: 'not-needed' as const, reviewedCount: 0, modelName: null }
  }))
  await act(async () => {
    await result.current.search(job, true)
  })
  expect(result.current.tasks[0]?.assessment?.id).toBe(explicitId)
})

it('restores saved searches without another model call and does not restart an empty search on reopen', async () => {
  const saved: CasePersonAssessment = {
    ...assessment('case-a'),
    origin: 'search',
    result: {
      documentId: person.documentId,
      profileVersion: 1,
      score: 1,
      matched: [],
      missing: [],
      hardFilters: [],
      qualification: { policyVersion: 'technical-language-v5', status: 'recommended', requirements: [] }
    }
  }
  vi.mocked(window.sesAgent.listCaseAssessments).mockResolvedValueOnce([saved])
  window.sesAgent.findPersonnelForCase = vi.fn(async (id) => ({
    jobCaseId: id,
    jobCaseVersion: 1,
    localMatchCount: 0,
    items: [],
    cloud: { status: 'not-needed' as const, reviewedCount: 0, modelName: null }
  }))
  const { result } = renderHook(useCaseResumeAssessments)
  await act(async () => {
    await result.current.search(job)
  })
  expect(window.sesAgent.findPersonnelForCase).not.toHaveBeenCalled()
  expect(result.current.tasks[0]?.origin).toBe('search')
  await act(async () => {
    await result.current.search(job, true)
  })
  expect(result.current.tasks).toHaveLength(0)
  await act(async () => {
    await result.current.search(job)
  })
  expect(window.sesAgent.findPersonnelForCase).toHaveBeenCalledTimes(1)
})

it('shows and counts one list: placed searched people are hidden and duplicate records of one person collapse', async () => {
  const { visibleCaseTasks } = await import('./use-case-resume-assessments')
  const library = {
    documentId: 'lib',
    fileName: 'resume.xlsx',
    localIdentity: { displayName: '楊 凱' },
    recordStatus: 'active',
    projectExperiences: [{ title: '日立財務報表システム' }]
  } as unknown as CandidateReviewSnapshot
  const dragged = {
    documentId: 'drag',
    fileName: 'yang.pdf',
    localIdentity: { displayName: '楊凱' },
    recordStatus: 'active',
    projectExperiences: [{ title: '日立財務報表システム' }, { title: '商取引アプリ' }]
  } as unknown as CandidateReviewSnapshot
  const placed = {
    documentId: 'placed',
    fileName: 'placed.pdf',
    localIdentity: { displayName: '佐藤' },
    recordStatus: 'active',
    projectExperiences: []
  } as unknown as CandidateReviewSnapshot
  const stranger = {
    documentId: 'other',
    fileName: 'other.pdf',
    localIdentity: { displayName: '楊凱' },
    recordStatus: 'active',
    projectExperiences: [{ title: '別システム' }]
  } as unknown as CandidateReviewSnapshot
  const task = (
    id: string,
    documentId: string,
    origin: 'search' | 'specified',
    extra: Partial<import('./use-case-resume-assessments').CaseResumeTask> = {}
  ) => ({
    id,
    reviewId: 'review-a',
    jobCaseId: 'case-a',
    reviewRevision: 1,
    name: '',
    status: 'completed' as const,
    documentId,
    origin,
    assessment: { id, documentId, result: {} } as any,
    ...extra
  })
  const all = [
    task('t-lib', 'lib', 'search'),
    task('t-drag', 'drag', 'specified'),
    task('t-placed', 'placed', 'search'),
    task('t-other', 'other', 'search'),
    { ...task('t-b', 'lib', 'search'), reviewId: 'review-b' }
  ]
  const view = visibleCaseTasks(all, 'review-a', [library, dragged, placed, stranger], new Set(['placed']))
  expect(view.tasks.map((item) => item.id)).toEqual(['t-drag', 't-other'])
  expect(view.hiddenDuplicates.get('t-drag')?.map((item) => item.id)).toEqual(['t-lib'])
  // A record that already has a follow-up wins over the manually added copy.
  const withFollow = visibleCaseTasks(
    all,
    'review-a',
    [library, dragged, placed, stranger],
    new Set(['placed']),
    (item) => item.documentId === 'lib'
  )
  expect(withFollow.tasks.map((item) => item.id)).toEqual(['t-lib', 't-other'])
  expect(withFollow.hiddenDuplicates.get('t-lib')?.map((item) => item.id)).toEqual(['t-drag'])
  // A manually added person stays visible even after placement; only searched people are hidden.
  expect(visibleCaseTasks([task('t-p', 'placed', 'specified')], 'review-a', [placed], new Set(['placed'])).tasks).toHaveLength(1)
  // A deleted person leaves the list however they came in: manually added, or in a follow-up for this case.
  expect(visibleCaseTasks([task('t-gone', 'gone', 'specified')], 'review-a', [library], new Set()).tasks).toEqual([])
  expect(visibleCaseTasks([task('t-gone', 'gone', 'search')], 'review-a', [library], new Set(), () => true).tasks).toEqual([])
})

it('reassesses with the operator request, keeps it across a failed retry and clears it on a plain reassessment', async () => {
  const { result } = renderHook(useCaseResumeAssessments)
  let id = ''
  act(() => {
    id = result.current.enqueue(job, [file()])
  })
  await waitFor(() => expect(result.current.tasks[0]?.status).toBe('completed'))
  vi.mocked(window.sesAgent.assessCasePerson).mockRejectedValueOnce(new Error('offline'))
  act(() => result.current.retry(id, undefined, '重点看日语'))
  await waitFor(() => expect(result.current.tasks[0]?.status).toBe('failed'))
  expect(window.sesAgent.assessCasePerson).toHaveBeenLastCalledWith({ jobCaseId: 'case-a', documentId: 'person', request: '重点看日语' })
  act(() => result.current.retry(id))
  await waitFor(() => expect(result.current.tasks[0]?.status).toBe('completed'))
  expect(window.sesAgent.assessCasePerson).toHaveBeenLastCalledWith({ jobCaseId: 'case-a', documentId: 'person', request: '重点看日语' })
  act(() => result.current.retry(id, undefined, null))
  await waitFor(() => expect(window.sesAgent.assessCasePerson).toHaveBeenCalledTimes(3))
  expect(window.sesAgent.assessCasePerson).toHaveBeenLastCalledWith({ jobCaseId: 'case-a', documentId: 'person' })
})

it('counts saved searches on the case card until this session has its own result, even an empty one', async () => {
  Object.assign(window.sesAgent, {
    listCaseSearchSummaries: vi.fn(async () => [
      { reviewId: job.reviewId, listedCount: 3, lastSearchedAt: '2026-09-01T00:00:00.000Z' },
      { reviewId: other.reviewId, listedCount: 1, lastSearchedAt: null }
    ]),
    findPersonnelForCase: vi.fn(async (jobCaseId: string) => ({
      jobCaseId,
      jobCaseVersion: 1,
      items: [],
      localMatchCount: 0,
      assessedAt: new Date().toISOString(),
      cloud: { status: 'unavailable', reviewedCount: 0, modelName: null }
    })),
    onBusinessMatchingProgress: vi.fn(() => () => {})
  })
  const { result } = renderHook(useCaseResumeAssessments)
  await waitFor(() => expect(result.current.cardStates([person])[job.reviewId]).toEqual({ pending: 0, count: 3 }))
  await act(async () => result.current.search(job, true))
  expect(result.current.cardStates([person])).toEqual({
    [job.reviewId]: { pending: 0, count: 0 },
    [other.reviewId]: { pending: 0, count: 1 }
  })
})

it('opens a pair on its saved assessment and assesses again only when the case or profile changed', async () => {
  const current = { ...person, profile: { version: 2 } } as CandidateReviewSnapshot
  const saved = { ...assessment('case-a'), jobCaseVersion: 1, profileVersion: 2, origin: 'specified' } as CasePersonAssessment
  let release!: () => void
  // History arrives late: a concurrent caller must wait for it instead of assessing again.
  vi.mocked(window.sesAgent.listCaseAssessments).mockImplementation(() => new Promise((resolve) => (release = () => resolve([saved]))))
  const { result } = renderHook(useCaseResumeAssessments)
  let first!: Promise<string>
  let second!: Promise<string>
  act(() => {
    void result.current.loadHistory(job)
    first = result.current.openPerson(job, current)
  })
  await act(async () => release())
  await act(async () => {
    await first
  })
  expect(await first).toBe(saved.id)
  expect(window.sesAgent.assessCasePerson).not.toHaveBeenCalled()
  // Opening it again still shows the saved result.
  await act(async () => {
    second = result.current.openPerson(job, current)
    await second
  })
  expect(await second).toBe(saved.id)
  expect(window.sesAgent.assessCasePerson).not.toHaveBeenCalled()
  // A newer profile version is assessed again.
  await act(async () => {
    await result.current.openPerson(job, { ...current, profile: { version: 3 } } as CandidateReviewSnapshot)
  })
  await waitFor(() => expect(window.sesAgent.assessCasePerson).toHaveBeenCalledTimes(1))
})

it('keeps a person HR judged 不满足 in the list, last, and replaces results when a decision arrives', async () => {
  const { visibleCaseTasks, compareCaseTasks } = await import('./use-case-resume-assessments')
  const { announceRequirementDecision } = await import('../requirement-decision-events')
  const requirement = {
    id: 'L',
    key: 'required_skills',
    label: '日本語流暢',
    category: 'condition' as const,
    alternatives: [],
    minimumYears: null,
    requiresPractice: false
  }
  const decided = (outcome: 'conflict' | 'unknown', hr: boolean) =>
    ({
      ...assessment('case-a'),
      jobCaseVersion: 1,
      profileVersion: 1,
      origin: 'search',
      result: {
        qualification: {
          policyVersion: 'technical-language-v5',
          status: outcome === 'conflict' ? 'excluded' : 'needs-confirmation',
          requirements: [
            {
              requirement,
              outcome,
              evidence: null,
              source: null,
              ...(hr
                ? {
                    hrDecision: {
                      confirmationId: 'c',
                      outcome: 'conflict',
                      scope: 'person',
                      note: null,
                      question: null,
                      decidedAt: '',
                      decidedBy: null
                    }
                  }
                : {})
            }
          ]
        }
      }
    }) as unknown as CasePersonAssessment
  const task = (id: string, documentId: string, value: CasePersonAssessment) => ({
    id,
    reviewId: 'review-a',
    reviewRevision: 1,
    jobCaseId: 'case-a',
    documentId,
    name: id,
    status: 'completed' as const,
    origin: 'search' as const,
    assessment: { ...value, documentId }
  })
  const people = ['hr', 'model', 'open'].map(
    (documentId) =>
      ({
        ...person,
        documentId,
        fileName: `${documentId}.xlsx`,
        localIdentity: { displayName: documentId },
        recordStatus: 'active'
      }) as CandidateReviewSnapshot
  )
  const all = [
    task('hr', 'hr', decided('conflict', true)),
    task('model', 'model', decided('conflict', false)),
    task('open', 'open', decided('unknown', false))
  ]
  const view = visibleCaseTasks(all, 'review-a', people, new Set())
  // HR's 不满足 stays listed (last); a conflict found in the material is listed apart as excluded.
  expect(view.tasks.toSorted(compareCaseTasks).map((item) => item.id)).toEqual(['open', 'hr'])
  expect(view.excluded.map((item) => item.task.id)).toEqual(['model'])

  const { result } = renderHook(useCaseResumeAssessments)
  vi.mocked(window.sesAgent.listCaseAssessments).mockResolvedValue([{ ...decided('unknown', false), documentId: person.documentId }])
  await act(async () => {
    await result.current.loadHistory(job)
  })
  const replaced = { ...decided('conflict', true), documentId: person.documentId }
  act(() => announceRequirementDecision({ documentId: person.documentId, confirmations: [], assessments: [replaced], personRun: null }))
  expect(result.current.tasks[0]!.assessment).toEqual(replaced)
})
