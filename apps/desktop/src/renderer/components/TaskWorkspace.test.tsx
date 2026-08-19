import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createWorkTaskPreview, getDataScope, materializeWorkTask } from '@application'
import type { CandidateMatchResult, CandidateReviewSnapshot, ResumeAnalysisSummary } from '@shared'
import { TaskWorkspace } from './TaskWorkspace'

const proposalProps = {
  aiCommerce: {
    configuration: 'ready' as const,
    connection: 'not-connected' as const,
    productCode: 'sesAgent',
    billingMode: 'automatic' as const,
    memberDisplayName: null,
    accountId: null,
    accountAiTokenExpiresAt: null,
    wallet: null,
    capabilities: [],
    refreshedAt: null
  },
  proposalStatus: 'idle' as const,
  proposalWorkspace: null,
  proposalError: null,
  onCreateProposal: vi.fn(),
  onUpdateProposal: vi.fn(),
  onApproveProposal: vi.fn(),
  onExportProposal: vi.fn(),
  onRecordProposalFollowUp: vi.fn(),
  onSetTaskLifecycle: vi.fn(),
  onOpenCloudSettings: vi.fn(),
  onSendCloudPrompt: vi.fn(),
  candidateMatchRun: null,
  onSubmitCandidateMatchFeedback: vi.fn(),
  processingJob: null
}

