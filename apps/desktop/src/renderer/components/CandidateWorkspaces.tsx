import { useMemo, useState, type ReactNode } from 'react'
import type { CandidateInterviewSnapshot, CandidateReviewSnapshot } from '@shared'
import { Icon } from './Icon'
import { useRendererUiRefresh, useUiLocale } from '../i18n'
import type { PipelineView } from './CandidatePipeline'

type CandidateWorkspaceProps = {
  interviews: CandidateInterviewSnapshot[]
  reviews: CandidateReviewSnapshot[]
  onImportResume(): void
  onOpenCandidate(
    documentId: string,
    view: PipelineView,
    interviewId?: string | null,
    interviewKind?: CandidateInterviewSnapshot['kind']
  ): void
}

type RecruitingWorkspaceProps = CandidateWorkspaceProps

type ClientWorkspaceProps = Omit<CandidateWorkspaceProps, 'onImportResume'> & {
  onOpenMatching(): void
}

type CandidateBusinessStatus = 'review' | 'ready' | 'recruiting' | 'talent' | 'client' | 'history' | 'archived'

function fieldValue(review: CandidateReviewSnapshot, key: string): string | null {
  return review.fields.find((field) => field.key === key)?.value ?? null
}

function candidateName(review: CandidateReviewSnapshot): string {
  return review.localIdentity?.displayName ?? review.fileName.replace(/\.(pdf|docx|xlsx|xls|xlsb)$/iu, '')
}

function candidateSkills(review: CandidateReviewSnapshot): string[] {
  return (fieldValue(review, 'skills') ?? '')
    .split(/[,、/\n]/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4)
}

function latestInterview(
  interviews: CandidateInterviewSnapshot[],
  documentId: string,
  kind: CandidateInterviewSnapshot['kind']
): CandidateInterviewSnapshot | null {
  return interviews
    .filter((interview) => interview.sourceDocumentId === documentId && interview.kind === kind)
    .toSorted((left, right) => right.roundNumber - left.roundNumber || right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
}

function isOpenInterview(interview: CandidateInterviewSnapshot | null): boolean {
  return Boolean(interview && interview.stage !== 'passed' && interview.stage !== 'closed')
}

function businessStatus(review: CandidateReviewSnapshot, interviews: CandidateInterviewSnapshot[]): CandidateBusinessStatus {
  if (review.recordStatus === 'archived') return 'archived'
  if (isOpenInterview(latestInterview(interviews, review.documentId, 'client'))) return 'client'
  if (review.status === 'awaiting-review') return 'review'
  if (['rejected', 'withdrawn', 'no-show'].includes(review.recruitingStatus)) return 'history'
  if (review.talentPoolStatus === 'eligible') return 'talent'
  if (isOpenInterview(latestInterview(interviews, review.documentId, 'recruiting')) || ['recruiting', 'on-hold'].includes(review.recruitingStatus)) return 'recruiting'
  return 'ready'
}

function stageLabel(interview: CandidateInterviewSnapshot | null, review: CandidateReviewSnapshot, zh: boolean): string {
  if (!interview) return review.status === 'awaiting-review' ? (zh ? 'HR 待查看' : 'HR確認待ち') : (zh ? '待预约初面' : '一次面談予約待ち')
  if (interview.stage === 'new' || interview.stage === 'contacting') return interview.roundNumber > 1 ? (zh ? '复试待预约' : '再面談予約待ち') : (zh ? '初面待预约' : '一次面談予約待ち')
  if (interview.stage === 'scheduled') return interview.questionPlan.length > 0 ? (zh ? '面试待开始' : '面談開始待ち') : (zh ? '面试待准备' : '面談準備待ち')
  if (interview.stage === 'prepared') return zh ? '面试待开始' : '面談開始待ち'
  if (interview.stage === 'interviewing') return zh ? '面试进行中' : '面談中'
  if (interview.stage === 'awaiting-decision') return zh ? '等待结论' : '結論待ち'
  if (interview.stage === 'on-hold') return zh ? '暂缓处理' : '保留中'
  if (interview.stage === 'passed') return interview.kind === 'client' ? (zh ? '客户面试通过' : '顧客面談通過') : (zh ? '招聘通过' : '採用通過')
  return interview.kind === 'client' ? (zh ? '客户未通过' : '顧客見送り') : (zh ? '招聘未通过' : '採用見送り')
}

function nextAction(interview: CandidateInterviewSnapshot | null, review: CandidateReviewSnapshot, zh: boolean): { label: string; view: PipelineView } {
  if (!interview) return review.status === 'awaiting-review'
    ? { label: zh ? '查看简历' : '履歴書を確認', view: 'resume' }
    : { label: zh ? '预约初面' : '一次面談を予約', view: 'schedule' }
  if (interview.stage === 'new' || interview.stage === 'contacting') return { label: interview.roundNumber > 1 ? (zh ? '预约复试' : '再面談を予約') : (zh ? '预约初面' : '一次面談を予約'), view: 'schedule' }
  if (interview.stage === 'scheduled' && interview.questionPlan.length === 0) return { label: zh ? '准备问题' : '質問を準備', view: 'prepare' }
  if (interview.stage === 'scheduled' || interview.stage === 'prepared' || interview.stage === 'interviewing') return { label: zh ? '进入面试' : '面談を開く', view: 'workbench' }
  if (interview.stage === 'awaiting-decision') return { label: zh ? '填写结论' : '結論を入力', view: 'decision' }
  return { label: zh ? '查看详情' : '詳細を見る', view: interview.kind === 'client' ? 'client' : 'overview' }
}

function formatDate(value: string | null, locale: 'ja-JP' | 'zh-CN'): string {
  if (!value) return locale === 'zh-CN' ? '尚未预约' : '未予約'
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit'
  }).format(new Date(value))
}

