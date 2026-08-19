import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { lstat, readFile, rm } from 'node:fs/promises'
import { dirname, join, normalize, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron'

import {
  createSampleTasks,
  SafeLocalProcessingDispatcher,
  recordCandidateMatchRetryScheduled,
  recordResumeAnalysisRetryScheduled,
  reconcileWorkTaskPlan,
  recoverInterruptedWorkTask
} from '@application'
import {
  AiCommerceNativeClient,
  loadAiCommerceConfiguration,
  parseAiCommerceNativeCredential,
  parseAiCommercePendingAuthorization
} from '@aicommerce'
import { EncryptedFileVault } from '@files'
import {
  createLocalAiRuntime,
  LocalEmbeddingWorkerClient,
  localEmbeddingModel,
  LocalRerankerWorkerClient,
  localRerankerModel,
  type LocalOcrPort,
  type LocalAiRuntime,
  type LocalPersonNameDetectorPort
} from '@local-ai'
import { ParserWorkerClient } from '@parsers/worker-client'
import { currentSchemaVersion, EncryptedApplicationRepository } from '@persistence'
import {
  GoogleWorkspaceOAuthClient,
  LoopbackAuthorizationCodeProvider,
  googleWorkspaceCredentialSchema,
  type GmailSyncConfiguration
} from '@mail'
import {
  ProtectedMasterKeyUnavailableError,
  SafeStorageJsonCredentialVault,
  SafeStorageMasterKeyProvider,
  getPlatformKeyProtection
} from '@platform'
import {
  applyPendingRestore,
  discardStagedRecovery,
  finalizePendingRestore,
  rollbackIncompletePendingRestore,
  schedulePendingRestore,
  stageRecoveryPackage,
  type PendingRestoreActivation,
  type StagedRecoveryPackage
} from '@recovery'
import { LocalHybridCandidateRetrieval } from '@resume'
import {
  candidateProfileSourceInputSchema,
  confirmRecoveryInputSchema,
  ipcChannels,
  previewRecoveryPackageInputSchema,
  type GoogleWorkspaceAdminConfiguration,
  type ProcessingJobSummary,
  type RecoveryPreviewResult,
  type ConfirmRecoveryResult,
  type StagedLocalFile,
  type StartupStatus
} from '@shared'
import { shouldRunReleaseAgentSmoke } from './startup-smoke'
import {
  effectiveOperatorProfile,
  gmailSyncConfigurationFromAdmin,
  loadManagedGoogleWorkspaceConfiguration
} from './app-defaults'
import { synchronizeImportTask } from './work-task-helpers'
import { assertTrustedSender, createMainIpcContext, type MainIpcDependencies } from './ipc/context'
import { clearOriginalOpenRoot, prepareOriginalOpenRoot } from './original-open-root'
import { verifyStagedRecovery } from './recovery-verification'
import { registerAiCommerceHandlers } from './ipc/aicommerce'
import { registerBootstrapHandlers } from './ipc/bootstrap'
import { registerCandidateEvaluationHandlers } from './ipc/candidate-evaluation'
import { registerCandidateMatchHandlers } from './ipc/candidate-match'
import { registerCandidateHandlers } from './ipc/candidates'
import { registerGoogleWorkspaceHandlers } from './ipc/google-workspace'
import { registerInterviewHandlers } from './ipc/interviews'
import { registerJobCaseHandlers } from './ipc/job-cases'
import { registerProposalHandlers } from './ipc/proposals'
import { registerRecoveryHandlers } from './ipc/recovery'
import { registerResumeImportHandlers } from './ipc/resume-import'
import { registerSettingsHandlers } from './ipc/settings'
import { registerWorkTaskHandlers } from './ipc/work-tasks'

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

function registerIpcHandlers(dependencies: MainIpcDependencies): () => void {
  const context = createMainIpcContext(dependencies)
  const { repository, wechatScopeTokens, cloudAiReview, withTaskOperation, failPendingProcessingJob } = context

  registerBootstrapHandlers(context)
  registerSettingsHandlers(context)
  registerAiCommerceHandlers(context)
  registerGoogleWorkspaceHandlers(context)
  registerRecoveryHandlers(context)
  registerCandidateHandlers(context)
  registerCandidateEvaluationHandlers(context)
  registerJobCaseHandlers(context)
  registerProposalHandlers(context)
  registerInterviewHandlers(context)
  registerWorkTaskHandlers(context)
  const { runCandidateMatchTask, stop: stopAgentIpc } = registerCandidateMatchHandlers(context)
  const { runResumeAnalysisTask } = registerResumeImportHandlers(context)

  // Background retry/resume of safe-local jobs. It is started after every
  // handler is registered so a woken job never races handler construction.
  const safeLocalDispatcher = new SafeLocalProcessingDispatcher<ProcessingJobSummary>({
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
  context.attachDispatcher(safeLocalDispatcher)
  safeLocalDispatcher.start()
  return () => {
    wechatScopeTokens.clear()
    stopAgentIpc()
    context.stopDispatcher()
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
    processingDispatcherStop = registerIpcHandlers({
      repository: applicationRepository,
      fileVault: encryptedFileVault,
      parserWorker: services.parserWorker,
      candidateRetrieval: services.candidateRetrieval,
      localRerankerEnabled: services.rerankerWorker !== null,
      localOcr: services.localOcr,
      localAiStatus: services.localAiStatus,
      localNer: services.localNer,
      googleWorkspace: services.googleWorkspace,
      aiCommerce: services.aiCommerce,
      googleWorkspaceDomain: services.googleWorkspaceDomain,
      googleWorkspaceConfiguration: services.googleWorkspaceConfiguration,
      gmailSyncConfig: services.gmailSyncConfig,
      masterKey: services.masterKey,
      masterKeyProvider: services.masterKeyProvider,
      userDataPath: services.userDataPath
    })
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
  clearOriginalOpenRoot()
  applicationMasterKey?.fill(0)
  applicationMasterKey = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
