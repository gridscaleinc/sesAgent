import { requiresOwnCompany } from '@shared'
import { z } from 'zod'
import {
  jobCaseFieldKeys,
  jobCaseSourceTypes,
  type AgentJobCaseDraftFacts,
  type JobCaseFieldAliasMap,
  type JobCaseFieldKey,
  type JobCaseReviewSnapshot,
  type JobCaseSourceType
} from '@shared/contracts'
import { canonicalizeJobCaseLabelLine } from '@shared'
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
  /** The business-text paste that produced this draft; absent for other sources. */
  intakeBatchId?: string | null
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

const jobCaseFieldOrder = new Map(jobCaseFieldKeys.map((key, index) => [key, index]))

/**
 * Stored drafts and confirmed cases predate fields added later (尚可スキル,
 * 業界, 募集人数, 備考). A missing key reads as an empty field - never as an
 * invalid row - and fields are returned in the current canonical order.
 */
function completeStoredJobCaseFields<Field extends { key: JobCaseFieldKey }>(
  value: unknown,
  empty: (key: JobCaseFieldKey) => Field
): unknown {
  if (!Array.isArray(value)) return value
  const present = new Set(value.map((field: unknown) => (field as { key?: unknown } | null)?.key))
  const completed = [...value, ...jobCaseFieldKeys.filter((key) => !present.has(key)).map(empty)]
  return completed.toSorted((left, right) =>
    (jobCaseFieldOrder.get((left as { key: JobCaseFieldKey }).key) ?? 99) - (jobCaseFieldOrder.get((right as { key: JobCaseFieldKey }).key) ?? 99))
}

function fieldLabelFor(key: JobCaseFieldKey): string {
  return fieldDefinitions.find((definition) => definition.key === key)?.label ?? key
}

const extractionFieldsSchema = z.preprocess(
  (value) => completeStoredJobCaseFields(value, (key) => ({
    key, label: fieldLabelFor(key), value: null, confidence: 0, status: 'missing' as const, sources: []
  })),
  z.array(z.object({
    key: z.enum(jobCaseFieldKeys),
    label: z.string().min(1).max(80),
    value: z.string().max(500).nullable(),
    confidence: z.number().min(0).max(1),
    status: z.enum(['needs_review', 'missing']),
    sources: z.array(fieldSourceSchema).max(10)
  })).length(jobCaseFieldKeys.length)
)

export const jobCaseSourceSchema: z.ZodType<JobCaseSource> = z.object({
  version: z.literal('job-case-source-v1'),
  id: z.string().uuid(),
  sourceType: z.enum(jobCaseSourceTypes),
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
  sourceType: z.enum(jobCaseSourceTypes),
  threadId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  fields: extractionFieldsSchema,
  warningCodes: z.array(z.string().min(1).max(120)).max(100),
  requiresReview: z.literal(true),
  createdAt: z.string().datetime(),
  intakeBatchId: z.string().uuid().nullable().optional()
})

export const jobCaseExtractionDraftSchema: z.ZodType<JobCaseExtractionDraft> = z.union([
  jobCaseExtractionDraftV1Schema,
  jobCaseExtractionDraftV2Schema
])

const confirmedFieldsSchema = z.preprocess(
  (value) => completeStoredJobCaseFields(value, (key) => ({ key, label: fieldLabelFor(key), value: null, sourceLabels: [] })),
  z.array(z.object({
    key: z.enum(jobCaseFieldKeys),
    label: z.string().min(1).max(80),
    value: z.string().max(500).nullable(),
    sourceLabels: z.array(z.string().min(1).max(180)).max(10)
  })).length(jobCaseFieldKeys.length)
)

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
  sourceType: z.enum(jobCaseSourceTypes),
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

/**
 * A nationality condition never enters a case: only a lawful work-authorization
 * requirement does. Broadcasts state the same exclusion in Japanese and in
 * Chinese - 最好日本人, 日本人希望 - and both are blocked at confirm time and
 * flagged at extraction. 外国籍可 is an inclusion and stays allowed.
 */
export function statesNationalityRestriction(text: string): boolean {
  return /(?:外国籍不可|日本国籍(?:のみ|限定)|日本人(?:のみ|限定|希望|優先|が望ましい)|(?:最好|仅限|只限|只要|限定)\s*日本人)/u
    .test(text.normalize('NFKC'))
}

/**
 * An age limit - 40代まで, 年齢50歳まで, 若手不可 - is not blocked: it is what
 * the client wrote, and the operator needs to see it. It is flagged so the
 * draft is reviewed before anyone acts on it.
 */
