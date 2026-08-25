import { z } from 'zod'
import { workTaskTypes } from '@domain'
import {
  candidateFieldKeys,
  candidateInterviewDecisions,
  candidateInterviewKinds,
  candidateInterviewQuestionSources,
  candidateInterviewStages,
  candidateMatchFeedbackReasonCodes,
  candidateMatchSuitableReasonCodes,
  candidateMatchUnsuitableReasonCodes,
  jobCaseFieldKeys,
  applicationLocales,
  proposalFollowUpStages
} from './contracts'

const taskStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'blocked'])
})

export const resolveActionApprovalInputSchema = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(['approve', 'deny'])
}).strict()

const dataScopeSchema = z.object({
  id: z.enum(['confirmed-candidate-pool', 'selected-files', 'selected-gmail-message', 'selected-case']),
  label: z.string().min(1),
  detail: z.string().min(1)
})

const privacyPolicySchema = z.object({
  policyVersion: z.string().min(1),
  cloudDirectIdentifiers: z.literal('blocked'),
  cloudPayload: z.literal('redacted-only'),
  automaticSending: z.literal(false)
})

const contextBindingSchema = z.object({
  objectType: z.enum(['staged-file', 'candidate-pool', 'gmail-message', 'job-case']),
  objectId: z.string().min(1),
  version: z.string().min(1)
})

const workTaskMessageSchema = z.object({
  id: z.string().min(1).max(120),
  role: z.enum(['user', 'assistant', 'system']),
  kind: z.enum(['instruction', 'plan', 'status', 'review', 'completion', 'error']),
  content: z.string().min(1).max(2_000),
  createdAt: z.string().datetime()
})

const approvalGateSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(160),
  status: z.enum(['required', 'approved']),
  approvedBy: z.string().min(1).max(120).nullable(),
  approvedAt: z.string().datetime().nullable()
}).superRefine((gate, context) => {
  const complete = gate.approvedBy !== null && gate.approvedAt !== null
  if ((gate.status === 'approved') !== complete) {
    context.addIssue({ code: 'custom', message: '承認済みゲートには承認者と承認日時が必要です。' })
  }
})

const workTaskArtifactSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.enum(['candidate-profile', 'candidate-match-results', 'proposal-draft', 'proposal-package', 'job-case-draft']),
  label: z.string().min(1).max(180),
  status: z.enum(['available', 'exported', 'superseded']),
  objectId: z.string().min(1).max(180).nullable(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  containsDirectIdentifiers: z.literal(false),
  createdAt: z.string().datetime()
})

const toolAuditSchema = z.object({
  id: z.string().min(1).max(120),
  action: z.string().regex(/^[a-z][a-z0-9.-]{1,79}$/u),
  decision: z.enum(['executed', 'blocked']),
  dataScopeId: dataScopeSchema.shape.id,
  externalSideEffect: z.enum(['none', 'local-write', 'file-export']),
  cloudPayload: z.enum(['none', 'redacted-only']),
  evidenceCount: z.number().int().nonnegative(),
  reason: z.string().min(1).max(500),
  createdAt: z.string().datetime()
})

export const workTaskSchema = z.object({
  id: z.string().min(1),
  type: z.enum(workTaskTypes),
  typeLabel: z.string().min(1),
  title: z.string().min(1),
  instruction: z.string().min(8).max(2000),
  scope: dataScopeSchema,
  steps: z.array(taskStepSchema).min(1),
  requiredApprovals: z.array(z.string().min(1)),
  privacy: privacyPolicySchema,
  contextBindings: z.array(contextBindingSchema).default([]),
  status: z.enum(['awaiting_input', 'planned', 'running', 'awaiting_review', 'completed', 'cancelled', 'failed']),
  progress: z.number().min(0).max(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  evidenceCount: z.number().int().nonnegative(),
  messages: z.array(workTaskMessageSchema).max(200).default([]),
  approvalGates: z.array(approvalGateSchema).max(20).default([]),
  artifacts: z.array(workTaskArtifactSchema).max(100).default([]),
  toolAudits: z.array(toolAuditSchema).max(500).default([])
})

export const workTaskInputSchema = z.object({
  instruction: z.string().trim().min(8).max(2000),
  scopeId: z
    .enum(['confirmed-candidate-pool', 'selected-files', 'selected-gmail-message', 'selected-case'])
    .default('confirmed-candidate-pool'),
  fileTokens: z.array(z.string().uuid()).max(10).default([]),
  jobCaseId: z.string().uuid().optional()
}).strict()

export const createWorkTaskInputSchema = workTaskInputSchema.extend({
  previewHash: z.string().regex(/^[a-f0-9]{64}$/)
})

export const setWorkTaskLifecycleInputSchema = z.object({
  taskId: z.string().min(1).max(128),
  action: z.enum(['cancel', 'retry']),
  expectedUpdatedAt: z.string().datetime()
})

export const processingJobSummarySchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['candidate-match', 'resume-analysis', 'proposal-export']),
  workTaskId: z.string().min(1).max(128),
  taskStepId: z.string().min(1).max(128),
  status: z.enum(['queued', 'running', 'succeeded', 'retry_wait', 'failed', 'cancelled']),
  replayPolicy: z.enum(['safe-local', 'manual-review']),
  progress: z.number().int().min(0).max(100),
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().min(1).max(10),
  nextRetryAt: z.string().datetime().nullable(),
  leaseExpiresAt: z.string().datetime().nullable(),
  cancelRequestedAt: z.string().datetime().nullable(),
  errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/u).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

export const enqueueProcessingJobInputSchema = z.object({
  type: z.enum(['candidate-match', 'resume-analysis', 'proposal-export']),
  workTaskId: z.string().min(1).max(128),
  taskStepId: z.string().min(1).max(128),
  idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/u),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  payloadRef: z.string().min(1).max(256),
  replayPolicy: z.enum(['safe-local', 'manual-review']),
  maxAttempts: z.number().int().min(1).max(10).default(3)
})

export const stagedLocalFileSchema = z.object({
  token: z.string().uuid(),
  name: z.string().min(1).max(180),
  format: z.enum(['pdf', 'docx', 'xlsx', 'xls', 'xlsb']),
  size: z.number().int().positive().max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
  privacyStatus: z.literal('awaiting-local-scan')
})

/**
 * Files dropped into the conversation. The renderer supplies bytes and a
 * declared name; the main process decides the real format from the bytes and
 * keeps the name only as a display label.
 */
export const stageDroppedResumeFilesInputSchema = z.object({
  files: z.array(z.object({
    name: z.string().min(1).max(180),
    bytes: z.instanceof(Uint8Array)
  })).min(1).max(10)
}).strict()

export const previewStagedResumeFileInputSchema = z.object({
  fileToken: z.string().uuid()
}).strict()

export const analyzeResumeFileInputSchema = z.object({
  fileToken: z.string().uuid(),
  taskId: z.string().min(1).max(128),
  /** Set when the import came from a conversation, so that turn can refer to it. */
  conversationId: z.string().uuid().optional()
})

export const resumeAnalysisSummarySchema = z.object({
  analysisVersion: z.enum(['resume-analysis-v1', 'resume-analysis-v2', 'resume-analysis-v3', 'resume-analysis-v4', 'resume-analysis-v5', 'resume-analysis-v6']).default('resume-analysis-v1'),
  fileToken: z.string().uuid(),
  fileName: z.string().min(1).max(180),
  status: z.enum(['requires-pii-review', 'requires-local-ocr', 'ready-for-field-review']),
  cloudEligible: z.literal(false),
  statistics: z.object({
    pages: z.number().int().nonnegative(),
    sheets: z.number().int().nonnegative(),
    blocks: z.number().int().nonnegative(),
    characters: z.number().int().nonnegative()
  }),
  detectedIdentifiers: z.array(z.object({ type: z.string().min(1), count: z.number().int().positive() })),
  localProcessing: z
    .object({
      ocr: z.enum(['not-required', 'apple-vision-completed', 'windows-media-ocr-completed', 'windows-tesseract-wasm-completed', 'requires-local-ocr']),
      ocrPages: z.number().int().nonnegative(),
      personNameCandidates: z.number().int().nonnegative(),
      networkAccess: z.literal(false)
    })
    .default({ ocr: 'not-required', ocrPages: 0, personNameCandidates: 0, networkAccess: false }),
  extractedFields: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        value: z.string().nullable(),
        confidence: z.number().min(0).max(1),
        status: z.enum(['needs_review', 'missing']),
        sourceLabels: z.array(z.string().min(1))
      })
    )
    .default([]),
  extractedProjectExperiences: z.array(z.object({
    draftId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u),
    title: z.string().min(1).max(160),
    period: z.string().min(1).max(120).nullable(),
    role: z.string().min(1).max(120).nullable(),
    technologies: z.array(z.string().min(1).max(80)).max(40),
    summary: z.string().min(1).max(1_500),
    confidence: z.number().min(0).max(1),
    sourceLabels: z.array(z.string().min(1).max(180)).max(100)
  })).max(20).default([]),
  warningCodes: z.array(z.string().min(1)),
  redactedPreview: z.string().max(4000),
  analyzedAt: z.string().datetime()
})

export const candidateReviewFieldSnapshotSchema = z.object({
  key: z.enum(candidateFieldKeys),
  label: z.string().min(1).max(80),
  originalValue: z.string().max(500).nullable(),
  value: z.string().max(500).nullable(),
  confidence: z.number().min(0).max(1),
  status: z.enum(['needs_review', 'missing', 'confirmed']),
  sourceLabels: z.array(z.string().min(1).max(180)),
  changed: z.boolean(),
  changeReason: z.string().max(300).nullable()
})

export const candidateProjectExperienceSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  period: z.string().trim().min(1).max(120).nullable(),
  role: z.string().trim().min(1).max(120).nullable(),
  technologies: z.array(z.string().trim().min(1).max(80)).max(40),
  summary: z.string().trim().min(1).max(1_500),
  sourceLabels: z.array(z.string().min(1).max(180)).max(100)
})

