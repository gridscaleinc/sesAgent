import { candidateInterviewQuestionSchema } from './schemas'
import { z } from 'zod'
import type { BusinessFollowUp } from './business-workbench'
import type { CandidateInterviewSnapshot } from './contracts'

/** Stages live inside the follow-up JSON payload; adding one needs no schema migration and old values stay valid. */
export const businessProgressStages = [
  'recommended',
  'coordinating',
  'scheduled',
  'feedback',
  'next-round',
  'next-decision',
  'entry',
  'started',
  /** 退场: the placement ended on entry.leftDate; kept as history. */
  'ended',
  'paused',
  'closed'
] as const
export type BusinessProgressStage = (typeof businessProgressStages)[number]
/** Stages where nothing is being arranged any more: in place, left, paused or closed. */
export const inactiveProgressStages: readonly BusinessProgressStage[] = ['started', 'ended', 'paused', 'closed']
export const isInactiveProgressStage = (stage: string | undefined | null) =>
  (inactiveProgressStages as readonly string[]).includes(stage ?? '')
const line = z.string().trim().max(1000)
export const progressEntrySchema = z
  .object({
    plannedDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .or(z.literal('')),
    rate: line,
    workStyle: line,
    location: line,
    reportTime: line,
    contact: line,
    materials: line,
    candidateAccepted: z.boolean(),
    termsAgreed: z.boolean(),
    actualDate: z.string().nullable(),
    /** 退场日: the last working day, set when the placement ends. */
    leftDate: z.string().nullable().optional()
  })
  .strict()
export type ProgressEntry = z.infer<typeof progressEntrySchema>
export const emptyProgressEntry = (): ProgressEntry => ({
  plannedDate: '',
  rate: '',
  workStyle: '',
  location: '',
  reportTime: '',
  contact: '',
  materials: '',
  candidateAccepted: false,
  termsAgreed: false,
  actualDate: null
})
export interface BusinessProgress {
  stage: BusinessProgressStage
  resumeStage?: BusinessProgressStage
  /** When HR recorded that this person was introduced to the case; absent on follow-ups started before the stage existed. */
  recommendedAt?: string
  previousBusinessStatus?: 'available' | 'soon' | 'assigned' | 'paused'
  /** Paused because the person started work through this other follow-up; undoing that start resumes it. */
  pausedByPlacement?: string
  /** Ended together with its case (结束案件 · 一并结束跟进): reactivating the case brings it back. */
  closedWithCase?: boolean
  candidateAvailability: string
  clientAvailability: string
  pendingConditions: string[]
  entry: ProgressEntry
  rounds: CandidateInterviewSnapshot[]
}

export const beginBusinessProgressSchema = z
  .array(
    z
      .object({
        documentId: z.string().uuid(),
        reviewId: z.string().uuid(),
        pendingConditions: z.array(z.string().trim().min(1).max(1000)).max(40).optional()
      })
      .strict()
  )
  .min(1)
  .max(30)
export type BeginBusinessProgressInput = z.infer<typeof beginBusinessProgressSchema>

const pair = {
  documentId: z.string().uuid(),
  reviewId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  mutationId: z.string().uuid(),
  sourceMessageId: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional()
}
const round = z.number().int().min(1).max(20)
const schedule = z
  .object({
    roundNumber: round,
    scheduledAt: z.string().datetime().or(z.literal('')),
    durationMinutes: z.number().int().min(5).max(480),
    meetingMethod: z.enum(['zoom', 'google-meet', 'phone', 'onsite']),
    meetingUrl: z.string(),
    location: z.string(),
    interviewer: z.string(),
    note: z.string()
  })
  .strict()
