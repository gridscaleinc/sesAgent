import { createHash, randomUUID } from 'node:crypto'
import { customerIdentityInputSchema, opportunityActionSchema, type CustomerIdentity, type CustomerIdentityInput, type InterviewAnswer, type InterviewAnswers, type CandidateInterviewSnapshot, type MatchingOpportunity } from '@shared'
import { DomainStore } from './base'
const clean=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase()
const hash=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex')
export function interviewAnswerSource(round:CandidateInterviewSnapshot){return {interviewId:round.id,sourceHash:hash([round.decision,round.interviewNotes,round.questionPlan.filter(q=>q.selected).map(q=>[q.id,q.text,q.requirement])]),notes:round.interviewNotes??'',questions:round.questionPlan.filter(q=>q.selected)}}
export class BusinessGrowthStore extends DomainStore {
 private owner(){return this.stores.localSettings.getLocalOperatorProfile()?.operatorId??'00000000-0000-4000-8000-000000000001'}
 customers():CustomerIdentity[]{return this.database.prepare<[string],{payload:string}>('SELECT payload FROM customer_identities WHERE owner=?').all(this.owner()).map(r=>JSON.parse(r.payload))}
 saveCustomer(raw:CustomerIdentityInput){
  const input=customerIdentityInputSchema.parse(raw),all=this.customers(),old=all.find(c=>c.id===input.id)
  if(input.id&&!old||input.expectedVersion!==(old?.version??0))throw new Error('客户记录已更新，请刷新 / 顧客情報が更新されました')
  const aliases=[...new Set([...input.aliases,...(old&&clean(old.name)!==clean(input.name)?[old.name]:[])])]
  const names=[...new Set([input.name,...aliases].map(clean))]
  if(all.some(c=>c.id!==input.id&&[c.name,...c.aliases].some(n=>names.includes(clean(n)))))throw new Error('名称已属于另一客户，请先解除原关联 / 名称が別の顧客に登録されています')
  const value:CustomerIdentity={id:old?.id??randomUUID(),owner:this.owner(),version:(old?.version??0)+1,name:input.name,aliases:aliases.filter(n=>clean(n)!==clean(input.name))}
  this.database.prepare('INSERT INTO customer_identities(id,owner,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(value.id,value.owner,JSON.stringify(value));return this.customers()
 }
 customer(name:string){const entry=this.customers().find(c=>[c.name,...c.aliases].some(n=>clean(n)===clean(name)));return {key:hash(clean(entry?.name??name)),label:entry?.name??name,...(entry?{aliasKeys:[...new Set([entry.name,...entry.aliases].map(n=>hash(clean(n))))]}:{})}}
 pendingAnswers(){return this.stores.candidateInterviews.listCandidateInterviews().filter(r=>r.interviewNotes?.trim()&&r.questionPlan.some(q=>q.selected)&&!['no-show','withdrawn'].includes(r.decision??'')).map(interviewAnswerSource).filter(source=>{
  const row=this.database.prepare<[string],{payload:string}>('SELECT payload FROM interview_answers WHERE interview_id=?').get(source.interviewId)
  return !row||JSON.parse(row.payload).sourceHash!==source.sourceHash
 }).slice(0,2)}
 answers(interviewId:string):InterviewAnswers|null{
  const round=this.stores.candidateInterviews.listCandidateInterviews().find(r=>r.id===interviewId)
  const row=this.database.prepare<[string],{payload:string}>('SELECT payload FROM interview_answers WHERE interview_id=?').get(interviewId)
  if(!round||!row)return null
  const value=JSON.parse(row.payload) as InterviewAnswers
  return value.sourceHash===interviewAnswerSource(round).sourceHash?value:null
 }
 saveAnswers(source:ReturnType<typeof interviewAnswerSource>,answers:InterviewAnswer[]){
  const round=this.stores.candidateInterviews.listCandidateInterviews().find(r=>r.id===source.interviewId)
  if(!round||interviewAnswerSource(round).sourceHash!==source.sourceHash)return false
  if(answers.some(a=>!source.questions.some(q=>q.id===a.questionId)||a.status!=='unanswered'&&(!a.quote||!source.notes.includes(a.quote))))throw new Error('回答缺少原始依据 / 回答の根拠がありません')
  const value:InterviewAnswers={interviewId:source.interviewId,sourceHash:source.sourceHash,updatedAt:new Date().toISOString(),answers}
  this.database.prepare('INSERT INTO interview_answers(interview_id,payload) VALUES(?,?) ON CONFLICT(interview_id) DO UPDATE SET payload=excluded.payload').run(source.interviewId,JSON.stringify(value));return true
 }
 pairEvidence(documentId:string,reviewId:string):import('@shared').PairInterviewEvidence[]{
  const follow=this.stores.personnel.followUps().find(f=>f.documentId===documentId&&f.reviewId===reviewId)
  if(!follow)return []
  return this.stores.candidateInterviews.listCandidateInterviews().filter(r=>r.businessFollowUpId===follow.id).flatMap(round=>this.answers(round.id)?.answers.map(a=>({...a,interviewId:round.id,roundNumber:round.roundNumber,questionText:round.questionPlan.find(q=>q.id===a.questionId)?.text??'',requirement:round.questionPlan.find(q=>q.id===a.questionId)?.requirement??''}))??[])
 }
 checkpoint(key:string){return this.database.prepare<[string],{value:string}>('SELECT value FROM growth_checkpoints WHERE key=?').get(key)?.value}
 setCheckpoint(key:string,value:string){this.database.prepare('INSERT INTO growth_checkpoints(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value)}
 opportunities(includeDismissed=false):MatchingOpportunity[]{
  const people=new Map(this.stores.candidates.listEligibleTalentProfiles().map(p=>[p.sourceDocumentId,p.profileVersion])),cases=new Map(this.stores.jobCases.listActiveJobCases().map(c=>[c.sourceReviewId,c.version])),rules=this.stores.workRules.list().revision
  const unavailable=new Set(this.stores.personnel.workspace().states.filter(s=>!['available','soon'].includes(s.status)).map(s=>s.documentId))
  const followed=new Set(this.stores.personnel.followUps().filter(f=>f.status!=='closed').map(f=>`${f.documentId}:${f.reviewId}`))
  return this.database.prepare<[],{payload:string}>('SELECT payload FROM matching_opportunities').all().map(r=>JSON.parse(r.payload) as MatchingOpportunity).filter(o=>!followed.has(`${o.documentId}:${o.reviewId}`)&&!unavailable.has(o.documentId)&&people.get(o.documentId)===o.profileVersion&&cases.get(o.reviewId)===o.jobCaseVersion&&o.rulesRevision===rules&&(includeDismissed||o.state!=='dismissed')).sort((a,b)=>b.score-a.score||b.updatedAt.localeCompare(a.updatedAt)).slice(0,100)
 }
 saveOpportunities(reviewId:string,items:Omit<MatchingOpportunity,'id'|'state'|'updatedAt'>[]){
  this.database.transaction(()=>{
   const old=this.database.prepare<[string],{id:string;payload:string}>('SELECT id,payload FROM matching_opportunities WHERE review_id=?').all(reviewId)
   for(const row of old)if(!items.some(i=>i.documentId===(JSON.parse(row.payload) as MatchingOpportunity).documentId))this.database.prepare('DELETE FROM matching_opportunities WHERE id=?').run(row.id)
   for(const item of items){const before=old.map(r=>JSON.parse(r.payload) as MatchingOpportunity).find(o=>o.documentId===item.documentId)
    if(before?.fingerprint===item.fingerprint)continue
    const value:MatchingOpportunity={...item,id:before?.id??randomUUID(),state:'new',updatedAt:new Date().toISOString()}
    this.database.prepare('INSERT INTO matching_opportunities(id,document_id,review_id,payload) VALUES(?,?,?,?) ON CONFLICT(document_id,review_id) DO UPDATE SET payload=excluded.payload').run(value.id,value.documentId,value.reviewId,JSON.stringify(value))
   }
  })()
 }
 opportunityAction(raw:unknown){const input=opportunityActionSchema.parse(raw),entry=this.opportunities(true).find(o=>o.id===input.id);if(!entry||entry.fingerprint!==input.fingerprint)throw new Error('推荐已更新，请刷新 / 推薦が更新されました');this.database.prepare('UPDATE matching_opportunities SET payload=? WHERE id=?').run(JSON.stringify({...entry,state:input.action}),entry.id);return this.opportunities()}
}
