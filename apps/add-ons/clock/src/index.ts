import { lazy } from 'react'
import { Clock as ClockIcon } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'
import { ClockBackground } from './ClockBackground'

export const manifest: AddonManifest = {
  id: 'clock',
  name: 'Clock',
  description: 'World clocks, stopwatch, timer, and alarms',
  meta: ['time', 'world clock', 'timezone', 'stopwatch', 'timer', 'alarm', 'countdown'],
  icon: ClockIcon,
  component: lazy(() => import('./Clock').then((m) => ({ default: m.Clock }))),
  // Single-instance: one clock window, four tabs inside it.
  multiInstance: false,
  defaultSize: { width: 380, height: 560 },
  minSize: { width: 300, height: 420 },
  // Desktop-lifetime alarm/timer firing (brief 93) — imported eagerly on
  // purpose: it must run from login, and it pulls only the small pure modules
  // (alarmSchedule, timerModel, queries), not the lazy Clock UI chunk.
  background: ClockBackground,
}
