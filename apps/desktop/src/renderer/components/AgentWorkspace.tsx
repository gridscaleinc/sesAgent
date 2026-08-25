import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import type {
  AgentCandidateDraftFacts,
  StagedLocalFile,
  AgentChatModelOption,
  AgentCandidateMatchCard,
  AgentJobCaseCard,
  AgentSystemAccessBlock,
  AiConversationBlock,
  AiConversationMessage,
  AiConversationReference,
  AiConversationSnapshot,
  ExecuteAgentTurnInput,
  TypedAiConversationReference
} from '@shared'
import { useUiLocale } from '../i18n'
import { Icon, type IconName } from './Icon'
import { AiConversationHistoryPanel } from './AiConversationHistoryPanel'
import { AgentMarkdown } from './AgentMarkdown'
import { useAiConversationHistory } from './useAiConversationHistory'

interface AgentWorkspaceProps {
  activeSystemAccess?: AgentSystemAccessBlock | null
  contextPanel?: ReactNode
  contextPanelLabel?: string
  onCloseContextPanel?(): void
  onOpenMatching(jobCaseId: string): void
  onOpenCandidate?(
    sourceDocumentId: string,
    view?: 'overview' | 'resume' | 'schedule' | 'prepare' | 'workbench' | 'decision' | 'client' | 'records' | 'entry',
    interviewId?: string | null,
    interviewKind?: 'recruiting' | 'client'
  ): void
  onOpenOriginalDocument?(sourceDocumentId: string): Promise<unknown>
  reloadToken?: number
  models?: AgentChatModelOption[]
  defaultModelKey?: string
  /** Every turn needs the managed cloud connection; without it the composer is withheld. */
  cloudConnected?: boolean
  onConnectCloud?(): void
  onImportResume?(conversationId: string): Promise<AiConversationSnapshot | null>
  onOpenCandidatePool?(): void
  onOpenCaseImport?(): void
  onOpenCases?(): void
  onOpenGovernance?(): void
  onOpenTasks?(): void
  onOpenSystemAccess?(access: AgentSystemAccessBlock): void
  /**
   * Counts the operator would otherwise have lost by not passing through the
   * dashboard. Sourced from the same bootstrap fields the sidebar badges use,
   * so the two can never disagree.
   */
  status?: AgentWorkspaceStatus
  onOpenReviews?(): void
  onOpenSettings?(): void
  onOpenOperatorProfile?(): void
  operatorLabel?: string
  /**
   * Called after a tool writes to the local database, so the app can refresh its
   * bootstrap snapshot. Without it imports or interview schedules land in
   * SQLCipher while the corresponding screens keep rendering stale data.
   */
  onLocalDataChanged?(): void | Promise<void>
}

export interface AgentWorkspaceStatus {
  activeCaseCount: number
  eligibleCandidateCount: number
  pendingReviewCount: number
  runningJobCount: number
  backupReminder: 'not-needed' | 'due' | 'snoozed'
}

interface AgentQuickActionProps {
  description: string
  icon: IconName
  label: string
  onClick(): void
}

function AgentQuickAction({ description, icon, label, onClick }: AgentQuickActionProps) {
  return <button className="agent-quick-action" onClick={onClick} type="button">
    <span className="agent-quick-action-icon"><Icon name={icon} size={16} /></span>
    <span><strong>{label}</strong><small>{description}</small></span>
    <Icon name="chevron-right" size={14} />
  </button>
}

const fallbackModels: AgentChatModelOption[] = [
  { key: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna' },
  { key: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra' },
  { key: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol' },
  { key: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash' }
]

const agentModelSessionKey = 'ses-agent-chat-model-key-v1'

function newId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, (character) => {
    const value = Math.floor(Math.random() * 16)
    return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16)
  })
}

/**
 * Editing a historical input creates a non-destructive SQLCipher branch, but
 * branches are revisions of one user-visible conversation, not new sidebar
 * conversations. Explicit lineage handles new branches; repeated persisted
 * message ids safely recover legacy branches because independent conversations
 * never reuse message ids. Titles are deliberately not used for grouping.
 */
function conversationHistoryView(conversations: AiConversationSnapshot[]): {
  visible: AiConversationSnapshot[]
  lineageByConversationId: Map<string, string>
} {
  const parents = new Map<string, string>()
  const add = (id: string) => {
    if (!parents.has(id)) parents.set(id, id)
  }
  const find = (id: string): string => {
    add(id)
    const parent = parents.get(id)!
    if (parent === id) return id
    const root = find(parent)
    parents.set(id, root)
    return root
  }
  const join = (left: string, right: string) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parents.set(leftRoot, rightRoot)
  }

  const firstConversationByMessageId = new Map<string, string>()
  for (const conversation of conversations) {
    add(conversation.id)
    if (conversation.branchRootConversationId) join(conversation.id, conversation.branchRootConversationId)
    for (const message of conversation.messages) {
      const existing = firstConversationByMessageId.get(message.id)
      if (existing) join(conversation.id, existing)
      else firstConversationByMessageId.set(message.id, conversation.id)
    }
  }

  const lineageByConversationId = new Map(
    conversations.map((conversation) => [conversation.id, find(conversation.id)] as const)
  )
  const latestByRoot = new Map<string, AiConversationSnapshot>()
  for (const conversation of conversations) {
    const root = lineageByConversationId.get(conversation.id)!
    const latest = latestByRoot.get(root)
    if (!latest || conversation.updatedAt > latest.updatedAt) latestByRoot.set(root, conversation)
  }
  return {
    visible: [...latestByRoot.values()].toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    lineageByConversationId
  }
}

function statusLabel(status: 'current' | 'stale' | 'deleted', zh: boolean): string {
  if (status === 'current') return zh ? '当前' : '現在'
  if (status === 'stale') return zh ? '已过期' : '要再確認'
  return zh ? '已删除' : '削除済み'
}

function userFacingAgentError(message: string, zh: boolean): string {
  if (
    message.includes('Invalid ISO datetime') &&
    (message.includes('scheduledAt') || message.includes('invalid_format'))
  ) {
    return zh
      ? '面试时间格式无效，本次没有保存记录。请重新发送日期、开始时间和时长。'
      : '面談時刻の形式が無効なため、レコードは保存されませんでした。日付、開始時刻、所要時間を再送信してください。'
  }
  return message
}

function typedReference(reference: AiConversationReference | null | undefined): TypedAiConversationReference | null {
  if (!reference?.kind || !reference.objectId) return null
  return {
    kind: reference.kind,
    objectId: reference.objectId,
    objectVersion: reference.objectVersion ?? null,
    resultHash: reference.resultHash ?? null,
    ordinal: reference.ordinal ?? null,
    label: reference.label,
    target: reference.target
  }
}

interface AgentWorkspaceContext {
  candidateLabel: string | null
  candidateDocumentId: string | null
  latestAccess: AgentSystemAccessBlock | null
  resultLabel: string | null
}

function deriveWorkspaceContext(messages: readonly AiConversationMessage[], zh: boolean): AgentWorkspaceContext {
  const blocks = messages.flatMap((message) => message.blocks ?? [])
  const latestAccess = [...blocks].reverse().find((block): block is AgentSystemAccessBlock => block.type === 'system-access') ?? null
  const receipt = latestAccess?.destination === 'interview-schedule' ? latestAccess.receipt : undefined
  const latestDraft = [...blocks].reverse().find((block) => block.type === 'candidate-draft-facts')
  const latestImport = [...blocks].reverse().find((block) => block.type === 'resume-import')
  const candidateLabel = receipt?.candidateLabel
    ?? (latestDraft?.type === 'candidate-draft-facts' ? latestDraft.facts.label : null)
    ?? (latestImport?.type === 'resume-import' ? latestImport.imported[0]?.label ?? null : null)
  const candidateDocumentId = receipt?.sourceDocumentId
    ?? (latestDraft?.type === 'candidate-draft-facts' ? latestDraft.facts.documentId : null)
    ?? (latestImport?.type === 'resume-import' ? latestImport.imported[0]?.documentId ?? null : null)
  const resultLabel = latestAccess?.destination === 'interview-schedule'
    ? (zh ? '面试已登记' : '面談登録済み')
    : latestAccess?.destination === 'review-center'
      ? (zh ? '等待人工审核' : '人のレビュー待ち')
      : latestAccess?.destination === 'matching'
        ? (zh ? '匹配结果已生成' : 'マッチ結果作成済み')
        : latestAccess
          ? (zh ? '系统结果可访问' : 'システム結果あり')
          : latestImport
            ? (zh ? '简历已加入上下文' : '履歴書をコンテキストに追加済み')
            : null
  return { candidateLabel, candidateDocumentId, latestAccess, resultLabel }
}

