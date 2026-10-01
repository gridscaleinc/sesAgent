import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type {
  ApplicationLocale,
  TodayFollowUpItem,
  TodayInterviewItem,
  TodayOpportunityItem,
  TodayReadySummary,
  TodaySummary,
  TrayAlert,
  TrayRoute,
  TrayRoutePayload
} from '@shared'
import { Icon } from './Icon'
import { useLocaleText } from '../i18n'
import './today-overview.css'

type Text = (zh: string, ja: string) => string

export interface TodaySummaryState {
  summary: TodaySummary | null
  failed: boolean
  reload(): void
}

/**
 * Reads the 「今天」 summary from Main (local data only) and follows its updates. Without the bridge (an older
 * preload) it stays empty. The page and the rail badge share it.
 */
export function useTodaySummary(enabled: boolean, locale: ApplicationLocale): TodaySummaryState {
  const [summary, setSummary] = useState<TodaySummary | null>(null)
  const [failed, setFailed] = useState(false)
  const [request, setRequest] = useState(0)
  const reload = useCallback(() => setRequest((value) => value + 1), [])

  useEffect(() => {
    const api = window.sesAgent
    if (!enabled || !api.getTodaySummary) return undefined
    let live = true
    void api
      .getTodaySummary()
      .then((next) => {
        if (!live) return
        setSummary(next)
        setFailed(false)
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
    // The labels Main writes follow the language: read again when it changes.
  }, [enabled, locale, request])

  useEffect(() => {
    const api = window.sesAgent
    if (!enabled || !api.onTodaySummaryChanged) return undefined
    return api.onTodaySummaryChanged((next) => {
      setSummary(next)
      setFailed(false)
    })
  }, [enabled])

  // Data the app itself changed (a follow-up recorded, a case read) shows here without waiting for Main's poll.
  useEffect(() => {
    if (!enabled) return undefined
    window.addEventListener('ses-business-data-changed', reload)
    return () => window.removeEventListener('ses-business-data-changed', reload)
  }, [enabled, reload])

  return { summary, failed, reload }
}

const weekdays: Array<[string, string]> = [
  ['周日', '日'],
  ['周一', '月'],
  ['周二', '火'],
  ['周三', '水'],
  ['周四', '木'],
  ['周五', '金'],
  ['周六', '土']
]

/** 「今天 9/30（周三）」 for a Tokyo business day YYYY-MM-DD. */
export function todayHeading(day: string, t: Text): string {
  const [year, month, date] = day.split('-').map(Number)
  const [zhDay, jaDay] = weekdays[new Date(Date.UTC(year!, month! - 1, date!)).getUTCDay()]!
  return t(`今天 ${month}/${date}（${zhDay}）`, `今日 ${month}/${date}（${jaDay}）`)
}

/** 「3 件跟进要处理，1 场面试」 */
export function todayHeadline(summary: TodayReadySummary, t: Text): string {
  const due = summary.followUpsDueToday
  const interviews = summary.interviews.today
  if (!due && !interviews) return t('今天没有要跟进的事项，也没有面试', '今日の対応も面談もありません')
  const parts = [
    due ? t(`${due} 件跟进要处理`, `対応 ${due} 件`) : t('没有要跟进的事项', '対応なし'),
    interviews ? t(`${interviews} 场面试`, `面談 ${interviews} 件`) : t('没有面试', '面談なし')
  ]
  return parts.join(t('，', '・'))
}

const tokyoTime = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))

/** A step's time: the clock time for an interview, the day for a planned entry (YYYY-MM-DD). */
function whenLabel(value: string, today: string, t: Text): string {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const [, month, date] = value.split('-').map(Number)
    return value === today ? t('今天', '今日') : `${month}/${date}`
  }
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(value)
  )
  if (day === today) return tokyoTime(value)
  const [, month, date] = day.split('-').map(Number)
  return `${month}/${date} ${tokyoTime(value)}`
}

const roundLabel = (round: number, t: Text) => t(round <= 3 ? `${['一', '二', '三'][round - 1]}面` : `${round} 面`, `${round}次面談`)

