import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  BroadcastLanguage,
  BroadcastQueueStatus,
  BroadcastWorkspace,
  CaseBroadcastHistoryEntry,
  CaseBroadcastKind,
  DraftCaseBroadcastInput,
  DraftCaseBroadcastResult,
  DraftCaseUpdateNoticeInput,
  DraftCaseUpdateNoticeResult,
  OpenCaseBroadcastEmailInput,
  OpenCaseBroadcastEmailResult,
  RecordCaseBroadcastCopyInput,
  RecordCaseBroadcastCopyResult
} from '@shared'
import { useUiLocale } from '../i18n'
import { copyTextToClipboard } from '../copy-text'
import { Icon } from './Icon'

/** Everything the broadcast screen needs from the main process. */
export interface BroadcastPanelActions {
  loadWorkspace(): Promise<BroadcastWorkspace>
  draftBroadcast(input: DraftCaseBroadcastInput): Promise<DraftCaseBroadcastResult>
  draftUpdateNotice(input: DraftCaseUpdateNoticeInput): Promise<DraftCaseUpdateNoticeResult>
  recordCopy(input: RecordCaseBroadcastCopyInput): Promise<RecordCaseBroadcastCopyResult>
  openEmail(input: OpenCaseBroadcastEmailInput): Promise<OpenCaseBroadcastEmailResult>
  listBroadcasts(reviewId: string): Promise<CaseBroadcastHistoryEntry[]>
}

interface BroadcastWorkspaceViewProps {
  actions: BroadcastPanelActions
  /** Preselects one case when the operator arrived from that case. */
  initialReviewId?: string
  /** Fires when the operator picks another case, so the host can follow the focus. */
  onSelectedReviewChange?: (reviewId: string) => void
}

function statusLabel(status: BroadcastQueueStatus, zh: boolean): string {
  if (status === 'new') return zh ? '新增' : '新着'
  if (status === 'copied') return zh ? '已复制' : 'コピー済み'
  return zh ? '待补充' : '要補完'
}

function langLabel(lang: BroadcastLanguage, zh: boolean): string {
  if (lang === 'zh') return zh ? '中文版' : '中国語版'
  return zh ? '日文版' : '日本語版'
}

function formatTime(value: string, locale: 'ja-JP' | 'zh-CN'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(value))
}

