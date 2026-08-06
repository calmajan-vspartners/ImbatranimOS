import { useMemo, useState } from 'react'
import { RotateCcw, Search, X } from 'lucide-react'
import { Button, Select } from '../../shared/components/ui'
import { cn } from '../../lib/cn'
import {
  candidatesFor,
  knownExtensions,
  resolveOpener,
  useAssociationStore,
} from '../../shared/registry/associations'

/**
 * Settings → Default apps (brief 81).
 *
 * The rows are **computed from the registry**, not listed here: every extension
 * any app declares in its `opens` shows up, so adding an app puts its types in
 * this list with no second place to edit. That is the same reason the association
 * table itself is derived — the old hardcoded map is exactly what this page would
 * have become a duplicate of.
 *
 * A row only offers apps that actually claim the type. "Open a `.png` in Sheets"
 * is not a preference anyone wants a dropdown for; the per-file **Open with…**
 * chooser in Files is where an unusual pairing belongs, and it can offer
 * everything because the user is asking for one file, once.
 */
export function DefaultAppsSettings() {
  const overrides = useAssociationStore((s) => s.overrides)
  const setDefault = useAssociationStore((s) => s.setDefault)
  const clearDefault = useAssociationStore((s) => s.clearDefault)
  const clearAll = useAssociationStore((s) => s.clearAll)
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/^\./, '')
    return knownExtensions()
      .filter((ext) => needle === '' || ext.includes(needle))
      .map((ext) => {
        // A representative filename, so resolution is asked the same question
        // the file manager asks it.
        const sample = ext.startsWith('.') ? ext : `sample.${ext}`
        return {
          ext,
          candidates: candidatesFor(sample),
          current: resolveOpener(sample),
        }
      })
      .filter((row) => row.candidates.length > 0)
  }, [query, overrides])

  const changed = Object.keys(overrides).length

  return (
    <div>
      <p className="text-on-surface-variant mb-4 max-w-prose text-[12px]">
        Which app opens which kind of file. Only apps that say they handle a type appear here — to
        open one file in something unusual, right-click it in Files and choose
        <span className="text-on-surface font-semibold"> Open with…</span>.
      </p>

      <div className="mb-3 flex items-center gap-2">
        <div className="border-outline-variant bg-surface-container-lowest flex min-w-0 flex-1 items-center gap-1 border px-1.5">
          <Search size={11} className="text-on-surface-variant shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder="Find a file type…"
            aria-label="Find a file type"
            className="font-content text-on-surface placeholder:text-on-surface-variant min-w-0 flex-1 bg-transparent py-1 text-[12px] outline-none"
          />
          {query !== '' && (
            <Button variant="ghost" size="sm" aria-label="Clear" onClick={() => setQuery('')}>
              <X size={11} />
            </Button>
          )}
        </div>
        <Button
          variant="default"
          size="sm"
          className="gap-1"
          disabled={changed === 0}
          onClick={clearAll}
        >
          <RotateCcw size={12} />
          Reset all {changed > 0 ? `(${changed})` : ''}
        </Button>
      </div>

      <div className="border-outline-variant max-h-80 overflow-auto border">
        {rows.length === 0 ? (
          <p className="text-on-surface-variant px-2 py-3 text-[12px]">
            Nothing matches “{query.trim()}”.
          </p>
        ) : (
          rows.map((row) => {
            const overridden = overrides[row.ext] !== undefined
            return (
              <div
                key={row.ext}
                className="border-outline-variant/50 flex items-center gap-2 border-b px-2 py-1.5 last:border-b-0"
              >
                <span className="w-20 shrink-0 font-mono text-[12px]">.{row.ext}</span>
                <div className="min-w-0 flex-1">
                  <Select
                    value={row.current.appId}
                    onValueChange={(appId) => setDefault(row.ext, String(appId))}
                    options={row.candidates.map((c) => ({ value: c.appId, label: c.name }))}
                    aria-label={`Default app for .${row.ext} files`}
                  />
                </div>
                <button
                  onClick={() => clearDefault(row.ext)}
                  disabled={!overridden}
                  title={overridden ? 'Back to the built-in default' : 'This is the default'}
                  className={cn(
                    'shrink-0 text-[11px] underline underline-offset-2',
                    overridden
                      ? 'text-on-surface-variant hover:text-on-surface'
                      : 'text-on-surface-variant/40 cursor-default no-underline'
                  )}
                >
                  {overridden ? 'Reset' : 'default'}
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
