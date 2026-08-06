import { fetchFileBytes, notify } from '@imbatranim/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RequestBuilder } from './components/RequestBuilder'
import { ResponseViewer } from './components/ResponseViewer'
import { Sidebar } from './components/Sidebar'
import { EnvironmentDialog } from './components/EnvironmentDialog'
import { CurlDialog } from './components/CurlDialog'
import { AuthDialog } from './components/AuthDialog'
import { sendProxyRequest } from './api/httpProxyApi'
import { EMPTY_DATA, loadData, saveData } from './api/collectionsApi'
import type {
  BodyMode,
  FormField,
  HeaderRow,
  HistoryEntry,
  HttpMethod,
  ProxyResponse,
  RestClientData,
  SavedRequest,
} from './types'
import { emptyHeaderRow, newId } from './lib/ui'
import { activeEnvironment, toVariables } from './lib/environments'
import { blocksSend, describeIssues, interpolateRequest, referencedVars } from './lib/interpolate'
import { activeFields, buildMultipart, bytesToBase64, contentTypeFor } from './lib/multipart'

type BuilderTab = 'headers' | 'body'
type OpenDialog = 'env' | 'curl-import' | 'curl-export' | 'auth' | null

const APP_ID = 'rest-api-client'

/** Pull a readable message out of an axios-style error without importing axios. */
function extractError(err: unknown): string {
  const e = err as { response?: { data?: { message?: unknown } }; message?: string }
  const apiMsg = e?.response?.data?.message
  if (typeof apiMsg === 'string') return apiMsg
  if (Array.isArray(apiMsg)) return apiMsg.join(', ')
  return e?.message ?? 'Request failed'
}

