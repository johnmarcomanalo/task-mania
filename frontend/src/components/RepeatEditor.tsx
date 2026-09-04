import type { RepeatRule } from '../types'
import { NTH_OPTIONS, WEEKDAYS, dateParts, describeRule } from '../lib/recur'

interface Props {
  value: RepeatRule | null | undefined
  due: string
  onChange: (rule: RepeatRule | null) => void
}

/** Mon…Sun order, values 1,2,3,4,5,6,0 — how people read a week. */
const WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((v) => ({ value: v, label: WEEKDAYS[v] }))

export function RepeatEditor({ value, due, onChange }: Props) {
  const parts = dateParts(due)
  const kind = !value ? 'none' : value.freq

  const onDay = value?.freq === 'monthly' && 'day' in value
  const day = value?.freq === 'monthly' && 'day' in value ? value.day : parts.day
  const nth = value?.freq === 'monthly' && 'nth' in value ? value.nth : 1
  const nthWeekday = value?.freq === 'monthly' && 'nth' in value ? value.weekday : parts.weekday

  return (
    <div className="repeat">
      <select
        className="input mini"
        aria-label="Repeat"
        value={kind}
        onChange={(e) => {
          const next = e.target.value
          if (next === 'weekly') onChange({ freq: 'weekly', weekday: parts.weekday })
          else if (next === 'monthly') onChange({ freq: 'monthly', day: parts.day })
          else onChange(null)
        }}
      >
        <option value="none">None</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </select>

      {value?.freq === 'weekly' && (
        <div className="repeat__row">
          <select
            className="input mini"
            aria-label="Weekday"
            value={value.weekday}
            onChange={(e) => onChange({ freq: 'weekly', weekday: Number(e.target.value) })}
          >
            {WEEKDAY_OPTIONS.map((w) => (
              <option key={w.value} value={w.value}>{w.label}</option>
            ))}
          </select>
        </div>
      )}

      {value?.freq === 'monthly' && (
        <>
          <div className="repeat__row">
            <input
              type="radio"
              name="repeat-monthly-mode"
              aria-label="On a day of the month"
              checked={onDay}
              onChange={() => onChange({ freq: 'monthly', day })}
            />
            on day
            <select
              className="input mini"
              aria-label="Day of month"
              value={day}
              disabled={!onDay}
              onChange={(e) => onChange({ freq: 'monthly', day: Number(e.target.value) })}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div className="repeat__row">
            <input
              type="radio"
              name="repeat-monthly-mode"
              aria-label="On a weekday of the month"
              checked={!onDay}
              onChange={() => onChange({ freq: 'monthly', nth: 1, weekday: parts.weekday })}
            />
            on the
            <select
              className="input mini"
              aria-label="Week of month"
              value={nth}
              disabled={onDay}
              onChange={(e) => onChange({ freq: 'monthly', nth: Number(e.target.value) as 1 | 2 | 3 | 4 | -1, weekday: nthWeekday })}
            >
              {NTH_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              className="input mini"
              aria-label="Weekday"
              value={nthWeekday}
              disabled={onDay}
              onChange={(e) => onChange({ freq: 'monthly', nth, weekday: Number(e.target.value) })}
            >
              {WEEKDAY_OPTIONS.map((w) => (
                <option key={w.value} value={w.value}>{w.label}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {value && <span className="repeat__hint">{describeRule(value)}</span>}
    </div>
  )
}
