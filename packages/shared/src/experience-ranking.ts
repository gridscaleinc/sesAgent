import type { RankingFeature } from './ranking-types'
export { rankingFeatureSchema, type RankingFeature } from './ranking-types'
import { experienceMatches, experienceScopeMatches, type ExperienceContext, type ExperienceInput, type ExperienceRef, type SystemExperience } from './system-experience'

export const rankingFeatureNames:Record<RankingFeature,{zh:string;ja:string}>={
  'domain-experience':{zh:'相关业务领域有实际项目依据',ja:'関連業務分野に実案件の根拠がある'},
  'project-phase':{zh:'相关项目阶段有实际担当依据',ja:'関連工程に実際の担当根拠がある'},
  'communication-responsibility':{zh:'明确记录本人沟通协调职责',ja:'本人の折衝・調整担当が明記されている'},
  'project-evidence':{zh:'相关技术有实际项目依据',ja:'関連技術に実案件の根拠がある'},
  'independent-responsibility':{zh:'相关项目明确记录本人独立职责',ja:'関連案件で本人の独立した担当が明記されている'},
  'delivery-evidence':{zh:'相关项目明确记录实际交付物',ja:'関連案件で実際の成果物が明記されている'}
}
export interface RankingRow {
  key:string;score:number;tier:number;rulePriority?:number;eligible?:boolean;context?:ExperienceContext;
  requirements:ExperienceInput['requirements'];projects:ExperienceInput['projects'];
}
export interface RankingSnapshot { target:string; pool:RankingRow[] }
export interface RankingAdjustment { amount:number; baseRank:number; rank:number; reasons:Array<{feature:RankingFeature;keyword:string;evidence:string;experience:ExperienceRef}> }
export function rankingEvidence(row:RankingRow,feature:RankingFeature,keyword:string):string|null {
  if(!experienceMatches(keyword,row.requirements))return null
  for(const project of row.projects){
    const text=[project.title,project.role??'',...project.technologies,project.summary].join('\n')
    if(!experienceMatches(keyword,[{key:'project',label:'project',value:text}]))continue
    // Unknown, planned and assisted work cannot be promoted into evidence of responsibility.
    if(/未経験|未経験者|経験なし|経験がない|未使用|未担当|没有|无经验|未参与|未负责|not (?:used|responsible)|no experience|予定|計画のみ|计划中|尚未开始|planned project/iu.test(text))continue
    if(['project-evidence','domain-experience'].includes(feature)&&project.summary.trim().length>=8)return project.summary
    const statements=[project.role??'',project.summary].flatMap(t=>t.split(/[。；;\n]/u)).filter(Boolean)
    const pattern=feature==='project-phase'?/要件定義|基本設計|詳細設計|実装|単体テスト|結合テスト|運用保守|需求分析|概要设计|详细设计|开发实施|集成测试|上线运维/iu:feature==='communication-responsibility'?/顧客折衝|顧客調整|要件ヒアリング|客户沟通|客户协调|需求访谈|stakeholder (?:communication|coordination)/iu:feature==='independent-responsibility'?/独立(?:负责|完成|承担|担当)|主担当|単独で|一人で|独力で|独立して|independently (?:led|designed|owned)/iu:/交付|納品|成果物|設計書.*(?:作成|担当)|テスト仕様書.*作成|delivered|produced/iu
    const evidence=statements.find(t=>pattern.test(t)&&(feature!=='project-phase'||/(?:担当|负责|実施|実行|作成|完成|対応)/u.test(t)&&experienceMatches(keyword,[{key:'phase',label:'phase',value:t}]))&&!/补助|辅助|协助|補助|支援|サポート|リーダーが|他者|未|ない|なし|不可|予定|希望|今後|将来|计划|打算|not |never |assisted|will |planned|intend to/iu.test(t))
    if(evidence)return evidence.trim()
  }
  return null
}
/** A bounded preference changes order only inside the same evidence/eligibility tier. */
export function rankWithExperiences(pool:RankingRow[],skills:SystemExperience[]) {
  const base=[...pool].sort((a,b)=>a.tier-b.tier||(b.rulePriority??0)-(a.rulePriority??0)||b.score-a.score||a.key.localeCompare(b.key))
  const scored=base.map((row,index)=>{
    const reasons:RankingAdjustment['reasons']=[]
    for(const skill of skills){
      if(skill.method!=='ranking'||!skill.rankingFeature||!skill.enabled||(row.eligible===false||row.tier===4||row.tier>=100)||!experienceScopeMatches(skill.scope,row.context))continue
      const evidence=rankingEvidence(row,skill.rankingFeature,skill.keyword)
      if(evidence&&!reasons.some(r=>r.feature===skill.rankingFeature))reasons.push({feature:skill.rankingFeature,keyword:skill.keyword,evidence,experience:{id:skill.id,version:skill.version}})
    }
    return {row,adjustment:{amount:Math.min(12,reasons.length*4),baseRank:index+1,rank:0,reasons} satisfies RankingAdjustment}
  }).sort((a,b)=>a.row.tier-b.row.tier||(b.row.rulePriority??0)-(a.row.rulePriority??0)||(b.row.score+b.adjustment.amount)-(a.row.score+a.adjustment.amount)||a.adjustment.baseRank-b.adjustment.baseRank)
  return scored.map((item,index)=>({...item,adjustment:{...item.adjustment,rank:index+1}}))
}
