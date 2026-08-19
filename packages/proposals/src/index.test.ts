// @vitest-environment node
import type { ConfirmedJobCaseV2 } from '@job-cases'
import type { CandidateProfile } from '@resume'
import JSZip from 'jszip'
import {
  approveLocalProposalDraft,
  buildProposalPackageZip,
  createLocalProposalDraft,
  markProposalExported,
  proposalAttachmentHtml,
  recordLocalProposalFollowUp,
  updateLocalProposalDraft
} from './index'

const candidate: CandidateProfile = {
  schemaVersion: 'candidate-profile-v1',
  id: '8055be48-a08f-499d-9d82-c95a36018ad9',
  sourceDocumentId: '559dcb5d-dcf0-4c11-a12d-698cfef220e6',
  profileVersion: 1,
  reviewRevision: 1,
  localPersonalDetails: {
    displayName: null,
    gender: null,
    birthDate: null,
    nationality: null,
    phone: null,
    email: null,
    address: null,
    education: null,
    major: null,
    graduationDate: null,
    degree: null
  },
  fields: [
    { key: 'skills', label: 'スキル', value: 'Java / AWS', sourceLabels: ['Page 1'] },
    { key: 'experience_years', label: '経験年数', value: '8年', sourceLabels: ['Page 1'] },
    { key: 'availability', label: '稼働開始', value: '8月', sourceLabels: ['Page 1'] },
    { key: 'rate', label: '希望単価', value: '80万円/月', sourceLabels: ['Page 1'] },
    { key: 'japanese_level', label: '日本語', value: 'N1', sourceLabels: ['Page 1'] },
    { key: 'work_style', label: '勤務形態', value: 'リモート可', sourceLabels: ['Page 1'] },
    { key: 'role', label: 'ロール', value: 'バックエンドエンジニア', sourceLabels: ['Page 1'] },
    { key: 'location', label: '希望勤務地', value: '東京都内', sourceLabels: ['Page 1'] },
    { key: 'work_authorization', label: '就労資格', value: '就労制限なし', sourceLabels: ['Page 1'] }
  ],
  projectExperiences: [{
    id: '9a8d556d-5052-4b7d-b3db-947b65f2e7c2',
    title: '決済基盤クラウド刷新',
    period: '2024/01–2025/06',
    role: 'バックエンドリード',
    technologies: ['Java', 'AWS'],
    summary: '決済APIの再設計とクラウド移行を担当。',
    sourceLabels: ['Page 2']
  }],
  confirmedAt: '2026-07-17T00:00:00.000Z',
  confirmedBy: 'HR',
  containsDirectIdentifiers: false
}

const jobCase: ConfirmedJobCaseV2 = {
  schemaVersion: 'job-case-v2',
  id: '38dca6f6-947b-45d5-98bc-c9e6dcd242e9',
  sourceReviewId: 'ee6b5a0f-ecc2-4f6c-8f71-5f6e89f0fd09',
  sourceId: '9d774305-d8e5-4300-9a7a-4d3d6804ddf2',
  sourceType: 'manual',
  sourceProviderMessageId: null,
  sourceThreadId: '9d774305-d8e5-4300-9a7a-4d3d6804ddf2',
  version: 1,
  reviewRevision: 1,
  fields: [
    { key: 'title', label: '案件名', value: '決済基盤刷新', sourceLabels: ['Manual Subject'] },
    { key: 'role', label: '募集ロール', value: 'バックエンド', sourceLabels: ['Manual Body'] },
    { key: 'required_skills', label: '必須スキル', value: 'Java / AWS', sourceLabels: ['Manual Body'] },
    { key: 'rate', label: '単価', value: '90万円/月', sourceLabels: ['Manual Body'] },
    ...(['settlement', 'location', 'remote', 'start_date', 'working_hours', 'japanese_level', 'interview', 'contract_chain', 'payment_terms', 'work_authorization'] as const).map((key) => ({ key, label: key, value: null, sourceLabels: [] }))
  ],
  confirmedAt: '2026-07-17T00:00:00.000Z',
  confirmedBy: 'Sales',
  containsDirectIdentifiers: false
}

