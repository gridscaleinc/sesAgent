import { focusRequirement, hasPendingRequirementFocus, onRequirementFocus } from '../requirement-decision-events'
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
  PersonnelCaseMatchResult,
  CandidateMatchAssessment
} from '@shared'
import {
  businessMatchingPolicyVersion,
  excludedByHr,
  isPersonnelAvailable,
  qualificationStatus,
  matchFollowUpLabels,
  proposalConclusion
} from '@shared'
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
import { localizedCandidateFieldLabel, localizedIpcError, useLocaleText } from '../i18n'
import type { FollowUpTarget } from './follow-up-target'
import { ActionMenu } from './HrObjectList'
import {
  ConclusionBadge,
  ExcludedSection,
  MatchBackButton,
  MatchDetail,
  MatchResultList,
  MatchResultRow,
  MatchResultsBody,
  MatchResultsPage,
  Popover,
  RequirementChips,
  conclusionTone,
  shortConclusion
} from './MatchResultsLayout'
import { FollowUpTab, MatchEvidenceTab, followUpItems } from './RequirementTable'
import { AppliedRules, InterviewQuestionsSection, RelatedProjects, relatedProjects, useCaseQuestionDraft } from './MatchDetailSections'
import { tokyoDateTime } from './use-case-resume-assessments'
import { RecommendationPointsTab } from './RecommendationPoints'
import './hr-matching.css'

