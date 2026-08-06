import { lazy } from 'react'
import { Calendar as CalendarIcon } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'
import { CalendarBackground } from './CalendarBackground'

export const manifest: AddonManifest = {
  id: 'calendar',
  name: 'Calendar',
  description: 'Month, week and agenda views, recurring events, reminders, ICS import/export',
  meta: [
    'events',
    'schedule',
    'agenda',
    'reminders',
    'month',
    'week',
    'recurring',
    'repeat',
    'ics',
    'ical',
  ],
  icon: CalendarIcon,
  component: lazy(() => import('./Calendar').then((m) => ({ default: m.Calendar }))),
  // Single-instance: one calendar, one reminder interval.
  multiInstance: false,
  defaultSize: { width: 720, height: 560 },
  /**
   * Measured, not guessed (brief 72). The month grid compresses rather than
   * overflowing, so nothing ever clips — which means the honest minimum is the
   * size at which the grid still *says* something rather than the size at which
   * it fits.
   *
   * Height: a week row needs the date number (20px) plus one event chip (17px)
   * plus padding, so ~41px × 6 rows = 246, plus the weekday header (22), the
   * toolbar (33), the status bar (24) and ~32 of window chrome ≈ 357. At the old
   * 380 a row was **25px** — the date number and nothing else, six times over.
   * 400 gives 46px rows, which show the date and one event.
   *
   * Width: below 520 the toolbar wraps onto a second line (measured: 33px → 64px)
   * and takes 31px straight out of the grid, so 520 is where the controls still
   * fit on one row.
   */
  minSize: { width: 520, height: 400 },
  // Desktop-lifetime reminder firing (brief 93) — eager on purpose; pulls the
  // watcher and query modules, not the lazy Calendar UI chunk.
  background: CalendarBackground,
  // Desktop widget (brief 96): today's agenda, reading the same events cache
  // the background reminder service keeps warm.
  widgets: [
    {
      id: 'agenda',
      name: "Today's agenda",
      component: lazy(() => import('./AgendaWidget').then((m) => ({ default: m.AgendaWidget }))),
      defaultSize: { width: 230, height: 118 },
    },
  ],
}
