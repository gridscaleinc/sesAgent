import { focusRequirement, hasPendingRequirementFocus, onRequirementFocus } from '../requirement-decision-events'
import { useEffect, useRef, useState } from 'react'
import {
  businessMatchingPolicyVersion,
  excludedByHr,
  matchEvidenceSections,
  type CandidateReviewSnapshot,
  type CasePersonAssessment,
  type JobCaseReviewSnapshot
} from '@shared'
import { localizedIpcError, useUiLocale, localizedCaseFieldLabel } from '../i18n'
import { AiWorkRulesPanel, workRulesChangedEvent } from './AiWorkRulesPanel'
import {
  pendingResumeTask,
  tokyoDateTime,
  type CaseResumeController,
  type CaseResumeTask,
  type ExcludedCaseTask
} from './use-case-resume-assessments'
import { recordExperienceOpened, useExperienceExposure } from './experience-exposure'
import { progressPairKey, progressPresentation, useBusinessProgress } from '../business-progress-data'
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
  shortConclusion,
  type ConclusionTone
} from './MatchResultsLayout'
import { CasePersonDetail, type MatchDetailTabId } from './CasePersonDetail'
import './case-resume-panel.css'

interface Props {
  focusTaskId?: string | null
  job: JobCaseReviewSnapshot
  people: CandidateReviewSnapshot[]
  controller: CaseResumeController
  /** Returns to where the results were opened from: the case list unless `backLabel` names another page. */
  onBack(): void
  /** The back button's wording when the results were not opened from the case list (e.g. 返回新匹配机会). */
  backLabel?: string
  onOriginal(documentId: string): void
  onPrepare(value: CasePersonAssessment): void
  /** Opens the existing follow-up of this person and case. */
  onFollowUp(value: CasePersonAssessment): void
  /** Creates follow-up records for these people and opens the first one. */
  onSchedule?(values: CasePersonAssessment[]): Promise<void>
  /** Opens the person page's import, offered when the person library has nobody to match yet. */
  onOpenPersonImport?(): void
  /** Opens the person's own information beside the results. */
  onPerson?(documentId: string): void
}
const fileHint = (t: (cn: string, ja: string) => string) =>
  `PDF · Word · Excel · ${t('每次最多 10 份，每份 30 MB', '1回10件まで、各30 MB')}`

