import { z } from 'zod'
import type { ExperienceScope } from './system-experience'
export const questionCategories = ['responsibility', 'design', 'delivery', 'troubleshooting', 'testing', 'followup'] as const
export const questionTemplateDraftSchema = z
  .object({
    category: z.enum(questionCategories),
    keyword: z.string().trim().min(2).max(60),
    text: z.string().trim().min(8).max(500),
    scoringGuide: z.string().trim().min(4).max(300),
    sourceQuote: z.string().min(5).max(500)
  })
  .strict()
export type QuestionTemplateDraft = z.infer<typeof questionTemplateDraftSchema>
export interface BankQuestion {
  mergedInto?: string
  mergeProtected?: boolean
  id: string
  version: number
  scope: ExperienceScope
  category: (typeof questionCategories)[number]
  keyword: string
  text: string
  scoringGuide: string
  enabled: boolean
  locked: boolean
  reason: string
  createdAt: string
  updatedAt: string
  sources: number
  adoptions: number
  edits: number
  answerRecords?: number
  partialAnswers?: number
  state: 'available' | 'frequent' | 'paused' | 'withdrawn'
}
export const questionBankQuerySchema = z
  .object({
    search: z.string().max(120).optional(),
    category: z.enum(questionCategories).optional(),
    includeDisabled: z.boolean().optional()
  })
  .strict()
export type QuestionBankQuery = z.infer<typeof questionBankQuerySchema>
export const questionBankControlSchema = z
  .object({ id: z.string().uuid(), expectedVersion: z.number().int().positive(), enabled: z.boolean() })
  .strict()
export type QuestionBankControl = z.infer<typeof questionBankControlSchema>
export interface QuestionBankSource {
  id: string
  runId: string
  questionId: string
  text: string
  requirement: string
  scope: ExperienceScope
  bankId: string | null
  createdAt: string
}
