import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { SignedWorkTaskPreview, WorkTask } from '@domain'
import type { CreateWorkTaskInput, WorkTaskInput } from '@shared'
import { Icon } from './Icon'
import { translateUiText, useRendererUiRefresh, useUiText } from '../i18n'

interface TaskComposerProps {
  mode?: 'general' | 'matching'
  focusRequestId: number | null
  gmailConnected: boolean
  gmailSetupRequired: boolean
  gmailSyncStatus: 'never' | 'idle' | 'error'
  onPreview(input: WorkTaskInput): Promise<SignedWorkTaskPreview>
  onCreate(input: CreateWorkTaskInput): Promise<WorkTask>
  onCreated(task: WorkTask): void
  onImportGmail(): Promise<void>
  onFocusRequestHandled(): void
  onOpenGoogleWorkspace(): void
  jobCases?: Array<{ id: string; version: number; title: string; requiredSkills: string | null; role: string | null }>
  initialJobCaseId?: string | null
}

const quickActions = [
  { label: '案件を登録', icon: 'briefcase' as const, text: '案件メールの内容から新しい案件を登録したい' },
  { label: '候補者を探す', icon: 'users' as const, text: 'JavaとAWS経験がある候補者を探して、根拠付きで比較したい' },
  { label: '提案下書き', icon: 'file' as const, text: '選択した候補者で提案メールの下書きを準備したい' }
]

const initialInstruction = 'Java経験5年以上、AWS、8月稼働、週3日リモート可の候補者を探したい'
/** The instruction this composer writes for a chosen case; only such text is rewritten when the case changes. */
const generatedMatchingInstructionPattern = /^案件「.*」に合う候補者を根拠付きで比較したい$/u
const initialInstructionZh = translateUiText('zh-CN', initialInstruction)

