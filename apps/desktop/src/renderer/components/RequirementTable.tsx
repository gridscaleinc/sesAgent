import {
  isProposalRequirement,
  jobCaseFieldKeys,
  matchEvidenceSections,
  requirementDecisionLimits,
  requirementDimension,
  requirementDisplayLabel,
  requirementQuestion,
  uniqueRequirementEvidence,
  type BusinessMatchQualification,
  type JobCaseFieldKey,
  type MatchRequirement,
  type MatchRequirementEvidence
} from '@shared'
import { Fragment, useEffect, useRef, useState } from 'react'
import { localizedIpcError, localizedJobCaseFieldLabel, useLocaleText } from '../i18n'
import {
  announceRequirementDecision,
  focusRequirement,
  onRequirementFocus,
  takePendingRequirementFocus
} from '../requirement-decision-events'
import { displayFieldValue } from '../field-display'
import { coreRequirements } from './MatchResultsLayout'

type Mode = 'evidence' | 'follow-up'
/** The person and case a table belongs to; with it, unclear technical and language items can be decided by HR. */
export interface RequirementPair {
  documentId: string
  jobCaseId: string
}
type Action = 'met' | 'conflict' | 'asking'

/** 满足 / 不满足 / 问本人 for one unclear item, and the withdrawal of an earlier decision. */
function DecisionForm({
  item,
  action,
  pair,
  onDone,
  onCancel
}: {
  item: MatchRequirementEvidence
  action: Action
  pair: RequirementPair
  onDone(): void
  onCancel(): void
}) {
  const { zh, t } = useLocaleText()
  const label = requirementDisplayLabel(item.requirement, zh)
  const [note, setNote] = useState(item.hrDecision?.note ?? '')
  const [question, setQuestion] = useState(item.hrDecision?.question ?? requirementQuestion(item.requirement, zh))
  // Technical and language items are facts about the person: by default the decision is kept with the person.
  const [toPerson, setToPerson] = useState(item.hrDecision ? item.hrDecision.scope === 'person' : true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const first = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  useEffect(() => first.current?.focus(), [])
  const submit = async () => {
    if (busy || !window.sesAgent.decideRequirement) return
    setBusy(true)
    setError('')
    try {
      const result = await window.sesAgent.decideRequirement({
        documentId: pair.documentId,
        jobCaseId: pair.jobCaseId,
        requirement: { key: item.requirement.key, label: item.requirement.label, category: item.requirement.category },
        outcome: action,
        scope: toPerson ? 'person' : 'pair',
        note: action === 'asking' ? null : note.trim() || null,
        question: action === 'asking' ? question.trim() : null
      })
      announceRequirementDecision({ ...result, documentId: pair.documentId })
      onDone()
    } catch (cause) {
      setError(localizedIpcError(zh ? 'zh-CN' : 'ja-JP', cause, t('保存失败，请重试。', '保存できませんでした。もう一度お試しください。')))
    } finally {
      setBusy(false)
    }
  }
  const title =
    action === 'met'
      ? t(`确认满足「${label}」`, `「${label}」を満たすと確認`)
      : action === 'conflict'
        ? t(`确认不满足「${label}」`, `「${label}」を満たさないと確認`)
        : t(`问本人「${label}」`, `「${label}」を本人に確認`)
  return (
    <form
      className="requirement-decision"
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onCancel()
        }
      }}
    >
      <strong>{title}</strong>
      {action === 'asking' ? (
        <label>
          <span>{t('要问的问题（可修改）', '確認する質問（編集可）')}</span>
          <textarea
            ref={first}
            rows={2}
            value={question}
            maxLength={requirementDecisionLimits.question}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </label>
      ) : (
        <label>
          <span>{t('依据（选填）', '根拠（任意）')}</span>
          <input
            ref={first}
            value={note}
            maxLength={requirementDecisionLimits.note}
            placeholder={
              action === 'met'
                ? t('例：面谈时确认业务会话没问题', '例：面談で業務会話に問題ないと確認')
                : t('例：本人表示只能日常会话', '例：日常会話レベルとの回答')
            }
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      )}
      <label className="requirement-decision-scope">
        <input type="checkbox" checked={toPerson} onChange={(event) => setToPerson(event.target.checked)} />
        <span>{t('写入人员资料：其他案件有同样条件时也按此判断', '要員情報に記録：同じ条件の他案件にも適用')}</span>
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="requirement-decision-actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          {t('取消', 'キャンセル')}
        </button>
        <button type="submit" className={`is-${action}`} disabled={busy || (action === 'asking' && !question.trim())}>
          {busy ? t('保存中…', '保存中…') : action === 'asking' ? t('记录问题', '質問を記録') : t('确认', '確定')}
        </button>
      </div>
    </form>
  )
}

