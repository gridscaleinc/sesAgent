// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { LocalPersonNameDetectorPort, NameDetectionResult } from '@local-ai'
import type { CloudCallAuditContext, LocalPiiMapping, RedactedPayload, RedactionSessionEvidence } from '@privacy'
import { cloudAiPrivacyRuntimeMessages } from './cloud-ai-privacy'
import { CloudAiReviewService, type CloudPromptNativeReview } from './cloud-ai-review'
import type { CloudPrivacyGateBinding, CloudPrivacyGateSnapshot } from './privacy-gates'

const personName = '山田太郎'
const email = 'taro.yamada@example.com'
const phone = '090-1234-5678'
const content = `候補者 ${personName} さんの推薦文を作成してください。\n連絡先 ${email} / ${phone}\nJava と AWS の経験 5 年。`
const actor = 'operator-1'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function entitiesFor(text: string, names: string[]): NameDetectionResult['entities'] {
  return names.map((name) => {
    const start = text.indexOf(name)
    return { text: name, startUtf16: start, endUtf16: start + name.length, tag: 'personalName' as const }
  })
}

function detection(text: string, names: string[], networkAccess: boolean = false): NameDetectionResult {
  return {
    version: 'apple-nl-ner-v1',
    engine: 'apple-natural-language',
    networkAccess: networkAccess as false,
    requiresHumanConfirmation: true,
    entities: entitiesFor(text, names)
  }
}

const binding: CloudPrivacyGateBinding = {
  qualityReportHash: '1'.repeat(64),
  expertAttestationHash: '2'.repeat(64),
  privacyImplementationSha256: '3'.repeat(64),
  cloudEnforcementSha256: '4'.repeat(64)
}

function gates(
  status: 'passed' | 'not-verified' = 'passed',
  gateBinding: CloudPrivacyGateBinding | null = binding
): CloudPrivacyGateSnapshot {
  return {
    qualityGate: { status } as CloudPrivacyGateSnapshot['qualityGate'],
    expertGate: { status: 'passed' } as CloudPrivacyGateSnapshot['expertGate'],
    binding: gateBinding
  }
}

interface Harness {
  service: CloudAiReviewService<{ text: string }>
  saved: Array<{ session: RedactionSessionEvidence; mappings: LocalPiiMapping[] }>
  confirm: ReturnType<typeof vi.fn<(review: CloudPromptNativeReview) => Promise<boolean>>>
  invoke: ReturnType<
    typeof vi.fn<(payload: RedactedPayload, operationId: string, audit: CloudCallAuditContext) => Promise<{ text: string }>>
  >
  loadGates: ReturnType<typeof vi.fn<() => Promise<CloudPrivacyGateSnapshot>>>
  detectNames: ReturnType<typeof vi.fn<(text: string) => Promise<NameDetectionResult>>>
  clock: { now: Date }
}

function harness(options: { localNer?: 'none'; names?: string[] } = {}): Harness {
  const saved: Harness['saved'] = []
  const clock = { now: new Date('2026-09-01T00:00:00.000Z') }
  let counter = 0
  const detectNames = vi.fn(async (text: string) => detection(text, options.names ?? [personName]))
  const localNer: LocalPersonNameDetectorPort = { engine: 'apple-natural-language', detectNames }
  const confirm = vi.fn(async (_review: CloudPromptNativeReview) => true)
  const invoke = vi.fn(async (_payload: RedactedPayload, _operationId: string, _audit: CloudCallAuditContext) => ({ text: 'ok' }))
  const loadGates = vi.fn(async () => gates())
  const service = new CloudAiReviewService<{ text: string }>({
    repository: { saveRedactionSession: (session, mappings) => saved.push({ session, mappings }) },
    localNer: options.localNer === 'none' ? null : localNer,
    endpointId: 'aicommerce-cloud-assist',
    policyVersion: 'cloud-redaction-v2',
    loadGates,
    confirm,
    invoke,
    now: () => clock.now,
    idFactory: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
  })
  return { service, saved, confirm, invoke, loadGates, detectNames, clock }
}

