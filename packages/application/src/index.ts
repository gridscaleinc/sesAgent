import {
  workTaskTypeLabels,
  type ContextBinding,
  type DataScope,
  type ApprovalGate,
  type PrivacyPolicySummary,
  type TaskStep,
  type ToolAudit,
  type WorkTask,
  type WorkTaskArtifact,
  type WorkTaskMessage,
  type WorkTaskPreview,
  type WorkTaskType
} from '@domain'

const privacyPolicy: PrivacyPolicySummary = {
  policyVersion: 'cloud-redaction-v2',
  cloudDirectIdentifiers: 'blocked',
  cloudPayload: 'redacted-only',
  automaticSending: false
}

export const dataScopes: Record<DataScope['id'], DataScope> = {
  'confirmed-candidate-pool': {
    id: 'confirmed-candidate-pool',
    label: '確認済み候補者プール',
    detail: '人が確認した候補者プロフィールのみ'
  },
  'selected-files': {
    id: 'selected-files',
    label: '選択したローカルファイル',
    detail: '暗号化保管庫に安全に取り込んだファイルのみ'
  },
  'selected-gmail-message': {
    id: 'selected-gmail-message',
    label: '選択した Gmail メッセージ',
    detail: 'ユーザーが明示的に選択したメッセージのみ'
  },
  'selected-case': {
    id: 'selected-case',
    label: '選択した案件',
    detail: '現在の作業に明示的に紐づけた案件のみ'
  }
}

const defaultScope: DataScope = dataScopes['confirmed-candidate-pool']

export type ProcessingResourceLane = 'local-ai' | 'file-export'

interface ProcessingResourceLaneState {
  active: number
  readonly limit: number
  readonly queue: PendingProcessingResourceOperation[]
}

interface PendingProcessingResourceOperation {
  readonly operation: () => Promise<unknown>
  readonly resolve: (value: unknown) => void
  readonly reject: (error: unknown) => void
}

export class ProcessingResourceScheduler {
  private readonly lanes: Record<ProcessingResourceLane, ProcessingResourceLaneState>

  constructor(limits: Partial<Record<ProcessingResourceLane, number>> = {}) {
    const localAi = limits['local-ai'] ?? 1
    const fileExport = limits['file-export'] ?? 1
    for (const limit of [localAi, fileExport]) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
        throw new Error('Processing resource lane limit must be an integer between 1 and 8.')
      }
    }
    this.lanes = {
      'local-ai': { active: 0, limit: localAi, queue: [] },
      'file-export': { active: 0, limit: fileExport, queue: [] }
    }
  }

  run<T>(lane: ProcessingResourceLane, operation: () => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.lanes[lane].queue.push({
        operation: async () => operation(),
        resolve: (value) => resolve(value as T),
        reject
      })
      this.drain(lane)
    })
  }

  snapshot(): Record<ProcessingResourceLane, { active: number; queued: number; limit: number }> {
    return {
      'local-ai': this.snapshotLane('local-ai'),
      'file-export': this.snapshotLane('file-export')
    }
  }

  private snapshotLane(lane: ProcessingResourceLane): { active: number; queued: number; limit: number } {
    const state = this.lanes[lane]
    return { active: state.active, queued: state.queue.length, limit: state.limit }
  }

  private drain(lane: ProcessingResourceLane): void {
    const state = this.lanes[lane]
    while (state.active < state.limit) {
      const next = state.queue.shift()
      if (!next) return
      state.active += 1
      void (async () => {
        let result: unknown
        let failure: unknown
        let failed = false
        try {
          result = await next.operation()
        } catch (error) {
          failed = true
          failure = error
        }
        state.active -= 1
        this.drain(lane)
        if (failed) next.reject(failure)
        else next.resolve(result)
      })()
    }
  }
}

export interface SafeLocalDispatchJob {
  id: string
  type: string
  status: 'queued' | 'running' | 'succeeded' | 'retry_wait' | 'failed' | 'cancelled'
  replayPolicy: 'safe-local' | 'manual-review'
  nextRetryAt: string | null
}

interface SafeLocalProcessingDispatcherOptions<TJob extends SafeLocalDispatchJob> {
  listJobs(): TJob[]
  execute(job: TJob): Promise<void>
  intervalMs?: number
  now?: () => Date
  onError?: (error: unknown, job: TJob | null) => void
}

export class SafeLocalProcessingDispatcher<TJob extends SafeLocalDispatchJob> {
  private readonly intervalMs: number
  private readonly now: () => Date
  private timer: ReturnType<typeof setInterval> | null = null
  private dispatching: Promise<void> | null = null
  private wakePending = false

