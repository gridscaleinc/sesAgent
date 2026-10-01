import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSampleTasks, createWorkTaskPreview, materializeWorkTask } from '@application'
import type { SignedWorkTaskPreview } from '@domain'
import {
  builtInBroadcastTemplate,
  builtInPersonnelTemplates,
  type BootstrapPayload,
  type CandidateEvaluationState,
  type CandidateReviewSnapshot,
  type BusinessFeedEntry,
  type DesktopApi,
  type JobCaseReviewSnapshot,
  type TodaySummary,
  type TrayNavigation
} from '@shared'
import { App } from './App'
import { clearPersonCaseMatchCache } from './person-case-match-cache'

const bootstrap: BootstrapPayload = {
  appVersion: '0.1.0',
  environmentLabel: 'テスト',
  operatorProfile: {
    version: 'local-operator-profile-v1',
    operatorId: '11111111-1111-4111-8111-111111111111',
    displayName: '本機ユーザー',
    roleLabel: 'プロフィール未設定',
    configured: false,
    revision: null,
    updatedAt: null,
    cloudEligible: false
  },
  preferences: {
    version: 'local-application-preferences-v1',
    locale: 'ja-JP',
    configured: false,
    revision: null,
    updatedAt: null,
    cloudEligible: false
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
    phase: 'B-03-1',
    gateStatus: 'no-go',
    platform: 'darwin',
    featureFlagEnabled: true,
    userFeatureAvailable: false,
    accessibilityTrusted: false,
    screenCaptureTrusted: false,
    rawTextNetworkIsolationVerified: false,
    evidenceVerified: false,
    targetVersion: null,
    failureCodes: ['MACOS_ACCESSIBILITY_PERMISSION_UNVERIFIED']
  },
  privacy: {
    policyVersion: 'cloud-redaction-v2',
    cloudGateway: 'enforced',
    localAi: 'vision-ocr-and-pii-active',
    qualityGate: {
      status: 'passed',
      datasetVersion: 'ses-privacy-regression-v1',
      syntheticOnly: true,
      caseCount: 28,
      identifierRecall: 1,
      redactionPrecision: 1,
      residualLeakCount: 0,
      safeCaseFalsePositiveCount: 0,
      appleNerVerified: true,
      reportHash: 'a'.repeat(64),
      failureCodes: []
    },
    expertGate: {
      status: 'not-verified',
      datasetVersion: null,
      humanLabeledDataset: true,
      sourceDocumentCount: 0,
      caseCount: 0,
      automaticPersonNameRecall: null,
      postReviewIdentifierRecall: null,
      redactionPrecision: null,
      reviewedAt: null,
      evaluatedAt: null,
      reportHash: null,
      attestationHash: null,
      privacyImplementationSha256: null,
      cloudEnforcementSha256: null,
      failureCodes: ['expert-report:missing']
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
    configuration: 'required',
    connection: 'not-connected',
    productCode: null,
    billingMode: null,
    memberDisplayName: null,
    accountId: null,
    accountAiTokenExpiresAt: null,
    wallet: null,
    capabilities: [],
    refreshedAt: null
  },
  recovery: {
    format: 'ses-recovery-v1',
    encryption: 'scrypt-aes-256-gcm',
    lastBackupAt: null,
    lastRestoreAt: null,
    pendingRestore: false,
    reminder: {
      status: 'not-needed',
      reason: null,
      currentDataRevision: 0,
      lastBackupDataRevision: null,
      latestDataChangedAt: null,
      snoozedUntil: null
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
    metrics: {
      caseCount: 30,
      relevantCandidates: 36,
      retrievedRelevantCandidates: 34,
      recallAt20: 0.9444,
      ndcgAt20: 0.8123,
      expectedProjectEvidence: 20,
      matchedProjectEvidence: 18,
      projectEvidenceCoverageAt20: 0.9,
      missingCandidateReferences: 0
    },
    thresholds: { minimumCases: 30, recallAt20: 0.9, ndcgAt20: 0.75, projectEvidenceCoverageAt20: 0.8 },
    cases: [
      {
        caseId: 'case-1',
        queryHash: 'f'.repeat(64),
        relevantCandidates: 1,
        retrievedRelevantCandidates: 1,
        recallAt20: 1,
        ndcgAt20: 1,
        expectedProjectEvidence: 1,
        matchedProjectEvidence: 1,
        missingCandidateLabels: []
      }
    ]
  }
}

const hrRail = () => within(screen.getByRole('complementary', { name: 'システムナビゲーション' }))
const waitForHrShell = () => screen.findByRole('complementary', { name: 'システムナビゲーション' })
/** The HR shell has no palette button; ⌘K is the only way to open business commands. */
const pressCommandShortcut = async () => {
  const paletteOpen = () => Boolean(document.querySelector('.command-palette-dialog'))
  const wasOpen = paletteOpen()
  const press = () =>
    act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
    })
  await press()
  if (wasOpen) return
  // The shell can paint before the ⌘K listener is attached under a loaded run; press again only while still closed.
  await waitFor(
    async () => {
      if (!paletteOpen()) {
        await press()
        throw new Error('command palette not open yet')
      }
    },
    { timeout: 3000, interval: 100 }
  )
}
const runBusinessCommand = async (option: RegExp) => {
  await waitForHrShell()
  await pressCommandShortcut()
  fireEvent.click(await screen.findByRole('option', { name: option }, { timeout: 5000 }))
}

/** Runs a palette option and waits for the palette to close, so the next ⌘K opens it again. */
const chooseCommand = async (option: RegExp) => {
  fireEvent.click(await screen.findByRole('option', { name: option }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '業務コマンド' })).not.toBeInTheDocument())
}

/** One person and one case shown in both HR lists, with a recommended 找案件 result item for the pair. */
const hrObjects = () => {
  const documentId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  const now = new Date().toISOString()
  const candidate: CandidateReviewSnapshot = {
    documentId,
    fileName: 'Selected Engineer.xlsx',
    reviewRevision: 1,
    status: 'awaiting-review',
    piiReviewed: false,
    fields: [],
    projectExperiences: [],
    completedAt: null,
    reviewerDisplayName: null,
    profile: {
      id: documentId,
      sourceDocumentId: documentId,
      version: 1,
      status: 'current',
      confirmedAt: now,
      confirmedBy: '本机导入',
      containsDirectIdentifiers: false
    },
    recruitingStatus: 'pending-review',
    talentPoolStatus: 'eligible',
    recordStatus: 'active'
  }
  const job: JobCaseReviewSnapshot = {
    reviewId: '33333333-3333-4333-8333-333333333333',
    sourceId: 'manual-1',
    sourceType: 'manual',
    providerMessageId: null,
    threadId: 'manual-1',
    fromDomain: null,
    messageDate: now,
    redactedSubject: 'Java project',
    redactedPreview: 'Java',
    reviewRevision: 1,
    status: 'completed',
    privacyReviewed: true,
    fields: [
      {
        key: 'title',
        label: '案件名',
        originalValue: 'Java project',
        value: 'Java project',
        confidence: 1,
        status: 'confirmed',
        sourceLabels: [],
        changed: false,
        changeReason: null
      }
    ],
    warningCodes: [],
    completedAt: now,
    reviewerDisplayName: 'HR',
    lifecycle: 'active',
    cloudEligible: false,
    jobCase: {
      id: '44444444-4444-4444-8444-444444444444',
      sourceReviewId: '33333333-3333-4333-8333-333333333333',
      version: 1,
      status: 'active',
      confirmedAt: now,
      confirmedBy: 'HR',
      containsDirectIdentifiers: false
    }
  }
  const personEntry: BusinessFeedEntry = {
    kind: 'person',
    objectId: documentId,
    revision: 'a'.repeat(64),
    title: 'Selected Engineer',
    event: 'created',
    occurredAt: now,
    sourceAt: now,
    source: 'local-personnel',
    unseen: false,
    deferred: false,
    archived: false,
    businessStatus: 'available',
    needsReview: false,
    fields: [],
    changes: []
  }
  const feed: BusinessFeedEntry[] = [
    personEntry,
    {
      ...personEntry,
      kind: 'case',
      working: true,
      objectId: job.reviewId,
      title: 'Java project',
      source: 'manual',
      businessStatus: 'active'
    }
  ]
  const matchItem = {
    reviewId: job.reviewId,
    jobCaseId: job.jobCase!.id,
    jobCaseVersion: 1,
    title: 'Java project',
    score: 90,
    matched: ['Java'],
    missing: [],
    hardFilters: [],
    qualification: { policyVersion: 'technical-language-v5', status: 'recommended', requirements: [] },
    assessment: {
      version: 'match-assessment-v1',
      fit: 'strong',
      met: [{ requirement: 'Java', evidence: 'Java' }],
      gaps: [],
      confirm: [],
      reason: 'Java project experience',
      modelKey: 'test',
      assessedAt: now
    }
  }
  return { documentId, candidate, job, feed, matchItem }
}

