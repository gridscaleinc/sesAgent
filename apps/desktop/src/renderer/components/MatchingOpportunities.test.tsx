import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MatchingOpportunity } from '@shared'
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
  expect(screen.getByRole('status')).toHaveTextContent('新匹配机会 3（可以提案 2）')
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
  expect(await screen.findByRole('status')).toHaveTextContent('新匹配机会 3（可以提案 2）')
})

it('lists 可以提案 before 核心信息待补充, each grouped, and hides an empty section', async () => {
  const pending = row({ id: 'o4', documentId: 'p4', personName: '人员丁', status: 'needs-confirmation' })
  api({ listMatchingOpportunities: vi.fn(async () => [pending, ...rows]), controlMatchingOpportunity: vi.fn() })
  const { unmount } = render(<Harness onOpen={vi.fn()} />)
  const ready = await screen.findByRole('region', { name: '可以提案 (3)' })
  const later = screen.getByRole('region', { name: '核心信息待补充 (1)' })
  expect(ready.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(ready).getByRole('region', { name: 'Java 案件' })).toHaveTextContent('人员甲')
  expect(within(ready).getByRole('region', { name: 'Go 案件' })).toBeInTheDocument()
  expect(within(later).getByRole('region', { name: 'Java 案件' })).toHaveTextContent('人员丁')
  expect(within(later).queryByText('人员甲')).not.toBeInTheDocument()
  unmount()
  api({ listMatchingOpportunities: vi.fn(async () => [pending]), controlMatchingOpportunity: vi.fn() })
  render(<Harness onOpen={vi.fn()} />)
  expect(await screen.findByRole('region', { name: '核心信息待补充 (1)' })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: /^可以提案/u })).not.toBeInTheDocument()
})

it('groups by case or by person and remembers the choice', async () => {
  api({ listMatchingOpportunities: vi.fn(async () => rows), controlMatchingOpportunity: vi.fn() })
  render(<Harness onOpen={vi.fn()} />)
  expect(await screen.findByRole('heading', { name: '新匹配机会 (3)' })).toBeInTheDocument()
  const javaCase = screen.getByRole('region', { name: 'Java 案件' })
  expect(within(javaCase).getByRole('heading', { name: 'Java 案件2' })).toBeInTheDocument()
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

it('shows up to four evidenced chips and expands the items to confirm inline', async () => {
  api({ listMatchingOpportunities: vi.fn(async () => [rows[0]]), controlMatchingOpportunity: vi.fn() })
  render(<Harness onOpen={vi.fn()} />)
  const item = (await screen.findByText('人员甲')).closest('li')!
  expect(within(item).getByText('✓ Java')).toBeInTheDocument()
  expect(within(item).getByText('✓ SQL')).toBeInTheDocument()
  expect(within(item).queryByText('✓ Docker')).not.toBeInTheDocument()
  expect(within(item).getByText('+1')).toBeInTheDocument()
  expect(within(item).getByText('今天')).toBeInTheDocument()
  const toggle = within(item).getByRole('button', { name: /待确认 2/u })
  const details = document.getElementById(toggle.getAttribute('aria-controls')!)!
  expect(details).not.toBeVisible()
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(details).toBeVisible()
  expect(details).toHaveTextContent('KubernetesN2以上')
})

it('dismisses a pair from its ⋯ menu', async () => {
  const control = vi.fn(async () => [rows[1]])
  api({ listMatchingOpportunities: vi.fn(async () => [rows[0], rows[1]]), controlMatchingOpportunity: control })
  render(<Harness onOpen={vi.fn()} />)
  await screen.findByText('人员甲')
  fireEvent.click(screen.getByRole('button', { name: '更多操作：人员甲 · Java 案件' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '暂不关注此组合' }))
  await waitFor(() => expect(screen.queryByText('人员甲')).not.toBeInTheDocument())
  expect(control).toHaveBeenCalledWith({ id: 'o1', fingerprint: 'f'.repeat(64), action: 'dismissed' })
})

it('opens a pair only after Main accepted the seen mark, with the current grouping', async () => {
  const open = vi.fn()
  const control = vi.fn().mockRejectedValueOnce(new Error('推荐已更新')).mockResolvedValue([rows[0]])
  api({ listMatchingOpportunities: vi.fn(async () => [rows[0]]), controlMatchingOpportunity: control })
  render(<Harness onOpen={open} />)
  await screen.findByText('人员甲')
  fireEvent.click(screen.getByRole('button', { name: '查看匹配' }))
  await screen.findByRole('alert')
  expect(open).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '按人员' }))
  fireEvent.click(screen.getByRole('button', { name: '查看匹配' }))
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
