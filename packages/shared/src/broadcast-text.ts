import {
  jobCaseFieldKeys,
  type BroadcastFieldChange,
  type BroadcastLanguage,
  type BroadcastTemplate,
  type BroadcastTemplateFieldKey,
  type JobCaseFieldKey
} from './contracts'

/** What a broadcast reads from a case: the confirmed field values, nothing else. */
export interface BroadcastFieldValue {
  key: JobCaseFieldKey
  value: string | null
}

/**
 * The one place Japanese condition wording becomes Chinese. Order matters:
 * the longer phrase has to be consumed before the shorter one it contains
 * (現場常駐 before 常駐, 在宅多め before 在宅), so every caller must apply the
 * list in sequence rather than as an unordered map.
 */
export const broadcastConditionWordMap: ReadonlyArray<readonly [string, string]> = [
  ['応相談', '面议'],
  ['現場常駐', '现场常驻'],
  ['常駐', '常驻'],
  ['フル出勤', '全勤到岗'],
  ['リモート併用', '远程+到岗'],
  ['在宅多め', '以远程为主'],
  ['在宅', '远程'],
  ['週2出社', '每周到岗2天'],
  ['流暢', '流利'],
  ['ビジネスレベル', '商务级'],
  ['長期', '长期'],
  ['即日', '即日'],
  ['または', '或'],
  ['残業少ない', '加班少'],
  ['外国籍可', '可外籍'],
  ['要員替換', '人员替换'],
  ['超長期', '超长期'],
  ['回', '次'],
  ['万円', '万日元']
]

/**
 * Free text the operator wrote about people, skills, places and the work
 * itself must survive untouched - substituting 回 or 長期 inside a skill list
 * or an address damages the meaning. Only condition-style fields are mapped.
 */
const untranslatedFieldKeys: ReadonlySet<JobCaseFieldKey> = new Set<JobCaseFieldKey>([
  'required_skills',
  'preferred_skills',
  'location',
  'role'
])

/** Notes lines the operator marked as internal never leave this device. */
const internalNotePrefix = '※内部'

export const builtInBroadcastTemplateId = 'b7ca57de-0000-4000-8000-000000000001'

/**
 * The template a device starts with. It is produced in code rather than seeded
 * by the migration, so a device that never edited a template always reads the
 * current default instead of a stale copy of an old one.
 */
