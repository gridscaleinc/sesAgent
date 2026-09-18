import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import type { GmailSyncState } from '@shared'
import { GmailSyncFeedback } from './GmailSyncFeedback'

const state = { status: 'idle', lookbackDays: 30, lastError: null, lastRun: { mode: 'baseline', imported: 10, discovered: 10,
  duplicates: 0, filtered: 0, failed: 0, moreAvailable: true, intake: { casesCreated: 4, casesConfirmed: 3, casesNeedAttention: 1,
    casesFailed: 0, personnelCreated: 2, personnelFailed: 1, pendingCases: 0, pendingPersonnel: 5 } } } as GmailSyncState

it('distinguishes received messages from usable cases, people, failures, and outstanding work', () => {
  render(<GmailSyncFeedback state={state} zh />)
  expect(screen.getByText(/本批保存邮件 10 封/)).toBeInTheDocument()
  expect(screen.getByText(/新增有效案件 3 件、新增人员 2 名/)).toHaveTextContent('入库失败 1 项')
  expect(screen.getByText(/已收取待入库 5 封/)).toBeInTheDocument()
  expect(screen.getByText(/附件失败会自动重试/)).toBeInTheDocument()
})

it('shows actionable authentication errors even when an older successful timestamp exists', () => {
  render(<GmailSyncFeedback state={{ ...state, status: 'error', lastError: 'GOOGLE_REAUTH_REQUIRED', lastSyncedAt: '2026-09-10T00:00:00Z' }} zh />)
  expect(screen.getByRole('alert')).toHaveTextContent('请重新连接 Google 邮箱')
})

it('explains a failed first sync with no run and renders the Japanese flow', () => {
  render(<GmailSyncFeedback state={{ ...state, status: 'error', lastRun: null }} zh={false} />)
  expect(screen.getByRole('alert')).toHaveTextContent('今回のメール取得は未完了')
  expect(screen.getByText(/直近 30 日/)).toBeInTheDocument()
})

it('displays the configured cadence instead of promising the default interval', () => {
  render(<GmailSyncFeedback state={{ ...state, intervalMinutes: 7 }} zh />)
  expect(screen.getByText(/应用启动后自动检查/)).toHaveTextContent('约每 7 分钟收取一次')
})
