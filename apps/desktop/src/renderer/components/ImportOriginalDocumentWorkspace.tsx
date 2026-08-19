import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type {
  CandidateFieldKey,
  CandidateReviewFieldSnapshot,
  OriginalDocumentPreview
} from '@shared'
import { localizedIpcError, useUiLocale, useUiText } from '../i18n'
import { summarizeSourceLabels } from '../source-evidence'
import { Icon } from './Icon'
import { SpreadsheetPreview } from './OriginalDocumentWorkspace'

interface ImportOriginalDocumentWorkspaceProps {
  documentId: string
  fields: CandidateReviewFieldSnapshot[]
  projects: Array<{
    draftId: string
    title: string
    period: string | null
    role: string | null
    technologies: string
    summary: string
    sourceLabels: string[]
  }>
  selectedFieldKey: CandidateFieldKey
  values: Record<CandidateFieldKey, string>
  disabled: boolean
  onLoad(sourceDocumentId: string): Promise<OriginalDocumentPreview>
  onOpen(sourceDocumentId: string): Promise<unknown>
  onSelectField(key: CandidateFieldKey): void
  onChangeField(key: CandidateFieldKey, value: string): void
  onChangeProject(
    draftId: string,
    key: 'title' | 'period' | 'role' | 'technologies' | 'summary',
    value: string
  ): void
}

interface ReviewMapping {
  id: string
  kind: 'field' | 'project'
  label: string
  value: string | null
  sourceLabels: string[]
  fieldKey?: CandidateFieldKey
  projectId?: string
}

const compareDividerWidth = 16
const preferredViewerMinimum = 360
const preferredProfileMinimum = 300
const defaultViewerFraction = 1.65 / (1.65 + 0.85)

