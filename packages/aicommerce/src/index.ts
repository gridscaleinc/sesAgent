import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto'
import { z } from 'zod'

export type AiCommerceBillingMode = 'automatic' | 'standard' | 'subscription'
export type AiCommerceChargePool = Exclude<AiCommerceBillingMode, 'automatic'>

const nativeClientCodeSchema = z.string().trim().regex(/^[A-Za-z0-9._-]{3,120}$/u)
const applicationCodeSchema = z.string().trim().max(64).regex(/^[a-z0-9][a-z0-9._-]*$/u)
const productCodeSchema = z.string().trim().max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u)
const productionOrLoopbackUrlSchema = z.string().trim().url().transform((value, context) => {
  const url = new URL(value)
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    context.addIssue({ code: 'custom', message: 'AICommerce URLs must use HTTPS, except local loopback development URLs.' })
    return z.NEVER
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    context.addIssue({ code: 'custom', message: 'AICommerce base URLs must be origins without credentials or paths.' })
    return z.NEVER
  }
  return url.origin
})

const nativeRedirectUriSchema = z.string().trim().url().transform((value, context) => {
  const url = new URL(value)
  if (url.protocol === 'http:' || url.protocol === 'https:' || !url.protocol || url.username || url.password || url.search || url.hash) {
    context.addIssue({ code: 'custom', message: 'The Native redirect URI must be the registered custom-scheme callback URI.' })
    return z.NEVER
  }
  if (url.hostname !== 'auth' || url.pathname !== '/callback') {
    context.addIssue({ code: 'custom', message: 'The Native redirect URI must use the registered ://auth/callback shape.' })
    return z.NEVER
  }
  return url.toString()
})

const aiCommerceConfigurationSchema = z.object({
  membersBaseUrl: productionOrLoopbackUrlSchema,
  aiCommerceBaseUrl: productionOrLoopbackUrlSchema,
  clientId: nativeClientCodeSchema,
  appCode: applicationCodeSchema,
  productCode: productCodeSchema,
  redirectUri: nativeRedirectUriSchema,
  billingMode: z.enum(['automatic', 'standard', 'subscription'])
}).strict()

export type AiCommerceConfiguration = z.infer<typeof aiCommerceConfigurationSchema>

export const sesAiCommerceProductionDefaults = {
  MEMBERS_BASE_URL: 'https://members.gridscale.com',
  AICOMMERCE_BASE_URL: 'https://aicommerce.gridscale.com',
  MEMBER_NATIVE_CLIENT_ID: 'ses-agent',
  AICOMMERCE_APP_CODE: 'sesagent',
  AICOMMERCE_PRODUCT_CODE: 'sesAgent',
  MEMBER_NATIVE_REDIRECT_URI: 'com.gridscale.native.ses-agent://auth/callback',
  AICOMMERCE_BILLING_MODE: 'automatic'
} as const

export const aiCommerceRequiredConfigurationKeys = [
  'MEMBERS_BASE_URL',
  'AICOMMERCE_BASE_URL',
  'MEMBER_NATIVE_CLIENT_ID',
  'AICOMMERCE_APP_CODE',
  'AICOMMERCE_PRODUCT_CODE',
  'MEMBER_NATIVE_REDIRECT_URI'
] as const

export function loadAiCommerceConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
  defaults: Partial<Record<keyof typeof sesAiCommerceProductionDefaults, string>> = sesAiCommerceProductionDefaults
): AiCommerceConfiguration | null {
  const value = (primary: keyof typeof sesAiCommerceProductionDefaults, legacy: string): string =>
    environment[primary]?.trim() || environment[legacy]?.trim() || defaults[primary]?.trim() || ''
  const raw = {
    membersBaseUrl: value('MEMBERS_BASE_URL', 'SES_MEMBERS_BASE_URL'),
    aiCommerceBaseUrl: value('AICOMMERCE_BASE_URL', 'SES_AICOMMERCE_BASE_URL'),
    clientId: value('MEMBER_NATIVE_CLIENT_ID', 'SES_AICOMMERCE_CLIENT_ID'),
    appCode: value('AICOMMERCE_APP_CODE', 'SES_AICOMMERCE_APP_CODE'),
    productCode: value('AICOMMERCE_PRODUCT_CODE', 'SES_AICOMMERCE_PRODUCT_CODE'),
    redirectUri: value('MEMBER_NATIVE_REDIRECT_URI', 'SES_AICOMMERCE_REDIRECT_URI'),
    billingMode: value('AICOMMERCE_BILLING_MODE', 'SES_AICOMMERCE_BILLING_MODE') || 'automatic'
  }
  const configuredValues = [raw.membersBaseUrl, raw.aiCommerceBaseUrl, raw.clientId, raw.appCode, raw.productCode, raw.redirectUri]
  if (!configuredValues.some(Boolean)) return null
  const parsed = aiCommerceConfigurationSchema.safeParse(raw)
  if (!parsed.success) {
    const missing = [
      ['MEMBERS_BASE_URL', raw.membersBaseUrl],
      ['AICOMMERCE_BASE_URL', raw.aiCommerceBaseUrl],
      ['MEMBER_NATIVE_CLIENT_ID', raw.clientId],
      ['AICOMMERCE_APP_CODE', raw.appCode],
      ['AICOMMERCE_PRODUCT_CODE', raw.productCode],
      ['MEMBER_NATIVE_REDIRECT_URI', raw.redirectUri]
    ].filter(([, configured]) => !configured).map(([key]) => key)
    throw new Error(missing.length > 0
      ? `AICommerce managed configuration is missing: ${missing.join(', ')}.`
      : 'AICommerce managed configuration contains an invalid URL, client/product code, redirect URI, or billing mode.')
  }
  return parsed.data
}

const pendingAuthorizationSchema = z.object({
  version: z.literal('aicommerce-native-pending-authorization-v1'),
  state: z.string().min(24).max(512),
  codeVerifier: z.string().min(43).max(128),
  redirectUri: nativeRedirectUriSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime()
}).strict()

