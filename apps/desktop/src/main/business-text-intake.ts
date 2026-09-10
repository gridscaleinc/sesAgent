import { createHash, randomUUID } from 'node:crypto'
import {
  brandPersistedUserContent,
  type BusinessTextIntakeKind,
  type BusinessTextRouteDecision,
  type LocalAgentUseCase
} from '@agent'
import type { ActionContext, ActionOrchestrator } from '@action-runtime'
import type { EncryptedFileVault, StagedFileRecord } from '@files'
import { agentJobCaseDraftFacts, createRedactedChatPasteJobCaseSource, extractJobCaseDraft, type JobCaseFieldOverrides } from '@job-cases'
import { collectLocalPersonNameCandidates, type LocalPersonNameDetectorPort } from '@local-ai'
import { documentIrSchema, documentIrVersion, type DocumentIR } from '@parsers'
import type { EncryptedApplicationRepository } from '@persistence'
import { applyLocalPiiMappings, redactTextForCloud } from '@privacy'
import { applyCandidateFieldOverrides, extractCandidateDraft, type CandidateFieldOverrides } from '@resume'
import type {
  AgentCandidateDraftFacts,
  AgentJobCaseDraftCard,
  AiConversationBlock,
  ApplicationLocale,
  CandidateReviewSnapshot,
  ExecuteAgentTurnInput,
  ExecuteAgentTurnResult,
  JobCaseReviewSnapshot,
  ResumeAnalysisSummary
} from '@shared'
import { candidateFieldKeys, jobCaseFieldKeys, type JobCaseFieldAliasMap } from '@shared/contracts'
import type { AgentBusinessTextExtractionResult } from './agent-cloud-narrative'
import { agentDraftFactsFromResumeAnalysis } from './resume-agent-facts'

/**
 * Business-text intake: the Main-only execution path behind the local gate.
 *
 * Everything here runs before - instead of - the cloud planner. No function in
 * this module may call the narrative streamer, and no persisted string may
 * carry the pasted text: conversation user messages accept only the branded
 * safe summary, ActionRuns receive a digest, and error messages are fixed
 * strings that never echo content.
 */

export type BusinessTextImportOutcome = 'created' | 'existing-review' | 'already-imported' | 'archived'

export interface JobCaseTextImportResult {
  review: JobCaseReviewSnapshot
  outcome: BusinessTextImportOutcome
  /**
   * valid: the case took effect on import. needs-attention: it could not
   * (no title, a direct identifier, a nationality condition) and waits in
   * the right-hand workspace for the operator to fix and save.
   */
  validity: 'valid' | 'needs-attention' | 'unknown'
  attentionReason: string | null
}

/**
 * Makes a fresh draft a job case on the spot with its extracted values. A
 * case has two states for the operator - valid or not - and edits happen
 * on the case itself, so nothing waits in a review queue. What the store
 * refuses (no title, an identifier, a nationality condition) stays a draft
 * and the reason travels back to the operator.
 */
export function autoConfirmJobCaseDraft(
  repository: Pick<EncryptedApplicationRepository, 'confirmJobCaseReview'>,
  review: JobCaseReviewSnapshot,
  operator: { operatorId: string; displayName: string },
  now = new Date()
): { review: JobCaseReviewSnapshot; reason: null } | { review: null; reason: string } {
  try {
    const confirmed = repository.confirmJobCaseReview({
      reviewId: review.reviewId,
      reviewRevision: review.reviewRevision,
      privacyReviewed: true,
      fields: review.fields.map((field) => {
        // A field consisting only of redaction tokens contains no business fact.
        // Keep the redacted source, and leave that structured field empty.
        const emptyRedaction = /^(?:\s*<[A-Z_]+_\d{3,}>\s*)+$/u.test(field.value ?? '')
        return { key: field.key, value: emptyRedaction ? null : field.value, confirmed: true,
          ...(emptyRedaction ? { changeReason: 'Remove placeholder-only field after local redaction' } : {}) }
      })
    }, operator.operatorId, operator.displayName, now)
    return { review: confirmed, reason: null }
  } catch (error) {
    return { review: null, reason: (error instanceof Error ? error.message : String(error)).slice(0, 300) }
  }
}

export interface CandidateTextImportResult {
  review: CandidateReviewSnapshot
  outcome: BusinessTextImportOutcome
  /** Extraction facts for the conversation block; present only for 'created'. */
  facts: AgentCandidateDraftFacts | null
}

export interface JobCaseTextImportDependencies {
  repository: EncryptedApplicationRepository
  localNer: LocalPersonNameDetectorPort | null
  /** When known, a new draft becomes a valid case immediately instead of waiting for review. */
  operator?: { operatorId: string; displayName: string } | null
}

/**
 * One shared import path for chat-pasted job-case text, used by the dedicated
 * paste IPC and by the agent intake gate. Exact duplicates return the existing
 * review per its lifecycle instead of stacking a second draft. Field values the
 * redacted cloud lane extracted (already verified verbatim and restored to the
 * original text) are moved into this import's own placeholder space before
 * they touch the draft, so a stored field never carries more than the local
 * redaction allows.
 */
