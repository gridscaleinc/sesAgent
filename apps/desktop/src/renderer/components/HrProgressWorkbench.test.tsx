import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { emptyProgressEntry, type BusinessFollowUp, type CandidateReviewSnapshot, type DesktopApi, type JobCaseReviewSnapshot, type ProgressAnalysis } from '@shared'
import { UiLocaleProvider } from '../i18n'
import { HrProgressWorkbench } from './HrProgressWorkbench'
const documentId='11111111-1111-4111-8111-111111111111'
const people=[{documentId,fileName:'测试人员',fields:[],projectExperiences:[]}] as unknown as CandidateReviewSnapshot[]
const cases=Array.from({length:3},(_,i)=>({reviewId:`22222222-2222-4222-8222-${String(i).padStart(12,'0')}`,redactedSubject:`Java 案件 ${i+1}`,fields:[]})) as unknown as JobCaseReviewSnapshot[]
const row=(i:number):BusinessFollowUp=>({id:`33333333-3333-4333-8333-${String(i).padStart(12,'0')}`,documentId,reviewId:cases[i]!.reviewId,revision:1,status:'interview',note:'开始约面',nextStep:'',recordedBy:'HR',updatedAt:'2026-09-10T00:00:00Z',events:[],progress:{stage:'coordinating',rounds:[],candidateAvailability:'',clientAvailability:'',pendingConditions:[],entry:emptyProgressEntry()}})
let records:BusinessFollowUp[]
const props=()=>({target:null,reloadToken:0,people,cases,onView:vi.fn()})
const show=(options:Partial<Parameters<typeof HrProgressWorkbench>[0]>={})=>render(<UiLocaleProvider locale="zh-CN"><HrProgressWorkbench {...props()} {...options}/></UiLocaleProvider>)
const detail=()=>within(screen.getByRole('article',{name:'推进详情'}))
beforeEach(()=>{
 records=[row(0),row(1),row(2)]
 Object.defineProperty(window,'sesAgent',{configurable:true,value:{
  listBusinessFollowUps:vi.fn(async()=>records),listBusinessProgressMail:vi.fn(async()=>[]),
  advanceBusinessProgress:vi.fn(async(input)=>{const old=records.find(record=>record.reviewId===input.reviewId)!,updated={...old,revision:old.revision+1,progress:{...old.progress!}}
   if(input.action==='coordinate')updated.progress={...updated.progress,candidateAvailability:input.candidateAvailability,clientAvailability:input.clientAvailability,pendingConditions:input.pendingConditions}
   records=records.map(record=>record.id===old.id?updated:record);return updated
  }),analyzeBusinessProgress:vi.fn(),updateBusinessProgressMail:vi.fn(),draftBusinessProgressMessage:vi.fn(),openBusinessProgressEmail:vi.fn(),exportBusinessProgressCalendar:vi.fn()
 } as Partial<DesktopApi>})
})
it('keeps three cases independent, preserves drafts when switching and only saves the selected pair',async()=>{
 show();await screen.findByRole('article',{name:'推进详情'})
 fireEvent.change(detail().getByLabelText('人员可用时间'),{target:{value:'第一案 周五上午'}})
 fireEvent.click(screen.getByRole('button',{name:/Java 案件 2/}))
 expect(detail().getByLabelText('人员可用时间')).toHaveValue('')
 fireEvent.change(detail().getByLabelText('人员可用时间'),{target:{value:'第二案 周五下午'}})
 fireEvent.click(screen.getByRole('button',{name:/Java 案件 1/}))
 expect(detail().getByLabelText('人员可用时间')).toHaveValue('第一案 周五上午')
 fireEvent.click(detail().getByRole('button',{name:'保存可用时间'}))
 await waitFor(()=>expect(window.sesAgent.advanceBusinessProgress).toHaveBeenCalledTimes(1))
 expect(window.sesAgent.advanceBusinessProgress).toHaveBeenCalledWith(expect.objectContaining({documentId,reviewId:cases[0]!.reviewId,candidateAvailability:'第一案 周五上午',expectedRevision:1,action:'coordinate'}))
 await waitFor(()=>expect(detail().getByRole('button',{name:'保存可用时间'})).toBeEnabled())
 fireEvent.click(screen.getByRole('button',{name:/Java 案件 2/}))
 expect(detail().getByLabelText('人员可用时间')).toHaveValue('第二案 周五下午')
})
it('does not save AI conclusions automatically and prevents repeated cloud requests',async()=>{
 let finish!:(result:ProgressAnalysis)=>void
 vi.mocked(window.sesAgent.analyzeBusinessProgress).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 show();await screen.findByRole('article',{name:'推进详情'})
 fireEvent.click(detail().getByRole('button',{name:'反馈与 AI 整理'}));fireEvent.change(detail().getByLabelText('面试反馈或消息'),{target:{value:'一面通过，需要二面'}})
 fireEvent.click(detail().getByRole('button',{name:'AI 整理反馈'}))
 const pending=detail().getByRole('button',{name:'正在整理'});expect(pending).toBeDisabled();fireEvent.click(pending)
 expect(window.sesAgent.analyzeBusinessProgress).toHaveBeenCalledTimes(1)
 await act(async()=>finish({summary:'一面通过，需要二面',kind:'schedule',evidence:'一面通过，需要二面',roundNumber:1,result:'passed',next:'next-round',scheduledAt:null,candidateAvailability:'',clientAvailability:'',proposedTimes:[],unresolved:['架构经验'],plannedDate:null}))
 expect(detail().getByRole('button',{name:'反馈与 AI 整理'})).toHaveAttribute('aria-pressed','true')
 expect(detail().getByLabelText('本轮结果')).toHaveValue('passed')
 expect(detail().getByRole('button',{name:'保存结果，安排下一轮'})).toBeEnabled()
 expect(window.sesAgent.advanceBusinessProgress).not.toHaveBeenCalled()
})
it('retains input after an update conflict and requires using the fresh revision',async()=>{
 vi.mocked(window.sesAgent.advanceBusinessProgress).mockRejectedValueOnce(new Error('推进记录已更新'))
 const view=show();await screen.findByRole('article',{name:'推进详情'})
 fireEvent.change(detail().getByLabelText('人员可用时间'),{target:{value:'周一上午'}})
 fireEvent.click(detail().getByRole('button',{name:'保存可用时间'}))
 expect(await screen.findByRole('alert')).toHaveTextContent('推进记录已更新')
 expect(detail().getByLabelText('人员可用时间')).toHaveValue('周一上午')
 records=[{...row(0),revision:2},row(1),row(2)]
 view.rerender(<UiLocaleProvider locale="zh-CN"><HrProgressWorkbench {...props()} reloadToken={1}/></UiLocaleProvider>)
 await waitFor(()=>expect(detail().getByRole('button',{name:'保存可用时间'})).toBeDisabled())
 fireEvent.click(detail().getByRole('button',{name:'使用最新记录继续'}))
 fireEvent.click(detail().getByRole('button',{name:'保存可用时间'}))
 await waitFor(()=>expect(window.sesAgent.advanceBusinessProgress).toHaveBeenLastCalledWith(expect.objectContaining({expectedRevision:2,candidateAvailability:'周一上午'})))
})
it('requires persisted acceptance and explicit actual arrival, and lists other cases separately',async()=>{
 const first=row(0);first.progress={...first.progress!,stage:'entry',entry:{...emptyProgressEntry(),plannedDate:'2026-09-10'}};records=[first,row(1),row(2)]
 show({target:{documentId,reviewId:cases[0]!.reviewId}});await screen.findByRole('article',{name:'推进详情'})
 expect(detail().getByRole('button',{name:'确认已到岗'})).toBeDisabled()
 fireEvent.click(detail().getByLabelText('人员已接受该案件'));fireEvent.click(detail().getByLabelText('双方已确认入场条件'))
 expect(detail().getByRole('button',{name:'确认已到岗'})).toBeDisabled()
 expect(window.sesAgent.advanceBusinessProgress).not.toHaveBeenCalled()
})

