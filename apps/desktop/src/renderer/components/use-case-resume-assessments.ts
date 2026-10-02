import { useCallback, useEffect, useRef, useState } from 'react'
import {
  candidateIdentityKey,
  excludedByHr,
  sameCandidateRecord,
  type ApplicationLocale,
  type CandidateReviewSnapshot,
  type CasePersonAssessment,
  type CasePersonnelMatchResult,
  type CaseSearchSummary,
  type JobCaseReviewSnapshot
} from '@shared'
import { localeText, localizedIpcError, localizedMainText } from '../i18n'
import { onRequirementDecision } from '../requirement-decision-events'
import { notifyBusinessDataChanged } from '../business-data-events'

export interface CaseResumeTask {
  id: string
  reviewId: string
  jobCaseId: string | null
  reviewRevision: number
  name: string
  status: 'queued' | 'parsing' | 'assessing' | 'completed' | 'failed'
  documentId?: string
  person?: CandidateReviewSnapshot
  assessment?: CasePersonAssessment
  error?: string
  file?: File
  origin?: 'search' | 'specified'
  updatedAt?: number
  /** Operator request for the next assessment of this person; kept across a failed retry. */
  request?: string
  /** Said once the upload turned out to be someone already in the system (该人员已入库). */
  notice?: string
}
export interface CasePeopleSearch {
  pending: boolean
  localReady: boolean
  jobCaseId?: string
  result?: CasePersonnelMatchResult
  /** When the last search of this session finished, so an empty result still shows its time. */
  searchedAt?: string
  error?: string
}
export const pendingResumeTask = (task: CaseResumeTask) => ['queued', 'parsing', 'assessing'].includes(task.status)
const errorText = (locale: ApplicationLocale, error: unknown) =>
  localizedIpcError(
    locale,
    error,
    localeText(locale === 'zh-CN')('简历处理失败，请重试。', '履歴書を処理できませんでした。もう一度お試しください。')
  )

