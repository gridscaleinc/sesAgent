import { candidatePoolFingerprint } from '@matching'
import { detectDirectIdentifiers } from '@privacy'
import {
  aiConversationContextSchema,
  aiConversationSnapshotSchema,
  saveAiConversationInputSchema
} from '@shared'
import {
  type AgentEntityStatus,
  type AiConversationContext,
  type AiConversationSnapshot,
  type SaveAiConversationInput
} from '@shared/contracts'
import {
  type AgentReferenceImpact,
  type AgentReferenceTargets,
  agentMessageHasDirectIdentifier,
  agentMessageHasTarget,
  agentReferenceIsTargeted,
  aiConversationContextKey,
  aiConversationFromRow,
  aiConversationTitle,
  agentMessageHasIntakeDraftTarget,
  sanitizeAgentBlock,
  sanitizeIntakeBatch
} from '../agent-conversations'
import { type AiConversationRow } from '../rows'
import { DomainStore } from './base'

export class AgentConversationStore extends DomainStore {
  private salesAgentKnownPersonNames(targets: AgentReferenceTargets): string[] {
    if (targets.candidateDocumentIds.size === 0 && targets.matchRunIds.size === 0 && targets.matchResultIds.size === 0) return []
    const targetRows = this.database
      .prepare<[], { id: string; run_id: string; candidate_profile_id: string }>(
        'SELECT id, run_id, candidate_profile_id FROM candidate_match_results'
      )
      .all()
      .filter((row) => targets.matchRunIds.has(row.run_id) || targets.matchResultIds.has(row.id))
    const profileIds = [...new Set(targetRows.map((row) => row.candidate_profile_id))]
    const matchedSourceDocumentIds = profileIds.length === 0
      ? []
      : this.database
          .prepare<string[], { source_document_id: string }>(
            `SELECT DISTINCT source_document_id FROM candidate_profiles WHERE id IN (${profileIds.map(() => '?').join(', ')})`
          )
          .all(...profileIds)
          .map((row) => row.source_document_id)
    const sourceDocumentIds = [...new Set([...targets.candidateDocumentIds, ...matchedSourceDocumentIds])]
    return [...new Set(sourceDocumentIds.flatMap((sourceDocumentId) => {
      const displayName = this.stores.candidates.getCandidateLocalIdentity(sourceDocumentId).displayName
      return displayName ? [displayName] : []
    }))]
  }

  countSalesAgentReferences(targets: AgentReferenceTargets): AgentReferenceImpact {
    const rows = this.database
      .prepare<[], AiConversationRow>(
        `SELECT id, assistant_type, context_key, candidate_document_id, interview_id, interview_kind,
                round_number, title, payload_json, revision, created_at, updated_at
         FROM ai_conversations
         WHERE assistant_type = 'sales-agent'
         ORDER BY updated_at DESC
         LIMIT 50`
      )
      .all()
    const knownPersonNames = this.salesAgentKnownPersonNames(targets)
    let conversations = 0
    let messages = 0
    for (const row of rows) {
      const snapshot = aiConversationFromRow(row)
      const affectedMessages = snapshot.messages.filter((message) => agentMessageHasTarget(message, targets)).length
      const state = snapshot.salesAgentState
      const affectedState = Boolean(
        state && (
          (state.selectedJobCaseRef && agentReferenceIsTargeted(state.selectedJobCaseRef, targets)) ||
          (state.lastMatchRunId && targets.matchRunIds.has(state.lastMatchRunId))
        )
      )
      if (affectedMessages > 0 || affectedState) {
        conversations += 1
        messages += snapshot.messages.filter((message) =>
          agentMessageHasTarget(message, targets) || agentMessageHasDirectIdentifier(message, knownPersonNames)
        ).length
      }
    }
    return { conversations, messages }
  }

