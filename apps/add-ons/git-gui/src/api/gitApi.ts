import type { SystemHttp } from '@imbatranim/ui'
import type {
  BranchesResponse,
  CommitResponse,
  DiffResponse,
  LogResponse,
  RecentsResponse,
  StashListResponse,
  StatusResponse,
} from '../types'

// Wired against the backend GitModule contract (all authed by the global guard):
//   GET  /api/git/status?root=&path=
//   GET  /api/git/log?root=&path=&limit=
//   GET  /api/git/diff?root=&path=&staged=&file=
//   POST /api/git/stage    { root, path?, paths[] }
//   POST /api/git/unstage  { root, path?, paths[] }
//   POST /api/git/commit   { root, path?, message }

export async function fetchStatus(
  http: SystemHttp,
  root: string,
  path: string
): Promise<StatusResponse> {
  const res = await http.get<StatusResponse>('/git/status', { params: { root, path } })
  return res.data
}

export async function fetchLog(
  http: SystemHttp,
  root: string,
  path: string,
  limit = 30
): Promise<LogResponse> {
  const res = await http.get<LogResponse>('/git/log', { params: { root, path, limit } })
  return res.data
}

export async function fetchDiff(
  http: SystemHttp,
  root: string,
  path: string,
  staged: boolean,
  file?: string
): Promise<DiffResponse> {
  const res = await http.get<DiffResponse>('/git/diff', {
    params: { root, path, staged, file },
  })
  return res.data
}

export async function stagePaths(
  http: SystemHttp,
  root: string,
  path: string,
  paths: string[]
): Promise<StatusResponse> {
  const res = await http.post<StatusResponse>('/git/stage', { root, path, paths })
  return res.data
}

export async function unstagePaths(
  http: SystemHttp,
  root: string,
  path: string,
  paths: string[]
): Promise<StatusResponse> {
  const res = await http.post<StatusResponse>('/git/unstage', { root, path, paths })
  return res.data
}

export async function commit(
  http: SystemHttp,
  root: string,
  path: string,
  message: string
): Promise<CommitResponse> {
  const res = await http.post<CommitResponse>('/git/commit', { root, path, message })
  return res.data
}

// ---------------------------------------------------------------------------
// Brief 76. Every one of these is a named backend route over a fixed subcommand
// allowlist — there is no "run arbitrary git" endpoint to call.
//   GET  /api/git/branches      POST /api/git/branch    POST /api/git/switch
//   POST /api/git/discard       GET/POST /api/git/stash POST /api/git/stash/pop
//   GET  /api/git/last-message  POST /api/git/amend     POST /api/git/apply
//   GET/POST/DELETE /api/git/recents
// ---------------------------------------------------------------------------

export async function fetchBranches(
  http: SystemHttp,
  root: string,
  path: string
): Promise<BranchesResponse> {
  const res = await http.get<BranchesResponse>('/git/branches', { params: { root, path } })
  return res.data
}

export async function createBranch(
  http: SystemHttp,
  root: string,
  path: string,
  name: string
): Promise<void> {
  await http.post('/git/branch', { root, path, name })
}

export async function switchBranch(
  http: SystemHttp,
  root: string,
  path: string,
  name: string
): Promise<void> {
  await http.post('/git/switch', { root, path, name })
}

export async function discardPaths(
  http: SystemHttp,
  root: string,
  path: string,
  paths: string[]
): Promise<StatusResponse> {
  const res = await http.post<StatusResponse>('/git/discard', { root, path, paths })
  return res.data
}

export async function fetchStashes(
  http: SystemHttp,
  root: string,
  path: string
): Promise<StashListResponse> {
  const res = await http.get<StashListResponse>('/git/stash', { params: { root, path } })
  return res.data
}

export async function stashPush(
  http: SystemHttp,
  root: string,
  path: string,
  message?: string
): Promise<void> {
  await http.post('/git/stash', { root, path, message })
}

export async function stashPop(
  http: SystemHttp,
  root: string,
  path: string,
  index?: number
): Promise<void> {
  await http.post('/git/stash/pop', { root, path, index })
}

export async function fetchLastMessage(
  http: SystemHttp,
  root: string,
  path: string
): Promise<string> {
  const res = await http.get<{ message: string }>('/git/last-message', {
    params: { root, path },
  })
  return res.data.message
}

export async function amendCommit(
  http: SystemHttp,
  root: string,
  path: string,
  message: string
): Promise<void> {
  await http.post('/git/amend', { root, path, message })
}

/** Stage (or, with `reverse`, unstage) exactly one hunk. */
export async function applyPatch(
  http: SystemHttp,
  root: string,
  path: string,
  patch: string,
  reverse: boolean
): Promise<StatusResponse> {
  const res = await http.post<StatusResponse>('/git/apply', { root, path, patch, reverse })
  return res.data
}

export async function fetchRecents(http: SystemHttp): Promise<RecentsResponse> {
  const res = await http.get<RecentsResponse>('/git/recents')
  return res.data
}

export async function rememberRepo(http: SystemHttp, root: string, path: string): Promise<void> {
  await http.post('/git/recents', { root, path })
}

export async function forgetRepo(http: SystemHttp, root: string, path: string): Promise<void> {
  // DELETE /git/recents reads its body; the protocol grew `data` on the request
  // config for exactly this shape (brief 48).
  await http.delete('/git/recents', { data: { root, path } })
}
