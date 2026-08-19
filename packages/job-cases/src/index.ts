import { z } from 'zod'
import { jobCaseFieldKeys, type JobCaseFieldKey, type JobCaseSourceType } from '@shared/contracts'
import type { ParsedEmlMessage } from '@mail'
import {
  applyLocalPiiMappings,
  redactTextForCloud,
  type LocalRedactionResult
} from '@privacy'

export interface JobCaseFieldSource {
  sourceLabel:
    | 'Gmail Subject'
    | 'Gmail Body'
    | 'EML Subject'
    | 'EML Body'
    | 'Manual Subject'
    | 'Manual Body'
    | 'Chat Subject'
    | 'Chat Body'
    | 'WeChat Subject'
    | 'WeChat Body'
  excerpt: string
}

export interface JobCaseExtractionField {
  key: JobCaseFieldKey
  label: string
  value: string | null
  confidence: number
  status: 'needs_review' | 'missing'
  sources: JobCaseFieldSource[]
}

export interface JobCaseSource {
  version: 'job-case-source-v1'
  id: string
  sourceType: JobCaseSourceType
  providerAccount: string | null
  providerMessageId: string | null
  threadId: string
  fromDomain: string | null
  messageDate: string
  redactedSubject: string
  redactedBody: string
  redactionSessionId: string
  warningCodes: string[]
  createdAt: string
}

export interface JobCaseExtractionDraftV1 {
  version: 'job-case-extraction-v1'
  reviewId: string
  accountEmail: string
  gmailMessageId: string
  threadId: string
  fields: JobCaseExtractionField[]
  warningCodes: string[]
  requiresReview: true
  createdAt: string
}

export interface JobCaseExtractionDraftV2 {
  version: 'job-case-extraction-v2'
  reviewId: string
  sourceId: string
  sourceType: JobCaseSourceType
  threadId: string
  fields: JobCaseExtractionField[]
  warningCodes: string[]
  requiresReview: true
  createdAt: string
}

export type JobCaseExtractionDraft = JobCaseExtractionDraftV1 | JobCaseExtractionDraftV2

export interface ConfirmedJobCaseV1 {
  schemaVersion: 'job-case-v1'
  id: string
  sourceReviewId: string
  sourceGmailMessageId: string
  sourceThreadId: string
  version: number
  reviewRevision: number
  fields: Array<{
    key: JobCaseFieldKey
    label: string
    value: string | null
    sourceLabels: string[]
  }>
  confirmedAt: string
  confirmedBy: string
  containsDirectIdentifiers: false
}

export interface ConfirmedJobCaseV2 {
  schemaVersion: 'job-case-v2'
  id: string
  sourceReviewId: string
  sourceId: string
  sourceType: JobCaseSourceType
  sourceProviderMessageId: string | null
  sourceThreadId: string
  version: number
  reviewRevision: number
  fields: Array<{
    key: JobCaseFieldKey
    label: string
    value: string | null
    sourceLabels: string[]
  }>
  confirmedAt: string
  confirmedBy: string
  containsDirectIdentifiers: false
}

export type ConfirmedJobCase = ConfirmedJobCaseV1 | ConfirmedJobCaseV2

const fieldSourceSchema = z.object({
  sourceLabel: z.enum([
    'Gmail Subject', 'Gmail Body', 'EML Subject', 'EML Body',
    'Manual Subject', 'Manual Body', 'Chat Subject', 'Chat Body',
    'WeChat Subject', 'WeChat Body'
  ]),
  excerpt: z.string().min(1).max(240)
})

const extractionFieldsSchema = z.array(z.object({
  key: z.enum(jobCaseFieldKeys),
  label: z.string().min(1).max(80),
  value: z.string().max(500).nullable(),
  confidence: z.number().min(0).max(1),
  status: z.enum(['needs_review', 'missing']),
  sources: z.array(fieldSourceSchema).max(10)
})).length(jobCaseFieldKeys.length)

