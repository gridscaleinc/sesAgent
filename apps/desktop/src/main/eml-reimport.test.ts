import { describe, expect, it } from 'vitest'
import type { JobCaseReviewSnapshot } from '@shared'
import { emlReimport } from './eml-reimport'

const key = `eml_${'a'.repeat(64)}`
const review = (reviewId: string, lifecycle: 'active' | 'archived') => ({ reviewId, lifecycle }) as JobCaseReviewSnapshot

describe('EML re-import', () => {
  it('stores a new mail under its own key and reports the active case as a duplicate', () => {
    expect(emlReimport(key, () => null)).toEqual({ messageKey: key })
    expect(emlReimport(key, () => review('r1', 'active'))).toEqual({ duplicate: review('r1', 'active') })
  })

  it('takes a fresh key after each ended case, and is a duplicate of the re-imported case while it is active', () => {
    const stored = new Map<string, JobCaseReviewSnapshot>([[key, review('r1', 'archived')]])
    const first = emlReimport(key, (k) => stored.get(k) ?? null)
    expect('messageKey' in first && first.messageKey).toMatch(/^eml_[a-f0-9]{64}$/u)
    const second = 'messageKey' in first ? first.messageKey : ''
    expect(second).not.toBe(key)
    stored.set(second, review('r2', 'active'))
    expect(emlReimport(key, (k) => stored.get(k) ?? null)).toEqual({ duplicate: review('r2', 'active') })
    stored.set(second, review('r2', 'archived'))
    const third = emlReimport(key, (k) => stored.get(k) ?? null)
    expect('messageKey' in third && ![key, second].includes(third.messageKey)).toBe(true)
  })
})