export type ProgressSchedule = z.infer<typeof schedule>
export const advanceBusinessProgressSchema = z.discriminatedUnion('action', [
  z
    .object({
      ...pair,
      action: z.literal('coordinate'),
      candidateAvailability: z.string(),
      clientAvailability: z.string(),
      pendingConditions: z.array(z.string())
    })
    .strict(),
  /** Records that the introduction was sent. Creates the follow-up if needed; a follow-up already past this point is left unchanged. */
  z.object({ ...pair, action: z.literal('recommend') }).strict(),
  /** allowConflict: HR saw the overlap with another interview and saves anyway. */
  z.object({ ...pair, action: z.literal('schedule'), schedule, allowConflict: z.boolean().optional() }).strict(),
  z.object({ ...pair, action: z.literal('rebook'), schedule, reason: line.min(1), allowConflict: z.boolean().optional() }).strict(),
  z.object({ ...pair, action: z.literal('cancel-schedule'), reason: line.min(1) }).strict(),
  z.object({ ...pair, action: z.literal('correct-entry'), entry: progressEntrySchema, reason: line.min(1) }).strict(),
  z.object({ ...pair, action: z.literal('undo-start'), reason: line.min(1) }).strict(),
  /** 退场: the placement ended on leftDate; the person is available again unless placed elsewhere. */
  z
    .object({
      ...pair,
      action: z.literal('leave'),
      leftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
      reason: line,
      /** Also resumes the person's follow-ups this placement paused at 确认已到岗. */
      resumePaused: z.boolean().optional()
    })
    .strict(),
  z.object({ ...pair, action: z.literal('undo-leave'), reason: line.min(1) }).strict(),
  /** After 退场: the same person for the same case again (the client wants them back). History stays in the events. */
  z.object({ ...pair, action: z.literal('restart'), reason: line.min(1) }).strict(),
  z
    .object({
      ...pair,
      action: z.literal('prepare'),
      roundNumber: round,
      questions: z.array(candidateInterviewQuestionSchema).min(1).max(40)
    })
    .strict(),
  z
    .object({
      ...pair,
      action: z.literal('feedback'),
      roundNumber: round,
      notes: z.string().trim().min(1).max(8000),
      result: z.enum(['pending', 'passed', 'failed', 'no-show', 'withdrawn']),
      next: z.enum(['unknown', 'next-round', 'entry']),
      unresolved: z.array(z.string().trim().min(1).max(300)).max(20)
    })
    .strict(),
  z.object({ ...pair, action: z.literal('entry'), entry: progressEntrySchema }).strict(),
  z
    .object({
      ...pair,
      action: z.literal('start'),
      actualDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
      /** Also pause this person's other open follow-ups; HR may leave them running to decide case by case. */
      pauseOthers: z.boolean().optional()
    })
    .strict(),
  z.object({ ...pair, action: z.literal('note'), note: z.string().trim().min(1).max(2000) }).strict(),
  z
    .object({
      ...pair,
      action: z.literal('pause'),
      reason: z.string().trim().min(1).max(1000),
      /** Set when Main pauses it because the person started work through that follow-up. */
      placementId: z.string().uuid().optional()
    })
    .strict(),
  z
    .object({
      ...pair,
      action: z.literal('close'),
      reason: z.string().trim().min(1).max(1000),
      /** Ended because the case ended: resumed when the case is active again. */
      withCase: z.boolean().optional()
    })
    .strict(),
  z.object({ ...pair, action: z.literal('resume') }).strict(),
  z.object({ ...pair, action: z.literal('link-interview'), interviewId: z.string().uuid() }).strict()
])
export type AdvanceBusinessProgressInput = z.infer<typeof advanceBusinessProgressSchema>
/** The start of the error a schedule overlapping another interview gets; the UI offers 「仍然保存」 on it. */
export const scheduleConflictMessage = '时间冲突'
/** Removes one follow-up (a duplicate or mistaken pairing) with its rounds and linked progress mail; the person and the case stay. */
export const deleteBusinessFollowUpSchema = z
  .object({ followUpId: z.string().uuid(), expectedRevision: z.number().int().nonnegative() })
  .strict()
export type DeleteBusinessFollowUpInput = z.infer<typeof deleteBusinessFollowUpSchema>
export interface DeleteBusinessFollowUpResult {
  deletedId: string
  rounds: number
  mails: number
}
export type ProgressCommand = AdvanceBusinessProgressInput extends infer T
  ? T extends AdvanceBusinessProgressInput
    ? Omit<T, keyof typeof pair>
    : never
  : never

export const analyzeBusinessProgressSchema = z
  .object({
    documentId: z.string().uuid(),
    reviewId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    roundNumber: round.optional(),
    text: z.string().trim().min(1).max(12000),
    lang: z.enum(['zh', 'ja'])
  })
  .strict()
export type AnalyzeBusinessProgressInput = z.infer<typeof analyzeBusinessProgressSchema>
export const progressAnalysisSchema = z
  .object({
    summary: z.string().max(2000),
    kind: z.enum(['schedule', 'feedback', 'entry', 'other']),
    evidence: z.string().max(2000),
    roundNumber: round.nullable(),
    result: z.enum(['pending', 'passed', 'failed', 'no-show', 'withdrawn']),
    next: z.enum(['unknown', 'next-round', 'entry']),
    scheduledAt: z.string().datetime().nullable(),
    candidateAvailability: line,
    clientAvailability: line,
    proposedTimes: z.array(z.string().datetime()).max(8),
    unresolved: z.array(z.string().max(300)).max(20),
    plannedDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .nullable()
  })
  .strict()
