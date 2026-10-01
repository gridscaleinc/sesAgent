import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CandidateReviewSnapshot, JobCaseReviewSnapshot, MatchingOpportunity } from '@shared'
import {
  MatchingOpportunitiesBanner,
  MatchingOpportunitiesPage,
  opportunityDay,
  useMatchingOpportunities,
  type OpportunityGrouping
} from './MatchingOpportunities'
import { UiLocaleProvider } from '../i18n'

const row = (patch: Partial<MatchingOpportunity>): MatchingOpportunity => ({
  id: 'o1',
  documentId: 'p1',
  reviewId: 'r1',
  jobCaseId: 'c1',
  personName: '人员甲',
  caseTitle: 'Java 案件',
  profileVersion: 1,
  jobCaseVersion: 1,
  rulesRevision: 0,
  fingerprint: 'f'.repeat(64),
  score: 80,
  status: 'recommended',
  reasons: ['Java', 'Spring', 'AWS', 'SQL', 'Docker'],
  confirm: ['Kubernetes', 'N2以上'],
  updatedAt: new Date().toISOString(),
  state: 'new',
  ...patch
})
const rows = [
  row({}),
  row({ id: 'o2', documentId: 'p2', personName: '人员乙', confirm: [], reasons: ['Java'], state: 'seen' }),
  row({ id: 'o3', reviewId: 'r2', jobCaseId: 'c2', caseTitle: 'Go 案件', reasons: ['Go'], confirm: [] })
]

function api(value: Record<string, unknown>) {
  Object.defineProperty(window, 'sesAgent', { configurable: true, value })
}
function Harness({
  onOpen,
  visible = true
}: {
  onOpen(item: MatchingOpportunity, grouping: OpportunityGrouping): void
  visible?: boolean
}) {
  const state = useMatchingOpportunities(true, 'zh-CN')
  return (
    <UiLocaleProvider locale="zh-CN">
      <MatchingOpportunitiesBanner count={state.newCount} recommended={state.newRecommendedCount} onOpen={() => undefined} />
      <MatchingOpportunitiesPage
        state={state}
        visible={visible}
        defaultGrouping="case"
        backLabel="返回案件列表"
        onBack={() => undefined}
        onOpen={onOpen}
      />
    </UiLocaleProvider>
  )
}
/** The page with local case and person records, for the facts beside each pair. */
function MatchingOpportunitiesFacts({ cases, people }: { cases: unknown[]; people: unknown[] }) {
  const state = useMatchingOpportunities(true, 'zh-CN')
  return (
    <MatchingOpportunitiesPage
      state={state}
      visible
      defaultGrouping="case"
      backLabel="返回案件列表"
      cases={cases as JobCaseReviewSnapshot[]}
      people={people as CandidateReviewSnapshot[]}
      onBack={() => undefined}
      onOpen={() => undefined}
    />
  )
}
beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear()
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('shows a one-line banner with the new count and hides it at zero', () => {
  const open = vi.fn()
  const { rerender } = render(<MatchingOpportunitiesBanner count={2} onOpen={open} />)
  expect(screen.getByRole('status')).toHaveTextContent('新しいマッチング候補 2')
  fireEvent.click(screen.getByRole('button', { name: '新しいマッチング候補を見る（2）' }))
  expect(open).toHaveBeenCalled()
  rerender(<MatchingOpportunitiesBanner count={0} onOpen={open} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('adds the new 可以提案 count to the banner only when there is one', () => {
  const { rerender } = render(
    <UiLocaleProvider locale="zh-CN">
      <MatchingOpportunitiesBanner count={3} recommended={2} onOpen={() => undefined} />
    </UiLocaleProvider>
  )
  expect(screen.getByRole('status')).toHaveTextContent('新匹配机会 3（其中可以提案 2）')
  rerender(
    <UiLocaleProvider locale="zh-CN">
      <MatchingOpportunitiesBanner count={3} recommended={0} onOpen={() => undefined} />
    </UiLocaleProvider>
  )
  expect(screen.getByRole('status')).toHaveTextContent(/^新匹配机会 3查看/u)
})

it('counts new recommended rows for the banner', async () => {
  api({
    listMatchingOpportunities: vi.fn(async () => [...rows, row({ id: 'o4', documentId: 'p4', status: 'needs-confirmation' })]),
    controlMatchingOpportunity: vi.fn()
  })
  render(<Harness onOpen={vi.fn()} />)
  expect(await screen.findByRole('status')).toHaveTextContent('新匹配机会 3（其中可以提案 2）')
})

it('lists 可以提案 before 待确认, each grouped, and hides an empty section', async () => {
  const pending = row({ id: 'o4', documentId: 'p4', personName: '人员丁', status: 'needs-confirmation' })
  api({ listMatchingOpportunities: vi.fn(async () => [pending, ...rows]), controlMatchingOpportunity: vi.fn() })
  const { unmount } = render(<Harness onOpen={vi.fn()} />)
  const ready = await screen.findByRole('region', { name: '可以提案 (3)' })
  const later = screen.getByRole('region', { name: '待确认 (1)' })
  expect(ready.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(ready).getByRole('region', { name: 'Java 案件' })).toHaveTextContent('人员甲')
  expect(within(ready).getByRole('region', { name: 'Go 案件' })).toBeInTheDocument()
  expect(within(later).getByRole('region', { name: 'Java 案件' })).toHaveTextContent('人员丁')
  expect(within(later).queryByText('人员甲')).not.toBeInTheDocument()
  unmount()
  api({ listMatchingOpportunities: vi.fn(async () => [pending]), controlMatchingOpportunity: vi.fn() })
  render(<Harness onOpen={vi.fn()} />)
  expect(await screen.findByRole('region', { name: '待确认 (1)' })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: /^可以提案/u })).not.toBeInTheDocument()
})

it('groups by case or by person and remembers the choice', async () => {
  api({ listMatchingOpportunities: vi.fn(async () => rows), controlMatchingOpportunity: vi.fn() })
  render(<Harness onOpen={vi.fn()} />)
  expect(await screen.findByRole('heading', { name: '新匹配机会 (3)' })).toBeInTheDocument()
  const javaCase = screen.getByRole('region', { name: 'Java 案件' })
  expect(within(javaCase).getByRole('heading', { name: 'Java 案件' })).toBeInTheDocument()
  expect(javaCase).toHaveTextContent('2 人')
  expect(within(javaCase).getByText('人员甲')).toBeInTheDocument()
  expect(within(javaCase).getByText('人员乙')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '按人员' }))
  expect(screen.getByRole('button', { name: '按人员' })).toHaveAttribute('aria-pressed', 'true')
  const person = screen.getByRole('region', { name: '人员甲' })
  expect(within(person).getByText('Java 案件')).toBeInTheDocument()
  expect(within(person).getByText('Go 案件')).toBeInTheDocument()
  expect(localStorage.getItem('ses-opportunities-group-v1')).toBe('person')
  cleanup()
  render(<Harness onOpen={vi.fn()} />)
  expect(await screen.findByRole('region', { name: '人员乙' })).toBeInTheDocument()
})

