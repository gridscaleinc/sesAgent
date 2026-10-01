import { generatePersonnelProposal } from './personnel-proposal'
import { z } from 'zod'
import {
  candidateFieldKeys,
  type CandidateFieldKey,
  type CandidateProfileSearchResult,
  type CandidateReviewSnapshot,
  type CandidateMatchAssessment
} from './contracts'
import { businessMatchingPolicyVersion, qualificationStatus, type BusinessMatchQualification } from './matching-requirements'

export const businessBatchCharacterLimit = 100_000
export const businessIntakeSegmentLimit = 3_900

export interface BusinessBatchSegment {
  text: string
  startLine: number
  endLine: number
}

/** Split only at explicit record boundaries. Oversize records stay whole for review. */
export function splitBusinessBatch(text: string, kind: 'mixed' | 'case' = 'mixed'): BusinessBatchSegment[] {
  if (text.length > businessBatchCharacterLimit) throw new Error('一次最多整理 100,000 字 / 1回100,000文字まで')
  const lines = text.replace(/\r\n?/gu, '\n').split('\n')
  const root =
    kind === 'case'
      ? /^(?:【(?:案件(?:情報|[0-9０-９①-⑳一二三四五六七八九十]+)?|案件名|案件名称|项目名称|项目名|プロジェクト名)】|[■◆●]?\s*(?:案件名|案件名称|项目名称|项目名|プロジェクト名)\s*[:：]|案件\s*[0-9０-９①-⑳一二三四五六七八九十]+)/u
      : /^(?:【(?:案件|案件情報|人员|人員|要員|人材)】|(?:案件名|氏名|姓名|イニシャル)\s*[:：]|【(?:案件名|氏名|姓名|イニシャル)】|案件\s*[0-9①-⑳一二三四五六七八九十]+|(?:人员|要員)\s*[0-9①-⑳]+)/u
  const separator = /^[-_=─━.・]{4,}$/u
  const records: BusinessBatchSegment[] = []
  let start = 0
  let hasRoot = false
  const flush = (end: number) => {
    let first = start
    let last = end
    while (first < last && !lines[first]!.trim()) first++
    while (last > first && !lines[last - 1]!.trim()) last--
    if (last > first) records.push({ text: lines.slice(first, last).join('\n'), startLine: first + 1, endLine: last })
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (separator.test(line)) {
      // Decorative rules inside a titled case do not turn its conditions into another case.
      const next = lines
        .slice(i + 1)
        .find((item) => item.trim() && !separator.test(item.trim()))
        ?.trim()
      if (kind === 'case' && hasRoot && next && !root.test(next)) continue
      flush(i)
      start = i + 1
      hasRoot = false
      continue
    }
    if (root.test(line)) {
      // A standalone type tag followed by the record's title/name is one record.
      const previous = lines.slice(start, i).filter((item) => item.trim())
      const tagOnly =
        previous.length === 1 &&
        (kind === 'case'
          ? /^(?:【案件(?:情報|[0-9０-９①-⑳一二三四五六七八九十]+)?】|案件\s*[0-9０-９①-⑳一二三四五六七八九十]+)$/u
          : /^【(?:案件|案件情報|人员|人員|要員|人材)】$/u
        ).test(previous[0]!.trim())
      if (hasRoot && !tagOnly) {
        flush(i)
        start = i
      }
      hasRoot = true
    }
  }
  flush(lines.length)
  // Keep short records separate: local fallback and retries then remain per record.
  if (records.length > 200) throw new Error('一次最多 200 段，请分批整理 / 1回200件まで')
  return records
}

export const candidateBusinessStatuses = ['available', 'soon', 'paused', 'assigned'] as const
export type CandidateBusinessStatus = (typeof candidateBusinessStatuses)[number]
// Imported personnel are available by default; HR may later mark them unavailable.
export const isPersonnelAvailable = (status: CandidateBusinessStatus | null | undefined) =>
  !status || status === 'available' || status === 'soon'
export interface CandidateBusinessState {
  documentId: string
  status: CandidateBusinessStatus
  profileVersion: number
  confirmedAt: string
  actorId: string
}

export interface PersonnelTemplate {
  id: string
  name: string
  bodyJa: string
  bodyZh: string
  revision: number
}
const templateKeys = new Set<string>(['label', ...candidateFieldKeys])
const templateText = z
  .string()
  .trim()
  .min(1)
  .max(3_000)
  .refine(
    (value) =>
      !/[{}]/u.test(value.replace(/\{\{[^{}]+\}\}/gu, '')) &&
      [...value.matchAll(/\{\{([^{}]+)\}\}/gu)].every((match) => templateKeys.has(match[1]!.trim())),
    '模板字段无效 / テンプレート項目が無効です'
  )
