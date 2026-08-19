import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UiLocaleProvider } from '../i18n'
import { Sidebar } from './Sidebar'

describe('Sidebar interview navigation', () => {
  it('does not expose a global interview records menu entry', () => {
    render(<UiLocaleProvider locale="zh-CN"><Sidebar
      active="interview-workbench"
      candidateCount={0}
      candidateManagementCount={0}
      caseCount={0}
      clientInterviewCount={0}
      interviewDecisionCount={0}
      interviewScheduleCount={0}
      operatorProfile={{ configured: false, displayName: '本机用户', roleLabel: '未设置', operatorId: 'operator', revision: null, updatedAt: null, version: 'local-operator-profile-v1', cloudEligible: false }}
      reviewCount={0}
      taskCount={0}
      onCandidateManagement={vi.fn()}
      onCandidates={vi.fn()}
      onCaseImport={vi.fn()}
      onCases={vi.fn()}
      onClientInterviews={vi.fn()}
      onEntryPrep={vi.fn()}
      onGovernance={vi.fn()}
      onHome={vi.fn()}
      onInterviewSchedule={vi.fn()}
      onInterviewWorkbench={vi.fn()}
      onMatching={vi.fn()}
      onOperatorProfile={vi.fn()}
      onResumeImport={vi.fn()}
      onReviews={vi.fn()}
      onSettings={vi.fn()}
      onTasks={vi.fn()}
    /></UiLocaleProvider>)

    expect(screen.getByRole('button', { name: '招聘面试' })).toBeInTheDocument()
    expect(screen.queryByText('东京销售运营')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '面试记录' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '面談記録' })).not.toBeInTheDocument()
  })
})