function alertText(alert: TrayAlert, t: Text): string {
  switch (alert) {
    case 'ai-credits-exhausted':
      return t('AI 额度已用完', 'AI クレジットを使い切りました')
    case 'ai-credits-low':
      return t('AI 额度不足', 'AI クレジットが残りわずかです')
    case 'ai-signed-out':
      return t('AI 未登录', 'AI 未ログイン')
    case 'ai-request-rejected':
      return t('AI 调用因额度不足被拒绝', 'AI の呼び出しがクレジット不足で拒否されました')
    case 'gmail-sync-failed':
      return t('Gmail 同步失败', 'Gmail の同期に失敗しました')
    case 'privacy-gate-blocked':
      return t('云端 AI 被隐私门拦截', 'クラウド AI はプライバシーゲートで停止中です')
  }
}

function alertAction(alert: TrayAlert, t: Text): { route: TrayRoute; label: string } {
  switch (alert) {
    case 'gmail-sync-failed':
      return { route: 'settings:integrations', label: t('检查连接', '接続を確認') }
    case 'ai-signed-out':
      return { route: 'ai-member', label: t('去登录', 'ログイン') }
    case 'privacy-gate-blocked':
      return { route: 'ai-member', label: t('查看', '確認') }
    default:
      return { route: 'ai-member', label: t('充值', 'チャージ') }
  }
}

const credits = (value: number, zh: boolean) => new Intl.NumberFormat(zh ? 'zh-CN' : 'ja-JP').format(value)

function aiStatus(summary: TodayReadySummary, t: Text, zh: boolean): { tone: string; text: string } {
  const ai = summary.ai
  if (summary.alerts.includes('ai-request-rejected'))
    return { tone: 'rejected', text: t('额度不足以调用当前模型', '現在のモデルにはクレジットが足りません') }
  if (ai.state === 'unconfigured') return { tone: ai.state, text: t('未配置', '未設定') }
  if (ai.state === 'signed-out') return { tone: ai.state, text: t('未登录', '未ログイン') }
  if (ai.state === 'unknown' || ai.availableCredits === null) return { tone: 'unknown', text: t('未知', '不明') }
  if (ai.state === 'exhausted') return { tone: ai.state, text: t('已用完', '使い切り') }
  return { tone: ai.state, text: t(`剩余 ${credits(ai.availableCredits, zh)} 点`, `残り ${credits(ai.availableCredits, zh)} クレジット`) }
}