  constructor(private readonly options: SafeLocalProcessingDispatcherOptions<TJob>) {
    this.intervalMs = options.intervalMs ?? 1_000
    this.now = options.now ?? (() => new Date())
    if (!Number.isInteger(this.intervalMs) || this.intervalMs < 250 || this.intervalMs > 60_000) {
      throw new Error('Safe-local dispatcher interval must be between 250 and 60000 milliseconds.')
    }
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.dispatchNow() }, this.intervalMs)
    this.timer.unref?.()
    void this.dispatchNow()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.wakePending = false
  }

  wake(): void {
    if (this.dispatching) {
      this.wakePending = true
      return
    }
    void this.dispatchNow()
  }

  dispatchNow(): Promise<void> {
    if (this.dispatching) return this.dispatching
    const cycle = this.runDispatchCycle()
    this.dispatching = cycle.finally(() => {
      this.dispatching = null
      if (this.wakePending) {
        this.wakePending = false
        this.wake()
      }
    })
    return this.dispatching
  }

  private async runDispatchCycle(): Promise<void> {
    let jobs: TJob[]
    try {
      jobs = this.options.listJobs()
    } catch (error) {
      this.options.onError?.(error, null)
      return
    }
    const now = this.now().toISOString()
    const dispatchable = jobs.filter((job) =>
      job.replayPolicy === 'safe-local' && (
        job.status === 'queued' ||
        (job.status === 'retry_wait' && job.nextRetryAt !== null && job.nextRetryAt <= now)
      )
    )
    await Promise.all(dispatchable.map(async (job) => {
      try {
        await this.options.execute(job)
      } catch (error) {
        this.options.onError?.(error, job)
      }
    }))
  }
}

export function getDataScope(id: DataScope['id']): DataScope {
  return dataScopes[id]
}

const typeKeywords: ReadonlyArray<{ type: WorkTaskType; keywords: string[] }> = [
  {
    type: 'IMPORT_RESUME',
    keywords: ['スキルシート', '履歴書', '職務経歴書', 'resume', 'cv', '简历', '導入', '取り込']
  },
  {
    type: 'CREATE_CASE',
    keywords: ['案件登録', '案件を作', 'メールを整理', '案件メール', 'create case', '录入']
  },
  {
    type: 'GENERATE_PROPOSAL',
    keywords: ['提案', 'メール下書き', 'proposal', 'draft', '推荐信', '提案文']
  }
]

function normalizeInstruction(instruction: string): string {
  return instruction.trim().replaceAll(/\s+/g, ' ')
}

export function classifyWorkTask(instruction: string): WorkTaskType {
  const normalized = normalizeInstruction(instruction).toLocaleLowerCase('ja-JP')
  const matched = typeKeywords.find(({ keywords }) => keywords.some((keyword) => normalized.includes(keyword)))
  return matched?.type ?? 'MATCH_CANDIDATES'
}

function stepsFor(type: WorkTaskType): TaskStep[] {
  const common = (steps: Array<[string, string]>): TaskStep[] =>
    steps.map(([title, description], index) => ({
      id: `step-${index + 1}`,
      title,
      description,
      status: 'pending'
    }))

  switch (type) {
    case 'IMPORT_RESUME':
      return common([
        ['ファイルを安全に解析', '形式、サイズ、ハッシュを確認します'],
        ['個人識別情報をローカル処理', 'PII検出・置換・DLP再検査を行います'],
        ['候補者プロフィールを抽出', '構造化結果と出典を作成します'],
        ['人の確認を待つ', '確認後のみ候補者プールへ登録します']
      ])
    case 'CREATE_CASE':
      return common([
        ['入力内容を整理', 'メール署名と直接識別子をローカルで除去します'],
        ['案件項目を抽出', '技術・単価・精算・勤務地を構造化します'],
        ['重複を確認', '既存案件とMessage/業務指紋を比較します'],
        ['案件レビュー', '低信頼項目を人が確認します']
      ])
    case 'GENERATE_PROPOSAL':
      return common([
        ['確認済み情報を収集', '許可された案件・候補者だけを参照します'],
        ['脱敏コンテキストを作成', 'クラウド前にPII/DLPゲートを通します'],
        ['提案下書きを生成', '自動送信は行いません'],
        ['送信前レビュー', '宛先・本文・添付の承認を待ちます']
      ])
    case 'MATCH_CANDIDATES':
      return common([
        ['検索条件を解析', '必須条件と不明点を分離します'],
        ['候補者プールを検索', '硬条件・BM25・ベクトル・端末内AI精査で確認済みローカル人材プロフィールを検索します'],
        ['候補者を比較', '一致・不足・リスクを根拠付きで整理します'],
        ['人の確認を待つ', '提案対象は営業担当が決定します']
      ])
  }
}

function initialTaskRecords(preview: WorkTaskPreview, createdAt: string): Pick<WorkTask, 'messages' | 'approvalGates' | 'artifacts' | 'toolAudits'> {
  return {
    messages: [
      {
        id: 'message-001',
        role: 'user',
        kind: 'instruction',
        content: preview.instruction,
        createdAt
      },
      {
        id: 'message-002',
        role: 'assistant',
        kind: 'plan',
        content: '許可されたデータ範囲と統制ポリシーを確認しました。以下の計画で作業します。',
        createdAt
      }
    ],
    approvalGates: preview.requiredApprovals.map((label, index): ApprovalGate => ({
      id: `approval-${String(index + 1).padStart(3, '0')}`,
      label,
      status: 'required',
      approvedBy: null,
      approvedAt: null
    })),
    artifacts: [],
    toolAudits: [{
      id: 'audit-001',
      action: 'task.create',
      decision: 'executed',
      dataScopeId: preview.scope.id,
      externalSideEffect: 'local-write',
      cloudPayload: 'none',
      evidenceCount: 0,
      reason: '確認済みプレビューと同じデータ範囲でローカルタスクを作成しました。',
      createdAt
    }]
  }
}

