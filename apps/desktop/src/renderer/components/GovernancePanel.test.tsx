import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BootstrapPayload, RecoveryPackageSummary } from '@shared'
import { GovernancePanel } from './GovernancePanel'

const summary: RecoveryPackageSummary = {
  version: 'ses-recovery-v1',
  backupId: '16e2a4d9-bd69-4d64-9dad-a9f6d238f8c1',
  createdAt: '2026-07-17T10:00:00.000Z',
  sourcePlatform: 'darwin',
  sourceArch: 'arm64',
  schemaVersion: 12,
  databaseBytes: 4096,
  vaultObjectCount: 2,
  vaultBytes: 2048,
  totalBytes: 6144,
  googleWorkspaceCredentialIncluded: false,
  cloudDataIncluded: false
}

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
  tasks: [],
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
    policyVersion: 'cloud-redaction-v2', cloudGateway: 'enforced', localAi: 'vision-ocr-and-pii-active',
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
  storage: { status: 'encrypted', engine: 'sqlcipher-compatible', keyProtection: 'macos-keychain', schemaVersion: 12 },
  gmail: {
    provider: 'google-workspace', status: 'not-connected', configuration: 'required', workspaceDomain: null,
    accountEmail: null, grantedScopes: [], readAccess: false, draftAccess: 'not-requested', sendMethod: 'not-implemented'
  },
  googleWorkspaceConfiguration: null,
  googleWorkspaceAcceptance: null,
  gmailSync: {
    configuration: 'required', status: 'never', labelIds: [], query: null, lookbackDays: 30,
    checkpointHistoryId: null, storedMessages: 0, lastSyncedAt: null, lastRun: null, lastError: null
  },
  aiCommerce: {
    configuration: 'required', connection: 'not-connected', productCode: null, billingMode: null,
    memberDisplayName: null, accountId: null, accountAiTokenExpiresAt: null,
    wallet: null, capabilities: [], refreshedAt: null
  },
  recovery: {
    format: 'ses-recovery-v1', encryption: 'scrypt-aes-256-gcm', lastBackupAt: null, lastRestoreAt: null,
    pendingRestore: false,
    reminder: {
      status: 'due', reason: 'no-backup', currentDataRevision: 4, lastBackupDataRevision: null,
      latestDataChangedAt: '2026-07-17T09:50:00.000Z', snoozedUntil: null
    }
  },
  candidateEvaluation: { dataset: null, latestReport: null }
}

