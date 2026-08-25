import { describe, expect, it } from 'vitest'
import type { AiConversationBlock } from '@shared'
import { sanitizeAgentBlock, type AgentReferenceTargets } from './agent-conversations'

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
