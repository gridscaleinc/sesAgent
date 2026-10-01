import { createHash } from 'node:crypto'
import type { JobCaseReviewSnapshot } from '@shared'

/**
 * Where the same EML file stands: the active case it already is (a duplicate), or the source key to store it under as
 * a new case. Each case source keeps one key (a unique index), so every re-import after an ended case takes the next
 * key derived from the mail's own; the ended cases keep theirs.
 */
export function emlReimport(
  sourceMessageKey: string,
  caseFor: (key: string) => JobCaseReviewSnapshot | null
): { duplicate: JobCaseReviewSnapshot } | { messageKey: string } {
  const keyFor = (round: number) =>
    round === 0 ? sourceMessageKey : `eml_${createHash('sha256').update(`${sourceMessageKey}:again:${round}`).digest('hex')}`
  for (let round = 0; ; round += 1) {
    const existing = caseFor(keyFor(round))
    if (!existing) return { messageKey: keyFor(round) }
    if (existing.lifecycle !== 'archived') return { duplicate: existing }
  }
}
