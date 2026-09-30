import { expect, it, vi } from 'vitest'
import type { CasePersonAssessment, CasePersonnelMatchResult } from '@shared'
import { saveCaseSearchAssessments, summarizeCaseSearches } from './case-search-assessments'

const row = { documentId: 'person', profileVersion: 1, score: 1, matched: ['Java'], missing: [], hardFilters: [] }
const result: CasePersonnelMatchResult = {
  jobCaseId: 'case',
  jobCaseVersion: 1,
  rulesRevision: 2,
  items: [row],
  localMatchCount: 1,
  cloud: { status: 'reviewed', reviewedCount: 1, modelName: 'test' }
}
it('persists batch results with an assessment identity and preserves specified provenance', () => {
  const repo = {
    listCasePersonAssessments: vi.fn(() => [{ origin: 'specified' } as CasePersonAssessment]),
    saveCasePersonAssessment: vi.fn()
  }
  const saved = saveCaseSearchAssessments(repo, result, Date.now())
  expect(saved.items[0]?.assessmentId).toMatch(/^[a-f0-9-]{36}$/)
  expect(repo.saveCasePersonAssessment).toHaveBeenCalledWith(
    expect.objectContaining({ id: saved.items[0]?.assessmentId, origin: 'specified', result: saved.items[0], rulesRevision: 2 })
  )
})
it('does not replace a newer explicit assessment with an earlier search, but accepts a new profile version', () => {
  const previous: CasePersonAssessment = {
    id: 'explicit',
    jobCaseId: 'case',
    documentId: 'person',
    jobCaseVersion: 1,
    profileVersion: 1,
    assessedAt: new Date(2000).toISOString(),
    rulesRevision: 2,
    appliedRules: [],
    result: { ...row, matched: ['Explicit evidence'] },
    cloud: result.cloud
  }
  const repo = { listCasePersonAssessments: vi.fn(() => [previous]), saveCasePersonAssessment: vi.fn() }
  const saved = saveCaseSearchAssessments(repo, result, 1000)
  expect(saved.items[0]).toEqual({ ...previous.result, assessmentId: 'explicit' })
  expect(repo.saveCasePersonAssessment).not.toHaveBeenCalled()
  saveCaseSearchAssessments(repo, { ...result, items: [{ ...row, profileVersion: 2 }] }, 1000)
  expect(repo.saveCasePersonAssessment).toHaveBeenCalledTimes(1)
})

it('summarizes each active case with the people the panel lists, once per case across versions', () => {
  const saved = (documentId: string, origin: 'search' | 'specified', assessedAt: string, status = 'recommended') =>
    ({ documentId, origin, assessedAt, result: { ...row, documentId, qualification: { status } } }) as unknown as CasePersonAssessment
  const person = (documentId: string, displayName: string, fileName: string, recordStatus = 'active') => ({
    documentId,
    fileName,
    recordStatus,
    localIdentity: { displayName }
  })
  const listCaseAssessments = vi.fn((jobCaseId: string) =>
    jobCaseId === 'case-a2'
      ? [
          saved('listed', 'search', '2026-09-02T00:00:00.000Z'),
          // Same name and file as `listed`: a duplicate record of one person counts once.
          saved('twin', 'search', '2026-09-01T00:00:00.000Z'),
          saved('excluded', 'search', '2026-09-03T00:00:00.000Z', 'excluded'),
          saved('placed', 'search', '2026-09-01T00:00:00.000Z'),
          saved('archived', 'search', '2026-09-01T00:00:00.000Z'),
          // A specified assessment is listed even when the requirements exclude the person.
          saved('specified', 'specified', '2026-09-05T00:00:00.000Z', 'excluded')
        ]
      : jobCaseId === 'case-b'
        ? [saved('specified', 'specified', '2026-09-05T00:00:00.000Z')]
        : []
  )
  const repository = {
    listActiveJobCases: () => [
      { id: 'case-a1', sourceReviewId: 'review-a' },
      { id: 'case-a2', sourceReviewId: 'review-a' },
      { id: 'case-b', sourceReviewId: 'review-b' },
      { id: 'case-c', sourceReviewId: 'review-c' }
    ],
    listCaseAssessments,
    listCandidateReviews: () => [
      person('listed', 'Yamada Taro', 'yamada.xlsx'),
      person('twin', 'Yamada  Taro', 'yamada.xlsx'),
      person('excluded', 'Excluded', 'x.xlsx'),
      person('placed', 'Placed', 'p.xlsx'),
      person('archived', 'Archived', 'a.xlsx', 'archived'),
      person('specified', 'Specified', 's.xlsx')
    ],
    getPersonnelWorkspace: () => ({
      states: [
        { documentId: 'placed', status: 'placed' },
        { documentId: 'listed', status: 'soon' }
      ]
    })
  }
  expect(summarizeCaseSearches(repository as any)).toEqual([
    { reviewId: 'review-a', listedCount: 2, lastSearchedAt: '2026-09-03T00:00:00.000Z' },
    { reviewId: 'review-b', listedCount: 1, lastSearchedAt: null }
  ])
  expect(listCaseAssessments.mock.calls.map(([id]) => id)).toEqual(['case-a2', 'case-b', 'case-c'])
})