export async function importChatPastedJobCaseText(
  deps: JobCaseTextImportDependencies,
  text: string,
  now = new Date(),
  fieldOverrides: JobCaseFieldOverrides = {},
  intakeBatchId: string | null = null,
  aliases: JobCaseFieldAliasMap = {}
): Promise<JobCaseTextImportResult> {
  let localNameDetection
  try {
    localNameDetection = await deps.localNer?.detectNames(text)
  } catch {
    localNameDetection = undefined
  }
  const knownPersonNames = collectLocalPersonNameCandidates(text, localNameDetection)
  const sourceId = randomUUID()
  const processed = createRedactedChatPasteJobCaseSource(text, sourceId, knownPersonNames, now)
  const duplicate = deps.repository.findJobCaseReviewByBusinessFingerprint(
    processed.source.redactedSubject,
    processed.source.redactedBody
  )
  if (duplicate) {
    if (duplicate.lifecycle === 'archived') return { review: duplicate, outcome: 'archived', validity: 'unknown', attentionReason: null }
    return {
      review: duplicate,
      outcome: duplicate.status === 'completed' ? 'already-imported' : 'existing-review',
      validity: duplicate.status === 'completed' ? 'valid' : 'unknown',
      attentionReason: null
    }
  }
  const localizedOverrides: JobCaseFieldOverrides = {}
  for (const key of jobCaseFieldKeys) {
    const value = fieldOverrides[key]
    if (value) localizedOverrides[key] = applyLocalPiiMappings(value, processed.redaction.mappings)
  }
  const draft = extractJobCaseDraft(processed.source, randomUUID(), now, localizedOverrides, intakeBatchId, aliases)
  if (!deps.repository.saveRedactedJobCaseSourceAndDraft(
    processed.redaction.session,
    processed.redaction.mappings,
    processed.source,
    draft
  )) {
    throw new Error('チャット貼り付け案件の草稿を作成できませんでした。')
  }
  const review = deps.repository.getJobCaseReview(draft.reviewId)
  if (!review) throw new Error('作成した案件草稿を再読み込みできませんでした。')
  if (!deps.operator) return { review, outcome: 'created', validity: 'unknown', attentionReason: null }
  const confirmed = autoConfirmJobCaseDraft(deps.repository, review, deps.operator, now)
  return confirmed.review
    ? { review: confirmed.review, outcome: 'created', validity: 'valid', attentionReason: null }
    : { review, outcome: 'created', validity: 'needs-attention', attentionReason: confirmed.reason }
}

export interface CandidateTextImportDependencies {
  repository: EncryptedApplicationRepository
  fileVault: EncryptedFileVault
  localNer: LocalPersonNameDetectorPort | null
}

function documentIrFromTrustedText(record: StagedFileRecord, text: string): DocumentIR {
  const blocks = text
    .split('\n')
    .map((line, index) => ({
      id: `L${index + 1}`,
      kind: 'text' as const,
      // Chat labels are often padded for alignment - 氏　名：. Collapsing the
      // spaces inside the label lets the existing extractor patterns match.
      text: line.replace(/^([^:：\n]{1,12})([:：])/u, (_match, label: string, colon: string) =>
        `${label.replace(/[\s　]+/gu, '')}${colon}`).trim(),
      source: { paragraph: index + 1 }
    }))
    .filter((block) => block.text.length > 0)
  return documentIrSchema.parse({
    version: documentIrVersion,
    documentId: record.token,
    source: { name: record.name, format: 'txt', sha256: record.sha256, size: record.size },
    blocks,
    warnings: [],
    requiresLocalOcr: false,
    statistics: { pages: 0, sheets: 0, blocks: blocks.length, characters: text.length },
    security: { externalContentLoaded: false, macrosExecuted: false, rawFileCloudEligible: false }
  })
}

/**
 * Pasted person text joins the existing candidate chain: encrypted vault
 * staging, line-based DocumentIR, the existing extractor, and the existing
 * Candidate Review. Exact duplicates (SHA-256 of the normalized text) return
 * the existing review; a failed previous run leaves no orphan staging behind.
 */
export async function importPastedCandidateText(
  deps: CandidateTextImportDependencies,
  text: string,
  now = new Date(),
  fieldOverrides: CandidateFieldOverrides = {}
): Promise<CandidateTextImportResult> {
  const normalized = text.replace(/\r\n/gu, '\n').trim()
  const sha256 = createHash('sha256').update(Buffer.from(normalized, 'utf8')).digest('hex')
  const existing = deps.repository.findStagedTextSourceBySha256(sha256)
  if (existing) {
    const review = deps.repository.getCandidateReview(existing.token)
    if (review && review.recordStatus === 'archived') {
      return { review, outcome: 'archived', facts: null }
    }
    if (review && review.recordStatus === 'active') {
      return {
        review,
        outcome: review.status === 'completed' ? 'already-imported' : 'existing-review',
        facts: null
      }
    }
    if (!review) {
      // A failed earlier run left staging without a review: clean the residue
      // and run again. A 'deleted' record is never resurrected - the explicit
      // re-submission below imports as new under a fresh token.
      deps.repository.removeStagedFiles([existing.token])
      try {
        await deps.fileVault.discardStagedFile(existing)
      } catch {
        // The encrypted file may already be gone; the row removal is what matters.
      }
    }
  }

  const record = await deps.fileVault.stageTrustedText(`agent-paste-${sha256.slice(0, 8)}.txt`, normalized, now)
  try {
    deps.repository.saveStagedFiles([record])
    const document = documentIrFromTrustedText(record, normalized)
    let localNameDetection
    try {
      localNameDetection = await deps.localNer?.detectNames(normalized)
    } catch {
      localNameDetection = undefined
    }
    const knownPersonNames = collectLocalPersonNameCandidates(normalized, localNameDetection)
    const redaction = redactTextForCloud(normalized, {
      sourceVersion: record.sha256,
      policyVersion: 'cloud-redaction-v2',
      knownPersonNames
    })
    const identifierCounts = new Map<string, number>()
    for (const mapping of redaction.mappings) {
      identifierCounts.set(mapping.identifierType, (identifierCounts.get(mapping.identifierType) ?? 0) + 1)
    }
    const analyzedAt = now.toISOString()
    const extraction = applyCandidateFieldOverrides(extractCandidateDraft(document, now), document, fieldOverrides)
    const preview = redaction.redactedContent.length > 4_000
      ? `${redaction.redactedContent.slice(0, 3_999)}…`
      : redaction.redactedContent
    const summary: ResumeAnalysisSummary = {
      analysisVersion: 'resume-analysis-v6',
      fileToken: record.token,
      fileName: record.name,
      status: 'requires-pii-review',
      cloudEligible: false,
      statistics: document.statistics,
      detectedIdentifiers: [...identifierCounts.entries()]
        .map(([type, count]) => ({ type, count }))
        .toSorted((a, b) => a.type.localeCompare(b.type)),
      localProcessing: {
        ocr: 'not-required',
        ocrPages: 0,
        personNameCandidates: knownPersonNames.length,
        networkAccess: false
      },
      extractedFields: extraction.fields.map((field) => ({
        key: field.key,
        label: field.label,
        value: field.value,
        confidence: field.confidence,
        status: field.status,
        sourceLabels: [...new Set(field.sources.map((source) => source.sourceLabel))]
      })),
      extractedProjectExperiences: extraction.projectExperiences.map((project) => ({
        draftId: project.draftId,
        title: project.title,
        period: project.period,
        role: project.role,
        technologies: project.technologies,
        summary: project.summary,
        confidence: project.confidence,
        sourceLabels: [...new Set(project.sources.map((source) => source.sourceLabel))]
      })),
      warningCodes: [
        ...new Set([
          'BUSINESS_TEXT_INTAKE_SOURCE',
          ...(knownPersonNames.length > 0 ? ['PERSON_NAME_REVIEW_REQUIRED'] : [])
        ])
      ],
      redactedPreview: preview,
      analyzedAt
    }
    deps.repository.saveRedactionSession(redaction.session, redaction.mappings)
    deps.repository.saveParsedDocument(document, summary, redaction.session.id, extraction)
    const review = deps.repository.getCandidateReview(record.token)
    if (!review) throw new Error('作成した人材レビューを再読み込みできませんでした。')
    const facts = agentDraftFactsFromResumeAnalysis(summary, `TEXT_${sha256.slice(0, 4).toUpperCase()}`)
    return { review, outcome: 'created', facts }
  } catch (cause) {
    // No orphans: the staged row and the encrypted file go together.
    try {
      deps.repository.removeStagedFiles([record.token])
    } catch {
      // Removal best-effort; the retry path cleans residue again.
    }
    try {
      await deps.fileVault.discardStagedFile(record)
    } catch {
      // Same: never mask the original failure with cleanup noise.
    }
    throw cause
  }
}

