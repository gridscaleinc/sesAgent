// @vitest-environment node
import { createServer } from 'node:net'
import { expect, it, vi } from 'vitest'
import { GoogleWorkspaceOAuthClient, LoopbackAuthorizationCodeProvider, buildGoogleAuthorizationUrl, gmailReadonlyScope,
  privateGoogleLoopbackRedirectSchema, type GoogleWorkspaceCredential } from './index'

const mailbox = 'private-hr@example.com'
const registered = 'http://localhost:3000/api/auth/callback/google'
const clientId = '1234567890-private.apps.googleusercontent.com'

it('uses the registered local callback, rejects a wrong state and path, then closes the listener', async () => {
  const probe = createServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = (probe.address() as { port: number }).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const redirectUri = `http://localhost:${port}/api/auth/callback/google`
  const statuses: number[] = []
  const provider = new LoopbackAuthorizationCodeProvider({ redirectUri, timeoutMs: 5000,
    async openExternal(auth) {
      const url = new URL(auth)
      expect(url.searchParams.get('login_hint')).toBe(mailbox)
      expect(url.searchParams.get('redirect_uri')).toBe(redirectUri)
      statuses.push((await fetch(`http://localhost:${port}/other`)).status)
      statuses.push((await fetch(`${redirectUri}?state=wrong&code=test`)).status)
      statuses.push((await fetch(`${redirectUri}?state=expected&code=test`)).status)
    }
  })
  await expect(provider.requestAuthorization({ clientId, loginHint: mailbox, workspaceDomain: 'example.com',
    scopes: [gmailReadonlyScope], state: 'expected', codeChallenge: 'challenge' })).resolves.toEqual({ code: 'test', redirectUri })
  await vi.waitFor(() => expect(statuses).toEqual([404, 400, 200]))
  await expect(fetch(redirectUri)).rejects.toThrow()
})

it.each(['https://attacker.example/callback', 'http://localhost:3000/cb?next=evil', 'http://0.0.0.0:3000/cb', 'http://user@localhost:3000/cb'])('rejects unsafe private callback %s', callback => {
  expect(privateGoogleLoopbackRedirectSchema.safeParse(callback).success).toBe(false)
})

function harness(email = mailbox, callback = registered, profileError?: string) {
  let credential: GoogleWorkspaceCredential | null = null
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith('/token')) {
      const body = new URLSearchParams(String(init?.body))
      expect(body.get('client_secret')).toBe('private-test-only-secret')
      if (body.get('grant_type') === 'authorization_code') {
        expect(body.get('redirect_uri')).toBe(registered)
        expect(body.get('code_verifier')).toBeTruthy()
      }
      return Response.json({ access_token: 'private-test-access-token-123', refresh_token: 'private-test-refresh-token',
        expires_in: 3600, scope: gmailReadonlyScope, token_type: 'Bearer' })
    }
    return profileError ? Response.json({ error: { message: 'sensitive provider detail', details: [{ reason: profileError }] } }, { status: 403 })
      : Response.json({ emailAddress: email, historyId: '100' })
  })
  const client = new GoogleWorkspaceOAuthClient({ clientId, clientSecret: 'private-test-only-secret', workspaceDomain: 'example.com',
    privateLocalWeb: { redirectUri: registered, accountEmail: mailbox } }, {
    credentialStore: { load: async () => credential, save: async value => { credential = value }, clear: async () => { credential = null } },
    authorizationCodeProvider: { async requestAuthorization(request) {
      expect(new URL(buildGoogleAuthorizationUrl(request, registered)).searchParams.get('login_hint')).toBe(mailbox)
      return { code: 'private-code', redirectUri: callback }
    } }, fetch: fetchMock as typeof fetch
  })
  return { client, fetchMock, credential: () => credential }
}

it('binds only the configured mailbox and supports later refresh', async () => {
  const h = harness()
  await expect(h.client.connectReadonly()).resolves.toMatchObject({ accountEmail: mailbox, status: 'readonly' })
  await expect(h.client.getAccessToken(true)).resolves.toBe('private-test-access-token-123')
})
it('does not save credentials from a different mailbox', async () => {
  const h = harness('another-hr@example.com')
  await expect(h.client.connectReadonly()).rejects.toThrow('does not match')
  expect(h.credential()).toBeNull()
})
it('does not exchange a code from a callback other than the registered address', async () => {
  const h = harness(mailbox, 'http://127.0.0.1:3000/api/auth/callback/google')
  await expect(h.client.connectReadonly()).rejects.toThrow('configured private loopback')
  expect(h.fetchMock).not.toHaveBeenCalled()
})
it.each([['SERVICE_DISABLED', 'GMAIL_API_DISABLED'], ['ORG_RESTRICTION_VIOLATION', 'GMAIL_ORGANIZATION_RESTRICTED']])('distinguishes the Gmail rejection %s without exposing provider details', async (reason, expected) => {
  const h = harness(mailbox, registered, reason)
  await expect(h.client.connectReadonly()).rejects.toThrow(expected)
  expect(h.credential()).toBeNull()
})
