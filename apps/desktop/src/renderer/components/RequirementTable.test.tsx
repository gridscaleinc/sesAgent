import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it } from 'vitest'
import { businessMatchingPolicyVersion, type BusinessMatchQualification } from '@shared'
import { UiLocaleProvider } from '../i18n'
import { FollowUpTab, MatchEvidenceTab, followUpItems } from './RequirementTable'
import { MatchDetail, RequirementChips } from './MatchResultsLayout'
afterEach(cleanup)
const zh = (node: ReactNode) => render(<UiLocaleProvider locale="zh-CN">{node}</UiLocaleProvider>)
const requirement = (id: string, key: string, label: string, category: 'core' | 'condition', minimumYears: number | null = null) => ({
  id,
  key,
  label,
  category,
  alternatives: category === 'core' ? [[label]] : [],
  minimumYears,
  requiresPractice: false
})
const recommended: BusinessMatchQualification = {
  policyVersion: businessMatchingPolicyVersion,
  status: 'recommended',
  requirements: [
    {
      requirement: requirement('onsite', 'remote', '週3出勤', 'condition'),
      outcome: 'conflict',
      evidence: '在宅のみ',
      source: '工作方式'
    },
    {
      requirement: requirement('lang', 'japanese_level', '日本語N1流暢', 'condition'),
      outcome: 'met',
      evidence: 'N1、会話流暢',
      source: '语言'
    },
    {
      requirement: requirement('tech', 'required_skills', 'C#（ASP.NET）', 'core'),
      outcome: 'met',
      evidence: 'C# ASP.NET 開発を担当',
      source: '项目 A'
    }
  ]
}
const cellsOf = (table: HTMLElement, name: RegExp) =>
  within(within(table).getByRole('row', { name }))
    .getAllByRole('cell')
    .map((cell) => cell.textContent)

it('shows satisfied facts once, technical first, and keeps business terms for 需沟通', () => {
  zh(<MatchEvidenceTab qualification={recommended} />)
  const table = screen.getByRole('table', { name: '匹配依据' })
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)
  ).toEqual(['条件', '案件要求', '人员资料', '状态'])
  const rows = within(table).getAllByRole('row').slice(1)
  expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual(['必需技能', '日语能力'])
  expect(screen.getAllByText('C#（ASP.NET）')).toHaveLength(1)
  expect(screen.getAllByText('日本語N1流暢')).toHaveLength(1)
  expect(cellsOf(table, /C#/)).toEqual(['C#（ASP.NET）', 'C# ASP.NET 開発を担当项目 A', '✓ 满足'])
  expect(screen.getByText('项目 A', { selector: '.requirement-source' })).toBeInTheDocument()
  expect(screen.queryByText('週3出勤')).not.toBeInTheDocument()
  expect(screen.getByText('技术：符合要求 · 语言：符合要求')).toBeInTheDocument()
})

it('lists business differences and HR questions once the proposal is possible, without repeating assessed topics', () => {
  const questions = ['C#（ASP.NET）の実務経験を確認してください', '日本語レベルを確認してください', '希望単価を確認']
  expect(followUpItems(recommended, questions).items).toHaveLength(1)
  zh(<FollowUpTab qualification={recommended} questions={questions} />)
  const table = screen.getByRole('table', { name: '需沟通' })
  expect(cellsOf(table, /週3出勤/)).toEqual(['週3出勤', '在宅のみ工作方式', '需沟通'])
  expect(screen.getByText('以下事项不降低技术和语言的匹配结论。')).toBeInTheDocument()
  expect(screen.getByText('希望単価を確認')).toBeInTheDocument()
  expect(screen.queryByText(/実務経験を確認|レベルを確認|有证据支持/)).not.toBeInTheDocument()
})

it('places a known language shortfall in the table and never asks to reconfirm it', () => {
  const qualification: BusinessMatchQualification = {
    policyVersion: businessMatchingPolicyVersion,
    status: 'excluded',
    requirements: [
      {
        requirement: requirement('lang', 'japanese_level', '日本語N1流暢', 'condition'),
        outcome: 'conflict',
        evidence: '会話 C（ゆっくり対応可）',
        source: '语言'
      }
    ]
  }
  zh(
    <>
      <MatchEvidenceTab qualification={qualification} />
      <FollowUpTab qualification={qualification} questions={['日本語N1流暢を確認してください']} />
    </>
  )
  expect(screen.getAllByText('日本語N1流暢')).toHaveLength(1)
  expect(cellsOf(screen.getByRole('table', { name: '匹配依据' }), /N1/)).toEqual([
    '日本語N1流暢',
    '会話 C（ゆっくり対応可）语言',
    '✗ 不满足'
  ])
  expect(screen.getByText('技术：案件要求待补充 · 语言：存在差距')).toBeInTheDocument()
  expect(screen.queryByRole('table', { name: '需沟通' })).not.toBeInTheDocument()
  expect(screen.queryByText(/确认してください/)).not.toBeInTheDocument()
})

