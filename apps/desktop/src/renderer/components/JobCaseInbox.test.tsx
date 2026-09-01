import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import {
  jobCaseFieldKeys,
  type JobCaseDataDeletionReport,
  type JobCaseReviewSnapshot,
  type JobCaseVersionDetail,
  type DeleteJobCaseDataInput
} from '@shared'
import { JobCaseInbox } from './JobCaseInbox'

const labels = {
  title: '案件名',
  role: '募集ロール',
  required_skills: '必須スキル',
  rate: '単価',
  settlement: '精算',
  location: '勤務地',
  remote: 'リモート',
  start_date: '開始時期',
  working_hours: '勤務時間',
  japanese_level: '日本語',
  interview: '面談',
  contract_chain: '契約・商流',
  payment_terms: '支払条件',
  work_authorization: '就労資格',
  industry: '業界',
  preferred_skills: '尚可スキル',
  headcount: '募集人数',
  notes: '備考'
} as const

const values = {
  title: 'Java 決済基盤案件',
  role: 'バックエンドエンジニア',
  required_skills: 'Java / Spring Boot / AWS',
  rate: '85〜95万円/月',
  settlement: '140-180h',
  location: '品川',
  remote: '週3日リモート',
  start_date: '8月',
  working_hours: '9:00-18:00',
  japanese_level: 'N1相当',
  interview: '2回',
  contract_chain: 'エンド→元請→当社',
  payment_terms: '40日',
  work_authorization: '日本で就労可能',
  industry: '金融',
  preferred_skills: 'Kubernetes',
  headcount: '1名',
  notes: '面談は2回想定'
} as const

const review: JobCaseReviewSnapshot = {
  reviewId: '38dca6f6-947b-45d5-98bc-c9e6dcd242e9',
  sourceId: '9d774305-d8e5-4300-9a7a-4d3d6804ddf2',
  sourceType: 'gmail',
  providerMessageId: 'msg_001',
  threadId: 'thread_001',
  fromDomain: 'partner.example.jp',
  messageDate: '2026-07-17T00:00:00.000Z',
  redactedSubject: 'Java 決済基盤案件 <PERSON_NAME_001>',
  redactedPreview: 'Java 決済基盤案件 <PERSON_NAME_001>\n\n連絡先 <PHONE_001>',
  reviewRevision: 1,
  status: 'awaiting-review',
  privacyReviewed: false,
  fields: jobCaseFieldKeys.map((key) => ({
    key,
    label: labels[key],
    originalValue: values[key],
    value: values[key],
    confidence: 0.9,
    status: 'needs_review',
    sourceLabels: key === 'title' ? ['Gmail Subject'] : ['Gmail Body'],
    changed: false,
    changeReason: null
  })),
  warningCodes: ['SOURCE_CONTAINS_PII_PLACEHOLDERS', 'DETERMINISTIC_EXTRACTION_REQUIRES_REVIEW'],
  completedAt: null,
  reviewerDisplayName: null,
  jobCase: null,
  lifecycle: 'active',
  cloudEligible: false
}

const governanceProps = {
  gmailImportNotice: null,
  onImportEml: vi.fn().mockResolvedValue({ cancelled: true, importedCount: 0, duplicateCount: 0, skippedCount: 0, failedCount: 0, items: [] }),
  onDismissGmailImportNotice: vi.fn(),
  onLoadHistory: vi.fn().mockResolvedValue([]),
  onSetLifecycle: vi.fn(),
  onReopen: vi.fn(),
  onPreviewDeletion: vi.fn(),
  onDelete: vi.fn()
}

const completedReview: JobCaseReviewSnapshot = {
  ...review,
  status: 'completed',
  privacyReviewed: true,
  completedAt: '2026-07-17T01:00:00.000Z',
  reviewerDisplayName: '山田 太郎',
  fields: review.fields.map((field) => ({ ...field, status: 'confirmed' })),
  jobCase: {
    id: '8055be48-a08f-499d-9d82-c95a36018ad9',
    sourceReviewId: review.reviewId,
    version: 1,
    status: 'active',
    confirmedAt: '2026-07-17T01:00:00.000Z',
    confirmedBy: '山田 太郎',
    containsDirectIdentifiers: false
  }
}