/** Per-turn plumbing the cloud lane needs from the running agent turn. */
export interface BusinessTextCloudLaneHooks {
  signal: AbortSignal
  onClientRequestId(clientRequestId: string): void
  onRemoteSettled(): void
}

export interface BusinessTextIntakeTurnHooks extends BusinessTextCloudLaneHooks {
  /** Lets the turn UI switch from the local phase to the cloud phase. */
  onCloudLaneStarted(): void
}

export interface BusinessTextIntakeTurnDependencies {
  repository: EncryptedApplicationRepository
  actionOrchestrator: ActionOrchestrator
  locale(): ApplicationLocale
  operatorId(): string
  importJobCaseText(text: string, fieldOverrides?: JobCaseFieldOverrides, intakeBatchId?: string | null): Promise<JobCaseTextImportResult>
  importCandidateText(text: string, fieldOverrides?: CandidateFieldOverrides): Promise<CandidateTextImportResult>
  registerConversationImport?(conversationId: string, sourceDocumentId: string): void
  /**
   * Redacted cloud extraction for every intake route. The implementation must
   * send the model a DLP-redacted projection only and return record kinds,
   * line ranges, and verbatim-verified field values with the placeholders
   * restored; every failure mode (DLP block, cloud error, protocol violation)
   * throws, and the caller falls back to the local path. Absent or null = the
   * cloud-assist lane is switched off.
   */
  extractRecordsViaCloud?: ((text: string, hooks: BusinessTextCloudLaneHooks) => Promise<AgentBusinessTextExtractionResult>) | null
}

const intakeToolName = 'business-text.import.local' as const

/**
 * Intake ActionRuns start unbound. The store binds a run to exactly one
 * (conversation, turn) pair and refuses to complete a run that was created
 * with a conversation but no turn - and the turn id only exists once
 * saveIntakeTurn has persisted the turn. So: create unbound, persist the turn,
 * then bind every run of that turn in saveLinkedIntakeTurn.
 */
function intakeActionContext(deps: BusinessTextIntakeTurnDependencies, digest: string): ActionContext {
  return {
    origin: 'user-command',
    workTaskId: null,
    scopeId: 'current-agent-message',
    scopeFingerprint: digest,
    actorId: deps.operatorId(),
    conversationId: null,
    turnId: null
  }
}

/**
 * Per-turn idempotency, like every other agent tool: a run belongs to one turn,
 * so re-pasting the same text in the same conversation - the retry the failure
 * message asks for - gets a fresh run instead of colliding with the run already
 * bound to the earlier turn. Duplicate content is still caught by the
 * importers' own fingerprint / SHA-256 checks.
 */
function intakeIdempotencyKey(input: ExecuteAgentTurnInput, digest: string): string {
  return createHash('sha256')
    .update(`${intakeToolName}:${input.conversationId}:${input.requestId}:${digest}`)
    .digest('hex')
}

/**
 * Persists the intake turn, then binds every ActionRun of this turn to it.
 * `cards` are the job-case drafts this turn produced; they become the
 * conversation's intake batch pointer so later turns can resolve "第2条".
 */
function saveLinkedIntakeTurn(
  deps: BusinessTextIntakeTurnDependencies,
  useCase: LocalAgentUseCase,
  input: ExecuteAgentTurnInput,
  summary: Parameters<LocalAgentUseCase['saveIntakeTurn']>[1],
  assistant: { content: string; blocks: AiConversationBlock[] },
  outcome: 'completed' | 'failed',
  actionRunIds: readonly string[],
  batch: { intakeBatchId: string; cards: AgentJobCaseDraftCard[] } | null = null
): ReturnType<LocalAgentUseCase['saveIntakeTurn']> {
  const saved = useCase.saveIntakeTurn(
    input, summary, assistant, outcome,
    batch && batch.cards.length > 0 ? { intakeBatchId: batch.intakeBatchId, reviewIds: batch.cards.map((card) => card.reviewId) } : null
  )
  const turnId = saved.assistantMessage.turnId
  if (!turnId) throw new Error('業務テキスト取込の ActionRun を関連付ける turn_id を確認できません。')
  for (const actionRunId of new Set(actionRunIds)) {
    deps.repository.linkActionRunToConversation(actionRunId, input.conversationId, turnId)
  }
  return saved
}

/**
 * Failure diagnostics stay out of the conversation and stay PII-free: the
 * importers throw fixed messages, and storage / schema errors name tables and
 * fields, never the pasted text. Without this line a failed segment left no
 * trace beyond its error code.
 */
function reportImportFailure(kind: BusinessTextIntakeKind, actionRunId: string, errorCode: string, error: unknown): void {
  console.warn('[business-text-intake-import-failed]', {
    kind,
    actionRunId,
    errorCode,
    reason: (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 300)
  })
}

