import {registerPersonnelHandlers} from '../apps/desktop/src/main/ipc/personnel'
import {registerSystemExperienceHandlers} from '../apps/desktop/src/main/ipc/system-experience'
import {ipcChannels} from '@shared'
import {app,BrowserWindow,protocol,ipcMain} from 'electron'
import {registerWorkRuleHandlers} from '../apps/desktop/src/main/ipc/work-rules'
import assert from 'node:assert/strict'
import {randomBytes,randomUUID} from 'node:crypto'
import {mkdtemp,rm,readdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import Database from 'better-sqlite3-multiple-ciphers'
import * as XLSX from 'xlsx'
import {EncryptedApplicationRepository} from '@persistence'
import {EncryptedFileVault} from '@files'
import {ParserWorkerClient} from '@parsers/worker-client'
import {loadAgentChatModelCatalog} from '@agent'
import {importStagedResumeLocally} from '../apps/desktop/src/main/local-resume-analysis'
import {importChatPastedJobCaseText} from '../apps/desktop/src/main/business-text-intake'
import {createPersonnelCaseMatcher} from '../apps/desktop/src/main/personnel-case-matching'
import {createCasePersonnelMatcher} from '../apps/desktop/src/main/case-personnel-matching'

protocol.registerSchemesAsPrivileged([{scheme:'ses-agent',privileges:{standard:true,secure:true}}])
const timeout=setTimeout(()=>{console.error('Case resume verification timed out');app.exit(1)},60000)
app.whenReady().then(async()=>{
const dir=await mkdtemp(join(tmpdir(),'ses-case-resume-'))
const options={path:join(dir,'test.db'),databaseKey:randomBytes(32),mappingKey:randomBytes(32)}
const repository=new EncryptedApplicationRepository(options)
const fileVault=new EncryptedFileVault({directory:join(dir,'vault'),key:randomBytes(32)})
const parserWorker=new ParserWorkerClient({workerPath:resolve('out/main/parser-worker.js'),timeoutMs:15000})
const ctx={repository,fileVault,parserWorker,localOcr:null,localNer:null}
const book=XLSX.utils.book_new()
XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['氏名','検証担当'],['スキル','Java、Spring Boot'],['経歴','Java APIの実装・単体テストを担当'],['','A.現地人と同じレベル B.スムーズ対応可 C.ゆっくり対応可 D.初学者'],['','読む','書く','会話'],['日本語','C','B','C']]),'スキルシート')
const bytes=Buffer.from(XLSX.write(book,{type:'buffer',bookType:'xlsx'}))
async function upload(name:string){const record=await fileVault.stageBytes(name,bytes);repository.saveStagedFiles([record]);return importStagedResumeLocally(ctx,record)}
try{
 const id=await upload('fixture.xlsx')
 assert.ok(repository.getCurrentCandidateProfile(id),'new resume is immediately usable')
 assert.match(repository.getCurrentCandidateProfile(id)!.fields.find(f=>f.key==='japanese_level')!.value!, /会話 C（ゆっくり対応可）/)
 const draft=(await importChatPastedJobCaseText(ctx,'案件名：Java評価検証\n必須スキル：Java\n勤務形態：週3出勤\n開始：9月～長期')).review
 const job=repository.confirmJobCaseReview({reviewId:draft.reviewId,reviewRevision:draft.reviewRevision,privacyReviewed:true,fields:draft.fields.map(f=>({key:f.key,value:f.value,confirmed:true,changeReason:'fixture'}))},'fixture','HR')
 let proposalCloudCalls=0
 const cloud={regenerateIntroduction:async(input:{projection:string})=> {proposalCloudCalls++;return JSON.parse(input.projection).customerMailTemplate.replace('■案件とのマッチポイント','■案件とのマッチポイント\n・Javaを用いたシステム開発・テストの経験があり、本案件のJava要件に関連する実務経験があります。')},assessMatchCandidates:async()=>({assessments:[{candidate:'CANDIDATE_1',fit:'possible' as const,met:[{requirement:'Java',evidence:'Java'}],gaps:[],confirm:['本人の設計担当範囲'],reason:'Java の記録を確認。設計担当範囲は要確認。'}]}),cancel:async()=>({}),generateRuleQuestions:async()=>[{id:randomUUID(),text:'请说明本人负责的 Java 设计。',source:'match' as const,sourceLabel:'Java',selected:true,requirement:'Java',scoringGuide:'核对本人职责及原文依据。'}]}
 const matchingContext={repository,agentNarrativeStreamer:cloud as never,agentChatModelCatalog:loadAgentChatModelCatalog()}
 const match=createCasePersonnelMatcher(matchingContext)
 registerWorkRuleHandlers({...ctx,...matchingContext,processingResources:{run:async(_resource:string,work:()=>Promise<unknown>)=>work()},currentOperator:()=>({displayName:'HR'})} as never)
  registerPersonnelHandlers({...ctx,...matchingContext,currentOperator:()=>({displayName:'HR',operatorId:'fixture'})} as never)
 protocol.handle('ses-agent',async request=>{
  const path=new URL(request.url).pathname
  if(process.env.SES_CASE_RESUME_UI==='1'&&['/ui','/fixture.js','/fixture.css'].includes(path))return new Response(await readFile(resolve('output/case-resume-ui',path==='/ui'?'index.html':path.slice(1))),{headers:{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'}})
  return new Response('<!doctype html><html><body>Isolated case import verification</body></html>',{headers:{'Content-Type':'text/html'}})
 })
 const window=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload:resolve(process.env.SES_CASE_RESUME_UI==='1'?'output/case-resume-ui/preload.cjs':'out/preload/index.js'),contextIsolation:true,sandbox:true}})
 window.webContents.on('preload-error',(_event,_path,error)=>console.error(error.message))
 await window.loadURL('ses-agent://app/verify')
 assert.equal(await window.webContents.executeJavaScript('typeof window.sesAgent?.importResumeForCase'),'function')
 const invoke=(method:string,input:unknown)=>window.webContents.executeJavaScript(`window.sesAgent[${JSON.stringify(method)}](${JSON.stringify(input)})`) 
 const direct=(await match(job.jobCase!.id,{documentId:id})).items[0]!
 assert.equal(direct.documentId,id)
 const batch=(await match(job.jobCase!.id)).items[0]!
 const reverse=(await createPersonnelCaseMatcher(matchingContext)(id)).items[0]!
 assert.deepEqual(direct.qualification,batch.qualification,'direct assessment and case search use identical rules')
 assert.deepEqual(direct.qualification,reverse.qualification,'reverse search uses identical rules')
 const missingDraft=(await importChatPastedJobCaseText(ctx,'案件名：必須条件検証\n必須スキル：C#（ASP.NET）、基本設計～、AI\n日本語：日本語N1流暢\n勤務形態：週3出勤\n開始：9月～長期')).review
 const missingJob=repository.confirmJobCaseReview({reviewId:missingDraft.reviewId,reviewRevision:missingDraft.reviewRevision,privacyReviewed:true,fields:missingDraft.fields.map(f=>({key:f.key,value:f.key==='japanese_level'?'日本語N1流暢':f.key==='remote'?'週3出勤':f.key==='start_date'?'9月～長期':f.value,confirmed:true,changeReason:'fixture'}))},'fixture','HR')
 const rejected=(await match(missingJob.jobCase!.id,{documentId:id})).items[0]!
 assert.equal(rejected.qualification!.status,'excluded')
 assert.equal(rejected.assessment!.fit,'weak')
 assert.ok(!rejected.assessment!.confirm.some(text=>/C#|ASP.NET|基本設計|日本語/.test(text)))
 assert.ok(rejected.qualification!.requirements.some(r=>r.requirement.key==='japanese_level'&&r.outcome==='conflict'&&r.evidence?.includes('ゆっくり対応可')))
 assert.ok(rejected.qualification!.requirements.filter(r=>['start_date','remote'].includes(r.requirement.key)).every(r=>r.outcome==='unknown'))
 assert.equal((await match(missingJob.jobCase!.id)).items.length,0,'batch excludes the same unsuitable person')
 assert.ok(!(await createPersonnelCaseMatcher(matchingContext)(id)).items.some(item=>item.jobCaseId===missingJob.jobCase!.id),'reverse search excludes the same unsuitable case')
 const raw=new Database(options.path)
 raw.pragma("cipher='sqlcipher'");raw.pragma('legacy=4');raw.key(options.databaseKey)
 const legacyProfile=repository.getCurrentCandidateProfile(id)!
 legacyProfile.fields=legacyProfile.fields.map(f=>f.key==='japanese_level'?{...f,value:'読む C / 書く B / 会話 C'}:f)
 raw.prepare('UPDATE candidate_profiles SET profile_json=? WHERE source_document_id=?').run(JSON.stringify(legacyProfile),id)
 for(const profile of [repository.getCurrentCandidateProfile(id),repository.getCandidateProfileForAssessment(id),repository.listEligibleTalentProfiles()[0]]) assert.match(profile!.fields.find(f=>f.key==='japanese_level')!.value!,/会話 C（ゆっくり対応可）/,'existing imported profiles gain original grade definitions without reimport')
 raw.prepare("UPDATE candidate_records SET record_status='archived' WHERE source_document_id=?").run(id)
 assert.equal(repository.getCurrentCandidateProfile(id),null,'reproduces the old matcher lookup failure')
 const filesBefore=(await readdir(join(dir,'vault'))).length
 const requestId=randomUUID()
 await window.webContents.executeJavaScript('window.__caseProgress=[];window.sesAgent.onCaseResumeImportProgress(event=>window.__caseProgress.push(event));void 0')
 const imported=await window.webContents.executeJavaScript(`window.sesAgent.importResumeForCase({requestId:${JSON.stringify(requestId)},jobCaseId:${JSON.stringify(job.jobCase!.id)},file:{name:'renamed-fixture.xlsx',bytes:new Uint8Array(${JSON.stringify([...bytes])})}})`)
 assert.equal(imported.person.documentId,id,'duplicate archived resume is reused')
 assert.equal(imported.error,null)
 const stages=await window.webContents.executeJavaScript('window.__caseProgress')
 assert.deepEqual(stages.map((s:any)=>s.stage),['parsing','assessing'])
 assert.ok(stages.every((s:any)=>s.requestId===requestId&&s.jobCaseId===job.jobCase!.id))
 assert.ok(imported.assessment?.result.assessment)
 const retried=await invoke('assessCasePerson',{jobCaseId:job.jobCase!.id,documentId:id})
 assert.equal(retried.documentId,id)
 const questions=await invoke('generateRuleQuestions',{jobCaseId:job.jobCase!.id,documentId:id})
 assert.equal(questions.questions.length,1)
 assert.equal(questions.questions[0].matchContext.profileVersion,imported.assessment.profileVersion)
 assert.equal(repository.listCasePersonAssessments(id,job.jobCase!.id).length,2)
 const legacyAssessment={...retried,id:randomUUID(),assessedAt:new Date().toISOString(),result:{...retried.result,qualification:{...retried.result.qualification,policyVersion:'mandatory-evidence-v2',status:'needs-confirmation'}}}
 repository.saveCasePersonAssessment(legacyAssessment)
 const refreshedPolicy=(await invoke('listCaseAssessments',job.jobCase!.id))[0]
 assert.equal(refreshedPolicy.result.qualification.policyVersion,'technical-language-v3')
 assert.equal(refreshedPolicy.result.qualification.status,'recommended')
 assert.equal(refreshedPolicy.cloud.status,'unavailable')
 assert.notEqual(refreshedPolicy.id,legacyAssessment.id)
 assert.ok(repository.listCasePersonAssessments(id,job.jobCase!.id).some(item=>item.id===legacyAssessment.id),'policy refresh preserves history')
 assert.equal((await readdir(join(dir,'vault'))).length,filesBefore,'duplicate vault file is discarded')
 assert.equal(repository.listCandidateReviews().length,1)
 const assessed=await match(job.jobCase!.id,{documentId:id})
 assert.equal(assessed.items[0]?.documentId,id)
 assert.ok(assessed.items[0]?.assessment)
 assert.equal(assessed.cloud.status,'reviewed')
 assert.equal(repository.getCandidateReview(id)?.recordStatus,'archived','explicit assessment does not restore personnel')
 assert.equal(repository.listEligibleTalentProfiles().length,0)
 assert.equal((await match(job.jobCase!.id)).items.length,0,'automatic case matching still excludes archived people')
 raw.prepare("UPDATE candidate_profiles SET status='stale' WHERE source_document_id=?").run(id)
 assert.equal(repository.getCandidateProfileForAssessment(id),null)
 await assert.rejects(match(job.jobCase!.id,{documentId:id}),/人员资料不可用/)
 assert.equal((await invoke('prepareCaseAssessment',{reviewId:job.reviewId,expectedReviewRevision:job.reviewRevision})).jobCase.id,job.jobCase!.id)
 assert.equal((await invoke('listCaseAssessments',job.jobCase!.id)).length,1,'case history keeps the latest result per person')
 raw.prepare("UPDATE candidate_profiles SET status='current' WHERE source_document_id=?").run(id)
 if(process.env.SES_CASE_RESUME_UI==='1'){
  registerSystemExperienceHandlers({repository} as never)
  ipcMain.removeHandler(ipcChannels.getBusinessFeed)
  ipcMain.handle(ipcChannels.getBootstrap,()=>({jobCaseReviews:[job,missingJob],candidateReviews:repository.listCandidateReviews()}))
  ipcMain.handle(ipcChannels.getBusinessFeed,()=>[job,missingJob].map(review=>({kind:'case',objectId:review.reviewId,revision:'a'.repeat(64),title:review.fields.find(f=>f.key==='title')!.value,event:'created',occurredAt:new Date().toISOString(),sourceAt:new Date().toISOString(),source:'manual',unseen:false,deferred:false,archived:false,businessStatus:'active',needsReview:false,fields:review.fields.filter(f=>f.value).map(f=>({key:f.key,label:f.label,value:f.value})),changes:[]})))
  const errors:string[]=[]
  window.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  await window.loadURL('ses-agent://app/ui')
  const waitFor=async(expression:string)=>{for(let count=0;count<100;count++){if(await window.webContents.executeJavaScript(expression))return;await new Promise(resolve=>setTimeout(resolve,75))}throw new Error('UI condition not met: '+expression)}
  await waitFor('document.querySelectorAll(".hr-object-card").length===2')
  await window.webContents.executeJavaScript(`(()=>{const file=new File([new Uint8Array(${JSON.stringify([...bytes])})],'ui-resume.xlsx');const data=new DataTransfer();data.items.add(file);const card=Array.from(document.querySelectorAll('.hr-object-card')).find(card=>card.getAttribute('aria-label')===${JSON.stringify(job.fields.find(f=>f.key==='title')!.value)});card.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data}));card.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));})()`)
  await waitFor('document.querySelector(".case-assessment-evidence")!==null')
  assert.equal(await window.webContents.executeJavaScript('document.body.dataset.genericDrop'),undefined,'card drop never becomes a chat attachment')
  await waitFor("Array.from(document.querySelectorAll('.case-resume-next button')).some(b=>b.textContent==='生成提案文'&&!b.disabled)")
  assert.ok(await window.webContents.executeJavaScript("document.querySelector('.case-person-library').textContent.includes('已入库')"))
  await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.case-resume-next button')).find(b=>b.textContent==='生成提案文').click()")
  await waitFor("document.querySelector('.hr-introduction textarea')?.value.includes('本案件のJava要件')")
  assert.ok(proposalCloudCalls>0,'opening proposal automatically calls the cloud')
  await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.hr-introduction footer button')).find(b=>b.textContent==='安排面试').click()")
  await waitFor('Boolean(document.body.dataset.progressId)')
  assert.equal(repository.getCandidateReview(id)!.recordStatus,'archived','proposal and scheduling do not restore archived library entries')
  assert.equal(repository.listBusinessFollowUps().length,1,'archived resume can proceed within the explicit case workflow')
  raw.prepare("UPDATE candidate_records SET record_status='active' WHERE source_document_id=?").run(id)

  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="关闭人员面板"]').click()`)
  await waitFor('!document.querySelector(".case-resume-panel")')
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.hr-object-card button')).find(b=>b.textContent.includes('查看人员')).click()`)
  await waitFor('document.querySelector(".case-people-summary")!==null')
  await window.webContents.executeJavaScript(`document.querySelector('.case-people-summary').click()`)
  await waitFor('document.querySelector(".case-assessment-evidence")!==null')
  const selectedTitle=await window.webContents.executeJavaScript('document.querySelector(".case-resume-target h2").textContent')
  await window.loadURL('ses-agent://app/ui')
  await waitFor('document.querySelectorAll(".hr-object-card").length===2')
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.hr-object-card')).find(card=>card.getAttribute('aria-label')===${JSON.stringify(selectedTitle)}).querySelector('button.hr-primary').click()`)
  await waitFor('document.querySelector(".case-people-summary")!==null')
  await window.webContents.executeJavaScript(`document.querySelector('.case-people-summary').click()`)
  await waitFor('document.querySelector(".case-assessment-evidence")!==null')
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('.case-assessment-conclusion').textContent"),'可以提案')
  assert.ok(await window.webContents.executeJavaScript("document.querySelector('.business-match-evidence').textContent.includes('提案时需沟通')"))
  assert.ok(!await window.webContents.executeJavaScript("document.querySelector('.business-match-evidence').textContent.includes('有证据支持')"))
  const report=await window.webContents.executeJavaScript(`({title:document.querySelector('.case-resume-target h2').textContent,people:document.querySelectorAll('.case-people-card').length,overflow:document.documentElement.scrollWidth>innerWidth,listVisible:!!document.querySelector('.hr-object-card'),evidence:document.querySelector('.case-assessment-evidence').textContent})`)
  assert.equal(report.overflow,false);assert.ok(report.listVisible);assert.equal(report.people,1);assert.deepEqual(errors,[])
  await window.webContents.executeJavaScript(`document.querySelector('.case-people-tools button').click()`)
  await waitFor('!document.querySelector(".case-resume-progress") && document.querySelector(".case-people-coverage")!==null')
  assert.equal(await window.webContents.executeJavaScript('document.querySelectorAll(".case-people-card").length'),1,'search and imported personnel share one deduplicated card')
  const batchSaved=repository.listCaseAssessments(job.jobCase!.id)[0]!
  assert.ok(batchSaved.result.assessmentId,'batch search saves a feedback-capable assessment')
  assert.equal(batchSaved.id,batchSaved.result.assessmentId)
  await invoke('saveAssessmentFeedback',{assessmentId:batchSaved.id,decision:'suitable',reason:'evidence',note:'Synthetic unified-panel verification'})
  await writeFile(resolve('output/case-resume-ui/assessment.png'),(await window.webContents.capturePage()).toPNG())
  await window.webContents.executeJavaScript(`(()=>{const file=new File([new Uint8Array(${JSON.stringify([...bytes])})],'rejected-resume.xlsx');const data=new DataTransfer();data.items.add(file);const card=Array.from(document.querySelectorAll('.hr-object-card')).find(card=>card.getAttribute('aria-label')===${JSON.stringify(missingJob.fields.find(f=>f.key==='title')!.value)});card.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));})()`)
  await waitFor("document.querySelector('.case-assessment-conclusion')?.textContent==='不建议向本案提案'")
  assert.ok(!await window.webContents.executeJavaScript("document.querySelector('.business-match-evidence').textContent.includes('提案时需沟通')"))
  assert.ok(!await window.webContents.executeJavaScript("document.querySelector('.business-match-evidence').textContent.includes('週3出勤')"))
  assert.ok(await window.webContents.executeJavaScript("document.querySelector('.case-assessment-card').textContent.includes('已完成云端 AI 评估')"))
  await writeFile(resolve('output/case-resume-ui/rejected-assessment.png'),(await window.webContents.capturePage()).toPNG())
  await writeFile(resolve('output/case-resume-ui/report.json'),JSON.stringify({syntheticOnly:true,realRenderer:true,realDropAndIpc:true,rejectedNegotiationsHidden:true,cloudEvaluationSourceVisible:true,unifiedSearch:true,deduplicated:true,batchFeedbackSaved:true,reopenPreserved:true,historyAfterRendererReload:true,...report},null,2))
 }
 // A new case-only resume stays out of the library until HR explicitly admits it.
 const caseBook=XLSX.utils.book_new()
 XLSX.utils.book_append_sheet(caseBook,XLSX.utils.aoa_to_sheet([['氏名','案件専用担当'],['スキル','Java、Spring Boot、MySQL'],['経歴','Java APIの開発と設計を担当']]),'スキルシート')
 const caseBytes=Buffer.from(XLSX.write(caseBook,{type:'buffer',bookType:'xlsx'}))
 const importCaseOnly=()=>window.webContents.executeJavaScript(`window.sesAgent.importResumeForCase({jobCaseId:${JSON.stringify(job.jobCase!.id)},file:{name:'case-only.xlsx',bytes:new Uint8Array(${JSON.stringify([...caseBytes])})}})`)
 const caseOnly=await importCaseOnly()
 const caseId=caseOnly.person.documentId
 assert.equal(caseOnly.person.inTalentLibrary,false)
 assert.equal(caseOnly.person.recordStatus,'active')
 assert.equal(caseOnly.assessment.result.qualification.status,'recommended')
 assert.ok(!repository.listEligibleTalentProfiles().some(p=>p.sourceDocumentId===caseId))
 assert.ok(!repository.getBusinessFeed().some(p=>p.kind==='person'&&p.objectId===caseId))
 assert.equal((await importCaseOnly()).person.documentId,caseId,'case-only duplicates reuse the same record')
 assert.equal(repository.getCandidateReview(caseId)!.inTalentLibrary,false,'a repeated case drop does not admit it')
 const generation={kind:'person',id:caseId,version:caseOnly.person.profile.version,lang:'ja',style:'standard',caseContext:{reviewId:job.reviewId,version:job.jobCase!.version}}
 const generated=await invoke('regenerateIntroduction',generation)
 assert.ok(generated.text.includes('Java'))
 const template=repository.getPersonnelWorkspace().templates[0]!
 await invoke('validatePersonnelMessage',{documentId:caseId,profileVersion:caseOnly.person.profile.version,reviewRevision:caseOnly.person.reviewRevision,caseContext:generation.caseContext,templateId:template.id,templateRevision:template.revision,lang:'ja',text:generated.text,experienceRunId:generated.experienceRunId})
 const [caseProgress]=await invoke('beginBusinessProgress',[{documentId:caseId,reviewId:job.reviewId}])
 const scheduled=await invoke('advanceBusinessProgress',{documentId:caseId,reviewId:job.reviewId,expectedRevision:caseProgress.revision,mutationId:randomUUID(),action:'schedule',schedule:{roundNumber:1,scheduledAt:'2026-10-02T01:00:00.000Z',durationMinutes:60,meetingMethod:'onsite',meetingUrl:'',location:'会議室',interviewer:'HR',note:''}})
 assert.equal(scheduled.progress.rounds.length,1)
 assert.equal(repository.getCandidateReview(caseId)!.inTalentLibrary,false,'proposal and interview do not force library membership')
 await assert.rejects(invoke('addCandidateToLibrary',{documentId:caseId,profileVersion:caseOnly.person.profile.version+1}),/更新|入库/)
 if(process.env.SES_CASE_RESUME_UI==='1'){
  await window.loadURL('ses-agent://app/ui')
  const wait=async(expression:string)=>{for(let count=0;count<100;count++){if(await window.webContents.executeJavaScript(expression))return;await new Promise(resolve=>setTimeout(resolve,75))}throw new Error('UI condition not met: '+expression)}
  await wait('document.querySelectorAll(".hr-object-card").length===2')
  await window.webContents.executeJavaScript(`(()=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array(${JSON.stringify([...caseBytes])})],'case-only.xlsx'));const card=Array.from(document.querySelectorAll('.hr-object-card')).find(c=>c.getAttribute('aria-label')===${JSON.stringify(job.fields.find(f=>f.key==='title')!.value)});card.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));})()`)
  await wait("Array.from(document.querySelectorAll('.case-resume-next button')).some(b=>b.textContent==='生成提案文'&&!b.disabled)")
  await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.case-resume-next button')).find(b=>b.textContent==='生成提案文').click()")
  await wait("document.querySelector('.hr-introduction textarea')?.value.includes('本案件のJava要件')")
  assert.ok(await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.hr-introduction footer button')).some(b=>b.textContent==='安排面试'&&!b.disabled)"))
  await writeFile(resolve('output/case-resume-ui/proposal.png'),(await window.webContents.capturePage()).toPNG())
  await window.webContents.executeJavaScript("document.querySelector('[aria-label=关闭介绍]').click()")
  await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.case-person-library button')).find(b=>b.textContent==='入库').click()")
  await wait("Array.from(document.querySelectorAll('.case-people-card')).find(c=>c.classList.contains('is-expanded'))?.querySelector('.case-person-library')?.textContent.includes('已入库')")
  await writeFile(resolve('output/case-resume-ui/library-admitted.png'),(await window.webContents.capturePage()).toPNG())
 }
 const admitted=await invoke('addCandidateToLibrary',{documentId:caseId,profileVersion:caseOnly.person.profile.version})
 assert.equal(admitted.inTalentLibrary,true)
 assert.equal((await invoke('addCandidateToLibrary',{documentId:caseId,profileVersion:caseOnly.person.profile.version})).documentId,caseId,'admission is idempotent')
 assert.equal((await importCaseOnly()).person.inTalentLibrary,true,'duplicate import reflects existing library membership')
 assert.ok(repository.listEligibleTalentProfiles().some(p=>p.sourceDocumentId===caseId))
 assert.ok(repository.getBusinessFeed().some(p=>p.kind==='person'&&p.objectId===caseId))
 assert.equal(repository.listCandidateReviews().length,2,'admission never duplicates a candidate')
 const reopened=new EncryptedApplicationRepository(options)
 assert.equal(reopened.getCandidateReview(caseId)!.inTalentLibrary,true,'membership survives repository restart')
 reopened.close()
 raw.close();window.destroy()
 console.log(JSON.stringify({passed:true,syntheticOnly:true,realExcelParser:true,threeEntryPointParity:true,missingMandatoryExcluded:true,schedulingIgnored:true,japaneseLegend:true,legacyProfileEnriched:true,realImportAndRetryIpc:true,progressEvents:true,caseHistory:true,realRenderer:process.env.SES_CASE_RESUME_UI==='1',encryptedPersistence:true,newImport:true,archivedDuplicate:true,explicitAssessment:true,interviewQuestions:true,archivePreserved:true,automaticMatchingExcluded:true,staleProfileRejected:true,optionalLibraryAdmission:true,caseOnlyProposalAndInterview:true,archivedProposalAndInterview:true,admissionIdempotent:true,cloud:'test-double'}))
}finally{for(const window of BrowserWindow.getAllWindows())window.destroy();await new Promise(resolve=>setImmediate(resolve));repository.close();await rm(dir,{recursive:true,force:true});clearTimeout(timeout);app.quit()}
}).catch(error=>{console.error(error);app.exit(1)})