export const candidateProjectReviewSnapshotSchema = z.object({
  draftId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u),
  title: z.string().min(1).max(160),
  period: z.string().min(1).max(120).nullable(),
  role: z.string().min(1).max(120).nullable(),
  technologies: z.array(z.string().min(1).max(80)).max(40),
  summary: z.string().min(1).max(1_500),
  confidence: z.number().min(0).max(1),
  sourceLabels: z.array(z.string().min(1).max(180)).max(100),
  changed: z.boolean(),
  changeReason: z.string().max(300).nullable()
})

export const candidateProfileSummarySchema = z.object({
  id: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
  version: z.number().int().positive(),
  status: z.enum(['current', 'stale', 'superseded']),
  confirmedAt: z.string().datetime(),
  confirmedBy: z.string().min(1).max(120),
  containsDirectIdentifiers: z.boolean()
})

export const localCandidatePersonalDetailsSchema = z.object({
  displayName: z.string().min(1).max(120).nullable(),
  gender: z.string().min(1).max(40).nullable(),
  birthDate: z.string().min(1).max(80).nullable(),
  nationality: z.string().min(1).max(80).nullable(),
  phone: z.string().min(1).max(80).nullable(),
  email: z.string().min(1).max(200).nullable(),
  address: z.string().min(1).max(500).nullable(),
  education: z.string().min(1).max(300).nullable(),
  major: z.string().min(1).max(200).nullable(),
  graduationDate: z.string().min(1).max(80).nullable(),
  degree: z.string().min(1).max(120).nullable()
})

export const localCandidateIdentitySummarySchema = localCandidatePersonalDetailsSchema.extend({
  storage: z.literal('encrypted-local-only'),
  cloudEligible: z.literal(false)
})

export const candidateReviewSnapshotSchema = z.object({
  documentId: z.string().uuid(),
  fileName: z.string().min(1).max(180),
  reviewRevision: z.number().int().positive(),
  status: z.enum(['awaiting-review', 'completed']),
  piiReviewed: z.boolean(),
  localIdentity: localCandidateIdentitySummarySchema.optional(),
  fields: z.array(candidateReviewFieldSnapshotSchema),
  projectExperiences: z.array(candidateProjectReviewSnapshotSchema).max(20).default([]),
  completedAt: z.string().datetime().nullable(),
  reviewerDisplayName: z.string().min(1).max(120).nullable(),
  profile: candidateProfileSummarySchema.nullable(),
  recruitingStatus: z.enum(['pending-review', 'ready-for-recruiting', 'recruiting', 'passed', 'rejected', 'withdrawn', 'no-show', 'on-hold']),
  talentPoolStatus: z.enum(['none', 'eligible', 'suspended', 'removed']),
  recordStatus: z.enum(['active', 'archived', 'deleted'])
})

const candidateInterviewStageSchema = z.enum(candidateInterviewStages)
const candidateInterviewDecisionSchema = z.enum(candidateInterviewDecisions)
const candidateInterviewKindSchema = z.enum(candidateInterviewKinds)
const candidateInterviewMethodSchema = z.enum(['zoom', 'google-meet', 'phone', 'onsite'])
const candidateInterviewDurationSchema = z.number().int().min(5).max(480)

const candidateInterviewQuestionSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u),
  text: z.string().trim().min(2).max(500),
  source: z.enum(candidateInterviewQuestionSources),
  sourceLabel: z.string().trim().min(1).max(160).nullable(),
  selected: z.boolean()
})

function isAllowedZoomMeetingUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const host = url.hostname.toLocaleLowerCase('en-US')
    return url.protocol === 'https:' && (host === 'zoom.us' || host.endsWith('.zoom.us'))
  } catch {
    return false
  }
}

function isAllowedGoogleMeetUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const host = url.hostname.toLocaleLowerCase('en-US')
    return url.protocol === 'https:' && (host === 'meet.google.com' || host.endsWith('.meet.google.com'))
  } catch {
    return false
  }
}

export interface AllowedInterviewMeetingLink {
  method: 'zoom' | 'google-meet'
  url: string
}

const httpsUrlInTextPattern = /https:\/\/[^\s<>"']+/giu
const trailingUrlPunctuationPattern = /[，。；：！？、）\)\]\}】》]+$/u

/**
 * Extract only meeting links already accepted by the manual interview flow.
 * The original URL is preserved for the encrypted local record; callers must
 * never log it because query parameters can contain meeting passwords.
 */
export function extractAllowedInterviewMeetingLinks(value: string): AllowedInterviewMeetingLink[] {
  const links: AllowedInterviewMeetingLink[] = []
  const seen = new Set<string>()
  for (const match of value.matchAll(httpsUrlInTextPattern)) {
    const candidate = match[0].replace(trailingUrlPunctuationPattern, '')
    if (!candidate || candidate.length > 1_000 || seen.has(candidate)) continue
    const method = isAllowedZoomMeetingUrl(candidate)
      ? 'zoom' as const
      : isAllowedGoogleMeetUrl(candidate)
        ? 'google-meet' as const
        : null
    if (!method) continue
    seen.add(candidate)
    links.push({ method, url: candidate })
  }
  return links
}

/**
 * Meeting links stay in SQLCipher and must not enter planning or narrative
 * projections. The placeholder preserves only the business fact the planner
 * needs to choose a method and Tool.
 */
export function redactInterviewMeetingLinksForCloud(value: string): string {
  let redacted = value
  for (const link of extractAllowedInterviewMeetingLinks(value)) {
    const placeholder = link.method === 'zoom'
      ? '[ZOOM_MEETING_LINK_PROVIDED_LOCALLY]'
      : '[GOOGLE_MEET_LINK_PROVIDED_LOCALLY]'
    redacted = redacted.split(link.url).join(placeholder)
  }
  // Unknown or malformed URLs are not useful to the controlled Tool catalog
  // and may still carry access tokens. Keep them local as well.
  return redacted.replace(httpsUrlInTextPattern, '[URL_PROVIDED_LOCALLY]')
}

export const zoomMeetingUrlSchema = z.string().trim().min(1).max(1_000).refine(
  isAllowedZoomMeetingUrl,
  'Zoom 会议链接必须使用 zoom.us 的 HTTPS 地址。'
)

export const googleMeetUrlSchema = z.string().trim().min(1).max(1_000).refine(
  isAllowedGoogleMeetUrl,
  'Google Meet 链接必须使用 meet.google.com 的 HTTPS 地址。'
)

const meetingUrlSchema = z.string().trim().min(1).max(1_000).refine((value) => {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}, '会议链接必须使用 HTTPS 地址。')

export const openInterviewMeetingInputSchema = z.object({
  method: z.enum(['zoom', 'google-meet']),
  url: meetingUrlSchema
}).superRefine((input, context) => {
  if (input.method === 'zoom' && !isAllowedZoomMeetingUrl(input.url)) {
    context.addIssue({ code: 'custom', path: ['url'], message: 'Zoom 会议链接必须使用 zoom.us 的 HTTPS 地址。' })
  }
  if (input.method === 'google-meet' && !isAllowedGoogleMeetUrl(input.url)) {
    context.addIssue({ code: 'custom', path: ['url'], message: 'Google Meet 链接必须使用 meet.google.com 的 HTTPS 地址。' })
  }
})

const candidateInterviewMeetingDetailsSchema = z.object({
  phoneNumber: z.string().trim().min(1).max(120).optional(),
  phoneNote: z.string().trim().max(1_000).optional(),
  onsiteAddress: z.string().trim().min(1).max(500).optional(),
  onsiteMeetingPoint: z.string().trim().max(500).optional(),
  onsiteReceptionContact: z.string().trim().max(300).optional()
}).strict()

export const candidateInterviewSnapshotSchema = z.object({
  id: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
  kind: candidateInterviewKindSchema,
  roundNumber: z.number().int().positive().max(20),
  parentInterviewId: z.string().uuid().nullable(),
  stage: candidateInterviewStageSchema,
  scheduledAt: z.string().datetime().nullable(),
  durationMinutes: candidateInterviewDurationSchema,
  meetingMethod: candidateInterviewMethodSchema,
  meetingUrl: meetingUrlSchema.nullable(),
  meetingDetails: candidateInterviewMeetingDetailsSchema.optional(),
  interviewer: z.string().trim().min(1).max(120).nullable(),
  contactNote: z.string().trim().max(1_500).nullable(),
  interviewGoal: z.string().trim().max(1_000).nullable(),
  questionPlan: z.array(candidateInterviewQuestionSchema).max(40),
  interviewNotes: z.string().trim().max(8_000).nullable(),
  unresolvedItems: z.array(z.string().trim().min(1).max(300)).max(20),
  decision: candidateInterviewDecisionSchema.nullable(),
  decisionReason: z.string().trim().max(1_500).nullable(),
  decidedAt: z.string().datetime().nullable(),
  decidedBy: z.string().trim().min(1).max(120).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  updatedBy: z.string().trim().min(1).max(120),
  cloudEligible: z.literal(false)
}).superRefine((input, context) => {
  if (input.meetingMethod === 'zoom' && input.meetingUrl && !isAllowedZoomMeetingUrl(input.meetingUrl)) {
    context.addIssue({ code: 'custom', path: ['meetingUrl'], message: 'Zoom 会议链接必须使用 zoom.us 的 HTTPS 地址。' })
  }
  if (input.meetingMethod === 'google-meet' && input.meetingUrl && !isAllowedGoogleMeetUrl(input.meetingUrl)) {
    context.addIssue({ code: 'custom', path: ['meetingUrl'], message: 'Google Meet 链接必须使用 meet.google.com 的 HTTPS 地址。' })
  }
  if ((input.meetingMethod === 'phone' || input.meetingMethod === 'onsite') && input.meetingUrl) {
    context.addIssue({ code: 'custom', path: ['meetingUrl'], message: '电话或现场面试不能保存会议链接。' })
  }
})

