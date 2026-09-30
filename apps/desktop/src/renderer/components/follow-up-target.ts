/** A person × case pair a follow-up opens on, with conditions carried over from matching. */
export interface FollowUpTarget {
  documentId: string
  reviewId: string
  pendingConditions?: string[]
}
