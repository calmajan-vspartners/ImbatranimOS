/**
 * Which file verb a keypress means — or nothing at all (brief 111).
 *
 * Split out from the handler for one reason: the *inertness* rules are the
 * part that matters and the part nobody can eyeball. A verb key that fires
 * while the inline rename input has focus deletes the file the user is
 * renaming; one that fires while a dialog is open acts on a list the user
 * cannot see. Those are data, so they are testable.
 */

export type FileVerb =
  | 'rename'
  | 'trash'
  | 'delete-permanently'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'select-all'
  | 'context-menu'

export type VerbKeyEvent = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  /** `tagName` of the event target, upper-case. */
  targetTag: string
  /** True for a contentEditable host. */
  targetEditable: boolean
}

export type VerbKeyContext = {
  /** An inline rename is in progress somewhere in the list. */
  renaming: boolean
  /** A modal (New Folder, Open With, Properties, Trash, confirm/prompt) is up. */
  modalOpen: boolean
  /** The context menu is already open — it owns the keyboard while it is. */
  menuOpen: boolean
}

const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * Returns the verb, or null when the key is not ours.
 *
 * Callers must `preventDefault()` ONLY when this returns non-null. Claiming a
 * key and then doing nothing with it is worse than never claiming it — it is
 * how Ctrl+A stops selecting text in a pane that has no selection to make.
 */
export function classifyVerbKey(e: VerbKeyEvent, ctx: VerbKeyContext): FileVerb | null {
  // Anything that owns the keyboard right now owns it completely.
  if (ctx.renaming || ctx.modalOpen || ctx.menuOpen) return null
  if (TEXT_ENTRY_TAGS.has(e.targetTag) || e.targetEditable) return null
  // Alt belongs to the window manager and the menu bar; never shadow it.
  if (e.altKey) return null

  if (e.key === 'F2' && !e.ctrlKey && !e.metaKey && !e.shiftKey) return 'rename'
  if (e.key === 'Delete' && !e.ctrlKey && !e.metaKey) {
    return e.shiftKey ? 'delete-permanently' : 'trash'
  }
  // The dedicated menu key, and the keyboard everyone actually has: Shift+F10.
  if (e.key === 'ContextMenu') return 'context-menu'
  if (e.key === 'F10' && e.shiftKey && !e.ctrlKey && !e.metaKey) return 'context-menu'

  if (e.ctrlKey || e.metaKey) {
    // Ctrl+Shift+C/X/V/A are devtools and other apps' bindings — not ours.
    if (e.shiftKey) return null
    switch (e.key.toLowerCase()) {
      case 'c':
        return 'copy'
      case 'x':
        return 'cut'
      case 'v':
        return 'paste'
      case 'a':
        return 'select-all'
      default:
        return null
    }
  }
  return null
}
