import assert from 'node:assert/strict'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  GmailReadClient,
  GmailSyncCoordinator,
  GoogleWorkspaceOAuthClient,
  LoopbackAuthorizationCodeProvider,
  createGoogleWorkspaceOnlineAcceptanceReport,
  gmailReadonlyScope,
  gmailSyncConfigurationSchema,
  redactGmailMessageForLocalStorage,
  syncConfigurationHash,
  type GmailProcessedMessage,
  type GmailSyncCheckpointPortRecord,
  type GmailSyncRun,
  type GoogleWorkspaceCredential,
  type GoogleWorkspaceCredentialStore
} from '@mail'
import { collectLocalPersonNameCandidates } from '@local-ai'

class MemoryCredentialStore implements GoogleWorkspaceCredentialStore {
  value: GoogleWorkspaceCredential | null = null
  async load() { return this.value }
  async save(value: GoogleWorkspaceCredential) { this.value = value }
  async clear() { this.value = null }
}

class MemorySyncStore {
  checkpoint: GmailSyncCheckpointPortRecord | null = null
  messages = new Map<string, GmailProcessedMessage>()
  lastRun: GmailSyncRun | null = null
  getGmailSyncCheckpoint() { return this.checkpoint }
  saveGmailSyncSuccess(_account: string, configHash: string, historyId: string, lastRun: GmailSyncRun) {
    this.checkpoint = { configHash, historyId }
    this.lastRun = { ...lastRun }
  }
  saveGmailSyncFailure(_account: string, configHash: string, _code: string, _at: string, lastRun: GmailSyncRun | null = null) {
    this.checkpoint = { configHash, historyId: this.checkpoint?.historyId ?? null }
    this.lastRun = lastRun
  }
  hasGmailMessage(_account: string, id: string) { return this.messages.has(id) }
  findGmailMessageByFingerprint(_account: string, fingerprint: string) {
    return [...this.messages.values()].find((message) => message.businessFingerprint === fingerprint)?.gmailMessageId ?? null
  }
  saveGmailMessage(message: GmailProcessedMessage) {
    if (this.messages.has(message.gmailMessageId)) return false
    this.messages.set(message.gmailMessageId, message)
    return true
  }
}

async function requestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += value.length
    if (bytes > 64 * 1024) throw new Error('Mock provider request exceeded its local test limit.')
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const now = new Date('2026-07-20T00:00:00.000Z')
const accountEmail = 'hr@example.co.jp'
const clientId = '1234567890-desktopcontract.apps.googleusercontent.com'
const initialAccessToken = 'initial-access-token-contract-001'
const refreshedAccessToken = 'refreshed-access-token-contract-002'
const initialRefreshToken = 'initial-refresh-token-contract-001'
const rotatedRefreshToken = 'rotated-refresh-token-contract-002'
let currentAccessToken = initialAccessToken
let currentRefreshToken = initialRefreshToken
let profileHistoryId = '200'
let refreshRequests = 0
let revocationBody = ''

