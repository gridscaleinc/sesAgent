import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { lstat, mkdir, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, normalize, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions
} from 'electron'

import {
  candidateSearchQueryFromInstruction,
  cancelWorkTask,
  createSampleTasks,
  createWorkTaskPreview,
  getDataScope,
  materializeWorkTask,
  ProcessingResourceScheduler,
  SafeLocalProcessingDispatcher,
  recordCandidateMatchExecution,
  recordCandidateMatchFailure,
  recordCandidateMatchRetryScheduled,
  recordCandidateMatchStarted,
  recordProposalApproved,
  recordProposalDraftCreated,
  recordProposalExportFailure,
  recordProposalExported,
  recordProposalExportStarted,
  recordProposalFollowUp,
  recordResumeAnalysisFailure,
  recordResumeAnalysisPartialFailure,
  recordResumeAnalysisRetryScheduled,
  recordResumeAnalysisStarted,
  recordResumeImportReviewState,
  reconcileWorkTaskPlan,
  recoverInterruptedWorkTask,
  retryWorkTask
} from '@application'
import {
  AiCommerceNativeClient,
  loadAiCommerceConfiguration,
  parseAiCommerceNativeCredential,
  parseAiCommercePendingAuthorization
} from '@aicommerce'
import { ActionOrchestrator, createDefaultDomainToolRegistry, type ActionContext } from '@action-runtime'
import {
  AgentExecutionError,
  defaultAgentChatModelKey,
  loadAgentChatModelCatalog,
  type AgentToolExecutionMetadata
} from '@agent'
import type { SignedWorkTaskPreview, WorkTask, WorkTaskPreview } from '@domain'
import { buildOriginalDocumentPreview, EncryptedFileVault } from '@files'
import {
  candidateBenchmarkQueryFromJobCase,
  createGmailJobCaseSource,
  createRedactedEmlJobCaseSource,
  createRedactedChatPasteJobCaseSource,
  createRedactedWechatVisibleJobCaseSource,
  createRedactedManualJobCaseSource,
  extractJobCaseDraft
} from '@job-cases'
import {
  collectLocalPersonNameCandidates,
  createLocalAiRuntime,
  LocalEmbeddingWorkerClient,
  localEmbeddingModel,
  LocalRerankerWorkerClient,
  localRerankerModel,
  mergeLocalOcr,
  type LocalOcrPort,
  type LocalAiRuntime,
  type LocalPersonNameDetectorPort
} from '@local-ai'
import { documentIrSchema } from '@parsers'
import { ParserWorkerClient } from '@parsers/worker-client'
import { currentSchemaVersion, EncryptedApplicationRepository } from '@persistence'
import {
  GmailReadClient,
  GmailSyncCoordinator,
  GoogleWorkspaceOAuthClient,
  LoopbackAuthorizationCodeProvider,
  createGoogleWorkspaceOnlineAcceptanceReport,
  diagnoseGoogleWorkspaceReadiness,
  gmailSyncConfigurationSchema,
  googleWorkspaceConfigurationFingerprint,
  googleWorkspaceCredentialSchema,
  maxEmlFileSizeBytes,
  maxEmlFilesPerImport,
  redactGmailMessageForLocalStorage,
  type GmailSyncConfiguration
} from '@mail'
import {
  ProtectedMasterKeyUnavailableError,
  SafeStorageJsonCredentialVault,
  SafeStorageMasterKeyProvider,
  getPlatformKeyProtection
} from '@platform'
import { deriveApplicationKeys } from '@platform/keys'
import { CloudRedactionGateway, detectDirectIdentifiers, redactTextForCloud } from '@privacy'
import { buildProposalPackageZip, proposalAttachmentHtml } from '@proposals'
import {
  applyPendingRestore,
  createRecoveryPackage,
  discardStagedRecovery,
  finalizePendingRestore,
  hasPendingRestore,
  rollbackIncompletePendingRestore,
  schedulePendingRestore,
  stageRecoveryPackage,
  type PendingRestoreActivation,
  type StagedRecoveryPackage
} from '@recovery'
import {
  evaluateSesCandidateBenchmark,
  extractCandidateDraft,
  LocalHybridCandidateRetrieval,
  searchConfirmedCandidateProfiles
} from '@resume'
import {
  analyzeResumeFileInputSchema,
  createCandidateInterviewRoundInputSchema,
  saveCandidateInterviewScheduleInputSchema,
  saveCandidateInterviewPreparationInputSchema,
  saveCandidateInterviewNotesInputSchema,
  recordCandidateInterviewDecisionInputSchema,
  openInterviewMeetingInputSchema,
  zoomMeetingUrlSchema,
  approveProposalDraftInputSchema,
  executeAiCommerceCloudPromptInputSchema,
  aiConversationContextSchema,
  candidateProfileSourceInputSchema,
  candidateEvaluationAuthoringWorkspaceSchema,
  createCandidateEvaluationDraftInputSchema,
  saveCandidateEvaluationDraftCaseInputSchema,
  deleteCandidateEvaluationDraftCaseInputSchema,
  evaluateCandidateEvaluationDraftInputSchema,
  createChatPasteJobCaseDraftInputSchema,
  executeWechatVisibleReadInputSchema,
  createManualJobCaseDraftInputSchema,
  createProposalDraftInputSchema,
  createRecoveryPackageInputSchema,
  createWorkTaskInputSchema,
  deleteAiConversationsInputSchema,
  deleteCandidateDataInputSchema,
  deleteJobCaseDataInputSchema,
  executeCandidateMatchTaskInputSchema,
  exportProposalPackageInputSchema,
  confirmRecoveryInputSchema,
  ipcChannels,
  jobCaseReviewIdSchema,
  localApplicationPreferencesSchema,
  localOperatorProfileSchema,
  proposalTaskIdSchema,
  previewRecoveryPackageInputSchema,
  prepareAiCommerceCloudPromptInputSchema,
  recordProposalFollowUpInputSchema,
  reopenJobCaseReviewInputSchema,
  searchCandidateProfilesInputSchema,
  sesCandidateBenchmarkSchema,
  setJobCaseLifecycleInputSchema,
  setBusinessPriorityOverrideInputSchema,
  setWorkTaskLifecycleInputSchema,
  resolveActionApprovalInputSchema,
  googleWorkspaceAdminConfigurationSchema,
  saveGoogleWorkspaceAdminConfigurationInputSchema,
  saveAiConversationInputSchema,
  saveLocalApplicationPreferencesInputSchema,
  saveLocalOperatorProfileInputSchema,
  snoozeRecoveryReminderInputSchema,
  submitCandidateReviewInputSchema,
  updateCandidateProfileInputSchema,
  submitCandidateMatchFeedbackInputSchema,
  submitJobCaseReviewInputSchema,
  updateProposalDraftInputSchema,
  workTaskInputSchema,
  type BootstrapPayload,
  type BeginResumeImportResult,
  type AiCommerceCloudPromptResult,
  type AiCommerceMembershipState,
  type AiConversationContext,
  type AiConversationSnapshot,
  type CandidateMatchTaskExecutionResult,
  type DomainToolName,
  type ExecuteAgentTurnResult,
  type CancelAgentTurnResult,
  type CandidateInterviewSnapshot,
  type CandidateEvaluationAuthoringWorkspace,
  type EvaluateCandidateEvaluationDraftResult,
  type CreateChatPasteJobCaseDraftResult,
  type ExecuteWechatVisibleReadResult,
  type CreateManualJobCaseDraftResult,
  type CreateRecoveryPackageResult,
  type DataDeletionReport,
  type DeleteAiConversationsResult,
  type DeleteCandidateDataResult,
  type DeleteJobCaseDataResult,
  type UpdateCandidateProfileResult,
  type ReopenJobCaseReviewResult,
  type SetJobCaseLifecycleResult,
  type GmailSyncState,
  type GoogleWorkspaceState,
  type GoogleWorkspaceAdminConfiguration,
  type GoogleWorkspaceReadinessReport,
  type GoogleWorkspaceOnlineAcceptanceReport,
  type LocalApplicationPreferences,
  type LocalOperatorProfile,
  type OpenOriginalDocumentResult,
  type OriginalDocumentPreview,
  type SaveGoogleWorkspaceAdminConfigurationResult,
  type SaveLocalApplicationPreferencesInput,
  type SaveLocalOperatorProfileInput,
  type EmlImportErrorCode,
  type ExportProposalPackageResult,
  type ImportEmlJobCaseDraftsResult,
  type ImportCandidateEvaluationBenchmarkResult,
  type ProposalDraftSnapshot,
  type ProposalMutationResult,
  type ProposalWorkspaceSnapshot,
  type ProcessingJobSummary,
  type PrepareWechatVisibleReadResult,
  type PrepareAiCommerceCloudPromptResult,
  type RecoveryPreviewResult,
  type RecoveryState,
  type ConfirmRecoveryResult,
  type ResumeAnalysisSummary,
  type ResumeAnalysisTaskExecutionResult,
  type SesCandidateBenchmark,
  type StagedLocalFile,
  type SubmitCandidateReviewResult,
  type SubmitCandidateMatchFeedbackResult,
  type SubmitJobCaseReviewResult,
  type StartupStatus
} from '@shared'
import { validateCloudAiResponseForDisplay } from './cloud-ai-privacy'
import { CloudAiReviewService } from './cloud-ai-review'
import { loadCloudPrivacyGates } from './privacy-gates'
import { registerAgentIpcHandlers } from './agent-ipc'
import { AgentCloudNarrativeService } from './agent-cloud-narrative'
import { shouldRunReleaseAgentSmoke } from './startup-smoke'
import {
  MacWechatVisibleReader,
  WechatVisibleReadError,
  WechatVisibleScopeTokenStore,
  resolveWechatAccessibilityHelperPath
} from './wechat-visible-reader'

const releaseSmokeMode = process.env.SES_RELEASE_SMOKE === '1'
const windowsPackageWorkerSmokeMode = process.env.SES_WINDOWS_PACKAGE_WORKER_SMOKE === '1'
const aiCommerceProductionProbeMode = process.env.SES_AICOMMERCE_PRODUCTION_PROBE === '1'

function hasVerifiedWindowsOcrNetworkEvidence(path: string): boolean {
  try {
    const evidence = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    return evidence.version === 'windows-release-evidence-v1' &&
      evidence.kind === 'ocr-worker-kernel-network-deny' && evidence.verified === true
  } catch {
    return false
  }
}

function cloudPrivacyGateLoadOptions() {
  return {
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    sourceRoot: app.getAppPath(),
    platform: process.platform,
    arch: process.arch
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ses-agent',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  },
  {
    scheme: 'ses-agent-original',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
])

let applicationRepository: EncryptedApplicationRepository | null = null
let encryptedFileVault: EncryptedFileVault | null = null
let applicationMasterKey: Buffer | null = null
let originalOpenRootPath: string | null = null
let localEmbeddingWorker: LocalEmbeddingWorkerClient | null = null
let localRerankerWorker: LocalRerankerWorkerClient | null = null
let processingDispatcherStop: (() => void) | null = null

let activeAiCommerceClient: AiCommerceNativeClient | null = null
const queuedAiCommerceCallbackUrls: string[] = []
let aiCommerceCallbackDelivery: Promise<void> = Promise.resolve()

function focusMainWindow(): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
}

function receiveAiCommerceProtocolUrl(rawUrl: string): void {
  focusMainWindow()
  if (!activeAiCommerceClient) {
    if (queuedAiCommerceCallbackUrls.length < 4) queuedAiCommerceCallbackUrls.push(rawUrl)
    return
  }
  const client = activeAiCommerceClient
  aiCommerceCallbackDelivery = aiCommerceCallbackDelivery.then(async () => {
    try {
      const state = await client.completeConnect(rawUrl)
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(ipcChannels.aiCommerceStateChanged, { state, error: null })
      }
    } catch (cause) {
      const state = await client.getState()
      const error = cause instanceof Error ? cause.message : 'Member Center のログインを完了できませんでした。'
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(ipcChannels.aiCommerceStateChanged, { state, error })
      }
    }
  })
}

function attachAiCommerceClient(client: AiCommerceNativeClient | null): void {
  activeAiCommerceClient = client
  if (!client) {
    queuedAiCommerceCallbackUrls.length = 0
    return
  }
  for (const callbackUrl of queuedAiCommerceCallbackUrls.splice(0)) receiveAiCommerceProtocolUrl(callbackUrl)
}

function registerAiCommerceRedirectProtocol(aiCommerce: AiCommerceNativeClient | null): void {
  if (!aiCommerce) return
  const scheme = new URL(aiCommerce.configuration.redirectUri).protocol.replace(/:$/u, '')
  const registered = process.defaultApp
    ? app.setAsDefaultProtocolClient(scheme, process.execPath, process.argv[1] ? [process.argv[1]] : [])
    : app.setAsDefaultProtocolClient(scheme)
  if (!registered) throw new Error('The registered Member Center callback scheme could not be activated for this app.')
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    const callbackUrl = commandLine.find((argument) => argument.includes('://auth/callback'))
    if (callbackUrl) receiveAiCommerceProtocolUrl(callbackUrl)
    else focusMainWindow()
  })
  const coldStartCallbackUrl = process.argv.find((argument) => argument.includes('://auth/callback'))
  if (coldStartCallbackUrl) receiveAiCommerceProtocolUrl(coldStartCallbackUrl)
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  receiveAiCommerceProtocolUrl(url)
})

function usesBundledRenderer(): boolean {
  return !process.env.ELECTRON_RENDERER_URL
}

class EmlFileImportError extends Error {
  constructor(readonly code: EmlImportErrorCode, message: string) {
    super(message)
    this.name = 'EmlFileImportError'
  }
}

async function readSelectedEmlFile(filePath: string): Promise<{
  bytes: Buffer
  manifest: { name: string; size: number; sha256: string }
}> {
  const originalName = basename(filePath)
  if (extname(originalName).toLocaleLowerCase('en-US') !== '.eml') {
    throw new EmlFileImportError('INVALID_EXTENSION', '選択したファイルは .eml ではありません。')
  }
  const name = originalName.length <= 180 ? originalName : `${originalName.slice(0, 176)}.eml`
  const before = await lstat(filePath)
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new EmlFileImportError('FILE_NOT_REGULAR', '通常の EML ファイルだけを取り込めます。')
  }
  if (before.size <= 0 || before.size > maxEmlFileSizeBytes) {
    throw new EmlFileImportError('FILE_TOO_LARGE', 'EML は 1 バイト以上 10 MB 以下である必要があります。')
  }
  const handle = await open(filePath, 'r')
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw new EmlFileImportError('FILE_CHANGED', '選択後に EML ファイルが変更されました。')
    }
    const bytes = await handle.readFile()
    if (bytes.length !== opened.size || bytes.length > maxEmlFileSizeBytes) {
      bytes.fill(0)
      throw new EmlFileImportError('FILE_CHANGED', '読込中に EML ファイルが変更されました。')
    }
    return {
      bytes,
      manifest: {
        name,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')
      }
    }
  } finally {
    await handle.close()
  }
}

function emlImportErrorCode(error: unknown): EmlImportErrorCode {
  if (error instanceof EmlFileImportError) return error.code
  const code = error instanceof Error ? error.message.match(/^([A-Z_]+):/u)?.[1] : null
  if (code === 'BODY_EMPTY') return 'BODY_EMPTY'
  if (code === 'INVALID_MANIFEST' || code === 'HASH_MISMATCH') return 'FILE_CHANGED'
  if (code === 'LIMIT_EXCEEDED') return 'LIMIT_EXCEEDED'
  return 'PARSE_FAILED'
}

function previewHash(preview: WorkTaskPreview): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        instruction: preview.instruction,
        scopeId: preview.scope.id,
        type: preview.type,
        policyVersion: preview.privacy.policyVersion,
        contextBindings: preview.contextBindings
      })
    )
    .digest('hex')
}

async function renderProposalAttachmentPdf(draft: ProposalDraftSnapshot): Promise<Buffer> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    const html = proposalAttachmentHtml(draft)
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await window.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
  } finally {
    window.destroy()
  }
}

async function buildProposalPackage(draft: ProposalDraftSnapshot, now = new Date()): Promise<{
  bytes: Buffer
  packageHash: string
}> {
  const attachmentPdf = await renderProposalAttachmentPdf(draft)
  return buildProposalPackageZip(draft, attachmentPdf, now)
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url ?? event.sender.getURL()
  const developmentUrl = process.env.ELECTRON_RENDERER_URL

  if (!app.isPackaged && developmentUrl) {
    if (new URL(senderUrl).origin === new URL(developmentUrl).origin) return
  } else if (senderUrl.startsWith('ses-agent://app/')) {
    return
  }

  throw new Error('Blocked IPC request from an untrusted renderer.')
}

async function prepareOriginalOpenRoot(userDataPath: string): Promise<string> {
  const root = join(userDataPath, 'temporary', 'original-open')
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true, mode: 0o700 })
  originalOpenRootPath = root
  return root
}

function originalDocumentMimeType(format: string): string {
  if (format === 'pdf') return 'application/pdf'
  return 'application/octet-stream'
}

function byteRange(value: string | null, size: number): { start: number; end: number } | null {
  const match = value?.match(/^bytes=(\d*)-(\d*)$/u)
  if (!match) return null
  const start = match[1] ? Number(match[1]) : 0
  const end = match[2] ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return null
  return { start, end: Math.min(end, size - 1) }
}

