import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CandidateReviewSnapshot, CasePersonnelMatchResult, JobCaseReviewSnapshot } from '@shared'
import { CaseMatchingWorkspace } from './CaseMatchingWorkspace'
const job = { reviewId: 'review-a', jobCase: { id: 'case-a', version: 1 }, lifecycle: 'active', redactedSubject: 'Java project', fields: [] } as unknown as JobCaseReviewSnapshot
const other = { ...job, reviewId: 'review-b', jobCase: { ...job.jobCase!, id: 'case-b' }, redactedSubject: 'Other project' }
const person = { documentId: 'person-a', fileName: 'Engineer A.pdf', recordStatus: 'active', profile: { version: 1 } } as CandidateReviewSnapshot
const result: CasePersonnelMatchResult = { jobCaseId: 'case-a', jobCaseVersion: 1, localMatchCount: 1, cloud: { status: 'failed', reviewedCount: 0, modelName: null },
  items: [{ documentId: 'person-a', profileVersion: 1, score: 5, matched: ['Java'], missing: [], hardFilters: [], qualification: { policyVersion: 'mandatory-evidence-v1', status: 'recommended', requirements: [] } }] }
const props = { reviews: [job, other], candidates: [person], onOpenPerson: vi.fn() }
describe('case matching workspace', () => {
  it('shows only the current case, discards repeat requests and permits retry after failure', async () => {
    let fail!: (error: Error) => void
    const findPersonnelForCase = vi.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject })).mockResolvedValue(result)
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: { findPersonnelForCase } })
    const onMatchingChange = vi.fn()
    const view = render(<CaseMatchingWorkspace {...props} jobCaseId="case-a" request={{ id: 1, jobCaseId: 'case-a' }} onMatchingChange={onMatchingChange} />)
    expect(await screen.findByRole('button', { name: 'マッチング中…' })).toBeDisabled()
    expect(screen.queryByText('Other project')).not.toBeInTheDocument()
    view.rerender(<CaseMatchingWorkspace {...props} jobCaseId="case-a" request={{ id: 2, jobCaseId: 'case-a' }} onMatchingChange={onMatchingChange} />)
    fail(new Error('Network failed'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Network failed')
    const retry = screen.getByRole('button', { name: 'この案件の要員を探す' })
    expect(retry).toBeEnabled()
    expect(findPersonnelForCase).toHaveBeenCalledTimes(1)
    expect(onMatchingChange.mock.calls.map(([id]) => id)).toEqual(['case-a', null])
    fireEvent.click(retry)
    expect(await screen.findByText('Engineer A')).toBeVisible()
    expect(screen.getByText('Cloud AIを利用できないため、以下はローカル検索結果です。')).toBeVisible()
    expect(findPersonnelForCase).toHaveBeenCalledTimes(2)
  })
  it('keeps delayed responses bound to the original case and hides changed personnel', async () => {
    let finish!: (value: CasePersonnelMatchResult) => void
    const findPersonnelForCase = vi.fn(() => new Promise<CasePersonnelMatchResult>((resolve) => { finish = resolve }))
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: { findPersonnelForCase } })
    const view = render(<CaseMatchingWorkspace {...props} jobCaseId="case-a" request={{ id: 1, jobCaseId: 'case-a' }} />)
    view.rerender(<CaseMatchingWorkspace {...props} jobCaseId="case-b" />)
    finish(result)
    await waitFor(() => expect(screen.getByRole('button', { name: 'この案件の要員を探す' })).toBeEnabled())
    expect(screen.queryByText('Engineer A')).not.toBeInTheDocument()
    view.rerender(<CaseMatchingWorkspace {...props} jobCaseId="case-a" />)
    expect(screen.getByText('Engineer A')).toBeVisible()
    view.rerender(<CaseMatchingWorkspace {...props} jobCaseId="case-a" candidates={[{ ...person, profile: { ...person.profile!, version: 2 } }]} />)
    expect(screen.queryByText('Engineer A')).not.toBeInTheDocument()
    view.rerender(<CaseMatchingWorkspace {...props} jobCaseId="case-a" reviews={[{ ...job, jobCase: { ...job.jobCase!, version: 2 } }]} />)
    expect(screen.queryByRole('region', { name: '要員マッチング結果' })).not.toBeInTheDocument()
    expect(findPersonnelForCase).toHaveBeenCalledTimes(1)
  })
})
