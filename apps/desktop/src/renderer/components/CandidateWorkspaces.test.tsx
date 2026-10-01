import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CandidateInterviewSnapshot, CandidateReviewSnapshot } from '@shared'
import { UiLocaleProvider } from '../i18n'
import { RecruitingInterviewWorkspace } from './CandidateWorkspaces'

function makeReview(
  documentId: string,
  name: string,
  status: CandidateReviewSnapshot['status'],
  profileStatus?: NonNullable<CandidateReviewSnapshot['profile']>['status']
): CandidateReviewSnapshot {
  return {
    documentId,
    fileName: `${name}.xlsx`,
    reviewRevision: 1,
    status,
    piiReviewed: status === 'completed',
    localIdentity: {
      displayName: name,
      gender: null,
      birthDate: null,
      nationality: null,
      phone: null,
      email: null,
      address: null,
      education: null,
      major: null,
      graduationDate: null,
      degree: null,
      storage: 'encrypted-local-only',
      cloudEligible: false
    },
    fields: [
      {
        key: 'role',
        label: '角色',
        originalValue: 'Java工程师',
        value: 'Java工程师',
        confidence: 1,
        status: 'confirmed',
        sourceLabels: [],
        changed: false,
        changeReason: null
      },
      {
        key: 'skills',
        label: '技能',
        originalValue: 'Java, AWS',
        value: 'Java, AWS',
        confidence: 1,
        status: 'confirmed',
        sourceLabels: [],
        changed: false,
        changeReason: null
      },
      {
        key: 'experience_years',
        label: '经验',
        originalValue: '6年',
        value: '6年',
        confidence: 1,
        status: 'confirmed',
        sourceLabels: [],
        changed: false,
        changeReason: null
      },
      {
        key: 'location',
        label: '所在地',
        originalValue: '东京',
        value: '东京',
        confidence: 1,
        status: 'confirmed',
        sourceLabels: [],
        changed: false,
        changeReason: null
      },
      {
        key: 'availability',
        label: '可入场',
        originalValue: null,
        value: null,
        confidence: 0,
        status: 'missing',
        sourceLabels: [],
        changed: false,
        changeReason: null
      },
      {
        key: 'rate',
        label: '单价',
        originalValue: null,
        value: null,
        confidence: 0,
        status: 'missing',
        sourceLabels: [],
        changed: false,
        changeReason: null
      },
      {
        key: 'japanese_level',
        label: '日语',
        originalValue: 'N2',
        value: 'N2',
        confidence: 1,
        status: 'confirmed',
        sourceLabels: [],
        changed: false,
        changeReason: null
      },
      {
        key: 'work_style',
        label: '工作方式',
        originalValue: null,
        value: null,
        confidence: 0,
        status: 'missing',
        sourceLabels: [],
        changed: false,
        changeReason: null
      },
      {
        key: 'work_authorization',
        label: '工作资格',
        originalValue: null,
        value: null,
        confidence: 0,
        status: 'missing',
        sourceLabels: [],
        changed: false,
        changeReason: null
      }
    ],
    projectExperiences: [],
    completedAt: status === 'completed' ? '2026-07-21T00:00:00.000Z' : null,
    reviewerDisplayName: status === 'completed' ? '李娜' : null,
    profile: profileStatus
      ? {
          id: `profile-${documentId}`,
          sourceDocumentId: documentId,
          version: 1,
          status: profileStatus,
          confirmedAt: '2026-07-21T00:00:00.000Z',
          confirmedBy: '李娜',
          containsDirectIdentifiers: true
        }
      : null,
    recruitingStatus: status === 'awaiting-review' ? 'pending-review' : profileStatus ? 'passed' : 'ready-for-recruiting',
    talentPoolStatus: profileStatus ? 'eligible' : 'none',
    recordStatus: 'active'
  }
}

function makeInterview(
  documentId: string,
  kind: CandidateInterviewSnapshot['kind'],
  stage: CandidateInterviewSnapshot['stage']
): CandidateInterviewSnapshot {
  return {
    id: `${kind}-${documentId}`,
    sourceDocumentId: documentId,
    kind,
    roundNumber: 1,
    parentInterviewId: null,
    stage,
    scheduledAt: '2026-07-24T01:00:00.000Z',
    durationMinutes: 60,
    meetingMethod: 'zoom',
    meetingUrl: 'https://company.zoom.us/j/1234567890',
    interviewer: '李娜',
    contactNote: kind === 'client' ? '支付平台案件' : null,
    interviewGoal: null,
    questionPlan: [],
    interviewNotes: null,
    unresolvedItems: [],
    decision: null,
    decisionReason: null,
    decidedAt: null,
    decidedBy: null,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    updatedBy: '李娜',
    cloudEligible: false
  }
}

