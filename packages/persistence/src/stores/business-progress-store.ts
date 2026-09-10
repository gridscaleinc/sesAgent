import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { advanceBusinessProgressSchema, beginBusinessProgressSchema, candidateInterviewSnapshotSchema, emptyProgressEntry, interviewScheduleConflict,
  type AdvanceBusinessProgressInput, type BusinessFollowUp, type BusinessProgress, type BusinessProgressMail, type CandidateInterviewSnapshot } from '@shared'
import { DomainStore } from './base'

const fail = (message: string): never => { throw new Error(message) }
const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/u.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0,10) === day

export class BusinessProgressStore extends DomainStore {
  list(): BusinessFollowUp[] {
    const interviews = this.stores.candidateInterviews.listCandidateInterviews()
    const byPair = new Map<string, CandidateInterviewSnapshot[]>()
    for (const item of interviews) if (item.businessFollowUpId) {
      const list = byPair.get(item.businessFollowUpId) ?? []; list.push(item); byPair.set(item.businessFollowUpId, list)
    }
    return this.database.prepare<[], { payload: string }>('SELECT payload FROM business_followups ORDER BY updated_at DESC,id').all().map((row) => {
      const value = JSON.parse(row.payload) as BusinessFollowUp
      if (value.progress) value.progress.rounds = (byPair.get(value.id) ?? []).sort((a,b) => a.roundNumber-b.roundNumber)
      return value
    })
  }

  begin(raw: import('@shared').BeginBusinessProgressInput, actor: string): BusinessFollowUp[] {
    const input = beginBusinessProgressSchema.parse(raw)
    return this.database.transaction(() => input.map((pair) => {
      const existing = this.list().find((item) => item.documentId === pair.documentId && item.reviewId === pair.reviewId)
      return existing?.progress ? existing : this.advance({ ...pair, pendingConditions: pair.pendingConditions ?? [], expectedRevision:existing?.revision ?? 0, mutationId:randomUUID(), action:'coordinate', candidateAvailability:'', clientAvailability:'' }, actor)
    }))()
  }

