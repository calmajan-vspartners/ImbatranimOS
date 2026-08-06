import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { History, Lock, LogOut, Power, Trash2 } from 'lucide-react'
import { cn } from '../../../lib/cn'
import { useEnabledApps } from '../../registry/enabledApps'
import { Logo } from '../brand/Logo'
import { useAuthStore } from '../../../modules/auth/store/authStore'
import { logout as logoutApi } from '../../../modules/auth/api/authApi'
import { clearRecentFiles, useRecentFilesQuery } from '../../../lib/recentFiles'
import { openApp } from '../../intents/openApp'

type StartMenuProps = {
  onClose: () => void
  onOpenApp: (appId: string) => void
  anchorRef: React.RefObject<HTMLElement | null>
}

export function StartMenu({ onClose, onOpenApp, anchorRef }: StartMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)
  const enabledApps = useEnabledApps()
  // Entries for disabled apps are filtered at render (no app to show an icon
  // for, and openApp would refuse them anyway). Six is a glance, not a list.
  const { data: recentFiles } = useRecentFilesQuery()
  const recent = (recentFiles ?? []).slice(0, 6)

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node
      if (menuRef.current?.contains(t)) return
      if (anchorRef.current?.contains(t)) return
      onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, anchorRef])

  // Move focus into the menu on open and restore it to the trigger on close, so
  // the menu is operable and the keyboard user is not stranded when it dismisses.
  useEffect(() => {
    const trigger = anchorRef.current
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    return () => trigger?.focus()
  }, [anchorRef])

  // Roving focus across the menu items (Arrow keys wrap; Home/End jump).
  function handleMenuKeyDown(e: React.KeyboardEvent) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []
    )
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      items[current < 0 ? 0 : (current + 1) % items.length].focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      items[current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length].focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      items[0].focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      items[items.length - 1].focus()
    }
  }

  // Lock: return to the lock screen without ending the session on the client.
  function handleLock() {
    setAuthenticated(false)
    onClose()
  }

  // Log off: end the session on the backend, then re-lock.
  async function handleLogout() {
    onClose()
    try {
      await logoutApi()
    } finally {
      setAuthenticated(false)
    }
  }

  return (
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      role="menu"
      aria-label="Start menu"
      onKeyDown={handleMenuKeyDown}
      className={cn(
        'absolute bottom-full left-0 z-[9001] mb-1 flex w-[280px] flex-col',
        'border-outline-variant bg-surface-container-low border',
        'shadow-[0_-8px_32px_rgba(0,0,0,0.45)]'
      )}
    >
      {/* Brand header */}
      <div className="border-outline-variant bg-surface-container flex items-center gap-2.5 border-b px-4 py-3">
        <Logo size={26} className="text-on-surface" />
        <div className="leading-tight">
          <div className="text-on-surface text-[13px] font-bold tracking-tight">
            Imbatranim<span className="text-primary">OS</span>
          </div>
          <div className="text-on-surface-variant text-[10px]">Signed in</div>
        </div>
      </div>

      {/* App list */}
      <div className="flex max-h-[52vh] flex-col overflow-y-auto py-1">
        {enabledApps.map((app) => {
          const Icon = app.icon
          return (
            <button
              key={app.id}
              role="menuitem"
              onClick={() => {
                onOpenApp(app.id)
                onClose()
              }}
              className={cn(
                'group flex items-center gap-3 px-4 py-1.5 text-left outline-none',
                'hover:bg-primary hover:text-on-primary',
                'focus-visible:bg-primary focus-visible:text-on-primary'
              )}
            >
              <span className="border-outline-variant bg-surface-container-lowest flex h-7 w-7 shrink-0 items-center justify-center border group-hover:border-transparent group-hover:bg-white/15">
                <Icon size={16} strokeWidth={1.75} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-medium">{app.name}</span>
                <span className="text-on-surface-variant group-hover:text-on-primary/80 block truncate text-[10px]">
                  {app.description}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {/* Recent files (brief 94) — hidden entirely while the list is empty */}
      {recent.length > 0 && (
        <div className="border-outline-variant border-t py-1">
          <div className="flex items-center justify-between px-4 pt-1 pb-0.5">
            <span className="text-on-surface-variant flex items-center gap-1.5 text-[9px] font-semibold tracking-widest uppercase">
              <History size={10} strokeWidth={2} />
              Recent
            </span>
            <button
              type="button"
              aria-label="Clear recent files"
              title="Clear recent files"
              onClick={() => void clearRecentFiles()}
              className="text-on-surface-variant hover:text-on-surface outline-none"
            >
              <Trash2 size={11} strokeWidth={1.75} />
            </button>
          </div>
          {recent.map((f) => {
            const app = enabledApps.find((a) => a.id === f.appId)
            if (!app) return null
            const Icon = app.icon
            return (
              <button
                key={`${f.root}:${f.path}`}
                role="menuitem"
                onClick={() => {
                  openApp(f.appId, { openPath: f.path, root: f.root })
                  onClose()
                }}
                className={cn(
                  'group flex w-full items-center gap-3 px-4 py-1 text-left outline-none',
                  'hover:bg-primary hover:text-on-primary',
                  'focus-visible:bg-primary focus-visible:text-on-primary'
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  <Icon size={13} strokeWidth={1.75} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px]">
                    {f.path.split('/').pop() ?? f.path}
                  </span>
                  <span className="text-on-surface-variant group-hover:text-on-primary/80 block truncate text-[9px]">
                    {f.path}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Session actions */}
      <div className="border-outline-variant bg-surface-container flex items-stretch border-t">
        <button
          role="menuitem"
          onClick={handleLock}
          className="text-on-surface hover:bg-surface-container-high focus-visible:ring-primary flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset"
        >
          <Lock size={14} strokeWidth={1.75} />
          Lock
        </button>
        <div className="bg-outline-variant w-px" />
        <button
          role="menuitem"
          onClick={handleLogout}
          className="text-on-surface hover:bg-error hover:text-on-error focus-visible:ring-primary flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset"
        >
          <LogOut size={14} strokeWidth={1.75} />
          Log off
        </button>
      </div>
      <div className="border-outline-variant text-on-surface-variant flex items-center justify-between border-t px-4 py-1.5 text-[9px] tracking-widest uppercase">
        <span>ImbatranimOS</span>
        <Power size={11} strokeWidth={1.75} className="opacity-60" />
      </div>
    </motion.div>
  )
}
