import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { emptyProgressEntry, type BusinessFeedEntry, type BusinessFollowUp, type CandidateReviewSnapshot, type DesktopApi, type JobCaseReviewSnapshot } from '@shared'
import { BusinessProgressContext, isActiveProgress, progressIndexes, progressPresentation, useBusinessProgressData } from '../business-progress-data'
import { UiLocaleProvider } from '../i18n'
import { saveHrPosition } from '../hr-business-navigation'
import { BusinessProgressOverview } from './BusinessProgressOverview'
import { HrObjectList } from './HrObjectList'
import { HrProgressWorkbench } from './HrProgressWorkbench'
import type { FollowUpTarget } from './HrFollowUps'

const people = ['A', 'B'].map((name) => ({ documentId: `person-${name}`, fileName: `人员${name}`, fields: [], projectExperiences: [] })) as unknown as CandidateReviewSnapshot[]
const cases = Array.from({ length: 6 }, (_, i) => ({ reviewId: `case-${i}`, redactedSubject: `Java 案件 ${i}`, fields: [], lifecycle: 'active' })) as unknown as JobCaseReviewSnapshot[]
const follow = (i: number, person = 0): BusinessFollowUp => ({ id: `follow-${i}-${person}`, documentId: people[person]!.documentId, reviewId: cases[i]!.reviewId, revision: 1, status: 'interview', note: '', nextStep: '', recordedBy: 'HR', updatedAt: `2026-09-0${i + 1}T01:00:00Z`, events: [], progress: { stage: 'coordinating', rounds: [], candidateAvailability: '', clientAvailability: '', pendingConditions: [], entry: emptyProgressEntry() } })
let rows: BusinessFollowUp[]
const feed = (kind: 'person' | 'case', id: string, title: string): BusinessFeedEntry => ({ kind, objectId: id, title, revision: 'a'.repeat(64), source: kind === 'person' ? 'local-personnel' : 'chat-paste', sourceAt: '2020-01-01T00:00:00Z', occurredAt: '2020-01-01T00:00:00Z', event: 'created', businessStatus: kind === 'person' ? 'available' : 'active', unseen: false, deferred: false, archived: false, needsReview: false, fields: [], changes: [] })
beforeEach(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
  rows = Array.from({ length: 6 }, (_, i) => follow(i))
  rows[4]!.progress!.stage = 'closed'; rows[4]!.status = 'closed'; rows[4]!.note = '客户暂停招聘'
  rows[5]!.progress!.stage = 'started'; rows[5]!.progress!.entry.actualDate = '2026-09-09'
  rows.push(follow(0, 1))
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: {
    listBusinessFollowUps: vi.fn(async () => structuredClone(rows)), listBusinessProgressMail: vi.fn(async () => []),
    getBusinessFeed: vi.fn(async () => [feed('person', people[0]!.documentId, '人员A'), feed('case', cases[0]!.reviewId, 'Java 案件 0')]),
    markBusinessFeed: vi.fn(async () => []),
    advanceBusinessProgress: vi.fn(async (input) => {
      const row = rows.find((item) => item.documentId === input.documentId && item.reviewId === input.reviewId)!
      const next = { ...row, revision: row.revision + 1, progress: { ...row.progress!, candidateAvailability: input.candidateAvailability, clientAvailability: input.clientAvailability, pendingConditions: input.pendingConditions }, note: '双方时间已更新' }
      rows = rows.map((item) => item.id === row.id ? next : item)
      return structuredClone(next)
    })
  } as Partial<DesktopApi> })
})
function Harness() {
  const [caseId, setCaseId] = useState(cases[0]!.reviewId)
  const data = useBusinessProgressData(1), [kind, setKind] = useState<'person' | 'case'>('person'), [target, setTarget] = useState<FollowUpTarget | null>(null)
  return <UiLocaleProvider locale="zh-CN"><BusinessProgressContext.Provider value={data}>
    <button onClick={() => setKind(kind === 'person' ? 'case' : 'person')}>切换对象</button>
    <HrObjectList kind={kind} reloadToken={1} candidates={people} busy={false} onOpen={vi.fn()} onOpenProgress={() => {}} onIntake={vi.fn()} onImportResume={vi.fn()} onRefresh={async () => {}} />
    {target ? <HrProgressWorkbench embedded target={target} reloadToken={1} people={people} cases={cases} onView={vi.fn()} onBack={() => setTarget(null)} /> : <BusinessProgressOverview kind={kind} objectId={kind === 'person' ? people[0]!.documentId : caseId} people={people} cases={cases} onAdvance={(next) => {setCaseId(next.reviewId);setTarget(next)}} />}
  </BusinessProgressContext.Provider></UiLocaleProvider>
}

it('projects one person across cases and one case across people, with separate history, placements and pagination', async () => {
  render(<Harness />)
  const overview = within(await screen.findByRole('region', { name: '营业情况' }))
  await waitFor(() => expect(overview.getByText(/推进中 4 个案件/)).toBeVisible())
  expect(overview.getByText(/已进场 1 个案件/)).toBeVisible()
  expect(overview.getByText('Java 案件 5')).toBeVisible()
  expect(overview.getByText('客户暂停招聘')).not.toBeVisible()
  expect(overview.getByRole('navigation', { name: '营业情况分页' })).toHaveTextContent('1 / 2')
  fireEvent.click(overview.getByRole('button', { name: '下一页' }))
  expect(overview.getByRole('navigation', { name: '营业情况分页' })).toHaveTextContent('2 / 2')
  fireEvent.click(screen.getByText('切换对象'))
  await waitFor(() => expect(overview.getByText(/推进中 2 人/)).toBeVisible())
  expect(overview.getByText('人员A')).toBeVisible(); expect(overview.getByText('人员B')).toBeVisible()
  expect(overview.queryByText('Java 案件 5')).not.toBeInTheDocument()
})