  advance(raw: AdvanceBusinessProgressInput, actor: string, now = new Date()): BusinessFollowUp {
    const input = advanceBusinessProgressSchema.parse(raw)
    return this.database.transaction(() => {
      const person = this.stores.candidates.getCandidateReview(input.documentId)
      const job = this.stores.jobCases.getJobCaseReview(input.reviewId)
      if (!person || person.recordStatus === 'deleted' || !job) fail('关联人员或案件已经删除。')
      const current = this.list().find((item) => item.documentId === input.documentId && item.reviewId === input.reviewId)
      if (current?.events.some((event) => event.mutationId === input.mutationId)) return current
      if ((current?.revision ?? 0) !== input.expectedRevision) fail('推进记录已更新，请刷新后重试；未保存内容会保留。')
      if (['coordinate','schedule','link-interview'].includes(input.action) && (person!.recordStatus !== 'active' || job!.lifecycle !== 'active')) fail('人员或案件已归档，不能安排新的面试。')
      const progress: BusinessProgress = current?.progress ? structuredClone(current.progress) : {
        stage: current?.status === 'closed' && input.action !== 'coordinate' ? 'closed' : 'coordinating', candidateAvailability: '', clientAvailability: '', pendingConditions: [], entry: emptyProgressEntry(), rounds: []
      }
      if (!current && !['coordinate','schedule','feedback','link-interview'].includes(input.action)) fail('请先开始当前案件的面试推进。')
      if (['paused','closed','started'].includes(progress.stage) && !['resume','note','close','pause'].includes(input.action)) fail('请先恢复当前推进，再修改面试或入场安排。')
      const sourceMessage = input.sourceMessageId ? this.mail().find((row) => row.id === input.sourceMessageId) : undefined
      if (input.sourceMessageId && (!sourceMessage || sourceMessage.state !== 'pending' || sourceMessage.followUpId !== current?.id)) fail('来源邮件已处理或关联已变化，请重新选择。')
      const stamp = now.toISOString()
      const value: BusinessFollowUp = current ? { ...current, progress } : {
        id: randomUUID(), documentId: input.documentId, reviewId: input.reviewId, revision: 0, status: 'interview',
        note: '', nextStep: '', updatedAt: stamp, recordedBy: actor, events: [], progress
      }
      // The FK target exists before creating its first interview; the outer transaction rolls everything back on failure.
      if (!current) this.write(value)
      let description = ''
      const last = () => progress.rounds.at(-1)
      const getRound = (number: number, scheduling = false): CandidateInterviewSnapshot => {
        if (number < (last()?.roundNumber ?? 1)) fail('请在当前轮次记录反馈，历史轮次保留原记录。')
        const existing = progress.rounds.find((item) => item.roundNumber === number)
        if (existing) return existing
        if (number !== (last()?.roundNumber ?? 0) + 1) fail('请按当前轮次安排下一轮面试，已有轮次记录会保留。')
        if (last() && progress.stage !== 'next-round' && !scheduling) fail('请先安排对应轮次的面试，再记录该轮反馈。')
        const item: CandidateInterviewSnapshot = {
          id: randomUUID(), businessFollowUpId: value.id, sourceDocumentId: input.documentId, kind: 'client', roundNumber: number,
          parentInterviewId: last()?.id ?? null, stage: 'new', scheduledAt: null, durationMinutes: 60, meetingMethod: 'onsite', meetingUrl: null,
          interviewer: null, contactNote: null, interviewGoal: null, questionPlan: [], interviewNotes: null,
          unresolvedItems: last()?.unresolvedItems ?? progress.pendingConditions.map((item) => item.slice(0,300)).slice(0,20),
          decision: null, decisionReason: null, decidedAt: null, decidedBy: null,
          createdAt: stamp, updatedAt: stamp, updatedBy: actor, cloudEligible: false
        }
        progress.rounds.push(item); return item
      }
      switch (input.action) {
        case 'coordinate':
          progress.candidateAvailability = input.candidateAvailability; progress.clientAvailability = input.clientAvailability
          progress.pendingConditions = input.pendingConditions
          description = '更新双方可面试时间和待沟通事项'; break
        case 'schedule': {
          // HR can book the next round before the previous result is transcribed.
          // Creating that appointment must not infer or overwrite an earlier result.
          const item = getRound(input.schedule.roundNumber, true)
          if (item.decision) fail('本轮已经记录结果，请安排下一轮面试。')
          const schedule = input.schedule
          Object.assign(item, { scheduledAt: schedule.scheduledAt || null, durationMinutes: schedule.durationMinutes, meetingMethod: schedule.meetingMethod,
            meetingUrl: schedule.meetingUrl || null,
            meetingDetails: schedule.meetingMethod === 'onsite' && schedule.location ? { onsiteAddress: schedule.location } : schedule.meetingMethod === 'phone' ? { phoneNote: schedule.location } : {},
            interviewer: schedule.interviewer || null, contactNote: schedule.note || null, stage: schedule.scheduledAt ? 'scheduled' : 'contacting', updatedAt: stamp, updatedBy: actor })
          this.writeRound(item); progress.stage = schedule.scheduledAt ? 'scheduled' : 'coordinating'
          description = item.scheduledAt ? `预约第 ${item.roundNumber} 轮面试：${item.scheduledAt}` : `保存第 ${item.roundNumber} 轮面试安排，时间待定`; break
        }
        case 'feedback': {
          if (input.result !== 'passed' && input.next !== 'unknown') fail('本轮通过后才能安排下一轮或进入入场准备。')
          const enteringNextRound = input.result === 'passed' && input.next === 'next-round' && progress.stage !== 'next-round'
          const item = getRound(input.roundNumber)
          item.interviewNotes = input.notes; item.unresolvedItems = input.unresolved; item.updatedAt = stamp; item.updatedBy = actor
          item.decision = input.result === 'pending' ? null : input.result === 'passed' && input.next === 'next-round' ? 'next-round' : input.result
          item.decisionReason = item.decision ? input.notes.slice(0,1500) : null
          item.decidedAt = item.decision ? stamp : null; item.decidedBy = item.decision ? actor : null
          item.stage = input.result === 'pending' ? 'awaiting-decision' : input.result === 'passed' ? (input.next === 'next-round' ? 'on-hold' : 'passed') : 'closed'
          progress.stage = input.result === 'pending' ? 'feedback' : input.result === 'passed' ? (input.next === 'entry' ? 'entry' : input.next === 'next-round' ? 'next-round' : 'next-decision') : 'closed'
          if (enteringNextRound) { progress.candidateAvailability = ''; progress.clientAvailability = '' }
          if (progress.stage === 'entry') {
            const fields = new Map(job!.fields.map((f) => [f.key,f.value]))
            progress.entry = { ...progress.entry, rate: progress.entry.rate || fields.get('rate') || '', location: progress.entry.location || fields.get('location') || '', workStyle: progress.entry.workStyle || fields.get('remote') || '' }
          }
          this.writeRound(item); description = `第 ${item.roundNumber} 轮面试反馈：${input.notes}`; break
        }
        case 'entry':
          if (progress.stage !== 'entry') fail('请先记录客户全部面试通过，再安排进场。')
          if (input.entry.plannedDate && !validDay(input.entry.plannedDate)) fail('请输入有效的入场日期。')
          progress.entry = { ...input.entry, actualDate: progress.entry.actualDate }
          description = '更新入场日期、双方意向及报到安排'; break
        case 'start': {
          if (progress.stage !== 'entry' || !progress.entry.candidateAccepted || !progress.entry.termsAgreed) fail('请先确认人员接受案件、双方条件已谈妥。')
          const today = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Tokyo', year:'numeric',month:'2-digit',day:'2-digit' }).format(now)
          if (!validDay(input.actualDate) || input.actualDate > today) fail('实际到岗日期必须是今天或过去的有效日期。')
          const latestInterviewDay = last()?.scheduledAt ? new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date(last()!.scheduledAt!)) : null
          if (latestInterviewDay && input.actualDate < latestInterviewDay) fail('实际到岗日期不能早于已记录的最后一轮面试日期。')
          progress.entry.actualDate = input.actualDate; progress.stage = 'started'
          this.stores.personnel.setState({ documentId: person!.documentId, profileVersion: person!.profile?.version ?? 0, reviewRevision: person!.reviewRevision, status: 'assigned', confirmed: true }, actor)
          description = `确认实际到岗：${input.actualDate}`; break
        }
        case 'note': description = input.note; break
        case 'pause':
          if (progress.stage === 'started' || progress.stage === 'closed') fail('已经结束的推进不能暂停。')
          if (progress.stage !== 'paused') progress.resumeStage = progress.stage
          progress.stage = 'paused'; description = `暂停推进：${input.reason}`; break
        case 'close':
          if (progress.stage === 'started') fail('已经记录到岗的业务保留进场结果。')
          if (!['closed','paused'].includes(progress.stage)) progress.resumeStage = progress.stage
          progress.stage = 'closed'; description = `结束推进：${input.reason}`; break
        case 'resume':
          if (!['paused','closed'].includes(progress.stage)) fail('当前推进无需恢复。')
          progress.stage = progress.resumeStage ?? (last()?.decision === 'passed' ? 'next-decision' : last()?.decision ? 'next-round' : 'coordinating')
          if (progress.stage === 'scheduled' && last()?.scheduledAt) {
            const inactiveIds = new Set(this.list().filter((row) => ['paused','closed','started'].includes(row.progress?.stage ?? '')).map((row) => row.id))
            const scheduled = last()!
            if (this.stores.candidateInterviews.listCandidateInterviews().some((other) => other.id !== scheduled.id && !inactiveIds.has(other.businessFollowUpId ?? '') && interviewScheduleConflict({...scheduled,scheduledAt:scheduled.scheduledAt!},other))) progress.stage = 'coordinating'
          }
          delete progress.resumeStage
          description = '恢复当前案件的推进'; break
        case 'link-interview': {
          if (progress.rounds.length) fail('当前案件已经有面试记录，不能合并未关联的历史轮次。')
          const all = this.stores.candidateInterviews.listCandidateInterviews()
          let item = all.find((row) => row.id === input.interviewId)
          const linked: CandidateInterviewSnapshot[] = []
          while (item) {
            if (item.sourceDocumentId !== input.documentId || item.kind !== 'client' || item.businessFollowUpId) fail('这条历史面试不属于当前人员，或已关联其他案件。')
            linked.unshift(item); item = item.parentInterviewId ? all.find((row) => row.id === item!.parentInterviewId) : undefined
          }
          if (!linked.length) fail('未找到历史面试。')
          for (const interview of linked) this.database.prepare('UPDATE candidate_interview_sessions SET business_followup_id=? WHERE id=?').run(value.id,interview.id)
          progress.rounds = linked.map((row) => ({ ...row, businessFollowUpId: value.id }))
          const tail = last()!
          progress.stage = tail.decision === 'passed' ? 'next-decision' : tail.decision === 'next-round' ? 'next-round' : tail.decision ? 'closed' : tail.scheduledAt ? 'scheduled' : 'coordinating'
          description = '关联此前的客户面试记录'; break
        }
      }
      value.status = progress.stage === 'closed' || progress.stage === 'started' ? 'closed' : 'interview'
      value.note = description; value.nextStep = ''; value.updatedAt = stamp; value.recordedBy = actor; value.revision++
      value.events = [...value.events, { status: value.status, note: description, nextStep:'', recordedAt: stamp, recordedBy: actor, action: input.action, mutationId: input.mutationId, stage: progress.stage, roundNumber: last()?.roundNumber }]
      this.write(value)
      if (sourceMessage) this.updateMail({ id:sourceMessage.id, followUpId:value.id, state:'applied' })
      return value
    })()
  }

  private write(value: BusinessFollowUp) {
    const payload = value.progress ? { ...value, progress: { ...value.progress, rounds: [] } } : value
    this.database.prepare(`INSERT INTO business_followups(id,document_id,review_id,revision,updated_at,payload) VALUES (?,?,?,?,?,?)
      ON CONFLICT(document_id,review_id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at,payload=excluded.payload`)
      .run(value.id,value.documentId,value.reviewId,value.revision,value.updatedAt,JSON.stringify(payload))
  }

  private writeRound(raw: CandidateInterviewSnapshot) {
    const item = candidateInterviewSnapshotSchema.parse(raw)
    this.database.prepare(`INSERT INTO candidate_interview_sessions(id,source_document_id,kind,round_number,parent_interview_id,stage,scheduled_at,duration_minutes,
      meeting_method,meeting_url,meeting_details_json,interviewer,contact_note,interview_goal,question_plan_json,interview_notes,unresolved_items_json,
      decision,decision_reason,decided_at,decided_by,created_at,updated_at,updated_by,cloud_eligible,business_followup_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?) ON CONFLICT(id) DO UPDATE SET
      stage=excluded.stage,scheduled_at=excluded.scheduled_at,duration_minutes=excluded.duration_minutes,meeting_method=excluded.meeting_method,
      meeting_url=excluded.meeting_url,meeting_details_json=excluded.meeting_details_json,interviewer=excluded.interviewer,contact_note=excluded.contact_note,
      interview_notes=excluded.interview_notes,unresolved_items_json=excluded.unresolved_items_json,decision=excluded.decision,decision_reason=excluded.decision_reason,
      decided_at=excluded.decided_at,decided_by=excluded.decided_by,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
      .run(item.id,item.sourceDocumentId,'client',item.roundNumber,item.parentInterviewId,item.stage,item.scheduledAt,item.durationMinutes,item.meetingMethod,item.meetingUrl,
        JSON.stringify(item.meetingDetails ?? {}),item.interviewer,item.contactNote,item.interviewGoal,JSON.stringify(item.questionPlan),item.interviewNotes,
        JSON.stringify(item.unresolvedItems),item.decision,item.decisionReason,item.decidedAt,item.decidedBy,item.createdAt,item.updatedAt,item.updatedBy,item.businessFollowUpId)
  }

  mail(): BusinessProgressMail[] {
    return this.database.prepare<[],{payload:string}>('SELECT payload FROM business_progress_mail ORDER BY received_at DESC,id').all().map((row) => JSON.parse(row.payload))
  }

  captureMail(message: { accountEmail: string; messageId: string; threadId: string; subject: string; body: string; receivedAt: string }): boolean {
    const text = `${message.subject}\n${message.body}`
    const kind = /入場|入场|进场|参画開始|報到|报到/u.test(text) ? 'entry' : /面[談试試接].{0,20}(結果|结果|通过|通過|合格|不合格|NG|OK|見送り)|二面|二次面[談接]|次回面談/u.test(text) ? 'feedback' : /面[談试試接]|日程調整|約面|约面/u.test(text) ? 'schedule' : null
    if (!kind) return false
    const correspondence = /日程.{0,8}(調整|確定|変更|候補)|面[談试試接].{0,30}(ご都合|お願い|結果|结果|通過|合格|通过|安排|时间定|日時は|日時が|確定|NG|OK|見送り)|(?:二面|二次面談|次回面談).{0,20}(安排|お願い|調整|日時|进行)|(?:入場|入场|进场|参画開始).{0,20}(確定|決定|案内|安排|通知|报到|手続)/u.test(text)
    const subjectIntent = /(?:面[談试試接]|入場|进场|入场|参画).{0,16}(?:日程|調整|変更|案内|結果|结果|反馈|通知|安排|ご相談|通過|通过)/u.test(message.subject)
    if (!correspondence && !subjectIntent) return false
    const id = createHash('sha256').update(`${message.accountEmail}\0${message.messageId}`).digest('hex')
    if (this.database.prepare('SELECT id FROM business_progress_mail WHERE id=?').get(id)) return true
    const active = this.list().filter((row) => !['closed','started'].includes(row.progress?.stage ?? (row.status === 'closed' ? 'closed' : 'coordinating')))
    const matches = active.filter((row) => {
      const source = this.stores.gmail.getCaseMailSource(row.reviewId)
      const thread = source ? this.database.prepare<[string,string],{thread_id:string}>('SELECT thread_id FROM gmail_messages WHERE account_email=? AND gmail_message_id=?').get(source.accountEmail,source.messageId) : null
      const person = this.stores.candidates.getCandidateReview(row.documentId)
      const job = this.stores.jobCases.getJobCaseReview(row.reviewId)
      const name = person?.localIdentity?.displayName
      const title = job?.fields.find((field) => field.key === 'title')?.value ?? job?.redactedSubject
      return Boolean((source?.accountEmail === message.accountEmail && thread?.thread_id === message.threadId) || (name && name.length > 1 && text.includes(name) && title && title.length > 3 && text.includes(title)))
    })
    // A thread may contain several people. Only attach automatically when the named person and case identify one pair.
    const named = matches.filter((row) => {
      const name = this.stores.candidates.getCandidateReview(row.documentId)?.localIdentity?.displayName
      return Boolean(name && name.length > 1 && text.includes(name))
    })
    const followUpId = named.length === 1 ? named[0]!.id : null
    const value: BusinessProgressMail = { id, followUpId, suggestedFollowUpIds: matches.map((row) => row.id), subject: message.subject.slice(0,1000),
      body: message.body.slice(0,12000), receivedAt: message.receivedAt, kind, state:'pending' }
    this.database.prepare('INSERT INTO business_progress_mail(id,followup_id,received_at,payload) VALUES (?,?,?,?)').run(id,followUpId,value.receivedAt,JSON.stringify(value))
    return true
  }

  updateMail(raw: { id: string; followUpId?: string; state?: 'applied' | 'dismissed' }): void {
    const input = z.object({ id:z.string().regex(/^[a-f0-9]{64}$/u), followUpId:z.string().uuid().optional(), state:z.enum(['applied','dismissed']).optional() }).strict().parse(raw)
    const value = this.mail().find((row) => row.id === input.id) ?? fail('消息已删除。')
    if (input.followUpId && !this.list().some((row) => row.id === input.followUpId)) fail('请选择有效的人员与案件推进记录。')
    if (input.state === 'applied' && !value.followUpId && !input.followUpId) fail('请先关联这封邮件对应的人员和案件。')
    if (input.followUpId) value.followUpId = input.followUpId
    if (input.state) value.state = input.state
    this.database.prepare('UPDATE business_progress_mail SET followup_id=?,payload=? WHERE id=?').run(value.followUpId,JSON.stringify(value),value.id)
  }
}
