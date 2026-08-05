import { useEffect } from 'react'
import { notify } from '@imbatranim/core'
import { dueLabel, isDateOnly } from './due'
import { peekTodos } from './queries/todosQueries'

/**
 * Tells you once when a todo falls due.
 *
 * The same shape as Clock's and Calendar's watchers, with the same honest limit:
 * it only fires while this window is open, because there is no background
 * delivery. The real fix is the shared core scheduler, and no half-scheduler is
 * built here — the status bar says so rather than the app pretending.
 *
 * The trigger is the due instant itself, not "N minutes before": a todo has a
 * deadline, not a start time, so there is nothing to warn ahead of. A date-only
 * todo would therefore notify at 23:59, which is useless — those are announced at
 * a **morning check** instead, the first time the app sees them on their own day.
 */

const CHECK_INTERVAL_MS = 60_000

/**
 * How late a trigger may be and still fire. Wide enough that a ~1/min interval
 * cannot miss one, narrow enough that opening the app after a week does not dump a
 * pile of stale toasts.
 */
const FIRE_WINDOW_MS = 90_000

/** Already-announced todos, as `id:reason`. Session state, like Calendar's. */
const notified = new Set<string>()
const MAX_NOTIFIED = 500

function remember(key: string): void {
  if (notified.size >= MAX_NOTIFIED) {
    const oldest = notified.values().next().value
    if (oldest !== undefined) notified.delete(oldest)
  }
  notified.add(key)
}

export function useTodoReminders(): void {
  useEffect(() => {
    function check() {
      const now = Date.now()
      for (const todo of peekTodos()) {
        if (todo.completed || todo.dueAt === null) continue

        if (isDateOnly(todo.dueAt)) {
          // Due some time today: say so the first time we notice, rather than at
          // 23:59 when it is already too late to act on.
          const startOfDue = todo.dueAt - 86_399_999
          if (now < startOfDue || now > todo.dueAt) continue
          const key = `${todo.id}:today`
          if (notified.has(key)) continue
          remember(key)
          notify({
            title: 'Due today',
            body: todo.text,
            appId: 'todo',
            level: todo.priority ? 'warning' : 'info',
          })
          continue
        }

        if (now < todo.dueAt || now >= todo.dueAt + FIRE_WINDOW_MS) continue
        const key = `${todo.id}:${todo.dueAt}`
        if (notified.has(key)) continue
        remember(key)
        notify({
          title: 'Task due',
          body: `${todo.text} · ${dueLabel(todo.dueAt, now)}`,
          appId: 'todo',
          level: todo.priority ? 'warning' : 'info',
        })
      }
    }

    check()
    const id = setInterval(check, CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])
}
