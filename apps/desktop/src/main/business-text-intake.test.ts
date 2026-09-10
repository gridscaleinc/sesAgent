import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EncryptedFileVault, type StagedFileRecord } from '@files'
import type { EncryptedApplicationRepository } from '@persistence'
import { resumeAnalysisSummarySchema, type CandidateReviewSnapshot, type JobCaseReviewSnapshot } from '@shared'
import { autoConfirmJobCaseDraft, importChatPastedJobCaseText, importPastedCandidateText } from './business-text-intake'

const anonymizedCaseText = [
  '案件概要：物流系Webシステムの追加開発',
  '作業内容：詳細設計～結合テスト',
  '必須スキル：Java、Spring Boot',
  '単価：～60万円',
  '勤務地：大阪'
].join('\n')

const anonymizedCandidateText = [
  'イニシャル：Q.Z',
  '年齢：30代',
  '最寄駅：豊洲',
  '単金：62万',
  '日本語：N1',
  '希望：フルリモート',
  '連絡先：090-0000-1111'
].join('\n')

function jobCaseRepository(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    findJobCaseReviewByBusinessFingerprint: vi.fn(() => null),
    saveRedactedJobCaseSourceAndDraft: vi.fn(() => true),
    getJobCaseReview: vi.fn(() => ({ reviewId: 'review-1' } as unknown as JobCaseReviewSnapshot)),
    ...overrides
  } as unknown as EncryptedApplicationRepository
}