  sanitizeSalesAgentConversations(targets: AgentReferenceTargets, now: Date): AgentReferenceImpact {
    const rows = this.database
      .prepare<[], AiConversationRow>(
        `SELECT id, assistant_type, context_key, candidate_document_id, interview_id, interview_kind,
                round_number, title, payload_json, revision, created_at, updated_at
         FROM ai_conversations
         WHERE assistant_type = 'sales-agent'
         ORDER BY updated_at DESC
         LIMIT 50`
      )
      .all()
    const knownPersonNames = this.salesAgentKnownPersonNames(targets)
    let conversations = 0
    let messages = 0
    for (const row of rows) {
      const snapshot = aiConversationFromRow(row)
      const state = snapshot.salesAgentState
      const stateAffected = Boolean(
        state && (
          (state.selectedJobCaseRef && agentReferenceIsTargeted(state.selectedJobCaseRef, targets)) ||
          (state.lastMatchRunId && targets.matchRunIds.has(state.lastMatchRunId)) ||
          (state.lastIntakeBatch && sanitizeIntakeBatch(state.lastIntakeBatch, targets)?.reviewIds.length !== state.lastIntakeBatch.reviewIds.length)
        )
      )
      const conversationHasTarget = snapshot.messages.some((message) =>
        agentMessageHasTarget(message, targets) || agentMessageHasIntakeDraftTarget(message, targets))
      if (!conversationHasTarget && !stateAffected) continue

      let conversationAffected = false
      let messageAffected = 0
      const nextMessages = snapshot.messages.flatMap((message) => {
        const referenceAffected = (message.references ?? []).some((reference) => agentReferenceIsTargeted(reference, targets))
        let blockAffected = false
        const blocks = (message.blocks ?? []).flatMap((block) => {
          const sanitized = sanitizeAgentBlock(block, targets)
          blockAffected ||= sanitized.affected
          return sanitized.blocks
        })
        const directIdentifierAffected = agentMessageHasDirectIdentifier(message, knownPersonNames)
        if (!referenceAffected && !blockAffected && !directIdentifierAffected) return message
        conversationAffected = true
        messageAffected += 1
        if (message.role === 'user' && (referenceAffected || directIdentifierAffected)) return []
        const references = message.references?.filter((reference) => !agentReferenceIsTargeted(reference, targets))
        return {
          ...message,
          content: message.role === 'assistant' ? '关联对象已删除，历史内容已降级为删除提示。' : message.content,
          blocks,
          ...(references ? { references } : {})
        }
      })
      if (!conversationAffected && !stateAffected) continue
      const nextState = stateAffected && state
        ? {
            ...state,
            selectedJobCaseRef: state.selectedJobCaseRef && agentReferenceIsTargeted(state.selectedJobCaseRef, targets)
              ? null
              : state.selectedJobCaseRef,
            lastMatchRunId: state.lastMatchRunId && targets.matchRunIds.has(state.lastMatchRunId)
              ? null
              : state.lastMatchRunId,
            lastIntakeBatch: sanitizeIntakeBatch(state.lastIntakeBatch, targets)
          }
        : state
      const nextSnapshot = aiConversationSnapshotSchema.parse({
        ...snapshot,
        title: detectDirectIdentifiers(snapshot.title, knownPersonNames).length > 0 ? '已删除的案件匹配会话' : snapshot.title,
        messages: nextMessages,
        salesAgentState: nextState,
        revision: row.revision + 1,
        updatedAt: now.toISOString()
      })
      const updated = this.database
        .prepare(
          `UPDATE ai_conversations
           SET title = ?, payload_json = ?, revision = ?, updated_at = ?
           WHERE id = ? AND revision = ?`
        )
        .run(nextSnapshot.title, JSON.stringify(nextSnapshot), nextSnapshot.revision, nextSnapshot.updatedAt, row.id, row.revision)
      if (updated.changes !== 1) throw new Error('AI会话在删除引用时发生并发更新。')
      conversations += 1
      messages += messageAffected
    }
    return { conversations, messages }
  }

