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
    configured: false,
    displayName: '本機ユーザー',
    roleLabel: 'プロフィール未設定'
  },
  gmail: {
    status: 'not-connected',
    configuration: 'required',
    accountEmail: null
  },
  gmailSync: {
    configuration: 'required',
    lastSyncedAt: null
  },
  aiCommerce: {
    connection: 'not-connected',
    memberDisplayName: null,
    capabilities: []
  },
  privacy: {
    cloudGateway: 'enforced'
  },
  storage: {
    engine: 'sqlcipher-compatible',
    keyProtection: 'macos-keychain'
  }
} as unknown as BootstrapPayload

const integrationProps = {
  bootstrap,
  onConnectGoogleWorkspace: vi.fn(),
  onDisconnectGoogleWorkspace: vi.fn(),
  onOpenAiCommerce: vi.fn(),
  onOpenDataSecurity: vi.fn(),
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

  it('shows the menu-bar icon and hides person names by default, and saves each switch with the current revision', async () => {
    const saved = { ...preferences, configured: true, revision: 4, updatedAt: '2026-09-30T00:00:00.000Z' }
    const onSave = vi.fn().mockResolvedValue(saved)
    const { rerender } = render(<ApplicationSettingsDialog {...integrationProps} onClose={vi.fn()} onSave={onSave} preferences={saved} />)
    const visible = screen.getByRole('checkbox', { name: /メニューバーに SES Agent を表示/u })
    const names = screen.getByRole('checkbox', { name: /メニューバーのパネルに要員の氏名を表示/u })
    expect(visible).toBeChecked()
    expect(names).not.toBeChecked()
    fireEvent.click(names)
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ locale: 'ja-JP', expectedRevision: 4, menuBar: { visible: true, showPersonNames: true } })
    )
    rerender(
      <ApplicationSettingsDialog
        {...integrationProps}
        onClose={vi.fn()}
        onSave={onSave}
        preferences={{ ...saved, revision: 5, menuBar: { visible: true, showPersonNames: true } }}
      />
    )
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /メニューバーに SES Agent を表示/u })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('checkbox', { name: /メニューバーに SES Agent を表示/u }))
    await waitFor(() =>
      expect(onSave).toHaveBeenLastCalledWith({ locale: 'ja-JP', expectedRevision: 5, menuBar: { visible: false, showPersonNames: true } })
    )
  })

  it('reports a menu-bar setting that could not be saved', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('conflict'))
    render(<ApplicationSettingsDialog {...integrationProps} onClose={vi.fn()} onSave={onSave} preferences={preferences} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /メニューバーに SES Agent を表示/u }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('does not write when the selected locale is already active', () => {
    const onSave = vi.fn()
    render(<ApplicationSettingsDialog {...integrationProps} onClose={vi.fn()} onSave={onSave} preferences={preferences} />)
    fireEvent.click(screen.getByRole('radio', { name: /日本語/ }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps every external connection under the integrations section', () => {
    render(
      <ApplicationSettingsDialog
        {...integrationProps}
        initialSection="integrations"
        onClose={vi.fn()}
        onSave={vi.fn()}
        preferences={preferences}
      />
    )
    expect(screen.getByRole('heading', { name: '外部システム' })).toBeInTheDocument()
    expect(screen.getByText('Google メール')).toBeInTheDocument()
    expect(screen.getByText('AICommerce Cloud AI')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '接続設定' })).not.toBeInTheDocument()
    expect(screen.getByText(/Google メール接続が組み込まれていません/)).toBeInTheDocument()
    expect(screen.queryByText('Desktop OAuth Client ID')).not.toBeInTheDocument()
  })

  it('lets HR start the product-managed Gmail authorization with one button', async () => {
    const onConnectGoogleWorkspace = vi.fn().mockResolvedValue(undefined)
    render(
      <ApplicationSettingsDialog
        {...integrationProps}
        bootstrap={
          {
            ...bootstrap,
            gmail: { ...bootstrap.gmail, configuration: 'ready', workspaceDomain: null },
            gmailSync: { ...bootstrap.gmailSync, configuration: 'ready', labelIds: ['INBOX'], query: '案件 OR 募集' }
          } as unknown as BootstrapPayload
        }
        initialSection="integrations"
        onClose={vi.fn()}
        onConnectGoogleWorkspace={onConnectGoogleWorkspace}
        onSave={vi.fn()}
        preferences={preferences}
      />
    )

    expect(screen.getByRole('note')).toHaveTextContent(/件名・送信者・本文・日時・Label/u)
    expect(screen.getByRole('note')).toHaveTextContent(/履歴書添付/u)
    expect(screen.getByRole('note')).toHaveTextContent(/メールを送信・削除することはありません/u)
    fireEvent.click(screen.getByRole('button', { name: 'Google メールを接続' }))
    await waitFor(() => expect(onConnectGoogleWorkspace).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Desktop OAuth Client ID')).not.toBeInTheDocument()
  })

  it('saves partner labels as aliases of the built-in case fields with an optimistic revision', async () => {
    const onSaveFieldAliases = vi.fn().mockResolvedValue({
      version: 'job-case-field-aliases-v1',
      aliases: { rate: ['単金', '金額'] },
      configured: true,
      revision: 1,
      updatedAt: '2026-08-26T00:00:00.000Z'
    })
    render(
      <ApplicationSettingsDialog
        {...integrationProps}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSaveFieldAliases={onSaveFieldAliases}
        preferences={preferences}
      />
    )

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

  describe('AI models', () => {
    const models = [
      { key: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna', tier: 'fast' },
      { key: 'gpt-6-luna', displayName: 'GPT-6 Luna', tier: 'fast' },
      { key: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol', tier: 'strong' },
      { key: 'gpt-6.1-sol-pro', displayName: 'GPT-6.1 Sol Pro', tier: 'strongest' },
      { key: 'gpt-6-astra', displayName: 'GPT-6 Astra' }
    ]
    const saved: LocalApplicationPreferences = {
      ...preferences,
      configured: true,
      revision: 3,
      updatedAt: '2026-09-30T00:00:00.000Z',
      aiModels: { checking: 'gpt-6-luna', writing: 'gpt-4-retired' }
    }
    const renderModels = (props: Partial<Parameters<typeof ApplicationSettingsDialog>[0]> = {}) =>
      render(
        <ApplicationSettingsDialog
          {...integrationProps}
          bootstrap={{ ...bootstrap, agentChatModels: models } as unknown as BootstrapPayload}
          initialSection="models"
          onClose={vi.fn()}
          onSave={vi.fn()}
          preferences={saved}
          {...props}
        />
      )

    it('shows each catalog model with its speed and cost hint, and the saved choice per slot', () => {
      renderModels()
      expect(screen.getByRole('heading', { name: 'AIモデル' })).toBeInTheDocument()
      const checking = screen.getByRole('combobox', { name: /一括確認/ }) as HTMLSelectElement
      const writing = screen.getByRole('combobox', { name: /文章と分析/ }) as HTMLSelectElement
      expect([...checking.options].map((option) => option.textContent)).toEqual([
        'GPT-5.6 Luna · 高速・低コスト',
        'GPT-6 Luna · 高速・低コスト',
        'GPT-6.1 Sol · 高性能',
        'GPT-6.1 Sol Pro · 最高性能・低速・高コスト',
        'GPT-6 Astra'
      ])
      expect(checking.value).toBe('gpt-6-luna')
      // A key the catalog no longer lists shows as the default model.
      expect(writing.value).toBe('gpt-5.6-luna')
      expect(screen.getByText(/頻繁な一括確認には高速なモデル/)).toBeInTheDocument()
    })

    it('saves a changed slot with the other slot and the optimistic revision', async () => {
      const onSave = vi.fn().mockResolvedValue(saved)
      renderModels({ onSave })
      fireEvent.change(screen.getByRole('combobox', { name: /文章と分析/ }), { target: { value: 'gpt-6.1-sol-pro' } })
      await waitFor(() =>
        expect(onSave).toHaveBeenCalledWith({
          locale: 'ja-JP',
          expectedRevision: 3,
          aiModels: { checking: 'gpt-6-luna', writing: 'gpt-6.1-sol-pro' }
        })
      )
      expect(await screen.findByText('保存しました')).toBeInTheDocument()
    })

    it('tests the selected model and shows availability with the round trip', async () => {
      const onTestAiModel = vi.fn().mockResolvedValue({ modelKey: 'gpt-6-luna', latencyMs: 812 })
      renderModels({ onTestAiModel })
      fireEvent.click(screen.getByRole('button', { name: /モデルをテスト：一括確認/ }))
      expect(await screen.findByRole('status')).toHaveTextContent('利用可能 · 812 ms')
      expect(onTestAiModel).toHaveBeenCalledWith('gpt-6-luna')
    })

    it('explains a model the gateway does not serve, and offers AI sign-in when signed out', async () => {
      const onOpenAiCommerce = vi.fn()
      const onTestAiModel = vi
        .fn()
        .mockRejectedValueOnce(
          new Error(
            "Error invoking remote method 'x': AiCommerceRequestError: AICommerce could not start the event stream. [MODEL_NOT_FOUND]"
          )
        )
        .mockRejectedValueOnce(
          new Error("Error invoking remote method 'x': AiCommerceRequestError: Please sign in to Member Center first.")
        )
      renderModels({ onTestAiModel, onOpenAiCommerce })
      const button = screen.getByRole('button', { name: /モデルをテスト：文章と分析/ })
      fireEvent.click(button)
      expect(await screen.findByRole('alert')).toHaveTextContent('このモデルは現在AIゲートウェイで利用できません。 (MODEL_NOT_FOUND)')
      expect(screen.queryByRole('button', { name: 'ログインする' })).not.toBeInTheDocument()
      fireEvent.click(button)
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('AIにログインしていません'))
      fireEvent.click(screen.getByRole('button', { name: 'ログインする' }))
      expect(onOpenAiCommerce).toHaveBeenCalledTimes(1)
    })
  })
})
