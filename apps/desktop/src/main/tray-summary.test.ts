// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  businessMatchingPolicyVersion,
  type AiCommerceMembershipState,
  type BusinessFeedEntry,
  type BusinessFollowUp,
  type JobCaseReviewSnapshot,
  type MatchingOpportunity
} from '@shared'
import { buildTraySummary, isProposable, trayAiQuota, trayBadge, type TraySummaryInput } from './tray-summary'

// Thursday 2026-10-01 10:00 in Tokyo (01:00 UTC). The Tokyo day starts at 2026-09-30T15:00Z, the week on
// Monday 2026-09-28, i.e. 2026-09-27T15:00Z.
const now = new Date('2026-10-01T01:00:00Z')
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function followUp(n: number, progress?: Partial<NonNullable<BusinessFollowUp['progress']>>, extra: Partial<BusinessFollowUp> = {}) {
  return {
    id: uuid(100 + n),
    documentId: uuid(n),
    reviewId: uuid(50 + n),
    status: 'interview',
    note: '',
    nextStep: '',
    revision: 1,
    updatedAt: now.toISOString(),
    recordedBy: 'HR',
    events: [],
    ...(progress
      ? {
          progress: {
            stage: 'coordinating',
            candidateAvailability: '',
            clientAvailability: '',
            pendingConditions: [],
            entry: { plannedDate: '', actualDate: null },
            rounds: [],
            ...progress
          }
        }
      : {}),
    ...extra
  } as unknown as BusinessFollowUp
}

const round = (roundNumber: number, scheduledAt: string, durationMinutes = 60) =>
  ({ roundNumber, scheduledAt, durationMinutes, decision: null, stage: 'scheduled' }) as never

function review(n: number, intakeAt: string, title = `案件${n}`, lifecycle: 'active' | 'archived' = 'active') {
  return {
    reviewId: uuid(50 + n),
    fields: [{ key: 'title', value: title }],
    redactedSubject: `subject ${n}`,
    lifecycle,
    intakeAt,
    messageDate: intakeAt,
    status: 'completed',
    warningCodes: [],
    sourceType: 'gmail',
    jobCase: { id: uuid(70 + n), status: 'active' }
  } as unknown as JobCaseReviewSnapshot
}

const feedEntry = (n: number, kind: 'case' | 'person', unseen: boolean, archived = false) =>
  ({ kind, objectId: uuid(50 + n), occurredAt: now.toISOString(), unseen, archived }) as unknown as BusinessFeedEntry

const opportunity = (n: number, state: MatchingOpportunity['state']) => ({ id: uuid(200 + n), state }) as unknown as MatchingOpportunity

function input(overrides: Partial<TraySummaryInput> = {}): TraySummaryInput {
  return {
    locale: 'zh-CN',
    menuBar: { visible: true, showPersonNames: false },
    followUps: [],
    feed: [],
    caseReviews: [],
    opportunities: [],
    proposablePairs: [],
    personName: () => '山田 太郎',
    ai: { state: 'ok', availableCredits: 500, reservedCredits: 0, fraction: 0.5 },
    gmail: null,
    cloudPrivacyReady: true,
    ...overrides
  }
}

