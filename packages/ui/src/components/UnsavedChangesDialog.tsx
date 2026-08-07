import { Button } from './Button'
import { Dialog } from './Dialog'

export type UnsavedChangesDialogProps = {
  open: boolean
  /** Document name shown in the question — app content, not OS chrome. */
  name: string
  /**
   * Wire the real-OS third button (Save / Don't Save / Cancel). Absent = the
   * two-button discard-or-stay form, for apps with no sensible save.
   */
  onSave?: () => void
  /** Disables every button while a save is in flight — no racing the close. */
  saving?: boolean
  onDiscard: () => void
  onCancel: () => void
}

/**
 * The themed unsaved-changes prompt (brief 102) — the one dialog every dirty
 * close asks with, replacing the last native browser confirm. Desktop-modal
 * like every kit dialog: other windows are pointer-blocked but their JS keeps
 * running, which is exactly what the native modal broke. Esc, backdrop and the
 * title-bar × all mean Cancel — the only safe reading of a dismissal.
 */
export function UnsavedChangesDialog({
  open,
  name,
  onSave,
  saving = false,
  onDiscard,
  onCancel,
}: UnsavedChangesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onCancel()} title={name}>
      <p className="text-on-surface mb-4">
        {onSave ? (
          <>
            Do you want to save changes to <span className="font-semibold">{name}</span>?
          </>
        ) : (
          <>
            <span className="font-semibold">{name}</span> has unsaved changes. Close without saving?
          </>
        )}
      </p>
      <div className="flex justify-end gap-2">
        {onSave && (
          <Button variant="primary" size="sm" autoFocus disabled={saving} onClick={onSave}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        )}
        <Button variant="destructive" size="sm" disabled={saving} onClick={onDiscard}>
          {onSave ? "Don't Save" : 'Close without saving'}
        </Button>
        <Button variant="default" size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Dialog>
  )
}
