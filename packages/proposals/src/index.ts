import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import type { ConfirmedJobCase } from '@job-cases'
import { detectDirectIdentifiers } from '@privacy'
import type { CandidateProfile } from '@resume'
import {
  createProposalDraftInputSchema,
  proposalDraftSnapshotSchema,
  recordProposalFollowUpInputSchema,
  updateProposalDraftInputSchema
} from '@shared'
import type {
  CreateProposalDraftInput,
  ProposalAttachmentPreview,
  ProposalDraftSnapshot,
  ProposalFollowUpEvent,
  RecordProposalFollowUpInput,
  UpdateProposalDraftInput
} from '@shared/contracts'

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function fieldValue(
  fields: Array<{ key: string; value: string | null }>,
  key: string,
  fallback = '未記載'
): string {
  return fields.find((field) => field.key === key)?.value?.trim() || fallback
}

function normalizedCc(values: string[], recipientTo: string): string[] {
  const recipient = recipientTo.toLocaleLowerCase('en-US')
  return [...new Set(values.map((value) => value.trim().toLocaleLowerCase('en-US')))]
    .filter((value) => value !== recipient)
    .toSorted()
}

export function proposalContentHash(draft: Pick<
  ProposalDraftSnapshot,
  | 'jobCaseId'
  | 'jobCaseVersion'
  | 'candidateProfileId'
  | 'candidateProfileVersion'
  | 'recipientTo'
  | 'recipientCc'
  | 'candidateDisplayName'
  | 'subject'
  | 'body'
  | 'attachment'
>): string {
  return hashJson({
    jobCase: { id: draft.jobCaseId, version: draft.jobCaseVersion },
    candidateProfile: { id: draft.candidateProfileId, version: draft.candidateProfileVersion },
    recipient: {
      to: draft.recipientTo.trim().toLocaleLowerCase('en-US'),
      cc: normalizedCc(draft.recipientCc, draft.recipientTo)
    },
    candidateDisplayName: draft.candidateDisplayName.trim(),
    subject: draft.subject.trim(),
    body: draft.body.trim(),
    attachment: {
      fileName: draft.attachment.fileName,
      mimeType: draft.attachment.mimeType,
      contentHash: draft.attachment.contentHash,
      redacted: draft.attachment.redacted,
      sourceDocumentIncluded: draft.attachment.sourceDocumentIncluded
    }
  })
}

function attachmentFromCandidate(profile: CandidateProfile): ProposalAttachmentPreview {
  const fields = profile.fields
    .filter((field): field is typeof field & { value: string } =>
      field.key !== 'work_authorization' && Boolean(field.value?.trim())
    )
    .map((field) => ({
      key: field.key,
      label: field.label,
      value: field.value.trim(),
      sourceLabels: field.sourceLabels
    }))
  const projectExperiences = profile.projectExperiences.map((project) => ({
    title: project.title.trim(),
    period: project.period?.trim() || null,
    role: project.role?.trim() || null,
    technologies: project.technologies.map((technology) => technology.trim()).filter(Boolean),
    summary: project.summary.trim()
  }))
  const identifiers = detectDirectIdentifiers([
    ...fields.map((field) => field.value),
    ...projectExperiences.flatMap((project) => [
      project.title,
      project.period ?? '',
      project.role ?? '',
      ...project.technologies,
      project.summary
    ])
  ].join('\n'))
  if (identifiers.length > 0) {
    throw new Error(`Candidate profile is not eligible for proposal export: ${identifiers.join(', ')}`)
  }
  const anonymousCandidateLabel = `候補者 ${profile.id.slice(0, 8).toLocaleUpperCase('en-US')}`
  const contentHash = hashJson({
    profileId: profile.id,
    profileVersion: profile.profileVersion,
    anonymousCandidateLabel,
    fields,
    projectExperiences
  })
  return {
    fileName: `candidate-${profile.id.slice(0, 8)}-profile.pdf`,
    mimeType: 'application/pdf',
    redacted: true,
    sourceDocumentIncluded: false,
    anonymousCandidateLabel,
    fields,
    projectExperiences,
    contentHash
  }
}

