import { useMemo, useState, type FormEvent } from 'react'
import type {
  BusinessPriorityLevel,
  MatchingHomeProjection,
  MatchingHomeResult,
  SetBusinessPriorityOverrideInput
} from '@shared'
import { Icon } from './Icon'

interface MatchingHomeDashboardProps {
  projection: MatchingHomeProjection
  onOpenMatching(jobCaseId: string): void
  onOverridePriority(input: SetBusinessPriorityOverrideInput): Promise<void>
}

const priorityLabels: Record<BusinessPriorityLevel, string> = {
  high: '優先対応',
  normal: '通常',
  follow_up: '追客確認',
  paused: '保留'
}

const priorityOrder: Record<BusinessPriorityLevel, number> = {
  high: 0,
  follow_up: 1,
  normal: 2,
  paused: 3
}

const validityLabels: Record<Exclude<MatchingHomeProjection['jobCases'][number]['validity'], 'current'>, string> = {
  not_run: '未実行',
  stale_job_case: '案件更新あり',
  stale_candidate_pool: '人材プール更新あり',
  stale_model: 'Local AI 更新あり',
  stale_policy: '判定ルール更新あり',
  invalidated: '再実行が必要'
}

function tomorrowAtEndOfDay(): string {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(23, 59, 0, 0)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function PriorityOverrideForm({
  result,
  onSubmit
}: {
  result: MatchingHomeResult
  onSubmit(input: SetBusinessPriorityOverrideInput): Promise<void>
}) {
  const [level, setLevel] = useState<BusinessPriorityLevel>(result.businessPriority.effectiveLevel)
  const [reason, setReason] = useState('')
  const [expiresAt, setExpiresAt] = useState(tomorrowAtEndOfDay)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (reason.trim().length < 3 || !expiresAt || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        matchResultId: result.matchResultId,
        level,
        reason: reason.trim(),
        expiresAt: new Date(expiresAt).toISOString()
      })
      setReason('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '営業優先度を更新できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="business-priority-override" onSubmit={submit}>
      <label><span>一時優先度</span><select onChange={(event) => setLevel(event.target.value as BusinessPriorityLevel)} value={level}>
        {(Object.keys(priorityLabels) as BusinessPriorityLevel[]).map((value) => (
          <option key={value} value={value}>{priorityLabels[value]}</option>
        ))}
      </select></label>
      <label><span>理由</span><input maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="例：本日中に営業確認" value={reason} /></label>
      <label><span>有効期限</span><input onChange={(event) => setExpiresAt(event.target.value)} type="datetime-local" value={expiresAt} /></label>
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={busy || reason.trim().length < 3 || !expiresAt} type="submit">{busy ? '保存中…' : '理由付きで上書き'}</button>
    </form>
  )
}

