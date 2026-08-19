import { summarizeSourceLabels } from './source-evidence'

describe('summarizeSourceLabels', () => {
  const projectLabels = [
    '技術情報経歴書!H35', '技術情報経歴書!G35', '技術情報経歴書!H36',
    '技術情報経歴書!B36', '技術情報経歴書!C36', '技術情報経歴書!B39',
    '技術情報経歴書!C39', '技術情報経歴書!AE35', '技術情報経歴書!T35',
    '技術情報経歴書!W35', '技術情報経歴書!T36', '技術情報経歴書!W36',
    '技術情報経歴書!T37', '技術情報経歴書!W37', '技術情報経歴書!T38',
    '技術情報経歴書!W38', '技術情報経歴書!T39', '技術情報経歴書!W39'
  ]

  it('replaces raw spreadsheet coordinates with an HR-readable Chinese range', () => {
    expect(summarizeSourceLabels(projectLabels, 'zh-CN', { projectIndex: 1 })).toBe(
      '来源：技術情報経歴書 · 项目1区域 · 第35–39行（18个来源单元格）'
    )
  })

  it('keeps a localized audit summary for Japanese and document sources', () => {
    expect(summarizeSourceLabels(projectLabels, 'ja-JP', { projectIndex: 1 })).toBe(
      '出典：技術情報経歴書 · プロジェクト1範囲 · 35–39行（出典セル18件）'
    )
    expect(summarizeSourceLabels(['Page 1', 'Page 2'], 'zh-CN')).toBe('来源：PDF 第1–2页')
  })
})
