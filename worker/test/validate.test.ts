import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/errors'
import {
  bulkSchema, moveSchema, parse, sourceCreateSchema, taskCreateSchema, taskUpdateSchema,
} from '../src/validate'

function errorsOf(fn: () => unknown): Record<string, string[]> {
  try {
    fn()
  } catch (e) {
    if (e instanceof ValidationError) return e.errors
    throw e
  }
  throw new Error('expected a ValidationError')
}

describe('validate', () => {
  it('requires column_id and title on create', () => {
    const errors = errorsOf(() => parse(taskCreateSchema, {}))
    expect(errors.column_id).toEqual(['The column id field is required.'])
    expect(errors.title).toEqual(['The title field is required.'])
  })

  it('uses the first error as the message, Laravel style', () => {
    try {
      parse(taskCreateSchema, { column_id: 1 })
    } catch (e) {
      expect((e as ValidationError).message).toBe('The title field is required.')
    }
  })

  it('normalises an empty due date to null and rejects bad ones', () => {
    expect(parse(taskCreateSchema, { column_id: 1, title: 'x', due: '' }).due).toBeNull()
    expect(parse(taskCreateSchema, { column_id: 1, title: 'x', due: '2026-09-04' }).due).toBe('2026-09-04')
    expect(errorsOf(() => parse(taskCreateSchema, { column_id: 1, title: 'x', due: 'soon' })).due)
      .toEqual(['The due is not a valid date.'])
  })

  it('caps tags at six of 32 characters', () => {
    expect(errorsOf(() => parse(taskUpdateSchema, { tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).tags)
      .toEqual(['The tags may not have more than 6 items.'])
    expect(errorsOf(() => parse(taskUpdateSchema, { tags: ['x'.repeat(33)] }))['tags.0'])
      .toEqual(['The tags.0 may not be greater than 32 characters.'])
  })

  it('rejects an unknown priority', () => {
    expect(errorsOf(() => parse(taskUpdateSchema, { priority: 'urgent' })).priority)
      .toEqual(['The selected priority is invalid.'])
  })

  it('validates bulk rows by index', () => {
    const errors = errorsOf(() =>
      parse(bulkSchema, { screenshot_path: 'attachments/x.png', tasks: [{ column_id: 1, title: '' }] }),
    )
    expect(errors.screenshot_path).toEqual(['The screenshot path is invalid.'])
    expect(errors['tasks.0.title']).toEqual(['The title field is required.'])
    expect(errorsOf(() => parse(bulkSchema, { tasks: [] })).tasks).toEqual(['The tasks field is required.'])
  })

  it('validates move and source inputs', () => {
    expect(errorsOf(() => parse(moveSchema, { column_id: 1, position: -1 })).position)
      .toEqual(['The position must be at least 0.'])
    expect(errorsOf(() => parse(sourceCreateSchema, { name: 'x'.repeat(25) })).name)
      .toEqual(['The name may not be greater than 24 characters.'])
  })

  it('drops keys it does not know', () => {
    const out = parse(taskUpdateSchema, { title: 'ok', board_id: 42 }) as Record<string, unknown>
    expect(out).toEqual({ title: 'ok' })
  })
})
