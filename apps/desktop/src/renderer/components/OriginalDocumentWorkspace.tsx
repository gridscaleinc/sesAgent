import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type {
  CandidateFieldKey,
  CandidateProfileSearchResult,
  LocalCandidatePersonalFieldKey,
  OriginalDocumentPreview,
  OriginalDocumentPreviewSheet,
  UpdateCandidateProfileInput,
  UpdateCandidateProfileResult
} from '@shared'
import { candidateWorkAuthorizationValues, localCandidatePersonalFieldKeys } from '@shared'
import { localizedIpcError, useUiLocale, useUiText } from '../i18n'
import { summarizeSourceLabels } from '../source-evidence'
import { Icon } from './Icon'

interface OriginalDocumentWorkspaceProps {
  candidate: CandidateProfileSearchResult
  onLoad(sourceDocumentId: string): Promise<OriginalDocumentPreview>
  onOpen(sourceDocumentId: string): Promise<unknown>
  onUpdate(input: UpdateCandidateProfileInput): Promise<UpdateCandidateProfileResult>
}

interface SourceMapping {
  id: string
  group: 'personal' | 'profile' | 'project'
  label: string
  value: string | null
  sourceLabels: string[]
  key?: LocalCandidatePersonalFieldKey | CandidateFieldKey
  projectId?: string
}

interface EditableProject {
  id: string
  title: string
  period: string
  role: string
  technologies: string
  summary: string
}

interface CandidateProfileDraft {
  identity: Record<LocalCandidatePersonalFieldKey, string>
  fields: Record<CandidateFieldKey, string>
  projects: EditableProject[]
}

interface CellPosition {
  row: number
  column: number
}

interface CellRange {
  startRow: number
  endRow: number
  startColumn: number
  endColumn: number
}

const compareDividerWidth = 16
const preferredViewerMinimum = 360
const preferredProfileMinimum = 300
const defaultViewerFraction = 1.65 / (1.65 + 0.85)

const identityInputMaximums: Record<LocalCandidatePersonalFieldKey, number> = {
  displayName: 120,
  gender: 40,
  birthDate: 80,
  nationality: 80,
  phone: 80,
  email: 200,
  address: 500,
  education: 300,
  major: 200,
  graduationDate: 80,
  degree: 120
}

const personalLabels: Record<LocalCandidatePersonalFieldKey, string> = {
  displayName: '姓名',
  gender: '性別',
  birthDate: '生年月',
  nationality: '国籍',
  phone: '電話番号',
  email: 'メールアドレス',
  address: '住所・最寄り駅',
  education: '学校名・最終学歴',
  major: '専攻',
  graduationDate: '卒業年月',
  degree: '学位'
}

function spreadsheetColumnNumber(label: string): number {
  return [...label].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0)
}

function spreadsheetColumnLabel(column: number): string {
  let value = column
  let label = ''
  while (value > 0) {
    value -= 1
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26)
  }
  return label
}

function cellPosition(value: string): CellPosition | null {
  const match = value.match(/^([A-Z]{1,3})([1-9]\d*)$/u)
  return match?.[1] && match[2]
    ? { row: Number(match[2]), column: spreadsheetColumnNumber(match[1]) }
    : null
}

function cellRange(value: string | null): CellRange | null {
  const match = value?.match(/^([A-Z]{1,3})([1-9]\d*):([A-Z]{1,3})([1-9]\d*)$/u)
  return match?.[1] && match[2] && match[3] && match[4]
    ? {
        startRow: Number(match[2]),
        endRow: Number(match[4]),
        startColumn: spreadsheetColumnNumber(match[1]),
        endColumn: spreadsheetColumnNumber(match[3])
      }
    : null
}

