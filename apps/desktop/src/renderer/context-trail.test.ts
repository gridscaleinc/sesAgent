import { describe, expect, it } from 'vitest'
import { pushContextAccess } from './context-trail'

const cases = { type: 'system-access' as const, destination: 'job-cases' as const }
const review = { type: 'system-access' as const, destination: 'case-review' as const, reviewId: 'r1' }
const matching = { type: 'system-access' as const, destination: 'matching' as const, jobCaseId: 'j1' }
const matchingOther = { type: 'system-access' as const, destination: 'matching' as const, jobCaseId: 'j2' }
const overview = { type: 'system-access' as const, destination: 'candidate' as const, sourceDocumentId: 'd1', view: 'overview' as const }
const resume = { type: 'system-access' as const, destination: 'candidate' as const, sourceDocumentId: 'd1', view: 'resume' as const }

describe('pushContextAccess', () => {
  it('stacks another screen so the operator can step back to where it was opened from', () => {
    const trail = pushContextAccess(pushContextAccess([cases], review), matching)
    expect(trail).toEqual([cases, review, matching])
    expect(trail.slice(0, -1)).toEqual([cases, review])
  })

  it('replaces the screen when only a tab or the picked case changes', () => {
    expect(pushContextAccess([cases, overview], resume)).toEqual([cases, resume])
    expect(pushContextAccess([review, matching], matchingOther)).toEqual([review, matchingOther])
    const queueOnCaseA = { type: 'system-access' as const, destination: 'broadcast' as const, reviewId: 'r1' }
    const queueOnCaseB = { type: 'system-access' as const, destination: 'broadcast' as const, reviewId: 'r2' }
    expect(pushContextAccess([cases, queueOnCaseA], queueOnCaseB)).toEqual([cases, queueOnCaseB])
  })

  it('never grows past its limit', () => {
    let trail = pushContextAccess([], cases)
    for (let index = 0; index < 30; index += 1) {
      trail = pushContextAccess(trail, { type: 'system-access', destination: 'case-review', reviewId: `r${index}` })
    }
    expect(trail).toHaveLength(20)
    expect(trail[trail.length - 1]).toEqual({ type: 'system-access', destination: 'case-review', reviewId: 'r29' })
  })
})
