import { z } from 'zod'
export const interviewAnswerSchema = z
  .object({
    questionId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u),
    status: z.enum(['answered', 'partial', 'unanswered']),
    quote: z.string().max(2000),
    summary: z.string().max(500),
    remaining: z.string().max(500)
  })
  .strict()
export type InterviewAnswer = z.infer<typeof interviewAnswerSchema>
export interface InterviewAnswers {
  interviewId: string
  sourceHash: string
  updatedAt: string
  answers: InterviewAnswer[]
}
export const customerIdentityInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    expectedVersion: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(120),
    aliases: z.array(z.string().trim().min(1).max(120)).max(30)
  })
  .strict()
export type CustomerIdentityInput = z.infer<typeof customerIdentityInputSchema>
export interface CustomerIdentity {
  id: string
  owner: string
  version: number
  name: string
  aliases: string[]
}
export interface MatchingOpportunity {
  id: string
  documentId: string
  reviewId: string
  jobCaseId: string
  personName: string
  caseTitle: string
  profileVersion: number
  jobCaseVersion: number
  rulesRevision: number
  fingerprint: string
  score: number
  /**
   * The local matching conclusion. Excluded pairs are not stored, except 'not-suitable': HR judged a requirement
   * not met, and the pair stays listed last. Rows saved before the status existed read as 'needs-confirmation'.
   */
  status: 'recommended' | 'needs-confirmation' | 'not-suitable'
  reasons: string[]
  /** Only the core (technical / language) requirements still unmet; business terms are left to the full assessment. */
  confirm: string[]
  updatedAt: string
  state: 'new' | 'seen' | 'dismissed'
}
export const opportunityActionSchema = z
  .object({ id: z.string().uuid(), fingerprint: z.string().length(64), action: z.enum(['seen', 'dismissed', 'restored']) })
  .strict()
export interface QuestionBankRevision {
  id: string
  bankId: string
  version: number
  text: string
  scoringGuide: string
  reason: string
  createdAt: string
  sources: string[]
  sourceHashes?: Record<string, string>
}
export const bankComparisonSchema = z
  .object({
    equivalent: z.boolean(),
    preferred: z.enum(['current', 'candidate', 'tie']),
    comparisons: z
      .array(
        z
          .object({
            sourceId: z.string().uuid(),
            quote: z.string().min(5).max(500),
            current: z.number().int().min(0).max(2),
            candidate: z.number().int().min(0).max(2),
            regression: z.boolean()
          })
          .strict()
      )
      .min(1)
      .max(2),
    reason: z.string().min(5).max(500)
  })
  .strict()
export interface PairInterviewEvidence extends InterviewAnswer {
  interviewId: string
  roundNumber: number
  questionText: string
  requirement: string
}
