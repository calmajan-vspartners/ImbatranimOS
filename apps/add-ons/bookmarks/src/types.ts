/**
 * camelCase, and `url` rather than `href` — the shape the backend now returns.
 *
 * `url` is the field name brief 50's browser will consume via
 * `openApp('browser', { url })`; see `index.ts` for that contract.
 */
export type BookmarkLink = {
  id: number
  groupId: number
  title: string
  url: string
  icon: string | null
  position: number
}

export type BookmarkGroup = {
  id: number
  name: string
  icon: string | null
  /** `null` for a root folder. The tree is assembled client-side from this. */
  parentId: number | null
  position: number
  links: BookmarkLink[]
}

export type CreateGroupInput = { name: string; parentId?: number | null }
export type UpdateGroupInput = { name?: string; parentId?: number | null }
export type CreateLinkInput = { groupId: number; title: string; url: string }
export type UpdateLinkInput = { title?: string; url?: string; groupId?: number }