function nextRecordId(prefix: string, records: ReadonlyArray<{ id: string }>): string {
  return `${prefix}-${String(records.length + 1).padStart(3, '0')}`
}

function appendTaskMessage(
  task: WorkTask,
  message: Omit<WorkTaskMessage, 'id'>
): WorkTaskMessage[] {
  return [...task.messages, { ...message, id: nextRecordId('message', task.messages) }]
}

function appendToolAudit(
  task: WorkTask,
  audit: Omit<ToolAudit, 'id' | 'dataScopeId'>
): ToolAudit[] {
  return [...task.toolAudits, {
    ...audit,
    id: nextRecordId('audit', task.toolAudits),
    dataScopeId: task.scope.id
  }]
}

function appendArtifact(
  task: WorkTask,
  artifact: Omit<WorkTaskArtifact, 'id' | 'containsDirectIdentifiers'>
): WorkTaskArtifact[] {
  const existing = task.artifacts.map((item): WorkTaskArtifact =>
    item.kind === artifact.kind && item.objectId !== null && item.objectId === artifact.objectId && item.status === 'available'
      ? { ...item, status: 'superseded' }
      : item
  )
  return [...existing, {
    ...artifact,
    id: nextRecordId('artifact', task.artifacts),
    containsDirectIdentifiers: false
  }]
}

function approveTaskGates(task: WorkTask, approvedBy: string, approvedAt: string): ApprovalGate[] {
  return task.approvalGates.map((gate) => ({
    ...gate,
    status: 'approved',
    approvedBy,
    approvedAt
  }))
}

const candidateSearchSkills = [
  'Spring Boot', 'TypeScript', 'JavaScript', 'Node.js', 'PostgreSQL', 'Kubernetes',
  'Salesforce', 'Terraform', 'Angular', 'React', 'Python', 'Kotlin', 'Docker', 'Oracle',
  'Java', 'AWS', 'Azure', 'GCP', 'Vue', 'Go', 'C#', '.NET', 'Swift', 'SQL', 'MySQL',
  'Linux', 'SAP'
] as const

export function candidateSearchQueryFromInstruction(instruction: string): string {
  const normalized = instruction.normalize('NFKC')
  const terms: string[] = []
  for (const skill of candidateSearchSkills) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const prefix = /^[A-Za-z0-9]/u.test(skill) ? '(?<![A-Za-z0-9+#.])' : ''
    const suffix = /[A-Za-z0-9]$/u.test(skill) ? '(?![A-Za-z0-9+#.])' : ''
    if (new RegExp(`${prefix}${escaped}${suffix}`, 'iu').test(normalized)) terms.push(skill)
  }
  for (const pattern of [
    /\d+(?:\.\d+)?年以上/gu,
    /(?:20\d{2}年)?\d{1,2}月/gu,
    /週\d+日(?:リモート|在宅)/gu,
    /(?:フルリモート|リモート可|常駐)/gu,
    /N[1-5](?:相当)?/giu,
    /\d{2,3}(?:〜|~|～|-)\d{2,3}万円/gu,
    /(?:上限\d{2,3}万円|\d{2,3}万円以下)/gu
  ]) {
    for (const match of normalized.matchAll(pattern)) terms.push(match[0])
  }
  for (const match of normalized.matchAll(/(?:勤務地|現場|勤務先)\s*(?:は|[:：=])\s*([^\s、,。\d]{1,30})/gu)) {
    const location = match[1]?.replace(/(?:勤務|通勤)(?:可|可能)?$/u, '').trim()
    if (location && !/(?:丁目|番地|号|〒)/u.test(location)) terms.push(`勤務地:${location}`)
  }
  for (const match of normalized.matchAll(
    /(?:日本で就労可能|就労資格必須|就労資格あり|就労制限なし|ビザサポートなし|資格外活動不可|週28時間制限不可)/gu
  )) terms.push(`就労資格:${match[0]}`)
  const unique = [...new Set(terms)]
  const hasSpecificRemoteFrequency = unique.some((term) => /^週\d+日(?:リモート|在宅)$/u.test(term))
  return unique
    .filter((term) => !(hasSpecificRemoteFrequency && term === 'リモート可'))
    .map((term) => term.includes(' ') ? `"${term}"` : term)
    .join(' ')
}

