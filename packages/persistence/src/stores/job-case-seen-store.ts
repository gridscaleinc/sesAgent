import { type JobCaseSeenRow } from '../rows'
import { DomainStore } from './base'

/**
 * 今日新着案件: which arrivals the operator has already looked at. One row per
 * review, upserted, because "seen" is a current fact and not a history. Rows
 * disappear only through the review's foreign key cascade, so a deleted case
 * leaves no trace here either.
 */
export class JobCaseSeenStore extends DomainStore {
  markJobCaseReviewSeen(reviewId: string, seenAt: string): void {
    this.database
      .prepare(
        `INSERT INTO job_case_seen(review_id, seen_at) VALUES (?, ?)
         ON CONFLICT(review_id) DO UPDATE SET seen_at = excluded.seen_at`
      )
      .run(reviewId, seenAt)
  }

  listSeenJobCaseReviewIds(): string[] {
    return this.database
      .prepare<[], JobCaseSeenRow>('SELECT review_id, seen_at FROM job_case_seen')
      .all()
      .map((row) => row.review_id)
  }
}
