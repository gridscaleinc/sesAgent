// @vitest-environment node
import { dirname } from 'node:path'
import { createWorkTaskPreview, materializeWorkTask } from '@application'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nativeSqliteAvailable, openTestRepository, type TestRepositoryHandle } from './store-test-repository'
import { createConfirmedManualJobCase } from './store-test-fixtures-mail'
import { importTestCandidate } from './store-test-fixtures-pipeline'

const documentId = '559dcb5d-dcf0-4c11-a12d-698cfef220e6'
const approvals = { recipient: true, body: true, attachment: true, privacy: true } as const
const at = (ms: number) => new Date(Date.UTC(2026, 6, 17, 0, 10, 0, ms))

describe.skipIf(!nativeSqliteAvailable)('ProposalStore via EncryptedApplicationRepository', () => {
  let handle: TestRepositoryHandle
  let taskId: string
  let jobCaseId: string
  let candidateProfileId: string
  beforeEach(() => {
    handle = openTestRepository()
    candidateProfileId = importTestCandidate(handle.repository, { documentId, vaultDirectory: dirname(handle.path) }).review.profile!.id
    jobCaseId = createConfirmedManualJobCase(handle.repository).jobCase.id
    const task = materializeWorkTask(
      createWorkTaskPreview('確認済み案件と候補者から提案メール下書きを準備したい'),
      'store-test-proposal-task',
      '2026-07-17T00:00:00.000Z'
    )
    handle.repository.saveWorkTask(task)
    taskId = task.id
  })
  afterEach(() => handle.dispose())

  function createDraft(draftId = 'f3973f54-35a5-48fb-a2f7-1507b85dac80') {
    return handle.repository.createProposalDraft(
      {
        taskId,
        jobCaseId,
        candidateProfileId,
        recipientTo: 'bp@example.co.jp',
        recipientCc: ['sales@example.co.jp'],
        candidateDisplayName: '候補者A',
        tone: 'standard'
      },
      draftId,
      '検証担当者',
      at(100)
    )
  }

  it('drafts, edits, approves, exports and follows up a proposal locally', () => {
    const { repository } = handle
    const options = repository.getProposalPreparationOptions()
    expect(options.jobCases.map((jobCase) => jobCase.id)).toContain(jobCaseId)
    expect(options.candidates.map((candidate) => candidate.id)).toContain(candidateProfileId)

    const draft = createDraft()
    expect(draft.generation.cloudUsed).toBe(false)
    expect(draft.attachment.sourceDocumentIncluded).toBe(false)
    // Neither the redacted contact nor the local candidate identity reaches the draft.
    expect(`${draft.subject}\n${draft.body}`).not.toMatch(/佐藤秘密担当|080-8765-4321|山田検証用|090-1234-5678/)

    const updated = repository.updateProposalDraft(
      {
        draftId: draft.id,
        revision: draft.revision,
        recipientTo: 'bp-updated@example.co.jp',
        recipientCc: draft.recipientCc,
        candidateDisplayName: draft.candidateDisplayName,
        subject: draft.subject,
        body: draft.body
      },
      '検証担当者',
      at(200)
    )
    expect(updated.revision).toBe(draft.revision + 1)
    expect(updated.contentHash).not.toBe(draft.contentHash)

    const approved = repository.approveProposalDraft(
      {
        draftId: updated.id,
        revision: updated.revision,
        contentHash: updated.contentHash,
        approvals
      },
      '検証担当者',
      at(300)
    )
    const exportId = 'a3196b88-fb9a-4d52-ae7d-07f2bd2fd123'
    repository.beginProposalExport(approved.id, approved.revision, approved.contentHash, exportId, '4'.repeat(64), '検証担当者', at(400))
    const exported = repository.completeProposalExport(exportId, approved.id, approved.contentHash, '5'.repeat(64), '検証担当者', at(500))
    expect(exported).toMatchObject({ status: 'exported', exportPackageHash: '5'.repeat(64) })

    const sent = repository.recordProposalFollowUp(
      {
        draftId: exported.id,
        expectedRevision: 0,
        stage: 'sent',
        occurredOn: '2026-07-17',
        note: '翌営業日に状況確認',
        manuallyConfirmed: true
      },
      'bb6b957e-caf1-4c5c-b9f7-4c0cd358af33',
      '検証担当者',
      at(600)
    )
    expect(sent.followUp.stage).toBe('sent')
    expect(sent.followUp.events[0]?.cloudEligible).toBe(false)
    expect(handle.reopen().getProposalDraft(exported.id)?.followUp.events[0]?.note).toBe('翌営業日に状況確認')
  })

  it('refuses stale edits, unapproved exports, stale follow-ups and PII in follow-up notes', () => {
    const { repository } = handle
    const draft = createDraft()
    const edit = {
      draftId: draft.id,
      revision: draft.revision,
      recipientTo: 'bp@example.co.jp',
      recipientCc: draft.recipientCc,
      candidateDisplayName: draft.candidateDisplayName,
      subject: draft.subject,
      body: `${draft.body}\n追記`
    }
    const updated = repository.updateProposalDraft(edit, '検証担当者', at(200))
    expect(() => repository.updateProposalDraft(edit, '検証担当者')).toThrow()
    // Approval is bound to the exact content hash that was reviewed.
    expect(() =>
      repository.approveProposalDraft(
        {
          draftId: updated.id,
          revision: updated.revision,
          contentHash: draft.contentHash,
          approvals
        },
        '検証担当者'
      )
    ).toThrow()
    expect(() =>
      repository.approveProposalDraft(
        {
          draftId: updated.id,
          revision: updated.revision,
          contentHash: updated.contentHash,
          approvals: { ...approvals, privacy: false as never }
        },
        '検証担当者'
      )
    ).toThrow()
    // Export is only possible after approval.
    expect(() =>
      repository.beginProposalExport(
        updated.id,
        updated.revision,
        updated.contentHash,
        'a3196b88-fb9a-4d52-ae7d-07f2bd2fd123',
        '4'.repeat(64),
        '検証担当者'
      )
    ).toThrow()

    const approved = repository.approveProposalDraft(
      {
        draftId: updated.id,
        revision: updated.revision,
        contentHash: updated.contentHash,
        approvals
      },
      '検証担当者',
      at(300)
    )
    repository.beginProposalExport(
      approved.id,
      approved.revision,
      approved.contentHash,
      'a3196b88-fb9a-4d52-ae7d-07f2bd2fd123',
      '4'.repeat(64),
      '検証担当者',
      at(400)
    )
    repository.completeProposalExport(
      'a3196b88-fb9a-4d52-ae7d-07f2bd2fd123',
      approved.id,
      approved.contentHash,
      '5'.repeat(64),
      '検証担当者',
      at(500)
    )
    repository.recordProposalFollowUp(
      {
        draftId: approved.id,
        expectedRevision: 0,
        stage: 'sent',
        occurredOn: '2026-07-17',
        manuallyConfirmed: true
      },
      'bb6b957e-caf1-4c5c-b9f7-4c0cd358af33',
      '検証担当者',
      at(600)
    )
    expect(() =>
      repository.recordProposalFollowUp(
        {
          draftId: approved.id,
          expectedRevision: 0,
          stage: 'replied',
          occurredOn: '2026-07-18',
          manuallyConfirmed: true
        },
        'ab0392b1-c608-44ea-a29d-23d3cded7396',
        '検証担当者'
      )
    ).toThrow(/changed/)
    expect(() =>
      repository.recordProposalFollowUp(
        {
          draftId: approved.id,
          expectedRevision: 1,
          stage: 'replied',
          occurredOn: '2026-07-18',
          note: '連絡先 090-1234-5678',
          manuallyConfirmed: true
        },
        'bf4ba6c0-1d51-4ec6-8801-e9f25517804c',
        '検証担当者'
      )
    ).toThrow(/direct identifiers/)
  })

  it('recovers an export interrupted by a restart as export_unknown', () => {
    const { repository } = handle
    const draft = createDraft('28ab0e26-2389-48cb-ac53-e5334ce02bfd')
    const approved = repository.approveProposalDraft(
      {
        draftId: draft.id,
        revision: draft.revision,
        contentHash: draft.contentHash,
        approvals
      },
      '検証担当者',
      at(300)
    )
    repository.beginProposalExport(
      approved.id,
      approved.revision,
      approved.contentHash,
      '38a3ed67-f326-4b2b-b7d5-d413660b5381',
      '6'.repeat(64),
      '検証担当者',
      at(400)
    )
    expect(handle.reopen().getProposalDraft(draft.id)?.status).toBe('export_unknown')
  })
})
