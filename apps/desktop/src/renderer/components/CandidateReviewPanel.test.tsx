import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CandidateReviewSnapshot, ResumeAnalysisSummary, SubmitCandidateReviewResult } from '@shared'
import { CandidateReviewPanel } from './CandidateReviewPanel'

const fields: CandidateReviewSnapshot['fields'] = [
  ['skills', 'スキル', 'Java, AWS', 0.9],
  ['experience_years', '経験年数', '7年', 0.72],
  ['availability', '稼働時期', '8月から参画可能', 0.78],
  ['rate', '希望単価', '80～90万円/月', 0.75],
  ['japanese_level', '日本語レベル', 'N2', 0.8],
  ['work_style', '勤務形態', 'フルリモート', 0.78],
  ['role', '役割', 'SE', 0.72]
].map(([key, label, value, confidence]) => ({
  key: key as CandidateReviewSnapshot['fields'][number]['key'],
  label: label as string,
  originalValue: value as string,
  value: value as string,
  confidence: confidence as number,
  status: 'needs_review' as const,
  sourceLabels: ['Page 1'],
  changed: false,
  changeReason: null
}))

const review: CandidateReviewSnapshot = {
  documentId: 'f2af4f10-92d9-49ec-9c32-f2873a9c017f',
  fileName: 'candidate.pdf',
  reviewRevision: 1,
  status: 'awaiting-review',
  piiReviewed: false,
  localIdentity: {
    displayName: '候補者A',
    gender: null,
    birthDate: null,
    nationality: null,
    phone: null,
    email: null,
    address: null,
    education: null,
    major: null,
    graduationDate: null,
    degree: null,
    storage: 'encrypted-local-only',
    cloudEligible: false
  },
  fields,
  projectExperiences: [{
    draftId: 'project-001',
    title: '決済基盤刷新',
    period: '2022年4月〜2024年3月',
    role: 'PL',
    technologies: ['Java', 'AWS'],
    summary: '決済基盤の設計とクラウド移行を担当',
    confidence: 0.82,
    sourceLabels: ['Page 1'],
    changed: false,
    changeReason: null
  }],
  completedAt: null,
  reviewerDisplayName: null,
  profile: null,
  recruitingStatus: 'pending-review',
  talentPoolStatus: 'none',
  recordStatus: 'active'
}

const analysis: ResumeAnalysisSummary = {
  analysisVersion: 'resume-analysis-v6',
  fileToken: review.documentId,
  fileName: review.fileName,
  status: 'requires-pii-review',
  cloudEligible: false,
  statistics: { pages: 1, sheets: 0, blocks: 4, characters: 80 },
  detectedIdentifiers: [{ type: 'person_name', count: 1 }],
  localProcessing: { ocr: 'apple-vision-completed', ocrPages: 1, personNameCandidates: 1, networkAccess: false },
  extractedFields: fields.map((field) => ({
    key: field.key,
    label: field.label,
    value: field.value,
    confidence: field.confidence,
    status: 'needs_review',
    sourceLabels: field.sourceLabels
  })),
  warningCodes: ['PERSON_NAME_REVIEW_REQUIRED'],
  redactedPreview: '[PAGE:1] 候補者名: <PERSON_NAME_001>\n[PAGE:1] スキル: Java / AWS\n[PAGE:1] 希望単価: 80～90万円/月',
  analyzedAt: '2026-07-17T01:00:00.000Z'
}

describe('CandidateReviewPanel', () => {
  it('confirms a local candidate profile without granting talent-pool membership', async () => {
    const completed: CandidateReviewSnapshot = {
      ...review,
      status: 'completed',
      piiReviewed: true,
      completedAt: '2026-07-17T01:10:00.000Z',
      reviewerDisplayName: '山田 太郎',
      fields: review.fields.map((field) => ({ ...field, status: 'confirmed' })),
      profile: {
        id: '1f0ba44c-47d4-46d9-a779-8e29822f436f',
        sourceDocumentId: review.documentId,
        version: 1,
        status: 'current',
        confirmedAt: '2026-07-17T01:10:00.000Z',
        confirmedBy: '山田 太郎',
        containsDirectIdentifiers: false
      }
    }
    const result: SubmitCandidateReviewResult = { review: completed, updatedTasks: [] }
    const onSubmit = vi.fn().mockResolvedValue(result)
    render(<CandidateReviewPanel analysis={analysis} onSubmit={onSubmit} review={review} />)

    expect(screen.getByText('ローカル本人情報')).toBeInTheDocument()
    expect(screen.getByText('候補者A')).toBeInTheDocument()
    expect(screen.getByText((_, element) =>
      element?.tagName === 'PRE' && element.textContent?.includes('• スキル: Java / AWS') === true
    )).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('希望単価 の確認値'), { target: { value: '85～95万円/月' } })
    expect(screen.getByLabelText('希望単価 の修正メモ')).toBeInTheDocument()

    const submit = screen.getByRole('button', { name: '現在の内容で候補者プロフィールを確認' })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      documentId: review.documentId,
      reviewRevision: 1,
      piiReviewed: false,
      fields: expect.arrayContaining([
        expect.objectContaining({ key: 'rate', value: '85～95万円/月' })
      ]),
      projectExperiences: [expect.objectContaining({
        draftId: 'project-001', title: '決済基盤刷新', technologies: ['Java', 'AWS'], confirmed: true
      })]
    }))
  })

  it('renders immutable confirmation evidence after review completion', () => {
    const completed: CandidateReviewSnapshot = {
      ...review,
      status: 'completed',
      piiReviewed: true,
      completedAt: '2026-07-17T01:10:00.000Z',
      reviewerDisplayName: '山田 太郎',
      fields: review.fields.map((field) => ({ ...field, status: 'confirmed' })),
      profile: {
        id: '1f0ba44c-47d4-46d9-a779-8e29822f436f',
        sourceDocumentId: review.documentId,
        version: 1,
        status: 'current',
        confirmedAt: '2026-07-17T01:10:00.000Z',
        confirmedBy: '山田 太郎',
        containsDirectIdentifiers: false
      }
    }

    render(<CandidateReviewPanel analysis={analysis} onSubmit={vi.fn()} review={completed} />)
    expect(screen.getByRole('heading', { name: '候補者プロフィール確認済み' })).toBeInTheDocument()
    expect(screen.getByText('C-1F0BA44C')).toBeInTheDocument()
    expect(screen.getByText('確認済みプロジェクト経験')).toBeInTheDocument()
    expect(screen.getByText('決済基盤刷新')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('keeps the project change note optional', () => {
    render(<CandidateReviewPanel analysis={analysis} onSubmit={vi.fn()} review={review} />)
    fireEvent.change(screen.getByLabelText('プロジェクト 1 の名称'), { target: { value: '決済基盤クラウド刷新' } })
    expect(screen.getByLabelText('プロジェクト経験の変更メモ（任意）')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: '現在の内容で候補者プロフィールを確認' })
    expect(submit).toBeEnabled()
  })
})
