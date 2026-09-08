import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { builtInBroadcastTemplate, type BroadcastWorkspace } from '@shared'
import { UiLocaleProvider } from '../i18n'
import { BroadcastWorkspaceView, type BroadcastPanelActions } from './BroadcastWorkspaceView'

const newReviewId = '11111111-1111-4111-8111-111111111111'
const copiedReviewId = '22222222-2222-4222-8222-222222222222'

const workspace: BroadcastWorkspace = {
  queue: [
    {
      reviewId: newReviewId, jobCaseId: 'case-1', jobCaseVersion: 1, title: 'Java 案件',
      sourceType: 'gmail', status: 'new', lastCopy: null, hasUpdateSinceLastCopy: false
    },
    {
      reviewId: copiedReviewId, jobCaseId: 'case-2', jobCaseVersion: 2, title: 'RPA 案件',
      sourceType: 'chat-paste', status: 'copied',
      lastCopy: { at: '2026-08-25T02:00:00.000Z', lang: 'zh', jobCaseVersion: 1 },
      hasUpdateSinceLastCopy: true
    }
  ],
  templates: [builtInBroadcastTemplate()]
}

function actionsWith(overrides: Partial<BroadcastPanelActions> = {}): BroadcastPanelActions {
  return {
    loadWorkspace: vi.fn().mockResolvedValue(workspace),
    draftBroadcast: vi.fn().mockResolvedValue({
      textJa: '【案件】Java 案件', textZh: '【案件】Java 案件（中文）', forbiddenJa: [], forbiddenZh: []
    }),
    draftUpdateNotice: vi.fn().mockResolvedValue({ status: 'no-changes' }),
    recordCopy: vi.fn().mockResolvedValue({ copy: { id: 'copy-1' } }),
    openEmail: vi.fn().mockResolvedValue({ opened: true }),
    listBroadcasts: vi.fn().mockResolvedValue([]),
    ...overrides
  }
}

function renderView(actions: BroadcastPanelActions, initialReviewId?: string) {
  render(<UiLocaleProvider locale="zh-CN">
    <BroadcastWorkspaceView actions={actions} initialReviewId={initialReviewId} />
  </UiLocaleProvider>)
}

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

afterEach(() => {
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
})

