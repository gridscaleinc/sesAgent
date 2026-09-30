import { z } from 'zod'

/**
 * 推荐要点: AI-drafted selling points for introducing one person to one client case. Each point cites a
 * verbatim fragment of the person's own material, checked locally; they are writing material for HR, never
 * part of the match conclusion.
 */
export const recommendationPointLimits = { headline: 30, detail: 160, quote: 120, points: 5 } as const

export interface RecommendationPoint {
  headline: string
  detail: string
  /** The exact title of the supplied project the point comes from; null when it comes from the person's facts. */
  project: string | null
  /** A verbatim fragment of that project or fact. */
  quote: string
}

/** Why a generation kept no point: every point the model returned failed the local source check. */
export type RecommendationPointsEmptyReason = 'no-grounded-points'

export const recommendationPointsQuerySchema = z.object({ documentId: z.string().uuid(), reviewId: z.string().uuid() }).strict()
export type RecommendationPointsQuery = z.infer<typeof recommendationPointsQuerySchema>

export interface RecommendationPointsRecord {
  documentId: string
  reviewId: string
  profileVersion: number
  jobCaseVersion: number
  locale: 'ja-JP' | 'zh-CN'
  points: RecommendationPoint[]
  emptyReason: RecommendationPointsEmptyReason | null
  generatedAt: string
  modelName: string | null
}

/** stale: the person's profile or the case changed since the points were generated; they are shown for reference only. */
export interface RecommendationPointsView {
  record: RecommendationPointsRecord | null
  stale: boolean
}

/** The text a 「插入」 puts into an introduction: the headline, then the detail. */
export function recommendationPointText(point: Pick<RecommendationPoint, 'headline' | 'detail'>): string {
  return `・${point.headline}：${point.detail}`
}
