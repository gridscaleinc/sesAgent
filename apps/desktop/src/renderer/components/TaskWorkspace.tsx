import { useEffect, useState } from 'react'
import type { WorkTask } from '@domain'
import { candidateMatchSuitableReasonCodes, candidateMatchUnsuitableReasonCodes } from '@shared/contracts'
import type {
  PrepareAiCommerceCloudPromptInput,
  AiCommerceCloudPromptResult,
  AiCommerceMembershipState,
  CandidateMatchFeedbackDecision,
  CandidateMatchFeedbackReasonCode,
  CandidateMatchResult,
  CandidateMatchRunSummary,
  CandidateReviewSnapshot,
  OriginalDocumentPreview,
  ApproveProposalDraftInput,
  CreateProposalDraftInput,
  ExportProposalPackageInput,
  ExportProposalPackageResult,
  ProposalMutationResult,
  ProposalWorkspaceSnapshot,
  ProcessingJobSummary,
  ResumeAnalysisSummary,
  RecordProposalFollowUpInput,
  SetWorkTaskLifecycleInput,
  SubmitCandidateReviewInput,
  SubmitCandidateReviewResult,
  SubmitCandidateMatchFeedbackInput,
  SubmitCandidateMatchFeedbackResult,
  UpdateProposalDraftInput
} from '@shared'
import { CandidateReviewPanel } from './CandidateReviewPanel'
import { CandidateHardFilterEvidence } from './CandidateHardFilterEvidence'
import { Icon } from './Icon'
import { ProposalWorkbench } from './ProposalWorkbench'
import { ResumeProfileWorkspace } from './ResumeProfileWorkspace'
import { localizedIpcError, localizedTaskTitle, useLocaleText, localizedMainText } from '../i18n'
import { workTaskStatusLabel, workTaskTypeLabel } from './TaskList'
import { summarizeSourceLabels } from '../source-evidence'

interface TaskWorkspaceProps {
  task: WorkTask
  analyses: ResumeAnalysisSummary[]
  candidateReviews: CandidateReviewSnapshot[]
  aiCommerce: AiCommerceMembershipState
  onLoadOriginalDocument?(sourceDocumentId: string): Promise<OriginalDocumentPreview>
  onOpenOriginalDocument?(sourceDocumentId: string): Promise<unknown>
  onOpenCloudSettings(): void
  onSendCloudPrompt(input: PrepareAiCommerceCloudPromptInput): Promise<AiCommerceCloudPromptResult>
  onSubmitCandidateReview(input: SubmitCandidateReviewInput): Promise<SubmitCandidateReviewResult>
  candidateMatches: CandidateMatchResult[]
  candidateMatchRun: CandidateMatchRunSummary | null
  candidateMatchStatus: 'idle' | 'loading' | 'ready' | 'error'
  candidateMatchQuery: string
  candidateMatchError: string | null
  onSubmitCandidateMatchFeedback(input: SubmitCandidateMatchFeedbackInput): Promise<SubmitCandidateMatchFeedbackResult>
  proposalStatus: 'idle' | 'loading' | 'ready' | 'error'
  proposalWorkspace: ProposalWorkspaceSnapshot | null
  proposalError: string | null
  processingJob: ProcessingJobSummary | null
  onCreateProposal(input: CreateProposalDraftInput): Promise<ProposalMutationResult>
  onUpdateProposal(input: UpdateProposalDraftInput): Promise<ProposalMutationResult>
  onApproveProposal(input: ApproveProposalDraftInput): Promise<ProposalMutationResult>
  onExportProposal(input: ExportProposalPackageInput): Promise<ExportProposalPackageResult>
  onRecordProposalFollowUp(input: RecordProposalFollowUpInput): Promise<ProposalMutationResult>
  onSetTaskLifecycle(input: SetWorkTaskLifecycleInput): Promise<WorkTask>
  onBack(): void
}

type LocaleText = (zh: string, ja: string) => string

function feedbackReasonLabel(code: CandidateMatchFeedbackReasonCode, t: LocaleText): string {
  const labels: Record<CandidateMatchFeedbackReasonCode, string> = {
    overall_fit: t('综合匹配', '総合的に合う'),
    strong_skill_fit: t('必备技能高度匹配', '必須スキルが強く一致'),
    strong_project_fit: t('相关项目经验突出', '関連プロジェクト経験が強い'),
    commercial_fit: t('单价与业务链路条件匹配', '単価・商流条件が合う'),
    availability_fit: t('可入场时间匹配', '稼働時期が合う'),
    location_fit: t('工作地点与通勤条件匹配', '勤務地・通勤条件が合う'),
    work_authorization_fit: t('工作资格要求匹配', '就労資格要件が合う'),
    skill_mismatch: t('必备技能不足', '必須スキル不足'),
    insufficient_project_evidence: t('相关项目依据不足', '関連プロジェクト根拠不足'),
    rate_mismatch: t('单价条件不匹配', '単価条件不一致'),
    availability_mismatch: t('入场时间不匹配', '稼働時期不一致'),
    work_style_mismatch: t('工作方式不匹配', '勤務形態不一致'),
    japanese_mismatch: t('日语能力条件不匹配', '日本語条件不一致'),
    location_mismatch: t('工作地点与通勤条件不匹配', '勤務地・通勤条件不一致'),
    work_authorization_mismatch: t('工作资格要求不匹配', '就労資格要件不一致'),
    client_preference: t('客户条件/匹配度', '顧客条件・相性'),
    stale_profile: t('档案信息过旧', 'プロフィールが古い'),
    other: t('其他', 'その他')
  }
  return labels[code]
}

type TaskResultView = 'primary' | 'evidence' | 'governance'

