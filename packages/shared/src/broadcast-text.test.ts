import { describe, expect, it } from 'vitest'
import { jobCaseFieldKeys, type BroadcastTemplate } from './contracts'
import {
  builtInBroadcastTemplate,
  generateBroadcastText,
  generateUpdateNoticeText,
  type BroadcastFieldValue
} from './broadcast-text'

/** A realistic RPA案件 as the operator would have confirmed it. */
const uiPathCase: Record<string, string> = {
  title: 'UiPath RPA 開発（金融系）',
  role: '要件定義～開発・テスト',
  industry: '金融',
  required_skills: 'UiPath 実務3年以上、VB.NET',
  preferred_skills: 'Python、SQL',
  rate: '60万〜65万円',
  settlement: '140-180h',
  location: '都内（大手町）',
  remote: 'リモート併用（週2出社）',
  start_date: '即日または10月',
  working_hours: '9:00-18:00 残業少ない',
  japanese_level: 'ビジネスレベル',
  interview: 'オンライン1回',
  headcount: '2名',
  contract_chain: '弊社→元請→エンド',
  payment_terms: '月末締め翌月末払い',
  work_authorization: '就労資格必須、外国籍可',
  notes: '長期案件です。\n※内部 エンドは大手証券、担当は佐藤様\n要員替換の可能性あり'
}

function fieldsOf(values: Record<string, string> = uiPathCase): BroadcastFieldValue[] {
  return jobCaseFieldKeys.map((key) => ({ key, value: values[key] ?? null }))
}

function templateWith(overrides: Partial<BroadcastTemplate> = {}): BroadcastTemplate {
  return { ...builtInBroadcastTemplate(), ...overrides }
}

/** Notes are off in the default template; several cases below need them on. */
function withNotesOn(template: BroadcastTemplate): BroadcastTemplate {
  return {
    ...template,
    lines: template.lines.map((line) => (line.kind === 'field' && line.field === 'notes' ? { ...line, on: true } : line))
  }
}

