import {
  isProposalRequirement,
  jobCaseFieldKeys,
  matchEvidenceSections,
  requirementDimension,
  requirementDisplayLabel,
  uniqueRequirementEvidence,
  type BusinessMatchQualification,
  type JobCaseFieldKey,
  type MatchRequirement,
  type MatchRequirementEvidence
} from '@shared'
import { localizedJobCaseFieldLabel, useLocaleText } from '../i18n'
import { coreRequirements } from './MatchResultsLayout'

type Mode = 'evidence' | 'follow-up'

/**
 * One row per requirement: the condition, what the case asks, what the person's material says, and the state.
 * A missing value is an em dash; the state pill says what that means, so no sentence repeats per row.
 */
export function RequirementTable({ items, mode, label }: { items: MatchRequirementEvidence[]; mode: Mode; label: string }) {
  const { locale, zh, t } = useLocaleText()
  const condition = (requirement: MatchRequirement) => {
    if ((jobCaseFieldKeys as readonly string[]).includes(requirement.key))
      return localizedJobCaseFieldLabel(locale, requirement.key as JobCaseFieldKey)
    const dimension = requirementDimension(requirement)
    return dimension === 'technical' ? t('技术', '技術') : dimension === 'language' ? t('语言', '言語') : t('条件', '条件')
  }
  const pill = (item: MatchRequirementEvidence) => {
    if (item.outcome === 'met') return <span className="requirement-pill is-met">✓ {t('满足', '充足')}</span>
    if (item.outcome === 'unknown') return <span className="requirement-pill is-unknown">{t('需确认', '要確認')}</span>
    return mode === 'follow-up' ? (
      <span className="requirement-pill is-negotiate">{t('需沟通', '要相談')}</span>
    ) : (
      <span className="requirement-pill is-conflict">✗ {t('不满足', '未充足')}</span>
    )
  }
  return (
    <table className="requirement-table" aria-label={label}>
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
          <tr key={item.requirement.id} className={`is-${item.outcome}`}>
            <th scope="row">{condition(item.requirement)}</th>
            <td>{requirementDisplayLabel(item.requirement, zh)}</td>
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
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const outcomeRank = { conflict: 0, unknown: 1, met: 2 } as const
/** 匹配依据: the technical and language requirements that decide the conclusion, then business terms already met. */
export function MatchEvidenceTab({ qualification }: { qualification?: BusinessMatchQualification }) {
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
        <RequirementTable items={[...core, ...businessMet]} mode="evidence" label={t('匹配依据', 'マッチングの根拠')} />
      ) : null}
    </div>
  )
}

/** Business terms and HR-rule questions to raise when proposing; counted only once the proposal is possible. */
export function followUpItems(qualification: BusinessMatchQualification | undefined, questions: string[] = []) {
  const sections = matchEvidenceSections(qualification, questions)
  const shown = qualification?.status === 'recommended'
  return { shown, items: shown ? sections.businessPending : [], questions: shown ? sections.questions : [] }
}

/** 需沟通: business differences do not lower the technical and language conclusion; they are settled in contact. */
export function FollowUpTab({ qualification, questions = [] }: { qualification?: BusinessMatchQualification; questions?: string[] }) {
  const { t } = useLocaleText()
  const follow = followUpItems(qualification, questions)
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
    return <p className="match-muted">{t('没有需要沟通的事项。', '相談が必要な事項はありません。')}</p>
  return (
    <div className="match-evidence">
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
