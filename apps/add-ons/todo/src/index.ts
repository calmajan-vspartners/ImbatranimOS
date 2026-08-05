import { lazy } from 'react'
import { ListTodo } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'

export const manifest: AddonManifest = {
  id: 'todo',
  name: 'Todo',
  description: 'Tasks with due dates, lists and priorities',
  meta: ['tasks', 'checklist', 'reminders', 'due date', 'todo list', 'priority'],
  icon: ListTodo,
  component: lazy(() => import('./Todo').then((m) => ({ default: m.Todo }))),
  multiInstance: false,
  defaultSize: { width: 360, height: 480 },
  /**
   * Measured (brief 73). The app gained two header rows this brief — lists and
   * bulk actions — so the same window shows meaningfully fewer tasks than it did,
   * and the old 280×300 left 138px of list: under four rows.
   *
   * Chrome, measured: 29 (lists) + 26 (filter) + 29 (bulk) + 30 (add) + 16 (status)
   * = 130, plus ~32 of window frame. At 340 the list gets ~178px, which is five
   * rows. The width is 300 rather than 280 because below that the add field's
   * "Add to <list>…" placeholder truncates to nothing useful — the header rows
   * themselves `flex-wrap` and were measured not to wrap even at 280.
   */
  minSize: { width: 300, height: 340 },
}
