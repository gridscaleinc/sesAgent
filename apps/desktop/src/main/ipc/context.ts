import { app, dialog, type IpcMainInvokeEvent } from 'electron'

import { ProcessingResourceScheduler, SafeLocalProcessingDispatcher } from '@application'
import { AiCommerceNativeClient } from '@aicommerce'
import { ActionOrchestrator, createDefaultDomainToolRegistry, type ActionContext } from '@action-runtime'
import { loadAgentChatModelCatalog } from '@agent'
import { EncryptedFileVault } from '@files'
import {
  localEmbeddingModel,
  localRerankerModel,
  type LocalAiRuntime,
  type LocalOcrPort,
  type LocalPersonNameDetectorPort
} from '@local-ai'
import { ParserWorkerClient } from '@parsers/worker-client'
import { EncryptedApplicationRepository } from '@persistence'
import { GoogleWorkspaceOAuthClient, type GmailSyncConfiguration } from '@mail'
import { SafeStorageMasterKeyProvider } from '@platform'
import { CloudRedactionGateway } from '@privacy'
import { LocalHybridCandidateRetrieval, searchConfirmedCandidateProfiles } from '@resume'
import type { AgentCandidateDraftFacts, DomainToolName, GoogleWorkspaceAdminConfiguration, ProcessingJobSummary } from '@shared'

import { cloudPrivacyGateLoadOptions, effectiveOperatorProfile } from '../app-defaults'
import { AgentCloudNarrativeService } from '../agent-cloud-narrative'
import { CloudAiReviewService } from '../cloud-ai-review'
import { loadCloudPrivacyGates } from '../privacy-gates'
import {
  MacWechatVisibleReader,
  WechatVisibleScopeTokenStore,
  resolveWechatAccessibilityHelperPath
} from '../wechat-visible-reader'

/**
 * Rejects any IPC request that did not originate from the application's own
 * renderer. Every handler calls this first; it is the process trust boundary.
 */
export function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url ?? event.sender.getURL()
  const developmentUrl = process.env.ELECTRON_RENDERER_URL

  if (!app.isPackaged && developmentUrl) {
    if (new URL(senderUrl).origin === new URL(developmentUrl).origin) return
  } else if (senderUrl.startsWith('ses-agent://app/')) {
    return
  }

  throw new Error('Blocked IPC request from an untrusted renderer.')
}

/** Long-lived services and configuration resolved once during startup. */
export interface MainIpcDependencies {
  repository: EncryptedApplicationRepository
  fileVault: EncryptedFileVault
  parserWorker: ParserWorkerClient
  candidateRetrieval: LocalHybridCandidateRetrieval
  localRerankerEnabled: boolean
  localOcr: LocalOcrPort | null
  localAiStatus: LocalAiRuntime['status']
  localNer: LocalPersonNameDetectorPort | null
  googleWorkspace: GoogleWorkspaceOAuthClient | null
  aiCommerce: AiCommerceNativeClient | null
  googleWorkspaceDomain: string | null
  googleWorkspaceConfiguration: GoogleWorkspaceAdminConfiguration | null
  gmailSyncConfig: GmailSyncConfiguration | null
  masterKey: Buffer
  masterKeyProvider: SafeStorageMasterKeyProvider
  userDataPath: string
}

/**
 * Everything the per-domain IPC modules share: injected dependencies plus the
 * cross-cutting helpers (operator identity, action pre-flight, task locking,
 * candidate search, background dispatcher control).
 *
 * The type is inferred from the factory so literal types stay exact.
 */
export type MainIpcContext = ReturnType<typeof createMainIpcContext>

