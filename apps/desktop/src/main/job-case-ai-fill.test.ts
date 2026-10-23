// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { jobCaseFieldKeys, type JobCaseReviewSnapshot } from '@shared/contracts'
import {
  applyJobCaseFieldCorrections,
  createJobCaseAiFiller,
  fillJobCaseFieldsWithAi,
  needsAiFill,
  suggestJobCaseFieldCorrections,
  type JobCaseAiFillContext
} from './job-case-ai-fill'

vi.mock('./app-defaults', () => ({ effectiveJobCaseFieldAliases: () => ({ aliases: {} }) }))
vi.mock('./business-model', () => ({ businessModel: () => ({ key: 'test-model' }) }))

const review = (reviewId: string, values: Record<string, string | null>, change: Partial<JobCaseReviewSnapshot> = {}) =>
  ({
    reviewId,
    lifecycle: 'active',
    status: 'completed',
    reviewRevision: 3,
    fields: jobCaseFieldKeys.map((key) => ({ key, label: key, value: key in values ? values[key] : `${key} value` })),
    ...change
  }) as unknown as JobCaseReviewSnapshot

function setup(
  reviews: JobCaseReviewSnapshot[],
  complete = vi.fn().mockResolvedValue({ start_date: '2026年11月〜長期', location: '渋谷駅' })
) {
  const byId = new Map(reviews.map((item) => [item.reviewId, item]))
  const repository = {
    getJobCaseReview: vi.fn((id: string) => byId.get(id) ?? null),
    getJobCaseSourceText: vi.fn(() => ({ redactedSubject: '【案件】Java開発', redactedBody: '期間：2026年11月〜長期\n場所：渋谷駅' })),
    fillEmptyJobCaseFields: vi.fn((reviewId: string, values: Record<string, string>) => {
      const current = byId.get(reviewId)!
      const filled = current.fields.filter((field) => field.value === null && values[field.key]).map((field) => field.key)
      const next = { ...current, fields: current.fields.map((field) => ({ ...field, value: field.value ?? values[field.key] ?? null })) }
      byId.set(reviewId, next)
      return { review: next, filled }
    }),
    reviseJobCaseFields: vi.fn((reviewId: string, _revision: number, values: Record<string, string>) => {
      const current = byId.get(reviewId)!
      const changed = current.fields.filter((field) => values[field.key] && values[field.key] !== field.value).map((field) => field.key)
      return { review: current, changed }
    })
  }
  const context = {
    repository,
    agentNarrativeStreamer: { completeJobCaseFields: complete, cancel: vi.fn() },
    agentChatModelCatalog: [],
    currentOperator: () => ({ operatorId: 'op-1', displayName: '高橋 遥' })
  } as unknown as JobCaseAiFillContext
  return { context, repository, complete }
}

it('asks AI only for the empty fields of a valid case, from its redacted source, and fills only those', async () => {
  const { context, repository, complete } = setup([review('a', { start_date: null, location: null, notes: null })])
  const result = await fillJobCaseFieldsWithAi(context, 'a')
  expect(result.filled).toEqual(['location', 'start_date'])
  // In field order; never the title.
  expect(complete.mock.calls[0]![0].keys).toEqual(['location', 'start_date', 'notes'])
  const input = complete.mock.calls[0]![0]
  expect(input.text).toBe('【案件】Java開発\n期間：2026年11月〜長期\n場所：渋谷駅')
  expect(repository.fillEmptyJobCaseFields).toHaveBeenCalledWith(
    'a',
    { start_date: '2026年11月〜長期', location: '渋谷駅' },
    'AIで未入力項目を補完',
    'op-1',
    '高橋 遥'
  )
})

it('does not call AI for a case with nothing empty, or for one that is not a valid active case', async () => {
  const { context, complete } = setup([review('full', {}), review('ended', { location: null }, { lifecycle: 'archived' } as never)])
  expect((await fillJobCaseFieldsWithAi(context, 'full')).filled).toEqual([])
  await expect(fillJobCaseFieldsWithAi(context, 'ended')).rejects.toThrow('補完できません')
  expect(complete).not.toHaveBeenCalled()
  expect(needsAiFill(review('x', { notes: null }))).toBe(false)
  expect(needsAiFill(review('x', { rate: null }))).toBe(true)
})

