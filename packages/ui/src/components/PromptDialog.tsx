import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { Input } from './Input'

export type PromptOptions = {
  title: string
  message?: string
  placeholder?: string
  initialValue?: string
  confirmLabel?: string
  cancelLabel?: string
}

type PromptDialogProps = Omit<PromptOptions, 'initialValue'> & {
  open: boolean
  value: string
  onValueChange: (value: string) => void
  onConfirm: (value: string) => void
  onCancel: () => void
}

/**
 * A themed prompt dialog built on core's {@link Dialog} + {@link Input}.
 * Controlled: the parent owns `open` and the input `value`, and is notified via
 * `onConfirm` (with the trimmed value) / `onCancel`. Dismissing (backdrop,
 * Escape, close button) counts as a cancel. Enter in the input confirms; confirm
 * is disabled while the trimmed value is empty. Prefer the {@link usePrompt} hook
 * for the common imperative `await prompt(...)` flow.
 */
export function PromptDialog({
  open,
  value,
  onValueChange,
  title,
  message,
  placeholder,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const trimmed = value.trim()

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()} title={title}>
      {message && <p className="text-on-surface mb-4">{message}</p>}
      <Input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && trimmed) onConfirm(trimmed)
        }}
        className="mb-4"
      />
      <div className="flex justify-end gap-2">
        <Button variant="default" size="sm" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant="primary" size="sm" disabled={!trimmed} onClick={() => onConfirm(trimmed)}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}

type PromptState = PromptOptions & { open: boolean; value: string }

/**
 * Imperative prompt dialog. Call `prompt(opts)` to open the themed dialog and
 * `await` the user's input: it resolves the trimmed string on confirm, `null` on
 * cancel/dismiss. Render `promptDialog` somewhere in your tree.
 *
 * ```tsx
 * const { prompt, promptDialog } = usePrompt()
 * const name = await prompt({ title: 'New file', placeholder: 'name.md' })
 * // ...somewhere in JSX: {promptDialog}
 * ```
 *
 * Self-contained — no global provider required.
 */
// Co-located with its component by design; the hook is not a Fast Refresh
// boundary, so exporting it alongside <PromptDialog> is safe.
// eslint-disable-next-line react-refresh/only-export-components
export function usePrompt(): {
  prompt: (opts: PromptOptions) => Promise<string | null>
  promptDialog: ReactNode
} {
  const [state, setState] = useState<PromptState>({
    open: false,
    title: '',
    value: '',
  })
  const resolverRef = useRef<((value: string | null) => void) | null>(null)

  const prompt = useCallback((opts: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      // A re-entrant call while a dialog is still pending settles the prior
      // promise as null so its awaiter never hangs.
      resolverRef.current?.(null)
      resolverRef.current = resolve
      setState({ ...opts, open: true, value: opts.initialValue ?? '' })
    })
  }, [])

  const settle = useCallback((value: string | null) => {
    resolverRef.current?.(value)
    resolverRef.current = null
    setState((prev) => ({ ...prev, open: false }))
  }, [])

  // If the host unmounts with a prompt still pending, settle it null rather than
  // leaving the awaiter hung forever.
  useEffect(() => {
    return () => {
      resolverRef.current?.(null)
      resolverRef.current = null
    }
  }, [])

  const promptDialog: ReactNode = (
    <PromptDialog
      open={state.open}
      value={state.value}
      onValueChange={(value) => setState((prev) => ({ ...prev, value }))}
      title={state.title}
      message={state.message}
      placeholder={state.placeholder}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      onConfirm={(value) => settle(value)}
      onCancel={() => settle(null)}
    />
  )

  return { prompt, promptDialog }
}