function formatJstDateTime(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date(value))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} JST`
}

function MessageText({ message }: { message: AiConversationMessage }) {
  return message.role === 'assistant'
    ? <AgentMarkdown content={message.content} />
    : <p className="agent-message-text">{message.content}</p>
}

function UserMessageEditor({ busy, value, zh, onCancel, onChange, onSubmit }: {
  busy: boolean
  value: string
  zh: boolean
  onCancel(): void
  onChange(value: string): void
  onSubmit(): void
}) {
  return <form className="agent-message-editor" onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
    <textarea
      aria-label={zh ? '编辑已发送的输入' : '送信済み入力を編集'}
      autoFocus
      disabled={busy}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          onSubmit()
        }
      }}
      rows={3}
      value={value}
    />
    <small>{zh ? '将在当前会话中从这条输入之前重新生成；原版本和已执行操作仍保留在本机。' : '現在の会話内でこの入力より前から再生成します。元の版と実行済み操作は端末内に保持されます。'}</small>
    <footer>
      <button disabled={busy} onClick={onCancel} type="button">{zh ? '取消' : 'キャンセル'}</button>
      <button className="is-primary" disabled={busy || !value.trim()} type="submit"><Icon name="arrow-up" size={13} />{zh ? '重新发送' : '再送信'}</button>
    </footer>
  </form>
}

function JobCaseCardView({
  card,
  zh,
  onSelect,
  onOpenMatching
}: {
  card: AgentJobCaseCard
  zh: boolean
  onSelect(reference: TypedAiConversationReference): void
  onOpenMatching(jobCaseId: string): void
}) {
  return (
    <article className={`agent-case-card is-${card.status}`}>
      <header>
        <div><span className="agent-card-kicker">{zh ? `案件 ${card.reference.ordinal ?? ''}` : `案件 ${card.reference.ordinal ?? ''}`}</span><h3>{card.title}</h3></div>
        <span className="agent-status-chip">{statusLabel(card.status, zh)}</span>
      </header>
      <div className="agent-case-meta"><span>v{card.version}</span><span>{card.requiredSkills ?? (zh ? '技能未指定' : 'Skills not specified')}</span><span>{card.rate ?? (zh ? '单价未指定' : 'Rate not specified')}</span></div>
      <div className="agent-case-meta"><span>{card.workStyle ?? (zh ? '工作方式未指定' : 'Work style not specified')}</span><span>{card.startDate ?? (zh ? '开始时间未指定' : 'Start date not specified')}</span></div>
      <footer>
        <button className="agent-card-select" disabled={card.status === 'deleted'} onClick={() => onSelect(card.reference)} type="button">{zh ? '设为当前案件' : '現在の案件にする'}</button>
        <button disabled={card.status === 'deleted'} onClick={() => onOpenMatching(card.reference.objectId)} type="button">{zh ? '打开完整匹配' : '詳細マッチングを開く'}<Icon name="chevron-right" size={13} /></button>
      </footer>
    </article>
  )
}

function CandidateCardView({ card, zh, onOpenCandidate, onOpenMatching, currentCaseId }: {
  card: AgentCandidateMatchCard
  zh: boolean
  onOpenCandidate?(sourceDocumentId: string): void
  onOpenMatching(jobCaseId: string): void
  currentCaseId: string | null
}) {
  return (
    <article className={`agent-candidate-card is-${card.status}`}>
      <header>
        <span className="agent-rank">#{card.rank}</span>
        <div><h3>{card.anonymousLabel}</h3><small>{card.fitScore === null ? (zh ? 'Fit 未提供' : 'Fit unavailable') : `Fit ${card.fitScore}`}</small></div>
        <span className="agent-status-chip">{statusLabel(card.status, zh)}</span>
      </header>
      <div className="agent-candidate-facts">
        <span><strong>{zh ? '匹配' : 'Matched'}</strong>{card.matched.length > 0 ? card.matched.join(' · ') : '—'}</span>
        <span><strong>{zh ? '不足' : '不足'}</strong>{card.missing.length > 0 ? card.missing.join(' · ') : (zh ? '未记录不足项' : '不足項目なし')}</span>
        <span><strong>{zh ? '硬条件' : '必須条件'}</strong>{card.hardFilterStatus}</span>
        {card.projectEvidence ? <span><strong>{zh ? '项目证据' : 'プロジェクト根拠'}</strong>{card.projectEvidence}</span> : null}
      </div>
      <footer>
        {card.sourceDocumentId && onOpenCandidate ? <button disabled={card.status === 'deleted'} onClick={() => onOpenCandidate(card.sourceDocumentId!)} type="button"><Icon name="users" size={13} />{zh ? '打开候选人' : '候補者を開く'}</button> : null}
        <button disabled={card.status === 'deleted' || !currentCaseId} onClick={() => currentCaseId && onOpenMatching(currentCaseId)} type="button">{zh ? '查看完整匹配结果' : '詳細なマッチ結果を見る'}<Icon name="chevron-right" size={13} /></button>
      </footer>
    </article>
  )
}

type CandidateRouteView = 'overview' | 'resume' | 'schedule' | 'prepare' | 'workbench' | 'decision' | 'client' | 'records' | 'entry'

interface AgentBlockActionsProps {
  children: ReactNode
}

function AgentBlockActions({ children }: AgentBlockActionsProps) {
  return <footer className="agent-block-actions">{children}</footer>
}

function CandidateProfileEvidenceView({ block, zh, onOpenCandidate, onOpenOriginalDocument }: {
  block: Extract<AiConversationBlock, { type: 'candidate-profile-evidence' }>
  zh: boolean
  onOpenCandidate?(sourceDocumentId: string, view?: CandidateRouteView): void
  onOpenOriginalDocument?(sourceDocumentId: string): void
}) {
  const { candidate, profile, validity } = block.facts
  if (!candidate || !profile) return <div className="agent-evidence-card is-deleted"><p>{zh ? '候选人档案已不存在或当前不可读取。' : '候補者プロフィールが存在しないか、現在参照できません。'}</p></div>
  const fields = [
    [zh ? '技能' : 'スキル', profile.skills],
    [zh ? '经验' : '経験年数', profile.experienceYears],
    [zh ? '日语' : '日本語', profile.japaneseLevel],
    [zh ? '角色' : 'ロール', profile.role],
    [zh ? '可入场时间' : '稼働開始', profile.availability],
    [zh ? '单价' : '単価', profile.rate],
    [zh ? '工作方式' : '勤務形態', profile.workStyle],
    [zh ? '所在地' : '所在地', profile.location],
    [zh ? '工作许可' : '就労資格', profile.workAuthorization]
  ].filter((entry): entry is [string, string] => Boolean(entry[1]))
  return <article className={`agent-evidence-card is-${validity}`}>
    <header><div><span className="agent-card-kicker">{zh ? `候选人 #${candidate.rank}` : `候補者 #${candidate.rank}`}</span><h3>{candidate.anonymousLabel}</h3></div><span className="agent-status-chip">{statusLabel(validity, zh)}</span></header>
    <dl className="agent-evidence-facts">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {profile.projectExperiences.length > 0 ? <div className="agent-evidence-projects"><strong>{zh ? '项目经历' : 'プロジェクト経験'}</strong>{profile.projectExperiences.slice(0, 4).map((project, index) => <details key={`${project.title}-${index}`}><summary>{project.title}<small>{[project.period, project.role].filter(Boolean).join(' · ')}</small></summary><p>{project.summary}</p>{project.technologies.length > 0 ? <span>{project.technologies.join(' · ')}</span> : null}</details>)}</div> : null}
    {candidate.sourceDocumentId ? <AgentBlockActions>
      {onOpenCandidate ? <button disabled={validity === 'deleted'} onClick={() => onOpenCandidate(candidate.sourceDocumentId!, 'overview')} type="button"><Icon name="users" size={13} />{zh ? '打开候选人档案' : '候補者プロフィールを開く'}</button> : null}
      {onOpenOriginalDocument ? <button disabled={validity === 'deleted'} onClick={() => onOpenOriginalDocument(candidate.sourceDocumentId!)} type="button"><Icon name="file" size={13} />{zh ? '打开原文件' : '元ファイルを開く'}<Icon name="external-link" size={12} /></button> : null}
    </AgentBlockActions> : null}
  </article>
}

function interviewRouteView(stage: string): CandidateRouteView {
  if (stage === 'scheduled') return 'prepare'
  if (stage === 'prepared' || stage === 'interviewing') return 'workbench'
  if (stage === 'awaiting-decision') return 'decision'
  if (stage === 'new' || stage === 'contacting') return 'schedule'
  return 'records'
}

function CandidateInterviewEvidenceView({ block, locale, zh, onOpenCandidate }: {
  block: Extract<AiConversationBlock, { type: 'candidate-interview-evidence' }>
  locale: string
  zh: boolean
  onOpenCandidate?(sourceDocumentId: string, view?: CandidateRouteView, interviewId?: string | null, interviewKind?: 'recruiting' | 'client'): void
}) {
  const { candidate, interviews, validity } = block.facts
  const formatter = new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  if (!candidate) return <div className="agent-evidence-card is-deleted"><p>{zh ? '无法定位候选人，不能打开面试记录。' : '候補者を特定できないため、面談記録を開けません。'}</p></div>
  return <article className={`agent-evidence-card is-${validity}`}>
    <header><div><span className="agent-card-kicker">{zh ? `候选人 #${candidate.rank}` : `候補者 #${candidate.rank}`}</span><h3>{candidate.anonymousLabel}</h3></div><span className="agent-status-chip">{statusLabel(validity, zh)}</span></header>
    {interviews.length > 0 ? <div className="agent-interview-list">{interviews.map((interview, index) => <section key={interview.interviewId ?? `${interview.kind}-${interview.roundNumber}-${index}`}>
      <div><strong>{interview.kind === 'client' ? (zh ? '客户面试' : '顧客面談') : (zh ? '招聘面试' : '採用面談')} · {zh ? `第 ${interview.roundNumber} 轮` : `${interview.roundNumber}回目`}</strong><span>{interview.stage}</span></div>
      <p>{interview.scheduledAt ? formatter.format(new Date(interview.scheduledAt)) : (zh ? '时间未确定' : '日時未定')} · {interview.durationMinutes} min · {interview.meetingMethod}</p>
      {interview.interviewNotes ? <small>{interview.interviewNotes}</small> : interview.interviewGoal ? <small>{interview.interviewGoal}</small> : null}
      {candidate.sourceDocumentId && onOpenCandidate ? <button disabled={validity === 'deleted'} onClick={() => onOpenCandidate(candidate.sourceDocumentId!, interviewRouteView(interview.stage), interview.interviewId ?? null, interview.kind)} type="button">{zh ? '打开这轮面试' : 'この面談を開く'}<Icon name="chevron-right" size={12} /></button> : null}
    </section>)}</div> : <p className="agent-evidence-empty">{zh ? '还没有面试记录。' : '面談記録はまだありません。'}</p>}
    {candidate.sourceDocumentId && onOpenCandidate ? <AgentBlockActions><button disabled={validity === 'deleted'} onClick={() => onOpenCandidate(candidate.sourceDocumentId!, interviews.length > 0 ? 'records' : 'schedule')} type="button"><Icon name="users" size={13} />{interviews.length > 0 ? (zh ? '查看全部面试记录' : 'すべての面談記録を見る') : (zh ? '安排面试' : '面談を設定')}</button></AgentBlockActions> : null}
  </article>
}

