import { caseQuestionDraftQuerySchema, interviewCapabilityRequirements, isInterviewCapabilityText } from '@shared'
import { autoConfirmJobCaseDraft } from '../business-text-intake'
import { experienceBundle, experienceContext } from '../experience-context'
import { withLearningForeground } from '../learning-activity'
import { DuplicateCandidateError } from '@persistence'
import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import { z } from 'zod'
import { defaultAgentChatModelKey, resolveAgentChatModel } from '@agent'
import { prepareCaseIntroductionInputSchema, analyzeWorkRuleInputSchema, assessCasePersonInputSchema, generateRuleQuestionsInputSchema, saveWorkRuleInputSchema, ipcChannels, type CasePersonAssessment, type WorkRulePreview } from '@shared'
import { effectiveApplicationPreferences } from '../app-defaults'
import { createCasePersonnelMatcher } from '../case-personnel-matching'
import { importStagedResumeLocally } from '../local-resume-analysis'
import { workRuleContext } from '../work-rule-matching'
import { refreshCaseAssessmentPolicy } from '../case-assessment-policy-refresh'
import { assertTrustedSender, type MainIpcContext } from './context'

export function registerWorkRuleHandlers(context: MainIpcContext) {
  const { repository, agentNarrativeStreamer: cloud, currentOperator } = context
  const previews = new Map<string, { preview: WorkRulePreview; owner: number }>()
  const model = () => resolveAgentChatModel(context.agentChatModelCatalog, defaultAgentChatModelKey)
  const find = createCasePersonnelMatcher(context)
  const assess = async (raw: unknown): Promise<CasePersonAssessment> => {
    const input = assessCasePersonInputSchema.parse(raw)
    const result = await find(input.jobCaseId, { documentId: input.documentId, withoutRules: input.withoutRules, request: input.request })
    const item = result.items[0]
    if (!item) throw new Error('资料已更新，请重新评估。 / 情報が更新されました。再評価してください。')
    const assessment: CasePersonAssessment = { id: randomUUID(), jobCaseId: input.jobCaseId, documentId: input.documentId,
      jobCaseVersion: result.jobCaseVersion, profileVersion: item.profileVersion, rulesRevision: result.rulesRevision ?? 0,
      assessedAt: new Date().toISOString(), appliedRules: item.appliedRules ?? [], result: item, cloud: result.cloud, ...(input.request ? { request: input.request } : {}) }
    if (!input.withoutRules) repository.saveCasePersonAssessment(assessment)
    return assessment
  }
  ipcMain.handle(ipcChannels.listWorkRules, (event) => { assertTrustedSender(event); return repository.listWorkRules() })
  ipcMain.handle(ipcChannels.getWorkRuleHistory, (event, id) => { assertTrustedSender(event); return repository.getWorkRuleHistory(z.string().uuid().parse(id)) })
  ipcMain.handle(ipcChannels.analyzeWorkRule, async (event, raw): Promise<WorkRulePreview> => {
    assertTrustedSender(event)
    const input = analyzeWorkRuleInputSchema.parse(raw)
    if (!cloud) throw new Error('请先连接 AI 服务，再整理规则。 / AIに接続してルールを整理してください。')
    const scope = input.scope
    if (scope.kind === 'case' && !repository.listActiveJobCases().some((job) => job.sourceReviewId === scope.value)) throw new Error('案件已更新或停用。 / 案件が更新または停止されています。')
    const selected = model()
    const analysis = await cloud.analyzeWorkRule({ text: input.text, locale: effectiveApplicationPreferences(repository).locale, model: selected, signal: AbortSignal.timeout(60_000) })
    const preview: WorkRulePreview = { ...input, ...analysis, token: randomUUID(), modelKey: selected.key, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }
    for (const [key, item] of previews) if (Date.parse(item.preview.expiresAt) <= Date.now()) previews.delete(key)
    if (previews.size >= 100) previews.delete(previews.keys().next().value!)
    previews.set(preview.token, { preview, owner: event.sender.id })
    return preview
  })
  ipcMain.handle(ipcChannels.saveWorkRule, (event, raw) => {
    assertTrustedSender(event)
    const input = saveWorkRuleInputSchema.parse(raw)
    const entry = previews.get(input.token)
    if (!entry || entry.owner !== event.sender.id || Date.parse(entry.preview.expiresAt) <= Date.now()) throw new Error('规则预览已过期，请重新整理。 / プレビューの期限が切れました。再整理してください。')
    const { preview } = entry
    if (!preview.clauses.length) throw new Error('没有可保存的规则。 / 保存できるルールがありません。')
    const saved = repository.saveWorkRule({ id: input.id, expectedRevision: input.expectedRevision, text: preview.text,
      scope: preview.scope, clauses: preview.clauses, enabled: true, modelKey: preview.modelKey, updatedBy: currentOperator().displayName })
    previews.delete(input.token)
    return saved
  })
  ipcMain.handle(ipcChannels.changeWorkRule, (event, raw) => { assertTrustedSender(event); return repository.changeWorkRule(raw, currentOperator().displayName) })
  ipcMain.handle(ipcChannels.assessCasePerson, (event, raw) => { assertTrustedSender(event); return assess(raw) })
  ipcMain.handle(ipcChannels.saveAssessmentFeedback, (event, raw) => { assertTrustedSender(event); return repository.saveAssessmentFeedback(raw, currentOperator().displayName) })
  ipcMain.handle(ipcChannels.listCasePersonAssessments, (event, raw) => {
    assertTrustedSender(event); const input = assessCasePersonInputSchema.parse(raw)
    const history = repository.listCasePersonAssessments(input.documentId, input.jobCaseId)
    if (!history[0]) return history
    const latest = refreshCaseAssessmentPolicy(repository, history[0], input.jobCaseId)
    return latest === history[0] ? history : [latest, ...history]
  })
  ipcMain.handle(ipcChannels.prepareCaseAssessment, (event, raw) => {
    assertTrustedSender(event)
    const input = prepareCaseIntroductionInputSchema.parse(raw)
    const review = repository.getJobCaseReview(input.reviewId)
    if (!review || review.lifecycle !== 'active') throw new Error('案件不可用。 / 案件が利用できません。')
    if (review.reviewRevision !== input.expectedReviewRevision) throw new Error('案件资料已更新，请重新拖入。 / 案件情報が更新されました。もう一度ドロップしてください。')
    if (review.status === 'completed' && review.jobCase) return review
    const prepared = autoConfirmJobCaseDraft(repository, review, currentOperator())
    if (!prepared.review?.jobCase) throw new Error(prepared.reason ?? '案件资料暂不可评估。 / 案件情報を評価できません。')
    return prepared.review
  })
  ipcMain.handle(ipcChannels.listCaseAssessments, (event, raw) => {
    assertTrustedSender(event)
    const jobCaseId = z.string().uuid().parse(raw)
    return repository.listCaseAssessments(jobCaseId).map(previous => refreshCaseAssessmentPolicy(repository, previous, jobCaseId))
  })
  ipcMain.handle(ipcChannels.getCaseQuestionDraft, (event, raw) => {
    assertTrustedSender(event)
    const input = caseQuestionDraftQuerySchema.parse(raw)
    const job = repository.listActiveJobCases().find((row) => input.jobCaseId ? row.id === input.jobCaseId : row.sourceReviewId === input.reviewId)
    const draft = job ? repository.getCaseQuestionDraft(input.documentId, job.id) : null
    if (!job || !draft) return { draft: null, stale: false }
    const profile = repository.getCandidateProfileForAssessment(input.documentId)
    // A draft pre-fills round one only while the person, the case and the rules are unchanged since it was generated.
    const stale = !profile || profile.profileVersion !== draft.profileVersion || job.version !== draft.jobCaseVersion || repository.listWorkRules().revision !== draft.rulesRevision
    return { draft, stale }
  })
  ipcMain.handle(ipcChannels.addCandidateToLibrary, (event, raw) => {
    assertTrustedSender(event)
    const input = z.object({ documentId: z.string().uuid(), profileVersion: z.number().int().positive() }).strict().parse(raw)
    return repository.addCandidateToLibrary(input.documentId, input.profileVersion)
  })
  ipcMain.handle(ipcChannels.importResumeForCase, async (event, raw) => {
    assertTrustedSender(event)
    const input = z.object({ requestId: z.string().uuid().optional(), jobCaseId: z.string().uuid(), file: z.object({ name: z.string().min(1).max(255), bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0 && value.byteLength <= 30 * 1024 * 1024) }).strict() }).strict().parse(raw)
    if (!repository.listActiveJobCases().some((job) => job.id === input.jobCaseId)) throw new Error('案件不可用。 / 案件が利用できません。')
    const progress = (stage: 'parsing' | 'assessing', documentId: string | null = null) => {
      if (input.requestId && !event.sender.isDestroyed()) event.sender.send(ipcChannels.caseResumeImportProgress, { requestId: input.requestId, jobCaseId: input.jobCaseId, stage, documentId })
    }
    progress('parsing')
    const record = await context.fileVault.stageBytes(input.file.name, Buffer.from(input.file.bytes))
    let documentId: string
    try {
      repository.saveStagedFiles([record])
      documentId = await context.processingResources.run('local-ai', () => importStagedResumeLocally(context, record, false))
    } catch (error) {
      // A failed extraction cannot leave a phantom personnel entry.
      if (!repository.getCandidateReview(record.token)) {
        repository.removeStagedFiles([record.token]); await context.fileVault.discardStagedFile(record)
      }
      if (error instanceof DuplicateCandidateError) documentId = error.documentId
      else throw error
    }
    // Return the imported record even if a subsequent assessment needs retry.
    const person = repository.getCandidateReview(documentId)!
    progress('assessing', documentId)
    try { return { person, assessment: await assess({ jobCaseId: input.jobCaseId, documentId }), error: null } }
    catch (error) { return { person, assessment: null, error: error instanceof Error ? error.message : String(error) } }
  })
  ipcMain.handle(ipcChannels.generateRuleQuestions, async (event, raw) => {
    assertTrustedSender(event)
    const input = generateRuleQuestionsInputSchema.parse(raw)
    if (!cloud) throw new Error('请先连接 AI 服务。 / AIに接続してください。')
    const profile = input.jobCaseId ? repository.getCandidateProfileForAssessment(input.documentId) : repository.getCurrentCandidateProfile(input.documentId)
    if (!profile) throw new Error('人员资料不可用。 / 要員情報が利用できません。')
    const interviews = repository.listCandidateInterviews()
    const interview = input.interviewId ? interviews.find((item) => item.id === input.interviewId && item.sourceDocumentId === input.documentId) : undefined
    if (input.interviewId && !interview) throw new Error('面试记录不存在。 / 面談が見つかりません。')
    const earlier = interviews.filter((item) => interview && item.sourceDocumentId === interview.sourceDocumentId && item.kind === interview.kind && item.businessFollowUpId === interview.businessFollowUpId && item.roundNumber < interview.roundNumber)
    const follow = interview?.businessFollowUpId ? repository.listBusinessFollowUps().find((item) => item.id === interview.businessFollowUpId) : undefined
    const job = follow ? repository.listActiveJobCases().find((job) => job.sourceReviewId === follow.reviewId)
      : input.jobCaseId ? repository.listActiveJobCases().find((job) => job.id === input.jobCaseId) : undefined
    if ((input.jobCaseId || follow) && (!job || input.jobCaseId && input.jobCaseId !== job.id)) throw new Error('案件与面试不一致或已停用。 / 案件と面談が一致しないか、案件が停止されています。')
    const library = repository.listWorkRules()
    const ruleContext = workRuleContext(library, job ?? { id: '', fields: [] } as never)
    const requirements = job ? interviewCapabilityRequirements(job.fields) : []
    const interviewRules = ruleContext.applied.filter(rule => ['required', 'preferred', 'interview'].includes(rule.kind) && isInterviewCapabilityText(rule.text))
    requirements.push(...interviewRules.map(rule => rule.text), ...[...(interview?.unresolvedItems ?? []), ...earlier.flatMap(item => item.unresolvedItems)].filter(isInterviewCapabilityText))
    // A selected case with no usable requirements must not silently become a resume-only interview.
    if (!job && !requirements.length) requirements.push(...profile.fields.filter(field => ['skills', 'role'].includes(field.key)).flatMap(field => field.value && isInterviewCapabilityText(field.value) ? [field.value] : []))
    const scopeContext=experienceContext(repository,job?.fields??[],effectiveApplicationPreferences(repository).locale)
    const bundle=experienceBundle(repository,'interview',requirements.map(value=>({key:'requirement',label:'requirement',value})),scopeContext)
    const bankQuestions=repository.getApplicableBankQuestions?.(requirements.map(value=>({key:'requirement',label:'requirement',value})),scopeContext)??[]
    const previousQuestions=[...earlier,...(interview?[interview]:[])].flatMap(item=>item.questionPlan.map(q=>q.text))
    const notes=[...earlier,...(interview?[interview]:[])].flatMap(item=>item.interviewNotes?[item.interviewNotes]:[]).join('\n')
    const answerContext=[...earlier,...(interview?[interview]:[])].flatMap(r=>repository.getInterviewAnswers?.(r.id)?.answers??[])
    const selectedModel=model()
    const result = await withLearningForeground(()=>cloud.generateRuleQuestions({ caseSupplied: !!job, bankQuestions,profile, requirements, rules: interviewRules, experienceSkills:bundle.instructions, request: input.request,
      previousQuestions: [...earlier, ...(interview ? [interview] : [])].flatMap((item) => item.questionPlan.map((q) => q.text)),
      notes: notes+'\n'+JSON.stringify({recordedAnswersNotIndependentlyVerified:answerContext}),
      locale: effectiveApplicationPreferences(repository).locale, model: selectedModel, signal: AbortSignal.timeout(60_000) }))
    if ((input.jobCaseId ? repository.getCandidateProfileForAssessment(input.documentId) : repository.getCurrentCandidateProfile(input.documentId))?.profileVersion !== profile.profileVersion || repository.listWorkRules().revision !== library.revision ||
      job && repository.listActiveJobCases().find((row) => row.id === job.id)?.version !== job.version) throw new Error('资料或规则已更新，请重新生成。 / 情報またはルールが更新されました。再生成してください。')
    const experienceRunId = repository.saveExperienceRun?.({documentId:input.documentId,reviewId:job?.sourceReviewId??null,interviewId:interview?.id??null,
      profileVersion:profile.profileVersion,jobCaseVersion:job?.version??null,rulesRevision:library.revision,bundle,modelKey:selectedModel.key,output:result,
      input:{task:'interview',context:scopeContext,requirements:requirements.map(value=>({key:'requirement',label:'requirement',value})),facts:profile.fields.flatMap(f=>f.value?[{key:f.key,label:f.label,value:f.value}]:[]),
        projects:profile.projectExperiences.map(({title,period,role,technologies,summary})=>({title,period,role,technologies,summary})),
        hardFilters:[],hrRules:ruleContext.applied,previousQuestions,notes,locale:effectiveApplicationPreferences(repository).locale,...(input.request?{operatorRequest:input.request}:{})}})
    const questions = result.map((q) => ({ ...q, experienceRunId, ...(job ? { matchContext: { jobCaseId: job.id, jobCaseVersion: job.version, profileVersion: profile.profileVersion, rulesRevision: library.revision } } : {}) }))
    // Case questions are kept per person and case until round one exists, so the assessment card and the follow-up share one set.
    const draft = job && (!interview || interview.roundNumber === 1) ? { id: randomUUID(), documentId: input.documentId, jobCaseId: job.id, jobCaseVersion: job.version, profileVersion: profile.profileVersion,
      rulesRevision: library.revision, experienceRunId: experienceRunId ?? null, questions, createdAt: new Date().toISOString(), supersededAt: null } : null
    if (draft) repository.saveCaseQuestionDraft?.(draft)
    return { questions, appliedRules: ruleContext.applied, rulesRevision: library.revision, draftId: draft?.id ?? null }
  })
}