/**
 * One row per requirement: the condition, what the case asks, what the person's material says, and the state.
 * A missing value is an em dash; the state pill says what that means, so no sentence repeats per row.
 * With a pair, an unclear technical or language item offers 满足 / 不满足 / 问本人, and HR's decision can be withdrawn.
 */
export function RequirementTable({
  items,
  mode,
  label,
  pair
}: {
  items: MatchRequirementEvidence[]
  mode: Mode
  label: string
  pair?: RequirementPair
}) {
  const { locale, zh, t } = useLocaleText()
  const [editing, setEditing] = useState<{ id: string; action: Action } | null>(null)
  const [withdrawing, setWithdrawing] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState<string | null>(null)
  const table = useRef<HTMLTableElement>(null)
  // A click on a list chip or 「确认条件」 brings its row into view.
  useEffect(() => {
    const show = (wanted: string) => {
      const match = items.find((item) => item.requirement.label === wanted || requirementDisplayLabel(item.requirement, zh) === wanted)
      if (!match) return false
      setFlash(match.requirement.id)
      requestAnimationFrame(() =>
        table.current
          ?.querySelector(`[data-requirement="${CSS.escape(match.requirement.id)}"]`)
          ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      )
      window.setTimeout(() => setFlash((current) => (current === match.requirement.id ? null : current)), 1600)
      return true
    }
    const pending = takePendingRequirementFocus()
    if (pending && !show(pending)) focusRequirement(pending)
    return onRequirementFocus((wanted) => {
      if (show(wanted)) takePendingRequirementFocus()
    })
  }, [items, zh])
  const condition = (requirement: MatchRequirement) => {
    if ((jobCaseFieldKeys as readonly string[]).includes(requirement.key))
      return localizedJobCaseFieldLabel(locale, requirement.key as JobCaseFieldKey)
    const dimension = requirementDimension(requirement)
    return dimension === 'technical' ? t('技术', '技術') : dimension === 'language' ? t('语言', '言語') : t('条件', '条件')
  }
  // Case terms carry the case's own wording; show common Japanese phrasings in the UI language, the stored value on hover.
  const requirementValue = (requirement: MatchRequirement) => {
    const shown = displayFieldValue(requirement.key, requirement.label, zh)
    if (shown.original === null) return requirementDisplayLabel(requirement, zh)
    return (
      <span className="is-normalized-value" title={shown.original}>
        {shown.text}
      </span>
    )
  }
  const pill = (item: MatchRequirementEvidence) => {
    if (item.hrDecision?.outcome === 'asking') return <span className="requirement-pill is-asking">{t('沟通中', '確認中')}</span>
    if (item.outcome === 'met') return <span className="requirement-pill is-met">✓ {t('满足', '充足')}</span>
    if (item.outcome === 'unknown') return <span className="requirement-pill is-unknown">{t('需确认', '要確認')}</span>
    return mode === 'follow-up' ? (
      <span className="requirement-pill is-negotiate">{t('需沟通', '要相談')}</span>
    ) : (
      <span className="requirement-pill is-conflict">✗ {t('不满足', '未充足')}</span>
    )
  }
  const decidable = (item: MatchRequirementEvidence) =>
    // Unclear items, and conflicts the material may have wrong (「J2EE」 for Java): HR's judgement settles both.
    Boolean(
      pair &&
      mode === 'evidence' &&
      isProposalRequirement(item.requirement) &&
      (item.outcome === 'unknown' || item.outcome === 'conflict' || item.hrDecision)
    )
  const withdraw = async (item: MatchRequirementEvidence) => {
    if (!pair || !item.hrDecision || withdrawing || !window.sesAgent.withdrawRequirementDecision) return
    setWithdrawing(item.requirement.id)
    setError('')
    try {
      const result = await window.sesAgent.withdrawRequirementDecision({ id: item.hrDecision.confirmationId, documentId: pair.documentId })
      announceRequirementDecision({ ...result, documentId: pair.documentId })
    } catch (cause) {
      setError(localizedIpcError(locale, cause, t('撤销失败，请重试。', '取り消せませんでした。もう一度お試しください。')))
    } finally {
      setWithdrawing(null)
    }
  }
  const decisionInfo = (item: MatchRequirementEvidence) => {
    const decision = item.hrDecision!
    const when = new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' }).format(
      new Date(decision.decidedAt)
    )
    return [
      decision.note,
      decision.question,
      `${decision.decidedBy ?? 'HR'} · ${when}`,
      decision.scope === 'person' ? t('已写入人员资料', '要員情報に記録済み') : t('仅本案件', 'この案件のみ')
    ]
      .filter(Boolean)
      .join('\n')
  }
  const actions = (item: MatchRequirementEvidence) => {
    if (!decidable(item)) return null
    const open = (action: Action) => setEditing({ id: item.requirement.id, action })
    const decided = item.hrDecision && item.hrDecision.outcome !== 'asking'
    return (
      <span className="requirement-decide">
        {item.hrDecision ? (
          <small className="requirement-tag is-hr" title={decisionInfo(item)}>
            {item.hrDecision.outcome === 'asking' ? t('已记录问题', '質問を記録') : t('HR 确认', 'HR確認')}
          </small>
        ) : null}
        {item.hrDecision?.outcome === 'asking' ? (
          <small className="requirement-question" title={item.hrDecision.question ?? undefined}>
            {item.hrDecision.question}
          </small>
        ) : null}
        {!decided ? (
          <span className="requirement-decide-buttons">
            <button type="button" className="is-met" onClick={() => open('met')}>
              {t('满足', '満たす')}
            </button>
            <button type="button" className="is-conflict" onClick={() => open('conflict')}>
              {t('不满足', '満たさない')}
            </button>
            {!item.hrDecision ? (
              <button type="button" onClick={() => open('asking')}>
                {t('问本人', '本人に確認')}
              </button>
            ) : null}
          </span>
        ) : null}
        {item.hrDecision ? (
          <button
            type="button"
            className="requirement-withdraw"
            disabled={withdrawing === item.requirement.id}
            onClick={() => void withdraw(item)}
          >
            {t('撤销', '取り消す')}
          </button>
        ) : null}
      </span>
    )
  }
  return (
    <>
      {error ? (
        <p role="alert" className="requirement-decision-error">
          {error}
        </p>
      ) : null}
      <table className="requirement-table" aria-label={label} ref={table}>
        <thead>
          <tr>
            <th scope="col">{t('条件', '条件')}</th>
            <th scope="col">{t('案件要求', '案件の要件')}</th>
            <th scope="col">{t('人员资料', '要員情報')}</th>
            <th scope="col">{t('状态', '状態')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <Fragment key={item.requirement.id}>
              <tr
                data-requirement={item.requirement.id}
                className={`is-${item.outcome}${flash === item.requirement.id ? ' is-flash' : ''}${item.hrDecision ? ' is-hr-decided' : ''}`}
              >
                <th scope="row">{condition(item.requirement)}</th>
                <td>{requirementValue(item.requirement)}</td>
                <td>
                  {item.evidence ?? '—'}
                  {item.source ? <small className="requirement-source">{item.source}</small> : null}
                </td>
                <td>
                  {pill(item)}
                  {item.aiVerified ? <small className="requirement-tag is-ai-verified">{t('AI 核实', 'AI確認')}</small> : null}
                  {item.yearsUnconfirmed ? (
                    <small className="requirement-tag is-years-unconfirmed">{t('年限未写明', '年数の記載なし')}</small>
                  ) : null}
                  {actions(item)}
                </td>
              </tr>
              {editing?.id === item.requirement.id && pair ? (
                <tr className="requirement-decision-row">
                  <td colSpan={4}>
                    <DecisionForm
                      item={item}
                      action={editing.action}
                      pair={pair}
                      onDone={() => setEditing(null)}
                      onCancel={() => setEditing(null)}
                    />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </>
  )
}

const outcomeRank = { conflict: 0, unknown: 1, met: 2 } as const
/** 匹配依据: the technical and language requirements that decide the conclusion, then business terms already met. */
export function MatchEvidenceTab({ qualification, pair }: { qualification?: BusinessMatchQualification; pair?: RequirementPair }) {
  const { t } = useLocaleText()
  const core = coreRequirements(qualification).sort(
    (a, b) =>
      Number(requirementDimension(a.requirement) === 'language') - Number(requirementDimension(b.requirement) === 'language') ||
      outcomeRank[a.outcome] - outcomeRank[b.outcome]
  )
  const businessMet = uniqueRequirementEvidence(qualification?.requirements ?? []).filter(
    (item) => item.outcome === 'met' && !isProposalRequirement(item.requirement)
  )
  const dimensionStatus = (dimension: 'technical' | 'language') => {
    const items = core.filter((item) => requirementDimension(item.requirement) === dimension)
    if (!items.length) return dimension === 'language' ? t('案件未限定', '案件の指定なし') : t('案件要求待补充', '案件要件の補足が必要')
    return items.some((item) => item.outcome === 'conflict')
      ? t('存在差距', '要件との差あり')
      : items.some((item) => item.outcome === 'unknown')
        ? t('信息待补充', '情報の補足が必要')
        : t('符合要求', '要件を満たす')
  }
  return (
    <div className="match-evidence">
      <p className="match-muted">
        {t('技术', '技術')}：{dimensionStatus('technical')} · {t('语言', '言語')}：{dimensionStatus('language')}
      </p>
      {core.length || businessMet.length ? (
        <RequirementTable items={[...core, ...businessMet]} mode="evidence" label={t('匹配依据', 'マッチングの根拠')} pair={pair} />
      ) : null}
    </div>
  )
}

/**
 * Business terms and HR-rule questions to raise when proposing, counted only once the proposal is possible, and the
 * questions HR chose to ask the person about unclear items, listed at any time.
 */
export function followUpItems(qualification: BusinessMatchQualification | undefined, questions: string[] = []) {
  const sections = matchEvidenceSections(qualification, questions)
  const shown = qualification?.status === 'recommended'
  const asking = coreRequirements(qualification).filter((item) => item.hrDecision?.outcome === 'asking')
  return { shown, items: shown ? sections.businessPending : [], questions: shown ? sections.questions : [], asking }
}

/** 需沟通: business differences do not lower the technical and language conclusion; they are settled in contact. */
export function FollowUpTab({
  qualification,
  questions = [],
  hideEmpty = false
}: {
  qualification?: BusinessMatchQualification
  questions?: string[]
  /** HR's own questions are listed beside this tab: no 「没有需要沟通的事项」 then. */
  hideEmpty?: boolean
}) {
  const { t } = useLocaleText()
  const follow = followUpItems(qualification, questions)
  const asking = follow.asking.length ? (
    <section className="match-rule-questions is-asking">
      <h4>{t('待问本人', '本人に確認すること')}</h4>
      <ul>
        {follow.asking.map((item) => (
          <li key={item.requirement.id}>{item.hrDecision?.question ?? item.requirement.label}</li>
        ))}
      </ul>
    </section>
  ) : null
  if (!follow.shown && asking) return <div className="match-evidence">{asking}</div>
  if (!follow.shown)
    return (
      <p className="match-muted">
        {t(
          '技术和语言条件确认可以提案后，这里列出提案时需沟通的事项。',
          '技術・言語の条件で提案可能と確認できた後、提案時に相談する事項をここに表示します。'
        )}
      </p>
    )
  if (!follow.items.length && !follow.questions.length)
    return asking ? (
      <div className="match-evidence">{asking}</div>
    ) : hideEmpty ? null : (
      <p className="match-muted">{t('没有需要沟通的事项。', '相談が必要な事項はありません。')}</p>
    )
  return (
    <div className="match-evidence">
      {asking}
      <p className="match-muted">{t('以下事项不降低技术和语言的匹配结论。', '以下の条件は、技術・言語の適合判定には影響しません。')}</p>
      {follow.items.length ? <RequirementTable items={follow.items} mode="follow-up" label={t('需沟通', '要相談')} /> : null}
      {follow.questions.length ? (
        <section className="match-rule-questions">
          <h4>{t('HR 规则要求确认', 'HRルールの確認事項')}</h4>
          <ul>
            {follow.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
