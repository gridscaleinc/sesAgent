import { useMemo, useState } from 'react'
import type {
  CandidateFieldKey,
  CandidateProjectReviewSnapshot,
  CandidateReviewSnapshot,
  ResumeAnalysisSummary,
  SubmitCandidateReviewInput,
  SubmitCandidateReviewResult
} from '@shared'
import { Icon } from './Icon'
import { useRendererUiRefresh, useUiLocale } from '../i18n'
import { summarizeSourceLabels } from '../source-evidence'

interface CandidateReviewPanelProps {
  analysis: ResumeAnalysisSummary
  review: CandidateReviewSnapshot
  onSubmit(input: SubmitCandidateReviewInput): Promise<SubmitCandidateReviewResult>
}

function normalizeValue(value: string): string | null {
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function sourceMarker(label: string): string {
  const page = label.match(/^Page (\d+)$/)
  if (page?.[1]) return `[PAGE:${page[1]}]`
  const paragraph = label.match(/^Paragraph (\d+)$/)
  if (paragraph?.[1]) return `[PARAGRAPH:${paragraph[1]}]`
  return `[SHEET:${label}]`
}

interface EditableProjectExperience extends Omit<CandidateProjectReviewSnapshot, 'technologies'> {
  technologies: string
}

function editableProject(project: CandidateProjectReviewSnapshot): EditableProjectExperience {
  return { ...project, technologies: project.technologies.join(', ') }
}

function projectTechnologies(value: string): string[] {
  return [...new Set(value.split(/[,、/]/u).map((item) => item.trim()).filter(Boolean))].slice(0, 40)
}

function projectComparable(project: EditableProjectExperience) {
  return {
    draftId: project.draftId,
    title: project.title.trim(),
    period: normalizeValue(project.period ?? ''),
    role: normalizeValue(project.role ?? ''),
    technologies: projectTechnologies(project.technologies),
    summary: project.summary.trim()
  }
}

function SourceTechnicalDetails({ labels, locale }: { labels: string[]; locale: 'ja-JP' | 'zh-CN' }) {
  return labels.length > 0 ? (
    <details className="source-technical-details">
      <summary>{locale === 'zh-CN' ? '查看技术坐标' : '技術座標を表示'}</summary>
      <code>{labels.join(' · ')}</code>
    </details>
  ) : null
}

export function CandidateReviewPanel({ analysis, review, onSubmit }: CandidateReviewPanelProps) {
  useRendererUiRefresh()
  const locale = useUiLocale()
  const [values, setValues] = useState<Record<CandidateFieldKey, string>>(() =>
    Object.fromEntries(review.fields.map((field) => [field.key, field.value ?? ''])) as Record<CandidateFieldKey, string>
  )
  const [reasons, setReasons] = useState<Partial<Record<CandidateFieldKey, string>>>({})
  const [confirmedKeys, setConfirmedKeys] = useState<Set<CandidateFieldKey>>(() => new Set())
  const [projects, setProjects] = useState<EditableProjectExperience[]>(() => review.projectExperiences.map(editableProject))
  const [confirmedProjectIds, setConfirmedProjectIds] = useState<Set<string>>(() => new Set())
  const [projectChangeReason, setProjectChangeReason] = useState('')
  const [selectedKey, setSelectedKey] = useState<CandidateFieldKey>(review.fields[0]?.key ?? 'skills')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedField = review.fields.find((field) => field.key === selectedKey) ?? review.fields[0]
  const evidenceLines = useMemo(() => {
    if (!selectedField || selectedField.sourceLabels.length === 0) return []
    const markers = selectedField.sourceLabels.map(sourceMarker)
    return analysis.redactedPreview
      .split('\n')
      .filter((line) => markers.some((marker) => line.startsWith(marker)))
      .map((line) => `• ${line.replace(/^\[[^\]]+\]\s*/u, '')}`)
  }, [analysis.redactedPreview, selectedField])
  const localIdentityPanel = review.localIdentity?.displayName ? (
    <div className="candidate-local-identity">
      <span><Icon name="lock" size={15} /></span>
      <div>
        <small>ローカル本人情報</small>
        <strong>{review.localIdentity.displayName}</strong>
        <p>暗号化して端末内だけに保存 · Cloud / AIへ送信しません</p>
      </div>
    </div>
  ) : null

  if (review.status === 'completed') {
    return (
      <section className="candidate-review-card is-completed" aria-label={`${review.fileName} の確認済み候補者プロフィール`}>
        <div className="candidate-review-heading">
          <div><Icon name="check" size={17} /><h3>候補者プロフィール確認済み</h3></div>
          <span>Profile v{review.profile?.version ?? 1}</span>
        </div>
        <p>{review.fileName} · {review.reviewerDisplayName} · {review.completedAt ? new Date(review.completedAt).toLocaleString(locale) : ''}</p>
        {localIdentityPanel}
        <div className="anonymous-profile-id">
          <span>匿名候補者ID</span>
          <strong>C-{review.profile?.id.slice(0, 8).toUpperCase() ?? 'UNKNOWN'}</strong>
          <small>暗号化ローカル候補者管理に保存</small>
        </div>
        <dl className="confirmed-field-list">
          {review.fields.map((field) => (
            <div key={field.key}>
              <dt>{field.label}</dt>
              <dd>{field.value ?? '未設定'}</dd>
              <small>{summarizeSourceLabels(field.sourceLabels, locale)}{field.changed ? ` · 修正理由: ${field.changeReason}` : ' · 原値を確認'}</small>
              <SourceTechnicalDetails labels={field.sourceLabels} locale={locale} />
            </div>
          ))}
        </dl>
        <div className="confirmed-project-list">
          <h4>確認済みプロジェクト経験</h4>
          {review.projectExperiences.length === 0 ? <p>プロジェクト経験は登録されていません。</p> : review.projectExperiences.map((project, index) => (
            <article key={project.draftId}>
              <strong>{project.title}</strong>
              <span>{[project.period, project.role].filter(Boolean).join(' · ') || '期間・役割未設定'}</span>
              <p>{project.summary}</p>
              <small>{project.technologies.join(' · ') || '技術未設定'} · {summarizeSourceLabels(project.sourceLabels, locale, { projectIndex: index + 1 })}</small>
              <SourceTechnicalDetails labels={project.sourceLabels} locale={locale} />
            </article>
          ))}
        </div>
      </section>
    )
  }

  const changedKeys = new Set(
    review.fields
      .filter((field) => normalizeValue(values[field.key]) !== field.originalValue)
      .map((field) => field.key)
  )
  const originalProjects = new Map(review.projectExperiences.map((project) => [project.draftId, editableProject(project)]))
  const projectsChanged = projects.length !== review.projectExperiences.length || projects.some((project) => {
    const original = originalProjects.get(project.draftId)
    return !original || JSON.stringify(projectComparable(project)) !== JSON.stringify(projectComparable(original))
  })
  const projectsComplete = projects.every((project) => project.title.trim().length > 0 && project.summary.trim().length > 0)
  const ready = projectsComplete && !submitting

  const confirmHighConfidence = () => {
    setConfirmedKeys((current) => {
      const next = new Set(current)
      for (const field of review.fields) {
        if (field.confidence >= 0.8 && field.originalValue !== null) next.add(field.key)
      }
      return next
    })
    setConfirmedProjectIds((current) => {
      const next = new Set(current)
      for (const project of projects) if (project.confidence >= 0.8) next.add(project.draftId)
      return next
    })
  }

  const submit = async () => {
    if (!ready) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        documentId: review.documentId,
        reviewRevision: review.reviewRevision,
        piiReviewed: review.piiReviewed,
        fields: review.fields.map((field) => ({
          key: field.key,
          value: normalizeValue(values[field.key]),
          confirmed: true,
          ...(changedKeys.has(field.key) && reasons[field.key]?.trim() ? { changeReason: reasons[field.key]?.trim() } : {})
        })),
        projectExperiences: projects.map((project) => ({
          ...projectComparable(project),
          confirmed: true as const
        })),
        ...(projectsChanged && projectChangeReason.trim() ? { projectChangeReason: projectChangeReason.trim() } : {})
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '候補者プロフィールを確認できませんでした。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="candidate-review-card" aria-label={`${review.fileName} の候補者フィールド確認`}>
      <div className="candidate-review-heading">
        <div><Icon name="file" size={17} /><h3>候補者フィールド確認</h3></div>
        <span>改訂 {review.reviewRevision}</span>
      </div>
      <p>{review.fileName} · すべての項目は任意です。現在の内容のままローカル候補者プロフィールを確認できます。</p>
      {localIdentityPanel}
      <p className="candidate-review-policy">本人情報を含む履歴書データは暗号化して端末内へ保存します。Cloud AIを利用する場合だけ、送信前にローカルで脱敏します。</p>

      <div className="candidate-review-toolbar">
        <span>{confirmedKeys.size}/{review.fields.length} 項目を任意確認</span>
        <button onClick={confirmHighConfidence} type="button">高信頼度を一括確認</button>
      </div>

      <div className="candidate-review-fields">
        {review.fields.map((field) => {
          const changed = changedKeys.has(field.key)
          return (
            <article className={selectedKey === field.key ? 'is-selected' : undefined} key={field.key}>
              <button className="field-source-button" onClick={() => setSelectedKey(field.key)} type="button">
                <span>{field.label}</span>
                <small>{summarizeSourceLabels(field.sourceLabels, locale)} · {Math.round(field.confidence * 100)}%</small>
              </button>
              <input
                aria-label={`${field.label} の確認値`}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                placeholder="未検出（空欄のまま確認可）"
                value={values[field.key]}
              />
              {changed ? (
                <input
                  aria-label={`${field.label} の修正メモ`}
                  className="change-reason-input"
                  onChange={(event) => setReasons((current) => ({ ...current, [field.key]: event.target.value }))}
                  placeholder="修正メモ（任意）"
                  value={reasons[field.key] ?? ''}
                />
              ) : null}
              <label>
                <input
                  checked={confirmedKeys.has(field.key)}
                  onChange={(event) => setConfirmedKeys((current) => {
                    const next = new Set(current)
                    if (event.target.checked) next.add(field.key)
                    else next.delete(field.key)
                    return next
                  })}
                  type="checkbox"
                />
                確認済みとしてマーク（任意）
              </label>
            </article>
          )
        })}
      </div>

      <div className="candidate-project-review">
        <div className="candidate-project-review-heading">
          <div><strong>プロジェクト経験</strong><span>{confirmedProjectIds.size}/{projects.length} 件確認済み</span></div>
          <button onClick={() => setProjects((current) => [...current, {
            draftId: `manual-${crypto.randomUUID()}`,
            title: '',
            period: null,
            role: null,
            technologies: '',
            summary: '',
            confidence: 0,
            sourceLabels: [],
            changed: true,
            changeReason: null
          }])} type="button">経験を追加</button>
        </div>
        {projects.length === 0 ? <p className="candidate-project-empty">自動検出されたプロジェクト経験はありません。必要な場合はHRが追加してください。</p> : null}
        {projects.map((project, index) => (
          <article key={project.draftId}>
            <header><strong>プロジェクト {index + 1}</strong><span>{summarizeSourceLabels(project.sourceLabels, locale, { projectIndex: index + 1 })}</span><button onClick={() => {
              setProjects((current) => current.filter((item) => item.draftId !== project.draftId))
              setConfirmedProjectIds((current) => {
                const next = new Set(current)
                next.delete(project.draftId)
                return next
              })
            }} type="button">削除</button></header>
            <div className="candidate-project-grid">
              <label>案件・プロジェクト名<input aria-label={`プロジェクト ${index + 1} の名称`} onChange={(event) => setProjects((current) => current.map((item) => item.draftId === project.draftId ? { ...item, title: event.target.value } : item))} value={project.title} /></label>
              <label>期間<input aria-label={`プロジェクト ${index + 1} の期間`} onChange={(event) => setProjects((current) => current.map((item) => item.draftId === project.draftId ? { ...item, period: event.target.value } : item))} value={project.period ?? ''} /></label>
              <label>役割<input aria-label={`プロジェクト ${index + 1} の役割`} onChange={(event) => setProjects((current) => current.map((item) => item.draftId === project.draftId ? { ...item, role: event.target.value } : item))} value={project.role ?? ''} /></label>
              <label>技術（カンマ区切り）<input aria-label={`プロジェクト ${index + 1} の技術`} onChange={(event) => setProjects((current) => current.map((item) => item.draftId === project.draftId ? { ...item, technologies: event.target.value } : item))} value={project.technologies} /></label>
            </div>
            <label>担当内容<textarea aria-label={`プロジェクト ${index + 1} の担当内容`} maxLength={1500} onChange={(event) => setProjects((current) => current.map((item) => item.draftId === project.draftId ? { ...item, summary: event.target.value } : item))} value={project.summary} /></label>
            <label className="candidate-project-confirm"><input checked={confirmedProjectIds.has(project.draftId)} onChange={(event) => setConfirmedProjectIds((current) => {
              const next = new Set(current)
              if (event.target.checked) next.add(project.draftId)
              else next.delete(project.draftId)
              return next
            })} type="checkbox" />確認済みとしてマーク（任意）</label>
            <SourceTechnicalDetails labels={project.sourceLabels} locale={locale} />
          </article>
        ))}
        {projectsChanged ? <label className="candidate-project-change-reason">プロジェクト経験の変更メモ（任意）<input aria-label="プロジェクト経験の変更メモ（任意）" onChange={(event) => setProjectChangeReason(event.target.value)} placeholder="変更内容のメモ（任意）" value={projectChangeReason} /></label> : null}
      </div>

      <div className="source-evidence-panel" aria-live="polite">
        <div><Icon name="search" size={14} /><strong>{selectedField?.label ?? '出典'}の脱敏済み出典</strong></div>
        {selectedField?.sourceLabels.length ? <span>{summarizeSourceLabels(selectedField.sourceLabels, locale)}</span> : null}
        <SourceTechnicalDetails labels={selectedField?.sourceLabels ?? []} locale={locale} />
        <pre>{evidenceLines.length > 0 ? evidenceLines.join('\n') : 'このフィールドには自動検出された出典がありません。原文を確認して手入力してください。'}</pre>
      </div>

      {error ? <div className="inline-error"><Icon name="alert" size={16} /> {error}</div> : null}
      <button className="confirm-profile-button" disabled={!ready} onClick={() => void submit()} type="button">
        <Icon name="check" size={16} /> {submitting ? '保存中…' : '現在の内容で候補者プロフィールを確認'}
      </button>
    </section>
  )
}