export function statesAgeLimitRequirement(text: string): boolean {
  return /(?:[0-9]{1,2}\s*代まで|(?:[0-9]{1,2}|[~〜～][0-9]{0,2})\s*歳まで|年齢.{0,4}まで|若手不可)/u
    .test(text.normalize('NFKC'))
}

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
  // 尚可スキル ride along as quoted plus tokens: they raise the fit score of
  // candidates who have them, but never gate or rank on their own.
  const preferred = (fields.get('preferred_skills') ?? '')
    .split(/[、,，/／\n]/u)
    .map((item) => item.replace(/[（(].*?[）)]/gu, '').trim())
    .filter((item) => item.length >= 2 && !item.includes('"'))
    .slice(0, 8)
    .map((item) => `"尚可:${item}"`)
  const ownOnly = jobCase.fields.some((field) => field.key !== 'preferred_skills' && field.value && requiresOwnCompany(field.value))
  return [...new Set([...(ownOnly ? ['自社限定'] : []), ...values, ...preferred])].join(' ').slice(0, 500)
}

const piiPlaceholderPattern = /<(?:PERSON_NAME|PHONE|PRIVATE_EMAIL|POSTAL_ADDRESS|BIRTH_DATE|FACE_OR_PHOTO|SIGNATURE|GOVERNMENT_ID|PERSONAL_ACCOUNT_OR_URL|IDENTIFYING_QR_CODE)_\d{3}>/gu

const fieldDefinitions: ReadonlyArray<{
  key: JobCaseFieldKey
  label: string
  labels?: RegExp
}> = [
  { key: 'title', label: '案件名' },
  { key: 'role', label: '募集ロール', labels: /(?:募集(?:職種|枠|ロール)?|ポジション|役割|ロール)/iu },
  { key: 'industry', label: '業界', labels: /(?:業界|業種|クライアント業種|案件業種|業務領域|ドメイン)/iu },
  { key: 'required_skills', label: '必須スキル', labels: /(?:必須(?:スキル|要件|経験)?|必要(?:スキル|要件|経験)|技術要件|スキル)/iu },
  { key: 'preferred_skills', label: '尚可スキル', labels: /(?:尚可(?:スキル|要件|条件)?|歓迎(?:スキル|要件|条件)?|あれば尚可|優遇|プラス(?:スキル)?)/iu },
  { key: 'rate', label: '単価', labels: /(?:単価|月額|金額)/iu },
  { key: 'settlement', label: '精算', labels: /(?:精算(?:幅|条件)?)/iu },
  { key: 'location', label: '勤務地', labels: /(?:勤務地|場所|現場|最寄(?:駅)?)/iu },
  { key: 'remote', label: 'リモート', labels: /(?:リモート|テレワーク|在宅|出社(?:頻度)?|勤務形態)/iu },
  { key: 'start_date', label: '開始時期', labels: /(?:開始(?:時期|日)?|参画(?:時期)?|稼働開始|作業期間|稼働期間|参画期間)/iu },
  { key: 'working_hours', label: '勤務時間', labels: /(?:勤務時間|就業時間|工数|稼働時間)/iu },
  { key: 'japanese_level', label: '日本語', labels: /(?:日本語(?:レベル)?|語学)/iu },
  { key: 'interview', label: '面談', labels: /(?:面談(?:回数)?|面接)/iu },
  { key: 'headcount', label: '募集人数', labels: /(?:募集人数|採用人数|必要人数|人数|要員数)/iu },
  { key: 'contract_chain', label: '契約・商流', labels: /(?:商流|契約(?:形態)?|所属制限)/iu },
  { key: 'payment_terms', label: '支払条件', labels: /(?:支払(?:サイト|条件)?|支払い)/iu },
  { key: 'work_authorization', label: '就労資格', labels: /(?:就労資格|就労可否|就労制限|ビザサポート)/iu },
  { key: 'notes', label: '備考', labels: /(?:備考|特記(?:事項)?|その他(?:条件)?|注意事項|補足|留意(?:点|事項)?)/iu }
]

const skillVocabulary = [
  'Java', 'Spring Boot', 'AWS', 'Azure', 'GCP', 'TypeScript', 'JavaScript', 'React', 'Vue',
  'Angular', 'Node.js', 'Python', 'Go', 'C#', '.NET', 'Kotlin', 'Swift', 'SQL', 'PL/SQL',
  'Oracle', 'PostgreSQL', 'MySQL', 'Snowflake', 'Power BI', 'Docker', 'Kubernetes',
  'Terraform', 'Linux', 'SAP', 'Salesforce', 'UiPath', 'LangChain'
] as const

