import { lazy } from 'react'
import { ScrollText } from 'lucide-react'
import type { AddonManifest } from '@imbatranim/core'
import { APP_NAME } from './appName'

export const manifest: AddonManifest = {
  id: 'logs',
  name: APP_NAME,
  description: 'What this machine has been doing, and who has tried to sign in',
  meta: ['log', 'audit', 'security', 'events', 'history', 'syslog', 'journal'],
  icon: ScrollText,
  component: lazy(() => import('./Logs').then((m) => ({ default: m.Logs }))),
  multiInstance: false,
  defaultSize: { width: 720, height: 460 },
  /**
   * Measured, not guessed: a row is a timestamp (92px), an event label (130px),
   * the summary, and the chrome around them. Below ~560 the summary column stops
   * being able to show a path or an address, which is the column the app is for.
   */
  minSize: { width: 560, height: 320 },
}