async function registerOriginalDocumentProtocol(
  repository: EncryptedApplicationRepository,
  fileVault: EncryptedFileVault
): Promise<void> {
  await protocol.handle('ses-agent-original', async (request) => {
    const requestUrl = new URL(request.url)
    const parsedId = requestUrl.hostname === 'document'
      ? candidateProfileSourceInputSchema.safeParse(decodeURIComponent(requestUrl.pathname.slice(1)))
      : { success: false as const }
    if (!parsedId.success) return new Response('Not found', { status: 404 })
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 })
    const record = repository.getStagedFileRecords([parsedId.data])[0]
    if (!record || record.format !== 'pdf') return new Response('Preview unavailable', { status: 404 })
    const plaintext = await fileVault.decryptForLocalProcessing(record)
    const range = byteRange(request.headers.get('range'), plaintext.length)
    const responseLength = range ? range.end - range.start + 1 : plaintext.length
    const body = request.method === 'HEAD'
      ? null
      : Uint8Array.from(range ? plaintext.subarray(range.start, range.end + 1) : plaintext)
    const headers: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store, private',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(record.name)}`,
      'Content-Length': String(responseLength),
      'Content-Type': originalDocumentMimeType(record.format),
      'X-Content-Type-Options': 'nosniff'
    }
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${plaintext.length}`
    plaintext.fill(0)
    return new Response(body, { status: range ? 206 : 200, headers })
  })
}

function assertWorkTaskAllowsExecution(task: WorkTask): void {
  if (task.status === 'cancelled' || task.status === 'failed') {
    throw new Error('この作業は停止しています。再実行してから操作してください。')
  }
}

function synchronizeImportTask(
  repository: EncryptedApplicationRepository,
  task: WorkTask,
  now = new Date(),
  approvedBy = '本機ユーザー'
): WorkTask {
  if (task.type !== 'IMPORT_RESUME' || task.status === 'cancelled' || task.status === 'failed') return task
  const fileBindings = task.contextBindings.filter((binding) => binding.objectType === 'staged-file')
  if (fileBindings.length === 0 || fileBindings.some((binding) => !repository.getResumeAnalysis(binding.objectId))) return task
  const reviews = fileBindings.map((binding) => repository.getCandidateReview(binding.objectId))
  const completed = reviews.every((review) => review?.status === 'completed')
  const evidenceCount = completed ? fileBindings.length * 11 : Math.max(1, fileBindings.length * 3)
  const unchanged =
    task.status === (completed ? 'completed' : 'awaiting_review') &&
    task.progress === (completed ? 100 : 75) &&
    task.evidenceCount === evidenceCount &&
    task.steps.every((step, index) => step.status === (completed ? 'completed' : index < 3 ? 'completed' : 'blocked'))
  return unchanged ? task : recordResumeImportReviewState(
    task,
    completed,
    evidenceCount,
    completed ? reviews.flatMap((review) => review?.profile?.id ? [review.profile.id] : []) : [],
    now,
    approvedBy
  )
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

function effectiveOperatorProfile(repository: EncryptedApplicationRepository): LocalOperatorProfile {
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

function effectiveApplicationPreferences(repository: EncryptedApplicationRepository): LocalApplicationPreferences {
  return repository.getLocalApplicationPreferences() ?? unconfiguredApplicationPreferences
}

function unconfiguredAiCommerceState(): AiCommerceMembershipState {
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

function unconfiguredGoogleWorkspaceState(workspaceDomain: string | null): GoogleWorkspaceState {
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

function loadManagedGoogleWorkspaceConfiguration(now = new Date()): GoogleWorkspaceAdminConfiguration | null {
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

function gmailSyncConfigurationFromAdmin(
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

function gmailSyncState(
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

async function initializeServices(options: { restoring?: boolean } = {}): Promise<{
  repository: EncryptedApplicationRepository
  fileVault: EncryptedFileVault
  parserWorker: ParserWorkerClient
  embeddingWorker: LocalEmbeddingWorkerClient
  rerankerWorker: LocalRerankerWorkerClient | null
  candidateRetrieval: LocalHybridCandidateRetrieval
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
}> {
  const userDataPath = app.getPath('userData')
  const masterKeyProvider = new SafeStorageMasterKeyProvider(join(userDataPath, 'security', 'master-key.v1'))
  const keyMaterial = await masterKeyProvider.loadOrCreateKeyMaterial()
  const keys = {
    databaseKey: keyMaterial.databaseKey,
    mappingKey: keyMaterial.mappingKey,
    fileVaultKey: keyMaterial.fileVaultKey
  }
  let repository: EncryptedApplicationRepository | null = null
  try {
    repository = new EncryptedApplicationRepository({
      path: join(userDataPath, 'data', 'ses-agent.db'),
      databaseKey: keys.databaseKey,
      mappingKey: keys.mappingKey
    })
    if (!options.restoring && repository.countWorkTasks() === 0) {
      for (const task of createSampleTasks(new Date().toISOString())) repository.saveWorkTask(task)
    }
    const processingJobRecovery = repository.recoverExpiredProcessingJobs(new Date(), true)
    for (const task of repository.listWorkTasks()) {
      const reconciled = recoverInterruptedWorkTask(reconcileWorkTaskPlan(task))
      if (reconciled !== task) repository.saveWorkTask(reconciled)
    }
    for (const task of repository.listWorkTasks()) {
      const reconciled = synchronizeImportTask(repository, task, new Date(), effectiveOperatorProfile(repository).displayName)
      if (reconciled !== task) repository.saveWorkTask(reconciled)
    }
    if (!app.isPackaged || releaseSmokeMode) {
      console.info('[storage-ready]', {
        schemaVersion: repository.getSchemaVersion(),
        recoveredTaskCount: repository.countWorkTasks(),
        processingJobRecovery,
        encryption: 'sqlcipher-compatible',
        keyProtection: getPlatformKeyProtection(process.platform)
      })
    }
    const windowsOcrResources = app.isPackaged
      ? join(process.resourcesPath, 'native', 'windows', 'ocr')
      : join(process.cwd(), 'build', 'native', 'windows', 'ocr')
    const windowsOcrEvidencePath = join(windowsOcrResources, 'network-isolation-evidence.json')
    const windowsOcrSandboxLauncherPath = join(windowsOcrResources, 'ses-ocr-sandbox.exe')
    const windowsAppContainerGrantRoots = app.isPackaged
      ? [dirname(process.execPath)]
      : [process.cwd(), dirname(process.execPath)]
    const windowsLocalWorkerSandbox = process.platform === 'win32' && existsSync(windowsOcrSandboxLauncherPath)
      ? {
          launcherPath: windowsOcrSandboxLauncherPath,
          grantReadRoots: windowsAppContainerGrantRoots
        }
      : undefined
    const localAi = createLocalAiRuntime(process.platform === 'darwin'
      ? {
          macExecutablePath: app.isPackaged
            ? join(process.resourcesPath, 'native', 'macos', 'ses-vision-ocr')
            : join(process.cwd(), 'build', 'native', 'macos', 'ses-vision-ocr')
        }
      : process.platform === 'win32'
        ? {
            windowsOcrSandboxLauncherPath: existsSync(windowsOcrSandboxLauncherPath)
              ? windowsOcrSandboxLauncherPath
              : undefined,
            windowsOcrWorkerPath: join(__dirname, 'windows-ocr-worker.js'),
            windowsTesseractWorkerPath: join(__dirname, 'tesseract-worker.js'),
            windowsTessdataPath: join(windowsOcrResources, 'tessdata'),
            windowsOcrResourceManifestPath: join(windowsOcrResources, 'resource-manifest.json'),
            windowsAppContainerGrantRoots,
            windowsNetworkIsolation: hasVerifiedWindowsOcrNetworkEvidence(windowsOcrEvidencePath)
              ? 'windows-kernel-network-verified'
              : undefined
          }
        : {})
    if (!app.isPackaged || releaseSmokeMode) {
      console.info('[local-ai-ready]', {
        platform: process.platform,
        ocrEngine: localAi.ocr?.engine ?? null,
        status: localAi.status,
        rawPersonalDataCloudEligible: false
      })
    }
    const embeddingModelDirectory = app.isPackaged
      ? join(process.resourcesPath, 'models', 'Xenova', 'multilingual-e5-small')
      : join(process.cwd(), 'models', 'Xenova', 'multilingual-e5-small')
    const embeddingWorker = new LocalEmbeddingWorkerClient({
      workerPath: join(__dirname, 'embedding-worker.js'),
      modelDirectory: embeddingModelDirectory,
      windowsSandbox: windowsLocalWorkerSandbox
    })
    const rerankerModelDirectory = app.isPackaged
      ? join(process.resourcesPath, 'models', 'hotchpotch', 'japanese-reranker-tiny-v2')
      : join(process.cwd(), 'models', 'hotchpotch', 'japanese-reranker-tiny-v2')
    const rerankerModelPath = join(
      rerankerModelDirectory,
      'onnx',
      process.platform === 'win32' ? 'model_qint8_avx2.onnx' : 'model_qint8_arm64.onnx'
    )
    const rerankerWorker = existsSync(join(rerankerModelDirectory, 'model-manifest.json')) && existsSync(rerankerModelPath)
      ? new LocalRerankerWorkerClient({
          workerPath: join(__dirname, 'reranker-worker.js'),
          modelDirectory: rerankerModelDirectory,
          windowsSandbox: windowsLocalWorkerSandbox
        })
      : null
    const candidateRetrieval = new LocalHybridCandidateRetrieval(embeddingWorker, repository, {
      modelId: localEmbeddingModel.id,
      modelRevision: localEmbeddingModel.revision,
      dimension: localEmbeddingModel.dimension,
      maximumRerankCandidates: localRerankerModel.maximumCandidates
    }, rerankerWorker ?? undefined)
    const googleWorkspaceConfiguration = loadManagedGoogleWorkspaceConfiguration() ??
      repository.getGoogleWorkspaceAdminConfiguration()
    const googleClientId = googleWorkspaceConfiguration?.clientId ?? null
    const googleWorkspaceDomain = googleWorkspaceConfiguration?.workspaceDomain ?? null
    const googleWorkspace = googleClientId && googleWorkspaceDomain
      ? new GoogleWorkspaceOAuthClient(
          {
            clientId: googleClientId,
            workspaceDomain: googleWorkspaceDomain
          },
          {
            credentialStore: new SafeStorageJsonCredentialVault(
              join(userDataPath, 'security', 'google-workspace-credential.v1'),
              (input) => googleWorkspaceCredentialSchema.parse(input)
            ),
            authorizationCodeProvider: new LoopbackAuthorizationCodeProvider({
              openExternal: (url) => shell.openExternal(url)
            }),
            fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init)
          }
        )
      : null
    const aiCommerceConfiguration = loadAiCommerceConfiguration()
    const aiCommerce = aiCommerceConfiguration
      ? new AiCommerceNativeClient(aiCommerceConfiguration, {
          credentialStore: new SafeStorageJsonCredentialVault(
            join(userDataPath, 'security', 'aicommerce-native-credential.v1'),
            (input) => parseAiCommerceNativeCredential(input)
          ),
          pendingAuthorizationStore: new SafeStorageJsonCredentialVault(
            join(userDataPath, 'security', 'aicommerce-native-pending-authorization.v1'),
            (input) => parseAiCommercePendingAuthorization(input)
          ),
          openExternal: (url) => shell.openExternal(url),
          fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init)
        })
      : null
    const gmailSyncConfig = gmailSyncConfigurationFromAdmin(googleWorkspaceConfiguration)
    return {
      repository,
      fileVault: new EncryptedFileVault({
        directory: join(userDataPath, 'vault', 'resume-files'),
        key: keys.fileVaultKey
      }),
      parserWorker: new ParserWorkerClient({
        workerPath: join(__dirname, 'parser-worker.js'),
        windowsSandbox: windowsLocalWorkerSandbox
      }),
      embeddingWorker,
      rerankerWorker,
      candidateRetrieval,
      localOcr: localAi.ocr,
      localAiStatus: localAi.status,
      localNer: localAi.personNameDetector,
      googleWorkspace,
      aiCommerce,
      googleWorkspaceDomain,
      googleWorkspaceConfiguration,
      gmailSyncConfig,
      masterKey: keyMaterial.masterKey,
      masterKeyProvider,
      userDataPath
    }
  } catch (error) {
    repository?.close()
    keyMaterial.masterKey.fill(0)
    keys.databaseKey.fill(0)
    keys.mappingKey.fill(0)
    keys.fileVaultKey.fill(0)
    throw error
  }
}

function createVerifiedPreview(
  repository: EncryptedApplicationRepository,
  input: ReturnType<typeof workTaskInputSchema.parse>
): WorkTaskPreview {
  const files = repository.getStagedFiles(input.fileTokens)
  if (files.length !== input.fileTokens.length) throw new Error('選択したファイルが見つからないか、期限切れです。')
  if (input.scopeId === 'selected-files' && files.length === 0) {
    throw new Error('ローカルファイルを1件以上選択してください。')
  }
  if (input.scopeId !== 'selected-files' && files.length > 0) {
    throw new Error('ファイルトークンとデータ範囲が一致しません。')
  }
  if ((input.scopeId === 'selected-case') !== Boolean(input.jobCaseId)) {
    throw new Error('選択案件の範囲と案件IDが一致しません。')
  }
  const fileBindings = files.map((file) => ({
    objectType: 'staged-file' as const,
    objectId: file.token,
    version: file.sha256
  }))
  const selectedJobCase = input.jobCaseId
    ? repository.listActiveJobCases().find((jobCase) => jobCase.id === input.jobCaseId) ?? null
    : null
  if (input.jobCaseId && !selectedJobCase) throw new Error('選択した確認済み案件は利用できません。')
  const contextBindings = selectedJobCase
    ? [{ objectType: 'job-case' as const, objectId: selectedJobCase.id, version: String(selectedJobCase.version) }]
    : fileBindings
  const preview = createWorkTaskPreview(input.instruction, getDataScope(input.scopeId), contextBindings)
  if (files.length > 0 && preview.type !== 'IMPORT_RESUME') {
    throw new Error('添付ファイルは現在スキルシート取込タスクだけで使用できます。作業内容を確認してください。')
  }
  if (selectedJobCase && preview.type !== 'MATCH_CANDIDATES') {
    throw new Error('選択案件は候補者マッチング作業だけに使用できます。')
  }
  return preview
}

function rendererSafeFile(record: ReturnType<EncryptedApplicationRepository['getStagedFileRecords']>[number]): StagedLocalFile {
  const { encryptedPath: _encryptedPath, ...metadata } = record
  return metadata
}

function documentTextForLocalPrivacy(document: Awaited<ReturnType<ParserWorkerClient['parse']>>): string {
  return document.blocks
    .map((block) => {
      const location = block.source.page
        ? `PAGE:${block.source.page}`
        : block.source.sheet && block.source.cell
          ? `SHEET:${block.source.sheet}!${block.source.cell}`
          : block.source.paragraph
            ? `PARAGRAPH:${block.source.paragraph}`
            : 'SOURCE:UNKNOWN'
      return `[${location}] ${block.text}`
    })
    .join('\n')
}

async function runGmailSync(
  repository: EncryptedApplicationRepository,
  googleWorkspace: GoogleWorkspaceOAuthClient,
  localNer: LocalPersonNameDetectorPort | null,
  config: GmailSyncConfiguration
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
  for (const message of repository.listGmailMessagesPendingJobCaseDrafts(accountEmail)) {
    try {
      const source = repository.ensureGmailJobCaseSource(createGmailJobCaseSource({
        accountEmail: message.accountEmail,
        gmailMessageId: message.gmailMessageId,
        threadId: message.threadId,
        fromDomain: message.fromDomain,
        messageDate: message.internalDate,
        redactedSubject: message.redactedSubject,
        redactedBody: message.redactedBody,
        redactionSessionId: message.redactionSessionId,
        warningCodes: message.warningCodes,
        createdAt: message.importedAt
      }, randomUUID()))
      repository.saveJobCaseDraft(extractJobCaseDraft(source, randomUUID()))
    } catch {
      // The redacted Gmail record remains pending and will be retried on the next local synchronization.
    }
  }
  return gmailSyncState(repository, googleState, config)
}

async function verifyStagedRecovery(
  staged: StagedRecoveryPackage,
  currentSchemaVersion: number
): Promise<void> {
  if (staged.manifest.source.schemaVersion > currentSchemaVersion) {
    throw new Error(`この復元パッケージは新しい Schema v${staged.manifest.source.schemaVersion} で作成されています。アプリを更新してください。`)
  }
  const keys = deriveApplicationKeys(staged.masterKey)
  const repository = new EncryptedApplicationRepository({
    path: staged.databasePath,
    databaseKey: keys.databaseKey,
    mappingKey: keys.mappingKey
  })
  try {
    repository.rebindStagedFilePaths(staged.vaultDirectory)
    const records = repository.listStagedFileRecords()
    const expectedTokens = new Set(staged.manifest.vaultObjects.map((object) => basename(object.path, '.sesv')))
    if (records.length !== expectedTokens.size || records.some((record) => !expectedTokens.has(record.token))) {
      throw new Error('復元パッケージのデータベースとファイル Manifest が一致しません。')
    }
    const vault = new EncryptedFileVault({ directory: staged.vaultDirectory, key: keys.fileVaultKey })
    for (const record of records) {
      const plaintext = await vault.decryptForLocalProcessing(record)
      plaintext.fill(0)
    }
  } finally {
    repository.close()
    keys.databaseKey.fill(0)
    keys.mappingKey.fill(0)
    keys.fileVaultKey.fill(0)
  }
}

function registerIpcHandlers(
  repository: EncryptedApplicationRepository,
  fileVault: EncryptedFileVault,
  parserWorker: ParserWorkerClient,
  candidateRetrieval: LocalHybridCandidateRetrieval,
  localRerankerEnabled: boolean,
  localOcr: LocalOcrPort | null,
  localAiStatus: LocalAiRuntime['status'],
  localNer: LocalPersonNameDetectorPort | null,
  googleWorkspace: GoogleWorkspaceOAuthClient | null,
  aiCommerce: AiCommerceNativeClient | null,
  googleWorkspaceDomain: string | null,
  googleWorkspaceConfiguration: GoogleWorkspaceAdminConfiguration | null,
  gmailSyncConfig: GmailSyncConfiguration | null,
  masterKey: Buffer,
  masterKeyProvider: SafeStorageMasterKeyProvider,
  userDataPath: string
): () => void {
  const conversationalMatchingEnabled = process.env.SES_CONVERSATIONAL_MATCHING_ENABLED !== '0'
  const agentChatModelCatalog = loadAgentChatModelCatalog()
  let gmailSyncInFlight: Promise<GmailSyncState> | null = null
  let emlImportBusy = false
  let recoveryBusy = false
  let candidateEvaluationBusy = false
  let aiCommercePromptBusy = false
  let wechatVisibleReadBusy = false
  let recoveryPreview: {
    token: string
    staged: StagedRecoveryPackage
    expiresAt: Date
  } | null = null
  const proposalMutations = new Set<string>()
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
  let safeLocalDispatcher: SafeLocalProcessingDispatcher<ProcessingJobSummary> | null = null
  const withTaskOperation = async <T>(taskId: string, operation: () => Promise<T> | T): Promise<T> => {
    if (activeTaskOperations.has(taskId)) throw new Error('この作業に対する別の処理が進行中です。完了後にもう一度操作してください。')
    activeTaskOperations.add(taskId)
    try {
      return await operation()
    } finally {
      activeTaskOperations.delete(taskId)
    }
  }
  const withProposalMutation = async <T>(key: string, operation: () => Promise<T> | T): Promise<T> => {
    if (proposalMutations.has(key)) throw new Error('同じ提案に対する別の処理が進行中です。')
    proposalMutations.add(key)
    try {
      return await operation()
    } finally {
      proposalMutations.delete(key)
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

  ipcMain.handle(
    ipcChannels.saveLocalOperatorProfile,
    (event, rawInput): LocalOperatorProfile => {
      assertTrustedSender(event)
      const input: SaveLocalOperatorProfileInput = saveLocalOperatorProfileInputSchema.parse(rawInput)
      return repository.saveLocalOperatorProfile(input)
    }
  )

  ipcMain.handle(ipcChannels.connectAiCommerce, async (event): Promise<AiCommerceMembershipState> => {
    assertTrustedSender(event)
    if (!aiCommerce) throw new Error('AICommerce の受管接続設定がありません。')
    return aiCommerce.beginConnect()
  })

  ipcMain.handle(ipcChannels.getAiCommerceDashboard, async (event): Promise<AiCommerceMembershipState> => {
    assertTrustedSender(event)
    if (!aiCommerce) return unconfiguredAiCommerceState()
    return aiCommerce.getDashboard()
  })

  ipcMain.handle(ipcChannels.disconnectAiCommerce, async (event): Promise<AiCommerceMembershipState> => {
    assertTrustedSender(event)
    return aiCommerce ? aiCommerce.disconnect() : unconfiguredAiCommerceState()
  })

  ipcMain.handle(ipcChannels.resetAiCommerceToken, async (event): Promise<AiCommerceMembershipState> => {
    assertTrustedSender(event)
    if (!aiCommerce) throw new Error('AICommerce の受管接続設定がありません。')
    return aiCommerce.resetAccountAiToken()
  })

  ipcMain.handle(ipcChannels.openAiCommerceMemberCenter, async (event): Promise<{ opened: true }> => {
    assertTrustedSender(event)
    if (!aiCommerce) throw new Error('AICommerce の受管接続設定がありません。')
    const memberCenter = new URL('/account', aiCommerce.configuration.membersBaseUrl).toString()
    await shell.openExternal(memberCenter)
    return { opened: true }
  })

  ipcMain.handle(
    ipcChannels.prepareAiCommerceCloudPrompt,
    async (event, rawInput): Promise<PrepareAiCommerceCloudPromptResult> => {
      assertTrustedSender(event)
      if (!cloudAiReview) throw new Error('AICommerce の受管接続設定がありません。')
      if (aiCommercePromptBusy) throw new Error('別の Cloud AI 要求が進行中です。完了後にもう一度実行してください。')
      const input = prepareAiCommerceCloudPromptInputSchema.parse(rawInput)
      aiCommercePromptBusy = true
      try {
        return await cloudAiReview.prepare(input.content, currentOperator().operatorId)
      } finally {
        aiCommercePromptBusy = false
      }
    }
  )

  ipcMain.handle(
    ipcChannels.executeAiCommerceCloudPrompt,
    async (event, rawInput): Promise<AiCommerceCloudPromptResult> => {
      assertTrustedSender(event)
      if (!cloudAiReview) throw new Error('AICommerce の受管接続設定がありません。')
      if (aiCommercePromptBusy) throw new Error('別の Cloud AI 要求が進行中です。完了後にもう一度実行してください。')
      const input = executeAiCommerceCloudPromptInputSchema.parse(rawInput)
      aiCommercePromptBusy = true
      try {
        const execution = await cloudAiReview.execute(input.reviewTicket, currentOperator().operatorId)
        const response = validateCloudAiResponseForDisplay(execution.response)
        return {
          ...response,
          removedIdentifierTypes: execution.removedIdentifierTypes
        }
      } finally {
        aiCommercePromptBusy = false
      }
    }
  )

  ipcMain.handle(
    ipcChannels.saveLocalApplicationPreferences,
    (event, rawInput): LocalApplicationPreferences => {
      assertTrustedSender(event)
      const input: SaveLocalApplicationPreferencesInput = saveLocalApplicationPreferencesInputSchema.parse(rawInput)
      return repository.saveLocalApplicationPreferences(input)
    }
  )

  ipcMain.handle(
    ipcChannels.listAiConversations,
    (event, rawContext): AiConversationSnapshot[] => {
      assertTrustedSender(event)
      const context: AiConversationContext = aiConversationContextSchema.parse(rawContext)
      return repository.listAiConversations(context)
    }
  )

  ipcMain.handle(
    ipcChannels.saveAiConversation,
    (event, rawInput): AiConversationSnapshot => {
      assertTrustedSender(event)
      const input = saveAiConversationInputSchema.parse(rawInput)
      if (input.context.assistant === 'sales-agent') {
        throw new Error('Sales Agent 会话只能通过 executeAgentTurn 保存。')
      }
      return repository.saveAiConversation(input)
    }
  )

  ipcMain.handle(
    ipcChannels.deleteAiConversations,
    (event, rawInput): DeleteAiConversationsResult => {
      assertTrustedSender(event)
      const input = deleteAiConversationsInputSchema.parse(rawInput)
      return { deletedConversationIds: repository.deleteAiConversations(input.conversationIds) }
    }
  )

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

  ipcMain.handle(ipcChannels.syncGoogleWorkspace, async (event): Promise<GmailSyncState> => {
    assertTrustedSender(event)
    if (!googleWorkspace) throw new Error('Google Workspace OAuth の管理者設定が必要です。')
    if (!gmailSyncConfig) throw new Error('Gmail Label・Query・回溯期間の管理者設定が必要です。')
    if (gmailSyncInFlight) return gmailSyncInFlight
    const configurationFingerprint = createHash('sha256').update(JSON.stringify(gmailSyncConfig)).digest('hex')
    const actionRunId = preflightAction('gmail.sync.read', {
      origin: 'managed-connector', workTaskId: null, scopeId: 'selected-gmail-message',
      scopeFingerprint: configurationFingerprint, actorId: currentOperator().operatorId, contentRevision: null
    }, { configurationFingerprint }, '管理者が固定した Gmail 読取範囲を端末内へ同期します。', `gmail-sync:${randomUUID()}`)
    repository.updateActionRun(actionRunId, 'running')
    gmailSyncInFlight = runGmailSync(repository, googleWorkspace, localNer, gmailSyncConfig)
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
  })

  const discardRecoveryPreview = async () => {
    if (!recoveryPreview) return
    const preview = recoveryPreview
    recoveryPreview = null
    await discardStagedRecovery(preview.staged)
  }

  const expireRecoveryPreview = async () => {
    if (recoveryPreview && recoveryPreview.expiresAt.getTime() <= Date.now()) await discardRecoveryPreview()
  }

  ipcMain.handle(ipcChannels.getRecoveryState, async (event): Promise<RecoveryState> => {
    assertTrustedSender(event)
    return repository.getRecoveryState(await hasPendingRestore(userDataPath))
  })

  ipcMain.handle(ipcChannels.createRecoveryPackage, async (event, rawInput): Promise<CreateRecoveryPackageResult> => {
    assertTrustedSender(event)
    const input = createRecoveryPackageInputSchema.parse(rawInput)
    if (recoveryBusy) throw new Error('別のバックアップまたは復元確認が進行中です。')
    recoveryBusy = true
    const temporaryDirectory = join(userDataPath, 'recovery', 'backup-work', randomUUID())
    let snapshotRepository: EncryptedApplicationRepository | null = null
    let snapshotKeys: ReturnType<typeof deriveApplicationKeys> | null = null
    try {
      const selection = await dialog.showSaveDialog({
        title: '暗号化復元パッケージを保存',
        defaultPath: `ses-agent-${new Date().toISOString().slice(0, 10)}.ses-recovery`,
        filters: [{ name: 'SES Agent Recovery', extensions: ['ses-recovery'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      })
      if (selection.canceled || !selection.filePath) {
        return { cancelled: true, fileName: null, packageHash: null, summary: null }
      }
      const outputPath = selection.filePath.endsWith('.ses-recovery')
        ? selection.filePath
        : `${selection.filePath}.ses-recovery`
      const snapshotPath = join(temporaryDirectory, 'ses-agent.db')
      const snapshot = await repository.createConsistentSnapshot(snapshotPath)
      snapshotKeys = deriveApplicationKeys(masterKey)
      snapshotRepository = new EncryptedApplicationRepository({
        path: snapshotPath,
        databaseKey: snapshotKeys.databaseKey,
        mappingKey: snapshotKeys.mappingKey
      })
      const vaultObjects = snapshotRepository.listStagedFileRecords().map((record) => {
        const expectedPath = join(userDataPath, 'vault', 'resume-files', `${record.token}.sesv`)
        if (record.encryptedPath !== expectedPath) {
          throw new Error('暗号化ファイルの保存場所が管理対象ディレクトリと一致しません。')
        }
        return { token: record.token, sourcePath: record.encryptedPath }
      })
      const platform = process.platform === 'darwin' || process.platform === 'win32' ? process.platform : null
      if (!platform) throw new Error('このプラットフォームでは復元パッケージを作成できません。')
      const created = await createRecoveryPackage({
        outputPath,
        databaseSnapshotPath: snapshotPath,
        vaultObjects,
        masterKey,
        password: input.password,
        source: {
          appVersion: app.getVersion(),
          platform,
          arch: process.arch,
          schemaVersion: snapshotRepository.getSchemaVersion()
        }
      })
      try {
        repository.recordRecoveryEvent(
          'backup-created', created.summary, created.packageHash, new Date(), snapshot.dataRevision
        )
      } catch (error) {
        await rm(outputPath, { force: true })
        throw error
      }
      return {
        cancelled: false,
        fileName: basename(outputPath),
        packageHash: created.packageHash,
        summary: created.summary
      }
    } finally {
      snapshotRepository?.close()
      snapshotKeys?.databaseKey.fill(0)
      snapshotKeys?.mappingKey.fill(0)
      snapshotKeys?.fileVaultKey.fill(0)
      await rm(temporaryDirectory, { recursive: true, force: true })
      recoveryBusy = false
    }
  })

  ipcMain.handle(ipcChannels.snoozeRecoveryReminder, async (event, rawInput): Promise<RecoveryState> => {
    assertTrustedSender(event)
    const input = snoozeRecoveryReminderInputSchema.parse(rawInput)
    repository.snoozeRecoveryReminder(input.days)
    return repository.getRecoveryState(await hasPendingRestore(userDataPath))
  })

  ipcMain.handle(ipcChannels.previewRecoveryPackage, async (event, rawInput): Promise<RecoveryPreviewResult> => {
    assertTrustedSender(event)
    const input = previewRecoveryPackageInputSchema.parse(rawInput)
    if (recoveryBusy) throw new Error('別のバックアップまたは復元確認が進行中です。')
    recoveryBusy = true
    let staged: StagedRecoveryPackage | null = null
    try {
      await expireRecoveryPreview()
      const selection = await dialog.showOpenDialog({
        title: '暗号化復元パッケージを選択',
        filters: [{ name: 'SES Agent Recovery', extensions: ['ses-recovery'] }],
        properties: ['openFile']
      })
      const packagePath = selection.filePaths[0]
      if (selection.canceled || !packagePath) {
        return {
          cancelled: true,
          restoreToken: null,
          confirmationHash: null,
          expiresAt: null,
          summary: null,
          warnings: []
        }
      }
      await discardRecoveryPreview()
      const token = randomUUID()
      const stagingDirectory = join(userDataPath, 'recovery', 'previews', token)
      staged = await stageRecoveryPackage({ packagePath, password: input.password, stagingDirectory })
      await verifyStagedRecovery(staged, repository.getSchemaVersion())
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
      recoveryPreview = { token, staged, expiresAt }
      return {
        cancelled: false,
        restoreToken: token,
        confirmationHash: staged.confirmationHash,
        expiresAt: expiresAt.toISOString(),
        summary: staged.summary,
        warnings: [
          '現在のローカルデータは再起動時に置き換えられます。',
          'Google Workspace の認証情報は復元されず、再接続が必要です。',
          'アプリ外へ書き出したファイルは復元対象外です。'
        ]
      }
    } catch (error) {
      if (staged && recoveryPreview?.staged !== staged) await discardStagedRecovery(staged)
      throw error
    } finally {
      recoveryBusy = false
    }
  })

  ipcMain.handle(ipcChannels.confirmRecovery, async (event, rawInput): Promise<ConfirmRecoveryResult> => {
    assertTrustedSender(event)
    const input = confirmRecoveryInputSchema.parse(rawInput)
    if (recoveryBusy) throw new Error('別のバックアップまたは復元確認が進行中です。')
    recoveryBusy = true
    try {
      await expireRecoveryPreview()
      const preview = recoveryPreview
      if (!preview || preview.token !== input.restoreToken) throw new Error('復元確認の有効期限が切れました。もう一度検証してください。')
      if (preview.staged.confirmationHash !== input.confirmationHash) throw new Error('復元対象が変更されました。もう一度検証してください。')
      const protectedMasterKeyPath = join(dirname(preview.staged.databasePath), '..', 'security', 'master-key.v1')
      await masterKeyProvider.writeProtectedMasterKey(protectedMasterKeyPath, preview.staged.masterKey)
      await schedulePendingRestore({
        userDataPath,
        restoreToken: preview.token,
        stagingDirectory: join(dirname(preview.staged.databasePath), '..'),
        packageHash: preview.staged.packageHash,
        confirmationHash: preview.staged.confirmationHash,
        summary: preview.staged.summary
      })
      preview.staged.masterKey.fill(0)
      recoveryPreview = null
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 250)
      return { scheduled: true, restartRequired: true }
    } finally {
      recoveryBusy = false
    }
  })

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

  ipcMain.handle(ipcChannels.searchCandidateProfiles, async (event, rawInput) => {
    assertTrustedSender(event)
    const input = searchCandidateProfilesInputSchema.parse(rawInput)
    return searchCandidates(input.query, input.maxResults)
  })

  const runCandidateMatchTask = async (
    taskId: string,
    existingJobId: string | null = null,
    agentTurn?: Pick<AgentToolExecutionMetadata, 'conversationId' | 'turnId' | 'requestId'>
  ): Promise<CandidateMatchTaskExecutionResult> => {
      const task = repository.getWorkTask(taskId)
      if (!task) throw new Error('候補者検索タスクが見つかりません。')
      if (task.type !== 'MATCH_CANDIDATES') throw new Error('このタスクは候補者検索ではありません。')
      assertWorkTaskAllowsExecution(task)
      const jobCaseBinding = task.contextBindings.find((binding) => binding.objectType === 'job-case') ?? null
      const boundJobCase = jobCaseBinding
        ? repository.listActiveJobCases().find((jobCase) =>
            jobCase.id === jobCaseBinding.objectId && String(jobCase.version) === jobCaseBinding.version
          ) ?? null
        : null
      if (jobCaseBinding && !boundJobCase) {
        throw new Error('案件が更新またはアーカイブされました。現在の案件からマッチングを作り直してください。')
      }
      const query = boundJobCase
        ? candidateBenchmarkQueryFromJobCase(boundJobCase)
        : candidateSearchQueryFromInstruction(task.instruction)
      const profiles = repository.listEligibleTalentProfiles()
      const requestFingerprint = createHash('sha256').update(JSON.stringify({
        version: 'candidate-match-job-v1',
        query,
        contextBindings: task.contextBindings,
        model: currentMatchRuntimeIdentity,
        profiles: profiles.map((profile) => ({
          id: profile.id,
          version: profile.profileVersion,
          fields: profile.fields,
          projectExperiences: profile.projectExperiences
        }))
      })).digest('hex')
      const idempotencyKey = createHash('sha256')
        .update(`candidate-match:${task.id}:${requestFingerprint}`)
        .digest('hex')
      const existingAgentConversation = agentTurn
        ? repository.getAiConversation(agentTurn.conversationId)
        : null
      const persistedAgentConversationId = existingAgentConversation?.context.assistant === 'sales-agent'
        ? agentTurn?.conversationId ?? null
        : null
      const actionRunId = preflightAction('candidate.match.local', {
        origin: 'work-task', workTaskId: task.id, scopeId: task.scope.id,
        scopeFingerprint: requestFingerprint, actorId: currentOperator().operatorId,
        contentRevision: task.updatedAt,
        conversationId: persistedAgentConversationId,
        turnId: persistedAgentConversationId ? agentTurn?.turnId ?? null : null
      }, { taskId: task.id }, '確認済み候補者プールを端末内で照合します。', idempotencyKey)
      const toAgentToolError = (cause: unknown): unknown => {
        if (!agentTurn) return cause
        if (cause instanceof AgentExecutionError) {
          return new AgentExecutionError(cause.code, cause.message, actionRunId)
        }
        return new AgentExecutionError('AGENT_TOOL_FAILED', '候補者マッチングツールの実行に失敗しました。', actionRunId)
      }
      try {
        const initialProcessingJob = existingJobId
          ? repository.getProcessingJob(existingJobId)
          : repository.enqueueProcessingJob({
              type: 'candidate-match',
              workTaskId: task.id,
              taskStepId: task.steps[1]?.id ?? 'step-2',
              idempotencyKey,
              requestFingerprint,
              payloadRef: `work-task:${task.id}:candidate-match`,
              replayPolicy: 'safe-local',
              maxAttempts: 3
            })
        if (!initialProcessingJob || initialProcessingJob.type !== 'candidate-match' || initialProcessingJob.workTaskId !== task.id) {
          throw new Error('候補者検索ジョブと作業の関連が一致しません。')
        }
        let processingJob: ProcessingJobSummary = initialProcessingJob
        if (processingJob.status !== 'succeeded') repository.updateActionRun(actionRunId, 'running', { processingJobId: processingJob.id })
        const dispatchReference = repository.getProcessingJobDispatchReference(processingJob.id)
        if (dispatchReference?.payloadRef !== `work-task:${task.id}:candidate-match`) {
          processingJob = failPendingProcessingJob(processingJob.id, 'PAYLOAD_REFERENCE_INVALID') ?? processingJob
          repository.saveWorkTask(recordCandidateMatchFailure(task, 'PAYLOAD_REFERENCE_INVALID'))
          throw new Error('候補者検索ジョブのローカル参照が無効です。作業を再実行してください。')
        }
        if (dispatchReference.requestFingerprint !== requestFingerprint) {
          processingJob = failPendingProcessingJob(processingJob.id, 'REQUEST_FINGERPRINT_STALE') ?? processingJob
          repository.saveWorkTask(recordCandidateMatchFailure(task, 'REQUEST_FINGERPRINT_STALE'))
          throw new Error('候補者プールまたは検索条件が変わりました。作業を再実行してください。')
        }
        if (processingJob.status === 'failed' || processingJob.status === 'cancelled') {
          throw new Error('候補者検索ジョブは停止しています。作業を再実行してください。')
        }
        return await processingResources.run('local-ai', async () => {
        processingJob = repository.getProcessingJob(processingJob.id) ?? processingJob
        if (processingJob.status === 'failed' || processingJob.status === 'cancelled') {
          throw new Error('候補者検索ジョブは停止しています。作業を再実行してください。')
        }
        const lease = processingJob.status === 'succeeded'
          ? null
          : repository.acquireProcessingJob(processingJob.id, 5 * 60_000)
        if (processingJob.status !== 'succeeded' && !lease) {
          throw new Error('候補者検索ジョブは別の処理で実行中か、再試行待ちです。')
        }
        if (lease) {
          const latestTask = repository.getWorkTask(task.id)
          if (!latestTask) throw new Error('候補者検索タスクが見つかりません。')
          assertWorkTaskAllowsExecution(latestTask)
          const startedTask = recordCandidateMatchStarted(latestTask, lease.job.attemptCount)
          repository.saveWorkTask(startedTask)
          processingJob = repository.updateProcessingJobProgress(processingJob.id, lease.leaseToken, 20)
        }
        try {
          if (lease && repository.isProcessingJobCancellationRequested(processingJob.id, lease.leaseToken)) {
            repository.completeProcessingJob(processingJob.id, lease.leaseToken, { cancelled: true })
            throw new Error('候補者検索ジョブをキャンセルしました。')
          }
          const matches = query
            ? await searchCandidates(query, 20)
            : []
          if (lease && repository.isProcessingJobCancellationRequested(processingJob.id, lease.leaseToken)) {
            repository.completeProcessingJob(processingJob.id, lease.leaseToken, { cancelled: true })
            throw new Error('候補者検索ジョブをキャンセルしました。')
          }
          if (lease) processingJob = repository.updateProcessingJobProgress(processingJob.id, lease.leaseToken, 85)
          const latestTask = repository.getWorkTask(taskId)
          if (!latestTask) throw new Error('候補者検索タスクが見つかりません。')
          assertWorkTaskAllowsExecution(latestTask)
          const persisted = repository.saveCandidateMatchRun(
            latestTask.id,
            query,
            matches,
            new Date(),
            currentMatchRuntimeIdentity
          )
          const evidenceCount = matches.reduce((total, match) => total + Math.max(1, match.evidence.length), 0)
          const updatedTask = recordCandidateMatchExecution(latestTask, Boolean(query), evidenceCount, new Date(), {
            objectId: persisted.run.id,
            contentHash: persisted.run.resultSetHash
          })
          if (updatedTask !== latestTask) repository.saveWorkTask(updatedTask)
          if (lease) {
            const completion = repository.completeProcessingJob(processingJob.id, lease.leaseToken, {
              version: 'candidate-match-job-result-v1',
              runId: persisted.run.id,
              resultSetHash: persisted.run.resultSetHash,
              resultCount: persisted.matches.length
            })
            if (!completion.accepted) throw new Error('候補者検索ジョブをキャンセルしました。')
            processingJob = completion.job
          }
          repository.updateActionRun(actionRunId, 'succeeded', { processingJobId: processingJob.id, resultHash: persisted.run.resultSetHash })
          return { task: updatedTask, query, run: persisted.run, matches: persisted.matches, processingJob, actionRunId }
        } catch (cause) {
          if (lease) {
            const activeJob = repository.getProcessingJob(processingJob.id)
            if (activeJob?.status === 'running') {
              processingJob = repository.failProcessingJob(
                processingJob.id,
                lease.leaseToken,
                'CANDIDATE_MATCH_FAILED',
                true
              )
            }
            const latestTask = repository.getWorkTask(taskId)
            if (latestTask && latestTask.status !== 'cancelled' && processingJob.status !== 'cancelled') {
              const errorCode = processingJob.errorCode ?? 'CANDIDATE_MATCH_FAILED'
              repository.saveWorkTask(
                processingJob.status === 'retry_wait' && processingJob.nextRetryAt
                  ? recordCandidateMatchRetryScheduled(latestTask, errorCode, processingJob.nextRetryAt)
                  : recordCandidateMatchFailure(latestTask, errorCode)
              )
            }
          }
          repository.updateActionRun(actionRunId, processingJob.status === 'cancelled' ? 'cancelled' : 'failed', {
            processingJobId: processingJob.id,
            errorCode: processingJob.errorCode ?? 'CANDIDATE_MATCH_FAILED'
          })
          throw cause
        }
        })
      } catch (cause) {
        const actionStatus = repository.getActionRunStatus(actionRunId)
        if (actionStatus && !['failed', 'cancelled', 'succeeded'].includes(actionStatus)) {
          repository.updateActionRun(actionRunId, 'failed', { errorCode: 'CANDIDATE_MATCH_FAILED' })
        }
        throw toAgentToolError(cause)
      }
  }

  ipcMain.handle(ipcChannels.executeCandidateMatchTask, async (event, rawTaskId): Promise<CandidateMatchTaskExecutionResult> => {
    assertTrustedSender(event)
    const taskId = executeCandidateMatchTaskInputSchema.parse(rawTaskId)
    return withTaskOperation(taskId, () => runCandidateMatchTask(taskId))
  })

  const agentIpcStop = registerAgentIpcHandlers({
    repository,
    actionOrchestrator,
    assertTrustedSender,
    conversationalMatchingEnabled: () => conversationalMatchingEnabled,
    locale: () => effectiveApplicationPreferences(repository).locale,
    currentOperator,
    currentMatchRuntimeIdentity,
    createMatchTask: (jobCaseId, jobCaseVersion) => {
      const preview = createVerifiedPreview(repository, {
        instruction: '为所选案件匹配确认人才',
        scopeId: 'selected-case',
        fileTokens: [],
        jobCaseId
      })
      if (preview.type !== 'MATCH_CANDIDATES') throw new Error('案件匹配任务无法创建。')
      const task = materializeWorkTask(preview, randomUUID(), new Date().toISOString())
      const binding = task.contextBindings.find((item) => item.objectType === 'job-case')
      if (!binding || binding.version !== String(jobCaseVersion)) throw new Error('案件版本已变化，请重新选择案件。')
      repository.saveWorkTask(task)
      return { taskId: task.id }
    },
    runCandidateMatchTask: (taskId, metadata) => withTaskOperation(
      taskId,
      () => runCandidateMatchTask(taskId, null, metadata)
    ),
    cancelMatchTask: (taskId) => {
      const task = repository.getWorkTask(taskId)
      if (!task) return
      repository.requestProcessingJobCancellationForTask(taskId)
      if (!['completed', 'cancelled', 'failed'].includes(task.status)) repository.saveWorkTask(cancelWorkTask(task))
    },
    modelCatalog: agentChatModelCatalog,
    narrativeStreamer: agentNarrativeStreamer
  })

  const candidateEvaluationAuthoringWorkspace = (): CandidateEvaluationAuthoringWorkspace => {
    const jobCases = repository.listActiveJobCases().flatMap((jobCase) => {
      const query = candidateBenchmarkQueryFromJobCase(jobCase)
      const title = jobCase.fields.find((field) => field.key === 'title')?.value ?? `案件 ${jobCase.id.slice(0, 8)}`
      return query.length >= 2 && detectDirectIdentifiers(`${title}\n${query}`).length === 0
        ? [{ id: jobCase.id, version: jobCase.version, title, query }]
        : []
    })
    const candidates = repository.listEligibleTalentProfiles().map((profile) => ({
      id: profile.id,
      version: profile.profileVersion,
      anonymousLabel: `候補者 ${profile.id.slice(0, 8).toLocaleUpperCase('en-US')}`,
      skills: profile.fields.find((field) => field.key === 'skills')?.value ?? null,
      experienceYears: profile.fields.find((field) => field.key === 'experience_years')?.value ?? null,
      availability: profile.fields.find((field) => field.key === 'availability')?.value ?? null,
      rate: profile.fields.find((field) => field.key === 'rate')?.value ?? null,
      japaneseLevel: profile.fields.find((field) => field.key === 'japanese_level')?.value ?? null,
      workStyle: profile.fields.find((field) => field.key === 'work_style')?.value ?? null,
      role: profile.fields.find((field) => field.key === 'role')?.value ?? null,
      fields: profile.fields,
      projectExperiences: profile.projectExperiences,
      projectExperienceCount: profile.projectExperiences.length
    }))
    return candidateEvaluationAuthoringWorkspaceSchema.parse({
      draft: repository.getCandidateEvaluationDraft(),
      jobCases,
      candidates
    })
  }

  const evaluateCandidateBenchmark = async (benchmark: SesCandidateBenchmark) => {
    const profiles = repository.listEligibleTalentProfiles()
    const candidateLabelCounts = new Map<string, number>()
    for (const profile of profiles) {
      const label = `候補者 ${profile.id.slice(0, 8).toLocaleUpperCase('en-US')}`
      candidateLabelCounts.set(label, (candidateLabelCounts.get(label) ?? 0) + 1)
    }
    const referencedLabels = new Set(benchmark.cases.flatMap((testCase) => testCase.relevantCandidateLabels))
    const ambiguousLabels = [...referencedLabels].filter((label) => (candidateLabelCounts.get(label) ?? 0) > 1)
    if (ambiguousLabels.length > 0) {
      throw new Error('匿名候補者番号が現在の候補者庫で重複しています。評価セットを作り直してください。')
    }
    return evaluateSesCandidateBenchmark(
      benchmark,
      new Set(candidateLabelCounts.keys()),
      (query, maxResults) => candidateRetrieval.search(profiles, query, maxResults),
      localRerankerEnabled
        ? {
            id: `${localEmbeddingModel.id}+${localRerankerModel.id}`,
            revision: `${localEmbeddingModel.revision}+${localRerankerModel.revision}`,
            algorithmVersion: 'hard-filter-hybrid-local-rerank-v1'
          }
        : { id: localEmbeddingModel.id, revision: localEmbeddingModel.revision }
    )
  }

  ipcMain.handle(ipcChannels.getCandidateEvaluationAuthoringWorkspace, (event): CandidateEvaluationAuthoringWorkspace => {
    assertTrustedSender(event)
    return candidateEvaluationAuthoringWorkspace()
  })

  ipcMain.handle(ipcChannels.createCandidateEvaluationDraft, (event, rawInput): CandidateEvaluationAuthoringWorkspace => {
    assertTrustedSender(event)
    const input = createCandidateEvaluationDraftInputSchema.parse(rawInput)
    repository.createCandidateEvaluationDraft(input)
    return candidateEvaluationAuthoringWorkspace()
  })

  ipcMain.handle(ipcChannels.saveCandidateEvaluationDraftCase, (event, rawInput): CandidateEvaluationAuthoringWorkspace => {
    assertTrustedSender(event)
    const input = saveCandidateEvaluationDraftCaseInputSchema.parse(rawInput)
    const operator = currentOperator()
    repository.saveCandidateEvaluationDraftCase(input, operator.operatorId, operator.displayName)
    return candidateEvaluationAuthoringWorkspace()
  })

  ipcMain.handle(ipcChannels.deleteCandidateEvaluationDraftCase, (event, rawInput): CandidateEvaluationAuthoringWorkspace => {
    assertTrustedSender(event)
    const input = deleteCandidateEvaluationDraftCaseInputSchema.parse(rawInput)
    repository.deleteCandidateEvaluationDraftCase(input)
    return candidateEvaluationAuthoringWorkspace()
  })

  ipcMain.handle(
    ipcChannels.evaluateCandidateEvaluationDraft,
    async (event, rawInput): Promise<EvaluateCandidateEvaluationDraftResult> => {
      assertTrustedSender(event)
      const input = evaluateCandidateEvaluationDraftInputSchema.parse(rawInput)
      if (candidateEvaluationBusy) throw new Error('別の候補者評価が進行中です。')
      candidateEvaluationBusy = true
      try {
        const benchmark = repository.buildCandidateEvaluationBenchmark(input.draftId, input.expectedRevision)
        const report = await evaluateCandidateBenchmark(benchmark)
        return {
          workspace: candidateEvaluationAuthoringWorkspace(),
          state: repository.saveCandidateEvaluation(benchmark, report)
        }
      } finally {
        candidateEvaluationBusy = false
      }
    }
  )

  ipcMain.handle(
    ipcChannels.importCandidateEvaluationBenchmark,
    async (event): Promise<ImportCandidateEvaluationBenchmarkResult> => {
      assertTrustedSender(event)
      if (candidateEvaluationBusy) throw new Error('別の候補者評価が進行中です。')
      candidateEvaluationBusy = true
      try {
        const selection = await dialog.showOpenDialog({
          title: '脱敏済み SES 候補者評価セットを選択',
          filters: [{ name: 'SES Candidate Benchmark', extensions: ['json'] }],
          properties: ['openFile', 'dontAddToRecent']
        })
        if (selection.canceled || selection.filePaths.length !== 1) {
          return { cancelled: true, state: repository.getCandidateEvaluationState() }
        }
        const inputPath = selection.filePaths[0]!
        const file = await lstat(inputPath)
        if (!file.isFile() || file.isSymbolicLink()) throw new Error('評価セットは通常の JSON ファイルを選択してください。')
        if (file.size <= 0 || file.size > 1024 * 1024) throw new Error('評価セットは 1 MB 以下である必要があります。')
        if (extname(inputPath).toLocaleLowerCase('en-US') !== '.json') throw new Error('評価セットは .json 形式である必要があります。')
        let raw: unknown
        try {
          raw = JSON.parse(await readFile(inputPath, 'utf8'))
        } catch {
          throw new Error('評価セットの JSON を読み取れませんでした。')
        }
        const benchmark = sesCandidateBenchmarkSchema.parse(raw)
        const privacyText = [benchmark.name, ...benchmark.cases.map((testCase) => testCase.query)].join('\n')
        const identifiers = detectDirectIdentifiers(privacyText)
        if (identifiers.length > 0 || /<(?:PERSON_NAME|PHONE|EMAIL|ADDRESS|PRIVATE_EMAIL)_\d+>/iu.test(privacyText)) {
          throw new Error('評価セットに個人識別情報または PII 占位符が含まれています。脱敏済み条件だけを使用してください。')
        }
        const report = await evaluateCandidateBenchmark(benchmark)
        return {
          cancelled: false,
          state: repository.saveCandidateEvaluation(benchmark, report)
        }
      } finally {
        candidateEvaluationBusy = false
      }
    }
  )

  ipcMain.handle(ipcChannels.submitCandidateMatchFeedback, (event, rawInput): SubmitCandidateMatchFeedbackResult => {
    assertTrustedSender(event)
    const input = submitCandidateMatchFeedbackInputSchema.parse(rawInput)
    return repository.submitCandidateMatchFeedback(input, currentOperator().displayName)
  })

  ipcMain.handle(ipcChannels.setBusinessPriorityOverride, (event, rawInput) => {
    assertTrustedSender(event)
    const input = setBusinessPriorityOverrideInputSchema.parse(rawInput)
    repository.setBusinessPriorityOverride(input, currentOperator().displayName)
    return repository.getMatchingHomeProjection(currentMatchRuntimeIdentity)
  })

  ipcMain.handle(ipcChannels.getCandidateProfileHistory, (event, rawSourceDocumentId) => {
    assertTrustedSender(event)
    const sourceDocumentId = candidateProfileSourceInputSchema.parse(rawSourceDocumentId)
    return repository.getCandidateProfileHistory(sourceDocumentId)
  })

  ipcMain.handle(ipcChannels.getOriginalDocumentPreview, (event, rawSourceDocumentId): OriginalDocumentPreview => {
    assertTrustedSender(event)
    const sourceDocumentId = candidateProfileSourceInputSchema.parse(rawSourceDocumentId)
    const document = repository.getParsedDocument(sourceDocumentId)
    const record = repository.getStagedFileRecords([sourceDocumentId])[0]
    if (!document || !record) throw new Error('原始ファイルを読み込めませんでした。')
    return buildOriginalDocumentPreview(
      document,
      repository.getCandidateLocalIdentity(sourceDocumentId),
      record.format === 'pdf' ? `ses-agent-original://document/${sourceDocumentId}` : null
    )
  })

  ipcMain.handle(ipcChannels.openOriginalDocument, async (event, rawSourceDocumentId): Promise<OpenOriginalDocumentResult> => {
    assertTrustedSender(event)
    const sourceDocumentId = candidateProfileSourceInputSchema.parse(rawSourceDocumentId)
    const record = repository.getStagedFileRecords([sourceDocumentId])[0]
    if (!record) throw new Error('原始ファイルが見つかりません。')
    const root = originalOpenRootPath ?? await prepareOriginalOpenRoot(userDataPath)
    const temporaryDirectory = join(root, randomUUID())
    const temporaryPath = await fileVault.materializeTemporaryCopy(record, temporaryDirectory)
    const error = await shell.openPath(temporaryPath)
    if (error) {
      await rm(temporaryDirectory, { recursive: true, force: true })
      throw new Error(`原始ファイルをシステムアプリで開けませんでした: ${error}`)
    }
    const cleanup = setTimeout(() => {
      void rm(temporaryDirectory, { recursive: true, force: true })
    }, 30 * 60_000)
    cleanup.unref()
    return { opened: true, fileName: record.name, cleanup: 'scheduled' }
  })

  ipcMain.handle(ipcChannels.updateCandidateProfile, (event, rawInput): UpdateCandidateProfileResult => {
    assertTrustedSender(event)
    const input = updateCandidateProfileInputSchema.parse(rawInput)
    const operator = currentOperator()
    const profile = repository.updateCandidateProfile(input, operator.operatorId, operator.displayName)
    const history = repository.getCandidateProfileHistory(input.sourceDocumentId)
    const candidate = searchConfirmedCandidateProfiles([profile], '', 1)[0]
    if (!candidate) throw new Error('更新した人材プロフィールを再読み込みできませんでした。')
    return {
      candidate: {
        ...candidate,
        localIdentity: repository.getCandidateLocalIdentity(input.sourceDocumentId)
      },
      history
    }
  })

  ipcMain.handle(ipcChannels.previewCandidateDeletion, (event, rawSourceDocumentId) => {
    assertTrustedSender(event)
    const sourceDocumentId = candidateProfileSourceInputSchema.parse(rawSourceDocumentId)
    return repository.previewCandidateDeletion(sourceDocumentId)
  })

  ipcMain.handle(ipcChannels.deleteCandidateData, async (event, rawInput): Promise<DeleteCandidateDataResult> => {
    assertTrustedSender(event)
    const input = deleteCandidateDataInputSchema.parse(rawInput)
    const preview = repository.previewCandidateDeletion(input.sourceDocumentId)
    if (preview.confirmationHash !== input.confirmationHash) {
      throw new Error('削除対象が変更されました。影響を再確認してください。')
    }
    const stagedFile = repository.getStagedFileRecords([input.sourceDocumentId])[0]
    if (!stagedFile) throw new Error('削除対象の暗号化ファイルが見つかりません。')
    const deletionId = randomUUID()
    const startedAt = new Date()
    const quarantined = await fileVault.quarantineStagedFile(stagedFile, deletionId)
    try {
      repository.deleteCandidateDatabaseData(input.sourceDocumentId, input.confirmationHash, startedAt)
    } catch (error) {
      if (quarantined) await fileVault.restoreQuarantinedFile(quarantined)
      throw error
    }
    let fileVaultStatus: DataDeletionReport['components']['fileVault'] = quarantined ? 'deleted' : 'not_present'
    const warningCodes = [...preview.warningCodes]
    const recoveryPackageExists = Boolean(repository.getRecoveryState().lastBackupAt)
    if (recoveryPackageExists) warningCodes.push('RECOVERY_PACKAGE_ROTATION_REQUIRED')
    if (quarantined) {
      try {
        await fileVault.purgeQuarantinedFile(quarantined)
      } catch {
        fileVaultStatus = 'failed'
        warningCodes.push('FILE_VAULT_PURGE_FAILED')
      }
    }
    const completedAt = new Date()
    const report = repository.saveDataDeletionReport({
      id: deletionId,
      entityType: 'candidate',
      entityIdHash: createHash('sha256').update(input.sourceDocumentId).digest('hex'),
      requestedBy: currentOperator().displayName,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      outcome: fileVaultStatus === 'failed' ? 'partial-failure' : 'completed',
      components: {
        database: 'deleted',
        fileVault: fileVaultStatus,
        searchIndex: preview.counts.searchIndexEntries > 0 ? 'deleted' : 'not_present',
        cache: 'not_present',
        temporaryFiles: 'not_present',
        backups: recoveryPackageExists ? 'expired_pending' : 'not_present'
      },
      deletedCounts: preview.counts,
      warningCodes: [...new Set(warningCodes)]
    })
    return {
      report,
      activeCandidateCount: repository.countEligibleTalentProfiles()
    }
  })

  ipcMain.handle(ipcChannels.listDataDeletionReports, (event) => {
    assertTrustedSender(event)
    return repository.listDataDeletionReports()
  })

  ipcMain.handle(ipcChannels.submitJobCaseReview, (event, rawInput): SubmitJobCaseReviewResult => {
    assertTrustedSender(event)
    const input = submitJobCaseReviewInputSchema.parse(rawInput)
    return {
      review: repository.confirmJobCaseReview(input, currentOperator().operatorId, currentOperator().displayName)
    }
  })

  ipcMain.handle(ipcChannels.createManualJobCaseDraft, async (event, rawInput): Promise<CreateManualJobCaseDraftResult> => {
    assertTrustedSender(event)
    const input = createManualJobCaseDraftInputSchema.parse(rawInput)
    const sourceId = randomUUID()
    const localText = `[SUBJECT]\n${input.subject}\n[BODY]\n${input.body}`
    let localNameDetection
    try {
      localNameDetection = await localNer?.detectNames(localText)
    } catch {
      localNameDetection = undefined
    }
    const knownPersonNames = collectLocalPersonNameCandidates(localText, localNameDetection)
    const now = new Date()
    const processed = createRedactedManualJobCaseSource(input, sourceId, knownPersonNames, now)
    const duplicate = repository.findJobCaseReviewByBusinessFingerprint(
      processed.source.redactedSubject,
      processed.source.redactedBody
    )
    const source = duplicate ? {
      ...processed.source,
      warningCodes: [...new Set([...processed.source.warningCodes, 'BUSINESS_DUPLICATE'])]
    } : processed.source
    const draft = extractJobCaseDraft(source, randomUUID(), now)
    if (!repository.saveRedactedJobCaseSourceAndDraft(
      processed.redaction.session,
      processed.redaction.mappings,
      source,
      draft
    )) {
      throw new Error('手動案件の草稿を作成できませんでした。')
    }
    const review = repository.getJobCaseReview(draft.reviewId)
    if (!review) throw new Error('作成した手動案件を再読み込みできませんでした。')
    return { review }
  })

  ipcMain.handle(
    ipcChannels.createChatPasteJobCaseDraft,
    async (event, rawInput): Promise<CreateChatPasteJobCaseDraftResult> => {
      assertTrustedSender(event)
      const input = createChatPasteJobCaseDraftInputSchema.parse(rawInput)
      const sourceId = randomUUID()
      let localNameDetection
      try {
        localNameDetection = await localNer?.detectNames(input.text)
      } catch {
        localNameDetection = undefined
      }
      const knownPersonNames = collectLocalPersonNameCandidates(input.text, localNameDetection)
      const now = new Date()
      const processed = createRedactedChatPasteJobCaseSource(input.text, sourceId, knownPersonNames, now)
      const duplicate = repository.findJobCaseReviewByBusinessFingerprint(
        processed.source.redactedSubject,
        processed.source.redactedBody
      )
      const source = duplicate ? {
        ...processed.source,
        warningCodes: [...new Set([...processed.source.warningCodes, 'BUSINESS_DUPLICATE'])]
      } : processed.source
      const draft = extractJobCaseDraft(source, randomUUID(), now)
      if (!repository.saveRedactedJobCaseSourceAndDraft(
        processed.redaction.session,
        processed.redaction.mappings,
        source,
        draft
      )) throw new Error('チャット貼り付け案件の草稿を作成できませんでした。')
      const review = repository.getJobCaseReview(draft.reviewId)
      if (!review) throw new Error('作成したチャット貼り付け案件を再読み込みできませんでした。')
      return { review }
    }
  )

  ipcMain.handle(
    ipcChannels.prepareWechatVisibleRead,
    async (event): Promise<PrepareWechatVisibleReadResult> => {
      assertTrustedSender(event)
      if (!wechatVisibleReader.isEnabled()) {
        return {
          status: 'blocked', scopeToken: null, expiresAt: null, countdownSeconds: 5,
          targetVersion: null, failureCodes: ['WECHAT_FEATURE_KILL_SWITCH_ACTIVE']
        }
      }
      if (wechatVisibleReadBusy) {
        return {
          status: 'blocked', scopeToken: null, expiresAt: null, countdownSeconds: 5,
          targetVersion: null, failureCodes: ['WECHAT_VISIBLE_READ_BUSY']
        }
      }
      let preflight
      try {
        [preflight] = await Promise.all([
          wechatVisibleReader.preflight(true),
          wechatVisibleReader.verifyNetworkIsolation()
        ])
      } catch (cause) {
        return {
          status: 'blocked', scopeToken: null, expiresAt: null, countdownSeconds: 5,
          targetVersion: null,
          failureCodes: [cause instanceof WechatVisibleReadError ? cause.code : 'WECHAT_PREFLIGHT_FAILED']
        }
      }
      const target = wechatVisibleReader.primaryTarget(preflight)
      const failureCodes = [
        ...(!preflight.accessibilityTrusted ? ['MACOS_ACCESSIBILITY_PERMISSION_REQUIRED'] : []),
        ...(!preflight.screenCaptureTrusted ? ['MACOS_SCREEN_CAPTURE_PERMISSION_REQUIRED'] : []),
        ...(!preflight.windowCaptureAvailable ? ['MACOS_14_REQUIRED_FOR_WINDOW_CAPTURE'] : []),
        ...(!target ? ['WECHAT_NOT_RUNNING'] : [])
      ]
      if (!target || failureCodes.length > 0) {
        return {
          status: 'blocked', scopeToken: null, expiresAt: null, countdownSeconds: 5,
          targetVersion: target?.version ?? null, failureCodes
        }
      }
      const actor = currentOperator()
      const requestNonce = randomUUID()
      const scopeFingerprint = createHash('sha256')
        .update(`${target.bundleIdentifier}|${target.processIdentifier}|${target.launchDate}`, 'utf8')
        .digest('hex')
      const actionRunId = preflightAction(
        'wechat.visible.read',
        {
          origin: 'user-command',
          workTaskId: null,
          scopeId: 'frontmost-wechat-visible-conversation',
          scopeFingerprint,
          actorId: actor.operatorId,
          contentRevision: target.version
        },
        {
          targetBundleIdentifier: target.bundleIdentifier,
          targetProcessIdentifier: target.processIdentifier,
          targetLaunchDate: target.launchDate,
          requestNonce
        },
        `Mac 微信 ${target.version} 的当前前台单一会话可见区域`,
        `wechat-visible:${requestNonce}`
      )
      const confirmation = await dialog.showMessageBox({
        type: 'warning',
        title: '本次读取微信可见消息',
        message: '只读取接下来前台微信单一窗口中当前可见的会话区域。',
        detail: [
          '确认后 SES Agent Desktop 会暂时隐藏，并切换到微信。',
          '5 秒后读取；不要在倒计时期间切换到其他聊天。',
          `微信 ${target.version} 的 AX 树若不暴露正文，将在本机断网 Helper 中使用窗口级截图与 Apple Vision OCR。`,
          '截图和原文不保存、不写日志、不发送网络；只保存本地脱敏后的案件草稿。'
        ].join('\n'),
        buttons: ['确认本次读取', '取消'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      })
      if (confirmation.response !== 0) {
        repository.updateActionRun(actionRunId, 'cancelled', { errorCode: 'USER_CANCELLED' })
        return {
          status: 'cancelled', scopeToken: null, expiresAt: null, countdownSeconds: 5,
          targetVersion: target.version, failureCodes: []
        }
      }
      repository.updateActionRun(actionRunId, 'awaiting_foreground_confirmation')
      const issued = wechatScopeTokens.issue({
        webContentsId: event.sender.id,
        actorId: actor.operatorId,
        target,
        actionRunId
      })
      return {
        status: 'ready', scopeToken: issued.scopeToken, expiresAt: issued.expiresAt,
        countdownSeconds: 5, targetVersion: target.version, failureCodes: []
      }
    }
  )

  ipcMain.handle(
    ipcChannels.executeWechatVisibleRead,
    async (event, rawInput): Promise<ExecuteWechatVisibleReadResult> => {
      assertTrustedSender(event)
      if (wechatVisibleReadBusy) throw new Error('另一项微信可见消息读取正在进行。')
      const input = executeWechatVisibleReadInputSchema.parse(rawInput)
      const actor = currentOperator()
      const scope = wechatScopeTokens.consume({
        scopeToken: input.scopeToken,
        webContentsId: event.sender.id,
        actorId: actor.operatorId
      })
      const ownerWindow = BrowserWindow.fromWebContents(event.sender)
      let rawText = ''
      let readResult: Awaited<ReturnType<MacWechatVisibleReader['readVisible']>> | null = null
      wechatVisibleReadBusy = true
      repository.updateActionRun(scope.actionRunId, 'running')
      try {
        ownerWindow?.hide()
        await wechatVisibleReader.activate(scope.target)
        await new Promise((resolveWait) => setTimeout(resolveWait, 5_000))
        readResult = await wechatVisibleReader.readVisible(scope.target)
        rawText = readResult.nodes.map((node) => node.text).join('\n').trim()
        for (const node of readResult.nodes) node.text = ''
        if (rawText.length < 8) {
          throw new WechatVisibleReadError('WECHAT_VISIBLE_MESSAGE_TEXT_UNAVAILABLE', '当前会话区域没有足够的可读消息。')
        }
        let localNameDetection
        try {
          localNameDetection = await localNer?.detectNames(rawText)
        } catch {
          localNameDetection = undefined
        }
        const knownPersonNames = collectLocalPersonNameCandidates(rawText, localNameDetection)
        const sourceId = randomUUID()
        const now = new Date()
        const processed = createRedactedWechatVisibleJobCaseSource(
          rawText,
          sourceId,
          knownPersonNames,
          { captureMethod: readResult.captureMethod, truncated: readResult.truncated },
          now
        )
        rawText = ''
        const duplicate = repository.findJobCaseReviewByBusinessFingerprint(
          processed.source.redactedSubject,
          processed.source.redactedBody
        )
        const source = duplicate ? {
          ...processed.source,
          warningCodes: [...new Set([...processed.source.warningCodes, 'BUSINESS_DUPLICATE'])]
        } : processed.source
        const draft = extractJobCaseDraft(source, randomUUID(), now)
        if (!repository.saveRedactedJobCaseSourceAndDraft(
          processed.redaction.session,
          processed.redaction.mappings,
          source,
          draft
        )) throw new Error('微信可见消息的脱敏案件草稿无法保存。')
        const review = repository.getJobCaseReview(draft.reviewId)
        if (!review) throw new Error('创建的微信案件草稿无法重新读取。')
        repository.updateActionRun(scope.actionRunId, 'succeeded', {
          resultHash: createHash('sha256')
            .update(`${source.redactedSubject}\n${source.redactedBody}`, 'utf8')
            .digest('hex')
        })
        return {
          review,
          evidence: {
            captureMethod: readResult.captureMethod,
            visibleTextNodeCount: readResult.nodes.length,
            rawUtf8Bytes: readResult.rawUtf8Bytes,
            truncated: readResult.truncated,
            rawTextPersisted: false,
            rawImagePersisted: false,
            networkAccess: false
          }
        }
      } catch (cause) {
        repository.updateActionRun(scope.actionRunId, 'failed', {
          errorCode: cause instanceof WechatVisibleReadError ? cause.code : 'WECHAT_VISIBLE_READ_FAILED'
        })
        throw cause
      } finally {
        rawText = ''
        if (readResult) for (const node of readResult.nodes) node.text = ''
        readResult = null
        wechatVisibleReadBusy = false
        if (ownerWindow && !ownerWindow.isDestroyed()) {
          ownerWindow.show()
          ownerWindow.focus()
        }
      }
    }
  )

  ipcMain.handle(ipcChannels.importEmlJobCaseDrafts, async (event): Promise<ImportEmlJobCaseDraftsResult> => {
    assertTrustedSender(event)
    if (emlImportBusy) throw new Error('別の EML 取込処理が進行中です。')
    emlImportBusy = true
    try {
      const selection = await dialog.showOpenDialog({
        title: '案件メール（.eml）を取り込む',
        message: `1回に最大${maxEmlFilesPerImport}件、1ファイル10 MBまで取り込めます。添付ファイルは保存しません。`,
        buttonLabel: 'ローカルで取り込む',
        filters: [{ name: 'メールファイル', extensions: ['eml'] }],
        properties: ['openFile', 'multiSelections', 'dontAddToRecent']
      })
      if (selection.canceled || selection.filePaths.length === 0) {
        return { cancelled: true, importedCount: 0, duplicateCount: 0, skippedCount: 0, failedCount: 0, items: [] }
      }
      if (selection.filePaths.length > maxEmlFilesPerImport) {
        throw new Error(`EML は1回に${maxEmlFilesPerImport}件まで選択できます。`)
      }

      const items: ImportEmlJobCaseDraftsResult['items'] = []
      for (const filePath of selection.filePaths) {
        const fileName = basename(filePath).slice(0, 180)
        let bytes: Buffer | null = null
        try {
          const selected = await readSelectedEmlFile(filePath)
          bytes = selected.bytes
          const parsed = await parserWorker.parseEml(selected.manifest, bytes)
          if (parsed.classification !== 'job-case') {
            items.push({
              fileName,
              status: 'skipped',
              classification: parsed.classification,
              errorCode: null,
              review: null
            })
            continue
          }
          const existing = repository.getEmlJobCaseReview(parsed.sourceMessageKey)
          if (existing) {
            items.push({ fileName, status: 'duplicate', classification: parsed.classification, errorCode: null, review: existing })
            continue
          }

          const sourceId = randomUUID()
          const localText = `[SUBJECT]\n${parsed.subject}\n[FROM]\n担当者：${parsed.senderDisplayName ?? ''}\n[BODY]\n${parsed.body}`
          let localNameDetection
          try {
            localNameDetection = await localNer?.detectNames(localText)
          } catch {
            localNameDetection = undefined
          }
          const knownPersonNames = collectLocalPersonNameCandidates(localText, localNameDetection)
          const now = new Date()
          const processed = createRedactedEmlJobCaseSource(parsed, sourceId, knownPersonNames, now)
          const draft = extractJobCaseDraft(processed.source, randomUUID(), now)
          try {
            repository.saveRedactedJobCaseSourceAndDraft(
              processed.redaction.session,
              processed.redaction.mappings,
              processed.source,
              draft
            )
          } catch (error) {
            const duplicate = repository.getEmlJobCaseReview(parsed.sourceMessageKey)
            if (duplicate) {
              items.push({ fileName, status: 'duplicate', classification: parsed.classification, errorCode: null, review: duplicate })
              continue
            }
            throw new EmlFileImportError('PERSISTENCE_FAILED', 'EML の脱敏済み案件草稿を保存できませんでした。')
          }
          const review = repository.getJobCaseReview(draft.reviewId)
          if (!review) throw new EmlFileImportError('PERSISTENCE_FAILED', '取り込んだ案件草稿を再読み込みできませんでした。')
          items.push({ fileName, status: 'imported', classification: parsed.classification, errorCode: null, review })
        } catch (error) {
          items.push({
            fileName,
            status: 'failed',
            classification: null,
            errorCode: error instanceof EmlFileImportError && error.code === 'PERSISTENCE_FAILED'
              ? 'PERSISTENCE_FAILED'
              : emlImportErrorCode(error),
            review: null
          })
        } finally {
          bytes?.fill(0)
        }
      }
      return {
        cancelled: false,
        importedCount: items.filter((item) => item.status === 'imported').length,
        duplicateCount: items.filter((item) => item.status === 'duplicate').length,
        skippedCount: items.filter((item) => item.status === 'skipped').length,
        failedCount: items.filter((item) => item.status === 'failed').length,
        items
      }
    } finally {
      emlImportBusy = false
    }
  })

  ipcMain.handle(ipcChannels.getJobCaseHistory, (event, rawReviewId) => {
    assertTrustedSender(event)
    const reviewId = jobCaseReviewIdSchema.parse(rawReviewId)
    return repository.getJobCaseHistory(reviewId)
  })

  ipcMain.handle(ipcChannels.setJobCaseLifecycle, (event, rawInput): SetJobCaseLifecycleResult => {
    assertTrustedSender(event)
    const input = setJobCaseLifecycleInputSchema.parse(rawInput)
    const review = repository.setJobCaseLifecycle(input, currentOperator().displayName)
    return { review, history: repository.getJobCaseHistory(input.reviewId) }
  })

  ipcMain.handle(ipcChannels.reopenJobCaseReview, (event, rawInput): ReopenJobCaseReviewResult => {
    assertTrustedSender(event)
    const input = reopenJobCaseReviewInputSchema.parse(rawInput)
    return { review: repository.reopenJobCaseReview(input, currentOperator().displayName) }
  })

  ipcMain.handle(ipcChannels.previewJobCaseDeletion, (event, rawReviewId) => {
    assertTrustedSender(event)
    const reviewId = jobCaseReviewIdSchema.parse(rawReviewId)
    return repository.previewJobCaseDeletion(reviewId)
  })

  ipcMain.handle(ipcChannels.deleteJobCaseData, (event, rawInput): DeleteJobCaseDataResult => {
    assertTrustedSender(event)
    const input = deleteJobCaseDataInputSchema.parse(rawInput)
    const startedAt = new Date()
    const preview = repository.deleteJobCaseDatabaseData(input, startedAt)
    const completedAt = new Date()
    const recoveryPackageExists = Boolean(repository.getRecoveryState().lastBackupAt)
    const report = repository.saveDataDeletionReport({
      id: randomUUID(),
      entityType: 'job_case',
      entityIdHash: createHash('sha256').update(input.reviewId).digest('hex'),
      requestedBy: currentOperator().displayName,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      outcome: 'completed',
      components: {
        database: 'deleted',
        fileVault: 'not_present',
        searchIndex: 'not_present',
        cache: 'not_present',
        temporaryFiles: 'not_present',
        backups: recoveryPackageExists ? 'expired_pending' : 'not_present'
      },
      deletedCounts: preview.counts,
      warningCodes: recoveryPackageExists
        ? [...new Set([...preview.warningCodes, 'RECOVERY_PACKAGE_ROTATION_REQUIRED'])]
        : preview.warningCodes
    })
    return { report }
  })

  ipcMain.handle(ipcChannels.getProposalWorkspace, (event, rawTaskId): ProposalWorkspaceSnapshot => {
    assertTrustedSender(event)
    return repository.getProposalWorkspace(proposalTaskIdSchema.parse(rawTaskId))
  })

  ipcMain.handle(ipcChannels.createProposalDraft, async (event, rawInput): Promise<ProposalMutationResult> => {
    assertTrustedSender(event)
    const input = createProposalDraftInputSchema.parse(rawInput)
    return withTaskOperation(input.taskId, () => withProposalMutation(`task:${input.taskId}`, () => {
      const task = repository.getWorkTask(input.taskId)
      if (!task) throw new Error('提案タスクが見つかりません。')
      assertWorkTaskAllowsExecution(task)
      const draft = repository.createProposalDraft(input, randomUUID(), currentOperator().displayName)
      const updatedTask = recordProposalDraftCreated(task, draft.attachment.fields.length + 2, new Date(), {
        objectId: draft.id,
        contentHash: draft.contentHash
      })
      repository.saveWorkTask(updatedTask)
      return { draft, task: updatedTask }
    }))
  })

  ipcMain.handle(ipcChannels.updateProposalDraft, async (event, rawInput): Promise<ProposalMutationResult> => {
    assertTrustedSender(event)
    const input = updateProposalDraftInputSchema.parse(rawInput)
    const currentDraft = repository.getProposalDraft(input.draftId)
    if (!currentDraft) throw new Error('提案草稿が見つかりません。')
    return withTaskOperation(currentDraft.taskId, () => withProposalMutation(input.draftId, () => {
      const task = repository.getWorkTask(currentDraft.taskId)
      if (!task) throw new Error('提案タスクが見つかりません。')
      assertWorkTaskAllowsExecution(task)
      const draft = repository.updateProposalDraft(input, currentOperator().displayName)
      const updatedTask = recordProposalDraftCreated(task, draft.attachment.fields.length + 2, new Date(), {
        objectId: draft.id,
        contentHash: draft.contentHash
      })
      repository.saveWorkTask(updatedTask)
      return { draft, task: updatedTask }
    }))
  })

  ipcMain.handle(ipcChannels.approveProposalDraft, async (event, rawInput): Promise<ProposalMutationResult> => {
    assertTrustedSender(event)
    const input = approveProposalDraftInputSchema.parse(rawInput)
    const currentDraft = repository.getProposalDraft(input.draftId)
    if (!currentDraft) throw new Error('提案草稿が見つかりません。')
    return withTaskOperation(currentDraft.taskId, () => withProposalMutation(input.draftId, () => {
      const task = repository.getWorkTask(currentDraft.taskId)
      if (!task) throw new Error('提案タスクが見つかりません。')
      assertWorkTaskAllowsExecution(task)
      const operator = currentOperator()
      const draft = repository.approveProposalDraft(input, operator.displayName)
      const updatedTask = recordProposalApproved(task, new Date(), operator.displayName)
      repository.saveWorkTask(updatedTask)
      return { draft, task: updatedTask }
    }))
  })

  ipcMain.handle(ipcChannels.exportProposalPackage, async (event, rawInput): Promise<ExportProposalPackageResult> => {
    assertTrustedSender(event)
    const input = exportProposalPackageInputSchema.parse(rawInput)
    const currentDraft = repository.getProposalDraft(input.draftId)
    if (!currentDraft) throw new Error('提案草稿が見つかりません。')
    return withTaskOperation(currentDraft.taskId, () => withProposalMutation(input.draftId, async () => {
      const draft = repository.getProposalDraft(input.draftId)
      if (!draft) throw new Error('提案草稿が見つかりません。')
      if (
        draft.revision !== input.revision ||
        draft.contentHash !== input.contentHash ||
        draft.approvedContentHash !== draft.contentHash ||
        !['approved', 'exported'].includes(draft.status)
      ) {
        throw new Error('現在の提案内容を承認してからエクスポートしてください。')
      }
      const task = repository.getWorkTask(draft.taskId)
      if (!task) throw new Error('提案タスクが見つかりません。')
      assertWorkTaskAllowsExecution(task)
      const actionRunId = preflightAction('proposal.export', {
        origin: 'work-task', workTaskId: task.id, scopeId: task.scope.id,
        scopeFingerprint: draft.contentHash, actorId: currentOperator().operatorId,
        contentRevision: `${draft.revision}:${draft.contentHash}`
      }, { taskId: task.id, draftId: draft.id, revision: draft.revision, contentHash: draft.contentHash },
      '承認済み提案パッケージを、保存先の選択後に端末へ書き出します。', `proposal-export:${randomUUID()}`)
      const owner = BrowserWindow.fromWebContents(event.sender)
      const defaultName = `proposal-${draft.id.slice(0, 8)}.zip`
      const saveOptions = {
        title: '承認済み提案パッケージを保存',
        defaultPath: defaultName,
        buttonLabel: '提案パッケージを書き出す',
        filters: [{ name: '提案パッケージ', extensions: ['zip'] }]
      }
      const selection = owner
        ? await dialog.showSaveDialog(owner, saveOptions)
        : await dialog.showSaveDialog(saveOptions)
      if (selection.canceled || !selection.filePath) {
        repository.updateActionRun(actionRunId, 'cancelled', { errorCode: 'NATIVE_SAVE_CANCELLED' })
        return { draft, task, cancelled: true, processingJob: null, export: null }
      }

      const exportId = randomUUID()
      const targetPathHash = createHash('sha256').update(normalize(selection.filePath)).digest('hex')
      const requestFingerprint = createHash('sha256').update(JSON.stringify({
        version: 'proposal-export-job-v1',
        taskId: task.id,
        draftId: draft.id,
        revision: draft.revision,
        contentHash: draft.contentHash,
        targetPathHash
      })).digest('hex')
      const idempotencyKey = createHash('sha256')
        .update(`proposal-export:${exportId}:${requestFingerprint}`)
        .digest('hex')
      let processingJob = repository.enqueueProcessingJob({
        type: 'proposal-export',
        workTaskId: task.id,
        taskStepId: task.steps[3]?.id ?? 'step-4',
        idempotencyKey,
        requestFingerprint,
        payloadRef: `proposal-draft:${draft.id}:export:${exportId}`,
        replayPolicy: 'manual-review',
        maxAttempts: 1
      })
      repository.updateActionRun(actionRunId, 'running', { processingJobId: processingJob.id })
      return processingResources.run('file-export', async () => {
        processingJob = repository.getProcessingJob(processingJob.id) ?? processingJob
        const lease = repository.acquireProcessingJob(processingJob.id, 10 * 60_000)
        if (!lease) throw new Error('提案書き出しジョブを開始できませんでした。内容を再確認してください。')
        const latestTaskBeforeStart = repository.getWorkTask(task.id)
        if (!latestTaskBeforeStart) throw new Error('提案タスクが見つかりません。')
        assertWorkTaskAllowsExecution(latestTaskBeforeStart)
        const startedTask = recordProposalExportStarted(latestTaskBeforeStart, lease.job.attemptCount)
        repository.saveWorkTask(startedTask)
        processingJob = repository.updateProcessingJobProgress(processingJob.id, lease.leaseToken, 15)
        const temporaryPath = `${selection.filePath}.${randomUUID()}.tmp`
        let exportPrepared = false
        let filesystemCommitted = false
        let domainCommitted = false
        try {
          const packageData = await buildProposalPackage(draft)
          processingJob = repository.updateProcessingJobProgress(processingJob.id, lease.leaseToken, 55)
          if (repository.isProcessingJobCancellationRequested(processingJob.id, lease.leaseToken)) {
            repository.completeProcessingJob(processingJob.id, lease.leaseToken, { cancelled: true })
            throw new Error('提案書き出しジョブをキャンセルしました。')
          }
          repository.beginProposalExport(
            draft.id,
            draft.revision,
            draft.contentHash,
            exportId,
            targetPathHash,
            currentOperator().displayName
          )
          exportPrepared = true
          await writeFile(temporaryPath, packageData.bytes, { mode: 0o600 })
          await rename(temporaryPath, selection.filePath)
          filesystemCommitted = true
          const exported = repository.completeProposalExport(
            exportId,
            draft.id,
            draft.contentHash,
            packageData.packageHash,
            currentOperator().displayName
          )
          domainCommitted = true
          const completion = repository.completeProcessingJob(processingJob.id, lease.leaseToken, {
            version: 'proposal-export-job-result-v1',
            exportId,
            packageHash: packageData.packageHash,
            deliveryState: 'exported-not-sent'
          })
          if (!completion.accepted) {
            throw new Error('提案書き出しの完了前にキャンセル要求を検出しました。保存先を確認してください。')
          }
          processingJob = completion.job
          const updatedTask = recordProposalExported(startedTask, new Date(), {
            objectId: exportId,
            contentHash: packageData.packageHash
          })
          repository.saveWorkTask(updatedTask)
          repository.updateActionRun(actionRunId, 'succeeded', { processingJobId: processingJob.id, resultHash: packageData.packageHash })
          return {
            draft: exported,
            task: updatedTask,
            cancelled: false,
            processingJob,
            export: {
              fileName: basename(selection.filePath),
              packageHash: packageData.packageHash,
              exportedAt: exported.exportedAt ?? exported.updatedAt,
              deliveryState: 'exported-not-sent'
            }
          }
        } catch (cause) {
          await unlink(temporaryPath).catch(() => undefined)
          const errorCode = filesystemCommitted ? 'PROPOSAL_EXPORT_OUTCOME_UNKNOWN' : 'LOCAL_EXPORT_FAILED'
          const activeJob = repository.getProcessingJob(processingJob.id)
          if (activeJob?.status === 'running') {
            processingJob = repository.failProcessingJob(
              processingJob.id,
              lease.leaseToken,
              errorCode,
              false
            )
          }
          const latestTask = repository.getWorkTask(task.id)
          if (latestTask && latestTask.status !== 'completed' && latestTask.status !== 'cancelled') {
            repository.saveWorkTask(recordProposalExportFailure(latestTask, errorCode))
          }
          if (filesystemCommitted && !domainCommitted) {
            repository.markProposalExportOutcomeUnknown(exportId, draft.id, currentOperator().displayName)
            throw new Error('ファイルは書き出された可能性がありますが、記録を確定できませんでした。内容を再確認してください。', { cause })
          }
          if (filesystemCommitted) {
            throw new Error('ファイルは書き出され、記録も保存されましたが、作業ジョブを確定できませんでした。保存先を確認してください。', { cause })
          }
          if (exportPrepared) repository.failProposalExport(exportId, draft.id, 'LOCAL_EXPORT_FAILED', currentOperator().displayName)
          repository.updateActionRun(actionRunId, processingJob.status === 'cancelled' ? 'cancelled' : 'failed', {
            processingJobId: processingJob.id,
            errorCode
          })
          throw new Error('提案パッケージを書き出せませんでした。', { cause })
        }
      })
    }))
  })

  ipcMain.handle(ipcChannels.recordProposalFollowUp, async (event, rawInput): Promise<ProposalMutationResult> => {
    assertTrustedSender(event)
    const input = recordProposalFollowUpInputSchema.parse(rawInput)
    const currentDraft = repository.getProposalDraft(input.draftId)
    if (!currentDraft) throw new Error('提案草稿が見つかりません。')
    return withTaskOperation(currentDraft.taskId, () => withProposalMutation(input.draftId, () => {
      const draftBeforeMutation = repository.getProposalDraft(input.draftId)
      if (!draftBeforeMutation) throw new Error('提案草稿が見つかりません。')
      const task = repository.getWorkTask(draftBeforeMutation.taskId)
      if (!task) throw new Error('提案タスクが見つかりません。')
      assertWorkTaskAllowsExecution(task)
      const operator = currentOperator()
      const now = new Date()
      const draft = repository.recordProposalFollowUp(input, randomUUID(), operator.displayName, now)
      const updatedTask = recordProposalFollowUp(task, input.stage, now, operator.displayName)
      repository.saveWorkTask(updatedTask)
      return { draft, task: updatedTask }
    }))
  })

  ipcMain.handle(ipcChannels.beginResumeImport, async (event): Promise<BeginResumeImportResult> => {
    assertTrustedSender(event)
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      title: 'スキルシート・履歴書を選択',
      buttonLabel: '安全に取り込む',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'スキルシート・履歴書', extensions: ['pdf', 'docx', 'xlsx', 'xls', 'xlsb'] }]
    }
    const selection = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (selection.canceled) return { cancelled: true, task: null, files: [] }
    if (selection.filePaths.length === 0) throw new Error('取り込むファイルを1件以上選択してください。')
    if (selection.filePaths.length > 10) throw new Error('一度に取り込めるファイルは10件までです。')

    const stagedFiles = []
    try {
      for (const path of selection.filePaths) stagedFiles.push(await fileVault.stageFile(path))
      const contextBindings = stagedFiles.map((file) => ({
        objectType: 'staged-file' as const,
        objectId: file.token,
        version: file.sha256
      }))
      const preview = createWorkTaskPreview(
        '選択した履歴書を候補者ライブラリへ安全に取り込みます',
        getDataScope('selected-files'),
        contextBindings
      )
      if (preview.type !== 'IMPORT_RESUME') throw new Error('履歴書取込タスクを作成できませんでした。')
      const task = materializeWorkTask(preview, randomUUID(), new Date().toISOString())
      repository.saveResumeImportTask(task, stagedFiles)
      return { cancelled: false, task, files: stagedFiles.map(rendererSafeFile) }
    } catch (error) {
      repository.removeStagedFiles(stagedFiles.map((file) => file.token))
      await Promise.allSettled(stagedFiles.map((file) => fileVault.discardStagedFile(file)))
      const selectedName = basename(selection.filePaths[stagedFiles.length] ?? 'selected file')
      const reason = error instanceof Error ? error.message : 'Unknown validation error.'
      throw new Error(`${selectedName} を取り込めませんでした: ${reason}`)
    }
  })

  const runResumeAnalysisTask = async (
    input: ReturnType<typeof analyzeResumeFileInputSchema.parse>,
    existingJobId: string | null = null
  ): Promise<ResumeAnalysisTaskExecutionResult> => {
        const task = repository.getWorkTask(input.taskId)
        if (!task || task.type !== 'IMPORT_RESUME') throw new Error('スキルシート取込タスクが見つかりません。')
        assertWorkTaskAllowsExecution(task)
        const stagedBindings = task.contextBindings.filter((item) => item.objectType === 'staged-file')
        const binding = stagedBindings.find(
          (item) => item.objectType === 'staged-file' && item.objectId === input.fileToken
        )
        if (!binding) throw new Error('このファイルは作業の確認済みデータ範囲に含まれていません。')
        // Batch continuation is derived from trusted persisted state. The renderer
        // cannot weaken task failure handling by supplying policy flags.
        const terminalFailureTokens = new Set(repository.listProcessingJobs(task.id).flatMap((job) => {
          if (job.type !== 'resume-analysis' || (job.status !== 'failed' && job.status !== 'cancelled')) return []
          const payloadRef = repository.getProcessingJobDispatchReference(job.id)?.payloadRef
          return payloadRef?.startsWith('staged-file:') ? [payloadRef.slice('staged-file:'.length)] : []
        }))
        const continueBatchOnFailure = stagedBindings.length > 1
        const finalizeBatch = continueBatchOnFailure && stagedBindings.every((item) =>
          item.objectId === input.fileToken ||
          repository.getResumeAnalysis(item.objectId)?.analysisVersion === 'resume-analysis-v6' ||
          terminalFailureTokens.has(item.objectId)
        )
        const record = repository.getStagedFileRecords([input.fileToken])[0]
        if (!record || record.sha256 !== binding.version) {
          throw new Error('選択したファイルが見つからないか、確認後に内容が変わりました。')
        }

        const requestFingerprint = createHash('sha256').update(JSON.stringify({
          version: 'resume-analysis-job-v1',
          fileSha256: record.sha256,
          format: record.format,
          size: record.size,
          analysisVersion: 'resume-analysis-v6',
          privacyPolicy: 'cloud-redaction-v2',
          localOcrPlatform: process.platform,
          localOcrAvailable: Boolean(localOcr)
        })).digest('hex')
        const idempotencyKey = createHash('sha256')
          .update(`resume-analysis:${task.id}:${input.fileToken}:${requestFingerprint}`)
          .digest('hex')
        const actionRunId = preflightAction('resume.analyze.local', {
          origin: 'work-task', workTaskId: task.id, scopeId: task.scope.id,
          scopeFingerprint: requestFingerprint, actorId: currentOperator().operatorId,
          contentRevision: binding.version
        }, { taskId: task.id, fileToken: input.fileToken }, '選択済みスキルシートを端末内で解析します。', idempotencyKey)
        const initialProcessingJob = existingJobId
          ? repository.getProcessingJob(existingJobId)
          : repository.enqueueProcessingJob({
              type: 'resume-analysis',
              workTaskId: task.id,
              taskStepId: task.steps[0]?.id ?? 'step-1',
              idempotencyKey,
              requestFingerprint,
              payloadRef: `staged-file:${input.fileToken}`,
              replayPolicy: 'safe-local',
              maxAttempts: 3
            })
        if (!initialProcessingJob || initialProcessingJob.type !== 'resume-analysis' || initialProcessingJob.workTaskId !== task.id) {
          throw new Error('スキルシート解析ジョブと作業の関連が一致しません。')
        }
        let processingJob: ProcessingJobSummary = initialProcessingJob
        if (processingJob.status !== 'succeeded') repository.updateActionRun(actionRunId, 'running', { processingJobId: processingJob.id })
        const dispatchReference = repository.getProcessingJobDispatchReference(processingJob.id)
        if (dispatchReference?.payloadRef !== `staged-file:${input.fileToken}`) {
          processingJob = failPendingProcessingJob(processingJob.id, 'PAYLOAD_REFERENCE_INVALID') ?? processingJob
          repository.saveWorkTask(continueBatchOnFailure && !finalizeBatch
            ? recordResumeAnalysisPartialFailure(task, 'PAYLOAD_REFERENCE_INVALID')
            : recordResumeAnalysisFailure(task, 'PAYLOAD_REFERENCE_INVALID'))
          throw new Error('スキルシート解析ジョブのローカル参照が無効です。作業を再実行してください。')
        }
        if (dispatchReference.requestFingerprint !== requestFingerprint) {
          processingJob = failPendingProcessingJob(processingJob.id, 'REQUEST_FINGERPRINT_STALE') ?? processingJob
          repository.saveWorkTask(continueBatchOnFailure && !finalizeBatch
            ? recordResumeAnalysisPartialFailure(task, 'REQUEST_FINGERPRINT_STALE')
            : recordResumeAnalysisFailure(task, 'REQUEST_FINGERPRINT_STALE'))
          throw new Error('スキルシートまたはローカル解析条件が変わりました。作業を再実行してください。')
        }
        if (processingJob.status === 'failed' || processingJob.status === 'cancelled') {
          throw new Error('スキルシート解析ジョブは停止しています。作業を再実行してください。')
        }
        if (processingJob.status === 'succeeded') {
          const cached = repository.getResumeAnalysis(input.fileToken)
          if (!cached || cached.analysisVersion !== 'resume-analysis-v6') {
            throw new Error('解析ジョブの結果と暗号化ローカル記録が一致しません。')
          }
          let updatedTask = synchronizeImportTask(repository, task, new Date(), currentOperator().displayName)
          if (finalizeBatch && repository.listProcessingJobs(task.id).some((job) => job.type === 'resume-analysis' && job.status === 'failed')) {
            updatedTask = recordResumeAnalysisFailure(updatedTask, 'BATCH_PARTIAL_FAILURE')
          }
          if (updatedTask !== task) repository.saveWorkTask(updatedTask)
          repository.updateActionRun(actionRunId, 'succeeded', { processingJobId: processingJob.id, resultHash: requestFingerprint })
          return { analysis: cached, task: updatedTask, processingJob }
        }
        return processingResources.run('local-ai', async () => {
          processingJob = repository.getProcessingJob(processingJob.id) ?? processingJob
          if (processingJob.status === 'failed' || processingJob.status === 'cancelled') {
            throw new Error('スキルシート解析ジョブは停止しています。作業を再実行してください。')
          }
          const lease = repository.acquireProcessingJob(processingJob.id, 10 * 60_000)
          if (!lease) throw new Error('スキルシート解析ジョブは別の処理で実行中か、再試行待ちです。')
          const latestTaskBeforeStart = repository.getWorkTask(task.id)
          if (!latestTaskBeforeStart) throw new Error('スキルシート取込タスクが見つかりません。')
          assertWorkTaskAllowsExecution(latestTaskBeforeStart)
          const startedTask = recordResumeAnalysisStarted(latestTaskBeforeStart, lease.job.attemptCount)
          repository.saveWorkTask(startedTask)
          processingJob = repository.updateProcessingJobProgress(processingJob.id, lease.leaseToken, 15)
          try {
            if (repository.isProcessingJobCancellationRequested(processingJob.id, lease.leaseToken)) {
              repository.completeProcessingJob(processingJob.id, lease.leaseToken, { cancelled: true })
              throw new Error('スキルシート解析ジョブをキャンセルしました。')
            }
            let summary = repository.getResumeAnalysis(input.fileToken)
            if (!summary || summary.analysisVersion !== 'resume-analysis-v6') {
              const bytes = await fileVault.decryptForLocalProcessing(record)
              let document
              try {
                document = await parserWorker.parse(rendererSafeFile(record), bytes)
                if (document.requiresLocalOcr && record.format === 'pdf' && localOcr) {
                  try {
                    document = mergeLocalOcr(document, await localOcr.ocrPdf(bytes))
                  } catch {
                    document = documentIrSchema.parse({
                      ...document,
                      warnings: [
                        ...document.warnings,
                        {
                          code: 'LOCAL_OCR_FAILED',
                          message: 'Apple Vision OCR was unavailable or could not reliably process the scanned page.'
                        }
                      ]
                    })
                  }
                }
              } finally {
                bytes.fill(0)
              }
              processingJob = repository.updateProcessingJobProgress(processingJob.id, lease.leaseToken, 50)
              if (repository.isProcessingJobCancellationRequested(processingJob.id, lease.leaseToken)) {
                repository.completeProcessingJob(processingJob.id, lease.leaseToken, { cancelled: true })
                throw new Error('スキルシート解析ジョブをキャンセルしました。')
              }

              const localText = documentTextForLocalPrivacy(document)
              let localNameDetection
              try {
                localNameDetection = await localNer?.detectNames(localText)
              } catch {
                localNameDetection = undefined
              }
              const knownPersonNames = collectLocalPersonNameCandidates(localText, localNameDetection)
              const mediaRisks: Array<'face_or_photo' | 'signature' | 'identifying_qr_code'> = []
              if (document.requiresLocalOcr || (document.ocr?.faceRegions ?? 0) > 0) mediaRisks.push('face_or_photo')
              if (document.requiresLocalOcr || document.ocr?.signatureReviewRequired) mediaRisks.push('signature')
              if (document.requiresLocalOcr || (document.ocr?.barcodeRegions ?? 0) > 0) mediaRisks.push('identifying_qr_code')
              const redaction = redactTextForCloud(localText, {
                sourceVersion: record.sha256,
                policyVersion: 'cloud-redaction-v2',
                knownPersonNames,
                mediaRisks
              })
              const identifierCounts = new Map<string, number>()
              for (const mapping of redaction.mappings) {
                identifierCounts.set(mapping.identifierType, (identifierCounts.get(mapping.identifierType) ?? 0) + 1)
              }
              const analyzedAt = new Date().toISOString()
              const extraction = extractCandidateDraft(document, new Date(analyzedAt))
              const preview = redaction.redactedContent.length > 4000
                ? `${redaction.redactedContent.slice(0, 3999)}…`
                : redaction.redactedContent
              summary = {
                analysisVersion: 'resume-analysis-v6',
                fileToken: input.fileToken,
                fileName: record.name,
                status: document.requiresLocalOcr ? 'requires-local-ocr' : 'requires-pii-review',
                cloudEligible: false,
                statistics: document.statistics,
                detectedIdentifiers: [...identifierCounts.entries()]
                  .map(([type, count]) => ({ type, count }))
                  .toSorted((a, b) => a.type.localeCompare(b.type)),
                localProcessing: {
                  ocr: document.ocr?.engine === 'apple-vision'
                    ? 'apple-vision-completed'
                    : document.ocr?.engine === 'windows-tesseract-wasm'
                      ? 'windows-tesseract-wasm-completed'
                      : document.ocr?.engine === 'windows-media-ocr'
                        ? 'windows-media-ocr-completed'
                    : document.requiresLocalOcr
                      ? 'requires-local-ocr'
                      : 'not-required',
                  ocrPages: document.ocr?.processedPages ?? 0,
                  personNameCandidates: knownPersonNames.length,
                  networkAccess: false
                },
                extractedFields: extraction.fields.map((field) => ({
                  key: field.key,
                  label: field.label,
                  value: field.value,
                  confidence: field.confidence,
                  status: field.status,
                  sourceLabels: [...new Set(field.sources.map((source) => source.sourceLabel))]
                })),
                extractedProjectExperiences: extraction.projectExperiences.map((project) => ({
                  draftId: project.draftId,
                  title: project.title,
                  period: project.period,
                  role: project.role,
                  technologies: project.technologies,
                  summary: project.summary,
                  confidence: project.confidence,
                  sourceLabels: [...new Set(project.sources.map((source) => source.sourceLabel))]
                })),
                warningCodes: [
                  ...new Set([
                    ...document.warnings.map((warning) => warning.code),
                    ...(knownPersonNames.length > 0 ? ['PERSON_NAME_REVIEW_REQUIRED'] : [])
                  ])
                ],
                redactedPreview: preview,
                analyzedAt
              }
              processingJob = repository.updateProcessingJobProgress(processingJob.id, lease.leaseToken, 85)
              if (repository.isProcessingJobCancellationRequested(processingJob.id, lease.leaseToken)) {
                repository.completeProcessingJob(processingJob.id, lease.leaseToken, { cancelled: true })
                throw new Error('スキルシート解析ジョブをキャンセルしました。')
              }
              repository.saveRedactionSession(redaction.session, redaction.mappings)
              repository.saveParsedDocument(document, summary, redaction.session.id, extraction)
            }

            const latestTask = repository.getWorkTask(task.id)
            if (!latestTask) throw new Error('スキルシート取込タスクが見つかりません。')
            let updatedTask = synchronizeImportTask(repository, latestTask, new Date(), currentOperator().displayName)
            if (finalizeBatch && repository.listProcessingJobs(task.id).some((job) => job.type === 'resume-analysis' && job.status === 'failed')) {
              updatedTask = recordResumeAnalysisFailure(updatedTask, 'BATCH_PARTIAL_FAILURE')
            }
            if (updatedTask !== latestTask) repository.saveWorkTask(updatedTask)
            const completion = repository.completeProcessingJob(processingJob.id, lease.leaseToken, {
              version: 'resume-analysis-job-result-v1',
              documentId: input.fileToken,
              analysisHash: createHash('sha256').update(JSON.stringify(summary)).digest('hex'),
              cloudPayload: 'none'
            })
            if (!completion.accepted) throw new Error('スキルシート解析ジョブをキャンセルしました。')
            processingJob = completion.job
            repository.updateActionRun(actionRunId, 'succeeded', {
              processingJobId: processingJob.id,
              resultHash: createHash('sha256').update(JSON.stringify(summary)).digest('hex')
            })
            return { analysis: summary, task: updatedTask, processingJob }
          } catch (cause) {
            const activeJob = repository.getProcessingJob(processingJob.id)
            if (activeJob?.status === 'running') {
              processingJob = repository.failProcessingJob(
                processingJob.id,
                lease.leaseToken,
                'RESUME_ANALYSIS_FAILED',
                !continueBatchOnFailure
              )
            }
            const latestTask = repository.getWorkTask(task.id)
            if (latestTask && latestTask.status !== 'cancelled' && processingJob.status !== 'cancelled') {
              const errorCode = processingJob.errorCode ?? 'RESUME_ANALYSIS_FAILED'
              repository.saveWorkTask(
                processingJob.status === 'retry_wait' && processingJob.nextRetryAt
                  ? recordResumeAnalysisRetryScheduled(latestTask, errorCode, processingJob.nextRetryAt)
                  : continueBatchOnFailure && !finalizeBatch
                    ? recordResumeAnalysisPartialFailure(latestTask, errorCode)
                  : recordResumeAnalysisFailure(latestTask, errorCode)
              )
            }
            repository.updateActionRun(actionRunId, processingJob.status === 'cancelled' ? 'cancelled' : 'failed', {
              processingJobId: processingJob.id,
              errorCode: processingJob.errorCode ?? 'RESUME_ANALYSIS_FAILED'
            })
            throw cause
          }
        })
  }

  ipcMain.handle(
    ipcChannels.analyzeResumeFile,
    async (event, rawInput): Promise<ResumeAnalysisTaskExecutionResult> => {
      assertTrustedSender(event)
      const input = analyzeResumeFileInputSchema.parse(rawInput)
      return withTaskOperation(input.taskId, () => runResumeAnalysisTask(input))
    }
  )

  ipcMain.handle(ipcChannels.getCandidateReview, (event, rawDocumentId) => {
    assertTrustedSender(event)
    const documentId = candidateProfileSourceInputSchema.parse(rawDocumentId)
    return repository.getCandidateReview(documentId)
  })

  ipcMain.handle(
    ipcChannels.submitCandidateReview,
    (event, rawInput): SubmitCandidateReviewResult => {
      assertTrustedSender(event)
      const input = submitCandidateReviewInputSchema.parse(rawInput)
      const operator = currentOperator()
      const review = repository.confirmCandidateReview(input, operator.operatorId, operator.displayName)
      const updatedTasks: WorkTask[] = []
      for (const task of repository.listWorkTasks()) {
        if (!task.contextBindings.some((binding) => binding.objectType === 'staged-file' && binding.objectId === input.documentId)) {
          continue
        }
        const reconciled = synchronizeImportTask(repository, task, new Date(), operator.displayName)
        if (reconciled !== task) repository.saveWorkTask(reconciled)
        updatedTasks.push(reconciled)
      }
      return { review, updatedTasks }
    }
  )

  ipcMain.handle(
    ipcChannels.createCandidateInterviewRound,
    (event, rawInput): CandidateInterviewSnapshot => {
      assertTrustedSender(event)
      const input = createCandidateInterviewRoundInputSchema.parse(rawInput)
      const operator = currentOperator()
      return repository.createCandidateInterviewRound(input, operator.displayName)
    }
  )

  ipcMain.handle(
    ipcChannels.saveCandidateInterviewSchedule,
    (event, rawInput): CandidateInterviewSnapshot => {
      assertTrustedSender(event)
      const input = saveCandidateInterviewScheduleInputSchema.parse(rawInput)
      const operator = currentOperator()
      return repository.saveCandidateInterviewSchedule(input, operator.displayName)
    }
  )

  ipcMain.handle(
    ipcChannels.saveCandidateInterviewPreparation,
    (event, rawInput): CandidateInterviewSnapshot => {
      assertTrustedSender(event)
      const input = saveCandidateInterviewPreparationInputSchema.parse(rawInput)
      const operator = currentOperator()
      return repository.saveCandidateInterviewPreparation(input, operator.displayName)
    }
  )

  ipcMain.handle(
    ipcChannels.saveCandidateInterviewNotes,
    (event, rawInput): CandidateInterviewSnapshot => {
      assertTrustedSender(event)
      const input = saveCandidateInterviewNotesInputSchema.parse(rawInput)
      const operator = currentOperator()
      return repository.saveCandidateInterviewNotes(input, operator.displayName)
    }
  )

  ipcMain.handle(ipcChannels.openZoomMeeting, async (event, rawInput): Promise<{ opened: true }> => {
    assertTrustedSender(event)
    const input = zoomMeetingUrlSchema.parse((rawInput as { url?: unknown } | null)?.url)
    await shell.openExternal(input)
    return { opened: true }
  })

  ipcMain.handle(ipcChannels.openInterviewMeeting, async (event, rawInput): Promise<{ opened: true }> => {
    assertTrustedSender(event)
    const input = openInterviewMeetingInputSchema.parse(rawInput)
    await shell.openExternal(input.url)
    return { opened: true }
  })

  ipcMain.handle(ipcChannels.openZoomTestMeeting, async (event): Promise<{ opened: true }> => {
    assertTrustedSender(event)
    await shell.openExternal('https://zoom.us/test')
    return { opened: true }
  })

  ipcMain.handle(
    ipcChannels.recordCandidateInterviewDecision,
    (event, rawInput): CandidateInterviewSnapshot => {
      assertTrustedSender(event)
      const input = recordCandidateInterviewDecisionInputSchema.parse(rawInput)
      const operator = currentOperator()
      return repository.recordCandidateInterviewDecision(input, operator.displayName)
    }
  )

  ipcMain.handle(ipcChannels.previewWorkTask, (event, rawInput): SignedWorkTaskPreview => {
    assertTrustedSender(event)
    const input = workTaskInputSchema.parse(rawInput)
    const preview = createVerifiedPreview(repository, input)
    return { ...preview, previewHash: previewHash(preview) }
  })

  ipcMain.handle(ipcChannels.createWorkTask, (event, rawInput): WorkTask => {
    assertTrustedSender(event)
    const input = createWorkTaskInputSchema.parse(rawInput)
    const preview = createVerifiedPreview(repository, input)
    if (previewHash(preview) !== input.previewHash) {
      throw new Error('作業プレビューが変更されています。もう一度確認してください。')
    }

    const now = new Date().toISOString()
    const plannedTask = materializeWorkTask(preview, randomUUID(), now)
    const task = plannedTask
    repository.saveWorkTask(task)
    return task
  })

  ipcMain.handle(ipcChannels.setWorkTaskLifecycle, async (event, rawInput): Promise<WorkTask> => {
    assertTrustedSender(event)
    const input = setWorkTaskLifecycleInputSchema.parse(rawInput)
    if (input.action === 'cancel') {
      const current = repository.getWorkTask(input.taskId)
      if (!current) throw new Error('作業が見つかりません。')
      if (current.updatedAt !== input.expectedUpdatedAt && current.status !== 'running') {
        throw new Error('作業が更新されました。再読み込みしてから操作してください。')
      }
      const task = cancelWorkTask(current)
      const jobs = repository.listProcessingJobs(input.taskId)
      const cancellableSafeLocalOperation = jobs.some((job) =>
        job.replayPolicy === 'safe-local' && ['queued', 'running', 'retry_wait'].includes(job.status)
      )
      if (activeTaskOperations.has(input.taskId) && !cancellableSafeLocalOperation) {
        throw new Error('ファイル書き出し等の処理中はキャンセルできません。完了後にもう一度操作してください。')
      }
      repository.requestProcessingJobCancellationForTask(input.taskId)
      repository.cancelPendingActionApprovalsForTask(input.taskId)
      repository.saveWorkTask(task)
      return task
    }
    return withTaskOperation(input.taskId, () => {
      const current = repository.getWorkTask(input.taskId)
      if (!current) throw new Error('作業が見つかりません。')
      if (current.updatedAt !== input.expectedUpdatedAt) {
        throw new Error('作業が更新されました。再読み込みしてから操作してください。')
      }
      const transitioned = retryWorkTask(current)
      repository.retryProcessingJobsForTask(input.taskId)
      const task = synchronizeImportTask(repository, transitioned, new Date(), currentOperator().displayName)
      repository.saveWorkTask(task)
      safeLocalDispatcher?.wake()
      return task
    })
  })

  safeLocalDispatcher = new SafeLocalProcessingDispatcher<ProcessingJobSummary>({
    intervalMs: 1_000,
    listJobs: () => repository.listProcessingJobs(),
    execute: async (job) => {
      const task = repository.getWorkTask(job.workTaskId)
      if (!task) {
        failPendingProcessingJob(job.id, 'WORK_TASK_NOT_FOUND')
        return
      }
      if (task.status === 'failed') {
        const retryAt = job.nextRetryAt ?? new Date().toISOString()
        const errorCode = job.errorCode ?? 'BACKGROUND_RETRY'
        const retryTask = job.type === 'candidate-match'
          ? recordCandidateMatchRetryScheduled(task, errorCode, retryAt)
          : job.type === 'resume-analysis'
            ? recordResumeAnalysisRetryScheduled(task, errorCode, retryAt)
            : task
        if (retryTask !== task) repository.saveWorkTask(retryTask)
      }
      if (job.type === 'candidate-match') {
        await withTaskOperation(job.workTaskId, async () => { await runCandidateMatchTask(job.workTaskId, job.id) })
        return
      }
      if (job.type === 'resume-analysis') {
        const prefix = 'staged-file:'
        const dispatchReference = repository.getProcessingJobDispatchReference(job.id)
        if (!dispatchReference?.payloadRef.startsWith(prefix)) {
          failPendingProcessingJob(job.id, 'PAYLOAD_REFERENCE_INVALID')
          return
        }
        const parsedFileToken = candidateProfileSourceInputSchema.safeParse(dispatchReference.payloadRef.slice(prefix.length))
        if (!parsedFileToken.success) {
          failPendingProcessingJob(job.id, 'PAYLOAD_REFERENCE_INVALID')
          return
        }
        const fileToken = parsedFileToken.data
        await withTaskOperation(job.workTaskId, async () => {
          await runResumeAnalysisTask({ fileToken, taskId: job.workTaskId }, job.id)
        })
        return
      }
      failPendingProcessingJob(job.id, 'SAFE_LOCAL_JOB_TYPE_UNSUPPORTED')
    },
    onError: (_error, job) => {
      if (!job || (app.isPackaged && !releaseSmokeMode)) return
      console.warn('[safe-local-dispatch-failed]', {
        jobId: job.id,
        jobType: job.type,
        status: repository.getProcessingJob(job.id)?.status ?? 'missing'
      })
    }
  })
  safeLocalDispatcher.start()
  return () => {
    wechatScopeTokens.clear()
    agentIpcStop()
    safeLocalDispatcher?.stop()
    cloudAiReview?.dispose()
  }
}

