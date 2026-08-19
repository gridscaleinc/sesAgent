import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RecoveryPackageSummary, StartupStatus } from '@shared'
import { StartupRecoveryScreen } from './StartupRecoveryScreen'

const status: Extract<StartupStatus, { mode: 'recovery-required' }> = {
  mode: 'recovery-required',
  reason: 'local-storage-unavailable',
  activeDataPreserved: true,
  networkAccess: false,
  message: '暗号化されたローカルデータを現在の OS 保護鍵で開けません。元データは変更せず保持しています。'
}

const summary: RecoveryPackageSummary = {
  version: 'ses-recovery-v1',
  backupId: '16e2a4d9-bd69-4d64-9dad-a9f6d238f8c1',
  createdAt: '2026-07-19T10:15:00.000Z',
  sourcePlatform: 'darwin',
  sourceArch: 'arm64',
  schemaVersion: 20,
  databaseBytes: 8192,
  vaultObjectCount: 2,
  vaultBytes: 4096,
  totalBytes: 12288,
  googleWorkspaceCredentialIncluded: false,
  cloudDataIncluded: false
}

function handlers() {
  return {
    onPreviewRecovery: vi.fn().mockResolvedValue({
      cancelled: false,
      restoreToken: 'b2a56ae6-da51-4cb5-a82c-0fd350558e72',
      confirmationHash: 'b'.repeat(64),
      expiresAt: '2026-07-19T10:25:00.000Z',
      summary,
      warnings: ['Google Workspace の認証情報は復元されません。']
    }),
    onConfirmRecovery: vi.fn().mockResolvedValue({ scheduled: true, restartRequired: true }),
    onRestart: vi.fn().mockResolvedValue({ restarting: true })
  }
}

describe('StartupRecoveryScreen', () => {
  it('keeps the inaccessible data untouched and verifies a package locally', async () => {
    const callbacks = handlers()
    render(<StartupRecoveryScreen status={status} {...callbacks} />)
    expect(screen.getByText('元データは未変更')).toBeInTheDocument()
    expect(screen.getByText('ネットワーク送信なし')).toBeInTheDocument()
    const verify = screen.getByRole('button', { name: 'パッケージを選択して検証' })
    expect(verify).toBeDisabled()
    fireEvent.change(screen.getByLabelText('復元パスワード'), { target: { value: 'correct horse battery staple' } })
    fireEvent.click(verify)
    await waitFor(() => expect(callbacks.onPreviewRecovery).toHaveBeenCalledWith({
      password: 'correct horse battery staple'
    }))
    expect(await screen.findByText('パッケージの認証と内容検証が完了しました')).toBeInTheDocument()
    expect(screen.getByText('v20')).toBeInTheDocument()
    expect(screen.getByText('2件')).toBeInTheDocument()
  })

  it('requires the explicit confirmation phrase before scheduling restore', async () => {
    const callbacks = handlers()
    render(<StartupRecoveryScreen status={status} {...callbacks} />)
    fireEvent.change(screen.getByLabelText('復元パスワード'), { target: { value: 'correct horse battery staple' } })
    fireEvent.click(screen.getByRole('button', { name: 'パッケージを選択して検証' }))
    const confirm = await screen.findByRole('button', { name: '確認して復元' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('確認のため「復元」と入力'), { target: { value: '復元' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(callbacks.onConfirmRecovery).toHaveBeenCalledWith({
      restoreToken: 'b2a56ae6-da51-4cb5-a82c-0fd350558e72',
      confirmationHash: 'b'.repeat(64),
      confirmationText: '復元'
    }))
    expect(await screen.findByRole('button', { name: '安全に再起動しています…' })).toBeDisabled()
  })
})
