import type { KeyboardEvent } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Task } from '../types'
import { dueLabel, dueMeta } from '../lib/dates'
import { badgeText, describeRule } from '../lib/recur'

interface BodyProps {
  task: Task
  /** The task's lane: terminal ('done'/'cancelled'), or open (null). */
  closed: 'done' | 'cancelled' | null
}

/** Shared by the board and the drag overlay so the two cannot drift apart. */
export function TaskCardBody({ task, closed }: BodyProps) {
  const meta = dueMeta(task.due)
  const urgent = meta?.tone === 'late' || meta?.tone === 'now'

  return (
    <>
      <div className="tcard__top">
        <span className="tcard__source">{task.source}</span>
        {task.priority === 'high' && <span className="tag tag-accent urgent-pill">Urgent</span>}
        {task.repeat && (
          <span className="tcard__repeat" title={describeRule(task.repeat)}>{badgeText(task.repeat)}</span>
        )}
        <span style={{ flex: 1 }} />
        {task.shot && <span className="tcard__shot" title="Read from a screenshot">SHOT</span>}
      </div>

      <div className={closed ? 'tcard__title tcard__title--done' : 'tcard__title'}>{task.title}</div>

      {task.quote && <div className="tcard__quote">{task.quote}</div>}

      {(task.sender || task.due || task.attachments) && (
        <div className="tcard__meta">
          {task.sender && <span>{task.sender}</span>}
          {task.due && (
            <span className={urgent ? 'tcard__due--urgent' : undefined}>{dueLabel(task.due)}</span>
          )}
          {task.attachments && <span>{task.attachments}</span>}
        </div>
      )}

      {task.tags.length > 0 && (
        <div className="tcard__tags">
          {task.tags.map((t) => (
            <span key={t} className="tcard__tag">{t}</span>
          ))}
        </div>
      )}
    </>
  )
}

interface Props extends BodyProps {
  selected: boolean
  onOpen: (task: Task) => void
}

export function TaskCard({ task, closed, selected, onOpen }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', task },
  })

  // dnd-kit owns Space (pick up / drop) and Escape (cancel); Enter opens the card.
  const dragKeyDown = listeners?.onKeyDown as ((e: KeyboardEvent<HTMLDivElement>) => void) | undefined

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={
        'tcard'
        + (isDragging ? ' tcard--dragging' : '')
        + (selected ? ' tcard--selected' : '')
        + (closed === 'cancelled' ? ' tcard--cancelled' : '')
      }
      {...attributes}
      {...listeners}
      aria-label={`${task.title}. From ${task.source}. Enter to open, space to move.`}
      onClick={() => onOpen(task)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onOpen(task)
          return
        }
        dragKeyDown?.(e)
      }}
    >
      <TaskCardBody task={task} closed={closed} />
    </div>
  )
}
