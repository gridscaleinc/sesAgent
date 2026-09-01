import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, ipcMain, net } from 'electron'
import { type LocalPersonNameDetectorPort, collectLocalPersonNameCandidates } from '@local-ai'
import {
  GmailReadClient,
  type GmailSyncConfiguration,
  GmailSyncCoordinator,
  GoogleWorkspaceOAuthClient,
  createGoogleWorkspaceOnlineAcceptanceReport,
  diagnoseGoogleWorkspaceReadiness,
  googleWorkspaceCredentialSchema,
  redactGmailMessageForLocalStorage
} from '@mail'
import { EncryptedApplicationRepository } from '@persistence'
import { SafeStorageJsonCredentialVault, getPlatformKeyProtection } from '@platform'
import {
  type GmailSyncState,
  type GoogleWorkspaceOnlineAcceptanceReport,
  type GoogleWorkspaceReadinessReport,
  type GoogleWorkspaceState,
  type SaveGoogleWorkspaceAdminConfigurationResult,
  ipcChannels,
  saveGoogleWorkspaceAdminConfigurationInputSchema
} from '@shared'
import { effectiveJobCaseFieldAliases, gmailSyncState, unconfiguredGoogleWorkspaceState } from '../app-defaults'
import { createJobCaseDraftsForPendingGmailMessages } from '../gmail-job-case-intake'
import { assertTrustedSender, type MainIpcContext } from './context'

async function runGmailSync(
  repository: EncryptedApplicationRepository,
  googleWorkspace: GoogleWorkspaceOAuthClient,
  localNer: LocalPersonNameDetectorPort | null,
  config: GmailSyncConfiguration,
  operator: { operatorId: string; displayName: string }
): Promise<GmailSyncState> {
  const googleState = await googleWorkspace.getState()
  if (googleState.status !== 'readonly' || !googleState.accountEmail) {
    throw new Error('Google Workspace を読取専用で接続してください。')
  }
  const accountEmail = googleState.accountEmail
  const gmail = new GmailReadClient((forceRefresh) => googleWorkspace.getAccessToken(forceRefresh), (input, init) =>
    net.fetch(input instanceof URL ? input.toString() : input, init)
  )
  const coordinator = new GmailSyncCoordinator(gmail, repository, async (message) => {
    const localText = `[SUBJECT]\n${message.subject}\n[FROM]\n${message.from}\n[BODY]\n${message.body}`
    let localNameDetection
    try {
      localNameDetection = await localNer?.detectNames(localText)
    } catch {
      localNameDetection = undefined
    }
    const knownPersonNames = collectLocalPersonNameCandidates(localText, localNameDetection)
    const processed = redactGmailMessageForLocalStorage(message, accountEmail, knownPersonNames)
    repository.saveRedactionSession(processed.redaction.session, processed.redaction.mappings)
    return processed.message
  })
  await coordinator.synchronize(accountEmail, config)
  // Imported mail becomes cases immediately, like every other intake route:
  // the operator's field aliases steer extraction, each fresh draft is
  // confirmed with its extracted values, and what the store refuses stays
  // awaiting review in the workspace.
  createJobCaseDraftsForPendingGmailMessages(
    repository,
    accountEmail,
    operator,
    effectiveJobCaseFieldAliases(repository).aliases
  )
  return gmailSyncState(repository, googleState, config)
}

