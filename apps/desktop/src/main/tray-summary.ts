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
  type CandidateInterviewSnapshot,
  type GmailSyncState,
  type JobCaseReviewSnapshot,
  type MatchingOpportunity,
  type MenuBarPreferences,
  type TodayCaseItem,
  type TodayFollowUpItem,
  type TodayInterviewItem,
  type TodayOpportunityItem,
  type TodayReadySummary,
  type TrayAiQuota,
  type TrayAlert,
  type TrayInterview,
  type TrayReadySummary,
  type TraySummary,
  todayListLimits
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
  /** Every follow-up: weekly counts and 「already followed」 read all of them. */
  followUps: BusinessFollowUp[]
  /** Interviews outside any follow-up (招聘面试): they count among today's interviews too. */
  candidateInterviews?: CandidateInterviewSnapshot[]
  /** A follow-up that cannot move now (followUpBlock): left out of what is due, 待约面 and today's interviews. */
  blocked?(row: BusinessFollowUp): boolean
  feed: BusinessFeedEntry[]
  caseReviews: JobCaseReviewSnapshot[]
  opportunities: MatchingOpportunity[]
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

const caseTitleOf = (reviews: JobCaseReviewSnapshot[], reviewId: string) => {
  const review = reviews.find((item) => item.reviewId === reviewId)
  return review?.fields.find((field) => field.key === 'title')?.value?.trim() || review?.redactedSubject || ''
}

interface DayInterview {
  at: string
  durationMinutes: number
  roundNumber: number
  documentId: string
  /** Null for a 招聘面试, which belongs to no follow-up or case. */
  followUpId: string | null
  reviewId: string | null
  /** A result is already recorded: it took place, and is not 「下一场」. */
  decided: boolean
}

/**
 * The interviews on a Tokyo day, earliest first, by one rule for client and recruiting interviews: a round booked for
 * that day counts when it took place (a result is recorded) or is still held (not released by its follow-up ending,
 * pausing or going back to 待约面). Placement records (已进场 / 已退场) are history, not interviews. A follow-up that
 * cannot move now (ended case, 暂停营业) still has its booked interview on the day: that is not left out.
 */
function interviewsOn(
  steps: Array<{ row: BusinessFollowUp; step: ReturnType<typeof businessProgressStep> }>,
  recruiting: CandidateInterviewSnapshot[],
  day: string
): DayInterview[] {
  const followed = steps
    .filter(({ row }) => !['started', 'ended'].includes(row.progress?.stage ?? ''))
    .flatMap(({ row, step }) =>
      (row.progress?.rounds ?? [])
        .filter(
          (round) =>
            round.scheduledAt &&
            tokyoDateKey(round.scheduledAt) === day &&
            (Boolean(round.decision) || !['closed', 'paused', 'coordinating'].includes(step.stage))
        )
        .map((round) => ({
          at: round.scheduledAt!,
          durationMinutes: round.durationMinutes,
          roundNumber: round.roundNumber,
          documentId: row.documentId,
          followUpId: row.id,
          reviewId: row.reviewId,
          decided: Boolean(round.decision)
        }))
    )
  const own = recruiting
    .filter(
      (interview) =>
        interview.kind === 'recruiting' &&
        !interview.businessFollowUpId &&
        interview.scheduledAt &&
        tokyoDateKey(interview.scheduledAt) === day &&
        (Boolean(interview.decision) || interview.stage !== 'closed')
    )
    .map((interview) => ({
      at: interview.scheduledAt!,
      durationMinutes: interview.durationMinutes,
      roundNumber: interview.roundNumber,
      documentId: interview.sourceDocumentId,
      followUpId: null,
      reviewId: null,
      decided: Boolean(interview.decision)
    }))
  return [...followed, ...own].sort((a, b) => a.at.localeCompare(b.at))
}

/** What stands in for the case title of a 招聘面试. */
const recruitingTitle = (locale: ApplicationLocale) => (locale === 'zh-CN' ? '招聘面试' : '採用面談')

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
  const movable = steps.filter(({ row }) => !input.blocked?.(row))
  const caseTitle = (reviewId: string) => caseTitleOf(input.caseReviews, reviewId)
  const interviewsToday = interviewsOn(steps, input.candidateInterviews ?? [], today)
  const upcoming = interviewsToday.find((item) => !item.decided && Date.parse(item.at) + item.durationMinutes * 60_000 > now.getTime())
  const next: TrayInterview | null = upcoming
    ? {
        kind: upcoming.followUpId ? 'client' : 'recruiting',
        at: upcoming.at,
        roundNumber: upcoming.roundNumber,
        caseTitle: upcoming.reviewId ? caseTitle(upcoming.reviewId) : recruitingTitle(input.locale),
        personName: input.menuBar.showPersonNames ? input.personName(upcoming.documentId) : null
      }
    : null
  const cases = currentBusinessObjects(input.feed).filter((entry) => entry.kind === 'case' && !entry.archived)
  const followed = new Set(input.followUps.map(pair))
  // 可以提案 counts exactly the 可以提案 group of 新匹配机会, so the number and the page it opens agree.
  const proposable = new Set(
    input.opportunities
      .filter((row) => row.status === 'recommended' && row.state !== 'dismissed')
      .map(pair)
      .filter((key) => !followed.has(key))
  )
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
    followUpsDueToday: movable.filter(({ step }) => step.due).length,
    cases: {
      newToday: deriveNewCaseDigest({ reviews: input.caseReviews, seenReviewIds: [], now }).newCasesToday,
      unseen: cases.filter((entry) => entry.unseen).length
    },
    matching: {
      // A pair HR judged 不满足 is not a new opportunity.
      newOpportunities: input.opportunities.filter((row) => row.state === 'new' && row.status !== 'not-suitable').length,
      proposable: proposable.size
    },
    interviews: {
      coordinating: movable.filter(({ step }) => step.stage === 'coordinating').length,
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
      // Started this week, including someone who has already left again.
      started: steps.filter(
        ({ row, step }) => (step.stage === 'started' || step.stage === 'ended') && inWeek(row.progress?.entry.actualDate, monday, today)
      ).length
    }
  }
}

