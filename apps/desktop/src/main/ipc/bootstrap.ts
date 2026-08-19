import { app, ipcMain } from 'electron'
import { defaultAgentChatModelKey } from '@agent'
import { googleWorkspaceConfigurationFingerprint } from '@mail'
import { getPlatformKeyProtection } from '@platform'
import { hasPendingRestore } from '@recovery'
import {
  type BootstrapPayload,
  type StartupStatus,
  ipcChannels,
  resolveActionApprovalInputSchema
} from '@shared'
import {
  cloudPrivacyGateLoadOptions,
  effectiveApplicationPreferences,
  gmailSyncState,
  unconfiguredAiCommerceState,
  unconfiguredGoogleWorkspaceState
} from '../app-defaults'
import { loadCloudPrivacyGates } from '../privacy-gates'
import { assertTrustedSender, type MainIpcContext } from './context'

/** Startup status, relaunch, the renderer bootstrap payload and action approvals. */
export function registerBootstrapHandlers(context: MainIpcContext) {
  const { repository, localAiStatus, googleWorkspace, aiCommerce, googleWorkspaceDomain, googleWorkspaceConfiguration, gmailSyncConfig, userDataPath, conversationalMatchingEnabled, agentChatModelCatalog, wechatVisibleReader, currentOperator, currentMatchRuntimeIdentity } = context
  ipcMain.handle(ipcChannels.getStartupStatus, (event): StartupStatus => {
    assertTrustedSender(event)
    return { mode: 'normal' }
  })

  ipcMain.handle(ipcChannels.restartApplication, (event): { restarting: true } => {
    assertTrustedSender(event)
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 100)
    return { restarting: true }
  })

  ipcMain.handle(ipcChannels.getBootstrap, async (event): Promise<BootstrapPayload> => {
    assertTrustedSender(event)
    const [gmail, aiCommerceState, privacyGates, wechatVisibleMessage] = await Promise.all([
      googleWorkspace
        ? googleWorkspace.getState()
        : Promise.resolve(unconfiguredGoogleWorkspaceState(googleWorkspaceDomain)),
      aiCommerce ? aiCommerce.getState() : Promise.resolve(unconfiguredAiCommerceState()),
      loadCloudPrivacyGates(cloudPrivacyGateLoadOptions()),
      wechatVisibleReader.feasibility()
    ])
    return {
      appVersion: app.getVersion(),
      environmentLabel: '開発ビルド・暗号化ローカルDB・サンプルデータ',
      operatorProfile: currentOperator(),
      preferences: effectiveApplicationPreferences(repository),
      featureFlags: { conversationalMatchingEnabled },
      agentChatModels: agentChatModelCatalog.map(({ key, displayName }) => ({ key, displayName })),
      defaultAgentChatModelKey,
      tasks: repository.listWorkTasks(),
      processingJobs: repository.listProcessingJobs(),
      actionApprovals: repository.listActionApprovals(),
      resumeAnalyses: repository.listResumeAnalyses(),
      candidateReviews: repository.listCandidateReviews(),
      candidateInterviews: repository.listCandidateInterviews(),
      jobCaseReviews: repository.listJobCaseReviews(),
      matchingHome: repository.getMatchingHomeProjection(currentMatchRuntimeIdentity),
      wechatVisibleMessage,
      privacy: {
        policyVersion: 'cloud-redaction-v2',
        cloudGateway: 'enforced',
        localAi: localAiStatus,
        qualityGate: privacyGates.qualityGate,
        expertGate: privacyGates.expertGate
      },
      storage: {
        status: 'encrypted',
        engine: 'sqlcipher-compatible',
        keyProtection: getPlatformKeyProtection(process.platform),
        schemaVersion: repository.getSchemaVersion()
      },
      gmail,
      googleWorkspaceConfiguration,
      googleWorkspaceAcceptance: googleWorkspaceConfiguration
        ? repository.getLatestGoogleWorkspaceAcceptanceReport(
            googleWorkspaceConfigurationFingerprint(googleWorkspaceConfiguration)
          )
        : null,
      gmailSync: gmailSyncState(repository, gmail, gmailSyncConfig),
      aiCommerce: aiCommerceState,
      recovery: repository.getRecoveryState(await hasPendingRestore(userDataPath)),
      candidateEvaluation: repository.getCandidateEvaluationState()
    }
  })

  ipcMain.handle(ipcChannels.resolveActionApproval, (event, rawInput) => {
    assertTrustedSender(event)
    const input = resolveActionApprovalInputSchema.parse(rawInput)
    return repository.resolveActionApproval(input, currentOperator().displayName)
  })
}