function sourceLabel(fileName: string, zh: boolean): string {
  const extension = fileName.split('.').at(-1)?.toUpperCase() ?? ''
  return extension ? `${zh ? '简历' : '履歴書'} · ${extension}` : (zh ? '本地简历' : 'ローカル履歴書')
}

function WorkspaceHeader({
  eyebrow,
  title,
  description,
  children
}: {
  eyebrow: string
  title: string
  description: string
  children?: ReactNode
}) {
  return <header className="candidate-queue-header">
    <div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
    {children ? <div className="candidate-queue-header-actions">{children}</div> : null}
  </header>
}

function StatusPill({ status, label }: { status: string; label: string }) {
  return <span className={`candidate-queue-status is-${status}`}>{label}</span>
}

export function CandidateDirectoryWorkspace({
  interviews,
  reviews,
  onImportResume,
  onOpenCandidate
}: CandidateWorkspaceProps) {
  useRendererUiRefresh()
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | CandidateBusinessStatus>('all')
  const [role, setRole] = useState('all')

  const rows = useMemo(() => reviews.map((review) => ({
    review,
    status: businessStatus(review, interviews),
    recruiting: latestInterview(interviews, review.documentId, 'recruiting'),
    client: latestInterview(interviews, review.documentId, 'client')
  })), [interviews, reviews])
  const roles = useMemo(() => [...new Set(reviews.map((review) => fieldValue(review, 'role')).filter((value): value is string => Boolean(value)))].toSorted(), [reviews])
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale)
    return rows.filter((row) => {
      if (status !== 'all' && row.status !== status) return false
      if (role !== 'all' && fieldValue(row.review, 'role') !== role) return false
      if (!normalized) return true
      return [candidateName(row.review), row.review.fileName, fieldValue(row.review, 'role'), fieldValue(row.review, 'location'), ...candidateSkills(row.review)]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase(locale).includes(normalized))
    })
  }, [locale, query, role, rows, status])

  const statusText: Record<CandidateBusinessStatus, string> = {
    review: zh ? 'HR 待查看' : 'HR確認待ち',
    ready: zh ? '待招聘' : '採用開始待ち',
    recruiting: zh ? '招聘中' : '採用中',
    talent: zh ? '人才池' : '人材プール',
    client: zh ? '客户面试中' : '顧客面談中',
    history: zh ? '招聘未通过' : '採用見送り',
    archived: zh ? '已归档' : 'アーカイブ'
  }

  return <main className="candidate-queue-workspace">
    <WorkspaceHeader
      description={zh ? '查询全部候选人，再进入个人档案处理简历、招聘面试或客户面试。' : '候補者全体を検索し、個人プロフィールから履歴書・採用面談・顧客面談を処理します。'}
      eyebrow="CANDIDATE DIRECTORY"
      title={zh ? '候选人' : '候補者'}
    >
      <button className="is-primary" onClick={onImportResume} type="button"><Icon name="upload" size={16} />{zh ? '导入简历' : '履歴書を取込'}</button>
    </WorkspaceHeader>

    <section className="candidate-queue-metrics" aria-label={zh ? '候选人概况' : '候補者概要'}>
      <article><span>{zh ? '全部候选人' : '全候補者'}</span><strong>{rows.length}</strong><small>{zh ? '本地档案总数' : '端末内プロフィール'}</small></article>
      <article><span>{zh ? 'HR 待查看' : 'HR確認待ち'}</span><strong>{rows.filter((row) => row.review.status === 'awaiting-review').length}</strong><small>{zh ? '需要确认简历' : '履歴書確認が必要'}</small></article>
      <article><span>{zh ? '招聘进行中' : '採用進行中'}</span><strong>{rows.filter((row) => row.status === 'recruiting').length}</strong><small>{zh ? '尚未形成结论' : '結論前の候補者'}</small></article>
      <article><span>{zh ? '客户面试中' : '顧客面談中'}</span><strong>{rows.filter((row) => row.status === 'client').length}</strong><small>{zh ? '已有客户面试流程' : '顧客面談フローあり'}</small></article>
      <article><span>{zh ? '人才池' : '人材プール'}</span><strong>{rows.filter((row) => row.status === 'talent').length}</strong><small>{zh ? '可参与案件匹配' : '案件マッチング可能'}</small></article>
      <article><span>{zh ? '历史候选人' : '採用履歴'}</span><strong>{rows.filter((row) => row.status === 'history').length}</strong><small>{zh ? '未通过、辞退或未到场' : '見送り・辞退・欠席'}</small></article>
    </section>

    <section className="candidate-queue-panel">
      <div className="candidate-queue-filters">
        <label className="candidate-queue-search"><Icon name="search" size={16} /><input aria-label={zh ? '搜索候选人' : '候補者を検索'} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '姓名、职种、技能、所在地' : '氏名・職種・スキル・所在地'} value={query} /></label>
        <label><span>{zh ? '当前状态' : '現在状態'}</span><select aria-label={zh ? '当前状态' : '現在状態'} onChange={(event) => setStatus(event.target.value as typeof status)} value={status}><option value="all">{zh ? '全部状态' : 'すべての状態'}</option>{Object.entries(statusText).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>{zh ? '职种' : '職種'}</span><select aria-label={zh ? '职种' : '職種'} onChange={(event) => setRole(event.target.value)} value={role}><option value="all">{zh ? '全部职种' : 'すべての職種'}</option>{roles.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <button className="is-quiet" onClick={() => { setQuery(''); setStatus('all'); setRole('all') }} type="button">{zh ? '重置' : 'リセット'}</button>
      </div>
      <div className="candidate-queue-result-meta"><strong>{zh ? `候选人列表（${filtered.length}）` : `候補者一覧（${filtered.length}）`}</strong><span>{zh ? '点击姓名查看个人档案与完整面试历史' : '氏名をクリックして個人プロフィールと面談履歴を表示'}</span></div>
      <div className="candidate-queue-table-wrap">
        <table className="candidate-queue-table">
          <thead><tr><th>{zh ? '候选人' : '候補者'}</th><th>{zh ? '当前状态' : '現在状態'}</th><th>{zh ? '职种/经验' : '職種・経験'}</th><th>{zh ? '核心技能' : '主要スキル'}</th><th>{zh ? '最近活动' : '最終更新'}</th><th>{zh ? '来源' : '出所'}</th><th>{zh ? '操作' : '操作'}</th></tr></thead>
          <tbody>{filtered.map(({ review, status: rowStatus, recruiting, client }) => {
            const currentInterview = client && isOpenInterview(client) ? client : recruiting
            const action = rowStatus === 'talent' || rowStatus === 'history' || rowStatus === 'archived'
              ? { label: zh ? '查看档案' : 'プロフィールを見る', view: 'overview' as const }
              : nextAction(currentInterview, review, zh)
            const currentStatusLabel = rowStatus === 'recruiting' || rowStatus === 'client'
              ? stageLabel(currentInterview, review, zh)
              : statusText[rowStatus]
            return <tr key={review.documentId}>
              <td><button className="candidate-queue-person" onClick={() => onOpenCandidate(review.documentId, 'overview')} type="button"><span>{candidateName(review).slice(-1)}</span><span><strong>{candidateName(review)}</strong><small>{fieldValue(review, 'location') ?? (zh ? '所在地待确认' : '所在地未確認')}</small></span></button></td>
              <td><StatusPill label={currentStatusLabel} status={rowStatus} /></td>
              <td><strong>{fieldValue(review, 'role') ?? (zh ? '职种待确认' : '職種未確認')}</strong><small>{fieldValue(review, 'experience_years') ?? '—'}</small></td>
              <td><div className="candidate-queue-skill-list">{candidateSkills(review).map((skill) => <span key={skill}>{skill}</span>)}</div></td>
              <td><strong>{currentInterview ? stageLabel(currentInterview, review, zh) : (review.completedAt ? (zh ? '档案已确认' : 'プロフィール確認済み') : (zh ? '简历已导入' : '履歴書取込済み'))}</strong><small>{formatDate(currentInterview?.updatedAt ?? review.completedAt, locale)}</small></td>
              <td><strong>{sourceLabel(review.fileName, zh)}</strong><small title={review.fileName}>{review.fileName}</small></td>
              <td><button className="candidate-queue-action" onClick={() => onOpenCandidate(review.documentId, action.view, currentInterview?.id ?? null, currentInterview?.kind)} type="button">{action.label}<Icon name="chevron-right" size={14} /></button></td>
            </tr>
          })}</tbody>
        </table>
      </div>
      {filtered.length === 0 ? <div className="candidate-queue-empty"><Icon name="search" size={26} /><strong>{zh ? '没有符合条件的候选人' : '条件に合う候補者がいません'}</strong><span>{zh ? '调整筛选条件，或导入新的简历。' : '条件を変更するか、新しい履歴書を取り込んでください。'}</span></div> : null}
    </section>
  </main>
}

export function RecruitingInterviewWorkspace({
  interviews,
  reviews,
  onImportResume,
  onOpenCandidate
}: RecruitingWorkspaceProps) {
  useRendererUiRefresh()
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState('all')

  const rows = useMemo(() => reviews.map((review) => ({
    review,
    interview: latestInterview(interviews, review.documentId, 'recruiting')
  })).filter(({ review, interview }) => review.status === 'awaiting-review' || isOpenInterview(interview)), [interviews, reviews])
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale)
    return rows.filter(({ review, interview }) => {
      if (stage !== 'all' && (interview?.stage ?? 'review') !== stage) return false
      if (!normalized) return true
      return [candidateName(review), fieldValue(review, 'role'), ...candidateSkills(review)]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase(locale).includes(normalized))
    })
  }, [locale, query, rows, stage])
  const today = new Date().toDateString()
  const scheduledToday = rows.filter(({ interview }) => interview?.scheduledAt && new Date(interview.scheduledAt).toDateString() === today).length

  return <main className="candidate-queue-workspace">
    <WorkspaceHeader
      description={zh ? '只显示处于公司招聘阶段的候选人，按下一步行动推进初面、复试和招聘结论。' : '社内採用段階の候補者だけを表示し、一次面談・再面談・採用結論を次の行動順に進めます。'}
      eyebrow="RECRUITING INTERVIEWS"
      title={zh ? '招聘面试' : '採用面談'}
    >
      <button onClick={onImportResume} type="button"><Icon name="upload" size={16} />{zh ? '导入简历' : '履歴書を取込'}</button>
    </WorkspaceHeader>

    <section className="candidate-queue-metrics is-recruiting" aria-label={zh ? '招聘面试概况' : '採用面談概要'}>
      <article><span>{zh ? '招聘进行中' : '採用進行中'}</span><strong>{rows.length}</strong><small>{zh ? '需要继续处理' : '対応が必要'}</small></article>
      <article><span>{zh ? '简历待查看' : '履歴書確認待ち'}</span><strong>{rows.filter(({ review }) => review.status === 'awaiting-review').length}</strong><small>{zh ? '尚未完成人工查看' : 'HR確認前'}</small></article>
      <article><span>{zh ? '今日面试' : '本日の面談'}</span><strong>{scheduledToday}</strong><small>{zh ? 'Zoom或现场面试' : 'Zoomまたは対面'}</small></article>
      <article><span>{zh ? '待填写结论' : '結論入力待ち'}</span><strong>{rows.filter(({ interview }) => interview?.stage === 'awaiting-decision').length}</strong><small>{zh ? '需要人工判断' : '人の判断が必要'}</small></article>
      <article><span>{zh ? '待安排复试' : '再面談調整待ち'}</span><strong>{rows.filter(({ interview }) => interview?.roundNumber && interview.roundNumber > 1 && (interview.stage === 'new' || interview.stage === 'contacting')).length}</strong><small>{zh ? '继承上一轮事项' : '前回確認事項を継承'}</small></article>
    </section>

    <section className="candidate-queue-panel">
      <div className="candidate-queue-toolbar">
        <div className="candidate-queue-filter-tabs">{[
          ['all', zh ? '全部' : 'すべて'], ['review', zh ? '简历待查看' : '履歴書確認待ち'], ['scheduled', zh ? '已预约' : '予約済み'], ['awaiting-decision', zh ? '待结论' : '結論待ち']
        ].map(([value, label]) => <button className={stage === value ? 'is-active' : ''} key={value} onClick={() => setStage(value)} type="button">{label}</button>)}</div>
        <label className="candidate-queue-search"><Icon name="search" size={16} /><input aria-label={zh ? '搜索招聘候选人' : '採用候補者を検索'} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '姓名、职种、技能' : '氏名・職種・スキル'} value={query} /></label>
      </div>
      <div className="candidate-queue-result-meta"><strong>{zh ? `招聘候选人（${filtered.length}）` : `採用候補者（${filtered.length}）`}</strong><span>{zh ? '可先查看该候选人的完整面试详情，再执行下一步' : '候補者ごとの面談詳細を確認してから次の行動を進めます'}</span></div>
      <div className="candidate-queue-table-wrap">
        <table className="candidate-queue-table is-interview-table">
          <thead><tr><th>{zh ? '候选人' : '候補者'}</th><th>{zh ? '招聘阶段' : '採用段階'}</th><th>{zh ? '面试时间' : '面談日時'}</th><th>{zh ? '面试官' : '面談者'}</th><th>{zh ? '职位/技能' : '職種・スキル'}</th><th>{zh ? '来源' : '出所'}</th><th>{zh ? '操作' : '操作'}</th></tr></thead>
          <tbody>{filtered.map(({ review, interview }) => {
            const action = nextAction(interview, review, zh)
            return <tr key={review.documentId}>
              <td><button className="candidate-queue-person" onClick={() => onOpenCandidate(review.documentId, 'overview', interview?.id ?? null, 'recruiting')} type="button"><span>{candidateName(review).slice(-1)}</span><span><strong>{candidateName(review)}</strong><small>{fieldValue(review, 'experience_years') ?? (zh ? '经验待确认' : '経験未確認')}</small></span></button></td>
              <td><StatusPill label={stageLabel(interview, review, zh)} status={interview?.stage ?? 'review'} /></td>
              <td><strong>{formatDate(interview?.scheduledAt ?? null, locale)}</strong><small>{interview?.meetingMethod === 'zoom' ? 'Zoom' : interview?.meetingMethod ?? '—'}</small></td>
              <td><strong>{interview?.interviewer ?? (zh ? '待安排' : '未設定')}</strong><small>{interview?.roundNumber ? (interview.roundNumber === 1 ? (zh ? '初面' : '一次面談') : `${zh ? '复试' : '再面談'} ${interview.roundNumber - 1}`) : '—'}</small></td>
              <td><strong>{fieldValue(review, 'role') ?? (zh ? '职位待确认' : '職種未確認')}</strong><div className="candidate-queue-skill-list">{candidateSkills(review).slice(0, 2).map((skill) => <span key={skill}>{skill}</span>)}</div></td>
              <td><strong>{sourceLabel(review.fileName, zh)}</strong><small>{review.reviewerDisplayName ?? (zh ? '未分配负责人' : '担当未設定')}</small></td>
              <td><div className="candidate-queue-actions"><button className="candidate-queue-action" onClick={() => onOpenCandidate(review.documentId, 'overview', interview?.id ?? null, 'recruiting')} type="button">{zh ? '面试详情' : '面談詳細'}</button><button className="candidate-queue-action is-primary" onClick={() => onOpenCandidate(review.documentId, action.view, interview?.id ?? null, 'recruiting')} type="button">{action.label}<Icon name="chevron-right" size={14} /></button></div></td>
            </tr>
          })}</tbody>
        </table>
      </div>
      {filtered.length === 0 ? <div className="candidate-queue-empty"><Icon name="check" size={26} /><strong>{zh ? '当前筛选下没有待处理候选人' : 'この条件に対応待ち候補者はいません'}</strong><span>{zh ? '可以切换阶段，或导入新的简历。' : '段階を切り替えるか、新しい履歴書を取り込んでください。'}</span></div> : null}
    </section>
  </main>
}