it('shows up to four evidenced chips, the count met and what is left to confirm on the row', async () => {
  api({
    listMatchingOpportunities: vi.fn(async () => [row({ status: 'needs-confirmation' })]),
    controlMatchingOpportunity: vi.fn()
  })
  render(<Harness onOpen={vi.fn()} />)
  const item = (await screen.findByText('人员甲')).closest('li')!
  expect(within(item).getByText('✓ Java')).toBeInTheDocument()
  expect(within(item).getByText('✓ SQL')).toBeInTheDocument()
  expect(within(item).queryByText('✓ Docker')).not.toBeInTheDocument()
  expect(within(item).getByText('+1')).toBeInTheDocument()
  expect(item).toHaveTextContent('满足 5 项 · 待确认 2 项')
  expect(item).toHaveTextContent('待确认：Kubernetes、N2以上')
  expect(within(item).getByRole('button', { name: '确认条件：人员甲' })).toBeInTheDocument()
  // The day is said once on the group, not on every row.
  expect(within(item).queryByText(/今天/u)).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Java 案件' })).toHaveTextContent('今天发现')
})

it('shows the case facts on the group and the person facts on each row', async () => {
  api({ listMatchingOpportunities: vi.fn(async () => [rows[0]]), controlMatchingOpportunity: vi.fn() })
  const field = (key: string, value: string) => ({ key, value })
  render(
    <UiLocaleProvider locale="zh-CN">
      <MatchingOpportunitiesFacts
        cases={[{ reviewId: 'r1', fields: [field('rate', '70万'), field('location', '渋谷'), field('start_date', '10月')] }]}
        people={[{ documentId: 'p1', fields: [field('experience_years', '8年'), field('availability', '即日'), field('rate', '65万')] }]}
      />
    </UiLocaleProvider>
  )
  const group = await screen.findByRole('region', { name: 'Java 案件' })
  expect(within(group).getByRole('banner')).toHaveTextContent('70万 · 渋谷 · 10月')
  expect(screen.getByText('人员甲').closest('li')).toHaveTextContent('经验 8年 · 可入场 立即 · 65万')
})

it('filters to new pairs, opens a pair by clicking its row and pages ten pairs at a time', async () => {
  const many = Array.from({ length: 12 }, (_, index) =>
    row({ id: `m${index}`, documentId: `p${index}`, personName: `人员${index}`, state: index < 3 ? 'new' : 'seen' })
  )
  const open = vi.fn()
  api({ listMatchingOpportunities: vi.fn(async () => many), controlMatchingOpportunity: vi.fn(async () => many) })
  render(<Harness onOpen={open} />)
  await screen.findByText('人员0')
  expect(screen.getAllByRole('listitem')).toHaveLength(10)
  fireEvent.click(screen.getByRole('button', { name: '第 2 页' }))
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '只看新的 3' }))
  expect(screen.getAllByRole('listitem')).toHaveLength(3)
  expect(screen.queryByRole('navigation', { name: '列表分页' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('人员1'))
  await waitFor(() => expect(open).toHaveBeenCalledWith(many[1], 'case'))
})

