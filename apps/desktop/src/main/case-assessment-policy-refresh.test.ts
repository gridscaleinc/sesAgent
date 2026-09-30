import { expect, it, vi } from 'vitest'
import { businessMatchingPolicyVersion, type CasePersonAssessment } from '@shared'
import { refreshCaseAssessmentPolicy } from './case-assessment-policy-refresh'
it('locally refreshes obsolete policy without overwriting history or claiming cloud reevaluation', () => {
  const previous = {
    id: 'old',
    documentId: 'person',
    jobCaseId: 'case',
    profileVersion: 1,
    jobCaseVersion: 1,
    result: { qualification: { policyVersion: 'mandatory-evidence-v2', status: 'excluded', requirements: [] } },
    cloud: { status: 'reviewed' }
  } as unknown as CasePersonAssessment
  const repository = {
    listActiveJobCases: () => [
      {
        id: 'case',
        version: 1,
        fields: [
          { key: 'required_skills', value: 'Java', label: '技术' },
          { key: 'remote', value: '週3出勤', label: '出勤' }
        ]
      }
    ],
    getCandidateProfileForAssessment: () => ({
      profileVersion: 1,
      fields: [{ key: 'skills', value: 'Java', label: '技能' }],
      projectExperiences: []
    }),
    listWorkRules: () => ({ revision: 0, rules: [] }),
    saveCasePersonAssessment: vi.fn()
  }
  const refreshed = refreshCaseAssessmentPolicy(repository as never, previous, 'case')
  expect(refreshed.id).not.toBe(previous.id)
  expect(refreshed.result.qualification).toMatchObject({ policyVersion: businessMatchingPolicyVersion, status: 'recommended' })
  expect(refreshed.cloud).toMatchObject({ status: 'unavailable', reason: 'policy-refresh', reviewedCount: 0 })
  expect(refreshed.result.assessment).toBeUndefined()
  expect(previous.result.qualification?.status).toBe('excluded')
  expect(refreshCaseAssessmentPolicy(repository as never, refreshed, 'case')).toBe(refreshed)
  expect(repository.saveCasePersonAssessment).toHaveBeenCalledOnce()
})
