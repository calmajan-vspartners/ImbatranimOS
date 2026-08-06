import { useMemo, type ReactNode } from 'react'
import { SystemProvider } from '@imbatranim/ui'
import { createSystemHandle } from './createSystemHandle'

/**
 * A system handle for app code mounted OUTSIDE a window — background services,
 * desktop layers, widgets (brief 48). Scoped to the app (notifications carry
 * the right id, `system.http`/`schedule` work) with the null-object window:
 * there is nothing to retitle or close, and shared code that tries gets a dev
 * warning instead of a crash.
 */
export function WindowlessSystemProvider({
  appId,
  children,
}: {
  appId: string
  children: ReactNode
}) {
  const system = useMemo(() => createSystemHandle(appId, null), [appId])
  return <SystemProvider system={system}>{children}</SystemProvider>
}
