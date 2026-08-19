import { createHash, randomUUID } from 'node:crypto'
import { candidateBenchmarkQueryFromJobCase, confirmedJobCaseSchema } from '@job-cases'
import { detectDirectIdentifiers } from '@privacy'
import { candidateProfileSchema } from '@resume'
import {
  candidateEvaluationDraftSchema,
  candidateEvaluationReportSchema,
  candidateEvaluationStateSchema,
  createCandidateEvaluationDraftInputSchema,
  deleteCandidateEvaluationDraftCaseInputSchema,
  saveCandidateEvaluationDraftCaseInputSchema,
  sesCandidateBenchmarkSchema
} from '@shared'
import {
  type CandidateEvaluationDraft,
  type CandidateEvaluationReport,
  type CandidateEvaluationState,
  type CreateCandidateEvaluationDraftInput,
  type DeleteCandidateEvaluationDraftCaseInput,
  type SaveCandidateEvaluationDraftCaseInput,
  type SesCandidateBenchmark
} from '@shared/contracts'
import {
  type CandidateEvaluationDatasetRow,
  type CandidateEvaluationDraftCaseRow,
  type CandidateEvaluationDraftLabelRow,
  type CandidateEvaluationDraftRow,
  type CandidateEvaluationReportRow,
  type JobCaseRow
} from '../rows'
import { DomainStore } from './base'

export class CandidateEvaluationStore extends DomainStore {
  private candidateEvaluationDraftFromRow(row: CandidateEvaluationDraftRow): CandidateEvaluationDraft {
    const caseRows = this.database
      .prepare<[string], CandidateEvaluationDraftCaseRow>(
        `SELECT draft_case.id, draft_case.draft_id, draft_case.job_case_id,
                draft_case.job_case_version, draft_case.job_case_title, draft_case.query_text,
                draft_case.pool_reviewed, draft_case.reviewer_id,
                draft_case.reviewer_display_name, draft_case.reviewed_at,
                job.status AS job_case_status, lifecycle.state AS job_case_lifecycle
         FROM candidate_evaluation_draft_cases draft_case
         JOIN job_cases job ON job.id = draft_case.job_case_id
         LEFT JOIN job_case_lifecycle lifecycle ON lifecycle.source_review_id = job.source_review_id
         WHERE draft_case.draft_id = ?
         ORDER BY draft_case.reviewed_at DESC, draft_case.id`
      )
      .all(row.id)
    const labelRows = this.database
      .prepare<[string], CandidateEvaluationDraftLabelRow>(
        `SELECT label.case_id, label.candidate_profile_id, label.candidate_profile_version,
                label.expected_project_evidence, profile.profile_json,
                profile.status AS profile_status, membership.status AS talent_pool_status
         FROM candidate_evaluation_draft_labels label
         JOIN candidate_evaluation_draft_cases draft_case ON draft_case.id = label.case_id
         JOIN candidate_profiles profile ON profile.id = label.candidate_profile_id
         LEFT JOIN talent_pool_memberships membership ON membership.source_document_id = profile.source_document_id
         WHERE draft_case.draft_id = ?
         ORDER BY label.case_id, label.candidate_profile_id`
      )
      .all(row.id)
    const labelsByCase = new Map<string, CandidateEvaluationDraftLabelRow[]>()
    for (const label of labelRows) {
      const labels = labelsByCase.get(label.case_id) ?? []
      labels.push(label)
      labelsByCase.set(label.case_id, labels)
    }
    const cases = caseRows.map((draftCase) => {
      const relevantCandidates = (labelsByCase.get(draftCase.id) ?? []).map((label) => {
        const profile = candidateProfileSchema.parse(JSON.parse(label.profile_json))
        const active = label.profile_status === 'current' &&
          label.talent_pool_status === 'eligible' &&
          profile.profileVersion === label.candidate_profile_version
        return {
          profileId: label.candidate_profile_id,
          profileVersion: label.candidate_profile_version,
          anonymousLabel: `候補者 ${label.candidate_profile_id.slice(0, 8).toLocaleUpperCase('en-US')}`,
          expectedProjectEvidence: label.expected_project_evidence === 1,
          status: active ? 'active' as const : 'stale' as const
        }
      })
      const jobCaseActive = draftCase.job_case_status === 'active' &&
        (draftCase.job_case_lifecycle ?? 'active') === 'active'
      const status = !jobCaseActive
        ? 'job-case-stale' as const
        : relevantCandidates.length === 0
          ? 'no-relevant-candidates' as const
          : relevantCandidates.some((candidate) => candidate.status === 'stale')
            ? 'candidate-stale' as const
            : 'ready' as const
      return {
        id: draftCase.id,
        jobCaseId: draftCase.job_case_id,
        jobCaseVersion: draftCase.job_case_version,
        jobCaseTitle: draftCase.job_case_title,
        query: draftCase.query_text,
        poolReviewed: true as const,
        reviewerDisplayName: draftCase.reviewer_display_name,
        reviewedAt: draftCase.reviewed_at,
        status,
        relevantCandidates
      }
    })
    const reviewers = new Set(cases.map((draftCase) => draftCase.reviewerDisplayName))
    return candidateEvaluationDraftSchema.parse({
      id: row.id,
      name: row.name,
      revision: row.revision,
      caseCount: cases.length,
      readyCaseCount: cases.filter((draftCase) => draftCase.status === 'ready').length,
      reviewerCount: reviewers.size,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      cases
    })
  }

