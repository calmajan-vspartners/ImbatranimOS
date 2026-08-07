import { ChevronRight } from 'lucide-react'
import { cn } from '@imbatranim/ui'

type BreadcrumbProps = {
  root: string
  rootLabel: string
  path: string
  onNavigate: (path: string) => void
  /**
   * Right-aligned slot in the same bar — the search box (brief 112). A real
   * slot rather than a `flex-1` the caller has to remember: the segments must
   * be the part that shrinks and truncates when the path is long, so a deep
   * folder can never squeeze the search box out of the window.
   */
  right?: React.ReactNode
}

export function Breadcrumb({ root: _root, rootLabel, path, onNavigate, right }: BreadcrumbProps) {
  const parts = path ? path.split('/').filter(Boolean) : []

  const segments: { label: string; path: string }[] = [
    { label: rootLabel, path: '' },
    ...parts.map((part, idx) => ({
      label: part,
      path: parts.slice(0, idx + 1).join('/'),
    })),
  ]

  return (
    <div className="border-outline-variant bg-surface-container-low flex items-center gap-2 border-b px-2 py-1">
      <div className="flex min-w-0 flex-1 items-center gap-0 overflow-hidden">
        {segments.map((seg, idx) => {
          const isLast = idx === segments.length - 1
          return (
            <div key={seg.path} className="flex min-w-0 items-center">
              {idx > 0 && (
                <ChevronRight
                  size={12}
                  strokeWidth={2}
                  className="text-on-surface-variant mx-0.5 shrink-0"
                />
              )}
              <button
                onClick={() => !isLast && onNavigate(seg.path)}
                className={cn(
                  'font-ui truncate px-1 py-0.5 text-[12px]',
                  isLast
                    ? 'text-on-surface cursor-default font-semibold'
                    : 'text-on-surface-variant hover:text-primary hover:bg-surface-container cursor-pointer'
                )}
              >
                {seg.label}
              </button>
            </div>
          )
        })}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  )
}
