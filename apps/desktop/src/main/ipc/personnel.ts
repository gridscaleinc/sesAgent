import { saveCaseSearchAssessments } from '../case-search-assessments'
import { beginIntroductionDraft, createIntroductionGenerator } from '../introduction-generation'
import { createRecommendationPointsGenerator, getRecommendationPoints } from '../recommendation-points'
import { createCommunicationPointsGenerator, getCommunicationPoints } from '../communication-points'
import { personCaseMatchSummaries, personCaseMatchView } from '../person-case-overview'
import { createRequirementDecisions } from '../requirement-decisions'
import { saveBusinessField } from '../business-field-editing'
import { businessProgressCalendar, createBusinessProgressAnalyzer, draftBusinessProgressMessage } from '../business-progress'
import { writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { detectDirectIdentifiers } from '@privacy'
import { ipcMain, shell, net, dialog } from 'electron'
import { gmailReplyMailbox, GmailReadClient } from '@mail'
import {
  advanceBusinessProgressSchema,
  decideRequirementInputSchema,
  withdrawRequirementDecisionInputSchema,
  analyzeBusinessProgressSchema,
  beginBusinessProgressSchema,
  beginIntroductionDraftInputSchema,
  savePersonnelIntroductionDraftsInputSchema,
  introductionIdentifierCheckText,
  type PersonnelIntroductionDraft,
  candidateBusinessStateInputSchema,
  candidateProfileSourceInputSchema,
  deleteBusinessFollowUpSchema,
  ipcChannels,
  isInactiveProgressStage,
  markBusinessFeedSchema,
  personnelMessageInputSchema,
  progressMessageInputSchema,
  recommendationPointsQuerySchema,
  generateRecommendationPointsInputSchema,
  generateCommunicationPointsInputSchema,
  communicationPointsQuerySchema,
  regenerateIntroductionInputSchema,
  resolvePersonnelMailUpdateSchema,
  saveBusinessFieldInputSchema,
  saveBusinessFollowUpSchema,
  savePersonnelTemplateSchema,
  setCandidateOwnCompanyInputSchema,
  setCaseWorkingSchema,
  updateBusinessProgressMailSchema
} from '@shared'
import { createCasePersonnelMatcher } from '../case-personnel-matching'
import { createPersonnelCaseMatcher } from '../personnel-case-matching'
import { rejectedByHr } from '../work-rule-matching'
import { assertTrustedSender, type MainIpcContext } from './context'

const hrRejectedMessage =
  '这个人员已被判定不满足该案件的要求，不能介绍、推荐或安排面试；如判断有变，请先在匹配中撤回「不满足」。 / この要員は案件の条件を満たさないと判断済みのため、紹介・推薦・面談の設定はできません。判断が変わった場合は、マッチング画面で「満たさない」を取り消してください。'

export function registerPersonnelHandlers(context: MainIpcContext) {
  const { repository, currentOperator } = context
  /** The repository's checks, plus HR's 不满足 for the case the text introduces the person to. */
  const validatedMessage = (input: z.infer<typeof personnelMessageInputSchema>) => {
    if (input.caseContext && rejectedByHr(repository, input.documentId, input.caseContext.reviewId)) throw new Error(hrRejectedMessage)
    return repository.validatePersonnelMessage(input)
  }
  ipcMain.handle(ipcChannels.listPersonnelMailUpdates, (event, id) => {
    assertTrustedSender(event)
    return repository.listPersonnelMailUpdates(z.string().uuid().parse(id))
  })
  ipcMain.handle(ipcChannels.resolvePersonnelMailUpdate, (event, input) => {
    assertTrustedSender(event)
    return repository.resolvePersonnelMailUpdate(resolvePersonnelMailUpdateSchema.parse(input), currentOperator().displayName)
  })
  const regenerate = createIntroductionGenerator(context)
  ipcMain.handle(ipcChannels.beginIntroductionDraft, (event, input) => {
    assertTrustedSender(event)
    return beginIntroductionDraft(context, beginIntroductionDraftInputSchema.parse(input))
  })
  const analyzeProgress = createBusinessProgressAnalyzer(context)
  ipcMain.handle(ipcChannels.beginBusinessProgress, (event, input) => {
    assertTrustedSender(event)
    // Who cannot start (不满足, 已进场, 暂停营业, an ended case) is named by the store, one by one.
    return repository.beginBusinessProgress(beginBusinessProgressSchema.parse(input), currentOperator().displayName)
  })
  ipcMain.handle(ipcChannels.advanceBusinessProgress, (event, input) => {
    assertTrustedSender(event)
    const parsed = advanceBusinessProgressSchema.parse(input)
    // A pair HR judged 不满足 is not proposed or interviewed again from any entry; recorded history stays editable.
    if (
      ['recommend', 'coordinate', 'schedule', 'rebook', 'resume', 'link-interview', 'restart'].includes(parsed.action) &&
      rejectedByHr(repository, parsed.documentId, parsed.reviewId)
    )
      throw new Error(hrRejectedMessage)
    return repository.advanceBusinessProgress(parsed, currentOperator().displayName)
  })
  ipcMain.handle(ipcChannels.listHrRejectedFollowUps, (event) => {
    assertTrustedSender(event)
    // Shown on 跟进 so a follow-up HR judged 不满足 says why it cannot move, instead of failing at every step.
    return repository
      .listBusinessFollowUps()
      .filter(
        (row) => row.progress && !isInactiveProgressStage(row.progress.stage) && rejectedByHr(repository, row.documentId, row.reviewId)
      )
      .map((row) => `${row.documentId}:${row.reviewId}`)
  })
  ipcMain.handle(ipcChannels.deleteBusinessFollowUp, (event, input) => {
    assertTrustedSender(event)
    return repository.deleteBusinessFollowUp(deleteBusinessFollowUpSchema.parse(input))
  })
  ipcMain.handle(ipcChannels.analyzeBusinessProgress, (event, input) => {
    assertTrustedSender(event)
    return analyzeProgress(analyzeBusinessProgressSchema.parse(input))
  })
  ipcMain.handle(ipcChannels.listBusinessProgressMail, (event) => {
    assertTrustedSender(event)
    return repository.listBusinessProgressMail()
  })
  ipcMain.handle(ipcChannels.updateBusinessProgressMail, (event, input) => {
    assertTrustedSender(event)
    return repository.updateBusinessProgressMail(updateBusinessProgressMailSchema.parse(input))
  })
  ipcMain.handle(ipcChannels.draftBusinessProgressMessage, (event, input) => {
    assertTrustedSender(event)
    return draftBusinessProgressMessage(context, progressMessageInputSchema.parse(input))
  })
  ipcMain.handle(ipcChannels.openBusinessProgressEmail, async (event, raw) => {
    assertTrustedSender(event)
    const input = progressMessageInputSchema.parse(raw)
    const draft = draftBusinessProgressMessage(context, input)
    const encode = (value: string) =>
      encodeURIComponent(value).replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    const url = `mailto:${encode(draft.recipient ?? '')}?subject=${encode(input.lang === 'zh' ? '面试与入场安排' : '面談・参画について')}&body=${encode(input.text ?? draft.text)}`
    if (url.length > 16000) throw new Error('消息较长，请复制后在邮件中发送。')
    await shell.openExternal(url)
    return { opened: true, recipientPrefilled: Boolean(draft.recipient) }
  })
  ipcMain.handle(ipcChannels.exportBusinessProgressCalendar, async (event, raw) => {
    assertTrustedSender(event)
    const input = z.object({ followUpId: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict().parse(raw)
    const load = () => {
      const follow = repository.listBusinessFollowUps().find((row) => row.id === input.followUpId)
      if (!follow || follow.revision !== input.expectedRevision) throw new Error('面试安排已更新，请刷新后重新导出。')
      const person = repository.getCandidateReview(follow.documentId)
      const job = repository.getJobCaseReview(follow.reviewId)
      return businessProgressCalendar(
        follow,
        `${person?.localIdentity?.displayName ?? person?.fileName ?? ''} · ${job?.redactedSubject ?? ''}`
      )
    }
    load()
    const target = await dialog.showSaveDialog({ defaultPath: 'interview.ics', filters: [{ name: 'Calendar', extensions: ['ics'] }] })
    if (target.canceled || !target.filePath) return { cancelled: true }
    await writeFile(target.filePath, load(), 'utf8')
    return { cancelled: false }
  })
  // The latest AI personnel introduction (general or for one case), kept in the encrypted database.
  ipcMain.handle(ipcChannels.savePersonnelIntroductionDrafts, (event, rawInput): PersonnelIntroductionDraft[] => {
    assertTrustedSender(event)
    const input = savePersonnelIntroductionDraftsInputSchema.parse(rawInput)
    const person = repository.getCandidateReview(input.documentId)
    const job = input.caseContext ? repository.getJobCaseReview(input.caseContext.reviewId) : null
    if (
      !person ||
      person.recordStatus === 'deleted' ||
      person.profile?.version !== input.profileVersion ||
      (input.caseContext && (job?.lifecycle !== 'active' || job.jobCase?.version !== input.caseContext.version))
    )
      throw new Error(
        '人员或案件资料已更新，本次介绍未保存，请重新生成。 / 要員または案件の情報が更新されたため紹介文を保存できませんでした。再生成してください。'
      )
    if (input.drafts.some((draft) => detectDirectIdentifiers(introductionIdentifierCheckText(draft.text)).length))
      throw new Error('介绍文案含有联系信息等个人信息，未保存。 / 紹介文に連絡先などの個人情報が含まれるため保存できません。')
    return repository.savePersonnelIntroductionDrafts(input)
  })

  // Only introductions written for the current profile (and, for a case introduction, the current case version) are offered.
  ipcMain.handle(ipcChannels.listPersonnelIntroductionDrafts, (event, rawDocumentId): PersonnelIntroductionDraft[] => {
    assertTrustedSender(event)
    const documentId = candidateProfileSourceInputSchema.parse(rawDocumentId)
    const profileVersion = repository.getCandidateReview(documentId)?.profile?.version
    if (!profileVersion) return []
    return repository.listPersonnelIntroductionDrafts(documentId).filter((draft) => {
      if (draft.profileVersion !== profileVersion) return false
      if (!draft.caseReviewId) return true
      const job = repository.getJobCaseReview(draft.caseReviewId)
      return job?.lifecycle === 'active' && job.jobCase?.version === draft.jobCaseVersion
    })
  })

  ipcMain.handle(ipcChannels.regenerateIntroduction, (event, input) => {
    assertTrustedSender(event)
    const parsed = regenerateIntroductionInputSchema.parse(input)
    // An introduction of a person for a case HR judged 不满足 could never be sent: not generated either.
    if (parsed.kind === 'person' && parsed.caseContext && rejectedByHr(repository, parsed.id, parsed.caseContext.reviewId))
      throw new Error(hrRejectedMessage)
    return regenerate(parsed)
  })
  // 推荐要点 for one person and case: generated on demand through the redacted cloud path, stored per pair.
  const generateRecommendationPoints = createRecommendationPointsGenerator(context)
  ipcMain.handle(ipcChannels.generateRecommendationPoints, (event, input) => {
    assertTrustedSender(event)
    const query = generateRecommendationPointsInputSchema.parse(input)
    if (rejectedByHr(repository, query.documentId, query.reviewId)) throw new Error(hrRejectedMessage)
    return generateRecommendationPoints(query)
  })
  ipcMain.handle(ipcChannels.getRecommendationPoints, (event, input) => {
    assertTrustedSender(event)
    return getRecommendationPoints(context, recommendationPointsQuerySchema.parse(input))
  })
  // 沟通要点 for one person and case: what to confirm with the person or the client, generated on demand like 推荐要点.
  const generateCommunicationPoints = createCommunicationPointsGenerator(context)
  ipcMain.handle(ipcChannels.generateCommunicationPoints, (event, input) => {
    assertTrustedSender(event)
    return generateCommunicationPoints(generateCommunicationPointsInputSchema.parse(input))
  })
  ipcMain.handle(ipcChannels.getCommunicationPoints, (event, input) => {
    assertTrustedSender(event)
    return getCommunicationPoints(context, communicationPointsQuerySchema.parse(input))
  })
  // HR decisions on requirements the material left unclear: 满足 / 不满足 / 问本人, applied to the stored results at once.
  const decisions = createRequirementDecisions(context)
  ipcMain.handle(ipcChannels.listRequirementConfirmations, (event, documentId) => {
    assertTrustedSender(event)
    return decisions.list(z.string().uuid().parse(documentId))
  })
  ipcMain.handle(ipcChannels.decideRequirement, (event, input) => {
    assertTrustedSender(event)
    return decisions.decide(decideRequirementInputSchema.parse(input), currentOperator().displayName || null)
  })
  ipcMain.handle(ipcChannels.withdrawRequirementDecision, (event, input) => {
    assertTrustedSender(event)
    return decisions.withdraw(withdrawRequirementDecisionInputSchema.parse(input))
  })
  ipcMain.handle(ipcChannels.saveBusinessField, (event, input) => {
    assertTrustedSender(event)
    return saveBusinessField(context, saveBusinessFieldInputSchema.parse(input))
  })
  ipcMain.handle(ipcChannels.listBusinessFollowUps, (event) => {
    assertTrustedSender(event)
    return repository.listBusinessFollowUps()
  })
  ipcMain.handle(ipcChannels.saveBusinessFollowUp, (event, input) => {
    assertTrustedSender(event)
    return repository.saveBusinessFollowUp(saveBusinessFollowUpSchema.parse(input), currentOperator().displayName)
  })
  const findPeople = createCasePersonnelMatcher(context)

  const findCases = createPersonnelCaseMatcher(context)
  const active = new Map<string, { controller: AbortController; owner: number; promise: Promise<unknown> }>()
  const match = (event: Electron.IpcMainInvokeEvent, kind: 'case' | 'person', raw: unknown) => {
    assertTrustedSender(event)
    const id = candidateProfileSourceInputSchema.parse(raw)
    const key = `${kind}:${id}`
    const existing = active.get(key)
    if (existing) return existing.promise
    const controller = new AbortController()
    const notify = (result: unknown) => {
      if (!event.sender.isDestroyed()) event.sender.send(ipcChannels.businessMatchingProgress, { kind, id, result })
    }
    const startedAt = Date.now()
    const promise = (
      kind === 'case'
        ? findPeople(id, { signal: controller.signal, onLocal: notify }).then((result) =>
            saveCaseSearchAssessments(repository, result, startedAt)
          )
        : findCases(id, { signal: controller.signal, onLocal: notify })
    ).finally(() => active.delete(key))
    active.set(key, { controller, owner: event.sender.id, promise })
    return promise
  }
  ipcMain.handle(ipcChannels.findPersonnelForCase, (event, raw) => {
    assertTrustedSender(event)
    return match(event, 'case', candidateProfileSourceInputSchema.parse(raw))
  })
  const cancelBusinessMatchingInputSchema = z.object({ kind: z.enum(['case', 'person']), id: candidateProfileSourceInputSchema }).strict()
  ipcMain.handle(ipcChannels.getPersonnelCaseMatchRun, (event, raw) => {
    assertTrustedSender(event)
    return personCaseMatchView(repository, candidateProfileSourceInputSchema.parse(raw))
  })
  ipcMain.handle(ipcChannels.listPersonnelCaseMatchRunSummaries, (event) => {
    assertTrustedSender(event)
    return personCaseMatchSummaries(repository)
  })
  ipcMain.handle(ipcChannels.cancelBusinessMatching, (event, input) => {
    assertTrustedSender(event)
    const { kind, id } = cancelBusinessMatchingInputSchema.parse(input)
    const run = active.get(`${kind}:${id}`)
    if (run?.owner === event.sender.id) run.controller.abort()
  })
  ipcMain.handle(ipcChannels.getBusinessFeed, (event) => {
    assertTrustedSender(event)
    return repository.getBusinessFeed()
  })
  ipcMain.handle(ipcChannels.markBusinessFeed, (event, input) => {
    assertTrustedSender(event)
    return repository.markBusinessFeed(markBusinessFeedSchema.parse(input))
  })
  ipcMain.handle(ipcChannels.setCaseWorking, (event, input) => {
    assertTrustedSender(event)
    return repository.setCaseWorking(setCaseWorkingSchema.parse(input), currentOperator().displayName)
  })
  ipcMain.handle(ipcChannels.getPersonnelWorkspace, (event) => {
    assertTrustedSender(event)
    return repository.getPersonnelWorkspace()
  })
  ipcMain.handle(ipcChannels.savePersonnelTemplate, (event, input) => {
    assertTrustedSender(event)
    return repository.savePersonnelTemplate(savePersonnelTemplateSchema.parse(input))
  })
  ipcMain.handle(ipcChannels.setCandidateOwnCompany, (event, input) => {
    assertTrustedSender(event)
    const profile = repository.setCandidateOwnCompany(setCandidateOwnCompanyInputSchema.parse(input), currentOperator().displayName)
    return repository.getCandidateReview(profile.sourceDocumentId)
  })
  ipcMain.handle(ipcChannels.setCandidateBusinessState, (event, input) => {
    assertTrustedSender(event)
    const parsed = candidateBusinessStateInputSchema.parse(input)
    // 已进场 follows the placement record: it is set by 确认已到岗 and ended by 记录退场, never chosen by hand.
    const placed = repository
      .listBusinessFollowUps()
      .some((row) => row.documentId === parsed.documentId && row.progress?.stage === 'started')
    // While placed HR may mark 近期可入场 ahead of the project's end (and take it back); the rest waits for 记录退场.
    if (parsed.status === 'assigned' && !placed)
      throw new Error('已进场只能在跟进中「确认已到岗」后设置。 / 参画中は対応記録で「参画開始を確認」すると設定されます。')
    if (placed && parsed.status !== 'soon' && parsed.status !== 'assigned')
      throw new Error('此人员已进场；项目结束请在跟进中记录退场。 / 参画中です。案件終了時は対応記録で退場を記録してください。')
    return repository.setCandidateBusinessState(parsed, currentOperator().operatorId)
  })
  ipcMain.handle(ipcChannels.validatePersonnelMessage, (event, input) => {
    assertTrustedSender(event)
    return validatedMessage(personnelMessageInputSchema.parse(input))
  })
  ipcMain.handle(ipcChannels.recordPersonnelCopy, (event, input) => {
    assertTrustedSender(event)
    const parsed = personnelMessageInputSchema.parse(input)
    validatedMessage(parsed)
    return repository.recordPersonnelCopy(parsed, currentOperator().operatorId)
  })
  ipcMain.handle(ipcChannels.openPersonnelEmail, async (event, raw) => {
    assertTrustedSender(event)
    const parsed = personnelMessageInputSchema.parse(raw)
    const input = validatedMessage(parsed)
    const encode = (value: string) =>
      encodeURIComponent(value).replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    const subject = input.subject ?? (input.lang === 'ja' ? '要員のご紹介' : '人员介绍')
    let recipient = input.caseContext ? gmailReplyMailbox(repository.getCaseReplyRecipient(input.caseContext.reviewId) ?? '') : null
    if (!recipient && input.caseContext && context.googleWorkspace) {
      const source = repository.getCaseMailSource(input.caseContext.reviewId)
      try {
        const connection = await context.googleWorkspace.getState()
        if (source && connection.status === 'readonly' && connection.accountEmail === source.accountEmail) {
          const gmail = new GmailReadClient(
            (refresh) => context.googleWorkspace!.getAccessToken(refresh),
            (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init)
          )
          const message = await gmail.getMessage(source.messageId)
          recipient = gmailReplyMailbox(message.replyTo ?? message.from)
          const intake = repository.getGmailBusinessIntake(source.accountEmail, source.messageId)
          repository.saveGmailBusinessIntake({ ...source, status: 'pending', parts: {}, warnings: [], ...intake, replyTo: recipient })
        }
      } catch {
        /* The operator can still choose the recipient in the mail client while offline. */
      }
    }
    validatedMessage(parsed)
    const url = `mailto:${recipient ? encode(recipient) : ''}?subject=${encode(subject)}&body=${encode(input.text)}`
    if (url.length > 16_000) throw new Error('文案过长，请使用复制。 / 長い文面はコピーをご利用ください。')
    await shell.openExternal(url)
    if (input.experienceRunId)
      repository.recordExperienceAdoption(input.experienceRunId, input.text, currentOperator().operatorId, {
        documentId: input.documentId,
        reviewId: input.caseContext?.reviewId ?? null
      })
    return { opened: true, recipientPrefilled: Boolean(recipient) }
  })
  ipcMain.handle(ipcChannels.findCasesForPersonnel, (event, raw) => {
    assertTrustedSender(event)
    return match(event, 'person', candidateProfileSourceInputSchema.parse(raw))
  })
}
