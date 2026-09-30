import { useEffect, useRef, useState } from 'react'
import type { BusinessFollowUp, CandidateInterviewQuestion, CandidateInterviewSnapshot } from '@shared'
import { interviewDimensionLabels, interviewQuestionDimensions } from '@shared'
import { aiServiceProblem, localizedAiServiceProblem, useLocaleText, localeText } from '../i18n'
import { useBusinessProgress } from '../business-progress-data'
import './ai-work-rules.css'

type Dimension = (typeof interviewQuestionDimensions)[number]

/** Questions saved before the field existed only carry the dimension at the head of sourceLabel. */
export function questionDimension(question: CandidateInterviewQuestion): Dimension | null {
  if (question.dimension) return question.dimension
  const head = question.sourceLabel?.split(' · ')[0]?.trim()
  return (
    interviewQuestionDimensions.find(
      (dimension) => interviewDimensionLabels[dimension].zh === head || interviewDimensionLabels[dimension].ja === head
    ) ?? null
  )
}

const warningStart = /(?:^|[。．.!！?？;；\n]\s*)(?:警戒サイン|警戒|注意信号|注意点|注意|警示|危险信号|要注意|需注意|red flags?|warning)/iu
/** The scoring guide is written as what a strong answer contains, then one warning sign. */
export function splitScoringGuide(text: string | null | undefined): { strong: string; warning: string | null } {
  const value = (text ?? '').trim()
  const match = warningStart.exec(value)
  if (!match) return { strong: value, warning: null }
  const cut = match.index + (match[0].match(/^[。．.!！?？;；\n]\s*/u)?.[0].length ?? 0)
  if (cut === 0) return { strong: value, warning: null }
  return { strong: value.slice(0, cut).trim(), warning: value.slice(cut).trim() }
}

