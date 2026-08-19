import { useEffect, useState } from 'react'
import { workTaskStatusLabels, type WorkTask } from '@domain'
import {
  candidateMatchSuitableReasonCodes,
  candidateMatchUnsuitableReasonCodes
} from '@shared/contracts'
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
import { localizedTaskTitle, useRendererUiRefresh, useUiLocale, useUiText } from '../i18n'
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

const feedbackReasonLabels: Record<CandidateMatchFeedbackReasonCode, string> = {
  overall_fit: '総合的に合う',
  strong_skill_fit: '必須スキルが強く一致',
  strong_project_fit: '関連プロジェクト経験が強い',
  commercial_fit: '単価・商流条件が合う',
  availability_fit: '稼働時期が合う',
  location_fit: '勤務地・通勤条件が合う',
  work_authorization_fit: '就労資格要件が合う',
  skill_mismatch: '必須スキル不足',
  insufficient_project_evidence: '関連プロジェクト根拠不足',
  rate_mismatch: '単価条件不一致',
  availability_mismatch: '稼働時期不一致',
  work_style_mismatch: '勤務形態不一致',
  japanese_mismatch: '日本語条件不一致',
  location_mismatch: '勤務地・通勤条件不一致',
  work_authorization_mismatch: '就労資格要件不一致',
  client_preference: '顧客条件・相性',
  stale_profile: 'プロフィールが古い',
  other: 'その他'
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
  const t = useUiText()
  const tabs: Array<{ id: TaskResultView; label: string }> = [
    { id: 'primary', label: t(primaryLabel) },
    { id: 'evidence', label: `証跡 ${evidenceCount}` },
    { id: 'governance', label: t('統制') }
  ]
  return <div aria-label="結果と統制の表示" className="results-tabs" role="tablist">
    {tabs.map((tab) => <button
      aria-controls={`task-result-panel-${taskId}`}
      aria-selected={active === tab.id}
      className={active === tab.id ? 'is-active' : ''}
      id={`task-result-tab-${taskId}-${tab.id}`}
      key={tab.id}
      onClick={() => onChange(tab.id)}
      role="tab"
      type="button"
    >{t(tab.label)}</button>)}
  </div>
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
  const locale = useUiLocale()
  const sourceLabels = [...new Set(matches.flatMap((candidate) => [
    ...candidate.evidence.flatMap((field) => field.sourceLabels),
    ...(candidate.projectEvidence?.sourceLabels ?? [])
  ]))]
  return <div className="task-evidence-view">
    <section className="task-control-overview">
      <header><Icon name="file" size={17} /><div><span>TRACEABLE RESULT</span><strong>この結果を支える証跡</strong></div></header>
      <dl>
        <div><dt>タスク証跡</dt><dd>{task.evidenceCount}件</dd></div>
        <div><dt>成果物</dt><dd>{task.artifacts.length}件</dd></div>
        <div><dt>実行監査</dt><dd>{task.toolAudits.length}件</dd></div>
        <div><dt>出典ラベル</dt><dd>{sourceLabels.length}件</dd></div>
      </dl>
      <p>原文・氏名・連絡先・ファイルパスはこのビューへ複製しません。確認済みの匿名結果と非機密ハッシュだけを表示します。</p>
    </section>

    {run ? <section className="task-ranking-evidence" aria-label="検索ランキング証跡">
      <header><div><span>LOCAL RETRIEVAL PIPELINE</span><strong>検索ランキング証跡</strong></div><em>Cloud不使用</em></header>
      <div className="task-ranking-pipeline">
        <span>三態Hard Filter</span><b>→</b><span>BM25</span><b>+</b><span>Profile/Project Vector</span><b>→</b><span>RRF</span><b>→</b><span>Local Rerank</span>
      </div>
      <dl>
        <div><dt>Algorithm</dt><dd>{run.algorithmVersion}</dd></div>
        <div><dt>Policy</dt><dd>{run.hardFilterPolicyVersion}</dd></div>
        <div><dt>Result Set Hash</dt><dd>{run.resultSetHash.slice(0, 12)}</dd></div>
        <div><dt>人工評価</dt><dd>{run.evaluation.feedbackCount} / {run.evaluation.resultCount}</dd></div>
      </dl>
    </section> : null}

    {matches.map((candidate) => {
      const labels = [...new Set([
        ...candidate.evidence.flatMap((field) => field.sourceLabels),
        ...(candidate.projectEvidence?.sourceLabels ?? [])
      ])]
      return <article className="task-candidate-evidence" key={candidate.matchResultId}>
        <header><div><span>RANK {candidate.retrieval.rank ?? '—'}</span><strong>{candidate.anonymousLabel}</strong></div><em>{candidate.matchScore ?? '—'}%</em></header>
        <div className="task-candidate-ranking">
          <span>BM25 #{candidate.retrieval.bm25Rank ?? '—'}</span>
          <span>Vector #{candidate.retrieval.vectorRank ?? '—'}</span>
          <span>RRF #{candidate.retrieval.preRerankRank ?? '—'}</span>
          <span>Rerank #{candidate.retrieval.rerankerRank ?? '—'}</span>
        </div>
        <ul>
          {candidate.evidence.map((field) => <li key={`${candidate.matchResultId}-${field.key}`}><strong>{field.label}</strong><span>{field.value ?? '未確認'}</span><small>{summarizeSourceLabels(field.sourceLabels, locale)}</small></li>)}
          {candidate.projectEvidence ? <li><strong>Project</strong><span>{candidate.projectEvidence.title}</span><small>{summarizeSourceLabels(candidate.projectEvidence.sourceLabels, locale)}</small></li> : null}
        </ul>
        <footer><Icon name="shield" size={13} />匿名結果 · Result Hash {candidate.matchResultHash.slice(0, 12)} · {summarizeSourceLabels(labels, locale)}</footer>
      </article>
    })}

    {analyses.map((analysis, index) => <article className="task-document-evidence" key={analysis.fileToken}>
      <header><div><span>LOCAL DOCUMENT {index + 1}</span><strong>解析・脱敏証跡</strong></div><em>{analysis.localProcessing.networkAccess ? 'Network' : 'No Network'}</em></header>
      <dl>
        <div><dt>Parser</dt><dd>{analysis.analysisVersion}</dd></div>
        <div><dt>OCR</dt><dd>{analysis.localProcessing.ocr}</dd></div>
        <div><dt>Pages / Sheets</dt><dd>{analysis.statistics.pages} / {analysis.statistics.sheets}</dd></div>
        <div><dt>姓名候補</dt><dd>{analysis.localProcessing.personNameCandidates}件 · 人工確認</dd></div>
      </dl>
      <div><span>{summarizeSourceLabels(
        analysis.extractedFields.flatMap((field) => field.sourceLabels).filter((label, item, labels) => labels.indexOf(label) === item),
        locale
      )}</span></div>
    </article>)}

    <section className="task-artifact-evidence">
      <h3>成果物と実行監査</h3>
      {task.artifacts.length === 0 ? <p>このタスクには保存済み成果物がまだありません。</p> : task.artifacts.map((artifact) => <article key={artifact.id}>
        <Icon name="file" size={14} /><span><strong>{artifact.label}</strong><small>{artifact.kind} · {artifact.status} · 直接識別子なし</small></span><em>{artifact.contentHash?.slice(0, 12) ?? 'hash待ち'}</em>
      </article>)}
      {task.toolAudits.map((audit) => <article key={audit.id}>
        <Icon name={audit.decision === 'executed' ? 'check' : 'alert'} size={14} /><span><strong>{audit.action}</strong><small>{audit.reason}</small></span><em>{audit.externalSideEffect} · {audit.cloudPayload === 'none' ? 'Cloudなし' : '脱敏済みのみ'}</em>
      </article>)}
    </section>
  </div>
}

