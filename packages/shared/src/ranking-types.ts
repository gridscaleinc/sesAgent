import { z } from 'zod'
export const rankingFeatureSchema=z.enum(['project-evidence','independent-responsibility','delivery-evidence','domain-experience','project-phase','communication-responsibility'])
export type RankingFeature=z.infer<typeof rankingFeatureSchema>
