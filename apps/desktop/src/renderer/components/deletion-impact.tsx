import type { CandidateDeletionPreview, JobCaseDeletionPreview } from '@shared'
import { useLocaleText } from '../i18n'

type Counts = CandidateDeletionPreview['counts'] | JobCaseDeletionPreview['counts']

/**
 * The business records a permanent deletion takes with it, beyond the source data each dialog already lists:
 * follow-ups (and ended placements among them), introductions, broadcasts, decisions, opportunities… The same list
 * in every delete dialog, so no entry point deletes more than it showed.
 */
export function useDeletionBusinessCounts(counts: Counts | null | undefined): Array<[string, number]> {
  const { t } = useLocaleText()
  if (!counts) return []
  const value = (key: string) => {
    const raw = (counts as Record<string, unknown>)[key]
    return typeof raw === 'number' ? raw : 0
  }
  return (
    [
      ['businessFollowUps', t('跟进记录', '対応記録')],
      ['endedPlacements', t('其中已退场记录', 'うち退場済みの記録')],
      ['introductionDrafts', t('人员介绍草稿', '要員紹介の下書き')],
      ['caseBroadcastCopies', t('群发记录', '配信記録')],
      ['caseIntroductionDrafts', t('案件介绍草稿', '案件紹介の下書き')],
      ['recommendationPoints', t('推荐要点', '推薦ポイント')],
      ['matchingOpportunities', t('匹配机会', 'マッチング機会')],
      ['requirementDecisions', t('要求判定', '要件の判断')],
      ['questionDrafts', t('面试问题草稿', '面談質問の下書き')],
      ['personAssessments', t('人员评估', '要員評価')]
    ] as const
  ).flatMap(([key, label]): Array<[string, number]> => (value(key) > 0 ? [[label, value(key)]] : []))
}

/** Someone in place through this case (or this person in place): deleting is refused until they leave. */
export function deletionBlockedByPlacement(counts: Counts | null | undefined): number {
  const raw = counts ? (counts as Record<string, unknown>).activePlacements : 0
  return typeof raw === 'number' ? raw : 0
}

export function DeletionPlacementBlock({ kind, counts }: { kind: 'case' | 'person'; counts: Counts | null | undefined }) {
  const { t } = useLocaleText()
  const placed = deletionBlockedByPlacement(counts)
  if (!placed) return null
  return (
    <p role="alert" className="business-delete-blocked">
      {kind === 'case'
        ? t(
            `有 ${placed} 名人员通过这个案件处于已进场。请先在跟进中记录退场或撤销进场，再删除案件。`,
            `この案件で参画中の要員が ${placed} 名います。対応記録で退場または参画取消を記録してから削除してください。`
          )
        : t(
            '这个人员还处于已进场。请先在跟进中记录退场或撤销进场，再删除。',
            'この要員は参画中です。対応記録で退場または参画取消を記録してから削除してください。'
          )}
    </p>
  )
}

/** The business records as list items, for the dialogs that list impact as 「… N 项」. */
export function DeletionBusinessCountItems({ counts }: { counts: Counts | null | undefined }) {
  const { t } = useLocaleText()
  return (
    <>
      {useDeletionBusinessCounts(counts).map(([label, value]) => (
        <li key={label}>{t(`${label} ${value} 项`, `${label} ${value}件`)}</li>
      ))}
    </>
  )
}
