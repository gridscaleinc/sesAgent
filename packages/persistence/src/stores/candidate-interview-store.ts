import { randomUUID } from 'node:crypto'
import {
  candidateInterviewSnapshotSchema,
  createCandidateInterviewRoundInputSchema,
  recordCandidateInterviewDecisionInputSchema,
  saveCandidateInterviewNotesInputSchema,
  saveCandidateInterviewPreparationInputSchema,
  saveCandidateInterviewScheduleInputSchema,
  scheduleClash,
  scheduleConflictText
} from '@shared'
import {
  type CandidateInterviewSnapshot,
  type CreateCandidateInterviewRoundInput,
  type RecordCandidateInterviewDecisionInput,
  type SaveCandidateInterviewNotesInput,
  type SaveCandidateInterviewPreparationInput,
  type SaveCandidateInterviewScheduleInput
} from '@shared/contracts'
import { type CandidateInterviewRow } from '../rows'
import { DomainStore } from './base'

export class CandidateInterviewStore extends DomainStore {
  private candidateInterviewFromRow(row: CandidateInterviewRow): CandidateInterviewSnapshot {
    if (row.cloud_eligible !== 0) throw new Error('Candidate interview cloud boundary is invalid.')
    return candidateInterviewSnapshotSchema.parse({
      id: row.id,
      businessFollowUpId: row.business_followup_id ?? null,
      sourceDocumentId: row.source_document_id,
      kind: row.kind,
      roundNumber: row.round_number,
      parentInterviewId: row.parent_interview_id,
      stage: row.stage,
      scheduledAt: row.scheduled_at,
      durationMinutes: row.duration_minutes,
      meetingMethod: row.meeting_method,
      meetingUrl: row.meeting_url,
      meetingDetails: JSON.parse(row.meeting_details_json || '{}'),
      interviewer: row.interviewer,
      contactNote: row.contact_note,
      interviewGoal: row.interview_goal,
      questionPlan: JSON.parse(row.question_plan_json),
      interviewNotes: row.interview_notes,
      unresolvedItems: JSON.parse(row.unresolved_items_json),
      decision: row.decision,
      decisionReason: row.decision_reason,
      decidedAt: row.decided_at,
      decidedBy: row.decided_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
      cloudEligible: false
    })
  }

  private getCandidateInterviewRow(
    sourceDocumentId: string,
    interviewId?: string,
    kind: CandidateInterviewSnapshot['kind'] = 'recruiting'
  ): CandidateInterviewRow | null {
    if (interviewId) {
      return (
        this.database
          .prepare<[string, string], CandidateInterviewRow>(
            'SELECT * FROM candidate_interview_sessions WHERE id = ? AND source_document_id = ?'
          )
          .get(interviewId, sourceDocumentId) ?? null
      )
    }
    return (
      this.database
        .prepare<[string, string], CandidateInterviewRow>(
          `SELECT * FROM candidate_interview_sessions
         WHERE source_document_id = ? AND kind = ? AND business_followup_id IS NULL
         ORDER BY round_number DESC, updated_at DESC
         LIMIT 1`
        )
        .get(sourceDocumentId, kind) ?? null
    )
  }

  private assertCandidateInterviewSubject(sourceDocumentId: string): void {
    const exists = this.database
      .prepare<[string], { document_id: string }>('SELECT document_id FROM candidate_review_states WHERE document_id = ?')
      .get(sourceDocumentId)
    if (!exists) throw new Error('Candidate resume was not found.')
  }

  listCandidateInterviews(): CandidateInterviewSnapshot[] {
    return this.database
      .prepare<[], CandidateInterviewRow>(
        `SELECT * FROM candidate_interview_sessions
         ORDER BY coalesce(scheduled_at, updated_at) ASC, source_document_id, round_number`
      )
      .all()
      .map((row) => this.candidateInterviewFromRow(row))
  }