export const jobCaseSourceSchema: z.ZodType<JobCaseSource> = z.object({
  version: z.literal('job-case-source-v1'),
  id: z.string().uuid(),
  sourceType: z.enum(['gmail', 'manual', 'eml', 'chat-paste', 'wechat-visible']),
  providerAccount: z.string().email().max(320).nullable(),
  providerMessageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).nullable(),
  threadId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  fromDomain: z.string().max(253).nullable(),
  messageDate: z.string().datetime(),
  redactedSubject: z.string().min(1).max(2_000),
  redactedBody: z.string().min(1).max(500_000),
  redactionSessionId: z.string().uuid(),
  warningCodes: z.array(z.string().min(1).max(120)).max(100),
  createdAt: z.string().datetime()
}).superRefine((source, context) => {
  const hasGmailIdentity = Boolean(source.providerAccount && source.providerMessageId)
  if (source.sourceType === 'gmail' && !hasGmailIdentity) {
    context.addIssue({ code: 'custom', message: 'Gmail sources require a provider account and message ID.' })
  }
  if (source.sourceType === 'manual' && (source.providerAccount !== null || source.providerMessageId !== null)) {
    context.addIssue({ code: 'custom', message: 'Manual sources cannot contain provider identifiers.' })
  }
  if (source.sourceType === 'eml' && (source.providerAccount !== null || source.providerMessageId === null)) {
    context.addIssue({ code: 'custom', message: 'EML sources require a local message fingerprint and no provider account.' })
  }
  if (source.sourceType === 'chat-paste' && (source.providerAccount !== null || source.providerMessageId !== null)) {
    context.addIssue({ code: 'custom', message: 'Chat paste sources cannot contain provider identifiers.' })
  }
  if (source.sourceType === 'wechat-visible' && (source.providerAccount !== null || source.providerMessageId !== null)) {
    context.addIssue({ code: 'custom', message: 'WeChat visible sources cannot contain provider identifiers.' })
  }
})

const jobCaseExtractionDraftV1Schema: z.ZodType<JobCaseExtractionDraftV1> = z.object({
  version: z.literal('job-case-extraction-v1'),
  reviewId: z.string().uuid(),
  accountEmail: z.string().email().max(320),
  gmailMessageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  threadId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  fields: extractionFieldsSchema,
  warningCodes: z.array(z.string().min(1).max(120)).max(100),
  requiresReview: z.literal(true),
  createdAt: z.string().datetime()
})

const jobCaseExtractionDraftV2Schema: z.ZodType<JobCaseExtractionDraftV2> = z.object({
  version: z.literal('job-case-extraction-v2'),
  reviewId: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceType: z.enum(['gmail', 'manual', 'eml', 'chat-paste', 'wechat-visible']),
  threadId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  fields: extractionFieldsSchema,
  warningCodes: z.array(z.string().min(1).max(120)).max(100),
  requiresReview: z.literal(true),
  createdAt: z.string().datetime()
})

export const jobCaseExtractionDraftSchema: z.ZodType<JobCaseExtractionDraft> = z.union([
  jobCaseExtractionDraftV1Schema,
  jobCaseExtractionDraftV2Schema
])

const confirmedFieldsSchema = z.array(z.object({
  key: z.enum(jobCaseFieldKeys),
  label: z.string().min(1).max(80),
  value: z.string().max(500).nullable(),
  sourceLabels: z.array(z.string().min(1).max(180)).max(10)
})).length(jobCaseFieldKeys.length)

const confirmedJobCaseV1Schema: z.ZodType<ConfirmedJobCaseV1> = z.object({
  schemaVersion: z.literal('job-case-v1'),
  id: z.string().uuid(),
  sourceReviewId: z.string().uuid(),
  sourceGmailMessageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  sourceThreadId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  version: z.number().int().positive(),
  reviewRevision: z.number().int().positive(),
  fields: confirmedFieldsSchema,
  confirmedAt: z.string().datetime(),
  confirmedBy: z.string().min(1).max(120),
  containsDirectIdentifiers: z.literal(false)
})

const confirmedJobCaseV2Schema: z.ZodType<ConfirmedJobCaseV2> = z.object({
  schemaVersion: z.literal('job-case-v2'),
  id: z.string().uuid(),
  sourceReviewId: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceType: z.enum(['gmail', 'manual', 'eml', 'chat-paste', 'wechat-visible']),
  sourceProviderMessageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).nullable(),
  sourceThreadId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  version: z.number().int().positive(),
  reviewRevision: z.number().int().positive(),
  fields: confirmedFieldsSchema,
  confirmedAt: z.string().datetime(),
  confirmedBy: z.string().min(1).max(120),
  containsDirectIdentifiers: z.literal(false)
})

