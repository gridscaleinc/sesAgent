import { fireEvent, render, screen } from '@testing-library/react'
import { createWorkTaskPreview, materializeWorkTask } from '@application'
import type { ProposalDraftSnapshot, ProposalWorkspaceSnapshot } from '@shared'
import { ProposalWorkbench } from './ProposalWorkbench'

const task = materializeWorkTask(
  createWorkTaskPreview('確認済み案件と候補者から提案メール下書きを作成したい'),
  'proposal-task-001',
  '2026-07-17T00:00:00.000Z'
)

const draft: ProposalDraftSnapshot = {
  schemaVersion: 'proposal-draft-v1',
  id: 'a86b564b-34ad-4632-927e-47db14c56aaf',
  taskId: task.id,
  jobCaseId: '38dca6f6-947b-45d5-98bc-c9e6dcd242e9',
  jobCaseVersion: 1,
  candidateProfileId: '8055be48-a08f-499d-9d82-c95a36018ad9',
  candidateProfileVersion: 1,
  recipientTo: 'bp@example.co.jp',
  recipientCc: [],
  candidateDisplayName: '候補者A',
  subject: '【人材ご提案】決済基盤刷新 / 候補者A',
  body: 'いつもお世話になっております。\n\n候補者Aをご提案いたします。\n\nよろしくお願いいたします。',
  attachment: {
    fileName: 'candidate-8055be48-profile.pdf',
    mimeType: 'application/pdf',
    redacted: true,
    sourceDocumentIncluded: false,
    anonymousCandidateLabel: '候補者 8055BE48',
    fields: [{ key: 'skills', label: 'スキル', value: 'Java / AWS', sourceLabels: ['Page 1'] }],
    projectExperiences: [{
      title: '決済基盤クラウド刷新',
      period: '2024/01–2025/06',
      role: 'バックエンドリード',
      technologies: ['Java', 'AWS'],
      summary: '決済APIの再設計とクラウド移行を担当。'
    }],
    contentHash: 'a'.repeat(64)
  },
  tone: 'standard',
  status: 'awaiting_review',
  revision: 1,
  contentHash: 'b'.repeat(64),
  approvedContentHash: null,
  approvedAt: null,
  approvedBy: null,
  exportedAt: null,
  exportPackageHash: null,
  followUp: { revision: 0, stage: null, events: [], cloudEligible: false },
  generation: {
    mode: 'deterministic-local-v1',
    cloudUsed: false,
    rawResumeUsed: false,
    rawMailUsed: false,
    recipientAndDisplayNameCloudEligible: false
  },
  createdAt: '2026-07-17T00:00:00.000Z',
  updatedAt: '2026-07-17T00:00:00.000Z'
}

const options: ProposalWorkspaceSnapshot['options'] = {
  jobCases: [{
    id: draft.jobCaseId,
    reviewId: 'ee6b5a0f-ecc2-4f6c-8f71-5f6e89f0fd09',
    version: 1,
    title: '決済基盤刷新',
    role: 'バックエンド',
    requiredSkills: 'Java / AWS',
    rate: '90万円/月',
    fields: [{ key: 'title', label: '案件名', value: '決済基盤刷新', sourceLabels: ['Manual Subject'] }]
  }],
  candidates: [{
    id: draft.candidateProfileId,
    version: 1,
    anonymousLabel: '候補者 8055BE48',
    skills: 'Java / AWS',
    experienceYears: '8年',
    availability: '8月',
    rate: '80万円/月',
    japaneseLevel: 'N1',
    workStyle: 'リモート可',
    role: 'バックエンド',
    fields: [{ key: 'skills', label: 'スキル', value: 'Java / AWS', sourceLabels: ['Page 1'] }],
    projectExperiences: [{
      id: 'edbb8a75-19cc-4c4d-8d87-4b8c9eed69e2', title: '決済基盤クラウド刷新',
      period: '2024/01–2025/06', role: 'バックエンドリード', technologies: ['Java', 'AWS'],
      summary: '決済APIの再設計とクラウド移行を担当。', sourceLabels: ['Page 2']
    }]
  }]
}

const evidence: ProposalWorkspaceSnapshot['evidence'] = [{
  draftId: draft.id,
  jobCase: options.jobCases[0]!,
  candidate: options.candidates[0]!
}]

const defaultProps = {
  taskId: task.id,
  status: 'ready' as const,
  error: null,
  onCreate: vi.fn(),
  onUpdate: vi.fn(),
  onApprove: vi.fn(),
  onExport: vi.fn(),
  onRecordFollowUp: vi.fn()
}

