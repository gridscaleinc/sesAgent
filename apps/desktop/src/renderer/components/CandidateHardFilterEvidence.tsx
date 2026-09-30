import type { CandidateProfileSearchResult } from '@shared'
import { useLocaleText } from '../i18n'

type HardFilter = CandidateProfileSearchResult['retrieval']['hardFilters'][number]

const hardFilterLabels: Record<HardFilter['type'], { zh: string; ja: string }> = {
  'minimum-experience-years': { zh: '经验', ja: '経験' },
  'maximum-rate': { zh: '单价', ja: '単価' },
  'availability-by': { zh: '入场时间', ja: '稼働' },
  'remote-work': { zh: '工作方式', ja: '勤務' },
  'japanese-level': { zh: '日文', ja: '日本語' },
  location: { zh: '工作地点', ja: '勤務地' },
  'work-authorization': { zh: '工作资格', ja: '就労資格' },
  'own-company': { zh: '是否自社', ja: '自社所属' }
}

export function CandidateHardFilterEvidence({ filters }: { filters: HardFilter[] }) {
  const { zh, t } = useLocaleText()
  if (filters.length === 0) return null
  return (
    <div className="candidate-hard-filter-evidence" aria-label={t('硬条件确认结果', '硬条件の確認結果')}>
      {filters.map((filter) => (
        <div className={`is-${filter.outcome}`} key={`${filter.type}:${filter.requested}`}>
          <span>{zh ? hardFilterLabels[filter.type].zh : hardFilterLabels[filter.type].ja}</span>
          <strong>{filter.requested}</strong>
          <small>
            {filter.outcome === 'passed'
              ? `${t('已确认', '確認済み')} · ${filter.actual}`
              : filter.outcome === 'failed'
                ? `${t('不匹配', '不一致')} · ${filter.actual ?? t('未设置', '未設定')}`
                : `${t('未确认', '未確認')} · ${filter.actual ?? t('人员资料中未记载', '候補者資料に記載なし')}`}
          </small>
        </div>
      ))}
    </div>
  )
}
