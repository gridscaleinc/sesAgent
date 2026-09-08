import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { changedBusinessFields, type BusinessFeedEntry, type MarkBusinessFeedInput } from '@shared'
import { LatestBusinessFeed } from './LatestBusinessFeed'
const entry: BusinessFeedEntry = { kind: 'person', objectId: '11111111-1111-4111-8111-111111111111', revision: 'a'.repeat(64), title: 'TEST Java Engineer', event: 'updated', occurredAt: new Date().toISOString(), sourceAt: '2026-01-01T00:00:00.000Z', source: 'local-personnel', unseen: true, deferred: false, archived: false, businessStatus: 'available', needsReview: false, fields: [{ key: 'skills', value: 'Java AWS' }], changes: [{ key: 'rate', before: '75万円', after: '70万円' }] }
const props = () => ({ reloadToken: 1, onOpen: vi.fn(), onIntake: vi.fn(), onRefresh: vi.fn(async () => {}) })
function mockFeed(initial: BusinessFeedEntry[]) {
  let records = initial
  const getBusinessFeed = vi.fn(async () => records)
  const markBusinessFeed = vi.fn(async (input: MarkBusinessFeedInput) => {
    records = records.map((item) => item.kind === input.kind && item.objectId === input.objectId && item.revision === input.revision
      ? { ...item, unseen: false, deferred: input.action === 'seen' ? item.deferred : input.action === 'defer' } : item)
    return records
  })
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: { getBusinessFeed, markBusinessFeed } })
  return { getBusinessFeed, markBusinessFeed, replace: (next: BusinessFeedEntry[]) => { records = next } }
}
const order = () => screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))
const selectReadState = (value: string) => fireEvent.change(screen.getByRole('combobox', { name: '閲覧状態' }), { target: { value } })
const record = (title: string, hour: number, extra: Partial<BusinessFeedEntry> = {}): BusinessFeedEntry => {
  const today = new Date(); today.setHours(hour, 0, 0, 0)
  return { ...entry, objectId: title, title, occurredAt: today.toISOString(), businessStatus: extra.kind === 'case' ? 'active' : 'available', ...extra }
}
describe('latest business information', () => {
  it('shows only usable records and removes status changes immediately even when retained or deferred', async () => {
    const person = record('Available person', 15)
    const job = record('Active case', 14, { kind: 'case' })
    const excluded = [record('Assigned', 13, { businessStatus: 'assigned', deferred: true }), record('Paused', 12, { businessStatus: 'paused' }), record('Archived case', 11, { kind: 'case', archived: true, businessStatus: 'archived' })]
    const api = mockFeed([person, job, ...excluded]); const actions = props()
    const view = render(<LatestBusinessFeed {...actions} />)
    await screen.findByRole('article', { name: person.title })
    expect(order()).toEqual([person.title, job.title])
    expect(screen.getByText('2 件が未読')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('article', { name: person.title }))
    await waitFor(() => expect(within(screen.getByRole('article', { name: person.title })).getByText('確認済み', { selector: '.latest-seen' })).toBeVisible())
    api.replace([{ ...person, revision: 'b'.repeat(64), businessStatus: 'assigned' }, { ...job, revision: 'c'.repeat(64), businessStatus: 'archived', archived: true }, ...excluded])
    view.rerender(<LatestBusinessFeed {...actions} reloadToken={2} />)
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
    expect(screen.getByText('0 件が未読')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'あとで対応 (0)' }))
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })
  it('shows changes and original source date, then opens the exact selected record', async () => {
    const { markBusinessFeed: mark } = mockFeed([entry])
    const actions = props(); render(<LatestBusinessFeed {...actions} />)
    await screen.findByRole('button', { name: entry.title })
    expect(screen.getByText('75万円')).toBeInTheDocument(); expect(screen.getByText('70万円')).toBeInTheDocument()
    expect(screen.getByText(/元情報の日付/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '紹介文を作成' }))
    expect(actions.onOpen).toHaveBeenCalledWith(entry, 'promote')
    await waitFor(() => expect(mark).toHaveBeenCalledWith({ kind: 'person', objectId: entry.objectId, revision: entry.revision, action: 'seen' }))
    expect(await screen.findByText('確認済み', { selector: '.latest-seen' })).toBeVisible()
  })
  it.each([
    ['詳細を見る', 'view'], ['要員を探す', 'match'], ['紹介文を作成', 'promote']
  ] as const)('keeps chronological positions and selection after %s marks a case seen', async (label, action) => {
    const newest = record('Newest already read', 15, { unseen: false })
    const current = record('Current unread case', 14, { kind: 'case' })
    const older = record('Older unread', 13)
    mockFeed([older, current, newest])
    const actions = props(); render(<LatestBusinessFeed {...actions} />)
    selectReadState('all')
    const card = await screen.findByRole('article', { name: current.title })
    const initialOrder = [newest.title, current.title, older.title]
    expect(order()).toEqual(initialOrder)
    fireEvent.click(within(card).getByRole('button', { name: label }))
    expect(actions.onOpen).toHaveBeenCalledWith(current, action)
    await waitFor(() => expect(within(card).getByText('確認済み', { selector: '.latest-seen' })).toBeVisible())
    expect(order()).toEqual(initialOrder)
    expect(card).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('1 件が未読')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: '確認済み' })).not.toBeInTheDocument()
  })
  it('marks a different record read without stealing the detail selection', async () => {
    const current = record('Reading person', 13, { unseen: false })
    const newer = record('Unread case', 14, { kind: 'case' })
    mockFeed([current, newer])
    const actions = props()
    render(<LatestBusinessFeed {...actions} selectedEntryKey={`person:${current.objectId}`} />)
    selectReadState('all')
    const card = await screen.findByRole('article', { name: newer.title })
    fireEvent.click(within(card).getByRole('button', { name: '既読にする' }))
    await waitFor(() => expect(within(card).getByText('確認済み', { selector: '.latest-seen' })).toBeVisible())
    expect(actions.onOpen).not.toHaveBeenCalled()
    expect(order()).toEqual([newer.title, current.title])
    expect(screen.getByRole('article', { name: current.title })).toHaveAttribute('aria-current', 'true')
    expect(card).not.toHaveAttribute('aria-current')
  })
  it('follows the actual detail object, explains filtered selections and clears on close', async () => {
    const person = record('Person', 13, { unseen: false })
    const job = record('Case', 14, { kind: 'case', unseen: false })
    mockFeed([person, job]); const actions = props()
    const view = render(<LatestBusinessFeed {...actions} selectedEntryKey={`person:${person.objectId}`} />)
    selectReadState('all')
    expect(await screen.findByRole('article', { name: person.title })).toHaveAttribute('aria-current', 'true')
    view.rerender(<LatestBusinessFeed {...actions} selectedEntryKey={`case:${job.objectId}`} />)
    expect(screen.getByRole('article', { name: job.title })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('article', { name: person.title })).not.toHaveAttribute('aria-current')
    fireEvent.click(screen.getByRole('button', { name: '要員' }))
    expect(screen.getByText(/表示中の情報はこの一覧の範囲外です/)).toBeVisible()
    view.rerender(<LatestBusinessFeed {...actions} selectedEntryKey={null} />)
    expect(screen.queryByText(/表示中の情報はこの一覧の範囲外です/)).not.toBeInTheDocument()
    expect(screen.getByRole('article', { name: person.title })).not.toHaveAttribute('aria-current')
  })
  it('buffers background arrivals and changed revisions until an explicit update, retaining selection', async () => {
    const current = record('Reading case', 12, { kind: 'case', unseen: false })
    const old = record('Older', 11)
    const api = mockFeed([current, old]); const actions = props()
    const view = render(<LatestBusinessFeed {...actions} selectedEntryKey={`case:${current.objectId}`} />)
    selectReadState('all')
    await screen.findByRole('article', { name: current.title })
    const changed = { ...current, title: 'Updated case', revision: 'b'.repeat(64), unseen: true }
    const incoming = record('New arrival', 15)
    api.replace([incoming, changed, old])
    view.rerender(<LatestBusinessFeed {...actions} reloadToken={2} selectedEntryKey={`case:${current.objectId}`} />)
    expect(await screen.findByText('更新 2 件があります')).toBeVisible()
    expect(order()).toEqual([current.title, old.title])
    expect(screen.getByRole('article', { name: current.title })).toHaveAttribute('aria-current', 'true')
    expect(within(screen.getByRole('article', { name: current.title })).getByText('確認済み', { selector: '.latest-seen' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '一覧を更新' }))
    await screen.findByRole('article', { name: incoming.title })
    expect(order()).toEqual([incoming.title, changed.title, old.title])
    expect(screen.getByRole('article', { name: changed.title })).toHaveAttribute('aria-current', 'true')
    expect(within(screen.getByRole('article', { name: changed.title })).getByRole('button', { name: '既読にする' })).toBeEnabled()
    expect(actions.onRefresh).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: '一覧を更新' })).not.toBeInTheDocument()
  })
  it('does not undo another acknowledgement when two mark responses arrive out of order', async () => {
    const a = record('First', 14); const b = record('Second', 13)
    const api = mockFeed([a, b])
    let finishA!: (records: BusinessFeedEntry[]) => void
    let finishB!: (records: BusinessFeedEntry[]) => void
    api.markBusinessFeed.mockImplementation((input) => new Promise((resolve) => {
      if (input.objectId === a.objectId) finishA = resolve
      else finishB = resolve
    }))
    render(<LatestBusinessFeed {...props()} />)
    const first = await screen.findByRole('article', { name: a.title })
    const second = screen.getByRole('article', { name: b.title })
    fireEvent.click(within(first).getByRole('button', { name: '既読にする' }))
    fireEvent.click(within(second).getByRole('button', { name: '既読にする' }))
    api.replace([{ ...a, unseen: false }, { ...b, unseen: false }])
    await act(async () => { finishB([{ ...a, unseen: false }, { ...b, unseen: false }]) })
    // The earlier write's captured response still shows B unread.
    await act(async () => { finishA([{ ...a, unseen: false }, b]) })
    expect(within(first).getByText('確認済み', { selector: '.latest-seen' })).toBeVisible()
    expect(within(second).getByText('確認済み', { selector: '.latest-seen' })).toBeVisible()
    expect(order()).toEqual([a.title, b.title])
    expect(screen.getByText('0 件が未読')).toBeInTheDocument()
  })
  it('keeps deferred old information accessible without promoting it as recent', async () => {
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: { getBusinessFeed: async () => [{ ...entry, deferred: true, occurredAt: '2020-01-01T00:00:00.000Z' }] } })
    render(<LatestBusinessFeed {...props()} />)
    await screen.findByText(/現在の条件に一致する情報はありません/)
    expect(screen.queryByRole('button', { name: entry.title })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'あとで対応 (1)' }))
    expect(screen.getByRole('button', { name: entry.title })).toBeVisible()
  })
  it('defaults to the local calendar day and offers the past week in the dropdown', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 8, 7, 12).getTime())
    const records = [
      { ...entry, title: 'Today midnight', occurredAt: new Date(2026, 8, 7).toISOString() },
      { ...entry, objectId: 'previous', title: 'Yesterday late', occurredAt: new Date(2026, 8, 6, 23, 59, 59, 999).toISOString() },
      { ...entry, objectId: 'next', title: 'Tomorrow', occurredAt: new Date(2026, 8, 8).toISOString() }
    ]
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: { getBusinessFeed: async () => records } })
    try {
      render(<LatestBusinessFeed {...props()} />)
      expect(await screen.findByRole('button', { name: 'Today midnight' })).toBeVisible()
      const range = screen.getByRole('combobox', { name: '更新情報の期間' })
      expect(range).toHaveValue('0')
      expect(screen.queryByRole('button', { name: 'Yesterday late' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Tomorrow' })).not.toBeInTheDocument()
      fireEvent.change(range, { target: { value: '7' } })
      expect(screen.getByRole('button', { name: 'Yesterday late' })).toBeVisible()
    } finally { now.mockRestore() }
  })
  it('diffs confirmed fields without inventing missing values', () => {
    expect(changedBusinessFields([{ key: 'rate', value: '75万' }, { key: 'skills', value: 'Java' }], [{ key: 'rate', value: '70万' }, { key: 'skills', value: 'Java' }, { key: 'availability', value: null }])).toEqual([{ key: 'rate', before: '75万', after: '70万' }])
  })
  it('defaults to unread, retains newly read cards without jumping, and applies all three filters', async () => {
    const read = record('Previously viewed', 15, { unseen: false })
    const first = record('Unread first', 14)
    const second = record('Unread second', 13)
    mockFeed([read, first, second]); const actions = props()
    render(<LatestBusinessFeed {...actions} />)
    await screen.findByRole('article', { name: first.title })
    expect(screen.getByRole('combobox', { name: '閲覧状態' })).toHaveValue('unseen')
    expect(within(screen.getByRole('combobox', { name: '閲覧状態' })).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual(['all', 'seen', 'unseen'])
    expect(order()).toEqual([first.title, second.title])
    fireEvent.click(screen.getByRole('article', { name: first.title }))
    await waitFor(() => expect(within(screen.getByRole('article', { name: first.title })).getByText('確認済み', { selector: '.latest-seen' })).toBeVisible())
    fireEvent.click(screen.getByRole('article', { name: second.title }))
    await waitFor(() => expect(within(screen.getByRole('article', { name: second.title })).getByText('確認済み', { selector: '.latest-seen' })).toBeVisible())
    expect(order()).toEqual([first.title, second.title])
    expect(screen.getByRole('article', { name: second.title })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText(/今回確認した情報はその場に残ります/)).toBeInTheDocument()
    selectReadState('seen')
    expect(order()).toEqual([read.title, first.title, second.title])
    selectReadState('all')
    expect(order()).toEqual([read.title, first.title, second.title])
    selectReadState('unseen')
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.getByText(/現在の条件に一致する情報はありません/)).toBeVisible()
  })
  it('opens card surfaces by mouse or keyboard without duplicating child button actions', async () => {
    mockFeed([entry]); const actions = props()
    render(<LatestBusinessFeed {...actions} />)
    const card = await screen.findByRole('article', { name: entry.title })
    fireEvent.click(within(card).getByText('Java AWS'))
    expect(actions.onOpen).toHaveBeenCalledTimes(1)
    expect(card).toHaveClass('is-selected')
    await waitFor(() => expect(within(card).getByText('確認済み', { selector: '.latest-seen' })).toBeVisible())
    fireEvent.click(within(card).getByRole('button', { name: '紹介文を作成' }))
    expect(actions.onOpen).toHaveBeenCalledTimes(2)
    expect(actions.onOpen.mock.lastCall?.[1]).toBe('promote')
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(actions.onOpen).toHaveBeenCalledTimes(3)
    fireEvent.click(screen.getByRole('button', { name: '最新情報を再読込' }))
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
  })
})
