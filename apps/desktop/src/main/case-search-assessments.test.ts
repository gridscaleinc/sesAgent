import { expect, it, vi } from 'vitest'
import type { CasePersonAssessment, CasePersonnelMatchResult } from '@shared'
import { saveCaseSearchAssessments } from './case-search-assessments'

const row = { documentId: 'person', profileVersion: 1, score: 1, matched: ['Java'], missing: [], hardFilters: [] }
const result: CasePersonnelMatchResult = { jobCaseId: 'case', jobCaseVersion: 1, rulesRevision: 2, items: [row], localMatchCount: 1, cloud: { status: 'reviewed', reviewedCount: 1, modelName: 'test' } }
it('persists batch results with an assessment identity and preserves specified provenance', () => {
  const repo = { listCasePersonAssessments: vi.fn(() => [{ origin: 'specified' } as CasePersonAssessment]), saveCasePersonAssessment: vi.fn() }
  const saved = saveCaseSearchAssessments(repo, result, Date.now())
  expect(saved.items[0]?.assessmentId).toMatch(/^[a-f0-9-]{36}$/)
  expect(repo.saveCasePersonAssessment).toHaveBeenCalledWith(expect.objectContaining({ id: saved.items[0]?.assessmentId, origin: 'specified', result: saved.items[0], rulesRevision: 2 }))
})
it('does not replace a newer explicit assessment with an earlier search, but accepts a new profile version', () => {
  const previous: CasePersonAssessment = { id: 'explicit', jobCaseId: 'case', documentId: 'person', jobCaseVersion: 1, profileVersion: 1,
    assessedAt: new Date(2000).toISOString(), rulesRevision: 2, appliedRules: [], result: { ...row, matched: ['Explicit evidence'] }, cloud: result.cloud }
  const repo = { listCasePersonAssessments: vi.fn(() => [previous]), saveCasePersonAssessment: vi.fn() }
  const saved = saveCaseSearchAssessments(repo, result, 1000)
  expect(saved.items[0]).toEqual({ ...previous.result, assessmentId: 'explicit' })
  expect(repo.saveCasePersonAssessment).not.toHaveBeenCalled()
  saveCaseSearchAssessments(repo, { ...result, items: [{ ...row, profileVersion: 2 }] }, 1000)
  expect(repo.saveCasePersonAssessment).toHaveBeenCalledTimes(1)
})
