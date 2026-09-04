import { NO_FILTERS, isFiltersActive, type Filters } from '../lib/filters'

interface Props {
  value: Filters
  onChange: (f: Filters) => void
  sources: string[]
  tags: string[]
}

export function FilterBar({ value, onChange, sources, tags }: Props) {
  const active = isFiltersActive(value)

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
