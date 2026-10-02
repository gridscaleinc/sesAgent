import type { CommunicationPoint, CommunicationPointsRecord } from '@shared'
import { DomainStore } from './base'

interface CommunicationPointsRow {
  document_id: string
  review_id: string
  profile_version: number
  job_case_version: number
  locale: 'ja-JP' | 'zh-CN'
  points: string
  request: string | null
  model_name: string | null
  generated_at: string
}

/**
 * 沟通要点 per person and case review: the latest generation only. Rows hold the locally validated points (short AI
 * questions plus verbatim fragments of the case or the person's material), never resume or mail text as such.
 * Deleting the person or the case review removes the row (foreign keys); version checks happen when read.
 */
export class CommunicationPointsStore extends DomainStore {
  /** Replaces the pair's previous points. A person or case deleted meanwhile is skipped, not re-created; returns whether it was stored. */
  save(record: CommunicationPointsRecord): boolean {
    const saved = this.database
      .prepare(
        `INSERT INTO communication_points(document_id, review_id, profile_version, job_case_version, locale, points, request, model_name, generated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM candidate_review_states WHERE document_id = ?)
           AND EXISTS (SELECT 1 FROM job_case_review_states WHERE review_id = ?)
         ON CONFLICT(document_id, review_id) DO UPDATE SET profile_version=excluded.profile_version,
           job_case_version=excluded.job_case_version, locale=excluded.locale, points=excluded.points,
           request=excluded.request, model_name=excluded.model_name, generated_at=excluded.generated_at`
      )
      .run(
        record.documentId,
        record.reviewId,
        record.profileVersion,
        record.jobCaseVersion,
        record.locale,
        JSON.stringify(record.points),
        record.request,
        record.modelName,
        record.generatedAt,
        record.documentId,
        record.reviewId
      )
    return saved.changes > 0
  }

  get(documentId: string, reviewId: string): CommunicationPointsRecord | null {
    const row = this.database
      .prepare<[string, string], CommunicationPointsRow>('SELECT * FROM communication_points WHERE document_id = ? AND review_id = ?')
      .get(documentId, reviewId)
    if (!row) return null
    return {
      documentId: row.document_id,
      reviewId: row.review_id,
      profileVersion: row.profile_version,
      jobCaseVersion: row.job_case_version,
      locale: row.locale,
      points: JSON.parse(row.points) as CommunicationPoint[],
      request: row.request,
      generatedAt: row.generated_at,
      modelName: row.model_name
    }
  }
}
