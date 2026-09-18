import { z } from 'zod'
import { interviewQuestionPolicy } from './interview-question-policy'
import { rankingFeatureSchema, type RankingFeature } from './ranking-types'
import type { RankingSnapshot } from './experience-ranking'

export const experienceTasks = ['matching', 'interview', 'introduction'] as const
export type ExperienceTask = typeof experienceTasks[number]
// Learned methods are bounded business procedures, never executable code or new hard requirements.
export const experienceMethods = {
  ranking: { tasks:['matching'], zh:'有依据的推荐偏好',ja:'根拠のある推薦の優先傾向',procedure:'A bounded ranking preference among equally qualified options. It never changes eligibility, facts or hard requirements.' },
  custom: { tasks: ['matching', 'interview', 'introduction'], zh: '从业务修改总结的方法', ja: '業務の修正からまとめた手順', procedure: 'Use the validated business procedure supplied for this task. Preserve facts, explicit HR rules, privacy and unknowns. Never create eligibility conditions.' },
  ownership: { tasks: ['matching', 'interview'], zh: '核实本人负责范围', ja: '本人の担当範囲を確認', procedure: 'Distinguish participation, assistance and independent ownership. Look for the person’s actual responsibility and decision-making evidence. If the current requirement needs independence but evidence is absent, mark it unknown and ask about responsibility; never infer inability.' },
  deliverables: { tasks: ['matching', 'interview'], zh: '核实具体交付物', ja: '具体的な成果物を確認', procedure: 'For the relevant requirement, seek evidence of concrete deliverables the person produced, their contribution and outcomes. Ask a project-specific follow-up when unclear. Do not make a deliverable type a new mandatory requirement.' },
  depth: { tasks: ['matching', 'interview'], zh: '核实技术应用深度', ja: '技術の活用範囲を確認', procedure: 'Distinguish a technology listed in a skill list from evidenced use in project responsibilities. Seek concrete use, decisions and troubleshooting. Missing detail is unknown, not proof of inability; do not invent years or thresholds.' },
  example: { tasks: ['interview'], zh: '用具体项目追问', ja: '具体的な案件から深掘り', procedure: 'Ask for a concrete project example, the person’s actions, trade-offs and outcome for the supplied requirement. Prefer a focused question over a broad self-rating question; use only this person’s actual projects.' },
  followup: { tasks: ['interview'], zh: '围绕未解决问题追问', ja: '未解決事項を深掘り', procedure: 'Use actual recorded answers to identify what is resolved. A selected question is not proof it was asked. Avoid repeating a question answered in supplied notes; ask only a remaining, specific follow-up. Do not infer an answer from an absent note.' }
} as const
export type ExperienceMethod = keyof typeof experienceMethods
export const experienceMethodSchema = z.enum(['ranking', 'ownership', 'deliverables', 'depth', 'example', 'followup', 'custom'])
export const baseExperienceSkills: Record<ExperienceTask, string> = {
  introduction: 'Introduction writing v1: preserve supplied business facts, conditions and unknowns. Adapt only wording, structure and emphasis. Never invent experience, availability, outcomes or contact details. Adopted wording is not proof a message was sent.',
  matching: 'Match evidence review v1: map each existing case requirement to this person’s supplied facts/projects. Separate met, explicit conflict and unknown. Quote evidence. Preserve explicit HR rules and authoritative hard conditions. Reusable experience guides how to verify, never creates facts or disqualifying conditions.',
  interview: interviewQuestionPolicy
}
export interface ExperienceInput {
  task: ExperienceTask
  ranking?:RankingSnapshot
  context?: ExperienceContext
  introduction?: { projection: string; lang: 'zh' | 'ja'; style: 'brief' | 'standard' }
  requirements: Array<{ key: string; label: string; value: string }>
  facts: Array<{ key?: string; label: string; value: string }>
  projects: Array<{ title: string; period: string | null; role: string | null; technologies: string[]; summary: string }>
  hardFilters: Array<{ requirement: string; actual: string | null; outcome: 'passed' | 'failed' | 'unknown' }>
  hrRules: import('./ai-work-rules').AppliedWorkRule[]
  previousQuestions: string[]
  notes: string
  locale: 'zh-CN' | 'ja-JP'
}
export interface ExperienceRef { id: string; version: number }
export interface ExperienceBundle { task: ExperienceTask; instructions: string[]; refs: ExperienceRef[] }
export interface ExperienceRun {
  id: string; documentId: string | null; reviewId: string | null; interviewId: string | null;
  profileVersion: number; jobCaseVersion: number | null; rulesRevision: number;
  input: ExperienceInput; output: unknown; bundle: ExperienceBundle; modelKey: string | null;
  createdAt: string; exposure: boolean; opened: boolean; rank: number | null
}
export type ExperienceEventKind = 'progress' | 'feedback' | 'questions' | 'notes' | 'assessment-feedback' | 'edit'
export interface ExperienceEvent {
  id: string; sourceKey: string; documentId: string | null; reviewId: string | null; interviewId: string | null;
  kind: ExperienceEventKind; text: string; actor: string; createdAt: string;
  runIds: string[]; data: Record<string, unknown>; superseded: boolean
}
export interface ExperienceSample {
  eventId: string; task: ExperienceTask; method: ExperienceMethod; keyword: string;
  scope?: ExperienceScope; intent?: ExperienceIntent; rankingFeature?:RankingFeature;
  quote: string; polarity: 'support' | 'counterexample'; runId: string
}
export const experienceIntentSchema = z.enum(['ranking-preference','evidence-verification','question-specificity','question-followup','presentation-structure','presentation-tone','presentation-concision'])
export type ExperienceIntent = z.infer<typeof experienceIntentSchema>
export const experienceExtractionSchema = z.object({ observations: z.array(z.object({
  eventId: z.string().uuid(), task: z.enum(experienceTasks), method: experienceMethodSchema,
  intent: experienceIntentSchema.optional(), rankingFeature:rankingFeatureSchema.optional(),
  keyword: z.string().trim().min(2).max(60), quote: z.string().trim().min(5).max(1000),
  polarity: z.enum(['support', 'counterexample'])
}).strict()).max(30) }).strict()
export const experienceJudgmentSchema = z.object({
  a: z.number().int().min(0).max(2), b: z.number().int().min(0).max(2),
  sourceQuote: z.string().min(5).max(1000), outputQuote: z.string().min(4).max(1000),
  regression: z.boolean()
}).strict()
export interface ExperienceEvaluation {
  eventId: string; runId: string; baseline: number; candidate: number; regression: boolean; grounded: boolean
}
export interface SystemExperience {
  id: string; task: ExperienceTask; method: ExperienceMethod; keyword: string;
  version: number; enabled: boolean; locked: boolean;
  state: 'validating' | 'trial' | 'active' | 'rejected' | 'paused' | 'withdrawn';
  support: string[]; evaluations: ExperienceEvaluation[]; createdAt: string;
  previousVersion: number | null; reason: string; uses: number;
  seenEvents?: string[]; scope?: ExperienceScope; intent?: ExperienceIntent; rankingFeature?:RankingFeature; procedure?: ExperienceProcedure; servingVersion?: number; fallbackVersion?: number; modelKey?: string
}
export interface ExperienceSettings {
  enabled: boolean; dailyCallLimit: number; callsToday: number; budgetDate: string;
  lastAttempt: string | null; lastCompleted: string | null; lastError: string | null; revision: number
}
export interface SystemExperienceSnapshot {
  settings: ExperienceSettings; experiences: SystemExperience[]; eventCount: number; pendingCount: number;
  bases: typeof baseExperienceSkills
  metrics?: ExperienceMetrics[]
  trends?:import('./experience-trends').ExperienceTrend[]
}
export const experienceControlSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('learning'), enabled: z.boolean(), expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal('budget'), dailyCallLimit: z.number().int().min(0).max(60).refine(n=>n===0||n>=3, '至少 3 次或设为 0 / 3回以上、または0を指定'), expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal('enable'), id: z.string().uuid(), expectedVersion: z.number().int().positive(), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal('restore'), id: z.string().uuid(), expectedVersion: z.number().int().positive(), version: z.number().int().positive() }).strict()
])
export type ExperienceControl = z.infer<typeof experienceControlSchema>
export const experienceExposureSchema = z.object({ runId: z.string().uuid(), action: z.enum(['shown', 'opened']), rank: z.number().int().min(1).max(100).optional() }).strict()
export function experienceMatches(keyword: string, requirements: ExperienceInput['requirements']) {
  const escaped = keyword.normalize('NFKC').toLowerCase().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'u').test(requirements.map((r) => r.value).join('\n').normalize('NFKC').toLowerCase())
}
export function experienceInstructions(skill: Pick<SystemExperience, 'method' | 'keyword' | 'procedure'>): string {
  if (skill.procedure) return `Business method for the existing requirement containing ${JSON.stringify(skill.keyword)} (guidance only, never new facts or eligibility criteria): ${JSON.stringify(skill.procedure)}`
  return `Only for the existing requirement containing ${JSON.stringify(skill.keyword)}: ${experienceMethods[skill.method].procedure}`
}


