import { useEffect, useState, type FormEvent } from 'react'
import type {
  CreateChatPasteJobCaseDraftInput,
  CreateChatPasteJobCaseDraftResult,
  CreateManualJobCaseDraftInput,
  CreateManualJobCaseDraftResult,
  DeleteJobCaseDataInput,
  DeleteJobCaseDataResult,
  JobCaseFieldKey,
  JobCaseDeletionPreview,
  JobCaseReviewSnapshot,
  JobCaseVersionDetail,
  ImportEmlJobCaseDraftsResult,
  ExecuteWechatVisibleReadResult,
  ReopenJobCaseReviewInput,
  ReopenJobCaseReviewResult,
  SetJobCaseLifecycleInput,
  SetJobCaseLifecycleResult,
  SubmitJobCaseReviewInput,
  SubmitJobCaseReviewResult,
  WechatVisibleMessageFeasibility
} from '@shared'
import { Icon } from './Icon'
import { useRendererUiRefresh, useUiLocale } from '../i18n'

interface JobCaseInboxProps {
  mode?: 'library' | 'import'
  gmailConnected?: boolean
  gmailSetupRequired?: boolean
  gmailImportNotice: GmailImportNotice | null
  manualCreateRequestId?: number | null
  selectedReviewRequestId?: string | null
  reviews: JobCaseReviewSnapshot[]
  onCreateManual(input: CreateManualJobCaseDraftInput): Promise<CreateManualJobCaseDraftResult>
  onCreateChat?(input: CreateChatPasteJobCaseDraftInput): Promise<CreateChatPasteJobCaseDraftResult>
  onReadWechat?(): Promise<ExecuteWechatVisibleReadResult | null>
  onImportEml(): Promise<ImportEmlJobCaseDraftsResult>
  onImportGmail?(): Promise<void>
  onOpenExternalSettings?(): void
  onOpenLibrary?(reviewId?: string): void
  onLoadHistory(reviewId: string): Promise<JobCaseVersionDetail[]>
  onSetLifecycle(input: SetJobCaseLifecycleInput): Promise<SetJobCaseLifecycleResult>
  onReopen(input: ReopenJobCaseReviewInput): Promise<ReopenJobCaseReviewResult>
  onPreviewDeletion(reviewId: string): Promise<JobCaseDeletionPreview>
  onDelete(input: DeleteJobCaseDataInput): Promise<DeleteJobCaseDataResult>
  onDismissGmailImportNotice(): void
  onManualCreateRequestHandled?(): void
  onSelectedReviewRequestHandled?(): void
  onSubmit(input: SubmitJobCaseReviewInput): Promise<SubmitJobCaseReviewResult>
  wechatVisibleMessage?: WechatVisibleMessageFeasibility
}

export interface GmailImportNotice {
  syncedAt: string
  storedMessages: number
  mode: 'baseline' | 'incremental' | 'bounded-rescan'
  discovered: number
  imported: number
  duplicates: number
  filtered: number
  failed: number
}

