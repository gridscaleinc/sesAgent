import { rankWithExperiences, type ExperienceInput, type RankingRow, type RankingAdjustment, type SystemExperience } from '@shared'
import type { EncryptedApplicationRepository } from '@persistence'
type Item={rulePreference?:number;score?:number|null;qualification?:{status:string};assessment?:{fit:string};ranking?:RankingAdjustment}
export function applyLearnedRanking<T extends Item>(repository:EncryptedApplicationRepository,items:T[],key:(item:T)=>string,inputs:Map<string,ExperienceInput>,enabled=true):T[] {
 const skills=enabled?(repository.getActiveSystemExperiences?.()??[]).filter(s=>s.method==='ranking'):[]
 const pool:RankingRow[]=items.map(item=>{
  const input=inputs.get(key(item))!
  const fitOrder:Record<string,number>={strong:0,possible:1,'insufficient-info':3,weak:4}
  const tier=item.qualification?.status==='excluded'?100:(item.qualification?.status==='recommended'?0:10)+(item.assessment?fitOrder[item.assessment.fit]??2:2)
  return {key:key(item),score:item.score??0,tier,rulePriority:item.rulePreference??0,eligible:item.qualification?.status!=='excluded'&&item.assessment?.fit!=='weak',context:input.context,requirements:input.requirements,projects:input.projects}
 })
 const ranked=rankWithExperiences(pool,pool.length>1?skills:[])
 const byId=new Map(items.map(item=>[key(item),item]))
 for(const {row} of ranked){const input=inputs.get(row.key);if(input)input.ranking={target:row.key,pool:ranked.slice(0,60).map(r=>r.row)}}
 return ranked.map(({row,adjustment})=>{const {ranking:_,...item}=byId.get(row.key)!;return {...item,...(adjustment.reasons.length?{ranking:adjustment}:{})} as T})
}
export function withRankingRefs(bundle:import('@shared').ExperienceBundle,ranking?:RankingAdjustment) {
 return {...bundle,refs:[...bundle.refs,...(ranking?.reasons??[]).map(r=>r.experience)].filter((r,i,all)=>all.findIndex(v=>v.id===r.id&&v.version===r.version)===i)}
}
