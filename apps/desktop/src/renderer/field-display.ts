/**
 * Display-only wording for Japanese case field values in the Chinese UI. Stored values never change: callers render
 * `text` and keep `original` (the raw value) as a tooltip. Only well-known SES phrasings are rewritten: a value is
 * matched whole first, then — for work style, start and rate — segment by segment (split on ／・、 and brackets), so
 * known parts translate and unknown parts stay as stored.
 */
export interface FieldDisplay {
  text: string
  /** The raw value when `text` differs from it; null when the value is shown as stored. */
  original: string | null
}

type Rule = { pattern: RegExp; zh: string | ((match: RegExpMatchArray) => string) }

const workStyleKeys = ['remote', 'work_style']
const rateKeys = ['rate']
const startKeys = ['start_date', 'availability']
const japaneseKeys = ['japanese_level']
const authorizationKeys = ['work_authorization']

/** Full-width digits and decimal points as ASCII, so captured numbers read the same in both scripts. */
const digits = (value: string) => value.replace(/[０-９．]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
const tilde = '[〜~～]'
const number = '([0-9０-９]+(?:[.．][0-9０-９]+)?)'
const per = '(?:\\s*(?:[/／]\\s*月|月額|\\(月額\\)|（月額）))?'

const rules: Array<{ keys: string[]; rules: Rule[] }> = [
  {
    keys: workStyleKeys,
    rules: [
      { pattern: /^(?:フルリモート|フルリモ|フル|完全在宅|完全リモート|リモート\s*100\s*[%％])$/u, zh: '全远程' },
      {
        pattern: /^週\s*([0-9０-９])\s*日?(?:程度)?\s*(?:リモート|在宅)(?:可)?$/u,
        zh: (match) => `每周远程${digits(match[1]!)}天`
      },
      { pattern: /^(?:リモート|在宅)\s*週\s*([0-9０-９])\s*日?(?:程度)?$/u, zh: (match) => `每周远程${digits(match[1]!)}天` },
      {
        pattern: /^週\s*([0-9０-９])\s*[〜~～\-ー－]\s*([0-9０-９])\s*日?(?:程度)?\s*(?:リモート|在宅)(?:可)?$/u,
        zh: (match) => `每周远程${digits(match[1]!)}–${digits(match[2]!)}天`
      },
      {
        pattern: /^出社\s*週\s*([0-9０-９])\s*日?(?:程度)?$/u,
        zh: (match) => `每周到岗${digits(match[1]!)}天`
      },
      {
        pattern: /^週\s*([0-9０-９])\s*日?(?:程度)?\s*(?:出勤|出社)$/u,
        zh: (match) => `每周到岗${digits(match[1]!)}天`
      },
      { pattern: /^(?:基本\s*リモート|リモート\s*(?:メイン|中心)|基本\s*在宅|在宅\s*(?:メイン|中心))$/u, zh: '以远程为主' },
      { pattern: /^(?:基本\s*出社|出社\s*(?:メイン|中心)|基本\s*常駐)$/u, zh: '以到岗为主' },
      { pattern: /^(?:常駐|フル出社|出社|現場常駐|オンサイト|完全出社)$/u, zh: '现场常驻' },
      { pattern: /^(?:無|無し|なし|リモート無し|リモートなし|リモート不可|在宅なし|在宅無し|在宅不可|不可)$/u, zh: '不可远程' },
      { pattern: /^(?:一部リモート|リモート併用|出社併用|併用|一部在宅|ハイブリッド)$/u, zh: '部分远程' },
      { pattern: /^(?:リモート可|リモートあり|リモート有|有|有り|あり|可)$/u, zh: '可远程' },
      { pattern: /^(?:応相談|要相談)$/u, zh: '可协商' }
    ]
  },
  {
    keys: rateKeys,
    rules: [
      { pattern: /^(?:単価\s*[:：]?\s*)?(?:スキル見合い|スキル見合|応相談|要相談|相談)$/u, zh: '面议' },
      { pattern: /^(?:単価\s*[:：]?\s*)?スキル見合い?で?\s*(?:応相談|要相談|相談)$/u, zh: '视技能面议' },
      {
        pattern: new RegExp(`^(?:単価\\s*[:：]?\\s*)?${number}\\s*(?:万円?)?\\s*${tilde}\\s*${number}\\s*万円${per}$`, 'u'),
        zh: (match) => `${digits(match[1]!)}–${digits(match[2]!)}万日元`
      },
      {
        pattern: new RegExp(`^(?:単価\\s*[:：]?\\s*)?${tilde}\\s*${number}\\s*万円${per}$`, 'u'),
        zh: (match) => `最高${digits(match[1]!)}万日元`
      },
      {
        pattern: new RegExp(`^(?:単価\\s*[:：]?\\s*)?${number}\\s*万円${per}\\s*(?:${tilde}|以上)$`, 'u'),
        zh: (match) => `${digits(match[1]!)}万日元起`
      },
      {
        // i18n-ignore: matches stored Japanese source text, never displayed
        pattern: new RegExp(`^(?:単価\\s*[:：]?\\s*)?(?:上限\\s*)?${number}\\s*万円${per}\\s*(?:まで|以下)$`, 'u'),
        zh: (match) => `最高${digits(match[1]!)}万日元`
      },
      {
        pattern: new RegExp(`^(?:単価\\s*[:：]?\\s*)?${number}\\s*万円?${per}\\s*(?:前後|程度)$`, 'u'),
        zh: (match) => `约${digits(match[1]!)}万日元`
      },
      {
        pattern: new RegExp(`^(?:単価\\s*[:：]?\\s*)?${number}\\s*万${per}\\s*(?:${tilde}|以上)$`, 'u'),
        zh: (match) => `${digits(match[1]!)}万日元起`
      },
      {
        pattern: new RegExp(`^(?:単価\\s*[:：]?\\s*)?${number}\\s*万円${per}$`, 'u'),
        zh: (match) => `${digits(match[1]!)}万日元`
      }
    ]
  },
  {
    keys: startKeys,
    rules: [
      { pattern: /^即日(?:[〜~～]|から|より|可|稼働可?)?$/u, zh: '立即' },
      { pattern: /^長期(?:予定|案件|想定)?$/u, zh: '长期' },
      { pattern: /^即日\s*(?:[〜~～]|から|より)\s*長期$/u, zh: '立即起长期' },
      {
        pattern: /^([0-9０-９]{1,2})\s*月\s*(?:[〜~～]|から|より|開始)\s*(?:の)?\s*長期$/u,
        zh: (match) => `${digits(match[1]!)}月起长期`
      },
      {
        pattern: /^([0-9０-９]{4})\s*年\s*([0-9０-９]{1,2})\s*月\s*(?:[〜~～]|から|より|開始)\s*(?:の)?\s*長期$/u,
        zh: (match) => `${digits(match[1]!)}年${digits(match[2]!)}月起长期`
      },
      {
        pattern: /^([0-9０-９]{4})\s*年\s*([0-9０-９]{1,2})\s*月\s*(?:[〜~～]|から|より|開始)$/u,
        zh: (match) => `${digits(match[1]!)}年${digits(match[2]!)}月起`
      },
      { pattern: /^([0-9０-９]{1,2})\s*月\s*(?:[〜~～]|から|より|開始)$/u, zh: (match) => `${digits(match[1]!)}月起` },
      { pattern: /^(?:応相談|要相談)$/u, zh: '可协商' }
    ]
  },
  {
    keys: japaneseKeys,
    rules: [
      { pattern: /^ビジネスレベル\s*(以上)?$/u, zh: (match) => `商务级${match[1] ?? ''}` },
      { pattern: /^ネイティブ(?:レベル)?\s*(以上)?$/u, zh: (match) => `母语${match[1] ?? ''}` },
      { pattern: /^日常会話(?:レベル)?\s*(以上)?$/u, zh: (match) => `日常会话${match[1] ?? ''}` },
      { pattern: /^不問$/u, zh: '不限' }
    ]
  },
  {
    keys: authorizationKeys,
    rules: [
      { pattern: /^(?:日本人のみ|日本国籍のみ)$/u, zh: '仅限日本籍' },
      { pattern: /^外国籍\s*(?:不可|NG)$/u, zh: '不接受外籍' },
      { pattern: /^外国籍\s*(?:可|OK)$/u, zh: '接受外籍' },
      { pattern: /^(?:就労ビザ|就労可能な在留資格)\s*(?:必須|要|必要)$/u, zh: '需工作签证' },
      { pattern: /^不問$/u, zh: '不限' }
    ]
  }
]

/** Keys whose mixed values are also translated part by part; other keys only ever match whole. */
const segmentedKeys = [...workStyleKeys, ...startKeys, ...rateKeys]
// A slash before 月 is part of a rate (「60万円/月」), not a separator.
const separator = /([/／](?!\s*月)|[・、()（）])/u
const shownSeparator: Record<string, string> = { '/': ' / ', '／': ' / ', '(': '（', ')': '）' }

function translateWhole(key: string, value: string): string | null {
  for (const group of rules) {
    if (!group.keys.includes(key)) continue
    for (const rule of group.rules) {
      const match = value.match(rule.pattern)
      if (match) return typeof rule.zh === 'string' ? rule.zh : rule.zh(match)
    }
  }
  return null
}

/** A work-style part such as 「要件定義～常駐」: translate each side of the tilde that is a known phrase. */
function translateAroundTilde(key: string, part: string): string | null {
  if (!workStyleKeys.includes(key)) return null
  const sides = part.split(/([〜~～])/u)
  if (sides.length < 3) return null
  let changed = false
  const text = sides
    .map((side, index) => {
      if (index % 2) return side
      const translated = side.trim() ? translateWhole(key, side.trim()) : null
      if (translated === null) return side
      changed = true
      return translated
    })
    .join('')
  return changed ? text : null
}

function translateSegments(key: string, value: string): string | null {
  const pieces = value.split(separator)
  if (pieces.length < 2 && !workStyleKeys.includes(key)) return null
  let changed = false
  const text = pieces
    .map((piece, index) => {
      if (index % 2) return shownSeparator[piece] ?? piece
      const core = piece.trim()
      if (!core) return ''
      const translated = translateWhole(key, core) ?? translateAroundTilde(key, core)
      if (translated === null || translated === core) return core
      changed = true
      return translated
    })
    .join('')
    .trim()
  return changed ? text : null
}

export function displayFieldValue(key: string, value: string, zh: boolean): FieldDisplay {
  if (!zh) return { text: value, original: null }
  const trimmed = value.trim()
  const text = translateWhole(key, trimmed) ?? (segmentedKeys.includes(key) ? translateSegments(key, trimmed) : null)
  return text === null || text === value ? { text: value, original: null } : { text, original: value }
}