export const saveCandidateInterviewScheduleInputSchema = z.object({
  interviewId: z.string().uuid().optional(),
  sourceDocumentId: z.string().uuid(),
  kind: candidateInterviewKindSchema.optional(),
  roundNumber: z.number().int().positive().max(20).optional(),
  parentInterviewId: z.string().uuid().optional(),
  scheduledAt: z.string().datetime(),
  durationMinutes: candidateInterviewDurationSchema,
  meetingMethod: candidateInterviewMethodSchema,
  meetingUrl: meetingUrlSchema.optional(),
  meetingDetails: candidateInterviewMeetingDetailsSchema.optional(),
  interviewer: z.string().trim().min(1).max(120),
  contactNote: z.string().trim().max(1_500).optional()
}).superRefine((input, context) => {
  if (input.meetingMethod === 'zoom' && !input.meetingUrl) {
    context.addIssue({ code: 'custom', path: ['meetingUrl'], message: '安排 Zoom 面试时必须填写会议链接。' })
  }
  if (input.meetingMethod === 'zoom' && input.meetingUrl && !isAllowedZoomMeetingUrl(input.meetingUrl)) {
    context.addIssue({ code: 'custom', path: ['meetingUrl'], message: 'Zoom 会议链接必须使用 zoom.us 的 HTTPS 地址。' })
  }
  if (input.meetingMethod === 'google-meet' && !input.meetingUrl) {
    context.addIssue({ code: 'custom', path: ['meetingUrl'], message: '安排 Google Meet 面试时必须填写会议链接。' })
  }
  if (input.meetingMethod === 'google-meet' && input.meetingUrl && !isAllowedGoogleMeetUrl(input.meetingUrl)) {
    context.addIssue({ code: 'custom', path: ['meetingUrl'], message: 'Google Meet 链接必须使用 meet.google.com 的 HTTPS 地址。' })
  }
  if ((input.meetingMethod === 'phone' || input.meetingMethod === 'onsite') && input.meetingUrl) {
    context.addIssue({ code: 'custom', path: ['meetingUrl'], message: '电话或现场面试不能保存会议链接。' })
  }
})

export const createCandidateInterviewRoundInputSchema = z.object({
  sourceDocumentId: z.string().uuid(),
  parentInterviewId: z.string().uuid(),
  kind: candidateInterviewKindSchema.optional()
})

export const saveCandidateInterviewPreparationInputSchema = z.object({
  interviewId: z.string().uuid(),
  interviewGoal: z.string().trim().max(1_000).optional(),
  questions: z.array(candidateInterviewQuestionSchema).min(1).max(40),
  unresolvedItems: z.array(z.string().trim().min(1).max(300)).max(20).optional()
})

export const saveCandidateInterviewNotesInputSchema = z.object({
  interviewId: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
  interviewNotes: z.string().trim().max(8_000),
  unresolvedItems: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
  stage: z.enum(['interviewing', 'awaiting-decision']).optional()
})

export const recordCandidateInterviewDecisionInputSchema = z.object({
  interviewId: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
  decision: candidateInterviewDecisionSchema,
  decisionReason: z.string().trim().min(2).max(1_500)
})

export const submitCandidateReviewInputSchema = z.object({
  documentId: z.string().uuid(),
  reviewRevision: z.number().int().positive(),
  piiReviewed: z.boolean(),
  fields: z
    .array(
      z.object({
        key: z.enum(candidateFieldKeys),
        value: z.string().trim().min(1).max(500).nullable(),
        confirmed: z.literal(true),
        changeReason: z.string().trim().min(1).max(300).optional()
      })
    )
    .max(candidateFieldKeys.length),
  projectExperiences: z.array(z.object({
    draftId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u),
    title: z.string().trim().min(1).max(160),
    period: z.string().trim().min(1).max(120).nullable(),
    role: z.string().trim().min(1).max(120).nullable(),
    technologies: z.array(z.string().trim().min(1).max(80)).max(40),
    summary: z.string().trim().min(1).max(1_500),
    confirmed: z.literal(true)
  })).max(20).default([]),
  projectChangeReason: z.string().trim().min(1).max(300).optional()
})

export const searchCandidateProfilesInputSchema = z.object({
  query: z.string().trim().max(200).default(''),
  maxResults: z.number().int().min(1).max(100).default(30)
})

export const executeCandidateMatchTaskInputSchema = z.string().min(1).max(128)

const candidateMatchFeedbackDecisionSchema = z.enum(['suitable', 'unsuitable'])
const candidateMatchFeedbackReasonCodeSchema = z.enum(candidateMatchFeedbackReasonCodes)

export const submitCandidateMatchFeedbackInputSchema = z.object({
  matchResultId: z.string().uuid(),
  matchResultHash: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedRevision: z.number().int().nonnegative(),
  decision: candidateMatchFeedbackDecisionSchema,
  reasonCode: candidateMatchFeedbackReasonCodeSchema,
  note: z.string().trim().min(3).max(500).optional()
}).superRefine((input, context) => {
  const allowed = input.decision === 'suitable'
    ? candidateMatchSuitableReasonCodes
    : candidateMatchUnsuitableReasonCodes
  if (!(allowed as readonly string[]).includes(input.reasonCode)) {
    context.addIssue({
      code: 'custom',
      path: ['reasonCode'],
      message: '評価と理由の組み合わせが一致しません。'
    })
  }
  if (input.reasonCode === 'other' && !input.note) {
    context.addIssue({
      code: 'custom',
      path: ['note'],
      message: 'その他を選択した場合は補足を入力してください。'
    })
  }
})

export const candidateMatchFeedbackSnapshotSchema = z.object({
  decision: candidateMatchFeedbackDecisionSchema,
  reasonCode: candidateMatchFeedbackReasonCodeSchema,
  note: z.string().max(500).nullable(),
  reviewerDisplayName: z.string().min(1).max(120),
  revision: z.number().int().positive(),
  reviewedAt: z.string().datetime()
})

export const candidateMatchEvaluationSummarySchema = z.object({
  resultCount: z.number().int().nonnegative(),
  feedbackCount: z.number().int().nonnegative(),
  suitableCount: z.number().int().nonnegative(),
  unsuitableCount: z.number().int().nonnegative(),
  coveragePercent: z.number().min(0).max(100),
  judgedNdcgAt20: z.number().min(0).max(1).nullable(),
  recallAt20: z.null(),
  recallStatus: z.literal('requires-known-relevant-total')
})

export const candidateMatchRunSummarySchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().min(1).max(128),
  query: z.string().max(2_000),
  algorithmVersion: z.enum(['hard-filter-bm25-v1', 'hard-filter-hybrid-rrf-v1', 'hard-filter-hybrid-local-rerank-v1']),
  hardFilterPolicyVersion: z.enum(['fail-closed-v1', 'tri-state-v2', 'tri-state-v3']).default('fail-closed-v1'),
  resultSetHash: z.string().regex(/^[a-f0-9]{64}$/u),
  binding: z.object({
    jobCaseId: z.string().uuid(),
    jobCaseVersion: z.number().int().positive(),
    candidatePoolFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    candidateProfileVersions: z.array(z.object({
      id: z.string().uuid(),
      version: z.number().int().positive()
    })).max(10_000),
    embeddingModelId: z.string().min(1).max(200),
    embeddingModelRevision: z.string().min(1).max(200),
    rerankerModelId: z.string().min(1).max(200).nullable(),
    rerankerModelRevision: z.string().min(1).max(200).nullable(),
    policyVersion: z.literal('match-run-validity-v1')
  }).nullable(),
  createdAt: z.string().datetime(),
  evaluation: candidateMatchEvaluationSummarySchema
})

const anonymousCandidateLabelSchema = z.string().regex(/^候補者 [A-F0-9]{8}$/u)

const candidateEvaluationThresholdsSchema = z.object({
  minimumCases: z.number().int().min(30).max(100).default(30),
  recallAt20: z.number().min(0.5).max(1).default(0.9),
  ndcgAt20: z.number().min(0.3).max(1).default(0.75),
  projectEvidenceCoverageAt20: z.number().min(0).max(1).default(0.8)
})

export const sesCandidateBenchmarkSchema = z.object({
  version: z.literal('ses-candidate-benchmark-v1'),
  id: z.string().uuid(),
  name: z.string().trim().min(3).max(120),
  createdAt: z.string().datetime(),
  privacy: z.object({
    directIdentifiersRemoved: z.literal(true),
    rawResumeIncluded: z.literal(false),
    rawMailIncluded: z.literal(false)
  }),
  labeling: z.object({
    method: z.literal('ses-expert'),
    reviewerCount: z.number().int().min(1).max(20)
  }),
  thresholds: candidateEvaluationThresholdsSchema,
  cases: z.array(z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u),
    query: z.string().trim().min(2).max(500),
    relevantCandidateLabels: z.array(anonymousCandidateLabelSchema).min(1).max(100),
    expectedProjectEvidenceLabels: z.array(anonymousCandidateLabelSchema).max(100).default([])
  }).superRefine((testCase, context) => {
    const relevant = new Set(testCase.relevantCandidateLabels)
    if (relevant.size !== testCase.relevantCandidateLabels.length) {
      context.addIssue({ code: 'custom', path: ['relevantCandidateLabels'], message: '関連候補者番号が重複しています。' })
    }
    if (new Set(testCase.expectedProjectEvidenceLabels).size !== testCase.expectedProjectEvidenceLabels.length) {
      context.addIssue({ code: 'custom', path: ['expectedProjectEvidenceLabels'], message: 'プロジェクト証拠候補者番号が重複しています。' })
    }
    for (const label of testCase.expectedProjectEvidenceLabels) {
      if (!relevant.has(label)) {
        context.addIssue({ code: 'custom', path: ['expectedProjectEvidenceLabels'], message: 'プロジェクト証拠対象は関連候補者に含めてください。' })
      }
    }
  })).min(1).max(100)
}).superRefine((benchmark, context) => {
  const caseIds = benchmark.cases.map((testCase) => testCase.id)
  if (new Set(caseIds).size !== caseIds.length) {
    context.addIssue({ code: 'custom', path: ['cases'], message: '評価ケースIDが重複しています。' })
  }
})

