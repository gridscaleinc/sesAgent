import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { z } from 'zod'
import { applyLocalPiiMappings, redactTextForCloud, type LocalRedactionResult } from '@privacy'
import {
  googleWorkspaceOnlineAcceptanceReportSchema,
  googleWorkspaceDomainSchema,
  googleWorkspaceOAuthClientIdSchema,
  type GoogleWorkspaceOnlineAcceptanceReport,
  type GoogleWorkspaceAdminConfiguration,
  type GoogleWorkspaceReadinessReport,
  type GoogleWorkspaceState
} from '@shared'
import {
  classifyEmailText,
  emailHasPromptInjectionPattern as hasPromptInjectionPattern,
  emailHtmlToPlainText as htmlToPlainText,
  minimizeEmailBodyForLocalProcessing,
  normalizeEmailHeaderValue as normalizeHeaderValue
} from './email-content'

export * from './email-content'
export * from './eml'

export type GmailHttpMethod = 'GET'

const allowedGmailMethods: ReadonlyArray<{ method: GmailHttpMethod; path: RegExp }> = [
  { method: 'GET', path: /^\/gmail\/v1\/users\/me\/profile$/ },
  { method: 'GET', path: /^\/gmail\/v1\/users\/me\/messages(?:\?.*)?$/ },
  { method: 'GET', path: /^\/gmail\/v1\/users\/me\/messages\/[^/?]+(?:\?.*)?$/ },
  { method: 'GET', path: /^\/gmail\/v1\/users\/me\/history(?:\?.*)?$/ }
]

export function isGmailMethodAllowed(method: string, path: string): method is GmailHttpMethod {
  return allowedGmailMethods.some((rule) => rule.method === method && rule.path.test(path))
}

export function assertGmailMethodAllowed(method: string, path: string): void {
  if (!isGmailMethodAllowed(method, path)) {
    throw new Error(`Blocked Gmail API method: ${method} ${path}`)
  }
}

export const gmailReadonlyScope = 'https://www.googleapis.com/auth/gmail.readonly' as const
export const gmailComposeScope = 'https://www.googleapis.com/auth/gmail.compose' as const
const forbiddenReadonlyScopes = new Set([
  gmailComposeScope,
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://mail.google.com/'
])

export const googleWorkspaceCredentialSchema = z.object({
  version: z.literal('google-workspace-credential-v1'),
  accessToken: z.string().min(20).max(16_384),
  refreshToken: z.string().min(10).max(16_384),
  expiresAt: z.string().datetime(),
  scopes: z.tuple([z.literal(gmailReadonlyScope)]),
  accountEmail: z.string().email().max(254),
  workspaceDomain: googleWorkspaceDomainSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict()

export type GoogleWorkspaceCredential = z.infer<typeof googleWorkspaceCredentialSchema>

export interface GoogleWorkspaceCredentialStore {
  load(): Promise<GoogleWorkspaceCredential | null>
  save(credential: GoogleWorkspaceCredential): Promise<void>
  clear(): Promise<void>
}

export interface AuthorizationCodeRequest {
  clientId: string
  /** Optional hosted-domain hint/restriction for private deployments. */
  workspaceDomain: string | null
  scopes: [typeof gmailReadonlyScope]
  state: string
  codeChallenge: string
}

export interface AuthorizationCodeResult {
  code: string
  redirectUri: string
}

export interface AuthorizationCodeProvider {
  requestAuthorization(request: AuthorizationCodeRequest): Promise<AuthorizationCodeResult>
}

export interface LoopbackAuthorizationCodeProviderOptions {
  openExternal(url: string): Promise<void>
  timeoutMs?: number
}

export function createPkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

export function buildGoogleAuthorizationUrl(
  request: AuthorizationCodeRequest,
  redirectUri: string
): string {
  assertReadonlyScopes(request.scopes)
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', request.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', request.scopes.join(' '))
  url.searchParams.set('state', request.state)
  url.searchParams.set('code_challenge', request.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  if (request.workspaceDomain) url.searchParams.set('hd', request.workspaceDomain)
  return url.toString()
}

export class LoopbackAuthorizationCodeProvider implements AuthorizationCodeProvider {
  private readonly timeoutMs: number

  constructor(private readonly options: LoopbackAuthorizationCodeProviderOptions) {
    this.timeoutMs = options.timeoutMs ?? 180_000
  }

  requestAuthorization(request: AuthorizationCodeRequest): Promise<AuthorizationCodeResult> {
    return new Promise((resolve, reject) => {
      let settled = false
      const server = createServer((incoming, response) => {
        const requestUrl = new URL(incoming.url ?? '/', 'http://127.0.0.1')
        if (incoming.method !== 'GET' || requestUrl.pathname !== '/oauth2/callback') {
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          response.end('Not found')
          return
        }
        const finish = (operation: () => void): void => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          server.close()
          operation()
        }
        const returnedState = requestUrl.searchParams.get('state') ?? ''
        const expectedState = Buffer.from(request.state, 'utf8')
        const actualState = Buffer.from(returnedState, 'utf8')
        const stateMatches = expectedState.length === actualState.length && timingSafeEqual(expectedState, actualState)
        if (!stateMatches) {
          response.writeHead(400, {
            'cache-control': 'no-store',
            'content-type': 'text/plain; charset=utf-8',
            'referrer-policy': 'no-referrer',
            'x-content-type-options': 'nosniff'
          })
          response.end('OAuth state verification failed. Return to SES Agent Desktop.')
          return
        }
        const providerError = requestUrl.searchParams.get('error')
        const code = requestUrl.searchParams.get('code')
        const validCode = code && code.length <= 4_096 && !/[\u0000-\u001f\u007f]/u.test(code) ? code : null
        if (providerError || !validCode) {
          response.writeHead(400, {
            'cache-control': 'no-store',
            'content-type': 'text/plain; charset=utf-8',
            'referrer-policy': 'no-referrer',
            'x-content-type-options': 'nosniff'
          })
          response.end('Google Workspace authorization was not completed. Return to SES Agent Desktop.')
          const safeProviderError = providerError && /^[a-z_]{1,64}$/u.test(providerError)
            ? providerError
            : providerError ? 'provider_error' : 'missing_code'
          finish(() => reject(new Error(`Google OAuth was not completed (${safeProviderError}).`)))
          return
        }
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff'
        })
        response.end('<!doctype html><meta charset="utf-8"><title>SES Agent Desktop</title><style>body{font-family:system-ui;padding:48px;color:#172036}h1{font-size:22px}</style><h1>Google Workspace の接続を確認しました</h1><p>このタブを閉じて SES Agent Desktop に戻ってください。</p>')
        const address = server.address()
        const port = typeof address === 'object' && address ? address.port : 0
        finish(() => resolve({ code: validCode, redirectUri: `http://127.0.0.1:${port}/oauth2/callback` }))
      })
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        server.close()
        reject(new Error('Google Workspace authorization timed out.'))
      }, this.timeoutMs)
      server.once('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        reject(new Error('The local OAuth callback could not start.', { cause: error }))
      })
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        const port = typeof address === 'object' && address ? address.port : 0
        const redirectUri = `http://127.0.0.1:${port}/oauth2/callback`
        void this.options.openExternal(buildGoogleAuthorizationUrl(request, redirectUri)).catch((error) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          server.close()
          reject(new Error('The system browser could not open Google authorization.', { cause: error }))
        })
      })
    })
  }
}

