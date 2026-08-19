import type { ApplicationLocale } from '@shared'

interface SourceEvidenceSummaryOptions {
  projectIndex?: number
}

function compactNumbers(values: number[]): string {
  const sorted = [...new Set(values)].toSorted((left, right) => left - right)
  const ranges: Array<{ start: number; end: number }> = []
  for (const value of sorted) {
    const current = ranges.at(-1)
    if (current && value === current.end + 1) current.end = value
    else ranges.push({ start: value, end: value })
  }
  return ranges.map((range) => range.start === range.end ? String(range.start) : `${range.start}–${range.end}`).join(', ')
}

export function summarizeSourceLabels(
  labels: string[],
  locale: ApplicationLocale,
  options: SourceEvidenceSummaryOptions = {}
): string {
  if (labels.length === 0) return locale === 'zh-CN' ? '无自动来源' : '自動出典なし'
  const spreadsheet = new Map<string, { rows: number[]; cells: number }>()
  const pages: number[] = []
  const paragraphs: number[] = []
  const other: string[] = []
  for (const label of [...new Set(labels)]) {
    const page = label.match(/^Page (\d+)$/u)?.[1]
    if (page) {
      pages.push(Number(page))
      continue
    }
    const paragraph = label.match(/^Paragraph (\d+)$/u)?.[1]
    if (paragraph) {
      paragraphs.push(Number(paragraph))
      continue
    }
    const cell = label.match(/^(.*)!([A-Z]{1,3})([1-9]\d*)$/u)
    if (cell?.[1] && cell[3]) {
      const group = spreadsheet.get(cell[1]) ?? { rows: [], cells: 0 }
      group.rows.push(Number(cell[3]))
      group.cells += 1
      spreadsheet.set(cell[1], group)
      continue
    }
    other.push(label)
  }

  const parts: string[] = []
  for (const [sheet, group] of spreadsheet) {
    const rows = compactNumbers(group.rows)
    if (locale === 'zh-CN') {
      const project = options.projectIndex ? ` · 项目${options.projectIndex}区域` : ''
      parts.push(`${sheet}${project} · 第${rows}行（${group.cells}个来源单元格）`)
    } else {
      const project = options.projectIndex ? ` · プロジェクト${options.projectIndex}範囲` : ''
      parts.push(`${sheet}${project} · ${rows}行（出典セル${group.cells}件）`)
    }
  }
  if (pages.length > 0) {
    parts.push(locale === 'zh-CN' ? `PDF 第${compactNumbers(pages)}页` : `PDF ${compactNumbers(pages)}ページ`)
  }
  if (paragraphs.length > 0) {
    parts.push(locale === 'zh-CN' ? `Word 第${compactNumbers(paragraphs)}段` : `Word ${compactNumbers(paragraphs)}段落`)
  }
  parts.push(...other.slice(0, 2))
  const summary = parts.join(' / ')
  return locale === 'zh-CN' ? `来源：${summary}` : `出典：${summary}`
}