describe('importChatPastedJobCaseText', () => {
  it('clears only placeholder-only extracted fields and leaves mixed business content for normal validation', () => {
    const fields = [
      { key: 'title', value: 'COBOL 案件' },
      { key: 'notes', value: ' <NATIONALITY_001>\n<PERSON_NAME_002> ' },
      { key: 'required_skills', value: 'ホストCOBOL開発経験3年以上' },
      { key: 'preferred_skills', value: 'Java、<PERSON_NAME_003>' }
    ]
    const draft = { reviewId: 'review-1', reviewRevision: 1, fields } as JobCaseReviewSnapshot
    const confirmJobCaseReview = vi.fn<EncryptedApplicationRepository['confirmJobCaseReview']>(() => ({ ...draft, status: 'completed' as const }))
    autoConfirmJobCaseDraft({ confirmJobCaseReview }, draft, { operatorId: 'op-1', displayName: 'HR' })
    expect(confirmJobCaseReview.mock.calls[0]![0].fields).toEqual([
      { key: 'title', value: 'COBOL 案件', confirmed: true },
      { key: 'notes', value: null, confirmed: true, changeReason: 'Remove placeholder-only field after local redaction' },
      { key: 'required_skills', value: 'ホストCOBOL開発経験3年以上', confirmed: true },
      { key: 'preferred_skills', value: 'Java、<PERSON_NAME_003>', confirmed: true }
    ])
    expect(draft.fields).toEqual(fields)
  })

  it('creates one review draft for new text', async () => {
    const repository = jobCaseRepository()
    const result = await importChatPastedJobCaseText({ repository, localNer: null }, anonymizedCaseText)
    expect(result.outcome).toBe('created')
    expect(repository.saveRedactedJobCaseSourceAndDraft).toHaveBeenCalledTimes(1)
  })

  it('makes a new draft a valid case on the spot when an operator is known, and keeps what the store refuses for attention', async () => {
    const draft = { reviewId: 'review-1', reviewRevision: 1, status: 'awaiting-review', fields: [{ key: 'title', value: 'Java 案件' }] } as unknown as JobCaseReviewSnapshot
    const operator = { operatorId: 'op-1', displayName: 'HR' }
    const confirmed = { ...draft, status: 'completed' }
    const accepting = jobCaseRepository({ getJobCaseReview: vi.fn(() => draft), confirmJobCaseReview: vi.fn(() => confirmed) })
    const valid = await importChatPastedJobCaseText({ repository: accepting, localNer: null, operator }, anonymizedCaseText)
    expect(valid).toMatchObject({ outcome: 'created', validity: 'valid', attentionReason: null, review: { status: 'completed' } })
    expect(accepting.confirmJobCaseReview).toHaveBeenCalledWith(
      { reviewId: 'review-1', reviewRevision: 1, privacyReviewed: true, fields: [{ key: 'title', value: 'Java 案件', confirmed: true }] },
      'op-1', 'HR', expect.any(Date)
    )

    const refusing = jobCaseRepository({ getJobCaseReview: vi.fn(() => draft), confirmJobCaseReview: vi.fn(() => { throw new Error('案件名は必須です。') }) })
    const attention = await importChatPastedJobCaseText({ repository: refusing, localNer: null, operator }, anonymizedCaseText)
    expect(attention).toMatchObject({ outcome: 'created', validity: 'needs-attention', attentionReason: '案件名は必須です。', review: { status: 'awaiting-review' } })

    // No operator: the draft is left as it was, for callers that review elsewhere.
    const silent = await importChatPastedJobCaseText({ repository: jobCaseRepository({ getJobCaseReview: vi.fn(() => draft) }), localNer: null }, anonymizedCaseText)
    expect(silent).toMatchObject({ validity: 'unknown' })
  })

  it('returns the existing awaiting review for duplicate text without a second draft', async () => {
    const existing = { reviewId: 'review-1', status: 'awaiting-review', lifecycle: 'active' } as unknown as JobCaseReviewSnapshot
    const repository = jobCaseRepository({ findJobCaseReviewByBusinessFingerprint: vi.fn(() => existing) })
    const result = await importChatPastedJobCaseText({ repository, localNer: null }, anonymizedCaseText)
    expect(result.outcome).toBe('existing-review')
    expect(result.review).toBe(existing)
    expect(repository.saveRedactedJobCaseSourceAndDraft).not.toHaveBeenCalled()
  })

  it('reports an already confirmed duplicate without resurrecting a draft', async () => {
    const existing = { reviewId: 'review-1', status: 'completed', lifecycle: 'active' } as unknown as JobCaseReviewSnapshot
    const repository = jobCaseRepository({ findJobCaseReviewByBusinessFingerprint: vi.fn(() => existing) })
    const result = await importChatPastedJobCaseText({ repository, localNer: null }, anonymizedCaseText)
    expect(result.outcome).toBe('already-imported')
    expect(repository.saveRedactedJobCaseSourceAndDraft).not.toHaveBeenCalled()
  })

  it('reports an archived duplicate without restoring it', async () => {
    const existing = { reviewId: 'review-1', status: 'completed', lifecycle: 'archived' } as unknown as JobCaseReviewSnapshot
    const repository = jobCaseRepository({ findJobCaseReviewByBusinessFingerprint: vi.fn(() => existing) })
    const result = await importChatPastedJobCaseText({ repository, localNer: null }, anonymizedCaseText)
    expect(result.outcome).toBe('archived')
    expect(repository.saveRedactedJobCaseSourceAndDraft).not.toHaveBeenCalled()
  })

  it('lets verified cloud field values win over label-based ones and marks the draft as cloud-assisted', async () => {
    const repository = jobCaseRepository()
    await importChatPastedJobCaseText({ repository, localNer: null }, anonymizedCaseText, new Date(), {
      rate: '～60万円', location: '大阪', role: 'PM'
    })
    const draft = (vi.mocked(repository.saveRedactedJobCaseSourceAndDraft).mock.calls[0] as unknown[])[3] as {
      fields: Array<{ key: string; value: string | null; status: string; confidence: number }>
      warningCodes: string[]
    }
    const byKey = Object.fromEntries(draft.fields.map((field) => [field.key, field]))
    expect(byKey.rate).toMatchObject({ value: '～60万円', status: 'needs_review', confidence: 0.8 })
    expect(byKey.location).toMatchObject({ value: '大阪', status: 'needs_review' })
    expect(byKey.role).toMatchObject({ value: 'PM', status: 'needs_review' })
    // Keys without an override keep the local extraction.
    expect(byKey.required_skills?.value).toContain('Java')
    expect(draft.warningCodes).toContain('CLOUD_ASSISTED_FIELD_EXTRACTION')
  })
})

function candidateVault(): EncryptedFileVault {
  return new EncryptedFileVault({
    directory: mkdtempSync(join(tmpdir(), 'ses-intake-vault-')),
    key: Buffer.alloc(32, 7)
  })
}