/** One 「找案件」 click for a person; a new requestId is a new click. */
export interface HrMatchSource {
  kind: 'person'
  id: string
  requestId: number
  /** The case to select once the results show (e.g. the pair opened from 新匹配机会). */
  selectReviewId?: string
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
  backLabel,
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
  /** Returns to where the results were opened from: the person list unless `backLabel` names another page. */
  onBack(): void
  /** The back button's wording when the results were not opened from the person list (e.g. 返回新匹配机会). */
  backLabel?: string
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
  const [tab, setTab] = useState('evidence')
  // A requirement to show (a list chip, 「确认条件」) opens 匹配依据, where its row is highlighted.
  useEffect(() => {
    if (hasPendingRequirementFocus()) setTab('evidence')
    return onRequirementFocus(() => setTab('evidence'))
  }, [])
  const [showDetail, setShowDetail] = useState(false)
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
  // A requested case is selected (and its detail shown) each time a new request asks for it.
  useEffect(() => {
    if (!source?.selectReviewId) return
    setSelected((state) => ({ ...state, [source.id]: source.selectReviewId! }))
    setShowDetail(true)
  }, [source?.requestId])
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
  // The person's recorded placement, if any: 已进场 then leads to it.
  const placement = person
    ? (progress?.indexes.person.get(person.documentId) ?? []).find((row) => row.progress?.stage === 'started')
    : undefined
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
  const personUsable = person?.recordStatus === 'active' && isPersonnelAvailable(businessStatus)
  // A case ended or edited since the run drops out of the result; the rest stays usable.
  const rowCurrent = (row: (typeof rows)[number]) => row.job?.lifecycle === 'active' && row.jobCaseVersion === row.job?.jobCase?.version
  const freshRows = rows.filter((row) => personUsable && rowCurrent(row))
  const droppedRows = rows.filter((row) => !rowCurrent(row)).length
  // Cases added since the run are not in the result: offered as a new search, without locking what was found.
  const caseIds = (signature: string) => signature.split(',').flatMap((key) => (key ? [key.split(':')[0]!] : []))
  const newCases = Boolean(saved && caseIds(caseSignature(cases)).some((id) => !caseIds(saved.caseSignature).includes(id)))
  const policyCurrent = rows.every((row) => row.qualification?.policyVersion === businessMatchingPolicyVersion)
  const recommendedRows = policyCurrent ? freshRows.filter((row) => row.qualification?.status === 'recommended') : []
  const confirmationRows = policyCurrent
    ? freshRows.filter(
        (row) => row.qualification?.status === 'needs-confirmation' && qualificationStatus(row.qualification.requirements) !== 'excluded'
      )
    : []
  // HR judged a requirement 不满足: still listed, marked and last, so the decision can be reviewed or withdrawn.
  const rejectedRows = policyCurrent ? freshRows.filter((row) => excludedByHr(row.qualification)) : []
  useExperienceExposure(exposureRoot, `person:${sourceId}:${rows.map((row) => row.experienceRunId ?? '').join(',')}`)
  const stale = Boolean(
    saved &&
    ((typeof rulesRevision === 'number' && (saved.result.rulesRevision ?? 0) !== rulesRevision) ||
      !current ||
      !policyCurrent ||
      (saved.policyVersion !== undefined && saved.policyVersion !== businessMatchingPolicyVersion) ||
      (rows.length > 0 && !personUsable))
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
          action: backLabel ?? t('返回人员列表', '要員一覧に戻る'),
          run: onBack
        }
      : businessStatus === 'assigned' && placement && onContinue
        ? {
            // In place through a recorded start: the placement record is where 记录退场 is.
            text: t(
              '此人员已进场，暂不找案件。项目快结束时可在人员资料里改为近期可入场；项目结束后请在跟进中记录退场。',
              'この要員は参画中のため、案件を探しません。終了が近ければ要員情報で「近日稼働可能」に変更できます。案件終了後は対応記録で退場を記録してください。'
            ),
            action: t('查看进场记录', '参画記録を見る'),
            run: () => onContinue({ documentId: placement.documentId, reviewId: placement.reviewId })
          }
        : businessStatus === 'assigned' || businessStatus === 'paused'
          ? {
              text:
                businessStatus === 'assigned'
                  ? t(
                      '此人员的营业状态是已进场，但没有对应的进场记录，暂不找案件。如需继续，请调整营业状态。',
                      'この要員は参画中になっていますが、参画記録がないため案件を探しません。続ける場合は営業状態を変更してください。'
                    )
                  : t(
                      '此人员暂停营业，暂不找案件。如需恢复，请调整营业状态。',
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
  const excludedCount = saved?.result.excludedCount ?? 0
  const ownCompanyExcluded = saved?.result.ownCompanyExcludedCount ?? 0
  const showResults = Boolean(saved && current && (valid || !ready))
  const listed = showResults ? [...recommendedRows, ...confirmationRows, ...rejectedRows] : []
  const currentRow = listed.find((row) => row.id === selected[sourceId]) ?? listed[0]
  // A case asked for (from 新匹配机会) that this person's result does not hold is said, not silently replaced.
  const missingTarget =
    source?.selectReviewId &&
    saved &&
    !running &&
    selected[sourceId] === source.selectReviewId &&
    !listed.some((row) => row.id === source.selectReviewId)
      ? cases.find((item) => item.reviewId === source.selectReviewId)
      : undefined
  const choose = (row: Row, pointer: boolean) => {
    if (row.id !== currentRow?.id) recordExperienceOpened(row.experienceRunId)
    setSelected((state) => ({ ...state, [sourceId]: row.id }))
    if (pointer) setShowDetail(true)
  }
  const resultRow = (row: Row, rank: number) => {
    const follow = existing(row)
    const settled = row.qualification?.requirements.filter((item) => item.aiVerified).length ?? 0
    return (
      <MatchResultRow
        key={row.id}
        id={row.id}
        title={caseTitle(row.job!)}
        selected={row.id === currentRow?.id}
        onSelect={() => choose(row, true)}
        onRequirement={(label) => {
          setTab('evidence')
          focusRequirement(label)
        }}
        experienceRun={row.experienceRunId}
        rank={rank + 1}
        badge={<ConclusionBadge tone={conclusionTone(row.qualification)}>{shortConclusion(row.qualification, t)}</ConclusionBadge>}
        chips={<RequirementChips qualification={row.qualification} />}
        select={
          onScheduleMany
            ? {
                label: t('选择此案件', 'この案件を選択'),
                checked: (checked[sourceId] ?? []).includes(row.id),
                disabled: busyActions || Boolean(follow) || excludedByHr(row.qualification),
                onChange: () => toggle(row)
              }
            : null
        }
        tags={
          (follow && progress) || settled ? (
            <>
              {follow && progress ? (
                <span className="match-tag is-follow">{progressPresentation(follow, progress.now, zh).label}</span>
              ) : null}
              {settled ? <span className="match-tag">{t(`AI 核实 ${settled}`, `AI確認 ${settled}`)}</span> : null}
            </>
          ) : null
        }
      />
    )
  }
  const summaryFields = (person?.fields ?? []).filter(
    (field) => ['skills', 'rate', 'location', 'availability'].includes(field.key) && field.value
  )
  const header = (
    <>
      <MatchBackButton label={backLabel ?? t('返回人员列表', '要員一覧に戻る')} onClick={onBack} />
      <h2 className="match-page-title">{title}</h2>
      <Popover label={t('人员概要', '要員の概要')} trigger={t('概要', '概要')}>
        {summaryFields.length ? (
          <dl className="match-popover-fields">
            {summaryFields.map((field) => (
              <div key={field.key}>
                <dt>{localizedCandidateFieldLabel(locale, field)}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="match-muted">{t('人员资料中还没有技能、单价等概要。', '要員情報にスキル・単価などの概要がまだありません。')}</p>
        )}
        <button type="button" onClick={() => onView('person', source.id)}>
          {t('查看人员资料', '要員情報を見る')}
        </button>
      </Popover>
      <span className="match-page-spacer" />
      <button className="hr-primary" type="button" disabled={starting || pending || !valid} onClick={() => void run(source.id)}>
        {running ? t('正在找案件…', '案件を探しています…') : saved ? t('重新找案件', '案件を再検索') : t('找案件', '案件を探す')}
      </button>
    </>
  )
  const status = (
    <>
      {running ? (
        <span role="status" className="hr-match-progress">
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
        </span>
      ) : null}
      {missingTarget ? (
        <span className="hr-match-new-cases is-missing" role="status">
          {t(
            `「${caseTitle(missingTarget)}」不在这个人员的找案件结果里（结果只保留匹配度最高的几个案件），可以从案件一侧查看这一组。`,
            `「${caseTitle(missingTarget)}」はこの要員の検索結果にありません（結果は適合度の高い案件のみ）。案件側からこの組み合わせを確認できます。`
          )}
          <button type="button" onClick={() => onView('case', missingTarget.reviewId)}>
            {t('打开案件', '案件を開く')}
          </button>
        </span>
      ) : null}
      {!stale && !running && (newCases || droppedRows) ? (
        <span className="hr-match-new-cases" role="status">
          {newCases
            ? t('有新案件加入，可以重新找案件', '新しい案件があります。案件を探し直せます')
            : t(`${droppedRows} 个案件已结束或更新，已从结果中移除`, `${droppedRows} 件の案件が終了・更新されたため結果から外しました`)}
        </span>
      ) : null}
      {stored && !running ? (
        <span className="hr-match-last-run">
          {t('上次找案件', '前回の検索')}：{tokyoTime(stored.ranAt)}
        </span>
      ) : null}
      {saved && showResults ? (
        <>
          <strong>
            {recommendedRows.length} {t('个推荐案件', '件の紹介候補')}
          </strong>
          {confirmationRows.length ? (
            <strong className="hr-conditions-count">
              {confirmationRows.length} {t('个案件需补充确认', '件は確認が必要')}
            </strong>
          ) : null}
          <span className="hr-match-coverage">
            {t('已检索', '検索済み')} {saved.result.searchedCount ?? saved.result.localMatchCount} · {t('AI 已评估', 'AI評価済み')}{' '}
            {saved.result.cloud.reviewedCount}
            {excludedCount ? ` · ${t('已排除', '除外')} ${excludedCount}` : ''}
          </span>
          <span>
            {saved.result.cloud.status === 'reviewed'
              ? t('AI 已评估', 'AI評価済み')
              : saved.result.cloud.status === 'partial'
                ? t('部分结果已评估', '一部の結果を評価済み')
                : t('按条件核对', '条件照合')}
          </span>
        </>
      ) : null}
    </>
  )
  const notices = (
    <>
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
      {errors[sourceId] ? <p role="alert">{errors[sourceId]}</p> : null}
      {stale ? (
        <p role="status" className="hr-match-stale">
          {t('人员、案件资料或 AI 规则已更新，需要重新找案件。', '情報またはAIルールが更新されました。案件を再検索してください。')}
        </p>
      ) : null}
      {saved && showResults && !running && ['failed', 'unavailable'].includes(saved.result.cloud.status) ? (
        <p className="hr-match-notice" role="status">
          {saved.result.cloud.reason === 'insufficient-credits'
            ? t(
                'AI 额度不足，先显示按条件核对的结果。请在 AI 会员中心充值后点击「重新找案件」。',
                'AIクレジットが不足しているため、条件照合の結果を表示しています。AI会員センターでチャージしてから「案件を再検索」してください。'
              )
            : saved.result.cloud.reason === 'sign-in-required'
              ? t(
                  'AI 未登录，先显示按条件核对的结果。登录 AI 会员后点击「重新找案件」。',
                  'AIにログインしていないため、条件照合の結果を表示しています。AI会員にログインしてから「案件を再検索」してください。'
                )
              : t(
                  'AI 评估未完成，先显示按条件核对的结果。可点击「重新找案件」重试。',
                  'AI評価は未完了のため、条件照合の結果を表示しています。「案件を再検索」で再試行できます。'
                )}
        </p>
      ) : null}
    </>
  )
  const list =
    saved && showResults ? (
      <>
        {!listed.length && !running && !stale ? (
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
        {onScheduleMany && selectedRows.length ? (
          <button type="button" className="match-batch" disabled={busyActions} onClick={() => void start(selectedRows)}>
            {starting
              ? t(`正在开始跟进（${selectedRows.length}）`, `開始中（${selectedRows.length}）`)
              : t(`为选中案件开始跟进（${selectedRows.length}）`, `選択した案件の対応を開始（${selectedRows.length}）`)}
          </button>
        ) : null}
        {listed.length ? (
          <MatchResultList
            label={t('案件', '案件')}
            onMove={(id) => {
              const row = listed.find((item) => item.id === id)
              if (row) choose(row, false)
            }}
          >
            {recommendedRows.map((row, rank) => resultRow(row, rank))}
            {confirmationRows.length ? (
              <li className="match-group-head" role="presentation">
                <strong>
                  {t('需补充确认的案件', '確認が必要な案件')} <span>{confirmationRows.length}</span>
                </strong>
                <small>
                  {t(
                    '缺少技术或语言依据，需要补充确认；确认事项会带入跟进。',
                    '技術または言語の根拠が不足しています。確認事項は対応記録に引き継がれます。'
                  )}
                </small>
              </li>
            ) : null}
            {confirmationRows.map((row, rank) => resultRow(row, rank))}
            {rejectedRows.length ? (
              <li className="match-group-head is-rejected" role="presentation">
                <strong>
                  {t('HR 确认不满足', 'HRが未充足と確認')} <span>{rejectedRows.length}</span>
                </strong>
                <small>{t('在「匹配依据」里可以查看或撤销这个判断。', '「マッチングの根拠」で判断を確認・取り消しできます。')}</small>
              </li>
            ) : null}
            {rejectedRows.map((row, rank) => resultRow(row, rank))}
          </MatchResultList>
        ) : null}
        <ExcludedSection count={excludedCount + ownCompanyExcluded}>
          {saved.result.excludedRequirements?.length ? (
            <p>
              {t('排除原因（缺少依据或不符合的要求）', '除外理由（根拠不足・条件不一致）')}：{saved.result.excludedRequirements.join('、')}
            </p>
          ) : null}
          {ownCompanyExcluded ? (
            <p>{t(`${ownCompanyExcluded} 个案件因仅限自社人员而排除`, `自社要員限定のため ${ownCompanyExcluded} 件を除外`)}</p>
          ) : null}
        </ExcludedSection>
      </>
    ) : null
  return (
    <MatchResultsPage
      label={t('为此人员找案件', 'この要員の案件を探す')}
      rootRef={exposureRoot}
      className="person-cases-page"
      header={header}
      status={status}
      notices={notices}
      body={
        <MatchResultsBody
          list={list}
          showDetail={showDetail && Boolean(currentRow)}
          detail={
            currentRow ? (
              <CaseMatchDetail
                key={currentRow.id}
                row={currentRow}
                person={person}
                documentId={source.id}
                ranAt={stored?.ranAt ?? null}
                cloud={saved!.result.cloud}
                tab={tab}
                onTab={setTab}
                onBackToList={() => setShowDetail(false)}
                // HR's 不满足 keeps the case listed for review, not for proposing.
                // An existing follow-up stays reachable whatever the result says; a new one needs a current, proposable result.
                disabled={existing(currentRow) ? starting : busyActions || excludedByHr(currentRow.qualification)}
                prepareDisabled={busyActions || !current || excludedByHr(currentRow.qualification)}
                pointsBlocked={
                  !valid
                    ? t('此人员当前不可用于提案。', 'この要員は現在提案に使えません。')
                    : stale || !current
                      ? t('匹配结果已过期，请先重新找案件。', 'マッチング結果が古くなっています。先に案件を探し直してください。')
                      : ''
                }
                existing={existing(currentRow)}
                progressNow={progress?.now}
                onPrepare={() => prepare(currentRow)}
                onStart={() => void start([currentRow])}
                onViewCase={() => {
                  recordExperienceOpened(currentRow.experienceRunId)
                  onView('case', currentRow.id)
                }}
                onViewPerson={() => onView('person', source.id)}
              />
            ) : null
          }
        />
      }
    />
  )
}

const caseTitle = (job: JobCaseReviewSnapshot) => job.fields.find((field) => field.key === 'title')?.value ?? job.redactedSubject

/** The selected case for a person: next steps in the header, the evaluation in tabs. */
function CaseMatchDetail({
  row,
  person,
  documentId,
  ranAt,
  cloud,
  tab,
  onTab,
  onBackToList,
  disabled,
  prepareDisabled,
  pointsBlocked,
  existing,
  progressNow,
  onPrepare,
  onStart,
  onViewCase,
  onViewPerson
}: {
  row: PersonnelCaseMatch & { id: string; job?: JobCaseReviewSnapshot }
  person?: CandidateReviewSnapshot
  /** The person being matched. */
  documentId: string
  ranAt: string | null
  cloud: PersonnelCaseMatchResult['cloud']
  tab: string
  onTab(id: string): void
  onBackToList(): void
  disabled: boolean
  prepareDisabled: boolean
  /** Why 推荐要点 cannot be generated now (person unavailable, result outdated); empty when they can. */
  pointsBlocked: string
  existing?: BusinessFollowUp
  progressNow?: Date
  onPrepare(): void
  onStart(): void
  onViewCase(): void
  onViewPerson(): void
}) {
  const { zh, t } = useLocaleText()
  const title = caseTitle(row.job!)
  const questions = row.appliedRules?.filter((rule) => rule.kind === 'confirm').map((rule) => rule.text) ?? []
  const follow = followUpItems(row.qualification, questions)
  const followTotal = follow.items.length + follow.questions.length + follow.asking.length
  const draft = useCaseQuestionDraft(documentId, row.jobCaseId)
  const [notice, setNotice] = useState('')
  const exposureRoot = useRef<HTMLElement>(null)
  useExperienceExposure(exposureRoot, row.experienceRunId ?? '')
  const tabs = [
    {
      id: 'evidence',
      label: t('匹配依据', 'マッチングの根拠'),
      content: <MatchEvidenceTab qualification={row.qualification} pair={{ documentId, jobCaseId: row.jobCaseId }} />
    },
    {
      id: 'points',
      label: t('推荐要点', '推薦ポイント'),
      content: <RecommendationPointsTab documentId={documentId} reviewId={row.job!.reviewId} blocked={pointsBlocked} />
    },
    {
      id: 'follow-up',
      label: followTotal ? t(`需沟通 (${followTotal})`, `要相談 (${followTotal})`) : t('需沟通', '要相談'),
      content: <FollowUpTab qualification={row.qualification} questions={questions} />
    },
    {
      id: 'ai',
      label: t('AI 意见', 'AIの意見'),
      content: (
        <div className="match-ai">
          <AiOpinion opinion={row.assessment?.opinion} zh={zh} />
          <p className="match-muted">
            {cloud.status === 'reviewed'
              ? t('已完成云端 AI 评估', 'Cloud AI評価済み')
              : cloud.status === 'partial'
                ? t('部分结果已完成云端 AI 评估', '一部の結果のみCloud AI評価済み')
                : t('当前显示本地规则核对结果。', 'ローカル照合結果を表示しています。')}
            {cloud.modelName ? ` · ${t('评估模型', '評価モデル')}：${cloud.modelName}` : ''}
          </p>
          <RankingReason ranking={row.ranking} zh={zh} />
          <AppliedRules rules={row.appliedRules} />
        </div>
      )
    },
    ...(draft.questions.length
      ? [
          {
            id: 'questions',
            label: t('面试问题', '面談質問'),
            content: <InterviewQuestionsSection questions={draft.questions} stale={draft.stale} error={draft.error} onCopied={setNotice} />
          }
        ]
      : []),
    {
      id: 'record',
      label: t('记录', '記録'),
      content: (
        <div className="match-record">
          {ranAt ? (
            <p className="case-assessment-time">
              {t('评估时间', '評価日時')}：{tokyoDateTime(ranAt, zh)}
            </p>
          ) : null}
          <RelatedProjects projects={relatedProjects(person, row.qualification?.requirements ?? [])} />
          <InterviewEvidencePanel documentId={documentId} reviewId={row.job!.reviewId} />
        </div>
      )
    }
  ]
  return (
    <MatchDetail
      label={title}
      rootRef={exposureRoot}
      experienceRun={row.experienceRunId}
      title={title}
      badge={<ConclusionBadge tone={conclusionTone(row.qualification)}>{proposalConclusion(row.qualification, zh)}</ConclusionBadge>}
      status={
        existing && progressNow ? (
          <span className="match-detail-status">
            {t('已有跟进', '対応記録あり')} · {progressPresentation(existing, progressNow, zh).label}
          </span>
        ) : null
      }
      tab={tab}
      onTab={onTab}
      tabs={tabs}
      onBackToList={onBackToList}
      notice={
        <>
          {draft.error && !draft.questions.length ? <p role="alert">{draft.error}</p> : null}
          {notice ? <p role="status">{notice}</p> : null}
        </>
      }
      actions={
        <>
          <button className="hr-primary" disabled={prepareDisabled} type="button" onClick={onPrepare}>
            {t('准备介绍', '紹介を準備')}
          </button>
          <button type="button" disabled={disabled} onClick={onStart}>
            {existing ? t('继续跟进', '対応を続ける') : t('开始跟进', '対応を開始')}
          </button>
          <ActionMenu
            label={t('更多操作', 'その他の操作')}
            trigger={<span aria-hidden="true">⋯</span>}
            triggerClassName="match-menu-trigger"
          >
            <button type="button" role="menuitem" onClick={onViewCase}>
              {t('查看案件', '案件を見る')}
            </button>
            <button type="button" role="menuitem" onClick={onViewPerson}>
              {t('查看人员资料', '要員情報を見る')}
            </button>
          </ActionMenu>
        </>
      }
    />
  )
}
