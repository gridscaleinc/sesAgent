import { createHash } from 'node:crypto'
import { type GmailReadClient, minimizeGmailBodyForLocalProcessing } from '@mail'
import { splitBusinessBatch, type PersonnelMailUpdate } from '@shared'
import { importPastedCandidateText } from './business-text-intake'
import { importStagedResumeLocally } from './local-resume-analysis'
import type { MainIpcContext } from './ipc/context'

/** Extract only explicitly labelled commercial conditions; never infer skills or identity from a covering letter. */
export function extractPersonnelMailConditions(body: string): Array<{ field: PersonnelMailUpdate['field']; value: string }> {
  const labels: Record<PersonnelMailUpdate['field'], string> = {
    rate: '希望単価|単価|期望单价|希望单价|单价',
    availability: '稼働開始|稼働可能時期|稼働時期|参画可能時期|可入场时间|入场时间|稼働',
    work_style: '勤務形態|工作方式',
    location: '希望勤務地|期望地点|希望工作地点'
  }
  const all = Object.values(labels).join('|'),
    result: Array<{ field: PersonnelMailUpdate['field']; value: string }> = []
  for (const [field, label] of Object.entries(labels)) {
    const regex = new RegExp(`(?:^|[\\n。；;,，])\\s*(?:${label})\\s*[：:]\\s*(.*?)(?=[\\n。；;]|[,，]\\s*(?:${all})\\s*[：:]|$)`, 'gu')
    const values = [...body.matchAll(regex)].map((match) => match[1]!.trim()).filter(Boolean)
    if (values.length !== 1) continue
    const value = values[0]!
      .split(/(?:→|改为|调整为|変更後[：:]?)/u)
      .at(-1)!
      .trim()
    if (value.length > 0 && value.length <= 1000) result.push({ field: field as PersonnelMailUpdate['field'], value })
  }
  return result
}

/** Mail headers stay in SQLCipher. Attachment bytes go directly into the encrypted vault. */
export async function importPendingGmailPersonnel(context: MainIpcContext, gmail: GmailReadClient, accountEmail: string) {
  const { repository, fileVault } = context
  const counts = { personnel: 0, failed: 0 }
  for (const pending of repository.listPendingGmailBusinessIntake(accountEmail)) {
    const state = repository.getGmailBusinessIntake(accountEmail, pending.messageId) ?? {
      accountEmail,
      messageId: pending.messageId,
      replyTo: null,
      status: 'pending' as const,
      parts: {},
      warnings: []
    }
    try {
      const raw = await gmail.getMessage(pending.messageId)
      const message = { ...raw, body: minimizeGmailBodyForLocalProcessing(raw.body) }
      state.replyTo = message.replyTo ?? null
      state.warnings = []
      repository.saveGmailBusinessIntake(state)
      // The synchronized classification also accounts for interview/progress
      // correspondence. Do not reclassify a quoted resume as a new person.
      if (pending.classification === 'candidate-proposal') {
        const attachments = message.resumeAttachments ?? []
        if (attachments.length > 10 || attachments.reduce((sum, item) => sum + item.size, 0) > 50 * 1024 * 1024)
          throw new Error('GMAIL_RESUME_BATCH_LIMIT')
        // Attachment resumes are the personnel records. The covering letter is not a second person.
        for (const attachment of attachments) {
          try {
            let token: string | undefined = state.parts[attachment.id]
            if (token && repository.getCandidateReview(token)) continue
            if (!token) {
              const bytes = await gmail.getAttachment(message.id, attachment)
              try {
                token = repository.findResumeDocumentByHash(createHash('sha256').update(bytes).digest('hex')) ?? undefined
                // The same résumé saved before only for a case assessment: proposed by mail now, it joins the library.
                const known = token ? repository.getCandidateReview(token) : null
                if (known?.inTalentLibrary === false && known.profile) repository.addCandidateToLibrary(known.documentId, known.profile.version)
                if (!token) {
                  const staged = await fileVault.stageBytes(attachment.name, bytes, new Date(message.internalDate))
                  repository.saveStagedFiles([staged])
                  token = staged.token
                }
                state.parts[attachment.id] = token
                repository.saveGmailBusinessIntake(state)
              } finally {
                bytes.fill(0)
              }
            }
            if (!repository.getCandidateReview(token)) {
              const record = repository.getStagedFileRecords([token])[0]
              // Neither a person nor a staged file any more: the person was deleted since; nothing left to import.
              if (!record) continue
              const documentId = await context.processingResources.run('local-ai', () => importStagedResumeLocally(context, record))
              state.parts[attachment.id] = documentId
              repository.saveGmailBusinessIntake(state)
              if (documentId === token) counts.personnel += 1
            }
          } catch {
            state.warnings.push('GMAIL_RESUME_ATTACHMENT_FAILED')
            counts.failed += 1
          }
        }
        if (attachments.length) {
          const documentIds = [
            ...new Set(
              attachments.map((item) => state.parts[item.id]).filter((id): id is string => Boolean(id && repository.getCandidateReview(id)))
            )
          ]
          const conditions = extractPersonnelMailConditions(message.body)
          if (conditions.length && documentIds.length)
            repository.mergePersonnelMailConditions({
              accountEmail,
              messageId: message.id,
              documentIds,
              receivedAt: new Date(message.internalDate).toISOString(),
              subject: message.subject,
              evidence: message.body,
              conditions,
              ambiguous:
                documentIds.length !== 1 ||
                attachments.some((item) => !state.parts[item.id] || !repository.getCandidateReview(state.parts[item.id]!))
            })
        }
        if (!attachments.length) {
          const segments = splitBusinessBatch(message.body.trim() || message.subject)
          for (const [index, segment] of segments.entries()) {
            const partKey = `body-${index}`
            if (state.parts[partKey]) continue
            const result = await context.processingResources.run('local-ai', () =>
              importPastedCandidateText(context, segment.text, new Date(message.internalDate))
            )
            state.parts[partKey] = result.review.documentId
            if (result.outcome === 'created') counts.personnel += 1
            repository.saveGmailBusinessIntake(state)
          }
        }
        if (message.attachmentCount > attachments.length) state.warnings.push('UNSUPPORTED_MAIL_ATTACHMENTS')
      }
      state.status = state.warnings.includes('GMAIL_RESUME_ATTACHMENT_FAILED') ? 'error' : 'completed'
    } catch {
      state.status = 'error'
      state.warnings = ['GMAIL_PERSONNEL_IMPORT_RETRY_REQUIRED']
      counts.failed += 1
    }
    repository.saveGmailBusinessIntake(state)
  }
  return counts
}