/**
 * The main window's 「今天」 page: the same numbers as the panel (names always shown — the panel's name setting only
 * concerns the menu bar) plus bounded lists behind them. Each list follows the rule of its number: follow-ups are
 * 「今天要做」, interviews the rounds scheduled today, opportunities the new ones, cases the unread ones.
 */
export function buildTodaySummary(input: TraySummaryInput, now: Date): TodayReadySummary {
  const summary = buildTraySummary({ ...input, menuBar: { ...input.menuBar, showPersonNames: true } }, now)
  const zh = input.locale === 'zh-CN'
  const steps = input.followUps.filter((row) => !input.blocked?.(row)).map((row) => ({ row, step: businessProgressStep(row, now, zh) }))
  const followUps = steps
    .filter(({ step }) => step.due)
    // Timed steps first, by their time; the rest most recently updated first.
    .sort((a, b) =>
      a.step.when && b.step.when
        ? a.step.when.localeCompare(b.step.when)
        : a.step.when
          ? -1
          : b.step.when
            ? 1
            : b.row.updatedAt.localeCompare(a.row.updatedAt)
    )
    .slice(0, todayListLimits.followUps)
    .map(({ row, step }): TodayFollowUpItem => ({
      id: row.id,
      documentId: row.documentId,
      reviewId: row.reviewId,
      personName: input.personName(row.documentId),
      caseTitle: caseTitleOf(input.caseReviews, row.reviewId),
      stage: step.stage,
      stageLabel: step.label,
      action: step.action,
      when: step.when
    }))
  // Every interview held today, as the number counts them: a booked one of a blocked follow-up still takes place.
  const allSteps = input.followUps.map((row) => ({ row, step: businessProgressStep(row, now, zh) }))
  const interviews = interviewsOn(allSteps, input.candidateInterviews ?? [], summary.today)
    .slice(0, todayListLimits.interviews)
    .map((item): TodayInterviewItem => ({
      kind: item.followUpId ? 'client' : 'recruiting',
      followUpId: item.followUpId,
      documentId: item.documentId,
      reviewId: item.reviewId,
      at: item.at,
      durationMinutes: item.durationMinutes,
      roundNumber: item.roundNumber,
      caseTitle: item.reviewId ? caseTitleOf(input.caseReviews, item.reviewId) : recruitingTitle(input.locale),
      personName: input.personName(item.documentId)
    }))
  // As 可以提案 is counted: a pair already followed is no longer an opportunity to look at.
  const followedPairs = new Set(input.followUps.map(pair))
  const fresh = input.opportunities
    .filter((row) => row.state === 'new' && !followedPairs.has(pair(row)))
    .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt))
  const opportunity = (row: MatchingOpportunity): TodayOpportunityItem => ({
    id: row.id,
    documentId: row.documentId,
    reviewId: row.reviewId,
    jobCaseId: row.jobCaseId,
    personName: row.personName,
    caseTitle: row.caseTitle,
    score: row.score,
    confirm: row.confirm
  })
  const unseenCases = currentBusinessObjects(input.feed)
    .filter((entry) => entry.kind === 'case' && !entry.archived && entry.unseen)
    .sort((a, b) => b.sourceAt.localeCompare(a.sourceAt))
    .slice(0, todayListLimits.cases)
    .map((entry): TodayCaseItem => ({ reviewId: entry.objectId, title: entry.title, sourceAt: entry.sourceAt }))
  return {
    ...summary,
    lists: {
      followUps,
      interviews,
      opportunities: {
        proposable: fresh
          .filter((row) => row.status === 'recommended')
          .slice(0, todayListLimits.opportunities)
          .map(opportunity),
        needsInfo: fresh
          .filter((row) => row.status === 'needs-confirmation')
          .slice(0, todayListLimits.opportunities)
          .map(opportunity)
      },
      unseenCases
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
