/**
 * The shape of a system-log entry, and the one derivation core needs from it
 * (brief 84).
 *
 * This lives in core rather than in the Logs add-on because it is a **backend
 * contract**, not that app's private model: Settings → Security reads sign-in
 * history from the same endpoint, and core importing an add-on would invert the
 * dependency the composition root exists to keep one-way (eslint enforces it,
 * and it caught this while the panel was being written). The add-on imports
 * these from here; the presentation — event labels, relative times, row
 * summaries — stays in the add-on, where it belongs.
 */
export type LogLevel = 'info' | 'warn' | 'error'
export type LogSource = 'server' | 'client'

export interface LogEntry {
  /** ISO timestamp. */
  t: string
  level: LogLevel
  /** Stable dotted event name, e.g. `auth.login.failed`. */
  event: string
  /**
   * `client` means the browser reported it, so it is only as trustworthy as the
   * session that sent it. Never render the two the same way.
   */
  source: LogSource
  msg: string
  meta?: unknown
}

/** One sign-in attempt, successful or not. */
export interface SignIn {
  t: string
  ip: string
  ok: boolean
}

/**
 * Pull sign-in history out of a page of log entries, newest first.
 *
 * Failures are kept, not filtered out — a run of refusals from an address that
 * is not yours is the single most useful thing the audit trail can tell you.
 */
export function toSignIns(entries: LogEntry[]): SignIn[] {
  return entries
    .filter((e) => e.event === 'auth.login.ok' || e.event === 'auth.login.failed')
    .map((e) => {
      const meta = (e.meta ?? {}) as Record<string, unknown>
      const ip = typeof meta.ip === 'string' && meta.ip.length > 0 ? meta.ip : 'unknown'
      return { t: e.t, ip, ok: e.event === 'auth.login.ok' }
    })
}
