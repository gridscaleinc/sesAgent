/** Counts only: safe to display without exposing mailbox content. */
export interface GmailBusinessIntakeResult {
  casesCreated: number
  casesConfirmed: number
  casesNeedAttention: number
  casesFailed: number
  personnelCreated: number
  personnelFailed: number
  pendingCases: number
  pendingPersonnel: number
}

export interface GmailSyncRunSummary {
  mode: 'baseline' | 'incremental' | 'bounded-rescan'
  discovered: number
  imported: number
  duplicates: number
  filtered: number
  failed: number
  moreAvailable?: boolean
  intake?: GmailBusinessIntakeResult
}

/** Persisted in the encrypted checkpoint; never sent to the renderer. */
export interface GmailSyncRunRecord extends GmailSyncRunSummary {
  continuation?: {
    mode: 'baseline' | 'bounded-rescan'
    pageToken: string
    historyId: string
    startedAt: string
  }
}