  private getCandidateEvaluationDraftById(draftId: string): CandidateEvaluationDraft | null {
    const row = this.database
      .prepare<[string], CandidateEvaluationDraftRow>(
        'SELECT id, name, revision, created_at, updated_at FROM candidate_evaluation_drafts WHERE id = ?'
      )
      .get(draftId)
    return row ? this.candidateEvaluationDraftFromRow(row) : null
  }

  getCandidateEvaluationDraft(): CandidateEvaluationDraft | null {
    const row = this.database
      .prepare<[], CandidateEvaluationDraftRow>(
        'SELECT id, name, revision, created_at, updated_at FROM candidate_evaluation_drafts ORDER BY updated_at DESC LIMIT 1'
      )
      .get()
    return row ? this.candidateEvaluationDraftFromRow(row) : null
  }

  createCandidateEvaluationDraft(
    rawInput: CreateCandidateEvaluationDraftInput,
    now = new Date()
  ): CandidateEvaluationDraft {
    const input = createCandidateEvaluationDraftInputSchema.parse(rawInput)
    if (detectDirectIdentifiers(input.name).length > 0) {
      throw new Error('評価セット名に個人識別情報を含めることはできません。')
    }
    const timestamp = now.toISOString()
    const draftId = randomUUID()
    this.database
      .prepare(
        `INSERT INTO candidate_evaluation_drafts(id, name, revision, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?)`
      )
      .run(draftId, input.name, timestamp, timestamp)
    const draft = this.getCandidateEvaluationDraftById(draftId)
    if (!draft) throw new Error('Candidate evaluation draft could not be reloaded.')
    return draft
  }