export type ProgressAnalysis = z.infer<typeof progressAnalysisSchema>
export type ProgressMailPurpose = 'appointment' | 'reminder' | 'feedback' | 'entry'
export const progressMessageInputSchema = z
  .object({
    documentId: z.string().uuid(),
    reviewId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    purpose: z.enum(['appointment', 'reminder', 'feedback', 'entry']),
    lang: z.enum(['zh', 'ja']),
    recipient: z.enum(['person', 'client']),
    text: z.string().max(14000).optional()
  })
  .strict()
export type ProgressMessageInput = z.infer<typeof progressMessageInputSchema>
/** Links captured progress mail to a follow-up or settles it; mirrors the check in the business-progress store. */
export const updateBusinessProgressMailSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/u),
    followUpId: z.string().uuid().optional(),
    /** 'pending' undoes a 忽略. */
    state: z.enum(['applied', 'dismissed', 'pending']).optional()
  })
  .strict()
export interface BusinessProgressMail {
  id: string
  followUpId: string | null
  suggestedFollowUpIds: string[]
  subject: string
  body: string
  receivedAt: string
  kind: 'schedule' | 'feedback' | 'entry'
  state: 'pending' | 'applied' | 'dismissed'
}

export function nextBusinessRound(progress?: BusinessProgress): number {
  const latest = progress?.rounds.at(-1)
  // A round with its result recorded is done: the next booking is the round after it (also after 重新开始跟进).
  return !latest ? 1 : progress?.stage === 'next-round' || latest.decision ? latest.roundNumber + 1 : latest.roundNumber
}

/** Days after a recommendation with no further step before the follow-up asks HR to check with the client. */
export const recommendationFollowUpDays = 7

