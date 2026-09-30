import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ApplicationLocale, MatchingOpportunity } from '@shared'
import { localeText, localizedIpcError, useLocaleText } from '../i18n'
import { ActionMenu } from './HrObjectList'
import { MatchBackButton, MatchResultsPage } from './MatchResultsLayout'
import './matching-opportunities.css'

export type OpportunityGrouping = 'case' | 'person'
const groupingKey = 'ses-opportunities-group-v1'
const refreshMs = 20000

export interface MatchingOpportunitiesState {
  rows: MatchingOpportunity[]
  /** Rows not opened yet; the banner shows this count. */
  newCount: number
  /** New rows whose local conclusion is 可以提案. */
  newRecommendedCount: number
  loaded: boolean
  loadError: string
  actionError: string
  busy: boolean
  reload(): void
  /** Sends 'seen' or 'dismissed' to Main; resolves false when Main refused it (e.g. the recommendation changed). */
  control(item: MatchingOpportunity, action: 'seen' | 'dismissed'): Promise<boolean>
}

/** The background opportunities, polled while the HR shell is visible and refreshed when business data changes. */
export function useMatchingOpportunities(active: boolean, locale: ApplicationLocale): MatchingOpportunitiesState {
  // Called above the locale provider, so the locale comes in as an argument.
  const t = localeText(locale === 'zh-CN')
  const [rows, setRows] = useState<MatchingOpportunity[]>([]),
    [loaded, setLoaded] = useState(false),
    [loadError, setLoadError] = useState(''),
    [actionError, setActionError] = useState(''),
    [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const reload = useCallback(() => {
    if (!window.sesAgent.listMatchingOpportunities) return
    void window.sesAgent
      .listMatchingOpportunities()
      .then((value) => {
        if (!live.current) return
        setRows(value)
        setLoadError('')
        setLoaded(true)
      })
      .catch((cause) => {
        if (!live.current) return
        setLoadError(localizedIpcError(locale, cause, t('无法读取匹配机会。', 'マッチング候補を読み込めませんでした。')))
        setLoaded(true)
      })
  }, [locale])
  useEffect(() => {
    if (!active) return
    reload()
    const timer = setInterval(reload, refreshMs)
    window.addEventListener('ses-business-data-changed', reload)
    return () => {
      clearInterval(timer)
      window.removeEventListener('ses-business-data-changed', reload)
    }
  }, [active, reload])
  const control = async (item: MatchingOpportunity, action: 'seen' | 'dismissed') => {
    if (lock.current) return false
    lock.current = true
    setBusy(true)
    setActionError('')
    try {
      const next = await window.sesAgent.controlMatchingOpportunity({ id: item.id, fingerprint: item.fingerprint, action })
      if (live.current) setRows(next)
      return true
    } catch (cause) {
      if (live.current)
        setActionError(localizedIpcError(locale, cause, t('操作失败，请重试。', '操作に失敗しました。もう一度お試しください。')))
      return false
    } finally {
      lock.current = false
      if (live.current) setBusy(false)
    }
  }
  return {
    rows,
    newCount: rows.filter((row) => row.state === 'new').length,
    newRecommendedCount: rows.filter((row) => row.state === 'new' && row.status === 'recommended').length,
    loaded,
    loadError,
    actionError,
    busy,
    reload,
    control
  }
}

/** One quiet line above the case and person lists; hidden while nothing new was found. */
export function MatchingOpportunitiesBanner({
  count,
  recommended = 0,
  onOpen
}: {
  count: number
  /** How many of the new ones can be proposed; the parenthetical is hidden at zero. */
  recommended?: number
  onOpen(): void
}) {
  const { t } = useLocaleText()
  if (count <= 0) return null
  return (
    <div className="opportunity-banner" role="status">
      <span className="opportunity-banner-dot" aria-hidden="true" />
      <span>
        {t('新匹配机会', '新しいマッチング候補')} <strong>{count}</strong>
        {recommended > 0 ? t(`（可以提案 ${recommended}）`, `（提案可能 ${recommended}）`) : null}
      </span>
      <button type="button" onClick={onOpen} aria-label={t(`查看新匹配机会（${count}）`, `新しいマッチング候補を見る（${count}）`)}>
        {t('查看', '見る')} →
      </button>
    </div>
  )
}

const tokyoDay = (value: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
/** 今天 / 昨天 / 9/28 in Tokyo time; another year adds the year. */
export function opportunityDay(value: string, t: (cn: string, ja: string) => string, now = new Date()) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const day = tokyoDay(date)
  if (day === tokyoDay(now)) return t('今天', '今日')
  if (day === tokyoDay(new Date(now.getTime() - 86400000))) return t('昨天', '昨日')
  const [year, month, date_] = day.split('-').map(Number)
  return year === Number(tokyoDay(now).slice(0, 4)) ? `${month}/${date_}` : `${year}/${month}/${date_}`
}

function readGrouping(fallback: OpportunityGrouping): OpportunityGrouping {
  try {
    const value = localStorage.getItem(groupingKey)
    return value === 'case' || value === 'person' ? value : fallback
  } catch {
    return fallback
  }
}

interface Group {
  key: string
  title: string
  rows: MatchingOpportunity[]
}
function groupRows(rows: MatchingOpportunity[], by: OpportunityGrouping): Group[] {
  const groups = new Map<string, Group>()
  for (const row of rows) {
    const key = by === 'case' ? row.reviewId || row.jobCaseId : row.documentId
    const group = groups.get(key) ?? { key, title: by === 'case' ? row.caseTitle : row.personName, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function OpportunityRow({
  row,
  by,
  busy,
  onOpen,
  onDismiss
}: {
  row: MatchingOpportunity
  by: OpportunityGrouping
  busy: boolean
  onOpen(): void
  onDismiss(): void
}) {
  const { t } = useLocaleText()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const title = by === 'case' ? row.personName : row.caseTitle
  const reasons = row.reasons.slice(0, 4)
  const confirmId = `opportunity-confirm-${row.id}`
  return (
    <li className={`opportunity-row${row.state === 'new' ? ' is-new' : ''}`}>
      <div className="opportunity-row-line">
        <div className="opportunity-row-main">
          <span className="opportunity-row-head">
            <strong title={title}>{title}</strong>
            {row.state === 'new' ? <span className="match-tag">{t('新', '新着')}</span> : null}
          </span>
          <span className="match-chips">
            {reasons.map((reason) => (
              <span key={reason} className="match-chip is-met" title={reason}>
                ✓ {reason}
              </span>
            ))}
            {row.reasons.length > reasons.length ? (
              <span className="match-chip is-more" title={row.reasons.slice(4).join(' · ')}>
                +{row.reasons.length - reasons.length}
              </span>
            ) : null}
            {row.confirm.length ? (
              <button
                type="button"
                className="match-chip is-unknown opportunity-confirm-toggle"
                aria-expanded={confirmOpen}
                aria-controls={confirmId}
                onClick={() => setConfirmOpen((value) => !value)}
              >
                {t(`待确认 ${row.confirm.length}`, `要確認 ${row.confirm.length}`)} {confirmOpen ? '▴' : '▾'}
              </button>
            ) : null}
          </span>
        </div>
        <time className="opportunity-row-time" dateTime={row.updatedAt}>
          {opportunityDay(row.updatedAt, t)}
        </time>
        <div className="opportunity-row-actions">
          <button type="button" className="hr-primary" disabled={busy} onClick={onOpen}>
            {t('查看匹配', 'マッチングを見る')}
          </button>
          <ActionMenu
            label={t(`更多操作：${row.personName} · ${row.caseTitle}`, `その他の操作：${row.personName} · ${row.caseTitle}`)}
            triggerClassName="match-menu-trigger"
            trigger={<span aria-hidden="true">⋯</span>}
          >
            <button role="menuitem" type="button" disabled={busy} onClick={onDismiss}>
              {t('暂不关注此组合', 'この組み合わせを非表示')}
            </button>
          </ActionMenu>
        </div>
      </div>
      {row.confirm.length ? (
        <ul id={confirmId} className="opportunity-confirm" hidden={!confirmOpen} aria-label={t('待确认事项', '要確認事項')}>
          {row.confirm.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/**
 * 新匹配机会 as its own page in the HR main area: grouped by case or by person, one compact row per pair.
 * It stays mounted while a result opened from it is shown, so the grouping and scroll survive the way back.
 */
export function MatchingOpportunitiesPage({
  state,
  visible,
  defaultGrouping,
  backLabel,
  onBack,
  onOpen
}: {
  state: MatchingOpportunitiesState
  visible: boolean
  /** Used until the operator picks a grouping; the last pick is remembered. */
  defaultGrouping: OpportunityGrouping
  backLabel: string
  onBack(): void
  /** Called only after Main accepted the 'seen' mark for this exact recommendation. */
  onOpen(item: MatchingOpportunity, grouping: OpportunityGrouping): void
}) {
  const { t } = useLocaleText()
  const [grouping, setGrouping] = useState<OpportunityGrouping>(() => readGrouping(defaultGrouping))
  const picked = useRef(false)
  const scroller = useRef<HTMLDivElement>(null)
  const scrollTop = useRef(0)
  useLayoutEffect(() => {
    if (!visible) return
    // Until the operator picks a grouping, the page follows the list it was opened from.
    if (!picked.current) setGrouping(readGrouping(defaultGrouping))
    if (scroller.current) scroller.current.scrollTop = scrollTop.current
  }, [visible, defaultGrouping])
  const choose = (value: OpportunityGrouping) => {
    picked.current = true
    setGrouping(value)
    scrollTop.current = 0
    if (scroller.current) scroller.current.scrollTop = 0
    try {
      localStorage.setItem(groupingKey, value)
    } catch {}
  }
  const open = async (item: MatchingOpportunity) => {
    if (await state.control(item, 'seen')) onOpen(item, grouping)
  }
  // 可以提案 first, then the pairs still missing core information; an empty section is not shown.
  const sections = [
    { key: 'recommended', title: t('可以提案', '提案可能'), rows: state.rows.filter((row) => row.status === 'recommended') },
    {
      key: 'needs-confirmation',
      title: t('核心信息待补充', 'コア情報の補足が必要'),
      rows: state.rows.filter((row) => row.status !== 'recommended')
    }
  ].filter((section) => section.rows.length)
  const header = (
    <>
      <MatchBackButton label={backLabel} onClick={onBack} />
      <h2 className="match-page-title">
        {t('新匹配机会', '新しいマッチング候補')} ({state.rows.length})
      </h2>
      <span className="match-page-spacer" />
      <div className="opportunity-segmented" role="group" aria-label={t('分组方式', 'グループ化')}>
        <button type="button" aria-pressed={grouping === 'case'} onClick={() => choose('case')}>
          {t('按案件', '案件別')}
        </button>
        <button type="button" aria-pressed={grouping === 'person'} onClick={() => choose('person')}>
          {t('按人员', '要員別')}
        </button>
      </div>
    </>
  )
  return (
    <MatchResultsPage
      label={t('新匹配机会', '新しいマッチング候補')}
      className="opportunity-page"
      header={header}
      status={
        <span>
          {t(
            '根据最新资料在后台发现，以下为本地依据；打开后可进行完整匹配评估。',
            '最新情報からバックグラウンドで見つけたローカル候補です。開くと詳しい評価を確認できます。'
          )}
        </span>
      }
      notices={
        state.loadError || state.actionError ? (
          <>
            {state.loadError ? (
              <p role="alert">
                {state.loadError}
                <button type="button" onClick={state.reload}>
                  {t('重试', '再試行')}
                </button>
              </p>
            ) : null}
            {state.actionError ? <p role="alert">{state.actionError}</p> : null}
          </>
        ) : null
      }
      body={
        <div
          className="opportunity-scroll"
          ref={scroller}
          onScroll={(event) => {
            scrollTop.current = event.currentTarget.scrollTop
          }}
        >
          {!state.rows.length ? (
            state.loaded && !state.loadError ? (
              <p className="match-muted opportunity-empty">
                {t(
                  '暂无新的匹配机会。有新资料时会在这里提示。',
                  '新しいマッチング候補はありません。新しい情報が入るとここに表示されます。'
                )}
              </p>
            ) : null
          ) : (
            sections.map((section) => (
              <section className="opportunity-section" key={section.key} aria-label={`${section.title} (${section.rows.length})`}>
                <h3 className="opportunity-section-head">
                  {section.title} ({section.rows.length})
                </h3>
                {groupRows(section.rows, grouping).map((group) => (
                  <section className="opportunity-group" key={`${grouping}:${group.key}`} aria-label={group.title}>
                    <h4 className="opportunity-group-head">
                      {group.title}
                      <span>{group.rows.length}</span>
                    </h4>
                    <ul className="opportunity-rows">
                      {group.rows.map((row) => (
                        <OpportunityRow
                          key={row.id}
                          row={row}
                          by={grouping}
                          busy={state.busy}
                          onOpen={() => void open(row)}
                          onDismiss={() => void state.control(row, 'dismissed')}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </section>
            ))
          )}
        </div>
      }
    />
  )
}