function contentDigest(text: string): string {
  return createHash('sha256').update(Buffer.from(text.replace(/\r\n/gu, '\n').trim(), 'utf8')).digest('hex')
}

/**
 * The conversation-side view of the job-case drafts one paste produced: one
 * card per imported record in paste order, built from the persisted review so
 * the card carries exactly what the Review Center will show - de-identified
 * field values, review state, and the confirmed case once there is one.
 */
function jobCaseDraftCards(
  deps: BusinessTextIntakeTurnDependencies,
  results: ReadonlyArray<{ reviewId: string; outcome: BusinessTextImportOutcome }>
): AgentJobCaseDraftCard[] {
  const cards: AgentJobCaseDraftCard[] = []
  for (const result of results.slice(0, 10)) {
    const review = deps.repository.getJobCaseReview(result.reviewId)
    if (!review) continue
    const ordinal = cards.length + 1
    cards.push({ ...agentJobCaseDraftFacts(review, `DRAFT_${ordinal}`), ordinal, outcome: result.outcome })
  }
  return cards
}

/** The blocks that let the operator continue from the cards: review, batch-confirm, match. */
function jobCaseDraftBlocks(intakeBatchId: string, cards: AgentJobCaseDraftCard[]): AiConversationBlock[] {
  if (cards.length === 0) return []
  return [
    { type: 'job-case-draft-cards', intakeBatchId, cards },
    { type: 'system-access', destination: 'review-center', intakeBatchId, reviewIds: cards.map((card) => card.reviewId) }
  ]
}

type IntakeSummaryKind = BusinessTextIntakeKind | 'ambiguous' | 'multiple'

function intakeUserSummary(zh: boolean, kind: IntakeSummaryKind, digestTag: string) {
  const zhLabel = kind === 'job-case'
    ? '案件文本' : kind === 'candidate' ? '人员文本' : kind === 'multiple' ? '业务文本（多条记录）' : '业务文本（类型待确认）'
  const jaLabel = kind === 'job-case'
    ? '案件テキスト' : kind === 'candidate' ? '要員テキスト' : kind === 'multiple' ? '業務テキスト（複数レコード）' : '業務テキスト（種別未確定）'
  return brandPersistedUserContent(zh
    ? `【已提交${zhLabel}】内容摘要 ${digestTag}，原文未写入会话。`
    : `【${jaLabel}を送信】内容ダイジェスト ${digestTag}。原文は会話に保存されません。`)
}

function guidanceText(zh: boolean, decision: BusinessTextRouteDecision): string {
  if (decision.route === 'multiple') {
    return zh
      ? '检测到多条业务记录（多个案件、多名人员，或案件与人员混合）。一次只能导入一条，请拆分后逐条发送。本次未创建任何草稿，原文未写入会话，已回填到输入框。'
      : '複数の業務レコード（複数案件・複数要員、または案件と要員の混在）を検出しました。1回の送信で取り込めるのは1件だけです。分割して1件ずつ送信してください。今回は草稿を作成しておらず、原文は会話に保存されません（入力欄に戻しています）。'
  }
  if (decision.reason === 'tag-structure-conflict') {
    const declaredZh = decision.declaredKind === 'job-case' ? '案件' : '人员'
    const declaredJa = decision.declaredKind === 'job-case' ? '案件' : '要員'
    return zh
      ? `首行标注为【${declaredZh}】，但文本命中另一类的决定性结构。为避免写错库，本次未创建草稿，原文未写入会话，已回填到输入框。请确认类型后重新发送。`
      : `先頭行の【${declaredJa}】タグと本文の構造が一致しません。誤登録を防ぐため草稿は作成せず、原文は会話に保存されません（入力欄に戻しています）。種別を確認して再送信してください。`
  }
  if (decision.reason === 'insufficient-structure-for-declared-kind') {
    return zh
      ? '已看到类型标注，但文本缺少可解析的记录结构（至少需要两行「标签：值」）。本次未创建草稿，原文未写入会话，已回填到输入框。请补充结构化字段后重新发送。'
      : '種別タグは確認しましたが、解析可能なレコード構造（「ラベル：値」形式の行が2行以上）が不足しています。草稿は作成せず、原文は会話に保存されません（入力欄に戻しています）。構造化した項目を追加して再送信してください。'
  }
  return zh
    ? '这段内容看起来像一条业务记录，但无法确定是案件还是人员。为保护其中的敏感信息，本回合未调用云端，也未保存原文（已回填到输入框）。请在首行加上【案件】或【人员】后整段重新发送。'
    : 'この内容は業務レコードのようですが、案件か要員かを判定できませんでした。機微情報保護のため、このターンではクラウドを呼び出さず、原文も保存していません（入力欄に戻しています）。先頭行に【案件】または【要員】を付けて全文を再送信してください。'
}

/**
 * Which extractor produced the draft's fields: the label-based local parser,
 * or the redacted cloud lane whose values were verified verbatim locally.
 */
type FieldExtractionMode = 'local' | 'cloud-fields'

function jobCaseOutcomeText(
  zh: boolean,
  outcome: BusinessTextImportOutcome,
  extraction: FieldExtractionMode = 'local',
  validity: JobCaseTextImportResult['validity'] = 'unknown',
  attentionReason: string | null = null
): string {
  switch (outcome) {
    case 'created': {
      const extracted = extraction === 'cloud-fields'
        ? (zh
            ? '字段由云端模型从脱敏投影中抽取，并经本机逐项核验（值必须原样出现在原文中），原文未离开本机。'
            : '項目は匿名化投影からクラウドモデルが抽出し、端末内で原文との逐語一致を検証しています。原文は端末外に出ていません。')
        : (zh ? '字段解析仅在本机完成，未调用云端。' : '項目抽出は端末内で完結し、クラウドは呼び出していません。')
      if (validity === 'needs-attention') {
        return zh
          ? `已从粘贴文本导入一条案件，但尚未生效：${attentionReason ?? '案件内容不完整'}。${extracted}请在右侧案件详情补充后保存，保存即生效。`
          : `貼り付けテキストから案件を1件取り込みましたが、まだ有効ではありません：${attentionReason ?? '案件内容が不十分です'}。${extracted}右側の案件詳細で補完して保存すると有効になります。`
      }
      if (validity === 'valid') {
        return zh
          ? `已从粘贴文本导入一条案件并生效。${extracted}可在右侧案件详情直接修改字段。`
          : `貼り付けテキストから案件を1件取り込み、有効にしました。${extracted}右側の案件詳細で項目を直接編集できます。`
      }
      return zh
        ? `已从粘贴文本生成一条案件草稿。${extracted}请到审核中心确认后正式入库。`
        : `貼り付けテキストから案件草稿を1件作成しました。${extracted}レビューセンターで確認のうえ確定してください。`
    }
    case 'existing-review':
      return zh
        ? '相同内容此前已提交，已打开现有的案件待审核草稿，未重复创建。'
        : '同じ内容は提出済みです。既存の案件レビュー草稿を開きました。重複作成はしていません。'
    case 'already-imported':
      return zh
        ? '相同内容已完成导入并确认为正式案件，本次未重复创建。'
        : '同じ内容は取込・確定済みの案件です。今回は再作成していません。'
    case 'archived':
      return zh
        ? '相同内容对应的案件记录已归档。如需恢复请在案件页面手动处理；本次未创建新草稿。'
        : '同じ内容の案件レコードはアーカイブ済みです。復元は案件ページから手動で行ってください。新しい草稿は作成していません。'
  }
}

