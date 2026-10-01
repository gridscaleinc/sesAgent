import { z } from 'zod'
import type { CasePersonAssessment } from './ai-work-rules'
import type { StoredPersonnelCaseMatchRun } from './business-workbench'
import type { RequirementConfirmation } from './matching-requirements'

/** Limits on what HR types into a decision. */
export const requirementDecisionLimits = { label: 300, note: 300, question: 500 } as const

/**
 * HR settles one unclear requirement of a pair. 'person' scope records it as a fact about the person for every
 * case asking the same; 'pair' scope keeps it to this case version. The requirement is identified by its wording.
 */
export const decideRequirementInputSchema = z
  .object({
    documentId: z.string().uuid(),
    jobCaseId: z.string().uuid(),
    requirement: z
      .object({
        key: z.string().min(1).max(80),
        label: z.string().trim().min(1).max(requirementDecisionLimits.label),
        category: z.enum(['core', 'condition'])
      })
      .strict(),
    outcome: z.enum(['met', 'conflict', 'asking']),
    scope: z.enum(['person', 'pair']),
    note: z.string().trim().max(requirementDecisionLimits.note).nullable(),
    question: z.string().trim().max(requirementDecisionLimits.question).nullable()
  })
  .strict()
  .refine((input) => input.outcome !== 'asking' || Boolean(input.question), { message: 'question required', path: ['question'] })
export type DecideRequirementInput = z.infer<typeof decideRequirementInputSchema>

export const withdrawRequirementDecisionInputSchema = z.object({ id: z.string().uuid(), documentId: z.string().uuid() }).strict()
export type WithdrawRequirementDecisionInput = z.infer<typeof withdrawRequirementDecisionInputSchema>

/** After a decision: the person's decisions and every stored result of theirs it changed, ready to replace in place. */
export interface RequirementDecisionResult {
  confirmations: RequirementConfirmation[]
  /** The latest case-side assessments of this person whose conclusion changed. */
  assessments: CasePersonAssessment[]
  /** The person's stored 找案件 run with the decisions applied, when there is one. */
  personRun: StoredPersonnelCaseMatchRun | null
}
