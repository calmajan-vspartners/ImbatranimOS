import { useEffect, useRef, useState } from 'react'
import { useWindowStore } from '../../store/windowStore'
import { isShellSuspended } from '../../../modules/auth/store/authStore'
import { APP_REGISTRY } from '../../registry/registry'
import { useDocumentedShortcuts } from '../../hooks/useRegisteredHotkeys'
import { cn } from '../../../lib/cn'
import { openOrAdvance, switcherOrder, commitTarget, type SwitcherState } from './switcherModel'

/**
 * The Alt+Tab switcher (brief 104): see where you are going.
 *
 * Selection is COMPONENT state — the store is untouched until commit, so Esc
 * is simply closing the overlay: z-order, the persisted layout and focus stay
 * byte-identical. (Focus-as-you-cycle would mint a z per step and corrupt the
 * very MRU order being traversed — that was the old cycle's bug.)
 *
 * Hold-Alt semantics need a keyup, which the hotkey plumbing cannot express
 * (keydown-only), so the component owns its listeners — the ShortcutsOverlay
 * precedent — and the bindings are published via useDocumentedShortcuts, the
 * documented-mod+S pattern. Window blur COMMITS the visible selection: if the
 * host OS stole focus mid-switch the Alt keyup never arrives, and eating the
 * user's switch reads worse than honoring what the overlay showed.
 */
export function AltTabSwitcher() {
  const [state, setState] = useState<SwitcherState | null>(null)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })
  // Subscribed (not getState-in-render) so titles and minimized badges stay
  // live while the overlay is up; when closed this renders null instantly.
  const windows = useWindowStore((s) => s.windows)

  useDocumentedShortcuts([
    {
      id: 'window.switcher',
      keys: 'alt+tab',
      description: 'Switch windows (hold Alt, Tab to advance, release to commit)',
      scope: 'Window management',
      note: 'The host OS or browser may intercept this outside the kiosk',
    },
    {
      id: 'window.switcher-back',
      keys: 'alt+shift+tab',
      description: 'Switch windows backwards',
      scope: 'Window management',
      note: 'The host OS or browser may intercept this outside the kiosk',
    },
  ])

  useEffect(() => {
    const commit = () => {
      const id = commitTarget(stateRef.current)
      setState(null)
      if (!id) return
      const store = useWindowStore.getState()
      const win = store.windows.find((w) => w.id === id)
      if (!win) return
      // The taskbar's own click path: restore first when minimized, then
      // focus — never around the store, so the workspace-follow invariant in
      // focusWindow keeps holding.
      if (!win.isVisible) store.showWindow(id)
      store.focusWindow(id)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // A covered screen eats no keys (brief 101).
      if (isShellSuspended()) return
      if (e.key === 'Tab' && e.altKey) {
        e.preventDefault()
        const dir: 1 | -1 = e.shiftKey ? -1 : 1
        setState((prev) => {
          if (prev) return openOrAdvance(prev, prev.ids, dir)
          const { windows, activeWorkspace } = useWindowStore.getState()
          const ordered = switcherOrder(windows, activeWorkspace).map((w) => w.id)
          return openOrAdvance(null, ordered, dir)
        })
        return
      }
      if (!stateRef.current) return
      // While open: arrows also move, Enter commits, Esc cancels.
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        setState((prev) => (prev ? openOrAdvance(prev, prev.ids, 1) : prev))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        setState((prev) => (prev ? openOrAdvance(prev, prev.ids, -1) : prev))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        commit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setState(null)
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (!stateRef.current) return
      if (e.key === 'Alt') {
        e.preventDefault()
        commit()
      }
    }

    // The host OS stole focus mid-switch: the Alt keyup will never arrive.
    const onBlur = () => {
      if (stateRef.current) commit()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  if (!state) return null

  const cells = state.ids
    .map((id) => windows.find((w) => w.id === id))
    .filter((w): w is NonNullable<typeof w> => w !== undefined)

  return (
    <div
      data-testid="alt-tab-switcher"
      // Above every window AND the taskbar (z-9000) / its menu (10000).
      className="fixed inset-0 z-[10001] flex items-center justify-center"
      aria-hidden
    >
      <div className="border-outline-variant bg-surface-container flex max-w-[80vw] gap-2 overflow-x-auto border p-3 shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
        {cells.map((w, i) => {
          const app = APP_REGISTRY.find((a) => a.id === w.appId)
          const Icon = app?.icon
          const selected = i === state.index
          return (
            <div
              key={w.id}
              className={cn(
                'flex w-[120px] shrink-0 flex-col items-center gap-2 border px-2 py-3',
                selected
                  ? 'border-primary bg-surface-container-high'
                  : 'border-outline-variant bg-surface-container-low'
              )}
            >
              {Icon && (
                <Icon
                  size={28}
                  strokeWidth={1.5}
                  className={selected ? 'text-on-surface' : 'text-on-surface-variant'}
                />
              )}
              <span
                className={cn(
                  'font-ui w-full truncate text-center text-[11px]',
                  selected ? 'text-on-surface font-semibold' : 'text-on-surface-variant'
                )}
              >
                {w.title}
                {!w.isVisible ? ' (minimized)' : ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
