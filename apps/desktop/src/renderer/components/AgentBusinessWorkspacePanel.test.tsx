import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  it('routes 案件配信 to the broadcast queue and withholds it without the actions', async () => {
    const actions = {
      loadWorkspace: vi.fn().mockResolvedValue({ queue: [], templates: [] }),
      draftBroadcast: vi.fn(),
      draftUpdateNotice: vi.fn(),
      recordCopy: vi.fn(),
      listBroadcasts: vi.fn()
    }
    renderPanel({ type: 'system-access', destination: 'broadcast' }, { broadcastActions: actions })
    await waitFor(() => expect(actions.loadWorkspace).toHaveBeenCalledTimes(1))
    expect(screen.getByText('还没有可配信的案件')).toBeInTheDocument()

    cleanup()
    renderPanel({ type: 'system-access', destination: 'broadcast' })
    expect(screen.getByText('案件配信在此环境中不可用')).toBeInTheDocument()
  })

  it('offers 配信 straight from a confirmed case in the case list', () => {
    const props = renderPanel({ type: 'system-access', destination: 'job-cases' })
    fireEvent.click(screen.getByRole('button', { name: '配信' }))
    expect(props.onOpenAccess).toHaveBeenCalledWith({
      type: 'system-access', destination: 'broadcast', reviewId: jobCase.reviewId
    })
  })

  it('offers a way back to the previous screen whenever there is one', () => {
    const onBack = vi.fn()
    const props = renderPanel({ type: 'system-access', destination: 'case-review', reviewId: jobCase.reviewId }, { onBack })
    fireEvent.click(screen.getByRole('button', { name: '返回上一级' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('lets the operator edit a valid case in place: reopen, then confirm the edited values', async () => {
    const onReopenJobCaseReview = vi.fn().mockResolvedValue({ review: { ...jobCase, status: 'awaiting-review', reviewRevision: 2 } })
    const onSubmitJobCaseReview = vi.fn().mockResolvedValue({ review: jobCase })
    renderPanel({ type: 'system-access', destination: 'case-review', reviewId: jobCase.reviewId }, { onReopenJobCaseReview, onSubmitJobCaseReview })

    expect(screen.getByText('有效')).toBeInTheDocument()
    const save = screen.getByRole('button', { name: '保存修改' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '案件名' }), { target: { value: 'Java 案件（改）' } })
    fireEvent.click(save)

    await waitFor(() => expect(onSubmitJobCaseReview).toHaveBeenCalledTimes(1))
    expect(onReopenJobCaseReview).toHaveBeenCalledWith({ reviewId: jobCase.reviewId, reason: '右侧工作区直接修改' })
    expect(onSubmitJobCaseReview).toHaveBeenCalledWith({
      reviewId: jobCase.reviewId, reviewRevision: 2, privacyReviewed: true,
      fields: [{ key: 'title', value: 'Java 案件（改）', confirmed: true, changeReason: '右侧工作区直接修改' }]
    })
  })

  it('shows no back control on the first screen', () => {
    renderPanel({ type: 'system-access', destination: 'job-cases' })
    expect(screen.queryByRole('button', { name: '返回上一级' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭右侧工作区' })).toBeInTheDocument()
  })

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

  it('narrows the review center to the drafts one paste produced and confirms a row as it stands', async () => {
    const awaiting: JobCaseReviewSnapshot = {
      ...jobCase, reviewId: '55555555-5555-4555-8555-555555555555', status: 'awaiting-review', privacyReviewed: false,
      completedAt: null, reviewerDisplayName: null, jobCase: null,
      fields: [
        { key: 'title', label: '案件名', originalValue: 'PHP 案件', value: 'PHP 案件', confidence: 0.8, status: 'needs_review', sourceLabels: [], changed: false, changeReason: null },
        { key: 'rate', label: '単価', originalValue: '55万円', value: '55万円', confidence: 0.8, status: 'needs_review', sourceLabels: [], changed: false, changeReason: null }
      ]
    }
    const untitled: JobCaseReviewSnapshot = {
      ...awaiting, reviewId: '66666666-6666-4666-8666-666666666666',
      fields: [{ ...awaiting.fields[0]!, originalValue: null, value: null, status: 'missing' }]
    }
    const onSubmitJobCaseReview = vi.fn().mockResolvedValue({ review: { ...awaiting, status: 'completed' } })
    const props = renderPanel(
      { type: 'system-access', destination: 'review-center', intakeBatchId: '77777777-7777-4777-8777-777777777777', reviewIds: [awaiting.reviewId, untitled.reviewId, jobCase.reviewId] },
      { jobCaseReviews: [jobCase, awaiting, untitled], onSubmitJobCaseReview }
    )

    expect(screen.getByText('审核中心 · 本次导入')).toBeInTheDocument()
    expect(screen.getByText('PHP 案件')).toBeInTheDocument()
    const quickConfirmButtons = screen.getAllByRole('button', { name: '快速确认' })
    expect(quickConfirmButtons).toHaveLength(2)
    // A draft without a title cannot be confirmed as it stands.
    expect(quickConfirmButtons[1]).toBeDisabled()
    fireEvent.click(quickConfirmButtons[0]!)
    await waitFor(() => expect(onSubmitJobCaseReview).toHaveBeenCalledTimes(1))
    expect(onSubmitJobCaseReview).toHaveBeenCalledWith({
      reviewId: awaiting.reviewId, reviewRevision: 1, privacyReviewed: true,
      fields: [{ key: 'title', value: 'PHP 案件', confirmed: true }, { key: 'rate', value: '55万円', confirmed: true }]
    })
    fireEvent.click(screen.getByRole('button', { name: '打开匹配' }))
    expect(props.onOpenAccess).toHaveBeenCalledWith({ type: 'system-access', destination: 'matching', jobCaseId: jobCase.jobCase!.id })
  })

  it('creates a manual case in the panel and continues to its right-side review', async () => {
    const onCreateManualCase = vi.fn().mockResolvedValue({ review: jobCase })
    const props = renderPanel({ type: 'system-access', destination: 'case-import' }, { onCreateManualCase })

    fireEvent.change(screen.getByLabelText('案件标题'), { target: { value: 'Java 案件' } })
    fireEvent.change(screen.getByLabelText('案件内容'), { target: { value: '需要 Java 和 AWS' } })
    fireEvent.click(screen.getByRole('button', { name: '创建案件' }))

    await waitFor(() => expect(onCreateManualCase).toHaveBeenCalledWith({ subject: 'Java 案件', body: '需要 Java 和 AWS' }))
    expect(props.onOpenAccess).toHaveBeenCalledWith({
      type: 'system-access', destination: 'case-review', reviewId: jobCase.reviewId
    })
  })

  it('lazily loads the redacted source mail on a gmail case and masks PII placeholders', async () => {
    const gmailReview: JobCaseReviewSnapshot = {
      ...jobCase,
      reviewId: '88888888-8888-4888-8888-888888888888',
      sourceType: 'gmail',
      providerMessageId: 'msg-0001',
      fromDomain: 'partner.example.co.jp'
    }
    const onLoadJobCaseSourceText = vi.fn().mockResolvedValue({
      sourceType: 'gmail' as const,
      redactedSubject: 'Java 案件のご紹介',
      redactedBody: '担当: <PERSON_NAME_001>\n連絡先: <PHONE_001>\n単価: 70万円\n<UNKNOWN_KIND_001>',
      messageDate: '2026-08-24T00:00:00.000Z',
      fromDomain: 'partner.example.co.jp'
    })
    renderPanel(
      { type: 'system-access', destination: 'case-review', reviewId: gmailReview.reviewId },
      { jobCaseReviews: [gmailReview], onLoadJobCaseSourceText }
    )

    const summary = screen.getByText('来源原文（本机已脱敏）')
    expect(onLoadJobCaseSourceText).not.toHaveBeenCalled()
    const details = summary.closest('details') as HTMLDetailsElement
    details.open = true
    fireEvent(details, new Event('toggle'))

    expect(onLoadJobCaseSourceText).toHaveBeenCalledWith(gmailReview.reviewId)
    const body = await screen.findByText(/〔人名·已遮蔽〕/)
    expect(body.textContent).toContain('〔电话·已遮蔽〕')
    expect(body.textContent).toContain('〔已遮蔽〕')
    expect(body.textContent).not.toContain('<PERSON_NAME_001>')
    expect(body.textContent).not.toContain('<PHONE_001>')
    expect(screen.getByText('partner.example.co.jp')).toBeInTheDocument()
  })

  it('shows no source-mail section for a manually entered case', () => {
    renderPanel(
      { type: 'system-access', destination: 'case-review', reviewId: jobCase.reviewId },
      { onLoadJobCaseSourceText: vi.fn() }
    )
    expect(screen.queryByText('来源原文（本机已脱敏）')).not.toBeInTheDocument()
  })
})
