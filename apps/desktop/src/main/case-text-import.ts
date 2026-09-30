import { createHash, randomUUID } from 'node:crypto'
import { businessModel } from './business-model'
import { createChatPasteJobCaseDraftInputSchema, type ImportCaseTextBatchResult } from '@shared'
import { effectiveJobCaseFieldAliases } from './app-defaults'
import { importChatPastedJobCaseText } from './business-text-intake'
import type { MainIpcContext } from './ipc/context'

/** Small addressable clauses for AI; these are never assumed to be case boundaries. */
export function caseEvidenceUnits(text: string): Array<{ text: string; start: number; end: number }> {
  const units: Array<{ text: string; start: number; end: number }> = []
  let start = 0
  const push = (end: number) => {
    const fragment = text.slice(start, end)
    if (fragment.trim()) units.push({ text: fragment.trim(), start, end })
    start = end
  }
  for (const match of text.matchAll(/[、，,。；;！？!?\r\n]+/gu)) push(match.index + match[0].length)
  push(text.length)
  return units
}

type Dependencies = Pick<MainIpcContext, 'repository' | 'localNer' | 'currentOperator' | 'agentNarrativeStreamer' | 'agentChatModelCatalog'>
export function createCaseTextBatchImporter(context: Dependencies) {
  const active = new Map<string, Promise<ImportCaseTextBatchResult>>()
  const run = async (text: string): Promise<ImportCaseTextBatchResult> => {
    const cloud = context.agentNarrativeStreamer
    if (!cloud) throw new Error('CASE_AI_UNAVAILABLE')
    const units = caseEvidenceUnits(text)
    if (!units.length) throw new Error('CASE_AI_NO_RECORDS')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 180_000)
    let remoteId: string | null = null
    const cancel = () => {
      if (remoteId) void cloud.cancel(remoteId).catch(() => undefined)
    }
    controller.signal.addEventListener('abort', cancel, { once: true })
    const batchId = randomUUID()
    try {
      const extraction = await cloud.extractBusinessText({
        conversationId: batchId,
        requestId: randomUUID(),
        text: units.map((unit) => unit.text).join('\n'),
        caseBatch: true,
        aliases: effectiveJobCaseFieldAliases(context.repository).aliases,
        model: businessModel(context, 'checking'),
        signal: controller.signal,
        onClientRequestId: (id) => {
          remoteId = id
          if (controller.signal.aborted) cancel()
        },
        onRemoteSettled: () => {
          remoteId = null
        }
      })
      controller.signal.throwIfAborted()
      const personnel = extraction.kind === 'records' ? (extraction.personnel ?? []) : []
      if (extraction.kind !== 'records' || (!extraction.records.length && !personnel.length)) throw new Error('CASE_AI_NO_RECORDS')
      // Validate every range before the first write; never save the entire input as a fallback.
      let previousEnd = 0
      const records = extraction.records.map((record) => {
        if (
          record.kind !== 'job-case' ||
          record.startLine <= previousEnd ||
          record.endLine < record.startLine ||
          record.endLine > units.length
        )
          throw new Error('CASE_AI_INVALID_SEGMENTS')
        previousEnd = record.endLine
        const source = text.slice(units[record.startLine - 1]!.start, units[record.endLine - 1]!.end).trim()
        // List ordinals identify a position in the paste, not the business case.
        return { ...record, text: source.replace(/^(?:[①-⑳㉑-㉟㊱-㊿]|(?:案件\s*)?[0-9０-９]+[.．、)）](?![0-9０-９]))\s*/u, '') }
      })
      // Personnel introductions pasted as cases are reported back, never saved as cases.
      const result: ImportCaseTextBatchResult = {
        created: 0,
        duplicates: 0,
        failed: 0,
        remainingText: '',
        reviewIds: [],
        createdReviewIds: [],
        skippedPersonnel: personnel.length
      }
      const failed: string[] = []
      for (const record of records) {
        try {
          const imported = await importChatPastedJobCaseText(
            { repository: context.repository, localNer: context.localNer, operator: context.currentOperator() },
            record.text,
            new Date(),
            record.fields,
            batchId,
            effectiveJobCaseFieldAliases(context.repository).aliases
          )
          if (imported.outcome === 'created') {
            result.created++
            result.createdReviewIds!.push(imported.review.reviewId)
          } else result.duplicates++
          result.reviewIds.push(imported.review.reviewId)
        } catch {
          result.failed++
          failed.push(record.text)
        }
      }
      result.remainingText = failed.join('\n\n')
      return result
    } finally {
      clearTimeout(timeout)
      controller.signal.removeEventListener('abort', cancel)
    }
  }
  return (raw: { text: string }): Promise<ImportCaseTextBatchResult> => {
    const { text } = createChatPasteJobCaseDraftInputSchema.parse(raw)
    const key = createHash('sha256').update(text).digest('hex')
    const existing = active.get(key)
    if (existing) return existing
    const promise = run(text).finally(() => active.delete(key))
    active.set(key, promise)
    return promise
  }
}