function TaskGovernanceView({
  processingJob,
  task
}: {
  processingJob: ProcessingJobSummary | null
  task: WorkTask
}) {
  const cloudAuditCount = task.toolAudits.filter((audit) => audit.cloudPayload === 'redacted-only').length
  return <div className="task-governance-view">
    <section className="task-control-overview is-governance">
      <header><Icon name="shield" size={17} /><div><span>ENFORCED BOUNDARY</span><strong>データ範囲と実行境界</strong></div></header>
      <dl>
        <div><dt>対象データ</dt><dd>{task.scope.label}</dd></div>
        <div><dt>範囲詳細</dt><dd>{task.scope.detail}</dd></div>
        <div><dt>Privacy Policy</dt><dd>{task.privacy.policyVersion}</dd></div>
        <div><dt>直接識別子</dt><dd>Cloud送信 禁止</dd></div>
        <div><dt>Cloud実行</dt><dd>{cloudAuditCount === 0 ? '実行なし' : `脱敏済み ${cloudAuditCount}件`}</dd></div>
        <div><dt>自動送信</dt><dd>実装なし</dd></div>
      </dl>
    </section>

    <section className="task-governance-policy">
      <h3>強制ポリシー</h3>
      <div><Icon name="lock" size={14} /><span><strong>Rendererは範囲を拡大できない</strong><small>MainがScope、Schema、Preview Hashを再検証します。</small></span></div>
      <div><Icon name="shield" size={14} /><span><strong>PII/DLPをバイパスできない</strong><small>姓名確認とDLP証跡がない原文・画像はCloud Payloadになりません。</small></span></div>
      <div><Icon name="check" size={14} /><span><strong>判断は人が行う</strong><small>候補者の採否、案件確定、提案承認と外部提供は営業担当の責任です。</small></span></div>
    </section>

    <section className="task-approval-evidence">
      <h3>承認ゲート</h3>
      {task.approvalGates.map((gate) => <div key={gate.id}><Icon name={gate.status === 'approved' ? 'check' : 'clock'} size={14} /><span><strong>{gate.label}</strong><small>{gate.status === 'approved' ? `承認済み · ${gate.approvedBy ?? '確認者記録済み'}` : '確認完了まで外部副作用なし'}</small></span><em>{gate.status === 'approved' ? 'APPROVED' : 'REQUIRED'}</em></div>)}
    </section>

    <section className="task-replay-boundary">
      <header><span>RECOVERY POLICY</span><strong>{processingJob ? processingJob.replayPolicy === 'safe-local' ? '端末内で安全に再開可能' : '再実行前に人の確認が必要' : '実行ジョブなし'}</strong></header>
      {processingJob ? <dl>
        <div><dt>Status</dt><dd>{processingJobStatusLabels[processingJob.status]}</dd></div>
        <div><dt>Attempt</dt><dd>{processingJob.attemptCount} / {processingJob.maxAttempts}</dd></div>
        <div><dt>Progress</dt><dd>{processingJob.progress}%</dd></div>
        <div><dt>Cancel</dt><dd>{processingJob.cancelRequestedAt ? '要求済み' : '未要求'}</dd></div>
      </dl> : <p>このタスクに独立ProcessingJobはありません。タスク記録と承認状態はSQLCipherに保存されています。</p>}
    </section>

    <div className="review-gate"><Icon name="lock" size={18} /><div><strong>自動外部実行なし</strong><p>この画面は統制状態を説明するだけで、権限変更・メール送信・Cloud Provider有効化を行いません。</p></div></div>
  </div>
}

