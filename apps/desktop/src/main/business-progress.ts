import { defaultAgentChatModelKey, resolveAgentChatModel } from '@agent'
import { analyzeBusinessProgressSchema, nextBusinessRound, progressAnalysisSchema, progressMessageInputSchema, redactInterviewMeetingLinksForCloud,
  type AnalyzeBusinessProgressInput, type BusinessFollowUp, type ProgressMessageInput } from '@shared'
import { gmailReplyMailbox } from '@mail'
import type { MainIpcContext } from './ipc/context'

export function createBusinessProgressAnalyzer(context: MainIpcContext) {
  const active = new Map<string,Promise<import('@shared').ProgressAnalysis>>()
  return (raw: AnalyzeBusinessProgressInput) => {
    const input = analyzeBusinessProgressSchema.parse(raw)
    const key = `${input.documentId}:${input.reviewId}`
    if (active.has(key)) return active.get(key)!
    const load = () => {
      const person = context.repository.getCandidateReview(input.documentId)
      const job = context.repository.getJobCaseReview(input.reviewId)
      if (!person || person.recordStatus === 'deleted' || !job) throw new Error('关联资料已经删除。')
      const follow = context.repository.listBusinessFollowUps().find((row) => row.documentId === input.documentId && row.reviewId === input.reviewId)
      if ((follow?.revision ?? 0) !== input.expectedRevision) throw new Error('推进记录已更新，请刷新后重新整理。')
      return JSON.stringify({ today: new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date()), timeZone:'Asia/Tokyo',
        source: redactInterviewMeetingLinksForCloud(input.text),
        context: { stage: follow?.progress?.stage ?? 'coordinating', latestRound: nextBusinessRound(follow?.progress),
          candidateAvailability: follow?.progress?.candidateAvailability ?? '', clientAvailability: follow?.progress?.clientAvailability ?? '' }
      })
    }
    const promise = (async () => {
      const projection = load()
      if (!context.agentNarrativeStreamer) throw new Error('请先连接云端 AI，也可以直接手动记录。')
      const value = progressAnalysisSchema.parse(await context.agentNarrativeStreamer.analyzeBusinessProgress({ projection, lang: input.lang,
        model: resolveAgentChatModel(context.agentChatModelCatalog, defaultAgentChatModelKey), signal: AbortSignal.timeout(60000) }))
      if (load() !== projection) throw new Error('整理期间推进记录已变化，请刷新后重试。')
      // Only a proposal is returned. No business outcome is saved by an AI request.
      if (value.result !== 'pending' && !value.evidence.trim()) throw new Error('AI 未提供面试结果的原文依据，请手动记录或重试。')
      if (value.evidence && !input.text.replace(/\s/gu,'').includes(value.evidence.replace(/\s/gu,''))) throw new Error('AI 的反馈依据无法在原文中找到，请手动记录或重试。')
      return value
    })().finally(() => active.delete(key))
    active.set(key,promise); return promise
  }
}