const version: JobCaseVersionDetail = {
  id: completedReview.jobCase?.id ?? '',
  sourceReviewId: completedReview.reviewId,
  sourceId: completedReview.sourceId,
  sourceType: completedReview.sourceType,
  version: 1,
  reviewRevision: 1,
  status: 'active',
  fields: completedReview.fields.map((field) => ({
    key: field.key,
    label: field.label,
    value: field.value,
    sourceLabels: field.sourceLabels
  })),
  confirmedAt: '2026-07-17T01:00:00.000Z',
  confirmedBy: '山田 太郎',
  containsDirectIdentifiers: false
}

describe('JobCaseInbox', () => {
  it('executes a one-time ready Mac WeChat read and shows only non-sensitive capture evidence', async () => {
    const wechatReview: JobCaseReviewSnapshot = {
      ...review,
      reviewId: '7578b932-4e93-4dad-9fe0-27204593d235',
      sourceId: '2eef144c-4fc2-49f9-9131-4cf9e385cf6b',
      sourceType: 'wechat-visible',
      providerMessageId: null,
      threadId: '2eef144c-4fc2-49f9-9131-4cf9e385cf6b',
      fromDomain: null,
      redactedSubject: 'Java / AWS 案件',
      redactedPreview: '必須スキル：Java / AWS\n担当：<PERSON_NAME_001>'
    }
    const onReadWechat = vi.fn().mockResolvedValue({
      review: wechatReview,
      evidence: {
        captureMethod: 'screen-capture-kit-vision-ocr',
        visibleTextNodeCount: 4,
        rawUtf8Bytes: 45,
        truncated: false,
        rawTextPersisted: false,
        rawImagePersisted: false,
        networkAccess: false
      }
    })
    const onOpenLibrary = vi.fn()
    render(
      <JobCaseInbox
        {...governanceProps}
        mode="import"
        onCreateManual={vi.fn()}
        onOpenLibrary={onOpenLibrary}
        onReadWechat={onReadWechat}
        onSubmit={vi.fn()}
        reviews={[]}
        wechatVisibleMessage={{
          phase: 'B-03-1', gateStatus: 'go', platform: 'darwin', featureFlagEnabled: true,
          userFeatureAvailable: true, accessibilityTrusted: true, screenCaptureTrusted: true,
          rawTextNetworkIsolationVerified: true, evidenceVerified: false, targetVersion: '4.1.5',
          failureCodes: ['RELEASE_EVIDENCE_PENDING']
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /本次可視メッセージを読取/u }))
    expect(onReadWechat).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Vision OCR · 4節点')).toBeInTheDocument()
    expect(onOpenLibrary).toHaveBeenCalledWith(wechatReview.reviewId)
    expect(screen.queryByText('山田太郎')).not.toBeInTheDocument()
  })

  it('shows the Gmail sync outcome and keeps cloud processing explicitly off', () => {
    const onDismissGmailImportNotice = vi.fn()
    render(
      <JobCaseInbox
        {...governanceProps}
        gmailImportNotice={{
          syncedAt: '2026-07-20T01:00:00.000Z',
          storedMessages: 12,
          mode: 'incremental',
          discovered: 4,
          imported: 2,
          duplicates: 1,
          filtered: 1,
          failed: 0
        }}
        onCreateManual={vi.fn()}
        onDismissGmailImportNotice={onDismissGmailImportNotice}
        onSubmit={vi.fn()}
        reviews={[review]}
      />
    )

    expect(screen.getByRole('region', { name: 'Gmail同期結果' })).toHaveTextContent('2件取込')
    expect(screen.getByText(/Cloud LLMには送信していません/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Gmail同期結果を閉じる' }))
    expect(onDismissGmailImportNotice).toHaveBeenCalledTimes(1)
  })

  it('imports local EML files and explains the privacy boundary and per-file outcome', async () => {
    const emlReview: JobCaseReviewSnapshot = {
      ...review,
      reviewId: 'd18d7344-15c9-457f-a338-c6d0c47652c1',
      sourceId: 'fb81df82-86c1-438f-a133-491a60a97c18',
      sourceType: 'eml',
      providerMessageId: `eml_${'a'.repeat(64)}`,
      threadId: `emlt_${'b'.repeat(64)}`,
      warningCodes: ['EML_SOURCE_LOCAL_PARSE', 'EML_ATTACHMENTS_IGNORED']
    }
    const onImportEml = vi.fn().mockResolvedValue({
      cancelled: false,
      importedCount: 1,
      duplicateCount: 0,
      skippedCount: 1,
      failedCount: 1,
      items: [
        { fileName: 'java-case.eml', status: 'imported', classification: 'job-case', errorCode: null, review: emlReview },
        { fileName: 'candidate.eml', status: 'skipped', classification: 'candidate-proposal', errorCode: null, review: null },
        { fileName: 'broken.eml', status: 'failed', classification: null, errorCode: 'PARSE_FAILED', review: null }
      ]
    })
    render(<JobCaseInbox {...governanceProps} onCreateManual={vi.fn()} onImportEml={onImportEml} onSubmit={vi.fn()} reviews={[]} />)

    fireEvent.click(screen.getByRole('button', { name: 'EMLを取り込む' }))
    expect(onImportEml).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('region', { name: 'EML取込結果' })).toHaveTextContent('1件登録')
    expect(screen.getByText(/添付ファイルと元のEMLは保存していません/)).toBeInTheDocument()
    expect(screen.getByText(/candidate.eml：要員・候補者メールのため案件登録対象外/)).toBeInTheDocument()
    expect(screen.getByText(/broken.eml：安全に解析できませんでした/)).toBeInTheDocument()
  })

  it('provides a direct sales input window before the review workflow', async () => {
    const manualReview: JobCaseReviewSnapshot = {
      ...review,
      reviewId: '6273ef55-20a8-4b5f-b996-ef87a37c3bfb',
      sourceId: 'a86b564b-34ad-4632-927e-47db14c56aaf',
      sourceType: 'manual',
      providerMessageId: null,
      fromDomain: null
    }
    const onCreateManual = vi.fn().mockResolvedValue({ review: manualReview })
    render(<JobCaseInbox {...governanceProps} onCreateManual={onCreateManual} onSubmit={vi.fn()} reviews={[]} />)

    fireEvent.click(screen.getByRole('button', { name: '案件を手動追加' }))
    expect(screen.getByRole('dialog', { name: '案件情報を手動で追加' })).toBeInTheDocument()
    expect(screen.getByText('入力はまず端末内で脱敏されます')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '件名・案件名' }), { target: { value: 'Java 基盤案件' } })
    fireEvent.change(screen.getByRole('textbox', { name: '案件本文' }), { target: { value: '必須スキル：Java / AWS\n単価：90万円/月' } })
    fireEvent.click(screen.getByRole('button', { name: '脱敏して草稿を作成' }))

    expect(onCreateManual).toHaveBeenCalledWith({
      subject: 'Java 基盤案件',
      body: '必須スキル：Java / AWS\n単価：90万円/月'
    })
  })

  it('requires explicit field and privacy confirmation before creating a JobCase', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ review: { ...review, status: 'completed' } })
    render(<JobCaseInbox {...governanceProps} onCreateManual={vi.fn()} onSubmit={onSubmit} reviews={[review]} />)

    expect(screen.getByRole('heading', { name: '案件データベース' })).toBeInTheDocument()
    expect(screen.getByText('ローカル脱敏済みソース')).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: '案件を確定' })
    expect(submit).toBeDisabled()

    for (const checkbox of screen.getAllByLabelText('この値を確認')) fireEvent.click(checkbox)
    fireEvent.click(screen.getByLabelText(/案件項目に直接識別子がない/))
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      reviewId: review.reviewId,
      reviewRevision: 1,
      privacyReviewed: true,
      fields: expect.arrayContaining([
        expect.objectContaining({ key: 'required_skills', value: 'Java / Spring Boot / AWS', confirmed: true })
      ])
    }))
  })

  it('offers the source label of a hand-typed value as a field alias after confirmation', async () => {
    const unlabeled: JobCaseReviewSnapshot = {
      ...review,
      redactedPreview: 'Java 決済基盤案件\n\n作業期間: 8月\n必須スキル: Java / Spring Boot / AWS',
      fields: review.fields.map((field) => field.key === 'start_date' ? { ...field, originalValue: null, value: null, status: 'missing' } : field)
    }
    const onSubmit = vi.fn().mockResolvedValue({ review: { ...unlabeled, status: 'completed' } })
    const onSaveFieldAliases = vi.fn().mockResolvedValue({
      version: 'job-case-field-aliases-v1', aliases: { start_date: ['作業期間'] }, configured: true, revision: 1, updatedAt: '2026-08-26T00:00:00.000Z'
    })
    render(<JobCaseInbox {...governanceProps} onCreateManual={vi.fn()} onSaveFieldAliases={onSaveFieldAliases} onSubmit={onSubmit} reviews={[unlabeled]} />)

    fireEvent.change(screen.getByLabelText('開始時期'), { target: { value: '8月' } })
    fireEvent.change(screen.getByLabelText('開始時期の変更理由'), { target: { value: 'JDの作業期間から転記' } })
    for (const checkbox of screen.getAllByLabelText('この値を確認')) fireEvent.click(checkbox)
    fireEvent.click(screen.getByLabelText(/案件項目に直接識別子がない/))
    fireEvent.click(screen.getByRole('button', { name: '案件を確定' }))

    expect(await screen.findByText('「作業期間」→ 開始時期')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '別名として保存' }))
    await waitFor(() => expect(onSaveFieldAliases).toHaveBeenCalledWith({ aliases: { start_date: ['作業期間'] }, expectedRevision: null }))
    await waitFor(() => expect(screen.queryByText('「作業期間」→ 開始時期')).not.toBeInTheDocument())
  })

  it('opens the exact active review requested by the unified review center', async () => {
    const requestedReview: JobCaseReviewSnapshot = {
      ...review,
      reviewId: 'a7e97863-52fb-4aae-b32b-acde7957b814',
      sourceId: 'b0a65bf8-9b12-45a7-ad86-47558fa5f165',
      redactedSubject: 'COBOL 基幹刷新案件',
      fields: review.fields.map((field) => field.key === 'title'
        ? { ...field, originalValue: 'COBOL 基幹刷新案件', value: 'COBOL 基幹刷新案件' }
        : field)
    }
    const onSelectedReviewRequestHandled = vi.fn()
    render(
      <JobCaseInbox
        {...governanceProps}
        onCreateManual={vi.fn()}
        onSelectedReviewRequestHandled={onSelectedReviewRequestHandled}
        onSubmit={vi.fn()}
        reviews={[review, requestedReview]}
        selectedReviewRequestId={requestedReview.reviewId}
      />
    )

    expect(await screen.findByRole('heading', { name: 'COBOL 基幹刷新案件' })).toBeInTheDocument()
    expect(onSelectedReviewRequestHandled).toHaveBeenCalledTimes(1)
  })

  it('shows a privacy-safe completed case without the raw sender identity', () => {
    render(<JobCaseInbox {...governanceProps} onCreateManual={vi.fn()} onSubmit={vi.fn()} reviews={[completedReview]} />)

    expect(screen.getByRole('heading', { name: 'Java 決済基盤案件' })).toBeInTheDocument()
    expect(screen.getByText('個人識別子なし')).toBeInTheDocument()
    expect(screen.queryByText(/yamada@|090-/)).not.toBeInTheDocument()
  })

  it('opens deletion impact for an awaiting-review draft without confirming it first', async () => {
    const onPreviewDeletion = vi.fn().mockResolvedValue({
      reviewId: review.reviewId,
      sourceId: review.sourceId,
      title: review.redactedSubject,
      sourceType: review.sourceType,
      counts: { caseVersions: 0, reviewAudits: 0, taskRecords: 0, proposalDrafts: 0, evaluationDraftCases: 0, piiMappings: 2, sourceRecords: 1, gmailMessages: 1, agentReferences: { conversations: 1, messages: 1 } },
      confirmationHash: 'c'.repeat(64),
      warningCodes: ['GMAIL_SOURCE_TOMBSTONED_TO_PREVENT_REIMPORT']
    })
    render(
      <JobCaseInbox
        {...governanceProps}
        onCreateManual={vi.fn()}
        onPreviewDeletion={onPreviewDeletion}
        onSubmit={vi.fn()}
        reviews={[review]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '履歴・管理' }))
    expect(await screen.findByRole('dialog', { name: '案件の履歴と管理' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '案件をアーカイブ' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '削除前の影響を確認' }))

    expect(onPreviewDeletion).toHaveBeenCalledWith(review.reviewId)
    expect(await screen.findByText('JobCase 0バージョン')).toBeInTheDocument()
    expect(screen.getByText('Agent履歴参照 1会話 / 1メッセージ')).toBeInTheDocument()
  })

  it('opens version history and requires a reason before archiving a confirmed case', async () => {
    const archivedReview = { ...completedReview, lifecycle: 'archived' as const }
    const onLoadHistory = vi.fn().mockResolvedValue([version])
    const onSetLifecycle = vi.fn().mockResolvedValue({
      review: archivedReview,
      history: [{ ...version, status: 'archived' }]
    })
    render(
      <JobCaseInbox
        {...governanceProps}
        onCreateManual={vi.fn()}
        onLoadHistory={onLoadHistory}
        onSetLifecycle={onSetLifecycle}
        onSubmit={vi.fn()}
        reviews={[completedReview]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '履歴・管理' }))
    expect(await screen.findByRole('dialog', { name: '案件の履歴と管理' })).toBeInTheDocument()
    expect(await screen.findByText('Version 1')).toBeInTheDocument()
    const archive = screen.getByRole('button', { name: '案件をアーカイブ' })
    expect(archive).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '案件管理の理由' }), { target: { value: '募集終了のため' } })
    fireEvent.click(archive)

    expect(onSetLifecycle).toHaveBeenCalledWith({
      reviewId: completedReview.reviewId,
      state: 'archived',
      reason: '募集終了のため'
    })
  })

  it('shows deletion impact and requires typed confirmation', async () => {
    const onPreviewDeletion = vi.fn().mockResolvedValue({
      reviewId: completedReview.reviewId,
      sourceId: completedReview.sourceId,
      title: 'Java 決済基盤案件',
      sourceType: 'gmail',
      counts: { caseVersions: 1, reviewAudits: 13, taskRecords: 0, proposalDrafts: 0, evaluationDraftCases: 0, piiMappings: 2, sourceRecords: 1, gmailMessages: 1, agentReferences: { conversations: 0, messages: 0 } },
      confirmationHash: 'a'.repeat(64),
      warningCodes: ['GMAIL_SOURCE_TOMBSTONED_TO_PREVENT_REIMPORT']
    })
    const report: JobCaseDataDeletionReport = {
      id: '4ae4efb5-700d-47f7-837f-5bc150016116',
      entityType: 'job_case',
      entityIdHash: 'b'.repeat(64),
      requestedBy: '山田 太郎',
      startedAt: '2026-07-17T01:00:00.000Z',
      completedAt: '2026-07-17T01:00:01.000Z',
      outcome: 'completed',
      components: { database: 'deleted', fileVault: 'not_present', searchIndex: 'not_present', cache: 'not_present', temporaryFiles: 'not_present', backups: 'not_present' },
      deletedCounts: { caseVersions: 1, reviewAudits: 13, taskRecords: 0, proposalDrafts: 0, evaluationDraftCases: 0, piiMappings: 2, sourceRecords: 1, gmailMessages: 1, agentReferences: { conversations: 0, messages: 0 } },
      warningCodes: ['GMAIL_SOURCE_TOMBSTONED_TO_PREVENT_REIMPORT']
    }
    const onDelete = vi.fn().mockResolvedValue({ report })
    render(
      <JobCaseInbox
        {...governanceProps}
        onCreateManual={vi.fn()}
        onDelete={onDelete}
        onLoadHistory={vi.fn().mockResolvedValue([version])}
        onPreviewDeletion={onPreviewDeletion}
        onSubmit={vi.fn()}
        reviews={[completedReview]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '履歴・管理' }))
    await screen.findByRole('dialog', { name: '案件の履歴と管理' })
    fireEvent.click(screen.getByRole('button', { name: '削除前の影響を確認' }))
    expect(await screen.findByText('監査記録 13件')).toBeInTheDocument()
    const deleteButton = screen.getByRole('button', { name: '完全に削除' })
    expect(deleteButton).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '案件削除確認' }), { target: { value: '削除' } })
    fireEvent.click(deleteButton)

    expect(onDelete).toHaveBeenCalledWith({
      reviewId: completedReview.reviewId,
      confirmationHash: 'a'.repeat(64),
      confirmationText: '削除'
    })
    expect(await screen.findByLabelText('案件削除レポート')).toBeInTheDocument()
  })
  it('deletes every case through the same governed preview and typed confirmation', async () => {
    const second: JobCaseReviewSnapshot = { ...completedReview, reviewId: 'f0e1d2c3-b4a5-4968-8778-695a4b3c2d1e', redactedSubject: 'PHP 案件' }
    const counts = { caseVersions: 1, reviewAudits: 2, taskRecords: 0, proposalDrafts: 0, evaluationDraftCases: 0, piiMappings: 1, sourceRecords: 1, gmailMessages: 0, agentReferences: { conversations: 0, messages: 0 } }
    const onPreviewDeletion = vi.fn(async (reviewId: string) => ({
      reviewId, sourceId: `source-${reviewId}`, title: reviewId === review.reviewId ? 'Java 案件' : 'PHP 案件', sourceType: 'chat-paste' as const,
      counts, confirmationHash: (reviewId === review.reviewId ? 'a' : 'b').repeat(64), warningCodes: []
    }))
    const onDelete = vi.fn(async (input: DeleteJobCaseDataInput) => ({
      report: {
        id: `report-${input.reviewId}`, entityType: 'job_case' as const, entityIdHash: 'c'.repeat(64), requestedBy: 'HR',
        startedAt: '2026-08-26T01:00:00.000Z', completedAt: '2026-08-26T01:00:01.000Z', outcome: 'completed' as const,
        components: { database: 'deleted' as const, fileVault: 'not_present' as const, searchIndex: 'not_present' as const, cache: 'not_present' as const, temporaryFiles: 'not_present' as const, backups: 'not_present' as const },
        deletedCounts: counts, warningCodes: []
      }
    }))
    render(
      <JobCaseInbox
        {...governanceProps}
        onCreateManual={vi.fn()}
        onDelete={onDelete}
        onPreviewDeletion={onPreviewDeletion}
        onSubmit={vi.fn()}
        reviews={[review, second]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '全案件を削除' }))
    expect(await screen.findByRole('dialog', { name: 'すべての案件データを永久削除' })).toBeInTheDocument()
    // The aggregate of both previews, and both titles, before anything is deleted.
    expect(await screen.findByText('JobCase 2バージョン')).toBeInTheDocument()
    expect(screen.getByText('PHP 案件')).toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
    const deleteButton = screen.getByRole('button', { name: '完全に削除' })
    expect(deleteButton).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '全案件削除確認' }), { target: { value: '削除' } })
    fireEvent.click(deleteButton)

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(2))
    expect(onDelete).toHaveBeenNthCalledWith(1, { reviewId: review.reviewId, confirmationHash: 'a'.repeat(64), confirmationText: '削除' })
    expect(onDelete).toHaveBeenNthCalledWith(2, { reviewId: second.reviewId, confirmationHash: 'b'.repeat(64), confirmationText: '削除' })
    expect(await screen.findByText('2件の案件データを削除しました。')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'すべての案件データを永久削除' })).not.toBeInTheDocument()
  })

})
