import { useExperienceExposure } from './experience-exposure'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AssessmentFeedbackInput, CandidateInterviewQuestion, CasePersonAssessment } from '@shared'
import { proposalConclusion } from '@shared'
import { BusinessMatchEvidence } from './BusinessMatchEvidence'
import { AiOpinion } from './AiOpinion'
import { AssessmentEvaluationStatus } from './AssessmentEvaluationStatus'
import { RankingReason } from './RankingReason'
import { tokyoDateTime } from './use-case-resume-assessments'
import { useLocaleText } from '../i18n'
import { InterviewQuestionCard, interviewPreparationSheet, questionErrorMessage } from './BusinessInterviewQuestions'
import './ai-work-rules.css'

export function AssessmentCard({
  value,
  name,
  jobCaseId,
  stale,
  archived,
  onRefresh,
  onReassess,
  reevaluationDisabled,
  moreTools
}: {
  value: CasePersonAssessment
  name: string
  jobCaseId: string
  stale: boolean
  archived?: boolean
  onRefresh(value: CasePersonAssessment): void
  onReassess?(request: string | null): void
  reevaluationDisabled?: boolean
  /** Panel-owned secondary controls (such as saving to the library) shown with this card's tools. */
  moreTools?: ReactNode
}) {
  const { zh, t } = useLocaleText()
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [comparison, setComparison] = useState<CasePersonAssessment | null>(null)
  const [questions, setQuestions] = useState<CandidateInterviewQuestion[]>([])
  const [draftStale, setDraftStale] = useState(false)
  const [questionRequest, setQuestionRequest] = useState(''),
    [assessRequest, setAssessRequest] = useState('')
  // The draft is saved per person and case when generated, so reopening the card shows it again.
  useEffect(() => {
    let active = true
    Promise.resolve(window.sesAgent.getCaseQuestionDraft?.({ documentId: value.documentId, jobCaseId }))
      .then((view) => {
        if (!active || !view?.draft) return
        setQuestions(view.draft.questions)
        setDraftStale(view.stale)
      })
      .catch((cause) => {
        if (active)
          setError(
            `${t('无法读取面试题草案', '質問案を読み込めません')}: ${questionErrorMessage(cause, zh, t('请稍后重试。', 'しばらくしてから再試行してください。'))}`
          )
      })
    return () => {
      active = false
    }
  }, [jobCaseId, value.documentId])
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [decision, setDecision] = useState<AssessmentFeedbackInput['decision']>('suitable')
  const [reason, setReason] = useState<AssessmentFeedbackInput['reason']>('evidence'),
    [note, setNote] = useState('')
  const lock = useRef(false)
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await work()
    } catch (cause) {
      setError(questionErrorMessage(cause, zh, t('操作失败，请重试。', '操作に失敗しました。もう一度お試しください。')))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const fit = (v: CasePersonAssessment) => proposalConclusion(v.result.qualification, zh)
  const exposureRoot = useRef<HTMLElement>(null)
  useExperienceExposure(exposureRoot, value.result.experienceRunId ?? '')
  const reassessControls = (
    <>
      <input
        className="ai-request-input"
        aria-label={t('对 AI 评估的要求', 'AI評価への要望')}
        placeholder={t('例：重点看日语沟通能力', '例：日本語での対応力を重点的に')}
        maxLength={500}
        disabled={busy || reevaluationDisabled}
        value={assessRequest}
        onChange={(event) => setAssessRequest(event.target.value)}
      />
      <button
        disabled={busy || reevaluationDisabled}
        onClick={() => {
          const request = assessRequest.trim() || null
          if (onReassess) {
            onReassess(request)
            setAssessRequest('')
          } else
            void run(async () => {
              onRefresh(
                await window.sesAgent.assessCasePerson({ jobCaseId, documentId: value.documentId, ...(request ? { request } : {}) })
              )
              setAssessRequest('')
            })
        }}
      >
        {t('重新评估', '再評価')}
      </button>
    </>
  )
  return (
    <article ref={exposureRoot} data-experience-run={value.result.experienceRunId} className="case-assessment-card" aria-label={name}>
      <h4>{name}</h4>
      {archived ? (
        <p>
          {t(
            '复用了已归档简历进行本次评估，原记录仍保持归档。',
            'アーカイブ済み履歴書を今回の評価に再利用しました。元の記録はアーカイブのままです。'
          )}
        </p>
      ) : null}
      <p className="case-assessment-time">
        {t('评估时间', '評価日時')}：{tokyoDateTime(value.assessedAt, zh)}
      </p>
      {value.request ? (
        <p className="assessment-request">
          {t('本次评估按你的要求侧重：', '今回の評価で重視した点：')}
          {value.request}
        </p>
      ) : null}
      {stale ? (
        <>
          <p role="status">
            {t(
              '资料或规则已更新，旧结论已停用。请重新评估。',
              '情報またはルールが更新されたため、過去の結論は無効です。再評価してください。'
            )}
          </p>
          {/* A stale result needs reassessment first, so the control is not tucked away in the tools. */}
          <div className="work-rule-actions">{reassessControls}</div>
        </>
      ) : (
        <>
          <BusinessMatchEvidence
            qualification={value.result.qualification}
            questions={value.appliedRules.filter((rule) => rule.kind === 'confirm').map((rule) => rule.text)}
            zh={zh}
          />
          <AiOpinion opinion={value.result.assessment?.opinion} zh={zh} />
        </>
      )}
      {!stale && !value.result.assessment ? (
        <p role="status">
          {t(
            '匹配度评估未完成，当前结论只核对了简历中的明确条件，可重新评估。',
            '適合度の評価が未完了のため、履歴書の明確な条件のみで判断しています。再評価できます。'
          )}
        </p>
      ) : null}
      {busy ? <p role="status">{t('正在处理…', '処理中…')}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <details className="case-assessment-more">
        <summary>{t('更多工具', 'その他のツール')}</summary>
        <div className="work-rule-actions">
          {stale ? null : reassessControls}
          <input
            className="ai-request-input"
            aria-label={t('对 AI 的要求', 'AIへの要望')}
            placeholder={t('例：加上团队管理的问题', '例：チーム管理に関する質問を加えて')}
            maxLength={500}
            disabled={busy || stale}
            value={questionRequest}
            onChange={(event) => setQuestionRequest(event.target.value)}
          />
          <button
            disabled={busy || stale}
            onClick={() =>
              void run(async () => {
                setQuestions(
                  (
                    await window.sesAgent.generateRuleQuestions({
                      jobCaseId,
                      documentId: value.documentId,
                      ...(questionRequest.trim() ? { request: questionRequest.trim() } : {})
                    })
                  ).questions
                )
                setDraftStale(false)
              })
            }
          >
            {questions.length ? t('重新生成面试问题', '面談質問を再生成') : t('生成面试问题', '面談質問を生成')}
          </button>
          {value.appliedRules.length ? (
            <button
              disabled={busy || stale}
              onClick={() =>
                void run(async () =>
                  setComparison(await window.sesAgent.assessCasePerson({ jobCaseId, documentId: value.documentId, withoutRules: true }))
                )
              }
            >
              {t('查看不加规则的评估', 'ルールなしの評価と比較')}
            </button>
          ) : null}
          <button disabled={busy || stale} onClick={() => setFeedbackOpen((open) => !open)}>
            {t('记录我的判断', '自分の判断を記録')}
          </button>
        </div>
        {comparison ? (
          <aside>
            <strong>{t('不加 HR 规则的对照评估', 'HRルールなしの比較評価')}</strong>
            <p>
              {comparison.result.assessment ? fit(comparison) : t('AI 评估未完成，暂时无法比较', 'AI評価が未完了のため比較できません')}
              {comparison.result.assessment?.reason ? `：${comparison.result.assessment.reason}` : ''}
            </p>
            <small>{t('两次评估也可能受到模型输出波动影响。', 'モデルの出力変動も評価差に影響します。')}</small>
          </aside>
        ) : null}
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
        ) : null}
        {moreTools}
      </details>
      <details className="case-assessment-details">
        <summary>{t('详情', '詳細')}</summary>
        {!stale ? <AssessmentEvaluationStatus value={value} zh={zh} /> : null}
        {value.appliedRules.length ? (
          <details className="work-rule-applied">
            <summary>
              {t('本次使用的规则', '今回適用したルール')} ({value.appliedRules.length})
            </summary>
            <ul>
              {value.appliedRules.map((rule, i) => (
                <li key={i}>
                  v{rule.revision} · {rule.text}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <RankingReason ranking={value.result.ranking} zh={zh} />
      </details>
      {questions.length ? (
        <section>
          <h4>{t('本次面试问题', '今回の面談質問')}</h4>
          {draftStale ? (
            <p role="status">
              {t(
                '资料或规则已更新，这份面试题草案已过期，请重新生成。',
                '情報またはルールが更新されたため、この質問案は古くなっています。再生成してください。'
              )}
            </p>
          ) : (
            <p>
              {t(
                '已随本人员与案件保存，开始跟进后会带入第一轮面试。',
                '要員と案件に紐づけて保存済みです。対応を開始すると第1回面談に引き継がれます。'
              )}
            </p>
          )}
          <div className="interview-question-list">
            {questions.map((question, index) => (
              <InterviewQuestionCard key={question.id} question={question} index={index} zh={zh} editable={false} />
            ))}
          </div>
          <button
            onClick={() =>
              void run(async () => {
                await navigator.clipboard.writeText(interviewPreparationSheet(questions, zh))
                setNotice(t('问题已复制。', '質問をコピーしました。'))
              })
            }
          >
            {t('复制问题', '質問をコピー')}
          </button>
          <p>
            {t('进入对应案件的面试跟进后，可以生成并保存本轮正式问题单。', 'この案件の面談対応画面で、今回の質問票を生成・保存できます。')}
          </p>
        </section>
      ) : null}
    </article>
  )
}
