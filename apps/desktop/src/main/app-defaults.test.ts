import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/tmp/ses-agent',
    isPackaged: false,
    resourcesPath: '/tmp/ses-agent/resources'
  }
}))

import { loadManagedGoogleWorkspaceConfiguration } from './app-defaults'

const managedKeys = [
  'SES_GOOGLE_OAUTH_CLIENT_ID',
  'SES_GOOGLE_WORKSPACE_DOMAIN',
  'SES_GMAIL_LABEL_IDS',
  'SES_GMAIL_QUERY',
  'SES_GMAIL_LOOKBACK_DAYS',
  'SES_GMAIL_MAX_MESSAGES_PER_RUN'
] as const

function clearManagedConfiguration(): void {
  for (const key of managedKeys) vi.stubEnv(key, '')
}

afterEach(() => vi.unstubAllEnvs())

describe('loadManagedGoogleWorkspaceConfiguration', () => {
  it('uses bounded product defaults when the build supplies only the public client identity', () => {
    clearManagedConfiguration()
    vi.stubEnv('SES_GOOGLE_OAUTH_CLIENT_ID', '1234567890-product.apps.googleusercontent.com')

    expect(loadManagedGoogleWorkspaceConfiguration(new Date('2026-09-01T00:00:00.000Z'))).toMatchObject({
      source: 'managed-environment',
      editable: false,
      clientId: '1234567890-product.apps.googleusercontent.com',
      workspaceDomain: null,
      labelIds: ['INBOX'],
      query: '案件 OR 募集 OR 要件 OR 単価 OR 商流 OR 稼働 OR 参画 OR 要員 OR 人材 OR スキルシート OR 経歴書 OR 履歴書 OR 人员 OR 简历 OR 面談 OR 面接 OR 日程調整 OR 入場 OR 面试 OR 进场',
      lookbackDays: 30,
      maxMessagesPerRun: 200
    })
  })

  it('does not create a Gmail connection when the build supplies no managed values', () => {
    clearManagedConfiguration()
    expect(loadManagedGoogleWorkspaceConfiguration()).toBeNull()
  })

  it('fails closed when sync settings are supplied without the product OAuth identity', () => {
    clearManagedConfiguration()
    vi.stubEnv('SES_GOOGLE_WORKSPACE_DOMAIN', 'gridscale.com')
    expect(() => loadManagedGoogleWorkspaceConfiguration()).toThrow(/Desktop OAuth Client ID/u)
  })

  it('keeps an optional domain restriction for private distributions', () => {
    clearManagedConfiguration()
    vi.stubEnv('SES_GOOGLE_OAUTH_CLIENT_ID', '1234567890-private.apps.googleusercontent.com')
    vi.stubEnv('SES_GOOGLE_WORKSPACE_DOMAIN', 'customer.example.jp')

    expect(loadManagedGoogleWorkspaceConfiguration()).toMatchObject({
      clientId: '1234567890-private.apps.googleusercontent.com',
      workspaceDomain: 'customer.example.jp'
    })
  })
})
