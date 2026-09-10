import { beforeEach, expect, it, vi } from 'vitest'
import { importPendingGmailPersonnel } from './gmail-personnel-intake'
import { importPastedCandidateText } from './business-text-intake'
import { importStagedResumeLocally } from './local-resume-analysis'
vi.mock('./business-text-intake', () => ({ importPastedCandidateText: vi.fn() }))
vi.mock('./local-resume-analysis', () => ({ importStagedResumeLocally: vi.fn() }))

beforeEach(() => vi.clearAllMocks())
function setup(attachments: Array<{ id: string; name: string; size: number }> = []) {
  const states = new Map<string, any>(); const reviews = new Map<string, any>(); const files = new Map<string, any>()
  const repository = {
    listPendingGmailBusinessIntake: () => states.get('m')?.status === 'completed' ? [] : [{ messageId: 'm', classification: 'candidate-proposal' }],
    getGmailBusinessIntake: () => states.get('m') ?? null,
    saveGmailBusinessIntake: (input: any) => states.set('m', structuredClone(input)),
    getCandidateReview: (id: string) => reviews.get(id),
    findResumeDocumentByHash: () => null,
    saveStagedFiles: (input: any[]) => input.forEach((item) => files.set(item.token, item)),
    getStagedFileRecords: (ids: string[]) => ids.map((id) => files.get(id))
  }
  const context = { repository, fileVault: { stageBytes: vi.fn(async (name: string) => ({ token: name, name })) }, processingResources: { run: (_: string, fn: () => any) => fn() } }
  const gmail = { getMessage: vi.fn(async () => ({ id: 'm', internalDate: '2026-09-09T00:00:00Z', subject: '要員紹介', body: '氏名：A\nスキル：Java', replyTo: 'partner@example.com', resumeAttachments: attachments, attachmentCount: attachments.length })), getAttachment: vi.fn(async () => Buffer.from('test')) }
  vi.mocked(importStagedResumeLocally).mockImplementation(async (_: any, record: any) => { reviews.set(record.token, { documentId: record.token }); return record.token })
  vi.mocked(importPastedCandidateText).mockResolvedValue({ review: { documentId: 'body-person' }, outcome: 'created' } as any)
  return { context, gmail, states, reviews }
}
it('imports an attachment once, remembers the reply address, and does not create a second person from the covering letter', async () => {
  const { context, gmail, states } = setup([{ id: 'a', name: 'resume.xlsx', size: 4 }])
  expect(await importPendingGmailPersonnel(context as any, gmail as any, 'inbox@example.com')).toEqual({ personnel: 1, failed: 0 })
  expect(states.get('m')).toMatchObject({ status: 'completed', replyTo: 'partner@example.com', parts: { a: 'resume.xlsx' } })
  expect(importPastedCandidateText).not.toHaveBeenCalled()
  await importPendingGmailPersonnel(context as any, gmail as any, 'inbox@example.com')
  expect(gmail.getAttachment).toHaveBeenCalledTimes(1)
})
it('continues other attachments after failure and retries only the missing one', async () => {
  const { context, gmail, states } = setup([{ id: 'a', name: 'bad.pdf', size: 4 }, { id: 'b', name: 'good.xlsx', size: 4 }])
  gmail.getAttachment.mockRejectedValueOnce(new Error('offline'))
  expect(await importPendingGmailPersonnel(context as any, gmail as any, 'inbox@example.com')).toEqual({ personnel: 1, failed: 1 })
  expect(states.get('m').status).toBe('error')
  expect(await importPendingGmailPersonnel(context as any, gmail as any, 'inbox@example.com')).toEqual({ personnel: 1, failed: 0 })
  expect(gmail.getAttachment).toHaveBeenCalledTimes(3)
  expect(states.get('m').status).toBe('completed')
})
it('creates personnel from the message body when there is no resume attachment', async () => {
  const { context, gmail } = setup()
  await importPendingGmailPersonnel(context as any, gmail as any, 'inbox@example.com')
  expect(importPastedCandidateText).toHaveBeenCalledWith(context, '氏名：A\nスキル：Java', new Date('2026-09-09T00:00:00Z'))
  expect(importStagedResumeLocally).not.toHaveBeenCalled()
})
