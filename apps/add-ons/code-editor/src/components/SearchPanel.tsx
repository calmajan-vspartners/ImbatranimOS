import { useCallback, useRef, useState } from 'react'
import { AlertTriangle, FolderOpen, Loader2, Search, X } from 'lucide-react'
import { cn, useSystem } from '@imbatranim/ui'
import { EMPTY_RESULT, runFindInFiles, type FindResult } from '../lib/findInFiles'

type SearchPanelProps = {
  root: string
  /** Open a file at a line — the editor's one loader (brief 113). */
  onOpenAt: (path: string, line: number) => void
  /** Esc, or the close button: hide the panel and return focus to Monaco. */
  onClose: () => void
  /** Choose a folder to search under; resolves to a root-relative path or null. */
  onPickScope: () => Promise<string | null>
  inputRef: React.RefObject<HTMLInputElement | null>
}

/**
 * Find in files (brief 113) — a bottom panel, not a dialog.
 *
 * A dialog would end the search-edit-search loop every time you clicked a
 * result; the left rail belongs to brief 121's folder tree; and Monaco owns
 * the centre. The bottom is what is left, and it is where every editor puts
 * this anyway.
 *
 * Search runs on Enter, never per keystroke: this is the *content* grep, a
 * real filesystem walk reading up to 256 KB per file under a 3s budget. The
 * file manager's box makes the same split for the same reason.
 */
export function SearchPanel({ root, onOpenAt, onClose, onPickScope, inputRef }: SearchPanelProps) {
  const system = useSystem()
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<string>('')
  const [result, setResult] = useState<FindResult>(EMPTY_RESULT)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The query the rows on screen actually answer. */
  const [answered, setAnswered] = useState<string | null>(null)
  // Monotonic run id: a slow "need" must never land on top of "needle".
  const runRef = useRef(0)

  const run = useCallback(
    async (q: string, sc: string) => {
      const trimmed = q.trim()
      if (trimmed.length === 0) {
        runRef.current++
        setResult(EMPTY_RESULT)
        setAnswered(null)
        setError(null)
        return
      }
      const id = ++runRef.current
      setRunning(true)
      setError(null)
      try {
        const next = await runFindInFiles(system.http, {
          root,
          query: trimmed,
          scope: sc,
        })
        if (id !== runRef.current) return
        setResult(next)
        setAnswered(trimmed)
      } catch {
        if (id !== runRef.current) return
        setResult(EMPTY_RESULT)
        setAnswered(trimmed)
        setError('Search failed.')
      } finally {
        if (id === runRef.current) setRunning(false)
      }
    },
    [system, root]
  )

  const scopeLabel = scope ? `/${scope}` : 'everywhere'

  return (
    <div className="border-outline-variant bg-surface-container-low flex h-56 shrink-0 flex-col border-t">
      {/* Query row */}
      <div className="border-outline-variant flex items-center gap-2 border-b px-2 py-1">
        <div className="border-outline-variant bg-surface-container-lowest flex flex-1 items-center gap-1 border px-1.5">
          {running ? (
            <Loader2 size={12} className="text-primary shrink-0 animate-spin" />
          ) : (
            <Search size={12} className="text-on-surface-variant shrink-0" />
          )}
          <input
            ref={inputRef}
            value={query}
            aria-label="Find in files"
            placeholder="Find in files — press Enter"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void run(query, scope)
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                onClose()
              }
            }}
            className="font-content text-on-surface placeholder:text-on-surface-variant w-full bg-transparent py-0.5 text-[12px] outline-none"
          />
        </div>

        <button
          type="button"
          onClick={() => {
            void onPickScope().then((picked) => {
              if (picked === null) return
              setScope(picked)
              // Re-run against the new scope so the chip and the rows agree —
              // a scope that does not change the results it labels is a lie.
              if (query.trim()) void run(query, picked)
            })
          }}
          title="Limit the search to a folder"
          className="border-outline-variant text-on-surface-variant hover:text-on-surface font-ui flex shrink-0 items-center gap-1 border px-1.5 py-0.5 text-[11px]"
        >
          <FolderOpen size={11} />
          in {scopeLabel}
        </button>
        {scope && (
          <button
            type="button"
            aria-label="Search everywhere"
            onClick={() => {
              setScope('')
              if (query.trim()) void run(query, '')
            }}
            className="text-on-surface-variant hover:text-on-surface shrink-0"
          >
            <X size={11} />
          </button>
        )}

        <div className="bg-outline-variant mx-1 h-4 w-px" />
        <button
          type="button"
          aria-label="Close find in files"
          onClick={onClose}
          className="text-on-surface-variant hover:text-on-surface shrink-0"
        >
          <X size={12} />
        </button>
      </div>

      {/* Summary + truncation honesty */}
      <div className="border-outline-variant flex items-center gap-2 border-b px-2 py-0.5">
        <span className="font-ui text-on-surface-variant text-[11px]">
          {running
            ? 'Searching…'
            : answered === null
              ? 'Type a search and press Enter.'
              : `${result.matchCount} match${result.matchCount === 1 ? '' : 'es'} in ${result.groups.length} file${result.groups.length === 1 ? '' : 's'} for “${answered}”`}
        </span>
        {result.truncated && !running && (
          <span className="font-ui text-tertiary flex items-center gap-1 text-[11px]">
            <AlertTriangle size={11} />
            Stopped early — narrow the search or pick a folder.
          </span>
        )}
      </div>

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="font-ui text-error px-2 py-2 text-[12px]">{error}</div>}
        {!error && !running && answered !== null && result.groups.length === 0 && (
          <div className="font-ui text-on-surface-variant px-2 py-2 text-[12px]">
            No matches for “{answered}” {scope ? `in /${scope}` : 'anywhere in Home'}.
          </div>
        )}
        {result.groups.map((group) => (
          <div key={group.path}>
            <button
              type="button"
              onClick={() => onOpenAt(group.path, group.matches[0]?.line ?? 1)}
              className="hover:bg-surface-container flex w-full items-center gap-2 px-2 py-0.5 text-left"
            >
              <span className="font-content text-on-surface truncate text-[12px] font-semibold">
                {group.name}
              </span>
              {group.dir && (
                <span className="font-ui text-on-surface-variant truncate text-[11px]">
                  /{group.dir}
                </span>
              )}
              <span className="font-ui text-on-surface-variant ml-auto shrink-0 text-[11px]">
                {group.nameOnly ? 'filename match' : group.matches.length}
              </span>
            </button>
            {group.matches.map((m) => (
              <button
                key={`${group.path}:${m.line}`}
                type="button"
                onClick={() => onOpenAt(group.path, m.line)}
                className={cn(
                  'hover:bg-surface-container flex w-full items-baseline gap-2 py-0.5 pr-2 pl-6 text-left'
                )}
              >
                <span className="text-on-surface-variant w-10 shrink-0 text-right font-mono text-[11px]">
                  {m.line}
                </span>
                <span className="text-on-surface truncate font-mono text-[11px]">{m.text}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
