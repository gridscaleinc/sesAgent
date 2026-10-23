import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { jobCaseFieldKeys, type JobCaseReviewSnapshot } from '@shared'
import { CaseAiRecheck } from './CaseAiRecheck'

const original = window.sesAgent
afterEach(() => Object.defineProperty(window, 'sesAgent', { configurable: true, value: original }))
const stub = (api: Record<string, unknown>) => Object.defineProperty(window, 'sesAgent', { configurable: true, value: { ...original, ...api } })
const labels: Record<string, string> = { location: '勤務地', remote: 'リモート', rate: '単価' }
const review = (change: Partial<JobCaseReviewSnapshot> = {}) =>
  ({
    reviewId: 'r1',
    reviewRevision: 3,
    lifecycle: 'active',
    status: 'completed',
    fields: jobCaseFieldKeys.map((key) => ({ key, label: labels[key] ?? key, value: key === 'remote' ? null : `${key}値` })),
    ...change
  }) as unknown as JobCaseReviewSnapshot

it('shows each suggested correction as case value → source value and applies only the ticked ones', async () => {
  const suggest = vi.fn().mockResolvedValue({
    reviewId: 'r1',
    reviewRevision: 3,
    corrections: [
      { key: 'location', current: '品川', suggested: '渋谷駅' },
      { key: 'remote', current: null, suggested: '週2出社' }
    ]
  })
  const apply = vi.fn().mockResolvedValue({ review: review(), filled: ['remote'] })
  stub({ suggestJobCaseFieldCorrections: suggest, applyJobCaseFieldCorrections: apply })
  const changed = vi.fn()
  window.addEventListener('ses-business-data-changed', changed)
  render(<CaseAiRecheck review={review()} />)
  fireEvent.click(screen.getByRole('button', { name: 'AIで再確認' }))
  const panel = await screen.findByRole('region', { name: 'AIの修正提案' })
  expect(within(panel).getByText('品川')).toHaveClass('case-ai-recheck-current')
  expect(within(panel).getByText('渋谷駅')).toBeInTheDocument()
  expect(within(panel).getByText('未入力')).toBeInTheDocument()
  // Both are ticked at first; HR keeps 品川.
  fireEvent.click(within(panel).getByRole('checkbox', { name: '勤務地' }))
  fireEvent.click(within(panel).getByRole('button', { name: '選んだ 1 件を反映' }))
  expect(await screen.findByRole('status')).toHaveTextContent('修正しました：リモート')
  expect(apply).toHaveBeenCalledExactlyOnceWith({ reviewId: 'r1', reviewRevision: 3, keys: ['remote'] })
  expect(changed).toHaveBeenCalledOnce()
  window.removeEventListener('ses-business-data-changed', changed)
})

it('says when the case already matches its source, and offers the balance when credits ran out', async () => {
  const suggest = vi
    .fn()
    .mockResolvedValueOnce({ reviewId: 'r1', reviewRevision: 3, corrections: [] })
    .mockRejectedValueOnce(new Error('AiCommerceRequestError: INSUFFICIENT_CREDITS'))
  stub({ suggestJobCaseFieldCorrections: suggest, applyJobCaseFieldCorrections: vi.fn() })
  render(<CaseAiRecheck review={review()} />)
  fireEvent.click(screen.getByRole('button', { name: 'AIで再確認' }))
  expect(await screen.findByRole('status')).toHaveTextContent('原文と一致しています')
  fireEvent.click(screen.getByRole('button', { name: 'AIで再確認' }))
  const alert = await screen.findByRole('alert')
  expect(within(alert).getByRole('button', { name: '残高を確認' })).toBeInTheDocument()
})

it('is not offered for an ended or not yet valid case', () => {
  stub({ suggestJobCaseFieldCorrections: vi.fn(), applyJobCaseFieldCorrections: vi.fn() })
  const { container, rerender } = render(<CaseAiRecheck review={review({ lifecycle: 'archived' } as never)} />)
  expect(container).toBeEmptyDOMElement()
  rerender(<CaseAiRecheck review={review({ status: 'awaiting-review' } as never)} />)
  expect(container).toBeEmptyDOMElement()
})
