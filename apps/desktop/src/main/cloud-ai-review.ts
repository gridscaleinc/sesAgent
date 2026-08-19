import { createHash, randomUUID } from 'node:crypto'
import { collectLocalPersonNameCandidates, type LocalPersonNameDetectorPort } from '@local-ai'
import {
  redactTextForCloud,
  type CloudCallAuditContext,
  type LocalPiiMapping,
  type RedactedPayload,
  type RedactionSessionEvidence
} from '@privacy'
import type {
  PrepareAiCommerceCloudPromptResult
} from '@shared/contracts'
import { requireCloudAiPrivacyRuntime } from './cloud-ai-privacy'
import type { CloudPrivacyGateBinding, CloudPrivacyGateSnapshot } from './privacy-gates'

const reviewRequiredReason = 'coverage:person_name_review_required'

interface CloudPromptEvidenceRepository {
  saveRedactionSession(session: RedactionSessionEvidence, mappings: LocalPiiMapping[]): void
}

interface PendingCloudPromptReview {
  ticket: string
  ticketHash: string
  actorId: string
  endpointId: string
  sourceVersion: string
  sessionId: string
  rawContentBytes: Buffer
  rawContentBytesHash: string
  normalizedContentHash: string
  detectionSummaryHash: string
  redactedPreview: string
  previewHash: string
  removedIdentifierTypes: string[]
  expiresAt: Date
  gateBinding: CloudPrivacyGateBinding
  status: 'ready' | 'executing'
}

interface PendingAiCommerceOperation {
  operationId: string
  expiresAt: number
}

export interface CloudPromptNativeReview {
  redactedPreview: string
  previewHash: string
  removedIdentifierTypes: string[]
  expiresAt: string
}

export interface CloudAiReviewServiceOptions<TProviderResponse> {
  repository: CloudPromptEvidenceRepository
  localNer: LocalPersonNameDetectorPort | null
  endpointId: string
  policyVersion: string
  loadGates(): Promise<CloudPrivacyGateSnapshot>
  confirm(review: CloudPromptNativeReview): Promise<boolean>
  invoke(
    payload: RedactedPayload,
    operationId: string,
    auditContext: CloudCallAuditContext
  ): Promise<TProviderResponse>
  now?: () => Date
  idFactory?: () => string
}

export interface CloudAiReviewExecutionResult<TProviderResponse> {
  response: TProviderResponse
  removedIdentifierTypes: string[]
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function sameGateBinding(left: CloudPrivacyGateBinding, right: CloudPrivacyGateBinding): boolean {
  return left.qualityReportHash === right.qualityReportHash &&
    left.privacyImplementationSha256 === right.privacyImplementationSha256 &&
    left.cloudEnforcementSha256 === right.cloudEnforcementSha256
}

function detectionSummaryHash(
  entities: Array<{ text: string; startUtf16: number; endUtf16: number; tag: string }>,
  mappings: LocalPiiMapping[]
): string {
  const canonical = {
    names: entities
      .map(({ text, startUtf16, endUtf16, tag }) => ({ text, startUtf16, endUtf16, tag }))
      .toSorted((left, right) => left.startUtf16 - right.startUtf16 || left.text.localeCompare(right.text)),
    replacements: mappings
      .map(({ identifierType, placeholder }) => ({ identifierType, placeholder }))
      .toSorted((left, right) => left.placeholder.localeCompare(right.placeholder))
  }
  return hash(JSON.stringify(canonical))
}

export class CloudAiReviewService<TProviderResponse> {
  private readonly pendingReviews = new Map<string, PendingCloudPromptReview>()
  private readonly pendingOperations = new Map<string, PendingAiCommerceOperation>()
  private preparing = false

  constructor(private readonly options: CloudAiReviewServiceOptions<TProviderResponse>) {}

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }

  private id(): string {
    return this.options.idFactory?.() ?? randomUUID()
  }

  private discard(review: PendingCloudPromptReview): void {
    review.rawContentBytes.fill(0)
    this.pendingReviews.delete(review.ticket)
  }

  private expire(): void {
    const now = this.now().getTime()
    for (const review of this.pendingReviews.values()) {
      if (review.expiresAt.getTime() <= now) this.discard(review)
    }
    for (const [fingerprint, operation] of this.pendingOperations) {
      if (operation.expiresAt <= now) this.pendingOperations.delete(fingerprint)
    }
  }

