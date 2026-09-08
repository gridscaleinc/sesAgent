import { jobCaseFieldKeys, type JobCaseFieldAliasMap, type JobCaseFieldKey } from './contracts'

/**
 * The label each built-in field is written under once an alias is resolved.
 * These are the labels the local extractor and router already recognise, so
 * rewriting an alias to them makes the alias behave exactly like the original.
 */
export const jobCaseFieldCanonicalLabels: Record<JobCaseFieldKey, string> = {
  title: '案件名',
  role: '募集ロール',
  industry: '業界',
  required_skills: '必須スキル',
  preferred_skills: '尚可スキル',
  rate: '単価',
  settlement: '精算',
  location: '勤務地',
  remote: 'リモート',
  start_date: '参画時期',
  working_hours: '勤務時間',
  japanese_level: '日本語レベル',
  interview: '面談回数',
  headcount: '募集人数',
  contract_chain: '商流',
  payment_terms: '支払サイト',
  work_authorization: '就労資格',
  notes: '備考'
}

/** Labels compare after NFKC, without spaces or bracket decorations, case-insensitively. */
export function normalizeJobCaseFieldLabel(label: string): string {
  return label.normalize('NFKC').replace(/[\s　【】[\]()（）]/gu, '').toLocaleLowerCase('ja-JP')
}

/** The built-in field a written label is an alias of, or null when it is not an alias. */
export function canonicalJobCaseFieldForLabel(label: string, aliases: JobCaseFieldAliasMap): JobCaseFieldKey | null {
  const normalized = normalizeJobCaseFieldLabel(label)
  if (!normalized) return null
  for (const key of jobCaseFieldKeys) {
    if ((aliases[key] ?? []).some((alias) => normalizeJobCaseFieldLabel(alias) === normalized)) return key
  }
  return null
}

const labelLinePattern = /^([\s　■●▼▲★◆◇□○◎・*+=~〜|｜>＞\-–—【[（(]*)([^:：\r\n]{1,40}?)(\s*[:：])(.*)$/u

/** Rewrites "alias：value" to "built-in label：value"; other lines pass through untouched. */
export function canonicalizeJobCaseLabelLine(line: string, aliases: JobCaseFieldAliasMap): string {
  const normalizedLine = line.replace(/^\s*【([^】]{1,40})】\s*[:：]?\s*/u, '$1：')
  const match = labelLinePattern.exec(normalizedLine)
  if (!match) return normalizedLine
  const key = canonicalJobCaseFieldForLabel(match[2]!, aliases)
  if (!key) return normalizedLine
  return `${match[1]}${jobCaseFieldCanonicalLabels[key]}${match[3]}${match[4]}`
}

/** One instruction sentence telling the cloud extractor which labels map to which field. */
export function jobCaseFieldAliasInstructionLine(aliases: JobCaseFieldAliasMap): string | null {
  const entries = jobCaseFieldKeys.flatMap((key) => {
    const values = (aliases[key] ?? []).map((alias) => alias.trim()).filter(Boolean)
    return values.length > 0 ? [`${key}: ${values.join(', ')}`] : []
  })
  if (entries.length === 0) return null
  return `The operator's partners also write these fields under other labels - ${entries.join('; ')} - and such a label means exactly the field it is listed under.`
}
