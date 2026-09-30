import { cloudFailureReason } from '@shared'

/** The last time the AI gateway refused a cloud call for a reason the operator can fix (credits, sign-in). */
export interface AiGatewayRejection {
  reason: 'insufficient-credits' | 'sign-in-required'
  at: string
  modelKey: string
  modelName: string
}

let lastRejection: AiGatewayRejection | null = null
const listeners = new Set<() => void>()

const notify = () => {
  for (const listener of listeners) listener()
}

/**
 * Remembers a gateway refusal from any cloud call, in memory only. The wallet balance alone cannot say whether a
 * call fits: the gateway reserves per request by model price × max output, so an expensive model can be refused
 * with a large balance. Other failures (network, validation) change nothing.
 */
export function recordAiGatewayFailure(error: unknown, model: { key: string; displayName: string }, now = new Date()): void {
  const reason = cloudFailureReason(error)
  if (reason === 'request-failed') return
  lastRejection = { reason, at: now.toISOString(), modelKey: model.key, modelName: model.displayName }
  notify()
}

/** Any call the gateway accepted means the last refusal no longer applies. */
export function recordAiGatewaySuccess(): void {
  if (!lastRejection) return
  lastRejection = null
  notify()
}

export const currentAiGatewayRejection = (): AiGatewayRejection | null => lastRejection

export function onAiGatewaySignalChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resetAiGatewaySignal(): void {
  lastRejection = null
}