export function BroadcastWorkspaceView({ actions, initialReviewId, onSelectedReviewChange }: BroadcastWorkspaceViewProps) {
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const [workspace, setWorkspace] = useState<BroadcastWorkspace | null>(null)
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(initialReviewId ?? null)
  // Arriving from one case's 配信文 button means that case, not the whole
  // queue: keep the queue folded until the operator asks for it.
  const [queueExpanded, setQueueExpanded] = useState(!initialReviewId)
  // The host can refocus the open queue (配信 on another case): follow it.
  useEffect(() => {
    if (initialReviewId) {
      setSelectedReviewId(initialReviewId)
      setQueueExpanded(false)
    }
  }, [initialReviewId])
  const [templateId, setTemplateId] = useState<string | null>(null)
  // The language stays where the operator put it while the screen is open:
  // an HR who works one WeChat group all afternoon should not retab per case.
  const [lang, setLang] = useState<BroadcastLanguage>('ja')
  const [draft, setDraft] = useState<DraftCaseBroadcastResult | null>(null)
  const [edits, setEdits] = useState<Partial<Record<BroadcastLanguage, string>>>({})
  const [kind, setKind] = useState<CaseBroadcastKind>('new')
  const [history, setHistory] = useState<CaseBroadcastHistoryEntry[] | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const loaded = await actions.loadWorkspace()
    setWorkspace(loaded)
    setTemplateId((current) => current ?? loaded.templates[0]?.id ?? null)
    return loaded
  }, [actions])

  useEffect(() => {
    let active = true
    void reload().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { active = false }
  }, [reload])

  const selected = useMemo(
    () => workspace?.queue.find((item) => item.reviewId === selectedReviewId) ?? null,
    [selectedReviewId, workspace]
  )

  // A newly opened case starts from a fresh draft.
  useEffect(() => {
    if (!selected || selected.status === 'attention') {
      setDraft(null)
      setHistory(null)
      return
    }
    let active = true
    setBusy(true)
    setError(null)
    setNotice(null)
    setEdits({})
    setKind('new')
    setHistory(null)
    void actions.draftBroadcast({ reviewId: selected.reviewId, ...(templateId ? { templateId } : {}) })
      .then((result) => { if (active) setDraft(result) })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [actions, selected?.reviewId, selected?.jobCaseVersion, templateId])

  const text = edits[lang] ?? (lang === 'zh' ? draft?.textZh : draft?.textJa) ?? ''
  // Identifier findings belong to the generated text; once the operator edits
  // the box, the warning is the last server answer and the copy stays blocked
  // until the case is redrawn - deliberately conservative.
  const forbidden = (lang === 'zh' ? draft?.forbiddenZh : draft?.forbiddenJa) ?? []

  const copy = async () => {
    if (!selected || !templateId || busy || forbidden.length > 0 || text.trim().length === 0) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await copyTextToClipboard(text)
      // The copy is the only thing this app witnessed, so it is the only thing
      // it writes down. Whether it reaches a group is the operator's business.
      await actions.recordCopy({ reviewId: selected.reviewId, templateId, lang, kind, text })
      setNotice(zh ? '已复制，可以去微信粘贴了。' : 'コピーしました。微信に貼り付けてください。')
      await reload()
      if (historyOpen) setHistory(await actions.listBroadcasts(selected.reviewId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const openEmail = async () => {
    if (!selected || !templateId || busy || forbidden.length > 0 || text.trim().length === 0) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await actions.openEmail({ reviewId: selected.reviewId, templateId, lang, kind, text })
      setNotice(zh
        ? '已打开默认邮件客户端。请确认收件人和正文后手动发送；本应用不会标记为已发送。'
        : '既定のメールアプリを開きました。宛先と本文を確認して送信してください。このアプリは送信済みとは記録しません。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const loadUpdateNotice = async () => {
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await actions.draftUpdateNotice({ reviewId: selected.reviewId })
      if (result.status === 'no-copy-baseline') {
        setNotice(zh ? '还没有复制过的版本可以对比。' : '比較できるコピー済みバージョンがありません。')
        return
      }
      if (result.status === 'no-changes') {
        setNotice(zh ? '与上次复制的版本没有差异。' : '前回コピーした内容から変更はありません。')
        return
      }
      setKind('update')
      setDraft({ textJa: result.textJa, textZh: result.textZh, forbiddenJa: [], forbiddenZh: [] })
      setEdits({})
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const toggleHistory = async () => {
    if (!selected) return
    const next = !historyOpen
    setHistoryOpen(next)
    if (next && history === null) {
      try {
        setHistory(await actions.listBroadcasts(selected.reviewId))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
  }

  const queue = workspace?.queue ?? []
  const count = (status: BroadcastQueueStatus) => queue.filter((item) => item.status === status).length
  const templateName = (id: string) => workspace?.templates.find((template) => template.id === id)?.name ?? '—'

  return <div className="broadcast-view">
    {queueExpanded || !selected ? <div className="agent-business-metrics">
      <span><strong>{count('new')}</strong>{zh ? '新增（未复制）' : '新着（未コピー）'}</span>
      <span><strong>{count('copied')}</strong>{zh ? '已复制' : 'コピー済み'}</span>
      <span><strong>{count('attention')}</strong>{zh ? '待补充' : '要補完'}</span>
    </div> : <div className="broadcast-focused-bar">
      <span className={`broadcast-status is-${selected.status}`}>{statusLabel(selected.status, zh)}</span>
      <strong>{selected.title || (zh ? '未命名案件' : '名称未設定案件')}</strong>
      <button onClick={() => setQueueExpanded(true)} type="button"><span>{zh ? '全部案件' : 'すべての案件'}</span><b>{queue.length}</b></button>
    </div>}
    <p className="broadcast-hint">{zh
      ? '复制可用于微信；“打开邮件”会预填标题和正文，收件人与最终发送由您在默认邮件客户端中确认。本机不会把打开邮件记录成已发送。'
      : 'コピーは微信で利用できます。「メールを開く」は件名と本文だけを既定のメールアプリへ渡し、宛先と最終送信はそこで確認します。メールを開いただけでは送信済みと記録しません。'}</p>

    {error ? <p className="agent-business-error" role="alert">{error}</p> : null}
    {notice ? <p className="broadcast-notice" role="status">{notice}</p> : null}

    {queueExpanded || !selected ? <div className="broadcast-queue" role="list">
      {queue.map((item) => <button
        aria-current={item.reviewId === selectedReviewId ? 'true' : undefined}
        className={item.reviewId === selectedReviewId ? 'is-selected' : ''}
        key={item.reviewId}
        onClick={() => { setSelectedReviewId(item.reviewId); onSelectedReviewChange?.(item.reviewId) }}
        role="listitem"
        type="button"
      >
        <span className={`broadcast-status is-${item.status}`}>{statusLabel(item.status, zh)}</span>
        <span>
          <strong>{item.title || (zh ? '未命名案件' : '名称未設定案件')}</strong>
          <small>{item.sourceType.toLocaleUpperCase('en-US')}{item.lastCopy ? ` · ${langLabel(item.lastCopy.lang, zh)} · ${formatTime(item.lastCopy.at, locale)}` : ''}</small>
        </span>
        {item.hasUpdateSinceLastCopy ? <em className="broadcast-update-badge">{zh ? '有更新' : '更新あり'}</em> : null}
      </button>)}
      {queue.length === 0 ? <div className="agent-business-empty"><Icon name="search" size={20} /><span>{zh ? '还没有可配信的案件' : '配信できる案件はまだありません'}</span></div> : null}
    </div> : null}

    {selected && selected.status === 'attention' ? <p className="broadcast-notice">
      {zh ? '该案件还在待补充状态，确认后才能配信。' : 'この案件は要補完です。確定してから配信できます。'}
    </p> : null}

    {selected && selected.status !== 'attention' ? <section className="broadcast-detail">
      <header>
        <h3>{selected.title}</h3>
        <label>
          <span>{zh ? '模板' : 'テンプレート'}</span>
          <select
            aria-label={zh ? '选择模板' : 'テンプレートを選択'}
            onChange={(event) => setTemplateId(event.target.value)}
            value={templateId ?? ''}
          >
            {(workspace?.templates ?? []).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
        </label>
      </header>

      <div className="broadcast-lang-tabs" role="group">
        <button className={lang === 'ja' ? 'is-active' : ''} onClick={() => setLang('ja')} type="button">{zh ? '日文版' : '日本語版'}</button>
        <button className={lang === 'zh' ? 'is-active' : ''} onClick={() => setLang('zh')} type="button">{zh ? '中文版' : '中国語版'}</button>
      </div>

      <textarea
        aria-label={zh ? '案件文案' : '紹介文'}
        className="broadcast-text"
        onChange={(event) => setEdits((current) => ({ ...current, [lang]: event.target.value }))}
        rows={12}
        value={text}
      />

      {forbidden.length > 0 ? <p className="broadcast-forbidden" role="alert">
        {zh ? `文案里还有识别符（${forbidden.join('、')}），删除后才能复制。` : `本文に識別子が残っています（${forbidden.join('、')}）。削除するまでコピーできません。`}
      </p> : null}

      <div className="broadcast-actions">
        <button
          className="agent-business-primary"
          disabled={busy || forbidden.length > 0 || text.trim().length === 0}
          onClick={() => void copy()}
          type="button"
        ><Icon name="copy" size={14} />{zh ? '复制' : 'コピーする'}</button>
        <button
          disabled={busy || forbidden.length > 0 || text.trim().length === 0}
          onClick={() => void openEmail()}
          type="button"
        ><Icon name="mail" size={14} />{zh ? '打开邮件' : 'メールを開く'}</button>
        {selected.hasUpdateSinceLastCopy ? <button disabled={busy} onClick={() => void loadUpdateNotice()} type="button">{zh ? '更新通知' : '更新通知を作る'}</button> : null}
      </div>

      <div className="broadcast-history">
        <button aria-expanded={historyOpen} onClick={() => void toggleHistory()} type="button">
          <Icon name={historyOpen ? 'arrow-up' : 'chevron-right'} size={14} />{zh ? '复制历史' : 'コピー履歴'}
        </button>
        {historyOpen ? <ul>
          {(history ?? []).map((entry) => <li key={entry.id}>
            <strong>{formatTime(entry.createdAt, locale)}</strong>
            <small>{langLabel(entry.lang, zh)} · {templateName(entry.templateId)} · {entry.kind === 'update' ? (zh ? '更新通知' : '更新通知') : (zh ? '新案件' : '新規')} · {zh ? `第 ${entry.jobCaseVersion} 版` : `第${entry.jobCaseVersion}版`}</small>
            {entry.source === 'legacy' ? <em>{zh ? '旧版记录' : '旧バージョンの記録'}</em> : null}
          </li>)}
          {history !== null && history.length === 0 ? <li>{zh ? '还没有复制记录' : 'コピー記録はまだありません'}</li> : null}
        </ul> : null}
      </div>
    </section> : null}
  </div>
}
