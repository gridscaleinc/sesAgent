import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BusinessInterviewQuestions } from './BusinessInterviewQuestions'
vi.mock('../i18n', () => ({ useUiLocale: () => 'zh-CN' }))
vi.mock('../business-progress-data', () => ({ useBusinessProgress: () => null }))
afterEach(cleanup)

it('previews a fresh five-question draft instead of appending it to the saved plan', async () => {
  const questions = Array.from({ length: 5 }, (_, i) => ({ id: `new-${i}`, text: `新问题 ${i + 1}`, selected: true, source: 'match', requirement: 'Java', sourceLabel: `能力维度 ${i + 1}`, scoringGuide: '具体行为和成果' }))
  const generateRuleQuestions = vi.fn(async () => ({ questions }))
  const advanceBusinessProgress = vi.fn(async () => ({}))
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: { generateRuleQuestions, advanceBusinessProgress } })
  render(<BusinessInterviewQuestions follow={{ documentId: 'p', reviewId: 'r', revision: 1 } as any} round={{ id: 'i', roundNumber: 1, questionPlan: [{ id: 'old', text: '旧问题', selected: true }] } as any} disabled={false} onSaved={vi.fn()} />)
  fireEvent.click(screen.getByText(/本轮面试问题/))
  expect(screen.getByDisplayValue('旧问题')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '按案件与规则生成问题' }))
  await screen.findByDisplayValue('新问题 1')
  expect(screen.queryByDisplayValue('旧问题')).not.toBeInTheDocument()
  expect(screen.getAllByRole('textbox')).toHaveLength(5)
  expect(advanceBusinessProgress).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '按案件与规则生成问题' }))
  await waitFor(() => expect(generateRuleQuestions).toHaveBeenCalledTimes(2))
  expect(screen.getAllByRole('textbox')).toHaveLength(5)
  fireEvent.click(screen.getByRole('button', { name: '保存本轮问题' }))
  await waitFor(() => expect(advanceBusinessProgress).toHaveBeenCalledWith(expect.objectContaining({ questions })))
})

const draft = { id: 'd1', documentId: 'p', jobCaseId: 'c', jobCaseVersion: 1, profileVersion: 1, rulesRevision: 0, experienceRunId: null, createdAt: new Date().toISOString(), supersededAt: null,
  questions: [{ id: 'dq-1', text: '请说明 Java 项目中本人负责的范围。', selected: true, source: 'match', sourceLabel: '履历真实性与深度 · Java', scoringGuide: '本人职责与成果' }] }

it('carries the assessment-time draft into an empty first round and saves it through prepare', async () => {
  const getCaseQuestionDraft = vi.fn(async () => ({ draft, stale: false }))
  const advanceBusinessProgress = vi.fn(async () => ({}))
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: { generateRuleQuestions: vi.fn(), advanceBusinessProgress, getCaseQuestionDraft } })
  render(<BusinessInterviewQuestions follow={{ documentId: 'p', reviewId: 'r', revision: 1 } as any} round={{ id: 'i', roundNumber: 1, questionPlan: [] } as any} disabled={false} onSaved={vi.fn()} />)
  await screen.findByDisplayValue('请说明 Java 项目中本人负责的范围。')
  expect(getCaseQuestionDraft).toHaveBeenCalledWith({ documentId: 'p', reviewId: 'r' })
  expect(screen.getByText('已带入评估时生成的面试题草案，可调整后保存到本轮。')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保存本轮问题' }))
  await waitFor(() => expect(advanceBusinessProgress).toHaveBeenCalledWith(expect.objectContaining({ action: 'prepare', roundNumber: 1, questions: draft.questions })))
})

it('only reports a stale draft and never carries it into the round or a later round', async () => {
  const getCaseQuestionDraft = vi.fn(async () => ({ draft, stale: true }))
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: { generateRuleQuestions: vi.fn(), advanceBusinessProgress: vi.fn(), getCaseQuestionDraft } })
  render(<BusinessInterviewQuestions follow={{ documentId: 'p', reviewId: 'r', revision: 1 } as any} round={{ id: 'i', roundNumber: 1, questionPlan: [] } as any} disabled={false} onSaved={vi.fn()} />)
  await screen.findByText('评估时生成的面试题草案已过期（资料或规则已更新），请重新生成。')
  expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  expect(screen.queryByRole('button', { name: '保存本轮问题' })).not.toBeInTheDocument()
  cleanup()
  render(<BusinessInterviewQuestions follow={{ documentId: 'p', reviewId: 'r', revision: 1 } as any} round={{ id: 'i2', roundNumber: 2, questionPlan: [] } as any} disabled={false} onSaved={vi.fn()} />)
  expect(getCaseQuestionDraft).toHaveBeenCalledTimes(1)
})

it('tells HR before any round exists that assessment-time questions are waiting', async () => {
  const { CaseQuestionDraftNotice } = await import('./BusinessInterviewQuestions')
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: { getCaseQuestionDraft: vi.fn(async () => ({ draft, stale: false })) } })
  render(<CaseQuestionDraftNotice follow={{ id: 'f', documentId: 'p', reviewId: 'r', revision: 1 } as any} />)
  await screen.findByText('评估时已生成 1 道面试题，安排面试后会带入第一轮。')
})