  createCandidateInterviewRound(
    input: CreateCandidateInterviewRoundInput,
    updatedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    const validated = createCandidateInterviewRoundInputSchema.parse(input)
    this.assertCandidateInterviewSubject(validated.sourceDocumentId)
    const parent = this.getCandidateInterviewRow(validated.sourceDocumentId, validated.parentInterviewId)
    if (parent?.business_followup_id) throw new Error('请从对应案件的跟进记录安排下一轮。')
    if (!parent) throw new Error('The prior interview round was not found.')
    if (parent.decision !== 'next-round') throw new Error('Record a next-round decision before creating a follow-up interview.')
    const kind = validated.kind ?? parent.kind
    // One next round per decided round: a repeated request (double click, IPC retry) returns the round it already created.
    const child = this.database
      .prepare<[string, string, string], CandidateInterviewRow>(
        `SELECT * FROM candidate_interview_sessions
         WHERE source_document_id = ? AND kind = ? AND parent_interview_id = ? AND business_followup_id IS NULL
         ORDER BY round_number LIMIT 1`
      )
      .get(validated.sourceDocumentId, kind, parent.id)
    if (child) return this.candidateInterviewFromRow(child)
    const round =
      this.database
        .prepare<[string, string], { next_round: number }>(
          `SELECT coalesce(max(round_number), 0) + 1 AS next_round
         FROM candidate_interview_sessions WHERE source_document_id = ? AND kind = ? AND business_followup_id IS NULL`
        )
        .get(validated.sourceDocumentId, kind)?.next_round ?? parent.round_number + 1
    const existing = this.database
      .prepare<[string, string, number], CandidateInterviewRow>(
        `SELECT * FROM candidate_interview_sessions
         WHERE source_document_id = ? AND kind = ? AND business_followup_id IS NULL AND round_number = ?`
      )
      .get(validated.sourceDocumentId, kind, round)
    if (existing) return this.candidateInterviewFromRow(existing)
    const timestamp = now.toISOString()
    const id = randomUUID()
    const inheritedItems = candidateInterviewSnapshotSchema.parse({
      ...this.candidateInterviewFromRow(parent),
      id: parent.id
    }).unresolvedItems
    // A follow-up must not quietly repeat every first-round question. Only
    // unresolved items become candidates for the next round; the renderer can
    // use the parent plan as an exclusion set when generating new AI prompts.
    const questionPlan = inheritedItems.slice(0, 12).map((text, index) => ({
      id: `inherited-${round}-${index + 1}`,
      text,
      source: 'inherited' as const,
      sourceLabel: null,
      selected: false
    }))
    this.database
      .prepare(
        `INSERT INTO candidate_interview_sessions(
         id, source_document_id, kind, round_number, parent_interview_id, stage,
         scheduled_at, duration_minutes, meeting_method, meeting_url, meeting_details_json, interviewer,
         contact_note, interview_goal, question_plan_json, interview_notes, unresolved_items_json,
         decision, decision_reason, decided_at, decided_by, created_at, updated_at, updated_by, cloud_eligible
       ) VALUES (?, ?, ?, ?, ?, 'new', NULL, 60, 'zoom', NULL, '{}', ?, NULL, NULL, ?, NULL, ?,
                 NULL, NULL, NULL, NULL, ?, ?, ?, 0)`
      )
      .run(
        id,
        validated.sourceDocumentId,
        kind,
        round,
        parent.id,
        parent.interviewer,
        JSON.stringify(questionPlan),
        JSON.stringify(inheritedItems),
        timestamp,
        timestamp,
        updatedBy
      )
    const saved = this.getCandidateInterviewRow(validated.sourceDocumentId, id, kind)
    if (!saved) throw new Error('Follow-up interview could not be created.')
    return this.candidateInterviewFromRow(saved)
  }

  /**
   * The candidate called off a booked interview: it goes back to being arranged, with no time held. The record stays,
   * and no result is invented for it. Interviews on a case's 跟进 are cancelled there.
   */
  cancelCandidateInterviewSchedule(
    input: { interviewId: string; sourceDocumentId: string },
    updatedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    const current = this.getCandidateInterviewRow(input.sourceDocumentId, input.interviewId)
    if (!current) throw new Error('面试记录不存在或已删除。 / 面談記録が見つかりません。')
    if (current.business_followup_id) throw new Error('请从对应案件的跟进记录取消面试。 / 対応記録から取り消してください。')
    const startedEmpty = current.stage === 'interviewing' && !current.interview_notes?.trim()
    if (current.decision || !(['scheduled', 'prepared'].includes(current.stage) || startedEmpty) || !current.scheduled_at)
      throw new Error('只有已预约、尚未开始的面试可以取消。 / 予約済みで開始前の面談のみ取り消せます。')
    this.database
      .prepare(
        "UPDATE candidate_interview_sessions SET stage = 'contacting', scheduled_at = NULL, updated_at = ?, updated_by = ? WHERE id = ?"
      )
      .run(now.toISOString(), updatedBy, current.id)
    return this.candidateInterviewFromRow(this.getCandidateInterviewRow(input.sourceDocumentId, current.id)!)
  }

