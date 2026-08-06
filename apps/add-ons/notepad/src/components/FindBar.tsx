import { ArrowDown, ArrowUp, CaseSensitive, Replace, X } from 'lucide-react'
import { Button, cn } from '@imbatranim/ui'

/**
 * Find (and optionally replace) over the textarea.
 *
 * Controlled entirely by the parent, which owns the text: this component renders the
 * bar and reports intent. Keeping the matching in `lib/findReplace.ts` and the text
 * in the editor means the bar itself has no state to get out of sync.
 */
export function FindBar({
  query,
  onQueryChange,
  replacement,
  onReplacementChange,
  caseSensitive,
  onToggleCase,
  showReplace,
  onToggleReplace,
  matchCount,
  currentMatch,
  onNext,
  onPrevious,
  onReplaceOne,
  onReplaceAll,
  onClose,
  inputRef,
}: {
  query: string
  onQueryChange: (value: string) => void
  replacement: string
  onReplacementChange: (value: string) => void
  caseSensitive: boolean
  onToggleCase: () => void
  showReplace: boolean
  onToggleReplace: () => void
  matchCount: number
  /** 1-based index of the highlighted match, or 0 when none. */
  currentMatch: number
  onNext: () => void
  onPrevious: () => void
  onReplaceOne: () => void
  onReplaceAll: () => void
  onClose: () => void
  inputRef: React.Ref<HTMLInputElement>
}) {
  const noMatches = query.length > 0 && matchCount === 0

  return (
    <div className="border-outline-variant bg-surface-container-low shrink-0 border-b px-2 py-1">
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (e.shiftKey) onPrevious()
              else onNext()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
          placeholder="Find"
          aria-label="Find"
          className={cn(
            'border-outline-variant bg-surface-container-lowest font-ui text-on-surface w-40 border px-1 py-0 text-[11px] outline-none',
            // The only signal that a search failed. Colour alone would not do it, so
            // the count beside it says "No results" in words too.
            noMatches && 'border-error'
          )}
        />
        <span
          className={cn(
            'font-ui min-w-[72px] text-[10px] tabular-nums',
            noMatches ? 'text-error' : 'text-on-surface-variant'
          )}
        >
          {query.length === 0 ? '' : noMatches ? 'No results' : `${currentMatch} of ${matchCount}`}
        </span>

        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          aria-label="Find previous"
          disabled={matchCount === 0}
          onClick={onPrevious}
        >
          <ArrowUp size={11} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          aria-label="Find next"
          disabled={matchCount === 0}
          onClick={onNext}
        >
          <ArrowDown size={11} />
        </Button>
        <Button
          variant={caseSensitive ? 'primary' : 'ghost'}
          size="sm"
          className="h-5 w-5 p-0"
          aria-label="Match case"
          aria-pressed={caseSensitive}
          onClick={onToggleCase}
        >
          <CaseSensitive size={12} />
        </Button>
        <Button
          variant={showReplace ? 'primary' : 'ghost'}
          size="sm"
          className="h-5 w-5 p-0"
          aria-label="Toggle replace"
          aria-pressed={showReplace}
          onClick={onToggleReplace}
        >
          <Replace size={11} />
        </Button>

        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          aria-label="Close find"
          onClick={onClose}
        >
          <X size={11} />
        </Button>
      </div>

      {showReplace && (
        <div className="mt-1 flex items-center gap-1">
          <input
            value={replacement}
            onChange={(e) => onReplacementChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onReplaceOne()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
            placeholder="Replace with"
            aria-label="Replace with"
            className="border-outline-variant bg-surface-container-lowest font-ui text-on-surface w-40 border px-1 py-0 text-[11px] outline-none"
          />
          <Button
            variant="default"
            size="sm"
            className="font-ui h-5 px-1.5 text-[10px]"
            disabled={matchCount === 0}
            onClick={onReplaceOne}
          >
            Replace
          </Button>
          <Button
            variant="default"
            size="sm"
            className="font-ui h-5 px-1.5 text-[10px]"
            disabled={matchCount === 0}
            onClick={onReplaceAll}
          >
            Replace all
          </Button>
        </div>
      )}
    </div>
  )
}
