import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { TASKBAR_HEIGHT } from '../../store/windowStore'
import { useNotificationStore, type NotificationItem } from '../../store/notificationStore'
import { LevelIcon } from './LevelIcon'
import { levelColorClass, levelStripeClass } from './levelStyle'

/** Non-error toasts auto-dismiss after this long. Errors are sticky. */
const AUTO_DISMISS_MS = 6000

function Toast({ item }: { item: NotificationItem }) {
  const dismissToast = useNotificationStore((s) => s.dismissToast)

  useEffect(() => {
    if (item.level === 'error') return // sticky until dismissed
    const id = setTimeout(() => dismissToast(item.id), AUTO_DISMISS_MS)
    return () => clearTimeout(id)
  }, [item.id, item.level, dismissToast])

  return (
    <div
      role="status"
      className={cn(
        'font-ui pointer-events-auto relative flex w-80 items-start gap-2.5 overflow-hidden',
        'border-outline-variant bg-surface-container-low border py-2.5 pr-2 pl-3',
        'shadow-[0_6px_24px_rgba(0,0,0,0.35)]'
      )}
    >
      <span className={cn('absolute inset-y-0 left-0 w-[3px]', levelStripeClass(item.level))} />
      <LevelIcon
        size={16}
        level={item.level}
        className={cn('mt-0.5 shrink-0', levelColorClass(item.level))}
      />
      <div className="min-w-0 flex-1">
        <div className="text-on-surface truncate text-[12px] font-semibold">{item.title}</div>
        {item.body && (
          <div className="text-on-surface-variant mt-0.5 text-[11px] break-words">{item.body}</div>
        )}
      </div>
      <button
        onClick={() => dismissToast(item.id)}
        aria-label="Dismiss notification"
        className={cn(
          'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface shrink-0 p-1 outline-none',
          'focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-inset'
        )}
      >
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  )
}

/**
 * Fixed bottom-right stack of live toasts, anchored above the taskbar. The host
 * overlay is pointer-events-none so it never blocks the desktop/taskbar; only
 * the toasts themselves take pointer events.
 */
export function ToastHost() {
  const toasts = useNotificationStore((s) => s.toasts)
  const byId = useNotificationStore((s) => s.notifications)
  // Newest toast on top of the stack; cap the rendered count so a burst can't
  // fill the screen (older ones remain in history).
  const items = toasts
    .map((id) => byId.find((n) => n.id === id))
    .filter((n): n is NotificationItem => n !== undefined)
    .slice(0, 5)

  const stackRef = useRef<HTMLDivElement>(null)

  if (items.length === 0) return null

  return (
    <div
      ref={stackRef}
      className="pointer-events-none fixed right-3 z-[8500] flex flex-col gap-2"
      style={{ bottom: TASKBAR_HEIGHT + 12 }}
    >
      {items.map((item) => (
        <Toast key={item.id} item={item} />
      ))}
    </div>
  )
}
