import type { Task } from '../types'
import { dueMeta, today } from './dates'

export interface Filters {
  urgent: boolean
  overdue: boolean
  week: boolean
  source: string
  tag: string
}

export const NO_FILTERS: Filters = { urgent: false, overdue: false, week: false, source: '', tag: '' }

/** Whether any chip or select in the filter bar has been set away from its default. */
export function isFiltersActive(f: Filters): boolean {
  return f.urgent || f.overdue || f.week || f.source !== '' || f.tag !== ''
}

/** Narrows a task list by the quick-filter chips and selects; combines with the search box (AND). */
export function applyFilters(tasks: Task[], f: Filters): Task[] {
  return tasks.filter((t) => {
    if (f.urgent && t.priority !== 'high') return false
    if (f.overdue && !(t.due && t.due < today() && !t.done_on)) return false
    if (f.week) {
      const tone = dueMeta(t.due)?.tone
      if (t.done_on || (tone !== 'now' && tone !== 'soon')) return false
    }
    if (f.source && t.source !== f.source) return false
    if (f.tag && !t.tags.includes(f.tag)) return false
    return true
  })
}
