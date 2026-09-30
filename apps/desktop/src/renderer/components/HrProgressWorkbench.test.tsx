import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import {
  emptyProgressEntry,
  type BusinessFollowUp,
  type CandidateReviewSnapshot,
  type DesktopApi,
  type JobCaseReviewSnapshot,
  type ProgressAnalysis
} from '@shared'
import { UiLocaleProvider } from '../i18n'
import { HrProgressWorkbench } from './HrProgressWorkbench'
const documentId = '11111111-1111-4111-8111-111111111111'
const people = [{ documentId, fileName: '测试人员', fields: [], projectExperiences: [] }] as unknown as CandidateReviewSnapshot[]
const cases = Array.from({ length: 3 }, (_, i) => ({
  reviewId: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`,
  redactedSubject: `Java 案件 ${i + 1}`,
  fields: []
})) as unknown as JobCaseReviewSnapshot[]
const row = (i: number): BusinessFollowUp => ({
  id: `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`,
  documentId,
  reviewId: cases[i]!.reviewId,
  revision: 1,
  status: 'interview',
  note: '开始约面',
  nextStep: '',
  recordedBy: 'HR',
  updatedAt: '2026-09-10T00:00:00Z',
  events: [],
  progress: {
    stage: 'coordinating',
    rounds: [],
    candidateAvailability: '',
    clientAvailability: '',
    pendingConditions: [],
    entry: emptyProgressEntry()
  }
})
let records: BusinessFollowUp[]
const props = () => ({ target: null, reloadToken: 0, people, cases, onView: vi.fn() })
const show = (options: Partial<Parameters<typeof HrProgressWorkbench>[0]> = {}) =>
  render(
    <UiLocaleProvider locale="zh-CN">
      <HrProgressWorkbench {...props()} {...options} />
    </UiLocaleProvider>
  )
const detail = () => within(screen.getByRole('article', { name: '跟进详情' }))
beforeEach(() => {
  records = [row(0), row(1), row(2)]
  Object.defineProperty(window, 'sesAgent', {
    configurable: true,
    value: {
      listBusinessFollowUps: vi.fn(async () => records),
      listBusinessProgressMail: vi.fn(async () => []),
      advanceBusinessProgress: vi.fn(async (input) => {
        const old = records.find((record) => record.reviewId === input.reviewId)!,
          updated = { ...old, revision: old.revision + 1, progress: { ...old.progress! } }
        if (input.action === 'coordinate')
          updated.progress = {
            ...updated.progress,
            candidateAvailability: input.candidateAvailability,
            clientAvailability: input.clientAvailability,
            pendingConditions: input.pendingConditions
          }
        records = records.map((record) => (record.id === old.id ? updated : record))
        return updated
      }),
      analyzeBusinessProgress: vi.fn(),
      updateBusinessProgressMail: vi.fn(),
      draftBusinessProgressMessage: vi.fn(),
      openBusinessProgressEmail: vi.fn(),
      exportBusinessProgressCalendar: vi.fn()
    } as Partial<DesktopApi>
  })
})
it('keeps three cases independent, preserves drafts when switching and only saves the selected pair', async () => {
  show()
  await screen.findByRole('article', { name: '跟进详情' })
  fireEvent.change(detail().getByLabelText('人员可用时间'), { target: { value: '第一案 周五上午' } })
  fireEvent.click(screen.getByRole('button', { name: /Java 案件 2/ }))
  expect(detail().getByLabelText('人员可用时间')).toHaveValue('')
  fireEvent.change(detail().getByLabelText('人员可用时间'), { target: { value: '第二案 周五下午' } })
  fireEvent.click(screen.getByRole('button', { name: /Java 案件 1/ }))
  expect(detail().getByLabelText('人员可用时间')).toHaveValue('第一案 周五上午')
  fireEvent.click(detail().getByRole('button', { name: '保存可用时间' }))
  await waitFor(() => expect(window.sesAgent.advanceBusinessProgress).toHaveBeenCalledTimes(1))
  expect(window.sesAgent.advanceBusinessProgress).toHaveBeenCalledWith(
    expect.objectContaining({
      documentId,
      reviewId: cases[0]!.reviewId,
      candidateAvailability: '第一案 周五上午',
      expectedRevision: 1,
      action: 'coordinate'
    })
  )
  await waitFor(() => expect(detail().getByRole('button', { name: '保存可用时间' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: /Java 案件 2/ }))
  expect(detail().getByLabelText('人员可用时间')).toHaveValue('第二案 周五下午')
})
it('does not save AI conclusions automatically and prevents repeated cloud requests', async () => {
  let finish!: (result: ProgressAnalysis) => void
  vi.mocked(window.sesAgent.analyzeBusinessProgress).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  show()
  await screen.findByRole('article', { name: '跟进详情' })
  fireEvent.click(detail().getByRole('button', { name: '反馈与 AI 整理' }))
  fireEvent.change(detail().getByLabelText('面试反馈或消息'), { target: { value: '一面通过，需要二面' } })
  fireEvent.click(detail().getByRole('button', { name: 'AI 整理反馈' }))
  const pending = detail().getByRole('button', { name: '正在整理' })
  expect(pending).toBeDisabled()
  fireEvent.click(pending)
  expect(window.sesAgent.analyzeBusinessProgress).toHaveBeenCalledTimes(1)
  await act(async () =>
    finish({
      summary: '一面通过，需要二面',
      kind: 'schedule',
      evidence: '一面通过，需要二面',
      roundNumber: 1,
      result: 'passed',
      next: 'next-round',
      scheduledAt: null,
      candidateAvailability: '',
      clientAvailability: '',
      proposedTimes: [],
      unresolved: ['架构经验'],
      plannedDate: null
    })
  )
  expect(detail().getByRole('button', { name: '反馈与 AI 整理' })).toHaveAttribute('aria-pressed', 'true')
  expect(detail().getByLabelText('本轮结果')).toHaveValue('passed')
  expect(detail().getByRole('button', { name: '保存结果，安排下一轮' })).toBeEnabled()
  expect(window.sesAgent.advanceBusinessProgress).not.toHaveBeenCalled()
})
it('retains input after an update conflict and requires using the fresh revision', async () => {
  vi.mocked(window.sesAgent.advanceBusinessProgress).mockRejectedValueOnce(new Error('推进记录已更新'))
  const view = show()
  await screen.findByRole('article', { name: '跟进详情' })
  fireEvent.change(detail().getByLabelText('人员可用时间'), { target: { value: '周一上午' } })
  fireEvent.click(detail().getByRole('button', { name: '保存可用时间' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('推进记录已更新')
  expect(detail().getByLabelText('人员可用时间')).toHaveValue('周一上午')
  records = [{ ...row(0), revision: 2 }, row(1), row(2)]
  view.rerender(
    <UiLocaleProvider locale="zh-CN">
      <HrProgressWorkbench {...props()} reloadToken={1} />
    </UiLocaleProvider>
  )
  await waitFor(() => expect(detail().getByRole('button', { name: '保存可用时间' })).toBeDisabled())
  fireEvent.click(detail().getByRole('button', { name: '使用最新记录继续' }))
  fireEvent.click(detail().getByRole('button', { name: '保存可用时间' }))
  await waitFor(() =>
    expect(window.sesAgent.advanceBusinessProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: 2, candidateAvailability: '周一上午' })
    )
  )
})
it('requires persisted acceptance and explicit actual arrival, and lists other cases separately', async () => {
  const first = row(0)
  first.progress = { ...first.progress!, stage: 'entry', entry: { ...emptyProgressEntry(), plannedDate: '2026-09-10' } }
  records = [first, row(1), row(2)]
  show({ target: { documentId, reviewId: cases[0]!.reviewId } })
  await screen.findByRole('article', { name: '跟进详情' })
  expect(detail().getByRole('button', { name: '确认已到岗' })).toBeDisabled()
  fireEvent.click(detail().getByLabelText('人员已接受该案件'))
  fireEvent.click(detail().getByLabelText('双方已确认入场条件'))
  expect(detail().getByRole('button', { name: '确认已到岗' })).toBeDisabled()
  expect(window.sesAgent.advanceBusinessProgress).not.toHaveBeenCalled()
})

it('saves free-form meeting information with no date or interviewer and preserves the text', async () => {
  show()
  await screen.findByRole('article', { name: '跟进详情' })
  fireEvent.change(detail().getByLabelText('面试形式'), { target: { value: 'zoom' } })
  const link = detail().getByLabelText('会议链接')
  expect(link).toHaveAttribute('type', 'text')
  fireEvent.change(link, { target: { value: '会议号 123456，密码另发' } })
  fireEvent.change(detail().getByLabelText('安排备注'), { target: { value: '时间由双方商量' } })
  const save = detail().getByRole('button', { name: '保存面试安排' })
  expect(save).toBeEnabled()
  expect(save.closest('form')!.checkValidity()).toBe(true)
  fireEvent.click(save)
  await waitFor(() =>
    expect(window.sesAgent.advanceBusinessProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'schedule',
        schedule: expect.objectContaining({
          scheduledAt: '',
          interviewer: '',
          meetingUrl: '会议号 123456，密码另发',
          note: '时间由双方商量'
        })
      })
    )
  )
})

it('does not expose IPC or validation JSON and retains the failed draft for retry', async () => {
  vi.mocked(window.sesAgent.advanceBusinessProgress).mockRejectedValueOnce(
    new Error(
      `Error invoking remote method 'business:advance-progress': [ { "code": "custom", "path": [ "meetingUrl" ], "message": "会议链接必须使用 HTTPS 地址。" } ]`
    )
  )
  show()
  await screen.findByRole('article', { name: '跟进详情' })
  fireEvent.change(detail().getByLabelText('面试形式'), { target: { value: 'zoom' } })
  fireEvent.change(detail().getByLabelText('会议链接'), { target: { value: 'http://example.com/meeting' } })
  fireEvent.click(detail().getByRole('button', { name: '保存面试安排' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('操作未完成，输入已保留，请重试。')
  expect(screen.getByRole('alert')).not.toHaveTextContent('business:advance-progress')
  expect(detail().getByLabelText('会议链接')).toHaveValue('http://example.com/meeting')
  expect(detail().getByRole('button', { name: '保存面试安排' })).toBeEnabled()
})

it('books second and third rounds directly and keeps the selected round when saving availability', async () => {
  const initial = row(0)
  const first = {
    id: 'round-1',
    roundNumber: 1,
    scheduledAt: '2099-09-11T01:00:00.000Z',
    durationMinutes: 60,
    meetingMethod: 'zoom',
    meetingUrl: '会议号 第一轮',
    meetingDetails: {},
    interviewer: '面试官',
    contactNote: '第一轮备注',
    interviewNotes: null,
    decision: null,
    unresolvedItems: []
  } as unknown as NonNullable<BusinessFollowUp['progress']>['rounds'][number]
  initial.progress = { ...initial.progress!, stage: 'scheduled', rounds: [first] }
  records = [initial, row(1), row(2)]
  const original = window.sesAgent.advanceBusinessProgress
  vi.mocked(window.sesAgent.advanceBusinessProgress).mockImplementation(async (input) => {
    const old = records.find((item) => item.reviewId === input.reviewId)!
    const next = { ...old, revision: old.revision + 1, progress: { ...old.progress! } }
    if (input.action === 'coordinate')
      Object.assign(next.progress, {
        candidateAvailability: input.candidateAvailability,
        clientAvailability: input.clientAvailability,
        pendingConditions: input.pendingConditions
      })
    if (input.action === 'schedule') {
      next.progress.stage = 'scheduled'
      next.progress.rounds = [
        ...old.progress!.rounds,
        { ...first, ...input.schedule, id: `round-${input.schedule.roundNumber}`, contactNote: input.schedule.note }
      ]
    }
    records = records.map((item) => (item.id === next.id ? next : item))
    return next
  })
  show({ target: { documentId, reviewId: cases[0]!.reviewId } })
  await screen.findByRole('article', { name: '跟进详情' })
  for (const roundNumber of [2, 3]) {
    fireEvent.click(detail().getByRole('button', { name: '安排下一轮面试' }))
    expect(detail().getByLabelText('面试轮次')).toHaveValue(roundNumber)
    expect(detail().getByLabelText('会议链接')).toHaveValue('')
    fireEvent.change(detail().getByLabelText('面试时间（日本时间）'), { target: { value: `2099-09-${10 + roundNumber}T10:00` } })
    fireEvent.change(detail().getByLabelText('人员可用时间'), { target: { value: `第${roundNumber}轮，上午` } })
    fireEvent.click(detail().getByRole('button', { name: '保存可用时间' }))
    await waitFor(() => expect(detail().getByRole('button', { name: '保存可用时间' })).toBeEnabled())
    expect(detail().getByLabelText('面试轮次')).toHaveValue(roundNumber)
    expect(detail().getByLabelText('面试时间（日本时间）')).toHaveValue(`2099-09-${10 + roundNumber}T10:00`)
    fireEvent.click(detail().getByRole('button', { name: '确认预约' }))
    await waitFor(() => expect(detail().getByText(`${roundNumber} 面已预约`)).toBeVisible())
    expect(original).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'schedule', schedule: expect.objectContaining({ roundNumber }) })
    )
    expect(detail().getByLabelText('面试轮次')).toHaveValue(roundNumber)
  }
  expect(records[0]!.progress!.rounds).toHaveLength(3)
  expect(records[0]!.progress!.rounds[0]).toEqual(first)
  expect(records[0]!.progress!.rounds.map((item) => item.decision)).toEqual([null, null, null])
})

const interviewRound = (roundNumber: number, notes: string | null = null, decision: 'passed' | 'failed' | null = null) =>
  ({
    id: `round-${roundNumber}`,
    roundNumber,
    scheduledAt: `2099-09-${10 + roundNumber}T01:00:00.000Z`,
    durationMinutes: 60,
    meetingMethod: 'onsite',
    meetingUrl: null,
    meetingDetails: { onsiteAddress: '東京' },
    interviewer: '面试官',
    contactNote: '预约备注',
    interviewNotes: notes,
    decision,
    unresolvedItems: []
  }) as unknown as NonNullable<BusinessFollowUp['progress']>['rounds'][number]

it('loads the selected historical feedback and preserves an unsaved current appointment after backfill', async () => {
  const first = row(0)
  first.progress = {
    ...first.progress!,
    stage: 'scheduled',
    rounds: [interviewRound(1, '一面原始反馈', 'passed'), interviewRound(2, '二面原始反馈')]
  }
  records = [first, row(1), row(2)]
  vi.mocked(window.sesAgent.advanceBusinessProgress).mockImplementation(async (input) => {
    const previous = records[0]!
    if (input.action !== 'feedback') throw new Error('unexpected command')
    const saved = {
      ...previous,
      revision: previous.revision + 1,
      progress: {
        ...previous.progress!,
        rounds: previous.progress!.rounds.map((round) =>
          round.roundNumber === input.roundNumber ? { ...round, interviewNotes: input.notes } : round
        )
      }
    }
    records = [saved, ...records.slice(1)]
    return saved
  })
  show({ target: { documentId, reviewId: cases[0]!.reviewId } })
  await screen.findByRole('article', { name: '跟进详情' })
  fireEvent.change(detail().getByLabelText('安排备注'), { target: { value: '尚未保存的二面安排' } })
  fireEvent.click(detail().getByRole('button', { name: '反馈与 AI 整理' }))
  expect(detail().getByLabelText('面试反馈或消息')).toHaveValue('二面原始反馈')
  fireEvent.change(detail().getByLabelText('记录第几轮结果'), { target: { value: '1' } })
  expect(detail().getByLabelText('面试反馈或消息')).toHaveValue('一面原始反馈')
  expect(detail().getByLabelText('本轮结果')).toHaveValue('passed')
  expect(detail().queryByLabelText('通过后下一步')).not.toBeInTheDocument()
  fireEvent.change(detail().getByLabelText('面试反馈或消息'), { target: { value: '补录一面的完整评价' } })
  fireEvent.click(detail().getByRole('button', { name: '保存历史反馈' }))
  await waitFor(() => expect(detail().getByRole('button', { name: '保存历史反馈' })).toBeEnabled())
  expect(window.sesAgent.advanceBusinessProgress).toHaveBeenLastCalledWith(
    expect.objectContaining({ action: 'feedback', roundNumber: 1, notes: '补录一面的完整评价' })
  )
  expect(detail().getByText('2 面已预约')).toBeVisible()
  expect(detail().getByLabelText('记录第几轮结果')).toHaveValue(1)
  fireEvent.click(detail().getByRole('button', { name: '面试安排' }))
  expect(detail().getByLabelText('面试轮次')).toHaveValue(2)
  expect(detail().getByLabelText('安排备注')).toHaveValue('尚未保存的二面安排')
})

it('opens the correct round from history and allows backfilling after arrival', async () => {
  const first = row(0)
  first.status = 'closed'
  first.progress = {
    ...first.progress!,
    stage: 'started',
    rounds: [interviewRound(1), interviewRound(2, '终面通过', 'passed')],
    entry: { ...emptyProgressEntry(), actualDate: '2026-09-10' }
  }
  records = [first]
  show({ target: { documentId, reviewId: cases[0]!.reviewId } })
  await screen.findByRole('article', { name: '跟进详情' })
  fireEvent.click(detail().getByRole('button', { name: '完整记录' }))
  fireEvent.click(detail().getAllByRole('button', { name: '查看 / 补录本轮反馈' })[0]!)
  expect(detail().getByLabelText('记录第几轮结果')).toHaveValue(1)
  expect(detail().getByLabelText('面试反馈或消息')).toBeEnabled()
  fireEvent.change(detail().getByLabelText('面试反馈或消息'), { target: { value: '补录一面原文' } })
  fireEvent.click(detail().getByRole('button', { name: '保存历史反馈' }))
  await waitFor(() =>
    expect(window.sesAgent.advanceBusinessProgress).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'feedback', roundNumber: 1, notes: '补录一面原文' })
    )
  )
  expect(detail().getByText('已进场')).toBeVisible()
})

it('resumes a failed interview into a decision screen and only books the next round on explicit action', async () => {
  const first = row(0)
  first.status = 'closed'
  first.progress = { ...first.progress!, stage: 'closed', rounds: [interviewRound(1), interviewRound(2, '二面未通过', 'failed')] }
  records = [first]
  vi.mocked(window.sesAgent.advanceBusinessProgress).mockImplementation(async (input) => {
    const old = records[0]!,
      updated = {
        ...old,
        status: 'interview' as const,
        revision: old.revision + 1,
        progress: { ...old.progress!, stage: 'next-decision' as const }
      }
    expect(input.action).toBe('resume')
    records = [updated]
    return updated
  })
  show({ target: { documentId, reviewId: cases[0]!.reviewId } })
  await screen.findByRole('article', { name: '跟进详情' })
  fireEvent.click(detail().getByRole('button', { name: '恢复跟进' }))
  expect(await detail().findByText('待确认后续安排')).toBeVisible()
  expect(detail().getByLabelText('本轮结果')).toHaveValue('failed')
  expect(detail().getByLabelText('记录第几轮结果')).toHaveValue(2)
  fireEvent.click(detail().getByRole('button', { name: '安排下一轮面试' }))
  expect(detail().getByLabelText('面试轮次')).toHaveValue(3)
  expect(detail().getByLabelText('面试时间（日本时间）')).toHaveValue('')
  expect(window.sesAgent.advanceBusinessProgress).toHaveBeenCalledTimes(1)
})

it('shows all persisted entry terms after arrival and on reopening the record', async () => {
  const first = row(0)
  first.status = 'closed'
  first.progress = {
    ...first.progress!,
    stage: 'started',
    entry: {
      plannedDate: '2026-09-09',
      actualDate: '2026-09-10',
      rate: '85万円',
      workStyle: '每周两天远程',
      location: '東京丸の内',
      reportTime: '09:30',
      contact: '测试联系人 / 03-0000-0000',
      materials: '电脑\n身份证明',
      candidateAccepted: true,
      termsAgreed: true
    }
  }
  records = [first]
  const view = show({ target: { documentId, reviewId: cases[0]!.reviewId } })
  await screen.findByRole('article', { name: '跟进详情' })
  const verify = () => {
    const record = detail().getByRole('region', { name: '进场记录' })
    for (const value of [
      '2026-09-09',
      '2026-09-10',
      '85万円',
      '每周两天远程',
      '東京丸の内',
      '09:30',
      '测试联系人 / 03-0000-0000',
      '电脑 身份证明',
      '人员已接受该案件',
      '双方已确认入场条件'
    ])
      expect(record).toHaveTextContent(value)
    expect(detail().queryByRole('button', { name: '确认已到岗' })).not.toBeInTheDocument()
  }
  verify()
  view.unmount()
  show({ target: { documentId, reviewId: cases[0]!.reviewId } })
  await screen.findByRole('article', { name: '跟进详情' })
  verify()
  expect(window.sesAgent.advanceBusinessProgress).not.toHaveBeenCalled()
})

it('preserves unsaved schedule and feedback when adding a communication note, without switching tabs', async () => {
  show()
  await screen.findByRole('article', { name: '跟进详情' })
  fireEvent.change(detail().getByLabelText('安排备注'), { target: { value: '尚未保存的安排' } })
  fireEvent.click(detail().getByRole('button', { name: '反馈与 AI 整理' }))
  fireEvent.change(detail().getByLabelText('面试反馈或消息'), { target: { value: '尚未保存的反馈' } })
  fireEvent.click(detail().getByRole('button', { name: '完整记录' }))
  fireEvent.change(detail().getByLabelText('补充沟通记录'), { target: { value: '已与人员联系' } })
  fireEvent.click(detail().getByRole('button', { name: '保存沟通记录' }))
  await waitFor(() => expect(detail().getByLabelText('补充沟通记录')).toHaveValue(''))
  expect(detail().getByRole('button', { name: '完整记录' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(detail().getByRole('button', { name: '面试安排' }))
  expect(detail().getByLabelText('安排备注')).toHaveValue('尚未保存的安排')
  fireEvent.click(detail().getByRole('button', { name: '反馈与 AI 整理' }))
  expect(detail().getByLabelText('面试反馈或消息')).toHaveValue('尚未保存的反馈')
})
it('preserves unsaved entry conditions when adding a communication note', async () => {
  records[0]!.progress!.stage = 'entry'
  show({ target: { documentId, reviewId: cases[0]!.reviewId } })
  await screen.findByRole('article', { name: '跟进详情' })
  fireEvent.change(detail().getByLabelText('最终单价'), { target: { value: '85万円 未保存' } })
  fireEvent.click(detail().getByRole('button', { name: '完整记录' }))
  fireEvent.change(detail().getByLabelText('补充沟通记录'), { target: { value: '已联系' } })
  fireEvent.click(detail().getByRole('button', { name: '保存沟通记录' }))
  await waitFor(() => expect(detail().getByLabelText('补充沟通记录')).toHaveValue(''))
  fireEvent.click(detail().getByRole('button', { name: '入场安排' }))
  expect(detail().getByLabelText('最终单价')).toHaveValue('85万円 未保存')
})
it('lets HR correct or undo an arrival with an explicit reason', async () => {
  records[0]!.progress!.stage = 'started'
  records[0]!.progress!.entry = {
    ...emptyProgressEntry(),
    actualDate: '2026-09-10',
    rate: '80万円',
    candidateAccepted: true,
    termsAgreed: true
  }
  show({ target: { documentId, reviewId: cases[0]!.reviewId } })
  await screen.findByRole('button', { name: '更正进场记录' })
  fireEvent.click(detail().getByRole('button', { name: '更正进场记录' }))
  fireEvent.change(detail().getByLabelText('最终单价'), { target: { value: '85万円' } })
  expect(detail().getByRole('button', { name: '保存更正' })).toBeDisabled()
  fireEvent.change(detail().getByLabelText('更正原因'), { target: { value: '合同单价录入错误' } })
  fireEvent.click(detail().getByRole('button', { name: '保存更正' }))
  await waitFor(() =>
    expect(window.sesAgent.advanceBusinessProgress).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'correct-entry', reason: '合同单价录入错误', entry: expect.objectContaining({ rate: '85万円' }) })
    )
  )
  await screen.findByRole('button', { name: '更正进场记录' })
  fireEvent.click(detail().getByText('撤销误确认到岗'))
  fireEvent.change(detail().getByLabelText('撤销原因'), { target: { value: '尚未到岗' } })
  fireEvent.click(detail().getByRole('button', { name: '撤销并恢复待进场' }))
  await waitFor(() =>
    expect(window.sesAgent.advanceBusinessProgress).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'undo-start', reason: '尚未到岗' })
    )
  )
})
it('rebooks the existing round after a no-show without creating another round', async () => {
  const first = row(0)
  first.progress = {
    ...first.progress!,
    stage: 'closed',
    rounds: [{ ...interviewRound(1), decision: 'no-show', interviewNotes: '客户临时缺席' }]
  }
  records = [first]
  show({ target: { documentId, reviewId: cases[0]!.reviewId } })
  await screen.findByRole('article', { name: '跟进详情' })
  fireEvent.click(detail().getByRole('button', { name: '面试安排' }))
  fireEvent.click(detail().getByRole('button', { name: '重新预约本轮' }))
  fireEvent.change(detail().getByLabelText('重新预约原因'), { target: { value: '与客户重新约同一轮' } })
  fireEvent.click(detail().getByRole('button', { name: '保存面试安排' }))
  await waitFor(() =>
    expect(window.sesAgent.advanceBusinessProgress).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'rebook', schedule: expect.objectContaining({ roundNumber: 1 }), reason: '与客户重新约同一轮' })
    )
  )
})

it('keeps the feedback form usable after saving round questions from the questions tab', async () => {
  const round = {
    id: '44444444-4444-4444-8444-444444444444',
    businessFollowUpId: row(0).id,
    sourceDocumentId: documentId,
    kind: 'client' as const,
    roundNumber: 1,
    parentInterviewId: null,
    stage: 'scheduled' as const,
    scheduledAt: '2026-09-19T06:39:00.000Z',
    durationMinutes: 60,
    meetingMethod: 'onsite' as const,
    meetingUrl: null,
    interviewer: null,
    contactNote: null,
    interviewGoal: null,
    questionPlan: [{ id: 'q1', text: '请说明担当范围。', source: 'match' as const, sourceLabel: null, selected: true }],
    interviewNotes: null,
    unresolvedItems: [],
    decision: null,
    decisionReason: null,
    decidedAt: null,
    decidedBy: null,
    createdAt: '2026-09-10T00:00:00Z',
    updatedAt: '2026-09-10T00:00:00Z',
    updatedBy: 'HR',
    cloudEligible: false as const
  }
  records[0] = { ...row(0), progress: { ...row(0).progress!, stage: 'scheduled', rounds: [round] } }
  show()
  await screen.findByRole('article', { name: '跟进详情' })
  fireEvent.click(screen.getByRole('button', { name: /Java 案件 1/ }))
  fireEvent.click(detail().getByRole('button', { name: '面试问题' }))
  await detail().findByRole('article', { name: '问题 1' })
  fireEvent.click(detail().getByLabelText('采用'))
  fireEvent.click(detail().getByRole('button', { name: /保存本轮问题/ }))
  await waitFor(() =>
    expect(window.sesAgent.advanceBusinessProgress).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'prepare', roundNumber: 1, expectedRevision: 1 })
    )
  )
  fireEvent.click(detail().getByRole('button', { name: '反馈与 AI 整理' }))
  fireEvent.change(detail().getByLabelText('面试反馈或消息'), { target: { value: '客户反馈通过' } })
  await waitFor(() => expect(detail().getByRole('button', { name: '保存面试结果' })).toBeEnabled())
  expect(detail().queryByText(/其他操作更新了记录/)).not.toBeInTheDocument()
})
it('deletes one follow-up only after an explicit second confirmation and keeps the others', async () => {
  window.sesAgent.deleteBusinessFollowUp = vi.fn(async (input) => {
    records = records.filter((record) => record.id !== input.followUpId)
    return { deletedId: input.followUpId, rounds: 0, mails: 0 }
  })
  show()
  await screen.findByRole('article', { name: '跟进详情' })
  const first = detail().getByRole('heading', { level: 3 }).parentElement!.textContent
  openMenu()
  fireEvent.click(detail().getByRole('menuitem', { name: '删除这条跟进（误建或重复）…' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: '删除这条跟进' })).getByRole('button', { name: '取消' }))
  expect(window.sesAgent.deleteBusinessFollowUp).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  openMenu()
  fireEvent.click(detail().getByRole('menuitem', { name: '删除这条跟进（误建或重复）…' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: '删除这条跟进' })).getByRole('button', { name: '确认删除' }))
  await waitFor(() => expect(window.sesAgent.deleteBusinessFollowUp).toHaveBeenCalledWith({ followUpId: row(0).id, expectedRevision: 1 }))
  expect(await screen.findByText(/已删除这条跟进/)).toBeInTheDocument()
  await waitFor(() => expect(detail().getByRole('heading', { level: 3 }).parentElement!.textContent).not.toBe(first))
  expect(screen.queryByText('Java 案件 1')).not.toBeInTheDocument()
  expect(screen.getAllByText('Java 案件 2').length).toBeGreaterThan(0)
})
it('asks to undo arrival before a started follow-up can be deleted', async () => {
  records = [{ ...row(0), progress: { ...row(0).progress!, stage: 'started' } }]
  window.sesAgent.deleteBusinessFollowUp = vi.fn()
  show({ target: { documentId, reviewId: cases[0]!.reviewId } })
  await screen.findByRole('article', { name: '跟进详情' })
  openMenu()
  expect(detail().queryByRole('menuitem', { name: '结束跟进…' })).not.toBeInTheDocument()
  fireEvent.click(detail().getByRole('menuitem', { name: '删除这条跟进（误建或重复）…' }))
  const dialog = within(screen.getByRole('dialog', { name: '删除这条跟进' }))
  expect(dialog.getByText('此人员已进场。请先撤销进场，再删除这条跟进。')).toBeInTheDocument()
  expect(dialog.queryByRole('button', { name: '确认删除' })).not.toBeInTheDocument()
})
const openMenu = () => fireEvent.click(detail().getByRole('button', { name: '更多跟进操作' }))
const stopped = (stage: 'paused' | 'closed', reason: string) => (input: { reviewId: string; action: string }) => {
  const old = records.find((record) => record.reviewId === input.reviewId)!
  const updated: BusinessFollowUp = {
    ...old,
    revision: old.revision + 1,
    status: stage === 'closed' ? 'closed' : 'interview',
    progress: { ...old.progress!, stage },
    events: [
      ...old.events,
      {
        status: 'closed',
        note: `${stage === 'closed' ? '结束推进' : '暂停推进'}：${reason}`,
        nextStep: '',
        recordedAt: '2026-09-12T03:00:00Z',
        recordedBy: 'HR',
        action: input.action,
        stage
      }
    ]
  }
  records = records.map((record) => (record.id === old.id ? updated : record))
  return Promise.resolve(updated)
}
it('ends a 待约面 follow-up from the header menu on the schedule tab with a chosen reason', async () => {
  vi.mocked(window.sesAgent.advanceBusinessProgress).mockImplementation(((input: { reviewId: string; action: string; reason: string }) =>
    stopped('closed', input.reason)(input)) as never)
  show()
  await screen.findByRole('article', { name: '跟进详情' })
  expect(detail().getByRole('button', { name: '面试安排' })).toHaveAttribute('aria-pressed', 'true')
  expect(detail().getByRole('heading', { level: 3 }).parentElement!.textContent).toContain('待约面')
  openMenu()
  expect(detail().getByRole('menuitem', { name: '暂停跟进…' })).toBeVisible()
  expect(detail().queryByRole('menuitem', { name: '恢复跟进' })).not.toBeInTheDocument()
  fireEvent.click(detail().getByRole('menuitem', { name: '结束跟进…' }))
  const dialog = within(screen.getByRole('dialog', { name: '结束这条跟进' }))
  expect(dialog.getByText('测试人员 × Java 案件 1')).toBeInTheDocument()
  expect(dialog.getByRole('button', { name: '结束跟进' })).toBeDisabled()
  fireEvent.click(dialog.getByRole('button', { name: '客户不录用' }))
  fireEvent.change(dialog.getByLabelText('补充说明（可选）'), { target: { value: '技术面评价不足' } })
  fireEvent.click(dialog.getByRole('button', { name: '结束跟进' }))
  await waitFor(() =>
    expect(window.sesAgent.advanceBusinessProgress).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'close', reason: '客户不录用：技术面评价不足', reviewId: cases[0]!.reviewId })
    )
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(detail().getByRole('status', { name: '跟进状态' })).toHaveTextContent(/已结束 · 客户不录用：技术面评价不足 · 2026/)
  fireEvent.click(screen.getByRole('button', { name: /^全部/ }))
  expect(screen.getByRole('button', { name: /Java 案件 1/ })).toHaveTextContent('已结束')
})
it('requires a note for 其他 and closes the dialog on Esc without saving', async () => {
  show()
  await screen.findByRole('article', { name: '跟进详情' })
  openMenu()
  fireEvent.click(detail().getByRole('menuitem', { name: '结束跟进…' }))
  const dialog = within(screen.getByRole('dialog', { name: '结束这条跟进' }))
  fireEvent.click(dialog.getByRole('button', { name: '其他' }))
  expect(dialog.getByRole('button', { name: '结束跟进' })).toBeDisabled()
  fireEvent.change(dialog.getByLabelText('说明（必填）'), { target: { value: '   ' } })
  expect(dialog.getByRole('button', { name: '结束跟进' })).toBeDisabled()
  fireEvent.change(dialog.getByLabelText('说明（必填）'), { target: { value: '客户合并了岗位' } })
  expect(dialog.getByRole('button', { name: '结束跟进' })).toBeEnabled()
  fireEvent.keyDown(dialog.getByLabelText('说明（必填）'), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(window.sesAgent.advanceBusinessProgress).not.toHaveBeenCalled()
})
it('keeps the pause dialog open with the error when saving fails', async () => {
  vi.mocked(window.sesAgent.advanceBusinessProgress).mockRejectedValueOnce(new Error('写入失败'))
  show()
  await screen.findByRole('article', { name: '跟进详情' })
  openMenu()
  fireEvent.click(detail().getByRole('menuitem', { name: '暂停跟进…' }))
  const dialog = within(screen.getByRole('dialog', { name: '暂停这条跟进' }))
  fireEvent.click(dialog.getByRole('button', { name: '等待资料' }))
  fireEvent.click(dialog.getByRole('button', { name: '暂停跟进' }))
  expect(await dialog.findByRole('alert')).toBeInTheDocument()
  expect(window.sesAgent.advanceBusinessProgress).toHaveBeenCalledWith(expect.objectContaining({ action: 'pause', reason: '等待资料' }))
  expect(screen.getByRole('dialog', { name: '暂停这条跟进' })).toBeInTheDocument()
})
it('pauses from the menu and resumes from the status line', async () => {
  vi.mocked(window.sesAgent.advanceBusinessProgress).mockImplementation(((input: { reviewId: string; action: string; reason?: string }) => {
    if (input.action === 'pause') return stopped('paused', input.reason!)(input)
    const old = records.find((record) => record.reviewId === input.reviewId)!,
      updated = { ...old, revision: old.revision + 1, progress: { ...old.progress!, stage: 'coordinating' as const } }
    records = records.map((record) => (record.id === old.id ? updated : record))
    return Promise.resolve(updated)
  }) as never)
  show()
  await screen.findByRole('article', { name: '跟进详情' })
  openMenu()
  fireEvent.click(detail().getByRole('menuitem', { name: '暂停跟进…' }))
  const dialog = within(screen.getByRole('dialog', { name: '暂停这条跟进' }))
  fireEvent.click(dialog.getByRole('button', { name: '客户暂缓' }))
  fireEvent.click(dialog.getByRole('button', { name: '暂停跟进' }))
  await waitFor(() =>
    expect(window.sesAgent.advanceBusinessProgress).toHaveBeenCalledWith(expect.objectContaining({ action: 'pause', reason: '客户暂缓' }))
  )
  const status = await detail().findByRole('status', { name: '跟进状态' })
  expect(status).toHaveTextContent('已暂停 · 客户暂缓')
  openMenu()
  expect(detail().queryByRole('menuitem', { name: '暂停跟进…' })).not.toBeInTheDocument()
  expect(detail().getByRole('menuitem', { name: '恢复跟进' })).toBeVisible()
  openMenu()
  fireEvent.click(within(status).getByRole('button', { name: '恢复跟进' }))
  await waitFor(() =>
    expect(window.sesAgent.advanceBusinessProgress).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'resume' }))
  )
  await waitFor(() => expect(detail().queryByRole('status', { name: '跟进状态' })).not.toBeInTheDocument())
})
