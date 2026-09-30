import {
  businessMatchingPolicyVersion,
  businessProgressStep,
  currentBusinessObjects,
  mondayFor,
  tokyoDateKey,
  type AiCommerceMembershipState,
  type AiCommerceWalletSnapshot,
  type ApplicationLocale,
  type BusinessFeedEntry,
  type BusinessFollowUp,
  type BusinessMatchQualification,
  type GmailSyncState,
  type JobCaseReviewSnapshot,
  type MatchingOpportunity,
  type MenuBarPreferences,
  type TrayAiQuota,
  type TrayAlert,
  type TrayInterview,
  type TrayReadySummary,
  type TraySummary
} from '@shared'
import type { AiGatewayRejection } from './ai-gateway-signal'
import { caseArrivalOf, deriveNewCaseDigest } from './job-case-digest'

/** The panel shows the menu-bar icon unless turned off, and never names people unless turned on. */
export const defaultMenuBarPreferences: MenuBarPreferences = { visible: true, showPersonNames: false }

/** Available credits under which the panel warns 「AI 额度不足」; the bar is full from ten times this. */
export const trayLowCreditThreshold = 100
const trayFullCreditBar = trayLowCreditThreshold * 10

export function trayAiQuota(state: AiCommerceMembershipState, wallet: AiCommerceWalletSnapshot | null): TrayAiQuota {
  if (state.configuration !== 'ready') return { state: 'unconfigured', availableCredits: null, reservedCredits: null, fraction: null }
  if (state.connection !== 'connected') return { state: 'signed-out', availableCredits: null, reservedCredits: null, fraction: null }
  const current = state.wallet ?? wallet
  if (!current) return { state: 'unknown', availableCredits: null, reservedCredits: null, fraction: null }
  const available = Math.max(0, current.balanceCredits - current.reservedCredits)
  return {
    state: available <= 0 ? 'exhausted' : available < trayLowCreditThreshold ? 'low' : 'ok',
    availableCredits: available,
    reservedCredits: Math.max(0, current.reservedCredits),
    fraction: Math.min(1, available / trayFullCreditBar)
  }
}

export interface TraySummaryInput {
  locale: ApplicationLocale
  menuBar: MenuBarPreferences
  followUps: BusinessFollowUp[]
  feed: BusinessFeedEntry[]
  caseReviews: JobCaseReviewSnapshot[]
  opportunities: MatchingOpportunity[]
  /** Person × case pairs whose current matching conclusion is 可以提案. */
  proposablePairs: Array<{ documentId: string; reviewId: string }>
  personName(documentId: string): string | null
  ai: TrayAiQuota
  gmail: Pick<GmailSyncState, 'configuration' | 'status' | 'lastError'> | null
  /** False when the privacy quality gate keeps cloud AI closed. */
  cloudPrivacyReady: boolean
  /** The AI gateway's last refusal of a cloud call, cleared by the next accepted call. */
  aiRejection?: Pick<AiGatewayRejection, 'reason' | 'at' | 'modelName'> | null
}

/** How long a gateway refusal stays on the panel without a newer call to confirm or clear it. */
export const trayAiRejectionWindowMs = 24 * 60 * 60_000

const pair = (row: { documentId: string; reviewId: string }) => `${row.documentId}:${row.reviewId}`
const inWeek = (day: string | null | undefined, monday: string, today: string) => Boolean(day) && day! >= monday && day! <= today

/** When a follow-up reached 已推荐; follow-ups from before the stage existed carry it only in their events. */
function recommendedAt(row: BusinessFollowUp): string | null {
  return (
    row.progress?.recommendedAt ??
    row.events.find((event) => event.action === 'recommend' || event.stage === 'recommended')?.recordedAt ??
    null
  )
}

/**
 * Everything the menu-bar panel shows, from local data only. Each number reuses the rule of the screen it opens:
 * 今天要跟进 is the 跟进 「今天要做」 filter, 新案件 the 今日新案件 digest, 未读 the HR case list's 未读 chip, 新匹配机会
 * the case list's opportunity count. Days and weeks (Monday first) are Tokyo calendar days.
 */
