import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { NewJobCaseDigest } from '@shared'
import { NewCaseDigestCard } from './NewCaseDigestCard'
import { AgentSystemRail } from './AgentSystemRail'

const todayReviewId = 'a1111111-1111-4111-8111-111111111111'
const yesterdayReviewId = 'b1111111-1111-4111-8111-111111111111'
const jobCaseId = '22222222-2222-4222-8222-222222222222'

const digest: NewJobCaseDigest = {
  newCasesToday: 1,
  unseenCount: 1,
  groups: [
    {
      day: 'today', count: 1, unseenCount: 1,
      entries: [{
        reviewId: todayReviewId, jobCaseId, title: 'Java 決済基盤', sourceType: 'gmail',
        arrivedAt: '2026-08-26T01:00:00.000Z', unseen: true, status: 'ready', missingFieldKeys: [],
        highlights: [{ key: 'required_skills', value: 'Java、Spring Boot' }, { key: 'rate', value: '65万円' }]
      }]
    },
    {
      day: 'yesterday', count: 1, unseenCount: 0,
      entries: [{
        reviewId: yesterdayReviewId, jobCaseId: null, title: 'VC++ 開発', sourceType: 'chat-paste',
        arrivedAt: '2026-08-25T04:00:00.000Z', unseen: false, status: 'needs-completion',
        missingFieldKeys: ['rate', 'location'], highlights: []
      }]
    }
  ]
}

function renderCard(overrides: Partial<Parameters<typeof NewCaseDigestCard>[0]> = {}) {
  const onMarkSeen = vi.fn()
  const onOpenAccess = vi.fn()
  render(<NewCaseDigestCard digest={digest} onMarkSeen={onMarkSeen} onOpenAccess={onOpenAccess} {...overrides} />)
  return { onMarkSeen, onOpenAccess }
}

describe('NewCaseDigestCard', () => {
  it('groups the arrivals by day, marks the unread ones and names each source', () => {
    renderCard()
    expect(screen.getByText('本日')).toBeInTheDocument()
    expect(screen.getByText('昨日')).toBeInTheDocument()
    expect(screen.getByText('未読 1 件')).toBeInTheDocument()
    expect(screen.getAllByText('新')).toHaveLength(1)
    expect(screen.getByText('Gmail')).toBeInTheDocument()
    expect(screen.getByText('貼付')).toBeInTheDocument()
    expect(screen.getByText('Java、Spring Boot')).toBeInTheDocument()
  })

  it('lists the missing fields on a 要補完 case and calls a confirmed one 有効', () => {
    renderCard()
    expect(screen.getByText('要補完：単価・勤務地')).toBeInTheDocument()
    expect(screen.getByText('有効')).toBeInTheDocument()
  })

  it('opens the case review and marks it seen in the same click', () => {
    const { onMarkSeen, onOpenAccess } = renderCard()
    fireEvent.click(screen.getAllByRole('button', { name: '詳細' })[0]!)
    expect(onMarkSeen).toHaveBeenCalledWith(todayReviewId)
    expect(onOpenAccess).toHaveBeenCalledWith({ type: 'system-access', destination: 'case-review', reviewId: todayReviewId })
  })

  it('offers matching only for a case that is already confirmed', () => {
    const { onMarkSeen, onOpenAccess } = renderCard()
    const matching = screen.getAllByRole('button', { name: 'マッチング' })
    expect(matching).toHaveLength(1)
    fireEvent.click(matching[0]!)
    expect(onMarkSeen).toHaveBeenCalledWith(todayReviewId)
    expect(onOpenAccess).toHaveBeenCalledWith({ type: 'system-access', destination: 'matching', jobCaseId })
    fireEvent.click(screen.getAllByRole('button', { name: '配信文' })[1]!)
    expect(onOpenAccess).toHaveBeenLastCalledWith({ type: 'system-access', destination: 'broadcast', reviewId: yesterdayReviewId })
  })

  it('says nothing arrived today and names the last Gmail sync instead', () => {
    renderCard({
      digest: { groups: [], newCasesToday: 0, unseenCount: 0 },
      gmailLastSyncedAt: '2026-08-26T00:15:00.000Z'
    })
    expect(screen.getByRole('status')).toHaveTextContent('本日の新規案件はありません。前回の Gmail 同期 09:15')
  })

  it('withholds the sync line when Gmail is not connected', () => {
    renderCard({ digest: { groups: [], newCasesToday: 0, unseenCount: 0 } })
    expect(screen.getByRole('status')).toHaveTextContent('本日の新規案件はありません。')
    expect(screen.getByRole('status').textContent).not.toContain('Gmail')
  })
})

describe('AgentSystemRail', () => {
  const railProps = {
    onAgent: vi.fn(), onCandidates: vi.fn(), onInterviews: vi.fn(),
    onCases: vi.fn(), onReviews: vi.fn(), onSettings: vi.fn()
  }

  it('badges the case button with the unread count', () => {
    render(<AgentSystemRail {...railProps} caseUnseenCount={3} />)
    expect(screen.getByLabelText('未読 3 件')).toHaveTextContent('3')
  })

  it('shows no badge at all when nothing is unread', () => {
    render(<AgentSystemRail {...railProps} caseUnseenCount={0} />)
    expect(screen.queryByLabelText(/未読/u)).toBeNull()
  })
})