export function reconcileWorkTaskPlan(task: WorkTask): WorkTask {
  const definitions = stepsFor(task.type)
  const initialRecords = initialTaskRecords(task, task.createdAt)
  const steps = definitions.map((definition, index) => ({
    ...definition,
    id: task.steps[index]?.id ?? definition.id,
    status: task.steps[index]?.status ?? definition.status
  }))
  const messages = task.messages.length > 0 ? task.messages : initialRecords.messages
  const approvalGates = task.approvalGates.length > 0 ? task.approvalGates : initialRecords.approvalGates
  const toolAudits = task.toolAudits.length > 0 ? task.toolAudits : initialRecords.toolAudits
  const unchanged = task.steps.length === steps.length && task.steps.every((step, index) =>
    step.id === steps[index]?.id &&
    step.title === steps[index]?.title &&
    step.description === steps[index]?.description &&
    step.status === steps[index]?.status
  ) && messages === task.messages && approvalGates === task.approvalGates && toolAudits === task.toolAudits
  return unchanged ? task : { ...task, steps, messages, approvalGates, toolAudits }
}

export function recordCandidateMatchExecution(
  task: WorkTask,
  hasStructuredQuery: boolean,
  evidenceCount: number,
  now = new Date(),
  artifact: { objectId: string; contentHash: string } | null = null
): WorkTask {
  if (task.type !== 'MATCH_CANDIDATES') throw new Error('Only candidate-match tasks can record match execution.')
  if (!hasStructuredQuery && task.status === 'awaiting_input' && task.toolAudits.at(-1)?.action === 'candidate.search' && task.toolAudits.at(-1)?.decision === 'blocked') {
    return task
  }
  const artifactAlreadyRecorded = artifact !== null && task.artifacts.some((item) =>
    item.kind === 'candidate-match-results' &&
    item.objectId === artifact.objectId &&
    item.contentHash === artifact.contentHash
  )
  if (artifactAlreadyRecorded && (task.status === 'awaiting_review' || task.status === 'completed')) return task
  const definitions = stepsFor(task.type)
  const timestamp = now.toISOString()
  const nextEvidenceCount = hasStructuredQuery ? Math.max(0, Math.trunc(evidenceCount)) : 0
  return {
    ...task,
    status: hasStructuredQuery ? 'awaiting_review' : 'awaiting_input',
    progress: hasStructuredQuery ? 85 : 25,
    evidenceCount: nextEvidenceCount,
    updatedAt: timestamp,
    steps: definitions.map((step, index) => ({
      ...step,
      id: task.steps[index]?.id ?? step.id,
      status: hasStructuredQuery
        ? index < 3 ? 'completed' : 'blocked'
        : index === 0 ? 'completed' : index === 1 ? 'blocked' : 'pending'
    })),
    messages: appendTaskMessage(task, {
      role: 'system',
      kind: hasStructuredQuery ? 'review' : 'status',
      content: hasStructuredQuery
        ? `ローカル Hybrid Retrieval が完了しました。${nextEvidenceCount}件の証跡を確認してください。`
        : '検索条件を構造化できませんでした。条件を追加してから再実行してください。',
      createdAt: timestamp
    }),
    artifacts: hasStructuredQuery && !artifactAlreadyRecorded
      ? appendArtifact(task, {
          kind: 'candidate-match-results',
          label: '候補者比較結果',
          status: 'available',
          objectId: artifact?.objectId ?? null,
          contentHash: artifact?.contentHash ?? null,
          createdAt: timestamp
        })
      : task.artifacts,
    toolAudits: appendToolAudit(task, {
      action: 'candidate.search',
      decision: hasStructuredQuery ? 'executed' : 'blocked',
      externalSideEffect: 'local-write',
      cloudPayload: 'none',
      evidenceCount: nextEvidenceCount,
      reason: hasStructuredQuery
        ? '登録済みローカル人材プロフィールだけを端末内で検索しました。'
        : '構造化検索条件がないため候補者検索を開始しませんでした。',
      createdAt: timestamp
    })
  }
}

export function recordCandidateMatchStarted(task: WorkTask, attempt: number, now = new Date()): WorkTask {
  if (task.type !== 'MATCH_CANDIDATES') throw new Error('Only candidate-match tasks can record job start.')
  const timestamp = now.toISOString()
  return {
    ...task,
    status: 'running',
    progress: 15,
    updatedAt: timestamp,
    steps: task.steps.map((step, index) => ({
      ...step,
      status: index === 0 ? 'completed' : index === 1 ? 'running' : 'pending'
    })),
    messages: appendTaskMessage(task, {
      role: 'system',
      kind: 'status',
      content: `端末内の候補者検索ジョブを開始しました（試行 ${attempt}）。`,
      createdAt: timestamp
    })
  }
}

export function recordCandidateMatchFailure(task: WorkTask, errorCode: string, now = new Date()): WorkTask {
  if (task.type !== 'MATCH_CANDIDATES') throw new Error('Only candidate-match tasks can record job failure.')
  const timestamp = now.toISOString()
  return {
    ...task,
    status: 'failed',
    updatedAt: timestamp,
    steps: task.steps.map((step) => step.status === 'running' ? { ...step, status: 'blocked' } : step),
    messages: appendTaskMessage(task, {
      role: 'system',
      kind: 'error',
      content: `候補者検索ジョブを完了できませんでした（${errorCode}）。自動で外部処理は再実行しません。`,
      createdAt: timestamp
    }),
    toolAudits: appendToolAudit(task, {
      action: 'candidate.search',
      decision: 'blocked',
      externalSideEffect: 'local-write',
      cloudPayload: 'none',
      evidenceCount: task.evidenceCount,
      reason: `候補者検索ジョブを ${errorCode} で停止しました。`,
      createdAt: timestamp
    })
  }
}

