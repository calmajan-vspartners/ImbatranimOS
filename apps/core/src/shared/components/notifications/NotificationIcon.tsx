import { APP_REGISTRY } from '../../registry/registry'
import { cn } from '../../../lib/cn'
import { LevelIcon } from './LevelIcon'
import { levelColorClass } from './levelStyle'
import type { NotificationLevel } from '../../store/notificationStore'

/**
 * The icon on a notification — the raising app's when `appId` resolves,
 * the severity glyph otherwise (brief 107).
 *
 * ui-conventions §23 has always told callers to "pass `appId` so the item gets
 * your icon", but neither surface ever rendered one. Severity stays legible
 * through the accent stripe both surfaces already draw, so nothing is lost by
 * spending the icon slot on identity — which is what tells you at a glance
 * WHICH app is talking to you.
 */
export function NotificationIcon({
  appId,
  level,
  size,
  className,
}: {
  appId?: string
  level: NotificationLevel
  size: number
  className?: string
}) {
  const app = appId ? APP_REGISTRY.find((a) => a.id === appId) : undefined
  if (app) {
    const Icon = app.icon
    return (
      <Icon
        size={size}
        strokeWidth={1.75}
        aria-hidden
        className={cn('text-on-surface-variant', className)}
      />
    )
  }
  return <LevelIcon size={size} level={level} className={cn(levelColorClass(level), className)} />
}