export function draftBusinessProgressMessage(context: MainIpcContext, raw: ProgressMessageInput) {
  const input = progressMessageInputSchema.parse(raw)
  const person = context.repository.getCandidateReview(input.documentId)
  const job = context.repository.getJobCaseReview(input.reviewId)
  if (!person || person.recordStatus === 'deleted' || !job) throw new Error('关联资料已经删除。')
  const follow = context.repository.listBusinessFollowUps().find((row) => row.documentId === input.documentId && row.reviewId === input.reviewId)
  if ((follow?.revision ?? 0) !== input.expectedRevision) throw new Error('推进记录已更新，请重新准备消息。')
  const zh = input.lang === 'zh'
  const title = job.fields.find((field) => field.key === 'title')?.value ?? job.redactedSubject
  const name = person.localIdentity?.displayName ?? person.fileName
  const latest = follow?.progress?.rounds.at(-1)
  const e = follow?.progress?.entry
  const stamp = latest?.scheduledAt ? new Date(latest.scheduledAt).toLocaleString(zh ? 'zh-CN' : 'ja-JP', { timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false })+' JST' : null
  const intro = zh ? `您好，关于 ${name} 与「${title}」：` : `お世話になっております。\n${name}様・「${title}」についてご連絡いたします。`
  let body: string
  if (input.purpose === 'entry') {
    if (follow?.progress?.stage !== 'entry' && follow?.progress?.stage !== 'started') throw new Error('客户全部面试通过后才能准备入场通知。')
    body = [zh ? '请确认以下入场安排：' : '以下の参画予定をご確認ください。',
      `${zh ? '入场日期' : '参画日'}：${e?.plannedDate || (zh?'待确认':'未定')}`,
      `${zh ? '工作地点' : '勤務地'}：${e?.location || (zh?'待确认':'未定')}`,
      `${zh ? '报到时间' : '集合時間'}：${e?.reportTime || (zh?'待确认':'未定')}`,
      e?.contact ? `${zh?'联系人':'連絡先'}：${e.contact}` : '', e?.materials ? `${zh?'携带材料':'持参物'}：${e.materials}` : ''
    ].filter(Boolean).join('\n')
  } else if (input.purpose === 'feedback') {
    body = zh ? `想确认${latest ? `第 ${latest.roundNumber} 轮` : '本次'}面试的反馈，以及是否需要安排下一轮。方便时请告知，谢谢。` : `${latest ? `${latest.roundNumber}次` : '今回の'}面談のフィードバックと、次回面談の有無についてお知らせいただけますでしょうか。`
  } else if (latest?.scheduledAt && !latest.decision) {
    body = [zh ? `第 ${latest.roundNumber} 轮面试安排如下：` : `${latest.roundNumber}次面談の予定です。`, stamp,
      latest.meetingUrl || latest.meetingDetails?.onsiteAddress || latest.meetingDetails?.phoneNote || '',
      latest.contactNote || '', zh ? '如需调整时间，请提前联系。' : '日程の変更が必要な場合はご連絡ください。'].filter(Boolean).join('\n')
  } else {
    body = [zh ? '希望协调面试时间，请告知方便的时段。' : '面談日程を調整したく、ご都合の良い日時をお知らせください。',
      follow?.progress?.candidateAvailability ? `${zh?'人员可用时间':'要員の候補日時'}：${follow.progress.candidateAvailability}` : '',
      follow?.progress?.clientAvailability ? `${zh?'案件方可用时间':'案件側の候補日時'}：${follow.progress.clientAvailability}` : ''
    ].filter(Boolean).join('\n')
  }
  const recipient = gmailReplyMailbox(input.recipient === 'person' ? person.localIdentity?.email ?? '' : context.repository.getCaseReplyRecipient(input.reviewId) ?? '')
  return { text:[intro,body].join('\n\n'), recipient }
}

export function businessProgressCalendar(follow: BusinessFollowUp, title: string): string {
  const round = follow.progress?.rounds.at(-1)
  if (!round?.scheduledAt || round.decision || follow.progress?.stage !== 'scheduled') throw new Error('当前没有需要导出的面试安排。')
  const stamp = (time: number) => new Date(time).toISOString().replace(/[-:]/gu,'').replace(/\.\d{3}Z/u,'Z')
  const escape = (value: string) => value.replace(/\\/gu,'\\\\').replace(/\r?\n/gu,'\\n').replace(/,/gu,'\\,').replace(/;/gu,'\\;')
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//SES Agent Desktop//Business Interview//JA','BEGIN:VEVENT',
    `UID:${round.id}@ses-agent.local`, `DTSTAMP:${stamp(Date.now())}`, `SEQUENCE:${follow.revision}`, `DTSTART:${stamp(Date.parse(round.scheduledAt))}`,
    `DTEND:${stamp(Date.parse(round.scheduledAt)+round.durationMinutes*60000)}`, `SUMMARY:${escape(`${title} · 第 ${round.roundNumber} 轮面试`)}`,
    `DESCRIPTION:${escape(round.contactNote ?? '')}`,`LOCATION:${escape(round.meetingUrl ?? round.meetingDetails?.onsiteAddress ?? '')}`,
    'BEGIN:VALARM','TRIGGER:-PT30M','ACTION:DISPLAY','DESCRIPTION:面试即将开始','END:VALARM','END:VEVENT','END:VCALENDAR']
  return lines.flatMap((line) => {
    const parts: string[]=[]; let current=''
    for (const char of line) { if (Buffer.byteLength(current+char)>73) { parts.push(current); current=' '+char } else current+=char }
    parts.push(current); return parts
  }).join('\r\n')+'\r\n'
}
