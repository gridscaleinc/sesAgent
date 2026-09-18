// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { GmailReadClient, GmailSyncCoordinator, gmailSyncConfigurationSchema, redactGmailMessageForLocalStorage,
  type GmailProcessedMessage, type GmailSyncCheckpointPortRecord, type GmailSyncRun } from './index'

const now = new Date('2026-09-11T01:00:00.000Z')
const config = gmailSyncConfigurationSchema.parse({ version: 'gmail-sync-config-v1', labelIds: ['INBOX'], query: '案件 OR 要員', lookbackDays: 30, maxMessagesPerRun: 2 })
function harness() {
  let checkpoint: GmailSyncCheckpointPortRecord | null = null
  let error: string | null = null
  let historyId = '100'
  let failMessage: string | null = null
  let rejectCursor = false
  let overflowingHistory = false
  let failProfile = false
  const messages = new Map<string, GmailProcessedMessage>()
  const queries: URL[] = []
  const store = {
    getGmailSyncCheckpoint: () => checkpoint,
    saveGmailSyncSuccess: (_account: string, configHash: string, historyId: string, lastRun: GmailSyncRun) => {
      checkpoint = structuredClone({ configHash, historyId, lastRun }); error = null
    },
    saveGmailSyncFailure: (_account: string, configHash: string, code: string, _at: string, lastRun: GmailSyncRun | null = null) => {
      checkpoint = structuredClone({ configHash, historyId: checkpoint?.configHash === configHash ? checkpoint.historyId : null, lastRun }); error = code
    },
    hasGmailMessage: (_account: string, id: string) => messages.has(id),
    findGmailMessageByFingerprint: () => null,
    saveGmailMessage: (message: GmailProcessedMessage) => { messages.set(message.gmailMessageId, message); return true }
  }
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input)); queries.push(url)
    if (url.pathname.endsWith('/profile')) {
      if (failProfile) { failProfile = false; return new Response('{}', { status: 503 }) }
      return Response.json({ emailAddress: 'hr@example.com', historyId })
    }
    if (url.pathname.endsWith('/history')) return Response.json({ historyId, history: [{ id: historyId,
      messagesAdded: (overflowingHistory ? ['m1','m2','m3','m4','m5'] : ['m6']).map(id => ({ message: { id, threadId: id } })) }] })
    if (url.pathname.endsWith('/messages')) {
      if (rejectCursor && url.searchParams.has('pageToken')) { rejectCursor = false; return new Response('{}', { status: 400 }) }
      const offset = Number(url.searchParams.get('pageToken') ?? 0)
      const size = Number(url.searchParams.get('maxResults'))
      const ids = ['m1','m2','m3','m4','m5'].slice(offset, offset + size)
      return Response.json({ messages: ids.map(id => ({ id, threadId: id })), ...(offset + ids.length < 5 ? { nextPageToken: String(offset + ids.length) } : {}) })
    }
    const id = url.pathname.split('/').at(-1)!
    if (id === failMessage) { failMessage = null; return new Response('{}', { status: 503 }) }
    return Response.json({ id, threadId: id, historyId, labelIds: ['INBOX'], internalDate: String(now.getTime() - 60_000),
      payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: `Java案件 ${id}` }], body: { data: Buffer.from('案件名：Java開発\n単価：80万円').toString('base64url') } } })
  }) as typeof fetch
  const run = (scope = config) => new GmailSyncCoordinator(new GmailReadClient(async () => 'test', fetchMock), store,
    async message => redactGmailMessageForLocalStorage(message, 'hr@example.com', [], now).message, () => now).synchronize('hr@example.com', scope)
  return { run, messages, queries, checkpoint: () => checkpoint, error: () => error,
    setHistory: (value: string) => { historyId = value }, fail: (id: string) => { failMessage = id },
    rejectCursor: () => { rejectCursor = true }, overflow: () => { overflowingHistory = true }, failProfile: () => { failProfile = true } }
}

describe('durable bounded Gmail batches', () => {
  it('imports more than one batch across recreated coordinators, then catches new history from the original anchor', async () => {
    const h = harness()
    expect(await h.run()).toMatchObject({ errorCode: null, lastRun: { imported: 2, moreAvailable: true } })
    h.setHistory('200')
    expect(await h.run()).toMatchObject({ lastRun: { imported: 2, moreAvailable: true } })
    expect(h.checkpoint()?.historyId).toBe('100')
    expect(await h.run()).toMatchObject({ lastRun: { imported: 1 } })
    expect(h.checkpoint()?.lastRun?.continuation).toBeUndefined()
    expect(h.messages.size).toBe(5)
    const lists = h.queries.filter(url => url.pathname.endsWith('/messages'))
    expect(lists.map(url => url.searchParams.get('pageToken'))).toEqual([null, '2', '4'])
    expect(new Set(lists.map(url => url.searchParams.get('q'))).size).toBe(1)
    expect(lists.every(url => Number(url.searchParams.get('maxResults')) <= 2)).toBe(true)
    expect(await h.run()).toMatchObject({ lastRun: { mode: 'incremental', imported: 1 } })
    expect(h.queries.find(url => url.pathname.endsWith('/history'))?.searchParams.get('startHistoryId')).toBe('100')
    expect(h.checkpoint()?.historyId).toBe('200')
  })

  it('retries the failed page without skipping its failed message or duplicating its successful message', async () => {
    const h = harness(); await h.run(); h.fail('m3')
    expect(await h.run()).toMatchObject({ errorCode: 'MESSAGE_PROCESSING_FAILED', lastRun: { imported: 1, failed: 1 } })
    expect(h.checkpoint()?.lastRun?.continuation?.pageToken).toBe('2')
    expect(await h.run()).toMatchObject({ errorCode: null, lastRun: { imported: 1, duplicates: 1, moreAvailable: true } })
    await h.run()
    expect([...h.messages.keys()].sort()).toEqual(['m1','m2','m3','m4','m5'])
  })

  it('recovers a rejected page cursor by replaying the scope with message deduplication', async () => {
    const h = harness(); await h.run(); h.rejectCursor()
    expect(await h.run()).toMatchObject({ errorCode: null, lastRun: { mode: 'bounded-rescan', imported: 0, duplicates: 2, moreAvailable: true } })
    await h.run(); await h.run()
    expect(h.messages.size).toBe(5)
  })

  it('uses bounded mailbox pages when incremental history exceeds a batch', async () => {
    const h = harness(); await h.run(); await h.run(); await h.run(); h.overflow(); h.setHistory('300')
    expect(await h.run()).toMatchObject({ errorCode: null, lastRun: { mode: 'bounded-rescan', moreAvailable: true } })
    expect(h.error()).toBeNull()
    expect(h.checkpoint()?.lastRun?.continuation?.historyId).toBe('300')
  })

  it('discards a continuation when the configured business scope changes', async () => {
    const h = harness(); await h.run()
    await h.run({ ...config, query: '案件' })
    expect(h.queries.filter(url => url.pathname.endsWith('/messages')).at(-1)?.searchParams.has('pageToken')).toBe(false)
  })

  it('retains the cursor after a provider failure without replaying old import counts as new work', async () => {
    const h = harness(); await h.run(); h.failProfile()
    expect(await h.run()).toMatchObject({ errorCode: 'GMAIL_HTTP_503', lastRun: { imported: 0, discovered: 0 } })
    expect(h.checkpoint()?.lastRun?.continuation?.pageToken).toBe('2')
    expect(await h.run()).toMatchObject({ errorCode: null, lastRun: { imported: 2 } })
  })
})
