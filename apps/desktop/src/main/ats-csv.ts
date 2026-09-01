/**
 * ATS CSV export -> one labeled person text per row. The text then takes the
 * same local path as pasted person text (encrypted staging, deterministic
 * extraction, candidate review), so a CSV import can never bypass the
 * redaction and review steps a pasted resume goes through.
 */

/** RFC 4180 with the usual tolerance: CRLF/LF, quoted commas and newlines, doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index += 1 } else quoted = false
      } else cell += char
      continue
    }
    if (char === '"') { quoted = true; continue }
    if (char === ',') { row.push(cell); cell = ''; continue }
    if (char === '\r') continue
    if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue }
    cell += char
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row) }
  return rows.filter((line) => line.some((value) => value.trim().length > 0))
}

/** Decodes an ATS export: UTF-8 (with or without BOM) first, Shift_JIS when the bytes are not valid UTF-8. */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'shift_jis' } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/u, ''), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'shift_jis' }
  }
}

/** Header names ATS exports use, mapped to the labels the local person extractor understands. */
const headerLabels: ReadonlyArray<readonly [label: string, names: ReadonlyArray<string>]> = [
  ['氏名', ['name', 'fullname', 'candidatename', 'candidate', '氏名', '名前', '候補者名', '姓名']],
  ['職種', ['title', 'role', 'position', 'jobtitle', '職種', 'ロール', '役割', '職位']],
  ['スキル', ['skills', 'skill', 'skillset', 'スキル', '技術', '技能', '技術スタック']],
  ['経験年数', ['experienceyears', 'years', 'yearsofexperience', '経験年数', '実務経験', '経験']],
  ['直近案件', ['summary', 'experience', 'project', 'projects', '経歴', '職務要約', '直近案件', 'プロジェクト', '概要']],
  ['稼働', ['availability', 'start', 'startdate', '稼働', '稼働時期', '開始可能日', '参画可能日']],
  ['勤務地条件', ['location', 'area', '勤務地', '勤務地条件', '希望勤務地', '居住地']],
  ['日本語', ['japanese', 'japaneselevel', '日本語', '日本語レベル', '日语']],
  ['希望単価', ['rate', 'desiredrate', '単価', '希望単価', '単金']],
  ['就労資格', ['workauthorization', 'visa', '就労資格', '在留資格', 'ビザ']]
]

function normalizedHeader(header: string): string {
  return header.normalize('NFKC').replace(/[\s_\-()（）]/gu, '').toLocaleLowerCase('en-US')
}

function labelForHeader(header: string): string {
  const normalized = normalizedHeader(header)
  return headerLabels.find(([, names]) => names.includes(normalized))?.[0] ?? header.trim()
}

export interface AtsCsvRowText {
  row: number
  text: string
}

/**
 * Turns the CSV into one "label: value" text per data row. Known headers are
 * rewritten to the extractor's labels; unknown headers keep their own name so
 * nothing is dropped. Rows without a name or skills are skipped.
 */
export function atsCsvToCandidateTexts(csvText: string, maxRows = 200): { rows: AtsCsvRowText[]; skipped: number } {
  const table = parseCsv(csvText)
  const header = table[0]
  if (!header) return { rows: [], skipped: 0 }
  const labels = header.map(labelForHeader)
  const rows: AtsCsvRowText[] = []
  let skipped = 0
  for (const [index, cells] of table.slice(1).entries()) {
    const lines = labels.flatMap((label, column) => {
      const value = (cells[column] ?? '').replace(/\s+/gu, ' ').trim()
      return label && value ? [`${label}: ${value}`] : []
    })
    const hasIdentity = lines.some((line) => /^(?:氏名|スキル|職種):/u.test(line))
    if (!hasIdentity) { skipped += 1; continue }
    if (rows.length >= maxRows) { skipped += 1; continue }
    rows.push({ row: index + 2, text: lines.join('\n') })
  }
  return { rows, skipped }
}