function localJapaneseTemplate(
  input: CreateProposalDraftInput,
  jobCase: ConfirmedJobCase,
  profile: CandidateProfile,
  attachment: ProposalAttachmentPreview
): { subject: string; body: string } {
  const caseTitle = fieldValue(jobCase.fields, 'title', '案件')
  const caseRole = fieldValue(jobCase.fields, 'role')
  const requiredSkills = fieldValue(jobCase.fields, 'required_skills')
  const candidateSkills = fieldValue(profile.fields, 'skills')
  const experience = fieldValue(profile.fields, 'experience_years')
  const availability = fieldValue(profile.fields, 'availability')
  const candidateRate = fieldValue(profile.fields, 'rate')
  const japanese = fieldValue(profile.fields, 'japanese_level')
  const workStyle = fieldValue(profile.fields, 'work_style')
  const candidateRole = fieldValue(profile.fields, 'role')
  const greeting = input.tone === 'formal'
    ? '平素より大変お世話になっております。'
    : 'いつもお世話になっております。'
  const introduction = input.tone === 'concise'
    ? `下記人材をご提案いたします。`
    : `${caseTitle}のご要件に関連し、下記人材をご提案申し上げます。`
  const closing = input.tone === 'formal'
    ? 'ご査収のうえ、ご面談の機会を賜れますと幸甚に存じます。何卒よろしくお願い申し上げます。'
    : 'ご関心をお持ちいただけましたら、面談候補日時をご相談させてください。よろしくお願いいたします。'
  return {
    subject: `【人材ご提案】${caseTitle} / ${input.candidateDisplayName}`.slice(0, 200),
    body: [
      greeting,
      '',
      introduction,
      '',
      `【対外表示名】${input.candidateDisplayName}`,
      `【想定ロール】${candidateRole}`,
      `【主要スキル】${candidateSkills}`,
      `【経験年数】${experience}`,
      `【稼働開始】${availability}`,
      `【希望単価】${candidateRate}`,
      `【日本語】${japanese}`,
      `【勤務形態】${workStyle}`,
      '',
      `【案件側ロール】${caseRole}`,
      `【案件必須スキル】${requiredSkills}`,
      '',
      `詳細は、個人識別情報を含まない添付資料「${attachment.fileName}」をご確認ください。`,
      '氏名・連絡先等の開示が必要な場合は、別途合意のうえ安全な方法で共有いたします。',
      '',
      closing
    ].join('\n')
  }
}

