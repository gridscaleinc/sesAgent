import { describe, expect, it } from 'vitest'
import {
  requireCloudAiPrivacyRuntime,
  cloudAiPrivacyRuntimeMessages,
  validateCloudAiResponseForDisplay
} from '../apps/desktop/src/main/cloud-ai-privacy'

describe('Cloud AI privacy runtime gate', () => {
  it('allows the live cloud path when the synthetic quality gate and its implementation binding are ready', () => {
    const localNer = { engine: 'local-test-double' }
    expect(requireCloudAiPrivacyRuntime({
      qualityGateStatus: 'passed',
      qualityEvidenceBound: true,
      localNer
    })).toBe(localNer)
  })

  it('fails closed when the packaged privacy quality report is unavailable', () => {
    expect(() => requireCloudAiPrivacyRuntime({
      qualityGateStatus: 'not-verified',
      qualityEvidenceBound: true,
      localNer: { engine: 'local-test-double' }
    })).toThrow(cloudAiPrivacyRuntimeMessages.qualityGateNotVerified)
  })

  it('fails closed when synthetic quality evidence is not bound to the current implementation', () => {
    expect(() => requireCloudAiPrivacyRuntime({
      qualityGateStatus: 'passed',
      qualityEvidenceBound: false,
      localNer: { engine: 'local-test-double' }
    })).toThrow(cloudAiPrivacyRuntimeMessages.qualityEvidenceNotBound)
  })

  it('fails closed when local person-name detection is unavailable', () => {
    expect(() => requireCloudAiPrivacyRuntime({
      qualityGateStatus: 'passed',
      qualityEvidenceBound: true,
      localNer: null
    })).toThrow(cloudAiPrivacyRuntimeMessages.localNerUnavailable)
  })

  it('does not apply outbound resume PII rules to generated cloud responses', () => {
    const response = {
      content: '面接例として 090-0000-0000 や example@example.com の形式を説明し、React 19.0 の経験を確認してください。',
      requestId: 'request-001'
    }
    expect(validateCloudAiResponseForDisplay(response)).toBe(response)
  })

  it('still rejects malformed empty cloud responses', () => {
    expect(() => validateCloudAiResponseForDisplay({ content: '   ' })).toThrow('Cloud AI returned an empty response.')
  })
})
