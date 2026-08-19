import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type {
  StagedLocalFile,
  AgentChatModelOption,
  AgentCandidateMatchCard,
  AgentJobCaseCard,
  AiConversationBlock,
  AiConversationMessage,
  AiConversationReference,
  TypedAiConversationReference
} from '@shared'
import { useUiLocale } from '../i18n'
import { Icon } from './Icon'
import { AiConversationHistoryPanel } from './AiConversationHistoryPanel'
import { AgentMarkdown } from './AgentMarkdown'
import { useAiConversationHistory } from './useAiConversationHistory'

interface AgentWorkspaceProps {
  onOpenMatching(jobCaseId: string): void
  reloadToken?: number
  models?: AgentChatModelOption[]
  defaultModelKey?: string
  /** Every turn needs the managed cloud connection; without it the composer is withheld. */
  cloudConnected?: boolean
  onConnectCloud?(): void
  /**
   * Counts the operator would otherwise have lost by not passing through the
   * dashboard. Sourced from the same bootstrap fields the sidebar badges use,
   * so the two can never disagree.
   */
  status?: AgentWorkspaceStatus
  onOpenReviews?(): void
}

export interface AgentWorkspaceStatus {
  eligibleCandidateCount: number
  pendingReviewCount: number
  runningJobCount: number
  backupReminder: 'not-needed' | 'due' | 'snoozed'
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

function statusLabel(status: 'current' | 'stale' | 'deleted', zh: boolean): string {
  if (status === 'current') return zh ? '当前' : '現在'
  if (status === 'stale') return zh ? '已过期' : '要再確認'
  return zh ? '已删除' : '削除済み'
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

function MessageText({ message }: { message: AiConversationMessage }) {
  return message.role === 'assistant'
    ? <AgentMarkdown content={message.content} />
    : <p className="agent-message-text">{message.content}</p>
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

function CandidateCardView({ card, zh, onOpenMatching, currentCaseId }: {
  card: AgentCandidateMatchCard
  zh: boolean
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
      <footer><button disabled={card.status === 'deleted' || !currentCaseId} onClick={() => currentCaseId && onOpenMatching(currentCaseId)} type="button">{zh ? '查看完整匹配结果' : '詳細なマッチ結果を見る'}<Icon name="chevron-right" size={13} /></button></footer>
    </article>
  )
}

function BlockView({ block, zh, onSelectCase, onOpenMatching, currentCaseId }: {
  block: AiConversationBlock
  zh: boolean
  onSelectCase(reference: TypedAiConversationReference): void
  onOpenMatching(jobCaseId: string): void
  currentCaseId: string | null
}) {
  if (block.type === 'text') return <p className="agent-block-text">{block.text}</p>
  if (block.type === 'job-case-cards') return <div className="agent-card-stack">{block.cards.map((card) => <JobCaseCardView card={card} key={card.reference.objectId} onOpenMatching={onOpenMatching} onSelect={onSelectCase} zh={zh} />)}</div>
  if (block.type === 'candidate-match-cards') return <div className="agent-card-stack">{block.cards.map((card) => <CandidateCardView card={card} currentCaseId={currentCaseId} key={card.reference.objectId} onOpenMatching={onOpenMatching} zh={zh} />)}</div>
  if (block.type === 'candidate-profile-evidence') return null
  if (block.type === 'candidate-interview-evidence') return null
  if (block.type === 'clarification') return <div className="agent-clarification"><strong>{block.prompt}</strong>{block.options.length > 0 ? <div>{block.options.map((option) => <button key={`${option.kind}-${option.objectId}`} onClick={() => onSelectCase(option)} type="button">{option.ordinal ? `${option.ordinal}. ` : ''}{option.label}</button>)}</div> : null}</div>
  if (block.type === 'match-run-explanation') {
    const facts = block.facts
    return <div className="agent-explanation"><div className="agent-explanation-grid"><span><strong>Match Run</strong>{facts.runId.slice(0, 12)}</span><span><strong>Result Hash</strong>{facts.resultHash.slice(0, 12)}</span><span><strong>{zh ? '状态' : '状態'}</strong>{statusLabel(facts.validity, zh)}</span><span><strong>{zh ? '算法' : 'アルゴリズム'}</strong>{facts.algorithmVersion}</span></div><p>{zh ? '以上解释来自已保存的 Result Snapshot，没有重新运行本地匹配。' : '保存済みの Result Snapshot を読み取りました。マッチングは再実行していません。'}</p></div>
  }
  return <div className="agent-error-block" role="alert"><Icon name="alert" size={15} /><span>{block.message}</span></div>
}

export function AgentWorkspace({
  onOpenMatching,
  reloadToken = 0,
  models = fallbackModels,
  defaultModelKey = 'gpt-5.6-luna',
  cloudConnected = true,
  onConnectCloud,
  status,
  onOpenReviews
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
  const [draft, setDraft] = useState('')
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [requestConversationId, setRequestConversationId] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [selectedCase, setSelectedCase] = useState<TypedAiConversationReference | null>(null)
  const [error, setError] = useState<string | null>(null)
  const availableModels = models.length > 0 ? models : fallbackModels
  const [selectedModelKey, setSelectedModelKey] = useState(() => {
    let stored: string | null = null
    try { stored = globalThis.sessionStorage?.getItem(agentModelSessionKey) ?? null } catch { stored = null }
    return availableModels.some((model) => model.key === stored)
      ? stored!
      : availableModels.some((model) => model.key === defaultModelKey) ? defaultModelKey : availableModels[0]!.key
  })
  const activeRequestRef = useRef<{ conversationId: string; requestId: string; sequence: number; stopRequested: boolean } | null>(null)
  const messageScrollRef = useRef<HTMLDivElement>(null)
  const [streamState, setStreamState] = useState<{
    conversationId: string
    requestId: string
    sequence: number
    content: string
    phase: 'planning' | 'local-tool' | 'connecting-model' | 'streaming' | 'stopping'
    modelDisplayName: string
  } | null>(null)

  useEffect(() => {
    if (availableModels.some((model) => model.key === selectedModelKey)) return
    const next = availableModels.some((model) => model.key === defaultModelKey) ? defaultModelKey : availableModels[0]!.key
    setSelectedModelKey(next)
  }, [availableModels, defaultModelKey, selectedModelKey])

  useEffect(() => {
    try { globalThis.sessionStorage?.setItem(agentModelSessionKey, selectedModelKey) } catch { /* session persistence is best-effort */ }
  }, [selectedModelKey])

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

  useEffect(() => {
    const reference = typedReference(activeConversation?.salesAgentState?.selectedJobCaseRef)
    setSelectedCase(reference)
  }, [activeConversation?.id, activeConversation?.revision, activeConversation?.salesAgentState?.selectedJobCaseRef])

  const selectCase = (reference: TypedAiConversationReference) => {
    if (reference.kind === 'job-case') setSelectedCase(reference)
  }

  const [attachments, setAttachments] = useState<Array<StagedLocalFile & { taskId: string }>>([])
  const [importing, setImporting] = useState(false)
  const [importSummary, setImportSummary] = useState<{ imported: number; failed: number } | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  /**
   * Hands dropped bytes to the main process, which decides the real format from
   * magic bytes and returns vault tokens. The renderer never sees a path and
   * never decides what a file is.
   */
  const attachFiles = async (files: File[]) => {
    const accepted = files.slice(0, 10)
    if (accepted.length === 0 || attaching) return
    setAttaching(true)
    setError(null)
    try {
      const payload = await Promise.all(accepted.map(async (file) => ({
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer())
      })))
      const staged = await window.sesAgent.stageDroppedResumeFiles({ files: payload })
      if (!staged.cancelled) {
        const taskId = staged.task.id
        setAttachments((current) => [...current, ...staged.files.map((file) => ({ ...file, taskId }))].slice(0, 10))
        setImportSummary(null)
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
    setImporting(true)
    setError(null)
    let imported = 0
    let failed = 0
    for (const file of attachments) {
      try {
        await window.sesAgent.analyzeResumeFile({ fileToken: file.token, taskId: file.taskId })
        imported += 1
      } catch {
        failed += 1
      }
    }
    setAttachments([])
    setImportSummary({ imported, failed })
    setImporting(false)
  }

  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    const message = draft.trim()
    if (!message || pendingMessage) return
    const conversationId = activeConversation?.id ?? newId()
    const currentRequestId = newId()
    const lockedModelKey = selectedModelKey
    setPendingMessage(message)
    setDraft('')
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
        expectedConversationRevision: activeConversation?.revision ?? null,
        requestId: currentRequestId,
        modelKey: lockedModelKey,
        selectedJobCaseRef: selectedCase,
        attachmentFileTokens: attachments.map((file) => file.token)
      })
      setAttachments([])
      history.acceptConversation(result.conversation)
      const nextSelected = typedReference(result.conversation.salesAgentState?.selectedJobCaseRef)
      if (nextSelected) setSelectedCase(nextSelected)
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

  const messages = pendingMessage
    ? [...history.messages, { id: 'agent-pending-message', role: 'user' as const, content: pendingMessage, mode: 'local' as const, createdAt: new Date().toISOString() }]
    : history.messages

  useEffect(() => {
    const container = messageScrollRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
  }, [history.messages.length, pendingMessage, streamState?.content])

  // Every suggestion has to map to a tool that can run right now. Without a
  // selected case there is no ranking to explain and nothing to match against,
  // so those prompts only appear once a case is in context.
  const emptyStateSuggestions = selectedCase
    ? (zh
        ? ['给当前案件匹配候选人', '这个案件的条件是什么？', '最近有什么案件？']
        : ['現在の案件に合う候補者を探して', 'この案件の条件は？', '最近の案件は？'])
    : (zh
        ? ['最近有什么案件？', '有哪些进行中的案件？']
        : ['最近の案件は？', '進行中の案件は？'])

  return <main className="agent-workspace" aria-labelledby="agent-workspace-title">
    <aside className="agent-workspace-history"><AiConversationHistoryPanel activeConversationId={history.activeConversationId} busy={history.loading || history.saving || pendingMessage !== null} conversations={history.conversations} error={history.error} loading={history.loading} onDelete={history.deleteConversations} onNew={history.newConversation} onSelect={(id) => { history.selectConversation(id); setSelectedCase(null) }} /></aside>
    <section
      className={dragActive ? 'agent-workspace-main is-drag-active' : 'agent-workspace-main'}
      onDragOver={(event) => { if (!cloudConnected) return; event.preventDefault(); setDragActive(true) }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragActive(false) }}
      onDrop={(event) => {
        event.preventDefault()
        setDragActive(false)
        if (!cloudConnected) return
        void attachFiles([...event.dataTransfer.files])
      }}
    >
      <header className="agent-workspace-header"><div><span className="eyebrow">CONTROLLED MATCHING AGENT</span><h1 id="agent-workspace-title">{zh ? '案件匹配 Agent' : '案件マッチング Agent'}</h1></div><span className="agent-privacy-badge" title={zh ? 'AI 理解自然语言 + 受控本地 Tool + SSE 回答；仅发送已脱敏的最小上下文，不自动改变业务状态' : 'AI が自然言語を理解 + 制御済みローカル Tool + SSE 回答。脱敏済みの最小コンテキストのみを送信し、業務状態は変更しません'}><Icon name="shield" size={13} />{zh ? '仅发送脱敏内容' : '脱敏済みのみ送信'}</span></header>
      {status ? <div className="agent-status-strip">
        <span><strong>{status.eligibleCandidateCount}</strong>{zh ? '可匹配人才' : 'マッチ可能人材'}</span>
        <button
          className={status.pendingReviewCount > 0 ? 'is-actionable' : undefined}
          disabled={status.pendingReviewCount === 0}
          onClick={() => onOpenReviews?.()}
          type="button"
        ><strong>{status.pendingReviewCount}</strong>{zh ? '待审核' : '未レビュー'}</button>
        {status.runningJobCount > 0 ? <span><strong>{status.runningJobCount}</strong>{zh ? '运行中' : '実行中'}</span> : null}
        {status.backupReminder === 'due' ? <span className="is-warning">{zh ? '需要确认备份' : 'バックアップの確認が必要'}</span> : null}
      </div> : null}
      {selectedCase ? <div className="agent-current-case-chip"><Icon name="briefcase" size={14} /><span>{zh ? '当前案件' : 'Current case'} · {selectedCase.label} v{selectedCase.objectVersion ?? '—'}</span><button onClick={() => setSelectedCase(null)} type="button" aria-label={zh ? '清除当前案件' : 'Clear current case'}>×</button></div> : null}
      <div className="agent-message-scroll" aria-live="polite" ref={messageScrollRef}>
        {messages.length === 0 ? (cloudConnected ? <div className="agent-empty-state"><Icon name="sparkles" size={28} /><h2>{selectedCase ? (zh ? '开始匹配' : 'マッチングを開始') : (zh ? '从案件开始' : '案件から始める')}</h2><p>{selectedCase ? (zh ? '已选择案件，可以让 AI 匹配候选人，或继续追问案件条件。' : '案件を選択済みです。候補者のマッチングや条件の確認を依頼できます。') : (zh ? '问“最近有什么案件？”，然后选择案件继续匹配。' : '「最近の案件は？」と尋ね、案件を選んでマッチングを続けます。')}</p><div>{emptyStateSuggestions.map((suggestion) => <button key={suggestion} onClick={() => setDraft(suggestion)} type="button">{suggestion}</button>)}</div></div> : <div className="agent-empty-state"><Icon name="shield" size={28} /><h2>{zh ? '先连接受管账号' : '受管アカウントに接続してください'}</h2><p>{zh ? 'SES Agent 通过公司受管的 AICommerce 接入理解自然语言。连接后即可查询案件、匹配候选人并查看匹配依据。' : 'SES Agent は会社の受管 AICommerce 接続を通じて自然言語を理解します。接続すると案件検索・候補者マッチング・根拠の確認を利用できます。'}</p></div>) : messages.map((message) => (
          <article className={`agent-message is-${message.role}`} key={message.id}>
            {message.role === 'assistant' ? <div className="agent-message-role"><span className="agent-message-avatar"><Icon name="sparkles" size={14} /></span><strong>SES Agent</strong></div> : null}
            <div className="agent-message-body"><MessageText message={message} />{message.blocks?.map((block, index) => <BlockView block={block} currentCaseId={selectedCase?.kind === 'job-case' ? selectedCase.objectId : null} key={`${message.id}-block-${index}`} onOpenMatching={onOpenMatching} onSelectCase={selectCase} zh={zh} />)}</div>
          </article>
        ))}
        {pendingMessage && streamState?.content ? <article className="agent-message is-assistant is-streaming" data-testid="agent-streaming-message"><div className="agent-message-role"><span className="agent-message-avatar"><Icon name="sparkles" size={14} /></span><strong>SES Agent</strong></div><div className="agent-message-body"><AgentMarkdown content={streamState.content} /></div></article> : null}
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
      {cloudConnected ? <form aria-label={zh ? '案件 Agent 输入区' : '案件 Agent 入力欄'} className="agent-composer" onSubmit={send}>{attachments.length > 0 ? <div className="agent-attachment-tray">{attachments.map((file) => <span key={file.token}><span className="agent-attachment-glyph"><Icon name="file" size={16} /></span><span className="agent-attachment-label"><strong>{file.name}</strong><small>{file.format.toLocaleUpperCase('en-US')}</small></span><button aria-label={zh ? `移除 ${file.name}` : `${file.name} を外す`} onClick={() => setAttachments((current) => current.filter((item) => item.token !== file.token))} type="button">×</button></span>)}</div> : null}<textarea aria-label={zh ? '输入案件问题' : '案件 Agent への質問'} disabled={pendingMessage !== null} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} placeholder={zh ? '询问案件、候选人或当前匹配结果…' : '案件、候補者、現在のマッチ結果について質問…'} rows={2} value={draft} /><footer><div className="agent-composer-tools">{attachments.length > 0 ? <button className="agent-attachment-import" disabled={importing} onClick={() => void importAttachmentsDirectly()} type="button">{importing ? (zh ? '导入中…' : '取込中…') : (zh ? '直接导入' : 'そのまま取込')}</button> : null}<div className="agent-model-control"><label htmlFor="agent-chat-model">{zh ? '回答模型' : '回答モデル'}</label><select aria-label={zh ? '选择回答模型' : '回答モデルを選択'} disabled={pendingMessage !== null} id="agent-chat-model" onChange={(event) => setSelectedModelKey(event.target.value)} value={selectedModelKey}>{availableModels.map((model) => <option key={model.key} value={model.key}>{model.displayName}</option>)}</select></div><small>{pendingMessage ? (zh ? '停止是止损操作，不保证免费或退款。' : '停止は損失抑制であり、無料・返金を保証しません。') : `Enter ${zh ? '发送 · Shift+Enter 换行' : '送信 · Shift+Enter で改行'}`}</small></div>{pendingMessage ? <button aria-label="停止" className="agent-stop" onClick={(event) => { event.preventDefault(); void stop() }} type="button"><Icon name="alert" size={14} />{zh ? '停止' : '停止'}</button> : <button aria-label={zh ? '发送' : '送信'} className="agent-send" disabled={!draft.trim()} type="submit"><Icon name="arrow-up" size={16} /></button>}</footer></form> : <div className="agent-connect-bar">
        <Icon name="lock" size={14} />
        <span>{zh ? '连接受管账号后即可开始对话。' : '受管アカウントに接続すると会話を開始できます。'}</span>
        <button onClick={() => onConnectCloud?.()} type="button">{zh ? '连接受管账号' : '受管アカウントに接続'}</button>
      </div>}
    </section>
  </main>
}
