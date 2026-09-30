import { createHash, randomUUID } from 'node:crypto'
import { rename, unlink, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow, dialog, shell } from 'electron'
import { detectDirectIdentifiers } from '@privacy'
import { attachmentFromCandidate, skillSheetHtml } from '@proposals'
import type { ExportSkillSheetInput, ExportSkillSheetResult, ProposalAttachmentPreview } from '@shared'
import type { MainIpcContext } from './ipc/context'

type Context = Pick<MainIpcContext, 'repository' | 'processingResources' | 'currentOperator' | 'preflightAction'>

export interface PreparedSkillSheet {
  attachment: ProposalAttachmentPreview
  html: string
  fileName: string
}

/**
 * Builds the skill sheet from the confirmed person profile with the same redaction as the proposal package:
 * anonymous label, confirmed fields and projects only, no work authorization, no source file or contact details.
 * The case title is printed only after its own direct-identifier scan.
 */
export function prepareSkillSheet(repository: Context['repository'], input: ExportSkillSheetInput): PreparedSkillSheet {
  // Same rule as the introduction: an archived person can still be introduced for an explicit case.
  const profile = input.caseContext
    ? repository.getCandidateProfileForAssessment(input.documentId)
    : repository.getCurrentCandidateProfile(input.documentId)
  if (!profile || profile.profileVersion !== input.profileVersion)
    throw new Error('人员资料已更新，请重新打开介绍。 / 要員情報が更新されました。紹介画面を開き直してください。')
  let caseTitle: string | null = null
  if (input.caseContext) {
    const job = repository.getJobCaseReview(input.caseContext.reviewId)
    if (!job || job.lifecycle !== 'active' || job.jobCase?.version !== input.caseContext.version)
      throw new Error('案件资料已更新，请重新打开介绍。 / 案件情報が更新されました。紹介画面を開き直してください。')
    caseTitle = job.fields.find((field) => field.key === 'title')?.value?.trim() || null
    if (caseTitle && detectDirectIdentifiers(caseTitle).length > 0) caseTitle = null
  }
  let attachment: ProposalAttachmentPreview
  try {
    attachment = attachmentFromCandidate(profile)
  } catch (cause) {
    throw new Error(
      '人员资料中含有电话、邮箱等个人识别信息，无法导出技能表。请先修改人员资料。 / 要員情報に電話番号・メール等の個人識別情報が含まれるため、スキルシートを書き出せません。要員情報を修正してください。',
      { cause }
    )
  }
  const html = skillSheetHtml(attachment, { profileId: profile.id, profileVersion: profile.profileVersion, caseTitle })
  return { attachment, html, fileName: `skill-sheet-${profile.id.slice(0, 8)}.pdf` }
}

export async function renderSkillSheetPdf(html: string): Promise<Buffer> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await window.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
  } finally {
    window.destroy()
  }
}

/**
 * Saves the redacted skill sheet where HR chooses and reveals it in Finder so it can be dragged into the mail.
 * The native save dialog is the confirmation, as for the approved proposal package; the audit run records only hashes.
 */
export async function exportSkillSheet(
  context: Context,
  owner: BrowserWindow | null,
  input: ExportSkillSheetInput,
  render: (html: string) => Promise<Buffer> = renderSkillSheetPdf
): Promise<ExportSkillSheetResult> {
  const { repository, processingResources, currentOperator, preflightAction } = context
  const sheet = prepareSkillSheet(repository, input)
  const actionRunId = preflightAction(
    'skill-sheet.export',
    {
      origin: 'user-command',
      workTaskId: null,
      scopeId: 'selected-candidate-profile',
      scopeFingerprint: sheet.attachment.contentHash,
      actorId: currentOperator().operatorId,
      contentRevision: `${input.profileVersion}:${sheet.attachment.contentHash}`
    },
    {
      documentId: input.documentId,
      profileVersion: input.profileVersion,
      caseContext: input.caseContext ?? null,
      attachmentHash: sheet.attachment.contentHash
    },
    '確認済み要員情報から匿名化したスキルシートPDFを、保存先の選択後に端末へ書き出します。',
    `skill-sheet-export:${randomUUID()}`
  )
  const saveOptions = {
    title: 'スキルシートを保存 / 保存技能表',
    defaultPath: sheet.fileName,
    buttonLabel: '書き出す / 导出',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  }
  const selection = owner ? await dialog.showSaveDialog(owner, saveOptions) : await dialog.showSaveDialog(saveOptions)
  if (selection.canceled || !selection.filePath) {
    repository.updateActionRun(actionRunId, 'cancelled', { errorCode: 'NATIVE_SAVE_CANCELLED' })
    return { cancelled: true, fileName: null }
  }
  const filePath = selection.filePath
  return processingResources.run('file-export', async () => {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`
    try {
      repository.updateActionRun(actionRunId, 'running', {})
      const pdf = await render(sheet.html)
      if (pdf.length < 4 || pdf.subarray(0, 4).toString('ascii') !== '%PDF') throw new Error('Skill sheet is not a valid PDF payload.')
      await writeFile(temporaryPath, pdf, { mode: 0o600 })
      await rename(temporaryPath, filePath)
      repository.updateActionRun(actionRunId, 'succeeded', { resultHash: createHash('sha256').update(pdf).digest('hex') })
    } catch (cause) {
      await unlink(temporaryPath).catch(() => undefined)
      repository.updateActionRun(actionRunId, 'failed', { errorCode: 'LOCAL_EXPORT_FAILED' })
      throw new Error('无法导出技能表，请重试。 / スキルシートを書き出せませんでした。もう一度お試しください。', { cause })
    }
    shell.showItemInFolder(filePath)
    return { cancelled: false, fileName: basename(filePath) }
  })
}
