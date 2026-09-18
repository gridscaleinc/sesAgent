import { validateQuestionTemplate } from './question-bank'
import { validateExperienceProcedure } from './experience-procedure'
import { createHash, randomUUID } from 'node:crypto'
import { defaultAgentChatModelKey, resolveAgentChatModel } from '@agent'
import { rankWithExperiences, rankingEvidence, experienceFamily, experienceScopeFor, experienceInstructions, experienceMatches, experienceMethods,
  type ExperienceEvent, type ExperienceRun, type ExperienceSample, type SystemExperience, type ExperienceEvaluation } from '@shared'
import type { MainIpcContext } from './ipc/context'
import { isLearningForegroundBusy } from './learning-activity'

export const experienceLearningPolicy = { trainingCases:3, validationCases:2, trialSupports:3, rollbackCases:3, batchSize:12 } as const
const key = experienceFamily
const sourceText = (value:unknown):string => typeof value==='string'?value:Array.isArray(value)?value.map(sourceText).join('\n'):value&&typeof value==='object'?Object.values(value).map(sourceText).join('\n'):''
export function validExperienceObservation(sample: Omit<ExperienceSample,'runId'>, event:ExperienceEvent, run:ExperienceRun) {
  if(event.superseded || !event.text.includes(sample.quote) || !event.runIds.includes(run.id) || run.input.task!==sample.task)return false
  if(!(experienceMethods[sample.method].tasks as readonly string[]).includes(sample.task))return false
  if(!experienceMatches(sample.keyword,run.input.requirements) || /<[^>]+>|年龄|年齢|性别|性別|国籍|nationality|gender|sex\b|age\b|@/iu.test(sample.keyword))return false
  if(['availability','rate','interest','case-closed','work-style'].includes(String(event.data.reason)))return false
  if(['no-show','withdrawn'].includes(String(event.data.result)))return false
  if(sample.method==='custom' && (!sample.intent || sample.task==='introduction' && !sample.intent.startsWith('presentation-')))return false
  if(sample.method==='ranking')return sample.intent==='ranking-preference'&&!!sample.rankingFeature&&!!run.input.ranking&&run.input.ranking.pool.length>1&&(sample.polarity==='counterexample'||event.data.decision!=='unsuitable')&&['feedback','notes','assessment-feedback'].includes(event.kind)&&event.text.trim().length>=10
  if(event.kind==='edit')return event.data.adopted===true && event.data.semanticEdit===true && event.text.trim().length>=10
  // A bare outcome or selected checkbox cannot become a professional teaching signal.
  return event.text.trim().length>=10 && ['feedback','notes','assessment-feedback'].includes(event.kind)
}
export function experienceEvaluationPasses(rows:ExperienceEvaluation[]) {
  return rows.length===experienceLearningPolicy.validationCases && rows.every(r=>r.grounded&&!r.regression&&r.candidate>=r.baseline) && rows.every(r=>r.candidate>r.baseline)
}
export function independentExperienceSamples(samples:ExperienceSample[], events:ExperienceEvent[]) {
  const selected:ExperienceSample[]=[], reviews=new Set<string>(),people=new Set<string>()
  const byId=new Map(events.map(e=>[e.id,e]))
  for(const sample of samples){const event=byId.get(sample.eventId);if(!event||event.superseded)continue
    const review=event.reviewId??(sample.task==='introduction'?event.documentId:null), person=event.documentId??(sample.task==='introduction'?event.reviewId:null)
    if(!review||!person||reviews.has(review)||people.has(person))continue
    selected.push(sample);reviews.add(review);people.add(person)}
  return selected
}

