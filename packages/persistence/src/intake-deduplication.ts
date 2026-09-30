import { createHash } from 'node:crypto'
import type { DocumentIR } from '@parsers'

// Compare content, never names alone. Keep case and punctuation meaningful;
// width variants and whitespace introduced by paste / document layout are ignored.
export function normalizedIntakeText(text: string): string {
  return text.normalize('NFKC').replace(/[\s\u200b\ufeff]+/gu, '')
}
export function candidateContentFingerprint(document: Pick<DocumentIR, 'blocks'>): string | null {
  const content = normalizedIntakeText(document.blocks.map((block) => block.text).join('\n'))
  return content ? createHash('sha256').update(content).digest('hex') : null
}
export class DuplicateCandidateError extends Error {
  constructor(readonly documentId: string) {
    super('相同人员资料已存在，请查看已有记录。 / 同じ要員資料は登録済みです。既存の資料をご確認ください。')
    this.name = 'DuplicateCandidateError'
  }
}

export function jobCaseIntakeFingerprint(
  subject: string,
  body: string,
  mappings: Array<{ placeholder: string; originalValue: string }> = []
): string {
  const originals = new Map(mappings.map((item) => [item.placeholder, item.originalValue]))
  const restore = (value: string) => value.replace(/<[A-Z][A-Z0-9_]*?_\d{3,}>/gu, (token) => originals.get(token) ?? token)
  subject = restore(subject)
  body = restore(body)
  // A title explicitly present in the body identifies the case across mail,
  // manual and chat wrappers. Otherwise retain the subject to distinguish cases.
  const hasTitle = /(?:^|\n)\s*[【\[■●◆]?\s*(?:案件名|案件概要|案件名称|项目名称|タイトル)\s*[】\]]?\s*[:：]\s*\S/u.test(body)
  const content = normalizedIntakeText(hasTitle ? body : `${subject}\n${body}`)
  return createHash('sha256').update(content).digest('hex')
}
