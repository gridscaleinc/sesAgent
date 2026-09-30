import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BusinessInterviewQuestions } from './BusinessInterviewQuestions'
vi.mock('../i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../i18n')>()
  return {
    ...actual,
    useUiLocale: () => 'zh-CN',
    useLocaleText: () => ({ locale: 'zh-CN' as const, zh: true, t: actual.localeText(true) })
  }
})
vi.mock('../business-progress-data', () => ({ useBusinessProgress: () => null }))
afterEach(cleanup)

it('previews a fresh five-question draft instead of appending it to the saved plan', async () => {
  const questions = Array.from({ length: 5 }, (_, i) => ({
    id: `new-${i}`,
    text: `新问题 ${i + 1}`,
    selected: true,
    source: 'match',
    requirement: 'Java',
    sourceLabel: `能力维度 ${i + 1}`,
    scoringGuide: '具体行为和成果'
  }))
  const generateRuleQuestions = vi.fn(async () => ({ questions }))
  const advanceBusinessProgress = vi.fn(async () => ({}))
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: { generateRuleQuestions, advanceBusinessProgress } })
  render(
    <BusinessInterviewQuestions
      follow={{ documentId: 'p', reviewId: 'r', revision: 1 } as any}
      round={{ id: 'i', roundNumber: 1, questionPlan: [{ id: 'old', text: '旧问题', selected: true }] } as any}
      disabled={false}
      onSaved={vi.fn()}
    />
  )
  expect(screen.getByDisplayValue('旧问题')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
  await screen.findByDisplayValue('新问题 1')
  expect(screen.queryByDisplayValue('旧问题')).not.toBeInTheDocument()
  expect(screen.getAllByLabelText('编辑面试问题')).toHaveLength(5)
  expect(advanceBusinessProgress).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
  await waitFor(() => expect(generateRuleQuestions).toHaveBeenCalledTimes(2))
  expect(screen.getAllByLabelText('编辑面试问题')).toHaveLength(5)
  fireEvent.click(screen.getByRole('button', { name: /保存本轮问题/ }))
  await waitFor(() => expect(advanceBusinessProgress).toHaveBeenCalledWith(expect.objectContaining({ questions })))
})

const draft = {
  id: 'd1',
  documentId: 'p',
  jobCaseId: 'c',
  jobCaseVersion: 1,
  profileVersion: 1,
  rulesRevision: 0,
  experienceRunId: null,
  createdAt: new Date().toISOString(),
  supersededAt: null,
  questions: [
    {
      id: 'dq-1',
      text: '请说明 Java 项目中本人负责的范围。',
      selected: true,
      source: 'match',
      sourceLabel: '履历真实性与深度 · Java',
      scoringGuide: '本人职责与成果'
    }
  ]
}

it('carries the assessment-time draft into an empty first round and saves it through prepare', async () => {
  const getCaseQuestionDraft = vi.fn(async () => ({ draft, stale: false }))
  const advanceBusinessProgress = vi.fn(async () => ({}))
  Object.defineProperty(window, 'sesAgent', {
    configurable: true,
    value: { generateRuleQuestions: vi.fn(), advanceBusinessProgress, getCaseQuestionDraft }
  })
  render(
    <BusinessInterviewQuestions
      follow={{ documentId: 'p', reviewId: 'r', revision: 1 } as any}
      round={{ id: 'i', roundNumber: 1, questionPlan: [] } as any}
      disabled={false}
      onSaved={vi.fn()}
    />
  )
  await screen.findByDisplayValue('请说明 Java 项目中本人负责的范围。')
  expect(getCaseQuestionDraft).toHaveBeenCalledWith({ documentId: 'p', reviewId: 'r' })
  expect(screen.getByText('已带入评估时生成的面试题草案，可调整后保存到本轮。')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /保存本轮问题/ }))
  await waitFor(() =>
    expect(advanceBusinessProgress).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'prepare', roundNumber: 1, questions: draft.questions })
    )
  )
})

it('only reports a stale draft and never carries it into the round or a later round', async () => {
  const getCaseQuestionDraft = vi.fn(async () => ({ draft, stale: true }))
  Object.defineProperty(window, 'sesAgent', {
    configurable: true,
    value: { generateRuleQuestions: vi.fn(), advanceBusinessProgress: vi.fn(), getCaseQuestionDraft }
  })
  render(
    <BusinessInterviewQuestions
      follow={{ documentId: 'p', reviewId: 'r', revision: 1 } as any}
      round={{ id: 'i', roundNumber: 1, questionPlan: [] } as any}
      disabled={false}
      onSaved={vi.fn()}
    />
  )
  await screen.findByText('评估时生成的面试题草案已过期（资料或规则已更新），请重新生成。')
  expect(screen.queryAllByLabelText('编辑面试问题')).toHaveLength(0)
  expect(screen.queryByRole('button', { name: /保存本轮问题/ })).not.toBeInTheDocument()
  cleanup()
  render(
    <BusinessInterviewQuestions
      follow={{ documentId: 'p', reviewId: 'r', revision: 1 } as any}
      round={{ id: 'i2', roundNumber: 2, questionPlan: [] } as any}
      disabled={false}
      onSaved={vi.fn()}
    />
  )
  expect(getCaseQuestionDraft).toHaveBeenCalledTimes(1)
})

