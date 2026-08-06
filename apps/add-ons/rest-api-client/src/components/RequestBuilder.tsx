import { Button, Input, Select, cn } from '@imbatranim/ui'
import {
  AlertTriangle,
  Download,
  KeyRound,
  Plus,
  Save,
  Send,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react'
import type { BodyMode, Environment, FormField, HeaderRow, HttpMethod } from '../types'
import { METHOD_OPTIONS, emptyHeaderRow, newId } from '../lib/ui'

type BuilderTab = 'headers' | 'body'

interface RequestBuilderProps {
  method: HttpMethod
  url: string
  headers: HeaderRow[]
  body: string
  bodyMode: BodyMode
  form: FormField[]
  filePath: string
  tab: BuilderTab
  loading: boolean
  environments: Environment[]
  activeEnvId: string | null
  /** What the URL becomes after `{{var}}` substitution — shown when it differs. */
  previewUrl: string
  issueText: string
  sendBlocked: boolean
  missingVars: string[]
  onMethodChange: (m: HttpMethod) => void
  onUrlChange: (u: string) => void
  onHeadersChange: (h: HeaderRow[]) => void
  onBodyChange: (b: string) => void
  onBodyModeChange: (m: BodyMode) => void
  onFormChange: (f: FormField[]) => void
  onFilePathChange: (p: string) => void
  onTabChange: (t: BuilderTab) => void
  onSend: () => void
  onSave: () => void
  onSelectEnv: (id: string | null) => void
  onEditEnvs: () => void
  onImportCurl: () => void
  onExportCurl: () => void
  onAddAuth: () => void
  onAddMissingVars: () => void
}

const NO_ENV = '__none__'

export function RequestBuilder({
  method,
  url,
  headers,
  body,
  bodyMode,
  form,
  filePath,
  tab,
  loading,
  environments,
  activeEnvId,
  previewUrl,
  issueText,
  sendBlocked,
  missingVars,
  onMethodChange,
  onUrlChange,
  onHeadersChange,
  onBodyChange,
  onBodyModeChange,
  onFormChange,
  onFilePathChange,
  onTabChange,
  onSend,
  onSave,
  onSelectEnv,
  onEditEnvs,
  onImportCurl,
  onExportCurl,
  onAddAuth,
  onAddMissingVars,
}: RequestBuilderProps) {
  const bodyDisabled = method === 'GET' || method === 'HEAD'

  const updateRow = (id: string, patch: Partial<HeaderRow>) =>
    onHeadersChange(headers.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const removeRow = (id: string) => onHeadersChange(headers.filter((r) => r.id !== id))
  const addRow = () => onHeadersChange([...headers, emptyHeaderRow()])

  const enabledCount = headers.filter((h) => h.enabled && h.name.trim()).length
  // Only worth showing when interpolation actually changed something.
  const showPreview = previewUrl !== url && previewUrl.trim() !== ''

  return (
    <div className="border-outline-variant flex flex-col gap-2 border-b p-2">
      {/* Environment + interop bar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="min-w-[10rem]">
          <Select
            options={[
              { value: NO_ENV, label: 'No environment' },
              ...environments.map((e) => ({ value: e.id, label: e.name })),
            ]}
            value={activeEnvId ?? NO_ENV}
            onValueChange={(v) => onSelectEnv(String(v) === NO_ENV ? null : String(v))}
            placeholder="No environment"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onEditEnvs}
          aria-label="Edit environments"
          title="Edit environments and variables"
        >
          <Settings2 size={12} strokeWidth={2} />
        </Button>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          onClick={onAddAuth}
          title="Add an Authorization header"
        >
          <KeyRound size={12} strokeWidth={2} /> Auth
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          onClick={onImportCurl}
          title="Import a curl command"
        >
          <Upload size={12} strokeWidth={2} /> Import curl
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          onClick={onExportCurl}
          disabled={!url.trim()}
          title="Copy this request as a curl command"
        >
          <Download size={12} strokeWidth={2} /> Copy curl
        </Button>
      </div>

      {/* Method + URL + actions */}
      <form
        className="flex items-stretch gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          onSend()
        }}
      >
        <Select
          options={METHOD_OPTIONS}
          value={method}
          onValueChange={(v) => onMethodChange(v as HttpMethod)}
          className="min-w-[7rem]"
        />
        <Input
          className="flex-1"
          placeholder="https://api.example.com/endpoint  or  {{base}}/users"
          value={url}
          spellCheck={false}
          onChange={(e) => onUrlChange(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={loading || !url.trim() || sendBlocked}>
          <Send size={13} />
          {loading ? 'Sending…' : 'Send'}
        </Button>
        <Button type="button" variant="ghost" onClick={onSave} title="Save to collection">
          <Save size={13} />
        </Button>
      </form>

      {showPreview && (
        <div className="text-on-surface-variant truncate font-mono text-[11px]" title={previewUrl}>
          → {previewUrl}
        </div>
      )}

      {issueText && (
        <div
          className={cn(
            'flex items-start gap-1.5 px-2 py-1 text-[11px]',
            sendBlocked
              ? 'bg-error-container text-on-error-container'
              : 'bg-surface-container-high text-on-surface-variant'
          )}
        >
          <AlertTriangle size={12} className="mt-px shrink-0" />
          <span className="min-w-0 flex-1">{issueText}</span>
          {missingVars.length > 0 && (
            <button
              type="button"
              onClick={onAddMissingVars}
              className="font-ui shrink-0 underline underline-offset-2"
            >
              Add {missingVars.length === 1 ? 'it' : 'them'} to the environment
            </button>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="border-outline-variant flex gap-0 border-b">
        <TabButton active={tab === 'headers'} onClick={() => onTabChange('headers')}>
          Headers{enabledCount > 0 ? ` (${enabledCount})` : ''}
        </TabButton>
        <TabButton active={tab === 'body'} onClick={() => onTabChange('body')}>
          Body
        </TabButton>
      </div>

      {tab === 'headers' && (
        <div className="flex flex-col gap-1">
          {headers.map((row) => (
            <div key={row.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(e) => updateRow(row.id, { enabled: e.target.checked })}
                className="accent-primary"
                aria-label={`Enable ${row.name || 'header'}`}
              />
              <Input
                className="flex-1"
                placeholder="Header"
                value={row.name}
                spellCheck={false}
                onChange={(e) => updateRow(row.id, { name: e.target.value })}
              />
              <Input
                className="flex-1"
                placeholder="Value"
                value={row.value}
                spellCheck={false}
                onChange={(e) => updateRow(row.id, { value: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeRow(row.id)}
                aria-label={`Remove ${row.name || 'header'}`}
                title="Remove header"
              >
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={addRow}>
            <Plus size={13} /> Add header
          </Button>
        </div>
      )}

      {tab === 'body' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <div className="min-w-[11rem]">
              <Select
                options={[
                  { value: 'text', label: 'Text / JSON' },
                  { value: 'form', label: 'Multipart form' },
                  { value: 'file', label: 'File (raw binary)' },
                ]}
                value={bodyMode}
                onValueChange={(v) => onBodyModeChange(v as BodyMode)}
              />
            </div>
            {bodyDisabled && (
              <span className="text-on-surface-variant text-[11px]">
                {method} requests have no body
              </span>
            )}
          </div>

          {!bodyDisabled && bodyMode === 'text' && (
            <textarea
              className={cn(
                'border-outline-variant bg-surface-container-lowest min-h-[7rem] w-full resize-y border px-2.5 py-1.5',
                'text-on-surface font-mono text-[12px] outline-none',
                'placeholder:text-on-surface-variant focus:border-primary'
              )}
              placeholder={'{ "key": "{{value}}" }'}
              value={body}
              spellCheck={false}
              aria-label="Request body"
              onChange={(e) => onBodyChange(e.target.value)}
            />
          )}

          {!bodyDisabled && bodyMode === 'file' && (
            <Input
              label="File under your home folder"
              placeholder="Documents/payload.bin"
              value={filePath}
              spellCheck={false}
              onChange={(e) => onFilePathChange(e.target.value)}
            />
          )}

          {!bodyDisabled && bodyMode === 'form' && (
            <div className="flex flex-col gap-1">
              {form.map((field) => (
                <div key={field.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={field.enabled}
                    onChange={(e) =>
                      onFormChange(
                        form.map((f) =>
                          f.id === field.id ? { ...f, enabled: e.target.checked } : f
                        )
                      )
                    }
                    className="accent-primary"
                    aria-label={`Enable ${field.name || 'field'}`}
                  />
                  <Input
                    className="w-40"
                    placeholder="Field name"
                    value={field.name}
                    spellCheck={false}
                    onChange={(e) =>
                      onFormChange(
                        form.map((f) => (f.id === field.id ? { ...f, name: e.target.value } : f))
                      )
                    }
                  />
                  {field.filePath === undefined ? (
                    <Input
                      className="flex-1"
                      placeholder="Value"
                      value={field.value}
                      spellCheck={false}
                      onChange={(e) =>
                        onFormChange(
                          form.map((f) => (f.id === field.id ? { ...f, value: e.target.value } : f))
                        )
                      }
                    />
                  ) : (
                    <Input
                      className="flex-1"
                      placeholder="Documents/photo.png"
                      value={field.filePath}
                      spellCheck={false}
                      onChange={(e) =>
                        onFormChange(
                          form.map((f) =>
                            f.id === field.id ? { ...f, filePath: e.target.value } : f
                          )
                        )
                      }
                    />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={field.filePath !== undefined}
                    title={
                      field.filePath === undefined
                        ? 'Send a file instead'
                        : 'Send a text value instead'
                    }
                    onClick={() =>
                      onFormChange(
                        form.map((f) =>
                          f.id === field.id
                            ? f.filePath === undefined
                              ? { ...f, filePath: '' }
                              : { ...f, filePath: undefined }
                            : f
                        )
                      )
                    }
                  >
                    {field.filePath === undefined ? 'Text' : 'File'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onFormChange(form.filter((f) => f.id !== field.id))}
                    aria-label={`Remove ${field.name || 'field'}`}
                    title="Remove field"
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() =>
                  onFormChange([...form, { id: newId(), name: '', value: '', enabled: true }])
                }
              >
                <Plus size={13} /> Add field
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'font-ui cursor-pointer px-3 py-1.5 text-[12px] outline-none',
        '-mb-px border-b-2',
        'focus-visible:ring-primary focus-visible:ring-2',
        active
          ? 'border-primary text-primary'
          : 'text-on-surface-variant hover:text-on-surface border-transparent'
      )}
    >
      {children}
    </button>
  )
}
