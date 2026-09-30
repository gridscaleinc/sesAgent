import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type {
  CandidateEvaluationAuthoringWorkspace,
  CreateCandidateEvaluationDraftInput,
  DeleteCandidateEvaluationDraftCaseInput,
  EvaluateCandidateEvaluationDraftInput,
  EvaluateCandidateEvaluationDraftResult,
  SaveCandidateEvaluationDraftCaseInput
} from '@shared'
import { Icon } from './Icon'
import { localizedIpcError, useLocaleText } from '../i18n'

interface CandidateEvaluationAuthoringDialogProps {
  loading: boolean
  workspace: CandidateEvaluationAuthoringWorkspace | null
  onClose(): void
  onCreateDraft(input: CreateCandidateEvaluationDraftInput): Promise<CandidateEvaluationAuthoringWorkspace>
  onSaveCase(input: SaveCandidateEvaluationDraftCaseInput): Promise<CandidateEvaluationAuthoringWorkspace>
  onDeleteCase(input: DeleteCandidateEvaluationDraftCaseInput): Promise<CandidateEvaluationAuthoringWorkspace>
  onEvaluate(input: EvaluateCandidateEvaluationDraftInput): Promise<EvaluateCandidateEvaluationDraftResult>
  onWorkspaceChange(workspace: CandidateEvaluationAuthoringWorkspace): void
}

const caseStatusLabels = {
  ready: { zh: '可评估', ja: '評価可能' },
  'job-case-stale': { zh: '重新确认案件', ja: '案件再確認' },
  'candidate-stale': { zh: '重新确认人员', ja: '候補者再確認' },
  'no-relevant-candidates': { zh: '无正例', ja: '正例なし' }
} as const

