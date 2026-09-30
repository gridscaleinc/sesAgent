// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { businessMatchingPolicyVersion } from '@shared'
import { createTraySummarySource, recordAiCommerceWallet, resetObservedAiCommerceWallet, trayWalletRefreshMs } from './tray-data'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const recommended = { policyVersion: businessMatchingPolicyVersion, status: 'recommended', requirements: [] }

function setup(options: { connection?: string; revision?: () => number } = {}) {
  let clock = new Date('2026-10-01T01:00:00Z').getTime()
  const repository = {
    getLocalApplicationPreferences: vi.fn(() => ({ locale: 'zh-CN', menuBar: { visible: true, showPersonNames: false } })),
    listBusinessFollowUps: vi.fn(() => [{ documentId: uuid(3), reviewId: uuid(53), status: 'new', events: [] }]),
    getBusinessFeed: vi.fn(() => []),
    listJobCaseReviews: vi.fn(() => []),
    listMatchingOpportunities: vi.fn(() => []),
    listActiveJobCases: vi.fn(() => [
      { id: uuid(71), sourceReviewId: uuid(51), version: 2 },
      { id: uuid(72), sourceReviewId: uuid(52), version: 1 }
    ]),
    listCaseAssessments: vi.fn((jobCaseId: string) =>
      jobCaseId === uuid(71)
        ? [
            { documentId: uuid(1), jobCaseVersion: 2, result: { qualification: recommended } },
            { documentId: uuid(2), jobCaseVersion: 1, result: { qualification: recommended } }, // older case version
            { documentId: uuid(4), jobCaseVersion: 2, result: { qualification: recommended } } // person not available
          ]
        : []
    ),
    listPersonCaseMatchRunSummaries: vi.fn(() => [{ documentId: uuid(3), listedCount: 1 }]),
    getPersonCaseMatchRun: vi.fn(() => ({
      result: { items: [{ jobCaseId: uuid(72), jobCaseVersion: 1, reviewId: uuid(52), qualification: recommended }] }
    })),
    getPersonnelWorkspace: vi.fn(() => ({ states: [{ documentId: uuid(4), status: 'assigned' }] })),
    getCandidateReview: vi.fn(() => null),
    getLocalDataRevision: vi.fn(() => ({ revision: options.revision?.() ?? 7, updatedAt: null }))
  }
  const aiCommerce = {
    getState: vi.fn(async () => ({ configuration: 'ready', connection: options.connection ?? 'connected', wallet: null })),
    getDashboard: vi.fn(async () => ({
      configuration: 'ready',
      connection: 'connected',
      wallet: { balanceCredits: 400, reservedCredits: 0 }
    }))
  }
  const privacyQualityGatePassed = vi.fn(async () => true)
  const load = createTraySummarySource({
    repository: repository as never,
    aiCommerce: aiCommerce as never,
    gmailState: async () => null,
    privacyQualityGatePassed,
    now: () => new Date(clock)
  })
  return { load, repository, aiCommerce, privacyQualityGatePassed, advance: (ms: number) => (clock += ms) }
}

afterEach(() => resetObservedAiCommerceWallet())

describe('createTraySummarySource', () => {
  it('reads the wallet only when the panel opens, at most every ten minutes', async () => {
    const { load, aiCommerce, advance } = setup()
    expect(await load()).toMatchObject({ status: 'ready', ai: { state: 'unknown' } })
    expect(aiCommerce.getDashboard).not.toHaveBeenCalled()
    expect(await load({ refreshWallet: true })).toMatchObject({ ai: { state: 'ok', availableCredits: 400 } })
    await load({ refreshWallet: true })
    advance(trayWalletRefreshMs - 1)
    await load({ refreshWallet: true })
    expect(aiCommerce.getDashboard).toHaveBeenCalledTimes(1)
    advance(1)
    await load({ refreshWallet: true })
    expect(aiCommerce.getDashboard).toHaveBeenCalledTimes(2)
  })

  it('reuses a wallet another screen fetched and never asks while signed out', async () => {
    recordAiCommerceWallet({ wallet: { balanceCredits: 30, reservedCredits: 0 } }, new Date('2026-10-01T00:59:00Z').getTime())
    const connected = setup()
    expect(await connected.load({ refreshWallet: true })).toMatchObject({
      ai: { state: 'low', availableCredits: 30 },
      alerts: ['ai-credits-low']
    })
    expect(connected.aiCommerce.getDashboard).not.toHaveBeenCalled()
    const signedOut = setup({ connection: 'not-connected' })
    expect(await signedOut.load({ refreshWallet: true })).toMatchObject({ ai: { state: 'signed-out' }, alerts: ['ai-signed-out'] })
    expect(signedOut.aiCommerce.getDashboard).not.toHaveBeenCalled()
  })

  it('keeps the last wallet when AICommerce fails and waits for the interval before retrying', async () => {
    const { load, aiCommerce, advance } = setup()
    aiCommerce.getDashboard.mockRejectedValueOnce(new Error('offline'))
    expect(await load({ refreshWallet: true })).toMatchObject({ ai: { state: 'unknown' } })
    await load({ refreshWallet: true })
    expect(aiCommerce.getDashboard).toHaveBeenCalledTimes(1)
    advance(trayWalletRefreshMs)
    expect(await load({ refreshWallet: true })).toMatchObject({ ai: { state: 'ok' } })
  })

  it('counts 可以提案 from current case-side and person-side results, re-reading them only after local data changed', async () => {
    let revision = 7
    const { load, repository } = setup({ revision: () => revision })
    // uuid(1)×case 51 from the case side, uuid(3)×case 52 from the person side; the others are stale or unavailable.
    expect(await load()).toMatchObject({ matching: { proposable: 2 } })
    await load()
    expect(repository.listCaseAssessments).toHaveBeenCalledTimes(2)
    revision = 8
    await load()
    expect(repository.listCaseAssessments).toHaveBeenCalledTimes(4)
  })

  it('checks the privacy gate at most every ten minutes and treats a failing check as closed', async () => {
    const { load, privacyQualityGatePassed, advance } = setup()
    privacyQualityGatePassed.mockRejectedValueOnce(new Error('missing report'))
    expect(await load()).toMatchObject({ alerts: ['privacy-gate-blocked'] })
    await load()
    expect(privacyQualityGatePassed).toHaveBeenCalledTimes(1)
    advance(10 * 60_000)
    expect(await load()).toMatchObject({ alerts: [] })
  })
})
