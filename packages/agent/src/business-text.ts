/**
 * Local business-text intake gate: the deterministic, Main-process-only router
 * that runs BEFORE any cloud call. Only 'not-intake' may continue to the cloud
 * planner; every other route ends the turn locally.
 *
 * Classification is structural - record root labels plus in-block fields - not
 * keyword co-occurrence. Gender, age, nationality and Japanese level appear as
 * requirement lines in real job-case messages, so they are auxiliary evidence
 * only, and only inside an identified person block. A bare person name never
 * triggers the fail-closed route: names are everywhere in normal queries and
 * the existing NER+DLP pipeline already covers them on the planner path.
 */

import { canonicalJobCaseFieldForLabel, jobCaseFieldCanonicalLabels, type JobCaseFieldAliasMap } from '@shared'

export type LocalBusinessTextRoute =
  | 'not-intake'
  | 'job-case'
  | 'candidate'
  | 'ambiguous-sensitive'
  | 'multiple'

export type BusinessTextIntakeKind = 'job-case' | 'candidate'

export type BusinessTextRouteReason =
  | 'no-record-structure'
  | 'decisive-job-case'
  | 'decisive-candidate'
  | 'declared-job-case'
  | 'declared-candidate'
  | 'tag-structure-conflict'
  | 'contact-identifier-present'
  | 'structure-without-type'
  | 'insufficient-structure-for-declared-kind'
  | 'multiple-record-roots'

export interface BusinessTextRouteDecision {
  route: LocalBusinessTextRoute
  reason: BusinessTextRouteReason
  /** First-line 【案件】/【人员】 tag, when present. */
  declaredKind: BusinessTextIntakeKind | null
  /** The text the import tool may parse: the message minus a recognized tag line. */
  businessText: string
}

/**
 * Conversation persistence only accepts this brand. The raw pasted text must
 * never be assignable to a persisted user message; the two travel as different
 * types so a refactor cannot quietly reintroduce raw text into ai_conversations.
 */
declare const persistedUserContentBrand: unique symbol
export type PersistedUserContent = string & { readonly [persistedUserContentBrand]: true }

/** The only constructor for persisted intake user content. Never pass raw text. */
export function brandPersistedUserContent(safeSummary: string): PersistedUserContent {
  return safeSummary as PersistedUserContent
}

const explicitTagPattern = /^【(案件|案件情報|人员|人員|人材|要員)】/u

const caseRootLabels = new Set([
  '案件名', '案件概要', '案件内容', '募集人数',
  '作業内容', '業務内容', '作业内容', '业务内容', '工作内容'
])

/**
 * Real WeChat case digests enumerate records as 案件1️⃣：/案件②：/案件2：, and a
 * single case is often just 案件：. Each such line is one case record root -
 * five of them is what makes a digest structurally 'multiple', no semantics
 * needed. NFKC already folds ①-style digits to plain ones; the emoji keycap
 * (U+FE0F U+20E3) survives normalization and is allowed explicitly.
 */
const enumeratedCaseRootPattern = /^案件(?:[0-9]{1,3}|[一二三四五六七八九十]{1,3})?(?:️?⃣)?$/u

/**
 * The same record root written without a colon: a line that is only 案件1 (or
 * 案件②。), whose body is the lines that follow it. Real WeChat digests write
 * their records this way and separate them with dotted rules, which belong to
 * no record.
 */
const bareCaseRootPattern = /^案件[\s]*(?:[0-9]{1,3}\uFE0F?\u20E3?|[一二三四五六七八九十]{1,3})[\s]*[。．.、]?$/u

const caseFieldLabels = new Set([
  '必須スキル', '必須要件', '必須', '必要スキル', '技術要件',
  '尚可スキル', '尚可', '歓迎スキル', '歓迎', '業界', '業種', '備考',
  '単価', '精算', '商流', '面談回数', '面談', '面接回数',
  '勤務地', '勤務形態', '就業形態', '契約形態', '場所', '現場',
  '参画時期', '参画', '開始時期', '稼働開始', '期間',
  'リモート', 'テレワーク', '支払サイト', '支払いサイト',
  '必须技能', '必须要件', '尚可技能', '单价', '面谈次数',
  '勤务地', '工作方式', '参画时期', '开始时期', '合同形态', '远程'
])

