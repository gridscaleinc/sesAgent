// @vitest-environment node
import type { CandidateMatchRunSummary } from '@shared'
import {
  candidatePoolFingerprint,
  evaluateMatchRunValidity,
  projectBusinessPriority,
  type MatchRunValidityContext
} from './index'

const run: CandidateMatchRunSummary = {
  id: '7afc4d8d-65ea-48cb-97dc-ff722fcf8f67',
  taskId: 'task-match-001',
  query: 'Java AWS',
  algorithmVersion: 'hard-filter-hybrid-local-rerank-v1',
  hardFilterPolicyVersion: 'tri-state-v3',
  resultSetHash: 'a'.repeat(64),
  binding: {
    jobCaseId: 'f5151d7f-c482-41ce-b77f-94178d911ad4',
    jobCaseVersion: 2,
    candidatePoolFingerprint: 'b'.repeat(64),
    candidateProfileVersions: [{ id: '865f296d-a6d2-4b64-8ed8-2f583e9e089f', version: 4 }],
    embeddingModelId: 'embedding/model',
    embeddingModelRevision: 'rev-1',
    rerankerModelId: 'reranker/model',
    rerankerModelRevision: 'rev-2',
    policyVersion: 'match-run-validity-v1'
  },
  createdAt: '2026-08-18T00:00:00.000Z',
  evaluation: {
    resultCount: 1, feedbackCount: 0, suitableCount: 0, unsuitableCount: 0,
    coveragePercent: 0, judgedNdcgAt20: null, recallAt20: null,
    recallStatus: 'requires-known-relevant-total'
  }
}

const context: MatchRunValidityContext = {
  jobCaseId: run.binding!.jobCaseId,
  jobCaseVersion: run.binding!.jobCaseVersion,
  candidatePoolFingerprint: run.binding!.candidatePoolFingerprint,
  algorithmVersion: run.algorithmVersion,
  hardFilterPolicyVersion: run.hardFilterPolicyVersion,
  embeddingModelId: run.binding!.embeddingModelId,
  embeddingModelRevision: run.binding!.embeddingModelRevision,
  rerankerModelId: run.binding!.rerankerModelId,
  rerankerModelRevision: run.binding!.rerankerModelRevision,
  explicitlyInvalidated: false
}

describe('matching projections', () => {
  it('fingerprints the complete candidate pool deterministically and changes on a profile version', () => {
    const left = candidatePoolFingerprint([
      { id: 'b', profileVersion: 1 },
      { id: 'a', profileVersion: 2 }
    ])
    const reordered = candidatePoolFingerprint([
      { id: 'a', profileVersion: 2 },
      { id: 'b', profileVersion: 1 }
    ])
    const changed = candidatePoolFingerprint([
      { id: 'a', profileVersion: 3 },
      { id: 'b', profileVersion: 1 }
    ])
    expect(left).toBe(reordered)
    expect(changed).not.toBe(left)
  })

  it('classifies every frozen MatchRunValidity branch without exposing stale rankings', () => {
    expect(evaluateMatchRunValidity(run, context)).toBe('current')
    expect(evaluateMatchRunValidity(run, { ...context, jobCaseVersion: 3 })).toBe('stale_job_case')
    expect(evaluateMatchRunValidity(run, { ...context, candidatePoolFingerprint: 'c'.repeat(64) })).toBe('stale_candidate_pool')
    expect(evaluateMatchRunValidity(run, { ...context, embeddingModelRevision: 'rev-3' })).toBe('stale_model')
    expect(evaluateMatchRunValidity(run, { ...context, hardFilterPolicyVersion: 'tri-state-v2' })).toBe('stale_policy')
    expect(evaluateMatchRunValidity(run, { ...context, explicitlyInvalidated: true })).toBe('invalidated')
    expect(evaluateMatchRunValidity({ ...run, binding: null }, context)).toBe('invalidated')
  })

  it('projects business priority only from timing, availability and proposal follow-up state', () => {
    const high = projectBusinessPriority({
      caseTiming: '即日', candidateAvailability: null, proposalStatus: null, followUpStage: null
    })
    const followUp = projectBusinessPriority({
      caseTiming: '来月', candidateAvailability: '来月参画可', proposalStatus: 'exported', followUpStage: 'sent'
    })
    const paused = projectBusinessPriority({
      caseTiming: '来月', candidateAvailability: '来月参画可', proposalStatus: 'exported', followUpStage: 'declined'
    })
    expect(high.level).toBe('high')
    expect(high.reasons).toContain('CANDIDATE_AVAILABILITY_UNKNOWN')
    expect(followUp.level).toBe('follow_up')
    expect(paused.level).toBe('paused')
    expect(high.inputSnapshotHash).toMatch(/^[a-f0-9]{64}$/u)
  })
})
