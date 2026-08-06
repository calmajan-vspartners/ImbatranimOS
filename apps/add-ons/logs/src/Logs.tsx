import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  ScrollText,
  Search,
  X,
} from 'lucide-react'
import { Button, cn, useSystem, useVirtualList } from '@imbatranim/ui'
import { eventLabel, formatWhen, summarise, type LogEntry, type LogLevel } from './lib/logFormat'
import { errorMessage, fetchLogs } from './lib/logsApi'
import { APP_NAME } from './appName'

/** How often Follow re-reads the tail. Slow enough to be free, fast enough to feel live. */
const FOLLOW_MS = 3000
/** Row height estimate; rows re-measure once mounted. */
const ROW_HEIGHT = 30

const LEVELS: { id: LogLevel; label: string }[] = [
  { id: 'info', label: 'Info' },
  { id: 'warn', label: 'Warnings' },
  { id: 'error', label: 'Errors' },
]

/**
 * The system log (brief 84).
 *
 * Until now the machine had no memory of itself: nothing runs in `/var/log`, and
 * Nest's output goes to stdout where only `docker logs` sees it — which is to say
 * nowhere at all on the kiosk ISO. "Was anyone trying to log in as me last week?"
 * is the question this app exists to answer.
 *
 * Filtering happens **on the server**, against the raw line, before the JSON is
 * parsed. Pulling the whole log down and filtering here would undo the point of a
 * size-capped tail, and would be slower on exactly the log that needs it most.
 */
