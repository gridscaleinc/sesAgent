import { useEffect, useRef, useState } from 'react'
import type { AssessmentFeedbackInput, CandidateReviewSnapshot, CasePersonAssessment, RequirementConfirmation } from '@shared'
import { proposalConclusion, requirementDecisionLimits, requirementIdentity } from '@shared'
import { useLocaleText } from '../i18n'
import { useExperienceExposure } from './experience-exposure'
import { AiOpinion } from './AiOpinion'
import { AssessmentEvaluationStatus } from './AssessmentEvaluationStatus'
import { RankingReason } from './RankingReason'
import { InterviewEvidencePanel } from './InterviewEvidencePanel'
import { ActionMenu } from './HrObjectList'
import { questionErrorMessage } from './BusinessInterviewQuestions'
import { ConclusionBadge, MatchDetail, conclusionTone, type ConclusionTone } from './MatchResultsLayout'
import { FollowUpTab, MatchEvidenceTab, followUpItems } from './RequirementTable'
import { AppliedRules, InterviewQuestionsSection, RelatedProjects, relatedProjects, useCaseQuestionDraft } from './MatchDetailSections'
import { tokyoDateTime } from './use-case-resume-assessments'
import { RecommendationPointsTab } from './RecommendationPoints'
import { AiWorking } from './AiWorking'
import './ai-work-rules.css'

export type MatchDetailTabId = 'evidence' | 'points' | 'follow-up' | 'ai' | 'questions' | 'record'

