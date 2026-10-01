import { BusinessField } from './BusinessField'
import { useEffect, useState, type FormEvent } from 'react'
import type {
  SaveJobCaseFieldAliasesInput,
  JobCaseFieldAliases,
  CreateChatPasteJobCaseDraftInput,
  CreateChatPasteJobCaseDraftResult,
  CreateManualJobCaseDraftInput,
  CreateManualJobCaseDraftResult,
  DeleteJobCaseDataInput,
  DeleteJobCaseDataResult,
  JobCaseFieldKey,
  JobCaseDeletionPreview,
  JobCaseReviewSnapshot,
  JobCaseSourceText,
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
import { isInactiveProgressStage, jobCaseFieldCanonicalLabels, normalizeJobCaseFieldLabel } from '@shared'
import { Icon } from './Icon'
import { JobCaseSourceTextSection } from './JobCaseSourceTextSection'
import { localizedIpcError, useLocaleText, localizedCaseFieldLabel, localizedMainText, localizedJobCaseFieldLabel } from '../i18n'
import { DeletionBusinessCountItems, DeletionPlacementBlock, deletionBlockedByPlacement } from './deletion-impact'

type LocaleText = (cn: string, ja: string) => string

interface JobCaseInboxProps {
  gmailConnected?: boolean
  gmailSetupRequired?: boolean
  gmailImportNotice: GmailImportNotice | null
  manualCreateRequestId?: number | null
  reviews: JobCaseReviewSnapshot[]
  onCreateManual(input: CreateManualJobCaseDraftInput): Promise<CreateManualJobCaseDraftResult>
  onCreateChat?(input: CreateChatPasteJobCaseDraftInput): Promise<CreateChatPasteJobCaseDraftResult>
  onReadWechat?(): Promise<ExecuteWechatVisibleReadResult | null>
  onImportEml(): Promise<ImportEmlJobCaseDraftsResult>
  onImportGmail?(): Promise<void>
  onOpenExternalSettings?(): void
  /** Opens the HR case list, with the just-imported case selected when there is one. */
  onOpenLibrary?(reviewId?: string): void
  onPreviewDeletion(reviewId: string): Promise<JobCaseDeletionPreview>
  onDelete(input: DeleteJobCaseDataInput): Promise<DeleteJobCaseDataResult>
  onDismissGmailImportNotice(): void
  onManualCreateRequestHandled?(): void
  wechatVisibleMessage?: WechatVisibleMessageFeasibility
}

export interface AliasSuggestion {
  key: JobCaseFieldKey
  label: string
}

const aliasCandidateLinePattern = /^[\s　■●▼▲★◆◇□○◎・*【[（(]*([^:：\n]{1,24}?)[\s　】\]）)]*[:：]\s*(.+?)\s*$/u

function comparableValue(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

/**
 * Learns aliases from what the operator just did: when a confirmed value was
 * typed in by hand and the redacted source carries that exact value under a
 * label the extractor did not recognise, that label is a candidate alias for
 * the field. Nothing is saved without the operator accepting it.
 */
function aliasSuggestionsFrom(
  review: JobCaseReviewSnapshot,
  values: Record<JobCaseFieldKey, string>,
  changedKeys: ReadonlySet<JobCaseFieldKey>,
  aliases: JobCaseFieldAliases | undefined
): AliasSuggestion[] {
  const lines = review.redactedPreview.split(/\r?\n/u)
  const knownLabels = new Set(Object.values(jobCaseFieldCanonicalLabels).map(normalizeJobCaseFieldLabel))
  const suggestions: AliasSuggestion[] = []
  for (const key of changedKeys) {
    const typed = comparableValue(values[key] ?? '')
    if (!typed) continue
    for (const line of lines) {
      const match = aliasCandidateLinePattern.exec(line)
      if (!match || comparableValue(match[2]!) !== typed) continue
      const label = match[1]!.trim()
      const normalized = normalizeJobCaseFieldLabel(label)
      if (!normalized || knownLabels.has(normalized)) continue
      if ((aliases?.aliases[key] ?? []).some((alias) => normalizeJobCaseFieldLabel(alias) === normalized)) continue
      if (!suggestions.some((item) => item.key === key && normalizeJobCaseFieldLabel(item.label) === normalized)) {
        suggestions.push({ key, label })
      }
      break
    }
  }
  return suggestions
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

function warningLabel(code: string, t: LocaleText): string {
  if (code === 'BUSINESS_DUPLICATE') return t('存在相似案件', '類似案件あり')
  if (code === 'PROMPT_INJECTION_PATTERN') return t('存在可疑指令表述', '不審な指示表現')
  if (code === 'SOURCE_CONTAINS_PII_PLACEHOLDERS') return t('个人信息已替换', '個人情報を置換済み')
  if (code === 'ATTACHMENTS_NOT_DOWNLOADED') return t('未获取附件', '添付未取得')
  if (code === 'REQUIRED_SKILLS_MISSING') return t('未提取必备技能', '必須スキル未抽出')
  if (code === 'AGE_LIMIT_REQUIRES_REVIEW') return t('年龄条件需确认', '年齢条件は要確認')
  if (code === 'DETERMINISTIC_EXTRACTION_REQUIRES_REVIEW') return t('必须人工确认', '人の確認必須')
  if (code === 'MANUAL_SOURCE_LOCAL_REDACTION') return t('手工输入 · 本地脱敏', '手動入力・ローカル脱敏')
  if (code === 'EML_SOURCE_LOCAL_PARSE') return t('EML · 已隔离解析', 'EML・隔離解析済み')
  if (code === 'EML_SOURCE_LOCAL_REDACTION') return t('EML · 本地脱敏', 'EML・ローカル脱敏')
  if (code === 'EML_ATTACHMENTS_IGNORED') return t('未保存附件', '添付は未保存')
  if (code === 'EML_HTML_CONVERTED_TO_TEXT') return t('HTML 已转为纯文本', 'HTMLをテキストに変換')
  if (code === 'EML_BODY_TRUNCATED_OR_QUOTED_HISTORY_REMOVED') return t('已排除引用历史', '引用履歴を除外')
  if (code === 'EML_DATE_MISSING_OR_INVALID') return t('已用导入时间补全日期', '日時を取込時刻で補完')
  if (code === 'CHAT_PASTE_ONE_TIME_LOCAL_REDACTION') return t('不保存粘贴原文，仅在本机脱敏', '貼付原文は保存せずローカル脱敏')
  if (code === 'WECHAT_VISIBLE_ONE_TIME_LOCAL_REDACTION')
    return t('单次读取微信可见内容 · 本机脱敏', '微信の表示範囲を1回だけ読取・端末内で脱敏')
  if (code === 'WECHAT_CAPTURE_ACCESSIBILITY_TREE') return t('通过 macOS 辅助功能读取', 'macOS のアクセシビリティ機能で取得')
  if (code === 'WECHAT_CAPTURE_SCREEN_CAPTURE_KIT_VISION_OCR') return t('从窗口截图识别文字', 'ウィンドウ画像から文字認識')
  if (code === 'WECHAT_VISIBLE_TEXT_TRUNCATED') return t('达到可见文字上限后停止', '可視文字上限で打切り')
  if (code === 'WECHAT_RAW_TEXT_NOT_PERSISTED') return t('未保存微信原文', '微信原文は未保存')
  if (code === 'WECHAT_RAW_IMAGE_NOT_PERSISTED') return t('截图未保存', 'キャプチャ画像は未保存')
  if (code === 'UNTRUSTED_SOURCE_CONTENT') return t('不作为外部指令执行', '外部指示として実行しない')
  if (code === 'PROMPT_INJECTION_CONTENT_IGNORED') return t('将指令式内容作为数据隔离', '指示表現をデータとして隔離')
  if (code === 'coverage:person_name_review_required') return t('必须人工核对姓名', '姓名の目視確認必須')
  return code
}

function gmailSyncModeLabel(mode: GmailImportNotice['mode'], t: LocaleText): string {
  if (mode === 'baseline') return t('首次同步', '初回同期')
  if (mode === 'incremental') return t('增量同步', '差分同期')
  return t('按限定时间范围重新检查', '期間を限定して再確認')
}

/** Where a case came from, in HR's words instead of the stored source enum. */
export function jobCaseSourceTypeLabel(sourceType: JobCaseReviewSnapshot['sourceType'], t: LocaleText): string {
  if (sourceType === 'gmail') return 'Gmail'
  if (sourceType === 'eml') return t('EML 文件', 'EMLファイル')
  if (sourceType === 'chat-paste') return t('聊天粘贴', 'チャット貼付')
  if (sourceType === 'wechat-visible') return 'Mac 微信'
  return t('手动输入', '手動入力')
}
const sourceTypeLabel = jobCaseSourceTypeLabel

function sourceOrigin(review: JobCaseReviewSnapshot, t: LocaleText): string {
  if (review.sourceType === 'gmail') return `Gmail · ${review.fromDomain ?? t('发件人已隐藏', '送信元非表示')}`
  if (review.sourceType === 'eml') return `EML · ${review.fromDomain ?? t('发件人已隐藏', '送信元非表示')}`
  if (review.sourceType === 'chat-paste') return t('聊天粘贴 · 不保存原文，本机脱敏', 'チャット貼付 · 原文を保存せず端末内で脱敏')
  if (review.sourceType === 'wechat-visible') return t('Mac 微信 · 单次读取当前可见内容', 'Mac 微信 · 表示中の画面を1回読取')
  return t('手工输入 · 本地创建', '手動入力 · ローカル作成')
}

function emlErrorLabel(code: NonNullable<ImportEmlJobCaseDraftsResult['items'][number]['errorCode']>, t: LocaleText): string {
  const labels = {
    FILE_NOT_REGULAR: t('不是普通文件', '通常ファイルではありません'),
    FILE_TOO_LARGE: t('超过 10 MB 上限', '10 MBの上限を超えています'),
    INVALID_EXTENSION: t('不是 .eml 文件', '.eml ファイルではありません'),
    FILE_CHANGED: t('文件在选择后发生了变化', '選択後にファイルが変更されました'),
    PARSE_FAILED: t('无法安全解析', '安全に解析できませんでした'),
    BODY_EMPTY: t('没有可用正文', '利用可能な本文がありません'),
    LIMIT_EXCEEDED: t('邮件结构过于复杂，无法解析', 'メールの構造が複雑すぎるため解析できません'),
    PERSISTENCE_FAILED: t('无法保存已脱敏草稿', '脱敏済み草稿を保存できませんでした')
  }
  return labels[code]
}

export function JobCaseReviewEditor({
  onManage,
  review,
  onSubmit,
  fieldAliases,
  onAliasSuggestions,
  onLoadSourceText
}: {
  review: JobCaseReviewSnapshot
  onManage(): void
  onSubmit(input: SubmitJobCaseReviewInput): Promise<SubmitJobCaseReviewResult>
  fieldAliases?: JobCaseFieldAliases
  onAliasSuggestions?(suggestions: AliasSuggestion[]): void
  onLoadSourceText?(reviewId: string): Promise<JobCaseSourceText>
}) {
  const { locale, t } = useLocaleText()
  const [values, setValues] = useState<Record<JobCaseFieldKey, string>>(
    () => Object.fromEntries(review.fields.map((field) => [field.key, field.value ?? ''])) as Record<JobCaseFieldKey, string>
  )
  const [confirmed, setConfirmed] = useState<Set<JobCaseFieldKey>>(() => new Set())
  const [reasons, setReasons] = useState<Partial<Record<JobCaseFieldKey, string>>>({})
  const [privacyReviewed, setPrivacyReviewed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (review.status === 'completed') {
    return (
      <section className="job-case-detail is-completed" aria-label={t('已确认案件', '確認済み案件')}>
        <header className="job-case-detail-header">
          <div>
            <span className="job-case-status-pill completed">
              <Icon name="check" size={13} />
              {t('已确认', '確認済み')}
            </span>
            <h2>{review.fields.find((field) => field.key === 'title')?.value ?? review.redactedSubject}</h2>
            <p>
              JobCase {review.jobCase?.id.slice(0, 8)} · v{review.jobCase?.version} · {review.reviewerDisplayName}
            </p>
          </div>
          <div className="job-case-detail-actions">
            <span className="job-case-privacy-pill">
              <Icon name="shield" size={14} />
              {t('不含个人标识符', '個人識別子なし')}
            </span>
            <button onClick={onManage} type="button">
              {t('历史与管理', '履歴・管理')}
            </button>
          </div>
        </header>
        <div className="job-case-confirmed-grid">
          {review.fields
            .filter((field) => field.value)
            .map((field) => (
              <div key={field.key}>
                <span>{localizedCaseFieldLabel(locale, field)}</span>
                <strong>
                  <BusinessField
                    kind="case"
                    id={review.reviewId}
                    version={review.reviewRevision}
                    field={field.key}
                    value={field.value}
                    label={localizedCaseFieldLabel(locale, field)}
                    disabled={review.lifecycle !== 'active'}
                  />
                </strong>
                <small>{field.sourceLabels.join(' · ') || t('HR 确认值', 'HR確認値')}</small>
              </div>
            ))}
        </div>
        {onLoadSourceText ? <JobCaseSourceTextSection onLoad={onLoadSourceText} review={review} /> : null}
      </section>
    )
  }

  const changedKeys = new Set(review.fields.filter((field) => (field.originalValue ?? '') !== values[field.key]).map((field) => field.key))
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
      const suggestions = aliasSuggestionsFrom(review, values, changedKeys, fieldAliases)
      if (suggestions.length > 0) onAliasSuggestions?.(suggestions)
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法确认案件。', '案件を確定できませんでした。')))
    } finally {
      setBusy(false)
    }
  }

  const confirmHighConfidence = () => {
    setConfirmed(
      (current) =>
        new Set([...current, ...review.fields.filter((field) => field.confidence >= 0.85 && field.value).map((field) => field.key)])
    )
  }

  return (
    <form className="job-case-detail" onSubmit={submit}>
      <header className="job-case-detail-header">
        <div>
          <span className="job-case-status-pill">
            <Icon name="clock" size={13} />
            {t('等待字段确认', '項目確認待ち')}
          </span>
          <h2>{review.redactedSubject}</h2>
          <p>
            {sourceOrigin(review, t)} · {displayDate(review.messageDate, locale)}
          </p>
        </div>
        <div className="job-case-detail-actions">
          <button className="job-case-confirm-high" onClick={confirmHighConfidence} type="button">
            {t('确认高置信度项', '高信頼を確認')}
          </button>
          <button onClick={onManage} type="button">
            {t('历史与管理', '履歴・管理')}
          </button>
        </div>
      </header>

      <div className="job-case-privacy-banner">
        <Icon name="lock" size={17} />
        <div>
          <strong>{t('已在本地脱敏的来源', 'ローカル脱敏済みソース')}</strong>
          <p>
            {t(
              '姓名、电话、个人邮箱等已替换为占位符；若字段值包含直接标识符，主进程会拒绝保存。',
              '姓名・電話・個人メール等は占位符化済みです。フィールド値に直接識別子を保存すると主プロセスが拒否します。'
            )}
          </p>
        </div>
      </div>

      <details className="job-case-source-preview">
        <summary>
          {review.sourceType === 'manual'
            ? t('确认脱敏后的输入正文', '脱敏済み入力本文を確認')
            : t('确认脱敏后的邮件正文', '脱敏済みメール本文を確認')}
        </summary>
        <pre>{review.redactedPreview}</pre>
      </details>

      <div className="job-case-warning-row">
        {review.warningCodes.map((code) => (
          <span key={code}>{warningLabel(code, t)}</span>
        ))}
      </div>

      <div className="job-case-review-fields">
        {review.fields.map((field) => {
          const changed = changedKeys.has(field.key)
          const isConfirmed = confirmed.has(field.key)
          return (
            <article className={isConfirmed ? 'is-confirmed' : ''} key={field.key}>
              <div className="job-case-field-heading">
                <label htmlFor={`job-case-${field.key}`}>{localizedCaseFieldLabel(locale, field)}</label>
                <span>
                  {field.value
                    ? t(`置信度 ${Math.round(field.confidence * 100)}%`, `信頼度 ${Math.round(field.confidence * 100)}%`)
                    : t('未提取', '未抽出')}
                </span>
              </div>
              <input
                id={`job-case-${field.key}`}
                maxLength={500}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                placeholder={t('未填写', '未入力')}
                value={values[field.key]}
              />
              <small>{field.sourceLabels.join(' · ') || t('无依据 · 必要时手工输入', '根拠なし · 必要なら手入力')}</small>
              {changed ? (
                <input
                  aria-label={t(`${localizedCaseFieldLabel(locale, field)}的修改原因`, `${field.label}の変更理由`)}
                  className="job-case-change-reason"
                  maxLength={300}
                  onChange={(event) => setReasons((current) => ({ ...current, [field.key]: event.target.value }))}
                  placeholder={t('修改原因（必填）', '変更理由（必須）')}
                  value={reasons[field.key] ?? ''}
                />
              ) : null}
              <label className="job-case-field-confirm">
                <input
                  checked={isConfirmed}
                  onChange={(event) =>
                    setConfirmed((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(field.key)
                      else next.delete(field.key)
                      return next
                    })
                  }
                  type="checkbox"
                />
                {t('确认此值', 'この値を確認')}
              </label>
            </article>
          )
        })}
      </div>

      <footer className="job-case-review-footer">
        <label>
          <input checked={privacyReviewed} onChange={(event) => setPrivacyReviewed(event.target.checked)} type="checkbox" />
          {t('已检查脱敏后的原文，并确认案件字段中不含直接标识符', '脱敏済み原文を確認し、案件項目に直接識別子がないことを確認しました')}
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div>
          <span>
            {confirmed.size}/{review.fields.length} {t('字段确认', '項目確認')}
          </span>
          <button disabled={!canSubmit} type="submit">
            {busy ? t('保存中…', '保存中…') : t('确认案件', '案件を確定')}
          </button>
        </div>
      </footer>
    </form>
  )
}

export function JobCaseManagement({
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
  const { locale, t } = useLocaleText()
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
        if (active) setHistoryError(localizedIpcError(locale, cause, t('无法读取案件历史。', '案件履歴を読み込めませんでした。')))
      }
    )
    return () => {
      active = false
    }
  }, [onLoadHistory, review.reviewId])

  // Ending a case with follow-ups still being arranged asks first, as 结束案件 in the case list does.
  const [openFollowUps, setOpenFollowUps] = useState<number | null>(null)
  const changeLifecycle = async (closeOpenFollowUps?: boolean) => {
    if (reason.trim().length < 3 || action !== 'idle') return
    const ending = review.lifecycle !== 'archived'
    if (ending && closeOpenFollowUps === undefined) {
      setAction('lifecycle')
      setActionError(null)
      try {
        const rows = (await window.sesAgent?.listBusinessFollowUps?.()) ?? []
        const open = rows.filter(
          (row) =>
            row.reviewId === review.reviewId &&
            row.progress &&
            !isInactiveProgressStage(row.progress.stage) &&
            row.progress.stage !== 'entry'
        ).length
        if (open) {
          setOpenFollowUps(open)
          setAction('idle')
          return
        }
      } catch (cause) {
        setActionError(
          localizedIpcError(locale, cause, t('读取跟进失败，请重试。', '対応記録を読み込めませんでした。もう一度お試しください。'))
        )
        setAction('idle')
        return
      }
      setAction('idle')
    }
    setOpenFollowUps(null)
    setAction('lifecycle')
    setActionError(null)
    try {
      const result = await onSetLifecycle({
        reviewId: review.reviewId,
        state: ending ? 'archived' : 'active',
        reason: reason.trim(),
        ...(ending && closeOpenFollowUps ? { closeOpenFollowUps: true } : {})
      })
      setHistory(result.history)
      setReason('')
      onReviewChanged(result.review)
    } catch (cause) {
      setActionError(localizedIpcError(locale, cause, t('无法修改案件状态。', '案件の状態を変更できませんでした。')))
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
      setActionError(localizedIpcError(locale, cause, t('无法开始案件修订审核。', '案件の改訂レビューを開始できませんでした。')))
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
      setActionError(localizedIpcError(locale, cause, t('无法确认删除影响。', '削除影響を確認できませんでした。')))
    } finally {
      setAction('idle')
    }
  }

  const deleteCase = async () => {
    if (!deletionPreview || deletionConfirmation !== t('删除', '削除') || action !== 'idle') return
    setAction('delete')
    setActionError(null)
    try {
      const result = await onDelete({
        reviewId: review.reviewId,
        confirmationHash: deletionPreview.confirmationHash,
        confirmationText: '削除' // i18n-ignore: confirmation token checked by Main
      })
      onDeleted(result)
    } catch (cause) {
      setActionError(localizedIpcError(locale, cause, t('无法删除案件数据。', '案件データを削除できませんでした。')))
      setAction('idle')
    }
  }

  return (
    <div className="job-case-management-backdrop">
      <aside aria-label={t('案件历史与管理', '案件の履歴と管理')} aria-modal="true" className="job-case-management" role="dialog">
        <header>
          <div>
            <span className="eyebrow">{t('案件数据管理', '案件データ管理')}</span>
            <h2>{review.fields.find((field) => field.key === 'title')?.value ?? review.redactedSubject}</h2>
            <p>
              {sourceTypeLabel(review.sourceType, t)} · Review {review.reviewId.slice(0, 8)} · {t('不含直接标识符', '直接識別子なし')}
            </p>
          </div>
          <button aria-label={t('关闭案件管理', '案件管理を閉じる')} onClick={onClose} type="button">
            ×
          </button>
        </header>

        <section className="job-case-management-history">
          <div className="job-case-management-section-title">
            <h3>{t('版本历史', 'バージョン履歴')}</h3>
            <span>
              {history?.length ?? '—'}
              {t('项', '件')}
            </span>
          </div>
          {!history && !historyError ? (
            <div className="job-case-management-state">
              <span className="matching-spinner" />
              {t('正在读取历史…', '履歴を読み込み中…')}
            </div>
          ) : null}
          {historyError ? (
            <div className="job-case-management-state is-error">
              <Icon name="alert" size={16} />
              {historyError}
            </div>
          ) : null}
          {history?.map((version) => (
            <article key={version.id}>
              <header>
                <div>
                  <strong>Version {version.version}</strong>
                  <span>Review r{version.reviewRevision}</span>
                </div>
                <span className={`job-case-version-status is-${version.status}`}>
                  {version.status === 'active' ? 'ACTIVE' : version.status === 'archived' ? 'ARCHIVED' : t('已更新', '更新済み')}
                </span>
              </header>
              <p>
                {displayDate(version.confirmedAt, locale)} · {localizedMainText(locale, version.confirmedBy)}
              </p>
              <div>
                {version.fields
                  .filter((field) => field.value)
                  .map((field) => (
                    <span key={field.key}>
                      <small>{localizedCaseFieldLabel(locale, field)}</small>
                      <strong>{field.value}</strong>
                    </span>
                  ))}
              </div>
            </article>
          ))}
        </section>

        {review.status === 'completed' ? (
          <section className="job-case-management-actions">
            <div className="job-case-management-section-title">
              <h3>{t('生命周期与修订', 'ライフサイクルと改訂')}</h3>
              <span>{review.lifecycle === 'archived' ? 'ARCHIVED' : 'ACTIVE'}</span>
            </div>
            <p>
              {review.lifecycle === 'archived'
                ? t('恢复后可重新使用案件并开始修订。', '復元すると案件を再び利用でき、改訂も開始できます。')
                : t(
                    '修订会继承当前值，并重新要求确认 13 个字段及隐私信息。',
                    '改訂は現在値を引き継ぎ、再度13項目とプライバシー確認を要求します。'
                  )}
            </p>
            <input
              aria-label={t('案件管理原因', '案件管理の理由')}
              maxLength={300}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t('状态修改/修订原因（必填）', '状態変更・改訂の理由（必須）')}
              value={reason}
            />
            <div>
              <button disabled={reason.trim().length < 3 || action !== 'idle'} onClick={() => void changeLifecycle()} type="button">
                {action === 'lifecycle'
                  ? t('正在更新…', '更新中…')
                  : review.lifecycle === 'archived'
                    ? t('激活案件', '案件を再開')
                    : t('结束案件', '案件を終了')}
              </button>
              {openFollowUps ? (
                <span className="job-case-end-choice" role="group" aria-label={t('结束案件', '案件を終了')}>
                  <small>{t(`还有 ${openFollowUps} 条跟进没有结束。`, `終了していない対応が ${openFollowUps} 件あります。`)}</small>
                  <button disabled={action !== 'idle'} onClick={() => void changeLifecycle(false)} type="button">
                    {t('只结束案件', '案件のみ終了')}
                  </button>
                  <button disabled={action !== 'idle'} onClick={() => void changeLifecycle(true)} type="button">
                    {t('一并结束跟进', '対応もまとめて終了')}
                  </button>
                </span>
              ) : null}
              {review.lifecycle === 'active' ? (
                <button disabled={reason.trim().length < 3 || action !== 'idle'} onClick={() => void reopen()} type="button">
                  {action === 'reopen' ? t('准备中…', '準備中…') : t('开始修订审核', '改訂レビューを開始')}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="job-case-management-delete">
          <h3>{t('永久删除案件数据', '案件データを永久削除')}</h3>
          <p>
            {t(
              '将删除案件的全部版本、脱敏后的来源、审计记录、个人信息替换表以及直接关联的任务。Gmail 来源只保留一条删除记录，用于防止被再次导入。',
              '案件の全バージョン、脱敏済みソース、監査記録、個人情報の置換表と直接関連するタスクを削除します。Gmailソースは再取込を防ぐための削除記録だけを残します。'
            )}
          </p>
          {!deletionPreview ? (
            <button disabled={action !== 'idle'} onClick={() => void previewDeletion()} type="button">
              {action === 'preview' ? t('正在确认影响…', '影響を確認中…') : t('确认删除影响', '削除前の影響を確認')}
            </button>
          ) : (
            <div className="job-case-deletion-preview">
              <strong>{deletionPreview.title}</strong>
              <ul>
                <li>
                  {t(`JobCase ${deletionPreview.counts.caseVersions} 个版本`, `JobCase ${deletionPreview.counts.caseVersions}バージョン`)}
                </li>
                <li>{t(`审计记录 ${deletionPreview.counts.reviewAudits} 项`, `監査記録 ${deletionPreview.counts.reviewAudits}件`)}</li>
                <li>{t(`关联任务 ${deletionPreview.counts.taskRecords} 项`, `関連タスク ${deletionPreview.counts.taskRecords}件`)}</li>
                <li>{t(`提案草稿 ${deletionPreview.counts.proposalDrafts} 项`, `提案草稿 ${deletionPreview.counts.proposalDrafts}件`)}</li>
                <li>
                  {t(
                    `质量评估草稿 ${deletionPreview.counts.evaluationDraftCases} 项`,
                    `品質評価草稿 ${deletionPreview.counts.evaluationDraftCases}件`
                  )}
                </li>
                <li>
                  {t(`个人信息替换表 ${deletionPreview.counts.piiMappings} 项`, `個人情報の置換表 ${deletionPreview.counts.piiMappings}件`)}
                </li>
                <li>
                  {t(`已脱敏来源 ${deletionPreview.counts.sourceRecords} 项`, `脱敏済みソース ${deletionPreview.counts.sourceRecords}件`)}
                </li>
                <li>
                  {t(
                    `Gmail 本地副本 ${deletionPreview.counts.gmailMessages} 项`,
                    `Gmailローカルコピー ${deletionPreview.counts.gmailMessages}件`
                  )}
                </li>
                <DeletionBusinessCountItems counts={deletionPreview.counts} />
                {deletionPreview.counts.agentReferences ? (
                  <li>
                    {t(
                      `Agent 历史引用 ${deletionPreview.counts.agentReferences.conversations} 个会话 / ${deletionPreview.counts.agentReferences.messages} 条消息`,
                      `Agent履歴参照 ${deletionPreview.counts.agentReferences.conversations}会話 / ${deletionPreview.counts.agentReferences.messages}メッセージ`
                    )}
                  </li>
                ) : null}
              </ul>
              <DeletionPlacementBlock kind="case" counts={deletionPreview.counts} />
              <p>{t('请输入“删除”以继续。', '続行するには「削除」と入力してください。')}</p>
              <input
                aria-label={t('案件删除确认', '案件削除確認')}
                disabled={Boolean(deletionBlockedByPlacement(deletionPreview.counts))}
                onChange={(event) => setDeletionConfirmation(event.target.value)}
                value={deletionConfirmation}
              />
              <button
                disabled={
                  deletionConfirmation !== t('删除', '削除') ||
                  action !== 'idle' ||
                  Boolean(deletionBlockedByPlacement(deletionPreview.counts))
                }
                onClick={() => void deleteCase()}
                type="button"
              >
                {action === 'delete' ? t('正在删除…', '削除中…') : t('彻底删除', '完全に削除')}
              </button>
            </div>
          )}
          {actionError ? (
            <p className="job-case-management-error" role="alert">
              {actionError}
            </p>
          ) : null}
        </section>
      </aside>
    </div>
  )
}

interface BulkDeletionSummary {
  deleted: number
  failures: Array<{ title: string; message: string }>
  backupsExpiredPending: boolean
}

/**
 * Deletes every case the way one case is deleted: the same impact preview,
 * the same typed confirmation, the same governed deletion per case. The
 * previews shown are an aggregate; each case is previewed again right before
 * its own deletion so the confirmation hash is current.
 */
function BulkJobCaseDeletion({
  reviews,
  onClose,
  onPreviewDeletion,
  onDelete,
  onFinished
}: {
  reviews: JobCaseReviewSnapshot[]
  onClose(): void
  onPreviewDeletion(reviewId: string): Promise<JobCaseDeletionPreview>
  onDelete(input: DeleteJobCaseDataInput): Promise<DeleteJobCaseDataResult>
  onFinished(summary: BulkDeletionSummary): void
}) {
  const { locale, t } = useLocaleText()
  // The list shrinks as cases go; the targets are fixed when the dialog opens.
  const [targets] = useState(() => reviews)
  const [previews, setPreviews] = useState<JobCaseDeletionPreview[] | null>(null)
  const [previewErrors, setPreviewErrors] = useState<string[]>([])
  const [confirmation, setConfirmation] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    let active = true
    void Promise.allSettled(targets.map((review) => onPreviewDeletion(review.reviewId))).then((results) => {
      if (!active) return
      setPreviews(results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])))
      setPreviewErrors(
        results.flatMap((result) =>
          result.status === 'rejected'
            ? [localizedIpcError(locale, result.reason, t('无法确认删除影响。', '削除影響を確認できませんでした。'))]
            : []
        )
      )
    })
    return () => {
      active = false
    }
  }, [onPreviewDeletion, targets])

  const totals =
    previews?.reduce(
      (sum, preview) => ({
        caseVersions: sum.caseVersions + preview.counts.caseVersions,
        reviewAudits: sum.reviewAudits + preview.counts.reviewAudits,
        taskRecords: sum.taskRecords + preview.counts.taskRecords,
        businessFollowUps: sum.businessFollowUps + (preview.counts.businessFollowUps ?? 0),
        proposalDrafts: sum.proposalDrafts + preview.counts.proposalDrafts,
        evaluationDraftCases: sum.evaluationDraftCases + preview.counts.evaluationDraftCases,
        piiMappings: sum.piiMappings + preview.counts.piiMappings,
        sourceRecords: sum.sourceRecords + preview.counts.sourceRecords,
        gmailMessages: sum.gmailMessages + preview.counts.gmailMessages,
        conversations: sum.conversations + (preview.counts.agentReferences?.conversations ?? 0),
        messages: sum.messages + (preview.counts.agentReferences?.messages ?? 0)
      }),
      {
        businessFollowUps: 0,
        caseVersions: 0,
        reviewAudits: 0,
        taskRecords: 0,
        proposalDrafts: 0,
        evaluationDraftCases: 0,
        piiMappings: 0,
        sourceRecords: 0,
        gmailMessages: 0,
        conversations: 0,
        messages: 0
      }
    ) ?? null
  // Every numeric count added up, for the business records list shared with the other delete dialogs.
  const summedCounts = previews?.reduce<Record<string, number>>((sum, preview) => {
    for (const [key, value] of Object.entries(preview.counts)) if (typeof value === 'number') sum[key] = (sum[key] ?? 0) + value
    return sum
  }, {}) as JobCaseDeletionPreview['counts'] | undefined
  const placed = previews?.filter((preview) => deletionBlockedByPlacement(preview.counts)) ?? []
  const confirmed = confirmation === t('删除', '削除')

  const deleteAll = async () => {
    if (!previews || previews.length === 0 || !confirmed || progress) return
    setProgress({ done: 0, total: previews.length })
    let deleted = 0
    let backupsExpiredPending = false
    const failures: BulkDeletionSummary['failures'] = []
    for (const [index, shown] of previews.entries()) {
      try {
        if (deletionBlockedByPlacement(shown.counts))
          throw new Error(t('有人员通过这个案件处于已进场，已跳过。', 'この案件で参画中の要員がいるため、スキップしました。'))
        const fresh = await onPreviewDeletion(shown.reviewId)
        // What would go changed since HR confirmed it (new follow-ups, introductions…): skipped, not deleted unseen.
        if (fresh.confirmationHash !== shown.confirmationHash)
          throw new Error(
            t(
              '确认之后这个案件的删除影响有变化，已跳过；请重新确认后再删除。',
              '確認後に削除の影響が変わったため、スキップしました。もう一度確認してから削除してください。'
            )
          )
        // i18n-ignore: confirmation token checked by Main
        const result = await onDelete({ reviewId: fresh.reviewId, confirmationHash: fresh.confirmationHash, confirmationText: '削除' })
        deleted += 1
        if (result.report.components.backups === 'expired_pending') backupsExpiredPending = true
      } catch (cause) {
        failures.push({
          title: shown.title,
          message: localizedIpcError(locale, cause, t('无法删除案件数据。', '案件データを削除できませんでした。'))
        })
      }
      setProgress({ done: index + 1, total: previews.length })
    }
    onFinished({ deleted, failures, backupsExpiredPending })
  }

  return (
    <div className="job-case-management-backdrop">
      <aside
        aria-label={t('永久删除全部案件数据', 'すべての案件データを永久削除')}
        aria-modal="true"
        className="job-case-management is-bulk-delete"
        role="dialog"
      >
        <header>
          <div>
            <span className="eyebrow">{t('案件数据管理', '案件データ管理')}</span>
            <h2>{t('永久删除全部案件数据', 'すべての案件データを永久削除')}</h2>
            <p>{t(`${targets.length} 个案件 · 不含直接标识符`, `${targets.length}件の案件 · 直接識別子なし`)}</p>
          </div>
          <button aria-label={t('关闭全部删除', '全案件削除を閉じる')} disabled={progress !== null} onClick={onClose} type="button">
            ×
          </button>
        </header>
        <section className="job-case-management-delete">
          <p>
            {t(
              '将按同一删除流程逐个删除各案件的全部版本、脱敏后的来源、审计记录、个人信息替换表以及直接关联的任务。Gmail 来源只保留一条删除记录，用于防止被再次导入。此操作无法撤销。',
              '各案件の全バージョン、脱敏済みソース、監査記録、個人情報の置換表と直接関連するタスクを、1件ずつ同じ削除手順で削除します。Gmailソースは再取込を防ぐための削除記録だけを残します。この操作は取り消せません。'
            )}
          </p>
          {!previews ? (
            <div className="job-case-management-state">
              <span className="matching-spinner" />
              {t('正在汇总删除影响…', '削除影響を集計中…')}
            </div>
          ) : (
            <div className="job-case-deletion-preview">
              <ul className="job-case-bulk-targets">
                {previews.map((preview) => (
                  <li key={preview.reviewId}>{preview.title}</li>
                ))}
              </ul>
              {placed.length ? (
                <p role="alert" className="business-delete-blocked">
                  {t(
                    `其中 ${placed.length} 个案件有人员处于已进场，会被跳过：${placed.map((preview) => preview.title).join('、')}`,
                    `このうち ${placed.length} 件は参画中の要員がいるため、スキップします：${placed.map((preview) => preview.title).join('、')}`
                  )}
                </p>
              ) : null}
              {totals ? (
                <ul>
                  <DeletionBusinessCountItems counts={summedCounts} />
                  <li>{t(`JobCase ${totals.caseVersions} 个版本`, `JobCase ${totals.caseVersions}バージョン`)}</li>
                  <li>{t(`审计记录 ${totals.reviewAudits} 项`, `監査記録 ${totals.reviewAudits}件`)}</li>
                  <li>{t(`关联任务 ${totals.taskRecords} 项`, `関連タスク ${totals.taskRecords}件`)}</li>
                  <li>{t(`提案草稿 ${totals.proposalDrafts} 项`, `提案草稿 ${totals.proposalDrafts}件`)}</li>
                  <li>{t(`质量评估草稿 ${totals.evaluationDraftCases} 项`, `品質評価草稿 ${totals.evaluationDraftCases}件`)}</li>
                  <li>{t(`个人信息替换表 ${totals.piiMappings} 项`, `個人情報の置換表 ${totals.piiMappings}件`)}</li>
                  <li>{t(`已脱敏来源 ${totals.sourceRecords} 项`, `脱敏済みソース ${totals.sourceRecords}件`)}</li>
                  <li>{t(`Gmail 本地副本 ${totals.gmailMessages} 项`, `Gmailローカルコピー ${totals.gmailMessages}件`)}</li>
                  <li>
                    {t(
                      `Agent 历史引用 ${totals.conversations} 个会话 / ${totals.messages} 条消息`,
                      `Agent履歴参照 ${totals.conversations}会話 / ${totals.messages}メッセージ`
                    )}
                  </li>
                </ul>
              ) : null}
              {previewErrors.map((message, index) => (
                <p className="job-case-management-error" key={`${index}-${message}`} role="alert">
                  {message}
                </p>
              ))}
              <p>{t('请输入“删除”以继续。', '続行するには「削除」と入力してください。')}</p>
              <input
                aria-label={t('全部案件删除确认', '全案件削除確認')}
                disabled={progress !== null}
                onChange={(event) => setConfirmation(event.target.value)}
                value={confirmation}
              />
              <button disabled={!confirmed || previews.length === 0 || progress !== null} onClick={() => void deleteAll()} type="button">
                {progress
                  ? t(`正在删除… ${progress.done} / ${progress.total}`, `削除中… ${progress.done} / ${progress.total}`)
                  : t('彻底删除', '完全に削除')}
              </button>
            </div>
          )}
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
  const { locale, t } = useLocaleText()
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
      setError(localizedIpcError(locale, cause, t('无法创建手工案件草稿。', '手動案件の草稿を作成できませんでした。')))
      setBusy(false)
    }
  }

  return (
    <div className="job-case-composer-backdrop">
      <form aria-labelledby="manual-job-case-title" aria-modal="true" className="job-case-composer" onSubmit={submit} role="dialog">
        <header>
          <div>
            <span className="eyebrow">{t('手工输入', '手動入力')}</span>
            <h2 id="manual-job-case-title">{t('手工添加案件信息', '案件情報を手動で追加')}</h2>
            <p>
              {t(
                '粘贴销售邮件或聊天中的案件信息，创建待审核草稿。',
                '営業メールやチャットの案件情報を貼り付け、レビュー用の草稿を作成します。'
              )}
            </p>
          </div>
          <button aria-label={t('关闭', '閉じる')} disabled={busy} onClick={onCancel} type="button">
            ×
          </button>
        </header>
        <div className="job-case-composer-privacy">
          <Icon name="shield" size={18} />
          <div>
            <strong>{t('输入内容会先在本机脱敏', '入力はまず端末内で脱敏されます')}</strong>
            <p>
              {t(
                '在本机检测姓名、电话、邮箱和地址等信息并替换为占位符；原文不会保存到案件数据库或云端。',
                '姓名・電話・メール・住所などをローカル検出して占位符に置換。原文は案件DBにもクラウドにも保存しません。'
              )}
            </p>
          </div>
        </div>
        <label>
          <span>{t('主题/案件名称', '件名・案件名')}</span>
          <input
            autoFocus
            maxLength={2_000}
            onChange={(event) => setSubject(event.target.value)}
            placeholder={t('例如：Java / AWS 支付平台改造案件', '例：Java / AWS 決済基盤刷新案件')}
            value={subject}
          />
        </label>
        <label>
          <span>{t('案件正文', '案件本文')}</span>
          <textarea
            maxLength={100_000}
            onChange={(event) => setBody(event.target.value)}
            placeholder={t(
              '招聘角色：\n必备技能：\n单价：\n工作地点：\n远程：\n开始时间：\n工作资格：可在日本工作',
              '募集ロール：\n必須スキル：\n単価：\n勤務地：\nリモート：\n開始時期：\n就労資格：日本で就労可能'
            )}
            rows={13}
            value={body}
          />
        </label>
        <small>
          {body.length.toLocaleString(locale)}
          {t(' / 100,000 字 · 此处不导入附件', ' / 100,000文字 · 添付ファイルはここでは取り込みません')}
        </small>
        {error ? (
          <p className="job-case-composer-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button disabled={busy} onClick={onCancel} type="button">
            {t('取消', 'キャンセル')}
          </button>
          <button disabled={!canCreate} type="submit">
            <Icon name="lock" size={14} />
            {busy ? t('正在本地处理…', 'ローカル処理中…') : t('脱敏并创建草稿', '脱敏して草稿を作成')}
          </button>
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
  const { locale, t } = useLocaleText()
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
      setError(
        localizedIpcError(locale, cause, t('无法从聊天粘贴内容创建案件草稿。', 'チャット貼り付けから案件草稿を作成できませんでした。'))
      )
      setBusy(false)
    }
  }

  return (
    <div className="job-case-composer-backdrop" role="presentation">
      <form aria-label={t('聊天粘贴案件', 'チャット貼り付け案件')} className="job-case-composer" onSubmit={submit}>
        <header>
          <div>
            <span className="eyebrow">{t('聊天粘贴', 'チャット貼り付け')}</span>
            <h2>{t('从聊天正文创建案件草稿', 'チャット本文から案件草稿を作成')}</h2>
          </div>
          <button aria-label={t('关闭', '閉じる')} disabled={busy} onClick={onCancel} type="button">
            ×
          </button>
        </header>
        <div className="job-case-composer-privacy">
          <Icon name="shield" size={18} />
          <div>
            <strong>{t('原文只存在于此输入框及主进程的一次性处理中', '原文はこの入力欄と Main の一回処理だけ')}</strong>
            <p>
              {t(
                '提交时立即清空输入框，只把经本机 NER 与脱敏后的内容保存到现有案件审核中；不会执行正文里的任何指令。',
                '送信時に入力欄を直ちに消去し、端末内 NER・脱敏後の内容だけを既存 JobCase Review に保存します。本文中の命令は実行しません。'
              )}
            </p>
          </div>
        </div>
        <label>
          <span>{t('粘贴正文', '貼り付け本文')}</span>
          <textarea
            autoFocus
            maxLength={100_000}
            onChange={(event) => setText(event.target.value)}
            placeholder={t(
              '请粘贴案件聊天内容。姓名、电话、邮箱和地址会在本机替换。',
              '案件チャットを貼り付けてください。氏名・電話・メール・住所は端末内で置換されます。'
            )}
            rows={16}
            value={text}
          />
        </label>
        <small>
          {text.length.toLocaleString(locale)}
          {t(' / 100,000 字 · 不会保存到浏览器存储、日志或云端', ' / 100,000文字 · ブラウザ保存・ログ・クラウドには保存しません')}
        </small>
        {error ? (
          <p className="job-case-composer-error" role="alert">
            {error} {t('原文不会恢复，请确认安全后重新粘贴。', '原文は復元されません。安全を確認して再度貼り付けてください。')}
          </p>
        ) : null}
        <footer>
          <button disabled={busy} onClick={onCancel} type="button">
            {t('取消', 'キャンセル')}
          </button>
          <button disabled={!canCreate} type="submit">
            <Icon name="lock" size={14} />
            {busy ? t('正在本地处理…', 'ローカル処理中…') : t('脱敏并创建草稿', '脱敏して下書きを作成')}
          </button>
        </footer>
      </form>
    </div>
  )
}

