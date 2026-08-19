import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSampleTasks, createWorkTaskPreview, materializeWorkTask } from '@application'
import type { SignedWorkTaskPreview } from '@domain'
import type { BootstrapPayload, CandidateEvaluationState, DesktopApi } from '@shared'
import { App } from './App'

const bootstrap: BootstrapPayload = {
  appVersion: '0.1.0',
  environmentLabel: 'テスト',
  operatorProfile: {
    version: 'local-operator-profile-v1', operatorId: '11111111-1111-4111-8111-111111111111',
    displayName: '本機ユーザー', roleLabel: 'プロフィール未設定', configured: false,
    revision: null, updatedAt: null, cloudEligible: false
  },
  preferences: {
    version: 'local-application-preferences-v1', locale: 'ja-JP', configured: false,
    revision: null, updatedAt: null, cloudEligible: false
  },
  tasks: createSampleTasks('2026-07-17T01:00:00.000Z'),
  processingJobs: [],
  actionApprovals: [],
  resumeAnalyses: [],
  candidateReviews: [],
  candidateInterviews: [],
  jobCaseReviews: [],
  matchingHome: { state: 'onboarding', eligibleCandidateCount: 0, selectedJobCaseId: null, jobCases: [], currentRun: null },
  wechatVisibleMessage: {
    phase: 'B-03-1', gateStatus: 'no-go', platform: 'darwin', featureFlagEnabled: true,
    userFeatureAvailable: false, accessibilityTrusted: false, screenCaptureTrusted: false,
    rawTextNetworkIsolationVerified: false, evidenceVerified: false, targetVersion: null,
    failureCodes: ['MACOS_ACCESSIBILITY_PERMISSION_UNVERIFIED']
  },
  privacy: {
    policyVersion: 'cloud-redaction-v2',
    cloudGateway: 'enforced',
    localAi: 'vision-ocr-and-pii-active',
      qualityGate: {
        status: 'passed', datasetVersion: 'ses-privacy-regression-v1', syntheticOnly: true,
        caseCount: 28, identifierRecall: 1, redactionPrecision: 1,
        residualLeakCount: 0, safeCaseFalsePositiveCount: 0, appleNerVerified: true,
        reportHash: 'a'.repeat(64), failureCodes: []
      },
      expertGate: {
        status: 'not-verified', datasetVersion: null, humanLabeledDataset: true,
        sourceDocumentCount: 0, caseCount: 0, automaticPersonNameRecall: null,
        postReviewIdentifierRecall: null, redactionPrecision: null, reviewedAt: null, evaluatedAt: null,
        reportHash: null, attestationHash: null, privacyImplementationSha256: null,
        cloudEnforcementSha256: null, failureCodes: ['expert-report:missing']
    }
  },
  storage: {
    status: 'encrypted',
    engine: 'sqlcipher-compatible',
    keyProtection: 'macos-keychain',
    schemaVersion: 2
  },
  gmail: {
    provider: 'google-workspace',
    status: 'not-connected',
    configuration: 'required',
    workspaceDomain: null,
    accountEmail: null,
    grantedScopes: [],
    readAccess: false,
    draftAccess: 'not-requested',
    sendMethod: 'not-implemented'
  },
  googleWorkspaceConfiguration: null,
  googleWorkspaceAcceptance: null,
  gmailSync: {
    configuration: 'required',
    status: 'never',
    labelIds: [],
    query: null,
    lookbackDays: 30,
    checkpointHistoryId: null,
    storedMessages: 0,
    lastSyncedAt: null,
    lastRun: null,
    lastError: null
  },
  aiCommerce: {
    configuration: 'required', connection: 'not-connected', productCode: null, billingMode: null,
    memberDisplayName: null, accountId: null, accountAiTokenExpiresAt: null,
    wallet: null, capabilities: [], refreshedAt: null
  },
  recovery: {
    format: 'ses-recovery-v1',
    encryption: 'scrypt-aes-256-gcm',
    lastBackupAt: null,
    lastRestoreAt: null,
    pendingRestore: false,
    reminder: {
      status: 'not-needed', reason: null, currentDataRevision: 0, lastBackupDataRevision: null,
      latestDataChangedAt: null, snoozedUntil: null
    }
  },
  candidateEvaluation: { dataset: null, latestReport: null }
}

const evaluatedState: CandidateEvaluationState = {
  dataset: {
    id: 'd5a8372a-f701-4862-8f5d-4278c116fe3c',
    name: 'Tokyo SES Pilot v1',
    datasetHash: 'e'.repeat(64),
    caseCount: 30,
    relevantCandidates: 36,
    reviewerCount: 2,
    importedAt: '2026-07-20T00:00:00.000Z'
  },
  latestReport: {
    version: 'candidate-evaluation-report-v1',
    id: '1f7d8d53-2ced-4f90-8de4-2711a6af95aa',
    datasetId: 'd5a8372a-f701-4862-8f5d-4278c116fe3c',
    datasetHash: 'e'.repeat(64),
    status: 'passed',
    algorithmVersion: 'hard-filter-hybrid-rrf-v1',
    hardFilterPolicyVersion: 'tri-state-v3',
    modelId: 'Xenova/multilingual-e5-small',
    modelRevision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
    evaluatedAt: '2026-07-20T00:01:00.000Z',
    networkAccess: false,
    cloudUsed: false,
    metrics: { caseCount: 30, relevantCandidates: 36, retrievedRelevantCandidates: 34, recallAt20: 0.9444, ndcgAt20: 0.8123, expectedProjectEvidence: 20, matchedProjectEvidence: 18, projectEvidenceCoverageAt20: 0.9, missingCandidateReferences: 0 },
    thresholds: { minimumCases: 30, recallAt20: 0.9, ndcgAt20: 0.75, projectEvidenceCoverageAt20: 0.8 },
    cases: [{ caseId: 'case-1', queryHash: 'f'.repeat(64), relevantCandidates: 1, retrievedRelevantCandidates: 1, recallAt20: 1, ndcgAt20: 1, expectedProjectEvidence: 1, matchedProjectEvidence: 1, missingCandidateLabels: [] }]
  }
}

