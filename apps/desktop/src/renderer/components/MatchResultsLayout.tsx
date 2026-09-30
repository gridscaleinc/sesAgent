import { useEffect, useId, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import {
  isProposalRequirement,
  requirementDimension,
  requirementDisplayLabel,
  uniqueRequirementEvidence,
  type BusinessMatchQualification,
  type MatchRequirementEvidence
} from '@shared'
import { useLocaleText } from '../i18n'
import './match-results.css'

/**
 * The shared results page of both matching directions (case → people, person → cases): one compact header row,
 * a short status line, then a results list beside the selected result's detail. Below ~900px of container width
 * the list and the detail share one pane.
 */
export function MatchResultsPage({
  label,
  rootRef,
  className,
  header,
  status,
  notices,
  body,
  overlay,
  dropHandlers
}: {
  label: string
  rootRef?: Ref<HTMLElement>
  className?: string
  header: ReactNode
  status?: ReactNode
  notices?: ReactNode
  body: ReactNode
  overlay?: ReactNode
  dropHandlers?: Pick<ComponentProps<'section'>, 'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'>
}) {
  return (
    <section ref={rootRef} className={`match-page${className ? ` ${className}` : ''}`} aria-label={label} {...dropHandlers}>
      <header className="match-page-header">{header}</header>
      {status ? <div className="match-page-status">{status}</div> : null}
      {notices ? <div className="match-page-notices">{notices}</div> : null}
      {body}
      {overlay}
    </section>
  )
}

/** The page header's back button; the title and actions sit in the same row. */
export function MatchBackButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button type="button" className="match-back" onClick={onClick}>
      ← {label}
    </button>
  )
}

/** A button that opens a small panel beside it; Esc and a click outside close it. */
export function Popover({
  label,
  trigger,
  children,
  className
}: {
  label: string
  trigger: ReactNode
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])
  return (
    <div
      className={`match-popover${className ? ` ${className}` : ''}`}
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
          button.current?.focus()
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="match-popover-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger} <span aria-hidden="true">▾</span>
      </button>
      <div id={id} className="match-popover-panel" role="dialog" aria-label={label} hidden={!open}>
        {children}
      </div>
    </div>
  )
}

export type ConclusionTone = 'fit' | 'pending' | 'no' | 'busy' | 'failed' | 'stale'
export const conclusionTone = (qualification?: BusinessMatchQualification): ConclusionTone =>
  qualification?.status === 'recommended' ? 'fit' : qualification?.status === 'excluded' ? 'no' : 'pending'
/** The short list-row form of the proposal conclusion; the detail header keeps the full sentence. */
export function shortConclusion(qualification: BusinessMatchQualification | undefined, t: (cn: string, ja: string) => string) {
  return qualification?.status === 'recommended'
    ? t('可以提案', '提案可能')
    : qualification?.status === 'excluded'
      ? t('不建议', '推奨しない')
      : t('核心信息待补充', 'コア情報の補足が必要')
}
export function ConclusionBadge({ tone, children }: { tone: ConclusionTone; children: ReactNode }) {
  return <span className={`match-badge is-${tone}`}>{children}</span>
}

type ChipState = 'met' | 'unknown' | 'conflict'
export const requirementState = (item: MatchRequirementEvidence): ChipState =>
  item.outcome === 'conflict' ? 'conflict' : item.outcome === 'unknown' || item.yearsUnconfirmed ? 'unknown' : 'met'
const dimensionRank = (item: MatchRequirementEvidence) => (requirementDimension(item.requirement) === 'technical' ? 0 : 1)
/** Technical and language requirements, technical first: the ones that decide the proposal conclusion. */
export const coreRequirements = (qualification?: BusinessMatchQualification) =>
  uniqueRequirementEvidence(qualification?.requirements ?? [])
    .filter((item) => isProposalRequirement(item.requirement))
    .sort((a, b) => dimensionRank(a) - dimensionRank(b))

/** Up to four core requirements with their state, so rows can be compared at a glance. */
export function RequirementChips({ qualification, limit = 4 }: { qualification?: BusinessMatchQualification; limit?: number }) {
  const { zh, t } = useLocaleText()
  const items = coreRequirements(qualification)
  if (!items.length) return null
  const stateLabel = (item: MatchRequirementEvidence) =>
    ({
      met: t('满足', '充足'),
      unknown: item.outcome === 'met' ? t('年限未写明', '年数の記載なし') : t('需确认', '要確認'),
      conflict: t('不满足', '未充足')
    })[requirementState(item)]
  return (
    <span className="match-chips">
      {items.slice(0, limit).map((item) => {
        const label = requirementDisplayLabel(item.requirement, zh)
        const state = requirementState(item)
        return (
          <span key={item.requirement.id} className={`match-chip is-${state}`} title={`${label} · ${stateLabel(item)}`}>
            {state === 'met' ? '✓' : state === 'conflict' ? '✗' : '?'} {label}
          </span>
        )
      })}
      {items.length > limit ? <span className="match-chip is-more">+{items.length - limit}</span> : null}
    </span>
  )
}