async function registerAppProtocol(): Promise<void> {
  const rendererDirectory = normalize(join(__dirname, '../renderer'))
  await protocol.handle('ses-agent', (request) => {
    const requestUrl = new URL(request.url)
    const requestedPath = requestUrl.pathname === '/' ? 'index.html' : decodeURIComponent(requestUrl.pathname.slice(1))
    const filePath = normalize(join(rendererDirectory, requestedPath))
    const relativePath = relative(rendererDirectory, filePath)

    if (relativePath.startsWith('..') || relativePath.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
      return new Response('Not found', { status: 404 })
    }

    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1100,
    minHeight: 760,
    title: 'SES Agent Desktop',
    backgroundColor: '#f5f7fb',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    const developmentUrl = process.env.ELECTRON_RENDERER_URL
    const allowed = developmentUrl ? url.startsWith(developmentUrl) : url.startsWith('ses-agent://app/')
    if (!allowed) event.preventDefault()
  })

  window.once('ready-to-show', () => window.show())

  if (!app.isPackaged || releaseSmokeMode) {
    window.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error(`[preload-error] ${preloadPath}`, error)
    })
    window.webContents.on('console-message', (details) => {
      console.info(`[renderer:${details.level}] ${details.message}`)
    })
    window.webContents.on('did-finish-load', () => {
      void (async () => {
        let state: { api: string; body: string; styles: number } | null = null
        for (let attempt = 0; attempt < 100; attempt += 1) {
          state = await window.webContents.executeJavaScript(
            `({ api: typeof window.sesAgent, body: document.body.innerText.slice(0, 240), styles: document.styleSheets.length })`
          ) as { api: string; body: string; styles: number }
          if (!state.body.includes('安全な作業環境を準備しています')) break
          await new Promise((resolveWait) => setTimeout(resolveWait, 50))
        }
        console.info('[renderer-ready]', state)
        if (releaseSmokeMode) {
          const startup = await window.webContents.executeJavaScript(
            'window.sesAgent.getStartupStatus()'
          ) as StartupStatus
          if (!shouldRunReleaseAgentSmoke(startup)) {
            setTimeout(() => app.quit(), 100)
            return
          }
          const agentSmokeConversationId = process.env.SES_AGENT_SMOKE_CONVERSATION_ID ?? null
          const agentSmoke = await window.webContents.executeJavaScript(`(async () => {
            const api = window.sesAgent
            const bootstrap = await api.getBootstrap()
            const context = { assistant: 'sales-agent', candidateDocumentId: null, interviewId: null, interviewKind: null, roundNumber: null }
            if (bootstrap.featureFlags?.conversationalMatchingEnabled !== true) {
              return {
                bridge: typeof api,
                conversationalMatchingEnabled: false,
                classicMatchingPath: document.body.innerText.includes('AI マッチング')
              }
            }
            const existingConversationId = ${JSON.stringify(agentSmokeConversationId)}
            if (existingConversationId) {
              const reopened = await api.listAiConversations(context)
              const deletion = await api.deleteAiConversations({ conversationIds: [existingConversationId] })
              const remaining = await api.listAiConversations(context)
              return {
                bridge: typeof api,
                conversationalMatchingEnabled: true,
                reopened: reopened.some((conversation) => conversation.id === existingConversationId),
                deleted: deletion.deletedConversationIds.includes(existingConversationId),
                remaining: remaining.some((conversation) => conversation.id === existingConversationId)
              }
            }
            const conversationId = crypto.randomUUID()
            const turn = await api.executeAgentTurn({
              conversationId,
              message: '最近の案件は？',
              expectedConversationRevision: null,
              requestId: crypto.randomUUID(),
              modelKey: 'gpt-5.6-luna',
              selectedJobCaseRef: null
            })
            const saved = await api.listAiConversations(context)
            return {
              bridge: typeof api,
              conversationalMatchingEnabled: true,
              turnStatus: turn.status,
              planningFailedClosed: turn.status === 'failed' && turn.toolName === null && turn.actionRunId === null &&
                turn.assistantMessage.mode === 'local-fallback' && turn.assistantMessage.narrativeStatus === 'failed-local-fallback' &&
                (turn.assistantMessage.blocks?.length ?? 0) === 0,
              saved: saved.some((conversation) => conversation.id === conversationId),
              conversationId
            }
          })()`)
          console.info('[agent-bridge-smoke]', JSON.stringify(agentSmoke))
          setTimeout(() => app.quit(), 100)
        }
      })().catch((error) => {
        console.error('[renderer-readiness-failed]', error instanceof Error ? error.message : String(error))
        if (releaseSmokeMode) app.exit(1)
      })
    })
  }

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadURL('ses-agent://app/')
  }

  return window
}