it('tells HR before any round exists that assessment-time questions are waiting', async () => {
  const { CaseQuestionDraftNotice } = await import('./BusinessInterviewQuestions')
  Object.defineProperty(window, 'sesAgent', {
    configurable: true,
    value: { getCaseQuestionDraft: vi.fn(async () => ({ draft, stale: false })) }
  })
  render(<CaseQuestionDraftNotice follow={{ id: 'f', documentId: 'p', reviewId: 'r', revision: 1 } as any} />)
  await screen.findByText('评估时已生成 1 道面试题，安排面试后会带入第一轮。')
})

it('renders each question as a card: dimension chip, question first, follow-up, split guide and folded sources', async () => {
  const { splitScoringGuide, interviewPreparationSheet } = await import('./BusinessInterviewQuestions')
  const question = {
    id: 'q1',
    text: '「日立財務報表システム」で担当した範囲を説明してください。',
    selected: true,
    source: 'match',
    dimension: 'authenticity',
    requirement: 'Java / 基本設計',
    evidence: '技術方針の策定を担当',
    requirementItems: ['Java', '基本設計'],
    evidenceItems: ['技術方針の策定を担当'],
    sourceLabel: '履历真实性与深度 · Java / 基本設計',
    scoringGuide: '強い回答は担当モジュールと独自作成物を説明できる。警戒サインはチーム成果だけで本人の作業を説明できないこと。',
    followUp: 'その中で他メンバーと区別できる作成物は何ですか？'
  }
  Object.defineProperty(window, 'sesAgent', {
    configurable: true,
    value: {
      generateRuleQuestions: vi.fn(),
      advanceBusinessProgress: vi.fn(),
      getCaseQuestionDraft: vi.fn(async () => ({ draft: null, stale: false }))
    }
  })
  render(
    <BusinessInterviewQuestions
      follow={{ documentId: 'p', reviewId: 'r', revision: 1 } as any}
      round={{ id: 'i', roundNumber: 1, questionPlan: [question] } as any}
      disabled={false}
      onSaved={vi.fn()}
    />
  )
  const card = screen.getByRole('article', { name: '问题 1' })
  expect(card).toHaveTextContent('履历真实性与深度')
  expect(screen.getByDisplayValue(question.text)).toBeInTheDocument()
  expect(screen.getByDisplayValue(question.followUp)).toBeInTheDocument()
  expect(card).toHaveTextContent('好回答')
  expect(card).toHaveTextContent('警戒サインはチーム成果だけで本人の作業を説明できないこと。')
  expect(card.querySelector('details')).not.toHaveAttribute('open')
  expect(card).toHaveTextContent('依据 · 案件要求 2 · 简历 1')
  expect(screen.getByText('第 1 轮 · 已采用 1 / 1 · 已保存到本轮')).toBeInTheDocument()
  // Nothing is pinned over the questions until there is an unsaved edit.
  expect(document.querySelector('.interview-questions-footer')).toBeNull()
  expect(splitScoringGuide(question.scoringGuide)).toEqual({
    strong: '強い回答は担当モジュールと独自作成物を説明できる。',
    warning: '警戒サインはチーム成果だけで本人の作業を説明できないこと。'
  })
  expect(interviewPreparationSheet([question as any], true)).toContain('   追问: その中で他メンバーと区別できる作成物は何ですか？')
  // Switching a question off keeps it on the card, dimmed, and reveals the save button.
  fireEvent.click(screen.getByLabelText('采用'))
  expect(card.className).toContain('is-skipped')
  expect(screen.getByRole('button', { name: '保存本轮问题 (0)' })).toBeInTheDocument()
})

it('shows the rejection reason in the operator language without the IPC prefix', async () => {
  const { questionErrorMessage } = await import('./BusinessInterviewQuestions')
  const cause = new Error(
    "Error invoking remote method 'ai-work-rules:questions': Error: 面试问题把选择例子的工作交给了候选人，请重新生成。 / 質問が事例の選択を候補者に委ねています。"
  )
  expect(questionErrorMessage(cause, true, '操作失败')).toBe('面试问题把选择例子的工作交给了候选人，请重新生成。')
  expect(questionErrorMessage(cause, false, '操作失败')).toBe('質問が事例の選択を候補者に委ねています。')
  expect(questionErrorMessage(new Error('[{"code":"invalid_value"}]'), true, '操作失败')).toBe('操作失败')
  expect(questionErrorMessage(new Error('network down'), true, '操作失败')).toBe('network down')
})

it('passes what HR typed next to the generate button to the model, and omits an empty box', async () => {
  const generateRuleQuestions = vi.fn(async () => ({ questions: [] }))
  Object.defineProperty(window, 'sesAgent', {
    configurable: true,
    value: {
      generateRuleQuestions,
      advanceBusinessProgress: vi.fn(),
      getCaseQuestionDraft: vi.fn(async () => ({ draft: null, stale: false }))
    }
  })
  render(
    <BusinessInterviewQuestions
      follow={{ documentId: 'p', reviewId: 'r', revision: 1 } as any}
      round={{ id: 'i', roundNumber: 1, questionPlan: [] } as any}
      disabled={false}
      onSaved={vi.fn()}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '按案件与规则生成问题' }))
  await waitFor(() => expect(generateRuleQuestions).toHaveBeenCalledWith({ documentId: 'p', interviewId: 'i' }))
  fireEvent.change(screen.getByLabelText('对 AI 的要求'), { target: { value: '  加上团队管理的问题  ' } })
  fireEvent.click(screen.getByRole('button', { name: '按案件与规则生成问题' }))
  await waitFor(() =>
    expect(generateRuleQuestions).toHaveBeenCalledWith({ documentId: 'p', interviewId: 'i', request: '加上团队管理的问题' })
  )
})