export type AiCommercePendingAuthorization = z.infer<typeof pendingAuthorizationSchema>

export function parseAiCommercePendingAuthorization(input: unknown): AiCommercePendingAuthorization {
  return pendingAuthorizationSchema.parse(input)
}

const nativeCredentialSchema = z.object({
  version: z.literal('aicommerce-native-credential-v1'),
  memberId: z.string().min(1).max(160),
  memberDisplayName: z.string().trim().min(1).max(300).nullable(),
  accountId: z.string().min(1).max(160),
  accessToken: z.string().min(20).max(16_384),
  accessTokenExpiresAt: z.string().datetime(),
  refreshToken: z.string().min(10).max(16_384),
  refreshTokenExpiresAt: z.string().datetime(),
  accountAiToken: z.string().min(12).max(16_384),
  accountAiTokenExpiresAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict()

export type AiCommerceNativeCredential = z.infer<typeof nativeCredentialSchema>

export function parseAiCommerceNativeCredential(input: unknown): AiCommerceNativeCredential {
  return nativeCredentialSchema.parse(input)
}

export interface AiCommerceCredentialStore {
  load(): Promise<AiCommerceNativeCredential | null>
  save(credential: AiCommerceNativeCredential): Promise<void>
  clear(): Promise<void>
}

export interface AiCommercePendingAuthorizationStore {
  load(): Promise<AiCommercePendingAuthorization | null>
  save(pending: AiCommercePendingAuthorization): Promise<void>
  clear(): Promise<void>
}

export interface AiCommerceWallet {
  balanceCredits: number
  reservedCredits: number
}

export interface AiCommerceCapability {
  alias: string
  displayName: string
  modality: string | null
}

export interface AiCommerceMembershipState {
  configuration: 'required' | 'ready'
  connection: 'not-connected' | 'authorizing' | 'connected' | 'reauthentication-required'
  productCode: string | null
  billingMode: AiCommerceBillingMode | null
  memberDisplayName: string | null
  accountId: string | null
  accountAiTokenExpiresAt: string | null
  wallet: AiCommerceWallet | null
  capabilities: AiCommerceCapability[]
  refreshedAt: string | null
}

export interface AiCommerceTextResult {
  requestId: string
  aiRequestId: string
  content: string
  usageCredits: number | null
  wallet: AiCommerceWallet | null
  billingModeUsed: AiCommerceChargePool
}

export interface AiCommerceResponsesStreamInput {
  model: string
  instructions: string
  input: string
  maxOutputTokens: number
  operationId?: string
  signal?: AbortSignal
  onClientRequestId?(clientRequestId: string): void
  onDelta(delta: string): void
}

export interface AiCommerceResponsesStreamResult {
  clientRequestId: string
  responseId: string
  content: string
  billingModeUsed: AiCommerceChargePool
}

export interface AiCommerceChatCompletionsStreamInput extends AiCommerceResponsesStreamInput {
  provider: 'openai' | 'deepseek'
}

export type AiCommerceCancelStatus = 'cancel_requested' | 'canceled' | 'too_late'

export interface AiCommerceCancelResult {
  clientRequestId: string
  status: AiCommerceCancelStatus
}

export class AiCommerceRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'AiCommerceRequestError'
  }
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

interface JsonHttpResponse<T> {
  status: number
  body: T
}

const tokenExchangeSchema = z.object({
  ok: z.boolean().optional(),
  member: z.object({
    id: z.string().min(1).max(160),
    displayName: z.string().trim().min(1).max(300).nullable().optional()
  }),
  session: z.object({
    accessToken: z.string().min(20),
    accessTokenExpiresAt: z.string().datetime(),
    refreshToken: z.string().min(10),
    refreshTokenExpiresAt: z.string().datetime()
  }),
  token: z.object({
    accountId: z.string().min(1).max(160),
    accountAiToken: z.string().min(12),
    expiresAt: z.string().datetime()
  })
}).passthrough()

const refreshSchema = z.object({
  ok: z.boolean().optional(),
  session: z.object({
    accessToken: z.string().min(20),
    accessTokenExpiresAt: z.string().datetime(),
    refreshToken: z.string().min(10),
    refreshTokenExpiresAt: z.string().datetime()
  })
}).passthrough()

const tokenResetSchema = z.object({
  ok: z.boolean().optional(),
  token: z.object({
    accountAiToken: z.string().min(12),
    expiresAt: z.string().datetime()
  })
}).passthrough()

const walletSchema = z.object({
  balance_credits: z.number().int().nonnegative(),
  reserved_credits: z.number().int().nonnegative()
}).passthrough()

const capabilitySchema = z.object({
  capability_alias: z.string().trim().min(1).max(160),
  request_type: z.string().trim().min(1).max(80).optional(),
  display_name: z.string().trim().min(1).max(300).optional(),
  modality: z.string().trim().min(1).max(80).nullable().optional(),
  status: z.string().trim().min(1).max(80).optional()
}).passthrough()

const capabilitiesSchema = z.object({ capabilities: z.array(capabilitySchema).max(100) }).passthrough()

const aiResponseSchema = z.object({
  request_id: z.string().min(1).max(300).optional(),
  ai_request_id: z.string().min(1).max(300).optional(),
  status: z.enum(['succeeded', 'queued', 'processing', 'failed']).optional(),
  output: z.object({
    message: z.object({ content: z.string().min(1).max(2_000_000) }).optional(),
    content: z.string().min(1).max(2_000_000).optional(),
    text: z.string().min(1).max(2_000_000).optional()
  }).optional(),
  usage: z.object({ amount_credits: z.number().int().nonnegative().optional() }).optional(),
  wallet: z.object({
    balance_credits: z.number().int().nonnegative(),
    reserved_credits: z.number().int().nonnegative().optional()
  }).optional(),
  error: z.object({
    code: z.string().min(1).max(160).optional(),
    message: z.string().min(1).max(500).optional()
  }).optional()
}).passthrough()

const responsesStreamInputSchema = z.object({
  model: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,119}$/u),
  instructions: z.string().min(1).max(12_000),
  input: z.string().min(1).max(20_000),
  maxOutputTokens: z.number().int().min(128).max(8_192),
  operationId: z.string().regex(/^[A-Za-z0-9._-]{8,96}$/u).optional()
}).strict()