async function isRecoverableLocalStorageFailure(userDataPath: string, error: unknown): Promise<boolean> {
  const message = error instanceof Error ? error.message : ''
  if (!(error instanceof ProtectedMasterKeyUnavailableError) && message !== 'Unable to open the encrypted local database.') {
    return false
  }
  try {
    const database = await lstat(join(userDataPath, 'data', 'ses-agent.db'))
    return database.isFile() && !database.isSymbolicLink()
  } catch {
    return false
  }
}

function registerStartupRecoveryIpcHandlers(userDataPath: string): void {
  let recoveryBusy = false
  let recoveryPreview: {
    token: string
    staged: StagedRecoveryPackage
    expiresAt: Date
  } | null = null
  const masterKeyProvider = new SafeStorageMasterKeyProvider(join(userDataPath, 'security', 'master-key.v1'))

  const discardRecoveryPreview = async () => {
    if (!recoveryPreview) return
    const preview = recoveryPreview
    recoveryPreview = null
    await discardStagedRecovery(preview.staged)
  }
  const expireRecoveryPreview = async () => {
    if (recoveryPreview && recoveryPreview.expiresAt.getTime() <= Date.now()) await discardRecoveryPreview()
  }

  ipcMain.handle(ipcChannels.getStartupStatus, (event): StartupStatus => {
    assertTrustedSender(event)
    return {
      mode: 'recovery-required',
      reason: 'local-storage-unavailable',
      activeDataPreserved: true,
      networkAccess: false,
      message: '暗号化されたローカルデータを現在の OS 保護鍵で開けません。元データは変更せず保持しています。'
    }
  })

  ipcMain.handle(ipcChannels.restartApplication, (event): { restarting: true } => {
    assertTrustedSender(event)
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 100)
    return { restarting: true }
  })

  ipcMain.handle(ipcChannels.previewRecoveryPackage, async (event, rawInput): Promise<RecoveryPreviewResult> => {
    assertTrustedSender(event)
    const input = previewRecoveryPackageInputSchema.parse(rawInput)
    if (recoveryBusy) throw new Error('別の復元確認が進行中です。')
    recoveryBusy = true
    let staged: StagedRecoveryPackage | null = null
    try {
      await expireRecoveryPreview()
      const selection = await dialog.showOpenDialog({
        title: '暗号化復元パッケージを選択',
        filters: [{ name: 'SES Agent Recovery', extensions: ['ses-recovery'] }],
        properties: ['openFile']
      })
      const packagePath = selection.filePaths[0]
      if (selection.canceled || !packagePath) {
        return {
          cancelled: true,
          restoreToken: null,
          confirmationHash: null,
          expiresAt: null,
          summary: null,
          warnings: []
        }
      }
      await discardRecoveryPreview()
      const token = randomUUID()
      const stagingDirectory = join(userDataPath, 'recovery', 'previews', token)
      staged = await stageRecoveryPackage({ packagePath, password: input.password, stagingDirectory })
      await verifyStagedRecovery(staged, currentSchemaVersion)
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
      recoveryPreview = { token, staged, expiresAt }
      return {
        cancelled: false,
        restoreToken: token,
        confirmationHash: staged.confirmationHash,
        expiresAt: expiresAt.toISOString(),
        summary: staged.summary,
        warnings: [
          '現在アクセスできないローカルデータは、確認後の再起動時に置き換えられます。',
          'Google Workspace の認証情報は復元されず、再接続が必要です。',
          'アプリ外へ書き出したファイルは復元対象外です。'
        ]
      }
    } catch (error) {
      if (staged && recoveryPreview?.staged !== staged) await discardStagedRecovery(staged)
      throw error
    } finally {
      recoveryBusy = false
    }
  })

  ipcMain.handle(ipcChannels.confirmRecovery, async (event, rawInput): Promise<ConfirmRecoveryResult> => {
    assertTrustedSender(event)
    const input = confirmRecoveryInputSchema.parse(rawInput)
    if (recoveryBusy) throw new Error('別の復元確認が進行中です。')
    recoveryBusy = true
    try {
      await expireRecoveryPreview()
      const preview = recoveryPreview
      if (!preview || preview.token !== input.restoreToken) throw new Error('復元確認の有効期限が切れました。もう一度検証してください。')
      if (preview.staged.confirmationHash !== input.confirmationHash) throw new Error('復元対象が変更されました。もう一度検証してください。')
      const protectedMasterKeyPath = join(dirname(preview.staged.databasePath), '..', 'security', 'master-key.v1')
      await masterKeyProvider.writeProtectedMasterKey(protectedMasterKeyPath, preview.staged.masterKey)
      await schedulePendingRestore({
        userDataPath,
        restoreToken: preview.token,
        stagingDirectory: join(dirname(preview.staged.databasePath), '..'),
        packageHash: preview.staged.packageHash,
        confirmationHash: preview.staged.confirmationHash,
        summary: preview.staged.summary
      })
      preview.staged.masterKey.fill(0)
      recoveryPreview = null
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 250)
      return { scheduled: true, restartRequired: true }
    } finally {
      recoveryBusy = false
    }
  })
}

