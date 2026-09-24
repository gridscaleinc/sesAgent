import assert from 'node:assert/strict'
import { randomBytes,randomUUID } from 'node:crypto'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EncryptedApplicationRepository,currentSchemaVersion } from '@persistence'
import { EncryptedFileVault } from '@files'
import { loadAgentChatModelCatalog } from '@agent'
import { experienceScopeMatches,type ExperienceInput,type CandidateInterviewQuestion } from '@shared'
import { importPastedCandidateText,importChatPastedJobCaseText } from '../apps/desktop/src/main/business-text-intake'
import { createExperienceLearner } from '../apps/desktop/src/main/experience-learning'
import { createOpportunityDiscovery } from '../apps/desktop/src/main/opportunity-discovery'
const dir=await mkdtemp(join(tmpdir(),'ses-growth-v3-')),options={path:join(dir,'test.db'),databaseKey:randomBytes(32),mappingKey:randomBytes(32)}
let repository=new EncryptedApplicationRepository(options)
const fileVault=new EncryptedFileVault({directory:join(dir,'files'),key:randomBytes(32)})
const ctx={operatorId:'00000000-0000-4000-8000-000000000001',locale:'zh-CN' as const,customer:{key:'fixture',label:'客户'}}
const original='请说明 Java 项目中本人负责的设计。',edited='请说明 Java 项目中本人独立负责的设计决策、取舍理由及验证结果。'
let calls=0,comparisons=0
const cloud={
 async extractExperience(){calls++;return {observations:[]}},
 async analyzeInterviewAnswers({source}:any){calls++;return source.questions.map((q:any)=>({questionId:q.id,status:'partial',quote:source.notes,summary:'已说明实现职责，设计决策待核实。',remaining:'独立设计的决策依据'}))},
 async draftQuestionTemplate({source}:any){calls++;return {category:'responsibility',keyword:'Java',text:source.text.includes('取舍')?edited:original,scoringGuide:'确认本人职责、设计取舍与验证依据。',sourceQuote:source.text.split('\n')[0]}},
 async compareBankQuestions({current,candidate,sources}:any){calls++;comparisons++;const same=current.text===candidate.text;return {equivalent:true,preferred:same?'tie':'candidate',comparisons:sources.map((s:any)=>({sourceId:s.id,quote:s.text,current:same?2:0,candidate:2,regression:false})),reason:'独立保留案例显示改写更具体地询问设计取舍，且没有预设候选人经历。'}}
}
const learner=()=>createExperienceLearner({repository,agentNarrativeStreamer:cloud as never,agentChatModelCatalog:loadAgentChatModelCatalog()})
let worker=learner()
async function pair(index:number){
 const person=(await importPastedCandidateText({repository,fileVault,localNer:null},`氏名：検証要員${index}\nスキル：Java\n経歴：Java API開発${index}`)).review
 const draft=(await importChatPastedJobCaseText({repository,fileVault,localNer:null},`案件名：Java検証案件${index}\n必須スキル：Java`)).review
 const job=repository.confirmJobCaseReview({reviewId:draft.reviewId,reviewRevision:draft.reviewRevision,privacyReviewed:true,fields:draft.fields.map(f=>({key:f.key,value:f.value,confirmed:true,changeReason:'fixture'}))},'fixture','HR')
 return {documentId:person.documentId,reviewId:job.reviewId,profileVersion:person.profile!.version,jobCaseVersion:job.jobCase!.version,jobCaseId:job.jobCase!.id}
}
async function prepare(p:Awaited<ReturnType<typeof pair>>,bank?:{id:string;version:number},questionId=randomUUID()){
 const round=repository.advanceBusinessProgress({documentId:p.documentId,reviewId:p.reviewId,expectedRevision:0,mutationId:randomUUID(),action:'schedule',schedule:{roundNumber:1,scheduledAt:'',durationMinutes:60,meetingMethod:'onsite',meetingUrl:'',location:'',interviewer:'',note:''}},'HR')
 const question:CandidateInterviewQuestion={id:questionId,text:original,selected:true,source:'match',sourceLabel:'Java',requirement:'Java',...(bank?{bankQuestionId:bank.id,bankVersion:bank.version}:{})}
 const input:ExperienceInput={task:'interview',context:ctx,requirements:[{key:'skills',label:'技术',value:'Java'}],facts:[],projects:[],hardFilters:[],hrRules:[],previousQuestions:[],notes:'',locale:'zh-CN'}
 const runId=repository.saveExperienceRun({...p,interviewId:round.progress!.rounds[0]!.id,rulesRevision:0,modelKey:'fixture',input,output:[question],bundle:{task:'interview',instructions:[],refs:[]}})
 return repository.advanceBusinessProgress({documentId:p.documentId,reviewId:p.reviewId,expectedRevision:round.revision,mutationId:randomUUID(),action:'prepare',roundNumber:1,questions:[{...question,experienceRunId:runId,text:bank?edited:original}]},'HR')
}
try{
 assert.equal(currentSchemaVersion,59)
 repository.controlSystemExperience({action:'budget',dailyCallLimit:60,expectedRevision:0})
 const [customer]=repository.saveCustomerIdentity({name:'ABC株式会社',aliases:['ABC','客户甲'],expectedVersion:0})
 const resolved=repository.resolveCustomerIdentity(' ABC ')
 assert.equal(resolved.key,repository.resolveCustomerIdentity('ABC株式会社').key)
 assert.ok(experienceScopeMatches({kind:'customer',owner:ctx.operatorId,locale:'zh-CN',key:resolved.aliasKeys![1]!,label:'旧别名'},{...ctx,customer:resolved}))
 assert.throws(()=>repository.saveCustomerIdentity({name:'别家',aliases:['ABC'],expectedVersion:0}),/另一客户/)
 assert.throws(()=>repository.saveCustomerIdentity({id:customer!.id,name:'ABC株式会社',aliases:[],expectedVersion:0}),/更新/)
 repository.saveCustomerIdentity({id:customer!.id,name:customer!.name,expectedVersion:1,aliases:[]})
 assert.notEqual(repository.resolveCustomerIdentity('ABC').key,repository.resolveCustomerIdentity('ABC株式会社').key)
 const pairs=[]
 for(let i=0;i<7;i++)pairs.push(await pair(i))
 const first=await prepare(pairs[0]!,undefined,'standard-1')
 await worker.tick();const bank=repository.listQuestionBank()[0]!
 assert.ok(bank)
 const feedback=repository.advanceBusinessProgress({documentId:pairs[0]!.documentId,reviewId:pairs[0]!.reviewId,expectedRevision:first.revision,mutationId:randomUUID(),action:'feedback',roundNumber:1,notes:'本人说明负责 Java API 实现和单元测试，基本设计由组长负责。',result:'pending',next:'unknown',unresolved:['独立设计职责']},'HR')
 await worker.tick()
 const interviewId=first.progress!.rounds[0]!.id,answers=repository.getInterviewAnswers(interviewId)!
 assert.equal(answers.answers[0]!.questionId,'standard-1');assert.equal(answers.answers[0]!.status,'partial');assert.ok(answers.answers[0]!.quote.includes('组长'))
 assert.equal(repository.getPairInterviewEvidence(pairs[0]!.documentId,pairs[0]!.reviewId).length,1)
 assert.equal(repository.getPairInterviewEvidence(pairs[0]!.documentId,pairs[1]!.reviewId).length,0)
 repository.advanceBusinessProgress({documentId:pairs[0]!.documentId,reviewId:pairs[0]!.reviewId,expectedRevision:feedback.revision,mutationId:randomUUID(),action:'feedback',roundNumber:1,notes:'更正记录：本人负责 Java 接口的详细设计和实现。',result:'pending',next:'unknown',unresolved:[]},'HR')
 assert.equal(repository.getInterviewAnswers(interviewId),null)
 for(const p of pairs.slice(1,6))await prepare(p,bank)
 await worker.tick();await worker.tick()
 const updated=repository.listQuestionBank().find(q=>q.id===bank.id)!
 assert.equal(updated.version,2);assert.equal(updated.text,edited)
 assert.equal(repository.getQuestionBankHistory(bank.id).length,2);assert.ok(comparisons>=1)
 await worker.tick()
 assert.equal(repository.listQuestionBank().filter(q=>q.text===edited).length,1,'equivalent templates merged')
 const merged=repository.listQuestionBank({includeDisabled:true}).find(q=>q.mergedInto===bank.id)!
 assert.ok(merged.sources>0,'merge keeps reversible source attribution')
 repository.controlQuestionBank({id:merged.id,expectedVersion:merged.version,enabled:true})
 assert.equal(repository.getQuestionBankMergeCandidate(),null,'manual restoration overrides automatic deduplication')
 repository.restoreQuestionBankVersion(bank.id,2,1)
 assert.equal(repository.listQuestionBank().find(q=>q.id===bank.id)!.text,original)
 assert.throws(()=>repository.restoreQuestionBankVersion(bank.id,2,1),/失效/)
 const p=pairs[6]!
 const opportunity={...p,personName:'测试人员',caseTitle:'Java API',rulesRevision:0,fingerprint:'a'.repeat(64),score:70,reasons:['Java 项目依据'],confirm:['开始时间']}
 repository.saveMatchingOpportunities(p.reviewId,[opportunity]);let item=repository.listMatchingOpportunities().find(o=>o.documentId===p.documentId)!
 assert.ok(item);repository.controlMatchingOpportunity({id:item.id,fingerprint:item.fingerprint,action:'dismissed'})
 repository.saveMatchingOpportunities(p.reviewId,[opportunity]);assert.equal(repository.listMatchingOpportunities().filter(o=>o.documentId===p.documentId).length,0)
 repository.saveMatchingOpportunities(p.reviewId,[{...opportunity,fingerprint:'b'.repeat(64)}]);item=repository.listMatchingOpportunities().find(o=>o.documentId===p.documentId)!
 assert.equal(item.state,'new');assert.throws(()=>repository.controlMatchingOpportunity({id:item.id,fingerprint:'a'.repeat(64),action:'seen'}),/更新/)
 await createOpportunityDiscovery({repository})()
 worker.stop();repository.close();repository=new EncryptedApplicationRepository(options);worker=learner()
 assert.equal(repository.listCustomerIdentities()[0]!.version,2)
 assert.equal(repository.getQuestionBankHistory(bank.id).length,2)
 const preview=repository.previewJobCaseDeletion(pairs[1]!.reviewId)
 repository.deleteJobCaseDatabaseData({reviewId:pairs[1]!.reviewId,confirmationHash:preview.confirmationHash,confirmationText:'削除'})
 assert.throws(()=>repository.restoreQuestionBankVersion(bank.id,3,1),/删除/)
 console.log(JSON.stringify({schema:56,customerAliasIsolation:true,answerSourceAndInvalidation:true,heldoutTemplateRevision:true,semanticMerge:true,versionRestore:true,opportunityDismissalAndFreshness:true,discoveryExecuted:true,restartAndDeletion:true,calls}))
}finally{worker.stop();repository.close();await rm(dir,{recursive:true,force:true})}