export function TaskComposer({
  mode = 'general',
  focusRequestId,
  gmailConnected,
  gmailSetupRequired,
  gmailSyncStatus,
  onPreview,
  onCreate,
  onCreated,
  onImportGmail,
  onFocusRequestHandled,
  onOpenGoogleWorkspace,
  jobCases = [],
  initialJobCaseId = null,
}: TaskComposerProps) {
  useRendererUiRefresh()
  const t = useUiText()
  const defaultInstruction = initialInstruction
  const [instruction, setInstruction] = useState(() => {
    const initialCase = jobCases.find((jobCase) => jobCase.id === initialJobCaseId) ?? jobCases[0] ?? null
    return mode === 'matching' && initialCase
      ? `案件「${initialCase.title}」に合う候補者を根拠付きで比較したい`
      : t(defaultInstruction)
  })
  const [preview, setPreview] = useState<SignedWorkTaskPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'gmail' | 'preview' | 'create' | null>(null)
  const [selectedJobCaseId, setSelectedJobCaseId] = useState<string | null>(() =>
    initialJobCaseId && jobCases.some((jobCase) => jobCase.id === initialJobCaseId)
      ? initialJobCaseId
      : jobCases[0]?.id ?? null
  )
  const instructionRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    setInstruction((current) =>
      current === initialInstruction || current === initialInstructionZh
        ? t(defaultInstruction)
        : current
    )
  }, [defaultInstruction, mode, t])

  // The page stays mounted while the operator opens matching for another
  // case, so the case it asks for arrives as a prop change, not a mount.
  // Follow it: select that case, and rewrite the instruction only while it
  // is still the generated one, never text the operator typed.
  useEffect(() => {
    if (mode !== 'matching' || !initialJobCaseId) return
    const next = jobCases.find((jobCase) => jobCase.id === initialJobCaseId)
    if (!next) return
    setSelectedJobCaseId((current) => {
      if (current === next.id) return current
      setInstruction((text) => generatedMatchingInstructionPattern.test(text) || text.trim() === ''
        ? `案件「${next.title}」に合う候補者を根拠付きで比較したい`
        : text)
      setPreview(null)
      return next.id
    })
  }, [initialJobCaseId, jobCases, mode])

  const fileTokens: string[] = []
  const selectedJobCase = jobCases.find((jobCase) => jobCase.id === selectedJobCaseId) ?? null
  const scopeId = mode === 'matching' && selectedJobCase
    ? 'selected-case' as const
    : 'confirmed-candidate-pool' as const

  const requestPreview = async () => {
    setBusy('preview')
    setError(null)
    try {
      const result = await onPreview({
        instruction,
        scopeId,
        fileTokens,
        ...(selectedJobCase ? { jobCaseId: selectedJobCase.id } : {})
      })
      setPreview(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '作業プレビューを作成できませんでした。')
    } finally {
      setBusy(null)
    }
  }

  const createTask = async () => {
    if (!preview) return
    setBusy('create')
    setError(null)
    try {
      const task = await onCreate({
        instruction: preview.instruction,
        scopeId: preview.scope.id,
        fileTokens,
        ...(selectedJobCase ? { jobCaseId: selectedJobCase.id } : {}),
        previewHash: preview.previewHash
      })
      setPreview(null)
      setInstruction('')
      onCreated(task)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '作業を開始できませんでした。')
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    if (focusRequestId === null) return
    onFocusRequestHandled()
    const frame = requestAnimationFrame(() => instructionRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [focusRequestId])

  const importGmail = async () => {
    if (gmailSetupRequired || !gmailConnected) {
      onOpenGoogleWorkspace()
      return
    }
    setBusy('gmail')
    setError(null)
    try {
      await onImportGmail()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gmail を同期できませんでした。接続と同期範囲を確認してください。')
      setBusy(null)
    }
  }

  const gmailActionLabel = gmailSetupRequired
    ? 'Gmailを設定'
    : !gmailConnected
      ? 'Gmailを接続'
      : busy === 'gmail'
        ? 'Gmail同期中…'
        : gmailSyncStatus === 'error'
          ? 'Gmail同期を再試行'
          : 'Gmailから取込'
  const gmailActionTitle = gmailSetupRequired
    ? 'Google Workspace の管理者設定を開く'
    : !gmailConnected
      ? '読取専用接続の案内を開く'
      : '設定済みの Label・期間・上限で Gmail を読取専用同期する'

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void requestPreview()
    }
  }

  return (
    <section className="composer-section" id="new-task">
      <div className="composer-heading">
        <span className="eyebrow">{t(mode === 'matching' ? 'AI MATCHING' : 'RESTRICTED BUSINESS TASK')}</span>
        <h2>{t(mode === 'matching' ? '案件と人材をマッチング' : '何を進めますか？')}</h2>
        <p>{t(mode === 'matching'
            ? '案件条件を入力すると、確認済み人材から根拠付きの候補者リストを作成します。'
            : '自然言語で指示すると、実行前にデータ範囲・手順・確認ポイントを表示します。')}</p>
      </div>

      <div className="composer-card">
        {mode === 'matching' ? (
          <label className="matching-case-selector">
            <span>確認済み案件</span>
            <select
              aria-label="マッチング対象案件"
              onChange={(event) => {
                const nextId = event.target.value
                const next = jobCases.find((jobCase) => jobCase.id === nextId) ?? null
                setSelectedJobCaseId(next?.id ?? null)
                setInstruction(next
                  ? `案件「${next.title}」に合う候補者を根拠付きで比較したい`
                  : '')
                setPreview(null)
              }}
              value={selectedJobCaseId ?? ''}
            >
              {jobCases.length === 0 ? <option value="">確認済み案件がありません</option> : null}
              {jobCases.map((jobCase) => (
                <option key={`${jobCase.id}-${jobCase.version}`} value={jobCase.id}>
                  {jobCase.title}{jobCase.role ? ` · ${jobCase.role}` : ''}
                </option>
              ))}
            </select>
            {selectedJobCase ? <small>{selectedJobCase.requiredSkills ?? '必須スキル未設定'} · v{selectedJobCase.version}</small> : null}
          </label>
        ) : null}
        <label htmlFor="task-instruction">{t(mode === 'matching' ? '案件条件' : '作業内容')}</label>
        <textarea
          id="task-instruction"
          maxLength={2000}
          onChange={(event) => {
            setInstruction(event.target.value)
            setPreview(null)
          }}
          onKeyDown={handleKeyDown}
          placeholder={t('例：この案件に合う候補者を探して、提案下書きを準備したい')}
          ref={instructionRef}
          value={instruction}
        />
        <div className="composer-meta-row">
          <span>{instruction.length} / 2000</span>
          <span>{t('⌘ Enter でプレビュー')}</span>
        </div>

        {mode === 'general' ? <div className="quick-action-grid">
          {quickActions.map((action) => (
            <button
              key={action.label}
              onClick={() => {
                setInstruction(t(action.text))
                setPreview(null)
              }}
              type="button"
            >
              <Icon name={action.icon} size={17} />
              {t(action.label)}
            </button>
          ))}
        </div> : null}

        <div className="composer-toolbar">
          <div className="composer-options">
            {mode === 'general' ? <button
              className={`subtle-button gmail-import-button${gmailConnected && !gmailSetupRequired ? ' is-ready' : ' needs-setup'}`}
              disabled={busy !== null}
              onClick={() => void importGmail()}
              title={t(gmailActionTitle)}
              type="button"
            >
              <Icon name="mail" size={17} /> {t(gmailActionLabel)}
            </button> : null}
            <div className="scope-select">
              <Icon name="database" size={16} />
              {t('確認済み候補者プール')}
            </div>
          </div>
          <button
            className="preview-button"
            disabled={busy !== null || instruction.trim().length < 8}
            onClick={() => void requestPreview()}
            type="button"
          >
            <Icon name="sparkles" size={18} />
            {t(busy === 'preview'
              ? '確認中…'
              : mode === 'matching'
                  ? 'マッチングをプレビュー'
                  : '作業をプレビュー')}
          </button>
        </div>

        <div className="policy-strip">
          <Icon name="shield" size={16} />
          <span>{t('直接識別子はクラウド送信前にローカルで除去')}</span>
          <span className="policy-divider" />
          <Icon name="lock" size={15} />
          <span>{t('自動送信なし')}</span>
        </div>

        {error ? <div className="inline-error"><Icon name="alert" size={17} /> {t(error)}</div> : null}

        {preview ? (
          <div className="task-preview-card" aria-live="polite">
            <div className="preview-topline">
              <div>
                <span className="status-chip preview">{t('実行前プレビュー')}</span>
                <h3>{t(preview.typeLabel)}</h3>
              </div>
              <button className="icon-button" aria-label={t('プレビューを閉じる')} onClick={() => setPreview(null)} type="button">×</button>
            </div>
            <div className="preview-summary-grid">
              <div>
                <span>{t('使用するデータ')}</span>
                <strong>{t(preview.scope.label)}</strong>
                <small>{t(preview.scope.detail)}</small>
              </div>
              <div>
                <span>{t('適用ポリシー')}</span>
                <strong>{t('個人識別子をクラウドから遮断')}</strong>
                <small>{preview.privacy.policyVersion}</small>
              </div>
              <div>
                <span>{t('人の確認')}</span>
                <strong>{preview.requiredApprovals.map(t).join(' · ')}</strong>
                <small>{t('確認完了まで外部送信なし')}</small>
              </div>
            </div>
            <ol className="preview-steps">
              {preview.steps.map((step, index) => (
                <li key={step.id}>
                  <span>{index + 1}</span>
                  <div><strong>{t(step.title)}</strong><small>{t(step.description)}</small></div>
                </li>
              ))}
            </ol>
            <div className="preview-actions">
              <button className="subtle-button" onClick={() => setPreview(null)} type="button">{t('修正する')}</button>
              <button className="create-button" disabled={busy !== null} onClick={() => void createTask()} type="button">
                <Icon name="check" size={18} />
                {t(busy === 'create' ? '作成中…' : '確認して開始')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
