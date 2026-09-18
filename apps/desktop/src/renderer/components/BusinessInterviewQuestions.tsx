import { useEffect, useRef, useState } from 'react'
import type { BusinessFollowUp, CandidateInterviewQuestion, CandidateInterviewSnapshot } from '@shared'
import { useUiLocale } from '../i18n'
import { useBusinessProgress } from '../business-progress-data'
import './ai-work-rules.css'

export function BusinessInterviewQuestions({ follow, round, disabled, onSaved }: {
  follow: BusinessFollowUp; round: CandidateInterviewSnapshot; disabled: boolean; onSaved(): void
}) {
  const zh = useUiLocale() === 'zh-CN'; const t = (cn: string, ja: string) => zh ? cn : ja
  const shared = useBusinessProgress()
  const [questions, setQuestions] = useState<CandidateInterviewQuestion[] | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const lock = useRef(false)
  const [draftNotice, setDraftNotice] = useState('')
  // Round one starts from the draft generated at assessment time; a stale draft is only reported, never carried over.
  useEffect(() => {
    if (round.questionPlan?.length || round.roundNumber !== 1 || round.decision) return
    let active = true
    Promise.resolve(window.sesAgent.getCaseQuestionDraft?.({ documentId: follow.documentId, reviewId: follow.reviewId })).then((view) => {
      if (!active || !view?.draft) return
      if (view.stale) { setDraftNotice(t('评估时生成的面试题草案已过期（资料或规则已更新），请重新生成。', '評価時の質問案は情報またはルールの更新で古くなっています。再生成してください。')); return }
      setQuestions(view.draft.questions); setDraftNotice(t('已带入评估时生成的面试题草案，可调整后保存到本轮。', '評価時に生成した質問案を引き継ぎました。調整して今回の面談に保存できます。'))
    }).catch((cause) => { if (active) setError(`${t('无法读取面试题草案', '質問案を読み込めません')}: ${cause instanceof Error ? cause.message : String(cause)}`) })
    return () => { active = false }
  }, [round.id])
  const run = async (work: () => Promise<void>) => { if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice(''); try { await work() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { lock.current = false; setBusy(false) } }
  const shown = questions ?? round.questionPlan ?? []
  return <details className="case-rule-tools"><summary>{t('本轮面试问题', '今回の面談質問')} ({shown.filter((q) => q.selected).length})</summary>
    <p>{t('结合当前案件、人员简历、AI 工作规则和上轮待确认事项生成问题。', '現在の案件、履歴書、AI業務ルール、前回の確認事項から質問を生成します。')}</p>
    <button disabled={disabled || busy || Boolean(round.decision)} onClick={() => void run(async () => {
      const result = await window.sesAgent.generateRuleQuestions({ documentId: follow.documentId, interviewId: round.id })
      setQuestions(result.questions)
    })}>{busy ? t('处理中…', '処理中…') : t('按案件与规则生成问题', '案件とルールから質問を生成')}</button>
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}{draftNotice ? <p role="status">{draftNotice}</p> : null}
    <ol className="case-assessment-questions">{shown.map((question) => <li key={question.id}><label><input type="checkbox" disabled={disabled || busy || Boolean(round.decision)} checked={question.selected} onChange={(event) => setQuestions(shown.map((q) => q.id === question.id ? { ...q, selected: event.target.checked } : q))} />{t('采用此题', 'この質問を採用')}</label><textarea aria-label={t('编辑面试问题', '面談質問を編集')} maxLength={500} rows={2} value={question.text} disabled={disabled || busy || Boolean(round.decision)} onChange={event=>setQuestions(shown.map(q=>q.id===question.id?{...q,text:event.target.value}:q))} />
      <p>{question.sourceLabel ?? question.requirement}{question.bankQuestionId?<small> · {t('结合题库改写','質問集を基に調整')}</small>:null}</p>{question.evidence ? <p>{t('简历依据', '履歴書の根拠')}：{question.evidence}</p> : null}<small>{t('评价要点', '評価の観点')}：{question.scoringGuide}</small>{question.followUp ? <small>{t('追问', '追加質問')}：{question.followUp}</small> : null}
    </li>)}</ol>
    {questions ? <button disabled={disabled || busy || Boolean(round.decision) || questions.some(q=>!q.text.trim())} onClick={() => void run(async () => {
      const saved = await window.sesAgent.advanceBusinessProgress({ documentId: follow.documentId, reviewId: follow.reviewId, expectedRevision: follow.revision, mutationId: crypto.randomUUID(), action: 'prepare', roundNumber: round.roundNumber, questions })
      shared?.publish([saved]); setQuestions(null); setNotice(t('本轮问题已保存。', '今回の質問を保存しました。')); onSaved(); window.dispatchEvent(new Event('ses-business-data-changed'))
    })}>{t('保存本轮问题', '今回の質問を保存')}</button> : null}
  </details>
}

/** Before the first round exists, tells HR that assessment-time questions are waiting for it. */
export function CaseQuestionDraftNotice({ follow }: { follow: BusinessFollowUp }) {
  const zh = useUiLocale() === 'zh-CN'; const t = (cn: string, ja: string) => zh ? cn : ja
  const [view, setView] = useState<{ count: number; stale: boolean } | null>(null)
  useEffect(() => {
    let active = true
    Promise.resolve(window.sesAgent.getCaseQuestionDraft?.({ documentId: follow.documentId, reviewId: follow.reviewId })).then((result) => {
      if (active && result?.draft) setView({ count: result.draft.questions.length, stale: result.stale })
    }).catch(() => undefined)
    return () => { active = false }
  }, [follow.documentId, follow.reviewId, follow.revision])
  if (!view) return null
  return <p className="hr-followup-message" role="status">{view.stale
    ? t('评估时生成的面试题草案已过期，安排面试后请重新生成。', '評価時の質問案は古くなっています。面談手配後に再生成してください。')
    : t(`评估时已生成 ${view.count} 道面试题，安排面试后会带入第一轮。`, `評価時に作成した質問 ${view.count} 件は、面談手配後に第1回へ引き継がれます。`)}</p>
}