const reviewPending = makeReview('11111111-1111-4111-8111-111111111111', '张伟', 'awaiting-review')
const reviewTalent = makeReview('22222222-2222-4222-8222-222222222222', '李磊', 'completed', 'current')

describe('separated candidate workspaces', () => {
  it('keeps the recruiting queue limited to candidates who still need internal hiring work', () => {
    render(
      <UiLocaleProvider locale="zh-CN">
        <RecruitingInterviewWorkspace
          interviews={[]}
          onImportResume={vi.fn()}
          onOpenCandidate={vi.fn()}
          reviews={[reviewPending, reviewTalent]}
        />
      </UiLocaleProvider>
    )

    expect(screen.getByRole('heading', { name: '招聘面试' })).toBeInTheDocument()
    expect(screen.getByText('招聘面试中的人员（1）')).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getByText('张伟')).toBeInTheDocument()
    expect(within(table).queryByText('李磊')).not.toBeInTheDocument()
  })

  it('drops people already in the matching pool, placed, or archived even if their resume review was never completed', () => {
    const placed = {
      ...makeReview('33333333-3333-4333-8333-333333333333', '林浩', 'awaiting-review'),
      talentPoolStatus: 'suspended' as const
    }
    const pooled = {
      ...makeReview('44444444-4444-4444-8444-444444444444', '王芳', 'awaiting-review'),
      talentPoolStatus: 'eligible' as const
    }
    const archived = {
      ...makeReview('55555555-5555-4555-8555-555555555555', '赵敏', 'awaiting-review'),
      recordStatus: 'archived' as const
    }
    render(
      <UiLocaleProvider locale="zh-CN">
        <RecruitingInterviewWorkspace
          interviews={[]}
          onImportResume={vi.fn()}
          onOpenCandidate={vi.fn()}
          reviews={[reviewPending, placed, pooled, archived]}
        />
      </UiLocaleProvider>
    )

    expect(screen.getByText('招聘面试中的人员（1）')).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getByText('张伟')).toBeInTheDocument()
    for (const name of ['林浩', '王芳', '赵敏']) expect(within(table).queryByText(name)).not.toBeInTheDocument()
  })

  it('leaves out someone paused or in place by their business status', async () => {
    const paused = makeReview('66666666-6666-4666-8666-666666666666', '孙悦', 'awaiting-review')
    const original = window.sesAgent
    Object.defineProperty(window, 'sesAgent', {
      configurable: true,
      value: {
        ...original,
        getPersonnelWorkspace: vi.fn(async () => ({
          templates: [],
          copies: [],
          states: [
            { documentId: paused.documentId, profileVersion: 1, status: 'paused', confirmedAt: '2026-09-01T00:00:00Z', actorId: 'hr' }
          ]
        }))
      }
    })
    try {
      render(
        <UiLocaleProvider locale="zh-CN">
          <RecruitingInterviewWorkspace
            interviews={[]}
            onImportResume={vi.fn()}
            onOpenCandidate={vi.fn()}
            reviews={[reviewPending, paused]}
          />
        </UiLocaleProvider>
      )
      expect(await screen.findByText('招聘面试中的人员（1）')).toBeInTheDocument()
      expect(within(screen.getByRole('table')).queryByText('孙悦')).not.toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'sesAgent', { configurable: true, value: original })
    }
  })

  it('keeps a recruiting interview detail route alongside the distinct next action', () => {
    const onOpenCandidate = vi.fn()
    const interview = makeInterview(reviewPending.documentId, 'recruiting', 'scheduled')
    render(
      <UiLocaleProvider locale="zh-CN">
        <RecruitingInterviewWorkspace
          interviews={[interview]}
          onImportResume={vi.fn()}
          onOpenCandidate={onOpenCandidate}
          reviews={[reviewPending]}
        />
      </UiLocaleProvider>
    )

    const table = screen.getByRole('table')
    fireEvent.click(within(table).getByRole('button', { name: '面试详情' }))
    expect(onOpenCandidate).toHaveBeenLastCalledWith(reviewPending.documentId, 'overview', interview.id, 'recruiting')
    fireEvent.click(within(table).getByRole('button', { name: '准备问题' }))
    expect(onOpenCandidate).toHaveBeenLastCalledWith(reviewPending.documentId, 'prepare', interview.id, 'recruiting')
  })
})
