import { describe, expect, it } from 'vitest'
import { isValidDate, nowIso, todayIn } from '../src/dates'

describe('dates', () => {
  it('formats today in the given time zone', () => {
    // 23:30 UTC is already the next day in Manila (UTC+8).
    expect(todayIn('Asia/Manila', new Date('2026-09-03T23:30:00Z'))).toBe('2026-09-04')
    expect(todayIn('UTC', new Date('2026-09-03T23:30:00Z'))).toBe('2026-09-03')
  })

  it('emits ISO-8601 UTC timestamps', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('accepts real calendar dates only', () => {
    expect(isValidDate('2026-02-28')).toBe(true)
    expect(isValidDate('2026-02-30')).toBe(false)
    expect(isValidDate('2026-9-3')).toBe(false)
    expect(isValidDate('yesterday')).toBe(false)
  })
})
