import { describe, expect, it } from 'vitest'
import { businessMatchingPolicyVersion, type CasePersonAssessment, type StoredPersonnelCaseMatchRun } from '@shared'
import { personCaseMatchSummaries, personCaseMatchView } from './person-case-overview'

const documentId = '11111111-1111-4111-8111-111111111111'
const jobs = [
  { id: 'job-a', version: 2, sourceReviewId: 'review-a', fields: [{ key: 'title', value: 'Java 案件' }] },
  { id: 'job-b', version: 1, sourceReviewId: 'review-b', fields: [{ key: 'title', value: 'Go 案件' }] }
]
const qualification = (status: 'recommended' | 'needs-confirmation' | 'excluded') => ({
  policyVersion: businessMatchingPolicyVersion,
  status,
  requirements: []
})
const assessment = (jobCaseId: string, over: Partial<CasePersonAssessment> = {}, status: 'recommended' | 'excluded' = 'recommended') =>
  ({
    id: `assessment-${jobCaseId}`,
    jobCaseId,
    documentId,
    jobCaseVersion: jobs.find((job) => job.id === jobCaseId)!.version,
    profileVersion: 3,
    assessedAt: '2026-10-02T05:00:00.000Z',
    rulesRevision: 7,
    appliedRules: [],
    result: { documentId, profileVersion: 3, score: 1, matched: [], missing: [], hardFilters: [], qualification: qualification(status) },
    cloud: { status: 'reviewed', reviewedCount: 1, modelName: null },
    ...over
  }) as CasePersonAssessment
const repositoryWith = (assessments: Record<string, CasePersonAssessment[]>, run: StoredPersonnelCaseMatchRun | null = null) =>
  ({
    listActiveJobCases: () => jobs,
    listCaseAssessments: (jobCaseId: string) => assessments[jobCaseId] ?? [],
    getCandidateProfileForAssessment: () => ({ profileVersion: 3 }),
    getPersonCaseMatchRun: () => run,
    listPersonCaseMatchRunSummaries: () => [],
    listEligibleTalentProfiles: () => [{ sourceDocumentId: documentId }],
    listWorkRules: () => ({ revision: 7, rules: [] })
  }) as never

describe('one answer per pair in the person view', () => {
  it('shows a case-page assessment on the person when they never ran 找案件, and counts it as 可提案', () => {
    const repository = repositoryWith({ 'job-a': [assessment('job-a')] })
    const view = personCaseMatchView(repository, documentId)!
    expect(view.result.items).toEqual([
      expect.objectContaining({ jobCaseId: 'job-a', reviewId: 'review-a', title: 'Java 案件', jobCaseVersion: 2 })
    ])
    // Only the assessed case counts as searched: job-b stays a new search.
    expect(view.caseSignature).toBe('job-a:2')
    expect(personCaseMatchSummaries(repository)).toEqual([expect.objectContaining({ documentId, proposableCount: 1 })])
  })

  it('lets the newer result win per case and leaves out outdated or AI-excluded case-page results', () => {
    const run: StoredPersonnelCaseMatchRun = {
      result: {
        documentId,
        profileVersion: 3,
        rulesRevision: 7,
        items: [
          {
            reviewId: 'review-a',
            jobCaseId: 'job-a',
            jobCaseVersion: 2,
            title: 'Java 案件',
            score: 0,
            matched: [],
            missing: [],
            hardFilters: [],
            qualification: qualification('needs-confirmation')
          } as never
        ],
        localMatchCount: 1,
        cloud: { status: 'reviewed', reviewedCount: 1, modelName: null }
      },
      searchedAt: '2026-10-02T04:00:00.000Z',
      caseSignature: 'job-a:2,job-b:1',
      policyVersion: businessMatchingPolicyVersion
    }
    const newer = personCaseMatchView(repositoryWith({ 'job-a': [assessment('job-a')] }, run), documentId)!
    expect(newer.result.items.map((item) => item.qualification?.status)).toEqual(['recommended'])
    const older = personCaseMatchView(
      repositoryWith({ 'job-a': [assessment('job-a', { assessedAt: '2026-10-02T03:00:00.000Z' })] }, run),
      documentId
    )!
    expect(older.result.items.map((item) => item.qualification?.status)).toEqual(['needs-confirmation'])
    for (const outdated of [
      assessment('job-b', { profileVersion: 2 }),
      assessment('job-b', { jobCaseVersion: 0 }),
      assessment('job-b', { rulesRevision: 6 }),
      assessment('job-b', {}, 'excluded')
    ])
      expect(
        personCaseMatchView(repositoryWith({ 'job-b': [outdated] }, run), documentId)!.result.items.map((item) => item.jobCaseId)
      ).toEqual(['job-a'])
  })
})