it('saves free-form meeting information with no date or interviewer and preserves the text',async()=>{
 show();await screen.findByRole('article',{name:'推进详情'})
 fireEvent.change(detail().getByLabelText('面试形式'),{target:{value:'zoom'}})
 const link=detail().getByLabelText('会议链接')
 expect(link).toHaveAttribute('type','text')
 fireEvent.change(link,{target:{value:'会议号 123456，密码另发'}})
 fireEvent.change(detail().getByLabelText('安排备注'),{target:{value:'时间由双方商量'}})
 const save=detail().getByRole('button',{name:'保存面试安排'})
 expect(save).toBeEnabled()
 expect(save.closest('form')!.checkValidity()).toBe(true)
 fireEvent.click(save)
 await waitFor(()=>expect(window.sesAgent.advanceBusinessProgress).toHaveBeenCalledWith(expect.objectContaining({action:'schedule',schedule:expect.objectContaining({scheduledAt:'',interviewer:'',meetingUrl:'会议号 123456，密码另发',note:'时间由双方商量'})})))
})

it('does not expose IPC or validation JSON and retains the failed draft for retry',async()=>{
 vi.mocked(window.sesAgent.advanceBusinessProgress).mockRejectedValueOnce(new Error(`Error invoking remote method 'business:advance-progress': [ { "code": "custom", "path": [ "meetingUrl" ], "message": "会议链接必须使用 HTTPS 地址。" } ]`))
 show();await screen.findByRole('article',{name:'推进详情'})
 fireEvent.change(detail().getByLabelText('面试形式'),{target:{value:'zoom'}})
 fireEvent.change(detail().getByLabelText('会议链接'),{target:{value:'http://example.com/meeting'}})
 fireEvent.click(detail().getByRole('button',{name:'保存面试安排'}))
 expect(await screen.findByRole('alert')).toHaveTextContent('操作未完成，输入已保留，请重试。')
 expect(screen.getByRole('alert')).not.toHaveTextContent('business:advance-progress')
 expect(detail().getByLabelText('会议链接')).toHaveValue('http://example.com/meeting')
 expect(detail().getByRole('button',{name:'保存面试安排'})).toBeEnabled()
})

