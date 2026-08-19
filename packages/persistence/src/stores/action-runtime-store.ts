import { randomUUID } from 'node:crypto'
import { detectDirectIdentifiers } from '@privacy'
import { aiConversationSnapshotSchema } from '@shared'
import {
  type ActionApprovalSummary,
  type ActionRunStatus,
  type DomainToolName,
  type ResolveActionApprovalInput
} from '@shared/contracts'
import { type ActionApprovalRow } from '../rows'
import { DomainStore } from './base'

export class ActionRuntimeStore extends DomainStore {
  createActionRun(input: {
    toolName: DomainToolName
    workTaskId: string | null
    origin: 'work-task' | 'user-command' | 'managed-connector' | 'system'
    scopeId: string
    scopeFingerprint: string
    inputHash: string
    contentRevision: string | null
    status: ActionRunStatus
    idempotencyKey: string
    conversationId?: string | null
    turnId?: string | null
  }): { id: string; status: ActionRunStatus } {
    if (!/^[a-f0-9]{64}$/u.test(input.scopeFingerprint) || !/^[a-f0-9]{64}$/u.test(input.inputHash)) {
      throw new Error('Action runtime hashes must be SHA-256 values.')
    }
    const now = new Date().toISOString()
    const existing = this.database.prepare<[
      DomainToolName, string
    ], {
      id: string
      status: ActionRunStatus
      work_task_id: string | null
      origin: string
      scope_id: string
      scope_fingerprint: string
      input_hash: string
      content_revision: string | null
      conversation_id: string | null
      turn_id: string | null
    }>(
      `SELECT id, status, work_task_id, conversation_id, turn_id, origin, scope_id, scope_fingerprint, input_hash, content_revision
       FROM action_runs WHERE tool_name = ? AND idempotency_key = ?`
    ).get(input.toolName, input.idempotencyKey)
    if (existing) {
      const sameInvocation = existing.work_task_id === input.workTaskId &&
        existing.conversation_id === (input.conversationId ?? null) &&
        existing.turn_id === (input.turnId ?? null) &&
        existing.origin === input.origin && existing.scope_id === input.scopeId &&
        existing.scope_fingerprint === input.scopeFingerprint && existing.input_hash === input.inputHash &&
        existing.content_revision === input.contentRevision
      if (!sameInvocation) throw new Error('Action idempotency key collides with a different invocation.')
      return { id: existing.id, status: existing.status }
    }
    const id = randomUUID()
    this.database.transaction(() => {
      this.database.prepare(
        `INSERT INTO action_runs(
          id, tool_name, tool_version, work_task_id, conversation_id, turn_id, origin, scope_id, scope_fingerprint, input_hash,
          content_revision, status, idempotency_key, processing_job_id, result_hash, error_code, created_at, updated_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`
      ).run(id, input.toolName, input.workTaskId, input.conversationId ?? null, input.turnId ?? null,
        input.origin, input.scopeId, input.scopeFingerprint, input.inputHash,
        input.contentRevision, input.status, input.idempotencyKey, now, now)
      this.appendActionEvent(id, 'proposed', { toolName: input.toolName, scopeId: input.scopeId }, now)
    })()
    return { id, status: input.status }
  }

  linkActionRunToConversation(actionRunId: string, conversationId: string, turnId: string): void {
    if (!conversationId || !turnId || turnId.length > 128) {
      throw new Error('ActionRun の会話関連付けには会話IDと有効な turn_id が必要です。')
    }
    const conversation = this.database
      .prepare<[string], { assistant_type: string; payload_json: string }>(
        'SELECT assistant_type, payload_json FROM ai_conversations WHERE id = ?'
      )
      .get(conversationId)
    if (!conversation) throw new Error('関連付け先の会話が見つかりません。')
    if (conversation.assistant_type !== 'sales-agent') {
      throw new Error('ActionRun は Sales Agent 会話にのみ関連付けられます。')
    }
    const snapshot = aiConversationSnapshotSchema.parse(JSON.parse(conversation.payload_json))
    if (!snapshot.messages.some((message) => message.turnId === turnId)) {
      throw new Error('ActionRun の turn_id が会話履歴に存在しません。')
    }

    const actionRun = this.database
      .prepare<[string], { conversation_id: string | null; turn_id: string | null }>(
        'SELECT conversation_id, turn_id FROM action_runs WHERE id = ?'
      )
      .get(actionRunId)
    if (!actionRun) throw new Error('ActionRun が見つかりません。')
    if (actionRun.conversation_id === conversationId && actionRun.turn_id === turnId) return
    if (actionRun.conversation_id !== null || actionRun.turn_id !== null) {
      throw new Error('ActionRun はすでに別の会話または turn に関連付けられています。')
    }

    const updated = this.database.transaction(() => this.database
      .prepare(
        `UPDATE action_runs
         SET conversation_id = ?, turn_id = ?, updated_at = ?
         WHERE id = ? AND conversation_id IS NULL AND turn_id IS NULL`
      )
      .run(conversationId, turnId, new Date().toISOString(), actionRunId))()
    if (updated.changes !== 1) {
      const current = this.database
        .prepare<[string], { conversation_id: string | null; turn_id: string | null }>(
          'SELECT conversation_id, turn_id FROM action_runs WHERE id = ?'
        )
        .get(actionRunId)
      if (current?.conversation_id === conversationId && current.turn_id === turnId) return
      throw new Error('ActionRun は別の会話または turn と同時に関連付けられました。')
    }
    const linked = this.database
      .prepare<[string], { conversation_id: string | null; turn_id: string | null }>(
        'SELECT conversation_id, turn_id FROM action_runs WHERE id = ?'
      )
      .get(actionRunId)
    if (linked?.conversation_id !== conversationId || linked.turn_id !== turnId) {
      throw new Error('ActionRun の会話関連付けを検証できませんでした。')
    }
  }