it('removes a pair from 新匹配机会 with its 删除 button', async () => {
  const control = vi.fn(async () => [rows[1]])
  api({ listMatchingOpportunities: vi.fn(async () => [rows[0], rows[1]]), controlMatchingOpportunity: control })
  render(<Harness onOpen={vi.fn()} />)
  await screen.findByText('人员甲')
  fireEvent.click(screen.getByRole('button', { name: '删除：人员甲 · Java 案件' }))
  await waitFor(() => expect(screen.queryByText('人员甲')).not.toBeInTheDocument())
  expect(control).toHaveBeenCalledWith({ id: 'o1', fingerprint: 'f'.repeat(64), action: 'dismissed' })
})

it('opens a pair only after Main accepted the seen mark, with the current grouping', async () => {
  const open = vi.fn()
  const control = vi.fn().mockRejectedValueOnce(new Error('推荐已更新')).mockResolvedValue([rows[0]])
  api({ listMatchingOpportunities: vi.fn(async () => [rows[0]]), controlMatchingOpportunity: control })
  render(<Harness onOpen={open} />)
  await screen.findByText('人员甲')
  fireEvent.click(screen.getByRole('button', { name: '查看匹配：人员甲' }))
  await screen.findByRole('alert')
  expect(open).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '按人员' }))
  fireEvent.click(screen.getByRole('button', { name: '查看匹配：Java 案件' }))
  await waitFor(() => expect(open).toHaveBeenCalledWith(rows[0], 'person'))
  expect(control).toHaveBeenLastCalledWith({ id: 'o1', fingerprint: 'f'.repeat(64), action: 'seen' })
})

it('shows an empty state, and a read failure with a retry', async () => {
  const list = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue([])
  api({ listMatchingOpportunities: list, controlMatchingOpportunity: vi.fn() })
  render(<Harness onOpen={vi.fn()} />)
  const alert = await screen.findByRole('alert')
  fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
  expect(await screen.findByText(/暂无新的匹配机会/u)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('keeps the scroll position while hidden and restores it when shown again', async () => {
  api({ listMatchingOpportunities: vi.fn(async () => rows), controlMatchingOpportunity: vi.fn() })
  const { rerender, container } = render(<Harness onOpen={vi.fn()} />)
  await screen.findAllByText('人员甲')
  const scroller = container.querySelector<HTMLDivElement>('.opportunity-scroll')!
  scroller.scrollTop = 120
  fireEvent.scroll(scroller)
  rerender(<Harness onOpen={vi.fn()} visible={false} />)
  scroller.scrollTop = 0
  rerender(<Harness onOpen={vi.fn()} visible />)
  expect(scroller.scrollTop).toBe(120)
})

it('reads the day in Tokyo time', () => {
  const t = (cn: string) => cn
  const now = new Date('2026-09-30T03:00:00Z')
  expect(opportunityDay('2026-09-29T16:00:00Z', t, now)).toBe('今天')
  expect(opportunityDay('2026-09-29T10:00:00Z', t, now)).toBe('昨天')
  expect(opportunityDay('2026-09-28T01:00:00Z', t, now)).toBe('9/28')
  expect(opportunityDay('2025-12-01T01:00:00Z', t, now)).toBe('2025/12/1')
})

it('lists pairs HR judged 不满足 last in red, not counted as new, and lands 「确认条件」 on the first item to confirm', async () => {
  const rejected = row({ id: 'o9', documentId: 'p9', personName: '人员癸', status: 'not-suitable', confirm: ['日本語流暢'] })
  const pending = row({ id: 'o4', documentId: 'p4', personName: '人员丁', status: 'needs-confirmation', confirm: ['日本語流暢'] })
  const open = vi.fn()
  api({
    listMatchingOpportunities: vi.fn(async () => [rejected, pending, rows[1]]),
    controlMatchingOpportunity: vi.fn(async () => [rows[1]])
  })
  const { takePendingRequirementFocus } = await import('../requirement-decision-events')
  render(<Harness onOpen={open} />)
  const last = await screen.findByRole('region', { name: '不满足 (1)' })
  const regions = screen.getAllByRole('region').filter((region) => /\(\d+\)$/u.test(region.getAttribute('aria-label') ?? ''))
  expect(regions.at(-1)).toBe(last)
  expect(within(last).getByText('人员癸').closest('li')).toHaveTextContent('已判定不满足 · 未满足或待确认：日本語流暢')
  // The banner counts new pairs one can still act on: 人员丁 only.
  expect(screen.getByRole('status')).toHaveTextContent('新匹配机会 1')
  expect(screen.getByRole('button', { name: '只看新的 1' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '确认条件：人员丁' }))
  await waitFor(() => expect(open).toHaveBeenCalledWith(pending, 'case'))
  expect(takePendingRequirementFocus()).toBe('日本語流暢')
})
