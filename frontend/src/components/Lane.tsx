import { useEffect, useRef, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Column, Task } from '../types'
import { TaskCard } from './TaskCard'

interface Props {
  column: Column
  tasks: Task[]
  hiddenCount: number
  selectedId: number | null
  onOpen: (task: Task) => void
  onAdd: (columnId: number, title: string) => Promise<void>
}

export function Lane({ column, tasks, hiddenCount, selectedId, onOpen, onAdd }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${column.id}`,
    data: { type: 'column', column },
  })

  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (composing) inputRef.current?.focus()
  }, [composing])

  async function submit() {
    const title = draft.trim()
    if (!title || saving) return

    setSaving(true)
    try {
      await onAdd(column.id, title)
      setDraft('')
      inputRef.current?.focus()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="lane" aria-label={column.name}>
      <header className="lane__head">
        <h2 className="lane__name">{column.name}</h2>
        <span className="lane__count">{tasks.length}</span>
        <span className="lane__spacer" />
        <button
          className="btn btn-ghost"
          onClick={() => setComposing(true)}
          aria-label={`Add a task to ${column.name}`}
          style={{ padding: '0 7px', minHeight: 20, fontSize: 13, lineHeight: 1 }}
        >
          +
        </button>
      </header>

      <div ref={setNodeRef} className={'lane__drop' + (isOver ? ' lane__drop--over' : '')}>
        {composing && (
          <div className="composer">
            <textarea
              ref={inputRef}
              className="input"
              placeholder="What needs doing?"
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void submit()
                }
                if (e.key === 'Escape') {
                  setComposing(false)
                  setDraft('')
                }
              }}
              style={{ fontSize: '12.5px', resize: 'none', fontFamily: 'var(--font-body)' }}
            />
            <div className="composer__row">
              <button
                className="btn btn-primary"
                onClick={() => void submit()}
                disabled={!draft.trim() || saving}
                style={{ fontSize: 11, minHeight: 24, padding: '0 8px' }}
              >
                Add
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setComposing(false)
                  setDraft('')
                }}
                style={{ fontSize: 11, minHeight: 24, padding: '0 8px' }}
              >
                Cancel
              </button>
              <span className="composer__hint">⏎ add · esc cancel</span>
            </div>
          </div>
        )}

        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              done={column.is_done}
              selected={selectedId === task.id}
              onOpen={onOpen}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && !composing && (
          <p className="lane__empty">
            {hiddenCount > 0 ? (
              <>
                {hiddenCount} hidden
                <br />
                by the search.
              </>
            ) : (
              <>
                Nothing here.
                <br />
                Drag or add.
              </>
            )}
          </p>
        )}
      </div>
    </section>
  )
}