function candidateOutcomeText(zh: boolean, outcome: BusinessTextImportOutcome, extraction: FieldExtractionMode = 'local'): string {
  switch (outcome) {
    case 'created':
      if (extraction === 'cloud-fields') {
        return zh
          ? '已从粘贴文本生成一条人员待审核草稿。字段由云端模型从脱敏投影中抽取，并经本机逐项核验（值必须原样出现在原文中）；原文已加密保存为内部来源，未离开本机。请到审核中心确认后生成候选人档案。'
          : '貼り付けテキストから要員レビュー草稿を1件作成しました。項目は匿名化投影からクラウドモデルが抽出し、端末内で原文との逐語一致を検証しています。原文は内部ソースとして暗号化保存し、端末外に出ていません。レビューセンターで確認して候補者プロファイルを作成してください。'
      }
      return zh
        ? '已从粘贴文本生成一条人员待审核草稿。解析在本机完成，原文已加密保存为内部来源。请到审核中心确认后生成候选人档案。'
        : '貼り付けテキストから要員レビュー草稿を1件作成しました。解析は端末内で完結し、原文は内部ソースとして暗号化保存しています。レビューセンターで確認して候補者プロファイルを作成してください。'
    case 'existing-review':
      return zh
        ? '相同内容此前已提交，已打开现有的人员待审核草稿，未重复创建。'
        : '同じ内容は提出済みです。既存の要員レビュー草稿を開きました。重複作成はしていません。'
    case 'already-imported':
      return zh
        ? '相同内容已确认为候选人档案，本次未重复创建。'
        : '同じ内容は候補者プロファイルとして確定済みです。今回は再作成していません。'
    case 'archived':
      return zh
        ? '相同内容对应的候选人记录已归档，本次未创建新草稿。'
        : '同じ内容の候補者レコードはアーカイブ済みです。新しい草稿は作成していません。'
  }
}

function importFailureText(zh: boolean, errorCode: string): string {
  return zh
    ? `本地处理失败，未保存任何草稿，原文未写入会话（已回填到输入框）。请稍后重试。错误码：${errorCode}`
    : `ローカル処理に失敗しました。草稿は保存されず、原文も会話に保存されません（入力欄に戻しています）。時間をおいて再試行してください。エラーコード：${errorCode}`
}

function nextImportOrdinal(deps: BusinessTextIntakeTurnDependencies, conversationId: string): number {
  const messages = deps.repository.getAiConversation(conversationId)?.messages ?? []
  const persisted = messages
    .flatMap((message) => message.blocks ?? [])
    .filter((block) => block.type === 'resume-import')
    .flatMap((block) => (block.type === 'resume-import' ? block.imported : []))
  return persisted.reduce((maximum, item) => Math.max(maximum, item.ordinal), 0) + 1
}

interface SegmentImportOutcome {
  kind: BusinessTextIntakeKind
  status: 'succeeded' | 'failed' | 'blocked'
  actionRunId: string
  outcome: BusinessTextImportOutcome | null
  jobCaseReviewId: string | null
  candidate: CandidateTextImportResult | null
  validity?: JobCaseTextImportResult['validity']
  attentionReason?: string | null
  startLine?: number
  endLine?: number
}

/** Narrows the lane's loosely typed field map to one importer's known keys. */
function pickOverrides<Key extends string>(
  fields: Record<string, string>,
  keys: readonly Key[]
): Partial<Record<Key, string>> {
  const picked: Partial<Record<Key, string>> = {}
  for (const key of keys) {
    const value = fields[key]
    if (value) picked[key] = value
  }
  return picked
}

/**
 * Imports one cloud-segmented record under its own ActionRun, handing the
 * lane's verified field values to the local importer. Errors stay inside the
 * outcome - a failed segment never aborts its siblings and never carries text
 * into a message.
 */
