import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { ipcChannels, type AgentTurnEvent, type DesktopApi, type BusinessMatchingProgress, type GmailScheduledSyncCompletion } from '@shared/contracts'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const modelKeyPattern = /^[a-z0-9][a-z0-9._-]{2,119}$/u

function isStrictObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value)
}

function parseAgentTurnEvent(value: unknown): AgentTurnEvent | null {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
  if (!record || !uuidPattern.test(String(record.conversationId)) || !uuidPattern.test(String(record.requestId)) ||
    !Number.isInteger(record.sequence) || Number(record.sequence) <= 0 ||
    typeof record.modelKey !== 'string' || !modelKeyPattern.test(record.modelKey) ||
    typeof record.modelDisplayName !== 'string' || record.modelDisplayName.length < 1 || record.modelDisplayName.length > 120) return null
  const baseKeys = ['type', 'conversationId', 'requestId', 'sequence', 'modelKey', 'modelDisplayName'] as const
  if (record.type === 'started') {
    if (!isStrictObject(record, [...baseKeys, 'phase']) ||
      !['planning', 'local-tool', 'connecting-model', 'streaming', 'stopping'].includes(String(record.phase))) return null
    return record as unknown as AgentTurnEvent
  }
  if (record.type === 'delta') {
    if (!isStrictObject(record, [...baseKeys, 'text']) || typeof record.text !== 'string' || record.text.length < 1 || record.text.length > 2_000) return null
    return record as unknown as AgentTurnEvent
  }
  if (record.type === 'completed') {
    return isStrictObject(record, baseKeys) ? record as unknown as AgentTurnEvent : null
  }
  if (record.type === 'failed') {
    if (!isStrictObject(record, [...baseKeys, 'code', 'message', 'localFallbackPreserved']) ||
      typeof record.code !== 'string' || record.code.length < 1 || record.code.length > 120 ||
      typeof record.message !== 'string' || record.message.length < 1 || record.message.length > 2_000 ||
      record.localFallbackPreserved !== true) return null
    return record as unknown as AgentTurnEvent
  }
  if (record.type === 'cancelled') {
    if (!isStrictObject(record, [...baseKeys, 'cancelStatus', 'message']) ||
      ![null, 'cancel_requested', 'canceled', 'too_late'].includes(record.cancelStatus as null | string) ||
      typeof record.message !== 'string' || record.message.length < 1 || record.message.length > 2_000) return null
    return record as unknown as AgentTurnEvent
  }
  return null
}

function parseGmailSyncCompletion(value: unknown): GmailScheduledSyncCompletion | null {
  if (!isStrictObject(value, ['imported', 'duplicates', 'filtered', 'failed'])) return null
  const counts = [value.imported, value.duplicates, value.filtered, value.failed]
  if (!counts.every((count) => typeof count === 'number' && Number.isInteger(count) && count >= 0)) return null
  return value as unknown as GmailScheduledSyncCompletion
}

