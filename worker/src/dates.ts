export function nowIso(): string {
  return new Date().toISOString()
}

/** Calendar date (YYYY-MM-DD) of an instant in a time zone. en-CA formats that way natively. */
export function todayIn(tz: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/** Strict YYYY-MM-DD that also exists on the calendar. */
export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}
