import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { businessMatchingPolicyVersion, type BusinessMatchQualification } from '@shared'
import { BusinessMatchEvidence } from './BusinessMatchEvidence'
afterEach(cleanup)
it('shows satisfied facts once, and keeps only business topics below a positive proposal decision', () => {
  const qualification: BusinessMatchQualification = { policyVersion: businessMatchingPolicyVersion, status: 'recommended', requirements: [
    { requirement: { id: 'tech', key: 'required_skills', label: 'C#（ASP.NET）', category: 'core', alternatives: [['C#', 'ASP.NET']], minimumYears: null, requiresPractice: false }, outcome: 'met', evidence: 'C# ASP.NET 開発を担当', source: '项目 A' },
    { requirement: { id: 'lang', key: 'japanese_level', label: '日本語N1流暢', category: 'condition', alternatives: [], minimumYears: null, requiresPractice: false }, outcome: 'met', evidence: 'N1、会話流暢', source: '语言' },
    { requirement: { id: 'onsite', key: 'remote', label: '週3出勤', category: 'condition', alternatives: [], minimumYears: null, requiresPractice: false }, outcome: 'conflict', evidence: '在宅のみ', source: '工作方式' }
  ] }
  render(<BusinessMatchEvidence qualification={qualification} questions={['C#（ASP.NET）の実務経験を確認してください', '日本語レベルを確認してください']} zh />)
  expect(screen.getByText('可以提案')).toBeInTheDocument()
  expect(screen.getAllByText('C#（ASP.NET）')).toHaveLength(1)
  expect(screen.getAllByText('日本語N1流暢')).toHaveLength(1)
  expect(screen.getByText('提案时需沟通')).toBeInTheDocument()
  expect(screen.getByText('週3出勤 · 条件有差异，需协商')).toBeInTheDocument()
  expect(screen.queryByText(/実務経験を確認|レベルを確認|有证据支持/)).not.toBeInTheDocument()
})
it('places a known language shortfall above matched facts and never asks to reconfirm it', () => {
  const qualification: BusinessMatchQualification = { policyVersion: businessMatchingPolicyVersion, status: 'excluded', requirements: [
    { requirement: { id: 'lang', key: 'japanese_level', label: '日本語N1流暢', category: 'condition', alternatives: [], minimumYears: null, requiresPractice: false }, outcome: 'conflict', evidence: '会話 C（ゆっくり対応可）', source: '语言' }
  ] }
  render(<BusinessMatchEvidence qualification={qualification} questions={['日本語N1流暢を確認してください']} zh />)
  expect(screen.getByText('不建议向本案提案')).toBeInTheDocument()
  expect(screen.getAllByText('日本語N1流暢')).toHaveLength(1)
  expect(screen.getByText(/会話 C/)).toBeInTheDocument()
  expect(screen.queryByText('提案时需沟通')).not.toBeInTheDocument()
  expect(screen.queryByText('需要补充的核心信息')).not.toBeInTheDocument()
})

it.each(['excluded', 'needs-confirmation'] as const)('hides proposal negotiations until qualified: %s', status => {
  const qualification: BusinessMatchQualification = { policyVersion: businessMatchingPolicyVersion, status, requirements: [
    { requirement: { id: 'tech', key: 'required_skills', label: 'ASP.NET', category: 'core', alternatives: [['ASP.NET']], minimumYears: null, requiresPractice: false }, outcome: status === 'excluded' ? 'conflict' : 'unknown', evidence: null, source: null },
    { requirement: { id: 'onsite', key: 'remote', label: '週3出勤', category: 'condition', alternatives: [], minimumYears: null, requiresPractice: false }, outcome: 'unknown', evidence: null, source: null },
    { requirement: { id: 'start', key: 'start_date', label: '9月～長期', category: 'condition', alternatives: [], minimumYears: null, requiresPractice: false }, outcome: 'unknown', evidence: null, source: null }
  ] }
  render(<BusinessMatchEvidence qualification={qualification} questions={['希望単価を確認']} zh />)
  expect(screen.getByText('ASP.NET')).toBeInTheDocument()
  expect(screen.queryByText('提案时需沟通')).not.toBeInTheDocument()
  expect(screen.queryByText('週3出勤')).not.toBeInTheDocument()
  expect(screen.queryByText('9月～長期')).not.toBeInTheDocument()
  expect(screen.queryByText('希望単価を確認')).not.toBeInTheDocument()
})
