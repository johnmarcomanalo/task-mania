import type { RepeatRule } from '../types'

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const NTH_OPTIONS: { value: 1 | 2 | 3 | 4 | -1; label: string }[] = [
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
  { value: 4, label: '4th' },
  { value: -1, label: 'last' },
]

/** 1st, 2nd, 3rd, 4th…10th, then 11th–13th stay "th" before 21st, 22nd, 23rd, 31st resume the pattern. */
export function ordinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd']
  const teens = n % 100
  const suffix = teens >= 11 && teens <= 13 ? 'th' : (suffixes[n % 10] ?? 'th')
  return `${n}${suffix}`
}

function nthLabel(nth: number): string {
  return NTH_OPTIONS.find((o) => o.value === nth)?.label ?? ''
}

export function describeRule(rule: RepeatRule): string {
  if (rule.freq === 'weekly') return `every ${WEEKDAYS[rule.weekday]}`
  if ('day' in rule) return `every month on the ${ordinal(rule.day)}`
  return `every ${nthLabel(rule.nth)} ${WEEKDAYS[rule.weekday]}`
}

export function badgeText(rule: RepeatRule): string {
  if (rule.freq === 'weekly') return `↻ ${WEEKDAYS_SHORT[rule.weekday]}`
  if ('day' in rule) return `↻ ${ordinal(rule.day)}`
  return `↻ ${nthLabel(rule.nth)} ${WEEKDAYS_SHORT[rule.weekday]}`
}

/** Weekday (0–6) and day-of-month of a YYYY-MM-DD, or of today when empty. */
export function dateParts(due: string): { weekday: number; day: number } {
  if (!due) {
    const d = new Date()
    return { weekday: d.getDay(), day: d.getDate() }
  }
  const [y, m, d] = due.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return { weekday: date.getDay(), day: date.getDate() }
}