function displayDate(value: string, locale: 'ja-JP' | 'zh-CN'): string {
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function warningLabel(code: string): string {
  if (code === 'BUSINESS_DUPLICATE') return '類似案件あり'
  if (code === 'PROMPT_INJECTION_PATTERN') return '不審な指示表現'
  if (code === 'SOURCE_CONTAINS_PII_PLACEHOLDERS') return 'PII置換済み'
  if (code === 'ATTACHMENTS_NOT_DOWNLOADED') return '添付未取得'
  if (code === 'REQUIRED_SKILLS_MISSING') return '必須スキル未抽出'
  if (code === 'DETERMINISTIC_EXTRACTION_REQUIRES_REVIEW') return '人の確認必須'
  if (code === 'MANUAL_SOURCE_LOCAL_REDACTION') return '手動入力・ローカル脱敏'
  if (code === 'EML_SOURCE_LOCAL_PARSE') return 'EML・隔離解析済み'
  if (code === 'EML_SOURCE_LOCAL_REDACTION') return 'EML・ローカル脱敏'
  if (code === 'EML_ATTACHMENTS_IGNORED') return '添付は未保存'
  if (code === 'EML_HTML_CONVERTED_TO_TEXT') return 'HTMLを純文本化'
  if (code === 'EML_BODY_TRUNCATED_OR_QUOTED_HISTORY_REMOVED') return '引用履歴を除外'
  if (code === 'EML_DATE_MISSING_OR_INVALID') return '日時を取込時刻で補完'
  if (code === 'CHAT_PASTE_ONE_TIME_LOCAL_REDACTION') return '貼付原文は保存せずローカル脱敏'
  if (code === 'WECHAT_VISIBLE_ONE_TIME_LOCAL_REDACTION') return '微信可視範囲・一回限りのローカル脱敏'
  if (code === 'WECHAT_CAPTURE_ACCESSIBILITY_TREE') return 'macOS Accessibility で取得'
  if (code === 'WECHAT_CAPTURE_SCREEN_CAPTURE_KIT_VISION_OCR') return '窓単位Capture + Apple Vision OCR'
  if (code === 'WECHAT_VISIBLE_TEXT_TRUNCATED') return '可視文字上限で打切り'
  if (code === 'WECHAT_RAW_TEXT_NOT_PERSISTED') return '微信原文は未保存'
  if (code === 'WECHAT_RAW_IMAGE_NOT_PERSISTED') return 'Capture画像は未保存'
  if (code === 'UNTRUSTED_SOURCE_CONTENT') return '外部指示として実行しない'
  if (code === 'PROMPT_INJECTION_CONTENT_IGNORED') return '指示表現をデータとして隔離'
  if (code === 'coverage:person_name_review_required') return '姓名の目視確認必須'
  return code
}

function sourceTypeLabel(sourceType: JobCaseReviewSnapshot['sourceType']): string {
  if (sourceType === 'gmail') return 'Gmail'
  if (sourceType === 'eml') return 'EMLファイル'
  if (sourceType === 'chat-paste') return 'チャット貼付'
  if (sourceType === 'wechat-visible') return 'Mac 微信'
  return '手動入力'
}

function sourceOrigin(review: JobCaseReviewSnapshot): string {
  if (review.sourceType === 'gmail') return `Gmail · ${review.fromDomain ?? '送信元非表示'}`
  if (review.sourceType === 'eml') return `EML · ${review.fromDomain ?? '送信元非表示'}`
  if (review.sourceType === 'chat-paste') return 'チャット貼付 · 一回限りのローカル脱敏'
  if (review.sourceType === 'wechat-visible') return 'Mac 微信 · 前面可視範囲の一回読取'
  return '手動入力 · ローカル作成'
}

function emlErrorLabel(code: NonNullable<ImportEmlJobCaseDraftsResult['items'][number]['errorCode']>): string {
  const labels = {
    FILE_NOT_REGULAR: '通常ファイルではありません',
    FILE_TOO_LARGE: '10 MBの上限を超えています',
    INVALID_EXTENSION: '.eml ファイルではありません',
    FILE_CHANGED: '選択後にファイルが変更されました',
    PARSE_FAILED: '安全に解析できませんでした',
    BODY_EMPTY: '利用可能な本文がありません',
    LIMIT_EXCEEDED: 'MIME構造の安全上限を超えています',
    PERSISTENCE_FAILED: '脱敏済み草稿を保存できませんでした'
  } as const
  return labels[code]
}

function JobCaseReviewEditor({
  onManage,
  review,
  onSubmit
}: {
  review: JobCaseReviewSnapshot
  onManage(): void
  onSubmit(input: SubmitJobCaseReviewInput): Promise<SubmitJobCaseReviewResult>
}) {
  const locale = useUiLocale()
  const [values, setValues] = useState<Record<JobCaseFieldKey, string>>(() =>
    Object.fromEntries(review.fields.map((field) => [field.key, field.value ?? ''])) as Record<JobCaseFieldKey, string>
  )
  const [confirmed, setConfirmed] = useState<Set<JobCaseFieldKey>>(() => new Set())
  const [reasons, setReasons] = useState<Partial<Record<JobCaseFieldKey, string>>>({})
  const [privacyReviewed, setPrivacyReviewed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (review.status === 'completed') {
    return (
      <section className="job-case-detail is-completed" aria-label="確認済み案件">
        <header className="job-case-detail-header">
          <div>
            <span className="job-case-status-pill completed"><Icon name="check" size={13} />確認済み</span>
            <h2>{review.fields.find((field) => field.key === 'title')?.value ?? review.redactedSubject}</h2>
            <p>JobCase {review.jobCase?.id.slice(0, 8)} · v{review.jobCase?.version} · {review.reviewerDisplayName}</p>
          </div>
          <div className="job-case-detail-actions">
            <span className="job-case-privacy-pill"><Icon name="shield" size={14} />個人識別子なし</span>
            <button onClick={onManage} type="button">履歴・管理</button>
          </div>
        </header>
        <div className="job-case-confirmed-grid">
          {review.fields.filter((field) => field.value).map((field) => (
            <div key={field.key}>
              <span>{field.label}</span>
              <strong>{field.value}</strong>
              <small>{field.sourceLabels.join(' · ') || 'HR確認値'}</small>
            </div>
          ))}
        </div>
      </section>
    )
  }

  const changedKeys = new Set(
    review.fields.filter((field) => (field.originalValue ?? '') !== values[field.key]).map((field) => field.key)
  )
  const allConfirmed = confirmed.size === review.fields.length
  const reasonsComplete = [...changedKeys].every((key) => (reasons[key]?.trim().length ?? 0) >= 3)
  const canSubmit = allConfirmed && privacyReviewed && reasonsComplete && values.title.trim().length > 0 && !busy

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        reviewId: review.reviewId,
        reviewRevision: review.reviewRevision,
        privacyReviewed: true,
        fields: review.fields.map((field) => ({
          key: field.key,
          value: values[field.key].trim() || null,
          confirmed: true,
          ...(changedKeys.has(field.key) ? { changeReason: reasons[field.key]?.trim() } : {})
        }))
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '案件を確定できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  const confirmHighConfidence = () => {
    setConfirmed((current) => new Set([
      ...current,
      ...review.fields.filter((field) => field.confidence >= 0.85 && field.value).map((field) => field.key)
    ]))
  }

  return (
    <form className="job-case-detail" onSubmit={submit}>
      <header className="job-case-detail-header">
        <div>
            <span className="job-case-status-pill"><Icon name="clock" size={13} />項目確認待ち</span>
          <h2>{review.redactedSubject}</h2>
          <p>{sourceOrigin(review)} · {displayDate(review.messageDate, locale)}</p>
        </div>
        <button className="job-case-confirm-high" onClick={confirmHighConfidence} type="button">高信頼を確認</button>
      </header>

      <div className="job-case-privacy-banner">
        <Icon name="lock" size={17} />
        <div><strong>ローカル脱敏済みソース</strong><p>姓名・電話・個人メール等は占位符化済みです。フィールド値に直接識別子を保存すると主プロセスが拒否します。</p></div>
      </div>

      <details className="job-case-source-preview">
        <summary>脱敏済み{review.sourceType === 'manual' ? '入力' : 'メール'}本文を確認</summary>
        <pre>{review.redactedPreview}</pre>
      </details>

      <div className="job-case-warning-row">
        {review.warningCodes.map((code) => <span key={code}>{warningLabel(code)}</span>)}
      </div>

      <div className="job-case-review-fields">
        {review.fields.map((field) => {
          const changed = changedKeys.has(field.key)
          const isConfirmed = confirmed.has(field.key)
          return (
            <article className={isConfirmed ? 'is-confirmed' : ''} key={field.key}>
              <div className="job-case-field-heading">
                <label htmlFor={`job-case-${field.key}`}>{field.label}</label>
                <span>{field.value ? `信頼度 ${Math.round(field.confidence * 100)}%` : '未抽出'}</span>
              </div>
              <input
                id={`job-case-${field.key}`}
                maxLength={500}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                placeholder="未入力"
                value={values[field.key]}
              />
              <small>{field.sourceLabels.join(' · ') || '根拠なし · 必要なら手入力'}</small>
              {changed ? (
                <input
                  aria-label={`${field.label}の変更理由`}
                  className="job-case-change-reason"
                  maxLength={300}
                  onChange={(event) => setReasons((current) => ({ ...current, [field.key]: event.target.value }))}
                  placeholder="変更理由（必須）"
                  value={reasons[field.key] ?? ''}
                />
              ) : null}
              <label className="job-case-field-confirm">
                <input
                  checked={isConfirmed}
                  onChange={(event) => setConfirmed((current) => {
                    const next = new Set(current)
                    if (event.target.checked) next.add(field.key)
                    else next.delete(field.key)
                    return next
                  })}
                  type="checkbox"
                />
                この値を確認
              </label>
            </article>
          )
        })}
      </div>

      <footer className="job-case-review-footer">
        <label>
          <input checked={privacyReviewed} onChange={(event) => setPrivacyReviewed(event.target.checked)} type="checkbox" />
          脱敏済み原文を確認し、案件項目に直接識別子がないことを確認しました
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div>
          <span>{confirmed.size}/{review.fields.length} 項目確認</span>
          <button disabled={!canSubmit} type="submit">{busy ? '保存中…' : '案件を確定'}</button>
        </div>
      </footer>
    </form>
  )
}

function JobCaseManagement({
  onClose,
  onDelete,
  onDeleted,
  onLoadHistory,
  onPreviewDeletion,
  onReopen,
  onReviewChanged,
  onSetLifecycle,
  review
}: {
  review: JobCaseReviewSnapshot
  onClose(): void
  onLoadHistory(reviewId: string): Promise<JobCaseVersionDetail[]>
  onSetLifecycle(input: SetJobCaseLifecycleInput): Promise<SetJobCaseLifecycleResult>
  onReopen(input: ReopenJobCaseReviewInput): Promise<ReopenJobCaseReviewResult>
  onPreviewDeletion(reviewId: string): Promise<JobCaseDeletionPreview>
  onDelete(input: DeleteJobCaseDataInput): Promise<DeleteJobCaseDataResult>
  onReviewChanged(review: JobCaseReviewSnapshot): void
  onDeleted(result: DeleteJobCaseDataResult): void
}) {
  const locale = useUiLocale()
  const [history, setHistory] = useState<JobCaseVersionDetail[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [action, setAction] = useState<'idle' | 'lifecycle' | 'reopen' | 'preview' | 'delete'>('idle')
  const [actionError, setActionError] = useState<string | null>(null)
  const [deletionPreview, setDeletionPreview] = useState<JobCaseDeletionPreview | null>(null)
  const [deletionConfirmation, setDeletionConfirmation] = useState('')

  useEffect(() => {
    let active = true
    void onLoadHistory(review.reviewId).then(
      (versions) => {
        if (active) setHistory(versions)
      },
      (cause: unknown) => {
        if (active) setHistoryError(cause instanceof Error ? cause.message : '案件履歴を読み込めませんでした。')
      }
    )
    return () => { active = false }
  }, [onLoadHistory, review.reviewId])

  const changeLifecycle = async () => {
    if (reason.trim().length < 3 || action !== 'idle') return
    setAction('lifecycle')
    setActionError(null)
    try {
      const result = await onSetLifecycle({
        reviewId: review.reviewId,
        state: review.lifecycle === 'archived' ? 'active' : 'archived',
        reason: reason.trim()
      })
      setHistory(result.history)
      setReason('')
      onReviewChanged(result.review)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '案件の状態を変更できませんでした。')
    } finally {
      setAction('idle')
    }
  }

  const reopen = async () => {
    if (reason.trim().length < 3 || action !== 'idle' || review.lifecycle === 'archived') return
    setAction('reopen')
    setActionError(null)
    try {
      const result = await onReopen({ reviewId: review.reviewId, reason: reason.trim() })
      onReviewChanged(result.review)
      onClose()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '案件の改訂レビューを開始できませんでした。')
      setAction('idle')
    }
  }

  const previewDeletion = async () => {
    if (action !== 'idle') return
    setAction('preview')
    setActionError(null)
    try {
      setDeletionPreview(await onPreviewDeletion(review.reviewId))
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '削除影響を確認できませんでした。')
    } finally {
      setAction('idle')
    }
  }

  const deleteCase = async () => {
    if (!deletionPreview || deletionConfirmation !== (locale === 'zh-CN' ? '删除' : '削除') || action !== 'idle') return
    setAction('delete')
    setActionError(null)
    try {
      const result = await onDelete({
        reviewId: review.reviewId,
        confirmationHash: deletionPreview.confirmationHash,
        confirmationText: '削除'
      })
      onDeleted(result)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : '案件データを削除できませんでした。')
      setAction('idle')
    }
  }

  return (
    <div className="job-case-management-backdrop">
      <aside aria-label="案件の履歴と管理" aria-modal="true" className="job-case-management" role="dialog">
        <header>
          <div>
            <span className="eyebrow">JOB CASE GOVERNANCE</span>
            <h2>{review.fields.find((field) => field.key === 'title')?.value ?? review.redactedSubject}</h2>
            <p>{sourceTypeLabel(review.sourceType)} · Review {review.reviewId.slice(0, 8)} · 直接識別子なし</p>
          </div>
          <button aria-label="案件管理を閉じる" onClick={onClose} type="button">×</button>
        </header>

        <section className="job-case-management-history">
          <div className="job-case-management-section-title"><h3>バージョン履歴</h3><span>{history?.length ?? '—'}件</span></div>
          {!history && !historyError ? <div className="job-case-management-state"><span className="matching-spinner" />履歴を読み込み中…</div> : null}
          {historyError ? <div className="job-case-management-state is-error"><Icon name="alert" size={16} />{historyError}</div> : null}
          {history?.map((version) => (
            <article key={version.id}>
              <header>
                <div><strong>Version {version.version}</strong><span>Review r{version.reviewRevision}</span></div>
                <span className={`job-case-version-status is-${version.status}`}>{version.status === 'active' ? 'ACTIVE' : version.status === 'archived' ? 'ARCHIVED' : '更新済み'}</span>
              </header>
              <p>{displayDate(version.confirmedAt, locale)} · {version.confirmedBy}</p>
              <div>
                {version.fields.filter((field) => field.value).map((field) => (
                  <span key={field.key}><small>{field.label}</small><strong>{field.value}</strong></span>
                ))}
              </div>
            </article>
          ))}
        </section>

        <section className="job-case-management-actions">
          <div className="job-case-management-section-title"><h3>ライフサイクルと改訂</h3><span>{review.lifecycle === 'archived' ? 'ARCHIVED' : 'ACTIVE'}</span></div>
          <p>{review.lifecycle === 'archived' ? '復元すると案件を再び利用でき、改訂も開始できます。' : '改訂は現在値を引き継ぎ、再度13項目とプライバシー確認を要求します。'}</p>
          <input aria-label="案件管理の理由" maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="状態変更・改訂の理由（必須）" value={reason} />
          <div>
            <button disabled={reason.trim().length < 3 || action !== 'idle'} onClick={() => void changeLifecycle()} type="button">
              {action === 'lifecycle' ? '更新中…' : review.lifecycle === 'archived' ? '案件を復元' : '案件をアーカイブ'}
            </button>
            {review.lifecycle === 'active' ? (
              <button disabled={reason.trim().length < 3 || action !== 'idle'} onClick={() => void reopen()} type="button">{action === 'reopen' ? '準備中…' : '改訂レビューを開始'}</button>
            ) : null}
          </div>
        </section>

        <section className="job-case-management-delete">
          <h3>案件データを永久削除</h3>
          <p>案件の全バージョン、脱敏済みソース、監査記録、PII対応表と直接関連するタスクを削除します。Gmailソースは再同期防止の墓碑だけを残します。</p>
          {!deletionPreview ? (
            <button disabled={action !== 'idle'} onClick={() => void previewDeletion()} type="button">{action === 'preview' ? '影響を確認中…' : '削除前の影響を確認'}</button>
          ) : (
            <div className="job-case-deletion-preview">
              <strong>{deletionPreview.title}</strong>
              <ul>
                <li>JobCase {deletionPreview.counts.caseVersions}バージョン</li>
                <li>監査記録 {deletionPreview.counts.reviewAudits}件</li>
                <li>関連タスク {deletionPreview.counts.taskRecords}件</li>
                <li>提案草稿 {deletionPreview.counts.proposalDrafts}件</li>
                <li>品質評価草稿 {deletionPreview.counts.evaluationDraftCases}件</li>
                <li>PII対応表 {deletionPreview.counts.piiMappings}件</li>
                <li>脱敏済みソース {deletionPreview.counts.sourceRecords}件</li>
                <li>Gmailローカルコピー {deletionPreview.counts.gmailMessages}件</li>
                {deletionPreview.counts.agentReferences ? <li>Agent履歴参照 {deletionPreview.counts.agentReferences.conversations}会話 / {deletionPreview.counts.agentReferences.messages}メッセージ</li> : null}
              </ul>
              <p>続行するには「削除」と入力してください。</p>
              <input aria-label="案件削除確認" onChange={(event) => setDeletionConfirmation(event.target.value)} value={deletionConfirmation} />
              <button disabled={deletionConfirmation !== (locale === 'zh-CN' ? '删除' : '削除') || action !== 'idle'} onClick={() => void deleteCase()} type="button">{action === 'delete' ? '削除中…' : '完全に削除'}</button>
            </div>
          )}
          {actionError ? <p className="job-case-management-error" role="alert">{actionError}</p> : null}
        </section>
      </aside>
    </div>
  )
}