function ResumeImportView({ block, zh, onOpenCandidate, onOpenOriginalDocument, onOpenReviews }: {
  block: Extract<AiConversationBlock, { type: 'resume-import' }>
  zh: boolean
  onOpenCandidate?(sourceDocumentId: string, view?: CandidateRouteView): void
  onOpenOriginalDocument?(sourceDocumentId: string): void
  onOpenReviews?(): void
}) {
  return <article className="agent-import-card">
    <header><span className="agent-import-icon"><Icon name="file" size={16} /></span><div><strong>{zh ? `已导入 ${block.imported.length} 份简历` : `${block.imported.length}件の履歴書を取り込みました`}</strong><small>{zh ? '机器抽取结果仍需人工逐项确认' : '機械抽出結果は項目ごとの確認が必要です'}</small></div></header>
    <div>{block.imported.map((item) => <section key={item.documentId}><span><strong>{item.label}</strong><small>{zh ? '本地加密文件' : '端末内暗号化ファイル'}</small></span><div>{onOpenCandidate ? <button onClick={() => onOpenCandidate(item.documentId, 'resume')} type="button">{zh ? '查看草稿' : '下書きを見る'}</button> : null}{onOpenOriginalDocument ? <button onClick={() => onOpenOriginalDocument(item.documentId)} type="button"><Icon name="file" size={12} />{zh ? '打开文件' : 'ファイルを開く'}</button> : null}</div></section>)}</div>
    <AgentBlockActions>{onOpenReviews ? <button onClick={onOpenReviews} type="button"><Icon name="shield" size={13} />{zh ? '前往审核中心' : 'レビューセンターへ'}</button> : null}{block.failedCount > 0 ? <span className="agent-import-failed">{zh ? `${block.failedCount} 份导入失败` : `${block.failedCount}件の取込に失敗`}</span> : null}</AgentBlockActions>
  </article>
}

function CandidateDraftFactsView({ facts, zh, onOpenCandidate, onOpenOriginalDocument, onOpenReviews }: {
  facts: AgentCandidateDraftFacts
  zh: boolean
  onOpenCandidate?(sourceDocumentId: string, view?: CandidateRouteView): void
  onOpenOriginalDocument?(sourceDocumentId: string): void
  onOpenReviews?(): void
}) {
  const visibleFields = facts.fields.filter((field) => field.status !== 'missing')
  const visibleProjects = facts.projects.slice(0, 5)
  return <article className="agent-draft-facts">
    <header className="agent-draft-header">
      <span><Icon name="file" size={15} /></span>
      <div>
        <strong>{facts.label} · {zh ? '简历内容' : '履歴書の内容'}</strong>
        <small>{zh ? `${visibleFields.length} 个已识别字段 · ${facts.projects.length} 段项目经历` : `識別済み${visibleFields.length}項目 · プロジェクト${facts.projects.length}件`}</small>
      </div>
    </header>
    <p className="agent-draft-warning">
      <Icon name="alert" size={13} />
      <span>{zh ? '以下为机器抽取的未确认草稿，已作为本会话上下文；任何字段经人工确认后才会成为候选人档案。' : '以下は機械抽出の未確認下書きで、この会話のコンテキストとして保存されます。担当者が確認するまで候補者プロフィールにはなりません。'}</span>
    </p>
    <dl>{visibleFields.map((field) => <div key={field.label}>
      <dt>{field.label}</dt>
      <dd>{field.value ?? '—'}<small>{field.sources.join(' · ')}</small></dd>
    </div>)}</dl>
    {visibleProjects.length > 0 ? <ol className="agent-draft-projects">{visibleProjects.map((project, index) => <li key={`${project.title}-${index}`}>
      <strong>{project.title}</strong>
      <span>{[project.period, project.role].filter(Boolean).join(' · ')}</span>
      {project.technologies.length > 0 ? <span>{project.technologies.join('、')}</span> : null}
      {project.summary ? <p>{project.summary}</p> : null}
      <small>{project.sources.join(' · ')}</small>
    </li>)}</ol> : null}
    <AgentBlockActions>
      {onOpenCandidate ? <button onClick={() => onOpenCandidate(facts.documentId, 'resume')} type="button"><Icon name="users" size={13} />{zh ? '打开候选人草稿' : '候補者下書きを開く'}</button> : null}
      {onOpenOriginalDocument ? <button onClick={() => onOpenOriginalDocument(facts.documentId)} type="button"><Icon name="file" size={13} />{zh ? '打开原文件' : '元ファイルを開く'}</button> : null}
      {onOpenReviews && facts.reviewStatus === 'awaiting-review' ? <button onClick={onOpenReviews} type="button"><Icon name="shield" size={13} />{zh ? '去审核' : 'レビューする'}</button> : null}
    </AgentBlockActions>
  </article>
}

function systemAccessContent(block: AgentSystemAccessBlock, zh: boolean): {
  icon: IconName
  title: string
  description: string
  action: string
} {
  if (block.destination === 'job-cases') return {
    icon: 'briefcase',
    title: zh ? '案件管理' : '案件管理',
    description: zh ? '查看、选择或继续维护系统中的案件记录。' : 'システム内の案件を確認・選択・更新します。',
    action: zh ? '打开案件管理' : '案件管理を開く'
  }
  if (block.destination === 'case-import') return {
    icon: 'upload',
    title: zh ? '导入案件' : '案件を取り込む',
    description: zh ? '在右侧创建本机案件草稿并进入人工审核。' : '右側でローカル案件下書きを作成し、人の確認へ進みます。',
    action: zh ? '打开案件导入' : '案件取込を開く'
  }
  if (block.destination === 'case-review') return {
    icon: 'briefcase',
    title: zh ? '案件详情' : '案件詳細',
    description: zh ? '在右侧查看结构化案件字段与审核状态。' : '右側で構造化案件項目と確認状態を表示します。',
    action: zh ? '打开案件详情' : '案件詳細を開く'
  }
  if (block.destination === 'matching') return {
    icon: 'users',
    title: zh ? '完整匹配工作台' : '詳細マッチング',
    description: zh ? '进入结构化匹配结果，查看完整证据和候选人排序。' : '構造化された根拠と候補者順位を確認します。',
    action: zh ? '打开完整匹配' : '詳細マッチングを開く'
  }
  if (block.destination === 'candidate-management') return {
    icon: 'users',
    title: zh ? '候选人管理' : '候補者管理',
    description: zh ? '查看候选人档案、招聘进度和面试记录。' : '候補者プロフィール、採用状況、面談記録を確認します。',
    action: zh ? '打开候选人管理' : '候補者管理を開く'
  }
  if (block.destination === 'candidate') {
    const records = !['overview', 'resume'].includes(block.view)
    const resume = block.view === 'resume'
    return {
      icon: resume ? 'file' : records ? 'clock' : 'users',
      title: resume
        ? (zh ? '候选人简历草稿' : '候補者履歴書下書き')
        : records ? (zh ? '候选人面试记录' : '候補者面談記録') : (zh ? '候选人档案' : '候補者プロフィール'),
      description: resume
        ? (zh ? '进入该候选人的简历抽取与人工确认页面。' : '履歴書の抽出内容と確認画面を開きます。')
        : records ? (zh ? '查看该候选人的全部面试轮次和处理状态。' : 'この候補者の面談ラウンドと処理状況を確認します。') : (zh ? '查看该候选人的结构化档案与业务状态。' : '構造化プロフィールと業務ステータスを確認します。'),
      action: resume
        ? (zh ? '打开简历草稿' : '履歴書下書きを開く')
        : records ? (zh ? '打开面试记录' : '面談記録を開く') : (zh ? '打开候选人档案' : '候補者プロフィールを開く')
    }
  }
  if (block.destination === 'original-document') return {
    icon: 'file',
    title: zh ? '原始简历' : '原始履歴書',
    description: zh ? '在右侧本机解密显示原始文件，对话只读取脱敏结构化投影。' : '右側で原始ファイルを端末内復号表示し、会話は脱敏済み構造化投影だけを参照します。',
    action: zh ? '查看原始简历' : '原始履歴書を見る'
  }
  if (block.destination === 'review-center') return {
    icon: 'shield',
    title: zh ? '审核中心' : 'レビューセンター',
    description: zh ? '逐项确认机器抽取内容，再形成正式候选人档案。' : '機械抽出項目を確認して正式な候補者プロフィールにします。',
    action: zh ? '打开审核中心' : 'レビューセンターを開く'
  }
  if (block.destination === 'task') return {
    icon: 'tasks',
    title: zh ? '任务详情' : 'タスク詳細',
    description: zh ? '在右侧查看任务状态、进度、范围和证据数量。' : '右側でタスク状態、進捗、範囲と証跡数を確認します。',
    action: zh ? '打开任务详情' : 'タスク詳細を開く'
  }
  return {
    icon: 'clock',
    title: zh ? '面试日程' : '面談日程',
    description: zh ? '在日历中查看、修改并继续处理招聘和客户面试。' : 'カレンダーで採用・顧客面談を確認、変更、処理します。',
    action: zh ? '打开面试日程' : '面談日程を開く'
  }
}

