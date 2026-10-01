import { z } from 'zod'
import type { ApplicationLocale } from './contracts'

export { trayIpcChannels } from './tray-channels'

/** Main-window places the quick panel can open. */
export const trayRoutes = [
  'cases',
  'cases:new',
  'people:import',
  'followups',
  'interview-schedule',
  'agent',
  'ai-member',
  'settings:models',
  'settings:integrations'
] as const
export type TrayRoute = (typeof trayRoutes)[number]

/** Optional detail of a route: which list filter or panel to show, or the question 问 Agent prefills (never sends). */
export interface TrayRoutePayload {
  caseView?: 'unseen' | 'opportunities'
  followUpFilter?: 'today' | 'active' | 'coordinating'
  text?: string
}

/** What Main forwards to the main window; the id lets the window act on each request once. */
export interface TrayNavigation extends TrayRoutePayload {
  id: string
  route: TrayRoute
}

export const trayQuestionSchema = z.string().trim().min(1).max(2000)
export const trayRoutePayloadSchema = z
  .object({
    caseView: z.enum(['unseen', 'opportunities']).optional(),
    followUpFilter: z.enum(['today', 'active', 'coordinating']).optional()
  })
  .strict()
export const trayOpenMainInputSchema = z.object({ route: z.enum(trayRoutes), payload: trayRoutePayloadSchema.optional() }).strict()
export const trayResizeInputSchema = z.number().finite().min(1).max(4000)

export type TrayAlert =
  | 'ai-credits-exhausted'
  | 'ai-credits-low'
  | 'ai-signed-out'
  /** The AI gateway refused the latest cloud call for credits: the balance does not cover the model's reservation. */
  | 'ai-request-rejected'
  | 'gmail-sync-failed'
  | 'privacy-gate-blocked'

export interface TrayAiQuota {
  /** unknown: signed in but the wallet has not been read yet (or could not be). */
  state: 'unconfigured' | 'signed-out' | 'unknown' | 'ok' | 'low' | 'exhausted'
  availableCredits: number | null
  /** Credits the gateway holds for calls in flight; null when the wallet is not known. */
  reservedCredits: number | null
  /** 0–1 for the bar; null when there is nothing to draw. */
  fraction: number | null
}

/** The next interview today. The person's name is present only when the operator turned names on for the panel. */
export interface TrayInterview {
  /** A 招聘面试 is not on 跟进: it opens the interview schedule instead. */
  kind: 'client' | 'recruiting'
  at: string
  roundNumber: number
  caseTitle: string
  personName: string | null
}

export interface TrayReadySummary {
  status: 'ready'
  locale: ApplicationLocale
  generatedAt: string
  /** Tokyo business day, YYYY-MM-DD. */
  today: string
  showPersonNames: boolean
  /** The follow-ups 「今天要做」 lists; also the menu-bar badge. */
  followUpsDueToday: number
  cases: { newToday: number; unseen: number }
  matching: { newOpportunities: number; proposable: number }
  interviews: { coordinating: number; today: number; next: TrayInterview | null }
  ai: TrayAiQuota
  /** The model of the refused call behind 'ai-request-rejected'; absent while that alert is not raised. */
  aiRejectedModel?: string
  alerts: TrayAlert[]
  week: { casesCreated: number; recommended: number; started: number }
}

export interface TrayNotReadySummary {
  status: 'not-ready'
  locale: ApplicationLocale
  generatedAt: string
}

export type TraySummary = TrayReadySummary | TrayNotReadySummary

/** Most rows each list of the main window's 「今天」 page carries; the counts above stay exact. */
export const todayListLimits = { followUps: 20, interviews: 20, opportunities: 5, cases: 5 } as const

/** A follow-up 「今天要做」 lists, with the step it waits for (localized in Main for the summary's locale). */
export interface TodayFollowUpItem {
  id: string
  documentId: string
  reviewId: string
  personName: string | null
  caseTitle: string
  stage: import('./business-progress').BusinessProgressStage
  /** The stage as the follow-up list shows it, e.g. 待约面. */
  stageLabel: string
  /** The next step, e.g. 安排面试. */
  action: string
  /** When the step is due (interview time, planned entry day), when there is one. */
  when: string | null
}

export interface TodayInterviewItem extends TrayInterview {
  /** 'client': a round of a follow-up (opens it in 跟进); 'recruiting': a 招聘面试, belonging to no follow-up or case. */
  kind: 'client' | 'recruiting'
  followUpId: string | null
  documentId: string
  reviewId: string | null
  durationMinutes: number
}

export interface TodayOpportunityItem {
  id: string
  documentId: string
  reviewId: string
  jobCaseId: string
  personName: string
  caseTitle: string
  score: number
  /** Core requirements still unmet; empty for 可以提案. */
  confirm: string[]
}

export interface TodayCaseItem {
  reviewId: string
  title: string
  sourceAt: string
}

/** The menu-bar summary plus the bounded lists the main window's 「今天」 page shows; person names always present. */
export interface TodayReadySummary extends TrayReadySummary {
  lists: {
    followUps: TodayFollowUpItem[]
    interviews: TodayInterviewItem[]
    /** New opportunities (state 'new'), best first: 可以提案 and 待确认. */
    opportunities: { proposable: TodayOpportunityItem[]; needsInfo: TodayOpportunityItem[] }
    /** Unread cases, newest first. */
    unseenCases: TodayCaseItem[]
  }
}

export type TodaySummary = TodayReadySummary | TrayNotReadySummary

/** The whole surface the quick panel's preload exposes; nothing else of the desktop API is reachable from it. */
export interface TrayDesktopApi {
  getTraySummary(): Promise<TraySummary>
  onTraySummaryChanged(listener: (summary: TraySummary) => void): () => void
  openMain(route: TrayRoute, payload?: Omit<TrayRoutePayload, 'text'>): Promise<void>
  askAgent(text: string): Promise<void>
  resize(height: number): void
  hide(): void
}