function CandidateMatchFeedbackControl({
  candidate,
  onSubmit
}: {
  candidate: CandidateMatchResult
  onSubmit(input: SubmitCandidateMatchFeedbackInput): Promise<SubmitCandidateMatchFeedbackResult>
}) {
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
      setError(cause instanceof Error ? cause.message : '評価を保存できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  if (!editing && localFeedback) {
    return <div className={`candidate-feedback-saved is-${localFeedback.decision}`}>
      <span>{localFeedback.decision === 'suitable' ? '合適' : '不合適'} · {feedbackReasonLabels[localFeedback.reasonCode]}</span>
      <small>{localFeedback.reviewerDisplayName} · 評価 Revision {localFeedback.revision}</small>
      <button onClick={() => setEditing(true)} type="button">評価を修正</button>
    </div>
  }

  return <div className="candidate-feedback-editor">
    <div className="candidate-feedback-decision" role="group" aria-label={`${candidate.anonymousLabel} の評価`}>
      <button className={decision === 'suitable' ? 'is-selected suitable' : ''} onClick={() => chooseDecision('suitable')} type="button">合適</button>
      <button className={decision === 'unsuitable' ? 'is-selected unsuitable' : ''} onClick={() => chooseDecision('unsuitable')} type="button">不合適</button>
      <span>営業判断を学習データではなく評価証跡として保存</span>
    </div>
    {decision ? <div className="candidate-feedback-fields">
      <label><span>理由</span><select aria-label={`${candidate.anonymousLabel} の評価理由`} onChange={(event) => setReasonCode(event.target.value as CandidateMatchFeedbackReasonCode | '')} value={reasonCode}>
        <option value="">選択してください</option>
        {reasons.map((reason) => <option key={reason} value={reason}>{feedbackReasonLabels[reason]}</option>)}
      </select></label>
      <label><span>補足（端末内のみ）</span><input aria-label={`${candidate.anonymousLabel} の評価補足`} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="必要な場合だけ入力" value={note} /></label>
      <button disabled={!reasonCode || (reasonCode === 'other' && note.trim().length < 3) || busy} onClick={() => void save()} type="button">{busy ? '保存中…' : '評価を保存'}</button>
    </div> : null}
    {error ? <p className="candidate-feedback-error" role="alert">{error}</p> : null}
  </div>
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
  const requestedTerms = (query.match(/"[^"]+"|'[^']+'|[^\s]+/gu) ?? [])
    .map((term) => term.replace(/^['"]|['"]$/gu, ''))
  return (
    <>
      <div className="matching-query-summary">
        <span>LOCAL AI RETRIEVAL · STAGE 4</span>
        <strong>{requestedTerms.join(' · ') || '構造化できる条件がありません'}</strong>
        <small>硬条件（不明は除外しない）→ BM25 + Profile/Project Vector → 候補者集約 → RRF → 端末内AI精査</small>
        {run ? <div className="matching-evaluation-summary">
          <span>評価 {run.evaluation.feedbackCount}/{run.evaluation.resultCount}</span>
          <span>Coverage {run.evaluation.coveragePercent}%</span>
          <span>{run.evaluation.judgedNdcgAt20 === null ? 'NDCG@20 評価待ち' : `Judged NDCG@20 ${run.evaluation.judgedNdcgAt20.toFixed(3)}`}</span>
          <span>Hard Filter {run.hardFilterPolicyVersion}</span>
          <span>Recall@20 は全量真値が揃うまで未算出</span>
        </div> : null}
      </div>
      <div className="candidate-list">
        {status === 'loading' ? (
          <div className="matching-state"><span className="matching-spinner" /><strong>確認済み候補者を検索中</strong><p>検索とスコア計算は端末内で実行しています。</p></div>
        ) : null}
        {status === 'error' ? (
          <div className="matching-state is-error"><Icon name="alert" size={18} /><strong>候補者を検索できませんでした</strong><p>{error}</p></div>
        ) : null}
        {status === 'ready' && matches.length === 0 ? (
          <div className="matching-state"><Icon name="users" size={18} /><strong>一致する確認済み候補者がありません</strong><p>候補者プロフィールを追加するか、検索条件を見直してください。</p></div>
        ) : null}
        {matches.map((candidate) => {
          const byKey = new Map(candidate.fields.map((field) => [field.key, field]))
          const skills = byKey.get('skills')?.value?.split(/\s*[,/、]\s*/u).filter(Boolean).slice(0, 6) ?? []
          const evidenceLabels = [...new Set([
            ...candidate.evidence.flatMap((field) => field.sourceLabels),
            ...(candidate.projectEvidence?.sourceLabels ?? [])
          ])]
          const matched = new Set(candidate.matchedTerms.map((term) => term.toLocaleLowerCase('ja-JP')))
          const missingTerms = requestedTerms.filter((term) => !matched.has(term.toLocaleLowerCase('ja-JP')))
          const unknownHardFilterCount = candidate.retrieval.hardFilters.filter((filter) => filter.outcome === 'unknown').length
          return (
          <article className="candidate-card" key={candidate.id}>
            <div className="candidate-title"><span className="match-dot" /><h3>{candidate.anonymousLabel}</h3><strong>{candidate.matchScore ?? '—'}%</strong></div>
            <div className="skill-row">{skills.map((skill) => <span key={skill}>{skill}</span>)}</div>
            <dl>
              <div><dt>経験</dt><dd>{byKey.get('experience_years')?.value ?? '未確認'}</dd></div>
              <div><dt>勤務</dt><dd>{byKey.get('work_style')?.value ?? '未確認'}</dd></div>
              <div><dt>単価</dt><dd>{byKey.get('rate')?.value ?? '未確認'}</dd></div>
              <div><dt>勤務地</dt><dd>{byKey.get('location')?.value ?? '未確認'}</dd></div>
              <div><dt>就労</dt><dd>{byKey.get('work_authorization')?.value ?? '未確認'}</dd></div>
            </dl>
            <div className="candidate-match-evidence">一致：{candidate.matchedTerms.join(' · ') || '条件なし'}</div>
            <CandidateHardFilterEvidence filters={candidate.retrieval.hardFilters} />
            {candidate.projectEvidence ? <div className="candidate-task-project-evidence">
              <span>PROJECT EVIDENCE · {candidate.projectEvidence.matchType.toUpperCase()}</span>
              <strong>{candidate.projectEvidence.title}</strong>
              <p>{candidate.projectEvidence.summary}</p>
              <small>{[candidate.projectEvidence.period, candidate.projectEvidence.role, ...candidate.projectEvidence.technologies.slice(0, 5)].filter(Boolean).join(' · ')}</small>
            </div> : null}
            {missingTerms.length > 0 ? <div className="candidate-match-missing">未一致：{missingTerms.join(' · ')}</div> : null}
            <div className="candidate-retrieval-line">
              <span>統合 Rank {candidate.retrieval.rank ?? '—'}</span>
              {candidate.retrieval.rerankerRank !== null ? <span>Rerank #{candidate.retrieval.rerankerRank}</span> : null}
              {candidate.retrieval.preRerankRank !== null ? <span>RRF #{candidate.retrieval.preRerankRank}</span> : null}
              {candidate.retrieval.bm25Rank !== null ? <span>BM25 #{candidate.retrieval.bm25Rank}</span> : null}
              {candidate.retrieval.vectorRank !== null ? <span>Vector #{candidate.retrieval.vectorRank}</span> : null}
              {candidate.retrieval.vectorScore !== null ? <span>類似 {Math.round(candidate.retrieval.vectorScore * 100)}%</span> : null}
              <span>条件網羅 {candidate.retrieval.termCoverage ?? 0}%</span>
              {candidate.retrieval.hardFilters.length > 0 ? (
                <span>{unknownHardFilterCount > 0 ? `硬条件 未確認${unknownHardFilterCount}件` : '硬条件 確認済み'}</span>
              ) : null}
            </div>
            <CandidateMatchFeedbackControl candidate={candidate} onSubmit={onSubmitFeedback} />
            <div className="candidate-source"><Icon name="shield" size={15} /> 確認済み候補者プール · {evidenceLabels.join(' · ') || 'HR確認済み'}</div>
          </article>
        )})}
      </div>
      <div className="review-gate">
        <Icon name="lock" size={18} />
        <div><strong>ヒューマン承認ゲート</strong><p>候補者の採否と提案対象は営業担当が決定します。</p></div>
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
  const allReviewsCompleted = fileCount > 0 && candidateReviews.length === fileCount && candidateReviews.every((review) => review.status === 'completed')
  return (
    <>
      <div className="result-summary-card success-summary">
        <div className="result-summary-title"><Icon name="check" size={17} /><h3>ローカル解析完了</h3></div>
        <dl>
          <div><dt>対象</dt><dd>{fileCount} ファイル</dd></div>
          <div><dt>保管</dt><dd>AES-256-GCM 暗号化</dd></div>
          <div><dt>出典</dt><dd>ページ・シート・セルを保持</dd></div>
          <div><dt>解析量</dt><dd>{totals.pages}ページ · {totals.sheets}シート · {totals.blocks}ブロック</dd></div>
          <div><dt>Project</dt><dd>{projectCount}件 · HR確認待ち</dd></div>
        </dl>
      </div>
      <div className={`result-summary-card ${allReviewsCompleted ? 'success-summary' : 'warning-summary'}`}>
        <div className="result-summary-title">
          <Icon name={allReviewsCompleted ? 'check' : 'alert'} size={17} />
          <h3>{allReviewsCompleted ? '候補者プロフィール保存完了' : '候補者プロフィール確認待ち'}</h3>
        </div>
        <p>
          {allReviewsCompleted
            ? '本人情報を含む候補者プロフィールを暗号化して端末内へ保存しました。採用通過までは人材プールや案件マッチングに入りません。'
            : 'ローカル解析が完了しました。未入力項目があっても現在の内容で候補者プロフィールを確認できます。'}
        </p>
        <div className="result-identifier-list">
          {[...identifierCounts.entries()].map(([type, count]) => <span key={type}>{type} × {count}</span>)}
          {identifierCounts.size === 0 ? <span>ルール一致なし</span> : null}
        </div>
      </div>
      {analyses.map((analysis) => (
        <div className="result-local-processing" key={`${analysis.fileToken}-local-processing`}>
          <Icon name="shield" size={15} />
          <span>
            <strong>{analysis.localProcessing.ocr === 'apple-vision-completed'
              ? 'Apple Vision OCR 完了'
              : analysis.localProcessing.ocr === 'windows-media-ocr-completed' || analysis.localProcessing.ocr === 'windows-tesseract-wasm-completed'
                ? 'Windows OCR 完了'
                : 'ローカル文書解析'}</strong>
            {analysis.localProcessing.ocrPages > 0 ? ` · ${analysis.localProcessing.ocrPages}ページ` : ''}
            {` · 姓名候補 ${analysis.localProcessing.personNameCandidates}件 · ネットワーク不使用`}
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
        <div><strong>Cloud Gateway は閉鎖中</strong><p>このタスクに有効な `dlpStatus=passed` の Cloud Payload は存在しません。</p></div>
      </div>
    </>
  )
}

function GenericTaskResults({ task }: { task: WorkTask }) {
  return (
    <>
      <div className="result-summary-card">
        <div className="result-summary-title"><Icon name="file" size={17} /><h3>{task.typeLabel}</h3></div>
        <p>許可されたデータ範囲と承認ゲートに沿って、次の実装スライスで結果ビューを接続します。</p>
      </div>
      <div className="review-gate"><Icon name="lock" size={18} /><div><strong>人の確認が必要</strong><p>外部送信や確定操作は自動実行されません。</p></div></div>
    </>
  )
}

function StoppedTaskResults({ task }: { task: WorkTask }) {
  return <>
    <div className="result-summary-card stopped-task-result">
      <div className="result-summary-title"><Icon name="alert" size={17} /><h3>{task.status === 'cancelled' ? '作業はキャンセル済みです' : '作業は要対応です'}</h3></div>
      <p>自動再実行や外部副作用はありません。左上の「同じ範囲で再実行」を選ぶと、元のデータ範囲を拡大せずに再開します。</p>
    </div>
    <div className="review-gate"><Icon name="lock" size={18} /><div><strong>停止中</strong><p>再実行を明示的に選ぶまで、候補者検索・提案生成・書き出しは実行されません。</p></div></div>
  </>
}

function TaskMessageTimeline({ task }: { task: WorkTask }) {
  const locale = useUiLocale()
  return <>
    {task.messages.map((message) => {
      const isUser = message.role === 'user'
      const isPlan = message.kind === 'plan'
      return <div className={`thread-message ${isUser ? 'user-message' : message.role === 'assistant' ? 'assistant-message' : 'system-message'}`} key={message.id}>
        <span className={isUser ? 'avatar dark' : message.role === 'assistant' ? 'assistant-avatar' : 'system-avatar'}>
          {isUser ? (locale === 'zh-CN' ? '用' : '山') : message.role === 'assistant' ? 'S' : <Icon name="shield" size={14} />}
        </span>
        <div className={message.role === 'assistant' ? 'assistant-content' : undefined}>
          <strong>{isUser ? 'あなた' : message.role === 'assistant' ? 'SESAI アシスタント' : '実行記録'}</strong>
          <p>{isUser ? localizedTaskTitle(locale, { id: task.id, title: message.content }) : message.content}</p>
          {isPlan ? <>
            <div className="workspace-plan">
              {task.steps.map((step) => (
                <div className="workspace-step" key={step.id}>
                  <span className={`step-icon step-${step.status}`}>
                    {step.status === 'completed' ? <Icon name="check" size={14} /> : step.status === 'running' ? 'Ⅱ' : step.status === 'blocked' ? '!' : '·'}
                  </span>
                  <div><strong>{step.title}</strong><small>{step.description}</small></div>
                  <span>{step.status === 'completed' ? '完了' : step.status === 'running' ? '処理中' : step.status === 'blocked' ? '確認待ち' : '待機'}</span>
                </div>
              ))}
            </div>
            <div className="source-grid">
              <div><Icon name="database" size={17} /><span>データ範囲<strong>{task.scope.label}</strong></span></div>
              <div><Icon name="shield" size={17} /><span>プライバシー<strong>脱敏ゲート強制</strong></span></div>
              <div><Icon name="file" size={17} /><span>証跡<strong>{task.evidenceCount}件</strong></span></div>
            </div>
          </> : null}
        </div>
      </div>
    })}
  </>
}

const processingJobStatusLabels: Record<ProcessingJobSummary['status'], string> = {
  queued: '待機中',
  running: '実行中',
  succeeded: '完了',
  retry_wait: '再試行待ち',
  failed: '要対応',
  cancelled: 'キャンセル'
}

function TaskRecordSummary({ task, processingJob }: { task: WorkTask; processingJob: ProcessingJobSummary | null }) {
  const approved = task.approvalGates.filter((gate) => gate.status === 'approved').length
  const latestAudit = task.toolAudits.at(-1)
  return <section className="task-record-summary" aria-label="暗号化された作業記録">
    <header><div><span>PERSISTED TASK RECORD</span><strong>再起動後も復元される作業記録</strong></div><em><Icon name="lock" size={13} /> SQLCipher</em></header>
    <dl>
      <div><dt>メッセージ</dt><dd>{task.messages.length}</dd></div>
      <div><dt>承認</dt><dd>{approved} / {task.approvalGates.length}</dd></div>
      <div><dt>成果物</dt><dd>{task.artifacts.length}</dd></div>
      <div><dt>実行監査</dt><dd>{task.toolAudits.length}</dd></div>
    </dl>
    {processingJob ? <div className={`processing-job-status is-${processingJob.status}`}>
      <div><span>PROCESSING JOB</span><strong>{processingJobStatusLabels[processingJob.status]}</strong></div>
      <div className="processing-job-progress"><span style={{ width: `${processingJob.progress}%` }} /></div>
      <small>試行 {processingJob.attemptCount} / {processingJob.maxAttempts} · {processingJob.replayPolicy === 'safe-local' ? '端末内で安全に再開可能' : '中断時は人の確認が必要'}</small>
    </div> : null}
    {latestAudit ? <p><Icon name={latestAudit.decision === 'executed' ? 'check' : 'alert'} size={14} /><span><strong>{latestAudit.action}</strong>{latestAudit.reason}</span><em>{latestAudit.cloudPayload === 'none' ? 'Cloud送信なし' : '脱敏済みのみ'}</em></p> : null}
  </section>
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
  useRendererUiRefresh()
  const locale = useUiLocale()
  const t = useUiText()
  const [lifecycleBusy, setLifecycleBusy] = useState(false)
  const [lifecycleError, setLifecycleError] = useState<string | null>(null)
  const [resultView, setResultView] = useState<TaskResultView>('primary')
  const canCancel = ['awaiting_input', 'planned', 'running', 'awaiting_review'].includes(task.status)
  const canRetry = task.status === 'cancelled' || task.status === 'failed'
  const primaryResultLabel = task.status === 'cancelled' || task.status === 'failed'
    ? '停止状態'
    : task.type === 'MATCH_CANDIDATES'
      ? `候補者 ${candidateMatches.length}`
      : task.type === 'IMPORT_RESUME'
        ? `取込 ${task.contextBindings.filter((binding) => binding.objectType === 'staged-file').length}`
        : task.type === 'GENERATE_PROPOSAL' ? '提案' : '進行状況'

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
      setLifecycleError(cause instanceof Error ? cause.message : '作業状態を更新できませんでした。')
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
          <Icon name="arrow-left" size={18} /> 今日の作業へ戻る
        </button>
        <header className="task-detail-header">
          <div className="task-title-line">
            <div><span className={`task-status status-${task.status}`}>{t(workTaskStatusLabels[task.status])}</span><h1>{localizedTaskTitle(locale, task)}</h1></div>
            <div className="task-lifecycle-actions">
              {canCancel ? <button disabled={lifecycleBusy} onClick={() => void setLifecycle('cancel')} type="button">作業をキャンセル</button> : null}
              {canRetry ? <button disabled={lifecycleBusy} onClick={() => void setLifecycle('retry')} type="button">同じ範囲で再実行</button> : null}
            </div>
          </div>
          <p>作業ID: {task.id} · ポリシー: {task.privacy.policyVersion}</p>
          {lifecycleError ? <p className="task-lifecycle-error" role="alert">{lifecycleError}</p> : null}
        </header>

        <TaskMessageTimeline task={task} />
        <TaskRecordSummary processingJob={processingJob} task={task} />

        <div className="continuation-card">
          <Icon name="lock" size={17} />
          <div>
            <strong>
              {task.type === 'IMPORT_RESUME'
                ? task.status === 'completed' ? 'ローカル人材プロフィールを登録しました' : '現在の内容で候補者プロフィールを確認できます'
                : task.type === 'MATCH_CANDIDATES'
                  ? '確認済み候補者プールを検索しました'
                : task.type === 'GENERATE_PROPOSAL'
                  ? '提案内容と外部提供範囲を確認してください'
                : '継続入力は次の実装スライスで有効化します'}
            </strong>
            <p>
              {task.type === 'IMPORT_RESUME'
                ? task.status === 'completed'
                  ? '確認値・変更理由・出典・確認者を暗号化保存し、原ファイルと識別子対応表は端末内に隔離しています。'
                  : '原ファイルと解析結果は端末内に保持されています。姓名確認後にのみ候補者プロフィールを確定・登録します。'
                : task.type === 'MATCH_CANDIDATES'
                  ? '適合スコアは確認済みフィールドの一致度です。未一致条件も表示し、候補者の採否は営業担当が判断します。'
                : task.type === 'GENERATE_PROPOSAL'
                  ? '宛先・本文・脱敏PDFを同じ内容ハッシュに束ねます。承認後も自動送信せず、ローカルパッケージの書き出しだけを行います。'
                : 'この開発ビルドでは、確認済みタスクの作成と状態表示までを実装しています。'}
            </p>
          </div>
        </div>
      </section>

      <aside className="task-results-panel">
        <div className="results-heading">
          <span className="eyebrow">RESULT & CONTROL</span>
          <h2>結果と統制</h2>
        </div>
        <ResultControlTabs
          active={resultView}
          evidenceCount={task.evidenceCount}
          onChange={setResultView}
          primaryLabel={primaryResultLabel}
          taskId={task.id}
        />
        <div
          aria-labelledby={`task-result-tab-${task.id}-${resultView}`}
          id={`task-result-panel-${task.id}`}
          role="tabpanel"
        >
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