const chatCompletionsStreamInputSchema = responsesStreamInputSchema.extend({
  provider: z.enum(['openai', 'deepseek'])
}).strict()

const cancelResponseSchema = z.object({
  status: z.enum(['cancel_requested', 'canceled', 'too_late']).optional(),
  cancel_status: z.enum(['cancel_requested', 'canceled', 'too_late']).optional()
}).passthrough().superRefine((value, context) => {
  if (value.status === undefined && value.cancel_status === undefined) {
    context.addIssue({ code: 'custom', message: 'A cancel status is required.' })
  }
})

class AiCommerceStreamAttemptError extends AiCommerceRequestError {
  constructor(code: string, status: number, message: string, readonly receivedStreamContent: boolean) {
    super(code, status, message)
    this.name = 'AiCommerceStreamAttemptError'
  }
}

interface ParsedNativeTextStream {
  responseId: string
  content: string
}

async function parseNativeTextEventStream(
  response: Response,
  protocol: 'responses' | 'chat-completions',
  onDelta: (delta: string) => void,
  onStreamContent: () => void
): Promise<ParsedNativeTextStream> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLocaleLowerCase('en-US') ?? ''
  if (contentType !== 'text/event-stream') {
    try {
      await response.body?.cancel()
    } catch {
      // Invalid responses are rejected regardless of best-effort body cleanup.
    }
    throw new AiCommerceStreamAttemptError('AI_STREAM_CONTENT_TYPE_INVALID', response.status, 'AICommerce did not return a real event stream.', false)
  }
  if (!response.body) {
    throw new AiCommerceStreamAttemptError('AI_STREAM_BODY_MISSING', 502, 'AICommerce returned an empty event stream.', false)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = ''
  let dataLines: string[] = []
  let content = ''
  let responseId = ''
  let completed = false
  let receivedStreamContent = false
  let readerCancelled = false

  const fail = (code: string, message: string): never => {
    throw new AiCommerceStreamAttemptError(code, 502, message, receivedStreamContent)
  }

  const dispatch = (): void => {
    if (dataLines.length === 0) {
      eventName = ''
      return
    }
    receivedStreamContent = true
    onStreamContent()
    const data = dataLines.join('\n')
    dataLines = []
    const currentEventName = eventName
    eventName = ''
    if (data === '[DONE]') {
      if (protocol === 'responses' && !completed) {
        fail('AI_STREAM_COMPLETION_MISSING', 'The AI event stream ended before a completion event.')
      }
      completed = true
      return
    }
    if (completed) fail('AI_STREAM_EVENT_AFTER_TERMINAL', 'AICommerce returned data after the terminal response event.')
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      fail('AI_STREAM_EVENT_INVALID', 'AICommerce returned an invalid SSE event.')
    }
    if (typeof payload !== 'object' || payload === null) {
      fail('AI_STREAM_EVENT_INVALID', 'AICommerce returned an invalid SSE event.')
    }
    const record = payload as Record<string, unknown>
    if (protocol === 'chat-completions') {
      const error = typeof record.error === 'object' && record.error !== null
        ? record.error as Record<string, unknown>
        : null
      if (error) {
        const code = typeof error.code === 'string' ? error.code : 'AI_STREAM_ERROR'
        fail(code, 'AICommerce reported a streaming error.')
      }
      if (typeof record.id === 'string' && record.id.length > 0) responseId = record.id
      const choices = record.choices
      if (!Array.isArray(choices)) {
        fail('AI_STREAM_EVENT_INVALID', 'AICommerce returned an invalid Chat Completions event.')
      }
      for (const rawChoice of choices as unknown[]) {
        if (typeof rawChoice !== 'object' || rawChoice === null || Array.isArray(rawChoice)) {
          fail('AI_STREAM_EVENT_INVALID', 'AICommerce returned an invalid Chat Completions choice.')
        }
        const choice = rawChoice as Record<string, unknown>
        const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : null
        if (finishReason === 'length' || finishReason === 'max_tokens') {
          fail('AI_RESPONSE_INCOMPLETE', 'The AI response reached its output limit and was incomplete.')
        }
        const delta = typeof choice.delta === 'object' && choice.delta !== null
          ? choice.delta as Record<string, unknown>
          : null
        const fragment = typeof delta?.content === 'string' ? delta.content : ''
        if (fragment.length > 0) {
          content += fragment
          if (content.length > 100_000) fail('AI_STREAM_OUTPUT_TOO_LARGE', 'The streamed AI response exceeded the local safety limit.')
          onDelta(fragment)
        }
      }
      return
    }
    const type = typeof record.type === 'string' ? record.type : currentEventName
    if (type === 'response.output_text.delta') {
      const delta = record.delta
      if (typeof delta !== 'string') {
        fail('AI_STREAM_EVENT_INVALID', 'AICommerce returned an invalid text delta.')
      } else if (delta.length > 0) {
        content += delta
        if (content.length > 100_000) fail('AI_STREAM_OUTPUT_TOO_LARGE', 'The streamed AI response exceeded the local safety limit.')
        onDelta(delta)
      }
      return
    }
    if (type === 'response.completed') {
      if (completed) fail('AI_STREAM_TERMINAL_DUPLICATED', 'AICommerce returned more than one terminal response event.')
      const completedResponse = typeof record.response === 'object' && record.response !== null
        ? record.response as Record<string, unknown>
        : null
      responseId = typeof completedResponse?.id === 'string' ? completedResponse.id : ''
      completed = true
      return
    }
    if (type === 'error') {
      const code = typeof record.code === 'string' ? record.code : 'AI_STREAM_ERROR'
      fail(code, 'AICommerce reported a streaming error.')
    }
    if (type === 'response.failed' || type === 'response.incomplete') {
      const failedResponse = typeof record.response === 'object' && record.response !== null
        ? record.response as Record<string, unknown>
        : null
      responseId = typeof failedResponse?.id === 'string' ? failedResponse.id : responseId
      fail(type === 'response.failed' ? 'AI_RESPONSE_FAILED' : 'AI_RESPONSE_INCOMPLETE',
        type === 'response.failed' ? 'The AI response failed.' : 'The AI response was incomplete.')
    }
  }

  const consumeLine = (rawLine: string): void => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line === '') {
      dispatch()
      return
    }
    if (line.startsWith(':')) return
    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    let value = separator === -1 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (completed && field !== 'data') {
      fail('AI_STREAM_EVENT_AFTER_TERMINAL', 'AICommerce returned an SSE field after the terminal response event.')
    }
    if (field === 'event') eventName = value
    if (field === 'data') dataLines.push(value)
  }

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        consumeLine(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.length > 0) consumeLine(buffer)
    dispatch()
    if (!completed) fail('AI_STREAM_COMPLETION_MISSING', 'The AI event stream ended without a completion event.')
    if (!responseId) fail('AI_STREAM_RESPONSE_ID_MISSING', 'The completed AI response did not include a response id.')
    if (!content) fail('AI_STREAM_OUTPUT_MISSING', 'The completed AI response did not contain streamed text.')
    return { responseId, content }
  } catch (cause) {
    if (!readerCancelled) {
      try {
        await reader.cancel(cause)
        readerCancelled = true
      } catch {
        // Preserve the original parser, consumer, or transport failure.
      }
    }
    if (cause instanceof AiCommerceRequestError) throw cause
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw new AiCommerceStreamAttemptError('AI_STREAM_ABORTED', 0, 'The streamed AI response was stopped.', receivedStreamContent)
    }
    throw new AiCommerceStreamAttemptError('AI_STREAM_READ_FAILED', 0, 'The AI event stream was interrupted.', receivedStreamContent)
  } finally {
    reader.releaseLock()
  }
}

