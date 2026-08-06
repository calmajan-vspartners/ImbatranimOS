import { useNow } from './useNow'

/**
 * The desktop clock widget (brief 96): time at a glance, hosted by core's
 * widget layer. Content only — the frame, drag and removal are the host's.
 */
export function ClockWidget() {
  const now = useNow(1000)
  const d = new Date(now)
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-2">
      <span className="text-on-surface font-mono text-[26px] leading-none tabular-nums">
        {d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
      </span>
      <span className="font-ui text-on-surface-variant text-[10px]">
        {d.toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
        })}
      </span>
    </div>
  )
}
