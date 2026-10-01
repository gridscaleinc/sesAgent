import { createHash, randomUUID } from 'node:crypto'
import {
  advanceBusinessProgressSchema,
  beginBusinessProgressSchema,
  updateBusinessProgressMailSchema,
  candidateInterviewSnapshotSchema,
  deleteBusinessFollowUpSchema,
  emptyProgressEntry,
  scheduleClash,
  scheduleConflictText,
  isInactiveProgressStage,
  type AdvanceBusinessProgressInput,
  type DeleteBusinessFollowUpInput,
  type DeleteBusinessFollowUpResult,
  type BusinessFollowUp,
  type BusinessProgress,
  type BusinessProgressMail,
  type CandidateInterviewSnapshot
} from '@shared'
import { DomainStore } from './base'

const fail = (message: string): never => {
  throw new Error(message)
}
const validDay = (day: string) =>
  /^\d{4}-\d{2}-\d{2}$/u.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day

export class BusinessProgressStore extends DomainStore {
  /**
   * Whether HR judged this pair 不满足 (set by Main, which owns the matching rules). Every path that proposes or
   * books the pair — HR's own actions and the resumes done here on HR's behalf — asks it.
   */
  pairRejected: ((documentId: string, reviewId: string) => boolean) | null = null

  list(): BusinessFollowUp[] {
    const interviews = this.stores.candidateInterviews.listCandidateInterviews()
    const byPair = new Map<string, CandidateInterviewSnapshot[]>()
    for (const item of interviews)
      if (item.businessFollowUpId) {
        const list = byPair.get(item.businessFollowUpId) ?? []
        list.push(item)
        byPair.set(item.businessFollowUpId, list)
      }
    return this.database
      .prepare<[], { payload: string }>('SELECT payload FROM business_followups ORDER BY updated_at DESC,id')
      .all()
      .map((row) => {
        const value = JSON.parse(row.payload) as BusinessFollowUp
        if (value.progress) value.progress.rounds = (byPair.get(value.id) ?? []).sort((a, b) => a.roundNumber - b.roundNumber)
        return value
      })
  }

  begin(raw: import('@shared').BeginBusinessProgressInput, actor: string): BusinessFollowUp[] {
    const input = beginBusinessProgressSchema.parse(raw)
    // Name everyone who cannot start, instead of failing the batch on the first with no name.
    const states = new Map(this.stores.personnel.workspace().states.map((row) => [row.documentId, row.status]))
    // Read once: list() loads every follow-up with its rounds, so not once per pair.
    const started = new Set(this.list().flatMap((item) => (item.progress ? [`${item.documentId}:${item.reviewId}`] : [])))
    const stopped = input.flatMap((pair) => {
      if (started.has(`${pair.documentId}:${pair.reviewId}`)) return []
      const person = this.stores.candidates.getCandidateReview(pair.documentId)
      const name = person?.localIdentity?.displayName ?? person?.fileName ?? pair.documentId
      const job = this.stores.jobCases.getJobCaseReview(pair.reviewId)
      if (job && job.lifecycle !== 'active') return [`${name}（案件已结束）`]
      if (states.get(pair.documentId) === 'paused') return [`${name}（暂停营业）`]
      // In place elsewhere: recommending and booking would be refused, so the follow-up is not started either.
      if (states.get(pair.documentId) === 'assigned') return [`${name}（已进场，可先改为近期可入场）`]
      return this.pairRejected?.(pair.documentId, pair.reviewId) ? [`${name}（已判定不满足）`] : []
    })
    if (stopped.length) fail(`以下组合不能开始跟进：${stopped.join('、')}。`)
    return this.database.transaction(() => {
      const rows = new Map(this.list().map((item) => [`${item.documentId}:${item.reviewId}`, item]))
      return input.map((pair) => {
        const key = `${pair.documentId}:${pair.reviewId}`
        const existing = rows.get(key)
        if (existing?.progress) return existing
        const created = this.advance(
          {
            ...pair,
            pendingConditions: pair.pendingConditions ?? [],
            expectedRevision: existing?.revision ?? 0,
            mutationId: randomUUID(),
            action: 'coordinate',
            candidateAvailability: '',
            clientAvailability: ''
          },
          actor
        )
        rows.set(key, created)
        return created
      })
    })()
  }

