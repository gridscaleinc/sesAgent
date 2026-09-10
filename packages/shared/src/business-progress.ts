import { z } from 'zod'
import type { BusinessFollowUp } from './business-workbench'
import type { CandidateInterviewSnapshot } from './contracts'

export const businessProgressStages = ['coordinating', 'scheduled', 'feedback', 'next-round', 'next-decision', 'entry', 'started', 'paused', 'closed'] as const
export type BusinessProgressStage = typeof businessProgressStages[number]
const line = z.string().trim().max(1000)
export const progressEntrySchema = z.object({
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).or(z.literal('')),
  rate: line, workStyle: line, location: line, reportTime: line, contact: line, materials: line,
  candidateAccepted: z.boolean(), termsAgreed: z.boolean(), actualDate: z.string().nullable()
}).strict()
export type ProgressEntry = z.infer<typeof progressEntrySchema>
export const emptyProgressEntry = (): ProgressEntry => ({ plannedDate: '', rate: '', workStyle: '', location: '', reportTime: '', contact: '', materials: '', candidateAccepted: false, termsAgreed: false, actualDate: null })
export interface BusinessProgress {
  stage: BusinessProgressStage
  resumeStage?: BusinessProgressStage
  candidateAvailability: string
  clientAvailability: string
  pendingConditions: string[]
  entry: ProgressEntry
  rounds: CandidateInterviewSnapshot[]
}

export const beginBusinessProgressSchema = z.array(z.object({ documentId: z.string().uuid(), reviewId: z.string().uuid(), pendingConditions: z.array(z.string().trim().min(1).max(1000)).max(40).optional() }).strict()).min(1).max(30)
export type BeginBusinessProgressInput = z.infer<typeof beginBusinessProgressSchema>

const pair = { documentId: z.string().uuid(), reviewId: z.string().uuid(), expectedRevision: z.number().int().nonnegative(), mutationId: z.string().uuid(), sourceMessageId: z.string().regex(/^[a-f0-9]{64}$/u).optional() }
const round = z.number().int().min(1).max(20)
const schedule = z.object({
  roundNumber: round, scheduledAt: z.string().datetime().or(z.literal('')), durationMinutes: z.number().int().min(5).max(480),
  meetingMethod: z.enum(['zoom','google-meet','phone','onsite']), meetingUrl: z.string(),
  location: z.string(), interviewer: z.string(), note: z.string()
}).strict()
export type ProgressSchedule = z.infer<typeof schedule>
export const advanceBusinessProgressSchema = z.discriminatedUnion('action', [
  z.object({ ...pair, action: z.literal('coordinate'), candidateAvailability: z.string(), clientAvailability: z.string(), pendingConditions: z.array(z.string()) }).strict(),
  z.object({ ...pair, action: z.literal('schedule'), schedule }).strict(),
  z.object({ ...pair, action: z.literal('feedback'), roundNumber: round, notes: z.string().trim().min(1).max(8000),
    result: z.enum(['pending','passed','failed','no-show','withdrawn']), next: z.enum(['unknown','next-round','entry']),
    unresolved: z.array(z.string().trim().min(1).max(300)).max(20) }).strict(),
  z.object({ ...pair, action: z.literal('entry'), entry: progressEntrySchema }).strict(),
  z.object({ ...pair, action: z.literal('start'), actualDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u) }).strict(),
  z.object({ ...pair, action: z.literal('note'), note: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ ...pair, action: z.literal('pause'), reason: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ ...pair, action: z.literal('close'), reason: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ ...pair, action: z.literal('resume') }).strict(),
  z.object({ ...pair, action: z.literal('link-interview'), interviewId: z.string().uuid() }).strict()
])
export type AdvanceBusinessProgressInput = z.infer<typeof advanceBusinessProgressSchema>
export type ProgressCommand = AdvanceBusinessProgressInput extends infer T ? T extends AdvanceBusinessProgressInput ? Omit<T, keyof typeof pair> : never : never

