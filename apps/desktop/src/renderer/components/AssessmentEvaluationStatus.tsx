import { localeText } from '../i18n'
import type { CasePersonAssessment } from '@shared'

export function AssessmentEvaluationStatus({ value, zh }: { value: CasePersonAssessment; zh: boolean }) {
  const t = localeText(zh)
  const { cloud, result } = value
  // A batch may be partially reviewed. Use the individual person's actual
  // assessment to decide whether this card received a valid model response.
  if (result.assessment) {
    // The AI's free-text opinion is not kept (it cannot be checked); what it contributes is quoting this person's
    // material to settle requirements the local check could not. Say how many, so a finished review is not blank.
    const settled = result.qualification?.requirements.filter((item) => item.aiVerified).length ?? 0
    return (
      <p>
        {t('已完成云端 AI 评估', 'Cloud AI評価済み')}
        {cloud.modelName ? ` · ${cloud.modelName}` : ''}
        {' · '}
        {settled
          ? t(
              `AI 引用简历原文核实了 ${settled} 项条件（已在上方标注「AI 核实」）。`,
              `AIが履歴書の原文で ${settled} 件の条件を確認しました（上に「AI確認」と表示）。`
            )
          : t('AI 核对了简历原文，没有改变本地核对的结论。', 'AIが履歴書の原文を確認し、ローカル照合の結論は変わりませんでした。')}
      </p>
    )
  }
  if (cloud.reason === 'policy-refresh')
    return (
      <p>
        {t(
          '已按新规则完成本地重算，本次未调用云端 AI。点击“重新评估”可进行云端评估。',
          '新ルールでローカル再計算済みです。今回はCloud AIを呼び出していません。「再評価」でCloud評価を実行できます。'
        )}
      </p>
    )
  if (cloud.reason === 'service-unavailable')
    return (
      <p>
        {t(
          'AI 服务暂不可用，本次仅完成本地规则核对。连接 AI 后可重新评估。',
          'AIサービスを利用できないため、今回はローカル照合のみです。AI接続後に再評価できます。'
        )}
      </p>
    )
  if (cloud.reason === 'no-valid-result' || cloud.status === 'partial')
    return (
      <p>
        {t(
          '云端未返回此人的有效评估，当前显示本地核对结果。可重新评估。',
          'この要員の有効なCloud評価が返されませんでした。ローカル照合結果を表示しています。再評価できます。'
        )}
      </p>
    )
  if (cloud.status === 'failed')
    return (
      <p>
        {t(
          '云端 AI 评估未成功，当前显示本地核对结果。可重新评估。',
          'Cloud AI評価に失敗したため、ローカル照合結果を表示しています。再評価できます。'
        )}
      </p>
    )
  // Historical records did not store the reason. Do not invent connection or
  // request history from the old catch-all status.
  return (
    <p>
      {t(
        '当前显示本地规则核对结果，未记录本次有效的云端 AI 评估。',
        'ローカル照合結果を表示しています。今回の有効なCloud AI評価は記録されていません。'
      )}
    </p>
  )
}
