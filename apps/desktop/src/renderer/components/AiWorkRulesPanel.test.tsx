import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AiWorkRulesPanel } from './AiWorkRulesPanel'
vi.mock('../i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../i18n')>()
  return {
    ...actual,
    useUiLocale: () => 'zh-CN',
    useLocaleText: () => ({ locale: 'zh-CN' as const, zh: true, t: actual.localeText(true) })
  }
})
const text = 'Java 案件优先 AWS 经验'
const preview = {
  text,
  scope: { kind: 'global' },
  token: 'token',
  clauses: [{ kind: 'preferred', field: 'required_skills', text: 'AWS 经验', sourceQuote: text, caseKeywords: ['Java'] }],
  issues: [],
  modelKey: 'test',
  expiresAt: new Date(Date.now() + 60000).toISOString()
}
beforeEach(() => {
  Object.defineProperty(window, 'sesAgent', {
    configurable: true,
    value: {
      listWorkRules: vi.fn(async () => ({ revision: 0, rules: [] })),
      analyzeWorkRule: vi.fn(async () => preview),
      saveWorkRule: vi.fn(async () => ({})),
      changeWorkRule: vi.fn(),
      getWorkRuleHistory: vi.fn(async () => [])
    } as any
  })
})
afterEach(cleanup)
it('shows interpreted intent before saving, and editing the text invalidates the preview', async () => {
  render(<AiWorkRulesPanel />)
  await screen.findByText('还没有规则，可以从一次具体的匹配经验开始。')
  fireEvent.change(screen.getByLabelText('用一句话教系统'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'AI 整理规则' }))
  await screen.findByRole('button', { name: '保存并应用' })
  expect(window.sesAgent.saveWorkRule).not.toHaveBeenCalled()
  expect(screen.getByText('优先考虑')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('用一句话教系统'), { target: { value: 'Java 必须有 AWS' } })
  expect(screen.queryByRole('button', { name: '保存并应用' })).not.toBeInTheDocument()
})
it('keeps the natural-language draft on model failure', async () => {
  vi.mocked(window.sesAgent.analyzeWorkRule).mockRejectedValue(new Error('连接失败'))
  render(<AiWorkRulesPanel />)
  await screen.findByText('还没有规则，可以从一次具体的匹配经验开始。')
  fireEvent.change(screen.getByLabelText('用一句话教系统'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'AI 整理规则' }))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('用一句话教系统')).toHaveValue(text)
  expect(window.sesAgent.saveWorkRule).not.toHaveBeenCalled()
})
it('saves the preview token once and announces when rules are applied', async () => {
  render(<AiWorkRulesPanel />)
  await screen.findByText('还没有规则，可以从一次具体的匹配经验开始。')
  fireEvent.change(screen.getByLabelText('用一句话教系统'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'AI 整理规则' }))
  fireEvent.click(await screen.findByRole('button', { name: '保存并应用' }))
  await waitFor(() => expect(window.sesAgent.saveWorkRule).toHaveBeenCalledWith({ token: 'token', id: undefined, expectedRevision: 0 }))
  await screen.findByText('已保存并应用。新的匹配和面试问题将使用此规则。')
})