describe('local proposal drafting', () => {
  it('generates an anonymous PDF attachment and keeps outbound identity local-only', () => {
    const draft = createLocalProposalDraft({
      taskId: 'proposal-task-001',
      jobCaseId: jobCase.id,
      candidateProfileId: candidate.id,
      recipientTo: 'bp@example.co.jp',
      recipientCc: [],
      candidateDisplayName: '候補者A',
      tone: 'standard'
    }, jobCase, candidate, 'a86b564b-34ad-4632-927e-47db14c56aaf', new Date('2026-07-17T00:00:00.000Z'))

    expect(draft.body).toContain('候補者A')
    expect(draft.attachment.anonymousCandidateLabel).toBe('候補者 8055BE48')
    expect(draft.attachment.sourceDocumentIncluded).toBe(false)
    expect(draft.attachment.projectExperiences).toEqual([expect.objectContaining({ title: '決済基盤クラウド刷新' })])
    expect(draft.attachment.fields.find((field) => field.key === 'location')?.value).toBe('東京都内')
    expect(draft.attachment.fields.some((field) => field.key === 'work_authorization')).toBe(false)
    expect(JSON.stringify(draft.attachment)).not.toContain('Page 2')
    expect(draft.generation).toMatchObject({ cloudUsed: false, rawResumeUsed: false, rawMailUsed: false })
  })

  it('invalidates approval whenever recipient or content changes', () => {
    const draft = createLocalProposalDraft({
      taskId: 'proposal-task-001', jobCaseId: jobCase.id, candidateProfileId: candidate.id,
      recipientTo: 'bp@example.co.jp', recipientCc: [], candidateDisplayName: '候補者A', tone: 'formal'
    }, jobCase, candidate, 'a86b564b-34ad-4632-927e-47db14c56aaf')
    const approved = approveLocalProposalDraft(draft, draft.contentHash, '営業担当')
    const updated = updateLocalProposalDraft(approved, {
      draftId: approved.id,
      revision: approved.revision,
      recipientTo: 'other@example.co.jp',
      recipientCc: [],
      candidateDisplayName: approved.candidateDisplayName,
      subject: approved.subject,
      body: approved.body
    })

    expect(updated.revision).toBe(2)
    expect(updated.status).toBe('awaiting_review')
    expect(updated.approvedContentHash).toBeNull()
    expect(updated.contentHash).not.toBe(approved.contentHash)
  })

  it('blocks direct identifiers inside confirmed project experience before export', () => {
    expect(() => createLocalProposalDraft({
      taskId: 'proposal-task-001', jobCaseId: jobCase.id, candidateProfileId: candidate.id,
      recipientTo: 'bp@example.co.jp', recipientCc: [], candidateDisplayName: '候補者A', tone: 'standard'
    }, jobCase, {
      ...candidate,
      projectExperiences: candidate.projectExperiences.map((project) => ({
        ...project,
        summary: '担当者連絡先 090-1234-5678'
      }))
    }, 'a86b564b-34ad-4632-927e-47db14c56aaf')).toThrow(/direct identifiers/iu)
  })

  it('records an append-only manual sales outcome only after export', () => {
    const draft = createLocalProposalDraft({
      taskId: 'proposal-task-001', jobCaseId: jobCase.id, candidateProfileId: candidate.id,
      recipientTo: 'bp@example.co.jp', recipientCc: [], candidateDisplayName: '候補者A', tone: 'standard'
    }, jobCase, candidate, 'a86b564b-34ad-4632-927e-47db14c56aaf')
    expect(() => recordLocalProposalFollowUp(draft, {
      draftId: draft.id, expectedRevision: 0, stage: 'sent', occurredOn: '2026-07-17', manuallyConfirmed: true
    }, '5cac741a-205c-4c3b-a1d0-2ef90be74475', '営業担当')).toThrow(/after.*export/iu)

    const approved = approveLocalProposalDraft(draft, draft.contentHash, '営業担当')
    const exported = markProposalExported(approved, 'c'.repeat(64), new Date('2026-07-17T01:00:00.000Z'))
    expect(() => recordLocalProposalFollowUp(exported, {
      draftId: draft.id, expectedRevision: 0, stage: 'replied', occurredOn: '2026-07-17', manuallyConfirmed: true
    }, '5cac741a-205c-4c3b-a1d0-2ef90be74475', '営業担当')).toThrow(/confirmed external send/iu)

    const sent = recordLocalProposalFollowUp(exported, {
      draftId: draft.id, expectedRevision: 0, stage: 'sent', occurredOn: '2026-07-17',
      note: '翌営業日に状況確認', manuallyConfirmed: true
    }, '5cac741a-205c-4c3b-a1d0-2ef90be74475', '営業担当', new Date('2026-07-17T01:05:00.000Z'))
    expect(sent.draft.followUp).toMatchObject({ revision: 1, stage: 'sent', cloudEligible: false })
    expect(sent.event).toMatchObject({ note: '翌営業日に状況確認', recordedBy: '営業担当', cloudEligible: false })

    const accepted = recordLocalProposalFollowUp(sent.draft, {
      draftId: draft.id, expectedRevision: 1, stage: 'accepted', occurredOn: '2026-07-20', manuallyConfirmed: true
    }, 'e536183c-2a8f-420f-94df-bc3a00fb77fa', '営業担当')
    expect(accepted.draft.followUp.events.map((event) => event.stage)).toEqual(['sent', 'accepted'])
    expect(() => updateLocalProposalDraft(accepted.draft, {
      draftId: draft.id,
      revision: draft.revision,
      recipientTo: draft.recipientTo,
      recipientCc: draft.recipientCc,
      candidateDisplayName: draft.candidateDisplayName,
      subject: draft.subject,
      body: draft.body
    })).toThrow(/cannot be edited/iu)
    expect(() => recordLocalProposalFollowUp(exported, {
      draftId: draft.id, expectedRevision: 0, stage: 'sent', occurredOn: '2026-07-17',
      note: '連絡先 090-1234-5678', manuallyConfirmed: true
    }, '12a7c1ae-58fa-4bcc-bc4f-87e268a3788a', '営業担当')).toThrow(/direct identifiers/iu)
  })

  it('builds a verifiable exported-not-sent package without source documents', async () => {
    const draft = createLocalProposalDraft({
      taskId: 'proposal-task-001', jobCaseId: jobCase.id, candidateProfileId: candidate.id,
      recipientTo: 'bp@example.co.jp', recipientCc: [], candidateDisplayName: '候補者A', tone: 'standard'
    }, jobCase, candidate, 'a86b564b-34ad-4632-927e-47db14c56aaf')
    const html = proposalAttachmentHtml({
      ...draft,
      attachment: {
        ...draft.attachment,
        fields: [{ ...draft.attachment.fields[0]!, value: '<script>alert(1)</script>' }]
      }
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('決済基盤クラウド刷新')
    expect(html).not.toContain('Page 2')

    const proposalPackage = await buildProposalPackageZip(
      draft,
      Buffer.from('%PDF-1.7\nredacted-profile\n%%EOF', 'ascii'),
      new Date('2026-07-17T00:00:00.000Z')
    )
    const zip = await JSZip.loadAsync(proposalPackage.bytes)
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as {
      deliveryState: string
      privacy: { rawResumeIncluded: boolean; rawMailIncluded: boolean; attachmentRedacted: boolean }
    }
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['message.txt', draft.attachment.fileName, 'manifest.json']))
    expect(manifest).toMatchObject({
      deliveryState: 'exported-not-sent',
      privacy: { rawResumeIncluded: false, rawMailIncluded: false, attachmentRedacted: true }
    })
    expect(proposalPackage.packageHash).toMatch(/^[a-f0-9]{64}$/u)
  })
})
