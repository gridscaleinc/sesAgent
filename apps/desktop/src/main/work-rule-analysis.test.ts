import { describe, expect, it } from 'vitest'
import { validateWorkRuleAnalysis } from './work-rule-analysis'
import { applicableWorkRules, type WorkRuleRecord } from '@shared'

const clause = {
  kind: 'preferred',
  field: 'required_skills',
  text: 'AWS実務経験',
  sourceQuote: 'Java案件ではAWS実務経験を優先',
  caseKeywords: ['Java']
}
describe('HR rule interpretation', () => {
  it('keeps preferred conditions and explicit conditional scope', () => {
    const result = validateWorkRuleAnalysis({ clauses: [clause], issues: [] }, clause.sourceQuote)
    expect(result.clauses[0]?.kind).toBe('preferred')
    expect(result.clauses[0]?.caseKeywords).toEqual(['Java'])
  })
  it('rejects upgrading a preference into a hard requirement', () => {
    const result = validateWorkRuleAnalysis({ clauses: [{ ...clause, kind: 'required' }], issues: [] }, clause.sourceQuote)
    expect(result.clauses).toEqual([])
    expect(result.issues).not.toHaveLength(0)
  })
  it('rejects invented thresholds and fabricated quotations', () => {
    expect(validateWorkRuleAnalysis({ clauses: [{ ...clause, text: 'AWS 5年以上' }], issues: [] }, clause.sourceQuote).clauses).toEqual([])
    expect(validateWorkRuleAnalysis({ clauses: [clause], issues: [] }, 'Java案件を優先').clauses).toEqual([])
    expect(
      validateWorkRuleAnalysis(
        { clauses: [{ ...clause, text: 'AWS 3年以上', sourceQuote: '2023年からAWSを利用した経験を優先', caseKeywords: [] }], issues: [] },
        '2023年からAWSを利用した経験を優先'
      ).clauses
    ).toEqual([])
  })
  it('does not accept model-produced commands or unexpected fields', () => {
    expect(() => validateWorkRuleAnalysis({ clauses: [{ ...clause, execute: 'send-mail' }], issues: [] }, clause.sourceQuote)).toThrow()
  })
  it('requires condition keywords to have source evidence', () => {
    expect(
      validateWorkRuleAnalysis({ clauses: [{ ...clause, caseKeywords: ['Python'] }], issues: [] }, clause.sourceQuote).clauses
    ).toEqual([])
  })
})
describe('rule scope', () => {
  const rule = { id: 'r', revision: 1, enabled: true, scope: { kind: 'global' }, clauses: [clause] } as unknown as WorkRuleRecord
  const library = { revision: 1, rules: [rule] }
  it('keeps Java rules out of JavaScript cases and stopped rules out of all cases', () => {
    expect(applicableWorkRules(library, { id: 'a', fields: [{ key: 'required_skills', value: 'JavaScript' }] })).toEqual([])
    expect(applicableWorkRules(library, { id: 'a', fields: [{ key: 'required_skills', value: 'Java' }] })).toHaveLength(1)
    expect(
      applicableWorkRules(
        { ...library, rules: [{ ...rule, enabled: false }] },
        { id: 'a', fields: [{ key: 'required_skills', value: 'Java' }] }
      )
    ).toEqual([])
  })
  it('does not apply another case’s rule', () => {
    expect(
      applicableWorkRules(
        { ...library, rules: [{ ...rule, scope: { kind: 'case', value: 'b' } }] },
        { id: 'a', fields: [{ key: 'required_skills', value: 'Java' }] }
      )
    ).toEqual([])
  })
})
