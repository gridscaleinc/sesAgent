import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { BusinessFollowUp, CandidateReviewSnapshot, DesktopApi, JobCaseReviewSnapshot, SaveBusinessFollowUpInput } from '@shared'
import { UiLocaleProvider } from '../i18n'
import { HrFollowUps } from './HrFollowUps'

const personId = (i: number) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`
const caseId = (i: number) => `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`
const people = Array.from({ length: 20 }, (_, i) => ({ documentId: personId(i), fileName: `人员 ${i}`, fields: [] })) as unknown as CandidateReviewSnapshot[]
const cases = Array.from({ length: 20 }, (_, i) => ({ reviewId: caseId(i), redactedSubject: `案件 ${i} Java 基本设计`, fields: [] })) as unknown as JobCaseReviewSnapshot[]
const row = (i: number, status: BusinessFollowUp['status'] = 'contacted'): BusinessFollowUp => ({
  id: `follow-${i}`, documentId: personId(i), reviewId: caseId(i), revision: 2, status,
  note: `第 ${i} 次沟通`, nextStep: `确认 ${i} 号的入场安排`, recordedBy: 'HR',
  updatedAt: `2026-09-${String(i + 1).padStart(2, '0')}T09:00:00Z`,
  events: [
    { status: 'contacted', note: `早先的沟通 ${i}`, nextStep: '等待回复', recordedAt: '2026-08-30T09:00:00Z', recordedBy: 'HR' },
    { status, note: `最近的沟通 ${i}`, nextStep: `确认 ${i} 号的入场安排`, recordedAt: '2026-09-01T09:00:00Z', recordedBy: 'HR' }
  ]
})
const props = () => ({ target: null, reloadToken: 0, people, cases, onView: vi.fn(), onInterview: vi.fn(), onBrowse: vi.fn() })
const show = (options: Partial<Parameters<typeof HrFollowUps>[0]> = {}) => render(<UiLocaleProvider locale="zh-CN"><HrFollowUps {...props()} {...options} /></UiLocaleProvider>)
const detail = () => within(screen.getByRole('article', { name: '跟进详情' }))
const list = () => within(screen.getByLabelText('跟进列表'))
const filter = (name: RegExp) => within(screen.getByRole('group', { name: '跟进阶段' })).getByRole('button', { name })

beforeEach(() => {
  Object.defineProperty(window, 'sesAgent', { configurable: true, value: {
    listBusinessFollowUps: vi.fn(async () => [row(0), row(1, 'replied'), row(2, 'closed')]),
    saveBusinessFollowUp: vi.fn(async (input: SaveBusinessFollowUpInput) => ({ ...row(Number(input.documentId.slice(-2))), ...input, revision: input.expectedRevision + 1, updatedAt: '2026-09-20T09:00:00Z' }))
  } as Partial<DesktopApi> })
})

it('shows active pairs newest first, keeps the list read-only, and separates history from the next action', async () => {
  const callbacks = props()
  show(callbacks)
  await screen.findByRole('article', { name: '跟进详情' })
  expect(filter(/^进行中/)).toHaveAttribute('aria-pressed', 'true')
  expect(list().getAllByRole('button').map((button) => button.textContent)).toEqual([expect.stringContaining('人员 1'), expect.stringContaining('人员 0')])
  expect(list().queryByRole('textbox')).not.toBeInTheDocument()
  expect(detail().getByRole('heading', { name: '人员 1' })).toBeVisible()
  const events = within(detail().getByRole('region', { name: '沟通记录' })).getAllByRole('listitem')
  expect(events[0]).toHaveTextContent('最近的沟通 1')
  expect(events[1]).toHaveTextContent('早先的沟通 1')
  fireEvent.click(detail().getByRole('button', { name: '查看案件' }))
  expect(callbacks.onView).toHaveBeenCalledWith('case', caseId(1))
  fireEvent.click(detail().getByRole('button', { name: '查看人员' }))
  expect(callbacks.onView).toHaveBeenCalledWith('person', personId(1))
  fireEvent.click(filter(/^已结束/))
  expect(detail().getByRole('heading', { name: '人员 2' })).toBeVisible()
  expect(detail().getByRole('heading', { name: '本次跟进已结束' })).toBeVisible()
})

it('searches names, cases and next steps, paginates, and resets the page when filters change', async () => {
  vi.mocked(window.sesAgent.listBusinessFollowUps).mockResolvedValue(Array.from({ length: 15 }, (_, i) => row(i)))
  show()
  await screen.findByRole('article', { name: '跟进详情' })
  expect(list().getAllByRole('button')).toHaveLength(12)
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(list().getAllByRole('button')).toHaveLength(3)
  expect(detail().getByRole('heading', { name: '人员 2' })).toBeVisible()
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索跟进' }), { target: { value: '确认 14 号' } })
  expect(list().getAllByRole('button')).toHaveLength(1)
  expect(detail().getByRole('heading', { name: '人员 14' })).toBeVisible()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '案件 9 Java' } })
  expect(detail().getByRole('heading', { name: '人员 9' })).toBeVisible()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在的名字' } })
  expect(screen.getByText('没有符合条件的跟进')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '查看全部跟进' }))
  expect(list().getAllByRole('button')).toHaveLength(12)
  expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
})

it('starts each new progress note empty, retains the next action and preserves drafts across pair selection', async () => {
  show()
  await screen.findByRole('article', { name: '跟进详情' })
  fireEvent.click(detail().getByRole('button', { name: '记录新进展' }))
  const note = detail().getByRole('textbox', { name: '本次沟通' })
  expect(note).toHaveValue('')
  expect(note).toHaveFocus()
  expect(detail().getByRole('textbox', { name: '下一步' })).toHaveValue('确认 1 号的入场安排')
  expect(detail().getByRole('button', { name: '保存跟进' })).toBeDisabled()
  fireEvent.change(note, { target: { value: '尚未保存的新反馈' } })
  fireEvent.click(list().getByRole('button', { name: /^人员 0/ }))
  fireEvent.click(detail().getByRole('button', { name: '记录新进展' }))
  expect(detail().getByRole('textbox', { name: '本次沟通' })).toHaveValue('')
  fireEvent.click(list().getByRole('button', { name: /^人员 1/ }))
  fireEvent.click(detail().getByRole('button', { name: '继续填写' }))
  expect(detail().getByRole('textbox', { name: '本次沟通' })).toHaveValue('尚未保存的新反馈')
  expect(window.sesAgent.saveBusinessFollowUp).not.toHaveBeenCalled()
  fireEvent.click(detail().getByRole('button', { name: '取消' }))
  fireEvent.click(detail().getByRole('button', { name: '记录新进展' }))
  expect(detail().getByRole('textbox', { name: '本次沟通' })).toHaveValue('')
})

it('saves only once while pending and keeps a newly closed pair selected', async () => {
  let resolveSave!: (value: BusinessFollowUp) => void
  vi.mocked(window.sesAgent.saveBusinessFollowUp).mockImplementation(() => new Promise((resolve) => { resolveSave = resolve }))
  show()
  await screen.findByRole('article', { name: '跟进详情' })
  fireEvent.click(detail().getByRole('button', { name: '记录新进展' }))
  fireEvent.click(detail().getByRole('radio', { name: '已结束' }))
  const form = detail().getByRole('button', { name: '保存跟进' }).closest('form')!
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(window.sesAgent.saveBusinessFollowUp).toHaveBeenCalledTimes(1)
  expect(detail().getByRole('button', { name: '正在保存' })).toBeDisabled()
  expect(filter(/^已联系/)).toBeDisabled()
  const input = vi.mocked(window.sesAgent.saveBusinessFollowUp).mock.calls[0][0]
  await act(async () => resolveSave({ ...row(1), ...input, revision: 3, updatedAt: '2026-09-20T09:00:00Z' }))
  expect(filter(/^已结束/)).toHaveAttribute('aria-pressed', 'true')
  expect(detail().getByRole('heading', { name: '人员 1' })).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent('跟进已保存')
})

it('keeps notes and revisions after failure, retries the saved draft, and links interviews', async () => {
  const callbacks = props()
  show(callbacks)
  await screen.findByRole('article', { name: '跟进详情' })
  fireEvent.click(detail().getByRole('button', { name: '记录新进展' }))
  fireEvent.click(detail().getByRole('radio', { name: '面试沟通中' }))
  fireEvent.change(detail().getByRole('textbox', { name: '本次沟通' }), { target: { value: '已确认可面试时间' } })
  vi.mocked(window.sesAgent.saveBusinessFollowUp).mockRejectedValueOnce(new Error('演示保存失败'))
  fireEvent.click(detail().getByRole('button', { name: '保存跟进' }))
  await screen.findByRole('alert')
  expect(detail().getByRole('textbox', { name: '本次沟通' })).toHaveValue('已确认可面试时间')
  fireEvent.click(detail().getByRole('button', { name: '保存跟进' }))
  await screen.findByRole('status')
  expect(vi.mocked(window.sesAgent.saveBusinessFollowUp).mock.calls[1][0]).toMatchObject({ expectedRevision: 2, documentId: personId(1), reviewId: caseId(1), status: 'interview', note: '已确认可面试时间' })
  fireEvent.click(detail().getByRole('button', { name: '面试记录' }))
  expect(callbacks.onInterview).toHaveBeenCalledWith(personId(1))
})

it('opens an external target on its actual page and does not focus an editor while the surface is hidden', async () => {
  vi.mocked(window.sesAgent.listBusinessFollowUps).mockResolvedValue(Array.from({ length: 15 }, (_, i) => row(i)))
  const options = { ...props(), target: { documentId: personId(0), reviewId: caseId(0) }, active: false }
  const view = show(options)
  await screen.findByRole('article', { name: '跟进详情' })
  expect(screen.queryByRole('textbox', { name: '本次沟通' })).not.toBeInTheDocument()
  view.rerender(<UiLocaleProvider locale="zh-CN"><HrFollowUps {...options} active /></UiLocaleProvider>)
  await screen.findByRole('textbox', { name: '本次沟通' })
  expect(list().getByRole('button', { name: /^人员 0/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('navigation', { name: '跟进分页' })).toHaveTextContent('2 / 2')
})

it('offers real business entry points when empty and lets a failed initial read be retried', async () => {
  vi.mocked(window.sesAgent.listBusinessFollowUps).mockRejectedValueOnce(new Error('无法读取演示记录')).mockResolvedValueOnce([])
  const callbacks = props()
  show(callbacks)
  await screen.findByRole('alert')
  expect(screen.queryByText('从一次联系开始')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await screen.findByText('从一次联系开始')
  fireEvent.click(screen.getByRole('button', { name: '去案件找人' }))
  fireEvent.click(screen.getByRole('button', { name: '去人员找案件' }))
  expect(callbacks.onBrowse.mock.calls).toEqual([['case'], ['person']])
  expect(window.sesAgent.saveBusinessFollowUp).not.toHaveBeenCalled()
})


it('carries matching questions into the next step draft without creating a contact record automatically', async () => {
  vi.mocked(window.sesAgent.listBusinessFollowUps).mockResolvedValue([])
  show({ target: { documentId: personId(0), reviewId: caseId(0), pendingConditions: ['单价待沟通', '确认 10 月入场'] } })
  const nextStep = await screen.findByRole('textbox', { name: '下一步' })
  expect(nextStep).toHaveValue('待沟通：单价待沟通；确认 10 月入场')
  expect(window.sesAgent.saveBusinessFollowUp).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('textbox', { name: '本次沟通' }), { target: { value: '已联系案件方，等待条件反馈' } })
  fireEvent.click(screen.getByRole('button', { name: '保存跟进' }))
  await waitFor(() => expect(window.sesAgent.saveBusinessFollowUp).toHaveBeenCalledWith({ documentId: personId(0), reviewId: caseId(0), expectedRevision: 0, status: 'contacted', note: '已联系案件方，等待条件反馈', nextStep: '待沟通：单价待沟通；确认 10 月入场' }))
})