export function recordCandidateMatchRetryScheduled(
  task: WorkTask,
  errorCode: string,
  nextRetryAt: string,
  now = new Date()
): WorkTask {
  if (task.type !== 'MATCH_CANDIDATES') throw new Error('Only candidate-match tasks can schedule retry.')
  const timestamp = now.toISOString()
  return {
    ...task,
    status: 'planned',
    updatedAt: timestamp,
    steps: task.steps.map((step, index) => ({
      ...step,
      status: index === 0 ? 'completed' : 'pending'
    })),
    messages: appendTaskMessage(task, {
      role: 'system',
      kind: 'status',
      content: `端末内候補者検索を一時停止しました（${errorCode}）。${nextRetryAt} 以降に同じ範囲で再試行します。`,
      createdAt: timestamp
    }),
    toolAudits: appendToolAudit(task, {
      action: 'candidate.search',
      decision: 'blocked',
      externalSideEffect: 'local-write',
      cloudPayload: 'none',
      evidenceCount: task.evidenceCount,
      reason: `安全な端末内作業だけを ${errorCode} から再試行待ちへ移しました。`,
      createdAt: timestamp
    })
  }
}

export function recoverInterruptedWorkTask(task: WorkTask, now = new Date()): WorkTask {
  if (task.id.startsWith('task-sample-') || task.status !== 'running') return task
  const timestamp = now.toISOString()
  return {
    ...task,
    status: 'awaiting_input',
    updatedAt: timestamp,
    steps: task.steps.map((step) => step.status === 'running' ? { ...step, status: 'blocked' } : step),
    messages: appendTaskMessage(task, {
      role: 'system',
      kind: 'error',
      content: '前回の実行が完了前に終了しました。自動で外部処理を再実行せず、確認待ちとして復元しました。',
      createdAt: timestamp
    }),
    toolAudits: appendToolAudit(task, {
      action: 'task.recover',
      decision: 'executed',
      externalSideEffect: 'local-write',
      cloudPayload: 'none',
      evidenceCount: task.evidenceCount,
      reason: '中断した実行を自動再送せず、確認可能な状態へ復元しました。',
      createdAt: timestamp
    })
  }
}

export function cancelWorkTask(task: WorkTask, now = new Date()): WorkTask {
  if (['completed', 'cancelled', 'failed'].includes(task.status)) {
    throw new Error('この作業はキャンセルできません。')
  }
  const timestamp = now.toISOString()
  return {
    ...task,
    status: 'cancelled',
    updatedAt: timestamp,
    steps: task.steps.map((step) => step.status === 'completed' ? step : { ...step, status: 'blocked' }),
    messages: appendTaskMessage(task, {
      role: 'system',
      kind: 'status',
      content: 'この作業をキャンセルしました。既に確認・保存された元データは削除していません。',
      createdAt: timestamp
    }),
    toolAudits: appendToolAudit(task, {
      action: 'task.cancel',
      decision: 'executed',
      externalSideEffect: 'local-write',
      cloudPayload: 'none',
      evidenceCount: task.evidenceCount,
      reason: '未完了ステップを停止し、既存の受管データは保持しました。',
      createdAt: timestamp
    })
  }
}

export function retryWorkTask(task: WorkTask, now = new Date()): WorkTask {
  if (!['cancelled', 'failed'].includes(task.status)) {
    throw new Error('キャンセル済みまたは失敗した作業だけを再実行できます。')
  }
  const timestamp = now.toISOString()
  return {
    ...task,
    status: 'planned',
    progress: 0,
    updatedAt: timestamp,
    steps: stepsFor(task.type),
    messages: appendTaskMessage(task, {
      role: 'system',
      kind: 'status',
      content: '同じデータ範囲とプライバシーポリシーで再実行を準備しました。外部副作用はまだありません。',
      createdAt: timestamp
    }),
    toolAudits: appendToolAudit(task, {
      action: 'task.retry',
      decision: 'executed',
      externalSideEffect: 'local-write',
      cloudPayload: 'none',
      evidenceCount: task.evidenceCount,
      reason: '元の確認済みデータ範囲を拡大せず、ローカル再実行を準備しました。',
      createdAt: timestamp
    })
  }
}

