import { useEffect, useRef, useState } from 'react'
import { businessMatchingPolicyVersion, proposalConclusion, matchEvidenceSections, type CandidateReviewSnapshot, type CasePersonAssessment, type JobCaseReviewSnapshot } from '@shared'
import { useUiLocale } from '../i18n'
import { AssessmentCard } from './CaseResumeAssessment'
import { AiWorkRulesPanel, workRulesChangedEvent } from './AiWorkRulesPanel'
import { pendingResumeTask, type CaseResumeController, type CaseResumeTask } from './use-case-resume-assessments'
import { InterviewEvidencePanel } from './InterviewEvidencePanel'
import { RankingReason } from './RankingReason'
import { recordExperienceOpened, useExperienceExposure } from './experience-exposure'
import { progressPairKey, progressPresentation, useBusinessProgress } from '../business-progress-data'
import './case-resume-panel.css'

interface Props {
  focusTaskId?: string | null
  job: JobCaseReviewSnapshot
  people: CandidateReviewSnapshot[]
  controller: CaseResumeController
  onClose(): void
  onOriginal(documentId: string): void
  onPrepare(value: CasePersonAssessment): void
  onFollowUp(value: CasePersonAssessment): void
  onSchedule?(values: CasePersonAssessment[]): Promise<void>
}
export function CaseResumeAssessmentPanel({ job, people, controller, focusTaskId, onClose, onOriginal, onPrepare, onFollowUp, onSchedule }: Props) {
  const zh = useUiLocale() === 'zh-CN', t = (cn: string, ja: string) => zh ? cn : ja
  const [selected, setSelected] = useState<Record<string, string | null>>({})
  const [checked, setChecked] = useState<Record<string, string[]>>({})
  const [error, setError] = useState(''), [addingPerson, setAddingPerson] = useState('')
  const [rulesRevision, setRulesRevision] = useState<number | null>(null)
  const [savingPeople, setSavingPeople] = useState<Set<string>>(new Set())
  const [admittedPeople, setAdmittedPeople] = useState<Set<string>>(new Set())
  const admissionLocks = useRef(new Set<string>())
  const [rulesError, setRulesError] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false), [starting, setStarting] = useState(false)
  const startLock = useRef(false)
  const progress = useBusinessProgress()
  const exposureRoot = useRef<HTMLElement>(null)
  const scrollRoot = useRef<HTMLDivElement>(null)
  const scrolls = useRef<Record<string, number>>({})
  useEffect(() => {
    const element = scrollRoot.current
    if (element) element.scrollTop = scrolls.current[job.reviewId] ?? 0
    setError(''); setAddingPerson(''); setRulesOpen(false)
  }, [job.reviewId])
  useEffect(() => {
    if (focusTaskId && controller.tasks.some(task => task.id === focusTaskId && task.reviewId === job.reviewId)) {
      setSelected(state => ({ ...state, [job.reviewId]: focusTaskId }))
      scrollRoot.current?.scrollTo?.({ top: 0 })
    }
  }, [focusTaskId, job.reviewId])
  const { loadHistory } = controller
  useEffect(() => { void loadHistory(job) }, [job.reviewId, job.jobCase?.id, loadHistory])
  useEffect(() => {
    let live = true
    const refresh = () => { void window.sesAgent.listWorkRules().then(value => { if (live) { setRulesRevision(value.revision); setRulesError(false) } }).catch(() => { if (live) { setRulesRevision(null); setRulesError(true) } }) }
    refresh(); window.addEventListener(workRulesChangedEvent, refresh)
    return () => { live = false; window.removeEventListener(workRulesChangedEvent, refresh) }
  }, [])
  const { refreshAvailability } = controller
  useEffect(() => { refreshAvailability() }, [people, refreshAvailability])
  const unavailablePeople = controller.unavailable
  const peopleById = new Map(people.map(person => [person.documentId, person]))
  const personFor = (task: CaseResumeTask) => peopleById.get(task.documentId ?? '') ?? task.person
  const search = controller.searches[job.reviewId]
  const existing = (task: CaseResumeTask) => task.documentId ? progress?.indexes.pairs.get(progressPairKey({ documentId: task.documentId, reviewId: job.reviewId })) : undefined
  const { tasks, hiddenDuplicates } = controller.visible(job.reviewId, people, task => Boolean(existing(task)))
  const active = job.lifecycle === 'active'
  const staleFor = (assessment: CasePersonAssessment, person?: CandidateReviewSnapshot) => !active ||
    assessment.id.startsWith('preview:') || assessment.result.qualification?.policyVersion !== businessMatchingPolicyVersion ||
    assessment.jobCaseVersion !== job.jobCase?.version || assessment.jobCaseId !== job.jobCase?.id ||
    rulesRevision === null || assessment.rulesRevision !== rulesRevision || !person?.profile || person.profile.version !== assessment.profileVersion
  const canUse = (task: typeof tasks[number]) => Boolean(task.assessment && !pendingResumeTask(task) &&
    !staleFor(task.assessment, personFor(task)) && personFor(task)?.recordStatus !== 'deleted' && !unavailablePeople.has(task.documentId ?? ''))
  const nameFor = (item: typeof tasks[number]) => personFor(item)?.localIdentity?.displayName ?? (item.name || personFor(item)?.fileName || t('已评估人员', '評価済み要員'))
  const statusLabel = (status: typeof tasks[number]['status']) => ({ queued: t('等待处理', '処理待ち'), parsing: t('正在解析简历', '履歴書を解析中'), assessing: t('正在评估', '評価中'), completed: t('已完成', '完了'), failed: t('处理失败', '処理失敗') })[status]
  const conclusion = (task: typeof tasks[number]) => {
    if (task.status !== 'completed') return statusLabel(task.status)
    if (task.assessment && !task.assessment.id.startsWith('preview:') && staleFor(task.assessment, personFor(task))) return t('需重新评估', '再評価が必要')
    return proposalConclusion(task.assessment?.result.qualification, zh)
  }
  const selectedTasks = tasks.filter(task => (checked[job.reviewId] ?? []).includes(task.id) && canUse(task) && !existing(task))
  const schedule = async (items: typeof tasks) => {
    if (!onSchedule || startLock.current || !items.length) return
    startLock.current = true; setStarting(true); setError('')
    try { await onSchedule(items.flatMap(item => item.assessment ? [item.assessment] : [])); setChecked(state => ({ ...state, [job.reviewId]: [] })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { startLock.current = false; setStarting(false) }
  }
  const addToLibrary = async (person: CandidateReviewSnapshot) => {
    if (!person.profile || admissionLocks.current.has(person.documentId)) return
    admissionLocks.current.add(person.documentId)
    setSavingPeople(new Set(admissionLocks.current)); setError('')
    try {
      await window.sesAgent.addCandidateToLibrary({ documentId: person.documentId, profileVersion: person.profile.version })
      setAdmittedPeople(current => new Set([...current, person.documentId]))
      window.dispatchEvent(new Event('ses-business-data-changed'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { admissionLocks.current.delete(person.documentId); setSavingPeople(new Set(admissionLocks.current)) }
  }
  useExperienceExposure(exposureRoot, `${job.reviewId}:${tasks.map(task => task.assessment?.result.experienceRunId ?? '').join(',')}`)
  const importFiles = (files: File[]) => {
    if (!files.length) return
    try { setError(''); const id = controller.enqueue(job, files); setSelected(state => ({ ...state, [job.reviewId]: id })); if (scrollRoot.current) scrollRoot.current.scrollTop = 0 }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return <section ref={exposureRoot} className="case-resume-panel agent-business-tools" aria-label={t('案件找人', '案件の要員検索')}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = active ? 'copy' : 'none' } }}
    onDrop={event => { event.preventDefault(); event.stopPropagation(); if (active) importFiles(Array.from(event.dataTransfer.files)) }}>
    <header className="agent-tool-header"><strong>{t('为此案件找人', 'この案件の要員を探す')}</strong><button type="button" aria-label={t('关闭人员面板', '要員パネルを閉じる')} onClick={onClose}>×</button></header>
    <header className="case-resume-target case-people-target"><h2>{job.fields.find(field => field.key === 'title')?.value ?? job.redactedSubject}</h2>
      <details><summary>{t('查看案件要求', '案件の要件を見る')}</summary><dl>{job.fields.filter(field => field.value && field.key !== 'title').map(field => <div key={field.key}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl></details>
      <div className="case-people-tools"><button type="button" className="hr-primary" disabled={!active || search?.pending} onClick={() => void controller.search(job, true)}>{search?.pending ? t('正在找人…', '要員を検索中…') : search?.result || tasks.length ? t('重新找人', '要員を再検索') : t('查找已有人员', '既存の要員を検索')}</button>
        <label className="case-resume-picker">{t('添加简历', '履歴書を追加')}<input type="file" multiple accept=".pdf,.docx,.xlsx,.xls,.xlsb" disabled={!active}
          onChange={event => { importFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} /></label>
      </div>
      <details className="case-people-add"><summary>{t('指定已有人员', '既存の要員を指定')}</summary><select aria-label={t('选择已有人员评估', '既存の要員を評価')} value={addingPerson} disabled={!active} onChange={event => setAddingPerson(event.target.value)}><option value="">{t('选择人员', '要員を選択')}</option>{people.filter(person => person.inTalentLibrary !== false && person.recordStatus === 'active' && person.profile).map(person => <option key={person.documentId} value={person.documentId}>{person.localIdentity?.displayName ?? person.fileName}</option>)}</select><button disabled={!active || !addingPerson} onClick={() => { const person = peopleById.get(addingPerson); if (person) { const id = controller.addPerson(job, person); setSelected(state => ({ ...state, [job.reviewId]: id })); setAddingPerson(''); if (scrollRoot.current) scrollRoot.current.scrollTop = 0 } }}>{t('加入评估', '評価に追加')}</button></details>
      <small>PDF · Word · Excel · {t('每次最多 10 份，每份 30 MB', '1回10件まで、各30 MB')}</small>
    </header>
    <div ref={scrollRoot} className="case-resume-panel-body" onScroll={event => { scrolls.current[job.reviewId] = event.currentTarget.scrollTop }}>
      {!active ? <p role="alert">{t('案件已停用，仍可查看历史评估。', '案件は停止中です。過去の評価を参照できます。')}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {rulesError ? <p role="alert">{t('规则读取失败，请重试后继续提案。', 'ルールの読込に失敗しました。再試行してください。')} <button onClick={() => window.dispatchEvent(new Event(workRulesChangedEvent))}>{t('重试', '再試行')}</button></p> : null}
      {search?.pending ? <p className="case-resume-progress" role="status">{search.localReady ? t('本地筛选完成，正在云端评估…', 'ローカル検索完了、Cloud評価中…') : t('正在本地筛选…', 'ローカル検索中…')} <button onClick={() => void controller.cancelSearch(job)}>{t('停止', '停止')}</button></p> : null}
      {search?.error ? <p role="alert">{search.error}<button onClick={() => void controller.search(job, true)} disabled={search.pending}>{t('重试找人', '検索を再試行')}</button></p> : null}
      {search?.result ? <p className="case-people-coverage">{t('已检索', '検索済み')} {search.result.searchedCount ?? search.result.localMatchCount} · {t('AI 已评估', 'AI評価済み')} {search.result.cloud.reviewedCount}{search.result.cloud.modelName ? ` · ${search.result.cloud.modelName}` : ''}</p> : null}
      {search?.result && !search.pending && ['failed', 'unavailable'].includes(search.result.cloud.status) ? <p role="status">{t('云端评估未完成，保留本地初筛结果，可重新找人。', 'Cloud評価は未完了です。ローカル候補を表示しています。再検索できます。')}</p> : null}
      {controller.historyErrors[job.reviewId] ? <p role="alert">{t('历史评估读取失败', '過去の評価の読込に失敗')}<button onClick={() => void loadHistory(job)}>{t('重试', '再試行')}</button></p> : null}
      {controller.loadingHistory[job.reviewId] && !tasks.length ? <p role="status">{t('正在读取历史评估…', '過去の評価を読込中…')}</p> : null}
      {!tasks.length && !search?.pending && !controller.loadingHistory[job.reviewId] ? <div className="hr-empty"><strong>{search?.result ? t('暂无可推荐人员', '紹介できる要員は見つかりませんでした') : t('为这个案件添加人员', 'この案件に要員を追加')}</strong><p>{t('可以查找已有人员，也可以直接拖入简历。', '既存の要員を検索するか、履歴書をドロップしてください。')}</p>{search?.result?.excludedRequirements?.length ? <p>{t('未满足的要求', '満たされていない要件')}：{search.result.excludedRequirements.join('、')}</p> : null}</div> : null}
      {onSchedule && tasks.length > 1 ? <button disabled={starting || !selectedTasks.length} onClick={() => void schedule(selectedTasks)}>{t('安排选中面试', '選択した面談を手配')} ({selectedTasks.length})</button> : null}
      {tasks.map((task, rank) => {
        const assessment = task.assessment, person = personFor(task), busy = pendingResumeTask(task)
        const expanded = selected[job.reviewId] === task.id
        const preliminary = assessment?.id.startsWith('preview:')
        const stale = Boolean(assessment && staleFor(assessment, person))
        const requirements = assessment?.result.qualification?.requirements ?? []
        const met = !stale && !expanded ? matchEvidenceSections(assessment?.result.qualification).met.slice(0, 3) : []
        const issues = !stale && !expanded ? matchEvidenceSections(assessment?.result.qualification).corePending.slice(0, 3) : []
        const relevantProjects = person?.projectExperiences?.filter(project => requirements.some(item => item.outcome === 'met' && (item.source === project.title || Boolean(item.evidence && project.summary.includes(item.evidence))))) ?? []
        const follow = existing(task)
        return <article className={`case-people-card${expanded ? ' is-expanded' : ''}`} key={task.id} aria-label={nameFor(task)} data-experience-run={assessment?.result.experienceRunId} data-experience-rank={rank + 1}>
          <button className="case-people-summary" type="button" aria-expanded={expanded} onClick={() => { setSelected(state => ({ ...state, [job.reviewId]: expanded ? null : task.id })); if (!expanded) recordExperienceOpened(assessment?.result.experienceRunId) }}>
            <span><strong>{nameFor(task)}</strong><small>{task.origin === 'search' ? t('系统找到', 'システム検索') : t('手动添加', '手動追加')}</small></span><b>{conclusion(task)}</b>
            {hiddenDuplicates.get(task.id)?.length ? <small>{t('同一人员的另一条记录已合并显示', '同一要員の別記録をまとめて表示しています')}</small> : null}
            {!busy && stale && !preliminary ? <small>{t('历史结果 · 需重新评估', '過去の結果・再評価が必要')}</small> : null}
            {met.length ? <small>{t('匹配依据', '一致の根拠')}：{met.map(item => item.requirement.label).join(' · ')}</small> : null}
            {met[0]?.evidence ? <small>{met[0].evidence.slice(0, 140)}</small> : null}
            {issues.length ? <small>{t('关注事项', '確認ポイント')}：{issues.map(item => `${item.requirement.label} · ${item.outcome === 'conflict' ? t('不满足', '未充足') : t('待确认', '要確認')}`).join('；')}</small> : null}
            <small>{expanded ? t('收起详情', '詳細を閉じる') : t('查看评估详情', '評価の詳細を見る')}</small>
          </button>
          {person && person.recordStatus !== 'deleted' ? <div className="case-person-library">
            {person.inTalentLibrary !== false || admittedPeople.has(person.documentId) ? <span>{t('已入库', '登録済み')}{person.recordStatus === 'archived' ? t(' · 已归档', '・アーカイブ済み') : ''}</span>
              : <><button type="button" disabled={!person.profile || savingPeople.has(person.documentId)} onClick={() => void addToLibrary(person)}>{savingPeople.has(person.documentId) ? t('入库中…', '登録中…') : t('入库', '人材ライブラリに登録')}</button><small>{t('仅用于本案件；入库后可在人才库中查找。', 'この案件用に保存しています。登録すると人材ライブラリで検索できます。')}</small></>}
          </div> : null}
          {follow && progress ? <p>{t('已有跟进', '対応記録あり')} · {progressPresentation(follow, progress.now, zh).label}</p> : null}
          {onSchedule && !follow && canUse(task) ? <label className="hr-match-select"><input type="checkbox" checked={(checked[job.reviewId] ?? []).includes(task.id)} disabled={starting} onChange={event => setChecked(state => ({ ...state, [job.reviewId]: event.target.checked ? [...(state[job.reviewId] ?? []), task.id] : (state[job.reviewId] ?? []).filter(id => id !== task.id) }))} />{t('选择此人安排面试', 'この要員の面談を手配')}</label> : null}
          {expanded ? <div className="case-resume-person">
            {task.documentId ? <button type="button" onClick={() => onOriginal(task.documentId!)}>{t('查看原简历', '元の履歴書を見る')}</button> : null}
            {busy ? <p className="case-resume-progress" role="status">{statusLabel(task.status)}…</p> : null}
            {task.status === 'failed' ? <div role="alert"><p>{task.error}</p><button disabled={!active} onClick={() => controller.retry(task.id, job.jobCase?.id)}>{task.documentId ? t('简历已导入，重试评估', '取込済み・評価を再試行') : t('重试导入', '取込を再試行')}</button></div> : null}
            {preliminary && !busy ? <p role="status">{t('当前为本地初筛结果，请等待完整评估或重新找人。', '現在はローカル検索結果です。評価の完了を待つか、再検索してください。')}</p> : null}
            {assessment && !busy && !preliminary ? <>
              <AssessmentCard key={assessment.id} value={assessment} name={nameFor(task)} jobCaseId={job.jobCase?.id ?? assessment.jobCaseId} reevaluationDisabled={!active} archived={person?.recordStatus === 'archived'} stale={stale}
                onRefresh={value => controller.completed(task.id, value)} onReassess={(request) => { if (active) controller.retry(task.id, job.jobCase?.id, request) }} />
              {relevantProjects.length ? <details className="case-resume-projects"><summary>{t('相关项目经历', '関連する案件経験')} ({relevantProjects.length})</summary>{relevantProjects.slice(0, 3).map(project => <article key={project.draftId}><strong>{project.title}</strong><p>{project.period} · {project.role}</p><p>{project.summary}</p></article>)}</details> : null}
              <InterviewEvidencePanel documentId={assessment.documentId} reviewId={job.reviewId}/><RankingReason ranking={assessment.result.ranking} zh={zh}/>
              {unavailablePeople.has(task.documentId ?? '') ? <p role="status">{t('此人员已入场或暂停营业，请先更新人员营业状态。', '参画中または営業停止中です。営業状況を更新してください。')}</p> : null}
              <div className="work-rule-actions case-resume-next"><button className="hr-primary" disabled={!canUse(task) || starting} onClick={() => onPrepare(assessment)}>{t('生成提案文', '提案文を作成')}</button>
                {onSchedule && !follow ? <button disabled={!canUse(task) || starting} onClick={() => void schedule([task])}>{t('安排面试', '面談を予約')}</button> : null}
                <button disabled={!canUse(task)} onClick={() => onFollowUp(assessment)}>{follow ? t('继续跟进', '対応を続ける') : t('进入业务跟进', '案件の対応を開始')}</button></div>
            </> : null}
          </div> : null}
        </article>
      })}
      {tasks.length >= 100 ? <small>{t('显示最近评估的 100 位人员。', '直近で評価した100名を表示しています。')}</small> : null}
      {active && job.jobCase ? <details onToggle={event => setRulesOpen(event.currentTarget.open)}><summary>{t('此案件的 AI 工作规则', 'この案件のAI業務ルール')}</summary>{rulesOpen ? <AiWorkRulesPanel cases={[job]} jobCaseId={job.jobCase.id} /> : null}</details> : null}
    </div>
  </section>
}