/** One result: name, conclusion, core requirement chips and small state tags; the checkbox selects it for a batch. */
export function MatchResultRow({
  id,
  title,
  badge,
  chips,
  tags,
  selected,
  onSelect,
  select,
  titleHint,
  experienceRun,
  rank
}: {
  id: string
  title: string
  badge: ReactNode
  chips?: ReactNode
  tags?: ReactNode
  selected: boolean
  onSelect(): void
  select?: { label: string; checked: boolean; disabled?: boolean; onChange(checked: boolean): void } | null
  titleHint?: string
  experienceRun?: string
  rank?: number
}) {
  return (
    <li className={`match-row${selected ? ' is-selected' : ''}`} data-experience-run={experienceRun} data-experience-rank={rank}>
      {select ? (
        <input
          className="match-row-check"
          type="checkbox"
          aria-label={select.label}
          checked={select.checked}
          disabled={select.disabled}
          onChange={(event) => select.onChange(event.target.checked)}
        />
      ) : (
        <span className="match-row-check" aria-hidden="true" />
      )}
      <button
        type="button"
        className="match-row-main"
        data-match-row={id}
        aria-current={selected ? 'true' : undefined}
        title={titleHint}
        onClick={onSelect}
      >
        <span className="match-row-head">
          <strong>{title}</strong>
          {badge}
        </span>
        {chips}
        {tags ? <span className="match-row-tags">{tags}</span> : null}
      </button>
    </li>
  )
}

/** The rows of one list; ↑/↓ move the selection without leaving the list. */
export function MatchResultList({ label, children, onMove }: { label: string; children: ReactNode; onMove(id: string): void }) {
  const move = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-match-row]')]
    if (!rows.length) return
    event.preventDefault()
    const focused = rows.indexOf(document.activeElement as HTMLButtonElement)
    const base = focused >= 0 ? focused : rows.findIndex((row) => row.getAttribute('aria-current') === 'true')
    const next = rows[Math.min(rows.length - 1, Math.max(0, base + (event.key === 'ArrowDown' ? 1 : -1)))]!
    next.focus()
    onMove(next.dataset.matchRow!)
  }
  return (
    <ul className="match-list" aria-label={label} onKeyDown={move}>
      {children}
    </ul>
  )
}

/** Results left out of the list, collapsed at its bottom with the reason of each. */
export function ExcludedSection({ count, summary, children }: { count: number; summary?: ReactNode; children?: ReactNode }) {
  const { t } = useLocaleText()
  if (!count) return null
  return (
    <details className="match-excluded">
      <summary>
        {t('已排除', '除外')} {count}
      </summary>
      {summary}
      {children}
    </details>
  )
}

/** The list and the detail side by side; in a narrow container only one shows, with a way back to the list. */
export function MatchResultsBody({
  list,
  detail,
  showDetail,
  listRef,
  onListScroll
}: {
  list: ReactNode
  detail: ReactNode
  showDetail: boolean
  listRef?: Ref<HTMLDivElement>
  onListScroll?(top: number): void
}) {
  return (
    <div className={`match-body${showDetail ? ' is-detail-open' : ''}`}>
      <div className="match-list-pane" ref={listRef} onScroll={(event) => onListScroll?.(event.currentTarget.scrollTop)}>
        {list}
      </div>
      <div className="match-detail-pane">{detail}</div>
    </div>
  )
}

export interface MatchDetailTab {
  id: string
  label: string
  content: ReactNode
}
/** The selected result: a sticky header with its next steps, then tabs. */
export function MatchDetail({
  label,
  rootRef,
  title,
  badge,
  status,
  actions,
  notice,
  tabs,
  tab,
  onTab,
  onBackToList,
  experienceRun
}: {
  label: string
  rootRef?: Ref<HTMLElement>
  title: ReactNode
  badge?: ReactNode
  status?: ReactNode
  actions?: ReactNode
  notice?: ReactNode
  tabs: MatchDetailTab[]
  tab: string
  onTab(id: string): void
  onBackToList(): void
  experienceRun?: string
}) {
  const { t } = useLocaleText()
  const base = useId()
  const current = tabs.some((item) => item.id === tab) ? tab : tabs[0]?.id
  const tabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']
    if (!keys.includes(event.key) || !tabs.length) return
    event.preventDefault()
    const index = tabs.findIndex((item) => item.id === current)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    onTab(tabs[next]!.id)
    document.getElementById(`${base}-tab-${tabs[next]!.id}`)?.focus()
  }
  return (
    <article ref={rootRef} className="match-detail" aria-label={label} data-experience-run={experienceRun}>
      <header className="match-detail-header">
        <button type="button" className="match-detail-back" onClick={onBackToList}>
          ← {t('返回列表', '一覧に戻る')}
        </button>
        <div className="match-detail-title">
          <h3>{title}</h3>
          {badge}
          {status}
        </div>
        {actions ? <div className="match-detail-actions">{actions}</div> : null}
      </header>
      {notice ? <div className="match-detail-notice">{notice}</div> : null}
      {tabs.length ? (
        <>
          <div className="match-tabs" role="tablist" aria-label={t('匹配详情', 'マッチングの詳細')} onKeyDown={tabKeys}>
            {tabs.map((item) => (
              <button
                key={item.id}
                id={`${base}-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={item.id === current}
                aria-controls={`${base}-panel-${item.id}`}
                tabIndex={item.id === current ? 0 : -1}
                onClick={() => onTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {tabs.map((item) => (
            <div
              key={item.id}
              id={`${base}-panel-${item.id}`}
              className="match-tabpanel"
              role="tabpanel"
              aria-labelledby={`${base}-tab-${item.id}`}
              hidden={item.id !== current}
            >
              {item.content}
            </div>
          ))}
        </>
      ) : null}
    </article>
  )
}