it.each(['excluded', 'needs-confirmation'] as const)('holds proposal negotiations until qualified: %s', (status) => {
  const qualification: BusinessMatchQualification = {
    policyVersion: businessMatchingPolicyVersion,
    status,
    requirements: [
      {
        requirement: requirement('tech', 'required_skills', 'ASP.NET', 'core'),
        outcome: status === 'excluded' ? 'conflict' : 'unknown',
        evidence: null,
        source: null
      },
      { requirement: requirement('onsite', 'remote', '週3出勤', 'condition'), outcome: 'unknown', evidence: null, source: null },
      { requirement: requirement('start', 'start_date', '9月～長期', 'condition'), outcome: 'unknown', evidence: null, source: null }
    ]
  }
  expect(followUpItems(qualification, ['希望単価を確認'])).toEqual({ shown: false, items: [], questions: [] })
  zh(
    <>
      <MatchEvidenceTab qualification={qualification} />
      <FollowUpTab qualification={qualification} questions={['希望単価を確認']} />
    </>
  )
  expect(cellsOf(screen.getByRole('table', { name: '匹配依据' }), /ASP/)).toEqual([
    'ASP.NET',
    '—',
    status === 'excluded' ? '✗ 不满足' : '需确认'
  ])
  expect(screen.queryByText('週3出勤')).not.toBeInTheDocument()
  expect(screen.queryByText('9月～長期')).not.toBeInTheDocument()
  expect(screen.queryByText('希望単価を確認')).not.toBeInTheDocument()
  expect(screen.getByText(/技术和语言条件确认可以提案后/)).toBeInTheDocument()
})

it('tags a met skill without stated years and one the AI verified, and marks it on the row chip', () => {
  const qualification: BusinessMatchQualification = {
    policyVersion: businessMatchingPolicyVersion,
    status: 'recommended',
    requirements: [
      {
        requirement: requirement('java', 'required_skills', 'Java 5年以上', 'core', 5),
        outcome: 'met',
        evidence: 'Java',
        source: 'スキル',
        yearsUnconfirmed: true
      },
      {
        requirement: requirement('sql', 'required_skills', 'SQL', 'core'),
        outcome: 'met',
        evidence: 'SQL チューニング',
        source: '案件 B',
        aiVerified: true
      },
      { requirement: requirement('aws', 'required_skills', 'AWS', 'core'), outcome: 'unknown', evidence: null, source: null }
    ]
  }
  zh(
    <>
      <MatchEvidenceTab qualification={qualification} />
      <RequirementChips qualification={qualification} />
    </>
  )
  expect(screen.getByText('年限未写明', { selector: '.requirement-tag' })).toBeVisible()
  expect(screen.getByText('AI 核实', { selector: '.requirement-tag' })).toBeVisible()
  expect(screen.getByText('? Java 5年以上')).toHaveAttribute('title', 'Java 5年以上 · 年限未写明')
  expect(screen.getByText('✓ SQL')).toHaveClass('is-met')
  expect(screen.getByText('? AWS')).toHaveClass('is-unknown')
})

it('switches detail tabs with the arrow keys', () => {
  function Tabs() {
    return (
      <MatchDetail
        label="Detail"
        title="Detail"
        tab="a"
        onTab={(id) => {
          tabs.push(id)
        }}
        onBackToList={() => {}}
        tabs={[
          { id: 'a', label: 'A', content: 'first' },
          { id: 'b', label: 'B', content: 'second' }
        ]}
      />
    )
  }
  const tabs: string[] = []
  zh(<Tabs />)
  const [first] = screen.getAllByRole('tab')
  expect(first).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tabpanel')).toHaveTextContent('first')
  expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', first!.id)
  fireEvent.keyDown(first!, { key: 'ArrowRight' })
  fireEvent.keyDown(first!, { key: 'End' })
  expect(tabs).toEqual(['b', 'b'])
})