describe('ProposalWorkbench', () => {
  it('creates a draft only from confirmed options and explains the local-only identity boundary', () => {
    const onCreate = vi.fn().mockResolvedValue({ draft, task })
    render(<ProposalWorkbench {...defaultProps} onCreate={onCreate} workspace={{ options, drafts: [], evidence: [] }} />)

    expect(screen.getByText(/クラウド・原文メール・原本履歴書は参照しません/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '提案の宛先' }), { target: { value: 'bp@example.co.jp' } })
    fireEvent.click(screen.getByRole('button', { name: 'ローカルで提案草稿を生成' }))

    expect(onCreate).toHaveBeenCalledWith({
      taskId: task.id,
      jobCaseId: draft.jobCaseId,
      candidateProfileId: draft.candidateProfileId,
      recipientTo: 'bp@example.co.jp',
      recipientCc: [],
      candidateDisplayName: '候補者A',
      tone: 'standard'
    })
  })

  it('binds approval to recipient, body, attachment and privacy confirmations', () => {
    const onApprove = vi.fn().mockResolvedValue({ draft: { ...draft, status: 'approved', approvedContentHash: draft.contentHash }, task })
    render(<ProposalWorkbench {...defaultProps} onApprove={onApprove} workspace={{ options, drafts: [draft], evidence }} />)

    expect(screen.getAllByText('決済基盤クラウド刷新').length).toBeGreaterThan(0)

    const approve = screen.getByRole('button', { name: 'この内容ハッシュを承認' })
    expect(approve).toBeDisabled()
    for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox)
    expect(approve).toBeEnabled()
    fireEvent.click(approve)

    expect(onApprove).toHaveBeenCalledWith({
      draftId: draft.id,
      revision: 1,
      contentHash: draft.contentHash,
      approvals: { recipient: true, body: true, attachment: true, privacy: true }
    })
  })

  it('exports approved content as exported-not-sent', async () => {
    const approved = { ...draft, status: 'approved' as const, approvedContentHash: draft.contentHash, approvedAt: '2026-07-17T00:01:00.000Z', approvedBy: '山田 太郎' }
    const onExport = vi.fn().mockResolvedValue({
      draft: { ...approved, status: 'exported' },
      task,
      cancelled: false,
      export: { fileName: 'proposal.zip', packageHash: 'c'.repeat(64), exportedAt: '2026-07-17T00:02:00.000Z', deliveryState: 'exported-not-sent' }
    })
    render(<ProposalWorkbench {...defaultProps} onExport={onExport} workspace={{ options, drafts: [approved], evidence: [{ ...evidence[0]!, draftId: approved.id }] }} />)

    fireEvent.click(screen.getByRole('button', { name: '承認済みパッケージを書き出す' }))
    expect(onExport).toHaveBeenCalledWith({ draftId: draft.id, revision: 1, contentHash: draft.contentHash })
    expect(await screen.findByText(/送信済みにはしていません/)).toBeInTheDocument()
  })

  it('records externally confirmed delivery without using Gmail write permissions', () => {
    const exported: ProposalDraftSnapshot = {
      ...draft,
      status: 'exported',
      approvedContentHash: draft.contentHash,
      approvedAt: '2026-07-17T00:01:00.000Z',
      approvedBy: '営業担当',
      exportedAt: '2026-07-17T00:02:00.000Z',
      exportPackageHash: 'c'.repeat(64)
    }
    const onRecordFollowUp = vi.fn().mockResolvedValue({
      draft: {
        ...exported,
        followUp: {
          revision: 1,
          stage: 'sent',
          events: [{
            id: '5cac741a-205c-4c3b-a1d0-2ef90be74475', draftId: draft.id, revision: 1,
            stage: 'sent', occurredOn: '2026-07-20', note: '翌営業日に状況確認',
            recordedBy: '営業担当', recordedAt: '2026-07-20T01:00:00.000Z', cloudEligible: false
          }],
          cloudEligible: false
        }
      },
      task
    })
    render(<ProposalWorkbench {...defaultProps} onRecordFollowUp={onRecordFollowUp} workspace={{ options, drafts: [exported], evidence: [{ ...evidence[0]!, draftId: exported.id }] }} />)

    expect(screen.getByText('手動記録 · Google Workspaceへの書込なし')).toBeInTheDocument()
    expect(screen.queryByText(/書き出しただけでは送信済みになりません/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('提案後の発生・予定日'), { target: { value: '2026-07-20' } })
    fireEvent.change(screen.getByLabelText('提案後の営業メモ'), { target: { value: '翌営業日に状況確認' } })
    fireEvent.click(screen.getByLabelText(/アプリ外で事実を確認しました/))
    fireEvent.click(screen.getByRole('button', { name: '営業結果を記録' }))

    expect(onRecordFollowUp).toHaveBeenCalledWith({
      draftId: draft.id,
      expectedRevision: 0,
      stage: 'sent',
      occurredOn: '2026-07-20',
      note: '翌営業日に状況確認',
      manuallyConfirmed: true
    })
  })

  it('freezes sent content and shows an append-only local sales timeline', () => {
    const sentDraft: ProposalDraftSnapshot = {
      ...draft,
      status: 'exported',
      approvedContentHash: draft.contentHash,
      approvedAt: '2026-07-17T00:01:00.000Z',
      approvedBy: '営業担当',
      exportedAt: '2026-07-17T00:02:00.000Z',
      exportPackageHash: 'c'.repeat(64),
      followUp: {
        revision: 1,
        stage: 'sent',
        events: [{
          id: '5cac741a-205c-4c3b-a1d0-2ef90be74475', draftId: draft.id, revision: 1,
          stage: 'sent', occurredOn: '2026-07-20', note: '翌営業日に状況確認',
          recordedBy: '営業担当', recordedAt: '2026-07-20T01:00:00.000Z', cloudEligible: false
        }],
        cloudEligible: false
      }
    }
    render(<ProposalWorkbench {...defaultProps} workspace={{ options, drafts: [sentDraft], evidence: [{ ...evidence[0]!, draftId: sentDraft.id }] }} />)

    expect(screen.getByText('送信後履歴あり · 内容固定')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '提案件名' })).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: '承認済みパッケージを書き出す' })).toBeDisabled()
    expect(screen.getByRole('list', { name: '営業結果の履歴' })).toHaveTextContent('翌営業日に状況確認')
    expect(screen.getByRole('combobox', { name: '提案後の状態' })).not.toHaveTextContent('アプリ外で送信済み')
  })
})
