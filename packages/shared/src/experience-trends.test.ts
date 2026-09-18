import {expect,it} from 'vitest'
import {buildExperienceTrends,experienceOutcomes,type ExperienceOutcome} from './experience-trends'
import type {ExperienceEvent,ExperienceRun} from './system-experience'
const now=new Date('2026-09-17T00:00:00Z')
function value(id:string,recent:boolean,bad:boolean):ExperienceOutcome{return {eventId:id,at:recent?'2026-09-15T00:00:00Z':'2026-08-25T00:00:00Z',bad,run:{id,documentId:id,reviewId:id,input:{task:'introduction',context:{operatorId:'hr',locale:'zh-CN',style:'brief'}},bundle:{refs:[]}} as unknown as ExperienceRun}}
it('separates business scopes and compares independent records within explicit windows',()=>{
 const values=Array.from({length:10},(_,i)=>value(String(i),i>=5,i>=5))
 expect(buildExperienceTrends(values,'hr',now)[0]).toMatchObject({state:'declining',previous:{count:5,badRate:0},recent:{count:5,badRate:1}})
 expect(buildExperienceTrends(values,'other',now)).toEqual([])
 expect(buildExperienceTrends(values.map(v=>({...v,run:{...v.run,documentId:'same-person'}})),'hr',now)[0]!.state).toBe('insufficient')
})
it('does not score no-response, commercial outcomes or bare selection as matching quality',()=>{
 const run={...value('r',true,false).run,input:{...value('r',true,false).run.input,task:'matching'}} as ExperienceRun
 const base={id:'e',kind:'assessment-feedback',text:'有足够明确的业务反馈内容',data:{decision:'unsuitable',reason:'rate'},runIds:['r'],superseded:false,createdAt:now.toISOString()} as unknown as ExperienceEvent
 expect(experienceOutcomes([base],new Map([['r',run]]))).toEqual([])
 expect(experienceOutcomes([{...base,data:{decision:'unsuitable',reason:'evidence'}}],new Map([['r',run]]))[0]!.bad).toBe(true)
 expect(experienceOutcomes([{...base,text:''}],new Map([['r',run]]))).toEqual([])
})

it('ignores formatting-only edits without erasing programming language or numerical changes',async()=>{
 const {hasMeaningfulTextChange}=await import('./system-experience')
 expect(hasMeaningfulTextChange('请说明 Java 职责。','请说明Java职责！')).toBe(false)
 expect(hasMeaningfulTextChange('Java API.',' Java API ')).toBe(false)
 expect(hasMeaningfulTextChange('C#','C')).toBe(true)
 expect(hasMeaningfulTextChange('C++','C')).toBe(true)
 expect(hasMeaningfulTextChange('Java 1.5','Java 15')).toBe(true)
 expect(hasMeaningfulTextChange('本人负责设计','本人辅助设计')).toBe(true)
})