  saveCandidateEvaluationDraftCase(
    rawInput: SaveCandidateEvaluationDraftCaseInput,
    reviewerId: string,
    reviewerDisplayName: string,
    now = new Date()
  ): CandidateEvaluationDraft {
    const input = saveCandidateEvaluationDraftCaseInputSchema.parse(rawInput)
    const draft = this.getCandidateEvaluationDraftById(input.draftId)
    if (!draft) throw new Error('Candidate evaluation draft was not found.')
    if (draft.revision !== input.expectedRevision) throw new Error('評価セット草稿が更新されました。再読み込みしてください。')
    const jobCaseRow = this.database
      .prepare<[string], JobCaseRow & { lifecycle_state: 'active' | 'archived' | null }>(
        `SELECT job.case_json, job.status, lifecycle.state AS lifecycle_state
         FROM job_cases job
         LEFT JOIN job_case_lifecycle lifecycle ON lifecycle.source_review_id = job.source_review_id
         WHERE job.id = ?`
      )
      .get(input.jobCaseId)
    if (!jobCaseRow || jobCaseRow.status !== 'active' || (jobCaseRow.lifecycle_state ?? 'active') !== 'active') {
      throw new Error('選択した案件は現在の確認済み案件ではありません。')
    }
    const jobCase = confirmedJobCaseSchema.parse(JSON.parse(jobCaseRow.case_json))
    const query = candidateBenchmarkQueryFromJobCase(jobCase)
    const title = jobCase.fields.find((field) => field.key === 'title')?.value ?? `案件 ${jobCase.id.slice(0, 8)}`
    if (query.length < 2) throw new Error('案件に評価用の確認済み検索条件がありません。')
    if (detectDirectIdentifiers(`${title}\n${query}`).length > 0) {
      throw new Error('案件の評価条件に個人識別情報が残っています。案件レビューを修正してください。')
    }
    const activeProfiles = new Map(this.stores.candidates.listEligibleTalentProfiles().map((profile) => [profile.id, profile]))
    const selectedProfiles = input.relevantCandidateProfileIds.map((profileId) => {
      const profile = activeProfiles.get(profileId)
      if (!profile) throw new Error('選択した候補者は現在の確認済み候補者プールに存在しません。')
      return profile
    })
    const expectedProjectEvidence = new Set(input.expectedProjectEvidenceProfileIds)
    for (const profile of selectedProfiles) {
      if (expectedProjectEvidence.has(profile.id) && profile.projectExperiences.length === 0) {
        throw new Error('プロジェクト証拠対象には確認済みプロジェクト経験が必要です。')
      }
    }
    const existing = this.database
      .prepare<[string, string], { id: string; created_at: string }>(
        'SELECT id, created_at FROM candidate_evaluation_draft_cases WHERE draft_id = ? AND job_case_id = ?'
      )
      .get(input.draftId, input.jobCaseId)
    if (!existing && draft.caseCount >= 100) throw new Error('評価セット草稿は最大 100 ケースです。')
    const caseId = existing?.id ?? randomUUID()
    const timestamp = now.toISOString()
    const save = this.database.transaction(() => {
      const updated = this.database
        .prepare(
          `UPDATE candidate_evaluation_drafts
           SET revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`
        )
        .run(timestamp, input.draftId, input.expectedRevision)
      if (updated.changes !== 1) throw new Error('評価セット草稿が更新されました。再読み込みしてください。')
      this.database
        .prepare(
          `INSERT INTO candidate_evaluation_draft_cases(
             id, draft_id, job_case_id, job_case_version, job_case_title, query_text,
             pool_reviewed, reviewer_id, reviewer_display_name, reviewed_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
           ON CONFLICT(draft_id, job_case_id) DO UPDATE SET
             job_case_version = excluded.job_case_version,
             job_case_title = excluded.job_case_title,
             query_text = excluded.query_text,
             pool_reviewed = 1,
             reviewer_id = excluded.reviewer_id,
             reviewer_display_name = excluded.reviewer_display_name,
             reviewed_at = excluded.reviewed_at,
             updated_at = excluded.updated_at`
        )
        .run(
          caseId,
          input.draftId,
          jobCase.id,
          jobCase.version,
          title,
          query,
          reviewerId,
          reviewerDisplayName,
          timestamp,
          existing?.created_at ?? timestamp,
          timestamp
        )
      this.database.prepare('DELETE FROM candidate_evaluation_draft_labels WHERE case_id = ?').run(caseId)
      const insertLabel = this.database.prepare(
        `INSERT INTO candidate_evaluation_draft_labels(
           case_id, candidate_profile_id, candidate_profile_version, expected_project_evidence, created_at
         ) VALUES (?, ?, ?, ?, ?)`
      )
      for (const profile of selectedProfiles) {
        insertLabel.run(
          caseId,
          profile.id,
          profile.profileVersion,
          expectedProjectEvidence.has(profile.id) ? 1 : 0,
          timestamp
        )
      }
    })
    save()
    const result = this.getCandidateEvaluationDraftById(input.draftId)
    if (!result) throw new Error('Candidate evaluation draft could not be reloaded.')
    return result
  }

