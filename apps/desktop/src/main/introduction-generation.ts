import { z } from 'zod'
import { businessModel } from './business-model'
import {
  applicableWorkRules,
  baseExperienceSkills,
  generatePersonnelProposal,
  introductionIdentifierCheckText,
  regenerateIntroductionInputSchema,
  type ExperienceInput,
  type RegenerateIntroductionInput
} from '@shared'
import { detectDirectIdentifiers } from '@privacy'
import type { MainIpcContext } from './ipc/context'
import { experienceBundle, experienceContext } from './experience-context'
import { withLearningForeground } from './learning-activity'

type Context = Pick<MainIpcContext, 'repository' | 'agentNarrativeStreamer' | 'agentChatModelCatalog'>
function load(context: Context, input: RegenerateIntroductionInput) {
  const person =
    input.kind === 'person'
      ? input.caseContext
        ? context.repository.getCandidateProfileForAssessment(input.id)
        : context.repository.getCurrentCandidateProfile(input.id)
      : null
  const job =
    input.kind === 'case'
      ? context.repository.getJobCaseReview(input.id)
      : input.caseContext
        ? context.repository.getJobCaseReview(input.caseContext.reviewId)
        : null
  if (input.kind === 'person' && (!person || person.profileVersion !== input.version)) throw new Error('人员资料已更新，请重新打开介绍。')
  if (
    (input.kind === 'case' || input.caseContext) &&
    (!job || job.lifecycle !== 'active' || job.jobCase?.version !== (input.kind === 'case' ? input.version : input.caseContext?.version))
  )
    throw new Error('案件资料已更新，请重新打开介绍。')
  const library = context.repository.listWorkRules?.() ?? { revision: 0, rules: [] }
  const hrRules = applicableWorkRules(library, { id: job?.reviewId ?? input.id, fields: job?.fields ?? [] })
    .filter((rule) => rule.kind === 'presentation' || rule.kind === 'confirm')
    .map(({ clause: _, ...rule }) => rule)
  const customerMailTemplate = person
    ? generatePersonnelProposal(
        { documentId: input.id, fields: person.fields, projectExperiences: person.projectExperiences, isOwnCompany: person.isOwnCompany },
        job ?? undefined,
        input.lang,
        input.style === 'brief'
      ).text
    : undefined
  // 推荐要点 HR generated for this pair, offered only while written for the current profile and case version.
  const stored =
    person && job?.jobCase && input.kind === 'person' && input.caseContext
      ? context.repository.getRecommendationPoints?.(input.id, job.reviewId)
      : null
  const recommendationPoints =
    stored && stored.profileVersion === person?.profileVersion && stored.jobCaseVersion === job?.jobCase?.version
      ? stored.points.map(({ headline, detail, project, quote }) => ({ headline, detail, project, quote }))
      : []
  // Cloud writing needs business facts only. Keep database IDs and source metadata
  // local: UUID fragments can also resemble postal codes to the independent DLP.
  const projection = JSON.stringify({
    operatorRequest: input.request ?? null,
    customerMailTemplate,
    hrRules: hrRules.map(({ kind, text }) => ({ kind, text })),
    ...(recommendationPoints.length ? { recommendationPoints } : {}),
    task: input.kind === 'case' ? 'Introduce this job opening' : 'Introduce this person, referring to the case if provided',
    person: person
      ? {
          fields: person.fields.map(({ key, label, value }) => ({ key, label, value })),
          projects: person.projectExperiences.map(({ title, period, role, technologies, summary }) => ({
            title,
            period,
            role,
            technologies,
            summary
          })),
          ownCompany: person.isOwnCompany
        }
      : null,
    job: job ? job.fields.map(({ key, value }) => ({ key, value })) : null
  })
  const locale = input.lang === 'zh' ? 'zh-CN' : 'ja-JP'
  const requirements = [
    { key: 'purpose', label: 'purpose', value: input.kind === 'case' ? '案件介绍 / 案件紹介' : '人员介绍 / 要員紹介' },
    ...(job?.fields ?? []).flatMap((f) => (f.value ? [{ key: f.key, label: f.key, value: f.value }] : []))
  ]
  const scope = experienceContext(context.repository, job?.fields ?? [], locale, input.style)
  const snapshot: ExperienceInput = {
    task: 'introduction',
    context: scope,
    introduction: { projection, lang: input.lang, style: input.style },
    requirements,
    facts: person?.fields.flatMap((f) => (f.value ? [{ key: f.key, label: f.label, value: f.value }] : [])) ?? [],
    projects:
      person?.projectExperiences.map(({ title, period, role, technologies, summary }) => ({
        title,
        period,
        role,
        technologies,
        summary
      })) ?? [],
    hardFilters: [],
    hrRules,
    previousQuestions: [],
    notes: '',
    locale,
    ...(input.request ? { operatorRequest: input.request } : {})
  }
  return {
    customerMailTemplate,
    projection,
    snapshot,
    bundle: experienceBundle(context.repository, 'introduction', requirements, scope),
    documentId: person ? input.id : null,
    reviewId: job?.reviewId ?? null,
    profileVersion: person?.profileVersion ?? 0,
    jobCaseVersion: job?.jobCase?.version ?? null
  }
}
function validateText(text: string) {
  if (!text.trim() || text.length > 4000 || detectDirectIdentifiers(introductionIdentifierCheckText(text)).length)
    throw new Error('介绍文案含有未经确认的联系信息或长度不符合要求，原文案已保留。')
}
export function beginIntroductionDraft(context: Context, raw: RegenerateIntroductionInput & { text: string }) {
  const input = regenerateIntroductionInputSchema.extend({ text: importTextSchema }).parse(raw)
  validateText(input.text)
  const value = load(context, input)
  const experienceRunId = context.repository.saveExperienceRun({
    documentId: value.documentId,
    reviewId: value.reviewId,
    interviewId: null,
    profileVersion: value.profileVersion,
    jobCaseVersion: value.jobCaseVersion,
    rulesRevision: context.repository.listWorkRules().revision,
    input: value.snapshot,
    output: input.text,
    bundle: { task: 'introduction', instructions: [baseExperienceSkills.introduction], refs: [] },
    modelKey: null
  })
  return { text: input.text, experienceRunId, hasExperience: value.bundle.refs.length > 0 }
}
const importTextSchema = z.string().trim().min(1).max(4000)
export function createIntroductionGenerator(context: Context) {
  const active = new Map<string, Promise<{ text: string; experienceRunId?: string }>>()
  return (raw: RegenerateIntroductionInput) => {
    const input = regenerateIntroductionInputSchema.parse(raw),
      key = JSON.stringify(input)
    const existing = active.get(key)
    if (existing) return existing
    const promise = withLearningForeground(async () => {
      const value = load(context, input)
      if (!context.agentNarrativeStreamer) throw new Error('请先连接云端 AI。')
      const model = businessModel(context, 'writing')
      const generated = await context.agentNarrativeStreamer.regenerateIntroduction({
        projection: value.projection,
        experienceSkills: value.bundle.instructions,
        lang: input.lang,
        style: input.style,
        model,
        signal: AbortSignal.timeout(60_000)
      })
      if (load(context, input).projection !== value.projection) throw new Error('生成期间资料已更新，原文案已保留，请重试。')
      let text = generated.replace(/<(?:[A-Z_]+)_\d{3}>/gu, input.lang === 'ja' ? '[送信前に記入]' : '[发送前填写]')
      if (input.kind === 'person' && input.caseContext && value.customerMailTemplate) {
        const heading = input.lang === 'ja' ? '■案件とのマッチポイント' : '■与案件的匹配点'
        const section = text.split(heading)[1]?.split(/\n(?:■|詳細|何卒|详细|谢谢)/u)[0] ?? ''
        const points = section
          .split('\n')
          .filter((line) => /^[・•-]\s*\S/u.test(line))
          .slice(0, 4)
        if (
          !points.length ||
          points.some((line) => line.length < 12 || /要確認|待确认|工作方式\s*[:：]\s*無|[◎○△]|项目中的实际职责|での担当内容/u.test(line))
        )
          throw new Error('云端未返回有效的案件匹配点，原草稿已保留，请重试。')
        if (input.lang === 'ja' && points.some((line) => /项目|实际职责|具备|经验|开发|测试|设计|负责/u.test(line)))
          throw new Error('云端未按日文输出提案匹配点，请重新生成。')
        if (new Set(points.map((line) => line.replace(/^[・•-]\s*/u, '').trim())).size !== points.length)
          throw new Error('云端匹配点重复，请重新生成。')
        // Commercial and language facts are rendered locally; AI only writes the case-specific evidence section.
        const [before, after] = value.customerMailTemplate.split(heading)
        const ending = after!.slice(after!.indexOf('\n\n'))
        text = `${before}${heading}\n${points.join('\n')}${ending}`
      }
      validateText(text)
      const experienceRunId = context.repository.saveExperienceRun?.({
        documentId: value.documentId,
        reviewId: value.reviewId,
        interviewId: null,
        profileVersion: value.profileVersion,
        jobCaseVersion: value.jobCaseVersion,
        rulesRevision: context.repository.listWorkRules?.().revision ?? 0,
        input: value.snapshot,
        output: text,
        bundle: value.bundle,
        modelKey: model.key
      })
      return { text, ...(experienceRunId ? { experienceRunId } : {}) }
    }).finally(() => active.delete(key))
    active.set(key, promise)
    return promise
  }
}