// Each test renders the whole app; under a full parallel run they can exceed the 5s default.
describe('App workbench', { timeout: 20_000 }, () => {
  beforeEach(() => {
    // 找案件 results live in a renderer-session cache; each test starts without any.
    clearPersonCaseMatchCache()
    const preview: SignedWorkTaskPreview = {
      ...createWorkTaskPreview('JavaとAWS経験がある候補者を根拠付きで比較したい'),
      previewHash: 'a'.repeat(64)
    }
    const api: DesktopApi = {
      listCustomerIdentities: vi.fn(async () => []),
      saveCustomerIdentity: vi.fn(),
      getInterviewAnswers: vi.fn(async () => null),
      getPairInterviewEvidence: vi.fn(async () => []),
      listMatchingOpportunities: vi.fn(async () => []),
      controlMatchingOpportunity: vi.fn(),
      getQuestionBankHistory: vi.fn(async () => []),
      restoreQuestionBankVersion: vi.fn(),
      listQuestionBank: vi.fn(async () => []),
      controlQuestionBank: vi.fn(),
      getSystemExperience: vi.fn(),
      controlSystemExperience: vi.fn(),
      getSystemExperienceDetails: vi.fn(),
      recordExperienceExposure: vi.fn(),
      listWorkRules: vi.fn(async () => ({ revision: 0, rules: [] })),
      getWorkRuleHistory: vi.fn(async () => []),
      analyzeWorkRule: vi.fn(),
      saveWorkRule: vi.fn(),
      changeWorkRule: vi.fn(),
      prepareCaseAssessment: vi.fn(),
      getCaseQuestionDraft: vi.fn(async () => ({ draft: null, stale: false })),
      deleteBusinessFollowUp: vi.fn(),
      setCaseWorking: vi.fn(),
      saveCaseIntroductionDrafts: vi.fn(async () => []),
      listCaseIntroductionDrafts: vi.fn(async () => []),
      savePersonnelIntroductionDrafts: vi.fn(async () => []),
      listPersonnelIntroductionDrafts: vi.fn(async () => []),
      listCaseAssessments: vi.fn(async () => []),
      listCaseSearchSummaries: vi.fn(async () => []),
      onCaseResumeImportProgress: vi.fn(() => () => {}),
      assessCasePerson: vi.fn(),
      importResumeForCase: vi.fn(),
      addCandidateToLibrary: vi.fn(),
      saveAssessmentFeedback: vi.fn(),
      generateRuleQuestions: vi.fn(),
      listPersonnelMailUpdates: vi.fn(async () => []),
      resolvePersonnelMailUpdate: vi.fn(),
      beginBusinessProgress: vi.fn(async () => []),
      advanceBusinessProgress: vi.fn(),
      analyzeBusinessProgress: vi.fn(),
      draftBusinessProgressMessage: vi.fn(),
      openBusinessProgressEmail: vi.fn(),
      exportBusinessProgressCalendar: vi.fn(),
      listBusinessProgressMail: vi.fn(async () => []),
      updateBusinessProgressMail: vi.fn(),
      beginIntroductionDraft: vi.fn(async (input) => ({
        text: input.text,
        experienceRunId: '11111111-1111-4111-8111-111111111111',
        hasExperience: false
      })),
      regenerateIntroduction: vi.fn(async () => ({ text: 'Cloud generated proposal' })),
      saveBusinessField: vi.fn(),
      getBusinessFeed: vi.fn().mockResolvedValue([]),
      markBusinessFeed: vi.fn().mockResolvedValue([]),
      getPersonnelWorkspace: vi.fn().mockResolvedValue({ templates: [], states: [], copies: [] }),
      listBusinessFollowUps: vi.fn(async () => []),
      saveBusinessFollowUp: vi.fn(),
      onBusinessMatchingProgress: vi.fn(() => () => {}),
      cancelBusinessMatching: vi.fn(),
      savePersonnelTemplate: vi.fn(),
      setCandidateOwnCompany: vi.fn(),
      setCandidateBusinessState: vi.fn(),
      validatePersonnelMessage: vi.fn(),
      recordPersonnelCopy: vi.fn(),
      openPersonnelEmail: vi.fn(),
      findCasesForPersonnel: vi.fn(),
      getPersonnelCaseMatchRun: vi.fn(async () => null),
      listPersonnelCaseMatchRunSummaries: vi.fn(async () => []),
      findPersonnelForCase: vi.fn(),
      copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
      getStartupStatus: vi.fn().mockResolvedValue({ mode: 'normal' }),
      getBootstrap: vi.fn().mockResolvedValue(bootstrap),
      resolveActionApproval: vi.fn(),
      saveLocalOperatorProfile: vi.fn().mockImplementation(async (input) => ({
        version: 'local-operator-profile-v1',
        operatorId: '11111111-1111-4111-8111-111111111111',
        displayName: input.displayName,
        roleLabel: input.roleLabel,
        configured: true,
        revision: 1,
        updatedAt: '2026-07-20T00:00:00.000Z',
        cloudEligible: false
      })),
      importAtsCsvCandidates: vi.fn().mockResolvedValue({
        cancelled: true,
        fileName: null,
        rowCount: 0,
        importedCount: 0,
        duplicateCount: 0,
        skippedCount: 0,
        failedCount: 0,
        items: []
      }),
      saveJobCaseFieldAliases: vi.fn().mockImplementation(async (input) => ({
        version: 'job-case-field-aliases-v1',
        aliases: input.aliases,
        configured: true,
        revision: 1,
        updatedAt: '2026-08-26T00:00:00.000Z'
      })),
      saveLocalApplicationPreferences: vi.fn().mockImplementation(async (input) => ({
        version: 'local-application-preferences-v1',
        locale: input.locale,
        configured: true,
        revision: 1,
        updatedAt: '2026-07-20T00:00:00.000Z',
        cloudEligible: false
      })),
      testAiModel: vi.fn().mockResolvedValue({ modelKey: 'gpt-5.6-luna', latencyMs: 640 }),
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
      previewStagedResumeFile: vi.fn(),
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
      importCaseTextBatch: vi.fn(),
      prepareWechatVisibleRead: vi.fn(),
      executeWechatVisibleRead: vi.fn(),
      importEmlJobCaseDrafts: vi.fn(),
      submitJobCaseReview: vi.fn(),
      getJobCaseHistory: vi.fn().mockResolvedValue([]),
      getJobCaseSourceText: vi.fn(),
      setJobCaseLifecycle: vi.fn(),
      reopenJobCaseReview: vi.fn(),
      previewJobCaseDeletion: vi.fn(),
      deleteJobCaseData: vi.fn(),
      getJobCaseNewDigest: vi.fn().mockResolvedValue({ groups: [], newCasesToday: 0, unseenCount: 0 }),
      markJobCaseSeen: vi.fn().mockResolvedValue({ unseenCount: 0 }),
      listBroadcastWorkspace: vi.fn().mockResolvedValue({ queue: [], templates: [] }),
      draftCaseBroadcast: vi.fn().mockResolvedValue({ textJa: '', textZh: '', forbiddenJa: [], forbiddenZh: [] }),
      prepareCaseIntroduction: vi.fn(),
      draftCaseUpdateNotice: vi.fn().mockResolvedValue({ status: 'no-sent-baseline' }),
      validateCaseBroadcastMessage: vi.fn(),
      recordCaseBroadcastCopy: vi.fn().mockResolvedValue({ copy: {} }),
      openCaseBroadcastEmail: vi.fn().mockResolvedValue({ opened: true }),
      listCaseBroadcasts: vi.fn().mockResolvedValue([]),
      createBroadcastTemplate: vi.fn().mockResolvedValue([]),
      updateBroadcastTemplate: vi.fn().mockResolvedValue([]),
      deleteBroadcastTemplate: vi.fn().mockResolvedValue([]),
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
      cancelCandidateInterviewSchedule: vi.fn(),
      correctCandidateInterviewDecision: vi.fn(),
      deleteUnbookedCandidateInterviewRound: vi.fn(),
      deleteCandidateData: vi.fn(),
      listDataDeletionReports: vi.fn().mockResolvedValue([]),
      connectGoogleWorkspace: vi.fn(),
      diagnoseGoogleWorkspace: vi.fn(),
      runGoogleWorkspaceOnlineAcceptance: vi.fn(),
      saveGoogleWorkspaceAdminConfiguration: vi.fn(),
      disconnectGoogleWorkspace: vi.fn(),
      syncGoogleWorkspace: vi.fn(),
      onGmailSyncCompleted: vi.fn().mockReturnValue(() => undefined),
      onOpenNewCaseBoard: vi.fn().mockReturnValue(() => undefined),
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

  it('announces a scheduled Gmail import with a toast that clears itself', async () => {
    await waitForHrShell()
    const notify = vi.mocked(window.sesAgent.onGmailSyncCompleted).mock.calls[0]![0]
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await act(async () => {
        notify({ imported: 3, duplicates: 1, filtered: 0, failed: 0 })
      })
      expect(screen.getByText('Gmail 同期：メール 3件、人材 0名')).toBeInTheDocument()
      // Non-blocking: it disappears on its own without the operator dismissing it.
      await act(async () => {
        vi.advanceTimersByTime(5_000)
      })
      expect(screen.queryByText('Gmail 同期：メール 3件、人材 0名')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens recruiting interviews as a sub-page of 人员 with no second person directory', async () => {
    await waitForHrShell()
    fireEvent.click(hrRail().getByRole('button', { name: '要員' }))
    // With no person selected there is no separate "all records" page to open.
    expect(screen.queryByRole('button', { name: '要員の全資料' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '採用面談' }))
    expect(await screen.findByRole('heading', { name: '採用面談' })).toBeInTheDocument()
    expect(hrRail().getByRole('button', { name: '要員' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('heading', { name: '人材プール' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '要員に戻る' }))
    expect(await screen.findByRole('region', { name: '要員一覧' })).toBeVisible()
  })

  it('opens interview schedule as a neutral aggregate and returns there from an exact interview round', async () => {
    cleanup()
    const documentId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const interviewId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const scheduleBootstrap: BootstrapPayload = {
      ...bootstrap,
      preferences: { ...bootstrap.preferences, locale: 'zh-CN' },
      candidateReviews: [
        {
          documentId,
          fileName: 'candidate.xlsx',
          reviewRevision: 1,
          status: 'completed',
          piiReviewed: true,
          localIdentity: {
            displayName: '张伟',
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
          fields: [
            {
              key: 'role',
              label: '角色',
              originalValue: 'Java 工程师',
              value: 'Java 工程师',
              confidence: 1,
              status: 'confirmed',
              sourceLabels: [],
              changed: false,
              changeReason: null
            },
            {
              key: 'skills',
              label: '技能',
              originalValue: 'Java, AWS',
              value: 'Java, AWS',
              confidence: 1,
              status: 'confirmed',
              sourceLabels: [],
              changed: false,
              changeReason: null
            }
          ],
          projectExperiences: [],
          completedAt: '2026-07-20T00:00:00.000Z',
          reviewerDisplayName: '李娜',
          profile: null,
          recruitingStatus: 'recruiting',
          talentPoolStatus: 'none',
          recordStatus: 'active'
        }
      ],
      candidateInterviews: [
        {
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
        }
      ]
    }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue(scheduleBootstrap)
    render(<App />)

    const zhRail = within(await screen.findByRole('complementary', { name: '系统导航' }))
    fireEvent.click(zhRail.getByRole('button', { name: '跟进' }))
    fireEvent.click(await screen.findByRole('button', { name: '面试日程' }))
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
    await act(async () => {
      await Promise.resolve()
    })
    expect(getRecoveryState).not.toHaveBeenCalled()
  })

  it('renders the primary HR/sales interaction window and governance state', async () => {
    expect(await screen.findByRole('main', { name: 'SES Agent' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: '案件一覧' })).toBeVisible()
    expect(hrRail().getByRole('button', { name: /^案件/u })).toHaveAttribute('aria-current', 'page')
    expect(hrRail().getByRole('button', { name: '要員' })).toBeInTheDocument()
    expect(hrRail().getByRole('button', { name: '対応記録' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '業務ワークベンチ' })).not.toBeInTheDocument()
    fireEvent.click(hrRail().getByRole('button', { name: '設定' }))
    const settings = await screen.findByRole('dialog', { name: '設定' })
    fireEvent.click(within(settings).getByRole('button', { name: /外部システム/ }))
    expect(within(settings).getByText('Google メール')).toBeInTheDocument()
    expect(within(settings).getByText('AICommerce Cloud AI')).toBeInTheDocument()
    expect(within(settings).queryByRole('button', { name: '接続設定' })).not.toBeInTheDocument()
    expect(within(settings).getByText(/Google メール接続が組み込まれていません/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '会社 Gmail の管理者設定' })).not.toBeInTheDocument()
  })

  it('runs the first bounded sync immediately after one-click Google authorization', async () => {
    cleanup()
    const configured: BootstrapPayload = {
      ...bootstrap,
      gmail: { ...bootstrap.gmail, configuration: 'ready' },
      googleWorkspaceConfiguration: {
        version: 'google-workspace-admin-config-v1',
        source: 'managed-environment',
        editable: false,
        clientId: '1234567890-product.apps.googleusercontent.com',
        workspaceDomain: null,
        labelIds: ['INBOX'],
        query: '案件 OR 募集',
        lookbackDays: 30,
        maxMessagesPerRun: 200,
        revision: null,
        configuredBy: 'product',
        updatedAt: '2026-09-01T00:00:00.000Z'
      },
      gmailSync: { ...bootstrap.gmailSync, configuration: 'ready', labelIds: ['INBOX'], query: '案件 OR 募集' }
    }
    const connected = {
      ...configured.gmail,
      status: 'readonly' as const,
      configuration: 'connected' as const,
      workspaceDomain: 'gmail.com',
      accountEmail: 'hr.personal@gmail.com',
      grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      readAccess: true
    }
    const synced: BootstrapPayload = {
      ...configured,
      gmail: connected,
      gmailSync: {
        ...configured.gmailSync,
        status: 'idle',
        storedMessages: 1,
        lastSyncedAt: '2026-09-01T00:01:00.000Z',
        lastRun: { mode: 'baseline', discovered: 1, imported: 1, duplicates: 0, filtered: 0, failed: 0 }
      }
    }
    vi.mocked(window.sesAgent.getBootstrap).mockReset().mockResolvedValueOnce(configured).mockResolvedValueOnce(synced)
    vi.mocked(window.sesAgent.connectGoogleWorkspace).mockReset().mockResolvedValue(connected)
    vi.mocked(window.sesAgent.syncGoogleWorkspace).mockReset().mockResolvedValue(synced.gmailSync)
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '設定' }))
    const settings = await screen.findByRole('dialog', { name: '設定' })
    fireEvent.click(within(settings).getByRole('button', { name: /外部システム/ }))
    fireEvent.click(within(settings).getByRole('button', { name: 'Google メールを接続' }))

    await waitFor(() => expect(window.sesAgent.connectGoogleWorkspace).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(window.sesAgent.syncGoogleWorkspace).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(window.sesAgent.getBootstrap).toHaveBeenCalledTimes(2))
    expect(within(settings).getByText('hr.personal@gmail.com')).toBeInTheDocument()
    expect(screen.queryByText('Desktop OAuth Client ID')).not.toBeInTheDocument()
  })

  it('switches the display language to Simplified Chinese from local settings without a network action', async () => {
    fireEvent.click(await screen.findByRole('button', { name: '設定' }))
    const dialog = await screen.findByRole('dialog', { name: '設定' })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('radio', { name: /中文（简体）/ }))
    })

    await waitFor(() =>
      expect(window.sesAgent.saveLocalApplicationPreferences).toHaveBeenCalledWith({
        locale: 'zh-CN',
        expectedRevision: null
      })
    )
    expect(await screen.findByRole('complementary', { name: '系统导航' })).toBeInTheDocument()
    expect(within(screen.getByRole('complementary', { name: '系统导航' })).getByRole('button', { name: '人员' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(window.sesAgent.getBootstrap).toHaveBeenCalledTimes(1)

    fireEvent.click(within(dialog).getByRole('button', { name: /数据与隐私/ }))
    fireEvent.click(await within(dialog).findByRole('button', { name: /打开数据安全详情/ }))
    expect(await screen.findByText('云端发送前脱敏')).toBeInTheDocument()
    expect(screen.getByText('人员搜索质量门')).toBeInTheDocument()
    expect(screen.getByText('加密备份')).toBeInTheDocument()
    expect(screen.getByText('人工确认点')).toBeInTheDocument()

    await pressCommandShortcut()
    fireEvent.click(await screen.findByRole('option', { name: /打开活动记录/ }))
    expect(await screen.findByRole('heading', { name: '活动记录' })).toBeInTheDocument()
    expect(screen.getByText('处理记录与证据')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /匹配 Java \/ Spring Boot \/ AWS 案件的人员/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /准备支付平台案件的提案邮件草稿/ })).toBeInTheDocument()
  })

  it('edits the encrypted local operator profile from general settings', async () => {
    await waitForHrShell()
    fireEvent.click(hrRail().getByRole('button', { name: '設定' }))
    const settings = await screen.findByRole('dialog', { name: '設定' })
    expect(within(settings).getByText('表示名と担当ロールを設定します。')).toBeInTheDocument()
    fireEvent.click(within(settings).getByRole('button', { name: /本機ユーザープロフィール/ }))
    const dialog = await screen.findByRole('dialog', { name: '操作員プロフィール' })
    expect(within(dialog).getByText('プロフィールは送信対象外')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('表示名'), { target: { value: '佐藤 美咲' } })
    fireEvent.change(within(dialog).getByLabelText('役割'), { target: { value: 'SES営業担当' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '暗号化して保存' }))

    await waitFor(() =>
      expect(window.sesAgent.saveLocalOperatorProfile).toHaveBeenCalledWith({
        displayName: '佐藤 美咲',
        roleLabel: 'SES営業担当',
        expectedRevision: null
      })
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '操作員プロフィール' })).not.toBeInTheDocument())
    fireEvent.click(hrRail().getByRole('button', { name: '設定' }))
    expect(await screen.findByRole('button', { name: /本機ユーザープロフィール.*佐藤 美咲 · SES営業担当/ })).toBeInTheDocument()
    expect(screen.queryByText('山田 太郎')).not.toBeInTheDocument()
  })

  it('opens the local business command palette with Cmd+K and restores focus on Escape', async () => {
    await waitForHrShell()
    const trigger = hrRail().getByRole('button', { name: '要員' })
    trigger.focus()
    await pressCommandShortcut()
    expect(await screen.findByRole('dialog', { name: '業務コマンド' })).toBeInTheDocument()
    const search = screen.getByRole('textbox', { name: '業務コマンドを検索' })
    await waitFor(() => expect(search).toHaveFocus())
    expect(screen.getByText('検索文字は端末内のみ・外部送信なし')).toBeInTheDocument()

    fireEvent.keyDown(search, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '業務コマンド' })).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('opens the manual HR case input directly from a searched business command', async () => {
    await waitForHrShell()
    await pressCommandShortcut()
    const search = await screen.findByRole('textbox', { name: '業務コマンドを検索' })
    fireEvent.change(search, { target: { value: '案件を手動' } })
    fireEvent.click(screen.getByRole('option', { name: /案件を手動で追加/ }))

    expect(await screen.findByRole('heading', { name: '案件をインポート' })).toBeInTheDocument()
    const dialog = await screen.findByRole('dialog', { name: '案件情報を手動で追加' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('入力はまず端末内で脱敏されます')).toBeInTheDocument()

    expect(hrRail().getByRole('button', { name: '案件' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
    fireEvent.click(screen.getByRole('button', { name: '案件に戻る' }))
    expect(await screen.findByRole('region', { name: '案件一覧' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '案件の全資料' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '案件情報を手動で追加' })).not.toBeInTheDocument()
  })

  it('opens a real resumable task center from the activity command', async () => {
    await runBusinessCommand(/アクティビティを開く/)
    expect(await screen.findByRole('heading', { name: 'アクティビティ' }, { timeout: 5000 })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '作業状態の集計' })).getByText(String(bootstrap.tasks.length))).toBeInTheDocument()
    expect(screen.getByText('処理履歴と証跡')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: new RegExp(bootstrap.tasks[1]!.title) }))
    expect(await screen.findByRole('heading', { name: bootstrap.tasks[1]!.title })).toBeInTheDocument()
  })

  it('opens an actionable local review center from its own command', async () => {
    await runBusinessCommand(/レビューセンターを開く/)

    expect(await screen.findByRole('heading', { name: 'レビューセンター' })).toBeInTheDocument()
    expect(screen.getByText('一覧には原文や直接識別子を複製しません')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '提案下書きの詳細を開く' }))
    expect(await screen.findByRole('heading', { name: bootstrap.tasks[1]!.title })).toBeInTheDocument()
  })

  it('routes the primary Gmail input through readonly sync into case review', async () => {
    await waitForHrShell()
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
    vi.mocked(window.sesAgent.getBootstrap).mockReset().mockResolvedValueOnce(connected).mockResolvedValue(synced)
    vi.mocked(window.sesAgent.syncGoogleWorkspace).mockResolvedValue(synced.gmailSync)
    render(<App />)

    fireEvent.click(within(await waitForHrShell()).getByRole('button', { name: '案件' }))
    fireEvent.click(screen.getByRole('button', { name: '一括取込' }))
    await screen.findByRole('button', { name: /Gmail から取り込む/ })
    fireEvent.click(screen.getByRole('button', { name: /Gmail から取り込む/ }))

    // The sync result stays on 案件 → 一括取込; the drafts are confirmed from the HR case list.
    expect(await screen.findByRole('region', { name: 'Gmail同期結果' })).toHaveTextContent('2件取込')
    expect(screen.getByRole('heading', { name: '案件をインポート' })).toBeInTheDocument()
    expect(hrRail().getByRole('button', { name: '案件' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText(/Cloud LLMには送信していません/)).toBeInTheDocument()
    expect(window.sesAgent.syncGoogleWorkspace).toHaveBeenCalledTimes(1)
  })

  it('surfaces a scheduled background Gmail sync as the existing import notice', async () => {
    await waitForHrShell()
    cleanup()
    const synced = {
      ...bootstrap,
      gmailSync: {
        ...bootstrap.gmailSync,
        configuration: 'ready' as const,
        status: 'idle' as const,
        storedMessages: 3,
        lastSyncedAt: '2026-08-30T01:00:00.000Z',
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
    let scheduledCompletion: ((completion: { imported: number; duplicates: number; filtered: number; failed: number }) => void) | null =
      null
    Object.defineProperty(window, 'sesAgent', {
      configurable: true,
      value: {
        ...window.sesAgent,
        onGmailSyncCompleted: vi
          .fn()
          .mockImplementation(
            (listener: (completion: { imported: number; duplicates: number; filtered: number; failed: number }) => void) => {
              scheduledCompletion = listener
              return () => undefined
            }
          )
      }
    })
    vi.mocked(window.sesAgent.getBootstrap).mockReset().mockResolvedValueOnce(bootstrap).mockResolvedValue(synced)
    render(<App />)
    await waitForHrShell()

    act(() => {
      scheduledCompletion!({ imported: 2, duplicates: 1, filtered: 0, failed: 0 })
    })
    await waitFor(() => expect(window.sesAgent.getBootstrap).toHaveBeenCalledTimes(2))

    fireEvent.click(hrRail().getByRole('button', { name: '案件' }))
    fireEvent.click(screen.getByRole('button', { name: '一括取込' }))
    expect(await screen.findByRole('region', { name: 'Gmail同期結果' })).toHaveTextContent('2件取込')
  })

  it('opens data governance from the data and privacy settings', async () => {
    await waitForHrShell()
    fireEvent.click(hrRail().getByRole('button', { name: '設定' }))
    const settings = await screen.findByRole('dialog', { name: '設定' })
    fireEvent.click(within(settings).getByRole('button', { name: /データとプライバシー/ }))
    fireEvent.click(within(settings).getByRole('button', { name: /データセキュリティの詳細を開く/ }))

    expect(screen.queryByRole('dialog', { name: '設定' })).not.toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'データと承認' }).closest('aside')).toHaveClass('is-responsive-open')
    expect(screen.getAllByRole('button', { name: 'データと承認パネルを閉じる' })).toHaveLength(2)
  })

  it('opens the business object list and preserves bulk drafts across navigation', async () => {
    cleanup()
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue(bootstrap)
    render(<App />)
    expect(await screen.findByRole('main', { name: 'SES Agent' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: '案件一覧' })).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'SES Agent への指示' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新規タスク' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '情報整理・紹介ワークスペース' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '案件を追加' }))
    const paste = screen.getByRole('textbox', { name: '案件内容' })
    fireEvent.change(paste, { target: { value: '案件名：Java 基盤\n必須：Java' } })
    fireEvent.click(screen.getByRole('button', { name: '業務パネルを閉じる' }))
    fireEvent.click(within(screen.getByRole('complementary', { name: 'システムナビゲーション' })).getByRole('button', { name: '要員' }))
    fireEvent.click(screen.getByRole('button', { name: '採用面談' }))
    expect(await screen.findByRole('heading', { name: '採用面談' })).toBeVisible()
    fireEvent.click(within(screen.getByRole('complementary', { name: 'システムナビゲーション' })).getByRole('button', { name: '案件' }))
    fireEvent.click(screen.getByRole('button', { name: '案件を追加' }))
    expect(screen.getByRole('textbox', { name: '案件内容' })).toHaveValue('案件名：Java 基盤\n必須：Java')
  })

  it('uses the Agent system rail as global navigation and preserves an unsent draft on return', async () => {
    cleanup()
    const connected = {
      ...bootstrap,
      aiCommerce: { ...bootstrap.aiCommerce, configuration: 'ready' as const, connection: 'connected' as const }
    }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue(connected)
    render(<App />)
    await screen.findByRole('main', { name: 'SES Agent' })
    fireEvent.click(screen.getByRole('button', { name: 'Agentに質問' }))

    const composer = await screen.findByRole('textbox', { name: 'SES Agent への指示' })
    fireEvent.change(composer, { target: { value: '未送信の案件メモ' } })
    fireEvent.click(within(screen.getByRole('complementary', { name: 'システムナビゲーション' })).getByRole('button', { name: '要員' }))
    fireEvent.click(screen.getByRole('button', { name: '採用面談' }))

    expect(await screen.findByRole('heading', { name: '採用面談' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'システムナビゲーション' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'メインナビゲーション' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'SES Agent' })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: '業務ワークスペース' })).not.toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('complementary', { name: 'システムナビゲーション' })).getByRole('button', { name: /^Agent/u }))
    expect(await screen.findByRole('textbox', { name: 'SES Agent への指示' })).toHaveValue('未送信の案件メモ')
  })

  it('keeps one global rail and places full records and interview schedules in their business areas', async () => {
    cleanup()
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue(bootstrap)
    render(<App />)
    await screen.findByRole('main', { name: 'SES Agent' })
    const rail = () => within(screen.getByRole('complementary', { name: 'システムナビゲーション' }))
    expect(rail().queryByText('管理')).not.toBeInTheDocument()
    fireEvent.click(rail().getByRole('button', { name: '対応記録' }))
    fireEvent.click(await screen.findByRole('button', { name: '面談日程' }))
    expect(await screen.findByRole('heading', { name: '面談日程' })).toBeVisible()
    expect(rail().getByRole('button', { name: '対応記録' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('button', { name: '対応記録に戻る' }))
    expect(await screen.findByRole('button', { name: '面談日程' })).toBeVisible()
    fireEvent.click(rail().getByRole('button', { name: '案件' }))
    fireEvent.click(screen.getByRole('button', { name: '一括取込' }))
    expect(await screen.findByRole('heading', { name: '案件をインポート' })).toBeVisible()
    expect(rail().getByRole('button', { name: '案件' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('button', { name: '案件に戻る' }))
    expect(await screen.findByRole('region', { name: '案件一覧' })).toBeVisible()
    expect(screen.queryByRole('navigation', { name: 'メインナビゲーション' })).not.toBeInTheDocument()
  })

  it('shows only resume imports in personnel history and does not create a review gate for imported records', async () => {
    cleanup()
    const imported = { ...bootstrap.tasks[0]!, id: 'import-complete', type: 'IMPORT_RESUME' as const, status: 'awaiting_review' as const }
    const failed = { ...imported, id: 'import-failed', status: 'failed' as const }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue({
      ...bootstrap,
      tasks: [bootstrap.tasks[0]!, imported, failed, ...Array.from({ length: 19 }, (_, index) => ({ ...imported, id: `import-${index}` }))]
    })
    render(<App />)
    await screen.findByRole('main', { name: 'SES Agent' })
    const rail = within(screen.getByRole('complementary', { name: 'システムナビゲーション' }))
    expect(rail.queryByLabelText('確認が必要な操作あり')).not.toBeInTheDocument()
    fireEvent.click(rail.getByRole('button', { name: '要員' }))
    fireEvent.click(screen.getByRole('button', { name: '取込履歴' }))
    expect(await screen.findByRole('heading', { name: '要員の取込履歴' })).toBeVisible()
    const history = within(screen.getByRole('region', { name: '要員の取込履歴' }))
    expect(history.getAllByRole('button')).toHaveLength(20)
    expect(history.getAllByText('取込済み')).toHaveLength(19)
    fireEvent.click(screen.getByRole('button', { name: '次へ' }))
    expect(history.getAllByRole('button')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '前へ' }))
    expect(history.getByText('取込失敗・理由を確認')).toBeVisible()
    expect(history.queryByText('確認待ち')).not.toBeInTheDocument()
    expect(rail.getByRole('button', { name: '要員' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('button', { name: '要員に戻る' }))
    fireEvent.click(screen.getAllByRole('button', { name: '要員を取り込む' })[0]!)
    fireEvent.click(screen.getByRole('menuitem', { name: '要員紹介を貼り付け' }))
    expect(await screen.findByText('対応が必要な取込エラー (1)')).toBeVisible()
    fireEvent.click(screen.getByText('対応が必要な取込エラー (1)'))
    fireEvent.click(screen.getByRole('button', { name: /失敗理由を確認/u }))
    expect(await screen.findByRole('button', { name: '要員に戻る' })).toBeVisible()
    expect(screen.queryByRole('region', { name: '要員一覧' })).not.toBeInTheDocument()
  })

  it('keeps legacy proposal tasks out of Agent and preserves drafts when opening business intake', async () => {
    cleanup()
    const connected = {
      ...bootstrap,
      aiCommerce: { ...bootstrap.aiCommerce, configuration: 'ready' as const, connection: 'connected' as const }
    }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue(connected)
    render(<App />)
    await screen.findByRole('main', { name: 'SES Agent' })
    fireEvent.click(screen.getByRole('button', { name: 'Agentに質問' }))
    await screen.findByRole('main', { name: 'SES Agent' })
    fireEvent.change(screen.getByRole('textbox', { name: 'SES Agent への指示' }), { target: { value: 'Unsaved HR question' } })
    expect(screen.queryByRole('navigation', { name: '業務ステータス' })).not.toBeInTheDocument()
    const rail = within(screen.getByRole('complementary', { name: 'システムナビゲーション' }))
    expect(rail.getByRole('button', { name: 'Agent' })).toBeVisible()
    expect(rail.queryByLabelText('確認が必要な操作あり')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /確認が必要な操作を開く|レビューセンターを開く/u })).not.toBeInTheDocument()
    expect(screen.queryByText(bootstrap.tasks[1]!.title)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '案件を追加' }))
    expect(await screen.findByRole('complementary', { name: '業務ワークスペース' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '案件内容' })).toBeVisible()
    expect(screen.queryByRole('complementary', { name: 'SES Agent' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'レビューセンター' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Agentに質問' }))
    expect(screen.queryByRole('complementary', { name: '業務ワークスペース' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'SES Agent への指示' })).toHaveValue('Unsaved HR question')

    fireEvent.click(within(screen.getByRole('complementary', { name: 'システムナビゲーション' })).getByRole('button', { name: '案件' }))
    expect(screen.queryByRole('complementary', { name: '業務ワークスペース' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '案件一覧' })).toBeVisible()
  })

  it('lands an unconnected operator in AgentWorkspace with a local-intake-only composer', async () => {
    cleanup()
    const unconnected = {
      ...bootstrap,
      aiCommerce: { ...bootstrap.aiCommerce, connection: 'not-connected' as const }
    }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue(unconnected)
    render(<App />)
    await screen.findByRole('main', { name: 'SES Agent' })
    fireEvent.click(screen.getByRole('button', { name: 'Agentに質問' }))
    expect(await screen.findByRole('main', { name: 'SES Agent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '受管アカウントに接続' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /履歴書を取り込む/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /案件を取り込む/ })).toBeInTheDocument()
    // The composer stays for deterministic local intake; the offline banner
    // says natural-language chat needs the managed connection, and the cloud
    // model picker is withheld.
    const composer = screen.getByRole('textbox', { name: 'SES Agent への指示' })
    expect(composer).toHaveAttribute('placeholder', '案件または要員の情報を1件貼り付けてローカル取込…')
    expect(screen.getByText(/ローカル操作のみ利用できます/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '回答モデルを選択' })).not.toBeInTheDocument()
  })

  it('refuses to send text over 4,000 characters without truncating it', async () => {
    cleanup()
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue(bootstrap)
    render(<App />)
    await screen.findByRole('main', { name: 'SES Agent' })
    fireEvent.click(screen.getByRole('button', { name: 'Agentに質問' }))
    const composer = await screen.findByRole('textbox', { name: 'SES Agent への指示' })

    const overlong = `案件名：テスト\n${'あ'.repeat(4_100)}`
    fireEvent.change(composer, { target: { value: overlong } })
    expect(await screen.findByText(/4,000文字を超えています/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '送信' })).toBeDisabled()
    // Nothing was truncated: the composer still holds every character.
    expect((composer as HTMLTextAreaElement).value).toHaveLength(overlong.length)
    expect(window.sesAgent.executeAgentTurn).not.toHaveBeenCalled()

    fireEvent.change(composer, { target: { value: '案件名：テスト' } })
    expect(screen.queryByText(/4,000文字を超えています/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '送信' })).toBeEnabled()
  })

  it('uses a standalone Agent shell without the classic matching page', async () => {
    await screen.findByRole('main', { name: 'SES Agent' })
    fireEvent.click(screen.getByRole('button', { name: 'Agentに質問' }))
    await screen.findByRole('main', { name: 'SES Agent' })
    fireEvent.click(screen.getByRole('button', { name: '会話管理' }))
    expect(screen.getByRole('region', { name: '会話' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '業務概要' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'マッチングをプレビュー' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'メインナビゲーション' })).not.toBeInTheDocument()
  })

  it('redirects the candidate pool command to the HR person list instead of the legacy library', async () => {
    await waitForHrShell()
    await pressCommandShortcut()
    fireEvent.change(await screen.findByRole('textbox', { name: '業務コマンドを検索' }), { target: { value: '候補者プール' } })
    fireEvent.click(screen.getByRole('option', { name: /要員一覧を開く/ }))
    expect(await screen.findByRole('region', { name: '要員一覧' })).toBeVisible()
    expect(hrRail().getByRole('button', { name: '要員' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('heading', { name: '人材プール' })).not.toBeInTheDocument()
    expect(window.sesAgent.searchCandidateProfiles).not.toHaveBeenCalled()
  })

  it('opens HR lists, follow-ups and intake from palette commands and leaves no legacy dashboard command', async () => {
    await waitForHrShell()
    await pressCommandShortcut()
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent ?? '')
    for (const label of [
      '要員を探す',
      '案件を探す',
      '案件一覧を開く',
      '要員一覧を開く',
      '対応記録を開く',
      '案件を追加',
      '要員を取り込む'
    ]) {
      expect(options.some((text) => text.startsWith(label))).toBe(true)
    }
    expect(options.some((text) => /案件レビューを開く|候補者プールを開く/.test(text))).toBe(false)
    await chooseCommand(/対応記録を開く/)
    expect(await screen.findByRole('region', { name: '業務の対応記録' })).toBeVisible()
    expect(hrRail().getByRole('button', { name: '対応記録' })).toHaveAttribute('aria-current', 'page')

    await pressCommandShortcut()
    await chooseCommand(/^案件を追加/)
    expect(await screen.findByRole('textbox', { name: '案件内容' })).toBeVisible()
    expect(hrRail().getByRole('button', { name: '案件' })).toHaveAttribute('aria-current', 'page')

    await pressCommandShortcut()
    // No case is selected, so 找人 opens the case list to pick one.
    await chooseCommand(/^要員を探す/)
    expect(await screen.findByRole('region', { name: '案件一覧' })).toBeVisible()
    expect(hrRail().getByRole('button', { name: '案件' })).toHaveAttribute('aria-current', 'page')

    await pressCommandShortcut()
    await chooseCommand(/^要員を取り込む/)
    expect(hrRail().getByRole('button', { name: '要員' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('complementary', { name: '業務ワークスペース' })).toHaveTextContent('情報整理')
  })

  it('switches rail items with Cmd/Ctrl+1–5 in rail order and shows the command hint in the HR shell', async () => {
    await waitForHrShell()
    const press = async (key: string, init: KeyboardEventInit = { metaKey: true }) => {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
      })
    }
    expect(
      hrRail()
        .getAllByRole('button')
        .map((button) => button.querySelector('span')?.textContent)
    ).toEqual(['今日', '案件', '要員', '対応記録', 'Agent', 'コマンド', '設定'])
    await press('3')
    expect(hrRail().getByRole('button', { name: '要員' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('region', { name: '要員一覧' })).toBeVisible()
    await press('4', { ctrlKey: true })
    expect(hrRail().getByRole('button', { name: '対応記録' })).toHaveAttribute('aria-current', 'page')
    await press('2')
    expect(hrRail().getByRole('button', { name: '案件' })).toHaveAttribute('aria-current', 'page')
    await press('1')
    expect(hrRail().getByRole('button', { name: '今日' })).toHaveAttribute('aria-current', 'page')
    expect(hrRail().getByRole('button', { name: '案件' })).not.toHaveAttribute('aria-current')
    expect(await screen.findByRole('region', { name: '今日' })).toBeVisible()
    await press('2')
    // A plain digit (typing in a field) never navigates.
    await press('3', {})
    expect(hrRail().getByRole('button', { name: '案件' })).toHaveAttribute('aria-current', 'page')
    await press('5')
    expect(await screen.findByRole('textbox', { name: 'SES Agent への指示' })).toBeInTheDocument()
    expect(hrRail().getByRole('button', { name: 'コマンド' })).toHaveAttribute('title', expect.stringMatching(/1–5 で切替/u))

    fireEvent.click(hrRail().getByRole('button', { name: 'コマンド' }))
    expect(await screen.findByRole('dialog', { name: '業務コマンド' })).toBeInTheDocument()
    await press('3')
    expect(screen.queryByRole('dialog', { name: '業務コマンド' })).not.toBeInTheDocument()
    expect(hrRail().getByRole('button', { name: '要員' })).toHaveAttribute('aria-current', 'page')
  })

  it('reopens the palette with ⌘K pressed right after a command closes it, before React re-renders', async () => {
    await waitForHrShell()
    await pressCommandShortcut()
    fireEvent.click(await screen.findByRole('option', { name: /対応記録を開く/ }))
    // Let the command finish and close the palette without waiting for the re-render that follows.
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve()
    await pressCommandShortcut()
    expect(await screen.findByRole('dialog', { name: '業務コマンド' })).toBeInTheDocument()
    expect(hrRail().getByRole('button', { name: '対応記録' })).toHaveAttribute('aria-current', 'page')
    await pressCommandShortcut()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '業務コマンド' })).not.toBeInTheDocument())
  })

  it('finds cases and people by name in the palette and opens them in the HR list', async () => {
    cleanup()
    const { candidate, job, feed } = hrObjects()
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue({ ...bootstrap, candidateReviews: [candidate], jobCaseReviews: [job] })
    vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue(feed)
    vi.mocked(window.sesAgent.getPersonnelWorkspace).mockResolvedValue({ templates: builtInPersonnelTemplates(), states: [], copies: [] })
    render(<App />)
    await waitForHrShell()
    await pressCommandShortcut()
    // Object entries stay out of the unfiltered list.
    expect(screen.queryByRole('option', { name: /Java project/ })).not.toBeInTheDocument()
    const search = await screen.findByRole('textbox', { name: '業務コマンドを検索' })
    fireEvent.change(search, { target: { value: 'selected engineer' } })
    await chooseCommand(/Selected Engineer\.xlsx/)
    expect(hrRail().getByRole('button', { name: '要員' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('article', { name: 'Selected Engineer' })).toHaveAttribute('aria-current', 'true')

    await pressCommandShortcut()
    fireEvent.change(await screen.findByRole('textbox', { name: '業務コマンドを検索' }), { target: { value: 'java proj' } })
    await chooseCommand(/Java project/)
    expect(hrRail().getByRole('button', { name: '案件' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('article', { name: 'Java project' })).toHaveAttribute('aria-current', 'true')

    // With the case now selected, 找人 runs for it instead of only opening the list.
    await pressCommandShortcut()
    await chooseCommand(/^要員を探す.*Java project/)
    await waitFor(() => expect(window.sesAgent.findPersonnelForCase).toHaveBeenCalledTimes(1))
    // The palette lands on the case's results page in the main area, in place of the case list.
    expect(await screen.findByRole('region', { name: '案件の要員検索' })).toBeVisible()
    expect(screen.getByRole('article', { name: 'Java project', hidden: true })).not.toBeVisible()
    expect(screen.queryByRole('complementary', { name: '業務ワークスペース' })).not.toBeInTheDocument()
  })

  it('lists every pair a batch follow-up started instead of silently opening only the first', async () => {
    cleanup()
    const { documentId, candidate, job, feed, matchItem } = hrObjects()
    const second: JobCaseReviewSnapshot = {
      ...job,
      reviewId: '55555555-5555-4555-8555-555555555555',
      redactedSubject: 'Go project',
      fields: job.fields.map((field) => ({ ...field, value: 'Go project', originalValue: 'Go project' })),
      jobCase: { ...job.jobCase!, id: '66666666-6666-4666-8666-666666666666', sourceReviewId: '55555555-5555-4555-8555-555555555555' }
    }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue({
      ...bootstrap,
      candidateReviews: [candidate],
      jobCaseReviews: [job, second]
    })
    vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue(feed)
    vi.mocked(window.sesAgent.getPersonnelWorkspace).mockResolvedValue({ templates: builtInPersonnelTemplates(), states: [], copies: [] })
    vi.mocked(window.sesAgent.findCasesForPersonnel).mockResolvedValue({
      documentId,
      profileVersion: 1,
      localMatchCount: 2,
      cloud: { status: 'reviewed', reviewedCount: 2, modelName: 'Test AI' },
      items: [matchItem, { ...matchItem, reviewId: second.reviewId, jobCaseId: second.jobCase!.id, title: 'Go project', score: 80 }]
    } as Awaited<ReturnType<DesktopApi['findCasesForPersonnel']>>)
    render(<App />)
    await waitForHrShell()
    fireEvent.click(hrRail().getByRole('button', { name: '要員' }))
    const card = await screen.findByRole('article', { name: 'Selected Engineer' })
    fireEvent.click(within(card).getByRole('button', { name: '案件を探す' }))
    const matching = await screen.findByRole('region', { name: 'この要員の案件を探す' })
    for (const box of await within(matching).findAllByRole('checkbox', { name: 'この案件を選択' })) fireEvent.click(box)
    fireEvent.click(within(matching).getByRole('button', { name: '選択した案件の対応を開始（2）' }))
    await waitFor(() =>
      expect(window.sesAgent.beginBusinessProgress).toHaveBeenCalledWith([
        { documentId, reviewId: job.reviewId },
        { documentId, reviewId: second.reviewId }
      ])
    )
    const summary = await screen.findByRole('status', { name: '一括で対応を開始' })
    expect(summary).toHaveTextContent('2 件の組み合わせで対応を開始しました')
    const pairs = within(summary).getAllByRole('button', { name: /Selected Engineer\.xlsx · / })
    expect(pairs.map((pair) => pair.textContent)).toEqual(['Selected Engineer.xlsx · Java project', 'Selected Engineer.xlsx · Go project'])
    expect(pairs[0]).toHaveAttribute('aria-current', 'true')
    fireEvent.click(pairs[1]!)
    expect(pairs[1]).toHaveAttribute('aria-current', 'true')
    expect(pairs[0]).not.toHaveAttribute('aria-current')
    fireEvent.click(within(summary).getByRole('button', { name: 'お知らせを閉じる' }))
    expect(screen.queryByRole('status', { name: '一括で対応を開始' })).not.toBeInTheDocument()
  })

  it('opens where the menu-bar panel asked, once per request, and only prefills the Agent question', async () => {
    cleanup()
    let navigate!: (navigation: TrayNavigation) => void
    window.sesAgent.onTrayNavigate = vi.fn((listener: (navigation: TrayNavigation) => void) => {
      navigate = listener
      return () => undefined
    })
    render(<App />)
    await waitForHrShell()
    act(() => navigate({ id: '11111111-1111-4111-8111-111111111111', route: 'followups', followUpFilter: 'today' }))
    expect(await screen.findByRole('button', { name: /^今日の対応/u })).toHaveAttribute('aria-pressed', 'true')
    expect(hrRail().getByRole('button', { name: '対応記録' })).toHaveAttribute('aria-current', 'page')

    act(() => navigate({ id: '22222222-2222-4222-8222-222222222222', route: 'cases', caseView: 'unseen' }))
    expect(await screen.findByRole('button', { name: /^未読/u })).toHaveAttribute('aria-pressed', 'true')
    expect(hrRail().getByRole('button', { name: '案件' })).toHaveAttribute('aria-current', 'page')

    act(() => navigate({ id: '33333333-3333-4333-8333-333333333333', route: 'agent', text: '今日の新着案件は？' }))
    expect(await screen.findByRole('textbox', { name: 'SES Agent への指示' })).toHaveValue('今日の新着案件は？')
    expect(window.sesAgent.executeAgentTurn).not.toHaveBeenCalled()

    // A repeated request (the window re-subscribed and took it again) does nothing.
    fireEvent.click(hrRail().getByRole('button', { name: '案件' }))
    act(() => navigate({ id: '11111111-1111-4111-8111-111111111111', route: 'followups', followUpFilter: 'today' }))
    expect(hrRail().getByRole('button', { name: '案件' })).toHaveAttribute('aria-current', 'page')

    act(() => navigate({ id: '44444444-4444-4444-8444-444444444444', route: 'settings:integrations' }))
    const settings = await screen.findByRole('dialog', { name: '設定' })
    expect(within(settings).getByRole('button', { name: /外部システム/u })).toHaveAttribute('aria-current', 'page')

    // 换模型 from a credit refusal: the settings open on AI モデル, also when they are already open.
    act(() => navigate({ id: '55555555-5555-4555-8555-555555555555', route: 'settings:models' }))
    expect(within(settings).getByRole('button', { name: /AIモデル/u })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(within(settings).getByRole('button', { name: /一般設定/u }))
    act(() => navigate({ id: '66666666-6666-4666-8666-666666666666', route: 'settings:models' }))
    expect(within(settings).getByRole('button', { name: /AIモデル/u })).toHaveAttribute('aria-current', 'page')
  })

  const opportunityFixture = () => {
    const objects = hrObjects()
    const { documentId, candidate, job, feed } = objects
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue({ ...bootstrap, candidateReviews: [candidate], jobCaseReviews: [job] })
    vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue(feed)
    vi.mocked(window.sesAgent.getPersonnelWorkspace).mockResolvedValue({ templates: builtInPersonnelTemplates(), states: [], copies: [] })
    const opportunity = {
      id: 'opportunity-1',
      fingerprint: 'f'.repeat(64),
      documentId,
      reviewId: job.reviewId,
      jobCaseId: job.jobCase!.id,
      personName: 'Selected Engineer',
      caseTitle: 'Java project',
      status: 'recommended',
      reasons: ['Java'],
      confirm: ['Spring'],
      updatedAt: new Date().toISOString(),
      state: 'new'
    }
    window.sesAgent.listMatchingOpportunities = vi.fn(async () => [opportunity]) as unknown as DesktopApi['listMatchingOpportunities']
    window.sesAgent.controlMatchingOpportunity = vi.fn(async () => [
      { ...opportunity, state: 'seen' }
    ]) as unknown as DesktopApi['controlMatchingOpportunity']
    vi.mocked(window.sesAgent.findCasesForPersonnel).mockReturnValue(new Promise(() => undefined))
    vi.mocked(window.sesAgent.findPersonnelForCase).mockReturnValue(new Promise(() => undefined))
    return objects
  }
  const opportunitiesPage = () => screen.getByRole('region', { name: '新しいマッチング候補' })

  it('opens 新匹配机会 from the list banner and returns from its results to it, then to the list', async () => {
    cleanup()
    opportunityFixture()
    render(<App />)
    await waitForHrShell()
    fireEvent.click(hrRail().getByRole('button', { name: '案件' }))
    fireEvent.click(await screen.findByRole('button', { name: '新しいマッチング候補を見る（1）' }))
    const page = opportunitiesPage()
    expect(page).toBeVisible()
    expect(within(page).getByRole('heading', { name: '新しいマッチング候補 (1)' })).toBeVisible()
    expect(within(page).getByRole('button', { name: '案件別' })).toHaveAttribute('aria-pressed', 'true')
    expect(hrRail().getByRole('button', { name: '案件' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(within(page).getByRole('button', { name: /^マッチングを見る：/u }))
    const results = await screen.findByRole('region', { name: '案件の要員検索' })
    expect(window.sesAgent.controlMatchingOpportunity).toHaveBeenCalledWith({
      id: 'opportunity-1',
      fingerprint: 'f'.repeat(64),
      action: 'seen'
    })
    expect(within(results).queryByRole('button', { name: /案件一覧に戻る/ })).not.toBeInTheDocument()
    fireEvent.click(within(results).getByRole('button', { name: '← 新しいマッチング候補に戻る' }))
    await waitFor(() => expect(opportunitiesPage()).toBeVisible())
    expect(screen.queryByRole('region', { name: '案件の要員検索' })).not.toBeInTheDocument()
    fireEvent.click(within(opportunitiesPage()).getByRole('button', { name: '← 案件一覧に戻る' }))
    expect(await screen.findByRole('region', { name: '案件一覧' })).toBeVisible()
    expect(screen.queryByRole('region', { name: '新しいマッチング候補' })).not.toBeInTheDocument()
    // The same results opened from the list still go back to the list.
    fireEvent.click(
      within(await screen.findByRole('article', { name: 'Java project' })).getByRole('button', { name: /^要員を(探す|見る)/u })
    )
    const fromList = await screen.findByRole('region', { name: '案件の要員検索' })
    expect(within(fromList).getByRole('button', { name: '← 案件一覧に戻る' })).toBeVisible()
    fireEvent.click(within(fromList).getByRole('button', { name: '← 案件一覧に戻る' }))
    expect(await screen.findByRole('region', { name: '案件一覧' })).toBeVisible()
  })

  it("opens a person-grouped opportunity as the person's 找案件 and returns to 新匹配机会 on the person side", async () => {
    cleanup()
    opportunityFixture()
    render(<App />)
    await waitForHrShell()
    fireEvent.click(hrRail().getByRole('button', { name: '要員' }))
    fireEvent.click(await screen.findByRole('button', { name: '新しいマッチング候補を見る（1）' }))
    expect(within(opportunitiesPage()).getByRole('button', { name: '要員別' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(opportunitiesPage()).getByRole('button', { name: /^マッチングを見る：/u }))
    const matching = await screen.findByRole('region', { name: 'この要員の案件を探す' })
    expect(hrRail().getByRole('button', { name: '要員' })).toHaveAttribute('aria-current', 'page')
    expect(window.sesAgent.findPersonnelForCase).not.toHaveBeenCalled()
    fireEvent.click(within(matching).getByRole('button', { name: '← 新しいマッチング候補に戻る' }))
    await waitFor(() => expect(opportunitiesPage()).toBeVisible())
    expect(within(opportunitiesPage()).getByRole('button', { name: '← 要員一覧に戻る' })).toBeVisible()
  })

  it('opens 新匹配机会 from the menu-bar panel and from the command palette', async () => {
    cleanup()
    opportunityFixture()
    let navigate!: (navigation: TrayNavigation) => void
    window.sesAgent.onTrayNavigate = vi.fn((listener: (navigation: TrayNavigation) => void) => {
      navigate = listener
      return () => undefined
    })
    render(<App />)
    await waitForHrShell()
    act(() => navigate({ id: '77777777-7777-4777-8777-777777777777', route: 'cases', caseView: 'opportunities' }))
    await waitFor(() => expect(opportunitiesPage()).toBeVisible())
    expect(hrRail().getByRole('button', { name: '案件' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(hrRail().getByRole('button', { name: '要員' }))
    expect(screen.queryByRole('region', { name: '新しいマッチング候補' })).not.toBeInTheDocument()
    await pressCommandShortcut()
    fireEvent.click(await screen.findByRole('option', { name: /新しいマッチング候補を見る/u }))
    await waitFor(() => expect(opportunitiesPage()).toBeVisible())
    expect(within(opportunitiesPage()).getByRole('button', { name: '← 要員一覧に戻る' })).toBeVisible()
  })

  const todayFixture = (objects = hrObjects()) => {
    const { documentId, job } = objects
    const summary: TodaySummary = {
      status: 'ready',
      locale: 'ja-JP',
      generatedAt: new Date().toISOString(),
      today: '2026-09-30',
      showPersonNames: true,
      followUpsDueToday: 3,
      cases: { newToday: 2, unseen: 1 },
      matching: { newOpportunities: 1, proposable: 1 },
      interviews: { coordinating: 1, today: 1, next: null },
      ai: { state: 'ok', availableCredits: 500, reservedCredits: 0, fraction: 0.5 },
      alerts: ['gmail-sync-failed'],
      week: { casesCreated: 4, recommended: 2, started: 1 },
      lists: {
        followUps: [
          {
            id: 'follow-1',
            documentId,
            reviewId: job.reviewId,
            personName: 'Selected Engineer',
            caseTitle: 'Java project',
            stage: 'coordinating',
            stageLabel: '日程調整中',
            action: '面談を予約',
            when: null
          }
        ],
        interviews: [
          {
            kind: 'client',
            followUpId: 'follow-1',
            documentId,
            reviewId: job.reviewId,
            at: '2026-09-30T05:00:00.000Z',
            durationMinutes: 60,
            roundNumber: 1,
            caseTitle: 'Java project',
            personName: 'Selected Engineer'
          }
        ],
        opportunities: {
          proposable: [
            {
              id: 'opportunity-1',
              documentId,
              reviewId: job.reviewId,
              jobCaseId: job.jobCase!.id,
              personName: 'Selected Engineer',
              caseTitle: 'Java project',
              score: 88,
              confirm: []
            }
          ],
          needsInfo: []
        },
        unseenCases: [{ reviewId: job.reviewId, title: 'Java project', sourceAt: '2026-09-30T01:00:00.000Z' }]
      }
    }
    window.sesAgent.getTodaySummary = vi.fn(async () => summary)
    window.sesAgent.onTodaySummaryChanged = vi.fn(() => () => undefined)
    return summary
  }
  const todayPage = () => screen.getByRole('region', { name: '今日' })

  it('opens on 今天 at launch, first in the rail with the to-do badge, and links each block to its screen', async () => {
    cleanup()
    opportunityFixture()
    const summary = todayFixture()
    render(<App />)
    await waitForHrShell()
    expect(await screen.findByRole('button', { name: '対応 3 件・面談 1 件' })).toBeVisible()
    expect(within(todayPage()).getByRole('heading', { name: '今日 9/30（水）' })).toBeVisible()
    expect(hrRail().getByRole('button', { name: /^今日/u })).toHaveAttribute('aria-current', 'page')
    expect(hrRail().getByLabelText('今日の対応 3 件')).toHaveTextContent('3')
    expect(hrRail().getByRole('button', { name: /^案件/u })).not.toHaveAttribute('aria-current')
    // The rail's unread count is the same one 今天 shows.
    expect(hrRail().getByRole('button', { name: /^案件/u })).toHaveTextContent(String(summary.cases.unseen || ''))
    expect(window.sesAgent.getTodaySummary).toHaveBeenCalled()
    for (const block of ['今日の対応', '今日の面談', '先に見たいマッチング候補', '新着案件', '今週のまとめ'])
      expect(within(todayPage()).getByRole('region', { name: block })).toBeVisible()
    expect(within(todayPage()).getByRole('list', { name: '対応が必要なお知らせ' })).toHaveTextContent('Gmail の同期に失敗しました')

    // A follow-up row opens 跟进.
    fireEvent.click(within(within(todayPage()).getByRole('region', { name: '今日の対応' })).getByRole('button', { name: /面談を予約/u }))
    expect(hrRail().getByRole('button', { name: '対応記録' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('region', { name: '今日' })).not.toBeInTheDocument()

    // A new case opens in the case list.
    fireEvent.click(hrRail().getByRole('button', { name: /^今日/u }))
    fireEvent.click(within(await screen.findByRole('region', { name: '新着案件' })).getByRole('button', { name: /Java project/u }))
    expect(hrRail().getByRole('button', { name: /^案件/u })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('region', { name: '案件一覧' })).toBeVisible()

    // 问 Agent only prefills the composer.
    fireEvent.click(hrRail().getByRole('button', { name: /^今日/u }))
    fireEvent.change(within(await screen.findByRole('region', { name: '今日' })).getByRole('textbox', { name: 'Agent に質問' }), {
      target: { value: '今日の面談は？' }
    })
    fireEvent.click(within(todayPage()).getByRole('button', { name: 'Agent で開く' }))
    expect(await screen.findByRole('textbox', { name: 'SES Agent への指示' })).toHaveValue('今日の面談は？')
    expect(window.sesAgent.executeAgentTurn).not.toHaveBeenCalled()
  })

  it('opens a 今天 opportunity like the 新匹配机会 page and comes back with 「← 返回今天」', async () => {
    cleanup()
    opportunityFixture()
    todayFixture()
    render(<App />)
    await waitForHrShell()
    const block = await screen.findByRole('region', { name: '先に見たいマッチング候補' })
    expect(within(block).getByRole('heading', { name: '提案可能' })).toBeVisible()
    await waitFor(() => expect(window.sesAgent.listMatchingOpportunities).toHaveBeenCalled())
    fireEvent.click(within(block).getByRole('button', { name: /Selected Engineer/u }))
    const results = await screen.findByRole('region', { name: '案件の要員検索' })
    expect(window.sesAgent.controlMatchingOpportunity).toHaveBeenCalledWith({
      id: 'opportunity-1',
      fingerprint: 'f'.repeat(64),
      action: 'seen'
    })
    expect(within(results).queryByRole('button', { name: /案件一覧に戻る/u })).not.toBeInTheDocument()
    fireEvent.click(within(results).getByRole('button', { name: '← 今日に戻る' }))
    await waitFor(() => expect(todayPage()).toBeVisible())
    expect(hrRail().getByRole('button', { name: /^今日/u })).toHaveAttribute('aria-current', 'page')
  })

  it('sends the batch import page back to the HR case list instead of a separate case database', async () => {
    await waitForHrShell()
    fireEvent.click(hrRail().getByRole('button', { name: '案件' }))
    expect(screen.queryByRole('button', { name: '案件の全資料' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '一括取込' }))
    expect(await screen.findByRole('heading', { name: '案件をインポート' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /案件一覧を開く/u }))
    expect(await screen.findByRole('region', { name: '案件一覧' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: '案件データベース' })).not.toBeInTheDocument()
    expect(hrRail().getByRole('button', { name: '案件' })).toHaveAttribute('aria-current', 'page')
  })

  it('reaches every sub-page from its rail section and returns with 「返回<section>」', async () => {
    await waitForHrShell()
    const visit = async (section: string, open: () => void, heading: string, back: string) => {
      fireEvent.click(hrRail().getByRole('button', { name: section }))
      open()
      expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
      expect(hrRail().getByRole('button', { name: section })).toHaveAttribute('aria-current', 'page')
      fireEvent.click(screen.getByRole('button', { name: back }))
      await waitFor(() => expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument())
    }
    const fromMore = (item: string) => () => {
      fireEvent.click(screen.getByRole('button', { name: 'その他' }))
      fireEvent.click(screen.getByRole('menuitem', { name: item }))
    }
    await visit('案件', () => fireEvent.click(screen.getByRole('button', { name: '一括取込' })), '案件をインポート', '案件に戻る')
    await visit('要員', () => fireEvent.click(screen.getByRole('button', { name: '採用面談' })), '採用面談', '要員に戻る')
    await visit('要員', () => fireEvent.click(screen.getByRole('button', { name: '取込履歴' })), '要員の取込履歴', '要員に戻る')
    await visit('対応記録', () => fireEvent.click(screen.getByRole('button', { name: '面談日程' })), '面談日程', '対応記録に戻る')
    await visit('案件', fromMore('レビューセンター'), 'レビューセンター', '案件に戻る')
    await visit('要員', fromMore('アクティビティ'), 'アクティビティ', '要員に戻る')
  })

  it('opens the unified sub-page commands from the palette under their HR section', async () => {
    await waitForHrShell()
    const cases: Array<[RegExp, string, string]> = [
      [/案件を一括取込/u, '案件をインポート', '案件'],
      [/採用面談/u, '採用面談', '要員'],
      [/面談日程/u, '面談日程', '対応記録']
    ]
    for (const [option, heading, section] of cases) {
      await pressCommandShortcut()
      await chooseCommand(option)
      expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
      expect(hrRail().getByRole('button', { name: section })).toHaveAttribute('aria-current', 'page')
    }
    await pressCommandShortcut()
    await chooseCommand(/案件を配信/u)
    expect(await screen.findByRole('region', { name: '案件一覧' })).toBeVisible()
    expect(hrRail().getByRole('button', { name: '案件' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('complementary', { name: '業務ワークスペース' })).toBeInTheDocument()
  })

  it('opens review center items in the HR lists instead of a separate case or person page', async () => {
    cleanup()
    const { candidate, job, feed } = hrObjects()
    const draft = { ...job, status: 'awaiting-review' as const, jobCase: null, completedAt: null }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue({ ...bootstrap, candidateReviews: [candidate], jobCaseReviews: [draft] })
    vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue(feed)
    vi.mocked(window.sesAgent.getPersonnelWorkspace).mockResolvedValue({ templates: builtInPersonnelTemplates(), states: [], copies: [] })
    render(<App />)

    await runBusinessCommand(/レビューセンターを開く/u)
    fireEvent.click(await screen.findByRole('button', { name: 'Java projectの詳細を開く' }))
    expect(await screen.findByRole('article', { name: 'Java project' })).toHaveAttribute('aria-current', 'true')
    expect(hrRail().getByRole('button', { name: '案件' })).toHaveAttribute('aria-current', 'page')

    await pressCommandShortcut()
    await chooseCommand(/レビューセンターを開く/u)
    fireEvent.click(await screen.findByRole('button', { name: '候補者プロフィールを確認の詳細を開く' }))
    expect(await screen.findByRole('article', { name: 'Selected Engineer' })).toHaveAttribute('aria-current', 'true')
    expect(hrRail().getByRole('button', { name: '要員' })).toHaveAttribute('aria-current', 'page')
  })

  it('executes and persists a candidate-match task through the main-process use case', async () => {
    const task = bootstrap.tasks.find((item) => item.type === 'MATCH_CANDIDATES')!
    const updatedTask = {
      ...task,
      status: 'awaiting_review' as const,
      progress: 85,
      evidenceCount: 1,
      steps: task.steps.map((step, index) => ({ ...step, status: index < 3 ? ('completed' as const) : ('blocked' as const) }))
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
        evaluation: {
          resultCount: 1,
          feedbackCount: 0,
          suitableCount: 0,
          unsuitableCount: 0,
          coveragePercent: 0,
          judgedNdcgAt20: null,
          recallAt20: null,
          recallStatus: 'requires-known-relevant-total'
        }
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
      matches: [
        {
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
          retrieval: {
            strategy: 'hard-filter-hybrid-rrf-v1',
            hardFilterPolicyVersion: 'tri-state-v3',
            bm25Score: 1.94,
            vectorScore: 0.91,
            fusionScore: 0.032787,
            rerankerScore: null,
            bm25Rank: 1,
            vectorRank: 1,
            preRerankRank: null,
            rerankerRank: null,
            rank: 1,
            termCoverage: 100,
            indexedFieldCount: 1,
            hardFilters: []
          }
        }
      ]
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
        evaluation: {
          resultCount: 1,
          feedbackCount: 1,
          suitableCount: 1,
          unsuitableCount: 0,
          coveragePercent: 100,
          judgedNdcgAt20: 1,
          recallAt20: null,
          recallStatus: 'requires-known-relevant-total'
        }
      },
      matchResultId: 'c605a5ee-7c9b-401c-8546-ae18c02b3a9f',
      feedback: {
        decision: 'suitable',
        reasonCode: 'strong_project_fit',
        note: null,
        reviewerDisplayName: '山田 太郎',
        revision: 1,
        reviewedAt: '2026-07-17T01:01:00.000Z'
      }
    })

    await runBusinessCommand(/アクティビティを開く/)
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(task.title) }))
    expect(await screen.findByRole('heading', { name: '候補者 38DCA6F6' })).toBeInTheDocument()
    expect(screen.getByText('統合 Rank 1')).toBeInTheDocument()
    expect(window.sesAgent.executeCandidateMatchTask).toHaveBeenCalledWith(task.id)
    expect(screen.getByText('確認済み要員プールを検索しました')).toBeInTheDocument()
    expect(screen.getByText('処理ジョブ')).toBeInTheDocument()
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
    await waitForHrShell()
    expect(hrRail().queryByRole('button', { name: '履歴書取込' })).not.toBeInTheDocument()
    fireEvent.click(hrRail().getByRole('button', { name: '要員' }))
    fireEvent.click(screen.getAllByRole('button', { name: '要員を取り込む' })[0]!)
    fireEvent.click(screen.getByRole('menuitem', { name: '履歴書ファイルを取り込む' }))
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
          analysisVersion: 'resume-analysis-v6',
          fileToken: secondFile.token,
          fileName: secondFile.name,
          status: 'requires-pii-review',
          cloudEligible: false,
          statistics: { pages: 1, sheets: 0, blocks: 1, characters: 10 },
          detectedIdentifiers: [],
          localProcessing: { ocr: 'not-required', ocrPages: 0, personNameCandidates: 0, networkAccess: false },
          extractedFields: [],
          warningCodes: [],
          redactedPreview: '',
          analyzedAt: '2026-07-20T00:00:00.000Z'
        },
        processingJob: {
          id: '58dca6f6-947b-45d5-98bc-c9e6dcd242e9',
          type: 'resume-analysis',
          workTaskId: task.id,
          taskStepId: 'step-1',
          status: 'succeeded',
          replayPolicy: 'safe-local',
          progress: 100,
          attemptCount: 1,
          maxAttempts: 3,
          nextRetryAt: null,
          leaseExpiresAt: null,
          cancelRequestedAt: null,
          errorCode: null,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt
        }
      })
    await waitForHrShell()
    fireEvent.click(hrRail().getByRole('button', { name: '要員' }))
    fireEvent.click(screen.getAllByRole('button', { name: '要員を取り込む' })[0]!)
    fireEvent.click(screen.getByRole('menuitem', { name: '履歴書ファイルを取り込む' }))
    expect(await screen.findByRole('dialog', { name: '履歴書取込の進捗' })).toBeInTheDocument()
    await waitFor(() =>
      expect(window.sesAgent.analyzeResumeFile).toHaveBeenNthCalledWith(2, {
        fileToken: secondFile.token,
        taskId: task.id
      })
    )
    expect(screen.getByText('failed.pdf')).toBeInTheDocument()
    expect(screen.getByText('ready.pdf')).toBeInTheDocument()
    expect(await screen.findByText('取込済み')).toBeInTheDocument()
    expect(screen.getByText(/PDF を解析できませんでした/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '失敗詳細' })).toBeInTheDocument()
    // The imported person's 找案件 closes the drawer and starts matching for exactly that person.
    fireEvent.click(within(screen.getByRole('dialog', { name: '履歴書取込の進捗' })).getByRole('button', { name: 'この要員の案件を探す' }))
    expect(screen.queryByRole('dialog', { name: '履歴書取込の進捗' })).not.toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'この要員の案件を探す' })).toBeVisible()
    expect(hrRail().getByRole('button', { name: '要員' })).toHaveAttribute('aria-current', 'page')
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
        analysisVersion: 'resume-analysis-v6',
        fileToken,
        fileName: 'recovered.pdf',
        status: 'requires-pii-review',
        cloudEligible: false,
        statistics: { pages: 1, sheets: 0, blocks: 1, characters: 10 },
        detectedIdentifiers: [],
        localProcessing: { ocr: 'not-required', ocrPages: 0, personNameCandidates: 0, networkAccess: false },
        extractedFields: [],
        warningCodes: [],
        redactedPreview: '',
        analyzedAt: '2026-07-20T00:00:00.000Z'
      },
      processingJob: {
        id: '78dca6f6-947b-45d5-98bc-c9e6dcd242e9',
        type: 'resume-analysis',
        workTaskId: task.id,
        taskStepId: 'step-1',
        status: 'succeeded',
        replayPolicy: 'safe-local',
        progress: 100,
        attemptCount: 1,
        maxAttempts: 3,
        nextRetryAt: null,
        leaseExpiresAt: null,
        cancelRequestedAt: null,
        errorCode: null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
      }
    })
    render(<App />)

    fireEvent.click(within(await waitForHrShell()).getByRole('button', { name: '要員' }))
    fireEvent.click(screen.getByRole('button', { name: '取込履歴' }))
    // The record names the files it imports, not the fixed task sentence.
    fireEvent.click(await screen.findByRole('button', { name: /履歴書の取込・1件/ }))
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
    await waitForHrShell()
    await waitFor(() => expect(window.sesAgent.getBootstrap).toHaveBeenCalledTimes(2))
  })
  it('opens personnel introductions independently and preserves edits without a promotion gate', async () => {
    cleanup()
    const documentId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const candidate: CandidateReviewSnapshot = {
      documentId,
      fileName: 'Selected Engineer.xlsx',
      reviewRevision: 1,
      status: 'awaiting-review',
      piiReviewed: false,
      fields: [],
      projectExperiences: [],
      completedAt: null,
      reviewerDisplayName: null,
      profile: {
        id: documentId,
        sourceDocumentId: documentId,
        version: 1,
        status: 'current',
        confirmedAt: new Date().toISOString(),
        confirmedBy: '本机导入',
        containsDirectIdentifiers: false
      },
      recruitingStatus: 'pending-review',
      talentPoolStatus: 'none',
      recordStatus: 'active'
    }
    const other = { ...candidate, documentId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', fileName: 'Other Engineer.xlsx' }
    const entry: BusinessFeedEntry = {
      kind: 'person',
      objectId: documentId,
      revision: 'a'.repeat(64),
      title: 'Selected Engineer',
      event: 'created',
      occurredAt: new Date().toISOString(),
      sourceAt: new Date().toISOString(),
      source: 'local-personnel',
      unseen: false,
      deferred: false,
      archived: false,
      businessStatus: 'available',
      needsReview: true,
      fields: [],
      changes: []
    }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue({ ...bootstrap, candidateReviews: [other, candidate] })
    vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([entry])
    vi.mocked(window.sesAgent.getPersonnelWorkspace).mockResolvedValue({ templates: builtInPersonnelTemplates(), states: [], copies: [] })
    render(<App />)
    fireEvent.click(
      within(await screen.findByRole('complementary', { name: 'システムナビゲーション' })).getByRole('button', { name: '要員' })
    )
    fireEvent.click(await screen.findByRole('article', { name: 'Selected Engineer' }))
    const panel = await screen.findByRole('complementary', { name: '業務ワークスペース' })
    // The detail opens as the right pane of the list surface, beside the still visible list.
    const list = screen.getByRole('region', { name: '要員一覧' })
    expect(list).toContainElement(panel)
    expect(list).toHaveClass('has-detail')
    expect(screen.getByRole('article', { name: 'Selected Engineer' })).toBeVisible()
    expect(document.querySelector('.agent-context-workspace')).toBeNull()
    expect(within(panel).getByRole('heading', { name: 'Selected Engineer' })).toBeVisible()
    expect(within(panel).queryByRole('textbox')).not.toBeInTheDocument()
    // Business status is changed right here in the panel; there is no separate status page any more.
    expect(within(panel).getByRole('combobox', { name: '営業状態' })).toHaveValue('available')
    expect(within(panel).queryByRole('button', { name: '状態を管理' })).not.toBeInTheDocument()
    expect(within(panel).getByRole('combobox', { name: '自社所属' })).toBeVisible()
    fireEvent.click(await within(panel).findByRole('button', { name: '紹介を準備' }))
    const dialog = await screen.findByRole('dialog', { name: '要員を紹介' })
    fireEvent.click(await within(dialog).findByRole('tab', { name: '標準' }))
    fireEvent.click(within(dialog).getByRole('tab', { name: '中国語' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: '紹介文' }), { target: { value: 'TEST updated personnel introduction' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '紹介画面を閉じる' }))
    fireEvent.click(within(panel).getByRole('button', { name: '紹介を準備' }))
    expect(await screen.findByRole('textbox', { name: '紹介文' })).toHaveValue('TEST updated personnel introduction')
    expect(screen.getByRole('tab', { name: '中国語' })).toHaveAttribute('aria-selected', 'true')
    expect(window.sesAgent.setCandidateBusinessState).not.toHaveBeenCalled()
    expect(window.sesAgent.submitCandidateReview).not.toHaveBeenCalled()
    expect(window.sesAgent.saveBusinessFollowUp).not.toHaveBeenCalled()
    // Esc closes the detail and gives the list its full width back, with the opened row still marked.
    fireEvent.click(within(screen.getByRole('dialog', { name: '要員を紹介' })).getByRole('button', { name: '紹介画面を閉じる' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('complementary', { name: '業務ワークスペース' })).not.toBeInTheDocument()
    expect(list).not.toHaveClass('has-detail')
    const row = screen.getByRole('article', { name: 'Selected Engineer' })
    expect(row).toHaveAttribute('aria-current', 'true')
    expect(row).toHaveFocus()
    // × in the pane's header closes it the same way.
    fireEvent.click(row)
    const reopened = await screen.findByRole('complementary', { name: '業務ワークスペース' })
    expect(list).toContainElement(reopened)
    fireEvent.click(within(reopened).getByRole('button', { name: '業務パネルを閉じる' }))
    expect(screen.queryByRole('complementary', { name: '業務ワークスペース' })).not.toBeInTheDocument()
    expect(list).not.toHaveClass('has-detail')
  })

  it('drops a resume on the list, keeps the list visible and retains the original case result across panel switches', async () => {
    cleanup()
    const documentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const reviewId = '33333333-3333-4333-8333-333333333333'
    const job = {
      reviewId,
      sourceId: 'manual-1',
      sourceType: 'manual',
      providerMessageId: null,
      threadId: 'manual-1',
      fromDomain: null,
      messageDate: new Date().toISOString(),
      redactedSubject: 'Case Alpha',
      redactedPreview: 'Java',
      reviewRevision: 1,
      status: 'completed',
      privacyReviewed: true,
      fields: [
        {
          key: 'title',
          label: '案件名',
          originalValue: 'Case Alpha',
          value: 'Case Alpha',
          confidence: 1,
          status: 'confirmed',
          sourceLabels: [],
          changed: false,
          changeReason: null
        }
      ],
      warningCodes: [],
      completedAt: new Date().toISOString(),
      reviewerDisplayName: 'HR',
      lifecycle: 'active',
      cloudEligible: false,
      jobCase: {
        id: '44444444-4444-4444-8444-444444444444',
        sourceReviewId: reviewId,
        version: 1,
        status: 'active',
        confirmedAt: new Date().toISOString(),
        confirmedBy: 'HR',
        containsDirectIdentifiers: false
      }
    } as JobCaseReviewSnapshot
    const other = {
      ...job,
      reviewId: '55555555-5555-4555-8555-555555555555',
      redactedSubject: 'Case Beta',
      fields: [{ ...job.fields[0]!, value: 'Case Beta' }],
      jobCase: { ...job.jobCase!, id: '66666666-6666-4666-8666-666666666666' }
    }
    const candidate = {
      documentId,
      fileName: 'Engineer.xlsx',
      localIdentity: { displayName: 'Engineer One' },
      fields: [],
      projectExperiences: [],
      recordStatus: 'active',
      profile: { version: 1 },
      status: 'completed'
    } as unknown as CandidateReviewSnapshot
    const payload = { ...bootstrap, candidateReviews: [candidate], jobCaseReviews: [job, other] }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue(payload)
    vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue(
      [job, other].map((item) => ({
        kind: 'case',
        working: true,
        objectId: item.reviewId,
        revision: 'a'.repeat(64),
        title: item.redactedSubject,
        event: 'created',
        occurredAt: new Date().toISOString(),
        sourceAt: new Date().toISOString(),
        source: 'manual',
        unseen: false,
        deferred: false,
        archived: false,
        businessStatus: 'active',
        needsReview: false,
        fields: [],
        changes: []
      }))
    )
    let finish!: (value: Awaited<ReturnType<DesktopApi['importResumeForCase']>>) => void
    vi.mocked(window.sesAgent.importResumeForCase).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    render(<App />)
    fireEvent.click(
      within(await screen.findByRole('complementary', { name: 'システムナビゲーション' })).getByRole('button', { name: '案件' })
    )
    const first = await screen.findByRole('article', { name: 'Case Alpha' }),
      second = screen.getByRole('article', { name: 'Case Beta' })
    const file = new File(['resume'], 'Engineer.xlsx')
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(6) })
    fireEvent.drop(first, { dataTransfer: { files: [file], types: ['Files'] } })
    const panel = await screen.findByRole('region', { name: '案件の要員検索' })
    expect(first).not.toBeVisible()
    expect(within(panel).getByRole('heading', { name: 'Case Alpha' })).toBeVisible()
    await waitFor(() => expect(window.sesAgent.importResumeForCase).toHaveBeenCalledTimes(1))
    expect(vi.mocked(window.sesAgent.importResumeForCase).mock.calls[0]![0].jobCaseId).toBe(job.jobCase!.id)
    fireEvent.click(within(panel).getByRole('button', { name: /案件一覧に戻る/ }))
    expect(screen.queryByRole('region', { name: '案件の要員検索' })).not.toBeInTheDocument()
    expect(first).toBeVisible()
    fireEvent.click(within(second).getByRole('button', { name: '要員を探す' }))
    expect(within(screen.getByRole('region', { name: '案件の要員検索' })).getByRole('heading', { name: 'Case Beta' })).toBeVisible()
    const assessment = {
      id: 'result',
      documentId,
      jobCaseId: job.jobCase!.id,
      jobCaseVersion: 1,
      profileVersion: 1,
      rulesRevision: 0,
      appliedRules: [],
      assessedAt: new Date().toISOString(),
      result: {
        documentId,
        profileVersion: 1,
        score: 0,
        matched: [],
        missing: ['C#'],
        hardFilters: [],
        qualification: {
          policyVersion: 'technical-language-v5',
          status: 'excluded',
          requirements: [
            {
              requirement: {
                id: 'R1',
                key: 'required_skills',
                label: 'C#',
                category: 'core',
                alternatives: [['C#']],
                minimumYears: null,
                requiresPractice: false
              },
              outcome: 'conflict',
              evidence: null,
              source: null
            }
          ]
        }
      },
      cloud: { status: 'unavailable', reviewedCount: 0, modelName: null }
    }
    await act(async () => finish({ person: candidate, assessment: assessment as any, error: null }))
    expect(
      within(screen.getByRole('region', { name: '案件の要員検索' })).queryByRole('article', { name: 'Engineer One' })
    ).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('region', { name: '案件の要員検索' })).getByRole('button', { name: /案件一覧に戻る/ }))
    fireEvent.click(within(first).getByRole('button', { name: '要員を見る (1)' }))
    expect((await screen.findAllByText('この案件への提案は推奨しません'))[0]).toBeVisible()
    const person = screen.getByRole('article', { name: 'Engineer One' })
    fireEvent.click(within(person).getByRole('button', { name: 'その他の操作' }))
    expect(within(person).getByRole('menuitem', { name: '元の履歴書を見る' })).toBeEnabled()
    expect(window.sesAgent.findPersonnelForCase).toHaveBeenCalledTimes(1)
    expect(window.sesAgent.findPersonnelForCase).toHaveBeenCalledWith(other.jobCase.id)
    expect(first).toHaveAttribute('aria-current', 'true')
  })

  it('shows the saved people count on a case card after a restart and lets the opened panel own it', async () => {
    cleanup()
    const reviewId = '33333333-3333-4333-8333-333333333333'
    const jobCaseId = '44444444-4444-4444-8444-444444444444'
    const documentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const now = new Date().toISOString()
    const job = {
      reviewId,
      sourceId: 'manual-1',
      sourceType: 'manual',
      providerMessageId: null,
      threadId: 'manual-1',
      fromDomain: null,
      messageDate: now,
      redactedSubject: 'Case Alpha',
      redactedPreview: 'Java',
      reviewRevision: 1,
      status: 'completed',
      privacyReviewed: true,
      fields: [
        {
          key: 'title',
          label: '案件名',
          originalValue: 'Case Alpha',
          value: 'Case Alpha',
          confidence: 1,
          status: 'confirmed',
          sourceLabels: [],
          changed: false,
          changeReason: null
        }
      ],
      warningCodes: [],
      completedAt: now,
      reviewerDisplayName: 'HR',
      lifecycle: 'active',
      cloudEligible: false,
      jobCase: {
        id: jobCaseId,
        sourceReviewId: reviewId,
        version: 1,
        status: 'active',
        confirmedAt: now,
        confirmedBy: 'HR',
        containsDirectIdentifiers: false
      }
    } as JobCaseReviewSnapshot
    const candidate = {
      documentId,
      fileName: 'Engineer.xlsx',
      localIdentity: { displayName: 'Engineer One' },
      fields: [],
      projectExperiences: [],
      recordStatus: 'active',
      profile: { version: 1 },
      status: 'completed'
    } as unknown as CandidateReviewSnapshot
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue({ ...bootstrap, candidateReviews: [candidate], jobCaseReviews: [job] })
    vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([
      {
        kind: 'case',
        working: true,
        objectId: reviewId,
        revision: 'a'.repeat(64),
        title: 'Case Alpha',
        event: 'created',
        occurredAt: now,
        sourceAt: now,
        source: 'manual',
        unseen: false,
        deferred: false,
        archived: false,
        businessStatus: 'active',
        needsReview: false,
        fields: [],
        changes: []
      }
    ] as any)
    vi.mocked(window.sesAgent.listCaseSearchSummaries).mockResolvedValue([{ reviewId, listedCount: 2, lastSearchedAt: now }])
    vi.mocked(window.sesAgent.listCaseAssessments).mockResolvedValue([
      {
        id: 'saved',
        documentId,
        jobCaseId,
        jobCaseVersion: 1,
        profileVersion: 1,
        rulesRevision: 0,
        appliedRules: [],
        assessedAt: now,
        origin: 'specified',
        result: { documentId, profileVersion: 1, score: 1, matched: ['Java'], missing: [], hardFilters: [] },
        cloud: { status: 'unavailable', reviewedCount: 0, modelName: null }
      }
    ])
    render(<App />)
    fireEvent.click(
      within(await screen.findByRole('complementary', { name: 'システムナビゲーション' })).getByRole('button', { name: '案件' })
    )
    const card = await screen.findByRole('article', { name: 'Case Alpha' })
    const button = await within(card).findByRole('button', { name: '要員を見る (2)' })
    // The count comes from the startup summary, before any case history is read.
    expect(window.sesAgent.listCaseAssessments).not.toHaveBeenCalled()
    fireEvent.click(button)
    const results = await screen.findByRole('region', { name: '案件の要員検索' })
    expect(await within(results).findByRole('article', { name: 'Engineer One' })).toBeVisible()
    fireEvent.click(within(results).getByRole('button', { name: /案件一覧に戻る/ }))
    // The panel's loaded history is the count from now on.
    expect(await within(card).findByRole('button', { name: '要員を見る (1)' })).toBeVisible()
    expect(window.sesAgent.findPersonnelForCase).not.toHaveBeenCalled()
  })

  it('opens introduction immediately for an imported Gmail draft and prepares its case version without a review screen', async () => {
    cleanup()
    const title = '【Gmail接続テスト02】生保契約管理システム COBOL案件'
    const reviewId = '33333333-3333-4333-8333-333333333333'
    const job: JobCaseReviewSnapshot = {
      reviewId,
      sourceId: 'gmail-2',
      sourceType: 'gmail',
      providerMessageId: 'gmail-2',
      threadId: 'thread-2',
      fromDomain: null,
      messageDate: new Date().toISOString(),
      redactedSubject: title,
      redactedPreview: 'ホストCOBOL開発経験3年以上',
      reviewRevision: 1,
      status: 'awaiting-review',
      privacyReviewed: false,
      fields: [
        {
          key: 'title',
          label: '案件名',
          originalValue: title,
          value: title,
          confidence: 1,
          status: 'needs_review',
          sourceLabels: [],
          changed: false,
          changeReason: null
        }
      ],
      warningCodes: [],
      completedAt: null,
      reviewerDisplayName: null,
      lifecycle: 'active',
      cloudEligible: false,
      jobCase: null
    }
    const saved: JobCaseReviewSnapshot = {
      ...job,
      status: 'completed',
      privacyReviewed: true,
      jobCase: {
        id: '44444444-4444-4444-8444-444444444444',
        sourceReviewId: reviewId,
        version: 1,
        status: 'active',
        confirmedAt: new Date().toISOString(),
        confirmedBy: 'HR',
        containsDirectIdentifiers: false
      }
    }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue({ ...bootstrap, jobCaseReviews: [job] })
    vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([
      {
        kind: 'case',
        working: true,
        objectId: reviewId,
        revision: 'a'.repeat(64),
        title,
        event: 'created',
        occurredAt: new Date().toISOString(),
        sourceAt: new Date().toISOString(),
        source: 'gmail',
        unseen: false,
        deferred: false,
        archived: false,
        businessStatus: 'active',
        needsReview: true,
        fields: [],
        changes: []
      }
    ])
    vi.mocked(window.sesAgent.listBroadcastWorkspace).mockResolvedValue({ queue: [], templates: [builtInBroadcastTemplate()] })
    vi.mocked(window.sesAgent.draftCaseBroadcast).mockResolvedValue({
      textJa: 'COBOL 案件紹介',
      textZh: 'COBOL 案件介绍',
      forbiddenJa: [],
      forbiddenZh: []
    })
    let finish!: (value: JobCaseReviewSnapshot) => void
    vi.mocked(window.sesAgent.prepareCaseIntroduction).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    render(<App />)
    fireEvent.click(
      within(await screen.findByRole('complementary', { name: 'システムナビゲーション' })).getByRole('button', { name: '案件' })
    )
    const card = await screen.findByRole('article', { name: title })
    // No separate page header: the list's own toolbar row carries 问 Agent (once) and the privacy note.
    const caseList = screen.getByRole('region', { name: '案件一覧' })
    expect(screen.getAllByRole('button', { name: 'Agentに質問' })).toHaveLength(1)
    expect(caseList.querySelector('.hr-list-toolbar')).toContainElement(screen.getByRole('button', { name: 'Agentに質問' }))
    expect(within(caseList).getByText('脱敏済みのみ送信')).toBeVisible()
    fireEvent.click(card)
    await screen.findByRole('complementary', { name: '業務ワークスペース' })
    // Broadcasting is used often, so it is a visible button in the card footer, not hidden in 「…」.
    fireEvent.click(within(card).getByRole('button', { name: /^その他の操作/u }))
    expect(within(card).queryByRole('menuitem', { name: '案件を配信' })).not.toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: /^その他の操作/u }))
    fireEvent.click(within(card).getByRole('button', { name: '案件を配信' }))
    const dialog = screen.getByRole('dialog', { name: '案件を配信' })
    expect(dialog).toBeVisible()
    expect(dialog).toHaveFocus()
    expect(within(dialog).getByText('準備中…')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '紹介文をコピー' })).toBeDisabled()
    expect(window.sesAgent.prepareCaseIntroduction).toHaveBeenCalledWith({ reviewId, expectedReviewRevision: 1 })
    expect(window.sesAgent.draftCaseBroadcast).not.toHaveBeenCalled()
    await act(async () => finish(saved))
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: '紹介文' })).toHaveValue('COBOL 案件紹介'))
    expect(within(dialog).getByRole('button', { name: '紹介文をコピー' })).toBeEnabled()
    expect(card).toHaveAttribute('aria-current', 'true')
    fireEvent.click(within(dialog).getByRole('button', { name: '紹介画面を閉じる' }))
    fireEvent.click(within(card).getByRole('button', { name: '案件を配信' }))
    expect(screen.getByRole('dialog', { name: '案件を配信' })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: '紹介文' })).toHaveValue('COBOL 案件紹介')
    expect(window.sesAgent.prepareCaseIntroduction).toHaveBeenCalledTimes(1)
    expect(window.sesAgent.openCaseBroadcastEmail).not.toHaveBeenCalled()
  })

  it('preserves the feed selection, matched case selection and scroll when viewing a case and returning', async () => {
    cleanup()
    const documentId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const candidate: CandidateReviewSnapshot = {
      documentId,
      fileName: 'Selected Engineer.xlsx',
      reviewRevision: 1,
      status: 'awaiting-review',
      piiReviewed: false,
      fields: [],
      projectExperiences: [],
      completedAt: null,
      reviewerDisplayName: null,
      profile: {
        id: documentId,
        sourceDocumentId: documentId,
        version: 1,
        status: 'current',
        confirmedAt: new Date().toISOString(),
        confirmedBy: '本机导入',
        containsDirectIdentifiers: false
      },
      recruitingStatus: 'pending-review',
      talentPoolStatus: 'eligible',
      recordStatus: 'active'
    }
    const job: JobCaseReviewSnapshot = {
      reviewId: '33333333-3333-4333-8333-333333333333',
      sourceId: 'manual-1',
      sourceType: 'manual',
      providerMessageId: null,
      threadId: 'manual-1',
      fromDomain: null,
      messageDate: new Date().toISOString(),
      redactedSubject: 'Java project',
      redactedPreview: 'Java',
      reviewRevision: 1,
      status: 'completed',
      privacyReviewed: true,
      fields: [
        {
          key: 'title',
          label: '案件名',
          originalValue: 'Java project',
          value: 'Java project',
          confidence: 1,
          status: 'confirmed',
          sourceLabels: [],
          changed: false,
          changeReason: null
        }
      ],
      warningCodes: ['import-field-warning'],
      completedAt: new Date().toISOString(),
      reviewerDisplayName: 'HR',
      lifecycle: 'active',
      cloudEligible: false,
      jobCase: {
        id: '44444444-4444-4444-8444-444444444444',
        sourceReviewId: '33333333-3333-4333-8333-333333333333',
        version: 1,
        status: 'active',
        confirmedAt: new Date().toISOString(),
        confirmedBy: 'HR',
        containsDirectIdentifiers: false
      }
    }
    const entry: BusinessFeedEntry = {
      kind: 'person',
      objectId: documentId,
      revision: 'a'.repeat(64),
      title: 'Selected Engineer',
      event: 'created',
      occurredAt: new Date().toISOString(),
      sourceAt: new Date().toISOString(),
      source: 'local-personnel',
      unseen: false,
      deferred: false,
      archived: false,
      businessStatus: 'available',
      needsReview: false,
      fields: [],
      changes: []
    }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue({ ...bootstrap, candidateReviews: [candidate], jobCaseReviews: [job] })
    vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue([
      entry,
      { ...entry, kind: 'case', working: true, objectId: job.reviewId, title: 'Java project', source: 'manual', businessStatus: 'active' }
    ])
    vi.mocked(window.sesAgent.getPersonnelWorkspace).mockResolvedValue({ templates: builtInPersonnelTemplates(), states: [], copies: [] })
    const matchResult = {
      documentId,
      profileVersion: 1,
      localMatchCount: 1,
      cloud: { status: 'reviewed', reviewedCount: 1, modelName: 'Test AI' },
      items: [
        {
          reviewId: job.reviewId,
          jobCaseId: job.jobCase!.id,
          jobCaseVersion: 1,
          title: 'Java project',
          score: 90,
          matched: ['Java'],
          missing: [],
          hardFilters: [],
          qualification: { policyVersion: 'technical-language-v5', status: 'recommended', requirements: [] },
          assessment: {
            version: 'match-assessment-v1',
            fit: 'strong',
            met: [{ requirement: 'Java', evidence: 'Java' }],
            gaps: [],
            confirm: [],
            reason: 'Java project experience',
            modelKey: 'test',
            assessedAt: new Date().toISOString()
          }
        }
      ]
    } as Awaited<ReturnType<DesktopApi['findCasesForPersonnel']>>
    let finish!: (value: typeof matchResult) => void
    vi.mocked(window.sesAgent.findCasesForPersonnel).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    render(<App />)
    fireEvent.click(
      within(await screen.findByRole('complementary', { name: 'システムナビゲーション' })).getByRole('button', { name: '要員' })
    )
    const feedCard = await screen.findByRole('article', { name: 'Selected Engineer' })
    const listScroll = feedCard.parentElement!
    listScroll.scrollTop = 200
    fireEvent.scroll(listScroll)
    fireEvent.click(feedCard)
    const panel = await screen.findByRole('complementary', { name: '業務ワークスペース' })
    const findButton = await within(panel).findByRole('button', { name: '案件を探す' })
    fireEvent.click(within(feedCard).getByRole('button', { name: '案件を探す' }))
    const matching = await screen.findByRole('region', { name: 'この要員の案件を探す' })
    // The results take the main area; the person's panel stays closed until opened from the results.
    expect(screen.queryByRole('complementary', { name: '業務ワークスペース' })).not.toBeInTheDocument()
    expect(feedCard).not.toBeVisible()
    expect(findButton).toBeDisabled()
    expect(feedCard.querySelector('button.hr-primary')).toBeDisabled()
    fireEvent.click(findButton)
    fireEvent.click(await within(matching).findByRole('button', { name: '案件を探しています…' }))
    expect(window.sesAgent.findCasesForPersonnel).toHaveBeenCalledTimes(1)
    await act(async () => finish(matchResult))
    expect(within(matching).getByText('AI評価済み', { selector: 'span' })).toBeVisible()
    const scroll = matching.querySelector('.match-list-pane')!
    scroll.scrollTop = 320
    const matchedRow = matching.querySelector('[data-match-row]')!
    const matchedCase = within(matching).getByRole('article', { name: 'Java project' })
    fireEvent.click(within(matchedCase).getByRole('button', { name: 'その他の操作' }))
    fireEvent.click(within(matchedCase).getByRole('menuitem', { name: '案件を見る' }))
    expect(feedCard).toHaveAttribute('aria-current', 'true')
    expect(matchedRow).toHaveAttribute('aria-current', 'true')
    // Viewing the case opens it beside the results.
    expect(await screen.findByRole('complementary', { name: '業務ワークスペース' })).toBeInTheDocument()
    expect(scroll.scrollTop).toBe(320)
    expect(window.sesAgent.findCasesForPersonnel).toHaveBeenCalledTimes(1)
    expect(within(panel).queryByText('取込の確認記録を表示')).not.toBeInTheDocument()
    fireEvent.click(within(matching).getByRole('button', { name: '対応を開始' }))
    const followUp = await screen.findByRole('region', { name: '業務の対応記録' })
    expect(await within(followUp).findByRole('textbox', { name: '要員の候補日時' })).toBeVisible()
    fireEvent.click(within(followUp).getByRole('button', { name: 'マッチング結果に戻る' }))
    expect(matching).toBeVisible()
    expect(matchedRow).toHaveAttribute('aria-current', 'true')
    expect(scroll.scrollTop).toBe(320)
    expect(window.sesAgent.findCasesForPersonnel).toHaveBeenCalledTimes(1)
    expect(window.sesAgent.saveBusinessFollowUp).not.toHaveBeenCalled()
    fireEvent.click(within(matching).getByRole('button', { name: /要員一覧に戻る/ }))
    expect(feedCard).toBeVisible()
    expect(listScroll.scrollTop).toBe(200)

    let finishPeople!: (value: Awaited<ReturnType<DesktopApi['findPersonnelForCase']>>) => void
    vi.mocked(window.sesAgent.findPersonnelForCase).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPeople = resolve
        })
    )
    fireEvent.click(within(screen.getByRole('complementary', { name: 'システムナビゲーション' })).getByRole('button', { name: '案件' }))
    const caseCard = await screen.findByRole('article', { name: 'Java project' })
    fireEvent.click(within(caseCard).getByRole('button', { name: '要員を探す' }))
    const matchingPane = await screen.findByRole('region', { name: '案件の要員検索' })
    // The results replace the case list in the main area and the side panel is closed.
    expect(caseCard).not.toBeVisible()
    expect(screen.queryByRole('complementary', { name: '業務ワークスペース' })).not.toBeInTheDocument()
    expect(within(matchingPane).getByRole('heading', { name: 'Java project' })).toBeVisible()
    expect(caseCard.querySelector('button.hr-primary')).toBeEnabled()
    expect(matchingPane.querySelector('.agent-business-case-picker')).toBeNull()
    await waitFor(() => expect(window.sesAgent.findPersonnelForCase).toHaveBeenCalledTimes(1))
    expect(within(matchingPane).getByRole('button', { name: '要員を検索中…' })).toBeDisabled()
    fireEvent.click(caseCard.querySelector('button.hr-primary')!)
    await act(async () =>
      finishPeople({
        jobCaseId: job.jobCase!.id,
        jobCaseVersion: 1,
        localMatchCount: 1,
        cloud: { status: 'reviewed', reviewedCount: 1, modelName: 'Test AI' },
        items: [
          {
            assessmentId: 'saved-assessment',
            documentId,
            profileVersion: 1,
            score: 10,
            matched: ['Java'],
            missing: [],
            hardFilters: [],
            qualification: { policyVersion: 'technical-language-v5', status: 'recommended', requirements: [] }
          }
        ]
      })
    )
    const peopleScroll = matchingPane.querySelector('.match-list-pane')!
    peopleScroll.scrollTop = 280
    fireEvent.click(matchingPane.querySelector('[data-match-row]')!)
    expect(caseCard).toHaveAttribute('aria-current', 'true')
    expect(peopleScroll.scrollTop).toBe(280)
    expect(matchingPane.querySelector('[data-match-row]')).toHaveAttribute('aria-current', 'true')
    expect(window.sesAgent.findPersonnelForCase).toHaveBeenCalledTimes(1)
    fireEvent.click(within(matchingPane).getByRole('button', { name: '紹介を準備' }))
    expect(await screen.findByRole('dialog', { name: '紹介を準備' })).toHaveTextContent('Java project')
    expect(window.sesAgent.saveBusinessFollowUp).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '紹介画面を閉じる' }))
    // Back on the case list, the case stays selected.
    fireEvent.click(within(matchingPane).getByRole('button', { name: /案件一覧に戻る/ }))
    expect(caseCard).toBeVisible()
    expect(caseCard).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByRole('region', { name: '案件の要員検索' })).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('complementary', { name: 'システムナビゲーション' })).getByRole('button', { name: '要員' }))
    // The card shows the cases found by the first run; reopening shows that stored result without re-running.
    fireEvent.click(
      within(await screen.findByRole('article', { name: 'Selected Engineer' })).getByRole('button', { name: '案件を見る (1)' })
    )
    const reverseAgain = await screen.findByRole('region', { name: 'この要員の案件を探す' })
    expect(within(reverseAgain).getByRole('article', { name: 'Java project' })).toBeVisible()
    fireEvent.click(within(reverseAgain).getByRole('button', { name: /要員一覧に戻る/ }))
    expect(await screen.findByRole('region', { name: '要員一覧' })).toBeVisible()
    expect(window.sesAgent.findCasesForPersonnel).toHaveBeenCalledTimes(1)
  })

  it('shows no Japanese chrome anywhere on the main zh-CN screens', async () => {
    cleanup()
    // Fixtures carry no Japanese user data, so any kana on screen is untranslated chrome or Main text.
    const { candidate, job, feed } = hrObjects()
    const zhBootstrap: BootstrapPayload = {
      ...bootstrap,
      preferences: { ...bootstrap.preferences, locale: 'zh-CN', configured: true },
      candidateReviews: [candidate],
      jobCaseReviews: [job]
    }
    vi.mocked(window.sesAgent.getBootstrap).mockResolvedValue(zhBootstrap)
    vi.mocked(window.sesAgent.getBusinessFeed).mockResolvedValue(feed)
    vi.mocked(window.sesAgent.getPersonnelWorkspace).mockResolvedValue({ templates: builtInPersonnelTemplates(), states: [], copies: [] })
    render(<App />)
    const kana = /[぀-ゟ゠-ヿ]/u
    const japaneseChrome = (screenName: string) => {
      const leaks: string[] = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeType === Node.TEXT_NODE) {
          const parent = node.parentElement
          if (!parent || parent.closest('script, style, [hidden], [aria-hidden="true"]')) continue
          const text = node.textContent?.trim() ?? ''
          if (kana.test(text)) leaks.push(`${screenName} text: ${text}`)
          continue
        }
        const element = node as Element
        for (const attribute of ['aria-label', 'placeholder', 'title', 'alt']) {
          const value = element.getAttribute(attribute)
          if (value && kana.test(value)) leaks.push(`${screenName} ${attribute}: ${value}`)
        }
      }
      return leaks
    }
    const rail = () => within(screen.getByRole('complementary', { name: '系统导航' }))
    await screen.findByRole('complementary', { name: '系统导航' })

    // HR case list (the default view), then a case detail in the business workspace.
    fireEvent.click(rail().getByRole('button', { name: '案件' }))
    expect(await screen.findByRole('region', { name: '案件业务列表' })).toBeVisible()
    const leaks = japaneseChrome('case list')
    fireEvent.click(await screen.findByRole('article', { name: 'Java project' }))
    await screen.findByRole('complementary', { name: '业务工作区' })
    leaks.push(...japaneseChrome('case detail'))

    // Batch import page.
    fireEvent.click(screen.getByRole('button', { name: '批量导入' }))
    expect(await screen.findByRole('heading', { name: '导入案件' })).toBeVisible()
    leaks.push(...japaneseChrome('case import'))
    fireEvent.click(screen.getByRole('button', { name: '返回案件' }))

    // HR person list.
    fireEvent.click(rail().getByRole('button', { name: '人员' }))
    expect(await screen.findByRole('region', { name: '人员业务列表' })).toBeVisible()
    expect(await screen.findByRole('article', { name: 'Selected Engineer' })).toBeVisible()
    leaks.push(...japaneseChrome('person list'))

    // Follow-up.
    fireEvent.click(rail().getByRole('button', { name: '跟进' }))
    expect(await screen.findByRole('button', { name: '面试日程' })).toBeVisible()
    leaks.push(...japaneseChrome('follow-up'))

    // Settings.
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    const settings = await screen.findByRole('dialog', { name: '设置' })
    for (const section of within(settings).getAllByRole('button', { name: /常规设置|外部系统|数据与隐私/u })) {
      fireEvent.click(section)
      leaks.push(...japaneseChrome(`settings ${section.textContent ?? ''}`))
    }

    expect(leaks).toEqual([])
  })
})
