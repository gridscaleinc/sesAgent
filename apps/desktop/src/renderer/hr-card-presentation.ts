import type { BusinessFeedEntry } from '@shared'

/** Presentation only: retain OR expressions and punctuation inside parentheses. */
export function cardSkillItems(value: string): string[] {
  const lines = value.split(/[\n;；]+/u).map((line) => line.trim().replace(/^[・•●■]\s*|^[-*]\s+/u, '')).filter(Boolean)
  if (lines.length > 1) return lines
  return lines.flatMap((line) => {
    if (/(?:\bor\b|或者?|または|又は|もしくは|いずれか)/iu.test(line)) return [line]
    let depth = 0, start = 0
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

const changeNames: Record<string, [string, string]> = {
  rate: ['单价', '単価'], availability: ['入场时间', '稼働時期'], start_date: ['开始时间', '開始時期'],
  skills: ['技能', 'スキル'], required_skills: ['必需技能', '必須スキル'], preferred_skills: ['加分技能', '尚可スキル'],
  work_style: ['工作方式', '勤務形態'], remote: ['工作方式', '勤務形態'], location: ['地点', '勤務地'],
  japanese_level: ['日语', '日本語'],
  experience_years: ['经验年限', '経験年数'], role: ['角色', '職種']
}

export function cardChangeLabels(entry: BusinessFeedEntry, zh: boolean): string[] {
  if (!entry.unseen || entry.event !== 'updated') return []
  return [...new Set(entry.changes.flatMap(({ key, before, after }) => {
    const names = changeNames[key]
    const oldValue = before?.trim() ?? '', newValue = after?.trim() ?? ''
    if (!names || oldValue === newValue) return []
    const name = names[zh ? 0 : 1]
    if (!oldValue) return [zh ? `${name}补充` : `${name}を追加`]
    if (!newValue) return [zh ? `${name}清空` : `${name}を削除`]
    return [zh ? `${name}${key === 'rate' ? '调整' : '更新'}` : `${name}を変更`]
  }))]
}