  deleteCandidateEvaluationDraftCase(rawInput: DeleteCandidateEvaluationDraftCaseInput, now = new Date()): CandidateEvaluationDraft {
    const input = deleteCandidateEvaluationDraftCaseInputSchema.parse(rawInput)
    const timestamp = now.toISOString()
    const remove = this.database.transaction(() => {
      const updated = this.database
        .prepare(
          `UPDATE candidate_evaluation_drafts
           SET revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`
        )
        .run(timestamp, input.draftId, input.expectedRevision)
      if (updated.changes !== 1) throw new Error('評価セット草稿が更新されました。再読み込みしてください。')
      const deleted = this.database
        .prepare('DELETE FROM candidate_evaluation_draft_cases WHERE id = ? AND draft_id = ?')
        .run(input.caseId, input.draftId)
      if (deleted.changes !== 1) throw new Error('評価ケースが見つかりません。')
    })
    remove()
    const result = this.getCandidateEvaluationDraftById(input.draftId)
    if (!result) throw new Error('Candidate evaluation draft could not be reloaded.')
    return result
  }

  buildCandidateEvaluationBenchmark(draftId: string, expectedRevision: number, now = new Date()): SesCandidateBenchmark {
    const draft = this.getCandidateEvaluationDraftById(draftId)
    if (!draft) throw new Error('Candidate evaluation draft was not found.')
    if (draft.revision !== expectedRevision) throw new Error('評価セット草稿が更新されました。再読み込みしてください。')
    if (draft.caseCount === 0) throw new Error('評価ケースを 1 件以上追加してください。')
    if (draft.readyCaseCount !== draft.caseCount) throw new Error('無効または再確認が必要な評価ケースがあります。')
    if (draft.reviewerCount < 1) throw new Error('評価担当者の確認がありません。')
    const privacyText = [draft.name, ...draft.cases.map((draftCase) => draftCase.query)].join('\n')
    if (detectDirectIdentifiers(privacyText).length > 0) {
      throw new Error('評価セット草稿に個人識別情報が含まれています。')
    }
    return sesCandidateBenchmarkSchema.parse({
      version: 'ses-candidate-benchmark-v1',
      id: randomUUID(),
      name: draft.name,
      createdAt: now.toISOString(),
      privacy: { directIdentifiersRemoved: true, rawResumeIncluded: false, rawMailIncluded: false },
      labeling: { method: 'ses-expert', reviewerCount: draft.reviewerCount },
      thresholds: { minimumCases: 30, recallAt20: 0.9, ndcgAt20: 0.75, projectEvidenceCoverageAt20: 0.8 },
      cases: draft.cases.map((draftCase) => ({
        id: draftCase.id,
        query: draftCase.query,
        relevantCandidateLabels: draftCase.relevantCandidates.map((candidate) => candidate.anonymousLabel),
        expectedProjectEvidenceLabels: draftCase.relevantCandidates
          .filter((candidate) => candidate.expectedProjectEvidence)
          .map((candidate) => candidate.anonymousLabel)
      }))
    })
  }

