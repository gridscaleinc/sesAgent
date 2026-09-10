import { useBusinessProgress } from '../business-progress-data'
import { useEffect, useRef, useState } from 'react'
import { businessProgressStep, emptyProgressEntry, openInterviewMeetingInputSchema, nextBusinessRound, type BusinessFollowUp, type BusinessProgressMail,
  type CandidateInterviewSnapshot, type CandidateReviewSnapshot, type JobCaseReviewSnapshot, type ProgressAnalysis,
  type ProgressCommand, type ProgressEntry, type ProgressSchedule, type ProgressMailPurpose } from '@shared'
import { localizedIpcError, useUiLocale } from '../i18n'
import { copyTextToClipboard } from '../copy-text'
import type { FollowUpTarget } from './HrFollowUps'
import './hr-followups.css'
import './hr-progress.css'

type Panel = 'schedule' | 'feedback' | 'entry' | 'history'
type Draft = { revision:number; panel:Panel; candidateAvailability:string; clientAvailability:string; pending:string;
  schedule:ProgressSchedule; feedback:string; result:'pending'|'passed'|'failed'|'no-show'|'withdrawn'; next:'unknown'|'next-round'|'entry'; unresolved:string;
  entry:ProgressEntry; actualDate:string; analysis:ProgressAnalysis|null; messageId?:string; note:string }
const pairKey = (value: {documentId:string;reviewId:string}) => `${value.documentId}:${value.reviewId}`
const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date())
const toInputTime = (value:string|null) => value ? new Date(Date.parse(value)+9*3600000).toISOString().slice(0,16) : ''
const fromInputTime = (value:string) => value ? new Date(`${value}:00+09:00`).toISOString() : ''
function makeDraft(item:BusinessFollowUp, pending:string[]=[]):Draft {
  const progress=item.progress, round=progress?.rounds.at(-1), state=businessProgressStep(item)
  return { revision:item.revision, panel:['closed','paused'].includes(state.stage) ? 'history' : ['entry','started'].includes(state.stage) ? 'entry' : ['feedback','next-decision'].includes(state.stage) ? 'feedback' : 'schedule',
    candidateAvailability:progress?.candidateAvailability??'', clientAvailability:progress?.clientAvailability??'', pending:(progress?.pendingConditions??pending).join('\n'),
    schedule:{ roundNumber:nextBusinessRound(progress), scheduledAt:state.stage==='next-round' ? '' : round?.scheduledAt??'', durationMinutes:round?.durationMinutes??60,
      meetingMethod:round?.meetingMethod??'onsite',meetingUrl:state.stage==='next-round'?'':round?.meetingUrl??'',location:round?.meetingDetails?.onsiteAddress??round?.meetingDetails?.phoneNote??'',interviewer:round?.interviewer??'',note:round?.contactNote??'' },
    feedback:state.stage==='next-round'?'':round?.interviewNotes??'', result:state.stage==='next-round'?'pending':round?.decision==='next-round'?'passed':round?.decision==='on-hold'?'pending':round?.decision??'pending',
    next:progress?.stage==='entry'?'entry':progress?.stage==='next-round'?'next-round':'unknown', unresolved:(round?.unresolvedItems??progress?.pendingConditions??pending).join('\n'),
    entry:progress?.entry??emptyProgressEntry(), actualDate:localDate(), analysis:null, note:'' }
}
const split = (value:string) => [...new Set(value.split('\n').map((line)=>line.trim()).filter(Boolean))]