describe('buildTraySummary', () => {
  it('counts today and this week on Tokyo calendar days, whatever the UTC date', () => {
    const summary = buildTraySummary(
      input({
        caseReviews: [
          review(1, '2026-09-30T15:00:00Z'), // Tokyo 10/1 00:00 — today
          review(2, '2026-09-30T14:59:59Z'), // Tokyo 9/30 23:59 — this week, not today
          review(3, '2026-09-27T15:00:00Z'), // Tokyo Monday 00:00 — this week
          review(4, '2026-09-27T14:59:59Z') // Tokyo Sunday 23:59 — last week
        ],
        followUps: [
          followUp(1, { stage: 'recommended', recommendedAt: '2026-09-27T15:00:00Z' }),
          followUp(2, { stage: 'recommended', recommendedAt: '2026-09-27T14:00:00Z' }),
          // Recorded before recommendedAt existed: the recommend event counts.
          followUp(3, undefined, {
            events: [{ action: 'recommend', status: 'new', note: '', nextStep: '', recordedAt: '2026-09-29T02:00:00Z', recordedBy: 'HR' }]
          } as never),
          followUp(4, { stage: 'started', entry: { plannedDate: '', actualDate: '2026-09-28' } as never }),
          followUp(5, { stage: 'started', entry: { plannedDate: '', actualDate: '2026-09-27' } as never })
        ]
      }),
      now
    )
    expect(summary.today).toBe('2026-10-01')
    expect(summary.cases.newToday).toBe(1)
    expect(summary.week).toEqual({ casesCreated: 3, recommended: 2, started: 1 })
  })

  it('uses the 跟进 「今天要做」 rule for the headline and counts 待约面, today’s interviews and the next one', () => {
    const summary = buildTraySummary(
      input({
        caseReviews: [review(1, '2026-09-01T00:00:00Z', 'EC決済基盤の刷新')],
        followUps: [
          followUp(1, { stage: 'scheduled', rounds: [round(1, '2026-10-01T05:00:00Z')] }), // 14:00 today: next, due within 24h
          followUp(2, { stage: 'scheduled', rounds: [round(2, '2026-10-01T00:00:00Z', 30)] }), // 09:00 today, over: 待反馈
          followUp(3, { stage: 'scheduled', rounds: [round(1, '2026-09-30T14:30:00Z')] }), // yesterday 23:30
          followUp(4), // no progress yet: 待约面
          followUp(5, { stage: 'recommended' }),
          followUp(6, { stage: 'closed', rounds: [round(1, '2026-10-01T06:00:00Z')] })
        ]
      }),
      now
    )
    // 1 (scheduled within 24h) + 2 (feedback) + 3 (feedback) + 4 (coordinating)
    expect(summary.followUpsDueToday).toBe(4)
    expect(summary.interviews).toEqual({
      coordinating: 1,
      today: 2,
      next: { at: '2026-10-01T05:00:00Z', roundNumber: 1, caseTitle: 'EC決済基盤の刷新', personName: null }
    })
  })

  it('never names the person unless the operator turned names on', () => {
    const personName = vi.fn(() => '山田 太郎')
    const followUps = [followUp(1, { stage: 'scheduled', rounds: [round(1, '2026-10-01T05:00:00Z')] })]
    const hidden = buildTraySummary(input({ followUps, personName }), now)
    expect(hidden.showPersonNames).toBe(false)
    expect(hidden.interviews.next?.personName).toBeNull()
    expect(personName).not.toHaveBeenCalled()
    expect(JSON.stringify(hidden)).not.toContain('山田')
    const shown = buildTraySummary(input({ followUps, personName, menuBar: { visible: true, showPersonNames: true } }), now)
    expect(shown.interviews.next?.personName).toBe('山田 太郎')
    expect(personName).toHaveBeenCalledWith(uuid(1))
  })

  it('counts unread active cases like the case list, new opportunities, and 可以提案 pairs not yet followed', () => {
    const summary = buildTraySummary(
      input({
        feed: [
          feedEntry(1, 'case', true),
          feedEntry(2, 'case', true),
          feedEntry(3, 'case', true, true),
          feedEntry(4, 'case', false),
          feedEntry(5, 'person', true)
        ],
        opportunities: [opportunity(1, 'new'), opportunity(2, 'new'), opportunity(3, 'seen'), opportunity(4, 'dismissed')],
        followUps: [followUp(2, { stage: 'recommended' })],
        proposablePairs: [
          { documentId: uuid(1), reviewId: uuid(51) },
          { documentId: uuid(1), reviewId: uuid(51) },
          { documentId: uuid(2), reviewId: uuid(52) },
          { documentId: uuid(3), reviewId: uuid(51) }
        ]
      }),
      now
    )
    expect(summary.cases.unseen).toBe(2)
    expect(summary.matching).toEqual({ newOpportunities: 2, proposable: 2 })
  })

  it('raises only the alerts that apply', () => {
    expect(buildTraySummary(input(), now).alerts).toEqual([])
    expect(
      buildTraySummary(
        input({
          ai: { state: 'exhausted', availableCredits: 0, reservedCredits: 0, fraction: 0 },
          gmail: { configuration: 'ready', status: 'error', lastError: 'GMAIL_SYNC_FAILED' },
          cloudPrivacyReady: false
        }),
        now
      ).alerts
    ).toEqual(['ai-credits-exhausted', 'gmail-sync-failed', 'privacy-gate-blocked'])
    expect(buildTraySummary(input({ ai: { state: 'low', availableCredits: 20, reservedCredits: 0, fraction: 0.02 } }), now).alerts).toEqual(
      ['ai-credits-low']
    )
    expect(
      buildTraySummary(input({ ai: { state: 'signed-out', availableCredits: null, reservedCredits: null, fraction: null } }), now).alerts
    ).toEqual(['ai-signed-out'])
    // A build without AICommerce or Gmail has nothing to warn about.
    expect(
      buildTraySummary(
        input({
          ai: { state: 'unconfigured', availableCredits: null, reservedCredits: null, fraction: null },
          gmail: { configuration: 'required', status: 'error', lastError: 'x' },
          cloudPrivacyReady: false
        }),
        now
      ).alerts
    ).toEqual([])
  })

  it('raises ai-request-rejected for a credit refusal within 24 hours, and not once a call succeeded', () => {
    const rejection = { reason: 'insufficient-credits' as const, at: '2026-09-30T02:00:00Z', modelName: 'GPT-6 Sol' }
    const within24h = buildTraySummary(input({ aiRejection: rejection }), now)
    expect(within24h.alerts).toEqual(['ai-request-rejected'])
    expect(within24h.aiRejectedModel).toBe('GPT-6 Sol')
    // Replaces 「额度不足」: the refusal is the more accurate reason.
    expect(
      buildTraySummary(
        input({ aiRejection: rejection, ai: { state: 'low', availableCredits: 20, reservedCredits: 0, fraction: 0.02 } }),
        now
      ).alerts
    ).toEqual(['ai-request-rejected'])
    // An empty wallet or a signed-out account already says why.
    expect(
      buildTraySummary(
        input({ aiRejection: rejection, ai: { state: 'exhausted', availableCredits: 0, reservedCredits: 0, fraction: 0 } }),
        now
      ).alerts
    ).toEqual(['ai-credits-exhausted'])
    // Older than 24 hours, or cleared by a successful call (the signal is null again).
    const stale = buildTraySummary(input({ aiRejection: { ...rejection, at: '2026-09-30T01:00:00Z' } }), now)
    expect(stale.alerts).toEqual([])
    expect(stale.aiRejectedModel).toBeUndefined()
    expect(buildTraySummary(input({ aiRejection: null }), now).alerts).toEqual([])
  })

  it('reports a gateway sign-in refusal once, as ai-signed-out', () => {
    const rejection = { reason: 'sign-in-required' as const, at: '2026-10-01T00:00:00Z', modelName: 'GPT-6 Sol' }
    expect(buildTraySummary(input({ aiRejection: rejection }), now).alerts).toEqual(['ai-signed-out'])
    expect(
      buildTraySummary(
        input({ aiRejection: rejection, ai: { state: 'signed-out', availableCredits: null, reservedCredits: null, fraction: null } }),
        now
      ).alerts
    ).toEqual(['ai-signed-out'])
  })
})