export function createMainIpcContext(dependencies: MainIpcDependencies) {
  const { repository, candidateRetrieval, localRerankerEnabled, localNer, aiCommerce } = dependencies

  const conversationalMatchingEnabled = process.env.SES_CONVERSATIONAL_MATCHING_ENABLED !== '0'
  const agentChatModelCatalog = loadAgentChatModelCatalog()
  const activeTaskOperations = new Set<string>()
  const wechatVisibleReader = new MacWechatVisibleReader(resolveWechatAccessibilityHelperPath({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath()
  }))
  const wechatScopeTokens = new WechatVisibleScopeTokenStore()
  const processingResources = new ProcessingResourceScheduler({ 'local-ai': 1, 'file-export': 1 })
  const currentOperator = () => effectiveOperatorProfile(repository)
  const currentMatchRuntimeIdentity = {
    algorithmVersion: localRerankerEnabled
      ? 'hard-filter-hybrid-local-rerank-v1' as const
      : 'hard-filter-hybrid-rrf-v1' as const,
    hardFilterPolicyVersion: 'tri-state-v3' as const,
    embeddingModelId: localEmbeddingModel.id,
    embeddingModelRevision: localEmbeddingModel.revision,
    rerankerModelId: localRerankerEnabled ? localRerankerModel.id : null,
    rerankerModelRevision: localRerankerEnabled ? localRerankerModel.revision : null
  }

  const cloudAiReview = aiCommerce
    ? new CloudAiReviewService<Awaited<ReturnType<AiCommerceNativeClient['requestText']>>>({
        repository,
        localNer,
        endpointId: aiCommerce.requestEndpoint,
        policyVersion: 'cloud-redaction-v2',
        loadGates: () => loadCloudPrivacyGates(cloudPrivacyGateLoadOptions()),
        confirm: async (review) => {
          const removed = review.removedIdentifierTypes.length > 0
            ? review.removedIdentifierTypes.join(', ')
            : 'なし'
          const confirmation = await dialog.showMessageBox({
            type: 'warning',
            title: 'Cloud AI 送信前確認',
            message: '以下の脱敏済み内容だけを AICommerce に送信します。',
            detail: `${review.redactedPreview}\n\n置換した識別子: ${removed}\nPreview SHA-256: ${review.previewHash}`,
            buttons: ['確認して送信', 'キャンセル'],
            defaultId: 1,
            cancelId: 1,
            noLink: true
          })
          return confirmation.response === 0
        },
        invoke: async (payload, operationId, auditContext) => {
          const gateway = new CloudRedactionGateway([
            {
              id: 'aicommerce',
              endpoint: aiCommerce.requestEndpoint,
              invoke: async (_taskType, content) => aiCommerce.requestText(content, operationId)
            }
          ], repository, {
            policyVersion: 'cloud-redaction-v2',
            allowedEndpoints: [aiCommerce.requestEndpoint],
            allowedTasks: ['cloud-assist'],
            allowLoopbackHttp: !app.isPackaged && aiCommerce.allowsLoopbackHttp
          })
          const result = await gateway.invoke('aicommerce', 'cloud-assist', payload, auditContext)
          if (!result || typeof result !== 'object') throw new Error('AICommerce の応答を検証できませんでした。')
          return result as Awaited<ReturnType<AiCommerceNativeClient['requestText']>>
        }
      })
    : null

  const agentNarrativeStreamer = aiCommerce
    ? new AgentCloudNarrativeService({
        repository,
        localNer,
        aiCommerce,
        policyVersion: 'cloud-redaction-v2',
        loadGates: () => loadCloudPrivacyGates(cloudPrivacyGateLoadOptions()),
        allowLoopbackHttp: !app.isPackaged && aiCommerce.allowsLoopbackHttp
      })
    : null

  const actionOrchestrator = new ActionOrchestrator(createDefaultDomainToolRegistry(), repository)

  const preflightAction = (
    toolName: DomainToolName,
    context: ActionContext,
    input: unknown,
    safeSummary: string,
    idempotencyKey: string
  ) => {
    const result = actionOrchestrator.preflight(toolName, context, input, safeSummary, idempotencyKey)
    if (result.decision.outcome === 'deny') throw new Error(result.decision.reason)
    // Native confirmation is intentionally satisfied later by Electron's save dialog.
    // Inbox approvals are never auto-executed by this helper.
    if (result.decision.outcome === 'require-approval') throw new Error('この操作はレビューセンターでの承認待ちです。')
    return result.actionRunId
  }

  const withTaskOperation = async <T>(taskId: string, operation: () => Promise<T> | T): Promise<T> => {
    if (activeTaskOperations.has(taskId)) throw new Error('この作業に対する別の処理が進行中です。完了後にもう一度操作してください。')
    activeTaskOperations.add(taskId)
    try {
      return await operation()
    } finally {
      activeTaskOperations.delete(taskId)
    }
  }

  const failPendingProcessingJob = (jobId: string, errorCode: string) => {
    const current = repository.getProcessingJob(jobId)
    if (!current || !['queued', 'retry_wait'].includes(current.status)) return current
    const lease = repository.acquireProcessingJob(jobId, 60_000)
    return lease
      ? repository.failProcessingJob(jobId, lease.leaseToken, errorCode, false)
      : repository.getProcessingJob(jobId)
  }

  /**
   * Preview facts per staged file, kept in memory for this session only.
   * The renderer never supplies these back - it could fabricate them - so the
   * turn reads what this process actually derived.
   */
  const previewedDrafts = new Map<string, AgentCandidateDraftFacts>()

  const searchCandidates = async (query: string, maxResults: number) => {
    const profiles = repository.listEligibleTalentProfiles()
    const identities = new Map(profiles.map((profile) => [
      profile.sourceDocumentId,
      repository.getCandidateLocalIdentity(profile.sourceDocumentId)
    ]))
    const enrichLocalIdentity = (results: Awaited<ReturnType<typeof candidateRetrieval.search>>) =>
      results.map((result) => ({
        ...result,
        localIdentity: identities.get(result.sourceDocumentId) ?? {
          displayName: null,
          gender: null,
          birthDate: null,
          nationality: null,
          phone: null,
          email: null,
          address: null,
          education: null,
          major: null,
          graduationDate: null,
          degree: null,
          storage: 'encrypted-local-only' as const,
          cloudEligible: false as const
        }
      }))
    const normalizedQuery = query.normalize('NFKC').trim().toLocaleLowerCase('ja-JP')
    if (normalizedQuery.length >= 2) {
      const identityMatchedProfiles = profiles.filter((profile) => {
        const displayName = identities.get(profile.sourceDocumentId)?.displayName
          ?.normalize('NFKC').toLocaleLowerCase('ja-JP')
        return Boolean(displayName && (displayName.includes(normalizedQuery) || normalizedQuery.includes(displayName)))
      })
      if (identityMatchedProfiles.length > 0) {
        return enrichLocalIdentity(
          searchConfirmedCandidateProfiles(identityMatchedProfiles, '', maxResults)
        )
      }
    }
    try {
      return enrichLocalIdentity(await candidateRetrieval.search(profiles, query, maxResults))
    } catch (error) {
      console.warn('[local-vector-retrieval-degraded]', error instanceof Error ? error.message : 'unknown')
      return enrichLocalIdentity(searchConfirmedCandidateProfiles(profiles, query, maxResults))
    }
  }

  // The background dispatcher is constructed after the handlers are registered,
  // so handlers reach it through this slot rather than a direct reference.
  let safeLocalDispatcher: SafeLocalProcessingDispatcher<ProcessingJobSummary> | null = null

  return {
    ...dependencies,
    conversationalMatchingEnabled,
    agentChatModelCatalog,
    wechatVisibleReader,
    wechatScopeTokens,
    processingResources,
    currentOperator,
    currentMatchRuntimeIdentity,
    cloudAiReview,
    agentNarrativeStreamer,
    actionOrchestrator,
    preflightAction,
    withTaskOperation,
    hasActiveTaskOperation: (taskId: string) => activeTaskOperations.has(taskId),
    failPendingProcessingJob,
    searchCandidates,
    previewedDrafts,
    attachDispatcher: (dispatcher: SafeLocalProcessingDispatcher<ProcessingJobSummary>) => {
      safeLocalDispatcher = dispatcher
    },
    wakeDispatcher: () => safeLocalDispatcher?.wake(),
    stopDispatcher: () => safeLocalDispatcher?.stop()
  }
}
