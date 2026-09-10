import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { JobCaseSourceText } from '@shared'
import { FormattedCaseBody, JobCaseBody } from './JobCaseBody'
const review = { reviewId: 'case-one', redactedPreview: 'truncated preview' }
const source = (redactedBody: string): JobCaseSourceText => ({ redactedBody, redactedSubject: 'subject', sourceType: 'gmail', fromDomain: null, messageDate: '2026-09-08T00:00:00Z' })

describe('case body reader', () => {
  it('shows the restored local original, including Fiori and contact information, without masking labels', async () => {
    const original = '・BTP or Fiori or Cdsview\n担当：山田太郎\n連絡先：contact@example.com'
    const load = vi.fn(async () => ({ ...source('・BTP or <PERSON_NAME_001> or Cdsview'), localDisplay: { subject: 'SAP FI', body: original } }))
    render(<JobCaseBody review={review} zh onLoad={load} />)
    expect(await screen.findByRole('listitem')).toHaveTextContent('BTP or Fiori or Cdsview')
    expect(screen.getByText(/担当：山田太郎/)).toHaveTextContent('contact@example.com')
    expect(screen.queryByText(/已遮蔽|已脱敏|PERSON_NAME/)).not.toBeInTheDocument()
  })

  it('preserves paragraphs and explicit lists without treating source markup as HTML', () => {
    const view = render(<FormattedCaseBody zh text={'挨拶\n改行\n\n──────\n■ 案件情報\n仕事内容\n・UiPath開発\n・Orchestrator必須\n\n単価：60〜65万\n<script>untouched</script>'} />)
    expect(screen.getByText('挨拶 改行').textContent).toBe('挨拶\n改行')
    expect(screen.getByRole('heading', { name: '■ 案件情報' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '仕事内容' })).toBeVisible()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('separator')).toBeVisible()
    expect(view.container.querySelector('script')).toBeNull()
    expect(view.container.textContent).toContain('<script>untouched</script>')
  })
  it('loads beyond the preview limit and does not reload when a callback identity changes', async () => {
    const full = source(`${'本文'.repeat(2500)}\n\n末尾の条件`)
    const load = vi.fn(async () => full)
    const view = render(<JobCaseBody review={review} zh onLoad={load} />)
    expect(await screen.findByText('末尾の条件')).toBeVisible()
    expect(screen.queryByText(review.redactedPreview)).not.toBeInTheDocument()
    const changed = vi.fn(async () => full)
    view.rerender(<JobCaseBody review={review} zh onLoad={changed} />)
    expect(load).toHaveBeenCalledTimes(1)
    expect(changed).not.toHaveBeenCalled()
  })
  it('rejects late replies from the previous case and supports retrying a failed body', async () => {
    let finish!: (value: JobCaseSourceText) => void
    const load = vi.fn<(_id: string) => Promise<JobCaseSourceText>>()
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce(source('Second complete case'))
    const view = render(<JobCaseBody review={review} zh onLoad={load} />)
    view.rerender(<JobCaseBody review={{ ...review, reviewId: 'case-two' }} zh onLoad={load} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('案件正文读取失败')
    finish(source('First late case'))
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('Second complete case')).toBeVisible()
    expect(screen.queryByText('First late case')).not.toBeInTheDocument()
    await waitFor(() => expect(load).toHaveBeenLastCalledWith('case-two'))
  })
})
