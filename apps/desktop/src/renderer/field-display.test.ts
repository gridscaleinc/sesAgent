import { describe, expect, it } from 'vitest'
import { displayFieldValue } from './field-display'

describe('displayFieldValue', () => {
  it.each([
    ['remote', 'フルリモート', '全远程'],
    ['remote', 'フル', '全远程'],
    ['work_style', '完全在宅', '全远程'],
    ['remote', '週3日リモート', '每周远程3天'],
    ['remote', '週２日在宅', '每周远程2天'],
    ['work_style', 'リモート週2', '每周远程2天'],
    ['work_style', 'リモート週1日程度', '每周远程1天'],
    ['remote', '出社週3日', '每周到岗3天'],
    ['work_style', '週3出勤', '每周到岗3天'],
    ['remote', '週3日出社', '每周到岗3天'],
    ['remote', '週２出社', '每周到岗2天'],
    ['remote', '週3～4日在宅', '每周远程3–4天'],
    ['work_style', '週1〜2日リモート', '每周远程1–2天'],
    ['remote', '基本リモート', '以远程为主'],
    ['work_style', 'リモートメイン', '以远程为主'],
    ['remote', '基本出社', '以到岗为主'],
    ['work_style', '出社メイン', '以到岗为主'],
    ['remote', '在宅なし', '不可远程'],
    ['remote', '(在宅なし)', '（不可远程）'],
    ['remote', '要件定義～常駐', '要件定義～现场常驻'],
    ['remote', '基本リモート（週1出社）', '以远程为主（每周到岗1天）'],
    ['remote', '週3日リモート、残りは常駐', '每周远程3天、残りは常駐'],
    ['work_style', 'ハイブリッド/フルリモート', '部分远程 / 全远程'],
    ['remote', '常駐', '现场常驻'],
    ['work_style', 'フル出社', '现场常驻'],
    ['remote', '出社', '现场常驻'],
    ['remote', '無', '不可远程'],
    ['remote', 'リモート不可', '不可远程'],
    ['remote', '一部リモート', '部分远程'],
    ['work_style', 'リモート併用', '部分远程'],
    ['remote', '併用', '部分远程'],
    ['remote', 'リモート可', '可远程'],
    ['rate', 'スキル見合い', '面议'],
    ['rate', '応相談', '面议'],
    ['rate', '単価：要相談', '面议'],
    ['rate', '60〜70万円', '60–70万日元'],
    ['rate', '60万円～70万円/月', '60–70万日元'],
    ['rate', '６５〜７５万円', '65–75万日元'],
    ['rate', '〜80万円', '最高80万日元'],
    ['rate', '上限80万円まで', '最高80万日元'],
    ['rate', '60万円〜', '60万日元起'],
    ['rate', '単価 70万円', '70万日元'],
    ['rate', '60万〜', '60万日元起'],
    ['rate', '70万円前後', '约70万日元'],
    ['rate', '60万円(応相談)', '60万日元（面议）'],
    ['rate', '60万円/月（スキル見合い）', '60万日元（面议）'],
    ['rate', 'スキル見合い（上限あり）', '面议（上限あり）'],
    ['rate', '60万円〜(経験による)', '60万日元起（経験による）'],
    ['start_date', '即日', '立即'],
    ['availability', '即日〜', '立即'],
    ['start_date', '長期', '长期'],
    ['start_date', '長期予定', '长期'],
    ['start_date', '2026年10月〜', '2026年10月起'],
    ['start_date', '11月から', '11月起'],
    ['start_date', '9月～長期', '9月起长期'],
    ['start_date', '9月から長期', '9月起长期'],
    ['start_date', '2026年10月〜長期', '2026年10月起长期'],
    ['start_date', '即日～長期', '立即起长期'],
    ['start_date', '即日/9月～長期', '立即 / 9月起长期'],
    ['availability', '即日・長期', '立即・长期'],
    ['start_date', '即日（調整可）', '立即（調整可）'],
    ['japanese_level', 'ビジネスレベル', '商务级'],
    ['japanese_level', 'ビジネスレベル以上', '商务级以上'],
    ['japanese_level', 'ネイティブ', '母语'],
    ['japanese_level', 'ネイティブレベル', '母语'],
    ['japanese_level', '日常会話', '日常会话'],
    ['japanese_level', '不問', '不限'],
    ['work_authorization', '外国籍不可', '不接受外籍'],
    ['work_authorization', '外国籍可', '接受外籍'],
    ['work_authorization', '日本人のみ', '仅限日本籍'],
    ['work_authorization', '就労ビザ必須', '需工作签证']
  ])('shows %s %s as %s in the Chinese UI and keeps the original', (key, value, text) => {
    expect(displayFieldValue(key, value, true)).toEqual({ text, original: value })
  })

  it.each([
    ['japanese_level', 'N1'],
    ['japanese_level', 'N2以上'],
    ['start_date', '2026年10月'],
    ['location', '東京都港区'],
    ['rate', '80'],
    ['start_date', '10月起'],
    ['start_date', '10月/11月'],
    ['remote', '要件定義～設計'],
    ['remote', '残りは常駐、要相談あり'],
    ['japanese_level', 'ビジネスレベル（N1）'],
    ['location', '即日/長期'],
    ['title', 'フルリモート'],
    ['skills', '無'],
    ['remote', '']
  ])('passes %s %s through unchanged', (key, value) => {
    expect(displayFieldValue(key, value, true)).toEqual({ text: value, original: null })
  })

  it('leaves every value as stored in the Japanese UI', () => {
    for (const [key, value] of [
      ['remote', 'フルリモート'],
      ['rate', '60〜70万円'],
      ['start_date', '即日']
    ] as const)
      expect(displayFieldValue(key, value, false)).toEqual({ text: value, original: null })
  })

  it('matches around surrounding whitespace without changing the original', () => {
    expect(displayFieldValue('remote', ' フルリモート ', true)).toEqual({ text: '全远程', original: ' フルリモート ' })
  })
})
