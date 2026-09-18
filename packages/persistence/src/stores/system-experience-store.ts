import { hasMeaningfulTextChange } from '@shared'
import { createHash, randomUUID } from 'node:crypto'
import { buildExperienceTrends,experienceOutcomes,independentOutcomes,baseExperienceSkills, experienceScopeMatches, experienceText, experienceEditRatio, experienceControlSchema, experienceExposureSchema, experienceInstructions, experienceMatches,
  type ExperienceContext, type ExperienceMetrics, type ExperienceMeasure, type CandidateInterviewQuestion, type ExperienceBundle, type ExperienceControl, type ExperienceEvent, type ExperienceInput, type ExperienceRun,
  type ExperienceSample, type ExperienceSettings, type SystemExperience, type SystemExperienceSnapshot } from '@shared'
import { DomainStore } from './base'

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const today = () => new Date().toISOString().slice(0, 10)
export class SystemExperienceStore extends DomainStore {
  settings(): ExperienceSettings {
    const row = this.database.prepare<[], {payload:string}>('SELECT payload FROM experience_settings WHERE singleton=1').get()
    const settings: ExperienceSettings = row ? JSON.parse(row.payload) : {enabled:true,dailyCallLimit:16,callsToday:0,budgetDate:today(),lastAttempt:null,lastCompleted:null,lastError:null,revision:0}
    return settings.budgetDate === today() ? settings : {...settings,callsToday:0,budgetDate:today()}
  }
  private writeSettings(value: ExperienceSettings) {
    this.database.prepare('INSERT INTO experience_settings(singleton,payload) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET payload=excluded.payload').run(JSON.stringify(value))
  }
  reserveCall(): boolean {
    return this.database.transaction(() => {
      const settings = this.settings()
      if (!settings.enabled || settings.callsToday >= settings.dailyCallLimit) return false
      this.writeSettings({...settings,callsToday:settings.callsToday+1,lastAttempt:new Date().toISOString()})
      return true
    })()
  }
  complete(error: string | null) {
    const settings = this.settings()
    this.writeSettings({...settings,lastError:error,lastCompleted:error ? settings.lastCompleted : new Date().toISOString()})
  }
  history(id: string): SystemExperience[] {
    return this.database.prepare<[string],{payload:string}>('SELECT payload FROM experience_versions WHERE id=? ORDER BY version DESC').all(id).map(r=>JSON.parse(r.payload))
  }
  private all(): SystemExperience[] {
    return this.database.prepare<[],{payload:string}>(`SELECT e.payload FROM experience_versions e WHERE version=(SELECT max(v.version) FROM experience_versions v WHERE v.id=e.id) ORDER BY created_at DESC,id`).all().map(r=>JSON.parse(r.payload))
  }
  private validSources(skill: SystemExperience) {
    return skill.support.length > 0 && skill.support.every(id => this.database.prepare('SELECT id FROM experience_events WHERE id=? AND superseded=0').get(id))
  }
  list(): SystemExperience[] {
    // Source corrections/deletions immediately stop dependent skills, even before the worker runs.
    return this.all().map(skill=> {
      const uses=this.database.prepare<[string],{n:number}>(`SELECT count(*) n FROM experience_runs r WHERE EXISTS (SELECT 1 FROM json_each(r.payload,'$.bundle.refs') ref WHERE json_extract(ref.value,'$.id')=?)`).get(skill.id)!.n
      const serving=this.serving(skill)
      const value={...skill,uses,...(serving?{servingVersion:serving.version}:{})}
      return this.validSources(skill) || !skill.enabled ? value : {...value,enabled:false,state:'withdrawn' as const,reason:'来源记录已更新或删除 / 根拠が更新または削除されました'}
    })
  }
  private serving(head:SystemExperience):SystemExperience|undefined {
    if(head.locked || ['paused','withdrawn'].includes(head.state))return undefined
    if(head.enabled && ['trial','active'].includes(head.state) && this.validSources(head))return head
    if(head.fallbackVersion && ['validating','rejected'].includes(head.state)) {
      const fallback=this.history(head.id).find(s=>s.version===head.fallbackVersion)
      if(fallback?.enabled && ['trial','active'].includes(fallback.state) && this.validSources(fallback))return fallback
    }
    return undefined
  }
  active():SystemExperience[] { return this.all().flatMap(head=>{const serving=this.serving(head);return serving?[serving]:[]}) }
  snapshot(): SystemExperienceSnapshot {
    return {settings:this.settings(),experiences:this.list(),bases:baseExperienceSkills,metrics:this.metrics(),trends:this.trends(),
      eventCount:this.database.prepare<[],{n:number}>('SELECT count(*) n FROM experience_events WHERE superseded=0').get()!.n,
      pendingCount:this.database.prepare<[],{n:number}>('SELECT count(*) n FROM experience_events WHERE analyzed=0 AND superseded=0').get()!.n}
  }
  bundle(task: ExperienceInput['task'], requirements: ExperienceInput['requirements'], context?:ExperienceContext): ExperienceBundle {
    const selected = this.active().filter(s=>s.task===task && s.method!=='ranking' && experienceScopeMatches(s.scope,context) && experienceMatches(s.keyword,requirements))
      .sort((a,b)=>b.keyword.length-a.keyword.length || a.id.localeCompare(b.id)).slice(0,4)
    return {task,instructions:[baseExperienceSkills[task],...selected.map(experienceInstructions)],refs:selected.map(s=>({id:s.id,version:s.version}))}
  }
  put(skill: Omit<SystemExperience,'id'|'version'|'createdAt'|'uses'> & {id?:string}, expectedVersion: number): SystemExperience {
    return this.database.transaction(()=>{
      const current=skill.id ? this.history(skill.id)[0] : undefined
      if ((current?.version??0)!==expectedVersion) throw new Error('系统经验已更新，请刷新。 / 経験が更新されました。')
      const next:SystemExperience={...skill,id:current?.id??randomUUID(),version:expectedVersion+1,createdAt:new Date().toISOString(),uses:current?.uses??0}
      this.database.prepare('INSERT INTO experience_versions(id,version,task,method,keyword,payload,created_at) VALUES(?,?,?,?,?,?,?)').run(next.id,next.version,next.task,next.method,next.keyword,JSON.stringify(next),next.createdAt)
      return next
    })()
  }
  control(raw: ExperienceControl) {
    const input=experienceControlSchema.parse(raw)
    return this.database.transaction(()=>{
      if(input.action==='learning'||input.action==='budget') {
        const settings=this.settings()
        if(settings.revision!==input.expectedRevision)throw new Error('设置已更新，请刷新。 / 設定が更新されました。')
        this.writeSettings({...settings,revision:settings.revision+1,...(input.action==='learning'?{enabled:input.enabled}:{dailyCallLimit:input.dailyCallLimit})})
      } else {
        const current=this.history(input.id)[0]
        if(!current||current.version!==input.expectedVersion)throw new Error('系统经验已更新，请刷新。 / 経験が更新されました。')
        const selected=input.action==='restore'?this.history(input.id).find(s=>s.version===input.version):input.enabled?current:(this.serving(current)??current)
        if(!selected||!((input.action==='enable'&&!input.enabled)||(['trial','active','paused'].includes(selected.state)&&this.validSources(selected)&&selected.evaluations.length===2&&selected.evaluations.every(e=>e.grounded&&!e.regression&&e.candidate>e.baseline))))throw new Error('这个版本的依据不可用，不能启用。 / この版の根拠を利用できません。')
        const enabled=input.action==='restore'||input.enabled
        this.put({...selected,id:current.id,enabled,locked:!enabled,state:enabled?'trial':'paused',previousVersion:current.version,reason:enabled?'HR 恢复使用 / HRが利用を再開':'HR 已停用 / HRが無効化'},current.version)
      }
      return this.snapshot()
    })()
  }
  saveRun(input: Omit<ExperienceRun,'id'|'createdAt'|'exposure'|'opened'|'rank'>): string {
    const id=randomUUID(),createdAt=new Date().toISOString()
    this.database.prepare('INSERT INTO experience_runs(id,document_id,review_id,interview_id,task,payload,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id,input.documentId,input.reviewId,input.interviewId,input.input.task,JSON.stringify({...input,id,createdAt}),createdAt)
    return id
  }
  run(id:string): ExperienceRun | null {
    const row=this.database.prepare<[string],{payload:string;exposed:number;opened:number;rank:number|null}>('SELECT payload,exposed,opened,rank FROM experience_runs WHERE id=?').get(id)
    return row?{...JSON.parse(row.payload),exposure:Boolean(row.exposed),opened:Boolean(row.opened),rank:row.rank}:null
  }
  exposure(raw:unknown) {
    const input=experienceExposureSchema.parse(raw)
    const run=this.run(input.runId)
    if(!run)return
    if(input.action==='shown'&&!run.exposure)this.database.prepare('UPDATE experience_runs SET exposed=1,rank=? WHERE id=?').run(input.rank??null,input.runId)
    if(input.action==='opened'&&!run.opened)this.database.prepare('UPDATE experience_runs SET opened=1 WHERE id=?').run(input.runId)
  }
  record(input: Omit<ExperienceEvent,'id'|'createdAt'|'runIds'|'superseded'>) {
    return this.database.transaction(()=>{
      const hash=digest({text:input.text,data:input.data})
      const old=this.database.prepare<[string],{id:string;content_hash:string}>('SELECT id,content_hash FROM experience_events WHERE source_key=? AND superseded=0').get(input.sourceKey)
      if(old?.content_hash===hash)return old.id
      this.database.prepare('UPDATE experience_events SET superseded=1 WHERE source_key=?').run(input.sourceKey)
      const runs=this.database.prepare<[string|null,string|null,string|null],{id:string;payload:string}>(`SELECT id,payload FROM experience_runs WHERE document_id IS ? AND review_id IS ? AND (interview_id IS NULL OR interview_id IS ?) ORDER BY created_at DESC LIMIT 20`).all(input.documentId,input.reviewId,input.interviewId)
      const byTask=new Map<string,string>()
      for(const run of runs){const value=JSON.parse(run.payload) as ExperienceRun;if(!byTask.has(value.input.task) && (value.input.task !== 'matching' || this.run(run.id)?.exposure))byTask.set(value.input.task,run.id)}
      if (input.kind==='assessment-feedback'||input.kind==='edit') {
        byTask.clear()
        const ref=typeof input.data.runId==='string'?this.run(input.data.runId):null
        if(ref&&ref.documentId===input.documentId&&ref.reviewId===input.reviewId)byTask.set(ref.input.task,ref.id)
      } else if(input.kind!=='progress') {
        const adoption=this.database.prepare<[string|null,string|null],{payload:string}>(`SELECT payload FROM experience_events WHERE document_id IS ? AND review_id IS ? AND superseded=0 ORDER BY created_at`).all(input.documentId,input.reviewId)
          .map(r=>JSON.parse(r.payload) as ExperienceEvent).find(e=>e.kind==='progress'&&['coordinate','schedule'].includes(String(e.data.action)))
        if(adoption){byTask.delete('matching');for(const id of adoption.runIds){const run=this.run(id);if(run?.input.task==='matching')byTask.set('matching',id)}}
        if(input.interviewId){
          const interview=this.database.prepare<[string],{question_plan_json:string}>('SELECT question_plan_json FROM candidate_interview_sessions WHERE id=?').get(input.interviewId)
          const questions=interview?JSON.parse(interview.question_plan_json) as Array<{experienceRunId?:string;selected:boolean}>:[]
          const selected=questions.filter(q=>q.selected&&q.experienceRunId).map(q=>this.run(q.experienceRunId!)).filter((r):r is ExperienceRun=>!!r&&r.documentId===input.documentId&&r.reviewId===input.reviewId&&(!r.interviewId||r.interviewId===input.interviewId))
          byTask.delete('interview');if(selected[0])byTask.set('interview',selected[0].id)
        }
      }
      const value:ExperienceEvent={...input,id:randomUUID(),createdAt:new Date().toISOString(),runIds:[...byTask.values()],superseded:false}
      this.database.prepare('INSERT INTO experience_events(id,source_key,document_id,review_id,interview_id,payload,created_at,content_hash,analyzed) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(value.id,input.sourceKey,input.documentId,input.reviewId,input.interviewId,JSON.stringify(value),value.createdAt,hash,Number(input.kind==='progress'||input.kind==='questions'||input.kind==='edit'&&!input.data.semanticEdit||!input.text.trim()))
      return value.id
    })()
  }
  events(ids?:string[]): ExperienceEvent[] {
    const read = this.database.prepare<[string],{payload:string;superseded:number}>('SELECT payload,superseded FROM experience_events WHERE id=?')
    const rows=ids ? [...new Set(ids)].flatMap(id => { const row=read.get(id); return row ? [row] : [] }) : this.database.prepare<[],{payload:string;superseded:number}>('SELECT payload,superseded FROM experience_events ORDER BY created_at DESC').all()
    return rows.map(r=>({...JSON.parse(r.payload),superseded:Boolean(r.superseded)} as ExperienceEvent))
  }
  pending(): ExperienceEvent[] {
    return this.database.prepare<[],{payload:string}>(`SELECT payload FROM experience_events WHERE analyzed=0 AND superseded=0 ORDER BY created_at LIMIT 12`).all().map(r=>JSON.parse(r.payload))
  }
  analyzed(ids:string[],samples:ExperienceSample[]) {
    this.database.transaction(()=>{
      for(const sample of samples) {
        if(!ids.includes(sample.eventId)||!this.run(sample.runId)||!this.events([sample.eventId]).some(e=>!e.superseded&&e.runIds.includes(sample.runId)))continue
        this.database.prepare('INSERT OR REPLACE INTO experience_observations(event_id,run_id,task,method,keyword,payload) VALUES(?,?,?,?,?,?)')
          .run(sample.eventId,sample.runId,sample.task,sample.method,sample.keyword,JSON.stringify(sample))
      }
      for(const id of ids)this.database.prepare('UPDATE experience_events SET analyzed=1 WHERE id=?').run(id)
    })()
  }
  samples(): ExperienceSample[] {
    return this.database.prepare<[],{payload:string}>(`SELECT o.payload FROM experience_observations o JOIN experience_events e ON e.id=o.event_id WHERE e.superseded=0 ORDER BY e.created_at,e.id`).all().map(r=>JSON.parse(r.payload))
  }
  assertAdoption(runId:string, target?:{documentId:string|null;reviewId:string|null;interviewId?:string|null}) {
    const run=this.run(runId)
    if(!run || !['interview','introduction'].includes(run.input.task))throw new Error('生成记录已失效 / 生成記録が無効です')
    if(target && (run.documentId!==target.documentId || run.reviewId!==target.reviewId || target.interviewId && run.interviewId && run.interviewId!==target.interviewId))throw new Error('生成记录与当前对象不符 / 対象が一致しません')
    const operator=this.stores.localSettings.getLocalOperatorProfile()?.operatorId ?? '00000000-0000-4000-8000-000000000001'
    if(run.input.context && run.input.context.operatorId!==operator)throw new Error('生成记录属于其他用户 / 他の利用者の生成記録です')
    if(run.input.task==='introduction') {
      const person=run.documentId?this.stores.candidates.getCandidateReview(run.documentId):null
      const job=run.reviewId?this.stores.jobCases.getJobCaseReview(run.reviewId):null
      if(run.documentId&&(!person||person.recordStatus!=='active'||person.profile?.version!==run.profileVersion)||run.reviewId&&(!job||job.lifecycle!=='active'||job.jobCase?.version!==run.jobCaseVersion))throw new Error('资料已更新，请重新打开介绍 / 情報が更新されました。紹介を開き直してください')
    }
    return run
  }
  adopt(runId:string, after:unknown, actorId:string, target?:{documentId:string|null;reviewId:string|null;interviewId?:string|null}) {
    const run=this.assertAdoption(runId,target)
    const original=run.input.task==='interview' ? (run.output as CandidateInterviewQuestion[]).filter(q=>q.selected).map(q=>q.text) : [experienceText(run.output)]
    const next=run.input.task==='interview' ? (after as CandidateInterviewQuestion[]).filter(q=>q.selected).map(q=>q.text) : [String(after)]
    const beforeText=original.join('\n'),afterText=next.join('\n')
    const ratio=experienceEditRatio(beforeText,afterText)
    const duplicateCount=next.length-new Set(next.map(t=>t.normalize('NFKC').replace(/\s+/gu,'').toLowerCase())).size
    const edited=ratio>0
    return this.record({sourceKey:`adoption:${run.id}`,documentId:run.documentId,reviewId:run.reviewId,interviewId:run.interviewId,kind:'edit',actor:actorId,
      text:edited?afterText:'',data:{runId:run.id,before:beforeText,after:afterText,edited,editRatio:ratio,questionCount:run.input.task==='interview'?next.length:0,duplicateCount,adopted:true,
        // Selection/removal alone measures usage, but is not a semantic correction.
        semanticEdit:run.input.task==='introduction'?hasMeaningfulTextChange(beforeText,afterText):(after as CandidateInterviewQuestion[]).some(q=>q.selected&&(run.output as CandidateInterviewQuestion[]).some(old=>old.id===q.id&&hasMeaningfulTextChange(old.text,q.text)))}})
  }
  questionEdits(documentId:string,reviewId:string|null,interviewId:string,questions:CandidateInterviewQuestion[],actor:string) {
    this.stores.questionBank.capture(interviewId,questions)
    for(const runId of new Set(questions.flatMap(q=>q.experienceRunId?[q.experienceRunId]:[]))) {
      const run=this.run(runId)
      if(!run || run.input.task!=='interview')continue
      this.adopt(runId,questions.filter(q=>q.experienceRunId===runId),actor,{documentId,reviewId,interviewId})
    }
  }
  metrics():ExperienceMetrics[] {
    const empty=():ExperienceMeasure=>({adopted:0,edited:0,editRatio:null,duplicateQuestionRate:null,resolved:0,feedback:0})
    const metrics=(['matching','interview','introduction'] as const).map(task=>({task,baseline:empty(),assisted:empty(),enoughData:false}))
    const operator=this.stores.localSettings.getLocalOperatorProfile()?.operatorId ?? '00000000-0000-4000-8000-000000000001'
    const rows=this.events().filter(e=>!e.superseded)
    const sums=new Map<ExperienceMeasure,{edit:number;duplicates:number;questions:number}>()
    for(const event of rows)for(const id of event.runIds) {
      const run=this.run(id);if(!run || run.input.context && run.input.context.operatorId!==operator)continue
      const metric=metrics.find(m=>m.task===run.input.task)!,measure=run.bundle.refs.length?metric.assisted:metric.baseline
      if(event.kind==='edit'&&event.data.adopted===true){measure.adopted++;if(event.data.edited)measure.edited++
        const sum=sums.get(measure)??{edit:0,duplicates:0,questions:0};sum.edit+=Number(event.data.editRatio)||0;sum.duplicates+=Number(event.data.duplicateCount)||0;sum.questions+=Number(event.data.questionCount)||0;sums.set(measure,sum)}
      if(['feedback','assessment-feedback'].includes(event.kind)&&event.text.trim()){measure.feedback++;if(Array.isArray(event.data.unresolved)&&event.data.unresolved.length===0)measure.resolved++}
    }
    for(const metric of metrics){for(const m of [metric.baseline,metric.assisted]){const sum=sums.get(m);m.editRatio=m.adopted&&sum?sum.edit/m.adopted:null;m.duplicateQuestionRate=sum?.questions?sum.duplicates/sum.questions:null}metric.enoughData=metric.task==='matching'?metric.baseline.feedback>=5&&metric.assisted.feedback>=5:metric.baseline.adopted>=5&&metric.assisted.adopted>=5}
    return metrics
  }
  private outcomes(){
    const events=this.events(),runs=new Map<string,ExperienceRun>()
    for(const id of new Set(events.flatMap(e=>e.runIds))){const run=this.run(id);if(run)runs.set(id,run)}
    return experienceOutcomes(events,runs,this.samples())
  }
  trends(now=new Date()){
    return buildExperienceTrends(this.outcomes(),this.stores.localSettings.getLocalOperatorProfile()?.operatorId??'00000000-0000-4000-8000-000000000001',now)
  }
  monitorTrends(){
    const outcomes=this.outcomes()
    for(const skill of this.active()){
      const head=this.history(skill.id)[0]!
      const values=independentOutcomes(outcomes.filter(o=>o.run.bundle.refs.some(ref=>ref.id===skill.id&&ref.version===skill.version)).sort((a,b)=>b.at.localeCompare(a.at))).slice(0,10)
      if(values.length===10&&values.slice(0,5).filter(v=>v.bad).length>=4&&values.slice(5).filter(v=>v.bad).length<=1){
        this.put({...skill,enabled:false,locked:true,state:'withdrawn',seenEvents:head.seenEvents,previousVersion:head.version,reason:'最近独立使用的修改或明确负面反馈持续增加，已停止采用 / 最近の独立した利用で修正または明示的な否定評価が増えたため利用を停止'},head.version)
      }
    }
  }
  details(id:string) {
    const history=this.history(id)
    return {history,evidence:this.events([...new Set(history.flatMap(s=>s.support))]).filter(e=>!e.superseded).map(e=>({id:e.id,text:e.text,kind:e.kind,createdAt:e.createdAt,documentId:e.documentId,reviewId:e.reviewId}))}
  }
}
