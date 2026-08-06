import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { api } from '../../lib/axios'
import { toSignIns, type LogEntry, type SignIn } from '../../shared/lib/systemLog'

/** How many rows to show. Enough to spot a pattern, short enough to read. */
const ROWS = 8

/**
 * Settings → Security → Recent sign-ins (brief 84).
 *
 * The System Log app has the whole record, but nobody opens a log app to ask
 * "has anyone been trying to get in?" — they look at Security. **Failures are
 * shown alongside successes**, and they are the reason this exists: a run of
 * refused attempts from an address that is not yours is the single most useful
 * thing the audit trail can tell you, and hiding it behind a separate app would
 * be hiding it.
 *
 * Read through the same authed `/logs` endpoint with a server-side filter, so
 * this is a short read of the tail rather than the whole file.
 */
export function RecentSignIns() {
  const [rows, setRows] = useState<SignIn[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api
      .get<{ entries: LogEntry[] }>('/logs', { params: { q: 'auth.login', limit: 40 } })
      .then((res) => {
        if (!cancelled) setRows(toSignIns(res.data.entries).slice(0, ROWS))
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="border-outline-variant bg-surface-container-low border p-4">
      <p className="text-on-surface mb-0.5 text-sm font-medium">Recent sign-ins</p>
      <p className="font-content text-on-surface-variant mb-3 text-[11px]">
        Successes and refusals, newest first. Open the System Log app for the full record.
      </p>

      {failed && (
        <p className="text-on-surface-variant text-[12px]">The system log could not be read.</p>
      )}
      {!failed && rows === null && (
        <p className="text-on-surface-variant text-[12px]">Reading the log…</p>
      )}
      {!failed && rows?.length === 0 && (
        <p className="text-on-surface-variant text-[12px]">
          No sign-ins recorded yet — the log starts from the first one after this update.
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul className="divide-outline-variant/50 divide-y">
          {rows.map((row, i) => (
            <li key={`${row.t}-${i}`} className="flex items-center gap-2 py-1 text-[12px]">
              {row.ok ? (
                <CheckCircle2 size={13} className="text-primary shrink-0" />
              ) : (
                <XCircle size={13} className="text-error shrink-0" />
              )}
              <span className={row.ok ? '' : 'text-error'}>{row.ok ? 'Signed in' : 'Refused'}</span>
              <span className="text-on-surface-variant font-mono text-[11px]">{row.ip}</span>
              <span className="flex-1" />
              <span className="text-on-surface-variant tabular-nums">
                {new Date(row.t).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