export const candidateEvaluationCaseResultSchema = z.object({
  caseId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u),
  queryHash: z.string().regex(/^[a-f0-9]{64}$/u),
  relevantCandidates: z.number().int().positive(),
  retrievedRelevantCandidates: z.number().int().nonnegative(),
  recallAt20: z.number().min(0).max(1),
  ndcgAt20: z.number().min(0).max(1),
  expectedProjectEvidence: z.number().int().nonnegative(),
  matchedProjectEvidence: z.number().int().nonnegative(),
  missingCandidateLabels: z.array(anonymousCandidateLabelSchema).max(100)
})

export const candidateEvaluationReportSchema = z.object({
  version: z.literal('candidate-evaluation-report-v1'),
  id: z.string().uuid(),
  datasetId: z.string().uuid(),
  datasetHash: z.string().regex(/^[a-f0-9]{64}$/u),
  status: z.enum(['passed', 'failed', 'insufficient-cases', 'invalid-references']),
  algorithmVersion: z.enum(['hard-filter-hybrid-rrf-v1', 'hard-filter-hybrid-local-rerank-v1']),
  hardFilterPolicyVersion: z.enum(['fail-closed-v1', 'tri-state-v2', 'tri-state-v3']).default('fail-closed-v1'),
  modelId: z.string().min(1).max(200),
  modelRevision: z.string().min(1).max(200),
  evaluatedAt: z.string().datetime(),
  networkAccess: z.literal(false),
  cloudUsed: z.literal(false),
  metrics: z.object({
    caseCount: z.number().int().positive(),
    relevantCandidates: z.number().int().positive(),
    retrievedRelevantCandidates: z.number().int().nonnegative(),
    recallAt20: z.number().min(0).max(1),
    ndcgAt20: z.number().min(0).max(1),
    expectedProjectEvidence: z.number().int().nonnegative(),
    matchedProjectEvidence: z.number().int().nonnegative(),
    projectEvidenceCoverageAt20: z.number().min(0).max(1).nullable(),
    missingCandidateReferences: z.number().int().nonnegative()
  }),
  thresholds: candidateEvaluationThresholdsSchema,
  cases: z.array(candidateEvaluationCaseResultSchema).min(1).max(100)
})

export const candidateEvaluationDatasetSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(3).max(120),
  datasetHash: z.string().regex(/^[a-f0-9]{64}$/u),
  caseCount: z.number().int().positive(),
  relevantCandidates: z.number().int().positive(),
  reviewerCount: z.number().int().positive(),
  importedAt: z.string().datetime()
})

export const candidateEvaluationStateSchema = z.object({
  dataset: candidateEvaluationDatasetSummarySchema.nullable(),
  latestReport: candidateEvaluationReportSchema.nullable()
})

const candidateEvaluationDraftRelevantCandidateSchema = z.object({
  profileId: z.string().uuid(),
  profileVersion: z.number().int().positive(),
  anonymousLabel: anonymousCandidateLabelSchema,
  expectedProjectEvidence: z.boolean(),
  status: z.enum(['active', 'stale'])
})

const candidateEvaluationDraftCaseSchema = z.object({
  id: z.string().uuid(),
  jobCaseId: z.string().uuid(),
  jobCaseVersion: z.number().int().positive(),
  jobCaseTitle: z.string().min(1).max(160),
  query: z.string().min(2).max(500),
  poolReviewed: z.literal(true),
  reviewerDisplayName: z.string().min(1).max(120),
  reviewedAt: z.string().datetime(),
  status: z.enum(['ready', 'job-case-stale', 'candidate-stale', 'no-relevant-candidates']),
  relevantCandidates: z.array(candidateEvaluationDraftRelevantCandidateSchema).max(100)
})

export const candidateEvaluationDraftSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(3).max(120),
  revision: z.number().int().positive(),
  caseCount: z.number().int().nonnegative(),
  readyCaseCount: z.number().int().nonnegative(),
  reviewerCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  cases: z.array(candidateEvaluationDraftCaseSchema).max(100)
})

const candidateEvaluationAuthoringJobCaseOptionSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  title: z.string().min(1).max(160),
  query: z.string().min(2).max(500)
})

const candidateEvaluationAuthoringCandidateOptionSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  anonymousLabel: anonymousCandidateLabelSchema,
  skills: z.string().max(500).nullable(),
  experienceYears: z.string().max(500).nullable(),
  availability: z.string().max(500).nullable(),
  rate: z.string().max(500).nullable(),
  japaneseLevel: z.string().max(500).nullable(),
  workStyle: z.string().max(500).nullable(),
  role: z.string().max(500).nullable(),
  projectExperienceCount: z.number().int().nonnegative()
})

export const candidateEvaluationAuthoringWorkspaceSchema = z.object({
  draft: candidateEvaluationDraftSchema.nullable(),
  jobCases: z.array(candidateEvaluationAuthoringJobCaseOptionSchema).max(2_000),
  candidates: z.array(candidateEvaluationAuthoringCandidateOptionSchema).max(10_000)
})

export const createCandidateEvaluationDraftInputSchema = z.object({
  name: z.string().trim().min(3).max(120)
})

export const saveCandidateEvaluationDraftCaseInputSchema = z.object({
  draftId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
  jobCaseId: z.string().uuid(),
  relevantCandidateProfileIds: z.array(z.string().uuid()).min(1).max(100),
  expectedProjectEvidenceProfileIds: z.array(z.string().uuid()).max(100),
  poolReviewed: z.literal(true)
}).superRefine((input, context) => {
  const relevant = new Set(input.relevantCandidateProfileIds)
  if (relevant.size !== input.relevantCandidateProfileIds.length) {
    context.addIssue({ code: 'custom', path: ['relevantCandidateProfileIds'], message: '関連候補者が重複しています。' })
  }
  if (new Set(input.expectedProjectEvidenceProfileIds).size !== input.expectedProjectEvidenceProfileIds.length) {
    context.addIssue({ code: 'custom', path: ['expectedProjectEvidenceProfileIds'], message: 'プロジェクト証拠対象が重複しています。' })
  }
  for (const profileId of input.expectedProjectEvidenceProfileIds) {
    if (!relevant.has(profileId)) {
      context.addIssue({ code: 'custom', path: ['expectedProjectEvidenceProfileIds'], message: 'プロジェクト証拠対象は関連候補者に含めてください。' })
    }
  }
})

export const deleteCandidateEvaluationDraftCaseInputSchema = z.object({
  draftId: z.string().uuid(),
  caseId: z.string().uuid(),
  expectedRevision: z.number().int().positive()
})

export const evaluateCandidateEvaluationDraftInputSchema = z.object({
  draftId: z.string().uuid(),
  expectedRevision: z.number().int().positive()
})

export const googleWorkspaceOAuthClientIdSchema = z.string()
  .trim()
  .min(20)
  .max(220)
  .regex(/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/u, 'Desktop OAuth Client ID の形式が正しくありません。')

export const googleWorkspaceDomainSchema = z.string()
  .trim()
  .max(253)
  .transform((value) => value.toLocaleLowerCase('en-US'))
  .pipe(z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u, '会社 Workspace ドメインの形式が正しくありません。'))

const operatorDisplayNameSchema = z.string()
  .trim()
  .min(2, '表示名は2文字以上で入力してください。')
  .max(80, '表示名は80文字以内で入力してください。')
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), '表示名に制御文字は使用できません。')

const operatorRoleLabelSchema = z.string()
  .trim()
  .min(2, '役割は2文字以上で入力してください。')
  .max(40, '役割は40文字以内で入力してください。')
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), '役割に制御文字は使用できません。')

export const localOperatorProfileSchema = z.object({
  version: z.literal('local-operator-profile-v1'),
  operatorId: z.string().uuid(),
  displayName: operatorDisplayNameSchema,
  roleLabel: operatorRoleLabelSchema,
  configured: z.boolean(),
  revision: z.number().int().positive().nullable(),
  updatedAt: z.string().datetime().nullable(),
  cloudEligible: z.literal(false)
}).superRefine((value, context) => {
  if (value.configured && (value.revision === null || value.updatedAt === null)) {
    context.addIssue({ code: 'custom', message: '設定済みプロフィールにはRevisionと更新日時が必要です。' })
  }
  if (!value.configured && (value.revision !== null || value.updatedAt !== null)) {
    context.addIssue({ code: 'custom', message: '未設定プロフィールにRevisionまたは更新日時を保存できません。' })
  }
})

export const saveLocalOperatorProfileInputSchema = z.object({
  displayName: operatorDisplayNameSchema,
  roleLabel: operatorRoleLabelSchema,
  expectedRevision: z.number().int().positive().nullable()
})

export const localApplicationPreferencesSchema = z.object({
  version: z.literal('local-application-preferences-v1'),
  locale: z.enum(applicationLocales),
  configured: z.boolean(),
  revision: z.number().int().positive().nullable(),
  updatedAt: z.string().datetime().nullable(),
  cloudEligible: z.literal(false)
}).superRefine((value, context) => {
  if (value.configured && (value.revision === null || value.updatedAt === null)) {
    context.addIssue({ code: 'custom', message: '保存済み表示設定にはRevisionと更新日時が必要です。' })
  }
  if (!value.configured && (value.revision !== null || value.updatedAt !== null)) {
    context.addIssue({ code: 'custom', message: '未設定表示設定にRevisionまたは更新日時を保存できません。' })
  }
})

export const saveLocalApplicationPreferencesInputSchema = z.object({
  locale: z.enum(applicationLocales),
  expectedRevision: z.number().int().positive().nullable()
})

export const prepareAiCommerceCloudPromptInputSchema = z.object({
  content: z.string().trim().min(1).max(12_000)
}).strict()

export const executeAiCommerceCloudPromptInputSchema = z.object({
  reviewTicket: z.string().uuid()
}).strict()

