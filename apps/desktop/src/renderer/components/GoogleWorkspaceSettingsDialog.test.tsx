import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GoogleWorkspaceAdminConfiguration } from '@shared'
import { GoogleWorkspaceSettingsDialog } from './GoogleWorkspaceSettingsDialog'

const configuration: GoogleWorkspaceAdminConfiguration = {
  version: 'google-workspace-admin-config-v1',
  source: 'local-admin',
  editable: true,
  clientId: '1234567890-abcdefghijklmnop.apps.googleusercontent.com',
  workspaceDomain: 'company.co.jp',
  labelIds: ['INBOX', 'Label_SES'],
  query: '案件 OR 要員',
  lookbackDays: 30,
  maxMessagesPerRun: 200,
  revision: 2,
  configuredBy: 'ローカル管理者',
  updatedAt: '2026-07-20T05:00:00.000Z'
}

describe('GoogleWorkspaceSettingsDialog', () => {
  it('collects only the read-only desktop OAuth and bounded sync configuration', async () => {
    const onSave = vi.fn().mockResolvedValue({ configuration, restarting: true })
    render(<GoogleWorkspaceSettingsDialog configuration={null} connected={false} onClose={vi.fn()} onSave={onSave} />)
    expect(screen.getByText(/gmail\.readonly のみ/)).toBeInTheDocument()
    expect(screen.getByText(/Client Secret、パスワード、Token は入力しません/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Desktop OAuth Client ID'), {
      target: { value: configuration.clientId }
    })
    fireEvent.change(screen.getByLabelText('会社 Workspace ドメイン'), {
      target: { value: 'Company.CO.JP' }
    })
    fireEvent.change(screen.getByLabelText('Gmail Label ID'), {
      target: { value: 'INBOX, Label_SES' }
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /読取専用接続であることを確認した/ }))
    fireEvent.click(screen.getByRole('button', { name: '設定を保存して再起動' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      clientId: configuration.clientId,
      workspaceDomain: 'company.co.jp',
      labelIds: ['INBOX', 'Label_SES'],
      query: '案件 OR 要員',
      lookbackDays: 30,
      maxMessagesPerRun: 200,
      expectedRevision: null,
      readonlyAcknowledged: true
    }))
    expect(await screen.findByText('設定を暗号化保存しました')).toBeInTheDocument()
  })

  it('shows managed environment settings as read-only', () => {
    render(<GoogleWorkspaceSettingsDialog
      configuration={{ ...configuration, source: 'managed-environment', editable: false, revision: null, configuredBy: '受管環境設定' }}
      connected={false}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />)
    expect(screen.getByText('会社の受管環境設定')).toBeInTheDocument()
    expect(screen.getByLabelText('Desktop OAuth Client ID')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /設定を更新/ })).not.toBeInTheDocument()
  })

  it('requires disconnecting the account before configuration changes', () => {
    render(<GoogleWorkspaceSettingsDialog configuration={configuration} connected onClose={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByText(/現在の Google Workspace 接続を解除/)).toBeInTheDocument()
    expect(screen.getByLabelText('Desktop OAuth Client ID')).toBeDisabled()
    expect(screen.getByRole('button', { name: '設定を更新して再起動' })).toBeDisabled()
  })
})