const nextLabelPattern = /\s+(?=(?:募集(?:職種|枠|ロール)?|ポジション|役割|ロール|業界|業種|必須(?:スキル|要件|経験)?|必要(?:スキル|要件|経験)|技術要件|スキル|尚可(?:スキル|要件|条件)?|歓迎(?:スキル|要件|条件)?|単価|月額|金額|精算(?:幅|条件)?|勤務地|場所|現場|最寄(?:駅)?|リモート|テレワーク|在宅|出社(?:頻度)?|勤務形態|開始(?:時期|日)?|参画(?:時期)?|稼働開始|作業期間|勤務時間|就業時間|工数|稼働時間|日本語(?:レベル)?|語学|面談(?:回数)?|面接|募集人数|人数|商流|契約(?:形態)?|所属制限|支払(?:サイト|条件)?|支払い|就労資格|就労可否|就労制限|ビザサポート|備考|特記(?:事項)?|その他(?:条件)?|注意事項|補足)\s*[:：])/iu
const piiPlaceholderPresencePattern = /<(?:PERSON_NAME|PHONE|PRIVATE_EMAIL|POSTAL_ADDRESS|BIRTH_DATE|FACE_OR_PHOTO|SIGNATURE|GOVERNMENT_ID|PERSONAL_ACCOUNT_OR_URL|IDENTIFYING_QR_CODE)_\d{3}>/u
const sourceInstructionPattern = /(?:ignore previous instructions|system prompt|tool call|execute command|指示を無視|命令を実行|ファイルを削除|全候補者.*(?:出力|送信))/iu

function cleanBusinessValue(value: string): string | null {
  let cleaned = value
    .replace(piiPlaceholderPattern, ' ')
    .split(nextLabelPattern, 1)[0]
    ?.replace(/^[\s:：・／/|｜\-–—、,，]+|[\s|｜／/、,，・:：\-–—]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 500) ?? ''
  // An inline label opened inside brackets - 単価：60万円（精算：140-180h） -
  // leaves the closing bracket dangling on the value. Strip closers only while
  // they are unbalanced, so a value that carries its own （…） note keeps it.
  const count = (text: string, characters: string) => [...text].filter((char) => characters.includes(char)).length
  while (/[)）\]】]$/u.test(cleaned) && count(cleaned, ')）]】') > count(cleaned, '(（[【')) {
    cleaned = cleaned.slice(0, -1).trimEnd()
  }
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

