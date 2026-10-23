import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { jobCaseFieldKeys, type JobCaseReviewSnapshot } from '@shared'
import { CaseAiFill } from './CaseAiFill'

const original = window.sesAgent
afterEach(() => Object.defineProperty(window, 'sesAgent', { configurable: true, value: original }))
const stub = (fillJobCaseFieldsWithAi: ReturnType<typeof vi.fn>) =>
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: { ...original, fillJobCaseFieldsWithAi } })
const labels: Record<string, string> = { location: '勤務地', start_date: '開始時期' }
const review = (empty: string[], change: Partial<JobCaseReviewSnapshot> = {}) =>
  ({
    reviewId: 'r1',
    lifecycle: 'active',
    status: 'completed',
    // The labels Main stores with each field.
    fields: jobCaseFieldKeys.map((key) => ({ key, label: labels[key] ?? key, value: empty.includes(key) ? null : 'x' })),
    ...change
  }) as unknown as JobCaseReviewSnapshot

it('offers AI completion when a key field is empty and reports what it filled', async () => {
  const fill = vi.fn().mockResolvedValue({ review: review([]), filled: ['location', 'start_date'] })
  stub(fill)
  const changed = vi.fn()
  window.addEventListener('ses-business-data-changed', changed)
  render(<CaseAiFill review={review(['location', 'start_date', 'notes'])} scope="key" />)
  expect(screen.getByText('未入力：勤務地・開始時期')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'AIで補完' }))
  expect(await screen.findByRole('status')).toHaveTextContent('AIで補完しました：勤務地・開始時期')
  expect(fill).toHaveBeenCalledExactlyOnceWith('r1')
  expect(changed).toHaveBeenCalledOnce()
  window.removeEventListener('ses-business-data-changed', changed)
})

it('stays out of the way for complete, ended or not-yet-valid cases', () => {
  stub(vi.fn())
  const { container, rerender } = render(<CaseAiFill review={review(['notes'])} scope="key" />)
  expect(container).toBeEmptyDOMElement()
  rerender(<CaseAiFill review={review(['location'], { lifecycle: 'archived' } as never)} scope="key" />)
  expect(container).toBeEmptyDOMElement()
  rerender(<CaseAiFill review={review(['location'], { status: 'awaiting-review' } as never)} scope="key" />)
  expect(container).toBeEmptyDOMElement()
  // Any empty field but the title, in the full field list.
  rerender(<CaseAiFill review={review(['notes'])} scope="all" />)
  expect(screen.getByRole('button', { name: 'AIで補完' })).toBeInTheDocument()
})

it('says when nothing could be filled, and offers the balance and credits when credits ran out', async () => {
  const fill = vi
    .fn()
    .mockResolvedValueOnce({ review: review(['rate']), filled: [] })
    .mockRejectedValueOnce(new Error('AiCommerceRequestError: INSUFFICIENT_CREDITS'))
  stub(fill)
  render(<CaseAiFill review={review(['rate'])} scope="key" />)
  fireEvent.click(screen.getByRole('button', { name: 'AIで補完' }))
  expect(await screen.findByRole('status')).toHaveTextContent('原文から補完できる項目は見つかりませんでした')
  fireEvent.click(screen.getByRole('button', { name: 'AIで補完' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('AIの利用可能クレジットが不足しています')
  expect(within(alert).getByRole('button', { name: '残高を確認' })).toBeInTheDocument()
  expect(within(alert).getByRole('button', { name: 'クレジットを追加' })).toBeInTheDocument()
})
