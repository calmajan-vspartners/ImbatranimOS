/**
 * The catalogue of formatting actions, and the keyboard map onto them.
 *
 * One list, used by both the toolbar and the keymap, so a button and its shortcut can
 * never drift apart — and so adding an action is one entry rather than three.
 */

import {
  applyLink,
  insertTable,
  setHeading,
  toggleBullet,
  toggleFence,
  toggleInline,
  toggleOrdered,
  toggleQuote,
  toggleTask,
  type EditResult,
  type Selection,
} from './markdownMarkers'

export type FormatKind =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'fence'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'quote'
  | 'link'
  | 'table'

export function applyFormat(kind: FormatKind, text: string, sel: Selection): EditResult {
  switch (kind) {
    case 'bold':
      return toggleInline(text, sel, '**')
    case 'italic':
      // A single `*`, not `_`: `_` inside snake_case_words is not emphasis in GFM but is
      // in CommonMark, and asterisks behave the same either way.
      return toggleInline(text, sel, '*')
    case 'strike':
      return toggleInline(text, sel, '~~')
    case 'code':
      return toggleInline(text, sel, '`')
    case 'fence':
      return toggleFence(text, sel)
    case 'h1':
      return setHeading(text, sel, 1)
    case 'h2':
      return setHeading(text, sel, 2)
    case 'h3':
      return setHeading(text, sel, 3)
    case 'bullet':
      return toggleBullet(text, sel)
    case 'ordered':
      return toggleOrdered(text, sel)
    case 'task':
      return toggleTask(text, sel)
    case 'quote':
      return toggleQuote(text, sel)
    case 'link':
      return applyLink(text, sel)
    case 'table':
      return insertTable(text, sel)
  }
}

/** What the toolbar shows, and what the shortcut hint says. */
export type FormatDescriptor = { kind: FormatKind; label: string; hint: string }

export const FORMAT_HINTS: Record<FormatKind, string> = {
  bold: 'Ctrl+B',
  italic: 'Ctrl+I',
  strike: 'Ctrl+Shift+X',
  code: 'Ctrl+E',
  fence: 'Ctrl+Shift+E',
  h1: 'Ctrl+Shift+1',
  h2: 'Ctrl+Shift+2',
  h3: 'Ctrl+Shift+3',
  bullet: 'Ctrl+Shift+8',
  ordered: 'Ctrl+Shift+7',
  task: 'Ctrl+Shift+9',
  quote: 'Ctrl+Shift+.',
  link: 'Ctrl+K',
  table: '',
}

/** The shape of a keydown this module needs — a real event satisfies it. */
export type KeyLike = { key: string; code: string; shiftKey: boolean }

/**
 * The formatting action a modifier-held keystroke means, or null.
 *
 * Digits are matched on `code`, not `key`: `Ctrl+Shift+8` arrives as `key: '*'` on a US
 * layout and as something else again on others, while `code: 'Digit8'` is the physical
 * key in every case.
 *
 * Headings are on `Ctrl+Shift+1..3` rather than the `Ctrl+1..3` a desktop editor would
 * use, because `Ctrl+1..9` is a reserved browser accelerator for switching tabs and a
 * page handler cannot cancel it. Shipping a shortcut that silently switches the user's
 * browser tab would be worse than not shipping one.
 */
export function keyToFormat(event: KeyLike): FormatKind | null {
  const key = event.key.toLowerCase()
  if (event.shiftKey) {
    switch (event.code) {
      case 'Digit1':
        return 'h1'
      case 'Digit2':
        return 'h2'
      case 'Digit3':
        return 'h3'
      case 'Digit7':
        return 'ordered'
      case 'Digit8':
        return 'bullet'
      case 'Digit9':
        return 'task'
      case 'Period':
        return 'quote'
      case 'KeyX':
        return 'strike'
      case 'KeyE':
        return 'fence'
      default:
        return null
    }
  }
  switch (key) {
    case 'b':
      return 'bold'
    case 'i':
      return 'italic'
    case 'k':
      return 'link'
    case 'e':
      return 'code'
    default:
      return null
  }
}
