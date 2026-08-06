import { useMemo, useRef, useState } from 'react'
import { Search, XCircle } from 'lucide-react'
import { useConfirm, useSystem, useVirtualList } from '@imbatranim/ui'
import type { ProcessInfo } from '../api/systemApi'
import { useKillProcessMutation } from '../queries/systemQueries'
import { matchesFilter } from '../lib/history'

type SortKey = 'pid' | 'name' | 'cpuPercent' | 'memPercent'

const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'pid', label: 'PID' },
  { key: 'name', label: 'Name' },
  { key: 'cpuPercent', label: 'CPU%', align: 'right' },
  { key: 'memPercent', label: 'MEM%', align: 'right' },
]

// Shared grid template so the header and every virtual row keep their columns
// aligned (PID · Name · CPU% · MEM% · Kill). Replaces the old <table> layout.
const GRID = 'grid grid-cols-[4rem_1fr_5rem_5rem_3.5rem]'

export function ProcessTable({
  processes,
  serverPid,
}: {
  processes: ProcessInfo[]
  /** This backend's own pid, so killing it can be called out rather than forbidden. */
  serverPid?: number
}) {
  const [sortKey, setSortKey] = useState<SortKey>('cpuPercent')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [filter, setFilter] = useState('')
  const system = useSystem()
  const killMutation = useKillProcessMutation()
  const { confirm, confirmDialog } = useConfirm()

  const scrollRef = useRef<HTMLDivElement>(null)

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const visible = useMemo(
    () =>
      // Filtered BEFORE sorting, and both before the virtualizer sees a count — the
      // brief's regression surface calls this out, and passing a different array
      // length than the virtualizer was built with is how rows drift.
      processes
        .filter((p) => matchesFilter(p, filter))
        .sort((a, b) => {
          const dir = sortDir === 'desc' ? -1 : 1
          if (sortKey === 'name') return a.name.localeCompare(b.name) * dir
          if (sortKey === 'cpuPercent') {
            // `?? -1` keeps a null out of the subtraction. NaN there would make the
            // order depend on the input order and the engine's sort implementation.
            return ((a.cpuPercent ?? -1) - (b.cpuPercent ?? -1)) * dir
          }
          return (a[sortKey] - b[sortKey]) * dir
        }),
    [processes, sortKey, sortDir, filter]
  )

  const virtualizer = useVirtualList({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 22,
  })

  /**
   * Confirm, then kill.
   *
   * The old code fired the mutation straight from the row's ⊗ button. The kill is
   * uid-scoped, but **the backend runs as that same uid** — so one misclick on the
   * wrong row could terminate the process serving the desktop and take the whole OS
   * down. `ui-conventions.md` §24 requires a destructive action to be both a
   * `destructive` variant and gated by `confirm({ destructive: true })`; this was the
   * clearest violation of it in the repo.
   */
  async function handleKill(process: ProcessInfo) {
    const isSelf = serverPid !== undefined && process.pid === serverPid
    const ok = await confirm({
      title: isSelf ? 'This is the OS itself' : 'End this process?',
      message: isSelf
        ? // Warned, not forbidden: a real OS lets you shoot your own foot. It just
          // should not happen by accident.
          `Process ${process.pid} (${process.name}) is the ImbatranimOS backend — the process serving this desktop. Ending it will disconnect every app and terminate your session. Continue?`
        : `Send SIGTERM to ${process.name} (pid ${process.pid})? Unsaved work in that process is lost.`,
      confirmLabel: isSelf ? 'End the OS process' : 'Send SIGTERM',
      destructive: true,
    })
    if (!ok) return

    killMutation.mutate(
      { pid: process.pid },
      {
        onSuccess: () =>
          system.notify({
            title: 'Signal sent',
            body: `SIGTERM → ${process.name} (pid ${process.pid})`,
            level: 'info',
          }),
        onError: () =>
          // A notification rather than the old inline "not permitted", which sat in
          // a virtualized row that scrolls away — and did so in a window the user may
          // not be looking at.
          system.notify({
            title: 'Could not end the process',
            body: `${process.name} (pid ${process.pid}) — it may belong to another user, or have already exited.`,
            level: 'error',
          }),
      }
    )
  }

  const virtualRows = virtualizer.getVirtualItems()

  return (
    <div className="flex h-full flex-col font-mono text-[11px]">
      {/* Filter */}
      <div className="border-outline-variant bg-surface-container-low flex items-center gap-1.5 border-b px-2 py-1">
        <Search size={11} className="text-on-surface-variant shrink-0" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or pid"
          aria-label="Filter processes"
          className="font-ui text-on-surface placeholder:text-on-surface-variant min-w-0 flex-1 bg-transparent text-[11px] outline-none"
        />
        <span className="font-ui text-on-surface-variant shrink-0 text-[10px] tabular-nums">
          {filter ? `${visible.length} / ${processes.length}` : `${processes.length}`}
        </span>
      </div>

      {/* Sortable header — kept outside the virtualized body so it never scrolls. */}
      <div className="bg-surface-container-low border-outline-variant text-on-surface-variant border-b">
        <div className={GRID}>
          {COLUMNS.map((col) => (
            <div
              key={col.key}
              className={`font-ui hover:text-primary cursor-pointer px-2 py-1 font-semibold tracking-wider uppercase select-none ${col.align === 'right' ? 'text-right' : 'text-left'}`}
              onClick={() => toggleSort(col.key)}
            >
              {col.label}
              {sortKey === col.key && (sortDir === 'desc' ? ' ▼' : ' ▲')}
            </div>
          ))}
          <div className="font-ui px-2 py-1 text-right font-semibold tracking-wider uppercase">
            Kill
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="font-ui text-on-surface-variant px-2 py-6 text-center">
          {filter ? `Nothing matches “${filter}”` : 'No processes'}
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualRows.map((vr) => {
              const p = visible[vr.index]
              const isSelf = serverPid !== undefined && p.pid === serverPid
              return (
                <div
                  key={p.pid}
                  data-index={vr.index}
                  ref={virtualizer.measureElement}
                  className={`${GRID} border-outline-variant/50 hover:bg-surface-container absolute top-0 left-0 w-full items-center border-b`}
                  style={{ transform: `translateY(${vr.start}px)` }}
                >
                  <div className="px-2 py-0.5">{p.pid}</div>
                  <div className="min-w-0 truncate px-2 py-0.5" title={p.name}>
                    {p.name}
                    {isSelf && (
                      <span className="text-on-surface-variant ml-1 text-[9px]">(this OS)</span>
                    )}
                  </div>
                  {/* An em dash, not `0.0`: the first poll has no baseline, and a
                      confident zero for a busy process is a lie. */}
                  <div className="px-2 py-0.5 text-right">
                    {p.cpuPercent === null ? '—' : p.cpuPercent.toFixed(1)}
                  </div>
                  <div className="px-2 py-0.5 text-right">{p.memPercent.toFixed(1)}</div>
                  <div className="px-2 py-0.5 text-right">
                    <button
                      onClick={() => void handleKill(p)}
                      disabled={killMutation.isPending && killMutation.variables?.pid === p.pid}
                      className="text-on-surface-variant hover:text-error transition-colors disabled:opacity-40"
                      aria-label={`End ${p.name}, pid ${p.pid}`}
                      title={
                        isSelf
                          ? `pid ${p.pid} is the OS backend — ending it closes your session`
                          : `Send SIGTERM to pid ${p.pid}`
                      }
                    >
                      <XCircle size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  )
}
