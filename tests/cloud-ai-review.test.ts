import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { LocalPersonNameDetectorPort } from '@local-ai'
import type { CloudCallAuditContext, LocalPiiMapping, RedactedPayload, RedactionSessionEvidence } from '@privacy'
import { CloudAiReviewService } from '../apps/desktop/src/main/cloud-ai-review'
import type { CloudPrivacyGateSnapshot } from '../apps/desktop/src/main/privacy-gates'

const qualityReportHash = 'a'.repeat(64)
const expertAttestationHash = 'b'.repeat(64)
const privacyImplementationSha256 = 'c'.repeat(64)
const cloudEnforcementSha256 = 'd'.repeat(64)
const content = '候補者 山田太郎 / 090-1234-5678 / Java 8年'

function passedGates(overrides: Partial<CloudPrivacyGateSnapshot> = {}): CloudPrivacyGateSnapshot {
  return {
    qualityGate: {
      status: 'passed', datasetVersion: 'ses-privacy-regression-v1', syntheticOnly: true,
      caseCount: 28, identifierRecall: 1, redactionPrecision: 1, residualLeakCount: 0,
      safeCaseFalsePositiveCount: 0, appleNerVerified: true, reportHash: qualityReportHash,
      failureCodes: []
    },
    expertGate: {
      status: 'passed', datasetVersion: 'ses-privacy-expert-dataset-v1', humanLabeledDataset: true,
      sourceDocumentCount: 50, caseCount: 60, automaticPersonNameRecall: 0.93,
      postReviewIdentifierRecall: 1, redactionPrecision: 0.98,
      reviewedAt: '2026-08-17T00:00:00.000Z', evaluatedAt: '2026-08-17T01:00:00.000Z',
      reportHash: 'e'.repeat(64), attestationHash: expertAttestationHash,
      privacyImplementationSha256, cloudEnforcementSha256, failureCodes: []
    },
    binding: {
      qualityReportHash,
      expertAttestationHash,
      privacyImplementationSha256,
      cloudEnforcementSha256
    },
    ...overrides
  }
}

function localNer(): LocalPersonNameDetectorPort {
  return {
    engine: 'apple-natural-language',
    detectNames: vi.fn().mockResolvedValue({
      version: 'apple-nl-ner-v1',
      engine: 'apple-natural-language',
      networkAccess: false,
      requiresHumanConfirmation: true,
      entities: [{ text: '山田太郎', startUtf16: 4, endUtf16: 8, tag: 'personalName' }]
    })
  }
}

function createHarness(options: {
  gates?: () => Promise<CloudPrivacyGateSnapshot>
  confirm?: () => Promise<boolean>
  now?: () => Date
  localNer?: LocalPersonNameDetectorPort | null
} = {}) {
  const sessions: Array<{ session: RedactionSessionEvidence; mappings: LocalPiiMapping[] }> = []
  const invoke = vi.fn(async (
    payload: RedactedPayload,
    operationId: string,
    auditContext: CloudCallAuditContext
  ) => ({ payload, operationId, auditContext }))
  const confirm = vi.fn(options.confirm ?? (async () => true))
  const service = new CloudAiReviewService({
    repository: {
      saveRedactionSession(session, mappings) {
        sessions.push({ session, mappings })
      }
    },
    localNer: Object.hasOwn(options, 'localNer') ? options.localNer ?? null : localNer(),
    endpointId: 'aicommerce',
    policyVersion: 'cloud-redaction-v2',
    loadGates: options.gates ?? (async () => passedGates()),
    confirm,
    invoke,
    now: options.now,
    idFactory: randomUUID
  })
  return { service, sessions, invoke, confirm }
}

