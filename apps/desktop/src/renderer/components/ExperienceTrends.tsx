import type { ExperienceTrend } from '@shared'
export function ExperienceTrends({ rows, zh }: { rows: ExperienceTrend[]; zh: boolean }) {
  const t = (cn: string, ja: string) => (zh ? cn : ja),
    rate = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`)
  return (
    <details className="experience-trends">
      <summary>{t('按业务范围查看近期变化', '業務範囲ごとの最近の変化')}</summary>
      <p>
        {t(
          '比较最近两周与此前两周。同一人员或案件只计一次；至少各五个独立样本才显示趋势。匹配统计有明确技术理由的负面反馈，文案和问题统计实质改写。不同案件难度会影响结果。',
          '直近二週間とその前の二週間を比較します。同じ要員・案件は一度だけ数え、各期間に独立した記録が五件以上ある場合に傾向を表示します。マッチングは技術的理由のある否定評価、文面と質問は実質的な修正を集計します。案件の難易度も影響します。'
        )}
      </p>
      {!rows.length ? (
        <p>{t('还没有可比较的业务记录。', '比較できる業務記録はまだありません。')}</p>
      ) : (
        rows.map((row, index) => (
          <article className="work-rule-card" key={index}>
            <strong>
              {row.scope.label.split(' / ')[zh ? 0 : 1] ?? row.scope.label} ·{' '}
              {row.task === 'matching'
                ? t('匹配', 'マッチング')
                : row.task === 'interview'
                  ? t('面试问题', '面談質問')
                  : t('介绍文', '紹介文')}
            </strong>
            <p>
              {t('此前两周', 'その前の二週間')}：{row.previous.count} · {rate(row.previous.badRate)} → {t('最近两周', '直近二週間')}：
              {row.recent.count} · {rate(row.recent.badRate)}
            </p>
            <p>
              {row.state === 'insufficient'
                ? t('样本不足', '記録不足')
                : row.state === 'declining'
                  ? t('修改或明确负面反馈增加', '修正または明示的な否定評価が増加')
                  : row.state === 'improving'
                    ? t('修改或明确负面反馈减少', '修正または明示的な否定評価が減少')
                    : t('暂未出现明显变化', '大きな変化はありません')}
            </p>
            <small>
              {t('最近基本方法／采用经验的样本', '最近の基本手順／経験適用の記録')}：{row.recent.baseline}/{row.recent.assisted}
            </small>
          </article>
        ))
      )}
    </details>
  )
}
