// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { candidateProfileSchema, searchConfirmedCandidateProfiles, scorableCandidateSearchTerms, type CandidateProfile } from './index'
import { candidateBenchmarkQueryFromJobCase, type ConfirmedJobCase } from '@job-cases'
const profile = (id: string, isOwnCompany?: boolean | null) => ({ schemaVersion: 'candidate-profile-v1', id, sourceDocumentId: id, profileVersion: 1,
  reviewRevision: 1, confirmedAt: '2026-09-08T00:00:00.000Z', confirmedBy: 'HR', containsDirectIdentifiers: false,
  fields: [{ key: 'skills', label: '技能', value: 'Java SQL', sourceLabels: [] }], projectExperiences: [], isOwnCompany }) as unknown as CandidateProfile
const profiles = [profile('11111111-1111-4111-8111-111111111111', true), profile('22222222-2222-4222-8222-222222222222', false), profile('33333333-3333-4333-8333-333333333333', null), profile('44444444-4444-4444-8444-444444444444')]
describe('own-company local filter', () => {
  it('excludes false and unset affiliation before scoring while keeping unrestricted searches unchanged', () => {
    expect(searchConfirmedCandidateProfiles(profiles, 'Java SQL')).toHaveLength(4)
    const result = searchConfirmedCandidateProfiles(profiles, 'Java 自社限定')
    expect(result.map((item) => item.sourceDocumentId)).toEqual([profiles[0]!.id])
    expect(result[0]?.retrieval.hardFilters).toContainEqual({ type: 'own-company', requested: '自社限定', actual: '自社', outcome: 'passed' })
    expect(searchConfirmedCandidateProfiles(profiles.slice(1), 'Java 自社限定', 10, undefined, undefined, true)).toEqual([])
    expect(scorableCandidateSearchTerms('Java 自社限定')).toEqual(['Java'])
  })
  it('defaults historical profiles to null and refuses non-boolean affiliation', () => {
    expect(candidateProfileSchema.parse(profiles[3]).isOwnCompany).toBeNull()
    expect(candidateProfileSchema.safeParse({ ...profiles[0], isOwnCompany: '自社' }).success).toBe(false)
  })
  it('carries case contract-chain restrictions into both local matching directions without treating preferences as required', () => {
    const job = { fields: [{ key: 'required_skills', value: 'Java' }, { key: 'contract_chain', value: '貴社社員のみ' }] } as unknown as ConfirmedJobCase
    const query = candidateBenchmarkQueryFromJobCase(job)
    expect(query).toContain('自社限定')
    expect(searchConfirmedCandidateProfiles(profiles, query)).toHaveLength(1)
    expect(candidateBenchmarkQueryFromJobCase({ ...job, fields: [{ key: 'preferred_skills', label: '尚可', value: '自社社員', sourceLabels: [] }] })).not.toContain('自社限定')
  })
})
