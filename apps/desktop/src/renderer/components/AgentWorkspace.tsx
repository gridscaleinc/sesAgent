import {
  createContext,
  useContext,
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
  CandidateReviewSnapshot,
  ImportAtsCsvCandidatesResult,
  JobCaseDeletionPreview,
  DeleteJobCaseDataResult,
  DeleteJobCaseDataInput,
  JobCaseReviewSnapshot,
  AgentJobCaseDraftCard,
  AgentCandidateDraftFacts,
  StagedLocalFile,
  AgentChatModelOption,
  AgentCandidateMatchCard,
  AgentCandidateMatchCardsBlock,
  AgentCloudReviewSkipCode,
  AgentTurnTimings,
  AgentJobCaseBroadcastCard,
  AgentJobCaseCard,
  AgentSystemAccessBlock,
  BroadcastLanguage,
  AiConversationBlock,
  AiConversationMessage,
  AiConversationReference,
  AiConversationSnapshot,
  ExecuteAgentTurnInput,
  TypedAiConversationReference
} from '@shared'
import { isUnassessableMatchCard, reviewMatchAssessmentEvidence } from '@shared'
import { copyTextToClipboard } from '../copy-text'
import { localeText, localizedIpcError, localizedMainText, useUiLocale } from '../i18n'
import { Icon, type IconName } from './Icon'
import { AiConversationHistoryPanel } from './AiConversationHistoryPanel'
import { AgentMarkdown } from './AgentMarkdown'
import { MatchAssessmentView } from './MatchAssessmentView'
import { useAiConversationHistory } from './useAiConversationHistory'

const CandidateNamesContext = createContext<ReadonlyMap<string, string>>(new Map())

interface AgentWorkspaceProps {
  businessMatchingBusy?: boolean
  businessTitle?: string
  chatRequest?: number
  businessObject?: import('@shared').BusinessConversationObject

  candidateReviews?: ReadonlyArray<CandidateReviewSnapshot>
  composerObject?: { kind: 'case' | 'person'; label: string; onMatch?(): void; onPromote?(): void }
  latestContent?: ReactNode
  homeRequestToken?: number
  contextPanelOpen?: boolean
  focusRequest?: { id: number; caseReference: TypedAiConversationReference | null; candidateDocumentId?: string }
  onOpenBatch?(text?: string): void
  activeSystemAccess?: AgentSystemAccessBlock | null
  composerDraft?: string
  contextPanel?: ReactNode
  contextPanelLabel?: string
  newCaseUnseenCount?: number
  onOpenNewCaseBoard?(): void
  onCloseContextPanel?(): void
  onComposerDraftChange?(value: string): void
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
  /** ATS CSV rows become candidate drafts through the same local text import as pasted person text. */
  onImportAtsCsv?(): Promise<ImportAtsCsvCandidatesResult>
  onOpenBroadcast?(): void
  onOpenCaseImport?(): void
  onOpenCases?(): void
  onOpenSystemAccess?(access: AgentSystemAccessBlock): void
  /**
   * Counts the operator would otherwise have lost by not passing through the
   * dashboard. Sourced from the same bootstrap fields the sidebar badges use,
   * so the two can never disagree.
   */
  status?: AgentWorkspaceStatus
  onOpenSettings?(): void
  onOpenOperatorProfile?(): void
  operatorLabel?: string
  /**
   * Called after a tool writes to the local database, so the app can refresh its
   * bootstrap snapshot. Without it imports or interview schedules land in
   * SQLCipher while the corresponding screens keep rendering stale data.
   */
  onLocalDataChanged?(): void | Promise<void>
  /**
   * Live job-case reviews from the bootstrap snapshot. Intake cards persisted
   * in a conversation re-read their draft's current state from here, so a
   * draft confirmed in the Review Center becomes a matchable case on the card
   * without a new turn.
   */
  jobCaseReviews?: ReadonlyArray<JobCaseReviewSnapshot>
  /** The governed deletion flow: impact preview first, typed confirmation second. */
  onPreviewJobCaseDeletion?(reviewId: string): Promise<JobCaseDeletionPreview>
  onDeleteJobCase?(input: DeleteJobCaseDataInput): Promise<DeleteJobCaseDataResult>
  /** 今日新着案件 for the conversation home; null while it is still loading. */
}

export interface AgentWorkspaceStatus {
  activeCaseCount: number
  eligibleCandidateCount: number
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
  return (
    <button className="agent-quick-action" onClick={onClick} type="button">
      <span className="agent-quick-action-icon">
        <Icon name={icon} size={16} />
      </span>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <Icon name="chevron-right" size={14} />
    </button>
  )
}

