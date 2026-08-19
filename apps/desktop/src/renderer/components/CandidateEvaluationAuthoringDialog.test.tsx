import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CandidateEvaluationAuthoringWorkspace } from '@shared'
import { CandidateEvaluationAuthoringDialog } from './CandidateEvaluationAuthoringDialog'

const jobCaseId = 'f3f40996-8f25-4ae4-9e44-4a1056a46334'
const profileId = '1f6dde32-9b9f-448f-8f6f-9d3411fe56d0'
const draftId = '4d6f299a-8ea9-493e-869e-369bcbba7086'
const caseId = '850c3a75-0a15-4919-8269-04d6e9012cc6'

const workspace: CandidateEvaluationAuthoringWorkspace = {
  draft: {
    id: draftId,
    name: 'Tokyo SES Expert Pilot',
    revision: 2,
    caseCount: 1,
    readyCaseCount: 1,
    reviewerCount: 1,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:01:00.000Z',
    cases: [{
      id: caseId,
      jobCaseId,
      jobCaseVersion: 1,
      jobCaseTitle: '決済基盤 Java 案件',
      query: 'required_skills: Java AWS | role: PL',
      poolReviewed: true,
      reviewerDisplayName: '検証担当者',
      reviewedAt: '2026-07-20T00:01:00.000Z',
      status: 'ready',
      relevantCandidates: [{
        profileId,
        profileVersion: 1,
        anonymousLabel: '候補者 1F6DDE32',
        expectedProjectEvidence: true,
        status: 'active'
      }]
    }]
  },
  jobCases: [{
    id: jobCaseId,
    version: 1,
    title: '決済基盤 Java 案件',
    query: 'required_skills: Java AWS | role: PL'
  }],
  candidates: [{
    id: profileId,
    version: 1,
    anonymousLabel: '候補者 1F6DDE32',
    skills: 'Java, AWS',
    experienceYears: '7年',
    availability: '即日',
    rate: '85万円/月',
    japaneseLevel: 'N1',
    workStyle: '週3リモート',
    role: 'PL',
    projectExperienceCount: 2
  }]
}

describe('CandidateEvaluationAuthoringDialog', () => {
  it('saves an all-pool expert label and runs the local partial evaluation', async () => {
    const onSaveCase = vi.fn().mockResolvedValue(workspace)
    const onEvaluate = vi.fn().mockResolvedValue({
      workspace,
      state: { dataset: null, latestReport: null }
    })
    render(<CandidateEvaluationAuthoringDialog
      loading={false}
      onClose={vi.fn()}
      onCreateDraft={vi.fn()}
      onDeleteCase={vi.fn()}
      onEvaluate={onEvaluate}
      onSaveCase={onSaveCase}
      onWorkspaceChange={vi.fn()}
      workspace={workspace}
    />)

    expect(screen.getByRole('dialog', { name: '専門家ラベルセットを作成' })).toBeInTheDocument()
    expect(screen.getByText('Cloud送信なし · 原文なし · Query Hashのみ報告保存')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('確認済み案件'), { target: { value: jobCaseId } })
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /候補者 1F6DDE32/ })).toBeChecked())
    expect(screen.getByRole('checkbox', { name: /Active候補者 1件を母集団として確認した/ })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '案件ラベルを暗号化保存' }))
    await waitFor(() => expect(onSaveCase).toHaveBeenCalledWith({
      draftId,
      expectedRevision: 2,
      jobCaseId,
      relevantCandidateProfileIds: [profileId],
      expectedProjectEvidenceProfileIds: [profileId],
      poolReviewed: true
    }))

    fireEvent.click(screen.getByRole('button', { name: '現在の 1 ケースを端末内評価' }))
    await waitFor(() => expect(onEvaluate).toHaveBeenCalledWith({ draftId, expectedRevision: 2 }))
  })

  it('creates the encrypted local draft before labels are added', async () => {
    const emptyWorkspace: CandidateEvaluationAuthoringWorkspace = { ...workspace, draft: null }
    const onCreateDraft = vi.fn().mockResolvedValue(workspace)
    render(<CandidateEvaluationAuthoringDialog
      loading={false}
      onClose={vi.fn()}
      onCreateDraft={onCreateDraft}
      onDeleteCase={vi.fn()}
      onEvaluate={vi.fn()}
      onSaveCase={vi.fn()}
      onWorkspaceChange={vi.fn()}
      workspace={emptyWorkspace}
    />)
    fireEvent.change(screen.getByLabelText('評価セット名'), { target: { value: 'Tokyo SES Pilot v1' } })
    fireEvent.click(screen.getByRole('button', { name: '暗号化草稿を作成' }))
    await waitFor(() => expect(onCreateDraft).toHaveBeenCalledWith({ name: 'Tokyo SES Pilot v1' }))
  })
})
