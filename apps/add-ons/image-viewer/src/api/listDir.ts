import type { SystemHttp } from '@imbatranim/ui'
import type { FsEntry } from './types'

/**
 * Thin `GET /files?root=&path=` wrapper — add-ons may not import the
 * file-manager package, so this list call is defined locally instead of
 * reused. Mirrors `listDirectory` in
 * `apps/add-ons/file-manager/src/api/filesApi.ts`. Takes the http capability
 * as a parameter: only hooks may call `useSystem()`, and this is not one.
 */
export async function listDir(http: SystemHttp, root: string, path: string): Promise<FsEntry[]> {
  const res = await http.get<FsEntry[]>('/files', { params: { root, path } })
  return res.data
}