export const analyzeBusinessProgressSchema = z.object({ documentId: z.string().uuid(), reviewId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(), text: z.string().trim().min(1).max(12000), lang: z.enum(['zh','ja']) }).strict()
export type AnalyzeBusinessProgressInput = z.infer<typeof analyzeBusinessProgressSchema>
export const progressAnalysisSchema = z.object({
  summary: z.string().max(2000), kind: z.enum(['schedule','feedback','entry','other']),
  evidence: z.string().max(2000), roundNumber: round.nullable(),
  result: z.enum(['pending','passed','failed','no-show','withdrawn']), next: z.enum(['unknown','next-round','entry']),
  scheduledAt: z.string().datetime().nullable(), candidateAvailability: line, clientAvailability: line,
  proposedTimes: z.array(z.string().datetime()).max(8), unresolved: z.array(z.string().max(300)).max(20),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable()
}).strict()
export type ProgressAnalysis = z.infer<typeof progressAnalysisSchema>
export type ProgressMailPurpose = 'appointment' | 'reminder' | 'feedback' | 'entry'
export const progressMessageInputSchema = z.object({ documentId: z.string().uuid(), reviewId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(), purpose: z.enum(['appointment','reminder','feedback','entry']),
  lang: z.enum(['zh','ja']), recipient: z.enum(['person','client']), text: z.string().max(14000).optional() }).strict()
export type ProgressMessageInput = z.infer<typeof progressMessageInputSchema>
export interface BusinessProgressMail {
  id: string; followUpId: string | null; suggestedFollowUpIds: string[]; subject: string; body: string
  receivedAt: string; kind: 'schedule' | 'feedback' | 'entry'; state: 'pending' | 'applied' | 'dismissed'
}

export function nextBusinessRound(progress?: BusinessProgress): number {
  const latest = progress?.rounds.at(-1)
  return !latest ? 1 : progress?.stage === 'next-round' ? latest.roundNumber + 1 : latest.roundNumber
}

/** Stage labels and reminders follow recorded facts; elapsed time never implies attendance or a result. */
export function businessProgressStep(item: BusinessFollowUp, now = new Date(), zh = true): { stage: BusinessProgressStage; label: string; action: string; due: boolean; when: string | null } {
  const progress = item.progress
  let stage = progress?.stage ?? (item.status === 'closed' ? 'closed' : 'coordinating')
  const latest = progress?.rounds.at(-1)
  if (stage === 'scheduled' && latest?.scheduledAt && Date.parse(latest.scheduledAt) + latest.durationMinutes * 60000 <= now.getTime()) stage = 'feedback'
  const roundNumber = nextBusinessRound(progress)
  const labels: Record<BusinessProgressStage, [string,string,string,string]> = {
    coordinating: ['待约面','日程調整中','安排面试','面談を予約'],
    scheduled: [`${latest?.roundNumber ?? 1} 面已预约`,`${latest?.roundNumber ?? 1} 次面談を予約済み`,'查看面试安排','面談予定を見る'],
    feedback: ['待面试反馈','面談結果待ち','记录面试结果','面談結果を記録'],
    'next-round': [`待安排 ${roundNumber} 面`,`${roundNumber} 次面談の調整待ち`,'安排下一轮','次の面談を予約'],
    'next-decision': ['本轮通过，后续待定','今回通過・次の対応を確認','确认下一步','次の対応を確認'],
    entry: ['待进场','参画準備中','安排进场','参画を手配'],
    started: ['已进场','参画済み','查看进场记录','参画記録を見る'],
    paused: ['已暂停','保留中','继续推进','対応を再開'],
    closed: ['已结束','終了','查看记录','記録を見る']
  }
  const label = labels[stage]
  const when = stage === 'entry' ? progress?.entry.plannedDate || null : stage === 'scheduled' || stage === 'feedback' ? latest?.scheduledAt ?? null : null
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit' }).format(now)
  const due = stage === 'feedback' || stage === 'next-round' || stage === 'next-decision' || stage === 'coordinating'
    || (stage === 'scheduled' && Boolean(when) && Date.parse(when!) <= now.getTime() + 24 * 3600000)
    || (stage === 'entry' && Boolean(when) && when! <= today)
  return { stage, label: label[zh ? 0 : 1], action: label[zh ? 2 : 3], due, when }
}

export function interviewScheduleConflict(input: { sourceDocumentId: string; scheduledAt: string; durationMinutes: number; interviewer: string | null }, other: CandidateInterviewSnapshot): boolean {
  if (!other.scheduledAt || other.decision || other.stage === 'closed') return false
  if (input.sourceDocumentId !== other.sourceDocumentId && !(input.interviewer?.trim() && input.interviewer.trim().toLowerCase() === other.interviewer?.trim().toLowerCase())) return false
  const a = Date.parse(input.scheduledAt), b = Date.parse(other.scheduledAt)
  return a < b + other.durationMinutes * 60000 && b < a + input.durationMinutes * 60000
}