const personIdentityLabels = new Set([
  '氏名', '姓名', 'イニシャル', '首字母', '名前'
])

/** Person-section headers that open a person block without a colon. */
const personHeaderLines = [
  '要員情報', '要員紹介', '人材情報', '人材紹介', '人員情報',
  '本公司人员', '人员信息', '要員です', '人員営業', '人员营业'
]

const personAuxiliaryLabels = new Set([
  '性別', '性别', '年齢', '年龄', '国籍',
  '最寄駅', '最寄り駅', '最寄', '最近车站',
  '所属', '開始日', '开始日', '単金', '单金',
  '日本語', '日本語レベル', '日语', '希望',
  '稼働', '稼动', '経験年数', '经验年数'
])

/**
 * An anonymous profile carries no 氏名 line at all: the record is a gender+age
 * header and 【…】-bracketed attributes, often padded for alignment (【单    金】).
 * Two such labels are a person block, and a repeated label means a second
 * profile - the same counting rule the 氏名 roots use.
 */
const personBracketLabelPattern = /^【[\s]*([^】]{1,16}?)[\s]*】/u

const personBracketLabels = new Set([
  'スキル', '技能', '単金', '单金', '単価',
  '日本語', '日语', '対応工程', '对应工程',
  'IT経験', 'IT经验', '経験年数', '经验年数',
  '稼働', '稼动', '最寄', '最寄駅', '最近车站',
  'アピール', '自己PR'
])

/** The header such a profile opens with: 男　37歳／中国籍. */
const genderAgeHeaderPattern = /^[男女](?:性)?[\s/・,、|]{0,3}[0-9]{1,2}[\s]*(?:歳|才)/u

/**
 * A record numbered with a circled or keycap digit - ⑥　即日/9月～長期、SE1名… -
 * opens a record too. NFKC folds ① to a plain 1, so the number proves nothing
 * on its own; the delimiter after it and the record-shaped body below are what
 * separate a broadcast record from a numbered sentence in ordinary chat.
 */
const numberedRecordLeadPattern = /^(?:[0-9]{1,2}\uFE0F\u20E3|[❶-❿]|[0-9]{1,2}[\s.、,)）:：])[\s]*/u

/**
 * What makes a numbered line a record rather than a numbered item: a list of
 * conditions, a 【必須】-style requirement label, or a period together with a
 * headcount. 「①明日でお願いします」 has a number and nothing else and stays on
 * the planner path; 「1. 必須スキル：Java、SQL、AWS」 is one field of the record
 * it sits in, not a record of its own.
 */
function looksLikeNumberedRecord(text: string): boolean {
  const lead = numberedRecordLeadPattern.exec(text)?.[0]
  const body = lead === undefined ? '' : text.slice(lead.length).trim()
  if (!body) return false
  const label = /^([^:：]{1,20})[:：]/u.exec(body)?.[1]?.replace(/[\s【】\[\]()（）]/gu, '')
  if (label && (
    caseRootLabels.has(label) || caseFieldLabels.has(label) ||
    personIdentityLabels.has(label) || personAuxiliaryLabels.has(label)
  )) return false
  if ((body.match(/[、，]/gu) ?? []).length >= 2) return true
  if (/【[\s]*(?:必須|必要|尚可|歓迎|優遇|条件|要件|スキル)[^】]{0,8}】/u.test(body)) return true
  return /(?:[0-9]{1,2}月|即日)/u.test(body) && /[0-9]{1,3}[\s]*名/u.test(body)
}