export const savePersonnelTemplateSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    bodyJa: templateText,
    bodyZh: templateText,
    revision: z.number().int().nonnegative()
  })
  .strict()
export const candidateBusinessStateInputSchema = z
  .object({
    documentId: z.string().uuid(),
    profileVersion: z.number().int().nonnegative(),
    reviewRevision: z.number().int().positive().optional(),
    status: z.enum(candidateBusinessStatuses),
    confirmed: z.literal(true)
  })
  .strict()
  .refine(
    (input) => input.profileVersion > 0 || input.reviewRevision !== undefined,
    '未确认资料需要当前审核版本 / 未確認情報には現在の確認バージョンが必要です'
  )
export type SetCandidateBusinessStateInput = z.infer<typeof candidateBusinessStateInputSchema>

export const personnelMessageInputSchema = z
  .object({
    subject: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .refine((value) => !/[\r\n]/u.test(value))
      .optional(),
    experienceRunId: z.string().uuid().optional(),
    documentId: z.string().uuid(),
    profileVersion: z.number().int().positive(),
    templateId: z.string().uuid(),
    reviewRevision: z.number().int().positive().optional(),
    caseContext: z.object({ reviewId: z.string().uuid(), version: z.number().int().positive() }).strict().optional(),
    templateRevision: z.number().int().positive(),
    lang: z.enum(['ja', 'zh']),
    text: z.string().trim().min(1).max(4_000)
  })
  .strict()
export type PersonnelMessageInput = z.infer<typeof personnelMessageInputSchema>
export interface PersonnelCopy {
  id: string
  documentId: string
  profileVersion: number
  templateId: string
  templateRevision: number
  lang: 'ja' | 'zh'
  createdAt: string
}
export interface PersonnelWorkspace {
  templates: PersonnelTemplate[]
  states: CandidateBusinessState[]
  copies: PersonnelCopy[]
}
export interface PersonnelCaseMatch {
  rulePreference?: number
  ranking?: import('./experience-ranking').RankingAdjustment
  experienceRunId?: string
  appliedRules?: import('./ai-work-rules').AppliedWorkRule[]
  reviewId: string
  jobCaseId: string
  title: string
  score: number | null
  matched: string[]
  missing: string[]
  hardFilters: CandidateProfileSearchResult['retrieval']['hardFilters']
  jobCaseVersion: number
  assessment?: CandidateMatchAssessment
  qualification?: BusinessMatchQualification
}
export interface PersonnelCaseMatchResult {
  rulesRevision?: number
  documentId: string
  profileVersion: number
  items: PersonnelCaseMatch[]
  localMatchCount: number
  ownCompanyExcludedCount?: number
  searchedCount?: number
  excludedCount?: number
  excludedRequirements?: string[]
  cloud: {
    status: 'reviewed' | 'partial' | 'unavailable' | 'failed' | 'not-needed'
    reviewedCount: number
    modelName: string | null
    reason?: 'policy-refresh' | 'service-unavailable' | 'request-failed' | 'no-valid-result' | 'insufficient-credits' | 'sign-in-required'
  }
}

export interface CasePersonnelMatch extends Omit<PersonnelCaseMatch, 'reviewId' | 'jobCaseId' | 'jobCaseVersion' | 'title'> {
  assessmentId?: string
  documentId: string
  profileVersion: number
}
export interface CasePersonnelMatchResult {
  assessedAt?: string
  rulesRevision?: number
  jobCaseId: string
  jobCaseVersion: number
  items: CasePersonnelMatch[]
  localMatchCount: number
  /** People added by local semantic recall (no keyword evidence) and sent to the cloud review. */
  semanticRecallCount?: number
  ownCompanyExcludedCount?: number
  searchedCount?: number
  excludedCount?: number
  excludedRequirements?: string[]
  cloud: PersonnelCaseMatchResult['cloud']
}

/** A case the 找案件 workspace lists for a person: recommended, or needing confirmation without an exclusion. */
export function isListedPersonnelCaseMatch(item: PersonnelCaseMatch): boolean {
  return (
    item.qualification?.policyVersion === businessMatchingPolicyVersion &&
    (item.qualification.status === 'recommended' ||
      (item.qualification.status === 'needs-confirmation' && qualificationStatus(item.qualification.requirements) !== 'excluded'))
  )
}
/** The latest completed 找案件 run for a person, kept in the encrypted database across restarts. */
export interface StoredPersonnelCaseMatchRun {
  result: PersonnelCaseMatchResult
  /** ISO time the run finished. */
  searchedAt: string
  /** Sorted `${jobCaseId}:${version}` of the active cases searched; a new, closed or edited case makes the run stale. */
  caseSignature: string
  policyVersion: string
}
/** What the personnel list needs for the 「查看案件 (n)」 badge without loading every stored run. */
export interface PersonnelCaseMatchRunSummary {
  documentId: string
  profileVersion: number
  rulesRevision: number
  policyVersion: string
  caseSignature: string
  searchedAt: string
  listedCount: number
}