export interface ExperienceContext {
  operatorId: string
  customer?: { key: string; label: string; aliasKeys?:string[] }
  category?: { key: string; label: string }
  locale: 'zh-CN' | 'ja-JP'
  style?: 'brief' | 'standard'
}
export interface ExperienceScope { kind: 'personal' | 'customer' | 'category'; owner: string; key: string; label: string; locale: 'zh-CN' | 'ja-JP'; style?: 'brief' | 'standard' }
export function experienceScopeFor(input: ExperienceInput): ExperienceScope | undefined {
  const context=input.context
  if (!context) return undefined
  const base={owner:context.operatorId,locale:context.locale,...(context.style?{style:context.style}:{})}
  if(input.task!=='introduction' && context.customer) return {...base,kind:'customer',...context.customer}
  if(input.task!=='introduction' && context.category) return {...base,kind:'category',...context.category}
  return {...base,kind:'personal',key:context.operatorId,label:'个人工作习惯 / 個人の業務習慣'}
}
export function experienceScopeMatches(scope: ExperienceScope | undefined, context?: ExperienceContext) {
  if(!scope)return true // v53 methods remain explicitly visible as legacy general methods.
  if(!context || scope.owner!==context.operatorId || scope.locale!==context.locale || scope.style && scope.style!==context.style)return false
  return scope.kind==='personal' ? scope.key===context.operatorId : scope.key===context[scope.kind]?.key || scope.kind==='customer'&&context.customer?.aliasKeys?.includes(scope.key)===true
}
export function experienceFamily(value: Pick<ExperienceSample,'task'|'method'|'keyword'|'scope'|'intent'|'rankingFeature'>) {
  return JSON.stringify([value.task,value.method,value.keyword.normalize('NFKC').toLowerCase(),value.intent??'',value.rankingFeature??'',value.scope?.kind??'',value.scope?.owner??'',value.scope?.key??'',value.scope?.locale??'',value.scope?.style??''])
}
export const experienceProcedureSchema = z.object({
  title:z.string().trim().min(4).max(100),steps:z.array(z.string().trim().min(8).max(400)).min(1).max(6),avoid:z.array(z.string().trim().min(4).max(240)).max(4)
}).strict()
export type ExperienceProcedure = z.infer<typeof experienceProcedureSchema>
export const experienceMethodDraftSchema = z.object({procedure:experienceProcedureSchema,sources:z.array(z.object({eventId:z.string().uuid(),quote:z.string().min(5).max(1000)}).strict()).min(3).max(3)}).strict()
export interface ExperienceMeasure { adopted:number; edited:number; editRatio:number|null; duplicateQuestionRate:number|null; resolved:number; feedback:number }
export interface ExperienceMetrics { task:ExperienceTask; baseline:ExperienceMeasure; assisted:ExperienceMeasure; enoughData:boolean }
export function experienceText(value:unknown):string {
  return typeof value==='string'?value:Array.isArray(value)?value.map(experienceText).join('\n'):value&&typeof value==='object'?Object.values(value).map(experienceText).join('\n'):''
}
/** Linear-time bigram distance: an editing indicator, never an accuracy score. */
export function experienceEditRatio(before:string,after:string) {
  const a=before.normalize('NFKC').replace(/\s+/gu,' ').trim(),b=after.normalize('NFKC').replace(/\s+/gu,' ').trim()
  if(a===b)return 0
  if(a.length<2||b.length<2)return 1
  const counts=new Map<string,number>();for(let i=0;i<a.length-1;i++){const key=a.slice(i,i+2);counts.set(key,(counts.get(key)??0)+1)}
  let same=0;for(let i=0;i<b.length-1;i++){const key=b.slice(i,i+2),n=counts.get(key)??0;if(n){same++;counts.set(key,n-1)}}
  return 1-2*same/(a.length+b.length-2)
}

/** Ignore whitespace and ordinary sentence punctuation in adoption quality signals. */
export function hasMeaningfulTextChange(before:string,after:string):boolean {
  const comparable=(text:string)=>text.normalize('NFKC').replace(/[\s。，、！？!?]/gu,'').replace(/[.!?]+$/u,'')
  return comparable(before)!==comparable(after)
}