export function probeGoogleOAuthLoopbackBinding(timeoutMs = 3_000): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer((_request, response) => {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Not found')
    })
    let settled = false
    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (server.listening) server.close(() => resolve(result))
      else resolve(result)
    }
    const timeout = setTimeout(() => finish(false), Math.max(250, Math.min(10_000, timeoutMs)))
    server.once('error', () => finish(false))
    server.listen(0, '127.0.0.1', () => finish(true))
  })
}

async function probeHttpsEndpoint(fetchImpl: typeof fetch, url: string, timeoutMs = 5_000): Promise<boolean> {
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(Math.max(1_000, Math.min(10_000, timeoutMs)))
    })
    return response.ok
  } catch {
    return false
  }
}

export async function diagnoseGoogleWorkspaceReadiness(options: {
  configuration: GoogleWorkspaceAdminConfiguration | null
  credentialProtection: 'macos-keychain' | 'windows-dpapi' | 'unsupported'
  fetch: typeof fetch
  now?: () => Date
}): Promise<GoogleWorkspaceReadinessReport> {
  const configuration = options.configuration
  const clientIdValid = Boolean(configuration && /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/u.test(configuration.clientId))
  const boundedScope = Boolean(
    configuration &&
    configuration.labelIds.length >= 1 && configuration.labelIds.length <= 10 &&
    configuration.query.length >= 2 && configuration.query.length <= 200 &&
    configuration.lookbackDays >= 1 && configuration.lookbackDays <= 365 &&
    configuration.maxMessagesPerRun >= 1 && configuration.maxMessagesPerRun <= 500
  )
  const [loopbackAvailable, oauthReachable, gmailApiReachable] = await Promise.all([
    probeGoogleOAuthLoopbackBinding(),
    probeHttpsEndpoint(options.fetch, 'https://accounts.google.com/.well-known/openid-configuration'),
    probeHttpsEndpoint(options.fetch, 'https://gmail.googleapis.com/$discovery/rest?version=v1')
  ])
  const credentialProtectionReady = options.credentialProtection !== 'unsupported'
  const checks: GoogleWorkspaceReadinessReport['checks'] = [
    {
      id: 'configuration',
      status: configuration ? 'passed' : 'failed',
      label: '管理者設定',
      detail: configuration ? '製品の Client ID と有界同期範囲を読み込みました。' : 'このビルドには Google OAuth Client ID が組み込まれていません。'
    },
    {
      id: 'desktop-client-format',
      status: clientIdValid ? 'passed' : 'failed',
      label: 'Desktop OAuth Client ID',
      detail: clientIdValid ? 'Installed/Desktop Client ID の形式です。' : 'Desktop App Client ID の形式を確認してください。'
    },
    {
      id: 'bounded-sync-scope',
      status: boundedScope ? 'passed' : 'failed',
      label: '同期データ範囲',
      detail: boundedScope ? 'Label・業務キーワード・期間・件数に上限があります。' : 'Label・キーワード・取得期間・最大件数を設定してください。'
    },
    {
      id: 'loopback-callback',
      status: loopbackAvailable ? 'passed' : 'failed',
      label: 'ローカル OAuth コールバック',
      detail: loopbackAvailable ? '127.0.0.1 のランダムポートを安全にバインドできます。' : '127.0.0.1 のローカルポートを開けません。端末ポリシーを確認してください。'
    },
    {
      id: 'google-oauth-reachability',
      status: oauthReachable ? 'passed' : 'failed',
      label: 'Google OAuth 到達性',
      detail: oauthReachable ? 'Google OAuth 公開メタデータへ HTTPS 接続できました。' : 'Google OAuth へ接続できません。Proxy・Firewall・DNS を確認してください。'
    },
    {
      id: 'gmail-api-reachability',
      status: gmailApiReachable ? 'passed' : 'failed',
      label: 'Gmail API 到達性',
      detail: gmailApiReachable ? 'Gmail API Discovery へ HTTPS 接続できました。メールボックスは読んでいません。' : 'Gmail API へ接続できません。Proxy・Firewall・DNS を確認してください。'
    },
    {
      id: 'credential-protection',
      status: credentialProtectionReady ? 'passed' : 'failed',
      label: 'OAuth Token 保護',
      detail: credentialProtectionReady ? `${options.credentialProtection} による端末保護を使用できます。` : 'この OS では OAuth Token の保護方式を確認できません。'
    },
    {
      id: 'admin-console-confirmation',
      status: 'warning',
      label: 'Google Cloud 管理者確認',
      detail: 'Gmail API、Desktop OAuth Client、外部向け同意画面と gmail.readonly の審査状態を製品管理者が確認してください。'
    }
  ]
  return {
    version: 'google-workspace-readiness-v1',
    checkedAt: (options.now?.() ?? new Date()).toISOString(),
    overall: checks.some((check) => check.status === 'failed') ? 'action-required' : 'ready',
    networkAccess: true,
    mailboxAccessed: false,
    credentialCreated: false,
    checks
  }
}

export interface GoogleWorkspaceOAuthConfig {
  clientId: string
  /** Desktop OAuth clients are public clients; Google may still require this value at the token endpoint. */
  clientSecret?: string
  /** Null in the public product; set only to restrict a private distribution. */
  workspaceDomain: string | null
}

export interface GoogleWorkspaceOAuthDependencies {
  credentialStore: GoogleWorkspaceCredentialStore
  authorizationCodeProvider: AuthorizationCodeProvider
  fetch: typeof fetch
  now?: () => Date
}