  private expireOperations(): void {
    const now = this.now().getTime()
    for (const [fingerprint, operation] of this.pendingOperations) {
      if (operation.expiresAt <= now) this.pendingOperations.delete(fingerprint)
    }
  }

  private async requireCurrentGates(): Promise<{
    gates: CloudPrivacyGateSnapshot
    localNer: LocalPersonNameDetectorPort
    binding: CloudPrivacyGateBinding
  }> {
    const gates = await this.options.loadGates()
    const localNer = requireCloudAiPrivacyRuntime({
      qualityGateStatus: gates.qualityGate.status,
      qualityEvidenceBound: gates.binding !== null,
      localNer: this.options.localNer
    })
    if (!gates.binding) throw new Error('Cloud AI privacy quality evidence is not bound.')
    return { gates, localNer, binding: gates.binding }
  }

  async prepare(content: string, actorId: string): Promise<PrepareAiCommerceCloudPromptResult> {
    this.expire()
    if (this.preparing) throw new Error('別の Cloud AI 脱敏プレビューを準備中です。完了後にもう一度実行してください。')
    this.preparing = true
    try {
      for (const pending of this.pendingReviews.values()) {
        if (pending.actorId === actorId && pending.endpointId === this.options.endpointId) this.discard(pending)
      }
      const { localNer, binding } = await this.requireCurrentGates()
      const nameDetection = await localNer.detectNames(content)
      if (nameDetection.networkAccess !== false) {
        throw new Error('ローカル氏名検出のネットワーク隔離を確認できません。')
      }
      const ticket = this.id()
      const sessionId = this.id()
      const sourceVersion = 'cloud-assist-review:' + this.id()
      const preparedAt = this.now()
      const redaction = redactTextForCloud(content, {
        sourceVersion,
        policyVersion: this.options.policyVersion,
        knownPersonNames: collectLocalPersonNameCandidates(content, nameDetection),
        sessionId,
        now: preparedAt,
        ttlMinutes: 10
      })
      this.options.repository.saveRedactionSession(redaction.session, redaction.mappings)
      const nonReviewFailures = redaction.blockedReasons.filter((reason) => reason !== reviewRequiredReason)
      if (
        redaction.session.status !== 'uncertain' ||
        !redaction.blockedReasons.includes(reviewRequiredReason) ||
        nonReviewFailures.length > 0 ||
        !redaction.redactedContent.trim()
      ) {
        throw new Error('入力を安全に脱敏できませんでした。直接識別子と入力範囲を確認してください。')
      }
      const expiresAt = new Date(preparedAt.getTime() + 10 * 60_000)
      const rawContentBytes = Buffer.from(content, 'utf8')
      const previewHash = hash(redaction.redactedContent)
      const review: PendingCloudPromptReview = {
        ticket,
        ticketHash: hash(ticket),
        actorId,
        endpointId: this.options.endpointId,
        sourceVersion,
        sessionId,
        rawContentBytes,
        rawContentBytesHash: hash(rawContentBytes),
        normalizedContentHash: hash(content.normalize('NFKC').trim()),
        detectionSummaryHash: detectionSummaryHash(nameDetection.entities, redaction.mappings),
        redactedPreview: redaction.redactedContent,
        previewHash,
        removedIdentifierTypes: redaction.session.removedTypes,
        expiresAt,
        gateBinding: binding,
        status: 'ready'
      }
      this.pendingReviews.set(ticket, review)
      return {
        reviewTicket: ticket,
        redactedPreview: review.redactedPreview,
        previewHash: review.previewHash,
        removedIdentifierTypes: review.removedIdentifierTypes,
        expiresAt: expiresAt.toISOString()
      }
    } finally {
      this.preparing = false
    }
  }

