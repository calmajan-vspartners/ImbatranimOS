import { useMemo } from 'react'
import { useEnabledApps } from '../../registry/enabledApps'
import type { WidgetConfig } from '../../../contract'

export type ResolvedWidget = { key: string; appId: string; config: WidgetConfig }

/** Every enabled app's widgets, keyed for the widget store (brief 96). */
export function useAvailableWidgets(): ResolvedWidget[] {
  const apps = useEnabledApps()
  return useMemo(
    () =>
      apps.flatMap((app) =>
        (app.widgets ?? []).map((config) => ({
          key: `${app.id}:${config.id}`,
          appId: app.id,
          config,
        }))
      ),
    [apps]
  )
}