describe('TaskWorkspace result routing', () => {
  it('opens resume imports as a candidate master workspace with local AI and evidence tabs', async () => {
    const fileToken = '8ce96c87-f896-43e1-b3f3-c459c55329ee'
    const task = materializeWorkTask(
      createWorkTaskPreview(
        '選択したスキルシートを安全に取り込み、候補者プロフィールを作成したい',
        getDataScope('selected-files'),
        [{ objectType: 'staged-file', objectId: fileToken, version: 'a'.repeat(64) }]
      ),
      'import-task-001',
      '2026-07-17T01:00:00.000Z'
    )
    task.status = 'awaiting_review'
    task.evidenceCount = 3
    const analyses: ResumeAnalysisSummary[] = [
      {
        analysisVersion: 'resume-analysis-v6',
        fileToken,
        fileName: 'candidate.pdf',
        status: 'requires-pii-review',
        cloudEligible: false,
        statistics: { pages: 1, sheets: 0, blocks: 4, characters: 98 },
        detectedIdentifiers: [
          { type: 'phone', count: 1 },
          { type: 'private_email', count: 1 }
        ],
        localProcessing: {
          ocr: 'apple-vision-completed',
          ocrPages: 1,
          personNameCandidates: 1,
          networkAccess: false
        },
        extractedFields: [
          {
            key: 'skills',
            label: 'スキル',
            value: 'Java, AWS',
            confidence: 0.9,
            status: 'needs_review',
            sourceLabels: ['Page 1']
          }
        ],
        warningCodes: [],
        redactedPreview: '[PAGE:1] Phone: <PHONE_001>\n[SHEET:Skills!B2…',
        analyzedAt: '2026-07-17T01:02:00.000Z'
      }
    ]
    const candidateReviews: CandidateReviewSnapshot[] = [
      {
        documentId: fileToken,
        fileName: 'candidate.pdf',
        reviewRevision: 1,
        status: 'awaiting-review',
        piiReviewed: false,
        fields: [
          {
            key: 'skills',
            label: 'スキル',
            originalValue: 'Java, AWS',
            value: 'Java, AWS',
            confidence: 0.9,
            status: 'needs_review',
            sourceLabels: ['Page 1'],
            changed: false,
            changeReason: null
          }
        ],
        projectExperiences: [],
        completedAt: null,
        reviewerDisplayName: null,
        profile: null,
        recruitingStatus: 'pending-review',
        talentPoolStatus: 'none',
        recordStatus: 'active'
      }
    ]
    const onLoadOriginalDocument = vi.fn().mockResolvedValue({
      version: 'original-document-preview-v1',
      documentId: fileToken,
      fileName: 'candidate.pdf',
      format: 'pdf',
      size: 4_096,
      sha256: 'f'.repeat(64),
      viewMode: 'pdf',
      previewUrl: null,
      sheets: [],
      pages: [{ pageNumber: 1, blocks: [{ text: 'Phone: 090-0000-0000', boundingBox: null }] }],
      paragraphs: [],
      personalFieldSources: {},
      storage: 'encrypted-local-vault',
      cloudEligible: false,
      originalFileAvailable: true
    })

    render(
      <TaskWorkspace
        {...proposalProps}
        analyses={analyses}
        candidateMatchError={null}
        candidateMatches={[]}
        candidateMatchQuery=""
        candidateMatchStatus="idle"
        candidateReviews={candidateReviews}
        onBack={vi.fn()}
        onLoadOriginalDocument={onLoadOriginalDocument}
        onOpenOriginalDocument={vi.fn().mockResolvedValue({ opened: true })}
        onSubmitCandidateReview={vi.fn()}
        processingJob={{
          id: 'd460068c-8a30-40fb-8268-93f6867518ee',
          type: 'resume-analysis',
          workTaskId: task.id,
          taskStepId: task.steps[1]!.id,
          status: 'running',
          replayPolicy: 'safe-local',
          progress: 65,
          attemptCount: 1,
          maxAttempts: 3,
          nextRetryAt: null,
          leaseExpiresAt: '2026-07-17T01:05:00.000Z',
          cancelRequestedAt: null,
          errorCode: null,
          createdAt: '2026-07-17T01:00:00.000Z',
          updatedAt: '2026-07-17T01:01:00.000Z'
        }}
        task={task}
      />
    )
    expect(screen.getByText('ローカル解析完了')).toBeInTheDocument()
    expect(screen.getByText(/人材マスタ/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'プロフィール概要' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('主要スキル')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'この人材に質問' })).toBeInTheDocument()
    expect(screen.getByText('確認済み構造化データを規則で検索・モデルもネットワークも不使用')).toBeInTheDocument()
    expect(screen.queryByText('candidate.pdf')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '主な強みは？' }))
    expect(screen.getByText(/主な強みはJava、AWS/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'スキルマトリクス · 2項目' }))
    expect(screen.getByRole('tab', { name: 'スキルマトリクス' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByDisplayValue('Java, AWS')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '原文比較' }))
    expect(await screen.findByText('原本とプロフィールを照合')).toBeInTheDocument()
    expect(onLoadOriginalDocument).toHaveBeenCalledWith(fileToken)
    expect(screen.getByText('Phone: 090-0000-0000')).toBeInTheDocument()
    expect(screen.queryByText(/\[PAGE:1\]/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\[SHEET:/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /データ確認/ }))
    expect(screen.getByText('解析と安全記録')).toBeInTheDocument()
    expect(screen.queryByText('d460068c-8a30-40fb-8268-93f6867518ee')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'インポート作業をキャンセル' }))
    await waitFor(() => expect(proposalProps.onSetTaskLifecycle).toHaveBeenCalledWith({
      taskId: task.id,
      action: 'cancel',
      expectedUpdatedAt: task.updatedAt
    }))
    expect(screen.queryByText('候補者 A-024')).not.toBeInTheDocument()
  })

  it('renders real confirmed-profile search results with field evidence and records human feedback', async () => {
    const task = materializeWorkTask(
      createWorkTaskPreview('JavaとAWS経験がある候補者を根拠付きで比較したい'),
      'match-task-001',
      '2026-07-17T01:00:00.000Z'
    )
    task.evidenceCount = 4
    const matches: CandidateMatchResult[] = [{
      id: '38dca6f6-947b-45d5-98bc-c9e6dcd242e9',
      sourceDocumentId: '5e910bbc-7aeb-4087-8130-4ff63ef8bd68',
      version: 1,
      status: 'current',
      confirmedAt: '2026-07-17T00:00:00.000Z',
      confirmedBy: '山田 太郎',
      containsDirectIdentifiers: false,
      anonymousLabel: '候補者 38DCA6F6',
      fields: [
        { key: 'skills', label: 'スキル', value: 'Java, Spring Boot, AWS', sourceLabels: ['Page 1'] },
        { key: 'experience_years', label: '経験年数', value: '7年', sourceLabels: ['Page 1'] },
        { key: 'work_style', label: '勤務形態', value: '週3日リモート', sourceLabels: ['Page 1'] },
        { key: 'rate', label: '希望単価', value: '85〜95万円/月', sourceLabels: ['Page 1'] },
        { key: 'location', label: '希望勤務地', value: '東京都内・品川通勤可', sourceLabels: ['Page 1'] },
        { key: 'work_authorization', label: '就労資格', value: '就労制限なし', sourceLabels: ['Page 1'] }
      ],
      matchScore: 95,
      matchedTerms: ['Java', 'AWS'],
      evidence: [{ key: 'skills', label: 'スキル', value: 'Java, Spring Boot, AWS', sourceLabels: ['Page 1'] }],
      projectExperiences: [{
        id: '2cb2d484-1895-401b-871a-dbe33a00dbb8',
        title: '決済基盤クラウド移行',
        period: '2023年4月〜2025年3月',
        role: 'PL',
        technologies: ['Java', 'AWS', 'Kubernetes'],
        summary: 'AWS移行の設計・構築と運用改善を担当',
        sourceLabels: ['Projects!A2']
      }],
      projectEvidence: {
        id: '2cb2d484-1895-401b-871a-dbe33a00dbb8',
        title: '決済基盤クラウド移行',
        period: '2023年4月〜2025年3月',
        role: 'PL',
        technologies: ['Java', 'AWS', 'Kubernetes'],
        summary: 'AWS移行の設計・構築と運用改善を担当',
        sourceLabels: ['Projects!A2'],
        matchType: 'hybrid',
        matchedTerms: ['Java', 'AWS'],
        vectorScore: 0.94
      },
      matchResultId: 'c605a5ee-7c9b-401c-8546-ae18c02b3a9f',
      matchResultHash: 'd'.repeat(64),
      feedback: null,
      retrieval: {
        strategy: 'hard-filter-hybrid-local-rerank-v1',
        hardFilterPolicyVersion: 'tri-state-v3',
        bm25Score: 2.18,
        vectorScore: 0.92,
        fusionScore: 0.032787,
        rerankerScore: 3.2841,
        bm25Rank: 1,
        vectorRank: 1,
        preRerankRank: 2,
        rerankerRank: 1,
        rank: 1,
        termCoverage: 100,
        indexedFieldCount: 6,
        hardFilters: [
          { type: 'minimum-experience-years', requested: '5年以上', actual: '7年', outcome: 'passed' },
          { type: 'availability-by', requested: '8月', actual: null, outcome: 'unknown' },
          { type: 'location', requested: '勤務地:品川', actual: '東京都内・品川通勤可', outcome: 'passed' },
          { type: 'work-authorization', requested: '就労資格:日本で就労可能', actual: '就労制限なし', outcome: 'passed' }
        ]
      }
    }]
    const run = {
      id: 'b39fd0c0-7c50-42a9-9f13-bb3a8ca17bf0',
      taskId: task.id,
      query: 'Java AWS',
      binding: null,
      algorithmVersion: 'hard-filter-hybrid-local-rerank-v1' as const,
      hardFilterPolicyVersion: 'tri-state-v3' as const,
      resultSetHash: 'c'.repeat(64),
      createdAt: '2026-07-17T01:00:00.000Z',
      evaluation: { resultCount: 1, feedbackCount: 0, suitableCount: 0, unsuitableCount: 0, coveragePercent: 0, judgedNdcgAt20: null, recallAt20: null, recallStatus: 'requires-known-relevant-total' as const }
    }
    const onSubmitCandidateMatchFeedback = vi.fn().mockResolvedValue({
      run: { ...run, evaluation: { ...run.evaluation, feedbackCount: 1, suitableCount: 1, coveragePercent: 100, judgedNdcgAt20: 1 } },
      matchResultId: matches[0]!.matchResultId,
      feedback: { decision: 'suitable', reasonCode: 'strong_project_fit', note: null, reviewerDisplayName: '山田 太郎', revision: 1, reviewedAt: '2026-07-17T01:01:00.000Z' }
    })

    render(
      <TaskWorkspace
        {...proposalProps}
        analyses={[]}
        candidateMatchError={null}
        candidateMatches={matches}
        candidateMatchRun={run}
        candidateMatchQuery="Java AWS 5年以上 8月 勤務地:品川 就労資格:日本で就労可能"
        candidateMatchStatus="ready"
        candidateReviews={[]}
        onBack={vi.fn()}
        onSubmitCandidateMatchFeedback={onSubmitCandidateMatchFeedback}
        onSubmitCandidateReview={vi.fn()}
        task={task}
      />
    )

    expect(screen.getByText('硬条件（不明は除外しない）→ BM25 + Profile/Project Vector → 候補者集約 → RRF → 端末内AI精査')).toBeInTheDocument()
    expect(screen.getByText('統合 Rank 1')).toBeInTheDocument()
    expect(screen.getByText('Rerank #1')).toBeInTheDocument()
    expect(screen.getByText('RRF #2')).toBeInTheDocument()
    expect(screen.getByText('Vector #1')).toBeInTheDocument()
    expect(screen.getByText('PROJECT EVIDENCE · HYBRID')).toBeInTheDocument()
    expect(screen.getByText('決済基盤クラウド移行')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '候補者 38DCA6F6' })).toBeInTheDocument()
    expect(screen.getByText('95%')).toBeInTheDocument()
    expect(screen.getByText('一致：Java · AWS')).toBeInTheDocument()
    expect(screen.getByText('確認済み · 7年')).toBeInTheDocument()
    expect(screen.getByText('確認済み · 東京都内・品川通勤可')).toBeInTheDocument()
    expect(screen.getByText('確認済み · 就労制限なし')).toBeInTheDocument()
    expect(screen.getByText('未確認 · 候補者資料に記載なし')).toBeInTheDocument()
    expect(screen.getByText('硬条件 未確認1件')).toBeInTheDocument()
    expect(screen.getByText('Hard Filter tri-state-v3')).toBeInTheDocument()
    expect(screen.getByText(/確認済み候補者プール · Page 1/)).toBeInTheDocument()
    expect(screen.getByText('Recall@20 は全量真値が揃うまで未算出')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '証跡 4' }))
    expect(screen.getByRole('region', { name: '検索ランキング証跡' })).toHaveTextContent('hard-filter-hybrid-local-rerank-v1')
    expect(screen.getByText('Result Set Hash')).toBeInTheDocument()
    expect(screen.getByText('出典：Projects · 2行（出典セル1件）')).toBeInTheDocument()
    expect(screen.getByText(/匿名結果 · Result Hash/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '統制' }))
    expect(screen.getByText('Rendererは範囲を拡大できない')).toBeInTheDocument()
    expect(screen.getByText('PII/DLPをバイパスできない')).toBeInTheDocument()
    expect(screen.getByText('自動送信')).toBeInTheDocument()
    expect(screen.getByText('実装なし')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '候補者 1' }))
    fireEvent.click(screen.getByRole('button', { name: '合適' }))
    fireEvent.change(screen.getByLabelText('候補者 38DCA6F6 の評価理由'), { target: { value: 'strong_project_fit' } })
    fireEvent.click(screen.getByRole('button', { name: '評価を保存' }))
    await waitFor(() => expect(onSubmitCandidateMatchFeedback).toHaveBeenCalledWith({
      matchResultId: matches[0]!.matchResultId,
      matchResultHash: matches[0]!.matchResultHash,
      expectedRevision: 0,
      decision: 'suitable',
      reasonCode: 'strong_project_fit'
    }))
    expect(await screen.findByText('合適 · 関連プロジェクト経験が強い')).toBeInTheDocument()
    expect(screen.queryByText(/開発サンプル|候補者 A-024/)).not.toBeInTheDocument()
  })
})
