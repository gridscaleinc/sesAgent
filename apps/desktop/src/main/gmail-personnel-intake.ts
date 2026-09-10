import { createHash } from 'node:crypto'
import { classifyGmailMessage, type GmailReadClient } from '@mail'
import { splitBusinessBatch } from '@shared'
import { importPastedCandidateText } from './business-text-intake'
import { importStagedResumeLocally } from './local-resume-analysis'
import type { MainIpcContext } from './ipc/context'

/** Mail headers stay in SQLCipher. Attachment bytes go directly into the encrypted vault. */
export async function importPendingGmailPersonnel(context: MainIpcContext, gmail: GmailReadClient, accountEmail: string) {
  const { repository, fileVault } = context
  const counts = { personnel: 0, failed: 0 }
  for (const pending of repository.listPendingGmailBusinessIntake(accountEmail)) {
    const state = repository.getGmailBusinessIntake(accountEmail, pending.messageId) ?? {
      accountEmail, messageId: pending.messageId, replyTo: null, status: 'pending' as const, parts: {}, warnings: []
    }
    try {
      const message = await gmail.getMessage(pending.messageId)
      state.replyTo = message.replyTo ?? null
      state.warnings = []
      repository.saveGmailBusinessIntake(state)
      if (classifyGmailMessage(message) === 'candidate-proposal') {
        const attachments = message.resumeAttachments ?? []
        if (attachments.length > 10 || attachments.reduce((sum, item) => sum + item.size, 0) > 50 * 1024 * 1024) throw new Error('GMAIL_RESUME_BATCH_LIMIT')
        // Attachment resumes are the personnel records. The covering letter is not a second person.
        for (const attachment of attachments) {
          try {
            let token: string | undefined = state.parts[attachment.id]
            if (token && repository.getCandidateReview(token)) continue
            if (!token) {
              const bytes = await gmail.getAttachment(message.id, attachment)
              try {
                token = repository.findResumeDocumentByHash(createHash('sha256').update(bytes).digest('hex')) ?? undefined
                if (!token) {
                  const staged = await fileVault.stageBytes(attachment.name, bytes, new Date(message.internalDate))
                  repository.saveStagedFiles([staged])
                  token = staged.token
                }
                state.parts[attachment.id] = token
                repository.saveGmailBusinessIntake(state)
              } finally { bytes.fill(0) }
            }
            if (!repository.getCandidateReview(token)) {
              const record = repository.getStagedFileRecords([token])[0]
              if (!record) throw new Error('GMAIL_RESUME_FILE_MISSING')
              await context.processingResources.run('local-ai', () => importStagedResumeLocally(context, record))
              counts.personnel += 1
            }
          } catch { state.warnings.push('GMAIL_RESUME_ATTACHMENT_FAILED'); counts.failed += 1 }
        }
        if (!attachments.length) {
          const segments = splitBusinessBatch(message.body.trim() || message.subject)
          for (const [index, segment] of segments.entries()) {
            const partKey = `body-${index}`
            if (state.parts[partKey]) continue
            const result = await context.processingResources.run('local-ai', () => importPastedCandidateText(context, segment.text, new Date(message.internalDate)))
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
