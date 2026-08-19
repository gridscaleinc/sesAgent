import { ipcMain, shell } from 'electron'
import { type WorkTask } from '@domain'
import {
  type CandidateInterviewSnapshot,
  type SubmitCandidateReviewResult,
  createCandidateInterviewRoundInputSchema,
  ipcChannels,
  openInterviewMeetingInputSchema,
  recordCandidateInterviewDecisionInputSchema,
  saveCandidateInterviewNotesInputSchema,
  saveCandidateInterviewPreparationInputSchema,
  saveCandidateInterviewScheduleInputSchema,
  submitCandidateReviewInputSchema,
  zoomMeetingUrlSchema
} from '@shared'
import { synchronizeImportTask } from '../work-task-helpers'
import { assertTrustedSender, type MainIpcContext } from './context'

/** Interview rounds, scheduling, preparation, notes, decisions and meeting links. */
export function registerInterviewHandlers(context: MainIpcContext) {
  const { repository, currentOperator } = context
  ipcMain.handle(
    ipcChannels.submitCandidateReview,
    (event, rawInput): SubmitCandidateReviewResult => {
      assertTrustedSender(event)
      const input = submitCandidateReviewInputSchema.parse(rawInput)
      const operator = currentOperator()
      const review = repository.confirmCandidateReview(input, operator.operatorId, operator.displayName)
      const updatedTasks: WorkTask[] = []
      for (const task of repository.listWorkTasks()) {
        if (!task.contextBindings.some((binding) => binding.objectType === 'staged-file' && binding.objectId === input.documentId)) {
          continue
        }
        const reconciled = synchronizeImportTask(repository, task, new Date(), operator.displayName)
        if (reconciled !== task) repository.saveWorkTask(reconciled)
        updatedTasks.push(reconciled)
      }
      return { review, updatedTasks }
    }
  )

  ipcMain.handle(
    ipcChannels.createCandidateInterviewRound,
    (event, rawInput): CandidateInterviewSnapshot => {
      assertTrustedSender(event)
      const input = createCandidateInterviewRoundInputSchema.parse(rawInput)
      const operator = currentOperator()
      return repository.createCandidateInterviewRound(input, operator.displayName)
    }
  )

  ipcMain.handle(
    ipcChannels.saveCandidateInterviewSchedule,
    (event, rawInput): CandidateInterviewSnapshot => {
      assertTrustedSender(event)
      const input = saveCandidateInterviewScheduleInputSchema.parse(rawInput)
      const operator = currentOperator()
      return repository.saveCandidateInterviewSchedule(input, operator.displayName)
    }
  )

  ipcMain.handle(
    ipcChannels.saveCandidateInterviewPreparation,
    (event, rawInput): CandidateInterviewSnapshot => {
      assertTrustedSender(event)
      const input = saveCandidateInterviewPreparationInputSchema.parse(rawInput)
      const operator = currentOperator()
      return repository.saveCandidateInterviewPreparation(input, operator.displayName)
    }
  )

  ipcMain.handle(
    ipcChannels.saveCandidateInterviewNotes,
    (event, rawInput): CandidateInterviewSnapshot => {
      assertTrustedSender(event)
      const input = saveCandidateInterviewNotesInputSchema.parse(rawInput)
      const operator = currentOperator()
      return repository.saveCandidateInterviewNotes(input, operator.displayName)
    }
  )

  ipcMain.handle(ipcChannels.openZoomMeeting, async (event, rawInput): Promise<{ opened: true }> => {
    assertTrustedSender(event)
    const input = zoomMeetingUrlSchema.parse((rawInput as { url?: unknown } | null)?.url)
    await shell.openExternal(input)
    return { opened: true }
  })

  ipcMain.handle(ipcChannels.openInterviewMeeting, async (event, rawInput): Promise<{ opened: true }> => {
    assertTrustedSender(event)
    const input = openInterviewMeetingInputSchema.parse(rawInput)
    await shell.openExternal(input.url)
    return { opened: true }
  })

  ipcMain.handle(ipcChannels.openZoomTestMeeting, async (event): Promise<{ opened: true }> => {
    assertTrustedSender(event)
    await shell.openExternal('https://zoom.us/test')
    return { opened: true }
  })

  ipcMain.handle(
    ipcChannels.recordCandidateInterviewDecision,
    (event, rawInput): CandidateInterviewSnapshot => {
      assertTrustedSender(event)
      const input = recordCandidateInterviewDecisionInputSchema.parse(rawInput)
      const operator = currentOperator()
      return repository.recordCandidateInterviewDecision(input, operator.displayName)
    }
  )
}
