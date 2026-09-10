import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type {
  BootstrapPayload,
  CandidateEvaluationAuthoringWorkspace,
  ConfirmRecoveryInput,
  ConfirmRecoveryResult,
  CreateRecoveryPackageInput,
  CreateRecoveryPackageResult,
  ImportCandidateEvaluationBenchmarkResult,
  CreateCandidateEvaluationDraftInput,
  SaveCandidateEvaluationDraftCaseInput,
  DeleteCandidateEvaluationDraftCaseInput,
  EvaluateCandidateEvaluationDraftInput,
  EvaluateCandidateEvaluationDraftResult,
  GoogleWorkspaceOnlineAcceptanceReport,
  GoogleWorkspaceReadinessReport,
  PreviewRecoveryPackageInput,
  RecoveryPreviewResult,
  SnoozeRecoveryReminderInput,
  SaveGoogleWorkspaceAdminConfigurationInput,
  SaveGoogleWorkspaceAdminConfigurationResult
} from '@shared'
import { Icon } from './Icon'
import { CandidateEvaluationAuthoringDialog } from './CandidateEvaluationAuthoringDialog'
import { GoogleWorkspaceSettingsDialog } from './GoogleWorkspaceSettingsDialog'
import { useRendererUiRefresh, useUiLocale, useUiText } from '../i18n'

