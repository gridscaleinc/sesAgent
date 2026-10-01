import type { RequirementDecisionResult } from '@shared'

/**
 * HR decisions on unclear requirements reach every place showing the person's results through one window event:
 * the case's people panel replaces its assessments and the 找案件 cache its stored run, without a model call.
 */
export const requirementDecidedEvent = 'ses-requirement-decided'
export type RequirementDecidedDetail = RequirementDecisionResult & { documentId: string }

export function announceRequirementDecision(detail: RequirementDecidedDetail) {
  window.dispatchEvent(new CustomEvent<RequirementDecidedDetail>(requirementDecidedEvent, { detail }))
  // Lists, badges and 新匹配机会 re-read what changed.
  window.dispatchEvent(new Event('ses-business-data-changed'))
}

export function onRequirementDecision(listener: (detail: RequirementDecidedDetail) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<RequirementDecidedDetail>).detail)
  window.addEventListener(requirementDecidedEvent, handle)
  return () => window.removeEventListener(requirementDecidedEvent, handle)
}

/**
 * A requirement to show in 匹配依据: set by a click on a list chip or 「确认条件」, read by the table when it is
 * on screen (or as soon as it mounts), then cleared.
 */
const focusEvent = 'ses-focus-requirement'
let pendingFocus: string | null = null
export function focusRequirement(label: string) {
  pendingFocus = label
  window.dispatchEvent(new CustomEvent<string>(focusEvent, { detail: label }))
}
export function hasPendingRequirementFocus(): boolean {
  return pendingFocus !== null
}
export function takePendingRequirementFocus(): string | null {
  const label = pendingFocus
  pendingFocus = null
  return label
}
export function onRequirementFocus(listener: (label: string) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<string>).detail)
  window.addEventListener(focusEvent, handle)
  return () => window.removeEventListener(focusEvent, handle)
}
