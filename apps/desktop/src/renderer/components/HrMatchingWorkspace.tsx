import { BusinessMatchEvidence } from './BusinessMatchEvidence'
import { AiOpinion } from './AiOpinion'
import { InterviewEvidencePanel } from './InterviewEvidencePanel'
import { RankingReason } from './RankingReason'
import { useExperienceExposure, recordExperienceOpened } from './experience-exposure'
import { workRulesChangedEvent } from './AiWorkRulesPanel'
import { progressPairKey, progressPresentation, useBusinessProgress } from '../business-progress-data'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BusinessFollowUp,
  CandidateBusinessStatus,
  CandidateReviewSnapshot,
  JobCaseReviewSnapshot,
  PersonnelCaseMatch,
  CandidateMatchAssessment
} from '@shared'
import { businessMatchingPolicyVersion, isPersonnelAvailable, qualificationStatus, matchFollowUpLabels } from '@shared'
import { consumeMatchingIntent } from '../hr-matching-intents'
import {
  isPersonCaseMatchBusy,
  isPersonCaseMatchRunning,
  loadPersonCaseMatch,
  personCaseMatch,
  busyPersonCaseMatches,
  setPersonCaseMatchPreparing,
  savePersonCaseMatch,
  setPersonCaseMatchRunning,
  usePersonCaseMatchCounts,
  type PersonCaseMatchEntry
} from '../person-case-match-cache'
import { localizedIpcError, useLocaleText } from '../i18n'
import type { FollowUpTarget } from './follow-up-target'
import './hr-matching.css'

/** One 「找案件」 click for a person; a new requestId is a new click. */
export interface HrMatchSource {
  kind: 'person'
  id: string
  requestId: number
}
export interface IntroductionTarget {
  documentId: string
  reviewId?: string
  profileVersion: number
  jobCaseVersion?: number
  assessment?: CandidateMatchAssessment
  matched: string[]
  pendingConditions?: string[]
}

/** Active cases at run time; a new, closed or edited case means the stored result no longer covers the pool. */
const caseSignature = (cases: JobCaseReviewSnapshot[]) =>
  cases
    .flatMap((item) => (item.lifecycle === 'active' && item.jobCase ? [`${item.jobCase.id}:${item.jobCase.version}`] : []))
    .sort()
    .join(',')