export function builtInBroadcastTemplate(now = new Date('2026-01-01T00:00:00.000Z')): BroadcastTemplate {
  const timestamp = now.toISOString()
  const field = (key: BroadcastTemplateFieldKey, labelJa: string, labelZh: string, on = true) =>
    ({ kind: 'field' as const, field: key, labelJa, labelZh, on })
  return {
    id: builtInBroadcastTemplateId,
    name: '標準',
    ratePublic: 'cap',
    headerJa: '【案件】{{title}}',
    headerZh: '【案件】{{title}}',
    footerJa: 'ご興味のある方はこのグループでご連絡ください。',
    footerZh: '有合适人选请在群里联系。',
    lines: [
      field('required_skills', '必須', '必须'),
      field('preferred_skills', '尚可', '加分'),
      field('role', '作業内容', '工作内容'),
      field('start_date', '開始', '开始'),
      field('location', '場所', '地点'),
      field('remote', '勤務形態', '出勤方式'),
      field('working_hours', '勤務時間', '工作时间'),
      field('rate', '単価', '单价'),
      field('japanese_level', '日本語', '日语'),
      field('work_authorization', '就労資格', '签证'),
      field('interview', '面談', '面谈'),
      field('headcount', '人数', '人数'),
      field('notes', '備考', '备注', false)
    ],
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

/** Applies the shared condition wording map in declaration order. */
export function translateBroadcastConditions(value: string): string {
  return broadcastConditionWordMap.reduce(
    (text, [japanese, chinese]) => text.split(japanese).join(chinese),
    value
  )
}

function lastNumberIn(value: string): string | null {
  const numbers = value.normalize('NFKC').match(/\d+(?:\.\d+)?/gu)
  return numbers && numbers.length > 0 ? numbers[numbers.length - 1] : null
}

/** 単価 as the operator chose to publish it: as stored, as a ceiling, or as 応相談. */
function publishedRate(value: string, template: BroadcastTemplate, lang: BroadcastLanguage): string | null {
  if (template.ratePublic === 'negotiable') return lang === 'zh' ? '面议' : '応相談'
  if (template.ratePublic === 'raw') return value
  const ceiling = lastNumberIn(value)
  if (!ceiling) return value
  return lang === 'zh' ? `～${ceiling}万日元` : `～${ceiling}万円`
}

/** 備考 without the lines the operator marked internal; null when nothing public remains. */
function publicNotes(value: string): string | null {
  const kept = value
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith(internalNotePrefix))
    .filter((line) => line.trim().length > 0)
  return kept.length > 0 ? kept.join('\n') : null
}

/**
 * One field exactly as a broadcast would print it: the rate under the
 * template's publishing policy, 備考 without its internal lines, condition
 * wording mapped for Chinese. Null means the line is dropped. Update notices
 * read the same function, so a change never publishes a value the message
 * itself would have withheld.
 */
export function publishedBroadcastFieldValue(
  key: JobCaseFieldKey,
  value: string | null,
  template: BroadcastTemplate,
  lang: BroadcastLanguage
): string | null {
  const stored = value?.trim()
  if (!stored) return null
  const resolved = key === 'rate'
    ? publishedRate(stored, template, lang)
    : key === 'notes'
      ? publicNotes(stored)
      : stored
  if (!resolved) return null
  return lang === 'zh' && !untranslatedFieldKeys.has(key) ? translateBroadcastConditions(resolved) : resolved
}

function fieldText(
  key: JobCaseFieldKey,
  fields: ReadonlyArray<BroadcastFieldValue>,
  template: BroadcastTemplate,
  lang: BroadcastLanguage
): string | null {
  return publishedBroadcastFieldValue(key, fields.find((field) => field.key === key)?.value ?? null, template, lang)
}

/**
 * Assembles one group message from confirmed field values. Nothing is invented:
 * every line is a template line the operator switched on, filled with a value
 * the case already holds. Lines whose field is empty are dropped rather than
 * printed as blanks, so a thin case produces a short message.
 */
export function generateBroadcastText(
  fields: ReadonlyArray<BroadcastFieldValue>,
  title: string,
  template: BroadcastTemplate,
  lang: BroadcastLanguage
): string {
  const header = (lang === 'zh' ? template.headerZh : template.headerJa).split('{{title}}').join(title)
  const body = template.lines.flatMap((line) => {
    if (!line.on) return []
    if (line.kind === 'text') {
      const text = (lang === 'zh' ? line.textZh : line.textJa).trim()
      return text ? [text] : []
    }
    const value = fieldText(line.field, fields, template, lang)
    if (!value) return []
    return [`${lang === 'zh' ? line.labelZh : line.labelJa}：${value}`]
  })
  const footer = (lang === 'zh' ? template.footerZh : template.footerJa).trim()
  const message = [header, ...body].join('\n')
  return footer ? `${message}\n\n${footer}` : message
}

/**
 * The short message that follows a case revision: only what actually changed,
 * so a group reading it can tell the difference without re-reading the案件.
 */
export function generateUpdateNoticeText(
  title: string,
  changes: ReadonlyArray<BroadcastFieldChange>,
  lang: BroadcastLanguage
): string {
  const localize = (value: string) => (lang === 'zh' ? translateBroadcastConditions(value) : value)
  const lines = changes.map((change) =>
    `・${localize(change.label)}：${localize(change.before)} → ${localize(change.after)}`)
  return [`【更新】${title}`, ...lines].join('\n')
}

/**
 * The case the template preview falls back to when the queue is empty. It is a
 * fabricated example, deliberately generic, so a first-run device can still see
 * what a template produces.
 */
export function broadcastPreviewSample(): { title: string; fields: BroadcastFieldValue[] } {
  const values: Partial<Record<JobCaseFieldKey, string>> = {
    title: 'Java 業務システム改修',
    role: '詳細設計～結合テスト',
    industry: '流通',
    required_skills: 'Java、Spring Boot',
    preferred_skills: 'AWS',
    rate: '60万〜65万円',
    location: '都内（品川）',
    remote: 'リモート併用',
    start_date: '即日',
    working_hours: '9:00-18:00',
    japanese_level: 'ビジネスレベル',
    interview: 'オンライン1回',
    headcount: '1名',
    work_authorization: '就労資格必須',
    notes: '長期案件です。'
  }
  return {
    title: values.title!,
    fields: jobCaseFieldKeys.map((key) => ({ key, value: values[key] ?? null }))
  }
}
