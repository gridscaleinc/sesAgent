import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ResumeImportProgressDrawer, type ResumeImportProgress } from './ResumeImportProgressDrawer'

const file = (token: string, status: 'success' | 'error' = 'success') => ({ token, name: `${token}.xlsx`, status, error: null })
const callbacks = () => ({
  onClose: vi.fn(),
  onOpenCandidates: vi.fn(),
  onOpenFailures: vi.fn(),
  onOpenReviewCenter: vi.fn(),
  onFindCases: vi.fn(),
  onOpenPerson: vi.fn()
})

it('offers finding cases and opening that exact person after a single import', () => {
  const props = callbacks()
  const progress: ResumeImportProgress = { phase: 'completed', taskId: 't', files: [file('a')], error: null }
  render(<ResumeImportProgressDrawer {...props} progress={progress} />)
  fireEvent.click(screen.getByRole('button', { name: 'この要員の案件を探す' }))
  expect(props.onFindCases).toHaveBeenCalledWith('a')
  fireEvent.click(screen.getByRole('button', { name: '要員を見る' }))
  expect(props.onOpenPerson).toHaveBeenCalledWith('a')
  expect(props.onOpenCandidates).not.toHaveBeenCalled()
})

it('puts the actions on each imported row when several resumes were imported', () => {
  const props = callbacks()
  const progress: ResumeImportProgress = {
    phase: 'partial-failed',
    taskId: 't',
    files: [file('a'), file('b'), file('c', 'error')],
    error: null
  }
  render(<ResumeImportProgressDrawer {...props} progress={progress} />)
  const find = screen.getAllByRole('button', { name: 'この要員の案件を探す' })
  expect(find).toHaveLength(2)
  fireEvent.click(find[1]!)
  expect(props.onFindCases).toHaveBeenCalledWith('b')
  fireEvent.click(screen.getByRole('button', { name: '要員一覧を見る' }))
  expect(props.onOpenCandidates).toHaveBeenCalled()
})

it('keeps the generic person list entry when no per-person wiring is given', () => {
  const props = { ...callbacks(), onFindCases: undefined, onOpenPerson: undefined }
  const progress: ResumeImportProgress = { phase: 'completed', taskId: 't', files: [file('a')], error: null }
  render(<ResumeImportProgressDrawer {...props} progress={progress} />)
  expect(screen.queryByRole('button', { name: 'この要員の案件を探す' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '要員を見る' }))
  expect(props.onOpenCandidates).toHaveBeenCalled()
})
