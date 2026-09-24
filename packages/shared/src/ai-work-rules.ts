import { z } from 'zod'
import { interviewAskTypes, interviewQuestionDimensions } from './interview-question-policy'

export const workRuleScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).strict(),
  z.object({ kind: z.literal('case'), value: z.string().uuid() }).strict(),
  z.object({ kind: z.enum(['customer', 'category']), value: z.string().trim().min(1).max(120) }).strict()
])
export type WorkRuleScope = z.infer<typeof workRuleScopeSchema>

export const workRuleClauseSchema = z.object({
  kind: z.enum(['required', 'preferred', 'confirm', 'interview', 'presentation']),
  field: z.enum(['required_skills', 'role', 'japanese_level', 'rate', 'start_date', 'remote', 'location', 'work_authorization']).nullable(),
  text: z.string().trim().min(1).max(600),
  sourceQuote: z.string().trim().min(1).max(1500),
  // Explicit case keywords only. Empty means the rule's selected scope.
  caseKeywords: z.array(z.string().trim().min(1).max(80)).max(6)
}).strict()
export type WorkRuleClause = z.infer<typeof workRuleClauseSchema>
export const workRuleAnalysisSchema = z.object({
  clauses: z.array(workRuleClauseSchema).max(12),
  issues: z.array(z.string().min(1).max(500)).max(12)
}).strict()
export type WorkRuleAnalysis = z.infer<typeof workRuleAnalysisSchema>
export const analyzeWorkRuleInputSchema = z.object({
  text: z.string().trim().min(2).max(6000), scope: workRuleScopeSchema
}).strict()
export type AnalyzeWorkRuleInput = z.infer<typeof analyzeWorkRuleInputSchema>
export interface WorkRulePreview extends AnalyzeWorkRuleInput, WorkRuleAnalysis {
  token: string; modelKey: string; expiresAt: string
}
export const workRuleRecordSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(), enabled: z.boolean(),
  text: z.string().min(2).max(6000), scope: workRuleScopeSchema,
  clauses: z.array(workRuleClauseSchema).min(1).max(12),
  modelKey: z.string().min(1), updatedAt: z.string().datetime(), updatedBy: z.string().min(1)
}).strict()
export type WorkRuleRecord = z.infer<typeof workRuleRecordSchema>
export interface WorkRuleLibrary { revision: number; rules: WorkRuleRecord[] }
export const saveWorkRuleInputSchema = z.object({
  token: z.string().uuid(), id: z.string().uuid().optional(), expectedRevision: z.number().int().nonnegative()
}).strict()
export type SaveWorkRuleInput = z.infer<typeof saveWorkRuleInputSchema>
export const changeWorkRuleInputSchema = z.object({
  id: z.string().uuid(), expectedRevision: z.number().int().positive(),
  enabled: z.boolean().optional(), restoreRevision: z.number().int().positive().optional()
}).strict().refine((v) => (v.enabled !== undefined) !== (v.restoreRevision !== undefined), 'Choose one rule change.')
export type ChangeWorkRuleInput = z.infer<typeof changeWorkRuleInputSchema>
export interface AppliedWorkRule {
  id: string; revision: number; text: string; kind: WorkRuleClause['kind']
}

/** Conditional scope is evaluated identically in both matching directions. */
export function applicableWorkRules(library: WorkRuleLibrary, job: {
  id: string; sourceReviewId?: string; fields: ReadonlyArray<{ key: string; value: string | null }>
}): Array<AppliedWorkRule & { clause: WorkRuleClause }> {
  const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().trim()
  const contains = (text: string, term: string) => {
    const needle = normalize(term).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    return new RegExp(`(?<![a-z0-9])${needle}(?![a-z0-9])`, 'u').test(normalize(text))
  }
  const text = job.fields.map((field) => field.value ?? '').join('\n')
  const customer = job.fields.filter((field) => ['client', 'customer', 'company', 'end_client'].includes(field.key)).map((field) => field.value ?? '').join('\n')
  return library.rules.filter((rule) => rule.enabled && (
    rule.scope.kind === 'global' || rule.scope.kind === 'case' && rule.scope.value === (job.sourceReviewId ?? job.id) ||
    rule.scope.kind === 'category' && contains(text, rule.scope.value) ||
    rule.scope.kind === 'customer' && contains(customer || text, rule.scope.value)
  )).toSorted((a, b) => Number(a.scope.kind === 'case') - Number(b.scope.kind === 'case')).flatMap((rule) =>
    rule.clauses.filter((clause) => clause.caseKeywords.every((word) => contains(text, word))).map((clause) => ({
      id: rule.id, revision: rule.revision, text: clause.text, kind: clause.kind, clause
    })))
}