/**
 * What the case list needs for the 「查看人员 (n)」 button without loading every case's saved assessments.
 * `listedCount` applies the people panel's rules to the latest saved assessment of each person.
 */
export interface CaseSearchSummary {
  reviewId: string
  listedCount: number
  /** Latest saved search assessment for this case, or null when only specified assessments exist. */
  lastSearchedAt: string | null
}
/** Normalized display name used to collapse duplicate records of one person; empty when there is no name. */
export const candidateIdentityKey = (person?: Pick<CandidateReviewSnapshot, 'localIdentity'>) =>
  (person?.localIdentity?.displayName ?? '').normalize('NFKC').replace(/\s+/gu, '').toLowerCase()
/** Two records with the same identity key are the same human when the file or a project title is shared. */
export function sameCandidateRecord(
  a?: Pick<CandidateReviewSnapshot, 'fileName' | 'projectExperiences'>,
  b?: Pick<CandidateReviewSnapshot, 'fileName' | 'projectExperiences'>
): boolean {
  if (!a || !b) return false
  if (a.fileName && a.fileName === b.fileName) return true
  const titles = new Set((a.projectExperiences ?? []).map((project) => project.title).filter(Boolean))
  return (b.projectExperiences ?? []).some((project) => project.title && titles.has(project.title))
}

/** Phone digits only, so 090-1234-5678 and 09012345678 compare equal. */
const phoneKey = (value?: string | null) => (value ?? '').normalize('NFKC').replace(/\D/gu, '')
// Spacing, punctuation and every kind of dash (1-2-3, 1‐2‐3, 1ー2ー3) are left out of the comparison.
const addressKey = (value?: string | null) =>
  (value ?? '').normalize('NFKC').replace(/[\s\p{P}ー−]/gu, '').toLowerCase()
/** Birth year, read from a birth date (1985年3月, 1985/03/01) or from an age (39歳) as of `now`. */
function birthYear(value: string | null | undefined, now: Date): number | null {
  const text = (value ?? '').normalize('NFKC')
  const year = /(19|20)\d{2}/u.exec(text)
  if (year) return Number(year[0])
  const age = /(\d{1,2})\s*(?:歳|才|岁|yo)/u.exec(text) ?? /^\s*(\d{1,2})\s*$/u.exec(text)
  return age ? now.getFullYear() - Number(age[1]) : null
}
/**
 * The same human for import purposes: the same name and, on top of it, the same mobile number, the same address or
 * the same age. A name alone is not enough (two people can share one), so such a person is imported as someone new.
 */
export function samePersonByDetails(
  a?: Pick<CandidateReviewSnapshot, 'localIdentity'>,
  b?: Pick<CandidateReviewSnapshot, 'localIdentity'>,
  now = new Date()
): boolean {
  const key = candidateIdentityKey(a)
  if (!key || key !== candidateIdentityKey(b)) return false
  const left = a?.localIdentity,
    right = b?.localIdentity
  const phone = phoneKey(left?.phone)
  if (phone.length >= 8 && phone === phoneKey(right?.phone)) return true
  const address = addressKey(left?.address)
  if (address.length >= 4 && address === addressKey(right?.address)) return true
  const born = birthYear(left?.birthDate, now),
    otherBorn = birthYear(right?.birthDate, now)
  // An age read on another day can be a year apart from a birth year: within one year counts as the same age.
  return born !== null && otherBorn !== null && Math.abs(born - otherBorn) <= 1
}