function toWallet(value: z.infer<typeof walletSchema> | z.infer<typeof aiResponseSchema>['wallet']): AiCommerceWallet | null {
  if (!value || typeof value.balance_credits !== 'number') return null
  return {
    balanceCredits: value.balance_credits,
    reservedCredits: typeof value.reserved_credits === 'number' ? value.reserved_credits : 0
  }
}

function base64Url(bytes: Buffer): string {
  return bytes.toString('base64url')
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8')
  const rightBytes = Buffer.from(right, 'utf8')
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function sameRedirectTarget(left: string, right: string): boolean {
  const leftUrl = new URL(left)
  const rightUrl = new URL(right)
  return leftUrl.protocol.toLocaleLowerCase('en-US') === rightUrl.protocol.toLocaleLowerCase('en-US') &&
    leftUrl.hostname.toLocaleLowerCase('en-US') === rightUrl.hostname.toLocaleLowerCase('en-US') &&
    leftUrl.port === rightUrl.port && leftUrl.pathname === rightUrl.pathname
}

function parseFailure(status: number, payload: unknown, fallback: string): AiCommerceRequestError {
  const parsed = aiResponseSchema.safeParse(payload)
  const code = parsed.success && parsed.data.error?.code
    ? parsed.data.error.code
    : status === 401 ? 'TOKEN_INVALID'
      : status === 402 ? 'INSUFFICIENT_CREDITS'
        : `HTTP_${status}`
  const safeMessages: Record<string, string> = {
    TOKEN_INVALID: 'AI sign-in has expired. Please sign in again.',
    TOKEN_REVOKED: 'AI sign-in has been revoked. Please sign in again.',
    token_expired: 'AI sign-in has expired. Please sign in again.',
    INSUFFICIENT_CREDITS: 'There are not enough available AI credits.',
    ENTITLEMENT_INACTIVE: 'This membership does not have access to the selected AI capability.',
    DUPLICATE_REQUEST_IN_PROGRESS: 'The same AI request is still processing.',
    GATEWAY_CAPABILITY_BINDING_NOT_CONFIGURED: 'The selected AI capability is not configured for this product.',
    AI_GATEWAY_TIMEOUT: 'The AI request timed out. Please retry the same action.',
    AI_GATEWAY_ERROR: 'The AI service could not process this request.'
  }
  return new AiCommerceRequestError(code, status, safeMessages[code] ?? `${fallback} [${code}]`)
}

export class AiCommerceNativeClient {
  private aiTokenResetInFlight: Promise<AiCommerceNativeCredential> | null = null

  constructor(
    readonly configuration: AiCommerceConfiguration,
    private readonly dependencies: {
      credentialStore: AiCommerceCredentialStore
      pendingAuthorizationStore: AiCommercePendingAuthorizationStore
      openExternal(url: string): Promise<void>
      fetch: FetchLike
      now?: () => Date
      wait?: (milliseconds: number) => Promise<void>
    }
  ) {}

  get requestEndpoint(): string {
    return `${this.configuration.aiCommerceBaseUrl}/v1/ai/requests`
  }

  get responsesEndpoint(): string {
    return `${this.configuration.aiCommerceBaseUrl}/v1/ai/native/openai/v1/responses`
  }

  chatCompletionsEndpoint(provider: 'openai' | 'deepseek'): string {
    const validatedProvider = z.enum(['openai', 'deepseek']).parse(provider)
    return `${this.configuration.aiCommerceBaseUrl}/v1/ai/native/${validatedProvider}/v1/chat/completions`
  }

  get allowsLoopbackHttp(): boolean {
    return this.configuration.aiCommerceBaseUrl.startsWith('http://localhost') ||
      this.configuration.aiCommerceBaseUrl.startsWith('http://127.0.0.1') ||
      this.configuration.aiCommerceBaseUrl.startsWith('http://[::1]')
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date()
  }

  private async requestJson<T>(method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<JsonHttpResponse<T>> {
    const requestHeaders: Record<string, string> = { accept: 'application/json', ...headers }
    const init: RequestInit = { method, headers: requestHeaders, redirect: 'error' }
    if (body !== undefined) {
      requestHeaders['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    let response: Response
    try {
      response = await this.dependencies.fetch(path, init)
    } catch (cause) {
      throw new AiCommerceRequestError('NETWORK_ERROR', 0, 'The membership or AI service could not be reached.')
    }
    const parsed = await response.json().catch(() => ({})) as T
    return { status: response.status, body: parsed }
  }

  private async saveCredential(input: z.infer<typeof tokenExchangeSchema>, prior: AiCommerceNativeCredential | null = null): Promise<AiCommerceNativeCredential> {
    const credential = nativeCredentialSchema.parse({
      version: 'aicommerce-native-credential-v1',
      memberId: input.member.id,
      memberDisplayName: input.member.displayName ?? prior?.memberDisplayName ?? null,
      accountId: input.token.accountId,
      accessToken: input.session.accessToken,
      accessTokenExpiresAt: input.session.accessTokenExpiresAt,
      refreshToken: input.session.refreshToken,
      refreshTokenExpiresAt: input.session.refreshTokenExpiresAt,
      accountAiToken: input.token.accountAiToken,
      accountAiTokenExpiresAt: input.token.expiresAt,
      updatedAt: this.now().toISOString()
    })
    await this.dependencies.credentialStore.save(credential)
    return credential
  }

  private stateFromCredential(
    credential: AiCommerceNativeCredential | null,
    authorizing: boolean,
    dashboard: Pick<AiCommerceMembershipState, 'wallet' | 'capabilities' | 'refreshedAt'> = {
      wallet: null,
      capabilities: [],
      refreshedAt: null
    }
  ): AiCommerceMembershipState {
    if (!credential) {
      return {
        configuration: 'ready', connection: authorizing ? 'authorizing' : 'not-connected', productCode: this.configuration.productCode,
        billingMode: this.configuration.billingMode, memberDisplayName: null, accountId: null,
        accountAiTokenExpiresAt: null, ...dashboard
      }
    }
    const reauthenticationRequired = Date.parse(credential.refreshTokenExpiresAt) <= this.now().getTime()
    return {
      configuration: 'ready', connection: reauthenticationRequired ? 'reauthentication-required' : 'connected',
      productCode: this.configuration.productCode, billingMode: this.configuration.billingMode,
      memberDisplayName: credential.memberDisplayName, accountId: credential.accountId,
      accountAiTokenExpiresAt: credential.accountAiTokenExpiresAt, ...dashboard
    }
  }

  async getState(): Promise<AiCommerceMembershipState> {
    const [credential, pending] = await Promise.all([
      this.dependencies.credentialStore.load(),
      this.dependencies.pendingAuthorizationStore.load()
    ])
    const pendingIsActive = Boolean(pending && Date.parse(pending.expiresAt) > this.now().getTime())
    if (pending && !pendingIsActive) await this.dependencies.pendingAuthorizationStore.clear()
    return this.stateFromCredential(credential, pendingIsActive)
  }

  async beginConnect(): Promise<AiCommerceMembershipState> {
    const verifier = base64Url(randomBytes(48))
    const state = base64Url(randomBytes(24))
    const codeChallenge = createHash('sha256').update(verifier, 'utf8').digest('base64url')
    const authorizeUrl = new URL('/api/native/authorize', this.configuration.membersBaseUrl)
    authorizeUrl.searchParams.set('client_id', this.configuration.clientId)
    authorizeUrl.searchParams.set('product_code', this.configuration.productCode)
    authorizeUrl.searchParams.set('redirect_uri', this.configuration.redirectUri)
    authorizeUrl.searchParams.set('state', state)
    authorizeUrl.searchParams.set('code_challenge', codeChallenge)
    authorizeUrl.searchParams.set('code_challenge_method', 'S256')
    const now = this.now()
    const pending = pendingAuthorizationSchema.parse({
      version: 'aicommerce-native-pending-authorization-v1',
      state,
      codeVerifier: verifier,
      redirectUri: this.configuration.redirectUri,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString()
    })
    await this.dependencies.pendingAuthorizationStore.save(pending)
    try {
      await this.dependencies.openExternal(authorizeUrl.toString())
    } catch (cause) {
      await this.dependencies.pendingAuthorizationStore.clear()
      throw new AiCommerceRequestError('BROWSER_OPEN_FAILED', 0, 'The system browser could not open Member Center sign-in.')
    }
    return this.getState()
  }

  async completeConnect(callbackUrl: string): Promise<AiCommerceMembershipState> {
    const pending = await this.dependencies.pendingAuthorizationStore.load()
    if (!pending || Date.parse(pending.expiresAt) <= this.now().getTime()) {
      await this.dependencies.pendingAuthorizationStore.clear()
      throw new AiCommerceRequestError('OAUTH_PENDING_MISSING', 400, 'The Member Center sign-in request is missing or expired.')
    }
    let callback: URL
    try {
      callback = new URL(callbackUrl)
    } catch {
      throw new AiCommerceRequestError('OAUTH_CALLBACK_INVALID', 400, 'Member Center returned an invalid sign-in callback.')
    }
    if (!sameRedirectTarget(callback.toString(), pending.redirectUri)) {
      throw new AiCommerceRequestError('OAUTH_REDIRECT_MISMATCH', 400, 'Member Center returned an unexpected sign-in callback.')
    }
    const providerError = callback.searchParams.get('error')
    const code = callback.searchParams.get('code')
    const returnedState = callback.searchParams.get('state') ?? ''
    if (providerError) {
      await this.dependencies.pendingAuthorizationStore.clear()
      throw new AiCommerceRequestError('OAUTH_PROVIDER_ERROR', 400, 'Member Center sign-in was not completed.')
    }
    if (!constantTimeEqual(returnedState, pending.state)) {
      await this.dependencies.pendingAuthorizationStore.clear()
      throw new AiCommerceRequestError('OAUTH_STATE_MISMATCH', 400, 'Member sign-in could not be verified. Please try again.')
    }
    if (!code || code.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(code)) {
      await this.dependencies.pendingAuthorizationStore.clear()
      throw new AiCommerceRequestError('OAUTH_CODE_MISSING', 400, 'Member Center did not return a valid one-time code.')
    }
    await this.dependencies.pendingAuthorizationStore.clear()
    const token = await this.requestJson<unknown>('POST', `${this.configuration.membersBaseUrl}/api/native/token`, {}, {
      code, code_verifier: pending.codeVerifier, redirect_uri: pending.redirectUri
    })
    if (token.status !== 200) throw parseFailure(token.status, token.body, 'Member sign-in could not be completed.')
    const parsed = tokenExchangeSchema.safeParse(token.body)
    if (!parsed.success) throw new AiCommerceRequestError('TOKEN_RESPONSE_INVALID', 502, 'Member sign-in returned an invalid response.')
    await this.saveCredential(parsed.data, await this.dependencies.credentialStore.load())
    return this.getDashboard()
  }

  private async currentCredential(): Promise<AiCommerceNativeCredential> {
    const credential = await this.dependencies.credentialStore.load()
    if (!credential) throw new AiCommerceRequestError('MEMBER_SIGN_IN_REQUIRED', 401, 'Please sign in to Member Center first.')
    if (Date.parse(credential.refreshTokenExpiresAt) <= this.now().getTime()) {
      await this.dependencies.credentialStore.clear()
      throw new AiCommerceRequestError('MEMBER_SESSION_EXPIRED', 401, 'Your Member Center session expired. Please sign in again.')
    }
    return credential
  }

  private async currentAccessToken(): Promise<{ credential: AiCommerceNativeCredential; accessToken: string }> {
    let credential = await this.currentCredential()
    if (Date.parse(credential.accessTokenExpiresAt) > this.now().getTime() + 60_000) {
      return { credential, accessToken: credential.accessToken }
    }
    const refreshed = await this.requestJson<unknown>('POST', `${this.configuration.membersBaseUrl}/api/native/refresh`, {}, {
      refresh_token: credential.refreshToken
    })
    if (refreshed.status !== 200) {
      await this.dependencies.credentialStore.clear()
      throw parseFailure(refreshed.status, refreshed.body, 'Your Member Center session could not be refreshed.')
    }
    const parsed = refreshSchema.safeParse(refreshed.body)
    if (!parsed.success) throw new AiCommerceRequestError('REFRESH_RESPONSE_INVALID', 502, 'Member Center returned an invalid refresh response.')
    credential = nativeCredentialSchema.parse({
      ...credential,
      accessToken: parsed.data.session.accessToken,
      accessTokenExpiresAt: parsed.data.session.accessTokenExpiresAt,
      refreshToken: parsed.data.session.refreshToken,
      refreshTokenExpiresAt: parsed.data.session.refreshTokenExpiresAt,
      updatedAt: this.now().toISOString()
    })
    await this.dependencies.credentialStore.save(credential)
    return { credential, accessToken: credential.accessToken }
  }

  private async resetAiToken(): Promise<AiCommerceNativeCredential> {
    if (this.aiTokenResetInFlight) return this.aiTokenResetInFlight
    this.aiTokenResetInFlight = this.issueAiTokenReset()
    try {
      return await this.aiTokenResetInFlight
    } finally {
      this.aiTokenResetInFlight = null
    }
  }

  private async issueAiTokenReset(): Promise<AiCommerceNativeCredential> {
    const { credential, accessToken } = await this.currentAccessToken()
    const reset = await this.requestJson<unknown>('POST', `${this.configuration.membersBaseUrl}/api/native/ai-token/reset`, {
      authorization: `Bearer ${accessToken}`
    }, {})
    if (reset.status !== 200) throw parseFailure(reset.status, reset.body, 'A new AI access token could not be issued.')
    const parsed = tokenResetSchema.safeParse(reset.body)
    if (!parsed.success) throw new AiCommerceRequestError('AI_TOKEN_RESET_INVALID', 502, 'Member Center returned an invalid AI token response.')
    const updated = nativeCredentialSchema.parse({
      ...credential,
      accountAiToken: parsed.data.token.accountAiToken,
      accountAiTokenExpiresAt: parsed.data.token.expiresAt,
      updatedAt: this.now().toISOString()
    })
    await this.dependencies.credentialStore.save(updated)
    return updated
  }

  private async requestAi<T>(method: string, path: string, body?: unknown): Promise<JsonHttpResponse<T>> {
    let credential = await this.currentCredential()
    const send = (token: string) => this.requestJson<T>(method, path, { authorization: `Bearer ${token}` }, body)
    let response = await send(credential.accountAiToken)
    if (response.status !== 401) return response
    credential = await this.resetAiToken()
    response = await send(credential.accountAiToken)
    return response
  }

  private async requestAiStream(path: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<Response> {
    const send = async (token: string): Promise<Response> => {
      try {
        return await this.dependencies.fetch(path, {
          method: 'POST',
          headers: {
            accept: 'text/event-stream',
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
            ...headers
          },
          body: JSON.stringify(body),
          redirect: 'error',
          signal
        })
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') {
          throw new AiCommerceStreamAttemptError('AI_STREAM_ABORTED', 0, 'The streamed AI response was stopped.', false)
        }
        throw new AiCommerceRequestError('NETWORK_ERROR', 0, 'The AI service could not be reached.')
      }
    }
    let credential = await this.currentCredential()
    let response = await send(credential.accountAiToken)
    if (response.status !== 401) return response
    credential = await this.resetAiToken()
    response = await send(credential.accountAiToken)
    return response
  }

  async getDashboard(): Promise<AiCommerceMembershipState> {
    const credential = await this.currentCredential()
    const [walletResult, capabilities] = await Promise.all([
      this.requestAi<unknown>('GET', `${this.configuration.aiCommerceBaseUrl}/v1/wallet`),
      this.loadCapabilities()
    ])
    if (walletResult.status !== 200) throw parseFailure(walletResult.status, walletResult.body, 'AI wallet details could not be loaded.')
    const wallet = walletSchema.safeParse(walletResult.body)
    if (!wallet.success) throw new AiCommerceRequestError('AI_DASHBOARD_INVALID', 502, 'AICommerce returned invalid wallet data.')
    return this.stateFromCredential(credential, false, {
      wallet: toWallet(wallet.data),
      capabilities: capabilities.map((capability) => ({
        alias: capability.capability_alias,
        displayName: capability.display_name ?? capability.capability_alias,
        modality: capability.modality ?? null
      })),
      refreshedAt: this.now().toISOString()
    })
  }

  private async loadCapabilities(): Promise<Array<z.infer<typeof capabilitySchema>>> {
    const response = await this.requestAi<unknown>('GET', `${this.configuration.aiCommerceBaseUrl}/v1/ai/capabilities?${new URLSearchParams({
      product_code: this.configuration.productCode, app_code: this.configuration.appCode
    })}`)
    if (response.status !== 200) throw parseFailure(response.status, response.body, 'AI capabilities could not be loaded.')
    const parsed = capabilitiesSchema.safeParse(response.body)
    if (!parsed.success) throw new AiCommerceRequestError('AI_CAPABILITIES_INVALID', 502, 'AICommerce returned invalid capability data.')
    return parsed.data.capabilities
  }

  static billingAttempts(mode: AiCommerceBillingMode): AiCommerceChargePool[] {
    return mode === 'automatic' ? ['subscription', 'standard'] : [mode]
  }

  static shouldFallbackToStandard(error: AiCommerceRequestError): boolean {
    return [
      'SUBSCRIPTION_QUOTA_POLICY_NOT_FOUND',
      'SUBSCRIPTION_QUOTA_POLICY_NOT_CONFIGURED',
      'SUBSCRIPTION_QUOTA_EXCEEDED'
    ].includes(error.code)
  }

  async requestText(content: string, suppliedOperationId?: string): Promise<AiCommerceTextResult> {
    const capabilities = await this.loadCapabilities()
    const capability = capabilities.find((item) =>
      item.status === 'active' && (item.request_type === 'chat' || item.modality === 'text')
    )
    if (!capability) {
      throw new AiCommerceRequestError('NO_ACTIVE_CHAT_CAPABILITY', 409, 'This product has no active text AI capability.')
    }
    const operationId = suppliedOperationId ?? `sesai-${randomUUID()}`
    if (!/^sesai-[A-Za-z0-9-]{8,160}$/u.test(operationId)) {
      throw new AiCommerceRequestError('REQUEST_ID_INVALID', 400, 'The AI request id is invalid.')
    }
    let lastError: AiCommerceRequestError | null = null
    for (const billingMode of AiCommerceNativeClient.billingAttempts(this.configuration.billingMode)) {
      const requestId = `${operationId}-${billingMode}`
      const requestBody = {
        app_code: this.configuration.appCode,
        product_code: this.configuration.productCode,
        request_id: requestId,
        billing_mode: billingMode,
        capability_alias: capability.capability_alias,
        input: { messages: [{ role: 'user', content }], max_tokens: 1000 },
        metadata: {
          feature: 'ses-agent-cloud-assist',
          request_origin: 'desktop',
          billing_policy: this.configuration.billingMode
        }
      }
      try {
        const initial = await this.requestAi<unknown>('POST', this.requestEndpoint, requestBody)
        return await this.resolveTextResponse(initial, requestId, billingMode)
      } catch (cause) {
        const error = cause instanceof AiCommerceRequestError
          ? cause
          : new AiCommerceRequestError('AI_REQUEST_FAILED', 502, 'AICommerce could not process this request.')
        lastError = error
        if (this.configuration.billingMode === 'automatic' && billingMode === 'subscription' &&
          AiCommerceNativeClient.shouldFallbackToStandard(error)) continue
        throw error
      }
    }
    throw lastError ?? new AiCommerceRequestError('NO_AVAILABLE_BILLING_POOL', 402, 'There is no available AI billing pool.')
  }

  async streamResponses(input: AiCommerceResponsesStreamInput): Promise<AiCommerceResponsesStreamResult> {
    const parsedInput = responsesStreamInputSchema.parse({
      model: input.model,
      instructions: input.instructions,
      input: input.input,
      maxOutputTokens: input.maxOutputTokens,
      operationId: input.operationId
    })
    return this.streamNativeText(input, parsedInput, this.responsesEndpoint, 'responses', {
      model: parsedInput.model,
      instructions: parsedInput.instructions,
      input: parsedInput.input,
      stream: true,
      max_output_tokens: parsedInput.maxOutputTokens
    })
  }

  async streamChatCompletions(input: AiCommerceChatCompletionsStreamInput): Promise<AiCommerceResponsesStreamResult> {
    const parsedInput = chatCompletionsStreamInputSchema.parse({
      model: input.model,
      instructions: input.instructions,
      input: input.input,
      maxOutputTokens: input.maxOutputTokens,
      operationId: input.operationId,
      provider: input.provider
    })
    return this.streamNativeText(input, parsedInput, this.chatCompletionsEndpoint(parsedInput.provider), 'chat-completions', {
      model: parsedInput.model,
      messages: [
        { role: 'system', content: parsedInput.instructions },
        { role: 'user', content: parsedInput.input }
      ],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: parsedInput.maxOutputTokens
    })
  }

  private async streamNativeText(
    input: AiCommerceResponsesStreamInput,
    parsedInput: z.infer<typeof responsesStreamInputSchema>,
    endpoint: string,
    protocol: 'responses' | 'chat-completions',
    requestBody: Record<string, unknown>
  ): Promise<AiCommerceResponsesStreamResult> {
    const operationId = parsedInput.operationId ?? randomUUID()
    let lastError: AiCommerceRequestError | null = null
    for (const billingMode of AiCommerceNativeClient.billingAttempts(this.configuration.billingMode)) {
      const clientRequestId = `ses-agent-${operationId}-${billingMode}-${randomUUID().slice(0, 8)}`
      input.onClientRequestId?.(clientRequestId)
      let receivedStreamContent = false
      try {
        const response = await this.requestAiStream(endpoint, {
          'x-aicommerce-app-code': this.configuration.appCode,
          'x-aicommerce-product-code': this.configuration.productCode,
          'x-aicommerce-billing-mode': billingMode,
          'X-Client-Request-ID': clientRequestId
        }, requestBody, input.signal)
        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as unknown
          throw parseFailure(response.status, payload, 'AICommerce could not start the event stream.')
        }
        const streamed = await parseNativeTextEventStream(response, protocol, input.onDelta, () => {
          receivedStreamContent = true
        })
        return {
          clientRequestId,
          responseId: streamed.responseId,
          content: streamed.content,
          billingModeUsed: billingMode
        }
      } catch (cause) {
        const error = cause instanceof AiCommerceRequestError
          ? cause
          : new AiCommerceRequestError('AI_STREAM_FAILED', 502, 'AICommerce could not stream the response.')
        lastError = error
        const attemptReceivedContent = receivedStreamContent ||
          (cause instanceof AiCommerceStreamAttemptError && cause.receivedStreamContent)
        if (this.configuration.billingMode === 'automatic' && billingMode === 'subscription' &&
          !attemptReceivedContent && AiCommerceNativeClient.shouldFallbackToStandard(error)) continue
        throw error
      }
    }
    throw lastError ?? new AiCommerceRequestError('NO_AVAILABLE_BILLING_POOL', 402, 'There is no available AI billing pool.')
  }

  async cancelClientRequest(clientRequestId: string): Promise<AiCommerceCancelResult> {
    if (!/^[A-Za-z0-9._-]{8,128}$/u.test(clientRequestId)) {
      throw new AiCommerceRequestError('REQUEST_ID_INVALID', 400, 'The AI client request id is invalid.')
    }
    const result = await this.requestAi<unknown>('POST',
      `${this.configuration.aiCommerceBaseUrl}/v1/ai/client-requests/${encodeURIComponent(clientRequestId)}/cancel`, {
        app_code: this.configuration.appCode,
        product_code: this.configuration.productCode
      })
    if (result.status !== 200) throw parseFailure(result.status, result.body, 'The AI stop request could not be recorded.')
    const parsed = cancelResponseSchema.safeParse(result.body)
    if (!parsed.success) {
      throw new AiCommerceRequestError('AI_CANCEL_RESPONSE_INVALID', 502, 'AICommerce returned an invalid stop status.')
    }
    return { clientRequestId, status: parsed.data.cancel_status ?? parsed.data.status! }
  }

  private async resolveTextResponse(
    initial: JsonHttpResponse<unknown>,
    requestId: string,
    billingModeUsed: AiCommerceChargePool
  ): Promise<AiCommerceTextResult> {
    let response = initial
    if (response.status !== 200 && response.status !== 202) {
      throw parseFailure(response.status, response.body, 'AICommerce could not process this request.')
    }
    let parsed = aiResponseSchema.safeParse(response.body)
    if (!parsed.success) throw new AiCommerceRequestError('AI_RESPONSE_INVALID', 502, 'AICommerce returned an invalid AI response.')
    const aiRequestId = parsed.data.ai_request_id
    for (let attempt = 0; response.status === 202 && attempt < 60; attempt += 1) {
      if (!aiRequestId) throw new AiCommerceRequestError('AI_REQUEST_ID_MISSING', 502, 'AICommerce did not return an async request ID.')
      await (this.dependencies.wait?.(1_000) ?? new Promise<void>((resolve) => setTimeout(resolve, 1_000)))
      response = await this.requestAi<unknown>('GET', `${this.configuration.aiCommerceBaseUrl}/v1/ai/requests/${encodeURIComponent(aiRequestId)}`)
      if (response.status !== 200 && response.status !== 202) {
        throw parseFailure(response.status, response.body, 'AICommerce could not finish this request.')
      }
      parsed = aiResponseSchema.safeParse(response.body)
      if (!parsed.success) throw new AiCommerceRequestError('AI_RESPONSE_INVALID', 502, 'AICommerce returned an invalid AI response.')
    }
    if (response.status === 202) {
      throw new AiCommerceRequestError('AI_REQUEST_STILL_PROCESSING', 202, 'The AI request is still processing. Please retry the same operation shortly.')
    }
    if (parsed.data.status === 'failed') {
      throw new AiCommerceRequestError('AI_REQUEST_FAILED', 502, 'The AI request failed without a usable response.')
    }
    const resultContent = parsed.data.output?.message?.content ?? parsed.data.output?.content ?? parsed.data.output?.text
    const resultRequestId = parsed.data.request_id ?? requestId
    const resultAiRequestId = parsed.data.ai_request_id ?? aiRequestId
    if (!resultContent || !resultAiRequestId) {
      throw new AiCommerceRequestError('AI_OUTPUT_MISSING', 502, 'AICommerce completed the request without text output.')
    }
    return {
      requestId: resultRequestId,
      aiRequestId: resultAiRequestId,
      content: resultContent,
      usageCredits: parsed.data.usage?.amount_credits ?? null,
      wallet: toWallet(parsed.data.wallet),
      billingModeUsed
    }
  }

  async resetAccountAiToken(): Promise<AiCommerceMembershipState> {
    await this.resetAiToken()
    return this.getDashboard()
  }

  async disconnect(): Promise<AiCommerceMembershipState> {
    const credential = await this.dependencies.credentialStore.load()
    try {
      if (credential) {
        await this.requestJson<unknown>('POST', `${this.configuration.membersBaseUrl}/api/native/logout`, {}, {
          refresh_token: credential.refreshToken
        })
      }
    } finally {
      await this.dependencies.credentialStore.clear()
      await this.dependencies.pendingAuthorizationStore.clear()
    }
    return this.getState()
  }
}
