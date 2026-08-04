/**
 * Which filesystem root Notepad opens into, and the size it refuses to open.
 *
 * ## The root question
 *
 * Notepad read and wrote through `root=notes` while every other app defaults to
 * `home`. So a file created in Notepad did not appear in the File Manager's home
 * tree, was not found by the launcher's default search scope, and was not where the
 * user's own `~/Documents` lives. For an OS whose selling point is a *real* shared
 * filesystem, one app quietly writing somewhere else is a seam users trip over once
 * and never trust again.
 *
 * **But silently switching the default hides a returning user's existing notes.**
 * They are still on disk under `notes`, still reachable through the picker — but a
 * user who opens Notepad and sees an empty home directory concludes their notes are
 * gone, which is worse than the inconsistency being fixed.
 *
 * So the default is decided per install: `home` for a fresh one, `notes` while notes
 * already exist there. That is a one-time read at startup, not a stored migration
 * flag — nothing to get out of sync, and it self-corrects if the user empties the
 * notes root.
 */

export type NotepadRoot = 'home' | 'notes'

export const NOTEPAD_ROOTS: { id: NotepadRoot; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'notes', label: 'Notes' },
]

/**
 * The root to open into, given whether the legacy `notes` root has anything in it.
 *
 * `null` for "not known yet" — the caller has not finished asking the backend. It
 * must not be conflated with "empty", or the first render of a returning user's
 * Notepad would point at `home` and then jump.
 */
export function defaultRoot(notesHasFiles: boolean | null): NotepadRoot | null {
  if (notesHasFiles === null) return null
  return notesHasFiles ? 'notes' : 'home'
}

/**
 * Largest file Notepad will load into a controlled textarea.
 *
 * The whole file becomes one React state string, so every keystroke re-renders it.
 * `.log` files — exactly what this app owns — routinely blow past this, and the
 * failure mode without a guard is not an error but a tab that types at one character
 * per second.
 *
 * 1 MiB is where a textarea starts to feel wrong in testing, and it is comfortably
 * above any note a person writes by hand.
 */
export const MAX_OPEN_BYTES = 1024 * 1024

export function isTooLarge(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > MAX_OPEN_BYTES
}

/** Human size for the refusal message. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
