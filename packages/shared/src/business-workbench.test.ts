import { describe, expect, it } from 'vitest'
import { splitBusinessBatch, builtInPersonnelTemplates, generatePersonnelMessage, savePersonnelTemplateSchema, personnelMessageInputSchema } from './business-workbench'
import { canonicalizeJobCaseLabelLine } from './job-case-field-aliases'
import type { CandidateReviewSnapshot } from './contracts'

describe('bulk business records', () => {
  it('preserves mixed messages and their original line ranges', () => {
    const text = '\n【案件】\n案件名：Java 基盤\n単価：80万円\n\n【要員】\n氏名：テスト\nスキル：Java\n----\n案件名：AWS構築\n備考：長文\n'
    expect(splitBusinessBatch(text)).toEqual([
      { text: '【案件】\n案件名：Java 基盤\n単価：80万円', startLine: 2, endLine: 4 },
      { text: '【要員】\n氏名：テスト\nスキル：Java', startLine: 6, endLine: 8 },
      { text: '案件名：AWS構築\n備考：長文', startLine: 10, endLine: 11 }
    ])
  })
  it('keeps oversize records intact and rejects oversized batches', () => {
    const text = `案件名：長文\n${'あ'.repeat(6000)}`
    expect(splitBusinessBatch(text)[0]?.text).toBe(text)
    expect(() => splitBusinessBatch('あ'.repeat(100001))).toThrow()
    expect(() => splitBusinessBatch(Array.from({ length: 201 }, (_, i) => `案件名：${i}`).join('\n'))).toThrow()
  })
  it('accepts bracketed labels without a colon', () => {
    expect(canonicalizeJobCaseLabelLine('【単価】80万円', {})).toBe('単価：80万円')
    expect(canonicalizeJobCaseLabelLine('【案件名】Java基盤', {})).toBe('案件名：Java基盤')
  })
})

describe('personnel promotion templates', () => {
  it('renders confirmed facts and missing placeholders with an anonymous label', () => {
    const review = { documentId: '11111111-1111-4111-8111-111111111111', fields: [{ key: 'skills', value: 'Java, AWS' }], localIdentity: { displayName: 'PRIVATE_NAME' } } as CandidateReviewSnapshot
    const message = generatePersonnelMessage(review, builtInPersonnelTemplates()[0]!, 'zh')
    expect(message).toContain('Java, AWS')
    expect(message).toContain('人员 11111111')
    expect(message).toContain('待确认')
    expect(message).not.toContain('PRIVATE_NAME')
    expect(message).not.toContain('{{')
  })
  it('rejects unknown or malformed template fields and recipient injection', () => {
    const template = builtInPersonnelTemplates()[0]!
    for (const body of ['{{phone}}', '{{skills}', '{{}}', '{{{{skills}}']) expect(savePersonnelTemplateSchema.safeParse({ ...template, bodyJa: body }).success).toBe(false)
    expect(savePersonnelTemplateSchema.safeParse(template).success).toBe(true)
    expect(personnelMessageInputSchema.safeParse({ documentId: template.id, profileVersion: 1, templateId: template.id, templateRevision: 1, lang: 'ja', text: '紹介', to: 'nobody@example.com' }).success).toBe(false)
  })
})