export function recordProposalDraftCreated(
  task: WorkTask,
  evidenceCount: number,
  now = new Date(),
  artifact: { objectId: string; contentHash: string } | null = null
): WorkTask {
  if (task.type !== 'GENERATE_PROPOSAL') throw new Error('Only proposal tasks can record proposal drafting.')
  const definitions = stepsFor(task.type)
  const timestamp = now.toISOString()
  return {
    ...task,
    status: 'awaiting_review',
    progress: 78,
    evidenceCount: Math.max(task.evidenceCount, Math.max(0, Math.trunc(evidenceCount))),
    updatedAt: timestamp,
    steps: definitions.map((step, index) => ({
      ...step,
      id: task.steps[index]?.id ?? step.id,
      status: index < 3 ? 'completed' : 'blocked'
    })),
    messages: appendTaskMessage(task, {
      role: 'system',
      kind: 'review',
      content: '端末内テンプレートで提案下書きを作成しました。宛先・本文・匿名添付を確認してください。',
      createdAt: timestamp
    }),
    artifacts: appendArtifact(task, {
      kind: 'proposal-draft',
      label: '提案下書き',
      status: 'available',
      objectId: artifact?.objectId ?? null,
      contentHash: artifact?.contentHash ?? null,
      createdAt: timestamp
    }),
    toolAudits: appendToolAudit(task, {
      action: 'proposal.draft',
      decision: 'executed',
      externalSideEffect: 'local-write',
      cloudPayload: 'none',
      evidenceCount: Math.max(0, Math.trunc(evidenceCount)),
      reason: '確認済み案件と匿名候補者フィールドだけでローカル下書きを生成しました。',
      createdAt: timestamp
    })
  }
}

export function recordProposalApproved(
  task: WorkTask,
  now = new Date(),
  approvedBy = '本機ユーザー'
): WorkTask {
  if (task.type !== 'GENERATE_PROPOSAL') throw new Error('Only proposal tasks can record proposal approval.')
  const definitions = stepsFor(task.type)
  const timestamp = now.toISOString()
  return {
    ...task,
    status: 'awaiting_review',
    progress: 95,
    updatedAt: timestamp,
    steps: definitions.map((step, index) => ({
      ...step,
      id: task.steps[index]?.id ?? step.id,
      status: 'completed'
    })),
    approvalGates: approveTaskGates(task, approvedBy, timestamp),
    messages: appendTaskMessage(task, {
      role: 'system',
      kind: 'review',
      content: '現在の内容ハッシュに対する送信前確認を記録しました。自動送信は行いません。',
      createdAt: timestamp
    }),
    toolAudits: appendToolAudit(task, {
      action: 'proposal.approve',
      decision: 'executed',
      externalSideEffect: 'local-write',
      cloudPayload: 'none',
      evidenceCount: task.evidenceCount,
      reason: '宛先・本文・匿名添付・プライバシー確認を現在の内容ハッシュに固定しました。',
      createdAt: timestamp
    })
  }
}

export function recordProposalExported(
  task: WorkTask,
  now = new Date(),
  artifact: { objectId: string; contentHash: string } | null = null
): WorkTask {
  if (task.type !== 'GENERATE_PROPOSAL') throw new Error('Only proposal tasks can record proposal export.')
  const definitions = stepsFor(task.type)
  const timestamp = now.toISOString()
  return {
    ...task,
    status: 'completed',
    progress: 100,
    updatedAt: timestamp,
    steps: definitions.map((step, index) => ({
      ...step,
      id: task.steps[index]?.id ?? step.id,
      status: 'completed'
    })),
    messages: appendTaskMessage(task, {
      role: 'system',
      kind: 'completion',
      content: '承認済み提案パッケージをローカルへ書き出しました。メールは送信していません。',
      createdAt: timestamp
    }),
    artifacts: appendArtifact(task, {
      kind: 'proposal-package',
      label: '承認済み提案パッケージ',
      status: 'exported',
      objectId: artifact?.objectId ?? null,
      contentHash: artifact?.contentHash ?? null,
      createdAt: timestamp
    }),
    toolAudits: appendToolAudit(task, {
      action: 'proposal.export',
      decision: 'executed',
      externalSideEffect: 'file-export',
      cloudPayload: 'none',
      evidenceCount: task.evidenceCount,
      reason: '承認済み内容ハッシュと一致するローカル ZIP だけを書き出しました。',
      createdAt: timestamp
    })
  }
}

const proposalFollowUpLabels = {
  sent: 'アプリ外での送信確認',
  replied: '先方からの返信',
  interview: '面談進行',
  accepted: '参画決定',
  declined: '見送り',
  withdrawn: '候補者辞退'
} as const

export function recordProposalFollowUp(
  task: WorkTask,
  stage: keyof typeof proposalFollowUpLabels,
  now = new Date(),
  recordedBy = '本機ユーザー'
): WorkTask {
  if (task.type !== 'GENERATE_PROPOSAL') throw new Error('Only proposal tasks can record proposal follow-up.')
  const timestamp = now.toISOString()
  const label = proposalFollowUpLabels[stage]
  return {
    ...task,
    status: 'completed',
    progress: 100,
    updatedAt: timestamp,
    messages: appendTaskMessage(task, {
      role: 'system',
      kind: 'status',
      content: `${label}を${recordedBy}が端末内の営業履歴へ記録しました。メール送信や外部更新は実行していません。`,
      createdAt: timestamp
    }),
    toolAudits: appendToolAudit(task, {
      action: 'proposal.follow-up',
      decision: 'executed',
      externalSideEffect: 'local-write',
      cloudPayload: 'none',
      evidenceCount: task.evidenceCount,
      reason: `${label}を人工確認済みの営業結果としてローカル記録しました。`,
      createdAt: timestamp
    })
  }
}

