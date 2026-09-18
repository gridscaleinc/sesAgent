/** Real configured service + production privacy gate; synthetic records only. No business database writes. */
import { app, net } from 'electron'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AiCommerceNativeClient, loadAiCommerceConfiguration, parseAiCommerceNativeCredential, parseAiCommercePendingAuthorization } from '@aicommerce'
import { SafeStorageJsonCredentialVault } from '@platform'
import { EncryptedApplicationRepository } from '@persistence'
import { createLocalAiRuntime } from '@local-ai'
import { defaultAgentChatModelKey, loadAgentChatModelCatalog, resolveAgentChatModel } from '@agent'
import { baseExperienceSkills, experienceInstructions, type ExperienceEvent, type ExperienceInput } from '@shared'
import { AgentCloudNarrativeService } from '../apps/desktop/src/main/agent-cloud-narrative'
import { loadCloudPrivacyGates } from '../apps/desktop/src/main/privacy-gates'
import { validateQuestionTemplate } from '../apps/desktop/src/main/question-bank'
import { validateExperienceProcedure } from '../apps/desktop/src/main/experience-procedure'

app.setName('ses-agent-desktop')
app.setAppPath(process.cwd())
async function main() {
await app.whenReady()
console.log('[experience-live] ready')
const root=process.cwd(),directory=await mkdtemp(join(tmpdir(),'ses-experience-live-'))
const repository=new EncryptedApplicationRepository({path:join(directory,'live.db'),databaseKey:randomBytes(32),mappingKey:randomBytes(32)})
const report:Record<string,unknown>={version:'experience-growth-live-v2',startedAt:new Date().toISOString(),syntheticOnly:true,productionPrivacyGate:true,callLimit:12,calls:0,status:'running',checks:[]}
const reportPath=resolve(root,'output/system-experience/live-report.json')
const deadline=AbortSignal.timeout(9*60_000)
const run=async<T>(name:string,operation:()=>Promise<T>):Promise<T>=>{
  if(Number(report.calls)>=12)throw new Error('Acceptance call limit reached')
  report.calls=Number(report.calls)+1
  console.log('[experience-live]',name)
  try {
    const result=await operation();(report.checks as string[]).push(name);return result
  } catch(error) {
    // One fresh request for malformed model JSON; never repair or accept invalid output.
    if(!name.endsWith('-format-retry') && error instanceof Error && /JSON/.test(error.message)) {
      report.formatRetries??=[];
      (report.formatRetries as unknown[]).push({stage:name,error:error.message});
      return run(name+'-format-retry',operation)
    }
    throw error
  }
}
try {
  const configuration=loadAiCommerceConfiguration();if(!configuration)throw new Error('AI configuration unavailable')
  const credentials=process.env.SES_EXPERIENCE_CREDENTIAL_DIRECTORY??join(app.getPath('appData'),'ses-agent-desktop','security')
  const aiCommerce=new AiCommerceNativeClient(configuration,{
    credentialStore:new SafeStorageJsonCredentialVault(join(credentials,'aicommerce-native-credential.v1'),parseAiCommerceNativeCredential),
    pendingAuthorizationStore:new SafeStorageJsonCredentialVault(join(credentials,'aicommerce-native-pending-authorization.v1'),parseAiCommercePendingAuthorization),
    openExternal:async()=>{throw new Error('Sign in through the application before live verification')},fetch:(input,init)=>net.fetch(input instanceof URL?input.toString():input,init)
  })
  const streamResponses=aiCommerce.streamResponses.bind(aiCommerce)
  aiCommerce.streamResponses=async input=>{const result=await streamResponses(input);if(input.operationId?.endsWith('-match-assess'))report.matchingRaw=result.content;return result}
  const state=await aiCommerce.getState()
  if(state.connection!=='connected')throw new Error('AI service is not connected')
  const localAi=createLocalAiRuntime({macExecutablePath:join(root,'build/native/macos/ses-vision-ocr')})
  const gates=()=>loadCloudPrivacyGates({packaged:false,resourcesPath:process.resourcesPath,appPath:root,sourceRoot:root,platform:process.platform,arch:process.arch})
  const cloud=new AgentCloudNarrativeService({repository,localNer:localAi.personNameDetector,aiCommerce,policyVersion:'cloud-redaction-v2',loadGates:gates,allowLoopbackHttp:false})
  const model=resolveAgentChatModel(loadAgentChatModelCatalog(),defaultAgentChatModelKey);report.model=model.key
  const pairs=[
    {before:'お世話になっております。要員をご紹介します。Java APIの実装を担当しました。開始日は要確認です。リモート希望です。何卒よろしくお願いいたします。',after:'【経験】Java API実装\n【開始】要確認\n【勤務】リモート希望'},
    {before:'いつもお世話になっております。候補者はJava APIの単体テストを担当しています。稼働時期は要確認です。週一出社を希望しております。ご検討をお願いいたします。',after:'【経験】Java API単体テスト\n【開始】要確認\n【勤務】週一出社希望'},
    {before:'お世話になっております。Java API保守の経験がございます。開始時期は要確認です。常駐勤務可能です。何卒よろしくお願い申し上げます。',after:'【経験】Java API保守\n【開始】要確認\n【勤務】常駐可能'}
  ]
  const sourceEvents:ExperienceEvent[]=pairs.map((pair,index)=>({id:randomUUID(),sourceKey:`synthetic:${index}`,documentId:randomUUID(),reviewId:randomUUID(),interviewId:null,kind:'edit',text:pair.after,actor:'fixture',createdAt:new Date().toISOString(),runIds:[],data:{before:pair.before,after:pair.after,adopted:true,semanticEdit:true},superseded:false}))
  const input:ExperienceInput={task:'introduction',requirements:[{key:'purpose',label:'用途',value:'要員紹介'}],facts:[{key:'skills',label:'技術',value:'Java API実装・単体テスト。基本設計は補助。開始日は要確認。リモート希望。'}],projects:[],hardFilters:[],hrRules:[],previousQuestions:[],notes:'',locale:'ja-JP'}
  const extracted=await run('extract-adopted-edits',()=>cloud.extractExperience({events:sourceEvents.map(event=>({id:event.id,text:event.text,kind:event.kind,data:event.data,runs:[{id:randomUUID(),input,output:event.data.before}]})),model,signal:deadline}))
  report.observations=extracted.observations.length
  report.extractionEligible=extracted.observations.length>0
  // Empty extraction is a valid conservative outcome. Independently exercise the draft protocol.
  report.extractionNote=extracted.observations.length?'Reusable observations returned':'No automatic learning would be scheduled for this batch'
  const drafted=await run('draft-business-method',()=>cloud.draftExperienceMethod({task:'introduction',keyword:'要員紹介',intent:'presentation-structure',events:sourceEvents.map(e=>({id:e.id,text:e.text,before:e.data.before,after:e.data.after})),model,signal:deadline}))
  const procedure=validateExperienceProcedure(drafted,sourceEvents);report.procedure=procedure
  const introduction={projection:JSON.stringify({person:{skills:'Java API実装・単体テスト',responsibility:'基本設計は補助',availability:'要確認',workStyle:'リモート希望'}}),lang:'ja' as const,style:'standard' as const,model,signal:deadline}
  const baseline=await run('introduction-baseline',()=>cloud.regenerateIntroduction({...introduction,experienceSkills:[baseExperienceSkills.introduction]}))
  const improved=await run('introduction-learned',()=>cloud.regenerateIntroduction({...introduction,experienceSkills:[baseExperienceSkills.introduction,experienceInstructions({method:'custom',keyword:'要員紹介',procedure})]}))
  const judgment=await run('compare-introduction',()=>cloud.judgeExperience({task:'introduction',method:'custom',keyword:'要員紹介',correction:'挨拶を省いて経験・開始・勤務を見出し別に短く記載し、開始の要確認を残してください。',context:input,a:baseline,b:improved,model,signal:deadline}))
  if(!improved.includes('Java')||!improved.includes('要確認')||!improved.includes('補助'))throw new Error('Introduction lost material synthetic facts')
  if(!'挨拶を省いて経験・開始・勤務を見出し別に短く記載し、開始の要確認を残してください。'.includes(judgment.sourceQuote)||!(judgment.b>judgment.a?improved:baseline).includes(judgment.outputQuote)&&!improved.includes(judgment.outputQuote))throw new Error('Comparison quotations are not grounded')
  report.introduction={baseline,improved,judgment,candidateEligible:judgment.b>judgment.a&&!judgment.regression}
  const profile={fields:[{key:'skills',label:'技術',value:'Java API実装と単体テスト'}],projectExperiences:[{title:'社内API開発',period:'昨年',role:'実装担当',technologies:['Java'],summary:'本人はAPIの実装と単体テストを担当。基本設計はリーダーが担当し、本人は補助。'}]}
  const questionSource={id:randomUUID(),runId:randomUUID(),questionId:randomUUID(),text:'Java APIの実際のプロジェクトで、本人が担当した設計判断と作成した成果物を具体的に説明してください。',requirement:'Java API実装',scope:{kind:'personal' as const,owner:'fixture',key:'fixture',label:'fixture',locale:'ja-JP' as const},bankId:null,createdAt:new Date().toISOString()}
  const templateRaw=await run('distill-reusable-question',()=>cloud.draftQuestionTemplate({source:questionSource,model,signal:deadline}))
  const template=validateQuestionTemplate(templateRaw,questionSource)
  const bankQuestion={...template,id:randomUUID(),version:1,scope:questionSource.scope,enabled:true,locked:false,reason:'synthetic',createdAt:questionSource.createdAt,updatedAt:questionSource.createdAt,sources:1,adoptions:0,edits:0,state:'available' as const}
  report.questionTemplate=template
  const preferenceEvents=sourceEvents.map(event=>({...event,kind:'assessment-feedback' as const,text:'この顧客は Java API の案件で本人が独立して設計を担当した根拠を重視するため、その実績を明記した候補者を優先推薦する。',data:{decision:'suitable',reason:'evidence'}}))
  const preferences=await run('extract-customer-ranking-preference',()=>cloud.extractExperience({events:preferenceEvents.map(event=>({id:event.id,text:event.text,kind:event.kind,data:event.data,runs:[{id:randomUUID(),input:{...input,task:'matching',requirements:[{key:'skills',label:'必須',value:'Java API'}]},output:'候補者は本人の独立した設計担当範囲を明記。'}]})),model,signal:deadline}))
  report.rankingPreferences=preferences.observations
  if(!preferences.observations.some(o=>o.method==='ranking'&&o.rankingFeature==='independent-responsibility'&&preferenceEvents.some(e=>e.id===o.eventId&&e.text.includes(o.quote))))throw new Error('Explicit customer ranking preference not extracted with source evidence')
  const questions=await run('generate-targeted-interview',()=>cloud.generateRuleQuestions({bankQuestions:[bankQuestion],profile:profile as never,requirements:['Java API実装','基本設計を独力で担当'],rules:[],previousQuestions:[],notes:'',experienceSkills:[baseExperienceSkills.interview],locale:'ja-JP',model,signal:deadline}))
  report.interview={bankApplied:questions.some(q=>q.bankQuestionId===bankQuestion.id),questions:questions.map(q=>({text:q.text,requirement:q.requirement,evidence:q.evidence})),duplicateCount:questions.length-new Set(questions.map(q=>q.text)).size}
  if(!questions.some(q=>q.bankQuestionId===bankQuestion.id))throw new Error('Applicable question template was not used')
  const matching=await run('matching-evidence-review',()=>cloud.assessMatchCandidates({conversationId:randomUUID(),requestId:randomUUID(),locale:'ja-JP',model,signal:deadline,onClientRequestId:()=>{},onRemoteSettled:()=>{},jobCase:{title:'API開発',requirements:[{key:'required_skills',label:'必須',value:'Java API実装、基本設計を独力で担当'}],experienceSkills:[baseExperienceSkills.matching]},candidates:[{label:'CANDIDATE_1',facts:profile.fields,projects:profile.projectExperiences,hardFilters:[]}]}))
  if(matching.assessments.length!==1||!matching.assessments[0]!.met.some(m=>m.requirement.includes('Java'))||!matching.assessments[0]!.confirm.some(c=>c.includes('基本設計'))||matching.assessments[0]!.fit==='strong')throw new Error('Match failed evidence and unknown boundary')
  report.matching=matching
  report.status='passed';report.effectiveness='Synthetic live integration verified; no claim of production hiring improvement'
} catch(error) {
  report.status='blocked';report.error=error instanceof Error?error.message:'Verification failed'
  process.exitCode=1
} finally {
  report.finishedAt=new Date().toISOString();await mkdir(resolve(root,'output/system-experience'),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');await writeFile(reportPath.replace('live-report.json',`live-${String(report.startedAt).replace(/[:.]/g,'-')}.json`),JSON.stringify(report,null,2)+'\n')
  repository.close();await rm(directory,{recursive:true,force:true})
  console.log('[experience-live-result]',JSON.stringify({status:report.status,calls:report.calls,reportPath,error:report.error??null}))
  app.exit(report.status==='passed'?0:1)
}

}
void main().catch(error=>{console.error("[experience-live] startup failed",error instanceof Error?error.message:"unknown");app.exit(1)})
