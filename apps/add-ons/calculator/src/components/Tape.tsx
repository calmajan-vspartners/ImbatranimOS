import { Eraser } from 'lucide-react'
import type { TapeEntry } from '../hooks/useCalcSession'

/**
 * Recent calculations, newest first, click to reuse.
 *
 * A strip above the keypad rather than a side panel: this window is 320px wide by default,
 * and a column narrow enough to fit beside the keys is too narrow to read an expression in.
 * Collapsed by default, so it costs nothing until asked for — which is also why the keypad's
 * minimum height, and therefore the window's, is unaffected by it.
 *
 * Clicking an entry inserts the value it computed, not the twelve digits shown.
 */
export function Tape({
  entries,
  onReuse,
  onClear,
}: {
  entries: TapeEntry[]
  onReuse: (value: number, display: string) => void
  onClear: () => void
}) {
  return (
    <div className="border-outline-variant bg-surface-container-lowest flex max-h-24 flex-none flex-col border-b">
      <div className="text-on-surface-variant font-ui flex items-center justify-between px-2 py-0.5 text-[9px] tracking-wider uppercase">
        <span>Tape</span>
        <button
          type="button"
          onClick={onClear}
          disabled={entries.length === 0}
          aria-label="Clear tape"
          title="Clear tape"
          className="hover:text-on-surface flex items-center gap-1 disabled:opacity-40"
        >
          <Eraser size={10} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="text-on-surface-variant px-2 pb-1 text-[10px]">
            Results land here — click one to reuse it.
          </p>
        ) : (
          <ul>
            {entries.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onReuse(entry.value, entry.result)}
                  title={`Reuse ${entry.value}`}
                  className="font-ui hover:bg-surface-container-high flex w-full items-baseline gap-2 px-2 py-0.5 text-left text-[10px] tabular-nums"
                >
                  <span className="text-on-surface-variant min-w-0 flex-1 truncate">
                    {entry.expression}
                  </span>
                  <span className="text-on-surface shrink-0 font-semibold">= {entry.result}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