export function HrMatchingWorkspace({
  source,
  cases,
  people,
  onBusy,
  onBusyChange,
  onView,
  onPrepare,
  onBack,
  onFollowUp,
  onScheduleMany,
  onContinue
}: {
  source: HrMatchSource | null
  cases: JobCaseReviewSnapshot[]
  people: CandidateReviewSnapshot[]
  /** @deprecated True while any person is being matched; prefer `onBusyChange` to lock only those people. */
  onBusy?(value: boolean): void
  /** The people whose 「找案件」 is running (several can run at once). */
  onBusyChange?(documentIds: string[]): void
  onView(kind: 'case' | 'person', id: string): void
  onContinue?(target: FollowUpTarget): void
  onFollowUp(target: FollowUpTarget): void | Promise<void>
  onScheduleMany?(targets: FollowUpTarget[]): void | Promise<void>
  onPrepare(target: IntroductionTarget): void
  onBack(): void
}) {
  const exposureRoot = useRef<HTMLElement>(null)
  const progress = useBusinessProgress()
  const { locale, zh, t } = useLocaleText()
  usePersonCaseMatchCounts()
  // 'loading' holds matching until the revision is known; 'failed' never marks results stale by itself.
  const [rulesRevision, setRulesRevision] = useState<number | 'loading' | 'failed'>(() =>
    typeof window.sesAgent.listWorkRules === 'function' ? 'loading' : 0
  )
  const loadRules = useCallback((live: () => boolean) => {
    if (!window.sesAgent.listWorkRules) return
    void window.sesAgent
      .listWorkRules()
      .then((value) => {
        if (live()) setRulesRevision(value.revision)
      })
      .catch(() => {
        if (live()) setRulesRevision('failed')
      })
  }, [])
  useEffect(() => {
    let live = true
    const refresh = () => loadRules(() => live)
    refresh()
    window.addEventListener(workRulesChangedEvent, refresh)
    return () => {
      live = false
      window.removeEventListener(workRulesChangedEvent, refresh)
    }
  }, [loadRules])
  const [partial, setPartial] = useState<Record<string, PersonCaseMatchEntry>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState<Record<string, string[]>>({})
  const [starting, setStarting] = useState(false)
  const startLock = useRef(false)
  // null until the business states load: matching waits so an unavailable person is never run.
  const [businessStates, setBusinessStates] = useState<Map<string, CandidateBusinessStatus> | null>(null)
  useEffect(() => {
    let active = true
    void window.sesAgent
      .getPersonnelWorkspace()
      .then((value) => {
        if (active) setBusinessStates(new Map(value.states.map((item) => [item.documentId, item.status])))
      })
      .catch(() => {
        /* Main still validates business eligibility before any action. */
        if (active) setBusinessStates((current) => current ?? new Map())
      })
    return () => {
      active = false
    }
  }, [people])
  const runSignatures = useRef(new Map<string, string>())
  useEffect(
    () =>
      window.sesAgent.onBusinessMatchingProgress((event) => {
        if (event.kind !== 'person' || !isPersonCaseMatchRunning(event.id)) return
        setPartial((state) => ({
          ...state,
          [event.id]: { result: event.result, ranAt: '', caseSignature: runSignatures.current.get(event.id) ?? '' }
        }))
      }),
    []
  )
  const applied = useRef<number | null>(null)
  const sourceId = source?.id ?? ''
  // The person's stored run is looked up (from this session or Main) before deciding whether to run again.
  const [storedLoaded, setStoredLoaded] = useState<string | null>(null)
  useEffect(() => {
    if (!sourceId) return
    let live = true
    void loadPersonCaseMatch(sourceId).finally(() => {
      if (live) setStoredLoaded(sourceId)
    })
    return () => {
      live = false
    }
  }, [sourceId])
  const person = source ? people.find((item) => item.documentId === source.id) : undefined
  const businessStatus = person ? businessStates?.get(person.documentId) : undefined
  const ready = businessStates !== null && rulesRevision !== 'loading'
  const valid = ready && person?.recordStatus === 'active' && isPersonnelAvailable(businessStatus) && Boolean(person.profile)
  // pending also covers the moment before a run starts; running is the run itself (progress, stop, notices).
  const pending = Boolean(source) && isPersonCaseMatchBusy(sourceId)
  const running = Boolean(source) && isPersonCaseMatchRunning(sourceId)
  const stored = source ? personCaseMatch(sourceId) : null
  const saved = partial[sourceId] ?? stored ?? undefined
  const current = saved ? saved.result.profileVersion === person?.profile?.version : false
  const rows = saved
    ? saved.result.items.map((item) => ({
        ...item,
        id: item.reviewId,
        job: cases.find((entry) => entry.reviewId === item.reviewId)
      }))
    : []
  const freshRows = rows.filter(
    (row) =>
      person?.recordStatus === 'active' &&
      isPersonnelAvailable(businessStatus) &&
      row.job?.lifecycle === 'active' &&
      row.jobCaseVersion === row.job?.jobCase?.version
  )
  const policyCurrent = rows.every((row) => row.qualification?.policyVersion === businessMatchingPolicyVersion)
  const recommendedRows = policyCurrent ? freshRows.filter((row) => row.qualification?.status === 'recommended') : []
  const confirmationRows = policyCurrent
    ? freshRows.filter(
        (row) => row.qualification?.status === 'needs-confirmation' && qualificationStatus(row.qualification.requirements) !== 'excluded'
      )
    : []
  useExperienceExposure(exposureRoot, `person:${sourceId}:${rows.map((row) => row.experienceRunId ?? '').join(',')}`)
  const stale = Boolean(
    saved &&
    ((typeof rulesRevision === 'number' && (saved.result.rulesRevision ?? 0) !== rulesRevision) ||
      !current ||
      !policyCurrent ||
      (saved.policyVersion !== undefined && saved.policyVersion !== businessMatchingPolicyVersion) ||
      rows.length !== freshRows.length ||
      saved.caseSignature !== caseSignature(cases))
  )
  // A stored result is shown instead of re-running only when every version it depends on is verified.
  const reusable = Boolean(stored && !partial[sourceId] && !stale && typeof rulesRevision === 'number')
  type Row = (typeof freshRows)[number]
  const pendingConditions = (row: Row) =>
    matchFollowUpLabels(
      row.qualification,
      row.appliedRules?.filter((rule) => rule.kind === 'confirm').map((rule) => rule.text),
      zh
    )
  const openDetails = (row: Row) => {
    recordExperienceOpened(row.experienceRunId)
    setSelected((state) => ({ ...state, [sourceId]: row.id }))
    onView('case', row.id)
  }
  const prepare = (row: Row) => {
    if (stale || pending || !valid || !current) return
    setSelected((state) => ({ ...state, [sourceId]: row.id }))
    onPrepare({
      documentId: person!.documentId,
      reviewId: row.job!.reviewId,
      profileVersion: person!.profile!.version,
      jobCaseVersion: row.job!.jobCase!.version,
      assessment: row.assessment,
      matched: row.matched,
      pendingConditions: pendingConditions(row)
    })
  }
  const followTarget = (row: Row): FollowUpTarget => ({
    documentId: person!.documentId,
    reviewId: row.job!.reviewId,
    ...(pendingConditions(row).length ? { pendingConditions: pendingConditions(row) } : {})
  })
  const existing = (row: Row) => progress?.indexes.pairs.get(progressPairKey(followTarget(row)))
  const start = async (targets: Row[]) => {
    if (targets.length === 1 && existing(targets[0]!) && onContinue) {
      onContinue(followTarget(targets[0]!))
      return
    }
    if (startLock.current || stale || pending || !valid || !current || !targets.length) return
    startLock.current = true
    setStarting(true)
    setErrors((state) => ({ ...state, [sourceId]: '' }))
    try {
      if (targets.length === 1) await onFollowUp(followTarget(targets[0]!))
      else await onScheduleMany?.(targets.map(followTarget))
      setChecked((state) => ({ ...state, [sourceId]: [] }))
    } catch (cause) {
      setErrors((state) => ({
        ...state,
        [sourceId]: localizedIpcError(locale, cause, t('无法开始跟进，请重试。', '対応を開始できませんでした。もう一度お試しください。'))
      }))
    } finally {
      startLock.current = false
      setStarting(false)
    }
  }
  const toggle = (row: Row) =>
    setChecked((state) => ({
      ...state,
      [sourceId]: (state[sourceId] ?? []).includes(row.id)
        ? state[sourceId]!.filter((id) => id !== row.id)
        : [...(state[sourceId] ?? []), row.id]
    }))
  const selectedRows = [...recommendedRows, ...confirmationRows].filter(
    (row) => !existing(row) && (checked[sourceId] ?? []).includes(row.id)
  )
  const reportBusy = () => {
    const busy = busyPersonCaseMatches()
    onBusy?.(busy.length > 0)
    onBusyChange?.(busy)
  }
  const run = async (documentId: string) => {
    if (isPersonCaseMatchRunning(documentId) || startLock.current) return
    const signature = caseSignature(cases)
    runSignatures.current.set(documentId, signature)
    setPersonCaseMatchRunning(documentId, true)
    reportBusy()
    setPartial(({ [documentId]: _dropped, ...rest }) => rest)
    setErrors((state) => ({ ...state, [documentId]: '' }))
    try {
      const result = await window.sesAgent.findCasesForPersonnel(documentId)
      if (result.documentId !== documentId)
        throw new Error(t('人员资料已更新，请重新找案件。', '要員情報が更新されました。案件を再検索してください。'))
      savePersonCaseMatch({ result, ranAt: new Date().toISOString(), caseSignature: signature })
      setPartial(({ [documentId]: _dropped, ...rest }) => rest)
    } catch (cause) {
      setErrors((state) => ({
        ...state,
        [documentId]: localizedIpcError(locale, cause, t('找案件失败，请重试。', '案件を探せませんでした。もう一度お試しください。'))
      }))
    } finally {
      setPersonCaseMatchRunning(documentId, false)
      reportBusy()
    }
  }
  // From the click until the decision below, the person is busy so a second 找案件 cannot slip in.
  useEffect(() => {
    if (!source || applied.current === source.requestId) return
    const documentId = source.id
    setPersonCaseMatchPreparing(documentId, true)
    reportBusy()
    return () => {
      setPersonCaseMatchPreparing(documentId, false)
      reportBusy()
    }
  }, [source?.requestId])
  useEffect(() => {
    if (!source || applied.current === source.requestId || !ready || storedLoaded !== source.id) return
    applied.current = source.requestId
    if (consumeMatchingIntent(source) && valid && !reusable) void run(source.id)
    setPersonCaseMatchPreparing(source.id, false)
    reportBusy()
  }, [source, ready, valid, reusable, storedLoaded])
  if (!source) return null
  const title = person?.localIdentity?.displayName ?? person?.fileName ?? t('人员不可用', '利用できない要員')
  const unavailable = !ready
    ? null
    : !person || person.recordStatus !== 'active'
      ? {
          text: t('此人员资料已停用或已删除，无法找案件。', 'この要員情報は停止または削除されているため、案件を探せません。'),
          action: t('返回人员列表', '要員一覧に戻る'),
          run: onBack
        }
      : businessStatus === 'assigned' || businessStatus === 'paused'
        ? {
            text:
              businessStatus === 'assigned'
                ? t(
                    '此人员已入场，暂不找案件。如已结束，请把营业状态改为待营业。',
                    'この要員は参画中のため、案件を探しません。終了した場合は営業状態を営業待ちに変更してください。'
                  )
                : t(
                    '此人员暂停营业，暂不找案件。恢复营业后请调整营业状态。',
                    'この要員は営業停止中のため、案件を探しません。再開する場合は営業状態を変更してください。'
                  ),
            action: t('调整营业状态', '営業状態を変更'),
            run: () => onView('person', source.id)
          }
        : !person.profile
          ? {
              text: t('此人员资料尚未确认，确认后即可找案件。', 'この要員情報はまだ確認されていません。確認後に案件を探せます。'),
              action: t('查看人员资料', '要員情報を見る'),
              run: () => onView('person', source.id)
            }
          : null
  const tokyoTime = (value: string) =>
    new Date(value).toLocaleString(zh ? 'zh-CN' : 'ja-JP', {
      timeZone: 'Asia/Tokyo',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  // Kept results show at once; their actions wait until the person's status is confirmed.
  const busyActions = starting || stale || pending || !valid
  const card = (row: Row, rank: number, confirmation: boolean) => (
    <MatchResultCard
      key={row.id}
      row={row}
      documentId={source.id}
      rank={rank}
      confirmation={confirmation}
      isSelected={selected[sourceId] === row.id}
      selectable={Boolean(onScheduleMany)}
      checked={(checked[sourceId] ?? []).includes(row.id)}
      disabled={busyActions}
      prepareDisabled={busyActions || !current}
      existing={existing(row)}
      progressNow={progress?.now}
      onToggle={() => toggle(row)}
      onOpen={() => openDetails(row)}
      onPrepare={() => prepare(row)}
      onStart={() => void start([row])}
    />
  )
  const excludedCount = saved?.result.excludedCount ?? 0
  const ownCompanyExcluded = saved?.result.ownCompanyExcludedCount ?? 0
  return (
    <section ref={exposureRoot} className="hr-matching-workspace" aria-label={t('为此人员找案件', 'この要員の案件を探す')}>
      <header className="hr-match-source">
        <button type="button" onClick={onBack}>
          ← {t('返回人员列表', '要員一覧に戻る')}
        </button>
        <small>{t('为此人员找案件', 'この要員の案件を探す')}</small>
        <button className="hr-source-title" onClick={() => onView('person', source.id)} type="button">
          {title}
        </button>
        <p>
          {(person?.fields ?? [])
            .filter((field) => ['skills', 'rate', 'location', 'availability'].includes(field.key) && field.value)
            .map((field) => field.value)
            .join(' · ')}
        </p>
        <button className="hr-primary" type="button" disabled={starting || pending || !valid} onClick={() => void run(source.id)}>
          {running ? t('正在找案件…', '案件を探しています…') : saved ? t('重新找案件', '案件を再検索') : t('找案件', '案件を探す')}
        </button>
        {stored && !running ? (
          <small className="hr-match-last-run">
            {t('上次找案件', '前回の検索')}：{tokyoTime(stored.ranAt)}
          </small>
        ) : null}
      </header>
      <div className="hr-match-results">
        {!ready ? (
          <p role="status" className="hr-match-progress">
            {t('正在确认人员状态…', '要員の状態を確認しています…')}
          </p>
        ) : null}
        {unavailable ? (
          <p role="alert" className="hr-match-unavailable">
            {unavailable.text}{' '}
            <button type="button" onClick={unavailable.run}>
              {unavailable.action}
            </button>
          </p>
        ) : null}
        {rulesRevision === 'failed' ? (
          <p role="alert" className="hr-match-rules-error">
            {t(
              '规则读取失败，暂时无法确认结果是否使用了最新规则。',
              'ルールを読み込めなかったため、最新のルールで評価したか確認できません。'
            )}{' '}
            <button
              type="button"
              onClick={() => {
                setRulesRevision('loading')
                loadRules(() => true)
              }}
            >
              {t('重试', '再試行')}
            </button>
          </p>
        ) : null}
        {running ? (
          <p role="status" className="hr-match-progress">
            {partial[sourceId] ? t('正在评估匹配度…', '適合度を評価しています…') : t('正在找案件…', '案件を探しています…')}{' '}
            <button
              type="button"
              onClick={() =>
                void window.sesAgent.cancelBusinessMatching({ kind: 'person', id: source.id }).catch((cause) =>
                  setErrors((state) => ({
                    ...state,
                    [sourceId]: localizedIpcError(
                      locale,
                      cause,
                      t('无法停止找案件，请重试。', '案件の検索を停止できませんでした。もう一度お試しください。')
                    )
                  }))
                )
              }
            >
              {t('停止', '停止')}
            </button>
          </p>
        ) : null}
        {errors[sourceId] ? <p role="alert">{errors[sourceId]}</p> : null}
        {stale ? (
          <p role="status" className="hr-match-stale">
            {t('人员、案件资料或 AI 规则已更新，需要重新找案件。', '情報またはAIルールが更新されました。案件を再検索してください。')}
          </p>
        ) : null}
        {saved && current && (valid || !ready) ? (
          <>
            <div className="hr-results-status">
              <strong>
                {recommendedRows.length} {t('个推荐案件', '件の紹介候補')}
              </strong>
              {confirmationRows.length ? (
                <strong className="hr-conditions-count">
                  {confirmationRows.length} {t('个案件需补充确认', '件は確認が必要')}
                </strong>
              ) : null}
              <span>
                {saved.result.cloud.status === 'reviewed'
                  ? t('AI 已评估', 'AI評価済み')
                  : saved.result.cloud.status === 'partial'
                    ? t('部分结果已评估', '一部の結果を評価済み')
                    : t('按条件核对', '条件照合')}
              </span>
            </div>
            <p className="hr-match-coverage">
              {t('已检索', '検索済み')} {saved.result.searchedCount ?? saved.result.localMatchCount} · {t('AI 已评估', 'AI評価済み')}{' '}
              {saved.result.cloud.reviewedCount}
              {excludedCount ? ` · ${t('已排除', '除外')} ${excludedCount}` : ''}
            </p>
            {excludedCount || ownCompanyExcluded || saved.result.cloud.modelName ? (
              <details className="hr-match-meta">
                <summary>{t('详情', '詳細')}</summary>
                {saved.result.excludedRequirements?.length ? (
                  <p>
                    {t('排除原因（缺少依据或不符合的要求）', '除外理由（根拠不足・条件不一致）')}：
                    {saved.result.excludedRequirements.join('、')}
                  </p>
                ) : null}
                {ownCompanyExcluded ? (
                  <p>{t(`${ownCompanyExcluded} 个案件因仅限自社人员而排除`, `自社要員限定のため ${ownCompanyExcluded} 件を除外`)}</p>
                ) : null}
                {saved.result.cloud.modelName ? (
                  <p>
                    {t('评估模型', '評価モデル')}：{saved.result.cloud.modelName}
                  </p>
                ) : null}
              </details>
            ) : null}
            {!running && ['failed', 'unavailable'].includes(saved.result.cloud.status) ? (
              <p className="hr-match-notice" role="status">
                {t(
                  'AI 评估未完成，先显示按条件核对的结果。可点击「重新找案件」重试。',
                  'AI評価は未完了のため、条件照合の結果を表示しています。「案件を再検索」で再試行できます。'
                )}
              </p>
            ) : null}
            {!recommendedRows.length && !confirmationRows.length && !running && !stale ? (
              <div className="hr-empty hr-match-empty" role="status">
                <strong>{t('暂无推荐案件', '紹介できる案件は見つかりませんでした')}</strong>
                <p>
                  {t(
                    '当前档案中没有找到具备全部必需条件依据的匹配结果。',
                    '現在の情報では、すべての必須条件を満たす根拠が見つかりませんでした。'
                  )}
                </p>
                {saved.result.excludedRequirements?.length ? (
                  <p>
                    {t('缺少依据或存在冲突的要求', '根拠不足・条件不一致')}：{saved.result.excludedRequirements.join('、')}
                  </p>
                ) : null}
              </div>
            ) : null}
            {onScheduleMany && recommendedRows.length + confirmationRows.length > 1 ? (
              <div className="hr-match-batch">
                <span>{t('可多选，每个案件分别跟进', '複数選択でき、案件ごとに対応します')}</span>
                {selectedRows.length ? (
                  <button disabled={busyActions} onClick={() => void start(selectedRows)}>
                    {starting
                      ? t(`正在开始跟进（${selectedRows.length}）`, `開始中（${selectedRows.length}）`)
                      : t(`为选中案件开始跟进（${selectedRows.length}）`, `選択した案件の対応を開始（${selectedRows.length}）`)}
                  </button>
                ) : null}
              </div>
            ) : null}
            {recommendedRows.map((row, rank) => card(row, rank, false))}
            {confirmationRows.length ? (
              <section className="hr-match-confirmation" aria-label={t('需补充确认的案件', '確認が必要な案件')}>
                <header>
                  <h3>
                    {t('需补充确认的案件', '確認が必要な案件')} <span>{confirmationRows.length}</span>
                  </h3>
                  <p>
                    {t(
                      '以下案件的要求与该人员资料对比时缺少技术或语言依据，需要补充确认；确认事项会带入跟进。',
                      '以下の案件は、この要員の情報と照合すると技術または言語の根拠が不足しています。確認事項は対応記録に引き継がれます。'
                    )}
                  </p>
                </header>
                {confirmationRows.map((row, rank) => card(row, rank, true))}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  )
}

/** One matched case: next actions first, evidence visible, AI/rule internals under 「详情」. */
function MatchResultCard({
  row,
  documentId,
  rank,
  confirmation,
  isSelected,
  selectable,
  checked,
  disabled,
  prepareDisabled,
  existing,
  progressNow,
  onToggle,
  onOpen,
  onPrepare,
  onStart
}: {
  row: PersonnelCaseMatch & { id: string; job?: JobCaseReviewSnapshot }
  /** The person being matched. */
  documentId: string
  rank: number
  confirmation: boolean
  isSelected: boolean
  selectable: boolean
  checked: boolean
  disabled: boolean
  prepareDisabled: boolean
  existing?: BusinessFollowUp
  progressNow?: Date
  onToggle(): void
  onOpen(): void
  onPrepare(): void
  onStart(): void
}) {
  const { zh, t } = useLocaleText()
  const title = row.job!.fields.find((field) => field.key === 'title')?.value ?? row.job!.redactedSubject
  const questions = row.appliedRules?.filter((rule) => rule.kind === 'confirm').map((rule) => rule.text)
  return (
    <article
      className={`hr-result-card${confirmation ? ' hr-confirmation-row' : ''}${isSelected ? ' is-selected' : ''}`}
      data-experience-run={row.experienceRunId}
      data-experience-rank={rank + 1}
      aria-current={isSelected ? 'true' : undefined}
    >
      <div className="hr-result-head">
        {selectable ? (
          <label className="hr-match-select">
            <input type="checkbox" disabled={disabled || Boolean(existing)} checked={checked} onChange={onToggle} />
            {t('选择此案件', 'この案件を選択')}
          </label>
        ) : null}
        <button className="hr-result-title" type="button" onClick={onOpen}>
          {title}
        </button>
        {existing && progressNow ? (
          <p className="hr-existing-progress">
            {t('已有跟进', '対応記録あり')} · {progressPresentation(existing, progressNow, zh).label}
          </p>
        ) : null}
      </div>
      <div className="hr-result-actions">
        <button className="hr-primary" disabled={prepareDisabled} type="button" onClick={onPrepare}>
          {t('准备介绍', '紹介を準備')}
        </button>
        <button type="button" disabled={disabled} onClick={onStart}>
          {existing ? t('继续跟进', '対応を続ける') : t('开始跟进', '対応を開始')}
        </button>
        <button type="button" onClick={onOpen}>
          {t('查看案件', '案件を見る')}
        </button>
      </div>
      <BusinessMatchEvidence qualification={row.qualification} questions={questions} zh={zh} />
      <AiOpinion opinion={row.assessment?.opinion} zh={zh} />
      <details className="hr-result-details">
        <summary>{t('详情', '詳細')}</summary>
        <InterviewEvidencePanel documentId={documentId} reviewId={row.job!.reviewId} />
        <RankingReason ranking={row.ranking} zh={zh} />
        {row.appliedRules?.length ? (
          <div className="work-rule-applied">
            <strong>{t('本次采用的规则', '今回適用したルール')}</strong>
            <ul>
              {row.appliedRules.map((rule, i) => (
                <li key={i}>
                  v{rule.revision} · {rule.text}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </details>
    </article>
  )
}
