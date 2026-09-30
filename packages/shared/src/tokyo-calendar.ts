// Business dates are Tokyo calendar days, whatever the device time zone. Keys are YYYY-MM-DD;
// day arithmetic runs on UTC dates built from those keys, so it never crosses a DST boundary.
type DateParts = { year: number; month: number; day: number }

const tokyoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

function dateParts(value: Date): DateParts {
  const values = Object.fromEntries(
    tokyoDateFormatter
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  ) as Record<string, string>
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) }
}

export function dateKey(parts: DateParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

export function tokyoDateKey(value: string | Date): string {
  return dateKey(dateParts(typeof value === 'string' ? new Date(value) : value))
}

export function dateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!))
}

export function keyFromUtcDate(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
}

export function mondayFor(key: string): string {
  const date = dateFromKey(key)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return keyFromUtcDate(date)
}

export function addDays(key: string, offset: number): string {
  const date = dateFromKey(key)
  date.setUTCDate(date.getUTCDate() + offset)
  return keyFromUtcDate(date)
}

/** Minutes since Tokyo midnight, for placing an appointment on a day grid. */
export function tokyoClockMinutes(value: string): number {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
      .formatToParts(new Date(value))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  ) as Record<string, string>
  return (Number(values.hour) % 24) * 60 + Number(values.minute)
}
