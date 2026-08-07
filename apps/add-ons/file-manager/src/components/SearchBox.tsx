import { Search, X, FileSearch, Loader2 } from 'lucide-react'
import { cn } from '@imbatranim/ui'
import { Tooltip } from '@imbatranim/ui'
import { scopeLabel } from '../lib/searchPresentation'

type SearchBoxProps = {
  value: string
  onChange: (value: string) => void
  /** Root label + folder — formatted here into "where this searches". */
  rootLabel: string
  path: string
  contentMode: boolean
  onToggleContentMode: () => void
  /** Enter in content mode: run the (expensive) grep for what is typed now. */
  onRun: () => void
  onClear: () => void
  /** Move focus into the results list without losing the query (ArrowDown). */
  onStepIntoResults: () => void
  searching: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
}

/**
 * The search box, right-aligned in the breadcrumb bar (brief 112).
 *
 * It sits in the breadcrumb rather than the toolbar on purpose: the breadcrumb
 * is the row that says *where you are*, and this box searches exactly there.
 * The placeholder repeats that scope because a search box with no stated scope
 * is the one control users reliably assume is global.
 */
export function SearchBox({
  value,
  onChange,
  rootLabel,
  path,
  contentMode,
  onToggleContentMode,
  onRun,
  onClear,
  onStepIntoResults,
  searching,
  inputRef,
}: SearchBoxProps) {
  const scope = scopeLabel(rootLabel, path)
  return (
    <div className="flex items-center gap-1">
      <div
        className={cn(
          'border-outline-variant bg-surface-container-lowest flex items-center gap-1 border px-1.5',
          'focus-within:border-primary'
        )}
      >
        {searching ? (
          <Loader2 size={12} className="text-primary shrink-0 animate-spin" />
        ) : (
          <Search size={12} className="text-on-surface-variant shrink-0" />
        )}
        <input
          ref={inputRef}
          type="search"
          value={value}
          aria-label="Search this folder"
          placeholder={`Search ${scope}`}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // Stop here: the desktop and the window manager both listen for
              // Escape, and clearing the box is the only thing it should do
              // while the user is typing in it.
              e.preventDefault()
              e.stopPropagation()
              onClear()
              return
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              onRun()
              return
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              onStepIntoResults()
            }
          }}
          className={cn(
            'font-content text-on-surface w-44 bg-transparent py-0.5 text-[12px] outline-none',
            'placeholder:text-on-surface-variant',
            // Chrome draws its own clear affordance for type=search; we ship one
            // that matches the rest of the OS instead of showing both.
            '[&::-webkit-search-cancel-button]:hidden'
          )}
        />
        {value && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={onClear}
            className="text-on-surface-variant hover:text-on-surface shrink-0"
          >
            <X size={11} />
          </button>
        )}
      </div>

      <Tooltip
        content={
          contentMode
            ? 'Searching inside files — press Enter to run'
            : 'Also search inside file contents (runs on Enter)'
        }
      >
        <button
          type="button"
          aria-label="Search inside files"
          aria-pressed={contentMode}
          onClick={onToggleContentMode}
          className={cn(
            'flex h-[22px] w-[22px] shrink-0 items-center justify-center border',
            contentMode
              ? 'border-primary bg-primary text-on-primary'
              : 'border-outline-variant text-on-surface-variant hover:text-on-surface'
          )}
        >
          <FileSearch size={12} />
        </button>
      </Tooltip>
    </div>
  )
}
