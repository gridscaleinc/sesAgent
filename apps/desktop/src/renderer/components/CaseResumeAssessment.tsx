import { useExperienceExposure } from './experience-exposure'
import { useEffect, useRef, useState } from 'react'
import type { AssessmentFeedbackInput, CandidateInterviewQuestion, CandidateReviewSnapshot, CasePersonAssessment, JobCaseReviewSnapshot } from '@shared'
import { businessMatchingPolicyVersion, proposalConclusion } from '@shared'
import { BusinessMatchEvidence } from './BusinessMatchEvidence'
import { AssessmentEvaluationStatus } from './AssessmentEvaluationStatus'
import { useUiLocale } from '../i18n'
import { AiWorkRulesPanel, workRulesChangedEvent } from './AiWorkRulesPanel'
import './ai-work-rules.css'

export function AssessmentCard({ value, name, jobCaseId, stale, archived, onRefresh, onReassess, reevaluationDisabled }: { value: CasePersonAssessment; name: string; jobCaseId: string; stale: boolean; archived?: boolean; onRefresh(value: CasePersonAssessment): void; onReassess?(): void; reevaluationDisabled?: boolean }) {
  const zh = useUiLocale() === 'zh-CN'; const t = (cn: string, ja: string) => zh ? cn : ja
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [comparison, setComparison] = useState<CasePersonAssessment | null>(null)
  const [questions, setQuestions] = useState<CandidateInterviewQuestion[]>([])
  const [draftStale, setDraftStale] = useState(false)
  // The draft is saved per person and case when generated, so reopening the card shows it again.
  useEffect(() => {
    let active = true
    Promise.resolve(window.sesAgent.getCaseQuestionDraft?.({ documentId: value.documentId, jobCaseId })).then((view) => {
      if (!active || !view?.draft) return
      setQuestions(view.draft.questions); setDraftStale(view.stale)
    }).catch((cause) => { if (active) setError(`${t('无法读取面试题草案', '質問案を読み込めません')}: ${cause instanceof Error ? cause.message : String(cause)}`) })
    return () => { active = false }
  }, [jobCaseId, value.documentId])
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [decision, setDecision] = useState<AssessmentFeedbackInput['decision']>('suitable')
  const [reason, setReason] = useState<AssessmentFeedbackInput['reason']>('evidence'), [note, setNote] = useState('')
  const lock = useRef(false)
  const run = async (work: () => Promise<void>) => { if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice(''); try { await work() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { lock.current = false; setBusy(false) } }
  const fit = (v: CasePersonAssessment) => proposalConclusion(v.result.qualification, zh)
  const exposureRoot = useRef<HTMLElement>(null)
  useExperienceExposure(exposureRoot, value.result.experienceRunId ?? '')
  return <article ref={exposureRoot} data-experience-run={value.result.experienceRunId} className="case-assessment-card" aria-label={name}>
    <h4>{name}</h4>
    {archived ? <p>{t('复用了已归档简历进行本次评估，原记录仍保持归档。', 'アーカイブ済み履歴書を今回の評価に再利用しました。元の記録はアーカイブのままです。')}</p> : null}
    <p>{new Date(value.assessedAt).toLocaleString()}</p>
    {stale ? <p role="status">{t('资料或规则已更新，旧结论已停用。请重新评估。', '情報またはルールが更新されたため、過去の結論は無効です。再評価してください。')}</p>
      : <BusinessMatchEvidence qualification={value.result.qualification} questions={value.appliedRules.filter(rule => rule.kind === 'confirm').map(rule => rule.text)} zh={zh} />}
    {!stale ? <AssessmentEvaluationStatus value={value} zh={zh} /> : null}
    {value.appliedRules.length ? <details className="work-rule-applied"><summary>{t('本次使用的规则', '今回適用したルール')} ({value.appliedRules.length})</summary><ul>{value.appliedRules.map((rule, i) => <li key={i}>v{rule.revision} · {rule.text}</li>)}</ul></details> : null}
    <div className="work-rule-actions"><button disabled={busy || reevaluationDisabled} onClick={() => onReassess ? onReassess() : void run(async () => onRefresh(await window.sesAgent.assessCasePerson({ jobCaseId, documentId: value.documentId })))}>{t('重新评估', '再評価')}</button>
      <button disabled={busy || stale} onClick={() => void run(async () => { setQuestions((await window.sesAgent.generateRuleQuestions({ jobCaseId, documentId: value.documentId })).questions); setDraftStale(false) })}>{questions.length ? t('重新生成面试问题', '面談質問を再生成') : t('生成面试问题', '面談質問を生成')}</button>
      {value.appliedRules.length ? <button disabled={busy || stale} onClick={() => void run(async () => setComparison(await window.sesAgent.assessCasePerson({ jobCaseId, documentId: value.documentId, withoutRules: true })))}>{t('查看不加规则的评估', 'ルールなしの評価と比較')}</button> : null}
      <button disabled={busy || stale} onClick={() => setFeedbackOpen((open) => !open)}>{t('记录我的判断', '自分の判断を記録')}</button>
    </div>
    {busy ? <p role="status">{t('正在处理…', '処理中…')}</p> : null}{error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    {comparison ? <aside><strong>{t('不加 HR 规则的对照评估', 'HRルールなしの比較評価')}</strong><p>{comparison.result.assessment ? fit(comparison) : t('AI 评估未完成，暂时无法比较', 'AI評価が未完了のため比較できません')}{comparison.result.assessment?.reason ? `：${comparison.result.assessment.reason}` : ''}</p><small>{t('两次评估也可能受到模型输出波动影响。', 'モデルの出力変動も評価差に影響します。')}</small></aside> : null}
    {feedbackOpen ? <div className="case-assessment-feedback"><label>{t('我的判断', '自分の判断')}<select value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}><option value="suitable">{t('适合推进', '進めたい')}</option><option value="unsuitable">{t('本次不推进', '今回は見送る')}</option></select></label><label>{t('主要原因', '主な理由')}<select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>{([['evidence','项目证据','案件実績'],['skills','技能','スキル'],['rate','单价','単価'],['availability','档期','稼働時期'],['work-style','工作方式','勤務形態'],['language','沟通语言','業務言語'],['interest','本人意向','本人の意向'],['case-closed','案件已关闭','案件終了'],['other','其他','その他']] as const).map(([key,cn,ja]) => <option key={key} value={key}>{t(cn,ja)}</option>)}</select></label><label>{t('补充说明', '補足')}<input maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label><button disabled={busy} onClick={() => void run(async () => { await window.sesAgent.saveAssessmentFeedback({ assessmentId: value.id, decision, reason, note }); setFeedbackOpen(false); setNotice(t('判断已保存，已关联本次评估。', '今回の評価に判断を保存しました。')) })}>{t('保存判断', '判断を保存')}</button></div> : null}
    {questions.length ? <section><h4>{t('本次面试问题', '今回の面談質問')}</h4>{draftStale ? <p role="status">{t('资料或规则已更新，这份面试题草案已过期，请重新生成。', '情報またはルールが更新されたため、この質問案は古くなっています。再生成してください。')}</p> : <p>{t('已随本人员与案件保存，安排面试后会带入第一轮。', '要員と案件に紐づけて保存済みです。面談手配後、第1回に引き継がれます。')}</p>}<ol className="case-assessment-questions">{questions.map((question) => <li key={question.id}><strong>{question.text}</strong><p>{question.sourceLabel}</p><small>{t('评价要点', '評価の観点')}：{question.scoringGuide}</small>{question.followUp ? <small>{t('追问', '追加質問')}：{question.followUp}</small> : null}</li>)}</ol><button onClick={() => void run(async () => { await navigator.clipboard.writeText(questions.map((q, i) => `${i + 1}. ${q.text}\n${q.sourceLabel ?? ''}\n${q.scoringGuide ?? ''}${q.followUp ? `\n${q.followUp}` : ''}`).join('\n\n')); setNotice(t('问题已复制。', '質問をコピーしました。')) })}>{t('复制问题', '質問をコピー')}</button><p>{t('进入对应案件的面试跟进后，可以生成并保存本轮正式问题单。', 'この案件の面談対応画面で、今回の質問票を生成・保存できます。')}</p></section> : null}
  </article>
}

export function CaseResumeAssessment({ job, cases, people = [] }: { job: JobCaseReviewSnapshot; cases: JobCaseReviewSnapshot[]; people?: CandidateReviewSnapshot[] }) {
  const zh = useUiLocale() === 'zh-CN'; const t = (cn: string, ja: string) => zh ? cn : ja
  const [items, setItems] = useState<Array<{ name: string; assessment: CasePersonAssessment | null; documentId: string; error?: string; archived?: boolean }>>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState(''), [dragging, setDragging] = useState(false)
  const [selected, setSelected] = useState(''), [rulesRevision, setRulesRevision] = useState<number | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const lock = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const jobCaseId = job.jobCase?.id
  useEffect(() => {
    let active = true
    const update = () => { if (window.sesAgent.listWorkRules) void window.sesAgent.listWorkRules().then((value) => { if (active) setRulesRevision(value.revision) }).catch(() => { if (active) setError(t('规则状态读取失败，请重试。', 'ルール状態を読み込めません。再試行してください。')) }) }
    update(); window.addEventListener(workRulesChangedEvent, update)
    return () => { active = false; window.removeEventListener(workRulesChangedEvent, update) }
  }, [])
  const add = (value: CasePersonAssessment, name: string) => setItems((current) => [{ name, documentId: value.documentId, assessment: value, archived: current.find(item => item.documentId === value.documentId)?.archived ?? people.find(person => person.documentId === value.documentId)?.recordStatus === 'archived' }, ...current.filter((item) => item.documentId !== value.documentId)])
  const perform = async (work: () => Promise<void>) => {
    if (lock.current || !jobCaseId) return
    lock.current = true; setBusy(true); setError('')
    try { await work() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { lock.current = false; setBusy(false); setProgress(''); if (inputRef.current) inputRef.current.value = '' }
  }
  const importFiles = (files: File[]) => perform(async () => {
    if (!files.length || files.length > 10) throw new Error(t('每次请选择 1～10 份简历。', '履歴書は1〜10件選択してください。'))
    for (const [index, file] of files.entries()) {
      setProgress(`${index + 1}/${files.length} · ${file.name}`)
      try {
        if (file.size > 30 * 1024 * 1024) throw new Error(t('文件超过 30 MB。', 'ファイルが30 MBを超えています。'))
        const result = await window.sesAgent.importResumeForCase({ jobCaseId: jobCaseId!, file: { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } })
        const name = result.person.localIdentity?.displayName ?? result.person.fileName
        setItems((current) => [{ name, documentId: result.person.documentId, assessment: result.assessment, error: result.error ?? undefined, archived: result.person.recordStatus === 'archived' }, ...current.filter((item) => item.documentId !== result.person.documentId)])
        window.dispatchEvent(new Event('ses-business-data-changed'))
      } catch (cause) { setItems((current) => [{ name: file.name, documentId: `failed-${index}-${Date.now()}`, assessment: null, error: cause instanceof Error ? cause.message : String(cause) }, ...current]) }
    }
  })
  if (!jobCaseId || job.lifecycle !== 'active') return null
  return <section className="case-resume-assessment" aria-label={t('当前案件简历评估', 'この案件の履歴書評価')}>
    <div className={`case-resume-drop${dragging ? ' is-dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); if (!busy) setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDragging(false); void importFiles(Array.from(event.dataTransfer.files)) }}>
      <h3>{t('拖入简历，评估这个案件是否合适', '履歴書をドロップして、この案件との適合性を評価')}</h3><p>{t('PDF、Word、Excel · 每次最多 10 份 · 相同简历会复用', 'PDF・Word・Excel · 1回10件まで · 既存の同一資料は再利用')}</p>
      <label>{t('选择简历', '履歴書を選択')}<input ref={inputRef} type="file" multiple accept=".pdf,.docx,.xlsx,.xls,.xlsb" disabled={busy} onChange={(event) => void importFiles(Array.from(event.target.files ?? []))} /></label>
    </div>
    {people.length ? <div className="work-rule-actions"><select aria-label={t('选择已有人员评估', '既存の要員を評価')} value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}><option value="">{t('也可以选择已有人员', '既存の要員も選択できます')}</option>{people.filter((person) => person.recordStatus === 'active').map((person) => <option key={person.documentId} value={person.documentId}>{person.localIdentity?.displayName ?? person.fileName}</option>)}</select><button disabled={busy || !selected} onClick={() => void perform(async () => { const person = people.find((p) => p.documentId === selected)!; add(await window.sesAgent.assessCasePerson({ documentId: selected, jobCaseId }), person.localIdentity?.displayName ?? person.fileName) })}>{t('评估此人', 'この人を評価')}</button><button disabled={busy || !selected} onClick={() => void perform(async () => { const history = await window.sesAgent.listCasePersonAssessments({ documentId: selected, jobCaseId }); if (!history.length) { setError(t('暂无历史评估。', '過去の評価はありません。')); return } const person = people.find((p) => p.documentId === selected)!; add(history[0]!, person.localIdentity?.displayName ?? person.fileName) })}>{t('查看上次评估', '前回の評価')}</button></div> : null}
    {busy ? <p role="status">{t('正在解析并评估…', '解析・評価中…')} {progress}</p> : null}{error ? <p role="alert">{error}</p> : null}
    <details className="case-rule-tools" onToggle={(event) => setRulesOpen(event.currentTarget.open)}><summary>{t('教 AI 怎样判断这个案件', 'この案件の判断ルールを設定')}</summary>{rulesOpen ? <AiWorkRulesPanel cases={cases} jobCaseId={jobCaseId} /> : null}</details>
    {items.map((item) => item.assessment ? <AssessmentCard key={item.assessment.id} value={item.assessment} name={item.name} jobCaseId={jobCaseId} archived={item.archived}
      stale={item.assessment.result.qualification?.policyVersion !== businessMatchingPolicyVersion || item.assessment.jobCaseVersion !== job.jobCase?.version || rulesRevision !== null && item.assessment.rulesRevision !== rulesRevision || Boolean(people.find((p) => p.documentId === item.documentId)?.profile && people.find((p) => p.documentId === item.documentId)!.profile!.version !== item.assessment.profileVersion)} onRefresh={(value) => add(value, item.name)} />
      : <article className="case-assessment-card" key={item.documentId}><strong>{item.name}</strong><p role="alert">{item.error}</p>{!item.documentId.startsWith('failed-') ? <button disabled={busy} onClick={() => void perform(async () => add(await window.sesAgent.assessCasePerson({ documentId: item.documentId, jobCaseId }), item.name))}>{t('简历已导入，重试评估', '取込済み・評価を再試行')}</button> : null}</article>)}
  </section>
}