describe('generateBroadcastText', () => {
  it('writes the whole Japanese message for a confirmed case', () => {
    expect(generateBroadcastText(fieldsOf(), uiPathCase.title, builtInBroadcastTemplate(), 'ja')).toBe([
      '【案件】UiPath RPA 開発（金融系）',
      '必須：UiPath 実務3年以上、VB.NET',
      '尚可：Python、SQL',
      '作業内容：要件定義～開発・テスト',
      '開始：即日または10月',
      '場所：都内（大手町）',
      '勤務形態：リモート併用（週2出社）',
      '勤務時間：9:00-18:00 残業少ない',
      '単価：～65万円',
      '日本語：ビジネスレベル',
      '就労資格：就労資格必須、外国籍可',
      '面談：オンライン1回',
      '人数：2名',
      '',
      'ご興味のある方はこのグループでご連絡ください。'
    ].join('\n'))
  })

  it('writes the Chinese message with Chinese labels and mapped condition words', () => {
    expect(generateBroadcastText(fieldsOf(), uiPathCase.title, builtInBroadcastTemplate(), 'zh')).toBe([
      '【案件】UiPath RPA 開発（金融系）',
      '必须：UiPath 実務3年以上、VB.NET',
      '加分：Python、SQL',
      '工作内容：要件定義～開発・テスト',
      '开始：即日或10月',
      '地点：都内（大手町）',
      '出勤方式：远程+到岗（每周到岗2天）',
      '工作时间：9:00-18:00 加班少',
      '单价：～65万日元',
      '日语：商务级',
      '签证：就労資格必須、可外籍',
      '面谈：オンライン1次',
      '人数：2名',
      '',
      '有合适人选请在群里联系。'
    ].join('\n'))
  })

  it('never emits the contract chain or the payment terms, whatever the case holds', () => {
    for (const lang of ['ja', 'zh'] as const) {
      const message = generateBroadcastText(fieldsOf(), uiPathCase.title, withNotesOn(builtInBroadcastTemplate()), lang)
      expect(message).not.toContain(uiPathCase.contract_chain)
      expect(message).not.toContain(uiPathCase.payment_terms)
      expect(message).not.toContain('エンド')
    }
  })

  it('publishes 単価 the way the template says', () => {
    const fields = fieldsOf()
    const rateLine = (template: BroadcastTemplate, lang: 'ja' | 'zh') =>
      generateBroadcastText(fields, uiPathCase.title, template, lang)
        .split('\n')
        .find((line) => line.startsWith('単価：') || line.startsWith('单价：'))

    expect(rateLine(templateWith({ ratePublic: 'raw' }), 'ja')).toBe('単価：60万〜65万円')
    expect(rateLine(templateWith({ ratePublic: 'raw' }), 'zh')).toBe('单价：60万〜65万日元')
    expect(rateLine(templateWith({ ratePublic: 'cap' }), 'ja')).toBe('単価：～65万円')
    expect(rateLine(templateWith({ ratePublic: 'cap' }), 'zh')).toBe('单价：～65万日元')
    expect(rateLine(templateWith({ ratePublic: 'negotiable' }), 'ja')).toBe('単価：応相談')
    expect(rateLine(templateWith({ ratePublic: 'negotiable' }), 'zh')).toBe('单价：面议')
  })

  it('drops 備考 lines the operator marked internal and keeps the rest', () => {
    const message = generateBroadcastText(fieldsOf(), uiPathCase.title, withNotesOn(builtInBroadcastTemplate()), 'ja')
    expect(message).toContain('備考：長期案件です。\n要員替換の可能性あり')
    expect(message).not.toContain('※内部')
    expect(message).not.toContain('佐藤様')
  })

  it('drops the whole 備考 line when every note line is internal', () => {
    const onlyInternal = fieldsOf({ ...uiPathCase, notes: '※内部 単価は実は70万まで可' })
    const message = generateBroadcastText(onlyInternal, uiPathCase.title, withNotesOn(builtInBroadcastTemplate()), 'ja')
    expect(message).not.toContain('備考')
    expect(message).not.toContain('70万')
  })

  it('skips the lines whose field is empty rather than printing blanks', () => {
    const thin: Record<string, string> = { title: 'Java 保守', required_skills: 'Java' }
    expect(generateBroadcastText(fieldsOf(thin), thin.title, builtInBroadcastTemplate(), 'ja')).toBe([
      '【案件】Java 保守',
      '必須：Java',
      '',
      'ご興味のある方はこのグループでご連絡ください。'
    ].join('\n'))
  })

  it('emits fixed-text lines verbatim in the language being written, and honours the on switch', () => {
    const template = templateWith({
      footerJa: '',
      footerZh: '',
      lines: [
        { kind: 'text', textJa: '※弊社プロパー限定', textZh: '※仅限自社正社员', on: true },
        { kind: 'text', textJa: '下書き中の一文', textZh: '草稿中的一句', on: false },
        { kind: 'field', field: 'required_skills', labelJa: '必須', labelZh: '必须', on: true }
      ]
    })
    expect(generateBroadcastText(fieldsOf(), uiPathCase.title, template, 'ja')).toBe([
      '【案件】UiPath RPA 開発（金融系）',
      '※弊社プロパー限定',
      '必須：UiPath 実務3年以上、VB.NET'
    ].join('\n'))
    expect(generateBroadcastText(fieldsOf(), uiPathCase.title, template, 'zh')).toContain('※仅限自社正社员')
    expect(generateBroadcastText(fieldsOf(), uiPathCase.title, template, 'zh')).not.toContain('草稿中的一句')
  })

  it('drops the footer separator when the template has no footer', () => {
    const template = templateWith({ footerJa: '', footerZh: '' })
    expect(generateBroadcastText(fieldsOf(), uiPathCase.title, template, 'ja').endsWith('人数：2名')).toBe(true)
  })
})

describe('generateUpdateNoticeText', () => {
  const changes = [
    { label: '単価', before: '60万円', after: '65万円' },
    { label: '開始', before: '9月', after: '10月' }
  ]

  it('lists only what changed, in Japanese', () => {
    expect(generateUpdateNoticeText('UiPath RPA 開発', changes, 'ja')).toBe([
      '【更新】UiPath RPA 開発',
      '・単価：60万円 → 65万円',
      '・開始：9月 → 10月'
    ].join('\n'))
  })

  it('maps condition wording for the Chinese version', () => {
    expect(generateUpdateNoticeText('UiPath RPA 開発', [
      { label: '単価', before: '応相談', after: '65万円' }
    ], 'zh')).toBe(['【更新】UiPath RPA 開発', '・単価：面议 → 65万日元'].join('\n'))
  })
})