async function importOneSegment(
  deps: BusinessTextIntakeTurnDependencies,
  input: ExecuteAgentTurnInput,
  kind: BusinessTextIntakeKind,
  segmentText: string,
  fields: Record<string, string>,
  intakeBatchId: string
): Promise<SegmentImportOutcome> {
  const digest = contentDigest(segmentText)
  const preflight = deps.actionOrchestrator.preflight(
    intakeToolName,
    intakeActionContext(deps, digest),
    { contentDigest: digest, kind },
    '貼り付けられた業務テキストを端末内で解析し、レビュー草稿を1件作成します。',
    intakeIdempotencyKey(input, digest)
  )
  if (preflight.decision.outcome !== 'allow') {
    return { kind, status: 'blocked', actionRunId: preflight.actionRunId, outcome: null, jobCaseReviewId: null, candidate: null }
  }
  deps.repository.updateActionRun(preflight.actionRunId, 'running')
  try {
    if (kind === 'job-case') {
      const imported = await deps.importJobCaseText(segmentText, pickOverrides(fields, jobCaseFieldKeys), intakeBatchId)
      deps.repository.updateActionRun(preflight.actionRunId, 'succeeded', {
        resultHash: createHash('sha256').update(`${imported.outcome}:${imported.review.reviewId}`).digest('hex')
      })
      return {
        kind, status: 'succeeded', actionRunId: preflight.actionRunId,
        outcome: imported.outcome, jobCaseReviewId: imported.review.reviewId, candidate: null,
        validity: imported.validity, attentionReason: imported.attentionReason
      }
    }
    const imported = await deps.importCandidateText(segmentText, pickOverrides(fields, candidateFieldKeys))
    deps.repository.updateActionRun(preflight.actionRunId, 'succeeded', {
      resultHash: createHash('sha256').update(`${imported.outcome}:${imported.review.documentId}`).digest('hex')
    })
    return {
      kind, status: 'succeeded', actionRunId: preflight.actionRunId,
      outcome: imported.outcome, jobCaseReviewId: null, candidate: imported
    }
  } catch (error) {
    const errorCode = kind === 'job-case' ? 'BUSINESS_TEXT_JOB_CASE_IMPORT_FAILED' : 'BUSINESS_TEXT_CANDIDATE_IMPORT_FAILED'
    reportImportFailure(kind, preflight.actionRunId, errorCode, error)
    deps.repository.updateActionRun(preflight.actionRunId, 'failed', { errorCode })
    return { kind, status: 'failed', actionRunId: preflight.actionRunId, outcome: null, jobCaseReviewId: null, candidate: null }
  }
}

function cloudAssistedBatchText(
  zh: boolean,
  outcomes: SegmentImportOutcome[]
): string {
  const caseCount = outcomes.filter((item) => item.kind === 'job-case').length
  const candidateCount = outcomes.length - caseCount
  const created = outcomes.filter((item) => item.outcome === 'created').length
  const duplicate = outcomes.filter((item) => item.outcome !== null && item.outcome !== 'created').length
  const failed = outcomes.filter((item) => item.status !== 'succeeded').length
  const valid = outcomes.filter((item) => item.outcome === 'created' && item.validity === 'valid').length
  const attention = outcomes.filter((item) => item.outcome === 'created' && item.validity === 'needs-attention').length
  const createdText = zh
    ? `新建 ${created} 条${valid > 0 || attention > 0 ? `（生效 ${valid} 条${attention > 0 ? `，待补充 ${attention} 条` : ''}）` : ''}`
    : `${created}件を新規作成${valid > 0 || attention > 0 ? `（有効${valid}件${attention > 0 ? `・要補完${attention}件` : ''}）` : ''}`
  if (zh) {
    return `已通过脱敏云端分段识别出 ${outcomes.length} 条业务记录（案件 ${caseCount} 条、人员 ${candidateCount} 条）：${createdText}` +
      `${duplicate > 0 ? `，返回已有记录 ${duplicate} 条` : ''}${failed > 0 ? `，失败 ${failed} 条` : ''}。` +
      '字段由云端模型从脱敏行投影中抽取，并经本机逐条核验（值必须原样出现在原文中），原文未离开本机。' +
      (attention > 0 ? '可在右侧案件详情直接修改；待补充的案件保存后即生效。' : '可在右侧案件详情直接修改。')
  }
  return `匿名化した行投影のクラウド分割により、業務レコードを${outcomes.length}件（案件${caseCount}件・要員${candidateCount}件）識別しました。${createdText}` +
    `${duplicate > 0 ? `、既存レコードを${duplicate}件再利用` : ''}${failed > 0 ? `、${failed}件は失敗` : ''}。` +
    '項目は匿名化投影からクラウドモデルが抽出し、端末内で原文との逐語一致を検証しています。原文は端末外に出ていません。右側の案件詳細で項目を直接編集できます。要補完の案件は保存すると有効になります。'
}

/**
 * The cloud-assist lane: redacted segmentation plus verbatim-verified field
 * values, then the same local imports. Returns null whenever the lane cannot
 * finish cleanly - switched off, DLP blocked, cloud failed, protocol violated,
 * cancelled, type disagreement on a decisive route, or nothing importable -
 * and the caller falls back to the local path.
 */
