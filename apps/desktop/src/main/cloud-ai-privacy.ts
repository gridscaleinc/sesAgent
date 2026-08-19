export const cloudAiPrivacyRuntimeMessages = Object.freeze({
  qualityGateNotVerified: 'ローカルのプライバシー品質ゲートを確認できないため、Cloud AI を停止しました。データ安全画面で状態を確認してください。',
  qualityEvidenceNotBound: 'プライバシー品質証跡と現在の実装を結び付けられないため、Cloud AI を停止しました。',
  localNerUnavailable: 'Cloud AI を使うには、ローカルの氏名検出が利用可能である必要があります。'
})

interface CloudAiPrivacyRuntimeInput<T> {
  qualityGateStatus: 'passed' | 'not-verified'
  qualityEvidenceBound: boolean
  localNer: T | null
}

interface CloudAiTextResponse {
  content: string
}

export function requireCloudAiPrivacyRuntime<T>(input: CloudAiPrivacyRuntimeInput<T>): T {
  if (input.qualityGateStatus !== 'passed') {
    throw new Error(cloudAiPrivacyRuntimeMessages.qualityGateNotVerified)
  }
  if (!input.qualityEvidenceBound) {
    throw new Error(cloudAiPrivacyRuntimeMessages.qualityEvidenceNotBound)
  }
  if (input.localNer === null) {
    throw new Error(cloudAiPrivacyRuntimeMessages.localNerUnavailable)
  }
  return input.localNer
}

/**
 * Cloud output is untrusted generated text, but it is not an outbound privacy
 * boundary. Running resume-oriented identifier rules against it creates false
 * positives for professional names, version numbers and synthetic examples.
 * The renderer escapes the text and requires a human to apply suggestions, so
 * only the response shape is validated here; privacy enforcement remains on
 * the pre-send payload.
 */
export function validateCloudAiResponseForDisplay<T extends CloudAiTextResponse>(response: T): T {
  if (!response.content.trim()) throw new Error('Cloud AI returned an empty response.')
  return response
}