  private agentMatchReferenceStatus(runId: string, resultId: string | null): AgentEntityStatus {
    const run = this.database
      .prepare<[string], {
        id: string
        job_case_id: string | null
        job_case_version: number | null
        candidate_pool_fingerprint: string | null
        candidate_profile_versions_json: string | null
      }>(
        `SELECT id, job_case_id, job_case_version, candidate_pool_fingerprint, candidate_profile_versions_json
         FROM candidate_match_runs WHERE id = ?`
      )
      .get(runId)
    if (!run || !run.job_case_id || !run.job_case_version || !run.candidate_pool_fingerprint || !run.candidate_profile_versions_json) return 'deleted'
    const jobCaseExists = this.database
      .prepare<[string], { present: number }>('SELECT 1 AS present FROM job_cases WHERE id = ?')
      .get(run.job_case_id)
    if (!jobCaseExists) return 'deleted'
    const activeCase = this.stores.jobCases.listActiveJobCases().find((item) => item.id === run.job_case_id)
    if (!activeCase) return 'stale'
    const result = resultId
      ? this.database
          .prepare<[string, string], { candidate_profile_id: string; candidate_profile_version: number }>(
            'SELECT candidate_profile_id, candidate_profile_version FROM candidate_match_results WHERE id = ? AND run_id = ?'
          )
          .get(resultId, runId)
      : this.database
          .prepare<[string], { candidate_profile_id: string; candidate_profile_version: number }>(
            'SELECT candidate_profile_id, candidate_profile_version FROM candidate_match_results WHERE run_id = ? ORDER BY result_rank ASC LIMIT 1'
          )
          .get(runId)
    if (!result) return 'deleted'
    const profile = this.database
      .prepare<[string], { version: number; status: 'current' | 'stale' | 'superseded' }>(
        'SELECT version, status FROM candidate_profiles WHERE id = ?'
      )
      .get(result.candidate_profile_id)
    if (!profile) return 'deleted'
    const currentPool = this.stores.candidates.listEligibleTalentProfiles()
    const currentVersions = currentPool
      .map((item) => ({ id: item.id, version: item.profileVersion }))
      .toSorted((left, right) => left.id.localeCompare(right.id) || left.version - right.version)
    const savedVersions = JSON.parse(run.candidate_profile_versions_json) as Array<{ id: string; version: number }>
    const samePool = JSON.stringify(currentVersions) === JSON.stringify(savedVersions)
    return activeCase.version === run.job_case_version && profile.status === 'current' && profile.version === result.candidate_profile_version &&
      samePool && candidatePoolFingerprint(currentPool) === run.candidate_pool_fingerprint
      ? 'current'
      : 'stale'
  }

  private agentMatchCandidateStatus(runId: string, candidateProfileId: string): AgentEntityStatus {
    const result = this.database
      .prepare<[string, string], { id: string }>(
        'SELECT id FROM candidate_match_results WHERE run_id = ? AND candidate_profile_id = ? ORDER BY result_rank ASC LIMIT 1'
      )
      .get(runId, candidateProfileId)
    return result ? this.agentMatchReferenceStatus(runId, result.id) : 'deleted'
  }