export interface GoogleWorkspaceLiveVerification {
  checkedAt: string
  grantedScopes: string[]
  accountIdentityVerified: true
  mailboxMetadataAccessed: true
  messageContentAccessed: false
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(20).max(16_384),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(10).max(16_384).optional(),
  scope: z.string().min(1).max(4_096).optional(),
  token_type: z.literal('Bearer')
})

const oauthErrorResponseSchema = z.object({
  error: z.string().regex(/^[a-z_]{1,64}$/u),
  error_description: z.string().max(2_000).optional()
}).passthrough()

async function oauthErrorCode(response: Response): Promise<string> {
  try {
    const parsed = oauthErrorResponseSchema.safeParse(await response.json())
    if (!parsed.success) return 'provider_error'
    const description = parsed.data.error_description ?? ''
    const parameter = [
      ['client_secret', /client[_ ]secret/iu],
      ['code_verifier', /code[_ ]verifier|code[_ ]challenge/iu],
      ['redirect_uri', /redirect[_ ]uri/iu],
      ['client_id', /client[_ ]id/iu],
      ['missing_parameter', /missing|required parameter/iu]
    ].find(([, pattern]) => (pattern as RegExp).test(description))?.[0]
    return parameter ? `${parsed.data.error}/${parameter}` : parsed.data.error
  } catch {
    return 'provider_error'
  }
}

const gmailProfileSchema = z.object({
  emailAddress: z.string().email().max(254),
  messagesTotal: z.number().int().nonnegative().optional(),
  threadsTotal: z.number().int().nonnegative().optional(),
  historyId: z.string().regex(/^\d{1,40}$/u).optional()
})

function assertReadonlyScopes(scopes: string[]): void {
  if (scopes.length !== 1 || scopes[0] !== gmailReadonlyScope) {
    const forbidden = scopes.filter((scope) => forbiddenReadonlyScopes.has(scope))
    if (forbidden.length > 0) throw new Error(`Unexpected Gmail write scope was granted: ${forbidden.join(', ')}`)
    throw new Error('Google did not grant exactly the single Gmail read-only scope.')
  }
}

const googleWorkspaceOAuthConfigSchema = z.object({
  clientId: googleWorkspaceOAuthClientIdSchema,
  clientSecret: z.string().min(8).max(512).optional(),
  workspaceDomain: googleWorkspaceDomainSchema.nullable()
}).strict()

function accountDomain(emailAddress: string): string {
  const separator = emailAddress.lastIndexOf('@')
  return googleWorkspaceDomainSchema.parse(emailAddress.slice(separator + 1))
}

function assertLoopbackRedirectUri(value: string): string {
  const url = new URL(value)
  if (
    url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
    !/^\d{1,5}$/u.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65_535 ||
    url.pathname !== '/oauth2/callback' || url.username || url.password || url.search || url.hash
  ) throw new Error('Google OAuth callback did not return the expected loopback redirect URI.')
  return url.toString()
}

export class GoogleWorkspaceOAuthClient {
  private connecting: Promise<GoogleWorkspaceState> | null = null
  private refreshing: Promise<string> | null = null
  private readonly config: GoogleWorkspaceOAuthConfig

  constructor(
    config: GoogleWorkspaceOAuthConfig,
    private readonly dependencies: GoogleWorkspaceOAuthDependencies
  ) {
    this.config = googleWorkspaceOAuthConfigSchema.parse(config)
  }

  async getState(): Promise<GoogleWorkspaceState> {
    const credential = await this.dependencies.credentialStore.load()
    if (!credential) return this.disconnectedState()
    try {
      assertReadonlyScopes(credential.scopes)
    } catch {
      await this.dependencies.credentialStore.clear()
      return this.disconnectedState()
    }
    if (this.config.workspaceDomain && credential.workspaceDomain !== this.config.workspaceDomain) {
      await this.dependencies.credentialStore.clear()
      return this.disconnectedState()
    }
    return {
      provider: 'google-workspace',
      status: 'readonly',
      configuration: 'connected',
      workspaceDomain: credential.workspaceDomain,
      accountEmail: credential.accountEmail,
      grantedScopes: credential.scopes,
      readAccess: true,
      draftAccess: 'not-requested',
      sendMethod: 'not-implemented'
    }
  }

