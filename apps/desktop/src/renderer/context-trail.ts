import type { AgentSystemAccessBlock } from '@shared'

/** The most screens the right-hand workspace remembers; older ones fall off. */
const contextTrailLimit = 20

/**
 * What makes two accesses the same screen: the destination and the record
 * it shows. A tab (candidate view) or the picked case inside that screen is
 * not part of the key, so switching them replaces the screen rather than
 * stacking a copy the operator would have to step back through.
 */
export function contextScreenKey(access: AgentSystemAccessBlock): string {
  const record = access as unknown as Record<string, unknown>
  // The broadcast queue is one screen; the picked case inside it is focus, not navigation.
  const id = access.destination === 'broadcast' ? '' : record.sourceDocumentId ?? record.reviewId ?? record.intakeBatchId ?? ''
  return `${access.destination}:${String(id)}`
}

/** The trail after opening `access`: same screen replaces the top, another screen stacks on it. */
export function pushContextAccess(trail: readonly AgentSystemAccessBlock[], access: AgentSystemAccessBlock): AgentSystemAccessBlock[] {
  const current = trail[trail.length - 1]
  const base = current && contextScreenKey(current) === contextScreenKey(access) ? trail.slice(0, -1) : [...trail]
  return [...base, access].slice(-contextTrailLimit)
}