/** A searched person the panel does not list, kept so the operator can see who was left out and why. */
export interface ExcludedCaseTask {
  task: CaseResumeTask
  reason: 'requirements' | 'unavailable' | 'archived'
}
export interface CaseTaskVisibility {
  tasks: CaseResumeTask[]
  hiddenDuplicates: Map<string, CaseResumeTask[]>
  excluded: ExcludedCaseTask[]
  /** When the latest saved search result for this case was assessed, including history read from disk. */
  lastSearchedAt: string | null
}
// Same order as the main-process search: proposal status, then the model's fit, then the learned rank or score.
const statusOrder = { recommended: 0, 'needs-confirmation': 1, excluded: 2 } as const
const fitOrder: Record<string, number> = { strong: 0, possible: 1, 'insufficient-info': 3, weak: 4 }
const recency = (task: CaseResumeTask) => task.updatedAt ?? (Date.parse(task.assessment?.assessedAt ?? '') || 0)
/** Work in progress stays on top where a new import lands; failures and results without an assessment go last. */
export function compareCaseTasks(a: CaseResumeTask, b: CaseResumeTask): number {
  const bucket = (task: CaseResumeTask) => (pendingResumeTask(task) ? 0 : task.assessment ? 1 : 2)
  const group = (task: CaseResumeTask) => statusOrder[task.assessment?.result.qualification?.status ?? 'needs-confirmation']
  const fit = (task: CaseResumeTask) => (task.assessment?.result.assessment ? (fitOrder[task.assessment.result.assessment.fit] ?? 2) : 2)
  const ranks = [a, b].map((task) => task.assessment?.result.ranking?.rank)
  return (
    bucket(a) - bucket(b) ||
    group(a) - group(b) ||
    fit(a) - fit(b) ||
    (ranks[0] !== undefined && ranks[1] !== undefined ? ranks[0] - ranks[1] : 0) ||
    (b.assessment?.result.score ?? 0) - (a.assessment?.result.score ?? 0) ||
    recency(b) - recency(a)
  )
}
/** The one list the people panel shows and the case card counts: unavailable searched people are hidden, duplicate records collapse to one card, and the rest is ranked by fit. */
export function visibleCaseTasks(
  all: CaseResumeTask[],
  reviewId: string,
  people: CandidateReviewSnapshot[],
  unavailable: Set<string>,
  hasFollowUp?: (task: CaseResumeTask) => boolean
): CaseTaskVisibility {
  const peopleById = new Map(people.map((person) => [person.documentId, person]))
  const personFor = (task: CaseResumeTask) => peopleById.get(task.documentId ?? '') ?? task.person
  const own = all.filter((item) => item.reviewId === reviewId)
  const hiddenReason = (item: CaseResumeTask): ExcludedCaseTask['reason'] | 'deleted' | null => {
    const status = personFor(item)?.recordStatus
    // A deleted person leaves the case's list, however they came into it (找人, 手动添加 or a follow-up).
    if (status === 'deleted' || (!status && (item.origin === 'search' || item.documentId))) return 'deleted'
    if (item.origin !== 'search') return null
    // Someone in a follow-up for this case (in place here, say) stays listed with it, whatever else is true now.
    if (hasFollowUp?.(item)) return null
    if (status !== 'active') return 'archived'
    // HR's 不满足 keeps the person listed, marked and last.
    if (item.assessment?.result.qualification?.status === 'excluded' && !excludedByHr(item.assessment.result.qualification))
      return 'requirements'
    return unavailable.has(item.documentId ?? '') ? 'unavailable' : null
  }
  const shown = own.filter((item) => hiddenReason(item) === null)
  const rank = (task: CaseResumeTask) =>
    (hasFollowUp?.(task) ? 4 : 0) + (task.origin !== 'search' ? 2 : 0) + (task.status === 'completed' ? 1 : 0)
  const kept: CaseResumeTask[] = [],
    hiddenDuplicates = new Map<string, CaseResumeTask[]>()
  for (const task of shown) {
    const person = personFor(task),
      key = candidateIdentityKey(person)
    const twin = kept.find(
      (other) =>
        (task.documentId && other.documentId === task.documentId) ||
        (key !== '' && candidateIdentityKey(personFor(other)) === key && sameCandidateRecord(person, personFor(other)))
    )
    if (!twin) {
      kept.push(task)
      continue
    }
    const replace = rank(task) > rank(twin) || (rank(task) === rank(twin) && (task.updatedAt ?? 0) > (twin.updatedAt ?? 0))
    const winner = replace ? task : twin,
      loser = replace ? twin : task
    if (replace) kept[kept.indexOf(twin)] = task
    hiddenDuplicates.set(winner.id, [...(hiddenDuplicates.get(twin.id) ?? []), loser])
    if (replace) hiddenDuplicates.delete(twin.id)
  }
  const listed = new Set(kept.map((task) => task.documentId))
  const excluded: ExcludedCaseTask[] = []
  for (const task of own) {
    const reason = hiddenReason(task)
    if (!reason || reason === 'deleted' || listed.has(task.documentId)) continue
    listed.add(task.documentId)
    excluded.push({ task, reason })
  }
  const searchedAt = own
    .filter((task) => task.origin === 'search' && task.assessment?.assessedAt)
    .map((task) => task.assessment!.assessedAt)
    .sort()
    .at(-1)
  return { tasks: kept.toSorted(compareCaseTasks), hiddenDuplicates, excluded, lastSearchedAt: searchedAt ?? null }
}
/** Assessment and search times are read in the Tokyo business day, whatever the device time zone. */
export function tokyoDateTime(value: string, zh: boolean): string {
  return new Date(value).toLocaleString(zh ? 'zh-CN' : 'ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

/** App-owned tasks survive panel navigation. Files stay in memory only while needed. */
export function useCaseResumeAssessments(locale: ApplicationLocale = 'ja-JP') {
  const localeRef = useRef(locale)
  localeRef.current = locale
  const [tasks, setTasks] = useState<CaseResumeTask[]>([])
  const current = useRef(tasks)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const [historyErrors, setHistoryErrors] = useState<Record<string, string>>({})
  const [loadingHistory, setLoadingHistory] = useState<Record<string, boolean>>({})
  const histories = useRef(new Set<string>())
  const loadedHistories = useRef(new Set<string>())
  const [searches, setSearches] = useState<Record<string, CasePeopleSearch>>({})
  const searchesRef = useRef(searches)
  const activeSearches = useRef(new Map<string, { job: JobCaseReviewSnapshot; startedAt: number }>())
  const searchChange = useCallback((reviewId: string, values: Partial<CasePeopleSearch>) => {
    searchesRef.current = {
      ...searchesRef.current,
      [reviewId]: { ...(searchesRef.current[reviewId] ?? { pending: false, localReady: false }), ...values }
    }
    setSearches(searchesRef.current)
  }, [])
  const change = useCallback((update: (items: CaseResumeTask[]) => CaseResumeTask[]) => {
    current.current = update(current.current)
    setTasks(current.current)
  }, [])
  // An HR decision on an unclear requirement replaces the person's stored results here, without assessing again.
  useEffect(
    () =>
      onRequirementDecision(({ assessments }) => {
        if (!assessments.length) return
        change((items) =>
          items.map((item) => {
            const next = assessments.find(
              (assessment) =>
                assessment.documentId === item.documentId &&
                (assessment.jobCaseId === item.assessment?.jobCaseId || assessment.jobCaseId === item.jobCaseId)
            )
            return next && item.status === 'completed' ? { ...item, assessment: next } : item
          })
        )
      }),
    [change]
  )
  // Placed or paused personnel are hidden from search results; the panel and the case card read the same set.
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set())
  const refreshAvailability = useCallback(() => {
    Promise.resolve(window.sesAgent.getPersonnelWorkspace?.())
      .then((value) => {
        if (value)
          setUnavailable(
            new Set(value.states.filter((item) => !['available', 'soon'].includes(item.status)).map((item) => item.documentId))
          )
      })
      .catch(() => {
        /* Main validates eligibility again before business actions. */
      })
  }, [])
  useEffect(() => {
    refreshAvailability()
    window.addEventListener('ses-business-data-changed', refreshAvailability)
    return () => window.removeEventListener('ses-business-data-changed', refreshAvailability)
  }, [refreshAvailability])
  const visible = useCallback(
    (reviewId: string, people: CandidateReviewSnapshot[], hasFollowUp?: (task: CaseResumeTask) => boolean) =>
      visibleCaseTasks(tasks, reviewId, people, unavailable, hasFollowUp),
    [tasks, unavailable]
  )
  // Saved counts for the case list, read once so 「查看人员 (n)」 survives a restart before any panel is opened.
  const [savedSearches, setSavedSearches] = useState<Record<string, CaseSearchSummary>>({})
  useEffect(() => {
    let active = true
    Promise.resolve(window.sesAgent.listCaseSearchSummaries?.())
      .then((values) => {
        if (active && values?.length) setSavedSearches(Object.fromEntries(values.map((value) => [value.reviewId, value])))
      })
      .catch(() => {
        /* The count then appears once the case's panel loads its history. */
      })
    return () => {
      active = false
    }
  }, [])
  /** What each case card shows: the panel's own list once this session has data for the case, else the saved count. */
  const cardStates = useCallback(
    (people: CandidateReviewSnapshot[], hasFollowUp?: (task: CaseResumeTask) => boolean) => {
      const states: Record<string, { pending: number; count: number }> = {}
      for (const [reviewId, summary] of Object.entries(savedSearches)) states[reviewId] = { pending: 0, count: summary.listedCount }
      for (const reviewId of new Set(tasks.map((task) => task.reviewId))) {
        const shown = visibleCaseTasks(tasks, reviewId, people, unavailable, hasFollowUp).tasks
        states[reviewId] = { pending: shown.filter(pendingResumeTask).length, count: shown.length }
      }
      for (const [reviewId, search] of Object.entries(searches)) {
        const state = (states[reviewId] ??= { pending: 0, count: 0 })
        // A search of this session owns the count even when it found nobody.
        if (!tasks.some((task) => task.reviewId === reviewId) && (search.result || search.searchedAt)) state.count = 0
        if (search.pending) state.pending++
      }
      return states
    },
    [savedSearches, searches, tasks, unavailable]
  )
  const patch = useCallback(
    (id: string, values: Partial<CaseResumeTask>) => {
      change((items) => items.map((item) => (item.id === id ? { ...item, ...values } : item)))
    },
    [change]
  )
  const completed = useCallback(
    (id: string, assessment: CasePersonAssessment, person?: CandidateReviewSnapshot) => {
      change((items) => {
        const target = items.find((item) => item.id === id)
        if (!target) return items
        return items
          .filter(
            (item) =>
              item.id === id || item.reviewId !== target.reviewId || item.documentId !== assessment.documentId || pendingResumeTask(item)
          )
          .map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: 'completed',
                  assessment,
                  updatedAt: Date.now(),
                  documentId: assessment.documentId,
                  ...(person ? { person, name: person.localIdentity?.displayName ?? person.fileName } : {}),
                  error: undefined,
                  file: undefined
                }
              : item
          )
      })
    },
    [change]
  )
  useEffect(
    () =>
      window.sesAgent.onCaseResumeImportProgress?.((event) => {
        const task = current.current.find(
          (item) => item.id === event.requestId && item.jobCaseId === event.jobCaseId && pendingResumeTask(item)
        )
        if (task) patch(task.id, { status: event.stage, ...(event.documentId ? { documentId: event.documentId } : {}) })
      }),
    [patch]
  )

  const schedule = useCallback(
    (id: string) => {
      queue.current = queue.current.then(async () => {
        const task = current.current.find((item) => item.id === id)
        if (!task) return
        try {
          if (!task.documentId && task.file) {
            if (!/\.(pdf|docx|xlsx|xls|xlsb)$/iu.test(task.file.name))
              throw new Error(
                localeText(localeRef.current === 'zh-CN')(
                  '请选择 PDF、Word 或 Excel 简历。',
                  'PDF・Word・Excel の履歴書を選択してください。'
                )
              )
            if (!task.file.size || task.file.size > 30 * 1024 * 1024)
              throw new Error(localeText(localeRef.current === 'zh-CN')('文件为空或超过 30 MB。', 'ファイルが空か30 MBを超えています。'))
          }
          let jobCaseId = task.jobCaseId
          if (!jobCaseId) {
            const prepared = await window.sesAgent.prepareCaseAssessment({
              reviewId: task.reviewId,
              expectedReviewRevision: task.reviewRevision
            })
            jobCaseId = prepared.jobCase?.id ?? null
            if (!jobCaseId) throw new Error(localeText(localeRef.current === 'zh-CN')('案件暂不可评估。', 'この案件は評価できません。'))
            const preparedId = jobCaseId
            change((items) =>
              items.map((item) =>
                item.reviewId === task.reviewId && item.reviewRevision === task.reviewRevision && !item.jobCaseId
                  ? { ...item, jobCaseId: preparedId }
                  : item
              )
            )
            notifyBusinessDataChanged()
          }
          if (task.documentId) {
            patch(id, { status: 'assessing', error: undefined })
            completed(
              id,
              await window.sesAgent.assessCasePerson({
                jobCaseId,
                documentId: task.documentId,
                ...(task.request ? { request: task.request } : {})
              })
            )
          } else if (task.file) {
            patch(id, { status: 'parsing', error: undefined })
            const result = await window.sesAgent.importResumeForCase({
              requestId: id,
              jobCaseId,
              file: { name: task.file.name, bytes: new Uint8Array(await task.file.arrayBuffer()) }
            })
            const name = result.person.localIdentity?.displayName ?? result.person.fileName
            patch(id, {
              person: result.person,
              documentId: result.person.documentId,
              name,
              file: undefined,
              ...(result.alreadyImported
                ? {
                    notice: localeText(localeRef.current === 'zh-CN')(
                      `该人员已入库（${name}），已用已有资料评估，未重复导入。`,
                      `この要員は登録済みです（${name}）。既存の情報で評価し、重複して取り込んでいません。`
                    )
                  }
                : {})
            })
            notifyBusinessDataChanged()
            if (result.assessment) completed(id, result.assessment, result.person)
            else
              patch(id, {
                status: 'failed',
                error: result.error
                  ? localizedMainText(localeRef.current, result.error)
                  : localeText(localeRef.current === 'zh-CN')('评估未完成。', '評価が完了していません。')
              })
          }
        } catch (error) {
          patch(id, { status: 'failed', error: errorText(localeRef.current, error) })
        }
      })
    },
    [completed, patch, change]
  )
  const enqueue = useCallback(
    (job: JobCaseReviewSnapshot, files: File[]) => {
      if (job.lifecycle !== 'active')
        throw new Error(localeText(localeRef.current === 'zh-CN')('案件暂不可评估。', 'この案件は評価できません。'))
      if (!files.length || files.length > 10)
        throw new Error(localeText(localeRef.current === 'zh-CN')('每次请选择 1～10 份简历。', '履歴書は1〜10件選択してください。'))
      const added: CaseResumeTask[] = files.map((file) => ({
        id: crypto.randomUUID(),
        reviewId: job.reviewId,
        jobCaseId: job.jobCase?.id ?? null,
        reviewRevision: job.reviewRevision,
        name: file.name,
        file,
        status: 'queued'
      }))
      change((items) => [...added, ...items])
      added.forEach((task) => schedule(task.id))
      return added[0]!.id
    },
    [change, schedule]
  )
  /** `request` undefined keeps the task's current request (a failed retry); null clears it. */
  const retry = useCallback(
    (id: string, jobCaseId?: string, request?: string | null) => {
      const task = current.current.find((item) => item.id === id)
      if (!task || pendingResumeTask(task)) return
      patch(id, {
        status: 'queued',
        origin: 'specified',
        error: undefined,
        ...(jobCaseId ? { jobCaseId } : {}),
        ...(request !== undefined ? { request: request ?? undefined } : {})
      })
      schedule(id)
    },
    [patch, schedule]
  )
  const historyLoads = useRef(new Map<string, Promise<void>>())
  const loadHistory = useCallback(
    async (job: JobCaseReviewSnapshot): Promise<void> => {
      const jobCaseId = job.jobCase?.id
      if (!jobCaseId || loadedHistories.current.has(jobCaseId)) return
      // A second caller waits for the load already running instead of reading a half-filled list.
      const running = historyLoads.current.get(job.reviewId)
      if (running) return running
      let finish = () => undefined as void
      historyLoads.current.set(job.reviewId, new Promise<void>((resolve) => (finish = resolve)))
      histories.current.add(job.reviewId)
      setLoadingHistory((state) => ({ ...state, [job.reviewId]: true }))
      setHistoryErrors((state) => ({ ...state, [job.reviewId]: '' }))
      try {
        const history = await window.sesAgent.listCaseAssessments(jobCaseId)
        loadedHistories.current.add(jobCaseId)
        change((items) => [
          ...items,
          ...history
            // Excluded searched people are kept too: the panel lists who was left out and why.
            .filter(
              (assessment) =>
                (assessment.origin !== 'search' || !searchesRef.current[job.reviewId]) &&
                !items.some((item) => item.reviewId === job.reviewId && item.documentId === assessment.documentId)
            )
            .map((assessment) => ({
              id: assessment.id,
              reviewId: job.reviewId,
              jobCaseId,
              reviewRevision: job.reviewRevision,
              documentId: assessment.documentId,
              name: '',
              assessment,
              origin: assessment.origin ?? 'specified',
              status: 'completed' as const
            }))
        ])
      } catch (error) {
        setHistoryErrors((state) => ({ ...state, [job.reviewId]: errorText(localeRef.current, error) }))
      } finally {
        histories.current.delete(job.reviewId)
        historyLoads.current.delete(job.reviewId)
        finish()
        setLoadingHistory((state) => ({ ...state, [job.reviewId]: false }))
      }
    },
    [change]
  )
  const acceptSearch = useCallback(
    (job: JobCaseReviewSnapshot, result: CasePersonnelMatchResult, startedAt: number) => {
      change((items) => {
        const existing = items.filter((item) => item.reviewId === job.reviewId)
        // Excluded rows stay in the list of tasks; visibleCaseTasks keeps them out of the cards and names them separately.
        const added = result.items.map((row) => {
          const prior = existing.find((item) => item.documentId === row.documentId)
          // A specified evaluation started during this search owns its result.
          if (
            prior &&
            (pendingResumeTask(prior) || (prior.origin !== 'search' && (!row.assessmentId || (prior.updatedAt ?? 0) >= startedAt)))
          )
            return prior
          const origin = prior?.origin === 'specified' || (prior && !prior.origin) ? ('specified' as const) : ('search' as const)
          const assessment: CasePersonAssessment = {
            id: row.assessmentId ?? `preview:${row.documentId}`,
            jobCaseId: result.jobCaseId,
            documentId: row.documentId,
            jobCaseVersion: result.jobCaseVersion,
            profileVersion: row.profileVersion,
            assessedAt: result.assessedAt ?? new Date(startedAt).toISOString(),
            rulesRevision: result.rulesRevision ?? 0,
            appliedRules: row.appliedRules ?? [],
            result: row,
            cloud: result.cloud,
            origin
          }
          return {
            ...prior,
            id: prior?.id ?? crypto.randomUUID(),
            reviewId: job.reviewId,
            reviewRevision: job.reviewRevision,
            jobCaseId: result.jobCaseId,
            documentId: row.documentId,
            name: prior?.name ?? '',
            status: 'completed' as const,
            assessment,
            origin
          }
        })
        const ids = new Set(added.map((item) => item.documentId))
        return [
          ...items.filter((item) => item.reviewId !== job.reviewId || (item.origin !== 'search' && !ids.has(item.documentId))),
          ...added
        ]
      })
    },
    [change]
  )
  useEffect(
    () =>
      window.sesAgent.onBusinessMatchingProgress?.((event) => {
        if (event.kind !== 'case') return
        const active = activeSearches.current.get(event.id)
        if (!active) return
        searchChange(active.job.reviewId, { localReady: true, result: event.result })
        acceptSearch(active.job, event.result, active.startedAt)
      }),
    [acceptSearch, searchChange]
  )
  const searchLocks = useRef(new Set<string>())
  const search = useCallback(
    async (job: JobCaseReviewSnapshot, refresh = false) => {
      if (job.lifecycle !== 'active' || searchLocks.current.has(job.reviewId)) return
      searchLocks.current.add(job.reviewId)
      await loadHistory(job)
      if (!refresh && (searchesRef.current[job.reviewId] || current.current.some((item) => item.reviewId === job.reviewId))) {
        searchLocks.current.delete(job.reviewId)
        return
      }
      searchChange(job.reviewId, { pending: true, localReady: false, error: undefined })
      const startedAt = Date.now()
      let id = job.jobCase?.id
      try {
        if (!id) {
          const prepared = await window.sesAgent.prepareCaseAssessment({
            reviewId: job.reviewId,
            expectedReviewRevision: job.reviewRevision
          })
          id = prepared.jobCase?.id
          if (!id) throw new Error(localeText(localeRef.current === 'zh-CN')('案件暂不可评估。', 'この案件は評価できません。'))
          notifyBusinessDataChanged()
        }
        if (activeSearches.current.has(id)) return
        activeSearches.current.set(id, { job, startedAt })
        searchChange(job.reviewId, { jobCaseId: id })
        const result = await window.sesAgent.findPersonnelForCase(id)
        if (result.jobCaseId !== id)
          throw new Error(localeText(localeRef.current === 'zh-CN')('案件资料已更新。', '案件情報が更新されました。'))
        acceptSearch(job, result, startedAt)
        searchChange(job.reviewId, { result, searchedAt: result.assessedAt ?? new Date(startedAt).toISOString() })
      } catch (error) {
        searchChange(job.reviewId, { error: errorText(localeRef.current, error) })
      } finally {
        searchLocks.current.delete(job.reviewId)
        if (id) activeSearches.current.delete(id)
        searchChange(job.reviewId, { pending: false })
      }
    },
    [loadHistory, searchChange, acceptSearch]
  )
  const cancelSearch = useCallback(
    async (job: JobCaseReviewSnapshot) => {
      const id = searchesRef.current[job.reviewId]?.jobCaseId
      if (!id) return
      try {
        await window.sesAgent.cancelBusinessMatching({ kind: 'case', id })
      } catch (error) {
        searchChange(job.reviewId, { error: errorText(localeRef.current, error) })
      }
    },
    [searchChange]
  )
  const addPerson = useCallback(
    (job: JobCaseReviewSnapshot, person: CandidateReviewSnapshot) => {
      const prior = current.current.find((item) => item.reviewId === job.reviewId && item.documentId === person.documentId)
      if (prior && pendingResumeTask(prior)) return prior.id
      const id = prior?.id ?? crypto.randomUUID()
      const task: CaseResumeTask = {
        ...prior,
        id,
        reviewId: job.reviewId,
        reviewRevision: job.reviewRevision,
        jobCaseId: job.jobCase?.id ?? null,
        documentId: person.documentId,
        person,
        name: person.localIdentity?.displayName ?? person.fileName,
        status: 'queued',
        origin: 'specified',
        error: undefined
      }
      change((items) => [task, ...items.filter((item) => item.id !== id)])
      schedule(id)
      return id
    },
    [change, schedule]
  )
  /**
   * Shows one person's assessment for a case: the saved result while neither the case nor the profile changed since,
   * a running one as is, and a new assessment only when there is none or it is out of date.
   */
  const openPerson = useCallback(
    async (job: JobCaseReviewSnapshot, person: CandidateReviewSnapshot) => {
      await loadHistory(job).catch(() => undefined)
      const prior = current.current.find((item) => item.reviewId === job.reviewId && item.documentId === person.documentId)
      if (prior && pendingResumeTask(prior)) return prior.id
      const assessment = prior?.status === 'completed' ? prior.assessment : undefined
      if (
        prior &&
        assessment &&
        assessment.jobCaseVersion === job.jobCase?.version &&
        (person.profile?.version === undefined || assessment.profileVersion === person.profile.version)
      )
        return prior.id
      return addPerson(job, person)
    },
    [loadHistory, addPerson]
  )
  return {
    tasks,
    visible,
    cardStates,
    unavailable,
    refreshAvailability,
    enqueue,
    retry,
    completed,
    loadHistory,
    historyErrors,
    loadingHistory,
    searches,
    search,
    cancelSearch,
    addPerson,
    openPerson
  }
}
export type CaseResumeController = ReturnType<typeof useCaseResumeAssessments>
