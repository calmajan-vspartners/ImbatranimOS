import { useEffect, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import {
  formatKeys,
  groupShortcuts,
  isTextEntry,
  useShortcutStore,
} from '../../hooks/shortcutRegistry'

const isMac = () => typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

/** The rendered shortcut list — shared by the overlay and the Settings section. */
export function ShortcutList() {
  const shortcuts = useShortcutStore((s) => s.shortcuts)
  const groups = groupShortcuts(Object.values(shortcuts))
  const mac = isMac()

  if (groups.length === 0) {
    return (
      <div className="text-on-surface-variant font-ui py-8 text-center text-[12px]">
        No shortcuts registered
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([scope, list]) => (
        <section key={scope}>
          <h3 className="font-ui text-on-surface-variant mb-1.5 text-[11px] font-semibold tracking-wider uppercase">
            {scope}
          </h3>
          <div className="border-outline-variant border">
            {list.map((s, i) => (
              <div
                key={s.id}
                className={`flex items-baseline justify-between gap-3 px-3 py-1.5 ${
                  i > 0 ? 'border-outline-variant border-t' : ''
                }`}
              >
                <div className="min-w-0">
                  <div className="font-ui text-on-surface text-[12px]">{s.description}</div>
                  {s.note && (
                    <div className="font-ui text-on-surface-variant mt-0.5 text-[11px]">
                      {s.note}
                    </div>
                  )}
                </div>
                <kbd className="font-ui text-on-surface-variant bg-surface-container-low border-outline-variant shrink-0 border px-1.5 py-0.5 text-[11px] tabular-nums">
                  {formatKeys(s.keys, mac)}
                </kbd>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/**
 * `?` / F1 opens the shortcut list.
 *
 * Deliberately not routed through `useRegisteredHotkeys`: those are modifier
 * combinations, whereas `?` is a bare printable character. It must only act
 * when the user is not typing, or it would swallow a question mark in Notepad
 * — and every keystroke in the Terminal, which reads through a hidden
 * textarea.
 */
export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault()
        setOpen((v) => !v)
        return
      }
      if (e.key !== '?') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTextEntry(e.target)) return
      e.preventDefault()
      setOpen((v) => !v)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen} title="Keyboard shortcuts">
      <ShortcutList />
    </Dialog>
  )
}
