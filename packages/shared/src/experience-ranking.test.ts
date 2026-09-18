import { expect,it } from 'vitest'
import { rankWithExperiences,rankingEvidence,type RankingRow } from './experience-ranking'
import { experienceScopeFor,type ExperienceInput,type SystemExperience } from './system-experience'
const context={operatorId:'hr',locale:'zh-CN' as const,customer:{key:'c',label:'客户'}}
const requirements=[{key:'skills',label:'技术',value:'Java'}]
const projects=[{title:'Java API',period:null,role:'开发',technologies:['Java'],summary:'本人独立负责接口设计并交付接口设计文档。'}]
const skill={id:'s',version:2,enabled:true,method:'ranking',keyword:'Java',rankingFeature:'independent-responsibility',scope:experienceScopeFor({task:'matching',context} as ExperienceInput)} as SystemExperience
const row=(key:string,score:number,own=true):RankingRow=>({key,score,tier:0,requirements,context,projects:own?projects:[]})
it('changes the order within one tier with concrete project evidence and versioned reasons',()=>{
 const ranked=rankWithExperiences([row('a',73,false),row('b',70)],[skill])
 expect(ranked.map(r=>r.row.key)).toEqual(['b','a'])
 expect(ranked[0]!.adjustment).toMatchObject({amount:4,baseRank:2,rank:1,reasons:[{experience:{id:'s',version:2},evidence:projects[0]!.summary.slice(0,-1)}]})
})
it('never promotes an unknown/conflicting candidate across a better eligibility tier',()=>{
 expect(rankWithExperiences([row('a',1,false),{...row('b',99),tier:4}],[skill])[0]!.row.key).toBe('a')
 expect(rankWithExperiences([{...row('a',1,false),tier:0},{...row('b',99),tier:2}],[skill])[0]!.row.key).toBe('a')
})
it('isolates customers/operators/languages and cannot match JavaScript or unsupported facts',()=>{
 for(const other of [{...context,operatorId:'someone'},{...context,locale:'ja-JP' as const},{...context,customer:{key:'other',label:'其他'}}])expect(rankWithExperiences([{...row('b',70),context:other}],[skill])[0]!.adjustment.amount).toBe(0)
 expect(rankingEvidence({...row('b',70),requirements:[{key:'skills',label:'技术',value:'JavaScript'}]},'independent-responsibility','Java')).toBeNull()
 for(const summary of ['本人未独立负责设计，只协助主担当。','リーダーが主担当で、本人は補助。','本人未负责 Java API，但项目交付完整。'])expect(rankingEvidence({...row('b',70),projects:[{...projects[0]!,summary}]},'independent-responsibility','Java')).toBeNull()
})
it('does not stack duplicate preferences for the same feature',()=>{
 expect(rankWithExperiences([row('b',70)],[skill,{...skill,id:'other'}])[0]!.adjustment.amount).toBe(4)
})

it('explicit HR preferences take precedence over learned preferences',()=>{
 expect(rankWithExperiences([{...row('a',69,false),rulePriority:10},row('b',70)],[skill])[0]!.row.key).toBe('a')
})

it('recognizes Japanese independent responsibility but never promotes future plans',()=>{
 const project=(summary:string)=>({...row('b',70),projects:[{...projects[0]!,summary}]})
 expect(rankingEvidence(project('Java API の設計を独立して担当した。'),'independent-responsibility','Java')).toBeTruthy()
 for(const summary of ['Java API を単独で担当予定。','今後 Java API を独力で担当したい。','打算独立负责 Java 接口设计并交付文档。']) {
  expect(rankingEvidence(project(summary),'independent-responsibility','Java')).toBeNull()
  expect(rankingEvidence(project(summary),'delivery-evidence','Java')).toBeNull()
 }
})

it('uses domain, phase and communication evidence without turning assisted or planned work into priority',()=>{
 const target={...row('b',70),requirements:[{key:'industry',label:'行业',value:'金融'},...requirements,{key:'role',label:'阶段',value:'基本設計'}],projects:[{...projects[0]!,summary:'金融業務の Java API 開発で、本人が基本設計を担当し顧客折衝を実施した。'}]}
 expect(rankingEvidence(target,'domain-experience','金融')).toBeTruthy()
 expect(rankingEvidence(target,'project-phase','基本設計')).toBeTruthy()
 expect(rankingEvidence(target,'communication-responsibility','Java')).toBeTruthy()
 const assisted={...target,projects:[{...target.projects[0]!,summary:'金融 Java の基本設計と顧客折衝を補助した。'}]}
 expect(rankingEvidence(assisted,'project-phase','基本設計')).toBeNull()
 expect(rankingEvidence(assisted,'communication-responsibility','Java')).toBeNull()
})
