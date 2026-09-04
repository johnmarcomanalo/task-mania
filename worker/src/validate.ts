import type { Context } from 'hono'
import { z, type ZodType } from 'zod'
import { isValidDate } from './dates'
import { PRIORITIES, SOURCE_MAX_NAME } from './defaults'
import { ValidationError } from './errors'
import { repeatSchema } from './recur'

const text = (field: string, max: number) =>
  z.string(`The ${field} must be a string.`).max(max, `The ${field} may not be greater than ${max} characters.`)

const optionalText = (field: string, max: number) => text(field, max).nullable().optional()

const id = (field: string) =>
  z.number(`The ${field} field is required.`).int(`The ${field} must be an integer.`)

const due = z
  .string('The due must be a string.')
  .nullable()
  .optional()
  .refine((v) => !v || isValidDate(v), 'The due is not a valid date.')
  // Absent stays absent (an update must not clear it); '' becomes null.
  .transform((v) => (v === undefined ? undefined : v ? v : null))

const tags = z
  .array(z.string().max(32, 'The tags.* may not be greater than 32 characters.'))
  .max(6, 'The tags may not have more than 6 items.')
  .optional()

const priority = z.enum(PRIORITIES, 'The selected priority is invalid.').optional()

/** Rules shared by create, update and bulk rows — Laravel's TaskController::rules(). */
const taskFields = {
  source: text('source', SOURCE_MAX_NAME).optional(),
  sender: optionalText('sender', 120),
  due,
  priority,
  quote: optionalText('quote', 5000),
  attachments: optionalText('attachments', 255),
  tags,
  repeat: repeatSchema.nullable().optional(),
}

// A missing title is "required", not "must be a string" — the type error carries that message.
const requiredTitle = z
  .string('The title field is required.')
  .min(1, 'The title field is required.')
  .max(255, 'The title may not be greater than 255 characters.')

export const taskCreateSchema = z.object({
  column_id: id('column id'),
  title: requiredTitle,
  ...taskFields,
})

export const taskUpdateSchema = z.object({
  column_id: id('column id').optional(),
  title: requiredTitle.optional(),
  ...taskFields,
})

const bulkRow = z.object({
  column_id: id('column id'),
  title: requiredTitle,
  sender: taskFields.sender,
  due,
  priority,
  quote: taskFields.quote,
  attachments: taskFields.attachments,
  tags,
  repeat: taskFields.repeat,
})

export const bulkSchema = z.object({
  screenshot_path: z
    .string('The screenshot path must be a string.')
    .max(255, 'The screenshot path may not be greater than 255 characters.')
    .regex(/^screenshots\//, 'The screenshot path is invalid.')
    .nullable()
    .optional(),
  source: taskFields.source,
  tasks: z
    .array(bulkRow, 'The tasks field is required.')
    .min(1, 'The tasks field is required.')
    .max(20, 'The tasks may not have more than 20 items.'),
})

export const moveSchema = z.object({
  column_id: id('column id'),
  position: z
    .number('The position field is required.')
    .int('The position must be an integer.')
    .min(0, 'The position must be at least 0.'),
})

const sourceName = z
  .string('The name field is required.')
  .min(1, 'The name field is required.')
  .max(SOURCE_MAX_NAME, `The name may not be greater than ${SOURCE_MAX_NAME} characters.`)

export const sourceCreateSchema = z.object({ name: sourceName })

export const sourceUpdateSchema = z.object({
  name: sourceName.optional(),
  is_archived: z.boolean('The is archived field must be true or false.').optional(),
})

export type TaskCreate = z.infer<typeof taskCreateSchema>
export type TaskUpdate = z.infer<typeof taskUpdateSchema>
export type BulkInput = z.infer<typeof bulkSchema>
export type MoveInput = z.infer<typeof moveSchema>
export type SourceCreate = z.infer<typeof sourceCreateSchema>
export type SourceUpdate = z.infer<typeof sourceUpdateSchema>

/** Parse or throw a ValidationError keyed the way Laravel keys nested fields (tasks.0.title). */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (result.success) return result.data

  const errors: Record<string, string[]> = {}
  for (const issue of result.error.issues) {
    const key = issue.path.length ? issue.path.map(String).join('.') : '_'
    const message = issue.message.replace('tags.*', key)
    ;(errors[key] ??= []).push(message)
  }
  throw new ValidationError(errors)
}

/** The JSON body, or a 422 when it is not JSON. */
export async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    throw new ValidationError({ _: ['The request body must be JSON.'] })
  }
}