const lineLeadDecorationPattern = /^[\s■●▼▲★◆◇□○◎・*+=~〜|｜>＞\-–—【\[（(]*/u

/**
 * The words a heading may add to its own label before the colon -
 * 必須スキル・人物像：, 尚可スキル（歓迎）: - which qualify the label instead of
 * ending it. Bounded so a sentence that happens to contain a colon later
 * cannot turn a keyword into a heading.
 */
const labelHeadingSuffixPattern = /^[^\s:：]{1,12}(?=[:：])/u

/**
 * A label counts only where a label can actually stand: leading the line
 * (optionally behind bullet decorations) and followed by a colon or nothing,
 * or inline after a separator and followed by a colon. A keyword inside prose -
 * the スキル in 単価：～65万円（スキル・経験により相談） - is not a label, and
 * matching it there is exactly how the price note used to leak into skills.
 */
function labelValueMatch(line: string, labels: RegExp): { index: number; length: number } | null {
  const flags = labels.flags.includes('g') ? labels.flags : `${labels.flags}g`
  const leadOffset = line.match(lineLeadDecorationPattern)?.[0]?.length ?? 0
  for (const match of line.matchAll(new RegExp(labels.source, flags))) {
    const index = match.index ?? 0
    // A heading written as 【必要スキル】 or [尚可] ends at its closing bracket.
    const rest = line.slice(index + match[0].length)
    const after = rest.replace(/^[\s】\]）)]+/u, '')
    const hasColon = /^\s*[:：]/u.test(after)
    if (index === leadOffset) {
      if (hasColon || after.trim().length === 0) return { index, length: match[0].length }
      // A heading may qualify its own label before the colon -
      // ■必須スキル・人物像： - and still opens that field's section.
      const suffix = labelHeadingSuffixPattern.exec(after)?.[0]
      if (suffix) return { index, length: match[0].length + (rest.length - after.length) + suffix.length }
    }
    if (index > 0 && hasColon && /[\s（(、／/・｜|]/u.test(line[index - 1] ?? '')) {
      return { index, length: match[0].length }
    }
  }
  return null
}

function valueAfterLabel(lines: string[], labels: RegExp): { value: string; line: string } | null {
  for (const line of lines) {
    const match = labelValueMatch(line, labels)
    if (!match) continue
    const after = line.slice(match.index + match.length).replace(/^\s*[:：]?\s*/u, '')
    const value = cleanBusinessValue(after)
    if (value) return { value, line }
  }
  return null
}

const itemBulletPattern = /^[\s\u3000]*[・\-–—*+>＞]/u

const sectionStopLeadPattern =
  /^(?:必須|必要|尚可|歓迎|優遇|技術要件|スキル|単価|月額|金額|精算|勤務|就業|場所|現場|最寄|リモート|テレワーク|在宅|出社|開始|参画|稼働|作業期間|工数|日本語|語学|面談|面接|商流|契約|所属|支払|就労|ビザ|募集|ポジション|役割|ロール|案件|概要|期間|人数|業界|業種|備考|特記|注意|補足|留意|その他|条件|内容)/u

/**
 * Reads a labeled section written as a heading with its items on the following
 * lines, stopping at the next heading. Bounded on purpose: nothing is guessed
 * past the section's own lines.
 */
function labeledSection(lines: string[], labels: RegExp): { value: string; line: string } | null {
  for (const [index, line] of lines.entries()) {
    const match = labelValueMatch(line, labels)
    if (!match) continue
    const inline = cleanBusinessValue(line.slice(match.index + match.length).replace(/^\s*[:：]?\s*/u, ''))
    if (inline) return { value: inline, line }
    const items: string[] = []
    for (let cursor = index + 1; cursor < lines.length && items.length < 6; cursor += 1) {
      const candidate = lines[cursor]!
      const stripped = candidate.replace(lineLeadDecorationPattern, '').trim()
      if (!stripped) break
      // An item bullet (・, -, *) is content even when it starts with a heading
      // word - 「・面談は1回を想定」 under 備考. Only heading-like lines end
      // the section: a bare stop word, a ■/【 heading, or a label with a colon.
      const isItem = itemBulletPattern.test(candidate)
      if (!isItem && (sectionStopLeadPattern.test(stripped) || /^[^:：]{1,24}[:：]/u.test(stripped))) break
      items.push(stripped)
    }
    if (items.length > 0) return { value: items.join('、').slice(0, 500), line }
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
  // 必須スキル reads only its own section - inline value or the lines under its
  // heading - never a スキル mention inside another field's prose.
  const labeled = labeledSection(lines, /(?:必須(?:スキル|要件|経験)?|必要(?:スキル|要件|経験)|技術要件|スキル)/iu)
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

/** Field values extracted outside the deterministic parser, keyed by field. */
export type JobCaseFieldOverrides = Partial<Record<JobCaseFieldKey, string>>

/** Confidence of an externally extracted value that passed verbatim verification. */
const overrideFieldConfidence = 0.8

const englishRequirementPattern = /(?:英会話|英語|英会话|英语)/u
const bareLanguageNamePattern = /^(?:英会話|英語|英会话|英语)$/u

/** A stated process range - 基本設計～開発, 要件定義～, 設計から～. */
const workPhaseRangePattern =
  /^(?:要件定義|基本設計|詳細設計|外部設計|内部設計|設計|開発|製造|テスト|試験|構築|移行|運用|保守)[^、，]{0,8}[~〜～]$/u

/** A title that describes the person wanted rather than the work - 経験者, 年以上, できる方. */
const requirementLikeTitlePattern =
  /(?:経験者|经验者|経験|经验|年以上|スキル|技能|エンジニア|開発者|开发者|できる方|可能な方|有识者|有識者)/u

/** Confidence of a value read from a one-line shorthand by token classification. */
const shorthandFieldConfidence = 0.7

/**
 * The record number a chat shorthand opens with - 案件1️⃣：, 案件名：, ①：,
 * (2)： - which is not part of the name.
 */
const caseNumberPrefixPattern =
  /^[\s\u3000■●▼▲★◆◇□○◎・*【\[（(]*(?:(?:案件名|案件|件名|タイトル|案件概要|案件情報|募集案件)[\s\u3000]*(?:[0-9０-９]{1,2}\uFE0F?\u20E3?|[①-⑳❶-❿]|[（(][0-9０-９]{1,2}[）)])?[\s\u3000】\]）)]*[:：]|(?:[0-9０-９]{1,2}\uFE0F?\u20E3|[①-⑳❶-❿])[\s\u3000】\]）)]*[:：]?)[\s\u3000]*/u

/**
 * A line that only opens a record - 案件1, 案件②。 - or only separates two of
 * them - a dotted rule, a line of dashes. Neither states anything: the record
 * itself starts on the next business line.
 */
const recordRootOnlyLinePattern =
  /^[\s\u3000■●▼▲★◆◇□○◎・*【\[（(]*案件[\s\u3000]*(?:[0-9０-９]{1,3}\uFE0F?\u20E3?|[①-⑳❶-❿]|[一二三四五六七八九十]{1,3})[\s\u3000】\]）)]*[。．.、]?$/u
const separatorOnlyLinePattern = /^[\s\u3000.．・…‥ー―─━＿_=＝*＊~〜～^＾#＃▁+＋\-–—]+$/u

/**
 * A bullet that states only when and where - ・10月～／白山 - carries the start
 * date and the location without naming either field.
 */
const bulletPeriodPlacePattern =
  /^[\s\u3000・\-–—*+>＞]+((?:[0-9０-９]{1,2}月|即日|来月|今月|翌月|ASAP)[^\s\u3000／/、，,]{0,10})[\s\u3000]*[／/][\s\u3000]*([^\s\u3000／/、，,。]{1,20})$/u

function bulletPeriodAndPlace(lines: string[]): { startDate: string; location: string; line: string } | null {
  for (const line of lines) {
    const match = bulletPeriodPlacePattern.exec(line)
    if (match?.[1] && match[2]) return { startDate: match[1], location: match[2], line }
  }
  return null
}

/**
 * What separates one shorthand token from the next. The full-width ＋ chains
 * requirements the same way 、 does (要件定義＋前後端開発＋顧客対応経験); the
 * ASCII + is left alone because it belongs to names like VC++ and C#.
 * ⇒ / → open the status tail - 10月～, 終面調整中 - which is classified the
 * same way every other token is.
 */
const shorthandTokenSeparator = /[、，,;；。＋\u3000]+|[\s]*(?:➡|→|⇒|=>)[\s]*/u

/** A requirement label a token may carry: 【必須】英会話流暢. */
const shorthandTokenLabelPattern = /^【[^】]{1,10}】[\s]*/u

/**
 * A work style stated in brackets on a token that means something else -
 * Experience clould経験（常駐） - belongs to リモート, and the token keeps the
 * rest as what it always was.
 */
const shorthandWorkStylePattern =
  /[（(]([^（()）]*(?:常駐|常驻|在宅|リモート|テレワーク|出社|出勤|フルリモ|ハイブリッド)[^（()）]*)[）)]/u

type ShorthandTokenKey =
  | 'required_skills' | 'role' | 'japanese_level' | 'location' | 'remote'
  | 'headcount' | 'interview' | 'rate' | 'start_date' | 'notes'

/**
 * What a bare shorthand token can only mean. Conditions are recognised by
 * their own words; a technology is anything that names a tool or language;
 * a role ends in a work word; the rest is a note.
 */
function classifyShorthandToken(token: string): ShorthandTokenKey {
  // 英会話流暢 is a language requirement of its own and never a Japanese level.
  // A bare 英語 states no level and no degree: it stays the unclassified
  // condition it has always been.
  if (englishRequirementPattern.test(token) && !/(?:日本語|日语)/u.test(token)) {
    return bareLanguageNamePattern.test(token) ? 'notes' : 'required_skills'
  }
  if (/(?:日本語|日语|JLPT|(?<![A-Za-z])N[1-5](?![A-Za-z0-9])|ネイティブ|ビジネスレベル|流暢|流畅)/u.test(token)) return 'japanese_level'
  if (/(?:都内|東京|大阪|名古屋|福岡|神奈川|埼玉|千葉|横浜|関西|関東|勤務地|[^\s、]{1,6}駅|[^\s、]{1,4}区(?![A-Za-z])|出勤)/u.test(token)) return 'location'
  if (/(?:在宅|リモート|テレワーク|常駐|常驻|出社|フルリモ|ハイブリッド)/u.test(token)) return 'remote'
  if (/^(?:[0-9０-９]{1,3}|[一二三四五六七八九十]|数)[\s]*(?:名|人)(?![A-Za-z])/u.test(token)) return 'headcount'
  if (/(?:面談|面接)/u.test(token)) return 'interview'
  if (/(?:[0-9０-９]+[\s]*(?:万円?|k|K)(?![A-Za-z])|単価|単金|￥|¥)/u.test(token)) return 'rate'
  if (/^(?:[0-9０-９]{1,2}月|[0-9０-９]{4}[\/年]|即日|ASAP|asap|長期|超長期|来月|今月|翌月)|(?:開始|参画|稼働|スタート)/u.test(token)) return 'start_date'
  if (requirementLikeTitlePattern.test(token)) return 'required_skills'
  if (/^(?:PM|PL|PMO|SE|PG|TL|BSE|BrSE)$/iu.test(token)) return 'role'
  if (/[A-Za-z]/u.test(token)) return 'required_skills'
  // A process range - 設計から～, 要件定義～ - names the work, not a condition.
  if (workPhaseRangePattern.test(token)) return 'role'
  if (/(?:開発|設計|テスト|試験|運用|保守|構築|支援|管理|担当|リーダー|エンジニア|コンサル|ディレクター|マネージャー)$/u.test(token)) return 'role'
  return 'notes'
}

interface ShorthandCase {
  /** The line without its record number; what an override is compared against. */
  line: string
  title: string
  skills: string[]
  fields: Partial<Record<ShorthandTokenKey, string>>
}

/** "SE 2名" is a role and a headcount; split before classifying. */
const roleWithHeadcountPattern = /^(.+?)[\s]*([0-9０-９]{1,3}[\s]*(?:名|人))$/u

/**
 * Reads a one-line chat shorthand - 案件2️⃣：COBOL／Java｜AWS（Aurora）、Shell、JCL、常駐、日本語流暢 -
 * whose fields are bare tokens instead of labels. The name is the technical
 * description, the skill and role tokens with the conditions removed and the
 * ｜ groups kept, so a single technology is never cut out to name the case.
 * A line that carries its own labels is left to the label parser.
 */
export function parseShorthandCaseLine(line: string): ShorthandCase | null {
  const stripped = line.replace(caseNumberPrefixPattern, '').trim()
  if (!stripped || /^[^:：]{1,24}[:：]/u.test(stripped) || nextLabelPattern.test(stripped)) return null
  // A shorthand is a list of tokens; a sentence - Pythonエンジニアを募集しています -
  // is prose for the label and vocabulary parsers.
  if (!/[、，,;；｜|➡→⇒]/u.test(stripped) || /(?:です|ます|ました|ません|ください|お願い)/u.test(stripped)) return null
  const values = new Map<ShorthandTokenKey, string[]>()
  const titleSegments: string[] = []
  for (const segment of stripped.split(/[|｜]/u)) {
    const work: string[] = []
    const classify = (token: string): void => {
      const key = classifyShorthandToken(token)
      values.set(key, [...(values.get(key) ?? []), token])
      if (key === 'required_skills' || key === 'role') work.push(token)
    }
    for (const raw of segment.split(shorthandTokenSeparator)) {
      // The same cleaning every field value gets: a redaction placeholder
      // never survives into a value, so a token that was only a placeholder
      // disappears and one that carried it keeps the rest.
      const cleaned = cleanBusinessValue(raw.replace(/^[\s・\-–—]+|[\s・\-–—]+$/gu, ''))
        ?.replace(/[（(]\s*[）)]/gu, '')
        .replace(shorthandTokenLabelPattern, '')
        .trim()
      if (!cleaned) continue
      // 「Experience clould経験（常駐）」 states a requirement and a work style:
      // the work style is its own value and the requirement keeps the rest.
      const workStyle = shorthandWorkStylePattern.exec(cleaned)?.[1]?.trim()
      const token = workStyle
        ? cleaned.replace(shorthandWorkStylePattern, '').replace(/[\s・、，]+$/u, '').trim()
        : cleaned
      if (workStyle) values.set('remote', [...(values.get('remote') ?? []), workStyle])
      if (!token) continue
      const roleWithHeadcount = token.match(roleWithHeadcountPattern)
      if (roleWithHeadcount?.[1] && roleWithHeadcount[2]) {
        classify(roleWithHeadcount[1].trim())
        classify(roleWithHeadcount[2].trim())
        continue
      }
      classify(token)
    }
    if (work.length > 0) titleSegments.push(work.join('、'))
  }
  if (titleSegments.length === 0) return null
  const fields: ShorthandCase['fields'] = {}
  for (const [key, tokens] of values) fields[key] = tokens.join('、').slice(0, 500)
  return { line: stripped, title: titleSegments.join('｜').slice(0, 500), skills: values.get('required_skills') ?? [], fields }
}

/**
 * Builds the review draft from the redacted source. `fieldOverrides` carries
 * values extracted elsewhere - the redacted cloud lane - in the same
 * placeholder space as the source; an override wins over the label-based
 * local value for its key, goes through the same cleaning, and still lands as
 * `needs_review`. Keys without a usable override fall back to local parsing.
 */
export function extractJobCaseDraft(
  rawSource: JobCaseSource,
  reviewId: string,
  now = new Date(),
  fieldOverrides: JobCaseFieldOverrides = {},
  intakeBatchId: string | null = null,
  aliases: JobCaseFieldAliasMap = {}
): JobCaseExtractionDraftV2 {
  const source = jobCaseSourceSchema.parse(rawSource)
  let appliedOverrides = 0
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
  // A partner's own labels are rewritten to the built-in ones before the
  // label parser runs, so an alias behaves exactly like the label it maps to.
  const lines = bodyLines(source.redactedBody).map((line) => canonicalizeJobCaseLabelLine(line, aliases))
  // A record that is one chat line is a shorthand: its fields are bare tokens.
  // A leading 案件N line and the dotted rules around it open and separate the
  // record without stating anything, so the record's own lines are what is read.
  const businessLines = source.redactedBody.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  const recordLines = businessLines.filter(
    (line) => !recordRootOnlyLinePattern.test(line) && !separatorOnlyLinePattern.test(line)
  )
  const shorthand = recordLines.length === 1
    ? parseShorthandCaseLine(canonicalizeJobCaseLabelLine(recordLines[0]!, aliases))
    : null
  const shorthandSource = (): JobCaseFieldSource[] => [{ sourceLabel: bodyLabel, excerpt: excerpt(recordLines[0] ?? '') }]
  // The line the record is named from: its subject, unless the subject is only
  // the record's number, in which case its first business line is.
  const heading = recordRootOnlyLinePattern.test(source.redactedSubject.trim())
    ? recordLines[0] ?? source.redactedSubject
    : source.redactedSubject
  const bullet = bulletPeriodAndPlace(lines)
  const shorthandValue = (key: JobCaseFieldKey): string | null =>
    shorthand && key !== 'title' && key in shorthand.fields ? shorthand.fields[key as ShorthandTokenKey] ?? null : null
  const fields = fieldDefinitions.map((definition) => {
    const rawOverride = fieldOverrides[definition.key]
    const cleanedOverride = rawOverride ? cleanBusinessValue(rawOverride) : null
    const normalizedOverride = cleanedOverride && definition.key === 'work_authorization'
      ? normalizedJobCaseWorkAuthorizationRequirement(cleanedOverride)
      : cleanedOverride
    // An override that is the whole shorthand line - the model copied the
    // line into 備考 or 必須スキル instead of a value - is not a field value.
    const override = normalizedOverride && shorthand && definition.key !== 'title'
      && normalizedOverride.length >= Math.ceil(shorthand.line.length * 0.9)
      ? null
      : normalizedOverride
    if (override) {
      if (definition.key === 'title' && shorthand && shorthand.title !== override && shorthand.title.includes(override)) {
        // The cloud lane named the case after one technology cut out of the
        // list; the shorthand's own technical description is the name.
        return makeField(definition, shorthand.title, shorthandFieldConfidence, [{ sourceLabel: subjectLabel, excerpt: excerpt(source.redactedSubject) }])
      }
      appliedOverrides += 1
      if (definition.key === 'required_skills' && shorthand && shorthand.skills.length > 0) {
        // Every technology the line names is a requirement, whether or not
        // the cloud lane listed it.
        const missing = shorthand.skills
          .flatMap((skill) => skill.split(/[／/]/u).map((part) => part.trim()).filter(Boolean))
          .filter((part) => !containsSkill(override, part))
        if (missing.length > 0) {
          return makeField(definition, `${override}、${missing.join('、')}`.slice(0, 500), overrideFieldConfidence, [{ sourceLabel: bodyLabel, excerpt: excerpt(rawOverride!) }, ...shorthandSource()])
        }
      }
      return makeField(definition, override, overrideFieldConfidence, [{ sourceLabel: bodyLabel, excerpt: excerpt(rawOverride!) }])
    }
    if (definition.key === 'title') {
      if (shorthand) return makeField(definition, shorthand.title, shorthandFieldConfidence, [{ sourceLabel: subjectLabel, excerpt: excerpt(heading) }])
      // A pasted heading often carries its own label - 案件名: X, 案件1： -
      // which is not part of the name.
      const subject = heading.replace(caseNumberPrefixPattern, '')
      const title = cleanBusinessValue(subject) ?? cleanBusinessValue(heading)
      return makeField(definition, title, 0.98, title ? [{ sourceLabel: subjectLabel, excerpt: excerpt(heading) }] : [])
    }
    if (definition.key === 'required_skills') {
      // A shorthand line has no 必須スキル label, so its technology tokens are
      // the list; the vocabulary scan would only catch the ones it knows.
      if (shorthand && shorthand.skills.length > 0) {
        return makeField(definition, shorthand.skills.join('、').slice(0, 500), shorthandFieldConfidence, shorthandSource())
      }
      const skills = skillField(lines, source.redactedBody)
      return makeField(
        definition,
        skills?.value ?? null,
        skills?.confidence ?? 0,
        skills ? [{ sourceLabel: bodyLabel, excerpt: excerpt(skills.line) }] : []
      )
    }
    if (definition.key === 'preferred_skills' || definition.key === 'notes') {
      // Both are usually written as a heading with items beneath it, like 必須スキル.
      const section = definition.labels ? labeledSection(lines, definition.labels) : null
      if (!section && shorthandValue(definition.key)) {
        return makeField(definition, shorthandValue(definition.key), shorthandFieldConfidence, shorthandSource())
      }
      return makeField(
        definition,
        section?.value ?? null,
        0.86,
        section ? [{ sourceLabel: bodyLabel, excerpt: excerpt(section.line) }] : []
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
    if (!extracted && bullet && (definition.key === 'start_date' || definition.key === 'location')) {
      const value = definition.key === 'start_date' ? bullet.startDate : bullet.location
      return makeField(definition, value, 0.8, [{ sourceLabel: bodyLabel, excerpt: excerpt(bullet.line) }])
    }
    if (!extracted && shorthandValue(definition.key)) {
      return makeField(definition, shorthandValue(definition.key), shorthandFieldConfidence, shorthandSource())
    }
    return makeField(
      definition,
      extracted?.value ?? null,
      extracted ? 0.86 : 0,
      extracted ? [{ sourceLabel: bodyLabel, excerpt: excerpt(extracted.line) }] : []
    )
  })
  // A shorthand record often names the person it wants instead of listing
  // skills - デジタルカメラ测试经验者 - and that phrase becomes the title. It
  // is the requirement: mirror it into 必須スキル when nothing else filled
  // that field, so matching has a term to score instead of an empty case.
  const skillsIndex = fields.findIndex((field) => field.key === 'required_skills')
  const titleValue = fields.find((field) => field.key === 'title')?.value ?? null
  if (skillsIndex >= 0 && titleValue && !fields[skillsIndex]!.value && requirementLikeTitlePattern.test(titleValue)) {
    fields[skillsIndex] = makeField(
      fieldDefinitions[skillsIndex]!,
      titleValue,
      0.6,
      [{ sourceLabel: subjectLabel, excerpt: excerpt(titleValue) }]
    )
  }
  const warnings = new Set(source.warningCodes)
  warnings.add('DETERMINISTIC_EXTRACTION_REQUIRES_REVIEW')
  if (appliedOverrides > 0) warnings.add('CLOUD_ASSISTED_FIELD_EXTRACTION')
  if (piiPlaceholderPresencePattern.test(`${source.redactedSubject}\n${source.redactedBody}`)) {
    warnings.add('SOURCE_CONTAINS_PII_PLACEHOLDERS')
  }
  if (!fields.find((field) => field.key === 'required_skills')?.value) warnings.add('REQUIRED_SKILLS_MISSING')
  if (statesNationalityRestriction(source.redactedBody)) {
    warnings.add('NATIONALITY_REQUIREMENT_BLOCKED_USE_WORK_AUTHORIZATION')
  }
  if (statesAgeLimitRequirement(source.redactedBody)) warnings.add('AGE_LIMIT_REQUIRES_REVIEW')
  return jobCaseExtractionDraftSchema.parse({
    version: 'job-case-extraction-v2',
    reviewId,
    sourceId: source.id,
    sourceType: source.sourceType,
    threadId: source.threadId,
    fields,
    warningCodes: [...warnings],
    requiresReview: true,
    createdAt: now.toISOString(),
    ...(intakeBatchId ? { intakeBatchId } : {})
  }) as JobCaseExtractionDraftV2
}

/**
 * The draft as the agent may see it: field values from the locally redacted
 * draft, its review state, and the confirmed case reference. The redacted
 * subject, sender, thread and preview never leave the review record.
 */
export function agentJobCaseDraftFacts(review: JobCaseReviewSnapshot, label: string): AgentJobCaseDraftFacts {
  return {
    reviewId: review.reviewId,
    label,
    title: review.fields.find((field) => field.key === 'title')?.value ?? null,
    reviewStatus: review.status,
    lifecycle: review.lifecycle,
    jobCase: review.jobCase ? { id: review.jobCase.id, version: review.jobCase.version } : null,
    fields: review.fields.map((field) => ({ key: field.key, label: field.label, value: field.value, status: field.status })),
    warningCodes: review.warningCodes,
    status: 'current'
  }
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

