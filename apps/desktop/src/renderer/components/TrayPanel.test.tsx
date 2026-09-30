import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TrayDesktopApi, TrayReadySummary, TraySummary } from '@shared'
import { TrayPanel } from './TrayPanel'

const ready = (overrides: Partial<TrayReadySummary> = {}): TrayReadySummary => ({
  status: 'ready',
  locale: 'zh-CN',
  generatedAt: '2026-09-30T01:00:00.000Z',
  today: '2026-09-30',
  showPersonNames: false,
  followUpsDueToday: 3,
  cases: { newToday: 4, unseen: 7 },
  matching: { newOpportunities: 2, proposable: 5 },
  interviews: {
    coordinating: 1,
    today: 2,
    next: { at: '2026-09-30T05:00:00.000Z', roundNumber: 1, caseTitle: 'EC決済基盤の刷新', personName: null }
  },
  ai: { state: 'ok', availableCredits: 1234, reservedCredits: 0, fraction: 0.8 },
  alerts: [],
  week: { casesCreated: 9, recommended: 4, started: 1 },
  ...overrides
})

function setup(summary: Promise<TraySummary> | TraySummary) {
  let push: ((summary: TraySummary) => void) | null = null
  const api = {
    getTraySummary: vi.fn(() => Promise.resolve(summary)),
    onTraySummaryChanged: vi.fn((listener: (summary: TraySummary) => void) => {
      push = listener
      return () => undefined
    }),
    openMain: vi.fn(async () => undefined),
    askAgent: vi.fn(async () => undefined),
    resize: vi.fn(),
    hide: vi.fn()
  } satisfies TrayDesktopApi
  render(<TrayPanel api={api} />)
  return { api, push: (next: TraySummary) => act(() => push!(next)) }
}