describe('trayAiQuota', () => {
  const state = (overrides: Partial<AiCommerceMembershipState>) =>
    ({ configuration: 'ready', connection: 'connected', wallet: null, ...overrides }) as AiCommerceMembershipState
  it('reads the wallet as available credits and reports 未知 until one is known', () => {
    expect(trayAiQuota(state({ configuration: 'required' }), null).state).toBe('unconfigured')
    expect(trayAiQuota(state({ connection: 'reauthentication-required' }), null).state).toBe('signed-out')
    expect(trayAiQuota(state({}), null)).toEqual({ state: 'unknown', availableCredits: null, reservedCredits: null, fraction: null })
    expect(trayAiQuota(state({}), { balanceCredits: 2500, reservedCredits: 500 })).toEqual({
      state: 'ok',
      availableCredits: 2000,
      reservedCredits: 500,
      fraction: 1
    })
    expect(trayAiQuota(state({ wallet: { balanceCredits: 90, reservedCredits: 10 } }), null)).toMatchObject({
      state: 'low',
      availableCredits: 80
    })
    expect(trayAiQuota(state({ wallet: { balanceCredits: 10, reservedCredits: 10 } }), null)).toMatchObject({
      state: 'exhausted',
      availableCredits: 0
    })
  })
  it('counts only current-policy recommendations as 可以提案', () => {
    expect(isProposable({ policyVersion: businessMatchingPolicyVersion, status: 'recommended', requirements: [] })).toBe(true)
    expect(isProposable({ policyVersion: 'mandatory-evidence-v2', status: 'recommended', requirements: [] })).toBe(false)
    expect(isProposable({ policyVersion: businessMatchingPolicyVersion, status: 'needs-confirmation', requirements: [] })).toBe(false)
    expect(isProposable(undefined)).toBe(false)
  })
})

describe('trayBadge', () => {
  it('shows the 今天要跟进 count, and nothing when there is none or data cannot be read', () => {
    const summary = buildTraySummary(input({ followUps: [followUp(1)] }), now)
    expect(trayBadge(summary, 'zh-CN')).toEqual({ title: '1', tooltip: 'SES Agent · 1 件今天要跟进' })
    expect(trayBadge(summary, 'ja-JP').tooltip).toBe('SES Agent · 今日の対応 1 件')
    expect(trayBadge(buildTraySummary(input(), now), 'zh-CN')).toEqual({ title: '', tooltip: 'SES Agent' })
    expect(trayBadge({ status: 'not-ready', locale: 'zh-CN', generatedAt: now.toISOString() }, 'zh-CN')).toEqual({
      title: '',
      tooltip: 'SES Agent'
    })
  })
})