function InterviewReceiptView({ block, zh, onOpen, onOpenCandidate }: {
  block: Extract<AgentSystemAccessBlock, { destination: 'interview-schedule' }>
  zh: boolean
  onOpen?(access: AgentSystemAccessBlock): void
  onOpenCandidate?(sourceDocumentId: string, view?: CandidateRouteView): void
}) {
  const receipt = block.receipt
  if (!receipt) return null
  const methodLabel = {
    zoom: 'Zoom',
    'google-meet': 'Google Meet',
    phone: zh ? '电话' : '電話',
    onsite: zh ? '现场' : '対面'
  }[receipt.meetingMethod]
  return <div className="agent-result-group">
    <article className="agent-interview-receipt">
      <span className="agent-interview-receipt-icon"><Icon name="clock" size={22} /></span>
      <div className="agent-interview-receipt-content">
        <header><strong>{zh ? '面试已登记' : '面談を登録しました'}</strong><span><Icon name="check" size={13} />{zh ? '已保存' : '保存済み'}</span></header>
        <p>{formatJstDateTime(receipt.scheduledAt)} · {receipt.durationMinutes} {zh ? '分钟' : '分'} · {methodLabel}</p>
        {receipt.meetingLinkStoredLocally ? <small>{zh ? `${methodLabel} 链接已在本机保存` : `${methodLabel} リンクは端末内に保存済み`}</small> : null}
      </div>
      <div className="agent-interview-receipt-actions">
        <button className="is-primary" disabled={!onOpen} onClick={() => onOpen?.(block)} type="button">{zh ? '打开面试日程' : '面談日程を開く'}</button>
        <button disabled={!onOpenCandidate} onClick={() => onOpenCandidate?.(receipt.sourceDocumentId, 'schedule')} type="button">{zh ? '修改' : '変更'}</button>
      </div>
    </article>
    {onOpenCandidate ? <section className="agent-next-actions" aria-label={zh ? '接下来可以' : '次にできること'}>
      <strong>{zh ? '接下来可以' : '次にできること'}</strong>
      <div>
        <button onClick={() => onOpenCandidate(receipt.sourceDocumentId, 'prepare')} type="button"><Icon name="sparkles" size={14} />{zh ? '准备面试问题' : '質問を準備'}</button>
        <button onClick={() => onOpenCandidate(receipt.sourceDocumentId, 'resume')} type="button"><Icon name="file" size={14} />{zh ? '查看候选人简历' : '履歴書を見る'}</button>
        <button onClick={() => onOpenCandidate(receipt.sourceDocumentId, 'schedule')} type="button"><Icon name="users" size={14} />{zh ? '安排下一轮' : '次の面談を設定'}</button>
      </div>
    </section> : null}
  </div>
}

function SystemAccessView({ block, zh, onOpen, onOpenCandidate }: {
  block: AgentSystemAccessBlock
  zh: boolean
  onOpen?(access: AgentSystemAccessBlock): void
  onOpenCandidate?(sourceDocumentId: string, view?: CandidateRouteView): void
}) {
  if (block.destination === 'interview-schedule' && block.receipt) {
    return <InterviewReceiptView block={block} onOpen={onOpen} onOpenCandidate={onOpenCandidate} zh={zh} />
  }
  if (block.destination === 'interview-schedule') {
    return <article className="agent-interview-receipt is-legacy">
      <span className="agent-interview-receipt-icon"><Icon name="clock" size={22} /></span>
      <div className="agent-interview-receipt-content">
        <header><strong>{zh ? '面试已登记' : '面談を登録しました'}</strong><span><Icon name="check" size={13} />{zh ? '已保存' : '保存済み'}</span></header>
        <p>{zh ? '可在面试日程中查看或修改这条本地记录。' : '面談日程からこのローカル記録を確認・変更できます。'}</p>
      </div>
      <div className="agent-interview-receipt-actions">
        <button className="is-primary" disabled={!onOpen} onClick={() => onOpen?.(block)} type="button">{zh ? '打开面试日程' : '面談日程を開く'}</button>
      </div>
    </article>
  }
  const content = systemAccessContent(block, zh)
  return <article className="agent-system-access-card">
    <span className="agent-system-access-icon"><Icon name={content.icon} size={17} /></span>
    <div><small>{zh ? '本系统入口' : 'システム内リンク'}</small><strong>{content.title}</strong><p>{content.description}</p></div>
    <button disabled={!onOpen} onClick={() => onOpen?.(block)} type="button">{content.action}<Icon name="chevron-right" size={13} /></button>
  </article>
}

function BlockView({ block, locale, zh, onSelectCase, onOpenCandidate, onOpenMatching, onOpenOriginalDocument, onOpenReviews, onOpenSystemAccess, currentCaseId }: {
  block: AiConversationBlock
  locale: string
  zh: boolean
  onSelectCase(reference: TypedAiConversationReference): void
  onOpenCandidate?(sourceDocumentId: string, view?: CandidateRouteView, interviewId?: string | null, interviewKind?: 'recruiting' | 'client'): void
  onOpenMatching(jobCaseId: string): void
  onOpenOriginalDocument?(sourceDocumentId: string): void
  onOpenReviews?(): void
  onOpenSystemAccess?(access: AgentSystemAccessBlock): void
  currentCaseId: string | null
}) {
  if (block.type === 'text') return <p className="agent-block-text">{block.text}</p>
  if (block.type === 'job-case-cards') return <div className="agent-card-stack">{block.cards.map((card) => <JobCaseCardView card={card} key={card.reference.objectId} onOpenMatching={onOpenMatching} onSelect={onSelectCase} zh={zh} />)}</div>
  if (block.type === 'candidate-match-cards') return <div className="agent-card-stack">{block.cards.map((card) => <CandidateCardView card={card} currentCaseId={currentCaseId} key={card.reference.objectId} onOpenCandidate={onOpenCandidate ? (sourceDocumentId) => onOpenCandidate(sourceDocumentId, 'overview') : undefined} onOpenMatching={onOpenMatching} zh={zh} />)}</div>
  if (block.type === 'candidate-profile-evidence') return <CandidateProfileEvidenceView block={block} onOpenCandidate={onOpenCandidate} onOpenOriginalDocument={onOpenOriginalDocument} zh={zh} />
  if (block.type === 'candidate-interview-evidence') return <CandidateInterviewEvidenceView block={block} locale={locale} onOpenCandidate={onOpenCandidate} zh={zh} />
  if (block.type === 'clarification') return <div className="agent-clarification"><strong>{block.prompt}</strong>{block.options.length > 0 ? <div>{block.options.map((option) => <button key={`${option.kind}-${option.objectId}`} onClick={() => onSelectCase(option)} type="button">{option.ordinal ? `${option.ordinal}. ` : ''}{option.label}</button>)}</div> : null}</div>
  if (block.type === 'match-run-explanation') {
    const facts = block.facts
    return <div className="agent-explanation"><div className="agent-explanation-grid"><span><strong>Match Run</strong>{facts.runId.slice(0, 12)}</span><span><strong>Result Hash</strong>{facts.resultHash.slice(0, 12)}</span><span><strong>{zh ? '状态' : '状態'}</strong>{statusLabel(facts.validity, zh)}</span><span><strong>{zh ? '算法' : 'アルゴリズム'}</strong>{facts.algorithmVersion}</span></div><p>{zh ? '以上解释来自已保存的 Result Snapshot，没有重新运行本地匹配。' : '保存済みの Result Snapshot を読み取りました。マッチングは再実行していません。'}</p>{currentCaseId ? <AgentBlockActions><button disabled={facts.validity === 'deleted'} onClick={() => onOpenMatching(currentCaseId)} type="button">{zh ? '打开完整匹配' : '詳細マッチングを開く'}<Icon name="chevron-right" size={12} /></button>{facts.candidate?.sourceDocumentId && onOpenCandidate ? <button disabled={facts.validity === 'deleted'} onClick={() => onOpenCandidate(facts.candidate!.sourceDocumentId!, 'overview')} type="button">{zh ? '打开候选人' : '候補者を開く'}</button> : null}</AgentBlockActions> : null}</div>
  }
  if (block.type === 'resume-import') return <ResumeImportView block={block} onOpenCandidate={onOpenCandidate} onOpenOriginalDocument={onOpenOriginalDocument} onOpenReviews={onOpenReviews} zh={zh} />
  if (block.type === 'candidate-draft-facts') return <CandidateDraftFactsView facts={block.facts} onOpenCandidate={onOpenCandidate} onOpenOriginalDocument={onOpenOriginalDocument} onOpenReviews={onOpenReviews} zh={zh} />
  if (block.type === 'system-access') return <SystemAccessView block={block} onOpen={onOpenSystemAccess} onOpenCandidate={onOpenCandidate} zh={zh} />
  return <div className="agent-error-block" role="alert"><Icon name="alert" size={15} /><span>{userFacingAgentError(block.message, zh)}</span></div>
}

interface AgentEmptyStateProps {
  cloudConnected: boolean
  pendingReviewCount: number
  selectedCase: TypedAiConversationReference | null
  suggestions: string[]
  zh: boolean
  onImportResume?(): void
  onOpenCaseImport?(): void
  onOpenReviews?(): void
  onSuggestion(suggestion: string): void
}