  updateActionRun(id: string, status: ActionRunStatus, options: { processingJobId?: string | null; resultHash?: string | null; errorCode?: string | null } = {}): void {
    const updated = this.database.prepare(
      `UPDATE action_runs SET status = ?, processing_job_id = COALESCE(?, processing_job_id),
       result_hash = ?, error_code = ?, updated_at = ? WHERE id = ?`
    ).run(status, options.processingJobId ?? null, options.resultHash ?? null, options.errorCode ?? null, new Date().toISOString(), id)
    if (updated.changes !== 1) throw new Error('Action run not found.')
    const eventType = status === 'running' ? 'execution_started'
      : status === 'succeeded' ? 'execution_finished'
        : status === 'failed' ? 'execution_failed'
          : status === 'cancelled' ? 'cancelled'
            : status === 'blocked' ? 'blocked' : 'policy_evaluated'
    this.appendActionEvent(id, eventType, { status, errorCode: options.errorCode ?? null })
  }

  getActionRunStatus(id: string): ActionRunStatus | null {
    return this.database.prepare<[string], { status: ActionRunStatus }>('SELECT status FROM action_runs WHERE id = ?').get(id)?.status ?? null
  }

  requestActionApproval(input: { actionRunId: string; reason: string; safeSummary: string; expiresAt: string }): ActionApprovalSummary {
    if (detectDirectIdentifiers(input.safeSummary).length > 0) {
      throw new Error('Action approval summary must not contain direct identifiers.')
    }
    const existing = this.database.prepare<[string], { id: string }>(
      'SELECT id FROM approval_requests WHERE action_run_id = ?'
    ).get(input.actionRunId)
    if (existing) {
      const approval = this.getActionApproval(existing.id)
      if (!approval) throw new Error('Existing approval request could not be read.')
      return approval
    }
    const now = new Date().toISOString()
    const id = randomUUID()
    this.database.transaction(() => {
      this.database.prepare(
        `INSERT INTO approval_requests(id, action_run_id, status, reason, safe_summary, expires_at, resolved_by, resolved_at, created_at)
         VALUES (?, ?, 'pending', ?, ?, ?, NULL, NULL, ?)`
      ).run(id, input.actionRunId, input.reason, input.safeSummary, input.expiresAt, now)
      this.database.prepare("UPDATE action_runs SET status = 'awaiting_approval', updated_at = ? WHERE id = ?").run(now, input.actionRunId)
      this.appendActionEvent(input.actionRunId, 'approval_requested', { reason: input.reason }, now)
    })()
    const approval = this.getActionApproval(id)
    if (!approval) throw new Error('Approval request could not be created.')
    return approval
  }

  private actionApprovalFromRow(row: ActionApprovalRow): ActionApprovalSummary {
    return {
      id: row.id, actionRunId: row.action_run_id, toolName: row.tool_name, workTaskId: row.work_task_id,
      status: row.status, reason: row.reason, safeSummary: row.safe_summary, inputHash: row.input_hash,
      contentRevision: row.content_revision, expiresAt: row.expires_at, createdAt: row.created_at, resolvedAt: row.resolved_at
    }
  }