it('opens only the selected pair in the side editor and reflects saved progress on both object surfaces', async () => {
  saveHrPosition('person', { timeRange: 'all' }); saveHrPosition('case', { timeRange: 'all' })
  render(<Harness />)
  const overview = within(await screen.findByRole('region', { name: '营业情况' }))
  const appointment = await overview.findAllByRole('button', { name: '安排面试' })
  fireEvent.click(appointment[0]!)
  const editor = within(await screen.findByRole('article', { name: '推进详情' }))
  expect(screen.queryByRole('navigation', { name: '推进阶段' })).not.toBeInTheDocument()
  expect(screen.queryByRole('searchbox', { name: '搜索跟进' })).not.toBeInTheDocument()
  fireEvent.change(editor.getByLabelText('人员可用时间'), { target: { value: '周五上午' } })
  fireEvent.click(editor.getByRole('button', { name: '保存可用时间' }))
  await screen.findByText('已保存，下一步已更新')
  expect(window.sesAgent.advanceBusinessProgress).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'person-A', reviewId: 'case-3', candidateAvailability: '周五上午' }))
  fireEvent.click(screen.getByRole('button', { name: '← 返回营业情况' }))
  expect(await screen.findByText('双方时间已更新')).toBeVisible()
  fireEvent.click(screen.getByText('切换对象'))
  expect(await screen.findByText('双方时间已更新')).toBeVisible()
  expect(within(screen.getByRole('region', {name:'营业情况'})).getByText('人员A')).toBeVisible()
  expect(window.sesAgent.listBusinessFollowUps).toHaveBeenCalledTimes(1)
})

it('keeps today filtering intact and explicitly reveals older objects with active business', async () => {
  render(<Harness />)
  const list = within(screen.getByRole('region', { name: '人员业务列表' }))
  await waitFor(() => expect(list.getByRole('button', { name: '查看全部推进中' })).toBeEnabled())
  expect(list.queryByRole('article')).not.toBeInTheDocument()
  expect(list.getByLabelText('列表时间范围')).toHaveValue('today')
  fireEvent.click(list.getByRole('button', { name: '查看全部推进中' }))
  expect(list.getByLabelText('列表时间范围')).toHaveValue('all')
  const card = within(await list.findByRole('article', { name: '人员A' }))
  expect(card.getByRole('button', { name: /推进中 4 个案件/ })).toBeVisible()
  for (const name of ['查看详情', '找案件', '准备介绍', '稍后处理']) expect(card.getByRole('button', { name })).toBeVisible()
  expect(card.queryByRole('textbox')).not.toBeInTheDocument()
  expect(card.getByText(/2020/)).toBeVisible()
})

it('does not present a failed load as no business and retries successfully', async () => {
  vi.mocked(window.sesAgent.listBusinessFollowUps).mockRejectedValueOnce(new Error('offline'))
  render(<Harness />)
  expect(await screen.findByRole('alert')).toHaveTextContent('营业情况读取失败')
  expect(screen.queryByText('暂无跟进案件')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  await waitFor(() => expect(screen.getByText(/推进中 4 个案件/)).toBeVisible())
})

it('derives feedback reminders without inventing interview outcomes or active counts for ended cases', () => {
  const indexes = progressIndexes(rows)
  expect(indexes.person.get('person-A')).toHaveLength(6)
  expect(indexes.case.get('case-0')).toHaveLength(2)
  expect(rows.filter(isActiveProgress)).toHaveLength(5)
  const row = follow(0)
  row.progress!.stage = 'scheduled'; row.progress!.rounds = [{ roundNumber: 2, scheduledAt: '2026-09-09T01:00:00Z', durationMinutes: 60 }] as NonNullable<BusinessFollowUp['progress']>['rounds']
  expect(progressPresentation(row, new Date('2026-09-10T01:00:00Z'), true)).toMatchObject({ stage: 'feedback', label: '2 面待反馈' })
  expect(row.progress!.stage).toBe('scheduled')
})


it('does not let an older refresh overwrite a just-saved relationship, and accepts later deletion', async () => {
  let finish!: (rows: BusinessFollowUp[]) => void
  vi.mocked(window.sesAgent.listBusinessFollowUps).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const { result } = renderHook(() => useBusinessProgressData(1))
  const saved = { ...follow(0), revision: 2 }
  act(() => result.current.publish([saved]))
  await act(async () => { finish([]) })
  expect(result.current.indexes.person.get('person-A')?.[0]?.revision).toBe(2)
  vi.mocked(window.sesAgent.listBusinessFollowUps).mockResolvedValueOnce([])
  await act(async () => { await result.current.refresh() })
  expect(result.current.rows).toEqual([])
  expect(result.current.indexes.case.has('case-0')).toBe(false)
})
