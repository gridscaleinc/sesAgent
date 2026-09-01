import { app } from 'electron'

import { gmailSyncConfigurationSchema, type GmailSyncConfiguration } from '@mail'
import { EncryptedApplicationRepository } from '@persistence'
import {
  type JobCaseFieldAliases,
  jobCaseFieldAliasesSchema,
  googleWorkspaceAdminConfigurationSchema,
  localApplicationPreferencesSchema,
  localOperatorProfileSchema,
  type AiCommerceMembershipState,
  type GmailSyncState,
  type GoogleWorkspaceAdminConfiguration,
  type GoogleWorkspaceState,
  type LocalApplicationPreferences,
  type LocalOperatorProfile
} from '@shared'

export function cloudPrivacyGateLoadOptions() {
  return {
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    sourceRoot: app.getAppPath(),
    platform: process.platform,
    arch: process.arch
  }
}

const unconfiguredOperatorProfile = localOperatorProfileSchema.parse({
  version: 'local-operator-profile-v1',
  operatorId: '00000000-0000-4000-8000-000000000001',
  displayName: '本機ユーザー',
  roleLabel: 'プロフィール未設定',
  configured: false,
  revision: null,
  updatedAt: null,
  cloudEligible: false
})

export function effectiveOperatorProfile(repository: EncryptedApplicationRepository): LocalOperatorProfile {
  return repository.getLocalOperatorProfile() ?? unconfiguredOperatorProfile
}

const unconfiguredApplicationPreferences = localApplicationPreferencesSchema.parse({
  version: 'local-application-preferences-v1',
  locale: 'ja-JP',
  configured: false,
  revision: null,
  updatedAt: null,
  cloudEligible: false
})

export function effectiveApplicationPreferences(repository: EncryptedApplicationRepository): LocalApplicationPreferences {
  return repository.getLocalApplicationPreferences() ?? unconfiguredApplicationPreferences
}

const unconfiguredJobCaseFieldAliases: JobCaseFieldAliases = jobCaseFieldAliasesSchema.parse({
  version: 'job-case-field-aliases-v1',
  aliases: {},
  configured: false,
  revision: null,
  updatedAt: null
})

/** The operator's job-case field aliases, or the empty default before any were saved. */
export function effectiveJobCaseFieldAliases(repository: EncryptedApplicationRepository): JobCaseFieldAliases {
  return repository.getJobCaseFieldAliases() ?? unconfiguredJobCaseFieldAliases
}

export function unconfiguredAiCommerceState(): AiCommerceMembershipState {
  return {
    configuration: 'required',
    connection: 'not-connected',
    productCode: null,
    billingMode: null,
    memberDisplayName: null,
    accountId: null,
    accountAiTokenExpiresAt: null,
    wallet: null,
    capabilities: [],
    refreshedAt: null
  }
}

export function unconfiguredGoogleWorkspaceState(workspaceDomain: string | null): GoogleWorkspaceState {
  return {
    provider: 'google-workspace',
    status: 'not-connected',
    configuration: 'required',
    workspaceDomain,
    accountEmail: null,
    grantedScopes: [],
    readAccess: false,
    draftAccess: 'not-requested',
    sendMethod: 'not-implemented'
  }
}

export function loadManagedGoogleWorkspaceConfiguration(now = new Date()): GoogleWorkspaceAdminConfiguration | null {
  const clientId = process.env.SES_GOOGLE_OAUTH_CLIENT_ID?.trim() ?? ''
  const workspaceDomain = process.env.SES_GOOGLE_WORKSPACE_DOMAIN?.trim() ?? ''
  const rawLabels = process.env.SES_GMAIL_LABEL_IDS?.trim() ?? ''
  const rawQuery = process.env.SES_GMAIL_QUERY?.trim() ?? ''
  if (![clientId, workspaceDomain, rawLabels, rawQuery].some(Boolean)) return null
  if (![clientId, workspaceDomain, rawLabels, rawQuery].every(Boolean)) {
    throw new Error('Managed Google Workspace configuration requires OAuth Client ID, company domain, Gmail labels, and query together.')
  }
  const sync = gmailSyncConfigurationSchema.parse({
    version: 'gmail-sync-config-v1' as const,
    labelIds: rawLabels.split(',').map((label) => label.trim()).filter(Boolean),
    query: rawQuery,
    lookbackDays: Number(process.env.SES_GMAIL_LOOKBACK_DAYS ?? 30),
    maxMessagesPerRun: Number(process.env.SES_GMAIL_MAX_MESSAGES_PER_RUN ?? 200)
  })
  return googleWorkspaceAdminConfigurationSchema.parse({
    version: 'google-workspace-admin-config-v1',
    source: 'managed-environment',
    editable: false,
    clientId,
    workspaceDomain,
    labelIds: sync.labelIds,
    query: sync.query,
    lookbackDays: sync.lookbackDays,
    maxMessagesPerRun: sync.maxMessagesPerRun,
    revision: null,
    configuredBy: '受管環境設定',
    updatedAt: now.toISOString()
  })
}

export function gmailSyncConfigurationFromAdmin(
  configuration: GoogleWorkspaceAdminConfiguration | null
): GmailSyncConfiguration | null {
  if (!configuration) return null
  return gmailSyncConfigurationSchema.parse({
    version: 'gmail-sync-config-v1',
    labelIds: configuration.labelIds,
    query: configuration.query,
    lookbackDays: configuration.lookbackDays,
    maxMessagesPerRun: configuration.maxMessagesPerRun
  })
}

export function gmailSyncState(
  repository: EncryptedApplicationRepository,
  googleState: GoogleWorkspaceState,
  config: GmailSyncConfiguration | null
): GmailSyncState {
  const checkpoint = googleState.accountEmail
    ? repository.getGmailSyncCheckpoint(googleState.accountEmail)
    : null
  return {
    configuration: config ? 'ready' : 'required',
    status: checkpoint?.status ?? 'never',
    labelIds: config?.labelIds ?? [],
    query: config?.query ?? null,
    lookbackDays: config?.lookbackDays ?? 30,
    checkpointHistoryId: checkpoint?.historyId ?? null,
    storedMessages: googleState.accountEmail ? repository.countGmailMessages(googleState.accountEmail) : 0,
    lastSyncedAt: checkpoint?.lastSyncedAt ?? null,
    lastRun: checkpoint?.lastRun ?? null,
    lastError: checkpoint?.lastError ?? null
  }
}
