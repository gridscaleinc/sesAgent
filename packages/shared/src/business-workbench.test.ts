import { describe, expect, it } from 'vitest'
import {
  splitBusinessBatch,
  builtInPersonnelTemplates,
  generatePersonnelMessage,
  savePersonnelTemplateSchema,
  personnelMessageInputSchema
} from './business-workbench'
import { canonicalizeJobCaseLabelLine } from './job-case-field-aliases'
import type { CandidateReviewSnapshot } from './contracts'

describe('bulk business records', () => {
  it('splits Chinese and Japanese case headings without treating contacts or interior rules as cases', () => {
    const parts = splitBusinessBatch(
      '项目名称：Java开发\n----\n必須：Java\n氏名：担当者\n案件名称：AWS构筑\n必須：AWS\n【案件名】Python開発\n必須：Python',
      'case'
    )
    expect(parts.map((item) => item.text)).toEqual([
      '项目名称：Java开发\n----\n必須：Java\n氏名：担当者',
      '案件名称：AWS构筑\n必須：AWS',
      '【案件名】Python開発\n必須：Python'
    ])
    expect(
      splitBusinessBatch('【案件１】\n案件名：Java\n必須：Java\n案件２\n案件名：AWS\n必須：AWS', 'case').map((item) => item.text)
    ).toEqual(['【案件１】\n案件名：Java\n必須：Java', '案件２\n案件名：AWS\n必須：AWS'])
  })
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
    const review = {
      documentId: '11111111-1111-4111-8111-111111111111',
      fields: [{ key: 'skills', value: 'Java, AWS' }],
      localIdentity: { displayName: 'PRIVATE_NAME' }
    } as CandidateReviewSnapshot
    const message = generatePersonnelMessage(review, builtInPersonnelTemplates()[0]!, 'zh')
    expect(message).toContain('Java')
    expect(message).toContain('AWS')
    expect(message).toContain('人员 11111111')
    expect(message).toContain('[发送前填写]')
    expect(message).not.toContain('PRIVATE_NAME')
    expect(message).not.toContain('{{')
  })
  it('rejects unknown or malformed template fields and recipient injection', () => {
    const template = builtInPersonnelTemplates()[0]!
    for (const body of ['{{phone}}', '{{skills}', '{{}}', '{{{{skills}}'])
      expect(savePersonnelTemplateSchema.safeParse({ ...template, bodyJa: body }).success).toBe(false)
    expect(savePersonnelTemplateSchema.safeParse(template).success).toBe(true)
    expect(
      personnelMessageInputSchema.safeParse({
        documentId: template.id,
        profileVersion: 1,
        templateId: template.id,
        templateRevision: 1,
        lang: 'ja',
        text: '紹介',
        to: 'nobody@example.com'
      }).success
    ).toBe(false)
  })
})