/**
 * Offered after a case is confirmed: labels the operator typed a value under in the source become
 * candidate field aliases. Nothing is saved until the operator accepts one.
 */
export function JobCaseAliasSuggestions({
  suggestions,
  review,
  fieldAliases,
  onSaveFieldAliases,
  onDismiss
}: {
  suggestions: AliasSuggestion[]
  review?: JobCaseReviewSnapshot | null
  fieldAliases?: JobCaseFieldAliases
  onSaveFieldAliases(input: SaveJobCaseFieldAliasesInput): Promise<JobCaseFieldAliases>
  onDismiss(suggestion: AliasSuggestion): void
}) {
  const { locale, t } = useLocaleText()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (suggestions.length === 0) return null
  const accept = async (suggestion: AliasSuggestion) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const current = fieldAliases?.aliases ?? {}
      await onSaveFieldAliases({
        aliases: { ...current, [suggestion.key]: [...(current[suggestion.key] ?? []), suggestion.label] },
        expectedRevision: fieldAliases?.revision ?? null
      })
      onDismiss(suggestion)
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('别名保存失败。', '別名を保存できませんでした。')))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="job-case-alias-suggestions" role="status">
      <strong>{t('可以把确认值所用的标签登记为别名', '確定した値のラベルを別名として登録できます')}</strong>
      <p>
        {t(
          '登记后，本机分类、字段抽取和云端抽取指令下次都会把该标签当作既定字段。',
          '登録すると、次回からこのラベルは端末内の分類・項目抽出とクラウド抽出指示で既定項目として扱われます。'
        )}
      </p>
      <ul>
        {suggestions.map((suggestion) => (
          <li key={`${suggestion.key}-${suggestion.label}`}>
            <span>
              「{suggestion.label}」→{' '}
              {(() => {
                const field = review?.fields.find((item) => item.key === suggestion.key)
                return field ? localizedCaseFieldLabel(locale, field) : localizedJobCaseFieldLabel(locale, suggestion.key)
              })()}
            </span>
            <button disabled={busy} onClick={() => void accept(suggestion)} type="button">
              {t('保存为别名', '別名として保存')}
            </button>
            <button disabled={busy} onClick={() => onDismiss(suggestion)} type="button">
              {t('忽略', '無視')}
            </button>
          </li>
        ))}
      </ul>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  )
}

