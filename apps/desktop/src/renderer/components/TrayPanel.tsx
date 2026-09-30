import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { TrayAlert, TrayDesktopApi, TrayReadySummary, TrayRoute, TrayRoutePayload, TraySummary } from '@shared'
import './tray-panel.css'

type Text = (zh: string, ja: string) => string

const roundLabel = (round: number, t: Text) => t(round <= 3 ? `${['一', '二', '三'][round - 1]}面` : `${round} 面`, `${round}次面談`)

const tokyoTime = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))

const shortDay = (day: string) => {
  const [, month, date] = day.split('-')
  return `${Number(month)}/${Number(date)}`
}

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

const alertRoute = (alert: TrayAlert): TrayRoute => (alert === 'gmail-sync-failed' ? 'settings:integrations' : 'ai-member')

function Card({
  label,
  value,
  detail,
  onClick,
  children
}: {
  label: string
  value?: number
  detail: ReactNode
  onClick(): void
  children?: ReactNode
}) {
  return (
    <button className="tray-card" onClick={onClick} type="button">
      <span className="tray-card-label">{label}</span>
      {value !== undefined ? <strong className="tray-card-value">{value}</strong> : null}
      {children}
      <span className="tray-card-detail">{detail}</span>
    </button>
  )
}

const credits = (value: number, t: Text) => t(new Intl.NumberFormat('zh-CN').format(value), new Intl.NumberFormat('ja-JP').format(value))

function AiQuota({ summary, t }: { summary: TrayReadySummary; t: Text }) {
  const ai = summary.ai
  // The gateway refused the selected model: the balance alone would read as fine.
  const rejected = summary.alerts.includes('ai-request-rejected')
  const tone = rejected ? 'rejected' : ai.state
  const status = rejected
    ? t('额度不足以调用当前模型', '現在のモデルにはクレジットが足りません')
    : ai.state === 'unconfigured'
      ? t('未配置', '未設定')
      : ai.state === 'signed-out'
        ? t('未登录', '未ログイン')
        : ai.state === 'unknown' || ai.availableCredits === null
          ? t('未知', '不明')
          : ai.state === 'exhausted'
            ? t('已用完', '使い切り')
            : t(`剩余 ${credits(ai.availableCredits, t)}`, `残り ${credits(ai.availableCredits, t)}`)
  const available = ai.availableCredits
  return (
    <>
      <span
        aria-hidden="true"
        className={`tray-quota-bar is-${tone}`}
        style={{ ['--tray-quota' as string]: String(Math.round((ai.fraction ?? 0) * 100)) + '%' }}
      />
      <span className={`tray-card-status is-${tone}`}>{status}</span>
      {rejected && available !== null ? (
        <small className="tray-card-note">{t(`可用 ${credits(available, t)}`, `利用可能 ${credits(available, t)}`)}</small>
      ) : null}
      {ai.reservedCredits ? (
        <small className="tray-card-note">{t(`预留 ${credits(ai.reservedCredits, t)}`, `予約中 ${credits(ai.reservedCredits, t)}`)}</small>
      ) : null}
    </>
  )
}

/**
 * The menu-bar / system-tray quick panel. It only shows counts from Main's local summary and opens the main
 * window where each number came from; it never sends a question itself — 问 Agent only prefills the chat.
 */