interface GovernancePanelProps {
  bootstrap: BootstrapPayload
  showExternalSystems?: boolean
  googleSettingsRequestId?: number | null
  onGoogleSettingsRequestHandled?(): void
  onConnectGoogleWorkspace(): Promise<void>
  onDiagnoseGoogleWorkspace(): Promise<GoogleWorkspaceReadinessReport>
  onRunGoogleWorkspaceOnlineAcceptance(): Promise<GoogleWorkspaceOnlineAcceptanceReport>
  onSaveGoogleWorkspaceAdminConfiguration(input: SaveGoogleWorkspaceAdminConfigurationInput): Promise<SaveGoogleWorkspaceAdminConfigurationResult>
  onDisconnectGoogleWorkspace(): Promise<void>
  onSyncGoogleWorkspace(): Promise<void>
  onImportCandidateEvaluationBenchmark(): Promise<ImportCandidateEvaluationBenchmarkResult>
  onGetCandidateEvaluationAuthoringWorkspace(): Promise<CandidateEvaluationAuthoringWorkspace>
  onCreateCandidateEvaluationDraft(input: CreateCandidateEvaluationDraftInput): Promise<CandidateEvaluationAuthoringWorkspace>
  onSaveCandidateEvaluationDraftCase(input: SaveCandidateEvaluationDraftCaseInput): Promise<CandidateEvaluationAuthoringWorkspace>
  onDeleteCandidateEvaluationDraftCase(input: DeleteCandidateEvaluationDraftCaseInput): Promise<CandidateEvaluationAuthoringWorkspace>
  onEvaluateCandidateEvaluationDraft(input: EvaluateCandidateEvaluationDraftInput): Promise<EvaluateCandidateEvaluationDraftResult>
  onCreateRecovery(input: CreateRecoveryPackageInput): Promise<CreateRecoveryPackageResult>
  onSnoozeRecoveryReminder(input: SnoozeRecoveryReminderInput): Promise<void>
  onPreviewRecovery(input: PreviewRecoveryPackageInput): Promise<RecoveryPreviewResult>
  onConfirmRecovery(input: ConfirmRecoveryInput): Promise<ConfirmRecoveryResult>
  responsiveOpen: boolean
  onClose(): void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function GovernancePanel({
  bootstrap,
  showExternalSystems = true,
  googleSettingsRequestId = null,
  onGoogleSettingsRequestHandled,
  onConnectGoogleWorkspace,
  onDiagnoseGoogleWorkspace,
  onRunGoogleWorkspaceOnlineAcceptance,
  onSaveGoogleWorkspaceAdminConfiguration,
  onDisconnectGoogleWorkspace,
  onSyncGoogleWorkspace,
  onImportCandidateEvaluationBenchmark,
  onGetCandidateEvaluationAuthoringWorkspace,
  onCreateCandidateEvaluationDraft,
  onSaveCandidateEvaluationDraftCase,
  onDeleteCandidateEvaluationDraftCase,
  onEvaluateCandidateEvaluationDraft,
  onCreateRecovery,
  onSnoozeRecoveryReminder,
  onPreviewRecovery,
  onConfirmRecovery,
  responsiveOpen,
  onClose
}: GovernancePanelProps) {
  useRendererUiRefresh()
  const locale = useUiLocale()
  const t = useUiText()
  const [gmailBusy, setGmailBusy] = useState(false)
  const [gmailError, setGmailError] = useState<string | null>(null)
  const [gmailReadiness, setGmailReadiness] = useState<GoogleWorkspaceReadinessReport | null>(null)
  const [gmailAcceptance, setGmailAcceptance] = useState<GoogleWorkspaceOnlineAcceptanceReport | null>(bootstrap.googleWorkspaceAcceptance)
  const [googleSettingsOpen, setGoogleSettingsOpen] = useState(false)
  const [evaluationBusy, setEvaluationBusy] = useState(false)
  const [evaluationError, setEvaluationError] = useState<string | null>(null)
  const [evaluationAuthoringOpen, setEvaluationAuthoringOpen] = useState(false)
  const [evaluationAuthoringLoading, setEvaluationAuthoringLoading] = useState(false)
  const [evaluationAuthoringWorkspace, setEvaluationAuthoringWorkspace] = useState<CandidateEvaluationAuthoringWorkspace | null>(null)
  const [recoveryDialog, setRecoveryDialog] = useState<'backup' | 'restore-password' | 'restore-confirm' | null>(null)
  const [recoveryPassword, setRecoveryPassword] = useState('')
  const [recoveryPasswordConfirmation, setRecoveryPasswordConfirmation] = useState('')
  const [restoreConfirmationText, setRestoreConfirmationText] = useState('')
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const [reminderBusy, setReminderBusy] = useState(false)
  const [reminderError, setReminderError] = useState<string | null>(null)
  const [recoveryResult, setRecoveryResult] = useState<CreateRecoveryPackageResult | null>(null)
  const [recoveryPreview, setRecoveryPreview] = useState<RecoveryPreviewResult | null>(null)
  const [restartScheduled, setRestartScheduled] = useState(false)
  const recoveryDialogRef = useRef<HTMLElement | null>(null)
  const recoveryDialogWasOpen = useRef(false)
  const recoveryOpener = useRef<HTMLElement | null>(null)
  const evaluationAuthoringOpener = useRef<HTMLElement | null>(null)
  const googleSettingsOpener = useRef<HTMLElement | null>(null)
  const responsiveCloseRef = useRef<HTMLButtonElement | null>(null)
  const governanceWasOpen = useRef(false)
  const governanceOpener = useRef<HTMLElement | null>(null)
  const gmailLabel = bootstrap.gmail.configuration === 'required'
    ? '管理者設定待ち'
    : bootstrap.gmail.status === 'not-connected' ? '未接続' : '読取専用'
  const gmailDescription = bootstrap.gmail.configuration === 'required'
    ? 'このビルドには Google メール接続が組み込まれていません。ソフトウェア提供元に連絡してください。'
    : bootstrap.gmail.status === 'readonly'
      ? `${bootstrap.gmail.accountEmail} を読取専用で接続中です。Gmail 草稿・送信権限は取得していません。`
      : '個人 Gmail または Google Workspace の会社メールを、システムブラウザと PKCE で読取専用接続します。'
  const localOcrUnavailable = bootstrap.privacy.localAi === 'pii-rules-active-ocr-unavailable'
  const localOcrIsolationPending = bootstrap.privacy.localAi === 'windows-ocr-bundled-isolation-pending'
  const windowsOcrRulesActive = bootstrap.privacy.localAi === 'windows-ocr-and-pii-rules-active'
  const privacyQuality = bootstrap.privacy.qualityGate
  const privacyExpert = bootstrap.privacy.expertGate
  const gmailAcceptanceHasWarning = gmailAcceptance?.checks.some((check) => check.status === 'warning') ?? false
  const gmailSyncError = bootstrap.gmailSync.lastError
    ? ({
        GOOGLE_REAUTH_REQUIRED: 'Google の認証が失効しました。Google メールアカウントを再接続してください。',
        GMAIL_SCOPE_REJECTED: '読取専用以外の権限が検出されました。接続を解除して管理者設定を確認してください。',
        SYNC_SCOPE_TOO_BROAD: '同期対象が上限を超えました。Label・期間・キーワードを絞ってください。',
        MESSAGE_PROCESSING_FAILED: '一部メールのローカル脱敏に失敗しました。チェックポイントは進めていません。',
        GMAIL_HTTP_401: 'Gmail API が認証を拒否しました。Google メールアカウントを再接続してください。',
        GMAIL_HTTP_403: 'Gmail API の利用権限を確認できません。会社アカウントの場合は Workspace 管理者に本製品の許可を依頼してください。'
      } as Record<string, string>)[bootstrap.gmailSync.lastError] ?? 'Gmail の同期に失敗しました。設定とネットワークを確認してください。'
    : null

  useEffect(() => {
    if (recoveryDialog) {
      if (!recoveryDialogWasOpen.current) {
        recoveryDialogWasOpen.current = true
        recoveryOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      }
      const frame = requestAnimationFrame(() => {
        recoveryDialogRef.current?.querySelector<HTMLElement>('[data-initial-focus="true"]')?.focus()
      })
      return () => cancelAnimationFrame(frame)
    }
    if (recoveryDialogWasOpen.current) {
      recoveryDialogWasOpen.current = false
      const opener = recoveryOpener.current
      recoveryOpener.current = null
      requestAnimationFrame(() => opener?.isConnected && opener.focus())
    }
    return undefined
  }, [recoveryDialog])

  useEffect(() => {
    if (responsiveOpen) {
      if (!governanceWasOpen.current) {
        governanceWasOpen.current = true
        governanceOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      }
      if (googleSettingsOpen) return undefined
      const timer = window.setTimeout(() => {
        if (responsiveCloseRef.current?.offsetParent) responsiveCloseRef.current.focus()
      }, 200)
      return () => window.clearTimeout(timer)
    }
    if (governanceWasOpen.current) {
      governanceWasOpen.current = false
      const opener = governanceOpener.current
      governanceOpener.current = null
      requestAnimationFrame(() => opener?.isConnected && opener.focus())
    }
    return undefined
  }, [googleSettingsOpen, responsiveOpen])

  useEffect(() => {
    if (googleSettingsRequestId === null) return
    onGoogleSettingsRequestHandled?.()
    googleSettingsOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setGoogleSettingsOpen(true)
  }, [googleSettingsRequestId])

  const changeConnection = async (operation: () => Promise<void>) => {
    setGmailBusy(true)
    setGmailError(null)
    try {
      await operation()
    } catch (cause) {
      setGmailError(cause instanceof Error ? cause.message : 'Google Workspace 接続を更新できませんでした。')
    } finally {
      setGmailBusy(false)
    }
  }

  const diagnoseGoogleWorkspace = async () => {
    setGmailBusy(true)
    setGmailError(null)
    try {
      setGmailReadiness(await onDiagnoseGoogleWorkspace())
    } catch (cause) {
      setGmailError(cause instanceof Error ? cause.message : 'Google Workspace 事前診断を実行できませんでした。')
    } finally {
      setGmailBusy(false)
    }
  }

  const runGoogleWorkspaceOnlineAcceptance = async () => {
    setGmailBusy(true)
    setGmailError(null)
    try {
      setGmailAcceptance(await onRunGoogleWorkspaceOnlineAcceptance())
    } catch (cause) {
      setGmailError(cause instanceof Error ? cause.message : 'Google Workspace のオンライン受入検証に失敗しました。')
    } finally {
      setGmailBusy(false)
    }
  }

  const openGoogleSettings = () => {
    googleSettingsOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setGoogleSettingsOpen(true)
  }

  const closeGoogleSettings = () => {
    setGoogleSettingsOpen(false)
    const opener = googleSettingsOpener.current
    googleSettingsOpener.current = null
    requestAnimationFrame(() => opener?.isConnected && opener.focus())
  }

  const closeEvaluationAuthoring = () => {
    setEvaluationAuthoringOpen(false)
    const opener = evaluationAuthoringOpener.current
    evaluationAuthoringOpener.current = null
    requestAnimationFrame(() => opener?.isConnected && opener.focus())
  }

  const openEvaluationAuthoring = async () => {
    evaluationAuthoringOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setEvaluationAuthoringOpen(true)
    setEvaluationAuthoringLoading(true)
    setEvaluationError(null)
    try {
      setEvaluationAuthoringWorkspace(await onGetCandidateEvaluationAuthoringWorkspace())
    } catch (cause) {
      setEvaluationError(cause instanceof Error ? cause.message : '評価セット草稿を読み込めませんでした。')
      closeEvaluationAuthoring()
    } finally {
      setEvaluationAuthoringLoading(false)
    }
  }

  const closeRecoveryDialog = () => {
    if (recoveryBusy || restartScheduled) return
    setRecoveryDialog(null)
    setRecoveryPassword('')
    setRecoveryPasswordConfirmation('')
    setRestoreConfirmationText('')
    setRecoveryError(null)
    setRecoveryPreview(null)
  }

  const handleRecoveryDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeRecoveryDialog()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...(recoveryDialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
    ) ?? [])].filter((element) => element.offsetParent !== null)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const createBackup = async () => {
    setRecoveryBusy(true)
    setRecoveryError(null)
    try {
      const result = await onCreateRecovery({
        password: recoveryPassword,
        passwordConfirmation: recoveryPasswordConfirmation
      })
      setRecoveryPassword('')
      setRecoveryPasswordConfirmation('')
      if (!result.cancelled) {
        setRecoveryResult(result)
        setRecoveryDialog(null)
      }
    } catch (cause) {
      setRecoveryError(cause instanceof Error ? cause.message : '暗号化バックアップを作成できませんでした。')
    } finally {
      setRecoveryBusy(false)
    }
  }

  const previewRestore = async () => {
    setRecoveryBusy(true)
    setRecoveryError(null)
    try {
      const preview = await onPreviewRecovery({ password: recoveryPassword })
      setRecoveryPassword('')
      if (!preview.cancelled && preview.summary) {
        setRecoveryPreview(preview)
        setRecoveryDialog('restore-confirm')
      }
    } catch (cause) {
      setRecoveryError(cause instanceof Error ? cause.message : '復元パッケージを検証できませんでした。')
    } finally {
      setRecoveryBusy(false)
    }
  }

  const confirmRestore = async () => {
    const preview = recoveryPreview
    if (!preview?.restoreToken || !preview.confirmationHash) return
    setRecoveryBusy(true)
    setRecoveryError(null)
    try {
      await onConfirmRecovery({
        restoreToken: preview.restoreToken,
        confirmationHash: preview.confirmationHash,
        confirmationText: '復元'
      })
      setRestartScheduled(true)
    } catch (cause) {
      setRecoveryError(cause instanceof Error ? cause.message : '復元を予約できませんでした。')
      setRecoveryBusy(false)
    }
  }

  const snoozeReminder = async (days: 1 | 7) => {
    setReminderBusy(true)
    setReminderError(null)
    try {
      await onSnoozeRecoveryReminder({ days })
    } catch (cause) {
      setReminderError(cause instanceof Error ? cause.message : 'バックアップ通知を更新できませんでした。')
    } finally {
      setReminderBusy(false)
    }
  }

  const importEvaluationBenchmark = async () => {
    setEvaluationBusy(true)
    setEvaluationError(null)
    try {
      await onImportCandidateEvaluationBenchmark()
    } catch (cause) {
      setEvaluationError(cause instanceof Error ? cause.message : '候補者評価セットを実行できませんでした。')
    } finally {
      setEvaluationBusy(false)
    }
  }

  const latestBackupAt = recoveryResult?.summary?.createdAt ?? bootstrap.recovery.lastBackupAt
  const reminder = bootstrap.recovery.reminder
  const recoveryStatusLabel = reminder.status === 'due'
    ? '要バックアップ'
    : reminder.status === 'snoozed' ? '通知延期中' : latestBackupAt ? '最新' : 'データなし'
  const reminderDescription = reminder.reason === 'no-backup'
    ? '保護対象のローカルデータがありますが、まだ復元パッケージがありません。'
    : '前回のバックアップ後にローカルデータが更新されています。'
  const evaluation = bootstrap.candidateEvaluation
  const evaluationReport = evaluation.latestReport
  const evaluationStatusLabel = !evaluationReport
    ? '未評価'
    : evaluationReport.status === 'passed' ? '品質門通過'
      : evaluationReport.status === 'failed' ? '閾値未達'
        : evaluationReport.status === 'insufficient-cases' ? 'ケース不足' : '参照要確認'
  const evaluationStatusClass = evaluationReport?.status === 'passed'
    ? 'success'
    : evaluationReport ? 'warning' : 'neutral'

  return (
    <>
      {responsiveOpen ? <button aria-label={t('データと承認パネルを閉じる')} className="governance-responsive-backdrop" onClick={onClose} type="button" /> : null}
      <aside
        className={`governance-panel${responsiveOpen ? ' is-responsive-open' : ''}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !recoveryDialog) {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <div className="panel-heading">
          <div>
            <span className="eyebrow">TASK CONTROL</span>
            <h2>{t('データと承認')}</h2>
          </div>
          <div className="governance-panel-actions">
            <button aria-label={t('パネル設定は未提供')} className="icon-button" disabled title={t('設定は各ガバナンスカードから行います')} type="button"><Icon name="settings" size={18} /></button>
            <button aria-label={t('データと承認パネルを閉じる')} className="governance-responsive-close" onClick={onClose} ref={responsiveCloseRef} type="button">×</button>
          </div>
        </div>

        <section className="governance-card privacy-card">
          <div className="card-icon positive"><Icon name="shield" size={19} /></div>
          <div>
            <div className="card-title-row">
              <h3>{t('クラウド送信前の脱敏')}</h3>
              <span className="status-chip success">{t('強制')}</span>
            </div>
            <p>{t('姓名・電話・住所に加え、国籍・在留資格・就労資格もローカルで置換し、DLP通過後のみ送信します。')}</p>
            <div className="policy-line"><span>{bootstrap.privacy.policyVersion}</span><span>{t('バイパス不可')}</span></div>
            <div className="policy-line"><span>SQLCipher schema v{bootstrap.storage.schemaVersion}</span><span>{bootstrap.storage.keyProtection === 'windows-dpapi' ? 'Windows DPAPI' : 'macOS Keychain'}</span></div>
            <div className="policy-line">
              <span>{privacyQuality.status === 'passed' ? `${t('固定合成回帰')} ${privacyQuality.caseCount}${t('件')}` : t('固定回帰 未検証')}</span>
              <span>{privacyQuality.status === 'passed' ? 'Recall / Precision 100%' : t('リリース不可')}</span>
            </div>
            <div className="policy-line">
              <span>{privacyExpert.status === 'passed' ? `${t('日本語専門家評価')} ${privacyExpert.caseCount}${t('件')}` : t('日本語専門家評価 未完了')}</span>
              <span>{privacyExpert.status === 'passed'
                ? `氏名自動Recall ${Math.round((privacyExpert.automaticPersonNameRecall ?? 0) * 100)}%`
                : t('任意の品質証跡')}</span>
            </div>
            <small className="privacy-quality-disclaimer">{privacyExpert.status === 'passed'
              ? t('専門家評価後も姓名の人工確認は必須です。評価データ本文は端末外へ送信・報告しません。')
              : t('日本語専門家評価は推奨される品質・監査証跡ですが、Cloud AI の実行や正式リリースを阻止しません。')}</small>
          </div>
        </section>

        <section className="governance-card">
          <div className="card-icon blue"><Icon name="sparkles" size={19} /></div>
          <div>
            <div className="card-title-row">
              <h3>{t('ローカル AI')}</h3>
              <span className={`status-chip ${localOcrUnavailable || localOcrIsolationPending ? 'warning' : 'neutral'}`}>
                {t(localOcrIsolationPending ? '隔離検証待ち' : localOcrUnavailable ? 'OCR未搭載' : '端末内のみ')}
              </span>
            </div>
            <p>{t(localOcrIsolationPending
              ? '日英の固定オフラインOCR Runtimeは搭載済みです。Windows実機のカーネルネットワーク隔離が検証されるまで無効化し、クラウドOCRへ回しません。'
              : localOcrUnavailable
                ? '姓名候補・PII/DLPと候補者検索の多言語Vector・日文Rerankは端末内で実行します。スキャン文書はローカルOCRが検証されるまで処理を止め、クラウドOCRへ回しません。'
                : windowsOcrRulesActive
                  ? '日英OCR・PII/DLPルール・多言語Vector・日文Rerankは端末内で実行します。Windowsの姓名候補は項目ラベルと規則で検出し、HR確認を必須にします。検証済みでない日本語NERを搭載済みとは表示しません。'
                  : 'OCR・姓名候補・PII/DLP、多言語Vectorと日文Rerankを端末内で実行します。固定モデルはネット接続せず、候補者原文をクラウドへ送りません。')}</p>
          </div>
        </section>

        {showExternalSystems ? <section className="governance-card">
          <div className="card-icon muted"><Icon name="mail" size={19} /></div>
          <div>
            <div className="card-title-row">
              <h3>Google Workspace</h3>
              <span className={`status-chip ${bootstrap.gmail.status === 'readonly' ? 'success' : 'warning'}`}>{t(gmailLabel)}</span>
            </div>
            <p>{t(gmailDescription)}</p>
            <div className="gmail-scope-line"><span>gmail.readonly</span><strong>{t(bootstrap.gmail.readAccess ? '許可済み' : '未許可')}</strong></div>
            <div className="gmail-scope-line"><span>{t('草稿・送信')}</span><strong>{t('未要求・送信実装なし')}</strong></div>
            <div className="gmail-sync-scope">
              <span>{t('同期範囲')}</span>
              <strong>{bootstrap.gmailSync.configuration === 'ready'
                ? `${bootstrap.gmailSync.labelIds.join(', ')} · ${bootstrap.gmailSync.lookbackDays}日 · ${bootstrap.gmailSync.query}`
                : t('Label・業務キーワードの管理者設定待ち')}</strong>
              <small>{t('保存')} {bootstrap.gmailSync.storedMessages}{t('件')}{bootstrap.gmailSync.lastSyncedAt ? ` · ${t('最終')} ${new Date(bootstrap.gmailSync.lastSyncedAt).toLocaleString(locale)}` : ` · ${t('未同期')}`}</small>
            </div>
            {bootstrap.gmailSync.personnelIntake?.warnings ? <p role="status">{locale === 'zh-CN' ? `邮件附件：${bootstrap.gmailSync.personnelIntake.failed} 封需要重试，${bootstrap.gmailSync.personnelIntake.warnings} 封有附件提示。失败附件会在下次同步重试；不支持的格式可转换为 PDF、Word 或 Excel 后导入。` : `添付取込：再試行 ${bootstrap.gmailSync.personnelIntake.failed}件、注意 ${bootstrap.gmailSync.personnelIntake.warnings}件。次回同期で再試行します。未対応形式はPDF・Word・Excelに変換してください。`}</p> : null}
            {bootstrap.gmailSync.lastRun ? <p className="gmail-sync-result">{bootstrap.gmailSync.lastRun.mode} · 取込 {bootstrap.gmailSync.lastRun.imported} · 重複 {bootstrap.gmailSync.lastRun.duplicates} · 範囲外 {bootstrap.gmailSync.lastRun.filtered}</p> : null}
            {gmailError || gmailSyncError ? <p className="gmail-connection-error">{gmailError ?? gmailSyncError}</p> : null}
            {bootstrap.gmail.status === 'readonly' ? (
              <div className="gmail-actions">
                <button className="text-action" disabled={gmailBusy || bootstrap.gmailSync.configuration !== 'ready'} onClick={() => void changeConnection(onSyncGoogleWorkspace)} type="button">{t(gmailBusy ? '処理中…' : '今すぐ同期')}</button>
                <button className="text-action" disabled={gmailBusy} onClick={() => void runGoogleWorkspaceOnlineAcceptance()} type="button">{t('オンライン受入検証')}</button>
                <button className="text-action" disabled={gmailBusy} onClick={() => void changeConnection(onDisconnectGoogleWorkspace)} type="button">{t('接続を解除')}</button>
                <button className="text-action" disabled={gmailBusy} onClick={openGoogleSettings} type="button">{t('設定内容')}</button>
              </div>
            ) : bootstrap.gmail.configuration === 'required' ? (
              <button className="text-action" disabled={gmailBusy} onClick={openGoogleSettings} type="button">{t('管理者設定を開く')}</button>
            ) : (
              <div className="gmail-actions">
                <button className="text-action" disabled={gmailBusy} onClick={() => void changeConnection(onConnectGoogleWorkspace)} type="button">{t(gmailBusy ? 'ブラウザを起動中…' : '読取専用で接続')}</button>
                <button className="text-action" disabled={gmailBusy} onClick={openGoogleSettings} type="button">{t('設定内容')}</button>
              </div>
            )}
            {bootstrap.gmail.status !== 'readonly' ? (
              <button className="text-action gmail-diagnostic-action" disabled={gmailBusy} onClick={() => void diagnoseGoogleWorkspace()} type="button">
                {t(gmailBusy ? '診断中…' : '接続事前診断')}
              </button>
            ) : null}
            {gmailReadiness ? (
              <div className={`gmail-readiness ${gmailReadiness.overall === 'ready' ? 'is-ready' : 'needs-action'}`} role="status">
                <div className="gmail-readiness-heading">
                  <strong>{gmailReadiness.overall === 'ready' ? '端末側の接続準備完了' : '管理者の対応が必要'}</strong>
                  <span>メール未読取 · Token未作成</span>
                </div>
                <ul>
                  {gmailReadiness.checks.map((check) => (
                    <li key={check.id}>
                      <span className={`readiness-mark ${check.status}`}>{check.status === 'passed' ? '✓' : check.status === 'warning' ? '!' : '×'}</span>
                      <span><strong>{check.label}</strong><small>{check.detail}</small></span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {gmailAcceptance && bootstrap.gmail.status === 'readonly' ? (
              <div className={`gmail-readiness gmail-acceptance ${gmailAcceptance.overall === 'passed' ? 'is-ready' : 'needs-action'}`} role="status">
                <div className="gmail-readiness-heading">
                  <strong>{gmailAcceptance.overall === 'passed'
                    ? gmailAcceptanceHasWarning ? 'オンライン受入検証 合格・要確認あり' : 'オンライン受入検証 合格'
                    : 'オンライン受入検証 要対応'}</strong>
                  <span>Profileのみ再取得 · 本文未取得 · Cloud LLM未使用</span>
                </div>
                <div className="gmail-acceptance-summary">
                  <span>保存 {gmailAcceptance.evidence.redaction.storedMessages}件</span>
                  <span>脱敏通過 {gmailAcceptance.evidence.redaction.passed}件</span>
                  <span>要確認 {gmailAcceptance.evidence.redaction.uncertain}件</span>
                </div>
                <ul>
                  {gmailAcceptance.checks.map((check) => (
                    <li key={check.id}>
                      <span className={`readiness-mark ${check.status}`}>{check.status === 'passed' ? '✓' : check.status === 'warning' ? '!' : '×'}</span>
                      <span><strong>{check.label}</strong><small>{check.detail}</small></span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section> : null}

        <section className="governance-card evaluation-card">
          <div className="card-icon blue"><Icon name="check" size={19} /></div>
          <div>
            <div className="card-title-row">
              <h3>{t('候補者検索の品質門')}</h3>
              <span className={`status-chip ${evaluationStatusClass}`}>{t(evaluationStatusLabel)}</span>
            </div>
            <p>{t('脱敏済みの SES 専門家ラベルを端末内で実行し、Hybrid Retrieval の Recall@20・NDCG@20・Project Evidence を検証します。')}</p>
            {evaluation.dataset && evaluationReport ? <>
              <div className="evaluation-dataset-line">
                <strong>{evaluation.dataset.name}</strong>
                <span>{evaluation.dataset.caseCount}ケース · 正例 {evaluation.dataset.relevantCandidates}件 · Reviewer {evaluation.dataset.reviewerCount}名</span>
              </div>
              <div className="evaluation-metrics-grid">
                <div><span>Recall@20</span><strong>{(evaluationReport.metrics.recallAt20 * 100).toFixed(1)}%</strong><small>基準 {(evaluationReport.thresholds.recallAt20 * 100).toFixed(0)}%</small></div>
                <div><span>NDCG@20</span><strong>{evaluationReport.metrics.ndcgAt20.toFixed(3)}</strong><small>基準 {evaluationReport.thresholds.ndcgAt20.toFixed(2)}</small></div>
                <div><span>Project Evidence</span><strong>{evaluationReport.metrics.projectEvidenceCoverageAt20 === null ? '対象なし' : `${(evaluationReport.metrics.projectEvidenceCoverageAt20 * 100).toFixed(1)}%`}</strong><small>基準 {(evaluationReport.thresholds.projectEvidenceCoverageAt20 * 100).toFixed(0)}%</small></div>
              </div>
              {evaluationReport.status === 'insufficient-cases' ? <p className="evaluation-warning">品質門には最低 {evaluationReport.thresholds.minimumCases} ケースが必要です。</p> : null}
              {evaluationReport.status === 'invalid-references' ? <p className="evaluation-warning">現行候補者庫に存在しない匿名候補者参照が {evaluationReport.metrics.missingCandidateReferences} 件あります。</p> : null}
              <div className="policy-line"><span>Cloud 送信なし</span><span>{evaluationReport.modelId}</span></div>
              <div className="policy-line"><span>Hard Filter Policy</span><span>{evaluationReport.hardFilterPolicyVersion}</span></div>
            </> : <div className="evaluation-empty">{t('30–50 件の脱敏済み案件と匿名候補者正解ラベルを含む Benchmark v1 を選択してください。')}</div>}
            {evaluationError ? <p className="evaluation-error" role="alert">{evaluationError}</p> : null}
            <div className="evaluation-actions">
              <button className="text-action" disabled={evaluationBusy} onClick={() => void openEvaluationAuthoring()} type="button">{t('専門家ラベルを作成')}</button>
              <button className="text-action" disabled={evaluationBusy} onClick={() => void importEvaluationBenchmark()} type="button">
                {t(evaluationBusy ? 'ローカル評価中…' : 'JSONを読み込む')}
              </button>
            </div>
          </div>
        </section>

        <section className="governance-card recovery-card">
          <div className="card-icon positive"><Icon name="database" size={19} /></div>
          <div>
            <div className="card-title-row">
              <h3>{t('暗号化バックアップ')}</h3>
              <span className={`status-chip ${reminder.status === 'not-needed' ? 'success' : 'warning'}`}>{t(recoveryStatusLabel)}</span>
            </div>
            <p>{t('SQLCipher の整合スナップショットと暗号化ファイルを、独立した復元パスワードで一つのパッケージにします。')}</p>
            {reminder.status === 'due' ? (
              <div aria-live="polite" className="recovery-reminder due" role="status">
                <Icon name="alert" size={15} />
                <div><strong>{t('ローカルデータのバックアップを確認')}</strong><span>{t(reminderDescription)}</span></div>
              </div>
            ) : null}
            {reminder.status === 'snoozed' && reminder.snoozedUntil ? (
              <div aria-live="polite" className="recovery-reminder snoozed" role="status">
                <Icon name="clock" size={15} />
                <div><strong>通知を延期しました</strong><span>{new Date(reminder.snoozedUntil).toLocaleString(locale)} に再通知します。新しい変更があれば早めに再表示します。</span></div>
              </div>
            ) : null}
            <div className="recovery-status-line">
              <span>{t('最終バックアップ')}</span>
              <strong>{latestBackupAt ? new Date(latestBackupAt).toLocaleString(locale) : t('まだありません')}</strong>
            </div>
            {recoveryResult?.fileName ? <p className="recovery-result">{recoveryResult.fileName} · 検証済み</p> : null}
            {reminderError ? <p className="recovery-reminder-error">{reminderError}</p> : null}
            <div className="recovery-actions">
              <button className="text-action" onClick={() => { setRecoveryError(null); setRecoveryDialog('backup') }} type="button">{t('バックアップを作成')}</button>
              <button className="text-action" onClick={() => { setRecoveryError(null); setRecoveryDialog('restore-password') }} type="button">{t('パッケージから復元')}</button>
            </div>
            {reminder.status === 'due' ? (
              <div className="recovery-reminder-actions">
                <span>{t('今は作成しない')}</span>
                <button disabled={reminderBusy} onClick={() => void snoozeReminder(1)} type="button">{t('明日再通知')}</button>
                <button disabled={reminderBusy} onClick={() => void snoozeReminder(7)} type="button">{t('7日後')}</button>
              </div>
            ) : null}
          </div>
        </section>

        <section className="approval-card">
          <div className="approval-title"><Icon name="lock" size={18} /><h3>{t('人の確認ポイント')}</h3></div>
          <ul>
            <li><Icon name="check" size={15} /> {t('候補者の適合性')}</li>
            <li><Icon name="check" size={15} /> {t('提案内容と添付')}</li>
            <li><Icon name="check" size={15} /> {t('復元前の対象と置換範囲')}</li>
          </ul>
          <p>{t('このビルドに自動送信経路はありません。')}</p>
        </section>
      </aside>

      {evaluationAuthoringOpen ? (
        <CandidateEvaluationAuthoringDialog
          loading={evaluationAuthoringLoading}
          onClose={closeEvaluationAuthoring}
          onCreateDraft={onCreateCandidateEvaluationDraft}
          onDeleteCase={onDeleteCandidateEvaluationDraftCase}
          onEvaluate={onEvaluateCandidateEvaluationDraft}
          onSaveCase={onSaveCandidateEvaluationDraftCase}
          onWorkspaceChange={setEvaluationAuthoringWorkspace}
          workspace={evaluationAuthoringWorkspace}
        />
      ) : null}

      {googleSettingsOpen ? (
        <GoogleWorkspaceSettingsDialog
          configuration={bootstrap.googleWorkspaceConfiguration}
          connected={bootstrap.gmail.status !== 'not-connected'}
          onClose={closeGoogleSettings}
          onSave={onSaveGoogleWorkspaceAdminConfiguration}
        />
      ) : null}

      {recoveryDialog ? (
        <div className="recovery-dialog-backdrop" role="presentation">
          <section
            aria-describedby="recovery-dialog-description"
            aria-labelledby="recovery-dialog-title"
            aria-modal="true"
            className="recovery-dialog"
            onKeyDown={handleRecoveryDialogKeyDown}
            ref={recoveryDialogRef}
            role="dialog"
          >
            <header>
              <div>
                <span className="eyebrow">LOCAL RECOVERY</span>
                <h2 id="recovery-dialog-title">{recoveryDialog === 'backup' ? '暗号化バックアップを作成' : recoveryDialog === 'restore-password' ? '復元パッケージを検証' : '復元内容を最終確認'}</h2>
                <p id="recovery-dialog-description">{recoveryDialog === 'backup' ? 'この端末の Keychain とは別のパスワードで保護します。' : recoveryDialog === 'restore-password' ? 'パスワードは検証中だけメモリに保持し、保存しません。' : '現在のローカルデータは再起動時に置き換えられます。'}</p>
              </div>
              <button aria-label="復元ダイアログを閉じる" disabled={recoveryBusy || restartScheduled} onClick={closeRecoveryDialog} type="button">×</button>
            </header>

            {recoveryDialog === 'backup' ? (
              <div className="recovery-password-form">
                <label>復元パスワード<input autoComplete="new-password" data-initial-focus="true" minLength={12} onChange={(event) => setRecoveryPassword(event.target.value)} type="password" value={recoveryPassword} /></label>
                <label>パスワードを再入力<input autoComplete="new-password" minLength={12} onChange={(event) => setRecoveryPasswordConfirmation(event.target.value)} type="password" value={recoveryPasswordConfirmation} /></label>
                <div className="recovery-notice"><Icon name="lock" size={17} /><p>12文字以上を設定してください。紛失すると、この復元パッケージからデータを戻せません。</p></div>
              </div>
            ) : null}

            {recoveryDialog === 'restore-password' ? (
              <div className="recovery-password-form">
                <label>復元パスワード<input autoComplete="current-password" data-initial-focus="true" minLength={12} onChange={(event) => setRecoveryPassword(event.target.value)} type="password" value={recoveryPassword} /></label>
                <div className="recovery-notice"><Icon name="shield" size={17} /><p>先に整包認証、Manifest、データベース、全ファイルのハッシュを検証します。検証前に現在のデータは変更しません。</p></div>
              </div>
            ) : null}

            {recoveryDialog === 'restore-confirm' && recoveryPreview?.summary ? (
              <div className="recovery-preview">
                <dl>
                  <div><dt>作成日時</dt><dd>{new Date(recoveryPreview.summary.createdAt).toLocaleString(locale)}</dd></div>
                  <div><dt>作成環境</dt><dd>{recoveryPreview.summary.sourcePlatform} · {recoveryPreview.summary.sourceArch}</dd></div>
                  <div><dt>Schema</dt><dd>v{recoveryPreview.summary.schemaVersion}</dd></div>
                  <div><dt>保護データ</dt><dd>{formatBytes(recoveryPreview.summary.totalBytes)}</dd></div>
                  <div><dt>暗号化ファイル</dt><dd>{recoveryPreview.summary.vaultObjectCount}件</dd></div>
                  <div><dt>Google認証</dt><dd>含まない</dd></div>
                </dl>
                <ul>{recoveryPreview.warnings.map((warning) => <li key={warning}><Icon name="alert" size={14} />{warning}</li>)}</ul>
                <label className="restore-confirmation">確認のため「復元」と入力<input autoComplete="off" data-initial-focus="true" onChange={(event) => setRestoreConfirmationText(event.target.value)} value={restoreConfirmationText} /></label>
                {restartScheduled ? <div className="recovery-restarting"><Icon name="check" size={18} /><strong>復元を予約しました。安全に再起動しています…</strong></div> : null}
              </div>
            ) : null}

            {recoveryError ? <p className="recovery-dialog-error"><Icon name="alert" size={15} />{recoveryError}</p> : null}
            <footer>
              <button disabled={recoveryBusy || restartScheduled} onClick={closeRecoveryDialog} type="button">キャンセル</button>
              {recoveryDialog === 'backup' ? <button disabled={recoveryBusy || recoveryPassword.length < 12 || recoveryPassword !== recoveryPasswordConfirmation} onClick={() => void createBackup()} type="button">{recoveryBusy ? '暗号化中…' : '保存先を選んで作成'}</button> : null}
              {recoveryDialog === 'restore-password' ? <button disabled={recoveryBusy || recoveryPassword.length < 12} onClick={() => void previewRestore()} type="button">{recoveryBusy ? '検証中…' : 'パッケージを選んで検証'}</button> : null}
              {recoveryDialog === 'restore-confirm' ? <button className="danger-action" disabled={recoveryBusy || restartScheduled || restoreConfirmationText !== (locale === 'zh-CN' ? '恢复' : '復元')} onClick={() => void confirmRestore()} type="button">{recoveryBusy || restartScheduled ? '再起動を準備中…' : '確認して復元'}</button> : null}
            </footer>
          </section>
        </div>
      ) : null}
    </>
  )
}
