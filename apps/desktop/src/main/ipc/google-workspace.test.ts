import { beforeEach, expect, it, vi } from 'vitest'
import { registerGoogleWorkspaceHandlers } from './google-workspace'
import { createJobCaseDraftsForPendingGmailMessages } from '../gmail-job-case-intake'
import { importPendingGmailPersonnel } from '../gmail-personnel-intake'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, app: {}, net: { fetch: vi.fn() } }))
vi.mock('../gmail-job-case-intake', () => ({ createJobCaseDraftsForPendingGmailMessages: vi.fn() }))
vi.mock('../gmail-personnel-intake', () => ({ importPendingGmailPersonnel: vi.fn() }))
vi.mock('@mail', async original => ({ ...await original<typeof import('@mail')>(),
  GmailReadClient: class {}, GmailSyncCoordinator: class { async synchronize() { return { errorCode: null } } } }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(createJobCaseDraftsForPendingGmailMessages).mockReturnValue({ created: 1, confirmed: 1, needsAttention: 0, failed: 0 })
  vi.mocked(importPendingGmailPersonnel).mockResolvedValue({ personnel: 2, failed: 0 })
})

function setup(status = 'idle', lastError: string | null = null) {
  const checkpoint: any = { status, lastError, historyId: '100', lastSyncedAt: '2026-09-11T00:00:00Z',
    lastRun: { mode: 'baseline', discovered: 3, imported: 3, duplicates: 0, filtered: 0, failed: status === 'error' ? 1 : 0 } }
  const repository = {
    updateActionRun: vi.fn(), getGmailSyncCheckpoint: () => checkpoint,
    countGmailMessages: () => 3, getJobCaseFieldAliases: () => null,
    getGmailPersonnelIntakeStatus: () => ({ failed: 0, warnings: 0 }),
    saveGmailIntakeResult: vi.fn((_account, counts) => { checkpoint.lastRun.intake = { ...counts, pendingCases: 0, pendingPersonnel: 0 } })
  }
  const context = { repository, localNer: null, googleWorkspace: { getState: async () => ({ status: 'readonly', accountEmail: 'hr@example.com' }) },
    gmailSyncConfig: { version: 'gmail-sync-config-v1', labelIds: ['INBOX'], query: '案件 OR 要員', lookbackDays: 30, maxMessagesPerRun: 200 },
    currentOperator: () => ({ operatorId: 'op', displayName: 'HR' }), preflightAction: vi.fn((..._args: unknown[]) => 'action1') }
  return { ...registerGoogleWorkspaceHandlers(context as any), repository, context }
}

it('persists separate business intake counts and completes a successful action', async () => {
  const h = setup()
  expect(await h.startGmailSync()).toMatchObject({ status: 'idle', lastRun: { intake: { casesConfirmed: 1, personnelCreated: 2 } } })
  expect(h.repository.saveGmailIntakeResult).toHaveBeenCalledWith('hr@example.com', expect.objectContaining({ casesCreated: 1, personnelCreated: 2 }))
  expect(h.repository.updateActionRun).toHaveBeenLastCalledWith('action1', 'succeeded', expect.any(Object))
  expect(h.context.preflightAction.mock.calls[0]?.[0]).toBe('gmail.sync.read')
})

it('does not report a failed receive checkpoint as a successful action', async () => {
  const h = setup('error', 'MESSAGE_PROCESSING_FAILED')
  await h.startGmailSync()
  expect(h.repository.updateActionRun).toHaveBeenLastCalledWith('action1', 'failed', { errorCode: 'MESSAGE_PROCESSING_FAILED' })
})

it.each(['case', 'personnel'])('marks %s intake failure even when receiving succeeded', async kind => {
  if (kind === 'case') vi.mocked(createJobCaseDraftsForPendingGmailMessages).mockReturnValue({ created: 0, confirmed: 0, needsAttention: 0, failed: 1 })
  else vi.mocked(importPendingGmailPersonnel).mockResolvedValue({ personnel: 0, failed: 1 })
  const h = setup(); await h.startGmailSync()
  expect(h.repository.updateActionRun).toHaveBeenLastCalledWith('action1', 'failed', { errorCode: 'GMAIL_INTAKE_FAILED' })
})
