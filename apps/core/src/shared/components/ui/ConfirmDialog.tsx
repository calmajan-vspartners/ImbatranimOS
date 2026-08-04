import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'

export type ConfirmOptions = {
  title: string
  /**
   * `ReactNode`, not `string`: the File Manager's delete confirmation names the
   * target in bold, and forcing it to a plain string to reuse this dialog would
   * have made the shared component *worse* than the bespoke one it replaced.
   */
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type ConfirmDialogProps = ConfirmOptions & {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * A themed confirm dialog built on core's {@link Dialog}. Controlled: the parent
 * owns `open` and is notified via `onConfirm` / `onCancel`. Dismissing (backdrop,
 * Escape, close button) counts as a cancel. Prefer the {@link useConfirm} hook
 * for the common imperative `await confirm(...)` flow.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()} title={title}>
      <p className="text-on-surface mb-4">{message}</p>
      <div className="flex justify-end gap-2">
        <Button variant="default" size="sm" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant={destructive ? 'destructive' : 'primary'} size="sm" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}

type ConfirmState = ConfirmOptions & { open: boolean }

/**
 * Imperative confirm dialog. Call `confirm(opts)` to open the themed dialog and
 * `await` the user's choice: it resolves `true` on confirm, `false` on
 * cancel/dismiss. Render `confirmDialog` somewhere in your tree.
 *
 * ```tsx
 * const { confirm, confirmDialog } = useConfirm()
 * const ok = await confirm({ title: 'Delete', message: 'Sure?', destructive: true })
 * // ...somewhere in JSX: {confirmDialog}
 * ```
 *
 * Self-contained — no global provider required.
 */
// Co-located with its component by design; the hook is not a Fast Refresh
// boundary, so exporting it alongside <ConfirmDialog> is safe.
// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm(): {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  confirmDialog: ReactNode
} {
  const [state, setState] = useState<ConfirmState>({ open: false, title: '', message: '' })
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      // A re-entrant call while a dialog is still pending settles the prior
      // promise as false so its awaiter never hangs.
      resolverRef.current?.(false)
      resolverRef.current = resolve
      setState({ ...opts, open: true })
    })
  }, [])

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value)
    resolverRef.current = null
    setState((prev) => ({ ...prev, open: false }))
  }, [])

  // If the host unmounts with a confirm still pending, settle it false rather
  // than leaving the awaiter hung forever.
  useEffect(() => {
    return () => {
      resolverRef.current?.(false)
      resolverRef.current = null
    }
  }, [])

  const confirmDialog: ReactNode = (
    <ConfirmDialog
      open={state.open}
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      destructive={state.destructive}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  )

  return { confirm, confirmDialog }
}
