import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { businessMatchingPolicyVersion } from '@shared'
import {
  createOpportunityDiscovery,
  OPPORTUNITY_DISCOVERY_INTERVAL_MS,
  OPPORTUNITY_DISCOVERY_SCHEMA,
  shouldStartOpportunityPass
} from './opportunity-discovery'
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
function fakeRepository(profiles: CandidateProfile[], jobs: ConfirmedJobCase[], cache = new Map<string, string>()) {
  const save = vi.fn()
  return {
    save,
    cache,
    repository: {
      listEligibleTalentProfiles: () => profiles,
      listActiveJobCases: () => jobs,
      listWorkRules: () => ({ revision: 0, rules: [] }),
      getLocalApplicationPreferences: () => ({ locale: 'zh-CN' }),
      getPersonnelWorkspace: () => ({ states: [] }),
      listBusinessFollowUps: () => [],
      listCustomerIdentities: () => [],
      getActiveSystemExperiences: () => [],
      getGrowthCheckpoint: (k: string) => cache.get(k),
      saveGrowthCheckpoint: (k: string, v: string) => cache.set(k, v),
      saveMatchingOpportunities: save
    }
  }
}
const field = (key: string, value: string) => ({ key, label: key, value, sourceLabels: [] })
const caseWith = (id: string, fields: ReturnType<typeof field>[]) =>
  ({ id, sourceReviewId: `review-${id}`, version: 1, fields }) as unknown as ConfirmedJobCase
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

it('stores the conclusion and keeps only unmet core requirements to confirm', async () => {
  const terms = [field('rate', '80万円'), field('location', '東京'), field('remote', '無'), field('start_date', '10月')]
  const { repository, save } = fakeRepository(
    [person('java')],
    [
      caseWith('clear', [field('required_skills', 'Java'), ...terms]),
      caseWith('language', [field('required_skills', 'Java'), field('japanese_level', 'N2以上'), ...terms])
    ]
  )
  await createOpportunityDiscovery({ repository } as never)()
  const [clear, language] = save.mock.calls.map((call) => call[1][0])
  expect(clear).toMatchObject({ status: 'recommended', confirm: [], reasons: ['Java'] })
  expect(language).toMatchObject({ status: 'needs-confirmation', confirm: ['N2以上'] })
  for (const text of ['80万円', '東京', '無', '10月']) expect(JSON.stringify([clear.confirm, language.confirm])).not.toContain(text)
})

it('processes every changed case in one pass and versions checkpoints and fingerprints by the discovery schema', async () => {
  const jobs = Array.from({ length: 7 }, (_, index) => caseWith(`c${index}`, [field('required_skills', 'Java')]))
  const { repository, save, cache } = fakeRepository([person('java')], jobs)
  await createOpportunityDiscovery({ repository } as never)()
  expect(save).toHaveBeenCalledTimes(7)
  expect(OPPORTUNITY_DISCOVERY_SCHEMA).toBe('opportunity-discovery-v2')
  // A checkpoint written by the previous schema no longer matches, so every case is regenerated once.
  const legacy = fakeRepository([person('java')], jobs, new Map([...cache.keys()].map((key) => [key, 'v1-signature'])))
  await createOpportunityDiscovery({ repository: legacy.repository } as never)()
  expect(legacy.save).toHaveBeenCalledTimes(7)
  expect(legacy.save.mock.calls[0]![1][0].fingerprint).toBe(save.mock.calls[0]![1][0].fingerprint)
  // The v1 fingerprint of the same pair: a changed fingerprint makes the store mark the row new with the new fields.
  const v1 = createHash('sha256')
    .update(JSON.stringify([businessMatchingPolicyVersion, 'java', 1, 'c0', 1, 0, ['Java'], [], undefined]))
    .digest('hex')
  expect(save.mock.calls[0]![1][0].fingerprint).not.toBe(v1)
})

it('starts a pass only when idle, not busy, and at least 15 minutes after the last completed one', () => {
  const now = 10 * OPPORTUNITY_DISCOVERY_INTERVAL_MS,
    base = { now, lastCompletedAt: null, idleSeconds: 30, busy: false, running: false }
  expect(shouldStartOpportunityPass(base)).toBe(true)
  expect(shouldStartOpportunityPass({ ...base, idleSeconds: 4 })).toBe(false)
  expect(shouldStartOpportunityPass({ ...base, busy: true })).toBe(false)
  expect(shouldStartOpportunityPass({ ...base, running: true })).toBe(false)
  expect(shouldStartOpportunityPass({ ...base, lastCompletedAt: now - OPPORTUNITY_DISCOVERY_INTERVAL_MS + 1 })).toBe(false)
  expect(shouldStartOpportunityPass({ ...base, lastCompletedAt: now - OPPORTUNITY_DISCOVERY_INTERVAL_MS })).toBe(true)
  // An aborted pass records no completion: the next idle check retries it right away.
  const lastCompletedAt = now - 2 * OPPORTUNITY_DISCOVERY_INTERVAL_MS
  expect(shouldStartOpportunityPass({ ...base, lastCompletedAt, idleSeconds: 1 })).toBe(false)
  expect(shouldStartOpportunityPass({ ...base, now: now + 60_000, lastCompletedAt })).toBe(true)
})

it('ranks again on a new day (or after a restart) but writes nothing when the result is the same', async () => {
  const job = caseWith('job', [field('required_skills', 'Java')])
  const { repository, save, cache } = fakeRepository([person('available')], [job])
  let rows: Array<{ documentId: string; fingerprint: string; state: string }> = []
  save.mockImplementation((_reviewId: string, items: Array<{ documentId: string; fingerprint: string }>) => {
    rows = items.map((item) => ({ documentId: item.documentId, fingerprint: item.fingerprint, state: 'new' }))
  })
  const saveCheckpoint = vi.fn((k: string, v: string) => cache.set(k, v))
  const withRows = { ...repository, saveGrowthCheckpoint: saveCheckpoint, listMatchingOpportunityRows: () => rows }
  await createOpportunityDiscovery({ repository: withRows } as never)()
  expect(save).toHaveBeenCalledTimes(1)
  expect(saveCheckpoint).toHaveBeenCalledTimes(1)
  // A fresh process (as after a restart, or on the next day) ranks the case again: same result, no writes.
  await createOpportunityDiscovery({ repository: withRows } as never)()
  expect(save).toHaveBeenCalledTimes(1)
  expect(saveCheckpoint).toHaveBeenCalledTimes(1)
})
