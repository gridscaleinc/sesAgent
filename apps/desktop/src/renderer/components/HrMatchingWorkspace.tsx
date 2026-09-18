import { BusinessMatchEvidence } from './BusinessMatchEvidence'
import { InterviewEvidencePanel } from './InterviewEvidencePanel'
import { RankingReason } from './RankingReason'
import { useExperienceExposure, recordExperienceOpened } from './experience-exposure'
import { workRulesChangedEvent } from './AiWorkRulesPanel'
import { progressPairKey, progressPresentation, useBusinessProgress } from '../business-progress-data'
import { useEffect, useRef, useState } from 'react'
import type { CandidateReviewSnapshot, JobCaseReviewSnapshot, PersonnelCaseMatchResult, CasePersonnelMatchResult, CandidateMatchAssessment } from '@shared'
import { businessMatchingPolicyVersion, qualificationStatus, matchFollowUpLabels } from '@shared'
import { consumeMatchingIntent } from '../hr-matching-intents'
import { useUiLocale } from '../i18n'
import type { FollowUpTarget } from './HrFollowUps'

export interface HrMatchSource { kind: 'case' | 'person'; id: string; requestId: number }
type Cached = { kind: 'case'; result: CasePersonnelMatchResult } | { kind: 'person'; result: PersonnelCaseMatchResult }
export interface IntroductionTarget { documentId: string; reviewId?: string; profileVersion: number; jobCaseVersion?: number; assessment?: CandidateMatchAssessment; matched: string[]; pendingConditions?: string[] }

