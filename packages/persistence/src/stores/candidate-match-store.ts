import { createHash, randomUUID } from 'node:crypto'
import { type ConfirmedJobCase, confirmedJobCaseSchema } from '@job-cases'
import {
  type MatchRuntimeIdentity,
  candidatePoolFingerprint,
  evaluateMatchRunValidity,
  projectBusinessPriority
} from '@matching'
import { candidateProfileSchema } from '@resume'
import {
  candidateMatchRunSummarySchema,
  setBusinessPriorityOverrideInputSchema,
  submitCandidateMatchFeedbackInputSchema
} from '@shared'
import {
  type AgentCandidateInterviewFacts,
  type AgentCandidateProfileFacts,
  type AgentEntityStatus,
  type AgentMatchRunFacts,
  type BusinessPriorityProjection,
  type CandidateMatchFeedbackSnapshot,
  type CandidateMatchResult,
  type CandidateMatchRunSummary,
  type CandidateProfileSearchResult,
  type MatchingHomeProjection,
  type MatchingHomeResult,
  type SetBusinessPriorityOverrideInput,
  type SubmitCandidateMatchFeedbackInput,
  type SubmitCandidateMatchFeedbackResult
} from '@shared/contracts'
import {
  businessPriorityProjectionFromRow,
  candidateMatchEvaluation,
  candidateMatchFeedbackFromRow,
  matchingHomeFitSnapshot
} from '../mappers'
import {
  type BusinessPriorityProjectionRow,
  type CandidateMatchResultRow,
  type CandidateMatchRunRow,
  type CandidateProfileRow,
  type JobCaseRow
} from '../rows'
import { DomainStore } from './base'

export class CandidateMatchStore extends DomainStore {
  private listCandidateMatchResultRows(runId: string): CandidateMatchResultRow[] {
    return this.database
      .prepare<[string], CandidateMatchResultRow>(
        `SELECT id, run_id, candidate_profile_id, candidate_profile_version, result_rank, result_hash,
                feedback_decision, feedback_reason, feedback_note, feedback_revision, reviewed_by, reviewed_at,
                result_snapshot_json
         FROM candidate_match_results
         WHERE run_id = ?
         ORDER BY result_rank ASC`
      )
      .all(runId)
  }

  getCandidateMatchRunSummary(runId: string): CandidateMatchRunSummary {
    const row = this.database
      .prepare<[string], CandidateMatchRunRow>(
        `SELECT id, task_id, query_text, algorithm_version, hard_filter_policy_version, result_set_hash,
                job_case_id, job_case_version, candidate_pool_fingerprint, candidate_profile_versions_json,
                embedding_model_id, embedding_model_revision, reranker_model_id, reranker_model_revision,
                validity_policy_version, invalidated_at, invalidated_reason, created_at
         FROM candidate_match_runs WHERE id = ?`
      )
      .get(runId)
    if (!row) throw new Error('Candidate match run was not found.')
    return candidateMatchRunSummarySchema.parse({
      id: row.id,
      taskId: row.task_id,
      query: row.query_text,
      algorithmVersion: row.algorithm_version,
      hardFilterPolicyVersion: row.hard_filter_policy_version,
      resultSetHash: row.result_set_hash,
      binding: row.job_case_id && row.job_case_version && row.candidate_pool_fingerprint &&
        row.candidate_profile_versions_json && row.embedding_model_id && row.embedding_model_revision &&
        row.validity_policy_version === 'match-run-validity-v1'
        ? {
            jobCaseId: row.job_case_id,
            jobCaseVersion: row.job_case_version,
            candidatePoolFingerprint: row.candidate_pool_fingerprint,
            candidateProfileVersions: JSON.parse(row.candidate_profile_versions_json) as Array<{ id: string; version: number }>,
            embeddingModelId: row.embedding_model_id,
            embeddingModelRevision: row.embedding_model_revision,
            rerankerModelId: row.reranker_model_id,
            rerankerModelRevision: row.reranker_model_revision,
            policyVersion: 'match-run-validity-v1'
          }
        : null,
      createdAt: row.created_at,
      evaluation: candidateMatchEvaluation(this.listCandidateMatchResultRows(row.id))
    })
  }

