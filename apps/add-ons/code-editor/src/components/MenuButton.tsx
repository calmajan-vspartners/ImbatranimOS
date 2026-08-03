import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@imbatranim/core'

export type MenuEntry =
  | {
      type?: 'item'
      label: string
      /** Right-aligned key hint, e.g. `Ctrl+S`. Display only — bind separately. */
      hint?: string
      icon?: ReactNode
      onSelect: () => void
      disabled?: boolean
      /** Renders a checkmark column; use for toggles. */
      checked?: boolean
    }
  | { type: 'separator' }

/**
 * A menu-bar button with a drop-down, in the classic desktop idiom.
 *
 * Kept local to this app rather than promoted to core: the file manager's
 * `ContextMenu` is cursor-anchored and this one is button-anchored, and one
 * component that does both would be worse than two that each do one. If a
 * third caller appears, that is the moment to promote it.
 */
export function MenuButton({
  label,
  items,
  align = 'left',
}: {
  label: string
  items: MenuEntry[]
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'font-ui border border-transparent px-2 py-0.5 text-[12px]',
          'focus-visible:ring-primary outline-none focus-visible:ring-2',
          open
            ? 'border-outline-variant bg-surface-container-high text-on-surface'
            : 'text-on-surface hover:bg-surface-container'
        )}
      >
        {label}
      </button>

      {open && (
        <div
          role="menu"
          className="border-outline-variant bg-surface-container-lowest absolute top-full left-0 z-50 min-w-56 border py-1 shadow-md"
          style={align === 'right' ? { left: 'auto', right: 0 } : undefined}
        >
          {items.map((item, i) =>
            item.type === 'separator' ? (
              <div key={i} className="border-outline-variant/50 my-1 border-t" />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
                className={cn(
                  'font-ui flex w-full items-center gap-2 px-2.5 py-1 text-left text-[12px]',
                  item.disabled
                    ? 'text-on-surface-variant/50 cursor-not-allowed'
                    : 'text-on-surface hover:bg-surface-container'
                )}
              >
                <span className="flex w-3.5 shrink-0 justify-center">
                  {item.checked ? '✓' : (item.icon ?? null)}
                </span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.hint && (
                  <span className="text-on-surface-variant shrink-0 text-[11px] tabular-nums">
                    {item.hint}
                  </span>
                )}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
