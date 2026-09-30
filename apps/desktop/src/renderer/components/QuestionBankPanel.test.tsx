import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { QuestionBankPanel } from './QuestionBankPanel'
vi.mock('../i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../i18n')>()
  return {
    ...actual,
    useUiLocale: () => 'zh-CN',
    useLocaleText: () => ({ locale: 'zh-CN' as const, zh: true, t: actual.localeText(true) })
  }
})
const entry = {
  id: 'bank',
  version: 1,
  category: 'design',
  keyword: 'Java',
  text: '请说明项目中的设计决策。',
  scoringGuide: '给出职责和取舍依据。',
  scope: { label: '客户甲', locale: 'zh-CN' },
  enabled: true,
  state: 'available',
  sources: 2,
  adoptions: 3,
  edits: 1,
  reason: '已保存问题'
}
beforeEach(() =>
  Object.defineProperty(window, 'sesAgent', {
    configurable: true,
    value: {
      listQuestionBank: vi.fn(async () => [entry]),
      controlQuestionBank: vi.fn(async () => [{ ...entry, enabled: false, state: 'paused', version: 2 }])
    }
  })
)
afterEach(cleanup)
it('loads only while active, searches by content and filters categories', async () => {
  const { rerender } = render(<QuestionBankPanel active={false} />)
  expect(window.sesAgent.listQuestionBank).not.toHaveBeenCalled()
  rerender(<QuestionBankPanel active />)
  await screen.findByText(entry.text)
  fireEvent.change(screen.getByRole('textbox', { name: '搜索问题' }), { target: { value: 'Python' } })
  expect(screen.queryByText(entry.text)).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: '搜索问题' }), { target: { value: '客户甲' } })
  expect(screen.getByText(entry.text)).toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'testing' } })
  expect(screen.queryByText(entry.text)).not.toBeInTheDocument()
})
it('disables with the exact visible version and lets HR restore it', async () => {
  render(<QuestionBankPanel />)
  fireEvent.click(await screen.findByRole('button', { name: '停用此题' }))
  await waitFor(() => expect(window.sesAgent.controlQuestionBank).toHaveBeenCalledWith({ id: 'bank', expectedVersion: 1, enabled: false }))
  fireEvent.click(await screen.findByRole('button', { name: '恢复此题' }))
  await waitFor(() =>
    expect(window.sesAgent.controlQuestionBank).toHaveBeenLastCalledWith({ id: 'bank', expectedVersion: 2, enabled: true })
  )
})
it('retains the visible entry after a stale version is rejected', async () => {
  vi.mocked(window.sesAgent.controlQuestionBank).mockRejectedValue(new Error('题库已更新'))
  render(<QuestionBankPanel />)
  fireEvent.click(await screen.findByRole('button', { name: '停用此题' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('题库已更新')
  expect(screen.getByRole('button', { name: '停用此题' })).toBeInTheDocument()
})
