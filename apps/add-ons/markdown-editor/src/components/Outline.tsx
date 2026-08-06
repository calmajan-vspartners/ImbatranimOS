import { ListTree } from 'lucide-react'
import { ScrollArea, cn } from '@imbatranim/ui'
import type { Heading } from '../lib/outline'

/**
 * Heading navigation for the document being edited.
 *
 * Indented by level rather than numbered, and truncated rather than wrapped: the rail is
 * 168px wide, and a heading that wraps to three lines costs more vertical space than the
 * two headings it pushes out of view.
 *
 * The active entry is the last heading at or above the caret — the same rule an outline
 * in any editor follows, and the reason it stays useful while typing rather than only
 * after a click.
 */
export function Outline({
  headings,
  activeLine,
  onSelect,
}: {
  headings: Heading[]
  /** Caret line, 1-based. */
  activeLine: number
  onSelect: (heading: Heading) => void
}) {
  const activeIndex = headings.reduce(
    (found, heading, index) => (heading.line <= activeLine ? index : found),
    -1
  )

  return (
    <div className="border-outline-variant bg-surface-container-low flex w-[168px] shrink-0 flex-col border-r">
      <div className="border-outline-variant text-on-surface-variant font-ui flex items-center gap-1 border-b px-2 py-1 text-[10px] uppercase">
        <ListTree size={11} />
        Outline
      </div>
      {headings.length === 0 ? (
        <p className="text-on-surface-variant font-ui p-2 text-[10px]">
          No headings yet. Start a line with <span className="font-mono">#</span> and it will appear
          here.
        </p>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ul className="py-1">
            {headings.map((heading, index) => (
              <li key={`${heading.line}-${heading.slug}`}>
                <button
                  type="button"
                  onClick={() => onSelect(heading)}
                  title={heading.title}
                  className={cn(
                    'font-ui block w-full truncate px-2 py-0.5 text-left text-[11px]',
                    index === activeIndex
                      ? 'bg-primary text-on-primary'
                      : 'text-on-surface hover:bg-surface-container-high'
                  )}
                  style={{ paddingLeft: 8 + (heading.level - 1) * 8 }}
                >
                  {heading.title}
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  )
}