async function tryCloudAssistedIntake(
  deps: BusinessTextIntakeTurnDependencies,
  useCase: LocalAgentUseCase,
  input: ExecuteAgentTurnInput,
  decision: BusinessTextRouteDecision,
  digestTag: string,
  zh: boolean,
  turn: BusinessTextIntakeTurnHooks | undefined,
  intakeBatchId: string,
  diagnostics: { laneFailure: string | null }
): Promise<ExecuteAgentTurnResult | null> {
  if (!deps.extractRecordsViaCloud) {
    diagnostics.laneFailure = 'CLOUD_ASSIST_LANE_OFF'
    return null
  }
  const hooks: BusinessTextCloudLaneHooks = {
    signal: turn?.signal ?? new AbortController().signal,
    onClientRequestId: turn?.onClientRequestId ?? (() => undefined),
    onRemoteSettled: turn?.onRemoteSettled ?? (() => undefined)
  }
  turn?.onCloudLaneStarted()
  let extraction: AgentBusinessTextExtractionResult
  try {
    extraction = await deps.extractRecordsViaCloud(decision.businessText, hooks)
  } catch (error) {
    // Why the lane fell back - DLP block, cloud error, protocol violation.
    // Protocol and gateway messages are fixed strings; the pasted text is
    // never part of them.
    const reason = (error instanceof Error ? error.message : String(error)).slice(0, 200)
    console.warn('[business-text-cloud-lane-failed]', { route: decision.route, reason })
    diagnostics.laneFailure = reason
    return null
  }
  if (extraction.kind !== 'records') {
    console.warn('[business-text-cloud-lane-unusable]', { route: decision.route })
    diagnostics.laneFailure = 'MODEL_FOUND_NO_RECORDS'
    return null
  }
  if (hooks.signal.aborted) return null
  // The local classifier stays the final judge of the business type: a
  // decisive local route accepts cloud records of that same kind only, and
  // otherwise falls back to the local importer exactly as before the lane.
  const decisiveKind = decision.route === 'job-case' || decision.route === 'candidate' ? decision.route : null
  if (decisiveKind && extraction.records.some((record) => record.kind !== decisiveKind)) return null

  const lines = decision.businessText.replace(/\r\n/gu, '\n').split('\n')
  const outcomes: SegmentImportOutcome[] = []
  for (const record of extraction.records) {
    const segmentText = lines.slice(record.startLine - 1, record.endLine).join('\n').trim()
    if (!segmentText) continue
    const outcome = await importOneSegment(deps, input, record.kind, segmentText, record.fields, intakeBatchId)
    outcome.startLine = record.startLine
    outcome.endLine = record.endLine
    outcomes.push(outcome)
    if (outcome.candidate?.outcome === 'created' && outcome.candidate.facts) {
      deps.registerConversationImport?.(input.conversationId, outcome.candidate.review.documentId)
    }
  }
  if (outcomes.length === 0) return null

  const succeeded = outcomes.filter((item) => item.status === 'succeeded')
  const anySuccess = succeeded.length > 0
  const cards = jobCaseDraftCards(deps, succeeded.flatMap((item) =>
    item.kind === 'job-case' && item.jobCaseReviewId && item.outcome ? [{ reviewId: item.jobCaseReviewId, outcome: item.outcome }] : []))
  const blocks: AiConversationBlock[] = []
  let content: string
  if (outcomes.length === 1 && succeeded.length === 1) {
    const only = succeeded[0]!
    // A decisive route owes its type to the local rules; only an undecidable
    // route was typed by the cloud lane.
    const prefix = decisiveKind
      ? ''
      : zh
        ? `已通过脱敏云端判定为${only.kind === 'job-case' ? '案件' : '人员'}。`
        : `匿名化投影のクラウド判定により${only.kind === 'job-case' ? '案件' : '要員'}として取り込みました。`
    content = `${prefix}${only.kind === 'job-case'
      ? jobCaseOutcomeText(zh, only.outcome!, 'cloud-fields', only.validity, only.attentionReason ?? null)
      : candidateOutcomeText(zh, only.outcome!, 'cloud-fields')}`
    if (only.jobCaseReviewId) {
      blocks.push({ type: 'system-access', destination: 'case-review', reviewId: only.jobCaseReviewId })
      blocks.push(...jobCaseDraftBlocks(intakeBatchId, cards))
    } else if (only.candidate?.outcome === 'created' && only.candidate.facts) {
      blocks.push({ type: 'candidate-draft-facts', facts: only.candidate.facts })
      blocks.push({ type: 'system-access', destination: 'review-center' })
    } else {
      blocks.push({ type: 'system-access', destination: 'review-center' })
    }
  } else {
    content = anySuccess
      ? cloudAssistedBatchText(zh, outcomes)
      : importFailureText(zh, 'BUSINESS_TEXT_BATCH_IMPORT_FAILED')
    if (cards.length > 0) blocks.push(...jobCaseDraftBlocks(intakeBatchId, cards))
    else blocks.push({ type: 'system-access', destination: 'review-center' })
  }

  const summaryKind: IntakeSummaryKind = outcomes.length === 1 ? outcomes[0]!.kind : 'multiple'
  const saved = saveLinkedIntakeTurn(
    deps,
    useCase,
    input,
    intakeUserSummary(zh, summaryKind, digestTag),
    { content, blocks },
    anySuccess ? 'completed' : 'failed',
    outcomes.map((item) => item.actionRunId),
    { intakeBatchId, cards }
  )
  return {
    ...saved,
    toolName: intakeToolName,
    actionRunId: succeeded[0]?.actionRunId ?? outcomes[0]!.actionRunId,
    intake: {
      route: decisiveKind ?? (decision.route === 'multiple' ? 'multiple' : 'ambiguous-sensitive'),
      reason: 'cloud-assisted-extraction',
      records: outcomes.map((item) => ({ kind: item.kind, status: item.status, outcome: item.outcome, reviewId: item.jobCaseReviewId, sourceDocumentId: item.candidate?.review.documentId ?? null, startLine: item.startLine, endLine: item.endLine })),
      restoreComposerText: !anySuccess
    }
  }
}

/**
 * Executes one intake turn end to end. This function owns every error path:
 * nothing may escape to the planner flow, whose failure handlers persist the
 * raw user message. Only protocol errors (revision conflicts and other
 * AgentExecutionError preconditions raised before anything is written) may
 * propagate to the caller as rejections.
 */