  getAgentMatchRunFacts(
    runId: string,
    runtimeIdentity: MatchRuntimeIdentity,
    resultId: string | null = null,
    rank: number | null = null
  ): AgentMatchRunFacts {
    const run = this.getCandidateMatchRunSummary(runId)
    const rows = this.listCandidateMatchResultRows(runId)
    const row = resultId
      ? rows.find((item) => item.id === resultId) ?? null
      : rows.find((item) => item.result_rank === (rank ?? 1)) ?? rows[0] ?? null
    const activeJobCase = run.binding
      ? this.stores.jobCases.listActiveJobCases().find((item) => item.id === run.binding?.jobCaseId && item.version === run.binding?.jobCaseVersion) ?? null
      : null
    const jobCaseExists = run.binding
      ? Boolean(this.database.prepare<[string], { id: string }>('SELECT id FROM job_cases WHERE id = ?').get(run.binding.jobCaseId))
      : false
    const poolFingerprint = candidatePoolFingerprint(this.stores.candidates.listEligibleTalentProfiles())
    const validity: AgentEntityStatus = !run.binding || !jobCaseExists || !row
      ? 'deleted'
      : !activeJobCase
        ? 'stale'
      : evaluateMatchRunValidity(run, {
          ...runtimeIdentity,
          jobCaseId: activeJobCase.id,
          jobCaseVersion: activeJobCase.version,
          candidatePoolFingerprint: poolFingerprint,
          explicitlyInvalidated: false
        }) === 'current' ? 'current' : 'stale'
    const snapshot = row?.result_snapshot_json
      ? JSON.parse(row.result_snapshot_json) as (MatchingHomeResult['fit'] & { anonymousLabel: string })
      : null
    const matched = snapshot?.matchedTerms ?? []
    const missing = snapshot?.missing ?? (snapshot?.hardFilterUnknownCount ? ['硬条件仍有未知项'] : [])
    const hardFilterStatus = snapshot?.hardFilterStatus
      ?? (snapshot?.hardFilterUnknownCount ? 'unknown' : 'passed')
    const candidate = row && snapshot
      ? {
          reference: {
            kind: 'match-result' as const,
            objectId: row.id,
            objectVersion: null,
            resultHash: row.result_hash,
            ordinal: row.result_rank,
            label: snapshot.anonymousLabel,
            target: `match-result:${row.id}`
          },
          candidateProfileId: row.candidate_profile_id,
          runId,
          rank: row.result_rank,
          anonymousLabel: snapshot.anonymousLabel,
          fitScore: snapshot.matchScore,
          matched,
          missing,
          hardFilterStatus,
          projectEvidence: snapshot.projectEvidence?.summary ?? null,
          status: validity
        }
      : null
    return {
      runId,
      resultHash: run.resultSetHash,
      validity,
      jobCaseVersion: run.binding?.jobCaseVersion ?? null,
      candidatePoolFingerprint: run.binding?.candidatePoolFingerprint ?? null,
      algorithmVersion: run.algorithmVersion,
      hardFilterPolicyVersion: run.hardFilterPolicyVersion,
      candidate,
      matched,
      missing,
      hardFilterStatus,
      projectEvidence: snapshot?.projectEvidence?.summary ?? null
    }
  }

  getAgentCandidateProfileFacts(
    runId: string,
    runtimeIdentity: MatchRuntimeIdentity,
    resultId: string | null = null,
    rank: number | null = null
  ): AgentCandidateProfileFacts {
    const matchFacts = this.getAgentMatchRunFacts(runId, runtimeIdentity, resultId, rank)
    const candidate = matchFacts.candidate
    if (!candidate) {
      return { runId, validity: matchFacts.validity, candidate: null, profile: null }
    }
    const profileRow = this.database
      .prepare<[string], CandidateProfileRow>('SELECT profile_json, status FROM candidate_profiles WHERE id = ?')
      .get(candidate.candidateProfileId)
    if (!profileRow) {
      return {
        runId,
        validity: 'deleted',
        candidate: {
          candidateProfileId: candidate.candidateProfileId,
          rank: candidate.rank,
          anonymousLabel: candidate.anonymousLabel
        },
        profile: null
      }
    }
    const profile = candidateProfileSchema.parse(JSON.parse(profileRow.profile_json))
    const field = (key: string): string | null => profile.fields.find((item) => item.key === key)?.value ?? null
    const validity: AgentEntityStatus = matchFacts.validity === 'deleted'
      ? 'deleted'
      : matchFacts.validity === 'stale' || profileRow.status !== 'current' ? 'stale' : 'current'
    return {
      runId,
      validity,
      candidate: {
        candidateProfileId: candidate.candidateProfileId,
        sourceDocumentId: profile.sourceDocumentId,
        rank: candidate.rank,
        anonymousLabel: candidate.anonymousLabel
      },
      profile: {
        profileVersion: profile.profileVersion,
        skills: field('skills'),
        experienceYears: field('experience_years'),
        availability: field('availability'),
        rate: field('rate'),
        japaneseLevel: field('japanese_level'),
        workStyle: field('work_style'),
        role: field('role'),
        location: field('location'),
        workAuthorization: field('work_authorization'),
        projectExperiences: profile.projectExperiences.slice(0, 20).map((project) => ({
          title: project.title,
          period: project.period,
          role: project.role,
          technologies: project.technologies,
          summary: project.summary
        }))
      }
    }
  }