  getCandidateEvaluationState(): CandidateEvaluationState {
    const datasetRow = this.database
      .prepare<[], CandidateEvaluationDatasetRow>(
        `SELECT dataset.id, dataset.name, dataset.dataset_hash, dataset.payload_json,
                dataset.case_count, dataset.relevant_candidate_count, dataset.reviewer_count,
                dataset.imported_at
         FROM candidate_evaluation_datasets dataset
         LEFT JOIN candidate_evaluation_reports report ON report.dataset_id = dataset.id
         ORDER BY coalesce(report.evaluated_at, dataset.imported_at) DESC LIMIT 1`
      )
      .get()
    const reportRow = this.database
      .prepare<[], CandidateEvaluationReportRow>(
        `SELECT report_json FROM candidate_evaluation_reports
         ORDER BY evaluated_at DESC LIMIT 1`
      )
      .get()
    return candidateEvaluationStateSchema.parse({
      dataset: datasetRow ? {
        id: datasetRow.id,
        name: datasetRow.name,
        datasetHash: datasetRow.dataset_hash,
        caseCount: datasetRow.case_count,
        relevantCandidates: datasetRow.relevant_candidate_count,
        reviewerCount: datasetRow.reviewer_count,
        importedAt: datasetRow.imported_at
      } : null,
      latestReport: reportRow
        ? candidateEvaluationReportSchema.parse(JSON.parse(reportRow.report_json))
        : null
    })
  }

  saveCandidateEvaluation(
    rawBenchmark: SesCandidateBenchmark,
    rawReport: CandidateEvaluationReport,
    now = new Date()
  ): CandidateEvaluationState {
    const benchmark = sesCandidateBenchmarkSchema.parse(rawBenchmark)
    const report = candidateEvaluationReportSchema.parse(rawReport)
    const datasetHash = createHash('sha256').update(JSON.stringify(benchmark), 'utf8').digest('hex')
    if (report.datasetId !== benchmark.id || report.datasetHash !== datasetHash) {
      throw new Error('Candidate evaluation report does not match the imported benchmark.')
    }
    const existing = this.database
      .prepare<[string], { dataset_hash: string }>('SELECT dataset_hash FROM candidate_evaluation_datasets WHERE id = ?')
      .get(benchmark.id)
    if (existing && existing.dataset_hash !== datasetHash) {
      throw new Error('Benchmark ID already exists with different content. Use a new benchmark ID.')
    }
    const importedAt = now.toISOString()
    const relevantCandidateCount = benchmark.cases.reduce(
      (total, testCase) => total + testCase.relevantCandidateLabels.length,
      0
    )
    const save = this.database.transaction(() => {
      if (!existing) {
        this.database
          .prepare(
            `INSERT INTO candidate_evaluation_datasets(
               id, name, dataset_hash, payload_json, case_count, relevant_candidate_count,
               reviewer_count, imported_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            benchmark.id,
            benchmark.name,
            datasetHash,
            JSON.stringify(benchmark),
            benchmark.cases.length,
            relevantCandidateCount,
            benchmark.labeling.reviewerCount,
            importedAt
          )
      }
      this.database
        .prepare(
          `INSERT INTO candidate_evaluation_reports(
             id, dataset_id, dataset_hash, status, report_json, evaluated_at
           ) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(report.id, benchmark.id, datasetHash, report.status, JSON.stringify(report), report.evaluatedAt)
    })
    save()
    return this.getCandidateEvaluationState()
  }

  candidateEvaluationDatasetIdsForLabels(labels: ReadonlySet<string>): string[] {
    const rows = this.database
      .prepare<[], { id: string; payload_json: string }>(
        'SELECT id, payload_json FROM candidate_evaluation_datasets'
      )
      .all()
    return rows.flatMap((row) => {
      const benchmark = sesCandidateBenchmarkSchema.parse(JSON.parse(row.payload_json))
      return benchmark.cases.some((testCase) =>
        testCase.relevantCandidateLabels.some((label) => labels.has(label)) ||
        testCase.expectedProjectEvidenceLabels.some((label) => labels.has(label))
      ) ? [row.id] : []
    })
  }
}