export const confirmedJobCaseSchema: z.ZodType<ConfirmedJobCase> = z.union([
  confirmedJobCaseV1Schema,
  confirmedJobCaseV2Schema
])

const candidateBenchmarkQueryFieldOrder: JobCaseFieldKey[] = [
  'required_skills',
  'role',
  'rate',
  'start_date',
  'remote',
  'japanese_level',
  'location',
  'work_authorization'
]

function normalizedJobCaseWorkAuthorizationRequirement(value: string): string | null {
  if (/(?:国籍|外国籍|日本人限定|日本国籍)/u.test(value)) return null
  return value.normalize('NFKC').match(
    /(?:日本で就労可能|就労資格必須|就労資格あり|就労制限なし|ビザサポートなし|資格外活動不可|週28時間制限不可)/u
  )?.[0] ?? null
}

export function candidateBenchmarkQueryFromJobCase(jobCase: ConfirmedJobCase): string {
  const fields = new Map(jobCase.fields.map((field) => [field.key, field.value?.normalize('NFKC').trim() || null]))
  const values = candidateBenchmarkQueryFieldOrder.flatMap((key) => {
    const value = fields.get(key)
    if (!value) return []
    if (key === 'location') return [`勤務地:${value}`]
    if (key === 'work_authorization') {
      const normalized = normalizedJobCaseWorkAuthorizationRequirement(value)
      return normalized ? [`就労資格:${normalized}`] : []
    }
    return [value]
  })
  if (values.length === 0) {
    const title = fields.get('title')
    if (title) values.push(title)
  }
  return [...new Set(values)].join(' ').slice(0, 500)
}

const piiPlaceholderPattern = /<(?:PERSON_NAME|PHONE|PRIVATE_EMAIL|POSTAL_ADDRESS|BIRTH_DATE|FACE_OR_PHOTO|SIGNATURE|GOVERNMENT_ID|PERSONAL_ACCOUNT_OR_URL|IDENTIFYING_QR_CODE)_\d{3}>/gu

const fieldDefinitions: ReadonlyArray<{
  key: JobCaseFieldKey
  label: string
  labels?: RegExp
}> = [
  { key: 'title', label: '案件名' },
  { key: 'role', label: '募集ロール', labels: /(?:募集(?:職種|枠|ロール)?|ポジション|役割|ロール)/iu },
  { key: 'required_skills', label: '必須スキル', labels: /(?:必須(?:スキル|要件)?|技術要件|スキル)/iu },
  { key: 'rate', label: '単価', labels: /(?:単価|月額|金額)/iu },
  { key: 'settlement', label: '精算', labels: /(?:精算(?:幅|条件)?)/iu },
  { key: 'location', label: '勤務地', labels: /(?:勤務地|場所|現場|最寄(?:駅)?)/iu },
  { key: 'remote', label: 'リモート', labels: /(?:リモート|テレワーク|在宅|出社(?:頻度)?|勤務形態)/iu },
  { key: 'start_date', label: '開始時期', labels: /(?:開始(?:時期|日)?|参画(?:時期)?|稼働開始)/iu },
  { key: 'working_hours', label: '勤務時間', labels: /(?:勤務時間|就業時間|工数|稼働時間)/iu },
  { key: 'japanese_level', label: '日本語', labels: /(?:日本語(?:レベル)?|語学)/iu },
  { key: 'interview', label: '面談', labels: /(?:面談(?:回数)?|面接)/iu },
  { key: 'contract_chain', label: '契約・商流', labels: /(?:商流|契約(?:形態)?|所属制限)/iu },
  { key: 'payment_terms', label: '支払条件', labels: /(?:支払(?:サイト|条件)?|支払い)/iu },
  { key: 'work_authorization', label: '就労資格', labels: /(?:就労資格|就労可否|就労制限|ビザサポート)/iu }
]

const skillVocabulary = [
  'Java', 'Spring Boot', 'AWS', 'Azure', 'GCP', 'TypeScript', 'JavaScript', 'React', 'Vue',
  'Angular', 'Node.js', 'Python', 'Go', 'C#', '.NET', 'Kotlin', 'Swift', 'SQL', 'Oracle',
  'PostgreSQL', 'MySQL', 'Docker', 'Kubernetes', 'Terraform', 'Linux', 'SAP', 'Salesforce'
] as const