  connectReadonly(): Promise<GoogleWorkspaceState> {
    if (this.connecting) return this.connecting
    this.connecting = this.performReadonlyConnection().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  async verifyReadonlyProfile(): Promise<GoogleWorkspaceLiveVerification> {
    const credential = await this.dependencies.credentialStore.load()
    if (!credential) throw new Error('Google Workspace is not connected.')
    assertReadonlyScopes(credential.scopes)
    const profile = await new GmailReadClient(
      (forceRefresh) => this.getAccessToken(forceRefresh),
      this.dependencies.fetch
    ).getProfile()
    if (profile.emailAddress.toLocaleLowerCase('en-US') !== credential.accountEmail.toLocaleLowerCase('en-US')) {
      throw new Error('Gmail account changed after authorization.')
    }
    const profileDomain = accountDomain(profile.emailAddress)
    if (profileDomain !== credential.workspaceDomain) {
      throw new Error('Google account domain changed after authorization.')
    }
    if (this.config.workspaceDomain && profileDomain !== this.config.workspaceDomain) {
      throw new Error('Google account no longer belongs to the configured Workspace domain.')
    }
    return {
      checkedAt: (this.dependencies.now?.() ?? new Date()).toISOString(),
      grantedScopes: [...credential.scopes],
      accountIdentityVerified: true,
      mailboxMetadataAccessed: true,
      messageContentAccessed: false
    }
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    const credential = await this.dependencies.credentialStore.load()
    if (!credential) throw new Error('Google Workspace is not connected.')
    assertReadonlyScopes(credential.scopes)
    const now = this.dependencies.now?.() ?? new Date()
    if (!forceRefresh && new Date(credential.expiresAt).getTime() > now.getTime() + 60_000) return credential.accessToken
    if (this.refreshing) return this.refreshing
    this.refreshing = this.refreshAccessToken(credential, now).finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async refreshAccessToken(credential: GoogleWorkspaceCredential, now: Date): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      refresh_token: credential.refreshToken,
      grant_type: 'refresh_token'
    })
    if (this.config.clientSecret) body.set('client_secret', this.config.clientSecret)
    const response = await this.dependencies.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    })
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        await this.dependencies.credentialStore.clear()
        throw new Error('Google authorization expired or was revoked. Reconnect the Google account.')
      }
      throw new Error(`Google access token refresh failed (${response.status}).`)
    }
    const token = tokenResponseSchema.parse(await response.json())
    if (token.scope) assertReadonlyScopes(token.scope.split(/\s+/u).filter(Boolean))
    const updated: GoogleWorkspaceCredential = googleWorkspaceCredentialSchema.parse({
      ...credential,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? credential.refreshToken,
      expiresAt: new Date(now.getTime() + token.expires_in * 1000).toISOString(),
      updatedAt: now.toISOString()
    })
    await this.dependencies.credentialStore.save(updated)
    return updated.accessToken
  }

  async disconnect(): Promise<GoogleWorkspaceState> {
    const credential = await this.dependencies.credentialStore.load()
    if (!credential) return this.disconnectedState()
    try {
      const response = await this.dependencies.fetch(
        'https://oauth2.googleapis.com/revoke',
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: credential.refreshToken })
        }
      )
      if (!response.ok) throw new Error(`Google token revocation failed (${response.status}).`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Google token revocation failed (')) throw error
      throw new Error('Google token revocation failed. The local credential was retained so revocation can be retried.', {
        cause: error
      })
    }
    await this.dependencies.credentialStore.clear()
    return this.disconnectedState()
  }

  private async performReadonlyConnection(): Promise<GoogleWorkspaceState> {
    const verifier = randomBytes(64).toString('base64url')
    const state = randomBytes(32).toString('base64url')
    const authorization = await this.dependencies.authorizationCodeProvider.requestAuthorization({
      clientId: this.config.clientId,
      workspaceDomain: this.config.workspaceDomain,
      scopes: [gmailReadonlyScope],
      state,
      codeChallenge: createPkceChallenge(verifier)
    })
    const redirectUri = assertLoopbackRedirectUri(authorization.redirectUri)
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      code: authorization.code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    })
    if (this.config.clientSecret) body.set('client_secret', this.config.clientSecret)
    const response = await this.dependencies.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    })
    if (!response.ok) {
      throw new Error(`Google authorization code exchange failed (${response.status}: ${await oauthErrorCode(response)}).`)
    }
    const token = tokenResponseSchema.parse(await response.json())
    if (!token.refresh_token) throw new Error('Google did not return an offline refresh token.')
    const scopes = (token.scope ?? gmailReadonlyScope).split(/\s+/u).filter(Boolean)
    assertReadonlyScopes(scopes)

    assertGmailMethodAllowed('GET', '/gmail/v1/users/me/profile')
    const profileResponse = await this.dependencies.fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { authorization: `Bearer ${token.access_token}` }
    })
    if (profileResponse.status === 403) {
      throw new Error('Gmail の読取権限を取得できませんでした。個人アカウントは Gmail が有効な Google アカウントを使用してください。会社アカウントは Workspace 管理者に本製品の許可を依頼してください。')
    }
    if (!profileResponse.ok) throw new Error(`Gmail profile verification failed (${profileResponse.status}).`)
    const profile = gmailProfileSchema.parse(await profileResponse.json())
    const profileDomain = accountDomain(profile.emailAddress)
    if (this.config.workspaceDomain && profileDomain !== this.config.workspaceDomain) {
      throw new Error(`Google account must belong to ${this.config.workspaceDomain}.`)
    }
    const now = this.dependencies.now?.() ?? new Date()
    const credential: GoogleWorkspaceCredential = googleWorkspaceCredentialSchema.parse({
      version: 'google-workspace-credential-v1',
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(now.getTime() + token.expires_in * 1000).toISOString(),
      scopes,
      accountEmail: profile.emailAddress,
      workspaceDomain: profileDomain,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    await this.dependencies.credentialStore.save(credential)
    return this.getState()
  }

  private disconnectedState(): GoogleWorkspaceState {
    return {
      provider: 'google-workspace',
      status: 'not-connected',
      configuration: 'ready',
      workspaceDomain: this.config.workspaceDomain,
      accountEmail: null,
      grantedScopes: [],
      readAccess: false,
      draftAccess: 'not-requested',
      sendMethod: 'not-implemented'
    }
  }
}

export const gmailSyncConfigurationSchema = z.object({
  version: z.literal('gmail-sync-config-v1'),
  labelIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).min(1).max(10),
  query: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .refine((value) => !/[\r\n\u0000:()]/u.test(value), 'Use business keywords, not Gmail operators.')
    .refine(
      (value) =>
        value
          .split(/\s+OR\s+/iu)
          .every((term) => term.replace(/^['"]|['"]$/gu, '').trim().length >= 2) &&
        !/(?:^|\s)(?:AND|NOT)(?:\s|$)/iu.test(value),
      'Use one or more business keywords separated by OR.'
    ),
  lookbackDays: z.number().int().min(1).max(365),
  maxMessagesPerRun: z.number().int().min(1).max(500).default(200)
})

export type GmailSyncConfiguration = z.infer<typeof gmailSyncConfigurationSchema>

export interface GmailMessageReference {
  id: string
  threadId: string
}

export interface GmailDiscoveryResult {
  messageReferences: GmailMessageReference[]
  historyId: string | null
  truncated: boolean
}

export interface GmailMessageEnvelope {
  id: string
  threadId: string
  historyId: string
  internalDate: string
  labelIds: string[]
  rfcMessageId: string | null
  subject: string
  from: string
  fromDomain: string | null
  body: string
  attachmentCount: number
  warnings: Array<'HTML_CONVERTED' | 'BODY_TRUNCATED' | 'ATTACHMENTS_NOT_DOWNLOADED' | 'PROMPT_INJECTION_PATTERN'>
}

export class GmailApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string
  ) {
    super(`Gmail API request failed (${status}).`)
    this.name = 'GmailApiError'
  }
}

const messageReferenceSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  threadId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
})

const messagesListResponseSchema = z.object({
  messages: z.array(messageReferenceSchema).optional(),
  nextPageToken: z.string().min(1).optional(),
  resultSizeEstimate: z.number().int().nonnegative().optional()
})

const historyResponseSchema = z.object({
  history: z
    .array(
      z.object({
        id: z.string().regex(/^\d{1,40}$/u),
        messagesAdded: z.array(z.object({ message: messageReferenceSchema })).max(1_000).optional(),
        labelsAdded: z.array(z.object({
          message: messageReferenceSchema,
          labelIds: z.array(z.string().max(128)).max(100).optional()
        })).max(1_000).optional()
      })
    ).max(1_000)
    .optional(),
  nextPageToken: z.string().min(1).optional(),
  historyId: z.string().regex(/^\d{1,40}$/u)
})

interface GmailMessagePart {
  mimeType?: string
  filename?: string
  headers?: Array<{ name: string; value: string }>
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: unknown[]
}

