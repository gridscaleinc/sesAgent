import { describe, expect, it } from 'vitest'
import { interviewQuestionPolicy } from '@shared'
import * as narrative from './agent-cloud-narrative'

// Every static instruction set must pass the identifier check, or the cloud feature it serves would be blocked.
const staticInstructions = Object.entries(narrative)
  .filter(([name, value]) => /Instructions$/u.test(name) && (typeof value === 'string' || Array.isArray(value)))
  .map(([name, value]) => [name, Array.isArray(value) ? value.join(' ') : (value as string)] as const)

describe('cloud instructions identifier check', () => {
  it('accepts every static instruction set, including placeholder vocabulary', () => {
    expect(staticInstructions.length).toBeGreaterThan(5)
    for (const [name, text] of [...staticInstructions, ['interviewQuestionPolicy', interviewQuestionPolicy] as const]) {
      expect(() => narrative.assertInstructionsWithoutIdentifiers(text), name).not.toThrow()
    }
    expect(() => narrative.assertInstructionsWithoutIdentifiers('Never reveal <PERSON_NAME_001> or <PRIVATE_EMAIL_002>.')).not.toThrow()
  })

  it('blocks instructions that carry a direct identifier, such as an alias or retry hint built from user text', () => {
    expect(() => narrative.assertInstructionsWithoutIdentifiers('Treat 担当 as contact: taro.yamada@example.co.jp')).toThrow(/个人信息/)
    expect(() => narrative.assertInstructionsWithoutIdentifiers('Retry: the answer quoted 090-1234-5678.')).toThrow(/个人信息/)
  })
})

describe('planning instructions', () => {
  it('route "which people match this case" to matching for the selected case, not a case search', () => {
    const text = narrative.planningInstructions
    expect(text).toMatch(/state\.selectedJobCase is true and the user asks which people fit[^']*plan match_candidates with ordinal null/u)
    expect(text).toContain('这个案件有哪些匹配的人员')
  })
})
