import { createIntroductionGenerator } from '../introduction-generation'
import { saveBusinessField } from '../business-field-editing'
import { businessProgressCalendar, createBusinessProgressAnalyzer, draftBusinessProgressMessage } from '../business-progress'
import { writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { ipcMain, shell, net, dialog } from 'electron'
import { gmailReplyMailbox, GmailReadClient } from '@mail'
import { candidateProfileSourceInputSchema, ipcChannels, progressMessageInputSchema } from '@shared'
import { createCasePersonnelMatcher } from '../case-personnel-matching'
import { createPersonnelCaseMatcher } from '../personnel-case-matching'
import { assertTrustedSender, type MainIpcContext } from './context'

export function registerPersonnelHandlers(context: MainIpcContext) {
  const { repository, currentOperator } = context
  const regenerate = createIntroductionGenerator(context)
  const analyzeProgress = createBusinessProgressAnalyzer(context)
  ipcMain.handle(ipcChannels.beginBusinessProgress, (event, input) => { assertTrustedSender(event); return repository.beginBusinessProgress(input, currentOperator().displayName) })
  ipcMain.handle(ipcChannels.advanceBusinessProgress, (event, input) => { assertTrustedSender(event); return repository.advanceBusinessProgress(input, currentOperator().displayName) })
  ipcMain.handle(ipcChannels.analyzeBusinessProgress, (event, input) => { assertTrustedSender(event); return analyzeProgress(input) })
  ipcMain.handle(ipcChannels.listBusinessProgressMail, (event) => { assertTrustedSender(event); return repository.listBusinessProgressMail() })
  ipcMain.handle(ipcChannels.updateBusinessProgressMail, (event, input) => { assertTrustedSender(event); return repository.updateBusinessProgressMail(input) })
  ipcMain.handle(ipcChannels.draftBusinessProgressMessage, (event, input) => { assertTrustedSender(event); return draftBusinessProgressMessage(context,input) })
  ipcMain.handle(ipcChannels.openBusinessProgressEmail, async (event, raw) => {
    assertTrustedSender(event)
    const input = progressMessageInputSchema.parse(raw)
    const draft = draftBusinessProgressMessage(context,input)
    const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/gu,(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    const url = `mailto:${encode(draft.recipient ?? '')}?subject=${encode(input.lang === 'zh' ? '面试与入场安排' : '面談・参画について')}&body=${encode(input.text ?? draft.text)}`
    if (url.length > 16000) throw new Error('消息较长，请复制后在邮件中发送。')
    await shell.openExternal(url)
    return { opened:true, recipientPrefilled:Boolean(draft.recipient) }
  })
  ipcMain.handle(ipcChannels.exportBusinessProgressCalendar, async (event, raw) => {
    assertTrustedSender(event)
    const input = z.object({ followUpId:z.string().uuid(), expectedRevision:z.number().int().positive() }).strict().parse(raw)
    const load = () => {
      const follow = repository.listBusinessFollowUps().find((row) => row.id === input.followUpId)
      if (!follow || follow.revision !== input.expectedRevision) throw new Error('面试安排已更新，请刷新后重新导出。')
      const person = repository.getCandidateReview(follow.documentId)
      const job = repository.getJobCaseReview(follow.reviewId)
      return businessProgressCalendar(follow,`${person?.localIdentity?.displayName ?? person?.fileName ?? ''} · ${job?.redactedSubject ?? ''}`)
    }
    load()
    const target = await dialog.showSaveDialog({ defaultPath:'interview.ics', filters:[{ name:'Calendar', extensions:['ics'] }] })
    if (target.canceled || !target.filePath) return { cancelled:true }
    await writeFile(target.filePath,load(),'utf8'); return { cancelled:false }
  })
  ipcMain.handle(ipcChannels.regenerateIntroduction, (event, input) => { assertTrustedSender(event); return regenerate(input) })
  ipcMain.handle(ipcChannels.saveBusinessField, (event, input) => { assertTrustedSender(event); return saveBusinessField(context, input) })
  ipcMain.handle(ipcChannels.listBusinessFollowUps, (event) => { assertTrustedSender(event); return repository.listBusinessFollowUps() })
  ipcMain.handle(ipcChannels.saveBusinessFollowUp, (event, input) => { assertTrustedSender(event); return repository.saveBusinessFollowUp(input, currentOperator().displayName) })
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
    const notify = (result: unknown) => { if (!event.sender.isDestroyed()) event.sender.send(ipcChannels.businessMatchingProgress, { kind, id, result }) }
    const promise = (kind === 'case' ? findPeople(id, { signal: controller.signal, onLocal: notify }) : findCases(id, { signal: controller.signal, onLocal: notify }))
      .finally(() => active.delete(key))
    active.set(key, { controller, owner: event.sender.id, promise })
    return promise
  }
  ipcMain.handle(ipcChannels.findPersonnelForCase, (event, raw) => match(event, 'case', raw))
  ipcMain.handle(ipcChannels.cancelBusinessMatching, (event, input) => {
    assertTrustedSender(event)
    if (!input || !['case', 'person'].includes(input.kind)) throw new Error('Invalid matching direction')
    const id = candidateProfileSourceInputSchema.parse(input.id)
    const run = active.get(`${input.kind}:${id}`)
    if (run?.owner === event.sender.id) run.controller.abort()
  })
  ipcMain.handle(ipcChannels.getBusinessFeed, (event) => { assertTrustedSender(event); return repository.getBusinessFeed() })
  ipcMain.handle(ipcChannels.markBusinessFeed, (event, input) => { assertTrustedSender(event); return repository.markBusinessFeed(input) })
  ipcMain.handle(ipcChannels.getPersonnelWorkspace, (event) => {
    assertTrustedSender(event); return repository.getPersonnelWorkspace()
  })
  ipcMain.handle(ipcChannels.savePersonnelTemplate, (event, input) => {
    assertTrustedSender(event); return repository.savePersonnelTemplate(input)
  })
  ipcMain.handle(ipcChannels.setCandidateOwnCompany, (event, input) => {
    assertTrustedSender(event)
    const profile = repository.setCandidateOwnCompany(input, currentOperator().displayName)
    return repository.getCandidateReview(profile.sourceDocumentId)
  })
  ipcMain.handle(ipcChannels.setCandidateBusinessState, (event, input) => {
    assertTrustedSender(event); return repository.setCandidateBusinessState(input, currentOperator().operatorId)
  })
  ipcMain.handle(ipcChannels.validatePersonnelMessage, (event, input) => {
    assertTrustedSender(event); return repository.validatePersonnelMessage(input)
  })
  ipcMain.handle(ipcChannels.recordPersonnelCopy, (event, input) => {
    assertTrustedSender(event); return repository.recordPersonnelCopy(input, currentOperator().operatorId)
  })
  ipcMain.handle(ipcChannels.openPersonnelEmail, async (event, raw) => {
    assertTrustedSender(event)
    const input = repository.validatePersonnelMessage(raw)
    const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    const subject = input.lang === 'ja' ? '要員のご紹介' : '人员介绍'
    let recipient = input.caseContext ? gmailReplyMailbox(repository.getCaseReplyRecipient(input.caseContext.reviewId) ?? '') : null
    if (!recipient && input.caseContext && context.googleWorkspace) {
      const source = repository.getCaseMailSource(input.caseContext.reviewId)
      try {
        const connection = await context.googleWorkspace.getState()
        if (source && connection.status === 'readonly' && connection.accountEmail === source.accountEmail) {
          const gmail = new GmailReadClient((refresh) => context.googleWorkspace!.getAccessToken(refresh), (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init))
          const message = await gmail.getMessage(source.messageId)
          recipient = gmailReplyMailbox(message.replyTo ?? message.from)
          const intake = repository.getGmailBusinessIntake(source.accountEmail, source.messageId)
          repository.saveGmailBusinessIntake({ ...source, status: 'pending', parts: {}, warnings: [], ...intake, replyTo: recipient })
        }
      } catch { /* The operator can still choose the recipient in the mail client while offline. */ }
    }
    repository.validatePersonnelMessage(raw)
    const url = `mailto:${recipient ? encode(recipient) : ''}?subject=${encode(subject)}&body=${encode(input.text)}`
    if (url.length > 16_000) throw new Error('文案过长，请使用复制。 / 長い文面はコピーをご利用ください。')
    await shell.openExternal(url)
    return { opened: true, recipientPrefilled: Boolean(recipient) }
  })
  ipcMain.handle(ipcChannels.findCasesForPersonnel, (event, raw) => match(event, 'person', raw))
}
