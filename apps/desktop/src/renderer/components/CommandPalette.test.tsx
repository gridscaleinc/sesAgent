import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommandPalette, type BusinessCommand } from './CommandPalette'

function commands(overrides: Partial<BusinessCommand>[] = []): BusinessCommand[] {
  const base: BusinessCommand[] = [
    {
      id: 'resume', group: '入力', label: 'スキルシートを取り込む', description: 'ローカル解析',
      keywords: ['resume', '候補者'], icon: 'upload', run: vi.fn()
    },
    {
      id: 'gmail', group: '入力', label: 'Gmailを同期して案件を確認', description: '読取専用同期',
      keywords: ['google workspace', 'メール'], icon: 'mail', run: vi.fn()
    },
    {
      id: 'governance', group: '統制', label: 'データと承認を開く', description: '脱敏とバックアップ',
      keywords: ['privacy'], icon: 'shield', run: vi.fn()
    }
  ]
  return base.map((command, index) => ({ ...command, ...overrides[index] }))
}

describe('CommandPalette', () => {
  it('filters locally and executes the selected command without restoring the opener', async () => {
    const items = commands()
    const onClose = vi.fn()
    render(<CommandPalette commands={items} onClose={onClose} />)

    const search = screen.getByRole('textbox', { name: '業務コマンドを検索' })
    await waitFor(() => expect(search).toHaveFocus())
    fireEvent.change(search, { target: { value: 'Google Workspace' } })
    expect(screen.getByRole('option', { name: /Gmailを同期して案件を確認/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /スキルシートを取り込む/ })).not.toBeInTheDocument()
    fireEvent.keyDown(search, { key: 'Enter' })

    await waitFor(() => expect(items[1]?.run).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalledWith(false)
  })

  it('supports arrow selection, escape, empty results and fail-visible execution', async () => {
    const failure = vi.fn().mockRejectedValue(new Error('Gmail接続を確認してください。'))
    const onClose = vi.fn()
    const items = commands([{}, { run: failure }])
    render(<CommandPalette commands={items} onClose={onClose} />)
    const search = screen.getByRole('textbox', { name: '業務コマンドを検索' })

    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Gmail接続を確認してください。')
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.change(search, { target: { value: '存在しない操作' } })
    expect(screen.getByText('一致する業務コマンドがありません')).toBeInTheDocument()
    expect(screen.getByText('入力内容は保存・送信されません。')).toBeInTheDocument()
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledWith(true)
  })
})