export const aiConversationContextSchema = z.object({
  assistant: z.enum(['candidate-profile', 'interview', 'sales-agent']),
  candidateDocumentId: z.string().uuid().nullable(),
  interviewId: z.string().uuid().nullable(),
  interviewKind: z.enum(['recruiting', 'client']).nullable(),
  roundNumber: z.number().int().min(1).max(20).nullable()
}).superRefine((value, context) => {
  if (value.assistant === 'sales-agent' && (
    value.candidateDocumentId !== null || value.interviewId !== null ||
    value.interviewKind !== null || value.roundNumber !== null
  )) {
    context.addIssue({ code: 'custom', message: '営業エージェント会話には候補者または面談コンテキストを保存できません。' })
  }
  if (value.assistant !== 'sales-agent' && value.candidateDocumentId === null) {
    context.addIssue({ code: 'custom', message: '候補者プロフィールまたは面談会話には候補者IDが必要です。' })
  }
  if (value.assistant === 'candidate-profile' && (value.interviewId !== null || value.interviewKind !== null || value.roundNumber !== null)) {
    context.addIssue({ code: 'custom', message: '候補者プロフィール会話に面談コンテキストは保存できません。' })
  }
  if (value.assistant === 'interview' && (value.interviewKind === null || value.roundNumber === null)) {
    context.addIssue({ code: 'custom', message: '面談会話には面談種別と回数が必要です。' })
  }
})

const aiConversationReferenceSchema = z.object({
  label: z.string().min(1).max(160),
  target: z.string().min(1).max(160),
  kind: z.enum(['job-case', 'match-run', 'match-result']).optional(),
  objectId: z.string().min(1).max(128).optional(),
  objectVersion: z.number().int().positive().nullable().optional(),
  resultHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable().optional(),
  ordinal: z.number().int().positive().nullable().optional()
}).superRefine((value, context) => {
  const typed = value.kind !== undefined || value.objectId !== undefined
  if (typed && (!value.kind || !value.objectId || value.objectVersion === undefined || value.resultHash === undefined || value.ordinal === undefined)) {
    context.addIssue({ code: 'custom', message: '类型化案件引用字段不完整。' })
  }
})

const typedAiConversationReferenceSchema = aiConversationReferenceSchema.safeExtend({
  kind: z.enum(['job-case', 'match-run', 'match-result']),
  objectId: z.string().min(1).max(128),
  objectVersion: z.number().int().positive().nullable(),
  resultHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  ordinal: z.number().int().positive().nullable()
})

const agentJobCaseCardSchema = z.object({
  reference: typedAiConversationReferenceSchema,
  title: z.string().min(1).max(500),
  version: z.number().int().positive(),
  updatedAt: z.string().datetime(),
  requiredSkills: z.string().max(500).nullable(),
  rate: z.string().max(500).nullable(),
  workStyle: z.string().max(500).nullable(),
  startDate: z.string().max(500).nullable(),
  status: z.enum(['current', 'stale', 'deleted'])
})

const agentCandidateMatchCardSchema = z.object({
  reference: typedAiConversationReferenceSchema,
  candidateProfileId: z.string().uuid(),
  sourceDocumentId: z.string().uuid().optional(),
  runId: z.string().uuid(),
  rank: z.number().int().positive(),
  anonymousLabel: z.string().min(1).max(120),
  fitScore: z.number().finite().nullable(),
  matched: z.array(z.string().min(1).max(180)).max(40),
  missing: z.array(z.string().min(1).max(180)).max(40),
  hardFilterStatus: z.enum(['passed', 'failed', 'unknown']),
  projectEvidence: z.string().max(1_500).nullable(),
  status: z.enum(['current', 'stale', 'deleted'])
})

const agentSystemAccessBlockSchema = z.discriminatedUnion('destination', [
  z.object({ type: z.literal('system-access'), destination: z.literal('job-cases') }),
  z.object({ type: z.literal('system-access'), destination: z.literal('case-import') }),
  z.object({
    type: z.literal('system-access'),
    destination: z.literal('case-review'),
    reviewId: z.string().uuid()
  }),
  z.object({
    type: z.literal('system-access'),
    destination: z.literal('matching'),
    jobCaseId: z.string().uuid().optional()
  }),
  z.object({ type: z.literal('system-access'), destination: z.literal('candidate-management') }),
  z.object({
    type: z.literal('system-access'),
    destination: z.literal('candidate'),
    sourceDocumentId: z.string().uuid(),
    view: z.enum(['overview', 'resume', 'schedule', 'prepare', 'workbench', 'decision', 'client', 'records', 'entry']),
    interviewId: z.string().uuid().nullable().optional(),
    interviewKind: z.enum(['recruiting', 'client']).optional()
  }),
  z.object({
    type: z.literal('system-access'),
    destination: z.literal('original-document'),
    sourceDocumentId: z.string().uuid()
  }),
  z.object({ type: z.literal('system-access'), destination: z.literal('review-center') }),
  z.object({
    type: z.literal('system-access'),
    destination: z.literal('task'),
    taskId: z.string().uuid()
  }),
  z.object({
    type: z.literal('system-access'),
    destination: z.literal('interview-schedule'),
    receipt: z.object({
      sourceDocumentId: z.string().uuid(),
      candidateLabel: z.string().min(1).max(120),
      scheduledAt: z.string().datetime(),
      durationMinutes: z.number().int().min(5).max(480),
      meetingMethod: z.enum(['zoom', 'google-meet', 'phone', 'onsite']),
      kind: z.enum(['recruiting', 'client']),
      meetingLinkStoredLocally: z.boolean()
    }).optional()
  })
])

const agentBlocksSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string().min(1).max(20_000) }),
  z.object({
    type: z.literal('job-case-cards'),
    query: z.string().max(200),
    dataAsOf: z.string().datetime(),
    normalizedFilters: z.object({
      updatedAfter: z.string().datetime(),
      updatedBefore: z.string().datetime(),
      lifecycle: z.literal('active'),
      query: z.string().max(200).nullable(),
      limit: z.number().int().positive().max(20)
    }),
    totalMatched: z.number().int().nonnegative(),
    cards: z.array(agentJobCaseCardSchema).max(20)
  }),
  z.object({
    type: z.literal('candidate-match-cards'),
    runId: z.string().uuid(),
    resultHash: z.string().regex(/^[a-f0-9]{64}$/u),
    cards: z.array(agentCandidateMatchCardSchema).max(5)
  }),
  z.object({
    type: z.literal('candidate-profile-evidence'),
    facts: z.object({
      runId: z.string().uuid(),
      validity: z.enum(['current', 'stale', 'deleted']),
      candidate: z.object({
        candidateProfileId: z.string().uuid(),
        sourceDocumentId: z.string().uuid().optional(),
        rank: z.number().int().positive().max(20),
        anonymousLabel: z.string().min(1).max(120)
      }).nullable(),
      profile: z.object({
        profileVersion: z.number().int().positive(),
        skills: z.string().max(500).nullable(),
        experienceYears: z.string().max(500).nullable(),
        availability: z.string().max(500).nullable(),
        rate: z.string().max(500).nullable(),
        japaneseLevel: z.string().max(500).nullable(),
        workStyle: z.string().max(500).nullable(),
        role: z.string().max(500).nullable(),
        location: z.string().max(500).nullable(),
        workAuthorization: z.string().max(500).nullable(),
        projectExperiences: z.array(z.object({
          title: z.string().min(1).max(160),
          period: z.string().max(120).nullable(),
          role: z.string().max(120).nullable(),
          technologies: z.array(z.string().min(1).max(80)).max(40),
          summary: z.string().min(1).max(1_500)
        })).max(20)
      }).nullable()
    })
  }),
  z.object({
    type: z.literal('candidate-interview-evidence'),
    facts: z.object({
      runId: z.string().uuid(),
      validity: z.enum(['current', 'stale', 'deleted']),
      candidate: z.object({
        candidateProfileId: z.string().uuid(),
        sourceDocumentId: z.string().uuid().optional(),
        rank: z.number().int().positive().max(20),
        anonymousLabel: z.string().min(1).max(120)
      }).nullable(),
      interviews: z.array(z.object({
        interviewId: z.string().uuid().optional(),
        kind: z.enum(['recruiting', 'client']),
        roundNumber: z.number().int().positive().max(20),
        stage: z.string().min(1).max(120),
        scheduledAt: z.string().datetime().nullable(),
        durationMinutes: z.number().int().positive().max(24 * 60),
        meetingMethod: z.string().min(1).max(120),
        interviewer: z.string().max(120).nullable(),
        interviewGoal: z.string().max(1_000).nullable(),
        interviewNotes: z.string().max(8_000).nullable(),
        unresolvedItems: z.array(z.string().min(1).max(300)).max(20),
        decision: z.string().max(120).nullable(),
        decisionReason: z.string().max(1_500).nullable(),
        updatedAt: z.string().datetime()
      })).max(40)
    })
  }),
  z.object({
    type: z.literal('clarification'),
    code: z.enum(['SELECT_JOB_CASE', 'SELECT_RESULT', 'STALE_REFERENCE', 'NO_ACTIVE_JOB_CASE', 'INTERVIEW_DETAILS_REQUIRED']),
    prompt: z.string().min(1).max(2_000),
    options: z.array(typedAiConversationReferenceSchema).max(20)
  }),
  z.object({
    type: z.literal('resume-import'),
    imported: z.array(z.object({
      documentId: z.string().uuid(),
      label: z.string().min(1).max(60),
      ordinal: z.number().int().min(1).max(10)
    })).max(10),
    failedCount: z.number().int().min(0).max(10)
  }),
  z.object({
    type: z.literal('candidate-draft-facts'),
    facts: z.object({
      documentId: z.string().uuid(),
      label: z.string().min(1).max(60),
      confirmed: z.literal(false),
      reviewStatus: z.enum(['awaiting-review', 'completed']),
      fields: z.array(z.object({
        label: z.string().min(1).max(80),
        value: z.string().max(600).nullable(),
        confidence: z.number().min(0).max(1),
        status: z.enum(['needs_review', 'missing', 'confirmed']),
        sources: z.array(z.string().min(1).max(180)).max(12)
      })).max(20),
      projects: z.array(z.object({
        title: z.string().min(1).max(300),
        period: z.string().max(120).nullable(),
        role: z.string().max(180).nullable(),
        technologies: z.array(z.string().min(1).max(120)).max(40),
        summary: z.string().max(2_000),
        confidence: z.number().min(0).max(1),
        sources: z.array(z.string().min(1).max(180)).max(12)
      })).max(30)
    })
  }),
  z.object({
    type: z.literal('match-run-explanation'),
    facts: z.object({
      runId: z.string().uuid(),
      resultHash: z.string().regex(/^[a-f0-9]{64}$/u),
      validity: z.enum(['current', 'stale', 'deleted']),
      jobCaseVersion: z.number().int().positive().nullable(),
      candidatePoolFingerprint: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
      algorithmVersion: z.string().min(1).max(120),
      hardFilterPolicyVersion: z.string().min(1).max(120),
      candidate: agentCandidateMatchCardSchema.nullable(),
      matched: z.array(z.string().min(1).max(180)).max(40),
      missing: z.array(z.string().min(1).max(180)).max(40),
      hardFilterStatus: z.enum(['passed', 'failed', 'unknown']),
      projectEvidence: z.string().max(1_500).nullable()
    })
  }),
  z.object({
    type: z.literal('error'),
    code: z.string().min(1).max(120),
    message: z.string().min(1).max(2_000),
    entityKind: z.enum(['job-case', 'match-run', 'match-result']).optional()
  }),
  agentSystemAccessBlockSchema
])