export function createExperienceLearner(context:Pick<MainIpcContext,'repository'|'agentNarrativeStreamer'|'agentChatModelCatalog'>) {
  const {repository,agentNarrativeStreamer:cloud}=context
  const settings=()=>repository.getExperienceSettings?.()??repository.getSystemExperience().settings
  const skills=()=>repository.getExperienceSkills?.()??repository.getSystemExperience().experiences
  let running=false,closed=false
  const activeControllers=new Set<AbortController>()
  const model=()=>resolveAgentChatModel(context.agentChatModelCatalog,defaultAgentChatModelKey)
  const tick=async (outerSignal?:AbortSignal) => {
    if(running||closed||!settings().enabled)return
    running=true
    const controller=new AbortController();activeControllers.add(controller)
    const abort=()=>controller.abort();outerSignal?.addEventListener('abort',abort,{once:true});if(outerSignal?.aborted)abort()
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(180_000)])
    const startedSettings=settings()
    const check=()=>{signal.throwIfAborted();if(closed||!settings().enabled||settings().revision!==startedSettings.revision)throw new Error('LEARNING_INTERRUPTED')}
    const call=async<T>(operation:()=>Promise<T>):Promise<T>=>{check();if(!repository.reserveExperienceCall())throw new Error('LEARNING_BUDGET');const value=await operation();check();return value}
    let didWork=false
    try {
      // Local safeguards do not depend on remaining model budget or connectivity.
      check();repository.monitorExperienceTrends?.();repository.monitorQuestionBank?.()
      if(!cloud||startedSettings.callsToday>=startedSettings.dailyCallLimit)return
      if(cloud.analyzeInterviewAnswers&&repository.getPendingInterviewAnswers)for(const source of repository.getPendingInterviewAnswers()){
        const answers=await call(()=>cloud.analyzeInterviewAnswers({source,model:model(),signal}))
        check();repository.saveInterviewAnswers(source,answers);didWork=true
      }

      const pending=repository.getPendingExperienceEvents().slice(0,experienceLearningPolicy.batchSize)
      if(pending.length){
        didWork=true
        const eligible=pending.filter(e=>e.text.trim().length>=10 && ['feedback','notes','assessment-feedback','edit'].includes(e.kind) && (e.kind!=='edit'||e.data.semanticEdit===true) && !['availability','rate','interest','case-closed','work-style'].includes(String(e.data.reason)) && !['no-show','withdrawn'].includes(String(e.data.result))).map(e=>({id:e.id,text:e.text.slice(0,8000),kind:e.kind,data:{result:e.data.result,reason:e.data.reason,...(e.kind==='edit'?{before:e.data.before,after:e.data.after}:{})},
          runs:e.runIds.flatMap(id=>{const run=repository.getExperienceRun(id);return run?[{id:run.id,input:{...run.input,ranking:undefined,facts:[],projects:[],previousQuestions:[],notes:''},output:sourceText(run.output).slice(0,2000)}]:[]})})).filter(e=>e.runs.length)
        const extracted=eligible.length?await call(()=>cloud.extractExperience({events:eligible,model:model(),signal})):{observations:[]}
        const samples:ExperienceSample[]=[]
        for(const observation of extracted.observations){
          const event=repository.getExperienceEvents([observation.eventId])[0]
          if(!event||!pending.some(e=>e.id===event.id))continue
          const run=event.runIds.map(id=>repository.getExperienceRun(id)).find(r=>r?.input.task===observation.task)
          if(run&&validExperienceObservation(observation,event,run))samples.push({...observation,scope:experienceScopeFor(run.input),runId:run.id})
        }
        check();repository.saveExperienceSamples(pending.map(e=>e.id),samples)
      }
      check();repository.monitorExperienceTrends?.()
      const samples=repository.getExperienceSamples()
      const events=repository.getExperienceEvents([...new Set(samples.map(s=>s.eventId))])
      const eventMap=new Map(events.map(e=>[e.id,e]))
      // Monitor only explicit subsequent corrections associated with actual use of this skill.
      for(const skill of repository.getActiveSystemExperiences()){
        const head=skills().find(s=>s.id===skill.id)!
        if(head.state==='validating')continue
        const subsequent=samples.filter(s=>key(s)===key(skill)&&!skill.support.includes(s.eventId)&&
          repository.getExperienceRun(s.runId)?.bundle.refs.some(ref=>ref.id===skill.id&&ref.version===skill.version) && (eventMap.get(s.eventId)?.createdAt??'')>skill.createdAt)
        const counters=independentExperienceSamples(subsequent.filter(s=>s.polarity==='counterexample'),events)
        if(counters.length>=experienceLearningPolicy.rollbackCases){
          didWork=true;check();repository.saveSystemExperience({...skill,enabled:false,state:'withdrawn',locked:true,seenEvents:head.seenEvents,previousVersion:head.version,reason:'多条独立使用反馈表明效果退步，已恢复基础方法 / 複数の利用結果に基づき基本手順へ復帰'},head.version)
        } else if(skill.state==='trial'&&independentExperienceSamples(subsequent.filter(s=>s.polarity==='support'&&eventMap.get(s.eventId)?.kind!=='edit'),events).length>=experienceLearningPolicy.trialSupports){
          didWork=true;check();repository.saveSystemExperience({...skill,state:'active',seenEvents:head.seenEvents,previousVersion:head.version,reason:'后续独立业务记录支持继续使用 / 後続の独立した記録で継続を確認'},head.version)
        }
      }
      const groups=new Map<string,ExperienceSample[]>()
      for(const sample of samples.filter(s=>s.polarity==='support'))groups.set(key(sample),[...(groups.get(key(sample))??[]),sample])
      for(const group of groups.values()){
        check()
        const first=group[0]!
        const current=skills().find(s=>key(s)===key(first))
        if(current?.locked)continue
        const consumed=current?.seenEvents??current?.support??[]
        if(current?.state==='validating'&&current.support.some(id=>!eventMap.get(id)||eventMap.get(id)?.superseded)){repository.saveSystemExperience({...current,state:'rejected',reason:'验证依据已更新 / 検証の根拠が更新されました'},current.version);continue}
        const freshGroup=current?.state==='validating'?group.filter(s=>current.support.includes(s.eventId)):current?group.filter(s=>!consumed.includes(s.eventId)):group
        const independent=independentExperienceSamples(freshGroup,events)
        if(independent.length<experienceLearningPolicy.trainingCases+experienceLearningPolicy.validationCases)continue
        // Split by case AND person, chronologically. Validation outcomes never enter replay inputs.
        const selected=independent.slice(0,experienceLearningPolicy.trainingCases).concat(independent.slice(-experienceLearningPolicy.validationCases))
        const support=selected.map(s=>s.eventId)
        if(current&&current.state!=='validating'&&support.every(id=>current.support.includes(id)))continue
        didWork=true
        let candidate=current?.state==='validating'&&support.every(id=>current.support.includes(id))?current:repository.saveSystemExperience({
          id:current?.id,task:first.task,method:first.method,keyword:first.keyword,scope:first.scope,intent:first.intent,rankingFeature:first.rankingFeature,fallbackVersion:current?.servingVersion,modelKey:model().key,enabled:false,locked:false,state:'validating',support,seenEvents:[...new Set([...consumed,...support])],evaluations:[],previousVersion:current?.version??null,
          reason:'独立案例验证中 / 独立ケースで検証中'},current?.version??0)
        if(!candidate.procedure && cloud.draftExperienceMethod){
          const training=selected.slice(0,experienceLearningPolicy.trainingCases).map(s=>eventMap.get(s.eventId)!)
          const draft=await call(()=>cloud.draftExperienceMethod({task:first.task,keyword:first.keyword,intent:first.intent,previous:current?.procedure,
            events:training.map(e=>({id:e.id,text:e.text,...(e.kind==='edit'?{before:e.data.before,after:e.data.after}:{})})),model:model(),signal}))
          try {
            const procedure=validateExperienceProcedure(draft,training)
            check();candidate=repository.saveSystemExperience({...candidate,procedure},candidate.version)
          } catch(error) {
            check()
            repository.saveSystemExperience({...candidate,state:'rejected',reason:'方法或来源未通过校验，保留原有方法 / 手順または根拠の検証に不合格・現行手順を維持'},candidate.version)
            break
          }
        }
        if(candidate.method==='custom'&&!candidate.procedure)throw new Error('LEARNING_METHOD_REQUIRED')
        const validation=selected.slice(-experienceLearningPolicy.validationCases)
        for(const sample of validation){
          if(candidate.evaluations.some(e=>e.eventId===sample.eventId))continue
          const run=repository.getExperienceRun(sample.runId), event=eventMap.get(sample.eventId)
          if(!run||!event||event.superseded)throw new Error('LEARNING_SOURCE_CHANGED')
          if(candidate.method==='ranking') {
            const snapshot=run.input.ranking,feature=candidate.rankingFeature
            if(!snapshot||!feature)throw new Error('LEARNING_RANKING_CONTEXT_MISSING')
            const active=repository.getActiveSystemExperiences().filter(s=>s.method==='ranking')
            const baseline=rankWithExperiences(snapshot.pool,active).find(r=>r.row.key===snapshot.target)
            const improved=rankWithExperiences(snapshot.pool,[...active.filter(s=>s.id!==candidate.id),{...candidate,enabled:true}]).find(r=>r.row.key===snapshot.target)
            const grounded=!!improved&&!!rankingEvidence(improved.row,feature,candidate.keyword)&&event.text.includes(sample.quote)
            const regression=!baseline||!improved||(improved.row.eligible===false||improved.row.tier===4||improved.row.tier>=100)
            candidate=repository.saveSystemExperience({...candidate,evaluations:[...candidate.evaluations,{eventId:sample.eventId,runId:sample.runId,baseline:0,candidate:baseline&&improved&&improved.adjustment.rank<baseline.adjustment.rank?1:0,regression,grounded}]},candidate.version)
            continue
          }
          const budget=settings()
          if(budget.dailyCallLimit-budget.callsToday<3)throw new Error('LEARNING_BUDGET')
          const baseline=repository.getExperienceBundle(run.input.task,run.input.requirements,run.input.context)
          const old=repository.getActiveSystemExperiences().find(s=>s.id===candidate.id)
          const improved=[...baseline.instructions.filter(text=>!old||text!==experienceInstructions(old)),experienceInstructions(candidate)]
          const replay=async(instructions:string[])=>{
            const input=run.input
            if(input.task==='matching'){
              const result=await call(()=>cloud.assessMatchCandidates({conversationId:randomUUID(),requestId:randomUUID(),locale:input.locale,model:model(),signal,
                onClientRequestId:()=>undefined,onRemoteSettled:()=>undefined,jobCase:{title:null,requirements:input.requirements,workRules:input.hrRules,experienceSkills:instructions},
                candidates:[{label:'CANDIDATE_1',facts:input.facts,projects:input.projects,hardFilters:input.hardFilters}]}))
              if(result.assessments.length!==1)throw new Error('LEARNING_REPLAY_INVALID')
              return result.assessments[0]!
            }
            if(input.task==='introduction'){if(!input.introduction)throw new Error('LEARNING_INPUT_INVALID');return await call(()=>cloud.regenerateIntroduction({...input.introduction!,experienceSkills:instructions,model:model(),signal}))}
            return await call(()=>cloud.generateRuleQuestions({caseSupplied:!!run.reviewId,profile:{fields:input.facts,projectExperiences:input.projects} as never,requirements:input.requirements.map(r=>r.value),rules:input.hrRules,
              previousQuestions:input.previousQuestions,notes:input.notes,experienceSkills:instructions,locale:input.locale,model:model(),signal}))
          }
          const oldOutput=await replay(baseline.instructions), newOutput=await replay(improved)
          // Alternate A/B without giving the evaluator a current/candidate label.
          const reverse=parseInt(createHash('sha256').update(sample.eventId).digest('hex').slice(0,2),16)%2===1
          const a=reverse?newOutput:oldOutput,b=reverse?oldOutput:newOutput
          const judgment=await call(()=>cloud.judgeExperience({task:first.task,method:first.method,keyword:first.keyword,correction:event.text,context:run.input,a,b,model:model(),signal}))
          const oldScore=reverse?judgment.b:judgment.a,newScore=reverse?judgment.a:judgment.b
          const supported=event.text.includes(judgment.sourceQuote)&&sourceText(newScore>oldScore?newOutput:oldOutput).includes(judgment.outputQuote)
          const invalidHard=run.input.task==='matching'&&run.input.hardFilters.some(f=>f.outcome==='failed')&&(newOutput as {fit?:string}).fit!=='weak'
          const evaluation:ExperienceEvaluation={eventId:sample.eventId,runId:sample.runId,baseline:oldScore,candidate:newScore,regression:judgment.regression||invalidHard,grounded:supported}
          check();candidate=repository.saveSystemExperience({...candidate,evaluations:[...candidate.evaluations,evaluation]},candidate.version)
        }
        check()
        const freshEvents=repository.getExperienceEvents(candidate.support)
        const sourcesValid=freshEvents.length===candidate.support.length&&freshEvents.every(e=>!e.superseded)
        const passed=sourcesValid&&experienceEvaluationPasses(candidate.evaluations)
        repository.saveSystemExperience({...candidate,enabled:passed,state:passed?'trial':'rejected',reason:passed?'独立案例比较通过，开始在相同要求下使用 / 独立ケース比較を通過し同条件で利用開始':'未证明优于当前方法，保持原有判断 / 改善を確認できず現行手順を維持'},candidate.version)
        break // One bounded candidate per idle cycle; allow work to resume promptly.
      }
      // Saved questions are distilled without asking HR for a separate learning action.
      if(cloud.draftQuestionTemplate&&repository.getPendingBankQuestions)for(const source of repository.getPendingBankQuestions()){
        const raw=await call(()=>cloud.draftQuestionTemplate({source,model:model(),signal}))
        check()
        let template:import('@shared').QuestionTemplateDraft|null=null
        try {template=validateQuestionTemplate(raw,source)}catch{/* Invalid templates are consumed, never endlessly retried or published. */}
        repository.saveQuestionTemplate(source,template);didWork=true
      }
      if(cloud.compareBankQuestions&&cloud.draftQuestionTemplate&&repository.getQuestionBankRefinement){
        const revision=repository.getQuestionBankRefinement()
        if(revision){
          const {current,sources,signature}=revision
          const training={...sources[0]!,text:sources.slice(0,3).map(s=>s.text).join('\n')}
          const raw=await call(()=>cloud.draftQuestionTemplate({source:training,model:model(),signal}))
          const draft=validateQuestionTemplate(raw,training)
          if(draft.category===current.category&&draft.keyword.normalize('NFKC').toLowerCase()===current.keyword.normalize('NFKC').toLowerCase()){
            const result=await call(()=>cloud.compareBankQuestions({current,candidate:draft,sources:sources.slice(3),model:model(),signal}))
            check()
            if(result.preferred==='candidate'&&result.comparisons.length===2&&result.comparisons.every(r=>!r.regression&&r.candidate>r.current))repository.reviseQuestionBank(current.id,current.version,draft,sources,result.reason)
          }
          check();repository.saveGrowthCheckpoint('bank-refine:'+current.id,signature);didWork=true
        }else{
          const merge=repository.getQuestionBankMergeCandidate?.()
          if(merge){
            const candidate={category:merge.candidate.category,keyword:merge.candidate.keyword,text:merge.candidate.text,scoringGuide:merge.candidate.scoringGuide,sourceQuote:merge.source.text}
            const result=await call(()=>cloud.compareBankQuestions({current:merge.current,candidate,sources:[merge.source],model:model(),signal}))
            check()
            if(result.equivalent&&result.preferred!=='candidate'&&result.comparisons.every(r=>!r.regression&&r.current>=r.candidate))repository.mergeQuestionBank(merge.current,merge.candidate,result.reason,merge.source)
            repository.saveGrowthCheckpoint('bank-merge:'+merge.signature,'checked');didWork=true
          }
        }
      }
      check();repository.monitorQuestionBank?.()
      check();if(didWork)repository.completeExperienceLearning(null)
    } catch(error) {
      if(!closed&&!signal.aborted){const message=error instanceof Error?error.message:''
        repository.completeExperienceLearning(message==='LEARNING_BUDGET'?'今日学习预算已用完，稍后继续 / 本日の予算に達しました':message==='LEARNING_INTERRUPTED'?'已暂停 / 一時停止中':'后台验证暂未完成，保留当前方法并稍后重试 / 検証未完了・現行手順を維持')}
    } finally {outerSignal?.removeEventListener('abort',abort);activeControllers.delete(controller);running=false}
  }
  return {tick,stop:()=>{closed=true;for(const c of activeControllers)c.abort()},isRunning:()=>running}
}

/** Lives only while the desktop app is open. No OS scheduler or external service. */
export function startExperienceLearning(context:Parameters<typeof createExperienceLearner>[0], idleSeconds:()=>number) {
  const learner=createExperienceLearner(context)
  let controller:AbortController|null=null, lastStart=0
  const timer=setInterval(()=>{
    const idle=idleSeconds()
    if(idle<5||isLearningForegroundBusy()){controller?.abort();return}
    if(idle<30||learner.isRunning()||Date.now()-lastStart<5*60_000)return
    const state=context.repository.getExperienceSettings?.()??context.repository.getSystemExperience().settings
    if(!state.enabled)return
    lastStart=Date.now();controller=new AbortController();void learner.tick(controller.signal)
  },2000)
  timer.unref()
  return ()=>{clearInterval(timer);controller?.abort();learner.stop()}
}
