import type { AiCommerceNativeClient } from '@aicommerce'
import type { EncryptedApplicationRepository } from '@persistence'
import { followUpBlock, isInactiveProgressStage } from '@shared'
import { rejectedByHr } from './work-rule-matching'
import type { AiCommerceMembershipState, AiCommerceWalletSnapshot, GmailSyncState, TodaySummary, TraySummary } from '@shared'
import { currentAiGatewayRejection } from './ai-gateway-signal'
import { buildTodaySummary, buildTraySummary, defaultMenuBarPreferences, trayAiQuota, type TraySummaryInput } from './tray-summary'

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
    | 'listCandidateInterviews'
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
    | 'listWorkRules'
    | 'getCandidateProfileForAssessment'
    | 'listRequirementConfirmations'
  >
  aiCommerce: Pick<AiCommerceNativeClient, 'getState' | 'getDashboard'> | null
  gmailState(): Promise<Pick<GmailSyncState, 'configuration' | 'status' | 'lastError'> | null>
  privacyQualityGatePassed(): Promise<boolean>
  now?(): Date
}

/** The menu-bar panel's summary; see createSummarySources. */
export function createTraySummarySource(dependencies: TraySummarySourceDependencies) {
  return createSummarySources(dependencies).tray
}

/**
 * Reads the local repositories the HR screens use and builds the panel summary and the main window's 「今天」
 * summary, sharing one set of caches. Nothing here reaches the cloud AI; the only network request is the
 * AICommerce wallet, at most every ten minutes and only when the panel or the 「今天」 page asks for it.
 */
export function createSummarySources(dependencies: TraySummarySourceDependencies) {
  const { repository, aiCommerce } = dependencies
  const now = () => dependencies.now?.() ?? new Date()
  let privacy: { ready: boolean; at: number } | null = null
  let walletAttemptAt = 0

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

  /**
   * Which follow-ups cannot move now (see followUpBlock): nothing is due for a person not being offered or an ended case.
   * The summary still reads every follow-up for weekly counts and pairs already followed.
   */
  const blockedFollowUps = () => {
    const status = new Map(repository.getPersonnelWorkspace().states.map((state) => [state.documentId, state.status]))
    const lifecycle = new Map(repository.listJobCaseReviews().map((review) => [review.reviewId, review.lifecycle]))
    return (row: import('@shared').BusinessFollowUp) =>
      Boolean(
        followUpBlock(row, {
          personStatus: status.get(row.documentId),
          caseLifecycle: lifecycle.get(row.reviewId),
          // Asked only for follow-ups still under way (the others are not blocked anyway).
          hrRejected:
            Boolean(row.progress) &&
            !isInactiveProgressStage(row.progress!.stage) &&
            rejectedByHr(repository, row.documentId, row.reviewId)
        })
      )
  }

  const collect = async (refreshWallet: boolean): Promise<TraySummaryInput> => {
    const preferences = repository.getLocalApplicationPreferences()
    const locale = preferences?.locale ?? 'ja-JP'
    const menuBar = preferences?.menuBar ?? defaultMenuBarPreferences
    const [ai, gmail, cloudPrivacyReady] = await Promise.all([
      aiState(refreshWallet),
      dependencies.gmailState().catch(() => null),
      privacyReady()
    ])
    return {
      locale,
      menuBar,
      followUps: repository.listBusinessFollowUps(),
      candidateInterviews: repository.listCandidateInterviews?.() ?? [],
      blocked: blockedFollowUps(),
      feed: repository.getBusinessFeed(),
      caseReviews: repository.listJobCaseReviews(),
      opportunities: repository.listMatchingOpportunities(),
      personName: (documentId) => {
        const person = repository.getCandidateReview(documentId)
        return person?.localIdentity?.displayName ?? person?.fileName ?? null
      },
      ai,
      gmail,
      cloudPrivacyReady,
      aiRejection: currentAiGatewayRejection()
    }
  }

  return {
    /** Names only when the operator turned them on for the menu bar. */
    tray: async ({ refreshWallet = false }: { refreshWallet?: boolean } = {}): Promise<TraySummary> =>
      buildTraySummary(await collect(refreshWallet), now()),
    /** The main window always shows names: it is the full app, not a panel over other people's screens. */
    today: async ({ refreshWallet = false }: { refreshWallet?: boolean } = {}): Promise<TodaySummary> =>
      buildTodaySummary(await collect(refreshWallet), now())
  }
}
