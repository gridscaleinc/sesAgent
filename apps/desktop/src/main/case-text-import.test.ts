import { expect, it, vi } from 'vitest'
import { loadAgentChatModelCatalog } from '@agent'
import { caseEvidenceUnits, createCaseTextBatchImporter } from './case-text-import'
import { importChatPastedJobCaseText } from './business-text-intake'
import { fourInlineCases } from './case-text-import.fixture'

vi.mock('./business-text-intake', () => ({ importChatPastedJobCaseText: vi.fn() }))
vi.mock('./app-defaults', () => ({ effectiveJobCaseFieldAliases: () => ({ aliases: {} }) }))

function context(extractBusinessText = vi.fn()) {
  return { repository: {}, localNer: null, currentOperator: () => ({ operatorId: 'operator', displayName: 'HR' }),
    agentChatModelCatalog: loadAgentChatModelCatalog(), agentNarrativeStreamer: { extractBusinessText, cancel: vi.fn() } } as any
}

it('passes the whole four-case message to AI, then saves only its grounded independent ranges', async () => {
  const units = caseEvidenceUnits(fourInlineCases)
  const starts = ['⑥', '⑦', '⑧', '⑨'].map(marker => units.findIndex(unit => unit.text.startsWith(marker)))
  expect(starts.every(index => index >= 0)).toBe(true)
  const extract = vi.fn(async (_input: unknown) => ({ kind: 'records', records: starts.map((start, index) => ({ kind: 'job-case', startLine: start + 1,
    endLine: starts[index + 1] ?? units.length, fields: {} })) }))
  vi.mocked(importChatPastedJobCaseText).mockImplementation(async (_deps, text) => ({ outcome: 'created', review: { reviewId: text } } as any))
  const result = await createCaseTextBatchImporter(context(extract))({ text: fourInlineCases })
  expect(extract).toHaveBeenCalledOnce()
  expect(extract.mock.calls[0]![0]).toMatchObject({ caseBatch: true, text: units.map(unit => unit.text).join('\n') })
  expect(result.created).toBe(4)
  const sources = vi.mocked(importChatPastedJobCaseText).mock.calls.map(call => call[1])
  expect(sources[0]).toContain('Snowflake3年以上')
  expect(sources[0]).not.toContain('Terraform')
  expect(sources[1]).toContain('ClaudeCode')
  expect(sources[2]).toContain('PL1名')
  expect(sources[2]).not.toContain('ASP.NET')
  expect(sources[3]).toContain('C#（ASP.NET）')
})

it('uses AI boundaries for unnumbered prose and preserves failed cases for retry', async () => {
  vi.mocked(importChatPastedJobCaseText).mockReset().mockResolvedValueOnce({ outcome: 'already-imported', review: { reviewId: 'old' } } as any).mockRejectedValueOnce(new Error('db'))
  const text = '金融向けJava開発を募集、東京で10月開始。別の顧客はAWS運用を募集、フルリモート。'
  const extract = vi.fn(async () => ({ kind: 'records', records: [
    { kind: 'job-case', startLine: 1, endLine: 2, fields: {} }, { kind: 'job-case', startLine: 3, endLine: 4, fields: {} }
  ] }))
  const result = await createCaseTextBatchImporter(context(extract))({ text })
  expect(result).toMatchObject({ created: 0, duplicates: 1, failed: 1, remainingText: '別の顧客はAWS運用を募集、フルリモート。' })
})

it('never falls back to a single saved case when AI fails or returns overlapping ranges', async () => {
  vi.mocked(importChatPastedJobCaseText).mockClear()
  for (const extract of [vi.fn().mockRejectedValue(new Error('offline')), vi.fn().mockResolvedValue({ kind: 'unusable' }),
    vi.fn().mockResolvedValue({ kind: 'records', records: [{ kind: 'job-case', startLine: 1, endLine: 2 }, { kind: 'job-case', startLine: 2, endLine: 3 }] })]) {
    await expect(createCaseTextBatchImporter(context(extract))({ text: fourInlineCases })).rejects.toThrow()
  }
  expect(importChatPastedJobCaseText).not.toHaveBeenCalled()
})
