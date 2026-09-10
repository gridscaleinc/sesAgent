import { loadAgentChatModelCatalog } from '@agent'
import { describe, expect, it, vi } from 'vitest'
import { emptyProgressEntry, type BusinessFollowUp, type ProgressAnalysis } from '@shared'
import type { MainIpcContext } from './ipc/context'
import { businessProgressCalendar, createBusinessProgressAnalyzer, draftBusinessProgressMessage } from './business-progress'
const documentId='11111111-1111-4111-8111-111111111111', reviewId='22222222-2222-4222-8222-222222222222'
const follow:BusinessFollowUp={id:'33333333-3333-4333-8333-333333333333',documentId,reviewId,revision:1,status:'interview',note:'',nextStep:'',recordedBy:'hr',updatedAt:'2026-09-10T01:00:00Z',events:[],progress:{stage:'coordinating',candidateAvailability:'9/11 午後',clientAvailability:'',pendingConditions:[],rounds:[],entry:emptyProgressEntry()}}
const analysis:ProgressAnalysis={summary:'一面通过，需要二面',kind:'feedback',evidence:'一面通过，需要二面',roundNumber:1,result:'passed',next:'next-round',scheduledAt:null,candidateAvailability:'',clientAvailability:'',proposedTimes:[],unresolved:[],plannedDate:null}
function setup(){
 const repository={getCandidateReview:vi.fn(()=>({documentId,recordStatus:'active',localIdentity:{displayName:'テスト要員',email:'person@example.com'}})),getJobCaseReview:vi.fn(()=>({reviewId,redactedSubject:'Java案件',fields:[]})),listBusinessFollowUps:vi.fn(()=>[structuredClone(follow)]),getCaseReplyRecipient:vi.fn(()=>'案件担当 <reply@example.com>'),advanceBusinessProgress:vi.fn()}
 const agentNarrativeStreamer={analyzeBusinessProgress:vi.fn(async(_input:{projection:string})=>analysis)}
 return {repository,agentNarrativeStreamer,context:{repository,agentNarrativeStreamer,agentChatModelCatalog:loadAgentChatModelCatalog()} as unknown as MainIpcContext}
}
describe('interview progression assistance',()=>{
 it('only proposes structured feedback and never advances the workflow',async()=>{
  const {context,repository,agentNarrativeStreamer}=setup()
  const result=await createBusinessProgressAnalyzer(context)({documentId,reviewId,expectedRevision:1,text:'客户说：一面通过，需要二面',lang:'zh'})
  expect(result).toEqual(analysis); expect(repository.advanceBusinessProgress).not.toHaveBeenCalled()
  const projection=agentNarrativeStreamer.analyzeBusinessProgress.mock.calls[0]![0] as unknown as {projection:string}
  expect(projection.projection).not.toContain('person@example.com');expect(projection.projection).not.toContain(documentId)
 })
 it('rejects unsupported evidence and rejects stale results',async()=>{
  const {context,agentNarrativeStreamer,repository}=setup()
  agentNarrativeStreamer.analyzeBusinessProgress.mockResolvedValueOnce({...analysis,evidence:'全部通过'})
  await expect(createBusinessProgressAnalyzer(context)({documentId,reviewId,expectedRevision:1,text:'一面通过，需要二面',lang:'zh'})).rejects.toThrow(/原文/)
  agentNarrativeStreamer.analyzeBusinessProgress.mockImplementationOnce(async()=>{repository.listBusinessFollowUps.mockReturnValue([{...follow,revision:2}]);return analysis})
  await expect(createBusinessProgressAnalyzer(context)({documentId,reviewId,expectedRevision:1,text:'一面通过，需要二面',lang:'zh'})).rejects.toThrow(/更新/)
 })
 it('coalesces repeated cloud requests per pair',async()=>{
  const {context,agentNarrativeStreamer}=setup();let finish!:(value:ProgressAnalysis)=>void
  agentNarrativeStreamer.analyzeBusinessProgress.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  const analyze=createBusinessProgressAnalyzer(context),input={documentId,reviewId,expectedRevision:1,text:analysis.evidence,lang:'zh' as const}
  const first=analyze(input),second=analyze(input);expect(second).toBe(first);finish(analysis);await first;expect(agentNarrativeStreamer.analyzeBusinessProgress).toHaveBeenCalledTimes(1)
 })
 it('uses case reply recipient for client messages and preserves absence of confirmed appointments',()=>{
  const {context,repository}=setup()
  const draft=draftBusinessProgressMessage(context,{documentId,reviewId,expectedRevision:1,purpose:'appointment',recipient:'client',lang:'zh'})
  expect(draft.recipient).toBe('reply@example.com');expect(draft.text).toContain('9/11 午後');expect(draft.text).not.toContain('已确认')
  expect(draftBusinessProgressMessage(context,{documentId,reviewId,expectedRevision:1,purpose:'appointment',recipient:'person',lang:'ja'}).recipient).toBe('person@example.com')
  expect(()=>draftBusinessProgressMessage(context,{documentId,reviewId,expectedRevision:1,purpose:'entry',recipient:'person',lang:'zh'})).toThrow(/全部面试/)
  expect(repository.advanceBusinessProgress).not.toHaveBeenCalled()
 })
 it('exports stable calendar identity with duration, escaped details and a reminder',()=>{
  const round={id:'round-1',roundNumber:2,scheduledAt:'2026-09-11T01:00:00.000Z',durationMinutes:60,decision:null,contactNote:'请准备\nJava, SQL',meetingUrl:null,meetingDetails:{onsiteAddress:'東京'}}
  const value={...follow,progress:{...follow.progress!,stage:'scheduled',rounds:[round]}} as BusinessFollowUp
  const ics=businessProgressCalendar(value,'测试人员；Java案件')
  expect(ics).toContain('UID:round-1@ses-agent.local');expect(ics).toContain('DTEND:20260911T020000Z');expect(ics).toContain('TRIGGER:-PT30M');expect(ics).toContain('请准备\\nJava\\, SQL')
  expect(ics.split('\r\n').every(line=>Buffer.byteLength(line)<=73)).toBe(true)
 })
})
