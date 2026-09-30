import { useMemo, useState, type ReactNode } from 'react'
import type { CandidateInterviewSnapshot, CandidateReviewSnapshot } from '@shared'
import { Icon } from './Icon'
import { localeText, useUiLocale } from '../i18n'
import type { PipelineView } from './CandidatePipeline'

type RecruitingWorkspaceProps = {
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
  return (
    interviews
      .filter((interview) => interview.sourceDocumentId === documentId && interview.kind === kind)
      .toSorted((left, right) => right.roundNumber - left.roundNumber || right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  )
}

function isOpenInterview(interview: CandidateInterviewSnapshot | null): boolean {
  return Boolean(interview && interview.stage !== 'passed' && interview.stage !== 'closed')
}

function stageLabel(interview: CandidateInterviewSnapshot | null, review: CandidateReviewSnapshot, zh: boolean): string {
  const t = localeText(zh)

  if (!interview) return review.status === 'awaiting-review' ? t('HR 待查看', 'HR確認待ち') : t('待预约初面', '一次面談予約待ち')
  if (interview.stage === 'new' || interview.stage === 'contacting')
    return interview.roundNumber > 1 ? t('复试待预约', '再面談予約待ち') : t('初面待预约', '一次面談予約待ち')
  if (interview.stage === 'scheduled')
    return interview.questionPlan.length > 0 ? t('面试待开始', '面談開始待ち') : t('面试待准备', '面談準備待ち')
  if (interview.stage === 'prepared') return t('面试待开始', '面談開始待ち')
  if (interview.stage === 'interviewing') return t('面试进行中', '面談中')
  if (interview.stage === 'awaiting-decision') return t('等待结论', '結論待ち')
  if (interview.stage === 'on-hold') return t('暂缓处理', '保留中')
  if (interview.stage === 'passed') return interview.kind === 'client' ? t('客户面试通过', '顧客面談通過') : t('招聘通过', '採用通過')
  return interview.kind === 'client' ? t('客户未通过', '顧客見送り') : t('招聘未通过', '採用見送り')
}

function nextAction(
  interview: CandidateInterviewSnapshot | null,
  review: CandidateReviewSnapshot,
  zh: boolean
): { label: string; view: PipelineView } {
  const t = localeText(zh)

  if (!interview)
    return review.status === 'awaiting-review'
      ? { label: t('查看简历', '履歴書を確認'), view: 'resume' }
      : { label: t('预约初面', '一次面談を予約'), view: 'schedule' }
  if (interview.stage === 'new' || interview.stage === 'contacting')
    return { label: interview.roundNumber > 1 ? t('预约复试', '再面談を予約') : t('预约初面', '一次面談を予約'), view: 'schedule' }
  if (interview.stage === 'scheduled' && interview.questionPlan.length === 0) return { label: t('准备问题', '質問を準備'), view: 'prepare' }
  if (interview.stage === 'scheduled' || interview.stage === 'prepared' || interview.stage === 'interviewing')
    return { label: t('进入面试', '面談を開く'), view: 'workbench' }
  if (interview.stage === 'awaiting-decision') return { label: t('填写结论', '結論を入力'), view: 'decision' }
  return { label: t('查看详情', '詳細を見る'), view: interview.kind === 'client' ? 'client' : 'overview' }
}

function formatDate(value: string | null, locale: 'ja-JP' | 'zh-CN'): string {
  const t = localeText(locale === 'zh-CN')

  if (!value) return t('尚未预约', '未予約')
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function sourceLabel(fileName: string, zh: boolean): string {
  const t = localeText(zh)

  const extension = fileName.split('.').at(-1)?.toUpperCase() ?? ''
  return extension ? `${t('简历', '履歴書')} · ${extension}` : t('本地简历', 'ローカル履歴書')
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
  return (
    <header className="candidate-queue-header">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children ? <div className="candidate-queue-header-actions">{children}</div> : null}
    </header>
  )
}

function StatusPill({ status, label }: { status: string; label: string }) {
  return <span className={`candidate-queue-status is-${status}`}>{label}</span>
}

export function RecruitingInterviewWorkspace({ interviews, reviews, onImportResume, onOpenCandidate }: RecruitingWorkspaceProps) {
  const locale = useUiLocale()
  const zh = locale === 'zh-CN'
  const t = localeText(zh)
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState('all')

  const rows = useMemo(
    () =>
      reviews
        .map((review) => ({
          review,
          interview: latestInterview(interviews, review.documentId, 'recruiting')
        }))
        .filter(({ review, interview }) => review.status === 'awaiting-review' || isOpenInterview(interview)),
    [interviews, reviews]
  )
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
  const scheduledToday = rows.filter(
    ({ interview }) => interview?.scheduledAt && new Date(interview.scheduledAt).toDateString() === today
  ).length

  return (
    <main className="candidate-queue-workspace">
      <WorkspaceHeader
        description={t(
          '只显示招聘面试中的人员，按下一步行动安排初面、复试和招聘结论。',
          '社内採用段階の応募者だけを表示し、一次面談・再面談・採用結論を次の行動順に進めます。'
        )}
        eyebrow="RECRUITING INTERVIEWS"
        title={t('招聘面试', '採用面談')}
      >
        <button onClick={onImportResume} type="button">
          <Icon name="upload" size={16} />
          {t('导入简历', '履歴書を取込')}
        </button>
      </WorkspaceHeader>

      <section className="candidate-queue-metrics is-recruiting" aria-label={t('招聘面试概况', '採用面談概要')}>
        <article>
          <span>{t('招聘进行中', '採用進行中')}</span>
          <strong>{rows.length}</strong>
          <small>{t('需要继续处理', '対応が必要')}</small>
        </article>
        <article>
          <span>{t('简历待查看', '履歴書確認待ち')}</span>
          <strong>{rows.filter(({ review }) => review.status === 'awaiting-review').length}</strong>
          <small>{t('尚未完成人工查看', 'HR確認前')}</small>
        </article>
        <article>
          <span>{t('今日面试', '本日の面談')}</span>
          <strong>{scheduledToday}</strong>
          <small>{t('Zoom或现场面试', 'Zoomまたは対面')}</small>
        </article>
        <article>
          <span>{t('待填写结论', '結論入力待ち')}</span>
          <strong>{rows.filter(({ interview }) => interview?.stage === 'awaiting-decision').length}</strong>
          <small>{t('需要人工判断', '人の判断が必要')}</small>
        </article>
        <article>
          <span>{t('待安排复试', '再面談調整待ち')}</span>
          <strong>
            {
              rows.filter(
                ({ interview }) =>
                  interview?.roundNumber && interview.roundNumber > 1 && (interview.stage === 'new' || interview.stage === 'contacting')
              ).length
            }
          </strong>
          <small>{t('继承上一轮事项', '前回確認事項を継承')}</small>
        </article>
      </section>

      <section className="candidate-queue-panel">
        <div className="candidate-queue-toolbar">
          <div className="candidate-queue-filter-tabs">
            {[
              ['all', t('全部', 'すべて')],
              ['review', t('简历待查看', '履歴書確認待ち')],
              ['scheduled', t('已预约', '予約済み')],
              ['awaiting-decision', t('待结论', '結論待ち')]
            ].map(([value, label]) => (
              <button className={stage === value ? 'is-active' : ''} key={value} onClick={() => setStage(value)} type="button">
                {label}
              </button>
            ))}
          </div>
          <label className="candidate-queue-search">
            <Icon name="search" size={16} />
            <input
              aria-label={t('搜索招聘面试中的人员', '応募者を検索')}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('姓名、职种、技能', '氏名・職種・スキル')}
              value={query}
            />
          </label>
        </div>
        <div className="candidate-queue-result-meta">
          <strong>{t(`招聘面试中的人员（${filtered.length}）`, `応募者（${filtered.length}）`)}</strong>
          <span>{t('可先查看该人员的完整面试详情，再执行下一步', '応募者ごとの面談詳細を確認してから次の行動を進めます')}</span>
        </div>
        <div className="candidate-queue-table-wrap">
          <table className="candidate-queue-table is-interview-table">
            <thead>
              <tr>
                <th>{t('人员', '応募者')}</th>
                <th>{t('招聘阶段', '採用段階')}</th>
                <th>{t('面试时间', '面談日時')}</th>
                <th>{t('面试官', '面談者')}</th>
                <th>{t('职位/技能', '職種・スキル')}</th>
                <th>{t('来源', '出所')}</th>
                <th>{t('操作', '操作')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ review, interview }) => {
                const action = nextAction(interview, review, zh)
                return (
                  <tr key={review.documentId}>
                    <td>
                      <button
                        className="candidate-queue-person"
                        onClick={() => onOpenCandidate(review.documentId, 'overview', interview?.id ?? null, 'recruiting')}
                        type="button"
                      >
                        <span>{candidateName(review).slice(-1)}</span>
                        <span>
                          <strong>{candidateName(review)}</strong>
                          <small>{fieldValue(review, 'experience_years') ?? t('经验待确认', '経験未確認')}</small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <StatusPill label={stageLabel(interview, review, zh)} status={interview?.stage ?? 'review'} />
                    </td>
                    <td>
                      <strong>{formatDate(interview?.scheduledAt ?? null, locale)}</strong>
                      <small>{interview?.meetingMethod === 'zoom' ? 'Zoom' : (interview?.meetingMethod ?? '—')}</small>
                    </td>
                    <td>
                      <strong>{interview?.interviewer ?? t('待安排', '未設定')}</strong>
                      <small>
                        {interview?.roundNumber
                          ? interview.roundNumber === 1
                            ? t('初面', '一次面談')
                            : `${t('复试', '再面談')} ${interview.roundNumber - 1}`
                          : '—'}
                      </small>
                    </td>
                    <td>
                      <strong>{fieldValue(review, 'role') ?? t('职位待确认', '職種未確認')}</strong>
                      <div className="candidate-queue-skill-list">
                        {candidateSkills(review)
                          .slice(0, 2)
                          .map((skill) => (
                            <span key={skill}>{skill}</span>
                          ))}
                      </div>
                    </td>
                    <td>
                      <strong>{sourceLabel(review.fileName, zh)}</strong>
                      <small>{review.reviewerDisplayName ?? t('未分配负责人', '担当未設定')}</small>
                    </td>
                    <td>
                      <div className="candidate-queue-actions">
                        <button
                          className="candidate-queue-action"
                          onClick={() => onOpenCandidate(review.documentId, 'overview', interview?.id ?? null, 'recruiting')}
                          type="button"
                        >
                          {t('面试详情', '面談詳細')}
                        </button>
                        <button
                          className="candidate-queue-action is-primary"
                          onClick={() => onOpenCandidate(review.documentId, action.view, interview?.id ?? null, 'recruiting')}
                          type="button"
                        >
                          {action.label}
                          <Icon name="chevron-right" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 ? (
          <div className="candidate-queue-empty">
            <Icon name="check" size={26} />
            <strong>{t('当前筛选下没有待处理人员', 'この条件に対応待ち応募者はいません')}</strong>
            <span>{t('可以切换阶段，或导入新的简历。', '段階を切り替えるか、新しい履歴書を取り込んでください。')}</span>
          </div>
        ) : null}
      </section>
    </main>
  )
}
