import { z } from 'zod'

/** 0 = Sunday … 6 = Saturday, as JavaScript counts. */
export type RepeatRule =
  | { freq: 'weekly'; weekday: number }
  | { freq: 'monthly'; day: number }
  | { freq: 'monthly'; nth: 1 | 2 | 3 | 4 | -1; weekday: number }

const weekday = z.number('The repeat weekday must be a number.').int().min(0, 'The repeat weekday is invalid.').max(6, 'The repeat weekday is invalid.')

export const repeatSchema = z.union([
  z.object({ freq: z.literal('weekly'), weekday }),
  z.object({ freq: z.literal('monthly'), day: z.number('The repeat day must be a number.').int().min(1, 'The repeat day is invalid.').max(31, 'The repeat day is invalid.') }),
  z.object({ freq: z.literal('monthly'), nth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)], 'The repeat week is invalid.'), weekday }),
], 'The repeat rule is invalid.')

export function parseRule(text: string | null): RepeatRule | null {
  if (!text) return null
  try {
    const r = repeatSchema.safeParse(JSON.parse(text))
    return r.success ? (r.data as RepeatRule) : null
  } catch {
    return null
  }
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const NTH: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', [-1]: 'last' }

/** 1st, 2nd, 3rd, 4th…10th, then 11th–13th stay "th" before 21st, 22nd, 23rd, 31st resume the pattern. */
export function ordinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd']
  const teens = n % 100
  const suffix = teens >= 11 && teens <= 13 ? 'th' : (suffixes[n % 10] ?? 'th')
  return `${n}${suffix}`
}

export function describe(rule: RepeatRule): string {
  if (rule.freq === 'weekly') return `every ${WEEKDAYS[rule.weekday]}`
  if ('day' in rule) return `every month on the ${ordinal(rule.day)}`
  return `every ${NTH[rule.nth]} ${WEEKDAYS[rule.weekday]}`
}

/* ---- calendar math on YYYY-MM-DD strings, UTC only ---- */

const parts = (s: string) => s.split('-').map(Number) as [number, number, number]
const fmt = (d: Date) => d.toISOString().slice(0, 10)
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** The Nth (1–4) or last (-1) `weekday` of month m of year y. */
function nthWeekday(y: number, m: number, nth: number, weekday: number): Date {
  if (nth === -1) {
    const last = utc(y, m, daysInMonth(y, m))
    return utc(y, m, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7))
  }
  const first = utc(y, m, 1)
  const offset = (weekday - first.getUTCDay() + 7) % 7
  return utc(y, m, 1 + offset + (nth - 1) * 7)
}

/** The first date matching the rule strictly after `after`. */
export function nextDue(rule: RepeatRule, after: string): string {
  const [y, m, d] = parts(after)
  const base = utc(y, m, d)

  if (rule.freq === 'weekly') {
    const delta = ((rule.weekday - base.getUTCDay() + 7) % 7) || 7
    return fmt(utc(y, m, d + delta))
  }

  for (let k = 0; k < 2; k++) {
    const mm = m + k
    const yy = y + Math.floor((mm - 1) / 12)
    const month = ((mm - 1) % 12) + 1
    const candidate = 'day' in rule
      ? utc(yy, month, Math.min(rule.day, daysInMonth(yy, month)))
      : nthWeekday(yy, month, rule.nth, rule.weekday)
    if (candidate > base) return fmt(candidate)
  }
  throw new Error('unreachable: a monthly rule always matches within two months')
}
