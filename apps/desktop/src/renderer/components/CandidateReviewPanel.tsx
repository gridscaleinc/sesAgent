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
import { localeText, localizedIpcError, useLocaleText, localizedCandidateFieldLabel } from '../i18n'
import { summarizeSourceLabels } from '../source-evidence'
import { formatTokyoDateTime } from '../format-time'

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
  return [
    ...new Set(
      value
        .split(/[,、/]/u)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ].slice(0, 40)
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
  const t = localeText(locale === 'zh-CN')
  return labels.length > 0 ? (
    <details className="source-technical-details">
      <summary>{t('查看技术坐标', '技術座標を表示')}</summary>
      <code>{labels.join(' · ')}</code>
    </details>
  ) : null
}

export function CandidateReviewPanel({ analysis, review, onSubmit }: CandidateReviewPanelProps) {
  const { locale, t } = useLocaleText()
  const [values, setValues] = useState<Record<CandidateFieldKey, string>>(
    () => Object.fromEntries(review.fields.map((field) => [field.key, field.value ?? ''])) as Record<CandidateFieldKey, string>
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
      <span>
        <Icon name="lock" size={15} />
      </span>
      <div>
        <small>{t('本地身份信息', 'ローカル本人情報')}</small>
        <strong>{review.localIdentity.displayName}</strong>
        <p>{t('加密后仅保存在本机 · 不会发送至云端或 AI', '暗号化して端末内だけに保存 · Cloud / AIへ送信しません')}</p>
      </div>
    </div>
  ) : null

  if (review.status === 'completed') {
    return (
      <section
        className="candidate-review-card is-completed"
        aria-label={t(`${review.fileName} 的已确认人员档案`, `${review.fileName} の確認済み候補者プロフィール`)}
      >
        <div className="candidate-review-heading">
          <div>
            <Icon name="check" size={17} />
            <h3>{t('人员档案已确认', '候補者プロフィール確認済み')}</h3>
          </div>
          <span>Profile v{review.profile?.version ?? 1}</span>
        </div>
        <p>
          {review.fileName} · {review.reviewerDisplayName} · {review.completedAt ? formatTokyoDateTime(locale, review.completedAt) : ''}
        </p>
        {localIdentityPanel}
        <div className="anonymous-profile-id">
          <span>{t('匿名人员 ID', '匿名候補者ID')}</span>
          <strong>C-{review.profile?.id.slice(0, 8).toUpperCase() ?? 'UNKNOWN'}</strong>
          <small>{t('保存在加密的本机人员库中', '暗号化ローカル候補者管理に保存')}</small>
        </div>
        <dl className="confirmed-field-list">
          {review.fields.map((field) => (
            <div key={field.key}>
              <dt>{localizedCandidateFieldLabel(locale, field)}</dt>
              <dd>{field.value ?? t('未设置', '未設定')}</dd>
              <small>
                {summarizeSourceLabels(field.sourceLabels, locale)}
                {field.changed
                  ? t(` · 修改原因：${field.changeReason}`, ` · 修正理由: ${field.changeReason}`)
                  : t(' · 查看原始值', ' · 原値を確認')}
              </small>
              <SourceTechnicalDetails labels={field.sourceLabels} locale={locale} />
            </div>
          ))}
        </dl>
        <div className="confirmed-project-list">
          <h4>{t('已确认项目经历', '確認済みプロジェクト経験')}</h4>
          {review.projectExperiences.length === 0 ? (
            <p>{t('尚未登记项目经历。', 'プロジェクト経験は登録されていません。')}</p>
          ) : (
            review.projectExperiences.map((project, index) => (
              <article key={project.draftId}>
                <strong>{project.title}</strong>
                <span>{[project.period, project.role].filter(Boolean).join(' · ') || t('期间/角色未设置', '期間・役割未設定')}</span>
                <p>{project.summary}</p>
                <small>
                  {project.technologies.join(' · ') || t('技术未设置', '技術未設定')} ·{' '}
                  {summarizeSourceLabels(project.sourceLabels, locale, { projectIndex: index + 1 })}
                </small>
                <SourceTechnicalDetails labels={project.sourceLabels} locale={locale} />
              </article>
            ))
          )}
        </div>
      </section>
    )
  }

  const changedKeys = new Set(
    review.fields.filter((field) => normalizeValue(values[field.key]) !== field.originalValue).map((field) => field.key)
  )
  const originalProjects = new Map(review.projectExperiences.map((project) => [project.draftId, editableProject(project)]))
  const projectsChanged =
    projects.length !== review.projectExperiences.length ||
    projects.some((project) => {
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
      setError(localizedIpcError(locale, cause, t('无法确认人员档案。', '候補者プロフィールを確認できませんでした。')))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section
      className="candidate-review-card"
      aria-label={t(`${review.fileName} 的人员字段确认`, `${review.fileName} の候補者フィールド確認`)}
    >
      <div className="candidate-review-heading">
        <div>
          <Icon name="file" size={17} />
          <h3>{t('人员字段确认', '候補者フィールド確認')}</h3>
        </div>
        <span>
          {t('修订', '改訂')} {review.reviewRevision}
        </span>
      </div>
      <p>
        {review.fileName} ·{' '}
        {t(
          '所有字段均为可选，可以按当前内容确认本机人员资料。',
          'すべての項目は任意です。現在の内容のままローカル候補者プロフィールを確認できます。'
        )}
      </p>
      {localIdentityPanel}
      <p className="candidate-review-policy">
        {t(
          '包含个人信息的简历数据会加密保存在本机；仅在使用云端 AI 时，才会在发送前于本机脱敏。',
          '本人情報を含む履歴書データは暗号化して端末内へ保存します。Cloud AIを利用する場合だけ、送信前にローカルで脱敏します。'
        )}
      </p>

      <div className="candidate-review-toolbar">
        <span>
          {confirmedKeys.size}/{review.fields.length} {t('项可选确认', '項目を任意確認')}
        </span>
        <button onClick={confirmHighConfidence} type="button">
          {t('批量确认高置信度项', '高信頼度を一括確認')}
        </button>
      </div>

      <div className="candidate-review-fields">
        {review.fields.map((field) => {
          const changed = changedKeys.has(field.key)
          return (
            <article className={selectedKey === field.key ? 'is-selected' : undefined} key={field.key}>
              <button className="field-source-button" onClick={() => setSelectedKey(field.key)} type="button">
                <span>{localizedCandidateFieldLabel(locale, field)}</span>
                <small>
                  {summarizeSourceLabels(field.sourceLabels, locale)} · {Math.round(field.confidence * 100)}%
                </small>
              </button>
              <input
                aria-label={t(`${localizedCandidateFieldLabel(locale, field)} 的确认值`, `${field.label} の確認値`)}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                placeholder={t('未检测到（可保持为空确认）', '未検出（空欄のまま確認可）')}
                value={values[field.key]}
              />
              {changed ? (
                <input
                  aria-label={t(`${localizedCandidateFieldLabel(locale, field)} 的修改备注`, `${field.label} の修正メモ`)}
                  className="change-reason-input"
                  onChange={(event) => setReasons((current) => ({ ...current, [field.key]: event.target.value }))}
                  placeholder={t('修改备注（可选）', '修正メモ（任意）')}
                  value={reasons[field.key] ?? ''}
                />
              ) : null}
              <label>
                <input
                  checked={confirmedKeys.has(field.key)}
                  onChange={(event) =>
                    setConfirmedKeys((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(field.key)
                      else next.delete(field.key)
                      return next
                    })
                  }
                  type="checkbox"
                />
                {t('标记为已核对（可选）', '確認済みとしてマーク（任意）')}
              </label>
            </article>
          )
        })}
      </div>

      <div className="candidate-project-review">
        <div className="candidate-project-review-heading">
          <div>
            <strong>{t('项目经历', 'プロジェクト経験')}</strong>
            <span>
              {confirmedProjectIds.size}/{projects.length} {t('项已确认', '件確認済み')}
            </span>
          </div>
          <button
            onClick={() =>
              setProjects((current) => [
                ...current,
                {
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
                }
              ])
            }
            type="button"
          >
            {t('添加经历', '経験を追加')}
          </button>
        </div>
        {projects.length === 0 ? (
          <p className="candidate-project-empty">
            {t(
              '没有自动检测到的项目经历，必要时请由 HR 添加。',
              '自動検出されたプロジェクト経験はありません。必要な場合はHRが追加してください。'
            )}
          </p>
        ) : null}
        {projects.map((project, index) => (
          <article key={project.draftId}>
            <header>
              <strong>
                {t('项目', 'プロジェクト')} {index + 1}
              </strong>
              <span>{summarizeSourceLabels(project.sourceLabels, locale, { projectIndex: index + 1 })}</span>
              <button
                onClick={() => {
                  setProjects((current) => current.filter((item) => item.draftId !== project.draftId))
                  setConfirmedProjectIds((current) => {
                    const next = new Set(current)
                    next.delete(project.draftId)
                    return next
                  })
                }}
                type="button"
              >
                {t('删除', '削除')}
              </button>
            </header>
            <div className="candidate-project-grid">
              <label>
                {t('案件/项目名称', '案件・プロジェクト名')}
                <input
                  aria-label={t(`项目 ${index + 1} 的名称`, `プロジェクト ${index + 1} の名称`)}
                  onChange={(event) =>
                    setProjects((current) =>
                      current.map((item) => (item.draftId === project.draftId ? { ...item, title: event.target.value } : item))
                    )
                  }
                  value={project.title}
                />
              </label>
              <label>
                {t('期间', '期間')}
                <input
                  aria-label={t(`项目 ${index + 1} 的期间`, `プロジェクト ${index + 1} の期間`)}
                  onChange={(event) =>
                    setProjects((current) =>
                      current.map((item) => (item.draftId === project.draftId ? { ...item, period: event.target.value } : item))
                    )
                  }
                  value={project.period ?? ''}
                />
              </label>
              <label>
                {t('角色', '役割')}
                <input
                  aria-label={t(`项目 ${index + 1} 的角色`, `プロジェクト ${index + 1} の役割`)}
                  onChange={(event) =>
                    setProjects((current) =>
                      current.map((item) => (item.draftId === project.draftId ? { ...item, role: event.target.value } : item))
                    )
                  }
                  value={project.role ?? ''}
                />
              </label>
              <label>
                {t('技术（以逗号分隔）', '技術（カンマ区切り）')}
                <input
                  aria-label={t(`项目 ${index + 1} 的技术`, `プロジェクト ${index + 1} の技術`)}
                  onChange={(event) =>
                    setProjects((current) =>
                      current.map((item) => (item.draftId === project.draftId ? { ...item, technologies: event.target.value } : item))
                    )
                  }
                  value={project.technologies}
                />
              </label>
            </div>
            <label>
              {t('负责内容', '担当内容')}
              <textarea
                aria-label={t(`项目 ${index + 1} 的负责内容`, `プロジェクト ${index + 1} の担当内容`)}
                maxLength={1500}
                onChange={(event) =>
                  setProjects((current) =>
                    current.map((item) => (item.draftId === project.draftId ? { ...item, summary: event.target.value } : item))
                  )
                }
                value={project.summary}
              />
            </label>
            <label className="candidate-project-confirm">
              <input
                checked={confirmedProjectIds.has(project.draftId)}
                onChange={(event) =>
                  setConfirmedProjectIds((current) => {
                    const next = new Set(current)
                    if (event.target.checked) next.add(project.draftId)
                    else next.delete(project.draftId)
                    return next
                  })
                }
                type="checkbox"
              />
              {t('标记为已核对（可选）', '確認済みとしてマーク（任意）')}
            </label>
            <SourceTechnicalDetails labels={project.sourceLabels} locale={locale} />
          </article>
        ))}
        {projectsChanged ? (
          <label className="candidate-project-change-reason">
            {t('项目经历修改备注（可选）', 'プロジェクト経験の変更メモ（任意）')}
            <input
              aria-label={t('项目经历修改备注（可选）', 'プロジェクト経験の変更メモ（任意）')}
              onChange={(event) => setProjectChangeReason(event.target.value)}
              placeholder={t('修改内容备注（可选）', '変更内容のメモ（任意）')}
              value={projectChangeReason}
            />
          </label>
        ) : null}
      </div>

      <div className="source-evidence-panel" aria-live="polite">
        <div>
          <Icon name="search" size={14} />
          <strong>
            {selectedField?.label ?? t('来源', '出典')}
            {t('的已脱敏来源', 'の脱敏済み出典')}
          </strong>
        </div>
        {selectedField?.sourceLabels.length ? <span>{summarizeSourceLabels(selectedField.sourceLabels, locale)}</span> : null}
        <SourceTechnicalDetails labels={selectedField?.sourceLabels ?? []} locale={locale} />
        <pre>
          {evidenceLines.length > 0
            ? evidenceLines.join('\n')
            : t(
                '此字段没有自动检测到的来源，请查看原文后手工输入。',
                'このフィールドには自動検出された出典がありません。原文を確認して手入力してください。'
              )}
        </pre>
      </div>

      {error ? (
        <div className="inline-error">
          <Icon name="alert" size={16} /> {error}
        </div>
      ) : null}
      <button className="confirm-profile-button" disabled={!ready} onClick={() => void submit()} type="button">
        <Icon name="check" size={16} />{' '}
        {submitting ? t('保存中…', '保存中…') : t('确认当前人员资料', '現在の内容で候補者プロフィールを確認')}
      </button>
    </section>
  )
}
