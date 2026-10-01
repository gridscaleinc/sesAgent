import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ApplicationLocale, CandidateReviewSnapshot, JobCaseReviewSnapshot, MatchingOpportunity } from '@shared'
import { localeText, localizedIpcError, useLocaleText } from '../i18n'
import { hrListPageSize, pageNumbers } from './HrObjectList'
import { displayFieldValue } from '../field-display'
import { focusRequirement } from '../requirement-decision-events'
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
  /** Every listed row whose conclusion is 可以提案, seen ones included. */
  proposableCount: number
  loaded: boolean
  loadError: string
  actionError: string
  busy: boolean
  reload(): void
  /** Sends 'seen' or 'dismissed' to Main; resolves false when Main refused it (e.g. the recommendation changed). */
  control(item: MatchingOpportunity, action: 'seen' | 'dismissed' | 'restored'): Promise<boolean>
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
  const control = async (item: MatchingOpportunity, action: 'seen' | 'dismissed' | 'restored') => {
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
    // A pair HR judged 不满足 is shown, but is not news.
    newCount: rows.filter((row) => row.state === 'new' && row.status !== 'not-suitable').length,
    newRecommendedCount: rows.filter((row) => row.state === 'new' && row.status === 'recommended').length,
    proposableCount: rows.filter((row) => row.status === 'recommended').length,
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
  proposable = 0,
  onOpen
}: {
  count: number
  /** How many of the new ones can be proposed; the parenthetical is hidden at zero. */
  recommended?: number
  /** Every pair that can be proposed, seen ones included: with nothing new, the banner still leads to them. */
  proposable?: number
  onOpen(): void
}) {
  const { t } = useLocaleText()
  if (count <= 0 && proposable <= 0) return null
  if (count <= 0)
    return (
      <div className="opportunity-banner is-quiet" role="status">
        <span>{t(`没有新的匹配机会；共 ${proposable} 组可以提案`, `新しい候補はありません。提案可能 計${proposable}組`)}</span>
        <button type="button" onClick={onOpen} aria-label={t(`查看可以提案的 ${proposable} 组`, `提案可能な ${proposable} 組を見る`)}>
          {t('查看', '見る')} →
        </button>
      </div>
    )
  return (
    <div className="opportunity-banner" role="status">
      <span className="opportunity-banner-dot" aria-hidden="true" />
      <span>
        {t('新匹配机会', '新しいマッチング候補')} <strong>{count}</strong>
        {recommended > 0 ? t(`（其中可以提案 ${recommended}）`, `（うち提案可能 ${recommended}）`) : null}
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

type FieldList = ReadonlyArray<{ key: string; value: string | null }>
/** Display text of the first filled field among keys, normalized the way the HR cards show it. */
function fieldText(fields: FieldList | undefined, keys: string[], zh: boolean) {
  for (const key of keys) {
    const value = fields?.find((field) => field.key === key && field.value?.trim())?.value
    if (value) return displayFieldValue(key, value, zh).text
  }
  return ''
}
/** The few facts HR weighs before opening a pair: a person's experience, start and rate; a case's rate, place and start. */
function personFacts(fields: FieldList | undefined, zh: boolean, t: (cn: string, ja: string) => string) {
  const years = fieldText(fields, ['experience_years'], zh)
  const start = fieldText(fields, ['availability'], zh)
  const rate = fieldText(fields, ['rate'], zh)
  return [years ? t(`经验 ${years}`, `経験 ${years}`) : '', start ? t(`可入场 ${start}`, `稼働 ${start}`) : '', rate].filter(Boolean)
}
function caseFacts(fields: FieldList | undefined, zh: boolean) {
  return [fieldText(fields, ['rate'], zh), fieldText(fields, ['location'], zh), fieldText(fields, ['start_date'], zh)].filter(Boolean)
}
function Facts({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <span className="opportunity-facts" title={items.join(' · ')}>
      {items.join(' · ')}
    </span>
  )
}

function OpportunityRow({
  row,
  by,
  busy,
  facts,
  onOpen,
  onDismiss
}: {
  row: MatchingOpportunity
  by: OpportunityGrouping
  busy: boolean
  /** Facts of the other side of the pair: the person when grouped by case, the case when grouped by person. */
  facts: string[]
  onOpen(): void
  onDismiss(): void
}) {
  const { t } = useLocaleText()
  const title = by === 'case' ? row.personName : row.caseTitle
  const reasons = row.reasons.slice(0, 4)
  const ready = row.status === 'recommended'
  const rejected = row.status === 'not-suitable'
  return (
    <li
      className={`opportunity-row${row.state === 'new' && !rejected ? ' is-new' : ''}${rejected ? ' is-rejected' : ''}`}
      // The whole row opens the pair; its buttons and menu keep their own action.
      onClick={(event) => {
        if (!busy && !(event.target as HTMLElement).closest('button,[role="menu"]') && !window.getSelection()?.toString()) onOpen()
      }}
    >
      <div className="opportunity-row-main">
        <span className="opportunity-row-head">
          {row.state === 'new' && !rejected ? (
            <span className="opportunity-new-dot" title={t('新', '新着')} aria-label={t('新', '新着')} />
          ) : null}
          <strong title={title}>{title}</strong>
          <span className={`opportunity-met${ready ? '' : rejected ? ' is-rejected' : ' is-partial'}`}>
            {ready
              ? t(`满足 ${row.reasons.length} 项`, `${row.reasons.length} 項目充足`)
              : rejected
                ? // HR judged it 不满足; the list holds every item not met yet, unclear ones included.
                  t(`已判定不满足 · 未满足或待确认：${row.confirm.join('、')}`, `満たさないと判断済み・未充足／要確認：${row.confirm.join('・')}`)
                : t(
                    `满足 ${row.reasons.length} 项 · 待确认 ${row.confirm.length} 项`,
                    `${row.reasons.length} 項目充足・要確認 ${row.confirm.length}`
                  )}
          </span>
          <Facts items={facts} />
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
        </span>
        {row.confirm.length && !rejected ? (
          <span className="opportunity-confirm-line" title={row.confirm.join('、')}>
            {t('待确认：', '要確認：')}
            {row.confirm.join(t('、', '・'))}
          </span>
        ) : null}
      </div>
      <div className="opportunity-row-actions">
        <button
          type="button"
          className="opportunity-open"
          disabled={busy}
          onClick={onOpen}
          aria-label={ready ? t(`查看匹配：${title}`, `マッチングを見る：${title}`) : t(`确认条件：${title}`, `条件を確認：${title}`)}
        >
          {ready ? t('查看', '見る') : t('确认条件', '条件を確認')}
        </button>
        {/* Only this pair leaves 新匹配机会; the case and the person stay as they are. */}
        <button
          type="button"
          className="opportunity-remove"
          disabled={busy}
          onClick={onDismiss}
          title={t(
            '从新匹配机会中删除这一条，案件和人员资料不受影响',
            '新しいマッチング候補からこの1件を削除します。案件と要員の情報はそのままです'
          )}
          aria-label={t(`删除：${row.personName} · ${row.caseTitle}`, `削除：${row.personName} · ${row.caseTitle}`)}
        >
          {t('删除', '削除')}
        </button>
      </div>
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
  cases = [],
  people = [],
  onBack,
  onOpen
}: {
  state: MatchingOpportunitiesState
  visible: boolean
  /** Used until the operator picks a grouping; the last pick is remembered. */
  defaultGrouping: OpportunityGrouping
  backLabel: string
  /** Local case and person records, for the few facts shown beside each pair. */
  cases?: JobCaseReviewSnapshot[]
  people?: CandidateReviewSnapshot[]
  onBack(): void
  /** Called only after Main accepted the 'seen' mark for this exact recommendation. */
  onOpen(item: MatchingOpportunity, grouping: OpportunityGrouping): void
}) {
  const { t, zh } = useLocaleText()
  const [grouping, setGrouping] = useState<OpportunityGrouping>(() => readGrouping(defaultGrouping))
  const [onlyNew, setOnlyNew] = useState(false)
  // The pair just removed, offered back for a few seconds.
  const [removed, setRemoved] = useState<MatchingOpportunity | null>(null)
  useEffect(() => {
    if (!removed) return
    const timer = window.setTimeout(() => setRemoved(null), 5000)
    return () => window.clearTimeout(timer)
  }, [removed])
  const remove = async (item: MatchingOpportunity) => {
    if (await state.control(item, 'dismissed')) setRemoved(item)
  }
  const [page, setPage] = useState(1)
  const picked = useRef(false)
  const scroller = useRef<HTMLDivElement>(null)
  const scrollTop = useRef(0)
  useLayoutEffect(() => {
    if (!visible) return
    // Until the operator picks a grouping, the page follows the list it was opened from.
    if (!picked.current) setGrouping(readGrouping(defaultGrouping))
    if (scroller.current) scroller.current.scrollTop = scrollTop.current
  }, [visible, defaultGrouping])
  const toTop = () => {
    scrollTop.current = 0
    if (scroller.current) scroller.current.scrollTop = 0
  }
  const choose = (value: OpportunityGrouping) => {
    picked.current = true
    setGrouping(value)
    setPage(1)
    toTop()
    try {
      localStorage.setItem(groupingKey, value)
    } catch {}
  }
  const open = async (item: MatchingOpportunity) => {
    if (!(await state.control(item, 'seen'))) return
    // 「确认条件」 lands on the first item to confirm in 匹配依据.
    if (item.status === 'needs-confirmation' && item.confirm[0]) focusRequirement(item.confirm[0])
    onOpen(item, grouping)
  }
  const caseFields = (row: MatchingOpportunity) =>
    (cases.find((job) => job.reviewId === row.reviewId) ?? cases.find((job) => job.jobCase?.id === row.jobCaseId))?.fields
  const personFields = (row: MatchingOpportunity) => people.find((person) => person.documentId === row.documentId)?.fields
  const shown = onlyNew ? state.rows.filter((row) => row.state === 'new' && row.status !== 'not-suitable') : state.rows
  // 可以提案 first, then the pairs still missing core information; one page holds hrListPageSize pairs.
  const ordered = (['recommended', 'needs-confirmation', 'not-suitable'] as const).flatMap((status) =>
    shown.filter((row) => row.status === status)
  )
  const totalPages = Math.max(1, Math.ceil(ordered.length / hrListPageSize))
  const current = Math.min(page, totalPages)
  const onPage = new Set(ordered.slice((current - 1) * hrListPageSize, current * hrListPageSize).map((row) => row.id))
  const changePage = (next: number) => {
    setPage(next)
    toTop()
  }
  const sections = [
    {
      key: 'recommended',
      title: t('可以提案', '提案可能'),
      hint: '',
      rows: shown.filter((row) => row.status === 'recommended')
    },
    {
      key: 'needs-confirmation',
      title: t('待确认', '確認待ち'),
      hint: t('确认下列条件后即可提案', '下記の条件を確認すると提案できます'),
      rows: shown.filter((row) => row.status === 'needs-confirmation')
    },
    {
      key: 'not-suitable',
      title: t('不满足', '未充足'),
      hint: t('HR 已确认不满足；打开后可以撤销', 'HRが未充足と確認済み。開くと取り消せます'),
      rows: shown.filter((row) => row.status === 'not-suitable')
    }
  ].filter((section) => section.rows.length)
  const latest = (rows: MatchingOpportunity[]) =>
    rows.reduce((best, row) => (Date.parse(row.updatedAt) > Date.parse(best) ? row.updatedAt : best), rows[0]!.updatedAt)
  const newCount = state.rows.filter((row) => row.state === 'new' && row.status !== 'not-suitable').length
  const header = (
    <>
      <MatchBackButton label={backLabel} onClick={onBack} />
      <h2 className="match-page-title">
        {t('新匹配机会', '新しいマッチング候補')} ({state.rows.length})
      </h2>
      <span className="match-page-spacer" />
      <div className="opportunity-segmented" role="group" aria-label={t('显示范围', '表示範囲')}>
        <button
          type="button"
          aria-pressed={!onlyNew}
          onClick={() => {
            setOnlyNew(false)
            changePage(1)
          }}
        >
          {t('全部', 'すべて')}
        </button>
        <button
          type="button"
          aria-pressed={onlyNew}
          onClick={() => {
            setOnlyNew(true)
            changePage(1)
          }}
        >
          {t(`只看新的 ${newCount}`, `新着のみ ${newCount}`)}
        </button>
      </div>
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
        <>
          <div
            className="opportunity-scroll"
            ref={scroller}
            onScroll={(event) => {
              scrollTop.current = event.currentTarget.scrollTop
            }}
          >
            {!shown.length ? (
              state.loaded && !state.loadError ? (
                <p className="match-muted opportunity-empty">
                  {onlyNew && state.rows.length
                    ? t(
                        '没有新的匹配机会，切换到「全部」查看已看过的。',
                        '新着の候補はありません。「すべて」で確認済みの候補を見られます。'
                      )
                    : t(
                        '暂无新的匹配机会。有新资料时会在这里提示。',
                        '新しいマッチング候補はありません。新しい情報が入るとここに表示されます。'
                      )}
                </p>
              ) : null
            ) : (
              sections.map((section) => {
                const groups = groupRows(
                  section.rows.filter((row) => onPage.has(row.id)),
                  grouping
                )
                if (!groups.length) return null
                return (
                  <section
                    className={`opportunity-section is-${section.key}`}
                    key={section.key}
                    aria-label={`${section.title} (${section.rows.length})`}
                  >
                    <h3 className="opportunity-section-head">
                      <span className="opportunity-section-dot" aria-hidden="true" />
                      {section.title} ({section.rows.length}){section.hint ? <small>{section.hint}</small> : null}
                    </h3>
                    <div className="opportunity-groups">
                      {groups.map((group) => {
                        const first = group.rows[0]!
                        const facts = grouping === 'case' ? caseFacts(caseFields(first), zh) : personFacts(personFields(first), zh, t)
                        return (
                          <section className="opportunity-group" key={`${grouping}:${group.key}`} aria-label={group.title}>
                            <header className="opportunity-group-head">
                              <h4 title={group.title}>{group.title}</h4>
                              <span className="opportunity-group-count">
                                {grouping === 'case'
                                  ? t(`${group.rows.length} 人`, `${group.rows.length} 名`)
                                  : t(`${group.rows.length} 个案件`, `${group.rows.length} 件`)}
                                <time dateTime={latest(group.rows)}>
                                  {t(`${opportunityDay(latest(group.rows), t)}发现`, `${opportunityDay(latest(group.rows), t)}に発見`)}
                                </time>
                              </span>
                              {facts.length ? (
                                <span className="opportunity-group-meta">
                                  <Facts items={facts} />
                                </span>
                              ) : null}
                            </header>
                            <ul className="opportunity-rows">
                              {group.rows.map((row) => (
                                <OpportunityRow
                                  key={row.id}
                                  row={row}
                                  by={grouping}
                                  busy={state.busy}
                                  facts={grouping === 'case' ? personFacts(personFields(row), zh, t) : caseFacts(caseFields(row), zh)}
                                  onOpen={() => void open(row)}
                                  onDismiss={() => void remove(row)}
                                />
                              ))}
                            </ul>
                          </section>
                        )
                      })}
                    </div>
                  </section>
                )
              })
            )}
          </div>
          {removed ? (
            <p className="hr-working-notice" role="status">
              <span>
                {t(`已删除：${removed.personName} · ${removed.caseTitle}`, `削除しました：${removed.personName} · ${removed.caseTitle}`)}
              </span>
              <button
                type="button"
                disabled={state.busy}
                onClick={() => {
                  const item = removed
                  setRemoved(null)
                  void state.control(item, 'restored')
                }}
              >
                {t('撤销', '元に戻す')}
              </button>
            </p>
          ) : null}
          {totalPages > 1 ? (
            <nav className="hr-list-pagination opportunity-pagination" aria-label={t('列表分页', '一覧のページ切替')}>
              <span>{t(`共 ${ordered.length} 条`, `全 ${ordered.length} 件`)}</span>
              <button type="button" aria-label={t('上一页', '前のページ')} disabled={current === 1} onClick={() => changePage(current - 1)}>
                ‹
              </button>
              {pageNumbers(current, totalPages).map((item, index) =>
                item === null ? (
                  <span key={`gap-${index}`} className="hr-page-gap" aria-hidden="true">
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    className="hr-page-number"
                    aria-current={item === current ? 'page' : undefined}
                    aria-label={t(`第 ${item} 页`, `${item} ページ目`)}
                    onClick={() => changePage(item)}
                  >
                    {item}
                  </button>
                )
              )}
              <button
                type="button"
                aria-label={t('下一页', '次のページ')}
                disabled={current === totalPages}
                onClick={() => changePage(current + 1)}
              >
                ›
              </button>
            </nav>
          ) : null}
        </>
      }
    />
  )
}
