import type { BusinessFeedEntry } from '@shared'
import { localeText } from './i18n'

/** Presentation only: retain OR expressions and punctuation inside parentheses. */
export function cardSkillItems(value: string): string[] {
  const lines = value
    .split(/[\n;；]+/u)
    .map((line) => line.trim().replace(/^[・•●■]\s*|^[-*]\s+/u, ''))
    .filter(Boolean)
  if (lines.length > 1) return lines
  return lines.flatMap((line) => {
    if (/(?:\bor\b|或者?|または|又は|もしくは|いずれか)/iu.test(line)) return [line]
    let depth = 0,
      start = 0
    const parts: string[] = []
    for (let index = 0; index < line.length; index++) {
      if ('(（[［'.includes(line[index]!)) depth++
      if (')）]］'.includes(line[index]!)) depth = Math.max(0, depth - 1)
      if (!depth && ',，、'.includes(line[index]!)) {
        const part = line.slice(start, index).trim()
        if (part) parts.push(part)
        start = index + 1
      }
    }
    const last = line.slice(start).trim()
    if (last) parts.push(last)
    return parts
  })
}

const changeNames: Record<string, { zh: string; ja: string }> = {
  rate: { zh: '单价', ja: '単価' },
  availability: { zh: '入场时间', ja: '稼働時期' },
  start_date: { zh: '开始时间', ja: '開始時期' },
  skills: { zh: '技能', ja: 'スキル' },
  required_skills: { zh: '必需技能', ja: '必須スキル' },
  preferred_skills: { zh: '加分技能', ja: '尚可スキル' },
  work_style: { zh: '工作方式', ja: '勤務形態' },
  remote: { zh: '工作方式', ja: '勤務形態' },
  location: { zh: '地点', ja: '勤務地' },
  japanese_level: { zh: '日语', ja: '日本語' },
  experience_years: { zh: '经验年限', ja: '経験年数' },
  role: { zh: '角色', ja: '職種' }
}

export function cardChangeLabels(entry: BusinessFeedEntry, zh: boolean): string[] {
  if (!entry.unseen || entry.event !== 'updated') return []
  return [
    ...new Set(
      entry.changes.flatMap(({ key, before, after }) => {
        const names = changeNames[key]
        const oldValue = before?.trim() ?? '',
          newValue = after?.trim() ?? ''
        if (!names || oldValue === newValue) return []
        const t = localeText(zh),
          name = t(names.zh, names.ja)
        if (!oldValue) return [t(`${name}补充`, `${name}を追加`)]
        if (!newValue) return [t(`${name}清空`, `${name}を削除`)]
        return [t(`${name}${key === 'rate' ? '调整' : '更新'}`, `${name}を変更`)]
      })
    )
  ]
}
