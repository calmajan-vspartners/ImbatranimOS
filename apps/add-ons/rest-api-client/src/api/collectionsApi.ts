import type { SystemHttp } from '@imbatranim/ui'
import type { Environment, HistoryEntry, RestClientData, SavedRequest } from '../types'

// Web-OS identity: user data lives in the home volume, not localStorage. We
// persist to a single JSON doc under ~/.config/rest-client/ via the authed
// files API (PUT/GET /files/content). writeFile mkdir -p's the parent dirs.
const ROOT = 'home'
const PATH = '.config/rest-client/collections.json'

/** History is bounded so the doc can't grow without limit. */
const MAX_HISTORY = 50

export const EMPTY_DATA: RestClientData = {
  collections: [],
  history: [],
  environments: [],
  activeEnvId: null,
}

/**
 * Coerce an unknown parsed doc into a valid RestClientData (defensive).
 *
 * Every field is checked independently so a file written before brief 77 — which had
 * no `environments` or `activeEnvId` — loads with its collections and history intact
 * rather than degrading to EMPTY_DATA. A dangling `activeEnvId` is dropped here, so
 * the send path never has to cope with one.
 */
function normalize(raw: unknown): RestClientData {
  const doc = (raw ?? {}) as Partial<RestClientData>
  const collections = Array.isArray(doc.collections) ? (doc.collections as SavedRequest[]) : []
  const history = Array.isArray(doc.history) ? (doc.history as HistoryEntry[]) : []
  const environments = Array.isArray(doc.environments)
    ? (doc.environments as Environment[]).filter(
        (env) => typeof env?.id === 'string' && Array.isArray(env?.vars)
      )
    : []
  const activeEnvId =
    typeof doc.activeEnvId === 'string' && environments.some((e) => e.id === doc.activeEnvId)
      ? doc.activeEnvId
      : null
  return { collections, history: history.slice(0, MAX_HISTORY), environments, activeEnvId }
}

/**
 * Load collections + history. A missing file (first run) yields empty data —
 * the 404 from the files API is expected, not an error to surface.
 */
export async function loadData(http: SystemHttp): Promise<RestClientData> {
  try {
    const res = await http.get<{ path: string; content: string }>('/files/content', {
      params: { root: ROOT, path: PATH },
    })
    return normalize(JSON.parse(res.data.content))
  } catch {
    // A missing file (first run) or a malformed one both degrade to empty rather
    // than crashing the app — the regression surface brief 77 names.
    return EMPTY_DATA
  }
}

/** Persist collections + history (history clamped to MAX_HISTORY). */
export async function saveData(http: SystemHttp, data: RestClientData): Promise<void> {
  const bounded: RestClientData = {
    collections: data.collections,
    history: data.history.slice(0, MAX_HISTORY),
    environments: data.environments,
    activeEnvId: data.activeEnvId,
  }
  await http.put('/files/content', {
    root: ROOT,
    path: PATH,
    content: JSON.stringify(bounded, null, 2),
  })
}
