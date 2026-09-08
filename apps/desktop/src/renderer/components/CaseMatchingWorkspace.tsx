import { useEffect, useRef, useState } from 'react'
import type { CandidateReviewSnapshot, CasePersonnelMatchResult, JobCaseReviewSnapshot } from '@shared'
import { useUiLocale } from '../i18n'
import { MatchAssessmentView } from './MatchAssessmentView'

interface Props {
  jobCaseId?: string
  request?: { id: number; jobCaseId: string }
  reviews: JobCaseReviewSnapshot[]
  candidates: CandidateReviewSnapshot[]
  onMatchingChange?(jobCaseId: string | null): void
  onOpenPerson(documentId: string): void
}

/** A single case, its progress, and its people. Kept mounted during detail navigation. */
export function CaseMatchingWorkspace({ jobCaseId, request, reviews, candidates, onMatchingChange, onOpenPerson }: Props) {
  const zh = useUiLocale() === 'zh-CN'
  const t = (cn: string, ja: string) => zh ? cn : ja
  const [cache, setCache] = useState<Record<string, CasePersonnelMatchResult>>({})
  const [selectedPeople, setSelectedPeople] = useState<Record<string, string>>({})
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const pending = useRef(false)
  const applied = useRef<number | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const review = reviews.find((review) => review.jobCase?.id === jobCaseId)
  const cached = jobCaseId ? cache[jobCaseId] : undefined
  const result = review?.lifecycle === 'active' && cached?.jobCaseVersion === review?.jobCase?.version ? cached : undefined
  const items = result?.items.filter((item) => candidates.some((candidate) => candidate.documentId === item.documentId && candidate.recordStatus === 'active' && candidate.profile?.version === item.profileVersion)) ?? []
  const available = review?.lifecycle === 'active' && Boolean(review.jobCase)
  const focus = () => { if (body.current && !body.current.closest('[hidden]')) { body.current.scrollTop = 0; body.current.focus({ preventScroll: true }) } }
  const find = async (id: string) => {
    if (pending.current) return
    pending.current = true; setPendingId(id); onMatchingChange?.(id)
    setErrors((current) => ({ ...current, [id]: '' }))
    focus()
    try {
      const value = await window.sesAgent.findPersonnelForCase(id)
      if (value.jobCaseId !== id) throw new Error(t('案件已更新，请重新找人。', '案件が更新されました。再検索してください。'))
      setCache((current) => ({ ...current, [id]: value }))
    } catch (cause) { setErrors((current) => ({ ...current, [id]: cause instanceof Error ? cause.message : String(cause) })) }
    finally { pending.current = false; setPendingId(null); onMatchingChange?.(null) }
  }
  useEffect(() => {
    if (!request || request.id === applied.current || request.jobCaseId !== jobCaseId) return
    applied.current = request.id
    if (available && !pending.current) void find(request.jobCaseId)
  }, [request, jobCaseId, available])
  if (!review) return <p>{t('案件不存在或已删除。', '案件が存在しないか削除されています。')}</p>
  const title = review.fields.find((field) => field.key === 'title')?.value ?? review.redactedSubject
  return <div ref={body} tabIndex={-1} className="case-matching-workspace business-workbench" aria-label={t('案件找人', '案件の要員検索')}>
    <header className="case-matching-heading"><small>{t('为当前案件找人', 'この案件の要員を探す')}</small><h2>{title}</h2></header>
    <dl className="agent-business-facts">{review.fields.filter((field) => ['required_skills', 'rate', 'location', 'remote', 'start_date'].includes(field.key) && field.value).map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
    <button className="is-primary" disabled={Boolean(pendingId) || !available} aria-busy={pendingId === jobCaseId} onClick={() => void find(jobCaseId!)} type="button">{pendingId === jobCaseId ? t('正在匹配…', 'マッチング中…') : t('为此案件找人', 'この案件の要員を探す')}</button>
    {jobCaseId && errors[jobCaseId] ? <p role="alert">{errors[jobCaseId]}</p> : null}
    {pendingId === jobCaseId ? <p className="personnel-match-progress" role="status">{t('正在筛选人员并由云端 AI 评估适合度…', '要員を絞り込み、Cloud AIで適合性を評価しています…')}</p> : null}
    {result ? <section className="personnel-matches" aria-label={t('人员匹配结果', '要員マッチング結果')}>
      <h3>{t('人员匹配结果', '要員マッチング結果')} ({items.length})</h3>
      {result.localMatchCount > result.items.length ? <small>{t('初筛', '一次検索')} {result.localMatchCount} {t('位人员，优先展示', '名から優先表示')} {items.length} {t('位', '名')}</small> : null}
      <p className="personnel-match-status" role="status">{result.cloud.status === 'reviewed' ? t('云端 AI 已评估，按适合度排序。', 'Cloud AI評価済み・適合性順に表示。') : result.cloud.status === 'partial' ? t('部分人员已由云端 AI 评估，其余标为本地初筛。', '一部はCloud AI評価済み、残りはローカル候補として表示します。') : result.cloud.status === 'not-needed' ? t('没有找到具备技能或角色匹配依据的人员。', 'スキルや役割が一致する要員は見つかりませんでした。') : t('云端 AI 暂不可用，以下仅为本地初筛结果。', 'Cloud AIを利用できないため、以下はローカル検索結果です。')}{result.cloud.modelName ? ` · ${result.cloud.modelName}` : ''}</p>
      {items.map((item) => {
        const person = candidates.find((person) => person.documentId === item.documentId)!
        const name = person.localIdentity?.displayName ?? person.fileName.replace(/\.[^.]+$/u, '')
        return <article key={item.documentId} aria-label={name} aria-current={selectedPeople[jobCaseId!] === item.documentId ? 'true' : undefined} className={selectedPeople[jobCaseId!] === item.documentId ? 'is-selected' : ''}>
          <strong>{name}</strong>
          {item.assessment ? <MatchAssessmentView assessment={item.assessment} zh={zh} title={t('AI 匹配评估', 'AIマッチング評価')} /> : <><small className="personnel-local-match">{t('本地初筛', 'ローカル候補')}</small><p>{t('匹配依据', '一致の根拠')}：{item.matched.join(' · ')}</p>{item.missing.length ? <p>{t('尚未确认符合', '一致未確認')}：{item.missing.join(' · ')}</p> : null}</>}
          <button onClick={() => { setSelectedPeople((current) => ({ ...current, [jobCaseId!]: item.documentId })); onOpenPerson(item.documentId) }} type="button">{t('查看人员 / 生成介绍', '要員を確認・紹介')}</button>
        </article>
      })}
      {!items.length ? <p>{t('当前没有足够匹配依据。可以补充人员资料后再查。', '現在は十分な一致根拠がありません。要員情報の追加後に再検索できます。')}</p> : null}
    </section> : null}
  </div>
}
