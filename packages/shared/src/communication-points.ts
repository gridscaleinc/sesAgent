import { z } from 'zod'

/**
 * 沟通要点: what to raise with the person or the client before proposing or interviewing one person for one case,
 * drafted by the cloud AI from the resume, the case and the requirements the material left open. Questions, not
 * claims: they never change the match conclusion. A source, when given, is a verbatim fragment checked locally.
 */
export const communicationPointLimits = { question: 120, reason: 160, source: 120, points: 6 } as const

export interface CommunicationPoint {
  question: string
  /** Who is asked: the person themselves, or the client. */
  audience: 'person' | 'client'
  /** Why it is worth asking. */
  reason: string
  /** A verbatim fragment of the case or the person's material that prompts it; null when none applies. */
  source: string | null
}

export const communicationPointsQuerySchema = z.object({ documentId: z.string().uuid(), reviewId: z.string().uuid() }).strict()
export type CommunicationPointsQuery = z.infer<typeof communicationPointsQuerySchema>
/** Generating may carry what HR asks for this time, for example 「重点看入场时间和出社频率」. */
export const generateCommunicationPointsInputSchema = communicationPointsQuerySchema
  .extend({ request: z.string().trim().min(1).max(500).optional() })
  .strict()
export type GenerateCommunicationPointsInput = z.infer<typeof generateCommunicationPointsInputSchema>

export interface CommunicationPointsRecord {
  documentId: string
  reviewId: string
  profileVersion: number
  jobCaseVersion: number
  locale: 'ja-JP' | 'zh-CN'
  points: CommunicationPoint[]
  /** What HR asked for when these were generated. */
  request: string | null
  generatedAt: string
  modelName: string | null
}

/** stale: the person's profile or the case changed since generation; the points are shown for reference only. */
export interface CommunicationPointsView {
  record: CommunicationPointsRecord | null
  stale: boolean
}
