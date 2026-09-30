import { z } from 'zod'
import type { ApplicationLocale } from './contracts'

export { trayIpcChannels } from './tray-channels'

/** Main-window places the quick panel can open. */
export const trayRoutes = [
  'cases',
  'cases:new',
  'people:import',
  'followups',
  'agent',
  'ai-member',
  'settings:models',
  'settings:integrations'
] as const
export type TrayRoute = (typeof trayRoutes)[number]

/** Optional detail of a route: which list filter or panel to show, or the question 问 Agent prefills (never sends). */
export interface TrayRoutePayload {
  caseView?: 'unseen' | 'opportunities'
  followUpFilter?: 'today'
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
    followUpFilter: z.literal('today').optional()
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

/** The whole surface the quick panel's preload exposes; nothing else of the desktop API is reachable from it. */
export interface TrayDesktopApi {
  getTraySummary(): Promise<TraySummary>
  onTraySummaryChanged(listener: (summary: TraySummary) => void): () => void
  openMain(route: TrayRoute, payload?: Omit<TrayRoutePayload, 'text'>): Promise<void>
  askAgent(text: string): Promise<void>
  resize(height: number): void
  hide(): void
}
