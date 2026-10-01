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
      // Nothing pasted is lost: passages the model set aside (not a case, not a person) and any line no range covers
      // stay in the box with the cases that failed to save, for the operator to check.
      const covered = new Set<number>()
      for (const range of [...extraction.records, ...personnel])
        for (let line = range.startLine; line <= range.endLine; line++) covered.add(line)
      // Each uncovered run is kept as the original slice, line breaks included. Blank runs and a bare greeting or
      // sign-off (「お世話になっております」「以上」) are not business text: neither kept nor counted as unrecognized.
      const unrecognized: string[] = []
      let first: number | null = null
      const flush = (last: number) => {
        if (first === null) return
        const slice = text.slice(units[first]!.start, units[last]!.end).replace(/^\s*\n|\n\s*$/gu, '')
        first = null
        if (!slice.trim() || isGreetingOnly(slice)) return
        unrecognized.push(slice)
      }
      units.forEach((_unit, index) => {
        if (covered.has(index + 1)) flush(index - 1)
        else if (first === null) first = index
      })
      flush(units.length - 1)
      result.unrecognized = unrecognized.length
      // The personnel introductions set aside go to 人员 import as they were pasted.
      result.skippedPersonnelText = personnel
        .map((range) => text.slice(units[range.startLine - 1]!.start, units[range.endLine - 1]!.end).trim())
        .filter(Boolean)
        .join('\n\n')
      result.remainingText = [...failed, ...unrecognized].join('\n\n')
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

/** A short run of salutations and sign-offs only: what mails and chats wrap cases in, not a case. */
function isGreetingOnly(text: string): boolean {
  const rest = text
    .normalize('NFKC')
    .replace(
      /お世話になっております|お世話になります|お疲れ様です|お疲れさまです|いつもありがとうございます|よろしくお願いいたします|よろしくお願いします|宜しくお願いいたします|宜しくお願いします|ご確認ください|ご検討ください|以上(?:です|となります)?|下記(?:の)?案件(?:を|の)?(?:ご紹介|ご案内)(?:いたします|します)?|您好|你好|大家好|谢谢|感谢|以上是[^\n]{0,20}|[-=_*~─━・。、,.!！?？:：\s]/gu,
      ''
    )
  return text.trim().length <= 80 && rest.length === 0
}
