import { ipcMain, shell } from 'electron'
import { ipcChannels } from '@shared'
import { createCasePersonnelMatcher } from '../case-personnel-matching'
import { createPersonnelCaseMatcher } from '../personnel-case-matching'
import { assertTrustedSender, type MainIpcContext } from './context'

export function registerPersonnelHandlers(context: MainIpcContext) {
  const { repository, currentOperator } = context
  const findPeople = createCasePersonnelMatcher(context)
  ipcMain.handle(ipcChannels.findPersonnelForCase, (event, raw) => { assertTrustedSender(event); return findPeople(raw) })
  const findCases = createPersonnelCaseMatcher(context)
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
    const url = `mailto:?subject=${encode(subject)}&body=${encode(input.text)}`
    if (url.length > 16_000) throw new Error('文案过长，请使用复制。 / 長い文面はコピーをご利用ください。')
    await shell.openExternal(url)
    return { opened: true }
  })
  ipcMain.handle(ipcChannels.findCasesForPersonnel, (event, raw) => {
    assertTrustedSender(event)
    return findCases(raw)
  })
}
