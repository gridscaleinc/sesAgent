import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSystemAccessBlock, CandidateInterviewSnapshot, CandidateReviewSnapshot } from '@shared'
import { UiLocaleProvider } from '../i18n'
import { AgentInterviewSchedulePanel } from './AgentInterviewSchedulePanel'

const sourceDocumentId = '11111111-1111-4111-8111-111111111111'

const review: CandidateReviewSnapshot = {
  documentId: sourceDocumentId,
  fileName: '张伟.xlsx',
  reviewRevision: 1,
  status: 'completed',
  piiReviewed: true,
  localIdentity: {
    displayName: '张伟', gender: null, birthDate: null, nationality: null, phone: null, email: null,
    address: null, education: null, major: null, graduationDate: null, degree: null,
    storage: 'encrypted-local-only', cloudEligible: false
  },
  fields: [],
  projectExperiences: [],
  completedAt: '2026-08-20T00:00:00.000Z',
  reviewerDisplayName: '李娜',
  profile: null,
  recruitingStatus: 'recruiting',
  talentPoolStatus: 'none',
  recordStatus: 'active'
}

const interview: CandidateInterviewSnapshot = {
  id: '22222222-2222-4222-8222-222222222222',
  sourceDocumentId,
  kind: 'recruiting',
  roundNumber: 1,
  parentInterviewId: null,
  stage: 'scheduled',
  scheduledAt: '2026-08-26T05:00:00.000Z',
  durationMinutes: 50,
  meetingMethod: 'zoom',
  meetingUrl: 'https://company.zoom.us/j/private',
  interviewer: '李娜',
  contactNote: '确认技术经历',
  interviewGoal: null,
  questionPlan: [],
  interviewNotes: null,
  unresolvedItems: [],
  decision: null,
  decisionReason: null,
  decidedAt: null,
  decidedBy: null,
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T00:00:00.000Z',
  updatedBy: '李娜',
  cloudEligible: false
}

const access: Extract<AgentSystemAccessBlock, { destination: 'interview-schedule' }> = {
  type: 'system-access',
  destination: 'interview-schedule',
  receipt: {
    sourceDocumentId,
    candidateLabel: 'RESUME_1',
    scheduledAt: interview.scheduledAt!,
    durationMinutes: interview.durationMinutes,
    meetingMethod: interview.meetingMethod,
    kind: interview.kind,
    meetingLinkStoredLocally: true
  }
}

describe('AgentInterviewSchedulePanel', () => {
  it('focuses the authoritative local interview without exposing its meeting URL', () => {
    const onClose = vi.fn()
    render(<UiLocaleProvider locale="zh-CN"><AgentInterviewSchedulePanel
      access={access}
      interviews={[interview]}
      onClose={onClose}
      onSave={vi.fn()}
      reviews={[review]}
    /></UiLocaleProvider>)

    expect(screen.getByRole('region', { name: '面试日程工作区' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /张伟 2026\/08\/26 14:00/u })).toBeInTheDocument()
    expect(screen.getByText('2026/08/26 14:00 JST')).toBeInTheDocument()
    expect(screen.getByText('已在本机保存')).toBeInTheDocument()
    expect(screen.queryByText(interview.meetingUrl!)).not.toBeInTheDocument()

    expect(screen.getByText('已接入对话上下文')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '在完整页面打开' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭右侧工作区' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('saves a schedule edit through the existing authoritative interview API', async () => {
    const onSave = vi.fn().mockImplementation(async (input) => ({
      ...interview,
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes,
      interviewer: input.interviewer,
      contactNote: input.contactNote ?? null,
      updatedAt: '2026-08-24T01:00:00.000Z'
    }))
    render(<UiLocaleProvider locale="zh-CN"><AgentInterviewSchedulePanel
      access={access}
      interviews={[interview]}
      onClose={vi.fn()}
      onSave={onSave}
      reviews={[review]}
    /></UiLocaleProvider>)

    fireEvent.click(screen.getByRole('button', { name: '修改面试' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: '时长（分钟）' }), { target: { value: '55' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      interviewId: interview.id,
      sourceDocumentId,
      scheduledAt: '2026-08-26T05:00:00.000Z',
      durationMinutes: 55,
      meetingMethod: 'zoom',
      meetingUrl: interview.meetingUrl,
      interviewer: '李娜'
    }))
  })
})