function ManualJobCaseComposer({
  onCancel,
  onCreate
}: {
  onCancel(): void
  onCreate(input: CreateManualJobCaseDraftInput): Promise<CreateManualJobCaseDraftResult>
}) {
  const locale = useUiLocale()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canCreate = subject.trim().length >= 2 && body.trim().length >= 8 && !busy

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canCreate) return
    setBusy(true)
    setError(null)
    try {
      await onCreate({ subject: subject.trim(), body: body.trim() })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '手動案件の草稿を作成できませんでした。')
      setBusy(false)
    }
  }

  return (
    <div className="job-case-composer-backdrop">
      <form aria-labelledby="manual-job-case-title" aria-modal="true" className="job-case-composer" onSubmit={submit} role="dialog">
        <header>
          <div>
            <span className="eyebrow">LOCAL-FIRST INPUT</span>
            <h2 id="manual-job-case-title">案件情報を手動で追加</h2>
            <p>営業メールやチャットの案件情報を貼り付け、レビュー用の草稿を作成します。</p>
          </div>
          <button aria-label="閉じる" disabled={busy} onClick={onCancel} type="button">×</button>
        </header>
        <div className="job-case-composer-privacy">
          <Icon name="shield" size={18} />
          <div><strong>入力はまず端末内で脱敏されます</strong><p>姓名・電話・メール・住所などをローカル検出して占位符に置換。原文は案件DBにもクラウドにも保存しません。</p></div>
        </div>
        <label>
          <span>件名・案件名</span>
          <input autoFocus maxLength={2_000} onChange={(event) => setSubject(event.target.value)} placeholder="例：Java / AWS 決済基盤刷新案件" value={subject} />
        </label>
        <label>
          <span>案件本文</span>
          <textarea maxLength={100_000} onChange={(event) => setBody(event.target.value)} placeholder={'募集ロール：\n必須スキル：\n単価：\n勤務地：\nリモート：\n開始時期：\n就労資格：日本で就労可能'} rows={13} value={body} />
        </label>
        <small>{body.length.toLocaleString(locale)} / 100,000文字 · 添付ファイルはここでは取り込みません</small>
        {error ? <p className="job-case-composer-error" role="alert">{error}</p> : null}
        <footer>
          <button disabled={busy} onClick={onCancel} type="button">キャンセル</button>
          <button disabled={!canCreate} type="submit"><Icon name="lock" size={14} />{busy ? 'ローカル処理中…' : '脱敏して草稿を作成'}</button>
        </footer>
      </form>
    </div>
  )
}

