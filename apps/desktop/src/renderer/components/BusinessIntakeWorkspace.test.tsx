import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ExecuteAgentTurnResult } from '@shared'
import { BusinessIntakeWorkspace } from './BusinessIntakeWorkspace'

const success = { status: 'completed', conversation: { revision: 1 }, assistantMessage: { content: 'done' }, intake: { records: [{ kind: 'job-case', status: 'succeeded', outcome: 'created', reviewId: 'case-1', sourceDocumentId: null }] } }
const props = () => ({ modelKey: 'test-model', cases: [], candidates: [], onRefresh: vi.fn(async () => {}), onCase: vi.fn(), onPerson: vi.fn(), onCaseImport: vi.fn() })
const prepare = (text: string) => {
  fireEvent.change(screen.getByLabelText('メール・会話テキスト'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: '区切りを確認' }))
}

describe('business intake queue', () => {
  it('only retries a failed segment and always uses the protected intake lane', async () => {
    const execute = vi.fn().mockResolvedValueOnce(success).mockRejectedValueOnce(new Error('retry me')).mockResolvedValue(success)
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: { executeAgentTurn: execute, listAiConversations: vi.fn(async () => []) } })
    render(<BusinessIntakeWorkspace {...props()} />)
    prepare('案件名：Java\n必須：Java\n----\n案件名：AWS\n必須：AWS')
    fireEvent.click(screen.getByRole('button', { name: '未完了の情報を整理' }))
    await screen.findByText('retry me')
    await waitFor(() => expect(screen.getByRole('button', { name: 'この区画を再試行' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'この区画を再試行' }))
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(3))
    expect(execute.mock.calls.map(([call]) => call.message)).toEqual(['案件名：Java\n必須：Java', '案件名：AWS\n必須：AWS', '案件名：AWS\n必須：AWS'])
    expect(execute.mock.calls.every(([call]) => call.intakeOnly)).toBe(true)
  })
  it('preserves oversize records and does not submit truncated text', async () => {
    const execute = vi.fn()
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: { executeAgentTurn: execute } })
    render(<BusinessIntakeWorkspace {...props()} />)
    const text = `案件名：長文\n${'文'.repeat(5000)}`
    prepare(text)
    fireEvent.click(screen.getByRole('button', { name: '未完了の情報を整理' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('区画の内容 1')).toHaveValue(text)
    expect(execute).not.toHaveBeenCalled()
  })
  it('splits failed cloud records into individual retry items without repeating successful records', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ ...success, intake: { records: [
      { ...success.intake.records[0], startLine: 1, endLine: 1 },
      { kind: 'candidate', status: 'failed', outcome: null, reviewId: null, sourceDocumentId: null, startLine: 2, endLine: 2 }
    ] } } as unknown as ExecuteAgentTurnResult).mockResolvedValue(success)
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: { executeAgentTurn: execute } })
    render(<BusinessIntakeWorkspace {...props()} />)
    prepare('Java募集\nJava人材')
    fireEvent.click(screen.getByRole('button', { name: '未完了の情報を整理' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'この区画を再試行' })).toBeEnabled())
    expect(screen.getByLabelText('区画の内容 2')).toHaveValue('Java人材')
    fireEvent.click(screen.getByRole('button', { name: 'この区画を再試行' }))
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    expect(execute.mock.calls[1]![0].message).toBe('Java人材')
  })
})
