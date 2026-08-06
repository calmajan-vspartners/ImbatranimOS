import { useEffect, useRef, useState } from 'react'
import { Activity, List, Info, type LucideIcon } from 'lucide-react'
import { useWindowVisible } from '@imbatranim/ui'
import { useSystemAbout, useSystemProcesses, useSystemStats } from './queries/systemQueries'
import { Gauge } from './components/Gauge'
import { Sparkline } from './components/Sparkline'
import { ProcessTable } from './components/ProcessTable'
import { AboutPanel } from './components/AboutPanel'
import { formatRate, pushSample } from './lib/history'

type Tab = 'overview' | 'processes' | 'about'

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'processes', label: 'Processes', icon: List },
  { id: 'about', label: 'About', icon: Info },
]

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(1)} ${units[i]}`
}

// Window contract: ComponentType<{ windowId: string }>, registered in
// shared/registry/registry.tsx by the controller agent (see handoff).
export function SystemMonitor({ windowId: _windowId }: { windowId: string }) {
  const [tab, setTab] = useState<Tab>('overview')
  // Pause polling while minimized (window still mounted, display:none) so a
  // put-away monitor stops hitting the backend every 1.5s.
  const visible = useWindowVisible()
  const statsQuery = useSystemStats(visible)
  const processesQuery = useSystemProcesses(visible && tab === 'processes')
  const aboutQuery = useSystemAbout()

  const stats = statsQuery.data
  const processes = processesQuery.data ?? []

  /**
   * Three minutes of history, fed by the existing 1.5s poll.
   *
   * State, not a ref, because the sparklines have to re-render when it grows — and
   * the append happens in an effect keyed on `dataUpdatedAt` rather than on the data
   * object, so a refetch that returns an identical payload still records a sample
   * (the series is about TIME, so a flat stretch is information) while a mere
   * re-render does not double-count one.
   */
  const [history, setHistory] = useState({ cpu: [] as number[], memory: [] as number[] })
  const lastRecordedAt = useRef(0)
  const updatedAt = statsQuery.dataUpdatedAt

  useEffect(() => {
    if (!stats || !updatedAt || updatedAt === lastRecordedAt.current) return
    lastRecordedAt.current = updatedAt
    setHistory((prev) => ({
      cpu: pushSample(prev.cpu, stats.cpu.percent),
      memory: pushSample(prev.memory, stats.memory.percent),
    }))
    // Keyed on the fetch timestamp only; `stats` is read for its values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatedAt])

  return (
    <div className="bg-surface-container-lowest flex h-full flex-col select-none">
      <div className="border-outline-variant bg-surface-container-low flex items-center gap-0.5 border-b px-1 py-1">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`font-ui flex items-center gap-1.5 border px-3 py-1 text-[11px] font-semibold tracking-wider uppercase transition-colors ${
                active
                  ? 'border-primary bg-primary text-on-primary'
                  : 'text-on-surface-variant hover:border-outline-variant hover:text-on-surface border-transparent'
              }`}
            >
              <Icon size={12} />
              {t.label}
            </button>
          )
        })}
        <div className="flex-1" />
        {tab === 'processes' && (
          <span className="text-on-surface-variant pr-2 font-mono text-[10px]">
            {processes.length} procs
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tab === 'overview' && (
          <div className="flex flex-col gap-5">
            {!stats && !statsQuery.isError && (
              <p className="font-ui text-on-surface-variant text-[12px]">Loading live stats…</p>
            )}
            {statsQuery.isError && (
              <p className="font-ui text-error text-[12px]">
                Failed to reach the system stats endpoint.
              </p>
            )}
            {stats && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Gauge
                    label="CPU"
                    percent={stats.cpu.percent}
                    detail={`${stats.cpu.cores} core${stats.cpu.cores !== 1 ? 's' : ''} · load ${stats.loadAvg.one} / ${stats.loadAvg.five} / ${stats.loadAvg.fifteen}`}
                  />
                  <Sparkline history={history.cpu} label="CPU usage" />
                  {/* Per-core as a compact strip rather than N gauges — 16 gauges is
                      not information, it is a wall. */}
                  {stats.cpu.perCore.length > 1 && (
                    <div className="flex items-end gap-0.5" aria-hidden>
                      {stats.cpu.perCore.map((pc, i) => (
                        <div
                          key={i}
                          title={`core ${i}: ${pc.toFixed(1)}%`}
                          className="border-outline-variant bg-surface-container-lowest relative h-4 flex-1 border"
                        >
                          <div
                            className="bg-primary absolute bottom-0 left-0 w-full"
                            style={{ height: `${Math.max(0, Math.min(100, pc))}%` }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Gauge
                    label="Memory"
                    percent={stats.memory.percent}
                    detail={`${formatBytes(stats.memory.usedBytes)} / ${formatBytes(stats.memory.totalBytes)}`}
                  />
                  <Sparkline history={history.memory} label="Memory usage" />
                </div>

                {/* Swap is shown even at 0 %, with the total, so "no swap configured"
                    is visible as a fact rather than as a missing row. */}
                <Gauge
                  label="Swap"
                  percent={stats.swap.percent}
                  detail={
                    stats.swap.totalBytes === 0
                      ? 'none configured'
                      : `${formatBytes(stats.swap.usedBytes)} / ${formatBytes(stats.swap.totalBytes)}`
                  }
                />

                <Gauge
                  label="Disk"
                  percent={stats.disk.percent}
                  detail={`${formatBytes(stats.disk.usedBytes)} / ${formatBytes(stats.disk.totalBytes)} · ${stats.disk.path}`}
                />

                <div className="border-outline-variant grid grid-cols-2 gap-x-4 gap-y-1 border-t pt-3">
                  <Stat label="Uptime" value={formatUptime(stats.uptimeSeconds)} />
                  <Stat
                    label="Load (1 / 5 / 15m)"
                    value={`${stats.loadAvg.one} / ${stats.loadAvg.five} / ${stats.loadAvg.fifteen}`}
                  />
                  <Stat label="Network in" value={formatRate(stats.net.rxPerSec)} />
                  <Stat label="Network out" value={formatRate(stats.net.txPerSec)} />
                  <Stat label="Total received" value={formatBytes(stats.net.rxBytes)} />
                  <Stat label="Total sent" value={formatBytes(stats.net.txBytes)} />
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'processes' && (
          <>
            {processesQuery.isLoading && (
              <p className="font-ui text-on-surface-variant text-[12px]">Loading processes…</p>
            )}
            {processesQuery.isError && (
              <p className="font-ui text-error text-[12px]">Failed to load process list.</p>
            )}
            {!processesQuery.isLoading && !processesQuery.isError && (
              <ProcessTable processes={processes} serverPid={aboutQuery.data?.serverPid} />
            )}
          </>
        )}

        {tab === 'about' && (
          <>
            {aboutQuery.isLoading && (
              <p className="font-ui text-on-surface-variant text-[12px]">Loading…</p>
            )}
            {aboutQuery.isError && (
              <p className="font-ui text-error text-[12px]">Failed to load system identity.</p>
            )}
            {aboutQuery.data && <AboutPanel about={aboutQuery.data} />}
          </>
        )}
      </div>
    </div>
  )
}

/** One label/value line for the Overview's stat grid. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-ui text-on-surface-variant text-[10px] font-semibold tracking-wider uppercase">
        {label}
      </span>
      <span className="text-on-surface font-mono text-[11px]">{value}</span>
    </div>
  )
}

/**
 * Uptime, two units at most.
 *
 * Duplicated from core's `formatUptime` rather than imported: this add-on reads its
 * own copy of the number from `/system/stats`, and core does not re-export the
 * helper. Small enough that a shared export is not worth widening core's surface for.
 */
function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'unknown'
  const total = Math.floor(seconds)
  if (total < 60) return `${total}s`
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}