function AgentEmptyState({
  cloudConnected,
  pendingReviewCount,
  selectedCase,
  suggestions,
  zh,
  onImportResume,
  onOpenCaseImport,
  onOpenReviews,
  onSuggestion
}: AgentEmptyStateProps) {
  const hasQuickActions = Boolean(onImportResume || onOpenCaseImport || onOpenReviews)
  const title = !cloudConnected
    ? (zh ? '本地工作仍可继续' : 'ローカル業務は続けられます')
    : selectedCase
      ? (zh ? '开始处理当前案件' : '現在の案件を進める')
      : (zh ? '今天想推进什么工作？' : '今日は何を進めますか？')
  const description = !cloudConnected
    ? (zh
        ? '连接受管账号后可以使用自然语言；简历导入、案件导入和人工审核仍可在本机安全完成。'
        : '受管アカウント接続後は自然言語を利用できます。履歴書・案件の取込と人によるレビューは、この端末で安全に続けられます。')
    : selectedCase
      ? (zh
          ? '已绑定当前案件。可以匹配候选人、查看案件条件，或继续追问保存过的匹配依据。'
          : '現在の案件を選択済みです。候補者のマッチング、条件確認、保存済み根拠への追加質問ができます。')
      : (zh
          ? '从案件、人才或面谈开始。AI 负责理解请求，事实、执行和业务状态仍由受控本地工具与人工审核决定。'
          : '案件・人材・面談から始められます。AI は依頼を理解し、事実・実行・業務状態は制御済みローカル Tool と人のレビューが決定します。')

  return <div className="agent-empty-state">
    <span className="agent-empty-mark"><Icon name={cloudConnected ? 'sparkles' : 'shield'} size={24} /></span>
    <h2>{title}</h2>
    <p>{description}</p>
    {cloudConnected ? <div aria-label={zh ? '建议指令' : 'おすすめの指示'} className="agent-starter-prompts" role="group">
      {suggestions.map((suggestion) => <button key={suggestion} onClick={() => onSuggestion(suggestion)} type="button">{suggestion}</button>)}
    </div> : null}
    {hasQuickActions ? <div aria-label={zh ? '快捷操作' : 'クイック操作'} className="agent-quick-actions" role="group">
      {onImportResume ? <AgentQuickAction
        description={zh ? '本地解析，逐项审核后入库' : 'ローカル解析後、項目ごとにレビュー'}
        icon="upload"
        label={zh ? '导入简历' : '履歴書を取り込む'}
        onClick={onImportResume}
      /> : null}
      {onOpenCaseImport ? <AgentQuickAction
        description={zh ? '粘贴、EML 或受管 Gmail' : '貼付・EML・受管 Gmail'}
        icon="briefcase"
        label={zh ? '导入案件' : '案件を取り込む'}
        onClick={onOpenCaseImport}
      /> : null}
      {onOpenReviews ? <AgentQuickAction
        description={pendingReviewCount > 0
          ? (zh ? `${pendingReviewCount} 项等待人工确认` : `${pendingReviewCount}件が人の確認待ち`)
          : (zh ? '查看已完成和待确认项目' : '完了・確認待ちの項目を見る')}
        icon="shield"
        label={zh ? '打开审核中心' : 'レビューセンターを開く'}
        onClick={onOpenReviews}
      /> : null}
    </div> : null}
  </div>
}

