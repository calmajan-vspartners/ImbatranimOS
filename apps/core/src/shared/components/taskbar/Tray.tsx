import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Popover } from '@base-ui/react/popover'
import { Bell } from 'lucide-react'
import dayjs from 'dayjs'
import { cn } from '../../../lib/cn'
import { api } from '../../../lib/axios'
import { notify, useNotificationStore } from '../../store/notificationStore'
import { NotificationPanel } from '../notifications/NotificationPanel'

/** Warn once the volume passes this. */
const DISK_WARN_PERCENT = 90

// Mirrors the backend's /api/system/stats response (system.service.ts).
type SystemStats = {
  cpu: { percent: number; cores: number }
  memory: { totalBytes: number; usedBytes: number; availableBytes: number; percent: number }
  disk: { path: string; totalBytes: number; usedBytes: number; freeBytes: number; percent: number }
}

const toGb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1)

function MiniCalendar() {
  const today = dayjs()
  const startOfMonth = today.startOf('month')
  const daysInMonth = today.daysInMonth()
  const startDow = startOfMonth.day()

  const cells: (number | null)[] = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  return (
    <div className="font-ui p-3" style={{ minWidth: 208 }}>
      <div className="text-on-surface mb-2 text-center text-[12px] font-semibold">
        {today.format('MMMM YYYY')}
      </div>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
              <th
                key={d}
                className="text-on-surface-variant pb-1 text-center font-medium"
                style={{ width: '14.28%' }}
              >
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((day, di) => (
                <td
                  key={di}
                  className={cn(
                    'py-0.5 text-center',
                    day === today.date()
                      ? 'bg-primary text-on-primary font-semibold'
                      : 'text-on-surface',
                    !day && 'opacity-0'
                  )}
                >
                  {day ?? ''}
                </td>
              ))}
              {Array.from({ length: 7 - week.length }).map((_, di) => (
                <td key={`pad-${di}`} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function NotificationBell() {
  const [open, setOpen] = useState(false)
  const unread = useNotificationStore((s) =>
    s.notifications.reduce((n, x) => n + (x.read ? 0 : 1), 0)
  )
  const dnd = useNotificationStore((s) => s.dnd)

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        className={cn(
          'relative flex h-full cursor-pointer items-center px-2.5 outline-none',
          'text-on-surface hover:bg-surface-container-high',
          'focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-inset'
        )}
      >
        <Bell size={15} strokeWidth={1.75} className={cn(dnd && 'opacity-50')} />
        {unread > 0 && (
          <span
            className="bg-primary text-on-primary absolute top-1.5 right-1 flex h-3.5 min-w-3.5 items-center justify-center px-0.5 text-[9px] leading-none font-semibold tabular-nums"
            aria-hidden
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={6}>
          <Popover.Popup className="border-outline-variant bg-surface-container-low border shadow-[0_-6px_24px_rgba(0,0,0,0.35)]">
            <NotificationPanel onClose={() => setOpen(false)} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function Tray() {
  const [now, setNow] = useState(() => dayjs())

  useEffect(() => {
    const id = setInterval(() => setNow(dayjs()), 15_000)
    return () => clearInterval(id)
  }, [])

  const { data: stats } = useQuery<SystemStats>({
    queryKey: ['system-stats'],
    queryFn: () => api.get('/system/stats').then((r) => r.data),
    refetchInterval: 60_000,
    staleTime: 55_000,
  })

  // Warn once per session when the volume is nearly full. Driven off the poll
  // the Tray already runs — the percentage was being fetched every minute and
  // thrown away, while a full volume showed up to the user only as saves
  // mysteriously failing. A second poller would be waste.
  const warnedRef = useRef(false)
  useEffect(() => {
    const percent = stats?.disk?.percent
    if (percent === undefined || percent < DISK_WARN_PERCENT) return
    if (warnedRef.current) return
    warnedRef.current = true
    notify({
      title: 'Disk almost full',
      body: `The volume is ${Math.round(percent)}% full. Free some space — Settings › Storage shows what is using it.`,
      level: 'warning',
    })
  }, [stats?.disk?.percent])

  return (
    <div className="flex h-full items-center gap-1 pr-1">
      {stats && (
        <span
          className="text-on-surface-variant hidden px-2 text-[11px] tabular-nums sm:inline"
          style={{ whiteSpace: 'nowrap' }}
          title="CPU / RAM"
        >
          {Math.round(stats.cpu.percent)}% · {toGb(stats.memory.usedBytes)}/
          {toGb(stats.memory.totalBytes)} GB
        </span>
      )}

      <div className="bg-outline-variant h-5 w-px" />

      <NotificationBell />

      <div className="bg-outline-variant h-5 w-px" />

      <Popover.Root>
        <Popover.Trigger
          className={cn(
            'flex h-full cursor-pointer flex-col items-end justify-center px-3 leading-tight outline-none',
            'text-on-surface hover:bg-surface-container-high',
            'focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-inset'
          )}
        >
          <span className="text-[12px] font-semibold tabular-nums">{now.format('HH:mm')}</span>
          <span className="text-on-surface-variant text-[10px] tabular-nums">
            {now.format('ddd, DD MMM')}
          </span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="top" align="end" sideOffset={6}>
            <Popover.Popup className="border-outline-variant bg-surface-container-low border shadow-[0_-6px_24px_rgba(0,0,0,0.35)]">
              <MiniCalendar />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