async function verifyActivatedRecovery(
  activation: PendingRestoreActivation,
  services: Awaited<ReturnType<typeof initializeServices>>
): Promise<void> {
  services.repository.rebindStagedFilePaths(activation.activeVaultDirectory)
  const records = services.repository.listStagedFileRecords()
  if (records.length !== activation.marker.summary.vaultObjectCount) {
    throw new Error('復元後のデータベースとファイル数が一致しません。')
  }
  for (const record of records) {
    const plaintext = await services.fileVault.decryptForLocalProcessing(record)
    plaintext.fill(0)
  }
  const credentialVault = new SafeStorageJsonCredentialVault(
    join(services.userDataPath, 'security', 'google-workspace-credential.v1'),
    (input) => googleWorkspaceCredentialSchema.parse(input)
  )
  await credentialVault.clear()
  const aiCommerceCredentialVault = new SafeStorageJsonCredentialVault(
    join(services.userDataPath, 'security', 'aicommerce-native-credential.v1'),
    (input) => parseAiCommerceNativeCredential(input)
  )
  await aiCommerceCredentialVault.clear()
  const aiCommercePendingAuthorizationVault = new SafeStorageJsonCredentialVault(
    join(services.userDataPath, 'security', 'aicommerce-native-pending-authorization.v1'),
    (input) => parseAiCommercePendingAuthorization(input)
  )
  await aiCommercePendingAuthorizationVault.clear()
  services.repository.recordRecoveryEvent(
    'restore-completed',
    activation.marker.summary,
    activation.marker.packageHash
  )
}

