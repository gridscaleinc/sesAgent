import { describe, expect, it } from 'vitest'
import type { AiConversationBlock } from '@shared'
import {
  agentMessageHasIntakeDraftTarget,
  sanitizeAgentBlock,
  sanitizeIntakeBatch,
  type AgentReferenceTargets
} from './agent-conversations'

const sourceDocumentId = '11111111-1111-4111-8111-111111111111'
const targets: AgentReferenceTargets = {
  candidateDocumentIds: new Set([sourceDocumentId]),
  jobCaseIds: new Set(),
  matchRunIds: new Set(),
  matchResultIds: new Set()
}

describe('sales Agent conversation sanitization', () => {
  it('removes resume and draft file routes when the candidate source is deleted', () => {
    const importBlock: AiConversationBlock = {
      type: 'resume-import', imported: [{ documentId: sourceDocumentId, label: 'RESUME_1', ordinal: 1 }], failedCount: 0
    }
    const draftBlock: AiConversationBlock = {
      type: 'candidate-draft-facts',
      facts: {
        documentId: sourceDocumentId, label: 'RESUME_1', confirmed: false, reviewStatus: 'awaiting-review',
        fields: [], projects: []
      }
    }

    const sanitizedImport = sanitizeAgentBlock(importBlock, targets)
    const sanitizedDraft = sanitizeAgentBlock(draftBlock, targets)
    expect(sanitizedImport).toMatchObject({ affected: true, blocks: [{ type: 'error', code: 'ENTITY_DELETED' }] })
    expect(sanitizedDraft).toMatchObject({ affected: true, blocks: [{ type: 'error', code: 'ENTITY_DELETED' }] })
    expect(JSON.stringify([sanitizedImport, sanitizedDraft])).not.toContain(sourceDocumentId)
  })

  it('tombstones deleted intake drafts in place and drops them from the batch pointer', () => {
    const reviewId = '55555555-5555-4555-8555-555555555555'
    const survivingId = '66666666-6666-4666-8666-666666666666'
    const intakeBatchId = '77777777-7777-4777-8777-777777777777'
    const draftTargets: AgentReferenceTargets = { ...targets, candidateDocumentIds: new Set(), jobCaseReviewIds: new Set([reviewId]) }
    const card = (id: string, ordinal: number) => ({
      reviewId: id, label: `DRAFT_${ordinal}`, ordinal, outcome: 'created' as const, title: `案件 ${ordinal}`,
      reviewStatus: 'awaiting-review' as const, lifecycle: 'active' as const, jobCase: null,
      fields: [{ key: 'title' as const, label: '案件名', value: `案件 ${ordinal}`, status: 'needs_review' as const }],
      warningCodes: [], status: 'current' as const
    })
    const block: AiConversationBlock = { type: 'job-case-draft-cards', intakeBatchId, cards: [card(reviewId, 1), card(survivingId, 2)] }

    const sanitized = sanitizeAgentBlock(block, draftTargets)
    expect(sanitized.affected).toBe(true)
    expect(sanitized.blocks[0]).toMatchObject({
      type: 'job-case-draft-cards',
      cards: [
        { reviewId, ordinal: 1, status: 'deleted', title: null, fields: [], jobCase: null },
        { reviewId: survivingId, ordinal: 2, status: 'current', title: '案件 2' }
      ]
    })
    expect(JSON.stringify(sanitized)).not.toContain('案件 1')
    expect(sanitizeAgentBlock({ type: 'job-case-draft-cards', intakeBatchId, cards: [card(reviewId, 1)] }, draftTargets))
      .toMatchObject({ affected: true, blocks: [{ type: 'error', code: 'ENTITY_DELETED' }] })
    expect(sanitizeIntakeBatch({ intakeBatchId, messageId: 'm', reviewIds: [reviewId, survivingId] }, draftTargets))
      .toEqual({ intakeBatchId, messageId: 'm', reviewIds: [survivingId] })
    expect(sanitizeIntakeBatch({ intakeBatchId, messageId: 'm', reviewIds: [reviewId] }, draftTargets)).toBeNull()
  })

  it('drops the drafted group message of a deleted case, text and all', () => {
    const deletedReviewId = '88888888-8888-4888-8888-888888888888'
    const survivingReviewId = '99999999-9999-4999-8999-999999999999'
    const deletedCaseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const broadcastTargets: AgentReferenceTargets = {
      ...targets, candidateDocumentIds: new Set(), jobCaseIds: new Set([deletedCaseId])
    }
    const card = (reviewId: string, jobCaseId: string, ordinal: number) => ({
      reviewId, jobCaseId, jobCaseVersion: 1, ordinal, title: `案件 ${ordinal}`, status: 'new' as const,
      templateId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', templateRevision: 1,
      textJa: `【案件】案件 ${ordinal}`, textZh: `【案件】案件 ${ordinal}`, forbiddenJa: [], forbiddenZh: []
    })
    const block: AiConversationBlock = {
      type: 'job-case-broadcast-cards',
      queue: { new: 2, copied: 0, attention: 0 },
      cards: [card(deletedReviewId, deletedCaseId, 1), card(survivingReviewId, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 2)]
    }

    const sanitized = sanitizeAgentBlock(block, broadcastTargets)
    expect(sanitized.affected).toBe(true)
    expect(sanitized.blocks[0]).toMatchObject({
      type: 'job-case-broadcast-cards',
      cards: [{ reviewId: survivingReviewId, ordinal: 2 }]
    })
    // The deleted case's message text goes with it.
    expect(JSON.stringify(sanitized)).not.toContain('案件 1')
    // A card the deletion does not touch leaves the block untouched.
    expect(sanitizeAgentBlock(block, { ...targets, candidateDocumentIds: new Set() })).toMatchObject({ affected: false })
    // Nothing left to show becomes the standard deletion tombstone.
    expect(sanitizeAgentBlock({ ...block, cards: [card(deletedReviewId, deletedCaseId, 1)] }, broadcastTargets))
      .toMatchObject({ affected: true, blocks: [{ type: 'error', code: 'ENTITY_DELETED' }] })
    // Deleting the unconfirmed review reaches the same card.
    const byReview: AgentReferenceTargets = { ...targets, candidateDocumentIds: new Set(), jobCaseReviewIds: new Set([deletedReviewId]) }
    expect(sanitizeAgentBlock(block, byReview)).toMatchObject({ affected: true })
    // The re-read sweep has to notice it: the block carries no reference.
    const message = { id: 'm', role: 'assistant' as const, content: '群メッセージ', createdAt: '2026-08-25T00:00:00.000Z', blocks: [block] }
    expect(agentMessageHasIntakeDraftTarget(message, broadcastTargets)).toBe(true)
    expect(agentMessageHasIntakeDraftTarget(message, { ...targets, candidateDocumentIds: new Set() })).toBe(false)
  })

  it('removes a local candidate route from an otherwise saved match card', () => {
    const block: AiConversationBlock = {
      type: 'candidate-match-cards',
      runId: '22222222-2222-4222-8222-222222222222', resultHash: 'a'.repeat(64),
      cards: [{
        reference: {
          kind: 'match-result', objectId: '33333333-3333-4333-8333-333333333333', objectVersion: null,
          resultHash: 'b'.repeat(64), ordinal: 1, label: 'CANDIDATE_1', target: 'match-result:33333333-3333-4333-8333-333333333333'
        },
        candidateProfileId: '44444444-4444-4444-8444-444444444444', sourceDocumentId,
        runId: '22222222-2222-4222-8222-222222222222', rank: 1, anonymousLabel: 'CANDIDATE_1',
        fitScore: 88, matched: ['Java'], missing: [], hardFilterStatus: 'passed', projectEvidence: null, status: 'current'
      }]
    }

    const sanitized = sanitizeAgentBlock(block, targets)
    expect(sanitized).toMatchObject({ affected: true, blocks: [{ type: 'error', code: 'ENTITY_DELETED' }] })
    expect(JSON.stringify(sanitized)).not.toContain(sourceDocumentId)
  })
})
