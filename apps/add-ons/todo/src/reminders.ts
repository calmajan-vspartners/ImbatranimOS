import { useEffect } from 'react'
import { useSystem } from '@imbatranim/ui'
import { dueLabel, isDateOnly, startOfDay } from './due'
import { peekTodos } from './queries/todosQueries'

/**
 * Tells you once when a todo falls due.
 *
 * The same shape as Clock's and Calendar's watchers. Since brief 93 it is
 * mounted by `TodoBackground` (the manifest's desktop-lifetime service), so due
 * todos announce themselves while the desktop is open — no Todo window needed.
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
  const system = useSystem()
  useEffect(() => {
    function check() {
      const now = Date.now()
      for (const todo of peekTodos()) {
        if (todo.completed || todo.dueAt === null) continue
        // Narrowed copy: the claim callbacks below close over it, and TS cannot
        // carry the null-guard across the async boundary on the mutable field.
        const dueAt = todo.dueAt

        if (isDateOnly(todo.dueAt)) {
          // Due some time today: say so the first time we notice, rather than at
          // 23:59 when it is already too late to act on. Use the calendar
          // start-of-day rather than subtracting a fixed 86,399,999 ms — a DST day
          // is 23 or 25 hours long, so the fixed offset lands an hour off local
          // midnight and the morning window opens or closes on the wrong day (L1).
          const startOfDue = startOfDay(todo.dueAt)
          if (now < startOfDue || now > todo.dueAt) continue
          const key = `${todo.id}:today`
          if (notified.has(key)) continue
          remember(key)
          // Cross-tab dedupe (brief 93): keyed on the due instant, so an edited
          // due date announces again and an unchanged one cannot double-toast.
          void system.schedule.claim('todo', `${todo.id}:today`, dueAt).then((claimed) => {
            if (!claimed) return
            system.notify({
              title: 'Due today',
              body: todo.text,
              level: todo.priority ? 'warning' : 'info',
            })
          })
          continue
        }

        if (now < todo.dueAt || now >= todo.dueAt + FIRE_WINDOW_MS) continue
        const key = `${todo.id}:${todo.dueAt}`
        if (notified.has(key)) continue
        remember(key)
        void system.schedule.claim('todo', `${todo.id}:due`, dueAt).then((claimed) => {
          if (!claimed) return
          system.notify({
            title: 'Task due',
            body: `${todo.text} · ${dueLabel(dueAt, now)}`,
            level: todo.priority ? 'warning' : 'info',
          })
        })
      }
    }

    check()
    const id = setInterval(check, CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [system])
}
