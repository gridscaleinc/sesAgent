import { fireEvent, render, screen } from '@testing-library/react'
import { createSampleTasks } from '@application'
import type { WorkTask } from '@domain'
import type { ActionApprovalSummary, CandidateReviewSnapshot, JobCaseReviewSnapshot } from '@shared'
import { describe, expect, it, vi } from 'vitest'
import { buildReviewQueue, ReviewCenter } from './ReviewCenter'

const now = '2026-07-20T01:00:00.000Z'

function createFixtures() {
  const sampleTasks = createSampleTasks(now)
  const importTask: WorkTask = {
    ...sampleTasks[0]!,
    id: 'task-import-001',
    type: 'IMPORT_RESUME',
    typeLabel: 'スキルシート取込',
    status: 'awaiting_review',
    contextBindings: [{ objectType: 'staged-file', objectId: 'document-001', version: '1' }]
  }
  const proposalTask: WorkTask = {
    ...sampleTasks[1]!,
    id: 'task-proposal-001',
    type: 'GENERATE_PROPOSAL',
    typeLabel: '提案下書き',
    status: 'awaiting_review',
    updatedAt: '2026-07-20T00:30:00.000Z'
  }
  const candidateReview: CandidateReviewSnapshot = {
    documentId: 'document-001',
    fileName: 'private-name.xlsx',
    reviewRevision: 1,
    status: 'awaiting-review',
    piiReviewed: false,
    fields: [{
      key: 'skills', label: 'スキル', originalValue: 'Java', value: 'Java', confidence: 0.9,
      status: 'needs_review', sourceLabels: ['Skills!A2'], changed: false, changeReason: null
    }],
    projectExperiences: [],
    completedAt: null,
    reviewerDisplayName: null,
    profile: null,
    recruitingStatus: 'pending-review',
    talentPoolStatus: 'none',
    recordStatus: 'active'
  }
  const jobCaseReview: JobCaseReviewSnapshot = {
    reviewId: 'review-case-001',
    sourceId: 'source-001',
    sourceType: 'gmail',
    providerMessageId: 'provider-001',
    threadId: 'thread-001',
    fromDomain: 'partner.example.jp',
    messageDate: '2026-07-20T00:45:00.000Z',
    redactedSubject: 'Java 基盤刷新案件 <PERSON_NAME_001>',
    redactedPreview: '一覧には表示しない本文',
    reviewRevision: 1,
    status: 'awaiting-review',
    privacyReviewed: false,
    fields: [],
    warningCodes: ['SOURCE_CONTAINS_PII_PLACEHOLDERS'],
    completedAt: null,
    reviewerDisplayName: null,
    jobCase: null,
    lifecycle: 'active',
    cloudEligible: false
  }
  return { tasks: [importTask, proposalTask], candidateReview, jobCaseReview }
}

describe('ReviewCenter', () => {
  it('builds one actionable item per human decision without duplicating an import container', () => {
    const { tasks, candidateReview, jobCaseReview } = createFixtures()
    const queue = buildReviewQueue(tasks, [candidateReview], [jobCaseReview])

    expect(queue).toHaveLength(3)
    expect(queue.map((item) => item.id)).toEqual([
      'candidate:document-001',
      'case:review-case-001',
      'task:task-proposal-001'
    ])
    expect(queue.some((item) => item.id === 'task:task-import-001')).toBe(false)
    expect(queue.find((item) => item.kind === 'candidate')).not.toHaveProperty('fileName')
  })

  it('filters the local queue and opens the exact task, candidate task, and case review', () => {
    const { tasks, candidateReview, jobCaseReview } = createFixtures()
    const items = buildReviewQueue(tasks, [candidateReview], [jobCaseReview])
    const onOpenTask = vi.fn()
    const onOpenCandidate = vi.fn()
    const onOpenCase = vi.fn()
    render(
      <ReviewCenter
        items={items}
        onOpenCandidate={onOpenCandidate}
        onOpenCase={onOpenCase}
        onOpenTask={onOpenTask}
      />
    )

    expect(screen.getByRole('heading', { name: 'レビューセンター' })).toBeInTheDocument()
    expect(screen.queryByText('private-name.xlsx')).not.toBeInTheDocument()
    expect(screen.queryByText('一覧には表示しない本文')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '候補者プロフィールを確認の詳細を開く' }))
    expect(onOpenCandidate).toHaveBeenCalledWith('document-001', 'task-import-001')
    fireEvent.click(screen.getByRole('button', { name: 'Java 基盤刷新案件 <PERSON_NAME_001>の詳細を開く' }))
    expect(onOpenCase).toHaveBeenCalledWith('review-case-001')
    fireEvent.click(screen.getByRole('button', { name: '提案下書きの詳細を開く' }))
    expect(onOpenTask).toHaveBeenCalledWith('task-proposal-001')

    fireEvent.click(screen.getByRole('button', { name: /候補者$/ }))
    expect(screen.getByRole('button', { name: '候補者プロフィールを確認の詳細を開く' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '提案下書きの詳細を開く' })).not.toBeInTheDocument()
  })

  it('merges a redacted action approval without duplicating domain review items', () => {
    const { tasks, candidateReview, jobCaseReview } = createFixtures()
    const approval: ActionApprovalSummary = {
      id: 'approval-001', actionRunId: 'action-001', toolName: 'proposal.export', workTaskId: 'task-proposal-001',
      status: 'pending', reason: '外部副作用を伴うため確認が必要です。', safeSummary: '承認済み提案を保存確認へ進めます。',
      inputHash: 'a'.repeat(64), contentRevision: '1', expiresAt: '2026-07-21T00:00:00.000Z',
      createdAt: '2026-07-20T01:00:00.000Z', resolvedAt: null
    }
    const resolve = vi.fn()
    const items = buildReviewQueue(tasks, [candidateReview], [jobCaseReview], [approval])
    expect(items.filter((item) => item.kind === 'action-approval')).toHaveLength(1)
    render(<ReviewCenter items={items} onOpenCandidate={vi.fn()} onOpenCase={vi.fn()} onOpenTask={vi.fn()} onResolveActionApproval={resolve} />)
    expect(screen.getByText('承認済み提案を保存確認へ進めます。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '承認' }))
    expect(resolve).toHaveBeenCalledWith('approval-001', 'approve')
  })
})
