import { createHash, randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { BrowserWindow, type OpenDialogOptions, dialog, ipcMain } from 'electron'
import {
  createWorkTaskPreview,
  getDataScope,
  materializeWorkTask,
  recordResumeAnalysisFailure,
  recordResumeAnalysisPartialFailure,
  recordResumeAnalysisRetryScheduled,
  recordResumeAnalysisStarted
} from '@application'
import { collectLocalPersonNameCandidates, mergeLocalOcr } from '@local-ai'
import { documentIrSchema } from '@parsers'
import { ParserWorkerClient } from '@parsers/worker-client'
import { EncryptedApplicationRepository } from '@persistence'
import { redactTextForCloud } from '@privacy'
import { extractCandidateDraft } from '@resume'
import {
  type AgentCandidateDraftFacts,
  type BeginResumeImportResult,
  type ProcessingJobSummary,
  type ResumeAnalysisTaskExecutionResult,
  type StagedLocalFile,
  analyzeResumeFileInputSchema,
  previewStagedResumeFileInputSchema,
  stageDroppedResumeFilesInputSchema,
  candidateProfileSourceInputSchema,
  ipcChannels
} from '@shared'
import { assertWorkTaskAllowsExecution, synchronizeImportTask } from '../work-task-helpers'
import { assertTrustedSender, type MainIpcContext } from './context'

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

/** Resume file staging, local analysis and candidate field review. */
export function registerResumeImportHandlers(context: MainIpcContext) {
  const { repository, fileVault, parserWorker, localOcr, localNer, processingResources, currentOperator, preflightAction, withTaskOperation, failPendingProcessingJob, previewedDrafts, conversationImports } = context
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

  ipcMain.handle(ipcChannels.stageDroppedResumeFiles, async (event, rawInput): Promise<BeginResumeImportResult> => {
    assertTrustedSender(event)
    const input = stageDroppedResumeFilesInputSchema.parse(rawInput)

    // Same staging path as the native dialog import: the renderer supplied the
    // bytes instead of a path, so the vault still decides the format from magic
    // bytes and the renderer only ever receives tokens back.
    const stagedFiles = []
    try {
      for (const file of input.files) stagedFiles.push(await fileVault.stageBytes(file.name, Buffer.from(file.bytes)))
      const contextBindings = stagedFiles.map((file) => ({
        objectType: 'staged-file' as const,
        objectId: file.token,
        version: file.sha256
      }))
      const preview = createWorkTaskPreview(
        '会話に添付された履歴書を候補者ライブラリへ安全に取り込みます',
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
      const rejectedName = input.files[stagedFiles.length]?.name ?? 'dropped file'
      const reason = error instanceof Error ? error.message : 'Unknown validation error.'
      throw new Error(`${rejectedName} を取り込めませんでした: ${reason}`)
    }
  })

  /**
   * Parse, locally redact and extract one staged file. Persists nothing.
   *
   * Both paths run this: the preview the operator reads before deciding, and the
   * import that commits the draft. Keeping it in one place is the point - a
   * second copy would let the redaction policy drift between what gets shown and
   * what gets stored.
   */
  const analyzeStagedFileLocally = async (
    record: ReturnType<EncryptedApplicationRepository['getStagedFileRecords']>[number],
    onParsed: () => void = () => undefined
  ) => {
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
    onParsed()
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
    return { document, extraction, redaction, identifierCounts, knownPersonNames, analyzedAt }
  }

  ipcMain.handle(ipcChannels.previewStagedResumeFile, async (event, rawInput): Promise<AgentCandidateDraftFacts> => {
    assertTrustedSender(event)
    const input = previewStagedResumeFileInputSchema.parse(rawInput)
    const record = repository.getStagedFileRecords([input.fileToken])[0]
    if (!record) throw new Error('添付ファイルが見つかりません。')

    // Preview only: the same local pipeline runs, but nothing is written. No
    // candidate review, no work task, no redaction session - the operator has
    // not decided to import yet, so the app must not act as if they had.
    const analysis = await processingResources.run('local-ai', () => analyzeStagedFileLocally(record))
    const facts: AgentCandidateDraftFacts = {
      documentId: input.fileToken,
      label: record.name.replace(/\.[^.]+$/u, '').slice(0, 60) || 'RESUME',
      confirmed: false,
      reviewStatus: 'awaiting-review',
      fields: analysis.extraction.fields.map((field) => ({
        label: field.label,
        value: field.value,
        confidence: field.confidence,
        status: field.value === null ? 'missing' as const : 'needs_review' as const,
        sources: [...new Set(field.sources.map((source) => source.sourceLabel))]
      })),
      projects: analysis.extraction.projectExperiences.map((project) => ({
        title: project.title,
        period: project.period,
        role: project.role,
        technologies: project.technologies,
        summary: project.summary,
        confidence: project.confidence,
        sources: [...new Set(project.sources.map((source) => source.sourceLabel))]
      }))
    }
    previewedDrafts.set(input.fileToken, facts)
    return facts
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
              const analysis = await analyzeStagedFileLocally(record, () => {
                processingJob = repository.updateProcessingJobProgress(processingJob.id, lease.leaseToken, 50)
                if (repository.isProcessingJobCancellationRequested(processingJob.id, lease.leaseToken)) {
                  repository.completeProcessingJob(processingJob.id, lease.leaseToken, { cancelled: true })
                  throw new Error('スキルシート解析ジョブをキャンセルしました。')
                }
              })
              const { document, extraction, redaction, identifierCounts, knownPersonNames, analyzedAt } = analysis
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
      const registerConversationImport = (documentId: string) => {
        if (!input.conversationId) return
        const existing = conversationImports.get(input.conversationId) ?? []
        if (existing.some((item) => item.sourceDocumentId === documentId)) return
        conversationImports.set(input.conversationId, [
          ...existing,
          { label: `RESUME_${existing.length + 1}`, sourceDocumentId: documentId }
        ])
      }
      const executed = await withTaskOperation(input.taskId, () => runResumeAnalysisTask(input))
      registerConversationImport(input.fileToken)
      return executed
    }
  )

  ipcMain.handle(ipcChannels.getCandidateReview, (event, rawDocumentId) => {
    assertTrustedSender(event)
    const documentId = candidateProfileSourceInputSchema.parse(rawDocumentId)
    return repository.getCandidateReview(documentId)
  })

  return { runResumeAnalysisTask }
}