describe('BroadcastWorkspaceView', () => {
  it('folds the queue when opened from one case and expands it on demand', async () => {
    renderView(actionsWith(), newReviewId)
    const expand = await screen.findByRole('button', { name: /全部案件/u })
    expect(screen.queryByText('RPA 案件')).toBeNull()
    fireEvent.click(expand)
    expect(await screen.findByText('RPA 案件')).toBeInTheDocument()
  })

  it('reports a queue pick to the host so the conversation can follow the focus', async () => {
    const onSelectedReviewChange = vi.fn()
    render(<UiLocaleProvider locale="zh-CN">
      <BroadcastWorkspaceView actions={actionsWith()} initialReviewId={newReviewId} onSelectedReviewChange={onSelectedReviewChange} />
    </UiLocaleProvider>)
    fireEvent.click(await screen.findByRole('button', { name: /全部案件/u }))
    fireEvent.click(await screen.findByText('RPA 案件'))
    expect(onSelectedReviewChange).toHaveBeenCalledWith(copiedReviewId)
  })

  it('counts the queue by copy status and explains both manual delivery hand-offs', async () => {
    renderView(actionsWith())
    expect(await screen.findByText('Java 案件')).toBeInTheDocument()
    const counts = screen.getByText('Java 案件').closest('.broadcast-view')!.querySelector('.agent-business-metrics')!
    expect(counts.textContent).toBe('1新增（未复制）1已复制0待补充')
    expect(screen.getByText('有更新')).toBeInTheDocument()
    expect(screen.getByText(/复制可用于微信/u)).toBeInTheDocument()
    expect(screen.getByText(/收件人与最终发送由您在默认邮件客户端中确认/u)).toBeInTheDocument()
    // Nothing on the screen may offer to mark a case as sent.
    expect(screen.queryByRole('button', { name: '已发' })).toBeNull()
  })

  it('blocks the copy and names the identifier types the draft still carries', async () => {
    renderView(actionsWith({
      draftBroadcast: vi.fn().mockResolvedValue({
        textJa: '【案件】<PERSON_NAME_001>', textZh: '【案件】<PERSON_NAME_001>',
        forbiddenJa: ['person_name'], forbiddenZh: ['person_name']
      })
    }), newReviewId)
    expect(await screen.findByRole('alert')).toHaveTextContent('person_name')
    expect(screen.getByRole('button', { name: '复制' })).toBeDisabled()
  })

  it('copies the visible text and records the copy against the case, with no destination', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const actions = actionsWith()
    renderView(actions, newReviewId)

    const copy = await screen.findByRole('button', { name: '复制' })
    await waitFor(() => expect(copy).toBeEnabled())
    fireEvent.click(copy)

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('【案件】Java 案件'))
    expect(actions.recordCopy).toHaveBeenCalledWith({
      reviewId: newReviewId, lang: 'ja', kind: 'new',
      templateId: builtInBroadcastTemplate().id, text: '【案件】Java 案件'
    })
    expect(await screen.findByRole('status')).toHaveTextContent('已复制，可以去微信粘贴了。')
  })

  it('copies and records the language version the operator is looking at', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const actions = actionsWith()
    renderView(actions, newReviewId)

    fireEvent.click(await screen.findByRole('button', { name: '中文版' }))
    const copy = screen.getByRole('button', { name: '复制' })
    await waitFor(() => expect(copy).toBeEnabled())
    fireEvent.click(copy)

    await waitFor(() => expect(actions.recordCopy).toHaveBeenCalledWith(
      expect.objectContaining({ lang: 'zh', text: '【案件】Java 案件（中文）' })))
  })

  it('opens the visible case text in the default mail client without claiming it was sent', async () => {
    const actions = actionsWith()
    renderView(actions, newReviewId)
    const openEmail = await screen.findByRole('button', { name: '打开邮件' })
    await waitFor(() => expect(openEmail).toBeEnabled())

    fireEvent.click(openEmail)

    await waitFor(() => expect(actions.openEmail).toHaveBeenCalledWith({
      reviewId: newReviewId, lang: 'ja', kind: 'new',
      templateId: builtInBroadcastTemplate().id, text: '【案件】Java 案件'
    }))
    expect(actions.recordCopy).not.toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent('请确认收件人和正文后手动发送')
    expect(screen.getByRole('status')).toHaveTextContent('不会标记为已发送')
  })

  it('offers the update notice only for a case revised since its last copy', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
    const actions = actionsWith({
      draftUpdateNotice: vi.fn().mockResolvedValue({
        status: 'ready', textJa: '【更新】RPA 案件\n・単価：60万円 → 65万円',
        textZh: '【更新】RPA 案件\n・单价：60万日元 → 65万日元',
        changes: [{ label: '単価', before: '60万円', after: '65万円' }]
      })
    })
    renderView(actions, newReviewId)
    await screen.findByRole('button', { name: '复制' })
    expect(screen.queryByRole('button', { name: '更新通知' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /全部案件/u }))
    fireEvent.click(screen.getByText('RPA 案件'))
    fireEvent.click(await screen.findByRole('button', { name: '更新通知' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '案件文案' })).toHaveValue('【更新】RPA 案件\n・単価：60万円 → 65万円'))

    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    await waitFor(() => expect(actions.recordCopy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'update' })))
  })

  it('loads the copy history only when it is opened, and labels a pre-v43 row plainly', async () => {
    const actions = actionsWith({
      listBroadcasts: vi.fn().mockResolvedValue([
        {
          id: 'copy-1', source: 'copy', jobCaseVersion: 2, templateId: builtInBroadcastTemplate().id,
          templateRevision: 1, lang: 'zh', kind: 'update', createdAt: '2026-08-26T02:00:00.000Z'
        },
        {
          id: 'legacy-1', source: 'legacy', jobCaseVersion: 1, templateId: builtInBroadcastTemplate().id,
          templateRevision: 1, lang: 'ja', kind: 'new', createdAt: '2026-08-25T02:00:00.000Z'
        }
      ])
    })
    renderView(actions, newReviewId)
    const toggle = await screen.findByRole('button', { name: /复制历史/u })
    expect(actions.listBroadcasts).not.toHaveBeenCalled()
    fireEvent.click(toggle)
    await waitFor(() => expect(actions.listBroadcasts).toHaveBeenCalledWith(newReviewId))
    // waitFor only retries when the callback throws, so a missing row must throw.
    const rows = await waitFor(() => {
      const found = document.querySelectorAll('.broadcast-history li')
      if (found.length < 2) throw new Error('history rows not rendered yet')
      return found
    })
    expect(rows[0]).toHaveTextContent('中文版 · 標準 · 更新通知 · 第 2 版')
    expect(rows[1]).toHaveTextContent('旧版记录')
  })
})