  getAgentCandidateInterviewFacts(
    runId: string,
    runtimeIdentity: MatchRuntimeIdentity,
    resultId: string | null = null,
    rank: number | null = null
  ): AgentCandidateInterviewFacts {
    const matchFacts = this.getAgentMatchRunFacts(runId, runtimeIdentity, resultId, rank)
    const candidate = matchFacts.candidate
    if (!candidate) return { runId, validity: matchFacts.validity, candidate: null, interviews: [] }
    const profileRow = this.database
      .prepare<[string], CandidateProfileRow>('SELECT profile_json, status FROM candidate_profiles WHERE id = ?')
      .get(candidate.candidateProfileId)
    if (!profileRow) {
      return {
        runId,
        validity: 'deleted',
        candidate: { candidateProfileId: candidate.candidateProfileId, rank: candidate.rank, anonymousLabel: candidate.anonymousLabel },
        interviews: []
      }
    }
    const profile = candidateProfileSchema.parse(JSON.parse(profileRow.profile_json))
    const validity: AgentEntityStatus = matchFacts.validity === 'deleted'
      ? 'deleted'
      : matchFacts.validity === 'stale' || profileRow.status !== 'current' ? 'stale' : 'current'
    const interviews = this.stores.candidateInterviews.listCandidateInterviews()
      .filter((interview) => interview.sourceDocumentId === profile.sourceDocumentId)
      .slice(0, 40)
      .map((interview) => ({
        interviewId: interview.id,
        kind: interview.kind,
        roundNumber: interview.roundNumber,
        stage: interview.stage,
        scheduledAt: interview.scheduledAt,
        durationMinutes: interview.durationMinutes,
        meetingMethod: interview.meetingMethod,
        interviewer: interview.interviewer,
        interviewGoal: interview.interviewGoal,
        interviewNotes: interview.interviewNotes,
        unresolvedItems: interview.unresolvedItems,
        decision: interview.decision,
        decisionReason: interview.decisionReason,
        updatedAt: interview.updatedAt
      }))
    return {
      runId,
      validity,
      candidate: {
        candidateProfileId: candidate.candidateProfileId,
        sourceDocumentId: profile.sourceDocumentId,
        rank: candidate.rank,
        anonymousLabel: candidate.anonymousLabel
      },
      interviews
    }
  }