export function HrProgressWorkbench({ embedded=false, onBack, target, active=true, reloadToken, people, cases, interviews=[], onView, onBrowse, onSchedule, onBackToMatches, onUpdated }: {
  embedded?:boolean; onBack?():void
  target:FollowUpTarget|null; active?:boolean; reloadToken:unknown; people:CandidateReviewSnapshot[]; cases:JobCaseReviewSnapshot[]; interviews?:CandidateInterviewSnapshot[]
  onView(kind:'case'|'person',id:string):void; onBrowse?(kind:'case'|'person'):void; onSchedule?():void; onBackToMatches?():void; onUpdated?():void
}) {
  const zh=useUiLocale()==='zh-CN', t=(cn:string,ja:string)=>zh?cn:ja
  const shared=useBusinessProgress()
  const [localItems,setItems]=useState<BusinessFollowUp[]>([]), [mail,setMail]=useState<BusinessProgressMail[]>([])
  const [selected,setSelected]=useState<string|null>(null), [filter,setFilter]=useState('active'),[query,setQuery]=useState(''),[page,setPage]=useState(1)
  const items=shared?.rows??localItems
  const [localLoading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reload,setReload]=useState(0),[clock,setClock]=useState(()=>new Date())
  const loading=localLoading||Boolean(shared?.loading)
  const [drafts,setDrafts]=useState<Record<string,Draft>>({}),[inboxOpen,setInboxOpen]=useState(false)
  const [message,setMessage]=useState<{purpose:ProgressMailPurpose;recipient:'person'|'client';lang:'zh'|'ja';text:string;to:string|null;draftKey:string}|null>(null)
  const content=useRef<HTMLDivElement>(null)
  const lock=useRef(false), requests=useRef(new Map<string,string>()), targetSeen=useRef<FollowUpTarget|null>(null), loadEpoch=useRef(0)
  useEffect(()=>{const timer=setInterval(()=>setClock(new Date()),30000);return()=>clearInterval(timer)},[])
  useEffect(()=>{
    let alive=true;const epoch=++loadEpoch.current;setLoading(true)
    void Promise.all([shared?Promise.resolve(shared.rows):window.sesAgent.listBusinessFollowUps(),window.sesAgent.listBusinessProgressMail()]).then(([rows,messages])=>{
      if(alive&&epoch===loadEpoch.current){setItems(rows);setMail(messages);setError('')}
    }).catch((cause)=>{if(alive&&epoch===loadEpoch.current)setError(localizedIpcError(zh?'zh-CN':'ja-JP',cause,t('未能读取跟进记录，请重试。','進行記録を読み込めませんでした。再試行してください。')))}).finally(()=>{if(alive&&epoch===loadEpoch.current)setLoading(false)})
    return()=>{alive=false}
  },[reloadToken,reload])
  useEffect(()=>{
    if(!target||!active||targetSeen.current===target)return
    targetSeen.current=target;setSelected(pairKey(target));setFilter('all');setQuery('');setPage(1);setMessage(null)
  },[target,active])
  const personName=(id:string)=>{const person=people.find((row)=>row.documentId===id);return person?.localIdentity?.displayName??person?.fileName??t('人员已删除','要員情報なし')}
  const caseName=(id:string)=>{const job=cases.find((row)=>row.reviewId===id);return job?.fields.find((field)=>field.key==='title')?.value??job?.redactedSubject??t('案件已删除','案件情報なし')}
  const timestamp=(value:string|null)=>value?new Date(value.length===10?`${value}T00:00:00+09:00`:value).toLocaleString(zh?'zh-CN':'ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',...(value.length>10?{hour:'2-digit',minute:'2-digit',hour12:false}:{})}):''
  const visible=items.filter((row)=>{
    const state=businessProgressStep(row,clock,zh)
    return (filter==='all'||filter==='today'&&state.due||filter==='entry'&&state.stage==='entry'||filter==='started'&&state.stage==='started'||filter==='active'&&!['started','closed','paused'].includes(state.stage))
      && (!query.trim()||`${personName(row.documentId)} ${caseName(row.reviewId)} ${row.note}`.toLowerCase().includes(query.trim().toLowerCase()))
  }).sort((a,b)=>Number(businessProgressStep(b,clock).due)-Number(businessProgressStep(a,clock).due)||b.updatedAt.localeCompare(a.updatedAt))
  const pages=Math.max(1,Math.ceil(visible.length/12)), currentPage=Math.min(page,pages)
  const virtual:BusinessFollowUp|null=target&&pairKey(target)===selected&&!items.some((row)=>pairKey(row)===selected)?{
    id:'',documentId:target.documentId,reviewId:target.reviewId,revision:0,status:'interview',note:'',nextStep:'',updatedAt:'',recordedBy:'',events:[]
  }:null
  const current=items.find((row)=>pairKey(row)===selected)??(embedded?null:virtual??visible[0]??null)
  const key=current?pairKey(current):'', draft=current?(drafts[key]??makeDraft(current,target?.pendingConditions)):null
  const update=(change:Partial<Draft>)=>{if(draft)setDrafts((state)=>({...state,[key]:{...draft,...change}}))}
  const pendingMail=mail.filter((row)=>row.state==='pending')
  const state=current?businessProgressStep(current,clock,zh):null
  const latestRound=current?.progress?.rounds.at(-1)
  const selectScheduleRound=(roundNumber:number)=>{
    if(!draft)return
    const saved=current?.progress?.rounds.find((round)=>round.roundNumber===roundNumber)
    update({panel:'schedule',schedule:saved?{...draft.schedule,roundNumber,scheduledAt:saved.scheduledAt??'',meetingMethod:saved.meetingMethod,meetingUrl:saved.meetingUrl??'',durationMinutes:saved.durationMinutes,location:saved.meetingDetails?.onsiteAddress??saved.meetingDetails?.phoneNote??'',interviewer:saved.interviewer??'',note:saved.contactNote??''}:{...draft.schedule,roundNumber,scheduledAt:'',meetingUrl:'',note:''}})
  }
  useEffect(()=>{if(content.current)content.current.scrollTop=0},[key,draft?.panel,state?.stage])
  const inactive=state&&['started','closed','paused'].includes(state.stage)
  const stale=Boolean(current&&draft&&current.revision!==draft.revision)
  const run=async<T,>(work:()=>Promise<T>)=>{
    if(lock.current)return
    lock.current=true;setBusy(true);setError('');setNotice('')
    try{return await work()}catch(cause){setError(localizedIpcError(zh?'zh-CN':'ja-JP',cause,t('操作未完成，输入已保留，请重试。','操作を完了できませんでした。入力は保持されています。再試行してください。')))}finally{lock.current=false;setBusy(false)}
  }
  const save=async(command:ProgressCommand, row=current)=>{
    if(!row)return
    await run(async()=>{
      const rowKey=pairKey(row), sourceDraft=drafts[rowKey]??makeDraft(row)
      const body={documentId:row.documentId,reviewId:row.reviewId,expectedRevision:sourceDraft.revision,...command,...(sourceDraft.messageId && ['coordinate','schedule','feedback','entry'].includes(command.action) ? {sourceMessageId:sourceDraft.messageId} : {})}
      const requestKey=JSON.stringify(body),mutationId=requests.current.get(requestKey)??crypto.randomUUID();requests.current.set(requestKey,mutationId)
      const value=await window.sesAgent.advanceBusinessProgress({...body,mutationId})
      shared?.publish([value])
      loadEpoch.current++;setLoading(false);setItems((rows)=>[value,...rows.filter((item)=>item.id!==value.id)])
      // Saving availability should not discard an unsaved second/third-round appointment.
      const savedDraft=command.action==='coordinate'?{...sourceDraft,revision:value.revision,messageId:undefined}:makeDraft(value)
      setSelected(rowKey);setDrafts((rows)=>({...rows,[rowKey]:savedDraft}));setNotice(t('已保存，下一步已更新','保存しました。次の対応を更新しました'))
      if(body.sourceMessageId){
        setMail((rows)=>rows.map((item)=>item.id===sourceDraft.messageId?{...item,state:'applied'}:item))
      }
      onUpdated?.()
    })
  }
  const analyze=()=>{if(!current||!draft)return;void run(async()=>{
    const value=await window.sesAgent.analyzeBusinessProgress({documentId:current.documentId,reviewId:current.reviewId,expectedRevision:draft.revision,text:draft.feedback,lang:zh?'zh':'ja'})
    update({analysis:value,result:value.result,next:value.next,unresolved:value.unresolved.join('\n'),
      panel:value.result!=='pending'?'feedback':value.kind==='schedule'?'schedule':value.kind==='entry'&&current.progress?.stage==='entry'?'entry':'feedback',
      schedule:{...draft.schedule,roundNumber:value.roundNumber??draft.schedule.roundNumber,scheduledAt:value.scheduledAt??draft.schedule.scheduledAt},
      candidateAvailability:value.candidateAvailability||draft.candidateAvailability,clientAvailability:value.clientAvailability||draft.clientAvailability,
      entry:{...draft.entry,plannedDate:value.plannedDate??draft.entry.plannedDate}})
  })}
  const prepareMessage=(purpose:ProgressMailPurpose,recipient:'person'|'client'='client',lang:'zh'|'ja'=zh?'zh':'ja')=>{
    if(!current||!draft)return;void run(async()=>{
      if (purpose==='appointment' && (draft.candidateAvailability!==(current.progress?.candidateAvailability??'') || draft.clientAvailability!==(current.progress?.clientAvailability??''))) throw new Error(t('请先保存可用时间，消息会采用已保存的安排。','候補日時を先に保存してください。連絡文には保存済みの予定を使います。'))
      if (purpose==='entry' && JSON.stringify(draft.entry)!==JSON.stringify(current.progress?.entry)) throw new Error(t('请先保存入场安排，再准备通知。','参画予定を保存してから案内を準備してください。'))
      const result=await window.sesAgent.draftBusinessProgressMessage({documentId:current.documentId,reviewId:current.reviewId,expectedRevision:current.revision,purpose,recipient,lang})
      setMessage({purpose,recipient,lang,text:result.text,to:result.recipient,draftKey:key})
    })
  }
  const selectedPerson = current ? people.find((row) => row.documentId === current.documentId) : null
  const selectedCase = current ? cases.find((row) => row.reviewId === current.reviewId) : null
  const panels:Array<[Panel,string]>=[['schedule',t('面试安排','面談日程')],['feedback',t('反馈与 AI 整理','フィードバックと AI 整理')],['entry',t('入场安排','参画手配')],['history',t('完整记录','全履歴')]]
  const count=(name:string)=>items.filter((row)=>{const s=businessProgressStep(row,clock);return name==='all'||name==='today'&&s.due||name==='entry'&&s.stage==='entry'||name==='started'&&s.stage==='started'||name==='active'&&!['started','closed','paused'].includes(s.stage)}).length
  return <section className={`hr-followups hr-progress${embedded?' is-embedded':''}`} aria-label={t('业务跟进','業務の対応記録')}>
    {embedded?<header className="hr-followup-heading hr-progress-embedded-heading"><button disabled={busy} type="button" onClick={onBack}>← {t('返回营业情况','営業状況に戻る')}</button><button disabled={busy} type="button" onClick={onBack} aria-label={t('关闭跟进操作','対応操作を閉じる')}>×</button></header>:<header className="hr-followup-heading"><div><h2>{t('从约面到进场','面談から参画まで')}</h2><p>{t('每个人员与案件，分别推进下一步。','要員と案件ごとに、次の対応を進めます。')}</p></div><div className="hr-followup-heading-actions">
      {onBackToMatches?<button disabled={busy} onClick={onBackToMatches}>{t('返回匹配结果','マッチング結果に戻る')}</button>:null}
      {onSchedule?<button disabled={busy} onClick={onSchedule}>{t('面试日程','面談日程')}</button>:null}
      <button disabled={busy||loading} onClick={()=>{void shared?.refresh();setReload((value)=>value+1)}}>{t('刷新','再読込')}</button></div></header>}
    {!embedded?<nav className="hr-followup-filters" aria-label={t('推进阶段','進行段階')}>{[['today',t('今天要做','今日の対応')],['active',t('进行中','進行中')],['entry',t('待进场','参画待ち')],['started',t('已进场','参画済み')],['all',t('全部','すべて')]].map(([id,label])=><button key={id} disabled={busy} aria-pressed={filter===id} onClick={()=>{setFilter(id!);setSelected(null);setPage(1);setMessage(null)}}>{label}<span>{count(id!)}</span></button>)}
      <button className="hr-progress-mail-toggle" aria-expanded={inboxOpen} onClick={()=>setInboxOpen(!inboxOpen)}>{t('新邮件','新着メール')}<span>{pendingMail.length}</span></button></nav>:null}
    {error?<p role="alert" className="hr-followup-message is-error">{error}</p>:null}{notice?<p role="status" className="hr-followup-message">{notice}</p>:null}
    {inboxOpen?<section className="hr-progress-inbox" aria-label={t('面试与入场邮件','面談・参画メール')}>
      {!pendingMail.length?<p>{t('没有待处理的面试或入场邮件。','未処理の面談・参画メールはありません。')}</p>:pendingMail.map((item)=><article key={item.id}>
        <strong>{item.subject}</strong><small>{timestamp(item.receivedAt)}</small><details><summary>{t('查看邮件内容','メール本文を見る')}</summary><p>{item.body}</p></details>
        <select aria-label={t('关联人员与案件','要員・案件を関連付け')} disabled={busy} value={item.followUpId??''} onChange={(event)=>{const followUpId=event.target.value;if(followUpId)void run(async()=>{await window.sesAgent.updateBusinessProgressMail({id:item.id,followUpId});setMail((rows)=>rows.map((row)=>row.id===item.id?{...row,followUpId}:row))})}}><option value="">{t('选择对应的人员与案件','対応する要員と案件を選択')}</option>{items.map((row)=><option key={row.id} value={row.id}>{personName(row.documentId)} · {caseName(row.reviewId)}</option>)}</select>
        <button disabled={busy||!item.followUpId} onClick={()=>{const row=items.find((row)=>row.id===item.followUpId);if(row){const k=pairKey(row);setSelected(k);setFilter('all');setDrafts((all)=>({...all,[k]:{...(all[k]??makeDraft(row)),panel:'feedback',feedback:item.body,messageId:item.id,analysis:null}}));setInboxOpen(false)}}}>{t('整理到这条推进','この対応で整理')}</button>
        <button disabled={busy} onClick={()=>void run(async()=>{await window.sesAgent.updateBusinessProgressMail({id:item.id,state:'dismissed'});setMail((rows)=>rows.filter((row)=>row.id!==item.id))})}>{t('忽略','無視')}</button>
      </article>)}
    </section>:null}
    <div className="hr-progress-layout">{!embedded?<aside className="hr-followup-list-pane"><label className="hr-followup-search"><input type="search" aria-label={t('搜索跟进','対応記録を検索')} placeholder={t('搜索人员或案件','要員・案件を検索')} disabled={busy} value={query} onChange={(event)=>{setQuery(event.target.value);setPage(1)}}/></label>
      <div className="hr-followup-list-meta"><span>{visible.length} {t('条推进','件の進行')}</span><span>{t('优先显示待办','要対応を優先')}</span></div>
      <div className="hr-followup-list">{loading&&!items.length?<p>{t('正在读取','読込中')}</p>:null}
        {visible.slice((currentPage-1)*12,currentPage*12).map((row)=>{const step=businessProgressStep(row,clock,zh);return <button className="hr-followup-item" key={row.id} disabled={busy} aria-pressed={key===pairKey(row)} onClick={()=>{setSelected(pairKey(row));setMessage(null);setNotice('');setError('')}}>
          <span className="hr-followup-item-top"><strong>{personName(row.documentId)}</strong><span className={`hr-followup-badge stage-${step.stage}`}>{step.label}</span></span><span>{caseName(row.reviewId)}</span>
          <span className="hr-progress-next-line"><strong>{step.action}</strong><time>{timestamp(step.when)}</time></span>
          {pendingMail.some((mail)=>mail.followUpId===row.id)?<small>{t('收到新邮件','新着メールあり')}</small>:null}
        </button>})}
        {!loading&&!visible.length?<div className="hr-followup-empty"><h3>{t('还没有这类推进','該当する進行はありません')}</h3><p>{t('在匹配结果中选定案件或人员，点击“安排面试”即可开始。','マッチング結果で案件・要員を選び、面談を予約して開始します。')}</p>{onBrowse?<button onClick={()=>onBrowse('person')}>{t('去人员找案件','要員から案件を探す')}</button>:null}</div>:null}
      </div>{pages>1?<div className="hr-progress-pagination"><button disabled={busy||currentPage===1} onClick={()=>setPage(currentPage-1)}>{t('上一页','前のページ')}</button><span>{currentPage} / {pages}</span><button disabled={busy||currentPage===pages} onClick={()=>setPage(currentPage+1)}>{t('下一页','次のページ')}</button></div>:null}
    </aside>:null}
    {current&&draft&&state?<article className="hr-progress-detail" aria-label={t('推进详情','進行の詳細')}>
      <header><div><small>{state.label}</small><h3>{personName(current.documentId)}</h3><p>{caseName(current.reviewId)}</p></div><div><button disabled={busy} onClick={()=>onView('person',current.documentId)}>{t('查看人员','要員を見る')}</button><button disabled={busy} onClick={()=>onView('case',current.reviewId)}>{t('查看案件','案件を見る')}</button></div></header>
      <div className="hr-progress-track" aria-label={t('业务流程','業務の流れ')}>{[t('约面','日程調整'),t('面试与反馈','面談と結果'),t('入场准备','参画準備'),t('实际到岗','参画開始')].map((label,index)=><span key={label} className={index<=(['entry','started'].includes(state.stage)?state.stage==='started'?3:2:state.stage==='coordinating'?0:1)?'is-reached':''}>{label}</span>)}</div>
      <nav className="hr-progress-tabs" aria-label={t('推进内容','進行内容')}>{panels.map(([id,label])=><button key={id} disabled={busy} aria-pressed={draft.panel===id} onClick={()=>{update({panel:id});setMessage(null)}}>{label}</button>)}</nav>
      <div className="hr-progress-content" ref={content}>
      {stale?<p className="hr-followup-message is-error">{t('其他操作更新了记录。输入已保留，请核对最新状态后继续。','記録が更新されました。入力は保持されています。最新状況をご確認ください。')}<button disabled={busy} onClick={()=>update({revision:current.revision})}>{t('使用最新记录继续','最新記録で続ける')}</button></p>:null}
      {items.some((row)=>row.documentId===current.documentId&&row.id!==current.id&&row.progress?.stage==='started')?<p className="hr-followup-message">{t('此人员已在其他案件进场，请确认本案件是否继续推进。','この要員は別案件で参画済みです。この案件を継続するか確認してください。')}</p>:null}
      {draft.analysis?<aside className="hr-progress-analysis"><strong>{t('AI 整理建议','AI 整理案')}</strong><p>{draft.analysis.summary}</p>{draft.analysis.evidence?<blockquote>{draft.analysis.evidence}</blockquote>:null}<small>{t('核对下面的安排或结果，保存后生效。','下の予定・結果を確認し、保存して反映します。')}</small>
        {draft.analysis.proposedTimes.length?<div>{draft.analysis.proposedTimes.map((time)=><button disabled={busy} key={time} onClick={()=>update({panel:'schedule',schedule:{...draft.schedule,scheduledAt:time}})}>{timestamp(time)} JST</button>)}</div>:null}</aside>:null}
      {draft.panel==='schedule'?<>
        {inactive?<p>{state.label}</p>:<>
        <h4>{state.stage==='next-round'?t('安排下一轮面试','次の面談を予約'):t('协调双方时间','双方の日程を調整')}</h4>
        <div className="hr-progress-form-grid"><label>{t('人员可用时间','要員の候補日時')}<textarea disabled={busy} rows={2} value={draft.candidateAvailability} onChange={(event)=>update({candidateAvailability:event.target.value})}/></label>
        <label>{t('案件方可用时间','案件側の候補日時')}<textarea disabled={busy} rows={2} value={draft.clientAvailability} onChange={(event)=>update({clientAvailability:event.target.value})}/></label></div>
        <details><summary>{t('本次需要沟通的条件','今回確認する条件')}</summary><textarea aria-label={t('待沟通事项','確認事項')} rows={3} disabled={busy} value={draft.pending} onChange={(event)=>update({pending:event.target.value})}/></details>
        <div className="hr-progress-actions"><button disabled={busy||stale} onClick={()=>void save({action:'coordinate',candidateAvailability:draft.candidateAvailability,clientAvailability:draft.clientAvailability,pendingConditions:split(draft.pending)})}>{t('保存可用时间','候補日時を保存')}</button><button disabled={busy||stale} onClick={()=>prepareMessage('appointment')}>{t('准备约面消息','日程調整の連絡を準備')}</button><button disabled={busy} onClick={()=>update({panel:'feedback',feedback:[t('人员可用时间','要員の候補日時')+': '+draft.candidateAvailability,t('案件方可用时间','案件側の候補日時')+': '+draft.clientAvailability].join('\n')})}>{t('让 AI 整理时间','AIで日時を整理')}</button></div>
        <details className="hr-progress-preparation"><summary>{t('面试前快速准备','面談前の準備')}</summary><h4>{t('案件关注点','案件の要点')}</h4><p>{selectedCase?.fields.filter((field)=>['required_skills','description','role'].includes(field.key)&&field.value).map((field)=>field.value).join('\n')}</p>
        {current.progress?.rounds.at(-1)?.unresolvedItems.length?<><h4>{t('上轮留下的问题','前回からの確認事項')}</h4><ul>{current.progress.rounds.at(-1)!.unresolvedItems.map((line)=><li key={line}>{line}</li>)}</ul></>:null}
        <h4>{t('人员项目经历','要員のプロジェクト経験')}</h4>{selectedPerson?.projectExperiences.map((project)=><p key={project.draftId}><strong>{project.title}</strong> · {project.period}<br/>{project.technologies}</p>)}</details>
        <form onSubmit={(event)=>{event.preventDefault();void save({action:'schedule',schedule:draft.schedule})}}><div className="hr-progress-round-heading"><h4>{t('确认面试安排','面談予定を確定')} · {t('第','第')} {draft.schedule.roundNumber} {t('轮','回')}</h4>{latestRound&&draft.schedule.roundNumber<=latestRound.roundNumber&&latestRound.roundNumber<20?<button type="button" disabled={busy||stale} onClick={()=>selectScheduleRound(latestRound.roundNumber+1)}>{t('安排下一轮面试','次の面談を予約')}</button>:null}</div>
          <div className="hr-progress-form-grid"><label>{t('面试轮次','面談回次')}<input type="number" min={latestRound?.roundNumber??1} max={Math.min(20,(latestRound?.roundNumber??0)+1)} disabled={busy} value={draft.schedule.roundNumber} onChange={(event)=>selectScheduleRound(Number(event.target.value))}/></label>
          <label>{t('面试时间（日本时间）','面談日時（日本時間）')}<input type="datetime-local" disabled={busy} value={toInputTime(draft.schedule.scheduledAt)} onChange={(event)=>update({schedule:{...draft.schedule,scheduledAt:fromInputTime(event.target.value)}})}/></label>
          <label>{t('时长（分钟）','所要時間（分）')}<input type="number" min={5} max={480} disabled={busy} value={draft.schedule.durationMinutes} onChange={(event)=>update({schedule:{...draft.schedule,durationMinutes:Number(event.target.value)}})}/></label>
          <label>{t('面试形式','面談形式')}<select disabled={busy} value={draft.schedule.meetingMethod} onChange={(event)=>update({schedule:{...draft.schedule,meetingMethod:event.target.value as ProgressSchedule['meetingMethod']}})}><option value="onsite">{t('现场','対面')}</option><option value="phone">{t('电话','電話')}</option><option value="zoom">Zoom</option><option value="google-meet">Google Meet</option></select></label>
          {['zoom','google-meet'].includes(draft.schedule.meetingMethod)?<label className="full">{t('会议链接','会議リンク')}<input disabled={busy} type="text" value={draft.schedule.meetingUrl} onChange={(event)=>update({schedule:{...draft.schedule,meetingUrl:event.target.value}})}/></label>:<label className="full">{t('地点或电话安排','場所・電話の案内')}<input disabled={busy} value={draft.schedule.location} onChange={(event)=>update({schedule:{...draft.schedule,location:event.target.value}})}/></label>}
          <label>{t('面试官','面談担当者')}<input disabled={busy} value={draft.schedule.interviewer} onChange={(event)=>update({schedule:{...draft.schedule,interviewer:event.target.value}})}/></label>
          <label>{t('安排备注','日程メモ')}<input disabled={busy} value={draft.schedule.note} onChange={(event)=>update({schedule:{...draft.schedule,note:event.target.value}})}/></label></div>
          <div className="hr-progress-actions"><button className="hr-primary" disabled={busy||stale} type="submit">{busy?t('正在保存','保存中'):draft.schedule.scheduledAt?t('确认预约','予約を確定'):t('保存面试安排','面談予定を保存')}</button>
          <button type="button" disabled={busy} onClick={()=>update({panel:'feedback',schedule:{...draft.schedule,roundNumber:nextBusinessRound(current.progress)}})}>{t('记录面试结果','面談結果を記録')}</button>
          {current.progress?.rounds.at(-1)?.scheduledAt&&!current.progress.rounds.at(-1)?.decision?<><button type="button" disabled={busy} onClick={()=>void run(async()=>{await window.sesAgent.exportBusinessProgressCalendar({followUpId:current.id,expectedRevision:current.revision})})}>{t('导出日历提醒','カレンダーに出力')}</button><button type="button" disabled={busy} onClick={()=>prepareMessage('reminder','person')}>{t('准备面试提醒','面談リマインドを準備')}</button>{openInterviewMeetingInputSchema.safeParse({method:current.progress.rounds.at(-1)?.meetingMethod,url:current.progress.rounds.at(-1)?.meetingUrl}).success?<button type="button" disabled={busy} onClick={()=>void run(async()=>{const round=current.progress!.rounds.at(-1)!;await window.sesAgent.openInterviewMeeting({method:round.meetingMethod as 'zoom'|'google-meet',url:round.meetingUrl!})})}>{t('进入会议','会議を開く')}</button>:null}</>:null}</div>
        </form></>}
      </>:null}
      {draft.panel==='feedback'?<>
        <h4>{t('粘贴反馈，让 AI 帮你整理','フィードバックを貼り付け、AIで整理')}</h4>
        <label>{t('面试反馈或消息','面談フィードバック・メッセージ')}<textarea disabled={busy||Boolean(inactive)} rows={5} maxLength={8000} value={draft.feedback} onChange={(event)=>update({feedback:event.target.value,analysis:null})}/></label>
        <div className="hr-progress-actions"><button disabled={busy||stale||!draft.feedback.trim()||Boolean(inactive)} onClick={analyze}>{busy?t('正在整理','整理中'):t('AI 整理反馈','AIでフィードバックを整理')}</button><button disabled={busy||!current.progress?.rounds.length} onClick={()=>prepareMessage('feedback')}>{t('准备询问结果','結果確認の連絡を準備')}</button></div>
        {!inactive?<form onSubmit={(event)=>{event.preventDefault();void save({action:'feedback',roundNumber:draft.schedule.roundNumber,notes:draft.feedback,result:draft.result,next:draft.result==='passed'?draft.next:'unknown',unresolved:split(draft.unresolved).map((line)=>line.slice(0,300)).slice(0,20)})}}>
          <div className="hr-progress-form-grid"><label>{t('记录第几轮结果','記録する面談回次')}<input disabled={busy} type="number" min={1} max={20} value={draft.schedule.roundNumber} onChange={(event)=>update({schedule:{...draft.schedule,roundNumber:Number(event.target.value)}})}/></label>
          <label>{t('本轮结果','今回の結果')}<select disabled={busy} value={draft.result} onChange={(event)=>update({result:event.target.value as Draft['result'],next:'unknown'})}>{[['pending',t('等待明确反馈','明確な結果待ち')],['passed',t('本轮通过','今回通過')],['failed',t('未通过','不通過')],['no-show',t('未出席','欠席')],['withdrawn',t('人员撤回','辞退')]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          {draft.result==='passed'?<label className="full">{t('通过后下一步','通過後の対応')}<select disabled={busy} value={draft.next} onChange={(event)=>update({next:event.target.value as Draft['next']})}><option value="unknown">{t('等待客户确认后续','次の対応を案件側に確認')}</option><option value="next-round">{t('安排下一轮面试','次の面談を予約')}</option><option value="entry">{t('全部面试结束，准备进场','全面談完了・参画準備へ')}</option></select></label>:null}
          <label className="full">{t('下一轮或后续需要确认','次回以降の確認事項')}<textarea disabled={busy} rows={3} maxLength={6000} value={draft.unresolved} onChange={(event)=>update({unresolved:event.target.value})}/></label></div>
          <button className="hr-primary" disabled={busy||stale||!draft.feedback.trim()} type="submit">{draft.result==='passed'&&draft.next==='next-round'?t('保存结果，安排下一轮','結果を保存し次回へ'):draft.result==='passed'&&draft.next==='entry'?t('保存结果，准备进场','結果を保存し参画準備へ'):t('保存面试结果','面談結果を保存')}</button>
        </form>:null}
      </>:null}
      {draft.panel==='entry'?<>
        {state.stage==='started'?<><h4>{t('已确认实际到岗','参画開始を確認済み')}</h4><p>{timestamp(current.progress?.entry.actualDate??null)}</p></>:state.stage!=='entry'?<p>{t('记录客户全部面试通过后，在这里安排进场。','全ての面談通過を記録した後、ここで参画を手配します。')}</p>:<>
        <form onSubmit={(event)=>{event.preventDefault();void save({action:'entry',entry:draft.entry})}}><h4>{t('确认入场条件与报到安排','参画条件と初日の案内')}</h4>
          <div className="hr-progress-form-grid">{(['plannedDate','rate','workStyle','location','reportTime','contact','materials'] as const).map((field,index)=><label className={['contact','materials'].includes(field)?'full':''} key={field}>{[t('计划入场日期','参画予定日'),t('最终单价','合意単価'),t('工作方式','勤務形態'),t('工作地点','勤務地'),t('报到时间','集合時間'),t('报到联系人','初日の連絡先'),t('携带材料及注意事项','持参物・注意事項')][index]}<input disabled={busy} type={field==='plannedDate'?'date':'text'} maxLength={1000} value={draft.entry[field]} onChange={(event)=>update({entry:{...draft.entry,[field]:event.target.value}})}/></label>)}</div>
          <div className="hr-progress-checks"><label><input disabled={busy} type="checkbox" checked={draft.entry.candidateAccepted} onChange={(event)=>update({entry:{...draft.entry,candidateAccepted:event.target.checked}})}/>{t('人员已接受该案件','要員が案件を承諾済み')}</label><label><input disabled={busy} type="checkbox" checked={draft.entry.termsAgreed} onChange={(event)=>update({entry:{...draft.entry,termsAgreed:event.target.checked}})}/>{t('双方已确认入场条件','双方で参画条件を合意済み')}</label></div>
          <div className="hr-progress-actions"><button className="hr-primary" type="submit" disabled={busy||stale}>{t('保存入场安排','参画予定を保存')}</button><button type="button" disabled={busy||stale} onClick={()=>prepareMessage('entry','person')}>{t('准备入场通知','参画案内を準備')}</button></div>
        </form>
        <section className="hr-progress-arrival"><h4>{t('实际到岗后，完成本次推进','実際の参画開始後に完了する')}</h4><label>{t('实际到岗日期','実際の参画開始日')}<input disabled={busy} type="date" max={localDate()} value={draft.actualDate} onChange={(event)=>update({actualDate:event.target.value})}/></label><button disabled={busy||stale||!current.progress?.entry.candidateAccepted||!current.progress.entry.termsAgreed||!draft.actualDate} onClick={()=>void save({action:'start',actualDate:draft.actualDate})}>{t('确认已到岗','参画開始を確認')}</button><small>{t('确认后人员会显示已入场，其他案件可分别决定是否继续。','確認後は要員を参画中に更新します。別案件の継続は個別に判断できます。')}</small></section>
        </>}
        {state.stage==='started'?<section><h4>{t('此人员正在推进的其他案件','この要員の他の進行案件')}</h4>{items.filter((row)=>row.documentId===current.documentId&&row.id!==current.id&&!['closed','started','paused'].includes(row.progress?.stage??'coordinating')).map((row)=><div className="hr-progress-other" key={row.id}><span>{caseName(row.reviewId)}</span><button disabled={busy} onClick={()=>void save({action:'pause',reason:t('人员已在其他案件进场','別案件で参画開始')},row)}>{t('暂停此案件','この案件を保留')}</button><button disabled={busy} onClick={()=>{setSelected(pairKey(row));setMessage(null)}}>{t('继续查看','確認を続ける')}</button></div>)}</section>:null}
      </>:null}
      {draft.panel==='history'?<>
        <h4>{t('各轮面试','各回の面談')}</h4>{current.progress?.rounds.map((round)=><details className="hr-progress-round" key={round.id} open><summary>{t('第','第')} {round.roundNumber} {t('轮面试','回面談')} · {timestamp(round.scheduledAt)} · {round.decision==='next-round'?t('进入下一轮','次回へ'):round.decision==='passed'?t('本轮通过','今回通過'):round.decision==='failed'?t('未通过','不通過'):round.decision==='withdrawn'?t('撤回','辞退'):round.decision==='no-show'?t('未出席','欠席'):t('待结果','結果待ち')}</summary><p>{round.interviewNotes||round.contactNote}</p>{round.unresolvedItems.length?<ul>{round.unresolvedItems.map((line)=><li key={line}>{line}</li>)}</ul>:null}</details>)}
        {!current.progress?.rounds.length&&interviews.some((row)=>row.sourceDocumentId===current.documentId&&row.kind==='client'&&!row.businessFollowUpId)?<section><h4>{t('关联此前的客户面试','過去の顧客面談を関連付け')}</h4>{interviews.filter((row)=>row.sourceDocumentId===current.documentId&&row.kind==='client'&&!row.businessFollowUpId).map((row)=><button disabled={busy||stale} key={row.id} onClick={()=>void save({action:'link-interview',interviewId:row.id})}>{timestamp(row.scheduledAt)} · {row.roundNumber} · {t('关联到此案件','この案件に関連付け')}</button>)}</section>:null}
        <h4>{t('完整时间线','全ての履歴')}</h4><ol className="hr-progress-timeline">{[...current.events].reverse().map((event,index)=><li key={`${event.recordedAt}:${index}`}><time>{timestamp(event.recordedAt)}</time><p>{event.note}</p>{event.nextStep?<small>{event.nextStep}</small>:null}</li>)}</ol>
        <label>{t('补充沟通记录','連絡メモを追加')}<textarea disabled={busy} rows={3} maxLength={2000} value={draft.note} onChange={(event)=>update({note:event.target.value})}/></label><button disabled={busy||stale||!draft.note.trim()||!current.id} onClick={()=>void save({action:'note',note:draft.note})}>{t('保存沟通记录','連絡メモを保存')}</button>
        {!['closed','started','paused'].includes(state.stage)?<div className="hr-progress-actions"><button disabled={busy||stale||!draft.note.trim()} onClick={()=>void save({action:'pause',reason:draft.note})}>{t('按此原因暂停','この理由で保留')}</button><button disabled={busy||stale||!draft.note.trim()} onClick={()=>void save({action:'close',reason:draft.note})}>{t('按此原因结束','この理由で終了')}</button></div>:null}
        {['paused','closed'].includes(state.stage)?<button disabled={busy||stale} onClick={()=>void save({action:'resume'})}>{t('恢复推进','対応を再開')}</button>:null}
      </>:null}
      {message&&message.draftKey===key?<section className="hr-progress-message" aria-label={t('准备联系消息','連絡文を準備')}><h4>{t('准备联系消息','連絡文を準備')}</h4><div className="hr-progress-actions">{(['person','client'] as const).map((recipient)=><button key={recipient} disabled={busy} aria-pressed={message.recipient===recipient} onClick={()=>prepareMessage(message.purpose,recipient,message.lang)}>{recipient==='person'?t('发给人员','要員宛'):t('发给案件方','案件側宛')}</button>)}{(['zh','ja'] as const).map((lang)=><button key={lang} disabled={busy} aria-pressed={message.lang===lang} onClick={()=>prepareMessage(message.purpose,message.recipient,lang)}>{lang==='zh'?t('中文','中国語'):t('日文','日本語')}</button>)}</div>
        <small>{t('收件人','宛先')}：{message.to||t('打开邮件后选择','メールで選択')}</small><textarea aria-label={t('联系文案','連絡文')} disabled={busy} rows={8} value={message.text} onChange={(event)=>setMessage({...message,text:event.target.value})}/><div className="hr-progress-actions"><button disabled={busy} onClick={()=>void run(async()=>{await copyTextToClipboard(message.text);setNotice(t('已复制','コピーしました'))})}>{t('复制消息','連絡文をコピー')}</button><button disabled={busy||stale} onClick={()=>void run(async()=>{await window.sesAgent.openBusinessProgressEmail({documentId:current.documentId,reviewId:current.reviewId,expectedRevision:current.revision,purpose:message.purpose,recipient:message.recipient,lang:message.lang,text:message.text});setNotice(t('已打开邮件，请确认后发送。','メールを開きました。確認して送信してください。'))})}>{t('打开邮件','メールを開く')}</button><small>{t('打开邮件不会记为已发送。','メールを開く操作は送信済みになりません。')}</small></div>
      </section>:null}
      </div>
    </article>:<div className="hr-followup-detail-placeholder"><h3>{t('选择一条推进，开始下一步','進行中の案件を選び、次の対応へ')}</h3><p>{t('面试安排、各轮反馈和入场信息都保存在对应的人员与案件下。','面談予定・各回の結果・参画情報を、要員と案件ごとに保持します。')}</p></div>}
    </div>
  </section>
}
