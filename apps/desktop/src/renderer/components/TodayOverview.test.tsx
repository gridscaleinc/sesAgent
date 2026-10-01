import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TodayReadySummary, TodaySummary } from '@shared'
import { UiLocaleProvider } from '../i18n'
import { TodayOverview, todayHeading, todayHeadline, type TodayOverviewProps } from './TodayOverview'

const empty: TodayReadySummary = {
  status: 'ready',
  locale: 'zh-CN',
  generatedAt: '2026-09-30T01:00:00.000Z',
  today: '2026-09-30',
  showPersonNames: true,
  followUpsDueToday: 0,
  cases: { newToday: 0, unseen: 0 },
  matching: { newOpportunities: 0, proposable: 0 },
  interviews: { coordinating: 0, today: 0, next: null },
  ai: { state: 'ok', availableCredits: 800, reservedCredits: 0, fraction: 0.8 },
  alerts: [],
  week: { casesCreated: 0, recommended: 0, started: 0 },
  lists: { followUps: [], interviews: [], opportunities: { proposable: [], needsInfo: [] }, unseenCases: [] }
}

const full: TodayReadySummary = {
  ...empty,
  followUpsDueToday: 21,
  cases: { newToday: 3, unseen: 6 },
  matching: { newOpportunities: 2, proposable: 1 },
  interviews: { coordinating: 2, today: 1, next: null },
  alerts: ['ai-credits-low', 'ai-request-rejected'],
  aiRejectedModel: 'Model X',
  week: { casesCreated: 5, recommended: 2, started: 1 },
  lists: {
    followUps: [
      {
        id: 'f1',
        documentId: 'p1',
        reviewId: 'c1',
        personName: '山田',
        caseTitle: '决济系统',
        stage: 'scheduled',
        stageLabel: '1 面已预约',
        action: '查看面试安排',
        when: '2026-09-30T05:00:00.000Z'
      }
    ],
    interviews: [
      {
        kind: 'client',
        followUpId: 'f1',
        documentId: 'p1',
        reviewId: 'c1',
        at: '2026-09-30T05:00:00.000Z',
        durationMinutes: 60,
        roundNumber: 2,
        caseTitle: '决济系统',
        personName: '山田'
      }
    ],
    opportunities: {
      proposable: [
        { id: 'o1', documentId: 'p2', reviewId: 'c2', jobCaseId: 'j2', personName: '佐藤', caseTitle: 'Java 开发', score: 91, confirm: [] }
      ],
      needsInfo: [
        {
          id: 'o2',
          documentId: 'p3',
          reviewId: 'c3',
          jobCaseId: 'j3',
          personName: '铃木',
          caseTitle: 'Go 开发',
          score: 70,
          confirm: ['日语商务']
        }
      ]
    },
    unseenCases: [{ reviewId: 'c4', title: 'AWS 迁移', sourceAt: '2026-09-29T01:00:00.000Z' }]
  }
}

function renderPage(summary: TodaySummary | null, overrides: Partial<TodayOverviewProps> = {}, failed = false) {
  const props: TodayOverviewProps = {
    state: { summary, failed, reload: vi.fn() },
    onOpenFollowUp: vi.fn(),
    onOpenFollowUps: vi.fn(),
    onOpenOpportunity: vi.fn(),
    onOpenOpportunities: vi.fn(),
    onOpenCase: vi.fn(),
    onOpenUnseenCases: vi.fn(),
    onNavigate: vi.fn(),
    onAsk: vi.fn(),
    ...overrides
  }
  render(
    <UiLocaleProvider locale="zh-CN">
      <TodayOverview {...props} />
    </UiLocaleProvider>
  )
  return props
}

const block = (name: string) => screen.getByRole('region', { name })