  saveCandidateInterviewSchedule(
    input: SaveCandidateInterviewScheduleInput,
    updatedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    const validated = saveCandidateInterviewScheduleInputSchema.parse(input)
    this.assertCandidateInterviewSubject(validated.sourceDocumentId)
    const kind = validated.kind ?? 'recruiting'
    if (kind === 'recruiting') {
      // Recruiting interviews may be arranged as soon as a resume has been
      // imported. Human profile confirmation is still required before matching
      // or talent-pool admission, but it must not block the earlier scheduling
      // workflow exposed by the Agent conversation.
      const activeCandidate = this.database
        .prepare<[string], { source_document_id: string }>(
          "SELECT source_document_id FROM candidate_records WHERE source_document_id = ? AND record_status = 'active'"
        )
        .get(validated.sourceDocumentId)
      if (!activeCandidate)
        throw new Error('这个人员已删除或不可用，不能安排招聘面试。 / この要員は削除済みまたは利用できないため、採用面談を設定できません。')
    } else {
      const eligibleMembership = this.stores.candidates
        .listEligibleTalentProfiles()
        .some((profile) => profile.sourceDocumentId === validated.sourceDocumentId)
      if (!eligibleMembership)
        throw new Error('这个人员当前不在可安排的人员中，不能安排客户面试。 / この要員は現在手配できないため、顧客面談を設定できません。')
    }
    let current = this.getCandidateInterviewRow(validated.sourceDocumentId, validated.interviewId, kind)
    if (!current && validated.roundNumber) {
      current =
        this.database
          .prepare<[string, string, number], CandidateInterviewRow>(
            `SELECT * FROM candidate_interview_sessions
           WHERE source_document_id = ? AND kind = ? AND business_followup_id IS NULL AND round_number = ?`
          )
          .get(validated.sourceDocumentId, kind, validated.roundNumber) ?? null
    }
    if (current?.business_followup_id) throw new Error('请从对应案件的跟进记录修改面试。')
    // A decided round is not rebooked (checked before the time, so HR is not first asked to 「仍然保存」 for nothing);
    // only 未到场 can be booked again for the same round.
    const rebookingNoShow = current?.decision === 'no-show'
    if (current?.decision && !rebookingNoShow)
      throw new Error(
        '这一轮已经记录结论，不能再改期；需要再面一次请安排复试，结论有误请「更正结论」。 / この回は結論が記録済みのため日程変更できません。再度面談する場合は再面談を設定し、結論の誤りは「結論を訂正」を使ってください。'
      )
    // The same time rule as 跟进: the same person or interviewer already booked then, unless HR saves anyway.
    if (!validated.allowConflict) {
      const clash = scheduleClash(
        {
          id: current?.id ?? null,
          sourceDocumentId: validated.sourceDocumentId,
          scheduledAt: validated.scheduledAt,
          durationMinutes: validated.durationMinutes,
          interviewer: validated.interviewer || null
        },
        this.listCandidateInterviews(),
        this.stores.businessProgress.list()
      )
      if (clash) throw new Error(scheduleConflictText(clash.scheduledAt!))
    }
    // Opened but nothing recorded yet (the candidate did not join): the time can still move.
    const startedEmpty = current?.stage === 'interviewing' && !current.interview_notes?.trim()
    if (current && !rebookingNoShow && !['new', 'contacting', 'scheduled', 'prepared'].includes(current.stage) && !startedEmpty) {
      throw new Error('面试已经开始记录或在等结论，不能再改期。 / 面談の記録が始まっているか結論待ちのため、日程は変更できません。')
    }
    const timestamp = now.toISOString()
    const id = current?.id ?? randomUUID()
    const roundNumber = current?.round_number ?? validated.roundNumber ?? 1
    this.database
      .prepare(
        `INSERT INTO candidate_interview_sessions(
           id, source_document_id, kind, round_number, parent_interview_id, stage,
           scheduled_at, duration_minutes, meeting_method, meeting_url, meeting_details_json, interviewer,
           contact_note, interview_goal, question_plan_json, interview_notes, unresolved_items_json,
           decision, decision_reason, decided_at, decided_by, created_at, updated_at, updated_by, cloud_eligible
         ) VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, NULL, '[]', NULL, '[]',
                   NULL, NULL, NULL, NULL, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           stage = 'scheduled', scheduled_at = excluded.scheduled_at,
           duration_minutes = excluded.duration_minutes, meeting_method = excluded.meeting_method,
           meeting_url = excluded.meeting_url, meeting_details_json = excluded.meeting_details_json, interviewer = excluded.interviewer,
           contact_note = excluded.contact_note,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      )
      .run(
        id,
        validated.sourceDocumentId,
        kind,
        roundNumber,
        current?.parent_interview_id ?? validated.parentInterviewId ?? null,
        validated.scheduledAt,
        validated.durationMinutes,
        validated.meetingMethod,
        validated.meetingMethod === 'zoom' || validated.meetingMethod === 'google-meet' ? (validated.meetingUrl ?? null) : null,
        JSON.stringify(validated.meetingDetails ?? {}),
        validated.interviewer,
        validated.contactNote?.trim() || null,
        timestamp,
        timestamp,
        updatedBy
      )
    // 未到场 booked again: the same round takes place later, so its earlier 未到场 is no longer its result.
    if (rebookingNoShow)
      this.database
        .prepare(
          'UPDATE candidate_interview_sessions SET decision = NULL, decision_reason = NULL, decided_at = NULL, decided_by = NULL WHERE id = ?'
        )
        .run(id)
    if (kind === 'recruiting') {
      this.database
        .prepare(
          `UPDATE candidate_records SET recruiting_status = 'recruiting', updated_at = ?
         WHERE source_document_id = ? AND recruiting_status IN ('ready-for-recruiting', 'on-hold', 'no-show')`
        )
        .run(timestamp, validated.sourceDocumentId)
    }
    const saved = this.getCandidateInterviewRow(validated.sourceDocumentId, id, kind)
    if (!saved) throw new Error('Interview schedule could not be saved.')
    return this.candidateInterviewFromRow(saved)
  }

  saveCandidateInterviewPreparation(
    input: SaveCandidateInterviewPreparationInput,
    updatedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    return this.database.transaction(() => {
      const validated = saveCandidateInterviewPreparationInputSchema.parse(input)
      const row = this.database
        .prepare<[string], CandidateInterviewRow>('SELECT * FROM candidate_interview_sessions WHERE id = ?')
        .get(validated.interviewId)
      if (!row) throw new Error('Interview session was not found.')
      if (row.business_followup_id) throw new Error('请在对应案件的跟进页面修改面试。')
      if (row.decision) throw new Error('A completed interview cannot be edited.')
      if (!['scheduled', 'prepared'].includes(row.stage)) {
        throw new Error('Interview questions can only be edited before the interview starts.')
      }
      this.database
        .prepare(
          `UPDATE candidate_interview_sessions
       SET stage = 'prepared', interview_goal = ?, question_plan_json = ?, unresolved_items_json = ?,
           updated_at = ?, updated_by = ?
       WHERE id = ?`
        )
        .run(
          validated.interviewGoal?.trim() || null,
          JSON.stringify(validated.questions),
          JSON.stringify(validated.unresolvedItems ?? []),
          now.toISOString(),
          updatedBy,
          validated.interviewId
        )
      const saved = this.database
        .prepare<[string], CandidateInterviewRow>('SELECT * FROM candidate_interview_sessions WHERE id = ?')
        .get(validated.interviewId)
      if (!saved) throw new Error('Interview preparation could not be saved.')
      const result = this.candidateInterviewFromRow(saved)
      this.stores.experience.questionEdits(result.sourceDocumentId, null, result.id, result.questionPlan, updatedBy)
      this.stores.experience.record({
        sourceKey: `interview:${result.id}:questions`,
        documentId: result.sourceDocumentId,
        reviewId: null,
        interviewId: result.id,
        kind: 'questions',
        text: result.interviewNotes ?? result.decisionReason ?? '',
        actor: updatedBy,
        data: { result: result.decision, questions: result.questionPlan }
      })
      return result
    })()
  }

  saveCandidateInterviewNotes(input: SaveCandidateInterviewNotesInput, updatedBy: string, now = new Date()): CandidateInterviewSnapshot {
    const validated = saveCandidateInterviewNotesInputSchema.parse(input)
    this.assertCandidateInterviewSubject(validated.sourceDocumentId)
    const current = this.getCandidateInterviewRow(validated.sourceDocumentId, validated.interviewId)
    if (current?.business_followup_id) throw new Error('请从对应案件的跟进记录修改面试。')
    if (!current) throw new Error('Interview session was not found.')
    if (current.decision)
      throw new Error(
        '这一轮已经记录结论，面试记录不能再修改；如结论有误，请使用「更正结论」。 / この回は結論が記録済みのため面談記録は編集できません。結論が誤っている場合は「結論を訂正」を使ってください。'
      )
    if (!['prepared', 'interviewing'].includes(current.stage)) {
      throw new Error('Interview notes can only be edited while the interview is in progress.')
    }
    const timestamp = now.toISOString()
    const stage = validated.stage ?? 'interviewing'
    const id = current.id
    const unresolvedItems = validated.unresolvedItems ?? (current ? (JSON.parse(current.unresolved_items_json) as string[]) : [])
    this.database
      .prepare(
        `INSERT INTO candidate_interview_sessions(
           id, source_document_id, kind, round_number, parent_interview_id, stage,
           scheduled_at, duration_minutes, meeting_method, meeting_url, meeting_details_json, interviewer,
           contact_note, interview_goal, question_plan_json, interview_notes, unresolved_items_json,
           decision, decision_reason, decided_at, decided_by, created_at, updated_at, updated_by, cloud_eligible
         ) VALUES (?, ?, 'recruiting', 1, NULL, ?, NULL, 60, 'zoom', NULL, '{}', NULL,
                   NULL, NULL, '[]', ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           stage = excluded.stage, interview_notes = excluded.interview_notes,
           unresolved_items_json = excluded.unresolved_items_json,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      )
      .run(
        id,
        validated.sourceDocumentId,
        stage,
        validated.interviewNotes || null,
        JSON.stringify(unresolvedItems),
        timestamp,
        timestamp,
        updatedBy
      )
    const saved = this.getCandidateInterviewRow(validated.sourceDocumentId, id)
    if (!saved) throw new Error('Interview notes could not be saved.')
    const result = this.candidateInterviewFromRow(saved)
    this.stores.experience.record({
      sourceKey: `interview:${result.id}:notes`,
      documentId: result.sourceDocumentId,
      reviewId: null,
      interviewId: result.id,
      kind: 'notes',
      text: result.interviewNotes ?? result.decisionReason ?? '',
      actor: updatedBy,
      data: { result: result.decision, questions: result.questionPlan }
    })
    return result
  }

  recordCandidateInterviewDecision(
    input: RecordCandidateInterviewDecisionInput,
    decidedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    const validated = recordCandidateInterviewDecisionInputSchema.parse(input)
    this.assertCandidateInterviewSubject(validated.sourceDocumentId)
    const current = this.getCandidateInterviewRow(validated.sourceDocumentId, validated.interviewId)
    if (current?.business_followup_id) throw new Error('请从对应案件的跟进记录修改面试。')
    if (!current) throw new Error('Interview session was not found.')
    // 候选人撤回 / 未到场 / 暂缓 can close a round at any point before its result, without inventing a time or notes;
    // 通过 / 不通过 / 复试 judge an interview that took place, so they wait for its record.
    const closingWithoutInterview =
      ['withdrawn', 'no-show', 'on-hold'].includes(validated.decision) &&
      ['new', 'contacting', 'scheduled', 'prepared', 'interviewing', 'awaiting-decision'].includes(current.stage) &&
      !current.decision
    if (current.stage !== 'awaiting-decision' && !closingWithoutInterview) {
      throw new Error(
        '请先完成面试记录，再记录通过、不通过或复试；候选人撤回、未到场或暂缓可以直接记录。 / 通過・見送り・再面談は面談記録の後に記録してください。辞退・欠席・保留はそのまま記録できます。'
      )
    }
    return this.writeDecision(current, validated, decidedBy, now)
  }

  /**
   * A next round created by mistake (复试 chosen in error) and never booked or recorded is removed, so the round
   * before it can have its result corrected. Anything already booked, prepared or recorded stays.
   */
  deleteUnbookedCandidateInterviewRound(input: { interviewId: string; sourceDocumentId: string }): void {
    const current = this.getCandidateInterviewRow(input.sourceDocumentId, input.interviewId)
    if (!current) throw new Error('面试记录不存在或已删除。 / 面談記録が見つかりません。')
    if (current.business_followup_id) throw new Error('请从对应案件的跟进记录处理。 / 対応記録から操作してください。')
    const plan = JSON.parse(current.question_plan_json || '[]') as Array<{ source?: string }>
    if (
      !current.parent_interview_id ||
      current.decision ||
      current.scheduled_at ||
      current.interview_notes?.trim() ||
      !['new', 'contacting'].includes(current.stage) ||
      plan.some((question) => question.source !== 'inherited')
    )
      throw new Error('只有尚未预约、没有记录的下一轮可以删除。 / 未予約で記録のない次回面談のみ削除できます。')
    if (
      this.database
        .prepare<[string], { id: string }>('SELECT id FROM candidate_interview_sessions WHERE parent_interview_id = ? LIMIT 1')
        .get(current.id)
    )
      throw new Error('这一轮之后还有面试，不能删除。 / この回の後にも面談があるため削除できません。')
    this.database.prepare('DELETE FROM candidate_interview_sessions WHERE id = ?').run(current.id)
  }

  /**
   * 更正结论: a decision recorded by mistake is replaced with a reason. The earlier one stays readable in the decision
   * reason; talent-pool admission follows the new decision (admitted by this interview → removed when it no longer
   * passes). A 复试 already created from this round must be dealt with first.
   */
  correctCandidateInterviewDecision(
    input: RecordCandidateInterviewDecisionInput & { correctionReason: string },
    decidedBy: string,
    now = new Date()
  ): CandidateInterviewSnapshot {
    const validated = recordCandidateInterviewDecisionInputSchema.parse(input)
    const correctionReason = input.correctionReason.trim()
    if (correctionReason.length < 2) throw new Error('请填写更正原因。 / 訂正の理由を入力してください。')
    this.assertCandidateInterviewSubject(validated.sourceDocumentId)
    const current = this.getCandidateInterviewRow(validated.sourceDocumentId, validated.interviewId)
    if (current?.business_followup_id) throw new Error('请从对应案件的跟进记录修改面试。')
    if (!current) throw new Error('Interview session was not found.')
    if (!current.decision) throw new Error('这一轮还没有结论，请直接记录结论。 / この回はまだ結論がありません。結論を記録してください。')
    if (current.decision === validated.decision) throw new Error('新结论与原结论相同。 / 新しい結論が元の結論と同じです。')
    const child = this.database
      .prepare<[string], { id: string }>('SELECT id FROM candidate_interview_sessions WHERE parent_interview_id = ? LIMIT 1')
      .get(current.id)
    if (child)
      throw new Error(
        '这一轮之后已经建了下一轮面试，不能再更正结论；请在下一轮里继续处理。 / この回の次の面談が作成済みのため、結論は訂正できません。次の回で対応してください。'
      )
    const labels: Record<string, string> = {
      passed: '通过 / 通過',
      'next-round': '复试 / 再面談',
      failed: '不通过 / 見送り',
      'no-show': '未到场 / 欠席',
      withdrawn: '候选人撤回 / 辞退',
      'on-hold': '暂缓 / 保留'
    }
    const reason = `${validated.decisionReason}\n（更正：原结论「${labels[current.decision] ?? current.decision}」— ${current.decision_reason ?? ''}；更正原因：${correctionReason}）`
    const result = this.writeDecision(current, { ...validated, decisionReason: reason.slice(0, 1_500) }, decidedBy, now)
    // Admitted by this interview and no longer passed: out of the matching pool again.
    if (current.kind === 'recruiting' && current.decision === 'passed' && validated.decision !== 'passed')
      this.database
        .prepare(
          "UPDATE talent_pool_memberships SET status = 'removed', reason = ?, updated_at = ? WHERE source_document_id = ? AND admitted_interview_id = ?"
        )
        .run(correctionReason, now.toISOString(), validated.sourceDocumentId, current.id)
    return result
  }

  private writeDecision(
    current: CandidateInterviewRow,
    validated: {
      interviewId: string
      sourceDocumentId: string
      decision: RecordCandidateInterviewDecisionInput['decision']
      decisionReason: string
    },
    decidedBy: string,
    now: Date
  ): CandidateInterviewSnapshot {
    const timestamp = now.toISOString()
    const stage =
      validated.decision === 'passed'
        ? 'passed'
        : validated.decision === 'on-hold' || validated.decision === 'next-round'
          ? 'on-hold'
          : 'closed'
    const id = current.id
    return this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO candidate_interview_sessions(
             id, source_document_id, kind, round_number, parent_interview_id, stage,
             scheduled_at, duration_minutes, meeting_method, meeting_url, meeting_details_json, interviewer,
             contact_note, interview_goal, question_plan_json, interview_notes, unresolved_items_json,
             decision, decision_reason, decided_at, decided_by, created_at, updated_at, updated_by, cloud_eligible
           ) VALUES (?, ?, 'recruiting', 1, NULL, ?, NULL, 60, 'zoom', NULL, '{}', NULL,
                     NULL, NULL, '[]', NULL, '[]', ?, ?, ?, ?, ?, ?, ?, 0)
           ON CONFLICT(id) DO UPDATE SET
             stage = excluded.stage, decision = excluded.decision, decision_reason = excluded.decision_reason,
             decided_at = excluded.decided_at, decided_by = excluded.decided_by,
             updated_at = excluded.updated_at, updated_by = excluded.updated_by`
        )
        .run(
          id,
          validated.sourceDocumentId,
          stage,
          validated.decision,
          validated.decisionReason,
          timestamp,
          decidedBy,
          timestamp,
          timestamp,
          decidedBy
        )
      if (current.kind === 'recruiting') {
        const recruitingStatus =
          validated.decision === 'passed'
            ? 'passed'
            : validated.decision === 'failed'
              ? 'rejected'
              : validated.decision === 'withdrawn'
                ? 'withdrawn'
                : validated.decision === 'no-show'
                  ? 'no-show'
                  : validated.decision === 'on-hold' || validated.decision === 'next-round'
                    ? 'on-hold'
                    : 'recruiting'
        const updated = this.database
          .prepare('UPDATE candidate_records SET recruiting_status = ?, updated_at = ? WHERE source_document_id = ?')
          .run(recruitingStatus, timestamp, validated.sourceDocumentId)
        if (updated.changes !== 1) throw new Error('Candidate recruiting state could not be updated.')
        if (validated.decision === 'passed') {
          this.database
            .prepare(
              `INSERT INTO talent_pool_memberships(source_document_id, status, admitted_interview_id, admitted_at, admitted_by, reason, updated_at)
             VALUES (?, 'eligible', ?, ?, ?, ?, ?)
             ON CONFLICT(source_document_id) DO UPDATE SET
               status = 'eligible', admitted_interview_id = excluded.admitted_interview_id,
               admitted_at = excluded.admitted_at, admitted_by = excluded.admitted_by,
               reason = excluded.reason, updated_at = excluded.updated_at`
            )
            .run(validated.sourceDocumentId, current.id, timestamp, decidedBy, validated.decisionReason, timestamp)
        }
      }
      const saved = this.getCandidateInterviewRow(validated.sourceDocumentId, id)
      if (!saved) throw new Error('Interview decision could not be saved.')
      const result = this.candidateInterviewFromRow(saved)
      this.stores.experience.record({
        sourceKey: `interview:${result.id}:feedback`,
        documentId: result.sourceDocumentId,
        reviewId: null,
        interviewId: result.id,
        kind: 'feedback',
        text: [result.decisionReason, result.interviewNotes].filter(Boolean).join('\n'),
        actor: decidedBy,
        data: { result: result.decision, questions: result.questionPlan }
      })
      return result
    })()
  }
}