  private hydrateSalesAgentSnapshot(snapshot: AiConversationSnapshot): AiConversationSnapshot {
    if (snapshot.context.assistant !== 'sales-agent') return snapshot
    const activeCases = new Map(this.stores.jobCases.listActiveJobCases().map((item) => [item.id, item]))
    const existingCaseIds = new Set(this.database.prepare<[], { id: string }>('SELECT id FROM job_cases').all().map((row) => row.id))
    const currentProfiles = new Map(this.database
      .prepare<[], { id: string; version: number; status: 'current' | 'stale' | 'superseded' }>('SELECT id, version, status FROM candidate_profiles')
      .all()
      .map((row) => [row.id, row] as const))
    let changed = false
    const messages = snapshot.messages.map((message) => {
      if (!message.blocks || message.blocks.length === 0) return message
      let messageChanged = false
      const blocks = message.blocks.map((block) => {
        if (block.type === 'job-case-cards') {
          const cards = block.cards.map((card) => {
            const active = activeCases.get(card.reference.objectId)
            const status: AgentEntityStatus = !existingCaseIds.has(card.reference.objectId)
              ? 'deleted'
              : active?.version === card.reference.objectVersion ? 'current' : 'stale'
            if (card.status !== status) messageChanged = true
            return status === card.status ? card : { ...card, status }
          })
          return cards === block.cards ? block : { ...block, cards }
        }
        if (block.type === 'job-case-draft-cards') {
          // Drafts move on after the paste - confirmed, archived, deleted - so
          // the persisted card is re-read from the review it points at.
          const cards = block.cards.map((card) => {
            if (card.status === 'deleted') return card
            const facts = this.stores.jobCases.getAgentJobCaseDraftFacts(card.reviewId, card.label)
            const next = facts
              ? { ...card, ...facts, ordinal: card.ordinal, outcome: card.outcome }
              : { ...card, title: null, fields: [], warningCodes: [], jobCase: null, status: 'deleted' as const }
            if (JSON.stringify(next) !== JSON.stringify(card)) messageChanged = true
            return next
          })
          return messageChanged ? { ...block, cards } : block
        }
        if (block.type === 'candidate-match-cards') {
          const cards = block.cards.map((card) => {
            const status = this.agentMatchReferenceStatus(block.runId, card.reference.objectId)
            if (card.status !== status) messageChanged = true
            const profile = currentProfiles.get(card.candidateProfileId)
            const profileStatus = !profile ? 'deleted' : profile.status === 'current' ? status : 'stale'
            const nextStatus: AgentEntityStatus = profileStatus === 'deleted' ? 'deleted' : status
            if (nextStatus !== card.status) messageChanged = true
            return nextStatus === card.status ? card : { ...card, status: nextStatus }
          })
          return cards === block.cards ? block : { ...block, cards }
        }
        if (block.type === 'match-run-explanation') {
          const validity = this.agentMatchReferenceStatus(block.facts.runId, block.facts.candidate?.reference.objectId ?? null)
          const candidate = block.facts.candidate
            ? { ...block.facts.candidate, status: validity }
            : null
          if (validity !== block.facts.validity || candidate?.status !== block.facts.candidate?.status) messageChanged = true
          return messageChanged
            ? { ...block, facts: { ...block.facts, validity, candidate } }
            : block
        }
        if (block.type === 'candidate-profile-evidence') {
          const candidate = block.facts.candidate
          const validity = candidate
            ? this.agentMatchCandidateStatus(block.facts.runId, candidate.candidateProfileId)
            : block.facts.validity
          if (validity === block.facts.validity) return block
          messageChanged = true
          return { ...block, facts: { ...block.facts, validity } }
        }
        if (block.type === 'candidate-interview-evidence') {
          const candidate = block.facts.candidate
          let validity = candidate
            ? this.agentMatchCandidateStatus(block.facts.runId, candidate.candidateProfileId)
            : block.facts.validity
          const sourceDocumentId = candidate?.sourceDocumentId ?? (candidate
            ? this.stores.candidates.getCandidateSourceDocumentId(candidate.candidateProfileId)
            : null)
          if (validity === 'current' && sourceDocumentId) {
            const currentInterviews = this.stores.candidateInterviews.listCandidateInterviews()
              .filter((interview) => interview.sourceDocumentId === sourceDocumentId)
              .map((interview) => `${interview.kind}:${interview.roundNumber}:${interview.updatedAt}`)
              .toSorted()
            const savedInterviews = block.facts.interviews
              .map((interview) => `${interview.kind}:${interview.roundNumber}:${interview.updatedAt}`)
              .toSorted()
            if (JSON.stringify(currentInterviews) !== JSON.stringify(savedInterviews)) validity = 'stale'
          }
          if (validity === block.facts.validity) return block
          messageChanged = true
          return { ...block, facts: { ...block.facts, validity } }
        }
        return block
      })
      if (!messageChanged) return message
      changed = true
      return { ...message, blocks }
    })
    if (!changed) return snapshot
    return aiConversationSnapshotSchema.parse({ ...snapshot, messages })
  }

  listAiConversations(rawContext: AiConversationContext): AiConversationSnapshot[] {
    const context = aiConversationContextSchema.parse(rawContext)
    const key = aiConversationContextKey(context)
    return this.database
      .prepare<[string], AiConversationRow>(
        `SELECT id, assistant_type, context_key, candidate_document_id, interview_id, interview_kind,
                round_number, title, payload_json, revision, created_at, updated_at
         FROM ai_conversations
         WHERE context_key = ?
         ORDER BY updated_at DESC
         LIMIT 50`
      )
      .all(key)
      .map(aiConversationFromRow)
      .map((snapshot) => this.hydrateSalesAgentSnapshot(snapshot))
  }