export function TrayPanel({ api }: { api: TrayDesktopApi }) {
  const [summary, setSummary] = useState<TraySummary | null>(null)
  const [failed, setFailed] = useState(false)
  const [question, setQuestion] = useState('')
  const root = useRef<HTMLElement>(null)
  const zh = summary ? summary.locale === 'zh-CN' : navigator.language.toLowerCase().startsWith('zh')
  const t: Text = (cn, ja) => (zh ? cn : ja)

  useEffect(() => {
    let live = true
    const load = () => {
      void api
        .getTraySummary()
        .then((next) => {
          if (!live) return
          setSummary(next)
          setFailed(false)
        })
        .catch(() => {
          if (live) setFailed(true)
        })
    }
    load()
    const stop = api.onTraySummaryChanged((next) => {
      setSummary(next)
      setFailed(false)
    })
    // Each time the panel opens it takes focus: read the summary again.
    window.addEventListener('focus', load)
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') api.hide()
    }
    window.addEventListener('keydown', escape)
    return () => {
      live = false
      stop()
      window.removeEventListener('focus', load)
      window.removeEventListener('keydown', escape)
    }
  }, [api])

  useEffect(() => {
    document.documentElement.lang = zh ? 'zh-CN' : 'ja'
    document.documentElement.dataset.locale = zh ? 'zh-CN' : 'ja-JP'
  }, [zh])

  // The window is as tall as its content (Main clamps it to the screen and the panel maximum).
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const report = () => api.resize(Math.ceil(element.getBoundingClientRect().height))
    report()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(report)
    observer.observe(element)
    return () => observer.disconnect()
  }, [api, summary, failed])

  const open = (route: TrayRoute, payload?: Omit<TrayRoutePayload, 'text'>) => void api.openMain(route, payload).catch(() => undefined)
  const ask = (event: FormEvent) => {
    event.preventDefault()
    const text = question.trim()
    if (!text) return
    void api
      .askAgent(text)
      .then(() => setQuestion(''))
      .catch(() => undefined)
  }

  const header = (
    <header className="tray-header">
      <strong>SES Agent</strong>
      {summary?.status === 'ready' ? <span>{t(`今天 ${shortDay(summary.today)}`, `今日 ${shortDay(summary.today)}`)}</span> : null}
    </header>
  )

  if (!summary || summary.status === 'not-ready') {
    const notReady = summary?.status === 'not-ready' || failed
    return (
      <main aria-label="SES Agent" className={`tray-panel${notReady ? ' is-not-ready' : ' is-loading'}`} ref={root}>
        {header}
        {notReady ? (
          <section className="tray-not-ready" role="status">
            <strong>{t('应用未就绪', 'アプリの準備ができていません')}</strong>
            <p>
              {t('暂时无法读取本机数据。打开 SES Agent 查看详情。', 'ローカルデータを読み込めません。SES Agent を開いて確認してください。')}
            </p>
          </section>
        ) : (
          <p className="tray-loading" role="status">
            {t('正在读取…', '読み込み中…')}
          </p>
        )}
        <footer className="tray-actions">
          <button className="is-primary" onClick={() => open('cases')} type="button">
            {t('打开 SES Agent', 'SES Agent を開く')}
          </button>
        </footer>
      </main>
    )
  }

  const next = summary.interviews.next
  const due = summary.followUpsDueToday
  return (
    <main aria-label="SES Agent" className="tray-panel" ref={root}>
      {header}
      <form className="tray-ask" onSubmit={ask}>
        <input
          aria-label={t('问 Agent', 'Agent に質問')}
          maxLength={2000}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t('问 Agent…', 'Agent に質問…')}
          value={question}
        />
        <button aria-label={t('在 Agent 中打开', 'Agent で開く')} disabled={!question.trim()} type="submit">
          ↑
        </button>
      </form>
      <button className="tray-headline" onClick={() => open('followups', { followUpFilter: 'today' })} type="button">
        {due > 0 ? t(`${due} 件今天要跟进`, `今日の対応 ${due} 件`) : t('今天没有要跟进的事项', '今日の対応はありません')}
      </button>
      <div className="tray-cards">
        <Card
          detail={t(`未读 ${summary.cases.unseen}`, `未読 ${summary.cases.unseen}`)}
          label={t('新案件', '新着案件')}
          onClick={() => open('cases', { caseView: 'unseen' })}
          value={summary.cases.newToday}
        />
        <Card
          detail={t(`可以提案 ${summary.matching.proposable}`, `提案可能 ${summary.matching.proposable}`)}
          label={t('新匹配机会', '新しいマッチング候補')}
          onClick={() => open('cases', { caseView: 'opportunities' })}
          value={summary.matching.newOpportunities}
        />
        <Card
          detail={t(`今天面试 ${summary.interviews.today}`, `今日の面談 ${summary.interviews.today}`)}
          label={t('待约面', '日程調整中')}
          onClick={() => open('followups', { followUpFilter: 'today' })}
          value={summary.interviews.coordinating}
        />
        <Card detail={null} label={t('AI 额度', 'AI クレジット')} onClick={() => open('ai-member')}>
          <AiQuota summary={summary} t={t} />
        </Card>
      </div>
      {next ? (
        <button className="tray-upcoming" onClick={() => open('followups', { followUpFilter: 'today' })} type="button">
          <time dateTime={next.at}>{tokyoTime(next.at)}</time>
          <span>
            {roundLabel(next.roundNumber, t)} · {next.caseTitle || t('案件', '案件')}
          </span>
          <small>{summary.showPersonNames && next.personName ? next.personName : t('1 名人员', '要員 1 名')}</small>
        </button>
      ) : (
        <p className="tray-upcoming is-empty">
          {summary.interviews.today > 0
            ? t('今天的面试已全部结束', '今日の面談はすべて終わりました')
            : t('今天没有面试安排', '今日の面談予定はありません')}
        </p>
      )}
      {summary.alerts.length ? (
        <ul aria-label={t('需要处理的提醒', '対応が必要なお知らせ')} className="tray-alerts">
          {summary.alerts.map((alert) =>
            alert === 'ai-request-rejected' ? (
              <li className="tray-alert-detail" key={alert}>
                <p>
                  {t(
                    `最近一次 AI 调用因额度不足被拒绝（${summary.aiRejectedModel ?? 'AI'}）。可用额度不够该模型单次预留，可在设置中换用更省的模型，或到 AI 会员中心充值。`,
                    `直近の AI 呼び出しはクレジット不足で拒否されました（${summary.aiRejectedModel ?? 'AI'}）。利用可能なクレジットがこのモデルの 1 回分の予約に足りません。設定でより安価なモデルに切り替えるか、AI 会員センターでチャージしてください。`
                  )}
                </p>
                <span>
                  <button onClick={() => open('settings:models')} type="button">
                    {t('换模型', 'モデルを変更')}
                  </button>
                  <button onClick={() => open('ai-member')} type="button">
                    {t('充值', 'チャージ')}
                  </button>
                </span>
              </li>
            ) : (
              <li key={alert}>
                <button onClick={() => open(alertRoute(alert))} type="button">
                  {alertText(alert, t)}
                </button>
              </li>
            )
          )}
        </ul>
      ) : null}
      <p className="tray-week">
        {t(
          `本周：新增 ${summary.week.casesCreated} 案件，推荐 ${summary.week.recommended} 人，进场 ${summary.week.started} 人`,
          `今週：新規案件 ${summary.week.casesCreated} 件・推薦 ${summary.week.recommended} 名・参画 ${summary.week.started} 名`
        )}
      </p>
      <footer className="tray-actions">
        <button onClick={() => open('cases:new')} type="button">
          {t('新增案件', '案件を追加')}
        </button>
        <button onClick={() => open('people:import')} type="button">
          {t('导入简历', '履歴書を取り込む')}
        </button>
        <button className="is-primary" onClick={() => open('cases')} type="button">
          {t('打开 SES Agent', 'SES Agent を開く')}
        </button>
      </footer>
    </main>
  )
}