export function RestApiClient(_props: { windowId: string }) {
  const [method, setMethod] = useState<HttpMethod>('GET')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState<HeaderRow[]>([emptyHeaderRow()])
  const [body, setBody] = useState('')
  const [bodyMode, setBodyMode] = useState<BodyMode>('text')
  const [form, setForm] = useState<FormField[]>([])
  const [filePath, setFilePath] = useState('')
  const [builderTab, setBuilderTab] = useState<BuilderTab>('headers')

  const [response, setResponse] = useState<ProxyResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [dialog, setDialog] = useState<OpenDialog>(null)

  const [data, setData] = useState<RestClientData>(EMPTY_DATA)
  // Latest data ref so callbacks read the current snapshot without re-binding.
  const dataRef = useRef(data)
  useEffect(() => {
    dataRef.current = data
  }, [data])

  useEffect(() => {
    let alive = true
    void loadData().then((loaded) => {
      if (alive) setData(loaded)
    })
    return () => {
      alive = false
    }
  }, [])

  const persist = useCallback((next: RestClientData) => {
    setData(next)
    void saveData(next).catch((err) =>
      notify({ level: 'error', title: 'Save failed', body: extractError(err), appId: APP_ID })
    )
  }, [])

  const env = activeEnvironment(data)
  const vars = useMemo(() => toVariables(env), [env])

  /**
   * What will actually be sent, recomputed as the user types.
   *
   * Interpolation is **never stored** — a saved request keeps its `{{var}}` form and
   * stays portable, which is the whole point of environments.
   */
  const preview = useMemo(
    () => interpolateRequest({ url, headers, body: bodyMode === 'text' ? body : '' }, vars),
    [url, headers, body, bodyMode, vars]
  )
  const issueText = describeIssues(preview.issues)
  const sendBlocked = blocksSend(preview.issues)

  /** Variables the request mentions that this environment has no value for. */
  const missingVars = useMemo(() => {
    const referenced = new Set([
      ...referencedVars(url),
      ...headers.flatMap((h) => [...referencedVars(h.name), ...referencedVars(h.value)]),
      ...referencedVars(body),
    ])
    return [...referenced].filter((name) => !(name in vars))
  }, [url, headers, body, vars])

  // Prepend a bounded history entry (persistence flows through `persist`).
  const recordHistory = useCallback(
    (status: number, elapsedMs?: number) => {
      const entry: HistoryEntry = {
        id: newId(),
        method,
        url: url.trim(),
        status,
        ts: Date.now(),
        // Brief 77: carry the headers and body, or "replay" only restores the method
        // and URL and silently leaves the PREVIOUS request's headers and body loaded.
        headers,
        body,
        elapsedMs,
      }
      persist({
        ...dataRef.current,
        history: [entry, ...dataRef.current.history].slice(0, 50),
      })
    },
    [method, url, headers, body, persist]
  )

  /** Compose the request body according to the chosen mode. */
  const composeBody = useCallback(async (): Promise<{
    body?: string
    bodyBase64?: string
    contentType?: string
  }> => {
    if (method === 'GET' || method === 'HEAD') return {}
    if (bodyMode === 'text') {
      return { body: preview.body || undefined }
    }
    if (bodyMode === 'file') {
      if (!filePath.trim()) throw new Error('Choose a file to send as the body')
      // fetchFileBytes yields an ArrayBuffer; the multipart helpers work in views.
      const bytes = new Uint8Array(await fetchFileBytes('home', filePath.trim()))
      return { bodyBase64: bytesToBase64(bytes), contentType: contentTypeFor(filePath) }
    }
    // multipart
    const fields = activeFields(form)
    if (fields.length === 0) throw new Error('Add at least one form field')
    const parts = await Promise.all(
      fields.map(async (field) => {
        if (!field.filePath) {
          // Variables work inside a form value too.
          return { name: field.name.trim(), value: interpolateOne(field.value, vars) }
        }
        const bytes = new Uint8Array(await fetchFileBytes('home', field.filePath))
        return {
          name: field.name.trim(),
          bytes,
          fileName: field.filePath.split('/').pop() ?? 'file',
          contentType: contentTypeFor(field.filePath),
        }
      })
    )
    const { bytes, contentType } = buildMultipart(parts)
    return { bodyBase64: bytesToBase64(bytes), contentType }
  }, [method, bodyMode, preview.body, filePath, form, vars])

  const handleSend = useCallback(async () => {
    if (!url.trim() || loading) return
    if (sendBlocked) {
      notify({ level: 'error', title: 'Cannot send that', body: issueText, appId: APP_ID })
      return
    }
    setLoading(true)
    setError(null)
    setResponse(null)
    try {
      const composed = await composeBody()
      const outHeaders: Record<string, string> = {}
      for (const header of preview.headers) outHeaders[header.name] = header.value
      // A composed body knows its own content type; a hand-written header wins.
      if (
        composed.contentType &&
        !Object.keys(outHeaders).some((k) => k.toLowerCase() === 'content-type')
      ) {
        outHeaders['Content-Type'] = composed.contentType
      }

      const res = await sendProxyRequest({
        method,
        url: preview.url,
        headers: outHeaders,
        body: composed.body,
        bodyBase64: composed.bodyBase64,
      })
      setResponse(res)
      recordHistory(res.status, res.elapsedMs)
    } catch (err) {
      setError(extractError(err))
      recordHistory(0)
    } finally {
      setLoading(false)
    }
  }, [url, loading, sendBlocked, issueText, composeBody, preview, method, recordHistory])

  const handleSave = useCallback(() => {
    if (!url.trim()) return
    const saved: SavedRequest = {
      id: newId(),
      name: url.trim(),
      method,
      url: url.trim(),
      headers,
      body,
      bodyMode,
      form,
      filePath: filePath || undefined,
    }
    persist({ ...dataRef.current, collections: [...dataRef.current.collections, saved] })
    notify({ level: 'success', title: 'Saved to collection', appId: APP_ID })
  }, [method, url, headers, body, bodyMode, form, filePath, persist])

  /** Load a request into the builder — every field, so nothing is left over. */
  const loadRequest = useCallback(
    (req: {
      method: HttpMethod
      url: string
      headers?: HeaderRow[]
      body?: string
      bodyMode?: BodyMode
      form?: FormField[]
      filePath?: string
    }) => {
      setMethod(req.method)
      setUrl(req.url)
      setHeaders(req.headers?.length ? req.headers : [emptyHeaderRow()])
      setBody(req.body ?? '')
      setBodyMode(req.bodyMode ?? 'text')
      setForm(req.form ?? [])
      setFilePath(req.filePath ?? '')
      setResponse(null)
      setError(null)
    },
    []
  )

  const openSaved = useCallback((req: SavedRequest) => loadRequest(req), [loadRequest])

  const deleteSaved = useCallback(
    (id: string) => {
      persist({
        ...dataRef.current,
        collections: dataRef.current.collections.filter((c) => c.id !== id),
      })
    },
    [persist]
  )

  /**
   * Replay a past request.
   *
   * Before brief 77 this set only the method and URL, leaving whatever headers and
   * body happened to be in the builder — so clicking a GET while a POST body and an
   * Authorization header were loaded and pressing Send sent something else entirely.
   * Entries recorded before the fix carry no headers, so they reset to empty rather
   * than inheriting: a wrong-but-visible blank beats a wrong-and-invisible leftover.
   */
  const openHistory = useCallback(
    (entry: HistoryEntry) => {
      loadRequest({
        method: entry.method,
        url: entry.url,
        headers: entry.headers,
        body: entry.body,
      })
    },
    [loadRequest]
  )

  const clearHistory = useCallback(() => {
    persist({ ...dataRef.current, history: [] })
  }, [persist])

  const applyAuthHeader = useCallback((header: { name: string; value: string }) => {
    setHeaders((prev) => {
      const existing = prev.findIndex(
        (h) => h.name.trim().toLowerCase() === header.name.toLowerCase()
      )
      if (existing >= 0) {
        const next = [...prev]
        next[existing] = { ...next[existing], value: header.value, enabled: true }
        return next
      }
      // Drop a trailing blank row so the new header does not land under an empty one.
      const trimmed = prev.filter((h) => h.name.trim() !== '' || h.value.trim() !== '')
      return [...trimmed, { id: newId(), name: header.name, value: header.value, enabled: true }]
    })
  }, [])

  return (
    <div className="bg-surface text-on-surface font-content flex h-full min-h-0 w-full">
      <Sidebar
        data={data}
        onOpenSaved={openSaved}
        onDeleteSaved={deleteSaved}
        onOpenHistory={openHistory}
        onClearHistory={clearHistory}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <RequestBuilder
          method={method}
          url={url}
          headers={headers}
          body={body}
          bodyMode={bodyMode}
          form={form}
          filePath={filePath}
          tab={builderTab}
          loading={loading}
          environments={data.environments}
          activeEnvId={data.activeEnvId}
          previewUrl={preview.url}
          issueText={issueText}
          sendBlocked={sendBlocked}
          missingVars={missingVars}
          onMethodChange={setMethod}
          onUrlChange={setUrl}
          onHeadersChange={setHeaders}
          onBodyChange={setBody}
          onBodyModeChange={setBodyMode}
          onFormChange={setForm}
          onFilePathChange={setFilePath}
          onTabChange={setBuilderTab}
          onSend={() => void handleSend()}
          onSave={handleSave}
          onSelectEnv={(id) => persist({ ...dataRef.current, activeEnvId: id })}
          onEditEnvs={() => setDialog('env')}
          onImportCurl={() => setDialog('curl-import')}
          onExportCurl={() => setDialog('curl-export')}
          onAddAuth={() => setDialog('auth')}
          onAddMissingVars={() => {
            const target = activeEnvironment(dataRef.current)
            if (!target) {
              setDialog('env')
              return
            }
            const known = new Set(target.vars.map((v) => v.name.trim()))
            const additions = missingVars
              .filter((n) => !known.has(n))
              .map((n) => ({
                id: newId(),
                name: n,
                value: '',
                secret: /token|secret|key|password/i.test(n),
              }))
            persist({
              ...dataRef.current,
              environments: dataRef.current.environments.map((e) =>
                e.id === target.id ? { ...e, vars: [...e.vars, ...additions] } : e
              ),
            })
            setDialog('env')
          }}
        />
        <ResponseViewer response={response} error={error} loading={loading} />
      </div>

      {dialog === 'env' && (
        <EnvironmentDialog
          environments={data.environments}
          activeEnvId={data.activeEnvId}
          onChange={(environments, activeEnvId) =>
            persist({ ...dataRef.current, environments, activeEnvId })
          }
          onClose={() => setDialog(null)}
        />
      )}
      {(dialog === 'curl-import' || dialog === 'curl-export') && (
        <CurlDialog
          mode={dialog === 'curl-import' ? 'import' : 'export'}
          request={{ method, url, headers, body }}
          onImport={(parsed) => loadRequest(parsed)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'auth' && (
        <AuthDialog environment={env} onApply={applyAuthHeader} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}

/** Substitute into one string. Kept local — the whole-request path lives in the hook. */
function interpolateOne(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name: string) =>
    name in vars ? vars[name] : match
  )
}
