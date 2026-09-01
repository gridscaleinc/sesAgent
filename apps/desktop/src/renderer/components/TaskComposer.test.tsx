import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TaskComposer } from './TaskComposer'

const jobCases = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', version: 1, title: 'Java 案件', requiredSkills: 'Java', role: null },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', version: 2, title: 'COBOL 案件', requiredSkills: 'COBOL', role: 'SE' }
]

function renderComposer(initialJobCaseId: string, onPreview = vi.fn().mockRejectedValue(new Error('preview stopped'))) {
  const props = {
    focusRequestId: null,
    gmailConnected: false,
    gmailSetupRequired: false,
    gmailSyncStatus: 'never' as const,
    onCreate: vi.fn(),
    onCreated: vi.fn(),
    onImportGmail: vi.fn().mockResolvedValue(undefined),
    onFocusRequestHandled: vi.fn(),
    onOpenGoogleWorkspace: vi.fn(),
    jobCases,
    mode: 'matching' as const
  }
  const view = render(<TaskComposer {...props} initialJobCaseId={initialJobCaseId} onPreview={onPreview} />)
  return {
    onPreview,
    rerender: (nextJobCaseId: string) => view.rerender(<TaskComposer {...props} initialJobCaseId={nextJobCaseId} onPreview={onPreview} />)
  }
}

describe('TaskComposer in matching mode', () => {
  it('follows the case the operator opened matching for after it was already mounted', async () => {
    const { onPreview, rerender } = renderComposer(jobCases[0]!.id)
    const picker = screen.getByLabelText('マッチング対象案件') as HTMLSelectElement
    expect(picker.value).toBe(jobCases[0]!.id)

    // Opening matching for the second case changes the prop, not the mount.
    rerender(jobCases[1]!.id)
    expect(picker.value).toBe(jobCases[1]!.id)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('案件「COBOL 案件」に合う候補者を根拠付きで比較したい')

    fireEvent.click(screen.getByRole('button', { name: /プレビュー/u }))
    await waitFor(() => expect(onPreview).toHaveBeenCalledTimes(1))
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ jobCaseId: jobCases[1]!.id, scopeId: 'selected-case' }))
  })

  it('keeps text the operator typed when the case changes, but still targets the new case', async () => {
    const { onPreview, rerender } = renderComposer(jobCases[0]!.id)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'AWS Aurora の運用経験がある人だけ、常駐可能な順に並べて' } })
    rerender(jobCases[1]!.id)
    expect((screen.getByLabelText('マッチング対象案件') as HTMLSelectElement).value).toBe(jobCases[1]!.id)
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('AWS Aurora の運用経験がある人だけ、常駐可能な順に並べて')

    fireEvent.click(screen.getByRole('button', { name: /プレビュー/u }))
    await waitFor(() => expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ jobCaseId: jobCases[1]!.id })))
  })
})
