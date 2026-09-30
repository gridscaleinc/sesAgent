import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CustomerIdentitiesPanel } from './CustomerIdentitiesPanel'
import { InterviewEvidencePanel } from './InterviewEvidencePanel'
vi.mock('../i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../i18n')>()
  return {
    ...actual,
    useUiLocale: () => 'zh-CN',
    useLocaleText: () => ({ locale: 'zh-CN' as const, zh: true, t: actual.localeText(true) })
  }
})
afterEach(cleanup)
function api(value: unknown) {
  Object.defineProperty(window, 'sesAgent', { configurable: true, value })
}
it('saves customer aliases with the displayed version and lets a conflict surface', async () => {
  const saveCustomerIdentity = vi.fn().mockRejectedValue(new Error('名称已属于另一客户'))
  api({ listCustomerIdentities: vi.fn(async () => [{ id: 'c', version: 2, name: 'ABC', aliases: ['客户甲'] }]), saveCustomerIdentity })
  const { container } = render(<CustomerIdentitiesPanel />)
  await screen.findByText('ABC')
  fireEvent.click(screen.getByText('客户名称与别名'))
  fireEvent.click(screen.getByRole('button', { name: '编辑关联' }))
  fireEvent.change(screen.getByLabelText('其他名称，每行一个'), { target: { value: '客户乙' } })
  fireEvent.submit(container.querySelector('form')!)
  await screen.findByRole('alert')
  expect(saveCustomerIdentity).toHaveBeenCalledWith({ id: 'c', expectedVersion: 2, name: 'ABC', aliases: ['客户乙'] })
})
it('loads interview evidence only when expanded and clearly keeps recorded claims unverified', async () => {
  const getPairInterviewEvidence = vi.fn(async () => [
    {
      interviewId: 'i',
      questionId: 'q',
      questionText: '本人设计职责',
      status: 'partial',
      quote: '本人说明参与实现。',
      remaining: '独立设计职责',
      requirement: 'Java'
    }
  ])
  api({ getPairInterviewEvidence })
  render(<InterviewEvidencePanel documentId="p" reviewId="r" />)
  expect(getPairInterviewEvidence).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('面试回答与待核实事项'))
  await screen.findByText('本人说明参与实现。')
  expect(screen.getByText('已有部分回答，需继续确认')).toBeInTheDocument()
})

it('clears pair evidence immediately on case change and ignores a late previous response', async () => {
  let resolveOld!: (rows: unknown[]) => void
  const getPairInterviewEvidence = vi
    .fn()
    .mockResolvedValueOnce([
      { interviewId: 'i', questionId: 'q', questionText: '旧案件问题', status: 'partial', quote: '旧案件回答', requirement: 'Java' }
    ])
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        })
    )
    .mockResolvedValueOnce([])
  api({ getPairInterviewEvidence })
  const { rerender } = render(<InterviewEvidencePanel documentId="p" reviewId="a" />)
  fireEvent.click(screen.getByText('面试回答与待核实事项'))
  await screen.findByText('旧案件回答')
  rerender(<InterviewEvidencePanel documentId="p" reviewId="b" />)
  expect(screen.queryByText('旧案件回答')).not.toBeInTheDocument()
  rerender(<InterviewEvidencePanel documentId="p" reviewId="c" />)
  resolveOld([{ interviewId: 'i', questionId: 'q', questionText: '迟到问题', status: 'partial', quote: '迟到回答', requirement: 'Java' }])
  await waitFor(() => expect(getPairInterviewEvidence).toHaveBeenCalledTimes(3))
  expect(screen.queryByText('迟到回答')).not.toBeInTheDocument()
})
