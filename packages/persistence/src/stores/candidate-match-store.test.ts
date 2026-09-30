// @vitest-environment node
import { dirname } from 'node:path'
import { createWorkTaskPreview, materializeWorkTask } from '@application'
import { searchConfirmedCandidateProfiles } from '@resume'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { importTestCandidate } from './store-test-fixtures-pipeline'

const documentId = '559dcb5d-dcf0-4c11-a12d-698cfef220e6'

describe.skipIf(!nativeSqliteAvailable)('CandidateMatchStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  let taskId: string
  beforeEach(() => {
    handle = openTestRepository()
    importTestCandidate(handle.repository, { documentId, vaultDirectory: dirname(handle.path) })
    const task = materializeWorkTask(
      createWorkTaskPreview('JavaとAWS候補者を検索したい'),
      'store-test-match-task',
      '2026-07-17T00:00:00.000Z'
    )
    expect(task.type).toBe('MATCH_CANDIDATES')
    handle.repository.saveWorkTask(task)
    taskId = task.id
  })
  afterEach(() => handle.dispose())

  function runMatch(at: string) {
    const { repository } = handle
    const matches = searchConfirmedCandidateProfiles(repository.listEligibleTalentProfiles(), 'Java AWS', 20)
    return repository.saveCandidateMatchRun(taskId, 'Java AWS', matches, new Date(at))
  }

  it('persists a match run, dedupes identical executions and records reviewed feedback', () => {
    const { repository } = handle
    const run = runMatch('2026-07-17T00:02:46.000Z')
    expect(run.matches).toHaveLength(1)
    expect(run.run.hardFilterPolicyVersion).toBe('tri-state-v3')
    expect(run.run.evaluation.recallAt20).toBeNull()
    expect(runMatch('2026-07-17T00:02:47.000Z').run.id).toBe(run.run.id)

    const match = run.matches[0]!
    const saved = repository.submitCandidateMatchFeedback(
      {
        matchResultId: match.matchResultId,
        matchResultHash: match.matchResultHash,
        expectedRevision: 0,
        decision: 'suitable',
        reasonCode: 'strong_project_fit',
        note: '確認済みプロジェクトが一致'
      },
      '検証担当者',
      new Date('2026-07-17T00:03:00.000Z')
    )
    expect(saved.feedback.revision).toBe(1)
    expect(saved.run.evaluation.coveragePercent).toBe(100)

    const summary = handle.reopen().getCandidateMatchRunSummary(run.run.id)
    expect(summary.evaluation.feedbackCount).toBe(1)
    expect(summary.id).toBe(run.run.id)
  })

  it('rejects inconsistent or stale feedback and unknown runs/tasks', () => {
    const { repository } = handle
    const run = runMatch('2026-07-17T00:02:46.000Z')
    const match = run.matches[0]!
    const base = { matchResultId: match.matchResultId, matchResultHash: match.matchResultHash, expectedRevision: 0 }
    // A suitable decision cannot carry an unsuitable reason.
    expect(() =>
      repository.submitCandidateMatchFeedback({ ...base, decision: 'suitable', reasonCode: 'rate_mismatch' }, '検証担当者')
    ).toThrow(/組み合わせ/)
    // Feedback bound to a different evidence hash is refused.
    expect(() =>
      repository.submitCandidateMatchFeedback(
        { ...base, matchResultHash: '0'.repeat(64), decision: 'suitable', reasonCode: 'strong_project_fit' },
        '検証担当者'
      )
    ).toThrow(/changed/)
    repository.submitCandidateMatchFeedback({ ...base, decision: 'suitable', reasonCode: 'strong_project_fit' }, '検証担当者')
    // Stale revision.
    expect(() =>
      repository.submitCandidateMatchFeedback({ ...base, decision: 'unsuitable', reasonCode: 'rate_mismatch' }, '検証担当者')
    ).toThrow(/changed/)

    expect(() => repository.getCandidateMatchRunSummary('ffffffff-ffff-4fff-8fff-ffffffffffff')).toThrow(/not found/)
    expect(() => repository.saveCandidateMatchRun('missing-task', 'Java', [], new Date())).toThrow(/task was not found/)
  })
})
