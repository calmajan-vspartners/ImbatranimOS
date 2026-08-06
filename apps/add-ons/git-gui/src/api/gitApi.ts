import { api } from '@imbatranim/core'
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

export async function fetchStatus(root: string, path: string): Promise<StatusResponse> {
  const res = await api.get<StatusResponse>('/git/status', { params: { root, path } })
  return res.data
}

export async function fetchLog(root: string, path: string, limit = 30): Promise<LogResponse> {
  const res = await api.get<LogResponse>('/git/log', { params: { root, path, limit } })
  return res.data
}

export async function fetchDiff(
  root: string,
  path: string,
  staged: boolean,
  file?: string
): Promise<DiffResponse> {
  const res = await api.get<DiffResponse>('/git/diff', {
    params: { root, path, staged, file },
  })
  return res.data
}

export async function stagePaths(
  root: string,
  path: string,
  paths: string[]
): Promise<StatusResponse> {
  const res = await api.post<StatusResponse>('/git/stage', { root, path, paths })
  return res.data
}

export async function unstagePaths(
  root: string,
  path: string,
  paths: string[]
): Promise<StatusResponse> {
  const res = await api.post<StatusResponse>('/git/unstage', { root, path, paths })
  return res.data
}

export async function commit(root: string, path: string, message: string): Promise<CommitResponse> {
  const res = await api.post<CommitResponse>('/git/commit', { root, path, message })
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

export async function fetchBranches(root: string, path: string): Promise<BranchesResponse> {
  const res = await api.get<BranchesResponse>('/git/branches', { params: { root, path } })
  return res.data
}

export async function createBranch(root: string, path: string, name: string): Promise<void> {
  await api.post('/git/branch', { root, path, name })
}

export async function switchBranch(root: string, path: string, name: string): Promise<void> {
  await api.post('/git/switch', { root, path, name })
}

export async function discardPaths(
  root: string,
  path: string,
  paths: string[]
): Promise<StatusResponse> {
  const res = await api.post<StatusResponse>('/git/discard', { root, path, paths })
  return res.data
}

export async function fetchStashes(root: string, path: string): Promise<StashListResponse> {
  const res = await api.get<StashListResponse>('/git/stash', { params: { root, path } })
  return res.data
}

export async function stashPush(root: string, path: string, message?: string): Promise<void> {
  await api.post('/git/stash', { root, path, message })
}

export async function stashPop(root: string, path: string, index?: number): Promise<void> {
  await api.post('/git/stash/pop', { root, path, index })
}

export async function fetchLastMessage(root: string, path: string): Promise<string> {
  const res = await api.get<{ message: string }>('/git/last-message', {
    params: { root, path },
  })
  return res.data.message
}

export async function amendCommit(root: string, path: string, message: string): Promise<void> {
  await api.post('/git/amend', { root, path, message })
}

/** Stage (or, with `reverse`, unstage) exactly one hunk. */
export async function applyPatch(
  root: string,
  path: string,
  patch: string,
  reverse: boolean
): Promise<StatusResponse> {
  const res = await api.post<StatusResponse>('/git/apply', { root, path, patch, reverse })
  return res.data
}

export async function fetchRecents(): Promise<RecentsResponse> {
  const res = await api.get<RecentsResponse>('/git/recents')
  return res.data
}

export async function rememberRepo(root: string, path: string): Promise<void> {
  await api.post('/git/recents', { root, path })
}

export async function forgetRepo(root: string, path: string): Promise<void> {
  await api.delete('/git/recents', { data: { root, path } })
}