export function builtInPersonnelTemplates(): PersonnelTemplate[] {
  return [
    {
      id: 'e72e12d0-0000-4000-8000-000000000001',
      name: '微信群简版 / チャット短文',
      revision: 1,
      bodyJa:
        '【要員紹介】{{label}}\nスキル：{{skills}}\n経験：{{experience_years}}\n稼働：{{availability}}\n単価：{{rate}}\n日本語：{{japanese_level}}\n勤務形態：{{work_style}}\nご紹介可能な案件がございましたら、お知らせください。',
      bodyZh:
        '【人员介绍】{{label}}\n技能：{{skills}}\n经验：{{experience_years}}\n可上岗：{{availability}}\n单价：{{rate}}\n日语：{{japanese_level}}\n工作方式：{{work_style}}\n如有合适案件，欢迎联系。'
    },
    {
      id: 'e72e12d0-0000-4000-8000-000000000002',
      name: '邮件详细版 / メール詳細',
      revision: 1,
      bodyJa:
        'お世話になっております。\n下記要員に適した案件を探しております。\n\n【要員】{{label}}\n職種：{{role}}\nスキル：{{skills}}\n経験：{{experience_years}}\n稼働：{{availability}}\n希望単価：{{rate}}\n日本語：{{japanese_level}}\n勤務形態：{{work_style}}\nエリア：{{location}}\n\nご検討のほど、よろしくお願いいたします。',
      bodyZh:
        '您好，现有以下人员寻找合适案件：\n\n【人员】{{label}}\n职种：{{role}}\n技能：{{skills}}\n经验：{{experience_years}}\n可上岗：{{availability}}\n期望单价：{{rate}}\n日语：{{japanese_level}}\n工作方式：{{work_style}}\n区域：{{location}}\n\n如有合适案件，欢迎联系，谢谢。'
    }
  ]
}

export function generatePersonnelMessage(review: CandidateReviewSnapshot, template: PersonnelTemplate, lang: 'ja' | 'zh'): string {
  if (template.revision === 1 && template.id === 'e72e12d0-0000-4000-8000-000000000002')
    return generatePersonnelProposal(review, undefined, lang, template.id.endsWith('1')).text
  const values = new Map<string, string>(review.fields.map((field) => [field.key, field.value ?? '']))
  values.set('label', `${lang === 'ja' ? '要員' : '人员'} ${review.documentId.slice(0, 8).toUpperCase()}`)
  return (lang === 'ja' ? template.bodyJa : template.bodyZh).replace(
    /\{\{([^{}]+)\}\}/gu,
    (_match, key: string) => values.get(key.trim()) || (lang === 'ja' ? '[送信前に記入]' : '[发送前填写]')
  )
}

export const personnelFieldLabels: Record<CandidateFieldKey, readonly [string, string]> = {
  skills: ['技能', 'スキル'],
  experience_years: ['经验', '経験'],
  availability: ['可上岗', '稼働'],
  rate: ['单价', '単価'],
  japanese_level: ['日语', '日本語'],
  work_style: ['工作方式', '勤務形態'],
  role: ['职种', '職種'],
  location: ['区域', 'エリア'],
  work_authorization: ['工作资格', '就労資格']
}

/** Lightweight HR-authored follow-up; independent of formal proposal approval. */
export const saveBusinessFollowUpSchema = z
  .object({
    documentId: z.string().uuid(),
    reviewId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    status: z.enum(['contacted', 'replied', 'interview', 'closed']),
    note: z.string().trim().max(2000),
    nextStep: z.string().trim().max(500)
  })
  .strict()
export type SaveBusinessFollowUpInput = z.infer<typeof saveBusinessFollowUpSchema>
export interface BusinessFollowUp extends Omit<SaveBusinessFollowUpInput, 'expectedRevision'> {
  progress?: import('./business-progress').BusinessProgress
  id: string
  revision: number
  updatedAt: string
  recordedBy: string
  events: Array<{
    status: SaveBusinessFollowUpInput['status']
    note: string
    nextStep: string
    recordedAt: string
    recordedBy: string
    action?: string
    mutationId?: string
    stage?: import('./business-progress').BusinessProgressStage
    roundNumber?: number
    previousInterview?: import('./contracts').CandidateInterviewSnapshot
    previousEntry?: import('./business-progress').ProgressEntry
    entry?: import('./business-progress').ProgressEntry
  }>
}

export const regenerateIntroductionInputSchema = z
  .object({
    kind: z.enum(['case', 'person']),
    id: z.string().uuid(),
    version: z.number().int().positive(),
    lang: z.enum(['zh', 'ja']),
    style: z.enum(['standard', 'brief']),
    caseContext: z.object({ reviewId: z.string().uuid(), version: z.number().int().positive() }).optional(),
    /** What the operator asked for this time, for example "加上他的团队管理经验". Never overrides facts or privacy. */
    request: z.string().trim().min(1).max(500).optional()
  })
  .strict()
export type RegenerateIntroductionInput = z.infer<typeof regenerateIntroductionInputSchema>