function callbacks() {
  return {
    onConnectGoogleWorkspace: vi.fn().mockResolvedValue(undefined),
    onDiagnoseGoogleWorkspace: vi.fn().mockResolvedValue({
      version: 'google-workspace-readiness-v1',
      checkedAt: '2026-07-20T00:00:00.000Z',
      overall: 'ready',
      networkAccess: true,
      mailboxAccessed: false,
      credentialCreated: false,
      checks: [
        { id: 'loopback-callback', status: 'passed', label: 'ローカル OAuth コールバック', detail: '127.0.0.1 を使用できます。' },
        { id: 'admin-console-confirmation', status: 'warning', label: 'Google Cloud 管理者確認', detail: '管理者が確認してください。' }
      ]
    }),
    onRunGoogleWorkspaceOnlineAcceptance: vi.fn().mockResolvedValue({
      version: 'google-workspace-online-acceptance-v1',
      id: '59d99a84-c5ea-4474-b08a-ddfd8f5eca73',
      checkedAt: '2026-07-20T00:05:00.000Z',
      overall: 'passed',
      configurationFingerprint: 'a'.repeat(64),
      credentialProtection: 'macos-keychain',
      mailboxMetadataAccessed: true,
      messageContentAccessedDuringCheck: false,
      cloudModelUsed: false,
      directIdentifierCloudSent: false,
      checks: [
        { id: 'live-profile', status: 'passed', label: 'Gmail Profile のオンライン確認', detail: '本文は取得していません。' },
        { id: 'readonly-scope', status: 'passed', label: '読取専用 Scope', detail: 'gmail.readonly のみです。' },
        { id: 'account-identity', status: 'passed', label: 'Google アカウント本人確認', detail: '接続先と一致しました。' },
        { id: 'credential-protection', status: 'passed', label: 'OAuth Token の端末保護', detail: 'Keychain で保護されています。' },
        { id: 'bounded-sync', status: 'passed', label: '管理者指定の同期範囲', detail: '現在の設定と一致します。' },
        { id: 'successful-sync', status: 'passed', label: 'Gmail の有界同期', detail: '保存 2件、失敗 0件。' },
        { id: 'local-redaction', status: 'passed', label: 'ローカル脱敏証跡', detail: '2件すべて通過しました。' },
        { id: 'no-cloud-model', status: 'passed', label: 'クラウド大模型未使用', detail: '端末内処理です。' },
        { id: 'no-send-path', status: 'passed', label: '送信経路なし', detail: '送信 API はありません。' }
      ],
      evidence: {
        grantedScopeCount: 1,
        sync: { status: 'idle', lastSyncedAt: '2026-07-20T00:04:00.000Z', mode: 'baseline', discovered: 2, imported: 2, duplicates: 0, filtered: 0, failed: 0 },
        redaction: { storedMessages: 2, passed: 2, uncertain: 0, blocked: 0 }
      }
    }),
    onSaveGoogleWorkspaceAdminConfiguration: vi.fn(),
    onDisconnectGoogleWorkspace: vi.fn().mockResolvedValue(undefined),
    onSyncGoogleWorkspace: vi.fn().mockResolvedValue(undefined),
    onImportCandidateEvaluationBenchmark: vi.fn().mockResolvedValue({
      cancelled: true,
      state: { dataset: null, latestReport: null }
    }),
    onGetCandidateEvaluationAuthoringWorkspace: vi.fn().mockResolvedValue({ draft: null, jobCases: [], candidates: [] }),
    onCreateCandidateEvaluationDraft: vi.fn(),
    onSaveCandidateEvaluationDraftCase: vi.fn(),
    onDeleteCandidateEvaluationDraftCase: vi.fn(),
    onEvaluateCandidateEvaluationDraft: vi.fn(),
    onCreateRecovery: vi.fn().mockResolvedValue({
      cancelled: false,
      fileName: 'pilot.ses-recovery',
      packageHash: 'a'.repeat(64),
      summary
    }),
    onSnoozeRecoveryReminder: vi.fn().mockResolvedValue(undefined),
    onPreviewRecovery: vi.fn().mockResolvedValue({
      cancelled: false,
      restoreToken: 'b2a56ae6-da51-4cb5-a82c-0fd350558e72',
      confirmationHash: 'b'.repeat(64),
      expiresAt: '2026-07-17T10:10:00.000Z',
      summary,
      warnings: ['Google Workspace の認証情報は復元されません。']
    }),
    onConfirmRecovery: vi.fn().mockResolvedValue({ scheduled: true, restartRequired: true })
  }
}