export function ClientInterviewWorkspace({
  interviews,
  reviews,
  onOpenCandidate,
  onOpenMatching,
  mode = 'queue'
}: ClientWorkspaceProps & { mode?: 'queue' | 'entry-prep' }) {
  useRendererUiRefresh()
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState('all')
  const reviewMap = useMemo(() => new Map(reviews.map((review) => [review.documentId, review])), [reviews])
  const rows = useMemo(() => {
    const latestByCandidate = new Map<string, CandidateInterviewSnapshot>()
    interviews.filter((interview) => interview.kind === 'client').forEach((interview) => {
      const current = latestByCandidate.get(interview.sourceDocumentId)
      if (!current || interview.roundNumber > current.roundNumber || interview.updatedAt > current.updatedAt) latestByCandidate.set(interview.sourceDocumentId, interview)
    })
    return [...latestByCandidate.values()].map((interview) => ({ interview, review: reviewMap.get(interview.sourceDocumentId) })).filter((row): row is { interview: CandidateInterviewSnapshot; review: CandidateReviewSnapshot } => Boolean(row.review))
  }, [interviews, reviewMap])
  const queueRows = useMemo(() => mode === 'entry-prep'
    ? rows.filter(({ interview }) => interview.stage === 'passed')
    : rows, [mode, rows])
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale)
    return queueRows.filter(({ interview, review }) => {
      if (stage !== 'all' && interview.stage !== stage) return false
      if (!normalized) return true
      return [candidateName(review), fieldValue(review, 'role'), interview.contactNote, ...candidateSkills(review)]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase(locale).includes(normalized))
    })
  }, [locale, query, queueRows, stage])
  const entryPrep = mode === 'entry-prep'

  return <main className="candidate-queue-workspace">
    <WorkspaceHeader
      description={entryPrep
        ? (zh ? '只显示客户面试已通过的候选人。先选择具体人员，再处理其入场准备。' : '顧客面談を通過した候補者だけを表示し、対象者を選んで参画準備を進めます。')
        : (zh ? '只显示已经进入客户选考的候选人。每条记录代表一名候选人的客户面试流程。' : '顧客選考に進んだ候補者だけを表示します。各行が候補者の顧客面談フローです。')}
      eyebrow={entryPrep ? 'ENTRY PREPARATION' : 'CLIENT INTERVIEWS'}
      title={entryPrep ? (zh ? '入场准备' : '参画準備') : (zh ? '客户面试' : '顧客面談')}
    >
      <button className="is-primary" onClick={onOpenMatching} type="button"><Icon name="sparkles" size={16} />{zh ? '从案件匹配开始' : '案件マッチングから開始'}</button>
    </WorkspaceHeader>

    <section className="candidate-queue-metrics is-client" aria-label={zh ? '客户面试概况' : '顧客面談概要'}>
      <article><span>{zh ? '客户选考中' : '顧客選考中'}</span><strong>{rows.filter(({ interview }) => isOpenInterview(interview)).length}</strong><small>{zh ? '正在推进的候选人' : '進行中の候補者'}</small></article>
      <article><span>{zh ? '等待客户回复' : '顧客回答待ち'}</span><strong>{rows.filter(({ interview }) => interview.stage === 'contacting' || interview.stage === 'on-hold').length}</strong><small>{zh ? '需要营业跟进' : '営業フォローが必要'}</small></article>
      <article><span>{zh ? '已预约面试' : '面談予約済み'}</span><strong>{rows.filter(({ interview }) => interview.stage === 'scheduled' || interview.stage === 'interviewing').length}</strong><small>{zh ? 'Zoom或客户现场' : 'Zoomまたは顧客先'}</small></article>
      <article><span>{zh ? '等待结果' : '結果待ち'}</span><strong>{rows.filter(({ interview }) => interview.stage === 'awaiting-decision').length}</strong><small>{zh ? '等待客户结论' : '顧客結論待ち'}</small></article>
      <article><span>{zh ? '准备入场' : '参画準備'}</span><strong>{rows.filter(({ interview }) => interview.stage === 'passed').length}</strong><small>{zh ? '客户面试已通过' : '顧客面談通過済み'}</small></article>
    </section>

    <section className="candidate-queue-panel">
      <div className="candidate-queue-toolbar">
        <div className="candidate-queue-filter-tabs">{[
          ['all', zh ? '全部' : 'すべて'], ['contacting', zh ? '等待回复' : '回答待ち'], ['scheduled', zh ? '已预约' : '予約済み'], ['awaiting-decision', zh ? '等待结果' : '結果待ち'], ['passed', zh ? '已通过' : '通過済み']
        ].map(([value, label]) => <button className={stage === value ? 'is-active' : ''} key={value} onClick={() => setStage(value)} type="button">{label}</button>)}</div>
        <label className="candidate-queue-search"><Icon name="search" size={16} /><input aria-label={zh ? '搜索客户面试' : '顧客面談を検索'} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '候选人、案件、客户' : '候補者・案件・顧客'} value={query} /></label>
      </div>
      <div className="candidate-queue-result-meta"><strong>{entryPrep ? (zh ? `待入场候选人（${filtered.length}）` : `参画準備候補者（${filtered.length}）`) : (zh ? `客户面试候选人（${filtered.length}）` : `顧客面談候補者（${filtered.length}）`)}</strong><span>{entryPrep ? (zh ? '从具体人员进入，保留全部客户面试历史' : '個人詳細から入り、顧客面談履歴をすべて確認できます') : (zh ? '客户面试结果不会改变招聘档案' : '顧客面談結果は採用プロフィールを変更しません')}</span></div>
      {queueRows.length > 0 ? <div className="candidate-queue-table-wrap">
        <table className="candidate-queue-table is-interview-table">
          <thead><tr><th>{zh ? '候选人' : '候補者'}</th><th>{zh ? '案件/客户' : '案件・顧客'}</th><th>{zh ? '客户阶段' : '顧客段階'}</th><th>{zh ? '面试时间' : '面談日時'}</th><th>{zh ? '轮次' : '回次'}</th><th>{zh ? '负责人' : '担当者'}</th><th>{zh ? '操作' : '操作'}</th></tr></thead>
          <tbody>{filtered.map(({ review, interview }) => {
            const action = nextAction(interview, review, zh)
            return <tr key={review.documentId}>
              <td><button className="candidate-queue-person" onClick={() => onOpenCandidate(review.documentId, entryPrep ? 'entry' : 'client', interview.id, 'client')} type="button"><span>{candidateName(review).slice(-1)}</span><span><strong>{candidateName(review)}</strong><small>{fieldValue(review, 'role') ?? (zh ? '职位待确认' : '職種未確認')}</small></span></button></td>
              <td><strong>{zh ? '案件待关联' : '案件未紐付け'}</strong><small>{interview.contactNote ?? (zh ? '从案件匹配记录建立关联' : '案件マッチングから紐付け')}</small></td>
              <td><StatusPill label={stageLabel(interview, review, zh)} status={interview.stage} /></td>
              <td><strong>{formatDate(interview.scheduledAt, locale)}</strong><small>{interview.meetingMethod === 'zoom' ? 'Zoom' : interview.meetingMethod}</small></td>
              <td><strong>{zh ? `客户面试 ${interview.roundNumber}` : `顧客面談 ${interview.roundNumber}`}</strong><small>{interview.unresolvedItems.length ? (zh ? `${interview.unresolvedItems.length} 项待确认` : `確認 ${interview.unresolvedItems.length}件`) : (zh ? '无待确认项' : '確認事項なし')}</small></td>
              <td><strong>{interview.interviewer ?? (zh ? '待安排' : '未設定')}</strong><small>{interview.updatedBy}</small></td>
              <td><div className="candidate-queue-actions"><button className="candidate-queue-action" onClick={() => onOpenCandidate(review.documentId, entryPrep ? 'entry' : 'client', interview.id, 'client')} type="button">{zh ? '面试详情' : '面談詳細'}</button><button className="candidate-queue-action is-primary" onClick={() => onOpenCandidate(review.documentId, entryPrep ? 'entry' : (action.view === 'overview' ? 'client' : action.view), interview.id, 'client')} type="button">{entryPrep ? (zh ? '进入入场准备' : '参画準備を開く') : action.label}<Icon name="chevron-right" size={14} /></button></div></td>
            </tr>
          })}</tbody>
        </table>
      </div> : <div className="candidate-queue-empty is-large"><span className="candidate-queue-empty-icon"><Icon name={entryPrep ? 'check' : 'briefcase'} size={30} /></span><strong>{entryPrep ? (zh ? '目前没有待入场准备的候选人' : '現在、参画準備待ちの候補者はいません') : (zh ? '目前没有处于客户面试阶段的候选人' : '現在、顧客面談中の候補者はいません')}</strong><p>{entryPrep ? (zh ? '候选人通过客户面试后，会在这里按人员显示；不会自动打开其他候选人的记录。' : '顧客面談通過後にここへ候補者単位で表示します。他の候補者の記録を自動で開くことはありません。') : (zh ? '候选人通过公司招聘并取得人才池资格后，先与案件匹配；确认推荐后才会在这里创建客户面试流程。' : '社内採用を通過して人材プール資格を取得後、案件マッチングと推薦確認を経て顧客面談フローを作成します。')}</p>{entryPrep ? null : <button className="is-primary" onClick={onOpenMatching} type="button"><Icon name="sparkles" size={16} />{zh ? '前往 AI 匹配' : 'AIマッチングへ'}</button>}</div>}
      {queueRows.length > 0 && filtered.length === 0 ? <div className="candidate-queue-empty"><Icon name="search" size={26} /><strong>{entryPrep ? (zh ? '没有符合条件的入场准备候选人' : '条件に合う参画準備候補者はいません') : (zh ? '没有符合条件的客户面试' : '条件に合う顧客面談がありません')}</strong><span>{zh ? '请调整筛选条件。' : '条件を変更してください。'}</span></div> : null}
    </section>
  </main>
}
