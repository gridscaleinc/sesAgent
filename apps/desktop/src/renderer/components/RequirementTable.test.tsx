import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ApplicationLocale, MatchRequirementEvidence, RequirementDecisionResult } from '@shared'
import { focusRequirement, onRequirementDecision } from '../requirement-decision-events'
import { UiLocaleProvider } from '../i18n'
import { RequirementTable } from './RequirementTable'

afterEach(cleanup)

const row = (key: string, label: string, category: 'core' | 'condition' = 'condition'): MatchRequirementEvidence => ({
  requirement: { id: `${key}-${label}`, key, label, category, alternatives: [[label]], minimumYears: null, requiresPractice: false },
  outcome: 'unknown',
  evidence: null,
  source: null
})
const items = [row('remote', '無'), row('rate', '60〜70万円'), row('japanese_level', 'ビジネスレベル以上'), row('location', '東京')]
const table = (locale: ApplicationLocale) =>
  render(
    <UiLocaleProvider locale={locale}>
      <RequirementTable items={items} mode="follow-up" label="requirements" />
    </UiLocaleProvider>
  )

it('shows case requirement values in Chinese with the stored Japanese wording as the tooltip', () => {
  table('zh-CN')
  expect(screen.getByText('不可远程')).toHaveAttribute('title', '無')
  expect(screen.getByText('60–70万日元')).toHaveClass('is-normalized-value')
  expect(screen.getByText('商务级以上')).toHaveAttribute('title', 'ビジネスレベル以上')
  expect(screen.getByText('東京')).not.toHaveAttribute('title')
})

it('keeps the stored wording in the Japanese UI', () => {
  table('ja-JP')
  expect(screen.getByText('勤務形態：無')).not.toHaveAttribute('title')
  expect(screen.getByText('60〜70万円')).toBeInTheDocument()
  expect(document.querySelector('.is-normalized-value')).toBeNull()
})

const pair = { documentId: '11111111-1111-4111-8111-111111111111', jobCaseId: '22222222-2222-4222-8222-222222222222' }
const japanese: MatchRequirementEvidence = {
  requirement: {
    id: 'L1',
    key: 'required_skills',
    label: '日本語流暢',
    category: 'condition',
    alternatives: [],
    minimumYears: null,
    requiresPractice: false
  },
  outcome: 'unknown',
  evidence: 'N2',
  source: '日本語レベル'
}
const result: RequirementDecisionResult = { confirmations: [], assessments: [], personRun: null }
const evidence = (rows: MatchRequirementEvidence[]) =>
  render(
    <UiLocaleProvider locale="zh-CN">
      <div className="match-page">
        <RequirementTable items={rows} mode="evidence" label="匹配依据" pair={pair} />
      </div>
    </UiLocaleProvider>
  )

it('lets HR settle an unclear item as met, kept with the person by default, and tells every view', async () => {
  const decide = vi.fn(async () => result)
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: { decideRequirement: decide } })
  const heard = vi.fn()
  const stop = onRequirementDecision(heard)
  evidence([japanese])
  const row = screen.getByRole('row', { name: /日本語流暢/u })
  expect(within(row).getByText('需确认')).toBeInTheDocument()
  fireEvent.click(within(row).getByRole('button', { name: '满足' }))
  const form = screen.getByRole('form', { name: '确认满足「日本語流暢」' })
  expect(within(form).getByRole('checkbox')).toBeChecked()
  fireEvent.change(within(form).getByRole('textbox'), { target: { value: '面谈确认业务会话没问题' } })
  fireEvent.click(within(form).getByRole('button', { name: '确认' }))
  await waitFor(() => expect(heard).toHaveBeenCalledWith({ ...result, documentId: pair.documentId }))
  expect(decide).toHaveBeenCalledWith({
    ...pair,
    requirement: { key: 'required_skills', label: '日本語流暢', category: 'condition' },
    outcome: 'met',
    scope: 'person',
    note: '面谈确认业务会话没问题',
    question: null
  })
  expect(screen.queryByRole('form')).not.toBeInTheDocument()
  stop()
})

it('records a question for the person, kept to this case when unticked', async () => {
  const decide = vi.fn(async () => result)
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: { decideRequirement: decide } })
  evidence([japanese])
  fireEvent.click(screen.getByRole('button', { name: '问本人' }))
  const form = screen.getByRole('form', { name: '问本人「日本語流暢」' })
  expect((within(form).getByRole('textbox') as HTMLTextAreaElement).value).toContain('日本語流暢')
  fireEvent.click(within(form).getByRole('checkbox'))
  fireEvent.change(within(form).getByRole('textbox'), { target: { value: '' } })
  expect(within(form).getByRole('button', { name: '记录问题' })).toBeDisabled()
  fireEvent.change(within(form).getByRole('textbox'), { target: { value: '会議で日本語を使えますか' } })
  fireEvent.click(within(form).getByRole('button', { name: '记录问题' }))
  await waitFor(() =>
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'asking', scope: 'pair', note: null, question: '会議で日本語を使えますか' })
    )
  )
})

it('shows HR’s decision with its source, lets it be withdrawn, and offers 满足 / 不满足 while asking', async () => {
  const withdraw = vi.fn(async () => result)
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: { withdrawRequirementDecision: withdraw } })
  const decision = {
    confirmationId: '33333333-3333-4333-8333-333333333333',
    scope: 'person' as const,
    note: '面谈确认',
    decidedAt: '2026-10-01T01:00:00.000Z',
    decidedBy: '山田'
  }
  evidence([
    { ...japanese, outcome: 'met', hrDecision: { ...decision, outcome: 'met', question: null } },
    {
      ...japanese,
      requirement: { ...japanese.requirement, id: 'L2', label: 'TOEIC800以上' },
      hrDecision: {
        ...decision,
        confirmationId: '44444444-4444-4444-8444-444444444444',
        outcome: 'asking',
        note: null,
        question: '英語の会議経験は？'
      }
    }
  ])
  const met = screen.getByRole('row', { name: /日本語流暢/u })
  expect(within(met).getByText('HR 确认')).toHaveAttribute('title', expect.stringContaining('山田'))
  expect(within(met).queryByRole('button', { name: '满足' })).not.toBeInTheDocument()
  const asking = screen.getByRole('row', { name: /TOEIC800以上/u })
  expect(within(asking).getByText('沟通中')).toBeInTheDocument()
  expect(within(asking).getByText('英語の会議経験は？')).toBeInTheDocument()
  expect(within(asking).getByRole('button', { name: '不满足' })).toBeInTheDocument()
  expect(within(asking).queryByRole('button', { name: '问本人' })).not.toBeInTheDocument()
  fireEvent.click(within(met).getByRole('button', { name: '撤销' }))
  await waitFor(() => expect(withdraw).toHaveBeenCalledWith({ id: decision.confirmationId, documentId: pair.documentId }))
})

it('offers no decision without a pair or for business terms, and highlights a requirement asked for before it mounted', () => {
  focusRequirement('日本語流暢')
  evidence([japanese, row('rate', '60〜70万円')])
  expect(screen.getByRole('row', { name: /日本語流暢/u })).toHaveClass('is-flash')
  expect(within(screen.getByRole('row', { name: /60/u })).queryByRole('button', { name: '满足' })).not.toBeInTheDocument()
  cleanup()
  render(
    <UiLocaleProvider locale="zh-CN">
      <RequirementTable items={[japanese]} mode="evidence" label="匹配依据" />
    </UiLocaleProvider>
  )
  expect(screen.queryByRole('button', { name: '满足' })).not.toBeInTheDocument()
})
