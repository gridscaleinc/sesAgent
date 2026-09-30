import { expect, it, vi } from 'vitest'
import { createOpportunityDiscovery } from './opportunity-discovery'
import type { CandidateProfile } from '@resume'
import type { ConfirmedJobCase } from '@job-cases'
const person = (id: string) =>
  ({
    id,
    sourceDocumentId: id,
    profileVersion: 1,
    fields: [{ key: 'skills', label: '技术', value: 'Java', sourceLabels: [] }],
    projectExperiences: [],
    localPersonalDetails: { displayName: id }
  }) as unknown as CandidateProfile
it('discovers locally, skips unchanged sources, excludes unavailable and followed pairs, and reevaluates changes', async () => {
  const profiles = [person('available'), person('assigned'), person('following')]
  const job = {
    id: 'job',
    sourceReviewId: 'review',
    version: 1,
    fields: [{ key: 'required_skills', label: '必須', value: 'Java', sourceLabels: [] }]
  } as unknown as ConfirmedJobCase
  const cache = new Map<string, string>(),
    save = vi.fn(),
    repository = {
      listEligibleTalentProfiles: () => profiles,
      listActiveJobCases: () => [job],
      listWorkRules: () => ({ revision: 0, rules: [] }),
      getLocalApplicationPreferences: () => ({ locale: 'zh-CN' }),
      getPersonnelWorkspace: () => ({ states: [{ documentId: 'assigned', status: 'assigned' }] }),
      listBusinessFollowUps: () => [{ documentId: 'following', reviewId: 'review', status: 'in-progress' }],
      listCustomerIdentities: () => [],
      getActiveSystemExperiences: () => [],
      getGrowthCheckpoint: (k: string) => cache.get(k),
      saveGrowthCheckpoint: (k: string, v: string) => cache.set(k, v),
      saveMatchingOpportunities: save
    }
  const discover = createOpportunityDiscovery({ repository } as never)
  await discover()
  expect(save).toHaveBeenCalledTimes(1)
  expect(save.mock.calls[0]![1].map((i: any) => i.documentId)).toEqual(['available'])
  await discover()
  expect(save).toHaveBeenCalledTimes(1)
  job.version = 2
  await discover()
  expect(save).toHaveBeenCalledTimes(2)
  expect(save.mock.calls[1]![1][0].jobCaseVersion).toBe(2)
  const abort = new AbortController()
  abort.abort()
  await expect(discover(abort.signal)).rejects.toThrow()
})
