import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { businessProgressStep, type BusinessFollowUp } from '@shared'

export const progressPairKey = (row: { documentId: string; reviewId: string }) => `${row.documentId}:${row.reviewId}`
export function progressIndexes(rows: BusinessFollowUp[]) {
  const person = new Map<string, BusinessFollowUp[]>(), cases = new Map<string, BusinessFollowUp[]>(), pairs = new Map<string, BusinessFollowUp>()
  for (const row of rows) {
    if (!person.has(row.documentId)) person.set(row.documentId, [])
    if (!cases.has(row.reviewId)) cases.set(row.reviewId, [])
    person.get(row.documentId)!.push(row)
    cases.get(row.reviewId)!.push(row)
    pairs.set(progressPairKey(row), row)
  }
  return { person, case: cases, pairs }
}
export const isActiveProgress = (row: BusinessFollowUp) => !['started', 'closed', 'paused'].includes(row.progress?.stage ?? (row.status === 'closed' ? 'closed' : 'coordinating'))
export function nextProgressAppointment(rows: BusinessFollowUp[], now: Date) {
  return rows.filter((row) => {
    const state = businessProgressStep(row, now)
    return ['scheduled', 'entry'].includes(state.stage) && state.when && Date.parse(state.when.length === 10 ? `${state.when}T00:00:00+09:00` : state.when) >= now.getTime() - 86400000
  }).sort((a, b) => businessProgressStep(a, now).when!.localeCompare(businessProgressStep(b, now).when!))[0]
}
export function progressPresentation(row: BusinessFollowUp, now: Date, zh: boolean) {
  const value = businessProgressStep(row, now, zh)
  if (!row.progress && row.status !== 'closed') return { ...value, label: row.status === 'contacted' ? (zh ? '已联系' : '連絡済み') : row.status === 'replied' ? (zh ? '已回复' : '返信あり') : (zh ? '待约面' : '日程調整中') }
  if (value.stage === 'feedback') return { ...value, label: zh ? `${row.progress?.rounds.at(-1)?.roundNumber ?? 1} 面待反馈` : `${row.progress?.rounds.at(-1)?.roundNumber ?? 1} 次面談の結果待ち` }
  if (value.stage === 'closed') {
    const decision = row.progress?.rounds.at(-1)?.decision
    if (decision === 'failed') return { ...value, label: zh ? '未通过' : '不通過' }
    if (decision === 'no-show') return { ...value, label: zh ? '未出席' : '欠席' }
    if (decision === 'withdrawn') return { ...value, label: zh ? '人员撤回' : '辞退' }
  }
  return value
}
export function progressSummary(rows: BusinessFollowUp[], kind: 'person' | 'case', now: Date, zh: boolean) {
  const active = rows.filter(isActiveProgress), started = rows.filter((row) => row.progress?.stage === 'started')
  if (!rows.length) return zh ? (kind === 'person' ? '暂无跟进案件' : '暂无跟进人员') : (kind === 'person' ? '対応中の案件はありません' : '対応中の要員はいません')
  const counts = new Map<string, number>()
  for (const row of active) {
    const state = progressPresentation(row, now, zh)
    const label = state.stage === 'feedback' ? (zh ? '待反馈' : '結果待ち') : state.stage === 'scheduled' ? (zh ? '已预约' : '予約済み') : state.stage === 'next-round' ? (zh ? '待安排下一轮' : '次回調整待ち') : state.label
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [active.length ? (zh ? `推进中 ${active.length} ${kind === 'person' ? '个案件' : '人'}` : `進行中 ${active.length} ${kind === 'person' ? '案件' : '名'}`) : '',
    ...[...counts].map(([label, count]) => `${label} ${count}`), started.length ? (zh ? `已进场 ${started.length} ${kind === 'person' ? '个案件' : '人'}` : `参画済み ${started.length} ${kind === 'person' ? '案件' : '名'}`) : '',
    !active.length && !started.length ? (zh ? `历史跟进 ${rows.length}` : `過去の対応 ${rows.length}`) : ''].filter(Boolean).join(' · ')
}

export function useBusinessProgressData(reloadToken: unknown) {
  const [rows, setRows] = useState<BusinessFollowUp[]>([]), [loading, setLoading] = useState(true), [failed, setFailed] = useState(false)
  const [now, setNow] = useState(() => new Date()), epoch = useRef(0), alive = useRef(true)
  const refresh = useCallback(async () => {
    const request = ++epoch.current
    try {
      const next = await window.sesAgent.listBusinessFollowUps()
      if (alive.current && request === epoch.current) { setRows(next); setFailed(false) }
    } catch { if (alive.current && request === epoch.current) setFailed(true) }
    finally { if (alive.current && request === epoch.current) setLoading(false) }
  }, [])
  const publish = useCallback((saved: BusinessFollowUp[]) => {
    epoch.current++
    setRows((current) => [...saved, ...current.filter((row) => !saved.some((item) => item.id === row.id))])
    setLoading(false); setFailed(false)
  }, [])
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++ } }, [])
  useEffect(() => { if (reloadToken) void refresh() }, [reloadToken, refresh])
  useEffect(() => {
    const focus = () => { if (reloadToken) void refresh() }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [reloadToken, refresh])
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(timer) }, [])
  const indexes = useMemo(() => progressIndexes(rows), [rows])
  return useMemo(() => ({ rows, indexes, loading, failed, now, refresh, publish }), [rows, indexes, loading, failed, now, refresh, publish])
}
export const BusinessProgressContext = createContext<ReturnType<typeof useBusinessProgressData> | null>(null)
export const useBusinessProgress = () => useContext(BusinessProgressContext)