describe('App workbench', () => {
  beforeEach(() => {
    const preview: SignedWorkTaskPreview = {
      ...createWorkTaskPreview('JavaとAWS経験がある候補者を根拠付きで比較したい'),
      previewHash: 'a'.repeat(64)
    }
    const api: DesktopApi = {
      getStartupStatus: vi.fn().mockResolvedValue({ mode: 'normal' }),
      getBootstrap: vi.fn().mockResolvedValue(bootstrap),
      resolveActionApproval: vi.fn(),
      saveLocalOperatorProfile: vi.fn().mockImplementation(async (input) => ({
        version: 'local-operator-profile-v1', operatorId: '11111111-1111-4111-8111-111111111111',
        displayName: input.displayName, roleLabel: input.roleLabel, configured: true,
        revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', cloudEligible: false
      })),
      saveLocalApplicationPreferences: vi.fn().mockImplementation(async (input) => ({
        version: 'local-application-preferences-v1', locale: input.locale, configured: true,
        revision: 1, updatedAt: '2026-07-20T00:00:00.000Z', cloudEligible: false
      })),
      connectAiCommerce: vi.fn().mockResolvedValue(bootstrap.aiCommerce),
      getAiCommerceDashboard: vi.fn().mockResolvedValue(bootstrap.aiCommerce),
      disconnectAiCommerce: vi.fn().mockResolvedValue(bootstrap.aiCommerce),
      resetAiCommerceToken: vi.fn().mockResolvedValue(bootstrap.aiCommerce),
      openAiCommerceMemberCenter: vi.fn().mockResolvedValue({ opened: true }),
      prepareAiCommerceCloudPrompt: vi.fn(),
      executeAiCommerceCloudPrompt: vi.fn(),
      listAiConversations: vi.fn().mockResolvedValue([]),
      saveAiConversation: vi.fn(),
      deleteAiConversations: vi.fn().mockResolvedValue({ deletedConversationIds: [] }),
      executeAgentTurn: vi.fn(),
      cancelAgentTurn: vi.fn().mockResolvedValue({ status: 'not-running', conversationId: '', requestId: '' }),
      onAgentTurnEvent: vi.fn().mockReturnValue(() => undefined),
      onAiCommerceStateChanged: vi.fn().mockReturnValue(() => undefined),
      beginResumeImport: vi.fn().mockResolvedValue({ cancelled: true, task: null, files: [] }),
      stageDroppedResumeFiles: vi.fn().mockResolvedValue({ cancelled: false, task: null, files: [] }),
      analyzeResumeFile: vi.fn(),
      getCandidateReview: vi.fn().mockResolvedValue(null),
      submitCandidateReview: vi.fn(),
      createCandidateInterviewRound: vi.fn(),
      saveCandidateInterviewSchedule: vi.fn(),
      saveCandidateInterviewPreparation: vi.fn(),
      saveCandidateInterviewNotes: vi.fn(),
      recordCandidateInterviewDecision: vi.fn(),
      openZoomMeeting: vi.fn().mockResolvedValue({ opened: true }),
      openInterviewMeeting: vi.fn().mockResolvedValue({ opened: true }),
      openZoomTestMeeting: vi.fn().mockResolvedValue({ opened: true }),
      createManualJobCaseDraft: vi.fn(),
      createChatPasteJobCaseDraft: vi.fn(),
      prepareWechatVisibleRead: vi.fn(),
      executeWechatVisibleRead: vi.fn(),
      importEmlJobCaseDrafts: vi.fn(),
      submitJobCaseReview: vi.fn(),
      getJobCaseHistory: vi.fn().mockResolvedValue([]),
      setJobCaseLifecycle: vi.fn(),
      reopenJobCaseReview: vi.fn(),
      previewJobCaseDeletion: vi.fn(),
      deleteJobCaseData: vi.fn(),
      getProposalWorkspace: vi.fn().mockResolvedValue({ options: { jobCases: [], candidates: [] }, drafts: [], evidence: [] }),
      createProposalDraft: vi.fn(),
      updateProposalDraft: vi.fn(),
      approveProposalDraft: vi.fn(),
      exportProposalPackage: vi.fn(),
      recordProposalFollowUp: vi.fn(),
      searchCandidateProfiles: vi.fn().mockResolvedValue([]),
      executeCandidateMatchTask: vi.fn(),
      submitCandidateMatchFeedback: vi.fn(),
      setBusinessPriorityOverride: vi.fn().mockResolvedValue(bootstrap.matchingHome),
      importCandidateEvaluationBenchmark: vi.fn().mockResolvedValue({
        cancelled: true,
        state: { dataset: null, latestReport: null }
      }),
      getCandidateEvaluationAuthoringWorkspace: vi.fn().mockResolvedValue({ draft: null, jobCases: [], candidates: [] }),
      createCandidateEvaluationDraft: vi.fn(),
      saveCandidateEvaluationDraftCase: vi.fn(),
      deleteCandidateEvaluationDraftCase: vi.fn(),
      evaluateCandidateEvaluationDraft: vi.fn(),
      getCandidateProfileHistory: vi.fn().mockResolvedValue([]),
      getOriginalDocumentPreview: vi.fn(),
      openOriginalDocument: vi.fn(),
      updateCandidateProfile: vi.fn(),
      previewCandidateDeletion: vi.fn(),
      deleteCandidateData: vi.fn(),
      listDataDeletionReports: vi.fn().mockResolvedValue([]),
      connectGoogleWorkspace: vi.fn(),
      diagnoseGoogleWorkspace: vi.fn(),
      runGoogleWorkspaceOnlineAcceptance: vi.fn(),
      saveGoogleWorkspaceAdminConfiguration: vi.fn(),
      disconnectGoogleWorkspace: vi.fn(),
      syncGoogleWorkspace: vi.fn(),
      getRecoveryState: vi.fn().mockResolvedValue(bootstrap.recovery),
      createRecoveryPackage: vi.fn(),
      snoozeRecoveryReminder: vi.fn().mockResolvedValue(bootstrap.recovery),
      previewRecoveryPackage: vi.fn(),
      confirmRecovery: vi.fn(),
      restartApplication: vi.fn().mockResolvedValue({ restarting: true }),
      previewWorkTask: vi.fn().mockResolvedValue(preview),
      createWorkTask: vi.fn(),
      setWorkTaskLifecycle: vi.fn()
    }
    Object.defineProperty(window, 'sesAgent', { configurable: true, value: api })
    render(<App />)
  })

  it('imports a local SES benchmark and refreshes the quality gate', async () => {
    vi.mocked(window.sesAgent.importCandidateEvaluationBenchmark).mockResolvedValue({
      cancelled: false,
      state: evaluatedState
    })
    expect(await screen.findByText('候補者検索の品質門')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'JSONを読み込む' }))
    expect(await screen.findByText('品質門通過')).toBeInTheDocument()
    expect(screen.getByText('94.4%')).toBeInTheDocument()
  })

  it('keeps candidate management separate from the confirmed talent database', async () => {
    expect(await screen.findByRole('button', { name: '候補者' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '候補者' }))
    expect(await screen.findByRole('heading', { name: '候補者' })).toBeInTheDocument()
    expect(screen.getByText('候補者一覧（0）')).toBeInTheDocument()
    expect(screen.getByText('条件に合う候補者がいません')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '人材プール' })).toBeInTheDocument()
  })

  it('opens interview schedule as a neutral aggregate and returns there from an exact interview round', async () => {
    cleanup()
    const documentId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const interviewId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const scheduleBootstrap: BootstrapPayload = {
      ...bootstrap,
      preferences: { ...bootstrap.preferences, locale: 'zh-CN' },
      candidateReviews: [{
        documentId,
        fileName: 'candidate.xlsx',
        reviewRevision: 1,
        status: 'completed',
        piiReviewed: true,
        localIdentity: {
          displayName: '张伟', gender: null, birthDate: null, nationality: null, phone: null, email: null,
          address: null, education: null, major: null, graduationDate: null, degree: null,
          storage: 'encrypted-local-only', cloudEligible: false
        },
        fields: [
          { key: 'role', label: '角色', originalValue: 'Java 工程师', value: 'Java 工程师', confidence: 1, status: 'confirmed', sourceLabels: [], changed: false, changeReason: null },
          { key: 'skills', label: '技能', originalValue: 'Java, AWS', value: 'Java, AWS', confidence: 1, status: 'confirmed', sourceLabels: [], changed: false, changeReason: null }
        ],
        projectExperiences: [],
        completedAt: '2026-07-20T00:00:00.000Z',
        reviewerDisplayName: '李娜',
        profile: null,
        recruitingStatus: 'recruiting',
        talentPoolStatus: 'none',
        recordStatus: 'active'
      }],
      candidateInterviews: [{
        id: interviewId,
        sourceDocumentId: documentId,
        kind: 'recruiting',
        roundNumber: 1,
        parentInterviewId: null,
        stage: 'prepared',
        scheduledAt: '2026-07-24T01:00:00.000Z',
        durationMinutes: 60,
        meetingMethod: 'zoom',
        meetingUrl: 'https://company.zoom.us/j/1234567890',
        interviewer: '李娜',
        contactNote: null,
        interviewGoal: '确认项目经验',
        questionPlan: [{ id: 'standard-1', text: '请介绍项目经验。', source: 'standard', sourceLabel: '公司固定题', selected: true }],
        interviewNotes: null,
        unresolvedItems: [],
        decision: null,
        decisionReason: null,
        decidedAt: null,
        decidedBy: null,
        createdAt: '2026-07-20T00:00:00.000Z',
        updatedAt: '2026-07-20T00:00:00.000Z',
        updatedBy: '李娜',
        cloudEligible: false
      }]
    }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue(scheduleBootstrap)
    render(<App />)

    const interviewMenu = await screen.findByRole('button', { name: '面试管理' })
    if (interviewMenu.getAttribute('aria-expanded') !== 'true') fireEvent.click(interviewMenu)
    await waitFor(() => expect(screen.getByRole('button', { name: '面试管理' })).toHaveAttribute('aria-expanded', 'true'))
    fireEvent.click(await screen.findByRole('button', { name: /^面试日程/u }))
    expect(await screen.findByRole('main', { name: '面试日程中心' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '张伟' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '全部面试' }))
    fireEvent.click(await screen.findByRole('button', { name: /张伟/u }))
    expect(await screen.findByRole('heading', { name: '张伟' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回列表' }))
    expect(await screen.findByRole('main', { name: '面试日程中心' })).toBeInTheDocument()
  })

  it('does not poll the normal recovery IPC while the minimal startup recovery screen is active', async () => {
    cleanup()
    const getRecoveryState = vi.fn()
    Object.defineProperty(window, 'sesAgent', {
      configurable: true,
      value: {
        ...window.sesAgent,
        getStartupStatus: vi.fn().mockResolvedValue({
          mode: 'recovery-required',
          reason: 'key-unavailable',
          activeDataPreserved: true,
          networkAccess: false,
          message: 'テスト用の復元モードです。'
        }),
        getRecoveryState
      }
    })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'ローカルデータを開けません' })).toBeInTheDocument()
    await act(async () => { await Promise.resolve() })
    expect(getRecoveryState).not.toHaveBeenCalled()
  })

  it('renders the primary HR/sales interaction window and governance state', async () => {
    expect(await screen.findByRole('heading', { name: '業務ワークベンチ' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /履歴書をインポート/ }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /案件をインポート/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /AI マッチングを実行/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    const settings = await screen.findByRole('dialog', { name: '設定' })
    fireEvent.click(within(settings).getByRole('button', { name: /外部システム/ }))
    expect(within(settings).getByText('Google Workspace')).toBeInTheDocument()
    expect(within(settings).getByText('AICommerce Cloud AI')).toBeInTheDocument()
    fireEvent.click(within(settings).getByRole('button', { name: '接続設定' }))
    expect(await screen.findByRole('heading', { name: '会社 Gmail の管理者設定' })).toBeInTheDocument()
    expect(screen.getByText(/gmail.readonly のみ/)).toBeInTheDocument()
  })

  it('switches the display language to Simplified Chinese from local settings without a network action', async () => {
    fireEvent.click(await screen.findByRole('button', { name: '設定' }))
    const dialog = await screen.findByRole('dialog', { name: '設定' })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('radio', { name: /中文（简体）/ }))
    })

    await waitFor(() => expect(window.sesAgent.saveLocalApplicationPreferences).toHaveBeenCalledWith({
      locale: 'zh-CN', expectedRevision: null
    }))
    expect(await screen.findByRole('heading', { name: '业务工作台' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(window.sesAgent.getBootstrap).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /匹配 Java \/ Spring Boot \/ AWS 案件的候选人/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /准备支付平台案件的提案邮件草稿/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^活动记录\s*\d+$/ }))
    expect(await screen.findByRole('heading', { name: '活动记录' })).toBeInTheDocument()
    expect(screen.getByText('处理历史与证据')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '数据安全' }))
    expect(await screen.findByText('云端发送前脱敏')).toBeInTheDocument()
    expect(screen.getByText('候选人搜索质量门')).toBeInTheDocument()
    expect(screen.getByText('加密备份')).toBeInTheDocument()
    expect(screen.getByText('人工确认点')).toBeInTheDocument()
  })

  it('replaces the fake sidebar identity with an encrypted local operator profile', async () => {
    const profileButton = await screen.findByRole('button', { name: /本機ユーザー.*プロフィール未設定/ })
    fireEvent.click(profileButton)
    const dialog = await screen.findByRole('dialog', { name: '操作員プロフィール' })
    expect(within(dialog).getByText('プロフィールは送信対象外')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('表示名'), { target: { value: '佐藤 美咲' } })
    fireEvent.change(within(dialog).getByLabelText('役割'), { target: { value: 'SES営業担当' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '暗号化して保存' }))

    await waitFor(() => expect(window.sesAgent.saveLocalOperatorProfile).toHaveBeenCalledWith({
      displayName: '佐藤 美咲',
      roleLabel: 'SES営業担当',
      expectedRevision: null
    }))
    expect(await screen.findByRole('button', { name: /佐藤 美咲.*SES営業担当/ })).toBeInTheDocument()
    expect(screen.queryByText('山田 太郎')).not.toBeInTheDocument()
  })

  it('opens the local business command palette with Cmd+K and restores focus on Escape', async () => {
    const trigger = await screen.findByRole('button', { name: /コマンドを検索/ })
    trigger.focus()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
    })
    expect(await screen.findByRole('dialog', { name: '業務コマンド' })).toBeInTheDocument()
    const search = screen.getByRole('textbox', { name: '業務コマンドを検索' })
    await waitFor(() => expect(search).toHaveFocus())
    expect(screen.getByText('検索文字は端末内のみ・外部送信なし')).toBeInTheDocument()

    fireEvent.keyDown(search, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '業務コマンド' })).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('opens the manual HR case input directly from a searched business command', async () => {
    fireEvent.click(await screen.findByRole('button', { name: /コマンドを検索/ }))
    const search = await screen.findByRole('textbox', { name: '業務コマンドを検索' })
    fireEvent.change(search, { target: { value: '案件を手動' } })
    fireEvent.click(screen.getByRole('option', { name: /案件を手動で追加/ }))

    expect(await screen.findByRole('heading', { name: '案件をインポート' })).toBeInTheDocument()
    const dialog = await screen.findByRole('dialog', { name: '案件情報を手動で追加' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('入力はまず端末内で脱敏されます')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
    fireEvent.click(screen.getByRole('button', { name: 'ワークベンチ' }))
    fireEvent.click(screen.getByRole('button', { name: '案件DB' }))
    expect(screen.queryByRole('dialog', { name: '案件情報を手動で追加' })).not.toBeInTheDocument()
  })

  it('turns My Tasks and View All into a real resumable task center', async () => {
    await screen.findByRole('heading', { name: '業務ワークベンチ' })
    fireEvent.click(screen.getByRole('button', { name: 'すべて見る' }))
    expect(await screen.findByRole('heading', { name: 'アクティビティ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: new RegExp(`アクティビティ\\s*${bootstrap.tasks.length}`) })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('処理履歴と証跡')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: new RegExp(bootstrap.tasks[1]!.title) }))
    expect(await screen.findByRole('heading', { name: bootstrap.tasks[1]!.title })).toBeInTheDocument()
  })

  it('turns the sidebar review badge into an actionable local review center', async () => {
    await screen.findByRole('heading', { name: '業務ワークベンチ' })
    const reviewNavigation = screen.getByRole('button', { name: /レビューセンター\s*1/ })
    fireEvent.click(reviewNavigation)

    expect(await screen.findByRole('heading', { name: 'レビューセンター' })).toBeInTheDocument()
    expect(reviewNavigation).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('一覧には原文や直接識別子を複製しません')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '提案下書きの詳細を開く' }))
    expect(await screen.findByRole('heading', { name: bootstrap.tasks[1]!.title })).toBeInTheDocument()
  })

  it('routes the primary Gmail input through readonly sync into case review', async () => {
    await screen.findByRole('heading', { name: '業務ワークベンチ' })
    cleanup()
    const connected = {
      ...bootstrap,
      gmail: {
        provider: 'google-workspace' as const,
        status: 'readonly' as const,
        configuration: 'ready' as const,
        workspaceDomain: 'example.co.jp',
        accountEmail: 'sales@example.co.jp',
        grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
        readAccess: true,
        draftAccess: 'not-requested' as const,
        sendMethod: 'not-implemented' as const
      },
      gmailSync: {
        ...bootstrap.gmailSync,
        configuration: 'ready' as const,
        status: 'idle' as const,
        labelIds: ['Label_SES'],
        query: '案件 OR 募集'
      }
    }
    const synced = {
      ...connected,
      gmailSync: {
        ...connected.gmailSync,
        storedMessages: 3,
        lastSyncedAt: '2026-07-20T01:00:00.000Z',
        lastRun: {
          mode: 'incremental' as const,
          discovered: 3,
          imported: 2,
          duplicates: 1,
          filtered: 0,
          failed: 0
        }
      }
    }
    vi.mocked(window.sesAgent.getBootstrap).mockReset()
      .mockResolvedValueOnce(connected)
      .mockResolvedValue(synced)
    vi.mocked(window.sesAgent.syncGoogleWorkspace).mockResolvedValue(synced.gmailSync)
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '案件管理' }))
    fireEvent.click(screen.getByRole('button', { name: '案件取込' }))
    await screen.findByRole('button', { name: /Gmail から取り込む/ })
    fireEvent.click(screen.getByRole('button', { name: /Gmail から取り込む/ }))

    expect(await screen.findByRole('heading', { name: '案件データベース' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Gmail同期結果' })).toHaveTextContent('2件取込')
    expect(screen.getByText(/Cloud LLMには送信していません/)).toBeInTheDocument()
    expect(window.sesAgent.syncGoogleWorkspace).toHaveBeenCalledTimes(1)
  })

  it('opens data governance from the data policy navigation item', async () => {
    await screen.findByRole('heading', { name: '業務ワークベンチ' })

    fireEvent.click(screen.getByRole('button', { name: 'データセキュリティ' }))

    expect(screen.getByText('TASK CONTROL').closest('aside')).toHaveClass('is-responsive-open')
    expect(screen.getAllByRole('button', { name: 'データと承認パネルを閉じる' })).toHaveLength(2)
  })

  it('shows the required execution preview before task creation', async () => {
    await screen.findByRole('heading', { name: '業務ワークベンチ' })
    fireEvent.click(screen.getByRole('button', { name: 'AI マッチング' }))
    fireEvent.click(await screen.findByRole('button', { name: 'マッチングをプレビュー' }))
    expect(await screen.findByText('実行前プレビュー')).toBeInTheDocument()
    expect(screen.getByText('個人識別子をクラウドから遮断')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '確認して開始' })).toBeInTheDocument()
  })

  it('enters AgentWorkspace on cold start, with no navigation, when conversational matching is enabled', async () => {
    cleanup()
    const connected = {
      ...bootstrap,
      featureFlags: { conversationalMatchingEnabled: true },
      aiCommerce: { ...bootstrap.aiCommerce, configuration: 'ready' as const, connection: 'connected' as const }
    }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue(connected)
    render(<App />)
    expect(await screen.findByRole('heading', { name: '案件マッチング Agent' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '案件 Agent への質問' })).toBeEnabled()
  })

  it('carries the dashboard counts into the Agent shell and routes the review badge to the review center', async () => {
    cleanup()
    const connected = {
      ...bootstrap,
      featureFlags: { conversationalMatchingEnabled: true },
      aiCommerce: { ...bootstrap.aiCommerce, configuration: 'ready' as const, connection: 'connected' as const }
    }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue(connected)
    render(<App />)
    await screen.findByRole('heading', { name: '案件マッチング Agent' })
    // Same source as the sidebar badge, so the two can never disagree.
    const pendingReviews = screen.getByRole('button', { name: /1\s*未レビュー/u })
    fireEvent.click(pendingReviews)
    expect(await screen.findByRole('heading', { name: 'レビューセンター' })).toBeInTheDocument()
  })

  it('keeps the classic dashboard on cold start when conversational matching is disabled', async () => {
    cleanup()
    const disabled = { ...bootstrap, featureFlags: { conversationalMatchingEnabled: false } }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue(disabled)
    render(<App />)
    await screen.findByRole('button', { name: 'AI マッチング' })
    expect(screen.queryByRole('heading', { name: '案件マッチング Agent' })).not.toBeInTheDocument()
  })

  it('lands an unconnected operator in AgentWorkspace but withholds the composer until the managed account is connected', async () => {
    cleanup()
    const unconnected = {
      ...bootstrap,
      featureFlags: { conversationalMatchingEnabled: true },
      aiCommerce: { ...bootstrap.aiCommerce, connection: 'not-connected' as const }
    }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue(unconnected)
    render(<App />)
    expect(await screen.findByRole('heading', { name: '案件マッチング Agent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '受管アカウントに接続' })).toBeInTheDocument()
    // A composer that always fails is worse than no composer.
    expect(screen.queryByRole('textbox', { name: '案件 Agent への質問' })).not.toBeInTheDocument()
  })

  it('opens AgentWorkspace from the matching nav item and keeps an explicit classic fallback', async () => {
    cleanup()
    const enabledBootstrap = { ...bootstrap, featureFlags: { conversationalMatchingEnabled: true } }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue(enabledBootstrap)
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'AI マッチング' }))
    expect(await screen.findByRole('heading', { name: '案件マッチング Agent' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'マッチングをプレビュー' })).not.toBeInTheDocument()

    cleanup()
    const disabledBootstrap = { ...bootstrap, featureFlags: { conversationalMatchingEnabled: false } }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue(disabledBootstrap)
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'AI マッチング' }))
    expect(await screen.findByRole('button', { name: 'マッチングをプレビュー' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '案件マッチング Agent' })).not.toBeInTheDocument()
  })

  it('opens the local confirmed-candidate library from the primary navigation', async () => {
    vi.mocked(window.sesAgent.searchCandidateProfiles).mockResolvedValue([
      {
        id: '38dca6f6-947b-45d5-98bc-c9e6dcd242e9',
        sourceDocumentId: '5e910bbc-7aeb-4087-8130-4ff63ef8bd68',
        version: 1,
        status: 'current',
        confirmedAt: '2026-07-17T00:00:00.000Z',
        confirmedBy: '山田 太郎',
        containsDirectIdentifiers: false,
        anonymousLabel: '候補者 38DCA6F6',
        fields: [{ key: 'skills', label: 'スキル', value: 'Java, AWS', sourceLabels: ['Skills!A2'] }],
        matchScore: null,
        matchedTerms: [],
        evidence: [],
        projectExperiences: [],
        projectEvidence: null,
        retrieval: { strategy: 'hard-filter-bm25-v1', hardFilterPolicyVersion: 'tri-state-v3', bm25Score: null, vectorScore: null, fusionScore: null, rerankerScore: null, bm25Rank: null, vectorRank: null, preRerankRank: null, rerankerRank: null, rank: null, termCoverage: null, indexedFieldCount: 1, hardFilters: [] }
      }
    ])
    vi.mocked(window.sesAgent.getCandidateProfileHistory).mockResolvedValue([
      {
        id: '38dca6f6-947b-45d5-98bc-c9e6dcd242e9',
        sourceDocumentId: '5e910bbc-7aeb-4087-8130-4ff63ef8bd68',
        version: 1,
        status: 'current',
        confirmedAt: '2026-07-17T00:00:00.000Z',
        confirmedBy: '山田 太郎',
        containsDirectIdentifiers: false,
        reviewRevision: 1,
        fields: [{ key: 'skills', label: 'スキル', value: 'Java, AWS', sourceLabels: ['Skills!A2'] }],
        projectExperiences: []
      }
    ])
    await screen.findByRole('heading', { name: '業務ワークベンチ' })
    fireEvent.click(screen.getByRole('button', { name: '人材プール' }))
    expect(await screen.findByRole('heading', { name: '人材プール' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '候補者 38DCA6F6' })).toBeInTheDocument()
    expect(screen.getByText('硬条件三態（不明は除外しない）→ BM25 + Profile/Project Vector → RRF → Local AI Rerank')).toBeInTheDocument()
    expect(window.sesAgent.searchCandidateProfiles).toHaveBeenCalledWith({ query: '', maxResults: 30 })
    fireEvent.click(screen.getByRole('button', { name: '完全なプロフィールを見る' }))
    expect(await screen.findByRole('main', { name: '人材プロフィール詳細' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /バージョン履歴/ }))
    expect(screen.getByText('Version 1')).toBeInTheDocument()
    expect(window.sesAgent.getCandidateProfileHistory).toHaveBeenCalledWith('5e910bbc-7aeb-4087-8130-4ff63ef8bd68')
  })

  it('opens the Gmail-derived case review inbox from the primary navigation', async () => {
    await screen.findByRole('heading', { name: '業務ワークベンチ' })
    fireEvent.click(screen.getByRole('button', { name: '案件管理' }))
    fireEvent.click(screen.getByRole('button', { name: '案件DB' }))
    expect(await screen.findByRole('heading', { name: '案件データベース' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '案件候補はまだありません' })).toBeInTheDocument()
    expect(screen.getByText('すべての経路でローカル脱敏後にのみ案件候補になります')).toBeInTheDocument()
  })

  it('executes and persists a candidate-match task through the main-process use case', async () => {
    const task = bootstrap.tasks.find((item) => item.type === 'MATCH_CANDIDATES')!
    const updatedTask = {
      ...task,
      status: 'awaiting_review' as const,
      progress: 85,
      evidenceCount: 1,
      steps: task.steps.map((step, index) => ({ ...step, status: index < 3 ? 'completed' as const : 'blocked' as const }))
    }
    vi.mocked(window.sesAgent.executeCandidateMatchTask).mockResolvedValue({
      task: updatedTask,
      query: 'Java AWS',
      run: {
        id: 'b39fd0c0-7c50-42a9-9f13-bb3a8ca17bf0',
        taskId: task.id,
        query: 'Java AWS',
        binding: null,
        algorithmVersion: 'hard-filter-hybrid-rrf-v1',
        hardFilterPolicyVersion: 'tri-state-v3',
        resultSetHash: 'c'.repeat(64),
        createdAt: '2026-07-17T01:00:00.000Z',
        evaluation: { resultCount: 1, feedbackCount: 0, suitableCount: 0, unsuitableCount: 0, coveragePercent: 0, judgedNdcgAt20: null, recallAt20: null, recallStatus: 'requires-known-relevant-total' }
      },
      processingJob: {
        id: 'b18a5b58-d4bb-42a5-ae0c-03767f2e09e6',
        type: 'candidate-match',
        workTaskId: task.id,
        taskStepId: task.steps[1]!.id,
        status: 'succeeded',
        replayPolicy: 'safe-local',
        progress: 100,
        attemptCount: 1,
        maxAttempts: 3,
        nextRetryAt: null,
        leaseExpiresAt: null,
        cancelRequestedAt: null,
        errorCode: null,
        createdAt: '2026-07-17T01:00:00.000Z',
        updatedAt: '2026-07-17T01:00:01.000Z'
      },
      matches: [{
        id: '38dca6f6-947b-45d5-98bc-c9e6dcd242e9',
        sourceDocumentId: '5e910bbc-7aeb-4087-8130-4ff63ef8bd68',
        version: 1,
        status: 'current',
        confirmedAt: '2026-07-17T00:00:00.000Z',
        confirmedBy: '山田 太郎',
        containsDirectIdentifiers: false,
        anonymousLabel: '候補者 38DCA6F6',
        fields: [{ key: 'skills', label: 'スキル', value: 'Java, AWS', sourceLabels: ['Page 1'] }],
        matchScore: 95,
        matchedTerms: ['Java', 'AWS'],
        evidence: [{ key: 'skills', label: 'スキル', value: 'Java, AWS', sourceLabels: ['Page 1'] }],
        projectExperiences: [],
        projectEvidence: null,
        matchResultId: 'c605a5ee-7c9b-401c-8546-ae18c02b3a9f',
        matchResultHash: 'd'.repeat(64),
        feedback: null,
        retrieval: { strategy: 'hard-filter-hybrid-rrf-v1', hardFilterPolicyVersion: 'tri-state-v3', bm25Score: 1.94, vectorScore: 0.91, fusionScore: 0.032787, rerankerScore: null, bm25Rank: 1, vectorRank: 1, preRerankRank: null, rerankerRank: null, rank: 1, termCoverage: 100, indexedFieldCount: 1, hardFilters: [] }
      }]
    })
    vi.mocked(window.sesAgent.submitCandidateMatchFeedback).mockResolvedValue({
      run: {
        id: 'b39fd0c0-7c50-42a9-9f13-bb3a8ca17bf0',
        taskId: task.id,
        query: 'Java AWS',
        binding: null,
        algorithmVersion: 'hard-filter-hybrid-rrf-v1',
        hardFilterPolicyVersion: 'tri-state-v3',
        resultSetHash: 'c'.repeat(64),
        createdAt: '2026-07-17T01:00:00.000Z',
        evaluation: { resultCount: 1, feedbackCount: 1, suitableCount: 1, unsuitableCount: 0, coveragePercent: 100, judgedNdcgAt20: 1, recallAt20: null, recallStatus: 'requires-known-relevant-total' }
      },
      matchResultId: 'c605a5ee-7c9b-401c-8546-ae18c02b3a9f',
      feedback: { decision: 'suitable', reasonCode: 'strong_project_fit', note: null, reviewerDisplayName: '山田 太郎', revision: 1, reviewedAt: '2026-07-17T01:01:00.000Z' }
    })

    await screen.findByRole('heading', { name: '業務ワークベンチ' })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(task.title) }))
    expect(await screen.findByRole('heading', { name: '候補者 38DCA6F6' })).toBeInTheDocument()
    expect(screen.getByText('統合 Rank 1')).toBeInTheDocument()
    expect(window.sesAgent.executeCandidateMatchTask).toHaveBeenCalledWith(task.id)
    expect(screen.getByText('確認済み候補者プールを検索しました')).toBeInTheDocument()
    expect(screen.getByText('PROCESSING JOB')).toBeInTheDocument()
    expect(screen.getByText('試行 1 / 3 · 端末内で安全に再開可能')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '合適' }))
    fireEvent.change(screen.getByLabelText('候補者 38DCA6F6 の評価理由'), { target: { value: 'strong_project_fit' } })
    fireEvent.click(screen.getByRole('button', { name: '評価を保存' }))
    expect(await screen.findByText('合適 · 関連プロジェクト経験が強い')).toBeInTheDocument()
    expect(screen.getByText('Coverage 100%')).toBeInTheDocument()
    expect(window.sesAgent.submitCandidateMatchFeedback).toHaveBeenCalledWith({
      matchResultId: 'c605a5ee-7c9b-401c-8546-ae18c02b3a9f',
      matchResultHash: 'd'.repeat(64),
      expectedRevision: 0,
      decision: 'suitable',
      reasonCode: 'strong_project_fit'
    })
  })

  it('keeps cancellation side-effect free and does not expose a resume-import sidebar route', async () => {
    await screen.findByRole('heading', { name: '業務ワークベンチ' })
    expect(screen.queryByRole('button', { name: '履歴書取込' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '履歴書をすぐ取込' }))
    await waitFor(() => expect(window.sesAgent.beginResumeImport).toHaveBeenCalledTimes(1))
    expect(window.sesAgent.analyzeResumeFile).not.toHaveBeenCalled()
    expect(window.sesAgent.createWorkTask).not.toHaveBeenCalled()
  })

  it('shows file-by-file progress and continues the remaining batch after one local analysis failure', async () => {
    const stagedFile = {
      token: '38dca6f6-947b-45d5-98bc-c9e6dcd242e9',
      name: 'failed.pdf',
      format: 'pdf' as const,
      size: 2048,
      sha256: 'b'.repeat(64),
      createdAt: '2026-07-17T01:00:00.000Z',
      privacyStatus: 'awaiting-local-scan' as const
    }
    const secondFile = { ...stagedFile, token: '48dca6f6-947b-45d5-98bc-c9e6dcd242e9', name: 'ready.pdf', sha256: 'c'.repeat(64) }
    const task = {
      ...materializeWorkTask(
        createWorkTaskPreview('選択した履歴書を安全に取り込みたい'),
        'resume-import-test-task',
        '2026-07-17T01:00:00.000Z'
      ),
      contextBindings: [
        { objectType: 'staged-file' as const, objectId: stagedFile.token, version: stagedFile.sha256 },
        { objectType: 'staged-file' as const, objectId: secondFile.token, version: secondFile.sha256 }
      ]
    }
    vi.mocked(window.sesAgent.beginResumeImport).mockResolvedValue({ cancelled: false, task, files: [stagedFile, secondFile] })
    vi.mocked(window.sesAgent.analyzeResumeFile)
      .mockRejectedValueOnce(new Error('PDF を解析できませんでした。'))
      .mockResolvedValueOnce({
        task,
        analysis: {
          analysisVersion: 'resume-analysis-v6', fileToken: secondFile.token, fileName: secondFile.name,
          status: 'requires-pii-review', cloudEligible: false, statistics: { pages: 1, sheets: 0, blocks: 1, characters: 10 },
          detectedIdentifiers: [], localProcessing: { ocr: 'not-required', ocrPages: 0, personNameCandidates: 0, networkAccess: false },
          extractedFields: [], warningCodes: [], redactedPreview: '', analyzedAt: '2026-07-20T00:00:00.000Z'
        },
        processingJob: { id: '58dca6f6-947b-45d5-98bc-c9e6dcd242e9', type: 'resume-analysis', workTaskId: task.id, taskStepId: 'step-1', status: 'succeeded', replayPolicy: 'safe-local', progress: 100, attemptCount: 1, maxAttempts: 3, nextRetryAt: null, leaseExpiresAt: null, cancelRequestedAt: null, errorCode: null, createdAt: task.createdAt, updatedAt: task.updatedAt }
      })
    await screen.findByRole('heading', { name: '業務ワークベンチ' })
    fireEvent.click(screen.getByRole('button', { name: '履歴書をすぐ取込' }))
    expect(await screen.findByRole('dialog', { name: '履歴書取込の進捗' })).toBeInTheDocument()
    await waitFor(() => expect(window.sesAgent.analyzeResumeFile).toHaveBeenNthCalledWith(2, {
      fileToken: secondFile.token, taskId: task.id
    }))
    expect(screen.getByText('failed.pdf')).toBeInTheDocument()
    expect(screen.getByText('ready.pdf')).toBeInTheDocument()
    expect(await screen.findByText('プロフィール確認待ち')).toBeInTheDocument()
    expect(screen.getByText(/PDF を解析できませんでした/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '失敗詳細' })).toBeInTheDocument()
  })

  it('resumes a planned import with missing analyses when its activity is reopened', async () => {
    cleanup()
    const fileToken = '68dca6f6-947b-45d5-98bc-c9e6dcd242e9'
    const task = {
      ...materializeWorkTask(
        createWorkTaskPreview('選択した履歴書を安全に取り込みたい'),
        'resume-import-recovery-task',
        '2026-07-17T01:00:00.000Z'
      ),
      contextBindings: [{ objectType: 'staged-file' as const, objectId: fileToken, version: 'd'.repeat(64) }]
    }
    const recoveryBootstrap = { ...bootstrap, tasks: [task], resumeAnalyses: [], candidateReviews: [], processingJobs: [] }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue(recoveryBootstrap)
    vi.mocked(window.sesAgent.analyzeResumeFile).mockResolvedValue({
      task,
      analysis: {
        analysisVersion: 'resume-analysis-v6', fileToken, fileName: 'recovered.pdf',
        status: 'requires-pii-review', cloudEligible: false, statistics: { pages: 1, sheets: 0, blocks: 1, characters: 10 },
        detectedIdentifiers: [], localProcessing: { ocr: 'not-required', ocrPages: 0, personNameCandidates: 0, networkAccess: false },
        extractedFields: [], warningCodes: [], redactedPreview: '', analyzedAt: '2026-07-20T00:00:00.000Z'
      },
      processingJob: {
        id: '78dca6f6-947b-45d5-98bc-c9e6dcd242e9', type: 'resume-analysis', workTaskId: task.id,
        taskStepId: 'step-1', status: 'succeeded', replayPolicy: 'safe-local', progress: 100,
        attemptCount: 1, maxAttempts: 3, nextRetryAt: null, leaseExpiresAt: null, cancelRequestedAt: null,
        errorCode: null, createdAt: task.createdAt, updatedAt: task.updatedAt
      }
    })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /アクティビティ/u }))
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(task.title) }))
    await waitFor(() => expect(window.sesAgent.analyzeResumeFile).toHaveBeenCalledWith({ fileToken, taskId: task.id }))
    expect(await screen.findByRole('dialog', { name: '履歴書取込の進捗' })).toBeInTheDocument()
  })

  it('refreshes bootstrap only while a background processing job is active', async () => {
    const task = bootstrap.tasks[0]!
    const activeJob = {
      id: '2fd061ab-45a9-4f33-86e9-6ea199152330',
      type: 'resume-analysis' as const,
      workTaskId: task.id,
      taskStepId: task.steps[0]!.id,
      status: 'retry_wait' as const,
      replayPolicy: 'safe-local' as const,
      progress: 15,
      attemptCount: 1,
      maxAttempts: 3,
      nextRetryAt: '2026-07-20T00:00:05.000Z',
      leaseExpiresAt: null,
      cancelRequestedAt: null,
      errorCode: 'TRANSIENT_LOCAL_FAILURE',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z'
    }
    const activeBootstrap = { ...bootstrap, processingJobs: [activeJob] }
    const completedBootstrap = {
      ...activeBootstrap,
      processingJobs: [{ ...activeJob, status: 'succeeded' as const, progress: 100, nextRetryAt: null, errorCode: null }]
    }
    vi.mocked(window.sesAgent.getBootstrap)
      .mockResolvedValueOnce(activeBootstrap)
      .mockResolvedValueOnce(completedBootstrap)
      .mockResolvedValue(completedBootstrap)

    render(<App />)
    await screen.findByRole('heading', { name: '業務ワークベンチ' })
    await waitFor(() => expect(window.sesAgent.getBootstrap).toHaveBeenCalledTimes(2))
  })
})