function candidateRepository(overrides: Partial<Record<string, unknown>> = {}) {
  const stagedRecords: StagedFileRecord[] = []
  const repository = {
    findStagedTextSourceBySha256: vi.fn(() => null),
    getCandidateReview: vi.fn(() => ({
      documentId: 'document-1', status: 'awaiting-review', recordStatus: 'active'
    } as unknown as CandidateReviewSnapshot)),
    saveStagedFiles: vi.fn((files: StagedFileRecord[]) => {
      stagedRecords.push(...files)
    }),
    removeStagedFiles: vi.fn(),
    saveRedactionSession: vi.fn(),
    // Parsing here locks schema validity: the real store would reject what the
    // schemas reject.
    saveParsedDocument: vi.fn((_document: unknown, summary: unknown) => {
      resumeAnalysisSummarySchema.parse(summary)
    }),
    ...overrides
  } as unknown as EncryptedApplicationRepository
  return { repository, stagedRecords }
}

describe('importPastedCandidateText', () => {
  it('applies cloud field values only where they appear verbatim in the pasted text', async () => {
    const { repository } = candidateRepository()
    const result = await importPastedCandidateText(
      { repository, fileVault: candidateVault(), localNer: null },
      anonymizedCandidateText,
      new Date(),
      { rate: '62万', location: '豊洲', role: 'PM' }
    )
    expect(result.outcome).toBe('created')
    const extraction = (vi.mocked(repository.saveParsedDocument).mock.calls[0] as unknown[])[3] as {
      fields: Array<{ key: string; value: string | null; status: string; sources: Array<{ blockId: string }> }>
    }
    const byKey = Object.fromEntries(extraction.fields.map((field) => [field.key, field]))
    expect(byKey.rate).toMatchObject({ value: '62万', status: 'needs_review' })
    expect(byKey.rate?.sources[0]?.blockId).toBe('L4')
    expect(byKey.location).toMatchObject({ value: '豊洲', status: 'needs_review' })
    // 'PM' appears nowhere in the text: the local value stays.
    expect(byKey.role?.value).not.toBe('PM')
  })

  it('reads a prose Japanese-ability line and splits a place from its work style', async () => {
    const { repository } = candidateRepository()
    await importPastedCandidateText(
      { repository, fileVault: candidateVault(), localNer: null },
      ['職種: Laravel エンジニア', '経験年数: 4年', 'スキル: Laravel, PostgreSQL', '稼働: 2026年8月から稼働可', '勤務地条件: 大森常駐可', '日本語: 顧客定例、設計レビュー、課題整理に対応可能'].join('\n')
    )
    const extraction = (vi.mocked(repository.saveParsedDocument).mock.calls[0] as unknown[])[3] as {
      fields: Array<{ key: string; value: string | null }>
    }
    const byKey = Object.fromEntries(extraction.fields.map((field) => [field.key, field.value]))
    expect(byKey.japanese_level).toBe('顧客定例、設計レビュー、課題整理に対応可能')
    expect(byKey.location).toBe('大森')
    expect(byKey.work_style).toContain('常駐')
    expect(byKey.experience_years).toBe('4年')
  })

  it('stages the text as an encrypted txt source and creates one review', async () => {
    const { repository, stagedRecords } = candidateRepository()
    const result = await importPastedCandidateText({ repository, fileVault: candidateVault(), localNer: null }, anonymizedCandidateText)

    expect(result.outcome).toBe('created')
    expect(result.facts?.label).toMatch(/^TEXT_[0-9A-F]{4}$/u)
    expect(stagedRecords).toHaveLength(1)
    expect(stagedRecords[0]).toMatchObject({ format: 'txt' })
    expect(stagedRecords[0]!.name).toMatch(/^agent-paste-[0-9a-f]{8}\.txt$/u)
    expect(existsSync(stagedRecords[0]!.encryptedPath)).toBe(true)
    expect(repository.saveParsedDocument).toHaveBeenCalledTimes(1)
    // The initials stay - they are the anonymized display name by design - but
    // contact-grade PII must not survive into the locally stored preview.
    const summary = vi.mocked(repository.saveParsedDocument).mock.calls[0]?.[1]
    expect(JSON.stringify(summary)).not.toContain('090-0000-1111')
  })

  it('returns the existing review for identical text without staging again', async () => {
    const vault = candidateVault()
    const first = await candidateRepository()
    const record = (await vault.stageTrustedText('agent-paste-00000000.txt', anonymizedCandidateText))
    const review = { documentId: record.token, status: 'awaiting-review', recordStatus: 'active' } as unknown as CandidateReviewSnapshot
    const { repository, stagedRecords } = candidateRepository({
      findStagedTextSourceBySha256: vi.fn(() => record),
      getCandidateReview: vi.fn(() => review)
    })

    const result = await importPastedCandidateText({ repository, fileVault: vault, localNer: null }, anonymizedCandidateText)
    expect(result.outcome).toBe('existing-review')
    expect(result.review).toBe(review)
    expect(stagedRecords).toHaveLength(0)
    expect(repository.saveParsedDocument).not.toHaveBeenCalled()
    expect(first.stagedRecords).toHaveLength(0)
  })

  it('cleans an orphaned staging from a failed earlier run and imports again', async () => {
    const vault = candidateVault()
    const orphan = await vault.stageTrustedText('agent-paste-11111111.txt', anonymizedCandidateText)
    const { repository, stagedRecords } = candidateRepository({
      findStagedTextSourceBySha256: vi.fn(() => orphan),
      getCandidateReview: vi.fn((token: string) =>
        token === orphan.token
          ? null
          : ({ documentId: token, status: 'awaiting-review', recordStatus: 'active' } as unknown as CandidateReviewSnapshot))
    })

    const result = await importPastedCandidateText({ repository, fileVault: vault, localNer: null }, anonymizedCandidateText)
    expect(result.outcome).toBe('created')
    expect(repository.removeStagedFiles).toHaveBeenCalledWith([orphan.token])
    expect(existsSync(orphan.encryptedPath)).toBe(false)
    expect(stagedRecords).toHaveLength(1)
    expect(stagedRecords[0]!.token).not.toBe(orphan.token)
  })

  it('extracts intake labels through the full chain: initials name, start date, station, and preference-first work style', async () => {
    const { repository } = candidateRepository()
    const text = [
      // Full-width-space padding inside labels is the WeChat norm.
      'イニシャル　：Y.K',
      '性　別：男',
      '最寄駅：横浜',
      '開始日：9/1',
      '単　金：58万',
      '経歴：大手銀行に常駐して基盤運用を担当',
      '希望：フルリモート'
    ].join('\n')

    const result = await importPastedCandidateText({ repository, fileVault: candidateVault(), localNer: null }, text)
    expect(result.outcome).toBe('created')

    const summary = vi.mocked(repository.saveParsedDocument).mock.calls[0]?.[1] as {
      extractedFields: Array<{ key: string; value: string | null }>
      extractedProjectExperiences: unknown[]
    }
    const fieldValue = (key: string) => summary.extractedFields.find((field) => field.key === key)?.value
    expect(fieldValue('availability')).toBe('9/1')
    expect(fieldValue('rate')).toBe('58万')
    expect(fieldValue('location')).toBe('横浜')
    // The stated preference wins over 常駐 inside the experience line.
    expect(fieldValue('work_style')).toBe('フルリモート')
    // Plain descriptive text produces no fabricated project experiences.
    expect(summary.extractedProjectExperiences).toHaveLength(0)

    const extraction = vi.mocked(repository.saveParsedDocument).mock.calls[0]?.[3] as {
      localPersonalDetails: { displayName: string | null }
    }
    expect(extraction.localPersonalDetails.displayName).toBe('Y.K')
  })

  it('leaves no orphan staging behind when persistence fails', async () => {
    const vault = candidateVault()
    const { repository, stagedRecords } = candidateRepository({
      saveParsedDocument: vi.fn(() => {
        throw new Error('disk full')
      })
    })

    await expect(
      importPastedCandidateText({ repository, fileVault: vault, localNer: null }, anonymizedCandidateText)
    ).rejects.toThrow('disk full')
    expect(stagedRecords).toHaveLength(1)
    expect(repository.removeStagedFiles).toHaveBeenCalledWith([stagedRecords[0]!.token])
    expect(existsSync(stagedRecords[0]!.encryptedPath)).toBe(false)
  })
})
