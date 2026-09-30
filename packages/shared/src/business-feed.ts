import { z } from 'zod'
import type { CandidateFieldKey, JobCaseFieldKey } from './contracts'
import type { CandidateBusinessStatus } from './business-workbench'

export interface BusinessFeedEntry {
  kind: 'case' | 'person'
  objectId: string
  revision: string
  title: string
  event: 'created' | 'updated' | 'archived' | 'status-changed'
  occurredAt: string
  sourceAt: string
  source: string
  unseen: boolean
  deferred: boolean
  /** Cases only: the HR has this case in the set it is currently working on. Never set on an archived case. */
  working?: boolean
  archived: boolean
  businessStatus: CandidateBusinessStatus | 'active' | 'archived'
  needsReview: boolean
  fields: Array<{ key: CandidateFieldKey | JobCaseFieldKey; value: string }>
  changes: Array<{ key: string; before: string | null; after: string | null }>
}
export const markBusinessFeedSchema = z
  .object({
    kind: z.enum(['case', 'person']),
    objectId: z.string().uuid(),
    revision: z.string().regex(/^[a-f0-9]{64}$/u),
    action: z.enum(['seen', 'defer', 'done'])
  })
  .strict()
export type MarkBusinessFeedInput = z.infer<typeof markBusinessFeedSchema>
/** Adds a case to, or removes it from, the set the HR is currently working on. */
export const setCaseWorkingSchema = z.object({ reviewId: z.string().uuid(), working: z.boolean() }).strict()
export type SetCaseWorkingInput = z.infer<typeof setCaseWorkingSchema>

export function changedBusinessFields(
  before: ReadonlyArray<{ key: string; value: string | null }>,
  after: ReadonlyArray<{ key: string; value: string | null }>
): BusinessFeedEntry['changes'] {
  const previous = new Map(before.map((field) => [field.key, field.value]))
  return after
    .filter((field) => (previous.get(field.key) ?? null) !== field.value)
    .map((field) => ({ key: field.key, before: previous.get(field.key) ?? null, after: field.value }))
}
