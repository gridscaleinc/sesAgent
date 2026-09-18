import assert from 'node:assert/strict'
import {randomBytes,randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {EncryptedApplicationRepository} from '@persistence'
import {EncryptedFileVault} from '@files'
import {loadAgentChatModelCatalog} from '@agent'
import {rankWithExperiences,type ExperienceInput,type CandidateInterviewQuestion,type ExperienceContext} from '@shared'
import {createExperienceLearner} from '../apps/desktop/src/main/experience-learning'
import {importChatPastedJobCaseText,importPastedCandidateText} from '../apps/desktop/src/main/business-text-intake'
const dir=await mkdtemp(join(tmpdir(),'ses-growth-')),options={path:join(dir,'test.db'),databaseKey:randomBytes(32),mappingKey:randomBytes(32)}
let repository=new EncryptedApplicationRepository(options)
const fileVault=new EncryptedFileVault({directory:join(dir,'files'),key:randomBytes(32)})
const context:ExperienceContext={operatorId:'00000000-0000-4000-8000-000000000001',locale:'zh-CN',customer:{key:'client-a',label:'客户甲'},category:{key:'api',label:'API开发'}}
const requirements=[{key:'skills',label:'技术',value:'Java'}],projects=[{title:'Java API',period:null,role:'开发',technologies:['Java'],summary:'本人独立负责接口设计并交付接口设计文档。'}]
const quote='客户明确更看重本人独立负责 Java 设计，因此优先推荐这位人员。'
let calls=0
const cloud={
 async extractExperience({events}:any){calls++;return {observations:events.filter((e:any)=>e.kind==='assessment-feedback').map((e:any)=>({eventId:e.id,task:'matching',method:'ranking',intent:'ranking-preference',rankingFeature:'independent-responsibility',keyword:'Java',quote:e.text,polarity:'support'}))}},
 async draftExperienceMethod({events}:any){calls++;return {procedure:{title:'优先核对独立设计职责',steps:['在相同匹配等级内，优先考虑有本人独立设计职责依据的人员。'],avoid:['不得改变硬性条件或推断未记录的能力。']},sources:events.map((e:any)=>({eventId:e.id,quote:e.text}))}},
 async draftQuestionTemplate({source}:any){calls++;return {category:'responsibility',keyword:'Java',text:'请以相关项目为例，说明本人负责的设计、决策和交付物。',scoringGuide:'明确本人职责，提供具体决策及成果物。',sourceQuote:source.text}}
}
const worker=()=>createExperienceLearner({repository,agentNarrativeStreamer:cloud as never,agentChatModelCatalog:loadAgentChatModelCatalog()})
let learner=worker()
async function pair(i:number){
 const person=(await importPastedCandidateText({repository,fileVault,localNer:null},`氏名：検証担当${i}\nスキル：Java\n経歴：API${i}開発`)).review
 const draft=(await importChatPastedJobCaseText({repository,fileVault,localNer:null},`案件名：Java開発${i}\n必須スキル：Java\n備考：顧客：検証企業${i}`)).review
 const job=repository.confirmJobCaseReview({reviewId:draft.reviewId,reviewRevision:draft.reviewRevision,privacyReviewed:true,fields:draft.fields.map(f=>({key:f.key,value:f.key==='title'?`案件${i}`:f.value,confirmed:true,changeReason:'fixture'}))},'test','HR')
 return {documentId:person.documentId,reviewId:job.reviewId,profileVersion:person.profile!.version,jobCaseVersion:job.jobCase!.version}
}
const pairs:Awaited<ReturnType<typeof pair>>[]=[],runs:string[]=[]
try{
 repository.controlSystemExperience({action:'budget',dailyCallLimit:60,expectedRevision:0})
 for(let i=0;i<5;i++){
  const p=await pair(i);pairs.push(p)
  const pool=[{key:'other',score:73,tier:0,requirements,context,projects:[]},{key:p.documentId,score:70,tier:0,requirements,context,projects}]
  const input:ExperienceInput={task:'matching',context,ranking:{target:p.documentId,pool},requirements,facts:[{label:'技能',value:'Java'}],projects,hardFilters:[],hrRules:[],previousQuestions:[],notes:'',locale:'zh-CN'}
  const runId=repository.saveExperienceRun({...p,interviewId:null,input,output:{reason:'fixture'},rulesRevision:0,bundle:{task:'matching',instructions:[],refs:[]},modelKey:'fixture'});runs.push(runId)
  repository.recordExperienceExposure({runId,action:'shown',rank:2})
  repository.recordExperienceEvent({...p,interviewId:null,sourceKey:`rank:${i}`,kind:'assessment-feedback',text:quote,actor:'HR',data:{runId,decision:'suitable',reason:'evidence'}})
 }
 await learner.tick()
 const skill=repository.getSystemExperience().experiences.find(s=>s.method==='ranking')!
 assert.equal(skill.state,'trial');assert.equal(skill.scope?.kind,'customer');assert.equal(skill.rankingFeature,'independent-responsibility')
 const first=repository.getExperienceRun(runs[0]!)!
 assert.equal(rankWithExperiences(first.input.ranking!.pool,repository.getActiveSystemExperiences())[0]!.row.key,pairs[0]!.documentId)
 assert.equal(repository.getExperienceBundle('matching',requirements,context).refs.length,0,'ranking must not alter the qualification prompt')
 const other=first.input.ranking!.pool.map(r=>({...r,context:{...context,customer:{key:'other',label:'另一客户'}}}))
 assert.equal(rankWithExperiences(other,repository.getActiveSystemExperiences())[0]!.row.key,'other')
 // Existing interview preparation, no extra teaching action, queues a reusable template.
 async function prepare(p:typeof pairs[number],i:number,bank?:{id:string;version:number},edited=false){
  const started=repository.advanceBusinessProgress({documentId:p.documentId,reviewId:p.reviewId,expectedRevision:0,mutationId:randomUUID(),action:'schedule',schedule:{roundNumber:1,scheduledAt:'',durationMinutes:60,meetingMethod:'onsite',meetingUrl:'',location:'',interviewer:'',note:''}},'HR')
  const interviewId=started.progress!.rounds[0]!.id
  const question:CandidateInterviewQuestion={id:randomUUID(),text:'请说明 Java 项目中本人负责的设计和具体交付物。',requirement:'Java',source:'match',sourceLabel:'Java',selected:true,...(bank?{bankQuestionId:bank.id,bankVersion:bank.version}:{})}
  const input:ExperienceInput={task:'interview',context,requirements,facts:[],projects,hardFilters:[],hrRules:[],previousQuestions:[],notes:'',locale:'zh-CN'}
  const runId=repository.saveExperienceRun({...p,interviewId,input,output:[question],rulesRevision:0,bundle:{task:'interview',instructions:[],refs:[]},modelKey:'fixture'})
  const saved=repository.advanceBusinessProgress({documentId:p.documentId,reviewId:p.reviewId,expectedRevision:started.revision,mutationId:randomUUID(),action:'prepare',roundNumber:1,questions:[{...question,experienceRunId:runId,text:edited?'请具体说明 Java 项目中亲自解决的设计难题、取舍与验证结果。':question.text}]},'HR')
  return {runId,question,saved}
 }
 const prepared=await prepare(pairs[0]!,0)
 assert.equal(repository.getPendingBankQuestions().length,1)
 await learner.tick()
 let bank=repository.listQuestionBank()[0]!
 assert.ok(bank);assert.equal(bank.sources,1);assert.ok(!bank.text.includes('検証担当'))
 assert.equal(repository.getApplicableBankQuestions(requirements,context).length,1)
 assert.equal(repository.getApplicableBankQuestions(requirements,{...context,customer:{key:'other',label:'其他'}}).length,0)
 assert.equal(repository.getApplicableBankQuestions([{key:'skills',label:'技术',value:'Python'}],context).length,0)
 // Adoption is attributed only to the originating generated question. No implicit send/answer labels.
 for(let i=0;i<10;i++){const p=await pair(i+20);pairs.push(p);await prepare(p,i+1,bank,i>=5)}
 bank=repository.listQuestionBank()[0]!
 assert.equal(bank.adoptions,10);assert.equal(bank.edits,5)
 repository.controlSystemExperience({action:'budget',dailyCallLimit:0,expectedRevision:repository.getExperienceSettings().revision})
 const callsBeforeMonitoring=calls
 await learner.tick()
 assert.equal(calls,callsBeforeMonitoring)
 bank=repository.listQuestionBank({includeDisabled:true})[0]!
 assert.equal(bank.enabled,false);assert.equal(bank.state,'withdrawn')
 repository.controlQuestionBank({id:bank.id,expectedVersion:bank.version,enabled:true})
 repository.monitorQuestionBank()
 assert.equal(repository.listQuestionBank()[0]!.enabled,true)
 assert.throws(()=>repository.controlQuestionBank({id:bank.id,expectedVersion:bank.version,enabled:false}),/更新/)
 // Trend rollback of a writing method uses ten independent adoptions and no inferred hiring outcomes.
 const method=repository.saveSystemExperience({...skill,id:undefined,task:'introduction',method:'custom',intent:'presentation-structure',rankingFeature:undefined,scope:{kind:'personal',owner:context.operatorId,key:context.operatorId,label:'个人',locale:'zh-CN'},keyword:'介绍',enabled:true,state:'trial',locked:false,previousVersion:null},0)
 for(let i=0;i<10;i++){
  const p=pairs[i+5]!,runId=repository.saveExperienceRun({...p,interviewId:null,rulesRevision:0,modelKey:'fixture',input:{...first.input,ranking:undefined,task:'introduction',requirements:[{key:'purpose',label:'用途',value:'介绍'}],context},output:'项目职责清楚，开始时间待确认。',bundle:{task:'introduction',instructions:[],refs:[{id:method.id,version:method.version}]}})
  repository.recordExperienceAdoption(runId,i<5?'项目职责清楚，开始时间待确认。':'请按项目职责与开始时间分段说明，开始时间仍需确认。','HR',{documentId:p.documentId,reviewId:p.reviewId})
 }
 await learner.tick()
 assert.equal(calls,callsBeforeMonitoring)
 assert.equal(repository.getSystemExperience().experiences.find(s=>s.id===method.id)!.state,'withdrawn')
 assert.ok(repository.getSystemExperience().trends!.some(t=>t.task==='introduction'&&t.recent.count===10&&t.state==='insufficient'))
 // Stop/restart keeps manual controls and bank templates; deleting a sole source removes availability.
 learner.stop();repository.close();repository=new EncryptedApplicationRepository(options);learner=worker()
 assert.ok(repository.listQuestionBank()[0])
 const preview=repository.previewJobCaseDeletion(pairs[0]!.reviewId)
 repository.deleteJobCaseDatabaseData({reviewId:pairs[0]!.reviewId,confirmationHash:preview.confirmationHash,confirmationText:'削除'})
 assert.equal(repository.listQuestionBank().length,0)
 assert.equal(repository.getActiveSystemExperiences().some(s=>s.id===skill.id),false)
 console.log(JSON.stringify({schema:56,customerRanking:true,heldOutRankValidation:true,hardRuleSeparation:true,questionCaptureAndTemplate:true,questionScopeIsolation:true,adoptionAttribution:true,questionTrendWithdrawal:true,monitoringWithoutModelBudget:true,experienceTrendWithdrawal:true,staleControlRejected:true,restartAndDeletion:true,calls}))
}finally{learner.stop();repository.close();await rm(dir,{recursive:true,force:true})}