const nextLabelPattern = /\s+(?=(?:募集(?:職種|枠|ロール)?|ポジション|役割|ロール|必須(?:スキル|要件)?|技術要件|スキル|単価|月額|金額|精算(?:幅|条件)?|勤務地|場所|現場|最寄(?:駅)?|リモート|テレワーク|在宅|出社(?:頻度)?|勤務形態|開始(?:時期|日)?|参画(?:時期)?|稼働開始|勤務時間|就業時間|工数|稼働時間|日本語(?:レベル)?|語学|面談(?:回数)?|面接|商流|契約(?:形態)?|所属制限|支払(?:サイト|条件)?|支払い|就労資格|就労可否|就労制限|ビザサポート)\s*[:：])/iu
const piiPlaceholderPresencePattern = /<(?:PERSON_NAME|PHONE|PRIVATE_EMAIL|POSTAL_ADDRESS|BIRTH_DATE|FACE_OR_PHOTO|SIGNATURE|GOVERNMENT_ID|PERSONAL_ACCOUNT_OR_URL|IDENTIFYING_QR_CODE)_\d{3}>/u
const sourceInstructionPattern = /(?:ignore previous instructions|system prompt|tool call|execute command|指示を無視|命令を実行|ファイルを削除|全候補者.*(?:出力|送信))/iu

function cleanBusinessValue(value: string): string | null {
  const cleaned = value
    .replace(piiPlaceholderPattern, ' ')
    .split(nextLabelPattern, 1)[0]
    ?.replace(/^[\s:：・／/|｜\-–—]+|[\s|｜]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 500) ?? ''
  return cleaned.length > 0 ? cleaned : null
}

function excerpt(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, 240)
}

function bodyLines(body: string): string[] {
  return body
    .split(/\r?\n|[|｜]/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2_000)
}

function valueAfterLabel(lines: string[], labels: RegExp): { value: string; line: string } | null {
  for (const line of lines) {
    const match = line.match(labels)
    if (!match || match.index === undefined) continue
    const after = line.slice(match.index + match[0].length).replace(/^\s*[:：]?\s*/u, '')
    const value = cleanBusinessValue(after)
    if (value) return { value, line }
  }
  return null
}

function containsSkill(text: string, skill: string): boolean {
  const escaped = skill.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const prefix = /^[A-Za-z0-9]/u.test(skill) ? '(?<![A-Za-z0-9+#.])' : ''
  const suffix = /[A-Za-z0-9]$/u.test(skill) ? '(?![A-Za-z0-9+#.])' : ''
  return new RegExp(`${prefix}${escaped}${suffix}`, 'iu').test(text)
}

function skillField(lines: string[], body: string): { value: string; line: string; confidence: number } | null {
  const labeled = valueAfterLabel(lines, /(?:必須(?:スキル|要件)?|技術要件|スキル)/iu)
  if (labeled) return { ...labeled, confidence: 0.9 }
  const skills = skillVocabulary.filter((skill) => containsSkill(body, skill))
  if (skills.length === 0) return null
  const line = lines.find((candidate) => skills.some((skill) => containsSkill(candidate, skill))) ?? body
  return { value: skills.join(', '), line, confidence: 0.82 }
}

function makeField(
  definition: (typeof fieldDefinitions)[number],
  value: string | null,
  confidence: number,
  sources: JobCaseFieldSource[]
): JobCaseExtractionField {
  return {
    key: definition.key,
    label: definition.label,
    value,
    confidence: value ? confidence : 0,
    status: value ? 'needs_review' : 'missing',
    sources: value ? sources : []
  }
}