/** Stores the latest AI-generated case introduction; each save replaces the previous one per case, language and style. */
export const saveCaseIntroductionDraftsInputSchema = z
  .object({
    reviewId: z.string().uuid(),
    jobCaseVersion: z.number().int().positive(),
    style: z.enum(['standard', 'brief']),
    request: z.string().trim().min(1).max(500).nullable(),
    drafts: z
      .array(
        z
          .object({
            lang: z.enum(['ja', 'zh']),
            text: z.string().trim().min(1).max(4000),
            experienceRunId: z.string().min(1).max(100).nullable()
          })
          .strict()
      )
      .min(1)
      .max(2)
  })
  .strict()
export type SaveCaseIntroductionDraftsInput = z.infer<typeof saveCaseIntroductionDraftsInputSchema>
/** Stores the latest AI-generated personnel introduction (general, or for one case); each save replaces the previous one. */
export const savePersonnelIntroductionDraftsInputSchema = z
  .object({
    documentId: z.string().uuid(),
    profileVersion: z.number().int().positive(),
    caseContext: z.object({ reviewId: z.string().uuid(), version: z.number().int().positive() }).strict().nullable(),
    style: z.enum(['standard', 'brief']),
    request: z.string().trim().min(1).max(500).nullable(),
    drafts: z
      .array(
        z
          .object({
            lang: z.enum(['ja', 'zh']),
            text: z.string().trim().min(1).max(4000),
            experienceRunId: z.string().min(1).max(100).nullable()
          })
          .strict()
      )
      .min(1)
      .max(2)
  })
  .strict()
export type SavePersonnelIntroductionDraftsInput = z.infer<typeof savePersonnelIntroductionDraftsInputSchema>
export interface PersonnelIntroductionDraft {
  documentId: string
  profileVersion: number
  /** null for the general introduction. */
  caseReviewId: string | null
  jobCaseVersion: number | null
  lang: 'ja' | 'zh'
  style: 'standard' | 'brief'
  text: string
  request: string | null
  experienceRunId: string | null
  generatedAt: string
}
export interface CaseIntroductionDraft {
  reviewId: string
  jobCaseVersion: number
  lang: 'ja' | 'zh'
  style: 'standard' | 'brief'
  text: string
  request: string | null
  experienceRunId: string | null
  generatedAt: string
}
/** Starts an introduction from operator-pasted text; the same check `beginIntroductionDraft` applies in the main process. */
export const beginIntroductionDraftInputSchema = regenerateIntroductionInputSchema.extend({ text: z.string().trim().min(1).max(4000) })

export const saveBusinessFieldInputSchema = z
  .object({
    kind: z.enum(['case', 'person']),
    id: z.string().uuid(),
    version: z.number().int().positive(),
    field: z.string().min(1).max(100),
    value: z.string().max(4000).nullable(),
    previousValue: z.string().nullable(),
    projectId: z.string().max(100).optional()
  })
  .strict()
export type SaveBusinessFieldInput = z.infer<typeof saveBusinessFieldInputSchema>

/** An explicitly unknown eligibility value identifies nobody; keep real values subject to the existing identifier checks. */
export function introductionIdentifierCheckText(text: string): string {
  return text.replace(
    /^[ \t　]*(?:[-・*][ \t　]*)?(?:就労資格|就労可否|就労制限|在留資格|国籍|Work authori[sz]ation|Residence status|Nationality)[ \t　]*[:：][ \t　]*(?:要確認|未確認|不明|未設定|待确认|待补充|未设置|未知|unknown|not provided)[ \t　]*[。.]?[ \t　]*$/gimu,
    ''
  )
}

/** Exports the redacted skill sheet PDF for one confirmed person, optionally for the case being introduced. */
export const exportSkillSheetInputSchema = z
  .object({
    documentId: z.string().uuid(),
    profileVersion: z.number().int().positive(),
    caseContext: z.object({ reviewId: z.string().uuid(), version: z.number().int().positive() }).strict().optional()
  })
  .strict()
export type ExportSkillSheetInput = z.infer<typeof exportSkillSheetInputSchema>
export type ExportSkillSheetResult = { cancelled: true; fileName: null } | { cancelled: false; fileName: string }

/** Names the AI gateway failures an operator can act on (top up credits, sign in); anything else stays a generic failure. */
export function cloudFailureReason(error: unknown): 'insufficient-credits' | 'sign-in-required' | 'request-failed' {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  if (/INSUFFICIENT_CREDITS|not enough available AI credits/iu.test(message)) return 'insufficient-credits'
  if (
    /MEMBER_SIGN_IN_REQUIRED|MEMBER_SESSION_EXPIRED|TOKEN_INVALID|TOKEN_REVOKED|token_expired|Please sign in to Member Center/iu.test(
      message
    )
  )
    return 'sign-in-required'
  return 'request-failed'
}
