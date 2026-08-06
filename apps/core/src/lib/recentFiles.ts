import { useQuery } from '@tanstack/react-query'
import { api } from './axios'
import { queryClient } from './queryClient'

/**
 * OS-wide recent files (brief 94) — the client half of `/api/files/recent`.
 *
 * Recording happens at the choke points (the file manager's open routing and
 * the core file dialog), plus any app whose open flow bypasses both (Notepad's
 * own list). Consumers: the Start menu's Recent section, the file picker's
 * Recent tab and the palette's "Recent files" source.
 */
export type RecentFile = {
  id: number
  root: string
  path: string
  appId: string
  lastOpened: string
}

export const RECENT_FILES_KEY = ['files', 'recent'] as const

function invalidate(): void {
  void queryClient.invalidateQueries({ queryKey: RECENT_FILES_KEY })
}

export function useRecentFilesQuery() {
  return useQuery({
    queryKey: RECENT_FILES_KEY,
    queryFn: async () => (await api.get<RecentFile[]>('/files/recent')).data,
  })
}

/**
 * Record an open. Fire-and-forget on purpose: recents are a hint, and no open
 * flow should fail or slow down because the hint could not be written.
 */
export function recordRecentFile(root: string, path: string, appId: string): void {
  void api
    .post('/files/recent', { root, path, appId })
    .then(invalidate)
    .catch(() => undefined)
}

/** Self-heal: drop an entry whose file turned out to be gone. */
export function removeRecentFile(root: string, path: string): void {
  void api
    .delete('/files/recent', { params: { root, path } })
    .then(invalidate)
    .catch(() => undefined)
}

/** The privacy affordance: wipe the list. */
export async function clearRecentFiles(): Promise<void> {
  await api.delete('/files/recent/all')
  invalidate()
}

/** Non-hook read for imperative callers (the palette source). */
export async function fetchRecentFiles(): Promise<RecentFile[]> {
  return (await api.get<RecentFile[]>('/files/recent')).data
}