export function recordProposalExportStarted(task: WorkTask, attempt: number, now = new Date()): WorkTask {
  if (task.type !== 'GENERATE_PROPOSAL') throw new Error('Only proposal tasks can record proposal export start.')
  const timestamp = now.toISOString()
  return {
    ...task,
    status: 'running',
    progress: 96,
    updatedAt: timestamp,
    messages: appendTaskMessage(task, {
      role: 'system',
      kind: 'status',
      content: `承認済み提案パッケージのローカル書き出しを開始しました（試行 ${attempt}）。`,
      createdAt: timestamp
    })
  }
}

export function recordProposalExportFailure(task: WorkTask, errorCode: string, now = new Date()): WorkTask {
  if (task.type !== 'GENERATE_PROPOSAL') throw new Error('Only proposal tasks can record proposal export failure.')
  const timestamp = now.toISOString()
  return {
    ...task,
    status: 'awaiting_review',
    progress: Math.max(task.progress, 95),
    updatedAt: timestamp,
    messages: appendTaskMessage(task, {
      role: 'system',
      kind: 'error',
      content: `提案パッケージの書き出しを確定できませんでした（${errorCode}）。自動再実行せず、保存先と内容を確認してください。`,
      createdAt: timestamp
    }),
    toolAudits: appendToolAudit(task, {
      action: 'proposal.export',
      decision: 'blocked',
      externalSideEffect: 'file-export',
      cloudPayload: 'none',
      evidenceCount: task.evidenceCount,
      reason: `外部ファイルの重複書き出しを避けるため ${errorCode} で停止し、人工確認へ戻しました。`,
      createdAt: timestamp
    })
  }
}

export function recordResumeImportReviewState(
  task: WorkTask,
  completed: boolean,
  evidenceCount: number,
  profileObjectIds: string[] = [],
  now = new Date(),
  approvedBy = '本機ユーザー'
): WorkTask {
  if (task.type !== 'IMPORT_RESUME') throw new Error('Only resume-import tasks can record review state.')
  const timestamp = now.toISOString()
  const nextEvidenceCount = Math.max(0, Math.trunc(evidenceCount))
  const artifacts = completed
    ? profileObjectIds.reduce((current, objectId, index) => appendArtifact({ ...task, artifacts: current }, {
        kind: 'candidate-profile',
        label: `ローカル人材プロフィール ${index + 1}`,
        status: 'available',
        objectId,
        contentHash: null,
        createdAt: timestamp
      }), task.artifacts)
    : task.artifacts
  return {
    ...task,
    status: completed ? 'completed' : 'awaiting_review',
    progress: completed ? 100 : 75,
    evidenceCount: nextEvidenceCount,
    updatedAt: timestamp,
    steps: task.steps.map((step, index) => ({
      ...step,
      status: completed ? 'completed' : index < 3 ? 'completed' : 'blocked'
    })),
    approvalGates: completed ? approveTaskGates(task, approvedBy, timestamp) : task.approvalGates,
    messages: appendTaskMessage(task, {
      role: 'system',
      kind: completed ? 'completion' : 'review',
      content: completed
        ? '現在の内容でローカル人材プロフィールを登録しました。'
        : 'ローカル解析が完了しました。候補者フィールドは任意で確認できます。',
      createdAt: timestamp
    }),
    artifacts,
    toolAudits: appendToolAudit(task, {
      action: completed ? 'resume.confirm' : 'resume.local-parse',
      decision: 'executed',
      externalSideEffect: 'local-write',
      cloudPayload: 'none',
      evidenceCount: nextEvidenceCount,
      reason: completed
        ? '人材プロフィールを暗号化ローカルデータベースへ保存しました。'
        : '原ファイルを端末内で解析し、クラウド経路を使用しませんでした。',
      createdAt: timestamp
    })
  }
}

export function recordResumeAnalysisStarted(task: WorkTask, attempt: number, now = new Date()): WorkTask {
  if (task.type !== 'IMPORT_RESUME') throw new Error('Only resume-import tasks can record analysis start.')
  const timestamp = now.toISOString()
  return {
    ...task,
    status: 'running',
    progress: 15,
    updatedAt: timestamp,
    steps: task.steps.map((step, index) => ({
      ...step,
      status: index === 0 ? 'running' : 'pending'
    })),
    messages: appendTaskMessage(task, {
      role: 'system',
      kind: 'status',
      content: `端末内のスキルシート解析ジョブを開始しました（試行 ${attempt}）。`,
      createdAt: timestamp
    })
  }
}

export function recordResumeAnalysisFailure(task: WorkTask, errorCode: string, now = new Date()): WorkTask {
  if (task.type !== 'IMPORT_RESUME') throw new Error('Only resume-import tasks can record analysis failure.')
  const timestamp = now.toISOString()
  return {
    ...task,
    status: 'failed',
    updatedAt: timestamp,
    steps: task.steps.map((step) => step.status === 'running' ? { ...step, status: 'blocked' } : step),
    messages: appendTaskMessage(task, {
      role: 'system',
      kind: 'error',
      content: `スキルシートの端末内解析を完了できませんでした（${errorCode}）。原文をクラウドへ送らず停止しました。`,
      createdAt: timestamp
    }),
    toolAudits: appendToolAudit(task, {
      action: 'resume.local-parse',
      decision: 'blocked',
      externalSideEffect: 'local-write',
      cloudPayload: 'none',
      evidenceCount: task.evidenceCount,
      reason: `端末内解析ジョブを ${errorCode} で停止し、原文のクラウド回退を禁止しました。`,
      createdAt: timestamp
    })
  }
}