export function buildTraySummary(input: TraySummaryInput, now: Date): TrayReadySummary {
  const today = tokyoDateKey(now)
  const monday = mondayFor(today)
  const steps = input.followUps.map((row) => ({ row, step: businessProgressStep(row, now) }))
  const caseTitle = (reviewId: string) => {
    const review = input.caseReviews.find((item) => item.reviewId === reviewId)
    return review?.fields.find((field) => field.key === 'title')?.value?.trim() || review?.redactedSubject || ''
  }
  const interviewsToday = steps
    .filter(({ step }) => !['closed', 'paused'].includes(step.stage))
    .flatMap(({ row }) =>
      (row.progress?.rounds ?? [])
        .filter((round) => round.scheduledAt && tokyoDateKey(round.scheduledAt) === today)
        .map((round) => ({ row, round }))
    )
    .sort((a, b) => a.round.scheduledAt!.localeCompare(b.round.scheduledAt!))
  const upcoming = interviewsToday.find(({ round }) => Date.parse(round.scheduledAt!) + round.durationMinutes * 60_000 > now.getTime())
  const next: TrayInterview | null = upcoming
    ? {
        at: upcoming.round.scheduledAt!,
        roundNumber: upcoming.round.roundNumber,
        caseTitle: caseTitle(upcoming.row.reviewId),
        personName: input.menuBar.showPersonNames ? input.personName(upcoming.row.documentId) : null
      }
    : null
  const cases = currentBusinessObjects(input.feed).filter((entry) => entry.kind === 'case' && !entry.archived)
  const followed = new Set(input.followUps.map(pair))
  const proposable = new Set(input.proposablePairs.map(pair).filter((key) => !followed.has(key)))
  const rejection =
    input.aiRejection && now.getTime() - Date.parse(input.aiRejection.at) < trayAiRejectionWindowMs ? input.aiRejection : null
  const creditsRejected = rejection?.reason === 'insufficient-credits' && ['ok', 'low', 'unknown'].includes(input.ai.state)
  const alerts: TrayAlert[] = []
  if (input.ai.state === 'exhausted') alerts.push('ai-credits-exhausted')
  // A refusal says more than 「额度不足」: the balance may look fine yet not cover the selected model's reservation.
  if (creditsRejected) alerts.push('ai-request-rejected')
  else if (input.ai.state === 'low') alerts.push('ai-credits-low')
  // The membership state can still read 已连接 after the gateway stopped taking the session.
  if (input.ai.state === 'signed-out' || (rejection?.reason === 'sign-in-required' && input.ai.state !== 'unconfigured'))
    alerts.push('ai-signed-out')
  if (input.gmail?.configuration === 'ready' && (input.gmail.status === 'error' || Boolean(input.gmail.lastError)))
    alerts.push('gmail-sync-failed')
  if (!input.cloudPrivacyReady && input.ai.state !== 'unconfigured') alerts.push('privacy-gate-blocked')
  return {
    status: 'ready',
    locale: input.locale,
    generatedAt: now.toISOString(),
    today,
    showPersonNames: input.menuBar.showPersonNames,
    followUpsDueToday: steps.filter(({ step }) => step.due).length,
    cases: {
      newToday: deriveNewCaseDigest({ reviews: input.caseReviews, seenReviewIds: [], now }).newCasesToday,
      unseen: cases.filter((entry) => entry.unseen).length
    },
    matching: {
      newOpportunities: input.opportunities.filter((row) => row.state === 'new').length,
      proposable: proposable.size
    },
    interviews: {
      coordinating: steps.filter(({ step }) => step.stage === 'coordinating').length,
      today: interviewsToday.length,
      next
    },
    ai: input.ai,
    ...(creditsRejected && rejection ? { aiRejectedModel: rejection.modelName } : {}),
    alerts,
    week: {
      casesCreated: input.caseReviews.filter((review) => inWeek(tokyoDateKey(caseArrivalOf(review)), monday, today)).length,
      recommended: input.followUps.filter((row) => {
        const at = recommendedAt(row)
        return at ? inWeek(tokyoDateKey(at), monday, today) : false
      }).length,
      started: steps.filter(({ row, step }) => step.stage === 'started' && inWeek(row.progress?.entry.actualDate, monday, today)).length
    }
  }
}

/** A matching conclusion that still counts: made under the current policy and recommending the proposal. */
export const isProposable = (qualification: BusinessMatchQualification | undefined) =>
  qualification?.policyVersion === businessMatchingPolicyVersion && qualification.status === 'recommended'

/** The badge is the 今天要跟进 count: the menu-bar title on macOS, the tooltip on Windows (tray icons have no title). */
export function trayBadge(summary: TraySummary | null, locale: ApplicationLocale): { title: string; tooltip: string } {
  const count = summary?.status === 'ready' ? summary.followUpsDueToday : 0
  const zh = locale === 'zh-CN'
  return {
    title: count > 0 ? String(count) : '',
    tooltip: count > 0 ? `SES Agent · ${zh ? `${count} 件今天要跟进` : `今日の対応 ${count} 件`}` : 'SES Agent'
  }
}