/** The selected person of a case's results: next steps in the header, the evaluation in tabs. */
export function CasePersonDetail({
  name,
  value,
  jobCaseId,
  reviewId,
  person,
  stale,
  archived,
  intakeNotice,
  status,
  blocked,
  followLabel,
  hasFollowUp,
  starting,
  tab,
  onTab,
  onBackToList,
  onRefresh,
  onReassess,
  reevaluationDisabled,
  onPrepare,
  onStart,
  onContinue,
  onOriginal,
  onPerson,
  library,
  working = ''
}: {
  name: string
  value: CasePersonAssessment
  jobCaseId: string
  reviewId: string
  person?: CandidateReviewSnapshot
  stale: boolean
  archived?: boolean
  /** A note above the result, e.g. that the uploaded résumé was someone already in the system. */
  intakeNotice?: string
  /** A badge replacing the conclusion, e.g. while the result is outdated. */
  status?: { tone: ConclusionTone; label: string }
  /** Why the next steps are unavailable; empty when they can be used. */
  blocked: string
  followLabel?: string
  hasFollowUp: boolean
  starting?: boolean
  tab: string
  onTab(id: MatchDetailTabId): void
  onBackToList(): void
  onRefresh(value: CasePersonAssessment): void
  onReassess?(request: string | null): void
  reevaluationDisabled?: boolean
  onPrepare?(value: CasePersonAssessment): void
  onStart?(): void
  onContinue?(value: CasePersonAssessment): void
  onOriginal?(documentId: string): void
  onPerson?(documentId: string): void
  /** Offered while the person was added for this case only. */
  library?: { saving: boolean; onAdd(): void } | null
  /** While the AI reassesses this person: the old result stays shown, read-only, under this progress label. */
  working?: string
}) {
  const { zh, t } = useLocaleText()
  const [running, setRunning] = useState(false),
    [workingLabel, setWorkingLabel] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [comparison, setComparison] = useState<CasePersonAssessment | null>(null)
  const draft = useCaseQuestionDraft(value.documentId, jobCaseId)
  const [questionRequest, setQuestionRequest] = useState(''),
    [assessRequest, setAssessRequest] = useState('')
  // What HR wants to raise with this person for this case, beyond what the requirements left open.
  const [ownQuestions, setOwnQuestions] = useState<RequirementConfirmation[]>([]),
    [ownQuestion, setOwnQuestion] = useState('')
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [decision, setDecision] = useState<AssessmentFeedbackInput['decision']>('suitable')
  const [reason, setReason] = useState<AssessmentFeedbackInput['reason']>('evidence'),
    [note, setNote] = useState('')
  const questionInput = useRef<HTMLTextAreaElement>(null),
    assessInput = useRef<HTMLTextAreaElement>(null)
  const lock = useRef(false)
  useEffect(() => {
    setComparison(null)
    setError('')
    setNotice('')
    setFeedbackOpen(false)
  }, [value.id])
  const requirementKeys = (value.result.qualification?.requirements ?? []).map((item) => requirementIdentity(item.requirement)).join('|')
  const showOwnQuestions = (confirmations: RequirementConfirmation[]) => {
    const keys = new Set(requirementKeys.split('|'))
    setOwnQuestions(
      confirmations.filter(
        (item) => item.scope === 'pair' && item.jobCaseId === jobCaseId && item.outcome === 'asking' && !keys.has(item.requirementKey)
      )
    )
  }
  useEffect(() => {
    let active = true
    setOwnQuestion('')
    Promise.resolve(window.sesAgent.listRequirementConfirmations?.(value.documentId))
      .then((confirmations) => {
        if (active && confirmations) showOwnQuestions(confirmations)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [value.documentId, jobCaseId, requirementKeys])
  const addOwnQuestion = () => {
    const question = ownQuestion.trim()
    if (!question || !window.sesAgent.decideRequirement) return
    void run(async () => {
      const result = await window.sesAgent.decideRequirement!({
        documentId: value.documentId,
        jobCaseId,
        requirement: { key: 'hr_question', label: question, category: 'condition' },
        outcome: 'asking',
        scope: 'pair',
        note: null,
        question
      })
      showOwnQuestions(result.confirmations)
      setOwnQuestion('')
    })
  }
  const removeOwnQuestion = (id: string) =>
    void run(async () => {
      if (!window.sesAgent.withdrawRequirementDecision) return
      showOwnQuestions((await window.sesAgent.withdrawRequirementDecision({ id, documentId: value.documentId })).confirmations)
    })
  /** `aiLabel` names a cloud AI call, shown with the working animation; a local save shows none. */
  const run = async (work: () => Promise<void>, aiLabel = '') => {
    if (lock.current) return
    lock.current = true
    setRunning(true)
    setWorkingLabel(aiLabel)
    setError('')
    setNotice('')
    try {
      await work()
    } catch (cause) {
      setError(questionErrorMessage(cause, zh, t('操作失败，请重试。', '操作に失敗しました。もう一度お試しください。')))
    } finally {
      lock.current = false
      setRunning(false)
    }
  }
  // A local AI call of this panel, or the reassessment the results page is running for it.
  const busy = running || Boolean(working)
  const exposureRoot = useRef<HTMLElement>(null)
  useExperienceExposure(exposureRoot, value.result.experienceRunId ?? '')
  const reassess = () => {
    const request = assessRequest.trim() || null
    if (onReassess) {
      onReassess(request)
      setAssessRequest('')
    } else
      void run(
        async () => {
          onRefresh(await window.sesAgent.assessCasePerson({ jobCaseId, documentId: value.documentId, ...(request ? { request } : {}) }))
          setAssessRequest('')
        },
        t('AI 正在重新评估…', 'AIが再評価しています…')
      )
  }
  const generateQuestions = () =>
    void run(
      async () => {
        draft.setQuestions(
          (
            await window.sesAgent.generateRuleQuestions({
              jobCaseId,
              documentId: value.documentId,
              ...(questionRequest.trim() ? { request: questionRequest.trim() } : {})
            })
          ).questions
        )
        draft.setStale(false)
      },
      t('AI 正在生成面试问题…', 'AIが面談質問を作成しています…')
    )
  const confirmQuestions = value.appliedRules.filter((rule) => rule.kind === 'confirm').map((rule) => rule.text)
  const followCount = followUpItems(value.result.qualification, confirmQuestions)
  // What the model itself suggests confirming: unverified, listed apart from the rule-based items.
  const aiConfirm = stale ? [] : (value.result.assessment?.opinion?.confirm ?? [])
  const followTotal =
    followCount.items.length + followCount.questions.length + followCount.asking.length + ownQuestions.length + aiConfirm.length
  const projects = relatedProjects(person, value.result.qualification?.requirements ?? [])
  const actionsBlocked = Boolean(blocked) || Boolean(starting)
  const staleNotice = t(
    '资料或规则已更新，旧结论已停用。请重新评估。',
    '情報またはルールが更新されたため、過去の結論は無効です。再評価してください。'
  )
  const assessForm = (
    <div className="match-inline-form">
      <textarea
        ref={assessInput}
        className="ai-request-input"
        aria-label={t('对 AI 评估的要求', 'AI評価への要望')}
        placeholder={t('例：重点看日语沟通能力', '例：日本語での対応力を重点的に')}
        rows={2}
        maxLength={500}
        disabled={busy || reevaluationDisabled}
        value={assessRequest}
        onChange={(event) => setAssessRequest(event.target.value)}
      />
      <button type="button" disabled={busy || reevaluationDisabled} onClick={reassess}>
        {stale ? t('重新评估', '再評価') : t('重新给出意见', '意見を出し直す')}
      </button>
    </div>
  )
  const tabs = [
    {
      id: 'evidence',
      label: t('匹配依据', 'マッチングの根拠'),
      content: stale ? (
        <p className="match-muted">{staleNotice}</p>
      ) : (
        <MatchEvidenceTab
          qualification={value.result.qualification}
          pair={archived ? undefined : { documentId: value.documentId, jobCaseId }}
        />
      )
    },
    {
      id: 'points',
      label: t('推荐要点', '推薦ポイント'),
      content: (
        <RecommendationPointsTab
          documentId={value.documentId}
          reviewId={reviewId}
          blocked={stale ? t('匹配结果已过期，请先重新评估。', 'マッチング結果が古くなっています。先に再評価してください。') : blocked}
        />
      )
    },
    {
      id: 'follow-up',
      label: followTotal ? t(`需沟通 (${followTotal})`, `要相談 (${followTotal})`) : t('需沟通', '要相談'),
      content: stale ? (
        <p className="match-muted">{staleNotice}</p>
      ) : (
        <>
          <FollowUpTab
            qualification={value.result.qualification}
            questions={confirmQuestions}
            hideEmpty={ownQuestions.length > 0 || aiConfirm.length > 0}
          />
          {aiConfirm.length ? (
            <section className="match-rule-questions">
              <h4>{t('AI 建议确认', 'AIが挙げた確認事項')}</h4>
              <ul>
                {aiConfirm.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <small className="match-muted">
                {t('AI 自己写的内容，没有和简历原文核对。', 'AIが書いた内容で、履歴書の原文とは照合していません。')}
              </small>
            </section>
          ) : null}
          <section className="match-rule-questions is-asking">
            <h4>{t('我要沟通的问题', '自分で確認したいこと')}</h4>
            {ownQuestions.length ? (
              <ul>
                {ownQuestions.map((item) => (
                  <li key={item.id}>
                    {item.question ?? item.requirementLabel}{' '}
                    <button type="button" disabled={busy} onClick={() => removeOwnQuestion(item.id)}>
                      {t('删除', '削除')}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="match-inline-form">
              <textarea
                className="ai-request-input"
                aria-label={t('要沟通的问题', '確認したいこと')}
                placeholder={t('例：能否接受每周两天出社？', '例：週2日の出社は可能ですか？')}
                rows={2}
                maxLength={requirementDecisionLimits.label}
                disabled={busy}
                value={ownQuestion}
                onChange={(event) => setOwnQuestion(event.target.value)}
              />
              <button type="button" disabled={busy || !ownQuestion.trim()} onClick={addOwnQuestion}>
                {t('添加', '追加')}
              </button>
            </div>
          </section>
        </>
      )
    },
    {
      id: 'ai',
      label: t('AI 意见', 'AIの意見'),
      content: (
        <div className="match-ai">
          {stale ? (
            <p className="match-muted">{staleNotice}</p>
          ) : (
            <>
              <AiOpinion opinion={value.result.assessment?.opinion} zh={zh} />
              <AssessmentEvaluationStatus value={value} zh={zh} />
              {assessForm}
            </>
          )}
          <RankingReason ranking={value.result.ranking} zh={zh} />
          <AppliedRules rules={value.appliedRules} />
          {value.appliedRules.length ? (
            <button
              type="button"
              disabled={busy || stale}
              onClick={() =>
                void run(
                  async () =>
                    setComparison(await window.sesAgent.assessCasePerson({ jobCaseId, documentId: value.documentId, withoutRules: true })),
                  t('AI 正在做不加规则的对照评估…', 'AIがルールなしの比較評価をしています…')
                )
              }
            >
              {t('查看不加规则的评估', 'ルールなしの評価と比較')}
            </button>
          ) : null}
          {comparison ? (
            <aside className="match-comparison">
              <strong>{t('不加 HR 规则的对照评估', 'HRルールなしの比較評価')}</strong>
              <p>
                {comparison.result.assessment
                  ? proposalConclusion(comparison.result.qualification, zh)
                  : t('AI 评估未完成，暂时无法比较', 'AI評価が未完了のため比較できません')}
                {comparison.result.assessment?.reason ? `：${comparison.result.assessment.reason}` : ''}
              </p>
              <small>{t('两次评估也可能受到模型输出波动影响。', 'モデルの出力変動も評価差に影響します。')}</small>
            </aside>
          ) : null}
        </div>
      )
    },
    {
      id: 'questions',
      label: t('面试问题', '面談質問'),
      content: (
        <InterviewQuestionsSection questions={draft.questions} stale={draft.stale} error={draft.error} onCopied={setNotice}>
          <div className="match-inline-form">
            <textarea
              ref={questionInput}
              className="ai-request-input"
              aria-label={t('对 AI 的要求', 'AIへの要望')}
              placeholder={t('例：加上团队管理的问题', '例：チーム管理に関する質問を加えて')}
              rows={2}
              maxLength={500}
              disabled={busy || stale}
              value={questionRequest}
              onChange={(event) => setQuestionRequest(event.target.value)}
            />
            <button type="button" disabled={busy || stale} onClick={generateQuestions}>
              {draft.questions.length ? t('重新生成面试问题', '面談質問を再生成') : t('生成面试问题', '面談質問を生成')}
            </button>
          </div>
        </InterviewQuestionsSection>
      )
    },
    {
      id: 'record',
      label: t('记录', '記録'),
      content: (
        <div className="match-record">
          <p className="case-assessment-time">
            {t('评估时间', '評価日時')}：{tokyoDateTime(value.assessedAt, zh)}
          </p>
          {feedbackOpen ? (
            <div className="case-assessment-feedback">
              <label>
                {t('我的判断', '自分の判断')}
                <select value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}>
                  <option value="suitable">{t('适合继续', '進めたい')}</option>
                  <option value="unsuitable">{t('本次不继续', '今回は見送る')}</option>
                </select>
              </label>
              <label>
                {t('主要原因', '主な理由')}
                <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
                  {(
                    [
                      { key: 'evidence', label: { zh: '项目证据', ja: '案件実績' } },
                      { key: 'skills', label: { zh: '技能', ja: 'スキル' } },
                      { key: 'rate', label: { zh: '单价', ja: '単価' } },
                      { key: 'availability', label: { zh: '档期', ja: '稼働時期' } },
                      { key: 'work-style', label: { zh: '工作方式', ja: '勤務形態' } },
                      { key: 'language', label: { zh: '沟通语言', ja: '業務言語' } },
                      { key: 'interest', label: { zh: '本人意向', ja: '本人の意向' } },
                      { key: 'case-closed', label: { zh: '案件已关闭', ja: '案件終了' } },
                      { key: 'other', label: { zh: '其他', ja: 'その他' } }
                    ] as const
                  ).map(({ key, label }) => (
                    <option key={key} value={key}>
                      {t(label.zh, label.ja)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('补充说明', '補足')}
                <input maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await window.sesAgent.saveAssessmentFeedback({ assessmentId: value.id, decision, reason, note })
                    setFeedbackOpen(false)
                    setNotice(t('判断已保存，已关联本次评估。', '今回の評価に判断を保存しました。'))
                  })
                }
              >
                {t('保存判断', '判断を保存')}
              </button>
            </div>
          ) : (
            <button type="button" disabled={busy || stale} onClick={() => setFeedbackOpen(true)}>
              {t('记录我的判断', '自分の判断を記録')}
            </button>
          )}
          <RelatedProjects projects={projects} />
          <InterviewEvidencePanel documentId={value.documentId} reviewId={reviewId} />
        </div>
      )
    }
  ] as const
  const badge = status ?? {
    tone: conclusionTone(value.result.qualification),
    label: proposalConclusion(value.result.qualification, zh)
  }
  return (
    <MatchDetail
      label={name}
      rootRef={exposureRoot}
      experienceRun={value.result.experienceRunId}
      title={name}
      badge={<ConclusionBadge tone={badge.tone}>{badge.label}</ConclusionBadge>}
      status={followLabel ? <span className="match-detail-status">{followLabel}</span> : null}
      onBackToList={onBackToList}
      tab={tab}
      onTab={(id) => onTab(id as MatchDetailTabId)}
      tabs={[...tabs]}
      actions={
        <>
          {onPrepare ? (
            <button
              type="button"
              className="hr-primary"
              disabled={actionsBlocked}
              title={blocked || undefined}
              onClick={() => onPrepare(value)}
            >
              {t('准备介绍', '紹介を準備')}
            </button>
          ) : null}
          {hasFollowUp ? (
            <button type="button" disabled={starting} onClick={() => onContinue?.(value)}>
              {t('继续跟进', '対応を続ける')}
            </button>
          ) : onStart ? (
            <button type="button" disabled={actionsBlocked} title={blocked || undefined} onClick={onStart}>
              {t('开始跟进', '対応を開始')}
            </button>
          ) : null}
          <ActionMenu
            label={t('更多操作', 'その他の操作')}
            trigger={<span aria-hidden="true">⋯</span>}
            triggerClassName="match-menu-trigger"
          >
            <button
              type="button"
              role="menuitem"
              disabled={busy || reevaluationDisabled}
              onClick={() => {
                if (!stale) onTab('ai')
                setTimeout(() => assessInput.current?.focus())
              }}
            >
              {t('重新评估（可附要求）', '再評価（要望を添えて）')}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy || stale}
              onClick={() => {
                onTab('questions')
                setTimeout(() => questionInput.current?.focus())
              }}
            >
              {draft.questions.length ? t('重新生成面试问题', '面談質問を再生成') : t('生成面试问题', '面談質問を生成')}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy || stale}
              onClick={() => {
                onTab('record')
                setFeedbackOpen(true)
              }}
            >
              {t('记录我的判断', '自分の判断を記録')}
            </button>
            {onOriginal ? (
              <button type="button" role="menuitem" onClick={() => onOriginal(value.documentId)}>
                {t('查看原简历', '元の履歴書を見る')}
              </button>
            ) : null}
            {library ? (
              <button
                type="button"
                role="menuitem"
                disabled={library.saving}
                title={t('仅用于本案件；加入后可在人员页查找。', 'この案件専用です。追加すると要員ページで探せます。')}
                onClick={library.onAdd}
              >
                {library.saving ? t('加入中…', '追加中…') : t('加入人员库', '要員リストに追加')}
              </button>
            ) : null}
            {onPerson ? (
              <button type="button" role="menuitem" onClick={() => onPerson(value.documentId)}>
                {t('查看人员资料', '要員情報を見る')}
              </button>
            ) : null}
          </ActionMenu>
        </>
      }
      notice={
        <>
          {intakeNotice ? <p role="status">{intakeNotice}</p> : null}
          {archived ? (
            <p>
              {t(
                '复用了已归档简历进行本次评估，原记录仍保持归档。',
                'アーカイブ済み履歴書を今回の評価に再利用しました。元の記録はアーカイブのままです。'
              )}
            </p>
          ) : null}
          {value.request ? (
            <p className="assessment-request">
              {t('本次评估按你的要求侧重：', '今回の評価で重視した点：')}
              {value.request}
            </p>
          ) : null}
          {stale ? <p role="status">{staleNotice}</p> : null}
          {!stale && !value.result.assessment ? (
            <p role="status">
              {t(
                '匹配度评估未完成，当前结论只核对了简历中的明确条件，可重新评估。',
                '適合度の評価が未完了のため、履歴書の明確な条件のみで判断しています。再評価できます。'
              )}
            </p>
          ) : null}
          {blocked ? <small className="match-blocked">{blocked}</small> : null}
          {stale ? assessForm : null}
          {working ? <AiWorking label={working} /> : running && workingLabel ? <AiWorking label={workingLabel} /> : null}
          {error ? <p role="alert">{error}</p> : null}
          {notice ? <p role="status">{notice}</p> : null}
        </>
      }
    />
  )
}