const gmailMessage = (id: string, historyId: string, subject: string, body: string, name: string) => ({
  id,
  threadId: `thread_${id}`,
  labelIds: ['Label_SES'],
  historyId,
  internalDate: String(now.getTime() - 60_000),
  payload: {
    mimeType: 'text/plain',
    headers: [
      { name: 'Subject', value: subject },
      { name: 'From', value: `${name} <${id}@partner.example.co.jp>` },
      { name: 'Message-ID', value: `<${id}@partner.example.co.jp>` }
    ],
    body: { data: Buffer.from(body).toString('base64url') }
  }
})
const fixtures = new Map<string, unknown>([
  ['msg_001', gmailMessage('msg_001', '190', 'Java案件のご相談', 'Java案件です。山田太郎 090-1234-5678', '山田太郎')],
  ['msg_002', gmailMessage('msg_002', '205', 'AWS要員のご提案', 'AWS要員です。佐藤花子 080-2345-6789', '佐藤花子')]
])

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'POST' && url.pathname === '/token') {
      const body = new URLSearchParams(await requestBody(request))
      assert.equal(body.get('client_id'), clientId)
      assert.equal(body.has('client_secret'), false)
      if (body.get('grant_type') === 'authorization_code') {
        assert.equal(body.get('code'), 'contract-authorization-code')
        assert.match(body.get('code_verifier') ?? '', /^[A-Za-z0-9_-]{43,128}$/u)
        assert.match(body.get('redirect_uri') ?? '', /^http:\/\/127\.0\.0\.1:\d+\/oauth2\/callback$/u)
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({
          access_token: initialAccessToken,
          refresh_token: initialRefreshToken,
          expires_in: 3600,
          scope: gmailReadonlyScope,
          token_type: 'Bearer'
        }))
        return
      }
      assert.equal(body.get('grant_type'), 'refresh_token')
      assert.equal(body.get('refresh_token'), currentRefreshToken)
      refreshRequests += 1
      currentAccessToken = refreshedAccessToken
      currentRefreshToken = rotatedRefreshToken
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        access_token: refreshedAccessToken,
        refresh_token: rotatedRefreshToken,
        expires_in: 3600,
        scope: gmailReadonlyScope,
        token_type: 'Bearer'
      }))
      return
    }
    if (request.method === 'POST' && url.pathname === '/revoke') {
      assert.equal(url.search, '')
      revocationBody = await requestBody(request)
      response.writeHead(200).end()
      return
    }
    assert.equal(request.method, 'GET')
    assert.equal(request.headers.authorization, `Bearer ${currentAccessToken}`)
    if (url.pathname === '/gmail/v1/users/me/profile') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ emailAddress: accountEmail, historyId: profileHistoryId }))
      return
    }
    if (url.pathname === '/gmail/v1/users/me/messages') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ messages: [{ id: 'msg_001', threadId: 'thread_msg_001' }] }))
      return
    }
    const messageId = url.pathname.match(/^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/u)?.[1]
    if (messageId && fixtures.has(messageId)) {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(fixtures.get(messageId)))
      return
    }
    if (url.pathname === '/gmail/v1/users/me/history') {
      assert.deepEqual(url.searchParams.getAll('historyTypes'), ['messageAdded', 'labelAdded'])
      assert.equal(url.searchParams.get('labelId'), 'Label_SES')
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        historyId: '210',
        history: [{
          id: '205',
          labelsAdded: [{ message: { id: 'msg_002', threadId: 'thread_msg_002' }, labelIds: ['Label_SES'] }]
        }]
      }))
      return
    }
    response.writeHead(404).end()
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'mock-provider-failure' }))
  }
})

await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => resolve())
})
const address = server.address() as AddressInfo
const localOrigin = `http://127.0.0.1:${address.port}`
const requestedGoogleUrls: string[] = []
const googleFetch: typeof fetch = async (input, init) => {
  const original = new URL(String(input))
  requestedGoogleUrls.push(original.toString())
  if (original.origin === 'https://oauth2.googleapis.com') {
    assert.ok(['/token', '/revoke'].includes(original.pathname))
  } else {
    assert.equal(original.origin, 'https://gmail.googleapis.com')
    assert.match(original.pathname, /^\/gmail\/v1\/users\/me\/(?:profile|messages|history)/u)
  }
  return fetch(`${localOrigin}${original.pathname}${original.search}`, init)
}

const credentialStore = new MemoryCredentialStore()
let authorizationScopes: string[] = []
const client = new GoogleWorkspaceOAuthClient(
  { clientId, workspaceDomain: 'example.co.jp' },
  {
    credentialStore,
    authorizationCodeProvider: new LoopbackAuthorizationCodeProvider({
      async openExternal(authorizationUrl) {
        const authorization = new URL(authorizationUrl)
        authorizationScopes = (authorization.searchParams.get('scope') ?? '').split(' ').filter(Boolean)
        assert.equal(authorization.origin, 'https://accounts.google.com')
        assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256')
        assert.equal(authorization.searchParams.get('access_type'), 'offline')
        const redirect = new URL(authorization.searchParams.get('redirect_uri') ?? '')
        redirect.searchParams.set('state', authorization.searchParams.get('state') ?? '')
        redirect.searchParams.set('code', 'contract-authorization-code')
        const callback = await fetch(redirect)
        assert.equal(callback.status, 200)
      },
      timeoutMs: 5_000
    }),
    fetch: googleFetch,
    now: () => now
  }
)