export function createLocalProposalDraft(
  rawInput: CreateProposalDraftInput,
  jobCase: ConfirmedJobCase,
  profile: CandidateProfile,
  draftId: string,
  now = new Date()
): ProposalDraftSnapshot {
  const input = createProposalDraftInputSchema.parse(rawInput)
  if (jobCase.id !== input.jobCaseId) throw new Error('Proposal job case identity does not match.')
  if (profile.id !== input.candidateProfileId) throw new Error('Proposal candidate identity does not match.')
  const sourceIdentifiers = detectDirectIdentifiers([
    ...jobCase.fields.map((field) => field.value ?? ''),
    ...profile.fields
      .filter((field) => field.key !== 'work_authorization')
      .map((field) => field.value ?? ''),
    ...profile.projectExperiences.flatMap((project) => [
      project.title,
      project.period ?? '',
      project.role ?? '',
      ...project.technologies,
      project.summary
    ])
  ].join('\n'))
  if (sourceIdentifiers.length > 0) {
    throw new Error(`Confirmed proposal inputs contain direct identifiers: ${sourceIdentifiers.join(', ')}`)
  }
  const attachment = attachmentFromCandidate(profile)
  const normalizedInput = {
    ...input,
    recipientTo: input.recipientTo.toLocaleLowerCase('en-US'),
    recipientCc: normalizedCc(input.recipientCc, input.recipientTo)
  }
  const content = localJapaneseTemplate(normalizedInput, jobCase, profile, attachment)
  const timestamp = now.toISOString()
  const draftBase = {
    schemaVersion: 'proposal-draft-v1' as const,
    id: draftId,
    taskId: normalizedInput.taskId,
    jobCaseId: jobCase.id,
    jobCaseVersion: jobCase.version,
    candidateProfileId: profile.id,
    candidateProfileVersion: profile.profileVersion,
    recipientTo: normalizedInput.recipientTo,
    recipientCc: normalizedInput.recipientCc,
    candidateDisplayName: normalizedInput.candidateDisplayName,
    subject: content.subject,
    body: content.body,
    attachment,
    tone: normalizedInput.tone,
    status: 'awaiting_review' as const,
    revision: 1,
    approvedContentHash: null,
    approvedAt: null,
    approvedBy: null,
    exportedAt: null,
    exportPackageHash: null,
    generation: {
      mode: 'deterministic-local-v1' as const,
      cloudUsed: false as const,
      rawResumeUsed: false as const,
      rawMailUsed: false as const,
      recipientAndDisplayNameCloudEligible: false as const
    },
    createdAt: timestamp,
    updatedAt: timestamp
  }
  return proposalDraftSnapshotSchema.parse({
    ...draftBase,
    contentHash: proposalContentHash(draftBase)
  })
}

export function updateLocalProposalDraft(
  current: ProposalDraftSnapshot,
  rawInput: UpdateProposalDraftInput,
  now = new Date()
): ProposalDraftSnapshot {
  const input = updateProposalDraftInputSchema.parse(rawInput)
  if (current.id !== input.draftId) throw new Error('Proposal draft identity does not match.')
  if (current.revision !== input.revision) throw new Error('Proposal draft changed. Reload before editing.')
  if (current.followUp.stage !== null) throw new Error('A proposal with recorded delivery or sales results cannot be edited. Create a new draft instead.')
  const updatedBase = {
    ...current,
    recipientTo: input.recipientTo.toLocaleLowerCase('en-US'),
    recipientCc: normalizedCc(input.recipientCc, input.recipientTo),
    candidateDisplayName: input.candidateDisplayName,
    subject: input.subject,
    body: input.body,
    status: 'awaiting_review' as const,
    revision: current.revision + 1,
    approvedContentHash: null,
    approvedAt: null,
    approvedBy: null,
    exportedAt: null,
    exportPackageHash: null,
    updatedAt: now.toISOString()
  }
  return proposalDraftSnapshotSchema.parse({
    ...updatedBase,
    contentHash: proposalContentHash(updatedBase)
  })
}

export function approveLocalProposalDraft(
  current: ProposalDraftSnapshot,
  expectedContentHash: string,
  approvedBy: string,
  now = new Date()
): ProposalDraftSnapshot {
  if (current.contentHash !== expectedContentHash) throw new Error('Proposal content changed. Review it again before approval.')
  if (current.followUp.stage !== null) throw new Error('A proposal with recorded delivery or sales results cannot be approved again.')
  const approvedAt = now.toISOString()
  return proposalDraftSnapshotSchema.parse({
    ...current,
    status: 'approved',
    approvedContentHash: current.contentHash,
    approvedAt,
    approvedBy,
    exportedAt: null,
    exportPackageHash: null,
    updatedAt: approvedAt
  })
}

export function markProposalExported(
  current: ProposalDraftSnapshot,
  packageHash: string,
  now = new Date()
): ProposalDraftSnapshot {
  if (current.approvedContentHash !== current.contentHash || !['approved', 'exported'].includes(current.status)) {
    throw new Error('Only the currently approved proposal content can be exported.')
  }
  if (current.followUp.stage !== null) throw new Error('A proposal with recorded delivery or sales results cannot be exported again.')
  const exportedAt = now.toISOString()
  return proposalDraftSnapshotSchema.parse({
    ...current,
    status: 'exported',
    exportedAt,
    exportPackageHash: packageHash,
    updatedAt: exportedAt
  })
}

