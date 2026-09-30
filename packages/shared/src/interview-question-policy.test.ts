import { expect, it } from 'vitest'
import {
  asksAboutGeneralPractice,
  asksCandidateToChooseExample,
  interviewAskTypes,
  interviewCapabilityRequirements,
  interviewDimensionAsks,
  interviewQuestionDimensions,
  isInterviewCapabilityText
} from './interview-question-policy'

it('extracts responsibilities and capabilities without commercial fields or meaningless values', () => {
  expect(
    interviewCapabilityRequirements([
      { key: 'required_skills', value: 'PMO・課題管理・顧客調整' },
      { key: 'role', value: 'PMO' },
      { key: 'notes', value: '金融業務の要件整理\n単価80万円\n週3日出社\n要確認' },
      { key: 'rate', value: 'スキル見合い' },
      { key: 'remote', value: '無' },
      { key: 'location', value: '東京' },
      { key: 'start_date', value: '即日' },
      { key: 'preferred_skills', value: 'null' }
    ])
  ).toEqual(['PMO・課題管理・顧客調整', 'PMO', '金融業務の要件整理'])
})

it.each(['Java / Spring Boot / SQL', 'AWS', 'SAP', '金融業務', '課題管理', '結合テスト', '運用監視', '日本語での顧客調整'])(
  'keeps valid role and business capability %s',
  (value) => {
    expect(isInterviewCapabilityText(value)).toBe(true)
  }
)

it('drops bracketed case title tags and keeps the real responsibility', () => {
  expect(
    interviewCapabilityRequirements([
      { key: 'title', value: '【Gmail接続テスト05】Java追加機能開発・障害改修' },
      { key: 'required_skills', value: 'Java, SQL' }
    ])
  ).toEqual(['Java追加機能開発・障害改修', 'Java, SQL'])
  expect(interviewCapabilityRequirements([{ key: 'title', value: '【急募】[東京]' }])).toEqual([])
})

it.each([
  '「日立財務報表システム」で具体的な一機能を選び、担当範囲と成果を説明してください。',
  '新規機能または機能改善を一つ取り上げ、設計から品質確認までを説明してください。',
  '想定外の問題を１つ選んで、切り分けと対応を説明してください。',
  '请选择一个你负责的功能，说明设计判断和成果。',
  '请举一个线上故障的例子，说明排查过程。',
  'Pick one project and walk me through your role.'
])('detects a question that leaves choosing the example to the candidate: %s', (text) => {
  expect(asksCandidateToChooseExample(text)).toBe(true)
})

it.each([
  'ユーザープッシュ通知システムで通知の重複送信をどう防ぎましたか。',
  '你独立设计的接口如何处理失败重试？',
  '请结合 Java 接口项目，说明你的方案选择、实现职责及成果。',
  'マイクロサービス化でサービス境界をどこに置くかは誰がどう決めましたか。'
])('keeps a question anchored on a named example: %s', (text) => {
  expect(asksCandidateToChooseExample(text)).toBe(false)
})

it('gives every dimension at least two ask shapes and every ask shape exactly one owning dimension', () => {
  for (const ask of interviewAskTypes)
    expect(interviewQuestionDimensions.filter((dimension) => interviewDimensionAsks[dimension].includes(ask))).toHaveLength(1)
  for (const dimension of interviewQuestionDimensions) expect(interviewDimensionAsks[dimension].length).toBeGreaterThanOrEqual(2)
})

it.each([
  '一般您如何处理线上障害？',
  '障害が発生した場合、普段はどのように調査しますか。',
  'How do you usually handle production incidents?'
])('detects a question about general practice: %s', (text) => {
  expect(asksAboutGeneralPractice(text)).toBe(true)
})

it.each([
  '「API development」で発生した障害を一つ挙げ、ログから原因を絞り込んだ手順を説明してください。',
  '你在支付保险系统里处理过的一次线上故障，是怎么定位的？'
])('keeps a question about a real case: %s', (text) => {
  expect(asksAboutGeneralPractice(text)).toBe(false)
})
