import { Check, Copy, ListOrdered } from 'lucide-react'
import { cn } from '@imbatranim/core'

/**
 * The compact row between the display and the keypad: memory keys, the tape toggle, and the
 * copy-the-real-number action.
 *
 * Small text buttons rather than another keypad row, because every row added to the keypad
 * raises the window's honest minimum height — and the keypad's height is the whole reason the
 * `=` key used to end up under the taskbar (brief 70, problem 1).
 */
export function CalcToolbar({
  memory,
  onMemoryClear,
  onMemoryRecall,
  onMemoryAdd,
  onMemorySubtract,
  tapeOpen,
  onToggleTape,
  onCopy,
  copied,
  copyTitle,
  copyEnabled,
}: {
  memory: number | null
  onMemoryClear: () => void
  onMemoryRecall: () => void
  onMemoryAdd: () => void
  onMemorySubtract: () => void
  tapeOpen: boolean
  onToggleTape: () => void
  onCopy: () => void
  copied: boolean
  /** The value a copy would put on the clipboard, shown on hover. */
  copyTitle: string
  copyEnabled: boolean
}) {
  const key =
    'font-ui border-outline-variant text-on-surface hover:bg-surface-container-high ' +
    'h-6 border px-1.5 text-[10px] font-semibold disabled:opacity-40'

  return (
    <div className="border-outline-variant bg-surface-container-low flex flex-none items-center gap-1 border-b px-2 py-1">
      <button
        type="button"
        className={key}
        onClick={onMemoryClear}
        disabled={memory === null}
        title="Clear memory"
      >
        MC
      </button>
      <button
        type="button"
        className={key}
        onClick={onMemoryRecall}
        disabled={memory === null}
        title="Recall memory"
      >
        MR
      </button>
      <button type="button" className={key} onClick={onMemoryAdd} title="Add the display to memory">
        M+
      </button>
      <button
        type="button"
        className={key}
        onClick={onMemorySubtract}
        title="Subtract the display from memory"
      >
        M−
      </button>
      {/* The M indicator is the only way to know the register is not empty. */}
      <span
        className={cn(
          'font-ui min-w-0 flex-1 truncate text-[10px] tabular-nums',
          memory === null ? 'text-on-surface-variant/40' : 'text-primary'
        )}
        title={memory === null ? 'Memory is empty' : `Memory holds ${memory}`}
      >
        {memory === null ? '' : `M ${memory}`}
      </span>

      <button
        type="button"
        className={cn(key, tapeOpen && 'bg-primary text-on-primary border-primary')}
        onClick={onToggleTape}
        aria-pressed={tapeOpen}
        aria-label="Tape"
        title="Show recent calculations"
      >
        <ListOrdered size={11} />
      </button>
      <button
        type="button"
        className={key}
        onClick={onCopy}
        disabled={!copyEnabled}
        aria-label="Copy result"
        title={copyEnabled ? `Copy ${copyTitle}` : 'Nothing to copy yet'}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </div>
  )
}