it('completes queued imports in the background, reports the filled ones, and stops at a credit failure', async () => {
  const complete = vi
    .fn()
    .mockResolvedValueOnce({ location: '渋谷駅' })
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new Error('AiCommerceRequestError: INSUFFICIENT_CREDITS'))
  const { context } = setup(
    [
      review('a', { location: null }),
      review('b', { rate: null }),
      review('c', { start_date: null }),
      review('d', { start_date: null }),
      review('complete', {})
    ],
    complete
  )
  const filler = createJobCaseAiFiller({ ...context, isAiSignedIn: async () => true })
  const filled = vi.fn()
  filler.onFilled(filled)
  filler.enqueue(['a', 'b', 'complete', 'c', 'd'])
  await filler.idle()
  // 'complete' needs nothing; 'd' is dropped after the credit failure on 'c'.
  expect(complete).toHaveBeenCalledTimes(3)
  expect(filled).toHaveBeenCalledExactlyOnceWith(['a'])
})

it('makes no AI call while the AI member is signed out', async () => {
  const { context, complete } = setup([review('a', { location: null })])
  const filler = createJobCaseAiFiller({ ...context, isAiSignedIn: async () => false })
  filler.enqueue(['a'])
  await filler.idle()
  expect(complete).not.toHaveBeenCalled()
})

it('re-checks a case against its source: lists differing and missing fields, not the same text written another way', async () => {
  const complete = vi.fn().mockResolvedValue({
    location: '渋谷駅',
    rate: '６５万円',
    start_date: '2026年11月〜',
    remote: '週2出社'
  })
  const { context, repository } = setup(
    [review('a', { location: '品川', rate: '65万円', start_date: '2026年11月～', remote: null, notes: '要員替換' })],
    complete
  )
  const result = await suggestJobCaseFieldCorrections(context, 'a')
  // rate and start_date differ only in width and wave dash; notes is not stated, so it is never suggested for removal.
  expect(result).toEqual({
    reviewId: 'a',
    reviewRevision: 3,
    corrections: [
      { key: 'location', current: '品川', suggested: '渋谷駅' },
      { key: 'remote', current: null, suggested: '週2出社' }
    ]
  })
  // Every field but the title is read; nothing is written by the re-check itself.
  expect(complete.mock.calls[0]![0].keys).not.toContain('title')
  expect(repository.reviseJobCaseFields).not.toHaveBeenCalled()

  // Only the accepted suggestion is applied, with the AI's own value, against the revision it was read for.
  const applied = applyJobCaseFieldCorrections(context, { reviewId: 'a', reviewRevision: 3, keys: ['location'] })
  expect(applied.filled).toEqual(['location'])
  expect(repository.reviseJobCaseFields).toHaveBeenCalledWith('a', 3, { location: '渋谷駅' }, 'AIの再確認で修正', 'op-1', '高橋 遥')
  // The suggestions are used once.
  expect(() => applyJobCaseFieldCorrections(context, { reviewId: 'a', reviewRevision: 3, keys: ['remote'] })).toThrow('古くなりました')
})

it('applies nothing that was not suggested, and nothing read for another revision', async () => {
  const { context, repository } = setup([review('a', { location: '品川' })], vi.fn().mockResolvedValue({ location: '渋谷駅' }))
  await suggestJobCaseFieldCorrections(context, 'a')
  expect(() => applyJobCaseFieldCorrections(context, { reviewId: 'a', reviewRevision: 4, keys: ['location'] })).toThrow('古くなりました')
  expect(applyJobCaseFieldCorrections(context, { reviewId: 'a', reviewRevision: 3, keys: ['rate'] }).filled).toEqual([])
  expect(repository.reviseJobCaseFields).not.toHaveBeenCalled()
})