  saveCandidateMatchRun(
    taskId: string,
    query: string,
    matches: CandidateProfileSearchResult[],
    now = new Date(),
    runtimeIdentity: MatchRuntimeIdentity | null = null
  ): { run: CandidateMatchRunSummary; matches: CandidateMatchResult[] } {
    const task = this.stores.workTasks.getWorkTask(taskId)
    if (!task || task.type !== 'MATCH_CANDIDATES') throw new Error('Candidate match task was not found.')
    const algorithmVersion = matches[0]?.retrieval.strategy ?? runtimeIdentity?.algorithmVersion ?? 'hard-filter-hybrid-rrf-v1'
    const hardFilterPolicyVersion = matches[0]?.retrieval.hardFilterPolicyVersion ?? runtimeIdentity?.hardFilterPolicyVersion ?? 'tri-state-v3'
    const jobCaseBinding = task.contextBindings.find((binding) => binding.objectType === 'job-case') ?? null
    const jobCase = jobCaseBinding
      ? this.stores.jobCases.listActiveJobCases().find((item) => item.id === jobCaseBinding.objectId) ?? null
      : null
    const pool = this.stores.candidates.listEligibleTalentProfiles()
    const profileVersions = pool
      .map((profile) => ({ id: profile.id, version: profile.profileVersion }))
      .toSorted((left, right) => left.id.localeCompare(right.id) || left.version - right.version)
    const binding = runtimeIdentity && jobCase && jobCaseBinding?.version === String(jobCase.version)
      ? {
          jobCaseId: jobCase.id,
          jobCaseVersion: jobCase.version,
          candidatePoolFingerprint: candidatePoolFingerprint(pool),
          candidateProfileVersions: profileVersions,
          embeddingModelId: runtimeIdentity.embeddingModelId,
          embeddingModelRevision: runtimeIdentity.embeddingModelRevision,
          rerankerModelId: runtimeIdentity.rerankerModelId,
          rerankerModelRevision: runtimeIdentity.rerankerModelRevision,
          policyVersion: 'match-run-validity-v1' as const
        }
      : null
    const prepared = matches.map((match, index) => ({
      match,
      rank: match.retrieval.rank ?? index + 1,
      resultHash: createHash('sha256').update(JSON.stringify({
        candidateProfileId: match.id,
        candidateProfileVersion: match.version,
        matchedTerms: match.matchedTerms,
        evidence: match.evidence,
        projectEvidence: match.projectEvidence,
        retrieval: match.retrieval
      })).digest('hex')
    }))
    const resultSetHash = createHash('sha256').update(JSON.stringify({
      query: query.normalize('NFKC').trim(),
      algorithmVersion,
      hardFilterPolicyVersion,
      binding,
      results: prepared.map((result) => ({
        candidateProfileId: result.match.id,
        candidateProfileVersion: result.match.version,
        resultHash: result.resultHash,
        rank: result.rank
      }))
    })).digest('hex')
    const timestamp = now.toISOString()
    const existing = this.database
      .prepare<[string, string], CandidateMatchRunRow>(
        `SELECT id, task_id, query_text, algorithm_version, hard_filter_policy_version, result_set_hash,
                job_case_id, job_case_version, candidate_pool_fingerprint, candidate_profile_versions_json,
                embedding_model_id, embedding_model_revision, reranker_model_id, reranker_model_revision,
                validity_policy_version, invalidated_at, invalidated_reason, created_at
         FROM candidate_match_runs WHERE task_id = ? AND result_set_hash = ?`
      )
      .get(taskId, resultSetHash)
    const runId = existing?.id ?? randomUUID()
    if (!existing) {
      const insert = this.database.transaction(() => {
        this.database
          .prepare(
            `INSERT INTO candidate_match_runs(
               id, task_id, query_text, algorithm_version, hard_filter_policy_version,
               result_set_hash, job_case_id, job_case_version, candidate_pool_fingerprint,
               candidate_profile_versions_json, embedding_model_id, embedding_model_revision,
               reranker_model_id, reranker_model_revision, validity_policy_version,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            runId, taskId, query, algorithmVersion, hardFilterPolicyVersion, resultSetHash,
            binding?.jobCaseId ?? null, binding?.jobCaseVersion ?? null,
            binding?.candidatePoolFingerprint ?? null,
            binding ? JSON.stringify(binding.candidateProfileVersions) : null,
            binding?.embeddingModelId ?? null, binding?.embeddingModelRevision ?? null,
            binding?.rerankerModelId ?? null, binding?.rerankerModelRevision ?? null,
            binding?.policyVersion ?? null, timestamp, timestamp
          )
        for (const result of prepared) {
          this.database
            .prepare(
              `INSERT INTO candidate_match_results(
                 id, run_id, candidate_profile_id, candidate_profile_version, result_rank,
                 result_hash, feedback_revision, result_snapshot_json, created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
            )
            .run(
              randomUUID(),
              runId,
              result.match.id,
              result.match.version,
              result.rank,
              result.resultHash,
              JSON.stringify(matchingHomeFitSnapshot(result.match, result.rank)),
              timestamp,
              timestamp
            )
        }
      })
      insert()
    }
    const resultRows = this.listCandidateMatchResultRows(runId)
    const persistedRun = this.getCandidateMatchRunSummary(runId)
    if (binding && jobCase) {
      for (const result of resultRows) this.ensureBusinessPriorityProjection(persistedRun, result, jobCase, now)
    }
    const rowByCandidate = new Map(resultRows.map((row) => [row.candidate_profile_id, row]))
    return {
      run: persistedRun,
      matches: matches.map((match) => {
        const row = rowByCandidate.get(match.id)
        if (!row) throw new Error('Persisted candidate match result is incomplete.')
        return {
          ...match,
          matchResultId: row.id,
          matchResultHash: row.result_hash,
          feedback: candidateMatchFeedbackFromRow(row)
        }
      })
    }
  }