const messagePartSchema: z.ZodType<GmailMessagePart> = z.object({
  mimeType: z.string().max(200).optional(),
  filename: z.string().max(500).optional(),
  headers: z.array(z.object({ name: z.string().max(200), value: z.string().max(10_000) })).max(500).optional(),
  body: z.object({
    size: z.number().int().nonnegative().optional(),
    data: z.string().max(3_000_000).regex(/^[A-Za-z0-9_-]*={0,2}$/u).optional(),
    attachmentId: z.string().max(500).optional()
  }).optional(),
  parts: z.array(z.unknown()).max(500).optional()
})

const gmailFullMessageSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  threadId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  labelIds: z.array(z.string().max(128)).max(100).default([]),
  historyId: z.string().regex(/^\d{1,40}$/u),
  internalDate: z.string().regex(/^\d{1,20}$/),
  sizeEstimate: z.number().int().nonnegative().max(50 * 1024 * 1024).optional(),
  payload: messagePartSchema
})

function decodeBase64UrlText(data: string): { text: string; bytes: number } {
  const bytes = Buffer.from(data, 'base64url')
  if (bytes.length > 2_000_000) throw new Error('Gmail message body exceeds the 2 MB local processing limit.')
  return { text: bytes.toString('utf8'), bytes: bytes.length }
}

function messageHeader(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string
): string | null {
  return headers?.find((header) => header.name.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))?.value ?? null
}

function gmailInternalDateIso(value: string): string {
  const milliseconds = Number(value)
  if (!Number.isSafeInteger(milliseconds)) throw new Error('Gmail message internalDate is invalid.')
  const date = new Date(milliseconds)
  if (!Number.isFinite(date.getTime())) throw new Error('Gmail message internalDate is outside the supported range.')
  return date.toISOString()
}

function collectMessageContent(part: z.infer<typeof messagePartSchema>): {
  plain: string[]
  html: string[]
  attachments: number
} {
  const collected = { plain: [] as string[], html: [] as string[], attachments: 0 }
  let visitedParts = 0
  let decodedTextBytes = 0
  const visit = (current: z.infer<typeof messagePartSchema>, depth: number): void => {
    visitedParts += 1
    if (depth > 20 || visitedParts > 1_000) throw new Error('Gmail MIME structure exceeds the local complexity limit.')
    if (current.body?.attachmentId || current.filename) collected.attachments += 1
    if (current.body?.data && (current.mimeType === 'text/plain' || current.mimeType === 'text/html')) {
      const decoded = decodeBase64UrlText(current.body.data)
      decodedTextBytes += decoded.bytes
      if (decodedTextBytes > 2_000_000) throw new Error('Combined Gmail message body exceeds the 2 MB local processing limit.')
      if (current.mimeType === 'text/plain') collected.plain.push(decoded.text)
      else collected.html.push(decoded.text)
    }
    for (const child of current.parts ?? []) visit(messagePartSchema.parse(child), depth + 1)
  }
  visit(part, 0)
  return collected
}

function domainFromMailbox(value: string): string | null {
  const address = value.match(/@([A-Za-z0-9.-]+)(?:>|\s|$)/u)?.[1]
  return address?.toLocaleLowerCase('en-US') ?? null
}