const salesAgentStateSchema = z.object({
  selectedJobCaseRef: typedAiConversationReferenceSchema.nullable(),
  lastMatchRunId: z.string().uuid().nullable(),
  lastSearchMessageId: z.string().min(1).max(128).nullable()
})

export const aiConversationMessageSchema = z.object({
  id: z.string().min(1).max(128),
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(20_000),
  mode: z.enum(['local', 'cloud', 'local-fallback']).optional(),
  modelKey: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,119}$/u).optional(),
  modelDisplayName: z.string().trim().min(1).max(120).optional(),
  narrativeStatus: z.enum(['local', 'streaming', 'completed', 'failed-local-fallback', 'cancelled']).optional(),
  turnId: z.string().uuid().nullable().optional(),
  blocks: z.array(agentBlocksSchema).max(20).optional(),
  references: z.array(aiConversationReferenceSchema).max(20).optional(),
  action: z.enum(['questions', 'notes', 'decision']).optional(),
  removedIdentifierCount: z.number().int().nonnegative().max(10_000).optional(),
  usageCredits: z.number().finite().nonnegative().nullable().optional(),
  suggestCloudQuestion: z.string().min(1).max(700).optional(),
  createdAt: z.string().datetime()
})

export const aiConversationSnapshotSchema = z.object({
  id: z.string().uuid(),
  branchRootConversationId: z.string().uuid().optional(),
  context: aiConversationContextSchema,
  title: z.string().min(1).max(120),
  messages: z.array(aiConversationMessageSchema).max(200),
  salesAgentState: salesAgentStateSchema.optional(),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).superRefine((value, context) => {
  if (value.salesAgentState !== undefined && value.context.assistant !== 'sales-agent') {
    context.addIssue({ code: 'custom', path: ['salesAgentState'], message: '候補者または面談会話に Sales Agent の状態を保存できません。' })
  }
})

export const saveAiConversationInputSchema = z.object({
  conversationId: z.string().uuid(),
  branchRootConversationId: z.string().uuid().optional(),
  context: aiConversationContextSchema,
  messages: z.array(aiConversationMessageSchema).min(1).max(200),
  salesAgentState: salesAgentStateSchema.optional(),
  expectedRevision: z.number().int().positive().nullable()
}).superRefine((value, context) => {
  if (value.salesAgentState !== undefined && value.context.assistant !== 'sales-agent') {
    context.addIssue({ code: 'custom', path: ['salesAgentState'], message: '候補者または面談会話に Sales Agent の状態を保存できません。' })
  }
})

export const executeAgentTurnInputSchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().trim().min(1).max(4_000),
  expectedConversationRevision: z.number().int().positive().nullable(),
  requestId: z.string().uuid(),
  modelKey: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,119}$/u).default('gpt-5.6-luna'),
  selectedJobCaseRef: typedAiConversationReferenceSchema.nullable().optional(),
  activeSystemAccess: agentSystemAccessBlockSchema.nullable().optional(),
  /**
   * Vault tokens for files the operator attached to this turn. Only tokens
   * cross the boundary; the main process resolves them against staged records
   * and refuses anything it did not stage itself.
   */
  attachmentFileTokens: z.array(z.string().uuid()).max(10)
    .refine((tokens) => new Set(tokens).size === tokens.length, '附件 Token 不能重复。')
    .optional(),
  branchFrom: z.object({
    conversationId: z.string().uuid(),
    messageId: z.string().trim().min(1).max(160),
    expectedRevision: z.number().int().positive()
  }).strict().optional()
}).strict().superRefine((value, context) => {
  if (!value.branchFrom) return
  if (value.branchFrom.conversationId === value.conversationId) {
    context.addIssue({ code: 'custom', path: ['branchFrom', 'conversationId'], message: '编辑分支必须使用新会话。' })
  }
  if (value.expectedConversationRevision !== null) {
    context.addIssue({ code: 'custom', path: ['expectedConversationRevision'], message: '编辑分支的目标会话必须是新会话。' })
  }
  if (value.selectedJobCaseRef != null) {
    context.addIssue({ code: 'custom', path: ['selectedJobCaseRef'], message: '编辑分支的案件上下文由主进程从历史恢复。' })
  }
  if (value.activeSystemAccess != null) {
    context.addIssue({ code: 'custom', path: ['activeSystemAccess'], message: '编辑分支不能继承分支点之后打开的右侧工作区。' })
  }
  if ((value.attachmentFileTokens?.length ?? 0) > 0) {
    context.addIssue({ code: 'custom', path: ['attachmentFileTokens'], message: '编辑分支不会自动复制附件。' })
  }
})

export const agentChatModelOptionSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,119}$/u),
  displayName: z.string().trim().min(1).max(120)
}).strict()

const agentTurnEventBaseSchema = z.object({
  conversationId: z.string().uuid(),
  requestId: z.string().uuid(),
  sequence: z.number().int().positive(),
  modelKey: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,119}$/u),
  modelDisplayName: z.string().trim().min(1).max(120)
})

export const agentTurnEventSchema = z.discriminatedUnion('type', [
  agentTurnEventBaseSchema.extend({
    type: z.literal('started'),
    phase: z.enum(['planning', 'local-tool', 'connecting-model', 'streaming', 'stopping'])
  }).strict(),
  agentTurnEventBaseSchema.extend({
    type: z.literal('delta'),
    text: z.string().min(1).max(2_000)
  }).strict(),
  agentTurnEventBaseSchema.extend({
    type: z.literal('completed')
  }).strict(),
  agentTurnEventBaseSchema.extend({
    type: z.literal('failed'),
    code: z.string().min(1).max(120),
    message: z.string().min(1).max(2_000),
    localFallbackPreserved: z.literal(true)
  }).strict(),
  agentTurnEventBaseSchema.extend({
    type: z.literal('cancelled'),
    cancelStatus: z.enum(['cancel_requested', 'canceled', 'too_late']).nullable(),
    message: z.string().min(1).max(2_000)
  }).strict()
])

export const cancelAgentTurnInputSchema = z.object({
  conversationId: z.string().uuid(),
  requestId: z.string().uuid()
}).strict()

export const deleteAiConversationsInputSchema = z.object({
  conversationIds: z.array(z.string().uuid()).min(1).max(50).refine((ids) => new Set(ids).size === ids.length, '会話IDが重複しています。')
})

const googleWorkspaceAdminConfigurationFields = {
  version: z.literal('google-workspace-admin-config-v1'),
  clientId: googleWorkspaceOAuthClientIdSchema,
  workspaceDomain: googleWorkspaceDomainSchema,
  labelIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u)).min(1).max(10),
  query: z.string().trim().min(2).max(200),
  lookbackDays: z.number().int().min(1).max(365),
  maxMessagesPerRun: z.number().int().min(1).max(500),
  configuredBy: z.string().trim().min(1).max(120),
  updatedAt: z.string().datetime()
}

export const googleWorkspaceAdminConfigurationSchema = z.discriminatedUnion('source', [
  z.object({
    ...googleWorkspaceAdminConfigurationFields,
    source: z.literal('local-admin'),
    editable: z.literal(true),
    revision: z.number().int().positive()
  }),
  z.object({
    ...googleWorkspaceAdminConfigurationFields,
    source: z.literal('managed-environment'),
    editable: z.literal(false),
    revision: z.null()
  })
])

