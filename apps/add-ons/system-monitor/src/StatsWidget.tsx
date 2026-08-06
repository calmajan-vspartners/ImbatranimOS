import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSystem } from '@imbatranim/ui'
import { fetchStats } from './api/systemApi'
import { systemStatsKey } from './queries/systemQueries'
import { Sparkline } from './components/Sparkline'
import { pushSample } from './lib/history'

/** Ambient cadence: slower than the app's 1.5s, fast enough for a live trace. */
const WIDGET_POLL_MS = 5000

/**
 * CPU + RAM at a glance on the desktop (brief 96). Shares the monitor app's
 * query key, so with the app open the cache is one; alone it polls at its own
 * slower cadence. History is session state — the trace starts collecting when
 * the widget appears.
 */
export function StatsWidget() {
  // Widget mount: the handle is windowless (system.window.* is inert), but
  // http and intents work the same as in the app's own window.
  const system = useSystem()
  const statsQuery = useQuery({
    queryKey: systemStatsKey,
    queryFn: () => fetchStats(system.http),
    refetchInterval: WIDGET_POLL_MS,
  })
  const stats = statsQuery.data
  const updatedAt = statsQuery.dataUpdatedAt
  const [cpuHistory, setCpuHistory] = useState<number[]>([])
  const lastRecordedAt = useRef(0)

  // The SystemMonitor app's own accumulation pattern: keyed on the fetch
  // timestamp so one sample records once, whatever re-renders happen between.
  useEffect(() => {
    if (!stats || !updatedAt || updatedAt === lastRecordedAt.current) return
    lastRecordedAt.current = updatedAt
    setCpuHistory((prev) => pushSample(prev, stats.cpu.percent))
    // Keyed on the fetch timestamp only; `stats` is read for its values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatedAt])

  const cpuPercent = stats?.cpu.percent
  const memPercent = stats?.memory.percent

  return (
    <div className="flex h-full w-full flex-col gap-1 px-2.5 py-1.5">
      <button
        type="button"
        onClick={() => system.intents.openApp('system-monitor')}
        className="font-ui text-on-surface-variant hover:text-on-surface flex w-full items-baseline justify-between text-left text-[9px] font-semibold tracking-widest uppercase outline-none"
      >
        <span>CPU</span>
        <span className="text-on-surface font-mono text-[11px] normal-case tabular-nums">
          {cpuPercent !== undefined ? `${Math.round(cpuPercent)}%` : '—'}
        </span>
      </button>
      <Sparkline history={cpuHistory} label="CPU usage history" />
      <div className="font-ui text-on-surface-variant flex items-baseline justify-between text-[9px] font-semibold tracking-widest uppercase">
        <span>RAM</span>
        <span className="text-on-surface font-mono text-[11px] normal-case tabular-nums">
          {memPercent !== undefined ? `${Math.round(memPercent)}%` : '—'}
        </span>
      </div>
      <div className="border-outline-variant bg-surface-container-lowest h-2 border">
        <div
          className="bg-primary h-full transition-[width]"
          style={{ width: `${Math.min(100, memPercent ?? 0)}%` }}
        />
      </div>
    </div>
  )
}
