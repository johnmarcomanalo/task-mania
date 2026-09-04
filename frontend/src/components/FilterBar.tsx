import type { Task } from '../types'
import { dueMeta, today } from '../lib/dates'

export interface Filters {
  urgent: boolean
  overdue: boolean
  week: boolean
  source: string
  tag: string
}

/**
 * NO_FILTERS and applyFilters live here, not in a separate module, so App.tsx
 * imports the filter type, its default, and its predicate from one file
 * alongside the bar that edits it.
 */
// oxlint-disable-next-line react/only-export-components
export const NO_FILTERS: Filters = { urgent: false, overdue: false, week: false, source: '', tag: '' }

/** Narrows a task list by the quick-filter chips and selects; combines with the search box (AND). */
// oxlint-disable-next-line react/only-export-components
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

interface Props {
  value: Filters
  onChange: (f: Filters) => void
  sources: string[]
  tags: string[]
}

export function FilterBar({ value, onChange, sources, tags }: Props) {
  const active = value.urgent || value.overdue || value.week || value.source !== '' || value.tag !== ''

  return (
    <div className="filterbar">
      <button
        className={'chip' + (value.urgent ? ' chip--on' : '')}
        aria-pressed={value.urgent}
        onClick={() => onChange({ ...value, urgent: !value.urgent })}
      >
        Urgent
      </button>
      <button
        className={'chip' + (value.overdue ? ' chip--on' : '')}
        aria-pressed={value.overdue}
        onClick={() => onChange({ ...value, overdue: !value.overdue })}
      >
        Overdue
      </button>
      <button
        className={'chip' + (value.week ? ' chip--on' : '')}
        aria-pressed={value.week}
        onClick={() => onChange({ ...value, week: !value.week })}
      >
        This week
      </button>

      <select
        className="input mini"
        aria-label="Filter by source"
        value={value.source}
        onChange={(e) => onChange({ ...value, source: e.target.value })}
      >
        <option value="">All sources</option>
        {sources.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <select
        className="input mini"
        aria-label="Filter by tag"
        value={value.tag}
        onChange={(e) => onChange({ ...value, tag: e.target.value })}
      >
        <option value="">All tags</option>
        {tags.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      {active && (
        <button
          className="btn btn-ghost"
          onClick={() => onChange(NO_FILTERS)}
          style={{ fontSize: 11, minHeight: 24, padding: '0 8px' }}
        >
          Clear
        </button>
      )}
    </div>
  )
}