export const assessCasePersonInputSchema = z.object({
  jobCaseId: z.string().uuid(), documentId: z.string().uuid(), withoutRules: z.boolean().optional(),
  /** What the operator asked this assessment to look at; emphasis only, never a new requirement or fact. */
  request: z.string().trim().min(1).max(500).optional()
}).strict()
export type AssessCasePersonInput = z.infer<typeof assessCasePersonInputSchema>
export interface CasePersonAssessment {
  origin?: 'search' | 'specified'
  id: string; jobCaseId: string; documentId: string; jobCaseVersion: number; profileVersion: number;
  assessedAt: string; rulesRevision: number; appliedRules: AppliedWorkRule[];
  /** The operator request this assessment ran with, shown on the card so a steered result is never mistaken for a plain one. */
  request?: string | null;
  result: import('./business-workbench').CasePersonnelMatchResult['items'][number];
  cloud: import('./business-workbench').CasePersonnelMatchResult['cloud']
}
export const assessmentFeedbackInputSchema = z.object({
  assessmentId: z.string().uuid(), decision: z.enum(['suitable', 'unsuitable']),
  reason: z.enum(['skills', 'evidence', 'rate', 'availability', 'work-style', 'language', 'interest', 'case-closed', 'other']),
  note: z.string().trim().max(2000)
}).strict()
export type AssessmentFeedbackInput = z.infer<typeof assessmentFeedbackInputSchema>

export const generateRuleQuestionsInputSchema = z.object({
  documentId: z.string().uuid(), jobCaseId: z.string().uuid().optional(), interviewId: z.string().uuid().optional(),
  /** What the operator asked for this time; guidance only, never new facts or requirements. */
  request: z.string().trim().min(1).max(500).optional()
}).strict()
export type GenerateRuleQuestionsInput = z.infer<typeof generateRuleQuestionsInputSchema>
const ruleQuestionSourceIds = { requirementIds: z.array(z.string().regex(/^R[1-9]\d*$/u)).min(1).max(5), evidenceIds: z.array(z.string().regex(/^E[1-9]\d*$/u)).max(5) }
export const ruleQuestionResponseSchema = z.object({
  /** STEP 1: the capability map the questions are drawn from, at most one entry per dimension. */
  capabilities: z.array(z.object({
    dimension: z.enum(interviewQuestionDimensions), focus: z.string().trim().min(1).max(200),
    requirementIds: z.array(z.string().regex(/^R[1-9]\d*$/u)).min(1).max(10), evidenceIds: z.array(z.string().regex(/^E[1-9]\d*$/u)).max(10)
  }).strict()).min(1).max(5),
  /** STEP 2: one question per classified dimension, naming the concrete example itself. */
  questions: z.array(z.object({
    dimension: z.enum(interviewQuestionDimensions),
    ask: z.enum(interviewAskTypes),
    bankQuestionId:z.string().uuid().optional(),
    text: z.string().trim().min(2).max(300),
    ...ruleQuestionSourceIds,
    scoringGuide: z.string().trim().min(1).max(300),
    followUp: z.string().trim().min(1).max(200).optional()
  }).strict()).min(1).max(5)
}).strict()
export interface RuleQuestionsResult { questions: import('./contracts').CandidateInterviewQuestion[]; appliedRules: AppliedWorkRule[]; rulesRevision: number; draftId?: string | null }

/** Questions generated for one person on one case, kept before any interview round exists and carried into round one. */
export interface CasePersonQuestionDraft {
  id: string; documentId: string; jobCaseId: string; jobCaseVersion: number; profileVersion: number; rulesRevision: number
  experienceRunId: string | null; questions: import('./contracts').CandidateInterviewQuestion[]; createdAt: string; supersededAt: string | null
}
export const caseQuestionDraftQuerySchema = z.object({ documentId: z.string().uuid(), jobCaseId: z.string().uuid().optional(), reviewId: z.string().uuid().optional() }).strict()
  .refine(value => value.jobCaseId || value.reviewId, { message: 'jobCaseId or reviewId is required' })
export type CaseQuestionDraftQuery = z.infer<typeof caseQuestionDraftQuerySchema>
/** stale: the person, case or rules changed since the draft was generated; the draft is shown for reference only. */
export interface CaseQuestionDraftView { draft: CasePersonQuestionDraft | null; stale: boolean }

export interface CaseResumeImportProgress {
  requestId: string; jobCaseId: string; stage: 'parsing' | 'assessing'; documentId: string | null
}