  private ensureBusinessPriorityProjection(
    run: CandidateMatchRunSummary,
    result: CandidateMatchResultRow,
    jobCase: ConfirmedJobCase,
    now = new Date()
  ): BusinessPriorityProjection {
    const projected = this.projectBusinessPriorityForResult(result, jobCase)
    const generatedAt = now.toISOString()
    this.database
      .prepare(
        `INSERT OR IGNORE INTO business_priority_projections(
           id, match_result_id, run_id, candidate_profile_id, rule_version, level,
           reasons_json, inputs_json, input_snapshot_hash, generated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(), result.id, run.id, result.candidate_profile_id, projected.ruleVersion,
        projected.level, JSON.stringify(projected.reasons), JSON.stringify(projected.inputs),
        projected.inputSnapshotHash, generatedAt
      )
    const row = this.database
      .prepare<[string, string, string], BusinessPriorityProjectionRow>(
        `SELECT * FROM business_priority_projections
         WHERE match_result_id = ? AND rule_version = ? AND input_snapshot_hash = ?`
      )
      .get(result.id, projected.ruleVersion, projected.inputSnapshotHash)
    if (!row) throw new Error('Business priority projection could not be loaded.')
    return businessPriorityProjectionFromRow(row, now)
  }

  private projectBusinessPriorityForResult(
    result: CandidateMatchResultRow,
    jobCase: ConfirmedJobCase
  ): ReturnType<typeof projectBusinessPriority> {
    const profileRow = this.database
      .prepare<[string], CandidateProfileRow>(
        "SELECT profile_json, status FROM candidate_profiles WHERE id = ? AND status = 'current'"
      )
      .get(result.candidate_profile_id)
    if (!profileRow) throw new Error('Current candidate profile was not found for business priority.')
    const profile = candidateProfileSchema.parse(JSON.parse(profileRow.profile_json))
    const proposalRow = this.database
      .prepare<[string, string], { id: string }>(
        `SELECT id FROM proposal_drafts
         WHERE job_case_id = ? AND candidate_profile_id = ?
         ORDER BY updated_at DESC, id DESC LIMIT 1`
      )
      .get(jobCase.id, result.candidate_profile_id)
    const proposal = proposalRow ? this.stores.proposals.getProposalDraft(proposalRow.id) : null
    return projectBusinessPriority({
      caseTiming: jobCase.fields.find((field) => field.key === 'start_date')?.value ?? null,
      candidateAvailability: profile.fields.find((field) => field.key === 'availability')?.value ?? null,
      proposalStatus: proposal?.status ?? null,
      followUpStage: proposal?.followUp.stage ?? null
    })
  }

  private getPersistedBusinessPriorityProjection(
    result: CandidateMatchResultRow,
    jobCase: ConfirmedJobCase,
    now = new Date()
  ): BusinessPriorityProjection {
    const projected = this.projectBusinessPriorityForResult(result, jobCase)
    const row = this.database
      .prepare<[string, string, string], BusinessPriorityProjectionRow>(
        `SELECT * FROM business_priority_projections
         WHERE match_result_id = ? AND rule_version = ? AND input_snapshot_hash = ?`
      )
      .get(result.id, projected.ruleVersion, projected.inputSnapshotHash)
    if (!row) throw new Error('Business priority projection could not be loaded.')
    return businessPriorityProjectionFromRow(row, now)
  }

  refreshBusinessPriorityProjectionsForPair(
    jobCaseId: string,
    candidateProfileId: string,
    now = new Date()
  ): void {
    const jobCaseRow = this.database
      .prepare<[string], JobCaseRow>('SELECT case_json, status FROM job_cases WHERE id = ?')
      .get(jobCaseId)
    if (!jobCaseRow) return
    const jobCase = confirmedJobCaseSchema.parse(JSON.parse(jobCaseRow.case_json))
    const rows = this.database
      .prepare<[string, string], CandidateMatchResultRow>(
        `SELECT result.id, result.run_id, result.candidate_profile_id, result.candidate_profile_version,
                result.result_rank, result.result_hash, result.feedback_decision, result.feedback_reason,
                result.feedback_note, result.feedback_revision, result.reviewed_by, result.reviewed_at,
                result.result_snapshot_json
         FROM candidate_match_results result
         JOIN candidate_match_runs run ON run.id = result.run_id
         WHERE run.job_case_id = ? AND result.candidate_profile_id = ?`
      )
      .all(jobCaseId, candidateProfileId)
    for (const result of rows) {
      this.ensureBusinessPriorityProjection(this.getCandidateMatchRunSummary(result.run_id), result, jobCase, now)
    }
  }

  getMatchingHomeProjection(
    runtimeIdentity: MatchRuntimeIdentity,
    now = new Date()
  ): MatchingHomeProjection {
    const jobCases = this.stores.jobCases.listActiveJobCases()
    const pool = this.stores.candidates.listEligibleTalentProfiles()
    if (jobCases.length === 0 || pool.length === 0) {
      return {
        state: 'onboarding',
        eligibleCandidateCount: pool.length,
        selectedJobCaseId: jobCases[0]?.id ?? null,
        jobCases: jobCases.map((jobCase) => ({
          id: jobCase.id,
          version: jobCase.version,
          title: jobCase.fields.find((field) => field.key === 'title')?.value ?? `案件 ${jobCase.id.slice(0, 8)}`,
          validity: 'not_run',
          lastRunCreatedAt: null
        })),
        currentRun: null
      }
    }

    const poolFingerprint = candidatePoolFingerprint(pool)
    const projectedCases = jobCases.map((jobCase) => {
      const row = this.database
        .prepare<[string], CandidateMatchRunRow>(
          `SELECT id, task_id, query_text, algorithm_version, hard_filter_policy_version, result_set_hash,
                  job_case_id, job_case_version, candidate_pool_fingerprint, candidate_profile_versions_json,
                  embedding_model_id, embedding_model_revision, reranker_model_id, reranker_model_revision,
                  validity_policy_version, invalidated_at, invalidated_reason, created_at
           FROM candidate_match_runs WHERE job_case_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`
        )
        .get(jobCase.id)
      const run = row ? this.getCandidateMatchRunSummary(row.id) : null
      const validity: MatchingHomeProjection['jobCases'][number]['validity'] = run ? evaluateMatchRunValidity(run, {
        ...runtimeIdentity,
        jobCaseId: jobCase.id,
        jobCaseVersion: jobCase.version,
        candidatePoolFingerprint: poolFingerprint,
        explicitlyInvalidated: Boolean(row?.invalidated_at)
      }) : 'not_run'
      return {
        jobCase,
        run,
        validity,
        createdAt: run?.createdAt ?? null
      }
    })
    const current = projectedCases
      .filter((item) => item.run !== null && item.validity === 'current')
      .toSorted((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''))[0] ?? null
    const selected = current ?? projectedCases[0]!
    let currentRun: MatchingHomeProjection['currentRun'] = null
    if (current?.run) {
      const activeRun = current.run
      const rows = this.listCandidateMatchResultRows(activeRun.id)
      const results = rows.flatMap((row): MatchingHomeResult[] => {
        if (!row.result_snapshot_json) return []
        const snapshot = JSON.parse(row.result_snapshot_json) as MatchingHomeResult['fit'] & { anonymousLabel: string }
        return [{
          matchResultId: row.id,
          matchResultHash: row.result_hash,
          candidateProfileId: row.candidate_profile_id,
          candidateProfileVersion: row.candidate_profile_version,
          anonymousLabel: snapshot.anonymousLabel,
          fit: {
            rank: snapshot.rank,
            matchScore: snapshot.matchScore,
            matchedTerms: snapshot.matchedTerms,
            termCoverage: snapshot.termCoverage,
            hardFilterUnknownCount: snapshot.hardFilterUnknownCount,
            evidence: snapshot.evidence,
            projectEvidence: snapshot.projectEvidence
          },
          feedback: candidateMatchFeedbackFromRow(row),
          businessPriority: this.getPersistedBusinessPriorityProjection(row, current.jobCase, now)
        }]
      })
      currentRun = { run: activeRun, validity: 'current', results }
    }
    return {
      state: currentRun ? 'current-results' : 'ready-to-run',
      eligibleCandidateCount: pool.length,
      selectedJobCaseId: selected.jobCase.id,
      jobCases: projectedCases.map((item) => ({
        id: item.jobCase.id,
        version: item.jobCase.version,
        title: item.jobCase.fields.find((field) => field.key === 'title')?.value ?? `案件 ${item.jobCase.id.slice(0, 8)}`,
        validity: item.validity,
        lastRunCreatedAt: item.createdAt
      })),
      currentRun
    }
  }

  setBusinessPriorityOverride(
    rawInput: SetBusinessPriorityOverrideInput,
    actor: string,
    now = new Date()
  ): BusinessPriorityProjection {
    const input = setBusinessPriorityOverrideInputSchema.parse(rawInput)
    if (new Date(input.expiresAt).getTime() <= now.getTime()) {
      throw new Error('Business priority override expiry must be in the future.')
    }
    const current = this.database
      .prepare<[string], BusinessPriorityProjectionRow>(
        `SELECT * FROM business_priority_projections
         WHERE match_result_id = ? ORDER BY generated_at DESC, id DESC LIMIT 1`
      )
      .get(input.matchResultId)
    if (!current) throw new Error('Business priority projection was not found.')
    const revision = current.override_revision + 1
    const updated = this.database
      .prepare(
        `UPDATE business_priority_projections SET
           override_level = ?, override_reason = ?, override_actor = ?,
           override_expires_at = ?, override_revision = ?
         WHERE id = ? AND override_revision = ?`
      )
      .run(input.level, input.reason, actor, input.expiresAt, revision, current.id, current.override_revision)
    if (updated.changes !== 1) throw new Error('Business priority projection changed. Reload and try again.')
    const row = this.database
      .prepare<[string], BusinessPriorityProjectionRow>('SELECT * FROM business_priority_projections WHERE id = ?')
      .get(current.id)
    if (!row) throw new Error('Business priority override could not be reloaded.')
    return businessPriorityProjectionFromRow(row, now)
  }

  submitCandidateMatchFeedback(
    rawInput: SubmitCandidateMatchFeedbackInput,
    reviewerDisplayName: string,
    now = new Date()
  ): SubmitCandidateMatchFeedbackResult {
    const input = submitCandidateMatchFeedbackInputSchema.parse(rawInput)
    const row = this.database
      .prepare<[string], CandidateMatchResultRow>(
        `SELECT id, run_id, candidate_profile_id, candidate_profile_version, result_rank, result_hash,
                feedback_decision, feedback_reason, feedback_note, feedback_revision, reviewed_by, reviewed_at,
                result_snapshot_json
         FROM candidate_match_results WHERE id = ?`
      )
      .get(input.matchResultId)
    if (!row) throw new Error('Candidate match result was not found.')
    if (row.result_hash !== input.matchResultHash) {
      throw new Error('Candidate match result changed. Review the evidence again before saving feedback.')
    }
    if (row.feedback_revision !== input.expectedRevision) {
      throw new Error('Candidate match feedback changed. Reload before editing.')
    }
    const reviewedAt = now.toISOString()
    const nextRevision = row.feedback_revision + 1
    const updated = this.database
      .prepare(
        `UPDATE candidate_match_results
         SET feedback_decision = ?, feedback_reason = ?, feedback_note = ?, feedback_revision = ?,
             reviewed_by = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ? AND result_hash = ? AND feedback_revision = ?`
      )
      .run(
        input.decision,
        input.reasonCode,
        input.note?.trim() || null,
        nextRevision,
        reviewerDisplayName,
        reviewedAt,
        reviewedAt,
        input.matchResultId,
        input.matchResultHash,
        input.expectedRevision
      )
    if (updated.changes !== 1) throw new Error('Candidate match feedback changed. Reload before editing.')
    const feedback: CandidateMatchFeedbackSnapshot = {
      decision: input.decision,
      reasonCode: input.reasonCode,
      note: input.note?.trim() || null,
      reviewerDisplayName,
      revision: nextRevision,
      reviewedAt
    }
    return {
      run: this.getCandidateMatchRunSummary(row.run_id),
      matchResultId: row.id,
      feedback
    }
  }
}
