export const workTaskTypes = [
  'IMPORT_RESUME',
  'CREATE_CASE',
  'MATCH_CANDIDATES',
  'GENERATE_PROPOSAL'
] as const

export type WorkTaskType = (typeof workTaskTypes)[number]

export type WorkTaskStatus =
  | 'awaiting_input'
  | 'planned'
  | 'running'
  | 'awaiting_review'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type TaskStepStatus = 'pending' | 'running' | 'completed' | 'blocked'

export interface TaskStep {
  id: string
  title: string
  description: string
  status: TaskStepStatus
}

export interface DataScope {
  id: 'confirmed-candidate-pool' | 'selected-files' | 'selected-gmail-message' | 'selected-case'
  label: string
  detail: string
}

export interface PrivacyPolicySummary {
  policyVersion: string
  cloudDirectIdentifiers: 'blocked'
  cloudPayload: 'redacted-only'
  automaticSending: false
}

export interface ContextBinding {
  objectType: 'staged-file' | 'candidate-pool' | 'gmail-message' | 'job-case'
  objectId: string
  version: string
}

export interface WorkTaskMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  kind: 'instruction' | 'plan' | 'status' | 'review' | 'completion' | 'error'
  content: string
  createdAt: string
}

export interface ApprovalGate {
  id: string
  label: string
  status: 'required' | 'approved'
  approvedBy: string | null
  approvedAt: string | null
}

export interface WorkTaskArtifact {
  id: string
  kind: 'candidate-profile' | 'candidate-match-results' | 'proposal-draft' | 'proposal-package' | 'job-case-draft'
  label: string
  status: 'available' | 'exported' | 'superseded'
  objectId: string | null
  contentHash: string | null
  containsDirectIdentifiers: false
  createdAt: string
}

export interface ToolAudit {
  id: string
  action: string
  decision: 'executed' | 'blocked'
  dataScopeId: DataScope['id']
  externalSideEffect: 'none' | 'local-write' | 'file-export'
  cloudPayload: 'none' | 'redacted-only'
  evidenceCount: number
  reason: string
  createdAt: string
}

export interface WorkTaskPreview {
  type: WorkTaskType
  typeLabel: string
  title: string
  instruction: string
  scope: DataScope
  steps: TaskStep[]
  requiredApprovals: string[]
  privacy: PrivacyPolicySummary
  contextBindings: ContextBinding[]
}

export interface SignedWorkTaskPreview extends WorkTaskPreview {
  previewHash: string
}

export interface WorkTask extends WorkTaskPreview {
  id: string
  status: WorkTaskStatus
  progress: number
  createdAt: string
  updatedAt: string
  evidenceCount: number
  messages: WorkTaskMessage[]
  approvalGates: ApprovalGate[]
  artifacts: WorkTaskArtifact[]
  toolAudits: ToolAudit[]
}

export const workTaskTypeLabels: Record<WorkTaskType, string> = {
  IMPORT_RESUME: 'スキルシート取込',
  CREATE_CASE: '案件登録',
  MATCH_CANDIDATES: '候補者検索',
  GENERATE_PROPOSAL: '提案下書き'
}

export const workTaskStatusLabels: Record<WorkTaskStatus, string> = {
  awaiting_input: '入力待ち',
  planned: '開始待ち',
  running: '進行中',
  awaiting_review: '確認待ち',
  completed: '完了',
  cancelled: 'キャンセル',
  failed: '要対応'
}
