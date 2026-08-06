import { useState } from 'react'
import { Copy } from 'lucide-react'
import { Button, Dialog, notify } from '@imbatranim/core'
import { CurlParseError, describeIgnored, parseCurl, toCurl } from '../lib/curl'
import type { BodyMode, FormField, HeaderRow, HttpMethod } from '../types'
import { newId } from '../lib/ui'

/**
 * curl in and out, in one dialog.
 *
 * Import shows a live preview of what it parsed **before** anything is applied — a
 * curl command is somebody else's text, and silently loading a misread version of it
 * is worse than refusing. Anything the parser had to drop is named, so a `-o out.json`
 * or a `--cacert` cannot vanish without a word.
 */
export function CurlDialog({
  mode,
  request,
  onImport,
  onClose,
}: {
  mode: 'import' | 'export'
  request: { method: HttpMethod; url: string; headers: HeaderRow[]; body: string }
  onImport: (parsed: {
    method: HttpMethod
    url: string
    headers: HeaderRow[]
    body: string
    bodyMode: BodyMode
    form: FormField[]
  }) => void
  onClose: () => void
}) {
  const [text, setText] = useState(mode === 'export' ? toCurl(request) : '')
  const [error, setError] = useState<string | null>(null)

  type Preview =
    | { kind: 'ok'; value: ReturnType<typeof parseCurl> }
    | { kind: 'err'; message: string }
  const parsed: Preview | null = (() => {
    if (mode !== 'import' || text.trim() === '') return null
    try {
      return { kind: 'ok', value: parseCurl(text) }
    } catch (err) {
      return {
        kind: 'err',
        message: err instanceof CurlParseError ? err.message : 'Could not read that command',
      }
    }
  })()

  const copy = () => {
    void navigator.clipboard
      .writeText(text)
      .then(() => notify({ level: 'success', title: 'Copied as curl', appId: 'rest-api-client' }))
      .catch(() =>
        notify({
          level: 'error',
          title: 'Could not copy',
          body: 'Select the text and copy it manually.',
          appId: 'rest-api-client',
        })
      )
  }

  const apply = () => {
    if (parsed?.kind !== 'ok') return
    const { method, url, headers, body, form, ignored } = parsed.value
    const hasForm = form.length > 0
    onImport({
      method,
      url,
      headers: headers.map((h) => ({ id: newId(), name: h.name, value: h.value, enabled: true })),
      body: hasForm ? '' : body,
      bodyMode: hasForm ? 'form' : 'text',
      form: form.map((f) => ({
        id: newId(),
        name: f.name,
        value: f.value,
        filePath: f.filePath,
        enabled: true,
      })),
    })
    const note = describeIgnored(ignored)
    notify({
      level: note ? 'warning' : 'success',
      title: 'Request imported',
      body: note ?? undefined,
      appId: 'rest-api-client',
    })
    onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={mode === 'import' ? 'Import a curl command' : 'Copy as curl'}
    >
      <div className="flex w-[38rem] max-w-full flex-col gap-2">
        <textarea
          className="border-outline-variant bg-surface-container-lowest text-on-surface min-h-[9rem] w-full resize-y border px-2 py-1.5 font-mono text-[12px] outline-none"
          placeholder={"curl 'https://api.example.com/users' -H 'accept: application/json'"}
          value={text}
          spellCheck={false}
          readOnly={mode === 'export'}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
        />

        {parsed?.kind === 'err' && <p className="text-error text-[12px]">{parsed.message}</p>}
        {parsed?.kind === 'ok' && (
          <div className="border-outline-variant bg-surface-container-low border px-2 py-1.5 text-[11px]">
            <div className="font-ui text-on-surface-variant mb-1 font-semibold tracking-wider uppercase">
              This will load
            </div>
            <div className="font-mono">
              <span className="text-primary">{parsed.value.method}</span> {parsed.value.url}
            </div>
            {parsed.value.headers.map((h, i) => (
              <div key={i} className="text-on-surface-variant font-mono">
                {h.name}: {h.value}
              </div>
            ))}
            {parsed.value.body && (
              <div className="text-on-surface-variant mt-1 font-mono break-all">
                body: {parsed.value.body.slice(0, 200)}
                {parsed.value.body.length > 200 ? '…' : ''}
              </div>
            )}
            {parsed.value.form.length > 0 && (
              <div className="text-on-surface-variant mt-1 font-mono">
                <span className="text-on-surface-variant">form (multipart):</span>
                {parsed.value.form.map((f, i) => (
                  <div key={i} className="break-all">
                    {f.name} = {f.filePath ? `@${f.filePath}` : f.value}
                  </div>
                ))}
              </div>
            )}
            {describeIgnored(parsed.value.ignored) && (
              <div className="text-error mt-1">{describeIgnored(parsed.value.ignored)}</div>
            )}
          </div>
        )}
        {error && <p className="text-error text-[12px]">{error}</p>}

        <div className="mt-1 flex justify-end gap-2">
          <Button variant="default" size="sm" onClick={onClose}>
            {mode === 'export' ? 'Close' : 'Cancel'}
          </Button>
          {mode === 'export' ? (
            <Button variant="primary" size="sm" className="gap-1" onClick={copy}>
              <Copy size={12} strokeWidth={2} /> Copy
            </Button>
          ) : (
            <Button variant="primary" size="sm" disabled={parsed?.kind !== 'ok'} onClick={apply}>
              Load it
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
