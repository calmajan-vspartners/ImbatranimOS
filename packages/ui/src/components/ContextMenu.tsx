import { useEffect, useMemo, type ReactNode } from 'react'
import { Menu } from '@base-ui/react/menu'
import { Check } from 'lucide-react'
import { cn } from '../cn'

export type ContextMenuItem =
  | {
      type?: 'item'
      label: string
      icon?: ReactNode
      onSelect: () => void
      danger?: boolean
      disabled?: boolean
      /** Present = render as a menuitemcheckbox with this state. */
      checked?: boolean
    }
  | { type: 'separator' }
  /** Escape hatch for one-off rows (the taskbar's workspace grid). */
  | { type: 'custom'; key: string; children: ReactNode }

type ContextMenuProps = {
  /** Viewport coordinates of the pointer (raw clientX/clientY). */
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
  /** Accessible name for the menu. */
  label?: string
}

/**
 * THE right-click menu (brief 105) — the third hand-rolled copy triggered the
 * promote-on-third-use rule, so this is now the only one. Wraps base-ui's Menu
 * primitives so every caller inherits the ARIA menu contract (focus moves in,
 * Arrow/Home/End, Enter activates, Escape closes and restores focus) and
 * floating-ui collision handling — edge clamping stops being hand-maintained
 * arithmetic. Portals to body above the taskbar; closes on outside press,
 * Escape, or any scroll (a cursor-anchored menu whose anchor scrolled away
 * must not float detached).
 *
 * Callers keep the imperative shape: `{menu && <ContextMenu x y items onClose/>}`.
 */
export function ContextMenu({ x, y, items, onClose, label = 'Context menu' }: ContextMenuProps) {
  // A point anchor at the stored pointer position — the positioner treats it
  // like any element and flips/shifts to keep the popup fully on screen.
  const anchor = useMemo(
    () => ({
      getBoundingClientRect: () =>
        ({ x, y, top: y, left: x, bottom: y, right: x, width: 0, height: 0 }) as DOMRect,
    }),
    [x, y]
  )

  useEffect(() => {
    const onScroll = () => onClose()
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [onClose])

  return (
    <Menu.Root open onOpenChange={(next) => !next && onClose()} modal={false}>
      <Menu.Portal>
        <Menu.Positioner
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={2}
          // Above the taskbar (z-9000); same layer its old menu used.
          className="z-[10000] outline-none"
        >
          <Menu.Popup
            aria-label={label}
            // Right-click on the open menu is swallowed, never re-opened.
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            className={cn(
              'border-outline-variant bg-surface-container-lowest min-w-40 border py-1',
              'shadow-[0_10px_28px_rgba(0,0,0,0.4)] outline-none'
            )}
          >
            {items.map((item, i) => {
              if (item.type === 'separator') {
                return (
                  <Menu.Separator key={i} className="border-outline-variant/50 my-1 border-t" />
                )
              }
              if (item.type === 'custom') {
                return <div key={item.key}>{item.children}</div>
              }
              const isCheckbox = item.checked !== undefined
              const itemClass = cn(
                'font-ui flex w-full cursor-default items-center gap-2 px-3 py-1 text-left text-[12px] outline-none select-none',
                item.disabled
                  ? 'text-on-surface-variant/50'
                  : item.danger
                    ? 'text-error data-[highlighted]:bg-error data-[highlighted]:text-on-error'
                    : 'text-on-surface data-[highlighted]:bg-primary data-[highlighted]:text-on-primary'
              )
              if (isCheckbox) {
                return (
                  <Menu.CheckboxItem
                    key={i}
                    checked={item.checked}
                    disabled={item.disabled}
                    onClick={() => !item.disabled && item.onSelect()}
                    className={itemClass}
                  >
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                      {item.checked && <Check size={12} strokeWidth={2.5} />}
                    </span>
                    <span className="flex-1">{item.label}</span>
                  </Menu.CheckboxItem>
                )
              }
              return (
                <Menu.Item
                  key={i}
                  disabled={item.disabled}
                  onClick={() => !item.disabled && item.onSelect()}
                  className={itemClass}
                >
                  {item.icon && (
                    <span className="flex w-3.5 shrink-0 justify-center">{item.icon}</span>
                  )}
                  <span className="flex-1">{item.label}</span>
                </Menu.Item>
              )
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