function Block({
  title,
  count,
  more,
  children
}: {
  title: string
  count?: number
  more?: { label: string; onClick(): void }
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="today-block">
      <header>
        <h2>
          {title}
          {count ? <span className="today-block-count">{count}</span> : null}
        </h2>
        {more ? (
          <button className="today-link" onClick={more.onClick} type="button">
            {more.label}
          </button>
        ) : null}
      </header>
      {children}
    </section>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <p className="today-empty">{children}</p>

export interface TodayOverviewProps {
  state: TodaySummaryState
  /** Opens one follow-up in 跟进. */
  onOpenFollowUp(target: { documentId: string; reviewId: string }): void
  /** Opens 跟进 on its 「今天要做」 filter. */
  onOpenFollowUps(): void
  /** Opens a 招聘面试 (one outside any follow-up) for that person; its row is not a link without it. */
  onOpenRecruitingInterview?(documentId: string): void
  /** The 待约面 card opens the follow-ups waiting for an interview date. */
  onOpenCoordinating?(): void
  /** Opens the results of one new opportunity, as the 新匹配机会 page does. */
  onOpenOpportunity(item: TodayOpportunityItem): void
  onOpenOpportunities(): void
  /** Opens a case in the case list, with its detail. */
  onOpenCase(reviewId: string): void
  onOpenUnseenCases(): void
  /** The places the menu-bar panel opens: AI member, settings. */
  onNavigate(route: TrayRoute, payload?: Omit<TrayRoutePayload, 'text'>): void
  /** Prefills the Agent composer; never sends. */
  onAsk(text: string): void
}

/**
 * 「今天」: the menu-bar summary as a page. Every number and row opens the screen it came from; nothing here
 * changes data or calls the cloud AI.
 */
export function TodayOverview({
  state,
  onOpenFollowUp,
  onOpenFollowUps,
  onOpenRecruitingInterview,
  onOpenCoordinating,
  onOpenOpportunity,
  onOpenOpportunities,
  onOpenCase,
  onOpenUnseenCases,
  onNavigate,
  onAsk
}: TodayOverviewProps) {
  const { zh, t } = useLocaleText()
  const [question, setQuestion] = useState('')
  const { summary, failed } = state

  const ask = (event: FormEvent) => {
    event.preventDefault()
    const text = question.trim()
    if (!text) return
    onAsk(text)
    setQuestion('')
  }

  const askForm = (
    <form className="today-ask" onSubmit={ask}>
      <Icon name="sparkles" size={15} />
      <input
        aria-label={t('问 Agent', 'Agent に質問')}
        maxLength={2000}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder={t('问 Agent…', 'Agent に質問…')}
        value={question}
      />
      <button aria-label={t('在 Agent 中打开', 'Agent で開く')} disabled={!question.trim()} type="submit">
        <Icon name="arrow-up" size={14} />
      </button>
    </form>
  )

  if (!summary || summary.status !== 'ready') {
    const notReady = summary?.status === 'not-ready' || failed
    return (
      <section aria-label={t('今天', '今日')} className="today-page">
        <div className="today-scroll">
          <header className="today-header">
            <h1>{t('今天', '今日')}</h1>
          </header>
          {askForm}
          {notReady ? (
            <section className="today-not-ready" role="status">
              <strong>{t('暂时无法读取今天的概况', '今日の概要を読み込めません')}</strong>
              <p>{t('本机数据暂不可用，稍后会自动重试。', 'ローカルデータを読み込めません。しばらくすると自動で再試行します。')}</p>
              <button className="today-link" onClick={state.reload} type="button">
                {t('重试', '再試行')}
              </button>
            </section>
          ) : (
            <p className="today-empty" role="status">
              {t('正在读取…', '読み込み中…')}
            </p>
          )}
        </div>
      </section>
    )
  }

  const lists = summary.lists
  const ai = aiStatus(summary, t, zh)
  const followUpRow = (item: TodayFollowUpItem) => (
    <li key={item.id}>
      <button className="today-row" onClick={() => onOpenFollowUp(item)} type="button">
        <span className="today-row-main">
          <strong>{item.personName ?? t('人员', '要員')}</strong>
          <span>{item.caseTitle || t('案件', '案件')}</span>
        </span>
        <span className="today-row-meta">
          <span className={`today-stage is-${item.stage}`}>{item.stageLabel}</span>
          <span className="today-row-action">{item.action}</span>
          {item.when ? <time dateTime={item.when}>{whenLabel(item.when, summary.today, t)}</time> : null}
        </span>
      </button>
    </li>
  )
  const interviewRow = (item: TodayInterviewItem) => {
    const over = Date.parse(item.at) + item.durationMinutes * 60_000 <= Date.now()
    return (
      <li key={`${item.followUpId ?? `recruiting:${item.documentId}`}:${item.roundNumber}`}>
        <button
          className={`today-row${over ? ' is-past' : ''}`}
          disabled={item.kind === 'recruiting' && !onOpenRecruitingInterview}
          onClick={() =>
            item.reviewId
              ? onOpenFollowUp({ documentId: item.documentId, reviewId: item.reviewId })
              : onOpenRecruitingInterview?.(item.documentId)
          }
          type="button"
        >
          <time className="today-row-time" dateTime={item.at}>
            {tokyoTime(item.at)}
          </time>
          <span className="today-row-main">
            <strong>{item.personName ?? t('人员', '要員')}</strong>
            <span>{item.caseTitle || t('案件', '案件')}</span>
          </span>
          <span className="today-row-meta">
            <span className="today-stage">{roundLabel(item.roundNumber, t)}</span>
            {over ? <span className="today-row-action">{t('已结束', '終了')}</span> : null}
          </span>
        </button>
      </li>
    )
  }
  const opportunityRow = (item: TodayOpportunityItem) => (
    <li key={item.id}>
      <button className="today-row" onClick={() => onOpenOpportunity(item)} type="button">
        <span className="today-row-main">
          <strong>{item.personName}</strong>
          <span>{item.caseTitle}</span>
        </span>
        <span className="today-row-meta">
          {item.confirm.length ? (
            <span className="today-confirm">
              {t(`待补充：${item.confirm.slice(0, 2).join('、')}`, `要確認：${item.confirm.slice(0, 2).join('、')}`)}
            </span>
          ) : null}
          <span className="today-score">{t(`${Math.round(item.score)} 分`, `${Math.round(item.score)} 点`)}</span>
        </span>
      </button>
    </li>
  )
  const opportunityCount = lists.opportunities.proposable.length + lists.opportunities.needsInfo.length

  return (
    <section aria-label={t('今天', '今日')} className="today-page">
      <div className="today-scroll">
        <header className="today-header">
          <h1>{todayHeading(summary.today, t)}</h1>
          <button className="today-headline" onClick={onOpenFollowUps} type="button">
            {todayHeadline(summary, t)}
          </button>
        </header>
        {summary.alerts.length ? (
          <ul aria-label={t('需要处理的提醒', '対応が必要なお知らせ')} className="today-alerts">
            {summary.alerts.map((alert) =>
              alert === 'ai-request-rejected' ? (
                <li key={alert}>
                  <Icon name="alert" size={14} />
                  <span>
                    {t(
                      `最近一次 AI 调用因额度不足被拒绝（${summary.aiRejectedModel ?? 'AI'}）。可在设置中换用更省的模型，或到 AI 会员中心充值。`,
                      `直近の AI 呼び出しはクレジット不足で拒否されました（${summary.aiRejectedModel ?? 'AI'}）。設定でより安価なモデルに切り替えるか、AI 会員センターでチャージしてください。`
                    )}
                  </span>
                  <button onClick={() => onNavigate('settings:models')} type="button">
                    {t('换模型', 'モデルを変更')}
                  </button>
                  <button onClick={() => onNavigate('ai-member')} type="button">
                    {t('充值', 'チャージ')}
                  </button>
                </li>
              ) : (
                <li key={alert}>
                  <Icon name="alert" size={14} />
                  <span>{alertText(alert, t)}</span>
                  <button onClick={() => onNavigate(alertAction(alert, t).route)} type="button">
                    {alertAction(alert, t).label}
                  </button>
                </li>
              )
            )}
          </ul>
        ) : null}
        {askForm}
        <div aria-label={t('今天的数字', '今日の数字')} className="today-stats" role="group">
          <button className="today-stat" onClick={onOpenUnseenCases} type="button">
            {/* The number is what the button opens (the unread cases); today's arrivals are the detail. */}
            <span className="today-stat-label">{t('新案件', '新着案件')}</span>
            <strong>{summary.cases.unseen}</strong>
            <span className="today-stat-detail">{t(`今天新到 ${summary.cases.newToday}`, `本日着 ${summary.cases.newToday}`)}</span>
          </button>
          <button className="today-stat" onClick={onOpenOpportunities} type="button">
            <span className="today-stat-label">{t('新匹配机会', '新しいマッチング候補')}</span>
            <strong>{summary.matching.newOpportunities}</strong>
            <span className="today-stat-detail">
              {t(`共 ${summary.matching.proposable} 组可以提案`, `提案可能 計${summary.matching.proposable}組`)}
            </span>
          </button>
          <button className="today-stat" onClick={onOpenCoordinating ?? onOpenFollowUps} type="button">
            <span className="today-stat-label">{t('待约面', '日程調整中')}</span>
            <strong>{summary.interviews.coordinating}</strong>
            <span className="today-stat-detail">{t(`今天面试 ${summary.interviews.today}`, `今日の面談 ${summary.interviews.today}`)}</span>
          </button>
          <button className="today-stat" onClick={() => onNavigate('ai-member')} type="button">
            <span className="today-stat-label">{t('AI 额度', 'AI クレジット')}</span>
            <span
              aria-hidden="true"
              className={`today-quota-bar is-${ai.tone}`}
              style={{ ['--today-quota' as string]: `${Math.round((summary.ai.fraction ?? 0) * 100)}%` }}
            />
            <span className={`today-stat-detail is-${ai.tone}`}>{ai.text}</span>
          </button>
        </div>
        <div className="today-columns">
          <div className="today-column">
            <Block
              count={summary.followUpsDueToday}
              more={
                summary.followUpsDueToday > lists.followUps.length
                  ? {
                      label: t(`查看全部 ${summary.followUpsDueToday} 件`, `すべて見る（${summary.followUpsDueToday} 件）`),
                      onClick: onOpenFollowUps
                    }
                  : undefined
              }
              title={t('今天要跟进', '今日の対応')}
            >
              {lists.followUps.length ? (
                <ul className="today-list">{lists.followUps.map(followUpRow)}</ul>
              ) : (
                <Empty>{t('今天没有要跟进的事项。', '今日の対応はありません。')}</Empty>
              )}
            </Block>
            <Block
              count={summary.interviews.today}
              // The list shows the first ones; the schedule center has the whole day.
              more={
                summary.interviews.today > lists.interviews.length
                  ? {
                      label: t(`查看全部 ${summary.interviews.today} 场`, `すべて見る（${summary.interviews.today} 件）`),
                      onClick: () => onNavigate('interview-schedule')
                    }
                  : undefined
              }
              title={t('今天的面试', '今日の面談')}
            >
              {lists.interviews.length ? (
                <ul className="today-list">{lists.interviews.map(interviewRow)}</ul>
              ) : (
                <Empty>{t('今天没有面试安排。', '今日の面談予定はありません。')}</Empty>
              )}
            </Block>
          </div>
          <div className="today-column">
            <Block
              count={summary.matching.newOpportunities}
              more={
                opportunityCount || summary.matching.proposable
                  ? { label: t('查看全部', 'すべて見る'), onClick: onOpenOpportunities }
                  : undefined
              }
              title={t('值得先看的匹配机会', '先に見たいマッチング候補')}
            >
              {opportunityCount ? (
                <>
                  {lists.opportunities.proposable.length ? (
                    <>
                      <h3 className="today-subhead is-proposable">{t('可以提案', '提案可能')}</h3>
                      <ul className="today-list">{lists.opportunities.proposable.map(opportunityRow)}</ul>
                    </>
                  ) : null}
                  {lists.opportunities.needsInfo.length ? (
                    <>
                      <h3 className="today-subhead">{t('待确认', '確認待ち')}</h3>
                      <ul className="today-list">{lists.opportunities.needsInfo.map(opportunityRow)}</ul>
                    </>
                  ) : null}
                </>
              ) : (
                <Empty>
                  {summary.matching.proposable
                    ? t(
                        `没有新的匹配机会；之前看过的里还有 ${summary.matching.proposable} 组可以提案。`,
                        `新しい候補はありません。確認済みの中に提案可能な組み合わせが ${summary.matching.proposable} 組あります。`
                      )
                    : t('暂时没有新的匹配机会。', '新しいマッチング候補はまだありません。')}
                </Empty>
              )}
            </Block>
            <Block
              count={summary.cases.unseen}
              more={summary.cases.unseen ? { label: t('查看全部未读', '未読をすべて見る'), onClick: onOpenUnseenCases } : undefined}
              title={t('新案件', '新着案件')}
            >
              {lists.unseenCases.length ? (
                <ul className="today-list">
                  {lists.unseenCases.map((item) => (
                    <li key={item.reviewId}>
                      <button className="today-row" onClick={() => onOpenCase(item.reviewId)} type="button">
                        <span className="today-row-main">
                          <strong>{item.title || t('案件', '案件')}</strong>
                        </span>
                        <span className="today-row-meta">
                          <time dateTime={item.sourceAt}>{whenLabel(item.sourceAt, summary.today, t)}</time>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>{t('没有未读的新案件。', '未読の新着案件はありません。')}</Empty>
              )}
            </Block>
          </div>
        </div>
        <section aria-label={t('本周简报', '今週のまとめ')} className="today-week">
          <h2>{t('本周简报', '今週のまとめ')}</h2>
          <dl>
            <div>
              <dt>{t('新增案件', '新規案件')}</dt>
              <dd>{summary.week.casesCreated}</dd>
            </div>
            <div>
              <dt>{t('推荐人员', '推薦')}</dt>
              <dd>{summary.week.recommended}</dd>
            </div>
            <div>
              <dt>{t('进场', '参画')}</dt>
              <dd>{summary.week.started}</dd>
            </div>
          </dl>
        </section>
      </div>
    </section>
  )
}