describe('TrayPanel', () => {
  it('shows a loading state, then the summary, and sizes the window to its content', async () => {
    let resolve!: (summary: TraySummary) => void
    const { api } = setup(new Promise<TraySummary>((done) => (resolve = done)))
    expect(screen.getByRole('status')).toBeInTheDocument()
    await act(async () => resolve(ready()))
    expect(screen.getByRole('button', { name: '3 件今天要跟进' })).toBeInTheDocument()
    expect(screen.getByText('今天 9/30')).toBeInTheDocument()
    expect(screen.getByText('本周：新增 9 案件，推荐 4 人，进场 1 人')).toBeInTheDocument()
    expect(api.resize).toHaveBeenCalled()
  })

  it('opens each number where it came from', async () => {
    const { api } = setup(ready())
    fireEvent.click(await screen.findByRole('button', { name: '3 件今天要跟进' }))
    expect(api.openMain).toHaveBeenLastCalledWith('followups', { followUpFilter: 'today' })
    fireEvent.click(screen.getByRole('button', { name: /新案件/u }))
    expect(api.openMain).toHaveBeenLastCalledWith('cases', { caseView: 'unseen' })
    fireEvent.click(screen.getByRole('button', { name: /新匹配机会/u }))
    expect(api.openMain).toHaveBeenLastCalledWith('cases', { caseView: 'opportunities' })
    fireEvent.click(screen.getByRole('button', { name: /待约面/u }))
    expect(api.openMain).toHaveBeenLastCalledWith('followups', { followUpFilter: 'today' })
    fireEvent.click(screen.getByRole('button', { name: /AI 额度/u }))
    expect(api.openMain).toHaveBeenLastCalledWith('ai-member', undefined)
    fireEvent.click(screen.getByRole('button', { name: /一面 · EC決済基盤の刷新/u }))
    expect(api.openMain).toHaveBeenLastCalledWith('followups', { followUpFilter: 'today' })
    fireEvent.click(screen.getByRole('button', { name: '新增案件' }))
    expect(api.openMain).toHaveBeenLastCalledWith('cases:new', undefined)
    fireEvent.click(screen.getByRole('button', { name: '导入简历' }))
    expect(api.openMain).toHaveBeenLastCalledWith('people:import', undefined)
    fireEvent.click(screen.getByRole('button', { name: '打开 SES Agent' }))
    expect(api.openMain).toHaveBeenLastCalledWith('cases', undefined)
  })

  it('shows the card counts and the AI balance', async () => {
    setup(ready())
    const cases = await screen.findByRole('button', { name: /新案件/u })
    expect(within(cases).getByText('4')).toBeInTheDocument()
    expect(within(cases).getByText('未读 7')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /新匹配机会/u })).getByText('可以提案 5')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /待约面/u })).getByText('今天面试 2')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /AI 额度/u })).getByText('剩余 1,234')).toBeInTheDocument()
  })

  it('names the person only when the setting allows it', async () => {
    const { push } = setup(ready())
    const upcoming = await screen.findByRole('button', { name: /14:00/u })
    expect(within(upcoming).getByText('1 名人员')).toBeInTheDocument()
    push(
      ready({
        showPersonNames: true,
        interviews: {
          coordinating: 1,
          today: 2,
          next: { at: '2026-09-30T05:00:00.000Z', roundNumber: 2, caseTitle: 'EC', personName: '王小明' }
        }
      })
    )
    expect(screen.getByRole('button', { name: /二面 · EC/u })).toHaveTextContent('王小明')
  })

  it('lists only the alerts that apply, in red, and opens the place to fix each', async () => {
    const { api } = setup(
      ready({
        alerts: ['ai-credits-low', 'gmail-sync-failed', 'privacy-gate-blocked'],
        ai: { state: 'low', availableCredits: 40, reservedCredits: 0, fraction: 0.04 }
      })
    )
    const alerts = await screen.findByRole('list', { name: '需要处理的提醒' })
    expect(
      within(alerts)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['AI 额度不足', 'Gmail 同步失败', '云端 AI 被隐私门拦截'])
    fireEvent.click(within(alerts).getByRole('button', { name: 'Gmail 同步失败' }))
    expect(api.openMain).toHaveBeenLastCalledWith('settings:integrations', undefined)
    fireEvent.click(within(alerts).getByRole('button', { name: 'AI 额度不足' }))
    expect(api.openMain).toHaveBeenLastCalledWith('ai-member', undefined)
  })

  it('explains a gateway refusal with a way to change the model or top up, and does not read the balance as fine', async () => {
    const { api } = setup(
      ready({
        alerts: ['ai-request-rejected'],
        aiRejectedModel: 'GPT-6 Sol',
        ai: { state: 'ok', availableCredits: 23229, reservedCredits: 9322, fraction: 1 }
      })
    )
    const alerts = await screen.findByRole('list', { name: '需要处理的提醒' })
    expect(alerts).toHaveTextContent(
      '最近一次 AI 调用因额度不足被拒绝（GPT-6 Sol）。可用额度不够该模型单次预留，可在设置中换用更省的模型，或到 AI 会员中心充值。'
    )
    fireEvent.click(within(alerts).getByRole('button', { name: '换模型' }))
    expect(api.openMain).toHaveBeenLastCalledWith('settings:models', undefined)
    fireEvent.click(within(alerts).getByRole('button', { name: '充值' }))
    expect(api.openMain).toHaveBeenLastCalledWith('ai-member', undefined)

    const card = screen.getByRole('button', { name: /AI 额度/u })
    const status = within(card).getByText('额度不足以调用当前模型')
    expect(status).toHaveClass('is-rejected')
    expect(within(card).queryByText('剩余 23,229')).not.toBeInTheDocument()
    expect(within(card).getByText('可用 23,229')).toBeInTheDocument()
    expect(within(card).getByText('预留 9,322')).toBeInTheDocument()
  })

  it('shows reserved credits beside the balance only when some are reserved', async () => {
    const { push } = setup(ready({ ai: { state: 'ok', availableCredits: 1234, reservedCredits: 50, fraction: 0.8 } }))
    const card = await screen.findByRole('button', { name: /AI 额度/u })
    expect(within(card).getByText('剩余 1,234')).toHaveClass('is-ok')
    expect(within(card).getByText('预留 50')).toBeInTheDocument()
    push(ready())
    expect(within(screen.getByRole('button', { name: /AI 额度/u })).queryByText(/预留/u)).not.toBeInTheDocument()
  })

  it('has calm zero states and 未知 when the AI balance is not known', async () => {
    setup(
      ready({
        followUpsDueToday: 0,
        cases: { newToday: 0, unseen: 0 },
        matching: { newOpportunities: 0, proposable: 0 },
        interviews: { coordinating: 0, today: 0, next: null },
        ai: { state: 'unknown', availableCredits: null, reservedCredits: null, fraction: null },
        week: { casesCreated: 0, recommended: 0, started: 0 }
      })
    )
    expect(await screen.findByRole('button', { name: '今天没有要跟进的事项' })).toBeInTheDocument()
    expect(screen.getByText('今天没有面试安排')).toBeInTheDocument()
    expect(screen.getByText('未知')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '需要处理的提醒' })).not.toBeInTheDocument()
  })

  it('prefills 问 Agent on Enter without sending anything itself', async () => {
    const { api } = setup(ready())
    const input = await screen.findByRole('textbox', { name: '问 Agent' })
    fireEvent.submit(input)
    expect(api.askAgent).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '  今天有哪些新案件？ ' } })
    fireEvent.submit(input)
    expect(api.askAgent).toHaveBeenCalledWith('今天有哪些新案件？')
  })

  it('shows 应用未就绪 when local data cannot be read, with only 打开 SES Agent', async () => {
    const { api } = setup({ status: 'not-ready', locale: 'zh-CN', generatedAt: '2026-09-30T01:00:00.000Z' })
    expect(await screen.findByText('应用未就绪')).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['打开 SES Agent'])
    fireEvent.click(screen.getByRole('button', { name: '打开 SES Agent' }))
    expect(api.openMain).toHaveBeenCalledWith('cases', undefined)
  })

  it('also shows 应用未就绪 when the summary request fails, and hides on Esc', async () => {
    const { api } = setup(Promise.reject(new Error('blocked')))
    expect(await screen.findByText(/应用未就绪|アプリの準備ができていません/u)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(api.hide).toHaveBeenCalled()
  })

  it('follows the saved language', async () => {
    setup(ready({ locale: 'ja-JP' }))
    expect(await screen.findByRole('button', { name: '今日の対応 3 件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SES Agent を開く' })).toBeInTheDocument()
  })
})