function sourceCell(value: string): { sheet: string; address: string } | null {
  const match = value.match(/^(.+)!([A-Z]{1,3}[1-9]\d*)$/u)
  return match?.[1] && match[2] ? { sheet: match[1], address: match[2] } : null
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function toProfileDraft(candidate: CandidateProfileSearchResult): CandidateProfileDraft {
  return {
    identity: {
      displayName: candidate.localIdentity?.displayName ?? '',
      gender: candidate.localIdentity?.gender ?? '',
      birthDate: candidate.localIdentity?.birthDate ?? '',
      nationality: candidate.localIdentity?.nationality ?? '',
      phone: candidate.localIdentity?.phone ?? '',
      email: candidate.localIdentity?.email ?? '',
      address: candidate.localIdentity?.address ?? '',
      education: candidate.localIdentity?.education ?? '',
      major: candidate.localIdentity?.major ?? '',
      graduationDate: candidate.localIdentity?.graduationDate ?? '',
      degree: candidate.localIdentity?.degree ?? ''
    },
    fields: Object.fromEntries(candidate.fields.map((field) => [field.key, field.value ?? ''])) as Record<CandidateFieldKey, string>,
    projects: candidate.projectExperiences.map((project) => ({
      id: project.id,
      title: project.title,
      period: project.period ?? '',
      role: project.role ?? '',
      technologies: project.technologies.join(', '),
      summary: project.summary
    }))
  }
}

function draftFingerprint(draft: CandidateProfileDraft): string {
  return JSON.stringify(draft)
}

function normalizedValue(value: string): string | null {
  return value.trim() || null
}

function canSaveDraft(draft: CandidateProfileDraft): boolean {
  return draft.projects.every((project) => project.title.trim().length > 0 && project.summary.trim().length > 0)
}

function toProfileUpdateInput(
  candidate: CandidateProfileSearchResult,
  draft: CandidateProfileDraft,
  expectedVersion: number
): UpdateCandidateProfileInput {
  return {
    sourceDocumentId: candidate.sourceDocumentId,
    expectedVersion,
    identity: Object.fromEntries(localCandidatePersonalFieldKeys.map((key) => [key, normalizedValue(draft.identity[key])])) as UpdateCandidateProfileInput['identity'],
    fields: candidate.fields.map((field) => ({ key: field.key, value: normalizedValue(draft.fields[field.key] ?? '') })),
    projectExperiences: draft.projects.map((project) => ({
      id: project.id,
      title: project.title.trim(),
      period: normalizedValue(project.period),
      role: normalizedValue(project.role),
      technologies: [...new Set(project.technologies.split(/[,、/]/u).map((item) => item.trim()).filter(Boolean))].slice(0, 40),
      summary: project.summary.trim()
    }))
  }
}

export function SpreadsheetPreview({
  search,
  selectedSources,
  sheet,
  zoom
}: {
  search: string
  selectedSources: string[]
  sheet: OriginalDocumentPreviewSheet
  zoom: number
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const model = useMemo(() => {
    const positions = sheet.cells.flatMap((cell) => {
      const position = cellPosition(cell.address)
      return position ? [{ cell, position }] : []
    })
    const printRange = cellRange(sheet.printArea)
    const startColumn = printRange?.startColumn ?? Math.min(...positions.map((item) => item.position.column), 1)
    const visibleColumnEnd = printRange?.endColumn ?? Math.max(...positions.map((item) => item.position.column), startColumn)
    const endColumn = Math.min(visibleColumnEnd, startColumn + 59)
    const startRow = printRange?.startRow ?? Math.min(...positions.map((item) => item.position.row), 1)
    const populatedEndRow = Math.max(
      ...positions.filter((item) => item.position.column >= startColumn && item.position.column <= endColumn).map((item) => item.position.row),
      startRow
    )
    const endRow = Math.min(Math.max(printRange?.endRow ?? startRow, populatedEndRow), startRow + 299)
    const cells = new Map(positions.map((item) => [`${item.position.row}:${item.position.column}`, item.cell]))
    const merged = new Map<string, CellRange>()
    for (const item of positions) {
      const range = cellRange(item.cell.mergedRange)
      if (range) merged.set(`${range.startRow}:${range.startColumn}`, range)
    }
    const covered = new Set<string>()
    for (const range of merged.values()) {
      for (let row = range.startRow; row <= Math.min(range.endRow, endRow); row += 1) {
        for (let column = range.startColumn; column <= Math.min(range.endColumn, endColumn); column += 1) {
          if (row !== range.startRow || column !== range.startColumn) covered.add(`${row}:${column}`)
        }
      }
    }
    return { cells, covered, endColumn, endRow, merged, startColumn, startRow }
  }, [sheet])
  const selectedAddresses = useMemo(() => new Set(selectedSources.flatMap((source) => {
    const parsed = sourceCell(source)
    return parsed?.sheet === sheet.name ? [parsed.address] : []
  })), [selectedSources, sheet.name])
  const normalizedSearch = search.normalize('NFKC').trim().toLocaleLowerCase('ja-JP')

  useEffect(() => {
    const selected = scrollRef.current?.querySelector<HTMLElement>('[data-source-selected="true"]')
    if (selected && typeof selected.scrollIntoView === 'function') {
      selected.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    }
  }, [selectedSources, sheet.name])

  return <div className="original-sheet-scroll" ref={scrollRef}>
    <div className="original-sheet-scale" style={{ fontSize: `${zoom / 100}em` }}>
      <table aria-label={sheet.name} className="original-sheet-table">
        <thead><tr><th className="is-corner" />{Array.from({ length: model.endColumn - model.startColumn + 1 }, (_, index) => <th key={index}>{spreadsheetColumnLabel(model.startColumn + index)}</th>)}</tr></thead>
        <tbody>{Array.from({ length: model.endRow - model.startRow + 1 }, (_, rowIndex) => {
          const row = model.startRow + rowIndex
          return <tr key={row}><th>{row}</th>{Array.from({ length: model.endColumn - model.startColumn + 1 }, (_, columnIndex) => {
            const column = model.startColumn + columnIndex
            const coordinate = `${row}:${column}`
            if (model.covered.has(coordinate)) return null
            const cell = model.cells.get(coordinate)
            const range = model.merged.get(coordinate)
            const address = `${spreadsheetColumnLabel(column)}${row}`
            const selected = selectedAddresses.has(address)
            const matches = Boolean(normalizedSearch && cell?.text.normalize('NFKC').toLocaleLowerCase('ja-JP').includes(normalizedSearch))
            return <td
              className={`${selected ? 'is-source-selected ' : ''}${matches ? 'is-search-match' : ''}`.trim() || undefined}
              colSpan={range ? Math.max(1, Math.min(range.endColumn, model.endColumn) - column + 1) : undefined}
              data-address={address}
              data-source-selected={selected ? 'true' : undefined}
              key={coordinate}
              rowSpan={range ? Math.max(1, Math.min(range.endRow, model.endRow) - row + 1) : undefined}
              title={cell ? `${sheet.name}!${address}` : undefined}
            >{cell?.text ?? ''}</td>
          })}</tr>
        })}</tbody>
      </table>
    </div>
  </div>
}

export function OriginalDocumentWorkspace({ candidate, onLoad, onOpen, onUpdate }: OriginalDocumentWorkspaceProps) {
  const locale = useUiLocale()
  const t = useUiText()
  const [preview, setPreview] = useState<OriginalDocumentPreview | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [selectedMappingId, setSelectedMappingId] = useState<string | null>(null)
  const [selectedSheet, setSelectedSheet] = useState('')
  const [search, setSearch] = useState('')
  const [zoom, setZoom] = useState(90)
  const [opening, setOpening] = useState(false)
  const [openNotice, setOpenNotice] = useState<string | null>(null)
  const [viewerWidth, setViewerWidth] = useState<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [draft, setDraft] = useState<CandidateProfileDraft>(() => toProfileDraft(candidate))
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle')
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null)
  const compareRef = useRef<HTMLDivElement>(null)
  const pendingViewerWidthRef = useRef<number | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const draftRef = useRef(draft)
  const lastSavedDraftRef = useRef(draftFingerprint(draft))
  const profileVersionRef = useRef(candidate.version)
  const autoSaveTimerRef = useRef<number | null>(null)
  const autoSaveInFlightRef = useRef(false)
  const autoSaveQueuedRef = useRef(false)

  useEffect(() => {
    let active = true
    setStatus('loading')
    setError(null)
    void onLoad(candidate.sourceDocumentId).then((result) => {
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
  }, [candidate.sourceDocumentId, locale, onLoad])

  useEffect(() => () => {
    if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current)
  }, [])

  useEffect(() => () => {
    if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current)
  }, [])

  useEffect(() => {
    if (candidate.version === profileVersionRef.current) return
    if (draftFingerprint(draftRef.current) !== lastSavedDraftRef.current) {
      setAutoSaveStatus('error')
      setAutoSaveError(t('プロフィールが別の場所で更新されました。ページを開き直してから編集してください。'))
      return
    }
    const nextDraft = toProfileDraft(candidate)
    draftRef.current = nextDraft
    lastSavedDraftRef.current = draftFingerprint(nextDraft)
    profileVersionRef.current = candidate.version
    setDraft(nextDraft)
    setAutoSaveError(null)
    setAutoSaveStatus('idle')
  }, [candidate, candidate.version, t])

  const mappings = useMemo<SourceMapping[]>(() => {
    const personal = localCandidatePersonalFieldKeys.map((key) => ({
      id: `personal:${key}`,
      group: 'personal' as const,
      label: personalLabels[key],
      value: draft.identity[key] || null,
      sourceLabels: preview?.personalFieldSources[key] ?? [],
      key
    }))
    const profile = candidate.fields.map((field) => ({
      id: `profile:${field.key}`,
      group: 'profile' as const,
      label: field.label,
      value: draft.fields[field.key] || null,
      sourceLabels: field.sourceLabels,
      key: field.key
    }))
    const projects = candidate.projectExperiences.map((project, index) => {
      const draftProject = draft.projects.find((item) => item.id === project.id)
      return {
      id: `project:${project.id}`,
      group: 'project' as const,
      label: draftProject?.title || `${t('プロジェクト')} ${index + 1}`,
      value: [draftProject?.period, draftProject?.role, draftProject?.summary].filter(Boolean).join(' · ') || null,
      sourceLabels: project.sourceLabels,
      projectId: project.id
      }
    })
    return [...personal, ...profile, ...projects]
  }, [candidate.fields, candidate.projectExperiences, draft, preview?.personalFieldSources, t])
  const selectedMapping = mappings.find((mapping) => mapping.id === selectedMappingId) ?? mappings.find((mapping) => mapping.sourceLabels.length > 0) ?? mappings[0]
  const activeSheet = preview?.sheets.find((sheet) => sheet.name === selectedSheet) ?? preview?.sheets[0]

  const selectMapping = (mapping: SourceMapping) => {
    setSelectedMappingId(mapping.id)
    const source = mapping.sourceLabels.map(sourceCell).find((item) => item !== null)
    if (source && preview?.sheets.some((sheet) => sheet.name === source.sheet)) setSelectedSheet(source.sheet)
  }

  const openOriginal = async () => {
    if (opening) return
    setOpening(true)
    setOpenNotice(null)
    try {
      await onOpen(candidate.sourceDocumentId)
      setOpenNotice(t('システムアプリで原始ファイルを開きました。'))
    } catch (cause) {
      setError(localizedIpcError(locale, cause, '原始ファイルをシステムアプリで開けませんでした。'))
    } finally {
      setOpening(false)
    }
  }

  const persistDraft = async (draftToSave: CandidateProfileDraft) => {
    const fingerprint = draftFingerprint(draftToSave)
    if (fingerprint === lastSavedDraftRef.current) {
      setAutoSaveStatus('saved')
      return
    }
    if (!canSaveDraft(draftToSave)) {
      setAutoSaveStatus('error')
      setAutoSaveError(t('プロジェクトの名称と担当内容は必須です。'))
      return
    }
    if (autoSaveInFlightRef.current) {
      autoSaveQueuedRef.current = true
      return
    }
    autoSaveInFlightRef.current = true
    setAutoSaveStatus('saving')
    setAutoSaveError(null)
    try {
      const result = await onUpdate(toProfileUpdateInput(candidate, draftToSave, profileVersionRef.current))
      const savedFingerprint = draftFingerprint(draftToSave)
      profileVersionRef.current = result.candidate.version
      lastSavedDraftRef.current = savedFingerprint
      if (draftFingerprint(draftRef.current) === savedFingerprint) {
        const normalizedDraft = toProfileDraft(result.candidate)
        draftRef.current = normalizedDraft
        lastSavedDraftRef.current = draftFingerprint(normalizedDraft)
        setDraft(normalizedDraft)
        setAutoSaveStatus('saved')
      } else {
        setAutoSaveStatus('pending')
        autoSaveQueuedRef.current = true
      }
    } catch (cause) {
      setAutoSaveStatus('error')
      setAutoSaveError(localizedIpcError(locale, cause, '人材プロフィールを保存できませんでした。'))
    } finally {
      autoSaveInFlightRef.current = false
      if (autoSaveQueuedRef.current) {
        autoSaveQueuedRef.current = false
        const latestDraft = draftRef.current
        const latestFingerprint = draftFingerprint(latestDraft)
        if (latestFingerprint !== lastSavedDraftRef.current) {
          if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current)
          autoSaveTimerRef.current = window.setTimeout(() => void persistDraft(latestDraft), 650)
        }
      }
    }
  }

  const queueAutoSave = (nextDraft: CandidateProfileDraft) => {
    draftRef.current = nextDraft
    setDraft(nextDraft)
    setAutoSaveError(null)
    if (draftFingerprint(nextDraft) === lastSavedDraftRef.current) {
      setAutoSaveStatus('saved')
      return
    }
    if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current)
    setAutoSaveStatus('pending')
    autoSaveTimerRef.current = window.setTimeout(() => void persistDraft(nextDraft), 650)
  }

  const updateIdentity = (key: LocalCandidatePersonalFieldKey, value: string) => {
    queueAutoSave({ ...draftRef.current, identity: { ...draftRef.current.identity, [key]: value } })
  }

  const updateField = (key: CandidateFieldKey, value: string) => {
    queueAutoSave({ ...draftRef.current, fields: { ...draftRef.current.fields, [key]: value } })
  }

  const updateProject = (projectId: string, key: Exclude<keyof EditableProject, 'id'>, value: string) => {
    queueAutoSave({
      ...draftRef.current,
      projects: draftRef.current.projects.map((project) => project.id === projectId ? { ...project, [key]: value } : project)
    })
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

  return <div className="original-document-workspace">
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
        <div className="original-document-viewer-heading"><div><span>{t('LOCAL ORIGINAL')}</span><strong>{preview.viewMode === 'spreadsheet' ? activeSheet?.name : preview.fileName}</strong></div><small>{selectedMapping?.sourceLabels.length ? summarizeSourceLabels(selectedMapping.sourceLabels, locale) : t('選択項目の自動出典なし')}</small></div>
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

      <aside className="original-document-profile" aria-label={t('標準人材プロフィール')}>
        <header><span>{t('STANDARD PROFILE')}</span><h2>{t('原本とプロフィールを照合')}</h2><p>{t('原本を見ながら右側の項目を直接修正できます。変更は端末内に自動保存され、履歴にも残ります。')}</p>
          {autoSaveStatus !== 'idle' ? <div aria-live="polite" className={`original-document-autosave is-${autoSaveStatus}`}>
            {autoSaveStatus === 'saving' ? <span className="matching-spinner" /> : <Icon name={autoSaveStatus === 'error' ? 'alert' : 'check'} size={13} />}
            <span>{autoSaveStatus === 'pending' ? t('自動保存待ち') : autoSaveStatus === 'saving' ? t('保存中…') : autoSaveStatus === 'error' ? t('自動保存に失敗しました。項目をもう一度変更して再試行してください。') : t('保存済み')}</span>
          </div> : null}
        </header>
        {(['personal', 'profile'] as const).map((group) => {
          const rows = mappings.filter((mapping) => mapping.group === group)
          if (rows.length === 0) return null
          return <section key={group}><h3>{group === 'personal' ? t('基本・本人情報') : t('人材プロフィール項目')}</h3><div className="original-document-editable-list">{rows.map((mapping) => {
            const key = mapping.key
            if (!key) return null
            const active = mapping.id === selectedMapping?.id
            if (group === 'personal') {
              const personalKey = key as LocalCandidatePersonalFieldKey
              return <label className={active ? 'is-active' : undefined} key={mapping.id} onClick={() => selectMapping(mapping)}>
                <span><strong>{t(mapping.label)}</strong><em className={mapping.sourceLabels.length ? undefined : 'is-missing'}>{mapping.sourceLabels.length ? `${mapping.sourceLabels.length}${t('件')}` : t('出典なし')}</em></span>
                <input aria-label={t(mapping.label)} maxLength={identityInputMaximums[personalKey]} onChange={(event) => updateIdentity(personalKey, event.target.value)} onFocus={() => selectMapping(mapping)} value={draft.identity[personalKey]} />
              </label>
            }
            const fieldKey = key as CandidateFieldKey
            return <label className={active ? 'is-active' : undefined} key={mapping.id} onClick={() => selectMapping(mapping)}>
              <span><strong>{t(mapping.label)}</strong><em className={mapping.sourceLabels.length ? undefined : 'is-missing'}>{mapping.sourceLabels.length ? `${mapping.sourceLabels.length}${t('件')}` : t('出典なし')}</em></span>
              {fieldKey === 'skills'
                ? <textarea aria-label={t(mapping.label)} maxLength={500} onChange={(event) => updateField(fieldKey, event.target.value)} onFocus={() => selectMapping(mapping)} rows={3} value={draft.fields[fieldKey] ?? ''} />
                : fieldKey === 'work_authorization'
                  ? <select aria-label={t(mapping.label)} onChange={(event) => updateField(fieldKey, event.target.value)} onFocus={() => selectMapping(mapping)} value={draft.fields[fieldKey] ?? ''}><option value="">{t('未設定')}</option>{candidateWorkAuthorizationValues.map((value) => <option key={value} value={value}>{t(value)}</option>)}</select>
                  : <input aria-label={t(mapping.label)} maxLength={500} onChange={(event) => updateField(fieldKey, event.target.value)} onFocus={() => selectMapping(mapping)} value={draft.fields[fieldKey] ?? ''} />}
            </label>
          })}</div></section>
        })}
        {draft.projects.length > 0 ? <section><h3>{t('プロジェクト経験')}</h3><div className="original-document-editable-projects">{draft.projects.map((project, index) => {
          const mapping = mappings.find((item) => item.group === 'project' && item.projectId === project.id)
          const active = mapping?.id === selectedMapping?.id
          return <article className={active ? 'is-active' : undefined} key={project.id}>
            <header><button onClick={() => mapping && selectMapping(mapping)} type="button"><span>PROJECT {String(index + 1).padStart(2, '0')}</span><em className={mapping?.sourceLabels.length ? undefined : 'is-missing'}>{mapping?.sourceLabels.length ? `${t('出典')} ${mapping.sourceLabels.length}${t('件')}` : t('出典なし')}</em></button></header>
            <div className="original-document-project-form">
              <label className="is-title">{t('案件・プロジェクト名')}<input aria-label={`${t('プロジェクト')} ${index + 1} ${t('の名称')}`} maxLength={160} onChange={(event) => updateProject(project.id, 'title', event.target.value)} onFocus={() => mapping && selectMapping(mapping)} value={project.title} /></label>
              <label>{t('期間')}<input aria-label={`${t('プロジェクト')} ${index + 1} ${t('の期間')}`} maxLength={120} onChange={(event) => updateProject(project.id, 'period', event.target.value)} onFocus={() => mapping && selectMapping(mapping)} value={project.period} /></label>
              <label>{t('役割')}<input aria-label={`${t('プロジェクト')} ${index + 1} ${t('の役割')}`} maxLength={120} onChange={(event) => updateProject(project.id, 'role', event.target.value)} onFocus={() => mapping && selectMapping(mapping)} value={project.role} /></label>
              <label className="is-wide">{t('技術（カンマ区切り）')}<input aria-label={`${t('プロジェクト')} ${index + 1} ${t('の技術')}`} maxLength={500} onChange={(event) => updateProject(project.id, 'technologies', event.target.value)} onFocus={() => mapping && selectMapping(mapping)} value={project.technologies} /></label>
              <label className="is-wide">{t('担当内容')}<textarea aria-label={`${t('プロジェクト')} ${index + 1} ${t('の担当内容')}`} maxLength={1500} onChange={(event) => updateProject(project.id, 'summary', event.target.value)} onFocus={() => mapping && selectMapping(mapping)} rows={6} value={project.summary} /></label>
            </div>
          </article>
        })}</div></section> : null}
        {autoSaveError ? <div className="original-document-autosave-error" role="alert"><Icon name="alert" size={14} />{autoSaveError}</div> : null}
        {selectedMapping ? <div className="original-document-selection"><span>{t('現在の確認項目')}</span><strong>{t(selectedMapping.label)}</strong><p>{selectedMapping.value || t('未設定')}</p><small>{selectedMapping.sourceLabels.length ? summarizeSourceLabels(selectedMapping.sourceLabels, locale) : t('原本で確認して必要に応じてプロフィールを編集してください。')}</small></div> : null}
      </aside>
    </div> : null}

    <footer className="original-document-security"><Icon name="shield" size={14} /><span><strong>{t('原始ファイルは端末内でのみ復号')}</strong>{t('Cloud AIには送信しません。システムアプリ用の一時コピーは自動削除します。')}</span></footer>
  </div>
}