const api: DesktopApi = {
  getBusinessFeed: () => ipcRenderer.invoke(ipcChannels.getBusinessFeed),
  markBusinessFeed: (input) => ipcRenderer.invoke(ipcChannels.markBusinessFeed, input),
  getPersonnelWorkspace: () => ipcRenderer.invoke(ipcChannels.getPersonnelWorkspace),
  savePersonnelTemplate: (input) => ipcRenderer.invoke(ipcChannels.savePersonnelTemplate, input),
  beginBusinessProgress: (input) => ipcRenderer.invoke(ipcChannels.beginBusinessProgress, input),
  advanceBusinessProgress: (input) => ipcRenderer.invoke(ipcChannels.advanceBusinessProgress, input),
  analyzeBusinessProgress: (input) => ipcRenderer.invoke(ipcChannels.analyzeBusinessProgress, input),
  draftBusinessProgressMessage: (input) => ipcRenderer.invoke(ipcChannels.draftBusinessProgressMessage, input),
  openBusinessProgressEmail: (input) => ipcRenderer.invoke(ipcChannels.openBusinessProgressEmail, input),
  exportBusinessProgressCalendar: (input) => ipcRenderer.invoke(ipcChannels.exportBusinessProgressCalendar, input),
  listBusinessProgressMail: () => ipcRenderer.invoke(ipcChannels.listBusinessProgressMail),
  updateBusinessProgressMail: (input) => ipcRenderer.invoke(ipcChannels.updateBusinessProgressMail, input),
  listBusinessFollowUps: () => ipcRenderer.invoke(ipcChannels.listBusinessFollowUps),
  saveBusinessFollowUp: (input) => ipcRenderer.invoke(ipcChannels.saveBusinessFollowUp, input),
  onBusinessMatchingProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, value: BusinessMatchingProgress) => listener(value)
    ipcRenderer.on(ipcChannels.businessMatchingProgress, handler)
    return () => ipcRenderer.removeListener(ipcChannels.businessMatchingProgress, handler)
  },
  cancelBusinessMatching: (input) => ipcRenderer.invoke(ipcChannels.cancelBusinessMatching, input),
  setCandidateOwnCompany: (input) => ipcRenderer.invoke(ipcChannels.setCandidateOwnCompany, input),
  setCandidateBusinessState: (input) => ipcRenderer.invoke(ipcChannels.setCandidateBusinessState, input),
  validatePersonnelMessage: (input) => ipcRenderer.invoke(ipcChannels.validatePersonnelMessage, input),
  recordPersonnelCopy: (input) => ipcRenderer.invoke(ipcChannels.recordPersonnelCopy, input),
  openPersonnelEmail: (input) => ipcRenderer.invoke(ipcChannels.openPersonnelEmail, input),
  findPersonnelForCase: (input) => ipcRenderer.invoke(ipcChannels.findPersonnelForCase, input),
  findCasesForPersonnel: (input) => ipcRenderer.invoke(ipcChannels.findCasesForPersonnel, input),
  getStartupStatus: () => ipcRenderer.invoke(ipcChannels.getStartupStatus),
  getBootstrap: () => ipcRenderer.invoke(ipcChannels.getBootstrap),
  resolveActionApproval: (input) => ipcRenderer.invoke(ipcChannels.resolveActionApproval, input),
  saveLocalOperatorProfile: (input) => ipcRenderer.invoke(ipcChannels.saveLocalOperatorProfile, input),
  saveLocalApplicationPreferences: (input) => ipcRenderer.invoke(ipcChannels.saveLocalApplicationPreferences, input),
  saveJobCaseFieldAliases: (input) => ipcRenderer.invoke(ipcChannels.saveJobCaseFieldAliases, input),
  connectAiCommerce: () => ipcRenderer.invoke(ipcChannels.connectAiCommerce),
  getAiCommerceDashboard: () => ipcRenderer.invoke(ipcChannels.getAiCommerceDashboard),
  disconnectAiCommerce: () => ipcRenderer.invoke(ipcChannels.disconnectAiCommerce),
  resetAiCommerceToken: () => ipcRenderer.invoke(ipcChannels.resetAiCommerceToken),
  openAiCommerceMemberCenter: () => ipcRenderer.invoke(ipcChannels.openAiCommerceMemberCenter),
  prepareAiCommerceCloudPrompt: (input) => ipcRenderer.invoke(ipcChannels.prepareAiCommerceCloudPrompt, input),
  executeAiCommerceCloudPrompt: (input) => ipcRenderer.invoke(ipcChannels.executeAiCommerceCloudPrompt, input),
  regenerateIntroduction: (input) => ipcRenderer.invoke(ipcChannels.regenerateIntroduction, input),
  saveBusinessField: (input) => ipcRenderer.invoke(ipcChannels.saveBusinessField, input),
  listAiConversations: (context) => ipcRenderer.invoke(ipcChannels.listAiConversations, context),
  saveAiConversation: (input) => ipcRenderer.invoke(ipcChannels.saveAiConversation, input),
  deleteAiConversations: (input) => ipcRenderer.invoke(ipcChannels.deleteAiConversations, input),
  executeAgentTurn: (input) => ipcRenderer.invoke(ipcChannels.executeAgentTurn, input),
  cancelAgentTurn: (input) => ipcRenderer.invoke(ipcChannels.cancelAgentTurn, input),
  onAgentTurnEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => {
      const parsed = parseAgentTurnEvent(payload)
      if (parsed) listener(parsed)
    }
    ipcRenderer.on(ipcChannels.agentTurnEvent, handler)
    return () => ipcRenderer.removeListener(ipcChannels.agentTurnEvent, handler)
  },
  onAiCommerceStateChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, update: Parameters<typeof listener>[0]) => listener(update)
    ipcRenderer.on(ipcChannels.aiCommerceStateChanged, handler)
    return () => ipcRenderer.removeListener(ipcChannels.aiCommerceStateChanged, handler)
  },
  beginResumeImport: () => ipcRenderer.invoke(ipcChannels.beginResumeImport),
  stageDroppedResumeFiles: (input) => ipcRenderer.invoke(ipcChannels.stageDroppedResumeFiles, input),
  previewStagedResumeFile: (input) => ipcRenderer.invoke(ipcChannels.previewStagedResumeFile, input),
  analyzeResumeFile: (input) => ipcRenderer.invoke(ipcChannels.analyzeResumeFile, input),
  getCandidateReview: (documentId) => ipcRenderer.invoke(ipcChannels.getCandidateReview, documentId),
  submitCandidateReview: (input) => ipcRenderer.invoke(ipcChannels.submitCandidateReview, input),
  createCandidateInterviewRound: (input) => ipcRenderer.invoke(ipcChannels.createCandidateInterviewRound, input),
  saveCandidateInterviewSchedule: (input) => ipcRenderer.invoke(ipcChannels.saveCandidateInterviewSchedule, input),
  saveCandidateInterviewPreparation: (input) => ipcRenderer.invoke(ipcChannels.saveCandidateInterviewPreparation, input),
  saveCandidateInterviewNotes: (input) => ipcRenderer.invoke(ipcChannels.saveCandidateInterviewNotes, input),
  recordCandidateInterviewDecision: (input) => ipcRenderer.invoke(ipcChannels.recordCandidateInterviewDecision, input),
  openZoomMeeting: (input) => ipcRenderer.invoke(ipcChannels.openZoomMeeting, input),
  openInterviewMeeting: (input) => ipcRenderer.invoke(ipcChannels.openInterviewMeeting, input),
  openZoomTestMeeting: () => ipcRenderer.invoke(ipcChannels.openZoomTestMeeting),
  createManualJobCaseDraft: (input) => ipcRenderer.invoke(ipcChannels.createManualJobCaseDraft, input),
  createChatPasteJobCaseDraft: (input) => ipcRenderer.invoke(ipcChannels.createChatPasteJobCaseDraft, input),
  prepareWechatVisibleRead: () => ipcRenderer.invoke(ipcChannels.prepareWechatVisibleRead),
  executeWechatVisibleRead: (input) => ipcRenderer.invoke(ipcChannels.executeWechatVisibleRead, input),
  importEmlJobCaseDrafts: () => ipcRenderer.invoke(ipcChannels.importEmlJobCaseDrafts),
  importAtsCsvCandidates: () => ipcRenderer.invoke(ipcChannels.importAtsCsvCandidates),
  submitJobCaseReview: (input) => ipcRenderer.invoke(ipcChannels.submitJobCaseReview, input),
  getJobCaseHistory: (reviewId) => ipcRenderer.invoke(ipcChannels.getJobCaseHistory, reviewId),
  getJobCaseSourceText: (reviewId) => ipcRenderer.invoke(ipcChannels.getJobCaseSourceText, reviewId),
  setJobCaseLifecycle: (input) => ipcRenderer.invoke(ipcChannels.setJobCaseLifecycle, input),
  reopenJobCaseReview: (input) => ipcRenderer.invoke(ipcChannels.reopenJobCaseReview, input),
  previewJobCaseDeletion: (reviewId) => ipcRenderer.invoke(ipcChannels.previewJobCaseDeletion, reviewId),
  deleteJobCaseData: (input) => ipcRenderer.invoke(ipcChannels.deleteJobCaseData, input),
  getJobCaseNewDigest: () => ipcRenderer.invoke(ipcChannels.getJobCaseNewDigest),
  markJobCaseSeen: (reviewId) => ipcRenderer.invoke(ipcChannels.markJobCaseSeen, reviewId),
  listBroadcastWorkspace: () => ipcRenderer.invoke(ipcChannels.listBroadcastWorkspace),
  draftCaseBroadcast: (input) => ipcRenderer.invoke(ipcChannels.draftCaseBroadcast, input),
  prepareCaseIntroduction: (input) => ipcRenderer.invoke(ipcChannels.prepareCaseIntroduction, input),
  draftCaseUpdateNotice: (input) => ipcRenderer.invoke(ipcChannels.draftCaseUpdateNotice, input),
  validateCaseBroadcastMessage: (input) => ipcRenderer.invoke(ipcChannels.validateCaseBroadcastMessage, input),
  recordCaseBroadcastCopy: (input) => ipcRenderer.invoke(ipcChannels.recordCaseBroadcastCopy, input),
  openCaseBroadcastEmail: (input) => ipcRenderer.invoke(ipcChannels.openCaseBroadcastEmail, input),
  copyTextToClipboard: (text) => ipcRenderer.invoke(ipcChannels.copyTextToClipboard, text),
  listCaseBroadcasts: (reviewId) => ipcRenderer.invoke(ipcChannels.listCaseBroadcasts, reviewId),
  createBroadcastTemplate: (input) => ipcRenderer.invoke(ipcChannels.createBroadcastTemplate, input),
  updateBroadcastTemplate: (input) => ipcRenderer.invoke(ipcChannels.updateBroadcastTemplate, input),
  deleteBroadcastTemplate: (input) => ipcRenderer.invoke(ipcChannels.deleteBroadcastTemplate, input),
  getProposalWorkspace: (taskId) => ipcRenderer.invoke(ipcChannels.getProposalWorkspace, taskId),
  createProposalDraft: (input) => ipcRenderer.invoke(ipcChannels.createProposalDraft, input),
  updateProposalDraft: (input) => ipcRenderer.invoke(ipcChannels.updateProposalDraft, input),
  approveProposalDraft: (input) => ipcRenderer.invoke(ipcChannels.approveProposalDraft, input),
  exportProposalPackage: (input) => ipcRenderer.invoke(ipcChannels.exportProposalPackage, input),
  recordProposalFollowUp: (input) => ipcRenderer.invoke(ipcChannels.recordProposalFollowUp, input),
  searchCandidateProfiles: (input) => ipcRenderer.invoke(ipcChannels.searchCandidateProfiles, input),
  executeCandidateMatchTask: (taskId) => ipcRenderer.invoke(ipcChannels.executeCandidateMatchTask, taskId),
  submitCandidateMatchFeedback: (input) => ipcRenderer.invoke(ipcChannels.submitCandidateMatchFeedback, input),
  setBusinessPriorityOverride: (input) => ipcRenderer.invoke(ipcChannels.setBusinessPriorityOverride, input),
  importCandidateEvaluationBenchmark: () => ipcRenderer.invoke(ipcChannels.importCandidateEvaluationBenchmark),
  getCandidateEvaluationAuthoringWorkspace: () => ipcRenderer.invoke(ipcChannels.getCandidateEvaluationAuthoringWorkspace),
  createCandidateEvaluationDraft: (input) => ipcRenderer.invoke(ipcChannels.createCandidateEvaluationDraft, input),
  saveCandidateEvaluationDraftCase: (input) => ipcRenderer.invoke(ipcChannels.saveCandidateEvaluationDraftCase, input),
  deleteCandidateEvaluationDraftCase: (input) => ipcRenderer.invoke(ipcChannels.deleteCandidateEvaluationDraftCase, input),
  evaluateCandidateEvaluationDraft: (input) => ipcRenderer.invoke(ipcChannels.evaluateCandidateEvaluationDraft, input),
  getCandidateProfileHistory: (sourceDocumentId) => ipcRenderer.invoke(ipcChannels.getCandidateProfileHistory, sourceDocumentId),
  getOriginalDocumentPreview: (sourceDocumentId) => ipcRenderer.invoke(ipcChannels.getOriginalDocumentPreview, sourceDocumentId),
  openOriginalDocument: (sourceDocumentId) => ipcRenderer.invoke(ipcChannels.openOriginalDocument, sourceDocumentId),
  updateCandidateProfile: (input) => ipcRenderer.invoke(ipcChannels.updateCandidateProfile, input),
    previewCandidateDeletion: (sourceDocumentId) => ipcRenderer.invoke(ipcChannels.previewCandidateDeletion, sourceDocumentId),
  deleteCandidateData: (input) => ipcRenderer.invoke(ipcChannels.deleteCandidateData, input),
  listDataDeletionReports: () => ipcRenderer.invoke(ipcChannels.listDataDeletionReports),
  connectGoogleWorkspace: () => ipcRenderer.invoke(ipcChannels.connectGoogleWorkspace),
  diagnoseGoogleWorkspace: () => ipcRenderer.invoke(ipcChannels.diagnoseGoogleWorkspace),
  runGoogleWorkspaceOnlineAcceptance: () => ipcRenderer.invoke(ipcChannels.runGoogleWorkspaceOnlineAcceptance),
  saveGoogleWorkspaceAdminConfiguration: (input) => ipcRenderer.invoke(ipcChannels.saveGoogleWorkspaceAdminConfiguration, input),
  disconnectGoogleWorkspace: () => ipcRenderer.invoke(ipcChannels.disconnectGoogleWorkspace),
  syncGoogleWorkspace: () => ipcRenderer.invoke(ipcChannels.syncGoogleWorkspace),
  onOpenNewCaseBoard: (listener) => {
    const handler = () => listener()
    ipcRenderer.on(ipcChannels.openNewCaseBoard, handler)
    return () => ipcRenderer.removeListener(ipcChannels.openNewCaseBoard, handler)
  },
  onGmailSyncCompleted: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => {
      const parsed = parseGmailSyncCompletion(payload)
      if (parsed) listener(parsed)
    }
    ipcRenderer.on(ipcChannels.gmailSyncCompleted, handler)
    return () => ipcRenderer.removeListener(ipcChannels.gmailSyncCompleted, handler)
  },
  getRecoveryState: () => ipcRenderer.invoke(ipcChannels.getRecoveryState),
  createRecoveryPackage: (input) => ipcRenderer.invoke(ipcChannels.createRecoveryPackage, input),
  snoozeRecoveryReminder: (input) => ipcRenderer.invoke(ipcChannels.snoozeRecoveryReminder, input),
  previewRecoveryPackage: (input) => ipcRenderer.invoke(ipcChannels.previewRecoveryPackage, input),
  confirmRecovery: (input) => ipcRenderer.invoke(ipcChannels.confirmRecovery, input),
  restartApplication: () => ipcRenderer.invoke(ipcChannels.restartApplication),
  previewWorkTask: (input) => ipcRenderer.invoke(ipcChannels.previewWorkTask, input),
  createWorkTask: (input) => ipcRenderer.invoke(ipcChannels.createWorkTask, input),
  setWorkTaskLifecycle: (input) => ipcRenderer.invoke(ipcChannels.setWorkTaskLifecycle, input)
}

contextBridge.exposeInMainWorld('sesAgent', api)
