import {expect,it} from 'vitest'
import {randomUUID} from 'node:crypto'
import {validateInterviewAnswers} from './interview-answer-analysis'
const id=randomUUID(),other=randomUUID(),source={notes:'本人负责 Java API 实现，设计由组长负责。',questions:[{id,text:'请说明设计职责',selected:true,source:'match' as const,sourceLabel:'Java',requirement:'Java'}]}
it('requires exact source evidence and never interprets omission as a verified failure',()=>{
 expect(validateInterviewAnswers({answers:[]},source)[0]).toMatchObject({status:'unanswered',quote:'',remaining:'Java'})
 expect(validateInterviewAnswers({answers:[{questionId:id,status:'partial',quote:source.notes,summary:'设计职责未确认',remaining:'本人设计范围'}]},source)[0]!.status).toBe('partial')
 for(const row of [{questionId:other,status:'answered',quote:source.notes,summary:'',remaining:''},{questionId:id,status:'answered',quote:'本人负责架构设计并交付。',summary:'',remaining:''},{questionId:id,status:'unanswered',quote:source.notes,summary:'',remaining:''}])expect(()=>validateInterviewAnswers({answers:[row]},source)).toThrow()
 const row={questionId:id,status:'answered',quote:source.notes,summary:'',remaining:''}
 expect(()=>validateInterviewAnswers({answers:[row,row]},source)).toThrow()
})

it('supports saved legacy question identifiers without accepting unknown questions',()=>{
 const legacy={...source,questions:[{...source.questions[0]!,id:'standard-1'}]}
 const answer={questionId:'standard-1',status:'partial',quote:source.notes,summary:'',remaining:'独立设计职责'}
 expect(validateInterviewAnswers({answers:[answer]},legacy)[0]?.questionId).toBe('standard-1')
 expect(()=>validateInterviewAnswers({answers:[{...answer,questionId:'standard-2'}]},legacy)).toThrow()
})

it('aliases legacy IDs before model calls and restores only request-bound aliases',async()=>{
 const {AgentCloudNarrativeService}=await import('./agent-cloud-narrative')
 const service=Object.create(AgentCloudNarrativeService.prototype) as InstanceType<typeof AgentCloudNarrativeService>
 let returnOriginal=false
 Object.defineProperty(service,'invokeCloud',{value:async(input:{projection:string})=>{
  const projected=JSON.parse(input.projection)
  expect(projected.questions[0].id).toMatch(/^[a-f-]+4[a-f-]+$/)
  expect(input.projection).not.toContain('standard-1')
  return {mappings:[],result:{content:JSON.stringify({answers:[{questionId:returnOriginal?'standard-1':projected.questions[0].id,status:'partial',quote:source.notes,summary:'',remaining:'独立设计职责'}]})}}
 }})
 const input={source:{...source,questions:[{...source.questions[0]!,id:'standard-1'}]},model:{} as Parameters<typeof service.analyzeInterviewAnswers>[0]['model'],signal:new AbortController().signal}
 expect((await service.analyzeInterviewAnswers(input))[0]?.questionId).toBe('standard-1')
 returnOriginal=true
 await expect(service.analyzeInterviewAnswers(input)).rejects.toThrow()
})