export function extractJobCaseDraft(
  rawSource: JobCaseSource,
  reviewId: string,
  now = new Date()
): JobCaseExtractionDraftV2 {
  const source = jobCaseSourceSchema.parse(rawSource)
  const subjectLabel: JobCaseFieldSource['sourceLabel'] = source.sourceType === 'gmail'
    ? 'Gmail Subject'
    : source.sourceType === 'eml'
      ? 'EML Subject'
      : source.sourceType === 'chat-paste'
        ? 'Chat Subject'
        : source.sourceType === 'wechat-visible' ? 'WeChat Subject' : 'Manual Subject'
  const bodyLabel: JobCaseFieldSource['sourceLabel'] = source.sourceType === 'gmail'
    ? 'Gmail Body'
    : source.sourceType === 'eml'
      ? 'EML Body'
      : source.sourceType === 'chat-paste'
        ? 'Chat Body'
        : source.sourceType === 'wechat-visible' ? 'WeChat Body' : 'Manual Body'
  const lines = bodyLines(source.redactedBody)
  const fields = fieldDefinitions.map((definition) => {
    if (definition.key === 'title') {
      const title = cleanBusinessValue(source.redactedSubject)
      return makeField(definition, title, 0.98, title ? [{ sourceLabel: subjectLabel, excerpt: excerpt(source.redactedSubject) }] : [])
    }
    if (definition.key === 'required_skills') {
      const skills = skillField(lines, source.redactedBody)
      return makeField(
        definition,
        skills?.value ?? null,
        skills?.confidence ?? 0,
        skills ? [{ sourceLabel: bodyLabel, excerpt: excerpt(skills.line) }] : []
      )
    }
    if (definition.key === 'work_authorization') {
      const extracted = definition.labels ? valueAfterLabel(lines, definition.labels) : null
      const normalized = extracted ? normalizedJobCaseWorkAuthorizationRequirement(extracted.value) : null
      return makeField(
        definition,
        normalized,
        normalized ? 0.82 : 0,
        normalized && extracted ? [{ sourceLabel: bodyLabel, excerpt: excerpt(extracted.line) }] : []
      )
    }
    const extracted = definition.labels ? valueAfterLabel(lines, definition.labels) : null
    return makeField(
      definition,
      extracted?.value ?? null,
      extracted ? 0.86 : 0,
      extracted ? [{ sourceLabel: bodyLabel, excerpt: excerpt(extracted.line) }] : []
    )
  })
  const warnings = new Set(source.warningCodes)
  warnings.add('DETERMINISTIC_EXTRACTION_REQUIRES_REVIEW')
  if (piiPlaceholderPresencePattern.test(`${source.redactedSubject}\n${source.redactedBody}`)) {
    warnings.add('SOURCE_CONTAINS_PII_PLACEHOLDERS')
  }
  if (!fields.find((field) => field.key === 'required_skills')?.value) warnings.add('REQUIRED_SKILLS_MISSING')
  if (/(?:外国籍不可|日本国籍(?:のみ|限定)|日本人(?:のみ|限定))/u.test(source.redactedBody)) {
    warnings.add('NATIONALITY_REQUIREMENT_BLOCKED_USE_WORK_AUTHORIZATION')
  }
  return jobCaseExtractionDraftSchema.parse({
    version: 'job-case-extraction-v2',
    reviewId,
    sourceId: source.id,
    sourceType: source.sourceType,
    threadId: source.threadId,
    fields,
    warningCodes: [...warnings],
    requiresReview: true,
    createdAt: now.toISOString()
  }) as JobCaseExtractionDraftV2
}

export interface RedactedGmailJobCaseSourceInput {
  accountEmail: string
  gmailMessageId: string
  threadId: string
  fromDomain: string | null
  messageDate: string
  redactedSubject: string
  redactedBody: string
  redactionSessionId: string
  warningCodes: string[]
  createdAt: string
}

export function createGmailJobCaseSource(
  input: RedactedGmailJobCaseSourceInput,
  sourceId: string
): JobCaseSource {
  return jobCaseSourceSchema.parse({
    version: 'job-case-source-v1',
    id: sourceId,
    sourceType: 'gmail',
    providerAccount: input.accountEmail,
    providerMessageId: input.gmailMessageId,
    threadId: input.threadId,
    fromDomain: input.fromDomain,
    messageDate: input.messageDate,
    redactedSubject: input.redactedSubject,
    redactedBody: input.redactedBody,
    redactionSessionId: input.redactionSessionId,
    warningCodes: [...new Set([
      'UNTRUSTED_SOURCE_CONTENT',
      ...input.warningCodes,
      ...(input.warningCodes.includes('PROMPT_INJECTION_PATTERN') || sourceInstructionPattern.test(`${input.redactedSubject}\n${input.redactedBody}`)
        ? ['PROMPT_INJECTION_CONTENT_IGNORED']
        : [])
    ])],
    createdAt: input.createdAt
  })
}

