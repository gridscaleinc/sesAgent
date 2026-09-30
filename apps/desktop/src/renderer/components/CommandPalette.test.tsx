import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommandPalette, type BusinessCommand } from './CommandPalette'
import { UiLocaleProvider } from '../i18n'

function commands(overrides: Partial<BusinessCommand>[] = []): BusinessCommand[] {
  const base: BusinessCommand[] = [
    {
      id: 'resume',
      group: '入力',
      label: { zh: '导入技能表', ja: 'スキルシートを取り込む' },
      description: { zh: '本地解析', ja: 'ローカル解析' },
      keywords: ['resume', '候補者'],
      icon: 'upload',
      run: vi.fn()
    },
    {
      id: 'gmail',
      group: '入力',
      label: { zh: '同步 Gmail 并确认案件', ja: 'Gmailを同期して案件を確認' },
      description: { zh: '只读同步', ja: '読取専用同期' },
      keywords: ['google workspace', 'メール'],
      icon: 'mail',
      run: vi.fn()
    },
    {
      id: 'governance',
      group: '統制',
      label: { zh: '打开数据与审批', ja: 'データと承認を開く' },
      description: { zh: '脱敏与备份', ja: '脱敏とバックアップ' },
      keywords: ['privacy'],
      icon: 'shield',
      run: vi.fn()
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

  it('shows bilingual command text and Chinese key hints, and matches either language', async () => {
    const items = commands([
      { label: { zh: '导入技能表', ja: 'スキルシートを取り込む' }, description: { zh: '本机解析', ja: 'ローカル解析' } }
    ])
    render(
      <UiLocaleProvider locale="zh-CN">
        <CommandPalette commands={items} onClose={vi.fn()} />
      </UiLocaleProvider>
    )
    expect(screen.getByRole('option', { name: /导入技能表/u })).toBeInTheDocument()
    expect(screen.getByText('选择')).toBeInTheDocument()
    expect(screen.getByText('执行')).toBeInTheDocument()
    const search = screen.getByRole('textbox', { name: '搜索业务命令' })
    fireEvent.change(search, { target: { value: '技能表' } })
    expect(screen.getByRole('option', { name: /导入技能表/u })).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'スキルシート' } })
    expect(screen.getByRole('option', { name: /导入技能表/u })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Gmail/u })).not.toBeInTheDocument()
  })

  it('lists object entries only for a typed query, matches them by name alone and keeps keyboard order grouped', async () => {
    const find: BusinessCommand = {
      id: 'find',
      group: '業務',
      label: { zh: '找人', ja: '要員を探す' },
      description: { zh: '为案件找人', ja: '案件の要員を探します。' },
      keywords: [],
      icon: 'users',
      run: vi.fn()
    }
    const object: BusinessCommand = {
      id: 'case',
      group: '対象',
      label: { zh: 'Java project', ja: 'Java project' },
      description: { zh: '在案件列表中打开', ja: '案件一覧で開く' },
      keywords: ['Java project'],
      icon: 'briefcase',
      searchOnly: true,
      run: vi.fn()
    }
    render(<CommandPalette commands={[...commands(), object, find]} onClose={vi.fn()} />)
    expect(screen.queryByRole('option', { name: /Java project/ })).not.toBeInTheDocument()
    // 業務 is listed first even though it came last, and Enter runs the first shown command.
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('要員を探す')
    const search = screen.getByRole('textbox', { name: '業務コマンドを検索' })
    fireEvent.change(search, { target: { value: '案件一覧' } })
    expect(screen.queryByRole('option', { name: /Java project/ })).not.toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'java' } })
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([expect.stringContaining('Java project')])
    fireEvent.keyDown(search, { key: 'Enter' })
    await waitFor(() => expect(object.run).toHaveBeenCalledTimes(1))
  })
})