/**
 * The 案件 → 「批量导入」 page: every import source (Gmail, EML, manual, chat paste, WeChat) plus
 * whole-library deletion. Imported drafts are confirmed in the HR case list's detail panel, which
 * `onOpenLibrary` opens with the new case selected.
 */
export function JobCaseInbox({
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
  onImportEml,
  onImportGmail,
  onOpenExternalSettings,
  onOpenLibrary,
  onPreviewDeletion,
  reviews,
  wechatVisibleMessage = {
    phase: 'B-03-1',
    gateStatus: 'not-run',
    platform: 'darwin',
    featureFlagEnabled: true,
    userFeatureAvailable: false,
    accessibilityTrusted: false,
    screenCaptureTrusted: false,
    rawTextNetworkIsolationVerified: false,
    evidenceVerified: false,
    targetVersion: null,
    failureCodes: ['EVIDENCE_UNAVAILABLE']
  }
}: JobCaseInboxProps) {
  const { locale, t } = useLocaleText()
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
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeletionSummary, setBulkDeletionSummary] = useState<BulkDeletionSummary | null>(null)
  const awaitingCount = reviews.filter((review) => review.lifecycle === 'active' && review.status === 'awaiting-review').length
  const completedCount = reviews.filter((review) => review.lifecycle === 'active' && review.status === 'completed').length
  const archivedCount = reviews.filter((review) => review.lifecycle === 'archived').length
  const wechatCaptureLabel =
    wechatEvidence?.captureMethod === 'accessibility-tree' ? t('界面文本', '画面テキスト') : t('文字识别', '文字認識')
  const pendingBySource = (sourceType: JobCaseReviewSnapshot['sourceType']) =>
    reviews.filter((review) => review.sourceType === sourceType && review.lifecycle === 'active' && review.status === 'awaiting-review')
      .length
  useEffect(() => {
    if (manualCreateRequestId === null) return
    onManualCreateRequestHandled?.()
    setManualOpen(true)
  }, [manualCreateRequestId])

  const importEml = async () => {
    if (emlImporting) return
    setEmlImporting(true)
    setEmlError(null)
    try {
      const result = await onImportEml()
      if (!result.cancelled) {
        setEmlResult(result)
        const nextReview =
          result.items.find((item) => item.status === 'imported' && item.review)?.review ??
          result.items.find((item) => item.status === 'duplicate' && item.review)?.review
        if (nextReview) onOpenLibrary?.(nextReview.reviewId)
      }
    } catch (cause) {
      setEmlError(localizedIpcError(locale, cause, t('无法导入 EML 文件。', 'EML ファイルを取り込めませんでした。')))
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
      setGmailError(localizedIpcError(locale, cause, t('无法从 Gmail 导入案件。', 'Gmail から案件を取り込めませんでした。')))
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
      onOpenLibrary?.(result.review.reviewId)
    } catch (cause) {
      setWechatError(localizedIpcError(locale, cause, t('无法读取微信可见消息。', '微信の可視メッセージを読み取れませんでした。')))
    } finally {
      setWechatReading(false)
    }
  }

  return (
    <main className="job-case-inbox">
      <header className="job-case-page-header">
        <div>
          <h1>{t('导入案件', '案件をインポート')}</h1>
          <p>
            {t(
              '从 Google Workspace、EML 和手工输入导入案件，并标准化为固定格式。',
              'Google Workspace、EML、手動入力から案件情報を取り込み、固定フォーマットへ標準化します。'
            )}
          </p>
        </div>
        <div className="job-case-page-actions">
          {reviews.length ? (
            // A destructive, rarely used action: tucked under 「管理」 and absent when there is nothing to delete.
            <details className="job-case-manage">
              <summary>{t('管理', '管理')}</summary>
              <div className="job-case-manage-menu">
                <button className="is-danger" onClick={() => setBulkDeleteOpen(true)} type="button">
                  <Icon name="alert" size={14} />
                  {t('删除全部案件', '全案件を削除')}
                </button>
              </div>
            </details>
          ) : null}
          <div className="job-case-page-stats">
            <div>
              <strong>{awaitingCount}</strong>
              <span>{t('待确认', '確認待ち')}</span>
            </div>
            <div>
              <strong>{completedCount}</strong>
              <span>{t('已确认', '確認済み')}</span>
            </div>
            <div>
              <strong>{archivedCount}</strong>
              <span>{t('已结束', '終了')}</span>
            </div>
          </div>
        </div>
      </header>

      {gmailImportNotice ? (
        <section
          aria-label={t('Gmail 同步结果', 'Gmail同期結果')}
          className={`job-case-import-notice${gmailImportNotice.failed > 0 ? ' is-warning' : ''}`}
        >
          <Icon name={gmailImportNotice.failed > 0 ? 'alert' : 'check'} size={16} />
          <div>
            <strong>
              {t(
                `Gmail 同步：${gmailImportNotice.imported} 项已导入 · ${gmailImportNotice.duplicates} 项重复 · ${gmailImportNotice.filtered} 项超出范围 · ${gmailImportNotice.failed} 项失败`,
                `Gmail同期：${gmailImportNotice.imported}件取込 · ${gmailImportNotice.duplicates}件重複 · ${gmailImportNotice.filtered}件範囲外 · ${gmailImportNotice.failed}件失敗`
              )}
            </strong>
            <p>
              {gmailSyncModeLabel(gmailImportNotice.mode, t)} ·{' '}
              {t(
                `保存 ${gmailImportNotice.storedMessages} 项。正文已在本机脱敏，未发送到云端大模型。`,
                `保存 ${gmailImportNotice.storedMessages}件。本文は端末内で脱敏し、Cloud LLMには送信していません。`
              )}
            </p>
          </div>
          <button aria-label={t('关闭 Gmail 同步结果', 'Gmail同期結果を閉じる')} onClick={onDismissGmailImportNotice} type="button">
            ×
          </button>
        </section>
      ) : null}

      {emlError ? (
        <div className="job-case-import-notice is-error" role="alert">
          <Icon name="alert" size={16} />
          <span>{emlError}</span>
          <button aria-label={t('关闭 EML 导入错误', 'EML取込エラーを閉じる')} onClick={() => setEmlError(null)} type="button">
            ×
          </button>
        </div>
      ) : null}
      {gmailError ? (
        <div className="job-case-import-notice is-error" role="alert">
          <Icon name="alert" size={16} />
          <span>{gmailError}</span>
          <button aria-label={t('关闭 Gmail 导入错误', 'Gmail取込エラーを閉じる')} onClick={() => setGmailError(null)} type="button">
            ×
          </button>
        </div>
      ) : null}
      {wechatError ? (
        <div className="job-case-import-notice is-error" role="alert">
          <Icon name="alert" size={16} />
          <span>{wechatError}</span>
          <button aria-label={t('关闭微信读取错误', '微信読取エラーを閉じる')} onClick={() => setWechatError(null)} type="button">
            ×
          </button>
        </div>
      ) : null}
      {emlResult ? (
        <section
          aria-label={t('EML 导入结果', 'EML取込結果')}
          className={`job-case-import-notice${emlResult.failedCount > 0 ? ' is-warning' : ''}`}
        >
          <Icon name={emlResult.failedCount > 0 ? 'alert' : 'check'} size={16} />
          <div>
            <strong>
              {t(
                `EML 导入：${emlResult.importedCount} 项已登记 · ${emlResult.duplicateCount} 项重复 · ${emlResult.skippedCount} 项已排除 · ${emlResult.failedCount} 项失败`,
                `EML取込：${emlResult.importedCount}件登録 · ${emlResult.duplicateCount}件重複 · ${emlResult.skippedCount}件対象外 · ${emlResult.failedCount}件失敗`
              )}
            </strong>
            <p>
              {t(
                '仅在隔离断网环境中解析正文；未保存附件和原始 EML。',
                '本文だけを隔離・断網環境で解析しました。添付ファイルと元のEMLは保存していません。'
              )}
            </p>
            {emlResult.items.some((item) => item.status === 'failed' || item.status === 'skipped') ? (
              <ul>
                {emlResult.items
                  .filter((item) => item.status === 'failed' || item.status === 'skipped')
                  .map((item) => (
                    <li key={`${item.fileName}-${item.status}`}>
                      {item.fileName}：
                      {item.status === 'skipped'
                        ? item.classification === 'candidate-proposal'
                          ? t('属于人员信息邮件，不作为案件登记', '要員・候補者メールのため案件登録対象外')
                          : t('无法判定为案件邮件，已排除', '案件メールと判定できず対象外')
                        : item.errorCode
                          ? emlErrorLabel(item.errorCode, t)
                          : t('导入失败', '取込失敗')}
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
          <button aria-label={t('关闭 EML 导入结果', 'EML取込結果を閉じる')} onClick={() => setEmlResult(null)} type="button">
            ×
          </button>
        </section>
      ) : null}

      <section className="case-import-workspace" aria-label={t('案件导入来源', '案件の取込元')}>
        <div className="case-import-intro">
          <span>
            <Icon name="shield" size={17} />
          </span>
          <div>
            <strong>{t('所有来源在保存前都执行本地脱敏和字段确认', 'どの経路でも、保存前にローカル脱敏と項目確認を実施')}</strong>
            <p>
              {t(
                '姓名、电话、邮箱、住址等直接标识符会在本机替换，原文不会发送至云端大模型。',
                '姓名、電話、メール、住所などの直接識別子を端末内で置換し、原文を Cloud LLM へ送信しません。'
              )}
            </p>
          </div>
        </div>
        <div className="case-import-source-grid">
          <article>
            <span className="case-import-source-icon">
              <Icon name="mail" size={23} />
            </span>
            <div>
              <small>{t('公司邮箱', '会社メール')}</small>
              <h2>{t('从公司 Gmail 导入', '会社 Gmail から取り込む')}</h2>
              <p>
                {t('仅只读同步已设置的 Label、时间范围和关键词。', '設定済みの Label、期間、キーワード範囲だけを読取専用で同期します。')}
              </p>
            </div>
            <dl className="case-import-source-facts">
              <div>
                <dt>{t('权限', '権限')}</dt>
                <dd>{t('只读', '読取専用')}</dd>
              </div>
              <div>
                <dt>{t('范围', '範囲')}</dt>
                <dd>{t('管理员设置范围内', '管理者設定内')}</dd>
              </div>
              <div>
                <dt>{t('最近同步', '最終同期')}</dt>
                <dd>{gmailImportNotice ? displayDate(gmailImportNotice.syncedAt, locale) : t('未执行', '未実行')}</dd>
              </div>
              <div>
                <dt>{t('重复 / 失败', '重複 / 失敗')}</dt>
                <dd>{gmailImportNotice ? `${gmailImportNotice.duplicates} / ${gmailImportNotice.failed}` : '—'}</dd>
              </div>
              <div>
                <dt>{t('待确认', '確認待ち')}</dt>
                <dd>{pendingBySource('gmail')}</dd>
              </div>
              <div>
                <dt>{t('网络', 'ネットワーク')}</dt>
                <dd>{t('仅同步时', '同期時のみ')}</dd>
              </div>
            </dl>
            <div className="case-import-source-status">
              <span className={gmailConnected ? 'is-ready' : ''} />
              {gmailConnected ? t('已只读连接', '読取専用で接続済み') : t('需要连接设置', '接続設定が必要')}
            </div>
            <button disabled={gmailImporting} onClick={() => void importGmail()} type="button">
              {gmailSetupRequired || !gmailConnected
                ? t('打开外部系统设置', '外部システム設定を開く')
                : gmailImporting
                  ? t('正在同步…', '同期中…')
                  : t('从 Gmail 导入', 'Gmail から取り込む')}
              <Icon name="chevron-right" size={15} />
            </button>
          </article>
          <article>
            <span className="case-import-source-icon">
              <Icon name="file" size={23} />
            </span>
            <div>
              <small>{t('本机文件', 'ローカルファイル')}</small>
              <h2>{t('导入 EML 文件', 'EML ファイルを取り込む')}</h2>
              <p>
                {t(
                  '在隔离断网环境中解析多个 .eml，仅将案件邮件生成草稿。',
                  '複数の .eml を隔離・断網環境で解析し、案件メールだけを草稿にします。'
                )}
              </p>
            </div>
            <dl className="case-import-source-facts">
              <div>
                <dt>{t('权限', '権限')}</dt>
                <dd>{t('仅所选文件', '選択ファイルのみ')}</dd>
              </div>
              <div>
                <dt>{t('范围', '範囲')}</dt>
                <dd>{t(`最多 ${20} 项`, `最大 ${20} 件`)}</dd>
              </div>
              <div>
                <dt>{t('最近导入', '最終取込')}</dt>
                <dd>{emlResult ? t('本次已执行', '今回実行済み') : t('未执行', '未実行')}</dd>
              </div>
              <div>
                <dt>{t('重复 / 失败', '重複 / 失敗')}</dt>
                <dd>{emlResult ? `${emlResult.duplicateCount} / ${emlResult.failedCount}` : '—'}</dd>
              </div>
              <div>
                <dt>{t('待确认', '確認待ち')}</dt>
                <dd>{pendingBySource('eml')}</dd>
              </div>
              <div>
                <dt>{t('网络', 'ネットワーク')}</dt>
                <dd>{t('离线处理', 'オフライン処理')}</dd>
              </div>
            </dl>
            <div className="case-import-source-status">
              <span className="is-ready" />
              {t('在本机解析', '端末内で解析')}
            </div>
            <button disabled={emlImporting} onClick={() => void importEml()} type="button">
              {emlImporting ? t('正在本地解析…', 'ローカル解析中…') : t('选择 EML', 'EML を選択')}
              <Icon name="chevron-right" size={15} />
            </button>
          </article>
          <article>
            <span className="case-import-source-icon">
              <Icon name="plus" size={23} />
            </span>
            <div>
              <small>{t('手工输入', '手動入力')}</small>
              <h2>{t('手动输入案件', '案件を手動入力')}</h2>
              <p>
                {t(
                  '销售人员输入标题和正文，并生成标准字段的待审核草稿。',
                  '営業担当が件名と本文を入力し、標準項目のレビュー草稿にします。'
                )}
              </p>
            </div>
            <dl className="case-import-source-facts">
              <div>
                <dt>{t('权限', '権限')}</dt>
                <dd>{t('仅输入内容', '入力内容のみ')}</dd>
              </div>
              <div>
                <dt>{t('范围', '範囲')}</dt>
                <dd>{t('单个草稿', '下書き1件')}</dd>
              </div>
              <div>
                <dt>{t('重复检测', '重複チェック')}</dt>
                <dd>{t('自动', '自動')}</dd>
              </div>
              <div>
                <dt>{t('待确认', '確認待ち')}</dt>
                <dd>{pendingBySource('manual')}</dd>
              </div>
              <div>
                <dt>{t('网络', 'ネットワーク')}</dt>
                <dd>{t('离线处理', 'オフライン処理')}</dd>
              </div>
            </dl>
            <div className="case-import-source-status">
              <span className="is-ready" />
              {t('最多 100,000 字', '最大 100,000 文字')}
            </div>
            <button onClick={() => setManualOpen(true)} type="button">
              {t('输入案件信息', '案件情報を入力')}
              <Icon name="chevron-right" size={15} />
            </button>
          </article>
          <article>
            <span className="case-import-source-icon">
              <Icon name="mail" size={23} />
            </span>
            <div>
              <small>{t('单次粘贴', '1回だけ貼り付け')}</small>
              <h2>{t('粘贴聊天正文', 'チャット本文を貼り付け')}</h2>
              <p>
                {t(
                  '提交时清空输入框，不保存原文，只创建经本机脱敏的草稿。',
                  '入力欄を送信時に消去し、原文を保存せずローカル脱敏した草稿だけを作成します。'
                )}
              </p>
            </div>
            <dl className="case-import-source-facts">
              <div>
                <dt>{t('权限', '権限')}</dt>
                <dd>{t('仅本次粘贴内容', '今回の貼り付けのみ')}</dd>
              </div>
              <div>
                <dt>{t('范围', '範囲')}</dt>
                <dd>{t('当前输入', '現在の入力')}</dd>
              </div>
              <div>
                <dt>{t('重复检测', '重複チェック')}</dt>
                <dd>{t('自动', '自動')}</dd>
              </div>
              <div>
                <dt>{t('待确认', '確認待ち')}</dt>
                <dd>{pendingBySource('chat-paste')}</dd>
              </div>
              <div>
                <dt>{t('网络', 'ネットワーク')}</dt>
                <dd>{t('离线处理', 'オフライン処理')}</dd>
              </div>
            </dl>
            <div className="case-import-source-status">
              <span className="is-ready" />
              {t('不作为指令执行', '命令として実行しない')}
            </div>
            <button disabled={!onCreateChat} onClick={() => setChatPasteOpen(true)} type="button">
              {t('处理粘贴内容', '貼り付けた内容を処理')}
              <Icon name="chevron-right" size={15} />
            </button>
          </article>
          <article className={wechatVisibleMessage.userFeatureAvailable ? '' : 'is-pending-source'}>
            <span className="case-import-source-icon">
              <Icon name="mail" size={23} />
            </span>
            <div>
              <small>{t('Mac 版微信', 'Mac版 微信')}</small>
              <h2>{t('当前显示的消息', '現在表示中メッセージ')}</h2>
              <p>
                {t(
                  '确认后只读取前台微信窗口中可见的会话内容；截图和原文不保存，在本机脱敏后才生成草稿。',
                  '今回の確認後、前面にある微信の単一ウィンドウの可視会話領域だけを読み取ります。スクリーンショットと原文は保存せず、端末内で脱敏してから下書きを作成します。'
                )}
              </p>
            </div>
            <dl className="case-import-source-facts">
              <div>
                <dt>{t('辅助功能', 'アクセシビリティ')}</dt>
                <dd>{wechatVisibleMessage.accessibilityTrusted ? t('已许可', '許可済み') : t('需要许可', '要許可')}</dd>
              </div>
              <div>
                <dt>{t('屏幕录制', '画面収録')}</dt>
                <dd>{wechatVisibleMessage.screenCaptureTrusted ? t('已许可', '許可済み') : t('需要许可', '要許可')}</dd>
              </div>
              <div>
                <dt>{t('范围', '範囲')}</dt>
                <dd>{t('前台窗口的可见部分', '前面ウィンドウの表示部分')}</dd>
              </div>
              <div>
                <dt>{t('待确认', '確認待ち')}</dt>
                <dd>{pendingBySource('wechat-visible')}</dd>
              </div>
              <div>
                <dt>{t('网络', 'ネットワーク')}</dt>
                <dd>{wechatVisibleMessage.rawTextNetworkIsolationVerified ? t('离线处理', 'オフライン処理') : t('不可用', '利用不可')}</dd>
              </div>
            </dl>
            <div className="case-import-source-status">
              <span className={wechatVisibleMessage.userFeatureAvailable ? 'is-ready' : ''} />
              {wechatEvidence
                ? t(
                    `${wechatCaptureLabel} · ${wechatEvidence.visibleTextNodeCount} 段文本`,
                    `${wechatCaptureLabel} · テキスト${wechatEvidence.visibleTextNodeCount}件`
                  )
                : wechatVisibleMessage.userFeatureAvailable
                  ? `微信 ${wechatVisibleMessage.targetVersion ?? ''} · ${t('本次可读取', '今回読取可')}`
                  : t('执行时检查权限', '実行時に権限を確認')}
            </div>
            <button
              disabled={!onReadWechat || wechatReading || wechatVisibleMessage.platform !== 'darwin'}
              onClick={() => void readWechat()}
              type="button"
            >
              {wechatReading
                ? t('正在切换到微信并读取…', '微信へ切替・読取中…')
                : wechatVisibleMessage.userFeatureAvailable
                  ? t('读取当前可见消息', '表示中のメッセージを読取')
                  : t('检查权限后读取', '権限を確認して読取')}
              <Icon name={wechatReading ? 'clock' : 'chevron-right'} size={15} />
            </button>
          </article>
        </div>
        <div className="case-import-library-link">
          <div>
            <strong>{t('查看已导入案件', 'すでに取り込んだ案件を確認')}</strong>
            <span>
              {t(
                `待确认 ${awaitingCount} 项 · 已确认 ${completedCount} 项 · 已结束 ${archivedCount} 项`,
                `確認待ち ${awaitingCount} 件 · 確認済み ${completedCount} 件 · 終了 ${archivedCount} 件`
              )}
            </span>
          </div>
          <button onClick={() => onOpenLibrary?.()} type="button">
            {t('打开案件列表', '案件一覧を開く')}
            <Icon name="chevron-right" size={15} />
          </button>
        </div>
      </section>
      {manualOpen ? (
        <ManualJobCaseComposer
          onCancel={() => setManualOpen(false)}
          onCreate={async (input) => {
            const result = await onCreateManual(input)
            setManualOpen(false)
            onOpenLibrary?.(result.review.reviewId)
            return result
          }}
        />
      ) : null}
      {chatPasteOpen && onCreateChat ? (
        <ChatPasteComposer
          onCancel={() => setChatPasteOpen(false)}
          onCreate={async (input) => {
            const result = await onCreateChat(input)
            setChatPasteOpen(false)
            onOpenLibrary?.(result.review.reviewId)
            return result
          }}
        />
      ) : null}
      {bulkDeleteOpen ? (
        <BulkJobCaseDeletion
          onClose={() => setBulkDeleteOpen(false)}
          onDelete={onDelete}
          onFinished={(summary) => {
            setBulkDeletionSummary(summary)
            setBulkDeleteOpen(false)
          }}
          onPreviewDeletion={onPreviewDeletion}
          reviews={reviews}
        />
      ) : null}
      {bulkDeletionSummary ? (
        <section className="job-case-deletion-report" aria-label={t('全部案件删除报告', '全案件削除レポート')}>
          <div>
            <Icon name={bulkDeletionSummary.failures.length === 0 ? 'check' : 'alert'} size={18} />
            <strong>{t('全部案件删除报告', '全案件削除レポート')}</strong>
          </div>
          <p>
            {t(`已删除 ${bulkDeletionSummary.deleted} 个案件的数据。`, `${bulkDeletionSummary.deleted}件の案件データを削除しました。`)}
            {bulkDeletionSummary.failures.length > 0
              ? t(
                  `${bulkDeletionSummary.failures.length} 个案件未能删除。`,
                  `${bulkDeletionSummary.failures.length}件は削除できませんでした。`
                )
              : ''}
          </p>
          {bulkDeletionSummary.failures.length > 0 ? (
            <ul>
              {bulkDeletionSummary.failures.map((failure) => (
                <li key={`${failure.title}-${failure.message}`}>
                  {failure.title}：{failure.message}
                </li>
              ))}
            </ul>
          ) : null}
          {bulkDeletionSummary.backupsExpiredPending ? (
            <p>
              {t(
                '旧恢复包可能仍包含删除前的数据。请创建新备份，并安全销毁旧恢复包。',
                '以前の復元パッケージには削除前データが残る可能性があります。新しいバックアップを作成し、旧パッケージを安全に廃棄してください。'
              )}
            </p>
          ) : null}
          <button
            aria-label={t('关闭全部案件删除报告', '全案件削除レポートを閉じる')}
            onClick={() => setBulkDeletionSummary(null)}
            type="button"
          >
            ×
          </button>
        </section>
      ) : null}
    </main>
  )
}