export function Logs() {
  const system = useSystem()
  const [level, setLevel] = useState<LogLevel | null>(null)
  const [query, setQuery] = useState('')
  const [follow, setFollow] = useState(false)
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const notifiedRef = useRef(false)

  const load = useCallback(
    async (quiet: boolean) => {
      if (!quiet) setLoading(true)
      try {
        const page = await fetchLogs(system.http, {
          level: level ?? undefined,
          q: query.trim() || undefined,
        })
        setEntries(page.entries)
        setError(null)
      } catch (err) {
        const message = errorMessage(err)
        setError(message)
        // Notified once, not on every poll: Follow would otherwise turn one
        // outage into a toast every three seconds.
        if (!notifiedRef.current) {
          notifiedRef.current = true
          system.notify({ title: 'Cannot read the log', body: message, level: 'error' })
        }
      } finally {
        setLoading(false)
      }
    },
    [level, query, system]
  )

  // Debounced so typing in the filter is one request, not one per keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => void load(false), 250)
    return () => window.clearTimeout(id)
  }, [load])

  useEffect(() => {
    if (!follow) return
    const id = window.setInterval(() => void load(true), FOLLOW_MS)
    return () => window.clearInterval(id)
  }, [follow, load])

  const rows = useVirtualList({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
  })

  const counts = useMemo(() => {
    const out = { info: 0, warn: 0, error: 0 }
    for (const e of entries) out[e.level]++
    return out
  }, [entries])

  return (
    <div className="bg-surface text-on-surface flex h-full flex-col">
      <div className="border-outline-variant bg-surface-container-low flex flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
        <ScrollText size={14} strokeWidth={1.75} className="text-primary shrink-0" />
        <span className="text-[12px] font-bold tracking-tight">{APP_NAME}</span>

        <div className="border-outline-variant bg-surface-container-lowest flex min-w-[140px] flex-1 items-center gap-1 border px-1.5">
          <Search size={11} className="text-on-surface-variant shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder="Filter the log…"
            aria-label="Filter the log"
            className="font-content text-on-surface placeholder:text-on-surface-variant min-w-0 flex-1 bg-transparent py-1 text-[12px] outline-none"
          />
          {query !== '' && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Clear filter"
              onClick={() => setQuery('')}
            >
              <X size={11} />
            </Button>
          )}
        </div>

        {LEVELS.map((l) => (
          <button
            key={l.id}
            onClick={() => setLevel((current) => (current === l.id ? null : l.id))}
            aria-pressed={level === l.id}
            className={cn(
              'border-outline-variant border px-2 py-1 text-[11px] transition-colors',
              level === l.id
                ? 'bg-primary text-on-primary border-primary'
                : 'hover:bg-surface-container-high'
            )}
          >
            {l.label}
          </button>
        ))}

        <button
          onClick={() => setFollow((f) => !f)}
          aria-pressed={follow}
          title="Re-read the newest entries every few seconds"
          className={cn(
            'border-outline-variant border px-2 py-1 text-[11px] transition-colors',
            follow ? 'bg-primary text-on-primary border-primary' : 'hover:bg-surface-container-high'
          )}
        >
          Follow
        </button>
        <Button variant="ghost" size="sm" aria-label="Refresh" onClick={() => void load(false)}>
          <RefreshCw size={12} className={cn(loading && 'animate-spin')} />
        </Button>
      </div>

      {error && (
        <div className="bg-error-container text-on-error-container flex items-start gap-1.5 px-2 py-1 text-[11px]">
          <AlertTriangle size={12} className="mt-px shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div ref={scrollRef} className="custom-scrollbar min-h-0 flex-1 overflow-auto">
        {entries.length === 0 ? (
          <div className="text-on-surface-variant px-3 py-4 text-[12px]">
            {loading
              ? 'Reading the log…'
              : query || level
                ? 'Nothing in the log matches that.'
                : 'The log is empty. Events appear here as the machine does things.'}
          </div>
        ) : (
          <div style={{ height: rows.getTotalSize(), position: 'relative' }}>
            {rows.getVirtualItems().map((row) => {
              const entry = entries[row.index]
              return (
                <div
                  key={row.key}
                  ref={rows.measureElement}
                  data-index={row.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  <Row
                    entry={entry}
                    open={expanded === row.index}
                    onToggle={() =>
                      setExpanded((current) => (current === row.index ? null : row.index))
                    }
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="border-outline-variant text-on-surface-variant font-ui flex items-center gap-3 border-t px-2 py-1 text-[10px]">
        <span>{entries.length} entries</span>
        {counts.warn > 0 && <span>{counts.warn} warnings</span>}
        {counts.error > 0 && <span className="text-error">{counts.error} errors</span>}
        <span className="flex-1" />
        <span>Newest first</span>
      </div>
    </div>
  )
}

function Row({ entry, open, onToggle }: { entry: LogEntry; open: boolean; onToggle: () => void }) {
  const when = formatWhen(entry.t)
  return (
    <div className="border-outline-variant/50 border-b">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="hover:bg-surface-container-low flex w-full items-center gap-2 px-2 py-1 text-left text-[11px]"
      >
        {open ? (
          <ChevronDown size={11} className="text-on-surface-variant shrink-0" />
        ) : (
          <ChevronRight size={11} className="text-on-surface-variant shrink-0" />
        )}
        <span
          className={cn(
            'w-1 shrink-0 self-stretch',
            entry.level === 'error'
              ? 'bg-error'
              : entry.level === 'warn'
                ? 'bg-primary'
                : 'bg-outline-variant'
          )}
        />
        <span
          className="text-on-surface-variant w-[92px] shrink-0 tabular-nums"
          title={`${when.clock} · ${when.relative}`}
        >
          {when.clock}
        </span>
        <span className="w-[130px] shrink-0 truncate font-semibold">{eventLabel(entry.event)}</span>
        <span className="min-w-0 flex-1 truncate">{summarise(entry)}</span>
        {entry.source === 'client' && (
          <span
            className="text-on-surface-variant shrink-0 text-[10px]"
            title="Reported by the browser, not observed by the server"
          >
            browser
          </span>
        )}
        <span className="text-on-surface-variant shrink-0 text-[10px] tabular-nums">
          {when.relative}
        </span>
      </button>
      {open && (
        <pre className="bg-surface-container-lowest text-on-surface-variant overflow-auto px-3 py-1.5 font-mono text-[11px] whitespace-pre-wrap">
          {JSON.stringify(entry, null, 2)}
        </pre>
      )}
    </div>
  )
}