async function runWindowsPackageWorkerSmoke(
  services: Awaited<ReturnType<typeof initializeServices>>
): Promise<void> {
  if (!app.isPackaged || process.platform !== 'win32') {
    throw new Error('Packaged Windows worker verification is only available in a packaged Windows application.')
  }

  const XLSX = await import('xlsx')
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Skill', 'Years'],
    ['PACKAGED_APPCONTAINER_PARSER_SENTINEL', 7]
  ])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Skills')
  const parserBytes = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  const parserFile: StagedLocalFile = {
    token: '80e59895-b25c-4d6f-935c-31f82b6ad56f',
    name: 'packaged-appcontainer-verification.xlsx',
    format: 'xlsx',
    size: parserBytes.length,
    sha256: createHash('sha256').update(parserBytes).digest('hex'),
    createdAt: '2026-07-20T00:00:00.000Z',
    privacyStatus: 'awaiting-local-scan'
  }
  let parserCompleted = false
  try {
    const parsed = await services.parserWorker.parse(parserFile, parserBytes)
    parserCompleted = parsed.blocks.some((block) => block.text === 'PACKAGED_APPCONTAINER_PARSER_SENTINEL') &&
      parsed.security.rawFileCloudEligible === false
  } finally {
    parserBytes.fill(0)
  }
  if (!parserCompleted) throw new Error('The packaged AppContainer parser did not return the expected local result.')

  const vectors = await services.embeddingWorker.embedQueries(['パッケージ内のローカル候補者検索を検証する'])
  const embeddingCompleted = vectors.length === 1 &&
    vectors[0]?.length === localEmbeddingModel.dimension &&
    vectors[0].every((value) => Number.isFinite(value))
  if (!embeddingCompleted) throw new Error('The packaged AppContainer embedding worker returned an invalid vector.')

  if (!services.rerankerWorker) throw new Error('The packaged local reranker worker is unavailable.')
  const rerankerScores = await services.rerankerWorker.rerank('AWS と Terraform によるクラウド基盤設計', [
    { id: 'relevant', text: 'AWS、Terraform、Kubernetesを使ったクラウド基盤の設計構築を担当' },
    { id: 'irrelevant', text: '経理事務、請求書処理、月次決算を担当' }
  ])
  const rerankerCompleted = (rerankerScores.get('relevant') ?? Number.NEGATIVE_INFINITY) >
    (rerankerScores.get('irrelevant') ?? Number.POSITIVE_INFINITY)
  if (!rerankerCompleted) throw new Error('The packaged local reranker did not rank the relevant passage first.')

  const fixturePath = process.env.SES_WINDOWS_PACKAGE_OCR_FIXTURE_PATH?.trim() || null
  let ocrCompleted = false
  let ocrEngine: string | null = null
  if (services.localOcr) {
    if (!fixturePath) throw new Error('The packaged Windows OCR fixture path is missing.')
    const ocrBytes = await readFile(fixturePath)
    try {
      const result = await services.localOcr.ocrPdf(ocrBytes)
      const recognizedText = result.pages.flatMap((page) => page.textBlocks.map((block) => block.text)).join(' ')
      ocrCompleted = result.networkAccess === false && /Java/u.test(recognizedText) && /AWS/u.test(recognizedText)
      ocrEngine = result.engine
    } finally {
      ocrBytes.fill(0)
    }
    if (!ocrCompleted) throw new Error('The packaged AppContainer OCR worker did not return the expected local result.')
  } else if (fixturePath) {
    throw new Error('A packaged OCR fixture was provided while Windows OCR is disabled.')
  }

  console.info('[windows-package-workers-ready]', JSON.stringify({
    parserCompleted,
    embeddingCompleted,
    embeddingDimension: localEmbeddingModel.dimension,
    rerankerCompleted,
    rerankerModel: localRerankerModel.id,
    ocrCompleted,
    ocrEngine,
    ocrStatus: services.localAiStatus,
    rawPersonalDataCloudEligible: false
  }))
}

