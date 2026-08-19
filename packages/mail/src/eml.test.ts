// @vitest-environment node
import { createHash } from 'node:crypto'
import { parseEmlMessage, type EmlFileManifest } from './eml'

function manifest(name: string, bytes: Buffer): EmlFileManifest {
  return { name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}

describe('parseEmlMessage', () => {
  it('parses a bounded MIME message locally while discarding attachment content and hashing identities', async () => {
    const bytes = Buffer.from([
      'From: =?UTF-8?B?5bGx55Sw5aSq6YOO?= <taro.yamada@partner.example.jp>',
      'To: sales@example.co.jp',
      'Subject: Java / AWS 案件のご相談',
      'Message-ID: <candidate-123@partner.example.jp>',
      'Date: Fri, 17 Jul 2026 09:30:00 +0900',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="case-boundary"',
      '',
      '--case-boundary',
      'Content-Type: text/plain; charset=utf-8',
      '',
      '募集ロール：バックエンドエンジニア',
      '必須スキル：Java / Spring Boot / AWS',
      '単価：90万円/月',
      '電話：090-1234-5678',
      '--case-boundary',
      'Content-Type: application/pdf; name="private-resume.pdf"',
      'Content-Disposition: attachment; filename="private-resume.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'UFJJVkFURV9BVFRBQ0hNRU5UX1NFTlRJTkVM',
      '--case-boundary--'
    ].join('\r\n'), 'utf8')
    const parsed = await parseEmlMessage(manifest('case.eml', bytes), bytes, new Date('2026-07-19T00:00:00.000Z'))

    expect(parsed).toMatchObject({
      version: 'parsed-eml-v1',
      subject: 'Java / AWS 案件のご相談',
      senderDisplayName: '山田太郎',
      fromDomain: 'partner.example.jp',
      messageDate: '2026-07-17T00:30:00.000Z',
      attachmentCount: 1,
      classification: 'job-case',
      security: { externalContentLoaded: false, attachmentsPersisted: false, rawFileCloudEligible: false }
    })
    expect(parsed.sourceMessageKey).toMatch(/^eml_[a-f0-9]{64}$/u)
    expect(parsed.threadKey).toMatch(/^emlt_[a-f0-9]{64}$/u)
    expect(parsed.warningCodes).toContain('EML_ATTACHMENTS_IGNORED')
    expect(JSON.stringify(parsed)).not.toContain('PRIVATE_ATTACHMENT_SENTINEL')
  })

  it('converts HTML to non-executable text and does not fetch linked content', async () => {
    const bytes = Buffer.from([
      'From: bp@partner.example.jp',
      'Subject: Python案件',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<html><head><style>.x{display:none}</style></head><body><p>募集：Python案件</p><img src="https://tracker.invalid/pixel"><script>fetch("https://tracker.invalid")</script><p>単価：80万円</p></body></html>'
    ].join('\r\n'), 'utf8')
    const parsed = await parseEmlMessage(manifest('html-case.eml', bytes), bytes, new Date('2026-07-19T00:00:00.000Z'))

    expect(parsed.body).toContain('募集：Python案件')
    expect(parsed.body).toContain('単価：80万円')
    expect(parsed.body).not.toContain('fetch(')
    expect(parsed.warningCodes).toContain('EML_HTML_CONVERTED_TO_TEXT')
    expect(parsed.security.externalContentLoaded).toBe(false)
  })

  it('fails closed when MIME headers exceed the configured safety boundary', async () => {
    const bytes = Buffer.from(`X-Large: ${'a'.repeat(270_000)}\r\nSubject: Java案件\r\n\r\n必須スキル：Java / AWS`, 'utf8')
    await expect(parseEmlMessage(manifest('large-header.eml', bytes), bytes)).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED'
    })
  })
})
