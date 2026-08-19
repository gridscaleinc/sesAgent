import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { ipcChannels, type AgentTurnEvent, type DesktopApi } from '@shared/contracts'

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

const api: DesktopApi = {
  getStartupStatus: () => ipcRenderer.invoke(ipcChannels.getStartupStatus),
  getBootstrap: () => ipcRenderer.invoke(ipcChannels.getBootstrap),
  resolveActionApproval: (input) => ipcRenderer.invoke(ipcChannels.resolveActionApproval, input),
  saveLocalOperatorProfile: (input) => ipcRenderer.invoke(ipcChannels.saveLocalOperatorProfile, input),
  saveLocalApplicationPreferences: (input) => ipcRenderer.invoke(ipcChannels.saveLocalApplicationPreferences, input),
  connectAiCommerce: () => ipcRenderer.invoke(ipcChannels.connectAiCommerce),
  getAiCommerceDashboard: () => ipcRenderer.invoke(ipcChannels.getAiCommerceDashboard),
  disconnectAiCommerce: () => ipcRenderer.invoke(ipcChannels.disconnectAiCommerce),
  resetAiCommerceToken: () => ipcRenderer.invoke(ipcChannels.resetAiCommerceToken),
  openAiCommerceMemberCenter: () => ipcRenderer.invoke(ipcChannels.openAiCommerceMemberCenter),
  prepareAiCommerceCloudPrompt: (input) => ipcRenderer.invoke(ipcChannels.prepareAiCommerceCloudPrompt, input),
  executeAiCommerceCloudPrompt: (input) => ipcRenderer.invoke(ipcChannels.executeAiCommerceCloudPrompt, input),
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
  submitJobCaseReview: (input) => ipcRenderer.invoke(ipcChannels.submitJobCaseReview, input),
  getJobCaseHistory: (reviewId) => ipcRenderer.invoke(ipcChannels.getJobCaseHistory, reviewId),
  setJobCaseLifecycle: (input) => ipcRenderer.invoke(ipcChannels.setJobCaseLifecycle, input),
  reopenJobCaseReview: (input) => ipcRenderer.invoke(ipcChannels.reopenJobCaseReview, input),
  previewJobCaseDeletion: (reviewId) => ipcRenderer.invoke(ipcChannels.previewJobCaseDeletion, reviewId),
  deleteJobCaseData: (input) => ipcRenderer.invoke(ipcChannels.deleteJobCaseData, input),
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
