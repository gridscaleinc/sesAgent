import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { type JobCaseSource, jobCaseSourceSchema } from '@job-cases'
import { type LocalPiiMapping } from '@privacy'
import { proposalDraftSnapshotSchema, proposalFollowUpEventSchema } from '@shared'
import {
  type BusinessPriorityProjection,
  type CandidateMatchFeedbackSnapshot,
  type CandidateMatchRunSummary,
  type CandidateProfileSearchResult,
  type MatchingHomeResult,
  type ProposalDraftSnapshot,
  type ProposalFollowUpEvent
} from '@shared/contracts'

import type {
  BusinessPriorityProjectionRow,
  CandidateMatchResultRow,
  CandidateProfileEmbeddingRow,
  GmailMessageRow,
  JobCaseSourceRow,
  MappingRow,
  ProposalDraftRow,
  ProposalFollowUpEventRow,
  StoredGmailMessageInput
} from './rows'


export const storedGmailMessageInputSchema: z.ZodType<StoredGmailMessageInput> = z.object({
  accountEmail: z.string().email().max(320),
  gmailMessageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  threadId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  historyId: z.string().min(1).max(128),
  internalDate: z.string().datetime(),
  labelIds: z.array(z.string().min(1).max(128)).max(100),
  rfcMessageId: z.string().max(1_000).nullable(),
  fromDomain: z.string().max(253).nullable(),
  redactedSubject: z.string().max(2_000),
  redactedBody: z.string().max(500_000),
  redactionSessionId: z.string().uuid(),
  classification: z.enum(['job-case', 'candidate-proposal', 'unclassified']),
  businessFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  duplicateOfMessageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).nullable(),
  warningCodes: z.array(z.string().min(1).max(120)).max(50),
  attachmentCount: z.number().int().nonnegative().max(1_000),
  importedAt: z.string().datetime()
})

export function storedGmailMessageFromRow(row: GmailMessageRow): StoredGmailMessageInput {
  return storedGmailMessageInputSchema.parse({
    accountEmail: row.account_email,
    gmailMessageId: row.gmail_message_id,
    threadId: row.thread_id,
    historyId: row.history_id,
    internalDate: row.internal_date,
    labelIds: JSON.parse(row.label_ids_json),
    rfcMessageId: row.rfc_message_id,
    fromDomain: row.from_domain,
    redactedSubject: row.redacted_subject,
    redactedBody: row.redacted_body,
    redactionSessionId: row.redaction_session_id,
    classification: row.classification,
    businessFingerprint: row.business_fingerprint,
    duplicateOfMessageId: row.duplicate_of_message_id,
    warningCodes: JSON.parse(row.warning_codes_json),
    attachmentCount: row.attachment_count,
    importedAt: row.imported_at
  })
}

export function jobCaseSourceFromRow(row: JobCaseSourceRow): JobCaseSource {
  return jobCaseSourceSchema.parse({
    version: 'job-case-source-v1',
    id: row.id,
    sourceType: row.source_type,
    providerAccount: row.provider_account,
    providerMessageId: row.provider_message_id,
    threadId: row.thread_id,
    fromDomain: row.from_domain,
    messageDate: row.message_date,
    redactedSubject: row.redacted_subject,
    redactedBody: row.redacted_body,
    redactionSessionId: row.redaction_session_id,
    warningCodes: JSON.parse(row.warning_codes_json),
    createdAt: row.created_at
  })
}

export function proposalDraftFromRow(row: ProposalDraftRow): ProposalDraftSnapshot {
  const draft = proposalDraftSnapshotSchema.parse(JSON.parse(row.payload_json))
  if (
    draft.status !== row.status ||
    draft.revision !== row.revision ||
    draft.contentHash !== row.content_hash ||
    draft.approvedContentHash !== row.approved_content_hash
  ) {
    throw new Error('Proposal draft columns do not match the encrypted payload.')
  }
  return draft
}

export function proposalFollowUpEventFromRow(row: ProposalFollowUpEventRow): ProposalFollowUpEvent {
  return proposalFollowUpEventSchema.parse({
    id: row.id,
    draftId: row.draft_id,
    revision: row.revision,
    stage: row.stage,
    occurredOn: row.occurred_on,
    note: row.note,
    recordedBy: row.actor,
    recordedAt: row.recorded_at,
    cloudEligible: false
  })
}

export function candidateMatchFeedbackFromRow(row: CandidateMatchResultRow): CandidateMatchFeedbackSnapshot | null {
  if (!row.feedback_decision) return null
  return {
    decision: row.feedback_decision,
    reasonCode: row.feedback_reason!,
    note: row.feedback_note,
    reviewerDisplayName: row.reviewed_by!,
    revision: row.feedback_revision,
    reviewedAt: row.reviewed_at!
  }
}

export function candidateMatchEvaluation(rows: CandidateMatchResultRow[]): CandidateMatchRunSummary['evaluation'] {
  const reviewed = rows.filter((row) => row.feedback_decision !== null)
  const suitable = reviewed.filter((row) => row.feedback_decision === 'suitable')
  let judgedNdcgAt20: number | null = null
  if (rows.length > 0 && reviewed.length === rows.length && suitable.length > 0) {
    const dcg = rows
      .filter((row) => row.result_rank <= 20 && row.feedback_decision === 'suitable')
      .reduce((score, row) => score + 1 / Math.log2(row.result_rank + 1), 0)
    const idealCount = Math.min(20, suitable.length)
    const idcg = Array.from({ length: idealCount }, (_, index) => 1 / Math.log2(index + 2))
      .reduce((score, gain) => score + gain, 0)
    judgedNdcgAt20 = Math.round(dcg / idcg * 10_000) / 10_000
  }
  return {
    resultCount: rows.length,
    feedbackCount: reviewed.length,
    suitableCount: suitable.length,
    unsuitableCount: reviewed.length - suitable.length,
    coveragePercent: rows.length === 0 ? 0 : Math.round(reviewed.length / rows.length * 100),
    judgedNdcgAt20,
    recallAt20: null,
    recallStatus: 'requires-known-relevant-total'
  }
}