export function AgentWorkspace({
  activeSystemAccess = null,
  contextPanel,
  contextPanelLabel,
  onCloseContextPanel,
  onOpenMatching,
  onOpenCandidate,
  onOpenOriginalDocument,
  reloadToken = 0,
  models = fallbackModels,
  defaultModelKey = 'gpt-5.6-luna',
  cloudConnected = true,
  onConnectCloud,
  onImportResume,
  onOpenCaseImport,
  onOpenCases,
  onOpenSystemAccess,
  status,
  onOpenReviews,
  onOpenSettings,
  onOpenOperatorProfile,
  operatorLabel = 'SES',
  onLocalDataChanged
}: AgentWorkspaceProps) {
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const context = useMemo(() => ({
    assistant: 'sales-agent' as const,
    candidateDocumentId: null,
    interviewId: null,
    interviewKind: null,
    roundNumber: null
  }), [])
  const history = useAiConversationHistory(context, reloadToken)
  const activeConversation = history.conversations.find((item) => item.id === history.activeConversationId) ?? null
  const historyView = useMemo(
    () => conversationHistoryView(history.conversations),
    [history.conversations]
  )
  // A conversation exists from the moment the workspace opens it, not from the
  // first message. Imports and selected context before the first turn must use
  // the same id as that eventual first turn.
  const [draftConversationId, setDraftConversationId] = useState(() => newId())
  // The active id is authoritative even during a transient history-array
  // refresh. Falling back based on a temporarily missing snapshot minted a new
  // draft id and could turn an ordinary follow-up into a new conversation.
  const currentConversationId = history.activeConversationId ?? draftConversationId
  const [draft, setDraft] = useState('')
  const [editingMessage, setEditingMessage] = useState<{ id: string; value: string } | null>(null)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [systemImporting, setSystemImporting] = useState(false)
  const [branchPreviewMessages, setBranchPreviewMessages] = useState<AiConversationMessage[] | null>(null)
  const [requestConversationId, setRequestConversationId] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [caseSelection, setCaseSelection] = useState<{
    conversationId: string
    reference: TypedAiConversationReference | null
  } | null>(null)
  const persistedSelectedCase = typedReference(activeConversation?.salesAgentState?.selectedJobCaseRef)
  const selectedCase = caseSelection?.conversationId === currentConversationId
    ? caseSelection.reference
    : persistedSelectedCase
  const [error, setError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [contextPanelWidth, setContextPanelWidth] = useState(() => {
    try {
      const stored = Number(globalThis.localStorage?.getItem('ses-agent-context-panel-width-v1'))
      return Number.isFinite(stored) && stored >= 380 && stored <= 720 ? stored : 500
    } catch {
      return 500
    }
  })
  const contextPanelResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const availableModels = models.length > 0 ? models : fallbackModels
  const [selectedModelKey, setSelectedModelKey] = useState(() => {
    let stored: string | null = null
    try { stored = globalThis.sessionStorage?.getItem(agentModelSessionKey) ?? null } catch { stored = null }
    return availableModels.some((model) => model.key === stored)
      ? stored!
      : availableModels.some((model) => model.key === defaultModelKey) ? defaultModelKey : availableModels[0]!.key
  })
  const activeRequestRef = useRef<{ conversationId: string; requestId: string; sequence: number; stopRequested: boolean } | null>(null)
  const copyResetTimerRef = useRef<number | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const messageScrollRef = useRef<HTMLDivElement>(null)
  const currentConversationIdRef = useRef(currentConversationId)
  currentConversationIdRef.current = currentConversationId
  const [streamState, setStreamState] = useState<{
    conversationId: string
    requestId: string
    sequence: number
    content: string
    phase: 'planning' | 'local-tool' | 'connecting-model' | 'streaming' | 'stopping'
    modelDisplayName: string
  } | null>(null)

  useEffect(() => {
    if (!history.activeConversationId) return
    currentConversationIdRef.current = history.activeConversationId
    setDraftConversationId(history.activeConversationId)
  }, [history.activeConversationId])

  useEffect(() => {
    if (availableModels.some((model) => model.key === selectedModelKey)) return
    const next = availableModels.some((model) => model.key === defaultModelKey) ? defaultModelKey : availableModels[0]!.key
    setSelectedModelKey(next)
  }, [availableModels, defaultModelKey, selectedModelKey])

  useEffect(() => {
    try { globalThis.sessionStorage?.setItem(agentModelSessionKey, selectedModelKey) } catch { /* session persistence is best-effort */ }
  }, [selectedModelKey])

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current)
  }, [])

  useEffect(() => {
    if (!contextPanel || !onCloseContextPanel) return undefined
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCloseContextPanel()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [contextPanel, onCloseContextPanel])

  const clampContextPanelWidth = (value: number): number => {
    const available = typeof window === 'undefined' ? 720 : Math.max(380, window.innerWidth - 690)
    return Math.round(Math.min(Math.max(value, 380), Math.min(720, available)))
  }

  const startContextPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    contextPanelResizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: contextPanelWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const resizeContextPanel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = contextPanelResizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    setContextPanelWidth(clampContextPanelWidth(resize.startWidth + resize.startX - event.clientX))
  }

  const finishContextPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (contextPanelResizeRef.current?.pointerId !== event.pointerId) return
    contextPanelResizeRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    try { globalThis.localStorage?.setItem('ses-agent-context-panel-width-v1', String(contextPanelWidth)) } catch { /* best-effort UI preference */ }
  }

  useEffect(() => {
    if (typeof window.sesAgent.onAgentTurnEvent !== 'function') return undefined
    return window.sesAgent.onAgentTurnEvent((event) => {
      const active = activeRequestRef.current
      if (!active || event.conversationId !== active.conversationId || event.requestId !== active.requestId) return
      if (event.sequence <= active.sequence) return
      active.sequence = event.sequence
      if (event.type === 'delta') {
        if (active.stopRequested) return
        setStreamState((current) => current && current.conversationId === event.conversationId && current.requestId === event.requestId
          ? { ...current, sequence: event.sequence, phase: 'streaming', content: current.content + event.text }
          : current)
        return
      }
      if (event.type === 'started') {
        if (active.stopRequested && event.phase !== 'stopping') return
        setStreamState((current) => ({
          conversationId: event.conversationId,
          requestId: event.requestId,
          sequence: event.sequence,
          content: current?.conversationId === event.conversationId && current.requestId === event.requestId ? current.content : '',
          phase: event.phase,
          modelDisplayName: event.modelDisplayName
        }))
        return
      }
      if (event.type === 'failed' || event.type === 'cancelled') setError(event.message)
    })
  }, [])

  const selectCase = (reference: TypedAiConversationReference) => {
    if (reference.kind !== 'job-case') return
    setCaseSelection({ conversationId: currentConversationId, reference })
    if (!activeConversation) return
    void history.persistSalesAgentState({
      selectedJobCaseRef: reference,
      lastMatchRunId: activeConversation.salesAgentState?.lastMatchRunId ?? null,
      lastSearchMessageId: activeConversation.salesAgentState?.lastSearchMessageId ?? null
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : (zh ? '当前案件上下文保存失败。' : '現在の案件コンテキストを保存できませんでした。'))
    })
  }

  const clearSelectedCase = () => {
    setCaseSelection({ conversationId: currentConversationId, reference: null })
    if (!activeConversation) return
    void history.persistSalesAgentState({
      selectedJobCaseRef: null,
      lastMatchRunId: activeConversation.salesAgentState?.lastMatchRunId ?? null,
      lastSearchMessageId: activeConversation.salesAgentState?.lastSearchMessageId ?? null
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : (zh ? '清除案件上下文失败。' : '案件コンテキストを解除できませんでした。'))
    })
  }

  const openOriginalFile = (sourceDocumentId: string) => {
    if (!onOpenOriginalDocument) return
    setError(null)
    void onOpenOriginalDocument(sourceDocumentId).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : (zh ? '无法打开原文件。' : '元ファイルを開けませんでした。'))
    })
  }

  const [attachments, setAttachments] = useState<Array<StagedLocalFile & { taskId: string; preview?: AgentCandidateDraftFacts; previewError?: string }>>([])
  const [importing, setImporting] = useState(false)
  const [importSummary, setImportSummary] = useState<{ imported: number; failed: number } | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  const importResumeFromCard = async () => {
    if (!onImportResume || systemImporting) return
    const targetConversationId = currentConversationIdRef.current
    setSystemImporting(true)
    setError(null)
    try {
      const conversation = await onImportResume(targetConversationId)
      if (!conversation) return
      // Bind completion to the conversation that opened the native picker. A
      // late import may never overwrite a different conversation.
      if (currentConversationIdRef.current === targetConversationId) {
        history.acceptConversation(conversation)
        setDraftConversationId(conversation.id)
        setCaseSelection({
          conversationId: conversation.id,
          reference: typedReference(conversation.salesAgentState?.selectedJobCaseRef) ?? selectedCase
        })
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (zh ? '无法将导入结果加入当前会话。' : '取込結果を現在の会話に追加できませんでした。'))
    } finally {
      setSystemImporting(false)
    }
  }

  /**
   * Hands dropped bytes to the main process, which decides the real format from
   * magic bytes and returns vault tokens. The renderer never sees a path and
   * never decides what a file is.
   */
  const attachFiles = async (files: File[]) => {
    const accepted = files.slice(0, 10)
    if (accepted.length === 0 || attaching) return
    const attachmentConversationId = currentConversationIdRef.current
    setAttaching(true)
    setError(null)
    try {
      const payload = await Promise.all(accepted.map(async (file) => ({
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer())
      })))
      const staged = await window.sesAgent.stageDroppedResumeFiles({ files: payload })
      if (!staged.cancelled && currentConversationIdRef.current === attachmentConversationId) {
        const taskId = staged.task.id
        setAttachments((current) => [...current, ...staged.files.map((file) => ({ ...file, taskId }))].slice(0, 10))
        setImportSummary(null)
        // Parse immediately so the operator can read what is in the file before
        // deciding to import it. Nothing is written until they choose.
        for (const file of staged.files) {
          void window.sesAgent.previewStagedResumeFile({ fileToken: file.token })
            .then((preview) => {
              if (currentConversationIdRef.current !== attachmentConversationId) return
              setAttachments((current) => current.map((item) => item.token === file.token ? { ...item, preview } : item))
            })
            .catch((cause: unknown) => {
              if (currentConversationIdRef.current !== attachmentConversationId) return
              setAttachments((current) => current.map((item) => item.token === file.token
                ? { ...item, previewError: cause instanceof Error ? cause.message : 'parse failed' }
                : item))
            })
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (zh ? '附件暂存失败。' : '添付ファイルを保存できませんでした。'))
    } finally {
      setAttaching(false)
    }
  }

  /**
   * Imports the attachments without going through the model. The file type is
   * already decided deterministically by magic bytes, so routing this through a
   * language model would only add a way for it to be wrong.
   */
  const importAttachmentsDirectly = async () => {
    if (attachments.length === 0 || importing) return
    const conversationId = currentConversationId
    const filesToImport = [...attachments]
    setImporting(true)
    setError(null)
    const importedFiles: typeof filesToImport = []
    let failed = 0
    try {
      for (const file of filesToImport) {
        try {
          const execution = await window.sesAgent.analyzeResumeFile({
            fileToken: file.token,
            taskId: file.taskId,
            // Ties the import to this conversation, so "the one I just imported"
            // means the same thing whether the button or the agent did it.
            conversationId
          })
          if (execution.conversation) {
            history.acceptConversation(execution.conversation)
            setDraftConversationId(execution.conversation.id)
          }
          importedFiles.push(file)
        } catch {
          failed += 1
        }
      }
      const importedTokens = new Set(importedFiles.map((file) => file.token))
      setAttachments((current) => current.filter((file) => !importedTokens.has(file.token)))
      if (importedFiles.length > 0) await onLocalDataChanged?.()
      setImportSummary({ imported: importedFiles.length, failed })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (zh ? '简历已解析，但未能写入当前会话上下文。' : '履歴書は解析されましたが、現在の会話コンテキストに保存できませんでした。'))
    } finally {
      setImporting(false)
    }
  }

  const executeMessage = async (message: string, options: {
    conversationId: string
    expectedConversationRevision: number | null
    selectedJobCaseRef: TypedAiConversationReference | null
    attachmentFileTokens: string[]
    clearComposer: boolean
    branchFrom?: ExecuteAgentTurnInput['branchFrom']
  }) => {
    if (!message || pendingMessage || history.saving || attaching || importing) return
    const conversationId = options.conversationId
    const currentRequestId = newId()
    const lockedModelKey = selectedModelKey
    setPendingMessage(message)
    if (options.clearComposer) setDraft('')
    setRequestConversationId(conversationId)
    setRequestId(currentRequestId)
    activeRequestRef.current = { conversationId, requestId: currentRequestId, sequence: 0, stopRequested: false }
    setStreamState({
      conversationId,
      requestId: currentRequestId,
      sequence: 0,
      content: '',
      phase: 'planning',
      modelDisplayName: availableModels.find((model) => model.key === lockedModelKey)?.displayName ?? lockedModelKey
    })
    setError(null)
    try {
      const result = await window.sesAgent.executeAgentTurn({
        conversationId,
        message,
        expectedConversationRevision: options.expectedConversationRevision,
        requestId: currentRequestId,
        modelKey: lockedModelKey,
        selectedJobCaseRef: options.selectedJobCaseRef,
        ...(!options.branchFrom ? { activeSystemAccess } : {}),
        attachmentFileTokens: options.attachmentFileTokens,
        ...(options.branchFrom ? { branchFrom: options.branchFrom } : {})
      })
      // Attachments outlive the turn on purpose: the operator asks about a file
      // first and decides to import it afterwards. They are cleared only once an
      // import actually happened, or when the operator removes them.
      if (result.toolName === 'resume.analyze.local') {
        setAttachments([])
      }
      history.acceptConversation(result.conversation)
      setDraftConversationId(result.conversation.id)
      const nextSelected = typedReference(result.conversation.salesAgentState?.selectedJobCaseRef)
      setCaseSelection({ conversationId, reference: nextSelected })
      if (
        result.toolName === 'resume.analyze.local' ||
        result.toolName === 'candidate.interview.schedule.local'
      ) {
        try {
          await onLocalDataChanged?.()
        } catch {
          setError((current) => current ?? (zh
            ? '本地操作已经完成，但界面数据刷新失败。重新打开对应页面后可再次加载。'
            : 'ローカル操作は完了しましたが、画面データを更新できませんでした。対象画面を開き直して再読み込みしてください。'))
        }
      }
      if (result.status === 'failed') {
        setError((current) => current ?? (zh ? 'AI 处理失败；本地已获取的数据仍然保留。' : 'AI 処理に失敗しました。ローカルで取得したデータは保持されています。'))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (zh ? '本地 Agent 执行失败。' : 'Local Agent turn failed.'))
    } finally {
      setPendingMessage(null)
      setRequestConversationId(null)
      setRequestId(null)
      activeRequestRef.current = null
      setStreamState(null)
    }
  }

  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    const message = draft.trim()
    if (!message) return
    await executeMessage(message, {
      conversationId: currentConversationId,
      expectedConversationRevision: activeConversation?.revision ?? null,
      selectedJobCaseRef: selectedCase,
      attachmentFileTokens: attachments.map((file) => file.token),
      clearComposer: true
    })
  }

  const copyUserMessage = async (message: AiConversationMessage) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(message.content)
      setCopiedMessageId(message.id)
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current)
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopiedMessageId((current) => current === message.id ? null : current)
      }, 1_800)
    } catch {
      setError(zh ? '无法复制这条输入。' : 'この入力をコピーできませんでした。')
    }
  }

  const resendEditedMessage = async () => {
    if (!editingMessage || pendingMessage || history.saving || attaching || importing) return
    const messageIndex = history.messages.findIndex((message) => message.id === editingMessage.id && message.role === 'user')
    const editedContent = editingMessage.value.trim()
    if (messageIndex < 0 || !editedContent) return
    if (!activeConversation) {
      setEditingMessage(null)
      setError(zh ? '原会话已不存在，请重新打开后再编辑。' : '元の会話が見つかりません。開き直してから編集してください。')
      return
    }

    const prefixMessages = history.messages.slice(0, messageIndex)
    const branchConversationId = newId()
    setError(null)
    setAttachments([])
    setImportSummary(null)
    setBranchPreviewMessages(prefixMessages)
    // Leave edit mode before crossing IPC. Even a rejected branch request must
    // return the original conversation to a fully interactive state.
    setEditingMessage(null)
    try {
      await executeMessage(editedContent, {
        conversationId: branchConversationId,
        expectedConversationRevision: null,
        selectedJobCaseRef: null,
        attachmentFileTokens: [],
        clearComposer: false,
        branchFrom: {
          conversationId: activeConversation.id,
          messageId: editingMessage.id,
          expectedRevision: activeConversation.revision
        }
      })
    } finally {
      setBranchPreviewMessages(null)
    }
  }

  const stop = async () => {
    if (!requestId || !requestConversationId) return
    try {
      if (activeRequestRef.current) activeRequestRef.current.stopRequested = true
      setStreamState((current) => current ? { ...current, phase: 'stopping' } : current)
      const result = await window.sesAgent.cancelAgentTurn({ conversationId: requestConversationId, requestId })
      if (result.message) setError(result.message)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (zh ? '无法停止当前操作。' : 'Unable to stop the current operation.'))
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  const visibleMessages = branchPreviewMessages ?? history.messages
  const messages = pendingMessage
    ? [...visibleMessages, { id: 'agent-pending-message', role: 'user' as const, content: pendingMessage, mode: 'local' as const, createdAt: new Date().toISOString() }]
    : visibleMessages
  const workspaceContext = useMemo(
    () => deriveWorkspaceContext(visibleMessages, zh),
    [visibleMessages, zh]
  )
  const messageTimeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    hour: '2-digit', minute: '2-digit'
  }), [locale])

  useEffect(() => {
    const container = messageScrollRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
  }, [history.messages.length, branchPreviewMessages?.length, pendingMessage, streamState?.content])

  // Every suggestion maps to a capability the current allowlist can resolve.
  // A selected case unlocks matching-specific prompts; without one, the Agent
  // can still search cases or enumerate candidates that can enter scheduling.
  const emptyStateSuggestions = selectedCase
    ? (zh
        ? ['给当前案件匹配候选人', '这个案件的条件是什么？', '最近有什么案件？']
        : ['現在の案件に合う候補者を探して', 'この案件の条件は？', '最近の案件は？'])
    : (zh
        ? ['最近有什么案件？', '有哪些候选人可以安排面谈？', '有哪些进行中的案件？']
        : ['最近の案件は？', '面談を設定できる候補者は？', '進行中の案件は？'])
  // Initial history loading is read-only and sequence-guarded by the history
  // hook, so it must not block a fresh draft. Mutating work still locks the
  // workspace to prevent attachments or saves from crossing conversations.
  const mutationBusy = history.saving || pendingMessage !== null || attaching || importing || systemImporting
  const workspaceBusy = mutationBusy || editingMessage !== null
  const threadTitle = selectedCase && workspaceContext.candidateLabel
    ? `${selectedCase.label} · ${workspaceContext.candidateLabel}${workspaceContext.latestAccess?.destination === 'interview-schedule' ? (zh ? ' 面试' : ' 面談') : ''}`
    : workspaceContext.candidateLabel
      ? `${workspaceContext.candidateLabel}${workspaceContext.latestAccess?.destination === 'interview-schedule' ? (zh ? ' 面试' : ' 面談') : ''}`
      : selectedCase
        ? selectedCase.label
        : activeConversation?.title ?? (zh ? '新任务' : '新しいタスク')
  const hasBusinessContext = Boolean(selectedCase || workspaceContext.candidateLabel || workspaceContext.resultLabel)
  const deleteConversationThreads = async (conversationIds: string[]) => {
    const selectedRoots = new Set(conversationIds.map((conversationId) => {
      const conversation = history.conversations.find((item) => item.id === conversationId)
      return conversation ? historyView.lineageByConversationId.get(conversation.id) ?? conversation.id : conversationId
    }))
    const branchIds = history.conversations
      .filter((conversation) => selectedRoots.has(
        historyView.lineageByConversationId.get(conversation.id) ?? conversation.id
      ))
      .map((conversation) => conversation.id)
    await history.deleteConversations(branchIds)
  }

  const workspaceClassName = [
    'agent-workspace',
    historyOpen ? 'is-history-open' : '',
    contextPanel ? 'has-context-panel' : ''
  ].filter(Boolean).join(' ')
  const workspaceStyle = contextPanel
    ? { '--agent-context-panel-width': `${contextPanelWidth}px` } as CSSProperties
    : undefined

  return <main aria-label="SES Agent" className={workspaceClassName} style={workspaceStyle}>
    <aside className={historyOpen ? 'agent-workspace-history is-open' : 'agent-workspace-history'}>
      <AiConversationHistoryPanel
        activeConversationId={history.activeConversationId}
        busy={workspaceBusy}
        conversations={historyView.visible}
        error={history.error}
        loading={history.loading}
        onDelete={deleteConversationThreads}
        onNew={() => {
          onCloseContextPanel?.()
          const nextConversationId = newId()
          currentConversationIdRef.current = nextConversationId
          history.newConversation()
          setDraftConversationId(nextConversationId)
          setCaseSelection({ conversationId: nextConversationId, reference: null })
          setAttachments([])
          setImportSummary(null)
          setEditingMessage(null)
          setCopiedMessageId(null)
          setHistoryOpen(false)
        }}
        onSelect={(id) => {
          onCloseContextPanel?.()
          currentConversationIdRef.current = id
          history.selectConversation(id)
          setCaseSelection(null)
          setDraftConversationId(id)
          setAttachments([])
          setImportSummary(null)
          setEditingMessage(null)
          setCopiedMessageId(null)
          setHistoryOpen(false)
        }}
      />
      <footer className="agent-task-rail-footer">
        {onOpenSettings ? <button aria-label={zh ? '打开设置' : '設定を開く'} onClick={onOpenSettings} type="button"><Icon name="settings" size={19} /></button> : <span />}
        {onOpenOperatorProfile ? <button aria-label={zh ? '打开操作员档案' : '担当者プロフィールを開く'} className="agent-operator-button" onClick={onOpenOperatorProfile} title={operatorLabel} type="button">{operatorLabel.trim().slice(0, 1).toLocaleUpperCase(locale) || 'S'}</button> : null}
      </footer>
    </aside>
    {historyOpen ? <button aria-label={zh ? '关闭任务列表' : 'タスク一覧を閉じる'} className="agent-history-backdrop" onClick={() => setHistoryOpen(false)} type="button" /> : null}
    <section
      className={dragActive ? 'agent-workspace-main is-drag-active' : 'agent-workspace-main'}
      onDragOver={(event) => { event.preventDefault(); if (cloudConnected && !workspaceBusy) setDragActive(true) }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragActive(false) }}
      onDrop={(event) => {
        event.preventDefault()
        setDragActive(false)
        if (!cloudConnected || workspaceBusy) return
        void attachFiles([...event.dataTransfer.files])
      }}
    >
      <header className="agent-workspace-header">
        <button aria-label={zh ? '打开任务列表' : 'タスク一覧を開く'} className="agent-history-toggle" onClick={() => setHistoryOpen(true)} type="button"><Icon name="tasks" size={16} /></button>
        <div className="agent-thread-title">
          <h1>SES Agent</h1>
          <strong>{threadTitle}</strong>
        </div>
        <span className="agent-privacy-badge" title={zh ? 'AI 理解自然语言 + 受控本地 Tool + SSE 回答；仅发送已脱敏的最小上下文，不自动改变业务状态' : 'AI が自然言語を理解 + 制御済みローカル Tool + SSE 回答。脱敏済みの最小コンテキストのみを送信し、業務状態は変更しません'}><Icon name="shield" size={13} />{zh ? '仅发送脱敏内容' : '脱敏済みのみ送信'}</span>
      </header>
      {hasBusinessContext ? <nav aria-label={zh ? '当前任务上下文' : '現在のタスクコンテキスト'} className="agent-context-bar">
        <div className="agent-context-entities">
          {selectedCase ? <span><Icon name="briefcase" size={16} /><small>{zh ? '案件' : '案件'}</small><strong>{selectedCase.label}{selectedCase.objectVersion ? ` v${selectedCase.objectVersion}` : ''}</strong><button aria-label={zh ? '清除当前案件' : '現在の案件を解除'} disabled={history.saving} onClick={clearSelectedCase} type="button">×</button></span> : null}
          {workspaceContext.candidateLabel ? <span><Icon name="users" size={16} /><small>{zh ? '候选人' : '候補者'}</small><strong>{workspaceContext.candidateLabel}</strong></span> : null}
          {workspaceContext.resultLabel ? <span><Icon name="check" size={16} /><strong>{workspaceContext.resultLabel}</strong></span> : null}
        </div>
        <div className="agent-context-links">
          {selectedCase && onOpenCases ? <button onClick={onOpenCases} type="button">{zh ? '打开案件' : '案件を開く'}</button> : null}
          {workspaceContext.candidateDocumentId && onOpenCandidate ? <button onClick={() => onOpenCandidate(workspaceContext.candidateDocumentId!, 'resume')} type="button">{zh ? '打开简历' : '履歴書を開く'}</button> : null}
          {!workspaceContext.candidateDocumentId && workspaceContext.latestAccess && onOpenSystemAccess ? <button onClick={() => onOpenSystemAccess(workspaceContext.latestAccess!)} type="button">{zh ? '打开结果' : '結果を開く'}</button> : null}
        </div>
      </nav> : null}
      <div className="agent-message-scroll" aria-live="polite" ref={messageScrollRef}>
        {messages.length === 0 ? <AgentEmptyState
          cloudConnected={cloudConnected}
          onImportResume={onImportResume ? () => void importResumeFromCard() : undefined}
          onOpenCaseImport={onOpenCaseImport}
          onOpenReviews={onOpenReviews}
          onSuggestion={setDraft}
          pendingReviewCount={status?.pendingReviewCount ?? 0}
          selectedCase={selectedCase}
          suggestions={emptyStateSuggestions}
          zh={zh}
        /> : messages.map((message) => {
          const isEditing = message.role === 'user' && editingMessage?.id === message.id
          const hasUserActions = message.role === 'user' && message.id !== 'agent-pending-message'
          const structuredErrorRepeatsContent = message.role === 'assistant' && (message.blocks ?? []).some((block) =>
            block.type === 'error' && block.message.trim() === message.content.trim()
          )
          return <article className={`agent-message is-${message.role}${isEditing ? ' is-editing' : ''}`} key={message.id}>
            {message.role === 'assistant' ? <div className="agent-message-role"><Icon name="sparkles" size={13} /><strong>SES Agent</strong>{message.modelDisplayName ? <small>{message.modelDisplayName}</small> : null}</div> : null}
            <div className="agent-message-body">
              {isEditing && editingMessage
                ? <UserMessageEditor
                    busy={mutationBusy}
                    onCancel={() => setEditingMessage(null)}
                    onChange={(value) => setEditingMessage((current) => current?.id === message.id ? { ...current, value } : current)}
                    onSubmit={() => void resendEditedMessage()}
                    value={editingMessage.value}
                    zh={zh}
                  />
                : <>{structuredErrorRepeatsContent ? null : <MessageText message={message} />}{message.blocks?.map((block, index) => <BlockView block={block} currentCaseId={selectedCase?.kind === 'job-case' ? selectedCase.objectId : null} key={`${message.id}-block-${index}`} locale={locale} onOpenCandidate={onOpenCandidate} onOpenMatching={onOpenMatching} onOpenOriginalDocument={onOpenOriginalDocument ? openOriginalFile : undefined} onOpenReviews={onOpenReviews} onOpenSystemAccess={onOpenSystemAccess} onSelectCase={selectCase} zh={zh} />)}</>}
            </div>
            {hasUserActions && !isEditing ? <div aria-label={zh ? '输入消息操作' : '入力メッセージ操作'} className="agent-message-actions" role="group">
              <time dateTime={message.createdAt}>{messageTimeFormatter.format(new Date(message.createdAt))}</time>
              <button disabled={workspaceBusy} onClick={() => void copyUserMessage(message)} type="button"><Icon name={copiedMessageId === message.id ? 'check' : 'copy'} size={12} />{copiedMessageId === message.id ? (zh ? '已复制' : 'コピー済み') : (zh ? '复制' : 'コピー')}</button>
              <button disabled={workspaceBusy} onClick={() => { setCopiedMessageId(null); setError(null); setEditingMessage({ id: message.id, value: message.content }) }} type="button"><Icon name="edit" size={12} />{zh ? '编辑并重新发送' : '編集して再送信'}</button>
            </div> : null}
          </article>
        })}
        {pendingMessage && streamState?.content ? <article className="agent-message is-assistant is-streaming" data-testid="agent-streaming-message"><div className="agent-message-role"><Icon name="sparkles" size={13} /><strong>SES Agent</strong>{streamState.modelDisplayName ? <small>{streamState.modelDisplayName}</small> : null}</div><div className="agent-message-body"><AgentMarkdown content={streamState.content} /></div></article> : null}
        {pendingMessage ? <div className="agent-running-state" data-phase={streamState?.phase ?? 'planning'}><span className="agent-running-dot" />{streamState?.phase === 'planning' ? (zh ? '正在理解问题并选择 Tool…' : '質問を理解して Tool を選択中…') : streamState?.phase === 'connecting-model' ? (zh ? '正在整理 Tool 结果…' : 'Tool の結果を整理中…') : streamState?.phase === 'streaming' ? (zh ? '正在生成回答…' : '回答を生成中…') : streamState?.phase === 'stopping' ? (zh ? '正在停止本地读取并请求远端取消…' : 'ローカル読取を停止し、リモート取消を要求中…') : (zh ? '正在执行 AI 选择的受控本地 Tool…' : 'AI が選択した制御済みローカル Tool を実行中…')}</div> : null}
      </div>
      {error ? <p className="agent-workspace-error" role="alert"><Icon name="alert" size={14} />{error}</p> : null}
      {importSummary ? <p className="agent-attachment-progress">
        {zh
          ? `已导入 ${importSummary.imported} 份${importSummary.failed > 0 ? `，${importSummary.failed} 份失败` : ''}。请到审核中心逐项确认。`
          : `${importSummary.imported}件を取り込みました${importSummary.failed > 0 ? `（${importSummary.failed}件は失敗）` : ''}。レビューセンターで項目を確認してください。`}
        {onOpenReviews ? <button onClick={() => onOpenReviews()} type="button">{zh ? '打开审核中心' : 'レビューセンターを開く'}</button> : null}
      </p> : null}
      {attaching ? <p className="agent-attachment-progress">{zh ? '正在安全暂存附件…' : '添付ファイルを安全に保存しています…'}</p> : null}
      {cloudConnected ? <div className="agent-composer-shell">
        <div className="agent-composer-context">{zh ? '发送到：' : '送信先：'}<strong>{threadTitle}</strong>{activeSystemAccess ? <em><Icon name="sparkles" size={11} />{zh ? '读取右侧工作区' : '右ワークスペースを参照'}</em> : null}<span>⌄</span></div>
        <form aria-label={zh ? 'SES Agent 输入区' : 'SES Agent 入力欄'} className="agent-composer" onSubmit={send}>
        <input
          accept=".xls,.xlsx,.xlsb,.docx,.pdf"
          aria-label={zh ? '选择要附加到当前任务的简历' : '現在のタスクに添付する履歴書を選択'}
          hidden
          multiple
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])]
            event.currentTarget.value = ''
            void attachFiles(files)
          }}
          ref={attachmentInputRef}
          type="file"
        />
        {attachments.length > 0 ? <div className="agent-attachment-tray">{attachments.map((file) => <span key={file.token}>
          <span className="agent-attachment-glyph"><Icon name="file" size={16} /></span>
          <span className="agent-attachment-label"><strong>{file.name}</strong><small>{
            file.previewError ? (zh ? '解析失败' : '解析に失敗')
            : file.preview ? `${file.format.toLocaleUpperCase('en-US')} · ${zh ? '已解析' : '解析済み'} ${file.preview.fields.filter((field) => field.status !== 'missing').length}${zh ? ' 项' : '項目'}`
            : `${file.format.toLocaleUpperCase('en-US')} · ${zh ? '解析中…' : '解析中…'}`
          }</small></span>
          <button aria-label={zh ? `移除 ${file.name}` : `${file.name} を外す`} onClick={() => setAttachments((current) => current.filter((item) => item.token !== file.token))} type="button">×</button>
        </span>)}</div> : null}
        <textarea
          aria-label={zh ? '输入 SES Agent 指令' : 'SES Agent への指示'}
          disabled={workspaceBusy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={zh ? '继续询问当前案件、候选人或面试…' : '現在の案件、候補者、面談について続けて質問…'}
          rows={2}
          value={draft}
        />
        <footer>
          <div className="agent-composer-tools">
            <button
              aria-label={zh ? '附加简历' : '履歴書を添付'}
              className="agent-attachment-button"
              disabled={workspaceBusy}
              onClick={() => attachmentInputRef.current?.click()}
              type="button"
            ><Icon name="upload" size={15} /></button>
            {attachments.length > 0 ? <button className="agent-attachment-import" disabled={workspaceBusy} onClick={() => void importAttachmentsDirectly()} type="button">{importing ? (zh ? '导入中…' : '取込中…') : (zh ? '直接导入' : 'そのまま取込')}</button> : null}
            <div className="agent-model-control"><label htmlFor="agent-chat-model">{zh ? '回答模型' : '回答モデル'}</label><select aria-label={zh ? '选择回答模型' : '回答モデルを選択'} disabled={workspaceBusy} id="agent-chat-model" onChange={(event) => setSelectedModelKey(event.target.value)} value={selectedModelKey}>{availableModels.map((model) => <option key={model.key} value={model.key}>{model.displayName}</option>)}</select></div>
            <small>{pendingMessage ? (zh ? '停止是止损操作，不保证免费或退款。' : '停止は損失抑制であり、無料・返金を保証しません。') : `Enter ${zh ? '发送 · Shift+Enter 换行' : '送信 · Shift+Enter で改行'}`}</small>
          </div>
          {pendingMessage ? <button aria-label="停止" className="agent-stop" onClick={(event) => { event.preventDefault(); void stop() }} type="button"><Icon name="alert" size={14} />{zh ? '停止' : '停止'}</button> : <button aria-label={zh ? '发送' : '送信'} className="agent-send" disabled={!draft.trim() || workspaceBusy} type="submit"><Icon name="arrow-up" size={16} /></button>}
        </footer>
        </form>
      </div> : <div className="agent-connect-bar">
        <Icon name="lock" size={14} />
        <span>{zh ? '连接受管账号后即可开始对话。' : '受管アカウントに接続すると会話を開始できます。'}</span>
        <button onClick={() => onConnectCloud?.()} type="button">{zh ? '连接受管账号' : '受管アカウントに接続'}</button>
      </div>}
    </section>
    {contextPanel ? <aside aria-label={contextPanelLabel} className="agent-context-workspace">
      <div
        aria-label={zh ? '调整右侧工作区宽度' : '右ワークスペースの幅を調整'}
        aria-orientation="vertical"
        aria-valuemax={720}
        aria-valuemin={380}
        aria-valuenow={contextPanelWidth}
        className="agent-context-workspace-resizer"
        onDoubleClick={() => setContextPanelWidth(500)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          const next = clampContextPanelWidth(contextPanelWidth + (event.key === 'ArrowLeft' ? 24 : -24))
          setContextPanelWidth(next)
          try { globalThis.localStorage?.setItem('ses-agent-context-panel-width-v1', String(next)) } catch { /* best-effort UI preference */ }
        }}
        onPointerCancel={finishContextPanelResize}
        onPointerDown={startContextPanelResize}
        onPointerMove={resizeContextPanel}
        onPointerUp={finishContextPanelResize}
        role="separator"
        tabIndex={0}
      ><span /></div>
      {contextPanel}
    </aside> : null}
  </main>
}