function ResultControlTabs({
  active,
  evidenceCount,
  onChange,
  primaryLabel,
  taskId
}: {
  active: TaskResultView
  evidenceCount: number
  onChange(view: TaskResultView): void
  primaryLabel: string
  taskId: string
}) {
  const { t } = useLocaleText()
  const tabs: Array<{ id: TaskResultView; label: string }> = [
    { id: 'primary', label: primaryLabel },
    { id: 'evidence', label: t(`证据 ${evidenceCount}`, `証跡 ${evidenceCount}`) },
    { id: 'governance', label: t('治理', '統制') }
  ]
  return (
    <div aria-label={t('结果与治理视图', '結果と統制の表示')} className="results-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          aria-controls={`task-result-panel-${taskId}`}
          aria-selected={active === tab.id}
          className={active === tab.id ? 'is-active' : ''}
          id={`task-result-tab-${taskId}-${tab.id}`}
          key={tab.id}
          onClick={() => onChange(tab.id)}
          role="tab"
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function TaskEvidenceView({
  analyses,
  matches,
  run,
  task
}: {
  analyses: ResumeAnalysisSummary[]
  matches: CandidateMatchResult[]
  run: CandidateMatchRunSummary | null
  task: WorkTask
}) {
  const { locale, t } = useLocaleText()
  const sourceLabels = [
    ...new Set(
      matches.flatMap((candidate) => [
        ...candidate.evidence.flatMap((field) => field.sourceLabels),
        ...(candidate.projectEvidence?.sourceLabels ?? [])
      ])
    )
  ]
  return (
    <div className="task-evidence-view">
      <section className="task-control-overview">
        <header>
          <Icon name="file" size={17} />
          <div>
            <span>TRACEABLE RESULT</span>
            <strong>{t('支持此结果的证据', 'この結果を支える証跡')}</strong>
          </div>
        </header>
        <dl>
          <div>
            <dt>{t('任务证据', 'タスク証跡')}</dt>
            <dd>{t(`${task.evidenceCount} 项`, `${task.evidenceCount}件`)}</dd>
          </div>
          <div>
            <dt>{t('产物', '成果物')}</dt>
            <dd>{t(`${task.artifacts.length} 项`, `${task.artifacts.length}件`)}</dd>
          </div>
          <div>
            <dt>{t('执行审计', '実行監査')}</dt>
            <dd>{t(`${task.toolAudits.length} 项`, `${task.toolAudits.length}件`)}</dd>
          </div>
          <div>
            <dt>{t('来源标签', '出典ラベル')}</dt>
            <dd>{t(`${sourceLabels.length} 项`, `${sourceLabels.length}件`)}</dd>
          </div>
        </dl>
        <p>
          {t(
            '此视图不会复制原文、姓名、联系方式或文件路径，仅显示已确认的匿名结果与非敏感哈希。',
            '原文・氏名・連絡先・ファイルパスはこのビューへ複製しません。確認済みの匿名結果と非機密ハッシュだけを表示します。'
          )}
        </p>
      </section>

      {run ? (
        <section className="task-ranking-evidence" aria-label={t('搜索排名证据', '検索ランキング証跡')}>
          <header>
            <div>
              <span>LOCAL RETRIEVAL PIPELINE</span>
              <strong>{t('搜索排名证据', '検索ランキング証跡')}</strong>
            </div>
            <em>{t('不使用云端', 'Cloud不使用')}</em>
          </header>
          <div className="task-ranking-pipeline">
            <span>{t('三态硬条件筛选', '三態Hard Filter')}</span>
            <b>→</b>
            <span>BM25</span>
            <b>+</b>
            <span>Profile/Project Vector</span>
            <b>→</b>
            <span>RRF</span>
            <b>→</b>
            <span>Local Rerank</span>
          </div>
          <dl>
            <div>
              <dt>Algorithm</dt>
              <dd>{run.algorithmVersion}</dd>
            </div>
            <div>
              <dt>Policy</dt>
              <dd>{run.hardFilterPolicyVersion}</dd>
            </div>
            <div>
              <dt>Result Set Hash</dt>
              <dd>{run.resultSetHash.slice(0, 12)}</dd>
            </div>
            <div>
              <dt>{t('人工评估', '人工評価')}</dt>
              <dd>
                {run.evaluation.feedbackCount} / {run.evaluation.resultCount}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {matches.map((candidate) => {
        const labels = [
          ...new Set([...candidate.evidence.flatMap((field) => field.sourceLabels), ...(candidate.projectEvidence?.sourceLabels ?? [])])
        ]
        return (
          <article className="task-candidate-evidence" key={candidate.matchResultId}>
            <header>
              <div>
                <span>RANK {candidate.retrieval.rank ?? '—'}</span>
                <strong>{candidate.anonymousLabel}</strong>
              </div>
              <em>{candidate.matchScore ?? '—'}%</em>
            </header>
            <div className="task-candidate-ranking">
              <span>BM25 #{candidate.retrieval.bm25Rank ?? '—'}</span>
              <span>Vector #{candidate.retrieval.vectorRank ?? '—'}</span>
              <span>RRF #{candidate.retrieval.preRerankRank ?? '—'}</span>
              <span>Rerank #{candidate.retrieval.rerankerRank ?? '—'}</span>
            </div>
            <ul>
              {candidate.evidence.map((field) => (
                <li key={`${candidate.matchResultId}-${field.key}`}>
                  <strong>{localizedMainText(locale, field.label)}</strong>
                  <span>{field.value ?? t('未确认', '未確認')}</span>
                  <small>{summarizeSourceLabels(field.sourceLabels, locale)}</small>
                </li>
              ))}
              {candidate.projectEvidence ? (
                <li>
                  <strong>Project</strong>
                  <span>{candidate.projectEvidence.title}</span>
                  <small>{summarizeSourceLabels(candidate.projectEvidence.sourceLabels, locale)}</small>
                </li>
              ) : null}
            </ul>
            <footer>
              <Icon name="shield" size={13} />
              {t('匿名结果 · 结果哈希', '匿名結果 · Result Hash')} {candidate.matchResultHash.slice(0, 12)} ·{' '}
              {summarizeSourceLabels(labels, locale)}
            </footer>
          </article>
        )
      })}

      {analyses.map((analysis, index) => (
        <article className="task-document-evidence" key={analysis.fileToken}>
          <header>
            <div>
              <span>LOCAL DOCUMENT {index + 1}</span>
              <strong>{t('解析与脱敏证据', '解析・脱敏証跡')}</strong>
            </div>
            <em>{analysis.localProcessing.networkAccess ? 'Network' : 'No Network'}</em>
          </header>
          <dl>
            <div>
              <dt>Parser</dt>
              <dd>{analysis.analysisVersion}</dd>
            </div>
            <div>
              <dt>OCR</dt>
              <dd>{analysis.localProcessing.ocr}</dd>
            </div>
            <div>
              <dt>Pages / Sheets</dt>
              <dd>
                {analysis.statistics.pages} / {analysis.statistics.sheets}
              </dd>
            </div>
            <div>
              <dt>{t('姓名候选项', '姓名候補')}</dt>
              <dd>
                {t(
                  `${analysis.localProcessing.personNameCandidates} 项 · 人工确认`,
                  `${analysis.localProcessing.personNameCandidates}件 · 人工確認`
                )}
              </dd>
            </div>
          </dl>
          <div>
            <span>
              {summarizeSourceLabels(
                analysis.extractedFields
                  .flatMap((field) => field.sourceLabels)
                  .filter((label, item, labels) => labels.indexOf(label) === item),
                locale
              )}
            </span>
          </div>
        </article>
      ))}

      <section className="task-artifact-evidence">
        <h3>{t('产物与执行审计', '成果物と実行監査')}</h3>
        {task.artifacts.length === 0 ? (
          <p>{t('此任务尚无已保存产物。', 'このタスクには保存済み成果物がまだありません。')}</p>
        ) : (
          task.artifacts.map((artifact) => (
            <article key={artifact.id}>
              <Icon name="file" size={14} />
              <span>
                <strong>{localizedMainText(locale, artifact.label)}</strong>
                <small>
                  {artifact.kind} · {artifact.status} · {t('不含直接标识符', '直接識別子なし')}
                </small>
              </span>
              <em>{artifact.contentHash?.slice(0, 12) ?? t('等待哈希', 'hash待ち')}</em>
            </article>
          ))
        )}
        {task.toolAudits.map((audit) => (
          <article key={audit.id}>
            <Icon name={audit.decision === 'executed' ? 'check' : 'alert'} size={14} />
            <span>
              <strong>{audit.action}</strong>
              <small>{localizedMainText(locale, audit.reason)}</small>
            </span>
            <em>
              {audit.externalSideEffect} ·{' '}
              {audit.cloudPayload === 'none' ? t('不使用云端', 'Cloudなし') : t('仅限已脱敏内容', '脱敏済みのみ')}
            </em>
          </article>
        ))}
      </section>
    </div>
  )
}

function TaskGovernanceView({ processingJob, task }: { processingJob: ProcessingJobSummary | null; task: WorkTask }) {
  const { locale, t } = useLocaleText()
  const cloudAuditCount = task.toolAudits.filter((audit) => audit.cloudPayload === 'redacted-only').length
  return (
    <div className="task-governance-view">
      <section className="task-control-overview is-governance">
        <header>
          <Icon name="shield" size={17} />
          <div>
            <span>ENFORCED BOUNDARY</span>
            <strong>{t('数据范围与执行边界', 'データ範囲と実行境界')}</strong>
          </div>
        </header>
        <dl>
          <div>
            <dt>{t('目标数据', '対象データ')}</dt>
            <dd>{localizedMainText(locale, task.scope.label)}</dd>
          </div>
          <div>
            <dt>{t('范围详情', '範囲詳細')}</dt>
            <dd>{localizedMainText(locale, task.scope.detail)}</dd>
          </div>
          <div>
            <dt>Privacy Policy</dt>
            <dd>{task.privacy.policyVersion}</dd>
          </div>
          <div>
            <dt>{t('直接标识符', '直接識別子')}</dt>
            <dd>{t('禁止发送到云端', 'Cloud送信 禁止')}</dd>
          </div>
          <div>
            <dt>{t('云端执行', 'Cloud実行')}</dt>
            <dd>{cloudAuditCount === 0 ? t('未执行', '実行なし') : t(`已脱敏 ${cloudAuditCount} 项`, `脱敏済み ${cloudAuditCount}件`)}</dd>
          </div>
          <div>
            <dt>{t('自动发送', '自動送信')}</dt>
            <dd>{t('未实现', '実装なし')}</dd>
          </div>
        </dl>
      </section>

      <section className="task-governance-policy">
        <h3>{t('强制策略', '強制ポリシー')}</h3>
        <div>
          <Icon name="lock" size={14} />
          <span>
            <strong>{t('渲染层无法扩大数据范围', 'Rendererは範囲を拡大できない')}</strong>
            <small>{t('主进程会重新验证范围、Schema 与预览哈希。', 'MainがScope、Schema、Preview Hashを再検証します。')}</small>
          </span>
        </div>
        <div>
          <Icon name="shield" size={14} />
          <span>
            <strong>{t('无法绕过 PII/DLP', 'PII/DLPをバイパスできない')}</strong>
            <small>
              {t('缺少姓名确认和 DLP 证据的原文或图片不会进入云端载荷。', '姓名確認とDLP証跡がない原文・画像はCloud Payloadになりません。')}
            </small>
          </span>
        </div>
        <div>
          <Icon name="check" size={14} />
          <span>
            <strong>{t('由人工做出判断', '判断は人が行う')}</strong>
            <small>
              {t(
                '人员录用与否、案件确认、提案审批及对外提供均由销售负责人决定。',
                '要員の採否、案件確定、提案承認と外部提供は営業担当の責任です。'
              )}
            </small>
          </span>
        </div>
      </section>

      <section className="task-approval-evidence">
        <h3>{t('审批门', '承認ゲート')}</h3>
        {task.approvalGates.map((gate) => (
          <div key={gate.id}>
            <Icon name={gate.status === 'approved' ? 'check' : 'clock'} size={14} />
            <span>
              <strong>{localizedMainText(locale, gate.label)}</strong>
              <small>
                {gate.status === 'approved'
                  ? t(
                      `已批准 · ${gate.approvedBy ? localizedMainText(locale, gate.approvedBy) : '已记录确认人'}`,
                      `承認済み · ${gate.approvedBy ?? '確認者記録済み'}`
                    )
                  : t('完成确认前不会产生外部操作', '確認完了まで外部副作用なし')}
              </small>
            </span>
            <em>{gate.status === 'approved' ? 'APPROVED' : 'REQUIRED'}</em>
          </div>
        ))}
      </section>

      <section className="task-replay-boundary">
        <header>
          <span>RECOVERY POLICY</span>
          <strong>
            {processingJob
              ? processingJob.replayPolicy === 'safe-local'
                ? t('可在本机安全恢复', '端末内で安全に再開可能')
                : t('重新执行前需要人工确认', '再実行前に人の確認が必要')
              : t('无执行任务', '実行ジョブなし')}
          </strong>
        </header>
        {processingJob ? (
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{processingJobStatusLabel(processingJob.status, t)}</dd>
            </div>
            <div>
              <dt>Attempt</dt>
              <dd>
                {processingJob.attemptCount} / {processingJob.maxAttempts}
              </dd>
            </div>
            <div>
              <dt>Progress</dt>
              <dd>{processingJob.progress}%</dd>
            </div>
            <div>
              <dt>Cancel</dt>
              <dd>{processingJob.cancelRequestedAt ? t('已请求', '要求済み') : t('未请求', '未要求')}</dd>
            </div>
          </dl>
        ) : (
          <p>
            {t(
              '此任务没有独立的 ProcessingJob；任务记录和审批状态保存在 SQLCipher 中。',
              'このタスクに独立ProcessingJobはありません。タスク記録と承認状態はSQLCipherに保存されています。'
            )}
          </p>
        )}
      </section>

      <div className="review-gate">
        <Icon name="lock" size={18} />
        <div>
          <strong>{t('不自动执行外部操作', '自動外部実行なし')}</strong>
          <p>
            {t(
              '此页面仅说明治理状态，不会修改权限、发送邮件或启用云服务商。',
              'この画面は統制状態を説明するだけで、権限変更・メール送信・Cloud Provider有効化を行いません。'
            )}
          </p>
        </div>
      </div>
    </div>
  )
}

function CandidateMatchFeedbackControl({
  candidate,
  onSubmit
}: {
  candidate: CandidateMatchResult
  onSubmit(input: SubmitCandidateMatchFeedbackInput): Promise<SubmitCandidateMatchFeedbackResult>
}) {
  const { locale, t } = useLocaleText()
  const [localFeedback, setLocalFeedback] = useState(candidate.feedback)
  const [editing, setEditing] = useState(candidate.feedback === null)
  const [decision, setDecision] = useState<CandidateMatchFeedbackDecision | null>(candidate.feedback?.decision ?? null)
  const [reasonCode, setReasonCode] = useState<CandidateMatchFeedbackReasonCode | ''>(candidate.feedback?.reasonCode ?? '')
  const [note, setNote] = useState(candidate.feedback?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reasons = decision === 'suitable' ? candidateMatchSuitableReasonCodes : candidateMatchUnsuitableReasonCodes

  const chooseDecision = (next: CandidateMatchFeedbackDecision) => {
    setDecision(next)
    setReasonCode('')
    setEditing(true)
    setError(null)
  }
  const save = async () => {
    if (!decision || !reasonCode || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await onSubmit({
        matchResultId: candidate.matchResultId,
        matchResultHash: candidate.matchResultHash,
        expectedRevision: localFeedback?.revision ?? 0,
        decision,
        reasonCode,
        ...(note.trim() ? { note: note.trim() } : {})
      })
      setLocalFeedback(result.feedback)
      setEditing(false)
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法保存评估。', '評価を保存できませんでした。')))
    } finally {
      setBusy(false)
    }
  }

  if (!editing && localFeedback) {
    return (
      <div className={`candidate-feedback-saved is-${localFeedback.decision}`}>
        <span>
          {localFeedback.decision === 'suitable' ? t('匹配', '合適') : t('不匹配', '不合適')} ·{' '}
          {feedbackReasonLabel(localFeedback.reasonCode, t)}
        </span>
        <small>
          {localFeedback.reviewerDisplayName} · {t('评估修订版', '評価 Revision')} {localFeedback.revision}
        </small>
        <button onClick={() => setEditing(true)} type="button">
          {t('修改评估', '評価を修正')}
        </button>
      </div>
    )
  }

  return (
    <div className="candidate-feedback-editor">
      <div
        className="candidate-feedback-decision"
        role="group"
        aria-label={t(`${candidate.anonymousLabel} 的评估`, `${candidate.anonymousLabel} の評価`)}
      >
        <button className={decision === 'suitable' ? 'is-selected suitable' : ''} onClick={() => chooseDecision('suitable')} type="button">
          {t('匹配', '合適')}
        </button>
        <button
          className={decision === 'unsuitable' ? 'is-selected unsuitable' : ''}
          onClick={() => chooseDecision('unsuitable')}
          type="button"
        >
          {t('不匹配', '不合適')}
        </button>
        <span>{t('将销售判断保存为评估证据，而不是训练数据', '営業判断を学習データではなく評価証跡として保存')}</span>
      </div>
      {decision ? (
        <div className="candidate-feedback-fields">
          <label>
            <span>{t('原因', '理由')}</span>
            <select
              aria-label={t(`${candidate.anonymousLabel} 的评估原因`, `${candidate.anonymousLabel} の評価理由`)}
              onChange={(event) => setReasonCode(event.target.value as CandidateMatchFeedbackReasonCode | '')}
              value={reasonCode}
            >
              <option value="">{t('请选择', '選択してください')}</option>
              {reasons.map((reason) => (
                <option key={reason} value={reason}>
                  {feedbackReasonLabel(reason, t)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('补充说明（仅本机）', '補足（端末内のみ）')}</span>
            <input
              aria-label={t(`${candidate.anonymousLabel} 的评估补充说明`, `${candidate.anonymousLabel} の評価補足`)}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('仅在需要时填写', '必要な場合だけ入力')}
              value={note}
            />
          </label>
          <button
            disabled={!reasonCode || (reasonCode === 'other' && note.trim().length < 3) || busy}
            onClick={() => void save()}
            type="button"
          >
            {busy ? t('保存中…', '保存中…') : t('保存评估', '評価を保存')}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="candidate-feedback-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function MatchingResults({
  matches,
  run,
  status,
  query,
  error,
  onSubmitFeedback
}: {
  matches: CandidateMatchResult[]
  run: CandidateMatchRunSummary | null
  status: TaskWorkspaceProps['candidateMatchStatus']
  query: string
  error: string | null
  onSubmitFeedback(input: SubmitCandidateMatchFeedbackInput): Promise<SubmitCandidateMatchFeedbackResult>
}) {
  const { t } = useLocaleText()
  const requestedTerms = (query.match(/"[^"]+"|'[^']+'|[^\s]+/gu) ?? []).map((term) => term.replace(/^['"]|['"]$/gu, ''))
  return (
    <>
      <div className="matching-query-summary">
        <span>LOCAL AI RETRIEVAL · STAGE 4</span>
        <strong>{requestedTerms.join(' · ') || t('没有可结构化的条件', '構造化できる条件がありません')}</strong>
        <small>
          {t(
            '硬条件（未知项不排除）→ BM25 + 档案/项目向量 → 人员聚合 → RRF → 本机 AI 精排',
            '硬条件（不明は除外しない）→ BM25 + Profile/Project Vector → 要員集約 → RRF → 端末内AI精査'
          )}
        </small>
        {run ? (
          <div className="matching-evaluation-summary">
            <span>
              {t('评估', '評価')} {run.evaluation.feedbackCount}/{run.evaluation.resultCount}
            </span>
            <span>Coverage {run.evaluation.coveragePercent}%</span>
            <span>
              {run.evaluation.judgedNdcgAt20 === null
                ? t('等待 NDCG@20 评估', 'NDCG@20 評価待ち')
                : `Judged NDCG@20 ${run.evaluation.judgedNdcgAt20.toFixed(3)}`}
            </span>
            <span>Hard Filter {run.hardFilterPolicyVersion}</span>
            <span>{t('完整真值准备好之前不计算 Recall@20', 'Recall@20 は全量真値が揃うまで未算出')}</span>
          </div>
        ) : null}
      </div>
      <div className="candidate-list">
        {status === 'loading' ? (
          <div className="matching-state">
            <span className="matching-spinner" />
            <strong>{t('正在搜索已确认人员', '確認済み要員を検索中')}</strong>
            <p>{t('搜索与评分均在本机执行。', '検索とスコア計算は端末内で実行しています。')}</p>
          </div>
        ) : null}
        {status === 'error' ? (
          <div className="matching-state is-error">
            <Icon name="alert" size={18} />
            <strong>{t('无法搜索人员', '要員を検索できませんでした')}</strong>
            <p>{error}</p>
          </div>
        ) : null}
        {status === 'ready' && matches.length === 0 ? (
          <div className="matching-state">
            <Icon name="users" size={18} />
            <strong>{t('没有匹配的已确认人员', '一致する確認済み要員がありません')}</strong>
            <p>{t('请添加人员档案或调整搜索条件。', '要員プロフィールを追加するか、検索条件を見直してください。')}</p>
          </div>
        ) : null}
        {matches.map((candidate) => {
          const byKey = new Map(candidate.fields.map((field) => [field.key, field]))
          const skills =
            byKey
              .get('skills')
              ?.value?.split(/\s*[,/、]\s*/u)
              .filter(Boolean)
              .slice(0, 6) ?? []
          const evidenceLabels = [
            ...new Set([...candidate.evidence.flatMap((field) => field.sourceLabels), ...(candidate.projectEvidence?.sourceLabels ?? [])])
          ]
          const matched = new Set(candidate.matchedTerms.map((term) => term.toLocaleLowerCase('ja-JP')))
          const missingTerms = requestedTerms.filter((term) => !matched.has(term.toLocaleLowerCase('ja-JP')))
          const unknownHardFilterCount = candidate.retrieval.hardFilters.filter((filter) => filter.outcome === 'unknown').length
          return (
            <article className="candidate-card" key={candidate.id}>
              <div className="candidate-title">
                <span className="match-dot" />
                <h3>{candidate.anonymousLabel}</h3>
                <strong>{candidate.matchScore ?? '—'}%</strong>
              </div>
              <div className="skill-row">
                {skills.map((skill) => (
                  <span key={skill}>{skill}</span>
                ))}
              </div>
              <dl>
                <div>
                  <dt>{t('经验', '経験')}</dt>
                  <dd>{byKey.get('experience_years')?.value ?? t('未确认', '未確認')}</dd>
                </div>
                <div>
                  <dt>{t('工作方式', '勤務')}</dt>
                  <dd>{byKey.get('work_style')?.value ?? t('未确认', '未確認')}</dd>
                </div>
                <div>
                  <dt>{t('单价', '単価')}</dt>
                  <dd>{byKey.get('rate')?.value ?? t('未确认', '未確認')}</dd>
                </div>
                <div>
                  <dt>{t('工作地点', '勤務地')}</dt>
                  <dd>{byKey.get('location')?.value ?? t('未确认', '未確認')}</dd>
                </div>
                <div>
                  <dt>{t('工作资格', '就労')}</dt>
                  <dd>{byKey.get('work_authorization')?.value ?? t('未确认', '未確認')}</dd>
                </div>
              </dl>
              <div className="candidate-match-evidence">
                {t('匹配：', '一致：')}
                {candidate.matchedTerms.join(' · ') || t('无条件', '条件なし')}
              </div>
              <CandidateHardFilterEvidence filters={candidate.retrieval.hardFilters} />
              {candidate.projectEvidence ? (
                <div className="candidate-task-project-evidence">
                  <span>PROJECT EVIDENCE · {candidate.projectEvidence.matchType.toUpperCase()}</span>
                  <strong>{candidate.projectEvidence.title}</strong>
                  <p>{candidate.projectEvidence.summary}</p>
                  <small>
                    {[
                      candidate.projectEvidence.period,
                      candidate.projectEvidence.role,
                      ...candidate.projectEvidence.technologies.slice(0, 5)
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </div>
              ) : null}
              {missingTerms.length > 0 ? (
                <div className="candidate-match-missing">
                  {t('不匹配：', '未一致：')}
                  {missingTerms.join(' · ')}
                </div>
              ) : null}
              <div className="candidate-retrieval-line">
                <span>
                  {t('综合排名', '統合 Rank')} {candidate.retrieval.rank ?? '—'}
                </span>
                {candidate.retrieval.rerankerRank !== null ? <span>Rerank #{candidate.retrieval.rerankerRank}</span> : null}
                {candidate.retrieval.preRerankRank !== null ? <span>RRF #{candidate.retrieval.preRerankRank}</span> : null}
                {candidate.retrieval.bm25Rank !== null ? <span>BM25 #{candidate.retrieval.bm25Rank}</span> : null}
                {candidate.retrieval.vectorRank !== null ? <span>Vector #{candidate.retrieval.vectorRank}</span> : null}
                {candidate.retrieval.vectorScore !== null ? (
                  <span>
                    {t('相似度', '類似')} {Math.round(candidate.retrieval.vectorScore * 100)}%
                  </span>
                ) : null}
                <span>
                  {t('条件覆盖率', '条件網羅')} {candidate.retrieval.termCoverage ?? 0}%
                </span>
                {candidate.retrieval.hardFilters.length > 0 ? (
                  <span>
                    {unknownHardFilterCount > 0
                      ? t(`硬条件未确认 ${unknownHardFilterCount} 项`, `硬条件 未確認${unknownHardFilterCount}件`)
                      : t('硬条件已确认', '硬条件 確認済み')}
                  </span>
                ) : null}
              </div>
              <CandidateMatchFeedbackControl candidate={candidate} onSubmit={onSubmitFeedback} />
              <div className="candidate-source">
                <Icon name="shield" size={15} /> {t('已确认人员库', '確認済み要員プール')} ·{' '}
                {evidenceLabels.join(' · ') || t('HR 已确认', 'HR確認済み')}
              </div>
            </article>
          )
        })}
      </div>
      <div className="review-gate">
        <Icon name="lock" size={18} />
        <div>
          <strong>{t('人工审批门', 'ヒューマン承認ゲート')}</strong>
          <p>{t('人员录用与否及提案对象由销售负责人决定。', '要員の採否と提案対象は営業担当が決定します。')}</p>
        </div>
      </div>
    </>
  )
}

function ResumeImportResults({
  task,
  analyses,
  candidateReviews,
  onSubmitCandidateReview
}: {
  task: WorkTask
  analyses: ResumeAnalysisSummary[]
  candidateReviews: CandidateReviewSnapshot[]
  onSubmitCandidateReview(input: SubmitCandidateReviewInput): Promise<SubmitCandidateReviewResult>
}) {
  const { t } = useLocaleText()
  const fileCount = task.contextBindings.filter((binding) => binding.objectType === 'staged-file').length
  const totals = analyses.reduce(
    (sum, analysis) => ({
      pages: sum.pages + analysis.statistics.pages,
      sheets: sum.sheets + analysis.statistics.sheets,
      blocks: sum.blocks + analysis.statistics.blocks,
      characters: sum.characters + analysis.statistics.characters
    }),
    { pages: 0, sheets: 0, blocks: 0, characters: 0 }
  )
  const identifierCounts = new Map<string, number>()
  const projectCount = analyses.reduce((total, analysis) => total + (analysis.extractedProjectExperiences?.length ?? 0), 0)
  for (const analysis of analyses) {
    for (const item of analysis.detectedIdentifiers) {
      identifierCounts.set(item.type, (identifierCounts.get(item.type) ?? 0) + item.count)
    }
  }
  const reviewsByDocument = new Map(candidateReviews.map((review) => [review.documentId, review]))
  const allReviewsCompleted =
    fileCount > 0 && candidateReviews.length === fileCount && candidateReviews.every((review) => review.status === 'completed')
  return (
    <>
      <div className="result-summary-card success-summary">
        <div className="result-summary-title">
          <Icon name="check" size={17} />
          <h3>{t('本地解析完成', 'ローカル解析完了')}</h3>
        </div>
        <dl>
          <div>
            <dt>{t('对象', '対象')}</dt>
            <dd>{t(`${fileCount} 个文件`, `${fileCount} ファイル`)}</dd>
          </div>
          <div>
            <dt>{t('存储', '保管')}</dt>
            <dd>{t('AES-256-GCM 加密', 'AES-256-GCM 暗号化')}</dd>
          </div>
          <div>
            <dt>{t('来源', '出典')}</dt>
            <dd>{t('保留页、工作表与单元格信息', 'ページ・シート・セルを保持')}</dd>
          </div>
          <div>
            <dt>{t('解析量', '解析量')}</dt>
            <dd>
              {t(
                `${totals.pages} 页 · ${totals.sheets} 个工作表 · ${totals.blocks} 个区块`,
                `${totals.pages}ページ · ${totals.sheets}シート · ${totals.blocks}ブロック`
              )}
            </dd>
          </div>
          <div>
            <dt>Project</dt>
            <dd>{t(`${projectCount} 项 · 等待 HR 确认`, `${projectCount}件 · HR確認待ち`)}</dd>
          </div>
        </dl>
      </div>
      <div className={`result-summary-card ${allReviewsCompleted ? 'success-summary' : 'warning-summary'}`}>
        <div className="result-summary-title">
          <Icon name={allReviewsCompleted ? 'check' : 'alert'} size={17} />
          <h3>
            {allReviewsCompleted ? t('人员资料保存完成', '要員プロフィール保存完了') : t('人员资料待确认', '要員プロフィール確認待ち')}
          </h3>
        </div>
        <p>
          {allReviewsCompleted
            ? t(
                '包含本人信息的人员资料已加密保存在本机；资料确认后，营业状态为「待营业」的人员即可参与案件匹配。',
                '本人情報を含む要員プロフィールを暗号化して端末内へ保存しました。資料確認後、営業状態が「営業待ち」の要員は案件マッチングに使われます。'
              )
            : t(
                '本机解析已完成；即使有未填写字段，也可以按当前内容确认人员资料。',
                'ローカル解析が完了しました。未入力項目があっても現在の内容で要員プロフィールを確認できます。'
              )}
        </p>
        <div className="result-identifier-list">
          {[...identifierCounts.entries()].map(([type, count]) => (
            <span key={type}>
              {type} × {count}
            </span>
          ))}
          {identifierCounts.size === 0 ? <span>{t('无规则匹配', 'ルール一致なし')}</span> : null}
        </div>
      </div>
      {analyses.map((analysis) => (
        <div className="result-local-processing" key={`${analysis.fileToken}-local-processing`}>
          <Icon name="shield" size={15} />
          <span>
            <strong>
              {analysis.localProcessing.ocr === 'apple-vision-completed'
                ? t('Apple Vision OCR 完成', 'Apple Vision OCR 完了')
                : analysis.localProcessing.ocr === 'windows-media-ocr-completed' ||
                    analysis.localProcessing.ocr === 'windows-tesseract-wasm-completed'
                  ? t('Windows OCR 完成', 'Windows OCR 完了')
                  : t('本地文档解析', 'ローカル文書解析')}
            </strong>
            {analysis.localProcessing.ocrPages > 0
              ? t(` · ${analysis.localProcessing.ocrPages} 页`, ` · ${analysis.localProcessing.ocrPages}ページ`)
              : ''}
            {t(
              ` · 姓名候选项 ${analysis.localProcessing.personNameCandidates} 项 · 不使用网络`,
              ` · 姓名候補 ${analysis.localProcessing.personNameCandidates}件 · ネットワーク不使用`
            )}
          </span>
        </div>
      ))}
      {analyses.map((analysis) => {
        const review = reviewsByDocument.get(analysis.fileToken)
        return review ? (
          <CandidateReviewPanel
            analysis={analysis}
            key={`${analysis.fileToken}-${review.reviewRevision}-${review.status}`}
            onSubmit={onSubmitCandidateReview}
            review={review}
          />
        ) : null
      })}
      {analyses[0] ? <pre className="result-preview">{analyses[0].redactedPreview}</pre> : null}
      <div className="review-gate">
        <Icon name="lock" size={18} />
        <div>
          <strong>{t('云端网关已关闭', 'Cloud Gateway は閉鎖中')}</strong>
          <p>
            {t(
              '此任务不存在有效且 `dlpStatus=passed` 的云端载荷。',
              'このタスクに有効な `dlpStatus=passed` の Cloud Payload は存在しません。'
            )}
          </p>
        </div>
      </div>
    </>
  )
}

function GenericTaskResults({ task }: { task: WorkTask }) {
  const { t } = useLocaleText()
  return (
    <>
      <div className="result-summary-card">
        <div className="result-summary-title">
          <Icon name="file" size={17} />
          <h3>{workTaskTypeLabel(task, t)}</h3>
        </div>
        <p>
          {t(
            '后续实现将依据获准的数据范围和审批门接入结果视图。',
            '許可されたデータ範囲と承認ゲートに沿って、次の実装スライスで結果ビューを接続します。'
          )}
        </p>
      </div>
      <div className="review-gate">
        <Icon name="lock" size={18} />
        <div>
          <strong>{t('需要人工确认', '人の確認が必要')}</strong>
          <p>{t('不会自动执行外部发送或确认操作。', '外部送信や確定操作は自動実行されません。')}</p>
        </div>
      </div>
    </>
  )
}

function StoppedTaskResults({ task }: { task: WorkTask }) {
  const { t } = useLocaleText()
  return (
    <>
      <div className="result-summary-card stopped-task-result">
        <div className="result-summary-title">
          <Icon name="alert" size={17} />
          <h3>{task.status === 'cancelled' ? t('任务已取消', '作業はキャンセル済みです') : t('任务需要处理', '作業は要対応です')}</h3>
        </div>
        <p>
          {t(
            '不会自动重新执行或产生外部操作。选择左上角“按相同范围重新执行”即可在不扩大原数据范围的情况下恢复任务。',
            '自動再実行や外部副作用はありません。左上の「同じ範囲で再実行」を選ぶと、元のデータ範囲を拡大せずに再開します。'
          )}
        </p>
      </div>
      <div className="review-gate">
        <Icon name="lock" size={18} />
        <div>
          <strong>{t('已暂停', '停止中')}</strong>
          <p>
            {t(
              '明确选择重新执行之前，不会进行人员搜索、提案生成或导出。',
              '再実行を明示的に選ぶまで、要員検索・提案生成・書き出しは実行されません。'
            )}
          </p>
        </div>
      </div>
    </>
  )
}

function TaskMessageTimeline({ task }: { task: WorkTask }) {
  const { locale, t } = useLocaleText()
  return (
    <>
      {task.messages.map((message) => {
        const isUser = message.role === 'user'
        const isPlan = message.kind === 'plan'
        return (
          <div
            className={`thread-message ${isUser ? 'user-message' : message.role === 'assistant' ? 'assistant-message' : 'system-message'}`}
            key={message.id}
          >
            <span className={isUser ? 'avatar dark' : message.role === 'assistant' ? 'assistant-avatar' : 'system-avatar'}>
              {isUser ? t('用', '山') : message.role === 'assistant' ? 'S' : <Icon name="shield" size={14} />}
            </span>
            <div className={message.role === 'assistant' ? 'assistant-content' : undefined}>
              <strong>
                {isUser
                  ? t('你', 'あなた')
                  : message.role === 'assistant'
                    ? t('SESAI 助手', 'SESAI アシスタント')
                    : t('执行记录', '実行記録')}
              </strong>
              <p>
                {isUser ? localizedTaskTitle(locale, { id: task.id, title: message.content }) : localizedMainText(locale, message.content)}
              </p>
              {isPlan ? (
                <>
                  <div className="workspace-plan">
                    {task.steps.map((step) => (
                      <div className="workspace-step" key={step.id}>
                        <span className={`step-icon step-${step.status}`}>
                          {step.status === 'completed' ? (
                            <Icon name="check" size={14} />
                          ) : step.status === 'running' ? (
                            'Ⅱ'
                          ) : step.status === 'blocked' ? (
                            '!'
                          ) : (
                            '·'
                          )}
                        </span>
                        <div>
                          <strong>{localizedMainText(locale, step.title)}</strong>
                          <small>{localizedMainText(locale, step.description)}</small>
                        </div>
                        <span>
                          {step.status === 'completed'
                            ? t('已完成', '完了')
                            : step.status === 'running'
                              ? t('处理中', '処理中')
                              : step.status === 'blocked'
                                ? t('待确认', '確認待ち')
                                : t('等待', '待機')}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="source-grid">
                    <div>
                      <Icon name="database" size={17} />
                      <span>
                        {t('数据范围', 'データ範囲')}
                        <strong>{localizedMainText(locale, task.scope.label)}</strong>
                      </span>
                    </div>
                    <div>
                      <Icon name="shield" size={17} />
                      <span>
                        {t('隐私', 'プライバシー')}
                        <strong>{t('强制脱敏门', '脱敏ゲート強制')}</strong>
                      </span>
                    </div>
                    <div>
                      <Icon name="file" size={17} />
                      <span>
                        {t('证据', '証跡')}
                        <strong>{t(`${task.evidenceCount} 项`, `${task.evidenceCount}件`)}</strong>
                      </span>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )
      })}
    </>
  )
}

function processingJobStatusLabel(status: ProcessingJobSummary['status'], t: LocaleText): string {
  const labels: Record<ProcessingJobSummary['status'], string> = {
    queued: t('等待中', '待機中'),
    running: t('运行中', '実行中'),
    succeeded: t('已完成', '完了'),
    retry_wait: t('等待重试', '再試行待ち'),
    failed: t('需处理', '要対応'),
    cancelled: t('已取消', 'キャンセル')
  }
  return labels[status]
}

function TaskRecordSummary({ task, processingJob }: { task: WorkTask; processingJob: ProcessingJobSummary | null }) {
  const { locale, t } = useLocaleText()
  const approved = task.approvalGates.filter((gate) => gate.status === 'approved').length
  const latestAudit = task.toolAudits.at(-1)
  return (
    <section className="task-record-summary" aria-label={t('加密任务记录', '暗号化された作業記録')}>
      <header>
        <div>
          <span>PERSISTED TASK RECORD</span>
          <strong>{t('重启后仍可恢复的任务记录', '再起動後も復元される作業記録')}</strong>
        </div>
        <em>
          <Icon name="lock" size={13} /> SQLCipher
        </em>
      </header>
      <dl>
        <div>
          <dt>{t('消息', 'メッセージ')}</dt>
          <dd>{task.messages.length}</dd>
        </div>
        <div>
          <dt>{t('审批', '承認')}</dt>
          <dd>
            {approved} / {task.approvalGates.length}
          </dd>
        </div>
        <div>
          <dt>{t('产物', '成果物')}</dt>
          <dd>{task.artifacts.length}</dd>
        </div>
        <div>
          <dt>{t('执行审计', '実行監査')}</dt>
          <dd>{task.toolAudits.length}</dd>
        </div>
      </dl>
      {processingJob ? (
        <div className={`processing-job-status is-${processingJob.status}`}>
          <div>
            <span>PROCESSING JOB</span>
            <strong>{processingJobStatusLabel(processingJob.status, t)}</strong>
          </div>
          <div className="processing-job-progress">
            <span style={{ width: `${processingJob.progress}%` }} />
          </div>
          <small>
            {t('尝试', '試行')} {processingJob.attemptCount} / {processingJob.maxAttempts} ·{' '}
            {processingJob.replayPolicy === 'safe-local'
              ? t('可在本机安全恢复', '端末内で安全に再開可能')
              : t('中断后需要人工确认', '中断時は人の確認が必要')}
          </small>
        </div>
      ) : null}
      {latestAudit ? (
        <p>
          <Icon name={latestAudit.decision === 'executed' ? 'check' : 'alert'} size={14} />
          <span>
            <strong>{latestAudit.action}</strong>
            {localizedMainText(locale, latestAudit.reason)}
          </span>
          <em>{latestAudit.cloudPayload === 'none' ? t('不发送到云端', 'Cloud送信なし') : t('仅限已脱敏内容', '脱敏済みのみ')}</em>
        </p>
      ) : null}
    </section>
  )
}

export function TaskWorkspace({
  task,
  analyses,
  candidateReviews,
  aiCommerce,
  onLoadOriginalDocument,
  onOpenOriginalDocument,
  onOpenCloudSettings,
  onSendCloudPrompt,
  onSubmitCandidateReview,
  candidateMatches,
  candidateMatchStatus,
  candidateMatchQuery,
  candidateMatchRun,
  candidateMatchError,
  onSubmitCandidateMatchFeedback,
  proposalStatus,
  proposalWorkspace,
  proposalError,
  onCreateProposal,
  onUpdateProposal,
  onApproveProposal,
  onExportProposal,
  onRecordProposalFollowUp,
  onSetTaskLifecycle,
  processingJob,
  onBack
}: TaskWorkspaceProps) {
  const { locale, t } = useLocaleText()
  const [lifecycleBusy, setLifecycleBusy] = useState(false)
  const [lifecycleError, setLifecycleError] = useState<string | null>(null)
  const [resultView, setResultView] = useState<TaskResultView>('primary')
  const canCancel = ['awaiting_input', 'planned', 'running', 'awaiting_review'].includes(task.status)
  const canRetry = task.status === 'cancelled' || task.status === 'failed'
  const primaryResultLabel =
    task.status === 'cancelled' || task.status === 'failed'
      ? t('暂停状态', '停止状態')
      : task.type === 'MATCH_CANDIDATES'
        ? t(`人员 ${candidateMatches.length}`, `要員 ${candidateMatches.length}`)
        : task.type === 'IMPORT_RESUME'
          ? t(
              `导入 ${task.contextBindings.filter((binding) => binding.objectType === 'staged-file').length}`,
              `取込 ${task.contextBindings.filter((binding) => binding.objectType === 'staged-file').length}`
            )
          : task.type === 'GENERATE_PROPOSAL'
            ? t('提案', '提案')
            : t('进度', '進行状況')

  useEffect(() => {
    setResultView('primary')
  }, [task.id])
  const setLifecycle = async (action: SetWorkTaskLifecycleInput['action']) => {
    if (lifecycleBusy) return
    setLifecycleBusy(true)
    setLifecycleError(null)
    try {
      await onSetTaskLifecycle({ taskId: task.id, action, expectedUpdatedAt: task.updatedAt })
    } catch (cause) {
      setLifecycleError(localizedIpcError(locale, cause, t('无法更新任务状态。', '作業状態を更新できませんでした。')))
    } finally {
      setLifecycleBusy(false)
    }
  }

  if (
    task.type === 'IMPORT_RESUME' &&
    task.status !== 'cancelled' &&
    task.status !== 'failed' &&
    candidateReviews.length > 0 &&
    analyses.length > 0
  ) {
    return (
      <ResumeProfileWorkspace
        aiCommerce={aiCommerce}
        analyses={analyses}
        lifecycleBusy={lifecycleBusy}
        lifecycleError={lifecycleError}
        onBack={onBack}
        onCancel={() => void setLifecycle('cancel')}
        onLoadOriginalDocument={onLoadOriginalDocument}
        onOpenCloudSettings={onOpenCloudSettings}
        onOpenOriginalDocument={onOpenOriginalDocument}
        onSendCloudPrompt={onSendCloudPrompt}
        onSubmit={onSubmitCandidateReview}
        reviews={candidateReviews}
        task={task}
      />
    )
  }

  return (
    <main className={task.type === 'GENERATE_PROPOSAL' ? 'task-workspace is-proposal' : 'task-workspace'}>
      <section className="task-thread">
        <button className="back-button" onClick={onBack} type="button">
          <Icon name="arrow-left" size={18} /> {t('返回今日任务', '今日の作業へ戻る')}
        </button>
        <header className="task-detail-header">
          <div className="task-title-line">
            <div>
              <span className={`task-status status-${task.status}`}>{workTaskStatusLabel(task.status, t)}</span>
              <h1>{localizedTaskTitle(locale, task)}</h1>
            </div>
            <div className="task-lifecycle-actions">
              {canCancel ? (
                <button disabled={lifecycleBusy} onClick={() => void setLifecycle('cancel')} type="button">
                  {t('取消任务', '作業をキャンセル')}
                </button>
              ) : null}
              {canRetry ? (
                <button disabled={lifecycleBusy} onClick={() => void setLifecycle('retry')} type="button">
                  {t('按相同范围重新执行', '同じ範囲で再実行')}
                </button>
              ) : null}
            </div>
          </div>
          <p>
            {t(`任务 ID：${task.id} · 策略：${task.privacy.policyVersion}`, `作業ID: ${task.id} · ポリシー: ${task.privacy.policyVersion}`)}
          </p>
          {lifecycleError ? (
            <p className="task-lifecycle-error" role="alert">
              {lifecycleError}
            </p>
          ) : null}
        </header>

        <TaskMessageTimeline task={task} />
        <TaskRecordSummary processingJob={processingJob} task={task} />

        <div className="continuation-card">
          <Icon name="lock" size={17} />
          <div>
            <strong>
              {task.type === 'IMPORT_RESUME'
                ? task.status === 'completed'
                  ? t('已登记本机人员档案', 'ローカル人材プロフィールを登録しました')
                  : t('可以按当前内容确认人员资料', '現在の内容で要員プロフィールを確認できます')
                : task.type === 'MATCH_CANDIDATES'
                  ? t('已搜索确认后的人员库', '確認済み要員プールを検索しました')
                  : task.type === 'GENERATE_PROPOSAL'
                    ? t('请确认提案内容与对外提供范围', '提案内容と外部提供範囲を確認してください')
                    : t('后续输入将在下一阶段实现', '継続入力は次の実装スライスで有効化します')}
            </strong>
            <p>
              {task.type === 'IMPORT_RESUME'
                ? task.status === 'completed'
                  ? t(
                      '确认值、修改原因、来源和确认人均加密保存；原始文件和标识符映射表隔离保存在本机。',
                      '確認値・変更理由・出典・確認者を暗号化保存し、原ファイルと識別子対応表は端末内に隔離しています。'
                    )
                  : t(
                      '原始文件和解析结果保存在本机；仅在姓名确认后才会确认并登记人员档案。',
                      '原ファイルと解析結果は端末内に保持されています。姓名確認後にのみ要員プロフィールを確定・登録します。'
                    )
                : task.type === 'MATCH_CANDIDATES'
                  ? t(
                      '匹配分数反映已确认字段的一致度，同时展示不匹配条件；人员录用与否由销售负责人判断。',
                      '適合スコアは確認済みフィールドの一致度です。未一致条件も表示し、要員の採否は営業担当が判断します。'
                    )
                  : task.type === 'GENERATE_PROPOSAL'
                    ? t(
                        '收件人、正文和脱敏 PDF 绑定到同一内容哈希；批准后也不会自动发送，仅导出本地提案包。',
                        '宛先・本文・脱敏PDFを同じ内容ハッシュに束ねます。承認後も自動送信せず、ローカルパッケージの書き出しだけを行います。'
                      )
                    : t(
                        '此开发版本目前实现了已确认任务的创建与状态展示。',
                        'この開発ビルドでは、確認済みタスクの作成と状態表示までを実装しています。'
                      )}
            </p>
          </div>
        </div>
      </section>

      <aside className="task-results-panel">
        <div className="results-heading">
          <span className="eyebrow">RESULT & CONTROL</span>
          <h2>{t('结果与治理', '結果と統制')}</h2>
        </div>
        <ResultControlTabs
          active={resultView}
          evidenceCount={task.evidenceCount}
          onChange={setResultView}
          primaryLabel={primaryResultLabel}
          taskId={task.id}
        />
        <div aria-labelledby={`task-result-tab-${task.id}-${resultView}`} id={`task-result-panel-${task.id}`} role="tabpanel">
          {resultView === 'evidence' ? (
            <TaskEvidenceView analyses={analyses} matches={candidateMatches} run={candidateMatchRun} task={task} />
          ) : resultView === 'governance' ? (
            <TaskGovernanceView processingJob={processingJob} task={task} />
          ) : task.status === 'cancelled' || task.status === 'failed' ? (
            <StoppedTaskResults task={task} />
          ) : task.type === 'GENERATE_PROPOSAL' ? (
            <ProposalWorkbench
              error={proposalError}
              onApprove={onApproveProposal}
              onCreate={onCreateProposal}
              onExport={onExportProposal}
              onRecordFollowUp={onRecordProposalFollowUp}
              onUpdate={onUpdateProposal}
              status={proposalStatus}
              taskId={task.id}
              workspace={proposalWorkspace}
            />
          ) : task.type === 'MATCH_CANDIDATES' ? (
            <MatchingResults
              error={candidateMatchError}
              matches={candidateMatches}
              onSubmitFeedback={onSubmitCandidateMatchFeedback}
              query={candidateMatchQuery}
              run={candidateMatchRun}
              status={candidateMatchStatus}
            />
          ) : task.type === 'IMPORT_RESUME' ? (
            <ResumeImportResults
              analyses={analyses}
              candidateReviews={candidateReviews}
              onSubmitCandidateReview={onSubmitCandidateReview}
              task={task}
            />
          ) : (
            <GenericTaskResults task={task} />
          )}
        </div>
      </aside>
    </main>
  )
}