/** 找人 for one case: the case's results page in the main area, a people list beside the selected person's detail. */
export function CaseResumeAssessmentPanel({
  job,
  people,
  controller,
  focusTaskId,
  onBack,
  backLabel,
  onOriginal,
  onPrepare,
  onFollowUp,
  onSchedule,
  onOpenPersonImport,
  onPerson
}: Props) {
  const locale = useUiLocale()
  const zh = locale === 'zh-CN',
    t = (cn: string, ja: string) => (zh ? cn : ja)
  const [selected, setSelected] = useState<Record<string, string | null>>({})
  const [checked, setChecked] = useState<Record<string, string[]>>({})
  const [tab, setTab] = useState<MatchDetailTabId>('evidence')
  // A requirement to show (a list chip, 「确认条件」) opens 匹配依据, where its row is highlighted.
  useEffect(() => {
    if (hasPendingRequirementFocus()) setTab('evidence')
    return onRequirementFocus(() => setTab('evidence'))
  }, [])
  const [showDetail, setShowDetail] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const [error, setError] = useState(''),
    [addingPerson, setAddingPerson] = useState('')
  const [rulesRevision, setRulesRevision] = useState<number | null>(null)
  const [savingPeople, setSavingPeople] = useState<Set<string>>(new Set())
  const [admittedPeople, setAdmittedPeople] = useState<Set<string>>(new Set())
  const admissionLocks = useRef(new Set<string>())
  const [rulesError, setRulesError] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false),
    [starting, setStarting] = useState(false)
  const startLock = useRef(false)
  const progress = useBusinessProgress()
  const exposureRoot = useRef<HTMLElement>(null)
  const scrollRoot = useRef<HTMLDivElement>(null)
  const scrolls = useRef<Record<string, number>>({})
  useEffect(() => {
    const element = scrollRoot.current
    if (element) element.scrollTop = scrolls.current[job.reviewId] ?? 0
    setError('')
    setAddingPerson('')
    setRulesOpen(false)
    setShowDetail(false)
  }, [job.reviewId])
  useEffect(() => {
    if (focusTaskId && controller.tasks.some((task) => task.id === focusTaskId && task.reviewId === job.reviewId)) {
      setSelected((state) => ({ ...state, [job.reviewId]: focusTaskId }))
      setShowDetail(true)
      scrollRoot.current?.scrollTo?.({ top: 0 })
    }
  }, [focusTaskId, job.reviewId])
  const { loadHistory } = controller
  useEffect(() => {
    void loadHistory(job)
  }, [job.reviewId, job.jobCase?.id, loadHistory])
  useEffect(() => {
    let live = true
    const refresh = () => {
      void window.sesAgent
        .listWorkRules()
        .then((value) => {
          if (live) {
            setRulesRevision(value.revision)
            setRulesError(false)
          }
        })
        .catch(() => {
          if (live) {
            setRulesRevision(null)
            setRulesError(true)
          }
        })
    }
    refresh()
    window.addEventListener(workRulesChangedEvent, refresh)
    return () => {
      live = false
      window.removeEventListener(workRulesChangedEvent, refresh)
    }
  }, [])
  const { refreshAvailability } = controller
  useEffect(() => {
    refreshAvailability()
  }, [people, refreshAvailability])
  const unavailablePeople = controller.unavailable
  const peopleById = new Map(people.map((person) => [person.documentId, person]))
  const personFor = (task: CaseResumeTask) => peopleById.get(task.documentId ?? '') ?? task.person
  const search = controller.searches[job.reviewId]
  const existing = (task: CaseResumeTask) =>
    task.documentId ? progress?.indexes.pairs.get(progressPairKey({ documentId: task.documentId, reviewId: job.reviewId })) : undefined
  const { tasks, hiddenDuplicates, excluded, lastSearchedAt } = controller.visible(job.reviewId, people, (task) => Boolean(existing(task)))
  const active = job.lifecycle === 'active'
  // Unknown rules (still loading or failed to load) block proposals, but are not shown as outdated results.
  const rulesKnown = rulesRevision !== null
  // An ended case keeps its history readable; only a changed profile, case, rule or policy makes a result outdated.
  const staleFor = (assessment: CasePersonAssessment, person?: CandidateReviewSnapshot) =>
    assessment.id.startsWith('preview:') ||
    assessment.result.qualification?.policyVersion !== businessMatchingPolicyVersion ||
    assessment.jobCaseVersion !== job.jobCase?.version ||
    assessment.jobCaseId !== job.jobCase?.id ||
    (rulesKnown && assessment.rulesRevision !== rulesRevision) ||
    !person?.profile ||
    person.profile.version !== assessment.profileVersion
  /** Why the next-step actions are unavailable for this person; empty when they can be used. */
  const blockedReason = (task: CaseResumeTask) => {
    if (!active) return t('案件已结束', '案件は終了しています')
    if (pendingResumeTask(task)) return t('正在评估，请稍候', '評価中です。しばらくお待ちください')
    if (!task.assessment) return t('评估未完成', '評価が完了していません')
    if (task.assessment.id.startsWith('preview:')) return t('匹配度评估尚未完成', '適合度の評価がまだ完了していません')
    if (personFor(task)?.recordStatus === 'deleted') return t('人员已删除', '要員は削除されています')
    if (unavailablePeople.has(task.documentId ?? ''))
      return t('此人员已进场或暂停营业，请先更新营业状态', '参画中または営業停止中です。先に営業状況を更新してください')
    if (!rulesKnown)
      return rulesError
        ? t('规则读取失败，请先重试', 'ルールを読み込めません。先に再試行してください')
        : t('正在读取规则…', 'ルールを読込中…')
    if (staleFor(task.assessment, personFor(task)))
      return t('资料或规则已更新，请先重新评估', '情報またはルールが更新されました。先に再評価してください')
    if (excludedByHr(task.assessment.result.qualification))
      return t(
        'HR 已确认不满足；如需提案，请先在匹配依据中撤销这个判断',
        'HRが未充足と確認済みです。提案する場合は、先にマッチングの根拠で判断を取り消してください'
      )
    return ''
  }
  const canUse = (task: CaseResumeTask) => !blockedReason(task)
  const nameFor = (item: CaseResumeTask) =>
    personFor(item)?.localIdentity?.displayName ?? (item.name || personFor(item)?.fileName || t('已评估人员', '評価済み要員'))
  const statusLabel = (status: CaseResumeTask['status']) =>
    ({
      queued: t('等待处理', '処理待ち'),
      parsing: t('正在解析简历', '履歴書を解析中'),
      assessing: t('正在评估', '評価中'),
      completed: t('已完成', '完了'),
      failed: t('处理失败', '処理失敗')
    })[status]
  /** The row's badge: work in progress, an outdated result, or the proposal conclusion. */
  const badgeFor = (task: CaseResumeTask): { tone: ConclusionTone; label: string } => {
    if (task.status !== 'completed') return { tone: task.status === 'failed' ? 'failed' : 'busy', label: statusLabel(task.status) }
    if (task.assessment && !task.assessment.id.startsWith('preview:') && active && staleFor(task.assessment, personFor(task)))
      return { tone: 'stale', label: t('需重新评估', '再評価が必要') }
    return {
      tone: conclusionTone(task.assessment?.result.qualification),
      label: shortConclusion(task.assessment?.result.qualification, t)
    }
  }
  const selectedTasks = tasks.filter((task) => (checked[job.reviewId] ?? []).includes(task.id) && canUse(task) && !existing(task))
  const schedule = async (items: CaseResumeTask[]) => {
    if (!onSchedule || startLock.current || !items.length) return
    startLock.current = true
    setStarting(true)
    setError('')
    try {
      await onSchedule(items.flatMap((item) => (item.assessment ? [item.assessment] : [])))
      setChecked((state) => ({ ...state, [job.reviewId]: [] }))
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法开始跟进，请重试。', '対応を開始できませんでした。もう一度お試しください。')))
    } finally {
      startLock.current = false
      setStarting(false)
    }
  }
  const addToLibrary = async (person: CandidateReviewSnapshot) => {
    if (!person.profile || admissionLocks.current.has(person.documentId)) return
    admissionLocks.current.add(person.documentId)
    setSavingPeople(new Set(admissionLocks.current))
    setError('')
    try {
      await window.sesAgent.addCandidateToLibrary({ documentId: person.documentId, profileVersion: person.profile.version })
      setAdmittedPeople((current) => new Set([...current, person.documentId]))
      window.dispatchEvent(new Event('ses-business-data-changed'))
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法加入人员库，请重试。', '要員一覧に追加できませんでした。もう一度お試しください。')))
    } finally {
      admissionLocks.current.delete(person.documentId)
      setSavingPeople(new Set(admissionLocks.current))
    }
  }
  useExperienceExposure(exposureRoot, `${job.reviewId}:${tasks.map((task) => task.assessment?.result.experienceRunId ?? '').join(',')}`)
  const importFiles = (files: File[]) => {
    if (!files.length) return
    try {
      setError('')
      const id = controller.enqueue(job, files)
      setSelected((state) => ({ ...state, [job.reviewId]: id }))
      if (scrollRoot.current) scrollRoot.current.scrollTop = 0
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('无法导入简历。', '履歴書を取り込めませんでした。')))
    }
  }
  // Results that need a fresh assessment; searched people are refreshed by one new search, added people one by one.
  const staleTasks = tasks.filter(
    (task) =>
      active &&
      rulesKnown &&
      task.status === 'completed' &&
      task.assessment &&
      !task.assessment.id.startsWith('preview:') &&
      personFor(task)?.recordStatus !== 'deleted' &&
      staleFor(task.assessment, personFor(task))
  )
  const reassessAll = () => {
    if (staleTasks.some((task) => task.origin === 'search')) void controller.search(job, true)
    for (const task of staleTasks) if (task.origin !== 'search') controller.retry(task.id, job.jobCase?.id)
  }
  const searchedAt = [search?.searchedAt, lastSearchedAt]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)
  // Library people confirmed after the last search were not part of it.
  const newerPeople = searchedAt
    ? people.filter(
        (person) =>
          person.recordStatus === 'active' &&
          person.inTalentLibrary !== false &&
          person.profile &&
          Date.parse(person.profile.confirmedAt) > Date.parse(searchedAt)
      ).length
    : 0
  const excludedReason = ({ task, reason }: ExcludedCaseTask) => {
    if (reason === 'unavailable') return t('已进场或暂停营业', '参画中または営業停止中')
    if (reason === 'archived') return t('人员已归档', 'アーカイブ済み')
    const conflicts = matchEvidenceSections(task.assessment?.result.qualification).conflicts.map((item) => item.requirement.label)
    const labels = conflicts.length ? conflicts : (task.assessment?.result.missing ?? [])
    return labels.length ? `${t('不满足', '未充足')}：${labels.join('、')}` : t('不符合硬性条件', '必須条件を満たしていません')
  }
  const excludedCounts = {
    requirements: excluded.filter((item) => item.reason === 'requirements').length,
    unavailable: excluded.filter((item) => item.reason === 'unavailable').length,
    archived: excluded.filter((item) => item.reason === 'archived').length
  }
  const hasResults = Boolean(search?.result || tasks.length || excluded.length || searchedAt)
  // People who can be searched at all; with none, "no match" would blame skills for an empty library.
  const libraryCount = people.filter(
    (person) => person.recordStatus === 'active' && person.inTalentLibrary !== false && person.profile
  ).length
  /** Added for this case only (e.g. via 「添加简历」): not searchable elsewhere until joined to the library. */
  const outsideLibrary = (person?: CandidateReviewSnapshot): person is CandidateReviewSnapshot =>
    Boolean(person && person.recordStatus !== 'deleted' && person.inTalentLibrary === false && !admittedPeople.has(person.documentId))
  const pendingLibrary = [
    ...new Map(
      tasks.flatMap((task) => {
        const person = personFor(task)
        return outsideLibrary(person) && person.profile ? [[person.documentId, person] as const] : []
      })
    ).values()
  ]
  const resumePicker = (label: string) => (
    <label className="case-resume-picker" title={fileHint(t)}>
      {label}
      <input
        type="file"
        multiple
        accept=".pdf,.docx,.xlsx,.xls,.xlsb"
        disabled={!active}
        onChange={(event) => {
          importFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />
    </label>
  )
  const title = job.fields.find((field) => field.key === 'title')?.value ?? job.redactedSubject
  const current = tasks.find((task) => task.id === selected[job.reviewId]) ?? tasks[0]
  const choose = (task: CaseResumeTask, pointer: boolean) => {
    if (task.id !== current?.id) recordExperienceOpened(task.assessment?.result.experienceRunId)
    setSelected((state) => ({ ...state, [job.reviewId]: task.id }))
    if (pointer) setShowDetail(true)
  }
  // A chip clicked in the list opens 匹配依据 at that requirement, where HR can decide it.
  const showRequirement = (label: string) => {
    setTab('evidence')
    focusRequirement(label)
  }
  const aiSettled = (task: CaseResumeTask) =>
    task.assessment?.result.qualification?.requirements.filter((item) => item.aiVerified).length ?? 0

  const header = (
    <>
      <MatchBackButton label={backLabel ?? t('返回案件列表', '案件一覧に戻る')} onClick={onBack} />
      <h2 className="match-page-title">{title}</h2>
      <Popover label={t('案件要求', '案件の要件')} trigger={t('要求', '要件')}>
        <dl className="match-popover-fields">
          {job.fields
            .filter((field) => field.value && field.key !== 'title')
            .map((field) => (
              <div key={field.key}>
                <dt>{localizedCaseFieldLabel(locale, field)}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
        </dl>
        <section className="match-popover-section" aria-label={t('指定已有人员', '既存の要員を指定')}>
          <h4>{t('指定已有人员', '既存の要員を指定')}</h4>
          <div className="match-inline-form">
            <select
              aria-label={t('选择已有人员评估', '既存の要員を評価')}
              value={addingPerson}
              disabled={!active}
              onChange={(event) => setAddingPerson(event.target.value)}
            >
              <option value="">{t('选择人员', '要員を選択')}</option>
              {people
                .filter((person) => person.inTalentLibrary !== false && person.recordStatus === 'active' && person.profile)
                .map((person) => (
                  <option key={person.documentId} value={person.documentId}>
                    {person.localIdentity?.displayName ?? person.fileName}
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={!active || !addingPerson}
              onClick={() => {
                const person = peopleById.get(addingPerson)
                if (person) {
                  const id = controller.addPerson(job, person)
                  setSelected((state) => ({ ...state, [job.reviewId]: id }))
                  setAddingPerson('')
                  if (scrollRoot.current) scrollRoot.current.scrollTop = 0
                }
              }}
            >
              {t('加入评估', '評価に追加')}
            </button>
          </div>
        </section>
        {active && job.jobCase ? (
          <details className="match-popover-section" onToggle={(event) => setRulesOpen(event.currentTarget.open)}>
            <summary>{t('此案件的 AI 工作规则', 'この案件のAI業務ルール')}</summary>
            {rulesOpen ? <AiWorkRulesPanel cases={[job]} jobCaseId={job.jobCase.id} /> : null}
          </details>
        ) : null}
      </Popover>
      <span className="match-page-spacer" />
      <button type="button" className="hr-primary" disabled={!active || search?.pending} onClick={() => void controller.search(job, true)}>
        {search?.pending ? t('正在找人…', '要員を検索中…') : hasResults ? t('重新找人', '要員を再検索') : t('找人', '要員を探す')}
      </button>
      {resumePicker(t('+ 添加简历', '+ 履歴書を追加'))}
    </>
  )
  const status = (
    <>
      {search?.pending ? (
        <span className="case-resume-progress" role="status">
          {search.localReady ? t('正在评估匹配度…', '適合度を評価中…') : t('正在找人…', '要員を検索中…')}{' '}
          <button type="button" onClick={() => void controller.cancelSearch(job)}>
            {t('停止', '停止')}
          </button>
        </span>
      ) : null}
      {searchedAt ? (
        <span>
          {t('上次找人', '前回の検索')}：{tokyoDateTime(searchedAt, zh)}
        </span>
      ) : null}
      {search?.result ? (
        <span className="case-people-coverage">
          {t('已检索', '検索済み')} {search.result.searchedCount ?? search.result.localMatchCount} · {t('交给 AI', 'AIへ')}{' '}
          {search.result.items.length}
          {search.result.semanticRecallCount
            ? t(`（语义补充 ${search.result.semanticRecallCount}）`, `（意味検索で追加 ${search.result.semanticRecallCount}）`)
            : ''}{' '}
          · {t('AI 已评估', 'AI評価済み')} {search.result.cloud.reviewedCount}
        </span>
      ) : null}
      {excluded.length ? (
        <span>
          {t('已排除', '除外')} {excluded.length}
        </span>
      ) : null}
      {staleTasks.length ? (
        <button type="button" disabled={search?.pending} onClick={reassessAll}>
          {t(`全部重新评估（${staleTasks.length}）`, `すべて再評価（${staleTasks.length}）`)}
        </button>
      ) : null}
      {newerPeople && active && !search?.pending ? (
        <span className="case-people-hint" role="status">
          {t(
            `上次找人后有 ${newerPeople} 位人员新增或更新了资料，结果中可能没有他们。`,
            `前回の検索後に ${newerPeople} 名の要員が追加・更新されました。結果に含まれていない可能性があります。`
          )}
        </span>
      ) : null}
      {pendingLibrary.length > 0 ? (
        <button
          type="button"
          title={t(
            '以下人员仅用于本案件，加入人员库后才能在人员页找到。',
            '以下の要員はこの案件専用です。要員リストに追加すると要員ページで探せます。'
          )}
          disabled={pendingLibrary.some((person) => savingPeople.has(person.documentId))}
          onClick={() => void Promise.all(pendingLibrary.map((person) => addToLibrary(person)))}
        >
          {t(`全部加入人员库（${pendingLibrary.length}）`, `すべて要員リストに追加（${pendingLibrary.length}）`)}
        </button>
      ) : null}
    </>
  )
  const notices = (
    <>
      {!active ? <p role="alert">{t('案件已结束，仍可查看历史评估。', '案件は終了しています。過去の評価を参照できます。')}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {rulesError ? (
        <p role="alert">
          {t('规则读取失败，暂时无法确认评估是否最新。', 'ルールを読み込めないため、評価が最新か確認できません。')}{' '}
          <button type="button" onClick={() => window.dispatchEvent(new Event(workRulesChangedEvent))}>
            {t('重试', '再試行')}
          </button>
        </p>
      ) : null}
      {search?.error ? (
        <p role="alert">
          {search.error}{' '}
          <button type="button" onClick={() => void controller.search(job, true)} disabled={search.pending}>
            {t('重试找人', '検索を再試行')}
          </button>
        </p>
      ) : null}
      {search?.result && !search.pending && ['failed', 'unavailable'].includes(search.result.cloud.status) ? (
        <p role="status">
          {t(
            '部分人员的匹配度评估未完成，已先列出按条件找到的人员，可重新找人。',
            '一部の要員の適合度評価が完了していません。条件で見つかった要員を表示しています。再検索できます。'
          )}
        </p>
      ) : null}
      {controller.historyErrors[job.reviewId] ? (
        <p role="alert">
          {t('历史评估读取失败', '過去の評価の読込に失敗')}{' '}
          <button type="button" onClick={() => void loadHistory(job)}>
            {t('重试', '再試行')}
          </button>
        </p>
      ) : null}
    </>
  )
  const list = (
    <>
      {controller.loadingHistory[job.reviewId] && !tasks.length ? (
        <p role="status" className="match-muted">
          {t('正在读取历史评估…', '過去の評価を読込中…')}
        </p>
      ) : null}
      {!tasks.length && !search?.pending && !controller.loadingHistory[job.reviewId] ? (
        // One empty state, whose reason matches what actually happened.
        <div className="hr-empty case-people-empty" role="status">
          {!libraryCount && !excluded.length ? (
            <>
              <p>
                {t(
                  '人员库里还没有可匹配的人员。先添加简历，或到人员页导入。',
                  '要員リストにマッチングできる要員がまだいません。履歴書を追加するか、要員ページで取り込んでください。'
                )}
              </p>
              <div className="case-people-tools">
                {resumePicker(t('添加简历', '履歴書を追加'))}
                {onOpenPersonImport ? (
                  <button type="button" onClick={onOpenPersonImport}>
                    {t('去人员页导入', '要員ページで取り込む')}
                  </button>
                ) : null}
              </div>
            </>
          ) : hasResults ? (
            <>
              <p>
                {t(
                  '没有找到相关人员：技能不相关，或都因日语、单价等明确条件不符。可以指定已有人员单独评估。',
                  '関連する要員が見つかりませんでした。スキルが関連しないか、日本語・単価などの明確な条件が合いません。既存の要員を指定して個別に評価できます。'
                )}
              </p>
              {search?.result?.excludedRequirements?.length ? (
                <p>
                  {t('未满足的要求', '満たされていない要件')}：{search.result.excludedRequirements.join('、')}
                </p>
              ) : null}
            </>
          ) : (
            <p>
              {t(
                '为这个案件添加人员：可以查找已有人员，也可以直接拖入简历。',
                'この案件に要員を追加：既存の要員を検索するか、履歴書をドロップしてください。'
              )}
            </p>
          )}
        </div>
      ) : null}
      {onSchedule && selectedTasks.length > 0 ? (
        <button type="button" className="match-batch" disabled={starting} onClick={() => void schedule(selectedTasks)}>
          {t(`为选中人员开始跟进（${selectedTasks.length}）`, `選択した要員の対応を開始（${selectedTasks.length}）`)}
        </button>
      ) : null}
      {tasks.length ? (
        <MatchResultList
          label={t('人员', '要員')}
          onMove={(id) => {
            const task = tasks.find((item) => item.id === id)
            if (task) choose(task, false)
          }}
        >
          {tasks.map((task, rank) => {
            const person = personFor(task),
              follow = existing(task),
              badge = badgeFor(task),
              settled = aiSettled(task)
            const stale = Boolean(task.assessment && staleFor(task.assessment, person))
            return (
              <MatchResultRow
                key={task.id}
                id={task.id}
                title={nameFor(task)}
                selected={task.id === current?.id}
                onSelect={() => choose(task, true)}
                onRequirement={showRequirement}
                experienceRun={task.assessment?.result.experienceRunId}
                rank={rank + 1}
                titleHint={
                  hiddenDuplicates.get(task.id)?.length
                    ? t('同一人员的另一条记录已合并显示', '同一要員の別記録をまとめて表示しています')
                    : undefined
                }
                badge={<ConclusionBadge tone={badge.tone}>{badge.label}</ConclusionBadge>}
                chips={
                  !stale && task.status === 'completed' ? <RequirementChips qualification={task.assessment?.result.qualification} /> : null
                }
                select={
                  onSchedule && !follow && canUse(task)
                    ? {
                        label: `${t('选择', '選択')} ${nameFor(task)}`,
                        checked: (checked[job.reviewId] ?? []).includes(task.id),
                        disabled: starting,
                        onChange: (value) =>
                          setChecked((state) => ({
                            ...state,
                            [job.reviewId]: value
                              ? [...(state[job.reviewId] ?? []), task.id]
                              : (state[job.reviewId] ?? []).filter((id) => id !== task.id)
                          }))
                      }
                    : null
                }
                tags={
                  follow || outsideLibrary(person) || settled || task.origin !== 'search' ? (
                    <>
                      {follow && progress ? (
                        <span className="match-tag is-follow">{progressPresentation(follow, progress.now, zh).label}</span>
                      ) : null}
                      {outsideLibrary(person) ? <span className="match-tag is-outside">{t('未入库', '未登録')}</span> : null}
                      {settled && !stale ? <span className="match-tag">{t(`AI 核实 ${settled}`, `AI確認 ${settled}`)}</span> : null}
                      {task.origin !== 'search' ? <span className="match-tag is-muted">{t('手动添加', '手動追加')}</span> : null}
                    </>
                  ) : null
                }
              />
            )
          })}
        </MatchResultList>
      ) : null}
      {tasks.length >= 100 ? (
        <small className="match-muted">{t('显示最近评估的 100 位人员。', '直近で評価した100名を表示しています。')}</small>
      ) : null}
      <ExcludedSection
        count={excluded.length}
        summary={
          <p className="match-muted">
            {[
              excludedCounts.requirements
                ? t(`${excludedCounts.requirements} 人因硬性条件被排除`, `${excludedCounts.requirements}名が必須条件により除外`)
                : '',
              excludedCounts.unavailable
                ? t(`${excludedCounts.unavailable} 人已进场或暂停营业`, `${excludedCounts.unavailable}名が参画中・営業停止中`)
                : '',
              excludedCounts.archived ? t(`${excludedCounts.archived} 人已归档`, `${excludedCounts.archived}名がアーカイブ済み`) : ''
            ]
              .filter(Boolean)
              .join(t('，', '、'))}
          </p>
        }
      >
        <ul>
          {excluded.map((item) => (
            <li key={item.task.id}>
              <strong>{nameFor(item.task)}</strong>
              <small>{excludedReason(item)}</small>
            </li>
          ))}
        </ul>
      </ExcludedSection>
    </>
  )
  const detail = (() => {
    const task = current
    if (!task)
      return <p className="match-detail-empty match-muted">{t('选择左侧人员查看匹配依据。', '左の要員を選ぶと根拠を表示します。')}</p>
    const assessment = task.assessment,
      person = personFor(task),
      busy = pendingResumeTask(task),
      blocked = blockedReason(task),
      follow = existing(task)
    const preliminary = assessment?.id.startsWith('preview:')
    const stale = Boolean(assessment && staleFor(assessment, person))
    const followLabel =
      follow && progress ? `${t('已有跟进', '対応記録あり')} · ${progressPresentation(follow, progress.now, zh).label}` : undefined
    // Reassessing keeps the current result and tab on screen, with the AI at work above it, until the new one arrives.
    if (assessment && !preliminary)
      return (
        <CasePersonDetail
          key={task.id}
          working={busy ? t('AI 正在重新评估，结果出来后会直接更新…', 'AIが再評価しています。結果が出るとそのまま更新されます…') : ''}
          name={nameFor(task)}
          value={assessment}
          jobCaseId={job.jobCase?.id ?? assessment.jobCaseId}
          reviewId={job.reviewId}
          person={person}
          stale={stale}
          status={badgeFor(task).tone === 'stale' ? badgeFor(task) : undefined}
          archived={person?.recordStatus === 'archived'}
          {...(task.notice ? { intakeNotice: task.notice } : {})}
          blocked={blocked}
          followLabel={followLabel}
          hasFollowUp={Boolean(follow)}
          starting={starting}
          tab={tab}
          onTab={setTab}
          onBackToList={() => setShowDetail(false)}
          reevaluationDisabled={!active}
          onRefresh={(value) => controller.completed(task.id, value)}
          onReassess={(request) => {
            if (active) controller.retry(task.id, job.jobCase?.id, request)
          }}
          onPrepare={onPrepare}
          onStart={() => (onSchedule ? void schedule([task]) : onFollowUp(assessment))}
          onContinue={onFollowUp}
          onOriginal={onOriginal}
          onPerson={onPerson}
          library={
            outsideLibrary(person)
              ? { saving: !person.profile || savingPeople.has(person.documentId), onAdd: () => void addToLibrary(person) }
              : null
          }
        />
      )
    const badge = badgeFor(task)
    return (
      <MatchDetail
        key={task.id}
        label={nameFor(task)}
        title={nameFor(task)}
        badge={<ConclusionBadge tone={badge.tone}>{busy ? `${badge.label}…` : badge.label}</ConclusionBadge>}
        onBackToList={() => setShowDetail(false)}
        tab={tab}
        onTab={(id) => setTab(id as MatchDetailTabId)}
        tabs={[]}
        actions={
          task.documentId ? (
            <button type="button" onClick={() => onOriginal(task.documentId!)}>
              {t('查看原简历', '元の履歴書を見る')}
            </button>
          ) : null
        }
        notice={
          <>
            {busy ? (
              <p className="case-resume-progress" role="status">
                {statusLabel(task.status)}…
              </p>
            ) : null}
            {task.notice ? <p role="status">{task.notice}</p> : null}
            {task.status === 'failed' ? (
              <div role="alert">
                <p>{task.error}</p>
                <button type="button" disabled={!active} onClick={() => controller.retry(task.id, job.jobCase?.id)}>
                  {task.documentId ? t('简历已导入，重试评估', '取込済み・評価を再試行') : t('重试导入', '取込を再試行')}
                </button>
              </div>
            ) : null}
            {preliminary && !busy ? (
              <p role="status">{t('匹配度还在评估中，请稍候或重新找人。', '適合度を評価中です。完了を待つか、再検索してください。')}</p>
            ) : null}
          </>
        }
      />
    )
  })()
  return (
    <MatchResultsPage
      label={t('案件找人', '案件の要員検索')}
      rootRef={exposureRoot}
      className="case-people-page"
      header={header}
      status={status}
      notices={notices}
      body={
        <MatchResultsBody
          list={list}
          detail={detail}
          showDetail={showDetail && Boolean(current)}
          listRef={scrollRoot}
          onListScroll={(top) => {
            scrolls.current[job.reviewId] = top
          }}
        />
      }
      overlay={
        dragging ? (
          <div className="match-drop-overlay" aria-hidden="true">
            <strong>{active ? t('松开即可添加简历', 'ドロップして履歴書を追加') : t('案件已结束', '案件は終了しています')}</strong>
            <small>{fileHint(t)}</small>
          </div>
        ) : null
      }
      dropHandlers={{
        onDragEnter: (event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          dragDepth.current++
          setDragging(true)
        },
        onDragLeave: () => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (!dragDepth.current) setDragging(false)
        },
        onDragOver: (event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault()
            event.stopPropagation()
            event.dataTransfer.dropEffect = active ? 'copy' : 'none'
          }
        },
        onDrop: (event) => {
          event.preventDefault()
          event.stopPropagation()
          dragDepth.current = 0
          setDragging(false)
          if (active) importFiles(Array.from(event.dataTransfer.files))
        }
      }}
    />
  )
}
