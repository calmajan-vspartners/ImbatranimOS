import type { LogEntry } from '@imbatranim/core'

export type { LogEntry, LogLevel, LogSource } from '@imbatranim/core'

/**
 * Turn a dotted event name into something a person reads without a decoder ring.
 *
 * The log is for the owner of a single-user machine, not for an SRE grepping a
 * fleet, so `auth.login.failed` is shown as "Sign-in failed". The raw event is
 * still in the expanded JSON — this replaces the *label*, never the record.
 */
const EVENT_LABELS: Record<string, string> = {
  'auth.setup': 'Machine claimed',
  'auth.login.ok': 'Signed in',
  'auth.login.failed': 'Sign-in failed',
  'auth.logout': 'Signed out',
  'auth.throttle.locked': 'Address locked out',
  'auth.throttle.locked.global': 'Sign-in locked app-wide',
  'auth.password.changed': 'Password changed',
  'auth.password.failed': 'Password change refused',
  'auth.totp.enabled': 'Two-factor turned on',
  'auth.totp.disabled': 'Two-factor turned off',
  'process.killed': 'Process killed',
  'files.deleted': 'File deleted for good',
  'files.trash.emptied': 'Trash emptied',
  'backup.taken': 'Backup downloaded',
  'backup.restored': 'Restored from backup',
  'app.crashed': 'App crashed',
  'server.error': 'Server error',
}

export function eventLabel(event: string): string {
  return EVENT_LABELS[event] ?? event
}

/** Every event the log can currently produce, for the filter chips. */
export function knownEvents(): string[] {
  return Object.keys(EVENT_LABELS)
}

/**
 * A short, absolute-then-relative timestamp.
 *
 * Both, because the two questions are different: "when exactly" needs the clock
 * time, and "was this just now or last Tuesday" needs the distance. Showing only
 * one always leaves someone doing arithmetic.
 */
export function formatWhen(iso: string, now = Date.now()): { clock: string; relative: string } {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return { clock: iso, relative: '' }
  const date = new Date(ms)
  const clock = date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  return { clock, relative: relativeTime(ms, now) }
}

export function relativeTime(then: number, now = Date.now()): string {
  const seconds = Math.round((now - then) / 1000)
  if (seconds < 0) return 'just now'
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.round(days / 30)}mo ago`
}

/**
 * The one-line summary a row shows.
 *
 * The server already writes a readable `msg`; this adds the piece of metadata
 * that makes the row answer its own question — which address, which process,
 * which file — instead of forcing an expand for the fact everyone wants.
 */
export function summarise(entry: LogEntry): string {
  const meta = (entry.meta ?? {}) as Record<string, unknown>
  const detail =
    pick(meta, 'ip') ??
    pick(meta, 'originalPath') ??
    pick(meta, 'name') ??
    pick(meta, 'path') ??
    pick(meta, 'appId')
  return detail ? `${entry.msg} — ${detail}` : entry.msg
}

function pick(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}