it('books second and third rounds directly and keeps the selected round when saving availability',async()=>{
 const initial=row(0)
 const first={id:'round-1',roundNumber:1,scheduledAt:'2099-09-11T01:00:00.000Z',durationMinutes:60,meetingMethod:'zoom',meetingUrl:'会议号 第一轮',meetingDetails:{},interviewer:'面试官',contactNote:'第一轮备注',interviewNotes:null,decision:null,unresolvedItems:[]} as unknown as NonNullable<BusinessFollowUp['progress']>['rounds'][number]
 initial.progress={...initial.progress!,stage:'scheduled',rounds:[first]};records=[initial,row(1),row(2)]
 const original=window.sesAgent.advanceBusinessProgress
 vi.mocked(window.sesAgent.advanceBusinessProgress).mockImplementation(async(input)=>{
  const old=records.find(item=>item.reviewId===input.reviewId)!
  const next={...old,revision:old.revision+1,progress:{...old.progress!}}
  if(input.action==='coordinate')Object.assign(next.progress,{candidateAvailability:input.candidateAvailability,clientAvailability:input.clientAvailability,pendingConditions:input.pendingConditions})
  if(input.action==='schedule'){
   next.progress.stage='scheduled'
   next.progress.rounds=[...old.progress!.rounds,{...first,...input.schedule,id:`round-${input.schedule.roundNumber}`,contactNote:input.schedule.note}]
  }
  records=records.map(item=>item.id===next.id?next:item);return next
 })
 show({target:{documentId,reviewId:cases[0]!.reviewId}});await screen.findByRole('article',{name:'推进详情'})
 for(const roundNumber of [2,3]){
  fireEvent.click(detail().getByRole('button',{name:'安排下一轮面试'}))
  expect(detail().getByLabelText('面试轮次')).toHaveValue(roundNumber)
  expect(detail().getByLabelText('会议链接')).toHaveValue('')
  fireEvent.change(detail().getByLabelText('面试时间（日本时间）'),{target:{value:`2099-09-${10+roundNumber}T10:00`}})
  fireEvent.change(detail().getByLabelText('人员可用时间'),{target:{value:`第${roundNumber}轮，上午`}})
  fireEvent.click(detail().getByRole('button',{name:'保存可用时间'}))
  await waitFor(()=>expect(detail().getByRole('button',{name:'保存可用时间'})).toBeEnabled())
  expect(detail().getByLabelText('面试轮次')).toHaveValue(roundNumber)
  expect(detail().getByLabelText('面试时间（日本时间）')).toHaveValue(`2099-09-${10+roundNumber}T10:00`)
  fireEvent.click(detail().getByRole('button',{name:'确认预约'}))
  await waitFor(()=>expect(detail().getByText(`${roundNumber} 面已预约`)).toBeVisible())
  expect(original).toHaveBeenLastCalledWith(expect.objectContaining({action:'schedule',schedule:expect.objectContaining({roundNumber})}))
  expect(detail().getByLabelText('面试轮次')).toHaveValue(roundNumber)
 }
 expect(records[0]!.progress!.rounds).toHaveLength(3)
 expect(records[0]!.progress!.rounds[0]).toEqual(first)
 expect(records[0]!.progress!.rounds.map(item=>item.decision)).toEqual([null,null,null])
})