/** Google Workspace OAuth connection, readiness diagnosis and Gmail read-only sync. */
export function registerGoogleWorkspaceHandlers(context: MainIpcContext) {
  const { repository, localNer, googleWorkspace, googleWorkspaceDomain, googleWorkspaceConfiguration, gmailSyncConfig, userDataPath, currentOperator, preflightAction } = context
  let gmailSyncInFlight: Promise<GmailSyncState> | null = null

  ipcMain.handle(ipcChannels.connectGoogleWorkspace, async (event): Promise<GoogleWorkspaceState> => {
    assertTrustedSender(event)
    if (!googleWorkspace) {
      throw new Error('Google Workspace OAuth Client ID と会社ドメインの管理者設定が必要です。')
    }
    return googleWorkspace.connectReadonly()
  })

  ipcMain.handle(ipcChannels.diagnoseGoogleWorkspace, async (event): Promise<GoogleWorkspaceReadinessReport> => {
    assertTrustedSender(event)
    return diagnoseGoogleWorkspaceReadiness({
      configuration: googleWorkspaceConfiguration,
      credentialProtection: getPlatformKeyProtection(process.platform),
      fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init)
    })
  })

  ipcMain.handle(
    ipcChannels.runGoogleWorkspaceOnlineAcceptance,
    async (event): Promise<GoogleWorkspaceOnlineAcceptanceReport> => {
      assertTrustedSender(event)
      if (!googleWorkspace || !googleWorkspaceConfiguration || !gmailSyncConfig) {
        throw new Error('Google Workspace の管理者設定と読取専用接続が必要です。')
      }
      const state = await googleWorkspace.getState()
      if (state.status !== 'readonly' || !state.accountEmail) {
        throw new Error('Google Workspace を読取専用で接続してください。')
      }
      const live = await googleWorkspace.verifyReadonlyProfile()
      const checkpoint = repository.getGmailSyncCheckpoint(state.accountEmail)
      const report = createGoogleWorkspaceOnlineAcceptanceReport({
        configuration: googleWorkspaceConfiguration,
        live,
        credentialProtection: getPlatformKeyProtection(process.platform),
        sync: {
          configHash: checkpoint?.configHash ?? null,
          status: checkpoint?.status ?? 'never',
          lastSyncedAt: checkpoint?.lastSyncedAt ?? null,
          lastRun: checkpoint?.lastRun ?? null
        },
        redaction: repository.summarizeGmailRedactionEvidence(state.accountEmail)
      })
      return repository.saveGoogleWorkspaceAcceptanceReport(report)
    }
  )

  ipcMain.handle(
    ipcChannels.saveGoogleWorkspaceAdminConfiguration,
    async (event, rawInput): Promise<SaveGoogleWorkspaceAdminConfigurationResult> => {
      assertTrustedSender(event)
      if (googleWorkspaceConfiguration?.source === 'managed-environment') {
        throw new Error('Google Workspace 設定は会社の受管環境から提供されているため、アプリ内では変更できません。')
      }
      const input = saveGoogleWorkspaceAdminConfigurationInputSchema.parse(rawInput)
      const googleState = googleWorkspace ? await googleWorkspace.getState() : null
      if (googleState?.status !== 'not-connected') {
        throw new Error('Google Workspace 接続を解除してから管理者設定を変更してください。')
      }
      const credentialVault = new SafeStorageJsonCredentialVault(
        join(userDataPath, 'security', 'google-workspace-credential.v1'),
        (value) => googleWorkspaceCredentialSchema.parse(value)
      )
      await credentialVault.clear()
      const configuration = repository.saveGoogleWorkspaceAdminConfiguration(input, currentOperator().displayName)
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 250)
      return { configuration, restarting: true }
    }
  )

  ipcMain.handle(ipcChannels.disconnectGoogleWorkspace, async (event): Promise<GoogleWorkspaceState> => {
    assertTrustedSender(event)
    return googleWorkspace
      ? googleWorkspace.disconnect()
      : unconfiguredGoogleWorkspaceState(googleWorkspaceDomain)
  })

  /**
   * One guarded sync for both entry points: the manual button and the
   * background scheduler share the in-flight promise, the action-run audit
   * trail, and the immediate case intake.
   */
  const startGmailSync = (): Promise<GmailSyncState> => {
    if (!googleWorkspace) throw new Error('Google Workspace OAuth の管理者設定が必要です。')
    if (!gmailSyncConfig) throw new Error('Gmail Label・Query・回溯期間の管理者設定が必要です。')
    if (gmailSyncInFlight) return gmailSyncInFlight
    const configurationFingerprint = createHash('sha256').update(JSON.stringify(gmailSyncConfig)).digest('hex')
    const actionRunId = preflightAction('gmail.sync.read', {
      origin: 'managed-connector', workTaskId: null, scopeId: 'selected-gmail-message',
      scopeFingerprint: configurationFingerprint, actorId: currentOperator().operatorId, contentRevision: null
    }, { configurationFingerprint }, '管理者が固定した Gmail 読取範囲を端末内へ同期します。', `gmail-sync:${randomUUID()}`)
    repository.updateActionRun(actionRunId, 'running')
    gmailSyncInFlight = runGmailSync(repository, googleWorkspace, localNer, gmailSyncConfig, currentOperator())
      .then((state) => {
        repository.updateActionRun(actionRunId, 'succeeded', { resultHash: configurationFingerprint })
        return state
      })
      .catch((cause) => {
        repository.updateActionRun(actionRunId, 'failed', { errorCode: 'GMAIL_SYNC_FAILED' })
        throw cause
      })
      .finally(() => { gmailSyncInFlight = null })
    return gmailSyncInFlight
  }

  ipcMain.handle(ipcChannels.syncGoogleWorkspace, async (event): Promise<GmailSyncState> => {
    assertTrustedSender(event)
    return startGmailSync()
  })

  return {
    startGmailSync,
    isGmailSyncRunning: () => gmailSyncInFlight !== null
  }
}
