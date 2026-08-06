/**
 * Forms panel (side-panel tab) — lists detected AcroForm fields and edits them
 * inline. Reads `doc.forms.list()` (which reflects staged edits: a pending value
 * wins over the on-disk one), writes with `doc.forms.set(name, value)`, and can
 * flatten. Signature fields route to the Sign pad via the editor.
 *
 * Set values persist through `doc.save()`; "Apply to page" (a `save→reload`
 * raster sync) makes the filled widgets show in the rendered canvas, and is run
 * automatically after a flatten.
 *
 * Rebuilt in the OS design language: core `Input` / `Checkbox` / `Select` for the
 * editors, `Button` for the actions, Tailwind token utilities for layout.
 */
import { useCallback, useState } from 'react'
import type { JSX } from 'react'
import type { FieldInfo, FieldValue } from '@pdfcore/engine'
import { Button, Checkbox, Input, Select, notify } from '@imbatranim/core'
import { Check, Layers, Signature } from 'lucide-react'
import { useReader } from '../app/context'
import { useEditor } from '../editor/context'

const msgOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function FormsPanel(): JSX.Element {
  const { doc, goToPage, renderEpoch, markDirty } = useReader()
  const { syncRaster, openSignDialogForField, busy } = useEditor()
  const [tick, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const bump = useCallback(() => setTick((t) => t + 1), [])

  if (!doc) return <div className="text-on-surface-variant p-3 text-[12px]">No document.</div>

  // Re-read on every render; `tick`/`renderEpoch` force it after an edit.
  void tick
  void renderEpoch
  let fields: FieldInfo[]
  try {
    fields = doc.forms.list()
  } catch {
    return (
      <div className="text-on-surface-variant p-3 text-[12px]">Could not read form fields.</div>
    )
  }

  if (!fields.length) {
    return (
      <div className="text-on-surface-variant p-3 text-[12px]">
        This document has no interactive form fields.
      </div>
    )
  }

  const setValue = (name: string, value: FieldValue) => {
    try {
      doc.forms.set(name, value)
      // A form value changed but is not yet written to disk — mark unsaved so
      // the close guard and Save button reflect it.
      markDirty()
      setError(null)
    } catch (err) {
      setError(msgOf(err))
    }
    bump()
  }

  // "Apply to page" — bake the current values into the raster. `syncRaster` can
  // reject; surface it instead of leaving an unhandled rejection with no feedback (M6).
  const applyToPage = () => {
    void syncRaster().catch((err) =>
      notify({ appId: 'norpdf', level: 'error', title: 'Apply failed', body: msgOf(err) })
    )
  }

  const flattenAll = async () => {
    try {
      doc.forms.flatten()
      await syncRaster()
      bump()
    } catch (err) {
      notify({ appId: 'norpdf', level: 'error', title: 'Flatten failed', body: msgOf(err) })
    }
  }

  const editable = fields.filter((f) => f.type !== 'signature' && !f.readonly)

  return (
    <div className="flex h-full flex-col">
      <div className="text-on-surface-variant border-outline-variant font-ui border-b px-3 py-2 text-[11px]">
        {fields.length} field{fields.length === 1 ? '' : 's'}
      </div>

      <ul className="min-h-0 flex-1 overflow-auto">
        {fields.map((f) => (
          <li key={f.name} className="border-outline-variant border-b px-2.5 py-2">
            <button
              type="button"
              className="hover:text-primary flex w-full items-center justify-between gap-2 text-left"
              title={`Go to page ${f.page}`}
              onClick={() => goToPage(f.page)}
            >
              <span className="text-on-surface font-ui truncate text-[12px]" title={f.name}>
                {f.name}
              </span>
              <span className="text-on-surface-variant flex shrink-0 items-center gap-1 text-[10px]">
                <span className="bg-surface-container-high px-1 py-0.5">{f.type}</span>
                {f.required && (
                  <span className="text-error" title="Required">
                    *
                  </span>
                )}
                <span className="tabular-nums">p{f.page}</span>
              </span>
            </button>
            <div className="mt-1.5">
              <FieldControl
                field={f}
                onSet={setValue}
                onSign={() => openSignDialogForField(f.name)}
              />
            </div>
          </li>
        ))}
      </ul>

      {error && (
        <div className="text-error border-outline-variant border-t px-3 py-2 text-[11px]">
          {error}
        </div>
      )}

      <div className="border-outline-variant flex gap-1.5 border-t p-2">
        <Button
          variant="default"
          size="sm"
          className="flex flex-1 items-center justify-center gap-1"
          disabled={busy || !editable.length}
          onClick={applyToPage}
          title="Render the current values onto the page canvas"
        >
          <Check size={14} />
          Apply to page
        </Button>
        <Button
          variant="default"
          size="sm"
          className="flex flex-1 items-center justify-center gap-1"
          disabled={busy}
          onClick={() => void flattenAll()}
          title="Bake all field values into the page and remove the widgets"
        >
          <Layers size={14} />
          Flatten all
        </Button>
      </div>
    </div>
  )
}

function FieldControl({
  field,
  onSet,
  onSign,
}: {
  field: FieldInfo
  onSet: (name: string, value: FieldValue) => void
  onSign: () => void
}): JSX.Element {
  const { name, type, value, options, readonly } = field

  switch (type) {
    case 'checkbox':
      return (
        <Checkbox
          checked={value === true}
          disabled={readonly}
          onCheckedChange={(checked: boolean) => onSet(name, checked === true)}
          label={value === true ? 'Checked' : 'Unchecked'}
        />
      )

    case 'radio':
      return (
        <div className="flex flex-col gap-1">
          {(options ?? []).map((opt) => (
            <label
              key={opt}
              className="text-on-surface font-content flex cursor-pointer items-center gap-2 text-[12px]"
            >
              <input
                type="radio"
                name={name}
                className="accent-primary"
                checked={value === opt}
                disabled={readonly}
                onChange={() => onSet(name, opt)}
              />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      )

    case 'dropdown':
      return (
        <Select
          value={typeof value === 'string' ? value : ''}
          disabled={readonly}
          onValueChange={(v: unknown) => onSet(name, typeof v === 'string' ? v : '')}
          placeholder="— none —"
          options={[
            { value: '', label: '— none —' },
            ...(options ?? []).map((opt) => ({ value: opt, label: opt })),
          ]}
        />
      )

    case 'listbox':
      return (
        <select
          className="border-outline-variant bg-surface-container-lowest text-on-surface font-ui focus:border-primary w-full border px-2 py-1 text-[12px] outline-none"
          multiple
          value={Array.isArray(value) ? value : []}
          disabled={readonly}
          onChange={(e) =>
            onSet(
              name,
              Array.from(e.target.selectedOptions, (o) => o.value)
            )
          }
        >
          {(options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )

    case 'signature':
      return (
        <Button variant="default" size="sm" className="flex items-center gap-1" onClick={onSign}>
          <Signature size={14} />
          Sign this field
        </Button>
      )

    case 'text':
    default:
      return (
        <Input
          type="text"
          value={typeof value === 'string' ? value : ''}
          disabled={readonly}
          placeholder={readonly ? '(read-only)' : 'Enter text…'}
          onChange={(e) => onSet(name, e.target.value)}
        />
      )
  }
}