const terminalFollowUpStages = new Set(['accepted', 'declined', 'withdrawn'])

export function recordLocalProposalFollowUp(
  current: ProposalDraftSnapshot,
  rawInput: RecordProposalFollowUpInput,
  eventId: string,
  recordedBy: string,
  now = new Date()
): { draft: ProposalDraftSnapshot; event: ProposalFollowUpEvent } {
  const input = recordProposalFollowUpInputSchema.parse(rawInput)
  if (current.id !== input.draftId) throw new Error('Proposal follow-up identity does not match.')
  if (current.status !== 'exported') throw new Error('Proposal delivery or sales results can only be recorded after an approved package is exported.')
  if (current.followUp.revision !== input.expectedRevision) throw new Error('Proposal follow-up changed. Reload before recording another result.')
  if (current.followUp.events.length >= 100) throw new Error('Proposal follow-up history reached the supported limit.')
  if (current.followUp.stage === null && input.stage !== 'sent') {
    throw new Error('Record the confirmed external send before recording replies or sales outcomes.')
  }
  if (current.followUp.stage && terminalFollowUpStages.has(current.followUp.stage)) {
    throw new Error('A terminal proposal outcome is already recorded. Create a new proposal if the business process restarts.')
  }
  if (current.followUp.stage === input.stage) throw new Error('The same proposal follow-up stage is already current.')
  const latest = current.followUp.events.at(-1)
  if (latest && input.occurredOn < latest.occurredOn) {
    throw new Error('Proposal follow-up dates cannot move backwards.')
  }
  const note = input.note?.trim() || null
  if (note && detectDirectIdentifiers(note).length > 0) {
    throw new Error('Proposal follow-up notes cannot contain direct identifiers. Use a non-identifying business summary.')
  }
  const recordedAt = now.toISOString()
  const event = {
    id: eventId,
    draftId: current.id,
    revision: current.followUp.revision + 1,
    stage: input.stage,
    occurredOn: input.occurredOn,
    note,
    recordedBy: recordedBy.trim(),
    recordedAt,
    cloudEligible: false as const
  }
  const draft = proposalDraftSnapshotSchema.parse({
    ...current,
    followUp: {
      revision: event.revision,
      stage: event.stage,
      events: [...current.followUp.events, event],
      cloudEligible: false
    },
    updatedAt: recordedAt
  })
  return { draft, event }
}