/** Records one failed source without stopping the remaining files in the same import batch. */
export function recordResumeAnalysisPartialFailure(task: WorkTask, errorCode: string, now = new Date()): WorkTask {
  if (task.type !== 'IMPORT_RESUME') throw new Error('Only resume-import tasks can record analysis failure.')
  const timestamp = now.toISOString()
  return {
    ...task,
    status: 'awaiting_review',
    progress: Math.max(task.progress, 15),
    updatedAt: timestamp,
    steps: task.steps.map((step) => step.status === 'running' ? { ...step, status: 'blocked' } : step),
    messages: appendTaskMessage(task, {
      role: 'system', kind: 'error',
      content: `一部のスキルシートを解析できませんでした（${errorCode}）。残りの選択ファイルを続行します。`,
      createdAt: timestamp
    }),
    toolAudits: appendToolAudit(task, {
      action: 'resume.local-parse', decision: 'blocked', externalSideEffect: 'local-write', cloudPayload: 'none',
      evidenceCount: task.evidenceCount,
      reason: `端末内解析ジョブを ${errorCode} で停止し、残りの選択ファイルは継続します。原文のクラウド回退は許可しません。`,
      createdAt: timestamp
    })
  }
}

export function recordResumeAnalysisRetryScheduled(
  task: WorkTask,
  errorCode: string,
  nextRetryAt: string,
  now = new Date()
): WorkTask {
  if (task.type !== 'IMPORT_RESUME') throw new Error('Only resume-import tasks can schedule analysis retry.')
  const timestamp = now.toISOString()
  return {
    ...task,
    status: 'planned',
    updatedAt: timestamp,
    steps: task.steps.map((step, index) => ({
      ...step,
      status: index === 0 ? 'pending' : step.status === 'completed' ? 'completed' : 'pending'
    })),
    messages: appendTaskMessage(task, {
      role: 'system',
      kind: 'status',
      content: `端末内スキルシート解析を一時停止しました（${errorCode}）。${nextRetryAt} 以降に同じファイルで再試行します。`,
      createdAt: timestamp
    }),
    toolAudits: appendToolAudit(task, {
      action: 'resume.local-parse',
      decision: 'blocked',
      externalSideEffect: 'local-write',
      cloudPayload: 'none',
      evidenceCount: task.evidenceCount,
      reason: `原文をクラウドへ回退せず、端末内作業だけを ${errorCode} から再試行待ちへ移しました。`,
      createdAt: timestamp
    })
  }
}

export function createWorkTaskPreview(
  instruction: string,
  scope: DataScope = defaultScope,
  contextBindings: ContextBinding[] = []
): WorkTaskPreview {
  const normalized = normalizeInstruction(instruction)
  if (normalized.length < 8) {
    throw new Error('作業内容を8文字以上で入力してください。')
  }

  const type = classifyWorkTask(normalized)
  return {
    type,
    typeLabel: workTaskTypeLabels[type],
    title: normalized.length > 36 ? `${normalized.slice(0, 36)}…` : normalized,
    instruction: normalized,
    scope,
    steps: stepsFor(type),
    requiredApprovals: type === 'GENERATE_PROPOSAL' ? ['提案内容', '宛先', '添付ファイル'] : ['抽出結果'],
    privacy: privacyPolicy,
    contextBindings
  }
}

export function materializeWorkTask(preview: WorkTaskPreview, id: string, now: string): WorkTask {
  return {
    ...preview,
    id,
    status: 'planned',
    progress: 0,
    createdAt: now,
    updatedAt: now,
    evidenceCount: 0,
    ...initialTaskRecords(preview, now)
  }
}

export function createSampleTasks(now: string): WorkTask[] {
  const candidateTask = materializeWorkTask(
    createWorkTaskPreview('Java / Spring Boot / AWS案件の候補者を照合したい'),
    'task-sample-001',
    now
  )
  candidateTask.status = 'running'
  candidateTask.progress = 65
  candidateTask.evidenceCount = 6
  candidateTask.steps = candidateTask.steps.map((step, index) => ({
    ...step,
    status: index < 2 ? 'completed' : index === 2 ? 'running' : 'pending'
  }))

  const reviewTask = materializeWorkTask(
    createWorkTaskPreview('EC決済基盤案件の提案メール下書きを準備したい'),
    'task-sample-002',
    now
  )
  reviewTask.status = 'awaiting_review'
  reviewTask.progress = 92
  reviewTask.evidenceCount = 4
  reviewTask.steps = reviewTask.steps.map((step, index) => ({
    ...step,
    status: index < 3 ? 'completed' : 'blocked'
  }))

  return [candidateTask, reviewTask]
}
