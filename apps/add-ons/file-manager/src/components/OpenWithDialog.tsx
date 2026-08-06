import { useMemo, useState } from 'react'
import { Button, Checkbox, Dialog, cn, useSystem } from '@imbatranim/ui'

/**
 * "Open with…" — the chooser, and the place a default gets set (brief 81).
 *
 * It serves two arrivals, and they want different lists:
 *
 * - **the context menu**, where the user is overriding a working default, so the
 *   apps that claim this type come first and the rest are behind "Show all";
 * - **a double-click on something nothing claims**, where the claimants list is
 *   empty and the honest thing is to show everything immediately.
 *
 * "Always use this" writes a dotfile (brief 49), so the choice follows the
 * account rather than the browser — and it is keyed by *extension*, not by file:
 * per-file overrides are state nobody can find again later.
 */
export function OpenWithDialog({
  fileName,
  onPick,
  onClose,
}: {
  fileName: string
  onPick: (appId: string) => void
  onClose: () => void
}) {
  const { associations } = useSystem().intents
  const claimants = useMemo(() => associations.candidatesFor(fileName), [associations, fileName])
  const everything = useMemo(() => associations.allCandidates(), [associations])
  const [showAll, setShowAll] = useState(claimants.length === 0)
  const [remember, setRemember] = useState(false)
  const [picked, setPicked] = useState<string>(claimants[0]?.appId ?? '')

  const key = associations.keyFor(fileName)
  const options = showAll ? everything : claimants.length > 0 ? claimants : everything

  function confirm() {
    if (picked === '') return
    if (remember) associations.setDefault(key, picked)
    onPick(picked)
    onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Open with"
      description={fileName}
    >
      <div className="flex flex-col gap-2">
        {claimants.length === 0 && (
          <p className="text-on-surface-variant text-[12px]">
            No app claims this file type. Pick one — the text editor opens most things.
          </p>
        )}

        <div className="border-outline-variant max-h-56 overflow-auto border">
          {options.map((candidate) => (
            <button
              key={candidate.appId}
              onClick={() => setPicked(candidate.appId)}
              aria-pressed={picked === candidate.appId}
              className={cn(
                'border-outline-variant/50 flex w-full items-center gap-2 border-b px-2 py-1.5 text-left text-[12px] last:border-b-0',
                picked === candidate.appId
                  ? 'bg-primary text-on-primary'
                  : 'hover:bg-surface-container-high'
              )}
            >
              {candidate.name}
              {claimants.some((c) => c.appId === candidate.appId) && showAll && (
                <span className="ml-auto text-[10px] opacity-70">handles this type</span>
              )}
            </button>
          ))}
        </div>

        {claimants.length > 0 && !showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="text-on-surface-variant hover:text-on-surface self-start text-[11px] underline underline-offset-2"
          >
            Show all apps
          </button>
        )}

        {/* Core's Checkbox is its own <label>; wrapping it in another would nest
            two labels for one control. */}
        <Checkbox
          label={`Always use this for ${key.startsWith('.') ? key : `.${key}`} files`}
          checked={remember}
          onCheckedChange={(next) => setRemember(next)}
        />

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="default" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={picked === ''} onClick={confirm}>
            Open
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
