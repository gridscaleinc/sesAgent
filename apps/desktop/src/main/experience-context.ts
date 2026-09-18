import { createHash } from 'node:crypto'
import type { CandidateProfile } from '@resume'
import type { ConfirmedJobCase } from '@job-cases'
import { baseExperienceSkills, type ExperienceBundle, type ExperienceInput, type ExperienceTask, type ExperienceContext } from '@shared'
import type { EncryptedApplicationRepository } from '@persistence'
import { workRuleContext, emptyWorkRules } from './work-rule-matching'

export function experienceBundle(repository: EncryptedApplicationRepository, task: ExperienceTask, requirements: ExperienceInput['requirements'], context?: ExperienceContext): ExperienceBundle {
  return repository.getExperienceBundle?.(task,requirements,context) ?? {task,instructions:[baseExperienceSkills[task]],refs:[]}
}
export function matchingExperienceInput(profile: CandidateProfile, job: ConfirmedJobCase, locale: 'zh-CN'|'ja-JP', library=emptyWorkRules): ExperienceInput {
  const context=workRuleContext(library,job)
  return {task:'matching',requirements:[...job.fields.filter(f=>f.value && ['required_skills','preferred_skills','role','japanese_level','rate','remote','location','work_authorization','industry','notes'].includes(f.key)).map(f=>({key:f.key,label:f.label,value:f.value!})),...context.extraFields],
    facts:profile.fields.flatMap(f=>f.value?[{key:f.key,label:f.label,value:f.value}]:[]),
    projects:profile.projectExperiences.map(({title,period,role,technologies,summary})=>({title,period,role,technologies,summary})),
    hardFilters:[],hrRules:context.applied,previousQuestions:[],notes:'',locale}
}


export function experienceContext(repository: EncryptedApplicationRepository, fields: Array<{key:string;value:string|null}>, locale: 'zh-CN'|'ja-JP', style?: 'brief'|'standard'): ExperienceContext {
  const clean=(s:string)=>s.normalize('NFKC').trim().replace(/\s+/gu,' ')
  const entry=(value:string)=>({key:createHash('sha256').update(clean(value).toLowerCase()).digest('hex'),label:clean(value).slice(0,100)})
  const customer=fields.find(f=>['customer','client'].includes(f.key))?.value ?? fields.filter(f=>f.key==='notes').map(f=>f.value??'').join('\n').match(/(?:^|[\n；;])\s*(?:客户|顧客|客先|エンド(?:企業|顧客)?)\s*[:：]\s*([^\n；;]+)/u)?.[1]
  const category=fields.find(f=>f.key==='industry')?.value ?? fields.find(f=>f.key==='role')?.value
  return {operatorId:repository.getLocalOperatorProfile?.()?.operatorId ?? '00000000-0000-4000-8000-000000000001',locale,...(style?{style}:{}),...(customer?{customer:repository.resolveCustomerIdentity?.(customer)??entry(customer)}:{}),...(category?{category:entry(category)}:{})}
}