export function MatchingHomeDashboard({
  projection,
  onOpenMatching,
  onOverridePriority
}: MatchingHomeDashboardProps) {
  const [order, setOrder] = useState<'fit' | 'business'>('fit')
  const run = projection.currentRun
  const selectedCase = projection.jobCases.find((jobCase) => jobCase.id === projection.selectedJobCaseId)
    ?? projection.jobCases[0]
    ?? null
  const results = useMemo(() => {
    const source = run?.results ?? []
    return order === 'fit'
      ? source.toSorted((left, right) => left.fit.rank - right.fit.rank)
      : source.toSorted((left, right) =>
          priorityOrder[left.businessPriority.effectiveLevel] - priorityOrder[right.businessPriority.effectiveLevel] ||
          left.fit.rank - right.fit.rank ||
          left.candidateProfileId.localeCompare(right.candidateProfileId)
        )
  }, [order, run?.results])

  if (!selectedCase) return null

  return (
    <section className="matching-home-dashboard" aria-labelledby="matching-home-title">
      <header>
        <div>
          <span className="eyebrow">CURRENT MATCH REVIEW</span>
          <h2 id="matching-home-title">案件から候補者確認を開始</h2>
          <p>Fit は一致根拠だけ、営業優先度は提案・追客状況だけで判定します。AI は採否を決定しません。</p>
        </div>
        <button onClick={() => onOpenMatching(selectedCase.id)} type="button">
          <Icon name="sparkles" size={16} />{run ? '現在の案件で再マッチング' : 'この案件でマッチング'}
        </button>
      </header>

      <div className="matching-home-case-strip" aria-label="案件ごとのMatch Run状態">
        {projection.jobCases.map((jobCase) => (
          <button key={`${jobCase.id}-${jobCase.version}`} onClick={() => onOpenMatching(jobCase.id)} type="button">
            <span className={jobCase.validity === 'current' ? 'is-current' : ''} />
            <strong>{jobCase.title}</strong>
            <small>{jobCase.validity === 'current' ? 'Current Run' : validityLabels[jobCase.validity]}</small>
          </button>
        ))}
      </div>

      {!run ? (
        <div className="matching-home-ready">
          <Icon name="alert" size={19} />
          <div><strong>現在有効な Match Run はありません</strong><p>案件・人材プール・Local AI・判定ルールの現在版に結び付けて再実行してください。過去の順位は表示していません。</p></div>
          <button onClick={() => onOpenMatching(selectedCase.id)} type="button">案件を確認して実行</button>
        </div>
      ) : (
        <>
          <div className="matching-home-toolbar">
            <div><strong>{run.results.length}</strong><span>確認対象 · {projection.eligibleCandidateCount}名の確認済み人材から検索</span></div>
            <div role="group" aria-label="候補者の表示順">
              <button className={order === 'fit' ? 'is-active' : ''} onClick={() => setOrder('fit')} type="button">Fit 順</button>
              <button className={order === 'business' ? 'is-active' : ''} onClick={() => setOrder('business')} type="button">営業優先度順</button>
            </div>
          </div>
          <div className="matching-home-results">
            {results.map((result) => (
              <article key={result.matchResultId}>
                <header>
                  <span className="matching-rank">#{result.fit.rank}</span>
                  <div><strong>{result.anonymousLabel}</strong><small>候補者 v{result.candidateProfileVersion}</small></div>
                  <span className={`business-priority-chip ${result.businessPriority.effectiveLevel}`}>
                    {priorityLabels[result.businessPriority.effectiveLevel]}
                  </span>
                </header>
                <div className="matching-home-result-metrics">
                  <span><strong>{result.fit.matchScore ?? '—'}</strong><small>Fit 参考値</small></span>
                  <span><strong>{result.fit.termCoverage ?? '—'}{result.fit.termCoverage === null ? '' : '%'}</strong><small>条件カバー</small></span>
                  <span><strong>{result.fit.hardFilterUnknownCount}</strong><small>不明な硬条件</small></span>
                </div>
                <div className="matching-home-evidence">
                  <strong>一致根拠</strong>
                  <p>{result.fit.matchedTerms.length > 0 ? result.fit.matchedTerms.join(' · ') : '一致語は構造化条件と検索証跡で確認してください。'}</p>
                  {result.fit.evidence.slice(0, 3).map((evidence) => (
                    <span key={`${evidence.key}-${evidence.sourceLabels.join('-')}`}>{evidence.label}：{evidence.value ?? '不明'} <small>{evidence.sourceLabels.join(' / ')}</small></span>
                  ))}
                  {result.fit.projectEvidence ? <span>案件経験：{result.fit.projectEvidence.title} <small>{result.fit.projectEvidence.sourceLabels.join(' / ')}</small></span> : null}
                </div>
                <div className="matching-home-priority-reason">
                  <strong>営業優先度の根拠</strong>
                  <p>{result.businessPriority.reasons.join(' · ')}</p>
                  <small>{result.businessPriority.ruleVersion} · {result.businessPriority.inputSnapshotHash.slice(0, 10)}</small>
                  {result.businessPriority.manualOverride ? (
                    <span>手動上書き：{result.businessPriority.manualOverride.actor} · {result.businessPriority.manualOverride.reason} · {new Date(result.businessPriority.manualOverride.expiresAt).toLocaleString('ja-JP')}まで</span>
                  ) : null}
                </div>
                <details>
                  <summary>営業優先度を一時上書き</summary>
                  <PriorityOverrideForm result={result} onSubmit={onOverridePriority} />
                </details>
              </article>
            ))}
            {results.length === 0 ? <div className="matching-home-no-results">現在の条件で比較対象はありません。硬条件と不明項目を確認してから再実行してください。</div> : null}
          </div>
        </>
      )}
    </section>
  )
}
