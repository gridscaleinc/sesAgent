import { expect, it } from 'vitest'
import { generatePersonnelProposal, proposalJapaneseAbility, type ProposalPerson } from './personnel-proposal'

const person: ProposalPerson = {
  documentId: 'e9aef099-0000-4000-8000-000000000001',
  fields: [{ key: 'role', value: 'SE' }, { key: 'experience_years', value: '19年' },
    { key: 'skills', value: 'Windows (◎), Linux (◎), Java (◎), Spring Boot (○), MyBatis, Oracle, PostgreSQL, SQL, Git, Eclipse' },
    { key: 'japanese_level', value: '読む C（ゆっくり対応可） / 書く B（スムーズ対応可） / 会話 C（ゆっくり対応可）' }],
  projectExperiences: [{ title: '金融システム', technologies: ['Java', 'Spring Boot', 'SQL'], summary: 'Javaを用いた追加機能開発を担当。既存機能の障害原因調査と改修を担当。OracleのSQL作成およびデータ調査を担当。単体テストと結合テストを実施。' },
    { title: '別案件', technologies: ['Python'], summary: 'Pythonによるデータ分析と研究を担当。' }]
}
const job = { fields: [{ key: 'title', value: 'Java追加機能開発・障害改修' }, { key: 'required_skills', value: 'Java、Spring Boot、SQL' }, { key: 'start_date', value: '2026-09-01' }, { key: 'rate', value: '90万円' }, { key: 'location', value: '勝どき' }] }

it('renders the SES mail structure and a separate subject without inventing commercial facts', () => {
  const result = generatePersonnelProposal(person, job)
  expect(result.subject).toContain('Java・Spring Boot・SQL')
  expect(result.subject).toContain('経験19年')
  expect(result.subject).toContain('要員ID：E9AEF099')
  for (const heading of ['■要員概要', '■主要スキル', '■案件とのマッチポイント']) expect(result.text).toContain(heading)
  expect(result.text).not.toContain('所属：')
  expect(result.text).not.toContain('希望単価：')
  expect(result.text).not.toMatch(/2026-09-01|90万円|勝どき|要確認|◎|○|△|Java：Java|添付しております/)
  expect(result.matchPoints).toEqual([])
  expect(result.text).toContain('■対応工程')
  expect(result.text).not.toMatch(/での担当内容|实际职责|金融システム/)
  expect(result.text).not.toContain('業務会話可')
})

it('changes project evidence with the case rather than reusing generic match points', () => {
  const python = generatePersonnelProposal(person, { fields: [{ key: 'title', value: 'Python データ分析' }, { key: 'required_skills', value: 'Python' }] })
  expect(python.matchPoints).toEqual([])
  expect(python.subject).toContain('Python')
  expect(python.matchPoints.join('')).not.toContain('金融システム')
})

it('does not infer fluency or technology tenure from grade letters and overall years', () => {
  expect(proposalJapaneseAbility('読む C / 書く B / 会話 C')).toBe('読む C / 書く B / 会話 C')
  const result = generatePersonnelProposal({ ...person, projectExperiences: [] }, job)
  expect(result.matchPoints).toEqual([])
  expect(result.text).not.toContain('Java開発経験が19年')
})

it('preserves explicit negotiable and pending states and generates Chinese with fill-in placeholders', () => {
  const result = generatePersonnelProposal({ ...person, fields: [...person.fields, { key: 'rate', value: '応相談' }, { key: 'availability', value: '確認中' }, { key: 'work_style', value: '無' }] }, job, 'zh')
  expect(result.text).not.toContain('期望单价：')
  expect(result.text).not.toContain('可入场时间：')
  expect(result.text).not.toContain('工作方式：')
  expect(result.text).not.toContain('工作方式：無')
})