function sourceCell(value: string): { sheet: string; address: string } | null {
  const match = value.match(/^(.+)!([A-Z]{1,3}[1-9]\d*)$/u)
  return match?.[1] && match[2] ? { sheet: match[1], address: match[2] } : null
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function ImportOriginalDocumentWorkspace({
  documentId,
  fields,
  projects,
  selectedFieldKey,
  values,
  disabled,
  onLoad,
  onOpen,
  onSelectField,
  onChangeField,
  onChangeProject
}: ImportOriginalDocumentWorkspaceProps) {
  const locale = useUiLocale()
  const t = useUiText()
  const [preview, setPreview] = useState<OriginalDocumentPreview | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [selectedMappingId, setSelectedMappingId] = useState(`field:${selectedFieldKey}`)
  const [selectedSheet, setSelectedSheet] = useState('')
  const [search, setSearch] = useState('')
  const [zoom, setZoom] = useState(90)
  const [opening, setOpening] = useState(false)
  const [openNotice, setOpenNotice] = useState<string | null>(null)
  const [viewerWidth, setViewerWidth] = useState<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const compareRef = useRef<HTMLDivElement>(null)
  const pendingViewerWidthRef = useRef<number | null>(null)
  const resizeFrameRef = useRef<number | null>(null)

  useEffect(() => {
    setSelectedMappingId(`field:${selectedFieldKey}`)
  }, [selectedFieldKey])

  useEffect(() => {
    let active = true
    setStatus('loading')
    setError(null)
    void onLoad(documentId).then((result) => {
      if (!active) return
      setPreview(result)
      setSelectedSheet(result.sheets[0]?.name ?? '')
      setStatus('ready')
    }).catch((cause) => {
      if (!active) return
      setError(localizedIpcError(locale, cause, '原始ファイルを読み込めませんでした。'))
      setStatus('error')
    })
    return () => { active = false }
  }, [documentId, locale, onLoad])

  useEffect(() => () => {
    if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current)
  }, [])

  const mappings = useMemo<ReviewMapping[]>(() => [
    ...fields.map((field) => ({
      id: `field:${field.key}`,
      kind: 'field' as const,
      label: field.label,
      value: values[field.key] || null,
      sourceLabels: field.sourceLabels,
      fieldKey: field.key
    })),
    ...projects.map((project, index) => ({
      id: `project:${project.draftId}`,
      kind: 'project' as const,
      label: project.title || `${t('プロジェクト')} ${index + 1}`,
      value: [project.period, project.role, project.summary].filter(Boolean).join(' · ') || null,
      sourceLabels: project.sourceLabels,
      projectId: project.draftId
    }))
  ], [fields, projects, t, values])
  const selectedMapping = mappings.find((mapping) => mapping.id === selectedMappingId) ?? mappings[0]
  const activeSheet = preview?.sheets.find((sheet) => sheet.name === selectedSheet) ?? preview?.sheets[0]

  const selectMapping = (mapping: ReviewMapping) => {
    setSelectedMappingId(mapping.id)
    if (mapping.fieldKey) onSelectField(mapping.fieldKey)
    const source = mapping.sourceLabels.map(sourceCell).find((item) => item !== null)
    if (source && preview?.sheets.some((sheet) => sheet.name === source.sheet)) setSelectedSheet(source.sheet)
  }

  const openOriginal = async () => {
    if (opening) return
    setOpening(true)
    setOpenNotice(null)
    try {
      await onOpen(documentId)
      setOpenNotice(t('システムアプリで原始ファイルを開きました。'))
    } catch (cause) {
      setError(localizedIpcError(locale, cause, '原始ファイルをシステムアプリで開けませんでした。'))
    } finally {
      setOpening(false)
    }
  }

  const clampViewerWidth = (requestedWidth: number, containerWidth: number) => {
    const availableWidth = Math.max(0, containerWidth - compareDividerWidth)
    const minimumViewerWidth = Math.min(preferredViewerMinimum, Math.max(260, availableWidth - preferredProfileMinimum))
    const minimumProfileWidth = Math.min(preferredProfileMinimum, Math.max(260, availableWidth - minimumViewerWidth))
    const maximumViewerWidth = Math.max(minimumViewerWidth, availableWidth - minimumProfileWidth)
    return Math.round(Math.min(maximumViewerWidth, Math.max(minimumViewerWidth, requestedWidth)))
  }

  const defaultViewerWidth = (containerWidth: number) => clampViewerWidth(
    (containerWidth - compareDividerWidth) * defaultViewerFraction,
    containerWidth
  )

  const queueViewerWidth = (clientX: number) => {
    const bounds = compareRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width <= 0) return
    pendingViewerWidthRef.current = clampViewerWidth(clientX - bounds.left, bounds.width)
    if (resizeFrameRef.current !== null) return
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null
      if (pendingViewerWidthRef.current !== null) setViewerWidth(pendingViewerWidthRef.current)
    })
  }

  const finishResize = () => {
    setIsResizing(false)
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current)
      resizeFrameRef.current = null
    }
    if (pendingViewerWidthRef.current !== null) setViewerWidth(pendingViewerWidthRef.current)
  }

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setIsResizing(true)
    queueViewerWidth(event.clientX)
  }

  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isResizing) return
    queueViewerWidth(event.clientX)
  }

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    finishResize()
  }

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const bounds = compareRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width <= 0) return
    event.preventDefault()
    const currentWidth = viewerWidth ?? defaultViewerWidth(bounds.width)
    const increment = event.shiftKey ? 40 : 16
    setViewerWidth(clampViewerWidth(currentWidth + (event.key === 'ArrowRight' ? increment : -increment), bounds.width))
  }

  const compareStyle = viewerWidth === null ? undefined : {
    '--original-document-viewer-width': `${viewerWidth}px`
  } as CSSProperties

  return <div className="original-document-workspace import-original-document-workspace">
    <header className="original-document-toolbar">
      <div className="original-document-file"><span><Icon name="file" size={17} /></span><div><strong>{preview?.fileName ?? t('原始ファイル')}</strong><small>{preview ? `${preview.format.toUpperCase()} · ${formatBytes(preview.size)}` : t('端末内暗号化ファイル')}</small></div></div>
      <div className="original-document-tools">
        {preview?.viewMode === 'spreadsheet' && preview.sheets.length > 1 ? <select aria-label={t('ワークシート')} onChange={(event) => setSelectedSheet(event.target.value)} value={activeSheet?.name ?? ''}>{preview.sheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name}</option>)}</select> : null}
        {preview?.viewMode === 'spreadsheet' ? <label className="original-document-search"><Icon name="search" size={14} /><input aria-label={t('原始ファイル内を検索')} onChange={(event) => setSearch(event.target.value)} placeholder={t('原始ファイル内を検索')} value={search} /></label> : null}
        <div className="original-document-zoom"><button aria-label={t('縮小')} disabled={zoom <= 60} onClick={() => setZoom((value) => Math.max(60, value - 10))} type="button">−</button><span>{zoom}%</span><button aria-label={t('拡大')} disabled={zoom >= 140} onClick={() => setZoom((value) => Math.min(140, value + 10))} type="button">＋</button></div>
        <button className="original-document-open" disabled={opening || status !== 'ready'} onClick={() => void openOriginal()} type="button"><Icon name="external-link" size={14} />{opening ? t('開いています…') : t('システムアプリで開く')}</button>
        <span className="original-document-local"><Icon name="lock" size={12} />{t('端末内のみ')}</span>
      </div>
    </header>

    {openNotice ? <div className="original-document-notice"><Icon name="check" size={13} />{openNotice}</div> : null}
    {status === 'loading' ? <div className="original-document-state"><span className="matching-spinner" />{t('暗号化した原始ファイルを読み込み中…')}</div> : null}
    {status === 'error' ? <div className="original-document-state is-error"><Icon name="alert" size={17} />{error}</div> : null}

    {status === 'ready' && preview ? <div className={`original-document-compare${viewerWidth === null ? '' : ' is-resized'}${isResizing ? ' is-resizing' : ''}`} ref={compareRef} style={compareStyle}>
      <section className="original-document-viewer" aria-label={t('原始ファイルプレビュー')}>
        <div className="original-document-viewer-heading"><div><span>LOCAL ORIGINAL</span><strong>{preview.viewMode === 'spreadsheet' ? activeSheet?.name : preview.fileName}</strong></div><small>{selectedMapping?.sourceLabels.length ? summarizeSourceLabels(selectedMapping.sourceLabels, locale) : t('選択項目の自動出典なし')}</small></div>
        {preview.viewMode === 'pdf' && preview.previewUrl ? <iframe className="original-pdf-frame" src={preview.previewUrl} title={preview.fileName} /> : null}
        {preview.viewMode === 'spreadsheet' && activeSheet ? <SpreadsheetPreview search={search} selectedSources={selectedMapping?.sourceLabels ?? []} sheet={activeSheet} zoom={zoom} /> : null}
        {preview.viewMode === 'document' ? <div className="original-word-pages" style={{ fontSize: `${zoom / 100}em` }}>{preview.paragraphs.map((paragraph) => <p key={paragraph.paragraphNumber}>{paragraph.text}</p>)}</div> : null}
        {preview.viewMode === 'pdf' && !preview.previewUrl ? <div className="original-pdf-fallback">{preview.pages.map((page) => <article key={page.pageNumber}><span>Page {page.pageNumber}</span>{page.blocks.map((block, index) => <p key={index}>{block.text}</p>)}</article>)}</div> : null}
      </section>

      <div
        aria-label={t('原始ファイルと標準プロフィールの幅を調整')}
        aria-orientation="vertical"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={viewerWidth === null ? Math.round(defaultViewerFraction * 100) : Math.round(viewerWidth / Math.max(1, (compareRef.current?.getBoundingClientRect().width ?? viewerWidth)) * 100)}
        className="original-document-divider"
        onDoubleClick={() => setViewerWidth(null)}
        onKeyDown={resizeWithKeyboard}
        onPointerCancel={endResize}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        role="separator"
        tabIndex={0}
        title={t('左右にドラッグして幅を調整')}
      />

      <aside className="original-document-profile import-original-document-profile" aria-label={t('標準人材プロフィール')}>
        <header><span>REVIEW PROFILE</span><h2>{t('原本とプロフィールを照合')}</h2><p>{t('登録前の確認値を編集できます。変更は候補者プロフィールを確認すると保存されます。')}</p></header>
        <section><h3>{t('人材プロフィール項目')}</h3><div className="original-document-editable-list">{fields.map((field) => {
          const mapping = mappings.find((item) => item.id === `field:${field.key}`)
          const active = mapping?.id === selectedMapping?.id
          return <label className={active ? 'is-active' : undefined} key={field.key} onClick={() => mapping && selectMapping(mapping)}>
            <span><strong>{t(field.label)}</strong><em className={field.sourceLabels.length ? undefined : 'is-missing'}>{field.sourceLabels.length ? `${field.sourceLabels.length}${t('件')}` : t('出典なし')}</em></span>
            <input aria-label={t(field.label)} disabled={disabled} maxLength={500} onChange={(event) => onChangeField(field.key, event.target.value)} onFocus={() => mapping && selectMapping(mapping)} value={values[field.key] ?? ''} />
          </label>
        })}</div></section>
        {projects.length > 0 ? <section><h3>{t('プロジェクト経験')}</h3><div className="original-document-editable-projects">{projects.map((project, index) => {
          const mapping = mappings.find((item) => item.id === `project:${project.draftId}`)
          const active = mapping?.id === selectedMapping?.id
          return <article className={active ? 'is-active' : undefined} key={project.draftId}>
            <header><button onClick={() => mapping && selectMapping(mapping)} type="button"><span>PROJECT {String(index + 1).padStart(2, '0')}</span><em className={mapping?.sourceLabels.length ? undefined : 'is-missing'}>{mapping?.sourceLabels.length ? `${t('出典')} ${mapping.sourceLabels.length}${t('件')}` : t('出典なし')}</em></button></header>
            <div className="original-document-project-form">
              <label className="is-title">{t('案件・プロジェクト名')}<input aria-label={`${t('プロジェクト')} ${index + 1} ${t('の名称')}`} disabled={disabled} maxLength={160} onChange={(event) => onChangeProject(project.draftId, 'title', event.target.value)} onFocus={() => mapping && selectMapping(mapping)} value={project.title} /></label>
              <label>{t('期間')}<input aria-label={`${t('プロジェクト')} ${index + 1} ${t('の期間')}`} disabled={disabled} maxLength={120} onChange={(event) => onChangeProject(project.draftId, 'period', event.target.value)} onFocus={() => mapping && selectMapping(mapping)} value={project.period ?? ''} /></label>
              <label>{t('役割')}<input aria-label={`${t('プロジェクト')} ${index + 1} ${t('の役割')}`} disabled={disabled} maxLength={120} onChange={(event) => onChangeProject(project.draftId, 'role', event.target.value)} onFocus={() => mapping && selectMapping(mapping)} value={project.role ?? ''} /></label>
              <label className="is-wide">{t('技術（カンマ区切り）')}<input aria-label={`${t('プロジェクト')} ${index + 1} ${t('の技術')}`} disabled={disabled} maxLength={500} onChange={(event) => onChangeProject(project.draftId, 'technologies', event.target.value)} onFocus={() => mapping && selectMapping(mapping)} value={project.technologies} /></label>
              <label className="is-wide">{t('担当内容')}<textarea aria-label={`${t('プロジェクト')} ${index + 1} ${t('の担当内容')}`} disabled={disabled} maxLength={1500} onChange={(event) => onChangeProject(project.draftId, 'summary', event.target.value)} onFocus={() => mapping && selectMapping(mapping)} rows={6} value={project.summary} /></label>
            </div>
          </article>
        })}</div></section> : null}
        {selectedMapping ? <div className="original-document-selection"><span>{t('現在の確認項目')}</span><strong>{t(selectedMapping.label)}</strong><p>{selectedMapping.value || t('未設定')}</p><small>{selectedMapping.sourceLabels.length ? summarizeSourceLabels(selectedMapping.sourceLabels, locale) : t('原本で確認して必要に応じてプロフィールを編集してください。')}</small></div> : null}
      </aside>
    </div> : null}

    <footer className="original-document-security"><Icon name="shield" size={14} /><span><strong>{t('原始ファイルは端末内でのみ復号')}</strong>{t('Cloud AIには送信しません。システムアプリ用の一時コピーは自動削除します。')}</span></footer>
  </div>
}
