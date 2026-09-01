import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { JobCaseReviewSnapshot } from '@shared'
import {
  createJobCaseDraftsForPendingGmailMessages,
  type GmailJobCaseIntakeRepository
} from './gmail-job-case-intake'

const operator = { operatorId: 'op-1', displayName: 'HR' }

function gmailMessage(overrides: Record<string, unknown> = {}) {
  return {
    accountEmail: 'sales@example.co.jp',
    gmailMessageId: 'msg-0001',
    threadId: 'thread-0001',
    historyId: '100',
    internalDate: '2026-08-30T01:00:00.000Z',
    labelIds: ['Label_SES'],
    rfcMessageId: null,
    fromDomain: 'partner.example.co.jp',
    redactedSubject: 'Java 案件のご紹介',
    redactedBody: '単金：70万円\n必須スキル：Java、Spring Boot\n勤務地：東京',
    redactionSessionId: randomUUID(),
    classification: 'job-case' as const,
    businessFingerprint: 'f'.repeat(64),
    duplicateOfMessageId: null,
    warningCodes: [],
    attachmentCount: 0,
    importedAt: '2026-08-30T01:00:05.000Z',
    ...overrides
  }
}

interface SavedDraft {
  reviewId: string
  fields: Array<{ key: string; label: string; value: string | null }>
}

function reviewFromDraft(draft: SavedDraft): JobCaseReviewSnapshot {
  return {
    reviewId: draft.reviewId,
    reviewRevision: 1,
    status: 'awaiting-review',
    fields: draft.fields.map((field) => ({ key: field.key, value: field.value }))
  } as unknown as JobCaseReviewSnapshot
}

function intakeRepository(messages: ReturnType<typeof gmailMessage>[]) {
  const savedDrafts: SavedDraft[] = []
  const mocks = {
    listGmailMessagesPendingJobCaseDrafts: vi.fn(() => messages),
    ensureGmailJobCaseSource: vi.fn((source: unknown) => source),
    saveJobCaseDraft: vi.fn((draft: SavedDraft) => {
      savedDrafts.push(draft)
      return true
    }),
    getJobCaseReview: vi.fn((reviewId: string) => {
      const draft = savedDrafts.find((item) => item.reviewId === reviewId)
      return draft ? reviewFromDraft(draft) : null
    }),
    confirmJobCaseReview: vi.fn((...args: unknown[]) => {
      const input = args[0] as { reviewId: string }
      const draft = savedDrafts.find((item) => item.reviewId === input.reviewId)!
      return { ...reviewFromDraft(draft), status: 'completed' as const }
    })
  }
  return { repository: mocks as unknown as GmailJobCaseIntakeRepository, mocks, savedDrafts }
}

describe('createJobCaseDraftsForPendingGmailMessages', () => {
  it('applies the operator field aliases to Gmail extraction', () => {
    const withAlias = intakeRepository([gmailMessage()])
    createJobCaseDraftsForPendingGmailMessages(withAlias.repository, 'sales@example.co.jp', null, { rate: ['単金'] })
    const aliased = Object.fromEntries(withAlias.savedDrafts[0]!.fields.map((field) => [field.key, field.value]))
    expect(aliased.rate).toBe('70万円')
    expect(aliased.title).toContain('Java')

    // Without the alias the partner label stays unknown and the field empty.
    const withoutAlias = intakeRepository([gmailMessage()])
    createJobCaseDraftsForPendingGmailMessages(withoutAlias.repository, 'sales@example.co.jp', null, {})
    const plain = Object.fromEntries(withoutAlias.savedDrafts[0]!.fields.map((field) => [field.key, field.value]))
    expect(plain.rate).toBeNull()
  })

  it('confirms a fresh draft with the operator so an imported mail is a case at once', () => {
    const { repository, mocks, savedDrafts } = intakeRepository([gmailMessage()])
    const counts = createJobCaseDraftsForPendingGmailMessages(repository, 'sales@example.co.jp', operator)
    expect(counts).toEqual({ created: 1, confirmed: 1, needsAttention: 0, failed: 0 })
    expect(mocks.confirmJobCaseReview).toHaveBeenCalledTimes(1)
    const call = mocks.confirmJobCaseReview.mock.calls[0]!
    expect(call[1]).toBe('op-1')
    expect(call[2]).toBe('HR')
    const input = call[0] as { reviewId: string; reviewRevision: number; privacyReviewed: boolean; fields: Array<{ confirmed: boolean }> }
    expect(input).toMatchObject({ reviewId: savedDrafts[0]!.reviewId, reviewRevision: 1, privacyReviewed: true })
    expect(input.fields.length).toBeGreaterThan(0)
    expect(input.fields.every((field) => field.confirmed)).toBe(true)
  })

  it('keeps a refused draft awaiting review and continues with the next message', () => {
    const { repository, mocks } = intakeRepository([
      gmailMessage(),
      gmailMessage({ gmailMessageId: 'msg-0002', redactedSubject: 'PHP 案件のご紹介', businessFingerprint: 'a'.repeat(64) })
    ])
    mocks.confirmJobCaseReview.mockImplementationOnce(() => {
      throw new Error('案件名は必須です。')
    })
    const counts = createJobCaseDraftsForPendingGmailMessages(repository, 'sales@example.co.jp', operator)
    expect(counts).toEqual({ created: 2, confirmed: 1, needsAttention: 1, failed: 0 })
  })

  it('leaves a message pending for the next sync when its draft cannot be created', () => {
    const { repository, mocks } = intakeRepository([
      gmailMessage(),
      gmailMessage({ gmailMessageId: 'msg-0002' })
    ])
    mocks.ensureGmailJobCaseSource.mockImplementationOnce(() => {
      throw new Error('database is locked')
    })
    const counts = createJobCaseDraftsForPendingGmailMessages(repository, 'sales@example.co.jp', operator)
    expect(counts).toEqual({ created: 1, confirmed: 1, needsAttention: 0, failed: 1 })
  })

  it('does not confirm anything without an operator', () => {
    const { repository, mocks } = intakeRepository([gmailMessage()])
    const counts = createJobCaseDraftsForPendingGmailMessages(repository, 'sales@example.co.jp', null)
    expect(counts).toEqual({ created: 1, confirmed: 0, needsAttention: 0, failed: 0 })
    expect(mocks.confirmJobCaseReview).not.toHaveBeenCalled()
  })
})
