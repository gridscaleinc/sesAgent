import { describe, expect, it, vi } from 'vitest'
import {
  AiCommerceNativeClient,
  AiCommerceRequestError,
  loadAiCommerceConfiguration,
  sesAiCommerceProductionDefaults,
  type AiCommerceCredentialStore,
  type AiCommerceNativeCredential,
  type AiCommercePendingAuthorization,
  type AiCommercePendingAuthorizationStore
} from './index'

const now = new Date('2026-07-21T00:00:00.000Z')

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function sseResponse(payload: string, chunkSizes: number[] = [1, 2, 5, 3, 8]): Response {
  const bytes = new TextEncoder().encode(payload)
  let offset = 0
  let chunkIndex = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      const size = chunkSizes[chunkIndex % chunkSizes.length] ?? 1
      chunkIndex += 1
      controller.enqueue(bytes.slice(offset, Math.min(bytes.length, offset + size)))
      offset += size
    }
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
}

function nonEndingSseResponse(payload: string): { response: Response; cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn()
  const bytes = new TextEncoder().encode(payload)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
    },
    cancel
  })
  return {
    response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } }),
    cancel
  }
}

function observableClosedSseResponse(payload: string): { response: Response; cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn()
  const bytes = new TextEncoder().encode(payload)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
    cancel
  })
  return {
    response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    cancel
  }
}

class MemoryCredentialStore implements AiCommerceCredentialStore {
  value: AiCommerceNativeCredential | null = null
  async load(): Promise<AiCommerceNativeCredential | null> { return this.value }
  async save(credential: AiCommerceNativeCredential): Promise<void> { this.value = credential }
  async clear(): Promise<void> { this.value = null }
}

class MemoryPendingStore implements AiCommercePendingAuthorizationStore {
  value: AiCommercePendingAuthorization | null = null
  async load(): Promise<AiCommercePendingAuthorization | null> { return this.value }
  async save(pending: AiCommercePendingAuthorization): Promise<void> { this.value = pending }
  async clear(): Promise<void> { this.value = null }
}

function connectedCredential(): AiCommerceNativeCredential {
  return {
    version: 'aicommerce-native-credential-v1',
    memberId: 'member-1', memberDisplayName: '営業担当', accountId: 'acct-1',
    accessToken: 'a'.repeat(32), accessTokenExpiresAt: '2026-07-21T02:00:00.000Z',
    refreshToken: 'b'.repeat(32), refreshTokenExpiresAt: '2026-10-21T00:00:00.000Z',
    accountAiToken: 'secret-account-ai-token-123456789', accountAiTokenExpiresAt: '2026-12-21T00:00:00.000Z',
    updatedAt: now.toISOString()
  }
}

function streamingClient(fetch: (input: string | URL, init?: RequestInit) => Promise<Response>): AiCommerceNativeClient {
  const credentialStore = new MemoryCredentialStore()
  credentialStore.value = connectedCredential()
  return new AiCommerceNativeClient(configuration(), {
    credentialStore,
    pendingAuthorizationStore: new MemoryPendingStore(),
    openExternal: vi.fn(),
    fetch,
    now: () => now
  })
}

function configuration() {
  const loaded = loadAiCommerceConfiguration({
    MEMBERS_BASE_URL: 'https://members.gridscale.com',
    AICOMMERCE_BASE_URL: 'https://aicommerce.gridscale.com',
    MEMBER_NATIVE_CLIENT_ID: 'ses-agent-desktop',
    AICOMMERCE_APP_CODE: 'ses-agent',
    AICOMMERCE_PRODUCT_CODE: 'ses-agent-pro',
    MEMBER_NATIVE_REDIRECT_URI: 'com.gridscale.native.ses-agent-desktop://auth/callback',
    AICOMMERCE_BILLING_MODE: 'automatic'
  })
  if (!loaded) throw new Error('Test configuration must be present.')
  return loaded
}