export const saveGoogleWorkspaceAdminConfigurationInputSchema = z.object({
  clientId: googleWorkspaceOAuthClientIdSchema,
  workspaceDomain: googleWorkspaceDomainSchema,
  labelIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u)).min(1).max(10),
  query: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .refine((value) => !/[\r\n\u0000:()]/u.test(value), 'Gmail 演算子ではなく業務キーワードを使用してください。')
    .refine(
      (value) => value.split(/\s+OR\s+/iu).every((term) => term.replace(/^['"]|['"]$/gu, '').trim().length >= 2) &&
        !/(?:^|\s)(?:AND|NOT)(?:\s|$)/iu.test(value),
      '業務キーワードを OR で区切って指定してください。'
    ),
  lookbackDays: z.number().int().min(1).max(365),
  maxMessagesPerRun: z.number().int().min(1).max(500),
  expectedRevision: z.number().int().positive().nullable(),
  readonlyAcknowledged: z.literal(true)
})

export const googleWorkspaceOnlineAcceptanceReportSchema = z.object({
  version: z.literal('google-workspace-online-acceptance-v1'),
  id: z.string().uuid(),
  checkedAt: z.string().datetime(),
  overall: z.enum(['passed', 'action-required']),
  configurationFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  credentialProtection: z.enum(['macos-keychain', 'windows-dpapi']),
  mailboxMetadataAccessed: z.literal(true),
  messageContentAccessedDuringCheck: z.literal(false),
  cloudModelUsed: z.literal(false),
  directIdentifierCloudSent: z.literal(false),
  checks: z.array(z.object({
    id: z.enum([
      'live-profile',
      'readonly-scope',
      'company-domain',
      'credential-protection',
      'bounded-sync',
      'successful-sync',
      'local-redaction',
      'no-cloud-model',
      'no-send-path'
    ]),
    status: z.enum(['passed', 'warning', 'failed']),
    label: z.string().min(1).max(120),
    detail: z.string().min(1).max(500)
  })).length(9),
  evidence: z.object({
    grantedScopeCount: z.number().int().nonnegative().max(20),
    sync: z.object({
      status: z.enum(['never', 'idle', 'error']),
      lastSyncedAt: z.string().datetime().nullable(),
      mode: z.enum(['baseline', 'incremental', 'bounded-rescan']).nullable(),
      discovered: z.number().int().nonnegative(),
      imported: z.number().int().nonnegative(),
      duplicates: z.number().int().nonnegative(),
      filtered: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative()
    }),
    redaction: z.object({
      storedMessages: z.number().int().nonnegative(),
      passed: z.number().int().nonnegative(),
      uncertain: z.number().int().nonnegative(),
      blocked: z.number().int().nonnegative()
    })
  })
})

export const candidateProfileSourceInputSchema = z.string().uuid()

export const updateCandidateProfileInputSchema = z.object({
  sourceDocumentId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  identity: z.object({
    displayName: z.string().trim().min(1).max(120).nullable(),
    gender: z.string().trim().min(1).max(40).nullable(),
    birthDate: z.string().trim().min(1).max(80).nullable(),
    nationality: z.string().trim().min(1).max(80).nullable(),
    phone: z.string().trim().min(1).max(80).nullable(),
    email: z.string().trim().min(1).max(200).nullable(),
    address: z.string().trim().min(1).max(500).nullable(),
    education: z.string().trim().min(1).max(300).nullable(),
    major: z.string().trim().min(1).max(200).nullable(),
    graduationDate: z.string().trim().min(1).max(80).nullable(),
    degree: z.string().trim().min(1).max(120).nullable()
  }),
  fields: z.array(z.object({
    key: z.enum(candidateFieldKeys),
    value: z.string().trim().min(1).max(500).nullable()
  })).max(candidateFieldKeys.length),
  projectExperiences: z.array(z.object({
    id: z.string().min(1).max(80),
    title: z.string().trim().min(1).max(160),
    period: z.string().trim().min(1).max(120).nullable(),
    role: z.string().trim().min(1).max(120).nullable(),
    technologies: z.array(z.string().trim().min(1).max(80)).max(40),
    summary: z.string().trim().min(1).max(1_500)
  })).max(20)
})


export const deleteCandidateDataInputSchema = z.object({
  sourceDocumentId: z.string().uuid(),
  confirmationHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmationText: z.literal('削除')
})

export const candidateDeletionPreviewSchema = z.object({
  sourceDocumentId: z.string().uuid(),
  anonymousLabel: z.string().min(1).max(80),
  localFileName: z.string().min(1).max(180),
  counts: z.object({
    profileVersions: z.number().int().nonnegative(),
    reviewAudits: z.number().int().nonnegative(),
    taskRecords: z.number().int().nonnegative(),
    matchRecords: z.number().int().nonnegative(),
    evaluationRecords: z.number().int().nonnegative(),
    proposalDrafts: z.number().int().nonnegative(),
    piiMappings: z.number().int().nonnegative(),
    searchIndexEntries: z.number().int().nonnegative(),
    encryptedFiles: z.number().int().nonnegative(),
    agentReferences: z.object({
      conversations: z.number().int().nonnegative(),
      messages: z.number().int().nonnegative()
    })
  }),
  confirmationHash: z.string().regex(/^[a-f0-9]{64}$/),
  warningCodes: z.array(z.string().min(1).max(120)).max(50)
})

const deletionComponentStatusSchema = z.enum([
  'deleted', 'not_present', 'expired_pending', 'crypto_erased', 'failed'
])

export const candidateDataDeletionReportSchema = z.object({
  id: z.string().uuid(),
  entityType: z.literal('candidate'),
  entityIdHash: z.string().regex(/^[a-f0-9]{64}$/),
  requestedBy: z.string().min(1).max(120),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  outcome: z.enum(['completed', 'partial-failure']),
  components: z.object({
    database: deletionComponentStatusSchema,
    fileVault: deletionComponentStatusSchema,
    searchIndex: deletionComponentStatusSchema,
    cache: deletionComponentStatusSchema,
    temporaryFiles: deletionComponentStatusSchema,
    backups: deletionComponentStatusSchema
  }),
  deletedCounts: candidateDeletionPreviewSchema.shape.counts,
  warningCodes: z.array(z.string().min(1).max(120)).max(50)
})

export const jobCaseReviewFieldSnapshotSchema = z.object({
  key: z.enum(jobCaseFieldKeys),
  label: z.string().min(1).max(80),
  originalValue: z.string().max(500).nullable(),
  value: z.string().max(500).nullable(),
  confidence: z.number().min(0).max(1),
  status: z.enum(['needs_review', 'missing', 'confirmed']),
  sourceLabels: z.array(z.string().min(1).max(180)),
  changed: z.boolean(),
  changeReason: z.string().max(300).nullable()
})

export const jobCaseSummarySchema = z.object({
  id: z.string().uuid(),
  sourceReviewId: z.string().uuid(),
  version: z.number().int().positive(),
  status: z.enum(['active', 'superseded']),
  confirmedAt: z.string().datetime(),
  confirmedBy: z.string().min(1).max(120),
  containsDirectIdentifiers: z.literal(false)
})

export const jobCaseReviewSnapshotSchema = z.object({
  reviewId: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceType: z.enum(['gmail', 'manual', 'eml']),
  providerMessageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).nullable(),
  threadId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  fromDomain: z.string().max(253).nullable(),
  messageDate: z.string().datetime(),
  redactedSubject: z.string().max(2_000),
  redactedPreview: z.string().max(4_000),
  reviewRevision: z.number().int().positive(),
  status: z.enum(['awaiting-review', 'completed']),
  privacyReviewed: z.boolean(),
  fields: z.array(jobCaseReviewFieldSnapshotSchema).length(jobCaseFieldKeys.length),
  warningCodes: z.array(z.string().min(1).max(120)).max(100),
  completedAt: z.string().datetime().nullable(),
  reviewerDisplayName: z.string().min(1).max(120).nullable(),
  jobCase: jobCaseSummarySchema.nullable(),
  lifecycle: z.enum(['active', 'archived']),
  cloudEligible: z.literal(false)
})

export const createManualJobCaseDraftInputSchema = z.object({
  subject: z.string().trim().min(2).max(2_000).refine((value) => !value.includes('\u0000'), '件名に無効な文字が含まれています。'),
  body: z.string().trim().min(8).max(100_000).refine((value) => !value.includes('\u0000'), '本文に無効な文字が含まれています。')
})

export const createChatPasteJobCaseDraftInputSchema = z.object({
  text: z.string().trim().min(8).max(100_000).refine((value) => !value.includes('\u0000'), '貼り付け本文に無効な文字が含まれています。')
}).strict()

export const executeWechatVisibleReadInputSchema = z.object({
  scopeToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u)
}).strict()

export const setBusinessPriorityOverrideInputSchema = z.object({
  matchResultId: z.string().uuid(),
  level: z.enum(['high', 'normal', 'follow_up', 'paused']),
  reason: z.string().trim().min(3).max(500),
  expiresAt: z.string().datetime()
}).strict()

export const submitJobCaseReviewInputSchema = z.object({
  reviewId: z.string().uuid(),
  reviewRevision: z.number().int().positive(),
  privacyReviewed: z.literal(true),
  fields: z
    .array(
      z.object({
        key: z.enum(jobCaseFieldKeys),
        value: z.string().trim().min(1).max(500).nullable(),
        confirmed: z.literal(true),
        changeReason: z.string().trim().min(3).max(300).optional()
      })
    )
    .length(jobCaseFieldKeys.length)
})

export const jobCaseReviewIdSchema = z.string().uuid()

export const setJobCaseLifecycleInputSchema = z.object({
  reviewId: jobCaseReviewIdSchema,
  state: z.enum(['active', 'archived']),
  reason: z.string().trim().min(3).max(300)
})

export const reopenJobCaseReviewInputSchema = z.object({
  reviewId: jobCaseReviewIdSchema,
  reason: z.string().trim().min(3).max(300)
})

export const deleteJobCaseDataInputSchema = z.object({
  reviewId: jobCaseReviewIdSchema,
  confirmationHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmationText: z.literal('削除')
})

export const jobCaseDeletionPreviewSchema = z.object({
  reviewId: jobCaseReviewIdSchema,
  sourceId: z.string().uuid(),
  title: z.string().min(1).max(500),
  sourceType: z.enum(['gmail', 'manual', 'eml']),
  counts: z.object({
    caseVersions: z.number().int().nonnegative(),
    reviewAudits: z.number().int().nonnegative(),
    taskRecords: z.number().int().nonnegative(),
    proposalDrafts: z.number().int().nonnegative(),
    evaluationDraftCases: z.number().int().nonnegative(),
    piiMappings: z.number().int().nonnegative(),
    sourceRecords: z.number().int().nonnegative(),
    gmailMessages: z.number().int().nonnegative(),
    agentReferences: z.object({
      conversations: z.number().int().nonnegative(),
      messages: z.number().int().nonnegative()
    })
  }),
  confirmationHash: z.string().regex(/^[a-f0-9]{64}$/),
  warningCodes: z.array(z.string().min(1).max(120)).max(50)
})