describe('CloudAiReviewService', () => {
  it('prepares only a redacted preview and never invokes the provider', async () => {
    const { service, sessions, invoke } = createHarness()
    const prepared = await service.prepare(content, 'operator-1')

    expect(prepared.reviewTicket).toMatch(/^[0-9a-f-]{36}$/u)
    expect(prepared.redactedPreview).toBe('候補者 <PERSON_NAME_001> / <PHONE_001> / Java 8年')
    expect(prepared.redactedPreview).not.toContain('山田太郎')
    expect(prepared.redactedPreview).not.toContain('090-1234-5678')
    expect(prepared.previewHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(sessions.at(-1)?.session.status).toBe('uncertain')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('keeps expert evidence optional and records a null attestation when it is unavailable', async () => {
    const gates = passedGates({
      expertGate: {
        ...passedGates().expertGate,
        status: 'not-verified',
        datasetVersion: null,
        attestationHash: null,
        failureCodes: ['expert:missing']
      },
      binding: {
        qualityReportHash,
        expertAttestationHash: null,
        privacyImplementationSha256,
        cloudEnforcementSha256
      }
    })
    const { service, confirm, invoke } = createHarness({ gates: async () => gates })

    const prepared = await service.prepare(content, 'operator-1')
    const executed = await service.execute(prepared.reviewTicket, 'operator-1')

    expect(executed.response.auditContext.expertAttestationHash).toBeNull()
    expect(confirm).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('fails closed before provider invocation when the synthetic gate or local NER is unavailable', async () => {
    const failedQuality = passedGates({
      qualityGate: {
        ...passedGates().qualityGate,
        status: 'not-verified', datasetVersion: null, failureCodes: ['quality:missing']
      },
      binding: null
    })
    const qualityHarness = createHarness({ gates: async () => failedQuality })
    await expect(qualityHarness.service.prepare(content, 'operator-1')).rejects.toThrow('品質ゲート')
    expect(qualityHarness.invoke).not.toHaveBeenCalled()

    const nerHarness = createHarness({ localNer: null })
    await expect(nerHarness.service.prepare(content, 'operator-1')).rejects.toThrow('氏名検出')
    expect(nerHarness.invoke).not.toHaveBeenCalled()
  })

  it('consumes a cancelled review ticket without invoking the provider', async () => {
    const { service, confirm, invoke } = createHarness({ confirm: async () => false })
    const prepared = await service.prepare(content, 'operator-1')

    await expect(service.execute(prepared.reviewTicket, 'operator-1')).rejects.toThrow('キャンセル')
    await expect(service.execute(prepared.reviewTicket, 'operator-1')).rejects.toThrow('無効、期限切れ、または使用済み')
    expect(confirm).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('keeps only one live review per actor and endpoint', async () => {
    const { service, invoke } = createHarness()
    const first = await service.prepare(content, 'operator-1')
    const second = await service.prepare('候補者 佐藤花子 / 080-1111-2222 / AWS 5年', 'operator-1')

    await expect(service.execute(first.reviewTicket, 'operator-1')).rejects.toThrow('無効、期限切れ、または使用済み')
    await expect(service.execute(second.reviewTicket, 'operator-1')).resolves.toBeDefined()
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('re-runs redaction after confirmation and binds provider audit evidence to the ticket', async () => {
    const { service, sessions, invoke } = createHarness()
    const prepared = await service.prepare(content, 'operator-1')
    const executed = await service.execute(prepared.reviewTicket, 'operator-1')

    expect(executed.removedIdentifierTypes).toEqual(['person_name', 'phone'])
    expect(executed.response.payload.content).toBe(prepared.redactedPreview)
    expect(executed.response.payload.content).not.toContain('山田太郎')
    expect(executed.response.auditContext).toEqual({
      qualityGateReportHash: qualityReportHash,
      expertAttestationHash,
      reviewTicketHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      gatePolicyVersion: 'cloud-redaction-v2'
    })
    expect(sessions.at(-1)?.session.status).toBe('passed')
    expect(invoke).toHaveBeenCalledOnce()
    await expect(service.execute(prepared.reviewTicket, 'operator-1')).rejects.toThrow('使用済み')
  })

  it('rejects actor changes before confirmation and consumes the ticket', async () => {
    const { service, confirm, invoke } = createHarness()
    const prepared = await service.prepare(content, 'operator-1')

    await expect(service.execute(prepared.reviewTicket, 'operator-2')).rejects.toThrow('実行コンテキスト')
    await expect(service.execute(prepared.reviewTicket, 'operator-1')).rejects.toThrow('使用済み')
    expect(confirm).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not invalidate a ticket when only optional expert evidence changes', async () => {
    const withoutExpert = passedGates({
      expertGate: {
        ...passedGates().expertGate,
        status: 'not-verified', datasetVersion: null, attestationHash: null,
        failureCodes: ['expert:missing']
      },
      binding: { ...passedGates().binding!, expertAttestationHash: null }
    })
    const loadGates = vi.fn()
      .mockResolvedValueOnce(passedGates())
      .mockResolvedValueOnce(withoutExpert)
      .mockResolvedValueOnce(withoutExpert)
    const { service, confirm, invoke } = createHarness({ gates: loadGates })
    const prepared = await service.prepare(content, 'operator-1')

    await expect(service.execute(prepared.reviewTicket, 'operator-1')).resolves.toBeDefined()
    expect(confirm).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('rechecks privacy evidence after native confirmation and immediately before provider invocation', async () => {
    const loadGates = vi.fn()
      .mockResolvedValueOnce(passedGates())
      .mockResolvedValueOnce(passedGates())
      .mockResolvedValueOnce(passedGates({
        binding: { ...passedGates().binding!, qualityReportHash: 'f'.repeat(64) }
      }))
    const { service, confirm, invoke } = createHarness({ gates: loadGates })
    const prepared = await service.prepare(content, 'operator-1')

    await expect(service.execute(prepared.reviewTicket, 'operator-1')).rejects.toThrow('評価が更新')
    expect(confirm).toHaveBeenCalledOnce()
    expect(loadGates).toHaveBeenCalledTimes(3)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects a ticket when the local detection summary changes after review preparation', async () => {
    const detectNames = vi.fn()
      .mockResolvedValueOnce({
        version: 'apple-nl-ner-v1', engine: 'apple-natural-language', networkAccess: false,
        requiresHumanConfirmation: true,
        entities: [{ text: '山田太郎', startUtf16: 4, endUtf16: 8, tag: 'personalName' }]
      })
      .mockResolvedValueOnce({
        version: 'apple-nl-ner-v1', engine: 'apple-natural-language', networkAccess: false,
        requiresHumanConfirmation: true,
        entities: []
      })
    const { service, invoke } = createHarness({
      localNer: { engine: 'apple-natural-language', detectNames }
    })
    const prepared = await service.prepare(content, 'operator-1')

    await expect(service.execute(prepared.reviewTicket, 'operator-1')).rejects.toThrow('識別子検出結果が変更')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('expires an unconfirmed ticket without invoking the provider', async () => {
    let now = new Date('2026-08-18T00:00:00.000Z')
    const { service, confirm, invoke } = createHarness({ now: () => now })
    const prepared = await service.prepare(content, 'operator-1')
    now = new Date('2026-08-18T00:11:00.000Z')

    await expect(service.execute(prepared.reviewTicket, 'operator-1')).rejects.toThrow('無効、期限切れ、または使用済み')
    expect(confirm).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })
})