describe('TodayOverview', () => {
  it('writes the day and the headline in both languages', () => {
    const zh = (cn: string) => cn
    const ja = (_cn: string, jp: string) => jp
    expect(todayHeading('2026-09-30', zh)).toBe('今天 9/30（周三）')
    expect(todayHeading('2026-10-04', ja)).toBe('今日 10/4（日）')
    expect(todayHeadline({ ...empty, followUpsDueToday: 3, interviews: { ...empty.interviews, today: 1 } }, zh)).toBe(
      '3 件跟进要处理，1 场面试'
    )
    expect(todayHeadline(empty, zh)).toBe('今天没有要跟进的事项，也没有面试')
  })

  it('shows an empty state in every block', () => {
    renderPage(empty)
    expect(screen.getByRole('heading', { name: '今天 9/30（周三）' })).toBeInTheDocument()
    expect(within(block('今天要跟进')).getByText('今天没有要跟进的事项。')).toBeInTheDocument()
    expect(within(block('今天的面试')).getByText('今天没有面试安排。')).toBeInTheDocument()
    expect(within(block('值得先看的匹配机会')).getByText('暂时没有新的匹配机会。')).toBeInTheDocument()
    expect(within(block('新案件')).getByText('没有未读的新案件。')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '需要处理的提醒' })).not.toBeInTheDocument()
    expect(within(block('值得先看的匹配机会')).queryByRole('button', { name: '查看全部' })).not.toBeInTheDocument()
  })

  it('opens each row and number where it came from', () => {
    const props = renderPage(full)
    fireEvent.click(within(block('今天要跟进')).getByRole('button', { name: /山田.*查看面试安排/u }))
    expect(props.onOpenFollowUp).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'p1', reviewId: 'c1' }))
    fireEvent.click(within(block('今天要跟进')).getByRole('button', { name: '查看全部 21 件' }))
    expect(props.onOpenFollowUps).toHaveBeenCalledTimes(1)
    expect(within(block('今天的面试')).getByRole('button', { name: /二面/u })).toHaveTextContent('14:00')

    const opportunities = block('值得先看的匹配机会')
    const headings = within(opportunities)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
    expect(headings).toEqual(['可以提案', '待确认'])
    expect(within(opportunities).getByRole('button', { name: /铃木/u })).toHaveTextContent('待补充：日语商务')
    fireEvent.click(within(opportunities).getByRole('button', { name: /佐藤/u }))
    expect(props.onOpenOpportunity).toHaveBeenCalledWith(expect.objectContaining({ id: 'o1', reviewId: 'c2' }))
    fireEvent.click(within(opportunities).getByRole('button', { name: '查看全部' }))
    expect(props.onOpenOpportunities).toHaveBeenCalledTimes(1)

    fireEvent.click(within(block('新案件')).getByRole('button', { name: /AWS 迁移/u }))
    expect(props.onOpenCase).toHaveBeenCalledWith('c4')
    fireEvent.click(within(block('新案件')).getByRole('button', { name: '查看全部未读' }))
    fireEvent.click(screen.getByRole('button', { name: /^新案件6/u }))
    expect(props.onOpenUnseenCases).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: /^AI 额度/u }))
    expect(props.onNavigate).toHaveBeenLastCalledWith('ai-member')
    expect(within(block('本周简报')).getByText('5')).toBeInTheDocument()
  })

  it('offers the panel alert actions and prefills Agent without sending', () => {
    const props = renderPage(full)
    const alerts = screen.getByRole('list', { name: '需要处理的提醒' })
    expect(alerts).toHaveTextContent('AI 额度不足')
    expect(alerts).toHaveTextContent('Model X')
    fireEvent.click(within(alerts).getByRole('button', { name: '换模型' }))
    expect(props.onNavigate).toHaveBeenLastCalledWith('settings:models')
    expect(screen.getByRole('button', { name: /^AI 额度/u })).toHaveTextContent('额度不足以调用当前模型')

    const send = screen.getByRole('button', { name: '在 Agent 中打开' })
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '问 Agent' }), { target: { value: '  今天先做什么？ ' } })
    fireEvent.click(send)
    expect(props.onAsk).toHaveBeenCalledWith('今天先做什么？')
    expect(screen.getByRole('textbox', { name: '问 Agent' })).toHaveValue('')
  })

  it('says so when local data cannot be read, and offers a retry', () => {
    const props = renderPage({ status: 'not-ready', locale: 'zh-CN', generatedAt: '2026-09-30T01:00:00.000Z' })
    expect(screen.getByRole('status')).toHaveTextContent('暂时无法读取今天的概况')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(props.state.reload).toHaveBeenCalled()
  })

  it('shows loading until the first summary arrives', () => {
    renderPage(null)
    expect(screen.getByRole('status')).toHaveTextContent('正在读取…')
  })
})
