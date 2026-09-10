import { defaultAgentChatModelKey, resolveAgentChatModel } from '@agent'
import { introductionIdentifierCheckText, regenerateIntroductionInputSchema, type RegenerateIntroductionInput } from '@shared'
import { detectDirectIdentifiers } from '@privacy'
import type { MainIpcContext } from './ipc/context'

export function createIntroductionGenerator(context: Pick<MainIpcContext, 'repository' | 'agentNarrativeStreamer' | 'agentChatModelCatalog'>) {
  const active = new Map<string, Promise<{ text: string }>>()
  return (raw: RegenerateIntroductionInput) => {
    const input = regenerateIntroductionInputSchema.parse(raw)
    const key = `${input.kind}:${input.id}`
    if (active.has(key)) return active.get(key)!
    const load = () => {
      const person = input.kind === 'person' ? context.repository.getCurrentCandidateProfile(input.id) : null
      const job = input.kind === 'case' ? context.repository.getJobCaseReview(input.id) : input.caseContext ? context.repository.getJobCaseReview(input.caseContext.reviewId) : null
      if (input.kind === 'person' && (!person || person.profileVersion !== input.version)) throw new Error('人员资料已更新，请重新打开介绍。')
      if ((input.kind === 'case' || input.caseContext) && (!job || job.lifecycle !== 'active' || job.jobCase?.version !== (input.kind === 'case' ? input.version : input.caseContext?.version))) throw new Error('案件资料已更新，请重新打开介绍。')
      return JSON.stringify({ task: input.kind === 'case' ? 'Introduce this job opening' : 'Introduce this person, referring to the case if provided',
        person: person ? { fields: person.fields, projects: person.projectExperiences, ownCompany: person.isOwnCompany } : null,
        job: job ? job.fields.map(({ key, value }) => ({ key, value })) : null })
    }
    const promise = (async () => {
      const projection = load()
      if (!context.agentNarrativeStreamer) throw new Error('请先连接云端 AI。')
      const generated = await context.agentNarrativeStreamer.regenerateIntroduction({ projection, lang: input.lang, style: input.style,
        model: resolveAgentChatModel(context.agentChatModelCatalog, defaultAgentChatModelKey), signal: AbortSignal.timeout(60_000) })
      if (load() !== projection) throw new Error('生成期间资料已更新，原文案已保留，请重试。')
      // Masked tokens and explicitly unknown eligibility contain no identity.
      const text = generated.replace(/<(?:[A-Z_]+)_\d{3}>/gu, input.lang === 'ja' ? '要確認' : '待确认')
      const contactIdentifiers = detectDirectIdentifiers(introductionIdentifierCheckText(text))
      if (contactIdentifiers.length) throw new Error('AI 文案含有未经确认的联系信息，原文案已保留。')
      return { text }
    })().finally(() => active.delete(key))
    active.set(key, promise)
    return promise
  }
}
