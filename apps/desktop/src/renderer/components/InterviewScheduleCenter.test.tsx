import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CandidateInterviewSnapshot, CandidateReviewSnapshot } from '@shared'
import { UiLocaleProvider } from '../i18n'
import { InterviewScheduleCenter } from './InterviewScheduleCenter'

beforeEach(() => { Object.defineProperty(window, 'sesAgent', { configurable:true, value:{ listBusinessFollowUps:vi.fn(async()=>[]) } }) })

const review = (documentId: string, name: string): CandidateReviewSnapshot => ({
  documentId,
  fileName: `${name}.xlsx`,
  reviewRevision: 1,
  status: 'completed',
  piiReviewed: true,
  localIdentity: {
    displayName: name, gender: null, birthDate: null, nationality: null, phone: null, email: null,
    address: null, education: null, major: null, graduationDate: null, degree: null,
    storage: 'encrypted-local-only', cloudEligible: false
  },
  fields: [
    { key: 'role', label: '角色', originalValue: 'Java 工程师', value: 'Java 工程师', confidence: 1, status: 'confirmed', sourceLabels: [], changed: false, changeReason: null },
    { key: 'skills', label: '技能', originalValue: 'Java, AWS', value: 'Java, AWS', confidence: 1, status: 'confirmed', sourceLabels: [], changed: false, changeReason: null }
  ],
  projectExperiences: [],
  completedAt: '2026-07-20T00:00:00.000Z',
  reviewerDisplayName: '李娜',
  profile: null,
  recruitingStatus: 'recruiting',
  talentPoolStatus: 'none',
  recordStatus: 'active'
})

const interview = ({
  id,
  sourceDocumentId,
  kind,
  ...input
}: Partial<CandidateInterviewSnapshot> & Pick<CandidateInterviewSnapshot, 'id' | 'sourceDocumentId' | 'kind'>): CandidateInterviewSnapshot => ({
  id,
  sourceDocumentId,
  kind,
  roundNumber: input.roundNumber ?? 1,
  parentInterviewId: null,
  stage: input.stage ?? 'prepared',
  scheduledAt: input.scheduledAt ?? '2026-07-20T01:00:00.000Z',
  durationMinutes: input.durationMinutes ?? 60,
  meetingMethod: input.meetingMethod ?? 'zoom',
  meetingUrl: 'https://company.zoom.us/j/1234567890',
  interviewer: input.interviewer ?? '李娜',
  contactNote: null,
  interviewGoal: null,
  questionPlan: input.questionPlan ?? [],
  interviewNotes: null,
  unresolvedItems: [],
  decision: null,
  decisionReason: null,
  decidedAt: null,
  decidedBy: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
  updatedBy: '李娜',
  cloudEligible: false,
  ...input
})

const zhang = '11111111-1111-4111-8111-111111111111'
const li = '22222222-2222-4222-822222222222'
const wang = '33333333-3333-4333-8333-333333333333'
const chen = '44444444-4444-4444-8444-444444444444'

describe('InterviewScheduleCenter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-22T03:00:00.000Z'))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('opens as a neutral weekly aggregate instead of selecting a first candidate', () => {
    render(<UiLocaleProvider locale="zh-CN"><InterviewScheduleCenter interviews={[interview({ id: 'a1', sourceDocumentId: zhang, kind: 'recruiting' })]} onOpenInterview={vi.fn()} reviews={[review(zhang, '张伟')]} /></UiLocaleProvider>)

    expect(screen.getByRole('main', { name: '面试日程中心' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '张伟 招聘初面' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '张伟' })).not.toBeInTheDocument()
  })

  it('aggregates recruiting, client and unscheduled work, flags interviewer conflicts, and routes the exact session', () => {
    const onOpenInterview = vi.fn()
    const unscheduledReview: CandidateReviewSnapshot = { ...review(chen, '陈宁'), status: 'awaiting-review', piiReviewed: false, completedAt: null, reviewerDisplayName: null }
    const reviews = [review(zhang, '张伟'), review(li, '李明'), review(wang, '王洁'), unscheduledReview]
    const interviews = [
      interview({ id: 'a1', sourceDocumentId: zhang, kind: 'recruiting', stage: 'prepared', scheduledAt: '2026-07-20T01:00:00.000Z', interviewer: '李娜' }),
      interview({ id: 'b1', sourceDocumentId: li, kind: 'client', stage: 'awaiting-decision', scheduledAt: '2026-07-21T04:00:00.000Z', interviewer: '王经理' }),
      interview({ id: 'c1', sourceDocumentId: wang, kind: 'recruiting', stage: 'scheduled', scheduledAt: '2026-07-20T01:30:00.000Z', interviewer: '李娜' })
    ]
    render(<UiLocaleProvider locale="zh-CN"><InterviewScheduleCenter interviews={interviews} onOpenInterview={onOpenInterview} reviews={reviews} /></UiLocaleProvider>)

    expect(screen.getAllByText('时间冲突').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: '全部面试' }))
    expect(screen.getAllByText('待预约').length).toBeGreaterThan(1)
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('待预约')
    expect(screen.getByText('陈宁')).toBeInTheDocument()
    expect(screen.getByText('客户面试 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '进入面试' }))
    expect(onOpenInterview).toHaveBeenCalledWith({
      sourceDocumentId: zhang,
      interviewId: 'a1',
      kind: 'recruiting',
      view: 'workbench'
    })
  })

  it('keeps late evening interviews on their Tokyo hour and opens a finished recruiting record', () => {
    const onOpenInterview = vi.fn()
    const finished = interview({
      id: 'late-finished',
      sourceDocumentId: zhang,
      kind: 'recruiting',
      stage: 'passed',
      scheduledAt: '2026-07-22T12:00:00.000Z',
      decision: 'passed',
      decisionReason: '通过'
    })
    render(<UiLocaleProvider locale="zh-CN"><InterviewScheduleCenter interviews={[finished]} onOpenInterview={onOpenInterview} reviews={[review(zhang, '张伟')]} /></UiLocaleProvider>)

    expect(screen.getAllByText('21:00').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: '全部面试' }))
    fireEvent.click(screen.getByRole('button', { name: '查看记录' }))
    expect(onOpenInterview).toHaveBeenCalledWith(expect.objectContaining({ interviewId: 'late-finished', view: 'workbench' }))
  })

  it('filters the aggregate without changing the route source', () => {
    const onOpenInterview = vi.fn()
    const reviews = [review(zhang, '张伟'), review(li, '李明')]
    const interviews = [
      interview({ id: 'a1', sourceDocumentId: zhang, kind: 'recruiting' }),
      interview({ id: 'b1', sourceDocumentId: li, kind: 'client', stage: 'scheduled', interviewer: '王经理' })
    ]
    render(<UiLocaleProvider locale="zh-CN"><InterviewScheduleCenter interviews={interviews} onOpenInterview={onOpenInterview} reviews={reviews} /></UiLocaleProvider>)

    fireEvent.click(screen.getByRole('tab', { name: '全部面试' }))
    fireEvent.change(screen.getByLabelText('面试类型'), { target: { value: 'client' } })
    expect(screen.getByText('李明')).toBeInTheDocument()
    expect(screen.queryByText('张伟')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '准备问题' }))
    expect(onOpenInterview).toHaveBeenCalledWith({
      sourceDocumentId: li,
      interviewId: 'b1',
      kind: 'client',
      view: 'prepare'
    })
  })
})