export const jobCaseDataDeletionReportSchema = z.object({
  id: z.string().uuid(),
  entityType: z.literal('job_case'),
  entityIdHash: z.string().regex(/^[a-f0-9]{64}$/),
  requestedBy: z.string().min(1).max(120),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  outcome: z.enum(['completed', 'partial-failure']),
  components: z.object({
    database: deletionComponentStatusSchema,
    fileVault: deletionComponentStatusSchema,
    searchIndex: deletionComponentStatusSchema,
    cache: deletionComponentStatusSchema,
    temporaryFiles: deletionComponentStatusSchema,
    backups: deletionComponentStatusSchema
  }),
  deletedCounts: jobCaseDeletionPreviewSchema.shape.counts,
  warningCodes: z.array(z.string().min(1).max(120)).max(50)
})

export const dataDeletionReportSchema = z.discriminatedUnion('entityType', [
  candidateDataDeletionReportSchema,
  jobCaseDataDeletionReportSchema
])

const proposalJobCaseOptionSchema = z.object({
  id: z.string().uuid(),
  reviewId: z.string().uuid(),
  version: z.number().int().positive(),
  title: z.string().min(1).max(500),
  role: z.string().max(500).nullable(),
  requiredSkills: z.string().max(500).nullable(),
  rate: z.string().max(500).nullable(),
  fields: z.array(z.object({
    key: z.enum(jobCaseFieldKeys),
    label: z.string().min(1).max(80),
    value: z.string().max(500).nullable(),
    sourceLabels: z.array(z.string().min(1).max(180)).max(20)
  })).length(jobCaseFieldKeys.length)
})

const proposalCandidateOptionSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  anonymousLabel: z.string().min(1).max(80),
  skills: z.string().max(500).nullable(),
  experienceYears: z.string().max(500).nullable(),
  availability: z.string().max(500).nullable(),
  rate: z.string().max(500).nullable(),
  japaneseLevel: z.string().max(500).nullable(),
  workStyle: z.string().max(500).nullable(),
  role: z.string().max(500).nullable(),
  fields: z.array(z.object({
    key: z.enum(candidateFieldKeys),
    label: z.string().min(1).max(80),
    value: z.string().max(500).nullable(),
    sourceLabels: z.array(z.string().min(1).max(180)).max(20)
  })).max(candidateFieldKeys.length),
  projectExperiences: z.array(candidateProjectExperienceSchema).max(20)
})

export const proposalPreparationOptionsSchema = z.object({
  jobCases: z.array(proposalJobCaseOptionSchema).max(1_000),
  candidates: z.array(proposalCandidateOptionSchema).max(10_000)
})

export const proposalAttachmentPreviewSchema = z.object({
  fileName: z.string().min(1).max(180),
  mimeType: z.literal('application/pdf'),
  redacted: z.literal(true),
  sourceDocumentIncluded: z.literal(false),
  anonymousCandidateLabel: z.string().min(1).max(80),
  fields: z.array(z.object({
    key: z.enum(candidateFieldKeys),
    label: z.string().min(1).max(80),
    value: z.string().min(1).max(500),
    sourceLabels: z.array(z.string().min(1).max(180)).max(20)
  })).max(candidateFieldKeys.length),
  projectExperiences: z.array(z.object({
    title: z.string().trim().min(1).max(160),
    period: z.string().trim().min(1).max(120).nullable(),
    role: z.string().trim().min(1).max(120).nullable(),
    technologies: z.array(z.string().trim().min(1).max(80)).max(40),
    summary: z.string().trim().min(1).max(1_500)
  })).max(20).default([]),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/)
})

const proposalOccurredOnSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, '日付はYYYY-MM-DD形式で入力してください。').refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, '実在する日付を入力してください。')

export const proposalFollowUpEventSchema = z.object({
  id: z.string().uuid(),
  draftId: z.string().uuid(),
  revision: z.number().int().positive(),
  stage: z.enum(proposalFollowUpStages),
  occurredOn: proposalOccurredOnSchema,
  note: z.string().trim().min(1).max(500).nullable(),
  recordedBy: z.string().trim().min(1).max(120),
  recordedAt: z.string().datetime(),
  cloudEligible: z.literal(false)
})

const proposalFollowUpStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  stage: z.enum(proposalFollowUpStages).nullable(),
  events: z.array(proposalFollowUpEventSchema).max(100),
  cloudEligible: z.literal(false)
}).superRefine((state, context) => {
  if (state.revision !== state.events.length) {
    context.addIssue({ code: 'custom', message: '営業結果のRevisionと履歴件数が一致しません。' })
  }
  const latest = state.events.at(-1) ?? null
  if (state.stage !== (latest?.stage ?? null)) {
    context.addIssue({ code: 'custom', message: '営業結果の現在状態が最新履歴と一致しません。' })
  }
  if (state.events.some((event, index) => event.revision !== index + 1)) {
    context.addIssue({ code: 'custom', message: '営業結果のRevisionが連続していません。' })
  }
})

export const proposalDraftSnapshotSchema = z.object({
  schemaVersion: z.literal('proposal-draft-v1'),
  id: z.string().uuid(),
  taskId: z.string().min(1).max(128),
  jobCaseId: z.string().uuid(),
  jobCaseVersion: z.number().int().positive(),
  candidateProfileId: z.string().uuid(),
  candidateProfileVersion: z.number().int().positive(),
  recipientTo: z.string().email().max(320),
  recipientCc: z.array(z.string().email().max(320)).max(10),
  candidateDisplayName: z.string().trim().min(1).max(80).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), '対外表示名に無効な文字が含まれています。'),
  subject: z.string().trim().min(1).max(200).refine((value) => !/[\r\n\u0000]/u.test(value), '件名に無効な文字が含まれています。'),
  body: z.string().trim().min(10).max(20_000).refine((value) => !value.includes('\u0000'), '本文に無効な文字が含まれています。'),
  attachment: proposalAttachmentPreviewSchema,
  tone: z.enum(['standard', 'concise', 'formal']),
  status: z.enum(['awaiting_review', 'approved', 'exported', 'export_unknown']),
  revision: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  approvedContentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  approvedAt: z.string().datetime().nullable(),
  approvedBy: z.string().min(1).max(120).nullable(),
  exportedAt: z.string().datetime().nullable(),
  exportPackageHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  followUp: proposalFollowUpStateSchema.default({
    revision: 0,
    stage: null,
    events: [],
    cloudEligible: false
  }),
  generation: z.object({
    mode: z.literal('deterministic-local-v1'),
    cloudUsed: z.literal(false),
    rawResumeUsed: z.literal(false),
    rawMailUsed: z.literal(false),
    recipientAndDisplayNameCloudEligible: z.literal(false)
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

export const proposalWorkspaceSnapshotSchema = z.object({
  options: proposalPreparationOptionsSchema,
  drafts: z.array(proposalDraftSnapshotSchema).max(1_000),
  evidence: z.array(z.object({
    draftId: z.string().uuid(),
    jobCase: proposalJobCaseOptionSchema,
    candidate: proposalCandidateOptionSchema
  })).max(1_000).default([])
})

const proposalRecipientFields = {
  recipientTo: z.string().trim().email().max(320),
  recipientCc: z.array(z.string().trim().email().max(320)).max(10),
  candidateDisplayName: z.string().trim().min(1).max(80).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), '対外表示名に無効な文字が含まれています。')
}

export const createProposalDraftInputSchema = z.object({
  taskId: z.string().min(1).max(128),
  jobCaseId: z.string().uuid(),
  candidateProfileId: z.string().uuid(),
  ...proposalRecipientFields,
  tone: z.enum(['standard', 'concise', 'formal'])
})

export const updateProposalDraftInputSchema = z.object({
  draftId: z.string().uuid(),
  revision: z.number().int().positive(),
  ...proposalRecipientFields,
  subject: z.string().trim().min(1).max(200).refine((value) => !/[\r\n\u0000]/u.test(value), '件名に無効な文字が含まれています。'),
  body: z.string().trim().min(10).max(20_000).refine((value) => !value.includes('\u0000'), '本文に無効な文字が含まれています。')
})

export const approveProposalDraftInputSchema = z.object({
  draftId: z.string().uuid(),
  revision: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  approvals: z.object({
    recipient: z.literal(true),
    body: z.literal(true),
    attachment: z.literal(true),
    privacy: z.literal(true)
  })
})

export const exportProposalPackageInputSchema = z.object({
  draftId: z.string().uuid(),
  revision: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/)
})

export const recordProposalFollowUpInputSchema = z.object({
  draftId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  stage: z.enum(proposalFollowUpStages),
  occurredOn: proposalOccurredOnSchema,
  note: z.string().trim().max(500).optional(),
  manuallyConfirmed: z.literal(true)
})

export const proposalTaskIdSchema = z.string().min(1).max(128)

const recoveryPasswordSchema = z
  .string()
  .min(12, '復元パスワードは12文字以上にしてください。')
  .max(256, '復元パスワードが長すぎます。')
  .refine((value) => !value.includes('\u0000'), '復元パスワードに無効な文字が含まれています。')

export const createRecoveryPackageInputSchema = z
  .object({
    password: recoveryPasswordSchema,
    passwordConfirmation: recoveryPasswordSchema
  })
  .refine((input) => input.password === input.passwordConfirmation, {
    message: '復元パスワードが一致しません。',
    path: ['passwordConfirmation']
  })

export const snoozeRecoveryReminderInputSchema = z.object({
  days: z.union([z.literal(1), z.literal(7)])
})

export const previewRecoveryPackageInputSchema = z.object({ password: recoveryPasswordSchema })

export const confirmRecoveryInputSchema = z.object({
  restoreToken: z.string().uuid(),
  confirmationHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmationText: z.literal('復元')
})
