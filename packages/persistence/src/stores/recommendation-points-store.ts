import type { RecommendationPoint, RecommendationPointsRecord } from '@shared'
import { DomainStore } from './base'

interface RecommendationPointsRow {
  document_id: string
  review_id: string
  profile_version: number
  job_case_version: number
  locale: 'ja-JP' | 'zh-CN'
  points: string
  empty_reason: RecommendationPointsRecord['emptyReason']
  model_name: string | null
  generated_at: string
}

/**
 * 推荐要点 per person and case review: the latest generation only. Rows hold the locally validated points
 * (short AI prose plus verbatim fragments of the person's own material), never resume or mail text as such.
 * Deleting the person or the case review removes the row (foreign keys); version checks happen when read.
 */
export class RecommendationPointsStore extends DomainStore {
  /** Replaces the pair's previous points. A person or case deleted meanwhile is skipped, not re-created; returns whether it was stored. */
  save(record: RecommendationPointsRecord): boolean {
    const saved = this.database
      .prepare(
        `INSERT INTO recommendation_points(document_id, review_id, profile_version, job_case_version, locale, points, empty_reason, model_name, generated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM candidate_review_states WHERE document_id = ?)
           AND EXISTS (SELECT 1 FROM job_case_review_states WHERE review_id = ?)
         ON CONFLICT(document_id, review_id) DO UPDATE SET profile_version=excluded.profile_version,
           job_case_version=excluded.job_case_version, locale=excluded.locale, points=excluded.points,
           empty_reason=excluded.empty_reason, model_name=excluded.model_name, generated_at=excluded.generated_at`
      )
      .run(
        record.documentId,
        record.reviewId,
        record.profileVersion,
        record.jobCaseVersion,
        record.locale,
        JSON.stringify(record.points),
        record.emptyReason,
        record.modelName,
        record.generatedAt,
        record.documentId,
        record.reviewId
      )
    return saved.changes > 0
  }

  get(documentId: string, reviewId: string): RecommendationPointsRecord | null {
    const row = this.database
      .prepare<[string, string], RecommendationPointsRow>('SELECT * FROM recommendation_points WHERE document_id = ? AND review_id = ?')
      .get(documentId, reviewId)
    if (!row) return null
    return {
      documentId: row.document_id,
      reviewId: row.review_id,
      profileVersion: row.profile_version,
      jobCaseVersion: row.job_case_version,
      locale: row.locale,
      points: JSON.parse(row.points) as RecommendationPoint[],
      emptyReason: row.empty_reason,
      generatedAt: row.generated_at,
      modelName: row.model_name
    }
  }
}
