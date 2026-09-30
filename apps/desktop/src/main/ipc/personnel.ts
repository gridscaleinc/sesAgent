import { saveCaseSearchAssessments } from '../case-search-assessments'
import { beginIntroductionDraft, createIntroductionGenerator } from '../introduction-generation'
import { saveBusinessField } from '../business-field-editing'
import { businessProgressCalendar, createBusinessProgressAnalyzer, draftBusinessProgressMessage } from '../business-progress'
import { writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { detectDirectIdentifiers } from '@privacy'
import { ipcMain, shell, net, dialog } from 'electron'
import { gmailReplyMailbox, GmailReadClient } from '@mail'
import {
  advanceBusinessProgressSchema,
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
  markBusinessFeedSchema,
  personnelMessageInputSchema,
  progressMessageInputSchema,
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
import { assertTrustedSender, type MainIpcContext } from './context'

export function registerPersonnelHandlers(context: MainIpcContext) {
  const { repository, currentOperator } = context
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
    return repository.beginBusinessProgress(beginBusinessProgressSchema.parse(input), currentOperator().displayName)
  })
  ipcMain.handle(ipcChannels.advanceBusinessProgress, (event, input) => {
    assertTrustedSender(event)
    return repository.advanceBusinessProgress(advanceBusinessProgressSchema.parse(input), currentOperator().displayName)
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
    return regenerate(regenerateIntroductionInputSchema.parse(input))
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
    return repository.getPersonCaseMatchRun(candidateProfileSourceInputSchema.parse(raw))
  })
  ipcMain.handle(ipcChannels.listPersonnelCaseMatchRunSummaries, (event) => {
    assertTrustedSender(event)
    return repository.listPersonCaseMatchRunSummaries()
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
    return repository.setCandidateBusinessState(candidateBusinessStateInputSchema.parse(input), currentOperator().operatorId)
  })
  ipcMain.handle(ipcChannels.validatePersonnelMessage, (event, input) => {
    assertTrustedSender(event)
    return repository.validatePersonnelMessage(personnelMessageInputSchema.parse(input))
  })
  ipcMain.handle(ipcChannels.recordPersonnelCopy, (event, input) => {
    assertTrustedSender(event)
    return repository.recordPersonnelCopy(personnelMessageInputSchema.parse(input), currentOperator().operatorId)
  })
  ipcMain.handle(ipcChannels.openPersonnelEmail, async (event, raw) => {
    assertTrustedSender(event)
    const parsed = personnelMessageInputSchema.parse(raw)
    const input = repository.validatePersonnelMessage(parsed)
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
    repository.validatePersonnelMessage(parsed)
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
