import { createHash, randomUUID } from 'node:crypto'
import { lstat, open } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import {
  createRedactedEmlJobCaseSource,
  createRedactedManualJobCaseSource,
  createRedactedWechatVisibleJobCaseSource,
  extractJobCaseDraft
} from '@job-cases'
import { effectiveJobCaseFieldAliases } from '../app-defaults'
import { importChatPastedJobCaseText, autoConfirmJobCaseDraft } from '../business-text-intake'
import { deriveNewCaseDigest } from '../job-case-digest'
import { collectLocalPersonNameCandidates } from '@local-ai'
import { maxEmlFileSizeBytes, maxEmlFilesPerImport } from '@mail'
import {
  type CreateChatPasteJobCaseDraftResult,
  type CreateManualJobCaseDraftResult,
  type DeleteJobCaseDataResult,
  type EmlImportErrorCode,
  type ExecuteWechatVisibleReadResult,
  type ImportEmlJobCaseDraftsResult,
  type JobCaseSourceText,
  type MarkJobCaseSeenResult,
  type NewJobCaseDigest,
  type PrepareWechatVisibleReadResult,
  type ReopenJobCaseReviewResult,
  type SetJobCaseLifecycleResult,
  type SubmitJobCaseReviewResult,
  createChatPasteJobCaseDraftInputSchema,
  createManualJobCaseDraftInputSchema,
  deleteJobCaseDataInputSchema,
  executeWechatVisibleReadInputSchema,
  ipcChannels,
  jobCaseReviewIdSchema,
  reopenJobCaseReviewInputSchema,
  setJobCaseLifecycleInputSchema,
  submitJobCaseReviewInputSchema
} from '@shared'
import { MacWechatVisibleReader, WechatVisibleReadError } from '../wechat-visible-reader'
import { assertTrustedSender, type MainIpcContext } from './context'

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

/** Job case review, manual/chat/WeChat/EML intake, lifecycle and deletion. */
export function registerJobCaseHandlers(context: MainIpcContext) {
  const { repository, parserWorker, localNer, wechatVisibleReader, wechatScopeTokens, currentOperator, preflightAction } = context
  let emlImportBusy = false
  let wechatVisibleReadBusy = false

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
    const draft = extractJobCaseDraft(source, randomUUID(), now, {}, null, effectiveJobCaseFieldAliases(repository).aliases)
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
    // A hand-written case takes effect at once as well; what the store
    // refuses stays a draft for the operator to complete in the workspace.
    const confirmed = autoConfirmJobCaseDraft(repository, review, currentOperator(), now)
    return { review: confirmed.review ?? review }
  })

  ipcMain.handle(
    ipcChannels.createChatPasteJobCaseDraft,
    async (event, rawInput): Promise<CreateChatPasteJobCaseDraftResult> => {
      assertTrustedSender(event)
      const input = createChatPasteJobCaseDraftInputSchema.parse(rawInput)
      // Shared with the agent intake gate. Exact duplicates return the existing
      // review per its lifecycle instead of stacking a second draft.
      const imported = await importChatPastedJobCaseText(
        { repository, localNer, operator: currentOperator() }, input.text, new Date(), {}, null, effectiveJobCaseFieldAliases(repository).aliases
      )
      return { review: imported.review }
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
        const draft = extractJobCaseDraft(source, randomUUID(), now, {}, null, effectiveJobCaseFieldAliases(repository).aliases)
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
          const draft = extractJobCaseDraft(processed.source, randomUUID(), now, {}, null, effectiveJobCaseFieldAliases(repository).aliases)
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

  ipcMain.handle(ipcChannels.getJobCaseSourceText, (event, rawReviewId): JobCaseSourceText => {
    assertTrustedSender(event)
    const reviewId = jobCaseReviewIdSchema.parse(rawReviewId)
    // HR reads the complete source on this device. Cloud projections use the
    // separate redacted repository read, never this display-only result.
    const sourceText = repository.getJobCaseSourceTextForDisplay(reviewId)
    if (!sourceText) throw new Error('案件の取込元本文が見つかりませんでした。')
    return sourceText
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

  // One derivation for the card, the rail badge and the agent's counts, so the
  // three can never disagree about what arrived today.
  const newDigest = (): NewJobCaseDigest => deriveNewCaseDigest({
    reviews: repository.listJobCaseReviews(),
    seenReviewIds: repository.listSeenJobCaseReviewIds(),
    now: new Date()
  })

  ipcMain.handle(ipcChannels.getJobCaseNewDigest, (event): NewJobCaseDigest => {
    assertTrustedSender(event)
    return newDigest()
  })

  ipcMain.handle(ipcChannels.markJobCaseSeen, (event, rawReviewId): MarkJobCaseSeenResult => {
    assertTrustedSender(event)
    const reviewId = jobCaseReviewIdSchema.parse(rawReviewId)
    repository.markJobCaseReviewSeen(reviewId, new Date().toISOString())
    return { unseenCount: newDigest().unseenCount }
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
}
