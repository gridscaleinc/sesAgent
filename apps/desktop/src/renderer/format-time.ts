import type { ApplicationLocale } from '@shared'

/**
 * Dates and times as the rest of the app shows them: in Tokyo time (the business runs on Japanese days), in the
 * interface language. 'date' → 2026/10/01, 'datetime' → 2026/10/01 14:05, 'short' → 10/1 14:05.
 */
export function formatTokyoDateTime(
  locale: ApplicationLocale,
  value: string | number | Date,
  style: 'date' | 'datetime' | 'short' = 'datetime'
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const options: Intl.DateTimeFormatOptions =
    style === 'date'
      ? { year: 'numeric', month: '2-digit', day: '2-digit' }
      : style === 'short'
        ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
        : { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
  return new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Tokyo', ...options }).format(date)
}