describe('GovernancePanel recovery controls', () => {
  it('labels the packaged privacy gate as a synthetic regression rather than real expert evidence', () => {
    render(<GovernancePanel bootstrap={bootstrap} onClose={vi.fn()} responsiveOpen={false} {...callbacks()} />)
    expect(screen.getByRole('button', { name: 'パネル設定は未提供' })).toBeDisabled()
    expect(screen.getByText('固定合成回帰 28件')).toBeInTheDocument()
    expect(screen.getByText('Recall / Precision 100%')).toBeInTheDocument()
    expect(screen.getByText('日本語専門家評価 未完了')).toBeInTheDocument()
    expect(screen.getByText('任意の品質証跡')).toBeInTheDocument()
    expect(screen.getByText(/Cloud AI の実行や正式リリースを阻止しません/)).toBeInTheDocument()
  })

  it('shows an explicit release blocker when the privacy report is unavailable', () => {
    render(<GovernancePanel
      bootstrap={{
        ...bootstrap,
        privacy: {
          ...bootstrap.privacy,
          qualityGate: {
            status: 'not-verified', datasetVersion: null, syntheticOnly: true, caseCount: 0,
            identifierRecall: null, redactionPrecision: null, residualLeakCount: null,
            safeCaseFalsePositiveCount: null, appleNerVerified: null, reportHash: null,
            failureCodes: ['quality-report:missing']
          }
        }
      }}
      onClose={vi.fn()}
      responsiveOpen={false}
      {...callbacks()}
    />)
    expect(screen.getByText('固定回帰 未検証')).toBeInTheDocument()
    expect(screen.getByText('リリース不可')).toBeInTheDocument()
  })

  it('shows aggregate expert evidence without exposing dataset content', () => {
    render(<GovernancePanel
      bootstrap={{
        ...bootstrap,
        privacy: {
          ...bootstrap.privacy,
          expertGate: {
            status: 'passed', datasetVersion: 'ses-privacy-expert-dataset-v1', humanLabeledDataset: true,
            sourceDocumentCount: 50, caseCount: 60, automaticPersonNameRecall: 0.93,
            postReviewIdentifierRecall: 1, redactionPrecision: 0.98,
            reviewedAt: '2026-07-19T00:00:00.000Z', evaluatedAt: '2026-07-20T00:00:00.000Z',
            reportHash: 'b'.repeat(64), attestationHash: 'c'.repeat(64),
            privacyImplementationSha256: 'd'.repeat(64), cloudEnforcementSha256: 'e'.repeat(64),
            failureCodes: []
          }
        }
      }}
      onClose={vi.fn()}
      responsiveOpen={false}
      {...callbacks()}
    />)
    expect(screen.getByText('日本語専門家評価 60件')).toBeInTheDocument()
    expect(screen.getByText('氏名自動Recall 93%')).toBeInTheDocument()
    expect(screen.getByText(/評価データ本文は端末外へ送信・報告しません/)).toBeInTheDocument()
  })

  it('shows a pre-authorization Google Workspace diagnostic without claiming mailbox access', async () => {
    const handlers = callbacks()
    render(<GovernancePanel bootstrap={bootstrap} onClose={vi.fn()} responsiveOpen={false} {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: '接続事前診断' }))
    expect(await screen.findByText('端末側の接続準備完了')).toBeInTheDocument()
    expect(screen.getByText('メール未読取 · Token未作成')).toBeInTheDocument()
    expect(screen.getByText('ローカル OAuth コールバック')).toBeInTheDocument()
    expect(handlers.onDiagnoseGoogleWorkspace).toHaveBeenCalledTimes(1)
  })

  it('translates a revoked Google credential into a reconnect action instead of exposing an internal code', () => {
    render(<GovernancePanel
      bootstrap={{
        ...bootstrap,
        gmailSync: { ...bootstrap.gmailSync, status: 'error', lastError: 'GOOGLE_REAUTH_REQUIRED' }
      }}
      onClose={vi.fn()}
      responsiveOpen={false}
      {...callbacks()}
    />)
    expect(screen.getByText(/認証が失効しました。Google メールアカウントを再接続/)).toBeInTheDocument()
    expect(screen.queryByText('GOOGLE_REAUTH_REQUIRED')).not.toBeInTheDocument()
  })

  it('shows a connected online acceptance report without exposing mailbox content', async () => {
    const handlers = callbacks()
    render(<GovernancePanel
      bootstrap={{
        ...bootstrap,
        gmail: {
          provider: 'google-workspace', status: 'readonly', configuration: 'connected',
          workspaceDomain: 'example.co.jp', accountEmail: 'hr@example.co.jp',
          grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'], readAccess: true,
          draftAccess: 'not-requested', sendMethod: 'not-implemented'
        },
        gmailSync: {
          configuration: 'ready', status: 'idle', labelIds: ['Label_SES'], query: '案件', lookbackDays: 30,
          checkpointHistoryId: '100', storedMessages: 2, lastSyncedAt: '2026-07-20T00:04:00.000Z',
          lastRun: { mode: 'baseline', discovered: 2, imported: 2, duplicates: 0, filtered: 0, failed: 0 },
          lastError: null
        }
      }}
      onClose={vi.fn()}
      responsiveOpen={false}
      {...handlers}
    />)
    fireEvent.click(screen.getByRole('button', { name: 'オンライン受入検証' }))
    expect(await screen.findByText('オンライン受入検証 合格')).toBeInTheDocument()
    expect(screen.getByText('Profileのみ再取得 · 本文未取得 · Cloud LLM未使用')).toBeInTheDocument()
    expect(screen.getByText('クラウド大模型未使用')).toBeInTheDocument()
    expect(handlers.onRunGoogleWorkspaceOnlineAcceptance).toHaveBeenCalledTimes(1)
  })

  it('shows the Windows DPAPI boundary without claiming unavailable OCR is active', () => {
    render(<GovernancePanel
      bootstrap={{
        ...bootstrap,
        privacy: { ...bootstrap.privacy, localAi: 'windows-ocr-bundled-isolation-pending' },
        storage: { ...bootstrap.storage, keyProtection: 'windows-dpapi' }
      }}
      onClose={vi.fn()}
      responsiveOpen={false}
      {...callbacks()}
    />)
    expect(screen.getByText('Windows DPAPI')).toBeInTheDocument()
    expect(screen.getByText('隔離検証待ち')).toBeInTheDocument()
    expect(screen.getByText(/固定オフラインOCR Runtimeは搭載済み/)).toBeInTheDocument()
    expect(screen.getByText(/クラウドOCRへ回しません/)).toBeInTheDocument()
  })

  it('does not present Windows PII rules as a validated Japanese NER model', () => {
    render(<GovernancePanel
      bootstrap={{
        ...bootstrap,
        privacy: { ...bootstrap.privacy, localAi: 'windows-ocr-and-pii-rules-active' },
        storage: { ...bootstrap.storage, keyProtection: 'windows-dpapi' }
      }}
      onClose={vi.fn()}
      responsiveOpen={false}
      {...callbacks()}
    />)
    expect(screen.getByText(/Windowsの姓名候補は項目ラベルと規則で検出/)).toBeInTheDocument()
    expect(screen.getByText(/検証済みでない日本語NERを搭載済みとは表示しません/)).toBeInTheDocument()
  })

  it('shows a locally evaluated SES benchmark quality gate', async () => {
    const handlers = callbacks()
    const datasetId = 'd5a8372a-f701-4862-8f5d-4278c116fe3c'
    const evaluatedBootstrap: BootstrapPayload = {
      ...bootstrap,
      candidateEvaluation: {
        dataset: {
          id: datasetId,
          name: 'Tokyo SES Pilot v1',
          datasetHash: 'c'.repeat(64),
          caseCount: 30,
          relevantCandidates: 36,
          reviewerCount: 2,
          importedAt: '2026-07-20T00:00:00.000Z'
        },
        latestReport: {
          version: 'candidate-evaluation-report-v1',
          id: '1f7d8d53-2ced-4f90-8de4-2711a6af95aa',
          datasetId,
          datasetHash: 'c'.repeat(64),
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
          cases: Array.from({ length: 30 }, (_, index) => ({
            caseId: `case-${index + 1}`,
            queryHash: String(index).padStart(64, 'a').slice(-64),
            relevantCandidates: 1,
            retrievedRelevantCandidates: 1,
            recallAt20: 1,
            ndcgAt20: 1,
            expectedProjectEvidence: 0,
            matchedProjectEvidence: 0,
            missingCandidateLabels: []
          }))
        }
      }
    }
    render(<GovernancePanel bootstrap={evaluatedBootstrap} onClose={vi.fn()} responsiveOpen={false} {...handlers} />)
    expect(screen.getByText('品質門通過')).toBeInTheDocument()
    expect(screen.getByText('94.4%')).toBeInTheDocument()
    expect(screen.getByText('0.812')).toBeInTheDocument()
    expect(screen.getByText('90.0%')).toBeInTheDocument()
    expect(screen.getByText('tri-state-v3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'JSONを読み込む' }))
    await waitFor(() => expect(handlers.onImportCandidateEvaluationBenchmark).toHaveBeenCalledOnce())
  })

  it('requires a matching independent password before creating a recovery package', async () => {
    const handlers = callbacks()
    render(<GovernancePanel bootstrap={bootstrap} onClose={vi.fn()} responsiveOpen={false} {...handlers} />)
    expect(screen.getByText(/多言語Vectorと日文Rerankを端末内で実行/)).toBeInTheDocument()
    expect(screen.getByText('端末内のみ')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'バックアップを作成' }))
    const passwordInput = screen.getByLabelText('復元パスワード')
    await waitFor(() => expect(passwordInput).toHaveFocus())
    const submit = screen.getByRole('button', { name: '保存先を選んで作成' })
    expect(submit).toBeDisabled()
    fireEvent.change(passwordInput, { target: { value: 'correct horse battery staple' } })
    fireEvent.change(screen.getByLabelText('パスワードを再入力'), { target: { value: 'correct horse battery staple' } })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    await waitFor(() => expect(handlers.onCreateRecovery).toHaveBeenCalledWith({
      password: 'correct horse battery staple',
      passwordConfirmation: 'correct horse battery staple'
    }))
    expect(await screen.findByText('pilot.ses-recovery · 検証済み')).toBeInTheDocument()
  })

  it('shows verified restore scope and requires the explicit Japanese confirmation phrase', async () => {
    const handlers = callbacks()
    render(<GovernancePanel bootstrap={bootstrap} onClose={vi.fn()} responsiveOpen={false} {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'パッケージから復元' }))
    fireEvent.change(screen.getByLabelText('復元パスワード'), { target: { value: 'correct horse battery staple' } })
    fireEvent.click(screen.getByRole('button', { name: 'パッケージを選んで検証' }))
    expect(await screen.findByRole('heading', { name: '復元内容を最終確認' })).toBeInTheDocument()
    expect(screen.getByText('darwin · arm64')).toBeInTheDocument()
    expect(screen.getByText('2件')).toBeInTheDocument()
    expect(screen.getByText('含まない')).toBeInTheDocument()
    const confirmButton = screen.getByRole('button', { name: '確認して復元' })
    expect(confirmButton).toBeDisabled()
    fireEvent.change(screen.getByLabelText('確認のため「復元」と入力'), { target: { value: '復元' } })
    fireEvent.click(confirmButton)
    await waitFor(() => expect(handlers.onConfirmRecovery).toHaveBeenCalledWith({
      restoreToken: 'b2a56ae6-da51-4cb5-a82c-0fd350558e72',
      confirmationHash: 'b'.repeat(64),
      confirmationText: '復元'
    }))
    expect(await screen.findByText('復元を予約しました。安全に再起動しています…')).toBeInTheDocument()
  })

  it('shows a local backup reminder and lets the user defer it explicitly', async () => {
    const handlers = callbacks()
    render(<GovernancePanel bootstrap={bootstrap} onClose={vi.fn()} responsiveOpen={false} {...handlers} />)
    expect(screen.getByText('ローカルデータのバックアップを確認')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '明日再通知' }))
    await waitFor(() => expect(handlers.onSnoozeRecoveryReminder).toHaveBeenCalledWith({ days: 1 }))
  })
})