/** Stage labels and reminders follow recorded facts; elapsed time never implies attendance or a result. */
export function businessProgressStep(
  item: BusinessFollowUp,
  now = new Date(),
  zh = true
): { stage: BusinessProgressStage; label: string; action: string; due: boolean; when: string | null } {
  const progress = item.progress
  let stage = progress?.stage ?? (item.status === 'closed' ? 'closed' : 'coordinating')
  const latest = progress?.rounds.at(-1)
  if (stage === 'scheduled' && latest?.scheduledAt && Date.parse(latest.scheduledAt) + latest.durationMinutes * 60000 <= now.getTime())
    stage = 'feedback'
  const roundNumber = nextBusinessRound(progress)
  const labels: Record<BusinessProgressStage, [string, string, string, string]> = {
    recommended: ['已推荐', '推薦済み', '安排面试', '面談を調整'],
    coordinating: ['待约面', '日程調整中', '安排面试', '面談を予約'],
    scheduled: [`${latest?.roundNumber ?? 1} 面已预约`, `${latest?.roundNumber ?? 1} 次面談を予約済み`, '查看面试安排', '面談予定を見る'],
    feedback: ['待面试反馈', '面談結果待ち', '记录面试结果', '面談結果を記録'],
    'next-round': [`待安排 ${roundNumber} 面`, `${roundNumber} 次面談の調整待ち`, '安排下一轮', '次の面談を予約'],
    'next-decision': [
      latest?.decision === 'passed' ? '本轮通过，后续待定' : '待确认后续安排',
      latest?.decision === 'passed' ? '今回通過・次の対応を確認' : '次の対応を確認待ち',
      '确认下一步',
      '次の対応を確認'
    ],
    entry: ['待进场', '参画準備中', '安排进场', '参画を手配'],
    started: ['已进场', '参画済み', '查看进场记录', '参画記録を見る'],
    ended: ['已退场', '退場済み', '查看进退场记录', '参画・退場記録を見る'],
    paused: ['已暂停', '保留中', '继续推进', '対応を再開'],
    closed: ['已结束', '終了', '查看记录', '記録を見る']
  }
  const label = labels[stage]
  const when =
    stage === 'recommended'
      ? (progress?.recommendedAt ?? null)
      : stage === 'entry'
        ? progress?.entry.plannedDate || null
        : stage === 'ended'
          ? progress?.entry.leftDate || null
          : stage === 'scheduled' || stage === 'feedback'
            ? (latest?.scheduledAt ?? null)
            : null
  const tokyoDay = (at: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  const today = tokyoDay(now)
  // Recommended a week ago with no reply recorded: time to ask the client.
  const awaitingReply =
    stage === 'recommended' && Boolean(when) && now.getTime() - Date.parse(when!) >= recommendationFollowUpDays * 86_400_000
  const due =
    awaitingReply ||
    stage === 'feedback' ||
    stage === 'next-round' ||
    stage === 'next-decision' ||
    stage === 'coordinating' ||
    // An interview is today's work on its Tokyo day, not a day early because it falls within 24 hours.
    (stage === 'scheduled' && Boolean(when) && tokyoDay(new Date(when!)) <= today) ||
    // 待进场 is due on its planned day, and at once while that day is not written down yet.
    (stage === 'entry' && (!when || when <= today))
  const action = awaitingReply
    ? zh
      ? '确认客户回复'
      : '顧客の回答を確認'
    : stage === 'entry' && !when
      ? zh
        ? '填写入场日期'
        : '参画日を記入'
      : label[zh ? 2 : 3]
  return { stage, label: label[zh ? 0 : 1], action, due, when }
}

/**
 * Why a follow-up still being arranged cannot move: the person is not being offered (暂停营业) or the case ended.
 * Such a follow-up is not due anywhere (今天要做, 今天, the menu bar); HR pauses or ends it instead.
 */
export function followUpBlock(
  row: Pick<BusinessFollowUp, 'progress' | 'status'>,
  context: { personStatus?: string | null; caseLifecycle?: string | null; hrRejected?: boolean }
): 'person-paused' | 'case-ended' | 'person-assigned' | 'hr-rejected' | null {
  const stage = row.progress?.stage ?? (row.status === 'closed' ? 'closed' : 'coordinating')
  if (isInactiveProgressStage(stage)) return null
  // 待进场 still moves after the case is closed to new people: the person agreed and starts on the date.
  if (context.caseLifecycle === 'archived' && stage !== 'entry') return 'case-ended'
  if (context.personStatus === 'paused') return 'person-paused'
  // HR judged the pair 不满足: nothing is proposed or booked any more; HR withdraws the judgement or ends it.
  if (context.hrRejected && stage !== 'entry') return 'hr-rejected'
  // In place elsewhere (已进场): no new interview is booked until HR marks 近期可入场.
  if (context.personStatus === 'assigned' && ['recommended', 'coordinating', 'next-round'].includes(stage)) return 'person-assigned'
  return null
}

export function interviewScheduleConflict(
  input: { sourceDocumentId: string; scheduledAt: string; durationMinutes: number; interviewer: string | null },
  other: CandidateInterviewSnapshot
): boolean {
  if (!other.scheduledAt || other.decision || other.stage === 'closed') return false
  if (
    input.sourceDocumentId !== other.sourceDocumentId &&
    !(input.interviewer?.trim() && input.interviewer.trim().toLowerCase() === other.interviewer?.trim().toLowerCase())
  )
    return false
  const a = Date.parse(input.scheduledAt),
    b = Date.parse(other.scheduledAt)
  return a < b + other.durationMinutes * 60000 && b < a + input.durationMinutes * 60000
}

/**
 * The interview that already holds this time, if any. Interviews of follow-ups that are over, or back to 待约面
 * (their old time no longer shown anywhere), hold no time. Shared by 跟进, 招聘面试 and the schedule center.
 */
export function scheduleClash(
  input: { id?: string | null; sourceDocumentId: string; scheduledAt: string; durationMinutes: number; interviewer: string | null },
  interviews: CandidateInterviewSnapshot[],
  followUps: Array<Pick<BusinessFollowUp, 'id' | 'progress'>>
): CandidateInterviewSnapshot | undefined {
  const freed = new Set(
    followUps.filter((row) => isInactiveProgressStage(row.progress?.stage) || row.progress?.stage === 'coordinating').map((row) => row.id)
  )
  return interviews.find(
    (other) => other.id !== input.id && !freed.has(other.businessFollowUpId ?? '') && interviewScheduleConflict(input, other)
  )
}

/** The bilingual refusal for an overlapping interview; it starts with {@link scheduleConflictMessage}. */
export function scheduleConflictText(scheduledAt: string): string {
  const at = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
    .formatToParts(new Date(scheduledAt))
    .reduce<Record<string, string>>((parts, part) => ({ ...parts, [part.type]: part.value }), {})
  const time = `${at.month}/${at.day} ${at.hour}:${at.minute}`
  return `${scheduleConflictMessage}：这个时间和另一场面试重叠（${time}）。确认无误可选择「仍然保存」。 / 時間の重複：別の面談（${time}）と重なっています。問題なければ「このまま保存」を選んでください。`
}
