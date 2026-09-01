import { describe, expect, it } from 'vitest'
import { atsCsvToCandidateTexts, decodeCsvBytes, parseCsv } from './ats-csv'

describe('ATS CSV import', () => {
  it('parses quoted commas, embedded newlines and doubled quotes', () => {
    expect(parseCsv('"a","b,c","d""e"\r\n1,"x\ny",3\n')).toEqual([['a', 'b,c', 'd"e'], ['1', 'x\ny', '3']])
  })

  it('rewrites known ATS headers to the local person labels and keeps unknown ones', () => {
    const csv = [
      '"name","title","skills","summary","availability","location","memo"',
      '"佐藤 蓮","Laravel エンジニア","Laravel, PHP 8","公共システムの改修","2026年8月から稼働可","大森常駐可","要面談"',
      '"","","","","","",""',
      '"田中 美咲","","","","","",""'
    ].join('\n')
    const { rows, skipped } = atsCsvToCandidateTexts(csv)
    expect(skipped).toBe(0)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      row: 2,
      text: ['氏名: 佐藤 蓮', '職種: Laravel エンジニア', 'スキル: Laravel, PHP 8', '直近案件: 公共システムの改修', '稼働: 2026年8月から稼働可', '勤務地条件: 大森常駐可', 'memo: 要面談'].join('\n')
    })
    expect(rows[1]?.text).toBe('氏名: 田中 美咲')
  })

  it('decodes UTF-8 with a BOM and falls back to Shift_JIS', () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from('氏名,スキル\n', 'utf8')])
    expect(decodeCsvBytes(utf8)).toEqual({ text: '氏名,スキル\n', encoding: 'utf-8' })
    // 氏名 in Shift_JIS: 8E 81 96 BC
    const sjis = new Uint8Array([0x8e, 0x81, 0x96, 0xbc, 0x2c, 0x61, 0x0a])
    expect(decodeCsvBytes(sjis)).toEqual({ text: '氏名,a\n', encoding: 'shift_jis' })
  })
})
