import { useEffect } from 'react'
import { BellOff, CheckCheck, Trash2, X } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { ScrollArea } from '../ui/ScrollArea'
import { openApp } from '../../intents/openApp'
import { useNotificationStore, type NotificationItem } from '../../store/notificationStore'
import { NotificationIcon } from './NotificationIcon'
import { levelStripeClass, formatRelative } from './levelStyle'

function Row({ item, onOpen }: { item: NotificationItem; onOpen: () => void }) {
  const remove = useNotificationStore((s) => s.remove)
  const clickable = Boolean(item.appId)

  return (
    <div
      className={cn(
        'group border-outline-variant/60 relative flex items-start gap-2.5 border-b py-2 pr-1 pl-3 last:border-b-0',
        clickable && 'hover:bg-surface-container-high cursor-pointer'
      )}
      onClick={clickable ? onOpen : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpen()
              }
            }
          : undefined
      }
    >
      <span className={cn('absolute inset-y-0 left-0 w-[3px]', levelStripeClass(item.level))} />
      {/* The raising app's icon when it resolves (brief 107 — §23 promised it
          on both surfaces and neither delivered); severity stays in the stripe. */}
      <NotificationIcon
        appId={item.appId}
        level={item.level}
        size={15}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="text-on-surface truncate text-[12px] font-semibold">{item.title}</div>
        {item.body && (
          <div className="text-on-surface-variant mt-0.5 text-[11px] break-words">{item.body}</div>
        )}
        <div className="text-on-surface-variant/80 mt-0.5 text-[10px] tabular-nums">
          {formatRelative(item.timestamp)}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation()
          remove(item.id)
        }}
        aria-label="Remove notification"
        className={cn(
          'text-on-surface-variant hover:bg-surface-container hover:text-on-surface shrink-0 p-1 opacity-0 outline-none group-hover:opacity-100',
          'focus-visible:ring-primary focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset'
        )}
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  )
}

/** The tray-popover body: history list + Mark all read / Clear all / DnD. */
export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const notifications = useNotificationStore((s) => s.notifications)
  const dnd = useNotificationStore((s) => s.dnd)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const clearAll = useNotificationStore((s) => s.clearAll)
  const setDnd = useNotificationStore((s) => s.setDnd)

  // Opening the panel means the user has seen the queue.
  useEffect(() => {
    markAllRead()
  }, [markAllRead])

  return (
    <div className="font-ui flex flex-col" style={{ width: 320, maxHeight: 420 }}>
      <div className="border-outline-variant flex items-center justify-between border-b px-3 py-2">
        <span className="text-on-surface text-[12px] font-semibold">Notifications</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setDnd(!dnd)}
            aria-pressed={dnd}
            title={dnd ? 'Do Not Disturb is on' : 'Do Not Disturb is off'}
            className={cn(
              'flex items-center gap-1 px-1.5 py-1 text-[10px] outline-none',
              'focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-inset',
              dnd
                ? 'bg-primary text-on-primary'
                : 'text-on-surface-variant hover:bg-surface-container-high'
            )}
          >
            <BellOff size={12} strokeWidth={2} />
            DND
          </button>
          <button
            onClick={markAllRead}
            title="Mark all read"
            className="text-on-surface-variant hover:bg-surface-container-high focus-visible:ring-primary p-1 outline-none focus-visible:ring-2 focus-visible:ring-inset"
          >
            <CheckCheck size={14} strokeWidth={2} />
          </button>
          <button
            onClick={clearAll}
            title="Clear all"
            className="text-on-surface-variant hover:bg-surface-container-high focus-visible:ring-primary p-1 outline-none focus-visible:ring-2 focus-visible:ring-inset"
          >
            <Trash2 size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="text-on-surface-variant px-3 py-8 text-center text-[11px]">
          No notifications
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          {notifications.map((item) => (
            <Row
              key={item.id}
              item={item}
              onOpen={() => {
                if (item.appId) openApp(item.appId)
                onClose()
              }}
            />
          ))}
        </ScrollArea>
      )}
    </div>
  )
}