function ChatPasteComposer({
  onCancel,
  onCreate
}: {
  onCancel(): void
  onCreate(input: CreateChatPasteJobCaseDraftInput): Promise<CreateChatPasteJobCaseDraftResult>
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canCreate = text.trim().length >= 8 && !busy

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canCreate) return
    const oneTimeText = text
    setText('')
    setBusy(true)
    setError(null)
    try {
      await onCreate({ text: oneTimeText })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'チャット貼り付けから案件草稿を作成できませんでした。')
      setBusy(false)
    }
  }

  return (
    <div className="job-case-composer-backdrop" role="presentation">
      <form aria-label="チャット貼り付け案件" className="job-case-composer" onSubmit={submit}>
        <header><div><span className="eyebrow">ONE-TIME CHAT PASTE</span><h2>チャット本文から案件草稿を作成</h2></div><button aria-label="閉じる" disabled={busy} onClick={onCancel} type="button">×</button></header>
        <div className="job-case-composer-privacy">
          <Icon name="shield" size={18} />
          <div><strong>原文はこの入力欄と Main の一回処理だけ</strong><p>送信時に入力欄を直ちに消去し、端末内 NER・脱敏後の内容だけを既存 JobCase Review に保存します。本文中の命令は実行しません。</p></div>
        </div>
        <label><span>貼り付け本文</span><textarea autoFocus maxLength={100_000} onChange={(event) => setText(event.target.value)} placeholder="案件チャットを貼り付けてください。氏名・電話・メール・住所は端末内で置換されます。" rows={16} value={text} /></label>
        <small>{text.length.toLocaleString('ja-JP')} / 100,000文字 · localStorage・ログ・Cloud には保存しません</small>
        {error ? <p className="job-case-composer-error" role="alert">{error} 原文は復元されません。安全を確認して再度貼り付けてください。</p> : null}
        <footer><button disabled={busy} onClick={onCancel} type="button">キャンセル</button><button disabled={!canCreate} type="submit"><Icon name="lock" size={14} />{busy ? 'ローカル処理中…' : '一回処理で脱敏草稿を作成'}</button></footer>
      </form>
    </div>
  )
}