const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u
const phonePattern =
  /(?<![\d/#-])(?:\+81[-\s]?\d{1,4}[-\s]\d{2,4}[-\s]\d{3,4}|0\d{1,4}[-\s]\d{2,4}[-\s]\d{3,4}|0[5789]0\d{8})(?!\d)/u

interface NormalizedLine {
  /** NFKC-normalized, decoration-stripped line. */
  text: string
  /** Canonical label before the first colon (whitespace removed), or null. */
  label: string | null
  /** True when the label line carries a non-empty value after the colon. */
  hasValue: boolean
}

function normalizeLines(text: string, aliases: JobCaseFieldAliasMap): NormalizedLine[] {
  return text.split(/\r?\n/u).map((rawLine) => {
    const stripped = rawLine
      .normalize('NFKC')
      .replace(/^[\s■●▼▲★◆◇□○◎・*+=~〜|｜>\uFE0F-]+/u, '')
      .trim()
    // A colon opening "://" is a URL, not a label separator.
    const colonMatch = /^([^:]{1,20}):(?!\/\/)(.*)$/u.exec(stripped)
    if (!colonMatch) return { text: stripped, label: null, hasValue: false }
    const writtenLabel = colonMatch[1]!.replace(/[\s【】\[\]()（）]/gu, '')
    // An operator alias counts as the built-in label it stands for.
    const aliasedField = canonicalJobCaseFieldForLabel(writtenLabel, aliases)
    const label = aliasedField ? jobCaseFieldCanonicalLabels[aliasedField] : writtenLabel
    return {
      text: stripped,
      label: label.length > 0 ? label : null,
      hasValue: colonMatch[2]!.trim().length > 0
    }
  })
}

function countByLabel(lines: NormalizedLine[], labels: ReadonlySet<string>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of lines) {
    if (line.label && labels.has(line.label)) {
      counts.set(line.label, (counts.get(line.label) ?? 0) + 1)
    }
  }
  return counts
}

function maxOccurrence(counts: Map<string, number>): number {
  let maximum = 0
  for (const count of counts.values()) maximum = Math.max(maximum, count)
  return maximum
}

function containsContactIdentifier(lines: NormalizedLine[]): boolean {
  for (const line of lines) {
    if (emailPattern.test(line.text)) return true
    // Meeting links carry digit runs; a URL line is not a phone number.
    if (!/https?:\/\//u.test(line.text) && phonePattern.test(line.text)) return true
  }
  return false
}

export interface BusinessTextRouteOptions {
  /** Operator-defined aliases for the built-in job-case field labels. */
  aliases?: JobCaseFieldAliasMap
}

export function routeBusinessText(message: string, options: BusinessTextRouteOptions = {}): BusinessTextRouteDecision {
  const trimmed = message.trim()
  const firstLineEnd = trimmed.indexOf('\n')
  const firstLine = (firstLineEnd < 0 ? trimmed : trimmed.slice(0, firstLineEnd)).trim()
  const tagMatch = explicitTagPattern.exec(firstLine)
  const declaredKind: BusinessTextIntakeKind | null = tagMatch
    ? (tagMatch[1] === '案件' || tagMatch[1] === '案件情報' ? 'job-case' : 'candidate')
    : null
  const businessText = tagMatch
    ? [firstLine.slice(tagMatch[0].length).trim(), firstLineEnd < 0 ? '' : trimmed.slice(firstLineEnd + 1)]
        .filter((part) => part.length > 0)
        .join('\n')
        .trim()
    : trimmed

  const lines = normalizeLines(businessText, options.aliases ?? {})

  const caseRootCounts = countByLabel(lines, caseRootLabels)
  const caseFieldCounts = countByLabel(lines, caseFieldLabels)
  const identityCounts = countByLabel(lines, personIdentityLabels)

  // Person headers open a person block without a colon; each header is a root.
  // So does an anonymous profile: its gender+age header, or its first bracketed
  // attribute label when it has no header line.
  let personHeaderCount = 0
  let genderAgeHeaderCount = 0
  let firstPersonRootIndex = -1
  const bracketFieldCounts = new Map<string, number>()
  lines.forEach((line, index) => {
    const isHeader = personHeaderLines.some((header) => line.label === null && line.text.startsWith(header))
    const isIdentity = line.label !== null && personIdentityLabels.has(line.label)
    const isGenderAge = genderAgeHeaderPattern.test(line.text)
    const bracketLabel = personBracketLabelPattern.exec(line.text)?.[1]?.replace(/[\s]+/gu, '')
    const isBracketField = Boolean(bracketLabel && personBracketLabels.has(bracketLabel))
    if (isHeader) personHeaderCount += 1
    if (isGenderAge) genderAgeHeaderCount += 1
    if (isBracketField) bracketFieldCounts.set(bracketLabel!, (bracketFieldCounts.get(bracketLabel!) ?? 0) + 1)
    if ((isHeader || isIdentity || isGenderAge || isBracketField) && firstPersonRootIndex < 0) firstPersonRootIndex = index
  })
  // Two distinct bracketed attributes are a profile; a repeated one is a second
  // profile, exactly as a repeated 氏名 label is.
  const bracketProfileFields = bracketFieldCounts.size
  const bracketProfileCount = bracketProfileFields >= 2 ? maxOccurrence(bracketFieldCounts) : 0

  // Auxiliary person fields provide evidence only inside a person block: age,
  // nationality and Japanese level are requirement lines in real case texts.
  const inBlockPersonFieldLabels = new Set<string>()
  const anyPersonFieldLabels = new Set<string>()
  lines.forEach((line, index) => {
    if (line.label && personAuxiliaryLabels.has(line.label)) {
      anyPersonFieldLabels.add(line.label)
      if (firstPersonRootIndex >= 0 && index > firstPersonRootIndex) inBlockPersonFieldLabels.add(line.label)
    }
  })

  const enumeratedCaseRootLineCount = lines.filter(
    (line) => line.label !== null && enumeratedCaseRootPattern.test(line.label)
  ).length
  const bareCaseRootLineCount = lines.filter((line) => bareCaseRootPattern.test(line.text)).length
  const numberedRecordRootCount = lines.filter((line) => looksLikeNumberedRecord(line.text)).length
  const caseRecordCount = Math.max(
    maxOccurrence(caseRootCounts),
    enumeratedCaseRootLineCount + bareCaseRootLineCount + numberedRecordRootCount
  )
  const personRecordCount = Math.max(
    maxOccurrence(identityCounts), personHeaderCount, genderAgeHeaderCount, bracketProfileCount
  )
  const distinctCaseFields = caseFieldCounts.size
  const decisiveCase = caseRecordCount >= 1 && distinctCaseFields >= 2
  const decisivePerson = personRecordCount >= 1
    && (inBlockPersonFieldLabels.size >= 2 || bracketProfileFields >= 2)

  const decision = (route: LocalBusinessTextRoute, reason: BusinessTextRouteReason): BusinessTextRouteDecision =>
    ({ route, reason, declaredKind, businessText })

  // Multiple complete record roots - never "both scores are high".
  if (caseRecordCount >= 2 || personRecordCount >= 2 || (decisiveCase && decisivePerson)) {
    return decision('multiple', 'multiple-record-roots')
  }

  if (decisiveCase) {
    return declaredKind === 'candidate'
      ? decision('ambiguous-sensitive', 'tag-structure-conflict')
      : decision('job-case', 'decisive-job-case')
  }
  if (decisivePerson) {
    return declaredKind === 'job-case'
      ? decision('ambiguous-sensitive', 'tag-structure-conflict')
      : decision('candidate', 'decisive-candidate')
  }

  const recognizedFieldCount = distinctCaseFields + anyPersonFieldLabels.size
  // Time ranges ("10:00") and date fragments also parse as label lines; only a
  // label containing at least one letter counts as record structure.
  const genericLabelLineCount = lines.filter(
    (line) => line.label !== null && line.hasValue && /\p{L}/u.test(line.label)
  ).length

  if (declaredKind) {
    // The tag resolves type ambiguity for a structured record; it cannot turn
    // free text into an import.
    if (genericLabelLineCount >= 2 || recognizedFieldCount + caseRecordCount + personRecordCount >= 2) {
      return declaredKind === 'job-case'
        ? decision('job-case', 'declared-job-case')
        : decision('candidate', 'declared-candidate')
    }
    return decision('ambiguous-sensitive', 'insufficient-structure-for-declared-kind')
  }

  if (containsContactIdentifier(lines)) {
    return decision('ambiguous-sensitive', 'contact-identifier-present')
  }

  // Record structure without a decisive type fails closed. A bare person name
  // or plain chat stays on the normal planner path.
  const hasRecordStructure =
    caseRecordCount >= 1 || personRecordCount >= 1 || recognizedFieldCount >= 2 || genericLabelLineCount >= 3
  if (hasRecordStructure) {
    return decision('ambiguous-sensitive', 'structure-without-type')
  }

  return decision('not-intake', 'no-record-structure')
}
