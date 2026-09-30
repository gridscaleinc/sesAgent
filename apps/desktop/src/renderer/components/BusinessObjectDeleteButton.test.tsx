import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { BusinessObjectDeleteButton } from './BusinessObjectDeleteButton'

const preview = {
  confirmationHash: 'snapshot-1',
  counts: { caseVersions: 2, profileVersions: 2, taskRecords: 1, businessFollowUps: 3, agentReferences: { messages: 4 } }
}
beforeEach(() => {
  Object.defineProperty(window, 'sesAgent', {
    configurable: true,
    value: {
      previewJobCaseDeletion: vi.fn(async () => preview),
      previewCandidateDeletion: vi.fn(async () => preview),
      deleteJobCaseData: vi.fn(async () => ({ report: { components: { database: 'deleted' } } })),
      deleteCandidateData: vi.fn(async () => ({ report: { components: { database: 'deleted' } } }))
    }
  })
})
it.each(['case', 'person'] as const)('previews and confirms exactly the selected %s, then refreshes', async (kind) => {
  const onDeleted = vi.fn(),
    onOpen = vi.fn()
  render(
    <article onClick={onOpen}>
      <BusinessObjectDeleteButton kind={kind} id="selected-id" title="選択した資料" onDeleted={onDeleted} />
    </article>
  )
  fireEvent.click(screen.getByRole('button', { name: '削除 選択した資料' }))
  const confirm = await screen.findByRole('button', { name: '削除を確定' })
  await waitFor(() => expect(confirm).toBeEnabled())
  expect(onOpen).not.toHaveBeenCalled()
  expect(screen.getByText('対応記録：3')).toBeVisible()
  expect(window.sesAgent.deleteJobCaseData).not.toHaveBeenCalled()
  expect(window.sesAgent.deleteCandidateData).not.toHaveBeenCalled()
  fireEvent.click(confirm)
  fireEvent.click(confirm)
  await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
  const remove = kind === 'case' ? window.sesAgent.deleteJobCaseData : window.sesAgent.deleteCandidateData
  expect(remove).toHaveBeenCalledTimes(1)
  expect(remove).toHaveBeenCalledWith({
    [kind === 'case' ? 'reviewId' : 'sourceDocumentId']: 'selected-id',
    confirmationHash: 'snapshot-1',
    confirmationText: '削除'
  })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(onOpen).not.toHaveBeenCalled()
})
it('cancels without deleting and returns keyboard focus to the trigger', async () => {
  render(<BusinessObjectDeleteButton kind="person" id="p" title="Test" onDeleted={vi.fn()} />)
  const trigger = screen.getByRole('button', { name: '削除 Test' })
  fireEvent.click(trigger)
  await waitFor(() => expect(screen.getByRole('button', { name: '削除を確定' })).toBeEnabled())
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  expect(window.sesAgent.deleteCandidateData).not.toHaveBeenCalled()
})
it('does not delete without an impact preview and prevents a stale snapshot retry', async () => {
  vi.mocked(window.sesAgent.deleteJobCaseData).mockRejectedValueOnce(new Error('資料が更新されました'))
  const onDeleted = vi.fn()
  render(<BusinessObjectDeleteButton kind="case" id="c" title="Case" onDeleted={onDeleted} />)
  fireEvent.click(screen.getByRole('button', { name: '削除 Case' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '削除を確定' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '削除を確定' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('資料が更新されました')
  expect(screen.getByRole('button', { name: '削除を確定' })).toBeDisabled()
  expect(onDeleted).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  vi.mocked(window.sesAgent.previewJobCaseDeletion).mockRejectedValueOnce(new Error('プレビュー失敗'))
  fireEvent.click(screen.getByRole('button', { name: '削除 Case' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('プレビュー失敗')
  expect(screen.getByRole('button', { name: '削除を確定' })).toBeDisabled()
  expect(window.sesAgent.deleteJobCaseData).toHaveBeenCalledTimes(1)
})
