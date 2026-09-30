import type { AiCommerceNativeClient } from '@aicommerce'
import type { EncryptedApplicationRepository } from '@persistence'
import type { AiCommerceMembershipState, AiCommerceWalletSnapshot, GmailSyncState, TraySummary } from '@shared'
import { currentAiGatewayRejection } from './ai-gateway-signal'
import { buildTraySummary, defaultMenuBarPreferences, isProposable, trayAiQuota } from './tray-summary'

/** The panel never asks AICommerce for the wallet more often than this; results other screens fetched count too. */
export const trayWalletRefreshMs = 10 * 60_000
const privacyGateRefreshMs = 10 * 60_000

let observedWallet: { wallet: AiCommerceWalletSnapshot; at: number } | null = null

/** Remembers a wallet another screen already fetched (AI member dialog, a cloud reply), so the panel reuses it. */
export function recordAiCommerceWallet(state: Pick<AiCommerceMembershipState, 'wallet'> | null, now = Date.now()): void {
  if (state?.wallet) observedWallet = { wallet: state.wallet, at: now }
}

export function resetObservedAiCommerceWallet(): void {
  observedWallet = null
}

export interface TraySummarySourceDependencies {
  repository: Pick<
    EncryptedApplicationRepository,
    | 'getLocalApplicationPreferences'
    | 'listBusinessFollowUps'
    | 'getBusinessFeed'
    | 'listJobCaseReviews'
    | 'listMatchingOpportunities'
    | 'listActiveJobCases'
    | 'listCaseAssessments'
    | 'listPersonCaseMatchRunSummaries'
    | 'getPersonCaseMatchRun'
    | 'getPersonnelWorkspace'
    | 'getCandidateReview'
    | 'getLocalDataRevision'
  >
  aiCommerce: Pick<AiCommerceNativeClient, 'getState' | 'getDashboard'> | null
  gmailState(): Promise<Pick<GmailSyncState, 'configuration' | 'status' | 'lastError'> | null>
  privacyQualityGatePassed(): Promise<boolean>
  now?(): Date
}

/**
 * Reads the local repositories the HR screens use and builds the panel summary. Nothing here reaches the cloud
 * AI; the only network request is the AICommerce wallet, at most every ten minutes and only when the panel opens.
 */
export function createTraySummarySource(dependencies: TraySummarySourceDependencies) {
  const { repository, aiCommerce } = dependencies
  const now = () => dependencies.now?.() ?? new Date()
  let privacy: { ready: boolean; at: number } | null = null
  let walletAttemptAt = 0
  let proposable: { revision: number; pairs: Array<{ documentId: string; reviewId: string }> } | null = null

  const privacyReady = async () => {
    const at = now().getTime()
    if (!privacy || at - privacy.at >= privacyGateRefreshMs) {
      let ready = false
      try {
        ready = await dependencies.privacyQualityGatePassed()
      } catch {
        ready = false
      }
      privacy = { ready, at }
    }
    return privacy.ready
  }

  const aiState = async (refreshWallet: boolean) => {
    if (!aiCommerce) return { state: 'unconfigured' as const, availableCredits: null, reservedCredits: null, fraction: null }
    const state = await aiCommerce.getState()
    const at = now().getTime()
    const stale = !observedWallet || at - observedWallet.at >= trayWalletRefreshMs
    if (refreshWallet && state.connection === 'connected' && stale && at - walletAttemptAt >= trayWalletRefreshMs) {
      walletAttemptAt = at
      try {
        recordAiCommerceWallet(await aiCommerce.getDashboard(), at)
      } catch {
        /* The last known wallet (or 未知) stays; the next attempt waits for the interval. */
      }
    }
    return trayAiQuota(state, observedWallet?.wallet ?? null)
  }

  /** 可以提案 pairs from the stored case-side and person-side results, re-read only when local data changed. */
  const proposablePairs = () => {
    const revision = repository.getLocalDataRevision().revision
    if (proposable?.revision === revision) return proposable.pairs
    const unavailable = new Set(
      repository
        .getPersonnelWorkspace()
        .states.filter((state) => !['available', 'soon'].includes(state.status))
        .map((state) => state.documentId)
    )
    const active = new Map(repository.listActiveJobCases().map((job) => [job.id, job]))
    const pairs: Array<{ documentId: string; reviewId: string }> = []
    for (const job of active.values())
      for (const assessment of repository.listCaseAssessments(job.id))
        if (assessment.jobCaseVersion === job.version && isProposable(assessment.result.qualification))
          pairs.push({ documentId: assessment.documentId, reviewId: job.sourceReviewId })
    for (const summary of repository.listPersonCaseMatchRunSummaries()) {
      if (!summary.listedCount) continue
      for (const item of repository.getPersonCaseMatchRun(summary.documentId)?.result.items ?? [])
        if (active.get(item.jobCaseId)?.version === item.jobCaseVersion && isProposable(item.qualification))
          pairs.push({ documentId: summary.documentId, reviewId: item.reviewId })
    }
    proposable = { revision, pairs: pairs.filter((pair) => !unavailable.has(pair.documentId)) }
    return proposable.pairs
  }

  return async ({ refreshWallet = false }: { refreshWallet?: boolean } = {}): Promise<TraySummary> => {
    const preferences = repository.getLocalApplicationPreferences()
    const locale = preferences?.locale ?? 'ja-JP'
    const menuBar = preferences?.menuBar ?? defaultMenuBarPreferences
    const [ai, gmail, cloudPrivacyReady] = await Promise.all([
      aiState(refreshWallet),
      dependencies.gmailState().catch(() => null),
      privacyReady()
    ])
    return buildTraySummary(
      {
        locale,
        menuBar,
        followUps: repository.listBusinessFollowUps(),
        feed: repository.getBusinessFeed(),
        caseReviews: repository.listJobCaseReviews(),
        opportunities: repository.listMatchingOpportunities(),
        proposablePairs: proposablePairs(),
        personName: (documentId) => {
          const person = repository.getCandidateReview(documentId)
          return person?.localIdentity?.displayName ?? person?.fileName ?? null
        },
        ai,
        gmail,
        cloudPrivacyReady,
        aiRejection: currentAiGatewayRejection()
      },
      now()
    )
  }
}