export function HrMatchingWorkspace({ source, cases, people, onBusy, onView, onPrepare, onBack, onFollowUp, onScheduleMany, onContinue }: {
  source: HrMatchSource | null; cases: JobCaseReviewSnapshot[]; people: CandidateReviewSnapshot[]
  onBusy(value: boolean): void; onView(kind: 'case' | 'person', id: string): void
  onContinue?(target: FollowUpTarget): void
  onFollowUp(target: FollowUpTarget): void | Promise<void>
  onScheduleMany?(targets: FollowUpTarget[]): void | Promise<void>
  onPrepare(target: IntroductionTarget): void; onBack(): void
}) {
  const exposureRoot = useRef<HTMLElement>(null)
  const progress = useBusinessProgress()
  const zh = useUiLocale() === 'zh-CN'; const t = (cn: string, ja: string) => zh ? cn : ja
  const [rulesRevision, setRulesRevision] = useState(0)
  useEffect(() => {
    let live = true
    const refresh = () => { if (window.sesAgent.listWorkRules) void window.sesAgent.listWorkRules().then((value) => { if (live) setRulesRevision(value.revision) }).catch(() => { if (live) setRulesRevision(-1) }) }
    refresh(); window.addEventListener(workRulesChangedEvent, refresh)
    return () => { live = false; window.removeEventListener(workRulesChangedEvent, refresh) }
  }, [])
  const [cache, setCache] = useState<Record<string, Cached>>({})
  const [pending, setPending] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState<Record<string,string[]>>({})
  const [starting, setStarting] = useState(false)
  const startLock = useRef(false)
  const [unavailablePeople, setUnavailablePeople] = useState<Set<string>>(new Set())
  useEffect(() => {
    let active = true
    void window.sesAgent.getPersonnelWorkspace().then((value) => {
      if (active) setUnavailablePeople(new Set(value.states.filter((item) => !['available', 'soon'].includes(item.status)).map((item) => item.documentId)))
    }).catch(() => { /* Main still validates business eligibility before any action. */ })
    return () => { active = false }
  }, [people])
  const lock = useRef(false)
  const pendingKey = useRef<string | null>(null)
  const [localReady, setLocalReady] = useState<string | null>(null)
  useEffect(() => window.sesAgent.onBusinessMatchingProgress((event) => {
    const key = `${event.kind}:${event.id}`
    if (pendingKey.current !== key) return
    setLocalReady(key)
    setCache((state) => ({ ...state, [key]: event.kind === 'case' ? { kind: 'case', result: event.result } : { kind: 'person', result: event.result } }))
  }), [])
  const applied = useRef<number | null>(null)
  const sourceKey = source ? `${source.kind}:${source.id}` : ''
  const job = source?.kind === 'case' ? cases.find((item) => item.jobCase?.id === source.id) : undefined
  const person = source?.kind === 'person' ? people.find((item) => item.documentId === source.id) : undefined
  const valid = source?.kind === 'case' ? job?.lifecycle === 'active' : person?.recordStatus === 'active' && !unavailablePeople.has(person.documentId) && Boolean(person.profile)
  const saved = cache[sourceKey]
  const current = saved?.kind === 'case' ? saved.result.jobCaseVersion === job?.jobCase?.version : saved?.kind === 'person' ? saved.result.profileVersion === person?.profile?.version : false
  const rows = saved?.kind === 'case' ? saved.result.items.map((item) => ({ ...item, kind: 'person' as const, id: item.documentId, person: people.find((entry) => entry.documentId === item.documentId), job }))
    : saved?.kind === 'person' ? saved.result.items.map((item) => ({ ...item, kind: 'case' as const, id: item.reviewId, person, job: cases.find((entry) => entry.reviewId === item.reviewId) })) : []
  const freshRows = rows.filter((row) => row.person?.recordStatus === 'active' && !unavailablePeople.has(row.person.documentId) && row.job?.lifecycle === 'active' &&
    (row.kind === 'person' ? row.profileVersion === row.person?.profile?.version : row.jobCaseVersion === row.job?.jobCase?.version))
  const policyCurrent = rows.every((row) => row.qualification?.policyVersion === businessMatchingPolicyVersion)
  const recommendedRows = policyCurrent ? freshRows.filter((row) => row.qualification?.status === 'recommended') : []
  const confirmationRows = policyCurrent ? freshRows.filter((row) => row.qualification?.status === 'needs-confirmation' && qualificationStatus(row.qualification.requirements) !== 'excluded') : []
  useExperienceExposure(exposureRoot, `${sourceKey}:${rows.map(row => row.experienceRunId ?? '').join(',')}`)
  const stale = Boolean(saved && ((saved.result.rulesRevision ?? 0) !== rulesRevision || !current || !policyCurrent || rows.length !== freshRows.length))
  type Row = (typeof freshRows)[number]
  const pendingConditions = (row: Row) => matchFollowUpLabels(row.qualification, row.appliedRules?.filter(rule => rule.kind === 'confirm').map(rule => rule.text), zh)
  const openDetails = (row: Row) => { recordExperienceOpened(row.experienceRunId); setSelected((state) => ({ ...state, [sourceKey]: row.id })); onView(row.kind, row.id) }
  const prepare = (row: Row) => {
    if (stale || pending || !valid || !current) return
    setSelected((state) => ({ ...state, [sourceKey]: row.id }))
    onPrepare({ documentId: row.person!.documentId, reviewId: row.job!.reviewId,
      profileVersion: row.person!.profile!.version, jobCaseVersion: row.job!.jobCase!.version,
      assessment: row.assessment, matched: row.matched,
      pendingConditions: pendingConditions(row) })
  }
  const followTarget = (row: Row): FollowUpTarget => ({ documentId: row.person!.documentId, reviewId: row.job!.reviewId,
    ...(pendingConditions(row).length ? { pendingConditions: pendingConditions(row) } : {}) })
  const existing = (row: Row) => progress?.indexes.pairs.get(progressPairKey(followTarget(row)))
  const start = async (targets: Row[]) => {
    if (targets.length === 1 && existing(targets[0]!) && onContinue) { onContinue(followTarget(targets[0]!)); return }
    if (startLock.current || stale || pending || !valid || !current || !targets.length) return
    startLock.current = true; setStarting(true); setErrors((state) => ({ ...state, [sourceKey]: '' }))
    try {
      if (targets.length === 1) await onFollowUp(followTarget(targets[0]!))
      else await onScheduleMany?.(targets.map(followTarget))
      setChecked((state) => ({ ...state, [sourceKey]: [] }))
    } catch(cause) { setErrors((state) => ({ ...state, [sourceKey]: cause instanceof Error ? cause.message : String(cause) })) }
    finally { startLock.current = false; setStarting(false) }
  }
  const toggle = (row: Row) => setChecked((state) => ({...state, [sourceKey]: (state[sourceKey] ?? []).includes(row.id) ? state[sourceKey]!.filter((id) => id !== row.id) : [...(state[sourceKey] ?? []), row.id]}))
  const selectedRows = [...recommendedRows, ...confirmationRows].filter((row) => !existing(row) && (checked[sourceKey] ?? []).includes(row.id))
  const run = async (request: HrMatchSource) => {
    if (lock.current || startLock.current) return
    lock.current = true; onBusy(true)
    const key = `${request.kind}:${request.id}`
    pendingKey.current = key; setLocalReady(null); setPending(key); setErrors((state) => ({ ...state, [key]: '' }))
    try {
      const result: Cached = request.kind === 'case' ? { kind: 'case', result: await window.sesAgent.findPersonnelForCase(request.id) }
        : { kind: 'person', result: await window.sesAgent.findCasesForPersonnel(request.id) }
      const id = result.kind === 'case' ? result.result.jobCaseId : result.result.documentId
      if (id !== request.id) throw new Error(t('资料已更新，请重新匹配。', '情報が更新されました。再マッチングしてください。'))
      setCache((state) => ({ ...state, [key]: result }))
    } catch (cause) { setErrors((state) => ({ ...state, [key]: cause instanceof Error ? cause.message : String(cause) })) }
    finally { pendingKey.current = null; lock.current = false; setPending(null); onBusy(false) }
  }
  useEffect(() => {
    if (!source || applied.current === source.requestId) return
    applied.current = source.requestId
    if (valid && consumeMatchingIntent(source)) void run(source)
  }, [source, valid])
  if (!source) return null
  const title = job?.fields.find((field) => field.key === 'title')?.value ?? job?.redactedSubject ?? person?.localIdentity?.displayName ?? person?.fileName ?? t('记录不可用', '利用できない情報')
  return <section ref={exposureRoot} className="hr-matching-workspace" aria-label={source.kind === 'case' ? t('案件找人', '案件の要員検索') : t('人员找案件', '要員の案件検索')}>
    <header className="hr-match-source"><button type="button" onClick={onBack}>← {source.kind === 'case' ? t('返回案件列表', '案件一覧に戻る') : t('返回人员列表', '要員一覧に戻る')}</button>
      <small>{source.kind === 'case' ? t('为当前案件找人', 'この案件の要員を探す') : t('为当前人员找案件', 'この要員の案件を探す')}</small>
      <button className="hr-source-title" onClick={() => onView(source.kind, job?.reviewId ?? source.id)} type="button">{title}</button>
      <p>{(job?.fields ?? person?.fields ?? []).filter((field) => ['required_skills', 'skills', 'rate', 'location', 'availability'].includes(field.key) && field.value).map((field) => field.value).join(' · ')}</p>
      <button className="hr-primary" type="button" disabled={starting || Boolean(pending) || !valid} onClick={() => void run(source)}>{pending === sourceKey ? t('正在匹配…', 'マッチング中…') : t('重新匹配', '再マッチング')}</button>
    </header>
    <div className="hr-match-results">
      {!valid ? <p role="alert">{t('当前资料不可用，请返回列表刷新。', '現在の情報は利用できません。一覧を再読み込みしてください。')}</p> : null}
      {pending === sourceKey ? <p role="status" className="hr-match-progress">{localReady === sourceKey ? t('本地筛选完成，正在云端评估…', 'ローカル検索完了、Cloud評価中…') : t('正在本地筛选…', 'ローカル検索中…')} <button type="button" onClick={() => void window.sesAgent.cancelBusinessMatching({ kind: source.kind, id: source.id }).catch((cause) => setErrors((state) => ({ ...state, [sourceKey]: String(cause) })))}>{t('停止', '停止')}</button></p> : null}
      {errors[sourceKey] ? <p role="alert">{errors[sourceKey]}</p> : null}
      {stale ? <p role="status" className="hr-match-stale">{t('资料或 AI 规则已更新，需重新匹配。', '情報またはAIルールが更新されました。再マッチングが必要です。')}</p> : null}
      {saved && current && valid ? <>
        <div className="hr-results-status"><strong>{recommendedRows.length} {source.kind === 'case' ? t('位可推荐人员', '名の紹介候補') : t('个推荐案件', '件の紹介候補')}</strong>{confirmationRows.length ? <strong className="hr-conditions-count">{confirmationRows.length} {t('项核心信息待补充', '件はコア情報の補足が必要')}</strong> : null}<span>{saved.result.cloud.status === 'reviewed' ? t('AI 已评估', 'AI評価済み') : saved.result.cloud.status === 'partial' ? t('部分结果已评估', '一部の結果を評価済み') : t('本地条件核对', 'ローカル条件照合')}</span></div>
        <p className="hr-match-coverage">{t('已检索', '検索済み')} {saved.result.searchedCount ?? saved.result.localMatchCount} · {t('AI 已评估', 'AI評価済み')} {saved.result.cloud.reviewedCount}{saved.result.cloud.modelName ? ` · ${saved.result.cloud.modelName}` : ''}</p>
        {Boolean(saved.result.ownCompanyExcludedCount) ? <p className="hr-match-coverage">{t('因自社限定排除', '自社条件による除外')} {saved.result.ownCompanyExcludedCount}</p> : null}
        {pending !== sourceKey && ['failed', 'unavailable'].includes(saved.result.cloud.status) ? <p>{t('云端评估未完成，保留本地初筛结果。可点击重新匹配重试。', 'Cloud評価は未完了です。ローカル候補を表示しています。再マッチングで再試行できます。')}</p> : null}
        {!recommendedRows.length && !confirmationRows.length && pending !== sourceKey && !stale ? <div className="hr-empty hr-match-empty" role="status"><strong>{source.kind === 'case' ? t('暂无可推荐人员', '紹介できる要員は見つかりませんでした') : t('暂无推荐案件', '紹介できる案件は見つかりませんでした')}</strong>
          <p>{t('当前档案中没有找到具备全部必需条件依据的匹配结果。', '現在の情報では、すべての必須条件を満たす根拠が見つかりませんでした。')}</p>
          {saved.result.excludedRequirements?.length ? <p>{t('缺少依据或存在冲突的要求', '根拠不足・条件不一致')}：{saved.result.excludedRequirements.join('、')}</p> : null}
        </div> : null}
        {onScheduleMany && recommendedRows.length + confirmationRows.length > 1 ? <div className="hr-match-batch"><span>{t('选中后可同时安排，各案件独立推进', '選択した候補をまとめて開始し、案件ごとに進めます')}</span><button disabled={starting || stale || Boolean(pending) || !selectedRows.length} onClick={() => void start(selectedRows)}>{starting ? t('正在创建安排', '準備中') : t('安排选中面试', '選択した面談を手配')} ({selectedRows.length})</button></div> : null}
        {recommendedRows.map((row, rank) => {
          const rowTitle = row.kind === 'person' ? row.person!.localIdentity?.displayName ?? row.person!.fileName : row.job!.fields.find((field) => field.key === 'title')?.value ?? row.job!.redactedSubject
          return <article className={`hr-result-card${selected[sourceKey] === row.id ? ' is-selected' : ''}`} key={row.id} data-experience-run={row.experienceRunId} data-experience-rank={rank + 1} aria-current={selected[sourceKey] === row.id ? 'true' : undefined}>
            {onScheduleMany ? <label className="hr-match-select"><input type="checkbox" disabled={starting || stale || Boolean(pending) || Boolean(existing(row))} checked={(checked[sourceKey] ?? []).includes(row.id)} onChange={() => toggle(row)} />{t('选择此项', 'この候補を選択')}</label> : null}
            <button className="hr-result-title" type="button" onClick={() => openDetails(row)}>{rowTitle}</button>
            <BusinessMatchEvidence qualification={row.qualification} questions={row.appliedRules?.filter(rule => rule.kind === 'confirm').map(rule => rule.text)} zh={zh} />
            {existing(row) && progress ? <p className="hr-existing-progress">{t('已有跟进', '対応記録あり')} · {progressPresentation(existing(row)!, progress.now, zh).label}</p> : null}
            <InterviewEvidencePanel documentId={row.person!.documentId} reviewId={row.job!.reviewId}/><RankingReason ranking={row.ranking} zh={zh}/>
            {row.appliedRules?.length ? <details className="work-rule-applied"><summary>{t('本次采用的规则', '今回適用したルール')}</summary><ul>{row.appliedRules.map((rule, i) => <li key={i}>v{rule.revision} · {rule.text}</li>)}</ul></details> : null}
            <footer><button type="button" disabled={starting || stale || Boolean(pending)} onClick={() => void start([row])}>{existing(row) ? t('继续跟进', '対応を続ける') : t('安排面试', '面談を予約')}</button><button type="button" onClick={() => openDetails(row)}>{t('查看资料', '情報を見る')}</button><button disabled={starting || stale || Boolean(pending)} type="button" onClick={() => prepare(row)}>{t('准备介绍', '紹介を準備')}</button></footer>
          </article>
        })}
        {confirmationRows.length ? <section className="hr-match-confirmation" aria-label={t('核心信息待补充', 'コア情報の補足が必要')}>
          <header><h3>{t('核心信息待补充', 'コア情報の補足が必要')} <span>{confirmationRows.length}</span></h3><p>{t('以下人员的技术或语言信息尚不完整，需要补充具体依据；确认事项会带入业务跟进。', '技術または言語の情報が不十分です。具体的な根拠を補足してください。確認事項は対応記録に引き継がれます。')}</p></header>
          {confirmationRows.map((row, rank) => <article className={`hr-result-card hr-confirmation-row${selected[sourceKey] === row.id ? ' is-selected' : ''}`} key={row.id} data-experience-run={row.experienceRunId} data-experience-rank={rank + 1} aria-current={selected[sourceKey] === row.id ? 'true' : undefined}>
            {onScheduleMany ? <label className="hr-match-select"><input type="checkbox" disabled={starting || stale || Boolean(pending) || Boolean(existing(row))} checked={(checked[sourceKey] ?? []).includes(row.id)} onChange={() => toggle(row)} />{t('选择此项', 'この候補を選択')}</label> : null}
            <button className="hr-result-title" type="button" onClick={() => openDetails(row)}>{row.kind === 'person' ? row.person!.localIdentity?.displayName ?? row.person!.fileName : row.job!.fields.find((field) => field.key === 'title')?.value ?? row.job!.redactedSubject}</button>
            <BusinessMatchEvidence qualification={row.qualification} questions={row.appliedRules?.filter(rule => rule.kind === 'confirm').map(rule => rule.text)} zh={zh} />
            {existing(row) && progress ? <p className="hr-existing-progress">{t('已有跟进', '対応記録あり')} · {progressPresentation(existing(row)!, progress.now, zh).label}</p> : null}
            <InterviewEvidencePanel documentId={row.person!.documentId} reviewId={row.job!.reviewId}/><RankingReason ranking={row.ranking} zh={zh}/>
            {row.appliedRules?.length ? <details className="work-rule-applied"><summary>{t('本次采用的规则', '今回適用したルール')}</summary><ul>{row.appliedRules.map((rule, i) => <li key={i}>v{rule.revision} · {rule.text}</li>)}</ul></details> : null}
            <footer><button type="button" disabled={starting || stale || Boolean(pending)} onClick={() => void start([row])}>{existing(row) ? t('继续跟进', '対応を続ける') : t('安排面试', '面談を予約')}</button><button type="button" onClick={() => openDetails(row)}>{t('查看资料', '情報を見る')}</button><button type="button" disabled={starting || stale || Boolean(pending)} onClick={() => prepare(row)}>{t('准备介绍', '紹介を準備')}</button></footer>
          </article>)}
        </section> : null}
      </> : null}
    </div>
  </section>
}