function displayNameFromMailbox(value: string): string | null {
  const bracket = value.lastIndexOf('<')
  if (bracket <= 0 || !value.slice(bracket).includes('@')) return null
  const candidate = value.slice(0, bracket).trim().replace(/^['"]|['"]$/gu, '').trim()
  if (
    candidate.length < 2 || candidate.length > 120 || candidate.includes('@') ||
    /[\r\n\u0000<>]/u.test(candidate) || /^(?:noreply|no-reply|support|sales|info)$/iu.test(candidate)
  ) return null
  return candidate
}

export function decodeGmailMessage(input: unknown): GmailMessageEnvelope {
  const message = gmailFullMessageSchema.parse(input)
  const content = collectMessageContent(message.payload)
  const rawBody = content.plain.length > 0 ? content.plain.join('\n') : content.html.map(htmlToPlainText).join('\n')
  const body = rawBody.slice(0, 500_000)
  const subject = normalizeHeaderValue(messageHeader(message.payload.headers, 'Subject'), '(件名なし)')
  const from = normalizeHeaderValue(messageHeader(message.payload.headers, 'From'), '(送信者不明)')
  const warnings: GmailMessageEnvelope['warnings'] = []
  if (content.plain.length === 0 && content.html.length > 0) warnings.push('HTML_CONVERTED')
  if (rawBody.length > body.length) warnings.push('BODY_TRUNCATED')
  if (content.attachments > 0) warnings.push('ATTACHMENTS_NOT_DOWNLOADED')
  if (hasPromptInjectionPattern(`${subject}\n${body}`)) warnings.push('PROMPT_INJECTION_PATTERN')
  return {
    id: message.id,
    threadId: message.threadId,
    historyId: message.historyId,
    internalDate: gmailInternalDateIso(message.internalDate),
    labelIds: message.labelIds,
    rfcMessageId: normalizeHeaderValue(messageHeader(message.payload.headers, 'Message-ID'), '') || null,
    subject,
    from,
    fromDomain: domainFromMailbox(from),
    body,
    attachmentCount: content.attachments,
    warnings: [...new Set(warnings)]
  }
}

function queryKeywords(query: string): string[] {
  return query
    .split(/\s+OR\s+/iu)
    .map((term) => term.replace(/^['"]|['"]$/gu, '').trim())
    .filter((term) => term.length >= 2)
}

export function messageMatchesSyncScope(message: GmailMessageEnvelope, config: GmailSyncConfiguration, now = new Date()): boolean {
  if (!config.labelIds.every((label) => message.labelIds.includes(label))) return false
  const earliest = now.getTime() - config.lookbackDays * 24 * 60 * 60 * 1000
  const messageTime = new Date(message.internalDate).getTime()
  if (!Number.isFinite(messageTime) || messageTime < earliest || messageTime > now.getTime() + 24 * 60 * 60 * 1000) return false
  const keywords = queryKeywords(config.query)
  if (keywords.length === 0) return false
  const searchable = `${message.subject}\n${message.body}`.toLocaleLowerCase('ja-JP')
  return keywords.some((keyword) => searchable.includes(keyword.toLocaleLowerCase('ja-JP')))
}

export function classifyGmailMessage(message: GmailMessageEnvelope): 'job-case' | 'candidate-proposal' | 'unclassified' {
  return classifyEmailText(message.subject, message.body)
}

export function minimizeGmailBodyForLocalProcessing(body: string): string {
  return minimizeEmailBodyForLocalProcessing(body)
}

function gmailBusinessFingerprint(subject: string, body: string): string {
  const normalized = `${subject}\n${body}`
    .replace(/<[A-Z_]+_\d{3}>/gu, '<PII>')
    .replace(/^(?:From|To|Cc|Sent|Date|Subject|差出人|送信日時|宛先|件名):.*$/gimu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('ja-JP')
    .slice(0, 100_000)
  return createHash('sha256').update(normalized).digest('hex')
}

export interface LocallyRedactedGmailMessage {
  redaction: LocalRedactionResult
  message: GmailProcessedMessage
}

export function redactGmailMessageForLocalStorage(
  message: GmailMessageEnvelope,
  accountEmail: string,
  knownPersonNames: string[],
  now = new Date()
): LocallyRedactedGmailMessage {
  const localText = `[SUBJECT]\n${message.subject}\n[FROM]\n${message.from}\n[BODY]\n${message.body}`
  const senderDisplayName = displayNameFromMailbox(message.from)
  const redaction = redactTextForCloud(localText, {
    sourceVersion: `gmail:${message.id}:${message.historyId}`,
    policyVersion: 'cloud-redaction-v2',
    knownPersonNames: [...new Set([...knownPersonNames, ...(senderDisplayName ? [senderDisplayName] : [])])],
    now
  })
  if (redaction.blockedReasons.some((reason) => reason.startsWith('residual:'))) {
    throw new Error('Residual direct identifier remained after local Gmail redaction.')
  }
  const redactedSubject = applyLocalPiiMappings(message.subject, redaction.mappings)
  const redactedBody = applyLocalPiiMappings(message.body, redaction.mappings)
  return {
    redaction,
    message: {
      accountEmail,
      gmailMessageId: message.id,
      threadId: message.threadId,
      historyId: message.historyId,
      internalDate: message.internalDate,
      labelIds: message.labelIds,
      rfcMessageId: message.rfcMessageId
        ? createHash('sha256').update(message.rfcMessageId).digest('hex')
        : null,
      fromDomain: message.fromDomain,
      redactedSubject,
      redactedBody,
      redactionSessionId: redaction.session.id,
      classification: classifyGmailMessage(message),
      businessFingerprint: gmailBusinessFingerprint(redactedSubject, redactedBody),
      duplicateOfMessageId: null,
      warningCodes: [
        ...message.warnings,
        ...redaction.blockedReasons,
        ...(redaction.mappings.some((mapping) => mapping.identifierType === 'nationality')
          ? ['NATIONALITY_REQUIREMENT_BLOCKED_USE_WORK_AUTHORIZATION']
          : [])
      ],
      attachmentCount: message.attachmentCount,
      importedAt: now.toISOString()
    }
  }
}

export class GmailReadClient {
  constructor(
    private readonly accessToken: (forceRefresh?: boolean) => Promise<string>,
    private readonly fetchImpl: typeof fetch,
    private readonly requestTimeoutMs = 20_000
  ) {}

  async getProfile(): Promise<z.infer<typeof gmailProfileSchema>> {
    return gmailProfileSchema.parse(await this.request('/gmail/v1/users/me/profile'))
  }

  async discoverBaseline(configInput: GmailSyncConfiguration): Promise<GmailDiscoveryResult> {
    const config = gmailSyncConfigurationSchema.parse(configInput)
    const references = new Map<string, GmailMessageReference>()
    let pageToken: string | undefined
    let pageCount = 0
    do {
      const query = new URLSearchParams({
        maxResults: String(Math.min(100, config.maxMessagesPerRun)),
        q: `newer_than:${config.lookbackDays}d (${config.query})`,
        includeSpamTrash: 'false'
      })
      for (const labelId of config.labelIds) query.append('labelIds', labelId)
      if (pageToken) query.set('pageToken', pageToken)
      const response = messagesListResponseSchema.parse(await this.request(`/gmail/v1/users/me/messages?${query}`))
      for (const message of response.messages ?? []) {
        if (references.size >= config.maxMessagesPerRun) break
        references.set(message.id, message)
      }
      pageToken = response.nextPageToken
      pageCount += 1
    } while (pageToken && references.size < config.maxMessagesPerRun && pageCount < 10)
    return { messageReferences: [...references.values()], historyId: null, truncated: Boolean(pageToken) }
  }

  async discoverHistory(startHistoryId: string, configInput: GmailSyncConfiguration): Promise<GmailDiscoveryResult> {
    const config = gmailSyncConfigurationSchema.parse(configInput)
    const validatedStartHistoryId = z.string().regex(/^\d{1,40}$/u).parse(startHistoryId)
    const references = new Map<string, GmailMessageReference>()
    let latestHistoryId = validatedStartHistoryId
    let truncated = false
    for (const labelId of config.labelIds) {
      let pageToken: string | undefined
      let pageCount = 0
      do {
        if (references.size >= config.maxMessagesPerRun) {
          truncated = true
          break
        }
        const query = new URLSearchParams({
          startHistoryId: validatedStartHistoryId,
          maxResults: String(Math.min(100, config.maxMessagesPerRun - references.size)),
          labelId
        })
        query.append('historyTypes', 'messageAdded')
        query.append('historyTypes', 'labelAdded')
        if (pageToken) query.set('pageToken', pageToken)
        const response = historyResponseSchema.parse(await this.request(`/gmail/v1/users/me/history?${query}`))
        if (BigInt(response.historyId) > BigInt(latestHistoryId)) latestHistoryId = response.historyId
        for (const history of response.history ?? []) {
          for (const candidate of [...(history.messagesAdded ?? []), ...(history.labelsAdded ?? [])]) {
            if (references.size >= config.maxMessagesPerRun) {
              truncated = true
              break
            }
            references.set(candidate.message.id, candidate.message)
          }
          if (truncated) break
        }
        pageToken = response.nextPageToken
        pageCount += 1
        if (pageToken && pageCount >= 10) truncated = true
      } while (pageToken && !truncated)
      if (truncated) break
    }
    return { messageReferences: [...references.values()], historyId: latestHistoryId, truncated }
  }

  async getMessage(messageId: string): Promise<GmailMessageEnvelope> {
    const id = messageReferenceSchema.shape.id.parse(messageId)
    const query = new URLSearchParams({ format: 'full' })
    return decodeGmailMessage(await this.request(`/gmail/v1/users/me/messages/${encodeURIComponent(id)}?${query}`))
  }

  private async request(path: string): Promise<unknown> {
    assertGmailMethodAllowed('GET', path)
    let token = await this.accessToken(false)
    let response = await this.fetchImpl(`https://gmail.googleapis.com${path}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(this.requestTimeoutMs)
    })
    if (response.status === 401) {
      token = await this.accessToken(true)
      response = await this.fetchImpl(`https://gmail.googleapis.com${path}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      })
    }
    if (!response.ok) throw new GmailApiError(response.status, path)
    return response.json()
  }
}

export interface GmailSyncRun {
  mode: 'baseline' | 'incremental' | 'bounded-rescan'
  discovered: number
  imported: number
  duplicates: number
  filtered: number
  failed: number
}

export interface GmailSyncCheckpointPortRecord {
  configHash: string
  historyId: string | null
}

export interface GmailProcessedMessage {
  accountEmail: string
  gmailMessageId: string
  threadId: string
  historyId: string
  internalDate: string
  labelIds: string[]
  rfcMessageId: string | null
  fromDomain: string | null
  redactedSubject: string
  redactedBody: string
  redactionSessionId: string
  classification: 'job-case' | 'candidate-proposal' | 'unclassified'
  businessFingerprint: string
  duplicateOfMessageId: string | null
  warningCodes: string[]
  attachmentCount: number
  importedAt: string
}

export interface GmailSyncPersistencePort {
  getGmailSyncCheckpoint(accountEmail: string): GmailSyncCheckpointPortRecord | null
  saveGmailSyncSuccess(accountEmail: string, configHash: string, historyId: string, lastRun: GmailSyncRun, syncedAt: string): void
  saveGmailSyncFailure(accountEmail: string, configHash: string, errorCode: string, failedAt: string, lastRun?: GmailSyncRun | null): void
  hasGmailMessage(accountEmail: string, gmailMessageId: string): boolean
  findGmailMessageByFingerprint(accountEmail: string, fingerprint: string): string | null
  saveGmailMessage(input: GmailProcessedMessage): boolean
}

export interface GmailSyncExecutionResult {
  lastRun: GmailSyncRun | null
  errorCode: string | null
}

export function syncConfigurationHash(config: GmailSyncConfiguration): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex')
}

export function googleWorkspaceConfigurationFingerprint(config: GoogleWorkspaceAdminConfiguration): string {
  return createHash('sha256').update(JSON.stringify({
    clientId: config.clientId,
    workspaceDomain: config.workspaceDomain,
    labelIds: config.labelIds,
    query: config.query,
    lookbackDays: config.lookbackDays,
    maxMessagesPerRun: config.maxMessagesPerRun,
    revision: config.revision
  })).digest('hex')
}

export function createGoogleWorkspaceOnlineAcceptanceReport(options: {
  configuration: GoogleWorkspaceAdminConfiguration
  live: GoogleWorkspaceLiveVerification
  credentialProtection: 'macos-keychain' | 'windows-dpapi'
  sync: {
    configHash: string | null
    status: 'never' | 'idle' | 'error'
    lastSyncedAt: string | null
    lastRun: GmailSyncRun | null
  }
  redaction: {
    storedMessages: number
    passed: number
    uncertain: number
    blocked: number
  }
  id?: string
}): GoogleWorkspaceOnlineAcceptanceReport {
  const config = gmailSyncConfigurationSchema.parse({
    version: 'gmail-sync-config-v1',
    labelIds: options.configuration.labelIds,
    query: options.configuration.query,
    lookbackDays: options.configuration.lookbackDays,
    maxMessagesPerRun: options.configuration.maxMessagesPerRun
  })
  const currentSyncHash = syncConfigurationHash(config)
  const exactReadonlyScope = options.live.grantedScopes.length === 1 && options.live.grantedScopes[0] === gmailReadonlyScope
  const syncMatchesConfiguration = options.sync.configHash === currentSyncHash
  const syncSucceeded = options.sync.status === 'idle' && Boolean(options.sync.lastSyncedAt) && Boolean(options.sync.lastRun)
  const redactionCountReconciled = options.redaction.passed + options.redaction.uncertain + options.redaction.blocked === options.redaction.storedMessages
  const redactionStatus = options.redaction.storedMessages === 0 || !redactionCountReconciled || options.redaction.blocked > 0
    ? 'failed'
    : options.redaction.uncertain > 0 ? 'warning' : 'passed'
  const lastRun = options.sync.lastRun
  const checks: GoogleWorkspaceOnlineAcceptanceReport['checks'] = [
    {
      id: 'live-profile',
      status: 'passed',
      label: 'Gmail Profile のオンライン確認',
      detail: '保存済み Token で Gmail Profile を再取得しました。メール本文は取得していません。'
    },
    {
      id: 'readonly-scope',
      status: exactReadonlyScope ? 'passed' : 'failed',
      label: '読取専用 Scope',
      detail: exactReadonlyScope ? '付与 Scope は gmail.readonly のみです。' : 'gmail.readonly 以外の Scope が含まれています。再接続してください。'
    },
    {
      id: 'account-identity',
      status: 'passed',
      label: 'Google アカウント本人確認',
      detail: '保存済みの接続先とオンラインの Gmail アカウントが一致しました。アドレスは報告に保存しません。'
    },
    {
      id: 'credential-protection',
      status: 'passed',
      label: 'OAuth Token の端末保護',
      detail: `${options.credentialProtection} で保護されています。Token は報告に含めません。`
    },
    {
      id: 'bounded-sync',
      status: syncMatchesConfiguration ? 'passed' : 'failed',
      label: '管理者指定の同期範囲',
      detail: syncMatchesConfiguration ? '最近の同期は現在の Label・期間・件数上限と一致します。' : '現在の管理設定で同期を再実行してください。'
    },
    {
      id: 'successful-sync',
      status: syncSucceeded && (lastRun?.failed ?? 0) === 0 ? 'passed' : 'failed',
      label: 'Gmail の有界同期',
      detail: syncSucceeded && lastRun
        ? `最終同期: 取得候補 ${lastRun.discovered}件、保存 ${lastRun.imported}件、失敗 ${lastRun.failed}件。`
        : '接続後に「今すぐ同期」を実行してから再度検証してください。'
    },
    {
      id: 'local-redaction',
      status: redactionStatus,
      label: 'ローカル脱敏証跡',
      detail: options.redaction.storedMessages === 0
        ? '脱敏済み Gmail レコードがまだありません。対象 Label に検証用メールを用意してください。'
        : options.redaction.blocked > 0 || !redactionCountReconciled
          ? '脱敏証跡が欠損または無効です。対象レコードをクラウド処理へ渡せません。'
          : options.redaction.uncertain > 0
            ? `${options.redaction.passed}件通過、${options.redaction.uncertain}件は要確認として端末内に留めています。`
            : `${options.redaction.passed}件すべてに通過済みのローカル脱敏証跡があります。`
    },
    {
      id: 'no-cloud-model',
      status: 'passed',
      label: 'クラウド大模型未使用',
      detail: '接続確認・同期・脱敏は Google API と端末内処理だけで実行されました。'
    },
    {
      id: 'no-send-path',
      status: 'passed',
      label: '送信経路なし',
      detail: 'Gmail 草稿・送信 Scope と送信 API は実装されていません。'
    }
  ]
  return googleWorkspaceOnlineAcceptanceReportSchema.parse({
    version: 'google-workspace-online-acceptance-v1',
    id: options.id ?? randomUUID(),
    checkedAt: options.live.checkedAt,
    overall: checks.some((check) => check.status === 'failed') ? 'action-required' : 'passed',
    configurationFingerprint: googleWorkspaceConfigurationFingerprint(options.configuration),
    credentialProtection: options.credentialProtection,
    mailboxMetadataAccessed: true,
    messageContentAccessedDuringCheck: false,
    cloudModelUsed: false,
    directIdentifierCloudSent: false,
    checks,
    evidence: {
      grantedScopeCount: options.live.grantedScopes.length,
      sync: {
        status: options.sync.status,
        lastSyncedAt: options.sync.lastSyncedAt,
        mode: lastRun?.mode ?? null,
        discovered: lastRun?.discovered ?? 0,
        imported: lastRun?.imported ?? 0,
        duplicates: lastRun?.duplicates ?? 0,
        filtered: lastRun?.filtered ?? 0,
        failed: lastRun?.failed ?? 0
      },
      redaction: options.redaction
    }
  })
}

function coordinatorErrorCode(error: unknown): string {
  if (error instanceof GmailApiError) return `GMAIL_HTTP_${error.status}`
  if (error instanceof Error && error.message.includes('authorization expired or was revoked')) return 'GOOGLE_REAUTH_REQUIRED'
  if (error instanceof Error && error.message.includes('scope')) return 'GMAIL_SCOPE_REJECTED'
  return 'GMAIL_SYNC_FAILED'
}

export class GmailSyncCoordinator {
  constructor(
    private readonly gmail: GmailReadClient,
    private readonly store: GmailSyncPersistencePort,
    private readonly processMessage: (message: GmailMessageEnvelope) => Promise<GmailProcessedMessage>,
    private readonly now: () => Date = () => new Date()
  ) {}

  async synchronize(accountEmail: string, configInput: GmailSyncConfiguration): Promise<GmailSyncExecutionResult> {
    const config = gmailSyncConfigurationSchema.parse(configInput)
    const configHash = syncConfigurationHash(config)
    const now = this.now()
    try {
      const profile = await this.gmail.getProfile()
      if (profile.emailAddress.toLocaleLowerCase('en-US') !== accountEmail.toLocaleLowerCase('en-US')) {
        throw new Error('Gmail account changed during synchronization.')
      }
      if (!profile.historyId) throw new Error('Gmail profile did not provide a history checkpoint.')
      const checkpoint = this.store.getGmailSyncCheckpoint(accountEmail)
      const canContinue = checkpoint?.configHash === configHash && Boolean(checkpoint.historyId)
      let mode: GmailSyncRun['mode'] = canContinue ? 'incremental' : 'baseline'
      let discovery: GmailDiscoveryResult
      if (canContinue && checkpoint?.historyId) {
        try {
          discovery = await this.gmail.discoverHistory(checkpoint.historyId, config)
        } catch (error) {
          if (!(error instanceof GmailApiError) || error.status !== 404) throw error
          mode = 'bounded-rescan'
          discovery = await this.gmail.discoverBaseline(config)
        }
      } else {
        discovery = await this.gmail.discoverBaseline(config)
      }
      const lastRun: GmailSyncRun = {
        mode,
        discovered: discovery.messageReferences.length,
        imported: 0,
        duplicates: 0,
        filtered: 0,
        failed: 0
      }
      if (discovery.truncated) {
        this.store.saveGmailSyncFailure(accountEmail, configHash, 'SYNC_SCOPE_TOO_BROAD', now.toISOString(), lastRun)
        return { lastRun, errorCode: 'SYNC_SCOPE_TOO_BROAD' }
      }
      const pending = discovery.messageReferences.filter((reference) => {
        if (this.store.hasGmailMessage(accountEmail, reference.id)) {
          lastRun.duplicates += 1
          return false
        }
        return true
      })
      for (let offset = 0; offset < pending.length; offset += 4) {
        const batch = pending.slice(offset, offset + 4)
        const fetched = await Promise.allSettled(batch.map((reference) => this.gmail.getMessage(reference.id)))
        for (const result of fetched) {
          if (result.status === 'rejected') {
            lastRun.failed += 1
            continue
          }
          const message = { ...result.value, body: minimizeGmailBodyForLocalProcessing(result.value.body) }
          if (!messageMatchesSyncScope(message, config, now)) {
            lastRun.filtered += 1
            continue
          }
          try {
            const processed = await this.processMessage(message)
            const duplicateOf = this.store.findGmailMessageByFingerprint(accountEmail, processed.businessFingerprint)
            const stored = this.store.saveGmailMessage({
              ...processed,
              duplicateOfMessageId: duplicateOf,
              warningCodes: [
                ...processed.warningCodes,
                ...(duplicateOf ? ['BUSINESS_DUPLICATE'] : [])
              ]
            })
            if (stored) lastRun.imported += 1
            else lastRun.duplicates += 1
            if (duplicateOf) lastRun.duplicates += 1
          } catch {
            lastRun.failed += 1
          }
        }
      }
      if (lastRun.failed > 0) {
        this.store.saveGmailSyncFailure(accountEmail, configHash, 'MESSAGE_PROCESSING_FAILED', now.toISOString(), lastRun)
        return { lastRun, errorCode: 'MESSAGE_PROCESSING_FAILED' }
      }
      const nextHistoryId = mode === 'incremental' ? discovery.historyId ?? profile.historyId : profile.historyId
      this.store.saveGmailSyncSuccess(accountEmail, configHash, nextHistoryId, lastRun, now.toISOString())
      return { lastRun, errorCode: null }
    } catch (error) {
      const errorCode = coordinatorErrorCode(error)
      this.store.saveGmailSyncFailure(accountEmail, configHash, errorCode, now.toISOString())
      return { lastRun: null, errorCode }
    }
  }
}