  getAiConversation(conversationId: string): AiConversationSnapshot | null {
    const row = this.database
      .prepare<[string], AiConversationRow>(
        `SELECT id, assistant_type, context_key, candidate_document_id, interview_id, interview_kind,
                round_number, title, payload_json, revision, created_at, updated_at
         FROM ai_conversations WHERE id = ?`
      )
      .get(conversationId)
    return row ? this.hydrateSalesAgentSnapshot(aiConversationFromRow(row)) : null
  }

  saveAiConversation(rawInput: SaveAiConversationInput, now = new Date()): AiConversationSnapshot {
    const input = saveAiConversationInputSchema.parse(rawInput)
    const contextKey = aiConversationContextKey(input.context)
    const existing = this.database
      .prepare<[string], AiConversationRow>(
        `SELECT id, assistant_type, context_key, candidate_document_id, interview_id, interview_kind,
                round_number, title, payload_json, revision, created_at, updated_at
         FROM ai_conversations WHERE id = ?`
      )
      .get(input.conversationId)
    const existingSnapshot = existing ? aiConversationFromRow(existing) : null
    if (existing) {
      if (existing.revision !== input.expectedRevision) throw new Error('AI会話が更新されました。履歴を再読み込みしてください。')
      if (existing.context_key !== contextKey) throw new Error('AI会話を別の候補者または面談へ移動できません。')
      if (
        existing.assistant_type !== input.context.assistant ||
        existing.candidate_document_id !== input.context.candidateDocumentId ||
        existing.interview_id !== input.context.interviewId ||
        existing.interview_kind !== input.context.interviewKind ||
        existing.round_number !== input.context.roundNumber
      ) throw new Error('AI会話の不可変コンテキストを変更できません。')
    } else if (input.expectedRevision !== null) {
      throw new Error('AI会話が見つかりません。履歴を再読み込みしてください。')
    }

    if (input.context.interviewId) {
      const interview = this.database
        .prepare<[string], { source_document_id: string; kind: 'recruiting' | 'client'; round_number: number }>(
          'SELECT source_document_id, kind, round_number FROM candidate_interview_sessions WHERE id = ?'
        )
        .get(input.context.interviewId)
      if (
        !interview || interview.source_document_id !== input.context.candidateDocumentId ||
        interview.kind !== input.context.interviewKind || interview.round_number !== input.context.roundNumber
      ) throw new Error('AI会話の面談コンテキストが現在の候補者記録と一致しません。')
    }

    const timestamp = now.toISOString()
    const snapshot = aiConversationSnapshotSchema.parse({
      id: input.conversationId,
      branchRootConversationId: input.branchRootConversationId ?? existingSnapshot?.branchRootConversationId,
      context: input.context,
      title: aiConversationTitle(input.messages),
      messages: input.messages,
      salesAgentState: input.salesAgentState,
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.created_at ?? timestamp,
      updatedAt: timestamp
    })
    if (existing) {
      const updated = this.database.prepare(
        `UPDATE ai_conversations
         SET title = ?, payload_json = ?, revision = ?, updated_at = ?
         WHERE id = ? AND revision = ?`
      ).run(snapshot.title, JSON.stringify(snapshot), snapshot.revision, timestamp, snapshot.id, existing.revision)
      if (updated.changes !== 1) throw new Error('AI会話が更新されました。履歴を再読み込みしてください。')
    } else {
      this.database.prepare(
        `INSERT INTO ai_conversations(
           id, assistant_type, context_key, candidate_document_id, interview_id, interview_kind,
           round_number, title, payload_json, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(
        snapshot.id,
        snapshot.context.assistant,
        contextKey,
        snapshot.context.candidateDocumentId,
        snapshot.context.interviewId,
        snapshot.context.interviewKind,
        snapshot.context.roundNumber,
        snapshot.title,
        JSON.stringify(snapshot),
        timestamp,
        timestamp
      )
    }
    return snapshot
  }

  deleteAiConversations(conversationIds: string[]): string[] {
    if (conversationIds.length === 0) return []
    const remove = this.database.prepare('DELETE FROM ai_conversations WHERE id = ?')
    const deleted: string[] = []
    this.database.transaction(() => {
      for (const id of conversationIds) {
        if (remove.run(id).changes === 1) deleted.push(id)
      }
    })()
    return deleted
  }
}