  async execute(reviewTicket: string, actorId: string): Promise<CloudAiReviewExecutionResult<TProviderResponse>> {
    this.expire()
    const review = this.pendingReviews.get(reviewTicket)
    if (!review) throw new Error('Cloud AI の確認チケットが無効、期限切れ、または使用済みです。')
    if (review.status !== 'ready') throw new Error('この Cloud AI 確認チケットは既に処理中です。')
    if (review.actorId !== actorId || review.endpointId !== this.options.endpointId) {
      this.discard(review)
      throw new Error('Cloud AI の確認範囲が現在の実行コンテキストと一致しません。')
    }
    if (hash(review.rawContentBytes) !== review.rawContentBytesHash) {
      this.discard(review)
      throw new Error('Cloud AI の確認内容を検証できません。')
    }

    let current: {
      localNer: LocalPersonNameDetectorPort
      binding: CloudPrivacyGateBinding
    }
    try {
      current = await this.requireCurrentGates()
    } catch (error) {
      this.discard(review)
      throw error
    }
    const { localNer, binding } = current
    if (!sameGateBinding(review.gateBinding, binding)) {
      this.discard(review)
      throw new Error('プライバシー評価が更新されました。脱敏プレビューを作り直してください。')
    }
    review.status = 'executing'
    try {
      const confirmed = await this.options.confirm({
        redactedPreview: review.redactedPreview,
        previewHash: review.previewHash,
        removedIdentifierTypes: review.removedIdentifierTypes,
        expiresAt: review.expiresAt.toISOString()
      })
      if (!confirmed) throw new Error('Cloud AI への送信をキャンセルしました。')
      if (review.expiresAt.getTime() <= this.now().getTime()) {
        throw new Error('Cloud AI の確認チケットの有効期限が切れました。')
      }

      const content = review.rawContentBytes.toString('utf8')
      if (hash(content.normalize('NFKC').trim()) !== review.normalizedContentHash) {
        throw new Error('Cloud AI の確認内容が変更されています。')
      }
      const nameDetection = await localNer.detectNames(content)
      if (nameDetection.networkAccess !== false) {
        throw new Error('ローカル氏名検出のネットワーク隔離を確認できません。')
      }
      const redaction = redactTextForCloud(content, {
        sourceVersion: review.sourceVersion,
        policyVersion: this.options.policyVersion,
        knownPersonNames: collectLocalPersonNameCandidates(content, nameDetection),
        personNameReviewCompleted: true,
        sessionId: review.sessionId,
        now: this.now(),
        ttlMinutes: 10
      })
      if (!redaction.payload || redaction.session.status !== 'passed') {
        this.options.repository.saveRedactionSession(redaction.session, redaction.mappings)
        throw new Error('確認後の脱敏内容が安全条件を満たしません。')
      }
      if (detectionSummaryHash(nameDetection.entities, redaction.mappings) !== review.detectionSummaryHash) {
        throw new Error('ローカル識別子検出結果が変更されました。脱敏プレビューを作り直してください。')
      }
      if (hash(redaction.redactedContent) !== review.previewHash) {
        throw new Error('脱敏プレビューが変更されました。もう一度確認してください。')
      }
      this.options.repository.saveRedactionSession(redaction.session, redaction.mappings)

      const finalGates = await this.requireCurrentGates()
      if (!sameGateBinding(review.gateBinding, finalGates.binding)) {
        throw new Error('プライバシー評価が更新されました。脱敏プレビューを作り直してください。')
      }
      if (review.expiresAt.getTime() <= this.now().getTime()) {
        throw new Error('Cloud AI の確認チケットの有効期限が切れました。')
      }
      this.expireOperations()
      const requestFingerprint = hash('aicommerce-cloud-assist-v3\0' + redaction.payload.contentHash)
      const pendingOperation = this.pendingOperations.get(requestFingerprint)
      const operationId = pendingOperation?.operationId ?? 'sesai-' + this.id()
      if (!pendingOperation) {
        this.pendingOperations.set(requestFingerprint, {
          operationId,
          expiresAt: this.now().getTime() + 15 * 60_000
        })
      }
      const response = await this.options.invoke(redaction.payload, operationId, {
        qualityGateReportHash: finalGates.binding.qualityReportHash,
        expertAttestationHash: finalGates.binding.expertAttestationHash,
        reviewTicketHash: review.ticketHash,
        gatePolicyVersion: this.options.policyVersion
      })
      this.pendingOperations.delete(requestFingerprint)
      return {
        response,
        removedIdentifierTypes: redaction.session.removedTypes
      }
    } finally {
      this.discard(review)
    }
  }

  dispose(): void {
    for (const review of this.pendingReviews.values()) review.rawContentBytes.fill(0)
    this.pendingReviews.clear()
    this.pendingOperations.clear()
    this.preparing = false
  }
}
