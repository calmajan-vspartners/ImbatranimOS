import type { SystemIntents } from '@imbatranim/ui'

type Associations = SystemIntents['associations']

/** What following a relative link should do (brief 119). */
export type LinkTarget = { kind: 'markdown' } | { kind: 'app'; appId: string } | { kind: 'none' }

const MARKDOWN = /\.(md|markdown)$/i

/** The basename of a root-relative path — what the registry matches on. */
export function baseName(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

/**
 * Where a relative link goes.
 *
 * Another markdown file stays here, deliberately: following a link inside a
 * document set is reading, not launching, and bouncing to whatever app happens
 * to be associated with `.md` would break that. Everything else goes through
 * the brief-81 association registry — the same resolver the file manager's
 * double-click uses — so a link to an image, a CSV or a PDF opens the app that
 * *declares* it rather than raising a toast telling the reader to go and find
 * the file themselves.
 *
 * `none` is an honest answer, not a failure: nothing claims this kind of file,
 * and saying so beats opening something that will render it as garbage.
 */
export function linkTarget(assoc: Associations, path: string): LinkTarget {
  if (MARKDOWN.test(path)) return { kind: 'markdown' }
  const { appId } = assoc.resolveOpener(baseName(path))
  return appId === '' ? { kind: 'none' } : { kind: 'app', appId }
}