try {
  const connected = await client.connectReadonly()
  assert.equal(connected.status, 'readonly')
  assert.deepEqual(authorizationScopes, [gmailReadonlyScope])
  assert.deepEqual(credentialStore.value?.scopes, [gmailReadonlyScope])

  credentialStore.value = { ...credentialStore.value!, expiresAt: '2026-07-19T00:00:00.000Z' }
  const refreshed = await Promise.all([
    client.getAccessToken(), client.getAccessToken(), client.getAccessToken(), client.getAccessToken()
  ])
  assert.deepEqual(refreshed, Array(4).fill(refreshedAccessToken))
  assert.equal(refreshRequests, 1)
  assert.equal(credentialStore.value?.refreshToken, rotatedRefreshToken)

  const gmail = new GmailReadClient((forceRefresh) => client.getAccessToken(forceRefresh), googleFetch)
  const syncStore = new MemorySyncStore()
  const redactionStatuses: string[] = []
  const coordinator = new GmailSyncCoordinator(
    gmail,
    syncStore,
    async (message) => {
      const redacted = redactGmailMessageForLocalStorage(
        message,
        accountEmail,
        collectLocalPersonNameCandidates(`${message.subject}\n${message.from}\n${message.body}`),
        now
      )
      assert.equal(redacted.redaction.payload, null)
      redactionStatuses.push(redacted.redaction.session.status)
      return redacted.message
    },
    () => now
  )
  const config = gmailSyncConfigurationSchema.parse({
    version: 'gmail-sync-config-v1',
    labelIds: ['Label_SES'],
    query: '案件 OR 要員',
    lookbackDays: 30,
    maxMessagesPerRun: 50
  })
  const baseline = await coordinator.synchronize(accountEmail, config)
  assert.equal(baseline.errorCode, null)
  assert.equal(baseline.lastRun?.mode, 'baseline')
  assert.equal(syncStore.messages.size, 1)

  profileHistoryId = '210'
  const incremental = await coordinator.synchronize(accountEmail, config)
  assert.equal(incremental.errorCode, null)
  assert.equal(incremental.lastRun?.mode, 'incremental')
  assert.equal(syncStore.messages.size, 2)
  assert.equal(syncStore.checkpoint?.historyId, '210')
  const storedJson = JSON.stringify([...syncStore.messages.values()])
  for (const directIdentifier of ['山田太郎', '佐藤花子', '090-1234-5678', '080-2345-6789']) {
    assert.equal(storedJson.includes(directIdentifier), false)
  }
  assert.deepEqual(redactionStatuses, ['uncertain', 'uncertain'])

  const configuration = {
    version: 'google-workspace-admin-config-v1' as const,
    source: 'managed-environment' as const,
    editable: false as const,
    clientId,
    workspaceDomain: 'example.co.jp',
    labelIds: config.labelIds,
    query: config.query,
    lookbackDays: config.lookbackDays,
    maxMessagesPerRun: config.maxMessagesPerRun,
    revision: null,
    configuredBy: 'contract-test',
    updatedAt: now.toISOString()
  }
  const acceptance = createGoogleWorkspaceOnlineAcceptanceReport({
    configuration,
    live: await client.verifyReadonlyProfile(),
    credentialProtection: process.platform === 'win32' ? 'windows-dpapi' : 'macos-keychain',
    sync: {
      configHash: syncConfigurationHash(config),
      status: 'idle',
      lastSyncedAt: now.toISOString(),
      lastRun: incremental.lastRun
    },
    redaction: { storedMessages: 2, passed: 0, uncertain: 2, blocked: 0 }
  })
  assert.equal(acceptance.overall, 'passed')
  assert.equal(acceptance.checks.find((check) => check.id === 'local-redaction')?.status, 'warning')
  assert.equal(JSON.stringify(acceptance).includes(accountEmail), false)

  await client.disconnect()
  assert.equal(credentialStore.value, null)
  assert.equal(revocationBody, `token=${rotatedRefreshToken}`)
  assert.equal(requestedGoogleUrls.some((url) => url.includes(initialRefreshToken) || url.includes(rotatedRefreshToken)), false)
  assert.equal(requestedGoogleUrls.some((url) => /drafts|send|modify|delete/iu.test(url)), false)

  process.stdout.write(`${JSON.stringify({
    version: 'google-workspace-local-contract-v1',
    networkScope: 'loopback-only',
    systemBrowserPkce: true,
    exactReadonlyScope: true,
    clientSecretSent: false,
    concurrentRefreshCoalesced: refreshRequests === 1,
    refreshTokenRotated: true,
    revocationTokenInUrl: false,
    baselineImported: baseline.lastRun?.imported ?? 0,
    incrementalLabelAddedImported: incremental.lastRun?.imported ?? 0,
    storedMessages: syncStore.messages.size,
    storedDirectIdentifiers: 0,
    cloudModelUsed: false,
    sendMethodReachable: false,
    acceptanceStatus: acceptance.overall,
    manualNameReviewRequired: true
  })}\n`)
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