async function startApplication(): Promise<void> {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  const userDataPath = app.getPath('userData')
  let activation: PendingRestoreActivation | null = null
  let startingServices: Awaited<ReturnType<typeof initializeServices>> | null = null
  try {
    activation = await applyPendingRestore(userDataPath)
    if (!activation) {
      await rm(join(userDataPath, 'recovery', 'previews'), { recursive: true, force: true })
    }
    const services = await initializeServices({ restoring: Boolean(activation) })
    startingServices = services
    if (aiCommerceProductionProbeMode) {
      if (!services.aiCommerce) throw new Error('AICommerce production configuration is unavailable.')
      const dashboard = await services.aiCommerce.getDashboard()
      const result = await services.aiCommerce.requestText('请只回复 OK。')
      console.info('[aicommerce-production-probe-ready]', JSON.stringify({
        diagnosticOnly: true,
        privacyGateExemption: 'fixed-synthetic-connectivity-probe',
        appCode: services.aiCommerce.configuration.appCode,
        productCode: services.aiCommerce.configuration.productCode,
        walletVerified: dashboard.wallet !== null,
        capabilityCount: dashboard.capabilities.length,
        billingModeUsed: result.billingModeUsed,
        aiResponseVerified: result.content.trim().length > 0,
        usageCredits: result.usageCredits
      }))
      services.embeddingWorker.dispose()
      services.rerankerWorker?.dispose()
      services.repository.close()
      services.masterKey.fill(0)
      startingServices = null
      app.exit(0)
      return
    }
    if (windowsPackageWorkerSmokeMode) {
      await runWindowsPackageWorkerSmoke(services)
      services.embeddingWorker.dispose()
      services.rerankerWorker?.dispose()
      services.repository.close()
      services.masterKey.fill(0)
      startingServices = null
      app.exit(0)
      return
    }
    if (activation) {
      await verifyActivatedRecovery(activation, services)
      await finalizePendingRestore(userDataPath, activation)
      if (!app.isPackaged) {
        console.info('[recovery-completed]', {
          backupId: activation.marker.summary.backupId,
          schemaVersion: services.repository.getSchemaVersion(),
          vaultObjectCount: activation.marker.summary.vaultObjectCount
        })
      }
    }
    applicationRepository = services.repository
    localEmbeddingWorker = services.embeddingWorker
    localRerankerWorker = services.rerankerWorker
    encryptedFileVault = services.fileVault
    applicationMasterKey = services.masterKey
    attachAiCommerceClient(services.aiCommerce)
    registerAiCommerceRedirectProtocol(services.aiCommerce)
    processingDispatcherStop = registerIpcHandlers(
      applicationRepository,
      encryptedFileVault,
      services.parserWorker,
      services.candidateRetrieval,
      services.rerankerWorker !== null,
      services.localOcr,
      services.localAiStatus,
      services.localNer,
      services.googleWorkspace,
      services.aiCommerce,
      services.googleWorkspaceDomain,
      services.googleWorkspaceConfiguration,
      services.gmailSyncConfig,
      services.masterKey,
      services.masterKeyProvider,
      services.userDataPath
    )
    await prepareOriginalOpenRoot(services.userDataPath)
    await registerOriginalDocumentProtocol(applicationRepository, encryptedFileVault)
    if (usesBundledRenderer()) await registerAppProtocol()
    createMainWindow()
    startingServices = null

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  } catch (error: unknown) {
    processingDispatcherStop?.()
    processingDispatcherStop = null
    startingServices?.embeddingWorker.dispose()
    startingServices?.rerankerWorker?.dispose()
    startingServices?.repository.close()
    startingServices?.masterKey.fill(0)
    applicationRepository?.close()
    applicationRepository = null
    attachAiCommerceClient(null)
    applicationMasterKey?.fill(0)
    applicationMasterKey = null
    let rolledBack = false
    try {
      rolledBack = await rollbackIncompletePendingRestore(userDataPath)
    } catch (rollbackError) {
      console.error('[recovery-rollback-failed]', rollbackError instanceof Error ? rollbackError.message : String(rollbackError))
    }
    const message = error instanceof Error ? error.message : 'Unknown initialization error.'
    if (windowsPackageWorkerSmokeMode) {
      console.error('[windows-package-workers-failed]', message)
      app.exit(1)
      return
    }
    if (aiCommerceProductionProbeMode) {
      console.error('[aicommerce-production-probe-failed]', message)
      app.exit(1)
      return
    }
    if (rolledBack) {
      console.error('[startup-failed-after-recovery-rollback]', message)
      dialog.showErrorBox('復元を取り消しました', `${message}\n\n元のローカルデータへ戻して再起動します。`)
      app.relaunch()
      app.exit(1)
      return
    }
    if (!activation && await isRecoverableLocalStorageFailure(userDataPath, error)) {
      console.info('[startup-storage-unavailable]', message)
      registerStartupRecoveryIpcHandlers(userDataPath)
      if (usesBundledRenderer()) await registerAppProtocol()
      createMainWindow()
      console.info('[startup-recovery-ready]', {
        reason: 'local-storage-unavailable',
        activeDataPreserved: true,
        networkAccess: false
      })
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
      })
      return
    }
    console.error('[startup-failed]', message)
    dialog.showErrorBox('SES Agent Desktop を起動できません', message)
    app.quit()
  }
}

app.whenReady().then(startApplication)

app.on('before-quit', () => {
  attachAiCommerceClient(null)
  processingDispatcherStop?.()
  processingDispatcherStop = null
  applicationRepository?.checkpoint()
  applicationRepository?.close()
  applicationRepository = null
  localEmbeddingWorker?.dispose()
  localEmbeddingWorker = null
  localRerankerWorker?.dispose()
  localRerankerWorker = null
  encryptedFileVault = null
  if (originalOpenRootPath) void rm(originalOpenRootPath, { recursive: true, force: true })
  originalOpenRootPath = null
  applicationMasterKey?.fill(0)
  applicationMasterKey = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