export function matchingHomeFitSnapshot(
  match: CandidateProfileSearchResult,
  rank: number
): MatchingHomeResult['fit'] & { anonymousLabel: string } {
  return {
    anonymousLabel: match.anonymousLabel,
    rank,
    matchScore: match.matchScore,
    matchedTerms: match.matchedTerms,
    termCoverage: match.retrieval.termCoverage,
    hardFilterUnknownCount: match.retrieval.hardFilters.filter((filter) => filter.outcome === 'unknown').length,
    missing: match.retrieval.hardFilters.filter((filter) => filter.outcome !== 'passed').map((filter) => filter.requested),
    hardFilterStatus: match.retrieval.hardFilters.length === 0
      ? 'none'
      : match.retrieval.hardFilters.some((filter) => filter.outcome === 'failed')
        ? 'failed'
        : match.retrieval.hardFilters.some((filter) => filter.outcome === 'unknown') ? 'unknown' : 'passed',
    evidence: match.evidence.map((field) => ({
      key: field.key,
      label: field.label,
      value: field.value,
      sourceLabels: field.sourceLabels
    })),
    projectEvidence: match.projectEvidence ? {
      title: match.projectEvidence.title,
      period: match.projectEvidence.period,
      role: match.projectEvidence.role,
      technologies: match.projectEvidence.technologies,
      summary: match.projectEvidence.summary,
      sourceLabels: match.projectEvidence.sourceLabels
    } : null
  }
}

export function businessPriorityProjectionFromRow(
  row: BusinessPriorityProjectionRow,
  now = new Date()
): BusinessPriorityProjection {
  const overrideActive = row.override_level !== null && row.override_expires_at !== null &&
    new Date(row.override_expires_at).getTime() > now.getTime()
  const manualOverride = overrideActive ? {
    level: row.override_level!,
    actor: row.override_actor!,
    reason: row.override_reason!,
    expiresAt: row.override_expires_at!,
    revision: row.override_revision
  } : null
  return {
    id: row.id,
    matchResultId: row.match_result_id,
    runId: row.run_id,
    candidateProfileId: row.candidate_profile_id,
    ruleVersion: row.rule_version,
    level: row.level,
    effectiveLevel: manualOverride?.level ?? row.level,
    reasons: JSON.parse(row.reasons_json) as string[],
    inputs: JSON.parse(row.inputs_json) as BusinessPriorityProjection['inputs'],
    inputSnapshotHash: row.input_snapshot_hash,
    generatedAt: row.generated_at,
    manualOverride
  }
}

export function jobCaseBusinessFingerprint(subject: string, body: string): string {
  const normalized = `${subject}\n${body}`
    .normalize('NFKC')
    .toLocaleLowerCase('ja-JP')
    .replace(/<[^>]+_\d{3}>/gu, '<PII>')
    .replace(/\s+/gu, ' ')
    .trim()
  return createHash('sha256').update(normalized).digest('hex')
}

export function sealMapping(mappingKey: Buffer, mapping: LocalPiiMapping, sessionId: string): Buffer {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', mappingKey, nonce)
  cipher.setAAD(Buffer.from(`${sessionId}\u0000${mapping.placeholder}\u0000${mapping.identifierType}`))
  const ciphertext = Buffer.concat([cipher.update(mapping.originalValue, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([1]), nonce, tag, ciphertext])
}

export function openMapping(mappingKey: Buffer, row: MappingRow, sessionId: string): string {
  const version = row.encrypted_original[0]
  if (version !== 1 || row.encrypted_original.length < 30) throw new Error('Unsupported encrypted PII mapping.')
  const nonce = row.encrypted_original.subarray(1, 13)
  const tag = row.encrypted_original.subarray(13, 29)
  const ciphertext = row.encrypted_original.subarray(29)
  const decipher = createDecipheriv('aes-256-gcm', mappingKey, nonce)
  decipher.setAAD(Buffer.from(`${sessionId}\u0000${row.placeholder}\u0000${row.identifier_type}`))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

export function assertEmbeddingIdentity(modelId: string, modelRevision: string): void {
  if (modelId.length < 1 || modelId.length > 200 || modelRevision.length < 1 || modelRevision.length > 200) {
    throw new Error('Embedding model identity is invalid.')
  }
}

export function embeddingVectorToBlob(vector: number[]): Buffer {
  if (vector.length < 1 || vector.length > 4_096 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error('Embedding vector is invalid.')
  }
  const blob = Buffer.allocUnsafe(vector.length * 4)
  vector.forEach((value, index) => blob.writeFloatLE(value, index * 4))
  return blob
}

export function embeddingVectorFromRow(row: CandidateProfileEmbeddingRow): number[] {
  if (row.vector_dimension < 1 || row.vector_dimension > 4_096 || row.vector_blob.length !== row.vector_dimension * 4) {
    throw new Error('Stored embedding vector is invalid.')
  }
  return Array.from({ length: row.vector_dimension }, (_, index) => row.vector_blob.readFloatLE(index * 4))
}