// The model list comes from the Main catalog via bootstrap; this only keeps the picker usable without one.
const fallbackModels: AgentChatModelOption[] = [{ key: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna' }]

// Only a model the operator picked in the chat is remembered; otherwise the chat follows the 批量核对 setting.
const agentModelSessionKey = 'ses-agent-chat-model-key-v2'

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

  const lineageByConversationId = new Map(conversations.map((conversation) => [conversation.id, find(conversation.id)] as const))
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
  const t = localeText(zh)

  if (status === 'current') return t('当前', '現在')
  if (status === 'stale') return t('已过期', '要再確認')
  return t('已删除', '削除済み')
}

function userFacingAgentError(message: string, zh: boolean): string {
  const t = localeText(zh)

  if (message.includes('Invalid ISO datetime') && (message.includes('scheduledAt') || message.includes('invalid_format'))) {
    return t(
      '面试时间格式无效，本次没有保存记录。请重新发送日期、开始时间和时长。',
      '面談時刻の形式が無効なため、レコードは保存されませんでした。日付、開始時刻、所要時間を再送信してください。'
    )
  }
  return localizedMainText(zh ? 'zh-CN' : 'ja-JP', message)
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
  const t = localeText(zh)

  const blocks = messages.flatMap((message) => message.blocks ?? [])
  const latestAccess = [...blocks].reverse().find((block): block is AgentSystemAccessBlock => block.type === 'system-access') ?? null
  const receipt = latestAccess?.destination === 'interview-schedule' ? latestAccess.receipt : undefined
  const latestDraft = [...blocks].reverse().find((block) => block.type === 'candidate-draft-facts')
  const latestImport = [...blocks].reverse().find((block) => block.type === 'resume-import')
  const candidateLabel =
    receipt?.candidateLabel ??
    (latestDraft?.type === 'candidate-draft-facts' ? latestDraft.facts.label : null) ??
    (latestImport?.type === 'resume-import' ? (latestImport.imported[0]?.label ?? null) : null)
  const candidateDocumentId =
    receipt?.sourceDocumentId ??
    (latestDraft?.type === 'candidate-draft-facts' ? latestDraft.facts.documentId : null) ??
    (latestImport?.type === 'resume-import' ? (latestImport.imported[0]?.documentId ?? null) : null)
  const resultLabel =
    latestAccess?.destination === 'interview-schedule'
      ? t('面试已登记', '面談登録済み')
      : latestAccess?.destination === 'review-center'
        ? t('等待人工审核', '人のレビュー待ち')
        : latestAccess?.destination === 'matching'
          ? t('匹配结果已生成', 'マッチ結果作成済み')
          : latestAccess
            ? t('系统结果可访问', 'システム結果あり')
            : latestImport
              ? t('简历已加入上下文', '履歴書をコンテキストに追加済み')
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
  const names = useContext(CandidateNamesContext)
  const zh = useUiLocale() === 'zh-CN'
  const t = localeText(zh)
  const cards = message.blocks?.flatMap((block) => (block.type === 'candidate-match-cards' ? block.cards : [])) ?? []
  const content = message.content.replace(/\bCANDIDATE_(\d+)\b/gu, (label, rank) => {
    const card = cards.find((item) => item.rank === Number(rank))
    return card?.sourceDocumentId ? (names.get(card.sourceDocumentId) ?? label) : label
  })
  if (message.role === 'assistant' && cards.some((card) => card.assessment && reviewMatchAssessmentEvidence(card.assessment).corrected)) {
    return (
      <div>
        <p>
          {t(
            '这条历史评估的依据需要核对，请以卡片中修正后的证据为准。',
            'この過去の評価には確認が必要です。カードの修正済み根拠を参照してください。'
          )}
        </p>
        <details>
          <summary>{t('查看原评估文字', '元の評価文を表示')}</summary>
          <AgentMarkdown content={content} />
        </details>
      </div>
    )
  }
  return message.role === 'assistant' ? <AgentMarkdown content={content} /> : <p className="agent-message-text">{message.content}</p>
}

function UserMessageEditor({
  busy,
  value,
  zh,
  onCancel,
  onChange,
  onSubmit
}: {
  busy: boolean
  value: string
  zh: boolean
  onCancel(): void
  onChange(value: string): void
  onSubmit(): void
}) {
  const t = localeText(zh)

  return (
    <form
      className="agent-message-editor"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <textarea
        aria-label={t('编辑已发送的输入', '送信済み入力を編集')}
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
      <small>
        {t(
          '将在当前会话中从这条输入之前重新生成；原版本和已执行操作仍保留在本机。',
          '現在の会話内でこの入力より前から再生成します。元の版と実行済み操作は端末内に保持されます。'
        )}
      </small>
      <footer>
        <button disabled={busy} onClick={onCancel} type="button">
          {t('取消', 'キャンセル')}
        </button>
        <button className="is-primary" disabled={busy || !value.trim()} type="submit">
          <Icon name="arrow-up" size={13} />
          {t('重新发送', '再送信')}
        </button>
      </footer>
    </form>
  )
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
  const t = localeText(zh)

  return (
    <article className={`agent-case-card is-${card.status}`}>
      <header>
        <div>
          <span className="agent-card-kicker">{t(`案件 ${card.reference.ordinal ?? ''}`, `案件 ${card.reference.ordinal ?? ''}`)}</span>
          <h3>{card.title}</h3>
        </div>
        <span className="agent-status-chip">{statusLabel(card.status, zh)}</span>
      </header>
      <div className="agent-case-meta">
        <span>v{card.version}</span>
        <span>{card.requiredSkills ?? t('技能未指定', 'Skills not specified')}</span>
        <span>{card.rate ?? t('单价未指定', 'Rate not specified')}</span>
      </div>
      <div className="agent-case-meta">
        <span>{card.workStyle ?? t('工作方式未指定', 'Work style not specified')}</span>
        <span>{card.startDate ?? t('开始时间未指定', 'Start date not specified')}</span>
      </div>
      <footer>
        <button className="agent-card-select" disabled={card.status === 'deleted'} onClick={() => onSelect(card.reference)} type="button">
          {t('设为当前案件', '現在の案件にする')}
        </button>
        <button disabled={card.status === 'deleted'} onClick={() => onOpenMatching(card.reference.objectId)} type="button">
          {t('打开完整匹配', '詳細マッチングを開く')}
          <Icon name="chevron-right" size={13} />
        </button>
      </footer>
    </article>
  )
}

/** One line of where the last turn's time went; seconds, phases in order. */
function turnTimingsText(timings: AgentTurnTimings, zh: boolean): string {
  const t = localeText(zh)

  const seconds = (ms: number | null): string => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`)
  const parts = [
    `${t('规划', '計画')} ${seconds(timings.planningMs)}`,
    `${t('本地工具', 'ローカルTool')} ${seconds(timings.localToolMs)}`,
    ...(timings.cloudReviewMs !== null ? [`${t('云端评审', 'クラウド評価')} ${seconds(timings.cloudReviewMs)}`] : []),
    `${t('生成首字', '生成開始まで')} ${seconds(timings.narrativeFirstTokenMs)}`,
    `${t('生成', '生成')} ${seconds(timings.narrativeMs)}`
  ]
  return `${t('本轮耗时', '今回の所要時間')} ${seconds(timings.totalMs)}：${parts.join(' · ')}（${t('云端调用', 'クラウド呼び出し')} ${timings.cloudCalls} ${t('次', '回')}）`
}

/**
 * The match cards, or - when every row matched nothing - one line saying
 * there is no candidate, with the reasons behind a toggle. Nobody needs a
 * ranked list of what each non-candidate lacks up front.
 */
function CandidateMatchCardsView({
  block,
  zh,
  currentCaseId,
  onOpenCandidate,
  onOpenMatching
}: {
  block: AgentCandidateMatchCardsBlock
  zh: boolean
  currentCaseId: string | null
  onOpenCandidate?(sourceDocumentId: string): void
  onOpenMatching(jobCaseId: string): void
}) {
  const t = localeText(zh)

  const [showReasons, setShowReasons] = useState(false)
  const noneAssessable = block.cards.length > 0 && block.cards.every(isUnassessableMatchCard)
  const note =
    block.cloudReview?.status === 'skipped' ? (
      <p className="agent-cloud-review-note">
        <Icon name="alert" size={12} />
        {t('云端评审未完成：', 'クラウド評価は未実施：')}
        {cloudReviewSkipLabel(block.cloudReview.code, zh)}
        {block.cloudReview.reason ? <small>{localizedMainText(zh ? 'zh-CN' : 'ja-JP', block.cloudReview.reason)}</small> : null}
      </p>
    ) : null
  const cards = block.cards.map((card) => (
    <CandidateCardView
      scoped={block.scope === 'selected-person'}
      card={card}
      currentCaseId={currentCaseId}
      key={card.reference.objectId}
      onOpenCandidate={onOpenCandidate}
      onOpenMatching={onOpenMatching}
      zh={zh}
    />
  ))
  if (!noneAssessable || block.scope === 'selected-person')
    return (
      <div className="agent-card-stack">
        {note}
        {cards}
      </div>
    )
  return (
    <div className="agent-card-stack agent-no-match">
      <p className="agent-no-match-summary">
        <Icon name="alert" size={13} />
        {t('当前案件暂无可确认的匹配人员。', '現在の案件に確認できる要員はいません。')}
      </p>
      <button
        aria-expanded={showReasons}
        className="agent-no-match-toggle"
        onClick={() => setShowReasons((current) => !current)}
        type="button"
      >
        {showReasons ? t('收起原因', '理由を閉じる') : t('查看为何没有匹配结果', 'なぜ結果がないかを見る')}
        <Icon name="chevron-right" size={12} />
      </button>
      {showReasons ? (
        <>
          {note}
          {cards}
        </>
      ) : null}
    </div>
  )
}

function cloudReviewSkipLabel(code: AgentCloudReviewSkipCode, zh: boolean): string {
  const t = localeText(zh)

  if (code === 'cloud-unavailable') return t('云端不可用', 'クラウド未接続')
  if (code === 'nothing-matched') return t('本地未匹配到任何要求，未发起评审', 'ローカルで一致した要件がなく未実施')
  if (code === 'no-job-case') return t('未找到案件当前版本', '案件の現在版が見つかりません')
  if (code === 'no-candidates') return t('没有可评审的人员', '評価対象の要員なし')
  if (code === 'no-verdict') return t('模型未返回可用结论', 'モデルから有効な判定なし')
  return t('云端调用失败', 'クラウド呼び出し失敗')
}

function CandidateCardView({
  card,
  scoped = false,
  zh,
  onOpenCandidate,
  onOpenMatching,
  currentCaseId
}: {
  card: AgentCandidateMatchCard
  scoped?: boolean
  zh: boolean
  onOpenCandidate?(sourceDocumentId: string): void
  onOpenMatching(jobCaseId: string): void
  currentCaseId: string | null
}) {
  const t = localeText(zh)

  const names = useContext(CandidateNamesContext)
  // Nothing matched and the hard filter could not decide: the candidate was
  // merely not excluded. Showing "#1 · Fit 0" would read as a recommendation.
  const unassessable = isUnassessableMatchCard(card)
  const hardFilterLabel =
    card.hardFilterStatus === 'passed'
      ? t('通过', '通過')
      : card.hardFilterStatus === 'none'
        ? t('案件未设定硬条件', '案件に必須条件なし')
        : card.hardFilterStatus === 'failed'
          ? t('不满足', '不適合')
          : card.missing.length > 0
            ? t(`未知（人员未登记：${card.missing.join('、')}）`, `不明（要員に未登録：${card.missing.join('、')}）`)
            : t('未知', '不明')
  return (
    <article className={`agent-candidate-card is-${card.status}${unassessable ? ' is-unassessable' : ''}`}>
      <header>
        <span className="agent-rank">{scoped ? t('指定人员', '指定要員') : unassessable ? '—' : `#${card.rank}`} </span>
        <div>
          <h3>{(card.sourceDocumentId && names.get(card.sourceDocumentId)) || card.anonymousLabel}</h3>
          <small title={t('用于本地检索排序，不是录用概率。', '検索順位の指標です。採用確率ではありません。')}>
            {unassessable
              ? t('无匹配依据 · 无法评估', '判定根拠なし・評価不能')
              : card.fitScore === null
                ? t('本地相关度未提供', '関連度なし')
                : `${t('本地相关度', 'ローカル関連度')} ${card.fitScore}`}
          </small>
        </div>
        <span className="agent-status-chip">{statusLabel(card.status, zh)}</span>
      </header>
      <div className="agent-candidate-facts">
        <span>
          <strong>{t('匹配', 'Matched')}</strong>
          {card.matched.length > 0 ? card.matched.join(' · ') : '—'}
        </span>
        <span>
          <strong>{card.hardFilterStatus === 'failed' ? t('未满足', '不適合') : t('待核对', '要確認')}</strong>
          {card.missing.length > 0 ? card.missing.join(' · ') : t('无待核对硬条件', '確認が必要な必須条件なし')}
        </span>
        <span>
          <strong>{t('硬条件', '必須条件')}</strong>
          {hardFilterLabel}
        </span>
        {card.projectEvidence ? (
          <span>
            <strong>{t('项目证据', 'プロジェクト根拠')}</strong>
            {card.projectEvidence}
          </span>
        ) : null}
      </div>
      {card.assessment ? <MatchAssessmentView assessment={card.assessment} zh={zh} /> : null}
      <footer>
        {card.sourceDocumentId && onOpenCandidate ? (
          <button disabled={card.status === 'deleted'} onClick={() => onOpenCandidate(card.sourceDocumentId!)} type="button">
            <Icon name="users" size={13} />
            {t('打开人员', '要員を開く')}
          </button>
        ) : null}
        <button
          disabled={card.status === 'deleted' || !currentCaseId}
          onClick={() => currentCaseId && onOpenMatching(currentCaseId)}
          type="button"
        >
          {t('查看完整匹配结果', '詳細なマッチ結果を見る')}
          <Icon name="chevron-right" size={13} />
        </button>
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

function CandidateProfileEvidenceView({
  block,
  zh,
  onOpenCandidate,
  onOpenOriginalDocument
}: {
  block: Extract<AiConversationBlock, { type: 'candidate-profile-evidence' }>
  zh: boolean
  onOpenCandidate?(sourceDocumentId: string, view?: CandidateRouteView): void
  onOpenOriginalDocument?(sourceDocumentId: string): void
}) {
  const t = localeText(zh)

  const { candidate, profile, validity } = block.facts
  if (!candidate || !profile)
    return (
      <div className="agent-evidence-card is-deleted">
        <p>{t('人员档案已不存在或当前不可读取。', '要員プロフィールが存在しないか、現在参照できません。')}</p>
      </div>
    )
  const fields = [
    [t('技能', 'スキル'), profile.skills],
    [t('经验', '経験年数'), profile.experienceYears],
    [t('日语', '日本語'), profile.japaneseLevel],
    [t('角色', 'ロール'), profile.role],
    [t('可入场时间', '稼働開始'), profile.availability],
    [t('单价', '単価'), profile.rate],
    [t('工作方式', '勤務形態'), profile.workStyle],
    [t('所在地', '所在地'), profile.location],
    [t('工作许可', '就労資格'), profile.workAuthorization]
  ].filter((entry): entry is [string, string] => Boolean(entry[1]))
  return (
    <article className={`agent-evidence-card is-${validity}`}>
      <header>
        <div>
          <span className="agent-card-kicker">{t(`人员 #${candidate.rank}`, `要員 #${candidate.rank}`)}</span>
          <h3>{candidate.anonymousLabel}</h3>
        </div>
        <span className="agent-status-chip">{statusLabel(validity, zh)}</span>
      </header>
      <dl className="agent-evidence-facts">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {profile.projectExperiences.length > 0 ? (
        <div className="agent-evidence-projects">
          <strong>{t('项目经历', 'プロジェクト経験')}</strong>
          {profile.projectExperiences.slice(0, 4).map((project, index) => (
            <details key={`${project.title}-${index}`}>
              <summary>
                {project.title}
                <small>{[project.period, project.role].filter(Boolean).join(' · ')}</small>
              </summary>
              <p>{project.summary}</p>
              {project.technologies.length > 0 ? <span>{project.technologies.join(' · ')}</span> : null}
            </details>
          ))}
        </div>
      ) : null}
      {candidate.sourceDocumentId ? (
        <AgentBlockActions>
          {onOpenCandidate ? (
            <button
              disabled={validity === 'deleted'}
              onClick={() => onOpenCandidate(candidate.sourceDocumentId!, 'overview')}
              type="button"
            >
              <Icon name="users" size={13} />
              {t('打开人员档案', '要員プロフィールを開く')}
            </button>
          ) : null}
          {onOpenOriginalDocument ? (
            <button disabled={validity === 'deleted'} onClick={() => onOpenOriginalDocument(candidate.sourceDocumentId!)} type="button">
              <Icon name="file" size={13} />
              {t('打开原文件', '元ファイルを開く')}
              <Icon name="external-link" size={12} />
            </button>
          ) : null}
        </AgentBlockActions>
      ) : null}
    </article>
  )
}

function interviewRouteView(stage: string): CandidateRouteView {
  if (stage === 'scheduled') return 'prepare'
  if (stage === 'prepared' || stage === 'interviewing') return 'workbench'
  if (stage === 'awaiting-decision') return 'decision'
  if (stage === 'new' || stage === 'contacting') return 'schedule'
  return 'records'
}

function CandidateInterviewEvidenceView({
  block,
  locale,
  zh,
  onOpenCandidate
}: {
  block: Extract<AiConversationBlock, { type: 'candidate-interview-evidence' }>
  locale: string
  zh: boolean
  onOpenCandidate?(
    sourceDocumentId: string,
    view?: CandidateRouteView,
    interviewId?: string | null,
    interviewKind?: 'recruiting' | 'client'
  ): void
}) {
  const t = localeText(zh)

  const { candidate, interviews, validity } = block.facts
  const formatter = new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  if (!candidate)
    return (
      <div className="agent-evidence-card is-deleted">
        <p>{t('无法定位人员，不能打开面试记录。', '要員を特定できないため、面談記録を開けません。')}</p>
      </div>
    )
  return (
    <article className={`agent-evidence-card is-${validity}`}>
      <header>
        <div>
          <span className="agent-card-kicker">{t(`人员 #${candidate.rank}`, `要員 #${candidate.rank}`)}</span>
          <h3>{candidate.anonymousLabel}</h3>
        </div>
        <span className="agent-status-chip">{statusLabel(validity, zh)}</span>
      </header>
      {interviews.length > 0 ? (
        <div className="agent-interview-list">
          {interviews.map((interview, index) => (
            <section key={interview.interviewId ?? `${interview.kind}-${interview.roundNumber}-${index}`}>
              <div>
                <strong>
                  {interview.kind === 'client' ? t('客户面试', '顧客面談') : t('招聘面试', '採用面談')} ·{' '}
                  {t(`第 ${interview.roundNumber} 轮`, `${interview.roundNumber}回目`)}
                </strong>
                <span>{interview.stage}</span>
              </div>
              <p>
                {interview.scheduledAt ? formatter.format(new Date(interview.scheduledAt)) : t('时间未确定', '日時未定')} ·{' '}
                {interview.durationMinutes} min · {interview.meetingMethod}
              </p>
              {interview.interviewNotes ? (
                <small>{interview.interviewNotes}</small>
              ) : interview.interviewGoal ? (
                <small>{interview.interviewGoal}</small>
              ) : null}
              {candidate.sourceDocumentId && onOpenCandidate ? (
                <button
                  disabled={validity === 'deleted'}
                  onClick={() =>
                    onOpenCandidate(
                      candidate.sourceDocumentId!,
                      interviewRouteView(interview.stage),
                      interview.interviewId ?? null,
                      interview.kind
                    )
                  }
                  type="button"
                >
                  {t('打开这轮面试', 'この面談を開く')}
                  <Icon name="chevron-right" size={12} />
                </button>
              ) : null}
            </section>
          ))}
        </div>
      ) : (
        <p className="agent-evidence-empty">{t('还没有面试记录。', '面談記録はまだありません。')}</p>
      )}
      {candidate.sourceDocumentId && onOpenCandidate ? (
        <AgentBlockActions>
          <button
            disabled={validity === 'deleted'}
            onClick={() => onOpenCandidate(candidate.sourceDocumentId!, interviews.length > 0 ? 'records' : 'schedule')}
            type="button"
          >
            <Icon name="users" size={13} />
            {interviews.length > 0 ? t('查看全部面试记录', 'すべての面談記録を見る') : t('安排面试', '面談を設定')}
          </button>
        </AgentBlockActions>
      ) : null}
    </article>
  )
}

function ResumeImportView({
  block,
  zh,
  onOpenCandidate,
  onOpenOriginalDocument
}: {
  block: Extract<AiConversationBlock, { type: 'resume-import' }>
  zh: boolean
  onOpenCandidate?(sourceDocumentId: string, view?: CandidateRouteView): void
  onOpenOriginalDocument?(sourceDocumentId: string): void
}) {
  const t = localeText(zh)

  return (
    <article className="agent-import-card">
      <header>
        <span className="agent-import-icon">
          <Icon name="file" size={16} />
        </span>
        <div>
          <strong>{t(`已导入 ${block.imported.length} 份简历`, `${block.imported.length}件の履歴書を取り込みました`)}</strong>
        </div>
      </header>
      <div>
        {block.imported.map((item) => (
          <section key={item.documentId}>
            <span>
              <strong>{item.label}</strong>
              <small>{t('本地加密文件', '端末内暗号化ファイル')}</small>
            </span>
            <div>
              {onOpenCandidate ? (
                <button onClick={() => onOpenCandidate(item.documentId, 'resume')} type="button">
                  {t('查看资料', '資料を見る')}
                </button>
              ) : null}
              {onOpenOriginalDocument ? (
                <button onClick={() => onOpenOriginalDocument(item.documentId)} type="button">
                  <Icon name="file" size={12} />
                  {t('打开文件', 'ファイルを開く')}
                </button>
              ) : null}
            </div>
          </section>
        ))}
      </div>
      {block.failedCount > 0 ? (
        <AgentBlockActions>
          <span className="agent-import-failed">{t(`${block.failedCount} 份导入失败`, `${block.failedCount}件の取込に失敗`)}</span>
        </AgentBlockActions>
      ) : null}
    </article>
  )
}

function CandidateDraftFactsView({
  facts,
  zh,
  onOpenCandidate,
  onOpenOriginalDocument
}: {
  facts: AgentCandidateDraftFacts
  zh: boolean
  onOpenCandidate?(sourceDocumentId: string, view?: CandidateRouteView): void
  onOpenOriginalDocument?(sourceDocumentId: string): void
}) {
  const t = localeText(zh)

  const visibleFields = facts.fields.filter((field) => field.status !== 'missing')
  const visibleProjects = facts.projects.slice(0, 5)
  return (
    <article className="agent-draft-facts">
      <header className="agent-draft-header">
        <span>
          <Icon name="file" size={15} />
        </span>
        <div>
          <strong>
            {facts.label} · {t('简历内容', '履歴書の内容')}
          </strong>
          <small>
            {t(
              `${visibleFields.length} 个已识别字段 · ${facts.projects.length} 段项目经历`,
              `識別済み${visibleFields.length}項目 · プロジェクト${facts.projects.length}件`
            )}
          </small>
        </div>
      </header>
      <dl>
        {visibleFields.map((field) => (
          <div key={field.label}>
            <dt>{localizedMainText(zh ? 'zh-CN' : 'ja-JP', field.label)}</dt>
            <dd>
              {field.value ?? '—'}
              <small>{field.sources.join(' · ')}</small>
            </dd>
          </div>
        ))}
      </dl>
      {visibleProjects.length > 0 ? (
        <ol className="agent-draft-projects">
          {visibleProjects.map((project, index) => (
            <li key={`${project.title}-${index}`}>
              <strong>{project.title}</strong>
              <span>{[project.period, project.role].filter(Boolean).join(' · ')}</span>
              {project.technologies.length > 0 ? <span>{project.technologies.join('、')}</span> : null}
              {project.summary ? <p>{project.summary}</p> : null}
              <small>{project.sources.join(' · ')}</small>
            </li>
          ))}
        </ol>
      ) : null}
      <AgentBlockActions>
        {onOpenCandidate ? (
          <button onClick={() => onOpenCandidate(facts.documentId, 'resume')} type="button">
            <Icon name="users" size={13} />
            {t('查看资料', '資料を見る')}
          </button>
        ) : null}
        {onOpenOriginalDocument ? (
          <button onClick={() => onOpenOriginalDocument(facts.documentId)} type="button">
            <Icon name="file" size={13} />
            {t('打开原文件', '元ファイルを開く')}
          </button>
        ) : null}
      </AgentBlockActions>
    </article>
  )
}

/**
 * Re-reads a persisted intake card from the live review it points at. A card
 * whose review is absent from the snapshot keeps its persisted content: the
 * snapshot may simply not have been refreshed yet, and deletion tombstones
 * arrive through the persisted card itself.
 */
function liveDraftCard(card: AgentJobCaseDraftCard, reviews: ReadonlyArray<JobCaseReviewSnapshot>): AgentJobCaseDraftCard {
  if (card.status === 'deleted') return card
  const review = reviews.find((item) => item.reviewId === card.reviewId)
  if (!review) return card
  return {
    ...card,
    title: review.fields.find((field) => field.key === 'title')?.value ?? null,
    reviewStatus: review.status,
    lifecycle: review.lifecycle,
    jobCase: review.jobCase ? { id: review.jobCase.id, version: review.jobCase.version } : null,
    fields: review.fields.map((field) => ({ key: field.key, label: field.label, value: field.value, status: field.status })),
    warningCodes: review.warningCodes
  }
}

/** A case is valid or not; a draft the store refused is "needs completing". */
function draftOutcomeLabel(card: AgentJobCaseDraftCard, zh: boolean): string {
  const t = localeText(zh)

  if (card.status === 'deleted') return t('已删除', '削除済み')
  if (card.lifecycle === 'archived') return t('已结束', '終了')
  if (card.reviewStatus === 'completed') return t('有效', '有効')
  return t('待补充', '要補完')
}

function JobCaseDraftCardsView({
  block,
  zh,
  reviews,
  onOpenSystemAccess,
  onRunMatching,
  matchingBusy,
  onPreviewJobCaseDeletion,
  onDeleteJobCase
}: {
  block: Extract<AiConversationBlock, { type: 'job-case-draft-cards' }>
  zh: boolean
  reviews: ReadonlyArray<JobCaseReviewSnapshot>
  onOpenSystemAccess?(access: AgentSystemAccessBlock): void
  matchingBusy?: boolean
  onRunMatching?(card: AgentJobCaseDraftCard): void
  onPreviewJobCaseDeletion?(reviewId: string): Promise<JobCaseDeletionPreview>
  onDeleteJobCase?(input: DeleteJobCaseDataInput): Promise<DeleteJobCaseDataResult>
}) {
  const t = localeText(zh)

  const cards = block.cards.map((card) => liveDraftCard(card, reviews))
  const live = cards.filter((card) => card.status !== 'deleted')
  const valid = live.filter((card) => card.reviewStatus === 'completed' && card.lifecycle === 'active').length
  const attention = live.filter((card) => card.reviewStatus !== 'completed').length
  const reviewIds = cards.filter((card) => card.status !== 'deleted').map((card) => card.reviewId)
  // Deletion is the same governed flow as the case inbox: an impact preview,
  // then the operator types the confirmation word. One card at a time.
  const [deletion, setDeletion] = useState<{
    reviewId: string
    preview: JobCaseDeletionPreview | null
    confirmation: string
    busy: boolean
    error: string | null
  } | null>(null)
  const confirmationWord = t('删除', '削除')
  const startDeletion = async (card: AgentJobCaseDraftCard) => {
    if (!onPreviewJobCaseDeletion || deletion?.busy) return
    setDeletion({ reviewId: card.reviewId, preview: null, confirmation: '', busy: true, error: null })
    try {
      const preview = await onPreviewJobCaseDeletion(card.reviewId)
      setDeletion({ reviewId: card.reviewId, preview, confirmation: '', busy: false, error: null })
    } catch (cause) {
      setDeletion({
        reviewId: card.reviewId,
        preview: null,
        confirmation: '',
        busy: false,
        error: localizedIpcError(zh ? 'zh-CN' : 'ja-JP', cause, t('无法确认删除影响。', '削除影響を確認できませんでした。'))
      })
    }
  }
  const confirmDeletion = async () => {
    if (!deletion?.preview || !onDeleteJobCase || deletion.busy || deletion.confirmation !== confirmationWord) return
    setDeletion({ ...deletion, busy: true, error: null })
    try {
      // i18n-ignore: confirmation token sent to Main
      await onDeleteJobCase({ reviewId: deletion.reviewId, confirmationHash: deletion.preview.confirmationHash, confirmationText: '削除' })
      setDeletion(null)
    } catch (cause) {
      setDeletion({
        ...deletion,
        busy: false,
        error: localizedIpcError(zh ? 'zh-CN' : 'ja-JP', cause, t('案件数据删除失败。', '案件データを削除できませんでした。'))
      })
    }
  }
  return (
    <article className="agent-import-card agent-draft-cards">
      <header>
        <span className="agent-import-icon">
          <Icon name="briefcase" size={16} />
        </span>
        <div>
          <strong>{t(`本次导入的案件草稿 ${cards.length} 条`, `今回取り込んだ案件下書き ${cards.length}件`)}</strong>
          <small>
            {t(`${valid} 条有效`, `有効${valid}件`)}
            {attention > 0 ? t(`，${attention} 条待补充`, `・要補完${attention}件`) : ''}
            {t(' · 可在右侧查看并直接修改', ' · 右側で確認・直接編集できます')}
          </small>
        </div>
      </header>
      <div className="agent-draft-card-list">
        {cards.map((card) => {
          const deleted = card.status === 'deleted'
          const pendingDeletion = deletion?.reviewId === card.reviewId ? deletion : null
          return (
            <section className={`agent-draft-card is-${deleted ? 'deleted' : 'current'}`} key={`${card.reviewId}-${card.ordinal}`}>
              <header>
                <div className="agent-draft-card-heading">
                  <span className="agent-card-kicker">{card.label}</span>
                  <span className="agent-status-chip">{draftOutcomeLabel(card, zh)}</span>
                </div>
                <h3>{card.title ?? (deleted ? t('已删除的草稿', '削除された下書き') : t('未命名案件', '名称未設定案件'))}</h3>
              </header>
              {deleted ? null : (
                <footer>
                  <div className="agent-draft-actions">
                    <button
                      disabled={!onOpenSystemAccess}
                      onClick={() => onOpenSystemAccess?.({ type: 'system-access', destination: 'case-review', reviewId: card.reviewId })}
                      type="button"
                    >
                      {card.reviewStatus === 'completed' ? t('查看 / 修改', '表示・編集') : t('补充并生效', '補完して有効化')}
                    </button>
                    {card.jobCase && card.lifecycle === 'active' && onRunMatching ? (
                      <button
                        className="is-primary"
                        disabled={matchingBusy}
                        aria-busy={matchingBusy}
                        onClick={() => onRunMatching(card)}
                        type="button"
                      >
                        <Icon name="sparkles" size={12} />
                        {t('找人', '要員を探す')}
                      </button>
                    ) : null}
                    {onPreviewJobCaseDeletion && onDeleteJobCase ? (
                      <button
                        className="is-danger"
                        disabled={Boolean(deletion?.busy) || Boolean(pendingDeletion)}
                        onClick={() => void startDeletion(card)}
                        type="button"
                      >
                        {t('删除', '削除')}
                      </button>
                    ) : null}
                  </div>
                </footer>
              )}
              {pendingDeletion ? (
                <div className="agent-draft-delete" role="group" aria-label={t('案件删除确认', '案件削除確認')}>
                  {pendingDeletion.preview ? (
                    <>
                      <p>
                        {t(
                          `将永久删除案件「${pendingDeletion.preview.title}」：案件版本 ${pendingDeletion.preview.counts.caseVersions}、审核记录 ${pendingDeletion.preview.counts.reviewAudits}、关联任务 ${pendingDeletion.preview.counts.taskRecords}、PII 映射 ${pendingDeletion.preview.counts.piiMappings}、会话引用 ${pendingDeletion.preview.counts.agentReferences.messages}、跟进记录 ${pendingDeletion.preview.counts.businessFollowUps ?? 0}。此操作不可恢复。`,
                          `案件「${pendingDeletion.preview.title}」を完全削除：案件版${pendingDeletion.preview.counts.caseVersions}件・審査記録${pendingDeletion.preview.counts.reviewAudits}件・関連タスク${pendingDeletion.preview.counts.taskRecords}件・PII対応表${pendingDeletion.preview.counts.piiMappings}件・会話参照${pendingDeletion.preview.counts.agentReferences.messages}件・対応記録${pendingDeletion.preview.counts.businessFollowUps ?? 0}件。元に戻せません。`
                        )}
                      </p>
                      <div className="agent-draft-delete-controls">
                        <input
                          aria-label={t('案件删除确认输入', '案件削除確認入力')}
                          disabled={pendingDeletion.busy}
                          onChange={(event) => setDeletion({ ...pendingDeletion, confirmation: event.target.value })}
                          placeholder={t(`输入「${confirmationWord}」以继续`, `続行するには「${confirmationWord}」と入力`)}
                          value={pendingDeletion.confirmation}
                        />
                        <button
                          className="is-danger"
                          disabled={pendingDeletion.busy || pendingDeletion.confirmation !== confirmationWord}
                          onClick={() => void confirmDeletion()}
                          type="button"
                        >
                          {pendingDeletion.busy ? t('删除中…', '削除中…') : t('确认删除', '完全に削除')}
                        </button>
                        <button disabled={pendingDeletion.busy} onClick={() => setDeletion(null)} type="button">
                          {t('取消', 'キャンセル')}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p>{pendingDeletion.busy ? t('正在确认删除影响…', '削除影響を確認中…') : null}</p>
                  )}
                  {pendingDeletion.error ? (
                    <p className="agent-draft-delete-error" role="alert">
                      {pendingDeletion.error}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
          )
        })}
      </div>
      <AgentBlockActions>
        {onOpenSystemAccess && reviewIds.length > 0 ? (
          <button
            onClick={() =>
              onOpenSystemAccess({ type: 'system-access', destination: 'review-center', intakeBatchId: block.intakeBatchId, reviewIds })
            }
            type="button"
          >
            <Icon name="shield" size={13} />
            {t('在审核中心批量处理', 'レビューセンターで一括処理')}
          </button>
        ) : null}
      </AgentBlockActions>
    </article>
  )
}

function broadcastStatusLabel(status: AgentJobCaseBroadcastCard['status'], zh: boolean): string {
  const t = localeText(zh)

  if (status === 'new') return t('新增', '新着')
  if (status === 'copied') return t('已复制', 'コピー済み')
  return t('待补充', '要補完')
}

/**
 * One drafted message. The text is a snapshot of what the tool wrote: it is
 * copied or handed to the default mail composer exactly as generated, so the
 * box is read-only and editing happens in the 案件配信 screen, where a redraw
 * re-runs the checks. Opening a composer never claims the message was sent.
 */
function BroadcastCardView({
  card,
  zh,
  onOpenSystemAccess
}: {
  card: AgentJobCaseBroadcastCard
  zh: boolean
  onOpenSystemAccess?(access: AgentSystemAccessBlock): void
}) {
  const t = localeText(zh)

  const [lang, setLang] = useState<BroadcastLanguage>('ja')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const text = lang === 'zh' ? card.textZh : card.textJa
  const forbidden = lang === 'zh' ? card.forbiddenZh : card.forbiddenJa

  const copy = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await copyTextToClipboard(text)
      await window.sesAgent.recordCaseBroadcastCopy({
        reviewId: card.reviewId,
        templateId: card.templateId,
        lang,
        kind: 'new',
        text
      })
      setNotice(t('已复制，可以去微信粘贴了。', 'コピーしました。微信に貼り付けてください。'))
    } catch (cause) {
      setError(
        localizedIpcError(zh ? 'zh-CN' : 'ja-JP', cause, t('复制失败，请重试。', 'コピーできませんでした。もう一度お試しください。'))
      )
    } finally {
      setBusy(false)
    }
  }

  const openEmail = async () => {
    if (busy || forbidden.length > 0) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await window.sesAgent.openCaseBroadcastEmail({
        reviewId: card.reviewId,
        templateId: card.templateId,
        lang,
        kind: 'new',
        text
      })
      setNotice(
        t('已打开默认邮件客户端。请确认收件人和正文后手动发送。', '既定のメールアプリを開きました。宛先と本文を確認して送信してください。')
      )
    } catch (cause) {
      setError(
        localizedIpcError(zh ? 'zh-CN' : 'ja-JP', cause, t('无法打开邮件，请重试。', 'メールを開けませんでした。もう一度お試しください。'))
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="agent-draft-card agent-broadcast-card">
      <header>
        <div className="agent-draft-card-heading">
          <span className="agent-card-kicker">{`#${card.ordinal}`}</span>
          <span className="agent-status-chip">{broadcastStatusLabel(card.status, zh)}</span>
        </div>
        <h3>{card.title}</h3>
      </header>
      <div className="agent-broadcast-tabs" role="group" aria-label={t('消息语言', 'メッセージの言語')}>
        <button aria-pressed={lang === 'ja'} className={lang === 'ja' ? 'is-selected' : ''} onClick={() => setLang('ja')} type="button">
          {/* i18n-ignore: language name shown in its own language */}
          日本語
        </button>
        <button aria-pressed={lang === 'zh'} className={lang === 'zh' ? 'is-selected' : ''} onClick={() => setLang('zh')} type="button">
          中文
        </button>
      </div>
      {forbidden.length > 0 ? (
        <p className="agent-broadcast-forbidden" role="alert">
          <Icon name="alert" size={13} />
          <span>
            {t(
              `正文里还有识别信息（${forbidden.join('、')}），请在群发案件页修改后再发。`,
              `本文に識別子が残っています（${forbidden.join('、')}）。案件配信画面で修正してください。`
            )}
          </span>
        </p>
      ) : null}
      <details className="agent-broadcast-text">
        <summary>{t('查看正文', '本文を表示')}</summary>
        <textarea aria-label={t('群消息正文', '群メッセージ本文')} readOnly rows={10} value={text} />
      </details>
      {notice ? (
        <p className="agent-broadcast-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="agent-broadcast-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="agent-draft-actions">
        <button className="is-primary" disabled={busy || forbidden.length > 0} onClick={() => void copy()} type="button">
          <Icon name="copy" size={12} />
          {t('复制', 'コピーする')}
        </button>
        <button disabled={busy || forbidden.length > 0} onClick={() => void openEmail()} type="button">
          <Icon name="mail" size={12} />
          {t('打开邮件', 'メールを開く')}
        </button>
        <button
          disabled={!onOpenSystemAccess}
          onClick={() => onOpenSystemAccess?.({ type: 'system-access', destination: 'broadcast', reviewId: card.reviewId })}
          type="button"
        >
          {t('在右侧打开', '右側で開く')}
        </button>
      </div>
    </section>
  )
}

function BroadcastCardsView({
  block,
  zh,
  onOpenSystemAccess
}: {
  block: Extract<AiConversationBlock, { type: 'job-case-broadcast-cards' }>
  zh: boolean
  onOpenSystemAccess?(access: AgentSystemAccessBlock): void
}) {
  const t = localeText(zh)

  return (
    <article className="agent-import-card agent-draft-cards">
      <header>
        <span className="agent-import-icon">
          <Icon name="mail" size={16} />
        </span>
        <div>
          <strong>{t(`已生成 ${block.cards.length} 条群消息`, `群メッセージ ${block.cards.length}件`)}</strong>
          <small>
            {t(
              `队列：新增 ${block.queue.new} · 已复制 ${block.queue.copied} · 待补充 ${block.queue.attention}`,
              `キュー：新着 ${block.queue.new} · コピー済み ${block.queue.copied} · 要補完 ${block.queue.attention}`
            )}
          </small>
        </div>
      </header>
      <div className="agent-draft-card-list">
        {block.cards.map((card) => (
          <BroadcastCardView card={card} key={`${card.reviewId}-${card.ordinal}`} onOpenSystemAccess={onOpenSystemAccess} zh={zh} />
        ))}
      </div>
      <AgentBlockActions>
        <button
          disabled={!onOpenSystemAccess}
          onClick={() => onOpenSystemAccess?.({ type: 'system-access', destination: 'broadcast' })}
          type="button"
        >
          <Icon name="mail" size={13} />
          {t('群发案件', '案件を配信')}
        </button>
      </AgentBlockActions>
    </article>
  )
}

function systemAccessContent(
  block: AgentSystemAccessBlock,
  zh: boolean
): {
  icon: IconName
  title: string
  description: string
  action: string
} {
  const t = localeText(zh)

  if (block.destination === 'job-cases')
    return {
      icon: 'briefcase',
      title: t('案件管理', '案件管理'),
      description: t('查看、选择或继续维护系统中的案件记录。', 'システム内の案件を確認・選択・更新します。'),
      action: t('打开案件管理', '案件管理を開く')
    }
  if (block.destination === 'case-import')
    return {
      icon: 'upload',
      title: t('导入案件', '案件を取り込む'),
      description: t('在右侧创建本机案件草稿并进入人工审核。', '右側でローカル案件下書きを作成し、人の確認へ進みます。'),
      action: t('打开案件导入', '案件取込を開く')
    }
  if (block.destination === 'case-review')
    return {
      icon: 'briefcase',
      title: t('案件详情', '案件詳細'),
      description: t('在右侧查看结构化案件字段与审核状态。', '右側で構造化案件項目と確認状態を表示します。'),
      action: t('打开案件详情', '案件詳細を開く')
    }
  if (block.destination === 'matching')
    return {
      icon: 'users',
      title: t('完整匹配工作台', '詳細マッチング'),
      description: t('进入结构化匹配结果，查看完整证据和人员排序。', '構造化された根拠と要員の順位を確認します。'),
      action: t('打开完整匹配', '詳細マッチングを開く')
    }
  if (block.destination === 'candidate-management')
    return {
      icon: 'users',
      title: t('人员管理', '要員管理'),
      description: t('查看人员档案、招聘状态和面试记录。', '要員プロフィール、採用状況、面談記録を確認します。'),
      action: t('打开人员管理', '要員管理を開く')
    }
  if (block.destination === 'candidate') {
    const records = !['overview', 'resume'].includes(block.view)
    const resume = block.view === 'resume'
    return {
      icon: resume ? 'file' : records ? 'clock' : 'users',
      title: resume ? t('人员简历', '要員の履歴書') : records ? t('人员面试记录', '要員の面談記録') : t('人员档案', '要員プロフィール'),
      description: resume
        ? t('查看简历资料和项目经历，需要时可修改。', '履歴書とプロジェクト経験を表示し、必要に応じて修正できます。')
        : records
          ? t('查看该人员的全部面试轮次和处理状态。', 'この要員の面談ラウンドと処理状況を確認します。')
          : t('查看该人员的结构化档案与业务状态。', '構造化プロフィールと業務ステータスを確認します。'),
      action: resume
        ? t('查看资料', '資料を見る')
        : records
          ? t('打开面试记录', '面談記録を開く')
          : t('打开人员档案', '要員プロフィールを開く')
    }
  }
  if (block.destination === 'original-document')
    return {
      icon: 'file',
      title: t('原始简历', '原始履歴書'),
      description: t(
        '在右侧本机解密显示原始文件，对话只读取脱敏结构化投影。',
        '右側で原始ファイルを端末内復号表示し、会話は脱敏済み構造化投影だけを参照します。'
      ),
      action: t('查看原始简历', '原始履歴書を見る')
    }
  if (block.destination === 'review-center' && block.reviewIds && block.reviewIds.length > 0)
    return {
      icon: 'shield',
      title: t('审核中心 · 本次导入', 'レビューセンター · 今回の取込'),
      description: t(
        `逐条确认本次导入的 ${block.reviewIds.length} 条案件草稿，可按行快速确认。`,
        `今回取り込んだ${block.reviewIds.length}件の案件下書きを1件ずつ確認します。`
      ),
      action: t('批量审核', '一括レビュー')
    }
  if (block.destination === 'review-center')
    return {
      icon: 'shield',
      title: t('审核中心', 'レビューセンター'),
      description: t('查看需要处理的操作和记录。', '対応が必要な操作と記録を確認します。'),
      action: t('打开审核中心', 'レビューセンターを開く')
    }
  if (block.destination === 'broadcast')
    return {
      icon: 'mail',
      title: t('群发案件', '案件を配信'),
      description: t('在右侧查看待群发案件、群消息和复制历史。', '右側で配信キュー、群メッセージ、コピー履歴を確認します。'),
      action: t('打开群发案件', '案件配信を開く')
    }
  if (block.destination === 'task')
    return {
      icon: 'tasks',
      title: t('任务详情', 'タスク詳細'),
      description: t('在右侧查看任务状态、进度、范围和证据数量。', '右側でタスク状態、進捗、範囲と証跡数を確認します。'),
      action: t('打开任务详情', 'タスク詳細を開く')
    }
  return {
    icon: 'clock',
    title: t('面试日程', '面談日程'),
    description: t('在日历中查看、修改并继续处理招聘和客户面试。', 'カレンダーで採用・顧客面談を確認、変更、処理します。'),
    action: t('打开面试日程', '面談日程を開く')
  }
}

function InterviewReceiptView({
  block,
  zh,
  onOpen,
  onOpenCandidate
}: {
  block: Extract<AgentSystemAccessBlock, { destination: 'interview-schedule' }>
  zh: boolean
  onOpen?(access: AgentSystemAccessBlock): void
  onOpenCandidate?(sourceDocumentId: string, view?: CandidateRouteView): void
}) {
  const t = localeText(zh)

  const receipt = block.receipt
  if (!receipt) return null
  const methodLabel = {
    zoom: 'Zoom',
    'google-meet': 'Google Meet',
    phone: t('电话', '電話'),
    onsite: t('现场', '対面')
  }[receipt.meetingMethod]
  return (
    <div className="agent-result-group">
      <article className="agent-interview-receipt">
        <span className="agent-interview-receipt-icon">
          <Icon name="clock" size={22} />
        </span>
        <div className="agent-interview-receipt-content">
          <header>
            <strong>{t('面试已登记', '面談を登録しました')}</strong>
            <span>
              <Icon name="check" size={13} />
              {t('已保存', '保存済み')}
            </span>
          </header>
          <p>
            {formatJstDateTime(receipt.scheduledAt)} · {receipt.durationMinutes} {t('分钟', '分')} · {methodLabel}
          </p>
          {receipt.meetingLinkStoredLocally ? (
            <small>{t(`${methodLabel} 链接已在本机保存`, `${methodLabel} リンクは端末内に保存済み`)}</small>
          ) : null}
        </div>
        <div className="agent-interview-receipt-actions">
          <button className="is-primary" disabled={!onOpen} onClick={() => onOpen?.(block)} type="button">
            {t('打开面试日程', '面談日程を開く')}
          </button>
          <button disabled={!onOpenCandidate} onClick={() => onOpenCandidate?.(receipt.sourceDocumentId, 'schedule')} type="button">
            {t('修改', '変更')}
          </button>
        </div>
      </article>
      {onOpenCandidate ? (
        <section className="agent-next-actions" aria-label={t('接下来可以', '次にできること')}>
          <strong>{t('接下来可以', '次にできること')}</strong>
          <div>
            <button onClick={() => onOpenCandidate(receipt.sourceDocumentId, 'prepare')} type="button">
              <Icon name="sparkles" size={14} />
              {t('准备面试问题', '質問を準備')}
            </button>
            <button onClick={() => onOpenCandidate(receipt.sourceDocumentId, 'resume')} type="button">
              <Icon name="file" size={14} />
              {t('查看人员简历', '履歴書を見る')}
            </button>
            <button onClick={() => onOpenCandidate(receipt.sourceDocumentId, 'schedule')} type="button">
              <Icon name="users" size={14} />
              {t('安排下一轮', '次の面談を設定')}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}

function SystemAccessView({
  block,
  zh,
  onOpen,
  onOpenCandidate
}: {
  block: AgentSystemAccessBlock
  zh: boolean
  onOpen?(access: AgentSystemAccessBlock): void
  onOpenCandidate?(sourceDocumentId: string, view?: CandidateRouteView): void
}) {
  const t = localeText(zh)

  // Historical import messages linked a global review queue, unrelated to this conversation.
  if (block.destination === 'review-center' && !block.reviewIds?.length) return null
  if (block.destination === 'interview-schedule' && block.receipt) {
    return <InterviewReceiptView block={block} onOpen={onOpen} onOpenCandidate={onOpenCandidate} zh={zh} />
  }
  if (block.destination === 'interview-schedule') {
    return (
      <article className="agent-interview-receipt is-legacy">
        <span className="agent-interview-receipt-icon">
          <Icon name="clock" size={22} />
        </span>
        <div className="agent-interview-receipt-content">
          <header>
            <strong>{t('面试已登记', '面談を登録しました')}</strong>
            <span>
              <Icon name="check" size={13} />
              {t('已保存', '保存済み')}
            </span>
          </header>
          <p>{t('可在面试日程中查看或修改这条本地记录。', '面談日程からこのローカル記録を確認・変更できます。')}</p>
        </div>
        <div className="agent-interview-receipt-actions">
          <button className="is-primary" disabled={!onOpen} onClick={() => onOpen?.(block)} type="button">
            {t('打开面试日程', '面談日程を開く')}
          </button>
        </div>
      </article>
    )
  }
  const content = systemAccessContent(block, zh)
  return (
    <article className="agent-system-access-card">
      <span className="agent-system-access-icon">
        <Icon name={content.icon} size={17} />
      </span>
      <div>
        <small>{t('本系统入口', 'システム内リンク')}</small>
        <strong>{content.title}</strong>
        <p>{content.description}</p>
      </div>
      <button disabled={!onOpen} onClick={() => onOpen?.(block)} type="button">
        {content.action}
        <Icon name="chevron-right" size={13} />
      </button>
    </article>
  )
}

function BlockView({
  block,
  locale,
  zh,
  onSelectCase,
  onOpenCandidate,
  onOpenMatching,
  onOpenOriginalDocument,
  onOpenSystemAccess,
  onRunMatching,
  matchingBusy,
  jobCaseReviews,
  onPreviewJobCaseDeletion,
  onDeleteJobCase,
  currentCaseId
}: {
  block: AiConversationBlock
  locale: string
  zh: boolean
  onSelectCase(reference: TypedAiConversationReference): void
  onOpenCandidate?(
    sourceDocumentId: string,
    view?: CandidateRouteView,
    interviewId?: string | null,
    interviewKind?: 'recruiting' | 'client'
  ): void
  onOpenMatching(jobCaseId: string): void
  onOpenOriginalDocument?(sourceDocumentId: string): void
  onOpenSystemAccess?(access: AgentSystemAccessBlock): void
  matchingBusy?: boolean
  onRunMatching?(card: AgentJobCaseDraftCard): void
  jobCaseReviews: ReadonlyArray<JobCaseReviewSnapshot>
  onPreviewJobCaseDeletion?(reviewId: string): Promise<JobCaseDeletionPreview>
  onDeleteJobCase?(input: DeleteJobCaseDataInput): Promise<DeleteJobCaseDataResult>
  currentCaseId: string | null
}) {
  const t = localeText(zh)

  if (block.type === 'text') return <p className="agent-block-text">{block.text}</p>
  if (block.type === 'job-case-cards')
    return (
      <div className="agent-card-stack">
        {block.cards.slice(0, 3).map((card) => (
          <JobCaseCardView card={card} key={card.reference.objectId} onOpenMatching={onOpenMatching} onSelect={onSelectCase} zh={zh} />
        ))}
        {block.cards.length > 3 ? (
          <details>
            <summary>{t(`展开其余 ${block.cards.length - 3} 个案件`, `残り ${block.cards.length - 3} 件を表示`)}</summary>
            {block.cards.slice(3).map((card) => (
              <JobCaseCardView card={card} key={card.reference.objectId} onOpenMatching={onOpenMatching} onSelect={onSelectCase} zh={zh} />
            ))}
          </details>
        ) : null}
      </div>
    )
  if (block.type === 'candidate-match-cards')
    return (
      <CandidateMatchCardsView
        block={block}
        currentCaseId={currentCaseId}
        onOpenCandidate={onOpenCandidate ? (sourceDocumentId) => onOpenCandidate(sourceDocumentId, 'overview') : undefined}
        onOpenMatching={onOpenMatching}
        zh={zh}
      />
    )
  if (block.type === 'candidate-profile-evidence')
    return (
      <CandidateProfileEvidenceView
        block={block}
        onOpenCandidate={onOpenCandidate}
        onOpenOriginalDocument={onOpenOriginalDocument}
        zh={zh}
      />
    )
  if (block.type === 'candidate-interview-evidence')
    return <CandidateInterviewEvidenceView block={block} locale={locale} onOpenCandidate={onOpenCandidate} zh={zh} />
  if (block.type === 'clarification')
    return (
      <div className="agent-clarification">
        <strong>{block.prompt}</strong>
        {block.options.length > 0 ? (
          <div>
            {block.options.map((option) => (
              <button key={`${option.kind}-${option.objectId}`} onClick={() => onSelectCase(option)} type="button">
                {option.ordinal ? `${option.ordinal}. ` : ''}
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    )
  if (block.type === 'match-run-explanation') {
    const facts = block.facts
    return (
      <div className="agent-explanation">
        <div className="agent-explanation-grid">
          <span>
            <strong>Match Run</strong>
            {facts.runId.slice(0, 12)}
          </span>
          <span>
            <strong>Result Hash</strong>
            {facts.resultHash.slice(0, 12)}
          </span>
          <span>
            <strong>{t('状态', '状態')}</strong>
            {statusLabel(facts.validity, zh)}
          </span>
          <span>
            <strong>{t('算法', 'アルゴリズム')}</strong>
            {facts.algorithmVersion}
          </span>
        </div>
        <p>
          {t(
            '以上解释来自已保存的 Result Snapshot，没有重新运行本地匹配。',
            '保存済みの Result Snapshot を読み取りました。マッチングは再実行していません。'
          )}
        </p>
        {currentCaseId ? (
          <AgentBlockActions>
            <button disabled={facts.validity === 'deleted'} onClick={() => onOpenMatching(currentCaseId)} type="button">
              {t('打开完整匹配', '詳細マッチングを開く')}
              <Icon name="chevron-right" size={12} />
            </button>
            {facts.candidate?.sourceDocumentId && onOpenCandidate ? (
              <button
                disabled={facts.validity === 'deleted'}
                onClick={() => onOpenCandidate(facts.candidate!.sourceDocumentId!, 'overview')}
                type="button"
              >
                {t('打开人员', '要員を開く')}
              </button>
            ) : null}
          </AgentBlockActions>
        ) : null}
      </div>
    )
  }
  if (block.type === 'resume-import')
    return <ResumeImportView block={block} onOpenCandidate={onOpenCandidate} onOpenOriginalDocument={onOpenOriginalDocument} zh={zh} />
  if (block.type === 'candidate-draft-facts')
    return (
      <CandidateDraftFactsView
        facts={block.facts}
        onOpenCandidate={onOpenCandidate}
        onOpenOriginalDocument={onOpenOriginalDocument}
        zh={zh}
      />
    )
  if (block.type === 'job-case-draft-cards')
    return (
      <JobCaseDraftCardsView
        matchingBusy={matchingBusy}
        block={block}
        onDeleteJobCase={onDeleteJobCase}
        onOpenSystemAccess={onOpenSystemAccess}
        onPreviewJobCaseDeletion={onPreviewJobCaseDeletion}
        onRunMatching={onRunMatching}
        reviews={jobCaseReviews}
        zh={zh}
      />
    )
  if (block.type === 'job-case-broadcast-cards') return <BroadcastCardsView block={block} onOpenSystemAccess={onOpenSystemAccess} zh={zh} />
  if (block.type === 'system-access')
    return <SystemAccessView block={block} onOpen={onOpenSystemAccess} onOpenCandidate={onOpenCandidate} zh={zh} />
  return (
    <div className="agent-error-block" role="alert">
      <Icon name="alert" size={15} />
      <span>{userFacingAgentError(block.message, zh)}</span>
    </div>
  )
}

interface AgentEmptyStateProps {
  selectedPerson?: boolean
  cloudConnected: boolean
  /** 今日新着案件, above everything else: it is what the operator opened the app for. */
  lead?: ReactNode
  selectedCase: TypedAiConversationReference | null
  suggestions: string[]
  zh: boolean
  onImportResume?(): void
  onImportAtsCsv?(): void
  atsImportNotice?: string | null
  onOpenBroadcast?(): void
  onOpenCaseImport?(): void
  onSuggestion(suggestion: string): void
}

function AgentEmptyState({
  selectedPerson,
  cloudConnected,
  lead = null,
  selectedCase,
  suggestions,
  zh,
  onImportResume,
  onImportAtsCsv,
  atsImportNotice,
  onOpenBroadcast,
  onOpenCaseImport,
  onSuggestion
}: AgentEmptyStateProps) {
  const t = localeText(zh)

  const hasQuickActions = Boolean(onImportResume || onImportAtsCsv || onOpenBroadcast || onOpenCaseImport)
  const title = !cloudConnected
    ? t('本地工作仍可继续', 'ローカル業務は続けられます')
    : selectedCase
      ? t('开始处理当前案件', '現在の案件を進める')
      : selectedPerson
        ? t('开始处理当前人员', '現在の要員の対応を進める')
        : t('今天想处理什么工作？', '今日は何を進めますか？')
  const description = !cloudConnected
    ? t(
        '连接受管账号后可以使用自然语言；简历导入、案件导入、粘贴案件/人员文本的本地导入和人工审核仍可在本机安全完成。',
        '受管アカウント接続後は自然言語を利用できます。履歴書・案件の取込、案件・要員テキストの貼り付けによるローカル取込、人によるレビューは、この端末で安全に続けられます。'
      )
    : selectedCase
      ? t(
          '已绑定当前案件。可以找人、查看案件条件，或继续追问保存过的匹配依据。',
          '現在の案件を選択済みです。要員探し、条件確認、保存済み根拠への追加質問ができます。'
        )
      : selectedPerson
        ? t(
            '可以为此人寻找案件、梳理项目经验，或补充介绍内容。对话会保存在此人的资料下。',
            'この要員の案件探し、経験の整理、紹介文の相談ができます。会話はこの要員に紐づけて保存されます。'
          )
        : t(
            '从案件、人员或面谈开始。AI 负责理解请求，事实、执行和业务状态仍由受控本地工具与人工审核决定。',
            '案件・要員・面談から始められます。AI は依頼を理解し、事実・実行・業務状態は制御済みローカル Tool と人のレビューが決定します。'
          )

  return (
    <div className="agent-empty-state">
      {lead}
      <span className="agent-empty-mark">
        <Icon name={cloudConnected ? 'sparkles' : 'shield'} size={24} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {cloudConnected ? (
        <div aria-label={t('建议指令', 'おすすめの指示')} className="agent-starter-prompts" role="group">
          {suggestions.map((suggestion) => (
            <button key={suggestion} onClick={() => onSuggestion(suggestion)} type="button">
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
      {hasQuickActions ? (
        <div aria-label={t('快捷操作', 'クイック操作')} className="agent-quick-actions" role="group">
          {onImportResume ? (
            <AgentQuickAction
              description={t('本地解析，逐项审核后入库', 'ローカル解析後、項目ごとにレビュー')}
              icon="upload"
              label={t('导入简历', '履歴書を取り込む')}
              onClick={onImportResume}
            />
          ) : null}
          {onImportAtsCsv ? (
            <AgentQuickAction
              description={t('每行一名人员，逐行本地解析', '1行1名を端末内で解析')}
              icon="database"
              label={t('导入 ATS CSV', 'ATS CSV を取り込む')}
              onClick={onImportAtsCsv}
            />
          ) : null}
          {onOpenCaseImport ? (
            <AgentQuickAction
              description={t('粘贴、EML 或受管 Gmail', '貼付・EML・受管 Gmail')}
              icon="briefcase"
              label={t('导入案件', '案件を取り込む')}
              onClick={onOpenCaseImport}
            />
          ) : null}
          {onOpenBroadcast ? (
            <AgentQuickAction
              description={t('生成文案并一键复制', '紹介文の生成とワンクリックのコピー')}
              icon="mail"
              label={t('群发案件', '案件を配信')}
              onClick={onOpenBroadcast}
            />
          ) : null}
        </div>
      ) : null}
      {atsImportNotice ? (
        <p className="agent-empty-notice" role="status">
          {atsImportNotice}
        </p>
      ) : null}
    </div>
  )
}

export function AgentWorkspace({
  businessTitle,
  businessMatchingBusy = false,
  chatRequest,
  businessObject,
  composerObject,
  latestContent,
  homeRequestToken = 0,
  contextPanelOpen,
  focusRequest,
  onOpenBatch,
  activeSystemAccess = null,
  composerDraft,
  contextPanel,
  contextPanelLabel,
  newCaseUnseenCount = 0,
  onOpenNewCaseBoard,
  onCloseContextPanel,
  onComposerDraftChange,
  onOpenMatching,
  onOpenCandidate,
  onOpenOriginalDocument,
  reloadToken = 0,
  models = fallbackModels,
  defaultModelKey = 'gpt-5.6-luna',
  cloudConnected = true,
  onConnectCloud,
  onImportResume,
  onImportAtsCsv,
  onOpenBroadcast,
  onOpenCaseImport,
  onOpenCases,
  onOpenSystemAccess,
  status,
  onOpenSettings,
  onOpenOperatorProfile,
  operatorLabel = 'SES',
  onLocalDataChanged,
  candidateReviews = [],
  jobCaseReviews = [],
  onPreviewJobCaseDeletion,
  onDeleteJobCase
}: AgentWorkspaceProps) {
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const t = localeText(zh)
  const [surface, setSurface] = useState<'latest' | 'conversation'>(latestContent ? 'latest' : 'conversation')
  const [historyOpen, setHistoryOpen] = useState(false)
  useEffect(() => {
    if (chatRequest) {
      setSurface('conversation')
      setHistoryOpen(false)
    }
  }, [chatRequest])
  useEffect(() => {
    if (!businessTitle || surface !== 'conversation') return
    const trigger = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => composerInputRef.current?.focus({ preventScroll: true }))
    return () => {
      cancelAnimationFrame(frame)
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [Boolean(businessTitle), surface])
  const showContextPanel = contextPanelOpen ?? Boolean(contextPanel)
  const contextVisible = showContextPanel && (!businessTitle || surface !== 'conversation')
  const contextualComposer = !businessTitle && showContextPanel && surface === 'conversation' ? composerObject : undefined
  const compactComposer = surface === 'latest'
  const lastHomeRequestRef = useRef(homeRequestToken)
  useEffect(() => {
    if (lastHomeRequestRef.current === homeRequestToken) return
    lastHomeRequestRef.current = homeRequestToken
    if (latestContent) {
      setSurface('latest')
      setHistoryOpen(false)
    }
  }, [homeRequestToken])
  const scopedReview = businessObject?.kind === 'case' ? jobCaseReviews.find((item) => item.reviewId === businessObject.id) : null
  const scopedCase: TypedAiConversationReference | null = scopedReview?.jobCase
    ? {
        kind: 'job-case',
        objectId: scopedReview.jobCase.id,
        objectVersion: scopedReview.jobCase.version,
        resultHash: null,
        ordinal: null,
        label: scopedReview.fields.find((item) => item.key === 'title')?.value ?? scopedReview.redactedSubject,
        target: `job-case:${scopedReview.jobCase.id}`
      }
    : null
  const context = useMemo(
    () => ({
      assistant: 'sales-agent' as const,
      ...(businessObject ? { businessObject } : {}),
      candidateDocumentId: null,
      interviewId: null,
      interviewKind: null,
      roundNumber: null
    }),
    [businessObject?.kind, businessObject?.id]
  )
  const history = useAiConversationHistory(context, reloadToken)
  const activeConversation = history.conversations.find((item) => item.id === history.activeConversationId) ?? null
  const historyView = useMemo(() => conversationHistoryView(history.conversations), [history.conversations])
  // A conversation exists from the moment the workspace opens it, not from the
  // first message. Imports and selected context before the first turn must use
  // the same id as that eventual first turn.
  const [draftConversationId, setDraftConversationId] = useState(() => newId())
  // The active id is authoritative even during a transient history-array
  // refresh. Falling back based on a temporarily missing snapshot minted a new
  // draft id and could turn an ordinary follow-up into a new conversation.
  const currentConversationId = history.activeConversationId ?? draftConversationId
  const previousContext = useRef(context)
  useEffect(() => {
    if (previousContext.current === context) return
    previousContext.current = context
    setDraftConversationId(newId())
    setCaseSelection(null)
    setCandidateSelection(null)
    setLocalComposerDraft('')
    onComposerDraftChange?.('')
  }, [context])
  const [localComposerDraft, setLocalComposerDraft] = useState('')
  const draft = composerDraft ?? localComposerDraft
  const updateDraft = (value: string) => {
    if (composerDraft === undefined) setLocalComposerDraft(value)
    onComposerDraftChange?.(value)
  }
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
  const candidateNames = useMemo(() => {
    const sorted = [...candidateReviews].sort((a, b) => a.documentId.localeCompare(b.documentId))
    const counts = new Map<string, number>()
    for (const review of sorted) {
      const name = review.localIdentity?.displayName || review.fileName
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    const ordinals = new Map<string, number>()
    return new Map(
      sorted.map((review) => {
        const name = review.localIdentity?.displayName || review.fileName
        const ordinal = (ordinals.get(name) ?? 0) + 1
        ordinals.set(name, ordinal)
        return [review.documentId, (counts.get(name) ?? 0) > 1 ? `${name} · ${t('资料', '資料')} ${ordinal}` : name]
      })
    )
  }, [candidateReviews, zh])
  const [candidateSelection, setCandidateSelection] = useState<{ conversationId: string; documentId: string | null } | null>(null)
  const selectedCandidateDocumentId =
    candidateSelection?.conversationId === currentConversationId
      ? candidateSelection.documentId
      : (activeConversation?.salesAgentState?.selectedCandidateDocumentId ?? (businessObject?.kind === 'person' ? businessObject.id : null))
  const selectedCandidateLabel = selectedCandidateDocumentId
    ? (candidateNames.get(selectedCandidateDocumentId) ?? t('所选人员', '選択中の要員'))
    : null
  const clearSelectedCandidate = () => {
    setCandidateSelection({ conversationId: currentConversationId, documentId: null })
    if (activeConversation?.salesAgentState)
      void history
        .persistSalesAgentState({ ...activeConversation.salesAgentState, selectedCandidateDocumentId: null })
        .catch((cause: unknown) =>
          setError(localizedIpcError(locale, cause, t('无法保存当前会话状态。', '会話の状態を保存できませんでした。')))
        )
  }
  useEffect(() => {
    if (focusRequest?.candidateDocumentId)
      setCandidateSelection({ conversationId: currentConversationId, documentId: focusRequest.candidateDocumentId })
    if (focusRequest) setCaseSelection({ conversationId: currentConversationId, reference: focusRequest.caseReference })
  }, [focusRequest])
  const persistedSelectedCase =
    typedReference(activeConversation?.salesAgentState?.selectedJobCaseRef) ?? (businessObject ? scopedCase : null)
  // In a conversation opened on a case, "this case" is that case whenever nothing else has been selected.
  const selectedCase =
    (caseSelection?.conversationId === currentConversationId ? caseSelection.reference : persistedSelectedCase) ??
    (businessObject?.kind === 'case' ? scopedCase : null)
  const [error, setError] = useState<string | null>(null)
  const [lastTurnTimings, setLastTurnTimings] = useState<AgentTurnTimings | null>(null)
  const [atsImportNotice, setAtsImportNotice] = useState<string | null>(null)
  const importAtsCsv = async () => {
    if (!onImportAtsCsv) return
    setAtsImportNotice(null)
    try {
      const result = await onImportAtsCsv()
      if (result.cancelled) return
      setAtsImportNotice(
        t(
          `${result.fileName ?? 'CSV'}：已导入 ${result.importedCount} 名人员（重复 ${result.duplicateCount}、跳过 ${result.skippedCount}、失败 ${result.failedCount}）。`,
          `${result.fileName ?? 'CSV'}：要員情報を${result.importedCount}件取り込みました（重複${result.duplicateCount}件・スキップ${result.skippedCount}件・失敗${result.failedCount}件）。`
        )
      )
      await onLocalDataChanged?.()
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('ATS CSV 导入失败。', 'ATS CSV を取り込めませんでした。')))
    }
  }
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
  const [pickedModelKey, setPickedModelKey] = useState<string | null>(() => {
    try {
      return globalThis.sessionStorage?.getItem(agentModelSessionKey) ?? null
    } catch {
      return null
    }
  })
  const selectedModelKey =
    pickedModelKey !== null && availableModels.some((model) => model.key === pickedModelKey)
      ? pickedModelKey
      : availableModels.some((model) => model.key === defaultModelKey)
        ? defaultModelKey
        : availableModels[0]!.key
  const pickModel = (key: string) => {
    setPickedModelKey(key)
    try {
      globalThis.sessionStorage?.setItem(agentModelSessionKey, key)
    } catch {
      /* session persistence is best-effort */
    }
  }
  const activeRequestRef = useRef<{ conversationId: string; requestId: string; sequence: number; stopRequested: boolean } | null>(null)
  const copyResetTimerRef = useRef<number | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
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

  useEffect(
    () => () => {
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current)
    },
    []
  )

  useEffect(() => {
    if (!contextVisible || !onCloseContextPanel) return undefined
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onCloseContextPanel()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [contextVisible, onCloseContextPanel])

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
    try {
      globalThis.localStorage?.setItem('ses-agent-context-panel-width-v1', String(contextPanelWidth))
    } catch {
      /* best-effort UI preference */
    }
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
        setStreamState((current) =>
          current && current.conversationId === event.conversationId && current.requestId === event.requestId
            ? { ...current, sequence: event.sequence, phase: 'streaming', content: current.content + event.text }
            : current
        )
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
    void history
      .persistSalesAgentState({
        ...activeConversation.salesAgentState,
        selectedJobCaseRef: reference,
        lastMatchRunId: activeConversation.salesAgentState?.lastMatchRunId ?? null,
        lastSearchMessageId: activeConversation.salesAgentState?.lastSearchMessageId ?? null
      })
      .catch((cause: unknown) => {
        setError(localizedIpcError(locale, cause, t('当前案件上下文保存失败。', '現在の案件コンテキストを保存できませんでした。')))
      })
  }

  const clearSelectedCase = () => {
    setCaseSelection({ conversationId: currentConversationId, reference: null })
    if (!activeConversation) return
    void history
      .persistSalesAgentState({
        ...activeConversation.salesAgentState,
        selectedJobCaseRef: null,
        lastMatchRunId: activeConversation.salesAgentState?.lastMatchRunId ?? null,
        lastSearchMessageId: activeConversation.salesAgentState?.lastSearchMessageId ?? null
      })
      .catch((cause: unknown) => {
        setError(localizedIpcError(locale, cause, t('清除案件上下文失败。', '案件コンテキストを解除できませんでした。')))
      })
  }

  const openOriginalFile = (sourceDocumentId: string) => {
    if (!onOpenOriginalDocument) return
    setError(null)
    void onOpenOriginalDocument(sourceDocumentId).catch((cause: unknown) => {
      setError(localizedIpcError(locale, cause, t('无法打开原文件。', '元ファイルを開けませんでした。')))
    })
  }

  const [attachments, setAttachments] = useState<
    Array<StagedLocalFile & { taskId: string; preview?: AgentCandidateDraftFacts; previewError?: string }>
  >([])
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
      if (businessObject && !activeConversation) await history.persistMessages([], null, { conversationId: targetConversationId })
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
      setError(localizedIpcError(locale, cause, t('无法将导入结果加入当前会话。', '取込結果を現在の会話に追加できませんでした。')))
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
      const payload = await Promise.all(
        accepted.map(async (file) => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer())
        }))
      )
      const staged = await window.sesAgent.stageDroppedResumeFiles({ files: payload })
      if (!staged.cancelled && currentConversationIdRef.current === attachmentConversationId) {
        const taskId = staged.task.id
        setAttachments((current) => [...current, ...staged.files.map((file) => ({ ...file, taskId }))].slice(0, 10))
        setImportSummary(null)
        // Parse immediately so the operator can read what is in the file before
        // deciding to import it. Nothing is written until they choose.
        for (const file of staged.files) {
          void window.sesAgent
            .previewStagedResumeFile({ fileToken: file.token })
            .then((preview) => {
              if (currentConversationIdRef.current !== attachmentConversationId) return
              setAttachments((current) => current.map((item) => (item.token === file.token ? { ...item, preview } : item)))
            })
            .catch((cause: unknown) => {
              if (currentConversationIdRef.current !== attachmentConversationId) return
              setAttachments((current) =>
                current.map((item) =>
                  item.token === file.token
                    ? {
                        ...item,
                        previewError: localizedIpcError(locale, cause, t('附件解析失败。', '添付ファイルを解析できませんでした。'))
                      }
                    : item
                )
              )
            })
        }
      }
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('附件暂存失败。', '添付ファイルを保存できませんでした。')))
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
      if (businessObject && !activeConversation) await history.persistMessages([], null, { conversationId })
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
      setError(
        localizedIpcError(
          locale,
          cause,
          t('简历已解析，但未能写入当前会话上下文。', '履歴書は解析されましたが、現在の会話コンテキストに保存できませんでした。')
        )
      )
    } finally {
      setImporting(false)
    }
  }

  /**
   * "跑匹配" on a confirmed intake card: select that case and send the same
   * matching request the composer would. The turn itself persists the case
   * selection, so no separate state save races the turn's revision check.
   */
  const runMatchingForCase = (card: AgentJobCaseDraftCard) => {
    if (!card.jobCase || activeRequestRef.current || pendingMessage || history.saving || attaching || importing) return
    const reference: TypedAiConversationReference = {
      kind: 'job-case',
      objectId: card.jobCase.id,
      objectVersion: card.jobCase.version,
      resultHash: null,
      ordinal: card.ordinal,
      label: card.title ?? card.label,
      target: `job-case:${card.jobCase.id}`
    }
    setCaseSelection({ conversationId: currentConversationId, reference })
    void executeMessage(t('为当前案件找合适的人员', '現在の案件に合う要員を探して'), {
      conversationId: currentConversationId,
      expectedConversationRevision: activeConversation?.revision ?? null,
      selectedJobCaseRef: reference,
      attachmentFileTokens: [],
      clearComposer: false
    })
  }

  const executeMessage = async (
    message: string,
    options: {
      conversationId: string
      expectedConversationRevision: number | null
      selectedJobCaseRef: TypedAiConversationReference | null
      attachmentFileTokens: string[]
      clearComposer: boolean
      branchFrom?: ExecuteAgentTurnInput['branchFrom']
    }
  ) => {
    if (!message || activeRequestRef.current || pendingMessage || history.saving || attaching || importing) return
    const conversationId = options.conversationId
    const currentRequestId = newId()
    const lockedModelKey = selectedModelKey
    setPendingMessage(message)
    if (options.clearComposer) updateDraft('')
    setRequestConversationId(conversationId)
    setRequestId(currentRequestId)
    activeRequestRef.current = { conversationId, requestId: currentRequestId, sequence: 0, stopRequested: false }
    // Cosmetic only: multi-line label:value text is probably headed for the
    // local intake gate, so start on the local phase instead of flashing an
    // "AI is choosing a Tool" label. Main's own events correct this either way.
    const originatingConversationId = currentConversationIdRef.current
    const looksLikeBusinessText = message.includes('\n') && (message.match(/^[^\n:：]{1,20}[:：]/gmu)?.length ?? 0) >= 2
    setStreamState({
      conversationId,
      requestId: currentRequestId,
      sequence: 0,
      content: '',
      phase: looksLikeBusinessText ? 'local-tool' : 'planning',
      modelDisplayName: availableModels.find((model) => model.key === lockedModelKey)?.displayName ?? lockedModelKey
    })
    setError(null)
    try {
      const expectedRevision =
        businessObject && options.expectedConversationRevision === null && !options.branchFrom
          ? (await history.persistMessages([], null, { conversationId })).revision
          : options.expectedConversationRevision
      const result = await window.sesAgent.executeAgentTurn({
        conversationId,
        ...(businessObject ? { businessObject } : {}),
        message,
        expectedConversationRevision: expectedRevision,
        requestId: currentRequestId,
        modelKey: lockedModelKey,
        selectedJobCaseRef: options.selectedJobCaseRef,
        ...(!options.branchFrom ? { activeSystemAccess, selectedCandidateDocumentId } : {}),
        attachmentFileTokens: options.attachmentFileTokens,
        ...(options.branchFrom ? { branchFrom: options.branchFrom } : {})
      })
      // Attachments outlive the turn on purpose: the operator asks about a file
      // first and decides to import it afterwards. They are cleared only once an
      // import actually happened, or when the operator removes them.
      if (result.toolName === 'resume.analyze.local') {
        setAttachments([])
      }
      if (currentConversationIdRef.current !== conversationId && currentConversationIdRef.current !== originatingConversationId) return
      history.acceptConversation(result.conversation)
      setLastTurnTimings(result.timings ?? null)
      setDraftConversationId(result.conversation.id)
      const nextSelected = typedReference(result.conversation.salesAgentState?.selectedJobCaseRef)
      setCaseSelection({ conversationId, reference: nextSelected })
      // The intake gate never persists the pasted text; when it asks for a
      // tagged re-send or fails, the original comes back from this component's
      // own memory into the composer - nowhere else still has it.
      if (result.intake?.restoreComposerText && options.clearComposer) {
        updateDraft(message)
      }
      if (
        result.toolName === 'resume.analyze.local' ||
        result.toolName === 'candidate.interview.schedule.local' ||
        (result.toolName === 'business-text.import.local' && result.status === 'completed')
      ) {
        try {
          await onLocalDataChanged?.()
        } catch {
          setError(
            (current) =>
              current ??
              t(
                '本地操作已经完成，但界面数据刷新失败。重新打开对应页面后可再次加载。',
                'ローカル操作は完了しましたが、画面データを更新できませんでした。対象画面を開き直して再読み込みしてください。'
              )
          )
        }
      }
      if (result.status === 'failed') {
        setError(
          (current) =>
            current ?? t('AI 处理失败；本地已获取的数据仍然保留。', 'AI 処理に失敗しました。ローカルで取得したデータは保持されています。')
        )
      }
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('本地 Agent 执行失败。', 'Local Agent の実行に失敗しました。')))
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
    // Never truncate silently: over-limit text stays in the composer and the
    // operator decides what to trim or where else to import it.
    if (message.length > 4_000) {
      setError(
        t(
          `超过 4,000 字（当前 ${message.length} 字）。一次只粘贴一条完整的案件或人员信息；较长案件可使用「导入案件」的专用粘贴入口。`,
          `4,000文字を超えています（現在${message.length}文字）。1回の送信は案件または要員1件分だけにしてください。長い案件は「案件を取り込む」の専用貼り付けをご利用ください。`
        )
      )
      return
    }
    setSurface('conversation')
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
      await copyTextToClipboard(message.content)
      setCopiedMessageId(message.id)
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current)
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopiedMessageId((current) => (current === message.id ? null : current))
      }, 1_800)
    } catch {
      setError(t('无法复制这条输入。', 'この入力をコピーできませんでした。'))
    }
  }

  const resendEditedMessage = async () => {
    if (!editingMessage || pendingMessage || history.saving || attaching || importing) return
    const messageIndex = history.messages.findIndex((message) => message.id === editingMessage.id && message.role === 'user')
    const editedContent = editingMessage.value.trim()
    if (messageIndex < 0 || !editedContent) return
    if (!activeConversation) {
      setEditingMessage(null)
      setError(t('原会话已不存在，请重新打开后再编辑。', '元の会話が見つかりません。開き直してから編集してください。'))
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
      setStreamState((current) => (current ? { ...current, phase: 'stopping' } : current))
      const result = await window.sesAgent.cancelAgentTurn({ conversationId: requestConversationId, requestId })
      if (result.message) setError(result.message)
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法停止当前操作。', '現在の操作を停止できませんでした。')))
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
    ? [
        ...visibleMessages,
        {
          id: 'agent-pending-message',
          role: 'user' as const,
          content: pendingMessage,
          mode: 'local' as const,
          createdAt: new Date().toISOString()
        }
      ]
    : visibleMessages
  const workspaceContext = useMemo(() => deriveWorkspaceContext(visibleMessages, zh), [visibleMessages, zh])
  const messageTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit'
      }),
    [locale]
  )

  useEffect(() => {
    const container = messageScrollRef.current
    if (!container || surface !== 'conversation') return
    container.scrollTop = container.scrollHeight
  }, [history.messages.length, branchPreviewMessages?.length, pendingMessage, streamState?.content, surface])

  // Every suggestion maps to a capability the current allowlist can resolve.
  // A selected case unlocks matching-specific prompts; without one, the Agent
  // can still search cases or enumerate candidates that can enter scheduling.
  const emptyStateSuggestions = selectedCase
    ? [t('为当前案件找合适的人员', '現在の案件に合う要員を探して'), t('这个案件的条件是什么？', 'この案件の条件は？')]
    : businessObject?.kind === 'person'
      ? [t('为此人寻找合适的案件', 'この要員に合う案件を探して'), t('总结此人的技能和项目经历', 'この要員のスキルと経験をまとめて')]
      : [
          t('最近有什么案件？', '最近の案件は？'),
          t('有哪些人员可以安排面谈？', '面談を設定できる要員は？'),
          t('有哪些进行中的案件？', '進行中の案件は？')
        ]
  // Initial history loading is read-only and sequence-guarded by the history
  // hook, so it must not block a fresh draft. Mutating work still locks the
  // workspace to prevent attachments or saves from crossing conversations.
  const mutationBusy = history.saving || pendingMessage !== null || attaching || importing || systemImporting
  const workspaceBusy = mutationBusy || editingMessage !== null
  const threadTitle =
    selectedCase && workspaceContext.candidateLabel
      ? `${selectedCase.label} · ${workspaceContext.candidateLabel}${workspaceContext.latestAccess?.destination === 'interview-schedule' ? t(' 面试', ' 面談') : ''}`
      : workspaceContext.candidateLabel
        ? `${workspaceContext.candidateLabel}${workspaceContext.latestAccess?.destination === 'interview-schedule' ? t(' 面试', ' 面談') : ''}`
        : selectedCase
          ? selectedCase.label
          : activeConversation
            ? localizedMainText(locale, activeConversation.title)
            : t('新任务', '新しいタスク')
  const hasBusinessContext = Boolean(selectedCase || selectedCandidateDocumentId)
  const deleteConversationThreads = async (conversationIds: string[]) => {
    const selectedRoots = new Set(
      conversationIds.map((conversationId) => {
        const conversation = history.conversations.find((item) => item.id === conversationId)
        return conversation ? (historyView.lineageByConversationId.get(conversation.id) ?? conversation.id) : conversationId
      })
    )
    const branchIds = history.conversations
      .filter((conversation) => selectedRoots.has(historyView.lineageByConversationId.get(conversation.id) ?? conversation.id))
      .map((conversation) => conversation.id)
    await history.deleteConversations(branchIds)
  }

  const historyPanel = (
    <>
      <AiConversationHistoryPanel
        activeConversationId={history.activeConversationId}
        busy={workspaceBusy}
        conversations={historyView.visible}
        error={history.error}
        loading={history.loading}
        onDelete={deleteConversationThreads}
        onNew={() => {
          setSurface('conversation')
          onCloseContextPanel?.()
          const nextConversationId = newId()
          currentConversationIdRef.current = nextConversationId
          history.newConversation()
          updateDraft('')
          setDraftConversationId(nextConversationId)
          setCaseSelection({ conversationId: nextConversationId, reference: scopedCase })
          setCandidateSelection({
            conversationId: nextConversationId,
            documentId: businessObject?.kind === 'person' ? businessObject.id : null
          })
          void history
            .persistMessages([], null, {
              conversationId: nextConversationId,
              salesAgentState: {
                selectedJobCaseRef: scopedCase,
                selectedCandidateDocumentId: businessObject?.kind === 'person' ? businessObject.id : null,
                lastMatchRunId: null,
                lastSearchMessageId: null
              }
            })
            .catch((cause) => setError(localizedIpcError(locale, cause, t('无法保存当前会话状态。', '会話の状態を保存できませんでした。'))))
          setAttachments([])
          setImportSummary(null)
          setEditingMessage(null)
          setCopiedMessageId(null)
          setHistoryOpen(false)
        }}
        onSelect={(id) => {
          setSurface('conversation')
          onCloseContextPanel?.()
          currentConversationIdRef.current = id
          history.selectConversation(id)
          updateDraft('')
          setCandidateSelection(null)
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
        {onOpenSettings ? (
          <button aria-label={t('打开设置', '設定を開く')} onClick={onOpenSettings} type="button">
            <Icon name="settings" size={19} />
          </button>
        ) : (
          <span />
        )}
        {onOpenOperatorProfile ? (
          <button
            aria-label={t('打开操作员档案', '担当者プロフィールを開く')}
            className="agent-operator-button"
            onClick={onOpenOperatorProfile}
            title={operatorLabel}
            type="button"
          >
            {operatorLabel.trim().slice(0, 1).toLocaleUpperCase(locale) || 'S'}
          </button>
        ) : null}
      </footer>
    </>
  )
  const conversationSurface = (
    <div
      className={businessTitle ? 'hr-agent-drawer' : 'agent-conversation-surface'}
      hidden={Boolean(businessTitle) && surface !== 'conversation'}
      role={businessTitle ? 'complementary' : undefined}
      aria-label={businessTitle ? 'SES Agent' : undefined}
      onKeyDown={(event) => {
        if (!businessTitle || event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        if (historyOpen) setHistoryOpen(false)
        else setSurface('latest')
      }}
    >
      {businessTitle ? (
        <header className="hr-agent-heading">
          <div>
            <h2>SES Agent</h2>
            {businessObject ? <small>{scopedCase?.label ?? selectedCandidateLabel ?? t('当前资料的会话', 'この情報の会話')}</small> : null}
          </div>
          <button aria-expanded={historyOpen} type="button" onClick={() => setHistoryOpen(!historyOpen)}>
            {historyOpen ? t('返回对话', '会話に戻る') : t('会话管理', '会話管理')}
          </button>
          <button
            aria-label={t('返回业务工作台', '業務ワークスペースに戻る')}
            title={t('关闭 Agent', 'Agentを閉じる')}
            type="button"
            onClick={() => {
              setHistoryOpen(false)
              setSurface('latest')
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
      ) : null}
      {businessTitle ? (
        <div className="hr-agent-history" hidden={!historyOpen}>
          {historyPanel}
        </div>
      ) : null}
      <div
        className={businessTitle ? 'hr-agent-conversation' : 'agent-conversation-surface'}
        hidden={Boolean(businessTitle) && historyOpen}
      >
        {hasBusinessContext && surface === 'conversation' ? (
          <nav aria-label={t('当前任务上下文', '現在のタスクコンテキスト')} className="agent-context-bar">
            <div className="agent-context-entities">
              {selectedCase ? (
                <span>
                  <Icon name="briefcase" size={16} />
                  <small>{t('案件', '案件')}</small>
                  <strong>
                    {selectedCase.label}
                    {selectedCase.objectVersion ? ` v${selectedCase.objectVersion}` : ''}
                  </strong>
                  {businessObject?.kind !== 'case' ? (
                    <button
                      aria-label={t('清除当前案件', '現在の案件を解除')}
                      disabled={history.saving}
                      onClick={clearSelectedCase}
                      type="button"
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              ) : null}
              {selectedCandidateDocumentId ? (
                <span>
                  <Icon name="users" size={16} />
                  <small>{t('人员', '要員')}</small>
                  <strong>{selectedCandidateLabel}</strong>
                  {businessObject?.kind !== 'person' ? (
                    <button
                      aria-label={t('清除当前人员', '現在の要員を解除')}
                      disabled={history.saving}
                      onClick={clearSelectedCandidate}
                      type="button"
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              ) : (
                <small>{t('从全部人员中查找', '全要員から検索')}</small>
              )}
            </div>
            <div className="agent-context-links">
              {selectedCase && onOpenCases ? (
                <button onClick={onOpenCases} type="button">
                  {t('打开案件', '案件を開く')}
                </button>
              ) : null}
              {selectedCandidateDocumentId && onOpenCandidate ? (
                <button onClick={() => onOpenCandidate(selectedCandidateDocumentId, 'resume')} type="button">
                  {t('打开简历', '履歴書を開く')}
                </button>
              ) : null}
              {!workspaceContext.candidateDocumentId && workspaceContext.latestAccess && onOpenSystemAccess ? (
                <button onClick={() => onOpenSystemAccess(workspaceContext.latestAccess!)} type="button">
                  {t('打开结果', '結果を開く')}
                </button>
              ) : null}
            </div>
          </nav>
        ) : null}
        <div className="agent-message-scroll" hidden={surface !== 'conversation'} aria-live="polite" ref={messageScrollRef}>
          {messages.length === 0 ? (
            <AgentEmptyState
              atsImportNotice={atsImportNotice}
              cloudConnected={cloudConnected}
              selectedPerson={businessObject?.kind === 'person'}
              onImportAtsCsv={!businessObject && onImportAtsCsv ? () => void importAtsCsv() : undefined}
              onImportResume={!businessObject && onImportResume ? () => void importResumeFromCard() : undefined}
              onOpenBroadcast={businessObject ? undefined : onOpenBroadcast}
              onOpenCaseImport={businessObject ? undefined : onOpenCaseImport}
              onSuggestion={updateDraft}
              selectedCase={selectedCase}
              suggestions={emptyStateSuggestions}
              zh={zh}
            />
          ) : (
            messages.map((message) => {
              const isEditing = message.role === 'user' && editingMessage?.id === message.id
              const hasUserActions = message.role === 'user' && message.id !== 'agent-pending-message'
              const structuredErrorRepeatsContent =
                message.role === 'assistant' &&
                (message.blocks ?? []).some((block) => block.type === 'error' && block.message.trim() === message.content.trim())
              return (
                <article className={`agent-message is-${message.role}${isEditing ? ' is-editing' : ''}`} key={message.id}>
                  {message.role === 'assistant' ? (
                    <div className="agent-message-role">
                      <Icon name="sparkles" size={13} />
                      <strong>SES Agent</strong>
                      {message.modelDisplayName ? <small>{message.modelDisplayName}</small> : null}
                    </div>
                  ) : null}
                  <div className="agent-message-body">
                    {isEditing && editingMessage ? (
                      <UserMessageEditor
                        busy={mutationBusy}
                        onCancel={() => setEditingMessage(null)}
                        onChange={(value) => setEditingMessage((current) => (current?.id === message.id ? { ...current, value } : current))}
                        onSubmit={() => void resendEditedMessage()}
                        value={editingMessage.value}
                        zh={zh}
                      />
                    ) : (
                      <>
                        {structuredErrorRepeatsContent ? null : <MessageText message={message} />}
                        {message.blocks?.map((block, index) => (
                          <BlockView
                            block={block}
                            currentCaseId={selectedCase?.kind === 'job-case' ? selectedCase.objectId : null}
                            key={`${message.id}-block-${index}`}
                            locale={locale}
                            onOpenCandidate={onOpenCandidate}
                            onOpenMatching={onOpenMatching}
                            onOpenOriginalDocument={onOpenOriginalDocument ? openOriginalFile : undefined}
                            onOpenSystemAccess={onOpenSystemAccess}
                            onRunMatching={runMatchingForCase}
                            matchingBusy={mutationBusy || businessMatchingBusy}
                            jobCaseReviews={jobCaseReviews}
                            onPreviewJobCaseDeletion={onPreviewJobCaseDeletion}
                            onDeleteJobCase={onDeleteJobCase}
                            onSelectCase={selectCase}
                            zh={zh}
                          />
                        ))}
                      </>
                    )}
                  </div>
                  {hasUserActions && !isEditing ? (
                    <div aria-label={t('输入消息操作', '入力メッセージ操作')} className="agent-message-actions" role="group">
                      <time dateTime={message.createdAt}>{messageTimeFormatter.format(new Date(message.createdAt))}</time>
                      <button disabled={workspaceBusy} onClick={() => void copyUserMessage(message)} type="button">
                        <Icon name={copiedMessageId === message.id ? 'check' : 'copy'} size={12} />
                        {copiedMessageId === message.id ? t('已复制', 'コピー済み') : t('复制', 'コピー')}
                      </button>
                      <button
                        disabled={workspaceBusy}
                        onClick={() => {
                          setCopiedMessageId(null)
                          setError(null)
                          setEditingMessage({ id: message.id, value: message.content })
                        }}
                        type="button"
                      >
                        <Icon name="edit" size={12} />
                        {t('编辑并重新发送', '編集して再送信')}
                      </button>
                    </div>
                  ) : null}
                </article>
              )
            })
          )}
          {pendingMessage && streamState?.content ? (
            <article className="agent-message is-assistant is-streaming" data-testid="agent-streaming-message">
              <div className="agent-message-role">
                <Icon name="sparkles" size={13} />
                <strong>SES Agent</strong>
                {streamState.modelDisplayName ? <small>{streamState.modelDisplayName}</small> : null}
              </div>
              <div className="agent-message-body">
                <AgentMarkdown content={streamState.content} />
              </div>
            </article>
          ) : null}
          {pendingMessage ? (
            <div className="agent-running-state" data-phase={streamState?.phase ?? 'planning'}>
              <span className="agent-running-dot" />
              {streamState?.phase === 'planning'
                ? t('正在理解问题并选择 Tool…', '質問を理解して Tool を選択中…')
                : streamState?.phase === 'connecting-model'
                  ? t('正在整理 Tool 结果…', 'Tool の結果を整理中…')
                  : streamState?.phase === 'streaming'
                    ? t('正在生成回答…', '回答を生成中…')
                    : streamState?.phase === 'stopping'
                      ? t('正在停止本地读取并请求远端取消…', 'ローカル読取を停止し、リモート取消を要求中…')
                      : t('正在本机执行受控本地 Tool…', '端末内で制御済みローカル Tool を実行中…')}
            </div>
          ) : null}
          {!pendingMessage && lastTurnTimings ? (
            <details className="agent-turn-details" key={`${currentConversationId}:${messages.at(-1)?.id}`}>
              <summary>{t('运行详情', '実行の詳細')}</summary>
              <p className="agent-turn-timings" data-testid="agent-turn-timings">
                {turnTimingsText(lastTurnTimings, zh)}
              </p>
            </details>
          ) : null}
        </div>
        {error ? (
          <p className="agent-workspace-error" role="alert">
            <Icon name="alert" size={14} />
            {localizedMainText(locale, error)}
          </p>
        ) : null}
        {importSummary ? (
          <p className="agent-attachment-progress">
            {t(`已导入 ${importSummary.imported} 份`, `${importSummary.imported}件を取り込みました`)}
            {importSummary.failed > 0 ? t(`，${importSummary.failed} 份失败`, `（${importSummary.failed}件は失敗）`) : ''}
            {t('。', '。')}
          </p>
        ) : null}
        {attaching ? <p className="agent-attachment-progress">{t('正在安全暂存附件…', '添付ファイルを安全に保存しています…')}</p> : null}
        {compactComposer && !businessTitle ? (
          <div className="agent-quick-bar" role="group" aria-label={t('最新动态操作栏', '最新情報の操作')}>
            <button
              className="agent-quick-prompt"
              onClick={() => {
                setSurface('conversation')
                window.requestAnimationFrame(() => composerInputRef.current?.focus())
              }}
              type="button"
            >
              <Icon name="sparkles" size={16} />
              <span>
                {pendingMessage
                  ? t('查看正在处理的对话', '処理中の会話を表示')
                  : draft.trim() || attachments.length
                    ? t('继续未发送的草稿', '未送信の下書きを続ける')
                    : t('告诉 Agent 想处理什么…', 'Agentに依頼したいことを入力…')}
              </span>
            </button>
            {onOpenBatch ? (
              <button className="agent-quick-paste" onClick={() => onOpenBatch()} type="button">
                <Icon name="upload" size={14} />
                {t('粘贴消息', 'メッセージを貼り付け')}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className={`agent-composer-shell${surface === 'latest' ? ' is-contextual' : ''}`} hidden={compactComposer}>
          {contextualComposer ? (
            <div className="agent-composer-object" role="group" aria-label={t('当前处理对象', '現在の処理対象')}>
              <div>
                <Icon name={contextualComposer.kind === 'case' ? 'briefcase' : 'users'} size={15} />
                <span>{t('正在处理：', '処理対象：')}</span>
                <strong title={contextualComposer.label}>{contextualComposer.label}</strong>
              </div>
              <div className="agent-composer-object-actions">
                {contextualComposer.onMatch ? (
                  <button disabled={businessMatchingBusy} onClick={contextualComposer.onMatch} type="button">
                    {contextualComposer.kind === 'case' ? t('找人', '要員を探す') : t('找案件', '案件を探す')}
                  </button>
                ) : null}
                {contextualComposer.onPromote ? (
                  <button onClick={contextualComposer.onPromote} type="button">
                    {t('生成介绍', '紹介文を作成')}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {onOpenBatch && surface === 'conversation' ? (
            <button className="agent-batch-handoff" onClick={() => onOpenBatch(draft || undefined)} type="button">
              <Icon name="upload" size={13} />
              {t('粘贴多条信息？转到批量整理', '複数の情報は一括整理へ')}
            </button>
          ) : null}
          {!cloudConnected ? (
            <div className="agent-connect-bar">
              <Icon name="lock" size={14} />
              <span>
                {t(
                  '未连接 Cloud AI：当前仅支持粘贴案件/人员文本的本地导入等本地操作，自然语言问答不可用。',
                  'Cloud AI 未接続：現在は案件・要員テキストのローカル取込などのローカル操作のみ利用できます。自然言語での質問はできません。'
                )}
              </span>
              <button onClick={() => onConnectCloud?.()} type="button">
                {t('连接受管账号', '受管アカウントに接続')}
              </button>
            </div>
          ) : null}
          <form aria-label={t('SES Agent 输入区', 'SES Agent 入力欄')} className="agent-composer" onSubmit={send}>
            <input
              accept=".xls,.xlsx,.xlsb,.docx,.pdf"
              aria-label={t('选择要附加到当前任务的简历', '現在のタスクに添付する履歴書を選択')}
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
            {attachments.length > 0 ? (
              <div className="agent-attachment-tray">
                {attachments.map((file) => (
                  <span key={file.token}>
                    <span className="agent-attachment-glyph">
                      <Icon name="file" size={16} />
                    </span>
                    <span className="agent-attachment-label">
                      <strong>{file.name}</strong>
                      <small>
                        {file.previewError
                          ? t('解析失败', '解析に失敗')
                          : file.preview
                            ? `${file.format.toLocaleUpperCase('en-US')} · ${t('已解析', '解析済み')} ${file.preview.fields.filter((field) => field.status !== 'missing').length}${t(' 项', '項目')}`
                            : `${file.format.toLocaleUpperCase('en-US')} · ${t('解析中…', '解析中…')}`}
                      </small>
                    </span>
                    <button
                      aria-label={t(`移除 ${file.name}`, `${file.name} を外す`)}
                      onClick={() => setAttachments((current) => current.filter((item) => item.token !== file.token))}
                      type="button"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <textarea
              ref={composerInputRef}
              aria-label={t('输入 SES Agent 指令', 'SES Agent への指示')}
              disabled={workspaceBusy}
              onChange={(event) => updateDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                cloudConnected
                  ? contextualComposer
                    ? t('补充要求，例如：优先远程，介绍简短一些…', '条件を追加：リモート優先、紹介文は短めに…')
                    : t('继续询问当前案件、人员或面试…', '現在の案件、要員、面談について続けて質問…')
                  : t('粘贴一条案件或人员信息进行本地导入…', '案件または要員の情報を1件貼り付けてローカル取込…')
              }
              rows={2}
              value={draft}
            />
            {draft.length > 4_000 ? (
              <p className="agent-workspace-error" role="alert">
                <Icon name="alert" size={14} />
                {t(
                  `已超过 4,000 字（${draft.length}/4000）。一次只粘贴一条完整的案件或人员信息；较长案件可使用「导入案件」的专用粘贴入口。`,
                  `4,000文字を超えています（${draft.length}/4000）。1回の送信は案件または要員1件分だけにしてください。長い案件は「案件を取り込む」の専用貼り付けをご利用ください。`
                )}
              </p>
            ) : null}
            <footer>
              <div className="agent-composer-tools">
                <button
                  aria-label={t('附加简历', '履歴書を添付')}
                  className="agent-attachment-button"
                  disabled={workspaceBusy || !cloudConnected}
                  onClick={() => attachmentInputRef.current?.click()}
                  type="button"
                >
                  <Icon name="upload" size={15} />
                </button>
                {attachments.length > 0 ? (
                  <button
                    className="agent-attachment-import"
                    disabled={workspaceBusy}
                    onClick={() => void importAttachmentsDirectly()}
                    type="button"
                  >
                    {importing ? t('导入中…', '取込中…') : t('直接导入', 'そのまま取込')}
                  </button>
                ) : null}
                {cloudConnected ? (
                  <div className="agent-model-control">
                    <label htmlFor="agent-chat-model">{t('回答模型', '回答モデル')}</label>
                    <select
                      aria-label={t('选择回答模型', '回答モデルを選択')}
                      disabled={workspaceBusy}
                      id="agent-chat-model"
                      onChange={(event) => pickModel(event.target.value)}
                      value={selectedModelKey}
                    >
                      {availableModels.map((model) => (
                        <option key={model.key} value={model.key}>
                          {model.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <small>
                  {pendingMessage
                    ? t('停止是止损操作，不保证免费或退款。', '停止は損失抑制であり、無料・返金を保証しません。')
                    : draft.length >= 3_600
                      ? `${draft.length}/4000`
                      : `Enter ${t('发送 · Shift+Enter 换行', '送信 · Shift+Enter で改行')}`}
                </small>
              </div>
              {pendingMessage ? (
                <button
                  aria-label={t('停止', '停止')}
                  className="agent-stop"
                  onClick={(event) => {
                    event.preventDefault()
                    void stop()
                  }}
                  type="button"
                >
                  <Icon name="alert" size={14} />
                  {t('停止', '停止')}
                </button>
              ) : (
                <button
                  aria-label={t('发送', '送信')}
                  className="agent-send"
                  disabled={!draft.trim() || draft.trim().length > 4_000 || workspaceBusy}
                  type="submit"
                >
                  <Icon name="arrow-up" size={16} />
                </button>
              )}
            </footer>
          </form>
        </div>
      </div>
    </div>
  )

  const workspaceClassName = [
    'agent-workspace',
    businessTitle ? 'is-hr-workbench' : '',
    businessTitle && surface === 'conversation' ? 'is-chat-open' : '',
    !businessTitle && historyOpen ? 'is-history-open' : '',
    contextVisible ? 'has-context-panel' : '',
    businessTitle && (contextVisible || surface === 'conversation') ? 'has-workspace-side' : ''
  ]
    .filter(Boolean)
    .join(' ')
  const workspaceStyle = showContextPanel ? ({ '--agent-context-panel-width': `${contextPanelWidth}px` } as CSSProperties) : undefined

  return (
    <CandidateNamesContext.Provider value={candidateNames}>
      <main
        aria-label="SES Agent"
        className={workspaceClassName}
        style={workspaceStyle}
        onDragOver={(event) => {
          event.preventDefault()
          if (cloudConnected && !workspaceBusy) setDragActive(true)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDragActive(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragActive(false)
          if (!cloudConnected || workspaceBusy) return
          void attachFiles([...event.dataTransfer.files])
        }}
      >
        {!businessTitle ? (
          <aside className={historyOpen ? 'agent-workspace-history is-open' : 'agent-workspace-history'}>{historyPanel}</aside>
        ) : null}
        {!businessTitle && historyOpen ? (
          <button
            aria-label={t('关闭任务列表', 'タスク一覧を閉じる')}
            className="agent-history-backdrop"
            onClick={() => setHistoryOpen(false)}
            type="button"
          />
        ) : null}
        <section className={dragActive ? 'agent-workspace-main is-drag-active' : 'agent-workspace-main'}>
          <header className="agent-workspace-header">
            {!businessTitle ? (
              <button
                aria-label={t('打开任务列表', 'タスク一覧を開く')}
                className="agent-history-toggle"
                onClick={() => setHistoryOpen(true)}
                type="button"
              >
                <Icon name="tasks" size={16} />
              </button>
            ) : null}
            <div className="agent-thread-title">
              <h1>{businessTitle ? 'SES' : 'SES Agent'}</h1>
              <strong>
                {businessTitle
                  ? businessTitle
                  : surface === 'latest'
                    ? (businessTitle ?? t('最新动态', '最新情報'))
                    : selectedCase
                      ? selectedCandidateDocumentId
                        ? t('人员与案件评估', '要員と案件の評価')
                        : t('案件助手', '案件アシスタント')
                      : threadTitle}
              </strong>
            </div>
            <span
              className="agent-privacy-badge"
              title={t(
                'AI 理解自然语言 + 受控本地 Tool + SSE 回答；仅发送已脱敏的最小上下文，不自动改变业务状态',
                'AI が自然言語を理解 + 制御済みローカル Tool + SSE 回答。脱敏済みの最小コンテキストのみを送信し、業務状態は変更しません'
              )}
            >
              <Icon name="shield" size={13} />
              {t('仅发送脱敏内容', '脱敏済みのみ送信')}
            </span>
            {businessTitle ? (
              <button
                className="hr-ask-agent"
                aria-pressed={surface === 'conversation'}
                type="button"
                onClick={() => {
                  setSurface('conversation')
                  setHistoryOpen(false)
                }}
              >
                <Icon name="sparkles" size={14} />
                {t('问 Agent', 'Agentに質問')}
              </button>
            ) : null}
            {!latestContent && !showContextPanel && onOpenNewCaseBoard ? (
              <button className="agent-open-board" onClick={onOpenNewCaseBoard} type="button">
                <Icon name="briefcase" size={13} />
                <span>{t('今日新案件', '今日の新着案件')}</span>
                {newCaseUnseenCount > 0 ? <b>{newCaseUnseenCount}</b> : null}
              </button>
            ) : null}
          </header>
          {latestContent && !businessTitle ? (
            <nav className="agent-surface-tabs" aria-label={t('Agent 工作区', 'Agentワークスペース')}>
              <button aria-pressed={surface === 'latest'} onClick={() => setSurface('latest')} type="button">
                <Icon name="clock" size={14} />
                {t('最新动态', '最新情報')}
              </button>
              <button aria-pressed={surface === 'conversation'} onClick={() => setSurface('conversation')} type="button">
                <Icon name="sparkles" size={14} />
                {t('当前对话', '現在の会話')}
              </button>
              {onOpenBatch ? (
                <button onClick={() => onOpenBatch()} type="button">
                  <Icon name="upload" size={14} />
                  {t('批量整理', '一括整理')}
                </button>
              ) : null}
            </nav>
          ) : null}
          {latestContent ? (
            <div className="agent-latest-scroll" hidden={!businessTitle && surface !== 'latest'}>
              {latestContent}
            </div>
          ) : null}
          {!businessTitle ? conversationSurface : null}
        </section>
        {businessTitle ? conversationSurface : null}
        {contextPanel ? (
          <aside hidden={!contextVisible} aria-label={contextPanelLabel} className="agent-context-workspace">
            <div
              aria-label={t('调整右侧工作区宽度', '右ワークスペースの幅を調整')}
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
                try {
                  globalThis.localStorage?.setItem('ses-agent-context-panel-width-v1', String(next))
                } catch {
                  /* best-effort UI preference */
                }
              }}
              onPointerCancel={finishContextPanelResize}
              onPointerDown={startContextPanelResize}
              onPointerMove={resizeContextPanel}
              onPointerUp={finishContextPanelResize}
              role="separator"
              tabIndex={0}
            >
              <span />
            </div>
            {contextPanel}
          </aside>
        ) : null}
      </main>
    </CandidateNamesContext.Provider>
  )
}