export interface ManualJobCaseSourceInput {
  subject: string
  body: string
}

export interface RedactedManualJobCaseSourceResult {
  source: JobCaseSource
  redaction: LocalRedactionResult
}

export function createRedactedManualJobCaseSource(
  input: ManualJobCaseSourceInput,
  sourceId: string,
  knownPersonNames: string[],
  now = new Date()
): RedactedManualJobCaseSourceResult {
  const localText = `[SUBJECT]\n${input.subject}\n[BODY]\n${input.body}`
  const redaction = redactTextForCloud(localText, {
    sourceVersion: `manual-job-case:${sourceId}`,
    policyVersion: 'cloud-redaction-v2',
    knownPersonNames,
    sessionId: sourceId,
    now
  })
  if (redaction.blockedReasons.some((reason) => reason.startsWith('residual:'))) {
    throw new Error('Residual direct identifier remained after local manual-input redaction.')
  }
  const redactedSubject = applyLocalPiiMappings(input.subject, redaction.mappings).trim()
  const redactedBody = applyLocalPiiMappings(input.body, redaction.mappings).trim()
  const source = jobCaseSourceSchema.parse({
    version: 'job-case-source-v1',
    id: sourceId,
    sourceType: 'manual',
    providerAccount: null,
    providerMessageId: null,
    threadId: sourceId,
    fromDomain: null,
    messageDate: now.toISOString(),
    redactedSubject,
    redactedBody,
    redactionSessionId: redaction.session.id,
    warningCodes: [...new Set([
      'MANUAL_SOURCE_LOCAL_REDACTION',
      'UNTRUSTED_SOURCE_CONTENT',
      ...(sourceInstructionPattern.test(localText) ? ['PROMPT_INJECTION_CONTENT_IGNORED'] : []),
      ...redaction.blockedReasons,
      ...(redaction.mappings.some((mapping) => mapping.identifierType === 'nationality')
        ? ['NATIONALITY_REQUIREMENT_BLOCKED_USE_WORK_AUTHORIZATION']
        : [])
    ])],
    createdAt: now.toISOString()
  })
  return { source, redaction }
}

export function createRedactedEmlJobCaseSource(
  input: ParsedEmlMessage,
  sourceId: string,
  knownPersonNames: string[],
  now = new Date()
): RedactedManualJobCaseSourceResult {
  const localText = `[SUBJECT]\n${input.subject}\n[BODY]\n${input.body}`
  const redaction = redactTextForCloud(localText, {
    sourceVersion: `eml-job-case:${input.sourceMessageKey}`,
    policyVersion: 'cloud-redaction-v2',
    knownPersonNames,
    sessionId: sourceId,
    now
  })
  if (redaction.blockedReasons.some((reason) => reason.startsWith('residual:'))) {
    throw new Error('Residual direct identifier remained after local EML redaction.')
  }
  const source = jobCaseSourceSchema.parse({
    version: 'job-case-source-v1',
    id: sourceId,
    sourceType: 'eml',
    providerAccount: null,
    providerMessageId: input.sourceMessageKey,
    threadId: input.threadKey,
    fromDomain: input.fromDomain,
    messageDate: input.messageDate,
    redactedSubject: applyLocalPiiMappings(input.subject, redaction.mappings).trim(),
    redactedBody: applyLocalPiiMappings(input.body, redaction.mappings).trim(),
    redactionSessionId: redaction.session.id,
    warningCodes: [...new Set([
      'EML_SOURCE_LOCAL_REDACTION',
      'UNTRUSTED_SOURCE_CONTENT',
      ...(sourceInstructionPattern.test(localText) ? ['PROMPT_INJECTION_CONTENT_IGNORED'] : []),
      ...input.warningCodes,
      ...redaction.blockedReasons,
      ...(redaction.mappings.some((mapping) => mapping.identifierType === 'nationality')
        ? ['NATIONALITY_REQUIREMENT_BLOCKED_USE_WORK_AUTHORIZATION']
        : [])
    ])],
    createdAt: now.toISOString()
  })
  return { source, redaction }
}