/** Main answers with "中文 / 日本語" messages behind Electron's IPC prefix; show the operator's half only. */
export function questionErrorMessage(cause: unknown, zh: boolean, fallback: string): string {
  const problem = aiServiceProblem(cause)
  if (problem) return localizedAiServiceProblem(zh ? 'zh-CN' : 'ja-JP', problem)
  const raw = (cause instanceof Error ? cause.message : String(cause ?? ''))
    .replace(/^(?:Error: )?Error invoking remote method '[^']+':\s*(?:[A-Za-z]+:\s*)?/u, '')
    .trim()
  if (!raw || /^[\[{]/u.test(raw) || /^(?:ZodError|TypeError|SqliteError|SQLITE_|Error:) /u.test(raw)) return fallback
  const [cn, ja] = raw.split(' / ')
  return (zh ? cn : (ja ?? cn))?.trim() || fallback
}

const sourceItems = (list: string[] | undefined, joined: string | undefined): string[] =>
  list?.length
    ? list
    : (joined ?? '')
        .split(' / ')
        .map((item) => item.trim())
        .filter(Boolean)

/** Plain-text preparation sheet: the same shape the recruiting workspace copies. */
export function interviewPreparationSheet(questions: CandidateInterviewQuestion[], zh: boolean): string {
  const t = localeText(zh)

  return questions
    .flatMap((question, index) => {
      const guide = splitScoringGuide(question.scoringGuide)
      return [
        `${index + 1}. ${question.text}`,
        question.followUp?.trim() ? `   ${t('追问', '追加質問')}: ${question.followUp.trim()}` : null,
        guide.strong ? `   ${t('好回答', '良い回答')}: ${guide.strong}` : null,
        guide.warning ? `   ${t('注意', '注意')}: ${guide.warning}` : null,
        `   ${t('评分', '評価')}: ☐ ${t('满足', '充足')}  ☐ ${t('部分', '一部')}  ☐ ${t('未确认', '未確認')}`,
        ''
      ]
    })
    .filter((line): line is string => line !== null)
    .join('\n')
}

export function InterviewQuestionCard({
  question,
  index,
  zh,
  editable,
  onChange
}: {
  question: CandidateInterviewQuestion
  index: number
  zh: boolean
  editable: boolean
  onChange?(next: CandidateInterviewQuestion): void
}) {
  const t = localeText(zh)
  const dimension = questionDimension(question)
  const guide = splitScoringGuide(question.scoringGuide)
  const requirements = sourceItems(question.requirementItems, question.requirement)
  const evidences = sourceItems(question.evidenceItems, question.evidence)
  const update = (patch: Partial<CandidateInterviewQuestion>) => onChange?.({ ...question, ...patch })
  return (
    <article
      className={`interview-question-card${question.selected ? '' : ' is-skipped'}${dimension ? ` dim-${dimension}` : ''}`}
      aria-label={`${t('问题', '質問')} ${index + 1}`}
    >
      <header>
        <span className="interview-question-index">{String(index + 1).padStart(2, '0')}</span>
        {dimension ? <span className="interview-dimension">{interviewDimensionLabels[dimension][zh ? 'zh' : 'ja']}</span> : null}
        {question.bankQuestionId ? <span className="interview-dimension is-bank">{t('题库改写', '質問集を調整')}</span> : null}
        {onChange ? (
          <label className="interview-switch">
            <input
              type="checkbox"
              checked={question.selected}
              disabled={!editable}
              onChange={(event) => update({ selected: event.target.checked })}
            />
            <span>{t('采用', '採用')}</span>
          </label>
        ) : null}
      </header>
      {editable && onChange ? (
        <textarea
          className="interview-question-text"
          aria-label={t('编辑面试问题', '面談質問を編集')}
          maxLength={500}
          rows={Math.max(2, Math.ceil(question.text.length / 38))}
          value={question.text}
          onChange={(event) => update({ text: event.target.value })}
        />
      ) : (
        <p className="interview-question-text">{question.text}</p>
      )}
      {question.followUp !== undefined && question.followUp !== null ? (
        <div className="interview-followup">
          <span>↳ {t('追问', '追加質問')}</span>
          {editable && onChange ? (
            <input
              aria-label={t('编辑追问', '追加質問を編集')}
              maxLength={200}
              value={question.followUp}
              onChange={(event) => update({ followUp: event.target.value })}
            />
          ) : (
            <span>{question.followUp}</span>
          )}
        </div>
      ) : null}
      {guide.strong || guide.warning ? (
        <dl className="interview-guide">
          {guide.strong ? (
            <div>
              <dt>✓ {t('好回答', '良い回答')}</dt>
              <dd>{guide.strong}</dd>
            </div>
          ) : null}
          {guide.warning ? (
            <div className="is-warning">
              <dt>⚠ {t('注意', '注意')}</dt>
              <dd>{guide.warning}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {requirements.length || evidences.length ? (
        <details className="interview-sources">
          <summary>
            {t('依据', '根拠')} · {t('案件要求', '案件要件')} {requirements.length} · {t('简历', '履歴書')} {evidences.length}
          </summary>
          {requirements.length ? (
            <div className="interview-requirements">
              {requirements.map((item, i) => (
                <span key={i}>{item}</span>
              ))}
            </div>
          ) : null}
          {evidences.map((item, i) => (
            <blockquote key={i}>{item}</blockquote>
          ))}
        </details>
      ) : null}
    </article>
  )
}

export function BusinessInterviewQuestions({
  follow,
  round,
  disabled,
  onSaved
}: {
  follow: BusinessFollowUp
  round: CandidateInterviewSnapshot
  disabled: boolean
  onSaved(saved: BusinessFollowUp): void
}) {
  const { zh, t } = useLocaleText()
  const shared = useBusinessProgress()
  const [questions, setQuestions] = useState<CandidateInterviewQuestion[] | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const lock = useRef(false)
  const [draftNotice, setDraftNotice] = useState(''),
    [draftStale, setDraftStale] = useState(false),
    [fromDraft, setFromDraft] = useState(false)
  const [request, setRequest] = useState('')
  // Round one starts from the draft generated at assessment time; a stale draft is only reported, never carried over.
  useEffect(() => {
    if (round.questionPlan?.length || round.roundNumber !== 1 || round.decision) return
    let active = true
    Promise.resolve(window.sesAgent.getCaseQuestionDraft?.({ documentId: follow.documentId, reviewId: follow.reviewId }))
      .then((view) => {
        if (!active || !view?.draft) return
        if (view.stale) {
          setDraftStale(true)
          setDraftNotice(
            t(
              '评估时生成的面试题草案已过期（资料或规则已更新），请重新生成。',
              '評価時の質問案は情報またはルールの更新で古くなっています。再生成してください。'
            )
          )
          return
        }
        setQuestions(view.draft.questions)
        setFromDraft(true)
        setDraftNotice(
          t(
            '已带入评估时生成的面试题草案，可调整后保存到本轮。',
            '評価時に生成した質問案を引き継ぎました。調整して今回の面談に保存できます。'
          )
        )
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
  }, [round.id])
  const failed = (cause: unknown) =>
    questionErrorMessage(cause, zh, t('操作失败，请重试。', '操作に失敗しました。もう一度お試しください。'))
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await work()
    } catch (cause) {
      setError(failed(cause))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const locked = disabled || busy || Boolean(round.decision)
  const shown = questions ?? round.questionPlan ?? []
  const selectedCount = shown.filter((question) => question.selected).length
  const dirty = questions !== null
  return (
    <section className="interview-questions" aria-label={t('本轮面试问题', '今回の面談質問')}>
      <header className="interview-questions-header">
        <div>
          <h4>{t('本轮面试问题', '今回の面談質問')}</h4>
          <small>
            {t('第', '第')} {round.roundNumber} {t('轮', '回')} · {t('已采用', '採用')} {selectedCount} / {shown.length}
            {fromDraft ? ` · ${t('来自评估草案', '評価時の質問案')}` : ''}
            {round.decision
              ? ` · ${t('本轮已记录结果，问题只读', '今回の結果は記録済みのため読み取り専用')}`
              : !dirty && shown.length
                ? ` · ${t('已保存到本轮', '今回の面談に保存済み')}`
                : ''}
          </small>
        </div>
        <div className="work-rule-actions interview-questions-tools">
          <input
            className="ai-request-input"
            aria-label={t('对 AI 的要求', 'AIへの要望')}
            placeholder={t('例：加上团队管理的问题', '例：チーム管理に関する質問を加えて')}
            maxLength={500}
            disabled={locked}
            value={request}
            onChange={(event) => setRequest(event.target.value)}
          />
          <button
            disabled={locked}
            onClick={() =>
              void run(async () => {
                const result = await window.sesAgent.generateRuleQuestions({
                  documentId: follow.documentId,
                  interviewId: round.id,
                  ...(request.trim() ? { request: request.trim() } : {})
                })
                setQuestions(result.questions)
                setFromDraft(false)
                setDraftStale(false)
                setDraftNotice('')
              })
            }
          >
            {busy
              ? t('处理中…', '処理中…')
              : shown.length
                ? t('重新生成', '再生成')
                : t('按案件与规则生成问题', '案件とルールから質問を生成')}
          </button>
          <button
            disabled={!selectedCount}
            onClick={() =>
              void run(async () => {
                await navigator.clipboard.writeText(
                  interviewPreparationSheet(
                    shown.filter((question) => question.selected),
                    zh
                  )
                )
                setNotice(t('已复制面试准备表。', '面談準備表をコピーしました。'))
              })
            }
          >
            {t('复制准备表', '準備表をコピー')}
          </button>
        </div>
      </header>
      {draftNotice ? (
        <p className={`hr-followup-message${draftStale ? ' is-error' : ''}`} role="status">
          {draftNotice}
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {shown.length ? (
        <div className="interview-question-list">
          {shown.map((question, index) => (
            <InterviewQuestionCard
              key={question.id}
              question={question}
              index={index}
              zh={zh}
              editable={!locked}
              onChange={(next) => setQuestions(shown.map((item) => (item.id === next.id ? next : item)))}
            />
          ))}
        </div>
      ) : (
        <p className="interview-questions-empty">
          {t(
            '还没有本轮问题。结合当前案件、人员简历、AI 工作规则和上轮待确认事项生成。',
            '今回の質問はまだありません。案件、履歴書、AI業務ルール、前回の確認事項から生成します。'
          )}
        </p>
      )}
      {/* Only unsaved edits need an always-reachable save; otherwise nothing is pinned over the questions. */}
      {dirty ? (
        <footer className="interview-questions-footer">
          <small>{t('有未保存的修改。', '未保存の変更があります。')}</small>

          <button
            className="is-primary"
            disabled={locked || questions.some((question) => !question.text.trim())}
            onClick={() =>
              void run(async () => {
                const saved = await window.sesAgent.advanceBusinessProgress({
                  documentId: follow.documentId,
                  reviewId: follow.reviewId,
                  expectedRevision: follow.revision,
                  mutationId: crypto.randomUUID(),
                  action: 'prepare',
                  roundNumber: round.roundNumber,
                  questions
                })
                shared?.publish([saved])
                setQuestions(null)
                setFromDraft(false)
                setDraftNotice('')
                setNotice(t('本轮问题已保存。', '今回の質問を保存しました。'))
                onSaved(saved)
                window.dispatchEvent(new Event('ses-business-data-changed'))
              })
            }
          >
            {t('保存本轮问题', '今回の質問を保存')} ({selectedCount})
          </button>
        </footer>
      ) : null}
    </section>
  )
}

/** Before the first round exists, tells HR that assessment-time questions are waiting for it. */
export function CaseQuestionDraftNotice({ follow }: { follow: BusinessFollowUp }) {
  const { zh, t } = useLocaleText()
  const [view, setView] = useState<{ count: number; stale: boolean } | null>(null)
  useEffect(() => {
    let active = true
    Promise.resolve(window.sesAgent.getCaseQuestionDraft?.({ documentId: follow.documentId, reviewId: follow.reviewId }))
      .then((result) => {
        if (active && result?.draft) setView({ count: result.draft.questions.length, stale: result.stale })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [follow.documentId, follow.reviewId, follow.revision])
  if (!view) return null
  return (
    <p className="hr-followup-message" role="status">
      {view.stale
        ? t('评估时生成的面试题草案已过期，安排面试后请重新生成。', '評価時の質問案は古くなっています。面談手配後に再生成してください。')
        : t(
            `评估时已生成 ${view.count} 道面试题，安排面试后会带入第一轮。`,
            `評価時に作成した質問 ${view.count} 件は、面談手配後に第1回へ引き継がれます。`
          )}
    </p>
  )
}
