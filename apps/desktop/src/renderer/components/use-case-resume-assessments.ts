import { useCallback, useEffect, useRef, useState } from 'react'
import type { CandidateReviewSnapshot, CasePersonAssessment, CasePersonnelMatchResult, JobCaseReviewSnapshot } from '@shared'

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
}
export interface CasePeopleSearch { pending: boolean; localReady: boolean; jobCaseId?: string; result?: CasePersonnelMatchResult; error?: string }
export const pendingResumeTask = (task: CaseResumeTask) => ['queued', 'parsing', 'assessing'].includes(task.status)
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

/** App-owned tasks survive panel navigation. Files stay in memory only while needed. */
export function useCaseResumeAssessments() {
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
    searchesRef.current = { ...searchesRef.current, [reviewId]: { ...(searchesRef.current[reviewId] ?? { pending: false, localReady: false }), ...values } }
    setSearches(searchesRef.current)
  }, [])
  const change = useCallback((update: (items: CaseResumeTask[]) => CaseResumeTask[]) => {
    current.current = update(current.current)
    setTasks(current.current)
  }, [])
  const patch = useCallback((id: string, values: Partial<CaseResumeTask>) => {
    change(items => items.map(item => item.id === id ? { ...item, ...values } : item))
  }, [change])
  const completed = useCallback((id: string, assessment: CasePersonAssessment, person?: CandidateReviewSnapshot) => {
    change(items => {
      const target = items.find(item => item.id === id)
      if (!target) return items
      return items.filter(item => item.id === id || item.reviewId !== target.reviewId || item.documentId !== assessment.documentId || pendingResumeTask(item))
      .map(item => item.id === id ? { ...item, status: 'completed', assessment, updatedAt: Date.now(), documentId: assessment.documentId,
        ...(person ? { person, name: person.localIdentity?.displayName ?? person.fileName } : {}), error: undefined, file: undefined } : item)
    })
  }, [change])
  useEffect(() => window.sesAgent.onCaseResumeImportProgress?.(event => {
    const task = current.current.find(item => item.id === event.requestId && item.jobCaseId === event.jobCaseId && pendingResumeTask(item))
    if (task) patch(task.id, { status: event.stage, ...(event.documentId ? { documentId: event.documentId } : {}) })
  }), [patch])

  const schedule = useCallback((id: string) => {
    queue.current = queue.current.then(async () => {
      const task = current.current.find(item => item.id === id)
      if (!task) return
      try {
        if (!task.documentId && task.file) {
          if (!/\.(pdf|docx|xlsx|xls|xlsb)$/iu.test(task.file.name)) throw new Error('请选择 PDF、Word 或 Excel 简历。 / PDF・Word・Excel の履歴書を選択してください。')
          if (!task.file.size || task.file.size > 30 * 1024 * 1024) throw new Error('文件为空或超过 30 MB。 / ファイルが空か30 MBを超えています。')
        }
        let jobCaseId = task.jobCaseId
        if (!jobCaseId) {
          const prepared = await window.sesAgent.prepareCaseAssessment({ reviewId: task.reviewId, expectedReviewRevision: task.reviewRevision })
          jobCaseId = prepared.jobCase?.id ?? null
          if (!jobCaseId) throw new Error('案件暂不可评估。 / この案件は評価できません。')
          const preparedId = jobCaseId
          change(items => items.map(item => item.reviewId === task.reviewId && item.reviewRevision === task.reviewRevision && !item.jobCaseId ? { ...item, jobCaseId: preparedId } : item))
          window.dispatchEvent(new Event('ses-business-data-changed'))
        }
        if (task.documentId) {
          patch(id, { status: 'assessing', error: undefined })
          completed(id, await window.sesAgent.assessCasePerson({ jobCaseId, documentId: task.documentId }))
        } else if (task.file) {
          patch(id, { status: 'parsing', error: undefined })
          const result = await window.sesAgent.importResumeForCase({ requestId: id, jobCaseId,
            file: { name: task.file.name, bytes: new Uint8Array(await task.file.arrayBuffer()) } })
          patch(id, { person: result.person, documentId: result.person.documentId, name: result.person.localIdentity?.displayName ?? result.person.fileName, file: undefined })
          window.dispatchEvent(new Event('ses-business-data-changed'))
          if (result.assessment) completed(id, result.assessment, result.person)
          else patch(id, { status: 'failed', error: result.error ?? '评估未完成。 / 評価が完了していません。' })
        }
      } catch (error) { patch(id, { status: 'failed', error: errorText(error) }) }
    })
  }, [completed, patch, change])
  const enqueue = useCallback((job: JobCaseReviewSnapshot, files: File[]) => {
    if (job.lifecycle !== 'active') throw new Error('案件暂不可评估。 / この案件は評価できません。')
    if (!files.length || files.length > 10) throw new Error('每次请选择 1～10 份简历。 / 履歴書は1〜10件選択してください。')
    const added: CaseResumeTask[] = files.map(file => ({ id: crypto.randomUUID(), reviewId: job.reviewId, jobCaseId: job.jobCase?.id ?? null, reviewRevision: job.reviewRevision, name: file.name, file, status: 'queued' }))
    change(items => [...added, ...items])
    added.forEach(task => schedule(task.id))
    return added[0]!.id
  }, [change, schedule])
  const retry = useCallback((id: string, jobCaseId?: string) => {
    const task = current.current.find(item => item.id === id)
    if (!task || pendingResumeTask(task)) return
    patch(id, { status: 'queued', origin: 'specified', error: undefined, ...(jobCaseId ? { jobCaseId } : {}) })
    schedule(id)
  }, [patch, schedule])
  const loadHistory = useCallback(async (job: JobCaseReviewSnapshot) => {
    const jobCaseId = job.jobCase?.id
    if (!jobCaseId || histories.current.has(job.reviewId) || loadedHistories.current.has(jobCaseId)) return
    histories.current.add(job.reviewId)
    setLoadingHistory(state => ({ ...state, [job.reviewId]: true }))
    setHistoryErrors(state => ({ ...state, [job.reviewId]: '' }))
    try {
      const history = await window.sesAgent.listCaseAssessments(jobCaseId)
      loadedHistories.current.add(jobCaseId)
      change(items => [...items, ...history.filter(assessment => (assessment.origin !== 'search' || assessment.result.qualification?.status !== 'excluded' && !searchesRef.current[job.reviewId]) && !items.some(item => item.reviewId === job.reviewId && item.documentId === assessment.documentId))
        .map(assessment => ({ id: assessment.id, reviewId: job.reviewId, jobCaseId, reviewRevision: job.reviewRevision, documentId: assessment.documentId,
          name: '', assessment, origin: assessment.origin ?? 'specified', status: 'completed' as const }))])
    } catch (error) { setHistoryErrors(state => ({ ...state, [job.reviewId]: errorText(error) })) }
    finally { histories.current.delete(job.reviewId); setLoadingHistory(state => ({ ...state, [job.reviewId]: false })) }
  }, [change])
  const acceptSearch = useCallback((job: JobCaseReviewSnapshot, result: CasePersonnelMatchResult, startedAt: number) => {
    change(items => {
      const existing = items.filter(item => item.reviewId === job.reviewId)
      const added = result.items.filter(row => row.qualification?.status !== 'excluded' || existing.some(item => item.documentId === row.documentId && item.origin !== 'search'))
        .map(row => {
          const prior = existing.find(item => item.documentId === row.documentId)
          // A specified evaluation started during this search owns its result.
          if (prior && (pendingResumeTask(prior) || prior.origin !== 'search' && (!row.assessmentId || (prior.updatedAt ?? 0) >= startedAt))) return prior
          const origin = prior?.origin === 'specified' || prior && !prior.origin ? 'specified' as const : 'search' as const
          const assessment: CasePersonAssessment = { id: row.assessmentId ?? `preview:${row.documentId}`, jobCaseId: result.jobCaseId,
            documentId: row.documentId, jobCaseVersion: result.jobCaseVersion, profileVersion: row.profileVersion,
            assessedAt: result.assessedAt ?? new Date(startedAt).toISOString(), rulesRevision: result.rulesRevision ?? 0,
            appliedRules: row.appliedRules ?? [], result: row, cloud: result.cloud, origin }
          return { ...prior, id: prior?.id ?? crypto.randomUUID(), reviewId: job.reviewId, reviewRevision: job.reviewRevision,
            jobCaseId: result.jobCaseId, documentId: row.documentId, name: prior?.name ?? '', status: 'completed' as const, assessment, origin }
        })
      const ids = new Set(added.map(item => item.documentId))
      return [...items.filter(item => item.reviewId !== job.reviewId || item.origin !== 'search' && !ids.has(item.documentId)), ...added]
    })
  }, [change])
  useEffect(() => window.sesAgent.onBusinessMatchingProgress?.(event => {
    if (event.kind !== 'case') return
    const active = activeSearches.current.get(event.id)
    if (!active) return
    searchChange(active.job.reviewId, { localReady: true, result: event.result })
    acceptSearch(active.job, event.result, active.startedAt)
  }), [acceptSearch, searchChange])
  const searchLocks = useRef(new Set<string>())
  const search = useCallback(async (job: JobCaseReviewSnapshot, refresh = false) => {
    if (job.lifecycle !== 'active' || searchLocks.current.has(job.reviewId)) return
    searchLocks.current.add(job.reviewId)
    await loadHistory(job)
    if (!refresh && (searchesRef.current[job.reviewId] || current.current.some(item => item.reviewId === job.reviewId))) { searchLocks.current.delete(job.reviewId); return }
    searchChange(job.reviewId, { pending: true, localReady: false, error: undefined })
    const startedAt = Date.now()
    let id = job.jobCase?.id
    try {
      if (!id) {
        const prepared = await window.sesAgent.prepareCaseAssessment({ reviewId: job.reviewId, expectedReviewRevision: job.reviewRevision })
        id = prepared.jobCase?.id
        if (!id) throw new Error('案件暂不可评估。 / この案件は評価できません。')
        window.dispatchEvent(new Event('ses-business-data-changed'))
      }
      if (activeSearches.current.has(id)) return
      activeSearches.current.set(id, { job, startedAt })
      searchChange(job.reviewId, { jobCaseId: id })
      const result = await window.sesAgent.findPersonnelForCase(id)
      if (result.jobCaseId !== id) throw new Error('案件资料已更新。 / 案件情報が更新されました。')
      acceptSearch(job, result, startedAt)
      searchChange(job.reviewId, { result })
    } catch (error) { searchChange(job.reviewId, { error: errorText(error) }) }
    finally { searchLocks.current.delete(job.reviewId); if (id) activeSearches.current.delete(id); searchChange(job.reviewId, { pending: false }) }
  }, [loadHistory, searchChange, acceptSearch])
  const cancelSearch = useCallback(async (job: JobCaseReviewSnapshot) => {
    const id = searchesRef.current[job.reviewId]?.jobCaseId
    if (!id) return
    try { await window.sesAgent.cancelBusinessMatching({ kind: 'case', id }) }
    catch (error) { searchChange(job.reviewId, { error: errorText(error) }) }
  }, [searchChange])
  const addPerson = useCallback((job: JobCaseReviewSnapshot, person: CandidateReviewSnapshot) => {
    const prior = current.current.find(item => item.reviewId === job.reviewId && item.documentId === person.documentId)
    if (prior && pendingResumeTask(prior)) return prior.id
    const id = prior?.id ?? crypto.randomUUID()
    const task: CaseResumeTask = { ...prior, id, reviewId: job.reviewId, reviewRevision: job.reviewRevision,
      jobCaseId: job.jobCase?.id ?? null, documentId: person.documentId, person, name: person.localIdentity?.displayName ?? person.fileName,
      status: 'queued', origin: 'specified', error: undefined }
    change(items => [task, ...items.filter(item => item.id !== id)])
    schedule(id)
    return id
  }, [change, schedule])
  return { tasks, enqueue, retry, completed, loadHistory, historyErrors, loadingHistory, searches, search, cancelSearch, addPerson }
}
export type CaseResumeController = ReturnType<typeof useCaseResumeAssessments>
