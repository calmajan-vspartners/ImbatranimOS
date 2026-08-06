/** The HTTP verbs the request builder offers (mirrors the backend enum). */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

/** One editable header row in the builder. Disabled rows are not sent. */
export interface HeaderRow {
  id: string
  name: string
  value: string
  enabled: boolean
}

/** Response shape returned by the backend proxy (POST /api/http/request). */
export interface ProxyResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  bodyBase64: string
  truncated: boolean
  elapsedMs: number
}

/**
 * A request saved into a collection.
 *
 * Stored with its `{{var}}` placeholders **uninterpolated** — that is what makes one
 * saved request work against local and against a deployed instance.
 */
export interface SavedRequest {
  id: string
  name: string
  method: HttpMethod
  url: string
  headers: HeaderRow[]
  body: string
  bodyMode?: BodyMode
  form?: FormField[]
  /** Home-root-relative path for a raw-binary body. */
  filePath?: string
}

/**
 * A bounded record of a past send.
 *
 * `headers` and `body` are carried (brief 77) because without them "replay" restored
 * only the method and URL and **left the previous request's headers and body loaded**
 * — click a GET from history while a POST body and an Authorization header are still
 * in the builder, press Send, and you send something other than what you clicked.
 * They are optional so entries written before brief 77 still load.
 */
export interface HistoryEntry {
  id: string
  method: HttpMethod
  url: string
  status: number
  ts: number
  headers?: HeaderRow[]
  body?: string
  /** Round-trip time, so history is also a record of how slow something was. */
  elapsedMs?: number
}

/** One variable in an environment. `secret` masks it and excludes it from exports. */
export interface EnvVar {
  id: string
  name: string
  value: string
  secret: boolean
}

/** A named set of variables — "local", "staging", "production". */
export interface Environment {
  id: string
  name: string
  vars: EnvVar[]
}

/** How a request's body is composed. */
export type BodyMode = 'text' | 'form' | 'file'

/** One row of a multipart form body. */
export interface FormField {
  id: string
  name: string
  /** A literal value, or — when `filePath` is set — the file's bytes. */
  value: string
  /** Home-root-relative path, read at send time through the files API. */
  filePath?: string
  enabled: boolean
}

/** The full persisted document (home FS: .config/rest-client/collections.json). */
export interface RestClientData {
  collections: SavedRequest[]
  history: HistoryEntry[]
  /** Brief 77. Optional in the type so a pre-77 file still loads. */
  environments: Environment[]
  activeEnvId: string | null
}
