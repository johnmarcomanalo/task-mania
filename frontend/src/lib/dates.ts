import type { Task } from '../types'

const DAY = 86_400_000

export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function today(): string {
  return iso(new Date())
}

export function shiftDay(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return iso(d)
}

export type DueTone = 'late' | 'now' | 'soon' | 'later'

/** The deadline bucket a task falls in, used by the badge and its colour. */
export function dueMeta(due: string): { badge: string; tone: DueTone } | null {
  if (!due) return null
  const t = today()
  if (due < t) return { badge: 'Overdue', tone: 'late' }
  if (due === t) return { badge: 'Today', tone: 'now' }
  if (due <= shiftDay(6)) return { badge: 'This week', tone: 'soon' }
  return { badge: 'Later', tone: 'later' }
}

/** Short label shown on a card. */
export function dueLabel(due: string): string {
  if (!due) return ''
  const t = today()
  if (due === t) return 'Today'
  if (due === shiftDay(1)) return 'Tomorrow'
  if (due < t) return `Overdue ${due.slice(5)}`
  return due.slice(5)
}

export function formatWhen(isoString: string): string {
  const d = new Date(isoString)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'just now'
  if (diff < DAY) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  if (diff < 7 * DAY) {
    return d.toLocaleDateString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export interface Streak {
  streak: number
  doneToday: number
  week: { label: string; count: number }[]
}

/**
 * Completion streak and the last seven days of finished work, from each task's
 * done_on date.
 */
export function streakInfo(tasks: Task[]): Streak {
  const set: Record<string, number> = {}
  tasks.forEach((t) => {
    if (t.done_on) set[t.done_on] = (set[t.done_on] ?? 0) + 1
  })

  let streak = 0
  for (let i = 0; i < 365; i++) {
    const day = shiftDay(-i)
    if (set[day]) streak++
    else if (i > 0) break
  }

  const week = []
  for (let i = 6; i >= 0; i--) {
    const day = shiftDay(-i)
    week.push({ label: day, count: set[day] ?? 0 })
  }

  return { streak, doneToday: set[today()] ?? 0, week }
}