export function createRedactedChatPasteJobCaseSource(
  text: string,
  sourceId: string,
  knownPersonNames: string[],
  now = new Date()
): RedactedManualJobCaseSourceResult {
  const redaction = redactTextForCloud(`[CHAT]\n${text}`, {
    sourceVersion: `chat-paste-job-case:${sourceId}`,
    policyVersion: 'cloud-redaction-v2',
    knownPersonNames,
    sessionId: sourceId,
    now
  })
  if (redaction.blockedReasons.some((reason) => reason.startsWith('residual:'))) {
    throw new Error('Residual direct identifier remained after local chat-paste redaction.')
  }
  const redactedBody = applyLocalPiiMappings(text, redaction.mappings).trim()
  const firstBusinessLine = redactedBody
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 160) ?? 'チャット貼り付け案件'
  const source = jobCaseSourceSchema.parse({
    version: 'job-case-source-v1',
    id: sourceId,
    sourceType: 'chat-paste',
    providerAccount: null,
    providerMessageId: null,
    threadId: sourceId,
    fromDomain: null,
    messageDate: now.toISOString(),
    redactedSubject: firstBusinessLine,
    redactedBody,
    redactionSessionId: redaction.session.id,
    warningCodes: [...new Set([
      'CHAT_PASTE_ONE_TIME_LOCAL_REDACTION',
      'UNTRUSTED_SOURCE_CONTENT',
      'PROMPT_INJECTION_CONTENT_IGNORED',
      ...redaction.blockedReasons,
      ...(redaction.mappings.some((mapping) => mapping.identifierType === 'nationality')
        ? ['NATIONALITY_REQUIREMENT_BLOCKED_USE_WORK_AUTHORIZATION']
        : [])
    ])],
    createdAt: now.toISOString()
  })
  return { source, redaction }
}

export function createRedactedWechatVisibleJobCaseSource(
  text: string,
  sourceId: string,
  knownPersonNames: string[],
  input: {
    captureMethod: 'accessibility-tree' | 'screen-capture-kit-vision-ocr'
    truncated: boolean
  },
  now = new Date()
): RedactedManualJobCaseSourceResult {
  const redaction = redactTextForCloud(`[WECHAT_VISIBLE]\n${text}`, {
    sourceVersion: `wechat-visible-job-case:${sourceId}`,
    policyVersion: 'cloud-redaction-v2',
    knownPersonNames,
    sessionId: sourceId,
    now
  })
  if (redaction.blockedReasons.some((reason) => reason.startsWith('residual:'))) {
    throw new Error('Residual direct identifier remained after local WeChat visible-message redaction.')
  }
  const redactedBody = applyLocalPiiMappings(text, redaction.mappings).trim()
  const firstBusinessLine = redactedBody
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 160) ?? '微信可視メッセージ案件'
  const source = jobCaseSourceSchema.parse({
    version: 'job-case-source-v1',
    id: sourceId,
    sourceType: 'wechat-visible',
    providerAccount: null,
    providerMessageId: null,
    threadId: sourceId,
    fromDomain: null,
    messageDate: now.toISOString(),
    redactedSubject: firstBusinessLine,
    redactedBody,
    redactionSessionId: redaction.session.id,
    warningCodes: [...new Set([
      'WECHAT_VISIBLE_ONE_TIME_LOCAL_REDACTION',
      input.captureMethod === 'accessibility-tree'
        ? 'WECHAT_CAPTURE_ACCESSIBILITY_TREE'
        : 'WECHAT_CAPTURE_SCREEN_CAPTURE_KIT_VISION_OCR',
      ...(input.truncated ? ['WECHAT_VISIBLE_TEXT_TRUNCATED'] : []),
      'WECHAT_RAW_TEXT_NOT_PERSISTED',
      'WECHAT_RAW_IMAGE_NOT_PERSISTED',
      'UNTRUSTED_SOURCE_CONTENT',
      'PROMPT_INJECTION_CONTENT_IGNORED',
      ...redaction.blockedReasons,
      ...(redaction.mappings.some((mapping) => mapping.identifierType === 'nationality')
        ? ['NATIONALITY_REQUIREMENT_BLOCKED_USE_WORK_AUTHORIZATION']
        : [])
    ])],
    createdAt: now.toISOString()
  })
  return { source, redaction }
}
