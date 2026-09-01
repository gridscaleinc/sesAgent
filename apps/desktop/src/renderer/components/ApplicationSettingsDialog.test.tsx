import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BootstrapPayload, LocalApplicationPreferences } from '@shared'
import { ApplicationSettingsDialog } from './ApplicationSettingsDialog'

const preferences: LocalApplicationPreferences = {
  version: 'local-application-preferences-v1',
  locale: 'ja-JP',
  configured: false,
  revision: null,
  updatedAt: null,
  cloudEligible: false
}

const bootstrap = {
  appVersion: '0.1.0',
  operatorProfile: {
    configured: false, displayName: '本機ユーザー', roleLabel: 'プロフィール未設定'
  },
  gmail: {
    status: 'not-connected', configuration: 'required', accountEmail: null
  },
  gmailSync: {
    configuration: 'required', lastSyncedAt: null
  },
  aiCommerce: {
    connection: 'not-connected', memberDisplayName: null, capabilities: []
  },
  privacy: {
    cloudGateway: 'enforced'
  },
  storage: {
    engine: 'sqlcipher-compatible', keyProtection: 'macos-keychain'
  }
} as unknown as BootstrapPayload

const integrationProps = {
  bootstrap,
  onConnectGoogleWorkspace: vi.fn(),
  onDisconnectGoogleWorkspace: vi.fn(),
  onOpenAiCommerce: vi.fn(),
  onOpenDataSecurity: vi.fn(),
  onOpenGoogleWorkspace: vi.fn(),
  onOpenOperatorProfile: vi.fn(),
  onSyncGoogleWorkspace: vi.fn()
}

describe('ApplicationSettingsDialog', () => {
  it('saves only the selected local display locale with an optimistic revision', async () => {
    const onSave = vi.fn().mockResolvedValue({
      ...preferences,
      locale: 'zh-CN',
      configured: true,
      revision: 1,
      updatedAt: '2026-07-21T00:00:00.000Z'
    })
    render(<ApplicationSettingsDialog {...integrationProps} onClose={vi.fn()} onSave={onSave} preferences={preferences} />)

    expect(screen.getByText(/外部システムへ送信されません/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /中文（简体）/ }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ locale: 'zh-CN', expectedRevision: null }))
  })

  it('does not write when the selected locale is already active', () => {
    const onSave = vi.fn()
    render(<ApplicationSettingsDialog {...integrationProps} onClose={vi.fn()} onSave={onSave} preferences={preferences} />)
    fireEvent.click(screen.getByRole('radio', { name: /日本語/ }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps every external connection under the integrations section', () => {
    render(<ApplicationSettingsDialog {...integrationProps} initialSection="integrations" onClose={vi.fn()} onSave={vi.fn()} preferences={preferences} />)
    expect(screen.getByRole('heading', { name: '外部システム' })).toBeInTheDocument()
    expect(screen.getByText('Google Workspace')).toBeInTheDocument()
    expect(screen.getByText('AICommerce Cloud AI')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '接続設定' })).toBeInTheDocument()
  })

  it('saves partner labels as aliases of the built-in case fields with an optimistic revision', async () => {
    const onSaveFieldAliases = vi.fn().mockResolvedValue({
      version: 'job-case-field-aliases-v1', aliases: { rate: ['単金', '金額'] }, configured: true, revision: 1, updatedAt: '2026-08-26T00:00:00.000Z'
    })
    render(<ApplicationSettingsDialog {...integrationProps} onClose={vi.fn()} onSave={vi.fn()} onSaveFieldAliases={onSaveFieldAliases} preferences={preferences} />)

    fireEvent.click(screen.getByRole('button', { name: /案件項目/ }))
    expect(screen.getByRole('heading', { name: '案件項目の別名' })).toBeInTheDocument()
    const saveButton = screen.getByRole('button', { name: '別名を保存' })
    expect(saveButton).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '単価の別名' }), { target: { value: '単金、金額' } })
    expect(saveButton).toBeEnabled()
    fireEvent.click(saveButton)

    await waitFor(() => expect(onSaveFieldAliases).toHaveBeenCalledWith({ aliases: { rate: ['単金', '金額'] }, expectedRevision: null }))
    expect(await screen.findByText('保存しました')).toBeInTheDocument()
  })
})