  /** Rounds and linked progress mail go with the follow-up through ON DELETE CASCADE, the same path personnel deletion uses. */
  remove(raw: DeleteBusinessFollowUpInput): DeleteBusinessFollowUpResult {
    const input = deleteBusinessFollowUpSchema.parse(raw)
    return this.database.transaction(() => {
      const current = this.list().find((item) => item.id === input.followUpId) ?? fail('推进记录不存在或已删除。')
      if (current.revision !== input.expectedRevision) fail('推进记录已更新，请刷新后重试。')
      if (current.progress?.stage === 'started') fail('已记录进场的推进不能删除，请先撤销进场。')
      if (current.progress?.stage === 'ended') fail('已退场的进场记录作为历史保留，不能删除。')
      const mails = this.database
        .prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM business_progress_mail WHERE followup_id=?')
        .get(input.followUpId)!.n
      // Interviews recorded before this follow-up and linked into it (关联此前的客户面试) are history of their own:
      // they go back to being unlinked instead of being deleted with it.
      const linkedAt = current.events.find((event) => event.action === 'link-interview')?.recordedAt
      if (linkedAt)
        this.database
          .prepare('UPDATE candidate_interview_sessions SET business_followup_id = NULL WHERE business_followup_id = ? AND created_at < ?')
          .run(input.followUpId, linkedAt)
      this.database.prepare('DELETE FROM business_followups WHERE id=?').run(input.followUpId)
      return { deletedId: input.followUpId, rounds: current.progress?.rounds.length ?? 0, mails }
    })()
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
      // Recommending never moves a follow-up backwards: one already under way keeps its stage and only gains the
      // recommendation time (introduced after the interview was arranged); one already recommended is left as it is.
      if (input.action === 'recommend' && current?.progress?.recommendedAt) return current
      if (input.action === 'recommend' && job!.lifecycle !== 'active') fail('案件已结束，不能记录新的推荐。')
      if (['coordinate', 'schedule', 'rebook', 'link-interview', 'prepare', 'resume'].includes(input.action) && job!.lifecycle !== 'active')
        fail('案件已结束，不能安排新的面试或恢复推进；如需继续，请先激活案件。')
      // A person HR stopped offering (暂停营业) is not introduced or interviewed. Someone in place elsewhere may still be,
      // when HR decides to continue a case.
      if (
        ['recommend', 'coordinate', 'schedule', 'rebook', 'link-interview', 'resume', 'restart'].includes(input.action) &&
        this.pairRejected?.(input.documentId, input.reviewId)
      )
        fail(
          '这个人员已被判定不满足该案件的要求，不能推荐或安排面试；如判断有变，请先在匹配中撤回「不满足」。 / この要員は案件の条件を満たさないと判断済みのため、推薦や面談の設定はできません。判断が変わった場合は「満たさない」を取り消してください。'
        )
      const personStatus = this.stores.personnel.workspace().states.find((row) => row.documentId === input.documentId)?.status
      if (
        personStatus === 'paused' &&
        ['recommend', 'coordinate', 'schedule', 'rebook', 'link-interview', 'prepare', 'resume'].includes(input.action)
      )
        fail('这个人员暂停营业，不能再推荐或安排面试；请先把营业状态改为待机中。')
      // In place (已进场) the person is not proposed again (as introductions refuse too); 近期可入场 opens that up.
      if (personStatus === 'assigned' && input.action === 'recommend' && !current?.progress?.recommendedAt)
        fail(
          '这个人员已进场，不能再记录推荐；项目快结束时请先把营业状态改为近期可入场。 / この要員は参画中のため推薦を記録できません。終了が近い場合は営業状態を「近日稼働可能」に変更してください。'
        )
      // In place (已进场), no new client interview is booked; once HR marks 近期可入场 ahead of the end, it can be.
      if (personStatus === 'assigned' && (input.action === 'schedule' || input.action === 'rebook') && input.schedule.scheduledAt)
        fail(
          '这个人员已进场，不能再约客户面试；项目快结束时请先把营业状态改为近期可入场。 / この要員は参画中のため顧客面談は設定できません。終了が近い場合は営業状態を「近日稼働可能」に変更してください。'
        )
      const progress: BusinessProgress = current?.progress
        ? structuredClone(current.progress)
        : {
            stage:
              input.action === 'recommend'
                ? 'recommended'
                : current?.status === 'closed' && input.action !== 'coordinate'
                  ? 'closed'
                  : 'coordinating',
            candidateAvailability: '',
            clientAvailability: '',
            pendingConditions: [],
            entry: emptyProgressEntry(),
            rounds: []
          }
      if (!current && !['recommend', 'coordinate', 'schedule', 'feedback', 'link-interview'].includes(input.action))
        fail('请先开始当前案件的面试推进。')
      const inactive = isInactiveProgressStage(progress.stage)
      const recordedFeedback = input.action === 'feedback' && progress.rounds.some((round) => round.roundNumber === input.roundNumber)
      const historyOnly = recordedFeedback && (inactive || input.roundNumber < progress.rounds.at(-1)!.roundNumber)
      const correctingEntry =
        (progress.stage === 'started' && ['correct-entry', 'undo-start', 'leave'].includes(input.action)) ||
        (progress.stage === 'ended' && input.action === 'undo-leave') ||
        // 重新开始 says itself when it does not apply (only after 退场).
        input.action === 'restart'
      // Only a paused or closed follow-up can rebook a round; a placement in place or left stays as it is.
      const rebooking = !['started', 'ended'].includes(progress.stage) && input.action === 'rebook'
      if (inactive && !historyOnly && !correctingEntry && !rebooking && !['resume', 'note', 'close', 'pause'].includes(input.action))
        fail('请先恢复当前推进，再修改面试或入场安排。')
      const sourceMessage = input.sourceMessageId ? this.mail().find((row) => row.id === input.sourceMessageId) : undefined
      if (input.sourceMessageId && (!sourceMessage || sourceMessage.state !== 'pending' || sourceMessage.followUpId !== current?.id))
        fail('来源邮件已处理或关联已变化，请重新选择。')
      const stamp = now.toISOString()
      const value: BusinessFollowUp = current
        ? { ...current, progress }
        : {
            id: randomUUID(),
            documentId: input.documentId,
            reviewId: input.reviewId,
            revision: 0,
            status: 'interview',
            note: '',
            nextStep: '',
            updatedAt: stamp,
            recordedBy: actor,
            events: [],
            progress
          }
      // The FK target exists before creating its first interview; the outer transaction rolls everything back on failure.
      if (!current) this.write(value)
      let description = ''
      let previousInterview: CandidateInterviewSnapshot | undefined
      let previousEntry: BusinessProgress['entry'] | undefined
      const last = () => progress.rounds.at(-1)
      // Round one starts from the questions generated on the assessment card, but only while person, case and rules are unchanged.
      const draftQuestions = () => {
        const jobCase = job!.jobCase
        const draft = jobCase ? this.stores.workRules.getQuestionDraft(input.documentId, jobCase.id) : null
        if (
          !draft ||
          !jobCase ||
          draft.jobCaseVersion !== jobCase.version ||
          draft.profileVersion !== person!.profile?.version ||
          draft.rulesRevision !== this.stores.workRules.list().revision
        )
          return []
        return draft.questions.map((question) => ({ ...question, selected: true }))
      }
      const getRound = (number: number, scheduling = false): CandidateInterviewSnapshot => {
        if (scheduling && number < (last()?.roundNumber ?? 1)) fail('请在当前轮次修改安排，历史面试时间保留原记录。')
        const existing = progress.rounds.find((item) => item.roundNumber === number)
        if (existing) return existing
        if (number !== (last()?.roundNumber ?? 0) + 1) fail('请按当前轮次安排下一轮面试，已有轮次记录会保留。')
        if (last() && progress.stage !== 'next-round' && !scheduling) fail('请先安排对应轮次的面试，再记录该轮反馈。')
        const item: CandidateInterviewSnapshot = {
          id: randomUUID(),
          businessFollowUpId: value.id,
          sourceDocumentId: input.documentId,
          kind: 'client',
          roundNumber: number,
          parentInterviewId: last()?.id ?? null,
          stage: 'new',
          scheduledAt: null,
          durationMinutes: 60,
          meetingMethod: 'onsite',
          meetingUrl: null,
          interviewer: null,
          contactNote: null,
          interviewGoal: null,
          questionPlan: number === 1 ? draftQuestions() : [],
          interviewNotes: null,
          unresolvedItems: last()?.unresolvedItems ?? progress.pendingConditions.map((item) => item.slice(0, 300)).slice(0, 20),
          decision: null,
          decisionReason: null,
          decidedAt: null,
          decidedBy: null,
          createdAt: stamp,
          updatedAt: stamp,
          updatedBy: actor,
          cloudEligible: false
        }
        progress.rounds.push(item)
        return item
      }
      switch (input.action) {
        case 'recommend':
          progress.recommendedAt = stamp
          description = '已推荐给案件方'
          break
        case 'coordinate':
          if (progress.stage === 'recommended') progress.stage = 'coordinating'
          progress.candidateAvailability = input.candidateAvailability
          progress.clientAvailability = input.clientAvailability
          progress.pendingConditions = input.pendingConditions
          description = '更新双方可面试时间和待沟通事项'
          break
        case 'schedule':
        case 'rebook': {
          // HR can book the next round before the previous result is transcribed.
          // Creating that appointment must not infer or overwrite an earlier result.
          const item = getRound(input.schedule.roundNumber, true)
          if (input.action === 'rebook') {
            if (item.roundNumber !== last()?.roundNumber || !current?.progress?.rounds.some((round) => round.id === item.id))
              fail('只能重新预约当前已有轮次。')
            previousInterview = structuredClone(item)
            Object.assign(item, { decision: null, decisionReason: null, decidedAt: null, decidedBy: null, interviewNotes: null })
            delete progress.resumeStage
          } else if (item.decision) fail('本轮已经记录结果，请使用重新预约本轮，或明确安排下一轮。')
          else if (item.scheduledAt) previousInterview = structuredClone(item)
          const schedule = input.schedule
          // The same person, or the same interviewer, already has an interview then: say so unless HR saves anyway.
          if (schedule.scheduledAt && !input.allowConflict) {
            const clash = scheduleClash(
              {
                id: item.id,
                sourceDocumentId: input.documentId,
                scheduledAt: schedule.scheduledAt,
                durationMinutes: schedule.durationMinutes,
                interviewer: schedule.interviewer || null
              },
              this.stores.candidateInterviews.listCandidateInterviews(),
              this.list()
            )
            if (clash) fail(scheduleConflictText(clash.scheduledAt!))
          }
          Object.assign(item, {
            scheduledAt: schedule.scheduledAt || null,
            durationMinutes: schedule.durationMinutes,
            meetingMethod: schedule.meetingMethod,
            meetingUrl: schedule.meetingUrl || null,
            meetingDetails:
              schedule.meetingMethod === 'onsite' && schedule.location
                ? { onsiteAddress: schedule.location }
                : schedule.meetingMethod === 'phone'
                  ? { phoneNote: schedule.location }
                  : {},
            interviewer: schedule.interviewer || null,
            contactNote: schedule.note || null,
            stage: schedule.scheduledAt ? 'scheduled' : 'contacting',
            updatedAt: stamp,
            updatedBy: actor
          })
          this.writeRound(item)
          progress.stage = schedule.scheduledAt ? 'scheduled' : 'coordinating'
          description = item.scheduledAt
            ? `预约第 ${item.roundNumber} 轮面试：${item.scheduledAt}`
            : `保存第 ${item.roundNumber} 轮面试安排，时间待定`
          if (input.action === 'rebook') description = `重新${description}；原因：${input.reason}`
          else if (item.roundNumber === 1 && item.questionPlan.length && !current?.progress?.rounds.some((round) => round.id === item.id))
            description += `；带入评估时生成的 ${item.questionPlan.length} 道面试题`
          break
        }
        case 'prepare': {
          const item = getRound(input.roundNumber)
          if (item.decision || item.roundNumber !== last()?.roundNumber) fail('只能修改当前未结束轮次的问题。')
          const rulesRevision = this.stores.workRules.list().revision
          for (const question of input.questions) {
            const binding = question.matchContext
            if (
              binding &&
              (binding.jobCaseId !== job!.jobCase?.id ||
                binding.jobCaseVersion !== job!.jobCase?.version ||
                binding.profileVersion !== person!.profile?.version ||
                binding.rulesRevision !== rulesRevision)
            )
              fail('问题对应的资料或规则已更新，请重新生成。')
          }
          item.questionPlan = input.questions
          item.updatedAt = stamp
          item.updatedBy = actor
          this.writeRound(item)
          description = `保存第 ${item.roundNumber} 轮面试问题`
          break
        }
        case 'feedback': {
          if (input.result !== 'passed' && input.next !== 'unknown') fail('本轮通过后才能安排下一轮或进入入场准备。')
          const enteringNextRound = input.result === 'passed' && input.next === 'next-round' && progress.stage !== 'next-round'
          const item = getRound(input.roundNumber)
          item.interviewNotes = input.notes
          item.unresolvedItems = input.unresolved
          item.updatedAt = stamp
          item.updatedBy = actor
          item.decision =
            input.result === 'pending' ? null : input.result === 'passed' && input.next === 'next-round' ? 'next-round' : input.result
          item.decisionReason = item.decision ? input.notes.slice(0, 1500) : null
          item.decidedAt = item.decision ? stamp : null
          item.decidedBy = item.decision ? actor : null
          item.stage =
            input.result === 'pending'
              ? 'awaiting-decision'
              : input.result === 'passed'
                ? input.next === 'next-round'
                  ? 'on-hold'
                  : 'passed'
                : 'closed'
          if (!historyOnly) {
            progress.stage =
              input.result === 'pending'
                ? 'feedback'
                : input.result === 'passed'
                  ? input.next === 'entry'
                    ? 'entry'
                    : input.next === 'next-round'
                      ? 'next-round'
                      : 'next-decision'
                  : 'closed'
            if (enteringNextRound) {
              progress.candidateAvailability = ''
              progress.clientAvailability = ''
            }
            if (progress.stage === 'entry') {
              const fields = new Map(job!.fields.map((f) => [f.key, f.value]))
              progress.entry = {
                ...progress.entry,
                rate: progress.entry.rate || fields.get('rate') || '',
                location: progress.entry.location || fields.get('location') || '',
                workStyle: progress.entry.workStyle || fields.get('remote') || ''
              }
            }
          }
          this.writeRound(item)
          description = `${historyOnly ? '补录' : ''}第 ${item.roundNumber} 轮面试反馈：${input.notes}`
          break
        }
        case 'cancel-schedule': {
          const item = last() ?? fail('当前没有可以取消的预约。')
          if (!item.scheduledAt || item.decision) fail('当前没有可以取消的预约。')
          previousInterview = structuredClone(item)
          Object.assign(item, { scheduledAt: null, meetingUrl: null, stage: 'contacting', updatedAt: stamp, updatedBy: actor })
          this.writeRound(item)
          progress.stage = 'coordinating'
          description = `取消第 ${item.roundNumber} 轮本次预约：${input.reason}`
          break
        }
        case 'entry':
          if (progress.stage !== 'entry') fail('请先记录客户全部面试通过，再安排进场。')
          if (input.entry.plannedDate && !validDay(input.entry.plannedDate)) fail('请输入有效的入场日期。')
          progress.entry = { ...input.entry, actualDate: progress.entry.actualDate }
          description = '更新入场日期、双方意向及报到安排'
          break
        case 'start': {
          if (progress.stage !== 'entry' || !progress.entry.candidateAccepted || !progress.entry.termsAgreed)
            fail('请先确认人员接受案件、双方条件已谈妥。')
          const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Tokyo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }).format(now)
          if (!validDay(input.actualDate) || input.actualDate > today) fail('实际到岗日期必须是今天或过去的有效日期。')
          if (this.stores.personnel.workspace().states.find((row) => row.documentId === input.documentId)?.status === 'paused')
            fail('这个人员暂停营业，不能确认到岗；请先把营业状态改为待机中。')
          const latestInterviewDay = last()?.scheduledAt
            ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
                new Date(last()!.scheduledAt!)
              )
            : null
          if (latestInterviewDay && input.actualDate < latestInterviewDay) fail('实际到岗日期不能早于已记录的最后一轮面试日期。')
          const currentStatus =
            this.stores.personnel.workspace().states.find((row) => row.documentId === input.documentId)?.status ?? 'available'
          const otherPlacement = this.list().find(
            (row) => row.id !== value.id && row.documentId === input.documentId && row.progress?.stage === 'started'
          )
          // In place elsewhere (已进场, or 近期可入场 set while there): the status from before the first placement carries on.
          progress.previousBusinessStatus = otherPlacement
            ? (otherPlacement.progress?.previousBusinessStatus ?? 'available')
            : currentStatus
          progress.entry.actualDate = input.actualDate
          progress.stage = 'started'
          this.stores.personnel.setState(
            {
              documentId: person!.documentId,
              profileVersion: person!.profile?.version ?? 0,
              reviewRevision: person!.reviewRevision,
              status: 'assigned',
              confirmed: true
            },
            actor
          )
          description = `确认实际到岗：${input.actualDate}`
          break
        }
        case 'correct-entry': {
          if (progress.stage !== 'started') fail('只能更正已进场记录。')
          const day = input.entry.actualDate
          const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Tokyo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }).format(now)
          if (!day || !validDay(day) || day > today || (input.entry.plannedDate && !validDay(input.entry.plannedDate)))
            fail('请输入有效的日期，实际到岗日期不能晚于今天。')
          if (!input.entry.candidateAccepted || !input.entry.termsAgreed) fail('如果尚未确认实际进场，请使用撤销误确认。')
          previousEntry = structuredClone(progress.entry)
          progress.entry = input.entry
          description = `更正进场记录：${input.reason}`
          break
        }
        case 'undo-start': {
          if (progress.stage !== 'started') fail('当前没有需要撤销的到岗确认。')
          previousEntry = structuredClone(progress.entry)
          progress.entry.actualDate = null
          progress.stage = 'entry'
          const otherStarted = this.list().some(
            (row) => row.id !== value.id && row.documentId === input.documentId && row.progress?.stage === 'started'
          )
          const status = this.stores.personnel.workspace().states.find((row) => row.documentId === input.documentId)?.status
          // Not in place anywhere now: 已进场, or a 近期可入场 set while placed, goes back to the status from before; a
          // status HR set otherwise is kept. Still placed elsewhere: 已进场, unless HR already marked 近期可入场 there.
          if (status === 'assigned' || (otherStarted ? status !== 'soon' && status !== 'paused' : status === 'soon'))
            this.stores.personnel.setState(
              {
                documentId: input.documentId,
                profileVersion: person!.profile?.version ?? 0,
                reviewRevision: person!.reviewRevision,
                status: otherStarted ? 'assigned' : (progress.previousBusinessStatus ?? 'available'),
                confirmed: true
              },
              actor
            )
          description = `撤销误确认到岗，恢复待进场：${input.reason}`
          break
        }
        case 'leave': {
          if (progress.stage !== 'started') fail('只有已进场的人员可以记录退场。')
          const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Tokyo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }).format(now)
          if (!validDay(input.leftDate) || input.leftDate > today) fail('退场日期必须是今天或过去的有效日期。')
          if (progress.entry.actualDate && input.leftDate < progress.entry.actualDate) fail('退场日期不能早于实际到岗日期。')
          previousEntry = structuredClone(progress.entry)
          progress.entry.leftDate = input.leftDate
          progress.stage = 'ended'
          // Available again unless the person is placed in another case, or HR stopped offering them meanwhile.
          const placedElsewhere = this.list().some(
            (row) => row.id !== value.id && row.documentId === input.documentId && row.progress?.stage === 'started'
          )
          const statusNow = this.stores.personnel.workspace().states.find((row) => row.documentId === input.documentId)?.status
          // HR's 暂停营业 (set while left, then 退场 undone) comes back instead of 待机中; a 近期可入场 set while placed stays.
          const leaveStatus = progress.previousBusinessStatus === 'paused' ? 'paused' : statusNow === 'soon' ? 'soon' : 'available'
          if (!placedElsewhere && statusNow !== leaveStatus)
            this.stores.personnel.setState(
              {
                documentId: person!.documentId,
                profileVersion: person!.profile?.version ?? 0,
                reviewRevision: person!.reviewRevision,
                status: leaveStatus,
                confirmed: true
              },
              actor
            )
          description = `记录退场：${input.leftDate}${input.reason ? `；${input.reason}` : ''}`
          break
        }
        case 'restart': {
          if (progress.stage !== 'ended') fail('只有已退场的组合可以重新开始跟进。')
          if (job!.lifecycle !== 'active') fail('案件已结束，不能重新开始跟进；如需继续，请先激活案件。')
          const statusNow = this.stores.personnel.workspace().states.find((row) => row.documentId === input.documentId)?.status
          if (statusNow === 'paused') fail('这个人员暂停营业，不能重新开始跟进；请先把营业状态改为待机中。')
          if (statusNow === 'assigned')
            fail('这个人员正在其他案件进场，不能重新开始跟进；项目快结束时请先把营业状态改为近期可入场。')
          // The earlier placement (its dates and terms) stays in this event; the new round of work starts clean.
          previousEntry = structuredClone(progress.entry)
          progress.entry = emptyProgressEntry()
          progress.stage = 'coordinating'
          delete progress.resumeStage
          delete progress.previousBusinessStatus
          description = `重新开始跟进：${input.reason}`
          break
        }
        case 'undo-leave': {
          if (progress.stage !== 'ended') fail('当前没有需要撤销的退场记录。')
          previousEntry = structuredClone(progress.entry)
          progress.entry.leftDate = null
          progress.stage = 'started'
          // Back in place, so 已进场 again (a 近期可入场 stays); the status HR left the person in comes back at the next 退场.
          const statusBeforeUndo = this.stores.personnel.workspace().states.find((row) => row.documentId === input.documentId)?.status
          if (statusBeforeUndo !== 'assigned') progress.previousBusinessStatus = statusBeforeUndo === 'paused' ? 'paused' : 'available'
          if (statusBeforeUndo !== 'soon')
            this.stores.personnel.setState(
              {
                documentId: person!.documentId,
                profileVersion: person!.profile?.version ?? 0,
                reviewRevision: person!.reviewRevision,
                status: 'assigned',
                confirmed: true
              },
              actor
            )
          description = `撤销退场，恢复进场中：${input.reason}`
          break
        }
        case 'note':
          description = input.note
          break
        case 'pause':
          if (['started', 'ended', 'closed'].includes(progress.stage)) fail('已经结束的推进不能暂停。')
          if (progress.stage !== 'paused') progress.resumeStage = progress.stage
          progress.stage = 'paused'
          // A pause HR makes by hand is HR's own; only a pause made for a placement is undone with it.
          if (input.placementId) progress.pausedByPlacement = input.placementId
          else delete progress.pausedByPlacement
          description = `暂停推进：${input.reason}`
          break
        case 'close':
          if (progress.stage === 'started') fail('已经记录到岗的业务保留进场结果；项目结束请记录退场。')
          if (progress.stage === 'ended') fail('已退场的记录无需再结束。')
          if (!['closed', 'paused'].includes(progress.stage)) progress.resumeStage = progress.stage
          progress.stage = 'closed'
          if (input.withCase) progress.closedWithCase = true
          else delete progress.closedWithCase
          description = `结束推进：${input.reason}`
          break
        case 'resume':
          if (!['paused', 'closed'].includes(progress.stage)) fail('当前推进无需恢复。')
          progress.stage =
            progress.resumeStage ??
            (last()?.decision === 'next-round'
              ? 'next-round'
              : last()?.decision
                ? 'next-decision'
                : last()?.scheduledAt
                  ? 'scheduled'
                  : 'coordinating')
          if (progress.stage === 'scheduled' && last()?.scheduledAt) {
            const scheduled = last()!
            if (
              scheduleClash(
                { ...scheduled, scheduledAt: scheduled.scheduledAt! },
                this.stores.candidateInterviews.listCandidateInterviews(),
                this.list().filter((row) => row.id !== value.id)
              )
            ) {
              // The time was taken meanwhile: back to 待约面 with that time released, so nothing (the schedule
              // center, the 约面 message to the client) still shows it as booked.
              previousInterview = structuredClone(scheduled)
              Object.assign(scheduled, { scheduledAt: null, meetingUrl: null, stage: 'contacting', updatedAt: stamp, updatedBy: actor })
              this.writeRound(scheduled)
              progress.stage = 'coordinating'
            }
          }
          delete progress.resumeStage
          delete progress.pausedByPlacement
          delete progress.closedWithCase
          description = '恢复当前案件的推进'
          break
        case 'link-interview': {
          if (progress.rounds.length) fail('当前案件已经有面试记录，不能合并未关联的历史轮次。')
          const all = this.stores.candidateInterviews.listCandidateInterviews()
          let item = all.find((row) => row.id === input.interviewId)
          const linked: CandidateInterviewSnapshot[] = []
          while (item) {
            if (item.sourceDocumentId !== input.documentId || item.kind !== 'client' || item.businessFollowUpId)
              fail('这条历史面试不属于当前人员，或已关联其他案件。')
            linked.unshift(item)
            item = item.parentInterviewId ? all.find((row) => row.id === item!.parentInterviewId) : undefined
          }
          if (!linked.length) fail('未找到历史面试。')
          for (const interview of linked)
            this.database.prepare('UPDATE candidate_interview_sessions SET business_followup_id=? WHERE id=?').run(value.id, interview.id)
          progress.rounds = linked.map((row) => ({ ...row, businessFollowUpId: value.id }))
          const tail = last()!
          progress.stage =
            // Passed or on hold: HR decides what follows (entry, another round); only a final no ends it.
            tail.decision === 'passed' || tail.decision === 'on-hold'
              ? 'next-decision'
              : tail.decision === 'next-round'
                ? 'next-round'
                : tail.decision
                  ? 'closed'
                  : tail.scheduledAt
                    ? 'scheduled'
                    : 'coordinating'
          description = '关联此前的客户面试记录'
          break
        }
      }
      value.status = ['closed', 'started', 'ended'].includes(progress.stage) ? 'closed' : 'interview'
      value.note = description
      value.nextStep = ''
      value.updatedAt = stamp
      value.recordedBy = actor
      value.revision++
      value.events = [
        ...value.events,
        {
          status: value.status,
          note: description,
          nextStep: '',
          recordedAt: stamp,
          recordedBy: actor,
          action: input.action,
          mutationId: input.mutationId,
          stage: progress.stage,
          roundNumber: input.action === 'feedback' ? input.roundNumber : last()?.roundNumber,
          ...(previousInterview ? { previousInterview } : {}),
          ...(previousEntry ? { previousEntry, entry: structuredClone(progress.entry) } : {})
        }
      ]
      this.write(value)
      if (input.action === 'prepare')
        this.stores.experience.questionEdits(input.documentId, input.reviewId, getRound(input.roundNumber).id, input.questions, actor)
      this.stores.experience.record({
        sourceKey:
          input.action === 'feedback'
            ? `round:${progress.rounds.find((r) => r.roundNumber === input.roundNumber)?.id}:feedback`
            : input.action === 'prepare'
              ? `round:${last()?.id}:questions`
              : `progress:${input.mutationId}`,
        documentId: input.documentId,
        reviewId: input.reviewId,
        interviewId: ('roundNumber' in input ? progress.rounds.find((r) => r.roundNumber === input.roundNumber) : last())?.id ?? null,
        kind:
          input.action === 'feedback'
            ? 'feedback'
            : input.action === 'prepare'
              ? 'questions'
              : input.action === 'note'
                ? 'notes'
                : 'progress',
        text: input.action === 'feedback' ? input.notes : input.action === 'note' ? input.note : description,
        actor,
        data: {
          action: input.action,
          revision: value.revision,
          ...(input.action === 'feedback' ? { result: input.result, unresolved: input.unresolved } : {}),
          ...(input.action === 'prepare' ? { questions: input.questions } : {}),
          ...('reason' in input ? { reason: input.reason } : {})
        }
      })
      if (sourceMessage) this.updateMail({ id: sourceMessage.id, followUpId: value.id, state: 'applied' })
      // When HR chooses so, the person's other open follow-ups pause once they are in place.
      if (input.action === 'start' && input.pauseOthers) {
        const title = job!.fields.find((field) => field.key === 'title')?.value ?? job!.redactedSubject
        for (const other of this.list())
          if (
            other.id !== value.id &&
            other.documentId === input.documentId &&
            other.progress &&
            !isInactiveProgressStage(other.progress.stage)
          )
            this.advance(
              {
                documentId: other.documentId,
                reviewId: other.reviewId,
                expectedRevision: other.revision,
                mutationId: randomUUID(),
                action: 'pause',
                reason: `人员已在「${title}」进场 / 「${title}」に参画`,
                placementId: value.id
              },
              actor,
              now
            )
      }
      // A start undone resumes what that start paused, where it can still move; so does 退场 when HR asks for it.
      // (Not while the person is still in place in another case: there they could not be booked anyway.)
      if (
        input.action === 'undo-start' ||
        (input.action === 'leave' &&
          input.resumePaused &&
          !this.list().some((row) => row.id !== value.id && row.documentId === input.documentId && row.progress?.stage === 'started'))
      )
        for (const other of this.list())
          if (other.progress?.pausedByPlacement === value.id && other.progress.stage === 'paused')
            try {
              this.advance(
                {
                  documentId: other.documentId,
                  reviewId: other.reviewId,
                  expectedRevision: other.revision,
                  mutationId: randomUUID(),
                  action: 'resume'
                },
                actor,
                now
              )
            } catch (cause) {
              // An ended case or a person not being offered keeps the follow-up paused; HR resumes it later.
              if (!(cause instanceof Error) || !/案件已结束|暂停营业|无需恢复|不满足/u.test(cause.message)) throw cause
            }
      return value
    })()
  }

  private write(value: BusinessFollowUp) {
    const payload = value.progress ? { ...value, progress: { ...value.progress, rounds: [] } } : value
    this.database
      .prepare(
        `INSERT INTO business_followups(id,document_id,review_id,revision,updated_at,payload) VALUES (?,?,?,?,?,?)
      ON CONFLICT(document_id,review_id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at,payload=excluded.payload`
      )
      .run(value.id, value.documentId, value.reviewId, value.revision, value.updatedAt, JSON.stringify(payload))
  }

  private writeRound(raw: CandidateInterviewSnapshot) {
    const item = candidateInterviewSnapshotSchema.parse(raw)
    this.database
      .prepare(
        `INSERT INTO candidate_interview_sessions(id,source_document_id,kind,round_number,parent_interview_id,stage,scheduled_at,duration_minutes,
      meeting_method,meeting_url,meeting_details_json,interviewer,contact_note,interview_goal,question_plan_json,interview_notes,unresolved_items_json,
      decision,decision_reason,decided_at,decided_by,created_at,updated_at,updated_by,cloud_eligible,business_followup_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?) ON CONFLICT(id) DO UPDATE SET
      stage=excluded.stage,scheduled_at=excluded.scheduled_at,duration_minutes=excluded.duration_minutes,meeting_method=excluded.meeting_method,
      meeting_url=excluded.meeting_url,meeting_details_json=excluded.meeting_details_json,interviewer=excluded.interviewer,contact_note=excluded.contact_note,
      question_plan_json=excluded.question_plan_json,interview_goal=excluded.interview_goal,
      interview_notes=excluded.interview_notes,unresolved_items_json=excluded.unresolved_items_json,decision=excluded.decision,decision_reason=excluded.decision_reason,
      decided_at=excluded.decided_at,decided_by=excluded.decided_by,updated_at=excluded.updated_at,updated_by=excluded.updated_by`
      )
      .run(
        item.id,
        item.sourceDocumentId,
        'client',
        item.roundNumber,
        item.parentInterviewId,
        item.stage,
        item.scheduledAt,
        item.durationMinutes,
        item.meetingMethod,
        item.meetingUrl,
        JSON.stringify(item.meetingDetails ?? {}),
        item.interviewer,
        item.contactNote,
        item.interviewGoal,
        JSON.stringify(item.questionPlan),
        item.interviewNotes,
        JSON.stringify(item.unresolvedItems),
        item.decision,
        item.decisionReason,
        item.decidedAt,
        item.decidedBy,
        item.createdAt,
        item.updatedAt,
        item.updatedBy,
        item.businessFollowUpId
      )
  }

  mail(): BusinessProgressMail[] {
    return this.database
      .prepare<[], { payload: string }>('SELECT payload FROM business_progress_mail ORDER BY received_at DESC,id')
      .all()
      .map((row) => JSON.parse(row.payload))
  }

  captureMail(message: {
    accountEmail: string
    messageId: string
    threadId: string
    subject: string
    body: string
    receivedAt: string
  }, options: { onlyIfMatched?: boolean } = {}): boolean {
    const text = `${message.subject}\n${message.body}`
    const kind = /入場|入场|进场|参画開始|報到|报到/u.test(text)
      ? 'entry'
      : /面[談试試接].{0,20}(結果|结果|通过|通過|合格|不合格|NG|OK|見送り)|二面|二次面[談接]|次回面談/u.test(text)
        ? 'feedback'
        : /面[談试試接]|日程調整|約面|约面/u.test(text)
          ? 'schedule'
          : null
    if (!kind) return false
    const correspondence =
      /日程.{0,8}(調整|確定|変更|候補)|面[談试試接].{0,30}(ご都合|お願い|結果|结果|通過|合格|通过|安排|时间定|日時は|日時が|確定|NG|OK|見送り)|(?:二面|二次面談|次回面談).{0,20}(安排|お願い|調整|日時|进行)|(?:入場|入场|进场|参画開始).{0,20}(確定|決定|案内|安排|通知|报到|手続)/u.test(
        text
      )
    const subjectIntent =
      /(?:面[談试試接]|入場|进场|入场|参画).{0,16}(?:日程|調整|変更|案内|結果|结果|反馈|通知|安排|ご相談|通過|通过)/u.test(message.subject)
    if (!correspondence && !subjectIntent) return false
    const id = createHash('sha256').update(`${message.accountEmail}\0${message.messageId}`).digest('hex')
    if (this.database.prepare('SELECT id FROM business_progress_mail WHERE id=?').get(id)) return true
    // A placed person's 入場 mail (start date, reporting) still belongs to that placement.
    const active = this.list().filter((row) => {
      const stage = row.progress?.stage ?? (row.status === 'closed' ? 'closed' : 'coordinating')
      return !['closed', 'ended'].includes(stage) && (stage !== 'started' || kind === 'entry')
    })
    const matches = active.filter((row) => {
      const source = this.stores.gmail.getCaseMailSource(row.reviewId)
      const thread = source
        ? this.database
            .prepare<[string, string], { thread_id: string }>(
              'SELECT thread_id FROM gmail_messages WHERE account_email=? AND gmail_message_id=?'
            )
            .get(source.accountEmail, source.messageId)
        : null
      const person = this.stores.candidates.getCandidateReview(row.documentId)
      const job = this.stores.jobCases.getJobCaseReview(row.reviewId)
      const name = person?.localIdentity?.displayName
      const title = job?.fields.find((field) => field.key === 'title')?.value ?? job?.redactedSubject
      return Boolean(
        (source?.accountEmail === message.accountEmail && thread?.thread_id === message.threadId) ||
        (name && name.length > 1 && text.includes(name) && title && title.length > 3 && text.includes(title))
      )
    })
    // From mail sync, wording alone does not make a follow-up message: a case listing that says 「面談1回 日程調整可」
    // must still become a case. Only mail tied to a follow-up (its thread, or the person and the case named) is taken.
    // Clearly follow-up correspondence (in the wording and the subject) that is not itself a case or person listing
    // stays as a follow-up message to assign by hand, rather than becoming a new case or person.
    const listing =
      /[【\[［]\s*(?:案件|要員|人材|人员|募集)|案件(?:情報|のご紹介|一覧)|単価|必須スキル|必須要件|募集|勤務地|案件概要|案件名|スキルシート|経歴書|要員(?:の)?(?:ご)?紹介|人材紹介|技術者紹介/u.test(
        text
      )
    if (options.onlyIfMatched && !matches.length && !(correspondence && subjectIntent && !listing)) return false
    // A thread may contain several people. Only attach automatically when the named person and case identify one pair.
    const named = matches.filter((row) => {
      const name = this.stores.candidates.getCandidateReview(row.documentId)?.localIdentity?.displayName
      return Boolean(name && name.length > 1 && text.includes(name))
    })
    const followUpId = named.length === 1 ? named[0]!.id : null
    const value: BusinessProgressMail = {
      id,
      followUpId,
      suggestedFollowUpIds: matches.map((row) => row.id),
      subject: message.subject.slice(0, 1000),
      body: message.body.slice(0, 12000),
      receivedAt: message.receivedAt,
      kind,
      state: 'pending'
    }
    this.database
      .prepare('INSERT INTO business_progress_mail(id,followup_id,received_at,payload) VALUES (?,?,?,?)')
      .run(id, followUpId, value.receivedAt, JSON.stringify(value))
    return true
  }

  updateMail(raw: { id: string; followUpId?: string; state?: 'applied' | 'dismissed' | 'pending' }): void {
    const input = updateBusinessProgressMailSchema.parse(raw)
    const value = this.mail().find((row) => row.id === input.id) ?? fail('消息已删除。')
    if (input.followUpId && !this.list().some((row) => row.id === input.followUpId)) fail('请选择有效的人员与案件推进记录。')
    if (input.state === 'applied' && !value.followUpId && !input.followUpId) fail('请先关联这封邮件对应的人员和案件。')
    if (input.followUpId) value.followUpId = input.followUpId
    if (input.state === 'pending' && value.state !== 'dismissed') fail('只能撤销已忽略的邮件。')
    if (input.state) value.state = input.state
    this.database
      .prepare('UPDATE business_progress_mail SET followup_id=?,payload=? WHERE id=?')
      .run(value.followUpId, JSON.stringify(value), value.id)
  }
}