export async function executeBusinessTextIntakeTurn(
  deps: BusinessTextIntakeTurnDependencies,
  useCase: LocalAgentUseCase,
  input: ExecuteAgentTurnInput,
  decision: BusinessTextRouteDecision,
  turn?: BusinessTextIntakeTurnHooks
): Promise<ExecuteAgentTurnResult> {
  const zh = deps.locale() === 'zh-CN'
  const digest = contentDigest(decision.businessText)
  const digestTag = digest.slice(0, 8)
  // Groups every job-case draft this paste produces, on the drafts and in the
  // conversation, so the Review Center can show exactly this paste.
  const intakeBatchId = randomUUID()

  // Every intake route tries the redacted cloud lane first - segmentation plus
  // verbatim-verified field values. When the lane is off, fails, or disagrees
  // with a decisive local type, decisive routes fall back to the label-based
  // local importer and undecidable routes fall back to asking the operator,
  // exactly as before the lane existed.
  const diagnostics = { laneFailure: null as string | null }
  const cloudAssisted = await tryCloudAssistedIntake(deps, useCase, input, decision, digestTag, zh, turn, intakeBatchId, diagnostics)
  if (cloudAssisted) return cloudAssisted

  if (decision.route === 'ambiguous-sensitive' || decision.route === 'multiple') {
    // The guidance says what to do; the lane's failure reason says why the
    // operator is seeing guidance instead of drafts. Reasons are fixed
    // protocol / gateway strings - never the pasted text.
    const laneNote = diagnostics.laneFailure
      ? (zh
          ? `\n\n云端分段车道本次未完成：${diagnostics.laneFailure}`
          : `\n\nクラウド分割レーンは今回完了しませんでした：${diagnostics.laneFailure}`)
      : ''
    const saved = useCase.saveIntakeTurn(
      input,
      intakeUserSummary(zh, decision.route === 'multiple' ? 'multiple' : 'ambiguous', digestTag),
      { content: `${guidanceText(zh, decision)}${laneNote}`, blocks: [] }
    )
    return {
      ...saved,
      intake: { route: decision.route, reason: decision.reason, restoreComposerText: true }
    }
  }

  if (decision.route !== 'job-case' && decision.route !== 'candidate') {
    throw new Error(`Business-text intake received an unroutable decision: ${decision.route}`)
  }
  const kind: BusinessTextIntakeKind = decision.route
  const preflight = deps.actionOrchestrator.preflight(
    intakeToolName,
    intakeActionContext(deps, digest),
    { contentDigest: digest, kind },
    '貼り付けられた業務テキストを端末内で解析し、レビュー草稿を1件作成します。',
    intakeIdempotencyKey(input, digest)
  )
  if (preflight.decision.outcome !== 'allow') {
    const saved = saveLinkedIntakeTurn(
      deps,
      useCase,
      input,
      intakeUserSummary(zh, kind, digestTag),
      { content: importFailureText(zh, 'INTAKE_POLICY_DENIED'), blocks: [] },
      'failed',
      [preflight.actionRunId]
    )
    return {
      ...saved,
      toolName: intakeToolName,
      actionRunId: preflight.actionRunId,
      intake: { route: kind, reason: decision.reason, restoreComposerText: true }
    }
  }

  deps.repository.updateActionRun(preflight.actionRunId, 'running')

  if (kind === 'job-case') {
    let imported: JobCaseTextImportResult
    try {
      imported = await deps.importJobCaseText(decision.businessText, undefined, intakeBatchId)
    } catch (error) {
      reportImportFailure(kind, preflight.actionRunId, 'BUSINESS_TEXT_JOB_CASE_IMPORT_FAILED', error)
      deps.repository.updateActionRun(preflight.actionRunId, 'failed', { errorCode: 'BUSINESS_TEXT_JOB_CASE_IMPORT_FAILED' })
      const saved = saveLinkedIntakeTurn(
        deps,
        useCase,
        input,
        intakeUserSummary(zh, kind, digestTag),
        { content: importFailureText(zh, 'BUSINESS_TEXT_JOB_CASE_IMPORT_FAILED'), blocks: [] },
        'failed',
        [preflight.actionRunId]
      )
      return {
        ...saved,
        toolName: intakeToolName,
        actionRunId: preflight.actionRunId,
        intake: { route: kind, reason: decision.reason, restoreComposerText: true }
      }
    }
    deps.repository.updateActionRun(preflight.actionRunId, 'succeeded', {
      resultHash: createHash('sha256').update(`${imported.outcome}:${imported.review.reviewId}`).digest('hex')
    })
    const cards = jobCaseDraftCards(deps, [{ reviewId: imported.review.reviewId, outcome: imported.outcome }])
    const blocks: AiConversationBlock[] = [
      { type: 'system-access', destination: 'case-review', reviewId: imported.review.reviewId },
      ...jobCaseDraftBlocks(intakeBatchId, cards)
    ]
    const saved = saveLinkedIntakeTurn(
      deps,
      useCase,
      input,
      intakeUserSummary(zh, kind, digestTag),
      { content: jobCaseOutcomeText(zh, imported.outcome, 'local', imported.validity, imported.attentionReason), blocks },
      'completed',
      [preflight.actionRunId],
      { intakeBatchId, cards }
    )
    return {
      ...saved,
      toolName: intakeToolName,
      actionRunId: preflight.actionRunId,
      intake: { route: kind, reason: decision.reason, restoreComposerText: false, records: [{ kind, status: 'succeeded', outcome: imported.outcome, reviewId: imported.review.reviewId, sourceDocumentId: null }] }
    }
  }

  let imported: CandidateTextImportResult
  try {
    imported = await deps.importCandidateText(decision.businessText)
  } catch (error) {
    reportImportFailure(kind, preflight.actionRunId, 'BUSINESS_TEXT_CANDIDATE_IMPORT_FAILED', error)
    deps.repository.updateActionRun(preflight.actionRunId, 'failed', { errorCode: 'BUSINESS_TEXT_CANDIDATE_IMPORT_FAILED' })
    const saved = saveLinkedIntakeTurn(
      deps,
      useCase,
      input,
      intakeUserSummary(zh, kind, digestTag),
      { content: importFailureText(zh, 'BUSINESS_TEXT_CANDIDATE_IMPORT_FAILED'), blocks: [] },
      'failed',
      [preflight.actionRunId]
    )
    return {
      ...saved,
      toolName: intakeToolName,
      actionRunId: preflight.actionRunId,
      intake: { route: kind, reason: decision.reason, restoreComposerText: true }
    }
  }
  deps.repository.updateActionRun(preflight.actionRunId, 'succeeded', {
    resultHash: createHash('sha256').update(`${imported.outcome}:${imported.review.documentId}`).digest('hex')
  })
  const blocks: AiConversationBlock[] = []
  if (imported.outcome === 'created' && imported.facts) {
    const ordinal = nextImportOrdinal(deps, input.conversationId)
    // The block schema caps ordinals at 10; past that the draft facts and the
    // navigation card still carry the outcome.
    if (ordinal <= 10) {
      blocks.push({
        type: 'resume-import',
        imported: [{ documentId: imported.review.documentId, label: imported.facts.label, ordinal }],
        failedCount: 0
      })
    }
    blocks.push({ type: 'candidate-draft-facts', facts: imported.facts })
    blocks.push({ type: 'system-access', destination: 'review-center' })
    deps.registerConversationImport?.(input.conversationId, imported.review.documentId)
  } else if (imported.outcome === 'existing-review') {
    blocks.push({ type: 'system-access', destination: 'review-center' })
  } else {
    blocks.push({
      type: 'system-access',
      destination: 'candidate',
      sourceDocumentId: imported.review.documentId,
      view: 'overview'
    })
  }
  const saved = saveLinkedIntakeTurn(
    deps,
    useCase,
    input,
    intakeUserSummary(zh, kind, digestTag),
    { content: candidateOutcomeText(zh, imported.outcome), blocks },
    'completed',
    [preflight.actionRunId]
  )
  return {
    ...saved,
    toolName: intakeToolName,
    actionRunId: preflight.actionRunId,
    intake: { route: kind, reason: decision.reason, restoreComposerText: false, records: [{ kind, status: 'succeeded', outcome: imported.outcome, reviewId: null, sourceDocumentId: imported.review.documentId }] }
  }
}
