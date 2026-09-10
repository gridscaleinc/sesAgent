// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { classifyGmailMessage, GmailReadClient, decodeGmailMessage, gmailReplyMailbox, isGmailMethodAllowed } from './index'
it('decodes resume parts and uses Reply-To before From', () => {
  const envelope = decodeGmailMessage({ id: 'm1', threadId: 't1', historyId: '1', internalDate: String(Date.now()), labelIds: ['INBOX'], payload: {
    headers: [{ name: 'From', value: 'Sender <sender@example.com>' }, { name: 'Reply-To', value: 'Partner <reply@example.com>' }],
    parts: [{ filename: 'resume.xlsx', mimeType: 'application/octet-stream', body: { attachmentId: 'attach_1', size: 42 } },
      { mimeType: 'text/plain', body: { data: Buffer.from('要員紹介').toString('base64url') } }]
  } })
  expect(envelope.replyTo).toBe('reply@example.com')
  expect(envelope.resumeAttachments).toEqual([{ id: 'attach_1', name: 'resume.xlsx', size: 42 }])
})
it('fetches attachments through GET only and validates actual size', async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ size: 4, data: Buffer.from('test').toString('base64url') })))
  const client = new GmailReadClient(async () => 'test-token', fetcher)
  expect((await client.getAttachment('m1', { id: 'a1', name: 'resume.pdf', size: 4 })).toString()).toBe('test')
  expect(fetcher.mock.calls[0]?.[0]).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/attachments/a1')
  expect(isGmailMethodAllowed('POST', '/gmail/v1/users/me/messages/m1/attachments/a1')).toBe(false)
  await expect(client.getAttachment('m1', { id: 'a1', name: 'resume.pdf', size: 30 * 1024 * 1024 })).rejects.toThrow('TOO_LARGE')
  await expect(client.getAttachment('m1', { id: 'inline', name: 'resume.pdf', size: 20, data: 'dGVzdA' })).rejects.toThrow('SIZE_MISMATCH')
})
it('rejects multiple recipients, mailto parameters and header injection', () => {
  for (const value of ['a@example.com,b@example.com', 'a@example.com?bcc=x@evil.com', 'a@example.com\r\nBcc:x@evil.com']) expect(gmailReplyMailbox(value)).toBeNull()
  expect(gmailReplyMailbox('Company <reply@example.co.jp>')).toBe('reply@example.co.jp')
})

it.each([
  ['Java要員のご提案', '単価：60万、9月から稼働可能。案件をご紹介ください。', 'candidate-proposal'],
  ['人员介绍', 'Java 经验10年，单价60万。', 'candidate-proposal'],
  ['Java案件・要員募集', '要員のスキルシートをご提出ください。単価：60万', 'job-case'],
  ['ご確認ください', '氏名：A\nスキル：Java\n単価：60万\n稼働：即日', 'candidate-proposal']
])('classifies %s by purpose without treating personnel rates as a job opening', (subject, body, expected) => {
  expect(classifyGmailMessage({ subject, body } as any)).toBe(expected)
})
it('uses the resume attachment name when the covering mail has no classification words', () => {
  expect(classifyGmailMessage({ subject: '資料送付', body: '添付をご確認ください。', resumeAttachments: [{ name: 'スキルシート.xlsx' }] } as any)).toBe('candidate-proposal')
})
