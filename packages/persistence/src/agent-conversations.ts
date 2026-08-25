import { createHash } from 'node:crypto'
import { detectDirectIdentifiers } from '@privacy'
import { aiConversationSnapshotSchema } from '@shared'
import {
  type AiConversationBlock,
  type AiConversationContext,
  type AiConversationMessage,
  type AiConversationReference,
  type AiConversationSnapshot,
  type SaveAiConversationInput
} from '@shared/contracts'
import type { AiConversationRow } from './rows'

export function aiConversationContextKey(context: AiConversationContext): string {
  const immutableContext = context.assistant === 'sales-agent'
    ? { assistant: 'sales-agent' as const }
    : {
        assistant: context.assistant,
        candidateDocumentId: context.candidateDocumentId,
        interviewId: context.interviewId,
        interviewKind: context.interviewKind,
        roundNumber: context.roundNumber
      }
  return createHash('sha256').update(JSON.stringify(immutableContext)).digest('hex')
}

export function aiConversationTitle(messages: SaveAiConversationInput['messages']): string {
  const source = messages.find((message) => message.role === 'user')?.content ?? '新しい会話'
  const normalized = source.replace(/\s+/gu, ' ').trim()
  return normalized.length > 60 ? `${normalized.slice(0, 59)}…` : normalized
}

export function aiConversationFromRow(row: AiConversationRow): AiConversationSnapshot {
  const snapshot = aiConversationSnapshotSchema.parse(JSON.parse(row.payload_json))
  if (
    snapshot.id !== row.id || snapshot.revision !== row.revision || snapshot.title !== row.title ||
    aiConversationContextKey(snapshot.context) !== row.context_key ||
    snapshot.context.assistant !== row.assistant_type ||
    snapshot.context.candidateDocumentId !== row.candidate_document_id ||
    snapshot.context.interviewId !== row.interview_id ||
    snapshot.context.interviewKind !== row.interview_kind ||
    snapshot.context.roundNumber !== row.round_number
  ) throw new Error('保存済みAI会話の整合性を確認できませんでした。')
  return snapshot
}

export interface AgentReferenceTargets {
  candidateDocumentIds: ReadonlySet<string>
  jobCaseIds: ReadonlySet<string>
  matchRunIds: ReadonlySet<string>
  matchResultIds: ReadonlySet<string>
}

export interface AgentReferenceImpact {
  conversations: number
  messages: number
}

export function agentReferenceIsTargeted(reference: AiConversationReference, targets: AgentReferenceTargets): boolean {
  if (!reference.kind || !reference.objectId) return false
  if (reference.kind === 'job-case') return targets.jobCaseIds.has(reference.objectId)
  if (reference.kind === 'match-run') return targets.matchRunIds.has(reference.objectId)
  return targets.matchResultIds.has(reference.objectId)
}

export function agentErrorBlock(entityKind: 'job-case' | 'match-run' | 'match-result'): AiConversationBlock {
  const label = entityKind === 'job-case' ? '案件' : entityKind === 'match-run' ? '匹配运行' : '匹配结果'
  return {
    type: 'error',
    code: 'ENTITY_DELETED',
    entityKind,
    message: `关联${label}已删除，历史引用不再显示。`
  }
}

export function sanitizeAgentBlock(block: AiConversationBlock, targets: AgentReferenceTargets): { blocks: AiConversationBlock[]; affected: boolean } {
  if (block.type === 'job-case-cards') {
    const cards = block.cards.filter((card) => !agentReferenceIsTargeted(card.reference, targets))
    if (cards.length === block.cards.length) return { blocks: [block], affected: false }
    return cards.length > 0
      ? { blocks: [{ ...block, cards }], affected: true }
      : { blocks: [agentErrorBlock('job-case')], affected: true }
  }
  if (block.type === 'candidate-match-cards') {
    const runDeleted = targets.matchRunIds.has(block.runId)
    const cards = runDeleted
      ? []
      : block.cards.filter((card) =>
          !agentReferenceIsTargeted(card.reference, targets) &&
          (!card.sourceDocumentId || !targets.candidateDocumentIds.has(card.sourceDocumentId)))
    if (!runDeleted && cards.length === block.cards.length) return { blocks: [block], affected: false }
    return cards.length > 0
      ? { blocks: [{ ...block, cards }], affected: true }
      : { blocks: [agentErrorBlock('match-result')], affected: true }
  }
  if (block.type === 'clarification') {
    const options = block.options.filter((option) => !agentReferenceIsTargeted(option, targets))
    if (options.length === block.options.length) return { blocks: [block], affected: false }
    return options.length > 0
      ? { blocks: [{ ...block, options }], affected: true }
      : { blocks: [agentErrorBlock('job-case')], affected: true }
  }
  if (block.type === 'match-run-explanation') {
    const runAffected = targets.matchRunIds.has(block.facts.runId)
    const resultAffected = block.facts.candidate
      ? agentReferenceIsTargeted(block.facts.candidate.reference, targets)
      : false
    return runAffected || resultAffected
      ? { blocks: [agentErrorBlock(runAffected ? 'match-run' : 'match-result')], affected: true }
      : { blocks: [block], affected: false }
  }
  if (block.type === 'candidate-profile-evidence' || block.type === 'candidate-interview-evidence') {
    const sourceDocumentId = block.facts.candidate?.sourceDocumentId
    return sourceDocumentId && targets.candidateDocumentIds.has(sourceDocumentId)
      ? { blocks: [{ type: 'error', code: 'ENTITY_DELETED', message: '关联候选人已删除，历史证据和文件入口已移除。' }], affected: true }
      : { blocks: [block], affected: false }
  }
  if (block.type === 'candidate-draft-facts') {
    return targets.candidateDocumentIds.has(block.facts.documentId)
      ? { blocks: [{ type: 'error', code: 'ENTITY_DELETED', message: '关联候选人已删除，历史草稿和文件入口已移除。' }], affected: true }
      : { blocks: [block], affected: false }
  }
  if (block.type === 'resume-import') {
    const imported = block.imported.filter((item) => !targets.candidateDocumentIds.has(item.documentId))
    if (imported.length === block.imported.length) return { blocks: [block], affected: false }
    return imported.length > 0
      ? { blocks: [{ ...block, imported }], affected: true }
      : { blocks: [{ type: 'error', code: 'ENTITY_DELETED', message: '关联候选人已删除，历史导入记录和文件入口已移除。' }], affected: true }
  }
  if (block.type === 'system-access') {
    const candidateDeleted = block.destination === 'candidate' &&
      targets.candidateDocumentIds.has(block.sourceDocumentId)
    const jobCaseDeleted = block.destination === 'matching' && block.jobCaseId
      ? targets.jobCaseIds.has(block.jobCaseId)
      : false
    return candidateDeleted || jobCaseDeleted
      ? { blocks: [{ type: 'error', code: 'ENTITY_DELETED', message: '关联业务对象已删除，历史系统入口已移除。' }], affected: true }
      : { blocks: [block], affected: false }
  }
  return { blocks: [block], affected: false }
}

export function agentMessageHasTarget(message: AiConversationMessage, targets: AgentReferenceTargets): boolean {
  return (message.references ?? []).some((reference) => agentReferenceIsTargeted(reference, targets)) ||
    (message.blocks ?? []).some((block) => sanitizeAgentBlock(block, targets).affected)
}

export function agentMessageHasDirectIdentifier(message: AiConversationMessage, knownPersonNames: string[]): boolean {
  return message.role === 'user' && detectDirectIdentifiers(message.content, knownPersonNames).length > 0
}