function expectNoRawIdentifiers(value: string): void {
  expect(value).not.toContain(personName)
  expect(value).not.toContain(email)
  expect(value).not.toContain(phone)
}

describe('CloudAiReviewService.prepare', () => {
  it.each<[string, CloudPrivacyGateSnapshot, string]>([
    ['the quality gate is not verified', gates('not-verified'), cloudAiPrivacyRuntimeMessages.qualityGateNotVerified],
    ['the evidence is not bound', gates('passed', null), cloudAiPrivacyRuntimeMessages.qualityEvidenceNotBound]
  ])('refuses to prepare when %s', async (_label, snapshot, message) => {
    const h = harness()
    h.loadGates.mockResolvedValue(snapshot)
    await expect(h.service.prepare(content, actor)).rejects.toThrow(message)
    expect(h.detectNames).not.toHaveBeenCalled()
    expect(h.saved).toHaveLength(0)
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('refuses to prepare without a local name detector', async () => {
    const h = harness({ localNer: 'none' })
    await expect(h.service.prepare(content, actor)).rejects.toThrow(cloudAiPrivacyRuntimeMessages.localNerUnavailable)
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('refuses when the local name detector cannot prove network isolation', async () => {
    const h = harness()
    h.detectNames.mockImplementation(async (text) => detection(text, [personName], true))
    await expect(h.service.prepare(content, actor)).rejects.toThrow(/ネットワーク隔離/)
    expect(h.saved).toHaveLength(0)
  })

  it('returns a redacted preview with placeholders instead of names, emails and phone numbers', async () => {
    const h = harness()
    const prepared = await h.service.prepare(content, actor)
    expectNoRawIdentifiers(prepared.redactedPreview)
    expect(prepared.redactedPreview).toContain('<PERSON_NAME_001>')
    expect(prepared.redactedPreview).toContain('<PRIVATE_EMAIL_001>')
    expect(prepared.redactedPreview).toContain('<PHONE_001>')
    expect(prepared.redactedPreview).toContain('Java と AWS の経験 5 年')
    expect(prepared.removedIdentifierTypes).toEqual(expect.arrayContaining(['person_name', 'private_email', 'phone']))
    expect(prepared.previewHash).toBe(sha256(prepared.redactedPreview))
    expect(prepared.expiresAt).toBe('2026-09-01T00:10:00.000Z')
    // Evidence for the uncertain (awaiting human name review) session is recorded locally.
    expect(h.saved).toHaveLength(1)
    expect(h.saved[0]?.session.status).toBe('uncertain')
    expect(h.saved[0]?.mappings.map((mapping) => mapping.originalValue)).toEqual(expect.arrayContaining([personName, email, phone]))
    expect(h.invoke).not.toHaveBeenCalled()
    expect(h.confirm).not.toHaveBeenCalled()
  })

  it('redacts a name that the NER missed but a label reveals', async () => {
    const h = harness({ names: [] })
    const prepared = await h.service.prepare(`氏名：佐藤花子\nJava 5 年、${email}`, actor)
    expect(prepared.redactedPreview).not.toContain('佐藤花子')
    expect(prepared.redactedPreview).not.toContain(email)
  })

  it('fails closed on a residual identifier it cannot replace (bare postal code)', async () => {
    const h = harness()
    await expect(h.service.prepare(`${content}\n勤務地 150-0001 付近`, actor)).rejects.toThrow(/安全に脱敏できませんでした/)
    expect(h.saved[0]?.session.contentHash).toBeNull()
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('rejects empty content without calling the cloud', async () => {
    const h = harness({ names: [] })
    await expect(h.service.prepare('   ', actor)).rejects.toThrow()
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('rejects a second prepare while one is in flight', async () => {
    const h = harness()
    let release: (value: CloudPrivacyGateSnapshot) => void = () => {}
    h.loadGates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const first = h.service.prepare(content, actor)
    await expect(h.service.prepare(content, actor)).rejects.toThrow(/準備中/)
    release(gates())
    await expect(first).resolves.toMatchObject({ redactedPreview: expect.any(String) })
    // The lock is released afterwards.
    await expect(h.service.prepare(content, actor)).resolves.toBeTruthy()
  })

  it('replaces an older pending ticket for the same actor', async () => {
    const h = harness()
    const older = await h.service.prepare(content, actor)
    await h.service.prepare(content, actor)
    await expect(h.service.execute(older.reviewTicket, actor)).rejects.toThrow(/無効、期限切れ、または使用済み/)
  })
})

describe('CloudAiReviewService.execute', () => {
  it('sends only the redacted payload after confirmation, with audit hashes', async () => {
    const h = harness()
    const prepared = await h.service.prepare(content, actor)
    const result = await h.service.execute(prepared.reviewTicket, actor)

    expect(result.response).toEqual({ text: 'ok' })
    expect(result.removedIdentifierTypes).toEqual(expect.arrayContaining(['person_name', 'private_email', 'phone']))
    expect(h.confirm).toHaveBeenCalledOnce()
    expect(h.confirm.mock.calls[0]?.[0]).toEqual({
      redactedPreview: prepared.redactedPreview,
      previewHash: prepared.previewHash,
      removedIdentifierTypes: prepared.removedIdentifierTypes,
      expiresAt: prepared.expiresAt
    })
    expect(h.invoke).toHaveBeenCalledOnce()
    const [payload, operationId, audit] = h.invoke.mock.calls[0]!
    expect(payload.dlpStatus).toBe('passed')
    expect(payload.content).toBe(prepared.redactedPreview)
    expectNoRawIdentifiers(payload.content)
    expectNoRawIdentifiers(JSON.stringify(payload))
    expect(payload.contentHash).toBe(sha256(payload.content))
    expect(operationId).toMatch(/^sesai-/u)
    expect(audit).toEqual({
      qualityGateReportHash: binding.qualityReportHash,
      expertAttestationHash: binding.expertAttestationHash,
      reviewTicketHash: sha256(prepared.reviewTicket),
      gatePolicyVersion: 'cloud-redaction-v2'
    })
    expect(JSON.stringify(audit)).not.toContain(prepared.reviewTicket)
    // A passed session is persisted before the call.
    expect(h.saved.at(-1)?.session.status).toBe('passed')
  })

  it('cancels without contacting the cloud when the user declines, and consumes the ticket', async () => {
    const h = harness()
    h.confirm.mockResolvedValue(false)
    const prepared = await h.service.prepare(content, actor)
    await expect(h.service.execute(prepared.reviewTicket, actor)).rejects.toThrow(/キャンセル/)
    expect(h.invoke).not.toHaveBeenCalled()
    h.confirm.mockResolvedValue(true)
    await expect(h.service.execute(prepared.reviewTicket, actor)).rejects.toThrow(/無効、期限切れ、または使用済み/)
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('makes a ticket single-use', async () => {
    const h = harness()
    const prepared = await h.service.prepare(content, actor)
    await h.service.execute(prepared.reviewTicket, actor)
    await expect(h.service.execute(prepared.reviewTicket, actor)).rejects.toThrow(/使用済み/)
    expect(h.invoke).toHaveBeenCalledOnce()
  })

  it('rejects an unknown ticket', async () => {
    const h = harness()
    await expect(h.service.execute('not-a-ticket', actor)).rejects.toThrow(/無効/)
    expect(h.confirm).not.toHaveBeenCalled()
  })

  it('discards the ticket when another actor tries to use it', async () => {
    const h = harness()
    const prepared = await h.service.prepare(content, actor)
    await expect(h.service.execute(prepared.reviewTicket, 'operator-2')).rejects.toThrow(/実行コンテキストと一致しません/)
    await expect(h.service.execute(prepared.reviewTicket, actor)).rejects.toThrow(/使用済み/)
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('rejects a ticket after its ten minute lifetime', async () => {
    const h = harness()
    const prepared = await h.service.prepare(content, actor)
    h.clock.now = new Date('2026-09-01T00:10:00.000Z')
    await expect(h.service.execute(prepared.reviewTicket, actor)).rejects.toThrow(/期限切れ/)
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('rejects a ticket that expires while the confirmation dialog is open', async () => {
    const h = harness()
    const prepared = await h.service.prepare(content, actor)
    h.confirm.mockImplementation(async () => {
      h.clock.now = new Date('2026-09-01T00:11:00.000Z')
      return true
    })
    await expect(h.service.execute(prepared.reviewTicket, actor)).rejects.toThrow(/有効期限が切れました/)
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('stops when the privacy gate binding changes between preview and execution', async () => {
    const h = harness()
    const prepared = await h.service.prepare(content, actor)
    h.loadGates.mockResolvedValue(gates('passed', { ...binding, cloudEnforcementSha256: '9'.repeat(64) }))
    await expect(h.service.execute(prepared.reviewTicket, actor)).rejects.toThrow(/プライバシー評価が更新されました/)
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('stops when the gate changes while the user is confirming', async () => {
    const h = harness()
    const prepared = await h.service.prepare(content, actor)
    h.confirm.mockImplementation(async () => {
      h.loadGates.mockResolvedValue(gates('passed', { ...binding, qualityReportHash: '8'.repeat(64) }))
      return true
    })
    await expect(h.service.execute(prepared.reviewTicket, actor)).rejects.toThrow(/プライバシー評価が更新されました/)
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('stops when the quality gate stops passing before execution', async () => {
    const h = harness()
    const prepared = await h.service.prepare(content, actor)
    h.loadGates.mockResolvedValue(gates('not-verified'))
    await expect(h.service.execute(prepared.reviewTicket, actor)).rejects.toThrow(cloudAiPrivacyRuntimeMessages.qualityGateNotVerified)
    await expect(h.service.execute(prepared.reviewTicket, actor)).rejects.toThrow(/使用済み/)
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('stops when the name detector loses network isolation at execution time', async () => {
    const h = harness()
    const prepared = await h.service.prepare(content, actor)
    h.detectNames.mockImplementation(async (text) => detection(text, [personName], true))
    await expect(h.service.execute(prepared.reviewTicket, actor)).rejects.toThrow(/ネットワーク隔離/)
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('stops when the name detector reports a different result than the one the user reviewed', async () => {
    const h = harness()
    const prepared = await h.service.prepare(content, actor)
    h.detectNames.mockImplementation(async (text) => detection(text, [personName, 'Java']))
    await expect(h.service.execute(prepared.reviewTicket, actor)).rejects.toThrow(/変更されました/)
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('reuses the operation id when retrying the same redacted request after a provider failure', async () => {
    const h = harness()
    h.invoke.mockRejectedValueOnce(new Error('provider timeout'))
    const first = await h.service.prepare(content, actor)
    await expect(h.service.execute(first.reviewTicket, actor)).rejects.toThrow('provider timeout')
    const second = await h.service.prepare(content, actor)
    expect(second.reviewTicket).not.toBe(first.reviewTicket)
    await h.service.execute(second.reviewTicket, actor)
    expect(h.invoke).toHaveBeenCalledTimes(2)
    expect(h.invoke.mock.calls[1]?.[1]).toBe(h.invoke.mock.calls[0]?.[1])

    // After a success, a new request gets a new operation id.
    const third = await h.service.prepare(content, actor)
    await h.service.execute(third.reviewTicket, actor)
    expect(h.invoke.mock.calls[2]?.[1]).not.toBe(h.invoke.mock.calls[0]?.[1])
  })

  it('invalidates every pending ticket on dispose', async () => {
    const h = harness()
    const prepared = await h.service.prepare(content, actor)
    h.service.dispose()
    await expect(h.service.execute(prepared.reviewTicket, actor)).rejects.toThrow(/無効/)
    expect(h.invoke).not.toHaveBeenCalled()
  })
})
