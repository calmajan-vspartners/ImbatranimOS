import { ChevronRight } from 'lucide-react'
import { cn } from '@imbatranim/ui'

type BreadcrumbProps = {
  root: string
  rootLabel: string
  path: string
  onNavigate: (path: string) => void
}

export function Breadcrumb({ root: _root, rootLabel, path, onNavigate }: BreadcrumbProps) {
  const parts = path ? path.split('/').filter(Boolean) : []

  const segments: { label: string; path: string }[] = [
    { label: rootLabel, path: '' },
    ...parts.map((part, idx) => ({
      label: part,
      path: parts.slice(0, idx + 1).join('/'),
    })),
  ]

  return (
    <div className="border-outline-variant bg-surface-container-low flex items-center gap-0 border-b px-2 py-1">
      {segments.map((seg, idx) => {
        const isLast = idx === segments.length - 1
        return (
          <div key={seg.path} className="flex items-center">
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
                'font-ui px-1 py-0.5 text-[12px]',
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
  )
}