  getActionApproval(id: string): ActionApprovalSummary | null {
    const row = this.database.prepare<[string], ActionApprovalRow>(
      `SELECT a.id, a.action_run_id, r.tool_name, r.work_task_id, a.status, a.reason, a.safe_summary,
       r.input_hash, r.content_revision, a.expires_at, a.created_at, a.resolved_at
       FROM approval_requests a JOIN action_runs r ON r.id = a.action_run_id WHERE a.id = ?`
    ).get(id)
    return row ? this.actionApprovalFromRow(row) : null
  }

  listActionApprovals(now = new Date()): ActionApprovalSummary[] {
    this.expirePendingActionApprovals(now)
    const rows = this.database.prepare<[], ActionApprovalRow>(
      `SELECT a.id, a.action_run_id, r.tool_name, r.work_task_id, a.status, a.reason, a.safe_summary,
       r.input_hash, r.content_revision, a.expires_at, a.created_at, a.resolved_at
       FROM approval_requests a JOIN action_runs r ON r.id = a.action_run_id
       WHERE a.status = 'pending' ORDER BY a.created_at DESC`
    ).all()
    return rows.map((row) => this.actionApprovalFromRow(row))
  }

  resolveActionApproval(input: ResolveActionApprovalInput, actor: string): ActionApprovalSummary {
    this.expirePendingActionApprovals(new Date())
    const current = this.getActionApproval(input.approvalId)
    if (!current) throw new Error('Approval request not found.')
    if (current.status !== 'pending' || new Date(current.expiresAt).getTime() <= Date.now()) {
      throw new Error('Approval request is no longer actionable.')
    }
    const now = new Date().toISOString()
    const status = input.decision === 'approve' ? 'approved' : 'denied'
    this.database.transaction(() => {
      const update = this.database.prepare(
        "UPDATE approval_requests SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'pending'"
      ).run(status, actor, now, input.approvalId)
      if (update.changes !== 1) throw new Error('Approval request was already resolved.')
      this.database.prepare('UPDATE action_runs SET status = ?, updated_at = ? WHERE id = ?')
        .run(input.decision === 'approve' ? 'awaiting_foreground_confirmation' : 'cancelled', now, current.actionRunId)
      this.appendActionEvent(current.actionRunId, 'approval_resolved', { decision: input.decision }, now)
    })()
    const resolved = this.getActionApproval(input.approvalId)
    if (!resolved) throw new Error('Approval request could not be resolved.')
    return resolved
  }

  cancelPendingActionApprovalsForTask(workTaskId: string): void {
    const now = new Date().toISOString()
    const actionRunIds = this.database.prepare<[string], { id: string }>(
      "SELECT id FROM action_runs WHERE work_task_id = ? AND status = 'awaiting_approval'"
    ).all(workTaskId)
    this.database.transaction(() => {
      for (const row of actionRunIds) {
        this.database.prepare("UPDATE approval_requests SET status = 'cancelled' WHERE action_run_id = ? AND status = 'pending'").run(row.id)
        this.database.prepare("UPDATE action_runs SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, row.id)
        this.appendActionEvent(row.id, 'cancelled', { reason: 'WORK_TASK_CANCELLED' }, now)
      }
    })()
  }

  private expirePendingActionApprovals(now: Date): void {
    const nowIso = now.toISOString()
    const expired = this.database.prepare<[string], { approval_id: string; action_run_id: string }>(
      `SELECT id AS approval_id, action_run_id FROM approval_requests
       WHERE status = 'pending' AND expires_at <= ?`
    ).all(nowIso)
    if (expired.length === 0) return
    this.database.transaction(() => {
      for (const item of expired) {
        const updated = this.database.prepare(
          "UPDATE approval_requests SET status = 'expired' WHERE id = ? AND status = 'pending'"
        ).run(item.approval_id)
        if (updated.changes !== 1) continue
        this.database.prepare(
          "UPDATE action_runs SET status = 'blocked', error_code = 'APPROVAL_EXPIRED', updated_at = ? WHERE id = ? AND status = 'awaiting_approval'"
        ).run(nowIso, item.action_run_id)
        this.appendActionEvent(item.action_run_id, 'approval_expired', { reason: 'APPROVAL_EXPIRED' }, nowIso)
      }
    })()
  }

  private appendActionEvent(actionRunId: string, eventType: string, detail: Record<string, unknown>, createdAt = new Date().toISOString()): void {
    this.database.prepare(
      'INSERT INTO action_events(id, action_run_id, event_type, detail_json, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(randomUUID(), actionRunId, eventType, JSON.stringify(detail), createdAt)
  }
}
