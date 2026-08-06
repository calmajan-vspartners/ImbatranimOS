import { useState } from 'react'
import { AlertTriangle, RotateCcw, X } from 'lucide-react'
import { Button } from '../ui'

/**
 * What a crashed app's window shows instead of the app (brief 47).
 *
 * Recoverable and in-chrome: the window is still a window. **Reload** remounts
 * the app with a fresh key — which is a real fix for the common case, a crash on
 * bad state that a clean mount does not reproduce — and **Close** is the ordinary
 * close action, so the user is never stuck with a window they cannot get rid of.
 *
 * The raw message is behind a disclosure rather than printed by default. A stack
 * trace as the first thing a user sees reads as "this software is broken",
 * whereas one sentence and a Reload button reads as "this app is broken, and
 * here is what to do" — and the details are still one click away for the person
 * who wants them.
 */
export function AppErrorFallback({
  appName,
  error,
  onReload,
  onClose,
}: {
  appName: string
  error: Error
  onReload: () => void
  onClose: () => void
}) {
  const [showDetails, setShowDetails] = useState(false)

  return (
    <div className="bg-surface text-on-surface flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertTriangle size={26} strokeWidth={1.75} className="text-error" />
      <div>
        <p className="text-[13px] font-semibold">{appName} stopped working</p>
        <p className="text-on-surface-variant mt-1 max-w-sm text-[12px]">
          The rest of the desktop is fine. Reload the app to start it again — anything it had not
          saved is gone.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" className="gap-1" onClick={onReload}>
          <RotateCcw size={12} strokeWidth={2} />
          Reload
        </Button>
        <Button variant="default" size="sm" className="gap-1" onClick={onClose}>
          <X size={12} strokeWidth={2} />
          Close window
        </Button>
      </div>

      <button
        onClick={() => setShowDetails((v) => !v)}
        className="text-on-surface-variant hover:text-on-surface text-[11px] underline underline-offset-2"
      >
        {showDetails ? 'Hide details' : 'Show details'}
      </button>
      {showDetails && (
        <pre className="border-outline-variant bg-surface-container-lowest text-on-surface-variant max-h-32 w-full max-w-md overflow-auto border p-2 text-left font-mono text-[11px] whitespace-pre-wrap">
          {error.message || String(error)}
        </pre>
      )}
    </div>
  )
}