export function markProposalExportUnknown(current: ProposalDraftSnapshot, now = new Date()): ProposalDraftSnapshot {
  return proposalDraftSnapshotSchema.parse({
    ...current,
    status: 'export_unknown',
    updatedAt: now.toISOString()
  })
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function proposalAttachmentHtml(draft: ProposalDraftSnapshot): string {
  const fields = draft.attachment.fields.map((field) => `
    <section class="field">
      <span>${escapeHtml(field.label)}</span>
      <strong>${escapeHtml(field.value)}</strong>
    </section>`).join('')
  const projects = draft.attachment.projectExperiences.map((project) => `
    <article class="project">
      <div class="project-heading"><strong>${escapeHtml(project.title)}</strong><span>${escapeHtml(project.period ?? '期間未記載')}</span></div>
      <p class="project-meta">${escapeHtml(project.role ?? '役割未記載')}${project.technologies.length > 0 ? ` · ${escapeHtml(project.technologies.join(' / '))}` : ''}</p>
      <p>${escapeHtml(project.summary)}</p>
    </article>`).join('')
  return `<!doctype html>
  <html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #1f2937; font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif; }
    header { padding-bottom: 14px; border-bottom: 2px solid #255da8; }
    .eyebrow { color: #255da8; font-size: 9px; font-weight: 700; letter-spacing: .14em; }
    h1 { margin: 6px 0 4px; font-size: 23px; }
    .privacy { margin-top: 8px; padding: 9px 11px; color: #28624d; font-size: 9px; background: #eff8f4; border: 1px solid #cce7dc; border-radius: 6px; }
    main { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: 16px; }
    .field { display: grid; min-height: 62px; padding: 10px; background: #f8fafc; border: 1px solid #dce3eb; border-radius: 6px; }
    .field span { color: #718096; font-size: 8px; font-weight: 700; }
    .field strong { margin-top: 5px; font-size: 11px; line-height: 1.5; white-space: pre-wrap; }
    .projects { margin-top: 18px; break-before: auto; }
    .projects h2 { margin: 0 0 9px; color: #255da8; font-size: 13px; }
    .project { margin-bottom: 8px; padding: 11px; border: 1px solid #dce3eb; border-radius: 6px; break-inside: avoid; }
    .project-heading { display: flex; justify-content: space-between; gap: 12px; }
    .project-heading strong { font-size: 11px; }
    .project-heading span, .project-meta { color: #718096; font-size: 8px; }
    .project p { margin: 6px 0 0; font-size: 9px; line-height: 1.55; white-space: pre-wrap; }
    footer { margin-top: 18px; color: #8a94a3; font-size: 7px; border-top: 1px solid #e5e9ef; padding-top: 8px; }
  </style></head><body>
    <header><span class="eyebrow">REDACTED CANDIDATE PROFILE</span><h1>${escapeHtml(draft.attachment.anonymousCandidateLabel)}</h1>
      <div class="privacy">個人識別情報を含まない、HR確認済みの構造化プロフィールです。原本ファイル・氏名・連絡先は含まれません。</div>
    </header><main>${fields}</main>
    ${projects ? `<section class="projects"><h2>確認済みプロジェクト経験</h2>${projects}</section>` : ''}
    <footer>Profile ${escapeHtml(draft.candidateProfileId.slice(0, 8))} · Version ${draft.candidateProfileVersion} · Attachment model hash ${escapeHtml(draft.attachment.contentHash)}</footer>
  </body></html>`
}

export async function buildProposalPackageZip(
  draft: ProposalDraftSnapshot,
  attachmentPdf: Buffer,
  now = new Date()
): Promise<{ bytes: Buffer; packageHash: string }> {
  if (attachmentPdf.length < 4 || attachmentPdf.subarray(0, 4).toString('ascii') !== '%PDF') {
    throw new Error('Proposal attachment is not a valid PDF payload.')
  }
  const message = [
    `To: ${draft.recipientTo}`,
    ...(draft.recipientCc.length > 0 ? [`Cc: ${draft.recipientCc.join(', ')}`] : []),
    `Subject: ${draft.subject}`,
    '',
    draft.body
  ].join('\n')
  const messageBytes = Buffer.from(message, 'utf8')
  const manifest = {
    version: 'proposal-package-v1',
    draftId: draft.id,
    proposalContentHash: draft.contentHash,
    generatedAt: now.toISOString(),
    deliveryState: 'exported-not-sent',
    privacy: {
      rawResumeIncluded: false,
      rawMailIncluded: false,
      attachmentRedacted: true
    },
    files: [
      { name: 'message.txt', sha256: createHash('sha256').update(messageBytes).digest('hex') },
      { name: draft.attachment.fileName, sha256: createHash('sha256').update(attachmentPdf).digest('hex'), attachmentModelHash: draft.attachment.contentHash }
    ]
  }
  const zip = new JSZip()
  zip.file('message.txt', messageBytes)
  zip.file(draft.attachment.fileName, attachmentPdf)
  zip.file('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  return { bytes, packageHash: createHash('sha256').update(bytes).digest('hex') }
}
