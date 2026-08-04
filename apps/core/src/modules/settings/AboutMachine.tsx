import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { api } from '../../lib/axios'
import { Button } from '../../shared/components/ui/Button'
import { formatUptime } from '../../lib/formatUptime'

export type AboutInfo = {
  hostname: string
  kernel: string
  platform: string
  arch: string
  uptimeSeconds: number
  imageVersion: string
}

/**
 * Settings → About this machine.
 *
 * It used to be three hardcoded strings — `OS: ImbatranimOS`, `Shell: React desktop
 * on Alpine`, `Status: Developer Preview` — plus a `v0.1 · preview` footer, while
 * `GET /api/system/about` had always returned the real hostname, kernel, platform,
 * arch, uptime and `IMAGE_VERSION`, and `package.json` was at 1.0.0. So a panel
 * titled "About this machine" knew nothing about the machine and reported a version
 * the OS was not. Brief 57 calls that the third place a new user notices the
 * illusion break, and it is right.
 *
 * Now every row comes from the API, and the version is whatever `IMAGE_VERSION` says
 * — so it cannot drift from the image again.
 */
/** The bare API call. Plain function, no state — see the effect for why. */
async function fetchAbout(): Promise<AboutInfo> {
  const res = await api.get<AboutInfo>('/system/about')
  return res.data
}

const READ_FAILED = 'Could not read this machine\u2019s details.'

export function AboutMachine({ onVersion }: { onVersion?: (version: string) => void }) {
  const [info, setInfo] = useState<AboutInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Starts true: the mount effect fetches immediately, and every setState below
  // happens inside an async callback rather than synchronously in the effect body
  // (which would cascade renders — `react-hooks/set-state-in-effect`).
  const [loading, setLoading] = useState(true)

  const onVersionRef = useRef(onVersion)
  useEffect(() => {
    onVersionRef.current = onVersion
  }, [onVersion])

  /**
   * Fetch on mount, with every setState inside the async IIFE.
   *
   * Inlined rather than calling a shared `useCallback`: `react-hooks/
   * set-state-in-effect` traces into a callback and flags the *call site*, so the
   * only shape it accepts is state updates living inside an async closure the
   * effect body kicks off. `fetchAbout` above holds the part worth sharing — the
   * request — and each caller owns its own state transitions. Same pattern as
   * `StorageSettings`.
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchAbout()
        if (cancelled) return
        setInfo(data)
        setError(null)
        onVersionRef.current?.(data.imageVersion)
      } catch {
        if (cancelled) return
        // Named as a failure to READ the machine, not as a fact about it. The old
        // hardcoded rows could never fail, which is exactly why they were wrong.
        setInfo(null)
        setError(READ_FAILED)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const retry = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const data = await fetchAbout()
      setInfo(data)
      onVersionRef.current?.(data.imageVersion)
    } catch {
      setError(READ_FAILED)
    } finally {
      setLoading(false)
    }
  }, [])

  const rows: { label: string; value: string }[] = info
    ? [
        { label: 'Hostname', value: info.hostname },
        { label: 'Kernel', value: info.kernel },
        { label: 'Platform', value: `${info.platform} · ${info.arch}` },
        { label: 'Uptime', value: formatUptime(info.uptimeSeconds) },
        { label: 'Image version', value: info.imageVersion },
      ]
    : []

  return (
    <div className="grid gap-2">
      {loading && (
        <div className="border-outline-variant bg-surface-container-low text-on-surface-variant flex items-center gap-2 border px-3 py-2.5 text-[12px]">
          <Loader2 size={13} className="animate-spin" />
          Reading this machine…
        </div>
      )}

      {error && !loading && (
        <div className="border-outline-variant bg-surface-container-low flex items-center justify-between gap-3 border px-3 py-2.5">
          <span className="text-error font-content text-[12px]">{error}</span>
          <Button
            variant="default"
            size="sm"
            className="flex items-center gap-1"
            onClick={() => void retry()}
          >
            <RefreshCw size={11} />
            Retry
          </Button>
        </div>
      )}

      {rows.map((item) => (
        <div
          key={item.label}
          className="border-outline-variant bg-surface-container-low flex items-center justify-between gap-3 border px-3 py-2.5"
        >
          <span className="text-on-surface-variant text-[10px] font-semibold tracking-widest uppercase">
            {item.label}
          </span>
          <span className="font-ui text-on-surface truncate text-[13px] font-semibold">
            {item.value}
          </span>
        </div>
      ))}
    </div>
  )
}
