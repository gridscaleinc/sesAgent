import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  customerIdentityInputSchema,
  opportunityActionSchema,
  questionBankQuerySchema,
  questionBankControlSchema,
  experienceControlSchema,
  experienceExposureSchema,
  ipcChannels
} from '@shared'
import { assertTrustedSender, type MainIpcContext } from './context'
export function registerSystemExperienceHandlers({ repository }: MainIpcContext) {
  ipcMain.handle(ipcChannels.listCustomerIdentities, (event) => {
    assertTrustedSender(event)
    return repository.listCustomerIdentities()
  })
  ipcMain.handle(ipcChannels.saveCustomerIdentity, (event, input) => {
    assertTrustedSender(event)
    return repository.saveCustomerIdentity(customerIdentityInputSchema.parse(input))
  })
  ipcMain.handle(ipcChannels.getInterviewAnswers, (event, id) => {
    assertTrustedSender(event)
    return repository.getInterviewAnswers(z.string().uuid().parse(id))
  })
  ipcMain.handle(ipcChannels.getPairInterviewEvidence, (event, raw) => {
    assertTrustedSender(event)
    const input = z.object({ documentId: z.string().uuid(), reviewId: z.string().uuid() }).strict().parse(raw)
    return repository.getPairInterviewEvidence(input.documentId, input.reviewId)
  })
  ipcMain.handle(ipcChannels.listMatchingOpportunities, (event) => {
    assertTrustedSender(event)
    return repository.listMatchingOpportunities()
  })
  ipcMain.handle(ipcChannels.controlMatchingOpportunity, (event, input) => {
    assertTrustedSender(event)
    return repository.controlMatchingOpportunity(opportunityActionSchema.parse(input))
  })
  ipcMain.handle(ipcChannels.getQuestionBankHistory, (event, id) => {
    assertTrustedSender(event)
    return repository.getQuestionBankHistory(z.string().uuid().parse(id))
  })
  ipcMain.handle(ipcChannels.restoreQuestionBankVersion, (event, raw) => {
    assertTrustedSender(event)
    const input = z
      .object({ id: z.string().uuid(), expectedVersion: z.number().int().positive(), version: z.number().int().positive() })
      .strict()
      .parse(raw)
    return repository.restoreQuestionBankVersion(input.id, input.expectedVersion, input.version)
  })
  ipcMain.handle(ipcChannels.listQuestionBank, (event, input) => {
    assertTrustedSender(event)
    return repository.listQuestionBank(questionBankQuerySchema.parse(input ?? {}))
  })
  ipcMain.handle(ipcChannels.controlQuestionBank, (event, input) => {
    assertTrustedSender(event)
    return repository.controlQuestionBank(questionBankControlSchema.parse(input))
  })
  ipcMain.handle(ipcChannels.getSystemExperience, (event) => {
    assertTrustedSender(event)
    return repository.getSystemExperience()
  })
  ipcMain.handle(ipcChannels.controlSystemExperience, (event, input) => {
    assertTrustedSender(event)
    return repository.controlSystemExperience(experienceControlSchema.parse(input))
  })
  ipcMain.handle(ipcChannels.getSystemExperienceDetails, (event, id) => {
    assertTrustedSender(event)
    return repository.getSystemExperienceDetails(z.string().uuid().parse(id))
  })
  ipcMain.handle(ipcChannels.recordExperienceExposure, (event, input) => {
    assertTrustedSender(event)
    repository.recordExperienceExposure(experienceExposureSchema.parse(input))
  })
}