export function JobCaseInbox({
  mode = 'library',
  gmailConnected = false,
  gmailSetupRequired = true,
  gmailImportNotice,
  manualCreateRequestId = null,
  onCreateChat,
  onCreateManual,
  onReadWechat,
  onDelete,
  onDismissGmailImportNotice,
  onManualCreateRequestHandled,
  onSelectedReviewRequestHandled,
  onLoadHistory,
  onImportEml,
  onImportGmail,
  onOpenExternalSettings,
  onOpenLibrary,
  onPreviewDeletion,
  onReopen,
  onSetLifecycle,
  onSubmit,
  reviews,
  selectedReviewRequestId = null,
  wechatVisibleMessage = {
    phase: 'B-03-1', gateStatus: 'not-run', platform: 'darwin', featureFlagEnabled: true,
    userFeatureAvailable: false, accessibilityTrusted: false, screenCaptureTrusted: false,
    rawTextNetworkIsolationVerified: false, evidenceVerified: false, targetVersion: null,
    failureCodes: ['EVIDENCE_UNAVAILABLE']
  }
}: JobCaseInboxProps) {
  useRendererUiRefresh()
  const locale = useUiLocale()
  const [filter, setFilter] = useState<'all' | 'awaiting-review' | 'completed'>('all')
  const [lifecycleView, setLifecycleView] = useState<'active' | 'archived'>('active')
  const [manualOpen, setManualOpen] = useState(false)
  const [chatPasteOpen, setChatPasteOpen] = useState(false)
  const [emlImporting, setEmlImporting] = useState(false)
  const [emlResult, setEmlResult] = useState<ImportEmlJobCaseDraftsResult | null>(null)
  const [emlError, setEmlError] = useState<string | null>(null)
  const [gmailImporting, setGmailImporting] = useState(false)
  const [gmailError, setGmailError] = useState<string | null>(null)
  const [wechatReading, setWechatReading] = useState(false)
  const [wechatError, setWechatError] = useState<string | null>(null)
  const [wechatEvidence, setWechatEvidence] = useState<ExecuteWechatVisibleReadResult['evidence'] | null>(null)
  const [managingReviewId, setManagingReviewId] = useState<string | null>(null)
  const [deletionReport, setDeletionReport] = useState<DeleteJobCaseDataResult['report'] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    reviews.find((review) => review.lifecycle === 'active' && review.status === 'awaiting-review')?.reviewId
      ?? reviews.find((review) => review.lifecycle === 'active')?.reviewId
      ?? null
  )
  const lifecycleReviews = reviews.filter((review) => review.lifecycle === lifecycleView)
  const filtered = filter === 'all' ? lifecycleReviews : lifecycleReviews.filter((review) => review.status === filter)
  const selected = filtered.find((review) => review.reviewId === selectedId) ?? filtered[0] ?? null
  const managingReview = reviews.find((review) => review.reviewId === managingReviewId) ?? null
  const awaitingCount = reviews.filter((review) => review.lifecycle === 'active' && review.status === 'awaiting-review').length
  const completedCount = reviews.filter((review) => review.lifecycle === 'active' && review.status === 'completed').length
  const archivedCount = reviews.filter((review) => review.lifecycle === 'archived').length
  const pendingBySource = (sourceType: JobCaseReviewSnapshot['sourceType']) => reviews.filter((review) =>
    review.sourceType === sourceType && review.lifecycle === 'active' && review.status === 'awaiting-review'
  ).length
  useEffect(() => {
    if (manualCreateRequestId === null) return
    onManualCreateRequestHandled?.()
    setManualOpen(true)
  }, [manualCreateRequestId])

  useEffect(() => {
    if (selectedReviewRequestId === null) return
    const requested = reviews.find((review) => review.reviewId === selectedReviewRequestId && review.lifecycle === 'active')
    onSelectedReviewRequestHandled?.()
    if (!requested) return
    setLifecycleView('active')
    setFilter('all')
    setSelectedId(requested.reviewId)
  }, [reviews, selectedReviewRequestId])

  useEffect(() => {
    if (!gmailImportNotice) return
    const nextReview = reviews.find((review) =>
      review.sourceType === 'gmail' && review.lifecycle === 'active' && review.status === 'awaiting-review'
    )
    if (nextReview) setSelectedId(nextReview.reviewId)
    setLifecycleView('active')
    setFilter('all')
  }, [gmailImportNotice, reviews])

  const importEml = async () => {
    if (emlImporting) return
    setEmlImporting(true)
    setEmlError(null)
    try {
      const result = await onImportEml()
      if (!result.cancelled) {
        setEmlResult(result)
        const nextReview = result.items.find((item) => item.status === 'imported' && item.review)?.review
          ?? result.items.find((item) => item.status === 'duplicate' && item.review)?.review
        if (nextReview) {
          setSelectedId(nextReview.reviewId)
          setLifecycleView('active')
          setFilter('all')
          onOpenLibrary?.(nextReview.reviewId)
        }
      }
    } catch (cause) {
      setEmlError(cause instanceof Error ? cause.message : 'EML ファイルを取り込めませんでした。')
    } finally {
      setEmlImporting(false)
    }
  }

  const importGmail = async () => {
    if (gmailSetupRequired || !gmailConnected) {
      onOpenExternalSettings?.()
      return
    }
    if (!onImportGmail || gmailImporting) return
    setGmailImporting(true)
    setGmailError(null)
    try {
      await onImportGmail()
    } catch (cause) {
      setGmailError(cause instanceof Error ? cause.message : 'Gmail から案件を取り込めませんでした。')
    } finally {
      setGmailImporting(false)
    }
  }

  const readWechat = async () => {
    if (!onReadWechat || wechatReading) return
    setWechatReading(true)
    setWechatError(null)
    try {
      const result = await onReadWechat()
      if (!result) return
      setWechatEvidence(result.evidence)
      setSelectedId(result.review.reviewId)
      setLifecycleView('active')
      setFilter('all')
      if (mode === 'import') onOpenLibrary?.(result.review.reviewId)
    } catch (cause) {
      setWechatError(cause instanceof Error ? cause.message : '微信の可視メッセージを読み取れませんでした。')
    } finally {
      setWechatReading(false)
    }
  }

  return (
    <main className="job-case-inbox">
      <header className="job-case-page-header">
        <div>
          <span className="eyebrow">{mode === 'import' ? 'CASE IMPORT' : 'CASE DATABASE'}</span>
          <h1>{mode === 'import' ? '案件をインポート' : '案件データベース'}</h1>
          <p>{mode === 'import'
            ? 'Google Workspace、EML、手動入力から案件情報を取り込み、固定フォーマットへ標準化します。'
            : '取り込んだ案件候補を確認し、正式案件として検索・管理できる状態にします。'}</p>
        </div>
        <div className="job-case-page-actions">
          {mode === 'library' ? <div className="job-case-source-actions">
            <button disabled={emlImporting} onClick={() => void importEml()} type="button"><Icon name="mail" size={14} />{emlImporting ? 'ローカル解析中…' : 'EMLを取り込む'}</button>
            <button onClick={() => setManualOpen(true)} type="button"><Icon name="plus" size={14} />案件を手動追加</button>
          </div> : null}
          <div className="job-case-page-stats">
            <div><strong>{awaitingCount}</strong><span>確認待ち</span></div>
            <div><strong>{completedCount}</strong><span>確認済み</span></div>
            <div><strong>{archivedCount}</strong><span>アーカイブ</span></div>
          </div>
        </div>
      </header>

      {gmailImportNotice ? (
        <section
          aria-label="Gmail同期結果"
          className={`job-case-import-notice${gmailImportNotice.failed > 0 ? ' is-warning' : ''}`}
        >
          <Icon name={gmailImportNotice.failed > 0 ? 'alert' : 'check'} size={16} />
          <div>
            <strong>Gmail同期：{gmailImportNotice.imported}件取込 · {gmailImportNotice.duplicates}件重複 · {gmailImportNotice.filtered}件範囲外 · {gmailImportNotice.failed}件失敗</strong>
            <p>{gmailImportNotice.mode} · 保存 {gmailImportNotice.storedMessages}件。本文は端末内で脱敏し、Cloud LLMには送信していません。</p>
          </div>
          <button aria-label="Gmail同期結果を閉じる" onClick={onDismissGmailImportNotice} type="button">×</button>
        </section>
      ) : null}

      {emlError ? <div className="job-case-import-notice is-error" role="alert"><Icon name="alert" size={16} /><span>{emlError}</span><button aria-label="EML取込エラーを閉じる" onClick={() => setEmlError(null)} type="button">×</button></div> : null}
      {gmailError ? <div className="job-case-import-notice is-error" role="alert"><Icon name="alert" size={16} /><span>{gmailError}</span><button aria-label="Gmail取込エラーを閉じる" onClick={() => setGmailError(null)} type="button">×</button></div> : null}
      {wechatError ? <div className="job-case-import-notice is-error" role="alert"><Icon name="alert" size={16} /><span>{wechatError}</span><button aria-label="微信読取エラーを閉じる" onClick={() => setWechatError(null)} type="button">×</button></div> : null}
      {emlResult ? (
        <section aria-label="EML取込結果" className={`job-case-import-notice${emlResult.failedCount > 0 ? ' is-warning' : ''}`}>
          <Icon name={emlResult.failedCount > 0 ? 'alert' : 'check'} size={16} />
          <div>
            <strong>EML取込：{emlResult.importedCount}件登録 · {emlResult.duplicateCount}件重複 · {emlResult.skippedCount}件対象外 · {emlResult.failedCount}件失敗</strong>
            <p>本文だけを隔離・断網環境で解析しました。添付ファイルと元のEMLは保存していません。</p>
            {emlResult.items.some((item) => item.status === 'failed' || item.status === 'skipped') ? (
              <ul>
                {emlResult.items.filter((item) => item.status === 'failed' || item.status === 'skipped').map((item) => (
                  <li key={`${item.fileName}-${item.status}`}>
                    {item.fileName}：{item.status === 'skipped'
                      ? item.classification === 'candidate-proposal' ? '要員・候補者メールのため案件登録対象外' : '案件メールと判定できず対象外'
                      : item.errorCode ? emlErrorLabel(item.errorCode) : '取込失敗'}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <button aria-label="EML取込結果を閉じる" onClick={() => setEmlResult(null)} type="button">×</button>
        </section>
      ) : null}

      {mode === 'import' ? (
        <section className="case-import-workspace" aria-label="案件の取込元">
          <div className="case-import-intro">
            <span><Icon name="shield" size={17} /></span>
            <div><strong>どの経路でも、保存前にローカル脱敏と項目確認を実施</strong><p>姓名、電話、メール、住所などの直接識別子を端末内で置換し、原文を Cloud LLM へ送信しません。</p></div>
          </div>
          <div className="case-import-source-grid">
            <article>
              <span className="case-import-source-icon"><Icon name="mail" size={23} /></span>
              <div><small>GOOGLE WORKSPACE</small><h2>会社 Gmail から取り込む</h2><p>設定済みの Label、期間、キーワード範囲だけを読取専用で同期します。</p></div>
              <dl className="case-import-source-facts"><div><dt>権限</dt><dd>gmail.readonly</dd></div><div><dt>範囲</dt><dd>管理者設定内</dd></div><div><dt>最終同期</dt><dd>{gmailImportNotice ? displayDate(gmailImportNotice.syncedAt, locale) : '未実行'}</dd></div><div><dt>重複 / 失敗</dt><dd>{gmailImportNotice ? `${gmailImportNotice.duplicates} / ${gmailImportNotice.failed}` : '—'}</dd></div><div><dt>確認待ち</dt><dd>{pendingBySource('gmail')}</dd></div><div><dt>Network</dt><dd>同期時のみ</dd></div></dl>
              <div className="case-import-source-status"><span className={gmailConnected ? 'is-ready' : ''} />{gmailConnected ? '読取専用で接続済み' : '接続設定が必要'}</div>
              <button disabled={gmailImporting} onClick={() => void importGmail()} type="button">{gmailSetupRequired || !gmailConnected ? '外部システム設定を開く' : gmailImporting ? '同期中…' : 'Gmail から取り込む'}<Icon name="chevron-right" size={15} /></button>
            </article>
            <article>
              <span className="case-import-source-icon"><Icon name="file" size={23} /></span>
              <div><small>LOCAL FILE</small><h2>EML ファイルを取り込む</h2><p>複数の .eml を隔離・断網環境で解析し、案件メールだけを草稿にします。</p></div>
              <dl className="case-import-source-facts"><div><dt>権限</dt><dd>選択ファイルのみ</dd></div><div><dt>範囲</dt><dd>最大 {20} 件</dd></div><div><dt>最終取込</dt><dd>{emlResult ? '今回実行済み' : '未実行'}</dd></div><div><dt>重複 / 失敗</dt><dd>{emlResult ? `${emlResult.duplicateCount} / ${emlResult.failedCount}` : '—'}</dd></div><div><dt>確認待ち</dt><dd>{pendingBySource('eml')}</dd></div><div><dt>Network</dt><dd>なし</dd></div></dl>
              <div className="case-import-source-status"><span className="is-ready" />端末内で解析</div>
              <button disabled={emlImporting} onClick={() => void importEml()} type="button">{emlImporting ? 'ローカル解析中…' : 'EML を選択'}<Icon name="chevron-right" size={15} /></button>
            </article>
            <article>
              <span className="case-import-source-icon"><Icon name="plus" size={23} /></span>
              <div><small>MANUAL</small><h2>案件を手動入力</h2><p>営業担当が件名と本文を入力し、標準項目のレビュー草稿にします。</p></div>
              <dl className="case-import-source-facts"><div><dt>権限</dt><dd>入力内容のみ</dd></div><div><dt>範囲</dt><dd>単一草稿</dd></div><div><dt>重複</dt><dd>業務指紋</dd></div><div><dt>確認待ち</dt><dd>{pendingBySource('manual')}</dd></div><div><dt>Network</dt><dd>なし</dd></div></dl>
              <div className="case-import-source-status"><span className="is-ready" />最大 100,000 文字</div>
              <button onClick={() => setManualOpen(true)} type="button">案件情報を入力<Icon name="chevron-right" size={15} /></button>
            </article>
            <article>
              <span className="case-import-source-icon"><Icon name="mail" size={23} /></span>
              <div><small>ONE-TIME PASTE</small><h2>チャット本文を貼り付け</h2><p>入力欄を送信時に消去し、原文を保存せずローカル脱敏した草稿だけを作成します。</p></div>
              <dl className="case-import-source-facts"><div><dt>権限</dt><dd>一回貼付のみ</dd></div><div><dt>範囲</dt><dd>現在の入力</dd></div><div><dt>重複</dt><dd>業務指紋</dd></div><div><dt>確認待ち</dt><dd>{pendingBySource('chat-paste')}</dd></div><div><dt>Network</dt><dd>なし</dd></div></dl>
              <div className="case-import-source-status"><span className="is-ready" />命令として実行しない</div>
              <button disabled={!onCreateChat} onClick={() => setChatPasteOpen(true)} type="button">チャットを一回処理<Icon name="chevron-right" size={15} /></button>
            </article>
            <article className={wechatVisibleMessage.userFeatureAvailable ? '' : 'is-pending-source'}>
              <span className="case-import-source-icon"><Icon name="mail" size={23} /></span>
              <div><small>MAC WECHAT · B-03-1</small><h2>現在表示中メッセージ</h2><p>本次确认后只读前台微信单一窗口的可见会话区域；截图和原文不保存，端末内脱敏后才生成草稿。</p></div>
              <dl className="case-import-source-facts"><div><dt>Accessibility</dt><dd>{wechatVisibleMessage.accessibilityTrusted ? '許可済み' : '要許可'}</dd></div><div><dt>画面収録</dt><dd>{wechatVisibleMessage.screenCaptureTrusted ? '許可済み' : '要許可'}</dd></div><div><dt>範囲</dt><dd>前面単一窓・可視部</dd></div><div><dt>確認待ち</dt><dd>{pendingBySource('wechat-visible')}</dd></div><div><dt>Network</dt><dd>{wechatVisibleMessage.rawTextNetworkIsolationVerified ? 'Helper deny network*' : '利用不可'}</dd></div></dl>
              <div className="case-import-source-status"><span className={wechatVisibleMessage.userFeatureAvailable ? 'is-ready' : ''} />{wechatEvidence ? `${wechatEvidence.captureMethod === 'accessibility-tree' ? 'AX' : 'Vision OCR'} · ${wechatEvidence.visibleTextNodeCount}節点` : wechatVisibleMessage.userFeatureAvailable ? `微信 ${wechatVisibleMessage.targetVersion ?? ''} · 本次読取可` : '実行時に権限を確認'}</div>
              <button disabled={!onReadWechat || wechatReading || wechatVisibleMessage.platform !== 'darwin'} onClick={() => void readWechat()} type="button">{wechatReading ? '微信へ切替・読取中…' : wechatVisibleMessage.userFeatureAvailable ? '本次可視メッセージを読取' : '権限を確認して読取'}<Icon name={wechatReading ? 'clock' : 'chevron-right'} size={15} /></button>
            </article>
          </div>
          <div className="case-import-library-link">
            <div><strong>すでに取り込んだ案件を確認</strong><span>確認待ち {awaitingCount} 件 · 確認済み {completedCount} 件 · アーカイブ {archivedCount} 件</span></div>
            <button onClick={() => onOpenLibrary?.()} type="button">案件データベースを開く<Icon name="chevron-right" size={15} /></button>
          </div>
        </section>
      ) : reviews.length === 0 ? (
        <section className="job-case-empty">
          <span><Icon name="briefcase" size={25} /></span>
          <h2>案件候補はまだありません</h2>
          <p>Google Workspace を読取専用で同期するか、EMLを取り込むか、営業担当が案件情報を直接入力してレビューを開始できます。</p>
          <div className="job-case-empty-actions">
            <button className="job-case-empty-action" disabled={emlImporting} onClick={() => void importEml()} type="button"><Icon name="mail" size={14} />最初のEMLを取り込む</button>
            <button className="job-case-empty-action is-secondary" onClick={() => setManualOpen(true)} type="button"><Icon name="plus" size={14} />最初の案件を手動追加</button>
          </div>
          <div><Icon name="shield" size={15} />すべての経路でローカル脱敏後にのみ案件候補になります</div>
        </section>
      ) : (
        <div className="job-case-layout">
          <aside className="job-case-list-panel">
            <div className="job-case-lifecycle-tabs" aria-label="案件の状態">
              <button className={lifecycleView === 'active' ? 'is-active' : ''} onClick={() => {
                setLifecycleView('active')
                setFilter('all')
                setSelectedId(null)
              }} type="button">利用中 {reviews.length - archivedCount}</button>
              <button className={lifecycleView === 'archived' ? 'is-active' : ''} onClick={() => {
                setLifecycleView('archived')
                setFilter('all')
                setSelectedId(null)
              }} type="button">アーカイブ {archivedCount}</button>
            </div>
            <div className="job-case-filter-tabs">
              {([
                ['all', `すべて ${lifecycleReviews.length}`],
                ['awaiting-review', `確認待ち ${lifecycleReviews.filter((review) => review.status === 'awaiting-review').length}`],
                ['completed', `確認済み ${lifecycleReviews.filter((review) => review.status === 'completed').length}`]
              ] as const).map(([id, label]) => (
                <button className={filter === id ? 'is-active' : ''} key={id} onClick={() => setFilter(id)} type="button">{label}</button>
              ))}
            </div>
            <div className="job-case-list">
              {filtered.map((review) => {
                const title = review.fields.find((field) => field.key === 'title')?.value ?? review.redactedSubject
                const skills = review.fields.find((field) => field.key === 'required_skills')?.value
                return (
                  <button
                    aria-current={selected?.reviewId === review.reviewId ? 'true' : undefined}
                    className={selected?.reviewId === review.reviewId ? 'is-selected' : ''}
                    key={review.reviewId}
                    onClick={() => setSelectedId(review.reviewId)}
                    type="button"
                  >
                    <div><span className={`job-case-list-status ${review.status}`} /> <small>{review.status === 'completed' ? '確認済み' : '確認待ち'}</small><time>{displayDate(review.messageDate, locale)}</time></div>
                    <strong>{title}</strong>
                    <p>{skills ?? '必須スキル未抽出'}</p>
                    <footer><span>{review.sourceType === 'manual' ? '営業入力' : review.fromDomain ?? '送信元非表示'}</span><span>{review.warningCodes.includes('BUSINESS_DUPLICATE') ? '類似あり' : sourceTypeLabel(review.sourceType)}</span></footer>
                  </button>
                )
              })}
              {filtered.length === 0 ? <p className="job-case-filter-empty">この状態の案件はありません。</p> : null}
            </div>
          </aside>
          <section className="job-case-editor-panel">
            {selected ? (
              <JobCaseReviewEditor
                key={`${selected.reviewId}-${selected.reviewRevision}-${selected.status}`}
                onManage={() => setManagingReviewId(selected.reviewId)}
                onSubmit={onSubmit}
                review={selected}
              />
            ) : <div className="job-case-editor-empty">この状態の案件はありません。</div>}
          </section>
        </div>
      )}
      {manualOpen ? (
        <ManualJobCaseComposer
          onCancel={() => setManualOpen(false)}
          onCreate={async (input) => {
            const result = await onCreateManual(input)
            setSelectedId(result.review.reviewId)
            setLifecycleView('active')
            setFilter('all')
            setManualOpen(false)
            if (mode === 'import') onOpenLibrary?.(result.review.reviewId)
            return result
          }}
        />
      ) : null}
      {chatPasteOpen && onCreateChat ? (
        <ChatPasteComposer
          onCancel={() => setChatPasteOpen(false)}
          onCreate={async (input) => {
            const result = await onCreateChat(input)
            setSelectedId(result.review.reviewId)
            setLifecycleView('active')
            setFilter('all')
            setChatPasteOpen(false)
            if (mode === 'import') onOpenLibrary?.(result.review.reviewId)
            return result
          }}
        />
      ) : null}
      {managingReview ? (
        <JobCaseManagement
          onClose={() => setManagingReviewId(null)}
          onDelete={onDelete}
          onDeleted={(result) => {
            setDeletionReport(result.report)
            setManagingReviewId(null)
            setSelectedId(null)
          }}
          onLoadHistory={onLoadHistory}
          onPreviewDeletion={onPreviewDeletion}
          onReopen={onReopen}
          onReviewChanged={(review) => setSelectedId(review.reviewId)}
          onSetLifecycle={onSetLifecycle}
          review={managingReview}
        />
      ) : null}
      {deletionReport ? (
        <section className="job-case-deletion-report" aria-label="案件削除レポート">
          <div><Icon name={deletionReport.outcome === 'completed' ? 'check' : 'alert'} size={18} /><strong>案件削除レポート</strong></div>
          <p>案件のローカルデータを削除しました。</p>
          {deletionReport.components.backups === 'expired_pending' ? (
            <p>以前の復元パッケージには削除前データが残る可能性があります。新しいバックアップを作成し、旧パッケージを安全に廃棄してください。</p>
          ) : null}
          <span>Report {deletionReport.id.slice(0, 8)} · DB {deletionReport.components.database}{deletionReport.warningCodes.includes('GMAIL_SOURCE_TOMBSTONED_TO_PREVENT_REIMPORT') ? ' · Gmail再取込防止済み' : ''}</span>
          <button aria-label="案件削除レポートを閉じる" onClick={() => setDeletionReport(null)} type="button">×</button>
        </section>
      ) : null}
    </main>
  )
}