describe('AICommerce Native client', () => {
  it('parses real Responses SSE across arbitrary chunks, CRLF, and multiline data without exposing Authorization', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return sseResponse([
        'event: response.output_text.delta\r\n',
        'data: {"type":"response.output_text.delta",\r\n',
        'data: "delta":"案"}\r\n\r\n',
        'data: {"type":"response.output_text.delta","delta":"件です。"}\r\n\r\n',
        'data: {"type":"response.completed","response":{"id":"resp_123"}}\r\n\r\n'
      ].join(''))
    })
    const deltas: string[] = []
    const client = streamingClient(fetch)
    const result = await client.streamResponses({
      model: 'gpt-5.6-luna', instructions: '固定指示', input: '{"cases":[]}', maxOutputTokens: 512,
      operationId: 'operation-12345678', onDelta: (delta) => deltas.push(delta)
    })

    expect(deltas).toEqual(['案', '件です。'])
    expect(result).toMatchObject({ responseId: 'resp_123', content: '案件です。', billingModeUsed: 'subscription' })
    expect(calls[0]?.url).toBe('https://aicommerce.gridscale.com/v1/ai/native/openai/v1/responses')
    const headers = new Headers(calls[0]?.init?.headers)
    expect(headers.get('authorization')).toBe('Bearer secret-account-ai-token-123456789')
    expect(headers.get('x-aicommerce-app-code')).toBe('ses-agent')
    expect(headers.get('x-aicommerce-product-code')).toBe('ses-agent-pro')
    expect(headers.get('x-aicommerce-billing-mode')).toBe('subscription')
    expect(headers.get('x-client-request-id')).toBe(result.clientRequestId)
    expect(JSON.stringify(result)).not.toContain('secret-account-ai-token')
  })

  it('streams DeepSeek Chat Completions through AICommerce with the account token and native provider path', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return sseResponse([
        'data: {"id":"chatcmpl_ds","model":"deepseek-v4-flash","choices":[{"delta":{"reasoning_content":"internal"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl_ds","model":"deepseek-v4-flash","choices":[{"delta":{"content":"候補"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl_ds","model":"deepseek-v4-flash","choices":[{"delta":{"content":"です。"},"finish_reason":"stop"}]}\n\n',
        'data: {"id":"chatcmpl_ds","model":"deepseek-v4-flash","choices":[],"usage":{"prompt_tokens":8,"completion_tokens":4}}\n\n',
        'data: [DONE]\n\n'
      ].join(''), [2, 1, 7, 3, 11])
    })
    const deltas: string[] = []
    const client = streamingClient(fetch)
    const result = await client.streamChatCompletions({
      provider: 'deepseek', model: 'deepseek-v4-flash', instructions: '固定指示', input: '{"cases":[]}',
      maxOutputTokens: 4_096, operationId: 'deepseek-operation', onDelta: (delta) => deltas.push(delta)
    })

    expect(deltas).toEqual(['候補', 'です。'])
    expect(result).toMatchObject({ responseId: 'chatcmpl_ds', content: '候補です。', billingModeUsed: 'subscription' })
    expect(calls[0]?.url).toBe('https://aicommerce.gridscale.com/v1/ai/native/deepseek/v1/chat/completions')
    const headers = new Headers(calls[0]?.init?.headers)
    expect(headers.get('authorization')).toBe('Bearer secret-account-ai-token-123456789')
    expect(headers.get('x-aicommerce-app-code')).toBe('ses-agent')
    expect(headers.get('x-aicommerce-product-code')).toBe('ses-agent-pro')
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'deepseek-v4-flash', stream: true, max_tokens: 4_096,
      stream_options: { include_usage: true }
    })
    expect(body).not.toHaveProperty('api_key')
    expect(JSON.stringify(result)).not.toContain('secret-account-ai-token')
    expect(() => client.chatCompletionsEndpoint('https://evil.invalid' as never)).toThrow()
  })

  it('rejects incomplete DeepSeek streams instead of presenting partial text as complete', async () => {
    const client = streamingClient(async () => sseResponse(
      'data: {"id":"chatcmpl_partial","choices":[{"delta":{"content":"半截"},"finish_reason":"length"}]}\n\n'
    ))
    await expect(client.streamChatCompletions({
      provider: 'deepseek', model: 'deepseek-v4-flash', instructions: '固定指示', input: '{}',
      maxOutputTokens: 4_096, onDelta: vi.fn()
    })).rejects.toMatchObject({ code: 'AI_RESPONSE_INCOMPLETE' })
  })

  it('waits for natural EOF after completed and does not cancel a normal Responses stream', async () => {
    const normal = observableClosedSseResponse([
      'data: {"type":"response.output_text.delta","delta":"正常"}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp_natural_eof"}}\n\n',
      ': settlement may finish before close\n\n',
      'data: [DONE]\n\n'
    ].join(''))
    const client = streamingClient(async () => normal.response)

    await expect(client.streamResponses({
      model: 'gpt-5.6-luna', instructions: '固定指示', input: '{}', maxOutputTokens: 512,
      onDelta: vi.fn()
    })).resolves.toMatchObject({ responseId: 'resp_natural_eof', content: '正常' })
    expect(normal.cancel).not.toHaveBeenCalled()
  })

  it('rejects non-SSE success responses and does not reveal response payloads', async () => {
    const client = streamingClient(async () => response({ output: 'pretend stream', token: 'do-not-log' }))
    await expect(client.streamResponses({
      model: 'gpt-5.6-luna', instructions: '固定指示', input: '{}', maxOutputTokens: 512,
      onDelta: vi.fn()
    })).rejects.toMatchObject({ code: 'AI_STREAM_CONTENT_TYPE_INVALID' })

    const lookalike = streamingClient(async () => new Response('{}', {
      status: 200, headers: { 'content-type': 'text/event-stream-json; charset=utf-8' }
    }))
    await expect(lookalike.streamResponses({
      model: 'gpt-5.6-luna', instructions: '固定指示', input: '{}', maxOutputTokens: 512,
      onDelta: vi.fn()
    })).rejects.toMatchObject({ code: 'AI_STREAM_CONTENT_TYPE_INVALID' })
  })

  it('cancels a non-ending response body before rethrowing parser or delta consumer errors', async () => {
    const invalid = nonEndingSseResponse('data: {invalid-json}\n\n')
    const invalidClient = streamingClient(async () => invalid.response)
    await expect(invalidClient.streamResponses({
      model: 'gpt-5.6-luna', instructions: '固定指示', input: '{}', maxOutputTokens: 512,
      onDelta: vi.fn()
    })).rejects.toMatchObject({ code: 'AI_STREAM_EVENT_INVALID' })
    expect(invalid.cancel).toHaveBeenCalledTimes(1)

    const consumerFailure = nonEndingSseResponse('data: {"type":"response.output_text.delta","delta":"overflow"}\n\n')
    const consumerClient = streamingClient(async () => consumerFailure.response)
    await expect(consumerClient.streamResponses({
      model: 'gpt-5.6-luna', instructions: '固定指示', input: '{}', maxOutputTokens: 512,
      onDelta: () => { throw new Error('consumer limit') }
    })).rejects.toMatchObject({ code: 'AI_STREAM_READ_FAILED' })
    expect(consumerFailure.cancel).toHaveBeenCalledTimes(1)
  })

  it('fails closed on data after a completed terminal event', async () => {
    const client = streamingClient(async () => sseResponse([
      'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp_terminal"}}\n\n',
      'data: {"type":"response.output_text.delta","delta":"late"}\n\n'
    ].join(''), [10_000]))
    await expect(client.streamResponses({
      model: 'gpt-5.6-luna', instructions: '固定指示', input: '{}', maxOutputTokens: 512,
      onDelta: vi.fn()
    })).rejects.toMatchObject({ code: 'AI_STREAM_EVENT_AFTER_TERMINAL' })
  })

  it('falls back with a fresh client request id only before an SSE stream starts', async () => {
    const requestIds: string[] = []
    const modes: string[] = []
    const client = streamingClient(async (_input, init) => {
      const headers = new Headers(init?.headers)
      requestIds.push(headers.get('x-client-request-id') ?? '')
      modes.push(headers.get('x-aicommerce-billing-mode') ?? '')
      if (modes.length === 1) return response({ error: { code: 'SUBSCRIPTION_QUOTA_EXCEEDED' } }, 429)
      return sseResponse('data: {"type":"response.output_text.delta","delta":"ok"}\n\ndata: {"type":"response.completed","response":{"id":"resp_ok"}}\n\n')
    })
    const result = await client.streamResponses({
      model: 'gpt-5.6-luna', instructions: '固定指示', input: '{}', maxOutputTokens: 512,
      operationId: 'fallback-operation', onDelta: vi.fn()
    })
    expect(modes).toEqual(['subscription', 'standard'])
    expect(new Set(requestIds).size).toBe(2)
    expect(result.billingModeUsed).toBe('standard')

    const streamedModes: string[] = []
    const streamedErrorClient = streamingClient(async (_input, init) => {
      streamedModes.push(new Headers(init?.headers).get('x-aicommerce-billing-mode') ?? '')
      return sseResponse('data: {"type":"error","code":"SUBSCRIPTION_QUOTA_EXCEEDED"}\n\n')
    })
    await expect(streamedErrorClient.streamResponses({
      model: 'gpt-5.6-luna', instructions: '固定指示', input: '{}', maxOutputTokens: 512,
      onDelta: vi.fn()
    })).rejects.toMatchObject({ code: 'SUBSCRIPTION_QUOTA_EXCEEDED' })
    expect(streamedModes).toEqual(['subscription'])
  })

  it.each(['cancel_requested', 'canceled', 'too_late'] as const)('preserves the remote cancel status %s', async (status) => {
    let body: unknown
    const client = streamingClient(async (input, init) => {
      expect(String(input)).toContain('/v1/ai/client-requests/client-request-123/cancel')
      body = JSON.parse(String(init?.body))
      return response({ cancel_status: status })
    })
    await expect(client.cancelClientRequest('client-request-123')).resolves.toEqual({
      clientRequestId: 'client-request-123', status
    })
    expect(body).toEqual({ app_code: 'ses-agent', product_code: 'ses-agent-pro' })
  })

  it('uses the issued SES production identity without changing code casing', () => {
    expect(loadAiCommerceConfiguration({})).toEqual({
      membersBaseUrl: 'https://members.gridscale.com',
      aiCommerceBaseUrl: 'https://aicommerce.gridscale.com',
      clientId: 'ses-agent',
      appCode: 'sesagent',
      productCode: 'sesAgent',
      redirectUri: 'com.gridscale.native.ses-agent://auth/callback',
      billingMode: 'automatic'
    })
    expect(sesAiCommerceProductionDefaults.AICOMMERCE_APP_CODE).toBe('sesagent')
  })

  it('persists pending PKCE state before opening the browser and completes after a client restart', async () => {
    const credentialStore = new MemoryCredentialStore()
    const pendingAuthorizationStore = new MemoryPendingStore()
    const openedUrls: string[] = []
    const fetch = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.endsWith('/api/native/token')) {
        return response({
          ok: true,
          member: { id: 'member-1', displayName: '営業担当' },
          session: {
            accessToken: 'a'.repeat(32), accessTokenExpiresAt: '2026-07-21T02:00:00.000Z',
            refreshToken: 'b'.repeat(32), refreshTokenExpiresAt: '2026-10-21T00:00:00.000Z'
          },
          token: { accountId: 'acct-1', accountAiToken: 'c'.repeat(32), expiresAt: '2026-12-21T00:00:00.000Z' }
        })
      }
      if (url.endsWith('/v1/wallet')) return response({ balance_credits: 1200, reserved_credits: 200 })
      if (url.includes('/v1/ai/capabilities?')) {
        return response({ capabilities: [{
          capability_alias: 'openai-chat', request_type: 'chat', display_name: 'OpenAI Chat', modality: 'text', status: 'active'
        }] })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const dependencies = {
      credentialStore,
      pendingAuthorizationStore,
      openExternal: async (url: string) => { openedUrls.push(url) },
      fetch,
      now: () => now
    }
    const firstProcess = new AiCommerceNativeClient(configuration(), dependencies)

    const authorizing = await firstProcess.beginConnect()
    const pending = pendingAuthorizationStore.value
    expect(authorizing.connection).toBe('authorizing')
    expect(pending).not.toBeNull()
    if (!pending) throw new Error('Pending authorization was not persisted.')

    const authorizationUrl = new URL(openedUrls[0] ?? '')
    expect(authorizationUrl.pathname).toBe('/api/native/authorize')
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorizationUrl.searchParams.get('state')).toBe(pending.state)

    const restartedProcess = new AiCommerceNativeClient(configuration(), dependencies)
    const state = await restartedProcess.completeConnect(
      `com.gridscale.native.ses-agent-desktop://auth/callback?code=native-auth-code&state=${pending.state}`
    )
    expect(pendingAuthorizationStore.value).toBeNull()
    expect(state).toMatchObject({
      connection: 'connected', memberDisplayName: '営業担当',
      wallet: { balanceCredits: 1200, reservedCredits: 200 },
      capabilities: [{ alias: 'openai-chat', displayName: 'OpenAI Chat', modality: 'text' }]
    })
  })

  it('refreshes an invalid AI token and uses automatic subscription-to-wallet fallback only for quota errors', async () => {
    const credentialStore = new MemoryCredentialStore()
    const pendingAuthorizationStore = new MemoryPendingStore()
    credentialStore.value = {
      version: 'aicommerce-native-credential-v1',
      memberId: 'member-1', memberDisplayName: '営業担当', accountId: 'acct-1',
      accessToken: 'a'.repeat(32), accessTokenExpiresAt: '2026-07-21T02:00:00.000Z',
      refreshToken: 'b'.repeat(32), refreshTokenExpiresAt: '2026-10-21T00:00:00.000Z',
      accountAiToken: 'old-account-token-value-123456789', accountAiTokenExpiresAt: '2026-12-21T00:00:00.000Z',
      updatedAt: now.toISOString()
    }
    const requestBodies: Array<Record<string, unknown>> = []
    let capabilityAttempts = 0
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/native/ai-token/reset')) {
        return response({ ok: true, token: { accountAiToken: 'new-account-token-value-123456789', expiresAt: '2026-12-22T00:00:00.000Z' } })
      }
      if (url.includes('/v1/ai/capabilities?')) {
        capabilityAttempts += 1
        return capabilityAttempts === 1
          ? response({ error: { code: 'TOKEN_REVOKED' } }, 401)
          : response({ capabilities: [{
              capability_alias: 'openai-chat', request_type: 'chat', display_name: 'OpenAI Chat', modality: 'text', status: 'active'
            }] })
      }
      if (url.endsWith('/v1/ai/requests')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        requestBodies.push(body)
        return body.billing_mode === 'subscription'
          ? response({ error: { code: 'SUBSCRIPTION_QUOTA_EXCEEDED', message: 'quota' } }, 429)
          : response({ request_id: body.request_id, ai_request_id: 'air-1', status: 'queued' }, 202)
      }
      if (url.endsWith('/v1/ai/requests/air-1')) {
        return response({
          request_id: requestBodies.at(-1)?.request_id,
          ai_request_id: 'air-1', status: 'succeeded',
          output: { message: { content: '脱敏済みの応答です。' } },
          usage: { amount_credits: 12 }, wallet: { balance_credits: 1188, reserved_credits: 0 }
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const client = new AiCommerceNativeClient(configuration(), {
      credentialStore,
      pendingAuthorizationStore,
      openExternal: vi.fn(),
      fetch,
      now: () => now,
      wait: vi.fn().mockResolvedValue(undefined)
    })

    const result = await client.requestText('候補者は <PERSON_NAME_001> です。', 'sesai-operation-12345678')

    expect(requestBodies.map((body) => body.billing_mode)).toEqual(['subscription', 'standard'])
    expect(requestBodies.map((body) => body.request_id)).toEqual([
      'sesai-operation-12345678-subscription',
      'sesai-operation-12345678-standard'
    ])
    expect(result).toEqual({
      requestId: 'sesai-operation-12345678-standard',
      aiRequestId: 'air-1', content: '脱敏済みの応答です。', usageCredits: 12,
      wallet: { balanceCredits: 1188, reservedCredits: 0 }, billingModeUsed: 'standard'
    })
    expect(credentialStore.value?.accountAiToken).toBe('new-account-token-value-123456789')
  })

  it('never falls back to wallet for token failures', async () => {
    const credentialStore = new MemoryCredentialStore()
    credentialStore.value = {
      version: 'aicommerce-native-credential-v1',
      memberId: 'member-1', memberDisplayName: '営業担当', accountId: 'acct-1',
      accessToken: 'a'.repeat(32), accessTokenExpiresAt: '2026-07-21T02:00:00.000Z',
      refreshToken: 'b'.repeat(32), refreshTokenExpiresAt: '2026-10-21T00:00:00.000Z',
      accountAiToken: 'old-account-token-value-123456789', accountAiTokenExpiresAt: '2026-12-21T00:00:00.000Z',
      updatedAt: now.toISOString()
    }
    const attemptedBillingModes: string[] = []
    const client = new AiCommerceNativeClient(configuration(), {
      credentialStore,
      pendingAuthorizationStore: new MemoryPendingStore(),
      openExternal: vi.fn(),
      now: () => now,
      fetch: vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/v1/ai/capabilities?')) {
          return response({ capabilities: [{
            capability_alias: 'openai-chat', request_type: 'chat', display_name: 'OpenAI Chat', modality: 'text', status: 'active'
          }] })
        }
        if (url.endsWith('/api/native/ai-token/reset')) {
          return response({ ok: true, token: { accountAiToken: 'new-account-token-value-123456789', expiresAt: '2026-12-22T00:00:00.000Z' } })
        }
        if (url.endsWith('/v1/ai/requests')) {
          const body = JSON.parse(String(init?.body)) as { billing_mode: string }
          attemptedBillingModes.push(body.billing_mode)
          return response({ error: { code: 'TOKEN_REVOKED', message: 'token' } }, 401)
        }
        throw new Error(`Unexpected request: ${url}`)
      })
    })

    expect(AiCommerceNativeClient.billingAttempts('automatic')).toEqual(['subscription', 'standard'])
    await expect(client.requestText('脱敏済み', 'sesai-operation-87654321')).rejects.toMatchObject({
      code: 'TOKEN_REVOKED', status: 401
    })
    expect(attemptedBillingModes).toEqual(['subscription', 'subscription'])
    expect(AiCommerceNativeClient.shouldFallbackToStandard(new AiCommerceRequestError('TOKEN_REVOKED', 401, 'token'))).toBe(false)
  })
})