function defaultDraftName(): string {
  const date = new Date()
  return `SES Pilot ${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function CandidateEvaluationAuthoringDialog({
  loading,
  workspace,
  onClose,
  onCreateDraft,
  onSaveCase,
  onDeleteCase,
  onEvaluate,
  onWorkspaceChange
}: CandidateEvaluationAuthoringDialogProps) {
  const { locale, zh, t } = useLocaleText()
  const dialogRef = useRef<HTMLElement | null>(null)
  const [draftName, setDraftName] = useState(defaultDraftName)
  const [jobCaseId, setJobCaseId] = useState('')
  const [candidateQuery, setCandidateQuery] = useState('')
  const [relevantIds, setRelevantIds] = useState<string[]>([])
  const [projectEvidenceIds, setProjectEvidenceIds] = useState<string[]>([])
  const [poolReviewed, setPoolReviewed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('[data-initial-focus="true"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (!workspace?.draft || !jobCaseId) {
      setRelevantIds([])
      setProjectEvidenceIds([])
      setPoolReviewed(false)
      return
    }
    const existing = workspace.draft.cases.find((draftCase) => draftCase.jobCaseId === jobCaseId)
    setRelevantIds(existing?.relevantCandidates.map((candidate) => candidate.profileId) ?? [])
    setProjectEvidenceIds(
      existing?.relevantCandidates.filter((candidate) => candidate.expectedProjectEvidence).map((candidate) => candidate.profileId) ?? []
    )
    setPoolReviewed(Boolean(existing))
  }, [jobCaseId, workspace])

  const selectedJobCase = workspace?.jobCases.find((jobCase) => jobCase.id === jobCaseId) ?? null
  const relevantSet = useMemo(() => new Set(relevantIds), [relevantIds])
  const projectEvidenceSet = useMemo(() => new Set(projectEvidenceIds), [projectEvidenceIds])
  const filteredCandidates = useMemo(() => {
    const normalized = candidateQuery.normalize('NFKC').toLocaleLowerCase('ja-JP').trim()
    const candidates = workspace?.candidates ?? []
    const filtered = normalized
      ? candidates.filter((candidate) =>
          [
            candidate.anonymousLabel,
            candidate.skills,
            candidate.role,
            candidate.experienceYears,
            candidate.availability,
            candidate.rate,
            candidate.japaneseLevel,
            candidate.workStyle
          ]
            .filter(Boolean)
            .join(' ')
            .normalize('NFKC')
            .toLocaleLowerCase('ja-JP')
            .includes(normalized)
        )
      : candidates
    return { total: filtered.length, visible: filtered.slice(0, 100) }
  }, [candidateQuery, workspace])

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await operation()
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法更新评估集草稿。', '評価セット草稿を更新できませんでした。')))
    } finally {
      setBusy(false)
    }
  }

  const createDraft = () =>
    run(async () => {
      const next = await onCreateDraft({ name: draftName })
      onWorkspaceChange(next)
      setNotice(t('已创建加密本地草稿。', '暗号化ローカル草稿を作成しました。'))
    })

  const saveCase = () =>
    run(async () => {
      const draft = workspace?.draft
      if (!draft || !selectedJobCase) return
      const next = await onSaveCase({
        draftId: draft.id,
        expectedRevision: draft.revision,
        jobCaseId: selectedJobCase.id,
        relevantCandidateProfileIds: relevantIds,
        expectedProjectEvidenceProfileIds: projectEvidenceIds,
        poolReviewed: true
      })
      onWorkspaceChange(next)
      setNotice(t('已保存案件及完整正例标签。', '案件と全量正例ラベルを保存しました。'))
    })

  const deleteCase = (caseId: string) =>
    run(async () => {
      const draft = workspace?.draft
      if (!draft) return
      const next = await onDeleteCase({ draftId: draft.id, caseId, expectedRevision: draft.revision })
      onWorkspaceChange(next)
      setNotice(t('已删除评估案例。', '評価ケースを削除しました。'))
    })

  const evaluateDraft = () =>
    run(async () => {
      const draft = workspace?.draft
      if (!draft) return
      const result = await onEvaluate({ draftId: draft.id, expectedRevision: draft.revision })
      onWorkspaceChange(result.workspace)
      setNotice(t(`已在本机重新评估 ${draft.caseCount} 个案例。`, `${draft.caseCount} ケースを端末内で再評価しました。`))
    })

  const toggleRelevant = (profileId: string) => {
    setRelevantIds((current) => (current.includes(profileId) ? current.filter((id) => id !== profileId) : [...current, profileId]))
    setProjectEvidenceIds((current) => (relevantSet.has(profileId) ? current.filter((id) => id !== profileId) : current))
  }

  const toggleProjectEvidence = (profileId: string) => {
    setProjectEvidenceIds((current) => (current.includes(profileId) ? current.filter((id) => id !== profileId) : [...current, profileId]))
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
      ) ?? [])
    ].filter((element) => element.offsetParent !== null)
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

  const draft = workspace?.draft ?? null
  const canSaveCase = Boolean(draft && selectedJobCase && relevantIds.length > 0 && poolReviewed && !busy)
  const canEvaluate = Boolean(draft && draft.caseCount > 0 && draft.readyCaseCount === draft.caseCount && !busy)

  return (
    <div className="evaluation-authoring-backdrop" role="presentation">
      <section
        aria-labelledby="evaluation-authoring-title"
        aria-modal="true"
        className="evaluation-authoring-dialog"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <div>
            <span>LOCAL SES BENCHMARK</span>
            <h2 id="evaluation-authoring-title">{t('创建专家标签集', '専門家ラベルセットを作成')}</h2>
            <p>
              {t(
                '仅使用已确认案件和匿名人员，在本机创建 Recall@20 的完整正例集。',
                '確認済み案件と匿名候補者だけを使い、Recall@20 の全量正例を端末内で作成します。'
              )}
            </p>
          </div>
          <button aria-label={t('关闭专家标签集', '専門家ラベルセットを閉じる')} disabled={busy} onClick={onClose} type="button">
            ×
          </button>
        </header>

        {loading ? (
          <div className="evaluation-authoring-loading">
            <span className="matching-spinner" />
            <strong>{t('正在读取加密本地草稿', '暗号化ローカル草稿を読み込み中')}</strong>
          </div>
        ) : workspace ? (
          <div className="evaluation-authoring-body">
            {!draft ? (
              <section className="evaluation-draft-create">
                <div className="evaluation-authoring-step">1</div>
                <div>
                  <h3>{t('开始评估集', '評価セットを開始')}</h3>
                  <p>
                    {t(
                      '名称中请勿包含公司名、负责人姓名或人员姓名，只使用试点名称和版本。',
                      '名前には会社名・担当者名・候補者名を入れず、試点名と版だけを使用してください。'
                    )}
                  </p>
                  <label>
                    {t('评估集名称', '評価セット名')}
                    <input
                      data-initial-focus="true"
                      maxLength={120}
                      onChange={(event) => setDraftName(event.target.value)}
                      value={draftName}
                    />
                  </label>
                  <button disabled={busy || draftName.trim().length < 3} onClick={() => void createDraft()} type="button">
                    {t('创建加密草稿', '暗号化草稿を作成')}
                  </button>
                </div>
              </section>
            ) : (
              <>
                <section className="evaluation-draft-progress">
                  <div>
                    <span>DATASET</span>
                    <strong>{draft.name}</strong>
                    <small>
                      Revision {draft.revision} · Reviewer {draft.reviewerCount || '—'}
                      {t(' 人', '名')}
                    </small>
                  </div>
                  <div className="evaluation-draft-progress-metrics">
                    <div>
                      <strong>{draft.caseCount}</strong>
                      <span>{t('/ 30 个案例', '/ 30 ケース')}</span>
                    </div>
                    <div>
                      <strong>{draft.readyCaseCount}</strong>
                      <span>{t('可评估', '評価可能')}</span>
                    </div>
                    <div>
                      <strong>{workspace.candidates.length}</strong>
                      <span>{t('在用人员', 'Active候補者')}</span>
                    </div>
                  </div>
                </section>

                <div className="evaluation-authoring-columns">
                  <section className="evaluation-case-composer">
                    <div className="evaluation-section-heading">
                      <span className="evaluation-authoring-step">2</span>
                      <div>
                        <h3>{t('确认案件与完整正例', '案件と全量正例を確認')}</h3>
                        <p>
                          {t(
                            '选择时以当前全部在用人员库为准，而不只看搜索结果。',
                            '検索結果だけでなく、現在の Active 候補者プール全体を基準に選択します。'
                          )}
                        </p>
                      </div>
                    </div>
                    <label>
                      {t('已确认案件', '確認済み案件')}
                      <select data-initial-focus="true" onChange={(event) => setJobCaseId(event.target.value)} value={jobCaseId}>
                        <option value="">{t('选择案件', '案件を選択')}</option>
                        {workspace.jobCases.map((jobCase) => (
                          <option key={jobCase.id} value={jobCase.id}>
                            {jobCase.title} · v{jobCase.version}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedJobCase ? (
                      <div className="evaluation-query-preview">
                        <span>{t('评估查询', '評価 Query')}</span>
                        <strong>{selectedJobCase.query}</strong>
                        <small>
                          {t('查询中不包含案件标题、业务链路或付款条件。', '案件タイトル・商流・支払条件は Query に含めません。')}
                        </small>
                      </div>
                    ) : null}
                    <label>
                      {t('筛选匿名人员', '匿名候補者を絞り込み')}
                      <input
                        maxLength={200}
                        onChange={(event) => setCandidateQuery(event.target.value)}
                        placeholder={t('例如：Java AWS、人员 38DCA6F6', '例：Java AWS、候補者 38DCA6F6')}
                        value={candidateQuery}
                      />
                    </label>
                    <div className="evaluation-candidate-count">
                      {t(
                        `符合条件 ${filteredCandidates.total} 项 · 最多显示 100 项 · 已选正例 ${relevantIds.length} 项`,
                        `該当 ${filteredCandidates.total}件 · 表示 最大100件 · 正例選択 ${relevantIds.length}件`
                      )}
                    </div>
                    <div className="evaluation-candidate-pool" role="group" aria-label={t('匿名人员正例标签', '匿名候補者正例ラベル')}>
                      {filteredCandidates.visible.map((candidate) => {
                        const relevant = relevantSet.has(candidate.id)
                        const projectEvidence = projectEvidenceSet.has(candidate.id)
                        return (
                          <div className={relevant ? 'is-selected' : ''} key={candidate.id}>
                            <label>
                              <input checked={relevant} onChange={() => toggleRelevant(candidate.id)} type="checkbox" />
                              <span>
                                <strong>{candidate.anonymousLabel}</strong>
                                <small>
                                  {[candidate.skills, candidate.role, candidate.experienceYears, candidate.rate]
                                    .filter(Boolean)
                                    .join(' · ') || t('无已确认字段', '確認済みフィールドなし')}
                                </small>
                              </span>
                            </label>
                            <label className="evaluation-project-check">
                              <input
                                checked={projectEvidence}
                                disabled={!relevant || candidate.projectExperienceCount === 0}
                                onChange={() => toggleProjectEvidence(candidate.id)}
                                type="checkbox"
                              />
                              {t(`项目证据 ${candidate.projectExperienceCount} 项`, `Project証拠 ${candidate.projectExperienceCount}件`)}
                            </label>
                          </div>
                        )
                      })}
                    </div>
                    <label className="evaluation-pool-confirmation">
                      <input checked={poolReviewed} onChange={(event) => setPoolReviewed(event.target.checked)} type="checkbox" />
                      <span>
                        <strong>
                          {t(
                            `已确认以 ${workspace.candidates.length} 名在用人员作为总体`,
                            `Active候補者 ${workspace.candidates.length}件を母集団として確認した`
                          )}
                        </strong>
                        <small>
                          {t(
                            '此次确认将作为 Recall@20 的分母；不会只把搜索排名靠前的结果作为正确集合。',
                            'この確認が Recall@20 の分母になります。検索上位だけを正解集合にしません。'
                          )}
                        </small>
                      </span>
                    </label>
                    <button className="evaluation-save-case" disabled={!canSaveCase} onClick={() => void saveCase()} type="button">
                      {t('加密保存案件标签', '案件ラベルを暗号化保存')}
                    </button>
                  </section>

                  <section className="evaluation-case-list">
                    <div className="evaluation-section-heading">
                      <span className="evaluation-authoring-step">3</span>
                      <div>
                        <h3>{t('案例列表与本机评估', 'ケース一覧と端末内評価')}</h3>
                        <p>
                          {t(
                            '少于 30 个案例时可进行功能验证，但无法通过质量门。',
                            '30件未満でも動作確認できますが、品質門は通過しません。'
                          )}
                        </p>
                      </div>
                    </div>
                    {draft.cases.length > 0 ? (
                      <div className="evaluation-case-items">
                        {draft.cases.map((draftCase) => (
                          <article key={draftCase.id}>
                            <div>
                              <span className={`evaluation-case-status is-${draftCase.status}`}>
                                {zh ? caseStatusLabels[draftCase.status].zh : caseStatusLabels[draftCase.status].ja}
                              </span>
                              <strong>{draftCase.jobCaseTitle}</strong>
                              <small>
                                {draftCase.relevantCandidates.length}
                                {t(' 个正例', '正例')} · Project{' '}
                                {draftCase.relevantCandidates.filter((candidate) => candidate.expectedProjectEvidence).length}
                                {t(' 项', '件')} · {draftCase.reviewerDisplayName}
                              </small>
                            </div>
                            <button
                              aria-label={t(`从评估集中删除 ${draftCase.jobCaseTitle}`, `${draftCase.jobCaseTitle} を評価セットから削除`)}
                              disabled={busy}
                              onClick={() => void deleteCase(draftCase.id)}
                              type="button"
                            >
                              {t('删除', '削除')}
                            </button>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="evaluation-case-empty">
                        {t('请选择已确认案件并保存首个完整正例标签。', '確認済み案件を選び、最初の全量正例ラベルを保存してください。')}
                      </div>
                    )}
                    {draft.caseCount < 30 ? (
                      <p className="evaluation-authoring-warning">
                        {t(`距离质量门还需要 ${30 - draft.caseCount} 个案例。`, `品質門まであと ${30 - draft.caseCount} ケース必要です。`)}
                      </p>
                    ) : null}
                    {draft.readyCaseCount !== draft.caseCount ? (
                      <p className="evaluation-authoring-warning">
                        {t(
                          '存在需要重新确认的案例，请使用当前案件和人员重新保存。',
                          '再確認が必要なケースがあります。現行案件・候補者で保存し直してください。'
                        )}
                      </p>
                    ) : null}
                    <button className="evaluation-run-draft" disabled={!canEvaluate} onClick={() => void evaluateDraft()} type="button">
                      {busy
                        ? t('正在本机评估…', '端末内評価中…')
                        : t(`在本机评估当前 ${draft.caseCount} 个案例`, `現在の ${draft.caseCount} ケースを端末内評価`)}
                    </button>
                    <div className="evaluation-local-policy">
                      <Icon name="shield" size={15} />
                      <span>{t('不发送到云端 · 不含原文 · 仅保存查询哈希报告', 'Cloud送信なし · 原文なし · Query Hashのみ報告保存')}</span>
                    </div>
                  </section>
                </div>
              </>
            )}
            {error ? (
              <p className="evaluation-authoring-error" role="alert">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p className="evaluation-authoring-notice" role="status">
                {notice}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="evaluation-authoring-error" role="alert">
            {t('无法读取评估集草稿。', '評価セット草稿を読み込めませんでした。')}
          </p>
        )}
      </section>
    </div>
  )
}
