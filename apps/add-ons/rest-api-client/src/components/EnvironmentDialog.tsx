import { useState } from 'react'
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { Button, Dialog, Input, ScrollArea, Select, cn } from '@imbatranim/core'
import type { Environment } from '../types'
import {
  MAX_ENVIRONMENTS,
  MAX_VARS_PER_ENV,
  looksSecret,
  maskValue,
  newVar,
} from '../lib/environments'
import { newId } from '../lib/ui'

/**
 * The environment editor.
 *
 * The plaintext warning is deliberately at the top and unmissable. The brief is
 * explicit that secrets here are not encrypted, and the honest thing is to say so
 * where the user is typing one — not to leave the word "secret" implying a protection
 * that does not exist. What the flag actually buys is listed too, so the checkbox
 * still reads as worth ticking.
 */
export function EnvironmentDialog({
  environments,
  activeEnvId,
  onChange,
  onClose,
}: {
  environments: Environment[]
  activeEnvId: string | null
  onChange: (environments: Environment[], activeEnvId: string | null) => void
  onClose: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    activeEnvId ?? environments[0]?.id ?? null
  )
  const [revealed, setRevealed] = useState<Set<string>>(new Set())

  const selected = environments.find((e) => e.id === selectedId) ?? null

  const update = (next: Environment) =>
    onChange(
      environments.map((e) => (e.id === next.id ? next : e)),
      activeEnvId
    )

  const addEnvironment = () => {
    if (environments.length >= MAX_ENVIRONMENTS) return
    const created: Environment = {
      id: newId(),
      name: `Environment ${environments.length + 1}`,
      vars: [],
    }
    onChange([...environments, created], activeEnvId ?? created.id)
    setSelectedId(created.id)
  }

  const removeEnvironment = (id: string) => {
    const remaining = environments.filter((e) => e.id !== id)
    onChange(remaining, activeEnvId === id ? (remaining[0]?.id ?? null) : activeEnvId)
    setSelectedId(remaining[0]?.id ?? null)
  }

  const toggleReveal = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()} title="Environments">
      <div className="flex w-[34rem] max-w-full flex-col gap-2">
        <p className="text-on-surface-variant text-[11px]">
          Values are stored <strong>unencrypted</strong> in{' '}
          <code className="font-mono">~/.config/rest-client/collections.json</code>. Marking one
          secret masks it here and leaves its value out of an export — it does not encrypt it.
        </p>

        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Select
              label="Environment"
              options={environments.map((e) => ({ value: e.id, label: e.name }))}
              value={selectedId ?? ''}
              onValueChange={(v) => setSelectedId(String(v))}
              placeholder={environments.length === 0 ? 'None yet' : 'Choose one'}
            />
          </div>
          <Button
            variant="default"
            size="sm"
            className="gap-1"
            onClick={addEnvironment}
            disabled={environments.length >= MAX_ENVIRONMENTS}
          >
            <Plus size={12} strokeWidth={2} /> New
          </Button>
          {selected && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => removeEnvironment(selected.id)}
              aria-label={`Delete ${selected.name}`}
              title="Delete this environment"
            >
              <Trash2 size={12} strokeWidth={2} />
            </Button>
          )}
        </div>

        {selected === null ? (
          <div className="text-on-surface-variant py-8 text-center text-[12px]">
            No environments yet. Create one to use{' '}
            <code className="font-mono">{'{{variables}}'}</code> in a request.
          </div>
        ) : (
          <>
            <Input
              label="Name"
              value={selected.name}
              onChange={(e) => update({ ...selected, name: e.target.value })}
            />

            <div className="font-ui text-on-surface-variant mt-1 text-[11px] font-semibold tracking-wider uppercase">
              Variables
            </div>
            <ScrollArea className="border-outline-variant max-h-64 min-h-0 border">
              {selected.vars.length === 0 ? (
                <div className="text-on-surface-variant px-2 py-3 text-[12px]">
                  No variables yet
                </div>
              ) : (
                selected.vars.map((entry) => {
                  const show = revealed.has(entry.id) || !entry.secret
                  return (
                    <div
                      key={entry.id}
                      className="border-outline-variant flex items-center gap-1 border-b px-1 py-1 last:border-b-0"
                    >
                      <input
                        className="border-outline-variant bg-surface-container-lowest text-on-surface w-40 shrink-0 border px-1.5 py-1 font-mono text-[12px] outline-none"
                        placeholder="name"
                        value={entry.name}
                        spellCheck={false}
                        onChange={(e) =>
                          update({
                            ...selected,
                            vars: selected.vars.map((v) =>
                              v.id === entry.id
                                ? {
                                    ...v,
                                    name: e.target.value,
                                    // Only auto-flip while the row is still untouched,
                                    // so a deliberate un-tick is never overridden.
                                    secret: v.value === '' ? looksSecret(e.target.value) : v.secret,
                                  }
                                : v
                            ),
                          })
                        }
                      />
                      <input
                        className={cn(
                          'border-outline-variant bg-surface-container-lowest text-on-surface min-w-0 flex-1 border px-1.5 py-1 font-mono text-[12px] outline-none'
                        )}
                        placeholder="value"
                        value={show ? entry.value : maskValue(entry.value)}
                        readOnly={!show}
                        spellCheck={false}
                        aria-label={`Value of ${entry.name || 'variable'}`}
                        onChange={(e) =>
                          update({
                            ...selected,
                            vars: selected.vars.map((v) =>
                              v.id === entry.id ? { ...v, value: e.target.value } : v
                            ),
                          })
                        }
                      />
                      {entry.secret && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleReveal(entry.id)}
                          aria-label={show ? 'Hide value' : 'Reveal value'}
                          title={show ? 'Hide' : 'Reveal'}
                        >
                          {show ? <EyeOff size={12} /> : <Eye size={12} />}
                        </Button>
                      )}
                      <label className="font-ui text-on-surface-variant flex shrink-0 items-center gap-1 px-1 text-[11px]">
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={entry.secret}
                          onChange={(e) =>
                            update({
                              ...selected,
                              vars: selected.vars.map((v) =>
                                v.id === entry.id ? { ...v, secret: e.target.checked } : v
                              ),
                            })
                          }
                        />
                        secret
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          update({
                            ...selected,
                            vars: selected.vars.filter((v) => v.id !== entry.id),
                          })
                        }
                        aria-label={`Remove ${entry.name || 'variable'}`}
                        title="Remove"
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  )
                })
              )}
            </ScrollArea>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 self-start"
              disabled={selected.vars.length >= MAX_VARS_PER_ENV}
              onClick={() => update({ ...selected, vars: [...selected.vars, newVar(newId())] })}
            >
              <Plus size={12} strokeWidth={2} /> Add variable
            </Button>
          </>
        )}

        <div className="mt-2 flex justify-end">
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
