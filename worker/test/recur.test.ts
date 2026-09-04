import { describe, expect, it } from 'vitest'
import { describe as describeRule, nextDue, parseRule } from '../src/recur'
import { parse, taskUpdateSchema } from '../src/validate'
import { ValidationError } from '../src/errors'

describe('nextDue', () => {
  it('weekly: the next matching weekday strictly after the date', () => {
    expect(nextDue({ freq: 'weekly', weekday: 4 }, '2026-09-03')).toBe('2026-09-10') // Thu → next Thu
    expect(nextDue({ freq: 'weekly', weekday: 5 }, '2026-09-03')).toBe('2026-09-04') // Thu → Fri
    expect(nextDue({ freq: 'weekly', weekday: 3 }, '2026-09-03')).toBe('2026-09-09')
    expect(nextDue({ freq: 'weekly', weekday: 1 }, '2026-12-29')).toBe('2027-01-04') // across the year
  })

  it('monthly by day: same day next month, clamped to short months', () => {
    expect(nextDue({ freq: 'monthly', day: 15 }, '2026-09-03')).toBe('2026-09-15')
    expect(nextDue({ freq: 'monthly', day: 15 }, '2026-09-15')).toBe('2026-10-15')
    expect(nextDue({ freq: 'monthly', day: 31 }, '2026-01-31')).toBe('2026-02-28')
    expect(nextDue({ freq: 'monthly', day: 31 }, '2028-01-31')).toBe('2028-02-29') // leap year
    expect(nextDue({ freq: 'monthly', day: 31 }, '2026-02-28')).toBe('2026-03-31')
    expect(nextDue({ freq: 'monthly', day: 1 }, '2026-12-01')).toBe('2027-01-01')
  })

  it('monthly by nth weekday, including last', () => {
    expect(nextDue({ freq: 'monthly', nth: 2, weekday: 1 }, '2026-09-03')).toBe('2026-09-14') // 2nd Monday
    expect(nextDue({ freq: 'monthly', nth: 2, weekday: 1 }, '2026-09-14')).toBe('2026-10-12')
    expect(nextDue({ freq: 'monthly', nth: -1, weekday: 5 }, '2026-09-03')).toBe('2026-09-25') // last Friday
    expect(nextDue({ freq: 'monthly', nth: 4, weekday: 2 }, '2026-09-29')).toBe('2026-10-27') // 4th Tuesday
    expect(nextDue({ freq: 'monthly', nth: 1, weekday: 0 }, '2026-10-31')).toBe('2026-11-01')
  })
})

describe('describe / parseRule', () => {
  it('reads like the UI', () => {
    expect(describeRule({ freq: 'weekly', weekday: 4 })).toBe('every Thursday')
    expect(describeRule({ freq: 'monthly', day: 15 })).toBe('every month on the 15th')
    expect(describeRule({ freq: 'monthly', day: 1 })).toBe('every month on the 1st')
    expect(describeRule({ freq: 'monthly', day: 22 })).toBe('every month on the 22nd')
    expect(describeRule({ freq: 'monthly', nth: 2, weekday: 1 })).toBe('every 2nd Monday')
    expect(describeRule({ freq: 'monthly', nth: -1, weekday: 5 })).toBe('every last Friday')
  })

  it('parses stored JSON and rejects garbage', () => {
    expect(parseRule('{"freq":"weekly","weekday":4}')).toEqual({ freq: 'weekly', weekday: 4 })
    expect(parseRule('{"freq":"monthly","day":40}')).toBeNull()
    expect(parseRule('{"freq":"daily"}')).toBeNull()
    expect(parseRule('not json')).toBeNull()
    expect(parseRule(null)).toBeNull()
  })
})

describe('repeat validation', () => {
  const bad = (body: unknown) => {
    try { parse(taskUpdateSchema, body) } catch (e) { return (e as ValidationError).errors }
    throw new Error('expected 422')
  }
  it('accepts the three shapes and null', () => {
    expect(parse(taskUpdateSchema, { repeat: { freq: 'weekly', weekday: 0 } }).repeat).toEqual({ freq: 'weekly', weekday: 0 })
    expect(parse(taskUpdateSchema, { repeat: { freq: 'monthly', day: 31 } }).repeat).toEqual({ freq: 'monthly', day: 31 })
    expect(parse(taskUpdateSchema, { repeat: { freq: 'monthly', nth: -1, weekday: 6 } }).repeat).toEqual({ freq: 'monthly', nth: -1, weekday: 6 })
    expect(parse(taskUpdateSchema, { repeat: null }).repeat).toBeNull()
  })
  it('rejects wrong shapes with a repeat error', () => {
    expect(Object.keys(bad({ repeat: { freq: 'weekly', weekday: 7 } }))[0]).toMatch(/^repeat/)
    expect(Object.keys(bad({ repeat: { freq: 'monthly', day: 0 } }))[0]).toMatch(/^repeat/)
    expect(Object.keys(bad({ repeat: { freq: 'monthly', nth: 5, weekday: 1 } }))[0]).toMatch(/^repeat/)
    expect(Object.keys(bad({ repeat: { freq: 'yearly' } }))[0]).toMatch(/^repeat/)
  })
})
