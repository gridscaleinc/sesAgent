import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CandidateReviewSnapshot, JobCaseReviewSnapshot, MatchingHomeProjection } from '@shared'
import { UiLocaleProvider } from '../i18n'
import { AgentBusinessWorkspacePanel } from './AgentBusinessWorkspacePanel'

const documentId = '11111111-1111-4111-8111-111111111111'

const candidate: CandidateReviewSnapshot = {
  documentId,
  fileName: 'candidate.pdf',
  reviewRevision: 1,
  status: 'completed',
  piiReviewed: true,
  localIdentity: {
    displayName: '张伟', gender: null, birthDate: null, nationality: null, phone: null, email: null,
    address: null, education: null, major: null, graduationDate: null, degree: null,
    storage: 'encrypted-local-only', cloudEligible: false
  },
  fields: [
    { key: 'skills', label: '技能', originalValue: 'Java', value: 'Java', confidence: 1, status: 'confirmed', sourceLabels: ['Sheet1!A1'], changed: false, changeReason: null },
    { key: 'role', label: '角色', originalValue: 'SE', value: 'SE', confidence: 1, status: 'confirmed', sourceLabels: ['Sheet1!A2'], changed: false, changeReason: null }
  ],
  projectExperiences: [],
  completedAt: '2026-08-20T00:00:00.000Z',
  reviewerDisplayName: 'SES',
  profile: { id: '22222222-2222-4222-8222-222222222222', sourceDocumentId: documentId, version: 1, status: 'current', confirmedAt: '2026-08-20T00:00:00.000Z', confirmedBy: 'SES', containsDirectIdentifiers: true },
  recruitingStatus: 'ready-for-recruiting',
  talentPoolStatus: 'none',
  recordStatus: 'active'
}

const jobCase: JobCaseReviewSnapshot = {
  reviewId: '33333333-3333-4333-8333-333333333333', sourceId: 'manual-1', sourceType: 'manual',
  providerMessageId: null, threadId: 'manual-1', fromDomain: null, messageDate: '2026-08-24T00:00:00.000Z',
  redactedSubject: 'Java 案件', redactedPreview: 'Java / AWS', reviewRevision: 1, status: 'completed', privacyReviewed: true,
  fields: [{ key: 'title', label: '案件名', originalValue: 'Java 案件', value: 'Java 案件', confidence: 1, status: 'confirmed', sourceLabels: [], changed: false, changeReason: null }],
  warningCodes: [], completedAt: '2026-08-24T00:00:00.000Z', reviewerDisplayName: 'SES',
  jobCase: { id: '44444444-4444-4444-8444-444444444444', sourceReviewId: '33333333-3333-4333-8333-333333333333', version: 1, status: 'active', confirmedAt: '2026-08-24T00:00:00.000Z', confirmedBy: 'SES', containsDirectIdentifiers: false },
  lifecycle: 'active', cloudEligible: false
}

const matchingHome: MatchingHomeProjection = {
  state: 'ready-to-run', eligibleCandidateCount: 0, selectedJobCaseId: jobCase.jobCase!.id,
  jobCases: [{ id: jobCase.jobCase!.id, version: 1, title: 'Java 案件', validity: 'not_run', lastRunCreatedAt: null }],
  currentRun: null
}

function renderPanel(
  access: Parameters<typeof AgentBusinessWorkspacePanel>[0]['access'],
  overrides: Partial<Parameters<typeof AgentBusinessWorkspacePanel>[0]> = {}
) {
  const props: Parameters<typeof AgentBusinessWorkspacePanel>[0] = {
    access,
    candidateReviews: [candidate], interviews: [], jobCaseReviews: [jobCase], matchingHome,
    reviewQueue: [], tasks: [], onClose: vi.fn(), onOpenAccess: vi.fn(),
    onCreateManualCase: vi.fn(), onLoadOriginalDocument: vi.fn(), onResolveActionApproval: vi.fn(),
    ...overrides
  }
  render(<UiLocaleProvider locale="zh-CN"><AgentBusinessWorkspacePanel {...props} /></UiLocaleProvider>)
  return props
}

describe('AgentBusinessWorkspacePanel', () => {
  it('keeps candidate navigation inside the right workspace and marks it as conversation context', () => {
    const props = renderPanel({ type: 'system-access', destination: 'candidate-management' })

    expect(screen.getByText('已接入对话上下文')).toBeInTheDocument()
    expect(screen.getByText(/发送下一条消息时，Agent 会读取此工作区/u)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /张伟/u }))
    expect(props.onOpenAccess).toHaveBeenCalledWith({
      type: 'system-access', destination: 'candidate', sourceDocumentId: documentId, view: 'overview'
    })
  })

  it('opens the original resume as another right-workspace destination', () => {
    const props = renderPanel({ type: 'system-access', destination: 'candidate', sourceDocumentId: documentId, view: 'resume' })

    fireEvent.click(screen.getByRole('button', { name: '在右侧查看原始简历' }))
    expect(props.onOpenAccess).toHaveBeenCalledWith({
      type: 'system-access', destination: 'original-document', sourceDocumentId: documentId
    })
  })

  it('creates a manual case in the panel and continues to its right-side review', async () => {
    const onCreateManualCase = vi.fn().mockResolvedValue({ review: jobCase })
    const props = renderPanel({ type: 'system-access', destination: 'case-import' }, { onCreateManualCase })

    fireEvent.change(screen.getByLabelText('案件标题'), { target: { value: 'Java 案件' } })
    fireEvent.change(screen.getByLabelText('案件内容'), { target: { value: '需要 Java 和 AWS' } })
    fireEvent.click(screen.getByRole('button', { name: '生成待审核案件' }))

    await waitFor(() => expect(onCreateManualCase).toHaveBeenCalledWith({ subject: 'Java 案件', body: '需要 Java 和 AWS' }))
    expect(props.onOpenAccess).toHaveBeenCalledWith({
      type: 'system-access', destination: 'case-review', reviewId: jobCase.reviewId
    })
  })
})
