import type { CandidateProfileSearchResult } from '@shared'

type HardFilter = CandidateProfileSearchResult['retrieval']['hardFilters'][number]

const hardFilterLabels: Record<HardFilter['type'], string> = {
  'minimum-experience-years': '経験',
  'maximum-rate': '単価',
  'availability-by': '稼働',
  'remote-work': '勤務',
  'japanese-level': '日本語',
  location: '勤務地',
  'work-authorization': '就労資格'
}

export function CandidateHardFilterEvidence({ filters }: { filters: HardFilter[] }) {
  if (filters.length === 0) return null
  return (
    <div className="candidate-hard-filter-evidence" aria-label="硬条件の確認結果">
      {filters.map((filter) => (
        <div className={`is-${filter.outcome}`} key={`${filter.type}:${filter.requested}`}>
          <span>{hardFilterLabels[filter.type]}</span>
          <strong>{filter.requested}</strong>
          <small>
            {filter.outcome === 'passed'
              ? `確認済み · ${filter.actual}`
              : filter.outcome === 'failed'
                ? `不一致 · ${filter.actual}`
                : `未確認 · ${filter.actual ?? '候補者資料に記載なし'}`}
          </small>
        </div>
      ))}
    </div>
  )
}
